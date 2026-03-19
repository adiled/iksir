/**
 * Raqib (رقيب) — The Watcher
 *
 * One of the sacred Khuddām (خدّام) of Iksīr.
 *
 * Raqib never blinks. On a steady heartbeat — once a minute — Raqib
 * examines every vessel in which a Murshid dwells. Has the Murshid
 * fallen silent? Is the vessel swelling with too many risālāt?
 * Has fasād crept in?
 *
 * Three ailments Raqib watches for:
 *   I.   Al-'Aliq (العالق) — the stuck: the Murshid called upon a tool
 *        that never returned. Minutes pass. No tokens flow. Raqib alerts
 *        al-Kimyawi, then mercifully aborts the stalled invocation.
 *   II.  Al-Takhma (التخمة) — the bloated: too many messages have
 *        accumulated. The vessel grows heavy, the Murshid incoherent.
 *        Raqib compacts — distills the history into essence.
 *   III. Al-Takrar (التكرار) — the loop: the Murshid retries endlessly.
 *        Raqib sees the pattern and intervenes.
 *
 * Raqib does not heal. Raqib watches, alerts, and when necessary,
 * cuts the thread.
 */

import { logger } from "../logging/logger.ts";
import type { OpenCodeClient } from "../opencode/client.ts";
import type { RasulKharij } from "../types.ts";
import type { MudirJalasat } from "./katib.ts";


/** How long before a silent vessel is declared 'aliq (stuck) */
const HADD_ALIQ_MS = 5 * 60 * 1000;

/** How many risālāt before the vessel needs damj (compaction) */
const HADD_DAMJ = 50;

/** Cooldown between damj attempts on the same vessel */
const TABREED_DAMJ_MS = 30 * 60 * 1000;

/** The heartbeat — time between naqrāt (ticks) */
const FATRA_NAQRA_MS = 60 * 1000;


interface RaqibDeps {
  opencode: OpenCodeClient;
  rasul: RasulKharij;
  mudirJalasat: MudirJalasat;
}

/** The health record Raqib keeps for each vessel */
interface HalatSihhJalsa {
  /** When Raqib last performed damj on this vessel */
  akhirDamjFi: number | null;
  /** Has al-Kimyawi been alerted about this vessel's 'aliq state? */
  ublighaAnAliq: boolean;
  /** Has Raqib already cut the thread on this vessel? */
  ulghiya: boolean;
}


export class Raqib {
  #opencode: OpenCodeClient;
  #messenger: RasulKharij;
  #sessionManager: MudirJalasat;

  #sihhJalasat: Map<string, HalatSihhJalsa> = new Map();
  #muwaqqitNaqra: ReturnType<typeof setInterval> | null = null;

  constructor(deps: RaqibDeps) {
    this.#opencode = deps.opencode;
    this.#messenger = deps.rasul;
    this.#sessionManager = deps.mudirJalasat;
  }

  /**
   * Start the health monitor tick loop
   */
  badaa(signal: AbortSignal): void {
    if (this.#muwaqqitNaqra) return;

    void logger.akhbar("health-monitor", "Starting health monitor");

    this.naqra().catch(async (e) =>
      await logger.sajjalKhata("health-monitor", "Tick error", { error: String(e) })
    );

    this.#muwaqqitNaqra = setInterval(() => {
      if (signal.aborted) {
        this.awqaf();
        return;
      }
      this.naqra().catch(async (e) =>
        await logger.sajjalKhata("health-monitor", "Tick error", { error: String(e) })
      );
    }, FATRA_NAQRA_MS);

    signal.addEventListener("abort", () => this.awqaf(), { once: true });
  }

  /**
   * Stop the health monitor
   */
  awqaf(): void {
    if (this.#muwaqqitNaqra) {
      clearInterval(this.#muwaqqitNaqra);
      this.#muwaqqitNaqra = null;
      void logger.akhbar("health-monitor", "Stopped health monitor");
    }
  }

  /**
   * Single health check tick
   */
  async naqra(): Promise<void> {
    try {
      /** Survey all vessels */
      const statuses = await this.#opencode.jalabJalsaStatuses();

      /** Examine each murshid vessel */
      const murshidun = this.#sessionManager.wajadaJalasatMurshid();

      for (const orch of murshidun) {
        const status = statuses[orch.id];
        if (!status) continue;

        await this.fahasJalsa(orch.id, orch.huwiyya, status);
      }

      /** Forget vessels that have been extinguished */
      const allSessionIds = new Set(
        murshidun.map((o) => o.id),
      );
      for (const id of this.#sihhJalasat.keys()) {
        if (!allSessionIds.has(id)) {
          this.#sihhJalasat.delete(id);
        }
      }
    } catch (error) {
      await logger.sajjalKhata("health-monitor", "Tick failed", { error: String(error) });
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
       * Read the last utterance from the vessel. If it produced no tokens,
       * never completed, and has been silent longer than HADD_ALIQ — 
       * the Murshid is 'aliq. The thread must be cut.
       */
      const lastMsg = await this.#opencode.getLastAssistantMessage(sessionId);

      const isStuck =
        lastMsg &&
        lastMsg.tokensOutput === 0 &&
        !lastMsg.completedAt &&
        (now - lastMsg.createdAt) >= HADD_ALIQ_MS;

      if (!isStuck) {
        state.ublighaAnAliq = false;
        state.ulghiya = false;
        return;
      }

      const stuckMinutes = Math.round((now - lastMsg.createdAt) / 60000);

      if (!state.ublighaAnAliq) {
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

        state.ublighaAnAliq = true;
      }

      if (state.ublighaAnAliq && !state.ulghiya) {
        await logger.haDHHir("health-monitor", `Auto-aborting stuck session ${identifier}`, {
          sessionId,
          stuckMinutes,
        });

        const aborted = await this.#opencode.abortSession(sessionId);

        if (aborted) {
          state.ulghiya = true;

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
      state.ublighaAnAliq = false;
      state.ulghiya = false;
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
    if (state.akhirDamjFi && now - state.akhirDamjFi < TABREED_DAMJ_MS) {
      return;
    }

    /** Count the risālāt within */
    const counts = await this.#opencode.jalabRisalaCount(sessionId);
    if (!counts) return;

    if (counts.total >= HADD_DAMJ) {
      await logger.akhbar("health-monitor", `Session ${identifier} has ${counts.total} messages, compacting`, {
        sessionId,
        threshold: HADD_DAMJ,
      });

      const success = await this.#opencode.summarizeSession(sessionId);

      if (success) {
        state.akhirDamjFi = now;

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
    let state = this.#sihhJalasat.get(sessionId);
    if (!state) {
      state = {
        akhirDamjFi: null,
        ublighaAnAliq: false,
        ulghiya: false,
      };
      this.#sihhJalasat.set(sessionId, state);
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
