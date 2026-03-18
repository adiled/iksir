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
  hala: "resolved" | "needs_disambiguation" | "needs_llm" | "not_found" | "error" | "list";

  /** The identified entity (if resolved) */
  kiyan?: {
    type: NawKiyan;
    id: string;
    identifier?: string;
    title: string;
    url: string;
  };

  /** Parent epic if entity is a child ticket */
  kitabAb?: {
    id: string;
    identifier: string;
    title: string;
    url: string;
  };

  /** Multiple matches requiring user selection */
  murashshahun?: Array<{
    type: NawKiyan;
    id: string;
    identifier?: string;
    title: string;
    url: string;
    score: number;
  }>;

  /** Original raw text */
  nassKham: string;

  /** How it was resolved */
  tariqa: "url" | "huwiyat_wasfa" | "llm_search" | "deterministic_search";

  /** Error message if status is "error" */
  khata?: string;

  /** Action to perform (from context-aware resolution) */
  fil?: "proceed" | "query" | "cancel" | null;
}

/** LLM-extracted intent structure */
interface NiyyaMustakhraja {
  nawKiyan: NawKiyan;
  kalimatBahth: string[];
  huwiyyatWasfa?: string;
  talmiMashru?: string;
  talmiMarhala?: string;
  musnad?: "me" | null;
  hala?: "todo" | "in_progress" | "done" | "backlog" | null;
  dawra?: "current" | "next" | null;
  yushirIlaTarkiz?: boolean;
  fil?: "proceed" | "query" | "cancel" | null;
}


const NAMAT_HUWIYYAT_WASFA = /\b([A-Z]+-\d+)\b/i;

/** Keywords that hint at entity type */
const KALIMAT_NAW: Record<NawKiyan, string[]> = {
  ticket: ["ticket", "issue"],
  epic: ["epic"],
  milestone: ["milestone", "sprint", "cycle"],
  project: ["project"],
  unknown: [],
};


export class Arraf {
  mutabiWasfa: MutabiWasfa;
  #opencode: OpenCodeClient;
  huwiyyatJalsatNiyya: string | null = null;

  constructor(deps: { issueTracker: MutabiWasfa; opencode: OpenCodeClient }) {
    this.mutabiWasfa = deps.issueTracker;
    this.#opencode = deps.opencode;
  }

  /**
   * Resolve user intent to a Linear entity
   */
  async halla(text: string, context?: SiyaqMuhadatha): Promise<NiyyaMuhallala> {
    const trimmed = text.trim();

    /** Step 1: Try deterministic parsing */
    const deterministic = await this.jarrabHatmi(trimmed);
    if (deterministic.hala === "resolved" || deterministic.hala === "needs_disambiguation") {
      return deterministic;
    }

    /** Step 2: Check for type keywords that might help narrow search */
    const typeHint = this.istakhrajTalmihNaw(trimmed);

    /** Step 3: Use LLM to extract structured intent (with conversation context) */
    const llmIntent = await this.istakhrajNiyyaBiLLM(trimmed, context);
    if (!llmIntent) {
      return {
        hala: "error",
        nassKham: trimmed,
        tariqa: "llm_search",
        khata: "Failed to extract intent from message",
      };
    }

    if (llmIntent.yushirIlaTarkiz && context?.focusEntity) {
      await logger.info("intent-resolver", "Using focus entity from context", {
        focusEntity: context.focusEntity.identifier,
        action: llmIntent.fil,
      });
      return {
        hala: "resolved",
        kiyan: {
          type: context.focusEntity.type,
          id: context.focusEntity.id,
          identifier: context.focusEntity.identifier,
          title: context.focusEntity.title,
          url: context.focusEntity.url,
        },
        nassKham: trimmed,
        tariqa: "llm_search",
        fil: llmIntent.fil,
      };
    }

    return await this.bahathaKiyanat(trimmed, llmIntent, typeHint);
  }

  /**
   * Try deterministic parsing (URLs, ticket IDs)
   */
  async jarrabHatmi(text: string): Promise<NiyyaMuhallala> {
    /** Check for issue tracker URL */
    const urlMatch = text.match(this.mutabiWasfa.getUrlPattern());
    if (urlMatch) {
      const parsed = this.mutabiWasfa.parseUrl(urlMatch[0]);
      if (parsed) {
        return await this.hallaMinRabit(text, parsed, urlMatch[0]);
      }
    }

    /** Check for ticket ID */
    const ticketMatch = text.match(NAMAT_HUWIYYAT_WASFA);
    if (ticketMatch) {
      const identifier = ticketMatch[1].toUpperCase();
      return await this.hallaHuwiyyatWasfa(text, identifier);
    }

    return {
      hala: "needs_llm",
      nassKham: text,
      tariqa: "deterministic_search",
    };
  }

  /**
   * Resolve from a parsed ticket URL
   */
  async hallaMinRabit(
    text: string,
    parsed: { type: string; id: string },
    url: string
  ): Promise<NiyyaMuhallala> {
    if (parsed.type === "ticket" || parsed.type === "issue") {
      return await this.hallaHuwiyyatWasfa(text, parsed.id);
    }

    if (parsed.type === "project") {
      const project = await this.mutabiWasfa.getProject(parsed.id);
      if (project) {
        return {
          hala: "resolved",
          kiyan: {
            type: "project",
            id: project.id,
            title: project.name,
            url: project.url ?? "",
          },
          nassKham: text,
          tariqa: "url",
        };
      }
    }

    return {
      hala: "not_found",
      nassKham: text,
      tariqa: "url",
      khata: `Could not find entity at ${url}`,
    };
  }

  /**
   * Resolve a ticket ID (e.g., "TEAM-200")
   */
  async hallaHuwiyyatWasfa(text: string, identifier: string): Promise<NiyyaMuhallala> {
    const issue = await this.mutabiWasfa.getIssue(identifier);

    if (!issue) {
      return {
        hala: "not_found",
        nassKham: text,
        tariqa: "huwiyat_wasfa",
        khata: `Ticket ${identifier} not found`,
      };
    }

    const result: NiyyaMuhallala = {
      hala: "resolved",
      kiyan: {
        type: this.#mayyazaNawWasfa(issue),
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url ?? "",
      },
      nassKham: text,
      tariqa: "huwiyat_wasfa",
    };

    if (issue.parent) {
      const parent = await this.mutabiWasfa.getIssue(issue.parent.identifier);
      if (parent) {
        result.kitabAb = {
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
  istakhrajTalmihNaw(text: string): NawKiyan | null {
    const lower = text.toLowerCase();

    for (const [type, keywords] of Object.entries(KALIMAT_NAW)) {
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
   * Use LLM to extract structured intent from vague text
   */
  async istakhrajNiyyaBiLLM(text: string, context?: SiyaqMuhadatha): Promise<NiyyaMustakhraja | null> {
    /** Get or create intent extraction session */
    const sessionId = await this.wajadaJalsatNiyya();
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

${Arraf.TAWJIHAT_NIZAM_NIYYA}`;

    const response = await this.#opencode.sendPrompt(sessionId, userPrompt, {
      system: Arraf.TAWJIHAT_NIZAM_NIYYA,
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

      const parsed = JSON.parse(jsonMatch[0]) as NiyyaMustakhraja;
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
  async wajadaJalsatNiyya(): Promise<string | null> {
    if (this.huwiyyatJalsatNiyya) {
      const session = await this.#opencode.jalabJalsa(this.huwiyyatJalsatNiyya);
      if (session) {
        return this.huwiyyatJalsatNiyya;
      }
      this.huwiyyatJalsatNiyya = null;
    }

    /** Create new session */
    const session = await this.#opencode.khalaqaJalsa(
      "iksir-intent",
      "Intent Extraction (reusable)"
    );

    if (!session) {
      return null;
    }

    this.huwiyyatJalsatNiyya = session.id;
    return session.id;
  }

  /**
   * Search issue tracker based on LLM-extracted intent
   */
  async bahathaKiyanat(
    text: string,
    intent: NiyyaMustakhraja,
    typeHint: NawKiyan | null
  ): Promise<NiyyaMuhallala> {
    const effectiveType = intent.nawKiyan !== "unknown" ? intent.nawKiyan : typeHint;
    const searchQuery = intent.kalimatBahth.join(" ");
    const hasFilters = intent.musnad || intent.hala || intent.dawra;

    if (!searchQuery && !intent.huwiyyatWasfa && !hasFilters) {
      return {
        hala: "not_found",
        nassKham: text,
        tariqa: "llm_search",
        khata: "Could not extract search terms or filters from message",
      };
    }

    if (intent.huwiyyatWasfa) {
      return await this.hallaHuwiyyatWasfa(text, intent.huwiyyatWasfa);
    }

    /**
     * Search based on entity type
     * Always search tickets/issues since they're the most common
     * Also search the specified type if different
     */
    const candidates: NiyyaMuhallala["murashshahun"] = [];

    if (hasFilters) {
      /** Get current cycle ID if needed */
      let cycleId: string | undefined;
      if (intent.dawra === "current") {
        const activeMilestone = await this.mutabiWasfa.getActiveMilestone?.();
        if (activeMilestone) {
          cycleId = activeMilestone.id;
          await logger.info("intent-resolver", `Using active milestone: ${activeMilestone.name}`);
        } else {
          await logger.warn("intent-resolver", "No active milestone found");
        }
      }

      const filteredIssues = await this.mutabiWasfa.getFilteredIssues?.({
        assigneeId: intent.musnad === "me" ? "me" : undefined,
        status: intent.hala ?? undefined,
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
      const issues = await this.mutabiWasfa.searchIssues(searchQuery, 10);
      for (const issue of issues) {
        const type = this.#mayyazaNawWasfa(issue);
        candidates.push({
          type,
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url ?? "",
          score: this.hasabaDaraja(issue.title, intent.kalimatBahth),
        });
      }
    }

    if (!hasFilters && (effectiveType === "milestone" || !effectiveType)) {
      const milestones = await this.bahathaMarahim(searchQuery);
      candidates.push(...milestones);
    }

    if (!hasFilters && (effectiveType === "project" || !effectiveType)) {
      const projects = await this.mutabiWasfa.searchProjects(searchQuery);
      for (const p of projects) {
        candidates.push({
          type: "project",
          id: p.id,
          title: p.name,
          url: p.url ?? "",
          score: this.hasabaDaraja(p.name, intent.kalimatBahth),
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      const filterDesc = hasFilters ? "matching filters" : `matching "${searchQuery}"`;
      return {
        hala: "not_found",
        nassKham: text,
        tariqa: "llm_search",
        khata: `No ${effectiveType ?? "tickets"} found ${filterDesc}`,
      };
    }

    if (hasFilters) {
      return {
        hala: "list",
        murashshahun: candidates.slice(0, 15),
        nassKham: text,
        tariqa: "llm_search",
      };
    }

    if (candidates.length === 1) {
      const match = candidates[0];
      const result: NiyyaMuhallala = {
        hala: "resolved",
        kiyan: {
          type: match.type,
          id: match.id,
          identifier: match.identifier,
          title: match.title,
          url: match.url,
        },
        nassKham: text,
        tariqa: "llm_search",
      };

      if (match.type === "ticket" && match.identifier) {
        const issue = await this.mutabiWasfa.getIssue(match.identifier);
        if (issue?.parent) {
          const parent = await this.mutabiWasfa.getIssue(issue.parent.identifier);
          if (parent) {
            result.kitabAb = {
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
      hala: "needs_disambiguation",
      murashshahun: candidates.slice(0, 5),
      nassKham: text,
      tariqa: "llm_search",
    };
  }

  /**
   * Search milestones via the issue tracker interface
   */
  async bahathaMarahim(query: string): Promise<NonNullable<NiyyaMuhallala["murashshahun"]>> {
    const milestones = await this.mutabiWasfa.searchMilestones?.(query);
    if (!milestones || milestones.length === 0) {
      return [];
    }

    return milestones.map((m) => ({
      type: "milestone" as const,
      id: m.id,
      title: m.name,
      url: m.url ?? "",
      score: this.hasabaDaraja(m.name, query.split(" ")),
    }));
  }

  /**
   * Calculate relevance score for a title against search terms
   */
  hasabaDaraja(title: string, terms: string[]): number {
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
