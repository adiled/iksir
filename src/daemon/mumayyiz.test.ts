/**
 * Tests for src/daemon/mumayyiz.ts
 *
 * Tests mayyazaTanbih() and mayyazaSual() with mock OpenCodeClient.
 * AGENTS.md is loaded from a temp fixture file.
 *
 * Key behaviors tested:
 * - Correct parsing of LLM JSON responses
 * - Fail-open on errors (dhahab:true / DHAHAB)
 * - Markdown-wrapped JSON stripping (mayyazaSual)
 * - "pick recommended" / "pick first" shortcut resolution
 */

import { assertEquals } from "@std/assert";
import { mockOpenCodeClient, writeTempFile } from "../test-helpers.ts";
import { mayyazaTanbih, mayyazaSual } from "./mumayyiz.ts";
import type { MaalumatSual } from "../types.ts";


/**
 * The mumayyiz has a module-level cache: once AGENTS.md is loaded, it persists.
 * We set IKSIR_AGENTS_MD_PATH to a temp fixture so loadAgentsMd() finds content.
 */
let fixtureFile: string | null = null;

async function ensureFixture(): Promise<void> {
  if (fixtureFile) return;
  fixtureFile = await writeTempFile("# Test AGENTS.md\nGuidelines for testing.", "agents-md-");
  Deno.env.set("IKSIR_AGENTS_MD_PATH", fixtureFile);
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


Deno.test("mayyazaTanbih: DHAHAB response parsed correctly", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({
      success: true,
      response: '{"tamyiz":"DHAHAB","reason":"architecture question","rejection":null}',
    }),
  });

  const result = await mayyazaTanbih(oc as never, "Is this a good API boundary?");
  assertEquals(result.dhahab, true);
  assertEquals(result.sabab, "architecture question");
  assertEquals(result.radd, null);
});

Deno.test("mayyazaTanbih: KHABATH response parsed correctly", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({
      success: true,
      response: '{"tamyiz":"KHABATH","reason":"debugging","rejection":"Check the logs first."}',
    }),
  });

  const result = await mayyazaTanbih(oc as never, "This test is failing");
  assertEquals(result.dhahab, false);
  assertEquals(result.sabab, "debugging");
  assertEquals(result.radd, "Check the logs first.");
});

Deno.test("mayyazaTanbih: malformed JSON -> fail-open dhahab", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({
      success: true,
      response: "this is not json at all",
    }),
  });

  const result = await mayyazaTanbih(oc as never, "Some message");
  assertEquals(result.dhahab, true);
  assertEquals(result.sabab, "خطأ في التمييز");
});

Deno.test("mayyazaTanbih: LLM returns success:false -> fail-open", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({ success: false, error: "rate limited" }),
  });

  const result = await mayyazaTanbih(oc as never, "Some message");
  assertEquals(result.dhahab, true);
  assertEquals(result.sabab, "فشل التمييز");
});

Deno.test("mayyazaTanbih: LLM throws -> fail-open", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => {
      throw new Error("network error");
    },
  });

  const result = await mayyazaTanbih(oc as never, "Some message");
  assertEquals(result.dhahab, true);
  assertEquals(result.sabab, "خطأ في التمييز");
});

Deno.test("mayyazaTanbih: missing fields get defaults", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({
      success: true,
      response: '{"tamyiz":"DHAHAB"}',
    }),
  });

  const result = await mayyazaTanbih(oc as never, "Some message");
  assertEquals(result.dhahab, true);
  assertEquals(result.sabab, "Unknown");
  assertEquals(result.radd, null);
});

Deno.test("mayyazaTanbih: KHABATH missing rejection gets default", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({
      success: true,
      response: '{"tamyiz":"KHABATH","reason":"trivial"}',
    }),
  });

  const result = await mayyazaTanbih(oc as never, "Some message");
  assertEquals(result.dhahab, false);
  assertEquals(result.radd, "Handle this autonomously.");
});


Deno.test("mayyazaSual: DHAHAB response parsed correctly", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({
      success: true,
      response: '{"tamyiz":"DHAHAB","reason":"architecture","rejection":null,"autoAnswer":null}',
    }),
  });

  const result = await mayyazaSual(oc as never, makeQuestion());
  assertEquals(result.tamyiz, "DHAHAB");
  assertEquals(result.reason, "architecture");
  assertEquals(result.rejection, null);
  assertEquals(result.autoAnswer, null);
});

Deno.test("mayyazaSual: KHABATH with autoAnswer", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({
      success: true,
      response: '{"tamyiz":"KHABATH","reason":"obvious","rejection":"Read the docs.","autoAnswer":"Option B"}',
    }),
  });

  const result = await mayyazaSual(oc as never, makeQuestion());
  assertEquals(result.tamyiz, "KHABATH");
  assertEquals(result.reason, "obvious");
  assertEquals(result.rejection, "Read the docs.");
  assertEquals(result.autoAnswer, "Option B");
});

Deno.test("mayyazaSual: 'pick recommended' resolves to (Recommended) option", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({
      success: true,
      response: '{"tamyiz":"KHABATH","reason":"trivial","rejection":"Use recommended.","autoAnswer":"pick recommended"}',
    }),
  });

  const result = await mayyazaSual(oc as never, makeQuestion());
  assertEquals(result.tamyiz, "KHABATH");
  assertEquals(result.autoAnswer, "Option A (Recommended)");
});

Deno.test("mayyazaSual: 'pick first' resolves to first option", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({
      success: true,
      response: '{"tamyiz":"KHABATH","reason":"trivial","rejection":"Just pick one.","autoAnswer":"pick first"}',
    }),
  });

  const result = await mayyazaSual(oc as never, makeQuestion());
  assertEquals(result.tamyiz, "KHABATH");
  assertEquals(result.autoAnswer, "Option A (Recommended)");
});

Deno.test("mayyazaSual: 'pick recommended' with no recommended -> falls back to first", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({
      success: true,
      response: '{"tamyiz":"KHABATH","reason":"trivial","rejection":"Pick one.","autoAnswer":"pick recommended"}',
    }),
  });

  const q = makeQuestion({
    options: [
      { label: "Alpha", description: "First" },
      { label: "Beta", description: "Second" },
    ],
  });

  const result = await mayyazaSual(oc as never, q);
  assertEquals(result.autoAnswer, "Alpha");
});

Deno.test("mayyazaSual: markdown-wrapped JSON -> parsed correctly", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({
      success: true,
      response: '```json\n{"tamyiz":"KHABATH","reason":"obvious","rejection":"Handle it.","autoAnswer":"Option B"}\n```',
    }),
  });

  const result = await mayyazaSual(oc as never, makeQuestion());
  assertEquals(result.tamyiz, "KHABATH");
  assertEquals(result.autoAnswer, "Option B");
});

Deno.test("mayyazaSual: malformed JSON -> fail-open DHAHAB", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({
      success: true,
      response: "not json",
    }),
  });

  const result = await mayyazaSual(oc as never, makeQuestion());
  assertEquals(result.tamyiz, "DHAHAB");
  assertEquals(result.reason, "خطأ في التمييز");
});

Deno.test("mayyazaSual: LLM throws -> fail-open DHAHAB", async () => {
  await ensureFixture();
  const oc = mockOpenCodeClient({
    mayyaza: async () => {
      throw new Error("timeout");
    },
  });

  const result = await mayyazaSual(oc as never, makeQuestion());
  assertEquals(result.tamyiz, "DHAHAB");
  assertEquals(result.reason, "خطأ في التمييز");
});

Deno.test("mayyazaSual: DHAHAB nullifies autoAnswer and rejection", async () => {
  await ensureFixture();
  /** LLM returns DHAHAB but also includes autoAnswer (shouldn't happen, but defensive) */
  const oc = mockOpenCodeClient({
    mayyaza: async () => ({
      success: true,
      response: '{"tamyiz":"DHAHAB","reason":"needs judgment","rejection":"some text","autoAnswer":"Option A"}',
    }),
  });

  const result = await mayyazaSual(oc as never, makeQuestion());
  assertEquals(result.tamyiz, "DHAHAB");
  assertEquals(result.rejection, null);
  assertEquals(result.autoAnswer, null);
});
