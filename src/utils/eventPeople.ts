import { addHours } from 'date-fns/addHours';
import { startOfHour } from 'date-fns/startOfHour';
import type { BusyEvent } from './calendarBusy';
import { isLiveEvent } from './calendarBusy';
import { pastWindowStart, peopleNamedInTitle, type PersonName } from './calendarHistory';

/**
 * Who a calendar event is with, as far as this app is concerned — metadata the
 * app keeps about an event it does not own.
 *
 * **The event itself stays in the calendar.** Creating one goes through the
 * system sheet (`presentEventCreate` in `calendarSync.ts`), so it lands in
 * whichever calendar the user picks there, a Google account included, and
 * syncs wherever that calendar does. What lives here is the part only this app
 * reads: which people from the People list it is with.
 *
 * **Never calendar attendees.** Inviting somebody sends them an email and puts
 * their address on the event, and reading attendees back is on
 * `docs/arch/people.md`'s Never list. This link is private to the app: the
 * event on Google Calendar carries nothing about it.
 *
 * **Keyed by occurrence** (`id` + start), the fourth record keyed this way
 * after `EventReminder`, `HiddenEvent` and `eventTaskHandled`: EventKit shares
 * one id across every instance of a recurring series, so "Lunch w/ Mom" every
 * Sunday is one id and many lunches. The start is normalised through
 * `toISOString` so a key built from a `Date` read back after the system sheet
 * saves matches the one built from the string `fetchEvents` hands out.
 *
 * **It stays on this device**, for `calendarHistoryHandled`'s reason: an
 * EventKit id names a record on one device only. It is kept out of settings
 * sync (see the prose list in `syncTracking.ts`) and out of backups
 * (`DEVICE_ID_SETTING_KEYS`).
 */
export interface EventPeopleLink {
  key: string;
  eventId: string;
  /** ISO, the occurrence's own start. */
  eventStart: string;
  /** ISO. */
  eventEnd: string;
  /** Title at the time of linking, so a later reader has something to show. */
  title: string;
  personIds: string[];
}

export type EventPeopleLinks = Record<string, EventPeopleLink>;

export function eventPeopleKey(event: Pick<BusyEvent, 'id' | 'start'>): string {
  const ms = Date.parse(event.start);
  const start = Number.isFinite(ms) ? new Date(ms).toISOString() : event.start;
  return `${event.id}|${start}`;
}

/** Who a given occurrence is linked with, or nobody. */
export function peopleForEvent(
  links: Readonly<EventPeopleLinks>,
  event: Pick<BusyEvent, 'id' | 'start'>
): string[] {
  return links[eventPeopleKey(event)]?.personIds ?? [];
}

/**
 * The links after setting one occurrence's people. An empty set removes the
 * entry rather than keeping an empty one, so "linked to nobody" and "never
 * linked" are one state.
 */
export function withEventPeople(
  links: Readonly<EventPeopleLinks>,
  event: Pick<BusyEvent, 'id' | 'start' | 'end' | 'title'>,
  personIds: readonly string[]
): EventPeopleLinks {
  const key = eventPeopleKey(event);
  const next = { ...links };
  const unique = [...new Set(personIds)];
  if (unique.length === 0) {
    delete next[key];
    return next;
  }
  next[key] = {
    key,
    eventId: event.id,
    eventStart: event.start,
    eventEnd: event.end,
    title: event.title,
    personIds: unique,
  };
  return next;
}

/**
 * A link is kept until its occurrence falls out of the past-calendar window,
 * not merely until it ends. After the event, the link is what lets the
 * person's screen offer it as history (`suggestedHistoryEvents`), and that
 * offer is bounded by the same floor, so past it the link has no reader left.
 * Pruning on the start mirrors the offer's own refusal of an event that
 * started before the floor.
 */
export function isEventPeopleLinkStale(link: EventPeopleLink, now: Date): boolean {
  const start = Date.parse(link.eventStart);
  if (!Number.isFinite(start)) return true;
  return start < pastWindowStart(now).getTime();
}

export function pruneStaleEventPeople(
  links: Readonly<EventPeopleLinks>,
  now: Date
): EventPeopleLinks {
  const kept: EventPeopleLinks = {};
  for (const [key, link] of Object.entries(links)) {
    if (!isEventPeopleLinkStale(link, now)) kept[key] = link;
  }
  return kept;
}

/**
 * Reads a stored record, tolerating anything malformed. A record we can't read
 * is one we don't have, the same call `parseHandledHistoryEvents` makes.
 */
export function parseEventPeople(raw: string | null | undefined): EventPeopleLinks {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: EventPeopleLinks = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const link = value as Partial<EventPeopleLink> | null;
      if (
        !link
        || typeof link.eventId !== 'string'
        || typeof link.eventStart !== 'string'
        || typeof link.eventEnd !== 'string'
        || !Array.isArray(link.personIds)
      ) continue;
      const personIds = link.personIds.filter((id): id is string => typeof id === 'string');
      if (personIds.length === 0) continue;
      out[key] = {
        key,
        eventId: link.eventId,
        eventStart: link.eventStart,
        eventEnd: link.eventEnd,
        title: typeof link.title === 'string' ? link.title : '',
        personIds,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The people a title names who aren't linked yet, in list order — offered
 * first in the picker, never linked on their own. Same whole-word, ambiguity-
 * resolves-to-nobody match the history offer uses.
 */
export function suggestedEventPeople(
  title: string,
  people: readonly PersonName[],
  linked: readonly string[]
): string[] {
  return peopleNamedInTitle(title, people).filter(id => !linked.includes(id));
}

/**
 * One person's linked events that haven't finished yet, soonest first — the
 * events half of "Coming up" on their screen. Reads only what the calendar
 * window already holds, so an event past it shows up once the window reaches it.
 */
export function upcomingEventsWith(
  events: readonly BusyEvent[],
  links: Readonly<EventPeopleLinks>,
  personId: string,
  now: Date
): BusyEvent[] {
  const at = now.getTime();
  return events
    .filter(event =>
      isLiveEvent(event)
      && Date.parse(event.end) > at
      && peopleForEvent(links, event).includes(personId))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * Where a new event starts before the system sheet lets the user change it:
 * the next whole hour when `day` is the current logical day, otherwise 9:00 on
 * that day, and an hour long.
 *
 * `today` is the caller's logical day start (`getCurrentDayStart()`), not a
 * bare `new Date()`, so a day picked at 1am in the grace window lands on the
 * day the user means. The next-hour start can run past midnight late in the
 * evening; that is the right answer, since it's the soonest time that hasn't
 * gone by.
 */
export function defaultNewEventSpan(
  day: Date,
  today: Date,
  now: Date
): { start: Date; end: Date } {
  const sameDay =
    day.getFullYear() === today.getFullYear()
    && day.getMonth() === today.getMonth()
    && day.getDate() === today.getDate();
  const start = sameDay
    ? addHours(startOfHour(now), 1)
    : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0);
  return { start, end: addHours(start, 1) };
}
