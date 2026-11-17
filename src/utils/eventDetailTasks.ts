import type { Task } from '../types';
import { isLiveEvent, type BusyEvent } from './calendarBusy';
import { peopleNamedInTitle, type PersonName } from './calendarHistory';
import { eventOccurrenceKey, eventOccurrenceKeys, type HandledEventTasks } from './eventTasks';
import { generatedSourceOf } from './generatedTasks';
import { peopleAfterWith } from './quickEvent';

/**
 * The "add who and where" offer: one task listing the upcoming events whose
 * titles name a person on the list ("Dinner with Kristen") or a place ("at
 * Zatar", "@ Zatar") the event doesn't carry yet, each a tap to add.
 *
 * **It offers; it never writes on its own.** A title is text written for
 * another purpose, so the app may notice what it says and ask, the line
 * `docs/arch/people.md` draws for the history offer. Adding a person is the
 * app's own link (`useEventPeopleStore.setPeople`), never an attendee, and
 * adding a place writes the event's location, both from a tap in the row.
 *
 * Store-free like `calendarReviewTasks.ts`: the check in `useTaskStore` and the
 * row's panel both read the events through `eventDetailEntries`, so what the
 * task counts and what its panel lists can't disagree.
 */

/** One person the title names, after "with" or "w/", out of the list. */
export interface EventDetailPerson {
  personId: string;
  /** Already linked to this occurrence: shown as added while the event has something else open. */
  done: boolean;
}

/** The place the title names. */
export interface EventDetailPlace {
  /** The words after "at" or "@", as the title spells them. */
  text: string;
  /** The event's location already says it. */
  done: boolean;
}

/** One upcoming event with at least one thing still to add. */
export interface EventDetailEntry {
  event: BusyEvent;
  people: EventDetailPerson[];
  place: EventDetailPlace | null;
}

/** The row's title, counting the events it asks about. */
export function eventDetailsTitle(count: number): string {
  return `Add details to ${count} ${count === 1 ? 'event' : 'events'}`;
}

/** The day key an event details task was written on, or null for any other task. */
export function eventDetailsDayKey(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): string | null {
  return generatedSourceOf(task, 'eventDetails');
}

// "at Zatar", "@ Zatar", "@Zatar". The word or sign has to follow a space (or
// open the title), so "chat" and an email address don't count.
const PLACE_MARKER = /(?:^|\s)(?:at\s+|@\s*)(?=\S)/gi;
// What ends a place: another place marker, or the people after it.
const PLACE_END = /\s+(?:at\s|@|with(?![a-z0-9])|w\/)/i;
// "at 7", "at 7:30pm", "at noon": the time, not a place.
const STARTS_WITH_TIME = /^(?:\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m?\.?)?(?![a-z0-9])|noon\b|midnight\b)/i;
// Places that name no address to look up, where a typed location would only
// say what the event's own title already does.
const NOT_A_PLACE = new Set(['home', 'work', 'office', 'the office', 'my place', 'my house', 'mine', 'yours']);

/** Shortest place worth offering. */
const MIN_PLACE_LENGTH = 2;

/**
 * The place a title names, or null.
 *
 * Read from the last "at" or "@" that names something that isn't a time, so
 * "Lunch at Jo's at 1pm" offers Jo's and "Meet at 7 at Zatar" offers Zatar, and
 * cut short at "with" so "Drinks at Zatar with Kristen" offers only Zatar. A
 * place that is somebody on the list ("Dinner at Kristen's") is refused: that's
 * a person, and the people half already asks about them.
 */
export function placeInTitle(title: string, people: readonly PersonName[] = []): string | null {
  const markers: number[] = [];
  PLACE_MARKER.lastIndex = 0;
  for (let m = PLACE_MARKER.exec(title); m; m = PLACE_MARKER.exec(title)) {
    markers.push(m.index + m[0].length);
    // A zero-width tail can't loop, since the match always takes the marker.
  }
  for (let i = markers.length - 1; i >= 0; i--) {
    const rest = title.slice(markers[i]);
    const end = PLACE_END.exec(rest);
    const place = (end ? rest.slice(0, end.index) : rest).trim().replace(/[\s,;:.!?-]+$/, '');
    if (place.length < MIN_PLACE_LENGTH) continue;
    if (STARTS_WITH_TIME.test(place)) continue;
    if (NOT_A_PLACE.has(place.toLowerCase())) continue;
    if (peopleNamedInTitle(place, people).length > 0) continue;
    return place;
  }
  return null;
}

/** Whether this occurrence was skipped, under either key it may be filed by. */
export function isEventDetailsSkipped(event: BusyEvent, skipped: Readonly<HandledEventTasks>): boolean {
  return eventOccurrenceKeys(event).some(key => key in skipped);
}

/** The skipped record with this occurrence added, valued by its end so it prunes itself. */
export function withEventDetailsSkipped(
  skipped: Readonly<HandledEventTasks>,
  event: Pick<BusyEvent, 'id' | 'start' | 'end' | 'externalId'>,
): HandledEventTasks {
  return { ...skipped, [eventOccurrenceKey(event)]: event.end };
}

/**
 * Every upcoming event with something left to add, soonest first.
 *
 * - **Only events still ahead** (`start` after `now`), so a task that comes
 *   back after a defer lists nothing that has already happened, and nothing
 *   cancelled (`isLiveEvent`).
 * - **People come from after "with" or "w/" only** (`peopleAfterWith`, the
 *   quick-add card's own read), with its refusals: whole-word, exact, and a
 *   name two people answer to names nobody. Nobody is ever created.
 * - **A place is offered only while the event has no location.** One whose
 *   location already starts with the place reads as added; any other location
 *   means there is nothing to ask.
 * - **An event drops off once nothing is left open**: everyone added, the
 *   place set, or Skip tapped.
 */
export function eventDetailEntries(
  events: readonly BusyEvent[],
  people: readonly PersonName[],
  linkedFor: (event: BusyEvent) => readonly string[],
  skipped: Readonly<HandledEventTasks>,
  now: Date,
): EventDetailEntry[] {
  const seen = new Set<string>();
  const out: EventDetailEntry[] = [];
  for (const event of events) {
    if (!isLiveEvent(event)) continue;
    const start = Date.parse(event.start);
    if (!Number.isFinite(start) || start <= now.getTime()) continue;
    const key = eventOccurrenceKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    if (isEventDetailsSkipped(event, skipped)) continue;

    const linked = linkedFor(event);
    const named = peopleAfterWith(event.title, people);
    const entryPeople = named.map(personId => ({ personId, done: linked.includes(personId) }));

    const text = placeInTitle(event.title, people);
    const location = (event.location ?? '').trim();
    let place: EventDetailPlace | null = null;
    if (text) {
      if (!location) place = { text, done: false };
      else if (location.toLowerCase().startsWith(text.toLowerCase())) place = { text, done: true };
    }

    const open = entryPeople.some(p => !p.done) || (place !== null && !place.done);
    if (!open) continue;
    out.push({ event, people: entryPeople, place });
  }
  return out.sort((a, b) => Date.parse(a.event.start) - Date.parse(b.event.start));
}
