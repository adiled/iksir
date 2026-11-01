/**
 * Timezone-aware date/time utilities.
 *
 * Pure functions for working with configured timezones.
 * Extracted from keepalive.ts for reuse and testability.
 */

/**
 * Get current hours and minutes in a given timezone.
 *
 * @param tz - IANA timezone string (e.g., "Asia/Karachi", "UTC")
 * @returns { hours, minutes } in 24-hour format
 */
export function nowInTz(tz: string): { hours: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());

  const hours = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minutes = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { hours, minutes };
}

export function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export function fiNitaqAlWaqt(tz: string, start: string, end: string): boolean {
  const { hours, minutes } = nowInTz(tz);
  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);

  const current = hours * 60 + minutes;
  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;

  if (startMin > endMin) {
    return current >= startMin || current < endMin;
  }

  return current >= startMin && current < endMin;
}

export function minutesUntil(tz: string, end: string): number {
  const { hours, minutes } = nowInTz(tz);
  const [endH, endM] = end.split(":").map(Number);

  const current = hours * 60 + minutes;
  const endMin = endH * 60 + endM;

  let diff = endMin - current;
  if (diff < 0) diff += 1440;
  return diff;
}
