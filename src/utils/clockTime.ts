import { format } from 'date-fns/format';

/**
 * Clock-time helpers for the "HH:MM" strings settings and schedules are stored
 * as. Deliberately store-free — nothing here reads useSettingsStore, so the
 * modules that need to stay free of it (categorySchedule, parseTaskInput) can
 * import from here instead of forking their own copies.
 */

/** Applies an "HH:MM" clock time to today's (or a given base) date. */
export function hhmmToDate(hhmm: string, base: Date = new Date()): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * The start of the logical day a moment falls in: the most recent dayResetTime
 * at or before it. Before the reset hour, that's yesterday's — 1:30 AM on a
 * 2 AM reset still belongs to the day before.
 *
 * The store-free core of dateUtils' getDayStart, which is the one the app
 * imports (it defaults the reset time from settings). Lives here so modules
 * that must not touch the store — rhythms, and anything else testable in the
 * `node` environment — can do logical-day math without forking this.
 */
export function logicalDayStart(date: Date, dayResetTime: string): Date {
  const [h, m] = dayResetTime.split(':').map(Number);
  const resetOnDate = new Date(date);
  resetOnDate.setHours(h || 0, m || 0, 0, 0);
  if (date < resetOnDate) {
    resetOnDate.setDate(resetOnDate.getDate() - 1);
  }
  return resetOnDate;
}

/**
 * Formats an "HH:MM" clock time for display, e.g. "8:00 AM" — or "08:00" with
 * `use24Hour`.
 *
 * The preference is a parameter rather than a store read because this module
 * is deliberately store-free (see above). `formatHHMM` in dateUtils wraps this
 * one and supplies the setting, and that's what the app imports; this signature
 * is for the callers that can't reach the store.
 */
export function formatHHMM(hhmm: string, use24Hour = false): string {
  return format(hhmmToDate(hhmm), clockTimeToken(use24Hour));
}

/**
 * The date-fns token for a clock time in the given 12/24-hour preference.
 * Exported so the callers formatting a Date (rather than an "HH:MM" string)
 * pick the same shape instead of spelling out 'h:mm a' again — every place
 * that did was a place the setting silently didn't reach.
 */
export function clockTimeToken(use24Hour = false): string {
  return use24Hour ? 'HH:mm' : 'h:mm a';
}

/** Inverse of hhmmToDate — extracts "HH:MM" from a Date's clock time. */
export function dateToHHMM(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
