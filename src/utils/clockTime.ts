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

/** Formats an "HH:MM" clock time for display, e.g. "8:00 AM". */
export function formatHHMM(hhmm: string): string {
  return format(hhmmToDate(hhmm), 'h:mm a');
}

/** Inverse of hhmmToDate — extracts "HH:MM" from a Date's clock time. */
export function dateToHHMM(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
