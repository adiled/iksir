/**
 * Arraf (عرّاف) — The Diviner
 *
 * One of the sacred Khuddām (خدّام) of the alchemical workshop.
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

import { logger } from "../logging/logger.ts";
import type { OpenCodeClient } from "../opencode/client.ts";
import type { SiyaqMuhadatha } from "./munadi.ts";
import type { MutabiWasfa, NawKiyan, WasfaMutaba } from "../types.ts";


/** Re-export NawKiyan for those who summon through arraf */
export type { NawKiyan } from "../types.ts";

/**
 * NiyyaMuhallala — The Resolved Intent
 *
 * What Arraf returns after the divination is complete.
 * The raw utterance has been transmuted into knowledge.
 */
export interface NiyyaMuhallala {
  /** The state of divination */
  hala: "muhallala" | "tahtajuTawdih" | "tahtajuTafkir" | "lam_tujad" | "khata" | "qaima";

  /** The identified kiyan, if the divination succeeded */
  kiyan?: {
    naw: NawKiyan;
    id: string;
    huwiyya?: string;
    unwan: string;
    url: string;
  };

  /** The parent malhamat, if the kiyan is a child wasfa */
  kitabAb?: {
    id: string;
    huwiyya: string;
    unwan: string;
    url: string;
  };

  /** Multiple kiyānat requiring al-Kimyawi to choose */
  murashshahun?: Array<{
    naw: NawKiyan;
    id: string;
    huwiyya?: string;
    unwan: string;
    url: string;
    daraja: number;
  }>;

  /** The original utterance, untouched */
  nassKham: string;

  /** The path taken to reach this divination */
  tariqa: "rabit" | "huwiyat_wasfa" | "bahth_fikri" | "bahth_hatmi";

  /** The wound in the divination, if hala is khata */
  khata?: string;

  /** The fil al-Kimyawi intends, if discernible */
  fil?: "taqaddam" | "istifsar" | "ilgha" | null;
}

/**
 * NiyyaMustakhraja — The Extracted Intent
 *
 * The structured form that the oracle returns from the raw utterance.
 * A bridge between the spoken word and the searchable sijill.
 */
interface NiyyaMustakhraja {
  nawKiyan: NawKiyan;
  kalimatBahth: string[];
  huwiyyatWasfa?: string;
  talmiMashru?: string;
  talmiMarhala?: string;
  mukalaf?: "me" | null;
  hala?: "todo" | "in_progress" | "done" | "backlog" | null;
  dawra?: "current" | "next" | null;
  yushirIlaTarkiz?: boolean;
  fil?: "taqaddam" | "istifsar" | "ilgha" | null;
}


/** The seal of a formula identifier — e.g. TEAM-1234 */
const KHATIM_HUWIYYAT_WASFA = /\b([A-Z]+-\d+)\b/i;

/** Words that betray the naw of the kiyan sought */
const KALIMAT_NAW: Record<NawKiyan, string[]> = {
  wasfa:    ["ticket", "issue", "wasfa"],
  malhamat: ["epic", "malhamat"],
  marhala:  ["milestone", "sprint", "cycle", "marhala"],
  mashru:   ["project", "mashru"],
  majhul:   [],
};


export class Arraf {
  #mutabiWasfa: MutabiWasfa;
  #opencode: OpenCodeClient;
  #huwiyyatJalsatNiyya: string | null = null;

  constructor(deps: { mutabiWasfa: MutabiWasfa; opencode: OpenCodeClient }) {
    this.#mutabiWasfa = deps.mutabiWasfa;
    this.#opencode = deps.opencode;
  }

  /**
   * Halla — the act of divination
   *
   * Receive the raw utterance. Return the NiyyaMuhallala.
   * Three paths, tried in order of certainty.
   */
  async halla(text: string, context?: SiyaqMuhadatha): Promise<NiyyaMuhallala> {
    const nassKham = text.trim();

    /** Path I — Al-Qat'i: the mark is plain */
    const qatiyya = await this.jarrabHatmi(nassKham);
    if (qatiyya.hala === "muhallala" || qatiyya.hala === "tahtajuTawdih") {
      return qatiyya;
    }

    /** Extract naw hint from keywords before summoning the oracle */
    const talmihNaw = this.istakhrajTalmihNaw(nassKham);

    /** Path II — Al-Fikri: summon the oracle */
    const niyyaMustakhraja = await this.istakhrajNiyyaBiLLM(nassKham, context);
    if (!niyyaMustakhraja) {
      return {
        hala: "khata",
        nassKham,
        tariqa: "bahth_fikri",
        khata: "الأوراق لم تُفصح — the oracle returned silence",
      };
    }

    /** If the oracle sees a reference to the focus kiyan, return it directly */
    if (niyyaMustakhraja.yushirIlaTarkiz && context?.focusEntity) {
      await logger.akhbar("arraf", "Tarkiz yushir — returning focus kiyan", {
        focusEntity: context.focusEntity.huwiyya,
        fil: niyyaMustakhraja.fil,
      });
      return {
        hala: "muhallala",
        kiyan: {
          naw: context.focusEntity.naw,
          id: context.focusEntity.id,
          huwiyya: context.focusEntity.huwiyya,
          unwan: context.focusEntity.unwan,
          url: context.focusEntity.url,
        },
        nassKham,
        tariqa: "bahth_fikri",
        fil: niyyaMustakhraja.fil,
      };
    }

    /** Path III — Al-Bahth: search the sijill */
    return await this.bahathaKiyanat(nassKham, niyyaMustakhraja, talmihNaw);
  }

  /**
   * Al-Qat'i — the certain path
   *
   * If the utterance contains a URL or a formula seal,
   * the kiyan is known without consultation.
   */
  async jarrabHatmi(nassKham: string): Promise<NiyyaMuhallala> {
    /** A URL speaks its own identity */
    const urlMatch = nassKham.match(this.#mutabiWasfa.getUrlPattern());
    if (urlMatch) {
      const parsed = this.#mutabiWasfa.parseUrl(urlMatch[0]);
      if (parsed) {
        return await this.hallaMinRabit(nassKham, parsed, urlMatch[0]);
      }
    }

    /** A formula seal is equally unambiguous */
    const khatimMatch = nassKham.match(KHATIM_HUWIYYAT_WASFA);
    if (khatimMatch) {
      return await this.hallaHuwiyyatWasfa(nassKham, khatimMatch[1].toUpperCase());
    }

    /** The marks are faint — the oracle must be summoned */
    return {
      hala: "tahtajuTafkir",
      nassKham,
      tariqa: "bahth_hatmi",
    };
  }

  /**
   * Halla from a parsed URL — the rabit reveals its kiyan
   */
  async hallaMinRabit(
    nassKham: string,
    parsed: { naw: string; id: string },
    url: string,
  ): Promise<NiyyaMuhallala> {
    if (parsed.naw === "wasfa") {
      return await this.hallaHuwiyyatWasfa(nassKham, parsed.id);
    }

    if (parsed.naw === "mashru") {
      const mashru = await this.#mutabiWasfa.getProject(parsed.id);
      if (mashru) {
        return {
          hala: "muhallala",
          kiyan: {
            naw: "mashru",
            id: mashru.id,
            unwan: mashru.name,
            url: mashru.url ?? "",
          },
          nassKham,
          tariqa: "rabit",
        };
      }
    }

    return {
      hala: "lam_tujad",
      nassKham,
      tariqa: "rabit",
      khata: `لا يوجد كيان في هذا الرابط — ${url}`,
    };
  }

  /**
   * Halla from a formula identifier — e.g. "TEAM-200"
   * The seal is read. The sijill is consulted.
   */
  async hallaHuwiyyatWasfa(nassKham: string, huwiyya: string): Promise<NiyyaMuhallala> {
    const wasfa = await this.#mutabiWasfa.getIssue(huwiyya);

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
        id: wasfa.id,
        huwiyya: wasfa.identifier,
        unwan: wasfa.title,
        url: wasfa.url ?? "",
      },
      nassKham,
      tariqa: "huwiyat_wasfa",
    };

    /** If the wasfa has a parent, reveal the malhamat above it */
    if (wasfa.parent) {
      const ab = await this.#mutabiWasfa.getIssue(wasfa.parent.identifier);
      if (ab) {
        niyyaMuhallala.kitabAb = {
          id: ab.id,
          huwiyya: ab.identifier,
          unwan: ab.title,
          url: ab.url ?? "",
        };
      }
    }

    return niyyaMuhallala;
  }

  /**
   * Read the naw of a wasfa from its labels.
   * A wasfa bearing the seal "epic" is a malhamat.
   */
  #mayyazaNawWasfa(wasfa: WasfaMutaba): NawKiyan {
    const wasamat = wasfa.labels ?? [];
    if (wasamat.some((w) => w.toLowerCase() === "epic")) {
      return "malhamat";
    }
    return "wasfa";
  }

  /**
   * Read the keywords in the utterance for a naw hint.
   * Mere suggestion — the oracle may disagree.
   */
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

  /**
   * The oracle's standing incantation — stable across calls, benefits from caching.
   *
   * The wire format is in the tongue of the stink world — the LLM speaks English.
   * But the name of this incantation is sacred.
   */
  static readonly TAWJIHAT_NIZAM_NIYYA = `You are a JSON extraction tool for project management. Return ONLY valid JSON, no explanations.

Output format:
{
  "entityType": "ticket" | "epic" | "milestone" | "project" | "unknown",
  "searchTerms": ["term1", "term2"],
  "huwiyyatWasfa": "TEAM-1234" or null,
  "projectHint": "project name" or null,
  "milestoneHint": "milestone name" or null,
  "assignee": "me" or null,
  "status": "todo" | "in_progress" | "done" | "backlog" or null,
  "cycle": "current" | "next" or null,
  "referencesFocus": true or false,
  "action": "proceed" | "query" | "cancel" or null
}

Rules:
- entityType: What type of entity they're referring to
- searchTerms: Keywords to search for (exclude common words like "the", "work on", "assigned", "my", "find", "start", "need", etc.)
- huwiyyatWasfa: Only if they mentioned a specific formula ID like "TEAM-1234"
- projectHint: If they mentioned "in project X" or "the X project"
- milestoneHint: If they mentioned "in milestone Y" or "the Y milestone/sprint"
- assignee: "me" if they said "my tickets", "assigned to me", "my tasks", etc.
- status: "todo" for unstarted/todo, "in_progress" for active, "done" for completed, "backlog" for backlog
- cycle: "current" for current cycle/sprint, "next" for next cycle/sprint
- referencesFocus: TRUE only if clearly referring to a previously discussed entity ("ok", "yes", "go", "work on it", "that one", "proceed"). FALSE for new searches.
- action: "proceed" to start work on focus entity, "query" to ask about it, "cancel" to cancel, null otherwise

Examples:
- "the upsells milestone" → {"entityType":"milestone","searchTerms":["upsells"],"huwiyyatWasfa":null,"projectHint":null,"milestoneHint":"upsells","assignee":null,"status":null,"cycle":null,"referencesFocus":false,"action":null}
- "TEAM-200" → {"entityType":"ticket","searchTerms":[],"huwiyyatWasfa":"TEAM-200","projectHint":null,"milestoneHint":null,"assignee":null,"status":null,"cycle":null,"referencesFocus":false,"action":null}
- "ok" (with focus) → {"entityType":"unknown","searchTerms":[],"huwiyyatWasfa":null,"projectHint":null,"milestoneHint":null,"assignee":null,"status":null,"cycle":null,"referencesFocus":true,"action":"proceed"}
- "my todo tickets in current cycle" → {"entityType":"ticket","searchTerms":[],"huwiyyatWasfa":null,"projectHint":null,"milestoneHint":null,"assignee":"me","status":"todo","cycle":"current","referencesFocus":false,"action":null}`;

  /**
   * Summon the oracle to extract structured niyya from the utterance.
   *
   * The oracle is given a standing vessel — reused across divinations
   * for warmth and efficiency. If the vessel has gone cold, a new one is lit.
   */
  async istakhrajNiyyaBiLLM(nassKham: string, context?: SiyaqMuhadatha): Promise<NiyyaMustakhraja | null> {
    const jalsaId = await this.wajadaJalsatNiyya();
    if (!jalsaId) {
      await logger.sajjalKhata("arraf", "الجلسة لم توجد — oracle vessel unavailable");
      return null;
    }

    /** Weave context into the utterance if present */
    let siyaqNass = "";
    if (context && (context.focusEntity || context.recentMessages.length > 0)) {
      siyaqNass = "\n\nCONTEXT:";
      if (context.focusEntity) {
        siyaqNass += `\nFocus: ${context.focusEntity.huwiyya ?? context.focusEntity.id} - "${context.focusEntity.unwan}" (${context.focusEntity.naw})`;
      }
      if (context.recentMessages.length > 0) {
        siyaqNass += "\nRecent:";
        for (const risala of context.recentMessages.slice(-3)) {
          siyaqNass += `\n- "${risala.text}"`;
        }
      }
    }

    const talabOracle = `TASK: Extract intent as JSON. Return ONLY the JSON object, nothing else. No explanation, no markdown, no code blocks.

MESSAGE: "${nassKham}"${siyaqNass}

${Arraf.TAWJIHAT_NIZAM_NIYYA}`;

    const radd = await this.#opencode.sendPrompt(jalsaId, talabOracle, {
      system: Arraf.TAWJIHAT_NIZAM_NIYYA,
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      timeoutMs: 15_000,
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

      /** Translate stink world oracle response into sacred NiyyaMustakhraja */
      const khamm = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      const nawKiyanMap: Record<string, NawKiyan> = {
        ticket: "wasfa", epic: "malhamat", milestone: "marhala",
        project: "mashru", unknown: "majhul",
      };
      const filMap: Record<string, NiyyaMustakhraja["fil"]> = {
        proceed: "taqaddam", query: "istifsar", cancel: "ilgha",
      };

      const niyya: NiyyaMustakhraja = {
        nawKiyan: nawKiyanMap[khamm.entityType as string] ?? "majhul",
        kalimatBahth: (khamm.searchTerms as string[]) ?? [],
        huwiyyatWasfa: (khamm.huwiyyatWasfa as string) ?? undefined,
        talmiMashru: (khamm.projectHint as string) ?? undefined,
        talmiMarhala: (khamm.milestoneHint as string) ?? undefined,
        mukalaf: khamm.assignee === "me" ? "me" : null,
        hala: (khamm.status as NiyyaMustakhraja["hala"]) ?? null,
        dawra: (khamm.cycle as NiyyaMustakhraja["dawra"]) ?? null,
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

  /**
   * The oracle's vessel — a reusable jalsa for all divinations.
   * If the vessel has gone cold it is relit.
   */
  async wajadaJalsatNiyya(): Promise<string | null> {
    if (this.#huwiyyatJalsatNiyya) {
      const jalsa = await this.#opencode.jalabJalsa(this.#huwiyyatJalsatNiyya);
      if (jalsa) return this.#huwiyyatJalsatNiyya;
      this.#huwiyyatJalsatNiyya = null;
    }

    const jalsa = await this.#opencode.khalaqaJalsa(
      "iksir-arraf",
      "Arraf — vessel for divination (reusable)",
    );

    if (!jalsa) return null;

    this.#huwiyyatJalsatNiyya = jalsa.id;
    return jalsa.id;
  }

  /**
   * Al-Bahth — search the sijill al-wasfāt for the matching kiyan.
   *
   * Armed with the NiyyaMustakhraja from the oracle, Arraf queries
   * the issue tracker and returns candidates for consideration.
   */
  async bahathaKiyanat(
    nassKham: string,
    niyya: NiyyaMustakhraja,
    talmihNaw: NawKiyan | null,
  ): Promise<NiyyaMuhallala> {
    const nawFaail = niyya.nawKiyan !== "majhul" ? niyya.nawKiyan : talmihNaw;
    const kalimatBahth = niyya.kalimatBahth.join(" ");
    const ladayhaMusaffiyat = niyya.mukalaf || niyya.hala || niyya.dawra;

    if (!kalimatBahth && !niyya.huwiyyatWasfa && !ladayhaMusaffiyat) {
      return {
        hala: "lam_tujad",
        nassKham,
        tariqa: "bahth_fikri",
        khata: "لم تُستخرج كلمات بحث من الرسالة — no search terms extracted",
      };
    }

    /** If a formula seal was extracted, resolve directly */
    if (niyya.huwiyyatWasfa) {
      return await this.hallaHuwiyyatWasfa(nassKham, niyya.huwiyyatWasfa);
    }

    /** Gather murashshahun */
    const murashshahun: NiyyaMuhallala["murashshahun"] = [];

    if (ladayhaMusaffiyat) {
      /** Filtered search — musaffiyat override text search */
      let dawraId: string | undefined;
      if (niyya.dawra === "current") {
        const marhalaNashita = await this.#mutabiWasfa.getActiveMilestone?.();
        if (marhalaNashita) {
          dawraId = marhalaNashita.id;
          await logger.akhbar("arraf", `مرحلة نشطة — ${marhalaNashita.name}`);
        } else {
          await logger.haDHHir("arraf", "لا مرحلة نشطة — no active milestone");
        }
      }

      const wasfatMusaffah = await this.#mutabiWasfa.getFilteredIssues?.({
        assigneeId: niyya.mukalaf === "me" ? "me" : undefined,
        status: niyya.hala ?? undefined,
        cycleId: dawraId,
      }, 15) ?? [];

      for (const wasfa of wasfatMusaffah) {
        murashshahun.push({
          naw: this.#mayyazaNawWasfa(wasfa),
          id: wasfa.id,
          huwiyya: wasfa.identifier,
          unwan: wasfa.title,
          url: wasfa.url ?? "",
          daraja: 1.0,
        });
      }
    } else {
      /** Text-based search */
      const wasfat = await this.#mutabiWasfa.searchIssues(kalimatBahth, 10);
      for (const wasfa of wasfat) {
        murashshahun.push({
          naw: this.#mayyazaNawWasfa(wasfa),
          id: wasfa.id,
          huwiyya: wasfa.identifier,
          unwan: wasfa.title,
          url: wasfa.url ?? "",
          daraja: this.hasabaDaraja(wasfa.title, niyya.kalimatBahth),
        });
      }
    }

    /** Search marahim if naw permits */
    if (!ladayhaMusaffiyat && (nawFaail === "marhala" || !nawFaail)) {
      const marahim = await this.bahathaMarahim(kalimatBahth);
      murashshahun.push(...marahim);
    }

    /** Search mashari if naw permits */
    if (!ladayhaMusaffiyat && (nawFaail === "mashru" || !nawFaail)) {
      const mashari = await this.#mutabiWasfa.searchProjects(kalimatBahth);
      for (const mashru of mashari) {
        murashshahun.push({
          naw: "mashru",
          id: mashru.id,
          unwan: mashru.name,
          url: mashru.url ?? "",
          daraja: this.hasabaDaraja(mashru.name, niyya.kalimatBahth),
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

    /** Filtered results are presented as a qaima for al-Kimyawi to browse */
    if (ladayhaMusaffiyat) {
      return {
        hala: "qaima",
        murashshahun: murashshahun.slice(0, 15),
        nassKham,
        tariqa: "bahth_fikri",
      };
    }

    /** Single match — the divination is complete */
    if (murashshahun.length === 1) {
      const murashshah = murashshahun[0];
      const niyyaMuhallala: NiyyaMuhallala = {
        hala: "muhallala",
        kiyan: {
          naw: murashshah.naw,
          id: murashshah.id,
          huwiyya: murashshah.huwiyya,
          unwan: murashshah.unwan,
          url: murashshah.url,
        },
        nassKham,
        tariqa: "bahth_fikri",
      };

      /** Reveal the parent malhamat if this is a child wasfa */
      if (murashshah.naw === "wasfa" && murashshah.huwiyya) {
        const wasfa = await this.#mutabiWasfa.getIssue(murashshah.huwiyya);
        if (wasfa?.parent) {
          const ab = await this.#mutabiWasfa.getIssue(wasfa.parent.identifier);
          if (ab) {
            niyyaMuhallala.kitabAb = {
              id: ab.id,
              huwiyya: ab.identifier,
              unwan: ab.title,
              url: ab.url ?? "",
            };
          }
        }
      }

      return niyyaMuhallala;
    }

    /** Multiple matches — al-Kimyawi must choose */
    return {
      hala: "tahtajuTawdih",
      murashshahun: murashshahun.slice(0, 5),
      nassKham,
      tariqa: "bahth_fikri",
    };
  }

  /**
   * Search the marahim (milestones) of the sijill
   */
  async bahathaMarahim(bahth: string): Promise<NonNullable<NiyyaMuhallala["murashshahun"]>> {
    const marahim = await this.#mutabiWasfa.searchMilestones?.(bahth);
    if (!marahim || marahim.length === 0) return [];

    return marahim.map((m) => ({
      naw: "marhala" as const,
      id: m.id,
      unwan: m.name,
      url: m.url ?? "",
      daraja: this.hasabaDaraja(m.name, bahth.split(" ")),
    }));
  }

  /**
   * Calculate the daraja (degree of relevance) of a title against search terms
   */
  hasabaDaraja(unwan: string, kalimat: string[]): number {
    const asfal = unwan.toLowerCase();
    let mutabiqa = 0;

    for (const kalima of kalimat) {
      if (asfal.includes(kalima.toLowerCase())) mutabiqa++;
    }

    return kalimat.length > 0 ? mutabiqa / kalimat.length : 0;
  }
}

/**
 * Summon an Arraf — light the vessel, bind the spirit
 */
export function istadaaArraf(deps: {
  mutabiWasfa: MutabiWasfa;
  opencode: OpenCodeClient;
}): Arraf {
  return new Arraf(deps);
}
