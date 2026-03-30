/**
 * Tests for src/daemon/classifier.ts
 *
 * Tests classifyNotification() and classifyQuestion() with mock OpenCodeClient.
 * AGENTS.md is loaded from a temp fixture file.
 *
 * Key behaviors tested:
 * - Correct parsing of LLM JSON responses
 * - Fail-open on errors (worthy:true / WORTHY)
 * - Markdown-wrapped JSON stripping (classifyQuestion)
 * - "pick recommended" / "pick first" shortcut resolution
 */

import { assertEquals } from "@std/assert";
import { mockOpenCodeClient, writeTempFile } from "../test-helpers.ts";
import { classifyNotification, classifyQuestion } from "./classifier.ts";
import type { MaalumatSual } from "../types.ts";


/**
 * The classifier has a module-level cache: once AGENTS.md is loaded, it persists.
 * We set MUNADI_AGENTS_MD_PATH to a temp fixture so loadAgentsMd() finds content.
 */
let fixtureFile: string | null = null;

async function ensureFixture(): Promise<void> {
  if (fixtureFile) return;
  fixtureFile = await writeTempFile("# Test AGENTS.md\nGuidelines for testing.", "agents-md-");
  Deno.env.set("MUNADI_AGENTS_MD_PATH", fixtureFile);
}



function makeQuestion(overrides?: Partial<MaalumatSual>): MaalumatSual {
  return {
    header: "Test question",
    question: "Should we do X or Y?",
    options: [
      { label: "Option A (Recommended)", description: "The recommended option" },
      { label: "Option B", description: "Alternative option" },
    ],
    ...overrides,
  };
}


Deno.test("classifyNotification: WORTHY response parsed correctly", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => ({
      success: true,
      response: '{"classification":"WORTHY","reason":"architecture question","rejection":null}',
    }),
  });

  const result = await classifyNotification(oc as never, "Is this a good API boundary?");
  assertEquals(result.worthy, true);
  assertEquals(result.reason, "architecture question");
  assertEquals(result.rejection, null);
});

Deno.test("classifyNotification: CRY_BABY response parsed correctly", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => ({
      success: true,
      response: '{"classification":"CRY_BABY","reason":"debugging","rejection":"Check the logs first."}',
    }),
  });

  const result = await classifyNotification(oc as never, "This test is failing");
  assertEquals(result.worthy, false);
  assertEquals(result.reason, "debugging");
  assertEquals(result.rejection, "Check the logs first.");
});

Deno.test("classifyNotification: malformed JSON -> fail-open worthy", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => ({
      success: true,
      response: "this is not json at all",
    }),
  });

  const result = await classifyNotification(oc as never, "Some message");
  assertEquals(result.worthy, true);
  assertEquals(result.reason, "Classification error");
});

Deno.test("classifyNotification: LLM returns success:false -> fail-open", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => ({ success: false, error: "rate limited" }),
  });

  const result = await classifyNotification(oc as never, "Some message");
  assertEquals(result.worthy, true);
  assertEquals(result.reason, "Classification failed");
});

Deno.test("classifyNotification: LLM throws -> fail-open", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => {
      throw new Error("network error");
    },
  });

  const result = await classifyNotification(oc as never, "Some message");
  assertEquals(result.worthy, true);
  assertEquals(result.reason, "Classification error");
});

Deno.test("classifyNotification: missing fields get defaults", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => ({
      success: true,
      response: '{"classification":"WORTHY"}',
    }),
  });

  const result = await classifyNotification(oc as never, "Some message");
  assertEquals(result.worthy, true);
  assertEquals(result.reason, "Unknown");
  assertEquals(result.rejection, null);
});

Deno.test("classifyNotification: CRY_BABY missing rejection gets default", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => ({
      success: true,
      response: '{"classification":"CRY_BABY","reason":"trivial"}',
    }),
  });

  const result = await classifyNotification(oc as never, "Some message");
  assertEquals(result.worthy, false);
  assertEquals(result.rejection, "Handle this autonomously.");
});


Deno.test("classifyQuestion: WORTHY response parsed correctly", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => ({
      success: true,
      response: '{"classification":"WORTHY","reason":"architecture","rejection":null,"autoAnswer":null}',
    }),
  });

  const result = await classifyQuestion(oc as never, makeQuestion());
  assertEquals(result.classification, "WORTHY");
  assertEquals(result.reason, "architecture");
  assertEquals(result.rejection, null);
  assertEquals(result.autoAnswer, null);
});

Deno.test("classifyQuestion: CRY_BABY with autoAnswer", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => ({
      success: true,
      response: '{"classification":"CRY_BABY","reason":"obvious","rejection":"Read the docs.","autoAnswer":"Option B"}',
    }),
  });

  const result = await classifyQuestion(oc as never, makeQuestion());
  assertEquals(result.classification, "CRY_BABY");
  assertEquals(result.reason, "obvious");
  assertEquals(result.rejection, "Read the docs.");
  assertEquals(result.autoAnswer, "Option B");
});

Deno.test("classifyQuestion: 'pick recommended' resolves to (Recommended) option", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => ({
      success: true,
      response: '{"classification":"CRY_BABY","reason":"trivial","rejection":"Use recommended.","autoAnswer":"pick recommended"}',
    }),
  });

  const result = await classifyQuestion(oc as never, makeQuestion());
  assertEquals(result.classification, "CRY_BABY");
  assertEquals(result.autoAnswer, "Option A (Recommended)");
});

Deno.test("classifyQuestion: 'pick first' resolves to first option", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => ({
      success: true,
      response: '{"classification":"CRY_BABY","reason":"trivial","rejection":"Just pick one.","autoAnswer":"pick first"}',
    }),
  });

  const result = await classifyQuestion(oc as never, makeQuestion());
  assertEquals(result.classification, "CRY_BABY");
  assertEquals(result.autoAnswer, "Option A (Recommended)");
});

Deno.test("classifyQuestion: 'pick recommended' with no recommended -> falls back to first", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => ({
      success: true,
      response: '{"classification":"CRY_BABY","reason":"trivial","rejection":"Pick one.","autoAnswer":"pick recommended"}',
    }),
  });

  const q = makeQuestion({
    options: [
      { label: "Alpha", description: "First" },
      { label: "Beta", description: "Second" },
    ],
  });

  const result = await classifyQuestion(oc as never, q);
  assertEquals(result.autoAnswer, "Alpha");
});

Deno.test("classifyQuestion: markdown-wrapped JSON -> parsed correctly", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => ({
      success: true,
      response: '```json\n{"classification":"CRY_BABY","reason":"obvious","rejection":"Handle it.","autoAnswer":"Option B"}\n```',
    }),
  });

  const result = await classifyQuestion(oc as never, makeQuestion());
  assertEquals(result.classification, "CRY_BABY");
  assertEquals(result.autoAnswer, "Option B");
});

Deno.test("classifyQuestion: malformed JSON -> fail-open WORTHY", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => ({
      success: true,
      response: "not json",
    }),
  });

  const result = await classifyQuestion(oc as never, makeQuestion());
  assertEquals(result.classification, "WORTHY");
  assertEquals(result.reason, "Classification error");
});

Deno.test("classifyQuestion: LLM throws -> fail-open WORTHY", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    classify: async () => {
      throw new Error("timeout");
    },
  });

  const result = await classifyQuestion(oc as never, makeQuestion());
  assertEquals(result.classification, "WORTHY");
  assertEquals(result.reason, "Classification error");
});

Deno.test("classifyQuestion: WORTHY nullifies autoAnswer and rejection", async () => {
  await ensureFixture();
  /** LLM returns WORTHY but also includes autoAnswer (shouldn't happen, but defensive) */
  const oc = mockOpenCodeClient({
    classify: async () => ({
      success: true,
      response: '{"classification":"WORTHY","reason":"needs judgment","rejection":"some text","autoAnswer":"Option A"}',
    }),
  });

  const result = await classifyQuestion(oc as never, makeQuestion());
  assertEquals(result.classification, "WORTHY");
  assertEquals(result.rejection, null);
  assertEquals(result.autoAnswer, null);
});
