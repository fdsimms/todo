import { busyMinutesIn, occupiesTime, type BusyEvent } from './calendarBusy';
import { dayKeyToDate } from './dateUtils';

/**
 * Whether the calendar has you out on the evening a dinner is planned.
 *
 * Meal Plan uses it to flag the dinner, and nothing more: it changes no plan,
 * skips no cook or thaw task and moves nothing. An evening out is often a
 * dinner you'd still cook for the rest of the house, so the plan is yours to
 * change, and this only makes sure you see the clash in time to.
 *
 * "Evening" is the span the time-of-day settings already define, from
 * `eveningStart` to `nightStart` (18:00 to 21:00 by default), on the meal's own
 * calendar date. A meal slot has no clock time of its own, and inventing one
 * for dinner would be a second, private answer to a question Settings answers.
 */

/** How much of the evening has to be taken before a dinner is flagged. */
export const BUSY_EVENING_MIN_MINUTES = 60;

export interface BusyEvening {
  /** The event taking the most of the evening, so the flag can name it. */
  title: string;
  minutes: number;
}

function atTime(dayKey: string, hhmm: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const date = dayKeyToDate(dayKey);
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date;
}

/**
 * The busy evening on `dayKey`, or null when the evening is free, the times
 * don't make a span, or the calendar wasn't read that far (`covered`: the
 * store's read window). A day outside the window is unknown, not free, and
 * the answer for unknown is to say nothing.
 *
 * Events are counted the way every other busy reader counts them
 * (`occupiesTime`: no all-day, free or cancelled events), merged so two
 * overlapping events aren't counted twice.
 */
export function busyEveningOn(
  events: readonly BusyEvent[],
  dayKey: string,
  times: { eveningStart: string; nightStart: string },
  covered: { start: Date; end: Date } | null,
): BusyEvening | null {
  const start = atTime(dayKey, times.eveningStart);
  const end = atTime(dayKey, times.nightStart);
  if (!start || !end || end <= start || !covered) return null;
  if (start < covered.start || end > covered.end) return null;

  const minutes = busyMinutesIn(events, start, end);
  if (minutes < BUSY_EVENING_MIN_MINUTES) return null;

  let best: { title: string; overlap: number } | null = null;
  for (const event of events) {
    if (!occupiesTime(event)) continue;
    const overlap = Math.min(Date.parse(event.end), end.getTime()) - Math.max(Date.parse(event.start), start.getTime());
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { title: event.title.trim(), overlap };
  }
  return { title: best?.title ?? '', minutes };
}

/** "Busy evening: Dinner at Mia's", or just "Busy evening" for an untitled event. */
export function describeBusyEvening(evening: BusyEvening): string {
  return evening.title ? `Busy evening: ${evening.title}` : 'Busy evening';
}
