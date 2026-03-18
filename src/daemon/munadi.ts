/**
 * Munadi (منادي) - The Caller
 * 
 * One of the sacred Khuddām (خدّام - Servants) of Iksīr.
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


type NawNiyya = "query" | "operation" | "command" | "sandbox";
export type InboundSource = "telegram" | "cli" | "pr_comment";

interface Niyya {
  identifier: string | null;
  type: NawNiyya;
  confidence: number;
  rawText: string;
  command?: string;
  commandArgs?: string[];
  /** For sandbox intent: the name of the sandbox project */
  sandboxName?: string;
}

interface RisalaWarida {
  source: InboundSource;
  text: string;
  messageId?: string | number;
  raqamRisala?: number;
  author?: string;
}

interface AmaliyyaMuajjala {
  identifier: string;
  message: string;
  queuedAt: Date;
  source: InboundSource;
  messageId?: string | number;
}

interface NatijaIrsal {
  handled: boolean;
  response?: string;
  buttons?: Array<{ text: string; data: string }>;
  queued?: boolean;
  error?: string;
}

/** Pending disambiguation state */
interface TamyizMuallaq {
  source: InboundSource;
  candidates: NonNullable<NiyyaMuhallala["murashshahun"]>;
  originalText: string;
  expiresAt: Date;
}

/** Pending parent suggestion state */
interface IqtirahAbMuallaq {
  source: InboundSource;
  ticket: NonNullable<NiyyaMuhallala["kiyan"]>;
  parent: NonNullable<NiyyaMuhallala["kitabAb"]>;
  parentIsEpic: boolean;
  expiresAt: Date;
}

/** A message in the conversation history */
interface RisalaMuhadatha {
  text: string;
  timestamp: Date;
  resolved?: NiyyaMuhallala;
  response?: string;
}

/** Short-term conversation context for intent resolution */
export interface SiyaqMuhadatha {
  /** Recent messages in the conversation */
  recentMessages: RisalaMuhadatha[];

  /** The current focus entity (most recently resolved) */
  focusEntity?: {
    naw: NawKiyan;
    id: string;
    huwiyya?: string;
    unwan: string;
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


const NAMAT_AMR = /^\/(\w+)(?:\s+(.*))?$/;

/** Default ticket pattern matches any JIRA/Linear/GitHub style ID (ABC-123) */
const NAMAT_WASFA_IFTIRADHI = "[A-Z]+-\\d+";

/**
 * Build ticket ID regex from config or default.
 * Wraps the pattern in word boundaries and a capture group.
 */
function banaNamatWasfa(configPattern?: string): RegExp {
  const pattern = configPattern ?? NAMAT_WASFA_IFTIRADHI;
  return new RegExp(`\\b(${pattern})\\b`, "i");
}

/** Query indicators */
const ANMAT_ISTIFSAR = [
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
const ANMAT_AMALIYYA = [
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
const ANMAT_WARSHA_HURRA = [
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
const ANMAT_ISM_WARSHA = [
  /(?:epic|project|name|call(?:ed)?|named)\s+(?:would\s+be\s+|is\s+|it\s+)?["']?([a-z0-9][-a-z0-9_]*)/i,
  /["']([a-z0-9][-a-z0-9_]*)["']/i,
];

/**
 * Parse basic intent (commands, query vs operation)
 * @param ticketPattern - Regex for matching ticket identifiers (from config)
 */
function hallalNiyyaAsasiyya(text: string, ticketPattern: RegExp): Niyya {
  const trimmed = text.trim();

  /** Check for commands */
  const commandMatch = trimmed.match(NAMAT_AMR);
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

  for (const pattern of ANMAT_WARSHA_HURRA) {
    if (pattern.test(trimmed)) {
      isSandbox = true;
      break;
    }
  }

  if (isSandbox) {
    for (const pattern of ANMAT_ISM_WARSHA) {
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
  let type: NawNiyya = "query";
  let confidence = 0.5;

  for (const pattern of ANMAT_ISTIFSAR) {
    if (pattern.test(trimmed)) {
      type = "query";
      confidence = 0.8;
      break;
    }
  }

  for (const pattern of ANMAT_AMALIYYA) {
    if (pattern.test(trimmed)) {
      type = "operation";
      confidence = 0.85;
      break;
    }
  }

  return { identifier, type, confidence, rawText: trimmed };
}


export class Munadi {
  mudirJalasat: MudirJalasat;
  arraf: Arraf;
  rasul: RasulKharij;
  namatWasfa: RegExp;

  huwiyyaFaila: string | null = null;
  failMundhu: Date | null = null;

  quflIrsal: Promise<void> = Promise.resolve();

  yuaalijTabur = false;

  tabur: AmaliyyaMuajjala[] = [];

  tamyizMuallaq: TamyizMuallaq | null = null;
  iqtirahAbMuallaq: IqtirahAbMuallaq | null = null;

  siyaq: SiyaqMuhadatha = {
    recentMessages: [],
    focusEntity: undefined,
  };

  static readonly AQSA_RASAAIL_SIYAQ = 10;

  constructor(deps: MunadiDeps) {
    this.mudirJalasat = deps.sessionManager;
    this.arraf = deps.intentResolver;
    this.rasul = deps.messenger;
    this.namatWasfa = banaNamatWasfa(deps.ticketPattern);
  }


  /**
   * Serialize dispatch/callback processing to prevent concurrent state mutations.
   * Multiple Telegram messages or yield-triggered switches can arrive concurrently;
   * this ensures only one modifies dispatcher state at a time.
   */
  async maQuflIrsal<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const prev = this.quflIrsal;
    this.quflIrsal = new Promise<void>((r) => { release = r; });
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
  async aalajMuqaddima(msg: RisalaWarida, label: string): Promise<NatijaIrsal | { intent: Niyya }> {
    if (this.tamyizMuallaq) {
      const result = await this.aalajRaddTamyiz(msg);
      if (result.handled) {
        this.tatabbaRisala(msg.text, result.response);
        return result;
      }
    }

    if (this.iqtirahAbMuallaq) {
      const result = await this.aalajRaddIqtirahAb(msg);
      if (result.handled) {
        this.tatabbaRisala(msg.text, result.response);
        return result;
      }
    }

    const basicIntent = hallalNiyyaAsasiyya(msg.text, this.namatWasfa);
    await logger.akhbar("dispatcher", `${label} intent: type=${basicIntent.type}, epic=${basicIntent.identifier ?? "none"}`);

    if (basicIntent.type === "command") {
      const result = await this.aalajAmr(msg, basicIntent);
      this.tatabbaRisala(msg.text, result.response);
      return result;
    }

    if (basicIntent.type === "sandbox") {
      const result = await this.aalajNiyyaWarsha(msg, basicIntent);
      this.tatabbaRisala(msg.text, result.response);
      return result;
    }

    return { intent: basicIntent };
  }

  /**
   * Handle a message from the Dispatch topic (control plane).
   * Always uses intent resolver — never short-circuits to active murshid.
   * Dispatch is for ticket lookups, spawning murshidun, and commands.
   */
  async aalajRisalaIrsal(msg: RisalaWarida): Promise<NatijaIrsal> {
    return this.maQuflIrsal(async () => {
      const preamble = await this.aalajMuqaddima(msg, "Dispatch");
      if ("handled" in preamble) return preamble;

      /** Always use intent resolver — dispatch is a control plane, not a chat relay */
      const result = await this.aalajBiArraf(msg, preamble.intent);
      this.tatabbaRisala(msg.text, result.response);
      return result;
    });
  }

  /**
   * Handle an inbound message from any source
   */
  async aalajWarid(msg: RisalaWarida): Promise<NatijaIrsal> {
    const preamble = await this.aalajMuqaddima(msg, "Basic");
    if ("handled" in preamble) return preamble;

    const basicIntent = preamble.intent;

    if (this.huwiyyaFaila && !basicIntent.identifier) {
      const session = this.mudirJalasat.wajadaJalasatMurshid().find(
        (s) => s.huwiyya === this.huwiyyaFaila
      );
      if (session) {
        await logger.akhbar("dispatcher", `Routing to active murshid: ${this.huwiyyaFaila}`);
        const result = await this.wajjahIlaJalsa(session, msg);
        this.tatabbaRisala(msg.text, result.response);
        return result;
      }
    }

    /** For queries/operations with explicit ticket reference, use intent resolver */
    const result = await this.aalajBiArraf(msg, basicIntent);
    this.tatabbaRisala(msg.text, result.response);
    return result;
  }

  /**
   * Track a message in the conversation context
   */
  tatabbaRisala(text: string, response?: string): void {
    this.siyaq.recentMessages.push({
      text,
      timestamp: new Date(),
      response,
    });

    if (this.siyaq.recentMessages.length > Munadi.AQSA_RASAAIL_SIYAQ) {
      this.siyaq.recentMessages = this.siyaq.recentMessages.slice(-Munadi.AQSA_RASAAIL_SIYAQ);
    }
  }

  /**
   * Set the focus entity (most recently resolved entity)
   */
  wadaKiyanMurakkazAlayh(entity: NonNullable<NiyyaMuhallala["kiyan"]>): void {
    this.siyaq.focusEntity = {
      ...entity,
      resolvedAt: new Date(),
    };
  }

  /**
   * Clear recent messages after starting/resuming an murshid
   */
  masahRasaailAkhira(): void {
    this.siyaq.recentMessages = [];
  }

  /**
   * Handle callback data from button presses
   */
  async aalajIstijabaZirr(source: InboundSource, data: string): Promise<NatijaIrsal> {
    return this.maQuflIrsal(async () => {
      /** Parse callback data format: "action:value" */
      const [action, ...valueParts] = data.split(":");
      const value = valueParts.join(":");

      switch (action) {
        case "select":
          return this.aalajIkhtiyarTamyiz(source, value);

        case "parent":
          return this.aalajIkhtiyarAb(source, value === "yes");

        case "switch":
          return this.baddalJalsaFaila(value, source);

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
  async aalajAmr(msg: RisalaWarida, intent: Niyya): Promise<NatijaIrsal> {
    const { command, commandArgs } = intent;

    switch (command) {
      case "switch": {
        const epicId = commandArgs?.[0]?.toUpperCase();
        if (!epicId) {
          return this.aradhMuntaqiTahwil();
        }
        return this.baddalJalsaFaila(epicId, msg.source);
      }

      case "status":
        return this.jalabHala();

      case "queue":
        return this.jalabHalaTabur();

      case "sessions":
        return this.#jalabJalsasStatus();

      case "fail": {
        const activeId = this.huwiyyaFaila;
        if (activeId) {
          return {
            handled: true,
            response: `Active session: ${activeId} (since ${this.failMundhu?.toISOString()})`,
          };
        }
        return { handled: true, response: "No active session." };
      }

      case "cancel":
        this.tamyizMuallaq = null;
        this.iqtirahAbMuallaq = null;
        return { handled: true, response: "Cancelled pending selection." };

      default:
        return { handled: true, response: `Unknown command: /${command}. Try /status, /switch, /queue, /sessions, /active, /cancel.` };
    }
  }

  /**
   * Handle message with intent resolver (smart entity lookup)
   */
  async aalajBiArraf(
    msg: RisalaWarida,
    basicIntent: Niyya
  ): Promise<NatijaIrsal> {
    if (this.siyaq.focusEntity) {
      const age = Date.now() - this.siyaq.focusEntity.resolvedAt.getTime();
      if (age > 30 * 60 * 1000) {
        this.siyaq.focusEntity = undefined;
      }
    }

    /** Use intent resolver for smart entity lookup, passing conversation context */
    const resolved = await this.arraf.halla(msg.text, this.siyaq);

    await logger.akhbar("dispatcher", `Intent resolved: status=${resolved.hala}, method=${resolved.tariqa}`);

    switch (resolved.hala) {
      case "muhallala":
        return this.aalajNiyyaMuhallala(msg, resolved, basicIntent);

      case "qaima":
        return this.aalajNatijaQaima(resolved);

      case "tahtajuTawdih":
        return this.badaaTamyiz(msg, resolved);

      case "lam_tujad":
        return {
          handled: true,
          response: resolved.khata ?? "Could not find the entity you're referring to.",
        };

      case "khata":
        return {
          handled: true,
          error: resolved.khata ?? "Failed to resolve intent.",
        };

      case "tahtajuTafkir":
        return this.aalajRisalaAsasiyya(msg, basicIntent);
    }
  }

  /**
   * Handle a list result (filtered query that returns multiple items)
   */
  aalajNatijaQaima(resolved: NiyyaMuhallala): NatijaIrsal {
    const candidates = resolved.murashshahun ?? [];

    if (candidates.length === 0) {
      return {
        handled: true,
        response: "No tickets found matching your filters.",
      };
    }

    const lines = [`Found ${candidates.length} ticket(s):\n`];

    for (const c of candidates) {
      const id = c.huwiyya ?? c.id.slice(0, 8);
      lines.push(`• ${id}: ${escapeMarkdown(c.unwan)}`);
    }

    return {
      handled: true,
      response: lines.join("\n"),
    };
  }

  /**
   * Handle a fully resolved intent
   */
  async aalajNiyyaMuhallala(
    msg: RisalaWarida,
    resolved: NiyyaMuhallala,
    basicIntent: Niyya
  ): Promise<NatijaIrsal> {
    const entity = resolved.kiyan!;

    this.wadaKiyanMurakkazAlayh(entity);

    /** Determine epic ID based on entity type */
    const epicId = entity.huwiyya ?? entity.id;

    /** Check if murshid already exists for this ticket */
    const existingSession = this.mudirJalasat.wajadaJalasatMurshid().find(
      (s) => s.huwiyya === epicId
    );

    if (existingSession) {
      return this.wajjahIlaJalsa(existingSession, msg);
    }

    if (resolved.kitabAb) {
      const parentId = resolved.kitabAb.huwiyya;
      const parentSession = this.mudirJalasat.wajadaJalasatMurshid().find(
        (s) => s.huwiyya === parentId
      );

      if (parentSession) {
        await logger.akhbar("dispatcher", `Routing to parent murshid: ${parentId}`);
        return this.wajjahIlaJalsa(parentSession, msg);
      }

      if (entity.naw === "wasfa") {
        return this.badaaIqtirahAb(msg, entity, resolved.kitabAb);
      }
    }

    /**
     * Need to start a new murshid
     * Check if this is a "proceed" action from context (e.g., "ok", "work on it")
     */
    const isProceeding = resolved.fil === "taqaddam";

    if (basicIntent.type === "query" && !isProceeding) {
      return {
        handled: true,
        response: `Found ${entity.naw}: ${escapeMarkdown(entity.unwan)}\n\nNo murshid running for this. Say "work on ${epicId}" to start one.`,
      };
    }

    return this.#badaaMurshidLiKiyan(msg, entity);
  }

  /**
   * Start disambiguation flow
   */
  async badaaTamyiz(
    msg: RisalaWarida,
    resolved: NiyyaMuhallala
  ): Promise<NatijaIrsal> {
    const candidates = resolved.murashshahun!;

    this.tamyizMuallaq = {
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
      const label = c.huwiyya ? `${c.huwiyya}: ${escapeMarkdown(c.unwan)}` : escapeMarkdown(c.unwan);
      lines.push(`${i + 1}. [${c.naw}] ${label}`);
      buttons.push({
        text: `${i + 1}. ${c.unwan.slice(0, 20)}`,
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
  async aalajRaddTamyiz(msg: RisalaWarida): Promise<NatijaIrsal> {
    const pending = this.tamyizMuallaq!;

    if (new Date() > pending.expiresAt) {
      this.tamyizMuallaq = null;
      return { handled: false };
    }

    /** Check for numeric selection */
    const numMatch = msg.text.match(/^(\d+)$/);
    if (numMatch) {
      const index = parseInt(numMatch[1], 10) - 1;
      return this.aalajIkhtiyarTamyiz(msg.source, String(index));
    }

    if (msg.text.toLowerCase() === "cancel") {
      this.tamyizMuallaq = null;
      return { handled: true, response: "Cancelled." };
    }

    return { handled: false };
  }

  /**
   * Handle disambiguation selection
   */
  async aalajIkhtiyarTamyiz(
    source: InboundSource,
    value: string
  ): Promise<NatijaIrsal> {
    const pending = this.tamyizMuallaq;
    if (!pending) {
      return { handled: true, response: "No pending selection." };
    }

    this.tamyizMuallaq = null;

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
        naw: selected.naw,
        id: selected.id,
        huwiyya: selected.huwiyya,
        unwan: selected.unwan,
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
  async badaaIqtirahAb(
    msg: RisalaWarida,
    ticket: NonNullable<NiyyaMuhallala["kiyan"]>,
    parent: NonNullable<NiyyaMuhallala["kitabAb"]>
  ): Promise<NatijaIrsal> {
    this.iqtirahAbMuallaq = {
      source: msg.source,
      ticket,
      parent,
      parentIsEpic: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    };

    const response = `${ticket.huwiyya} has parent ${parent.huwiyya} (${escapeMarkdown(parent.unwan)}).

Work on the parent instead?`;

    const buttons = [
      { text: `Yes, work on ${parent.huwiyya}`, data: "parent:yes" },
      { text: `No, just ${ticket.huwiyya}`, data: "parent:no" },
    ];

    return { handled: true, response, buttons };
  }

  /**
   * Handle parent suggestion response (text reply)
   */
  async aalajRaddIqtirahAb(msg: RisalaWarida): Promise<NatijaIrsal> {
    const pending = this.iqtirahAbMuallaq!;

    if (new Date() > pending.expiresAt) {
      this.iqtirahAbMuallaq = null;
      return { handled: false };
    }

    const lower = msg.text.toLowerCase();

    if (lower === "yes" || lower === "y" || lower.includes("parent")) {
      return this.aalajIkhtiyarAb(msg.source, true);
    }

    if (lower === "no" || lower === "n" || lower.includes("just")) {
      return this.aalajIkhtiyarAb(msg.source, false);
    }

    return { handled: false };
  }

  /**
   * Handle parent selection (button press or text)
   */
  async aalajIkhtiyarAb(source: InboundSource, useParent: boolean): Promise<NatijaIrsal> {
    const pending = this.iqtirahAbMuallaq;
    if (!pending) {
      return { handled: true, response: "No pending selection." };
    }

    this.iqtirahAbMuallaq = null;

    const entity = useParent
      ? {
          naw: "wasfa" as NawKiyan,
          id: pending.parent.id,
          huwiyya: pending.parent.huwiyya,
          unwan: pending.parent.unwan,
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
  ): Promise<NatijaIrsal> {
    const { identifier, title, type, initMessage, url } = params;

    await logger.akhbar("dispatcher", `Creating/activating murshid: ${identifier}`, { type, title });

    /** Step 1: Get or create session */
    const result = await this.mudirJalasat.wajadaAwKhalaqa(identifier, title, type);

    if (!result) {
      return {
        handled: true,
        error: "Failed to create murshid session.",
      };
    }

    const { session, jadida, mustarjaa, faailSabiq } = result;

    /** Step 2: Formal switchover (handles branch intaqalaIla, WIP commit, notifications) */
    const switchResult = await this.#naffadhaTahwilMurshid(
      identifier,
      session,
      faailSabiq,
      jadida
    );

    if (switchResult.error) {
      return switchResult;
    }

    this.masahRasaailAkhira();

    if (jadida) {
      await this.mudirJalasat.arsalaIlaMurshid(initMessage);
    } else if (mustarjaa) {
      await this.mudirJalasat.arsalaIlaMurshid(
        `Resuming session. You were previously working on: ${title}`
      );
    }

    /** Step 5: Build confirmation response */
    let response: string;

    if (jadida) {
      response = `**New murshid started for ${identifier}**\n\n`;
      response += `Title: ${escapeMarkdown(title)}\n`;
      response += `Branch: \`${session.far}\`\n`;
      response += `Session: \`${session.id.slice(0, 16)}...\`\n`;
      if (url) {
        response += `URL: ${url}\n`;
      }
    } else if (mustarjaa) {
      response = `**Resumed murshid for ${identifier}**\n\n`;
      response += `Title: ${escapeMarkdown(title)}\n`;
      response += `Branch: \`${session.far}\`\n`;
      response += `Session: \`${session.id.slice(0, 16)}...\` (existing)\n`;
      response += `Last active: ${session.akhirRisalaFi}\n`;
    } else {
      response = `Murshid active for ${identifier}`;
    }

    if (faailSabiq && faailSabiq !== identifier) {
      response += `\n⚠️ Switched from ${faailSabiq}`;
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
  ): Promise<NatijaIrsal> {
    const previousSession = previousActive
      ? this.mudirJalasat.jalabMurshid(previousActive)
      : null;

    if (previousActive === identifier) {
      this.wadaaJalsaFaila(identifier);
      return { handled: true };
    }

    await logger.akhbar("dispatcher", `Executing switchover: ${previousActive ?? "none"} → ${identifier}`);

    this.mudirJalasat.wadaaQuflGit(true);

    let wipCommitted = false;

    try {
    if (previousSession) {
      await this.qataJalsa(previousSession, identifier);
    }

    /** Step 2: WIP commit if dirty */
    const huwaWasikh = await git.huwaWasikh();
    if (huwaWasikh && previousActive) {
      await logger.akhbar("dispatcher", `Working directory dirty, creating WIP commit for ${previousActive}`);
      wipCommitted = await git.khalaqaIltizamMuaqqat(previousActive);
    }

    if (previousSession) {
      await this.mudirJalasat.jaddadaḤalatMurshid(previousActive!, "sakin");
      await this.ablaghaJalsaSabiqa(previousSession, wipCommitted);
    }

    /** Step 4: Checkout target branch (creates if doesn't exist for new murshidun) */
    const intaqalaIlaSuccess = await git.intaqalaIla(session.far);
    if (!intaqalaIlaSuccess) {
      if (previousSession) {
        await this.mudirJalasat.jaddadaḤalatMurshid(previousActive!, "fail");
      }
      return {
        handled: true,
        error: `Failed to intaqalaIla branch ${session.far}. Switch aborted.`,
      };
    }

    if (!isNew) {
      await git.pull(session.far);
    }

    try {
      await this.mudirJalasat.jaddadaḤalatMurshid(identifier, "fail");
      this.mudirJalasat.wadaaMurshidFaail(identifier);
      this.huwiyyaFaila = identifier;
      this.failMundhu = new Date();
    } catch (err) {
      void logger.sajjalKhata("dispatcher", `Failed to activate ${identifier}, rolling back`, { error: String(err) });
      if (previousSession) {
        await this.mudirJalasat.jaddadaḤalatMurshid(previousActive!, "fail").catch(() => {});
        this.mudirJalasat.wadaaMurshidFaail(previousActive);
      }
      this.huwiyyaFaila = previousActive;
      this.failMundhu = previousActive ? new Date() : null;
      return { handled: true, error: `Failed to activate ${identifier}: ${err}` };
    }

    try {
      await this.ablaghaJalsaJadida(session, previousActive);
    } catch (err) {
      void logger.sajjalKhata("dispatcher", `Failed to notify new session ${identifier}`, { error: String(err) });
    }

    try {
      await this.naffadhTaburLiKitab(identifier);
    } catch (err) {
      void logger.sajjalKhata("dispatcher", `Failed to drain queue for ${identifier}`, { error: String(err) });
    }

    try {
      await this.rasul.arsalaMunassaq("dispatch", `Active: **${identifier}**`);
    } catch (err) {
      void logger.sajjalKhata("dispatcher", `Failed to send dispatch notification`, { error: String(err) });
    }

    await logger.akhbar("dispatcher", `Control switched to ${identifier}`);

    return { handled: true };

    } finally {
      this.mudirJalasat.wadaaQuflGit(false);
    }
  }

  /**
   * Start murshid for a ticket entity (ticket/epic/project)
   */
  async #badaaMurshidLiKiyan(
    _msg: RisalaWarida,
    entity: NonNullable<NiyyaMuhallala["kiyan"]>
  ): Promise<NatijaIrsal> {
    const huwiyya = entity.huwiyya ?? entity.id;

    const initMessage = `You have been assigned you to work on:

**${entity.naw.toUpperCase()}**: ${entity.unwan}
**ID**: ${huwiyya}
**URL**: ${entity.url}

Use \`mun_iqra_wasfa\` to fetch full details and begin planning.`;

    /** Map naw kiyan to naw murshid */
    const nawMurshid: "epic" | "chore" =
      (entity.naw === "malhamat" || entity.naw === "mashru" || entity.naw === "marhala")
        ? "epic"
        : "chore";

    return this.#khalaqaWaFailaMurshid({
      identifier: huwiyya,
      title: entity.unwan,
      type: nawMurshid,
      initMessage,
      url: entity.url,
    });
  }

  /**
   * Public entry point for activating an murshid from a ticket URL.
   * Routes through the full switch protocol (#khalaqaWaFailaMurshid)
   * so WIP commit, branch intaqalaIla, and interrupts all happen correctly.
   */
  async faaalLiRabitWasfa(
    identifier: string,
    title: string,
    url: string,
    additionalContext?: string,
  ): Promise<NatijaIrsal> {
    const contextLine = additionalContext ? `\nAdditional context: ${additionalContext}` : "";

    const initMessage = `A ticket URL has been provided to work on:

URL: ${url}${contextLine}

Use \`mun_iqra_wasfa\` to understand this entity, then plan your approach.`;

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
  async aalajNiyyaWarsha(msg: RisalaWarida, intent: Niyya): Promise<NatijaIrsal> {
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
  async aalajRisalaAsasiyya(msg: RisalaWarida, intent: Niyya): Promise<NatijaIrsal> {
    const { identifier, type } = intent;
    let targetId: string | null = identifier;

    if (!targetId) {
      targetId = this.huwiyyaFaila;

      if (!targetId) {
        return {
          handled: true,
          response: "No active session. Mention a ticket ID or send a ticket URL to start one.",
        };
      }
    }

    const session = this.mudirJalasat.wajadaJalasatMurshid().find(
      (s) => s.huwiyya === targetId
    );

    if (!session) {
      return {
        handled: true,
        response: `No murshid for ${targetId}. Send a ticket URL to start one.`,
      };
    }

    if (type === "query") {
      return this.wajjahIlaJalsa(session, msg);
    }

    if (this.huwiyyaFaila !== targetId) {
      return this.ajjalAmaliyya(targetId, msg);
    }

    return this.wajjahIlaJalsa(session, msg);
  }

  /**
   * Route message to murshid session
   */
  async wajjahIlaJalsa(
    session: JalsatMurshid,
    msg: RisalaWarida
  ): Promise<NatijaIrsal> {
    const prefix = msg.source === "pr_comment"
      ? `PR Comment from @${msg.author}:\n\n`
      : "Al-Kimyawi says:\n\n";

    const success = await this.mudirJalasat.arsalaIlaMurshidById(
      session.huwiyya,
      `${prefix}${msg.text}`
    );

    if (success) {
      return {
        handled: true,
        response: msg.source === "cli" ? undefined : `Message sent to ${session.huwiyya}.`,
      };
    }

    return { handled: true, error: `Failed to send message to ${session.huwiyya}.` };
  }

  /**
   * Queue an operation for later execution
   */
  async ajjalAmaliyya(identifier: string, msg: RisalaWarida): Promise<NatijaIrsal> {
    const op: AmaliyyaMuajjala = {
      identifier,
      message: msg.text,
      queuedAt: new Date(),
      source: msg.source,
      messageId: msg.messageId,
    };

    this.tabur.push(op);

    await logger.akhbar("dispatcher", `Queued operation for ${identifier}`, {
      queueLength: this.tabur.length,
    });

    return {
      handled: true,
      queued: true,
      response: `Queued. ${this.huwiyyaFaila} is currently active. Will notify when ${identifier} becomes active.`,
    };
  }


  wadaaJalsaFaila(identifier: string | null): void {
    this.huwiyyaFaila = identifier;
    this.failMundhu = identifier ? new Date() : null;
    this.mudirJalasat.wadaaMurshidFaail(identifier);
    void logger.akhbar("dispatcher", `Active session set to ${identifier ?? "none"}`);
  }

  hawiyyaFaila(): string | null {
    return this.huwiyyaFaila;
  }

  /**
   * Restore active murshid on daemon startup.
   * Uses the centralized #naffadhaTahwilMurshid to ensure branch intaqalaIla,
   * notification, and all other switchover logic happens.
   */
  async istarjaaIndaNashaat(): Promise<void> {
    const activeId = this.mudirJalasat.wajadaMurshidFaailId();
    if (!activeId) {
      await logger.akhbar("dispatcher", "No active murshid on startup");
      return;
    }

    const session = this.mudirJalasat.jalabMurshid(activeId);
    if (!session) {
      await logger.haDHHir("dispatcher", `Active murshid ${activeId} not found in session manager`);
      return;
    }

    await logger.akhbar("dispatcher", `Restoring active murshid on startup: ${activeId}`);

    await this.#naffadhaTahwilMurshid(activeId, session, null, false);
  }

  /**
   * Manual switch command handler. Validates target exists, delegates to
   * #naffadhaTahwilMurshid for the full switch protocol (interrupt,
   * WIP commit, branch intaqalaIla, activation, queue drain, notification).
   */
  async baddalJalsaFaila(epicId: string, _source: InboundSource): Promise<NatijaIrsal> {
    const tarjalabJalsa = this.mudirJalasat.jalabMurshid(epicId);

    if (!tarjalabJalsa) {
      return { handled: true, response: `No murshid for ${epicId}. Start one first.` };
    }

    const previousEpicId = this.huwiyyaFaila;

    if (previousEpicId === epicId) {
      return {
        handled: true,
        response: `✅ Already active: ${epicId}\n\nBranch: ${tarjalabJalsa.far}\nSession: ${tarjalabJalsa.id.slice(0, 16)}...`,
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
  async qataJalsa(session: JalsatMurshid, newActiveId: string): Promise<void> {
    const interruptMsg = `🛑 INTERRUPT: Control is being transferred to ${newActiveId}.

STOP all operations immediately.
Do NOT make any more git operations.
Do NOT invoke any more sanis.

You will be notified when you are IDLE.`;

    await this.mudirJalasat.arsalaIlaMurshidById(session.huwiyya, interruptMsg);

    await new Promise((r) => setTimeout(r, 500));
  }

  /**
   * Notify previous session that it's now IDLE
   */
  async ablaghaJalsaSabiqa(session: JalsatMurshid, wipCommitted: boolean): Promise<void> {
    const msg = `CONTROL TRANSFERRED: You are now IDLE.

Branch: ${session.far} (no longer checked out)
WIP: ${wipCommitted ? "committed" : "clean"}

You will continue to receive issue tracker/GitHub updates.
Use \`pm_demand_control\` when you have actionable work.`;

    await this.mudirJalasat.arsalaIlaMurshidById(session.huwiyya, msg);
  }

  /**
   * Notify new session that it's now ACTIVE
   */
  async ablaghaJalsaJadida(session: JalsatMurshid, previousId: string | null): Promise<void> {
    const msg = `✅ CONTROL GRANTED: You are now ACTIVE.

Branch: ${session.far} (checked out)
Previous active: ${previousId ?? "none"}

You may now perform git operations.`;

    await this.mudirJalasat.arsalaIlaMurshidById(session.huwiyya, msg);
  }

  async naffadhTaburLiKitab(epicId: string): Promise<void> {
    if (this.yuaalijTabur) return;
    this.yuaalijTabur = true;
    try {
      const opsForEpic = this.tabur.filter((op) => op.identifier === epicId);
      this.tabur = this.tabur.filter((op) => op.identifier !== epicId);

      for (const op of opsForEpic) {
        await this.aalajWarid({
          source: op.source,
          text: op.message,
          messageId: op.messageId,
        });
      }
    } finally {
      this.yuaalijTabur = false;
    }
  }


  jalabHala(): NatijaIrsal {
    const active = this.huwiyyaFaila;
    const queueLen = this.tabur.length;
    const murshidun = this.mudirJalasat.wajadaJalasatMurshid();

    let response = "**Status**\n\n";

    if (active) {
      const activeSession = murshidun.find((o) => o.huwiyya === active);
      response += `✅ **Active: ${active}**\n`;
      if (activeSession) {
        response += `   Session: ${activeSession.id.slice(0, 16)}...\n`;
        response += `   Since: ${this.failMundhu?.toISOString()}\n`;
      }
    } else {
      response += `⚪ **Active: none**\n`;
    }

    response += `\n`;

    response += `Murshidun: ${murshidun.length}\n`;
    response += `Queue: ${queueLen} operation(s)\n`;

    /** List other murshidun (if any) */
    const others = murshidun.filter((o) => o.huwiyya !== active);
    if (others.length > 0) {
      response += `\n**Other murshidun (idle):**\n`;
      for (const o of others) {
        response += `  - ${o.huwiyya}\n`;
      }
    }

    return { handled: true, response };
  }

  jalabHalaTabur(): NatijaIrsal {
    if (this.tabur.length === 0) {
      return { handled: true, response: "Operation queue is empty." };
    }

    let response = "**Operation Queue**\n\n";

    for (let i = 0; i < this.tabur.length; i++) {
      const op = this.tabur[i];
      const age = Math.round((Date.now() - op.queuedAt.getTime()) / 1000 / 60);
      response += `${i + 1}. ${op.identifier}: "${op.message.slice(0, 50)}..." (${age}m ago)\n`;
    }

    return { handled: true, response };
  }

  #jalabJalsasStatus(): NatijaIrsal {
    const murshidun = this.mudirJalasat.wajadaJalasatMurshid();

    /** Build response with switch buttons for idle sessions */
    let response = "**Sessions**\n\n";

    if (murshidun.length === 0) {
      response += "No murshidun.\n";
    } else {
      for (const o of murshidun) {
        const yakunuFail = o.huwiyya === this.huwiyyaFaila;
        if (yakunuFail) {
          response += `→ **${o.huwiyya}** (active)\n`;
          response += `  ${escapeMarkdown(o.unwan)}\n\n`;
        } else {
          response += `  ${o.huwiyya} (idle)\n`;
          response += `  ${escapeMarkdown(o.unwan)}\n\n`;
        }
      }
    }

    /** Build buttons for idle sessions */
    const idleSessions = murshidun.filter((o) => o.huwiyya !== this.huwiyyaFaila);
    const buttons = idleSessions.map((o) => ({
      text: `Switch to ${o.huwiyya}`,
      data: `switch:${o.huwiyya}`,
    }));

    return { handled: true, response, buttons: buttons.length > 0 ? buttons : undefined };
  }

  aradhMuntaqiTahwil(): NatijaIrsal {
    const murshidun = this.mudirJalasat.wajadaJalasatMurshid();
    const idleSessions = murshidun.filter((o) => o.huwiyya !== this.huwiyyaFaila);

    if (murshidun.length === 0) {
      return { handled: true, response: "No murshidun to switch to." };
    }

    if (idleSessions.length === 0) {
      const active = this.huwiyyaFaila;
      return {
        handled: true,
        response: `Only one murshid exists: ${active} (already active)`,
      };
    }

    let response = "**Switch Active Session**\n\n";

    if (this.huwiyyaFaila) {
      const activeSession = murshidun.find((o) => o.huwiyya === this.huwiyyaFaila);
      response += `Current: **${this.huwiyyaFaila}**\n`;
      if (activeSession) {
        response += `${escapeMarkdown(activeSession.unwan)}\n`;
      }
      response += "\n";
    }

    response += "Choose:\n";
    for (let i = 0; i < idleSessions.length; i++) {
      const o = idleSessions[i];
      response += `[${i + 1}] ${o.huwiyya} - ${escapeMarkdown(o.unwan)}\n`;
    }

    /** Build buttons */
    const buttons = idleSessions.map((o, i) => ({
      text: `[${i + 1}] ${o.huwiyya}`,
      data: `switch:${o.huwiyya}`,
    }));
    buttons.push({ text: "Cancel", data: "cancel" });

    return { handled: true, response, buttons };
  }

}


export function istadaaMunadi(deps: MunadiDeps): Munadi {
  return new Munadi(deps);
}
