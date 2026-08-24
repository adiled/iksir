/**
 * Faṣl GitHub — a forge, made to comply
 *
 * A pull request is a contrivance wearing a sacred word. GitHub keeps them
 * by number, calls their states OPEN and MERGED, and asks about drafts.
 *
 *   jawhar → head branch      qaddama → open a pull request
 *   huwiyya → its number      thabit  → do the checks pass
 *
 * Nothing above this file knows any of that.
 */

import type { GitHubClient } from "../../src/github/gh.ts";
import type {
  FarqFasl,
  Fasl,
  HalatFasl,
  MaalumatFasl,
  TaaliqFasl,
} from "../../src/hayula/fasl.ts";

/** GitHub's words for what became of a pull request. */
const HALAT: Record<string, HalatFasl> = {
  OPEN: "manzur",
  MERGED: "maqbul",
  CLOSED: "mardud",
};

export class FaslGitHub implements Fasl {
  readonly naw = "github";
  #gh: GitHubClient;

  constructor(gh: GitHubClient) {
    this.#gh = gh;
  }

  async qaddama(input: {
    unwan: string;
    matn: string;
    jawhar: string;
    asas: string;
    musawwada?: boolean;
  }): Promise<MaalumatFasl | null> {
    const natija = await this.#gh.createPR({
      title: input.unwan,
      body: input.matn,
      head: input.jawhar,
      base: input.asas,
      draft: input.musawwada ?? true,
    });
    if (!natija) return null;
    return {
      huwiyya: String(natija.number),
      unwan: input.unwan,
      hala: "manzur",
      yastaqirr: true,
      rabit: natija.url,
    };
  }

  async hala(huwiyya: string): Promise<MaalumatFasl | null> {
    const pr = await this.#gh.getPR(Number(huwiyya));
    if (!pr) return null;
    return {
      huwiyya,
      unwan: pr.title,
      hala: HALAT[pr.state] ?? "majhul",
      /** GitHub says CONFLICTING when the matter will not settle. */
      yastaqirr: pr.mergeable !== "CONFLICTING",
      rabit: pr.url,
    };
  }

  async taaliqat(huwiyya: string, mundhu?: string): Promise<TaaliqFasl[]> {
    const raqam = Number(huwiyya);
    const mundhuWaqt = mundhu ? new Date(mundhu) : new Date(0);
    const taaliqat = await this.#gh.getNewComments(raqam, mundhuWaqt);
    return taaliqat.map((t) => ({
      huwiyya: t.id,
      qail: t.author,
      nass: t.body,
      qila_fi: t.createdAt.toISOString(),
      mawdi: t.path ? `${t.path}${t.line ? `:${t.line}` : ""}` : undefined,
    }));
  }

  thabit(huwiyya: string): Promise<boolean> {
    return this.#gh.arePRChecksPassing(Number(huwiyya));
  }

  async farq(asas: string, ina: string): Promise<FarqFasl | null> {
    const muqarana = await this.#gh.compareBranches(asas, ina);
    if (!muqarana) return null;
    return {
      amam: muqarana.ahead,
      khalf: muqarana.behind,
      ahjar: muqarana.files.length,
    };
  }
}

export function anshaaFaslGitHub(gh: GitHubClient): FaslGitHub {
  return new FaslGitHub(gh);
}
