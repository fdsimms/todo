import type { BusyEvent } from './calendarBusy';

/**
 * A lightweight, opt-in notification tied to a single calendar event shown on
 * Today (`TodayEventsSheet`) — not a `Task`. An event lives in the system
 * calendar, has no completion state, and comes and goes as the 14-day
 * `useCalendarStore` window slides, so it gets its own small mechanism rather
 * than being promoted into a real task row (see the discussion in the PR that
 * added this).
 *
 * **Keyed by `(id, start)`, not `id` alone.** EventKit shares one `id` across
 * every instance of a recurring series (`calendarSync.ts`), so a reminder set
 * on today's 9am standup must not silently also apply to tomorrow's.
 */
export interface EventReminder {
  key: string;
  eventId: string;
  /** ISO — the occurrence this reminder is for, not the series. */
  eventStart: string;
  eventTitle: string;
  /** Minutes before `eventStart` the notification fires. 0 = at the start time. */
  offsetMinutes: number;
}

/** A small closed set, offered as a `SegmentedControl` — see TodayEventsSheet. */
export const EVENT_REMINDER_OFFSETS: readonly number[] = [0, 5, 15, 30, 60];

export function eventReminderKey(event: Pick<BusyEvent, 'id' | 'start'>): string {
  return `${event.id}|${event.start}`;
}

export function reminderFromEvent(event: BusyEvent, offsetMinutes: number): EventReminder {
  return {
    key: eventReminderKey(event),
    eventId: event.id,
    eventStart: event.start,
    eventTitle: event.title || 'Event',
    offsetMinutes,
  };
}

export function reminderTriggerDate(reminder: EventReminder): Date {
  return new Date(Date.parse(reminder.eventStart) - reminder.offsetMinutes * 60_000);
}

/**
 * An event that has already started has nothing left to remind anyone about
 * — the same call `eventContextRows` makes about a finished event. Purging on
 * this rather than on the 14-day calendar window means a reminder survives
 * the event temporarily scrolling out of `useCalendarStore`'s range (e.g. the
 * app sitting closed across the window boundary) but is still gone the
 * instant it stops being useful.
 */
export function isReminderStale(reminder: EventReminder, now: Date): boolean {
  return Date.parse(reminder.eventStart) <= now.getTime();
}

export function pruneStaleReminders(
  reminders: Readonly<Record<string, EventReminder>>,
  now: Date
): Record<string, EventReminder> {
  const kept: Record<string, EventReminder> = {};
  for (const [key, reminder] of Object.entries(reminders)) {
    if (!isReminderStale(reminder, now)) kept[key] = reminder;
  }
  return kept;
}

export function describeEventReminderOffset(minutes: number): string {
  if (minutes === 0) return 'At start time';
  if (minutes < 60) return `${minutes} min before`;
  const hours = minutes / 60;
  return `${hours} hr${hours === 1 ? '' : 's'} before`;
}
