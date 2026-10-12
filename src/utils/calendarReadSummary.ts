/**
 * What Settings says about the calendar read, per calendar and as a whole
 * (#1744: "can't tell if all selected calendars are actually being imported").
 *
 * Kept apart from `CalendarSettings` because every case here is one a person
 * would otherwise misread: a count with no period ("3 events" over what?), a
 * calendar the read deliberately left out saying nothing at all, and a read
 * that keeps failing looking exactly like one still in flight.
 */

export interface CalendarLineInput {
  /** The calendar's entry from the last read, if it was read at all. */
  status: { ok: boolean } | undefined;
  /** Events from this calendar in the window that weren't canceled. */
  liveCount: number;
  /** Left out of the read on purpose: vacation mode with this calendar hidden. */
  hiddenForVacation: boolean;
  /** The last whole read failed, so `status` is left over from an earlier one. */
  readFailed: boolean;
  /** How many days ahead the read covers, said in the count. */
  windowDays: number;
}

/**
 * The second line under a calendar in the picker, or undefined for nothing to
 * say yet (picked a moment ago, before the read comes back).
 *
 * After a failed read the old counts are left over from an earlier read, so
 * none is shown rather than presenting stale numbers as current; the warning
 * row and the Today row say the read failed.
 */
export function calendarStatusLine(input: CalendarLineInput): string | undefined {
  if (input.hiddenForVacation) return 'Hidden during vacation';
  if (input.readFailed || !input.status) return undefined;
  if (!input.status.ok) return "Couldn’t read";
  const days = `in the next ${input.windowDays} days`;
  if (input.liveCount === 0) return `No events ${days}`;
  return `${input.liveCount} event${input.liveCount === 1 ? '' : 's'} ${days}`;
}

/**
 * The warning row's label when some calendars failed their own read.
 * `readCount` is the calendars the read actually asked about, so a calendar
 * hidden for vacation doesn't make "all of them failed" read as "some did".
 */
export function failedCalendarsLabel(failedCount: number, readCount: number): string {
  if (failedCount >= readCount) return 'None of your calendars could be read';
  return `${failedCount} calendar${failedCount === 1 ? '' : 's'} couldn’t be read just now`;
}

/**
 * The Today row's text when there's no current read to summarize, or null when
 * there is one and the caller should describe the day.
 */
export function todayFallback(input: { loaded: boolean; readFailed: boolean; readCount: number }): string | null {
  if (input.loaded) return null;
  if (input.readCount === 0) return 'Every calendar is hidden during vacation';
  if (input.readFailed) return 'Couldn’t read your calendars. Try Sync now.';
  return 'Checking…';
}
