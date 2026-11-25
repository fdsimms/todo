import type { FoodLogEntry } from '../types';

// Kept apart from `foodLogEntry.ts`, which reaches the settings store and so
// the database: the MCP server states the wait in its copy and must import
// this without that chain (`noEagerDatabaseImport.test.ts`).

/**
 * How long an entry logged before it was eaten waits for a confirm before the
 * phone writes it to Health anyway. Long enough to finish the meal and say how
 * much was eaten; short enough that a forgotten entry still reaches Health the
 * same day.
 */
export const HELD_RELEASE_HOURS = 4;

/** When an entry logged at `loggedAt` is let go to Health if nobody confirms it. */
export function heldUntilFor(loggedAt: Date): string {
  return new Date(loggedAt.getTime() + HELD_RELEASE_HOURS * 3_600_000).toISOString();
}

/** Whether a held entry's wait is over, so the phone should write it. */
export function heldEntryDue(entry: FoodLogEntry, now: Date): boolean {
  if (!entry.healthHeldUntil) return false;
  const until = new Date(entry.healthHeldUntil).getTime();
  // A time that won't parse is released rather than held forever: nothing
  // else would ever clear it.
  return !Number.isFinite(until) || until <= now.getTime();
}
