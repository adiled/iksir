import { baddaaQaidatBayanat, adkhalaHadath } from "../../db/db.ts";
import { anshaaTelegramAmil } from "../../src/rasul/telegram.ts";
import { Tasmim } from "../../src/config.ts";
import { logger } from "../../src/logging/logger.ts";

async function abwab(): Promise<void> {
  await logger.baddaa();
  await baddaaQaidatBayanat();

  const tasmim = new Tasmim();
  logger.ittabi(() => tasmim.mustawaAhdaq());
  const amil = anshaaTelegramAmil(tasmim);

  amil.onMessage(async (risala) => {
    adkhalaHadath("telegram", "message", { update: { message: risala } });
    await logger.akhbar("saail", "wire message forwarded", { id: risala.message_id });
  });

  amil.onCallback(async (istijaba) => {
    adkhalaHadath("telegram", "callback", { update: istijaba });
    await logger.akhbar("saail", "wire callback forwarded", { id: istijaba.id });
  });

  while (!amil.mumakkan()) {
    await logger.haDHHir("saail", `No majlis yet: set khabath.majlis to telegram and the secret telegram.ramz (${tasmim.masar})`);
    await new Promise((r) => setTimeout(r, 30_000));
  }

  await amil.startPolling();
}

abwab().catch(async (error) => {
  await logger.sajjalKhata("saail", "fatal", { error: String(error) });
  console.error("saail fatal:", error);
  process.exit(1);
});
