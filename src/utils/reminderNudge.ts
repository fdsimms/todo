/**
 * Nudging a reminder past a meeting it would otherwise land inside.
 *
 * Pure, like `calendarBusy.ts` — the rule (move to the moment the meeting
 * ends) lives here so it's tested without a device, and both
 * `notifications.ts` (what actually fires) and `TaskEditor.tsx` (what the
 * Remind me row says) call the same function rather than risking two
 * answers to "does this land in a meeting".
 */

import { BusyEvent, busyIntervalsIn, occupiesTime } from './calendarBusy';

const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

export interface ReminderNudge {
  /** When to actually fire — `reminderTime` unchanged unless `nudged`. */
  time: Date;
  /** Whether `reminderTime` fell inside a live, timed, non-Free event. */
  nudged: boolean;
  /** The event responsible, for a caption to name. Null unless `nudged`. */
  meetingTitle: string | null;
}

/**
 * Pushes `reminderTime` to the end of whatever meeting it lands inside.
 *
 * Only ever moves later, never earlier — the same call `deferPastQuietHours`
 * makes about a quiet-hours window's close, and for the same reason: a
 * reminder firing before the moment the user picked is a surprise in the
 * direction that matters, where a few minutes late is not.
 *
 * The search window is deliberately generous (a day either side of
 * `reminderTime`) so an event that started yesterday and runs past midnight
 * still counts, without needing the caller to know a day boundary.
 */
export function nudgeReminderPastMeeting(
  reminderTime: Date,
  events: readonly BusyEvent[]
): ReminderNudge {
  const rangeStart = new Date(reminderTime.getTime() - LOOKBACK_MS);
  const rangeEnd = new Date(reminderTime.getTime() + LOOKAHEAD_MS);
  const at = reminderTime.getTime();

  const interval = busyIntervalsIn(events, rangeStart, rangeEnd)
    .find(i => at >= i.start && at < i.end);
  if (!interval) return { time: reminderTime, nudged: false, meetingTitle: null };

  // Merged intervals can span several events; name whichever one actually
  // covers the original time; not necessarily unique but good enough for a
  // caption — the exact fire time already comes from the merged interval.
  const meeting = events.find(event => {
    if (!occupiesTime(event)) return false;
    const start = new Date(event.start).getTime();
    const end = new Date(event.end).getTime();
    return start <= at && end > at;
  });

  return { time: new Date(interval.end), nudged: true, meetingTitle: meeting?.title || null };
}
