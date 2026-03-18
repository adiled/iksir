/**
 * Arraf (عرّاف) - The Diviner
 * 
 * One of the sacred Khuddām (خدّام - Servants) of the alchemical workshop.
 * Arraf divines intent from the messages that arrive, determining whether
 * they speak of waṣfa (formulae/tickets), risāla (treatises/PRs), or
 * other matters of the Great Work.
 */

/**
 * Intent Resolver
 *
 * Hybrid deterministic + LLM intent parsing for user messages.
 *
 * Flow:
 * 1. Deterministic parsing (fast) - URLs, ticket IDs, commands
 * 2. LLM fallback (smart) - vague references, natural language
 * 3. Issue tracker API search - find matching entities
 * 4. Epic association - suggest parent epics for child tickets
 * 5. Disambiguation - ask user to pick when multiple matches
 */

import { logger } from "../logging/logger.ts";
import type { OpenCodeClient } from "../opencode/client.ts";
import type { SiyaqMuhadatha } from "./munadi.ts";
import type { MutabiWasfa, NawKiyan, WasfaMutaba } from "../types.ts";


/** Re-export NawKiyan for backwards compatibility */
export type { NawKiyan } from "../types.ts";

/** Result of intent resolution */
export interface NiyyaMuhallala {
  /** Resolution status */
  status: "resolved" | "needs_disambiguation" | "needs_llm" | "not_found" | "error" | "list";

  /** The identified entity (if resolved) */
  entity?: {
    type: NawKiyan;
    id: string;
    identifier?: string;
    title: string;
    url: string;
  };

  /** Parent epic if entity is a child ticket */
  parentEpic?: {
    id: string;
    identifier: string;
    title: string;
    url: string;
  };

  /** Multiple matches requiring user selection */
  candidates?: Array<{
    type: NawKiyan;
    id: string;
    identifier?: string;
    title: string;
    url: string;
    score: number;
  }>;

  /** Original raw text */
  rawText: string;

  /** How it was resolved */
  method: "url" | "huwiyat_wasfa" | "llm_search" | "deterministic_search";

  /** Error message if status is "error" */
  error?: string;

  /** Action to perform (from context-aware resolution) */
  action?: "proceed" | "query" | "cancel" | null;
}

/** LLM-extracted intent structure */
interface LLMIntent {
  entityType: NawKiyan;
  searchTerms: string[];
  huwiyyatWasfa?: string;
  projectHint?: string;
  milestoneHint?: string;
  assignee?: "me" | null;
  status?: "todo" | "in_progress" | "done" | "backlog" | null;
  cycle?: "current" | "next" | null;
  referencesFocus?: boolean;
  action?: "proceed" | "query" | "cancel" | null;
}


const TICKET_ID_PATTERN = /\b([A-Z]+-\d+)\b/i;

/** Keywords that hint at entity type */
const TYPE_KEYWORDS: Record<NawKiyan, string[]> = {
  ticket: ["ticket", "issue"],
  epic: ["epic"],
  milestone: ["milestone", "sprint", "cycle"],
  project: ["project"],
  unknown: [],
};


export class Arraf {
  #issueTracker: MutabiWasfa;
  #opencode: OpenCodeClient;
  #intentSessionId: string | null = null;

  constructor(deps: { issueTracker: MutabiWasfa; opencode: OpenCodeClient }) {
    this.#issueTracker = deps.issueTracker;
    this.#opencode = deps.opencode;
  }

  /**
   * Resolve user intent to a Linear entity
   */
  async resolve(text: string, context?: SiyaqMuhadatha): Promise<NiyyaMuhallala> {
    const trimmed = text.trim();

    /** Step 1: Try deterministic parsing */
    const deterministic = await this.#tryDeterministic(trimmed);
    if (deterministic.status === "resolved" || deterministic.status === "needs_disambiguation") {
      return deterministic;
    }

    /** Step 2: Check for type keywords that might help narrow search */
    const typeHint = this.#extractTypeHint(trimmed);

    /** Step 3: Use LLM to extract structured intent (with conversation context) */
    const llmIntent = await this.#extractIntentWithLLM(trimmed, context);
    if (!llmIntent) {
      return {
        status: "error",
        rawText: trimmed,
        method: "llm_search",
        error: "Failed to extract intent from message",
      };
    }

    if (llmIntent.referencesFocus && context?.focusEntity) {
      await logger.info("intent-resolver", "Using focus entity from context", {
        focusEntity: context.focusEntity.identifier,
        action: llmIntent.action,
      });
      return {
        status: "resolved",
        entity: {
          type: context.focusEntity.type,
          id: context.focusEntity.id,
          identifier: context.focusEntity.identifier,
          title: context.focusEntity.title,
          url: context.focusEntity.url,
        },
        rawText: trimmed,
        method: "llm_search",
        action: llmIntent.action,
      };
    }

    return await this.#searchEntities(trimmed, llmIntent, typeHint);
  }

  /**
   * Try deterministic parsing (URLs, ticket IDs)
   */
  async #tryDeterministic(text: string): Promise<NiyyaMuhallala> {
    /** Check for issue tracker URL */
    const urlMatch = text.match(this.#issueTracker.getUrlPattern());
    if (urlMatch) {
      const parsed = this.#issueTracker.parseUrl(urlMatch[0]);
      if (parsed) {
        return await this.#resolveFromParsedUrl(text, parsed, urlMatch[0]);
      }
    }

    /** Check for ticket ID */
    const ticketMatch = text.match(TICKET_ID_PATTERN);
    if (ticketMatch) {
      const identifier = ticketMatch[1].toUpperCase();
      return await this.#resolveTicketId(text, identifier);
    }

    return {
      status: "needs_llm",
      rawText: text,
      method: "deterministic_search",
    };
  }

  /**
   * Resolve from a parsed ticket URL
   */
  async #resolveFromParsedUrl(
    text: string,
    parsed: { type: string; id: string },
    url: string
  ): Promise<NiyyaMuhallala> {
    if (parsed.type === "ticket" || parsed.type === "issue") {
      return await this.#resolveTicketId(text, parsed.id);
    }

    if (parsed.type === "project") {
      const project = await this.#issueTracker.getProject(parsed.id);
      if (project) {
        return {
          status: "resolved",
          entity: {
            type: "project",
            id: project.id,
            title: project.name,
            url: project.url ?? "",
          },
          rawText: text,
          method: "url",
        };
      }
    }

    return {
      status: "not_found",
      rawText: text,
      method: "url",
      error: `Could not find entity at ${url}`,
    };
  }

  /**
   * Resolve a ticket ID (e.g., "TEAM-200")
   */
  async #resolveTicketId(text: string, identifier: string): Promise<NiyyaMuhallala> {
    const issue = await this.#issueTracker.getIssue(identifier);

    if (!issue) {
      return {
        status: "not_found",
        rawText: text,
        method: "huwiyat_wasfa",
        error: `Ticket ${identifier} not found`,
      };
    }

    const result: NiyyaMuhallala = {
      status: "resolved",
      entity: {
        type: this.#mayyazaNawWasfa(issue),
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url ?? "",
      },
      rawText: text,
      method: "huwiyat_wasfa",
    };

    if (issue.parent) {
      const parent = await this.#issueTracker.getIssue(issue.parent.identifier);
      if (parent) {
        result.parentEpic = {
          id: parent.id,
          identifier: parent.identifier,
          title: parent.title,
          url: parent.url ?? "",
        };
      }
    }

    return result;
  }

  /**
   * Mayyiz whether a ticket is an epic or regular ticket
   */
  #mayyazaNawWasfa(issue: WasfaMutaba): NawKiyan {
    /** Has "epic" label */
    const labels = issue.labels ?? [];
    if (labels.some((l) => l.toLowerCase() === "epic")) {
      return "epic";
    }

    return "ticket";
  }

  /**
   * Extract type hint from keywords in text
   */
  #extractTypeHint(text: string): NawKiyan | null {
    const lower = text.toLowerCase();

    for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
      for (const keyword of keywords) {
        if (lower.includes(keyword)) {
          return type as NawKiyan;
        }
      }
    }

    return null;
  }

  /**
   * System prompt for intent extraction (stable across calls, benefits from caching)
   */
  static readonly INTENT_SYSTEM_PROMPT = `You are a JSON extraction tool for project management. Return ONLY valid JSON, no explanations.

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
   * Use LLM to extract structured intent from vague text
   */
  async #extractIntentWithLLM(text: string, context?: SiyaqMuhadatha): Promise<LLMIntent | null> {
    /** Get or create intent extraction session */
    const sessionId = await this.#getIntentSession();
    if (!sessionId) {
      await logger.error("intent-resolver", "Failed to get intent session");
      return null;
    }

    /** Build context section */
    let contextSection = "";
    if (context && (context.focusEntity || context.recentMessages.length > 0)) {
      contextSection = "\n\nCONTEXT:";
      if (context.focusEntity) {
        contextSection += `\nFocus: ${context.focusEntity.identifier ?? context.focusEntity.id} - "${context.focusEntity.title}" (${context.focusEntity.type})`;
      }
      if (context.recentMessages.length > 0) {
        contextSection += "\nRecent:";
        for (const msg of context.recentMessages.slice(-3)) {
          contextSection += `\n- "${msg.text}"`;
        }
      }
    }

    /** User prompt includes full instruction since system prompt may be overridden by OpenCode */
    const userPrompt = `TASK: Extract intent as JSON. Return ONLY the JSON object, nothing else. No explanation, no markdown, no code blocks.

MESSAGE: "${text}"${contextSection}

${Arraf.INTENT_SYSTEM_PROMPT}`;

    const response = await this.#opencode.sendPrompt(sessionId, userPrompt, {
      system: Arraf.INTENT_SYSTEM_PROMPT,
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      timeoutMs: 15_000,
    });

    if (!response.success || !response.response) {
      await logger.error("intent-resolver", "LLM extraction failed", { error: response.error });
      return null;
    }

    try {
      const jsonMatch = response.response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        await logger.error("intent-resolver", "No JSON in LLM response", {
          response: response.response,
        });
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as LLMIntent;
      await logger.info("intent-resolver", "LLM extracted intent", { intent: parsed });
      return parsed;
    } catch (error) {
      await logger.error("intent-resolver", "Failed to parse LLM response", {
        response: response.response,
        error: String(error),
      });
      return null;
    }
  }

  /**
   * Get or create the intent extraction session
   */
  async #getIntentSession(): Promise<string | null> {
    if (this.#intentSessionId) {
      const session = await this.#opencode.jalabJalsa(this.#intentSessionId);
      if (session) {
        return this.#intentSessionId;
      }
      this.#intentSessionId = null;
    }

    /** Create new session */
    const session = await this.#opencode.khalaqaJalsa(
      "iksir-intent",
      "Intent Extraction (reusable)"
    );

    if (!session) {
      return null;
    }

    this.#intentSessionId = session.id;
    return session.id;
  }

  /**
   * Search issue tracker based on LLM-extracted intent
   */
  async #searchEntities(
    text: string,
    intent: LLMIntent,
    typeHint: NawKiyan | null
  ): Promise<NiyyaMuhallala> {
    const effectiveType = intent.entityType !== "unknown" ? intent.entityType : typeHint;
    const searchQuery = intent.searchTerms.join(" ");
    const hasFilters = intent.assignee || intent.status || intent.cycle;

    if (!searchQuery && !intent.huwiyyatWasfa && !hasFilters) {
      return {
        status: "not_found",
        rawText: text,
        method: "llm_search",
        error: "Could not extract search terms or filters from message",
      };
    }

    if (intent.huwiyyatWasfa) {
      return await this.#resolveTicketId(text, intent.huwiyyatWasfa);
    }

    /**
     * Search based on entity type
     * Always search tickets/issues since they're the most common
     * Also search the specified type if different
     */
    const candidates: NiyyaMuhallala["candidates"] = [];

    if (hasFilters) {
      /** Get current cycle ID if needed */
      let cycleId: string | undefined;
      if (intent.cycle === "current") {
        const activeMilestone = await this.#issueTracker.getActiveMilestone?.();
        if (activeMilestone) {
          cycleId = activeMilestone.id;
          await logger.info("intent-resolver", `Using active milestone: ${activeMilestone.name}`);
        } else {
          await logger.warn("intent-resolver", "No active milestone found");
        }
      }

      const filteredIssues = await this.#issueTracker.getFilteredIssues?.({
        assigneeId: intent.assignee === "me" ? "me" : undefined,
        status: intent.status ?? undefined,
        cycleId,
      }, 15) ?? [];

      for (const issue of filteredIssues) {
        const type = this.#mayyazaNawWasfa(issue);
        candidates.push({
          type,
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url ?? "",
          score: 1.0,
        });
      }
    } else {
      /** Text-based search (original behavior) */
      const issues = await this.#issueTracker.searchIssues(searchQuery, 10);
      for (const issue of issues) {
        const type = this.#mayyazaNawWasfa(issue);
        candidates.push({
          type,
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url ?? "",
          score: this.#calculateScore(issue.title, intent.searchTerms),
        });
      }
    }

    if (!hasFilters && (effectiveType === "milestone" || !effectiveType)) {
      const milestones = await this.#searchMilestones(searchQuery);
      candidates.push(...milestones);
    }

    if (!hasFilters && (effectiveType === "project" || !effectiveType)) {
      const projects = await this.#issueTracker.searchProjects(searchQuery);
      for (const p of projects) {
        candidates.push({
          type: "project",
          id: p.id,
          title: p.name,
          url: p.url ?? "",
          score: this.#calculateScore(p.name, intent.searchTerms),
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      const filterDesc = hasFilters ? "matching filters" : `matching "${searchQuery}"`;
      return {
        status: "not_found",
        rawText: text,
        method: "llm_search",
        error: `No ${effectiveType ?? "tickets"} found ${filterDesc}`,
      };
    }

    if (hasFilters) {
      return {
        status: "list",
        candidates: candidates.slice(0, 15),
        rawText: text,
        method: "llm_search",
      };
    }

    if (candidates.length === 1) {
      const match = candidates[0];
      const result: NiyyaMuhallala = {
        status: "resolved",
        entity: {
          type: match.type,
          id: match.id,
          identifier: match.identifier,
          title: match.title,
          url: match.url,
        },
        rawText: text,
        method: "llm_search",
      };

      if (match.type === "ticket" && match.identifier) {
        const issue = await this.#issueTracker.getIssue(match.identifier);
        if (issue?.parent) {
          const parent = await this.#issueTracker.getIssue(issue.parent.identifier);
          if (parent) {
            result.parentEpic = {
              id: parent.id,
              identifier: parent.identifier,
              title: parent.title,
              url: parent.url ?? "",
            };
          }
        }
      }

      return result;
    }

    return {
      status: "needs_disambiguation",
      candidates: candidates.slice(0, 5),
      rawText: text,
      method: "llm_search",
    };
  }

  /**
   * Search milestones via the issue tracker interface
   */
  async #searchMilestones(query: string): Promise<NonNullable<NiyyaMuhallala["candidates"]>> {
    const milestones = await this.#issueTracker.searchMilestones?.(query);
    if (!milestones || milestones.length === 0) {
      return [];
    }

    return milestones.map((m) => ({
      type: "milestone" as const,
      id: m.id,
      title: m.name,
      url: m.url ?? "",
      score: this.#calculateScore(m.name, query.split(" ")),
    }));
  }

  /**
   * Calculate relevance score for a title against search terms
   */
  #calculateScore(title: string, terms: string[]): number {
    const titleLower = title.toLowerCase();
    let matches = 0;

    for (const term of terms) {
      if (titleLower.includes(term.toLowerCase())) {
        matches++;
      }
    }

    return terms.length > 0 ? matches / terms.length : 0;
  }
}

/**
 * Create an intent resolver instance
 */
export function istadaaArraf(deps: {
  issueTracker: MutabiWasfa;
  opencode: OpenCodeClient;
}): Arraf {
  return new Arraf(deps);
}
