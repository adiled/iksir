/**
 * Git Operations
 *
 * Local git operations for the graceful snatch protocol.
 * Iksir owns all git operations - murshids should NOT call these directly.
 */

import { logger } from "../logging/logger.ts";
import { execCommand, type ExecResult } from "../utils/exec.ts";

function masarAlMakhzan(): string {
  return Deno.env.get("IKSIR_REPO_PATH") ?? ".";
}

/** Cached default branch name (detected once per process) */
let _defaultBranch: string | null = null;

/**
 * Execute a git command in the repo directory
 */
export function exec(args: string[]): Promise<ExecResult> {
  return execCommand("git", args, { cwd: masarAlMakhzan() });
}

/**
 * Check if working directory is dirty
 */
export async function huwaWasikh(): Promise<boolean> {
  const result = await exec(["status", "--porcelain"]);
  if (!result.success) {
    await logger.error("git", "Failed to check status", { stderr: result.stderr });
    return false;
  }
  return result.stdout.trim().length > 0;
}

/**
 * Get current branch name
 */
export async function farAlHali(): Promise<string | null> {
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
export async function khalaqaIltizamMuaqqat(identifier: string): Promise<boolean> {
  /** Stage all changes */
  const addResult = await exec(["add", "-A"]);
  if (!addResult.success) {
    await logger.error("git", "Failed to stage changes", { stderr: addResult.stderr });
    return false;
  }

  /** Create commit */
  const commitResult = await exec(["commit", "-m", `[WIP] ${identifier}`]);
  if (!commitResult.success) {
    if (commitResult.stdout.includes("nothing to commit")) {
      return false;
    }
    await logger.error("git", "Failed to create WIP commit", { stderr: commitResult.stderr });
    return false;
  }

  await logger.akhbar("git", `Created WIP commit for ${identifier}`);
  return true;
}

/**
 * Checkout a branch
 * Creates the branch if it doesn't exist
 */
export async function intaqalaIla(branch: string): Promise<boolean> {
  /** Try to intaqalaIla existing branch */
  let result = await exec(["checkout", branch]);
  
  if (!result.success) {
    if (result.stderr.includes("did not match any file") || 
        result.stderr.includes("pathspec") ||
        result.stderr.includes("not a valid")) {
      result = await exec(["checkout", "-b", branch]);
      
      if (result.success) {
        await logger.akhbar("git", `Created and checked out new branch: ${branch}`);
        return true;
      }
    }
    
    await logger.error("git", `Failed to intaqalaIla ${branch}`, { stderr: result.stderr });
    return false;
  }

  await logger.akhbar("git", `Checked out branch: ${branch}`);
  return true;
}

/**
 * Pull latest changes from origin
 * Returns true if successful (even if no changes)
 */
export async function pull(branch: string): Promise<boolean> {
  const result = await exec(["pull", "origin", branch, "--ff-only"]);
  
  if (!result.success) {
    if (result.stderr.includes("Couldn't find remote ref")) {
      await logger.akhbar("git", `Branch ${branch} not on remote yet, skipping pull`);
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

  await logger.akhbar("git", `Pushed branch: ${branch}`);
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

  /** Parse commit hash from output */
  const hashMatch = result.stdout.match(/\[[\w/-]+ ([a-f0-9]+)\]/);
  const hash = hashMatch ? hashMatch[1] : undefined;

  await logger.akhbar("git", `Created commit ${hash ?? "unknown"}: ${message.slice(0, 60)}`);
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
  const defaultBranch = await farAlAsasi();
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
  const defaultBranch = await farAlAsasi();

  /** First try the merge */
  const mergeResult = await exec(["merge", `origin/${defaultBranch}`, "--no-edit"]);
  
  if (mergeResult.success) {
    return {
      success: true,
      conflicts: [],
      merged: true,
      message: `Merged origin/${defaultBranch} successfully`,
    };
  }
  
  if (mergeResult.stderr.includes("CONFLICT") || mergeResult.stdout.includes("CONFLICT")) {
    /** Get list of conflicted files */
    const statusResult = await exec(["diff", "--name-only", "--diff-filter=U"]);
    const conflicts = statusResult.success 
      ? statusResult.stdout.trim().split("\n").filter(f => f)
      : [];
    
    await exec(["merge", "--abort"]);
    
    return {
      success: false,
      conflicts,
      merged: false,
      message: `Merge conflicts in ${conflicts.length} file(s)`,
    };
  }
  
  return {
    success: false,
    conflicts: [],
    merged: false,
    message: mergeResult.stderr || "Unknown merge error",
  };
}


/**
 * Get the default branch name (master or main).
 * Detected from origin/HEAD. Cached for the process lifetime.
 */
export async function farAlAsasi(): Promise<string> {
  if (_defaultBranch) return _defaultBranch;

  /** Try origin/HEAD (set by git clone) */
  const result = await exec(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"]);
  if (result.success) {
    /** Returns "origin/master" or "origin/main" */
    const branch = result.stdout.trim().replace("origin/", "");
    if (branch) {
      _defaultBranch = branch;
      return branch;
    }
  }

  /** Fallback: check if origin/master exists */
  const masterCheck = await exec(["rev-parse", "--verify", "origin/master"]);
  if (masterCheck.success) {
    _defaultBranch = "master";
    return "master";
  }

  _defaultBranch = "main";
  return "main";
}


