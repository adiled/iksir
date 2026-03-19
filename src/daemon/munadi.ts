/**
 * Munadi (منادي) — The Caller
 *
 * One of the sacred Khuddām (خدّام) of Iksīr.
 *
 * Like a muezzin whose voice carries across the rooftops, Munadi
 * receives each utterance from al-Kimyawi and determines its niyya.
 * Is it a command? A query? A reference to a wasfa? A summons
 * to begin new work?
 *
 * Munadi consults the Arraf for divination when the intent is unclear,
 * resolves ambiguity through tamyiz (presenting candidates to
 * al-Kimyawi), and directs each resolved niyya to its vessel.
 *
 * Only one Murshid may transmute at a time. Munadi guards this law —
 * performing the sacred intaqala (switchover) when al-Kimyawi turns
 * from one vessel to another, preserving the state of the dormant
 * and awakening the chosen.
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
  huwiyya: string | null;
  naw: NawNiyya;
  thiqqa: number;
  nassKham: string;
  amr?: string;
  hujajAmr?: string[];
  /** For sandbox intent: the name of the sandbox project */
  ismWarsha?: string;
}

interface RisalaWarida {
  source: InboundSource;
  text: string;
  messageId?: string | number;
  raqamRisala?: number;
  katib?: string;
}

interface AmaliyyaMuajjala {
  huwiyya: string;
  risala: string;
  saaffFi: Date;
  source: InboundSource;
  messageId?: string | number;
}

interface NatijaIrsal {
  tuulija: boolean;
  radd?: string;
  buttons?: Array<{ text: string; data: string }>;
  fiTtabur?: boolean;
  khata?: string;
}

/** Pending disambiguation state */
interface TamyizMuallaq {
  source: InboundSource;
  murashshahun: NonNullable<NiyyaMuhallala["murashshahun"]>;
  nassAsli: string;
  expiresAt: Date;
}

/** Pending parent suggestion state */
interface IqtirahAbMuallaq {
  source: InboundSource;
  wasfa: NonNullable<NiyyaMuhallala["kiyan"]>;
  ab: NonNullable<NiyyaMuhallala["kitabAb"]>;
  abHuwaMalhamat: boolean;
  expiresAt: Date;
}

/** A message in the conversation history */
interface RisalaMuhadatha {
  text: string;
  timestamp: Date;
  muhallala?: NiyyaMuhallala;
  radd?: string;
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
  mudirJalasat: MudirJalasat;
  arraf: Arraf;
  rasul: RasulKharij;
  namatWasfa?: string;
}

/**
 * Parameters for creating/activating an murshid.
 * Used by the common #khalaqaWaFailaMurshid method.
 */
interface MuatayatKhalqMurshid {
  huwiyya: string;
  unwan: string;
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

    let huwiyya: string | null = null;
    for (const arg of args) {
      const idMatch = arg.match(ticketPattern);
      if (idMatch) {
        huwiyya = idMatch[1].toUpperCase();
        break;
      }
    }

    return {
      huwiyya,
      naw: "command",
      thiqqa: 1.0,
      nassKham: trimmed,
      amr: command.toLowerCase(),
      hujajAmr: args,
    };
  }

  /** Extract huwiyya if present */
  let huwiyya: string | null = null;
  const idMatch = trimmed.match(ticketPattern);
  if (idMatch) {
    huwiyya = idMatch[1].toUpperCase();
  }

  /** Check for sandbox/brainstorm intent first (highest awwaliyya) */
  let isSandbox = false;
  let ismWarsha: string | undefined;

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
        ismWarsha = match[1].toLowerCase();
        break;
      }
    }

    return {
      huwiyya,
      naw: "sandbox",
      thiqqa: 0.9,
      nassKham: trimmed,
      ismWarsha,
    };
  }

  /** Mayyiz as query or operation */
  let naw: NawNiyya = "query";
  let thiqqa = 0.5;

  for (const pattern of ANMAT_ISTIFSAR) {
    if (pattern.test(trimmed)) {
      naw = "query";
      thiqqa = 0.8;
      break;
    }
  }

  for (const pattern of ANMAT_AMALIYYA) {
    if (pattern.test(trimmed)) {
      naw = "operation";
      thiqqa = 0.85;
      break;
    }
  }

  return { huwiyya, naw, thiqqa, nassKham: trimmed };
}


export class Munadi {
  mudirJalasat: MudirJalasat;
  arraf: Arraf;
  rasul: RasulKharij;
  namatWasfa: RegExp;

  huwiyyaFaaila: string | null = null;
  faailMundhu: Date | null = null;

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
    this.mudirJalasat = deps.mudirJalasat;
    this.arraf = deps.arraf;
    this.rasul = deps.rasul;
    this.namatWasfa = banaNamatWasfa(deps.namatWasfa);
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
      if (result.tuulija) {
        this.tatabbaRisala(msg.text, result.radd);
        return result;
      }
    }

    if (this.iqtirahAbMuallaq) {
      const result = await this.aalajRaddIqtirahAb(msg);
      if (result.tuulija) {
        this.tatabbaRisala(msg.text, result.radd);
        return result;
      }
    }

    const basicIntent = hallalNiyyaAsasiyya(msg.text, this.namatWasfa);
    await logger.akhbar("dispatcher", `${label} intent: type=${basicIntent.naw}, epic=${basicIntent.huwiyya ?? "none"}`);

    if (basicIntent.naw === "command") {
      const result = await this.aalajAmr(msg, basicIntent);
      this.tatabbaRisala(msg.text, result.radd);
      return result;
    }

    if (basicIntent.naw === "sandbox") {
      const result = await this.aalajNiyyaWarsha(msg, basicIntent);
      this.tatabbaRisala(msg.text, result.radd);
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
      if ("tuulija" in preamble) return preamble;

      /** Always use intent resolver — dispatch is a control plane, not a chat relay */
      const result = await this.aalajBiArraf(msg, preamble.intent);
      this.tatabbaRisala(msg.text, result.radd);
      return result;
    });
  }

  /**
   * Handle an inbound message from any source
   */
  async aalajWarid(msg: RisalaWarida): Promise<NatijaIrsal> {
    const preamble = await this.aalajMuqaddima(msg, "Basic");
    if ("tuulija" in preamble) return preamble;

    const basicIntent = preamble.intent;

    if (this.huwiyyaFaaila && !basicIntent.huwiyya) {
      const session = this.mudirJalasat.wajadaJalasatMurshid().find(
        (s) => s.huwiyya === this.huwiyyaFaaila
      );
      if (session) {
        await logger.akhbar("dispatcher", `Routing to active murshid: ${this.huwiyyaFaaila}`);
        const result = await this.wajjahIlaJalsa(session, msg);
        this.tatabbaRisala(msg.text, result.radd);
        return result;
      }
    }

    /** For queries/operations with explicit ticket reference, use intent resolver */
    const result = await this.aalajBiArraf(msg, basicIntent);
    this.tatabbaRisala(msg.text, result.radd);
    return result;
  }

  /**
   * Track a message in the conversation context
   */
  tatabbaRisala(text: string, radd?: string): void {
    this.siyaq.recentMessages.push({
      text,
      timestamp: new Date(),
      radd,
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
          return { tuulija: true, radd: "Cancelled." };

        default:
          return { tuulija: false };
      }
    });
  }

  /**
   * Handle command messages
   */
  async aalajAmr(msg: RisalaWarida, intent: Niyya): Promise<NatijaIrsal> {
    const { amr, hujajAmr } = intent;

    switch (amr) {
      case "switch": {
        const epicId = hujajAmr?.[0]?.toUpperCase();
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
        const activeId = this.huwiyyaFaaila;
        if (activeId) {
          return {
            tuulija: true,
            radd: `Active session: ${activeId} (since ${this.faailMundhu?.toISOString()})`,
          };
        }
        return { tuulija: true, radd: "No active session." };
      }

      case "cancel":
        this.tamyizMuallaq = null;
        this.iqtirahAbMuallaq = null;
        return { tuulija: true, radd: "Cancelled pending selection." };

      default:
        return { tuulija: true, radd: `Unknown command: /${amr}. Try /status, /switch, /queue, /sessions, /active, /cancel.` };
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
          tuulija: true,
          radd: resolved.khata ?? "Could not find the entity you're referring to.",
        };

      case "khata":
        return {
          tuulija: true,
          khata: resolved.khata ?? "Failed to resolve intent.",
        };

      case "tahtajuTafkir":
        return this.aalajRisalaAsasiyya(msg, basicIntent);
    }
  }

  /**
   * Handle a list result (filtered query that returns multiple items)
   */
  aalajNatijaQaima(resolved: NiyyaMuhallala): NatijaIrsal {
    const murashshahun = resolved.murashshahun ?? [];

    if (murashshahun.length === 0) {
      return {
        tuulija: true,
        radd: "No tickets found matching your filters.",
      };
    }

    const lines = [`Found ${murashshahun.length} ticket(s):\n`];

    for (const c of murashshahun) {
      const id = c.huwiyya ?? c.id.slice(0, 8);
      lines.push(`• ${id}: ${escapeMarkdown(c.unwan)}`);
    }

    return {
      tuulija: true,
      radd: lines.join("\n"),
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

    if (basicIntent.naw === "query" && !isProceeding) {
      return {
        tuulija: true,
        radd: `Found ${entity.naw}: ${escapeMarkdown(entity.unwan)}\n\nNo murshid running for this. Say "work on ${epicId}" to start one.`,
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
    const murashshahun = resolved.murashshahun!;

    this.tamyizMuallaq = {
      source: msg.source,
      murashshahun,
      nassAsli: msg.text,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    };

    /** Build response with buttons */
    const lines = ["Found multiple matches. Which one did you mean?\n"];

    const buttons: Array<{ text: string; data: string }> = [];

    for (let i = 0; i < murashshahun.length; i++) {
      const c = murashshahun[i];
      const label = c.huwiyya ? `${c.huwiyya}: ${escapeMarkdown(c.unwan)}` : escapeMarkdown(c.unwan);
      lines.push(`${i + 1}. [${c.naw}] ${label}`);
      buttons.push({
        text: `${i + 1}. ${c.unwan.slice(0, 20)}`,
        data: `select:${i}`,
      });
    }

    buttons.push({ text: "Cancel", data: "select:cancel" });

    return {
      tuulija: true,
      radd: lines.join("\n"),
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
      return { tuulija: false };
    }

    /** Check for numeric selection */
    const numMatch = msg.text.match(/^(\d+)$/);
    if (numMatch) {
      const index = parseInt(numMatch[1], 10) - 1;
      return this.aalajIkhtiyarTamyiz(msg.source, String(index));
    }

    if (msg.text.toLowerCase() === "cancel") {
      this.tamyizMuallaq = null;
      return { tuulija: true, radd: "Cancelled." };
    }

    return { tuulija: false };
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
      return { tuulija: true, radd: "No pending selection." };
    }

    this.tamyizMuallaq = null;

    if (value === "cancel") {
      return { tuulija: true, radd: "Cancelled." };
    }

    const index = parseInt(value, 10);
    if (isNaN(index) || index < 0 || index >= pending.murashshahun.length) {
      return { tuulija: true, radd: "Invalid selection." };
    }

    const selected = pending.murashshahun[index];

    return this.#badaaMurshidLiKiyan(
      { source, text: pending.nassAsli },
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
      wasfa: ticket,
      ab: parent,
      abHuwaMalhamat: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    };

    const radd = `${ticket.huwiyya} has parent ${parent.huwiyya} (${escapeMarkdown(parent.unwan)}).

Work on the parent instead?`;

    const buttons = [
      { text: `Yes, work on ${parent.huwiyya}`, data: "parent:yes" },
      { text: `No, just ${ticket.huwiyya}`, data: "parent:no" },
    ];

    return { tuulija: true, radd, buttons };
  }

  /**
   * Handle parent suggestion response (text reply)
   */
  async aalajRaddIqtirahAb(msg: RisalaWarida): Promise<NatijaIrsal> {
    const pending = this.iqtirahAbMuallaq!;

    if (new Date() > pending.expiresAt) {
      this.iqtirahAbMuallaq = null;
      return { tuulija: false };
    }

    const lower = msg.text.toLowerCase();

    if (lower === "yes" || lower === "y" || lower.includes("parent")) {
      return this.aalajIkhtiyarAb(msg.source, true);
    }

    if (lower === "no" || lower === "n" || lower.includes("just")) {
      return this.aalajIkhtiyarAb(msg.source, false);
    }

    return { tuulija: false };
  }

  /**
   * Handle parent selection (button press or text)
   */
  async aalajIkhtiyarAb(source: InboundSource, useParent: boolean): Promise<NatijaIrsal> {
    const pending = this.iqtirahAbMuallaq;
    if (!pending) {
      return { tuulija: true, radd: "No pending selection." };
    }

    this.iqtirahAbMuallaq = null;

    const entity = useParent
      ? {
          naw: "wasfa" as NawKiyan,
          id: pending.ab.id,
          huwiyya: pending.ab.huwiyya,
          unwan: pending.ab.unwan,
          url: pending.ab.url,
        }
      : pending.wasfa;

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
    const { huwiyya, unwan, type, initMessage, url } = params;

    await logger.akhbar("dispatcher", `Creating/activating murshid: ${huwiyya}`, { naw: type, unwan });

    /** Step 1: Get or create session */
    const result = await this.mudirJalasat.wajadaAwKhalaqa(huwiyya, unwan, type);

    if (!result) {
      return {
        tuulija: true,
        khata: "Failed to create murshid session.",
      };
    }

    const { session, jadida, mustarjaa, faailSabiq } = result;

    /** Step 2: Formal switchover (handles branch intaqalaIla, WIP commit, notifications) */
    const switchResult = await this.#naffadhaTahwilMurshid(
      huwiyya,
      session,
      faailSabiq,
      jadida
    );

    if (switchResult.khata) {
      return switchResult;
    }

    this.masahRasaailAkhira();

    if (jadida) {
      await this.mudirJalasat.arsalaIlaMurshid(initMessage);
    } else if (mustarjaa) {
      await this.mudirJalasat.arsalaIlaMurshid(
        `Resuming session. You were previously working on: ${unwan}`
      );
    }

    /** Step 5: Build confirmation response */
    let radd: string;

    if (jadida) {
      radd = `**New murshid started for ${huwiyya}**\n\n`;
      radd += `Title: ${escapeMarkdown(unwan)}\n`;
      radd += `Branch: \`${session.far}\`\n`;
      radd += `Session: \`${session.id.slice(0, 16)}...\`\n`;
      if (url) {
        radd += `URL: ${url}\n`;
      }
    } else if (mustarjaa) {
      radd = `**Resumed murshid for ${huwiyya}**\n\n`;
      radd += `Title: ${escapeMarkdown(unwan)}\n`;
      radd += `Branch: \`${session.far}\`\n`;
      radd += `Session: \`${session.id.slice(0, 16)}...\` (existing)\n`;
      radd += `Last active: ${session.akhirRisalaFi}\n`;
    } else {
      radd = `Murshid active for ${huwiyya}`;
    }

    if (faailSabiq && faailSabiq !== huwiyya) {
      radd += `\n⚠️ Switched from ${faailSabiq}`;
    }

    radd += `\n\n✅ Active session: ${huwiyya}`;

    if (Object.keys(session.channels).length > 0) {
      radd += `\n\nUse the dedicated topic/channel for conversation.`;
    }

    return {
      tuulija: true,
      radd,
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
      return { tuulija: true };
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
        tuulija: true,
        khata: `Failed to intaqalaIla branch ${session.far}. Switch aborted.`,
      };
    }

    if (!isNew) {
      await git.pull(session.far);
    }

    try {
      await this.mudirJalasat.jaddadaḤalatMurshid(identifier, "fail");
      this.mudirJalasat.wadaaMurshidFaail(identifier);
      this.huwiyyaFaaila = identifier;
      this.faailMundhu = new Date();
    } catch (err) {
      void logger.sajjalKhata("dispatcher", `Failed to activate ${identifier}, rolling back`, { error: String(err) });
      if (previousSession) {
        await this.mudirJalasat.jaddadaḤalatMurshid(previousActive!, "fail").catch(() => {});
        this.mudirJalasat.wadaaMurshidFaail(previousActive);
      }
      this.huwiyyaFaaila = previousActive;
      this.faailMundhu = previousActive ? new Date() : null;
      return { tuulija: true, khata: `Failed to activate ${identifier}: ${err}` };
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

    return { tuulija: true };

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
      huwiyya: huwiyya,
      unwan: entity.unwan,
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
    huwiyya: string,
    unwan: string,
    url: string,
    additionalContext?: string,
  ): Promise<NatijaIrsal> {
    const contextLine = additionalContext ? `\nAdditional context: ${additionalContext}` : "";

    const initMessage = `A ticket URL has been provided to work on:

URL: ${url}${contextLine}

Use \`mun_iqra_wasfa\` to understand this entity, then plan your approach.`;

    return this.#khalaqaWaFailaMurshid({
      huwiyya,
      unwan,
      type: "epic",
      initMessage,
      url,
    });
  }

  /**
   * Handle sandbox/brainstorm intent - freeform work without tickets
   */
  async aalajNiyyaWarsha(msg: RisalaWarida, intent: Niyya): Promise<NatijaIrsal> {
    const sandboxName = intent.ismWarsha;

    if (!sandboxName) {
      return {
        tuulija: true,
        radd: "What would you like to call this sandbox? (e.g., `sandbox pos-simulator`)",
      };
    }

    const huwiyya = `SANDBOX-${sandboxName}`;

    const initMessage = `A sandbox session has been started for you.

**Mode**: Sandbox (no ticket)
**Name**: ${sandboxName}
**Branch**: \`sandbox/${sandboxName}\`
**Original request**: "${msg.text}"

This is freeform work - no ticket tracking, no PR requirements. Brainstorm, prototype, experiment freely.

When you want to formalize this work into tickets, let al-Kimyawi know.`;

    return this.#khalaqaWaFailaMurshid({
      huwiyya,
      unwan: `Sandbox: ${sandboxName}`,
      type: "sandbox",
      initMessage,
    });
  }

  /**
   * Handle basic message (fallback when intent resolver returns needs_llm)
   */
  async aalajRisalaAsasiyya(msg: RisalaWarida, intent: Niyya): Promise<NatijaIrsal> {
    const { huwiyya, naw } = intent;
    let targetId: string | null = huwiyya;

    if (!targetId) {
      targetId = this.huwiyyaFaaila;

      if (!targetId) {
        return {
          tuulija: true,
          radd: "No active session. Mention a ticket ID or send a ticket URL to start one.",
        };
      }
    }

    const session = this.mudirJalasat.wajadaJalasatMurshid().find(
      (s) => s.huwiyya === targetId
    );

    if (!session) {
      return {
        tuulija: true,
        radd: `No murshid for ${targetId}. Send a ticket URL to start one.`,
      };
    }

    if (naw === "query") {
      return this.wajjahIlaJalsa(session, msg);
    }

    if (this.huwiyyaFaaila !== targetId) {
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
      ? `PR Comment from @${msg.katib}:\n\n`
      : "Al-Kimyawi says:\n\n";

    const success = await this.mudirJalasat.arsalaIlaMurshidById(
      session.huwiyya,
      `${prefix}${msg.text}`
    );

    if (success) {
      return {
        tuulija: true,
        radd: msg.source === "cli" ? undefined : `Message sent to ${session.huwiyya}.`,
      };
    }

    return { tuulija: true, khata: `Failed to send message to ${session.huwiyya}.` };
  }

  /**
   * Queue an operation for later execution
   */
  async ajjalAmaliyya(huwiyya: string, msg: RisalaWarida): Promise<NatijaIrsal> {
    const op: AmaliyyaMuajjala = {
      huwiyya,
      risala: msg.text,
      saaffFi: new Date(),
      source: msg.source,
      messageId: msg.messageId,
    };

    this.tabur.push(op);

    await logger.akhbar("dispatcher", `Queued operation for ${huwiyya}`, {
      queueLength: this.tabur.length,
    });

    return {
      tuulija: true,
      fiTtabur: true,
      radd: `Queued. ${this.huwiyyaFaaila} is currently active. Will notify when ${huwiyya} becomes active.`,
    };
  }


  wadaaJalsaFaila(identifier: string | null): void {
    this.huwiyyaFaaila = identifier;
    this.faailMundhu = identifier ? new Date() : null;
    this.mudirJalasat.wadaaMurshidFaail(identifier);
    void logger.akhbar("dispatcher", `Active session set to ${identifier ?? "none"}`);
  }

  hawiyyaFaila(): string | null {
    return this.huwiyyaFaaila;
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
      return { tuulija: true, radd: `No murshid for ${epicId}. Start one first.` };
    }

    const previousEpicId = this.huwiyyaFaaila;

    if (previousEpicId === epicId) {
      return {
        tuulija: true,
        radd: `✅ Already active: ${epicId}\n\nBranch: ${tarjalabJalsa.far}\nSession: ${tarjalabJalsa.id.slice(0, 16)}...`,
      };
    }

    /** Execute the core switchover logic (handles notification, queue, and dispatch) */
    const switchResult = await this.#naffadhaTahwilMurshid(
      epicId,
      tarjalabJalsa,
      previousEpicId,
      false
    );

    if (switchResult.khata) {
      return switchResult;
    }

    return { tuulija: true, radd: `Active: **${epicId}**` };
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
      const opsForEpic = this.tabur.filter((op) => op.huwiyya === epicId);
      this.tabur = this.tabur.filter((op) => op.huwiyya !== epicId);

      for (const op of opsForEpic) {
        await this.aalajWarid({
          source: op.source,
          text: op.risala,
          messageId: op.messageId,
        });
      }
    } finally {
      this.yuaalijTabur = false;
    }
  }


  jalabHala(): NatijaIrsal {
    const active = this.huwiyyaFaaila;
    const queueLen = this.tabur.length;
    const murshidun = this.mudirJalasat.wajadaJalasatMurshid();

    let radd = "**Status**\n\n";

    if (active) {
      const activeSession = murshidun.find((o) => o.huwiyya === active);
      radd += `✅ **Active: ${active}**\n`;
      if (activeSession) {
        radd += `   Session: ${activeSession.id.slice(0, 16)}...\n`;
        radd += `   Since: ${this.faailMundhu?.toISOString()}\n`;
      }
    } else {
      radd += `⚪ **Active: none**\n`;
    }

    radd += `\n`;

    radd += `Murshidun: ${murshidun.length}\n`;
    radd += `Queue: ${queueLen} operation(s)\n`;

    /** List other murshidun (if any) */
    const others = murshidun.filter((o) => o.huwiyya !== active);
    if (others.length > 0) {
      radd += `\n**Other murshidun (idle):**\n`;
      for (const o of others) {
        radd += `  - ${o.huwiyya}\n`;
      }
    }

    return { tuulija: true, radd };
  }

  jalabHalaTabur(): NatijaIrsal {
    if (this.tabur.length === 0) {
      return { tuulija: true, radd: "Operation queue is empty." };
    }

    let radd = "**Operation Queue**\n\n";

    for (let i = 0; i < this.tabur.length; i++) {
      const op = this.tabur[i];
      const age = Math.round((Date.now() - op.saaffFi.getTime()) / 1000 / 60);
      radd += `${i + 1}. ${op.huwiyya}: "${op.risala.slice(0, 50)}..." (${age}m ago)\n`;
    }

    return { tuulija: true, radd };
  }

  #jalabJalsasStatus(): NatijaIrsal {
    const murshidun = this.mudirJalasat.wajadaJalasatMurshid();

    /** Build response with switch buttons for idle sessions */
    let radd = "**Sessions**\n\n";

    if (murshidun.length === 0) {
      radd += "No murshidun.\n";
    } else {
      for (const o of murshidun) {
        const yakunuFaail = o.huwiyya === this.huwiyyaFaaila;
        if (yakunuFaail) {
          radd += `→ **${o.huwiyya}** (active)\n`;
          radd += `  ${escapeMarkdown(o.unwan)}\n\n`;
        } else {
          radd += `  ${o.huwiyya} (idle)\n`;
          radd += `  ${escapeMarkdown(o.unwan)}\n\n`;
        }
      }
    }

    /** Build buttons for idle sessions */
    const idleSessions = murshidun.filter((o) => o.huwiyya !== this.huwiyyaFaaila);
    const buttons = idleSessions.map((o) => ({
      text: `Switch to ${o.huwiyya}`,
      data: `switch:${o.huwiyya}`,
    }));

    return { tuulija: true, radd, buttons: buttons.length > 0 ? buttons : undefined };
  }

  aradhMuntaqiTahwil(): NatijaIrsal {
    const murshidun = this.mudirJalasat.wajadaJalasatMurshid();
    const idleSessions = murshidun.filter((o) => o.huwiyya !== this.huwiyyaFaaila);

    if (murshidun.length === 0) {
      return { tuulija: true, radd: "No murshidun to switch to." };
    }

    if (idleSessions.length === 0) {
      const active = this.huwiyyaFaaila;
      return {
        tuulija: true,
        radd: `Only one murshid exists: ${active} (already active)`,
      };
    }

    let radd = "**Switch Active Session**\n\n";

    if (this.huwiyyaFaaila) {
      const activeSession = murshidun.find((o) => o.huwiyya === this.huwiyyaFaaila);
      radd += `Current: **${this.huwiyyaFaaila}**\n`;
      if (activeSession) {
        radd += `${escapeMarkdown(activeSession.unwan)}\n`;
      }
      radd += "\n";
    }

    radd += "Choose:\n";
    for (let i = 0; i < idleSessions.length; i++) {
      const o = idleSessions[i];
      radd += `[${i + 1}] ${o.huwiyya} - ${escapeMarkdown(o.unwan)}\n`;
    }

    /** Build buttons */
    const buttons = idleSessions.map((o, i) => ({
      text: `[${i + 1}] ${o.huwiyya}`,
      data: `switch:${o.huwiyya}`,
    }));
    buttons.push({ text: "Cancel", data: "cancel" });

    return { tuulija: true, radd, buttons };
  }

}


export function istadaaMunadi(deps: MunadiDeps): Munadi {
  return new Munadi(deps);
}
