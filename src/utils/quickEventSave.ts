import { addHours } from 'date-fns/addHours';
import { addMinutes } from 'date-fns/addMinutes';
import { alertRelativeOffset, DEFAULT_EVENT_MINUTES, type EventRecurrence, type QuickEventDraft } from './quickEvent';
import type { RememberedEvent } from './eventMemory';
import type { QuickEventDefaults } from './quickEventDefaults';
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
  repeat?: EventRecurrence | null;
  /** The coordinate of a place picked for `location`; dropped when there is no location. */
  place?: { latitude: number; longitude: number } | null;
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
    ...(location && input.place ? { place: { latitude: input.place.latitude, longitude: input.place.longitude } } : {}),
    ...splitNotesAndLink(input.notesOrLink ?? ''),
    ...(input.alertMinutes !== null
      ? { alarms: [{ relativeOffset: alertRelativeOffset(input.alertMinutes, allDay) }] }
      : {}),
    ...(input.repeat ? { recurrence: input.repeat } : {}),
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

/**
 * A typed line resolved to what it saves, with nothing picked by hand: the
 * `event:` line in task quick add, which has no chips. The card resolves the
 * same way with its picks layered on top. In order of strength: what the line
 * says, then the last event with this title (`recalled`), then the defaults.
 * An untimed line ("lunch fri") starts at the first free slot that day when
 * `freeSlotFor` finds one, asked with the length the event will have.
 */
export function quickEventFromLine(
  draft: Pick<QuickEventDraft, 'title' | 'start' | 'timed' | 'durationMinutes' | 'location' | 'alertMinutes' | 'repeat'>,
  context: {
    recalled: RememberedEvent | null;
    defaults: QuickEventDefaults;
    freeSlotFor: (minutes: number) => Date | null;
  },
): QuickEventSaveInput & { durationMinutes: number; end: Date } {
  const { recalled, defaults } = context;
  const durationMinutes = draft.durationMinutes ?? recalled?.durationMinutes ?? DEFAULT_EVENT_MINUTES;
  const start = draft.timed ? draft.start : context.freeSlotFor(durationMinutes) ?? draft.start;
  const location = draft.location ?? recalled?.location ?? null;
  return {
    title: draft.title,
    start,
    end: addMinutes(start, durationMinutes),
    durationMinutes,
    location,
    place: draft.location ? null : recalled?.place ?? null,
    repeat: draft.repeat,
    alertMinutes: draft.alertMinutes !== undefined
      ? draft.alertMinutes
      : recalled ? recalled.alertMinutes : defaults.alertMinutes,
    availability: recalled?.availability ?? defaults.availability,
    calendarId: recalled?.calendarId ?? defaults.calendarId,
  };
}
