/**
 * Alchemical transmutation utilities
 * 
 * Core transmutation technique for extracting essence from the crucible.
 * This is how Munadi transmutes raw materials into pure essences.
 */

import { logger } from "../logging/logger.ts";
import { exec, getCurrentBranch, getDefaultBranch } from "./operations.ts";

export interface TransmutationResult {
  success: boolean;
  /** What went wrong (if !success) */
  error?: string;
  /** Error category for handling */
  errorType?: "conflicts" | "checkout_failed" | "restore_failed" | "push_failed" | "merge_failed";
  /** Conflicted file paths (if errorType === "conflicts") */
  conflicts?: string[];
  /** The source branch we plucked from */
  crucibleBranch?: string;
  /** The artifact branch that was created */
  essenceBranch?: string;
  /** The base branch (default branch or parent artifact branch) */
  baseBranch?: string;
  /** Number of files plucked */
  materialsTransmuted?: number;
  /** stdout/stderr for debugging */
  output?: string;
}

/**
 * Pluck files from current branch into a new artifact branch.
 * 
 * This is the core crafting technique - extract specific files from the crucible
 * and place them on a clean branch for review.
 * 
 * Steps:
 * 1. Record current (crucible) branch
 * 2. Fetch and merge default branch into crucible (surfaces conflicts early)
 * 3. Create/reset artifact branch at base HEAD
 * 4. Checkout artifact branch
 * 5. Restore only specified files from crucible
 * 6. Stage, commit, force push
 * 7. Return to crucible
 * 
 * @param essenceBranch - The branch to create for the artifact
 * @param files - Files to pluck from the crucible
 * @param baseBranch - Optional parent branch for stacked artifacts
 */
export async function transmute(
  essenceBranch: string,
  files: string[],
  baseBranch?: string,
): Promise<TransmutationResult> {
  const defaultBranch = await getDefaultBranch();
  
  // Step 1: Record crucible
  const crucibleBranch = await getCurrentBranch();
  if (!crucibleBranch) {
    return { 
      success: false, 
      error: "Could not determine current branch", 
      errorType: "checkout_failed" 
    };
  }

  // Safety: helper to always return to crucible
  const returnToForge = async () => {
    await exec(["checkout", crucibleBranch]);
  };

  try {
    // Step 2: Fetch and merge default branch into crucible (surfaces conflicts)
    const fetchResult = await exec(["fetch", "origin", `${defaultBranch}:${defaultBranch}`]);
    if (!fetchResult.success) {
      return {
        success: false,
        error: `Failed to fetch ${defaultBranch}: ${fetchResult.stderr}`,
        errorType: "merge_failed",
        crucibleBranch: crucibleBranch,
      };
    }

    const mergeResult = await exec(["merge", defaultBranch, "--no-gpg-sign", "--no-edit"]);
    if (!mergeResult.success) {
      const mergeOutput = mergeResult.stdout + mergeResult.stderr;

      if (mergeOutput.includes("CONFLICT")) {
        // Get conflicted files
        const conflictResult = await exec(["diff", "--name-only", "--diff-filter=U"]);
        const conflicts = conflictResult.success
          ? conflictResult.stdout.trim().split("\n").filter(f => f)
          : [];

        // Abort the merge so working directory is clean
        await exec(["merge", "--abort"]);

        return {
          success: false,
          error: `Merge conflicts with ${defaultBranch}`,
          errorType: "conflicts",
          conflicts,
          crucibleBranch: crucibleBranch,
          output: mergeOutput,
        };
      }

      return {
        success: false,
        error: `Failed to merge ${defaultBranch}: ${mergeOutput}`,
        errorType: "merge_failed",
        crucibleBranch: crucibleBranch,
        output: mergeOutput,
      };
    }

    // Step 2b: If stacked (baseBranch provided), fetch the parent artifact branch
    if (baseBranch) {
      const fetchBase = await exec(["fetch", "origin", baseBranch]);
      if (!fetchBase.success) {
        return {
          success: false,
          error: `Failed to fetch base branch ${baseBranch}: ${fetchBase.stderr}`,
          errorType: "merge_failed",
          crucibleBranch: crucibleBranch,
        };
      }
    }

    // Step 3: Create/reset artifact branch at base HEAD
    const baseRef = baseBranch ? `origin/${baseBranch}` : defaultBranch;
    const branchResult = await exec(["branch", "-f", essenceBranch, baseRef]);
    if (!branchResult.success) {
      return {
        success: false,
        error: `Failed to create branch ${essenceBranch}: ${branchResult.stderr}`,
        errorType: "checkout_failed",
        crucibleBranch: crucibleBranch,
      };
    }

    // Step 4: Checkout artifact branch
    const checkoutResult = await exec(["checkout", essenceBranch]);
    if (!checkoutResult.success) {
      return {
        success: false,
        error: `Checkout failed for ${essenceBranch}. Commit or stash changes on crucible first. ${checkoutResult.stderr}`,
        errorType: "checkout_failed",
        crucibleBranch: crucibleBranch,
      };
    }

    // Step 5: Restore specified files from crucible
    const restoreResult = await exec(["restore", `--source=${crucibleBranch}`, "--", ...files]);
    if (!restoreResult.success) {
      await returnToForge();
      return {
        success: false,
        error: `Failed to restore files from ${crucibleBranch}: ${restoreResult.stderr}`,
        errorType: "restore_failed",
        crucibleBranch: crucibleBranch,
        essenceBranch,
      };
    }

    // Step 6: Stage and commit
    const addResult = await exec(["add", "."]);
    if (!addResult.success) {
      await returnToForge();
      return {
        success: false,
        error: `Failed to stage files: ${addResult.stderr}`,
        errorType: "restore_failed",
        crucibleBranch: crucibleBranch,
        essenceBranch,
      };
    }

    const commitResult = await exec(["commit", "--allow-empty-message", "-a", "-m", "", "--no-gpg-sign"]);
    if (!commitResult.success) {
      await returnToForge();
      return {
        success: false,
        error: `Failed to commit: ${commitResult.stderr}`,
        errorType: "restore_failed",
        crucibleBranch: crucibleBranch,
        essenceBranch,
      };
    }

    // Step 7: Force push
    const pushResult = await exec(["push", "--force", "-u", "origin", essenceBranch]);
    if (!pushResult.success) {
      await returnToForge();
      return {
        success: false,
        error: `Failed to push ${essenceBranch}: ${pushResult.stderr}`,
        errorType: "push_failed",
        crucibleBranch: crucibleBranch,
        essenceBranch,
      };
    }

    // Step 8: Return to crucible
    await returnToForge();

    await logger.info("git", `Files plucked successfully: ${essenceBranch}`, {
      crucibleBranch: crucibleBranch,
      files: files.length,
    });

    return {
      success: true,
      crucibleBranch: crucibleBranch,
      essenceBranch,
      baseBranch: baseBranch ?? defaultBranch,
      materialsTransmuted: files.length,
    };
  } catch (error) {
    // Always try to return to crucible on unexpected errors
    await returnToForge();
    return {
      success: false,
      error: `Unexpected error: ${error}`,
      errorType: "checkout_failed",
      crucibleBranch: crucibleBranch,
    };
  }
}