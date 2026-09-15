import type { ExtractedCalendarEvent } from '../services/aiSuggestions';
import type { BusyEvent } from './calendarBusy';

/** The subset of TaskEditor's TaskDraft an imported event can fill in. */
export interface CalendarEventDraft {
  title: string;
  notes: string;
  dueDate: Date | null;
  reminderTime: Date | null;
  location: string | null;
}

/**
 * Turns one extracted event into the fields a fresh task opens with.
 *
 * Every number here — year, month, day, hour, minute — comes straight off
 * what the model read from the page, never off the device clock, so this
 * isn't the kind of scheduling decision src/utils/dateUtils.ts warns about:
 * nothing is measured from "today" or "now", so there's no dayResetTime
 * grace window to get wrong.
 *
 * `dueDate` always lands at noon on the read date — the same "safe for
 * display" convention getLogicalToday() uses — regardless of whether a time
 * was given; the actual time-of-day lives on `reminderTime`, the field the
 * rest of the app already reads to show and notify at a specific hour.
 */
export function draftFromExtractedEvent(event: ExtractedCalendarEvent): CalendarEventDraft {
  const dateParts = event.date ? parseDateParts(event.date) : null;
  const timeParts = event.time ? parseTimeParts(event.time) : null;
  return {
    title: event.title,
    notes: event.notes,
    dueDate: dateParts ? new Date(dateParts.y, dateParts.m - 1, dateParts.d, 12, 0, 0, 0) : null,
    reminderTime: dateParts && timeParts
      ? new Date(dateParts.y, dateParts.m - 1, dateParts.d, timeParts.hh, timeParts.mm, 0, 0)
      : null,
    location: event.location || null,
  };
}

function parseDateParts(raw: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function parseTimeParts(raw: string): { hh: number; mm: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  return { hh: Number(match[1]), mm: Number(match[2]) };
}

/**
 * The fields a task made from a *device calendar* event opens with.
 *
 * The other direction from `draftFromExtractedEvent` above, and a narrower
 * one: that reads a confirmation page nobody has filed yet, so it fills a
 * whole editor and waits for a person to approve it. This reads an event that
 * is already on the calendar, which means the date is not a guess and there is
 * nothing to approve — so the caller writes the task outright and the fields
 * here are only what the event can say for itself.
 *
 * **Title and location are copied verbatim; nothing is inferred from them.**
 * No parse, no schedule words peeled off the title, no time-of-day segment
 * read off the start hour. A calendar title is text somebody wrote for another
 * purpose (see `calendarHistory.ts`'s note on why the guess gets the higher
 * bar), and a task made from one at the user's explicit tap is exactly the
 * case where the app has been told what it needs and should stop reading.
 * `notes` is absent because `BusyEvent` does not carry the event's notes.
 *
 * Like `draftFromExtractedEvent`, every number comes off the event rather than
 * off the device clock, so there is no `dayResetTime` grace window to get
 * wrong: `dueDate` is noon on the day the event *starts*, the same
 * "safe for display" convention `getLogicalToday()` uses.
 */
export interface EventTaskFields {
  title: string;
  dueDate: string;
  location: string | null;
}

/** Noon on the local day `iso` falls on, as an ISO string. */
export function eventDayDueDate(iso: string, daysBefore = 0): string {
  const start = new Date(iso);
  const due = new Date(start.getFullYear(), start.getMonth(), start.getDate() - daysBefore, 12, 0, 0, 0);
  return due.toISOString();
}

/**
 * One device-calendar event as the fields a task made from it carries.
 *
 * `daysBefore` shifts the day the task lands on without touching anything
 * else, which is what an event *rule*'s lead time needs ("pack three days
 * before a flight"); the tap-to-add path passes nothing and lands on the
 * event's own day.
 */
export function taskFieldsFromEvent(event: BusyEvent, daysBefore = 0): EventTaskFields {
  return {
    // An untitled event is a real thing EventKit hands back, and an empty task
    // title renders as a blank row — the same fallback TodayEventsSheet and
    // `eventContextRows` already show it under.
    title: event.title || 'Event',
    dueDate: eventDayDueDate(event.start, daysBefore),
    location: event.location || null,
  };
}
