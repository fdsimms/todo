import { addDays } from 'date-fns/addDays';
import { startOfDay } from 'date-fns/startOfDay';
import type { BusyEvent } from './calendarBusy';
import { isLiveEvent } from './calendarBusy';
import { dayKeyOf } from './dateUtils';

/**
 * Past calendar events that mention somebody you keep track of — offered on
 * their own screen, never written down on their own.
 *
 * Most real social plans live on a calendar rather than in a todo app: "Dinner
 * w/ Dustin" gets typed into the calendar, not written as a task. A history
 * holding only the tasks you remembered to tag is a sparse one, and sparse is
 * worse than empty here, because `observedCadenceDays` needs samples before it
 * can say anything honest.
 *
 * **Read `docs/arch/people.md` before changing anything here**, in particular
 * "Where the two lines actually fall". Two things are settled and are not
 * re-openable from this file:
 *
 * - **Titles, never attendees.** Attendees is a broad structured sweep of
 *   everyone you sit in a room with, twelve-person work meetings included. A
 *   title is what *you* typed about your own plans, and it is both the less
 *   invasive read and the more relevant one. `BusyEvent` carries no attendee
 *   field and must not grow one for this.
 * - **A guess is never written down.** Everything here produces an *offer*.
 *   Nothing in this module creates a person, resolves an unknown name, or
 *   records anything. `probablyHaveReason` and `pantryCheckTasks` one shelf
 *   over: guess what you cannot verify, carry the reason, and ask.
 *
 * Pure, and takes `now` rather than reading the clock.
 */

/**
 * How far back to look.
 *
 * Deliberately much shorter than a year. The window is fetched on demand from
 * EventKit (see `useCalendarStore.refreshPast`), so its width is what a person's
 * screen costs to open, and the useful case is recent: a dinner last month is
 * something you might still want on file, a dinner in 2023 is not a gap you are
 * about to fill in. A quarter is also comfortably more than
 * `MIN_CADENCE_SAMPLES` worth of a monthly friendship.
 *
 * It is what bounds the handled record below, so widening it widens that too.
 */
export const PAST_CALENDAR_WINDOW_DAYS = 90;

/**
 * The shortest name that may be matched out of an event title.
 *
 * A two-character nickname matches far too much — "Al" is inside "Also",
 * "Walk" and "Palo Alto", and every one of those would offer a stranger's
 * afternoon as time spent with a friend. Three is the floor rather than a
 * cleverer rule because the alternative is scoring a match, and a score is
 * exactly what this feature may not have.
 *
 * **`matchPersonMentions` has no such floor and that asymmetry is the point.**
 * Typing "@al" is a deliberate act with a sigil in front of it; a calendar
 * title is a guess about text somebody wrote for another purpose entirely. The
 * guess gets the higher bar.
 */
export const MIN_CALENDAR_NAME_LENGTH = 3;

/** What the read is gated on — see `shouldReadPastCalendar`. */
export interface PastCalendarGate {
  calendarReadEnabled: boolean;
  calendarPeopleHistory: boolean;
  /** How many calendars the user has chosen to read. */
  calendarCount: number;
  demoActive: boolean;
  ios: boolean;
}

/**
 * Whether the past window may be read at all.
 *
 * Four of these are the obvious ones. **`demoActive` is the one worth writing
 * down**, because it is the opposite of the direction the demo rule usually
 * runs in (`CLAUDE.md`: nothing in demo mode may write outside the demo
 * database). Nothing here writes anywhere, and the other four readers of the
 * device calendar are deliberately left ungated — they show calendar events as
 * calendar events, which is honest whichever database is mounted.
 *
 * This one is different, and specifically so: its output is a claim *about a
 * demo row*. The seed invents a Dustin, and without this an event out of the
 * real calendar mentioning a real Dustin would be offered as history for the
 * invented one — real data attributed to fiction, on a screen handed to
 * somebody else. The second half is a plain bug: `markHistoryHandled` would
 * write the answer into the scratch settings table, so a dismissal made in a
 * demo is lost and the real install is asked again.
 */
export function shouldReadPastCalendar(gate: PastCalendarGate): boolean {
  return gate.ios
    && gate.calendarReadEnabled
    && gate.calendarPeopleHistory
    && gate.calendarCount > 0
    && !gate.demoActive;
}

/** The shape matching runs against: an id and the names somebody answers to. */
export interface PersonName {
  id: string;
  name: string;
  nickname: string;
}

/** One past event that named somebody, offered rather than asserted. */
export interface HistorySuggestion {
  /** The handled record's key — see `historyEventKey`. */
  key: string;
  eventId: string;
  title: string;
  /** ISO, the event's own start. */
  at: string;
  /** Everybody the title named. Usually one; "Dinner w/ Dustin and Ansley" is two. */
  personIds: string[];
}

/** What the user has already answered about, keyed by event, valued by its day. */
export type HandledHistoryEvents = Record<string, string>;

/**
 * The oldest day the window reaches.
 *
 * One source for it, used both by the fetch and by the filter, because the two
 * have to agree: an event that starts before the floor is never offered (see
 * `suggestedHistoryEvents`), and the handled record is pruned at the same line.
 * Let them drift and a dismissal for a straddling event gets pruned while the
 * event is still being offered, which hands the suggestion back for ever.
 */
export function pastWindowStart(now: Date): Date {
  return addDays(startOfDay(now), -PAST_CALENDAR_WINDOW_DAYS);
}

/**
 * One occurrence's identity.
 *
 * **The day is in the key because an event id is not one occurrence.**
 * EventKit hands back every instance of a recurring event under the same
 * `calendarItemIdentifier`, so a standing "Lunch w/ Mom" is one id and thirteen
 * lunches — dismissing one would dismiss the lot. Same composite-key answer
 * `birthdaySourceId` gives for `personId#year` and `mealSlot` gives for
 * `2026-08-22#lunch`.
 *
 * **The day is the event's own calendar day, deliberately not the logical one.**
 * `dayKeyOf` rather than `getLogicalDayKey`: this is an identity, not a
 * scheduling decision, and reading it through `dayResetTime` would mean moving
 * that setting silently re-keys every record the user has already answered —
 * handing back every dismissal at once. The grace-window rule in `CLAUDE.md` is
 * about deciding *where a task lands*; nothing here lands anything.
 */
export function historyEventKey(event: Pick<BusyEvent, 'id' | 'start'>): string {
  return `${event.id}#${dayKeyOf(new Date(event.start))}`;
}

/** Escapes a name for use inside a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The names one person answers to, lowercased and long enough to risk.
 *
 * The same three `matchPersonMentions` builds — full name, nickname, and the first
 * word of the name so "Dustin Reyes" answers to "Dustin". Full names are how
 * people arrive from a contact card, and nobody writes a surname into their own
 * calendar.
 */
function nameTokensOf(person: PersonName): string[] {
  const tokens: string[] = [];
  const add = (raw: string) => {
    const token = raw.trim().replace(/\s+/g, ' ').toLowerCase();
    if (token.length < MIN_CALENDAR_NAME_LENGTH) return;
    if (!tokens.includes(token)) tokens.push(token);
  };
  add(person.name);
  add(person.nickname);
  const first = person.name.trim().split(/\s+/)[0];
  if (first) add(first);
  return tokens;
}

/**
 * Who an event title names, out of the people already added.
 *
 * **Whole-word and exact, never fuzzy.** No prefixes, no edit distance, no
 * initials: "Dinner w/ Dustin" names Dustin and "Dust the shelves" names
 * nobody. The boundaries are letters and digits rather than `\b`, so "Dustin's
 * place" still matches while "Dustinism" does not.
 *
 * **Ambiguity resolves to nobody**, the same refusal `matchPersonMentions` makes
 * about "@sam" with two Sams registered. A token answering for two people is
 * dropped rather than guessed at — and the more specific token survives on its
 * own, so with a Dustin Reyes and a nickname-Dustin on file, "Dinner w/ Dustin
 * Reyes" still names exactly one of them while "Dinner w/ Dustin" names none.
 *
 * **Never creates or infers a person.** A title full of names you have not
 * added produces an empty array and costs nothing.
 */
export function peopleNamedInTitle(title: string, people: readonly PersonName[]): string[] {
  const haystack = title.replace(/\s+/g, ' ').toLowerCase();
  if (!haystack) return [];

  // Built once per title rather than per person, so a token reachable two ways
  // resolves the same however the list is ordered.
  const byToken = new Map<string, string[]>();
  for (const person of people) {
    for (const token of nameTokensOf(person)) {
      const held = byToken.get(token);
      if (held) { if (!held.includes(person.id)) held.push(person.id); }
      else byToken.set(token, [person.id]);
    }
  }

  const matched: string[] = [];
  for (const [token, ids] of byToken) {
    // Exactly one, or nothing.
    if (ids.length !== 1) continue;
    const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(token)}(?![a-z0-9])`);
    if (!pattern.test(haystack)) continue;
    if (!matched.includes(ids[0])) matched.push(ids[0]);
  }
  return matched;
}

/**
 * Every past event worth offering, newest first.
 *
 * Four refusals, and each one is a class of thing that is not an afternoon with
 * a friend:
 *
 * - **Nothing in the future, and nothing still running.** This is history; an
 *   event you are sitting in has not happened yet as far as a record goes.
 * - **No all-day events.** `occupiesTime`'s own note lists what they actually
 *   are — a birthday, a public holiday, a "Sarah out of office" marker — and
 *   every one of those would offer a date somebody's name is *on* as time you
 *   spent together. That is the app inventing an afternoon. Availability is
 *   deliberately **not** filtered on the same line: marking a dinner Free says
 *   it does not block your calendar, which is a different claim from whether it
 *   happened.
 * - **Nothing cancelled** (`isLiveEvent`), which is the same call every other
 *   reader of this data makes.
 * - **Nothing starting before the window floor.** EventKit's predicate returns
 *   events *overlapping* a range, so a long event that began before the floor
 *   comes back with the rest. Offering one would mean writing a handled record
 *   whose day is already past the pruning line, so answering it would not
 *   stick — see `pastWindowStart`.
 *
 * `handled` covers both answers at once, and that is deliberate: accepted and
 * dismissed both mean "don't ask about this again", so there is one record and
 * nothing to keep in step.
 */
export function suggestedHistoryEvents(
  events: readonly BusyEvent[],
  people: readonly PersonName[],
  handled: Readonly<HandledHistoryEvents>,
  now: Date
): HistorySuggestion[] {
  const at = now.getTime();
  const floor = pastWindowStart(now).getTime();
  const out: HistorySuggestion[] = [];

  for (const event of events) {
    if (!isLiveEvent(event) || event.allDay) continue;
    const title = event.title.trim();
    if (!title) continue;
    const start = new Date(event.start).getTime();
    const end = new Date(event.end).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < floor || end > at) continue;

    const key = historyEventKey(event);
    if (key in handled) continue;

    const personIds = peopleNamedInTitle(title, people);
    if (personIds.length === 0) continue;

    out.push({ key, eventId: event.id, title, at: event.start, personIds });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The record, read back off whatever the settings table is holding.
 *
 * A record we can't read is a record we don't have — the same call
 * `remindersImportHandled` makes, and for the same reason: the cost is being
 * asked once more about events you already answered, where throwing would mean
 * a screen that renders nothing ever again.
 */
export function parseHandledHistoryEvents(raw: string | null | undefined): HandledHistoryEvents {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: HandledHistoryEvents = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Keys sorted, so an unchanged record serializes to an unchanged string. */
export function serializeHandledHistoryEvents(handled: Readonly<HandledHistoryEvents>): string {
  const sorted: HandledHistoryEvents = {};
  for (const key of Object.keys(handled).sort()) sorted[key] = handled[key];
  return JSON.stringify(sorted);
}

/**
 * Drops the answers about events the window can no longer reach.
 *
 * **This is what stops the record growing without end**, which
 * `docs/arch/generated-tasks.md` names as the disease a generic
 * `(kind, sourceId)` suppression record has. There the objection was that
 * nothing prunes it; here the pruning is arithmetic rather than a pass over
 * anything, because the window has a floor and an event older than the floor
 * can never be offered again. Bounded by the window, and the window is bounded
 * by `PAST_CALENDAR_WINDOW_DAYS`.
 *
 * `YYYY-MM-DD` compares lexicographically, which is why the day is stored as
 * the value rather than parsed back out of the key.
 */
export function pruneHandledHistoryEvents(
  handled: Readonly<HandledHistoryEvents>,
  floorDayKey: string
): HandledHistoryEvents {
  const out: HandledHistoryEvents = {};
  for (const [key, day] of Object.entries(handled)) {
    if (day >= floorDayKey) out[key] = day;
  }
  return out;
}
