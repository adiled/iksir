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
  far: string;
  huwiyya: string;
  najah: boolean;
  fil: "merged" | "up-to-date" | "conflicts" | "error";
  taarudat?: string[];
  iltizamatKhalfa?: number;
  nass: string;
}

/**
 * Callbacks for keepalive events.
 * These feed information to the owning murshid session.
 */
interface IstijabatHayat {
  /**
   * PR was merged - murshid can now disclose next dependent slice
   */
  indaDamjRisala: (
    session: JalsatMurshid,
    pr: RisalaMutaba
  ) => Promise<void>;

  /**
   * PR was closed without merge
   */
  indaIghlaqRisala: (
    session: JalsatMurshid,
    pr: RisalaMutaba
  ) => Promise<void>;

  /**
   * Al-Kimyawi left a command on a PR - execute immediately
   */
  indaAmrAlKimyawi: (
    session: JalsatMurshid,
    raqamRisala: number,
    comment: TaaliqMuraja
  ) => Promise<void>;

  /**
   * Other reviewers left comments - queue for muraja'at al-Kimyawi
   */
  indaTaaliqatJadida: (
    session: JalsatMurshid,
    raqamRisala: number,
    comments: TaaliqMuraja[]
  ) => Promise<void>;

  /**
   * PR has merge conflicts
   */
  indaTaarudRisala: (
    session: JalsatMurshid,
    pr: RisalaMutaba
  ) => Promise<void>;

  /**
   * PR CI checks failed
   */
  indaFashalFahs: (
    session: JalsatMurshid,
    pr: RisalaMutaba
  ) => Promise<void>;

  /**
   * Request maintenance mode - daemon should ensure no murshid is active
   * Returns true if maintenance mode was granted
   */
  utlubWadaSeyana: () => Promise<boolean>;

  /**
   * Release maintenance mode - daemon can resume normal operations
   */
  harrarWadaSeyana: () => Promise<void>;

  /**
   * Maintenance completed - report results to al-Kimyawi
   */
  indaIktimalSeyana: (results: NatijaSeyana[]) => Promise<void>;
}

interface MutatallabatHayat {
  config: TasmimIksir;
  sessionManager: MudirJalasat;
  github: GitHubClient;
}

export class DawratHayat {
  tasmim: TasmimIksir;
  mudirJalasat: MudirJalasat;
  #github: GitHubClient;
  istijabat: IstijabatHayat;
  tarikhAkhirSeyana: string | null = null;
  seyanaJariya = false;
  ublighaAnTaarud: Set<number> = new Set();
  ublighaAnFashal: Set<number> = new Set();

  constructor(deps: MutatallabatHayat, callbacks: IstijabatHayat) {
    this.tasmim = deps.config;
    this.mudirJalasat = deps.sessionManager;
    this.#github = deps.github;
    this.istijabat = callbacks;
  }

  /**
   * Run a single keep-alive cycle.
   * Polls all tracked PRs across all murshid sessions.
   */
  async dawra(): Promise<void> {
    const trackedPRs = this.mudirJalasat.getAllRisalaMutabas();

    if (trackedPRs.length === 0) {
      await logger.debug("keepalive", "No PRs to monitor");
      return;
    }

    await logger.debug("keepalive", `Starting cycle: ${trackedPRs.length} PRs to monitor`);

    for (const { session, pr } of trackedPRs) {
      if (pr.status === "merged" || pr.status === "closed") {
        continue;
      }

      await this.raqabRisala(session, pr);
    }

    if (this.fiSaatHudu()) {
      await this.naffadhSeyana();
    }

    await logger.debug("keepalive", "Cycle complete");
  }

  /**
   * Poll a single PR for status changes and comments
   */
  async raqabRisala(session: JalsatMurshid, trackedPR: RisalaMutaba): Promise<void> {
    const raqamRisala = trackedPR.raqamRisala;
    const now = new Date();

    /**
     * Rate limit: don't poll same PR more than configured interval
     * Use persisted lastPolledAt from RisalaMutaba (survives daemon restarts)
     */
    const lastPoll = trackedPR.lastPolledAt ? new Date(trackedPR.lastPolledAt) : null;
    if (lastPoll && now.getTime() - lastPoll.getTime() < this.tasmim.polling.prPollIntervalMs) {
      return;
    }

    try {
      const pr = await this.#github.getPR(raqamRisala);
      if (!pr) {
        await logger.warn("keepalive", `PR #${raqamRisala} not found`);
        return;
      }

      await this.fahasTaghayyurHala(session, trackedPR, pr.state);

      if (pr.mergeable === "CONFLICTING" && trackedPR.status !== "merged") {
        if (!this.ublighaAnTaarud.has(raqamRisala)) {
          await logger.warn("keepalive", `PR #${raqamRisala} has conflicts`);
          await this.istijabat.indaTaarudRisala(session, trackedPR);
          this.ublighaAnTaarud.add(raqamRisala);
        }
      } else {
        this.ublighaAnTaarud.delete(raqamRisala);
      }

      if (trackedPR.status === "draft") {
        const checksPassing = await this.#github.arePRChecksPassing(raqamRisala);
        if (!checksPassing) {
          if (!this.ublighaAnFashal.has(raqamRisala)) {
            await logger.warn("keepalive", `PR #${raqamRisala} CI failing`);
            await this.istijabat.indaFashalFahs(session, trackedPR);
            this.ublighaAnFashal.add(raqamRisala);
          }
        } else {
          this.ublighaAnFashal.delete(raqamRisala);
        }
      }

      /**
       * Check for new comments (since last poll or PR creation)
       * Uses persisted lastPolledAt to prevent re-fetching all comments on daemon restart
       */
      const commentsSince = lastPoll ?? new Date(trackedPR.createdAt);
      const newComments = await this.#github.getNewComments(raqamRisala, commentsSince);
      if (newComments.length > 0) {
        await this.aalajTaaliqatJadida(session, raqamRisala, newComments);
      }

      await this.mudirJalasat.updatePRLastPolled(raqamRisala);
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
  async fahasTaghayyurHala(
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
      const result = await this.mudirJalasat.updatePRStatus(raqamRisala, newStatus);

      if (newStatus === "merged" && result) {
        await this.istijabat.indaDamjRisala(result.session, trackedPR);
      } else if (newStatus === "closed" && result) {
        await this.istijabat.indaIghlaqRisala(result.session, trackedPR);
      }
    }
  }

  /**
   * Process new PR comments - mayyiz and route
   */
  async aalajTaaliqatJadida(
    session: JalsatMurshid,
    raqamRisala: number,
    comments: TaaliqMuraja[]
  ): Promise<void> {
    const ismKimyawi = this.tasmim.github.ismKimyawi;
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
      await this.istijabat.indaAmrAlKimyawi(session, raqamRisala, cmd);
    }

    if (taaliqatUkhra.length > 0) {
      await logger.info("keepalive", `${taaliqatUkhra.length} new comments on PR #${raqamRisala}`, {
        authors: [...new Set(taaliqatUkhra.map((c) => c.author))],
      });
      await this.istijabat.indaTaaliqatJadida(session, raqamRisala, taaliqatUkhra);
    }
  }


  /**
   * Check if currently in quiet hours (delegates to shared time utils)
   */
  fiSaatHudu(): boolean {
    if (!this.tasmim.quietHours.enabled) return false;
    const { timezone, start, end } = this.tasmim.quietHours;
    return fiNitaqAlWaqt(timezone, start, end);
  }

  /**
   * Check if we're in the maintenance window (last N minutes of quiet hours).
   */
  fiAkhirSaatHudu(): boolean {
    if (!this.fiSaatHudu()) return false;
    const { timezone, end, maintenanceWindowMinutes } = this.tasmim.quietHours;
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
  async naffadhSeyana(): Promise<void> {
    if (!this.fiAkhirSaatHudu()) {
      return;
    }

    /** Only run once per day (using configured timezone, not UTC) */
    const today = todayInTz(this.tasmim.quietHours.timezone);
    if (this.tarikhAkhirSeyana === today) {
      return;
    }

    if (this.seyanaJariya) {
      return;
    }

    await logger.info("keepalive", "Starting overnight maintenance");
    this.seyanaJariya = true;

    /** Request maintenance mode (no active murshid) */
    const granted = await this.istijabat.utlubWadaSeyana();
    if (!granted) {
      await logger.warn("keepalive", "Maintenance mode denied - murshid active");
      this.seyanaJariya = false;
      return;
    }

    this.mudirJalasat.setGitFence(true);

    try {
      const results: NatijaSeyana[] = [];
      const sessions = this.mudirJalasat.wajadaJalasatMurshid();

      /** Save current branch to istarjaa later */
      const originalBranch = await git.farAlHali();

      await git.fetch();

      for (const session of sessions) {
        const result = await this.sayanFar(session);
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

      await this.istijabat.indaIktimalSeyana(results);

      this.tarikhAkhirSeyana = today;
      await logger.info("keepalive", "Overnight maintenance complete", {
        branches: results.length,
        merged: results.filter(r => r.fil === "merged").length,
        conflicts: results.filter(r => r.fil === "conflicts").length,
      });
    } catch (error) {
      await logger.error("keepalive", "Maintenance failed", { error: String(error) });
    } finally {
      this.mudirJalasat.setGitFence(false);
      await this.istijabat.harrarWadaSeyana();
      this.seyanaJariya = false;
    }
  }

  /**
   * Maintain a single epic branch - merge main into it
   */
  async sayanFar(session: JalsatMurshid): Promise<NatijaSeyana> {
    const far = session.branch;
    const huwiyya = session.identifier;

    await logger.info("keepalive", `Maintaining branch ${far}`);

    try {
      /** Checkout the branch */
      const checkedOut = await git.intaqalaIla(far);
      if (!checkedOut) {
        return {
          far,
          huwiyya,
          najah: false,
          fil: "error",
          nass: `Failed to intaqalaIla ${far}`,
        };
      }

      /** Check how far behind we are */
      const behind = await git.commitsBehindMain(far);
      if (behind === 0) {
        return {
          far,
          huwiyya,
          najah: true,
          fil: "up-to-date",
          iltizamatKhalfa: 0,
          nass: "Already up to date with main",
        };
      }

      /** Attempt merge */
      const mergeResult = await git.mergeMain();

      if (mergeResult.success) {
        await git.push(far);

        return {
          far,
          huwiyya,
          najah: true,
          fil: "merged",
          iltizamatKhalfa: behind,
          nass: `Merged ${behind} commit(s) from main`,
        };
      }

      return {
        far,
        huwiyya,
        najah: false,
        fil: "conflicts",
        taarudat: mergeResult.conflicts,
        iltizamatKhalfa: behind,
        nass: mergeResult.message,
      };
    } catch (error) {
      return {
        far,
        huwiyya,
        najah: false,
        fil: "error",
        nass: String(error),
      };
    }
  }
}

/**
 * Create a keep-alive loop instance
 */
export function awqadaHayat(
  deps: MutatallabatHayat,
  callbacks: IstijabatHayat
): DawratHayat {
  return new DawratHayat(deps, callbacks);
}
