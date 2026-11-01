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
import type { Wasila } from "../hum/wasila.ts";
import type { RasulKharij } from "../types.ts";
import type { MudirJalasat } from "./katib.ts";

const HADD_ALIQ_MS = 5 * 60 * 1000;

const HADD_DAMJ = 50;

const TABREED_DAMJ_MS = 30 * 60 * 1000;

const FATRA_NAQRA_MS = 60 * 1000;

interface RaqibDeps {
  amil: Wasila;
  rasul: RasulKharij;
  mudirJalasat: MudirJalasat;
}

interface HalatSihhJalsa {
  akhirDamjFi: number | null;
  adadQablaDamj: number | null;
  ublighaAnDamjAqim: boolean;
  ublighaAnAliq: boolean;
  ulghiya: boolean;
}

export class Raqib {
  #amil: Wasila;
  #messenger: RasulKharij;
  #sessionManager: MudirJalasat;

  #sihhJalasat: Map<string, HalatSihhJalsa> = new Map();
  #muwaqqitNaqra: ReturnType<typeof setInterval> | null = null;

  constructor(deps: RaqibDeps) {
    this.#amil = deps.amil;
    this.#messenger = deps.rasul;
    this.#sessionManager = deps.mudirJalasat;
  }

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

  awqaf(): void {
    if (this.#muwaqqitNaqra) {
      clearInterval(this.#muwaqqitNaqra);
      this.#muwaqqitNaqra = null;
      void logger.akhbar("health-monitor", "Stopped health monitor");
    }
  }

  async naqra(): Promise<void> {
    try {
      const statuses = await this.#amil.jalabJalsaStatuses();

      const murshidun = this.#sessionManager.wajadaJalasatMurshid();

      for (const orch of murshidun) {
        const status = statuses[orch.id];
        if (!status) continue;

        await this.fahasJalsa(orch.id, orch.huwiyya, status);
      }

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

  async fahasJalsa(
    sessionId: string,
    identifier: string,
    status: string
  ): Promise<void> {
    const state = this.wajadaAwKhalaqaHala(sessionId);
    const now = Date.now();

    if (status === "busy") {
      const lastMsg = await this.#amil.getLastAssistantMessage(sessionId);

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

        const aborted = await this.#amil.abortSession(sessionId);

        if (aborted) {
          state.ulghiya = true;

          await this.#messenger.arsalaMunassaq("dispatch",
            `Auto-aborted stuck session **${identifier}** (stuck ${stuckMinutes}m).`
          );

          await this.#amil.sendPromptAsync(sessionId,
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

  async fahasDamj(
    sessionId: string,
    identifier: string,
    state: HalatSihhJalsa,
    now: number
  ): Promise<void> {
    const counts = await this.#amil.jalabRisalaCount(sessionId);
    if (!counts) return;

    if (state.akhirDamjFi !== null && state.adadQablaDamj !== null) {
      if (counts.total < state.adadQablaDamj) {
        state.adadQablaDamj = null;
        state.ublighaAnDamjAqim = false;
      } else if (!state.ublighaAnDamjAqim && now - state.akhirDamjFi >= TABREED_DAMJ_MS) {
        state.ublighaAnDamjAqim = true;
        await logger.haDHHir("health-monitor", `Damj had no effect on ${identifier}`, {
          sessionId,
          qabl: state.adadQablaDamj,
          baad: counts.total,
        });
        await this.#messenger.arsalaMunassaq("dispatch",
          `Vessel **${identifier}** did not shrink after compaction ` +
          `(${state.adadQablaDamj} → ${counts.total} messages). The nest may not ` +
          `curate. Consider restarting this murshid before it grows incoherent.`
        );
      }
    }

    if (state.akhirDamjFi && now - state.akhirDamjFi < TABREED_DAMJ_MS) {
      return;
    }

    if (counts.total >= HADD_DAMJ) {
      await logger.akhbar("health-monitor", `Session ${identifier} has ${counts.total} messages, requesting damj`, {
        sessionId,
        threshold: HADD_DAMJ,
      });

      await this.#amil.summarizeSession(sessionId);
      state.akhirDamjFi = now;
      state.adadQablaDamj = counts.total;
      state.ublighaAnDamjAqim = false;
    }
  }

  wajadaAwKhalaqaHala(sessionId: string): HalatSihhJalsa {
    let state = this.#sihhJalasat.get(sessionId);
    if (!state) {
      state = {
        akhirDamjFi: null,
        adadQablaDamj: null,
        ublighaAnDamjAqim: false,
        ublighaAnAliq: false,
        ulghiya: false,
      };
      this.#sihhJalasat.set(sessionId, state);
    }
    return state;
  }
}

export function istadaaRaqib(deps: RaqibDeps): Raqib {
  return new Raqib(deps);
}
