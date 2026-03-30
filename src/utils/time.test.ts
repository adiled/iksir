import { assertEquals } from "@std/assert";
import { nowInTz, todayInTz, isInTimeRange, minutesUntil } from "./time.ts";

// =============================================================================
// nowInTz
// =============================================================================

Deno.test("nowInTz: returns hours and minutes as numbers", () => {
  const result = nowInTz("UTC");
  assertEquals(typeof result.hours, "number");
  assertEquals(typeof result.minutes, "number");
  // Hours: 0-23, Minutes: 0-59
  assertEquals(result.hours >= 0 && result.hours <= 23, true);
  assertEquals(result.minutes >= 0 && result.minutes <= 59, true);
});

Deno.test("nowInTz: works with Asia/Karachi timezone", () => {
  const result = nowInTz("Asia/Karachi");
  assertEquals(typeof result.hours, "number");
  assertEquals(result.hours >= 0 && result.hours <= 23, true);
});

// =============================================================================
// todayInTz
// =============================================================================

Deno.test("todayInTz: returns YYYY-MM-DD format", () => {
  const result = todayInTz("UTC");
  // Match YYYY-MM-DD pattern
  assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(result), true);
});

Deno.test("todayInTz: produces valid date parts", () => {
  const result = todayInTz("UTC");
  const [year, month, day] = result.split("-").map(Number);
  assertEquals(year >= 2025 && year <= 2030, true);
  assertEquals(month >= 1 && month <= 12, true);
  assertEquals(day >= 1 && day <= 31, true);
});

// =============================================================================
// isInTimeRange — the core quiet-hours logic
// =============================================================================

Deno.test("isInTimeRange: normal range — inside", () => {
  // We can't control wall clock, so we test the logic by comparing
  // with nowInTz and constructing ranges around the current time
  const { hours, minutes } = nowInTz("UTC");
  const start = `${String(hours).padStart(2, "0")}:00`;
  const endH = (hours + 1) % 24;
  const end = `${String(endH).padStart(2, "0")}:00`;

  // Current time is within [hours:00, hours+1:00)
  if (minutes < 59) {
    // Only assert if we're not right at the boundary
    assertEquals(isInTimeRange("UTC", start, end), true);
  }
});

Deno.test("isInTimeRange: normal range — outside", () => {
  const { hours } = nowInTz("UTC");
  // Create a range that definitely excludes current time
  const rangeStart = (hours + 2) % 24;
  const rangeEnd = (hours + 3) % 24;

  // Only test non-overnight ranges
  if (rangeStart < rangeEnd) {
    const start = `${String(rangeStart).padStart(2, "0")}:00`;
    const end = `${String(rangeEnd).padStart(2, "0")}:00`;
    assertEquals(isInTimeRange("UTC", start, end), false);
  }
});

Deno.test("isInTimeRange: overnight range — 22:00-07:00 logic", () => {
  // Test the overnight wrap by checking consistent behavior:
  // If we're at, say, 23:00 UTC, we should be in 22:00-07:00
  // If we're at, say, 12:00 UTC, we should NOT be in 22:00-07:00
  const { hours } = nowInTz("UTC");

  const inRange = isInTimeRange("UTC", "22:00", "07:00");
  if (hours >= 22 || hours < 7) {
    assertEquals(inRange, true);
  } else {
    assertEquals(inRange, false);
  }
});

Deno.test("isInTimeRange: same start and end — empty range", () => {
  // When start === end, the range is empty (0 minutes)
  assertEquals(isInTimeRange("UTC", "12:00", "12:00"), false);
});

// =============================================================================
// minutesUntil
// =============================================================================

Deno.test("minutesUntil: returns non-negative number", () => {
  const result = minutesUntil("UTC", "23:59");
  assertEquals(typeof result, "number");
  assertEquals(result >= 0, true);
  assertEquals(result <= 1440, true); // max 24 hours
});

Deno.test("minutesUntil: wraps past midnight", () => {
  const { hours, minutes } = nowInTz("UTC");
  // Target 1 minute ago should give ~1439 minutes (next day)
  const targetH = hours;
  const targetM = (minutes - 1 + 60) % 60;
  const adjustedH = minutes === 0 ? (hours - 1 + 24) % 24 : hours;
  const target = `${String(minutes === 0 ? adjustedH : targetH).padStart(2, "0")}:${String(targetM).padStart(2, "0")}`;

  const result = minutesUntil("UTC", target);
  // Should be close to 1439 (full day minus 1 minute), but allow some tolerance
  // for the time between nowInTz calls
  assertEquals(result >= 1437 && result <= 1440, true);
});

Deno.test("minutesUntil: target is current time — 0 or 1440", () => {
  const { hours, minutes } = nowInTz("UTC");
  const target = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  const result = minutesUntil("UTC", target);
  // Should be 0 (if exact) or close to 0/1440 due to timing
  assertEquals(result === 0 || result === 1440, true);
});
