/**
 * The three khabath of a waṣfa, drawn from al-Kimyawī's roster.
 *
 * A waṣfa names where it is spoken of (majlis), where its jawhar is decanted
 * (kur) and which outer trackers it answers to (sijillat). Each is one or
 * more, and each must be in the roster; what the waṣfa does not name, it
 * takes from the roster whole. Nothing outside the roster is ever a forge,
 * a hall or a tracker for any waṣfa — that is how linear-server stops being
 * mistaken for the forge.
 */

import type { ThulathiKhabath } from "../types.ts";

export const ADWAR = ["majlis", "kur", "sijillat"] as const;
export type Dawr = (typeof ADWAR)[number];

export const WASF_DAWR: Record<Dawr, string> = {
  majlis: "where al-Kimyawī speaks of it",
  kur: "the forge where its jawhar is decanted",
  sijillat: "the outer trackers it answers to",
};

export class KhabathGharib extends Error {
  constructor(dawr: Dawr, ghuraba: string[], roster: string[]) {
    super(
      `${ghuraba.map((g) => `"${g}"`).join(", ")} ${ghuraba.length === 1 ? "is" : "are"} not a ${dawr} in your config` +
        (roster.length ? ` — the roster holds ${roster.join(", ")}` : ` — the roster is empty`),
    );
    this.name = "KhabathGharib";
  }
}

export function ikhtar(
  roster: ThulathiKhabath,
  mukhtar: Partial<ThulathiKhabath> | undefined,
  asl?: Partial<ThulathiKhabath>,
): ThulathiKhabath {
  const natija = {} as ThulathiKhabath;
  for (const dawr of ADWAR) {
    const talab = mukhtar?.[dawr];
    const qaim = talab ?? asl?.[dawr] ?? roster[dawr];
    const ghuraba = qaim.filter((k) => !roster[dawr].includes(k));
    if (ghuraba.length) throw new KhabathGharib(dawr, ghuraba, roster[dawr]);
    natija[dawr] = [...qaim];
  }
  return natija;
}

export function thulathiMin(wasfa: Partial<ThulathiKhabath>, roster: ThulathiKhabath): ThulathiKhabath {
  return {
    majlis: wasfa.majlis?.length ? wasfa.majlis : roster.majlis,
    kur: wasfa.kur?.length ? wasfa.kur : roster.kur,
    sijillat: wasfa.sijillat?.length ? wasfa.sijillat : roster.sijillat,
  };
}

export function kalimatKhabath(thulathi: ThulathiKhabath): Record<string, string> {
  return {
    majlis: thulathi.majlis.join(", "),
    kur: thulathi.kur.join(", "),
    sijillat: thulathi.sijillat.join(", "),
  };
}
