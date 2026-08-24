/**
 * Mutabi Baid (متابع بعيد) — The Distant Tracker
 *
 * The tracker as seen from the entry, once its key has moved out of reach.
 * Every read and write crosses the thrum to the wasfa organ and comes back
 * as JSON; Arraf and Munaffidh call the same methods they always did and
 * never learn that anything moved.
 *
 * Two methods do not cross. parseUrl and getUrlPattern are pure — pattern
 * matching over a string, no credential, no network. Sending those over a
 * socket would be ceremony, so they stay here, and the provider's own
 * shapes are inlined rather than imported from a client this bee no longer
 * constructs.
 *
 * A failed nida returns empty rather than throwing. The organ may be
 * unkindled, and an entry that cannot read a wasfa should divine poorly,
 * not die.
 */

import { logger } from "../logging/logger.ts";
import type { AmilHum } from "./client.ts";
import type {
  MaalimMutabi,
  MashruMutabi,
  MudkhalKhalqQadiya,
  MudkhalTahdithQadiya,
  MurashihatQadiya,
  MutabiWasfa,
  RabitWasfaMuhallal,
  WasfaMutaba,
} from "../types.ts";

/** A bare wasfa identifier sitting alone in a path segment. */
const NAMAT_HUWIYYA = /^[A-Z]+-\d+$/;

export class MutabiWasfaBaid implements MutabiWasfa {
  readonly provider: string;
  #amil: AmilHum;
  #namatWasfa: RegExp;

  constructor(amil: AmilHum, muqaddim = "linear", namatWasfa?: string) {
    this.#amil = amil;
    this.provider = muqaddim;
    this.#namatWasfa = new RegExp(namatWasfa ?? "[A-Z]+-\\d+");
  }

  /** Call the organ and parse its natija, or null if the strand failed us. */
  async #nadi<T>(name: string, args: Record<string, unknown> = {}): Promise<T | null> {
    const radd = await this.#amil.nadi(name, args);
    if (!radd.najah || radd.natija === undefined) {
      await logger.haDHHir("mutabi", `nida ${name} failed`, { khata: radd.khata });
      return null;
    }
    try {
      return JSON.parse(radd.natija) as T;
    } catch {
      await logger.haDHHir("mutabi", `nida ${name} returned unreadable natija`);
      return null;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const hala = await this.#nadi<{ muwaththaq: boolean }>("wasfa_hala");
    return hala?.muwaththaq ?? false;
  }

  getIssue(identifier: string): Promise<WasfaMutaba | null> {
    return this.#nadi<WasfaMutaba>("wasfa_iqra", { huwiyya: identifier });
  }

  getProject(id: string): Promise<MashruMutabi | null> {
    return this.#nadi<MashruMutabi>("wasfa_mashru", { huwiyya: id });
  }

  async searchIssues(query: string, limit?: number): Promise<WasfaMutaba[]> {
    return await this.#nadi<WasfaMutaba[]>("wasfa_bahath", { istifsar: query, hadd: limit }) ?? [];
  }

  async searchProjects(query: string): Promise<MashruMutabi[]> {
    return await this.#nadi<MashruMutabi[]>("wasfa_bahath_mashru", { istifsar: query }) ?? [];
  }

  async searchMilestones(query: string): Promise<MaalimMutabi[]> {
    return await this.#nadi<MaalimMutabi[]>("wasfa_bahath_maalim", { istifsar: query }) ?? [];
  }

  getActiveMilestone(): Promise<MaalimMutabi | null> {
    return this.#nadi<MaalimMutabi>("wasfa_maalim_faail");
  }

  async getFilteredIssues(filters: MurashihatQadiya, limit?: number): Promise<WasfaMutaba[]> {
    return await this.#nadi<WasfaMutaba[]>("wasfa_murashaha", {
      murashihat: filters,
      hadd: limit,
    }) ?? [];
  }

  getStateId(name: string): Promise<string | null> {
    return this.#nadi<string>("wasfa_hala_huwiyya", { ism: name });
  }

  /**
   * Writes throw where reads return empty. A read that fails degrades
   * divination; a write that fails and stays quiet would let a murshid
   * believe it had inscribed something it had not.
   */
  async createIssue(input: MudkhalKhalqQadiya): Promise<WasfaMutaba> {
    const wasfa = await this.#nadi<WasfaMutaba>("wasfa_khalaq", { mudkhal: input });
    if (!wasfa) throw new Error("wasfa organ did not answer wasfa_khalaq");
    return wasfa;
  }

  async updateIssue(id: string, input: MudkhalTahdithQadiya): Promise<WasfaMutaba> {
    const wasfa = await this.#nadi<WasfaMutaba>("wasfa_jaddid", { huwiyya: id, mudkhal: input });
    if (!wasfa) throw new Error("wasfa organ did not answer wasfa_jaddid");
    return wasfa;
  }

  async setRelations(identifier: string, blocks?: string[], blockedBy?: string[]): Promise<void> {
    const tamma = await this.#nadi<{ tamma: boolean }>("wasfa_alaqat", {
      huwiyya: identifier,
      yamnaa: blocks,
      mamnu: blockedBy,
    });
    if (!tamma?.tamma) throw new Error("wasfa organ did not answer wasfa_alaqat");
  }

  /** Ported from the provider client verbatim — no credential, no network. */
  parseUrl(url: string): RabitWasfaMuhallal | null {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.includes("linear.app")) return null;

      const ajzaa = parsed.pathname.split("/").filter(Boolean);

      /** /issue/TEAM-123 or /TEAM/issue/TEAM-123 */
      const mawdiWasfa = ajzaa.indexOf("issue");
      if (mawdiWasfa !== -1 && ajzaa[mawdiWasfa + 1]) {
        return { naw: "wasfa", id: ajzaa[mawdiWasfa + 1] };
      }

      /** /project/uuid */
      const mawdiMashru = ajzaa.indexOf("project");
      if (mawdiMashru !== -1 && ajzaa[mawdiMashru + 1]) {
        return { naw: "mashru", id: ajzaa[mawdiMashru + 1] };
      }

      /** A bare /TEAM-123 */
      const huwiyya = ajzaa.find((j) => NAMAT_HUWIYYA.test(j));
      if (huwiyya) return { naw: "wasfa", id: huwiyya };

      return { naw: "majhul", id: ajzaa.join("/") };
    } catch {
      return null;
    }
  }

  getUrlPattern(): RegExp {
    return this.#namatWasfa;
  }
}
