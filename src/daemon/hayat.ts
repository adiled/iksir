/**
 * Keep-Alive Loop
 *
 * Periodic background tasks on a slow tick (minutes).
 *
 * 1. Detect PR merges and closures
 * 2. Process PR comments (operator commands, review feedback)
 * 3. Overnight maintenance (merge main into epic branches, rebuild code-intel index)
 */

import { GitHubClient } from "../github/gh.ts";
import { buildIndex } from "../code-intel/indexer.ts";
import { logger } from "../logging/logger.ts";
import { isInTimeRange, minutesUntil, todayInTz } from "../utils/time.ts";
import * as git from "../git/operations.ts";
import type {
  TaṣmīmIksir,
  ReviewComment,
  JalsatMurshid,
  TrackedPR,
  TrackedPRStatus,
} from "../types.ts";
import type { MudīrJalasāt } from "./session-manager.ts";

/**
 * Result of maintenance run for a single branch
 */
export interface MaintenanceResult {
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
    pr: TrackedPR
  ) => Promise<void>;

  /**
   * PR was closed without merge
   */
  onPRClosed: (
    session: JalsatMurshid,
    pr: TrackedPR
  ) => Promise<void>;

  /**
   * Operator left a command on a PR - execute immediately
   */
  onOperatorCommand: (
    session: JalsatMurshid,
    prNumber: number,
    comment: ReviewComment
  ) => Promise<void>;

  /**
   * Other reviewers left comments - queue for operator review
   */
  onNewReviewComments: (
    session: JalsatMurshid,
    prNumber: number,
    comments: ReviewComment[]
  ) => Promise<void>;

  /**
   * PR has merge conflicts
   */
  onPRConflict: (
    session: JalsatMurshid,
    pr: TrackedPR
  ) => Promise<void>;

  /**
   * PR CI checks failed
   */
  onCIFailed: (
    session: JalsatMurshid,
    pr: TrackedPR
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
   * Maintenance completed - report results to operator
   */
  onMaintenanceComplete: (results: MaintenanceResult[]) => Promise<void>;
}

interface KeepAliveDeps {
  config: TaṣmīmIksir;
  sessionManager: MudīrJalasāt;
  github: GitHubClient;
}

export class KeepAliveLoop {
  #config: TaṣmīmIksir;
  #sessionManager: MudīrJalasāt;
  #github: GitHubClient;
  #callbacks: KeepAliveCallbacks;
  #lastMaintenanceDate: string | null = null; // ISO date string (YYYY-MM-DD)
  #maintenanceInProgress = false;
  // Dedup guards: track PRs already notified about conflict/CI failure.
  // Cleared when the condition resolves so re-occurrence triggers a new notification.
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
    const trackedPRs = this.#sessionManager.getAllTrackedPRs();

    if (trackedPRs.length === 0) {
      await logger.debug("keepalive", "No PRs to monitor");
      return;
    }

    await logger.debug("keepalive", `Starting cycle: ${trackedPRs.length} PRs to monitor`);

    for (const { session, pr } of trackedPRs) {
      // Skip already-terminal PRs
      if (pr.status === "merged" || pr.status === "closed") {
        continue;
      }

      await this.#pollPR(session, pr);
    }

    // Check quiet hours for maintenance
    if (this.#isQuietHours()) {
      await this.#runMaintenance();
    }

    await logger.debug("keepalive", "Cycle complete");
  }

  /**
   * Poll a single PR for status changes and comments
   */
  async #pollPR(session: JalsatMurshid, trackedPR: TrackedPR): Promise<void> {
    const prNumber = trackedPR.prNumber;
    const now = new Date();

    // Rate limit: don't poll same PR more than configured interval
    // Use persisted lastPolledAt from TrackedPR (survives daemon restarts)
    const lastPoll = trackedPR.lastPolledAt ? new Date(trackedPR.lastPolledAt) : null;
    if (lastPoll && now.getTime() - lastPoll.getTime() < this.#config.polling.prPollIntervalMs) {
      return;
    }

    try {
      const pr = await this.#github.getPR(prNumber);
      if (!pr) {
        await logger.warn("keepalive", `PR #${prNumber} not found`);
        return;
      }

      // Check for status changes
      await this.#checkStatusChange(session, trackedPR, pr.state);

      // Check for merge conflicts (deduped — only notify once per conflict episode)
      if (pr.mergeable === "CONFLICTING" && trackedPR.status !== "merged") {
        if (!this.#notifiedConflict.has(prNumber)) {
          await logger.warn("keepalive", `PR #${prNumber} has conflicts`);
          await this.#callbacks.onPRConflict(session, trackedPR);
          this.#notifiedConflict.add(prNumber);
        }
      } else {
        // Conflict resolved — allow re-notification if it recurs
        this.#notifiedConflict.delete(prNumber);
      }

      // Check CI status (only for draft PRs, deduped)
      if (trackedPR.status === "draft") {
        const checksPassing = await this.#github.arePRChecksPassing(prNumber);
        if (!checksPassing) {
          if (!this.#notifiedCIFail.has(prNumber)) {
            await logger.warn("keepalive", `PR #${prNumber} CI failing`);
            await this.#callbacks.onCIFailed(session, trackedPR);
            this.#notifiedCIFail.add(prNumber);
          }
        } else {
          // CI recovered — allow re-notification if it fails again
          this.#notifiedCIFail.delete(prNumber);
        }
      }

      // Check for new comments (since last poll or PR creation)
      // Uses persisted lastPolledAt to prevent re-fetching all comments on daemon restart
      const commentsSince = lastPoll ?? new Date(trackedPR.createdAt);
      const newComments = await this.#github.getNewComments(prNumber, commentsSince);
      if (newComments.length > 0) {
        await this.#processNewComments(session, prNumber, newComments);
      }

      // Persist the poll time (survives daemon restarts)
      await this.#sessionManager.updatePRLastPolled(prNumber);
    } catch (error) {
      await logger.error("keepalive", `Failed to poll PR #${prNumber}`, {
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
    trackedPR: TrackedPR,
    githubState: string
  ): Promise<void> {
    const prNumber = trackedPR.prNumber;
    let newStatus: TrackedPRStatus | null = null;

    if (githubState === "MERGED" && trackedPR.status !== "merged") {
      newStatus = "merged";
      await logger.info("keepalive", `PR #${prNumber} merged`, {
        epicId: session.identifier,
        wasfaId: trackedPR.wasfaId,
      });
    } else if (githubState === "CLOSED" && trackedPR.status !== "closed") {
      newStatus = "closed";
      await logger.info("keepalive", `PR #${prNumber} closed`, {
        epicId: session.identifier,
        wasfaId: trackedPR.wasfaId,
      });
    } else if (githubState === "OPEN" && trackedPR.status === "draft") {
      // Draft was promoted to open (operator action)
      newStatus = "open";
      await logger.info("keepalive", `PR #${prNumber} promoted to open`, {
        epicId: session.identifier,
      });
    }

    if (newStatus) {
      // Update tracking
      const result = await this.#sessionManager.updatePRStatus(prNumber, newStatus);

      // Trigger callbacks
      if (newStatus === "merged" && result) {
        await this.#callbacks.onPRMerged(result.session, trackedPR);
      } else if (newStatus === "closed" && result) {
        await this.#callbacks.onPRClosed(result.session, trackedPR);
      }
    }
  }

  /**
   * Process new PR comments - classify and route
   */
  async #processNewComments(
    session: JalsatMurshid,
    prNumber: number,
    comments: ReviewComment[]
  ): Promise<void> {
    const operatorUsername = this.#config.github.operatorUsername;
    const operatorCommands: ReviewComment[] = [];
    const otherComments: ReviewComment[] = [];

    for (const comment of comments) {
      if (comment.author === operatorUsername && comment.assessment.isCommand) {
        // Operator left a command - execute immediately
        operatorCommands.push(comment);
      } else if (comment.author !== operatorUsername) {
        // Other reviewer comment - queue for operator review
        otherComments.push(comment);
      }
      // Ignore Operator.s non-command comments (e.g., acknowledgments)
    }

    // Process operator commands immediately
    for (const cmd of operatorCommands) {
      await logger.info("keepalive", `operator command on PR #${prNumber}`, {
        body: cmd.body.slice(0, 100),
      });
      await this.#callbacks.onOperatorCommand(session, prNumber, cmd);
    }

    // Queue other comments for operator review
    if (otherComments.length > 0) {
      await logger.info("keepalive", `${otherComments.length} new comments on PR #${prNumber}`, {
        authors: [...new Set(otherComments.map((c) => c.author))],
      });
      await this.#callbacks.onNewReviewComments(session, prNumber, otherComments);
    }
  }

  // ===========================================================================
  // Quiet Hours & Maintenance
  // ===========================================================================

  /**
   * Check if currently in quiet hours (delegates to shared time utils)
   */
  #isQuietHours(): boolean {
    if (!this.#config.quietHours.enabled) return false;
    const { timezone, start, end } = this.#config.quietHours;
    return isInTimeRange(timezone, start, end);
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
    // Only run in last quiet hour window
    if (!this.#isLastQuietHour()) {
      return;
    }

    // Only run once per day (using configured timezone, not UTC)
    const today = todayInTz(this.#config.quietHours.timezone);
    if (this.#lastMaintenanceDate === today) {
      return;
    }

    // Don't run if already in progress
    if (this.#maintenanceInProgress) {
      return;
    }

    await logger.info("keepalive", "Starting overnight maintenance");
    this.#maintenanceInProgress = true;

    // Request maintenance mode (no active murshid)
    const granted = await this.#callbacks.requestMaintenanceMode();
    if (!granted) {
      await logger.warn("keepalive", "Maintenance mode denied - murshid active");
      this.#maintenanceInProgress = false;
      return;
    }

    // Raise git fence — blocks PM-MCP git ops during maintenance
    this.#sessionManager.setGitFence(true);

    try {
      const results: MaintenanceResult[] = [];
      const sessions = this.#sessionManager.wajadaJalasātMurshid();

      // Save current branch to restore later
      const originalBranch = await git.getCurrentBranch();

      // Fetch latest from origin
      await git.fetch();

      for (const session of sessions) {
        const result = await this.#maintainBranch(session);
        results.push(result);
      }

      // Restore original branch (with fallback to main)
      if (originalBranch) {
        const restored = await git.checkout(originalBranch);
        if (!restored) {
          await logger.error("keepalive", `Failed to restore branch ${originalBranch}, falling back to main`);
          await git.checkout("main");
        }
      }

      // Rebuild code intelligence index
      try {
        const repoPath = Deno.env.get("IKSIR_REPO_PATH") ?? ".";
        await buildIndex(repoPath);
      } catch (error) {
        await logger.warn("keepalive", "Code-intel index build failed", { error: String(error) });
      }

      // Report results
      await this.#callbacks.onMaintenanceComplete(results);

      // Mark as done for today
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
  async #maintainBranch(session: JalsatMurshid): Promise<MaintenanceResult> {
    const branch = session.branch;
    const identifier = session.identifier;

    await logger.info("keepalive", `Maintaining branch ${branch}`);

    try {
      // Checkout the branch
      const checkedOut = await git.checkout(branch);
      if (!checkedOut) {
        return {
          branch,
          identifier,
          success: false,
          action: "error",
          message: `Failed to checkout ${branch}`,
        };
      }

      // Check how far behind we are
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

      // Attempt merge
      const mergeResult = await git.mergeMain();

      if (mergeResult.success) {
        // Push the merged branch
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

      // Conflicts detected
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
