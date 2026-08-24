/**
 * Istidʿāʾ (استدعاء) — Summoning
 *
 * Iksīr is handed its matter; it does not go looking for a particular kind.
 * al-Kimyawī names a path, Iksīr calls `anshaa` upon it, and whatever comes
 * back must satisfy the shape or the workshop does not open.
 *
 * This is the only place a path from outside is followed, and it follows
 * exactly what it was given.
 */

import type { TasmimIksir } from "../types.ts";

/** What a summoned thing is handed when it is made. */
export interface SiyaqIstidaa {
  tasmim: TasmimIksir;
  warsha?: string;
  masar?: string;
}

/**
 * Summon one. The module must export `anshaa`.
 *
 * @param masar   where it lives
 * @param amal    the operations it must be able to perform
 */
export async function istadaa<T>(
  masar: string,
  siyaq: SiyaqIstidaa,
  amal: string[],
): Promise<T> {
  let wahda: Record<string, unknown>;
  try {
    wahda = await import(masar.startsWith(".") || masar.startsWith("/")
      ? `file://${masar.startsWith("/") ? masar : `${Deno.cwd()}/${masar.slice(2)}`}`
      : masar);
  } catch (khata) {
    throw new Error(`Nothing answers at ${masar}: ${String(khata)}`);
  }

  const anshaa = wahda.anshaa;
  if (typeof anshaa !== "function") {
    throw new Error(`${masar} exports no anshaa`);
  }

  const shay = anshaa(siyaq) as Record<string, unknown>;

  const naqis = amal.filter((a) => typeof shay[a] !== "function");
  if (naqis.length > 0) {
    throw new Error(`What ${masar} returned cannot: ${naqis.join(", ")}`);
  }

  return shay as T;
}

/** What a Hayūlā must be able to do. */
export const AMAL_HAYULA = [
  "dakhala",
  "waqif",
  "asas",
  "mudtarib",
  "jammada",
  "thabbata",
  "sahaba",
  "masafa",
  "istahala",
  "naqasha",
];

/** What a Faṣl must be able to do. */
export const AMAL_FASL = ["qaddama", "hala", "taaliqat", "thabit", "farq"];

/** What a Ṣafāʾ must be able to do. */
export const AMAL_SAFA = ["assa"];
