/**
 * Munaffidh (منفذ) - The Executor
 * 
 * One of the sacred Khuddām (خدّام - Servants) of the alchemical workshop.
 * Munaffidh executes the alchemical operations commanded by the Murshidun.
 * Git transmutations, Linear inscriptions, GitHub treatises - all sacred
 * operations flow through Munaffidh's careful hands.
 */

/**
 * IPC Event Processor
 *
 * Processes PM-MCP events from SQLite and executes them using issue tracker/GitHub clients.
 * Sends results back to murshid session.
 *
 * This is the bridge between PM-MCP tool calls and actual API operations.
 */

import { GitHubClient } from "../github/gh.ts";
import type { RasulKharij, MutabiWasfa, MudkhalTahdithQadiya } from "../types.ts";
import { NtfyClient } from "../notifications/ntfy.ts";
import { OpenCodeClient } from "../opencode/client.ts";
import { logger } from "../logging/logger.ts";
import { 
  jalabaAhdathGhairMuaalaja, 
  allamaHadathMuaalaj,
  qiraStatus,
  naqshStatus,
  haddathaAwAdkhalaMatlabMuallaq,
  removePendingDemand,
  jalabaMatalebMuallaq,
} from "../../db/db.ts";
import type {
  TasmimIksir,
  MunToolCall,
  NidaKhalqWasfa,
  NidaTajdidWasfa,
  MunSetRelationsCall,
  NidaQiraatWasfa,
  NidaKhalqRisala,
  MunCheckBranchStatusCall,
  MunNotifyCall,
  MunReplyCall,
  MunSliceForPrCall,
  MunYieldCall,
  MunDemandControlCall,
  MunCreateBranchCall,
  MunIstihalCall,
  MunIstihalMutabaqqCall,
  MunCommitCall,
  MunGitAddCall,
} from "../types.ts";
import { generateBranchName } from "./katib.ts";
import { mayyazaTanbih } from "./mumayyiz.ts";
import type { MudirJalasat } from "./katib.ts";
import type { Munadi } from "./munadi.ts";
import * as git from "../git/operations.ts";

interface MunaffidhDeps {
  config: TasmimIksir;
  issueTracker: MutabiWasfa;
  github: GitHubClient;
  messenger: RasulKharij;
  ntfy: NtfyClient;
  sessionManager: MudirJalasat;
  opencode: OpenCodeClient;
}



export class Munaffidh {
  readonly #config: TasmimIksir;
  #issueTracker: MutabiWasfa;
  #github: GitHubClient;
  #messenger: RasulKharij;
  #ntfy: NtfyClient;
  #sessionManager: MudirJalasat;
  #opencode: OpenCodeClient;
  #iksir: Munadi | null = null;

  #pollAbortController: AbortController | null = null;

  constructor(deps: MunaffidhDeps) {
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
  wadaaMunadi(iksir: Munadi): void {
    this.#iksir = iksir;
  }

  /** Access config for quiet hours checks etc. */
  get config(): TasmimIksir {
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
   * Save state to disk (public, for graceful ighlaaq)
   * With SQLite, processed events are already marked - nothing to persist separately.
   */
  async saveState(): Promise<void> {
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
    const events = jalabaAhdathGhairMuaalaja("pm");
    
    if (events.length === 0) {
      return;
    }

    for (const dbEvent of events) {
      try {
        const event = JSON.parse(dbEvent.payload) as MunToolCall & { timestamp: string };
        await this.#handleEvent(event);
        allamaHadathMuaalaj(dbEvent.id);
      } catch (error) {
        await logger.warn("tool-executor", "Failed to process event", { 
          error: String(error),
          eventId: dbEvent.id,
        });
        allamaHadathMuaalaj(dbEvent.id);
      }
    }
  }

  /**
   * Handle a PM-MCP event
   */
  /** Git-mutating tools that must be blocked during session switches */
  static readonly GIT_TOOLS = new Set([
    "mun_create_branch", "mun_git_add", "mun_commit", "mun_git_push", "mun_istihal", "mun_istihal_mutabaqq",
  ]);

  async #handleEvent(event: MunToolCall): Promise<void> {
    await logger.debug("tool-executor", `Processing: ${event.tool}`);

    if (Munaffidh.GIT_TOOLS.has(event.tool) && this.#sessionManager.huwaGitMasdud()) {
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
          result = await this.#aalajaQiraaatWasfa(event);
          break;
        case "mun_create_wasfa":
          result = await this.#aalajaKhalqWasfa(event);
          break;
        case "mun_update_wasfa":
          result = await this.#aalajaTajdidWasfa(event);
          break;
        case "mun_set_relations":
          result = await this.#handleSetRelations(event);
          break;

        case "mun_slice_for_pr":
          result = await this.#handleSliceForPr(event);
          break;
        case "mun_create_risala":
          result = await this.#aalajaKhalqRisala(event);
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
        case "mun_istihal":
          result = await this.#handleIstihal(event);
          break;
        case "mun_istihal_mutabaqq":
          result = await this.#handleIstihalMutabaqq(event);
          break;
        default:
          result = `Unknown tool: ${(event as { tool: string }).tool}`;
      }

      /** Send result back to the originating murshid (not necessarily the active one) */
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


  /**
   * Handle pm_read_wasfa
   */
  async #aalajaQiraaatWasfa(call: NidaQiraatWasfa): Promise<string> {
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

      /** Implementation context from local DB */
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
  async #aalajaKhalqWasfa(call: NidaKhalqWasfa): Promise<string> {
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
  async #aalajaTajdidWasfa(call: NidaTajdidWasfa): Promise<string> {
    const issue = await this.#issueTracker.getIssue(call.huwiyyatWasfa);
    if (!issue) {
      return `Ticket not found: ${call.huwiyyatWasfa}`;
    }

    /** Build update payload */
    const updatePayload: MudkhalTahdithQadiya = {};

    if (call.updates.title) updatePayload.title = call.updates.title;
    if (call.updates.description) updatePayload.description = call.updates.description;
    if (call.updates.estimate) updatePayload.estimate = call.updates.estimate;

    if (call.updates.status) {
      updatePayload.status = call.updates.status;
    }

    await this.#issueTracker.updateIssue(issue.id, updatePayload);

    return `Ticket updated: ${call.huwiyyatWasfa}

Updated fields: ${Object.keys(call.updates).join(", ")}`;
  }

  /**
   * Handle pm_set_relations
   */
  async #handleSetRelations(call: MunSetRelationsCall): Promise<string> {
    await logger.info("tool-executor", "Setting relations", {
      huwiyyatWasfa: call.huwiyyatWasfa,
      blocks: call.blocks,
      blockedBy: call.blockedBy,
    });

    await this.#issueTracker.setRelations(
      call.huwiyyatWasfa,
      call.blocks,
      call.blockedBy
    );

    return `Relations updated for ${call.huwiyyatWasfa}.

${call.blocks?.length ? `**Blocks:** ${call.blocks.join(", ")}` : ""}
${call.blockedBy?.length ? `**Blocked by:** ${call.blockedBy.join(", ")}` : ""}`;
  }

  /**
   * Handle pm_slice_for_pr
   */
  async #handleSliceForPr(call: MunSliceForPrCall): Promise<string> {

    await logger.info("tool-executor", "Slicing for PR", {
      huwiyyatWasfa: call.huwiyyatWasfa,
      files: call.files,
    });

    return `PR slice prepared for ${call.huwiyyatWasfa}.

Files (${call.files.length}):
${call.files.map((f) => `- ${f}`).join("\n")}

Ready for pm_create_risala.`;
  }

  /**
   * Handle pm_create_risala
   */
  async #aalajaKhalqRisala(call: NidaKhalqRisala): Promise<string> {
    const result = await this.#github.createPR({
      title: call.title,
      body: call.body,
      head: call.head,
      base: call.base,
      draft: true,
    });

    if (!result) {
      return `Failed to create PR for ${call.huwiyyatWasfa}. Check GitHub authentication and branch status.`;
    }

    /** Update implementation status with PR info */
    const activeOrch = this.#sessionManager.wajadaMurshidFaail();
    naqshStatus({
      huwiyyatWasfa: call.huwiyyatWasfa,
      huwiyyatMurshid: activeOrch?.identifier ?? "unknown",
      status: "complete",
      summary: `PR #${result.number}`,
    });

    /**
     * Register PR for keepalive tracking (PR tracking)
     * This enables merge detection to trigger next PR cycle
     */
    const murshidFaail = this.#sessionManager.wajadaMurshidFaail();
    if (murshidFaail) {
      await this.#sessionManager.sajjalRisala(murshidFaail.identifier, {
        huwiyyatWasfa: call.huwiyyatWasfa,
        raqamRisala: result.number,
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
    const defaultBranch = await this.#github.farAlAsasi();
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
   * Filters khabath notifications, routes dhahab ones to mawdu al-Kimyawi.
   */
  async #handleNotify(call: MunNotifyCall): Promise<string> {
    /** Step 1: Mayyiz the tanbih */
    const tamyiz = await mayyazaTanbih(this.#opencode, call.message);

    if (!tamyiz.dhahab) {
      await logger.info("tool-executor", "Ishara rejected as khabath", {
        reason: tamyiz.reason,
        messagePreview: call.message.slice(0, 100),
      });

      return `REJECTED: ${tamyiz.rejection}

Your message was not forwarded to al-Kimyawi. This appears to be within your autonomy.

Reason: ${tamyiz.reason}`;
    }

    await logger.info("tool-executor", "Ishara approved", {
      reason: tamyiz.reason,
      messagePreview: call.message.slice(0, 100),
    });

    const sent: string[] = [];

    if (this.#messenger.mumakkan()) {
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

    if (this.#ntfy.mumakkan()) {
      const success = await this.#ntfy.send({
        category: "decision",
        title: "Murshid Message",
        body: call.message,
        awwaliyya: call.awwaliyya,
      });
      if (success) {
        sent.push("ntfy");
      }
    }

    if (sent.length === 0) {
      return "Warning: No notification channels are enabled. Message not delivered.";
    }

    return `Ishara sent to al-Kimyawi via: ${sent.join(", ")}

Awwaliyya: ${call.awwaliyya}
Message preview: ${call.message.slice(0, 100)}${call.message.length > 100 ? "..." : ""}`;
  }

  /**
   * Handle pm_reply
   * Direct response to al-Kimyawi's question - no filtering, just route to topic.
   * Uses fallback chain: Markdown → MarkdownV2 → plain text
   */
  async #handleReply(call: MunReplyCall): Promise<string> {
    if (!this.#messenger.mumakkan()) {
      return "Warning: Messenger not enabled. Reply not delivered.";
    }

    try {
      await this.#messenger.arsalaMunassaq(
        { murshid: call.huwiyyatMurshid },
        call.message,
      );

      await logger.info("tool-executor", "Reply sent to al-Kimyawi", {
        huwiyyatMurshid: call.huwiyyatMurshid,
        messagePreview: call.message.slice(0, 100),
      });
      return `Reply sent to al-Kimyawi (${call.huwiyyatMurshid}).`;
    } catch (err) {
      await logger.error("tool-executor", "Failed to send reply to al-Kimyawi", {
        huwiyyatMurshid: call.huwiyyatMurshid,
        error: String(err),
      });
      return "Failed to send reply to al-Kimyawi.";
    }
  }

  /**
   * Handle pm_yield - murshid voluntarily yields control
   */
  async #handleYield(call: MunYieldCall): Promise<string> {
    if (!this.#iksir) {
      return "Error: Munadi not tahyiad.";
    }

    const yielderId = call.huwiyyatMurshid;
    const activeEpicId = this.#iksir.hawiyyaFaila();

    if (yielderId !== activeEpicId) {
      await logger.warn("tool-executor", `Non-active murshid ${yielderId} tried to yield (active: ${activeEpicId})`);
      return `Cannot yield: you (${yielderId}) are not the active murshid. Active: ${activeEpicId ?? "none"}.`;
    }

    /** Update session status */
    const newStatus = call.reason === "masdud" ? "masdud" : "muntazir";
    await this.#sessionManager.jaddadaḤalatMurshid(yielderId, newStatus, call.details);

    await logger.info("tool-executor", `Murshid ${yielderId} yielded: ${call.reason}`, {
      details: call.details,
      suggestNext: call.suggestNext,
    });

    /** Check pending demands first (persisted in SQLite, sorted by awwaliyya then time) */
    const demands = jalabaMatalebMuallaq();
    if (demands.length > 0) {
      const demand = demands[0];
      removePendingDemand(demand.huwiyat_murshid);
      await logger.info("tool-executor", `Processing pending demand from ${demand.huwiyat_murshid}`, {
        reason: demand.reason,
      });

      const switchResult = await this.#iksir.handleCallback("cli", `switch:${demand.huwiyat_murshid}`);
      if (switchResult.handled) {
        return `Yielded control. Switching to ${demand.huwiyat_murshid} (pending demand: ${demand.reason}).`;
      }
    }

    if (call.suggestNext) {
      const murshidun = this.#sessionManager.wajadaJalasatMurshid();
      const suggested = murshidun.find((o) => o.identifier === call.suggestNext);
      if (suggested && suggested.status === "sakin") {
        await this.#iksir.handleCallback("cli", `switch:${call.suggestNext}`);
        return `Yielded control. Switching to suggested: ${call.suggestNext}.`;
      }
    }

    /** Check for idle sessions */
    const murshidun = this.#sessionManager.wajadaJalasatMurshid();
    const idleSessions = murshidun.filter(
      (o) => o.identifier !== yielderId && o.status === "sakin"
    );

    if (idleSessions.length > 0) {
      /** Notify al-Kimyawi */
      const msg = `${yielderId} yielded (${call.reason}). ${idleSessions.length} idle session(s) available:\n${idleSessions.map(s => `• ${s.identifier}`).join("\n")}`;
      await this.#messenger.send("dispatch", msg);
      return `Yielded control. ${idleSessions.length} idle session(s) available. Al-Kimyawi can /switch to one.`;
    }

    this.#iksir.setActiveSession(null);

    await this.#messenger.send("dispatch", `${yielderId} yielded (${call.reason}). No other sessions available — system idle.`);

    return `Yielded control. No other sessions available. System is idle.`;
  }

  /**
   * Handle pm_demand_control - murshid demands control back
   */
  async #handleDemandControl(call: MunDemandControlCall): Promise<string> {
    if (!this.#iksir) {
      return "Error: Munadi not tahyiad.";
    }

    const demanderId = call.huwiyyatMurshid;
    const demander = this.#sessionManager.jalabMurshid(demanderId);

    if (!demander) {
      return `Cannot demand control: unknown murshid ${demanderId}.`;
    }

    const activeEpicId = this.#iksir.hawiyyaFaila();

    await logger.info("tool-executor", `Murshid ${demanderId} demands control`, {
      reason: call.reason,
      awwaliyya: call.awwaliyya,
      currentActive: activeEpicId,
    });

    if (!activeEpicId) {
      const result = await this.#iksir.handleCallback("cli", `switch:${demanderId}`);
      if (result.handled) {
        return `Control granted immediately. You are now ACTIVE.\n\nReason: ${call.reason}`;
      }
      return "Failed to grant control.";
    }

    if (activeEpicId === demanderId) {
      return `You (${demanderId}) are already the active murshid.`;
    }

    /** Case 3: Current active is blocked/waiting — graceful snatch */
    const currentActive = this.#sessionManager.jalabMurshid(activeEpicId);
    if (currentActive && (currentActive.status === "masdud" || currentActive.status === "muntazir")) {
      const result = await this.#iksir.handleCallback("cli", `switch:${demanderId}`);
      if (result.handled) {
        return `Control granted (${activeEpicId} was ${currentActive.status}). You are now ACTIVE.\n\nReason: ${call.reason}`;
      }
      return "Failed to grant control.";
    }

    haddathaAwAdkhalaMatlabMuallaq(demanderId, call.reason, call.awwaliyya);

    const queueLength = jalabaMatalebMuallaq().length;
    await logger.info("tool-executor", `Queued demand from ${demanderId}`, {
      queueLength,
    });

    if (call.awwaliyya === "urgent") {
      await this.#messenger.send("dispatch",
        `URGENT: ${demanderId} demands control.\n\nReason: ${call.reason}\nCurrent active: ${activeEpicId}\n\nApprove with /switch ${demanderId}`
      );

      return `Urgent demand queued and al-Kimyawi mubalagh. Current active: ${activeEpicId}.\n\nYou will be activated when ${activeEpicId} yields or al-Kimyawi yuwafiq.`;
    }

    return `Demand queued. Current active: ${activeEpicId}.\n\nYou will be activated when ${activeEpicId} yields.`;
  }


  /**
   * Handle pm_create_branch - create epic, chore, or sandbox branch
   */
  async #handleCreateBranch(call: MunCreateBranchCall): Promise<string> {
    const branchName = generateBranchName(call.identifier, call.type, call.slug);

    await logger.info("tool-executor", `Creating branch: ${branchName}`);

    if (await git.huwaWasikh()) {
      return `Error: Working directory is dirty. Cannot create branch.

Please commit or stash changes first.`;
    }

    /** Checkout default branch and pull */
    const defaultBranch = await git.farAlAsasi();
    const intaqalaIlaMain = await git.intaqalaIla(defaultBranch);
    if (!intaqalaIlaMain) {
      return `Error: Failed to intaqalaIla ${defaultBranch} branch.`;
    }

    await git.pull(defaultBranch);

    /** Create new branch */
    const intaqalaIlaNew = await git.intaqalaIla(branchName);
    if (!intaqalaIlaNew) {
      return `Error: Failed to create branch ${branchName}.`;
    }

    /** Push with -u */
    const pushed = await git.push(branchName, true);
    if (!pushed) {
      return `Branch created locally but failed to push.

Branch: ${branchName}

Try: git push -u origin ${branchName}`;
    }

    /** Update session with branch name */
    const session = this.#sessionManager.jalabMurshid(call.identifier);
    if (session) {
      session.branch = branchName;
      await this.#sessionManager.hafizaHala();
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
    const currentBranch = await git.farAlHali();
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
   * Handle mun_istihal - transmute ahjar from buwtaqa into jawhar
   */
  async #handleIstihal(call: MunIstihalCall): Promise<string> {
    await logger.info("tool-executor", `Istihal for ${call.huwiyyatWasfa}`, {
      ahjar: call.files.length,
    });

    const jawharBranch = generateBranchName(call.huwiyyatWasfa, "chore");

    const { istihal } = await import("../kimiya/istihal.ts");
    const result = await istihal(jawharBranch, call.files);

    if (!result.success) {
      if (result.errorType === "conflicts" && result.conflicts) {
        return `Istihal failed: Ahjar conflict with codex.

Conflicted ahjar:
${result.conflicts.map((f) => `  - ${f}`).join("\n")}

To resolve:
1. Reconcile the conflicting ahjar in buwtaqa, then retry mun_istihal
2. git status to identify conflicts
3. Resolve, git add, git commit`;
      }
      return `Istihal failed (${result.errorType}): ${result.error}`;
    }

    return `Istihal complete.

Jawhar: ${jawharBranch}
Buwtaqa: ${result.buwtaqa}
Ahjar transmuted: ${result.adadAhjar}

Next: Use mun_fasl to create the risala.`;
  }

  /**
   * Handle mun_istihal_mutabaqq - layered istihal targeting parent jawhar
   */
  async #handleIstihalMutabaqq(call: MunIstihalMutabaqqCall): Promise<string> {
    await logger.info("tool-executor", `Layered istihal for ${call.huwiyyatWasfa}`, {
      parentTicketId: call.parentTicketId,
      ahjar: call.files.length,
    });

    const jawharBranch = generateBranchName(call.huwiyyatWasfa, "chore");
    const parentJawhar = generateBranchName(call.parentTicketId, "chore");

    const { istihal } = await import("../kimiya/istihal.ts");
    const result = await istihal(jawharBranch, call.files, parentJawhar);

    if (!result.success) {
      if (result.errorType === "conflicts" && result.conflicts) {
        return `Layered istihal failed: Conflicts with codex.

Conflicted ahjar:
${result.conflicts.map((f) => `  - ${f}`).join("\n")}

Resolve conflicts in buwtaqa before retrying.`;
      }
      return `Layered istihal failed (${result.errorType}): ${result.error}`;
    }

    const codex = await git.farAlAsasi();

    return `Layered istihal complete.

Jawhar: ${jawharBranch}
Parent jawhar: ${parentJawhar}
Buwtaqa: ${result.buwtaqa}
Ahjar transmuted: ${result.adadAhjar}

Next: Use mun_fasl to create the risala (base on parent jawhar).

NOTE: Risala may be unstable until parent jawhar inscribes.
When parent inscribes, use mun_istihal to re-transmute onto ${codex}.`;
  }
}

/**
 * Create an IPC processor instance
 */
export function istadaaMunaffidh(deps: MunaffidhDeps): Munaffidh {
  return new Munaffidh(deps);
}
