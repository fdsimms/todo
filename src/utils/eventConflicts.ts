import { freeGapsIn, occupiesTime, type BusyEvent } from './calendarBusy';

/**
 * What a new event would collide with, and the first open time on a day: the
 * quick-add card's two readings of the calendar it already reads
 * (`useCalendarStore`). Both only ever *offer*: a warning the user can save
 * through, and a start time shown on the date chip they can change.
 *
 * Busy means what it means everywhere else (`occupiesTime`): not all-day, not
 * marked Free, not cancelled.
 */

/** Earliest a suggested slot starts, and the latest it may end, on the clock. */
export const FREE_SLOT_DAY_START_HOUR = 9;
export const FREE_SLOT_DAY_END_HOUR = 21;
/** Suggested starts land on the quarter hour, the way a person would pick one. */
const SLOT_STEP_MINUTES = 15;

/** The busy events [start, end) runs into, earliest first. */
export function overlappingEvents(start: Date, end: Date, events: readonly BusyEvent[]): BusyEvent[] {
  const from = start.getTime();
  const to = end.getTime();
  if (!(to > from)) return [];
  return events
    .filter(event => {
      if (!occupiesTime(event)) return false;
      const s = Date.parse(event.start);
      const e = Date.parse(event.end);
      return Number.isFinite(s) && Number.isFinite(e) && s < to && e > from;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

function ceilToStep(ms: number): number {
  const step = SLOT_STEP_MINUTES * 60000;
  return Math.ceil(ms / step) * step;
}

/**
 * The first start on `day` with `minutes` free after it, between 9am and 9pm
 * and not before `now`, on a quarter hour. Null when the day has no such gap
 * (or is already over). The day is a calendar date: only its year, month and
 * date are read.
 */
export function firstFreeSlot(
  day: Date,
  minutes: number,
  events: readonly BusyEvent[],
  now: Date,
): Date | null {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), FREE_SLOT_DAY_START_HOUR, 0);
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), FREE_SLOT_DAY_END_HOUR, 0);
  const from = new Date(Math.max(dayStart.getTime(), ceilToStep(now.getTime())));
  if (from >= dayEnd) return null;
  const length = minutes * 60000;
  for (const gap of freeGapsIn(events, from, dayEnd, minutes)) {
    const start = ceilToStep(gap.start);
    if (start + length <= gap.end) return new Date(start);
  }
  return null;
}

/**
 * Whether the calendar read covers [start, end), so "no conflicts" and "the
 * first free time" mean something. Outside the window the app hasn't read the
 * calendar, and an empty answer there would be a guess.
 */
export function calendarCovers(
  windowStart: string | null,
  windowEnd: string | null,
  start: Date,
  end: Date,
): boolean {
  if (!windowStart || !windowEnd) return false;
  const ws = Date.parse(windowStart);
  const we = Date.parse(windowEnd);
  return Number.isFinite(ws) && Number.isFinite(we) && start.getTime() >= ws && end.getTime() <= we;
}
