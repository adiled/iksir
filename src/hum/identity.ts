/**
 * Huwiyyat an-Nahla (هوية النحلة) — The Bee's Identity
 *
 * Iksir presents itself at the nest under a name it cannot forge.
 * The name is drawn from a key sealed once and kept forever:
 * sha256 of an ed25519 public key, worn as `fbee_<hex>`.
 *
 * humd knows one bee from another by this mark alone. The thrum
 * client_id changes with every reconnection; the hid does not.
 * Should the mark be absent or malformed, humd cannot recognize
 * a returning bee — and every reconnection leaves behind a ghost
 * manifest, the tool count swelling by twenty-four each time until
 * the daemon is restarted.
 *
 * Mirrors hives/common/src/identity.rs byte-for-byte, so the seed
 * is portable across tongues.
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "jsr:@std/path";

/** PKCS#8 DER prefix for an ed25519 private key; the 32-byte seed follows. */
const BIDAYAT_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

/** The same path and raw format the Rust hives read. */
function masarMiftah(naw: string): string {
  const xdg = Deno.env.get("XDG_STATE_HOME");
  const base = xdg
    ? join(xdg, "hum", "bees")
    : join(Deno.env.get("HOME") ?? ".", ".local", "state", "hum", "bees");
  return join(base, `${naw}.key`);
}

/** Load — or mint and seal — the bee key, returning its `<prefix>_<hex>` hid. */
export function huwiyyatNahla(naw: string, sabiqa: "fbee" | "wbee"): string {
  const masar = masarMiftah(naw);
  let badhra: Buffer;

  if (existsSync(masar)) {
    badhra = readFileSync(masar);
    if (badhra.length !== 32) {
      throw new Error(`bee key ${masar} is ${badhra.length} bytes, expected 32`);
    }
  } else {
    const der = generateKeyPairSync("ed25519").privateKey.export({
      format: "der",
      type: "pkcs8",
    }) as Buffer;
    badhra = Buffer.from(der.subarray(der.length - 32));
    mkdirSync(dirname(masar), { recursive: true });
    writeFileSync(masar, badhra, { mode: 0o600 });
  }

  const sirri = createPrivateKey({
    key: Buffer.concat([BIDAYAT_PKCS8, badhra]),
    format: "der",
    type: "pkcs8",
  });
  const jwk = createPublicKey(sirri).export({ format: "jwk" }) as { x: string };
  const aam = Buffer.from(jwk.x, "base64url");

  return `${sabiqa}_` + createHash("sha256").update(aam).digest("hex");
}
