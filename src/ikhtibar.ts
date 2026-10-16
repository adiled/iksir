import { test } from "node:test";
import nodeAssert from "node:assert/strict";

export { test };

export function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  if (msg === undefined) nodeAssert.deepStrictEqual(actual, expected);
  else nodeAssert.deepStrictEqual(actual, expected, msg);
}

export function assertExists(x: unknown, msg?: string): asserts x {
  if (msg === undefined) nodeAssert.ok(x !== null && x !== undefined);
  else nodeAssert.ok(x !== null && x !== undefined, msg);
}

export function assertStringIncludes(haystack: string, needle: string, msg?: string): void {
  if (msg === undefined) nodeAssert.ok(haystack.includes(needle));
  else nodeAssert.ok(haystack.includes(needle), msg);
}

export function assertNotEquals(actual: unknown, expected: unknown, msg?: string): void {
  if (msg === undefined) nodeAssert.notDeepStrictEqual(actual, expected);
  else nodeAssert.notDeepStrictEqual(actual, expected, msg);
}

export function assert(x: unknown, msg?: string): asserts x {
  if (msg === undefined) nodeAssert.ok(x);
  else nodeAssert.ok(x, msg);
}
