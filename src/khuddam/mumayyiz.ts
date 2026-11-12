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
 * The Mumayyiz reads the Ta'lim (AGENTS.md beside iksir.json) and the
 * tamyiz incantation from prompts/, with a fallback inscribed here in
 * case the scroll is absent.
 */

import { nazzifJson } from "../utils/strings.ts";
import { logger } from "../logging/logger.ts";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { Wasila } from "../hum/wasila.ts";
import type { TaqyimTaaliq } from "../types.ts";
import { masarAlTasmim } from "../config.ts";

function masarWakala(): string {
  return join(masarAlTasmim(), "AGENTS.md");
}

function masarAlRuqan(): string {
  return new URL("../../prompts/", import.meta.url).pathname;
}

let muhtawaWakala: string | null = null;
let qalibTanbih: string | null = null;

async function hammalWakala(): Promise<string | null> {
  if (muhtawaWakala) return muhtawaWakala;
  try {
    muhtawaWakala = readFileSync(masarWakala(), "utf-8");
    return muhtawaWakala;
  } catch {
    await logger.haDHHir("mumayyiz", "التعاليم لم تُقرأ — AGENTS.md unavailable");
    return null;
  }
}

async function hammalQalib(
  defaultFilename: string,
  cached: string | null,
  fallback: string,
): Promise<string> {
  if (cached) return cached;
  const path = join(masarAlRuqan(), defaultFilename);
  try {
    const content = readFileSync(path, "utf-8");
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
- Progress updates (starting the waṣfa, tests passing - expected, not newsworthy)
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

interface NatijaTamyizTanbih {
  dhahab: boolean;
  sabab: string;
  radd: string | null;
}

export async function mayyazaTanbih(
  amil: Wasila,
  message: string,
): Promise<NatijaTamyizTanbih> {
  const md = await hammalWakala();
  if (!md) {
    return { dhahab: true, sabab: "التعاليم غائبة", radd: null };
  }

  qalibTanbih = await hammalQalib(
    "mayyaza-tanbih.md",
    qalibTanbih,
    QALID_IHTIYATI_TANBIH,
  );

  const prompt = sayyarQalib(qalibTanbih, {
    agentGuidelines: md,
    message,
  });

  try {
    const result = await amil.mayyaza(prompt);
    if (!result.success || !result.response) {
      await logger.haDHHir("mumayyiz", "تمييز الإشارة فشل — السماح بالمرور", {
        error: result.error,
      });
      return { dhahab: true, sabab: "فشل التمييز", radd: null };
    }

    const parsed = JSON.parse(nazzifJson(result.response));
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

export function _masahaDhakira(): void {
  muhtawaWakala = null;
  qalibTanbih = null;
}

export function mayyazaTaaliq(nass: string, minAlKimyawi: boolean): TaqyimTaaliq {
  const lowerBody = nass.toLowerCase().trim();

  const commandPatterns = [
    /^(fix|update|change|remove|add|refactor|revert)\s/i,
    /^please\s+(fix|update|change|remove|add)/i,
    /\bshould\s+be\b/i,
    /\bmust\s+(be|have|include)\b/i,
  ];

  const isCommand = commandPatterns.some((p) => p.test(lowerBody));
  if (isCommand) {
    return {
      isCommand: true,
      intent: "command",
      confidence: minAlKimyawi ? 1.0 : 0.7,
      reasoning: minAlKimyawi
        ? "Al-Kimyawi command on PR — execute immediately"
        : "Detected imperative language pattern",
    };
  }

  if (minAlKimyawi) {
    return {
      isCommand: false,
      intent: "neutral",
      confidence: 1,
      reasoning: "Non-command comment from al-Kimyawi",
    };
  }

  if (nass.includes("?")) {
    return {
      isCommand: false,
      intent: "question",
      confidence: 0.8,
      reasoning: "Contains question mark",
    };
  }

  const praisePatterns = [/\b(lgtm|looks good|nice|great|awesome|perfect)\b/i];
  if (praisePatterns.some((p) => p.test(lowerBody))) {
    return {
      isCommand: false,
      intent: "praise",
      confidence: 0.8,
      reasoning: "Contains positive language",
    };
  }

  const concernPatterns = [
    /\b(concern|worried|issue|problem|bug|wrong|incorrect)\b/i,
    /\bwhat\s+if\b/i,
  ];
  if (concernPatterns.some((p) => p.test(lowerBody))) {
    return {
      isCommand: false,
      intent: "concern",
      confidence: 0.6,
      reasoning: "Contains concern language",
    };
  }

  const suggestionPatterns = [
    /\b(consider|maybe|could|might|suggest|what\s+about)\b/i,
    /\bhow\s+about\b/i,
  ];
  if (suggestionPatterns.some((p) => p.test(lowerBody))) {
    return {
      isCommand: false,
      intent: "suggestion",
      confidence: 0.6,
      reasoning: "Contains suggestion language",
    };
  }

  return {
    isCommand: false,
    intent: "neutral",
    confidence: 0.5,
    reasoning: "No specific intent detected",
  };
}
