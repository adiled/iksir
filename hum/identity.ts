import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const QALIB_MIFTAH = Buffer.from("302e020100300506032b657004220420", "hex");

function masar_miftah(kind: string): string {
  const base = process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, "hum", "bees")
    : join(homedir(), ".local", "state", "hum", "bees");
  return join(base, `${kind}.key`);
}

export function beeHid(kind: string, prefix: "fbee" | "wbee"): string {
  const path = masar_miftah(kind);
  let seed: Buffer;
  if (existsSync(path)) {
    seed = readFileSync(path);
    if (seed.length !== 32) throw new Error(`miftah ${path}: ${seed.length}`);
  } else {
    const der = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
    seed = Buffer.from(der.subarray(der.length - 32));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, seed, { mode: 0o600 });
  }
  const priv = createPrivateKey({ key: Buffer.concat([QALIB_MIFTAH, seed]), format: "der", type: "pkcs8" });
  const jwk = createPublicKey(priv).export({ format: "jwk" }) as { x: string };
  const pubRaw = Buffer.from(jwk.x, "base64url");
  return `${prefix}_` + createHash("sha256").update(pubRaw).digest("hex");
}
