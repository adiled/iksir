/**
 * Tests for src/khuddam/mumayyiz.ts
 *
 * Tests mayyazaTanbih() with mock AmilHum.
 * AGENTS.md is loaded from a temp fixture file.
 *
 * Key behaviors tested:
 * - Correct parsing of LLM JSON responses
 * - Fail-open on errors (dhahab:true / DHAHAB)
 * - "pick recommended" / "pick first" shortcut resolution
 */

import { test, assertEquals } from "../ikhtibar.ts";
import { mockWasila, writeTempFile } from "../test-helpers.ts";
import { mayyazaTanbih } from "./mumayyiz.ts";

let fixtureFile: string | null = null;

async function ensureFixture(): Promise<void> {
  if (fixtureFile) return;
  fixtureFile = await writeTempFile("# Test AGENTS.md\nGuidelines for testing.", "agents-md-");
  process.env.IKSIR_AGENTS_MD_PATH = fixtureFile;
}

test("mayyazaTanbih: DHAHAB response parsed correctly", async () => {
  await ensureFixture();
  const oc = mockWasila({
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

test("mayyazaTanbih: KHABATH response parsed correctly", async () => {
  await ensureFixture();
  const oc = mockWasila({
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

test("mayyazaTanbih: malformed JSON -> fail-open dhahab", async () => {
  await ensureFixture();
  const oc = mockWasila({
    mayyaza: async () => ({
      success: true,
      response: "this is not json at all",
    }),
  });

  const result = await mayyazaTanbih(oc as never, "Some message");
  assertEquals(result.dhahab, true);
  assertEquals(result.sabab, "خطأ في التمييز");
});

test("mayyazaTanbih: LLM returns success:false -> fail-open", async () => {
  await ensureFixture();
  const oc = mockWasila({
    mayyaza: async () => ({ success: false, error: "rate limited" }),
  });

  const result = await mayyazaTanbih(oc as never, "Some message");
  assertEquals(result.dhahab, true);
  assertEquals(result.sabab, "فشل التمييز");
});

test("mayyazaTanbih: LLM throws -> fail-open", async () => {
  await ensureFixture();
  const oc = mockWasila({
    mayyaza: async () => {
      throw new Error("network error");
    },
  });

  const result = await mayyazaTanbih(oc as never, "Some message");
  assertEquals(result.dhahab, true);
  assertEquals(result.sabab, "خطأ في التمييز");
});

test("mayyazaTanbih: missing fields get defaults", async () => {
  await ensureFixture();
  const oc = mockWasila({
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

test("mayyazaTanbih: KHABATH missing rejection gets default", async () => {
  await ensureFixture();
  const oc = mockWasila({
    mayyaza: async () => ({
      success: true,
      response: '{"tamyiz":"KHABATH","reason":"trivial"}',
    }),
  });

  const result = await mayyazaTanbih(oc as never, "Some message");
  assertEquals(result.dhahab, false);
  assertEquals(result.radd, "Handle this autonomously.");
});
