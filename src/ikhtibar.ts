import { test } from "node:test";
import assert from "node:assert/strict";

export { test };

export function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  if (msg === undefined) assert.deepStrictEqual(actual, expected);
  else assert.deepStrictEqual(actual, expected, msg);
}

export function assertExists(x: unknown, msg?: string): asserts x {
  if (msg === undefined) assert.ok(x !== null && x !== undefined);
  else assert.ok(x !== null && x !== undefined, msg);
}

export function assertStringIncludes(haystack: string, needle: string, msg?: string): void {
  if (msg === undefined) assert.ok(haystack.includes(needle));
  else assert.ok(haystack.includes(needle), msg);
}
