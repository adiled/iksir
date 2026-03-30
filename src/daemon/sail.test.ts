/**
 * Tests for src/daemon/question-handler.ts
 *
 * Tests Sail with:
 * - Mock OpenCodeClient, RasulKharij, MudirJalasat
 * - Real temp DB (for question persistence)
 *
 * Key behaviors tested:
 * - Pure logic: isQuestionCallback, parseQuestionCallback, buildInlineKeyboard
 * - handleQuestionAsked: classification routing (worthy vs cry-baby)
 * - handleQuestionCallback: answer submission + DB persistence
 * - Custom input flow: markAwaitingCustomInput + handlePotentialCustomAnswer
 * - loadState: rebuilds in-memory state from DB
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  withTestDb,
  mockOpenCodeClient,
  mockMessenger,
  mockMudirJalasat,
  makeSession,
  seedSession,
} from "../test-helpers.ts";
import { Sail } from "./question-handler.ts";
import { getUnansweredQuestions, insertQuestion } from "../../db/db.ts";
import type {
  QuestionAskedEvent,
  QuestionInfo,
} from "../types.ts";

// =============================================================================
// Shared fixtures
// =============================================================================

function makeQuestionInfo(overrides?: Partial<QuestionInfo>): QuestionInfo {
  return {
    header: "Choose approach",
    question: "Should we use pattern A or B?",
    options: [
      { label: "Pattern A (Recommended)", description: "Standard approach" },
      { label: "Pattern B", description: "Alternative" },
    ],
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<QuestionAskedEvent["properties"]>): QuestionAskedEvent {
  return {
    type: "question.asked",
    properties: {
      id: "q-001",
      sessionID: "session-001",
      questions: [makeQuestionInfo()],
      ...overrides,
    },
  };
}

// =============================================================================
// Pure logic: isQuestionCallback
// =============================================================================

Deno.test("isQuestionCallback: returns true for q: prefix", () => {
  const qh = new Sail({
    opencode: mockOpenCodeClient() as never,
    messenger: mockMessenger(),
    sessionManager: mockMudirJalasat() as never,
  });

  assertEquals(qh.isQuestionCallback("q:abc:label"), true);
  assertEquals(qh.isQuestionCallback("q:12345678:Option A"), true);
});

Deno.test("isQuestionCallback: returns false for other prefixes", () => {
  const qh = new Sail({
    opencode: mockOpenCodeClient() as never,
    messenger: mockMessenger(),
    sessionManager: mockMudirJalasat() as never,
  });

  assertEquals(qh.isQuestionCallback("other:data"), false);
  assertEquals(qh.isQuestionCallback(""), false);
  assertEquals(qh.isQuestionCallback("qx:abc"), false);
});

// =============================================================================
// Pure logic: getPendingQuestion
// =============================================================================

Deno.test("getPendingQuestion: returns undefined for unknown", () => {
  const qh = new Sail({
    opencode: mockOpenCodeClient() as never,
    messenger: mockMessenger(),
    sessionManager: mockMudirJalasat() as never,
  });

  assertEquals(qh.getPendingQuestion("nonexistent"), undefined);
});

// =============================================================================
// Pure logic: isAwaitingCustomInput
// =============================================================================

Deno.test("isAwaitingCustomInput: returns false initially", () => {
  const qh = new Sail({
    opencode: mockOpenCodeClient() as never,
    messenger: mockMessenger(),
    sessionManager: mockMudirJalasat() as never,
  });

  assertEquals(qh.isAwaitingCustomInput("TEAM-123"), false);
});

// =============================================================================
// buildInlineKeyboard + parseQuestionCallback
// =============================================================================

Deno.test("buildInlineKeyboard: creates rows for each option + custom", () => {
  const qh = new Sail({
    opencode: mockOpenCodeClient() as never,
    messenger: mockMessenger(),
    sessionManager: mockMudirJalasat() as never,
  });

  const question = makeQuestionInfo();
  const keyboard = qh.buildInlineKeyboard("q-001", question);

  // 2 options + 1 custom = 3 rows
  assertEquals(keyboard.inline_keyboard.length, 3);
  assertEquals(keyboard.inline_keyboard[0][0].text, "Pattern A (Recommended)");
  assertEquals(keyboard.inline_keyboard[1][0].text, "Pattern B");
  assertEquals(keyboard.inline_keyboard[2][0].text, "Type answer...");

  // Callback data starts with q:
  assertEquals(keyboard.inline_keyboard[0][0].callback_data.startsWith("q:"), true);
  assertEquals(keyboard.inline_keyboard[2][0].callback_data.endsWith("__custom__"), true);
});

Deno.test("buildInlineKeyboard: no custom button when custom=false", () => {
  const qh = new Sail({
    opencode: mockOpenCodeClient() as never,
    messenger: mockMessenger(),
    sessionManager: mockMudirJalasat() as never,
  });

  const question = makeQuestionInfo({ custom: false });
  const keyboard = qh.buildInlineKeyboard("q-002", question);

  // 2 options, no custom
  assertEquals(keyboard.inline_keyboard.length, 2);
});

Deno.test("parseQuestionCallback: resolves registered short IDs", () => {
  const qh = new Sail({
    opencode: mockOpenCodeClient() as never,
    messenger: mockMessenger(),
    sessionManager: mockMudirJalasat() as never,
  });

  // Register via buildInlineKeyboard
  const question = makeQuestionInfo();
  const keyboard = qh.buildInlineKeyboard("q-full-uuid-001", question);

  // Parse the first button's callback_data
  const parsed = qh.parseQuestionCallback(keyboard.inline_keyboard[0][0].callback_data);
  assertExists(parsed);
  assertEquals(parsed.questionId, "q-full-uuid-001");
  // The label may be truncated but should start with the option label
  assertEquals(parsed.selectedLabel.startsWith("Pattern A"), true);
});

Deno.test("parseQuestionCallback: returns null for unknown short IDs", () => {
  const qh = new Sail({
    opencode: mockOpenCodeClient() as never,
    messenger: mockMessenger(),
    sessionManager: mockMudirJalasat() as never,
  });

  const result = qh.parseQuestionCallback("q:unknown1:some label");
  assertEquals(result, null);
});

Deno.test("parseQuestionCallback: handles labels with colons", () => {
  const qh = new Sail({
    opencode: mockOpenCodeClient() as never,
    messenger: mockMessenger(),
    sessionManager: mockMudirJalasat() as never,
  });

  // Register a question with a colon in the label
  const question = makeQuestionInfo({
    options: [{ label: "Option:With:Colons", description: "test" }],
    custom: false,
  });
  const keyboard = qh.buildInlineKeyboard("q-colon-test", question);

  const parsed = qh.parseQuestionCallback(keyboard.inline_keyboard[0][0].callback_data);
  assertExists(parsed);
  assertEquals(parsed.selectedLabel, "Option:With:Colons");
});

// =============================================================================
// handleQuestionAsked: classification routing
// =============================================================================

Deno.test("handleQuestionAsked: unknown session -> rejects", async () => {
  await withTestDb(async () => {
    const oc = mockOpenCodeClient();
    const qh = new Sail({
      opencode: oc as never,
      messenger: mockMessenger(),
      sessionManager: mockMudirJalasat([]) as never, // no sessions
    });

    await qh.handleQuestionAsked(makeEvent());

    assertEquals(oc._calls.rejectQuestion.length, 1);
    assertEquals(oc._calls.rejectQuestion[0].questionId, "q-001");
  });
});

Deno.test("handleQuestionAsked: empty questions -> rejects", async () => {
  await withTestDb(async () => {
    const oc = mockOpenCodeClient();
    const session = makeSession();
    const qh = new Sail({
      opencode: oc as never,
      messenger: mockMessenger(),
      sessionManager: mockMudirJalasat([session]) as never,
    });

    await qh.handleQuestionAsked(makeEvent({ questions: [] }));

    assertEquals(oc._calls.rejectQuestion.length, 1);
  });
});

Deno.test("handleQuestionAsked: CRY_BABY -> auto-answers + injects guidance", async () => {
  // Set up fixture for classifier (AGENTS.md path must be set from classifier_test
  // or pre-existing — classifier module caches at module level)
  await withTestDb(async () => {
    const oc = mockOpenCodeClient({
      // classifyQuestion calls opencode.classify internally
      classify: async () => ({
        success: true,
        response: '{"classification":"CRY_BABY","reason":"obvious","rejection":"Check docs.","autoAnswer":"Pattern B"}',
      }),
    });

    const session = makeSession();
    const messenger = mockMessenger();
    const qh = new Sail({
      opencode: oc as never,
      messenger,
      sessionManager: mockMudirJalasat([session]) as never,
    });

    await qh.handleQuestionAsked(makeEvent());

    // Should auto-answer via replyToQuestion
    assertEquals(oc._calls.replyToQuestion.length, 1);
    assertEquals(oc._calls.replyToQuestion[0].questionId, "q-001");

    // Should inject guidance via sendPromptAsync
    assertEquals(oc._calls.sendPromptAsync.length, 1);
    assertEquals(oc._calls.sendPromptAsync[0].prompt.includes("auto-answered"), true);

    // Should NOT forward to messenger
    assertEquals(messenger._calls.arsalaMunassaq.length, 0);
  });
});

Deno.test("handleQuestionAsked: WORTHY -> forwards to operator", async () => {
  await withTestDb(async () => {
    const oc = mockOpenCodeClient({
      classify: async () => ({
        success: true,
        response: '{"classification":"WORTHY","reason":"architecture","rejection":null,"autoAnswer":null}',
      }),
    });

    const session = makeSession();
    seedSession(); // FK: questions.session_id -> sessions.id
    const messenger = mockMessenger();
    let forwardedCount = 0;

    const qh = new Sail({
      opencode: oc as never,
      messenger,
      sessionManager: mockMudirJalasat([session]) as never,
    });

    qh.setOnQuestionForwarded(async () => {
      forwardedCount++;
    });

    await qh.handleQuestionAsked(makeEvent());

    // Should send formatted message via messenger
    assertEquals(messenger._calls.arsalaMunassaq.length, 1);
    const sentChannel = messenger._calls.arsalaMunassaq[0].channel;
    assertEquals(sentChannel, { murshid: "TEAM-1234" });

    // Should persist question in DB
    const dbQuestions = getUnansweredQuestions();
    assertEquals(dbQuestions.length, 1);
    assertEquals(dbQuestions[0].id, "q-001");

    // Should call onQuestionForwarded callback
    assertEquals(forwardedCount, 1);

    // Should NOT auto-answer
    assertEquals(oc._calls.replyToQuestion.length, 0);

    // Question should be pending
    const pending = qh.getPendingQuestion("q-001");
    assertExists(pending);
    assertEquals(pending.huwiyyatMurshid, "TEAM-1234");
  });
});

// =============================================================================
// handleQuestionCallback
// =============================================================================

Deno.test("handleQuestionCallback: answers question + marks in DB", async () => {
  await withTestDb(async () => {
    const oc = mockOpenCodeClient({
      classify: async () => ({
        success: true,
        response: '{"classification":"WORTHY","reason":"test","rejection":null,"autoAnswer":null}',
      }),
    });

    const session = makeSession();
    seedSession(); // FK: questions.session_id -> sessions.id
    const qh = new Sail({
      opencode: oc as never,
      messenger: mockMessenger(),
      sessionManager: mockMudirJalasat([session]) as never,
    });

    // Forward a question first to make it pending
    await qh.handleQuestionAsked(makeEvent());

    // Now answer it
    const success = await qh.handleQuestionCallback("q-001", "Pattern A (Recommended)");
    assertEquals(success, true);

    // Should have called replyToQuestion
    assertEquals(oc._calls.replyToQuestion.length, 1);
    assertEquals(oc._calls.replyToQuestion[0].answers[0].selected, ["Pattern A (Recommended)"]);

    // Should be removed from pending
    assertEquals(qh.getPendingQuestion("q-001"), undefined);

    // DB should show 0 unanswered
    assertEquals(getUnansweredQuestions().length, 0);
  });
});

Deno.test("handleQuestionCallback: unknown question -> returns false", async () => {
  await withTestDb(async () => {
    const oc = mockOpenCodeClient();
    const qh = new Sail({
      opencode: oc as never,
      messenger: mockMessenger(),
      sessionManager: mockMudirJalasat() as never,
    });

    const success = await qh.handleQuestionCallback("nonexistent", "anything");
    assertEquals(success, false);
    assertEquals(oc._calls.replyToQuestion.length, 0);
  });
});

// =============================================================================
// Custom input flow
// =============================================================================

Deno.test("markAwaitingCustomInput + handlePotentialCustomAnswer: end-to-end", async () => {
  await withTestDb(async () => {
    const oc = mockOpenCodeClient({
      classify: async () => ({
        success: true,
        response: '{"classification":"WORTHY","reason":"test","rejection":null,"autoAnswer":null}',
      }),
    });

    const session = makeSession();
    seedSession(); // FK: questions.session_id -> sessions.id
    const qh = new Sail({
      opencode: oc as never,
      messenger: mockMessenger(),
      sessionManager: mockMudirJalasat([session]) as never,
    });

    // Forward a question
    await qh.handleQuestionAsked(makeEvent());

    // Mark as awaiting custom input
    await qh.markAwaitingCustomInput("TEAM-1234", "q-001");
    assertEquals(qh.isAwaitingCustomInput("TEAM-1234"), true);

    // Submit custom answer
    const success = await qh.handlePotentialCustomAnswer("TEAM-1234", "My custom answer");
    assertEquals(success, true);

    // Should no longer be awaiting
    assertEquals(qh.isAwaitingCustomInput("TEAM-1234"), false);

    // Should have replied with custom text
    assertEquals(oc._calls.replyToQuestion.length, 1);
    // Custom answers use __custom__ label with custom text
    assertEquals(oc._calls.replyToQuestion[0].answers[0].custom, "My custom answer");
  });
});

Deno.test("handlePotentialCustomAnswer: returns false when not awaiting", async () => {
  await withTestDb(async () => {
    const qh = new Sail({
      opencode: mockOpenCodeClient() as never,
      messenger: mockMessenger(),
      sessionManager: mockMudirJalasat() as never,
    });

    const result = await qh.handlePotentialCustomAnswer("TEAM-123", "some text");
    assertEquals(result, false);
  });
});

// =============================================================================
// loadState: rebuild from DB
// =============================================================================

Deno.test("loadState: rebuilds pendingQuestions from DB", async () => {
  await withTestDb(async () => {
    const session = makeSession({ id: "sess-abc", identifier: "TEAM-900" });
    seedSession({ id: "sess-abc", identifier: "TEAM-900" }); // FK
    const oc = mockOpenCodeClient();

    const qh = new Sail({
      opencode: oc as never,
      messenger: mockMessenger(),
      sessionManager: mockMudirJalasat([session]) as never,
    });

    // Insert a question directly in DB (simulating prior run)
    insertQuestion({
      id: "q-istarjaad",
      sessionId: "sess-abc",
      question: "Should we refactor?",
      options: ["Yes", "No"],
    });

    // Load state
    await qh.loadState();

    // Should be in pending questions
    const pending = qh.getPendingQuestion("q-istarjaad");
    assertExists(pending);
    assertEquals(pending.sessionID, "sess-abc");
    assertEquals(pending.huwiyyatMurshid, "TEAM-900");
    assertEquals(pending.questions[0].question, "Should we refactor?");
    assertEquals(pending.questions[0].options.length, 2);
  });
});

Deno.test("loadState: rebuilds callbackIdMap (parseQuestionCallback works after load)", async () => {
  await withTestDb(async () => {
    const session = makeSession({ id: "sess-xyz", identifier: "TEAM-950" });
    seedSession({ id: "sess-xyz", identifier: "TEAM-950" }); // FK
    const oc = mockOpenCodeClient();

    const qh = new Sail({
      opencode: oc as never,
      messenger: mockMessenger(),
      sessionManager: mockMudirJalasat([session]) as never,
    });

    // Insert question in DB
    insertQuestion({
      id: "q-callback-test",
      sessionId: "sess-xyz",
      question: "Pick one",
      options: ["A", "B"],
    });

    await qh.loadState();

    // Build keyboard to get the short ID format
    const pending = qh.getPendingQuestion("q-callback-test");
    assertExists(pending);

    // The short callback ID should be registered by loadState via #shortCallbackId
    // We can verify by building a keyboard and parsing its callback
    const keyboard = qh.buildInlineKeyboard("q-callback-test", pending.questions[0]);
    const parsed = qh.parseQuestionCallback(keyboard.inline_keyboard[0][0].callback_data);
    assertExists(parsed);
    assertEquals(parsed.questionId, "q-callback-test");
  });
});

Deno.test("loadState: no questions -> no-op", async () => {
  await withTestDb(async () => {
    const qh = new Sail({
      opencode: mockOpenCodeClient() as never,
      messenger: mockMessenger(),
      sessionManager: mockMudirJalasat() as never,
    });

    // Should not throw
    await qh.loadState();
    assertEquals(qh.getPendingQuestion("anything"), undefined);
  });
});

Deno.test("loadState: unknown session -> uses sessionId as huwiyyatMurshid fallback", async () => {
  await withTestDb(async () => {
    // Session exists in DB (FK) but not in sessionManager's in-memory list
    seedSession({ id: "sess-unknown", identifier: "ORPHAN" });

    const qh = new Sail({
      opencode: mockOpenCodeClient() as never,
      messenger: mockMessenger(),
      sessionManager: mockMudirJalasat([]) as never, // no sessions in-memory
    });

    insertQuestion({
      id: "q-orphan",
      sessionId: "sess-unknown",
      question: "Orphan question",
      options: ["X"],
    });

    await qh.loadState();

    const pending = qh.getPendingQuestion("q-orphan");
    assertExists(pending);
    // Falls back to sessionId when no orchestrator found
    assertEquals(pending.huwiyyatMurshid, "sess-unknown");
  });
});
