import { addDays, format, isSameDay, startOfDay } from 'date-fns';
import type { Day } from 'date-fns';
import type { RecurrenceType, TimeOfDay } from '../types';
import { extractDayPart, extractTime, parseDatePart, WEEKDAYS } from './parseNaturalDate';

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
  /** Start-of-day; the first occurrence for recurrences. */
  dueDate: Date;
  timeSegments: TimeOfDay[];
  /** 'none' for one-off dates. */
  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  /** Weekly only; 0 = Sunday. Sorted. */
  recurrenceDays: number[];
}

export interface ParsedTaskInput {
  /** Input minus the matched phrase, original casing, trailing punctuation trimmed. */
  cleanTitle: string;
  /** The exact matched substring — chip label identity and dismissal key. */
  matchedText: string;
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

function segmentForHour(h: number): TimeOfDay {
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

/** Earliest day from today (inclusive) whose weekday is in `days`. */
function firstOccurrence(days: number[], now: Date): Date {
  const today = startOfDay(now);
  if (days.length === 0) return today;
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    if (days.includes(d.getDay())) return d;
  }
  return today;
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

function parseRecurrenceSuffix(text: string, now: Date): ParsedSchedule | null {
  const direct = matchRecurrenceCore(text, now, []);
  if (direct) return direct;

  // Peel a trailing clock time / day part ("every tuesday at 6pm") into a segment.
  let segments: TimeOfDay[];
  let rest: string;
  const clock = extractTime(text);
  if (clock) {
    segments = [segmentForHour(clock.time.h)];
    rest = clock.rest;
  } else {
    const part = extractDayPart(text);
    if (!part) return null;
    segments = [DAY_PART_SEGMENT[part.part]];
    rest = part.rest;
  }
  rest = rest.replace(/\bat\b/g, ' ').replace(/@/g, ' ').replace(/\bin the\b/g, ' ').replace(/\s+/g, ' ').trim();
  return matchRecurrenceCore(rest, now, segments);
}

/** Try to parse an entire suffix as a one-off date/time or recurrence phrase. */
function parseSuffix(text: string, now: Date, singleWord: boolean): ParsedSchedule | null {
  // Recurrence first — it owns the "every"/plural/frequency-word triggers.
  const rec = parseRecurrenceSuffix(text, now);
  if (rec) return rec;

  if (singleWord && !SINGLE_WORD_SAFE.test(text)) return null;

  // One-off date phrase: optional connector, then mirror parseNaturalDate's
  // pipeline but map clock times / day parts to visibility segments.
  let t = text.replace(/^(?:on|by|due)\s+/, '');
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
  t = t.replace(/\bat\b/g, ' ').replace(/@/g, ' ').replace(/\bin the\b/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  const datePart = t ? parseDatePart(t, now) : null;
  // Leftover words that aren't a date phrase → this suffix isn't a schedule.
  if (t && !datePart) return null;
  if (!datePart && !hasTime) return null;

  let due: Date;
  if (datePart) {
    due = startOfDay(datePart.date);
    if (datePart.explicitTime && segments.length === 0) {
      // "tonight", "in 1 hour" — the embedded time implies a segment.
      segments = [segmentForHour(datePart.date.getHours())];
    }
  } else {
    due = startOfDay(now); // time-only input ("at 3pm") → today
  }

  return {
    dueDate: due,
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
      return { cleanTitle, matchedText: input.slice(start).trim(), schedule };
    }
  }
  return null;
}

function joinDayNames(days: number[]): string {
  if (days.length === 1) return DAY_NAMES_FULL[days[0]];
  const names = days.map(d => DAY_NAMES_SHORT[d]);
  return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
}

function sameDays(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i]);
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
      label = n === 1 ? 'Monthly' : `Every ${n} months`;
      break;
    case 'yearly':
      label = n === 1 ? 'Yearly' : `Every ${n} years`;
      break;
    default: {
      const d = s.dueDate;
      label = isSameDay(d, now)
        ? 'Today'
        : isSameDay(d, addDays(startOfDay(now), 1))
          ? 'Tomorrow'
          : format(d, 'EEE, MMM d');
    }
  }
  if (s.timeSegments.length > 0) label += ` · ${s.timeSegments[0]}`;
  return label;
}
