import { addHours } from 'date-fns/addHours';
import { startOfHour } from 'date-fns/startOfHour';
import type { BusyEvent } from './calendarBusy';
import { isLiveEvent } from './calendarBusy';
import { pastWindowStart, peopleNamedInTitle, type PersonName } from './calendarHistory';
import type { EventPeopleLink } from '../types';

export type { EventPeopleLink };

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
 * **Keyed by occurrence** (event + start): EventKit shares one id across every
 * instance of a recurring series, so "Lunch w/ Mom" every Sunday is one id and
 * many lunches. The start is normalised through `toISOString` so a key built
 * from a `Date` read back after the system sheet saves matches the one built
 * from the string `fetchEvents` hands out.
 *
 * **It syncs, which is why the event is named by the calendar server's id.**
 * EventKit's own id names a record on one device and, Apple documents, can be
 * lost on a full resync. `calendarItemExternalIdentifier` is the server's id,
 * the same on every device reading that calendar, so a link written against it
 * on one phone matches the same event on the other. The native module
 * (`todo-eventkit-bridge`) reads it; where it can't (an older build, a calendar
 * with no server), the key falls back to the local id and the link simply
 * matches nothing on another device. Readers look up both, preferred first,
 * which is also what keeps a link written before this existed working.
 *
 * **Two phones can link one occurrence before they sync**, and the table does
 * not refuse that (a UNIQUE key would fail the sync apply instead). The reader
 * unions duplicates, and the next edit folds them back into one row.
 */

/** Rows grouped by event key, plus what this device knows of server ids. */
export interface EventPeopleIndex {
  byKey: Readonly<Record<string, readonly EventPeopleLink[]>>;
  /** Local EventKit id -> the calendar server's id, where it could be read. */
  externalIds: Readonly<Record<string, string>>;
}

export const EMPTY_EVENT_PEOPLE: EventPeopleIndex = { byKey: {}, externalIds: {} };

function normalizedStart(start: string): string {
  const ms = Date.parse(start);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : start;
}

/**
 * The keys an occurrence may be stored under, preferred first: the server id
 * when this device has read it, then the local id.
 */
export function eventPeopleKeys(
  event: Pick<BusyEvent, 'id' | 'start'>,
  externalIds: Readonly<Record<string, string>>
): string[] {
  const start = normalizedStart(event.start);
  const local = `${event.id}#${start}`;
  const external = externalIds[event.id];
  return external && external !== event.id ? [`${external}#${start}`, local] : [local];
}

export function indexEventPeople(
  rows: readonly EventPeopleLink[],
  externalIds: Readonly<Record<string, string>>
): EventPeopleIndex {
  const byKey: Record<string, EventPeopleLink[]> = {};
  for (const row of rows) (byKey[row.eventKey] ??= []).push(row);
  return { byKey, externalIds };
}

function rowsForEvent(index: EventPeopleIndex, event: Pick<BusyEvent, 'id' | 'start'>): EventPeopleLink[] {
  return eventPeopleKeys(event, index.externalIds).flatMap(key => [...(index.byKey[key] ?? [])]);
}

/** Who a given occurrence is linked with, or nobody. Duplicate rows are unioned. */
export function peopleForEvent(
  index: EventPeopleIndex,
  event: Pick<BusyEvent, 'id' | 'start'>
): string[] {
  const out: string[] = [];
  for (const row of rowsForEvent(index, event)) {
    for (const id of row.personIds) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The writes that set one occurrence's people. */
export interface EventPeopleWrite {
  upsert: EventPeopleLink | null;
  deleteIds: string[];
}

/**
 * Setting an occurrence's people is one row under the preferred key, and no
 * others: an existing row under that key is kept (so its id and created_at
 * survive and sync sees an edit rather than a delete and an insert), and
 * every other row for the occurrence (a duplicate from another phone, a link
 * written under the local id before the server id was known) is deleted.
 * An empty set deletes them all, so "linked to nobody" and "never linked" are
 * one state.
 */
export function planEventPeopleWrite(
  index: EventPeopleIndex,
  event: Pick<BusyEvent, 'id' | 'start' | 'end' | 'title'>,
  personIds: readonly string[],
  fresh: { id: string; now: string }
): EventPeopleWrite {
  const existing = rowsForEvent(index, event);
  const unique = [...new Set(personIds)];
  if (unique.length === 0) return { upsert: null, deleteIds: existing.map(r => r.id) };
  const [preferredKey] = eventPeopleKeys(event, index.externalIds);
  const keep = existing.find(r => r.eventKey === preferredKey) ?? null;
  return {
    upsert: {
      id: keep?.id ?? fresh.id,
      eventKey: preferredKey,
      eventStart: event.start,
      eventEnd: event.end,
      title: event.title,
      personIds: unique,
      createdAt: keep?.createdAt ?? fresh.now,
    },
    deleteIds: existing.filter(r => r !== keep).map(r => r.id),
  };
}

/**
 * A link is kept until its occurrence falls out of the past-calendar window,
 * not merely until it ends. After the event, the link is what lets the
 * person's screen offer it as history (`suggestedHistoryEvents`), and that
 * offer is bounded by the same floor, so past it the link has no reader left.
 * Pruning on the start mirrors the offer's own refusal of an event that
 * started before the floor. Every device prunes by the same rule, so the
 * deletions it syncs agree.
 */
export function isEventPeopleLinkStale(link: Pick<EventPeopleLink, 'eventStart'>, now: Date): boolean {
  const start = Date.parse(link.eventStart);
  if (!Number.isFinite(start)) return true;
  return start < pastWindowStart(now).getTime();
}

export function staleEventPeopleIds(rows: readonly EventPeopleLink[], now: Date): string[] {
  return rows.filter(r => isEventPeopleLinkStale(r, now)).map(r => r.id);
}

/**
 * The links an install kept in the `calendarEventPeople` setting before they
 * had a table, as rows. Keyed by the local id they were written under, which
 * `eventPeopleKeys` still looks up. Anything malformed is skipped: a record we
 * can't read is one we don't have, the same call `parseHandledHistoryEvents`
 * makes.
 */
export function legacyEventPeopleRows(
  raw: string | null | undefined,
  newId: () => string,
  now: string
): EventPeopleLink[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const out: EventPeopleLink[] = [];
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      const link = value as Record<string, unknown> | null;
      if (
        !link
        || typeof link.eventId !== 'string'
        || typeof link.eventStart !== 'string'
        || typeof link.eventEnd !== 'string'
        || !Array.isArray(link.personIds)
      ) continue;
      const personIds = (link.personIds as unknown[]).filter((id): id is string => typeof id === 'string');
      if (personIds.length === 0) continue;
      out.push({
        id: newId(),
        eventKey: `${link.eventId}#${normalizedStart(link.eventStart)}`,
        eventStart: link.eventStart,
        eventEnd: link.eventEnd,
        title: typeof link.title === 'string' ? link.title : '',
        personIds,
        createdAt: now,
      });
    }
    return out;
  } catch {
    return [];
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
  links: EventPeopleIndex,
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
