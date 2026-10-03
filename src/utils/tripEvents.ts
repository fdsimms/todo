import type { Project } from '../types';
import { allDayRangeMs, isLiveEvent, type BusyEvent } from './calendarBusy';
import { awayNoonIso, awaySpanOf } from './awayDates';
import { dayKeyOf } from './dateUtils';

/**
 * A calendar event that could be a trip, and the away span it would give a
 * project.
 *
 * Nothing here decides an event *is* a trip. The event sheet offers "Make this
 * a trip" on any event that spans days, and the person says yes or doesn't:
 * a three-day conference in town and a week in Lisbon look the same to a
 * calendar, and only one of them is time away from home. That is also why
 * availability isn't consulted, unlike `blocksWholeDay`: calendars create
 * all-day events as Free, and "Lisbon" left at the default is still a trip.
 *
 * See docs/arch/away-dates.md for what the span then drives.
 */

const DAY_MS = 86_400_000;

/**
 * A live event covering two or more days: an all-day event naming two dates or
 * more, or a timed one at least a day long that ends on a later date. The
 * second condition keeps an overnight flight (22:00 to 06:00) out.
 */
export function spansDays(event: BusyEvent): boolean {
  if (!isLiveEvent(event)) return false;
  const span = tripSpanOf(event);
  if (!span) return false;
  if (event.allDay) {
    // Two dates or more: the exclusive end at least two days past the start,
    // counted in dates so a DST change inside the span can't shave it short.
    const { start } = span;
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 2) <= span.end;
  }
  return Date.parse(event.end) - Date.parse(event.start) >= DAY_MS;
}

/**
 * The days the event would make a project away for: departure, and the day
 * you are back, in local dates (midnight). Null for an unreadable event.
 *
 * - **All-day**: the dates the event names, its exclusive end being the day
 *   after the last one. That makes the return day the first day the event no
 *   longer covers, so the away days are exactly the event's days.
 * - **Timed**: the date it starts and the date it ends. A trip that ends at
 *   18:00 on the 25th has you back on the 25th, which `isAwayDay` then leaves
 *   out of the span, the same as a return date typed into the project.
 */
export function tripSpanOf(event: BusyEvent): { start: Date; end: Date } | null {
  if (event.allDay) {
    const range = allDayRangeMs(event);
    if (!range || range.end <= range.start) return null;
    return { start: new Date(range.start), end: new Date(range.end) };
  }
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  return {
    start: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
    end: new Date(end.getFullYear(), end.getMonth(), end.getDate()),
  };
}

/** The project fields for that span, stored at noon like every other away date. */
export function awayFieldsFromEvent(event: BusyEvent): { awayStart: string; awayEnd: string } | null {
  const span = tripSpanOf(event);
  if (!span) return null;
  return { awayStart: awayNoonIso(span.start), awayEnd: awayNoonIso(span.end) };
}

/**
 * A live project already away for exactly the event's days, so the sheet can
 * open it rather than offer to make a second one. Matched on dates rather than
 * on a stored link: the app keeps no record of which event a project came
 * from, and a project whose dates were typed in by hand for the same trip is
 * the same trip.
 */
export function projectForTripEvent<T extends Pick<Project, 'id' | 'awayStart' | 'awayEnd' | 'archived' | 'completed'>>(
  projects: readonly T[],
  event: BusyEvent,
  dayResetTime?: string,
): T | null {
  const span = tripSpanOf(event);
  if (!span) return null;
  const startKey = dayKeyOf(span.start);
  const endKey = dayKeyOf(span.end);
  for (const project of projects) {
    if (project.archived || project.completed) continue;
    const away = awaySpanOf(project, dayResetTime);
    if (!away || !away.end) continue;
    if (dayKeyOf(away.start) === startKey && dayKeyOf(away.end) === endKey) return project;
  }
  return null;
}
