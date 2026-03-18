/**
 * Katib (كاتب) - The Scribe
 * 
 * One of the sacred Khuddām (خدّام - Servants) of the alchemical workshop.
 * Katib inscribes all transformations, managing the vessels (sessions) where
 * each Murshid performs their work. Every branch, every vessel naming, every
 * state transition is recorded in the eternal register.
 */

/**
 * Session Manager
 *
 * Manages OpenCode murshid sessions.
 *
 * Responsibilities:
 * - Create/resume murshid session per epic
 * - Track session-ticket-epic mappings
 * - Route messages to appropriate sessions
 * - Persist/istarjaa session state via SQLite
 */

import { OpenCodeClient } from "../opencode/client.ts";
import { logger } from "../logging/logger.ts";
import { 
  haddathaAwAdkhalaJalsa,
  jalabaKullJalasat,
  haddathaAwAdkhalaQanat,
  jalabaQararatSijill,
} from "../../db/db.ts";
import type {
  TasmimIksir,
  JalsatMurshid,
  RisalaMutaba,
  RisalaMutabaStatus,
  NawMurshid,
  RasulKharij,
} from "../types.ts";

/**
 * Get the git user prefix for chore branches.
 * Checks IKSIR_GIT_USER env var, falls back to "dev".
 */
function ismMustakhdimGit(): string {
  return Deno.env.get("IKSIR_GIT_USER") ?? "dev";
}

/**
 * Generate branch name for an murshid.
 * Single source of truth for branch naming convention:
 *   Epic:    epic/{identifier}-{slug}
 *   Chore:   {IKSIR_GIT_USER}/{identifier}
 *   Sandbox: sandbox/{name}
 *
 * @param identifier - Linear ticket identifier (e.g., TEAM-200) or SANDBOX-name
 * @param type - Murshid type
 * @param slug - Explicit slug (for epics). If omitted, derived from title.
 * @param title - Fallback for slug derivation (used by session-manager on creation)
 */
export function generateBranchName(
  identifier: string,
  type: "epic" | "chore" | "sandbox",
  slug?: string,
  title?: string,
): string {
  if (type === "chore") {
    return `${ismMustakhdimGit()}/${identifier}`;
  }
  if (type === "sandbox") {
    /** Sandbox: use slug if provided, otherwise extract from identifier */
    const name = slug ?? identifier.replace(/^SANDBOX-/i, "").toLowerCase();
    return `sandbox/${name}`;
  }
  /** Epic: use explicit slug, or derive from title */
  const effectiveSlug = slug ?? (title
    ? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30)
    : "work");
  return `epic/${identifier.toLowerCase()}-${effectiveSlug}`;
}

interface TasmimMudirJalasat {
  config: TasmimIksir;
  opencode: OpenCodeClient;
  messenger: RasulKharij;
}

export class MudirJalasat {
  #config: TasmimIksir;
  #opencode: OpenCodeClient;
  #messenger: RasulKharij;

  #murshidSessions: Map<string, JalsatMurshid> = new Map();

  #murshidFaailId: string | null = null;

  gitMasdud = false;

  constructor(deps: TasmimMudirJalasat) {
    this.#config = deps.config;
    this.#opencode = deps.opencode;
    this.#messenger = deps.messenger;
  }

  /** Get config (for future use) */
  get config(): TasmimIksir {
    return this.#config;
  }

  /** Check if git ops are blocked (session switch in progress) */
  huwaGitMasdud(): boolean {
    return this.gitMasdud;
  }

  /** Set git fence during session switches */
  wadaaQuflGit(value: boolean): void {
    this.gitMasdud = value;
  }


  /**
   * Get or create murshid session
   * Returns metadata about what happened for clear user feedback
   */
  async wajadaAwKhalaqa(
    identifier: string,
    title: string,
    type: "epic" | "chore" | "sandbox" = "epic"
  ): Promise<{ session: JalsatMurshid; isNew: boolean; wasResumed: boolean; previousActive: string | null } | null> {
    const previousActive = this.#murshidFaailId;

    /** Step 1: Check if we already have this session tracked */
    let session = this.#murshidSessions.get(identifier);
    if (session) {
      /** Verify session still exists in OpenCode */
      const existing = await this.#opencode.jalabJalsa(session.id);
      if (existing) {
        await logger.info("session-manager", `Resuming tracked murshid session for ${identifier}`, {
          sessionId: session.id,
        });
        this.#murshidFaailId = identifier;
        await this.takkadMinQanat(session);
        return { session, isNew: false, wasResumed: true, previousActive };
      }
      await logger.warn("session-manager", `Tracked session ${session.id} no longer exists in OpenCode`);
      this.#murshidSessions.delete(identifier);
    }

    /**
     * Step 2: Check OpenCode for existing murshid session with matching title
     * This handles cases where state wasn't persisted (crash, restart without save, etc.)
     */
    const existingSession = await this.#bahathaAnJalsatMurshid(identifier);
    if (existingSession) {
      await logger.info("session-manager", `Found existing murshid session in OpenCode for ${identifier}`, {
        sessionId: existingSession.id,
      });

      session = {
        id: existingSession.id,
        huwiyya: identifier,
        unwan: existingSession.title,
        naw: type,
        far: generateBranchName(identifier, type, undefined, existingSession.title),
        hala: "fail",
        unshiaFi: existingSession.createdAt.toISOString(),
        akhirRisalaFi: existingSession.lastMessageAt.toISOString(),
        activePRs: [],
        channels: this.#messenger.hammalQanawatLilJalsa(identifier),
      };

      this.#murshidSessions.set(identifier, session);
      this.#murshidFaailId = identifier;

      await this.hafizaHala();

      await this.takkadMinQanat(session);

      return { session, isNew: false, wasResumed: true, previousActive };
    }

    await logger.info("session-manager", `Creating new murshid session for ${identifier}`);

    const sessionTitle = `[Murshid] ${identifier}: ${title}`;
    const openCodeSession = await this.#opencode.khalaqaJalsa(identifier, sessionTitle);

    if (!openCodeSession) {
      await logger.error("session-manager", `Failed to create murshid session for ${identifier}`);
      return null;
    }

    session = {
      id: openCodeSession.id,
      huwiyya: identifier,
      unwan: title,
      naw: type,
      far: generateBranchName(identifier, type, undefined, title),
      hala: "fail",
      unshiaFi: new Date().toISOString(),
      akhirRisalaFi: new Date().toISOString(),
      activePRs: [],
      channels: {},
    };

    this.#murshidSessions.set(identifier, session);
    this.#murshidFaailId = identifier;

    await this.hafizaHala();

    await this.takkadMinQanat(session);

    await this.#arsalaTasisMurshid(session);

    return { session, isNew: true, wasResumed: false, previousActive };
  }

  /**
   * Find an existing murshid session in OpenCode by searching titles
   */
  async #bahathaAnJalsatMurshid(epicId: string): Promise<{
    id: string;
    title: string;
    createdAt: Date;
    lastMessageAt: Date;
  } | null> {
    const sessions = await this.#opencode.listSessions();
    const pattern = `[Murshid] ${epicId}:`;

    /** Find sessions matching the pattern, sorted by most recent */
    const matches = sessions
      .filter((s) => s.title.includes(pattern))
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());

    if (matches.length === 0) {
      return null;
    }

    /** Return the most recent one */
    const match = matches[0];

    if (matches.length > 1) {
      await logger.warn("session-manager", `Found ${matches.length} murshid sessions for ${epicId}, using most recent`, {
        sessionIds: matches.map((m) => m.id),
      });
    }

    return {
      id: match.id,
      title: match.title,
      createdAt: match.createdAt,
      lastMessageAt: match.lastMessageAt,
    };
  }

  /**
   * Get the active murshid session
   */
  wajadaMurshidFaail(): JalsatMurshid | null {
    if (!this.#murshidFaailId) return null;
    return this.#murshidSessions.get(this.#murshidFaailId) ?? null;
  }

  /**
   * Get murshid by epic ID
   */
  jalabMurshid(epicId: string): JalsatMurshid | null {
    return this.#murshidSessions.get(epicId) ?? null;
  }

  /**
   * Get murshid by messaging channel (provider + channelId).
   * Uses the messenger's cached reverse lookup.
   */
  wajadaMurshidBiQanat(provider: string, channelId: string): JalsatMurshid | null {
    const identifier = this.#messenger.hallJalsaBilQanat(provider, channelId);
    if (!identifier) return null;
    return this.#murshidSessions.get(identifier) ?? null;
  }

  /**
   * Ensure a messaging channel exists for an murshid.
   * Creates one if missing. Called automatically when murshid starts.
   */
  async takkadMinQanat(session: JalsatMurshid): Promise<void> {
    if (this.#messenger.yamlikQanatMurshid(session.huwiyya)) {
      return;
    }

    const channelId = await this.#messenger.khalaqaQanatMurshid(
      session.huwiyya,
      session.unwan,
    );

    if (channelId) {
      session.channels["telegram"] = channelId;
      await this.hafizaHala();

      await this.#messenger.send(
        { murshid: session.huwiyya },
        `Murshid session started for ${session.huwiyya}.\n\nAll messages for this epic will appear here.`,
      );

      await this.#opencode.sendPromptAsync(
        session.id,
        `SYSTEM: Your messaging channel is now active. ` +
        `All pm_reply and pm_notify messages will appear there. ` +
        `Al-Kimyawi is listening. If you have pending status updates or responses, please send them now using pm_reply.`,
      );
    }
  }

  /**
   * Get the active murshid ID
   */
  wajadaMurshidFaailId(): string | null {
    return this.#murshidFaailId;
  }

  /**
   * Set the active murshid (called by dispatcher during switch)
   */
  wadaaMurshidFaail(epicId: string | null): void {
    this.#murshidFaailId = epicId;
  }

  /**
   * Update murshid status
   */
  async jaddadaḤalatMurshid(
    epicId: string,
    status: JalsatMurshid["hala"],
    blockedReason?: string
  ): Promise<boolean> {
    const session = this.#murshidSessions.get(epicId);
    if (!session) {
      await logger.warn("session-manager", `Cannot update status - no session for ${epicId}`);
      return false;
    }

    session.hala = status;
    if (blockedReason !== undefined) {
      session.illa = blockedReason;
    } else if (status !== "masdud" && status !== "muntazir") {
      session.illa = undefined;
    }

    await this.hafizaHala();
    await logger.info("session-manager", `Updated ${epicId} status to ${status}`, {
      blockedReason,
    });

    return true;
  }


  /**
   * Register a new PR for tracking.
   * Called after successful PR creation via gh pr create.
   */
  async sajjalRisala(
    epicId: string,
    pr: Omit<RisalaMutaba, "createdAt" | "statusChangedAt">
  ): Promise<boolean> {
    const session = this.#murshidSessions.get(epicId);
    if (!session) {
      await logger.warn("session-manager", `Cannot register PR - no session for ${epicId}`);
      return false;
    }

    /** Check if PR already tracked */
    const existing = session.activePRs.find((p) => p.raqamRisala === pr.raqamRisala);
    if (existing) {
      await logger.warn("session-manager", `PR #${pr.raqamRisala} already tracked for ${epicId}`);
      return false;
    }

    const now = new Date().toISOString();
    const trackedPR: RisalaMutaba = {
      ...pr,
      unshiaFi: now,
      ghuyiratHalaFi: now,
    };

    session.activePRs.push(trackedPR);
    await this.hafizaHala();

    await logger.info("session-manager", `Registered PR #${pr.raqamRisala} for ${epicId}`, {
      huwiyyatWasfa: pr.huwiyyatWasfa,
      branch: pr.far,
    });

    return true;
  }

  /**
   * Get murshid session by PR number.
   * Used by keepalive to find which murshid owns a PR.
   */
  jalabJalsaBiRisala(raqamRisala: number): JalsatMurshid | null {
    for (const session of this.#murshidSessions.values()) {
      if (session.activePRs.some((pr) => pr.raqamRisala === raqamRisala)) {
        return session;
      }
    }
    return null;
  }

  /**
   * Update PR status (e.g., when merged or closed).
   * Returns the previous status for comparison.
   */
  async jaddadaHalatRisala(
    raqamRisala: number,
    status: RisalaMutabaStatus
  ): Promise<{ session: JalsatMurshid; previousStatus: RisalaMutabaStatus } | null> {
    for (const session of this.#murshidSessions.values()) {
      const pr = session.activePRs.find((p) => p.raqamRisala === raqamRisala);
      if (pr) {
        const previousStatus = pr.hala;
        if (previousStatus === status) {
          return null;
        }

        pr.hala = status;
        pr.ghuyiratHalaFi = new Date().toISOString();
        await this.hafizaHala();

        await logger.info("session-manager", `Updated PR #${raqamRisala} status: ${previousStatus} → ${status}`, {
          identifier: session.huwiyya,
          huwiyyatWasfa: pr.huwiyyatWasfa,
        });

        return { session, previousStatus };
      }
    }
    return null;
  }

  /**
   * Update the last polled time for a PR (persisted to prevent re-fetching comments on restart).
   */
  async jaddadaAkhirRaqaba(raqamRisala: number): Promise<void> {
    for (const session of this.#murshidSessions.values()) {
      const pr = session.activePRs.find((p) => p.raqamRisala === raqamRisala);
      if (pr) {
        pr.akhirRaqabaFi = new Date().toISOString();
        await this.hafizaHala();
        return;
      }
    }
  }

  /**
   * Get all PRs being tracked across all sessions.
   * Useful for keepalive to poll all active PRs.
   */
  jalabaKullRasaailMutaba(): Array<{ session: JalsatMurshid; pr: RisalaMutaba }> {
    const result: Array<{ session: JalsatMurshid; pr: RisalaMutaba }> = [];
    for (const session of this.#murshidSessions.values()) {
      for (const pr of session.activePRs) {
        result.push({ session, pr });
      }
    }
    return result;
  }

  /**
   * Get PRs for a specific murshid that are not yet merged/closed.
   */
  wajadaRasaailFaailaLiMurshid(epicId: string): RisalaMutaba[] {
    const session = this.#murshidSessions.get(epicId);
    if (!session) return [];
    return session.activePRs.filter((pr) => pr.hala !== "merged" && pr.hala !== "closed");
  }

  /**
   * Send a message to a specific murshid by epicId.
   * Automatically injects huwiyyatMurshid reminder for pm_reply/pm_notify routing.
   */
  async arsalaIlaMurshidById(epicId: string, message: string): Promise<boolean> {
    const session = this.#murshidSessions.get(epicId);
    if (!session) {
      await logger.warn("session-manager", `No murshid session for ${epicId}`);
      return false;
    }

    const messageWithReminder = this.maaTadhkirNizam(session, message);
    const success = await this.#opencode.sendPromptAsync(session.id, messageWithReminder);
    if (success) {
      session.akhirRisalaFi = new Date().toISOString();
    }
    return success;
  }

  /**
   * Send a message to the active murshid session.
   * Automatically injects huwiyyatMurshid reminder for pm_reply/pm_notify routing.
   */
  async arsalaIlaMurshid(message: string): Promise<boolean> {
    const session = this.wajadaMurshidFaail();
    if (!session) {
      await logger.warn("session-manager", "No active murshid session");
      return false;
    }

    const messageWithReminder = this.maaTadhkirNizam(session, message);
    const success = await this.#opencode.sendPromptAsync(session.id, messageWithReminder);
    if (success) {
      session.akhirRisalaFi = new Date().toISOString();
    }
    return success;
  }

  /**
   * Build message with system-reminder suffix for murshid routing.
   */
  maaTadhkirNizam(session: JalsatMurshid, message: string): string {
    return `${message}

<system-reminder>
Your murshid ID is: ${session.huwiyya}
IMPORTANT: This message is from al-Kimyawi via Telegram. You MUST use pm_reply to respond.
Do NOT output text directly - Al-Kimyawi cannot see your text output, only pm_reply messages.
</system-reminder>`;
  }

  /**
   * Send initial prompt to murshid session
   * Uses iksir-murshid agent which has the full system prompt
   */
  async #arsalaTasisMurshid(session: JalsatMurshid): Promise<void> {
    const prompt = session.naw === "epic" 
      ? `# Epic Assignment

## Epic Details
- **ID**: ${session.huwiyya}
- **Title**: ${session.unwan}

Please use \`pm_read_ticket\` to fetch the full epic details and begin planning.

Awaiting direction from al-Kimyawi...`
      : `# Chore Assignment

## Chore Details
- **ID**: ${session.huwiyya}
- **Title**: ${session.unwan}

This is a standalone task (chore), not an epic. No sub-tickets needed.

Please use \`pm_read_ticket\` to fetch the full details, then implement directly.
When done, use \`mun_istihal\` to create a PR.

Awaiting direction from al-Kimyawi...`;

    await this.#opencode.sendPromptAsync(session.id, prompt, {
      agent: "iksir-murshid",
    });
  }


  /**
   * Get murshid by OpenCode session ID (reverse lookup).
   * Used by SSE event handlers where only the OpenCode session ID is known.
   */
  wajadaMurshidBiHuwiyyatJalsa(sessionId: string): JalsatMurshid | null {
    for (const session of this.#murshidSessions.values()) {
      if (session.id === sessionId) return session;
    }
    return null;
  }

  /**
   * Handle a compaction event for an murshid session.
   *
   * After compaction, the murshid's conversation history is summarized and
   * prior context is lost. The compaction plugin injects diary entries INTO the
   * summary, but as a belt-and-suspenders measure, we also send a follow-up
   * message with diary entries and a reminder to use pm_read_diary.
   *
   * This catches both Daemon-triggered compactions (health-monitor) and
   * OpenCode-triggered compactions (token overflow).
   */
  async aalajaDamj(sessionId: string): Promise<void> {
    const session = this.wajadaMurshidBiHuwiyyatJalsa(sessionId);
    if (!session) return;

    await logger.info("session-manager", `Post-compaction diary reload for ${session.huwiyya}`, {
      sessionId,
    });

    /** Fetch diary entries for this murshid */
    const entries = jalabaQararatSijill({
      huwiyyatMurshid: session.huwiyya,
      limit: 15,
    });

    if (entries.length === 0) {
      await this.#opencode.sendPromptAsync(session.id,
        `<system-reminder>
Context compaction occurred. Your conversation history was summarized.
Your murshid ID is: ${session.huwiyya}
Use pm_reply to respond to al-Kimyawi — direct text output is invisible.
Use pm_read_diary to reload full decision history if needed.
</system-reminder>`
      );
      return;
    }

    /** Format diary entries */
    const diaryBlock = entries
      .map(
        (e) =>
          `[${(e.type as string).toUpperCase()}] ${e.created_at}: ${e.decision}`,
      )
      .join("\n");

    await this.#opencode.sendPromptAsync(session.id,
      `<system-reminder>
Context compaction occurred. Key diary decisions for your reference:

${diaryBlock}

Your murshid ID is: ${session.huwiyya}
Use pm_reply to respond to al-Kimyawi — direct text output is invisible.
Call pm_read_diary for full decision history with reasoning.
</system-reminder>`
    );
  }

  /**
   * Get all murshid sessions
   */
  wajadaJalasatMurshid(): JalsatMurshid[] {
    return Array.from(this.#murshidSessions.values());
  }

  /**
   * Export state for persistence
   */
  saddaraHala(): {
    murshidun: JalsatMurshid[];
    murshidFaail: string | null;
  } {
    return {
      murshidun: this.wajadaJalasatMurshid(),
      murshidFaail: this.#murshidFaailId,
    };
  }

  /**
   * Import state from persistence
   */
  istawradaHala(state: {
    murshidun?: JalsatMurshid[];
    murshidFaail?: string | null;
  }): void {
    if (state.murshidun) {
      for (const session of state.murshidun) {
        this.#murshidSessions.set(session.huwiyya, session);
      }
    }

    if (state.murshidFaail) {
      this.#murshidFaailId = state.murshidFaail;
    }
  }


  /**
   * Save session state to SQLite
   */
  async hafizaHala(): Promise<void> {
    try {
      for (const session of this.#murshidSessions.values()) {
        /** Handle legacy sessions that might have epicTitle instead of title */
        haddathaAwAdkhalaJalsa({
          id: session.id,
          huwiyya: session.huwiyya,
          unwan: session.unwan || (session as unknown as { epicTitle?: string }).epicTitle || "",
          naw: session.naw,
          hala: session.hala,
          far: session.far || "",
          illa: session.illa,
          unshiaFi: session.unshiaFi,
          akhirRisalaFi: session.akhirRisalaFi,
          halaMufassala: {
            activePRs: session.activePRs || [],
          },
        });

        for (const [provider, channelId] of Object.entries(session.channels)) {
          haddathaAwAdkhalaQanat(session.huwiyya, provider, channelId);
        }
      }

      await logger.info("session-manager", "Saved session state", {
        murshidun: this.#murshidSessions.size,
      });
    } catch (error) {
      await logger.error("session-manager", "Failed to save session state", {
        error: String(error),
      });
    }
  }

  /**
   * Load and tahaqqaq session state from SQLite
   * Validates that sessions still exist in OpenCode before using them
   */
  async hammalaHala(): Promise<void> {
    try {
      const dbSessions = jalabaKullJalasat();
      
      if (dbSessions.length === 0) {
        await logger.info("session-manager", "No existing session state found");
        return;
      }

      /** Validate murshid sessions still exist in OpenCode */
      const murshidunṢalihun: JalsatMurshid[] = [];
      for (const dbSession of dbSessions) {
        const exists = await this.#opencode.jalabJalsa(dbSession.id);
        if (exists) {
          /** Parse metadata */
          const metadata = JSON.parse(dbSession.hala_mufassala || "{}") as {
            activePRs?: RisalaMutaba[];
          };

          /** Hydrate channels from the qanawat table */
          const channels = this.#messenger.hammalQanawatLilJalsa(dbSession.huwiyya);

          const session: JalsatMurshid = {
            id: dbSession.id,
            huwiyya: dbSession.huwiyya,
            unwan: dbSession.unwan ?? "",
            naw: dbSession.naw as NawMurshid,
            hala: dbSession.hala as JalsatMurshid["hala"],
            far: dbSession.far ?? "",
            illa: dbSession.illa ?? undefined,
            unshiaFi: dbSession.unshia_fi,
            akhirRisalaFi: dbSession.akhir_risala_fi ?? "",
            channels,
            activePRs: metadata.activePRs ?? [],
          };

          murshidunṢalihun.push(session);
          await logger.info("session-manager", `Restored murshid session for ${session.huwiyya}`);
        } else {
          await logger.warn("session-manager", `Murshid session ${dbSession.id} no longer exists, skipping`);
        }
      }

      this.istawradaHala({
        murshidun: murshidunṢalihun,
      });

      /** Find active murshid (one with status="fail") */
      const activeSession = murshidunṢalihun.find(s => s.hala === "fail");
      if (activeSession) {
        this.#murshidFaailId = activeSession.huwiyya;
      }

      await logger.info("session-manager", "Loaded session state from SQLite", {
        murshidun: murshidunṢalihun.length,
        active: this.#murshidFaailId,
      });

      for (const session of murshidunṢalihun) {
        await this.takkadMinQanat(session);
      }
    } catch (error) {
      await logger.error("session-manager", "Failed to load session state", {
        error: String(error),
      });
    }
  }

}

/**
 * Create a session manager instance
 */
export function istadaaKatib(deps: TasmimMudirJalasat): MudirJalasat {
  return new MudirJalasat(deps);
}
