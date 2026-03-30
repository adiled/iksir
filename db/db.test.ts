import { assertEquals } from "@std/assert";
import {
  initDatabase,
  closeDatabase,
  upsertSession,
  getAllSessions,
  upsertChannel,
  getChannel,
  getChannelsForSession,
  jalabJalsaByChannel,
  mahaqaQanat,
  insertEvent,
  getUnprocessedEvents,
  markEventProcessed,
  insertQuestion,
  getUnansweredQuestions,
  markQuestionAnswered,
  addQararSijill,
  getQararSijills,
  upsertPendingDemand,
  getPendingDemands,
  removePendingDemand,
} from "./db.ts";

// =============================================================================
// Test setup — use a temp directory for each test
// =============================================================================

async function withTestDb(fn: () => Promise<void> | void): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "munadi-test-" });
  Deno.env.set("MUNADI_STATE_DIR", tempDir);
  try {
    await initDatabase();
    await fn();
  } finally {
    closeDatabase();
    Deno.env.delete("MUNADI_STATE_DIR");
    await Deno.remove(tempDir, { recursive: true });
  }
}

// =============================================================================
// Sessions
// =============================================================================

Deno.test("sessions: upsert and retrieve", async () => {
  await withTestDb(() => {
    upsertSession({
      id: "sess-1",
      identifier: "TEAM-200",
      title: "Auto-login feature",
      type: "epic",
      status: "fail",
      branch: "epic/stay-2189-auto-login",
      createdAt: "2026-03-01T00:00:00Z",
      lastMessageAt: "2026-03-01T12:00:00Z",
      metadata: { activePRs: [] },
    });

    const sessions = getAllSessions();
    assertEquals(sessions.length, 1);
    assertEquals(sessions[0].identifier, "TEAM-200");
    assertEquals(sessions[0].title, "Auto-login feature");
    assertEquals(sessions[0].type, "epic");
    assertEquals(sessions[0].status, "fail");
  });
});

Deno.test("sessions: upsert updates existing", async () => {
  await withTestDb(() => {
    upsertSession({
      id: "sess-1",
      identifier: "TEAM-200",
      title: "Auto-login",
      type: "epic",
      status: "fail",
      branch: "epic/stay-2189",
      createdAt: "2026-03-01T00:00:00Z",
      lastMessageAt: "2026-03-01T12:00:00Z",
      metadata: {},
    });

    upsertSession({
      id: "sess-1",
      identifier: "TEAM-200",
      title: "Auto-login v2",
      type: "epic",
      status: "masdud",
      branch: "epic/stay-2189",
      blockedReason: "Missing specs",
      createdAt: "2026-03-01T00:00:00Z",
      lastMessageAt: "2026-03-02T12:00:00Z",
      metadata: {},
    });

    const sessions = getAllSessions();
    assertEquals(sessions.length, 1);
    assertEquals(sessions[0].title, "Auto-login v2");
    assertEquals(sessions[0].status, "masdud");
    assertEquals(sessions[0].blocked_reason, "Missing specs");
  });
});

// =============================================================================
// Channels
// =============================================================================

Deno.test("channels: upsert and get", async () => {
  await withTestDb(() => {
    upsertChannel("TEAM-200", "telegram", "12345");
    const channelId = getChannel("TEAM-200", "telegram");
    assertEquals(channelId, "12345");
  });
});

Deno.test("channels: get returns null for missing", async () => {
  await withTestDb(() => {
    const channelId = getChannel("NONEXISTENT", "telegram");
    assertEquals(channelId, null);
  });
});

Deno.test("channels: upsert updates existing", async () => {
  await withTestDb(() => {
    upsertChannel("TEAM-200", "telegram", "12345");
    upsertChannel("TEAM-200", "telegram", "67890");
    assertEquals(getChannel("TEAM-200", "telegram"), "67890");
  });
});

Deno.test("channels: getChannelsForSession returns all providers", async () => {
  await withTestDb(() => {
    upsertChannel("TEAM-200", "telegram", "12345");
    upsertChannel("TEAM-200", "slack", "C07ABC");

    const channels = getChannelsForSession("TEAM-200");
    assertEquals(channels, { telegram: "12345", slack: "C07ABC" });
  });
});

Deno.test("channels: getChannelsForSession returns empty for unknown", async () => {
  await withTestDb(() => {
    const channels = getChannelsForSession("NONEXISTENT");
    assertEquals(channels, {});
  });
});

Deno.test("channels: jalabJalsaByChannel reverse lookup", async () => {
  await withTestDb(() => {
    upsertChannel("TEAM-200", "telegram", "12345");
    upsertChannel("TEAM-300", "telegram", "67890");

    assertEquals(jalabJalsaByChannel("telegram", "12345"), "TEAM-200");
    assertEquals(jalabJalsaByChannel("telegram", "67890"), "TEAM-300");
    assertEquals(jalabJalsaByChannel("telegram", "99999"), null);
  });
});

Deno.test("channels: mahaqaQanat", async () => {
  await withTestDb(() => {
    upsertChannel("TEAM-200", "telegram", "12345");
    assertEquals(getChannel("TEAM-200", "telegram"), "12345");

    mahaqaQanat("TEAM-200", "telegram");
    assertEquals(getChannel("TEAM-200", "telegram"), null);
  });
});

Deno.test("channels: uniqueness per session+provider", async () => {
  await withTestDb(() => {
    // Same session, different providers — both should exist
    upsertChannel("TEAM-200", "telegram", "111");
    upsertChannel("TEAM-200", "slack", "222");
    assertEquals(getChannel("TEAM-200", "telegram"), "111");
    assertEquals(getChannel("TEAM-200", "slack"), "222");

    // Different sessions, same provider — both should exist
    upsertChannel("TEAM-300", "telegram", "333");
    assertEquals(getChannel("TEAM-300", "telegram"), "333");
    assertEquals(getChannel("TEAM-200", "telegram"), "111");
  });
});

// =============================================================================
// Events
// =============================================================================

Deno.test("events: insert and retrieve unprocessed", async () => {
  await withTestDb(() => {
    insertEvent("pm", "mun_create_branch", { branch: "epic/test" }, "orch-1");

    const events = getUnprocessedEvents("pm");
    assertEquals(events.length, 1);

    const payload = JSON.parse(events[0].payload);
    assertEquals(payload.branch, "epic/test");
  });
});

Deno.test("events: markEventProcessed removes from unprocessed", async () => {
  await withTestDb(() => {
    insertEvent("pm", "mun_commit", { message: "test" });

    let events = getUnprocessedEvents("pm");
    assertEquals(events.length, 1);

    markEventProcessed(events[0].id);

    events = getUnprocessedEvents("pm");
    assertEquals(events.length, 0);
  });
});

Deno.test("events: ordering is by creation time", async () => {
  await withTestDb(() => {
    insertEvent("pm", "tool_a", { order: 1 });
    insertEvent("pm", "tool_b", { order: 2 });
    insertEvent("pm", "tool_c", { order: 3 });

    const events = getUnprocessedEvents("pm");
    assertEquals(events.length, 3);
    assertEquals(JSON.parse(events[0].payload).order, 1);
    assertEquals(JSON.parse(events[2].payload).order, 3);
  });
});

// =============================================================================
// Questions
// =============================================================================

Deno.test("questions: insert and retrieve unanswered", async () => {
  await withTestDb(() => {
    // Need a session first (foreign key)
    upsertSession({
      id: "sess-1",
      identifier: "TEAM-200",
      title: "Test",
      type: "epic",
      status: "fail",
      branch: "",
      createdAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      metadata: {},
    });

    insertQuestion({
      id: "q-1",
      sessionId: "sess-1",
      question: "Which approach?",
      options: ["A", "B", "C"],
    });

    const questions = getUnansweredQuestions();
    assertEquals(questions.length, 1);
    assertEquals(questions[0].question, "Which approach?");
    assertEquals(JSON.parse(questions[0].options!), ["A", "B", "C"]);
  });
});

Deno.test("questions: markQuestionAnswered removes from unanswered", async () => {
  await withTestDb(() => {
    upsertSession({
      id: "sess-1",
      identifier: "TEAM-200",
      title: "Test",
      type: "epic",
      status: "fail",
      branch: "",
      createdAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      metadata: {},
    });

    insertQuestion({
      id: "q-1",
      sessionId: "sess-1",
      question: "Which approach?",
      options: ["A", "B"],
    });

    markQuestionAnswered("q-1", "A");

    const questions = getUnansweredQuestions();
    assertEquals(questions.length, 0);
  });
});

// =============================================================================
// Diary decisions
// =============================================================================

Deno.test("diary: add and query decisions", async () => {
  await withTestDb(() => {
    addQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "architecture",
      decision: "Use REST over GraphQL",
      reasoning: "Simpler for this use case",
    });

    addQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "planning",
      decision: "Split into 3 tickets",
      reasoning: "Each screen is independent",
    });

    const all = getQararSijills({ huwiyyatMurshid: "TEAM-200" });
    assertEquals(all.length, 2);
    // Both decisions present (order may vary when timestamps are identical)
    const types = all.map(d => d.type).sort();
    assertEquals(types, ["architecture", "planning"]);
  });
});

Deno.test("diary: filter by type", async () => {
  await withTestDb(() => {
    addQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "architecture",
      decision: "d1",
      reasoning: "r1",
    });
    addQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "planning",
      decision: "d2",
      reasoning: "r2",
    });

    const arch = getQararSijills({ type: "architecture" });
    assertEquals(arch.length, 1);
    assertEquals(arch[0].decision, "d1");
  });
});

Deno.test("diary: search in decision and reasoning", async () => {
  await withTestDb(() => {
    addQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "architecture",
      decision: "Use REST for the widget API",
      reasoning: "Performance matters",
    });
    addQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "planning",
      decision: "Something else",
      reasoning: "Unrelated",
    });

    const results = getQararSijills({ search: "widget" });
    assertEquals(results.length, 1);
    assertEquals(results[0].decision, "Use REST for the widget API");
  });
});

Deno.test("diary: limit parameter", async () => {
  await withTestDb(() => {
    for (let i = 0; i < 5; i++) {
      addQararSijill({
        huwiyyatMurshid: "TEAM-200",
        type: "planning",
        decision: `decision ${i}`,
        reasoning: `reasoning ${i}`,
      });
    }

    const limited = getQararSijills({ limit: 3 });
    assertEquals(limited.length, 3);
  });
});

Deno.test("diary: collective query (no huwiyyatMurshid filter)", async () => {
  await withTestDb(() => {
    addQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "architecture",
      decision: "d1",
      reasoning: "r1",
    });
    addQararSijill({
      huwiyyatMurshid: "TEAM-300",
      type: "architecture",
      decision: "d2",
      reasoning: "r2",
    });

    const all = getQararSijills({});
    assertEquals(all.length, 2);
  });
});

// =============================================================================
// Pending demands
// =============================================================================

Deno.test("demands: upsert and retrieve", async () => {
  await withTestDb(() => {
    upsertPendingDemand("TEAM-200", "Need control for PR", "normal");

    const demands = getPendingDemands();
    assertEquals(demands.length, 1);
    assertEquals(demands[0].huwiyat_murshid, "TEAM-200");
    assertEquals(demands[0].reason, "Need control for PR");
    assertEquals(demands[0].priority, "normal");
  });
});

Deno.test("demands: urgent sorted before normal", async () => {
  await withTestDb(() => {
    upsertPendingDemand("TEAM-300", "Less important", "normal");
    upsertPendingDemand("TEAM-200", "Critical blocker", "urgent");

    const demands = getPendingDemands();
    assertEquals(demands.length, 2);
    assertEquals(demands[0].huwiyat_murshid, "TEAM-200"); // urgent first
    assertEquals(demands[1].huwiyat_murshid, "TEAM-300");
  });
});

Deno.test("demands: upsert replaces existing for same murshid", async () => {
  await withTestDb(() => {
    upsertPendingDemand("TEAM-200", "Original reason", "normal");
    upsertPendingDemand("TEAM-200", "Updated reason", "urgent");

    const demands = getPendingDemands();
    assertEquals(demands.length, 1);
    assertEquals(demands[0].reason, "Updated reason");
    assertEquals(demands[0].priority, "urgent");
  });
});

Deno.test("demands: removePendingDemand", async () => {
  await withTestDb(() => {
    upsertPendingDemand("TEAM-200", "test", "normal");
    assertEquals(getPendingDemands().length, 1);

    removePendingDemand("TEAM-200");
    assertEquals(getPendingDemands().length, 0);
  });
});

// =============================================================================
// Idempotency
// =============================================================================

Deno.test("initDatabase: idempotent — safe to call twice", async () => {
  await withTestDb(async () => {
    // Already tahyiad by withTestDb, call again
    await initDatabase();
    // Should not throw, tables should still work
    upsertChannel("test", "telegram", "123");
    assertEquals(getChannel("test", "telegram"), "123");
  });
});
