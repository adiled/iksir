/**
 * Git Operations
 *
 * Local git operations for the graceful snatch protocol.
 * Dispatcher owns all git operations - orchestrators should NOT call these directly.
 */

import { logger } from "../logging/logger.ts";
import { execCommand, type ExecResult } from "../utils/exec.ts";

function getRepoPath(): string {
  return Deno.env.get("MUNADI_REPO_PATH") ?? ".";
}

/** Cached default branch name (detected once per process) */
let _defaultBranch: string | null = null;

/**
 * Execute a git command in the repo directory
 */
export function exec(args: string[]): Promise<ExecResult> {
  return execCommand("git", args, { cwd: getRepoPath() });
}

/**
 * Check if working directory is dirty
 */
export async function isDirty(): Promise<boolean> {
  const result = await exec(["status", "--porcelain"]);
  if (!result.success) {
    await logger.error("git", "Failed to check status", { stderr: result.stderr });
    return false; // Assume clean on error (safer than WIP commit on mystery state)
  }
  return result.stdout.trim().length > 0;
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(): Promise<string | null> {
  const result = await exec(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!result.success) {
    await logger.error("git", "Failed to get current branch", { stderr: result.stderr });
    return null;
  }
  return result.stdout.trim();
}

/**
 * Create a WIP commit with all changes
 * Returns true if commit was created, false if nothing to commit or error
 */
export async function createWipCommit(identifier: string): Promise<boolean> {
  // Stage all changes
  const addResult = await exec(["add", "-A"]);
  if (!addResult.success) {
    await logger.error("git", "Failed to stage changes", { stderr: addResult.stderr });
    return false;
  }

  // Create commit
  const commitResult = await exec(["commit", "-m", `[WIP] ${identifier}`]);
  if (!commitResult.success) {
    // "nothing to commit" is not an error
    if (commitResult.stdout.includes("nothing to commit")) {
      return false;
    }
    await logger.error("git", "Failed to create WIP commit", { stderr: commitResult.stderr });
    return false;
  }

  await logger.info("git", `Created WIP commit for ${identifier}`);
  return true;
}

/**
 * Checkout a branch
 * Creates the branch if it doesn't exist
 */
export async function checkout(branch: string): Promise<boolean> {
  // Try to checkout existing branch
  let result = await exec(["checkout", branch]);
  
  if (!result.success) {
    // Branch might not exist, try to create it
    if (result.stderr.includes("did not match any file") || 
        result.stderr.includes("pathspec") ||
        result.stderr.includes("not a valid")) {
      // Create branch from current HEAD
      result = await exec(["checkout", "-b", branch]);
      
      if (result.success) {
        await logger.info("git", `Created and checked out new branch: ${branch}`);
        return true;
      }
    }
    
    await logger.error("git", `Failed to checkout ${branch}`, { stderr: result.stderr });
    return false;
  }

  await logger.info("git", `Checked out branch: ${branch}`);
  return true;
}

/**
 * Pull latest changes from origin
 * Returns true if successful (even if no changes)
 */
export async function pull(branch: string): Promise<boolean> {
  const result = await exec(["pull", "origin", branch, "--ff-only"]);
  
  if (!result.success) {
    // "Already up to date" is not an error
    // "Couldn't find remote ref" means branch doesn't exist on remote yet (OK)
    if (result.stderr.includes("Couldn't find remote ref")) {
      await logger.info("git", `Branch ${branch} not on remote yet, skipping pull`);
      return true;
    }
    await logger.error("git", `Failed to pull ${branch}`, { stderr: result.stderr });
    return false;
  }

  return true;
}

/**
 * Push branch to origin
 */
export async function push(branch: string, setUpstream = false): Promise<boolean> {
  const args = ["push"];
  if (setUpstream) {
    args.push("-u");
  }
  args.push("origin", branch);

  const result = await exec(args);
  
  if (!result.success) {
    await logger.error("git", `Failed to push ${branch}`, { stderr: result.stderr });
    return false;
  }

  await logger.info("git", `Pushed branch: ${branch}`);
  return true;
}

/**
 * Stage files for commit
 */
export async function gitAdd(files: string[]): Promise<{ success: boolean; error?: string }> {
  const result = await exec(["add", ...files]);
  if (!result.success) {
    await logger.error("git", "Failed to stage files", { stderr: result.stderr, files });
    return { success: false, error: result.stderr };
  }
  return { success: true };
}

/**
 * Create a commit with the given message.
 * Optionally stages specific files first.
 */
export async function commit(
  message: string,
  files?: string[],
): Promise<{ success: boolean; hash?: string; error?: string }> {
  // Stage files if provided
  if (files && files.length > 0) {
    const addResult = await gitAdd(files);
    if (!addResult.success) {
      return { success: false, error: `Failed to stage files: ${addResult.error}` };
    }
  }

  const result = await exec(["commit", "-m", message]);
  if (!result.success) {
    if (result.stdout.includes("nothing to commit")) {
      return { success: false, error: "nothing to commit" };
    }
    await logger.error("git", "Failed to create commit", { stderr: result.stderr });
    return { success: false, error: result.stderr };
  }

  // Parse commit hash from output
  const hashMatch = result.stdout.match(/\[[\w/-]+ ([a-f0-9]+)\]/);
  const hash = hashMatch ? hashMatch[1] : undefined;

  await logger.info("git", `Created commit ${hash ?? "unknown"}: ${message.slice(0, 60)}`);
  return { success: true, hash };
}

/**
 * Fetch from origin
 */
export async function fetch(remote = "origin"): Promise<boolean> {
  const result = await exec(["fetch", remote]);
  if (!result.success) {
    await logger.error("git", `Failed to fetch ${remote}`, { stderr: result.stderr });
    return false;
  }
  return true;
}

/**
 * Check if branch is behind origin's default branch
 * Returns number of commits behind, or -1 on error
 */
export async function commitsBehindMain(branch: string): Promise<number> {
  const defaultBranch = await getDefaultBranch();
  const result = await exec(["rev-list", "--count", `${branch}..origin/${defaultBranch}`]);
  if (!result.success) {
    await logger.error("git", `Failed to check commits behind for ${branch}`, { stderr: result.stderr });
    return -1;
  }
  return parseInt(result.stdout.trim(), 10);
}

interface MergeResult {
  success: boolean;
  conflicts: string[];
  merged: boolean;
  message: string;
}

/**
 * Attempt to merge origin's default branch into current branch
 * Returns conflict information if merge fails
 */
export async function mergeMain(): Promise<MergeResult> {
  const defaultBranch = await getDefaultBranch();

  // First try the merge
  const mergeResult = await exec(["merge", `origin/${defaultBranch}`, "--no-edit"]);
  
  if (mergeResult.success) {
    return {
      success: true,
      conflicts: [],
      merged: true,
      message: `Merged origin/${defaultBranch} successfully`,
    };
  }
  
  // Check if it's a conflict
  if (mergeResult.stderr.includes("CONFLICT") || mergeResult.stdout.includes("CONFLICT")) {
    // Get list of conflicted files
    const statusResult = await exec(["diff", "--name-only", "--diff-filter=U"]);
    const conflicts = statusResult.success 
      ? statusResult.stdout.trim().split("\n").filter(f => f)
      : [];
    
    // Abort the merge
    await exec(["merge", "--abort"]);
    
    return {
      success: false,
      conflicts,
      merged: false,
      message: `Merge conflicts in ${conflicts.length} file(s)`,
    };
  }
  
  // Some other error
  return {
    success: false,
    conflicts: [],
    merged: false,
    message: mergeResult.stderr || "Unknown merge error",
  };
}

// =============================================================================
// Default Branch Detection
// =============================================================================

/**
 * Get the default branch name (master or main).
 * Detected from origin/HEAD. Cached for the process lifetime.
 */
export async function getDefaultBranch(): Promise<string> {
  if (_defaultBranch) return _defaultBranch;

  // Try origin/HEAD (set by git clone)
  const result = await exec(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"]);
  if (result.success) {
    // Returns "origin/master" or "origin/main"
    const branch = result.stdout.trim().replace("origin/", "");
    if (branch) {
      _defaultBranch = branch;
      return branch;
    }
  }

  // Fallback: check if origin/master exists
  const masterCheck = await exec(["rev-parse", "--verify", "origin/master"]);
  if (masterCheck.success) {
    _defaultBranch = "master";
    return "master";
  }

  // Last resort
  _defaultBranch = "main";
  return "main";
}

// =============================================================================
// DEPRECATED: SSP - Use pluckFiles from craft.ts instead
// =============================================================================

interface SspResult {
  success: boolean;
  /** What went wrong (if !success) */
  error?: string;
  /** "conflicts" | "checkout_failed" | "restore_failed" | "push_failed" | "merge_failed" */
  errorType?: string;
  /** Conflicted file paths (if errorType === "conflicts") */
  conflicts?: string[];
  /** The epic branch we were on */
  epicBranch?: string;
  /** The PR branch that was created */
  prBranch?: string;
  /** The base branch (default branch or parent PR branch) */
  baseBranch?: string;
  /** Number of files sliced */
  filesSliced?: number;
  /** stdout/stderr for debugging */
  output?: string;
}

/**
 * DEPRECATED: Use pluckFiles from craft.ts instead
 * 
 * Kept for backwards compatibility during transition.
 * This function will be removed once all references are updated.
 */
export async function ssp(
  prBranch: string,
  files: string[],
  baseBranch?: string,
): Promise<SspResult> {
  const defaultBranch = await getDefaultBranch();

  // Step 1: Record epic branch
  const epicBranch = (await getCurrentBranch());
  if (!epicBranch) {
    return { success: false, error: "Could not determine current branch", errorType: "checkout_failed" };
  }

  // Safety: helper to always return to epic branch
  const returnToEpic = async () => {
    await exec(["checkout", epicBranch]);
  };

  try {
    // Step 2: Fetch and merge default branch into epic (always — surfaces conflicts)
    const fetchResult = await exec(["fetch", "origin", `${defaultBranch}:${defaultBranch}`]);
    if (!fetchResult.success) {
      return {
        success: false,
        error: `Failed to fetch ${defaultBranch}: ${fetchResult.stderr}`,
        errorType: "merge_failed",
        epicBranch,
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
          epicBranch,
          output: mergeOutput,
        };
      }

      return {
        success: false,
        error: `Failed to merge ${defaultBranch}: ${mergeOutput}`,
        errorType: "merge_failed",
        epicBranch,
        output: mergeOutput,
      };
    }

    // Step 2b: If stacked (baseBranch provided), fetch the parent PR branch
    if (baseBranch) {
      const fetchBase = await exec(["fetch", "origin", baseBranch]);
      if (!fetchBase.success) {
        return {
          success: false,
          error: `Failed to fetch base branch ${baseBranch}: ${fetchBase.stderr}`,
          errorType: "merge_failed",
          epicBranch,
        };
      }
    }

    // Step 3: Create/reset PR branch at base HEAD
    const baseRef = baseBranch ? `origin/${baseBranch}` : defaultBranch;
    const branchResult = await exec(["branch", "-f", prBranch, baseRef]);
    if (!branchResult.success) {
      return {
        success: false,
        error: `Failed to create branch ${prBranch}: ${branchResult.stderr}`,
        errorType: "checkout_failed",
        epicBranch,
      };
    }

    // Step 4: Checkout PR branch
    const checkoutResult = await exec(["checkout", prBranch]);
    if (!checkoutResult.success) {
      return {
        success: false,
        error: `Checkout failed for ${prBranch}. Commit or stash changes on epic first. ${checkoutResult.stderr}`,
        errorType: "checkout_failed",
        epicBranch,
      };
    }

    // Step 5: Restore specified files from epic branch
    const restoreResult = await exec(["restore", `--source=${epicBranch}`, "--", ...files]);
    if (!restoreResult.success) {
      await returnToEpic();
      return {
        success: false,
        error: `Failed to restore files from ${epicBranch}: ${restoreResult.stderr}`,
        errorType: "restore_failed",
        epicBranch,
        prBranch,
      };
    }

    // Step 6: Stage and commit
    const addResult = await exec(["add", "."]);
    if (!addResult.success) {
      await returnToEpic();
      return {
        success: false,
        error: `Failed to stage files: ${addResult.stderr}`,
        errorType: "restore_failed",
        epicBranch,
        prBranch,
      };
    }

    const commitResult = await exec(["commit", "--allow-empty-message", "-a", "-m", "", "--no-gpg-sign"]);
    if (!commitResult.success) {
      await returnToEpic();
      return {
        success: false,
        error: `Failed to commit: ${commitResult.stderr}`,
        errorType: "restore_failed",
        epicBranch,
        prBranch,
      };
    }

    // Step 7: Force push
    const pushResult = await exec(["push", "--force", "-u", "origin", prBranch]);
    if (!pushResult.success) {
      await returnToEpic();
      return {
        success: false,
        error: `Failed to push ${prBranch}: ${pushResult.stderr}`,
        errorType: "push_failed",
        epicBranch,
        prBranch,
      };
    }

    // Step 8: Return to epic branch
    await returnToEpic();

    await logger.info("git", `SSP complete: ${prBranch}`, {
      epicBranch,
      files: files.length,
    });

    return {
      success: true,
      epicBranch,
      prBranch,
      baseBranch: baseBranch ?? defaultBranch,
      filesSliced: files.length,
    };
  } catch (error) {
    // Always try to return to epic branch on unexpected errors
    await returnToEpic();
    return {
      success: false,
      error: `Unexpected error: ${String(error)}`,
      errorType: "merge_failed",
      epicBranch,
    };
  }
}
