import net from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { Chi, THRUM_VERSION, isDusk, isKnownTone, rid } from "../thrum/index.ts";
import type { Tone } from "../thrum/index.ts";
import { beeHid } from "./identity.ts";

export interface Khidma {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface Shurut {
  hive: string;
  prefix?: "fbee" | "wbee";
  bee?: string[];
  version?: string;
  chis?: string[];
  tools?: Khidma[];
  provides?: string[];
  propensity?: Record<string, string>;
  source?: string;
  log?: (m: string) => void;
}

const RAJA = [1000, 2000, 5000, 10000, 30000];

export function naghama(chi: string, body: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Tone {
  return { chi, rid: rid(), sentAt: Date.now(), ...extra, ...body } as Tone;
}

export function sutur(): (chunk: string, onLine: (line: string) => void) => void {
  let buf = "";
  return function daf(chunk, onLine) {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.length > 0) onLine(line);
    }
  };
}


export function masar_thrum(): string {
  if (process.env.HUM_THRUM_SOCK) return process.env.HUM_THRUM_SOCK;
  if (process.env.HUM_SOCKET) return process.env.HUM_SOCKET;
  const state = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(state, "hum", "thrum.sock");
}

export class Nahla {
  kind: string;
  prefix: "fbee" | "wbee";
  hello: Record<string, unknown>;
  log: (m: string) => void;
  #sock: net.Socket | null = null;
  #handlers = new Map<string, Array<(t: Tone) => void>>();
  #dead = false;
  #attempt = 0;
  #framer = sutur();
  _hid = "";

  constructor(shurut: Shurut) {
    this.kind = shurut.hive;
    this.prefix = shurut.prefix ?? "fbee";
    this.hello = {
      chi: Chi.hello,
      from: shurut.hive,
      bee: shurut.bee ?? [this.prefix === "wbee" ? "worker" : "forager"],
      hive: shurut.hive,
      version: shurut.version ?? "1.0.0",
      protoVersion: THRUM_VERSION,
      chis: shurut.chis ?? [],
      ...(shurut.tools ? { tools: shurut.tools, tool_names: shurut.tools.map((t) => t.name) } : {}),
      ...(shurut.provides ? { provides: shurut.provides } : {}),
      ...(shurut.propensity ? { propensity: shurut.propensity } : {}),
      ...(shurut.source ? { source: shurut.source } : {}),
    };
    this.log = shurut.log ?? (() => {});
  }

  on(chi: string, fn: (t: Tone) => void): this {
    if (!this.#handlers.has(chi)) this.#handlers.set(chi, []);
    this.#handlers.get(chi)!.push(fn);
    return this;
  }

  get hid(): string {
    if (!this._hid) this._hid = beeHid(this.kind, this.prefix);
    return this._hid;
  }

  send(t: Tone): boolean {
    if (!this.#sock || this.#sock.destroyed) return false;
    this.#sock.write(JSON.stringify(t) + "\n");
    return true;
  }

  emit(chi: string, body: Record<string, unknown>, extra?: Record<string, unknown>): boolean {
    return this.send(naghama(chi, { from: this.hid, ...body }, extra));
  }

  async connect(path: string = masar_thrum()): Promise<void> {
    this.#dead = false;
    this.#attempt = 0;
    this.#loop(path);
  }

  #loop(path: string): void {
    if (this.#dead) return;
    const sock = net.createConnection(path);
    this.#sock = sock;
    sock.on("connect", () => {
      this.#attempt = 0;
      this.log(`[${this.kind}] ${path}`);
      this.send({ ...this.hello, rid: `hello-${Date.now().toString(36)}`, hid: this.hid } as Tone);
    });
    sock.on("data", (chunk: Buffer) => {
      this.#framer(chunk.toString(), (line) => {
        let t: Tone;
        try {
          t = JSON.parse(line);
        } catch {
          return;
        }
        if (!isKnownTone(t) || isDusk(t)) return;
        for (const fn of this.#handlers.get(t.chi as string) ?? []) {
          try {
            fn(t);
          } catch (err) {
            this.log(`[${this.kind}] ${t.chi}: ${(err as Error).message}`);
          }
        }
      });
    });
    const retry = () => {
      if (this.#dead) return;
      const wait = RAJA[Math.min(this.#attempt++, RAJA.length - 1)];
      this.log(`[${this.kind}] ${wait}`);
      setTimeout(() => this.#loop(path), wait);
    };
    sock.on("close", retry);
    sock.on("error", () => {});
  }

  close(): void {
    this.#dead = true;
    this.#sock?.destroy();
  }
}

export function khidmat_jani(shurut: Shurut, tanfidh: (name: string, args: Record<string, unknown>, t: Tone) => Promise<unknown>): Nahla {
  const nahla = new Nahla({
    ...shurut,
    chis: ["hello", "tool-call", "tool-result", "error", "curate", ...(shurut.chis ?? [])],
  });
  nahla.on(Chi.toolCall, async (t: Tone) => {
    const callId = t.callId as string;
    const toolName = (t.toolName ?? t.name) as string;
    const args = (t.args ?? {}) as Record<string, unknown>;
    try {
      const output = await tanfidh(toolName, args, t);
      nahla.send(naghama(Chi.toolResult, { callId, output: typeof output === "string" ? output : JSON.stringify(output) }));
    } catch (err) {
      nahla.send(naghama(Chi.toolResult, { callId, isError: true, output: String((err as Error)?.message ?? err) }));
    }
  });
  return nahla;
}
