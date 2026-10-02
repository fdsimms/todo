import { addHours } from 'date-fns/addHours';
import { alertRelativeOffset } from './quickEvent';
import { parseLinkInput } from './parseTaskInput';
import type { EventSaveFields } from './calendarSync';
import type { EventAvailability } from './quickEventDefaults';

/**
 * A pasted link in the "Notes or link" field goes to the event's URL, since
 * that is the row Calendar shows it on; anything else is a note. Only a field
 * holding nothing but the link counts: "call 555-1234 or https://x.co" is a
 * note that happens to contain one, and splitting it would lose the sentence.
 */
export function splitNotesAndLink(text: string): { notes?: string; url?: string } {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const link = parseLinkInput(trimmed);
  if (link && link.url === trimmed) return { url: link.url };
  return { notes: trimmed };
}

export interface QuickEventSaveInput {
  title: string;
  start: Date;
  /** Left out for the one-hour default; an all-day event ends the next midnight. */
  end?: Date;
  allDay?: boolean;
  location?: string | null;
  notesOrLink?: string;
  alertMinutes: number | null;
  availability: EventAvailability;
  calendarId: string | null;
}

/**
 * The write both quick-add entry points make (`QuickEventSheet` and a
 * "event: …" line in task quick add), built in one place so they can't
 * disagree about what a line with a place and an alert means.
 */
export function quickEventSaveFields(input: QuickEventSaveInput): EventSaveFields {
  const allDay = input.allDay === true;
  const end = input.end ?? addHours(input.start, 1);
  const location = input.location?.trim();
  return {
    title: input.title,
    start: input.start,
    end,
    allDay,
    ...(location ? { location } : {}),
    ...splitNotesAndLink(input.notesOrLink ?? ''),
    ...(input.alertMinutes !== null
      ? { alarms: [{ relativeOffset: alertRelativeOffset(input.alertMinutes, allDay) }] }
      : {}),
    availability: input.availability,
    calendarId: input.calendarId,
  };
}

/** "None", "At start", "30 min before", "1 hour before", "2 days before". */
export function describeAlert(minutes: number | null, allDay = false): string {
  if (minutes === null) return 'None';
  if (minutes === 0) return allDay ? 'At 9:00 AM' : 'At start';
  const [n, unit] =
    minutes % 1440 === 0 ? [minutes / 1440, 'day'] : minutes % 60 === 0 ? [minutes / 60, 'hour'] : [minutes, 'min'];
  return `${n} ${unit}${unit !== 'min' && n !== 1 ? 's' : ''} before`;
}

/** The alert choices the chip's picker offers. A typed "alert 3h" still works; it just isn't listed. */
export const ALERT_CHOICES: readonly number[] = [0, 5, 10, 15, 30, 60, 120, 1440];
