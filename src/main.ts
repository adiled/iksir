/**
 * Iksir Daemon - Autonomous Agent Tansiq
 *
 * Main entry point for the Iksir daemon.
 * 
 * Architecture:
 * - MudirJalasat: Manages murshid jalasat at the nest
 * - Munaffidh: Executes mun_* instruments via Linear/GitHub APIs
 * - Rasul: Routes human messages to/from murshid sessions (transport-agnostic)
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
import { createAmilHum } from "./hum/client.ts";
import { masarThrum } from "./hum/thrum.ts";
import { AlatAlIksir } from "./alat/alat-al-iksir.ts";
import { anshaaNtfyAmil } from "./notifications/ntfy.ts";
import { anshaaTelegramAmil } from "./notifications/telegram.ts";
import { anshaaTelegramRasul } from "./notifications/messenger.ts";
import { MutabiWasfaBaid } from "./hum/mutabi-baid.ts";
import { createGitHubClient } from "./github/gh.ts";
import { istadaaKatib } from "./daemon/katib.ts";
import { istadaaMunaffidh } from "./daemon/munaffidh.ts";
import { istadaaMunadi } from "./daemon/munadi.ts";
import { istadaaArraf } from "./daemon/arraf.ts";
import { awqadaHayat, type NatijaSeyana } from "./daemon/hayat.ts";
import { istadaaSaail } from "./daemon/saail.ts";
import { istadaaRaqib } from "./daemon/raqib.ts";
import type { TasmimIksir, Rasul, RisalaDakhila, TaaliqMuraja, JalsatMurshid, RisalaMutaba, HadathSualMatlub, MaalumatSual, SualMuallaq, MutabiWasfa } from "./types.ts";

interface SiyaqKhadim {
  tasmim: TasmimIksir;
  amil: ReturnType<typeof createAmilHum>;
  ntfy: ReturnType<typeof anshaaNtfyAmil>;
  rasul: Rasul;
  mutabiWasfa: MutabiWasfa;
  github: ReturnType<typeof createGitHubClient>;
  mudirJalasat: ReturnType<typeof istadaaKatib>;
  munaffidh: ReturnType<typeof istadaaMunaffidh>;
  munadi: ReturnType<typeof istadaaMunadi>;
  hayat: ReturnType<typeof awqadaHayat>;
  sail: ReturnType<typeof istadaaSaail>;
  raqib: ReturnType<typeof istadaaRaqib>;
  mutahakkimIlgha: AbortController;
}

async function tahaqqaqIttisaal(ctx: SiyaqKhadim): Promise<boolean> {
  let allGood = true;

  console.log("\nChecking connectivity...\n");

  process.stdout.write("  Nest (thrum)... ");
  const nestled = await ctx.amil.isHealthy();
  if (nestled) {
    const version = await ctx.amil.getVersion();
    console.log(`✓ (thrum v${version ?? "?"})`);
  } else {
    console.log("✗ (humd not reachable)");
    allGood = false;
  }

  if (ctx.rasul.mumakkan()) {
    process.stdout.write("  Messenger... ");
    const messengerValid = await ctx.rasul.tahaqqaq();
    if (messengerValid) {
      console.log("✓");
    } else {
      console.log("✗ (validation failed)");
      allGood = false;
    }
  } else {
    console.log("  Messenger... (disabled)");
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
  console.log(`  Thrum socket: ${masarThrum(ctx.tasmim.hum?.miqbas)}`);
  console.log(`  Bee hid: ${ctx.amil.huwiyya}`);
  console.log(`  Model: ${ctx.tasmim.hum?.namudhaj ?? "(the nest decides)"}`);

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
    ctx.rasul.awqaf();
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
 * Drain the ahdath the amil raises from the thrum, routing asila to Sail
 * and curations to Katib.
 */
async function ishtarakAhdath(ctx: SiyaqKhadim): Promise<void> {
  await logger.akhbar("ahdath", "Draining ahdath from the thrum");

  let backoffMs = INITIAL_BACKOFF_MS;
  

  while (!ctx.mutahakkimIlgha.signal.aborted) {
    try {
      for await (const event of ctx.amil.subscribeToEvents(ctx.mutahakkimIlgha.signal)) {
        backoffMs = INITIAL_BACKOFF_MS;

        if (event.type === "question.asked") {
          const questionEvent = event as unknown as HadathSualMatlub;
          await ctx.sail.aalajSualMatlub(questionEvent);
        }

        if (event.type === "session.compacted") {
          const sessionId = (event.properties as { sessionID?: string })?.sessionID;
          if (sessionId) {
            ctx.mudirJalasat.aalajaDamj(sessionId).catch(async (e) =>
              await logger.sajjalKhata("ahdath", "Failed to handle curation event", {
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
      await logger.haDHHir("ahdath", `Ahdath stream faulted, retrying in ${backoffMs / 1000}s`, {
        error: String(error),
      });
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  await logger.akhbar("ahdath", "Ahdath drain stopped");
}

async function awqadKhadim(ctx: SiyaqKhadim): Promise<void> {
  await logger.akhbar("main", `Iksir v${VERSION} starting`);
  await logger.akhbar("main", `Config loaded from ${masarMilafAlTasmim()}`);

  /** Nestle at the humd. Without this the hello never lands and no ada routes. */
  try {
    await ctx.amil.ittasil();
  } catch (error) {
    await logger.sajjalKhata("main", "No humd at the thrum socket, aborting", {
      miqbas: masarThrum(ctx.tasmim.hum?.miqbas),
      error: String(error),
    });
    Deno.exit(1);
  }

  const version = await ctx.amil.getVersion();
  await logger.akhbar("main", `Nestled as ${ctx.amil.huwiyya} (thrum v${version ?? "?"})`);

  await addaIsharat(ctx);

  /** Wire inbound message routing and start the messenger */
  rabatRisalaDakhila(ctx);
  await ctx.rasul.baddaa().catch(async (error) => {
    await logger.sajjalKhata("messenger", "Inbound start error", { error: String(error) });
  });

  ctx.munaffidh.badaaMuaalaja(ctx.mutahakkimIlgha.signal).catch(async (error) => {
    await logger.sajjalKhata("tool-executor", "Processing error", { error: String(error) });
  });

  ishtarakAhdath(ctx).catch(async (error) => {
    await logger.sajjalKhata("ahdath", "Ahdath drain error", { error: String(error) });
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

/**
 * Wire inbound message routing — ctx.rasul.indaRisala() → business logic.
 * The Rasul adapter (messenger.ts) handles transport-specific parsing and
 * emits normalized RisalaDakhila events.
 */
function rabatRisalaDakhila(ctx: SiyaqKhadim): void {
  ctx.rasul.indaRisala(async (risala: RisalaDakhila) => {
    switch (risala.naw) {
      case "murshid": {
        /** Message from a murshid topic */
        const { huwiyya, nass } = risala;

        /** Check if waiting for custom question input */
        if (ctx.sail.huwaYantazirIdkhal(huwiyya)) {
          const handled = await ctx.sail.aalajJawabKhass(huwiyya, nass);
          if (handled) {
            await ctx.rasul.send({ murshid: huwiyya }, "Answer submitted.");
            return;
          }
        }

        /** Route to murshid session */
        await logger.akhbar("inbound", `Routing to murshid ${huwiyya}`);
        const success = await ctx.mudirJalasat.arsalaIlaMurshidById(huwiyya, nass);
        if (!success) {
          await ctx.rasul.send({ murshid: huwiyya }, `Failed to send message to murshid.`);
        }
        break;
      }

      case "irsal": {
        /** Dispatch topic message — ticket URL or free text */
        const { nass, huwiyyatRisala } = risala;

        /** Check for ticket URLs first */
        const ticketUrlMatch = nass.match(ctx.mutabiWasfa.getUrlPattern());
        if (ticketUrlMatch) {
          await aalajRabitWasfa(ctx, ticketUrlMatch[0], nass);
          return;
        }

        /** Route to dispatcher for intent resolution */
        const result = await ctx.munadi.aalajRisalaIrsal({
          source: "telegram",
          text: nass,
          messageId: huwiyyatRisala,
        });

        if (result.tuulija) {
          if (result.buttons) {
            const khiyarat = result.buttons.map((b) => ({ nass: b.text, miftah: b.data }));
            await ctx.rasul.arsalaSualBiKhiyarat("dispatch", result.radd ?? "Choose:", khiyarat);
          } else if (result.radd) {
            await ctx.rasul.send("dispatch", result.radd);
          }
          if (result.khata) {
            await ctx.rasul.send("dispatch", `Error: ${result.khata}`);
          }
        } else {
          await ctx.rasul.send("dispatch", "Send a ticket URL to spawn a murshid, or use /help for commands.");
        }
        break;
      }

      case "amr": {
        /** Slash command from dispatch topic */
        await aalajAmrDakhil(ctx, risala.amr, risala.wusut);
        break;
      }

      case "jawab_sual": {
        /** Question button selection */
        const { huwiyyatSual, taamiyya } = risala;
        /** huwiyyatSual is "short:{8chars}" — extract and resolve */
        const shortId = huwiyyatSual.replace("short:", "");
        const questionId = ctx.sail.hallaIdIstijaba(shortId);
        if (questionId) {
          await ctx.sail.aalajIstijabaZirrSual(questionId, taamiyya);
        }
        break;
      }

      case "idkhal_khass_sual": {
        /** Custom input requested for question */
        const { huwiyyatMurshid, huwiyyatSual } = risala;
        const shortId = huwiyyatSual.replace("short:", "");
        const questionId = ctx.sail.hallaIdIstijaba(shortId);
        if (questionId) {
          await ctx.sail.allamIntizarIdkhal(huwiyyatMurshid, questionId);
        }
        break;
      }

      case "ikhtiyar_munadi": {
        /** Munadi button (select/parent/switch/cancel) */
        const result = await ctx.munadi.aalajIstijabaZirr("telegram", risala.miftah);
        if (result.tuulija) {
          if (result.buttons) {
            const khiyarat = result.buttons.map((b) => ({ nass: b.text, miftah: b.data }));
            await ctx.rasul.arsalaSualBiKhiyarat("dispatch", result.radd ?? "Choose:", khiyarat);
          } else if (result.radd) {
            await ctx.rasul.send("dispatch", result.radd);
          }
          if (result.khata) {
            await ctx.rasul.send("dispatch", `Error: ${result.khata}`);
          }
        }
        break;
      }

      case "khass": {
        /** Private chat — show sessions overview */
        await aalajRisalaKhassa(ctx);
        break;
      }
    }
  });
}

/**
 * Handle private chat messages - list sessions overview
 */
async function aalajRisalaKhassa(ctx: SiyaqKhadim): Promise<void> {
  const sessions = ctx.mudirJalasat.wajadaJalasatMurshid();

  let response = "**Sessions**\n\n";

  if (sessions.length === 0) {
    response += "No active murshid sessions.\n\n";
  } else {
    for (const session of sessions) {
      const statusEmoji =
        session.hala === "fail" ? "🟢" :
        session.hala === "masdud" ? "🔴" :
        session.hala === "muntazir" ? "🟡" : "⚪";
      response += `${statusEmoji} **${session.huwiyya}** (${session.naw})\n`;
      response += `   ${session.unwan}\n`;
      if (Object.keys(session.channels).length > 0) {
        const channelStr = Object.entries(session.channels)
          .map(([p, id]) => `${p}:${id}`)
          .join(", ");
        response += `   Channels: ${channelStr}\n`;
      }
      response += "\n";
    }
  }

  response += "---\n";
  response += "Use **Dispatch** to send ticket URLs and spawn murshids.\n";
  response += "Use **murshid topics** to converse with active sessions.\n";

  await ctx.rasul.send("kimyawi", response);
}

/**
 * Handle slash commands from dispatch topic
 */
async function aalajAmrDakhil(ctx: SiyaqKhadim, amr: string, wusut: string[]): Promise<void> {
  switch (amr.toLowerCase()) {
    case "start":
      if (wusut.length === 0) {
        await ctx.rasul.send("dispatch", "**Usage:** /start <ticket-url>\n\nProvide a ticket, project, or milestone URL.");
      } else {
        await aalajRabitWasfa(ctx, wusut[0], wusut.slice(1).join(" "));
      }
      break;

    case "status":
    case "sessions": {
      const result = await ctx.munadi.aalajRisalaIrsal({
        source: "telegram",
        text: `/${amr}`,
      });
      if (result.radd) {
        await ctx.rasul.send("dispatch", result.radd);
      }
      break;
    }

    case "help":
      await ctx.rasul.send("dispatch", `**Commands**

/start <url> - Start murshid for ticket URL
/status - Show active murshid status
/sessions - List all sessions
/help - Show this help

**Usage**
Send a ticket URL to start working on a ticket/project.
Each murshid gets its own topic for conversation.
`);
      break;

    default:
      await ctx.rasul.send("dispatch", `Unknown command: /${amr}\n\nType /help for available commands.`);
  }
}

async function aalajRabitWasfa(ctx: SiyaqKhadim, url: string, additionalContext: string): Promise<void> {
  await ctx.rasul.send("dispatch", `Analyzing: ${url}`);

  /** Parse URL to extract ticket ID */
  const parsed = ctx.mutabiWasfa.parseUrl(url);
  if (!parsed) {
    await ctx.rasul.send("dispatch", "Could not parse ticket URL.");
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

  if (result.khata) {
    await ctx.rasul.send("dispatch", result.khata);
  } else if (result.radd) {
    await ctx.rasul.send("dispatch", result.radd);
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

  if (ctx.rasul.mumakkan()) {
    const stackedMsg = stackedPRs.length > 0
      ? `\n\n${stackedPRs.length} stacked PR(s) may need re-push.`
      : "";
    await ctx.rasul.send(
      "dispatch",
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

  if (ctx.rasul.mumakkan()) {
    /** Shorter version for messenger */
    let msg = "🌙 Overnight Maintenance\n\n";
    if (merged.length > 0) msg += `✅ Merged: ${merged.length} branches\n`;
    if (upToDate.length > 0) msg += `✓ Up-to-date: ${upToDate.length}\n`;
    if (conflicts.length > 0) {
      msg += `⚠️ Conflicts: ${conflicts.length}\n`;
      for (const r of conflicts) {
        msg += `  - ${r.huwiyya}: ${r.taarudat?.length ?? 0} file(s)\n`;
      }
    }
    if (errors.length > 0) msg += `❌ Errors: ${errors.length}\n`;

    await ctx.rasul.send("dispatch", msg);
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





export const VERSION = "0.2.0";

export async function abda(opts: { check?: boolean } = {}): Promise<void> {
  await logger.baddaa();

  /** Load configuration */
  const config = await hammalaAlTasmim();

  await baddaaQaidatBayanat();

  /**
   * Initialize clients. The amil carries the mun_* adawat into its hello —
   * humd routes a nida by name to whichever hive's manifest declares it,
   * so an unannounced ada is an unreachable one.
   */
  const alat = new AlatAlIksir();
  const amil = createAmilHum(config, alat.adawat());

  /**
   * A nida arrives from the nest, is worked, and its natija returns on the
   * same strand — the cell stays parked until it does. Each instrument
   * inscribes its own hadath as it goes, which Munaffidh drains on its
   * heartbeat. The sijill is the record; the thrum is merely the road.
   */
  amil.alaNida(async (nida) => {
    const natija = await alat.naffidh(nida.name, nida.args);
    amil.raddNida(nida.sid, nida.callId, natija);
  });
  const ntfy = anshaaNtfyAmil(config);
  const telegram = anshaaTelegramAmil(config);
  const messenger = anshaaTelegramRasul(telegram);
  /**
   * The tracker is reached, not held. Its key lives in the wasfa organ,
   * a bee of its own; the entry only knows how to ask. Arraf and Munaffidh
   * see the same interface they always did.
   */
  const issueTracker = new MutabiWasfaBaid(
    amil,
    config.mutabiWasfa?.muqaddim,
    config.mutabiWasfa?.namatWasfa,
  );
  const github = createGitHubClient(config);
  const abortController = new AbortController();

  /** Initialize session manager and istarjaa persisted state */
  const sessionManager = istadaaKatib({ tasmim: config, amil, rasul: messenger });
  await sessionManager.hammalaHala();

  /** Initialize IPC processor and istarjaa persisted state */
  const ipcProcessor = istadaaMunaffidh({
    tasmim: config,
    mutabiWasfa: issueTracker,
    github,
    rasul: messenger,
    ntfy,
    mudirJalasat: sessionManager,
    amil,
  });
  await ipcProcessor.hammalaHala();

  /** Initialize intent resolver */
  const intentResolver = istadaaArraf({ mutabiWasfa: issueTracker, amil });

  /** Initialize dispatcher */
  const dispatcher = istadaaMunadi({
    mudirJalasat: sessionManager,
    arraf: intentResolver,
    rasul: messenger,
    namatWasfa: config.mutabiWasfa?.namatWasfa,
  });

  ipcProcessor.wadaaMunadi(dispatcher);

  await dispatcher.istarjaaIndaNashaat();

  /** Initialize question handler (for question tool events from murshids) */
  const questionHandler = istadaaSaail({
    amil,
    rasul: messenger,
    mudirJalasat: sessionManager,
  });
  await questionHandler.hammalaHala();

  questionHandler.wadaaIndaTahwilSual(async (pending: SualMuallaq, question: MaalumatSual) => {
    const khiyarat = questionHandler.banaKhiyarat(pending.id, question);
    const messageId = await messenger.arsalaSualBiKhiyarat(
      { murshid: pending.huwiyyatMurshid },
      "Use buttons below to answer:",
      khiyarat,
    );
    if (messageId) {
      pending.huwiyyatRisalaMuqaddim = messageId;
      haddathaHuwiyyatRisalaSual(pending.id, messageId);
    }
  });

  /** Initialize health monitor (session stuck detection + auto-compaction) */
  const healthMonitor = istadaaRaqib({
    amil,
    rasul: messenger,
    mudirJalasat: sessionManager,
  });

  /** Create context (partial, keepAlive added after) */
  const ctx: SiyaqKhadim = {
    tasmim: config,
    amil,
    ntfy,
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
