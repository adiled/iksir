/**
 * Raqib (رقيب) - The Watcher
 * 
 * One of the sacred Khuddām (خدّام - Servants) of the alchemical workshop.
 * Raqib watches over the health of all transformations, detecting when
 * a Murshid has become stuck in contemplation or lost in the labyrinth.
 * The eternal guardian against fasād (corruption) in the work.
 */

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
 * - Alerts al-Kimyawi on Telegram for stuck sessions
 */

import { logger } from "../logging/logger.ts";
import type { OpenCodeClient } from "../opencode/client.ts";
import type { RasulKharij } from "../types.ts";
import type { MudirJalasat } from "./katib.ts";


/** How long a session can be "busy" before considered stuck (5 minutes) */
const HADD_ALIQ_MS = 5 * 60 * 1000;

/** Message count threshold for auto-compaction */
const HADD_DAMJ = 50;

/** Minimum interval between compaction attempts for same session (30 minutes) */
const TABREED_DAMJ_MS = 30 * 60 * 1000;

/** How long between health check ticks (60 seconds) */
const FATRA_NAQRA_MS = 60 * 1000;


interface RaqibDeps {
  opencode: OpenCodeClient;
  messenger: RasulKharij;
  sessionManager: MudirJalasat;
}

/** Tracked state for a session being monitored */
interface HalatSihhJalsa {
  /** Last time we compacted this session */
  lastCompactedAt: number | null;
  /** Whether we already alerted al-Kimyawi about this session being stuck */
  alertedStuck: boolean;
  /** Whether we already auto-aborted this session */
  aborted: boolean;
}


export class Raqib {
  #opencode: OpenCodeClient;
  #messenger: RasulKharij;
  #sessionManager: MudirJalasat;

  /** Per-session health tracking */
  sihhJalasat: Map<string, HalatSihhJalsa> = new Map();

  /** Timer handle for the tick loop */
  muwaqqitNaqra: ReturnType<typeof setInterval> | null = null;

  constructor(deps: RaqibDeps) {
    this.#opencode = deps.opencode;
    this.#messenger = deps.messenger;
    this.#sessionManager = deps.sessionManager;
  }

  /**
   * Start the health monitor tick loop
   */
  badaa(signal: AbortSignal): void {
    if (this.muwaqqitNaqra) return;

    void logger.akhbar("health-monitor", "Starting health monitor");

    this.naqra().catch(async (e) =>
      await logger.error("health-monitor", "Tick error", { error: String(e) })
    );

    this.muwaqqitNaqra = setInterval(() => {
      if (signal.aborted) {
        this.awqaf();
        return;
      }
      this.naqra().catch(async (e) =>
        await logger.error("health-monitor", "Tick error", { error: String(e) })
      );
    }, FATRA_NAQRA_MS);

    signal.addEventListener("abort", () => this.awqaf(), { once: true });
  }

  /**
   * Stop the health monitor
   */
  awqaf(): void {
    if (this.muwaqqitNaqra) {
      clearInterval(this.muwaqqitNaqra);
      this.muwaqqitNaqra = null;
      void logger.akhbar("health-monitor", "Stopped health monitor");
    }
  }

  /**
   * Single health check tick
   */
  async naqra(): Promise<void> {
    try {
      /** Get status of all sessions */
      const statuses = await this.#opencode.jalabJalsaStatuses();

      /** Check each murshid session */
      const murshidun = this.#sessionManager.wajadaJalasatMurshid();

      for (const orch of murshidun) {
        const status = statuses[orch.id];
        if (!status) continue;

        await this.fahasJalsa(orch.id, orch.huwiyya, status);
      }

      /** Clean up health state for sessions that no longer exist */
      const allSessionIds = new Set(
        murshidun.map((o) => o.id),
      );
      for (const id of this.sihhJalasat.keys()) {
        if (!allSessionIds.has(id)) {
          this.sihhJalasat.delete(id);
        }
      }
    } catch (error) {
      await logger.error("health-monitor", "Tick failed", { error: String(error) });
    }
  }

  /**
   * Check health of a single session
   */
  async fahasJalsa(
    sessionId: string,
    identifier: string,
    status: string
  ): Promise<void> {
    const state = this.wajadaAwKhalaqaHala(sessionId);
    const now = Date.now();


    if (status === "busy") {
      /**
       * Check the last assistant message to determine if truly stuck.
       * A session is stuck when its last assistant message has tokens_out=0,
       * isn't completed, and was created more than STUCK_THRESHOLD_MS ago.
       * This is more accurate than tracking busySince — it uses the message's
       * own timestamp, avoiding false positives from daemon restarts or
       * sessions that were already busy when the health monitor started.
       */
      const lastMsg = await this.#opencode.getLastAssistantMessage(sessionId);

      const isStuck =
        lastMsg &&
        lastMsg.tokensOutput === 0 &&
        !lastMsg.completedAt &&
        (now - lastMsg.createdAt) >= HADD_ALIQ_MS;

      if (!isStuck) {
        state.alertedStuck = false;
        state.aborted = false;
        return;
      }

      const stuckMinutes = Math.round((now - lastMsg.createdAt) / 60000);

      if (!state.alertedStuck) {
        await logger.haDHHir("health-monitor", `Session ${identifier} appears stuck`, {
          sessionId,
          stuckMinutes,
          lastMsgTokensOut: lastMsg.tokensOutput,
        });

        const msg = `Session **${identifier}** appears stuck\n\n` +
          `Last assistant message created ${stuckMinutes}m ago with no output.\n\n` +
          `Auto-aborting...`;

        await this.#messenger.arsalaMunassaq({ murshid: identifier }, msg);
        await this.#messenger.arsalaMunassaq("dispatch", msg);

        state.alertedStuck = true;
      }

      if (state.alertedStuck && !state.aborted) {
        await logger.haDHHir("health-monitor", `Auto-aborting stuck session ${identifier}`, {
          sessionId,
          stuckMinutes,
        });

        const aborted = await this.#opencode.abortSession(sessionId);

        if (aborted) {
          state.aborted = true;

          await this.#messenger.arsalaMunassaq("dispatch",
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
      state.alertedStuck = false;
      state.aborted = false;
    }


    if (status === "sakin") {
      await this.fahasDamj(sessionId, identifier, state, now);
    }
  }

  /**
   * Check if a session needs compaction based on message count
   */
  async fahasDamj(
    sessionId: string,
    identifier: string,
    state: HalatSihhJalsa,
    now: number
  ): Promise<void> {
    if (state.lastCompactedAt && now - state.lastCompactedAt < TABREED_DAMJ_MS) {
      return;
    }

    /** Get message count */
    const counts = await this.#opencode.jalabRisalaCount(sessionId);
    if (!counts) return;

    if (counts.total >= HADD_DAMJ) {
      await logger.akhbar("health-monitor", `Session ${identifier} has ${counts.total} messages, compacting`, {
        sessionId,
        threshold: HADD_DAMJ,
      });

      const success = await this.#opencode.summarizeSession(sessionId);

      if (success) {
        state.lastCompactedAt = now;

        await this.#messenger.arsalaMunassaq("dispatch",
          `Auto-compacted session **${identifier}** (${counts.total} messages → summarized)`
        );
      } else {
        await logger.haDHHir("health-monitor", `Failed to compact session ${identifier}`, {
          sessionId,
        });
      }
    }
  }

  /**
   * Get or create health state for a session
   */
  wajadaAwKhalaqaHala(sessionId: string): HalatSihhJalsa {
    let state = this.sihhJalasat.get(sessionId);
    if (!state) {
      state = {
        lastCompactedAt: null,
        alertedStuck: false,
        aborted: false,
      };
      this.sihhJalasat.set(sessionId, state);
    }
    return state;
  }
}

/**
 * Create a health monitor instance
 */
export function istadaaRaqib(deps: RaqibDeps): Raqib {
  return new Raqib(deps);
}
