import type { ExtractedCalendarEvent } from '../services/aiSuggestions';

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
