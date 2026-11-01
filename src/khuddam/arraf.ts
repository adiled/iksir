/**
 * Arraf (عرّاف) — The Diviner
 *
 * One of the sacred Khuddām (خدّام) of Iksīr.
 *
 * When a word arrives from al-Kimyawi, it arrives raw — a trembling utterance
 * still warm from the tongue. Arraf receives it. Arraf turns it over in the
 * light of the athanor, reads the hidden marks, consults the oracle when the
 * marks are faint, and returns a NiyyaMuhallala — the intent made clear,
 * the hidden made manifest.
 *
 * Three paths of divination:
 *   I.  Al-Qat'i (القطعي) — the certain: URLs and formula identifiers speak
 *       for themselves. No oracle needed. The mark is plain.
 *   II. Al-Fikri (الفكري) — the thoughtful: when words are vague, the oracle
 *       is summoned. It extracts the structured niyya from the flow of speech.
 *   III. Al-Bahth (البحث) — the search: armed with structured intent, Arraf
 *       searches the sijill al-wasfāt for the matching kiyan.
 *
 * Arraf does not execute. Arraf does not inscribe. Arraf only sees.
 */

import { nazzifJson } from "../utils/strings.ts";
import { logger } from "../logging/logger.ts";
import type { Wasila } from "../hum/wasila.ts";
import type { SiyaqMuhadatha } from "./munadi.ts";
import type { NawKiyan } from "../types.ts";
import type { SijillWasfat, Wasfa } from "../wasfa/sijill-wasfat.ts";

export type { NawKiyan } from "../types.ts";

export interface NiyyaMuhallala {
  hala: "muhallala" | "tahtajuTawdih" | "tahtajuTafkir" | "lam_tujad" | "khata" | "qaima";

  kiyan?: {
    naw: NawKiyan;
    huwiyya: string;
    unwan: string;
  };

  kitabAb?: {
    huwiyya: string;
    unwan: string;
  };

  murashshahun?: Array<{
    naw: NawKiyan;
    huwiyya: string;
    unwan: string;
    daraja: number;
  }>;

  nassKham: string;

  tariqa: "rabit" | "huwiyat_wasfa" | "bahth_fikri" | "bahth_hatmi";

  khata?: string;

  fil?: "taqaddam" | "istifsar" | "ilgha" | null;
}

interface NiyyaMustakhraja {
  nawKiyan: NawKiyan;
  kalimatBahth: string[];
  huwiyyatWasfa?: string;
  hala?: string | null;
  yushirIlaTarkiz?: boolean;
  fil?: "taqaddam" | "istifsar" | "ilgha" | null;
}

const KHATIM_HUWIYYAT_WASFA = /\b([A-Z]+-\d+)\b/i;

const KALIMAT_NAW: Record<NawKiyan, string[]> = {
  wasfa:    ["wasfa", "work", "task"],
  malhamat: ["malhamat", "epic"],
  majhul:   [],
};

export class Arraf {
  #wasfat: SijillWasfat;
  #amil: Wasila;
  #huwiyyatJalsatNiyya: string | null = null;

  constructor(deps: { wasfat: SijillWasfat; amil: Wasila }) {
    this.#wasfat = deps.wasfat;
    this.#amil = deps.amil;
  }

  async halla(text: string, context?: SiyaqMuhadatha): Promise<NiyyaMuhallala> {
    const nassKham = text.trim();

    const qatiyya = await this.jarrabHatmi(nassKham);
    if (qatiyya.hala === "muhallala" || qatiyya.hala === "tahtajuTawdih") {
      return qatiyya;
    }

    const talmihNaw = this.istakhrajTalmihNaw(nassKham);

    const niyyaMustakhraja = await this.istakhrajNiyyaBiLLM(nassKham, context);
    if (!niyyaMustakhraja) {
      return {
        hala: "khata",
        nassKham,
        tariqa: "bahth_fikri",
        khata: "الأوراق لم تُفصح — the oracle returned silence",
      };
    }

    if (niyyaMustakhraja.yushirIlaTarkiz && context?.focusEntity) {
      await logger.akhbar("arraf", "Tarkiz yushir — returning focus kiyan", {
        focusEntity: context.focusEntity.huwiyya,
        fil: niyyaMustakhraja.fil,
      });
      return {
        hala: "muhallala",
        kiyan: {
          naw: context.focusEntity.naw,
          huwiyya: context.focusEntity.huwiyya,
          unwan: context.focusEntity.unwan,
        },
        nassKham,
        tariqa: "bahth_fikri",
        fil: niyyaMustakhraja.fil,
      };
    }

    return await this.bahathaKiyanat(nassKham, niyyaMustakhraja, talmihNaw);
  }

  async jarrabHatmi(nassKham: string): Promise<NiyyaMuhallala> {
    const khatimMatch = nassKham.match(KHATIM_HUWIYYAT_WASFA);
    if (khatimMatch) {
      return await this.hallaHuwiyyatWasfa(nassKham, khatimMatch[1].toUpperCase());
    }

    return {
      hala: "tahtajuTafkir",
      nassKham,
      tariqa: "bahth_hatmi",
    };
  }

  async hallaHuwiyyatWasfa(nassKham: string, huwiyya: string): Promise<NiyyaMuhallala> {
    const wasfa = await this.#wasfat.iqra(huwiyya);

    if (!wasfa) {
      return {
        hala: "lam_tujad",
        nassKham,
        tariqa: "huwiyat_wasfa",
        khata: `الوصفة ${huwiyya} غير موجودة في السجل`,
      };
    }

    const niyyaMuhallala: NiyyaMuhallala = {
      hala: "muhallala",
      kiyan: {
        naw: this.#mayyazaNawWasfa(wasfa),
        huwiyya: wasfa.huwiyya,
        unwan: wasfa.unwan,
      },
      nassKham,
      tariqa: "huwiyat_wasfa",
    };

    if (wasfa.ab) {
      const ab = await this.#wasfat.iqra(wasfa.ab);
      if (ab) {
        niyyaMuhallala.kitabAb = { huwiyya: ab.huwiyya, unwan: ab.unwan };
      }
    }

    return niyyaMuhallala;
  }

  #mayyazaNawWasfa(wasfa: Wasfa): NawKiyan {
    const wasamat = wasfa.wasm ?? [];
    if (wasamat.some((w: string) => w.toLowerCase() === "epic")) {
      return "malhamat";
    }
    return "wasfa";
  }

  istakhrajTalmihNaw(nassKham: string): NawKiyan | null {
    const asfal = nassKham.toLowerCase();

    for (const [naw, kalimat] of Object.entries(KALIMAT_NAW)) {
      for (const kalima of kalimat) {
        if (asfal.includes(kalima)) {
          return naw as NawKiyan;
        }
      }
    }

    return null;
  }

  async istakhrajNiyyaBiLLM(nassKham: string, context?: SiyaqMuhadatha): Promise<NiyyaMustakhraja | null> {
    const jalsaId = await this.wajadaJalsatNiyya();
    if (!jalsaId) {
      await logger.sajjalKhata("arraf", "الجلسة لم توجد — oracle vessel unavailable");
      return null;
    }

    let siyaqNass = "";
    if (context && (context.focusEntity || context.recentMessages.length > 0)) {
      siyaqNass = "\n\nCONTEXT:";
      if (context.focusEntity) {
        siyaqNass += `\nFocus: ${context.focusEntity.huwiyya} - "${context.focusEntity.unwan}" (${context.focusEntity.naw})`;
      }
      if (context.recentMessages.length > 0) {
        siyaqNass += "\nRecent:";
        for (const risala of context.recentMessages.slice(-3)) {
          siyaqNass += `\n- "${risala.text}"`;
        }
      }
    }

    const talabOracle = `MESSAGE: "${nassKham}"${siyaqNass}`;

    const radd = await this.#amil.sendPrompt(jalsaId, talabOracle, {
      agent: "arraf-niyya",
      timeoutMs: 90_000,
    });

    if (!radd.success || !radd.response) {
      await logger.sajjalKhata("arraf", "الأوراق لم تُفصح — oracle extraction failed", { khata: radd.error });
      return null;
    }

    try {
      const jsonMatch = radd.response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        await logger.sajjalKhata("arraf", "لا رموز في رد الأوراق — no JSON in oracle response", {
          radd: radd.response,
        });
        return null;
      }

      const khamm = JSON.parse(nazzifJson(jsonMatch[0])) as Record<string, unknown>;

      const nawKiyanMap: Record<string, NawKiyan> = {
        wasfa: "wasfa", malhamat: "malhamat", majhul: "majhul",
      };
      const filMap: Record<string, NiyyaMustakhraja["fil"]> = {
        proceed: "taqaddam", query: "istifsar", cancel: "ilgha",
      };

      const niyya: NiyyaMustakhraja = {
        nawKiyan: nawKiyanMap[khamm.naw as string] ?? "majhul",
        kalimatBahth: (khamm.searchTerms as string[]) ?? [],
        huwiyyatWasfa: typeof khamm.huwiyya === "string" ? khamm.huwiyya.toUpperCase() : undefined,
        hala: typeof khamm.hala === "string" ? khamm.hala : null,
        yushirIlaTarkiz: Boolean(khamm.referencesFocus),
        fil: filMap[khamm.action as string] ?? null,
      };

      await logger.akhbar("arraf", "النية استُخرجت — intent extracted", { niyya });
      return niyya;
    } catch (khata) {
      await logger.sajjalKhata("arraf", "فشل تحليل رد الأوراق — failed to parse oracle response", {
        radd: radd.response,
        khata: String(khata),
      });
      return null;
    }
  }

  async wajadaJalsatNiyya(): Promise<string | null> {
    if (this.#huwiyyatJalsatNiyya) return this.#huwiyyatJalsatNiyya;

    const jalsa = await this.#amil.khalaqaJalsa(
      "iksir-arraf",
      "Arraf — vessel for divination (reusable)",
    );

    if (!jalsa) return null;

    this.#huwiyyatJalsatNiyya = jalsa.id;
    return jalsa.id;
  }

  async bahathaKiyanat(
    nassKham: string,
    niyya: NiyyaMustakhraja,
    talmihNaw: NawKiyan | null,
  ): Promise<NiyyaMuhallala> {
    const nawFaail = niyya.nawKiyan !== "majhul" ? niyya.nawKiyan : talmihNaw;
    const kalimatBahth = niyya.kalimatBahth.join(" ");
    const ladayhaMusaffiyat = Boolean(niyya.hala);

    if (!kalimatBahth && !niyya.huwiyyatWasfa && !ladayhaMusaffiyat) {
      return {
        hala: "lam_tujad",
        nassKham,
        tariqa: "bahth_fikri",
        khata: "لم تُستخرج كلمات بحث من الرسالة — no search terms extracted",
      };
    }

    if (niyya.huwiyyatWasfa) {
      return await this.hallaHuwiyyatWasfa(nassKham, niyya.huwiyyatWasfa);
    }

    const murashshahun: NiyyaMuhallala["murashshahun"] = [];

    if (ladayhaMusaffiyat) {
      const wasfatMusaffah = niyya.hala
        ? await this.#wasfat.bihala(niyya.hala, 15)
        : [];

      for (const wasfa of wasfatMusaffah) {
        murashshahun.push({
          naw: this.#mayyazaNawWasfa(wasfa),
          huwiyya: wasfa.huwiyya,
          unwan: wasfa.unwan,
          daraja: 1.0,
        });
      }
    } else {
      const wasfat = await this.#wasfat.bahath(kalimatBahth, 10);
      for (const wasfa of wasfat) {
        murashshahun.push({
          naw: this.#mayyazaNawWasfa(wasfa),
          huwiyya: wasfa.huwiyya,
          unwan: wasfa.unwan,
          daraja: this.hasabaDaraja(wasfa.unwan, niyya.kalimatBahth),
        });
      }
    }

    murashshahun.sort((a, b) => b.daraja - a.daraja);

    if (murashshahun.length === 0) {
      const wasf = ladayhaMusaffiyat ? "المسافيات المطلوبة" : `"${kalimatBahth}"`;
      return {
        hala: "lam_tujad",
        nassKham,
        tariqa: "bahth_fikri",
        khata: `لا ${nawFaail ?? "كيان"} يطابق ${wasf}`,
      };
    }

    if (ladayhaMusaffiyat) {
      return {
        hala: "qaima",
        murashshahun: murashshahun.slice(0, 15),
        nassKham,
        tariqa: "bahth_fikri",
      };
    }

    if (murashshahun.length === 1) {
      const murashshah = murashshahun[0];
      const niyyaMuhallala: NiyyaMuhallala = {
        hala: "muhallala",
        kiyan: {
          naw: murashshah.naw,
          huwiyya: murashshah.huwiyya,
          unwan: murashshah.unwan,
        },
        nassKham,
        tariqa: "bahth_fikri",
      };

      if (murashshah.naw === "wasfa" && murashshah.huwiyya) {
        const wasfa = await this.#wasfat.iqra(murashshah.huwiyya);
        if (wasfa?.ab) {
          const ab = await this.#wasfat.iqra(wasfa.ab);
          if (ab) {
            niyyaMuhallala.kitabAb = { huwiyya: ab.huwiyya, unwan: ab.unwan };
          }
        }
      }

      return niyyaMuhallala;
    }

    return {
      hala: "tahtajuTawdih",
      murashshahun: murashshahun.slice(0, 5),
      nassKham,
      tariqa: "bahth_fikri",
    };
  }

  hasabaDaraja(unwan: string, kalimat: string[]): number {
    const asfal = unwan.toLowerCase();
    let mutabiqa = 0;

    for (const kalima of kalimat) {
      if (asfal.includes(kalima.toLowerCase())) mutabiqa++;
    }

    return kalimat.length > 0 ? mutabiqa / kalimat.length : 0;
  }
}

export function istadaaArraf(deps: {
  wasfat: SijillWasfat;
  amil: Wasila;
}): Arraf {
  return new Arraf(deps);
}
