/**
 * Al-Tasmīm (التصميم) — iksir's configuration, alive.
 *
 * Two files in one directory ($XDG_CONFIG_HOME/iksir, or IKSIR_CONFIG_DIR):
 *
 *   iksir.json   settings — the khabath roster and each khabath's particulars,
 *                the register's mark, the model, the log threshold
 *   asrar        secrets — name=value, 0600; today only telegram.ramz
 *
 * Nothing else is read from the environment. Both files are read again the
 * moment they change: every consumer asks `now()` or `sirr()` at the moment
 * it acts, and a change on disk is a change in the daemon. Nothing restarts.
 *
 * Khabath (خبث) is every outer thing iksir touches, named by role:
 *   majlis    where al-Kimyawī speaks            (telegram)
 *   kur       the forge where jawhar is decanted  (github, gitlab, …)
 *   sijillat  outer trackers tickets come from    (github, linear, …)
 * Each role is a list; a waṣfa carries its own three, drawn from these.
 */

import { join } from "node:path";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { TasmimIksir, TasmimKhabath, MustawaSijill } from "./types.ts";
import { DEFAULT_NTFY_SERVER } from "./constants.ts";

const MILAF_TASMIM = "iksir.json";
const MILAF_ASRAR = "asrar";

export function masarAlTasmim(): string {
  if (process.env.IKSIR_CONFIG_DIR) return process.env.IKSIR_CONFIG_DIR;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/root";
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "iksir");
}

export function masarMilafAlAsrar(): string {
  return join(masarAlTasmim(), MILAF_ASRAR);
}

export function tasmimAsasi(): TasmimIksir {
  return {
    khabath: { majlis: [], kur: [], sijillat: [] },
    wasfat: {},
    hum: {},
    ahdaq: {},
  };
}

function shay(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

export function damaja(asl: Record<string, unknown>, fawq: Record<string, unknown>): Record<string, unknown> {
  const natija = { ...asl };
  for (const [miftah, qima] of Object.entries(fawq)) {
    if (qima === undefined) continue;
    const qadim = asl[miftah];
    natija[miftah] = shay(qima) && shay(qadim) ? damaja(qadim, qima) : qima;
  }
  return natija;
}

function qaima(x: unknown): string[] {
  if (Array.isArray(x)) return x.map(String).filter(Boolean);
  if (typeof x === "string") return x.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export function sawwa(kham: unknown): TasmimIksir {
  const parsed = shay(kham) ? kham : {};
  const dumija = damaja(tasmimAsasi() as unknown as Record<string, unknown>, parsed) as unknown as TasmimIksir;
  const kh = dumija.khabath as unknown as Record<string, unknown>;
  dumija.khabath = {
    ...(kh as object),
    majlis: qaima(kh.majlis),
    kur: qaima(kh.kur),
    sijillat: qaima(kh.sijillat),
  } as TasmimKhabath;
  return dumija;
}

export function tahaqqaq(tasmim: TasmimIksir): string[] {
  const shakawa: string[] = [];
  const kh = tasmim.khabath;
  if (!kh.majlis.length) shakawa.push("khabath.majlis is empty: iksir has no hall, al-Kimyawī cannot be heard");
  for (const ism of kh.majlis) {
    if (ism !== "telegram") shakawa.push(`majlis "${ism}": iksir has no hands for it; only telegram`);
  }
  if (kh.majlis.includes("telegram") && !kh.telegram?.muhadatha) {
    shakawa.push("khabath.telegram.muhadatha is unset: iksir does not know who al-Kimyawī is");
  }
  const mustawa = tasmim.ahdaq.mustawa;
  if (mustawa && !["debug", "info", "warn", "error"].includes(mustawa)) {
    shakawa.push(`ahdaq.mustawa "${mustawa}" is not debug, info, warn or error`);
  }
  return shakawa;
}

function iqraAsrar(nass: string): Map<string, string> {
  const asrar = new Map<string, string>();
  for (const satr of nass.split("\n")) {
    const s = satr.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i <= 0) continue;
    asrar.set(s.slice(0, i).trim(), s.slice(i + 1).trim());
  }
  return asrar;
}

function uktubAsrar(asrar: Map<string, string>): string {
  return [...asrar.entries()].map(([k, v]) => `${k}=${v}`).join("\n") + (asrar.size ? "\n" : "");
}

class Milaf<T> {
  #masar: string;
  #iqra: (nass: string) => T;
  #faragh: () => T;
  #akhirTaghyir = -1;
  #qima: T | null = null;

  constructor(masar: string, iqra: (nass: string) => T, faragh: () => T) {
    this.#masar = masar;
    this.#iqra = iqra;
    this.#faragh = faragh;
  }

  get masar(): string {
    return this.#masar;
  }

  insa(): void {
    this.#akhirTaghyir = -1;
  }

  now(): T {
    let taghyir = 0;
    try {
      taghyir = statSync(this.#masar).mtimeMs;
    } catch {
      taghyir = 0;
    }
    if (this.#qima !== null && taghyir === this.#akhirTaghyir) return this.#qima;
    this.#akhirTaghyir = taghyir;
    this.#qima = taghyir === 0 ? this.#faragh() : this.#iqra(readFileSync(this.#masar, "utf-8"));
    return this.#qima;
  }
}

export class Tasmim {
  #tasmim: Milaf<TasmimIksir>;
  #asrar: Milaf<Map<string, string>>;
  #dir: string;

  constructor(dir = masarAlTasmim()) {
    this.#dir = dir;
    this.#tasmim = new Milaf(join(dir, MILAF_TASMIM), (nass) => sawwa(JSON.parse(nass)), tasmimAsasi);
    this.#asrar = new Milaf(join(dir, MILAF_ASRAR), iqraAsrar, () => new Map());
  }

  get masar(): string {
    return this.#tasmim.masar;
  }

  now(): TasmimIksir {
    return this.#tasmim.now();
  }

  mawjud(): boolean {
    return existsSync(this.#tasmim.masar);
  }

  sirr(ism: string): string | undefined {
    return this.#asrar.now().get(ism);
  }

  asmaAsrar(): string[] {
    return [...this.#asrar.now().keys()];
  }

  khabath(): TasmimKhabath {
    return this.now().khabath;
  }

  namudhaj(): string | undefined {
    return this.now().hum.namudhaj;
  }

  mustawaAhdaq(): MustawaSijill | undefined {
    return this.now().ahdaq.mustawa;
  }

  ntfy(): { server: string; topic: string } | null {
    const n = this.now().khabath.ntfy;
    return n?.topic ? { server: n.server ?? DEFAULT_NTFY_SERVER, topic: n.topic } : null;
  }

  iqraKham(): Record<string, unknown> {
    try {
      const kham = JSON.parse(readFileSync(this.#tasmim.masar, "utf-8"));
      return shay(kham) ? kham : {};
    } catch {
      return {};
    }
  }

  uktub(kham: Record<string, unknown>): void {
    mkdirSync(this.#dir, { recursive: true });
    writeFileSync(this.#tasmim.masar, JSON.stringify(kham, null, 2) + "\n");
    this.#tasmim.insa();
  }

  dhabbit(masar: string, qima: unknown): void {
    const kham = this.iqraKham();
    const ajzaa = masar.split(".");
    let mawdi: Record<string, unknown> = kham;
    for (const juz of ajzaa.slice(0, -1)) {
      if (!shay(mawdi[juz])) mawdi[juz] = {};
      mawdi = mawdi[juz] as Record<string, unknown>;
    }
    const akhir = ajzaa[ajzaa.length - 1];
    if (qima === undefined) delete mawdi[akhir];
    else mawdi[akhir] = qima;
    this.uktub(kham);
  }

  iqraMasar(masar: string): unknown {
    let mawdi: unknown = this.now();
    for (const juz of masar.split(".")) {
      if (!shay(mawdi)) return undefined;
      mawdi = mawdi[juz];
    }
    return mawdi;
  }

  dhabbitSirr(ism: string, qima: string | undefined): void {
    const asrar = new Map(this.#asrar.now());
    if (qima === undefined) asrar.delete(ism);
    else asrar.set(ism, qima);
    mkdirSync(this.#dir, { recursive: true });
    writeFileSync(this.#asrar.masar, uktubAsrar(asrar), { mode: 0o600 });
    chmodSync(this.#asrar.masar, 0o600);
    this.#asrar.insa();
  }
}

export function qimaMinKalima(nass: string): unknown {
  try {
    return JSON.parse(nass);
  } catch {
    return nass.includes(",") ? nass.split(",").map((s) => s.trim()).filter(Boolean) : nass;
  }
}
