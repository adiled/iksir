/**
 * Session Health Monitor
 *
 * Detects stuck sessions and prevents context exhaustion.
 *
 * Problems this solves:
 * 1. Bash tool hangs — session stays "busy" forever with tokens_out=0 on last message
 * 2. Context exhaustion — sessions degrade at ~60-80 messages, become incoherent
 * 3. Retry loops — session stuck in retry state, never recovers
 *
 * Strategy:
 * - Runs on a tick (default 60s)
 * - Checks all sessions with status "busy" against thresholds
 * - Auto-aborts sessions stuck for > STUCK_THRESHOLD_MS
 * - Auto-compacts sessions when message count > COMPACT_THRESHOLD
 * - Alerts operator on Telegram for stuck sessions
 */

import { logger } from "../logging/logger.ts";
import type { OpenCodeClient } from "../opencode/client.ts";
import type { MessengerOutbound } from "../types.ts";
import type { MudīrJalasāt } from "./session-manager.ts";

// =============================================================================
// Configuration
// =============================================================================

/** How long a session can be "busy" before considered stuck (5 minutes) */
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

/** Message count threshold for auto-compaction */
const COMPACT_THRESHOLD = 50;

/** Minimum interval between compaction attempts for same session (30 minutes) */
const COMPACT_COOLDOWN_MS = 30 * 60 * 1000;

/** How long between health check ticks (60 seconds) */
const TICK_INTERVAL_MS = 60 * 1000;

// =============================================================================
// Types
// =============================================================================

interface HealthMonitorDeps {
  opencode: OpenCodeClient;
  messenger: MessengerOutbound;
  sessionManager: MudīrJalasāt;
}

/** Tracked state for a session being monitored */
interface SessionHealthState {
  /** Last time we compacted this session */
  lastCompactedAt: number | null;
  /** Whether we already alerted operator about this session being stuck */
  alertedStuck: boolean;
  /** Whether we already auto-aborted this session */
  aborted: boolean;
}

// =============================================================================
// Health Monitor
// =============================================================================

export class HealthMonitor {
  #opencode: OpenCodeClient;
  #messenger: MessengerOutbound;
  #sessionManager: MudīrJalasāt;

  /** Per-session health tracking */
  #sessionHealth: Map<string, SessionHealthState> = new Map();

  /** Timer handle for the tick loop */
  #tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: HealthMonitorDeps) {
    this.#opencode = deps.opencode;
    this.#messenger = deps.messenger;
    this.#sessionManager = deps.sessionManager;
  }

  /**
   * Start the health monitor tick loop
   */
  start(signal: AbortSignal): void {
    if (this.#tickTimer) return;

    void logger.info("health-monitor", "Starting health monitor");

    // Initial tick
    this.#tick().catch(async (e) =>
      await logger.error("health-monitor", "Tick error", { error: String(e) })
    );

    // Schedule recurring ticks
    this.#tickTimer = setInterval(() => {
      if (signal.aborted) {
        this.stop();
        return;
      }
      this.#tick().catch(async (e) =>
        await logger.error("health-monitor", "Tick error", { error: String(e) })
      );
    }, TICK_INTERVAL_MS);

    // Cleanup on abort
    signal.addEventListener("abort", () => this.stop(), { once: true });
  }

  /**
   * Stop the health monitor
   */
  stop(): void {
    if (this.#tickTimer) {
      clearInterval(this.#tickTimer);
      this.#tickTimer = null;
      void logger.info("health-monitor", "Stopped health monitor");
    }
  }

  /**
   * Single health check tick
   */
  async #tick(): Promise<void> {
    try {
      // Get status of all sessions
      const statuses = await this.#opencode.getSessionStatuses();

      // Check each murshid session
      const murshidun = this.#sessionManager.wajadaJalasātMurshid();

      for (const orch of murshidun) {
        const status = statuses[orch.id];
        if (!status) continue;

        await this.#checkSession(orch.id, orch.identifier, status);
      }

      // Clean up health state for sessions that no longer exist
      const allSessionIds = new Set(
        murshidun.map((o) => o.id),
      );
      for (const id of this.#sessionHealth.keys()) {
        if (!allSessionIds.has(id)) {
          this.#sessionHealth.delete(id);
        }
      }
    } catch (error) {
      await logger.error("health-monitor", "Tick failed", { error: String(error) });
    }
  }

  /**
   * Check health of a single session
   */
  async #checkSession(
    sessionId: string,
    identifier: string,
    status: string
  ): Promise<void> {
    const state = this.#getOrCreateState(sessionId);
    const now = Date.now();

    // =========================================================================
    // Stuck Detection
    // =========================================================================

    if (status === "busy") {
      // Check the last assistant message to determine if truly stuck.
      // A session is stuck when its last assistant message has tokens_out=0,
      // isn't completed, and was created more than STUCK_THRESHOLD_MS ago.
      // This is more accurate than tracking busySince — it uses the message's
      // own timestamp, avoiding false positives from daemon restarts or
      // sessions that were already busy when the health monitor started.
      const lastMsg = await this.#opencode.getLastAssistantMessage(sessionId);

      const isStuck =
        lastMsg &&
        lastMsg.tokensOutput === 0 &&
        !lastMsg.completedAt &&
        (now - lastMsg.createdAt) >= STUCK_THRESHOLD_MS;

      if (!isStuck) {
        // Busy but making progress — reset flags
        state.alertedStuck = false;
        state.aborted = false;
        return;
      }

      const stuckMinutes = Math.round((now - lastMsg.createdAt) / 60000);

      // Alert operator (once)
      if (!state.alertedStuck) {
        await logger.warn("health-monitor", `Session ${identifier} appears stuck`, {
          sessionId,
          stuckMinutes,
          lastMsgTokensOut: lastMsg.tokensOutput,
        });

        const msg = `Session **${identifier}** appears stuck\n\n` +
          `Last assistant message created ${stuckMinutes}m ago with no output.\n\n` +
          `Auto-aborting...`;

        await this.#messenger.sendFormatted({ murshid: identifier }, msg);
        await this.#messenger.sendFormatted("dispatch", msg);

        state.alertedStuck = true;
      }

      // Auto-abort (once, after alert)
      if (state.alertedStuck && !state.aborted) {
        await logger.warn("health-monitor", `Auto-aborting stuck session ${identifier}`, {
          sessionId,
          stuckMinutes,
        });

        const aborted = await this.#opencode.abortSession(sessionId);

        if (aborted) {
          state.aborted = true;

          await this.#messenger.sendFormatted("dispatch",
            `Auto-aborted stuck session **${identifier}** (stuck ${stuckMinutes}m).`
          );

          await this.#opencode.sendPromptAsync(sessionId,
            `SYSTEM: Your previous operation was auto-aborted because it appeared stuck (${stuckMinutes} minutes with no output). ` +
            `This typically happens when a bash command hangs. ` +
            `Please avoid long-running bash commands. If you need to run tests or builds, use timeouts.`
          );
        }
      }
    } else {
      // Not busy — reset stuck tracking
      state.alertedStuck = false;
      state.aborted = false;
    }

    // =========================================================================
    // Auto-Compaction
    // =========================================================================

    // Only compact idle sessions (don't interrupt busy ones)
    if (status === "sākin") {
      await this.#checkCompaction(sessionId, identifier, state, now);
    }
  }

  /**
   * Check if a session needs compaction based on message count
   */
  async #checkCompaction(
    sessionId: string,
    identifier: string,
    state: SessionHealthState,
    now: number
  ): Promise<void> {
    // Cooldown check
    if (state.lastCompactedAt && now - state.lastCompactedAt < COMPACT_COOLDOWN_MS) {
      return;
    }

    // Get message count
    const counts = await this.#opencode.getMessageCount(sessionId);
    if (!counts) return;

    if (counts.total >= COMPACT_THRESHOLD) {
      await logger.info("health-monitor", `Session ${identifier} has ${counts.total} messages, compacting`, {
        sessionId,
        threshold: COMPACT_THRESHOLD,
      });

      const success = await this.#opencode.summarizeSession(sessionId);

      if (success) {
        state.lastCompactedAt = now;

        await this.#messenger.sendFormatted("dispatch",
          `Auto-compacted session **${identifier}** (${counts.total} messages → summarized)`
        );
      } else {
        await logger.warn("health-monitor", `Failed to compact session ${identifier}`, {
          sessionId,
        });
      }
    }
  }

  /**
   * Get or create health state for a session
   */
  #getOrCreateState(sessionId: string): SessionHealthState {
    let state = this.#sessionHealth.get(sessionId);
    if (!state) {
      state = {
        lastCompactedAt: null,
        alertedStuck: false,
        aborted: false,
      };
      this.#sessionHealth.set(sessionId, state);
    }
    return state;
  }
}

/**
 * Create a health monitor instance
 */
export function istadaaRaqib(deps: HealthMonitorDeps): HealthMonitor {
  return new HealthMonitor(deps);
}
