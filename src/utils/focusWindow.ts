import type { BusyEvent } from './calendarBusy';
import { nextEventAfter } from './calendarBusy';

/**
 * "Until my next meeting" as a focus window.
 *
 * The setup sheet's time window is a plain number of minutes, and this is one
 * *source* for that number rather than a second kind of window. Everything
 * downstream — the fit check, the summary, the plan — sees an ordinary
 * `windowMinutes` and knows nothing about where it came from. That's the whole
 * reason this is a separate module: the calendar is one answer to "how long
 * have you got", not a parallel feature.
 *
 * Pure, and handed its events and its clock, so it tests without a store or a
 * device calendar. The caller is responsible for the two gates it can't see:
 * that calendar reading is switched on, and that the last read actually
 * succeeded (`useCalendarStore.loaded` — an empty list and an unopenable
 * calendar look identical, and only one of them means the afternoon is free).
 */

/** How far ahead an event can be and still be the thing bounding your session. */
export const FOCUS_CALENDAR_HORIZON_MINUTES = 240;

export interface CalendarWindow {
  /** Whole minutes from now until it starts. */
  minutes: number;
  /** What it's called, for the caption beside the pill. */
  title: string;
  /** When it starts, for the pill's own label. */
  startsAt: Date;
}

/**
 * The gap to the next thing on the calendar, when that gap is a usable window.
 *
 * Null when there's nothing next, when it's further off than
 * `FOCUS_CALENDAR_HORIZON_MINUTES` (a meeting six hours away is not what's
 * bounding the next hour of work), or when it's closer than `minMinutes` (a
 * window nothing could be suggested for). `nextEventAfter` already skips
 * all-day events, cancelled ones, and anything already under way.
 *
 * **The gap is floored, and no buffer is subtracted.** Rounding up would put
 * the last stretch inside the meeting. A buffer would be the kinder thing but
 * would make the pill's own label a lie: it says "Until 2:30", so the number
 * behind it has to be the time until 2:30. A plan almost never fills its window
 * exactly, and the projected end time is on screen either way.
 */
export function calendarWindow(
  events: readonly BusyEvent[],
  now: Date,
  opts: { minMinutes: number; horizonMinutes?: number },
): CalendarWindow | null {
  const horizon = opts.horizonMinutes ?? FOCUS_CALENDAR_HORIZON_MINUTES;
  const rangeEnd = new Date(now.getTime() + horizon * 60_000);
  const event = nextEventAfter(events, now, rangeEnd);
  if (!event) return null;

  const startsAt = new Date(event.start);
  const minutes = Math.floor((startsAt.getTime() - now.getTime()) / 60_000);
  if (minutes < opts.minMinutes) return null;

  return {
    minutes,
    // An untitled event still bounds the day, so it gets a stand-in rather
    // than being dropped — the time is the useful half of the label anyway.
    title: event.title.trim() === '' ? 'your next event' : event.title,
    startsAt,
  };
}
