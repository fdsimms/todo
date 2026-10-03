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

/**
 * Everything about a calendar read that `nudgeReminderPastMeeting` can see,
 * as one comparable string: the events that occupy time, by id and span.
 *
 * The nudge is applied when a reminder is scheduled, so a meeting added or
 * moved afterward never reached the reminder it now overlaps. The fix is to
 * rebuild the queue when the meetings change, and this is what says whether
 * they did: the calendar store refreshes on every foreground with a fresh
 * array either way, and rebuilding the whole notification queue on each of
 * those would be work for nothing most times. Order-free, so a read that
 * returns the same events in another order isn't a change.
 */
export function meetingSignature(events: readonly BusyEvent[]): string {
  return events
    .filter(occupiesTime)
    .map(e => `${e.id}|${e.start}|${e.end}`)
    .sort()
    .join('\n');
}
