/**
 * GitHub CLI (gh) Wrapper
 *
 * Thin wrapper around the gh CLI for GitHub operations.
 * Uses gh for authentication, pagination, and rate limiting.
 */

import { logger } from "../logging/logger.ts";
import { execCommand, type ExecResult } from "../utils/exec.ts";
import type { TasmimIksir, TaaliqMuraja, TaqyimTaaliq } from "../types.ts";

interface GhPullRequest {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  url: string;
  headRefName: string;
  baseRefName: string;
  author: { login: string };
  createdAt: string;
  updatedAt: string;
  mergeable: string;
  reviewDecision: string | null;
}

interface GhPRComment {
  id: number;
  body: string;
  author: { login: string };
  createdAt: string;
  path?: string;
  line?: number;
  diffHunk?: string;
}

interface GhCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string;
}

export class GitHubClient {
  private owner: string;
  private repo: string;
  private ismKimyawi: string;

  constructor(config: TasmimIksir) {
    this.owner = config.github.sahib;
    this.repo = config.github.makhzan;
    this.ismKimyawi = config.github.ismKimyawi;
  }

  /**
   * Execute a gh command and return parsed JSON
   */
  private exec(args: string[]): Promise<ExecResult> {
    return execCommand("gh", args);
  }

  /**
   * Execute gh command and parse JSON response
   */
  private async execJson<T>(args: string[]): Promise<T | null> {
    const result = await this.exec(args);

    if (!result.success) {
      await logger.error("github", `gh command failed: ${args.join(" ")}`, {
        stderr: result.stderr,
        code: result.code,
      });
      return null;
    }

    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      await logger.error("github", "Failed to parse gh JSON output", {
        stdout: result.stdout,
      });
      return null;
    }
  }

  /**
   * Check if gh is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const result = await this.exec(["auth", "status"]);
    return result.success;
  }

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<string | null> {
    const result = await this.exec(["auth", "status", "--show-token"]);
    if (!result.success) return null;

    /** Parse "Logged in to github.com account USERNAME" */
    const match = result.stderr.match(/account\s+(\S+)/);
    return match?.[1] ?? null;
  }


  /**
   * Create a draft pull request
   */
  async createPR(options: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  }): Promise<{ number: number; url: string } | null> {
    const args = [
      "pr", "create",
      "--repo", `${this.owner}/${this.repo}`,
      "--title", options.title,
      "--body", options.body,
      "--head", options.head,
      "--base", options.base,
    ];

    if (options.draft !== false) {
      args.push("--draft");
    }

    const result = await this.exec(args);

    if (!result.success) {
      await logger.error("github", `gh pr create failed`, {
        stderr: result.stderr,
        code: result.code,
      });
      return null;
    }

    /**
     * gh pr create prints the URL to stdout on success
     * Format: https://github.com/owner/repo/pull/123
     */
    const url = result.stdout.trim();
    const raqamRisalaMatch = url.match(/\/pull\/(\d+)$/);

    if (!raqamRisalaMatch) {
      await logger.error("github", `Failed to parse PR URL from gh output`, {
        stdout: result.stdout,
      });
      return null;
    }

    const number = parseInt(raqamRisalaMatch[1], 10);

    await logger.akhbar("github", `Created PR #${number}`, { url });

    return { number, url };
  }

  /**
   * Get pull request details
   */
  async getPR(raqamRisala: number): Promise<GhPullRequest | null> {
    return this.execJson<GhPullRequest>([
      "pr", "view", String(raqamRisala),
      "--repo", `${this.owner}/${this.repo}`,
      "--json", "number,title,body,state,isDraft,url,headRefName,baseRefName,author,createdAt,updatedAt,mergeable,reviewDecision",
    ]);
  }

  /**
   * List PRs with optional filters
   */
  async listPRs(options?: {
    state?: "open" | "closed" | "merged" | "all";
    head?: string;
    base?: string;
    limit?: number;
  }): Promise<GhPullRequest[]> {
    const args = [
      "pr", "list",
      "--repo", `${this.owner}/${this.repo}`,
      "--json", "number,title,body,state,isDraft,url,headRefName,baseRefName,author,createdAt,updatedAt,mergeable,reviewDecision",
    ];

    if (options?.state) args.push("--state", options.state);
    if (options?.head) args.push("--head", options.head);
    if (options?.base) args.push("--base", options.base);
    if (options?.limit) args.push("--limit", String(options.limit));

    return (await this.execJson<GhPullRequest[]>(args)) ?? [];
  }

  /**
   * Update PR (title, body, base branch)
   */
  async updatePR(raqamRisala: number, options: {
    title?: string;
    body?: string;
    base?: string;
  }): Promise<boolean> {
    const args = [
      "pr", "edit", String(raqamRisala),
      "--repo", `${this.owner}/${this.repo}`,
    ];

    if (options.title) args.push("--title", options.title);
    if (options.body) args.push("--body", options.body);
    if (options.base) args.push("--base", options.base);

    const result = await this.exec(args);
    return result.success;
  }

  /**
   * Mark PR as ready for review (remove draft status)
   */
  async markReadyForReview(raqamRisala: number): Promise<boolean> {
    const result = await this.exec([
      "pr", "ready", String(raqamRisala),
      "--repo", `${this.owner}/${this.repo}`,
    ]);
    return result.success;
  }

  /**
   * Close a PR
   */
  async closePR(raqamRisala: number): Promise<boolean> {
    const result = await this.exec([
      "pr", "close", String(raqamRisala),
      "--repo", `${this.owner}/${this.repo}`,
    ]);
    return result.success;
  }


  /**
   * Get PR comments (both review comments and issue comments)
   */
  async getPRComments(raqamRisala: number): Promise<GhPRComment[]> {
    /** Get review comments via API */
    const reviewComments = await this.execJson<GhPRComment[]>([
      "api",
      `repos/${this.owner}/${this.repo}/pulls/${raqamRisala}/comments`,
      "--jq", "[.[] | {id: .id, body: .body, author: {login: .user.login}, createdAt: .created_at, path: .path, line: .line, diffHunk: .diff_hunk}]",
    ]) ?? [];

    /** Get issue comments */
    const issueComments = await this.execJson<GhPRComment[]>([
      "api",
      `repos/${this.owner}/${this.repo}/issues/${raqamRisala}/comments`,
      "--jq", "[.[] | {id: .id, body: .body, author: {login: .user.login}, createdAt: .created_at}]",
    ]) ?? [];

    return [...reviewComments, ...issueComments];
  }

  /**
   * Get new comments since a timestamp
   */
  async getNewComments(raqamRisala: number, since: Date): Promise<TaaliqMuraja[]> {
    const allComments = await this.getPRComments(raqamRisala);

    return allComments
      .filter((c) => new Date(c.createdAt) > since)
      .map((c) => this.toTaaliqMuraja(raqamRisala, c));
  }

  /**
   * Convert gh comment to TaaliqMuraja type
   */
  private toTaaliqMuraja(raqamRisala: number, comment: GhPRComment): TaaliqMuraja {
    const huwaKimyawi = comment.author.login === this.ismKimyawi;

    return {
      id: String(comment.id),
      raqamRisala,
      author: comment.author.login,
      body: comment.body,
      path: comment.path,
      line: comment.line,
      createdAt: new Date(comment.createdAt),
      isAlKimyawi: huwaKimyawi,
      assessment: this.assessComment(comment.body, huwaKimyawi),
    };
  }

  /**
   * Basic comment assessment (can be enhanced with LLM later)
   */
  private assessComment(body: string, huwaKimyawi: boolean): TaqyimTaaliq {
    const lowerBody = body.toLowerCase().trim();

    /**
     * Check for command patterns — applies to ALL comments including al-Kimyawi's.
     * Al-Kimyawi leaves PR commands that murshids must execute.
     * The `huwaKimyawi` flag on TaaliqMuraja tells consumers WHO wrote it;
     * the assessment tells them WHAT was written.
     */
    const commandPatterns = [
      /^(fix|update|change|remove|add|refactor|revert)\s/i,
      /^please\s+(fix|update|change|remove|add)/i,
      /\bshould\s+be\b/i,
      /\bmust\s+(be|have|include)\b/i,
    ];

    const isCommand = commandPatterns.some((p) => p.test(lowerBody));
    if (isCommand) {
      return {
        isCommand: true,
        intent: "command",
        confidence: huwaKimyawi ? 1.0 : 0.7,
        reasoning: huwaKimyawi
          ? "Al-Kimyawi command on PR — execute immediately"
          : "Detected imperative language pattern",
      };
    }

    if (huwaKimyawi) {
      return {
        isCommand: false,
        intent: "neutral",
        confidence: 1,
        reasoning: "Non-command comment from al-Kimyawi",
      };
    }

    if (body.includes("?")) {
      return {
        isCommand: false,
        intent: "question",
        confidence: 0.8,
        reasoning: "Contains question mark",
      };
    }

    /** Check for praise */
    const praisePatterns = [/\b(lgtm|looks good|nice|great|awesome|perfect)\b/i];
    if (praisePatterns.some((p) => p.test(lowerBody))) {
      return {
        isCommand: false,
        intent: "praise",
        confidence: 0.8,
        reasoning: "Contains positive language",
      };
    }

    /** Check for concern */
    const concernPatterns = [
      /\b(concern|worried|issue|problem|bug|wrong|incorrect)\b/i,
      /\bwhat\s+if\b/i,
    ];
    if (concernPatterns.some((p) => p.test(lowerBody))) {
      return {
        isCommand: false,
        intent: "concern",
        confidence: 0.6,
        reasoning: "Contains concern language",
      };
    }

    /** Check for suggestion */
    const suggestionPatterns = [
      /\b(consider|maybe|could|might|suggest|what\s+about)\b/i,
      /\bhow\s+about\b/i,
    ];
    if (suggestionPatterns.some((p) => p.test(lowerBody))) {
      return {
        isCommand: false,
        intent: "suggestion",
        confidence: 0.6,
        reasoning: "Contains suggestion language",
      };
    }

    return {
      isCommand: false,
      intent: "neutral",
      confidence: 0.5,
      reasoning: "No specific intent detected",
    };
  }

  /**
   * Add a comment to a PR
   */
  async addComment(raqamRisala: number, body: string): Promise<boolean> {
    const result = await this.exec([
      "pr", "comment", String(raqamRisala),
      "--repo", `${this.owner}/${this.repo}`,
      "--body", body,
    ]);
    return result.success;
  }


  /**
   * Get PR check runs status
   */
  async getPRChecks(raqamRisala: number): Promise<GhCheckRun[]> {
    const result = await this.execJson<{ checks: GhCheckRun[] }>([
      "pr", "checks", String(raqamRisala),
      "--repo", `${this.owner}/${this.repo}`,
      "--json", "name,status,conclusion,detailsUrl",
    ]);

    return result?.checks ?? [];
  }

  /**
   * Check if all PR checks are passing
   */
  async arePRChecksPassing(raqamRisala: number): Promise<boolean> {
    const checks = await this.getPRChecks(raqamRisala);

    if (checks.length === 0) return true;

    return checks.every(
      (c) => c.status === "completed" && c.conclusion === "success"
    );
  }

  /**
   * Wait for PR checks to complete (with timeout)
   */
  async waitForChecks(
    raqamRisala: number,
    timeoutMs: number = 300000,
    pollIntervalMs: number = 30000
  ): Promise<{ passed: boolean; checks: GhCheckRun[] }> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const checks = await this.getPRChecks(raqamRisala);

      const allCompleted = checks.every((c) => c.status === "completed");
      if (allCompleted) {
        const passed = checks.every((c) => c.conclusion === "success");
        return { passed, checks };
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    const checks = await this.getPRChecks(raqamRisala);
    return { passed: false, checks };
  }


  /**
   * Check if a branch exists
   */
  async branchExists(branch: string): Promise<boolean> {
    const result = await this.exec([
      "api",
      `repos/${this.owner}/${this.repo}/branches/${branch}`,
    ]);
    return result.success;
  }

  /**
   * Get the default branch
   */
  async farAlAsasi(): Promise<string> {
    const result = await this.execJson<{ defaultBranchRef: { name: string } }>([
      "repo", "view",
      "--repo", `${this.owner}/${this.repo}`,
      "--json", "defaultBranchRef",
    ]);

    return result?.defaultBranchRef.name ?? "main";
  }

  /**
   * Compare two branches
   */
  async compareBranches(
    base: string,
    head: string
  ): Promise<{ ahead: number; behind: number; files: string[] } | null> {
    const result = await this.execJson<{
      aheadBy: number;
      behindBy: number;
      files: Array<{ path: string }>;
    }>([
      "api",
      `repos/${this.owner}/${this.repo}/compare/${base}...${head}`,
      "--jq", "{aheadBy: .ahead_by, behindBy: .behind_by, files: [.files[].filename]}",
    ]);

    if (!result) return null;

    return {
      ahead: result.aheadBy,
      behind: result.behindBy,
      files: result.files.map((f) => f.path),
    };
  }
}

/**
 * Create a GitHub client instance
 */
export function createGitHubClient(config: TasmimIksir): GitHubClient {
  return new GitHubClient(config);
}
