/**
 * Iksir Daemon - Autonomous Agent Tansiq
 *
 * Where al-Khadim wakes.
 * 
 * Architecture:
 * - MudirJalasat: Manages murshid jalasat at the nest
 * - Munaffidh: Works the mun_* instruments upon the matter and the register
 * - Rasul: Routes human messages to/from murshid sessions (transport-agnostic)
 * - KeepAlive: Polls for external changes, feeds to murshid
 *
 * Usage:
 *   node src/main.ts [options]
 *
 * Options:
 *   --help          Show help
 *   --version       Show version
 *   --check         Check configuration and connectivity
 */

import { logger } from "./logging/logger.ts";
import { Tasmim, tahaqqaq } from "./config.ts";
import { 
  INITIAL_BACKOFF_MS, 
  MAX_BACKOFF_MS
} from "./constants.ts";

import { baddaaQaidatBayanat, aghlaaqQaidatBayanat, jalabaAhdathGhairMuaalaja, allamaHadathMuaalaj } from "../db/db.ts";
import { Wasila } from "./hum/wasila.ts";
import { istarjaaMirata } from "./khuddam/mirata.ts";
import { AlatAlIksir } from "./alat/alat-al-iksir.ts";
import { anshaaNtfyAmil } from "./rasul/ntfy.ts";
import { anshaaTelegramAmil, type TelegramMessage, type TelegramCallbackQuery } from "./rasul/telegram.ts";
import { anshaaTelegramRasul, TelegramMessenger } from "./rasul/messenger.ts";
import { anshaaRasulUnbub } from "./rasul/rasul-anbub.ts";
import { anshaaSijillWasfat } from "./wasfa/sijill.ts";
import { istadaaKatib } from "./khuddam/katib.ts";
import { istadaaMunaffidh } from "./khuddam/munaffidh.ts";
import { istadaaMunadi } from "./khuddam/munadi.ts";
import { istadaaArraf } from "./khuddam/arraf.ts";
import { Sayrafi } from "./khuddam/sayrafi.ts";
import { VERSION } from "./version.ts";
import { istadaaRaqib } from "./khuddam/raqib.ts";
import type { Rasul, RisalaDakhila } from "./types.ts";
import type { SijillWasfat } from "./wasfa/sijill-wasfat.ts";

interface SiyaqKhadim {
  tasmim: Tasmim;
  amil: Wasila;
  ntfy: ReturnType<typeof anshaaNtfyAmil>;
  rasul: Rasul;
  wasfat: SijillWasfat;
  sayrafi: Sayrafi;
  mudirJalasat: ReturnType<typeof istadaaKatib>;
  munaffidh: ReturnType<typeof istadaaMunaffidh>;
  munadi: ReturnType<typeof istadaaMunadi>;
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

  const ntfy = ctx.tasmim.ntfy();
  if (ntfy) {
    process.stdout.write("  ntfy server... ");
    try {
      const response = await fetch(ntfy.server);
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

  console.log("");
  return allGood;
}

async function naffadhFahs(ctx: SiyaqKhadim): Promise<void> {
  console.log(`\nIksir v${VERSION} - Configuration Check\n`);
  console.log(`Config file: ${ctx.tasmim.masar}`);

  const kh = ctx.tasmim.khabath();
  console.log("\nConfiguration:");
  console.log(`  Bee hid: ${ctx.amil.huwiyya}`);
  console.log(`  Model: ${ctx.tasmim.namudhaj() ?? "(the nest decides)"}`);
  console.log(`  Majlis: ${kh.majlis.join(", ") || "(none)"}`);
  console.log(`  Kūr: ${kh.kur.join(", ") || "(none)"}`);
  console.log(`  Sijillāt: ${kh.sijillat.join(", ") || "(none)"}`);
  console.log(`  Secrets: ${ctx.tasmim.asmaAsrar().join(", ") || "(none)"}`);
  for (const shakwa of tahaqqaq(ctx.tasmim.now())) console.log(`  ! ${shakwa}`);

  const allGood = await tahaqqaqIttisaal(ctx);

  if (allGood) {
    console.log("All checks passed! ✓\n");
  } else {
    console.log("Some checks failed. Review the configuration.\n");
    process.exit(1);
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
    ]);

    aghlaaqQaidatBayanat();

    await logger.akhbar("main", "Shutdown complete");
    process.exit(0);
  };

  const handleSignal = (signal: string) => {
    ighlaaq(signal).catch((error) => {
      console.error(`Shutdown error: ${error}`);
      process.exit(1);
    });
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
}

async function ishtarakAhdath(ctx: SiyaqKhadim): Promise<void> {
  await logger.akhbar("ahdath", "Draining ahdath from the thrum");

  let backoffMs = INITIAL_BACKOFF_MS;
  

  while (!ctx.mutahakkimIlgha.signal.aborted) {
    try {
      for await (const event of ctx.amil.subscribeToEvents(ctx.mutahakkimIlgha.signal)) {
        backoffMs = INITIAL_BACKOFF_MS;

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
  await logger.akhbar("main", `Config at ${ctx.tasmim.masar}${ctx.tasmim.mawjud() ? "" : " (absent; defaults)"}`);
  for (const shakwa of tahaqqaq(ctx.tasmim.now())) await logger.haDHHir("config", shakwa);

  try {
    await ctx.amil.ittasil();
  } catch (error) {
    await logger.sajjalKhata("main", "No humd at the thrum socket, aborting", {
      error: String(error),
    });
    process.exit(1);
  }

  const version = await ctx.amil.getVersion();
  await logger.akhbar("main", `Nestled as ${ctx.amil.huwiyya} (thrum v${version ?? "?"})`);

  await addaIsharat(ctx);

  rabatRisalaDakhila(ctx);
  if (ctx.rasul instanceof TelegramMessenger) {
    istahlakTelegram(ctx, ctx.mutahakkimIlgha.signal).catch(async (error) => {
      await logger.sajjalKhata("messenger", "Sijill drain error", { error: String(error) });
    });
  } else {
    await ctx.rasul.baddaa().catch(async (error) => {
      await logger.sajjalKhata("messenger", "Inbound start error", { error: String(error) });
    });
  }

  ctx.munaffidh.badaaMuaalaja(ctx.mutahakkimIlgha.signal).catch(async (error) => {
    await logger.sajjalKhata("tool-executor", "Processing error", { error: String(error) });
  });

  ishtarakAhdath(ctx).catch(async (error) => {
    await logger.sajjalKhata("ahdath", "Ahdath drain error", { error: String(error) });
  });

  ctx.raqib.badaa(ctx.mutahakkimIlgha.signal);

  await logger.akhbar("main", "Awake; the khuddam keep their own hours");

  await new Promise<void>((resolve) => {
    if (ctx.mutahakkimIlgha.signal.aborted) return resolve();
    ctx.mutahakkimIlgha.signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function istahlakTelegram(ctx: SiyaqKhadim, signal: AbortSignal): Promise<void> {
  const rasul = ctx.rasul;
  if (!(rasul instanceof TelegramMessenger)) return;
  await logger.akhbar("telegram", "Draining wire rows from Sijill");
  while (!signal.aborted) {
    try {
      const ahdath = jalabaAhdathGhairMuaalaja("telegram");
      for (const hadath of ahdath) {
        try {
          const humula = JSON.parse(hadath.payload) as { ada?: string; update?: unknown };
          if (humula.ada === "callback" && humula.update) {
            await rasul.iqraIstijaba(humula.update as TelegramCallbackQuery);
          } else if (humula.update) {
            const tahdith = humula.update as { message?: TelegramMessage };
            if (tahdith.message) await rasul.iqraRisala(tahdith.message);
          }
        } catch (error) {
          await logger.sajjalKhata("telegram", "Wire row failed", { error: String(error) });
        }
        allamaHadathMuaalaj(hadath.id);
      }
    } catch (error) {
      await logger.sajjalKhata("telegram", "Wire drain failed", { error: String(error) });
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function rabatRisalaDakhila(ctx: SiyaqKhadim): void {
  ctx.rasul.indaRisala(async (risala: RisalaDakhila) => {
    switch (risala.naw) {
      case "murshid": {
        const { huwiyya, nass } = risala;

        await logger.akhbar("inbound", `Routing to murshid ${huwiyya}`);
        const success = await ctx.mudirJalasat.arsalaIlaMurshidById(huwiyya, nass);
        if (!success) {
          await ctx.rasul.send({ murshid: huwiyya }, `Failed to send message to murshid.`);
        }
        break;
      }

      case "irsal": {
        const { nass, huwiyyatRisala } = risala;

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
        await aalajAmrDakhil(ctx, risala.amr, risala.wusut);
        break;
      }

      case "ikhtiyar_munadi": {
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
        await aalajRisalaKhassa(ctx);
        break;
      }
    }
  });
}

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
  response += "Use **Dispatch** to name a wasfa and light a murshid.\n";
  response += "Use **murshid topics** to converse with active sessions.\n";

  await ctx.rasul.send("kimyawi", response);
}

async function aalajAmrDakhil(ctx: SiyaqKhadim, amr: string, wusut: string[]): Promise<void> {
  switch (amr.toLowerCase()) {
    case "start":
      if (wusut.length === 0) {
        await ctx.rasul.send("dispatch", "**Usage:** /start <wasfa>\n\nName a wasfa from the register.");
      } else {
        const natija = await ctx.munadi.aalajRisalaIrsal({
          source: "cli",
          text: wusut.join(" "),
        });
        await ctx.rasul.send("dispatch", natija.radd ?? "…");
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

    case "naqsh": {
      if (wusut.length === 0) {
        await ctx.rasul.send("dispatch", "**Usage:** /naqsh <wasfa>");
        break;
      }
      const huwiyya = wusut[0];
      const wasfa = await ctx.wasfat.iqra(huwiyya);
      if (!wasfa) {
        await ctx.rasul.send("dispatch", `No wasfa by that name: ${huwiyya}`);
        break;
      }
      if (wasfa.hala !== "mafsul") {
        await ctx.rasul.send(
          "dispatch",
          `${huwiyya} has not been decanted. It stands at: ${wasfa.hala ?? "khaam"}`,
        );
        break;
      }
      const jalsa = ctx.mudirJalasat.jalabMurshid(huwiyya);
      await ctx.rasul.send("dispatch", await ctx.sayrafi.naqasha(wasfa, jalsa?.far));
      break;
    }

    case "help":
      await ctx.rasul.send("dispatch", `**Commands**

/start <wasfa> - light a murshid on a wasfa
/naqsh <wasfa> - inscribe a decanted jawhar into the codex
/status - what stands at the flame
/sessions - every vessel
/help - this

Name a wasfa to begin. Each murshid keeps its own channel.
`);
      break;

    default:
      await ctx.rasul.send("dispatch", `Unknown command: /${amr}\n\nType /help for available commands.`);
  }
}

export async function abda(opts: { check?: boolean } = {}): Promise<void> {
  await logger.baddaa();

  const tasmim = new Tasmim();
  logger.ittabi(() => tasmim.mustawaAhdaq());

  await baddaaQaidatBayanat();

  const wasfat = anshaaSijillWasfat(() => tasmim.now().wasfat.sabiqa);

  const alat = new AlatAlIksir(wasfat);

  const amil = new Wasila({ tasmim, sijill: alat.sijill });
  await amil.ittasil();
  const sayrafi = new Sayrafi(amil, tasmim);

  istarjaaMirata(amil).catch(async (error) => {
    await logger.sajjalKhata("mirata", "mirror backfill failed", { error: String(error) });
  });
  const ntfy = anshaaNtfyAmil(tasmim);
  const telegram = anshaaTelegramAmil(tasmim);
  const messenger: Rasul = tasmim.khabath().majlis.includes("telegram")
    ? anshaaTelegramRasul(telegram)
    : anshaaRasulUnbub();

  const abortController = new AbortController();

  const sessionManager = istadaaKatib({ tasmim, amil, rasul: messenger, wasfat });
  await sessionManager.hammalaHala();

  const ipcProcessor = istadaaMunaffidh({
    tasmim,
    wasfat,
    rasul: messenger,
    ntfy,
    mudirJalasat: sessionManager,
    amil,
    sayrafi,
  });
  await ipcProcessor.hammalaHala();

  const intentResolver = istadaaArraf({ wasfat, amil });

  const dispatcher = istadaaMunadi({
    mudirJalasat: sessionManager,
    arraf: intentResolver,
    rasul: messenger,
    amil,
    namatWasfa: () => tasmim.now().wasfat.namatWasfa,
  });

  ipcProcessor.wadaaMunadi(dispatcher);

  await dispatcher.istarjaaIndaNashaat();

  const healthMonitor = istadaaRaqib({
    amil,
    rasul: messenger,
    mudirJalasat: sessionManager,
  });

  const ctx: SiyaqKhadim = {
    tasmim,
    amil,
    ntfy,
    rasul: messenger,
    mudirJalasat: sessionManager,
    munaffidh: ipcProcessor,
    munadi: dispatcher,
    wasfat,
    sayrafi,
    raqib: healthMonitor,
    mutahakkimIlgha: abortController,
  };

  if (opts.check) {
    await naffadhFahs(ctx);
    amil.qaf();
    aghlaaqQaidatBayanat();
    process.exit(0);
  }

  await awqadKhadim(ctx);
}

if (import.meta.main) {
  const check = process.argv.slice(2).includes("--check");
  abda({ check }).catch(async (error) => {
    await logger.sajjalKhata("main", "Fatal error", { error: String(error) });
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
