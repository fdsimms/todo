import type { BusyEvent } from './calendarBusy';

/**
 * What the right-hand pane of Today shows while no task is open in it
 * (`TodayGlance`): the events the day still has ahead of it, as a short list.
 *
 * It is the same read the "events left" figure under the view pills makes, with
 * the same refusals: an event the person hid from Today stays hidden, and one
 * that has ended is gone. An all-day event is kept until the day ends, since it
 * has no moment to be over at, and is listed as "All day" rather than at 12:00 AM.
 */
export interface GlanceEvent {
  /** Stable across renders, and distinct for two occurrences of one repeating event. */
  key: string;
  title: string;
  /** A clock time, or "All day". */
  time: string;
}

/** How many events the list shows. Past it the calendar is the place to look. */
export const GLANCE_EVENT_LIMIT = 5;

export function glanceEvents(
  events: readonly BusyEvent[],
  now: Date,
  isHidden: (event: BusyEvent) => boolean,
  formatTime: (at: Date) => string,
  limit: number = GLANCE_EVENT_LIMIT,
): GlanceEvent[] {
  const nowMs = now.getTime();
  const out: GlanceEvent[] = [];
  for (const event of events) {
    if (out.length >= limit) break;
    if (isHidden(event)) continue;
    if (!event.allDay && new Date(event.end).getTime() <= nowMs) continue;
    out.push({
      key: `${event.id}-${event.start}`,
      title: event.title,
      time: event.allDay ? 'All day' : formatTime(new Date(event.start)),
    });
  }
  return out;
}
