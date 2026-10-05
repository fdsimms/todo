import { addDays } from 'date-fns/addDays';
import { addHours } from 'date-fns/addHours';
import type { ExtractedCalendarEvent } from '../services/aiSuggestions';
import type { BusyEvent } from './calendarBusy';
import type { QuickEventSeed } from '../components/QuickEventSheet';

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
 * **The fallback for the one case `eventImportCreateFields` below
 * refuses: no date was read at all.** A calendar event has to start
 * *somewhere*; a task doesn't, so an extraction with nothing to hang a date on
 * (a confirmation number with no visible date) still becomes something rather
 * than being dropped. `EventImportSheet`'s caller tries the event path first
 * and only reaches for this when that comes back null.
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

/** The default span given to an imported event with a clock time but no stated end. */
const EVENT_IMPORT_DEFAULT_DURATION_HOURS = 1;

/** The fields `presentEventCreate` opens with, for one extracted event. */
export interface EventImportCreateFields {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  notes?: string;
  alarms?: { relativeOffset: number }[];
}

/**
 * Turns one extracted event into the fields a real calendar event opens with
 * — the counterpart of `draftFromExtractedEvent` above, and the path
 * `EventImportSheet`'s caller reaches for first: a flight or a dentist
 * appointment read off a confirmation is a calendar event, not a task, and
 * putting it on the calendar is also what lets `eventTasks.ts`'s own rules
 * ("flight" → pack a bag) fire against it later.
 *
 * **Returns null when no date was read.** An event needs a real start; a
 * confirmation with no legible date has nothing to hang one on, and the
 * caller falls back to `draftFromExtractedEvent` in that one case rather than
 * inventing a day.
 *
 * **`allDay` mirrors whether a time was read, and decides the span with it.**
 * A time-of-day reading gets a real clock start and a one-hour span — nothing
 * in an `ExtractedCalendarEvent` says how long something lasts, and an hour is
 * the same default `quickEvent.ts` gives a hand-typed event. No time read
 * means the source didn't say one (an all-day thing like "Dad's birthday"),
 * so the event spans the whole day rather than opening at a fabricated hour —
 * midnight-to-midnight would otherwise show as a 12:00am appointment.
 *
 * **`alarms` is set only when a time was read, firing at the event's own
 * start.** That's the same condition under which `draftFromExtractedEvent`
 * would have set `reminderTime` and so scheduled a task notification — this
 * is its replacement, riding with the calendar item instead of the app's own
 * notification queue. The user still sees and can change it in Apple's own
 * Alert row before saving, same as any event they create by hand.
 *
 * Every number comes straight off what the model read, never off the device
 * clock — see `draftFromExtractedEvent`'s note on why that's not a
 * `dayResetTime` scheduling decision.
 */
export function eventImportCreateFields(event: ExtractedCalendarEvent): EventImportCreateFields | null {
  const dateParts = event.date ? parseDateParts(event.date) : null;
  if (!dateParts) return null;
  const timeParts = event.time ? parseTimeParts(event.time) : null;
  const allDay = !timeParts;
  const start = timeParts
    ? new Date(dateParts.y, dateParts.m - 1, dateParts.d, timeParts.hh, timeParts.mm, 0, 0)
    : new Date(dateParts.y, dateParts.m - 1, dateParts.d, 0, 0, 0, 0);
  const end = allDay ? addDays(start, 1) : addHours(start, EVENT_IMPORT_DEFAULT_DURATION_HOURS);
  return {
    title: event.title,
    start,
    end,
    allDay,
    location: event.location || undefined,
    notes: event.notes || undefined,
    alarms: timeParts ? [{ relativeOffset: 0 }] : undefined,
  };
}

/**
 * `eventImportCreateFields` as the seed `QuickEventSheet` opens on, so an
 * imported event is reviewed in the app's own event card rather than Apple's.
 * Null under the same condition: no readable date.
 */
export function eventImportQuickSeed(event: ExtractedCalendarEvent): QuickEventSeed | null {
  const f = eventImportCreateFields(event);
  if (!f) return null;
  return {
    title: f.title,
    start: f.start,
    end: f.end,
    allDay: f.allDay,
    location: f.location,
    notes: f.notes,
    alertMinutes: f.alarms ? 0 : null,
  };
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
