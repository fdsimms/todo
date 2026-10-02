import { addDays } from 'date-fns/addDays';
import { addMonths } from 'date-fns/addMonths';
import { addWeeks } from 'date-fns/addWeeks';
import { addYears } from 'date-fns/addYears';
import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import { lastDayOfMonth } from 'date-fns/lastDayOfMonth';
import { setDate } from 'date-fns/setDate';
import { setHours } from 'date-fns/setHours';
import { startOfDay } from 'date-fns/startOfDay';
import { startOfMonth } from 'date-fns/startOfMonth';
import type { Day } from 'date-fns';
import type { Priority, QuotaPeriod, RecurrenceType, TimeOfDay } from '../types';
import { extractDayPart, extractTime, MONTHS, monthDay, NUMBER_WORD_ALT, parseCount, parseDatePart, WEEKDAYS, type ClockTime } from './parseNaturalDate';
import { looksLikePhoneNumber } from './phone';

/**
 * The Nth (1-4) or last (-1) weekday-of-month occurrence within the month
 * containing `monthDate`. Duplicated from dateUtils.ts's identical helper
 * rather than imported — dateUtils pulls in the SQLite db layer transitively
 * (via useSettingsStore), which this module must stay free of to keep parsing
 * pure and Jest-testable without native module mocks.
 */
/**
 * Every `cleanTitle` here is trimmed, so accepting a suggestion whose match
 * sat at the end of the title leaves the caret right against the last word
 * with no space to type into. Callers applying a suggestion to a live title
 * field should route the result through this first, so the caret lands
 * ready for the next word instead of butting up against the one before it.
 */
export function withTrailingSpace(cleanTitle: string): string {
  return cleanTitle ? `${cleanTitle} ` : cleanTitle;
}

function nthWeekdayOfMonth(monthDate: Date, weekday: number, ordinal: number): Date {
  if (ordinal === -1) {
    const last = lastDayOfMonth(monthDate);
    return addDays(last, -((last.getDay() - weekday + 7) % 7));
  }
  const first = startOfMonth(monthDate);
  const offset = (weekday - first.getDay() + 7) % 7;
  return addDays(first, offset + (ordinal - 1) * 7);
}

/**
 * Extracts a schedule phrase from the end of a quick-add title.
 *
 *   "go for a run on tuesday"     → "go for a run", due next Tuesday
 *   "water plants every 3 days"   → "water plants", daily ×3
 *   "gym every mon and wed"       → "gym", weekly on Mon & Wed
 *   "journal every night at 10pm" → "journal", daily, evening segment
 *   "take zaltrex every 8 hours"  → "take zaltrex", hourly ×8, from completion
 *
 * The phrase must extend to the end of the input (suffix-anchored), which is
 * what keeps mid-title words like "email tuesday the dog" from matching.
 * Returns null when no suffix parses confidently, so the title is kept as-is.
 */

export interface ParsedSchedule {
  /**
   * Noon on the due day; the first occurrence for recurrences. Noon — not
   * midnight — so the date can't slip into the previous logical day for users
   * whose dayResetTime is after midnight (getDayStart reassigns a 00:00
   * timestamp to the day before). WhenPicker stores noon for the same reason.
   */
  dueDate: Date;
  timeSegments: TimeOfDay[];
  /** 'none' for one-off dates. */
  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  /**
   * Weekly: the recurring weekdays, 0 = Sunday, sorted. Monthly with
   * recurrenceWeekOrdinal set: a single weekday (only the first entry is used).
   */
  recurrenceDays: number[];
  /** Monthly only: fixed day of month (1-31), -1 = last day. Mutually exclusive with recurrenceWeekOrdinal. */
  recurrenceMonthDay?: number | null;
  /** Monthly only: 1-4 = Nth weekday of month, -1 = last weekday of month ("every 2nd Tuesday", "last Friday"). */
  recurrenceWeekOrdinal?: number | null;
  recurrenceEndDate?: string | null;
  recurrenceCount?: number | null;
  recurrenceFromCompletion?: boolean;
  /**
   * Set only for a one-off suffix introduced by "by"/"due" ("return fiddle
   * by friday") — "on" reads as "this is the day it shows up" and stays a
   * plain dueDate, but "by"/"due" reads as a target to hit, so it's mirrored
   * onto the separate Deadline field (same day, noon) alongside dueDate
   * rather than instead of it: the task still shows up scheduled, and also
   * carries the countdown badge.
   */
  deadline?: Date;
  /**
   * The literal clock reading the phrase named ("5pm", "10:30am") — never set
   * for a day-part word ("morning", "tonight") or an implied hour, since those
   * name a representative bucket rather than a moment the user actually typed.
   * Callers use this to offer turning the moment into a real reminder, which
   * is the only way it survives: `dueDate` is always noon (see above) and
   * `timeSegments` only ever holds the coarse morning/afternoon/evening
   * bucket, so without this the clock reading itself is discarded entirely.
   */
  explicitClockTime?: ClockTime | null;
  /**
   * `"HH:MM"`, set only by "after 3pm" and the start of "between 2 and 4pm":
   * the task stays hidden until then on its day (`Task.windowStart`).
   *
   * There's deliberately no `windowEnd` counterpart. A window end makes a task
   * *expire* once it passes, and the sweep can delete what has expired, so
   * "before 5pm" and the end of a "between" are read as a deadline instead
   * (see `deadline` above): a typed phrase is a guess, and a guess must not be
   * able to remove a task.
   */
  windowStart?: string | null;
  /**
   * `"HH:MM"`, set only by the explicit expiry words "only" and "expires"
   * ("only today", "expires friday at 5pm"): the task moves to Expired once
   * it passes (`Task.windowEnd`), and the expiry sweep deletes it if the user
   * has turned that on. With no clock time it's 23:59, the end of the day.
   *
   * Nothing else here sets it, and that's the point of the two words: "before
   * 5pm" and "between 2 and 4pm" are a deadline, because a guess at what a
   * phrase meant must not be able to remove a task (see `windowStart`). These
   * say "and then it's gone" outright, and the tooltip says "Expires" before
   * it's accepted.
   */
  windowEnd?: string | null;
  /**
   * The rest of a set of dates ("on the 10th and the 15th"), each at noon like
   * `dueDate`, which holds the earliest. Absent for a single date. A caller
   * turns the whole set into a series (`applyTaskDates`), never into separate
   * unlinked tasks: see the Series note in CLAUDE.md.
   */
  extraDates?: Date[];
}

export interface ParsedTaskInput {
  /** Input minus the matched phrase, original casing, trailing punctuation trimmed. */
  cleanTitle: string;
  /** The exact matched substring, original casing. */
  matchedText: string;
  /** Index of matchedText within the original input — drives the inline highlight. */
  matchStart: number;
  schedule: ParsedSchedule;
}

const FULL_WEEKDAYS: Record<string, Day> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Day-part words → the visibility segment they imply.
const DAY_PART_SEGMENT: Record<string, TimeOfDay> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
  night: 'evening',
};

// A bare one-word suffix is only trusted when it's unambiguously a schedule
// word. Weekday abbreviations ("mon", "sat", "wed") are accepted even though
// a couple of them double as ordinary words ("sun", "wed", "sat") — a title
// ending in one of those bare is rare enough that the worst case is an
// unwanted date suggestion the user dismisses, not a silent wrong schedule.
const SINGLE_WORD_SAFE =
  /^(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|(?:sun|mon|tues|wednes|thurs|fri|satur)days|today|tomorrow|tonight|tmrw|tmr|daily|weekly|monthly|yearly|annually|\d{1,2}(?::\d{2})?(?:am|pm|a\.m\.?|p\.m\.?))$/;

/**
 * Which part of the day an hour falls in. Fixed boundaries rather than the
 * configurable morningStart/afternoonStart/eveningStart, because this module
 * stays free of the settings store (see the header note) — and exported so the
 * Reminders import maps a dictated due time the same way quick add maps a typed
 * one, instead of keeping a second copy of these two numbers.
 */
export function segmentForHour(h: number): TimeOfDay {
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

/** Noon on the given day — see ParsedSchedule.dueDate. */
export function dueAt(day: Date): Date {
  return setHours(startOfDay(day), 12);
}

/** Earliest day from today (inclusive) whose weekday is in `days`. */
function firstOccurrence(days: number[], now: Date): Date {
  const today = dueAt(now);
  if (days.length === 0) return today;
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    if (days.includes(d.getDay())) return d;
  }
  return today;
}

/** Earliest occurrence (today or later) of a fixed day-of-month; day === -1 means the last day. */
function firstMonthDayOccurrence(day: number, now: Date): Date {
  const today = startOfDay(now);
  const clamp = (d: Date) => (day === -1 ? lastDayOfMonth(d) : setDate(d, Math.min(day, lastDayOfMonth(d).getDate())));
  let candidate = clamp(today);
  if (candidate < today) candidate = clamp(addMonths(today, 1));
  return candidate;
}

/** Earliest occurrence (today or later) of the Nth (or last) weekday-of-month. */
function firstWeekdayOfMonthOccurrence(weekday: number, ordinal: number, now: Date): Date {
  const today = startOfDay(now);
  let candidate = nthWeekdayOfMonth(today, weekday, ordinal);
  if (candidate < today) candidate = nthWeekdayOfMonth(addMonths(today, 1), weekday, ordinal);
  return candidate;
}

const ORDINAL_WORDS: Record<string, number> = {
  '1st': 1, first: 1,
  '2nd': 2, second: 2,
  '3rd': 3, third: 3,
  '4th': 4, fourth: 4,
  last: -1,
};

/** "15th" / "15" → 15; "last"/"last day" → -1. */
function parseMonthDayToken(token: string): number | null {
  if (token === 'last' || token === 'last day') return -1;
  const m = token.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 31 ? n : null;
}

function recurrence(
  type: RecurrenceType,
  interval: number,
  days: number[],
  segments: TimeOfDay[],
  now: Date,
): ParsedSchedule {
  return {
    dueDate: firstOccurrence(days, now),
    timeSegments: segments,
    recurrenceType: type,
    recurrenceInterval: interval,
    recurrenceDays: days,
  };
}

/**
 * Parse a list of weekdays: "mon and wed", "tue, thu", "tue/thu".
 * With `requirePlural`, each item must be a plural full weekday name
 * ("tuesdays") — the connector-less form used without "every".
 */
function parseWeekdayList(text: string, requirePlural: boolean): number[] | null {
  const items = text.split(/\s*(?:,|&|\/|\band\b)\s*/).filter(Boolean);
  if (items.length === 0) return null;
  const days = new Set<number>();
  for (const item of items) {
    let day: Day | undefined;
    if (requirePlural) {
      const m = item.match(/^([a-z]+)s$/);
      day = m ? FULL_WEEKDAYS[m[1]] : undefined;
    } else {
      day = WEEKDAYS[item] ?? WEEKDAYS[item.replace(/s$/, '')];
    }
    if (day === undefined) return null;
    days.add(day);
  }
  return [...days].sort((a, b) => a - b);
}

function unitToType(unit: string): RecurrenceType | null {
  if (/^day/.test(unit)) return 'daily';
  if (/^week/.test(unit)) return 'weekly';
  if (/^month/.test(unit)) return 'monthly';
  if (/^year/.test(unit)) return 'yearly';
  if (/^hour/.test(unit)) return 'hours';
  return null;
}

/**
 * Sub-day recurrence has no calendar grid to anchor to — it's always
 * measured from the moment you check the task off (see RecurrenceType's own
 * doc comment on 'hours') — so a parsed 'hours' schedule forces
 * recurrenceFromCompletion, the same thing RecurrencePicker.tsx forces when
 * a person picks this type by hand.
 */
function forceFromCompletionIfHours(type: RecurrenceType, schedule: ParsedSchedule): ParsedSchedule {
  return type === 'hours' ? { ...schedule, recurrenceFromCompletion: true } : schedule;
}

/** Anchored recurrence grammar; `segments` carries a previously peeled time-of-day. */
function matchRecurrenceCore(text: string, now: Date, segments: TimeOfDay[]): ParsedSchedule | null {
  let m: RegExpMatchArray | null;

  if (/^(?:daily|every day)$/.test(text)) return recurrence('daily', 1, [], segments, now);
  if (/^(?:weekly|every week)$/.test(text)) return recurrence('weekly', 1, [], segments, now);
  if (/^(?:monthly|every month)$/.test(text)) return recurrence('monthly', 1, [], segments, now);
  if (/^(?:yearly|annually|every year)$/.test(text)) return recurrence('yearly', 1, [], segments, now);
  if (/^every hour$/.test(text)) return forceFromCompletionIfHours('hours', recurrence('hours', 1, [], segments, now));

  // "every morning" — the day part IS the unit, and supplies the segment.
  if ((m = text.match(/^every (morning|afternoon|evening|night)$/))) {
    return recurrence('daily', 1, [], [DAY_PART_SEGMENT[m[1]]], now);
  }

  // "every 3 days", "every 2 weeks", "every 8 hours"
  if ((m = text.match(/^every (\d+) (days?|weeks?|months?|years?|hours?)$/))) {
    const type = unitToType(m[2])!;
    const n = parseInt(m[1], 10);
    if (n < 1) return null;
    return forceFromCompletionIfHours(type, recurrence(type, n, [], segments, now));
  }

  // "every other week", "every other tuesday", "every other hour"
  if ((m = text.match(/^every other (.+)$/))) {
    const type = unitToType(m[1]);
    if (type) return forceFromCompletionIfHours(type, recurrence(type, 2, [], segments, now));
    const days = parseWeekdayList(m[1], false);
    if (days) return recurrence('weekly', 2, days, segments, now);
    return null;
  }

  if (/^every weekdays?$/.test(text)) return recurrence('weekly', 1, [1, 2, 3, 4, 5], segments, now);
  if (/^every weeknights?$/.test(text)) {
    return recurrence('weekly', 1, [1, 2, 3, 4, 5], [DAY_PART_SEGMENT.night], now);
  }
  if (/^every weekends?$/.test(text)) return recurrence('weekly', 1, [0, 6], segments, now);

  // Interval synonyms.
  if (/^(?:biweekly|fortnightly)$/.test(text)) return recurrence('weekly', 2, [], segments, now);
  if (/^(?:quarterly|every quarter)$/.test(text)) return recurrence('monthly', 3, [], segments, now);
  if (/^(?:biannually|semiannually|semi-annually|twice a year)$/.test(text)) return recurrence('monthly', 6, [], segments, now);

  // A specific annual date: "every september 15", "every sep 15th", "yearly on june 1".
  if ((m = text.match(/^every ([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/))
    || (m = text.match(/^(?:yearly|annually) on ([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/))) {
    const month = MONTHS[m[1]];
    if (month !== undefined) {
      const dp = monthDay(month, parseInt(m[2], 10), null, now);
      if (dp) {
        return {
          dueDate: dueAt(dp.date), timeSegments: segments,
          recurrenceType: 'yearly', recurrenceInterval: 1, recurrenceDays: [],
        };
      }
    }
  }

  // A specific annual date, numeric (month-first, matching parseNaturalDate's
  // own "12/25" grammar): "every 3/10" → every March 10th. Swaps to day/month
  // only when the first number can't be a month, same rule monthDay's caller
  // in parseNaturalDate.ts uses for a one-off date.
  if ((m = text.match(/^every (\d{1,2})\/(\d{1,2})$/))) {
    let month = parseInt(m[1], 10) - 1;
    let day = parseInt(m[2], 10);
    if (month > 11 && day <= 12) {
      [month, day] = [day - 1, month + 1];
    }
    if (month <= 11) {
      const dp = monthDay(month, day, null, now);
      if (dp) {
        return {
          dueDate: dueAt(dp.date), timeSegments: segments,
          recurrenceType: 'yearly', recurrenceInterval: 1, recurrenceDays: [],
        };
      }
    }
  }

  // Monthly on a fixed day-of-month: "on the 1st of every month", "every month
  // on the 15th", "monthly on the last day".
  if ((m = text.match(/^on the (.+) of every month$/))
    || (m = text.match(/^every month on the (.+)$/))
    || (m = text.match(/^monthly on the (.+)$/))) {
    const day = parseMonthDayToken(m[1]);
    if (day !== null) {
      return {
        dueDate: dueAt(firstMonthDayOccurrence(day, now)), timeSegments: segments,
        recurrenceType: 'monthly', recurrenceInterval: 1, recurrenceDays: [], recurrenceMonthDay: day,
      };
    }
  }

  // Nth weekday of the month: "every 2nd tuesday", "every last friday of the
  // month", "2nd tuesday of every month", "last friday of every month".
  if ((m = text.match(/^every (1st|2nd|3rd|4th|first|second|third|fourth|last) ([a-z]+)(?: of the month)?$/))
    || (m = text.match(/^(1st|2nd|3rd|4th|first|second|third|fourth|last) ([a-z]+) of every month$/))) {
    const ord = ORDINAL_WORDS[m[1]];
    const weekday = WEEKDAYS[m[2]] ?? WEEKDAYS[m[2].replace(/s$/, '')];
    if (ord !== undefined && weekday !== undefined) {
      return {
        dueDate: dueAt(firstWeekdayOfMonthOccurrence(weekday, ord, now)), timeSegments: segments,
        recurrenceType: 'monthly', recurrenceInterval: 1, recurrenceDays: [weekday], recurrenceWeekOrdinal: ord,
      };
    }
  }

  // "every tuesday", "every mon and wed", "every tue/thu"
  if ((m = text.match(/^every (.+)$/))) {
    const days = parseWeekdayList(m[1], false);
    if (days) return recurrence('weekly', 1, days, segments, now);
    return null;
  }

  // Plural full weekdays without "every": "tuesdays", "on mondays and thursdays"
  if ((m = text.match(/^(?:on )?(.+)$/))) {
    const days = parseWeekdayList(m[1], true);
    if (days) return recurrence('weekly', 1, days, segments, now);
  }

  return null;
}

/** Peels a trailing "starting <date>" clause, e.g. "every 2 weeks starting next friday". */
function extractStartingClause(text: string, now: Date): { date: Date; rest: string } | null {
  const m = text.match(/^(.*?)\s+starting\s+(.+)$/);
  if (!m) return null;
  const dp = parseDatePart(m[2], now);
  return dp ? { date: dp.date, rest: m[1] } : null;
}

/**
 * Peels a trailing "after completion" (or "on completion") clause, mapping to
 * recurrenceFromCompletion. "ac" is the same clause spelled as a shorthand
 * ("every week ac") — its own alternative rather than folded into the
 * "after"/"on" branch, since it has no leading word of its own to match.
 *
 * Case-insensitive so it can be run against original-cased input as well as the
 * lowercased suffix the parser normally hands it — see
 * parseFromCompletionSuffix, which slices the caller's own string by the length
 * of `rest` and would mis-slice if this only matched lowercase.
 */
function extractFromCompletionClause(text: string): { rest: string } | null {
  const m = text.match(/^(.*?)\s+(?:(?:after|on)\s+(?:completion|completing|finishing|finished|it'?s?\s+done|i\s+(?:complete|finish)\s+it|done)|ac)$/i);
  return m ? { rest: m[1] } : null;
}

/**
 * The "after completion" clause on its own, with no recurrence phrase in front
 * of it — which parseTaskInput deliberately does not match, since a task with
 * no repeat has no completion to recur from.
 *
 * It exists for the Apple Reminders import, where the two halves of "every day
 * after completion" can arrive by different routes: Siri understands "every
 * day" and turns it into a native recurrence rule, leaving only the part it
 * didn't understand in the title. The repeat is then real but the modifier is
 * still text, and without this it would be dropped.
 *
 * Returns the title minus the clause, original casing. Callers must supply the
 * recurrence themselves — this says nothing about how often anything repeats.
 */
export function parseFromCompletionSuffix(input: string): { cleanTitle: string } | null {
  const trimmed = input.trim();
  const found = extractFromCompletionClause(trimmed);
  if (!found) return null;
  const cleanTitle = trimmed.slice(0, found.rest.length).replace(/[\s,;:\-–—]+$/, '');
  return cleanTitle ? { cleanTitle } : null;
}

interface EndCondition {
  endDate?: Date;
  count?: number;
  durationN?: number;
  durationUnit?: string;
}

/**
 * Peels a trailing end condition: "until <date>" (including a bare month name,
 * meaning "through the end of that month"), "for N times/occurrences", or
 * "for N days/weeks/months/years" (a duration from the first due date).
 */
function extractEndCondition(text: string, now: Date): { end: EndCondition; rest: string } | null {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^(.*?)\s+until\s+(.+)$/))) {
    const target = m[2];
    const month = MONTHS[target];
    if (month !== undefined) {
      const dp = monthDay(month, 1, null, now);
      if (dp) return { end: { endDate: lastDayOfMonth(dp.date) }, rest: m[1] };
    } else {
      const dp = parseDatePart(target, now);
      if (dp) return { end: { endDate: dp.date }, rest: m[1] };
    }
    return null;
  }
  if ((m = text.match(/^(.*?)\s+for\s+(\d+)\s+(?:times|occurrences?)$/))) {
    return { end: { count: parseInt(m[2], 10) }, rest: m[1] };
  }
  if ((m = text.match(new RegExp(`^(?:(.*?)\\s+)?for\\s+(\\d+|${NUMBER_WORD_ALT})\\s+(days?|weeks?|months?|years?)$`)))) {
    return { end: { durationN: parseCount(m[2]), durationUnit: m[3] }, rest: m[1] ?? '' };
  }
  return null;
}

function durationAddFn(unit: string): (date: Date, amount: number) => Date {
  if (/^day/.test(unit)) return addDays;
  if (/^week/.test(unit)) return addWeeks;
  if (/^month/.test(unit)) return addMonths;
  return addYears;
}

function parseRecurrenceSuffix(text: string, now: Date): ParsedSchedule | null {
  let t = text;

  const fromCompletion = extractFromCompletionClause(t);
  if (fromCompletion) t = fromCompletion.rest;

  const endMatch = extractEndCondition(t, now);
  if (endMatch) t = endMatch.rest;

  const starting = extractStartingClause(t, now);
  const core = starting ? starting.rest : t;

  // A bare duration clause with no recurrence phrase in front of it ("wear
  // new contacts for three days") names no frequency, but the only sensible
  // one for a task with no other schedule at all is daily — the clause is
  // read as "keep doing this every day, for that long" rather than left
  // unparsed. Count-based end conditions ("for 5 times") aren't covered: a
  // bare count still doesn't say how often those 5 times happen.
  let schedule: ParsedSchedule | null =
    core.trim() === '' && endMatch?.end.durationN !== undefined && endMatch.end.durationUnit
      ? recurrence('daily', 1, [], [], now)
      : matchRecurrenceCore(core, now, []);
  if (!schedule && core.trim() !== '') {
    // Peel a trailing clock time / day part ("every tuesday at 6pm") into a segment.
    let segments: TimeOfDay[];
    let rest: string;
    let explicitClockTime: ClockTime | null = null;
    const clock = extractTime(core);
    if (clock) {
      segments = [segmentForHour(clock.time.h)];
      rest = clock.rest;
      explicitClockTime = clock.time;
    } else {
      const part = extractDayPart(core);
      if (!part) return null;
      segments = [DAY_PART_SEGMENT[part.part]];
      rest = part.rest;
    }
    // "@" is no longer stripped as generic noise here — it has no meaning in
    // this file (see parseCategoryAndTagsInput below, which uses "#" for
    // both category and tags) — so a leftover one is left in place and, same
    // as any other stray character, correctly fails the anchored match below
    // rather than being silently swallowed.
    rest = rest.replace(/\bat\b/g, ' ').replace(/\bin the\b/g, ' ').replace(/\s+/g, ' ').trim();
    schedule = matchRecurrenceCore(rest, now, segments);
    if (schedule) schedule = { ...schedule, explicitClockTime };
  }
  if (!schedule) return null;

  if (starting) schedule = { ...schedule, dueDate: dueAt(starting.date) };
  if (fromCompletion) {
    schedule = { ...schedule, recurrenceFromCompletion: true };
  } else if (schedule.recurrenceType === 'daily' && schedule.timeSegments.length === 0) {
    // A bare daily/every-N-days phrase with no clock time or day part
    // defaults to after completion, same as RecurrencePicker.tsx defaults
    // when a person picks Daily by hand — most daily tasks are habits where
    // what matters is a day passing since the last one, not a calendar
    // grid. "every day at 9am" (a real clock time) keeps its fixed
    // schedule; only the ambiguous bare form gets the default.
    schedule = { ...schedule, recurrenceFromCompletion: true };
  }
  if (endMatch) {
    const { end } = endMatch;
    if (end.endDate) {
      schedule = { ...schedule, recurrenceEndDate: dueAt(end.endDate).toISOString() };
    } else if (end.count !== undefined) {
      schedule = { ...schedule, recurrenceCount: end.count };
    } else if (end.durationN !== undefined && end.durationUnit) {
      // The end date is inclusive (getNextDueDate stops only past it), so the
      // span ends the day before: "daily for 10 days" from the 10th is the
      // 10th through the 19th, ten doses rather than eleven.
      const endDate = addDays(durationAddFn(end.durationUnit)(schedule.dueDate, end.durationN), -1);
      schedule = { ...schedule, recurrenceEndDate: endDate.toISOString() };
    }
  }
  return schedule;
}

/**
 * The next date falling on day-of-month `day`, today included. A month too
 * short for it is skipped rather than clamped ("the 31st" in late September is
 * October 31st, not September 30th), the same call `getNextSeriesDates` makes
 * about a set's anchor days.
 */
function nextMonthDay(day: number, now: Date): Date | null {
  if (day < 1 || day > 31) return null;
  const today = startOfDay(now);
  for (let i = 0; i < 12; i++) {
    const candidate = new Date(today.getFullYear(), today.getMonth() + i, day);
    if (candidate.getDate() !== day) continue;
    if (candidate < today) continue;
    return candidate;
  }
  return null;
}

/**
 * One date for a title's schedule: everything `parseDatePart` reads, plus a
 * day of the month said as an ordinal ("the 10th", "15th", "the 1st"), and an
 * ordinal on a month ("october 10th"), neither of which it has a grammar for.
 * A bare "10" isn't accepted without "the": a number on its own is far more
 * often a quantity than a date.
 */
function parseTitleDate(text: string, now: Date, clockNow: Date): Date | null {
  const direct = parseDatePart(text, now, clockNow);
  if (direct) return direct.date;
  const unsuffixed = text.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/, '$1');
  if (unsuffixed !== text) {
    const withMonth = parseDatePart(unsuffixed, now, clockNow);
    if (withMonth) return withMonth.date;
  }
  const m = text.match(/^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)$/) ?? text.match(/^the\s+(\d{1,2})$/);
  return m ? nextMonthDay(parseInt(m[1], 10), now) : null;
}

/**
 * "the 10th and the 15th", "mon, wed and fri", "oct 10 & oct 20": two or more
 * dates, every one of which has to parse on its own. One that doesn't refuses
 * the lot ("call mom and dad" is not a date list), and so does a list that
 * comes out as a single day.
 */
function parseDateList(text: string, now: Date, clockNow: Date): Date[] | null {
  if (!/,|\band\b|&/.test(text)) return null;
  const parts = text.split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/).map(p => p.trim());
  if (parts.length < 2 || parts.some(p => !p)) return null;
  const dates: Date[] = [];
  for (const part of parts) {
    const date = parseTitleDate(part, now, clockNow);
    if (!date) return null;
    if (!dates.some(d => isSameDay(d, date))) dates.push(date);
  }
  if (dates.length < 2) return null;
  return dates.sort((a, b) => +a - +b);
}

function hhmm(t: ClockTime): string {
  return `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`;
}

// "between 2 and 4pm", "between 9am and noon", "between 14:00 - 16:00". The
// start is matched here and the end left for extractTime, so the start can
// omit its am/pm the way people say it and borrow one from the end.
const BETWEEN_START = /^between\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|a|p)?\s+(?:and|to|-)\s+/;

/**
 * The start of a "between" phrase, given the end it ran up to. A start with no
 * am/pm takes whichever reading falls before the end, preferring the end's own
 * half of the day: "between 2 and 4pm" is 2pm, "between 11 and 1pm" is 11am.
 */
function betweenStart(hour: number, minute: number, meridiem: string | undefined, end: ClockTime): ClockTime | null {
  if (minute > 59) return null;
  const endMinutes = end.h * 60 + end.m;
  const before = (h: number) => h * 60 + minute < endMinutes;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const h = (hour % 12) + (meridiem.startsWith('p') ? 12 : 0);
    return before(h) ? { h, m: minute } : null;
  }
  if (hour > 23) return null;
  if (hour > 12 || hour === 0) return before(hour) ? { h: hour, m: minute } : null;
  const am = hour % 12;
  const pm = am + 12;
  const preferred = end.h >= 12 ? [pm, am] : [am, pm];
  const h = preferred.find(before);
  return h === undefined ? null : { h, m: minute };
}

/** Try to parse an entire suffix as a one-off date/time or recurrence phrase. */
function parseSuffix(text: string, now: Date, singleWord: boolean, clockNow: Date = now): ParsedSchedule | null {
  // Recurrence first — it owns the "every"/plural/frequency-word triggers.
  const rec = parseRecurrenceSuffix(text, now);
  if (rec) return rec;

  if (singleWord && !SINGLE_WORD_SAFE.test(text)) return null;

  // One-off date phrase: optional connector, then mirror parseNaturalDate's
  // pipeline but map clock times / day parts to visibility segments.
  //
  // "before" reads as "by" (a deadline, never a window end: see
  // ParsedSchedule.windowStart). "after" is only a schedule with a clock time
  // in it ("after 3pm"), where it sets the window start; "after friday" names
  // no moment to hide the task until, and stays part of the title.
  const between = text.match(BETWEEN_START);
  //
  // "only today" and "expires friday" are the one way to a window end; see
  // ParsedSchedule.windowEnd for why nothing softer is.
  const connector = between ? null : text.match(/^(on|by|due|before|after|expires(?:\s+on)?|only(?:\s+on)?)\s+/);
  const isExpiry = connector != null && /^(?:expires|only)/.test(connector[1]);
  const isDeadlinePhrasing = between != null
    || (connector != null && connector[1] !== 'on' && connector[1] !== 'after' && !isExpiry);
  let t = between ? text.slice(between[0].length) : connector ? text.slice(connector[0].length) : text;
  let segments: TimeOfDay[] = [];
  let hasTime = false;
  let explicitClockTime: ClockTime | null = null;
  let windowStart: string | null = null;
  let windowEnd: string | null = null;
  const clock = extractTime(t);
  if (isExpiry) {
    // The clock time, if any, is when it ends, not when it shows up, so it
    // sets no segment and offers no reminder.
    windowEnd = clock ? hhmm(clock.time) : '23:59';
    if (clock) {
      t = clock.rest;
      hasTime = true;
    }
  } else if (between) {
    if (!clock) return null;
    const start = betweenStart(parseInt(between[1], 10), between[2] ? parseInt(between[2], 10) : 0, between[3], clock.time);
    if (!start) return null;
    windowStart = hhmm(start);
    // The segment follows the start, since that's when the task appears.
    segments = [segmentForHour(start.h)];
    t = clock.rest;
    hasTime = true;
    explicitClockTime = clock.time;
  } else if (connector?.[1] === 'after') {
    if (!clock) return null;
    windowStart = hhmm(clock.time);
    segments = [segmentForHour(clock.time.h)];
    t = clock.rest;
    hasTime = true;
    explicitClockTime = clock.time;
  } else if (clock) {
    segments = [segmentForHour(clock.time.h)];
    t = clock.rest;
    hasTime = true;
    explicitClockTime = clock.time;
  } else {
    const part = extractDayPart(t);
    if (part) {
      segments = [DAY_PART_SEGMENT[part.part]];
      t = part.rest;
      hasTime = true;
    }
  }
  // Same as above — "@" has no meaning in this file and is no longer stripped as noise.
  t = t.replace(/\bat\b/g, ' ').replace(/\bin the\b/g, ' ').replace(/\s+/g, ' ').trim();
  // "this morning", "this evening": the day part was lifted out above, and
  // "this" is what's left of saying it's today.
  if (hasTime && t === 'this') t = '';

  // A set of dates, before the commas go: they're what separates one. Only
  // for a plain or "on" phrase. "by the 10th and the 15th" is two deadlines,
  // which a task can't hold, and a window applies to one day.
  if (t && (!connector || connector[1] === 'on') && !between) {
    const list = parseDateList(t, now, clockNow);
    if (list) {
      return {
        dueDate: dueAt(list[0]),
        extraDates: list.slice(1).map(dueAt),
        timeSegments: segments,
        recurrenceType: 'none',
        recurrenceInterval: 1,
        recurrenceDays: [],
        explicitClockTime,
      };
    }
  }
  t = t.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  const datePart = t ? parseDatePart(t, now, clockNow) : null;
  const titleDate = t && !datePart ? parseTitleDate(t, now, clockNow) : null;
  // Leftover words that aren't a date phrase → this suffix isn't a schedule.
  if (t && !datePart && !titleDate) return null;
  if (!datePart && !titleDate && !hasTime) return null;

  let due: Date;
  if (datePart) {
    due = dueAt(datePart.date);
    if (datePart.explicitTime && segments.length === 0) {
      // "tonight", "in 1 hour" — the embedded time implies a segment.
      segments = [segmentForHour(datePart.date.getHours())];
    }
  } else if (titleDate) {
    due = dueAt(titleDate);
  } else {
    due = dueAt(now); // time-only input ("at 3pm") → today
  }

  return {
    dueDate: due,
    deadline: isDeadlinePhrasing ? due : undefined,
    timeSegments: segments,
    recurrenceType: 'none',
    recurrenceInterval: 1,
    recurrenceDays: [],
    explicitClockTime,
    ...(windowStart ? { windowStart } : {}),
    ...(windowEnd ? { windowEnd } : {}),
  };
}

/**
 * `now` is the logical now (`getLogicalNow`) and `clockNow` the real instant,
 * which "in 2 hours" and "tonight" count from; see parseDatePart. Omit it
 * outside a caller that knows both, where they are the same instant.
 */
export function parseTaskInput(input: string, now: Date = new Date(), clockNow: Date = now): ParsedTaskInput | null {
  if (!input) return null;
  const tokens = [...input.matchAll(/\S+/g)];
  if (tokens.length < 2) return null;

  const lower = input.toLowerCase();
  // An input that is entirely a schedule phrase ("on tuesday", "every monday")
  // stays a literal title — quick add needs a title, and it's almost always
  // mid-typing.
  if (parseSuffix(lower.trim(), now, false, clockNow)) return null;

  for (let i = 1; i < tokens.length; i++) {
    const start = tokens[i].index!;
    const suffix = lower.slice(start).trim();
    const schedule = parseSuffix(suffix, now, i === tokens.length - 1, clockNow);
    if (schedule) {
      // A set of dates can't be a deadline (see parseSuffix), so once "by the
      // 10th and the 15th" has been refused whole, no shorter suffix of it may
      // be read as a set either: each would leave a title ending "pay by" or
      // "pay by the". Nothing is offered rather than half of it.
      if (schedule.extraDates && /\b(?:by|due|before|after|between|the)$/i.test(input.slice(0, start).trim())) return null;
      const cleanTitle = input.slice(0, start).replace(/[\s,;:\-–—]+$/, '');
      if (!cleanTitle) return null;
      return { cleanTitle, matchedText: input.slice(start).trim(), matchStart: start, schedule };
    }
  }
  return null;
}

export interface ParsedLink {
  /** The URL/app-scheme, trailing sentence punctuation trimmed off. */
  url: string;
  /** Input minus the matched URL, whitespace collapsed and trimmed. */
  cleanTitle: string;
  matchStart: number;
  matchEnd: number;
}

// http(s) URLs, or a generic app deep-link scheme ("spotify://...",
// "duolingo://"). Schemes need 2+ letters before "://" so times like "5://x"
// (not realistic, but keeps the pattern honest) can't slip through.
const URL_PATTERN = /(?:https?:\/\/|[a-z][a-z0-9+.-]+:\/\/)\S+/i;
// Trailing punctuation that reads as sentence structure, not part of the URL
// ("check this out: https://example.com." → drop the period).
const TRAILING_PUNCT = /[.,;:!?)\]}'"]+$/;

/**
 * Finds a pasted URL or app link anywhere in a quick-add title and splits it
 * out, mirroring parseTaskInput's schedule-phrase extraction. Unlike the
 * schedule grammar this isn't suffix-anchored — a link can land anywhere in
 * the pasted text — so it's a plain substring search rather than a peeled
 * suffix parse.
 */
export function parseLinkInput(input: string): ParsedLink | null {
  const match = input.match(URL_PATTERN);
  if (!match || match.index === undefined) return null;
  let url = match[0];
  const trimmed = url.match(TRAILING_PUNCT);
  if (trimmed) url = url.slice(0, url.length - trimmed[0].length);
  if (!url) return null;

  const matchStart = match.index;
  const matchEnd = matchStart + url.length;
  // The dropped trailing punctuation is sentence structure, not part of the
  // title either — strip it from the leftover text too.
  const rawEnd = matchStart + match[0].length;
  const cleanTitle = (input.slice(0, matchStart) + input.slice(rawEnd)).replace(/\s+/g, ' ').trim();

  return { url, cleanTitle, matchStart, matchEnd };
}

export interface ParsedPhone {
  /** The number exactly as it was typed, since that's what gets stored. */
  number: string;
  /** Input minus the matched number, whitespace collapsed and trimmed. */
  cleanTitle: string;
  matchStart: number;
  matchEnd: number;
}

// A run of digits and phone punctuation, anchored on digits at both ends so
// the match can't end on a separator that belonged to the sentence. Length is
// only a cheap floor here — looksLikePhoneNumber decides whether the run is
// actually a number rather than a year, a price or a list of times.
const PHONE_PATTERN = /[+(]?\d[\d\s().-]{5,}\d/;

/**
 * Finds a phone number pasted or dictated into a quick-add title — "call the
 * surgery 020 7946 0018" — and splits it out, exactly as parseLinkInput does
 * for a URL. Same "anywhere in the text, not suffix-anchored" rule — and
 * fires even when the number is the whole input so far (nothing else typed
 * yet), same as parseLinkInput.
 */
export function parsePhoneInput(input: string): ParsedPhone | null {
  const match = input.match(PHONE_PATTERN);
  if (!match || match.index === undefined) return null;
  const number = match[0];
  if (!looksLikePhoneNumber(number)) return null;

  const matchStart = match.index;
  const matchEnd = matchStart + number.length;
  const cleanTitle = (input.slice(0, matchStart) + input.slice(matchEnd)).replace(/\s+/g, ' ').trim();

  return { number, cleanTitle, matchStart, matchEnd };
}

export interface ParsedEmail {
  /** The address exactly as it was typed, since that's what gets stored. */
  address: string;
  /** Input minus the matched address, whitespace collapsed and trimmed. */
  cleanTitle: string;
  matchStart: number;
  matchEnd: number;
}

// A local part, "@", and a dotted domain ending in a 2+ letter TLD — enough to
// catch "jane@example.com" typed or dictated into a title without trying to be
// a full RFC 5322 validator. mailtoUrl (src/utils/email.ts) is equally
// permissive at the one point a machine has to read the stored address.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/**
 * Finds an email address pasted or dictated into a quick-add title — "email
 * jane@example.com about the invoice" — and splits it out, exactly as
 * parsePhoneInput does for a number. Same "anywhere in the text, not
 * suffix-anchored" rule, and fires even when the address is the whole input
 * so far.
 */
export function parseEmailInput(input: string): ParsedEmail | null {
  const match = input.match(EMAIL_PATTERN);
  if (!match || match.index === undefined) return null;
  const address = match[0];

  const matchStart = match.index;
  const matchEnd = matchStart + address.length;
  const cleanTitle = (input.slice(0, matchStart) + input.slice(matchEnd)).replace(/\s+/g, ' ').trim();

  return { address, cleanTitle, matchStart, matchEnd };
}

export type ContactIntent = 'phone' | 'email';

// Only the leading word counts — "Call Kristen" is an instruction, "ask her
// to call me back" merely mentions one mid-sentence.
const CONTACT_INTENT_PATTERN = /^(call|text|email|phone|message)\b/i;

/**
 * Whether a title opens with a contact verb the task has no data to back up
 * — "Call Kristen", "Text the plumber", "Email the landlord" — so a nudge
 * toward setting Task.phoneNumber/emailAddress (phone.ts/email.ts) is worth
 * showing. This only reads the title; callers decide whether the relevant
 * field is already set before acting on the result.
 */
export function detectContactIntent(title: string): ContactIntent | null {
  const match = title.trim().match(CONTACT_INTENT_PATTERN);
  if (!match) return null;
  return match[1].toLowerCase() === 'email' ? 'email' : 'phone';
}

export interface ParsedDuration {
  /** The countdown target in whole minutes. */
  minutes: number;
  /** Input minus the matched phrase, whitespace collapsed and trimmed. */
  cleanTitle: string;
  matchStart: number;
  matchEnd: number;
}

// "for 15 minutes", "for 1.5 hours", "for 45m", "for 2 hrs".
//
// The leading "for" is doing real work and isn't optional: without it, "in 1
// hour" and "15 min" would collide head-on with the relative-date grammar
// above, where those already mean *when* the task is due rather than how long
// it should run. "for" is unambiguous — nobody writes "pay rent for 2 hours"
// meaning a due date.
const DURATION_PATTERN = /\bfor\s+(\d+(?:\.\d+)?)\s*(minutes|minute|mins|min|m|hours|hour|hrs|hr|h)\b/i;

/**
 * Pulls a duration phrase out of a quick-add title, so "play violin for 15
 * minutes" becomes a 15-minute timed task titled "play violin". Follows
 * parseLinkInput's shape rather than the suffix-anchored schedule parse — the
 * phrase can sit anywhere in the input, and it's a separate concern from *when*
 * the task is due.
 */
export function parseDurationInput(input: string): ParsedDuration | null {
  const match = input.match(DURATION_PATTERN);
  if (!match || match.index === undefined) return null;

  const value = parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const isHours = /^h/i.test(match[2]);
  const minutes = Math.round(isHours ? value * 60 : value);
  // A rounded-to-nothing duration ("for 0.2 min") isn't a timer.
  if (minutes < 1) return null;
  // Guard against a fat-fingered "for 9999 hours" becoming a real countdown.
  if (minutes > 24 * 60) return null;

  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;
  const cleanTitle = (input.slice(0, matchStart) + input.slice(matchEnd)).replace(/\s+/g, ' ').trim();

  return { minutes, cleanTitle, matchStart, matchEnd };
}

/** One "->"-separated segment of a typed chain, already stripped of its own duration/link phrase. */
export interface ParsedChainStep {
  title: string;
  estimatedMinutes: number | null;
  linkUrl: string | null;
}

export interface ParsedChainInput {
  /** First entry becomes the task's own title, the rest become `chainItems`. Always 2+. */
  steps: ParsedChainStep[];
  /** The whole trimmed input — a chain replaces the title outright rather than trimming a phrase off it. */
  matchedText: string;
  matchStart: number;
}

/**
 * Splits a quick-add title on "->" into an ad hoc chain: "pick up dry
 * cleaning -> drop off library books -> walk the dog" becomes a 3-step
 * chain, one row per arrow-delimited segment. Unlike every other parser in
 * this file, this doesn't strip a phrase out of the title — a detected chain
 * replaces the title wholesale, since the whole line is the thing being
 * restructured, not one token within it.
 *
 * Each step is independently run through `parseDurationInput` and
 * `parseLinkInput` against its own segment text alone — "call the vet for 10
 * min -> drop off the package https://usps.com/track" gives the first step a
 * 10-minute estimate and the second its own link, rather than either phrase
 * applying to the chain as a whole. This is deliberate: `ChainItem` has no
 * category/tag/priority/date fields of its own (those ride on the `Task` row
 * once, for the whole chain — see the "Chains" note in CLAUDE.md), so a
 * sigil token or schedule phrase anywhere in the line is left for the
 * existing whole-title parsers to resolve task-wide, same as it already does
 * without any "->" present. Only duration and link have a natural per-step
 * home, which is why they're the two pulled out here.
 *
 * A step that trims to nothing (a doubled arrow, a trailing "->", or a step
 * that was *only* a duration/link phrase with no name of its own) refuses
 * the whole match rather than silently dropping a step — same reasoning
 * `parseSupplyInput` gives for refusing outright instead of guessing.
 */
export function parseChainInput(input: string): ParsedChainInput | null {
  if (!input.includes('->')) return null;
  const rawParts = input.split(/\s*->\s*/);
  const steps: ParsedChainStep[] = [];
  for (const raw of rawParts) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    let stepTitle = trimmed;
    let estimatedMinutes: number | null = null;
    let linkUrl: string | null = null;
    const duration = parseDurationInput(stepTitle);
    if (duration) {
      estimatedMinutes = duration.minutes;
      stepTitle = duration.cleanTitle;
    }
    const link = parseLinkInput(stepTitle);
    if (link) {
      linkUrl = link.url;
      stepTitle = link.cleanTitle;
    }
    if (!stepTitle) return null;
    steps.push({ title: stepTitle, estimatedMinutes, linkUrl });
  }
  if (steps.length < 2) return null;
  return { steps, matchedText: input.trim(), matchStart: 0 };
}

export interface ParsedSupply {
  /** How many units are on hand right now. */
  count: number;
  /** What they are ("filters"), or null when the phrase named no unit. */
  unit: string | null;
  /** Input minus the matched phrase, whitespace collapsed and trimmed. */
  cleanTitle: string;
  matchStart: number;
  matchEnd: number;
}

/**
 * Units that mean *time remaining*, not a stock of anything.
 *
 * "finish the report 3 days left" is the one likely false positive this grammar
 * has, and it's a bad one: read as a supply it would set a count of 3 and leave
 * a title reading "finish the report days". The whole match is refused rather
 * than the unit being dropped, for exactly that reason.
 *
 * The recurrence grammar already owns these words in its own end-condition
 * clause ("for 3 weeks"), so refusing them here also keeps the two from
 * disagreeing about one phrase.
 */
const SUPPLY_TIME_UNITS = new Set([
  'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
  'hour', 'hours', 'hr', 'hrs', 'minute', 'minutes', 'min', 'mins',
  'second', 'seconds', 'sec', 'secs',
]);

// "6 filters left", "30 left", "12 pairs left".
//
// The trailing "left" is doing the same work the duration pattern's leading
// "for" does, and is just as non-optional: a bare "6 filters" in a title is a
// shopping quantity, and "6" is a word in a sentence. "left" is the one English
// word that turns a number into a stock, and it is also — deliberately — the
// exact word `formatSupplyLeft` already uses to render one ("3 filters left"),
// so the thing you type is the thing the row shows back.
//
// A sigil was the obvious alternative and is the wrong shape for this file: the
// grammar here reads English (see titleRules.ts on why that distinction
// matters), the only sigil is "#", and "@" is reserved. "x6" was the other
// candidate and collides semantically rather than syntactically — "N×" is
// already how the app *renders* a daily target (see formatQuotaTarget), so
// "x6" in a title reads as "six times a day" to anyone who has seen one.
const SUPPLY_PATTERN = /(?<!\w)(\d{1,4})\s+(?:([a-z][a-z0-9-]{0,15})\s+)?left(?!\w)/i;

/**
 * Pulls a supply phrase out of a quick-add title, so "replace cpap filter 6
 * filters left" becomes a task titled "replace cpap filter" holding six
 * filters.
 *
 * Follows `parseDurationInput`'s shape rather than the suffix-anchored schedule
 * parse, and that matters more here than it does there: **a supply is only
 * meaningful on a repeating task** (`canHoldSupply`), so the two have to be
 * sayable in one line. Because this phrase can sit anywhere, the two compose in
 * either order — the schedule parser finds "every month" as a suffix whether
 * the supply phrase precedes it or follows it, and whichever tooltip is offered
 * first rewrites the title so the other one can fire on the next keystroke.
 *
 * Deliberately does **not** import `supply.ts` for its clamps. That module
 * reaches `dateUtils` and so the SQLite layer, which this one stays free of to
 * remain pure and testable without native mocks (see the header note). The
 * bound here is only a sanity ceiling; the real range lives in
 * `clampSupplyCount`, which every write already goes through.
 */
export function parseSupplyInput(input: string): ParsedSupply | null {
  const match = input.match(SUPPLY_PATTERN);
  if (!match || match.index === undefined) return null;

  const count = parseInt(match[1], 10);
  // Zero is a real supply on a task that already has one, but nobody sets one
  // up by typing "0 left" — read here it is far more likely to be a sentence.
  if (!Number.isFinite(count) || count < 1) return null;

  const rawUnit = match[2] ?? null;
  if (rawUnit && SUPPLY_TIME_UNITS.has(rawUnit.toLowerCase())) return null;

  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;
  const cleanTitle = (input.slice(0, matchStart) + input.slice(matchEnd))
    // A phrase lifted out of the middle leaves its punctuation behind —
    // "replace filter, 6 filters left, every month" would otherwise clean to a
    // title with a doubled comma in it.
    .replace(/\s*,\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();

  return { count, unit: rawUnit ? rawUnit.toLowerCase() : null, cleanTitle, matchStart, matchEnd };
}

export interface ParsedTarget {
  /** How many times per period, already inside the target stepper's range. */
  count: number;
  /**
   * 'week' only when the phrase said so ("3 times a week", "twice weekly").
   * A bare "3 times" is 'day', which a caller with a weekly repeat already set
   * is free to read as the week instead.
   */
  period: QuotaPeriod;
  /** Input minus the matched phrase, whitespace collapsed and trimmed. */
  cleanTitle: string;
  matchStart: number;
  matchEnd: number;
}

// Kept in step with MIN_TARGET_COUNT / MAX_TARGET_COUNT in taskKinds.ts, which
// this file can't import for the reason parseSupplyInput gives about supply.ts.
// Out of range is refused rather than clamped: "1 time" isn't a quota, and
// "500 times" is more likely a sentence than a habit.
const TARGET_MIN = 2;
const TARGET_MAX = 99;

// "8 times", "8 times a day", "eight times daily", "8x", "twice a day",
// "3 times a week", "twice weekly".
//
// "times" (or a glued-on "x"/"×", which is how the app itself renders a daily
// target: see formatQuotaTarget) is what turns a number into a count of
// repetitions. "8 x" with a space is deliberately not accepted, since that's a
// dimension ("8 x 10 frame") far more often than a count.
//
// A preceding "for" is refused: "every day for 5 times" is the recurrence
// grammar's own end condition (extractEndCondition), and reading it here would
// turn "stop after five" into "five a day".
const TARGET_PATTERN = new RegExp(
  `(?<!\\bfor\\s+)(?<!\\w)(?:(\\d{1,3}|${NUMBER_WORD_ALT})\\s+times|(\\d{1,3})[x×]|(twice|thrice))`
    + `(?:\\s+(?:a|per|each)\\s+(day|week)|\\s+(daily|weekly))?(?!\\w)`,
  'i',
);

// What follows the phrase when it's counting across a period a target can't
// have. Day and week are the two `QuotaPeriod`s; "twice a month" is a real
// thing to want, but a daily or weekly target of 2 would be the wrong answer
// to it, so the whole match is refused.
const TARGET_UNSUPPORTED_PERIOD = /^\s*(?:(?:a|per|each|every)\s+(?:month|year|fortnight)|monthly|yearly|annually|biweekly)\b/i;

/**
 * Pulls a repetition count out of a quick-add title, so "drink water 8 times a
 * day" becomes a daily target of 8 titled "drink water".
 *
 * Same shape as `parseDurationInput`: the phrase can sit anywhere, and the
 * schedule parser keeps its own suffix. "8 times daily" is read here whole,
 * but "8 times every day" leaves "every day" for the schedule tooltip, and
 * whichever is accepted first shortens the title so the other fires next.
 */
export function parseTargetInput(input: string): ParsedTarget | null {
  const match = input.match(TARGET_PATTERN);
  if (!match || match.index === undefined) return null;

  let count: number;
  if (match[3]) count = match[3].toLowerCase() === 'twice' ? 2 : 3;
  else count = parseCount((match[1] ?? match[2]).toLowerCase());
  if (!Number.isFinite(count) || count < TARGET_MIN || count > TARGET_MAX) return null;

  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;
  if (TARGET_UNSUPPORTED_PERIOD.test(input.slice(matchEnd))) return null;
  const periodWord = (match[4] ?? match[5] ?? '').toLowerCase();
  const period: QuotaPeriod = periodWord.startsWith('week') ? 'week' : 'day';

  const cleanTitle = (input.slice(0, matchStart) + input.slice(matchEnd))
    .replace(/\s*,\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/ ,/g, ',')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
  // "8 times" on its own names no task.
  if (!cleanTitle) return null;

  return { count, period, cleanTitle, matchStart, matchEnd };
}

export interface ParsedEstimate {
  /** The estimate in whole minutes. */
  minutes: number;
  /** Input minus the matched phrase, whitespace collapsed and trimmed. */
  cleanTitle: string;
  matchStart: number;
  matchEnd: number;
}

// "~30m", "~ 1.5 hours", "takes 30 min", "takes about an hour".
//
// Kept apart from DURATION_PATTERN's "for 15 minutes" on purpose: that one
// makes a timer, which counts down and is a kind of task of its own, while
// this only says how long the work should take. "~" is how an estimate is
// written by hand, and "takes" is how it's said.
const ESTIMATE_PATTERN = /(?:(?<![\w~])~\s*|\btakes\s+(?:about\s+|around\s+)?)(\d+(?:\.\d+)?|an?)\s*(minutes|minute|mins|min|m|hours|hour|hrs|hr|h)\b/i;

/**
 * Pulls an estimate out of a quick-add title, so "clean the garage ~2h"
 * becomes a two-hour task titled "clean the garage". Same shape as
 * `parseDurationInput`, and the same bounds for the same reasons.
 */
export function parseEstimateInput(input: string): ParsedEstimate | null {
  const match = input.match(ESTIMATE_PATTERN);
  if (!match || match.index === undefined) return null;

  const raw = match[1].toLowerCase();
  // "an hour", "a minute": only after "takes", since "~a h" isn't anything.
  if ((raw === 'a' || raw === 'an') && !/^takes/i.test(match[0])) return null;
  const value = raw === 'a' || raw === 'an' ? 1 : parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return null;

  const isHours = /^h/i.test(match[2]);
  const minutes = Math.round(isHours ? value * 60 : value);
  if (minutes < 1 || minutes > 24 * 60) return null;

  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;
  const cleanTitle = (input.slice(0, matchStart) + input.slice(matchEnd)).replace(/\s+/g, ' ').trim();
  if (!cleanTitle) return null;

  return { minutes, cleanTitle, matchStart, matchEnd };
}

// "remind me to call mom at 4pm" — the words asking for a reminder, which are
// a request rather than part of the task's name.
const REMIND_PREFIX = /^\s*(?:remind me to|remind me about|remind me|reminder to|reminder:|don'?t forget to)\s+/i;

/**
 * Strips a leading "remind me to" from a title. Not a tooltip of its own: the
 * schedule tooltip uses it when accepting a phrase with a clock time in it,
 * because "remind me to … at 4pm" names both the reminder and its moment.
 * Without a time there's no moment to remind at, so a caller leaves the title
 * alone rather than dropping the words and the request with them.
 */
export function stripRemindPrefix(input: string): string | null {
  const match = input.match(REMIND_PREFIX);
  if (!match) return null;
  const rest = input.slice(match[0].length).trim();
  return rest || null;
}

export interface ParsedCategoryAndTags {
  /** The first token's category, if any matched — a task has one. */
  category: string | null;
  /** Every other matching token's canonical tag name, in order, deduplicated. */
  tags: string[];
  /** Input minus every matched "#word" token, whitespace collapsed and trimmed. */
  cleanTitle: string;
  /** Start of the first matched token — drives the tooltip highlight. */
  matchStart: number;
  matchEnd: number;
}

// A "#" immediately followed by a word, not itself preceded by a word
// character (so "C#" doesn't false-positive) — CLAUDE.md's own quick-add
// example ("pay rent tmrw 5p #home") is a category tag, and the same marker
// doubles for tags rather than "@tag" getting a second one: "@" is a much
// more natural fit for a future person-assignment feature, and "#" is
// already the more universal tag/category marker. Matched anywhere in the
// text, like parseLinkInput/parsePhoneInput, not suffix-anchored, and
// globally rather than once, since more than one "#word" can appear.
const CATEGORY_OR_TAG_TOKEN_PATTERN = /(?<!\w)#([a-z][\w-]*)/gi;

// Below this many characters a prefix match is too eager — "#c" is still
// closer to "just started typing" than to a chosen category, and the
// shorter the token the more likely it prefixes several categories at once
// anyway. Chosen to still light up well before the word is finished
// ("#chore" already gets there for "Chores").
const MIN_CATEGORY_PREFIX_LENGTH = 3;

/**
 * Finds every "#word" token in a quick-add title and, for each one in turn,
 * tries it against known categories first and known tags second — so
 * "clean kitchen #home #chores" reads "home" as the category (the first
 * token to claim that still-open slot) and "chores" as a tag. A task has one
 * category, so once it's claimed, every further "#word" is only ever tried
 * as a tag. `categories`/`tags` are passed in rather than read from a store,
 * keeping this module free of any store dependency (see the header note);
 * matching is case-insensitive so "#Home" and "#home" both resolve to the
 * one category.
 *
 * The category slot also accepts an unambiguous *prefix* of a category name
 * ("#chore" resolving to "Chores") rather than requiring the full word —
 * this is what lets the quick-add tooltip fire while the word is still being
 * typed instead of only on the keystroke that completes it. It stays exact
 * for tags: this module has no read on which "#word" the user is reaching
 * for, and a category is what the tooltip is actually built to surface, so
 * that's the one slot worth the false-positive risk of guessing early. An
 * exact tag still outranks a category prefix guess (see below), and a
 * prefix that matches more than one category is left unresolved rather than
 * guessing — "#wor" with both "Work" and "Worship" registered should keep
 * typing, not lock in the wrong one.
 *
 * Deliberately doesn't create a category or tag from an unrecognized token —
 * a typo or an unrelated "#" in the title (e.g. a hashtag someone's pasting)
 * is left as literal text rather than silently minting something new.
 *
 * Fires even when stripping the token leaves an empty `cleanTitle` — typing
 * the category first ("#home", nothing else yet) is exactly that state, and
 * the tooltip should still offer it. The title itself still can't be saved
 * blank; that's `handleAdd`'s `!title.trim()` guard, not this function's.
 */
export function parseCategoryAndTagsInput(
  input: string,
  categories: string[],
  tags: string[]
): ParsedCategoryAndTags | null {
  const categoryByLower = new Map(categories.map(c => [c.toLowerCase(), c]));
  const tagByLower = new Map(tags.map(t => [t.toLowerCase(), t]));

  let category: string | null = null;
  const matchedTags: string[] = [];
  const consumed: { start: number; end: number }[] = [];

  for (const m of input.matchAll(CATEGORY_OR_TAG_TOKEN_PATTERN)) {
    if (m.index === undefined) continue;
    const token = m[1].toLowerCase();
    const start = m.index;
    const end = start + m[0].length;

    if (category === null && categoryByLower.has(token)) {
      category = categoryByLower.get(token)!;
      consumed.push({ start, end });
      continue;
    }
    // An exact tag still outranks a guessed category prefix — "#errand" is a
    // known tag in its own right even though it also prefixes "Errands", and
    // guessing the category there would take the word away from the tag it
    // was actually typed to name.
    const tagName = tagByLower.get(token);
    if (tagName) {
      matchedTags.push(tagName);
      consumed.push({ start, end });
      continue;
    }
    if (category === null && token.length >= MIN_CATEGORY_PREFIX_LENGTH) {
      const prefixMatches = categories.filter(c => c.toLowerCase().startsWith(token));
      if (prefixMatches.length === 1) {
        category = prefixMatches[0];
        consumed.push({ start, end });
        continue;
      }
    }
    // else: unrecognized "#word" — leave as literal text
  }

  if (category === null && matchedTags.length === 0) return null;

  let cleanTitle = input;
  for (let i = consumed.length - 1; i >= 0; i--) {
    cleanTitle = cleanTitle.slice(0, consumed[i].start) + cleanTitle.slice(consumed[i].end);
  }
  cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();

  return {
    category,
    tags: [...new Set(matchedTags)],
    cleanTitle,
    matchStart: consumed[0].start,
    matchEnd: consumed[0].end,
  };
}

export interface ParsedProject {
  projectId: string;
  /** The project's own title, for the tooltip. */
  title: string;
  /** Input minus the matched "+word" token, whitespace collapsed and trimmed. */
  cleanTitle: string;
  matchStart: number;
  matchEnd: number;
}

// "+" immediately followed by a word that starts with a letter, not itself
// preceded by a word character or another "+": "+trip" and "+japan-trip", but
// not "+1", "2+2" or "C++". "#" is category-or-tag and "@" is a person (see
// PERSON_TOKEN_PATTERN), so this is the third and last sigil.
const PROJECT_TOKEN_PATTERN = /(?<![\w+])\+([a-z][\w-]*)/gi;

/** A title with case, spaces and punctuation gone: "Japan Trip!" → "japantrip". */
function projectKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Pulls a "+project" token out of a quick-add title, so "book hotel +japan"
 * files the task under "Japan Trip".
 *
 * Matched the way "#" matches a category, and for the same reason (the
 * tooltip can fire mid-word): an exact name first, spaces and punctuation
 * ignored so "+japantrip" and "+japan-trip" both find "Japan Trip"; then an
 * unambiguous prefix of the whole name; then an unambiguous prefix of any one
 * word in it, so "+trip" finds "Japan Trip" too. Each tier needs exactly one
 * project, and a prefix needs three characters. Two candidates means keep
 * typing, never a guess. Only the first "+word" that resolves counts: a task
 * has one project.
 *
 * `projects` is the live set the caller wants offered (archived and finished
 * ones left out), passed in to keep this module store-free.
 */
export function parseProjectInput(input: string, projects: { id: string; title: string }[]): ParsedProject | null {
  for (const m of input.matchAll(PROJECT_TOKEN_PATTERN)) {
    if (m.index === undefined) continue;
    const token = projectKey(m[1]);
    if (!token) continue;
    const exact = projects.filter(p => projectKey(p.title) === token);
    let hit = exact.length === 1 ? exact[0] : null;
    if (!hit && exact.length === 0 && token.length >= MIN_CATEGORY_PREFIX_LENGTH) {
      const whole = projects.filter(p => projectKey(p.title).startsWith(token));
      if (whole.length === 1) hit = whole[0];
      else if (whole.length === 0) {
        const word = projects.filter(p => p.title.toLowerCase().split(/[^a-z0-9]+/).some(w => w.startsWith(token)));
        if (word.length === 1) hit = word[0];
      }
    }
    if (!hit) continue;
    const matchStart = m.index;
    const matchEnd = matchStart + m[0].length;
    const cleanTitle = (input.slice(0, matchStart) + input.slice(matchEnd)).replace(/\s+/g, ' ').trim();
    return { projectId: hit.id, title: hit.title, cleanTitle, matchStart, matchEnd };
  }
  return null;
}

export interface ParsedWaitingOn {
  /** The task this one would wait on. */
  taskId: string;
  /** Its title as stored, for the tooltip. */
  title: string;
  /** Input minus "after …", trailing punctuation trimmed. */
  cleanTitle: string;
  matchStart: number;
  matchEnd: number;
}

// Words that carry nothing about which task is meant, on either side: "after
// the taxes are done" names the same task as "after taxes".
const WAITING_STOPWORDS = new Set([
  'a', 'an', 'the', 'my', 'our', 'to', 'for', 'from', 'of', 'with', 'on', 'in', 'at', 'and',
  'is', 'are', 'its', "it's", 'done', 'finished', 'complete', 'completed', 'i', 'we',
]);

function waitingWords(text: string): string[] {
  return text.toLowerCase()
    // "W-2" and "W2" are one word, and so are "e-mail" and "email".
    .replace(/(\w)[-'’](\w)/g, '$1$2')
    .split(/[^a-z0-9]+/)
    .filter(w => w && !WAITING_STOPWORDS.has(w));
}

/**
 * "file taxes after get W-2" → waits on the task "Get W-2 from employer".
 *
 * Fuzzy, but only as far as it can stay sure, because what it sets holds the
 * task back until the other one is done, which is costly to get silently
 * wrong. A candidate matches when **every** word after "after" starts a
 * different word of its title (order free, so "after w2 get" works too), and
 * those words cover **at least half** of the title's own words. Exactly one
 * candidate has to match: two means the phrase didn't pick one, and nothing
 * is offered. Filler on both sides ("the", "my", "is done") is ignored.
 *
 * The half rule is what keeps "go for a walk after work" from naming "Finish
 * work report" (one word of three). A clock time, a date or "completion" never
 * reaches here: the schedule tooltip claims those first.
 *
 * `candidates` are the tasks the caller is willing to wait on (live, top
 * level), passed in to keep this module store-free.
 */
export function parseWaitingOnInput(input: string, candidates: { id: string; title: string }[]): ParsedWaitingOn | null {
  const re = /\bafter\s+/gi;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(input); m; m = re.exec(input)) last = m;
  if (!last) return null;

  const cleanTitle = input.slice(0, last.index).replace(/[\s,;:\-–—]+$/, '');
  if (!cleanTitle) return null;
  const phrase = waitingWords(input.slice(last.index + last[0].length));
  if (phrase.length === 0 || phrase.some(w => w.length < 2 && !/^\d$/.test(w))) return null;

  const matches = candidates.filter(c => {
    const words = waitingWords(c.title);
    if (words.length === 0) return false;
    const used = new Set<number>();
    for (const w of phrase) {
      // Prefer an exact word, then the first unused word it starts.
      let i = words.findIndex((t, j) => !used.has(j) && t === w);
      if (i < 0) i = words.findIndex((t, j) => !used.has(j) && t.startsWith(w));
      if (i < 0) return false;
      used.add(i);
    }
    return used.size * 2 >= words.length;
  });
  if (matches.length !== 1) return null;

  return {
    taskId: matches[0].id,
    title: matches[0].title,
    cleanTitle,
    matchStart: last.index,
    matchEnd: input.trimEnd().length,
  };
}

export interface ParsedSubtasks {
  /** Each item, in the order typed. Always 2+. */
  subtasks: string[];
  /** What came before the colon: the parent task's title. */
  cleanTitle: string;
  matchStart: number;
  matchEnd: number;
}

/** Longer than this and an "item" is a sentence, not a step. */
const SUBTASK_MAX_LENGTH = 60;

/**
 * "pack: socks, charger, passport" → a task titled "pack" with three
 * subtasks. The same idea as "->" making chain steps, for things done in any
 * order rather than one after another.
 *
 * Needs a colon followed by a space ("3:30" and "https:" don't qualify), then
 * two or more items separated by commas, with an optional "and" before the
 * last. One item ("Re: invoice") isn't a list. An empty item, or one long
 * enough to be a sentence, refuses the lot rather than guessing which part
 * was meant, the same call `parseChainInput` makes.
 */
export function parseSubtasksInput(input: string): ParsedSubtasks | null {
  const colon = input.match(/:\s+/);
  if (!colon || colon.index === undefined) return null;
  const cleanTitle = input.slice(0, colon.index).trim();
  if (!cleanTitle) return null;
  const rest = input.slice(colon.index + colon[0].length).trim();
  if (!rest.includes(',')) return null;
  const items = rest.split(/\s*,\s*(?:and\s+|&\s*)?|\s+(?:and|&)\s+(?=[^,]*$)/).map(i => i.trim());
  if (items.length < 2 || items.some(i => !i || i.length > SUBTASK_MAX_LENGTH)) return null;
  return { subtasks: items, cleanTitle, matchStart: colon.index, matchEnd: input.trimEnd().length };
}

export interface ParsedAvoid {
  /** The opening words that say it ("Don't", "No snacking"), for the highlight. */
  matchStart: number;
  matchEnd: number;
}

// Words ending in "ing" that aren't something a person does: "no morning
// meetings" and "stop the bleeding" aside, these are the ones that turn up.
const NOT_GERUNDS = new Set([
  'thing', 'things', 'nothing', 'something', 'anything', 'everything', 'king', 'ring', 'spring',
  'string', 'wing', 'morning', 'evening', 'ceiling', 'building', 'meeting', 'meetings', 'wedding',
  'ping', 'sling', 'swing', 'sting', 'bring', 'sing',
]);

/**
 * "Don't check Twitter", "No snacking after 8pm", "Quit vaping": a habit
 * about *not* doing something, which the app keeps as a task that is never
 * completed (`Task.polarity`, see negativeHabits.ts).
 *
 * Unlike every other parser here this strips nothing: the words are the
 * habit's name, so the title stays exactly as typed and only the Goal flips.
 * "Don't forget to …" is the one opening left out: that's a reminder.
 *
 * Deliberately narrow, since a plain task read this way can no longer be
 * checked off. "don't", "do not" and "never" count on their own. "no",
 * "stop", "quit" and "avoid" only count before a word ending in "ing" ("no
 * snacking", "stop vaping"), which leaves "stop by the bank", "no school
 * friday" and "avoid traffic on 95" alone. Only at the start of the title.
 */
export function parseAvoidInput(input: string): ParsedAvoid | null {
  const lead = input.match(/^\s*/)![0].length;
  const rest = input.slice(lead);
  // "Don't forget to …" is a reminder (see REMIND_PREFIX), not a habit.
  const plain = rest.match(/^(?:don'?t|don’t|do not|never)\s+(?!forget\b)(?=[a-z])/i);
  if (plain) return { matchStart: lead, matchEnd: lead + plain[0].trimEnd().length };
  const gerund = rest.match(/^(?:no|stop|quit|avoid)\s+([a-z]+ing)\b/i);
  if (gerund && !NOT_GERUNDS.has(gerund[1].toLowerCase())) {
    return { matchStart: lead, matchEnd: lead + gerund[0].length };
  }
  return null;
}

export interface ParsedPriority {
  priority: Priority;
  /** Input minus the matched "!word" token, whitespace collapsed and trimmed. */
  cleanTitle: string;
  matchStart: number;
  matchEnd: number;
}

// "!" immediately followed by a word, not itself preceded by a word character
// — same shape as CATEGORY_OR_TAG_TOKEN_PATTERN's "#word", using "!" since
// nothing else in this grammar claims it and it's the common urgency marker
// elsewhere. Matched once rather than globally: a task has one priority, so
// unlike "#word" there's no second slot a later token could fill.
const PRIORITY_TOKEN_PATTERN = /(?<!\w)!([a-z]+)/i;

// Below this many characters a prefix match is too eager — "!m" reads closer
// to a stray exclamation than a chosen priority. Two is enough for every
// candidate below to already be unambiguous (lo/me/hi/ur), unlike
// MIN_CATEGORY_PREFIX_LENGTH's three against an open-ended category list.
const MIN_PRIORITY_PREFIX_LENGTH = 2;

const PRIORITY_WORDS: { word: string; value: Priority }[] = [
  { word: 'low', value: 1 },
  { word: 'medium', value: 2 },
  { word: 'high', value: 3 },
  { word: 'urgent', value: 4 },
];

/**
 * Finds a "!word" token in a quick-add title and resolves it to a priority —
 * "!high", "!urg" and "!ur" all resolve to Urgent, matched the same
 * unambiguous-prefix way "#word" resolves to a category
 * (parseCategoryAndTagsInput), just against this fixed four-word set instead
 * of one built from the user's own categories. A prefix matching more than
 * one word (there are none among these four past the two-character floor
 * above) or no word at all is left as literal text rather than guessed.
 *
 * Only the first "!word" in the title is tried — a task has one priority, so
 * there's no second slot for a later token to fill the way a second "#word"
 * fills the tag list.
 *
 * Deliberately has no "!none"/"!clear" to unset a priority: nothing else in
 * this sigil grammar removes a value that's already set, and a title being
 * typed fresh has no priority yet to clear.
 */
export function parsePriorityInput(input: string): ParsedPriority | null {
  const match = input.match(PRIORITY_TOKEN_PATTERN);
  if (!match || match.index === undefined) return null;

  const token = match[1].toLowerCase();
  if (token.length < MIN_PRIORITY_PREFIX_LENGTH) return null;

  const hits = PRIORITY_WORDS.filter(p => p.word.startsWith(token));
  if (hits.length !== 1) return null;

  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;
  const cleanTitle = (input.slice(0, matchStart) + input.slice(matchEnd))
    .replace(/\s+/g, ' ')
    .trim();

  return { priority: hits[0].value, cleanTitle, matchStart, matchEnd };
}

/** One resolved "@name" token: where it sits in the title, and who it names. */
export interface PersonMention {
  start: number;
  end: number;
  personId: string;
}

/** The shape `matchPersonMentions` matches against: an id and the names it answers to. */
export interface PersonToken {
  id: string;
  name: string;
  nickname: string;
  /**
   * Optional so every existing caller (and test fixture) that only ever named
   * people keeps compiling. `'business'` skips the first-word fallback below
   * — a company name's first word isn't a first name, and "Eye Q" answering to
   * "@eye" is exactly the bug a business marker exists to avoid.
   */
  kind?: 'individual' | 'business';
}

/**
 * A `PersonGroup`, as `matchPersonMentions` needs it: a name to answer to and
 * the ids it expands into. "@household" produces one `PersonMention` per
 * `memberIds` entry rather than a mention shape of its own — a group is
 * several people, not a new kind of thing a title can name.
 */
export interface GroupMentionToken {
  id: string;
  name: string;
  memberIds: string[];
}

/**
 * A "@name" token more than one person answers to, offered so a caller can
 * show a pick-one list instead of just refusing. See `findAmbiguousMention`.
 */
export interface AmbiguousMention {
  start: number;
  end: number;
  /** The token text, lowercased, without the "@" — the key `overrides` (here
   * and in `applyMentionOverrides`) is keyed by. */
  token: string;
  candidates: PersonToken[];
}

// An "@" immediately followed by a word, not itself preceded by a word
// character, so an email address in a title ("mail bob@example.com") does not
// false-positive on its domain. The comment on SUPPLY_PATTERN above reserved
// this sigil for exactly this; "#" stays category-or-tag.
//
// Apostrophes and hyphens are in the character class because names have them
// ("@mary-jane", "@o'brien"). Matched globally rather than once, since a plan
// can name several people.
const PERSON_TOKEN_PATTERN = /(?<!\w)@([a-z][\w'-]*)/gi;

// Below this many characters, a prefix is too likely to land on more than one
// name to be worth trying — the same floor calendarHistory.ts's
// MIN_CALENDAR_NAME_LENGTH uses, though that one guards a guess made from text
// written for another purpose, not a deliberate "@" token.
const MIN_PREFIX_LENGTH = 3;

/**
 * The three ways a person answers to a token — full name, nickname, and the
 * first word of the name — indexed once per call so `matchPersonMentions` and
 * `findAmbiguousMention` don't each rebuild it themselves. `toCandidates`
 * turns a set of ids back into `PersonToken`s in the person's own list order,
 * the order a pick-one list is offered in.
 */
/**
 * What typing a suggestion rewrites the token to: the nickname if there is
 * one, else the whole name. `matchPersonMentions` reads a multi-word name
 * spelled out after the "@" ("@Eye Q"), so nothing is cut down to a first word
 * the person never chose. Shared by `getMentionSuggestions` and
 * `getEditorMentionSuggestions`.
 */
function mentionResolveKey(person: PersonToken): string {
  const nickname = person.nickname.trim();
  return nickname || person.name.trim();
}

function buildPersonNameIndex(people: PersonToken[]) {
  // Built once per call rather than per token: a name can be reached three ways
  // and the last writer would otherwise depend on iteration order.
  const byName = new Map<string, string[]>();
  const add = (key: string, id: string) => {
    const k = key.trim().toLowerCase();
    if (!k) return;
    const held = byName.get(k);
    if (held) { if (!held.includes(id)) held.push(id); }
    else byName.set(k, [id]);
  };
  for (const person of people) {
    const name = person.name.trim();
    // A "@" token can never contain a space (PERSON_TOKEN_PATTERN stops at the
    // first non-word character), so a multi-word name can never be typed as an
    // exact match anyway — indexing it as a key only feeds the *prefix* scan
    // below, which would otherwise let "@eye" match "Eye Q" by treating its
    // first word as though it were a first name. So a business's multi-word
    // name is skipped outright rather than only its explicit first-word entry;
    // a single-word business name (or nickname) still indexes normally.
    if (person.kind !== 'business' || !/\s/.test(name)) add(name, person.id);
    add(person.nickname, person.id);
    // First word only, so "Dustin Reyes" answers to "@dustin". Skipped when the
    // name is one word already, which the map above has covered, and skipped
    // outright for a business — its name's first word isn't a first name, and
    // matching it would read "Eye Q" as though "Eye" were somebody given name.
    if (person.kind === 'business') continue;
    const first = name.split(/\s+/)[0];
    if (first && first.toLowerCase() !== name.toLowerCase()) add(first, person.id);
  }
  const toCandidates = (ids: Iterable<string>): PersonToken[] => {
    const set = new Set(ids);
    return people.filter(p => set.has(p.id));
  };
  return { byName, toCandidates };
}

/**
 * Names and nicknames that contain a space ("Eye Q"), which `PERSON_TOKEN_PATTERN`
 * alone can never match because it stops at the first space. Kept apart from
 * `buildPersonNameIndex` on purpose: that index also feeds the *prefix* scan,
 * where a multi-word business name must not answer to its first word.
 */
function buildPhraseIndex(people: PersonToken[]): Map<string, string[]> {
  const phrases = new Map<string, string[]>();
  const add = (raw: string, id: string) => {
    const k = raw.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!k.includes(' ')) return;
    const held = phrases.get(k);
    if (held) { if (!held.includes(id)) held.push(id); }
    else phrases.set(k, [id]);
  };
  for (const person of people) {
    add(person.name, person.id);
    add(person.nickname, person.id);
  }
  return phrases;
}

/**
 * The longest multi-word name spelled out right after the "@" at `atIndex`
 * ("@Eye Q about..."), ending at a word boundary, or null. Longest wins so a
 * full name beats the first word it starts with.
 */
function phraseAt(
  input: string,
  atIndex: number,
  phrases: Map<string, string[]>
): { end: number; ids: string[] } | null {
  if (phrases.size === 0) return null;
  const from = atIndex + 1;
  let best: { end: number; ids: string[] } | null = null;
  for (const [key, ids] of phrases) {
    const end = from + key.length;
    if (best && end <= best.end) continue;
    if (input.slice(from, end).toLowerCase() !== key) continue;
    if (/[\w'-]/.test(input.charAt(end))) continue;
    best = { end, ids };
  }
  return best;
}

/**
 * The same index, one shelf over, for group names — exact and first-word,
 * same as people. Kept separate from `buildPersonNameIndex` rather than
 * merged into one map: a group resolving to several ids is a deliberate
 * expansion, not the ambiguity a person-token collision is, and the two need
 * to stay distinguishable to the caller (see `matchPersonMentions`).
 */
function buildGroupNameIndex(groups: GroupMentionToken[]) {
  const byName = new Map<string, string[]>();
  const add = (key: string, id: string) => {
    const k = key.trim().toLowerCase();
    if (!k) return;
    const held = byName.get(k);
    if (held) { if (!held.includes(id)) held.push(id); }
    else byName.set(k, [id]);
  };
  for (const group of groups) {
    add(group.name, group.id);
    const first = group.name.trim().split(/\s+/)[0];
    if (first && first.toLowerCase() !== group.name.trim().toLowerCase()) add(first, group.id);
  }
  return byName;
}

/**
 * Finds every "@name" token in a title and resolves it against the given
 * people, so "beach with @dustin @ansley sat" names both. Returns every match
 * with its position in the string, in order — not just the first — since
 * unlike the sigil-based parsers beside this one, a mention is never stripped
 * out of the title. It is data about who the sentence is about, and the
 * sentence usually needs it grammatically ("call @dustin" is "call Dustin");
 * "#category"/a URL/a phone number are metadata that reads fine gone, a name
 * often is not. So the caller's job is to render the matched span as a token
 * in place, not to lift it out — the mention lives in the title for good.
 *
 * **This is the whole reason there is no interactions table.** The record of
 * having seen somebody is a side effect of writing a task you were writing
 * anyway, rather than data entry about your friends — which is the failure mode
 * `docs/arch/people.md` is largely about. See rule 3 there.
 *
 * Matches a name or a nickname, exactly and case-insensitively, and also the
 * first word of a name so "@dustin" finds "Dustin Reyes" — full names are how
 * people arrive from a contact card, and nobody types a surname mid-sentence.
 * Short of an exact match, a token of at least `MIN_PREFIX_LENGTH` characters
 * also matches a unique prefix, so "@brit" finds "Brittany" while it's still
 * being typed rather than only once the last letter lands.
 *
 * A token more than one person answers to — "@sam" with two Sams registered —
 * is never guessed here; see `findAmbiguousMention` for the pick-one list
 * offered instead of refusing outright.
 *
 * **Deliberately never creates a person.** An unrecognized "@word" is left as
 * literal text, so an email address, a handle someone pasted, or a name you
 * have not added costs nothing and prompts nothing. Adding somebody is a
 * deliberate act performed on the People screen (rule 3 again), not a side
 * effect of a typo.
 *
 * `people` is passed in rather than read from a store, keeping this module free
 * of any store dependency — see the header note. A caller rendering an
 * already-saved task should pass only the people it actually names
 * (`peopleOn(task)`), not the whole roster, so a mention can't relight for
 * someone the task no longer links.
 *
 * `groups` is tried only for a token no person answers to at all, never as a
 * second opinion once a person has — so a group whose name happens to share a
 * member's own first word (a group literally named after them) can never
 * shadow the person. A resolved group expands into one `PersonMention` per
 * member, all sharing the token's span: "@household" naming two people is the
 * same shape on the page as typing "@dustin @ansley" would have been, which is
 * what lets every downstream reader (tinting, `personIds`) stay ignorant that
 * groups exist at all. A group more than one group answers to is left
 * unresolved, the same refusal an ambiguous person gets.
 */
export function matchPersonMentions(
  input: string,
  people: PersonToken[],
  groups: GroupMentionToken[] = []
): PersonMention[] {
  const { byName } = buildPersonNameIndex(people);
  const phrases = buildPhraseIndex(people);
  const groupByName = groups.length > 0 ? buildGroupNameIndex(groups) : null;
  const groupById = groups.length > 0 ? new Map(groups.map(g => [g.id, g])) : null;
  const mentions: PersonMention[] = [];

  for (const m of input.matchAll(PERSON_TOKEN_PATTERN)) {
    if (m.index === undefined) continue;
    // A full multi-word name ("@Eye Q") is tried first; the single-word
    // grammar below would only ever see "@Eye".
    const phrase = phraseAt(input, m.index, phrases);
    if (phrase && phrase.ids.length === 1) {
      mentions.push({ start: m.index, end: phrase.end, personId: phrase.ids[0] });
      continue;
    }
    const token = m[1].toLowerCase();
    let hits = byName.get(token);
    // No exact answer yet: try a unique prefix, so a name still being typed
    // can resolve before its last letter lands. Only tried when there is no
    // exact hit at all — an exact match that is itself ambiguous stays that
    // way rather than widening the search and picking up more candidates.
    if (!hits && token.length >= MIN_PREFIX_LENGTH) {
      const prefixIds = new Set<string>();
      for (const [key, ids] of byName) {
        if (key.startsWith(token)) ids.forEach(id => prefixIds.add(id));
      }
      if (prefixIds.size === 1) hits = [...prefixIds];
    }
    if (hits && hits.length === 1) {
      mentions.push({ start: m.index, end: m.index + m[0].length, personId: hits[0] });
      continue;
    }
    // Two people answering to one token is left as literal text rather than
    // resolved to whichever was added first — and never falls through to a
    // group check, so an ambiguous person-name collision can't accidentally
    // pick up a differently-ambiguous group meaning instead.
    if (hits) continue;

    if (!groupByName) continue;
    let groupHits = groupByName.get(token);
    if (!groupHits && token.length >= MIN_PREFIX_LENGTH) {
      const prefixIds = new Set<string>();
      for (const [key, ids] of groupByName) {
        if (key.startsWith(token)) ids.forEach(id => prefixIds.add(id));
      }
      if (prefixIds.size === 1) groupHits = [...prefixIds];
    }
    if (!groupHits || groupHits.length !== 1) continue;
    const group = groupById!.get(groupHits[0]);
    if (!group) continue;
    const end = m.index + m[0].length;
    for (const memberId of group.memberIds) {
      mentions.push({ start: m.index, end, personId: memberId });
    }
  }

  return mentions;
}

/**
 * The first "@name" token `matchPersonMentions` couldn't resolve because more
 * than one person answers to it — exact ("@sam" with two Sams on file) or by
 * prefix ("@bri" with a Brittany and a Brittney still both in the running).
 * Surfaced so a caller can offer a pick-one list rather than only refusing:
 * typing further can narrow a shared prefix, but two people who share an
 * entire first name or nickname (two Sams) can never become unique that way
 * no matter how much more gets typed.
 *
 * `overrides` — a lowercased token mapped to the person id it was resolved to
 * — is how a caller's own pick reaches this function again: once resolved,
 * that token stops being reported as ambiguous, so the list doesn't reappear
 * once answered. The pick can't just rewrite the title text the way a unique
 * prefix does, because the token grammar has no way to spell a two-word full
 * name inline (`PERSON_TOKEN_PATTERN` is single-word only) — see
 * `applyMentionOverrides`, the other half of this pair, for how the pick
 * actually reaches `personIds`.
 */
export function findAmbiguousMention(
  input: string,
  people: PersonToken[],
  overrides: Record<string, string> = {}
): AmbiguousMention | null {
  const { byName, toCandidates } = buildPersonNameIndex(people);
  const phrases = buildPhraseIndex(people);

  for (const m of input.matchAll(PERSON_TOKEN_PATTERN)) {
    if (m.index === undefined) continue;
    if (phraseAt(input, m.index, phrases)) continue; // a full name, already resolved
    const token = m[1].toLowerCase();
    if (overrides[token]) continue;
    const hits = byName.get(token);
    if (hits) {
      if (hits.length > 1) {
        return { start: m.index, end: m.index + m[0].length, token, candidates: toCandidates(hits) };
      }
      continue;
    }
    if (token.length < MIN_PREFIX_LENGTH) continue;
    const prefixIds = new Set<string>();
    for (const [key, ids] of byName) {
      if (key.startsWith(token)) ids.forEach(id => prefixIds.add(id));
    }
    if (prefixIds.size > 1) {
      return { start: m.index, end: m.index + m[0].length, token, candidates: toCandidates(prefixIds) };
    }
  }
  return null;
}

/** One row of `getMentionSuggestions`' candidate list. */
export interface MentionSuggestionCandidate {
  id: string;
  /** Full display name/label, shown on the suggestion pill. */
  name: string;
  /**
   * What actually gets spliced into the title on selection — a person's
   * nickname or first name, or a group's own first word when its name has
   * more than one. Always a single word: the token grammar admits no spaces,
   * same constraint `applyMentionOverrides`' doc comment explains for a
   * two-word full name.
   */
  resolveKey: string;
  isGroup?: boolean;
  /** Set only when `isGroup` — every person the group expands into. */
  memberIds?: string[];
}

/** A "@name" token still being typed, offered as a row of candidates. See `getMentionSuggestions`. */
export interface MentionSuggestion {
  start: number;
  end: number;
  token: string;
  candidates: MentionSuggestionCandidate[];
}

/**
 * A "@name" token still being typed, at the very end of the title, offered as
 * a row of candidate suggestions before it's typed far enough to resolve on
 * its own. `matchPersonMentions` needs a full name/nickname or a *unique*
 * prefix of at least `MIN_PREFIX_LENGTH` characters to tint anything, so
 * someone one letter into "@luke" gets no feedback at all today — the actual
 * complaint this exists to answer, not a new way of resolving a mention.
 *
 * It only ever returns a token `matchPersonMentions` (and `findAmbiguousMention`)
 * wouldn't already have an opinion about:
 * - An exact name/nickname match, unique or ambiguous, is excluded outright —
 *   the first is already live-tinted, the second is `findAmbiguousMention`'s
 *   job, and the two tooltips must never compete for the same token.
 * - A unique prefix `MIN_PREFIX_LENGTH` characters or longer is excluded too,
 *   for the same reason: it's already resolved and tinted, so suggesting it
 *   again would just be a second UI pointing at what the title already shows.
 * - What's left is a short (1-2 character) prefix with at least one
 *   candidate, resolved or not — exactly the window neither existing function
 *   covers.
 *
 * Groups are only tried once no person answers to the prefix at all, the same
 * fallback order `matchPersonMentions` uses — a group whose name happens to
 * share a member's own first word must never shadow the person.
 *
 * Selecting a candidate always **rewrites** the token to its `resolveKey`, never
 * records an override the way `findAmbiguousMention`'s pick does — nothing
 * here is an exact-name collision that text alone can't spell, so there's no
 * need for the override mechanism's workaround.
 */
export function getMentionSuggestions(
  input: string,
  people: PersonToken[],
  groups: GroupMentionToken[] = []
): MentionSuggestion | null {
  let last: RegExpMatchArray | null = null;
  for (const m of input.matchAll(PERSON_TOKEN_PATTERN)) last = m;
  if (!last || last.index === undefined) return null;
  const start = last.index;
  const end = start + last[0].length;
  if (end !== input.length) return null; // done growing — not what's being typed right now

  const token = last[1].toLowerCase();
  const { byName, toCandidates } = buildPersonNameIndex(people);

  // An exact match, unique or ambiguous, is already spoken for above.
  if (byName.has(token)) return null;

  const prefixIds = new Set<string>();
  for (const [key, ids] of byName) {
    if (key.startsWith(token)) ids.forEach(id => prefixIds.add(id));
  }
  if (prefixIds.size === 1 && token.length >= MIN_PREFIX_LENGTH) return null; // matchPersonMentions already has this

  if (prefixIds.size > 0) {
    return {
      start, end, token,
      candidates: toCandidates(prefixIds).slice(0, 5).map(p => ({
        id: p.id,
        name: p.name,
        resolveKey: mentionResolveKey(p),
      })),
    };
  }

  if (groups.length === 0) return null;
  const groupByName = buildGroupNameIndex(groups);
  if (groupByName.has(token)) return null; // exact match already resolves live

  const groupIds = new Set<string>();
  for (const [key, ids] of groupByName) {
    if (key.startsWith(token)) ids.forEach(id => groupIds.add(id));
  }
  if (groupIds.size === 0) return null;
  if (groupIds.size === 1 && token.length >= MIN_PREFIX_LENGTH) return null;

  const groupById = new Map(groups.map(g => [g.id, g]));
  const candidates: MentionSuggestionCandidate[] = [...groupIds]
    .map(id => groupById.get(id))
    .filter((g): g is GroupMentionToken => g !== undefined)
    .slice(0, 5)
    .map(g => ({ id: g.id, name: g.name, resolveKey: g.name.trim().split(/\s+/)[0], isGroup: true, memberIds: g.memberIds }));
  return { start, end, token, candidates };
}

/**
 * `getMentionSuggestions`' counterpart for `TaskEditor`'s title field, which
 * never resolves a fresh "@name" on its own at all — People is its own
 * picker (docs/arch/people.md), so a mention only tints once `linkedIds`
 * already covers it. That means the "already resolves, so stay quiet" exits
 * in `getMentionSuggestions` are the wrong call here: a token that would be a
 * unique, fully-typed match anywhere else is exactly the case with no
 * feedback at all in this field otherwise, not a redundant one.
 *
 * So every prefix match against everyone **not already in `linkedIds`** is a
 * candidate, any length, unique or not — the only thing excluded is a token
 * that already names someone the task links (that one's tinted, and adding
 * it again would double a mention already in `personIds`). Selecting a
 * candidate both rewrites the token (same as `getMentionSuggestions`) and
 * adds the person — or every member of a chosen group — to `personIds`; see
 * the caller in `TaskEditor`.
 */
export function getEditorMentionSuggestions(
  input: string,
  people: PersonToken[],
  linkedIds: readonly string[],
  groups: GroupMentionToken[] = []
): MentionSuggestion | null {
  let last: RegExpMatchArray | null = null;
  for (const m of input.matchAll(PERSON_TOKEN_PATTERN)) last = m;
  if (!last || last.index === undefined) return null;
  const start = last.index;
  const end = start + last[0].length;
  if (end !== input.length) return null; // done growing — not what's being typed right now

  const token = last[1].toLowerCase();
  const linked = new Set(linkedIds);
  const { byName, toCandidates } = buildPersonNameIndex(people.filter(p => !linked.has(p.id)));

  const prefixIds = new Set<string>();
  for (const [key, ids] of byName) {
    if (key.startsWith(token)) ids.forEach(id => prefixIds.add(id));
  }
  if (prefixIds.size > 0) {
    return {
      start, end, token,
      candidates: toCandidates(prefixIds).slice(0, 5).map(p => ({
        id: p.id,
        name: p.name,
        resolveKey: mentionResolveKey(p),
      })),
    };
  }

  if (groups.length === 0) return null;
  // A group every member of which is already linked has nothing left to add.
  const groupCandidates = groups.filter(g => !g.memberIds.every(id => linked.has(id)));
  if (groupCandidates.length === 0) return null;
  const groupByName = buildGroupNameIndex(groupCandidates);
  const groupIds = new Set<string>();
  for (const [key, ids] of groupByName) {
    if (key.startsWith(token)) ids.forEach(id => groupIds.add(id));
  }
  if (groupIds.size === 0) return null;

  const groupById = new Map(groupCandidates.map(g => [g.id, g]));
  const candidates: MentionSuggestionCandidate[] = [...groupIds]
    .map(id => groupById.get(id))
    .filter((g): g is GroupMentionToken => g !== undefined)
    .slice(0, 5)
    .map(g => ({ id: g.id, name: g.name, resolveKey: g.name.trim().split(/\s+/)[0], isGroup: true, memberIds: g.memberIds }));
  return { start, end, token, candidates };
}

/**
 * Layers a caller's manual disambiguation picks on top of `matchPersonMentions`'
 * live matches. `overrides` is keyed by lowercased token text (see
 * `findAmbiguousMention`); any "@token" in the title whose text has a pick
 * recorded, and that `matched` didn't already resolve on its own, is added as
 * an extra mention using that pick's person id.
 */
export function applyMentionOverrides(
  input: string,
  matched: PersonMention[],
  overrides: Record<string, string>
): PersonMention[] {
  if (Object.keys(overrides).length === 0) return matched;
  const covered = new Set(matched.map(m => `${m.start}-${m.end}`));
  const extra: PersonMention[] = [];
  for (const m of input.matchAll(PERSON_TOKEN_PATTERN)) {
    if (m.index === undefined) continue;
    const token = m[1].toLowerCase();
    const personId = overrides[token];
    if (!personId) continue;
    const start = m.index;
    const end = m.index + m[0].length;
    if (covered.has(`${start}-${end}`)) continue;
    extra.push({ start, end, personId });
  }
  if (extra.length === 0) return matched;
  return [...matched, ...extra].sort((a, b) => a.start - b.start);
}

function joinDayNames(days: number[]): string {
  if (days.length === 1) return DAY_NAMES_FULL[days[0]];
  const names = days.map(d => DAY_NAMES_SHORT[d]);
  return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
}

function sameDays(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i]);
}

function ordinalLabel(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Human label for the parse chip: "Tue, Jun 17", "Every Mon & Wed", "Daily · morning". */
/** "15:00" → "3 PM", "09:30" → "9:30 AM". */
function formatHhmm(value: string): string {
  const [h, m] = value.split(':').map(n => parseInt(n, 10));
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

export function describeSchedule(s: ParsedSchedule, now: Date = new Date()): string {
  const n = s.recurrenceInterval;
  let label: string;
  switch (s.recurrenceType) {
    case 'daily':
      label = n === 1 ? 'Daily' : `Every ${n} days`;
      break;
    case 'weekly': {
      const days = s.recurrenceDays;
      if (days.length === 0) {
        label = n === 1 ? 'Weekly' : n === 2 ? 'Every other week' : `Every ${n} weeks`;
      } else if (n === 1 && sameDays(days, [1, 2, 3, 4, 5])) {
        label = 'Every weekday';
      } else if (n === 1 && sameDays(days, [0, 6])) {
        label = 'Every weekend';
      } else if (n === 1) {
        label = `Every ${joinDayNames(days)}`;
      } else if (n === 2) {
        label = `Every other ${joinDayNames(days)}`;
      } else {
        label = `Every ${n} weeks on ${joinDayNames(days)}`;
      }
      break;
    }
    case 'monthly':
      if (s.recurrenceWeekOrdinal != null && s.recurrenceDays.length > 0) {
        const ordWord = s.recurrenceWeekOrdinal === -1 ? 'last' : ordinalLabel(s.recurrenceWeekOrdinal);
        label = `Every ${ordWord} ${DAY_NAMES_FULL[s.recurrenceDays[0]]}`;
      } else if (s.recurrenceMonthDay != null) {
        label = s.recurrenceMonthDay === -1 ? 'Monthly on the last day' : `Monthly on the ${ordinalLabel(s.recurrenceMonthDay)}`;
      } else {
        label = n === 1 ? 'Monthly' : n === 3 ? 'Quarterly' : n === 6 ? 'Every 6 months' : `Every ${n} months`;
      }
      break;
    case 'yearly':
      label = n === 1 ? `Every ${format(s.dueDate, 'MMM d')}` : `Every ${n} years`;
      break;
    case 'hours':
      label = n === 1 ? 'Every hour' : n === 2 ? 'Every other hour' : `Every ${n} hours`;
      break;
    default: {
      const d = s.dueDate;
      if (s.extraDates?.length) {
        label = [d, ...s.extraDates].map(day => format(day, 'MMM d')).join(', ');
        break;
      }
      label = isSameDay(d, now)
        ? 'Today'
        : isSameDay(d, addDays(startOfDay(now), 1))
          ? 'Tomorrow'
          : format(d, 'EEE, MMM d');
      // "by"/"due" phrasing sets a deadline alongside the date — say so, so
      // accepting the chip doesn't silently add a field the label never
      // mentioned.
      if (s.deadline) label = `${label} · Deadline`;
      if (s.windowEnd) {
        label = `Expires ${label === 'Today' || label === 'Tomorrow' ? label.toLowerCase() : label}`;
        if (s.windowEnd !== '23:59') label += ` at ${formatHhmm(s.windowEnd)}`;
      }
    }
  }
  // The window start replaces the segment in the label rather than joining
  // it: "after 3 PM" already says which part of the day.
  if (s.windowStart) label += ` · After ${formatHhmm(s.windowStart)}`;
  else if (s.timeSegments.length > 0) label += ` · ${s.timeSegments[0]}`;
  return label;
}
