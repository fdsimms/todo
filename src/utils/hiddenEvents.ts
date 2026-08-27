import type { BusyEvent } from './calendarBusy';

/**
 * A calendar event the user has asked never to be shown on Today again — not a
 * `Task`, and not a write to the event itself (the calendar stays read-only,
 * see `calendarSync.ts`). Small and standalone for the same reason
 * `EventReminder` is: an event comes and goes as the 14-day `useCalendarStore`
 * window slides and has no completion state of its own.
 *
 * **Keyed by `(id, start)`, not `id` alone** — same reason as `EventReminder`:
 * EventKit shares one `id` across every instance of a recurring series, so
 * hiding today's 9am standup must not silently also hide tomorrow's.
 */
export interface HiddenEvent {
  key: string;
  eventId: string;
  /** ISO — the occurrence this hide applies to, not the series. */
  eventStart: string;
  /** ISO — when this occurrence is over, and so when the hide stops mattering. */
  eventEnd: string;
}

export function hiddenEventKey(event: Pick<BusyEvent, 'id' | 'start'>): string {
  return `${event.id}|${event.start}`;
}

export function hiddenEventFromEvent(event: BusyEvent): HiddenEvent {
  return {
    key: hiddenEventKey(event),
    eventId: event.id,
    eventStart: event.start,
    eventEnd: event.end,
  };
}

/**
 * An event whose occurrence is over has nothing left to hide — the same call
 * `eventContextRows` makes about dropping a finished event from Today. Pruning
 * on the end, not the start, is the one difference from `isReminderStale`: a
 * hide is meant to last the whole event, not just until it begins.
 */
export function isHiddenEventStale(hidden: HiddenEvent, now: Date): boolean {
  return Date.parse(hidden.eventEnd) <= now.getTime();
}

export function pruneStaleHiddenEvents(
  hiddenByKey: Readonly<Record<string, HiddenEvent>>,
  now: Date
): Record<string, HiddenEvent> {
  const kept: Record<string, HiddenEvent> = {};
  for (const [key, hidden] of Object.entries(hiddenByKey)) {
    if (!isHiddenEventStale(hidden, now)) kept[key] = hidden;
  }
  return kept;
}
