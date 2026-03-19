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

interface SiyaqKhadim {
  tasmim: TasmimIksir;
  opencode: ReturnType<typeof createOpenCodeClient>;
  ntfy: ReturnType<typeof anshaaNtfyAmil>;
  telegram: ReturnType<typeof anshaaTelegramAmil>;
  rasul: TelegramMessenger;
  mutabiWasfa: MutabiWasfa;
  github: ReturnType<typeof createGitHubClient>;
  mudirJalasat: ReturnType<typeof istadaaKatib>;
  munaffidh: ReturnType<typeof istadaaMunaffidh>;
  munadi: ReturnType<typeof istadaaMunadi>;
  hayat: ReturnType<typeof awqadaHayat>;
  sail: ReturnType<typeof istadaaSail>;
  raqib: ReturnType<typeof istadaaRaqib>;
  mutahakkimIlgha: AbortController;
}

async function tahaqqaqIttisaal(ctx: SiyaqKhadim): Promise<boolean> {
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

  if (ctx.tasmim.isharat.telegram.mufattah) {
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

  if (ctx.tasmim.isharat.ntfy.mufattah) {
    process.stdout.write("  ntfy server... ");
    try {
      const response = await fetch(ctx.tasmim.isharat.ntfy.server);
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

  if (ctx.tasmim.mutabiWasfa.miftahApi) {
    process.stdout.write("  Issue tracker... ");
    const authenticated = await ctx.mutabiWasfa.isAuthenticated();
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

async function naffadhFahs(ctx: SiyaqKhadim): Promise<void> {
  console.log(`\nIksir v${VERSION} - Configuration Check\n`);
  console.log(`Config file: ${masarMilafAlTasmim()}`);

  console.log("\nConfiguration:");
  console.log(`  OpenCode server: ${ctx.tasmim.opencode.server}`);

  console.log(`  Quiet hours: ${ctx.tasmim.saatSukun.bidaya} - ${ctx.tasmim.saatSukun.nihaya} (${ctx.tasmim.saatSukun.mintaqaZamaniyya})`);

  const allGood = await tahaqqaqIttisaal(ctx);

  if (allGood) {
    console.log("All checks passed! ✓\n");
  } else {
    console.log("Some checks failed. Review the configuration.\n");
    Deno.exit(1);
  }
}

async function addaIsharat(ctx: SiyaqKhadim): Promise<void> {
  const ighlaaq = async (signal: string) => {
    await logger.akhbar("main", `Received ${signal}, shutting down...`);

    ctx.mutahakkimIlgha.abort();
    ctx.telegram.stopPolling();
    ctx.munaffidh.awqafMuaalaja();
    ctx.raqib.awqaf();

    await logger.akhbar("main", "Saving state...");
    await Promise.all([
      ctx.mudirJalasat.hafizaHala(),
      ctx.munaffidh.hafizaHala(),
      ctx.sail.hafizaHala(),
    ]);

    aghlaaqQaidatBayanat();

    await logger.akhbar("main", "Shutdown complete");
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
async function ishtarakAhdath(ctx: SiyaqKhadim): Promise<void> {
  await logger.akhbar("sse", "Starting OpenCode SSE subscription");

  let backoffMs = INITIAL_BACKOFF_MS;
  

  while (!ctx.mutahakkimIlgha.signal.aborted) {
    try {
      for await (const event of ctx.opencode.subscribeToEvents(ctx.mutahakkimIlgha.signal)) {
        backoffMs = INITIAL_BACKOFF_MS;

        if (event.type === "question.asked") {
          const questionEvent = event as unknown as HadathSualMatlub;
          await ctx.sail.aalajSualMatlub(questionEvent);
        }

        if (event.type === "session.compacted") {
          const sessionId = (event.properties as { sessionID?: string })?.sessionID;
          if (sessionId) {
            ctx.mudirJalasat.aalajaDamj(sessionId).catch(async (e) =>
              await logger.sajjalKhata("sse", "Failed to handle compaction event", {
                sessionId,
                error: String(e),
              })
            );
          }
        }
      }
    } catch (error) {
      if (ctx.mutahakkimIlgha.signal.aborted) {
        break;
      }
      await logger.haDHHir("sse", `SSE connection lost, reconnecting in ${backoffMs / 1000}s`, {
        error: String(error),
      });
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  await logger.akhbar("sse", "OpenCode SSE subscription stopped");
}

async function awqadKhadim(ctx: SiyaqKhadim): Promise<void> {
  await logger.akhbar("main", `Iksir v${VERSION} starting`);
  await logger.akhbar("main", `Config loaded from ${masarMilafAlTasmim()}`);

  /** Check OpenCode connectivity */
  const healthy = await ctx.opencode.isHealthy();
  if (!healthy) {
    await logger.sajjalKhata("main", "OpenCode server is not reachable, aborting");
    Deno.exit(1);
  }

  const version = await ctx.opencode.getVersion();
  await logger.akhbar("main", `Connected to OpenCode v${version}`);

  await addaIsharat(ctx);

  if (ctx.tasmim.isharat.telegram.mufattah) {
    addaMualijatTelegram(ctx);
    ctx.telegram.startPolling().catch(async (error) => {
      await logger.sajjalKhata("telegram", "Polling error", { error: String(error) });
    });
  }

  ctx.munaffidh.badaaMuaalaja(ctx.mutahakkimIlgha.signal).catch(async (error) => {
    await logger.sajjalKhata("tool-executor", "Processing error", { error: String(error) });
  });

  ishtarakAhdath(ctx).catch(async (error) => {
    await logger.sajjalKhata("sse", "Event subscription error", { error: String(error) });
  });

  ctx.raqib.badaa(ctx.mutahakkimIlgha.signal);

  await logger.akhbar("main", "Entering main loop (Proactive Game)");

  while (!ctx.mutahakkimIlgha.signal.aborted) {
    try {
      await dawraHayat(ctx);
    } catch (error) {
      await logger.sajjalKhata("main", "Keep-alive cycle error", { error: String(error) });
    }

    await new Promise((resolve) => setTimeout(resolve, ctx.tasmim.istiftaa.fajwatZamaniyya));
  }
}

function addaMualijatTelegram(ctx: SiyaqKhadim): void {
  ctx.telegram.onMessage(async (message) => {
    if (!message.text) return;

    const text = message.text.trim();
    const topicId = ctx.telegram.jalabRisalaTopicId(message);
    const isGroupMessage = ctx.telegram.isGroupMessage(message);
    const isPrivateMessage = ctx.telegram.isPrivateMessage(message);
    const isDispatchTopic = ctx.telegram.isDispatchTopic(message);

    await logger.akhbar("telegram", `Received: ${text.slice(0, 100)}`, {
      topicId,
      isGroupMessage,
      isPrivateMessage,
      isDispatchTopic,
    });

    if (isPrivateMessage) {
      await aalajRisalaKhassa(ctx, message);
      return;
    }

    if (!isGroupMessage) {
      await logger.haDHHir("telegram", "Message from unknown chat type");
      return;
    }

    if (isDispatchTopic) {
      await aalajRisalaMawduu(ctx, text, message.message_id);
      return;
    }

    if (topicId) {
      /** Resolve murshid from channel */
      const murshid = ctx.mudirJalasat.wajadaMurshidBiQanat("telegram", String(topicId));

      if (murshid && ctx.sail.huwaYantazirIdkhal(murshid.huwiyya)) {
        const handled = await ctx.sail.aalajJawabKhass(murshid.huwiyya, text);
        if (handled) {
          await ctx.rasul.send({ murshid: murshid.huwiyya }, "Answer submitted.");
          return;
        }
      }
      
      if (murshid) {
        await logger.akhbar("telegram", `Routing to murshid ${murshid.huwiyya} via topic ${topicId}`);
        
        const success = await ctx.mudirJalasat.arsalaIlaMurshidById(murshid.huwiyya, text);
        if (!success) {
          await ctx.telegram.arsalaIlaMurshidTopic(
            topicId,
            `Failed to send message to murshid ${murshid.huwiyya}.`
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

    await logger.haDHHir("telegram", "Group message without topic ID");
  });

  ctx.telegram.onCallback(async (query) => {
    await logger.akhbar("telegram", `Callback: ${query.data}`);

    if (query.data && ctx.sail.huwaIstijabaZirrSual(query.data)) {
      const parsed = ctx.sail.hallalIstijabaZirrSual(query.data);
      if (parsed) {
        if (parsed.selectedLabel === "__custom__") {
          /** Resolve murshid from the topic */
          const topicId = query.message?.message_thread_id;
          const murshid = topicId
            ? ctx.mudirJalasat.wajadaMurshidBiQanat("telegram", String(topicId))
            : null;
          if (murshid) {
            await ctx.sail.allamIntizarIdkhal(murshid.huwiyya, parsed.questionId);
            await ctx.telegram.answerCallback(query.id, "Type your answer as a reply...");
          } else {
            await ctx.telegram.answerCallback(query.id, "Cannot resolve murshid for custom input");
          }
          return;
        }

        /** Handle option selection */
        const success = await ctx.sail.aalajIstijabaZirrSual(
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
      const result = await ctx.munadi.aalajIstijabaZirr("telegram", query.data);
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
    const murshid = ctx.mudirJalasat.wajadaMurshidFaail();
    if (murshid && query.data) {
      await ctx.mudirJalasat.arsalaIlaMurshid(
        `Al-Kimyawi selected option: ${query.data}`
      );
    }
  });
}

/**
 * Handle private chat messages - list sessions, direct to group
 */
async function aalajRisalaKhassa(
  ctx: SiyaqKhadim,
  _message: { text?: string; message_id: number }
): Promise<void> {
  const sessions = ctx.mudirJalasat.wajadaJalasatMurshid();
  
  let response = "**Sessions**\n\n";
  
  if (sessions.length === 0) {
    response += "No active murshid sessions.\n\n";
  } else {
    for (const session of sessions) {
      const statusEmoji = session.hala === "fail" ? "🟢" : 
                          session.hala === "masdud" ? "🔴" : 
                          session.hala === "muntazir" ? "🟡" : "⚪";
      response += `${statusEmoji} **${session.huwiyya}** (${session.naw})\n`;
      response += `   ${session.unwan}\n`;
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
async function aalajRisalaMawduu(
  ctx: SiyaqKhadim,
  text: string,
  messageId: number
): Promise<void> {
  /** Check for ticket URLs first */
  const ticketUrlMatch = text.match(ctx.mutabiWasfa.getUrlPattern());
  if (ticketUrlMatch) {
    await aalajRabitWasfa(ctx, ticketUrlMatch[0], text);
    return;
  }

  if (text.startsWith("/")) {
    await aalajAmrMunadi(ctx, text);
    return;
  }

  ctx.munadi.aalajRisalaIrsal({
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
    await logger.sajjalKhata("main", "Dispatch handler failed", { error: String(error) });
    await ctx.telegram.sendToDispatch("Internal error processing your message.");
  });
}

/**
 * Handle slash commands in Dispatch topic
 */
async function aalajAmrMunadi(ctx: SiyaqKhadim, text: string): Promise<void> {
  const [command, ...args] = text.slice(1).split(" ");

  switch (command.toLowerCase()) {
    case "start":
      if (args.length === 0) {
        await ctx.telegram.sendToDispatch(
          "**Usage:** /start <ticket-url>\n\nProvide a ticket, project, or milestone URL.",
          { parseMode: "Markdown" }
        );
      } else {
        await aalajRabitWasfa(ctx, args[0], args.slice(1).join(" "));
      }
      break;

    case "status":
    case "sessions": {
      /** Delegate to dispatcher — single source of truth for status rendering */
      const result = await ctx.munadi.aalajRisalaIrsal({
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

async function aalajRabitWasfa(ctx: SiyaqKhadim, url: string, additionalContext: string): Promise<void> {
  await ctx.telegram.sendToDispatch(`Analyzing: ${url}`);

  /** Parse URL to extract ticket ID */
  const parsed = ctx.mutabiWasfa.parseUrl(url);
  if (!parsed) {
    await ctx.telegram.sendToDispatch("Could not parse ticket URL.");
    return;
  }

  /** Resolve title from issue tracker */
  let title = parsed.id;
  if (parsed.naw === "wasfa") {
    const issue = await ctx.mutabiWasfa.getIssue(parsed.id);
    if (issue) {
      title = issue.title;
    }
  }

  /**
   * Delegate to dispatcher — goes through the full switch protocol
   * (WIP commit, branch intaqalaIla, interrupt previous session, etc.)
   */
  const result = await ctx.munadi.faaalLiRabitWasfa(
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

async function dawraHayat(ctx: SiyaqKhadim): Promise<void> {
  await logger.tatbeeq("main", "Running keep-alive cycle");

  try {
    await ctx.hayat.dawra();
  } catch (error) {
    await logger.sajjalKhata("main", "Keep-alive cycle error", { error: String(error) });
  }
}


async function aalajDamjRisala(
  ctx: SiyaqKhadim,
  session: JalsatMurshid,
  pr: RisalaMutaba
): Promise<void> {
  await logger.akhbar("main", `PR #${pr.raqamRisala} merged for ${pr.huwiyyatWasfa}`, {
    epicId: session.huwiyya,
  });

  /**
   * Check if any other PRs were stacked on this one (early push / pressure mode)
   * Those PRs need to be re-transmuted via mun_istihal onto codex
   */
  const activePRs = ctx.mudirJalasat.wajadaRasaailFaailaLiMurshid(session.huwiyya);
  const stackedPRs = activePRs.filter(
    (p) => p.hala === "draft" || p.hala === "open"
  );

  let stackedNote = "";
  if (stackedPRs.length > 0) {
    stackedNote = `

**Stacked PRs detected:** ${stackedPRs.length} PR(s) may have been created via early push.
If any were targeting ${pr.far} (layered istihal), they need re-transmuting:

${stackedPRs.map((p) => `- ${p.huwiyyatWasfa} (PR #${p.raqamRisala}): Use \`mun_istihal\` to rebase onto main`).join("\n")}

Re-pushing will fix CI (now that base is on main).`;
  }

  await ctx.mudirJalasat.arsalaIlaMurshidById(session.huwiyya, `## PR Merged - Ready for Next Slice

**PR:** #${pr.raqamRisala}
**Ticket:** ${pr.huwiyyatWasfa}
**Branch:** ${pr.far}

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
      `✅ PR #${pr.raqamRisala} merged\n\nTicket: ${pr.huwiyyatWasfa}\nEpic: ${session.huwiyya}\n\nNext slice may now be disclosed.${stackedMsg}`
    );
  }
}

async function aalajIghlaqRisala(
  ctx: SiyaqKhadim,
  session: JalsatMurshid,
  pr: RisalaMutaba
): Promise<void> {
  await logger.akhbar("main", `PR #${pr.raqamRisala} closed without merge`, {
    epicId: session.huwiyya,
    huwiyyatWasfa: pr.huwiyyatWasfa,
  });

  await ctx.mudirJalasat.arsalaIlaMurshidById(session.huwiyya, `## PR Closed Without Merge

**PR:** #${pr.raqamRisala}
**Ticket:** ${pr.huwiyyatWasfa}

This PR was closed without being merged. Investigate why:
- Was it superseded by another PR?
- Were there blocking issues?
- Should the ticket status be updated?`);
}

async function aalajAmrAlKimyawi(
  ctx: SiyaqKhadim,
  session: JalsatMurshid,
  raqamRisala: number,
  comment: TaaliqMuraja
): Promise<void> {
  await logger.akhbar("main", `Al-Kimyawi command on PR #${raqamRisala}`, {
    epicId: session.huwiyya,
    body: comment.body.slice(0, 100),
  });

  await ctx.mudirJalasat.arsalaIlaMurshidById(session.huwiyya, `## Al-Kimyawi command on PR #${raqamRisala}

${comment.body}

Execute this direction on the epic branch, then update the PR.`);
}

async function aalajTaaliqatJadida(
  ctx: SiyaqKhadim,
  session: JalsatMurshid,
  raqamRisala: number,
  comments: TaaliqMuraja[]
): Promise<void> {
  await logger.akhbar("main", `${comments.length} new review comments on PR #${raqamRisala}`, {
    epicId: session.huwiyya,
    authors: [...new Set(comments.map((c) => c.author))],
  });

  /** Forward to the owning murshid */
  const commentText = comments
    .map((c) => `- @${c.author}: "${c.body.slice(0, 100)}${c.body.length > 100 ? "..." : ""}"`)
    .join("\n");

  await ctx.mudirJalasat.arsalaIlaMurshidById(session.huwiyya, `## New Review Comments on PR #${raqamRisala}

${commentText}

Analyze intent per command protocol:
- Commands from reviewers? Don't auto-implement, queue for muraja'at al-Kimyawi
- Suggestions? Note them, await tawjih al-Kimyawi
- Questions? Consider if you can answer or need al-Kimyawi`);
}

async function aalajTaarudRisala(
  ctx: SiyaqKhadim,
  session: JalsatMurshid,
  pr: RisalaMutaba
): Promise<void> {
  await logger.haDHHir("main", `PR #${pr.raqamRisala} has conflicts`, {
    epicId: session.huwiyya,
    huwiyyatWasfa: pr.huwiyyatWasfa,
  });

  await ctx.mudirJalasat.arsalaIlaMurshidById(session.huwiyya, `## PR Has Merge Conflicts

**PR:** #${pr.raqamRisala}
**Ticket:** ${pr.huwiyyatWasfa}

The PR has conflicts with the base branch. Options:
1. Resolve during quiet hours maintenance (if minor)
2. Resolve now in buwtaqa, then re-transmute with \`mun_istihal\`
3. Notify al-Kimyawi if conflicts are complex`);
}

async function aalajFashalFahs(
  ctx: SiyaqKhadim,
  session: JalsatMurshid,
  pr: RisalaMutaba
): Promise<void> {
  await logger.haDHHir("main", `PR #${pr.raqamRisala} CI failing`, {
    epicId: session.huwiyya,
    huwiyyatWasfa: pr.huwiyyatWasfa,
  });

  await ctx.mudirJalasat.arsalaIlaMurshidById(session.huwiyya, `## CI Checks Failing

**PR:** #${pr.raqamRisala}
**Ticket:** ${pr.huwiyyatWasfa}

The PR has failing CI checks. Investigate:
1. Is it a flaky test unrelated to our changes?
2. Did we break something? Fix on epic branch and re-slice
3. Is it a pre-existing issue? Note it but don't block on it`);
}


async function aalajTalabSeyana(ctx: SiyaqKhadim): Promise<boolean> {
  /** Check if any murshid is active */
  const activeId = ctx.munadi.hawiyyaFaila();

  if (activeId) {
    await logger.akhbar("main", `Maintenance mode denied - ${activeId} is active`);
    return false;
  }

  await logger.akhbar("main", "Maintenance mode granted");
  return true;
}

async function aalajTahrirSeyana(_ctx: SiyaqKhadim): Promise<void> {
  await logger.akhbar("main", "Maintenance mode released");
}

async function aalajIktimalSeyana(
  ctx: SiyaqKhadim,
  results: NatijaSeyana[]
): Promise<void> {
  await logger.akhbar("main", "Maintenance complete", {
    total: results.length,
    merged: results.filter((r) => r.fil === "udmija").length,
    conflicts: results.filter((r) => r.fil === "taarudat").length,
  });

  /** Build summary */
  const merged = results.filter((r) => r.fil === "udmija");
  const upToDate = results.filter((r) => r.fil === "muhaddath");
  const conflicts = results.filter((r) => r.fil === "taarudat");
  const errors = results.filter((r) => r.fil === "khata");

  let summary = "## Overnight Maintenance Complete\n\n";

  if (merged.length > 0) {
    summary += `**Merged main into ${merged.length} branch(es):**\n`;
    for (const r of merged) {
      summary += `- \`${r.far}\`: ${r.nass}\n`;
    }
    summary += "\n";
  }

  if (upToDate.length > 0) {
    summary += `**Already up-to-date:** ${upToDate.length} branch(es)\n\n`;
  }

  if (conflicts.length > 0) {
    summary += `**Conflicts detected in ${conflicts.length} branch(es):**\n`;
    for (const r of conflicts) {
      summary += `\n### ${r.huwiyya} (\`${r.far}\`)\n`;
      summary += `${r.iltizamatKhalfa} commit(s) behind main\n`;
      summary += `\n**Conflicting files:**\n`;
      for (const f of r.taarudat ?? []) {
        summary += `- \`${f}\`\n`;
      }
      summary += `\n**Suggestion:** Resolve manually when active, then \`mun_istihal\` to refresh risalat.\n`;
    }
    summary += "\n";
  }

  if (errors.length > 0) {
    summary += `**Errors in ${errors.length} branch(es):**\n`;
    for (const r of errors) {
      summary += `- \`${r.far}\`: ${r.nass}\n`;
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
        telegramMsg += `  - ${r.huwiyya}: ${r.taarudat?.length ?? 0} file(s)\n`;
      }
    }
    if (errors.length > 0) telegramMsg += `❌ Errors: ${errors.length}\n`;

    await ctx.telegram.arsalaRisala(telegramMsg);
  }

  for (const r of conflicts) {
    const conflictMsg = `## Overnight Maintenance: Conflicts Detected

Your branch \`${r.far}\` has conflicts with main.

**${r.iltizamatKhalfa} commit(s) behind main**

**Conflicting files:**
${(r.taarudat ?? []).map((f) => `- \`${f}\``).join("\n")}

**Action required:** When you become active, resolve these conflicts manually, then use \`mun_istihal\` to refresh any open risalat.`;

    await ctx.mudirJalasat.arsalaIlaMurshidById(r.huwiyya, conflictMsg);
  }
}


/**
 * Build a Telegram inline keyboard for a question.
 * Wraps question-handler's buildInlineKeyboard to create Telegram-specific markup.
 */
function banaLawhatSual(
  handler: ReturnType<typeof istadaaSail>,
  questionId: string,
  question: MaalumatSual,
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  return handler.banaMafatihSatriyya(questionId, question);
}


export const VERSION = "0.2.0";

export async function abda(opts: { check?: boolean } = {}): Promise<void> {
  await logger.baddaa();

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
  const sessionManager = istadaaKatib({ tasmim: config, opencode, rasul: messenger });
  await sessionManager.hammalaHala();

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
  await ipcProcessor.hammalaHala();

  /** Initialize intent resolver */
  const intentResolver = istadaaArraf({ mutabiWasfa: issueTracker, opencode });

  /** Initialize dispatcher */
  const dispatcher = istadaaMunadi({
    sessionManager,
    intentResolver,
    messenger,
    ticketPattern: config.mutabiWasfa?.namatWasfa,
  });

  ipcProcessor.wadaaMunadi(dispatcher);

  await dispatcher.istarjaaIndaNashaat();

  /** Initialize question handler (for question tool events from murshids) */
  const questionHandler = istadaaSail({
    opencode,
    messenger,
    sessionManager,
  });
  await questionHandler.hammalaHala();

  questionHandler.wadaaIndaTahwilSual(async (pending: SualMuallaq, question: MaalumatSual) => {
    const keyboard = banaLawhatSual(questionHandler, pending.id, question);
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
    rasul: messenger,
    mudirJalasat: sessionManager,
  });

  /** Create context (partial, keepAlive added after) */
  const ctx: SiyaqKhadim = {
    tasmim: config,
    opencode,
    ntfy,
    telegram,
    rasul: messenger,
    mutabiWasfa: issueTracker,
    github,
    mudirJalasat: sessionManager,
    munaffidh: ipcProcessor,
    munadi: dispatcher,
    hayat: null as unknown as ReturnType<typeof awqadaHayat>,
    sail: questionHandler,
    raqib: healthMonitor,
    mutahakkimIlgha: abortController,
  };

  /**
   * Initialize keep-alive loop (Proactive Game)
   * Monitors PRs for merge detection (next PR cycle) and comment interpretation
   */
  const keepAlive = awqadaHayat(
    {
      tasmim: config,
      mudirJalasat: sessionManager,
      github,
    },
    {
      indaDamjRisala: async (session, pr) => {
        await aalajDamjRisala(ctx, session, pr);
      },
      indaIghlaqRisala: async (session, pr) => {
        await aalajIghlaqRisala(ctx, session, pr);
      },
      indaAmrAlKimyawi: async (session, raqamRisala, comment) => {
        await aalajAmrAlKimyawi(ctx, session, raqamRisala, comment);
      },
      indaTaaliqatJadida: async (session, raqamRisala, comments) => {
        await aalajTaaliqatJadida(ctx, session, raqamRisala, comments);
      },
      indaTaarudRisala: async (session, pr) => {
        await aalajTaarudRisala(ctx, session, pr);
      },
      indaFashalFahs: async (session, pr) => {
        await aalajFashalFahs(ctx, session, pr);
      },
      utlubWadaSeyana: async () => {
        return await aalajTalabSeyana(ctx);
      },
      harrarWadaSeyana: async () => {
        await aalajTahrirSeyana(ctx);
      },
      indaIktimalSeyana: async (results) => {
        await aalajIktimalSeyana(ctx, results);
      },
    }
  );

  ctx.hayat = keepAlive;

  if (opts.check) {
    await naffadhFahs(ctx);
    return;
  }

  await awqadKhadim(ctx);
}

if (import.meta.main) {
  const check = Deno.args.includes("--check");
  abda({ check }).catch(async (error) => {
    await logger.sajjalKhata("main", "Fatal error", { error: String(error) });
    console.error("Fatal error:", error);
    Deno.exit(1);
  });
}
