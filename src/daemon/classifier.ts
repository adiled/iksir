/**
 * Shared Classification Service
 *
 * LLM-based gatekeeper for notifications and questions.
 * Classifies as WORTHY (forward to operator) or CRY_BABY (handle autonomously).
 *
 * Prompt templates are loaded from files (configurable via env vars) with
 * inline fallbacks. AGENTS.md cache shared across all classification calls.
 */

import { logger } from "../logging/logger.ts";
import { join } from "jsr:@std/path";
import type { OpenCodeClient } from "../opencode/client.ts";
import type { QuestionInfo, QuestionClassification } from "../types.ts";

function getAgentsMdPath(): string {
  return Deno.env.get("MUNADI_AGENTS_MD_PATH") ??
    join(Deno.env.get("HOME") ?? ".", ".config", "munadi", "AGENTS.md");
}

function getRepoPath(): string {
  return Deno.env.get("MUNADI_REPO_PATH") ?? ".";
}

// =============================================================================
// Template Loading
// =============================================================================

/** Cached content: null = not loaded, string = content, false = load failed */
let agentsMdContent: string | null = null;
let notificationTemplate: string | null = null;
let questionTemplate: string | null = null;

async function loadAgentsMd(): Promise<string | null> {
  if (agentsMdContent) return agentsMdContent;
  try {
    agentsMdContent = await Deno.readTextFile(getAgentsMdPath());
    return agentsMdContent;
  } catch {
    await logger.warn("classifier", "Failed to read AGENTS.md");
    return null;
  }
}

function getPromptPath(envVar: string, defaultFilename: string): string {
  return Deno.env.get(envVar) ?? join(getRepoPath(), "prompts", defaultFilename);
}

async function loadTemplate(
  envVar: string,
  defaultFilename: string,
  cached: string | null,
  fallback: string,
): Promise<string> {
  if (cached) return cached;
  const path = getPromptPath(envVar, defaultFilename);
  try {
    const content = await Deno.readTextFile(path);
    await logger.info("classifier", `Loaded prompt template from ${path}`);
    return content;
  } catch {
    await logger.info("classifier", `Prompt template not found at ${path}, using inline fallback`);
    return fallback;
  }
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// =============================================================================
// Inline Fallback Templates
// =============================================================================

const NOTIFICATION_FALLBACK = `You are a gatekeeper protecting the operator's attention.

The operator handles:
- Business decisions and priorities
- Architecture boundaries (where features live, API surfaces)
- Political timing (when to disclose PRs, who to loop in)
- External blockers requiring human action (waiting on designer, other team, etc.)
- Milestone completions worth celebrating

The operator does NOT handle:
- Implementation details ("should I use pattern X or Y?")
- Self-answerable questions (check docs, precedents in codebase)
- Progress updates (starting ticket, tests passing - expected, not newsworthy)
- Debugging ("this test is failing")
- Learned helplessness ("I'm not sure what to do")

Reference guidelines the orchestrator should follow autonomously:
---
{{agentGuidelines}}
---

Orchestrator wants to send this message to the operator:
---
{{message}}
---

Classify this message:
- WORTHY: Genuinely needs the operator's attention (architecture ambiguity, external blocker, political timing, milestone)
- CRY_BABY: Should be handled autonomously by orchestrator using specs, docs, and precedents

If CRY_BABY, provide a terse rejection (1-2 sentences) with specific guidance. Reference file paths when applicable.

Respond ONLY with valid JSON (no markdown, no explanation):
{"classification": "WORTHY" or "CRY_BABY", "reason": "brief explanation", "rejection": "terse guidance if CRY_BABY, null if WORTHY"}`;

const QUESTION_FALLBACK = `You are a gatekeeper protecting the operator's attention.

The operator handles:
- Business decisions affecting scope, timeline, or resources
- Architecture boundaries (which module owns a feature, API surface design)
- Political timing (when to disclose PRs, who to involve in reviews)
- External blockers requiring human action (waiting on designer, other team)
- Tradeoffs that require human judgment (speed vs quality, now vs later)

The operator does NOT handle:
- Implementation details ("should I use pattern X or Y?")
- Self-answerable questions (check docs, precedents, existing code)
- Obvious choices (when one option is clearly better per guidelines)
- Progress confirmations ("should I proceed?")
- Debugging decisions ("which approach to try first?")

Reference guidelines the orchestrator should follow autonomously:
---
{{agentGuidelines}}
---

Orchestrator is asking this question:

Header: {{header}}
Question: {{question}}
Options:
{{options}}

Classify this question:
- WORTHY: Genuinely needs the operator's judgment (business impact, architecture boundaries, political timing)
- CRY_BABY: Can be decided autonomously using specs, docs, precedents, or common sense

If CRY_BABY:
- Provide a terse rejection (1-2 sentences) with guidance
- Specify which option to auto-select (use exact label text, or "pick first" or "pick recommended")

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "classification": "WORTHY" or "CRY_BABY",
  "reason": "brief explanation",
  "rejection": "terse guidance if CRY_BABY, null if WORTHY",
  "autoAnswer": "exact label of option to pick if CRY_BABY, null if WORTHY"
}`;

// =============================================================================
// Notification Classification
// =============================================================================

interface NotificationClassification {
  worthy: boolean;
  reason: string;
  rejection: string | null;
}

/**
 * Classify a notification as worthy of the operator's attention or cry-baby.
 */
export async function classifyNotification(
  opencode: OpenCodeClient,
  message: string,
): Promise<NotificationClassification> {
  const md = await loadAgentsMd();
  if (!md) {
    return { worthy: true, reason: "AGENTS.md unavailable", rejection: null };
  }

  notificationTemplate = await loadTemplate(
    "MUNADI_CLASSIFY_NOTIFICATION_PROMPT",
    "classify-notification.md",
    notificationTemplate,
    NOTIFICATION_FALLBACK,
  );

  const prompt = renderTemplate(notificationTemplate, {
    agentGuidelines: md,
    message,
  });

  try {
    const result = await opencode.classify(prompt);
    if (!result.success || !result.response) {
      await logger.warn("classifier", "Notification classification failed, allowing", {
        error: result.error,
      });
      return { worthy: true, reason: "Classification failed", rejection: null };
    }

    const parsed = JSON.parse(result.response.trim());
    const isWorthy = parsed.classification === "WORTHY";
    return {
      worthy: isWorthy,
      reason: parsed.reason ?? "Unknown",
      rejection: isWorthy ? null : (parsed.rejection ?? "Handle this autonomously."),
    };
  } catch (error) {
    await logger.warn("classifier", "Notification classification error, allowing", {
      error: String(error),
    });
    return { worthy: true, reason: "Classification error", rejection: null };
  }
}

// =============================================================================
// Question Classification
// =============================================================================

/**
 * Classify a question as worthy of the operator's judgment or cry-baby.
 */
export async function classifyQuestion(
  opencode: OpenCodeClient,
  question: QuestionInfo,
): Promise<QuestionClassification> {
  const md = await loadAgentsMd();
  if (!md) {
    return { classification: "WORTHY", reason: "AGENTS.md unavailable", rejection: null, autoAnswer: null };
  }

  const optionsText = question.options
    .map((o) => `- ${o.label}: ${o.description}`)
    .join("\n");

  questionTemplate = await loadTemplate(
    "MUNADI_CLASSIFY_QUESTION_PROMPT",
    "classify-question.md",
    questionTemplate,
    QUESTION_FALLBACK,
  );

  const prompt = renderTemplate(questionTemplate, {
    agentGuidelines: md,
    header: question.header,
    question: question.question,
    options: optionsText,
  });

  try {
    const result = await opencode.classify(prompt);
    if (!result.success || !result.response) {
      await logger.warn("classifier", "Question classification failed, allowing", {
        error: result.error,
      });
      return { classification: "WORTHY", reason: "Classification failed", rejection: null, autoAnswer: null };
    }

    // Parse JSON — handle potential markdown wrapping
    let jsonStr = result.response.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(jsonStr);

    // Handle "pick recommended" / "pick first" shortcuts
    let autoAnswer = parsed.autoAnswer;
    if (autoAnswer && parsed.classification === "CRY_BABY") {
      if (autoAnswer.toLowerCase() === "pick recommended") {
        const rec = question.options.find((o) => o.label.includes("(Recommended)"));
        autoAnswer = rec?.label ?? question.options[0]?.label ?? null;
      } else if (autoAnswer.toLowerCase() === "pick first") {
        autoAnswer = question.options[0]?.label ?? null;
      }
    }

    return {
      classification: parsed.classification === "WORTHY" ? "WORTHY" : "CRY_BABY",
      reason: parsed.reason ?? "Unknown",
      rejection: parsed.classification === "CRY_BABY" ? (parsed.rejection ?? "Handle autonomously.") : null,
      autoAnswer: parsed.classification === "CRY_BABY" ? autoAnswer : null,
    };
  } catch (error) {
    await logger.warn("classifier", "Question classification error, allowing", {
      error: String(error),
    });
    return { classification: "WORTHY", reason: "Classification error", rejection: null, autoAnswer: null };
  }
}

/**
 * Reset cached templates (for testing).
 */
export function _resetClassifierCache(): void {
  agentsMdContent = null;
  notificationTemplate = null;
  questionTemplate = null;
}
