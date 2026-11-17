/**
 * A summons against a nest: one prompt, one turn at a time, and a clean
 * dismissal. A real Wasila over fake bees, a real Katib, a real Munādī.
 */

import { test, assertEquals, assertStringIncludes } from "../src/ikhtibar.ts";
import type { Tone } from "thrum";
import { Wasila } from "../src/hum/wasila.ts";
import { AlatAlIksir } from "../src/alat/alat-al-iksir.ts";
import { MudirJalasat } from "../src/khuddam/katib.ts";
import { Munadi } from "../src/khuddam/munadi.ts";
import { TelegramMessenger } from "../src/rasul/messenger.ts";
import { anshaaSijillWasfat } from "../src/wasfa/sijill.ts";
import { khaliyya, mockTelegramClient, makeConfig, withTestRepo } from "../src/test-helpers.ts";
import { jalabaKullJalasat, jalabaQanatsForSession, jalabaAzhar } from "../db/db.ts";

async function intazir(f: () => boolean): Promise<void> {
  const azal = Date.now() + 3000;
  while (!f() && Date.now() < azal) await new Promise((r) => setTimeout(r, 10));
  assertEquals(f(), true);
}

async function mashhad() {
  const config = makeConfig();
  const { nuhul, sanaaNahla } = khaliyya();
  const wasfat = anshaaSijillWasfat("W");
  const alat = new AlatAlIksir(wasfat, config);
  const amil = new Wasila({ tasmim: config, sijill: alat.sijill, sanaaNahla });
  await amil.ittasil();
  const telegram = mockTelegramClient();
  const messenger = new TelegramMessenger(telegram as never);
  const katib = new MudirJalasat({ tasmim: config, amil, rasul: messenger, wasfat });
  const munadi = new Munadi({ mudirJalasat: katib, rasul: messenger, amil, alat, wasfat });
  const murshid = nuhul.get("murshid")!;
  const prompts = (sid?: string) => murshid.mursal.filter((t) => t.chi === "prompt" && (!sid || t.sid === sid)) as Tone<"prompt">[];
  return { amil, alat, katib, munadi, murshid, prompts, telegram, nuhul };
}

test("summon: a fresh murshid gets one opening prompt, and the next word waits for its wilt", async () => {
  await withTestRepo(async () => {
    const { amil, katib, munadi, murshid, prompts } = await mashhad();

    await munadi.faaalLiWasfa("TEAM-1", "Bab Al Shams");
    const sid = katib.jalabMurshid("TEAM-1")!.id;

    assertEquals(prompts().length, 1);
    const fatiha = prompts()[0];
    assertStringIncludes(fatiha.text!, "You are set to work on **TEAM-1** — Bab Al Shams");
    assertStringIncludes(fatiha.text!, "You hold the flame");
    assertStringIncludes(fatiha.text!, "`mun_radd` lands there");
    assertEquals(fatiha.graft, undefined);
    assertEquals(munadi.hawiyyaFaila(), "TEAM-1");

    assertEquals(await katib.arsalaIlaMurshidById("TEAM-1", "the first whisper"), true);
    assertEquals(prompts().length, 1);

    murshid.wilt(sid, "I have read it.");
    await intazir(() => prompts().length === 2);
    assertStringIncludes(prompts()[1].text!, "the first whisper");
    const graft = prompts()[1].graft as Array<{ grew: Array<{ text?: string }> }>;
    assertEquals(graft.length, 1);
    assertEquals(graft[0].grew[0].text, "I have read it.");
    assertEquals(amil.azhar(sid).length, 1);
  });
});

test("summon: passing the flame is one prompt to each side", async () => {
  await withTestRepo(async () => {
    const { katib, munadi, murshid, prompts } = await mashhad();
    await munadi.faaalLiWasfa("TEAM-1", "Alpha");
    const awwal = katib.jalabMurshid("TEAM-1")!.id;
    murshid.wilt(awwal);

    await munadi.faaalLiWasfa("TEAM-2", "Beta");
    const thani = katib.jalabMurshid("TEAM-2")!.id;

    await intazir(() => prompts(awwal).length === 2);
    assertStringIncludes(prompts(awwal)[1].text!, "The flame passes to TEAM-2");
    assertStringIncludes(prompts(awwal)[1].text!, "You are idle");
    assertEquals(prompts(thani).length, 1);
    assertStringIncludes(prompts(thani)[0].text!, "You hold the flame");
    assertEquals(katib.jalabMurshid("TEAM-1")?.hala, "sakin");

    murshid.wilt(awwal);
    murshid.wilt(thani);
    await munadi.hawwil("TEAM-1");
    await intazir(() => prompts(awwal).length === 3);
    assertStringIncludes(prompts(awwal)[2].text!, "You hold the flame again; before you, TEAM-2");
    assertEquals(prompts(thani).length, 2);
  });
});

test("summon: dismissing a murshid forgets its session, channel, memory and nest sid together", async () => {
  await withTestRepo(async () => {
    const { alat, katib, munadi, murshid, telegram } = await mashhad();
    await munadi.faaalLiWasfa("TEAM-7", "Diwan");
    const sid = katib.jalabMurshid("TEAM-7")!.id;
    murshid.wilt(sid);
    assertEquals(jalabaAzhar(sid).length, 1);
    assertEquals(Object.keys(jalabaQanatsForSession("TEAM-7")).length, 1);

    const radd = await alat.sijill.naffidh("mun_sarrih", { huwiyya: "team-7" });
    assertStringIncludes(radd, "The murshid of TEAM-7 is dismissed");
    assertStringIncludes(radd, "The flame is with no one");
    assertEquals(katib.jalabMurshid("TEAM-7"), null);
    assertEquals(munadi.hawiyyaFaila(), null);
    assertEquals(jalabaKullJalasat().some((j) => j.huwiyya === "TEAM-7"), false);
    assertEquals(Object.keys(jalabaQanatsForSession("TEAM-7")).length, 0);
    assertEquals(jalabaAzhar(sid).length, 0);
    assertEquals(murshid.mursal.some((t) => t.chi === "cleanup" && t.sid === sid), true);
    assertEquals(telegram._calls.closeForumTopic, [42]);
    assertEquals(telegram._calls.arsalaIlaMurshidTopic.at(-1)?.text, "This vessel is sealed; its work is over.");
    assertEquals(await alat.sijill.naffidh("mun_sarrih", { huwiyya: "TEAM-7" }), "No murshid labours on TEAM-7.");
  });
});

test("summon: a turn that breaks off is announced in the topic and in Dispatch, and the ledger says so", async () => {
  await withTestRepo(async () => {
    const { amil, katib, munadi, murshid, telegram, nuhul } = await mashhad();
    await munadi.faaalLiWasfa("TEAM-3", "Qasr");
    const sid = katib.jalabMurshid("TEAM-3")!.id;

    murshid.sawt({ chi: "error", sid, message: "rate limited", code: "upstream" });
    await katib.aalajHadathThrum((await amil.subscribeToEvents().next()).value);
    await katib.aalajHadathThrum({ type: "error", properties: { sid, message: "rate limited", code: "upstream" } });

    const fiTopic = telegram._calls.arsalaIlaMurshidTopic.filter((c) => c.text.includes("turn broke off"));
    assertEquals(fiTopic.length, 2);
    assertStringIncludes(fiTopic[1].text, "2 turns in a row: upstream: rate limited");
    assertEquals(telegram._calls.sendToDispatch.some((c) => c.text.includes("TEAM-3: the murshid's turn broke off")), true);

    const majlis = nuhul.get("munadi")!;
    const radd = munadi.aalajRisalaIrsal({ source: "telegram", text: "how is TEAM-3" });
    await intazir(() => majlis.mursal.some((t) => t.chi === "prompt"));
    const hathth = majlis.mursal.find((t) => t.chi === "prompt") as Tone<"prompt">;
    assertStringIncludes(hathth.text!, "TEAM-3 — Qasr (fail, the flame)");
    assertStringIncludes(hathth.text!, "last turn broke off at");
    assertStringIncludes(hathth.text!, "rate limited");
    majlis.wilt(hathth.sid as string, "It broke off twice; I have told it nothing more.");
    assertEquals((await radd).radd, "It broke off twice; I have told it nothing more.");

    await katib.aalajHadathThrum({ type: "wilt", properties: { sid } });
    await katib.aalajHadathThrum({ type: "error", properties: { sid, message: "again" } });
    assertStringIncludes(telegram._calls.arsalaIlaMurshidTopic.at(-1)!.text, "The murshid's turn broke off: again");
  });
});
