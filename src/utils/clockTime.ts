import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import { startOfDay } from 'date-fns/startOfDay';

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
 * The reset time's hour and minute, a missing or unreadable part read as 0.
 *
 * Remembered for the last string asked about, because the two day-start
 * helpers below run once per task in every list pass and the reset time is
 * nearly always the same one setting: splitting and parsing it on every call
 * was a measurable share of building Today.
 */
let lastReset: { text: string; h: number; m: number } = { text: '00:00', h: 0, m: 0 };
function resetHourMinute(dayResetTime: string): { h: number; m: number } {
  if (lastReset.text !== dayResetTime) {
    const [h, m] = dayResetTime.split(':').map(Number);
    lastReset = { text: dayResetTime, h: h || 0, m: m || 0 };
  }
  return lastReset;
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
  const { h, m } = resetHourMinute(dayResetTime);
  const resetOnDate = new Date(date);
  resetOnDate.setHours(h, m, 0, 0);
  if (date < resetOnDate) {
    resetOnDate.setDate(resetOnDate.getDate() - 1);
  }
  return resetOnDate;
}

/**
 * The logical-day-start instant for a *stored* date like a task's dueDate or
 * deferUntil, as opposed to a real moment. Never rolls the result back a day —
 * see dateUtils' getTaskDayStart, which wraps this one and supplies the
 * setting, for why the two differ.
 *
 * The store-free core, here for the same reason logicalDayStart is: postpone.ts
 * compares stored task dates and is tested in the `node` environment, where
 * importing dateUtils pulls in useSettingsStore and blows up on expo-sqlite.
 */
export function taskDayStart(date: Date, dayResetTime: string): Date {
  const { h, m } = resetHourMinute(dayResetTime);
  const result = new Date(date);
  // setHours writes h/m/s/ms in one call, so this lands on the same instant the
  // old startOfDay-then-setHours pair did.
  result.setHours(h, m, 0, 0);
  return result;
}

/**
 * A reminder's time of day carried onto another day: `original`'s clock time
 * placed on the logical day `onto` names (a stored anchor such as a due date,
 * so taskDayStart rather than logicalDayStart). Copying hours and minutes onto
 * `onto`'s own calendar date put a 1 AM reminder, which lives at the end of
 * its day under a 4 AM reset, a whole day early on every successor.
 */
export function carryClockTime(onto: Date, original: Date, dayResetTime: string): Date {
  return onLogicalDay(taskDayStart(onto, dayResetTime), dateToHHMM(original));
}

/**
 * Calendar days a due date is late by. Positive = overdue, 0 = due today,
 * negative = not due yet.
 *
 * The math lives here rather than beside its first caller so a store-free
 * module can share it rather than fork it — the same split getTaskDayStart
 * makes with taskDayStart above. `overdueDays` in pinSuggest.ts is this with a
 * Task in front of it, and savedViews.ts reads it directly because importing
 * pinSuggest would pull the settings and category stores, and so expo-sqlite,
 * into a module that exists to stay inside Jest's node environment.
 *
 * All local-time arithmetic. Comparing the date halves of two ISO strings is
 * off by a day everywhere east of UTC+12, since dueDate is stored at local
 * noon and its UTC date is the next day there.
 */
export function overdueDayCount(dueDate: string, todayStart: Date): number {
  return differenceInCalendarDays(todayStart, startOfDay(new Date(dueDate)));
}

/** Minutes past midnight for an "HH:MM" clock time. */
export function hhmmMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * A time window's closing time, or null when it doesn't close on its own day.
 *
 * Both window gates anchor to one logical day, so an end that isn't after the
 * start on that day's own timeline compares as already past from the moment
 * it is placed. Treated as open-ended instead, which is what "from 10pm" means
 * in practice.
 *
 * "After the start" is measured from `dayResetTime`, not from midnight,
 * because every consumer places both ends with onLogicalDay, which rolls a
 * clock time earlier than the reset onto the next date. Under a 4 AM reset
 * "22:00–02:00" is a real four-hour window (the end lands after the start)
 * and "03:00–05:00" is not: the start rolls to tomorrow 03:00 while the end
 * stays on today's 05:00. Compared as raw minutes the second looked fine and
 * the task read as expired all day, never having been shown once.
 *
 * The rule lives here rather than beside its first caller so a store-free
 * module can share it rather than fork it, the same split taskDayStart above
 * already makes. `effectiveWindowEnd` in
 * visibilityUtils.ts is this with a Task in front of it, and dayTimeline.ts
 * reads it directly because importing that module would pull the settings and
 * category stores into one that stays inside Jest's node environment.
 */
export function effectiveWindowEndTime(
  windowStart: string | null,
  windowEnd: string | null,
  dayResetTime: string = '00:00',
): string | null {
  if (!windowEnd) return null;
  if (!windowStart) return windowEnd;
  const reset = hhmmMinutes(dayResetTime);
  const sinceReset = (hhmm: string) => (hhmmMinutes(hhmm) - reset + 1440) % 1440;
  if (sinceReset(windowEnd) <= sinceReset(windowStart)) return null;
  return windowEnd;
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

/**
 * An `HH:MM` placed on the logical day that starts at `dayStart`: a time
 * earlier than the reset belongs to the small hours at the *end* of that day,
 * so it rolls onto the next calendar date. See the note on its re-export in
 * visibilityUtils for the bug a bare `setHours` on the day start caused.
 */
export function onLogicalDay(dayStart: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const t = new Date(dayStart);
  t.setHours(h, m, 0, 0);
  if (t < dayStart) t.setDate(t.getDate() + 1);
  return t;
}
