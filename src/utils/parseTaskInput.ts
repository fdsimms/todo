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
import type { RecurrenceType, TimeOfDay } from '../types';
import { extractDayPart, extractTime, MONTHS, monthDay, parseDatePart, WEEKDAYS } from './parseNaturalDate';
import { looksLikePhoneNumber } from './phone';

/**
 * The Nth (1-4) or last (-1) weekday-of-month occurrence within the month
 * containing `monthDate`. Duplicated from dateUtils.ts's identical helper
 * rather than imported — dateUtils pulls in the SQLite db layer transitively
 * (via useSettingsStore), which this module must stay free of to keep parsing
 * pure and Jest-testable without native module mocks.
 */
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
// word. Short weekday abbreviations ("mon", "sat", "may") and names ("tom")
// are common English words, so they require a connector ("on sat", "by wed").
const SINGLE_WORD_SAFE =
  /^(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|(?:sun|mon|tues|wednes|thurs|fri|satur)days|today|tomorrow|tonight|tmrw|tmr|daily|weekly|monthly|yearly|annually|\d{1,2}(?::\d{2})?(?:am|pm|a\.m\.?|p\.m\.?))$/;

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
  return null;
}

/** Anchored recurrence grammar; `segments` carries a previously peeled time-of-day. */
function matchRecurrenceCore(text: string, now: Date, segments: TimeOfDay[]): ParsedSchedule | null {
  let m: RegExpMatchArray | null;

  if (/^(?:daily|every day)$/.test(text)) return recurrence('daily', 1, [], segments, now);
  if (/^(?:weekly|every week)$/.test(text)) return recurrence('weekly', 1, [], segments, now);
  if (/^(?:monthly|every month)$/.test(text)) return recurrence('monthly', 1, [], segments, now);
  if (/^(?:yearly|annually|every year)$/.test(text)) return recurrence('yearly', 1, [], segments, now);

  // "every morning" — the day part IS the unit, and supplies the segment.
  if ((m = text.match(/^every (morning|afternoon|evening|night)$/))) {
    return recurrence('daily', 1, [], [DAY_PART_SEGMENT[m[1]]], now);
  }

  // "every 3 days", "every 2 weeks"
  if ((m = text.match(/^every (\d+) (days?|weeks?|months?|years?)$/))) {
    const type = unitToType(m[2])!;
    const n = parseInt(m[1], 10);
    if (n < 1) return null;
    return recurrence(type, n, [], segments, now);
  }

  // "every other week", "every other tuesday"
  if ((m = text.match(/^every other (.+)$/))) {
    const type = unitToType(m[1]);
    if (type) return recurrence(type, 2, [], segments, now);
    const days = parseWeekdayList(m[1], false);
    if (days) return recurrence('weekly', 2, days, segments, now);
    return null;
  }

  if (/^every weekdays?$/.test(text)) return recurrence('weekly', 1, [1, 2, 3, 4, 5], segments, now);
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
 * Peels a trailing "after completion" clause, mapping to recurrenceFromCompletion.
 *
 * Case-insensitive so it can be run against original-cased input as well as the
 * lowercased suffix the parser normally hands it — see
 * parseFromCompletionSuffix, which slices the caller's own string by the length
 * of `rest` and would mis-slice if this only matched lowercase.
 */
function extractFromCompletionClause(text: string): { rest: string } | null {
  const m = text.match(/^(.*?)\s+after\s+(?:completion|completing|finishing|finished|it'?s?\s+done|i\s+(?:complete|finish)\s+it|done)$/i);
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
  if ((m = text.match(/^(.*?)\s+for\s+(\d+)\s+(days?|weeks?|months?|years?)$/))) {
    return { end: { durationN: parseInt(m[2], 10), durationUnit: m[3] }, rest: m[1] };
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

  let schedule = matchRecurrenceCore(core, now, []);
  if (!schedule) {
    // Peel a trailing clock time / day part ("every tuesday at 6pm") into a segment.
    let segments: TimeOfDay[];
    let rest: string;
    const clock = extractTime(core);
    if (clock) {
      segments = [segmentForHour(clock.time.h)];
      rest = clock.rest;
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
  }
  if (!schedule) return null;

  if (starting) schedule = { ...schedule, dueDate: dueAt(starting.date) };
  if (fromCompletion) schedule = { ...schedule, recurrenceFromCompletion: true };
  if (endMatch) {
    const { end } = endMatch;
    if (end.endDate) {
      schedule = { ...schedule, recurrenceEndDate: dueAt(end.endDate).toISOString() };
    } else if (end.count !== undefined) {
      schedule = { ...schedule, recurrenceCount: end.count };
    } else if (end.durationN !== undefined && end.durationUnit) {
      const endDate = durationAddFn(end.durationUnit)(schedule.dueDate, end.durationN);
      schedule = { ...schedule, recurrenceEndDate: endDate.toISOString() };
    }
  }
  return schedule;
}

/** Try to parse an entire suffix as a one-off date/time or recurrence phrase. */
function parseSuffix(text: string, now: Date, singleWord: boolean): ParsedSchedule | null {
  // Recurrence first — it owns the "every"/plural/frequency-word triggers.
  const rec = parseRecurrenceSuffix(text, now);
  if (rec) return rec;

  if (singleWord && !SINGLE_WORD_SAFE.test(text)) return null;

  // One-off date phrase: optional connector, then mirror parseNaturalDate's
  // pipeline but map clock times / day parts to visibility segments.
  const connector = text.match(/^(on|by|due)\s+/);
  const isDeadlinePhrasing = connector != null && connector[1] !== 'on';
  let t = connector ? text.slice(connector[0].length) : text;
  let segments: TimeOfDay[] = [];
  let hasTime = false;
  const clock = extractTime(t);
  if (clock) {
    segments = [segmentForHour(clock.time.h)];
    t = clock.rest;
    hasTime = true;
  } else {
    const part = extractDayPart(t);
    if (part) {
      segments = [DAY_PART_SEGMENT[part.part]];
      t = part.rest;
      hasTime = true;
    }
  }
  // Same as above — "@" has no meaning in this file and is no longer stripped as noise.
  t = t.replace(/\bat\b/g, ' ').replace(/\bin the\b/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  const datePart = t ? parseDatePart(t, now) : null;
  // Leftover words that aren't a date phrase → this suffix isn't a schedule.
  if (t && !datePart) return null;
  if (!datePart && !hasTime) return null;

  let due: Date;
  if (datePart) {
    due = dueAt(datePart.date);
    if (datePart.explicitTime && segments.length === 0) {
      // "tonight", "in 1 hour" — the embedded time implies a segment.
      segments = [segmentForHour(datePart.date.getHours())];
    }
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
  };
}

export function parseTaskInput(input: string, now: Date = new Date()): ParsedTaskInput | null {
  if (!input) return null;
  const tokens = [...input.matchAll(/\S+/g)];
  if (tokens.length < 2) return null;

  const lower = input.toLowerCase();
  // An input that is entirely a schedule phrase ("on tuesday", "every monday")
  // stays a literal title — quick add needs a title, and it's almost always
  // mid-typing.
  if (parseSuffix(lower.trim(), now, false)) return null;

  for (let i = 1; i < tokens.length; i++) {
    const start = tokens[i].index!;
    const suffix = lower.slice(start).trim();
    const schedule = parseSuffix(suffix, now, i === tokens.length - 1);
    if (schedule) {
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
  if (!cleanTitle) return null; // a bare pasted link keeps the input as a literal title

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
 * for a URL. Same "anywhere in the text, not suffix-anchored" rule, and the
 * same refusal to fire when the number *is* the whole input: a title of
 * nothing but digits is what someone typing a number as a task looks like.
 */
export function parsePhoneInput(input: string): ParsedPhone | null {
  const match = input.match(PHONE_PATTERN);
  if (!match || match.index === undefined) return null;
  const number = match[0];
  if (!looksLikePhoneNumber(number)) return null;

  const matchStart = match.index;
  const matchEnd = matchStart + number.length;
  const cleanTitle = (input.slice(0, matchStart) + input.slice(matchEnd)).replace(/\s+/g, ' ').trim();
  if (!cleanTitle) return null;

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
 * suffix-anchored" rule, and the same refusal to fire when the address *is*
 * the whole input.
 */
export function parseEmailInput(input: string): ParsedEmail | null {
  const match = input.match(EMAIL_PATTERN);
  if (!match || match.index === undefined) return null;
  const address = match[0];

  const matchStart = match.index;
  const matchEnd = matchStart + address.length;
  const cleanTitle = (input.slice(0, matchStart) + input.slice(matchEnd)).replace(/\s+/g, ' ').trim();
  if (!cleanTitle) return null;

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
  if (!cleanTitle) return null; // "for 15 minutes" alone is a literal title, not a timer

  return { minutes, cleanTitle, matchStart, matchEnd };
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
  if (!cleanTitle) return null; // "6 filters left" alone is a literal title

  return { count, unit: rawUnit ? rawUnit.toLowerCase() : null, cleanTitle, matchStart, matchEnd };
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
  if (!cleanTitle) return null; // a bare "#home" alone is a literal title, not a tag

  return {
    category,
    tags: [...new Set(matchedTags)],
    cleanTitle,
    matchStart: consumed[0].start,
    matchEnd: consumed[0].end,
  };
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
    default: {
      const d = s.dueDate;
      label = isSameDay(d, now)
        ? 'Today'
        : isSameDay(d, addDays(startOfDay(now), 1))
          ? 'Tomorrow'
          : format(d, 'EEE, MMM d');
      // "by"/"due" phrasing sets a deadline alongside the date — say so, so
      // accepting the chip doesn't silently add a field the label never
      // mentioned.
      if (s.deadline) label = `${label} · Deadline`;
    }
  }
  if (s.timeSegments.length > 0) label += ` · ${s.timeSegments[0]}`;
  return label;
}
