/**
 * Smoke Test — End-to-end daemon pipeline validation
 *
 * Exercises the full inbound message pipeline with real Munadi,
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
import { MudirJalasat } from "../src/daemon/session-manager.ts";
import { Munadi } from "../src/daemon/dispatcher.ts";
import { Sail } from "../src/daemon/question-handler.ts";
import type { NiyyaMuhallala } from "../src/daemon/intent-resolver.ts";
import { getUnansweredQuestions } from "../db/db.ts";

// =============================================================================
// Helpers: Build a mini daemon context with mocks at external boundaries
// =============================================================================

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
    config,
    sessionManager,
    intentResolver: intentResolver as never,
    messenger,
  });

  const questionHandler = new Sail({
    opencode: opencode as never,
    messenger,
    sessionManager: sessionManager as never,
  });

  return { config, opencode, telegram, messenger, sessionManager, dispatcher, intentResolver, questionHandler };
}

// =============================================================================
// Scenario 1: /status with no sessions
// =============================================================================

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

// =============================================================================
// Scenario 2: Spawn murshid via activateForTicketUrl
// =============================================================================

Deno.test("smoke: activateForTicketUrl creates session + topic", async () => {
  await withTestRepo(async () => {
    const { dispatcher, opencode, telegram, sessionManager } = buildContext();

    const result = await dispatcher.activateForTicketUrl(
      "TEAM-1000",
      "Bab Al Shams Portal",
      "https://linear.app/team/issue/TEAM-1000",
    );

    assertEquals(result.handled, true);
    assertExists(result.response);
    assertStringIncludes(result.response!, "TEAM-1000");
    assertStringIncludes(result.response!, "Bab Al Shams Portal");

    // OpenCode: session should have been created
    assertEquals(opencode._calls.khalaqaJalsa.length, 1);
    assertStringIncludes(opencode._calls.khalaqaJalsa[0].title, "TEAM-1000");

    // Session manager should track the session
    const sessions = sessionManager.getMurshidSessions();
    assertEquals(sessions.length, 1);
    assertEquals(sessions[0].identifier, "TEAM-1000");
    assertEquals(sessions[0].status, "fail");

    // Telegram: topic should have been created
    assertEquals(telegram._calls.createForumTopic.length, 1);
    assertStringIncludes(telegram._calls.createForumTopic[0].name, "TEAM-1000");

    // Init message should have been sent to murshid via sendPromptAsync
    const promptCalls = opencode._calls.sendPromptAsync;
    assertEquals(promptCalls.length >= 1, true);
  });
});

// =============================================================================
// Scenario 3: Route message to active murshid
// =============================================================================

Deno.test("smoke: message routed to active murshid via sendPromptAsync", async () => {
  await withTestRepo(async () => {
    const { dispatcher, opencode, sessionManager } = buildContext();

    // Step 1: Create an murshid
    await dispatcher.activateForTicketUrl(
      "TEAM-2000",
      "Alf Layla Migration",
      "https://linear.app/team/issue/TEAM-2000",
    );

    // Clear the init prompt calls so we can track the next one
    const initPromptCount = opencode._calls.sendPromptAsync.length;

    // Step 2: Send a message to the active murshid
    const session = sessionManager.getMurshidSessions()[0];
    const success = await sessionManager.sendToMurshidById(
      session.identifier,
      "implement the null safety checks",
    );

    assertEquals(success, true);

    // Should have sent one more prompt to the session
    assertEquals(opencode._calls.sendPromptAsync.length, initPromptCount + 1);
    const lastPrompt = opencode._calls.sendPromptAsync[opencode._calls.sendPromptAsync.length - 1];
    assertEquals(lastPrompt.sessionId, session.id);
    assertStringIncludes(lastPrompt.prompt, "null safety");
  });
});

// =============================================================================
// Scenario 4: /status with active session shows session info
// =============================================================================

Deno.test("smoke: /status with active session shows identifier", async () => {
  await withTestRepo(async () => {
    const { dispatcher } = buildContext();

    // Create an murshid first
    await dispatcher.activateForTicketUrl(
      "TEAM-3000",
      "Qasr Al Hikma",
      "https://linear.app/team/issue/TEAM-3000",
    );

    // Now check status
    const result = await dispatcher.handleDispatchMessage({
      source: "telegram",
      text: "/status",
    });

    assertEquals(result.handled, true);
    assertExists(result.response);
    assertStringIncludes(result.response!, "TEAM-3000");
  });
});

// =============================================================================
// Scenario 5: Dispatch message triggers intent resolution
// =============================================================================

Deno.test("smoke: dispatch message uses intent resolver for natural language", async () => {
  await withTestRepo(async () => {
    const { dispatcher, intentResolver, opencode } = buildContext();

    // Set up the intent resolver to return a resolved entity
    intentResolver._nextResult = {
      status: "resolved",
      entity: {
        type: "ticket",
        id: "issue-abc",
        identifier: "TEAM-4000",
        title: "Majlis Refactor",
        url: "https://linear.app/team/issue/TEAM-4000",
      },
      rawText: "work on the majlis refactor",
      method: "llm_search",
      action: "proceed",
    } as NiyyaMuhallala;

    const result = await dispatcher.handleDispatchMessage({
      source: "telegram",
      text: "work on the majlis refactor",
    });

    // Intent resolver should have been called
    assertEquals(intentResolver._calls.length, 1);
    assertEquals(intentResolver._calls[0].text, "work on the majlis refactor");

    // Should create/activate an murshid
    assertEquals(result.handled, true);
    assertExists(result.response);

    // OpenCode session should have been created
    assertEquals(opencode._calls.khalaqaJalsa.length, 1);
  });
});

// =============================================================================
// Scenario 6: Murshid topic routing
// =============================================================================

Deno.test("smoke: murshid topic message routes to correct session", async () => {
  await withTestRepo(async () => {
    const { dispatcher, opencode, sessionManager } = buildContext();

    // Step 1: Create murshid (creates topic)
    await dispatcher.activateForTicketUrl(
      "TEAM-5000",
      "Diwan Al Rasail",
      "https://linear.app/team/issue/TEAM-5000",
    );

    const session = sessionManager.getMurshidSessions()[0];
    assertExists(session);

    // Step 2: Verify the session has a channel (topic was created)
    assertEquals(Object.keys(session.channels).length > 0, true);
    const topicId = session.channels["telegram"];
    assertExists(topicId);

    // Step 3: Simulate main.ts topic routing
    const resolvedMurshid = sessionManager.getMurshidByChannel("telegram", topicId);
    assertExists(resolvedMurshid);
    assertEquals(resolvedMurshid!.identifier, "TEAM-5000");

    // Step 4: Route the message
    const initPromptCount = opencode._calls.sendPromptAsync.length;
    const success = await sessionManager.sendToMurshidById(
      resolvedMurshid!.identifier,
      "add the GET /users endpoint",
    );

    assertEquals(success, true);

    // Step 5: Verify message reached the correct OpenCode session
    const lastPrompt = opencode._calls.sendPromptAsync[opencode._calls.sendPromptAsync.length - 1];
    assertEquals(lastPrompt.sessionId, session.id);
    assertStringIncludes(lastPrompt.prompt, "GET /users");
    assertEquals(opencode._calls.sendPromptAsync.length, initPromptCount + 1);
  });
});

// =============================================================================
// Scenario 7: Question event -> classify -> forward to messenger
// =============================================================================

Deno.test("smoke: question event classified and forwarded to murshid topic", async () => {
  await withTestRepo(async () => {
    const { dispatcher, questionHandler, sessionManager } = buildContext();

    // Step 1: Create murshid
    await dispatcher.activateForTicketUrl(
      "TEAM-6000",
      "Funduq Search",
      "https://linear.app/team/issue/TEAM-6000",
    );

    const session = sessionManager.getMurshidSessions()[0];

    // Step 2: Simulate a question event
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

    // Step 3: Verify question is pending
    const pending = questionHandler.getPendingQuestion("q-smoke-001");
    assertExists(pending);
    assertEquals(pending.huwiyyatMurshid, "TEAM-6000");

    // Step 4: Verify question was persisted in DB
    const dbQuestions = getUnansweredQuestions();
    assertEquals(dbQuestions.length, 1);
    assertEquals(dbQuestions[0].id, "q-smoke-001");
  });
});

// =============================================================================
// Scenario 8: Question callback -> answer submitted
// =============================================================================

Deno.test("smoke: question answered via callback", async () => {
  await withTestRepo(async () => {
    const { dispatcher, opencode, questionHandler, sessionManager } = buildContext();

    // Create murshid + forward question
    await dispatcher.activateForTicketUrl(
      "TEAM-7000",
      "Bayt Al Hikma",
      "https://linear.app/team/issue/TEAM-7000",
    );

    const session = sessionManager.getMurshidSessions()[0];

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

    // Clear reply calls from auto-answer attempts
    const replyCountBefore = opencode._calls.replyToQuestion.length;

    // Answer the question
    const success = await questionHandler.handleQuestionCallback("q-smoke-002", "Ijtihad");
    assertEquals(success, true);

    // Verify OpenCode received the answer
    assertEquals(opencode._calls.replyToQuestion.length, replyCountBefore + 1);
    const lastReply = opencode._calls.replyToQuestion[opencode._calls.replyToQuestion.length - 1];
    assertEquals(lastReply.answers[0].selected, ["Ijtihad"]);

    // Question should no longer be pending
    assertEquals(questionHandler.getPendingQuestion("q-smoke-002"), undefined);

    // DB should show 0 unanswered
    assertEquals(getUnansweredQuestions().length, 0);
  });
});

// =============================================================================
// Scenario 9: Multiple murshidun — switch and queue
// =============================================================================

Deno.test("smoke: second murshid activation switches active session", async () => {
  await withTestRepo(async () => {
    const { dispatcher, sessionManager } = buildContext();

    // Create first murshid
    await dispatcher.activateForTicketUrl("TEAM-8001", "Rihla Alpha", "https://linear.app/team/issue/TEAM-8001");
    assertEquals(dispatcher.getActiveIdentifier(), "TEAM-8001");

    // Create second murshid — should switch
    await dispatcher.activateForTicketUrl("TEAM-8002", "Rihla Beta", "https://linear.app/team/issue/TEAM-8002");
    assertEquals(dispatcher.getActiveIdentifier(), "TEAM-8002");

    // Both sessions should exist
    assertEquals(sessionManager.getMurshidSessions().length, 2);
  });
});
