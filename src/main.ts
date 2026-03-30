/**
 * Munadi Daemon - Autonomous Agent Orchestration
 *
 * Main entry point for the Munadi daemon.
 * 
 * Architecture:
 * - SessionManager: Manages orchestrator OpenCode sessions
 * - ToolExecutor: Executes PM-MCP tool calls via Linear/GitHub APIs
 * - Telegram: Routes human messages to orchestrator session
 * - KeepAlive: Polls for external changes, feeds to orchestrator
 *
 * Usage:
 *   deno run --allow-all src/main.ts [options]
 *
 * Options:
 *   --help          Show help
 *   --version       Show version
 *   --check         Check configuration and connectivity
 */

import { logger } from "./logging/logger.ts";
import { loadConfig, getConfigPath } from "./config.ts";

import { initDatabase, closeDatabase, updateQuestionTelegramMessageId } from "../db/db.ts";
import { createOpenCodeClient } from "./opencode/client.ts";
import { createNtfyClient } from "./notifications/ntfy.ts";
import { createTelegramClient } from "./notifications/telegram.ts";
import { createTelegramMessenger, type TelegramMessenger } from "./notifications/messenger.ts";
import { createLinearClient } from "./linear/client.ts";
import { createGitHubClient } from "./github/gh.ts";
import { istadaaKatib } from "./daemon/session-manager.ts";
import { istadaaMunaffidh } from "./daemon/tool-executor.ts";
import { istadaaMunadi } from "./daemon/dispatcher.ts";
import { istadaaArraf } from "./daemon/intent-resolver.ts";
import { awqadaHayat, type MaintenanceResult } from "./daemon/keepalive.ts";
import { istadaaSail } from "./daemon/question-handler.ts";
import { istadaaRaqib } from "./daemon/health-monitor.ts";
import type { MunadiConfig, ReviewComment, OrchestratorSession, TrackedPR, QuestionAskedEvent, QuestionInfo, PendingQuestion, IssueTracker } from "./types.ts";

interface DaemonContext {
  config: MunadiConfig;
  opencode: ReturnType<typeof createOpenCodeClient>;
  ntfy: ReturnType<typeof createNtfyClient>;
  telegram: ReturnType<typeof createTelegramClient>;
  messenger: TelegramMessenger;
  issueTracker: IssueTracker;
  github: ReturnType<typeof createGitHubClient>;
  sessionManager: ReturnType<typeof istadaaKatib>;
  ipcProcessor: ReturnType<typeof istadaaMunaffidh>;
  dispatcher: ReturnType<typeof istadaaMunadi>;
  keepAlive: ReturnType<typeof awqadaHayat>;
  questionHandler: ReturnType<typeof istadaaSail>;
  healthMonitor: ReturnType<typeof istadaaRaqib>;
  abortController: AbortController;
}

async function checkConnectivity(ctx: DaemonContext): Promise<boolean> {
  let allGood = true;

  console.log("\nChecking connectivity...\n");

  // OpenCode
  process.stdout.write("  OpenCode server... ");
  const opencodeHealthy = await ctx.opencode.isHealthy();
  if (opencodeHealthy) {
    const version = await ctx.opencode.getVersion();
    console.log(`✓ (v${version})`);
  } else {
    console.log("✗ (not reachable)");
    allGood = false;
  }

  // Telegram
  if (ctx.config.notifications.telegram.enabled) {
    process.stdout.write("  Telegram bot... ");
    const telegramValid = await ctx.telegram.validateToken();
    if (telegramValid) {
      console.log("✓");
    } else {
      console.log("✗ (invalid token)");
      allGood = false;
    }
  } else {
    console.log("  Telegram bot... (disabled)");
  }

  // ntfy
  if (ctx.config.notifications.ntfy.enabled) {
    process.stdout.write("  ntfy server... ");
    try {
      const response = await fetch(ctx.config.notifications.ntfy.server);
      if (response.ok) {
        console.log("✓");
      } else {
        console.log(`✗ (status ${response.status})`);
        allGood = false;
      }
    } catch {
      console.log("✗ (not reachable)");
      allGood = false;
    }
  } else {
    console.log("  ntfy server... (disabled)");
  }

  // Issue Tracker
  if (ctx.config.issueTracker.apiKey) {
    process.stdout.write("  Issue tracker... ");
    const authenticated = await ctx.issueTracker.isAuthenticated();
    if (authenticated) {
      console.log("✓");
    } else {
      console.log("✗ (auth failed)");
      allGood = false;
    }
  } else {
    console.log("  Issue tracker... (not configured)");
  }

  // GitHub
  process.stdout.write("  GitHub CLI... ");
  const ghAuthenticated = await ctx.github.isAuthenticated();
  if (ghAuthenticated) {
    const user = await ctx.github.getCurrentUser();
    console.log(`✓ (${user ?? "unknown"})`);
  } else {
    console.log("✗ (run: gh auth login)");
    allGood = false;
  }

  console.log("");
  return allGood;
}

async function runCheck(ctx: DaemonContext): Promise<void> {
  console.log(`\nMunadi v${VERSION} - Configuration Check\n`);
  console.log(`Config file: ${getConfigPath()}`);

  console.log("\nConfiguration:");
  console.log(`  OpenCode server: ${ctx.config.opencode.server}`);

  console.log(`  Quiet hours: ${ctx.config.quietHours.start} - ${ctx.config.quietHours.end} (${ctx.config.quietHours.timezone})`);

  const allGood = await checkConnectivity(ctx);

  if (allGood) {
    console.log("All checks passed! ✓\n");
  } else {
    console.log("Some checks failed. Review the configuration.\n");
    Deno.exit(1);
  }
}

async function setupSignalHandlers(ctx: DaemonContext): Promise<void> {
  const shutdown = async (signal: string) => {
    await logger.info("main", `Received ${signal}, shutting down...`);

    // Stop all loops
    ctx.abortController.abort();
    ctx.telegram.stopPolling();
    ctx.ipcProcessor.stopProcessing();
    ctx.healthMonitor.stop();

    // Save all state for resumability
    await logger.info("main", "Saving state...");
    await Promise.all([
      ctx.sessionManager.saveState(),
      ctx.ipcProcessor.saveState(),
      ctx.questionHandler.saveState(),
    ]);

    // Close database connection
    closeDatabase();

    await logger.info("main", "Shutdown complete");
    Deno.exit(0);
  };

  const handleSignal = (signal: string) => {
    shutdown(signal).catch((error) => {
      console.error(`Shutdown error: ${error}`);
      Deno.exit(1);
    });
  };

  Deno.addSignalListener("SIGINT", () => handleSignal("SIGINT"));
  Deno.addSignalListener("SIGTERM", () => handleSignal("SIGTERM"));
}

/**
 * Subscribe to OpenCode SSE events and route question events to handler.
 */
async function subscribeToOpenCodeEvents(ctx: DaemonContext): Promise<void> {
  await logger.info("sse", "Starting OpenCode SSE subscription");

  let backoffMs = 5_000;
  const MAX_BACKOFF_MS = 5 * 60_000; // 5 minutes

  while (!ctx.abortController.signal.aborted) {
    try {
      for await (const event of ctx.opencode.subscribeToEvents(ctx.abortController.signal)) {
        // Reset backoff on successful event receipt
        backoffMs = 5_000;

        // Handle question.asked events
        if (event.type === "question.asked") {
          const questionEvent = event as unknown as QuestionAskedEvent;
          await ctx.questionHandler.handleQuestionAsked(questionEvent);
        }

        // Handle session.compacted events — reload diary into compacted sessions
        if (event.type === "session.compacted") {
          const sessionId = (event.properties as { sessionID?: string })?.sessionID;
          if (sessionId) {
            ctx.sessionManager.handleCompaction(sessionId).catch(async (e) =>
              await logger.error("sse", "Failed to handle compaction event", {
                sessionId,
                error: String(e),
              })
            );
          }
        }
      }
    } catch (error) {
      if (ctx.abortController.signal.aborted) {
        break;
      }
      await logger.warn("sse", `SSE connection lost, reconnecting in ${backoffMs / 1000}s`, {
        error: String(error),
      });
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  await logger.info("sse", "OpenCode SSE subscription stopped");
}

async function runDaemon(ctx: DaemonContext): Promise<void> {
  await logger.info("main", `Munadi v${VERSION} starting`);
  await logger.info("main", `Config loaded from ${getConfigPath()}`);

  // Check OpenCode connectivity
  const healthy = await ctx.opencode.isHealthy();
  if (!healthy) {
    await logger.error("main", "OpenCode server is not reachable, aborting");
    Deno.exit(1);
  }

  const version = await ctx.opencode.getVersion();
  await logger.info("main", `Connected to OpenCode v${version}`);

  // Setup signal handlers
  await setupSignalHandlers(ctx);

  // Start Telegram polling
  if (ctx.config.notifications.telegram.enabled) {
    setupTelegramHandlers(ctx);
    ctx.telegram.startPolling().catch(async (error) => {
      await logger.error("telegram", "Polling error", { error: String(error) });
    });
  }

  // Start IPC processor (handles PM-MCP tool execution)
  ctx.ipcProcessor.startProcessing(ctx.abortController.signal).catch(async (error) => {
    await logger.error("tool-executor", "Processing error", { error: String(error) });
  });

  // Start OpenCode SSE subscription (handles question events from orchestrators)
  subscribeToOpenCodeEvents(ctx).catch(async (error) => {
    await logger.error("sse", "Event subscription error", { error: String(error) });
  });

  // Start health monitor (stuck session detection + auto-compaction)
  ctx.healthMonitor.start(ctx.abortController.signal);

  // Main keep-alive loop
  await logger.info("main", "Entering main loop (Proactive Game)");

  while (!ctx.abortController.signal.aborted) {
    try {
      await keepAliveCycle(ctx);
    } catch (error) {
      await logger.error("main", "Keep-alive cycle error", { error: String(error) });
    }

    // Wait for next cycle
    await new Promise((resolve) => setTimeout(resolve, ctx.config.polling.defaultIntervalMs));
  }
}

function setupTelegramHandlers(ctx: DaemonContext): void {
  // Handle text messages - route based on chat type and topic
  ctx.telegram.onMessage(async (message) => {
    if (!message.text) return;

    const text = message.text.trim();
    const topicId = ctx.telegram.getMessageTopicId(message);
    const isGroupMessage = ctx.telegram.isGroupMessage(message);
    const isPrivateMessage = ctx.telegram.isPrivateMessage(message);
    const isDispatchTopic = ctx.telegram.isDispatchTopic(message);

    await logger.info("telegram", `Received: ${text.slice(0, 100)}`, {
      topicId,
      isGroupMessage,
      isPrivateMessage,
      isDispatchTopic,
    });

    // ==========================================================================
    // PRIVATE CHAT: List sessions, don't process commands
    // ==========================================================================
    if (isPrivateMessage) {
      await handlePrivateChatMessage(ctx, message);
      return;
    }

    // ==========================================================================
    // GROUP: Route by topic
    // ==========================================================================
    if (!isGroupMessage) {
      // Unknown source - ignore
      await logger.warn("telegram", "Message from unknown chat type");
      return;
    }

    // DISPATCH TOPIC: Route through dispatcher (Linear URLs, commands)
    if (isDispatchTopic) {
      await handleDispatchTopicMessage(ctx, text, message.message_id);
      return;
    }

    // ORCHESTRATOR TOPIC: Route to the owning orchestrator
    if (topicId) {
      // Resolve orchestrator from channel
      const orchestrator = ctx.sessionManager.getOrchestratorByChannel("telegram", String(topicId));

      // Check if we're awaiting custom input for a question in this orchestrator's channel
      if (orchestrator && ctx.questionHandler.isAwaitingCustomInput(orchestrator.identifier)) {
        const handled = await ctx.questionHandler.handlePotentialCustomAnswer(orchestrator.identifier, text);
        if (handled) {
          await ctx.messenger.send({ orchestrator: orchestrator.identifier }, "Answer submitted.");
          return;
        }
        // If not handled (e.g., question expired), fall through to normal routing
      }
      
      if (orchestrator) {
        await logger.info("telegram", `Routing to orchestrator ${orchestrator.identifier} via topic ${topicId}`);
        
        const success = await ctx.sessionManager.sendToOrchestratorById(orchestrator.identifier, text);
        if (!success) {
          await ctx.telegram.sendToOrchestratorTopic(
            topicId,
            `Failed to send message to orchestrator ${orchestrator.identifier}.`
          );
        }
        return;
      }
      
      // Topic exists but no orchestrator mapped - might be General or orphaned
      if (topicId === 1) {
        // General topic - ignore or send helpful message
        await ctx.telegram.sendMessage(
          "Use the **Dispatch** topic to send Linear URLs and spawn orchestrators.",
          { topicId: 1, chatId: ctx.telegram.getGroupId(), parseMode: "Markdown" }
        );
      } else {
        await ctx.telegram.sendMessage(
          "This topic is not linked to an active orchestrator.",
          { topicId, chatId: ctx.telegram.getGroupId() }
        );
      }
      return;
    }

    // No topic ID - shouldn't happen in a forum group, but handle gracefully
    await logger.warn("telegram", "Group message without topic ID");
  });

  // Handle callback queries (button presses)
  ctx.telegram.onCallback(async (query) => {
    await logger.info("telegram", `Callback: ${query.data}`);

    // Check if this is a question callback (format: q:<questionId>:<selectedLabel>)
    if (query.data && ctx.questionHandler.isQuestionCallback(query.data)) {
      const parsed = ctx.questionHandler.parseQuestionCallback(query.data);
      if (parsed) {
        // Handle custom answer request
        if (parsed.selectedLabel === "__custom__") {
          // Resolve orchestrator from the topic
          const topicId = query.message?.message_thread_id;
          const orchestrator = topicId
            ? ctx.sessionManager.getOrchestratorByChannel("telegram", String(topicId))
            : null;
          if (orchestrator) {
            // Mark this question as awaiting custom text input for this orchestrator
            await ctx.questionHandler.markAwaitingCustomInput(orchestrator.identifier, parsed.questionId);
            await ctx.telegram.answerCallback(query.id, "Type your answer as a reply...");
          } else {
            await ctx.telegram.answerCallback(query.id, "Cannot resolve orchestrator for custom input");
          }
          return;
        }

        // Handle option selection
        const success = await ctx.questionHandler.handleQuestionCallback(
          parsed.questionId,
          parsed.selectedLabel
        );
        
        if (success) {
          await ctx.telegram.answerCallback(query.id, `Selected: ${parsed.selectedLabel}`);
        } else {
          await ctx.telegram.answerCallback(query.id, "Question expired or already answered");
        }
        return;
      }
    }

    // Route dispatcher callbacks (disambiguation, parent suggestion, switch)
    if (query.data && (
      query.data.startsWith("select:") ||
      query.data.startsWith("parent:") ||
      query.data.startsWith("switch:") ||
      query.data === "cancel"
    )) {
      const result = await ctx.dispatcher.handleCallback("telegram", query.data);
      await ctx.telegram.answerCallback(query.id, "Received!");
      if (result.handled) {
        if (result.buttons) {
          const keyboard = {
            inline_keyboard: result.buttons.map((b) => [{ text: b.text, callback_data: b.data }]),
          };
          await ctx.telegram.sendToDispatch(result.response ?? "Choose:", {
            parseMode: "Markdown",
            keyboard,
          });
        } else if (result.response) {
          await ctx.telegram.sendToDispatch(result.response, { parseMode: "Markdown" });
        }
        if (result.error) {
          await ctx.telegram.sendToDispatch(`Error: ${result.error}`);
        }
      }
      return;
    }

    // Default: acknowledge and forward to orchestrator
    await ctx.telegram.answerCallback(query.id, "Received!");

    // Forward to orchestrator as a decision
    const orchestrator = ctx.sessionManager.getActiveOrchestrator();
    if (orchestrator && query.data) {
      await ctx.sessionManager.sendToOrchestrator(
        `Operator selected option: ${query.data}`
      );
    }
  });
}

/**
 * Handle private chat messages - list sessions, direct to group
 */
async function handlePrivateChatMessage(
  ctx: DaemonContext,
  _message: { text?: string; message_id: number }
): Promise<void> {
  const sessions = ctx.sessionManager.getOrchestratorSessions();
  
  let response = "**Sessions**\n\n";
  
  if (sessions.length === 0) {
    response += "No active orchestrator sessions.\n\n";
  } else {
    for (const session of sessions) {
      const statusEmoji = session.status === "active" ? "🟢" : 
                          session.status === "blocked" ? "🔴" : 
                          session.status === "waiting" ? "🟡" : "⚪";
      response += `${statusEmoji} **${session.identifier}** (${session.type})\n`;
      response += `   ${session.title}\n`;
      if (Object.keys(session.channels).length > 0) {
        const channelStr = Object.entries(session.channels).map(([p, id]) => `${p}:${id}`).join(", ");
        response += `   Channels: ${channelStr}\n`;
      }
      response += "\n";
    }
  }
  
  if (ctx.telegram.isGroupMode()) {
    response += "---\n";
    response += "Use the **Telegram group for operations:\n";
    response += "• **Dispatch** topic: Send ticket URLs to spawn orchestrators\n";
    response += "• **Orchestrator topics**: Converse with active sessions\n";
  }
  
  await ctx.telegram.sendMessage(response, { 
    parseMode: "Markdown",
    chatId: ctx.telegram.getChatId(),  // Explicit private chat
  });
}

/**
 * Handle messages in the Dispatch topic - Linear URLs, commands
 */
async function handleDispatchTopicMessage(
  ctx: DaemonContext,
  text: string,
  messageId: number
): Promise<void> {
  // Check for ticket URLs first
  const ticketUrlMatch = text.match(ctx.issueTracker.getUrlPattern());
  if (ticketUrlMatch) {
    await handleTicketUrl(ctx, ticketUrlMatch[0], text);
    return;
  }

  // Check for slash commands
  if (text.startsWith("/")) {
    await handleDispatchCommand(ctx, text);
    return;
  }

  // Route through dispatcher's dispatch-specific handler (always uses intent resolver)
  // Fire-and-forget to avoid blocking the Telegram event loop
  ctx.dispatcher.handleDispatchMessage({
    source: "telegram",
    text,
    messageId,
  }).then(async (result) => {
    if (result.handled) {
      if (result.response) {
        await ctx.telegram.sendToDispatch(result.response, { parseMode: "Markdown" });
      }
      if (result.error) {
        await ctx.telegram.sendToDispatch(`Error: ${result.error}`);
      }
      if (result.buttons) {
        const keyboard = {
          inline_keyboard: result.buttons.map((b) => [{ text: b.text, callback_data: b.data }]),
        };
        await ctx.telegram.sendToDispatch(result.response ?? "Choose:", {
          parseMode: "Markdown",
          keyboard,
        });
      }
      return;
    }

    // Fallback
    await ctx.telegram.sendToDispatch(
      "Send a ticket URL to spawn an orchestrator, or use /help for commands."
    );
  }).catch(async (error) => {
    await logger.error("main", "Dispatch handler failed", { error: String(error) });
    await ctx.telegram.sendToDispatch("Internal error processing your message.");
  });
}

/**
 * Handle slash commands in Dispatch topic
 */
async function handleDispatchCommand(ctx: DaemonContext, text: string): Promise<void> {
  const [command, ...args] = text.slice(1).split(" ");

  switch (command.toLowerCase()) {
    case "start":
      if (args.length === 0) {
        await ctx.telegram.sendToDispatch(
          "**Usage:** /start <ticket-url>\n\nProvide a ticket, project, or milestone URL.",
          { parseMode: "Markdown" }
        );
      } else {
        await handleTicketUrl(ctx, args[0], args.slice(1).join(" "));
      }
      break;

    case "status":
    case "sessions": {
      // Delegate to dispatcher — single source of truth for status rendering
      const result = await ctx.dispatcher.handleDispatchMessage({
        source: "telegram",
        text: `/${command}`,
      });
      if (result.response) {
        await ctx.telegram.sendToDispatch(result.response, { parseMode: "Markdown" });
      }
      break;
    }

    case "help":
      await ctx.telegram.sendToDispatch(`**Commands**

/start <url> - Start orchestrator for ticket URL
/status - Show active orchestrator status
/sessions - List all sessions
/help - Show this help

**Usage**
Send a ticket URL to start working on a ticket/project.
Each orchestrator gets its own topic for conversation.
`, { parseMode: "Markdown" });
      break;

    default:
      await ctx.telegram.sendToDispatch(`Unknown command: /${command}\n\nType /help for available commands.`);
  }
}

async function handleTicketUrl(ctx: DaemonContext, url: string, additionalContext: string): Promise<void> {
  await ctx.telegram.sendToDispatch(`Analyzing: ${url}`);

  // Parse URL to extract ticket ID
  const parsed = ctx.issueTracker.parseUrl(url);
  if (!parsed) {
    await ctx.telegram.sendToDispatch("Could not parse ticket URL.");
    return;
  }

  // Resolve title from issue tracker
  let title = parsed.id;
  if (parsed.type === "ticket") {
    const issue = await ctx.issueTracker.getIssue(parsed.id);
    if (issue) {
      title = issue.title;
    }
  }

  // Delegate to dispatcher — goes through the full switch protocol
  // (WIP commit, branch checkout, interrupt previous session, etc.)
  const result = await ctx.dispatcher.activateForTicketUrl(
    parsed.id,
    title,
    url,
    additionalContext || undefined,
  );

  if (result.error) {
    await ctx.telegram.sendToDispatch(result.error);
  } else if (result.response) {
    await ctx.telegram.sendToDispatch(result.response, { parseMode: "Markdown" });
  }
}

async function keepAliveCycle(ctx: DaemonContext): Promise<void> {
  await logger.debug("main", "Running keep-alive cycle");

  try {
    // Run keep-alive loop (polls Linear/GitHub for changes)
    await ctx.keepAlive.cycle();
  } catch (error) {
    await logger.error("main", "Keep-alive cycle error", { error: String(error) });
  }
}

// =============================================================================
// Keep-Alive Callbacks
// =============================================================================

async function handlePRMerged(
  ctx: DaemonContext,
  session: OrchestratorSession,
  pr: TrackedPR
): Promise<void> {
  await logger.info("main", `PR #${pr.prNumber} merged for ${pr.ticketId}`, {
    epicId: session.identifier,
  });

  // Check if any other PRs were stacked on this one (early push / pressure mode)
  // Those PRs need to be re-pushed via pm_ssp to rebase onto main
  const activePRs = ctx.sessionManager.getActivePRsForOrchestrator(session.identifier);
  const stackedPRs = activePRs.filter(
    (p) => p.status === "draft" || p.status === "open"
  );

  let stackedNote = "";
  if (stackedPRs.length > 0) {
    stackedNote = `

**Stacked PRs detected:** ${stackedPRs.length} PR(s) may have been created via early push.
If any were targeting ${pr.branch} (SSSP), they need re-pushing:

${stackedPRs.map((p) => `- ${p.ticketId} (PR #${p.prNumber}): Use \`pm_ssp\` to rebase onto main`).join("\n")}

Re-pushing will fix CI (now that base is on main).`;
  }

  // Notify the owning orchestrator - this paves way for next PR cycle
  await ctx.sessionManager.sendToOrchestratorById(session.identifier, `## PR Merged - Ready for Next Slice

**PR:** #${pr.prNumber}
**Ticket:** ${pr.ticketId}
**Branch:** ${pr.branch}

This PR has been merged. You can now:
1. Update ${pr.ticketId} status in Linear to "Done"
2. Check \`blocked_by\` relations to see which tickets are now unblocked for the next PR
3. Use \`pm_ssp\` to create the next PR if appropriate${stackedNote}

Query Linear for the ticket's blocking relations to determine next slice.`);

  // Notify operator
  if (ctx.telegram.isEnabled()) {
    const stackedMsg = stackedPRs.length > 0 
      ? `\n\n${stackedPRs.length} stacked PR(s) may need re-push.`
      : "";
    await ctx.telegram.sendMessage(
      `✅ PR #${pr.prNumber} merged\n\nTicket: ${pr.ticketId}\nEpic: ${session.identifier}\n\nNext slice may now be disclosed.${stackedMsg}`
    );
  }
}

async function handlePRClosed(
  ctx: DaemonContext,
  session: OrchestratorSession,
  pr: TrackedPR
): Promise<void> {
  await logger.info("main", `PR #${pr.prNumber} closed without merge`, {
    epicId: session.identifier,
    ticketId: pr.ticketId,
  });

  // Notify the owning orchestrator
  await ctx.sessionManager.sendToOrchestratorById(session.identifier, `## PR Closed Without Merge

**PR:** #${pr.prNumber}
**Ticket:** ${pr.ticketId}

This PR was closed without being merged. Investigate why:
- Was it superseded by another PR?
- Were there blocking issues?
- Should the ticket status be updated?`);
}

async function handleOperatorCommand(
  ctx: DaemonContext,
  session: OrchestratorSession,
  prNumber: number,
  comment: ReviewComment
): Promise<void> {
  await logger.info("main", `Operator command on PR #${prNumber}`, {
    epicId: session.identifier,
    body: comment.body.slice(0, 100),
  });

  // Forward to the owning orchestrator for execution
  await ctx.sessionManager.sendToOrchestratorById(session.identifier, `## Operator command on PR #${prNumber}

${comment.body}

Execute this direction on the epic branch, then update the PR.`);
}

async function handleNewReviewComments(
  ctx: DaemonContext,
  session: OrchestratorSession,
  prNumber: number,
  comments: ReviewComment[]
): Promise<void> {
  await logger.info("main", `${comments.length} new review comments on PR #${prNumber}`, {
    epicId: session.identifier,
    authors: [...new Set(comments.map((c) => c.author))],
  });

  // Forward to the owning orchestrator
  const commentText = comments
    .map((c) => `- @${c.author}: "${c.body.slice(0, 100)}${c.body.length > 100 ? "..." : ""}"`)
    .join("\n");

  await ctx.sessionManager.sendToOrchestratorById(session.identifier, `## New Review Comments on PR #${prNumber}

${commentText}

Analyze intent per command protocol:
- Commands from reviewers? Don't auto-implement, queue for operator review
- Suggestions? Note them, await operator direction
- Questions? Consider if you can answer or need operator`);
}

async function handlePRConflict(
  ctx: DaemonContext,
  session: OrchestratorSession,
  pr: TrackedPR
): Promise<void> {
  await logger.warn("main", `PR #${pr.prNumber} has conflicts`, {
    epicId: session.identifier,
    ticketId: pr.ticketId,
  });

  await ctx.sessionManager.sendToOrchestratorById(session.identifier, `## PR Has Merge Conflicts

**PR:** #${pr.prNumber}
**Ticket:** ${pr.ticketId}

The PR has conflicts with the base branch. Options:
1. Resolve during quiet hours maintenance (if minor)
2. Resolve now on epic branch, then re-slice with \`pm_ssp\`
3. Notify operator if conflicts are complex`);
}

async function handleCIFailed(
  ctx: DaemonContext,
  session: OrchestratorSession,
  pr: TrackedPR
): Promise<void> {
  await logger.warn("main", `PR #${pr.prNumber} CI failing`, {
    epicId: session.identifier,
    ticketId: pr.ticketId,
  });

  await ctx.sessionManager.sendToOrchestratorById(session.identifier, `## CI Checks Failing

**PR:** #${pr.prNumber}
**Ticket:** ${pr.ticketId}

The PR has failing CI checks. Investigate:
1. Is it a flaky test unrelated to our changes?
2. Did we break something? Fix on epic branch and re-slice
3. Is it a pre-existing issue? Note it but don't block on it`);
}

// =============================================================================
// Maintenance Mode Callbacks
// =============================================================================

async function handleMaintenanceModeRequest(ctx: DaemonContext): Promise<boolean> {
  // Check if any orchestrator is active
  const activeId = ctx.dispatcher.getActiveIdentifier();

  if (activeId) {
    await logger.info("main", `Maintenance mode denied - ${activeId} is active`);
    return false;
  }

  await logger.info("main", "Maintenance mode granted");
  return true;
}

async function handleMaintenanceModeRelease(_ctx: DaemonContext): Promise<void> {
  await logger.info("main", "Maintenance mode released");
}

async function handleMaintenanceComplete(
  ctx: DaemonContext,
  results: MaintenanceResult[]
): Promise<void> {
  await logger.info("main", "Maintenance complete", {
    total: results.length,
    merged: results.filter((r) => r.action === "merged").length,
    conflicts: results.filter((r) => r.action === "conflicts").length,
  });

  // Build summary
  const merged = results.filter((r) => r.action === "merged");
  const upToDate = results.filter((r) => r.action === "up-to-date");
  const conflicts = results.filter((r) => r.action === "conflicts");
  const errors = results.filter((r) => r.action === "error");

  let summary = "## Overnight Maintenance Complete\n\n";

  if (merged.length > 0) {
    summary += `**Merged main into ${merged.length} branch(es):**\n`;
    for (const r of merged) {
      summary += `- \`${r.branch}\`: ${r.message}\n`;
    }
    summary += "\n";
  }

  if (upToDate.length > 0) {
    summary += `**Already up-to-date:** ${upToDate.length} branch(es)\n\n`;
  }

  if (conflicts.length > 0) {
    summary += `**Conflicts detected in ${conflicts.length} branch(es):**\n`;
    for (const r of conflicts) {
      summary += `\n### ${r.identifier} (\`${r.branch}\`)\n`;
      summary += `${r.commitsBehind} commit(s) behind main\n`;
      summary += `\n**Conflicting files:**\n`;
      for (const f of r.conflicts ?? []) {
        summary += `- \`${f}\`\n`;
      }
      summary += `\n**Suggestion:** Resolve manually when active, then \`pm_ssp\` to refresh PRs.\n`;
    }
    summary += "\n";
  }

  if (errors.length > 0) {
    summary += `**Errors in ${errors.length} branch(es):**\n`;
    for (const r of errors) {
      summary += `- \`${r.branch}\`: ${r.message}\n`;
    }
    summary += "\n";
  }

  // Notify operator via Telegram
  if (ctx.telegram.isEnabled()) {
    // Shorter version for Telegram
    let telegramMsg = "🌙 Overnight Maintenance\n\n";
    if (merged.length > 0) telegramMsg += `✅ Merged: ${merged.length} branches\n`;
    if (upToDate.length > 0) telegramMsg += `✓ Up-to-date: ${upToDate.length}\n`;
    if (conflicts.length > 0) {
      telegramMsg += `⚠️ Conflicts: ${conflicts.length}\n`;
      for (const r of conflicts) {
        telegramMsg += `  - ${r.identifier}: ${r.conflicts?.length ?? 0} file(s)\n`;
      }
    }
    if (errors.length > 0) telegramMsg += `❌ Errors: ${errors.length}\n`;

    await ctx.telegram.sendMessage(telegramMsg);
  }

  // Queue detailed summary for orchestrators with conflicts
  for (const r of conflicts) {
    const conflictMsg = `## Overnight Maintenance: Conflicts Detected

Your branch \`${r.branch}\` has conflicts with main.

**${r.commitsBehind} commit(s) behind main**

**Conflicting files:**
${(r.conflicts ?? []).map((f) => `- \`${f}\``).join("\n")}

**Action required:** When you become active, resolve these conflicts manually, then use \`pm_ssp\` to refresh any open PRs.`;

    await ctx.sessionManager.sendToOrchestratorById(r.identifier, conflictMsg);
  }
}

// =============================================================================
// Question Keyboard Helper (Telegram-specific)
// =============================================================================

/**
 * Build a Telegram inline keyboard for a question.
 * Wraps question-handler's buildInlineKeyboard to create Telegram-specific markup.
 */
function buildQuestionKeyboard(
  handler: ReturnType<typeof istadaaSail>,
  questionId: string,
  question: QuestionInfo,
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return handler.buildInlineKeyboard(questionId, question);
}

// =============================================================================
// Main Entry Point
// =============================================================================

export const VERSION = "0.2.0";

export async function startDaemon(opts: { check?: boolean } = {}): Promise<void> {
  // Initialize logger first
  await logger.init();

  // Load configuration
  const config = await loadConfig();

  // Initialize database (must be first - other components may depend on it)
  await initDatabase();

  // Initialize clients
  const opencode = createOpenCodeClient(config);
  const ntfy = createNtfyClient(config);
  const telegram = createTelegramClient(config);
  const messenger = createTelegramMessenger(telegram);
  const issueTracker = createLinearClient(config);
  const github = createGitHubClient(config);
  const abortController = new AbortController();

  // Initialize session manager and restore persisted state
  const sessionManager = istadaaKatib({ config, opencode, messenger });
  await sessionManager.loadState();

  // Initialize IPC processor and restore persisted state
  const ipcProcessor = istadaaMunaffidh({
    config,
    issueTracker,
    github,
    messenger,
    ntfy,
    sessionManager,
    opencode,
  });
  await ipcProcessor.loadState();

  // Initialize intent resolver
  const intentResolver = istadaaArraf({ issueTracker, opencode });

  // Initialize dispatcher
  const dispatcher = istadaaMunadi({
    config,
    sessionManager,
    intentResolver,
    messenger,
  });

  // Wire dispatcher to IPC processor (for yield/demand_control handling)
  ipcProcessor.setDispatcher(dispatcher);

  // Restore active orchestrator (if any) after daemon restart - checks out branch, sends notification
  await dispatcher.restoreActiveOnStartup();

  // Initialize question handler (for question tool events from orchestrators)
  const questionHandler = istadaaSail({
    opencode,
    messenger,
    sessionManager,
  });
  await questionHandler.loadState();

  // Wire question handler's transport-specific rendering (Telegram inline keyboards)
  questionHandler.setOnQuestionForwarded(async (pending: PendingQuestion, question: QuestionInfo) => {
    const keyboard = buildQuestionKeyboard(questionHandler, pending.id, question);
    const orchestrator = sessionManager.getOrchestrator(pending.orchestratorId);
    const topicId = orchestrator?.channels["telegram"];
    const messageId = await telegram.sendMessage("Use buttons below to answer:", {
      topicId: topicId ? parseInt(topicId, 10) : undefined,
      keyboard,
    });
    if (messageId) {
      pending.telegramMessageId = messageId;
      updateQuestionTelegramMessageId(pending.id, messageId);
    }
  });

  // Initialize health monitor (session stuck detection + auto-compaction)
  const healthMonitor = istadaaRaqib({
    opencode,
    messenger,
    sessionManager,
  });

  // Create context (partial, keepAlive added after)
  const ctx: DaemonContext = {
    config,
    opencode,
    ntfy,
    telegram,
    messenger,
    issueTracker,
    github,
    sessionManager,
    ipcProcessor,
    dispatcher,
    keepAlive: null as unknown as ReturnType<typeof awqadaHayat>,
    questionHandler,
    healthMonitor,
    abortController,
  };

  // Initialize keep-alive loop (Proactive Game)
  // Monitors PRs for merge detection (next PR cycle) and comment interpretation
  const keepAlive = awqadaHayat(
    {
      config,
      sessionManager,
      github,
    },
    {
      onPRMerged: async (session, pr) => {
        await handlePRMerged(ctx, session, pr);
      },
      onPRClosed: async (session, pr) => {
        await handlePRClosed(ctx, session, pr);
      },
      onOperatorCommand: async (session, prNumber, comment) => {
        await handleOperatorCommand(ctx, session, prNumber, comment);
      },
      onNewReviewComments: async (session, prNumber, comments) => {
        await handleNewReviewComments(ctx, session, prNumber, comments);
      },
      onPRConflict: async (session, pr) => {
        await handlePRConflict(ctx, session, pr);
      },
      onCIFailed: async (session, pr) => {
        await handleCIFailed(ctx, session, pr);
      },
      requestMaintenanceMode: async () => {
        return await handleMaintenanceModeRequest(ctx);
      },
      releaseMaintenanceMode: async () => {
        await handleMaintenanceModeRelease(ctx);
      },
      onMaintenanceComplete: async (results) => {
        await handleMaintenanceComplete(ctx, results);
      },
    }
  );

  ctx.keepAlive = keepAlive;

  if (opts.check) {
    await runCheck(ctx);
    return;
  }

  // Run daemon
  await runDaemon(ctx);
}

// Direct execution support (for backwards compat / standalone run)
if (import.meta.main) {
  const check = Deno.args.includes("--check");
  startDaemon({ check }).catch(async (error) => {
    await logger.error("main", "Fatal error", { error: String(error) });
    console.error("Fatal error:", error);
    Deno.exit(1);
  });
}
