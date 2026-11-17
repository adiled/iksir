/**
 * Al-Mumayyiz (المميّز) — the cupel between the murshidūn and al-Kimyawī.
 *
 * Every word a murshid sends him passes through it. A notice (mun_balligh)
 * is judged: dhahab goes on, khabath goes back with a terse word. A reply
 * (mun_radd) always goes on, refined to its gleam — names, numbers, links
 * and the ask kept exact; the rest burned away. The Taʿlīm beside
 * iksir.json tells the cupel what al-Kimyawī cares for and how he wants to
 * be spoken to. When the cupel cannot be heated, the word passes as it was.
 */

import { nazzifJson } from "../utils/strings.ts";
import { logger } from "../logging/logger.ts";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { Wasila } from "../hum/wasila.ts";

export interface Tamyiz {
  dhahab: boolean;
  sabab: string;
  radd: string | null;
  nass: string;
}

const qawalib = new Map<string, string>();

function qalib(ism: string): string {
  const mahfuz = qawalib.get(ism);
  if (mahfuz !== undefined) return mahfuz;
  const nass = readFileSync(join(new URL("../../prompts/", import.meta.url).pathname, `${ism}.md`), "utf-8");
  qawalib.set(ism, nass);
  return nass;
}

function sayyar(nass: string, kalimat: Record<string, string>): string {
  return nass.replace(/\{\{(\w+)\}\}/g, (_, k) => kalimat[k] ?? "");
}

async function isal(amil: Wasila, ism: string, kalimat: Record<string, string>): Promise<Record<string, unknown> | null> {
  try {
    const natija = await amil.mayyaza(sayyar(qalib(ism), kalimat));
    if (!natija.success || !natija.response) {
      await logger.haDHHir("mumayyiz", `The cupel gave no verdict (${ism}); the word passes as it was`, { error: natija.error });
      return null;
    }
    return JSON.parse(nazzifJson(natija.response)) as Record<string, unknown>;
  } catch (khata) {
    await logger.haDHHir("mumayyiz", `The cupel's verdict could not be read (${ism}); the word passes as it was`, { error: String(khata) });
    return null;
  }
}

export async function mayyazaTanbih(amil: Wasila, risala: string, talim: string): Promise<Tamyiz> {
  const hukm = await isal(amil, "mayyaza-tanbih", { talim, message: risala });
  if (!hukm) return { dhahab: true, sabab: "the cupel was cold", radd: null, nass: risala };
  const dhahab = hukm.tamyiz === "DHAHAB";
  return {
    dhahab,
    sabab: typeof hukm.reason === "string" ? hukm.reason : "Unknown",
    radd: dhahab ? null : (typeof hukm.rejection === "string" ? hukm.rejection : "Handle this autonomously."),
    nass: typeof hukm.nass === "string" && hukm.nass.trim() ? hukm.nass.trim() : risala,
  };
}

export async function saffaRadd(amil: Wasila, risala: string, talim: string): Promise<string> {
  const hukm = await isal(amil, "mayyaza-radd", { talim, message: risala });
  return typeof hukm?.nass === "string" && hukm.nass.trim() ? hukm.nass.trim() : risala;
}
