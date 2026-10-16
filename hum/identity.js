import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function keyPath(kind) {
  const base = process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, "hum", "bees")
    : join(homedir(), ".local", "state", "hum", "bees");
  return join(base, `${kind}.key`);
}

export function beeHid(kind, prefix) {
  const path = keyPath(kind);
  let seed;
  if (existsSync(path)) {
    seed = readFileSync(path);
    if (seed.length !== 32) throw new Error(`bee key ${path}: ${seed.length}`);
  } else {
    const der = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" });
    seed = Buffer.from(der.subarray(der.length - 32));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, seed, { mode: 0o600 });
  }
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  const jwk = createPublicKey(priv).export({ format: "jwk" });
  const pubRaw = Buffer.from(jwk.x, "base64url");
  return `${prefix}_` + createHash("sha256").update(pubRaw).digest("hex");
}
