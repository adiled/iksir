import { assertEquals } from "@std/assert";
import {
  baddaaQaidatBayanat,
  aghlaaqQaidatBayanat,
  haddathaAwAdkhalaJalsa,
  jalabaKullJalasat,
  haddathaAwAdkhalaQanat,
  jalabaQanat,
  jalabaQanatsForSession,
  jalabJalsaByChannel,
  mahaqaQanat,
  adkhalaHadath,
  jalabaAhdathGhairMuaalaja,
  allamaHadathMuaalaj,
  adkhalaSual,
  jalabaAseilaGhairMujaba,
  allamaJawabSual,
  adhafaQararSijill,
  jalabaQararatSijill,
  haddathaAwAdkhalaMatlabMuallaq,
  jalabaMatalebMuallaq,
  removePendingDemand,
} from "./db.ts";


async function withTestDb(fn: () => Promise<void> | void): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "iksir-test-" });
  Deno.env.set("IKSIR_STATE_DIR", tempDir);
  try {
    await baddaaQaidatBayanat();
    await fn();
  } finally {
    aghlaaqQaidatBayanat();
    Deno.env.delete("IKSIR_STATE_DIR");
    await Deno.remove(tempDir, { recursive: true });
  }
}


Deno.test("sessions: upsert and retrieve", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaJalsa({
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

    const sessions = jalabaKullJalasat();
    assertEquals(sessions.length, 1);
    assertEquals(sessions[0].identifier, "TEAM-200");
    assertEquals(sessions[0].title, "Auto-login feature");
    assertEquals(sessions[0].type, "epic");
    assertEquals(sessions[0].status, "fail");
  });
});

Deno.test("sessions: upsert updates existing", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaJalsa({
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

    haddathaAwAdkhalaJalsa({
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

    const sessions = jalabaKullJalasat();
    assertEquals(sessions.length, 1);
    assertEquals(sessions[0].title, "Auto-login v2");
    assertEquals(sessions[0].status, "masdud");
    assertEquals(sessions[0].blocked_reason, "Missing specs");
  });
});


Deno.test("channels: upsert and get", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaQanat("TEAM-200", "telegram", "12345");
    const channelId = jalabaQanat("TEAM-200", "telegram");
    assertEquals(channelId, "12345");
  });
});

Deno.test("channels: get returns null for missing", async () => {
  await withTestDb(() => {
    const channelId = jalabaQanat("NONEXISTENT", "telegram");
    assertEquals(channelId, null);
  });
});

Deno.test("channels: upsert updates existing", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaQanat("TEAM-200", "telegram", "12345");
    haddathaAwAdkhalaQanat("TEAM-200", "telegram", "67890");
    assertEquals(jalabaQanat("TEAM-200", "telegram"), "67890");
  });
});

Deno.test("channels: jalabaQanatsForSession returns all providers", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaQanat("TEAM-200", "telegram", "12345");
    haddathaAwAdkhalaQanat("TEAM-200", "slack", "C07ABC");

    const channels = jalabaQanatsForSession("TEAM-200");
    assertEquals(channels, { telegram: "12345", slack: "C07ABC" });
  });
});

Deno.test("channels: jalabaQanatsForSession returns empty for unknown", async () => {
  await withTestDb(() => {
    const channels = jalabaQanatsForSession("NONEXISTENT");
    assertEquals(channels, {});
  });
});

Deno.test("channels: jalabJalsaByChannel reverse lookup", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaQanat("TEAM-200", "telegram", "12345");
    haddathaAwAdkhalaQanat("TEAM-300", "telegram", "67890");

    assertEquals(jalabJalsaByChannel("telegram", "12345"), "TEAM-200");
    assertEquals(jalabJalsaByChannel("telegram", "67890"), "TEAM-300");
    assertEquals(jalabJalsaByChannel("telegram", "99999"), null);
  });
});

Deno.test("channels: mahaqaQanat", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaQanat("TEAM-200", "telegram", "12345");
    assertEquals(jalabaQanat("TEAM-200", "telegram"), "12345");

    mahaqaQanat("TEAM-200", "telegram");
    assertEquals(jalabaQanat("TEAM-200", "telegram"), null);
  });
});

Deno.test("channels: uniqueness per session+provider", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaQanat("TEAM-200", "telegram", "111");
    haddathaAwAdkhalaQanat("TEAM-200", "slack", "222");
    assertEquals(jalabaQanat("TEAM-200", "telegram"), "111");
    assertEquals(jalabaQanat("TEAM-200", "slack"), "222");

    haddathaAwAdkhalaQanat("TEAM-300", "telegram", "333");
    assertEquals(jalabaQanat("TEAM-300", "telegram"), "333");
    assertEquals(jalabaQanat("TEAM-200", "telegram"), "111");
  });
});


Deno.test("events: insert and retrieve unprocessed", async () => {
  await withTestDb(() => {
    adkhalaHadath("pm", "mun_create_branch", { branch: "epic/test" }, "orch-1");

    const events = jalabaAhdathGhairMuaalaja("pm");
    assertEquals(events.length, 1);

    const payload = JSON.parse(events[0].payload);
    assertEquals(payload.branch, "epic/test");
  });
});

Deno.test("events: allamaHadathMuaalaj removes from unprocessed", async () => {
  await withTestDb(() => {
    adkhalaHadath("pm", "mun_commit", { message: "test" });

    let events = jalabaAhdathGhairMuaalaja("pm");
    assertEquals(events.length, 1);

    allamaHadathMuaalaj(events[0].id);

    events = jalabaAhdathGhairMuaalaja("pm");
    assertEquals(events.length, 0);
  });
});

Deno.test("events: ordering is by creation time", async () => {
  await withTestDb(() => {
    adkhalaHadath("pm", "tool_a", { order: 1 });
    adkhalaHadath("pm", "tool_b", { order: 2 });
    adkhalaHadath("pm", "tool_c", { order: 3 });

    const events = jalabaAhdathGhairMuaalaja("pm");
    assertEquals(events.length, 3);
    assertEquals(JSON.parse(events[0].payload).order, 1);
    assertEquals(JSON.parse(events[2].payload).order, 3);
  });
});


Deno.test("questions: insert and retrieve unanswered", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaJalsa({
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

    adkhalaSual({
      id: "q-1",
      sessionId: "sess-1",
      question: "Which approach?",
      options: ["A", "B", "C"],
    });

    const questions = jalabaAseilaGhairMujaba();
    assertEquals(questions.length, 1);
    assertEquals(questions[0].question, "Which approach?");
    assertEquals(JSON.parse(questions[0].options!), ["A", "B", "C"]);
  });
});

Deno.test("questions: allamaJawabSual removes from unanswered", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaJalsa({
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

    adkhalaSual({
      id: "q-1",
      sessionId: "sess-1",
      question: "Which approach?",
      options: ["A", "B"],
    });

    allamaJawabSual("q-1", "A");

    const questions = jalabaAseilaGhairMujaba();
    assertEquals(questions.length, 0);
  });
});


Deno.test("diary: add and query decisions", async () => {
  await withTestDb(() => {
    adhafaQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "architecture",
      decision: "Use REST over GraphQL",
      reasoning: "Simpler for this use case",
    });

    adhafaQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "planning",
      decision: "Split into 3 tickets",
      reasoning: "Each screen is independent",
    });

    const all = jalabaQararatSijill({ huwiyyatMurshid: "TEAM-200" });
    assertEquals(all.length, 2);
    /** Both decisions present (order may vary when timestamps are identical) */
    const types = all.map(d => d.type).sort();
    assertEquals(types, ["architecture", "planning"]);
  });
});

Deno.test("diary: filter by type", async () => {
  await withTestDb(() => {
    adhafaQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "architecture",
      decision: "d1",
      reasoning: "r1",
    });
    adhafaQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "planning",
      decision: "d2",
      reasoning: "r2",
    });

    const arch = jalabaQararatSijill({ type: "architecture" });
    assertEquals(arch.length, 1);
    assertEquals(arch[0].decision, "d1");
  });
});

Deno.test("diary: search in decision and reasoning", async () => {
  await withTestDb(() => {
    adhafaQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "architecture",
      decision: "Use REST for the widget API",
      reasoning: "Performance matters",
    });
    adhafaQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "planning",
      decision: "Something else",
      reasoning: "Unrelated",
    });

    const results = jalabaQararatSijill({ search: "widget" });
    assertEquals(results.length, 1);
    assertEquals(results[0].decision, "Use REST for the widget API");
  });
});

Deno.test("diary: limit parameter", async () => {
  await withTestDb(() => {
    for (let i = 0; i < 5; i++) {
      adhafaQararSijill({
        huwiyyatMurshid: "TEAM-200",
        type: "planning",
        decision: `decision ${i}`,
        reasoning: `reasoning ${i}`,
      });
    }

    const limited = jalabaQararatSijill({ limit: 3 });
    assertEquals(limited.length, 3);
  });
});

Deno.test("diary: collective query (no huwiyyatMurshid filter)", async () => {
  await withTestDb(() => {
    adhafaQararSijill({
      huwiyyatMurshid: "TEAM-200",
      type: "architecture",
      decision: "d1",
      reasoning: "r1",
    });
    adhafaQararSijill({
      huwiyyatMurshid: "TEAM-300",
      type: "architecture",
      decision: "d2",
      reasoning: "r2",
    });

    const all = jalabaQararatSijill({});
    assertEquals(all.length, 2);
  });
});


Deno.test("demands: upsert and retrieve", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaMatlabMuallaq("TEAM-200", "Need control for PR", "normal");

    const demands = jalabaMatalebMuallaq();
    assertEquals(demands.length, 1);
    assertEquals(demands[0].huwiyat_murshid, "TEAM-200");
    assertEquals(demands[0].reason, "Need control for PR");
    assertEquals(demands[0].awwaliyya, "normal");
  });
});

Deno.test("demands: urgent sorted before normal", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaMatlabMuallaq("TEAM-300", "Less important", "normal");
    haddathaAwAdkhalaMatlabMuallaq("TEAM-200", "Critical blocker", "urgent");

    const demands = jalabaMatalebMuallaq();
    assertEquals(demands.length, 2);
    assertEquals(demands[0].huwiyat_murshid, "TEAM-200");
    assertEquals(demands[1].huwiyat_murshid, "TEAM-300");
  });
});

Deno.test("demands: upsert replaces existing for same murshid", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaMatlabMuallaq("TEAM-200", "Original reason", "normal");
    haddathaAwAdkhalaMatlabMuallaq("TEAM-200", "Updated reason", "urgent");

    const demands = jalabaMatalebMuallaq();
    assertEquals(demands.length, 1);
    assertEquals(demands[0].reason, "Updated reason");
    assertEquals(demands[0].awwaliyya, "urgent");
  });
});

Deno.test("demands: removePendingDemand", async () => {
  await withTestDb(() => {
    haddathaAwAdkhalaMatlabMuallaq("TEAM-200", "test", "normal");
    assertEquals(jalabaMatalebMuallaq().length, 1);

    removePendingDemand("TEAM-200");
    assertEquals(jalabaMatalebMuallaq().length, 0);
  });
});


Deno.test("baddaaQaidatBayanat: idempotent — safe to call twice", async () => {
  await withTestDb(async () => {
    await baddaaQaidatBayanat();
    haddathaAwAdkhalaQanat("test", "telegram", "123");
    assertEquals(jalabaQanat("test", "telegram"), "123");
  });
});
