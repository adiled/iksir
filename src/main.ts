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
import { Sayrafi } from "./khuddam/sayrafi.ts";
import { sajjilIstisnaa } from "./khuddam/sani.ts";
import { Mumayyiz } from "./khuddam/mumayyiz.ts";
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

        ctx.mudirJalasat.aalajHadathThrum(event).catch(async (e) =>
          await logger.sajjalKhata("ahdath", `Could not act on ${event.type}`, { error: String(e) })
        );
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
  const namudhaj = ctx.tasmim.namudhaj();
  const namadhij = ctx.amil.namadhij();
  if (namudhaj && namadhij.length && !namadhij.includes(namudhaj)) {
    await logger.haDHHir("main", `hum.namudhaj is ${namudhaj}, which no nurse advertises; the nest has ${namadhij.join(", ")}`);
  }

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
        const result = await ctx.munadi.aalajRisalaIrsal({
          source: "telegram",
          text: risala.nass,
          messageId: risala.huwiyyatRisala,
        });
        if (result.radd) await ctx.rasul.send("dispatch", result.radd);
        if (result.khata) await ctx.rasul.send("dispatch", result.khata);
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

export async function abda(): Promise<void> {
  await logger.baddaa();

  const tasmim = new Tasmim();
  logger.ittabi(() => tasmim.mustawaAhdaq());

  await baddaaQaidatBayanat();

  const wasfat = anshaaSijillWasfat(() => tasmim.now().wasfat.sabiqa);

  const alat = new AlatAlIksir(wasfat, tasmim);

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
  sajjilIstisnaa(alat, amil, sessionManager);
  new Mumayyiz({ amil, tasmim, rasul: messenger, mudirJalasat: sessionManager, ntfy }).sajjil(alat);
  sayrafi.indaInkisar(async (wasfa, khata) => {
    await sessionManager.arsalaIlaMurshidById(wasfa.huwiyya, `## Al-Ṣayrafī could not finish — ${khata}\n\nNo shahāda will come for this; call again when the cause is mended.`);
    await messenger.send("dispatch", `${wasfa.huwiyya}: al-Ṣayrafī's duty broke off — ${khata}`);
  });

  const ipcProcessor = istadaaMunaffidh({
    tasmim,
    wasfat,
    rasul: messenger,
    mudirJalasat: sessionManager,
    amil,
    sayrafi,
  });
  await ipcProcessor.hammalaHala();

  const dispatcher = istadaaMunadi({
    mudirJalasat: sessionManager,
    rasul: messenger,
    amil,
    alat,
    wasfat,
    sayrafi,
  });

  ipcProcessor.wadaaMunadi(dispatcher);
  alat.indaNaqsh((wasfa, min) => {
    if (!min || min === "dispatch") dispatcher.rakkiz(wasfa);
  });

  await dispatcher.istarjaaIndaNashaat();

  const healthMonitor = istadaaRaqib({
    amil,
    rasul: messenger,
    mudirJalasat: sessionManager,
    wasfat,
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


  await awqadKhadim(ctx);
}

if (import.meta.main) {
  abda().catch(async (error) => {
    await logger.sajjalKhata("main", "Fatal error", { error: String(error) });
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
