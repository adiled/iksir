/**
 * Tests for src/daemon/question-handler.ts
 *
 * Tests Sail with:
 * - Mock OpenCodeClient, RasulKharij, MudirJalasat
 * - Real temp DB (for question persistence)
 *
 * Key behaviors tested:
 * - Pure logic: isQuestionCallback, parseQuestionCallback, buildInlineKeyboard
 * - handleQuestionAsked: tamyiz routing (dhahab vs khabath)
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
import { Saail } from "./saail.ts";
import { jalabaAseilaGhairMujaba, adkhalaSual } from "../../db/db.ts";
import type {
  HadathSualMatlub,
  MaalumatSual,
} from "../types.ts";


function makeMaalumatSual(overrides?: Partial<MaalumatSual>): MaalumatSual {
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

function makeEvent(overrides?: Partial<HadathSualMatlub["properties"]>): HadathSualMatlub {
  return {
    type: "question.asked",
    properties: {
      id: "q-001",
      sessionID: "session-001",
      questions: [makeMaalumatSual()],
      ...overrides,
    },
  };
}


Deno.test("isQuestionCallback: returns true for q: prefix", () => {
  const qh = new Saail({
    opencode: mockOpenCodeClient() as never,
    rasul: mockMessenger(),
    mudirJalasat: mockMudirJalasat() as never,
  });

  assertEquals(qh.huwaIstijabaZirrSual("q:abc:label"), true);
  assertEquals(qh.huwaIstijabaZirrSual("q:12345678:Option A"), true);
});

Deno.test("isQuestionCallback: returns false for other prefixes", () => {
  const qh = new Saail({
    opencode: mockOpenCodeClient() as never,
    rasul: mockMessenger(),
    mudirJalasat: mockMudirJalasat() as never,
  });

  assertEquals(qh.huwaIstijabaZirrSual("other:data"), false);
  assertEquals(qh.huwaIstijabaZirrSual(""), false);
  assertEquals(qh.huwaIstijabaZirrSual("qx:abc"), false);
});


Deno.test("wajadaSualMuallaq: returns undefined for unknown", () => {
  const qh = new Saail({
    opencode: mockOpenCodeClient() as never,
    rasul: mockMessenger(),
    mudirJalasat: mockMudirJalasat() as never,
  });

  assertEquals(qh.wajadaSualMuallaq("nonexistent"), undefined);
});


Deno.test("isAwaitingCustomInput: returns false initially", () => {
  const qh = new Saail({
    opencode: mockOpenCodeClient() as never,
    rasul: mockMessenger(),
    mudirJalasat: mockMudirJalasat() as never,
  });

  assertEquals(qh.huwaYantazirIdkhal("TEAM-123"), false);
});


Deno.test("buildInlineKeyboard: creates rows for each option + custom", () => {
  const qh = new Saail({
    opencode: mockOpenCodeClient() as never,
    rasul: mockMessenger(),
    mudirJalasat: mockMudirJalasat() as never,
  });

  const question = makeMaalumatSual();
  const keyboard = qh.banaMafatihSatriyya("q-001", question);

  assertEquals(keyboard.inline_keyboard.length, 3);
  assertEquals(keyboard.inline_keyboard[0][0].text, "Pattern A (Recommended)");
  assertEquals(keyboard.inline_keyboard[1][0].text, "Pattern B");
  assertEquals(keyboard.inline_keyboard[2][0].text, "Type answer...");

  assertEquals(keyboard.inline_keyboard[0][0].callback_data.startsWith("q:"), true);
  assertEquals(keyboard.inline_keyboard[2][0].callback_data.endsWith("__custom__"), true);
});

Deno.test("buildInlineKeyboard: no custom button when custom=false", () => {
  const qh = new Saail({
    opencode: mockOpenCodeClient() as never,
    rasul: mockMessenger(),
    mudirJalasat: mockMudirJalasat() as never,
  });

  const question = makeMaalumatSual({ custom: false });
  const keyboard = qh.banaMafatihSatriyya("q-002", question);

  assertEquals(keyboard.inline_keyboard.length, 2);
});

Deno.test("parseQuestionCallback: resolves registered short IDs", () => {
  const qh = new Saail({
    opencode: mockOpenCodeClient() as never,
    rasul: mockMessenger(),
    mudirJalasat: mockMudirJalasat() as never,
  });

  /** Register via buildInlineKeyboard */
  const question = makeMaalumatSual();
  const keyboard = qh.banaMafatihSatriyya("q-full-uuid-001", question);

  /** Parse the first button's callback_data */
  const parsed = qh.hallalIstijabaZirrSual(keyboard.inline_keyboard[0][0].callback_data);
  assertExists(parsed);
  assertEquals(parsed.questionId, "q-full-uuid-001");
  assertEquals(parsed.selectedLabel.startsWith("Pattern A"), true);
});

Deno.test("parseQuestionCallback: returns null for unknown short IDs", () => {
  const qh = new Saail({
    opencode: mockOpenCodeClient() as never,
    rasul: mockMessenger(),
    mudirJalasat: mockMudirJalasat() as never,
  });

  const result = qh.hallalIstijabaZirrSual("q:unknown1:some label");
  assertEquals(result, null);
});

Deno.test("parseQuestionCallback: handles labels with colons", () => {
  const qh = new Saail({
    opencode: mockOpenCodeClient() as never,
    rasul: mockMessenger(),
    mudirJalasat: mockMudirJalasat() as never,
  });

  /** Register a question with a colon in the label */
  const question = makeMaalumatSual({
    options: [{ label: "Option:With:Colons", description: "test" }],
    custom: false,
  });
  const keyboard = qh.banaMafatihSatriyya("q-colon-test", question);

  const parsed = qh.hallalIstijabaZirrSual(keyboard.inline_keyboard[0][0].callback_data);
  assertExists(parsed);
  assertEquals(parsed.selectedLabel, "Option:With:Colons");
});


Deno.test("handleQuestionAsked: unknown session -> rejects", async () => {
  await withTestDb(async () => {
    const oc = mockOpenCodeClient();
    const qh = new Saail({
      opencode: oc as never,
      rasul: mockMessenger(),
      mudirJalasat: mockMudirJalasat([]) as never,
    });

    await qh.aalajSualMatlub(makeEvent());

    assertEquals(oc._calls.rejectQuestion.length, 1);
    assertEquals(oc._calls.rejectQuestion[0].questionId, "q-001");
  });
});

Deno.test("handleQuestionAsked: empty questions -> rejects", async () => {
  await withTestDb(async () => {
    const oc = mockOpenCodeClient();
    const session = makeSession();
    const qh = new Saail({
      opencode: oc as never,
      rasul: mockMessenger(),
      mudirJalasat: mockMudirJalasat([session]) as never,
    });

    await qh.aalajSualMatlub(makeEvent({ questions: [] }));

    assertEquals(oc._calls.rejectQuestion.length, 1);
  });
});

Deno.test("handleQuestionAsked: KHABATH -> auto-answers + injects guidance", async () => {
  await withTestDb(async () => {
    const oc = mockOpenCodeClient({
      mayyaza: async () => ({
        success: true,
        response: '{"tamyiz":"KHABATH","reason":"obvious","rejection":"Check docs.","autoAnswer":"Pattern B"}',
      }),
    });

    const session = makeSession();
    const messenger = mockMessenger();
    const qh = new Saail({
      opencode: oc as never,
      rasul: messenger,
      mudirJalasat: mockMudirJalasat([session]) as never,
    });

    await qh.aalajSualMatlub(makeEvent());

    assertEquals(oc._calls.replyToQuestion.length, 1);
    assertEquals(oc._calls.replyToQuestion[0].questionId, "q-001");

    assertEquals(oc._calls.sendPromptAsync.length, 1);
    assertEquals(oc._calls.sendPromptAsync[0].prompt.includes("auto-answered"), true);

    assertEquals(messenger._calls.arsalaMunassaq.length, 0);
  });
});

Deno.test("handleQuestionAsked: DHAHAB -> forwards to al-Kimyawi", async () => {
  await withTestDb(async () => {
    const oc = mockOpenCodeClient({
      mayyaza: async () => ({
        success: true,
        response: '{"tamyiz":"DHAHAB","reason":"architecture","rejection":null,"autoAnswer":null}',
      }),
    });

    const session = makeSession();
    seedSession();
    const messenger = mockMessenger();
    let forwardedCount = 0;

    const qh = new Saail({
      opencode: oc as never,
      rasul: messenger,
      mudirJalasat: mockMudirJalasat([session]) as never,
    });

    qh.wadaaIndaTahwilSual(async () => {
      forwardedCount++;
    });

    await qh.aalajSualMatlub(makeEvent());

    assertEquals(messenger._calls.arsalaMunassaq.length, 1);
    const sentChannel = messenger._calls.arsalaMunassaq[0].channel;
    assertEquals(sentChannel, { murshid: "TEAM-1234" });

    /** Should persist question in DB */
    const dbQuestions = jalabaAseilaGhairMujaba();
    assertEquals(dbQuestions.length, 1);
    assertEquals(dbQuestions[0].id, "q-001");

    assertEquals(forwardedCount, 1);

    assertEquals(oc._calls.replyToQuestion.length, 0);

    /** Question should be pending */
    const pending = qh.wajadaSualMuallaq("q-001");
    assertExists(pending);
    assertEquals(pending.huwiyyatMurshid, "TEAM-1234");
  });
});


Deno.test("handleQuestionCallback: answers question + marks in DB", async () => {
  await withTestDb(async () => {
    const oc = mockOpenCodeClient({
      mayyaza: async () => ({
        success: true,
        response: '{"tamyiz":"DHAHAB","reason":"test","rejection":null,"autoAnswer":null}',
      }),
    });

    const session = makeSession();
    seedSession();
    const qh = new Saail({
      opencode: oc as never,
      rasul: mockMessenger(),
      mudirJalasat: mockMudirJalasat([session]) as never,
    });

    await qh.aalajSualMatlub(makeEvent());

    /** Now answer it */
    const success = await qh.aalajIstijabaZirrSual("q-001", "Pattern A (Recommended)");
    assertEquals(success, true);

    assertEquals(oc._calls.replyToQuestion.length, 1);
    assertEquals(oc._calls.replyToQuestion[0].answers[0].selected, ["Pattern A (Recommended)"]);

    assertEquals(qh.wajadaSualMuallaq("q-001"), undefined);

    assertEquals(jalabaAseilaGhairMujaba().length, 0);
  });
});

Deno.test("handleQuestionCallback: unknown question -> returns false", async () => {
  await withTestDb(async () => {
    const oc = mockOpenCodeClient();
    const qh = new Saail({
      opencode: oc as never,
      rasul: mockMessenger(),
      mudirJalasat: mockMudirJalasat() as never,
    });

    const success = await qh.aalajIstijabaZirrSual("nonexistent", "anything");
    assertEquals(success, false);
    assertEquals(oc._calls.replyToQuestion.length, 0);
  });
});


Deno.test("markAwaitingCustomInput + handlePotentialCustomAnswer: end-to-end", async () => {
  await withTestDb(async () => {
    const oc = mockOpenCodeClient({
      mayyaza: async () => ({
        success: true,
        response: '{"tamyiz":"DHAHAB","reason":"test","rejection":null,"autoAnswer":null}',
      }),
    });

    const session = makeSession();
    seedSession();
    const qh = new Saail({
      opencode: oc as never,
      rasul: mockMessenger(),
      mudirJalasat: mockMudirJalasat([session]) as never,
    });

    await qh.aalajSualMatlub(makeEvent());

    await qh.allamIntizarIdkhal("TEAM-1234", "q-001");
    assertEquals(qh.huwaYantazirIdkhal("TEAM-1234"), true);

    /** Submit custom answer */
    const success = await qh.aalajJawabKhass("TEAM-1234", "My custom answer");
    assertEquals(success, true);

    assertEquals(qh.huwaYantazirIdkhal("TEAM-1234"), false);

    assertEquals(oc._calls.replyToQuestion.length, 1);
    assertEquals(oc._calls.replyToQuestion[0].answers[0].custom, "My custom answer");
  });
});

Deno.test("handlePotentialCustomAnswer: returns false when not awaiting", async () => {
  await withTestDb(async () => {
    const qh = new Saail({
      opencode: mockOpenCodeClient() as never,
      rasul: mockMessenger(),
      mudirJalasat: mockMudirJalasat() as never,
    });

    const result = await qh.aalajJawabKhass("TEAM-123", "some text");
    assertEquals(result, false);
  });
});


Deno.test("loadState: rebuilds pendingQuestions from DB", async () => {
  await withTestDb(async () => {
    const session = makeSession({ id: "sess-abc", huwiyya: "TEAM-900" });
    seedSession({ id: "sess-abc", huwiyya: "TEAM-900" });
    const oc = mockOpenCodeClient();

    const qh = new Saail({
      opencode: oc as never,
      rasul: mockMessenger(),
      mudirJalasat: mockMudirJalasat([session]) as never,
    });

    adkhalaSual({
      id: "q-istarjaad",
      sessionId: "sess-abc",
      question: "Should we refactor?",
      options: ["Yes", "No"],
    });

    await qh.hammalaHala();

    /** Should be in pending questions */
    const pending = qh.wajadaSualMuallaq("q-istarjaad");
    assertExists(pending);
    assertEquals(pending.sessionID, "sess-abc");
    assertEquals(pending.huwiyyatMurshid, "TEAM-900");
    assertEquals(pending.questions[0].question, "Should we refactor?");
    assertEquals(pending.questions[0].options.length, 2);
  });
});

Deno.test("loadState: rebuilds callbackIdMap (parseQuestionCallback works after load)", async () => {
  await withTestDb(async () => {
    const session = makeSession({ id: "sess-xyz", huwiyya: "TEAM-950" });
    seedSession({ id: "sess-xyz", huwiyya: "TEAM-950" });
    const oc = mockOpenCodeClient();

    const qh = new Saail({
      opencode: oc as never,
      rasul: mockMessenger(),
      mudirJalasat: mockMudirJalasat([session]) as never,
    });

    adkhalaSual({
      id: "q-callback-test",
      sessionId: "sess-xyz",
      question: "Pick one",
      options: ["A", "B"],
    });

    await qh.hammalaHala();

    /** Build keyboard to get the short ID format */
    const pending = qh.wajadaSualMuallaq("q-callback-test");
    assertExists(pending);

    /**
     * The short callback ID should be registered by loadState via #shortCallbackId
     * We can verify by building a keyboard and parsing its callback
     */
    const keyboard = qh.banaMafatihSatriyya("q-callback-test", pending.questions[0]);
    const parsed = qh.hallalIstijabaZirrSual(keyboard.inline_keyboard[0][0].callback_data);
    assertExists(parsed);
    assertEquals(parsed.questionId, "q-callback-test");
  });
});

Deno.test("loadState: no questions -> no-op", async () => {
  await withTestDb(async () => {
    const qh = new Saail({
      opencode: mockOpenCodeClient() as never,
      rasul: mockMessenger(),
      mudirJalasat: mockMudirJalasat() as never,
    });

    await qh.hammalaHala();
    assertEquals(qh.wajadaSualMuallaq("anything"), undefined);
  });
});

Deno.test("loadState: unknown session -> uses sessionId as huwiyyatMurshid fallback", async () => {
  await withTestDb(async () => {
    seedSession({ id: "sess-unknown", huwiyya: "ORPHAN" });

    const qh = new Saail({
      opencode: mockOpenCodeClient() as never,
      rasul: mockMessenger(),
      mudirJalasat: mockMudirJalasat([]) as never,
    });

    adkhalaSual({
      id: "q-orphan",
      sessionId: "sess-unknown",
      question: "Orphan question",
      options: ["X"],
    });

    await qh.hammalaHala();

    const pending = qh.wajadaSualMuallaq("q-orphan");
    assertExists(pending);
    assertEquals(pending.huwiyyatMurshid, "sess-unknown");
  });
});
