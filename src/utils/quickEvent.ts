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
import { parseDurationTail, type ParsedSchedule } from './parseTaskInput';
import type { TimeOfDay } from '../types';
import type { ClockTime } from './parseNaturalDate';

/**
 * One typed line ("lunch w/ @dustin fri 12p") turned into a new calendar
 * event, the event counterpart of quick add. Nothing here writes anything: it
 * reads the line into a draft that `quickEventSaveFields` turns into the write
 * (`saveEventDirect`), and names who to link it to afterward.
 *
 * **It reuses quick add's two readers rather than growing its own**:
 * `parseTaskInput` for the day and time, `matchPersonMentions` for "@name".
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
  let clausesFrom: number | null = null;
  const spanOf = (from: number, to: number): [number, number] =>
    [from + (/^\s*/.exec(input.slice(from, to))?.[0].length ?? 0), to];
  for (let guard = 0; guard < 3 && !opts.plain; guard++) {
    const to = body.length;
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
    const locationMatch: RegExpExecArray | null = locationSpan ? null : LOCATION_CLAUSE.exec(body);
    if (locationMatch) {
      const place = locationMatch[1].trim().replace(/[\s,;.]+$/, '');
      // "at 3pm" and "at the park tomorrow" end in a schedule phrase, so they
      // are the time, not the place. Put the place last: "lunch fri 12p at Joe's".
      const endsInTime =
        !opts.ignoreSchedule && parseTaskInput(`x ${place}`, opts.now, opts.wallClock) !== null;
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

  const parsed = opts.ignoreSchedule || opts.plain ? null : parseTaskInput(scheduleBody, opts.now, opts.wallClock);
  const mentions = applyMentionOverrides(
    body,
    matchPersonMentions(body, [...opts.people], [...(opts.groups ?? [])]),
    opts.mentionOverrides ?? {}
  );
  const personIds = [...new Set(mentions.map(m => m.personId))];

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
  const clauses = clausesFrom === null ? '' : input.slice(clausesFrom);
  let phrase: QuickEventDraft['phrase'] = null;
  if (parsed || range) {
    const phraseStart = parsed ? parsed.matchStart : range!.start + (/^\s*/.exec(body.slice(range!.start))?.[0].length ?? 0);
    const before = parsed ? parsed.cleanTitle : scheduleBody.replace(/\s+$/, '');
    phrase = { start: phraseStart, text: body.slice(phraseStart).trim(), lineWithout: before + clauses };
  }
  const mentionSpans = [...bySpan.keys()].map(k => k.split(':').map(Number) as [number, number]);
  const clauseSpans: [number, number][] = [locationSpan, durationSpan, alertSpan]
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
  };
}

/**
 * The marker that turns a regular quick add line into an event: a leading
 * "event:" ("event: lunch w/ @dustin sat 12pm"). Returns the rest of the line
 * when it is there, or null. A leading word and a colon, so it can't be hit by
 * accident mid-title, and "event" alone without the colon stays a task title.
 */
export function eventMarkerText(input: string): string | null {
  const match = /^\s*event:\s*/i.exec(input);
  return match ? input.slice(match[0].length) : null;
}
