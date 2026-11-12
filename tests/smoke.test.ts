/**
 * Smoke Test — the gate, end to end
 *
 * Al-Munādī with a real Katib, a real Sijill, the real instruments and a
 * real TelegramMessenger; only the nest and the wire are mocked.
 */

import { test, assertEquals, assertExists, assertStringIncludes } from "../src/ikhtibar.ts";
import { withTestRepo, mockWasila, mockTelegramClient, makeConfig } from "../src/test-helpers.ts";
import { TelegramMessenger } from "../src/rasul/messenger.ts";
import { MudirJalasat } from "../src/khuddam/katib.ts";
import { Munadi } from "../src/khuddam/munadi.ts";
import { AlatAlIksir } from "../src/alat/alat-al-iksir.ts";
import { anshaaSijillWasfat } from "../src/wasfa/sijill.ts";

function buildContext() {
  const config = makeConfig();
  const amil = mockWasila();
  const telegram = mockTelegramClient();
  const messenger = new TelegramMessenger(telegram as never);
  const wasfat = anshaaSijillWasfat("W");
  const alat = new AlatAlIksir(wasfat, config);
  const sessionManager = new MudirJalasat({ tasmim: config, amil: amil as never, rasul: messenger, wasfat });
  const dispatcher = new Munadi({ mudirJalasat: sessionManager, rasul: messenger, amil: amil as never, alat, wasfat });
  alat.indaNaqsh((w, min) => { if (!min || min === "dispatch") dispatcher.rakkiz(w); });
  return { config, amil, telegram, messenger, sessionManager, dispatcher, alat, wasfat };
}

const akhirHathth = (amil: ReturnType<typeof mockWasila>) => amil._calls.sendPrompt[amil._calls.sendPrompt.length - 1].prompt;

test("smoke: words in Dispatch go to al-Munādī's own session, with the ledger of the house", async () => {
  await withTestRepo(async () => {
    const { dispatcher, amil } = buildContext();

    const result = await dispatcher.aalajRisalaIrsal({ source: "telegram", text: "what's being worked?" });

    assertEquals(result.tuulija, true);
    assertEquals(result.radd, "ok");
    assertEquals(amil._calls.khalaqaJalsa[0].huwiyyatWasfa, "iksir-munadi");
    assertEquals(amil._calls.sendPrompt.length, 1);
    assertStringIncludes(akhirHathth(amil), "The flame: no one holds it");
    assertStringIncludes(akhirHathth(amil), "what's being worked?");
  });
});

test("smoke: a summons opens a vessel and its topic", async () => {
  await withTestRepo(async () => {
    const { dispatcher, amil, telegram, sessionManager } = buildContext();

    const result = await dispatcher.faaalLiWasfa("TEAM-1000", "Bab Al Shams Portal");

    assertEquals(result.tuulija, true);
    assertExists(result.radd);
    assertStringIncludes(result.radd!, "TEAM-1000");
    assertStringIncludes(result.radd!, "Bab Al Shams Portal");
    assertEquals(amil._calls.khalaqaJalsa.length, 1);
    assertStringIncludes(amil._calls.khalaqaJalsa[0].title, "TEAM-1000");

    const sessions = sessionManager.wajadaJalasatMurshid();
    assertEquals(sessions.length, 1);
    assertEquals(sessions[0].huwiyya, "TEAM-1000");
    assertEquals(sessions[0].hala, "fail");
    assertEquals(telegram._calls.createForumTopic.length, 1);
    assertStringIncludes(telegram._calls.createForumTopic[0].name, "TEAM-1000");
    assertEquals(amil._calls.sendPromptAsync.length >= 1, true);
  });
});

test("smoke: the ledger names who holds the flame", async () => {
  await withTestRepo(async () => {
    const { dispatcher, amil } = buildContext();
    await dispatcher.faaalLiWasfa("TEAM-3000", "Qasr Al Hikma");

    await dispatcher.aalajRisalaIrsal({ source: "telegram", text: "how goes it" });

    assertStringIncludes(akhirHathth(amil), "The flame: TEAM-3000");
    assertStringIncludes(akhirHathth(amil), "TEAM-3000 — Qasr Al Hikma (fail, the flame)");
  });
});

test("smoke: mun_arrif divines the waṣfa behind words, and mun_istadi summons for it", async () => {
  await withTestRepo(async () => {
    const { dispatcher, amil, alat } = buildContext();
    await alat.sijill.naffidh("mun_khalaq_wasfa", { huwiyyatMurshid: "dispatch", title: "Majlis Refactor" });

    assertStringIncludes(await alat.sijill.naffidh("mun_arrif", { kalimat: "majlis" }), "W-1 — Majlis Refactor");
    assertStringIncludes(await alat.sijill.naffidh("mun_arrif", { kalimat: "W-1" }), "Majlis Refactor");
    assertStringIncludes(await alat.sijill.naffidh("mun_arrif", { kalimat: "nothing of the sort" }), "holds nothing");

    const radd = await alat.sijill.naffidh("mun_istadi", { huwiyya: "w-1" });
    assertStringIncludes(radd, "Murshid summoned for W-1 — Majlis Refactor");
    assertEquals(amil._calls.khalaqaJalsa.some((j) => j.huwiyyatWasfa === "W-1"), true);
    assertEquals(dispatcher.hawiyyaFaila(), "W-1");
    assertStringIncludes(await alat.sijill.naffidh("mun_arrif", { kalimat: "W-1" }), "holds the flame");
  });
});

test("smoke: a waṣfa inscribed from Dispatch is in focus, so 'go' has a referent", async () => {
  await withTestRepo(async () => {
    const { dispatcher, amil, alat } = buildContext();
    await alat.sijill.naffidh("mun_khalaq_wasfa", { title: "study the dispatch friction" });

    await dispatcher.aalajRisalaIrsal({ source: "telegram", text: "go" });

    assertStringIncludes(akhirHathth(amil), "In focus: W-1 — study the dispatch friction");
  });
});

test("smoke: mun_ablagh_murshid carries words into a murshid's vessel", async () => {
  await withTestRepo(async () => {
    const { dispatcher, amil, alat } = buildContext();
    await dispatcher.faaalLiWasfa("TEAM-7", "Diwan");
    const qabl = amil._calls.sendPromptAsync.length;

    assertEquals(await alat.sijill.naffidh("mun_ablagh_murshid", { huwiyya: "TEAM-7", kalimat: "make it longer" }), "Told TEAM-7.");
    assertEquals(amil._calls.sendPromptAsync.length, qabl + 1);
    assertStringIncludes(amil._calls.sendPromptAsync[qabl].prompt, "make it longer");
    assertStringIncludes(await alat.sijill.naffidh("mun_ablagh_murshid", { huwiyya: "TEAM-8", kalimat: "x" }), "No murshid labours on TEAM-8");
  });
});

test("smoke: a murshid topic resolves to its session", async () => {
  await withTestRepo(async () => {
    const { dispatcher, amil, sessionManager } = buildContext();
    await dispatcher.faaalLiWasfa("TEAM-5000", "Diwan Al Rasail");

    const session = sessionManager.wajadaJalasatMurshid()[0];
    const topicId = session.channels["telegram"];
    assertExists(topicId);
    const resolved = sessionManager.wajadaMurshidBiQanat("telegram", topicId);
    assertEquals(resolved?.huwiyya, "TEAM-5000");

    const qabl = amil._calls.sendPromptAsync.length;
    assertEquals(await sessionManager.arsalaIlaMurshidById("TEAM-5000", "add the GET /users endpoint"), true);
    assertEquals(amil._calls.sendPromptAsync[qabl].sessionId, session.id);
    assertStringIncludes(amil._calls.sendPromptAsync[qabl].prompt, "GET /users");
  });
});

test("smoke: a second summons passes the flame", async () => {
  await withTestRepo(async () => {
    const { dispatcher, sessionManager, telegram } = buildContext();

    await dispatcher.faaalLiWasfa("TEAM-8001", "Rihla Alpha");
    assertEquals(dispatcher.hawiyyaFaila(), "TEAM-8001");
    const result = await dispatcher.faaalLiWasfa("TEAM-8002", "Rihla Beta");
    assertEquals(dispatcher.hawiyyaFaila(), "TEAM-8002");
    assertStringIncludes(result.radd!, "The flame passed from TEAM-8001");
    assertEquals(sessionManager.wajadaJalasatMurshid().length, 2);
    assertEquals(sessionManager.jalabMurshid("TEAM-8001")?.hala, "sakin");
    assertEquals(telegram._calls.sendToDispatch.some((c) => c.text.includes("passes from TEAM-8001")), true);

    const hawwil = await dispatcher.hawwil("TEAM-8001");
    assertEquals(hawwil.radd, "The flame passes to TEAM-8001.");
    assertEquals(dispatcher.hawiyyaFaila(), "TEAM-8001");
    assertEquals((await dispatcher.hawwil("TEAM-9")).khata, "No murshid labours on TEAM-9.");
  });
});

test("smoke: vessels survive a restart, carrying their nestId", async () => {
  await withTestRepo(async () => {
    const first = buildContext();
    await first.dispatcher.faaalLiWasfa("TEAM-9001", "Rihla Baqiya");
    const lit = first.sessionManager.jalabMurshid("TEAM-9001")!;
    first.amil._reportNestId(lit.id, "nest-handle-9001");
    await first.sessionManager.hafizaHala();

    const second = buildContext();
    assertEquals(second.sessionManager.wajadaJalasatMurshid().length, 0);
    await second.sessionManager.hammalaHala();
    const restored = second.sessionManager.jalabMurshid("TEAM-9001")!;
    assertEquals(restored.id, lit.id);
    assertEquals(restored.far, lit.far);
    assertEquals(second.amil.huwiyyatUsh(lit.id), "nest-handle-9001");
  });
});
