/**
 * Hayat (حياة) — The Life Force
 *
 * One of the sacred Khuddām (خدّام) of the alchemical workshop.
 *
 * While others sleep, Hayat breathes. The slow pulse of the workshop —
 * watching over risālāt as they wait for judgement, listening for the
 * murmur of new taaliqat, sensing when a risala has been merged into
 * the codex or abandoned by its author.
 *
 * In the quiet hours, when al-Kimyawi rests, Hayat performs the
 * sacred rites of seyana — merging the river of main into each
 * murshid's forge branch, rebuilding the code-intel index, ensuring
 * the workshop is clean and ready for the dawn.
 *
 * Hayat does not think. Hayat does not decide. Hayat watches,
 * breathes, and keeps the flame from going cold.
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
 * NatijaSeyana — what became of a single branch after the night rites
 */
export interface NatijaSeyana {
  far: string;
  huwiyya: string;
  najah: boolean;
  fil: "udmija" | "muhaddath" | "taarudat" | "khata";
  taarudat?: string[];
  iltizamatKhalfa?: number;
  nass: string;
}

/**
 * IstijabatHayat — the signals Hayat sends when it witnesses change.
 * The daemon receives these and acts.
 */
interface IstijabatHayat {
  /** A risala was merged into the codex */
  indaDamjRisala: (
    session: JalsatMurshid,
    pr: RisalaMutaba
  ) => Promise<void>;

  /** A risala was abandoned — closed without merge */
  indaIghlaqRisala: (
    session: JalsatMurshid,
    pr: RisalaMutaba
  ) => Promise<void>;

  /** Al-Kimyawi has spoken on a risala — a command to obey */
  indaAmrAlKimyawi: (
    session: JalsatMurshid,
    raqamRisala: number,
    comment: TaaliqMuraja
  ) => Promise<void>;

  /** Others have spoken on a risala — for al-Kimyawi's consideration */
  indaTaaliqatJadida: (
    session: JalsatMurshid,
    raqamRisala: number,
    comments: TaaliqMuraja[]
  ) => Promise<void>;

  /** A risala has taarudat — conflicting inscriptions */
  indaTaarudRisala: (
    session: JalsatMurshid,
    pr: RisalaMutaba
  ) => Promise<void>;

  /** The fahs (tests) have failed on a risala */
  indaFashalFahs: (
    session: JalsatMurshid,
    pr: RisalaMutaba
  ) => Promise<void>;

  /** Request seyana — the workshop must be still */
  utlubWadaSeyana: () => Promise<boolean>;

  /** Release seyana — the workshop may breathe again */
  harrarWadaSeyana: () => Promise<void>;

  /** Seyana is complete — report what was done */
  indaIktimalSeyana: (results: NatijaSeyana[]) => Promise<void>;
}

interface MutatallabatHayat {
  tasmim: TasmimIksir;
  mudirJalasat: MudirJalasat;
  github: GitHubClient;
}

export class DawratHayat {
  #tasmim: TasmimIksir;
  #mudirJalasat: MudirJalasat;
  #github: GitHubClient;
  #istijabat: IstijabatHayat;
  #tarikhAkhirSeyana: string | null = null;
  #seyanaJariya = false;
  #ublighaAnTaarud: Set<number> = new Set();
  #ublighaAnFashal: Set<number> = new Set();

  constructor(deps: MutatallabatHayat, callbacks: IstijabatHayat) {
    this.#tasmim = deps.tasmim;
    this.#mudirJalasat = deps.mudirJalasat;
    this.#github = deps.github;
    this.#istijabat = callbacks;
  }

  /**
   * A single breath. Poll all tracked risālāt,
   * and if the hour is right, perform the night rites.
   */
  async dawra(): Promise<void> {
    const trackedPRs = this.#mudirJalasat.jalabaKullRasaailMutaba();

    if (trackedPRs.length === 0) {
      await logger.tatbeeq("keepalive", "No PRs to monitor");
      return;
    }

    await logger.tatbeeq("keepalive", `Starting cycle: ${trackedPRs.length} PRs to monitor`);

    for (const { session, pr } of trackedPRs) {
      if (pr.hala === "merged" || pr.hala === "closed") {
        continue;
      }

      await this.raqabRisala(session, pr);
    }

    if (this.fiSaatHudu()) {
      await this.naffadhSeyana();
    }

    await logger.tatbeeq("keepalive", "Cycle complete");
  }

  /**
   * Watch a single risala — has it been merged? Closed? Commented upon?
   */
  async raqabRisala(session: JalsatMurshid, trackedPR: RisalaMutaba): Promise<void> {
    const raqamRisala = trackedPR.raqamRisala;
    const now = new Date();

    /**
     * Rate limit: don't poll same PR more than configured interval
     * Use persisted lastPolledAt from RisalaMutaba (survives daemon restarts)
     */
    const lastPoll = trackedPR.akhirRaqabaFi ? new Date(trackedPR.akhirRaqabaFi) : null;
    if (lastPoll && now.getTime() - lastPoll.getTime() < this.#tasmim.istiftaa.fajwatRaqabaRisala) {
      return;
    }

    try {
      const pr = await this.#github.getPR(raqamRisala);
      if (!pr) {
        await logger.haDHHir("keepalive", `PR #${raqamRisala} not found`);
        return;
      }

      await this.fahasTaghayyurHala(session, trackedPR, pr.state);

      if (pr.mergeable === "CONFLICTING" && trackedPR.hala !== "merged") {
        if (!this.#ublighaAnTaarud.has(raqamRisala)) {
          await logger.haDHHir("keepalive", `PR #${raqamRisala} has conflicts`);
          await this.#istijabat.indaTaarudRisala(session, trackedPR);
          this.#ublighaAnTaarud.add(raqamRisala);
        }
      } else {
        this.#ublighaAnTaarud.delete(raqamRisala);
      }

      if (trackedPR.hala === "draft") {
        const checksPassing = await this.#github.arePRChecksPassing(raqamRisala);
        if (!checksPassing) {
          if (!this.#ublighaAnFashal.has(raqamRisala)) {
            await logger.haDHHir("keepalive", `PR #${raqamRisala} CI failing`);
            await this.#istijabat.indaFashalFahs(session, trackedPR);
            this.#ublighaAnFashal.add(raqamRisala);
          }
        } else {
          this.#ublighaAnFashal.delete(raqamRisala);
        }
      }

      /**
       * Check for new comments (since last poll or PR creation)
       * Uses persisted lastPolledAt to prevent re-fetching all comments on daemon restart
       */
      const commentsSince = lastPoll ?? new Date(trackedPR.unshiaFi);
      const newComments = await this.#github.getNewComments(raqamRisala, commentsSince);
      if (newComments.length > 0) {
        await this.aalajTaaliqatJadida(session, raqamRisala, newComments);
      }

      await this.#mudirJalasat.jaddadaAkhirRaqaba(raqamRisala);
    } catch (error) {
      await logger.sajjalKhata("keepalive", `Failed to poll PR #${raqamRisala}`, {
        error: String(error),
        epicId: session.huwiyya,
      });
    }
  }

  /**
   * Has the hala of this risala changed since last we looked?
   */
  async fahasTaghayyurHala(
    session: JalsatMurshid,
    trackedPR: RisalaMutaba,
    githubState: string
  ): Promise<void> {
    const raqamRisala = trackedPR.raqamRisala;
    let newStatus: RisalaMutabaStatus | null = null;

    if (githubState === "MERGED" && trackedPR.hala !== "merged") {
      newStatus = "merged";
      await logger.akhbar("keepalive", `PR #${raqamRisala} merged`, {
        epicId: session.huwiyya,
        huwiyyatWasfa: trackedPR.huwiyyatWasfa,
      });
    } else if (githubState === "CLOSED" && trackedPR.hala !== "closed") {
      newStatus = "closed";
      await logger.akhbar("keepalive", `PR #${raqamRisala} closed`, {
        epicId: session.huwiyya,
        huwiyyatWasfa: trackedPR.huwiyyatWasfa,
      });
    } else if (githubState === "OPEN" && trackedPR.hala === "draft") {
      newStatus = "open";
      await logger.akhbar("keepalive", `PR #${raqamRisala} promoted to open`, {
        epicId: session.huwiyya,
      });
    }

    if (newStatus) {
      /** Update tracking */
      const result = await this.#mudirJalasat.jaddadaHalatRisala(raqamRisala, newStatus);

      if (newStatus === "merged" && result) {
        await this.#istijabat.indaDamjRisala(result.session, trackedPR);
      } else if (newStatus === "closed" && result) {
        await this.#istijabat.indaIghlaqRisala(result.session, trackedPR);
      }
    }
  }

  /**
   * New taaliqat on a risala — separate al-Kimyawi's commands from others' words
   */
  async aalajTaaliqatJadida(
    session: JalsatMurshid,
    raqamRisala: number,
    comments: TaaliqMuraja[]
  ): Promise<void> {
    const ismKimyawi = this.#tasmim.github.ismKimyawi;
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
      await logger.akhbar("keepalive", `amr al-Kimyawi on PR #${raqamRisala}`, {
        body: cmd.body.slice(0, 100),
      });
      await this.#istijabat.indaAmrAlKimyawi(session, raqamRisala, cmd);
    }

    if (taaliqatUkhra.length > 0) {
      await logger.akhbar("keepalive", `${taaliqatUkhra.length} new comments on PR #${raqamRisala}`, {
        authors: [...new Set(taaliqatUkhra.map((c) => c.author))],
      });
      await this.#istijabat.indaTaaliqatJadida(session, raqamRisala, taaliqatUkhra);
    }
  }


  /** Are we in the saat al-sukun — the quiet hours? */
  fiSaatHudu(): boolean {
    if (!this.#tasmim.saatSukun.mufattah) return false;
    const { mintaqaZamaniyya, bidaya, nihaya } = this.#tasmim.saatSukun;
    return fiNitaqAlWaqt(mintaqaZamaniyya, bidaya, nihaya);
  }

  /** Are we in the final watch — the seyana window before dawn? */
  fiAkhirSaatHudu(): boolean {
    if (!this.fiSaatHudu()) return false;
    const { mintaqaZamaniyya, nihaya, daqaiqNafizhaSeyana } = this.#tasmim.saatSukun;
    const remaining = minutesUntil(mintaqaZamaniyya, nihaya);
    return remaining <= daqaiqNafizhaSeyana && remaining > 0;
  }

  /**
   * The night rites — seyana.
   *
   * Merge the river of main into each murshid's forge branch.
   * Rebuild the code-intel index. Report what was found.
   * If taarudat arise, do not resolve them — only report.
   */
  async naffadhSeyana(): Promise<void> {
    if (!this.fiAkhirSaatHudu()) {
      return;
    }

    /** The rites are performed once per dawn */
    const today = todayInTz(this.#tasmim.saatSukun.mintaqaZamaniyya);
    if (this.#tarikhAkhirSeyana === today) {
      return;
    }

    if (this.#seyanaJariya) {
      return;
    }

    await logger.akhbar("keepalive", "Starting overnight maintenance");
    this.#seyanaJariya = true;

    /** Request stillness — no murshid may transmute during seyana */
    const granted = await this.#istijabat.utlubWadaSeyana();
    if (!granted) {
      await logger.haDHHir("keepalive", "Maintenance mode denied - murshid active");
      this.#seyanaJariya = false;
      return;
    }

    this.#mudirJalasat.wadaaQuflGit(true);

    try {
      const results: NatijaSeyana[] = [];
      const sessions = this.#mudirJalasat.wajadaJalasatMurshid();

      /** Remember where we stood */
      const originalBranch = await git.farAlHali();

      await git.fetch();

      for (const session of sessions) {
        const result = await this.sayanFar(session);
        results.push(result);
      }

      if (originalBranch) {
        const istarjaad = await git.intaqalaIla(originalBranch);
        if (!istarjaad) {
          await logger.sajjalKhata("keepalive", `Failed to istarjaa branch ${originalBranch}, falling back to main`);
          await git.intaqalaIla("main");
        }
      }

      try {
        const repoPath = Deno.env.get("IKSIR_REPO_PATH") ?? ".";
        await buildIndex(repoPath);
      } catch (error) {
        await logger.haDHHir("keepalive", "Code-intel index build failed", { error: String(error) });
      }

      await this.#istijabat.indaIktimalSeyana(results);

      this.#tarikhAkhirSeyana = today;
      await logger.akhbar("keepalive", "Overnight maintenance complete", {
        branches: results.length,
        merged: results.filter(r => r.fil === "udmija").length,
        conflicts: results.filter(r => r.fil === "taarudat").length,
      });
    } catch (error) {
      await logger.sajjalKhata("keepalive", "Maintenance failed", { error: String(error) });
    } finally {
      this.#mudirJalasat.wadaaQuflGit(false);
      await this.#istijabat.harrarWadaSeyana();
      this.#seyanaJariya = false;
    }
  }

  /** Seyana of a single far — merge main into it */
  async sayanFar(session: JalsatMurshid): Promise<NatijaSeyana> {
    const far = session.far;
    const huwiyya = session.huwiyya;

    await logger.akhbar("keepalive", `Maintaining branch ${far}`);

    try {
      /** Enter the far */
      const checkedOut = await git.intaqalaIla(far);
      if (!checkedOut) {
        return {
          far,
          huwiyya,
          najah: false,
          fil: "khata",
          nass: `Failed to intaqalaIla ${far}`,
        };
      }

      /** How far has the river of main flowed past this far? */
      const behind = await git.commitsBehindMain(far);
      if (behind === 0) {
        return {
          far,
          huwiyya,
          najah: true,
          fil: "muhaddath",
          iltizamatKhalfa: 0,
          nass: "Already up to date with main",
        };
      }

      /** Attempt the merging of waters */
      const mergeResult = await git.mergeMain();

      if (mergeResult.success) {
        await git.push(far);

        return {
          far,
          huwiyya,
          najah: true,
          fil: "udmija",
          iltizamatKhalfa: behind,
          nass: `Merged ${behind} commit(s) from main`,
        };
      }

      return {
        far,
        huwiyya,
        najah: false,
        fil: "taarudat",
        taarudat: mergeResult.conflicts,
        iltizamatKhalfa: behind,
        nass: mergeResult.message,
      };
    } catch (error) {
      return {
        far,
        huwiyya,
        najah: false,
        fil: "khata",
        nass: String(error),
      };
    }
  }
}

/** Summon Hayat — breathe life into the workshop */
export function awqadaHayat(
  deps: MutatallabatHayat,
  callbacks: IstijabatHayat
): DawratHayat {
  return new DawratHayat(deps, callbacks);
}
