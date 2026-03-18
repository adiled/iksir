/**
 * Hayat (حياة) - The Life Force
 * 
 * One of the sacred Khuddām (خدّام - Servants) of the alchemical workshop.
 * Hayat maintains the vital essence of the work, keeping vigil over the
 * inscriptions (PRs), observing the quiet hours, performing the maintenance
 * rites that keep the workshop alive and breathing.
 */

/**
 * Keep-Alive Loop
 *
 * Periodic background tasks on a slow tick (minutes).
 *
 * 1. Detect PR merges and closures
 * 2. Process PR comments (amr al-Kimyawis, review feedback)
 * 3. Overnight maintenance (merge main into epic branches, rebuild code-intel index)
 */

import { GitHubClient } from "../github/gh.ts";
import { buildIndex } from "../code-intel/indexer.ts";
import { logger } from "../logging/logger.ts";
import { fiNitaqAlWaqt, minutesUntil, todayInTz } from "../utils/time.ts";
import * as git from "../git/operations.ts";
import type {
  TasmimIksir,
  TaaliqMuraja,
  JalsatMurshid,
  RisalaMutaba,
  RisalaMutabaStatus,
} from "../types.ts";
import type { MudirJalasat } from "./katib.ts";

/**
 * Result of maintenance run for a single branch
 */
export interface NatijaSeyana {
  branch: string;
  identifier: string;
  success: boolean;
  action: "merged" | "up-to-date" | "conflicts" | "error";
  conflicts?: string[];
  commitsBehind?: number;
  message: string;
}

/**
 * Callbacks for keepalive events.
 * These feed information to the owning murshid session.
 */
interface KeepAliveCallbacks {
  /**
   * PR was merged - murshid can now disclose next dependent slice
   */
  onPRMerged: (
    session: JalsatMurshid,
    pr: RisalaMutaba
  ) => Promise<void>;

  /**
   * PR was closed without merge
   */
  onPRClosed: (
    session: JalsatMurshid,
    pr: RisalaMutaba
  ) => Promise<void>;

  /**
   * Al-Kimyawi left a command on a PR - execute immediately
   */
  onAlKimyawiCommand: (
    session: JalsatMurshid,
    raqamRisala: number,
    comment: TaaliqMuraja
  ) => Promise<void>;

  /**
   * Other reviewers left comments - queue for muraja'at al-Kimyawi
   */
  onNewTaaliqMurajas: (
    session: JalsatMurshid,
    raqamRisala: number,
    comments: TaaliqMuraja[]
  ) => Promise<void>;

  /**
   * PR has merge conflicts
   */
  onPRConflict: (
    session: JalsatMurshid,
    pr: RisalaMutaba
  ) => Promise<void>;

  /**
   * PR CI checks failed
   */
  onCIFailed: (
    session: JalsatMurshid,
    pr: RisalaMutaba
  ) => Promise<void>;

  /**
   * Request maintenance mode - daemon should ensure no murshid is active
   * Returns true if maintenance mode was granted
   */
  requestMaintenanceMode: () => Promise<boolean>;

  /**
   * Release maintenance mode - daemon can resume normal operations
   */
  releaseMaintenanceMode: () => Promise<void>;

  /**
   * Maintenance completed - report results to al-Kimyawi
   */
  onMaintenanceComplete: (results: NatijaSeyana[]) => Promise<void>;
}

interface KeepAliveDeps {
  config: TasmimIksir;
  sessionManager: MudirJalasat;
  github: GitHubClient;
}

export class KeepAliveLoop {
  #config: TasmimIksir;
  #sessionManager: MudirJalasat;
  #github: GitHubClient;
  #callbacks: KeepAliveCallbacks;
  #lastMaintenanceDate: string | null = null;
  #maintenanceInProgress = false;
  #notifiedConflict: Set<number> = new Set();
  #notifiedCIFail: Set<number> = new Set();

  constructor(deps: KeepAliveDeps, callbacks: KeepAliveCallbacks) {
    this.#config = deps.config;
    this.#sessionManager = deps.sessionManager;
    this.#github = deps.github;
    this.#callbacks = callbacks;
  }

  /**
   * Run a single keep-alive cycle.
   * Polls all tracked PRs across all murshid sessions.
   */
  async cycle(): Promise<void> {
    const trackedPRs = this.#sessionManager.getAllRisalaMutabas();

    if (trackedPRs.length === 0) {
      await logger.debug("keepalive", "No PRs to monitor");
      return;
    }

    await logger.debug("keepalive", `Starting cycle: ${trackedPRs.length} PRs to monitor`);

    for (const { session, pr } of trackedPRs) {
      if (pr.status === "merged" || pr.status === "closed") {
        continue;
      }

      await this.#pollPR(session, pr);
    }

    if (this.#isQuietHours()) {
      await this.#runMaintenance();
    }

    await logger.debug("keepalive", "Cycle complete");
  }

  /**
   * Poll a single PR for status changes and comments
   */
  async #pollPR(session: JalsatMurshid, trackedPR: RisalaMutaba): Promise<void> {
    const raqamRisala = trackedPR.raqamRisala;
    const now = new Date();

    /**
     * Rate limit: don't poll same PR more than configured interval
     * Use persisted lastPolledAt from RisalaMutaba (survives daemon restarts)
     */
    const lastPoll = trackedPR.lastPolledAt ? new Date(trackedPR.lastPolledAt) : null;
    if (lastPoll && now.getTime() - lastPoll.getTime() < this.#config.polling.prPollIntervalMs) {
      return;
    }

    try {
      const pr = await this.#github.getPR(raqamRisala);
      if (!pr) {
        await logger.warn("keepalive", `PR #${raqamRisala} not found`);
        return;
      }

      await this.#checkStatusChange(session, trackedPR, pr.state);

      if (pr.mergeable === "CONFLICTING" && trackedPR.status !== "merged") {
        if (!this.#notifiedConflict.has(raqamRisala)) {
          await logger.warn("keepalive", `PR #${raqamRisala} has conflicts`);
          await this.#callbacks.onPRConflict(session, trackedPR);
          this.#notifiedConflict.add(raqamRisala);
        }
      } else {
        this.#notifiedConflict.delete(raqamRisala);
      }

      if (trackedPR.status === "draft") {
        const checksPassing = await this.#github.arePRChecksPassing(raqamRisala);
        if (!checksPassing) {
          if (!this.#notifiedCIFail.has(raqamRisala)) {
            await logger.warn("keepalive", `PR #${raqamRisala} CI failing`);
            await this.#callbacks.onCIFailed(session, trackedPR);
            this.#notifiedCIFail.add(raqamRisala);
          }
        } else {
          this.#notifiedCIFail.delete(raqamRisala);
        }
      }

      /**
       * Check for new comments (since last poll or PR creation)
       * Uses persisted lastPolledAt to prevent re-fetching all comments on daemon restart
       */
      const commentsSince = lastPoll ?? new Date(trackedPR.createdAt);
      const newComments = await this.#github.getNewComments(raqamRisala, commentsSince);
      if (newComments.length > 0) {
        await this.#processNewComments(session, raqamRisala, newComments);
      }

      await this.#sessionManager.updatePRLastPolled(raqamRisala);
    } catch (error) {
      await logger.error("keepalive", `Failed to poll PR #${raqamRisala}`, {
        error: String(error),
        epicId: session.identifier,
      });
    }
  }

  /**
   * Check if PR status changed and update tracking
   */
  async #checkStatusChange(
    session: JalsatMurshid,
    trackedPR: RisalaMutaba,
    githubState: string
  ): Promise<void> {
    const raqamRisala = trackedPR.raqamRisala;
    let newStatus: RisalaMutabaStatus | null = null;

    if (githubState === "MERGED" && trackedPR.status !== "merged") {
      newStatus = "merged";
      await logger.info("keepalive", `PR #${raqamRisala} merged`, {
        epicId: session.identifier,
        huwiyyatWasfa: trackedPR.huwiyyatWasfa,
      });
    } else if (githubState === "CLOSED" && trackedPR.status !== "closed") {
      newStatus = "closed";
      await logger.info("keepalive", `PR #${raqamRisala} closed`, {
        epicId: session.identifier,
        huwiyyatWasfa: trackedPR.huwiyyatWasfa,
      });
    } else if (githubState === "OPEN" && trackedPR.status === "draft") {
      newStatus = "open";
      await logger.info("keepalive", `PR #${raqamRisala} promoted to open`, {
        epicId: session.identifier,
      });
    }

    if (newStatus) {
      /** Update tracking */
      const result = await this.#sessionManager.updatePRStatus(raqamRisala, newStatus);

      if (newStatus === "merged" && result) {
        await this.#callbacks.onPRMerged(result.session, trackedPR);
      } else if (newStatus === "closed" && result) {
        await this.#callbacks.onPRClosed(result.session, trackedPR);
      }
    }
  }

  /**
   * Process new PR comments - mayyiz and route
   */
  async #processNewComments(
    session: JalsatMurshid,
    raqamRisala: number,
    comments: TaaliqMuraja[]
  ): Promise<void> {
    const ismKimyawi = this.#config.github.ismKimyawi;
    const awamirAlKimyawi: TaaliqMuraja[] = [];
    const taaliqatUkhra: TaaliqMuraja[] = [];

    for (const comment of comments) {
      if (comment.author === ismKimyawi && comment.assessment.isCommand) {
        awamirAlKimyawi.push(comment);
      } else if (comment.author !== ismKimyawi) {
        taaliqatUkhra.push(comment);
      }
    }

    for (const cmd of awamirAlKimyawi) {
      await logger.info("keepalive", `amr al-Kimyawi on PR #${raqamRisala}`, {
        body: cmd.body.slice(0, 100),
      });
      await this.#callbacks.onAlKimyawiCommand(session, raqamRisala, cmd);
    }

    if (taaliqatUkhra.length > 0) {
      await logger.info("keepalive", `${taaliqatUkhra.length} new comments on PR #${raqamRisala}`, {
        authors: [...new Set(taaliqatUkhra.map((c) => c.author))],
      });
      await this.#callbacks.onNewTaaliqMurajas(session, raqamRisala, taaliqatUkhra);
    }
  }


  /**
   * Check if currently in quiet hours (delegates to shared time utils)
   */
  #isQuietHours(): boolean {
    if (!this.#config.quietHours.enabled) return false;
    const { timezone, start, end } = this.#config.quietHours;
    return fiNitaqAlWaqt(timezone, start, end);
  }

  /**
   * Check if we're in the maintenance window (last N minutes of quiet hours).
   */
  #isLastQuietHour(): boolean {
    if (!this.#isQuietHours()) return false;
    const { timezone, end, maintenanceWindowMinutes } = this.#config.quietHours;
    const remaining = minutesUntil(timezone, end);
    return remaining <= maintenanceWindowMinutes && remaining > 0;
  }

  /**
   * Run maintenance tasks during quiet hours (last hour only)
   * 
   * Maintenance tasks:
   * - Merge main into all tracked epic branches
   * - Report conflicts (don't auto-resolve)
   */
  async #runMaintenance(): Promise<void> {
    if (!this.#isLastQuietHour()) {
      return;
    }

    /** Only run once per day (using configured timezone, not UTC) */
    const today = todayInTz(this.#config.quietHours.timezone);
    if (this.#lastMaintenanceDate === today) {
      return;
    }

    if (this.#maintenanceInProgress) {
      return;
    }

    await logger.info("keepalive", "Starting overnight maintenance");
    this.#maintenanceInProgress = true;

    /** Request maintenance mode (no active murshid) */
    const granted = await this.#callbacks.requestMaintenanceMode();
    if (!granted) {
      await logger.warn("keepalive", "Maintenance mode denied - murshid active");
      this.#maintenanceInProgress = false;
      return;
    }

    this.#sessionManager.setGitFence(true);

    try {
      const results: NatijaSeyana[] = [];
      const sessions = this.#sessionManager.wajadaJalasatMurshid();

      /** Save current branch to istarjaa later */
      const originalBranch = await git.farAlHali();

      await git.fetch();

      for (const session of sessions) {
        const result = await this.#maintainBranch(session);
        results.push(result);
      }

      if (originalBranch) {
        const istarjaad = await git.intaqalaIla(originalBranch);
        if (!istarjaad) {
          await logger.error("keepalive", `Failed to istarjaa branch ${originalBranch}, falling back to main`);
          await git.intaqalaIla("main");
        }
      }

      try {
        const repoPath = Deno.env.get("IKSIR_REPO_PATH") ?? ".";
        await buildIndex(repoPath);
      } catch (error) {
        await logger.warn("keepalive", "Code-intel index build failed", { error: String(error) });
      }

      await this.#callbacks.onMaintenanceComplete(results);

      this.#lastMaintenanceDate = today;
      await logger.info("keepalive", "Overnight maintenance complete", {
        branches: results.length,
        merged: results.filter(r => r.action === "merged").length,
        conflicts: results.filter(r => r.action === "conflicts").length,
      });
    } catch (error) {
      await logger.error("keepalive", "Maintenance failed", { error: String(error) });
    } finally {
      this.#sessionManager.setGitFence(false);
      await this.#callbacks.releaseMaintenanceMode();
      this.#maintenanceInProgress = false;
    }
  }

  /**
   * Maintain a single epic branch - merge main into it
   */
  async #maintainBranch(session: JalsatMurshid): Promise<NatijaSeyana> {
    const branch = session.branch;
    const identifier = session.identifier;

    await logger.info("keepalive", `Maintaining branch ${branch}`);

    try {
      /** Checkout the branch */
      const checkedOut = await git.intaqalaIla(branch);
      if (!checkedOut) {
        return {
          branch,
          identifier,
          success: false,
          action: "error",
          message: `Failed to intaqalaIla ${branch}`,
        };
      }

      /** Check how far behind we are */
      const behind = await git.commitsBehindMain(branch);
      if (behind === 0) {
        return {
          branch,
          identifier,
          success: true,
          action: "up-to-date",
          commitsBehind: 0,
          message: "Already up to date with main",
        };
      }

      /** Attempt merge */
      const mergeResult = await git.mergeMain();

      if (mergeResult.success) {
        await git.push(branch);

        return {
          branch,
          identifier,
          success: true,
          action: "merged",
          commitsBehind: behind,
          message: `Merged ${behind} commit(s) from main`,
        };
      }

      return {
        branch,
        identifier,
        success: false,
        action: "conflicts",
        conflicts: mergeResult.conflicts,
        commitsBehind: behind,
        message: mergeResult.message,
      };
    } catch (error) {
      return {
        branch,
        identifier,
        success: false,
        action: "error",
        message: String(error),
      };
    }
  }
}

/**
 * Create a keep-alive loop instance
 */
export function awqadaHayat(
  deps: KeepAliveDeps,
  callbacks: KeepAliveCallbacks
): KeepAliveLoop {
  return new KeepAliveLoop(deps, callbacks);
}
