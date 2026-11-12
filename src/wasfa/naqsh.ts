/**
 * Al-Naqsh (النقش) — inscribing and altering a waṣfa in the Sijill.
 *
 * The Sijill is at hand, so this happens the moment the instrument is used,
 * and the instrument's answer is the deed itself — never a promise that
 * someone else will do it later. Whoever speaks — a murshid or ʿĀlim at
 * Dispatch — the three khabath are held to the roster: taken whole when
 * unsaid, narrowed when said, never widened.
 */

import type { Tasmim } from "../config.ts";
import type { NidaKhalqWasfa, NidaTajdidWasfa, ThulathiKhabath } from "../types.ts";
import type { SijillWasfat, Wasfa } from "./sijill-wasfat.ts";
import { ikhtar, KhabathGharib } from "./khabath.ts";

export interface Naqsh {
  wasfa: Wasfa | null;
  nass: string;
}

export async function inqush(wasfat: SijillWasfat, tasmim: Tasmim, call: NidaKhalqWasfa): Promise<Naqsh> {
  let thulathi: ThulathiKhabath;
  try {
    thulathi = ikhtar(tasmim.khabath(), { majlis: call.majlis, kur: call.kur, sijillat: call.sijillat });
  } catch (khata) {
    if (khata instanceof KhabathGharib) return { wasfa: null, nass: `Not inscribed: ${khata.message}.` };
    throw khata;
  }
  const wasfa = await wasfat.khalaq({
    huwiyya: call.huwiyya,
    unwan: call.unwan,
    matn: call.wasf,
    qadr: call.taqdir,
    hala: call.hala,
    wasm: call.wasamat,
    ab: call.huwiyyatAb,
    mayayir: call.mayayir,
    ...thulathi,
  });

  return {
    wasfa,
    nass: `Inscribed ${wasfa.huwiyya} — ${wasfa.unwan}.

**Condition:** ${wasfa.hala ?? "khaam"}
**Fire:** ${wasfa.mayayir?.length ? `${wasfa.mayayir.length} maʿāyīr` : "none declared — mun_safa cannot assay it until mun_jaddid_wasfa gives it one"}
**Majlis:** ${thulathi.majlis.join(", ") || "none"} · **Kūr:** ${thulathi.kur.join(", ") || "none"} · **Sijillāt:** ${thulathi.sijillat.join(", ") || "none"}

Bind it to others with mun_wadaa_alaqat.`,
  };
}

export async function addil(wasfat: SijillWasfat, tasmim: Tasmim, call: NidaTajdidWasfa): Promise<string> {
  const qaim = await wasfat.iqra(call.huwiyyatWasfa);
  if (!qaim) return `No waṣfa named ${call.huwiyyatWasfa} in the Sijill.`;

  const taghyir: Partial<Omit<Wasfa, "huwiyya">> = {};
  if (call.updates.unwan) taghyir.unwan = call.updates.unwan;
  if (call.updates.wasf) taghyir.matn = call.updates.wasf;
  if (call.updates.taqdir) taghyir.qadr = call.updates.taqdir;
  if (call.updates.hala) taghyir.hala = call.updates.hala;
  if (call.updates.mayayir) taghyir.mayayir = call.updates.mayayir;
  if (call.updates.majlis || call.updates.kur || call.updates.sijillat) {
    try {
      Object.assign(taghyir, ikhtar(tasmim.khabath(), {
        majlis: call.updates.majlis,
        kur: call.updates.kur,
        sijillat: call.updates.sijillat,
      }, qaim));
    } catch (khata) {
      if (khata instanceof KhabathGharib) return `Not altered: ${khata.message}.`;
      throw khata;
    }
  }

  await wasfat.jaddid(qaim.huwiyya, taghyir);

  const majalat = Object.entries(call.updates).filter(([, v]) => v !== undefined).map(([k]) => k);
  return `Altered ${call.huwiyyatWasfa}: ${majalat.join(", ")}.`;
}
