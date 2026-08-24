/**
 * Hayūlā Git — git, made to comply
 *
 * git is a contrivance of the natn: content-addressed, remote-bound, full
 * of words Iksīr has no use for. It happens to be an excellent hayūlā
 * anyway — it has vessels, it holds molten work, it has a codex that
 * drifts, and it can be inscribed. So it is admitted, on Iksīr's terms.
 *
 * The translation, once, here:
 *
 *   ināʾ  → branch          asās → default branch
 *   jammada → WIP commit     thabbata → commit
 *   sahaba  → fetch + merge  masafa → commits behind
 *   azhara  → push
 *
 * Nothing above this file knows any of those words.
 */

import * as git from "../../src/git/operations.ts";
import { istihal } from "./istihal.ts";
import type { Hayula, NatijaIstihala, NatijaSahb } from "../../src/hayula/hayula.ts";

/**
 * git names its failures after its own verbs. Iksīr names them after what
 * went wrong with the matter, so the translation happens here and the words
 * "checkout" and "push" never travel upward.
 */
const NAW_KHATA: Record<string, NatijaIstihala["nawKhata"]> = {
  conflicts: "taarud",
  checkout_failed: "dukhul",
  restore_failed: "istirjaa",
  push_failed: "izhar",
  merge_failed: "damj",
};

export class HayulaGit implements Hayula {
  readonly naw = "git";

  dakhala(ina: string, _asas?: string): Promise<boolean> {
    return git.intaqalaIla(ina);
  }

  waqif(): Promise<string | null> {
    return git.farAlHali();
  }

  asas(): Promise<string> {
    return git.farAlAsasi();
  }

  mudtarib(): Promise<boolean> {
    return git.huwaWasikh();
  }

  jammada(sabab: string): Promise<boolean> {
    return git.khalaqaIltizamMuaqqat(sabab);
  }

  async thabbata(sabab: string, mawad?: string[]): Promise<boolean> {
    const mudaf = await git.gitAdd(mawad ?? ["-A"]);
    if (!mudaf.success) return false;
    const natija = await git.commit(sabab);
    return natija.success;
  }

  /**
   * Draw the codex in beneath a vessel.
   *
   * Two motions in git's world — fetch, then merge — but one act here:
   * the vessel either stands on current ground afterwards or it does not.
   * Conflicts come back as matter needing al-Kimyawi rather than as an
   * error, because they are not a failure of the drawing-in. They are the
   * drawing-in telling us something true.
   */
  async sahaba(ina?: string): Promise<NatijaSahb> {
    if (!await git.fetch()) {
      return { najah: false, khata: "could not reach the codex" };
    }
    if (ina && !await git.intaqalaIla(ina)) {
      return { najah: false, khata: `could not enter ${ina}` };
    }
    const damj = await git.mergeMain();
    if (damj.success) return { najah: true };
    return {
      najah: false,
      taarudat: damj.conflicts,
      khata: damj.message,
    };
  }

  masafa(ina: string): Promise<number> {
    return git.commitsBehindMain(ina);
  }

  azhara(ina: string, awwalMarra = false): Promise<boolean> {
    return git.push(ina, awwalMarra);
  }

  /**
   * git's way: leave the crucible standing, force a vessel onto clean
   * foundation, restore only the named matter into it, fix it, and show it.
   * Fourteen invocations of a content-addressed store, none of which Iksīr
   * has any business knowing about.
   */
  async istahala(jawhar: string, ahjar: string[], asas?: string): Promise<NatijaIstihala> {
    const natija = await istihal(jawhar, ahjar, asas);
    return { ...natija, nawKhata: NAW_KHATA[natija.nawKhata ?? ""] };
  }
}

export function anshaaHayulaGit(): HayulaGit {
  return new HayulaGit();
}
