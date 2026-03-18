/**
 * Smoke Test — End-to-end daemon pipeline validation
 *
 * Exercises the full inbound message pipeline with real Iksir,
 * MudirJalasat, Sail, and TelegramMessenger — mocking only
 * the external boundaries (OpenCode API, Linear API, Telegram API).
 *
 * Run: deno test --allow-all tests/smoke_test.ts
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import {
  withTestRepo,
  mockOpenCodeClient,
  mockTelegramClient,
  mockArraf,
  makeConfig,
} from "../src/test-helpers.ts";
import { TelegramMessenger } from "../src/notifications/messenger.ts";
import { MudirJalasat } from "../src/daemon/katib.ts";
import { Munadi } from "../src/daemon/munadi.ts";
import { Sail } from "../src/daemon/sail.ts";
import type { NiyyaMuhallala } from "../src/daemon/arraf.ts";
import { jalabaAseilaGhairMujaba } from "../db/db.ts";


function buildContext() {
  const config = makeConfig();
  const opencode = mockOpenCodeClient();
  const telegram = mockTelegramClient();
  const messenger = new TelegramMessenger(telegram as never);
  const intentResolver = mockArraf();

  const sessionManager = new MudirJalasat({
    config,
    opencode: opencode as never,
    messenger,
  });

  const dispatcher = new Munadi({
    sessionManager,
    intentResolver: intentResolver as never,
    messenger,
    ticketPattern: config.issueTracker?.ticketPattern,
  });

  const questionHandler = new Sail({
    opencode: opencode as never,
    messenger,
    sessionManager: sessionManager as never,
  });

  return { config, opencode, telegram, messenger, sessionManager, dispatcher, intentResolver, questionHandler };
}


Deno.test("smoke: /status with no sessions returns empty status", async () => {
  await withTestRepo(async () => {
    const { dispatcher } = buildContext();

    const result = await dispatcher.handleDispatchMessage({
      source: "telegram",
      text: "/status",
    });

    assertEquals(result.handled, true);
    assertExists(result.response);
    assertStringIncludes(result.response!, "none");
  });
});


Deno.test("smoke: activateForTicketUrl creates session + topic", async () => {
  await withTestRepo(async () => {
    const { dispatcher, opencode, telegram, sessionManager } = buildContext();

    const result = await dispatcher.activateForTicketUrl(
      "TEAM-1000",
      "Bab Al Shams Portal",
      "https://linear.app/team/issue/TEAM-XXX"
    );

    assertEquals(result.handled, true);
    assertExists(result.response);
    assertStringIncludes(result.response!, "TEAM-1000");
    assertStringIncludes(result.response!, "Bab Al Shams Portal");

    assertEquals(opencode._calls.khalaqaJalsa.length, 1);
    assertStringIncludes(opencode._calls.khalaqaJalsa[0].title, "TEAM-1000");

    /** Session manager should track the session */
    const sessions = sessionManager.wajadaJalasatMurshid();
    assertEquals(sessions.length, 1);
    assertEquals(sessions[0].identifier, "TEAM-1000");
    assertEquals(sessions[0].status, "fail");

    assertEquals(telegram._calls.createForumTopic.length, 1);
    assertStringIncludes(telegram._calls.createForumTopic[0].name, "TEAM-1000");

    /** Init message should have been sent to murshid via sendPromptAsync */
    const promptCalls = opencode._calls.sendPromptAsync;
    assertEquals(promptCalls.length >= 1, true);
  });
});


Deno.test("smoke: message routed to active murshid via sendPromptAsync", async () => {
  await withTestRepo(async () => {
    const { dispatcher, opencode, sessionManager } = buildContext();

    await dispatcher.activateForTicketUrl(
      "TEAM-2000",
      "Alf Layla Migration",
      "https://linear.app/team/issue/TEAM-XXX"
    );

    /** Clear the init prompt calls so we can track the next one */
    const initPromptCount = opencode._calls.sendPromptAsync.length;

    /** Step 2: Send a message to the active murshid */
    const session = sessionManager.wajadaJalasatMurshid()[0];
    const success = await sessionManager.arsalaIlaMurshidById(
      session.identifier,
      "implement the null safety checks",
    );

    assertEquals(success, true);

    assertEquals(opencode._calls.sendPromptAsync.length, initPromptCount + 1);
    const lastPrompt = opencode._calls.sendPromptAsync[opencode._calls.sendPromptAsync.length - 1];
    assertEquals(lastPrompt.sessionId, session.id);
    assertStringIncludes(lastPrompt.prompt, "null safety");
  });
});


Deno.test("smoke: /status with active session shows identifier", async () => {
  await withTestRepo(async () => {
    const { dispatcher } = buildContext();

    await dispatcher.activateForTicketUrl(
      "TEAM-3000",
      "Qasr Al Hikma",
      "https://linear.app/team/issue/TEAM-XXX"
    );

    /** Now check status */
    const result = await dispatcher.handleDispatchMessage({
      source: "telegram",
      text: "/status",
    });

    assertEquals(result.handled, true);
    assertExists(result.response);
    assertStringIncludes(result.response!, "TEAM-3000");
  });
});


Deno.test("smoke: dispatch message uses intent resolver for natural language", async () => {
  await withTestRepo(async () => {
    const { dispatcher, intentResolver, opencode } = buildContext();

    intentResolver._nextResult = {
      status: "resolved",
      entity: {
        type: "ticket",
        id: "issue-abc",
        identifier: "TEAM-4000",
        title: "Majlis Refactor",
        url: "https://linear.app/team/issue/TEAM-XXX"
      },
      rawText: "work on the majlis refactor",
      method: "llm_search",
      action: "proceed",
    } as NiyyaMuhallala;

    const result = await dispatcher.handleDispatchMessage({
      source: "telegram",
      text: "work on the majlis refactor",
    });

    assertEquals(intentResolver._calls.length, 1);
    assertEquals(intentResolver._calls[0].text, "work on the majlis refactor");

    assertEquals(result.handled, true);
    assertExists(result.response);

    assertEquals(opencode._calls.khalaqaJalsa.length, 1);
  });
});


Deno.test("smoke: murshid topic message routes to correct session", async () => {
  await withTestRepo(async () => {
    const { dispatcher, opencode, sessionManager } = buildContext();

    await dispatcher.activateForTicketUrl(
      "TEAM-5000",
      "Diwan Al Rasail",
      "https://linear.app/team/issue/TEAM-XXX"
    );

    const session = sessionManager.wajadaJalasatMurshid()[0];
    assertExists(session);

    assertEquals(Object.keys(session.channels).length > 0, true);
    const topicId = session.channels["telegram"];
    assertExists(topicId);

    /** Step 3: Simulate main.ts topic routing */
    const resolvedMurshid = sessionManager.wajadaMurshidBiQanat("telegram", topicId);
    assertExists(resolvedMurshid);
    assertEquals(resolvedMurshid!.identifier, "TEAM-5000");

    /** Step 4: Route the message */
    const initPromptCount = opencode._calls.sendPromptAsync.length;
    const success = await sessionManager.arsalaIlaMurshidById(
      resolvedMurshid!.identifier,
      "add the GET /users endpoint",
    );

    assertEquals(success, true);

    /** Step 5: Verify message reached the correct OpenCode session */
    const lastPrompt = opencode._calls.sendPromptAsync[opencode._calls.sendPromptAsync.length - 1];
    assertEquals(lastPrompt.sessionId, session.id);
    assertStringIncludes(lastPrompt.prompt, "GET /users");
    assertEquals(opencode._calls.sendPromptAsync.length, initPromptCount + 1);
  });
});


Deno.test("smoke: question event classified and forwarded to murshid topic", async () => {
  await withTestRepo(async () => {
    const { dispatcher, questionHandler, sessionManager } = buildContext();

    await dispatcher.activateForTicketUrl(
      "TEAM-6000",
      "Funduq Search",
      "https://linear.app/team/issue/TEAM-XXX"
    );

    const session = sessionManager.wajadaJalasatMurshid()[0];

    await questionHandler.handleQuestionAsked({
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
    const { dispatcher, opencode, questionHandler, sessionManager } = buildContext();

    await dispatcher.activateForTicketUrl(
      "TEAM-7000",
      "Bayt Al Hikma",
      "https://linear.app/team/issue/TEAM-XXX"
    );

    const session = sessionManager.wajadaJalasatMurshid()[0];

    await questionHandler.handleQuestionAsked({
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
    const replyCountBefore = opencode._calls.replyToQuestion.length;

    /** Answer the question */
    const success = await questionHandler.handleQuestionCallback("q-smoke-002", "Ijtihad");
    assertEquals(success, true);

    assertEquals(opencode._calls.replyToQuestion.length, replyCountBefore + 1);
    const lastReply = opencode._calls.replyToQuestion[opencode._calls.replyToQuestion.length - 1];
    assertEquals(lastReply.answers[0].selected, ["Ijtihad"]);

    assertEquals(questionHandler.wajadaSualMuallaq("q-smoke-002"), undefined);

    assertEquals(jalabaAseilaGhairMujaba().length, 0);
  });
});


Deno.test("smoke: second murshid activation switches active session", async () => {
  await withTestRepo(async () => {
    const { dispatcher, sessionManager } = buildContext();

    await dispatcher.activateForTicketUrl("TEAM-8001", "Rihla Alpha", "https://linear.app/team/TEAM-8001");
    assertEquals(dispatcher.hawiyyaFaila(), "TEAM-8001");

    await dispatcher.activateForTicketUrl("TEAM-8002", "Rihla Beta", "https://linear.app/team/TEAM-8002");
    assertEquals(dispatcher.hawiyyaFaila(), "TEAM-8002");

    assertEquals(sessionManager.wajadaJalasatMurshid().length, 2);
  });
});
