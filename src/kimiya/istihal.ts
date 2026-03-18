/**
 * Istiḥāla (استحالة) - Transmutation
 *
 * The core alchemical process: transforming raw materials in the buwtaqa
 * into refined jawhar (essence). Extracts specific ahjar from the buwtaqa
 * branch and arranges them on a clean branch for fasl (decanting/review).
 *
 * Uses the stink-world git tools underneath, but this layer speaks kimiya.
 */

import { logger } from "../logging/logger.ts";
import { exec, farAlHali, farAlAsasi } from "../git/operations.ts";

export interface NatijaIstihal {
  najah: boolean;
  khata?: string;
  nawKhata?: "conflicts" | "checkout_failed" | "restore_failed" | "push_failed" | "merge_failed";
  taarudat?: string[];
  /** The buwtaqa branch we extracted from */
  buwtaqa?: string;
  /** The jawhar branch that was created */
  jawhar?: string;
  /** The base branch (codex or parent jawhar) */
  asas?: string;
  /** Number of ahjar transmuted */
  adadAhjar?: number;
  makhrujat?: string;
}

/**
 * Istihal: Extract ahjar from the buwtaqa and transmute them onto a jawhar branch.
 *
 * Steps:
 * 1. Record current buwtaqa branch
 * 2. Fetch and merge codex into buwtaqa (surfaces conflicts early)
 * 3. Create/reset jawhar branch at base HEAD
 * 4. Checkout jawhar branch
 * 5. Restore specified ahjar from buwtaqa
 * 6. Stage, commit, force push
 * 7. Return to buwtaqa
 *
 * @param jawharBranch - The branch to create for the jawhar
 * @param ahjar - Files to extract from the buwtaqa
 * @param asasBranch - Optional parent branch for layered istihal
 */
export async function istihal(
  jawharBranch: string,
  ahjar: string[],
  asasBranch?: string,
): Promise<NatijaIstihal> {
  const codex = await farAlAsasi();

  const buwtaqa = await farAlHali();
  if (!buwtaqa) {
    return {
      najah: false,
      khata: "Could not determine current branch",
      nawKhata: "checkout_failed",
    };
  }

  const rajaaIlaButwaqa = async () => {
    await exec(["checkout", buwtaqa]);
  };

  try {
    /** Fetch and merge codex into buwtaqa */
    const fetchResult = await exec(["fetch", "origin", `${codex}:${codex}`]);
    if (!fetchResult.success) {
      return {
        najah: false,
        khata: `Failed to fetch ${codex}: ${fetchResult.stderr}`,
        nawKhata: "merge_failed",
        buwtaqa,
      };
    }

    const mergeResult = await exec(["merge", codex, "--no-gpg-sign", "--no-edit"]);
    if (!mergeResult.success) {
      const mergeOutput = mergeResult.stdout + mergeResult.stderr;

      if (mergeOutput.includes("CONFLICT")) {
        const conflictResult = await exec(["diff", "--name-only", "--diff-filter=U"]);
        const conflicts = conflictResult.success
          ? conflictResult.stdout.trim().split("\n").filter(f => f)
          : [];

        await exec(["merge", "--abort"]);

        return {
          najah: false,
          khata: `Merge conflicts with ${codex}`,
          nawKhata: "conflicts",
          taarudat: conflicts,
          buwtaqa,
          makhrujat: mergeOutput,
        };
      }

      return {
        najah: false,
        khata: `Failed to merge ${codex}: ${mergeOutput}`,
        nawKhata: "merge_failed",
        buwtaqa,
        makhrujat: mergeOutput,
      };
    }

    if (asasBranch) {
      const fetchBase = await exec(["fetch", "origin", asasBranch]);
      if (!fetchBase.success) {
        return {
          najah: false,
          khata: `Failed to fetch asas branch ${asasBranch}: ${fetchBase.stderr}`,
          nawKhata: "merge_failed",
          buwtaqa,
        };
      }
    }

    /** Create/reset jawhar branch at base HEAD */
    const baseRef = asasBranch ? `origin/${asasBranch}` : codex;
    const branchResult = await exec(["branch", "-f", jawharBranch, baseRef]);
    if (!branchResult.success) {
      return {
        najah: false,
        khata: `Failed to create branch ${jawharBranch}: ${branchResult.stderr}`,
        nawKhata: "checkout_failed",
        buwtaqa,
      };
    }

    /** Checkout jawhar branch */
    const checkoutResult = await exec(["checkout", jawharBranch]);
    if (!checkoutResult.success) {
      return {
        najah: false,
        khata: `Checkout failed for ${jawharBranch}. Commit or stash changes on buwtaqa first. ${checkoutResult.stderr}`,
        nawKhata: "checkout_failed",
        buwtaqa,
      };
    }

    /** Restore specified ahjar from buwtaqa */
    const restoreResult = await exec(["restore", `--source=${buwtaqa}`, "--", ...ahjar]);
    if (!restoreResult.success) {
      await rajaaIlaButwaqa();
      return {
        najah: false,
        khata: `Failed to restore ahjar from ${buwtaqa}: ${restoreResult.stderr}`,
        nawKhata: "restore_failed",
        buwtaqa,
        jawhar: jawharBranch,
      };
    }

    /** Stage and commit */
    const addResult = await exec(["add", "."]);
    if (!addResult.success) {
      await rajaaIlaButwaqa();
      return {
        najah: false,
        khata: `Failed to stage ahjar: ${addResult.stderr}`,
        nawKhata: "restore_failed",
        buwtaqa,
        jawhar: jawharBranch,
      };
    }

    const commitResult = await exec(["commit", "--allow-empty-message", "-a", "-m", "", "--no-gpg-sign"]);
    if (!commitResult.success) {
      await rajaaIlaButwaqa();
      return {
        najah: false,
        khata: `Failed to commit: ${commitResult.stderr}`,
        nawKhata: "restore_failed",
        buwtaqa,
        jawhar: jawharBranch,
      };
    }

    /** Force push jawhar */
    const pushResult = await exec(["push", "--force", "-u", "origin", jawharBranch]);
    if (!pushResult.success) {
      await rajaaIlaButwaqa();
      return {
        najah: false,
        khata: `Failed to push ${jawharBranch}: ${pushResult.stderr}`,
        nawKhata: "push_failed",
        buwtaqa,
        jawhar: jawharBranch,
      };
    }

    await rajaaIlaButwaqa();

    await logger.info("kimiya", `Istihal complete: ${jawharBranch}`, {
      buwtaqa,
      adadAhjar: ahjar.length,
    });

    return {
      najah: true,
      buwtaqa,
      jawhar: jawharBranch,
      asas: asasBranch ?? codex,
      adadAhjar: ahjar.length,
    };
  } catch (error) {
    await rajaaIlaButwaqa();
    return {
      najah: false,
      khata: `Unexpected error: ${error}`,
      nawKhata: "checkout_failed",
      buwtaqa,
    };
  }
}
