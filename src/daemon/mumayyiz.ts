/**
 * Mumayyiz (مميّز) — The Discerner
 *
 * Not all that arrives at al-Kimyawi's door is worthy of his gaze.
 * The Mumayyiz stands at the threshold, examines each offering —
 * each ishara, each sual — and performs tamyiz: the ancient assay.
 *
 * Heat the ore in the cupel. Watch the lead burn away.
 * What gleams is dhahab — gold, worthy of al-Kimyawi's attention.
 * What crumbles is khabath — dross, sent back to the murshid
 * with a terse word of guidance.
 *
 * The Mumayyiz carries two scrolls — the tamyiz incantation for
 * isharat and the tamyiz incantation for asila. These are loaded
 * from the prompts/ archive, with sacred fallbacks inscribed here
 * in case the scrolls are absent.
 */

import { logger } from "../logging/logger.ts";
import { join } from "jsr:@std/path";
import type { OpenCodeClient } from "../opencode/client.ts";
import type { MaalumatSual, TasnifSual } from "../types.ts";

function masarWakala(): string {
  return Deno.env.get("IKSIR_AGENTS_MD_PATH") ??
    join(Deno.env.get("HOME") ?? ".", ".config", "iksir", "AGENTS.md");
}

function masarAlMakhzan(): string {
  return Deno.env.get("IKSIR_REPO_PATH") ?? ".";
}


/**
 * Cached scrolls — loaded once, held in memory.
 * The teachings of al-Kimyawi, and the two tamyiz incantations.
 */
let muhtawaWakala: string | null = null;
let qalibTanbih: string | null = null;
let qalibSual: string | null = null;

async function hammalWakala(): Promise<string | null> {
  if (muhtawaWakala) return muhtawaWakala;
  try {
    muhtawaWakala = await Deno.readTextFile(masarWakala());
    return muhtawaWakala;
  } catch {
    await logger.haDHHir("mumayyiz", "التعاليم لم تُقرأ — AGENTS.md unavailable");
    return null;
  }
}

function masarQalib(envVar: string, defaultFilename: string): string {
  return Deno.env.get(envVar) ?? join(masarAlMakhzan(), "prompts", defaultFilename);
}

async function hammalQalib(
  envVar: string,
  defaultFilename: string,
  cached: string | null,
  fallback: string,
): Promise<string> {
  if (cached) return cached;
  const path = masarQalib(envVar, defaultFilename);
  try {
    const content = await Deno.readTextFile(path);
    await logger.akhbar("mumayyiz", `اللفافة حُمّلت — ${path}`);
    return content;
  } catch {
    await logger.akhbar("mumayyiz", `اللفافة غائبة — ${path} — using inscribed fallback`);
    return fallback;
  }
}

function sayyarQalib(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}


const QALID_IHTIYATI_TANBIH = `You are a gatekeeper protecting the intibah al-Kimyawi.

Al-Kimyawi handles:
- Business decisions and priorities
- Architecture boundaries (where features live, API surfaces)
- Political timing (when to disclose PRs, who to loop in)
- External blockers requiring human action (waiting on designer, other team, etc.)
- Milestone completions worth celebrating

Al-Kimyawi does NOT handle:
- Implementation details ("should I use pattern X or Y?")
- Self-answerable questions (check docs, precedents in codebase)
- Progress updates (starting ticket, tests passing - expected, not newsworthy)
- Debugging ("this test is failing")
- Learned helplessness ("I'm not sure what to do")

Reference guidelines the murshid should follow autonomously:
---
{{agentGuidelines}}
---

Murshid wants to send this message to al-Kimyawi:
---
{{message}}
---

Mayyiz this message:
- DHAHAB: Genuinely needs the intibah al-Kimyawi (architecture ambiguity, external blocker, political timing, milestone)
- KHABATH: Khabath - should be handled autonomously by murshid using specs, docs, and precedents

If KHABATH, provide a terse rejection (1-2 sentences) with specific guidance. Reference file paths when applicable.

Respond ONLY with valid JSON (no markdown, no explanation):
{"tamyiz": "DHAHAB" or "KHABATH", "reason": "brief explanation", "rejection": "terse guidance if KHABATH, null if DHAHAB"}`;

const QALID_IHTIYATI_SUAL = `You are a gatekeeper protecting the intibah al-Kimyawi.

Al-Kimyawi handles:
- Business decisions affecting scope, timeline, or resources
- Architecture boundaries (which module owns a feature, API surface design)
- Political timing (when to disclose PRs, who to involve in reviews)
- External blockers requiring human action (waiting on designer, other team)
- Tradeoffs that require human judgment (speed vs quality, now vs later)

Al-Kimyawi does NOT handle:
- Implementation details ("should I use pattern X or Y?")
- Self-answerable questions (check docs, precedents, existing code)
- Obvious choices (when one option is clearly better per guidelines)
- Progress confirmations ("should I proceed?")
- Debugging decisions ("which approach to try first?")

Reference guidelines the murshid should follow autonomously:
---
{{agentGuidelines}}
---

Murshid is asking this question:

Header: {{header}}
Question: {{question}}
Options:
{{options}}

Mayyiz this question:
- DHAHAB: Genuinely needs the hukm al-Kimyawi (business impact, architecture boundaries, political timing)
- KHABATH: Khabath - can be decided autonomously using specs, docs, precedents, or common sense

If KHABATH:
- Provide a terse rejection (1-2 sentences) with guidance
- Specify which option to auto-select (use exact label text, or "pick first" or "pick recommended")

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "tamyiz": "DHAHAB" or "KHABATH",
  "reason": "brief explanation",
  "rejection": "terse guidance if KHABATH, null if DHAHAB",
  "autoAnswer": "exact label of option to pick if KHABATH, null if DHAHAB"
}`;


interface NatijaTamyizTanbih {
  dhahab: boolean;
  sabab: string;
  radd: string | null;
}

/**
 * Assay an ishara — is it dhahab worthy of al-Kimyawi's gaze,
 * or khabath to be returned to the murshid?
 */
export async function mayyazaTanbih(
  opencode: OpenCodeClient,
  message: string,
): Promise<NatijaTamyizTanbih> {
  const md = await hammalWakala();
  if (!md) {
    return { dhahab: true, sabab: "التعاليم غائبة", radd: null };
  }

  qalibTanbih = await hammalQalib(
    "IKSIR_MAYYAZA_TANBIH_PROMPT",
    "mayyaza-tanbih.md",
    qalibTanbih,
    QALID_IHTIYATI_TANBIH,
  );

  const prompt = sayyarQalib(qalibTanbih, {
    agentGuidelines: md,
    message,
  });

  try {
    const result = await opencode.mayyaza(prompt);
    if (!result.success || !result.response) {
      await logger.haDHHir("mumayyiz", "تمييز الإشارة فشل — السماح بالمرور", {
        error: result.error,
      });
      return { dhahab: true, sabab: "فشل التمييز", radd: null };
    }

    const parsed = JSON.parse(result.response.trim());
    const isDhahab = parsed.tamyiz === "DHAHAB";
    return {
      dhahab: isDhahab,
      sabab: parsed.reason ?? "Unknown",
      radd: isDhahab ? null : (parsed.rejection ?? "Handle this autonomously."),
    };
  } catch (error) {
    await logger.haDHHir("mumayyiz", "خطأ في تمييز الإشارة — السماح بالمرور", {
      error: String(error),
    });
    return { dhahab: true, sabab: "خطأ في التمييز", radd: null };
  }
}


/**
 * Assay a sual — does it require al-Kimyawi's hukm,
 * or can the murshid answer it alone?
 */
export async function mayyazaSual(
  opencode: OpenCodeClient,
  question: MaalumatSual,
): Promise<TasnifSual> {
  const md = await hammalWakala();
  if (!md) {
    return { tamyiz: "DHAHAB", reason: "التعاليم غائبة", rejection: null, autoAnswer: null };
  }

  const optionsText = question.options
    .map((o) => `- ${o.label}: ${o.description}`)
    .join("\n");

  qalibSual = await hammalQalib(
    "IKSIR_MAYYAZA_SUAL_PROMPT",
    "mayyaza-sual.md",
    qalibSual,
    QALID_IHTIYATI_SUAL,
  );

  const prompt = sayyarQalib(qalibSual, {
    agentGuidelines: md,
    header: question.header,
    question: question.question,
    options: optionsText,
  });

  try {
    const result = await opencode.mayyaza(prompt);
    if (!result.success || !result.response) {
      await logger.haDHHir("mumayyiz", "تمييز السؤال فشل — السماح بالمرور", {
        error: result.error,
      });
      return { tamyiz: "DHAHAB", reason: "فشل التمييز", rejection: null, autoAnswer: null };
    }

    /** Strip stink world markdown wrapping if present */
    let jsonStr = result.response.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(jsonStr);

    /** Resolve shorthand auto-answers to actual option labels */
    let autoAnswer = parsed.autoAnswer;
    if (autoAnswer && parsed.tamyiz === "KHABATH") {
      if (autoAnswer.toLowerCase() === "pick recommended") {
        const rec = question.options.find((o) => o.label.includes("(Recommended)"));
        autoAnswer = rec?.label ?? question.options[0]?.label ?? null;
      } else if (autoAnswer.toLowerCase() === "pick first") {
        autoAnswer = question.options[0]?.label ?? null;
      }
    }

    return {
      tamyiz: parsed.tamyiz === "DHAHAB" ? "DHAHAB" : "KHABATH",
      reason: parsed.reason ?? "Unknown",
      rejection: parsed.tamyiz === "KHABATH" ? (parsed.rejection ?? "Handle autonomously.") : null,
      autoAnswer: parsed.tamyiz === "KHABATH" ? autoAnswer : null,
    };
  } catch (error) {
    await logger.haDHHir("mumayyiz", "خطأ في تمييز السؤال — السماح بالمرور", {
      error: String(error),
    });
    return { tamyiz: "DHAHAB", reason: "خطأ في التمييز", rejection: null, autoAnswer: null };
  }
}

/** Wipe the cached scrolls — for fahs only */
export function _masahaDhakira(): void {
  muhtawaWakala = null;
  qalibTanbih = null;
  qalibSual = null;
}
