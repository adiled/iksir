/**
 * Smoke Test — End-to-end daemon pipeline validation
 *
 * Exercises the full inbound message pipeline with real Iksir,
 * MudirJalasat, Sail, and TelegramMessenger — mocking only
 * the outward boundaries — the nest, the register, the messenger.
 *
 * Run: deno test --allow-all tests/smoke_test.ts
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import {
  withTestRepo,
  mockAmilHum,
  mockHayula,
  mockTelegramClient,
  mockArraf,
  makeConfig,
} from "../src/test-helpers.ts";
import { TelegramMessenger } from "../src/notifications/messenger.ts";
import { MudirJalasat } from "../src/khuddam/katib.ts";
import { Munadi } from "../src/khuddam/munadi.ts";
import { Saail } from "../src/khuddam/saail.ts";
import type { NiyyaMuhallala } from "../src/khuddam/arraf.ts";
import { jalabaAseilaGhairMujaba } from "../db/db.ts";


function buildContext() {
  const config = makeConfig();
  const amil = mockAmilHum();
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
    hayula,
    namatWasfa: config.wasfat?.namatWasfa,
  });

  const questionHandler = new Saail({
    amil: amil as never,
    rasul: messenger,
    mudirJalasat: sessionManager as never,
  });

  return { config, amil, telegram, messenger, sessionManager, dispatcher, intentResolver, questionHandler, hayula };
}


Deno.test("smoke: /status with no sessions returns empty status", async () => {
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


Deno.test("smoke: activateForTicketUrl creates session + topic", async () => {
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

    /** Session manager should track the session */
    const sessions = sessionManager.wajadaJalasatMurshid();
    assertEquals(sessions.length, 1);
    assertEquals(sessions[0].huwiyya, "TEAM-1000");
    assertEquals(sessions[0].hala, "fail");

    assertEquals(telegram._calls.createForumTopic.length, 1);
    assertStringIncludes(telegram._calls.createForumTopic[0].name, "TEAM-1000");

    /** Init message should have been sent to murshid via sendPromptAsync */
    const promptCalls = amil._calls.sendPromptAsync;
    assertEquals(promptCalls.length >= 1, true);
  });
});


Deno.test("smoke: message routed to active murshid via sendPromptAsync", async () => {
  await withTestRepo(async () => {
    const { dispatcher, amil, sessionManager } = buildContext();

    await dispatcher.faaalLiWasfa(
      "TEAM-2000",
      "Alf Layla Migration"
    );

    /** Clear the init prompt calls so we can track the next one */
    const initPromptCount = amil._calls.sendPromptAsync.length;

    /** Step 2: Send a message to the active murshid */
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


Deno.test("smoke: /status with active session shows identifier", async () => {
  await withTestRepo(async () => {
    const { dispatcher } = buildContext();

    await dispatcher.faaalLiWasfa(
      "TEAM-3000",
      "Qasr Al Hikma"
    );

    /** Now check status */
    const result = await dispatcher.aalajRisalaIrsal({
      source: "telegram",
      text: "/status",
    });

    assertEquals(result.tuulija, true);
    assertExists(result.radd);
    assertStringIncludes(result.radd!, "TEAM-3000");
  });
});


Deno.test("smoke: dispatch message uses intent resolver for natural language", async () => {
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


Deno.test("smoke: murshid topic message routes to correct session", async () => {
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

    /** Step 3: Simulate main.ts topic routing */
    const resolvedMurshid = sessionManager.wajadaMurshidBiQanat("telegram", topicId);
    assertExists(resolvedMurshid);
    assertEquals(resolvedMurshid!.huwiyya, "TEAM-5000");

    /** Step 4: Route the message */
    const initPromptCount = amil._calls.sendPromptAsync.length;
    const success = await sessionManager.arsalaIlaMurshidById(
      resolvedMurshid!.huwiyya,
      "add the GET /users endpoint",
    );

    assertEquals(success, true);

    /** Step 5: Verify the message reached the right vessel */
    const lastPrompt = amil._calls.sendPromptAsync[amil._calls.sendPromptAsync.length - 1];
    assertEquals(lastPrompt.sessionId, session.id);
    assertStringIncludes(lastPrompt.prompt, "GET /users");
    assertEquals(amil._calls.sendPromptAsync.length, initPromptCount + 1);
  });
});


Deno.test("smoke: question event classified and forwarded to murshid topic", async () => {
  await withTestRepo(async () => {
    const { dispatcher, questionHandler, sessionManager } = buildContext();

    await dispatcher.faaalLiWasfa(
      "TEAM-6000",
      "Funduq Search"
    );

    const session = sessionManager.wajadaJalasatMurshid()[0];

    await questionHandler.aalajSualMatlub({
      type: "question.asked",
      properties: {
        id: "q-smoke-001",
        sessionID: session.id,
        questions: [{
          header: "Architecture choice",
          question: "Should we use REST or GraphQL?",
          options: [
            { label: "REST (Recommended)", description: "Standard approach" },
            { label: "GraphQL", description: "Flexible queries" },
          ],
        }],
      },
    });

    /** Step 3: Verify question is pending */
    const pending = questionHandler.wajadaSualMuallaq("q-smoke-001");
    assertExists(pending);
    assertEquals(pending.huwiyyatMurshid, "TEAM-6000");

    /** Step 4: Verify question was persisted in DB */
    const dbQuestions = jalabaAseilaGhairMujaba();
    assertEquals(dbQuestions.length, 1);
    assertEquals(dbQuestions[0].id, "q-smoke-001");
  });
});


Deno.test("smoke: question answered via callback", async () => {
  await withTestRepo(async () => {
    const { dispatcher, amil, questionHandler, sessionManager } = buildContext();

    await dispatcher.faaalLiWasfa(
      "TEAM-7000",
      "Bayt Al Hikma"
    );

    const session = sessionManager.wajadaJalasatMurshid()[0];

    await questionHandler.aalajSualMatlub({
      type: "question.asked",
      properties: {
        id: "q-smoke-002",
        sessionID: session.id,
        questions: [{
          header: "Approach",
          question: "Which path?",
          options: [
            { label: "Sabr", description: "Patient approach" },
            { label: "Ijtihad", description: "Independent reasoning" },
          ],
        }],
      },
    });

    /** Clear reply calls from auto-answer attempts */
    const replyCountBefore = amil._calls.replyToQuestion.length;

    /** Answer the question */
    const success = await questionHandler.aalajIstijabaZirrSual("q-smoke-002", "Ijtihad");
    assertEquals(success, true);

    assertEquals(amil._calls.replyToQuestion.length, replyCountBefore + 1);
    const lastReply = amil._calls.replyToQuestion[amil._calls.replyToQuestion.length - 1];
    assertEquals(lastReply.answers[0].selected, ["Ijtihad"]);

    assertEquals(questionHandler.wajadaSualMuallaq("q-smoke-002"), undefined);

    assertEquals(jalabaAseilaGhairMujaba().length, 0);
  });
});


Deno.test("smoke: second murshid activation switches active session", async () => {
  await withTestRepo(async () => {
    const { dispatcher, sessionManager } = buildContext();

    await dispatcher.faaalLiWasfa("TEAM-8001", "Rihla Alpha");
    assertEquals(dispatcher.hawiyyaFaila(), "TEAM-8001");

    await dispatcher.faaalLiWasfa("TEAM-8002", "Rihla Beta");
    assertEquals(dispatcher.hawiyyaFaila(), "TEAM-8002");

    assertEquals(sessionManager.wajadaJalasatMurshid().length, 2);
  });
});


Deno.test("smoke: vessels survive a restart, carrying their nestId", async () => {
  await withTestRepo(async () => {
    /** First life — light a vessel and let the worker name its handle. */
    const first = buildContext();
    await first.dispatcher.faaalLiWasfa("TEAM-9001", "Rihla Baqiya");

    const lit = first.sessionManager.jalabMurshid("TEAM-9001");
    assertEquals(lit !== null, true);
    first.amil._reportNestId(lit!.id, "nest-handle-9001");
    await first.sessionManager.hafizaHala();

    /**
     * Second life — a fresh amil that has never heard of this vessel, which
     * is exactly the state after a restart. The sijill is the only witness.
     */
    const second = buildContext();
    assertEquals(second.sessionManager.wajadaJalasatMurshid().length, 0);

    await second.sessionManager.hammalaHala();

    const restored = second.sessionManager.jalabMurshid("TEAM-9001");
    assertEquals(restored !== null, true);
    assertEquals(restored!.id, lit!.id);
    assertEquals(restored!.far, lit!.far);

    /** The amil must be able to resume, or the murshid wakes with no memory. */
    assertEquals(second.amil.huwiyyatUsh(lit!.id), "nest-handle-9001");
  });
});
