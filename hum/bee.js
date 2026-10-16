import net from "node:net";
import { Chi, THRUM_VERSION, frameLines, isDusk, isKnownTone, sockPath, tone } from "./wire.js";
import { beeHid } from "./identity.js";

const BACKOFF = [1000, 2000, 5000, 10000, 30000];

export class Bee {
  #sock = null;
  #handlers = new Map();
  #dead = false;
  #attempt = 0;
  #framer = frameLines();

  constructor(opts) {
    this.kind = opts.hive;
    this.prefix = opts.prefix ?? "fbee";
    this.hello = {
      chi: Chi.hello,
      from: opts.hive,
      bee: opts.bee ?? [opts.prefix === "wbee" ? "worker" : "forager"],
      hive: opts.hive,
      version: opts.version ?? "1.0.0",
      protoVersion: THRUM_VERSION,
      chis: opts.chis ?? [],
      ...(opts.tools ? { tools: opts.tools, tool_names: opts.tools.map((t) => t.name) } : {}),
      ...(opts.provides ? { provides: opts.provides } : {}),
      ...(opts.propensity ? { propensity: opts.propensity } : {}),
      ...(opts.source ? { source: opts.source } : {}),
    };
    this.log = opts.log ?? (() => {});
  }

  on(chi, fn) {
    if (!this.#handlers.has(chi)) this.#handlers.set(chi, []);
    this.#handlers.get(chi).push(fn);
    return this;
  }

  get hid() {
    if (!this._hid) this._hid = beeHid(this.kind, this.prefix);
    return this._hid;
  }

  send(t) {
    if (!this.#sock || this.#sock.destroyed) return false;
    this.#sock.write(JSON.stringify(t) + "\n");
    return true;
  }

  emit(chi, body, extra) {
    return this.send(tone(chi, { from: this.hid, ...body }, extra));
  }

  async connect(path = sockPath()) {
    this.#dead = false;
    this.#attempt = 0;
    this.#loop(path);
  }

  #loop(path) {
    if (this.#dead) return;
    const sock = net.createConnection(path);
    this.#sock = sock;
    sock.on("connect", () => {
      this.#attempt = 0;
      this.log(`[${this.kind}] ${path}`);
      this.send({ ...this.hello, rid: `hello-${Date.now().toString(36)}`, hid: this.hid });
    });
    sock.on("data", (chunk) => {
      this.#framer(chunk.toString(), (line) => {
        let t;
        try {
          t = JSON.parse(line);
        } catch {
          return;
        }
        if (!isKnownTone(t) || isDusk(t)) return;
        for (const fn of this.#handlers.get(t.chi) ?? []) {
          try {
            fn(t);
          } catch (err) {
            this.log(`[${this.kind}] ${t.chi}: ${err.message}`);
          }
        }
      });
    });
    const retry = () => {
      if (this.#dead) return;
      const wait = BACKOFF[Math.min(this.#attempt++, BACKOFF.length - 1)];
      this.log(`[${this.kind}] ${wait}`);
      setTimeout(() => this.#loop(path), wait);
    };
    sock.on("close", retry);
    sock.on("error", () => {});
  }

  close() {
    this.#dead = true;
    this.#sock?.destroy();
  }
}

export function serveForager(opts, onToolCall) {
  const bee = new Bee({
    ...opts,
    chis: ["hello", "tool-call", "tool-result", "error", "curate", ...(opts.chis ?? [])],
  });
  bee.on(Chi.toolCall, async (t) => {
    const { callId, toolName, name, args } = t;
    try {
      const output = await onToolCall(toolName ?? name, args ?? {}, t);
      bee.send(tone(Chi.toolResult, { callId, output: typeof output === "string" ? output : JSON.stringify(output) }));
    } catch (err) {
      bee.send(tone(Chi.toolResult, { callId, isError: true, output: String(err?.message ?? err) }));
    }
  });
  return bee;
}
