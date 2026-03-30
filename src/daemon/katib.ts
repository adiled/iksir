/**
 * Session Manager
 *
 * Manages OpenCode murshid sessions.
 *
 * Responsibilities:
 * - Create/resume murshid session per epic
 * - Track session-ticket-epic mappings
 * - Route messages to appropriate sessions
 * - Persist/restore session state via SQLite
 */

import { OpenCodeClient } from "../opencode/client.ts";
import { logger } from "../logging/logger.ts";
import { 
  upsertSession,
  getAllSessions,
  upsertChannel,
  getDiaryDecisions,
} from "../../db/db.ts";
import type {
  TaṣmīmIksir,
  JalsatMurshid,
  TrackedPR,
  TrackedPRStatus,
  NawʿMurshid,
  MessengerOutbound,
} from "../types.ts";

/**
 * Get the git user prefix for chore branches.
 * Checks IKSIR_GIT_USER env var, falls back to "dev".
 */
function getGitUserPrefix(): string {
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
    return `${getGitUserPrefix()}/${identifier}`;
  }
  if (type === "sandbox") {
    // Sandbox: use slug if provided, otherwise extract from identifier
    const name = slug ?? identifier.replace(/^SANDBOX-/i, "").toLowerCase();
    return `sandbox/${name}`;
  }
  // Epic: use explicit slug, or derive from title
  const effectiveSlug = slug ?? (title
    ? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30)
    : "work");
  return `epic/${identifier.toLowerCase()}-${effectiveSlug}`;
}

interface MudīrJalasātConfig {
  config: TaṣmīmIksir;
  opencode: OpenCodeClient;
  messenger: MessengerOutbound;
}

export class MudīrJalasāt {
  #config: TaṣmīmIksir;
  #opencode: OpenCodeClient;
  #messenger: MessengerOutbound;

  // Murshid sessions (keyed by identifier, e.g., "TEAM-200")
  #murshidSessions: Map<string, JalsatMurshid> = new Map();

  // Active murshid (currently only one at a time)
  #murshidFāʿilId: string | null = null;

  // Git fence — blocks PM-MCP git ops during session switches
  #gitFenced = false;

  constructor(deps: MudīrJalasātConfig) {
    this.#config = deps.config;
    this.#opencode = deps.opencode;
    this.#messenger = deps.messenger;
  }

  /** Get config (for future use) */
  get config(): TaṣmīmIksir {
    return this.#config;
  }

  /** Check if git ops are blocked (session switch in progress) */
  isGitFenced(): boolean {
    return this.#gitFenced;
  }

  /** Set git fence during session switches */
  setGitFence(value: boolean): void {
    this.#gitFenced = value;
  }

  // ===========================================================================
  // Murshid Session Management
  // ===========================================================================

  /**
   * Get or create murshid session
   * Returns metadata about what happened for clear user feedback
   */
  async wajadaAwKhalaqa(
    identifier: string,
    title: string,
    type: "epic" | "chore" | "sandbox" = "epic"
  ): Promise<{ session: JalsatMurshid; isNew: boolean; wasResumed: boolean; previousActive: string | null } | null> {
    const previousActive = this.#murshidFāʿilId;

    // Step 1: Check if we already have this session tracked
    let session = this.#murshidSessions.get(identifier);
    if (session) {
      // Verify session still exists in OpenCode
      const existing = await this.#opencode.getSession(session.id);
      if (existing) {
        await logger.info("session-manager", `Resuming tracked murshid session for ${identifier}`, {
          sessionId: session.id,
        });
        this.#murshidFāʿilId = identifier;
        // Ensure messaging channel exists (may have been created before channel support was added)
        await this.#ensureMessagingChannel(session);
        return { session, isNew: false, wasResumed: true, previousActive };
      }
      // Session was deleted from OpenCode, remove from our tracking
      await logger.warn("session-manager", `Tracked session ${session.id} no longer exists in OpenCode`);
      this.#murshidSessions.delete(identifier);
    }

    // Step 2: Check OpenCode for existing murshid session with matching title
    // This handles cases where state wasn't persisted (crash, restart without save, etc.)
    const existingSession = await this.#baḥathaʿAnJalsatMurshid(identifier);
    if (existingSession) {
      await logger.info("session-manager", `Found existing murshid session in OpenCode for ${identifier}`, {
        sessionId: existingSession.id,
      });

      session = {
        id: existingSession.id,
        identifier,
        title: existingSession.title,
        type,
        branch: generateBranchName(identifier, type, undefined, existingSession.title),
        status: "fā'il",
        createdAt: existingSession.createdAt.toISOString(),
        lastMessageAt: existingSession.lastMessageAt.toISOString(),
        activePRs: [],
        channels: this.#messenger.loadChannelsForSession(identifier),
      };

      this.#murshidSessions.set(identifier, session);
      this.#murshidFāʿilId = identifier;

      // Persist the recovered state
      await this.saveState();

      // Ensure messaging channel exists for recovered session
      await this.#ensureMessagingChannel(session);

      return { session, isNew: false, wasResumed: true, previousActive };
    }

    // Step 3: Create new murshid session
    await logger.info("session-manager", `Creating new murshid session for ${identifier}`);

    const sessionTitle = `[Murshid] ${identifier}: ${title}`;
    const openCodeSession = await this.#opencode.createSession(identifier, sessionTitle);

    if (!openCodeSession) {
      await logger.error("session-manager", `Failed to create murshid session for ${identifier}`);
      return null;
    }

    session = {
      id: openCodeSession.id,
      identifier,
      title,
      type,
      branch: generateBranchName(identifier, type, undefined, title),
      status: "fā'il",
      createdAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      activePRs: [],
      channels: {},
    };

    this.#murshidSessions.set(identifier, session);
    this.#murshidFāʿilId = identifier;

    // Persist state
    await this.saveState();

    // Create messaging channel for new murshid
    await this.#ensureMessagingChannel(session);

    // Send initial murshid prompt
    await this.#arsalaTasisMurshid(session);

    return { session, isNew: true, wasResumed: false, previousActive };
  }

  /**
   * Find an existing murshid session in OpenCode by searching titles
   */
  async #baḥathaʿAnJalsatMurshid(epicId: string): Promise<{
    id: string;
    title: string;
    createdAt: Date;
    lastMessageAt: Date;
  } | null> {
    const sessions = await this.#opencode.listSessions();
    const pattern = `[Murshid] ${epicId}:`;

    // Find sessions matching the pattern, sorted by most recent
    const matches = sessions
      .filter((s) => s.title.includes(pattern))
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());

    if (matches.length === 0) {
      return null;
    }

    // Return the most recent one
    const match = matches[0];

    // Log if there are orphaned duplicates
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
  wajadaMurshidFāʿil(): JalsatMurshid | null {
    if (!this.#murshidFāʿilId) return null;
    return this.#murshidSessions.get(this.#murshidFāʿilId) ?? null;
  }

  /**
   * Get murshid by epic ID
   */
  getMurshid(epicId: string): JalsatMurshid | null {
    return this.#murshidSessions.get(epicId) ?? null;
  }

  /**
   * Get murshid by messaging channel (provider + channelId).
   * Uses the messenger's cached reverse lookup.
   */
  wajadaMurshidBiQanāt(provider: string, channelId: string): JalsatMurshid | null {
    const identifier = this.#messenger.resolveSessionByChannel(provider, channelId);
    if (!identifier) return null;
    return this.#murshidSessions.get(identifier) ?? null;
  }

  /**
   * Ensure a messaging channel exists for an murshid.
   * Creates one if missing. Called automatically when murshid starts.
   */
  async #ensureMessagingChannel(session: JalsatMurshid): Promise<void> {
    // Already has a channel
    if (this.#messenger.yamlikuQanātMurshid(session.identifier)) {
      return;
    }

    const channelId = await this.#messenger.khalaqaQanatMurshid(
      session.identifier,
      session.title,
    );

    if (channelId) {
      session.channels["telegram"] = channelId;
      await this.saveState();

      // Send welcome message to the new channel
      await this.#messenger.send(
        { murshid: session.identifier },
        `Murshid session started for ${session.identifier}.\n\nAll messages for this epic will appear here.`,
      );

      // Notify the murshid LLM session about its channel
      await this.#opencode.sendPromptAsync(
        session.id,
        `SYSTEM: Your messaging channel is now active. ` +
        `All pm_reply and pm_notify messages will appear there. ` +
        `Operator is listening. If you have pending status updates or responses, please send them now using pm_reply.`,
      );
    }
  }

  /**
   * Get the active murshid ID
   */
  wajadaMurshidFāʿilId(): string | null {
    return this.#murshidFāʿilId;
  }

  /**
   * Set the active murshid (called by dispatcher during switch)
   */
  waḍaʿaMurshidFāʿil(epicId: string | null): void {
    this.#murshidFāʿilId = epicId;
  }

  /**
   * Update murshid status
   */
  async jaddadaḤālatMurshid(
    epicId: string,
    status: JalsatMurshid["status"],
    blockedReason?: string
  ): Promise<boolean> {
    const session = this.#murshidSessions.get(epicId);
    if (!session) {
      await logger.warn("session-manager", `Cannot update status - no session for ${epicId}`);
      return false;
    }

    session.status = status;
    if (blockedReason !== undefined) {
      session.blockedReason = blockedReason;
    } else if (status !== "masdūd" && status !== "muntaẓir") {
      // Clear blocked reason when not blocked/waiting
      session.blockedReason = undefined;
    }

    await this.saveState();
    await logger.info("session-manager", `Updated ${epicId} status to ${status}`, {
      blockedReason,
    });

    return true;
  }

  // ===========================================================================
  // PR Tracking (for Keepalive / Delayed Optics)
  // ===========================================================================

  /**
   * Register a new PR for tracking.
   * Called after successful PR creation via gh pr create.
   */
  async registerPR(
    epicId: string,
    pr: Omit<TrackedPR, "createdAt" | "statusChangedAt">
  ): Promise<boolean> {
    const session = this.#murshidSessions.get(epicId);
    if (!session) {
      await logger.warn("session-manager", `Cannot register PR - no session for ${epicId}`);
      return false;
    }

    // Check if PR already tracked
    const existing = session.activePRs.find((p) => p.prNumber === pr.prNumber);
    if (existing) {
      await logger.warn("session-manager", `PR #${pr.prNumber} already tracked for ${epicId}`);
      return false;
    }

    const now = new Date().toISOString();
    const trackedPR: TrackedPR = {
      ...pr,
      createdAt: now,
      statusChangedAt: now,
    };

    session.activePRs.push(trackedPR);
    await this.saveState();

    await logger.info("session-manager", `Registered PR #${pr.prNumber} for ${epicId}`, {
      wasfaId: pr.wasfaId,
      branch: pr.branch,
    });

    return true;
  }

  /**
   * Get murshid session by PR number.
   * Used by keepalive to find which murshid owns a PR.
   */
  getSessionByPR(prNumber: number): JalsatMurshid | null {
    for (const session of this.#murshidSessions.values()) {
      if (session.activePRs.some((pr) => pr.prNumber === prNumber)) {
        return session;
      }
    }
    return null;
  }

  /**
   * Update PR status (e.g., when merged or closed).
   * Returns the previous status for comparison.
   */
  async updatePRStatus(
    prNumber: number,
    status: TrackedPRStatus
  ): Promise<{ session: JalsatMurshid; previousStatus: TrackedPRStatus } | null> {
    for (const session of this.#murshidSessions.values()) {
      const pr = session.activePRs.find((p) => p.prNumber === prNumber);
      if (pr) {
        const previousStatus = pr.status;
        if (previousStatus === status) {
          return null; // No change
        }

        pr.status = status;
        pr.statusChangedAt = new Date().toISOString();
        await this.saveState();

        await logger.info("session-manager", `Updated PR #${prNumber} status: ${previousStatus} → ${status}`, {
          identifier: session.identifier,
          wasfaId: pr.wasfaId,
        });

        return { session, previousStatus };
      }
    }
    return null;
  }

  /**
   * Update the last polled time for a PR (persisted to prevent re-fetching comments on restart).
   */
  async updatePRLastPolled(prNumber: number): Promise<void> {
    for (const session of this.#murshidSessions.values()) {
      const pr = session.activePRs.find((p) => p.prNumber === prNumber);
      if (pr) {
        pr.lastPolledAt = new Date().toISOString();
        await this.saveState();
        return;
      }
    }
  }

  /**
   * Get all PRs being tracked across all sessions.
   * Useful for keepalive to poll all active PRs.
   */
  getAllTrackedPRs(): Array<{ session: JalsatMurshid; pr: TrackedPR }> {
    const result: Array<{ session: JalsatMurshid; pr: TrackedPR }> = [];
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
  wajadaRasāʾilFāʿilaLiMurshid(epicId: string): TrackedPR[] {
    const session = this.#murshidSessions.get(epicId);
    if (!session) return [];
    return session.activePRs.filter((pr) => pr.status !== "merged" && pr.status !== "closed");
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

    const messageWithReminder = this.#withSystemReminder(session, message);
    const success = await this.#opencode.sendPromptAsync(session.id, messageWithReminder);
    if (success) {
      session.lastMessageAt = new Date().toISOString();
    }
    return success;
  }

  /**
   * Send a message to the active murshid session.
   * Automatically injects huwiyyatMurshid reminder for pm_reply/pm_notify routing.
   */
  async arsalaIlaMurshid(message: string): Promise<boolean> {
    const session = this.wajadaMurshidFāʿil();
    if (!session) {
      await logger.warn("session-manager", "No active murshid session");
      return false;
    }

    const messageWithReminder = this.#withSystemReminder(session, message);
    const success = await this.#opencode.sendPromptAsync(session.id, messageWithReminder);
    if (success) {
      session.lastMessageAt = new Date().toISOString();
    }
    return success;
  }

  /**
   * Build message with system-reminder suffix for murshid routing.
   */
  #withSystemReminder(session: JalsatMurshid, message: string): string {
    return `${message}

<system-reminder>
Your murshid ID is: ${session.identifier}
IMPORTANT: This message is from the operator via Telegram. You MUST use pm_reply to respond.
Do NOT output text directly - The operator cannot see your text output, only pm_reply messages.
</system-reminder>`;
  }

  /**
   * Send initial prompt to murshid session
   * Uses iksir-murshid agent which has the full system prompt
   */
  async #arsalaTasisMurshid(session: JalsatMurshid): Promise<void> {
    const prompt = session.type === "epic" 
      ? `# Epic Assignment

## Epic Details
- **ID**: ${session.identifier}
- **Title**: ${session.title}

Please use \`pm_read_ticket\` to fetch the full epic details and begin planning.

Awaiting direction from operator...`
      : `# Chore Assignment

## Chore Details
- **ID**: ${session.identifier}
- **Title**: ${session.title}

This is a standalone task (chore), not an epic. No sub-tickets needed.

Please use \`pm_read_ticket\` to fetch the full details, then implement directly.
When done, use \`pm_ssp\` to create a PR.

Awaiting direction from operator...`;

    await this.#opencode.sendPromptAsync(session.id, prompt, {
      agent: "iksir-murshid",
    });
  }

  // ===========================================================================
  // State Access
  // ===========================================================================

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
  async handleCompaction(sessionId: string): Promise<void> {
    const session = this.wajadaMurshidBiHuwiyyatJalsa(sessionId);
    if (!session) return; // Not a Munadi murshid session

    await logger.info("session-manager", `Post-compaction diary reload for ${session.identifier}`, {
      sessionId,
    });

    // Fetch diary entries for this murshid
    const entries = getDiaryDecisions({
      huwiyyatMurshid: session.identifier,
      limit: 15,
    });

    if (entries.length === 0) {
      // No diary entries — just send a reminder about identity
      await this.#opencode.sendPromptAsync(session.id,
        `<system-reminder>
Context compaction occurred. Your conversation history was summarized.
Your murshid ID is: ${session.identifier}
Use pm_reply to respond to the operator — direct text output is invisible.
Use pm_read_diary to reload full decision history if needed.
</system-reminder>`
      );
      return;
    }

    // Format diary entries
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

Your murshid ID is: ${session.identifier}
Use pm_reply to respond to the operator — direct text output is invisible.
Call pm_read_diary for full decision history with reasoning.
</system-reminder>`
    );
  }

  /**
   * Get all murshid sessions
   */
  wajadaJalasātMurshid(): JalsatMurshid[] {
    return Array.from(this.#murshidSessions.values());
  }

  /**
   * Export state for persistence
   */
  exportState(): {
    murshidun: JalsatMurshid[];
    murshidFāʿil: string | null;
  } {
    return {
      murshidun: this.wajadaJalasātMurshid(),
      murshidFāʿil: this.#murshidFāʿilId,
    };
  }

  /**
   * Import state from persistence
   */
  importState(state: {
    murshidun?: JalsatMurshid[];
    murshidFāʿil?: string | null;
  }): void {
    if (state.murshidun) {
      for (const session of state.murshidun) {
        this.#murshidSessions.set(session.identifier, session);
      }
    }

    if (state.murshidFāʿil) {
      this.#murshidFāʿilId = state.murshidFāʿil;
    }
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  /**
   * Save session state to SQLite
   */
  async saveState(): Promise<void> {
    try {
      // Save each murshid session to SQLite
      for (const session of this.#murshidSessions.values()) {
        // Handle legacy sessions that might have epicTitle instead of title
        const title = session.title || (session as unknown as { epicTitle?: string }).epicTitle || "";
        
        upsertSession({
          id: session.id,
          identifier: session.identifier,
          title,
          type: session.type,
          status: session.status,
          branch: session.branch || "",
          blockedReason: session.blockedReason,
          createdAt: session.createdAt,
          lastMessageAt: session.lastMessageAt,
          metadata: {
            activePRs: session.activePRs || [],
          },
        });

        // Persist channels to the channels table
        for (const [provider, channelId] of Object.entries(session.channels)) {
          upsertChannel(session.identifier, provider, channelId);
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
   * Load and validate session state from SQLite
   * Validates that sessions still exist in OpenCode before using them
   */
  async loadState(): Promise<void> {
    try {
      const dbSessions = getAllSessions();
      
      if (dbSessions.length === 0) {
        await logger.info("session-manager", "No existing session state found");
        return;
      }

      // Validate murshid sessions still exist in OpenCode
      const murshidūnṢāliḥūn: JalsatMurshid[] = [];
      for (const dbSession of dbSessions) {
        const exists = await this.#opencode.getSession(dbSession.id);
        if (exists) {
          // Parse metadata
          const metadata = JSON.parse(dbSession.metadata || "{}") as {
            activePRs?: TrackedPR[];
          };

          // Hydrate channels from the channels table
          const channels = this.#messenger.loadChannelsForSession(dbSession.identifier);

          const session: JalsatMurshid = {
            id: dbSession.id,
            identifier: dbSession.identifier,
            title: dbSession.title,
            type: dbSession.type as NawʿMurshid,
            status: dbSession.status as JalsatMurshid["status"],
            branch: dbSession.branch ?? "",
            blockedReason: dbSession.blocked_reason ?? undefined,
            createdAt: dbSession.created_at,
            lastMessageAt: dbSession.last_message_at,
            channels,
            activePRs: metadata.activePRs ?? [],
          };

          murshidūnṢāliḥūn.push(session);
          await logger.info("session-manager", `Restored murshid session for ${session.identifier}`);
        } else {
          await logger.warn("session-manager", `Murshid session ${dbSession.id} no longer exists, skipping`);
        }
      }

      // Import validated state
      this.importState({
        murshidun: murshidūnṢāliḥūn,
      });

      // Find active murshid (one with status="fā'il")
      const activeSession = murshidūnṢāliḥūn.find(s => s.status === "fā'il");
      if (activeSession) {
        this.#murshidFāʿilId = activeSession.identifier;
      }

      await logger.info("session-manager", "Loaded session state from SQLite", {
        murshidun: murshidūnṢāliḥūn.length,
        active: this.#murshidFāʿilId,
      });

      // Ensure messaging channels exist for all loaded murshidun
      for (const session of murshidūnṢāliḥūn) {
        await this.#ensureMessagingChannel(session);
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
export function istadaaKatib(deps: MudīrJalasātConfig): MudīrJalasāt {
  return new MudīrJalasāt(deps);
}
