/**
 * Iksir Daemon - Autonomous Agent Tansiq
 *
 * Main entry point for the Iksir daemon.
 * 
 * Architecture:
 * - MudirJalasat: Manages murshid OpenCode sessions
 * - Munaffidh: Executes PM-MCP tool calls via Linear/GitHub APIs
 * - Telegram: Routes human messages to murshid session
 * - KeepAlive: Polls for external changes, feeds to murshid
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
import { hammalaAlTasmim, masarMilafAlTasmim } from "./config.ts";
import { 
  INITIAL_BACKOFF_MS, 
  MAX_BACKOFF_MS
} from "./constants.ts";

import { baddaaQaidatBayanat, aghlaaqQaidatBayanat, haddathaHuwiyyatRisalaSual } from "../db/db.ts";
import { createOpenCodeClient } from "./opencode/client.ts";
import { anshaaNtfyAmil } from "./notifications/ntfy.ts";
import { anshaaTelegramAmil } from "./notifications/telegram.ts";
import { anshaaTelegramRasul, type TelegramMessenger } from "./notifications/messenger.ts";
import { createLinearClient } from "./linear/client.ts";
import { createGitHubClient } from "./github/gh.ts";
import { istadaaKatib } from "./daemon/katib.ts";
import { istadaaMunaffidh } from "./daemon/munaffidh.ts";
import { istadaaMunadi } from "./daemon/munadi.ts";
import { istadaaArraf } from "./daemon/arraf.ts";
import { awqadaHayat, type NatijaSeyana } from "./daemon/hayat.ts";
import { istadaaSail } from "./daemon/sail.ts";
import { istadaaRaqib } from "./daemon/raqib.ts";
import type { TasmimIksir, TaaliqMuraja, JalsatMurshid, RisalaMutaba, HadathSualMatlub, MaalumatSual, SualMuallaq, MutabiWasfa } from "./types.ts";

interface DaemonContext {
  config: TasmimIksir;
  opencode: ReturnType<typeof createOpenCodeClient>;
  ntfy: ReturnType<typeof anshaaNtfyAmil>;
  telegram: ReturnType<typeof anshaaTelegramAmil>;
  messenger: TelegramMessenger;
  issueTracker: MutabiWasfa;
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

  process.stdout.write("  OpenCode server... ");
  const opencodeHealthy = await ctx.opencode.isHealthy();
  if (opencodeHealthy) {
    const version = await ctx.opencode.getVersion();
    console.log(`✓ (v${version})`);
  } else {
    console.log("✗ (not reachable)");
    allGood = false;
  }

  if (ctx.config.notifications.telegram.enabled) {
    process.stdout.write("  Telegram bot... ");
    const telegramValid = await ctx.telegram.tahaqqaqToken();
    if (telegramValid) {
      console.log("✓");
    } else {
      console.log("✗ (invalid token)");
      allGood = false;
    }
  } else {
    console.log("  Telegram bot... (disabled)");
  }

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
  console.log(`\nIksir v${VERSION} - Configuration Check\n`);
  console.log(`Config file: ${masarMilafAlTasmim()}`);

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
  const ighlaaq = async (signal: string) => {
    await logger.info("main", `Received ${signal}, shutting down...`);

    ctx.abortController.abort();
    ctx.telegram.stopPolling();
    ctx.ipcProcessor.stopProcessing();
    ctx.healthMonitor.stop();

    await logger.info("main", "Saving state...");
    await Promise.all([
      ctx.sessionManager.saveState(),
      ctx.ipcProcessor.saveState(),
      ctx.questionHandler.saveState(),
    ]);

    aghlaaqQaidatBayanat();

    await logger.info("main", "Shutdown complete");
    Deno.exit(0);
  };

  const handleSignal = (signal: string) => {
    ighlaaq(signal).catch((error) => {
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
async function subscribeToHadathOpenCodes(ctx: DaemonContext): Promise<void> {
  await logger.info("sse", "Starting OpenCode SSE subscription");

  let backoffMs = INITIAL_BACKOFF_MS;
  

  while (!ctx.abortController.signal.aborted) {
    try {
      for await (const event of ctx.opencode.subscribeToEvents(ctx.abortController.signal)) {
        backoffMs = INITIAL_BACKOFF_MS;

        if (event.type === "question.asked") {
          const questionEvent = event as unknown as HadathSualMatlub;
          await ctx.questionHandler.handleQuestionAsked(questionEvent);
        }

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
  await logger.info("main", `Iksir v${VERSION} starting`);
  await logger.info("main", `Config loaded from ${masarMilafAlTasmim()}`);

  /** Check OpenCode connectivity */
  const healthy = await ctx.opencode.isHealthy();
  if (!healthy) {
    await logger.error("main", "OpenCode server is not reachable, aborting");
    Deno.exit(1);
  }

  const version = await ctx.opencode.getVersion();
  await logger.info("main", `Connected to OpenCode v${version}`);

  await setupSignalHandlers(ctx);

  if (ctx.config.notifications.telegram.enabled) {
    setupTelegramHandlers(ctx);
    ctx.telegram.startPolling().catch(async (error) => {
      await logger.error("telegram", "Polling error", { error: String(error) });
    });
  }

  ctx.ipcProcessor.startProcessing(ctx.abortController.signal).catch(async (error) => {
    await logger.error("tool-executor", "Processing error", { error: String(error) });
  });

  subscribeToHadathOpenCodes(ctx).catch(async (error) => {
    await logger.error("sse", "Event subscription error", { error: String(error) });
  });

  ctx.healthMonitor.start(ctx.abortController.signal);

  await logger.info("main", "Entering main loop (Proactive Game)");

  while (!ctx.abortController.signal.aborted) {
    try {
      await keepAliveCycle(ctx);
    } catch (error) {
      await logger.error("main", "Keep-alive cycle error", { error: String(error) });
    }

    await new Promise((resolve) => setTimeout(resolve, ctx.config.polling.defaultIntervalMs));
  }
}

function setupTelegramHandlers(ctx: DaemonContext): void {
  ctx.telegram.onMessage(async (message) => {
    if (!message.text) return;

    const text = message.text.trim();
    const topicId = ctx.telegram.jalabRisalaTopicId(message);
    const isGroupMessage = ctx.telegram.isGroupMessage(message);
    const isPrivateMessage = ctx.telegram.isPrivateMessage(message);
    const isDispatchTopic = ctx.telegram.isDispatchTopic(message);

    await logger.info("telegram", `Received: ${text.slice(0, 100)}`, {
      topicId,
      isGroupMessage,
      isPrivateMessage,
      isDispatchTopic,
    });

    if (isPrivateMessage) {
      await handlePrivateChatMessage(ctx, message);
      return;
    }

    if (!isGroupMessage) {
      await logger.warn("telegram", "Message from unknown chat type");
      return;
    }

    if (isDispatchTopic) {
      await handleDispatchTopicMessage(ctx, text, message.message_id);
      return;
    }

    if (topicId) {
      /** Resolve murshid from channel */
      const murshid = ctx.sessionManager.wajadaMurshidBiQanat("telegram", String(topicId));

      if (murshid && ctx.questionHandler.isAwaitingCustomInput(murshid.identifier)) {
        const handled = await ctx.questionHandler.handlePotentialCustomAnswer(murshid.identifier, text);
        if (handled) {
          await ctx.messenger.send({ murshid: murshid.identifier }, "Answer submitted.");
          return;
        }
      }
      
      if (murshid) {
        await logger.info("telegram", `Routing to murshid ${murshid.identifier} via topic ${topicId}`);
        
        const success = await ctx.sessionManager.arsalaIlaMurshidById(murshid.identifier, text);
        if (!success) {
          await ctx.telegram.arsalaIlaMurshidTopic(
            topicId,
            `Failed to send message to murshid ${murshid.identifier}.`
          );
        }
        return;
      }
      
      if (topicId === 1) {
        await ctx.telegram.arsalaRisala(
          "Use the **Dispatch** topic to send Linear URLs and spawn murshids.",
          { topicId: 1, chatId: ctx.telegram.getGroupId(), parseMode: "Markdown" }
        );
      } else {
        await ctx.telegram.arsalaRisala(
          "This topic is not linked to an active murshid.",
          { topicId, chatId: ctx.telegram.getGroupId() }
        );
      }
      return;
    }

    await logger.warn("telegram", "Group message without topic ID");
  });

  ctx.telegram.onCallback(async (query) => {
    await logger.info("telegram", `Callback: ${query.data}`);

    if (query.data && ctx.questionHandler.isQuestionCallback(query.data)) {
      const parsed = ctx.questionHandler.parseQuestionCallback(query.data);
      if (parsed) {
        if (parsed.selectedLabel === "__custom__") {
          /** Resolve murshid from the topic */
          const topicId = query.message?.message_thread_id;
          const murshid = topicId
            ? ctx.sessionManager.wajadaMurshidBiQanat("telegram", String(topicId))
            : null;
          if (murshid) {
            await ctx.questionHandler.markAwaitingCustomInput(murshid.identifier, parsed.questionId);
            await ctx.telegram.answerCallback(query.id, "Type your answer as a reply...");
          } else {
            await ctx.telegram.answerCallback(query.id, "Cannot resolve murshid for custom input");
          }
          return;
        }

        /** Handle option selection */
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

    await ctx.telegram.answerCallback(query.id, "Received!");

    /** Forward to murshid as a decision */
    const murshid = ctx.sessionManager.wajadaMurshidFaail();
    if (murshid && query.data) {
      await ctx.sessionManager.arsalaIlaMurshid(
        `Al-Kimyawi selected option: ${query.data}`
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
  const sessions = ctx.sessionManager.wajadaJalasatMurshid();
  
  let response = "**Sessions**\n\n";
  
  if (sessions.length === 0) {
    response += "No active murshid sessions.\n\n";
  } else {
    for (const session of sessions) {
      const statusEmoji = session.status === "fail" ? "🟢" : 
                          session.status === "masdud" ? "🔴" : 
                          session.status === "muntazir" ? "🟡" : "⚪";
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
    response += "• **Dispatch** topic: Send ticket URLs to spawn murshids\n";
    response += "• **Murshid topics**: Converse with active sessions\n";
  }
  
  await ctx.telegram.arsalaRisala(response, { 
    parseMode: "Markdown",
    chatId: ctx.telegram.getChatId(),
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
  /** Check for ticket URLs first */
  const ticketUrlMatch = text.match(ctx.issueTracker.getUrlPattern());
  if (ticketUrlMatch) {
    await handleTicketUrl(ctx, ticketUrlMatch[0], text);
    return;
  }

  if (text.startsWith("/")) {
    await handleDispatchCommand(ctx, text);
    return;
  }

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

    await ctx.telegram.sendToDispatch(
      "Send a ticket URL to spawn an murshid, or use /help for commands."
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
      /** Delegate to dispatcher — single source of truth for status rendering */
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

/start <url> - Start murshid for ticket URL
/status - Show active murshid status
/sessions - List all sessions
/help - Show this help

**Usage**
Send a ticket URL to start working on a ticket/project.
Each murshid gets its own topic for conversation.
`, { parseMode: "Markdown" });
      break;

    default:
      await ctx.telegram.sendToDispatch(`Unknown command: /${command}\n\nType /help for available commands.`);
  }
}

async function handleTicketUrl(ctx: DaemonContext, url: string, additionalContext: string): Promise<void> {
  await ctx.telegram.sendToDispatch(`Analyzing: ${url}`);

  /** Parse URL to extract ticket ID */
  const parsed = ctx.issueTracker.parseUrl(url);
  if (!parsed) {
    await ctx.telegram.sendToDispatch("Could not parse ticket URL.");
    return;
  }

  /** Resolve title from issue tracker */
  let title = parsed.id;
  if (parsed.type === "ticket") {
    const issue = await ctx.issueTracker.getIssue(parsed.id);
    if (issue) {
      title = issue.title;
    }
  }

  /**
   * Delegate to dispatcher — goes through the full switch protocol
   * (WIP commit, branch intaqalaIla, interrupt previous session, etc.)
   */
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
    await ctx.keepAlive.cycle();
  } catch (error) {
    await logger.error("main", "Keep-alive cycle error", { error: String(error) });
  }
}


async function handlePRMerged(
  ctx: DaemonContext,
  session: JalsatMurshid,
  pr: RisalaMutaba
): Promise<void> {
  await logger.info("main", `PR #${pr.raqamRisala} merged for ${pr.huwiyyatWasfa}`, {
    epicId: session.identifier,
  });

  /**
   * Check if any other PRs were stacked on this one (early push / pressure mode)
   * Those PRs need to be re-transmuted via mun_istihal onto codex
   */
  const activePRs = ctx.sessionManager.wajadaRasaailFaailaLiMurshid(session.identifier);
  const stackedPRs = activePRs.filter(
    (p) => p.status === "draft" || p.status === "open"
  );

  let stackedNote = "";
  if (stackedPRs.length > 0) {
    stackedNote = `

**Stacked PRs detected:** ${stackedPRs.length} PR(s) may have been created via early push.
If any were targeting ${pr.branch} (layered istihal), they need re-transmuting:

${stackedPRs.map((p) => `- ${p.huwiyyatWasfa} (PR #${p.raqamRisala}): Use \`mun_istihal\` to rebase onto main`).join("\n")}

Re-pushing will fix CI (now that base is on main).`;
  }

  await ctx.sessionManager.arsalaIlaMurshidById(session.identifier, `## PR Merged - Ready for Next Slice

**PR:** #${pr.raqamRisala}
**Ticket:** ${pr.huwiyyatWasfa}
**Branch:** ${pr.branch}

This PR has been merged. You can now:
1. Update ${pr.huwiyyatWasfa} status in Linear to "Done"
2. Check \`blocked_by\` relations to see which tickets are now unblocked for the next PR
3. Use \`mun_istihal\` to transmute the next jawhar if appropriate${stackedNote}

Query Linear for the ticket's blocking relations to determine next slice.`);

  if (ctx.telegram.mumakkan()) {
    const stackedMsg = stackedPRs.length > 0 
      ? `\n\n${stackedPRs.length} stacked PR(s) may need re-push.`
      : "";
    await ctx.telegram.arsalaRisala(
      `✅ PR #${pr.raqamRisala} merged\n\nTicket: ${pr.huwiyyatWasfa}\nEpic: ${session.identifier}\n\nNext slice may now be disclosed.${stackedMsg}`
    );
  }
}

async function handlePRClosed(
  ctx: DaemonContext,
  session: JalsatMurshid,
  pr: RisalaMutaba
): Promise<void> {
  await logger.info("main", `PR #${pr.raqamRisala} closed without merge`, {
    epicId: session.identifier,
    huwiyyatWasfa: pr.huwiyyatWasfa,
  });

  await ctx.sessionManager.arsalaIlaMurshidById(session.identifier, `## PR Closed Without Merge

**PR:** #${pr.raqamRisala}
**Ticket:** ${pr.huwiyyatWasfa}

This PR was closed without being merged. Investigate why:
- Was it superseded by another PR?
- Were there blocking issues?
- Should the ticket status be updated?`);
}

async function handleAlKimyawiCommand(
  ctx: DaemonContext,
  session: JalsatMurshid,
  raqamRisala: number,
  comment: TaaliqMuraja
): Promise<void> {
  await logger.info("main", `Al-Kimyawi command on PR #${raqamRisala}`, {
    epicId: session.identifier,
    body: comment.body.slice(0, 100),
  });

  await ctx.sessionManager.arsalaIlaMurshidById(session.identifier, `## Al-Kimyawi command on PR #${raqamRisala}

${comment.body}

Execute this direction on the epic branch, then update the PR.`);
}

async function handleNewTaaliqMurajas(
  ctx: DaemonContext,
  session: JalsatMurshid,
  raqamRisala: number,
  comments: TaaliqMuraja[]
): Promise<void> {
  await logger.info("main", `${comments.length} new review comments on PR #${raqamRisala}`, {
    epicId: session.identifier,
    authors: [...new Set(comments.map((c) => c.author))],
  });

  /** Forward to the owning murshid */
  const commentText = comments
    .map((c) => `- @${c.author}: "${c.body.slice(0, 100)}${c.body.length > 100 ? "..." : ""}"`)
    .join("\n");

  await ctx.sessionManager.arsalaIlaMurshidById(session.identifier, `## New Review Comments on PR #${raqamRisala}

${commentText}

Analyze intent per command protocol:
- Commands from reviewers? Don't auto-implement, queue for muraja'at al-Kimyawi
- Suggestions? Note them, await tawjih al-Kimyawi
- Questions? Consider if you can answer or need al-Kimyawi`);
}

async function handlePRConflict(
  ctx: DaemonContext,
  session: JalsatMurshid,
  pr: RisalaMutaba
): Promise<void> {
  await logger.warn("main", `PR #${pr.raqamRisala} has conflicts`, {
    epicId: session.identifier,
    huwiyyatWasfa: pr.huwiyyatWasfa,
  });

  await ctx.sessionManager.arsalaIlaMurshidById(session.identifier, `## PR Has Merge Conflicts

**PR:** #${pr.raqamRisala}
**Ticket:** ${pr.huwiyyatWasfa}

The PR has conflicts with the base branch. Options:
1. Resolve during quiet hours maintenance (if minor)
2. Resolve now in buwtaqa, then re-transmute with \`mun_istihal\`
3. Notify al-Kimyawi if conflicts are complex`);
}

async function handleCIFailed(
  ctx: DaemonContext,
  session: JalsatMurshid,
  pr: RisalaMutaba
): Promise<void> {
  await logger.warn("main", `PR #${pr.raqamRisala} CI failing`, {
    epicId: session.identifier,
    huwiyyatWasfa: pr.huwiyyatWasfa,
  });

  await ctx.sessionManager.arsalaIlaMurshidById(session.identifier, `## CI Checks Failing

**PR:** #${pr.raqamRisala}
**Ticket:** ${pr.huwiyyatWasfa}

The PR has failing CI checks. Investigate:
1. Is it a flaky test unrelated to our changes?
2. Did we break something? Fix on epic branch and re-slice
3. Is it a pre-existing issue? Note it but don't block on it`);
}


async function handleMaintenanceModeRequest(ctx: DaemonContext): Promise<boolean> {
  /** Check if any murshid is active */
  const activeId = ctx.dispatcher.hawiyyaFaila();

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
  results: NatijaSeyana[]
): Promise<void> {
  await logger.info("main", "Maintenance complete", {
    total: results.length,
    merged: results.filter((r) => r.action === "merged").length,
    conflicts: results.filter((r) => r.action === "conflicts").length,
  });

  /** Build summary */
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
      summary += `\n**Suggestion:** Resolve manually when active, then \`mun_istihal\` to refresh risalat.\n`;
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

  if (ctx.telegram.mumakkan()) {
    /** Shorter version for Telegram */
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

    await ctx.telegram.arsalaRisala(telegramMsg);
  }

  for (const r of conflicts) {
    const conflictMsg = `## Overnight Maintenance: Conflicts Detected

Your branch \`${r.branch}\` has conflicts with main.

**${r.commitsBehind} commit(s) behind main**

**Conflicting files:**
${(r.conflicts ?? []).map((f) => `- \`${f}\``).join("\n")}

**Action required:** When you become active, resolve these conflicts manually, then use \`mun_istihal\` to refresh any open risalat.`;

    await ctx.sessionManager.arsalaIlaMurshidById(r.identifier, conflictMsg);
  }
}


/**
 * Build a Telegram inline keyboard for a question.
 * Wraps question-handler's buildInlineKeyboard to create Telegram-specific markup.
 */
function buildQuestionKeyboard(
  handler: ReturnType<typeof istadaaSail>,
  questionId: string,
  question: MaalumatSual,
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return handler.buildInlineKeyboard(questionId, question);
}


export const VERSION = "0.2.0";

export async function startDaemon(opts: { check?: boolean } = {}): Promise<void> {
  await logger.init();

  /** Load configuration */
  const config = await hammalaAlTasmim();

  await baddaaQaidatBayanat();

  /** Initialize clients */
  const opencode = createOpenCodeClient(config);
  const ntfy = anshaaNtfyAmil(config);
  const telegram = anshaaTelegramAmil(config);
  const messenger = anshaaTelegramRasul(telegram);
  const issueTracker = createLinearClient(config);
  const github = createGitHubClient(config);
  const abortController = new AbortController();

  /** Initialize session manager and istarjaa persisted state */
  const sessionManager = istadaaKatib({ config, opencode, messenger });
  await sessionManager.loadState();

  /** Initialize IPC processor and istarjaa persisted state */
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

  /** Initialize intent resolver */
  const intentResolver = istadaaArraf({ issueTracker, opencode });

  /** Initialize dispatcher */
  const dispatcher = istadaaMunadi({
    sessionManager,
    intentResolver,
    messenger,
    ticketPattern: config.issueTracker?.ticketPattern,
  });

  ipcProcessor.wadaaMunadi(dispatcher);

  await dispatcher.istarjaaActiveOnStartup();

  /** Initialize question handler (for question tool events from murshids) */
  const questionHandler = istadaaSail({
    opencode,
    messenger,
    sessionManager,
  });
  await questionHandler.loadState();

  questionHandler.setOnQuestionForwarded(async (pending: SualMuallaq, question: MaalumatSual) => {
    const keyboard = buildQuestionKeyboard(questionHandler, pending.id, question);
    const murshid = sessionManager.jalabMurshid(pending.huwiyyatMurshid);
    const topicId = murshid?.channels["telegram"];
    const messageId = await telegram.arsalaRisala("Use buttons below to answer:", {
      topicId: topicId ? parseInt(topicId, 10) : undefined,
      keyboard,
    });
    if (messageId) {
      pending.telegramMessageId = messageId;
      haddathaHuwiyyatRisalaSual(pending.id, messageId);
    }
  });

  /** Initialize health monitor (session stuck detection + auto-compaction) */
  const healthMonitor = istadaaRaqib({
    opencode,
    messenger,
    sessionManager,
  });

  /** Create context (partial, keepAlive added after) */
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

  /**
   * Initialize keep-alive loop (Proactive Game)
   * Monitors PRs for merge detection (next PR cycle) and comment interpretation
   */
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
      onAlKimyawiCommand: async (session, raqamRisala, comment) => {
        await handleAlKimyawiCommand(ctx, session, raqamRisala, comment);
      },
      onNewTaaliqMurajas: async (session, raqamRisala, comments) => {
        await handleNewTaaliqMurajas(ctx, session, raqamRisala, comments);
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

  await runDaemon(ctx);
}

if (import.meta.main) {
  const check = Deno.args.includes("--check");
  startDaemon({ check }).catch(async (error) => {
    await logger.error("main", "Fatal error", { error: String(error) });
    console.error("Fatal error:", error);
    Deno.exit(1);
  });
}
