/**
 * IPC Event Processor
 *
 * Processes PM-MCP events from SQLite and executes them using issue tracker/GitHub clients.
 * Sends results back to murshid session.
 *
 * This is the bridge between PM-MCP tool calls and actual API operations.
 */

import { GitHubClient } from "../github/gh.ts";
import type { MessengerOutbound, IssueTracker, UpdateIssueInput } from "../types.ts";
import { NtfyClient } from "../notifications/ntfy.ts";
import { OpenCodeClient } from "../opencode/client.ts";
import { logger } from "../logging/logger.ts";
import { 
  getUnprocessedEvents, 
  markEventProcessed,
  qiraStatus,
  naqshStatus,
  upsertPendingDemand,
  removePendingDemand,
  getPendingDemands,
} from "../../db/db.ts";
import type {
  TaṣmīmIksir,
  MunToolCall,
  NidāʾKhalqWaṣfa,
  NidāʾTajdīdWaṣfa,
  MunSetRelationsCall,
  NidāʾQirāʾatWaṣfa,
  NidāʾKhalqRisāla,
  MunCheckBranchStatusCall,
  MunNotifyCall,
  MunReplyCall,
  MunSliceForPrCall,
  MunYieldCall,
  MunDemandControlCall,
  MunCreateBranchCall,
  MunSspCall,
  MunSsspCall,
  MunIstihalCall,
  MunIstihalMutabaqqCall,
  MunCommitCall,
  MunGitAddCall,
} from "../types.ts";
import { generateBranchName } from "./session-manager.ts";
import { classifyNotification } from "./classifier.ts";
import type { MudīrJalasāt } from "./session-manager.ts";
import type { Munadi } from "./munadi.ts";
import * as git from "../git/operations.ts";

interface ToolExecutorDeps {
  config: TaṣmīmIksir;
  issueTracker: IssueTracker;
  github: GitHubClient;
  messenger: MessengerOutbound;
  ntfy: NtfyClient;
  sessionManager: MudīrJalasāt;
  opencode: OpenCodeClient;
}

// Path to AGENTS.md for classification context


export class ToolExecutor {
  // Config stored for future use (quiet hours, etc.)
  readonly #config: TaṣmīmIksir;
  #issueTracker: IssueTracker;
  #github: GitHubClient;
  #messenger: MessengerOutbound;
  #ntfy: NtfyClient;
  #sessionManager: MudīrJalasāt;
  #opencode: OpenCodeClient;
  #munadi: Munadi | null = null;

  #pollAbortController: AbortController | null = null;

  constructor(deps: ToolExecutorDeps) {
    this.#config = deps.config;
    this.#issueTracker = deps.issueTracker;
    this.#github = deps.github;
    this.#messenger = deps.messenger;
    this.#ntfy = deps.ntfy;
    this.#sessionManager = deps.sessionManager;
    this.#opencode = deps.opencode;
  }

  /**
   * Set Munadi (called after Munadi is created to avoid circular dep)
   */
  waḍaʿaMunadi(munadi: Munadi): void {
    this.#munadi = munadi;
  }

  /** Access config for quiet hours checks etc. */
  get config(): TaṣmīmIksir {
    return this.#config;
  }

  /**
   * Load persisted state (call before startProcessing)
   * With SQLite, there's no offset to load - processed state is in the DB.
   */
  async loadState(): Promise<void> {
    await logger.info("tool-executor", "State managed by SQLite (no offset to load)");
  }

  /**
   * Save state to disk (public, for graceful shutdown)
   * With SQLite, processed events are already marked - nothing to persist separately.
   */
  async saveState(): Promise<void> {
    // No-op: SQLite handles persistence automatically
  }

  /**
   * Start processing PM-MCP events
   */
  async startProcessing(signal: AbortSignal): Promise<void> {
    this.#pollAbortController = new AbortController();
    const combinedSignal = AbortSignal.any([signal, this.#pollAbortController.signal]);

    while (!combinedSignal.aborted) {
      try {
        await this.#processEvents();
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          await logger.error("tool-executor", "Event processing error", {
            error: String(error),
          });
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /**
   * Stop processing
   */
  stopProcessing(): void {
    this.#pollAbortController?.abort();
    this.#pollAbortController = null;
  }

  /**
   * Process unprocessed events from SQLite
   */
  async #processEvents(): Promise<void> {
    const events = getUnprocessedEvents("pm");
    
    if (events.length === 0) {
      return; // No new events
    }

    for (const dbEvent of events) {
      try {
        const event = JSON.parse(dbEvent.payload) as MunToolCall & { timestamp: string };
        await this.#handleEvent(event);
        markEventProcessed(dbEvent.id);
      } catch (error) {
        await logger.warn("tool-executor", "Failed to process event", { 
          error: String(error),
          eventId: dbEvent.id,
        });
        // Mark as processed anyway to avoid infinite retry loops
        markEventProcessed(dbEvent.id);
      }
    }
  }

  /**
   * Handle a PM-MCP event
   */
  /** Git-mutating tools that must be blocked during session switches */
  static readonly GIT_TOOLS = new Set([
    "mun_create_branch", "mun_git_add", "mun_commit", "mun_git_push", "mun_ssp", "mun_sssp",
  ]);

  async #handleEvent(event: MunToolCall): Promise<void> {
    await logger.debug("tool-executor", `Processing: ${event.tool}`);

    // Block git-mutating tools during session switch (git fence)
    if (ToolExecutor.GIT_TOOLS.has(event.tool) && this.#sessionManager.isGitFenced()) {
      const msg = `Git operation blocked: a session switch is in progress. Try again in a few seconds.`;
      const targetId = ("huwiyyatMurshid" in event && event.huwiyyatMurshid)
        ? event.huwiyyatMurshid as string
        : null;
      if (targetId) {
        await this.#sessionManager.arsalaIlaMurshidById(targetId, `## Tool Result: ${event.tool}\n\n${msg}`);
      } else {
        await this.#sessionManager.arsalaIlaMurshid(`## Tool Result: ${event.tool}\n\n${msg}`);
      }
      return;
    }

    let result: string;

    try {
      switch (event.tool) {
        case "mun_read_wasfa":
          result = await this.#ʿālajaQirāʾatWaṣfa(event);
          break;
        case "mun_create_wasfa":
          result = await this.#ʿālajaKhalqWaṣfa(event);
          break;
        case "mun_update_wasfa":
          result = await this.#ʿālajaTajdīdWaṣfa(event);
          break;
        case "mun_set_relations":
          result = await this.#handleSetRelations(event);
          break;

        case "mun_slice_for_pr":
          result = await this.#handleSliceForPr(event);
          break;
        case "mun_create_risala":
          result = await this.#ʿālajaKhalqRisāla(event);
          break;
        case "mun_check_branch_status":
          result = await this.#handleCheckBranchStatus(event);
          break;
        case "mun_notify":
          result = await this.#handleNotify(event);
          break;
        case "mun_reply":
          result = await this.#handleReply(event);
          break;
        case "mun_log_decision":
          // Already handled by PM-MCP server directly, skip
          return;
        case "mun_yield":
          result = await this.#handleYield(event);
          break;
        case "mun_demand_control":
          result = await this.#handleDemandControl(event);
          break;
        case "mun_create_branch":
          result = await this.#handleCreateBranch(event);
          break;
        case "mun_git_add":
          result = await this.#handleGitAdd(event);
          break;
        case "mun_commit":
          result = await this.#handleCommit(event);
          break;
        case "mun_git_push":
          result = await this.#handleGitPush();
          break;
        case "mun_ssp":
          result = await this.#handleSsp(event);
          break;
        case "mun_sssp":
          result = await this.#handleSssp(event);
          break;
        case "mun_istihal":
          result = await this.#handleTransmute(event);
          break;
        case "mun_istihal_mutabaqq":
          result = await this.#handleTransmuteStacked(event);
          break;
        default:
          result = `Unknown tool: ${(event as { tool: string }).tool}`;
      }

      // Send result back to the originating murshid (not necessarily the active one)
      const targetId = ("huwiyyatMurshid" in event && event.huwiyyatMurshid)
        ? event.huwiyyatMurshid as string
        : null;
      if (targetId) {
        await this.#sessionManager.arsalaIlaMurshidById(targetId, `## Tool Result: ${event.tool}\n\n${result}`);
      } else {
        await this.#sessionManager.arsalaIlaMurshid(`## Tool Result: ${event.tool}\n\n${result}`);
      }
    } catch (error) {
      const errorMsg = `Error executing ${event.tool}: ${error}`;
      await logger.error("tool-executor", errorMsg);
      const targetId = ("huwiyyatMurshid" in event && event.huwiyyatMurshid)
        ? event.huwiyyatMurshid as string
        : null;
      if (targetId) {
        await this.#sessionManager.arsalaIlaMurshidById(targetId, `## Tool Error: ${event.tool}\n\n${errorMsg}`);
      } else {
        await this.#sessionManager.arsalaIlaMurshid(`## Tool Error: ${event.tool}\n\n${errorMsg}`);
      }
    }
  }

  // ===========================================================================
  // Tool Handlers
  // ===========================================================================

  /**
   * Handle pm_read_wasfa
   */
  async #ʿālajaQirāʾatWaṣfa(call: NidāʾQirāʾatWaṣfa): Promise<string> {
    const parsed = this.#issueTracker.parseUrl(call.url);

    if (!parsed) {
      return `Failed to parse URL: ${call.url}`;
    }

    const parts: string[] = [];
    parts.push(`## Entity`);
    parts.push(`**Type:** ${parsed.type}`);
    parts.push(`**ID:** ${parsed.id}`);
    parts.push("");

    if (parsed.type === "ticket") {
      const issue = await this.#issueTracker.getIssue(parsed.id);

      if (!issue) {
        return `Issue not found: ${parsed.id}`;
      }

      parts.push(`## Ticket Details`);
      parts.push(`**Identifier:** ${issue.identifier}`);
      parts.push(`**Title:** ${issue.title}`);
      if (issue.status) parts.push(`**Status:** ${issue.status}`);
      if (issue.estimate) parts.push(`**Estimate:** ${issue.estimate}`);
      if (issue.url) parts.push(`**URL:** ${issue.url}`);
      parts.push("");

      if (issue.description) {
        parts.push(`## Description`);
        parts.push(issue.description);
        parts.push("");
      }

      if (issue.labels && issue.labels.length > 0) {
        parts.push(`## Labels`);
        parts.push(issue.labels.map((l) => `- ${l}`).join("\n"));
        parts.push("");
      }

      if (issue.parent) {
        parts.push(`## Parent`);
        parts.push(`- ${issue.parent.identifier}: ${issue.parent.title}`);
        parts.push("");
      }

      // Implementation context from local DB
      const implStatusDb = qiraStatus(issue.identifier);
      parts.push(`## Context`);
      if (implStatusDb) {
        parts.push(`**Implementation Status:** ${implStatusDb.status}`);
        if (implStatusDb.summary?.includes("PR #")) {
          parts.push(`**PR:** ${implStatusDb.summary}`);
        }
      } else {
        parts.push(`**Implementation Status:** not started`);
      }
      parts.push("");

    } else if (parsed.type === "project") {
      const project = await this.#issueTracker.getProject(parsed.id);

      if (!project) {
        return `Project not found: ${parsed.id}`;
      }

      parts.push(`## Project Details`);
      parts.push(`**Name:** ${project.name}`);
      if (project.url) parts.push(`**URL:** ${project.url}`);
      if (project.issueCount) parts.push(`**Issues:** ${project.issueCount}`);
      parts.push("");

      if (project.description) {
        parts.push(`## Description`);
        parts.push(project.description);
        parts.push("");
      }
    }

    return parts.join("\n");
  }

  /**
   * Handle pm_create_wasfa
   */
  async #ʿālajaKhalqWaṣfa(call: NidāʾKhalqWaṣfa): Promise<string> {
    const issue = await this.#issueTracker.createIssue({
      title: call.title,
      description: call.description,
      estimate: call.estimate,
      status: call.status,
      labels: call.labels,
      parentId: call.parentId,
    });

    return `Ticket created successfully!

**ID:** ${issue.identifier}
**Title:** ${issue.title}
**Status:** ${issue.status ?? "default"}
**URL:** ${issue.url ?? ""}

You can now set relations using pm_set_relations.`;
  }

  /**
   * Handle pm_update_wasfa
   */
  async #ʿālajaTajdīdWaṣfa(call: NidāʾTajdīdWaṣfa): Promise<string> {
    const issue = await this.#issueTracker.getIssue(call.wasfaId);
    if (!issue) {
      return `Ticket not found: ${call.wasfaId}`;
    }

    // Build update payload
    const updatePayload: UpdateIssueInput = {};

    if (call.updates.title) updatePayload.title = call.updates.title;
    if (call.updates.description) updatePayload.description = call.updates.description;
    if (call.updates.estimate) updatePayload.estimate = call.updates.estimate;

    if (call.updates.status) {
      updatePayload.status = call.updates.status;
    }

    await this.#issueTracker.updateIssue(issue.id, updatePayload);

    return `Ticket updated: ${call.wasfaId}

Updated fields: ${Object.keys(call.updates).join(", ")}`;
  }

  /**
   * Handle pm_set_relations
   */
  async #handleSetRelations(call: MunSetRelationsCall): Promise<string> {
    await logger.info("tool-executor", "Setting relations", {
      wasfaId: call.wasfaId,
      blocks: call.blocks,
      blockedBy: call.blockedBy,
    });

    await this.#issueTracker.setRelations(
      call.wasfaId,
      call.blocks,
      call.blockedBy
    );

    return `Relations updated for ${call.wasfaId}.

${call.blocks?.length ? `**Blocks:** ${call.blocks.join(", ")}` : ""}
${call.blockedBy?.length ? `**Blocked by:** ${call.blockedBy.join(", ")}` : ""}`;
  }

  /**
   * Handle pm_slice_for_pr
   */
  async #handleSliceForPr(call: MunSliceForPrCall): Promise<string> {
    // Verify files exist by checking git status
    // This is a placeholder - real implementation would use git commands

    await logger.info("tool-executor", "Slicing for PR", {
      wasfaId: call.wasfaId,
      files: call.files,
    });

    return `PR slice prepared for ${call.wasfaId}.

Files (${call.files.length}):
${call.files.map((f) => `- ${f}`).join("\n")}

Ready for pm_create_risala.`;
  }

  /**
   * Handle pm_create_risala
   */
  async #ʿālajaKhalqRisāla(call: NidāʾKhalqRisāla): Promise<string> {
    const result = await this.#github.createPR({
      title: call.title,
      body: call.body,
      head: call.head,
      base: call.base,
      draft: true,
    });

    if (!result) {
      return `Failed to create PR for ${call.wasfaId}. Check GitHub authentication and branch status.`;
    }

    // Update implementation status with PR info
    const activeOrch = this.#sessionManager.wajadaMurshidFāʿil();
    naqshStatus({
      wasfaId: call.wasfaId,
      huwiyyatMurshid: activeOrch?.identifier ?? "unknown",
      status: "complete",
      summary: `PR #${result.number}`,
    });

    // Register PR for keepalive tracking (PR tracking)
    // This enables merge detection to trigger next PR cycle
    const murshidFāʿil = this.#sessionManager.wajadaMurshidFāʿil();
    if (murshidFāʿil) {
      await this.#sessionManager.registerPR(murshidFāʿil.identifier, {
        wasfaId: call.wasfaId,
        prNumber: result.number,
        branch: call.head,
        status: "draft",
      });
    } else {
      await logger.warn("tool-executor", `PR #${result.number} created but no active murshid to track it`);
    }

    return `Draft PR created successfully!

**PR Number:** #${result.number}
**URL:** ${result.url}
**Title:** ${call.title}
**Base:** ${call.base}
**Head:** ${call.head}

The PR is in draft mode. It will be promoted it when ready for review.
PR is now being tracked by keepalive for merge detection.`;
  }

  /**
   * Handle pm_check_branch_status
   */
  async #handleCheckBranchStatus(call: MunCheckBranchStatusCall): Promise<string> {
    const defaultBranch = await this.#github.getDefaultBranch();
    const comparison = await this.#github.compareBranches(defaultBranch, call.branch);

    if (!comparison) {
      return `Failed to check branch status for ${call.branch}. Branch may not exist.`;
    }

    return `## Branch Status: ${call.branch}

**Ahead of ${defaultBranch}:** ${comparison.ahead} commits
**Behind ${defaultBranch}:** ${comparison.behind} commits
**Files Changed:** ${comparison.files.length}

${comparison.behind > 0 ? "⚠️ Branch is behind - consider rebasing before PR." : "✓ Branch is up to date with main."}`;
  }

  /**
   * Handle pm_notify
   * Filters cry-baby notifications, routes worthy ones to operator's topic.
   */
  async #handleNotify(call: MunNotifyCall): Promise<string> {
    // Step 1: Classify the notification
    const classification = await classifyNotification(this.#opencode, call.message);

    if (!classification.worthy) {
      // Rejected - return guidance to murshid
      await logger.info("tool-executor", "Notification rejected as cry-baby", {
        reason: classification.reason,
        messagePreview: call.message.slice(0, 100),
      });

      return `REJECTED: ${classification.rejection}

Your message was not forwarded to operator. This appears to be within your autonomy.

Reason: ${classification.reason}`;
    }

    // Step 2: Worthy notification - forward to operator
    await logger.info("tool-executor", "Notification approved", {
      reason: classification.reason,
      messagePreview: call.message.slice(0, 100),
    });

    const sent: string[] = [];

    // Send via messenger (routed to murshid's channel if available)
    if (this.#messenger.isEnabled()) {
      try {
        await this.#messenger.send(
          { murshid: call.huwiyyatMurshid },
          call.message,
        );
        sent.push("messenger");
      } catch (err) {
        await logger.error("tool-executor", "Failed to send notification via messenger", {
          error: String(err),
        });
      }
    }

    // Send via ntfy
    if (this.#ntfy.isEnabled()) {
      const success = await this.#ntfy.send({
        category: "decision",
        title: "Murshid Message",
        body: call.message,
        priority: call.priority,
      });
      if (success) {
        sent.push("ntfy");
      }
    }

    if (sent.length === 0) {
      return "Warning: No notification channels are enabled. Message not delivered.";
    }

    return `Notification sent to operator via: ${sent.join(", ")}

Priority: ${call.priority}
Message preview: ${call.message.slice(0, 100)}${call.message.length > 100 ? "..." : ""}`;
  }

  /**
   * Handle pm_reply
   * Direct response to operator's question - no filtering, just route to topic.
   * Uses fallback chain: Markdown → MarkdownV2 → plain text
   */
  async #handleReply(call: MunReplyCall): Promise<string> {
    if (!this.#messenger.isEnabled()) {
      return "Warning: Messenger not enabled. Reply not delivered.";
    }

    try {
      // Send with markdown formatting (adapter handles fallback)
      await this.#messenger.sendFormatted(
        { murshid: call.huwiyyatMurshid },
        call.message,
      );

      await logger.info("tool-executor", "Reply sent to operator", {
        huwiyyatMurshid: call.huwiyyatMurshid,
        messagePreview: call.message.slice(0, 100),
      });
      return `Reply sent to operator (${call.huwiyyatMurshid}).`;
    } catch (err) {
      await logger.error("tool-executor", "Failed to send reply to operator", {
        huwiyyatMurshid: call.huwiyyatMurshid,
        error: String(err),
      });
      return "Failed to send reply to operator.";
    }
  }

  /**
   * Handle pm_yield - murshid voluntarily yields control
   */
  async #handleYield(call: MunYieldCall): Promise<string> {
    if (!this.#munadi) {
      return "Error: Munadi not initialized.";
    }

    const yielderId = call.huwiyyatMurshid;
    const activeEpicId = this.#munadi.getActiveIdentifier();

    // Verify caller is the active murshid
    if (yielderId !== activeEpicId) {
      await logger.warn("tool-executor", `Non-active murshid ${yielderId} tried to yield (active: ${activeEpicId})`);
      return `Cannot yield: you (${yielderId}) are not the active murshid. Active: ${activeEpicId ?? "none"}.`;
    }

    // Update session status
    const newStatus = call.reason === "masdūd" ? "masdūd" : "muntaẓir";
    await this.#sessionManager.jaddadaḤālatMurshid(yielderId, newStatus, call.details);

    await logger.info("tool-executor", `Murshid ${yielderId} yielded: ${call.reason}`, {
      details: call.details,
      suggestNext: call.suggestNext,
    });

    // Check pending demands first (persisted in SQLite, sorted by priority then time)
    const demands = getPendingDemands();
    if (demands.length > 0) {
      const demand = demands[0];
      removePendingDemand(demand.murshid_id);
      await logger.info("tool-executor", `Processing pending demand from ${demand.murshid_id}`, {
        reason: demand.reason,
      });

      const switchResult = await this.#munadi.handleCallback("cli", `switch:${demand.murshid_id}`);
      if (switchResult.handled) {
        return `Yielded control. Switching to ${demand.murshid_id} (pending demand: ${demand.reason}).`;
      }
    }

    // Check suggestNext
    if (call.suggestNext) {
      const murshidun = this.#sessionManager.wajadaJalasātMurshid();
      const suggested = murshidun.find((o) => o.identifier === call.suggestNext);
      if (suggested && suggested.status === "sākin") {
        await this.#munadi.handleCallback("cli", `switch:${call.suggestNext}`);
        return `Yielded control. Switching to suggested: ${call.suggestNext}.`;
      }
    }

    // Check for idle sessions
    const murshidun = this.#sessionManager.wajadaJalasātMurshid();
    const idleSessions = murshidun.filter(
      (o) => o.identifier !== yielderId && o.status === "sākin"
    );

    if (idleSessions.length > 0) {
      // Notify operator
      const msg = `${yielderId} yielded (${call.reason}). ${idleSessions.length} idle session(s) available:\n${idleSessions.map(s => `• ${s.identifier}`).join("\n")}`;
      await this.#messenger.send("dispatch", msg);
      return `Yielded control. ${idleSessions.length} idle session(s) available. Operator can /switch to one.`;
    }

    // Nobody to switch to — clear active
    this.#munadi.setActiveSession(null);

    await this.#messenger.send("dispatch", `${yielderId} yielded (${call.reason}). No other sessions available — system idle.`);

    return `Yielded control. No other sessions available. System is idle.`;
  }

  /**
   * Handle pm_demand_control - murshid demands control back
   */
  async #handleDemandControl(call: MunDemandControlCall): Promise<string> {
    if (!this.#munadi) {
      return "Error: Munadi not initialized.";
    }

    const demanderId = call.huwiyyatMurshid;
    const demander = this.#sessionManager.getMurshid(demanderId);

    if (!demander) {
      return `Cannot demand control: unknown murshid ${demanderId}.`;
    }

    const activeEpicId = this.#munadi.getActiveIdentifier();

    await logger.info("tool-executor", `Murshid ${demanderId} demands control`, {
      reason: call.reason,
      priority: call.priority,
      currentActive: activeEpicId,
    });

    // Case 1: No active — grant immediately
    if (!activeEpicId) {
      const result = await this.#munadi.handleCallback("cli", `switch:${demanderId}`);
      if (result.handled) {
        return `Control granted immediately. You are now ACTIVE.\n\nReason: ${call.reason}`;
      }
      return "Failed to grant control.";
    }

    // Case 2: Demander is already active
    if (activeEpicId === demanderId) {
      return `You (${demanderId}) are already the active murshid.`;
    }

    // Case 3: Current active is blocked/waiting — graceful snatch
    const currentActive = this.#sessionManager.getMurshid(activeEpicId);
    if (currentActive && (currentActive.status === "masdūd" || currentActive.status === "muntaẓir")) {
      const result = await this.#munadi.handleCallback("cli", `switch:${demanderId}`);
      if (result.handled) {
        return `Control granted (${activeEpicId} was ${currentActive.status}). You are now ACTIVE.\n\nReason: ${call.reason}`;
      }
      return "Failed to grant control.";
    }

    // Case 4: Current active is working — queue the demand (persisted to SQLite)
    upsertPendingDemand(demanderId, call.reason, call.priority);

    const queueLength = getPendingDemands().length;
    await logger.info("tool-executor", `Queued demand from ${demanderId}`, {
      queueLength,
    });

    if (call.priority === "urgent") {
      await this.#messenger.send("dispatch",
        `URGENT: ${demanderId} demands control.\n\nReason: ${call.reason}\nCurrent active: ${activeEpicId}\n\nApprove with /switch ${demanderId}`
      );

      return `Urgent demand queued and Operator notified. Current active: ${activeEpicId}.\n\nYou will be activated when ${activeEpicId} yields or operator approves.`;
    }

    return `Demand queued. Current active: ${activeEpicId}.\n\nYou will be activated when ${activeEpicId} yields.`;
  }

  // ===========================================================================
  // Git Operations Handlers
  // ===========================================================================

  /**
   * Handle pm_create_branch - create epic, chore, or sandbox branch
   */
  async #handleCreateBranch(call: MunCreateBranchCall): Promise<string> {
    const branchName = generateBranchName(call.identifier, call.type, call.slug);

    await logger.info("tool-executor", `Creating branch: ${branchName}`);

    // Check if dirty first
    if (await git.isDirty()) {
      return `Error: Working directory is dirty. Cannot create branch.

Please commit or stash changes first.`;
    }

    // Checkout default branch and pull
    const defaultBranch = await git.getDefaultBranch();
    const checkoutMain = await git.checkout(defaultBranch);
    if (!checkoutMain) {
      return `Error: Failed to checkout ${defaultBranch} branch.`;
    }

    await git.pull(defaultBranch);

    // Create new branch
    const checkoutNew = await git.checkout(branchName);
    if (!checkoutNew) {
      return `Error: Failed to create branch ${branchName}.`;
    }

    // Push with -u
    const pushed = await git.push(branchName, true);
    if (!pushed) {
      return `Branch created locally but failed to push.

Branch: ${branchName}

Try: git push -u origin ${branchName}`;
    }

    // Update session with branch name
    const session = this.#sessionManager.getMurshid(call.identifier);
    if (session) {
      session.branch = branchName;
      await this.#sessionManager.saveState();
    }

    return `Branch created and pushed successfully.

Branch: ${branchName}
Status: Checked out and tracking origin

You can now start implementation.`;
  }

  /**
   * Handle pm_git_add - stage files
   */
  async #handleGitAdd(call: MunGitAddCall): Promise<string> {
    const result = await git.gitAdd(call.files);
    if (!result.success) {
      return `Error staging files: ${result.error}`;
    }

    return `Files staged successfully.

Files (${call.files.length}):
${call.files.map((f) => `  ✓ ${f}`).join("\n")}`;
  }

  /**
   * Handle pm_commit - commit staged changes
   */
  async #handleCommit(call: MunCommitCall): Promise<string> {
    const result = await git.commit(call.message, call.files);
    if (!result.success) {
      if (result.error === "nothing to commit") {
        return `Nothing to commit. Working tree clean.`;
      }
      return `Error creating commit: ${result.error}`;
    }

    return `Commit created successfully.

Commit: ${result.hash ?? "unknown"}
Message: ${call.message}`;
  }

  /**
   * Handle pm_git_push - push current branch
   */
  async #handleGitPush(): Promise<string> {
    const currentBranch = await git.getCurrentBranch();
    if (!currentBranch) {
      return `Error: Could not determine current branch.`;
    }

    const pushed = await git.push(currentBranch);
    if (!pushed) {
      return `Error: Failed to push ${currentBranch} to origin.`;
    }

    return `Pushed successfully.

Branch: ${currentBranch}
Remote: origin`;
  }

  /**
   * Handle pm_ssp - run SSP to create PR branch
   */
  async #handleSsp(call: MunSspCall): Promise<string> {
    const prBranch = generateBranchName(call.wasfaId, "chore");

    await logger.info("tool-executor", `Running SSP for ${call.wasfaId}`, {
      files: call.files,
      prBranch,
    });

    const result = await git.ssp(prBranch, call.files);

    if (!result.success) {
      if (result.errorType === "conflicts") {
        const conflictList = result.conflicts?.map(f => `  - ${f}`).join("\n") ?? "  (unknown)";
        return `SSP failed: Merge conflicts with default branch.

Conflicted files:
${conflictList}

To resolve:
1. Resolve conflicts in the listed files on the epic branch
2. Stage resolved files with pm_git_add
3. Commit the merge with pm_commit
4. Retry pm_ssp

The merge has been aborted — your epic branch is clean.`;
      }

      return `SSP failed (${result.errorType}): ${result.error}`;
    }

    const defaultBranch = await git.getDefaultBranch();

    return `SSP completed successfully.

PR Branch: ${prBranch}
Epic Branch: ${result.epicBranch}
Files Sliced: ${result.filesSliced}

The branch has been pushed to origin.

Next: Create the PR with:
  gh pr create --title "Your PR title (${call.wasfaId})" --base ${defaultBranch} --head ${prBranch} --draft`;
  }

  /**
   * Handle pm_sssp - run SSSP (Stacked) to create PR branch targeting parent slice
   * 
   * Same as SSP but the PR branch is based on a parent PR branch instead of
   * the default branch. Still merges default branch into epic to surface conflicts.
   */
  async #handleSssp(call: MunSsspCall): Promise<string> {
    const prBranch = generateBranchName(call.wasfaId, "chore");
    const parentBranch = generateBranchName(call.parentTicketId, "chore");

    await logger.info("tool-executor", `Running SSSP for ${call.wasfaId}`, {
      files: call.files,
      prBranch,
      parentBranch,
    });

    const result = await git.ssp(prBranch, call.files, parentBranch);

    if (!result.success) {
      if (result.errorType === "conflicts") {
        const conflictList = result.conflicts?.map(f => `  - ${f}`).join("\n") ?? "  (unknown)";
        return `SSSP failed: Merge conflicts with default branch.

Conflicted files:
${conflictList}

To resolve:
1. Resolve conflicts in the listed files on the epic branch
2. Stage resolved files with pm_git_add
3. Commit the merge with pm_commit
4. Retry pm_sssp`;
      }

      return `SSSP failed (${result.errorType}): ${result.error}`;
    }

    return `SSSP completed successfully.

PR Branch: ${prBranch}
Parent Branch: ${parentBranch}
Epic Branch: ${result.epicBranch}
Files Sliced: ${result.filesSliced}

The branch has been pushed to origin.

Next: Create the PR with:
  gh pr create --title "Your PR title (${call.wasfaId})" --base ${parentBranch} --head ${prBranch} --draft

NOTE: CI may fail until parent PR merges. This is expected.
When parent merges, use mun_ssp to re-push this slice onto ${await git.getDefaultBranch()}.`;
  }

  /**
   * Handle mun_istihal - create artifact using file-plucking technique
   */
  async #handleTransmute(call: MunIstihalCall): Promise<string> {
    await logger.info("tool-executor", `Crafting artifact for ${call.wasfaId}`, {
      files: call.files.length,
    });

    const prBranch = generateBranchName(call.wasfaId, "chore");
    
    // Use the new transmute utility from craft.ts
    const { transmute } = await import("../git/alchemy.ts");
    const result = await transmute(prBranch, call.files);

    if (!result.success) {
      if (result.errorType === "conflicts" && result.conflicts) {
        return `Transmutation failed: Runes conflict with codex inscriptions.

Conflicted stones:
${result.conflicts.map((f) => `  - ${f}`).join("\n")}

Options:
1. Reconcile the conflicting runes in crucible, then retry mun_istihal
2. Force transmutation (conflicted runes will need reconciliation during examination)

To reconcile runes:
  git status  # Identify conflicted stones
  # Reconcile the conflicting incantations
  git add <stones>
  git commit`;
      }
      return `Transmutation failed (${result.errorType}): ${result.error}`;
    }

    return `Transmutation complete.

Essence Vessel: ${prBranch}
Crucible: ${result.crucibleBranch}
Rune Stones Transmuted: ${result.materialsTransmuted}

The runes have crystallized into pure essence.

Next: Use mun_fasl to transfer the essence for examination.`;
  }

  /**
   * Handle mun_istihal_mutabaqq - create stacked artifact
   */
  async #handleTransmuteStacked(call: MunIstihalMutabaqqCall): Promise<string> {
    await logger.info("tool-executor", `Crafting stacked artifact for ${call.wasfaId}`, {
      parentTicketId: call.parentTicketId,
      files: call.files.length,
    });

    const prBranch = generateBranchName(call.wasfaId, "chore");
    const parentBranch = generateBranchName(call.parentTicketId, "chore");
    
    // Use transmute with parent branch as base
    const { transmute } = await import("../git/alchemy.ts");
    const result = await transmute(prBranch, call.files, parentBranch);

    if (!result.success) {
      if (result.errorType === "conflicts" && result.conflicts) {
        return `Stacked artifact crafting failed: Merge conflicts with default branch.

Conflicted files:
${result.conflicts.map((f) => `  - ${f}`).join("\n")}

Resolve conflicts in crucible before retrying.`;
      }
      return `Layered transmutation failed (${result.errorType}): ${result.error}`;
    }

    return `Layered transmutation complete.

Essence Branch: ${prBranch}
Parent Essence: ${parentBranch}
Crucible: ${result.crucibleBranch}
Materials Transmuted: ${result.materialsTransmuted}

The layered essence has been crystallized and pushed to origin.

Next: Use mun_fasl to transfer for examination (will reference parent essence).

NOTE: Examination may reveal instability until parent essence inscribes.
This is expected for layered transmutations.
When parent inscribes, use mun_istihal to re-transmute onto ${await git.getDefaultBranch()}.`;
  }
}

/**
 * Create an IPC processor instance
 */
export function istadaaMunaffidh(deps: ToolExecutorDeps): ToolExecutor {
  return new ToolExecutor(deps);
}
