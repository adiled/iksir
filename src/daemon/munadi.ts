/**
 * Munadi (منادي) - The Caller
 * 
 * One of the sacred Khuddām (خدّام - Servants) of the alchemical workshop.
 * Munadi calls forth the workers, routing messages and dispatching intent.
 * Like a muezzin calling the faithful to prayer, Munadi summons the spirits
 * to their appointed tasks in the Great Work.
 */

/**
 * Munadi - The Caller منادي
 *
 * The sacred voice that summons alchemists to their work,
 * routing messages from the outer world to the proper vessels.
 *
 * Sacred duties:
 * - Divine intent from raw utterances (through both logic and oracle)
 * - Distinguish query from command
 * - Direct each call to its rightful vessel
 * - Guard the sacred flame (only one may transmute at a time)
 * - Hold requests until vessels are ready
 * - Resolve confusion when multiple paths appear
 * - Suggest the greater books for lesser formulae
 */

import { logger } from "../logging/logger.ts";
import { escapeMarkdown } from "../utils/strings.ts";
import { MudirJalasat } from "./katib.ts";
import {
  Arraf,
  type NiyyaMuhallala,
  type NawKiyan,
} from "./arraf.ts";
import * as git from "../git/operations.ts";
import type { JalsatMurshid, RasulKharij } from "../types.ts";


type IntentType = "query" | "operation" | "command" | "sandbox";
export type InboundSource = "telegram" | "cli" | "pr_comment";

interface Intent {
  identifier: string | null;
  type: IntentType;
  confidence: number;
  rawText: string;
  command?: string;
  commandArgs?: string[];
  /** For sandbox intent: the name of the sandbox project */
  sandboxName?: string;
}

interface InboundMessage {
  source: InboundSource;
  text: string;
  messageId?: string | number;
  raqamRisala?: number;
  author?: string;
}

interface QueuedOperation {
  identifier: string;
  message: string;
  queuedAt: Date;
  source: InboundSource;
  messageId?: string | number;
}

interface DispatchResult {
  handled: boolean;
  response?: string;
  buttons?: Array<{ text: string; data: string }>;
  queued?: boolean;
  error?: string;
}

/** Pending disambiguation state */
interface PendingDisambiguation {
  source: InboundSource;
  candidates: NonNullable<NiyyaMuhallala["murashshahun"]>;
  originalText: string;
  expiresAt: Date;
}

/** Pending parent suggestion state */
interface PendingParentSuggestion {
  source: InboundSource;
  ticket: NonNullable<NiyyaMuhallala["kiyan"]>;
  parent: NonNullable<NiyyaMuhallala["kitabAb"]>;
  parentIsEpic: boolean;
  expiresAt: Date;
}

/** A message in the conversation history */
interface ConversationMessage {
  text: string;
  timestamp: Date;
  resolved?: NiyyaMuhallala;
  response?: string;
}

/** Short-term conversation context for intent resolution */
export interface SiyaqMuhadatha {
  /** Recent messages in the conversation */
  recentMessages: ConversationMessage[];

  /** The current focus entity (most recently resolved) */
  focusEntity?: {
    type: NawKiyan;
    id: string;
    identifier?: string;
    title: string;
    url: string;
    resolvedAt: Date;
  };
}

interface MunadiDeps {
  sessionManager: MudirJalasat;
  intentResolver: Arraf;
  messenger: RasulKharij;
  ticketPattern?: string;
}

/**
 * Parameters for creating/activating an murshid.
 * Used by the common #khalaqaWaFailaMurshid method.
 */
interface MuatayatKhalqMurshid {
  identifier: string;
  title: string;
  type: "epic" | "chore" | "sandbox";
  /** Init message to send to new murshidun */
  initMessage: string;
  /** Optional ticket URL for ticket-based murshidun */
  url?: string;
}


const COMMAND_PATTERN = /^\/(\w+)(?:\s+(.*))?$/;

/** Default ticket pattern matches any JIRA/Linear/GitHub style ID (ABC-123) */
const DEFAULT_TICKET_PATTERN = "[A-Z]+-\\d+";

/**
 * Build ticket ID regex from config or default.
 * Wraps the pattern in word boundaries and a capture group.
 */
function buildTicketPattern(configPattern?: string): RegExp {
  const pattern = configPattern ?? DEFAULT_TICKET_PATTERN;
  return new RegExp(`\\b(${pattern})\\b`, "i");
}

/** Query indicators */
const QUERY_PATTERNS = [
  /^what('s| is)/i,
  /^how('s| is| are)/i,
  /^show\s+(me\s+)?/i,
  /^status\b/i,
  /^check\s+(on\s+)?/i,
  /\?$/,
  /^where\b/i,
  /^which\b/i,
  /^list\b/i,
];

/** Operation indicators */
const OPERATION_PATTERNS = [
  /^start\s+(implementing|working)/i,
  /^implement\b/i,
  /^create\s+(ticket|pr|branch)/i,
  /^invoke\s+implement/i,
  /^make\s+(a\s+)?pr/i,
  /^slice\b/i,
  /^push\b/i,
  /^commit\b/i,
  /^merge\b/i,
  /^work\s+on/i,
];

/** Sandbox/brainstorm indicators - freeform work without tickets */
const SANDBOX_PATTERNS = [
  /without\s+(creating\s+)?(a\s+)?tickets?/i,
  /no\s+tickets?/i,
  /brainstorm/i,
  /prototype/i,
  /sandbox/i,
  /ad[\s-]?hoc/i,
  /freeform/i,
  /experiment/i,
  /spike/i,
];

/** Extract sandbox name from text (e.g., "the epic would be pos-simulator" -> "pos-simulator") */
const SANDBOX_NAME_PATTERNS = [
  /(?:epic|project|name|call(?:ed)?|named)\s+(?:would\s+be\s+|is\s+|it\s+)?["']?([a-z0-9][-a-z0-9_]*)/i,
  /["']([a-z0-9][-a-z0-9_]*)["']/i,
];

/**
 * Parse basic intent (commands, query vs operation)
 * @param ticketPattern - Regex for matching ticket identifiers (from config)
 */
function parseBasicIntent(text: string, ticketPattern: RegExp): Intent {
  const trimmed = text.trim();

  /** Check for commands */
  const commandMatch = trimmed.match(COMMAND_PATTERN);
  if (commandMatch) {
    const [, command, argsStr] = commandMatch;
    const args = argsStr?.split(/\s+/).filter(Boolean) ?? [];

    let identifier: string | null = null;
    for (const arg of args) {
      const idMatch = arg.match(ticketPattern);
      if (idMatch) {
        identifier = idMatch[1].toUpperCase();
        break;
      }
    }

    return {
      identifier,
      type: "command",
      confidence: 1.0,
      rawText: trimmed,
      command: command.toLowerCase(),
      commandArgs: args,
    };
  }

  /** Extract identifier if present */
  let identifier: string | null = null;
  const idMatch = trimmed.match(ticketPattern);
  if (idMatch) {
    identifier = idMatch[1].toUpperCase();
  }

  /** Check for sandbox/brainstorm intent first (highest awwaliyya) */
  let isSandbox = false;
  let sandboxName: string | undefined;

  for (const pattern of SANDBOX_PATTERNS) {
    if (pattern.test(trimmed)) {
      isSandbox = true;
      break;
    }
  }

  if (isSandbox) {
    for (const pattern of SANDBOX_NAME_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        sandboxName = match[1].toLowerCase();
        break;
      }
    }

    return {
      identifier,
      type: "sandbox",
      confidence: 0.9,
      rawText: trimmed,
      sandboxName,
    };
  }

  /** Mayyiz as query or operation */
  let type: IntentType = "query";
  let confidence = 0.5;

  for (const pattern of QUERY_PATTERNS) {
    if (pattern.test(trimmed)) {
      type = "query";
      confidence = 0.8;
      break;
    }
  }

  for (const pattern of OPERATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      type = "operation";
      confidence = 0.85;
      break;
    }
  }

  return { identifier, type, confidence, rawText: trimmed };
}


export class Munadi {
  #sessionManager: MudirJalasat;
  #intentResolver: Arraf;
  #messenger: RasulKharij;
  #ticketPattern: RegExp;

  #activeIdentifier: string | null = null;
  #activeSince: Date | null = null;

  #dispatchLock: Promise<void> = Promise.resolve();

  #processingQueue = false;

  #queue: QueuedOperation[] = [];

  #pendingDisambiguation: PendingDisambiguation | null = null;
  #pendingParentSuggestion: PendingParentSuggestion | null = null;

  #context: SiyaqMuhadatha = {
    recentMessages: [],
    focusEntity: undefined,
  };

  static readonly MAX_CONTEXT_MESSAGES = 10;

  constructor(deps: MunadiDeps) {
    this.#sessionManager = deps.sessionManager;
    this.#intentResolver = deps.intentResolver;
    this.#messenger = deps.messenger;
    this.#ticketPattern = buildTicketPattern(deps.ticketPattern);
  }


  /**
   * Serialize dispatch/callback processing to prevent concurrent state mutations.
   * Multiple Telegram messages or yield-triggered switches can arrive concurrently;
   * this ensures only one modifies dispatcher state at a time.
   */
  async #withDispatchLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const prev = this.#dispatchLock;
    this.#dispatchLock = new Promise<void>((r) => { release = r; });
    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
  }


  /**
   * Shared preamble: check pending selections, parse intent, handle commands/sandbox.
   * Returns a DispatchResult if handled, or the parsed intent if further routing needed.
   */
  async #handlePreamble(msg: InboundMessage, label: string): Promise<DispatchResult | { intent: Intent }> {
    if (this.#pendingDisambiguation) {
      const result = await this.#handleDisambiguationResponse(msg);
      if (result.handled) {
        this.#trackMessage(msg.text, result.response);
        return result;
      }
    }

    if (this.#pendingParentSuggestion) {
      const result = await this.#handleParentSuggestionResponse(msg);
      if (result.handled) {
        this.#trackMessage(msg.text, result.response);
        return result;
      }
    }

    const basicIntent = parseBasicIntent(msg.text, this.#ticketPattern);
    await logger.info("dispatcher", `${label} intent: type=${basicIntent.type}, epic=${basicIntent.identifier ?? "none"}`);

    if (basicIntent.type === "command") {
      const result = await this.#handleCommand(msg, basicIntent);
      this.#trackMessage(msg.text, result.response);
      return result;
    }

    if (basicIntent.type === "sandbox") {
      const result = await this.#handleSandboxIntent(msg, basicIntent);
      this.#trackMessage(msg.text, result.response);
      return result;
    }

    return { intent: basicIntent };
  }

  /**
   * Handle a message from the Dispatch topic (control plane).
   * Always uses intent resolver — never short-circuits to active murshid.
   * Dispatch is for ticket lookups, spawning murshidun, and commands.
   */
  async handleDispatchMessage(msg: InboundMessage): Promise<DispatchResult> {
    return this.#withDispatchLock(async () => {
      const preamble = await this.#handlePreamble(msg, "Dispatch");
      if ("handled" in preamble) return preamble;

      /** Always use intent resolver — dispatch is a control plane, not a chat relay */
      const result = await this.#handleWithArraf(msg, preamble.intent);
      this.#trackMessage(msg.text, result.response);
      return result;
    });
  }

  /**
   * Handle an inbound message from any source
   */
  async #handleInbound(msg: InboundMessage): Promise<DispatchResult> {
    const preamble = await this.#handlePreamble(msg, "Basic");
    if ("handled" in preamble) return preamble;

    const basicIntent = preamble.intent;

    if (this.#activeIdentifier && !basicIntent.identifier) {
      const session = this.#sessionManager.wajadaJalasatMurshid().find(
        (s) => s.identifier === this.#activeIdentifier
      );
      if (session) {
        await logger.info("dispatcher", `Routing to active murshid: ${this.#activeIdentifier}`);
        const result = await this.#routeToSession(session, msg);
        this.#trackMessage(msg.text, result.response);
        return result;
      }
    }

    /** For queries/operations with explicit ticket reference, use intent resolver */
    const result = await this.#handleWithArraf(msg, basicIntent);
    this.#trackMessage(msg.text, result.response);
    return result;
  }

  /**
   * Track a message in the conversation context
   */
  #trackMessage(text: string, response?: string): void {
    this.#context.recentMessages.push({
      text,
      timestamp: new Date(),
      response,
    });

    if (this.#context.recentMessages.length > Munadi.MAX_CONTEXT_MESSAGES) {
      this.#context.recentMessages = this.#context.recentMessages.slice(-Munadi.MAX_CONTEXT_MESSAGES);
    }
  }

  /**
   * Set the focus entity (most recently resolved entity)
   */
  #setFocusEntity(entity: NonNullable<NiyyaMuhallala["kiyan"]>): void {
    this.#context.focusEntity = {
      ...entity,
      resolvedAt: new Date(),
    };
  }

  /**
   * Clear recent messages after starting/resuming an murshid
   */
  #clearRecentMessages(): void {
    this.#context.recentMessages = [];
  }

  /**
   * Handle callback data from button presses
   */
  async handleCallback(source: InboundSource, data: string): Promise<DispatchResult> {
    return this.#withDispatchLock(async () => {
      /** Parse callback data format: "action:value" */
      const [action, ...valueParts] = data.split(":");
      const value = valueParts.join(":");

      switch (action) {
        case "select":
          return this.#handleDisambiguationSelection(source, value);

        case "parent":
          return this.#handleParentSelection(source, value === "yes");

        case "switch":
          return this.#switchActiveSession(value, source);

        case "cancel":
          return { handled: true, response: "Cancelled." };

        default:
          return { handled: false };
      }
    });
  }

  /**
   * Handle command messages
   */
  async #handleCommand(msg: InboundMessage, intent: Intent): Promise<DispatchResult> {
    const { command, commandArgs } = intent;

    switch (command) {
      case "switch": {
        const epicId = commandArgs?.[0]?.toUpperCase();
        if (!epicId) {
          return this.#showSwitchPicker();
        }
        return this.#switchActiveSession(epicId, msg.source);
      }

      case "status":
        return this.#getStatus();

      case "queue":
        return this.#getQueueStatus();

      case "sessions":
        return this.#jalabJalsasStatus();

      case "fail": {
        const activeId = this.#activeIdentifier;
        if (activeId) {
          return {
            handled: true,
            response: `Active session: ${activeId} (since ${this.#activeSince?.toISOString()})`,
          };
        }
        return { handled: true, response: "No active session." };
      }

      case "cancel":
        this.#pendingDisambiguation = null;
        this.#pendingParentSuggestion = null;
        return { handled: true, response: "Cancelled pending selection." };

      default:
        return { handled: true, response: `Unknown command: /${command}. Try /status, /switch, /queue, /sessions, /active, /cancel.` };
    }
  }

  /**
   * Handle message with intent resolver (smart entity lookup)
   */
  async #handleWithArraf(
    msg: InboundMessage,
    basicIntent: Intent
  ): Promise<DispatchResult> {
    if (this.#context.focusEntity) {
      const age = Date.now() - this.#context.focusEntity.resolvedAt.getTime();
      if (age > 30 * 60 * 1000) {
        this.#context.focusEntity = undefined;
      }
    }

    /** Use intent resolver for smart entity lookup, passing conversation context */
    const resolved = await this.#intentResolver.halla(msg.text, this.#context);

    await logger.info("dispatcher", `Intent resolved: status=${resolved.hala}, method=${resolved.tariqa}`);

    switch (resolved.hala) {
      case "resolved":
        return this.#handleNiyyaMuhallala(msg, resolved, basicIntent);

      case "list":
        return this.#handleListResult(resolved);

      case "needs_disambiguation":
        return this.#startDisambiguation(msg, resolved);

      case "not_found":
        return {
          handled: true,
          response: resolved.khata ?? "Could not find the entity you're referring to.",
        };

      case "error":
        return {
          handled: true,
          error: resolved.khata ?? "Failed to resolve intent.",
        };

      case "needs_llm":
        return this.#handleBasicMessage(msg, basicIntent);
    }
  }

  /**
   * Handle a list result (filtered query that returns multiple items)
   */
  #handleListResult(resolved: NiyyaMuhallala): DispatchResult {
    const candidates = resolved.murashshahun ?? [];

    if (candidates.length === 0) {
      return {
        handled: true,
        response: "No tickets found matching your filters.",
      };
    }

    const lines = [`Found ${candidates.length} ticket(s):\n`];

    for (const c of candidates) {
      const id = c.identifier ?? c.id.slice(0, 8);
      lines.push(`• ${id}: ${escapeMarkdown(c.title)}`);
    }

    return {
      handled: true,
      response: lines.join("\n"),
    };
  }

  /**
   * Handle a fully resolved intent
   */
  async #handleNiyyaMuhallala(
    msg: InboundMessage,
    resolved: NiyyaMuhallala,
    basicIntent: Intent
  ): Promise<DispatchResult> {
    const entity = resolved.kiyan!;

    this.#setFocusEntity(entity);

    /** Determine epic ID based on entity type */
    const epicId = entity.identifier ?? entity.id;

    /** Check if murshid already exists for this ticket */
    const existingSession = this.#sessionManager.wajadaJalasatMurshid().find(
      (s) => s.identifier === epicId
    );

    if (existingSession) {
      return this.#routeToSession(existingSession, msg);
    }

    if (resolved.kitabAb) {
      const parentId = resolved.kitabAb.identifier;
      const parentSession = this.#sessionManager.wajadaJalasatMurshid().find(
        (s) => s.identifier === parentId
      );

      if (parentSession) {
        await logger.info("dispatcher", `Routing to parent murshid: ${parentId}`);
        return this.#routeToSession(parentSession, msg);
      }

      if (entity.type === "ticket") {
        return this.#startParentSuggestion(msg, entity, resolved.kitabAb);
      }
    }

    /**
     * Need to start a new murshid
     * Check if this is a "proceed" action from context (e.g., "ok", "work on it")
     */
    const isProceeding = resolved.fil === "proceed";

    if (basicIntent.type === "query" && !isProceeding) {
      return {
        handled: true,
        response: `Found ${entity.type}: ${escapeMarkdown(entity.title)}\n\nNo murshid running for this. Say "work on ${epicId}" to start one.`,
      };
    }

    return this.#badaaMurshidLiKiyan(msg, entity);
  }

  /**
   * Start disambiguation flow
   */
  async #startDisambiguation(
    msg: InboundMessage,
    resolved: NiyyaMuhallala
  ): Promise<DispatchResult> {
    const candidates = resolved.murashshahun!;

    this.#pendingDisambiguation = {
      source: msg.source,
      candidates,
      originalText: msg.text,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    };

    /** Build response with buttons */
    const lines = ["Found multiple matches. Which one did you mean?\n"];

    const buttons: Array<{ text: string; data: string }> = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const label = c.identifier ? `${c.identifier}: ${escapeMarkdown(c.title)}` : escapeMarkdown(c.title);
      lines.push(`${i + 1}. [${c.type}] ${label}`);
      buttons.push({
        text: `${i + 1}. ${c.title.slice(0, 20)}`,
        data: `select:${i}`,
      });
    }

    buttons.push({ text: "Cancel", data: "select:cancel" });

    return {
      handled: true,
      response: lines.join("\n"),
      buttons,
    };
  }

  /**
   * Handle disambiguation response (button press or text)
   */
  async #handleDisambiguationResponse(msg: InboundMessage): Promise<DispatchResult> {
    const pending = this.#pendingDisambiguation!;

    if (new Date() > pending.expiresAt) {
      this.#pendingDisambiguation = null;
      return { handled: false };
    }

    /** Check for numeric selection */
    const numMatch = msg.text.match(/^(\d+)$/);
    if (numMatch) {
      const index = parseInt(numMatch[1], 10) - 1;
      return this.#handleDisambiguationSelection(msg.source, String(index));
    }

    if (msg.text.toLowerCase() === "cancel") {
      this.#pendingDisambiguation = null;
      return { handled: true, response: "Cancelled." };
    }

    return { handled: false };
  }

  /**
   * Handle disambiguation selection
   */
  async #handleDisambiguationSelection(
    source: InboundSource,
    value: string
  ): Promise<DispatchResult> {
    const pending = this.#pendingDisambiguation;
    if (!pending) {
      return { handled: true, response: "No pending selection." };
    }

    this.#pendingDisambiguation = null;

    if (value === "cancel") {
      return { handled: true, response: "Cancelled." };
    }

    const index = parseInt(value, 10);
    if (isNaN(index) || index < 0 || index >= pending.candidates.length) {
      return { handled: true, response: "Invalid selection." };
    }

    const selected = pending.candidates[index];

    return this.#badaaMurshidLiKiyan(
      { source, text: pending.originalText },
      {
        type: selected.type,
        id: selected.id,
        identifier: selected.identifier,
        title: selected.title,
        url: selected.url,
      }
    );
  }

  /**
   * Start parent suggestion flow
   * Only called when:
   * - Ticket has a parent
   * - No murshid exists for either ticket or parent
   * - Entity is a plain ticket (not already an epic)
   */
  async #startParentSuggestion(
    msg: InboundMessage,
    ticket: NonNullable<NiyyaMuhallala["kiyan"]>,
    parent: NonNullable<NiyyaMuhallala["kitabAb"]>
  ): Promise<DispatchResult> {
    this.#pendingParentSuggestion = {
      source: msg.source,
      ticket,
      parent,
      parentIsEpic: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    };

    const response = `${ticket.identifier} has parent ${parent.identifier} (${escapeMarkdown(parent.title)}).

Work on the parent instead?`;

    const buttons = [
      { text: `Yes, work on ${parent.identifier}`, data: "parent:yes" },
      { text: `No, just ${ticket.identifier}`, data: "parent:no" },
    ];

    return { handled: true, response, buttons };
  }

  /**
   * Handle parent suggestion response (text reply)
   */
  async #handleParentSuggestionResponse(msg: InboundMessage): Promise<DispatchResult> {
    const pending = this.#pendingParentSuggestion!;

    if (new Date() > pending.expiresAt) {
      this.#pendingParentSuggestion = null;
      return { handled: false };
    }

    const lower = msg.text.toLowerCase();

    if (lower === "yes" || lower === "y" || lower.includes("parent")) {
      return this.#handleParentSelection(msg.source, true);
    }

    if (lower === "no" || lower === "n" || lower.includes("just")) {
      return this.#handleParentSelection(msg.source, false);
    }

    return { handled: false };
  }

  /**
   * Handle parent selection (button press or text)
   */
  async #handleParentSelection(source: InboundSource, useParent: boolean): Promise<DispatchResult> {
    const pending = this.#pendingParentSuggestion;
    if (!pending) {
      return { handled: true, response: "No pending selection." };
    }

    this.#pendingParentSuggestion = null;

    const entity = useParent
      ? {
          type: "ticket" as NawKiyan,
          id: pending.parent.id,
          identifier: pending.parent.identifier,
          title: pending.parent.title,
          url: pending.parent.url,
        }
      : pending.ticket;

    return this.#badaaMurshidLiKiyan({ source, text: "" }, entity);
  }


  /**
   * Common murshid creation and activation.
   * Handles:
   * 1. Session creation via session manager
   * 2. Formal switchover (WIP commit, branch intaqalaIla, notifications)
   * 3. Init message for new sessions
   * 4. Resumption message for existing sessions
   *
   * Both ticket-based and sandbox murshidun use this path.
   */
  async #khalaqaWaFailaMurshid(
    params: MuatayatKhalqMurshid
  ): Promise<DispatchResult> {
    const { identifier, title, type, initMessage, url } = params;

    await logger.info("dispatcher", `Creating/activating murshid: ${identifier}`, { type, title });

    /** Step 1: Get or create session */
    const result = await this.#sessionManager.wajadaAwKhalaqa(identifier, title, type);

    if (!result) {
      return {
        handled: true,
        error: "Failed to create murshid session.",
      };
    }

    const { session, isNew, wasResumed, previousActive } = result;

    /** Step 2: Formal switchover (handles branch intaqalaIla, WIP commit, notifications) */
    const switchResult = await this.#naffadhaTahwilMurshid(
      identifier,
      session,
      previousActive,
      isNew
    );

    if (switchResult.error) {
      return switchResult;
    }

    this.#clearRecentMessages();

    if (isNew) {
      await this.#sessionManager.arsalaIlaMurshid(initMessage);
    } else if (wasResumed) {
      await this.#sessionManager.arsalaIlaMurshid(
        `Resuming session. You were previously working on: ${title}`
      );
    }

    /** Step 5: Build confirmation response */
    let response: string;

    if (isNew) {
      response = `**New murshid started for ${identifier}**\n\n`;
      response += `Title: ${escapeMarkdown(title)}\n`;
      response += `Branch: \`${session.branch}\`\n`;
      response += `Session: \`${session.id.slice(0, 16)}...\`\n`;
      if (url) {
        response += `URL: ${url}\n`;
      }
    } else if (wasResumed) {
      response = `**Resumed murshid for ${identifier}**\n\n`;
      response += `Title: ${escapeMarkdown(title)}\n`;
      response += `Branch: \`${session.branch}\`\n`;
      response += `Session: \`${session.id.slice(0, 16)}...\` (existing)\n`;
      response += `Last active: ${session.lastMessageAt}\n`;
    } else {
      response = `Murshid active for ${identifier}`;
    }

    if (previousActive && previousActive !== identifier) {
      response += `\n⚠️ Switched from ${previousActive}`;
    }

    response += `\n\n✅ Active session: ${identifier}`;

    if (Object.keys(session.channels).length > 0) {
      response += `\n\nUse the dedicated topic/channel for conversation.`;
    }

    return {
      handled: true,
      response,
    };
  }

  /**
   * Execute the formal switchover for an murshid.
   * Handles WIP commit, branch intaqalaIla, and state updates.
   * Used for both new and existing murshidun.
   */
  async #naffadhaTahwilMurshid(
    identifier: string,
    session: JalsatMurshid,
    previousActive: string | null,
    isNew: boolean
  ): Promise<DispatchResult> {
    const previousSession = previousActive
      ? this.#sessionManager.jalabMurshid(previousActive)
      : null;

    if (previousActive === identifier) {
      this.setActiveSession(identifier);
      return { handled: true };
    }

    await logger.info("dispatcher", `Executing switchover: ${previousActive ?? "none"} → ${identifier}`);

    this.#sessionManager.wadaaQuflGit(true);

    let wipCommitted = false;

    try {
    if (previousSession) {
      await this.#interruptSession(previousSession, identifier);
    }

    /** Step 2: WIP commit if dirty */
    const huwaWasikh = await git.huwaWasikh();
    if (huwaWasikh && previousActive) {
      await logger.info("dispatcher", `Working directory dirty, creating WIP commit for ${previousActive}`);
      wipCommitted = await git.khalaqaIltizamMuaqqat(previousActive);
    }

    if (previousSession) {
      await this.#sessionManager.jaddadaḤalatMurshid(previousActive!, "sakin");
      await this.#notifyPreviousSession(previousSession, wipCommitted);
    }

    /** Step 4: Checkout target branch (creates if doesn't exist for new murshidun) */
    const intaqalaIlaSuccess = await git.intaqalaIla(session.branch);
    if (!intaqalaIlaSuccess) {
      if (previousSession) {
        await this.#sessionManager.jaddadaḤalatMurshid(previousActive!, "fail");
      }
      return {
        handled: true,
        error: `Failed to intaqalaIla branch ${session.branch}. Switch aborted.`,
      };
    }

    if (!isNew) {
      await git.pull(session.branch);
    }

    try {
      await this.#sessionManager.jaddadaḤalatMurshid(identifier, "fail");
      this.#sessionManager.wadaaMurshidFaail(identifier);
      this.#activeIdentifier = identifier;
      this.#activeSince = new Date();
    } catch (err) {
      void logger.error("dispatcher", `Failed to activate ${identifier}, rolling back`, { error: String(err) });
      if (previousSession) {
        await this.#sessionManager.jaddadaḤalatMurshid(previousActive!, "fail").catch(() => {});
        this.#sessionManager.wadaaMurshidFaail(previousActive);
      }
      this.#activeIdentifier = previousActive;
      this.#activeSince = previousActive ? new Date() : null;
      return { handled: true, error: `Failed to activate ${identifier}: ${err}` };
    }

    try {
      await this.#notifyNewActiveSession(session, previousActive);
    } catch (err) {
      void logger.error("dispatcher", `Failed to notify new session ${identifier}`, { error: String(err) });
    }

    try {
      await this.#processQueueForEpic(identifier);
    } catch (err) {
      void logger.error("dispatcher", `Failed to drain queue for ${identifier}`, { error: String(err) });
    }

    try {
      await this.#messenger.arsalaMunassaq("dispatch", `Active: **${identifier}**`);
    } catch (err) {
      void logger.error("dispatcher", `Failed to send dispatch notification`, { error: String(err) });
    }

    await logger.info("dispatcher", `Control switched to ${identifier}`);

    return { handled: true };

    } finally {
      this.#sessionManager.wadaaQuflGit(false);
    }
  }

  /**
   * Start murshid for a ticket entity (ticket/epic/project)
   */
  async #badaaMurshidLiKiyan(
    _msg: InboundMessage,
    entity: NonNullable<NiyyaMuhallala["kiyan"]>
  ): Promise<DispatchResult> {
    const identifier = entity.identifier ?? entity.id;

    const initMessage = `You have been assigned you to work on:

**${entity.type.toUpperCase()}**: ${entity.title}
**ID**: ${identifier}
**URL**: ${entity.url}

Use \`pm_read_ticket\` to fetch full details and begin planning.`;

    /** Map entity type to murshid type */
    const murshidType: "epic" | "chore" =
      (entity.type === "epic" || entity.type === "project" || entity.type === "milestone")
        ? "epic"
        : "chore";

    return this.#khalaqaWaFailaMurshid({
      identifier,
      title: entity.title,
      type: murshidType,
      initMessage,
      url: entity.url,
    });
  }

  /**
   * Public entry point for activating an murshid from a ticket URL.
   * Routes through the full switch protocol (#khalaqaWaFailaMurshid)
   * so WIP commit, branch intaqalaIla, and interrupts all happen correctly.
   */
  async activateForTicketUrl(
    identifier: string,
    title: string,
    url: string,
    additionalContext?: string,
  ): Promise<DispatchResult> {
    const contextLine = additionalContext ? `\nAdditional context: ${additionalContext}` : "";

    const initMessage = `A ticket URL has been provided to work on:

URL: ${url}${contextLine}

Use \`pm_read_ticket\` to understand this entity, then plan your approach.`;

    return this.#khalaqaWaFailaMurshid({
      identifier,
      title,
      type: "epic",
      initMessage,
      url,
    });
  }

  /**
   * Handle sandbox/brainstorm intent - freeform work without tickets
   */
  async #handleSandboxIntent(msg: InboundMessage, intent: Intent): Promise<DispatchResult> {
    const sandboxName = intent.sandboxName;

    if (!sandboxName) {
      return {
        handled: true,
        response: "What would you like to call this sandbox? (e.g., `sandbox pos-simulator`)",
      };
    }

    const identifier = `SANDBOX-${sandboxName}`;

    const initMessage = `A sandbox session has been started a sandbox session for you.

**Mode**: Sandbox (no ticket)
**Name**: ${sandboxName}
**Branch**: \`sandbox/${sandboxName}\`
**Original request**: "${msg.text}"

This is freeform work - no ticket tracking, no PR requirements. Brainstorm, prototype, experiment freely.

When you want to formalize this work into tickets, let al-Kimyawi know.`;

    return this.#khalaqaWaFailaMurshid({
      identifier,
      title: `Sandbox: ${sandboxName}`,
      type: "sandbox",
      initMessage,
    });
  }

  /**
   * Handle basic message (fallback when intent resolver returns needs_llm)
   */
  async #handleBasicMessage(msg: InboundMessage, intent: Intent): Promise<DispatchResult> {
    const { identifier, type } = intent;
    let targetId: string | null = identifier;

    if (!targetId) {
      targetId = this.#activeIdentifier;

      if (!targetId) {
        return {
          handled: true,
          response: "No active session. Mention a ticket ID or send a ticket URL to start one.",
        };
      }
    }

    const session = this.#sessionManager.wajadaJalasatMurshid().find(
      (s) => s.identifier === targetId
    );

    if (!session) {
      return {
        handled: true,
        response: `No murshid for ${targetId}. Send a ticket URL to start one.`,
      };
    }

    if (type === "query") {
      return this.#routeToSession(session, msg);
    }

    if (this.#activeIdentifier !== targetId) {
      return this.#queueOperation(targetId, msg);
    }

    return this.#routeToSession(session, msg);
  }

  /**
   * Route message to murshid session
   */
  async #routeToSession(
    session: JalsatMurshid,
    msg: InboundMessage
  ): Promise<DispatchResult> {
    const prefix = msg.source === "pr_comment"
      ? `PR Comment from @${msg.author}:\n\n`
      : "Al-Kimyawi says:\n\n";

    const success = await this.#sessionManager.arsalaIlaMurshidById(
      session.identifier,
      `${prefix}${msg.text}`
    );

    if (success) {
      return {
        handled: true,
        response: msg.source === "cli" ? undefined : `Message sent to ${session.identifier}.`,
      };
    }

    return { handled: true, error: `Failed to send message to ${session.identifier}.` };
  }

  /**
   * Queue an operation for later execution
   */
  async #queueOperation(identifier: string, msg: InboundMessage): Promise<DispatchResult> {
    const op: QueuedOperation = {
      identifier,
      message: msg.text,
      queuedAt: new Date(),
      source: msg.source,
      messageId: msg.messageId,
    };

    this.#queue.push(op);

    await logger.info("dispatcher", `Queued operation for ${identifier}`, {
      queueLength: this.#queue.length,
    });

    return {
      handled: true,
      queued: true,
      response: `Queued. ${this.#activeIdentifier} is currently active. Will notify when ${identifier} becomes active.`,
    };
  }


  setActiveSession(identifier: string | null): void {
    this.#activeIdentifier = identifier;
    this.#activeSince = identifier ? new Date() : null;
    this.#sessionManager.wadaaMurshidFaail(identifier);
    void logger.info("dispatcher", `Active session set to ${identifier ?? "none"}`);
  }

  hawiyyaFaila(): string | null {
    return this.#activeIdentifier;
  }

  /**
   * Restore active murshid on daemon startup.
   * Uses the centralized #naffadhaTahwilMurshid to ensure branch intaqalaIla,
   * notification, and all other switchover logic happens.
   */
  async istarjaaActiveOnStartup(): Promise<void> {
    const activeId = this.#sessionManager.wajadaMurshidFaailId();
    if (!activeId) {
      await logger.info("dispatcher", "No active murshid on startup");
      return;
    }

    const session = this.#sessionManager.jalabMurshid(activeId);
    if (!session) {
      await logger.warn("dispatcher", `Active murshid ${activeId} not found in session manager`);
      return;
    }

    await logger.info("dispatcher", `Restoring active murshid on startup: ${activeId}`);

    await this.#naffadhaTahwilMurshid(activeId, session, null, false);
  }

  /**
   * Manual switch command handler. Validates target exists, delegates to
   * #naffadhaTahwilMurshid for the full switch protocol (interrupt,
   * WIP commit, branch intaqalaIla, activation, queue drain, notification).
   */
  async #switchActiveSession(epicId: string, _source: InboundSource): Promise<DispatchResult> {
    const tarjalabJalsa = this.#sessionManager.jalabMurshid(epicId);

    if (!tarjalabJalsa) {
      return { handled: true, response: `No murshid for ${epicId}. Start one first.` };
    }

    const previousEpicId = this.#activeIdentifier;

    if (previousEpicId === epicId) {
      return {
        handled: true,
        response: `✅ Already active: ${epicId}\n\nBranch: ${tarjalabJalsa.branch}\nSession: ${tarjalabJalsa.id.slice(0, 16)}...`,
      };
    }

    /** Execute the core switchover logic (handles notification, queue, and dispatch) */
    const switchResult = await this.#naffadhaTahwilMurshid(
      epicId,
      tarjalabJalsa,
      previousEpicId,
      false
    );

    if (switchResult.error) {
      return switchResult;
    }

    return { handled: true, response: `Active: **${epicId}**` };
  }

  /**
   * Send INTERRUPT to previous murshid and all its sanis
   */
  async #interruptSession(session: JalsatMurshid, newActiveId: string): Promise<void> {
    const interruptMsg = `🛑 INTERRUPT: Control is being transferred to ${newActiveId}.

STOP all operations immediately.
Do NOT make any more git operations.
Do NOT invoke any more sanis.

You will be notified when you are IDLE.`;

    await this.#sessionManager.arsalaIlaMurshidById(session.identifier, interruptMsg);

    await new Promise((r) => setTimeout(r, 500));
  }

  /**
   * Notify previous session that it's now IDLE
   */
  async #notifyPreviousSession(session: JalsatMurshid, wipCommitted: boolean): Promise<void> {
    const msg = `CONTROL TRANSFERRED: You are now IDLE.

Branch: ${session.branch} (no longer checked out)
WIP: ${wipCommitted ? "committed" : "clean"}

You will continue to receive issue tracker/GitHub updates.
Use \`pm_demand_control\` when you have actionable work.`;

    await this.#sessionManager.arsalaIlaMurshidById(session.identifier, msg);
  }

  /**
   * Notify new session that it's now ACTIVE
   */
  async #notifyNewActiveSession(session: JalsatMurshid, previousId: string | null): Promise<void> {
    const msg = `✅ CONTROL GRANTED: You are now ACTIVE.

Branch: ${session.branch} (checked out)
Previous active: ${previousId ?? "none"}

You may now perform git operations.`;

    await this.#sessionManager.arsalaIlaMurshidById(session.identifier, msg);
  }

  async #processQueueForEpic(epicId: string): Promise<void> {
    if (this.#processingQueue) return;
    this.#processingQueue = true;
    try {
      const opsForEpic = this.#queue.filter((op) => op.identifier === epicId);
      this.#queue = this.#queue.filter((op) => op.identifier !== epicId);

      for (const op of opsForEpic) {
        await this.#handleInbound({
          source: op.source,
          text: op.message,
          messageId: op.messageId,
        });
      }
    } finally {
      this.#processingQueue = false;
    }
  }


  #getStatus(): DispatchResult {
    const active = this.#activeIdentifier;
    const queueLen = this.#queue.length;
    const murshidun = this.#sessionManager.wajadaJalasatMurshid();

    let response = "**Status**\n\n";

    if (active) {
      const activeSession = murshidun.find((o) => o.identifier === active);
      response += `✅ **Active: ${active}**\n`;
      if (activeSession) {
        response += `   Session: ${activeSession.id.slice(0, 16)}...\n`;
        response += `   Since: ${this.#activeSince?.toISOString()}\n`;
      }
    } else {
      response += `⚪ **Active: none**\n`;
    }

    response += `\n`;

    response += `Murshidun: ${murshidun.length}\n`;
    response += `Queue: ${queueLen} operation(s)\n`;

    /** List other murshidun (if any) */
    const others = murshidun.filter((o) => o.identifier !== active);
    if (others.length > 0) {
      response += `\n**Other murshidun (idle):**\n`;
      for (const o of others) {
        response += `  - ${o.identifier}\n`;
      }
    }

    return { handled: true, response };
  }

  #getQueueStatus(): DispatchResult {
    if (this.#queue.length === 0) {
      return { handled: true, response: "Operation queue is empty." };
    }

    let response = "**Operation Queue**\n\n";

    for (let i = 0; i < this.#queue.length; i++) {
      const op = this.#queue[i];
      const age = Math.round((Date.now() - op.queuedAt.getTime()) / 1000 / 60);
      response += `${i + 1}. ${op.identifier}: "${op.message.slice(0, 50)}..." (${age}m ago)\n`;
    }

    return { handled: true, response };
  }

  #jalabJalsasStatus(): DispatchResult {
    const murshidun = this.#sessionManager.wajadaJalasatMurshid();

    /** Build response with switch buttons for idle sessions */
    let response = "**Sessions**\n\n";

    if (murshidun.length === 0) {
      response += "No murshidun.\n";
    } else {
      for (const o of murshidun) {
        const yakunuFail = o.identifier === this.#activeIdentifier;
        if (yakunuFail) {
          response += `→ **${o.identifier}** (active)\n`;
          response += `  ${escapeMarkdown(o.title)}\n\n`;
        } else {
          response += `  ${o.identifier} (idle)\n`;
          response += `  ${escapeMarkdown(o.title)}\n\n`;
        }
      }
    }

    /** Build buttons for idle sessions */
    const idleSessions = murshidun.filter((o) => o.identifier !== this.#activeIdentifier);
    const buttons = idleSessions.map((o) => ({
      text: `Switch to ${o.identifier}`,
      data: `switch:${o.identifier}`,
    }));

    return { handled: true, response, buttons: buttons.length > 0 ? buttons : undefined };
  }

  #showSwitchPicker(): DispatchResult {
    const murshidun = this.#sessionManager.wajadaJalasatMurshid();
    const idleSessions = murshidun.filter((o) => o.identifier !== this.#activeIdentifier);

    if (murshidun.length === 0) {
      return { handled: true, response: "No murshidun to switch to." };
    }

    if (idleSessions.length === 0) {
      const active = this.#activeIdentifier;
      return {
        handled: true,
        response: `Only one murshid exists: ${active} (already active)`,
      };
    }

    let response = "**Switch Active Session**\n\n";

    if (this.#activeIdentifier) {
      const activeSession = murshidun.find((o) => o.identifier === this.#activeIdentifier);
      response += `Current: **${this.#activeIdentifier}**\n`;
      if (activeSession) {
        response += `${escapeMarkdown(activeSession.title)}\n`;
      }
      response += "\n";
    }

    response += "Choose:\n";
    for (let i = 0; i < idleSessions.length; i++) {
      const o = idleSessions[i];
      response += `[${i + 1}] ${o.identifier} - ${escapeMarkdown(o.title)}\n`;
    }

    /** Build buttons */
    const buttons = idleSessions.map((o, i) => ({
      text: `[${i + 1}] ${o.identifier}`,
      data: `switch:${o.identifier}`,
    }));
    buttons.push({ text: "Cancel", data: "cancel" });

    return { handled: true, response, buttons };
  }

}


export function istadaaMunadi(deps: MunadiDeps): Munadi {
  return new Munadi(deps);
}
