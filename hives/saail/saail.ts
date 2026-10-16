import { Nahla } from "../../hum/bee.ts";
import { baddaaQaidatBayanat, adkhalaHadath } from "../../db/db.ts";
import { anshaaTelegramAmil } from "../../src/rasul/telegram.ts";
import type { TasmimIksir } from "../../src/types.ts";
import { logger } from "../../src/logging/logger.ts";

function tasmimBab(): TasmimIksir {
  const ramzBot = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!ramzBot) throw new Error("TELEGRAM_BOT_TOKEN is required");
  return {
    isharat: {
      telegram: {
        mufattah: true,
        ramzBot,
        huwiyyatMuhadatha: process.env.TELEGRAM_CHAT_ID ?? "",
        huwiyyatMajmuua: process.env.TELEGRAM_GROUP_ID,
        huwiyyatMawduuIrsal: undefined,
        proxy: process.env.TELEGRAM_PROXY ?? "",
      },
      ntfy: { mufattah: false, server: "", topic: "" },
    },
  } as TasmimIksir;
}

async function abwab(): Promise<void> {
  await logger.baddaa();
  await baddaaQaidatBayanat();

  const tasmim = tasmimBab();
  const amil = anshaaTelegramAmil(tasmim);

  amil.onMessage(async (risala) => {
    adkhalaHadath("telegram", "message", { update: { message: risala } });
    await logger.akhbar("saail", "wire message forwarded", { id: risala.message_id });
  });

  amil.onCallback(async (istijaba) => {
    adkhalaHadath("telegram", "callback", { update: istijaba });
    await logger.akhbar("saail", "wire callback forwarded", { id: istijaba.id });
  });

  const nahla = new Nahla({
    hive: "saail",
    prefix: "fbee",
    version: "1.0.0",
    bee: ["forager"],
    chis: ["hello", "breath", "echo"],
    propensity: { statefulness: "stateless", richness: "lean", wire: "telegram/bot-api" },
    log: (m) => void logger.akhbar("saail", m),
  });
  await nahla.connect();
  await logger.akhbar("saail", `nestled as ${nahla.hid}`);

  await amil.startPolling();
}

abwab().catch(async (error) => {
  await logger.sajjalKhata("saail", "fatal", { error: String(error) });
  console.error("saail fatal:", error);
  process.exit(1);
});
