/**
 * Al-Hijra (الهجرة) — the one move from the old shape to this one.
 *
 * Before 2.0 iksir read Telegram and the model from a .env beside its
 * source and named one khabath at wasfat.khabath. `install` runs this on
 * every install: what the old places hold and the new ones lack is carried
 * over — the token to asrar, the rest to iksir.json — and each move is said
 * aloud. What the new places already hold stands. A .env iksir understood
 * whole is removed; one with lines iksir does not know is left, and named.
 * On a machine with nothing old, this says nothing and touches nothing.
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { Tasmim } from "./config.ts";

const ILA_ASRAR: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: "telegram.ramz",
};

const ILA_TASMIM: Record<string, string> = {
  TELEGRAM_CHAT_ID: "khabath.telegram.muhadatha",
  TELEGRAM_GROUP_ID: "khabath.telegram.majmuua",
  TELEGRAM_DISPATCH_TOPIC_ID: "khabath.telegram.mawduuIrsal",
  TELEGRAM_PROXY: "khabath.telegram.proxy",
  NTFY_TOPIC: "khabath.ntfy.topic",
  IKSIR_HUM_MODEL: "hum.namudhaj",
  IKSIR_LOG_LEVEL: "ahdaq.mustawa",
};

const MAYYIT = new Set([
  "IKSIR_REPO_PATH",
  "IKSIR_LOG_DIR",
  "IKSIR_WORKSHOP_PATHS",
  "IKSIR_GIT_USER",
  "IKSIR_AGENTS_MD_PATH",
  "IKSIR_MAYYAZA_TANBIH_PROMPT",
  "HUM_THRUM_SOCK",
  "HUM_SOCKET",
]);

function iqraEnv(nass: string): Map<string, string> {
  const qiyam = new Map<string, string>();
  for (const satr of nass.split("\n")) {
    const s = satr.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i <= 0) continue;
    const qima = s.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (qima) qiyam.set(s.slice(0, i).trim(), qima);
  }
  return qiyam;
}

export function hajir(tasmim: Tasmim, masarEnv: string): string[] {
  const aqwal: string[] = [];

  const wasfat = tasmim.iqraKham().wasfat;
  const qadim = wasfat && typeof wasfat === "object" ? (wasfat as Record<string, unknown>).khabath : undefined;
  if (typeof qadim === "string" && qadim) {
    for (const dawr of ["kur", "sijillat"] as const) {
      if (tasmim.khabath()[dawr].length) continue;
      tasmim.dhabbit(`khabath.${dawr}`, [qadim]);
      aqwal.push(`wasfat.khabath "${qadim}" → khabath.${dawr}`);
    }
    tasmim.dhabbit("wasfat.khabath", undefined);
  }

  if (!existsSync(masarEnv)) return aqwal;
  const majhul: string[] = [];
  for (const [ism, qima] of iqraEnv(readFileSync(masarEnv, "utf-8"))) {
    if (ILA_ASRAR[ism]) {
      const sirr = ILA_ASRAR[ism];
      if (tasmim.sirr(sirr)) aqwal.push(`${ism}: asrar already holds ${sirr}; it stands`);
      else {
        tasmim.dhabbitSirr(sirr, qima);
        aqwal.push(`${ism} → asrar ${sirr}`);
      }
    } else if (ILA_TASMIM[ism]) {
      const masar = ILA_TASMIM[ism];
      if (tasmim.iqraMasar(masar) !== undefined) aqwal.push(`${ism}: ${masar} already set; it stands`);
      else {
        tasmim.dhabbit(masar, masar.endsWith("mawduuIrsal") ? Number(qima) : qima);
        aqwal.push(`${ism} → ${masar}`);
      }
    } else if (MAYYIT.has(ism)) aqwal.push(`${ism}: iksir no longer has it; dropped`);
    else majhul.push(ism);
  }

  const majlis = tasmim.khabath().majlis;
  if (tasmim.sirr("telegram.ramz") && !majlis.includes("telegram")) {
    tasmim.dhabbit("khabath.majlis", [...majlis, "telegram"]);
    aqwal.push(`khabath.majlis ← telegram`);
  }

  if (majhul.length) aqwal.push(`${masarEnv} kept: iksir does not know ${majhul.join(", ")}`);
  else {
    unlinkSync(masarEnv);
    aqwal.push(`${masarEnv} removed; everything in it now lives in ${tasmim.masar} and asrar`);
  }
  return aqwal;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  for (const qawl of hajir(new Tasmim(), process.argv[2] ?? ".env")) console.log(`hijra: ${qawl}`);
}
