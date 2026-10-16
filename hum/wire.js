import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

export const THRUM_VERSION = "0.7.0";

export const Chi = {
  hello: "hello",
  prompt: "prompt",
  cancel: "cancel",
  cleanup: "cleanup",
  curate: "curate",
  releasePermit: "release-permit",
  tendrilResult: "tendril-result",
  toolResult: "tool-result",
  petalCell: "petal-cell",
  breath: "breath",
  chunk: "chunk",
  finish: "finish",
  error: "error",
  sessionReady: "session-ready",
  pulse: "pulse",
  permissionAsk: "permission-ask",
  tendrilReach: "tendril-reach",
  toolCall: "tool-call",
  toolMeta: "tool-meta",
  toolInfo: "tool-info",
  echo: "echo",
  perfMark: "perf-mark",
  log: "log",
  drone: "drone",
  droneRetrofit: "drone-retrofit",
  peerAdd: "peer-add",
  peerRemove: "peer-remove",
  attach: "attach",
  detach: "detach",
  waneSync: "wane-sync",
  gossipPublish: "gossip-publish",
  kadFindNode: "kad-find-node",
  kadFindNodeResp: "kad-find-node-resp",
  backfill: "backfill",
};

const ALL_CHI = new Set(Object.values(Chi));
export function isValidChi(s) {
  return ALL_CHI.has(s);
}

export const PulseKind = {
  cellSpawned: "cell-spawned",
  cellReady: "cell-ready",
  cellIdle: "cell-idle",
  cellDied: "cell-died",
  cellEvicted: "cell-evicted",
};

export function isEnvelope(x) {
  if (!x || typeof x !== "object") return false;
  return (
    typeof x.chi === "string" &&
    (typeof x.rid === "string" || x.rid === undefined) &&
    (x.sid === undefined || typeof x.sid === "string")
  );
}

export function isKnownTone(x) {
  return isEnvelope(x) && isValidChi(x.chi);
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function humIdEncode(buf) {
  let v = 0n;
  for (const b of buf) v = (v << 8n) | BigInt(b);
  v <<= 4n;
  let out = "";
  for (let i = 0; i < 52; i++) {
    out += CROCKFORD[Number((v >> BigInt(255 - 5 * i)) & 0x1fn)];
  }
  return out;
}

export function rid() {
  const buf = Buffer.alloc(32);
  let ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) {
    buf[5 - i] = Number(ms & 0xffn);
    ms >>= 8n;
  }
  randomBytes(26).copy(buf, 6);
  return humIdEncode(buf);
}

export function isValidRid(value) {
  return (
    typeof value === "string" &&
    value.length === 52 &&
    [...value].every((c) => CROCKFORD.includes(c))
  );
}

export function sigil(sid, nest) {
  return createHash("sha256").update(`${nest}:${sid}`).digest("hex").slice(0, 12);
}

export function duskIn(ms) {
  return Date.now() + ms;
}

export function isDusk(tone) {
  return typeof tone.dusk === "number" && Date.now() > tone.dusk;
}

export class WaneTracker {
  #counters = new Map();
  get(s) {
    return this.#counters.get(s) ?? 0;
  }
  tick(s) {
    const next = (this.#counters.get(s) ?? 0) + 1;
    this.#counters.set(s, next);
    return next;
  }
  set(s, value) {
    this.#counters.set(s, value);
  }
  behind(s, remote) {
    return remote > this.get(s);
  }
}

export function sockPath() {
  if (process.env.HUM_THRUM_SOCK) return process.env.HUM_THRUM_SOCK;
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  const runtime = process.env.XDG_RUNTIME_DIR ?? `/run/user/${uid}`;
  return join(runtime, "hum/thrum.sock");
}

export function tone(chi, body = {}, extra = {}) {
  return { chi, rid: rid(), sentAt: Date.now(), ...extra, ...body };
}

export function frameLines() {
  let buf = "";
  return function push(chunk, onLine) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.length > 0) onLine(line);
    }
  };
}
