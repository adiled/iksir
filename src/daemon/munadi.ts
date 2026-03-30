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
import { MudīrJalasāt } from "./session-manager.ts";
import {
  IntentResolver,
  type ResolvedIntent,
  type EntityType,
} from "./intent-resolver.ts";
import * as git from "../git/operations.ts";
import type { TaṣmīmIksir, JalsatMurshid, MessengerOutbound } from "../types.ts";

// =============================================================================
// Types
// =============================================================================

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
  prNumber?: number;
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
  candidates: NonNullable<ResolvedIntent["candidates"]>;
  originalText: string;
  expiresAt: Date;
}

/** Pending parent suggestion state */
interface PendingParentSuggestion {
  source: InboundSource;
  ticket: NonNullable<ResolvedIntent["entity"]>;
  parent: NonNullable<ResolvedIntent["parentEpic"]>;
  parentIsEpic: boolean; // True if parent has children or epic label
  expiresAt: Date;
}

/** A message in the conversation history */
interface ConversationMessage {
  text: string;
  timestamp: Date;
  resolved?: ResolvedIntent;
  response?: string;
}

/** Short-term conversation context for intent resolution */
export interface ConversationContext {
  /** Recent messages in the conversation */
  recentMessages: ConversationMessage[];

  /** The current focus entity (most recently resolved) */
  focusEntity?: {
    type: EntityType;
    id: string;
    identifier?: string;
    title: string;
    url: string;
    resolvedAt: Date;
  };
}

interface MunadiDeps {
  config: TaṣmīmIksir;
  sessionManager: MudīrJalasāt;
  intentResolver: IntentResolver;
  messenger: MessengerOutbound;
}

/**
 * Parameters for creating/activating an murshid.
 * Used by the common #khalaqaWaFa'alaMurshid method.
 */
interface MuʿṭayātKhalqMurshid {
  identifier: string;
  title: string;
  type: "epic" | "chore" | "sandbox";
  /** Init message to send to new murshidun */
  initMessage: string;
  /** Optional ticket URL for ticket-based murshidun */
  url?: string;
}

// =============================================================================
// Command Intent Parsing (deterministic)
// =============================================================================

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

// Query indicators
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

// Operation indicators
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

// Sandbox/brainstorm indicators - freeform work without tickets
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

// Extract sandbox name from text (e.g., "the epic would be pos-simulator" -> "pos-simulator")
const SANDBOX_NAME_PATTERNS = [
  /(?:epic|project|name|call(?:ed)?|named)\s+(?:would\s+be\s+|is\s+|it\s+)?["']?([a-z0-9][-a-z0-9_]*)/i,
  /["']([a-z0-9][-a-z0-9_]*)["']/i,  // quoted name
];

/**
 * Parse basic intent (commands, query vs operation)
 * @param ticketPattern - Regex for matching ticket identifiers (from config)
 */
function parseBasicIntent(text: string, ticketPattern: RegExp): Intent {
  const trimmed = text.trim();

  // Check for commands
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

  // Extract identifier if present
  let identifier: string | null = null;
  const idMatch = trimmed.match(ticketPattern);
  if (idMatch) {
    identifier = idMatch[1].toUpperCase();
  }

  // Check for sandbox/brainstorm intent first (highest priority)
  let isSandbox = false;
  let sandboxName: string | undefined;

  for (const pattern of SANDBOX_PATTERNS) {
    if (pattern.test(trimmed)) {
      isSandbox = true;
      break;
    }
  }

  if (isSandbox) {
    // Try to extract sandbox name
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

  // Classify as query or operation
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

// =============================================================================
// Dispatcher
// =============================================================================

export class Munadi {
  // @ts-expect-error Config kept for future use (quiet hours, etc.)
  #config: TaṣmīmIksir;
  #sessionManager: MudīrJalasāt;
  #intentResolver: IntentResolver;
  #messenger: MessengerOutbound;
  #ticketPattern: RegExp;

  // Active session state
  #activeIdentifier: string | null = null;
  #activeSince: Date | null = null;

  // Serialization lock — prevents concurrent dispatch/callback processing
  #dispatchLock: Promise<void> = Promise.resolve();

  // Re-entry guard for queue processing
  #processingQueue = false;

  // Operation queue (FIFO)
  #queue: QueuedOperation[] = [];

  // Pending user selections
  #pendingDisambiguation: PendingDisambiguation | null = null;
  #pendingParentSuggestion: PendingParentSuggestion | null = null;

  // Conversation context (short-term memory for intent resolution)
  #context: ConversationContext = {
    recentMessages: [],
    focusEntity: undefined,
  };

  // Max messages to keep in context
  static readonly MAX_CONTEXT_MESSAGES = 10;

  constructor(deps: MunadiDeps) {
    this.#config = deps.config;
    this.#sessionManager = deps.sessionManager;
    this.#intentResolver = deps.intentResolver;
    this.#messenger = deps.messenger;
    this.#ticketPattern = buildTicketPattern(deps.config.issueTracker?.ticketPattern);
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================

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

  // ===========================================================================
  // Inbound Message Handling
  // ===========================================================================

  /**
   * Shared preamble: check pending selections, parse intent, handle commands/sandbox.
   * Returns a DispatchResult if handled, or the parsed intent if further routing needed.
   */
  async #handlePreamble(msg: InboundMessage, label: string): Promise<DispatchResult | { intent: Intent }> {
    // Check for pending selections first
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

      // Always use intent resolver — dispatch is a control plane, not a chat relay
      const result = await this.#handleWithIntentResolver(msg, preamble.intent);
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

    // Default routing: if active murshid exists and message doesn't
    // explicitly reference a different ticket, route directly to active
    if (this.#activeIdentifier && !basicIntent.identifier) {
      const session = this.#sessionManager.wajadaJalasātMurshid().find(
        (s) => s.identifier === this.#activeIdentifier
      );
      if (session) {
        await logger.info("dispatcher", `Routing to active murshid: ${this.#activeIdentifier}`);
        const result = await this.#routeToSession(session, msg);
        this.#trackMessage(msg.text, result.response);
        return result;
      }
    }

    // For queries/operations with explicit ticket reference, use intent resolver
    const result = await this.#handleWithIntentResolver(msg, basicIntent);
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

    // Keep only the last N messages
    if (this.#context.recentMessages.length > Dispatcher.MAX_CONTEXT_MESSAGES) {
      this.#context.recentMessages = this.#context.recentMessages.slice(-Dispatcher.MAX_CONTEXT_MESSAGES);
    }
  }

  /**
   * Set the focus entity (most recently resolved entity)
   */
  #setFocusEntity(entity: NonNullable<ResolvedIntent["entity"]>): void {
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
      // Parse callback data format: "action:value"
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
        return this.#getSessionsStatus();

      case "fā'il": {
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
  async #handleWithIntentResolver(
    msg: InboundMessage,
    basicIntent: Intent
  ): Promise<DispatchResult> {
    // Expire stale focus entity (30 min TTL)
    if (this.#context.focusEntity) {
      const age = Date.now() - this.#context.focusEntity.resolvedAt.getTime();
      if (age > 30 * 60 * 1000) {
        this.#context.focusEntity = undefined;
      }
    }

    // Use intent resolver for smart entity lookup, passing conversation context
    const resolved = await this.#intentResolver.resolve(msg.text, this.#context);

    await logger.info("dispatcher", `Intent resolved: status=${resolved.status}, method=${resolved.method}`);

    switch (resolved.status) {
      case "resolved":
        return this.#handleResolvedIntent(msg, resolved, basicIntent);

      case "list":
        return this.#handleListResult(resolved);

      case "needs_disambiguation":
        return this.#startDisambiguation(msg, resolved);

      case "not_found":
        return {
          handled: true,
          response: resolved.error ?? "Could not find the entity you're referring to.",
        };

      case "error":
        return {
          handled: true,
          error: resolved.error ?? "Failed to resolve intent.",
        };

      case "needs_llm":
        // Fallback to basic routing (shouldn't normally happen)
        return this.#handleBasicMessage(msg, basicIntent);
    }
  }

  /**
   * Handle a list result (filtered query that returns multiple items)
   */
  #handleListResult(resolved: ResolvedIntent): DispatchResult {
    const candidates = resolved.candidates ?? [];

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
  async #handleResolvedIntent(
    msg: InboundMessage,
    resolved: ResolvedIntent,
    basicIntent: Intent
  ): Promise<DispatchResult> {
    const entity = resolved.entity!;

    // Track the resolved entity as focus
    this.#setFocusEntity(entity);

    // Determine epic ID based on entity type
    const epicId = entity.identifier ?? entity.id;

    // Check if murshid already exists for this ticket
    const existingSession = this.#sessionManager.wajadaJalasātMurshid().find(
      (s) => s.identifier === epicId
    );

    if (existingSession) {
      // Route to existing session - no need to suggest parent
      return this.#routeToSession(existingSession, msg);
    }

    // Check if murshid exists for the parent
    if (resolved.parentEpic) {
      const parentId = resolved.parentEpic.identifier;
      const parentSession = this.#sessionManager.wajadaJalasātMurshid().find(
        (s) => s.identifier === parentId
      );

      if (parentSession) {
        // Parent has murshid - route there instead
        await logger.info("dispatcher", `Routing to parent murshid: ${parentId}`);
        return this.#routeToSession(parentSession, msg);
      }

      // No murshid for either - suggest working on parent if it's an epic
      // Only suggest if entity is a plain ticket (not already an epic)
      if (entity.type === "ticket") {
        return this.#startParentSuggestion(msg, entity, resolved.parentEpic);
      }
    }

    // Need to start a new murshid
    // Check if this is a "proceed" action from context (e.g., "ok", "work on it")
    const isProceeding = resolved.action === "proceed";

    if (basicIntent.type === "query" && !isProceeding) {
      return {
        handled: true,
        response: `Found ${entity.type}: ${escapeMarkdown(entity.title)}\n\nNo murshid running for this. Say "work on ${epicId}" to start one.`,
      };
    }

    // Start murshid for this entity
    return this.#badaʾaMurshidLiKiyān(msg, entity);
  }

  /**
   * Start disambiguation flow
   */
  async #startDisambiguation(
    msg: InboundMessage,
    resolved: ResolvedIntent
  ): Promise<DispatchResult> {
    const candidates = resolved.candidates!;

    // Store pending state
    this.#pendingDisambiguation = {
      source: msg.source,
      candidates,
      originalText: msg.text,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min expiry
    };

    // Build response with buttons
    const lines = ["Found multiple matches. Which one did you mean?\n"];

    const buttons: Array<{ text: string; data: string }> = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const label = c.identifier ? `${c.identifier}: ${escapeMarkdown(c.title)}` : escapeMarkdown(c.title);
      lines.push(`${i + 1}. [${c.type}] ${label}`);
      buttons.push({
        text: `${i + 1}. ${c.title.slice(0, 20)}`,  // Button text doesn't need escaping
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

    // Check expiry
    if (new Date() > pending.expiresAt) {
      this.#pendingDisambiguation = null;
      return { handled: false };
    }

    // Check for numeric selection
    const numMatch = msg.text.match(/^(\d+)$/);
    if (numMatch) {
      const index = parseInt(numMatch[1], 10) - 1;
      return this.#handleDisambiguationSelection(msg.source, String(index));
    }

    // Check for cancel
    if (msg.text.toLowerCase() === "cancel") {
      this.#pendingDisambiguation = null;
      return { handled: true, response: "Cancelled." };
    }

    // Not a selection response
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

    // Start murshid for selected entity
    return this.#badaʾaMurshidLiKiyān(
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
    ticket: NonNullable<ResolvedIntent["entity"]>,
    parent: NonNullable<ResolvedIntent["parentEpic"]>
  ): Promise<DispatchResult> {
    // Store pending state
    // Note: We don't actually know if parent is an "epic" - it's just a parent ticket
    // The intent resolver sets parentEpic for any parent, we display appropriately
    this.#pendingParentSuggestion = {
      source: msg.source,
      ticket,
      parent,
      parentIsEpic: false, // We'd need to check, but simpler to just call it "parent"
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

    // Check expiry
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

    // Not a selection response
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
          type: "ticket" as EntityType, // Use ticket, not epic - we don't actually know
          id: pending.parent.id,
          identifier: pending.parent.identifier,
          title: pending.parent.title,
          url: pending.parent.url,
        }
      : pending.ticket;

    return this.#badaʾaMurshidLiKiyān({ source, text: "" }, entity);
  }

  // ===========================================================================
  // Murshid Creation (Common Path)
  // ===========================================================================

  /**
   * Common murshid creation and activation.
   * Handles:
   * 1. Session creation via session manager
   * 2. Formal switchover (WIP commit, branch checkout, notifications)
   * 3. Init message for new sessions
   * 4. Resumption message for existing sessions
   *
   * Both ticket-based and sandbox murshidun use this path.
   */
  async #khalaqaWaFa'alaMurshid(
    params: MuʿṭayātKhalqMurshid
  ): Promise<DispatchResult> {
    const { identifier, title, type, initMessage, url } = params;

    await logger.info("dispatcher", `Creating/activating murshid: ${identifier}`, { type, title });

    // Step 1: Get or create session
    const result = await this.#sessionManager.wajadaAwKhalaqa(identifier, title, type);

    if (!result) {
      return {
        handled: true,
        error: "Failed to create murshid session.",
      };
    }

    const { session, isNew, wasResumed, previousActive } = result;

    // Step 2: Formal switchover (handles branch checkout, WIP commit, notifications)
    const switchResult = await this.#naffadhaTaḥwīlMurshid(
      identifier,
      session,
      previousActive,
      isNew
    );

    if (switchResult.error) {
      return switchResult;
    }

    // Step 3: Clear dispatcher context
    this.#clearRecentMessages();

    // Step 4: Send appropriate message to murshid
    if (isNew) {
      await this.#sessionManager.arsalaIlaMurshid(initMessage);
    } else if (wasResumed) {
      await this.#sessionManager.arsalaIlaMurshid(
        `Resuming session. You were previously working on: ${title}`
      );
    }

    // Step 5: Build confirmation response
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

    // Add channel hint if available
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
   * Handles WIP commit, branch checkout, and state updates.
   * Used for both new and existing murshidun.
   */
  async #naffadhaTaḥwīlMurshid(
    identifier: string,
    session: JalsatMurshid,
    previousActive: string | null,
    isNew: boolean
  ): Promise<DispatchResult> {
    const previousSession = previousActive
      ? this.#sessionManager.getMurshid(previousActive)
      : null;

    // Already active - no switch needed
    if (previousActive === identifier) {
      this.setActiveSession(identifier);
      return { handled: true };
    }

    await logger.info("dispatcher", `Executing switchover: ${previousActive ?? "none"} → ${identifier}`);

    // Raise git fence — blocks PM-MCP git ops during switch
    this.#sessionManager.setGitFence(true);

    let wipCommitted = false;

    try {
    // Step 1: Interrupt previous murshid if exists
    if (previousSession) {
      await this.#interruptSession(previousSession, identifier);
    }

    // Step 2: WIP commit if dirty
    const isDirty = await git.isDirty();
    if (isDirty && previousActive) {
      await logger.info("dispatcher", `Working directory dirty, creating WIP commit for ${previousActive}`);
      wipCommitted = await git.createWipCommit(previousActive);
    }

    // Step 3: Update previous state to IDLE
    if (previousSession) {
      await this.#sessionManager.jaddadaḤālatMurshid(previousActive!, "sākin");
      await this.#notifyPreviousSession(previousSession, wipCommitted);
    }

    // Step 4: Checkout target branch (creates if doesn't exist for new murshidun)
    const checkoutSuccess = await git.checkout(session.branch);
    if (!checkoutSuccess) {
      // Abort switch - restore previous as active
      if (previousSession) {
        await this.#sessionManager.jaddadaḤālatMurshid(previousActive!, "fā'il");
      }
      return {
        handled: true,
        error: `Failed to checkout branch ${session.branch}. Switch aborted.`,
      };
    }

    // Pull latest (non-fatal if fails - branch might not exist on remote yet)
    if (!isNew) {
      await git.pull(session.branch);
    }

    // Step 5: Activate new murshid (DB first, then local state)
    try {
      await this.#sessionManager.jaddadaḤālatMurshid(identifier, "fā'il");
      this.#sessionManager.waḍaʿaMurshidFāʿil(identifier);
      this.#activeIdentifier = identifier;
      this.#activeSince = new Date();
    } catch (err) {
      // DB failed — rollback: try to restore previous session as active
      void logger.error("dispatcher", `Failed to activate ${identifier}, rolling back`, { error: String(err) });
      if (previousSession) {
        await this.#sessionManager.jaddadaḤālatMurshid(previousActive!, "fā'il").catch(() => {});
        this.#sessionManager.waḍaʿaMurshidFāʿil(previousActive);
      }
      this.#activeIdentifier = previousActive;
      this.#activeSince = previousActive ? new Date() : null;
      return { handled: true, error: `Failed to activate ${identifier}: ${err}` };
    }

    // Steps 6-8: Non-fatal — switch succeeded, these are best-effort
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
      await this.#messenger.sendFormatted("dispatch", `Active: **${identifier}**`);
    } catch (err) {
      void logger.error("dispatcher", `Failed to send dispatch notification`, { error: String(err) });
    }

    await logger.info("dispatcher", `Control switched to ${identifier}`);

    return { handled: true };

    } finally {
      this.#sessionManager.setGitFence(false);
    }
  }

  /**
   * Start murshid for a ticket entity (ticket/epic/project)
   */
  async #badaʾaMurshidLiKiyān(
    _msg: InboundMessage,
    entity: NonNullable<ResolvedIntent["entity"]>
  ): Promise<DispatchResult> {
    const identifier = entity.identifier ?? entity.id;

    const initMessage = `You have been assigned you to work on:

**${entity.type.toUpperCase()}**: ${entity.title}
**ID**: ${identifier}
**URL**: ${entity.url}

Use \`pm_read_ticket\` to fetch full details and begin planning.`;

    // Map entity type to murshid type
    const murshidType: "epic" | "chore" =
      (entity.type === "epic" || entity.type === "project" || entity.type === "milestone")
        ? "epic"
        : "chore";

    return this.#khalaqaWaFa'alaMurshid({
      identifier,
      title: entity.title,
      type: murshidType,
      initMessage,
      url: entity.url,
    });
  }

  /**
   * Public entry point for activating an murshid from a ticket URL.
   * Routes through the full switch protocol (#khalaqaWaFa'alaMurshid)
   * so WIP commit, branch checkout, and interrupts all happen correctly.
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

    return this.#khalaqaWaFa'alaMurshid({
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

    // If no name extracted, ask for one
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

When you want to formalize this work into tickets, let the operator know.`;

    return this.#khalaqaWaFa'alaMurshid({
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

    const session = this.#sessionManager.wajadaJalasātMurshid().find(
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
      : "Operator says:\n\n";

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

  // ===========================================================================
  // Active Session Management
  // ===========================================================================

  setActiveSession(identifier: string | null): void {
    this.#activeIdentifier = identifier;
    this.#activeSince = identifier ? new Date() : null;
    // Keep session-manager in sync to avoid dual-state drift
    this.#sessionManager.waḍaʿaMurshidFāʿil(identifier);
    void logger.info("dispatcher", `Active session set to ${identifier ?? "none"}`);
  }

  getActiveIdentifier(): string | null {
    return this.#activeIdentifier;
  }

  /**
   * Restore active murshid on daemon startup.
   * Uses the centralized #naffadhaTaḥwīlMurshid to ensure branch checkout,
   * notification, and all other switchover logic happens.
   */
  async restoreActiveOnStartup(): Promise<void> {
    const activeId = this.#sessionManager.wajadaMurshidFāʿilId();
    if (!activeId) {
      await logger.info("dispatcher", "No active murshid on startup");
      return;
    }

    const session = this.#sessionManager.getMurshid(activeId);
    if (!session) {
      await logger.warn("dispatcher", `Active murshid ${activeId} not found in session manager`);
      return;
    }

    await logger.info("dispatcher", `Restoring active murshid on startup: ${activeId}`);

    // Use centralized switch logic - handles branch checkout, notification, queue, etc.
    await this.#naffadhaTaḥwīlMurshid(activeId, session, null, false);
  }

  /**
   * Manual switch command handler. Validates target exists, delegates to
   * #naffadhaTaḥwīlMurshid for the full switch protocol (interrupt,
   * WIP commit, branch checkout, activation, queue drain, notification).
   */
  async #switchActiveSession(epicId: string, _source: InboundSource): Promise<DispatchResult> {
    const targetSession = this.#sessionManager.getMurshid(epicId);

    if (!targetSession) {
      return { handled: true, response: `No murshid for ${epicId}. Start one first.` };
    }

    const previousEpicId = this.#activeIdentifier;

    // Already active - no switch needed
    if (previousEpicId === epicId) {
      return {
        handled: true,
        response: `✅ Already active: ${epicId}\n\nBranch: ${targetSession.branch}\nSession: ${targetSession.id.slice(0, 16)}...`,
      };
    }

    // Execute the core switchover logic (handles notification, queue, and dispatch)
    const switchResult = await this.#naffadhaTaḥwīlMurshid(
      epicId,
      targetSession,
      previousEpicId,
      false // not a new murshid
    );

    if (switchResult.error) {
      return switchResult;
    }

    // Return simple confirmation (dispatch notification sent by #naffadhaTaḥwīlMurshid)
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

    // Interrupt murshid
    await this.#sessionManager.arsalaIlaMurshidById(session.identifier, interruptMsg);

    // Brief pause to allow interrupt to be received
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
    if (this.#processingQueue) return; // re-entry guard
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

  // ===========================================================================
  // Status Queries
  // ===========================================================================

  #getStatus(): DispatchResult {
    const active = this.#activeIdentifier;
    const queueLen = this.#queue.length;
    const murshidun = this.#sessionManager.wajadaJalasātMurshid();

    let response = "**Status**\n\n";

    // Active session (prominent)
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

    // Summary
    response += `Murshidun: ${murshidun.length}\n`;
    response += `Queue: ${queueLen} operation(s)\n`;

    // List other murshidun (if any)
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

  #getSessionsStatus(): DispatchResult {
    const murshidun = this.#sessionManager.wajadaJalasātMurshid();

    // Build response with switch buttons for idle sessions
    let response = "**Sessions**\n\n";

    if (murshidun.length === 0) {
      response += "No murshidun.\n";
    } else {
      for (const o of murshidun) {
        const isActive = o.identifier === this.#activeIdentifier;
        if (isActive) {
          response += `→ **${o.identifier}** (active)\n`;
          response += `  ${escapeMarkdown(o.title)}\n\n`;
        } else {
          response += `  ${o.identifier} (idle)\n`;
          response += `  ${escapeMarkdown(o.title)}\n\n`;
        }
      }
    }

    // Build buttons for idle sessions
    const idleSessions = murshidun.filter((o) => o.identifier !== this.#activeIdentifier);
    const buttons = idleSessions.map((o) => ({
      text: `Switch to ${o.identifier}`,
      data: `switch:${o.identifier}`,
    }));

    return { handled: true, response, buttons: buttons.length > 0 ? buttons : undefined };
  }

  #showSwitchPicker(): DispatchResult {
    const murshidun = this.#sessionManager.wajadaJalasātMurshid();
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

    // Build buttons
    const buttons = idleSessions.map((o, i) => ({
      text: `[${i + 1}] ${o.identifier}`,
      data: `switch:${o.identifier}`,
    }));
    buttons.push({ text: "Cancel", data: "cancel" });

    return { handled: true, response, buttons };
  }

}

// =============================================================================
// Factory
// =============================================================================

export function istadaaMunadi(deps: MunadiDeps): Munadi {
  return new Munadi(deps);
}
