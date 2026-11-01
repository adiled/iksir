/**
 * Smoke Test — End-to-end daemon pipeline validation
 *
 * Exercises the full inbound message pipeline with real Iksir,
 * MudirJalasat, Sail, and TelegramMessenger — mocking only
 * the outward boundaries — the nest, the register, the messenger.
 *
 * Run: npm test
 */

import { test, assertEquals, assertExists, assertStringIncludes } from "../src/ikhtibar.ts";
import {
  withTestRepo,
  mockWasila,
  mockHayula,
  mockTelegramClient,
  mockArraf,
  makeConfig,
} from "../src/test-helpers.ts";
import { TelegramMessenger } from "../src/rasul/messenger.ts";
import { MudirJalasat } from "../src/khuddam/katib.ts";
import { Munadi } from "../src/khuddam/munadi.ts";
import type { NiyyaMuhallala } from "../src/khuddam/arraf.ts";

function buildContext() {
  const config = makeConfig();
  const amil = mockWasila();
  const telegram = mockTelegramClient();
  const messenger = new TelegramMessenger(telegram as never);
  const intentResolver = mockArraf();
  const hayula = mockHayula();

  const sessionManager = new MudirJalasat({
    tasmim: config,
    amil: amil as never,
    rasul: messenger,
  });

  const dispatcher = new Munadi({
    mudirJalasat: sessionManager,
    arraf: intentResolver as never,
    rasul: messenger,
    amil: amil as never,
    hayula,
    namatWasfa: config.wasfat?.namatWasfa,
  });

  return { config, amil, telegram, messenger, sessionManager, dispatcher, intentResolver, hayula };
}

test("smoke: /status with no sessions returns empty status", async () => {
  await withTestRepo(async () => {
    const { dispatcher } = buildContext();

    const result = await dispatcher.aalajRisalaIrsal({
      source: "telegram",
      text: "/status",
    });

    assertEquals(result.tuulija, true);
    assertExists(result.radd);
    assertStringIncludes(result.radd!, "none");
  });
});

test("smoke: activateForTicketUrl creates session + topic", async () => {
  await withTestRepo(async () => {
    const { dispatcher, amil, telegram, sessionManager } = buildContext();

    const result = await dispatcher.faaalLiWasfa(
      "TEAM-1000",
      "Bab Al Shams Portal"
    );

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

    const promptCalls = amil._calls.sendPromptAsync;
    assertEquals(promptCalls.length >= 1, true);
  });
});

test("smoke: message routed to active murshid via sendPromptAsync", async () => {
  await withTestRepo(async () => {
    const { dispatcher, amil, sessionManager } = buildContext();

    await dispatcher.faaalLiWasfa(
      "TEAM-2000",
      "Alf Layla Migration"
    );

    const initPromptCount = amil._calls.sendPromptAsync.length;

    const session = sessionManager.wajadaJalasatMurshid()[0];
    const success = await sessionManager.arsalaIlaMurshidById(
      session.huwiyya,
      "implement the null safety checks",
    );

    assertEquals(success, true);

    assertEquals(amil._calls.sendPromptAsync.length, initPromptCount + 1);
    const lastPrompt = amil._calls.sendPromptAsync[amil._calls.sendPromptAsync.length - 1];
    assertEquals(lastPrompt.sessionId, session.id);
    assertStringIncludes(lastPrompt.prompt, "null safety");
  });
});

test("smoke: /status with active session shows identifier", async () => {
  await withTestRepo(async () => {
    const { dispatcher } = buildContext();

    await dispatcher.faaalLiWasfa(
      "TEAM-3000",
      "Qasr Al Hikma"
    );

    const result = await dispatcher.aalajRisalaIrsal({
      source: "telegram",
      text: "/status",
    });

    assertEquals(result.tuulija, true);
    assertExists(result.radd);
    assertStringIncludes(result.radd!, "TEAM-3000");
  });
});

test("smoke: dispatch message uses intent resolver for natural language", async () => {
  await withTestRepo(async () => {
    const { dispatcher, intentResolver, amil } = buildContext();

    intentResolver._nextResult = {
      hala: "muhallala",
      kiyan: {
        naw: "wasfa",
        id: "issue-abc",
        huwiyya: "TEAM-4000",
        unwan: "Majlis Refactor",
      },
      nassKham: "work on the majlis refactor",
      tariqa: "bahth_fikri",
      fil: "taqaddam",
    } as NiyyaMuhallala;

    const result = await dispatcher.aalajRisalaIrsal({
      source: "telegram",
      text: "work on the majlis refactor",
    });

    assertEquals(intentResolver._calls.length, 1);
    assertEquals(intentResolver._calls[0].text, "work on the majlis refactor");

    assertEquals(result.tuulija, true);
    assertExists(result.radd);

    assertEquals(amil._calls.khalaqaJalsa.length, 1);
  });
});

test("smoke: murshid topic message routes to correct session", async () => {
  await withTestRepo(async () => {
    const { dispatcher, amil, sessionManager } = buildContext();

    await dispatcher.faaalLiWasfa(
      "TEAM-5000",
      "Diwan Al Rasail"
    );

    const session = sessionManager.wajadaJalasatMurshid()[0];
    assertExists(session);

    assertEquals(Object.keys(session.channels).length > 0, true);
    const topicId = session.channels["telegram"];
    assertExists(topicId);

    const resolvedMurshid = sessionManager.wajadaMurshidBiQanat("telegram", topicId);
    assertExists(resolvedMurshid);
    assertEquals(resolvedMurshid!.huwiyya, "TEAM-5000");

    const initPromptCount = amil._calls.sendPromptAsync.length;
    const success = await sessionManager.arsalaIlaMurshidById(
      resolvedMurshid!.huwiyya,
      "add the GET /users endpoint",
    );

    assertEquals(success, true);

    const lastPrompt = amil._calls.sendPromptAsync[amil._calls.sendPromptAsync.length - 1];
    assertEquals(lastPrompt.sessionId, session.id);
    assertStringIncludes(lastPrompt.prompt, "GET /users");
    assertEquals(amil._calls.sendPromptAsync.length, initPromptCount + 1);
  });
});

test("smoke: second murshid activation switches active session", async () => {
  await withTestRepo(async () => {
    const { dispatcher, sessionManager } = buildContext();

    await dispatcher.faaalLiWasfa("TEAM-8001", "Rihla Alpha");
    assertEquals(dispatcher.hawiyyaFaila(), "TEAM-8001");

    await dispatcher.faaalLiWasfa("TEAM-8002", "Rihla Beta");
    assertEquals(dispatcher.hawiyyaFaila(), "TEAM-8002");

    assertEquals(sessionManager.wajadaJalasatMurshid().length, 2);
  });
});

test("smoke: vessels survive a restart, carrying their nestId", async () => {
  await withTestRepo(async () => {
    const first = buildContext();
    await first.dispatcher.faaalLiWasfa("TEAM-9001", "Rihla Baqiya");

    const lit = first.sessionManager.jalabMurshid("TEAM-9001");
    assertEquals(lit !== null, true);
    first.amil._reportNestId(lit!.id, "nest-handle-9001");
    await first.sessionManager.hafizaHala();

    const second = buildContext();
    assertEquals(second.sessionManager.wajadaJalasatMurshid().length, 0);

    await second.sessionManager.hammalaHala();

    const restored = second.sessionManager.jalabMurshid("TEAM-9001");
    assertEquals(restored !== null, true);
    assertEquals(restored!.id, lit!.id);
    assertEquals(restored!.far, lit!.far);

    assertEquals(second.amil.huwiyyatUsh(lit!.id), "nest-handle-9001");
  });
});

test("smoke: ticketless question is answered by the nest directly", async () => {
  await withTestRepo(async () => {
    const { dispatcher, intentResolver, amil } = buildContext();

    intentResolver._nextResult = {
      hala: "lam_tujad",
      tariqa: "bahth_fikri",
      nassKham: "say meow",
    } as never;

    const result = await dispatcher.aalajRisalaIrsal({
      source: "telegram",
      text: "say meow",
    });

    assertEquals(result.tuulija, true);
    assertExists(result.radd);
    assertEquals(amil._calls.sendPrompt.length, 1);
    assertStringIncludes(amil._calls.sendPrompt[0].prompt, "say meow");
  });
});
