/**
 * Al-Raqīb (الرقيب) — the Watcher
 *
 * One of the Khuddām, and a bee of his own. Once a minute he looks at every
 * vessel in which a murshid dwells. Two ailments he sees by counting:
 *
 *   al-ʿĀliq  (the stuck)   — a turn five minutes old with no tokens out;
 *                             al-Kimyawī is told, then the turn is cut
 *   al-Takhma (the bloated) — fifty messages; the vessel is compacted
 *
 * The third needs judgment, so for it he thinks: every five minutes, when
 * the flame holder's trail has grown, he reads that trail — what it said,
 * what it reached for — against the waṣfa, in a fresh session he keeps no
 * memory of, and rules:
 *
 *   yataqaddam — progressing; nothing is said
 *   yadur      — going in circles; a word is put in the vessel, and twice
 *                running al-Kimyawī hears of it
 *   yahid      — strayed from the waṣfa; a word is put in the vessel
 *   yastaghith — blocked on something only al-Kimyawī can give; he is told
 *
 * Al-Raqīb does not heal. He watches, speaks once, and when he must, cuts.
 */

import { logger } from "../logging/logger.ts";
import type { Wasila } from "../hum/wasila.ts";
import type { RasulKharij } from "../types.ts";
import type { MudirJalasat } from "./katib.ts";
import type { SijillWasfat } from "../wasfa/sijill-wasfat.ts";
import type { JalsatMurshid } from "../types.ts";
import { nazzifJson } from "../utils/strings.ts";

const HADD_ALIQ_MS = 5 * 60 * 1000;

const HADD_DAMJ = 50;

const TABREED_DAMJ_MS = 30 * 60 * 1000;

const FATRA_NAQRA_MS = 60 * 1000;

const HADD_HUKM_MS = 5 * 60 * 1000;

const AQALL_ATHAR = 3;

interface Hukm {
  hukm: "yataqaddam" | "yadur" | "yahid" | "yastaghith";
  sabab?: string;
  kalima?: string | null;
}

interface RaqibDeps {
  amil: Wasila;
  rasul: RasulKharij;
  mudirJalasat: MudirJalasat;
  wasfat?: SijillWasfat;
}

interface HalatSihhJalsa {
  akhirDamjFi: number | null;
  adadQablaDamj: number | null;
  ublighaAnDamjAqim: boolean;
  ublighaAnAliq: boolean;
  ulghiya: boolean;
  akhirHukmFi: number;
  adadAtharHukm: number;
  adadYadur: number;
}

export class Raqib {
  #amil: Wasila;
  #messenger: RasulKharij;
  #sessionManager: MudirJalasat;
  #wasfat?: SijillWasfat;

  #sihhJalasat: Map<string, HalatSihhJalsa> = new Map();
  #muwaqqitNaqra: ReturnType<typeof setInterval> | null = null;

  constructor(deps: RaqibDeps) {
    this.#amil = deps.amil;
    this.#messenger = deps.rasul;
    this.#sessionManager = deps.mudirJalasat;
    this.#wasfat = deps.wasfat;
  }

  badaa(signal: AbortSignal): void {
    if (this.#muwaqqitNaqra) return;

    void logger.akhbar("raqib", "Starting health monitor");

    this.naqra().catch(async (e) =>
      await logger.sajjalKhata("raqib", "Tick error", { error: String(e) })
    );

    this.#muwaqqitNaqra = setInterval(() => {
      if (signal.aborted) {
        this.awqaf();
        return;
      }
      this.naqra().catch(async (e) =>
        await logger.sajjalKhata("raqib", "Tick error", { error: String(e) })
      );
    }, FATRA_NAQRA_MS);

    signal.addEventListener("abort", () => this.awqaf(), { once: true });
  }

  awqaf(): void {
    if (this.#muwaqqitNaqra) {
      clearInterval(this.#muwaqqitNaqra);
      this.#muwaqqitNaqra = null;
      void logger.akhbar("raqib", "Stopped health monitor");
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
        if (orch.hala === "fail") await this.hakama(orch);
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
      await logger.sajjalKhata("raqib", "Tick failed", { error: String(error) });
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
        await logger.haDHHir("raqib", `Session ${identifier} appears stuck`, {
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
        await logger.haDHHir("raqib", `Auto-aborting stuck session ${identifier}`, {
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
        await logger.haDHHir("raqib", `Damj had no effect on ${identifier}`, {
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
      await logger.akhbar("raqib", `Session ${identifier} has ${counts.total} messages, requesting damj`, {
        sessionId,
        threshold: HADD_DAMJ,
      });

      await this.#amil.summarizeSession(sessionId);
      state.akhirDamjFi = now;
      state.adadQablaDamj = counts.total;
      state.ublighaAnDamjAqim = false;
    }
  }

  async hakama(jalsa: JalsatMurshid): Promise<Hukm | null> {
    const state = this.wajadaAwKhalaqaHala(jalsa.id);
    const athar = this.#amil.athar(jalsa.id);
    const now = Date.now();
    if (athar.length === state.adadAtharHukm || now - state.akhirHukmFi < HADD_HUKM_MS) return null;
    state.akhirHukmFi = now;
    state.adadAtharHukm = athar.length;
    if (athar.length < AQALL_ATHAR) return null;

    const wasfa = await this.#wasfat?.iqra(jalsa.huwiyya);
    const qadi = await this.#amil.khalaqaJalsa("iksir-raqib", `Raqīb ${jalsa.huwiyya}`);
    if (!qadi) return null;
    try {
      const jawab = await this.#amil.sendPrompt(qadi.id, "Rule on this trail.", {
        agent: "iksir-raqib",
        adawat: [],
        harara: 0,
        badhra: 7,
        timeoutMs: 90_000,
        kalimat: {
          huwiyya: jalsa.huwiyya,
          unwan: wasfa?.unwan ?? jalsa.unwan,
          matn: wasfa?.matn ?? "",
          athar: athar.join("\n"),
        },
      });
      if (!jawab.success || !jawab.response) {
        await logger.haDHHir("raqib", `No verdict on ${jalsa.huwiyya}`, { error: jawab.error });
        return null;
      }
      const hukm = JSON.parse(nazzifJson(jawab.response)) as Hukm;
      await this.#naffidhHukm(jalsa, hukm, state);
      return hukm;
    } catch (khata) {
      await logger.haDHHir("raqib", `The verdict on ${jalsa.huwiyya} could not be read`, { error: String(khata) });
      return null;
    } finally {
      await this.#amil.mahaqaJalsa(qadi.id);
    }
  }

  async #naffidhHukm(jalsa: JalsatMurshid, hukm: Hukm, state: HalatSihhJalsa): Promise<void> {
    const sabab = hukm.sabab ?? "";
    switch (hukm.hukm) {
      case "yataqaddam":
        state.adadYadur = 0;
        await logger.tatbeeq("raqib", `${jalsa.huwiyya} progresses`, { sabab });
        return;
      case "yadur":
      case "yahid": {
        state.adadYadur = hukm.hukm === "yadur" ? state.adadYadur + 1 : 0;
        await logger.haDHHir("raqib", `${jalsa.huwiyya} ${hukm.hukm}: ${sabab}`);
        if (hukm.kalima) await this.#sessionManager.arsalaIlaMurshidById(jalsa.huwiyya, `Al-Raqīb watches: ${hukm.kalima}`);
        if (state.adadYadur >= 2) {
          await this.#messenger.arsalaMunassaq({ murshid: jalsa.huwiyya }, `Al-Raqīb: ${jalsa.huwiyya} is going in circles — ${sabab}`);
        }
        return;
      }
      case "yastaghith":
        await logger.haDHHir("raqib", `${jalsa.huwiyya} yastaghith: ${sabab}`);
        await this.#messenger.arsalaMunassaq({ murshid: jalsa.huwiyya }, `Al-Raqīb: ${jalsa.huwiyya} needs you — ${sabab}`);
        await this.#messenger.arsalaMunassaq("dispatch", `${jalsa.huwiyya} needs al-Kimyawī — ${sabab}`);
        return;
      default:
        await logger.haDHHir("raqib", `${jalsa.huwiyya}: a verdict I do not know`, { hukm });
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
        akhirHukmFi: 0,
        adadAtharHukm: -1,
        adadYadur: 0,
      };
      this.#sihhJalasat.set(sessionId, state);
    }
    return state;
  }
}

export function istadaaRaqib(deps: RaqibDeps): Raqib {
  return new Raqib(deps);
}
