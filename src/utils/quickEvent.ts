import { addMinutes } from 'date-fns/addMinutes';
import { addDays } from 'date-fns/addDays';
import {
  applyMentionOverrides,
  matchPersonMentions,
  parseTaskInput,
  type GroupMentionToken,
  type PersonToken,
} from './parseTaskInput';
import { defaultNewEventSpan } from './eventPeople';
import { peopleNamedInTitle } from './calendarHistory';
import { parseDurationTail, type ParsedSchedule } from './parseTaskInput';
import type { TimeOfDay } from '../types';
import type { ClockTime } from './parseNaturalDate';
import { TRAVEL_ORIGIN_PHONE, clampArriveEarlyMinutes, type TravelMode } from './travelTasks';

/**
 * One typed line ("lunch w/ @gideon fri 12p") turned into a new calendar
 * event, the event counterpart of quick add. Nothing here writes anything: it
 * reads the line into a draft that `quickEventSaveFields` turns into the write
 * (`saveEventDirect`), and names who to link it to afterward.
 *
 * **It reuses quick add's two readers rather than growing its own**:
 * `parseTaskInput` for the day and time, `matchPersonMentions` for "@name",
 * and `peopleAfterWith` for the names after "with" or "w/".
 * Both already carry the refusals that matter (a schedule phrase must be a
 * suffix, an ambiguous "@sam" names nobody), so an event line reads exactly
 * the way a task line does.
 *
 * **A repeat phrase is read for its first day and its rule.** "Every monday"
 * starts next Monday and saves a weekly repeat (`eventRecurrenceFor`). The
 * task repeats an event has no counterpart for ("every 8 hours", "3 days after
 * you finish it") still read as their first day only.
 */
export interface QuickEventDraft {
  /** The line minus the schedule phrase, with each "@name" as the name. */
  title: string;
  start: Date;
  end: Date;
  personIds: string[];
  /** Whether a day or time was read from the line, for the preview. */
  scheduled: boolean;
  /**
   * The schedule phrase that was read, for the sheet to highlight and offer
   * to set: where it starts, the text itself, and the line with it taken out
   * (mentions left as typed). Null when nothing was read or it was ignored.
   */
  phrase: { start: number; text: string; lineWithout: string } | null;
  /** Each resolved "@name" span in the line, for highlighting. */
  mentionSpans: [number, number][];
  /** The place read from a trailing "at Joe's", or null when the line names none. */
  location: string | null;
  /**
   * The alert read from a trailing "alert 30m", as minutes before the start
   * (0 is at the start). Null is "alert none"; undefined is "no alert clause
   * typed", which leaves the remembered default alone.
   */
  alertMinutes: number | null | undefined;
  /** The length read from a range or "for 90m", in minutes; null for the one-hour default. */
  durationMinutes: number | null;
  /**
   * Whether the line named a time of day (a clock time, a range or a day
   * part), as opposed to a day alone or nothing. An untimed event is the one
   * the card offers a free slot for.
   */
  timed: boolean;
  /** Each trailing clause's span in the line, null when it wasn't typed. */
  locationSpan: [number, number] | null;
  alertSpan: [number, number] | null;
  durationSpan: [number, number] | null;
  /** Every clause span, in line order, for highlighting. */
  clauseSpans: [number, number][];
  /** The repeat the schedule phrase read ("every monday"), or null for a one-off. */
  repeat: EventRecurrence | null;
  /**
   * The trailing clauses below set what the card's chips set. Each is
   * undefined when it wasn't typed (the chip's own pick or default stands) and
   * is only ever read when `parseQuickEvent`'s options ask for it.
   */
  /** "walking", "by transit": how the trip there is made. */
  travelMode: TravelMode | undefined;
  /** "10 min early", "5m late": minutes before the start to arrive, negative for late. */
  arriveEarlyMinutes: number | undefined;
  /** "from home": a saved place's id, or `TRAVEL_ORIGIN_PHONE` for "from here". */
  travelOriginId: string | undefined;
  /** "in Work calendar": the id of the calendar named. */
  calendarId: string | undefined;
  /** "show as free": whether the time blocks the calendar. */
  availability: 'busy' | 'free' | undefined;
  travelSpan: [number, number] | null;
  arriveSpan: [number, number] | null;
  originSpan: [number, number] | null;
  calendarSpan: [number, number] | null;
  availabilitySpan: [number, number] | null;
  /** "note: bring the sign-up sheet": what goes in the Notes or link field. */
  notes: string | undefined;
  notesSpan: [number, number] | null;
}

/**
 * A repeat rule in the shape EventKit's save takes, kept as plain data (day
 * numbers, frequency words) so this file needs no native module. The write
 * casts it to expo-calendar's `RecurrenceRule` at the boundary.
 */
export interface EventRecurrence {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  /** `dayOfTheWeek` is 1 = Sunday to 7 = Saturday; `weekNumber` is the Nth (or -1 last) in the month. */
  daysOfTheWeek?: { dayOfTheWeek: number; weekNumber?: number }[];
  /** 1-31, or -1 for the last day. */
  daysOfTheMonth?: number[];
  /** ISO string. */
  endDate?: string;
  occurrence?: number;
}

/**
 * The schedule phrase's repeat as an event's rule. Null for a one-off and for
 * the two task repeats an event has no counterpart for: "every 8 hours" (a
 * calendar repeat is daily at the finest) and "N days after you finish it"
 * (an event is never finished, so there is nothing to count from). Those
 * events are saved on their first day, the same as before repeats were read.
 */
export function eventRecurrenceFor(schedule: ParsedSchedule | undefined): EventRecurrence | null {
  if (!schedule || schedule.recurrenceFromCompletion) return null;
  const type = schedule.recurrenceType;
  if (type === 'none' || type === 'hours') return null;
  const rule: EventRecurrence = { frequency: type, interval: Math.max(1, schedule.recurrenceInterval || 1) };
  if (type === 'weekly' && schedule.recurrenceDays.length > 0) {
    rule.daysOfTheWeek = schedule.recurrenceDays.map(d => ({ dayOfTheWeek: d + 1 }));
  }
  if (type === 'monthly') {
    if (schedule.recurrenceWeekOrdinal != null && schedule.recurrenceDays.length > 0) {
      rule.daysOfTheWeek = [{ dayOfTheWeek: schedule.recurrenceDays[0] + 1, weekNumber: schedule.recurrenceWeekOrdinal }];
    } else if (schedule.recurrenceMonthDay != null) {
      rule.daysOfTheMonth = [schedule.recurrenceMonthDay];
    }
  }
  if (schedule.recurrenceEndDate) rule.endDate = schedule.recurrenceEndDate;
  else if (schedule.recurrenceCount) rule.occurrence = schedule.recurrenceCount;
  return rule;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FREQUENCY_NOUN = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' } as const;

/** "Repeats every day", "Repeats every 2 weeks", "Repeats every week on Mon, Wed". */
export function describeEventRepeat(rule: EventRecurrence): string {
  const noun = FREQUENCY_NOUN[rule.frequency];
  const every = rule.interval === 1 ? `every ${noun}` : `every ${rule.interval} ${noun}s`;
  const days = rule.frequency === 'weekly' && rule.daysOfTheWeek
    ? ` on ${rule.daysOfTheWeek.map(d => WEEKDAY_NAMES[d.dayOfTheWeek - 1]).join(', ')}`
    : '';
  return `Repeats ${every}${days}`;
}

/** The repeats the card's chip offers, as plain rules. A typed phrase can say more ("every 2 weeks on Mon, Wed"). */
export const EVENT_REPEAT_PRESETS: { key: string; label: string; rule: EventRecurrence }[] = [
  { key: 'daily', label: 'Every day', rule: { frequency: 'daily', interval: 1 } },
  { key: 'weekly', label: 'Every week', rule: { frequency: 'weekly', interval: 1 } },
  { key: 'monthly', label: 'Every month', rule: { frequency: 'monthly', interval: 1 } },
  { key: 'yearly', label: 'Every year', rule: { frequency: 'yearly', interval: 1 } },
];

/** The preset a rule is exactly, or null for none or a custom one. */
export function eventRepeatPresetKey(rule: EventRecurrence | null): string | null {
  if (!rule || rule.interval !== 1 || rule.daysOfTheWeek || rule.daysOfTheMonth || rule.endDate || rule.occurrence) return null;
  return rule.frequency;
}

/** The chip's text: "Daily" for a preset, otherwise the phrase minus its "Repeats", e.g. "Every 2 weeks on Mon, Wed". */
export function describeEventRepeatShort(rule: EventRecurrence): string {
  const preset = eventRepeatPresetKey(rule);
  if (preset) return { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[preset]!;
  const text = describeEventRepeat(rule).replace(/^Repeats /, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "alert 30m", "alert 1 hour", "alert 2d", "alert none". A suffix, like the
// schedule phrase, so a word "alert" inside a title is left alone.
const ALERT_CLAUSE = /\s+alert\s+(?:(\d{1,4})\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?)?|none|off)\s*$/i;

/** Minutes a unit word stands for. A bare number is minutes. */
function unitMinutes(unit: string | undefined): number {
  const u = (unit ?? 'm').toLowerCase();
  if (u.startsWith('h')) return 60;
  if (u.startsWith('d')) return 1440;
  return 1;
}

/**
 * Reads a trailing alert clause. `start` is where its leading space begins, so
 * `input.slice(0, start)` is the line without it.
 */
export function parseAlertClause(
  input: string
): { start: number; minutes: number | null } | null {
  const m = ALERT_CLAUSE.exec(input);
  if (!m) return null;
  if (m[1] === undefined) return { start: m.index, minutes: null };
  return { start: m.index, minutes: Number(m[1]) * unitMinutes(m[2]) };
}

const ALL_DAY_ALERT_HOUR = 9;

/**
 * EventKit's `relativeOffset` for "N minutes before". A timed event counts
 * back from its start. An all-day event starts at midnight, where an alert is
 * useless, so it counts back from 9:00 that morning, the time Calendar's own
 * "On day of event" uses.
 */
export function alertRelativeOffset(minutes: number, allDay: boolean): number {
  return (allDay ? ALL_DAY_ALERT_HOUR * 60 : 0) - minutes;
}

/** An event's length when the line names none. */
export const DEFAULT_EVENT_MINUTES = 60;

// "for 90m", "for 1.5 hours", "for an hour": quick add's own duration grammar
// (parseDurationTail), held to a suffix like the other clauses.

/** A trailing "for 90m", as minutes, with where its leading space begins. Null past a day or under a minute. */
export function parseLengthClause(input: string): { start: number; minutes: number } | null {
  return parseDurationTail(input);
}

// "12-1:30pm", "12pm–1:30pm", "from 6 to 8pm", "9:30-11". A suffix, and it
// needs a colon or an am/pm somewhere, so "chapters 3-5" stays a title.
const CLOCK_RANGE = /\s*(?:\bfrom\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*(?:-|–|—|\bto\b|\buntil\b|\btil\b)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*$/i;

/**
 * A trailing clock range, as a start and an end on the 24-hour clock. A side
 * with no am/pm takes the other side's ("6-8pm" is 6pm to 8pm), unless that
 * would put the start after the end, in which case it is the morning ("11-1pm"
 * is 11am to 1pm). With neither side marked, an hour under 7 reads as the
 * afternoon, the way a typed "3" usually means 3pm.
 */
export function parseClockRange(input: string): { start: number; from: ClockTime; to: ClockTime } | null {
  const m = CLOCK_RANGE.exec(input);
  if (!m) return null;
  const [, h1s, m1s, ap1, h2s, m2s, ap2] = m;
  if (!ap1 && !ap2 && m1s === undefined && m2s === undefined) return null;
  const h1 = Number(h1s), h2 = Number(h2s);
  const min1 = m1s ? Number(m1s) : 0, min2 = m2s ? Number(m2s) : 0;
  if (h1 > 23 || h2 > 23 || min1 > 59 || min2 > 59) return null;
  const pm = (ap: string | undefined) => (ap ? /^p/i.test(ap) : null);
  const to24 = (h: number, isPm: boolean | null) => {
    if (isPm === null || h > 12) return h;
    if (h === 12) return isPm ? 12 : 0;
    return isPm ? h + 12 : h;
  };
  let endPm = pm(ap2);
  let startPm = pm(ap1);
  if (endPm === null && startPm !== null) endPm = startPm;
  if (startPm === null && endPm !== null) {
    startPm = endPm;
    if (to24(h1, startPm) * 60 + min1 > to24(h2, endPm) * 60 + min2) startPm = !endPm;
  }
  if (startPm === null && endPm === null && h1 <= 12) {
    startPm = h1 < 7;
    endPm = h2 < 7 || h2 < h1;
  }
  const from = { h: to24(h1, startPm), m: min1 };
  const to = { h: to24(h2, endPm), m: min2 };
  return { start: m.index, from, to };
}

// " at Joe's", where the clause runs to the end of what is left.
const LOCATION_CLAUSE = /\s+at\s+(\S.*)$/i;

// "with Gideon", "w/ Gideon", "w/Gideon". The word has to stand alone, so
// "without" and "forthwith" don't count, and what follows it is read for names.
const WITH_MARKER = /(?<![a-z0-9])(?:with(?![a-z0-9])|w\/)\s*/i;

/**
 * The people a line names after "with" or "w/" ("Big walk with Bylila"), out
 * of the people already added. Typing the word is the deliberate act an "@"
 * is, so these link on their own. Only what follows the first marker is read,
 * so a name earlier in the line ("Gideon's birthday") links nobody, and the
 * match is `peopleNamedInTitle`'s: whole-word, exact, ambiguity resolves to
 * nobody, and nobody is ever created.
 */
export function peopleAfterWith(line: string, people: readonly PersonToken[]): string[] {
  const marker = WITH_MARKER.exec(line);
  if (!marker) return [];
  return peopleNamedInTitle(line.slice(marker.index + marker[0].length), people);
}

// ---- the card's other chips, typed as trailing clauses ----
// "walking", "by transit", "10 min early", "from home", "in Work calendar",
// "show as free". Each is a suffix like the alert, and each has to name
// something that exists (a mode, a saved place, a calendar on this device) or
// it stays in the title: a clause that read as nothing would take its words
// out of the line without setting anything.

const TRAVEL_WORDS: { mode: TravelMode; bare: string[]; withBy: string[] }[] = [
  { mode: 'walking', bare: ['walking', 'on foot'], withBy: ['walking', 'walk', 'foot'] },
  { mode: 'transit', bare: ['transit', 'public transit'], withBy: ['transit', 'public transit', 'bus', 'train', 'subway', 'metro'] },
  { mode: 'driving', bare: ['driving'], withBy: ['driving', 'drive', 'car'] },
];

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A name as a pattern that tolerates any run of spaces where the name has one. */
const loosely = (text: string) => escapeRegex(text.trim()).replace(/\s+/g, '\\s+');

/**
 * "walking", "on foot", "by transit", "via bus", "by car". The bare words are
 * the unambiguous ones: "bus" or "car" alone ends too many real titles ("catch
 * the bus", "wash the car"), so those need the "by".
 */
export function parseTravelClause(input: string): { start: number; mode: TravelMode } | null {
  for (const { mode, bare, withBy } of TRAVEL_WORDS) {
    const by = new RegExp(String.raw`\s+(?:by|via)\s+(?:${withBy.map(loosely).join('|')})\s*$`, 'i').exec(input);
    if (by) return { start: by.index, mode };
    const plain = new RegExp(String.raw`\s+(?:${bare.map(loosely).join('|')})\s*$`, 'i').exec(input);
    if (plain) return { start: plain.index, mode };
  }
  return null;
}

// "10 min early", "arrive 10m early", "5 minutes late", "arrive on time". A
// bare "10 early" needs the word "arrive" so a stray number stays a number.
const ARRIVE_CLAUSE = /\s+(?:(arrive\s+)?(\d{1,2})\s*(m|mins?|minutes?)?\s+(early|late)|arrive\s+on\s+time)\s*$/i;

/**
 * A trailing arrival clause, as minutes before the start (negative is late).
 * Only the steps the chip offers read: "12 min early" stays in the title
 * rather than quietly becoming 10.
 */
export function parseArriveClause(input: string): { start: number; minutes: number } | null {
  const m = ARRIVE_CLAUSE.exec(input);
  if (!m) return null;
  if (m[4] === undefined) return { start: m.index, minutes: 0 };
  if (!m[1] && !m[3]) return null;
  const minutes = Number(m[2]) * (m[4].toLowerCase() === 'late' ? -1 : 1);
  if (minutes === 0 || clampArriveEarlyMinutes(minutes) !== minutes) return null;
  return { start: m.index, minutes };
}

// "show as free", "as busy".
const AVAILABILITY_CLAUSE = /\s+(?:show(?:n)?\s+)?as\s+(free|busy)\s*$/i;

export function parseAvailabilityClause(input: string): { start: number; availability: 'busy' | 'free' } | null {
  const m = AVAILABILITY_CLAUSE.exec(input);
  return m ? { start: m.index, availability: m[1].toLowerCase() === 'free' ? 'free' : 'busy' } : null;
}

/**
 * A trailing "in Work calendar" / "on my Home calendar" naming one of the
 * calendars given. The longest title that matches wins, so "Work" doesn't
 * shadow "Side Work".
 */
export function parseCalendarClause(
  input: string,
  calendars: readonly { id: string; title: string }[],
): { start: number; id: string } | null {
  let best: { start: number; id: string; length: number } | null = null;
  for (const { id, title } of calendars) {
    if (!title.trim()) continue;
    const m = new RegExp(String.raw`\s+(?:in|on)\s+(?:my\s+|the\s+)?${loosely(title)}\s+calendar\s*$`, 'i').exec(input);
    if (m && (!best || title.length > best.length)) best = { start: m.index, id, length: title.length };
  }
  return best ? { start: best.start, id: best.id } : null;
}

/**
 * A trailing "from home" / "from here" naming a place the trip can start at:
 * one of the places given, or the phone's own position.
 */
export function parseOriginClause(
  input: string,
  places: readonly { id: string; name: string }[],
): { start: number; id: string } | null {
  const phone = /\s+from\s+(?:here|where\s+i\s+am|my\s+location)\s*$/i.exec(input);
  if (phone) return { start: phone.index, id: TRAVEL_ORIGIN_PHONE };
  let best: { start: number; id: string; length: number } | null = null;
  for (const { id, name } of places) {
    if (!name.trim()) continue;
    const m = new RegExp(String.raw`\s+from\s+${loosely(name)}\s*$`, 'i').exec(input);
    if (m && (!best || name.length > best.length)) best = { start: m.index, id, length: name.length };
  }
  return best ? { start: best.start, id: best.id } : null;
}

// "note: bring the sign-up sheet". It takes everything after it, so it has to
// be the last clause typed, and it needs the colon so a title that merely
// contains the word "note" is left alone.
const NOTES_CLAUSE = /\s+notes?:\s*(\S.*)$/i;

/** A trailing "note: …", with where its leading space begins. The rest of the line is the note. */
export function parseNotesClause(input: string): { start: number; text: string } | null {
  const m = NOTES_CLAUSE.exec(input);
  return m ? { start: m.index, text: m[1].trim() } : null;
}

/** A representative hour for a day-part word with no clock time. */
const DAY_PART_HOUR: Record<TimeOfDay, number> = {
  morning: 9,
  afternoon: 14,
  evening: 19,
  night: 21,
};

export function parseQuickEvent(
  input: string,
  opts: {
    people: readonly PersonToken[];
    groups?: readonly GroupMentionToken[];
    /** The name to write in place of a resolved "@token". */
    nameOf: (personId: string) => string | null;
    /** `getLogicalNow(dayResetTime)`, the "now" quick add parses against. */
    now: Date;
    /** `getCurrentDayStart()`. */
    today: Date;
    /**
     * The real current time, for "the next whole hour". Not `now`, which is
     * pulled back a day in the grace window so a parsed "tomorrow" lands right.
     */
    wallClock: Date;
    /** Places a clock time said without a date in the grace window (parseTaskInput). */
    dayResetTime?: string;
    /**
     * Read no schedule phrase at all: the user said "not that" to it, so it
     * stays part of the title and the day falls back to the default.
     */
    ignoreSchedule?: boolean;
    /** Picks made for an "@name" more than one person answers to, by token. */
    mentionOverrides?: Record<string, string>;
    /**
     * Read the line as a plain title: no clauses, no schedule. The edit card
     * opens on an event's own title this way, so a title that happens to read
     * like an instruction ("Dinner at Joe's tomorrow") doesn't move the event
     * or lose words until the user actually types something.
     */
    plain?: boolean;
    /**
     * Read the trip clauses ("walking", "10 min early", "from home"). Off
     * unless the trip setting is on, since the words would otherwise leave the
     * title and set nothing.
     */
    travel?: boolean;
    /** Places a trip can start from, for "from home". */
    originPlaces?: readonly { id: string; name: string }[];
    /** Calendars the event can go in, for "in Work calendar". Without any the clause isn't read. */
    calendars?: readonly { id: string; title: string }[];
    /** Read "show as free" and "as busy". */
    availability?: boolean;
    /** Read "note: …" into the Notes or link field. */
    notes?: boolean;
  }
): QuickEventDraft {
  // Peel the trailing clauses off the right of the line, in whatever order
  // they were typed ("… at Joe's for 90m alert 30m"), so what is left ends in
  // the schedule phrase `parseTaskInput` needs. Each clause is a suffix of
  // what was left before it, so every index below is still an index into
  // `input`.
  let body = input;
  let location: string | null = null;
  let locationSpan: [number, number] | null = null;
  let alertClause: { start: number; minutes: number | null } | null = null;
  let alertSpan: [number, number] | null = null;
  let forMinutes: number | null = null;
  let durationSpan: [number, number] | null = null;
  let travelMode: TravelMode | undefined;
  let travelSpan: [number, number] | null = null;
  let arriveEarlyMinutes: number | undefined;
  let arriveSpan: [number, number] | null = null;
  let travelOriginId: string | undefined;
  let originSpan: [number, number] | null = null;
  let calendarId: string | undefined;
  let calendarSpan: [number, number] | null = null;
  let availability: 'busy' | 'free' | undefined;
  let availabilitySpan: [number, number] | null = null;
  let notes: string | undefined;
  let notesSpan: [number, number] | null = null;
  let clausesFrom: number | null = null;
  const spanOf = (from: number, to: number): [number, number] =>
    [from + (/^\s*/.exec(input.slice(from, to))?.[0].length ?? 0), to];
  for (let guard = 0; guard < 9 && !opts.plain; guard++) {
    const to = body.length;
    // The notes take the rest of the line, so they are read before anything
    // typed after them ("note: take the bus walking") can be read as a clause.
    const noteClause = !opts.notes || notesSpan ? null : parseNotesClause(body);
    if (noteClause) {
      notes = noteClause.text;
      notesSpan = spanOf(noteClause.start, to);
      body = body.slice(0, noteClause.start);
      clausesFrom = noteClause.start;
      continue;
    }
    const alert: { start: number; minutes: number | null } | null = alertClause ? null : parseAlertClause(body);
    if (alert) {
      alertClause = alert;
      alertSpan = spanOf(alert.start, to);
      body = body.slice(0, alert.start);
      clausesFrom = alert.start;
      continue;
    }
    const length: { start: number; minutes: number } | null = durationSpan ? null : parseLengthClause(body);
    if (length) {
      forMinutes = length.minutes;
      durationSpan = spanOf(length.start, to);
      body = body.slice(0, length.start);
      clausesFrom = length.start;
      continue;
    }
    const mode = !opts.travel || travelSpan ? null : parseTravelClause(body);
    if (mode) {
      travelMode = mode.mode;
      travelSpan = spanOf(mode.start, to);
      body = body.slice(0, mode.start);
      clausesFrom = mode.start;
      continue;
    }
    const arrive = !opts.travel || arriveSpan ? null : parseArriveClause(body);
    if (arrive) {
      arriveEarlyMinutes = arrive.minutes;
      arriveSpan = spanOf(arrive.start, to);
      body = body.slice(0, arrive.start);
      clausesFrom = arrive.start;
      continue;
    }
    const origin = !opts.travel || originSpan ? null : parseOriginClause(body, opts.originPlaces ?? []);
    if (origin) {
      travelOriginId = origin.id;
      originSpan = spanOf(origin.start, to);
      body = body.slice(0, origin.start);
      clausesFrom = origin.start;
      continue;
    }
    const free = !opts.availability || availabilitySpan ? null : parseAvailabilityClause(body);
    if (free) {
      availability = free.availability;
      availabilitySpan = spanOf(free.start, to);
      body = body.slice(0, free.start);
      clausesFrom = free.start;
      continue;
    }
    const calendar = !opts.calendars || calendarSpan ? null : parseCalendarClause(body, opts.calendars);
    if (calendar) {
      calendarId = calendar.id;
      calendarSpan = spanOf(calendar.start, to);
      body = body.slice(0, calendar.start);
      clausesFrom = calendar.start;
      continue;
    }
    const locationMatch: RegExpExecArray | null = locationSpan ? null : LOCATION_CLAUSE.exec(body);
    if (locationMatch) {
      const place = locationMatch[1].trim().replace(/[\s,;.]+$/, '');
      // "at 3pm" and "at the park tomorrow" end in a schedule phrase, so they
      // are the time, not the place. Put the place last: "lunch fri 12p at Joe's".
      const endsInTime =
        !opts.ignoreSchedule && parseTaskInput(`x ${place}`, opts.now, opts.wallClock, opts.dayResetTime) !== null;
      if (place && !endsInTime) {
        location = place;
        locationSpan = spanOf(locationMatch.index, to);
        body = body.slice(0, locationMatch.index);
        clausesFrom = locationMatch.index;
        continue;
      }
    }
    break;
  }

  // A clock range ("12-1:30pm", "from 6 to 8pm") is the end of the schedule
  // phrase rather than a clause of its own: it sets the start and the end
  // together, and taking the date out of the line takes it out too.
  const range = opts.ignoreSchedule || opts.plain ? null : parseClockRange(body);
  const scheduleBody = range ? body.slice(0, range.start) : body;

  const parsed = opts.ignoreSchedule || opts.plain ? null : parseTaskInput(scheduleBody, opts.now, opts.wallClock, opts.dayResetTime);
  const mentions = applyMentionOverrides(
    body,
    matchPersonMentions(body, [...opts.people], [...(opts.groups ?? [])]),
    opts.mentionOverrides ?? {}
  );
  // "with Gideon" links like "@gideon" does, except where the line is an
  // opened event's own title, which is read as plain text until changed.
  const withIds = opts.plain ? [] : peopleAfterWith(input, opts.people);
  const personIds = [...new Set([...mentions.map(m => m.personId), ...withIds])];

  // Rebuild the title from the original input so both kinds of span can be
  // edited by index: the schedule phrase dropped, each mention named.
  const spans: { start: number; end: number; text: string }[] = [];
  if (parsed) {
    spans.push({ start: parsed.matchStart, end: parsed.matchStart + parsed.matchedText.length, text: '' });
  }
  if (range) spans.push({ start: range.start, end: body.length, text: '' });
  const bySpan = new Map<string, string[]>();
  for (const m of mentions) {
    const k = `${m.start}:${m.end}`;
    const held = bySpan.get(k);
    if (held) held.push(m.personId);
    else bySpan.set(k, [m.personId]);
  }
  for (const [k, ids] of bySpan) {
    const [start, end] = k.split(':').map(Number);
    const token = body.slice(start + 1, end);
    // One person: their name. A group: the word typed, since it names several.
    const name = ids.length === 1 ? opts.nameOf(ids[0]) ?? token : token;
    spans.push({ start, end, text: name });
  }
  spans.sort((a, b) => b.start - a.start);
  let title = body;
  for (const span of spans) {
    title = title.slice(0, span.start) + span.text + title.slice(span.end);
  }
  title = title.replace(/\s+/g, ' ').trim().replace(/[\s,;:.-]+$/, '');

  const schedule = parsed?.schedule;
  const day = schedule?.dueDate ?? null;
  const onDay = (d: Date, t: ClockTime) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.h, t.m);
  let start: Date;
  let durationMinutes: number | null = null;
  if (range) {
    const d = day ?? opts.today;
    start = onDay(d, range.from);
    let finish = onDay(d, range.to);
    // "11pm-1am" ends the next morning.
    if (finish <= start) finish = addDays(finish, 1);
    durationMinutes = Math.round((finish.getTime() - start.getTime()) / 60000);
  } else if (schedule?.windowStart && schedule.explicitClockTime) {
    // "between 12 and 1:30pm" reads, for a task, as a window start and a
    // deadline; for an event it is the start and the end.
    const [h, m] = schedule.windowStart.split(':').map(Number);
    start = onDay(schedule.dueDate, { h, m });
    const finish = onDay(schedule.dueDate, schedule.explicitClockTime);
    if (finish > start) durationMinutes = Math.round((finish.getTime() - start.getTime()) / 60000);
  } else if (schedule?.explicitClockTime) {
    start = onDay(schedule.dueDate, schedule.explicitClockTime);
  } else if (schedule && schedule.timeSegments.length > 0) {
    start = onDay(schedule.dueDate, { h: DAY_PART_HOUR[schedule.timeSegments[0]], m: 0 });
  } else {
    // No time: the same default the other "New event" buttons use, on the
    // day read (or today).
    start = defaultNewEventSpan(day ?? opts.today, opts.today, opts.wallClock).start;
  }
  // "for 90m" sets the length unless a range already did.
  if (durationMinutes === null && forMinutes !== null) durationMinutes = forMinutes;
  const timed = range !== null || !!schedule?.explicitClockTime || (schedule?.timeSegments.length ?? 0) > 0;

  // Taking the schedule phrase out of the line must leave the clauses that
  // followed it, or accepting the date would silently drop the place and alert.
  // A "for 3 hours" that set the length is the exception: accepting the phrase
  // copies that length into the chip (`durationPick`), so its words leave the
  // line with the date instead of lingering in the title.
  let clauses = clausesFrom === null ? '' : input.slice(clausesFrom);
  if (clausesFrom !== null && durationSpan && forMinutes !== null && durationMinutes === forMinutes) {
    clauses = (input.slice(clausesFrom, durationSpan[0]).trimEnd() + input.slice(durationSpan[1])).replace(/^\s+$/, '');
  }
  let phrase: QuickEventDraft['phrase'] = null;
  if (parsed || range) {
    const phraseStart = parsed ? parsed.matchStart : range!.start + (/^\s*/.exec(body.slice(range!.start))?.[0].length ?? 0);
    const before = parsed ? parsed.cleanTitle : scheduleBody.replace(/\s+$/, '');
    phrase = { start: phraseStart, text: body.slice(phraseStart).trim(), lineWithout: before + clauses };
  }
  const mentionSpans = [...bySpan.keys()].map(k => k.split(':').map(Number) as [number, number]);
  const clauseSpans: [number, number][] = [
    locationSpan, durationSpan, alertSpan, travelSpan, arriveSpan, originSpan, calendarSpan, availabilitySpan, notesSpan,
  ]
    .filter((span): span is [number, number] => span !== null)
    .sort((a, b) => a[0] - b[0]);

  return {
    title,
    start,
    end: addMinutes(start, durationMinutes ?? DEFAULT_EVENT_MINUTES),
    durationMinutes,
    timed,
    personIds,
    scheduled: !!schedule || range !== null,
    phrase,
    mentionSpans,
    location,
    locationSpan,
    alertMinutes: alertClause ? alertClause.minutes : undefined,
    alertSpan,
    durationSpan,
    clauseSpans,
    repeat: eventRecurrenceFor(schedule),
    travelMode,
    arriveEarlyMinutes,
    travelOriginId,
    calendarId,
    availability,
    travelSpan,
    arriveSpan,
    originSpan,
    calendarSpan,
    availabilitySpan,
    notes,
    notesSpan,
  };
}

/**
 * The marker that turns a regular quick add line into an event: a leading
 * "event:" ("event: lunch w/ @gideon sat 12pm"). Returns the rest of the line
 * when it is there, or null. A leading word and a colon, so it can't be hit by
 * accident mid-title, and "event" alone without the colon stays a task title.
 */
export function eventMarkerText(input: string): string | null {
  const match = /^\s*event:\s*/i.exec(input);
  return match ? input.slice(match[0].length) : null;
}
