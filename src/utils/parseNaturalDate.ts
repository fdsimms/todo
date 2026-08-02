import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  addHours,
  addMinutes,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
  startOfDay,
  nextDay,
  isSameWeek,
  type Day,
} from 'date-fns';

/**
 * Lightweight natural-language date parser built on date-fns.
 *
 * Handles the common quick-entry phrases people actually type:
 *   "tomorrow", "tomorrow at 3pm", "today at 5", "tonight"
 *   "next monday", "friday 9am", "this weekend"
 *   "in 2 weeks", "in 3 days", "in 1 hour", "in 30 min"
 *   "next week", "next month", "next year"
 *   "noon", "midnight", "tomorrow morning"
 *   "jun 15", "june 15 2026", "15 jun", "12/25", "2026-12-25"
 *
 * Returns null when the input can't be confidently understood, so callers
 * can fall back to the date picker.
 */

export const WEEKDAYS: Record<string, Day> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const FULL_WEEKDAYS: [string, Day][] = [
  ['sunday', 0], ['monday', 1], ['tuesday', 2], ['wednesday', 3],
  ['thursday', 4], ['friday', 5], ['saturday', 6],
];

/**
 * Resolve a typed token to a weekday, including while the user is still
 * mid-word (e.g. "frid" between the "fri" abbreviation and "friday").
 * Falls back to a unique-prefix match against the full day names so the
 * suggestion doesn't flicker off between recognized forms.
 */
function matchWeekday(token: string): Day | undefined {
  if (token in WEEKDAYS) return WEEKDAYS[token];
  if (token.length < 3) return undefined;
  const matches = FULL_WEEKDAYS.filter(([name]) => name.startsWith(token));
  return matches.length === 1 ? matches[0][1] : undefined;
}

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

// Named parts of the day → a representative hour.
const DAY_PARTS: Record<string, number> = {
  morning: 9,
  afternoon: 15,
  evening: 18,
  night: 20,
};

const DEFAULT_HOUR = 9; // applied to date-only input ("tomorrow", "next monday")

export interface ClockTime {
  h: number;
  m: number;
}

function atTime(date: Date, h: number, m: number): Date {
  return setMilliseconds(setSeconds(setMinutes(setHours(date, h), m), 0), 0);
}

/** Remove a regex match from a string and tidy up whitespace. */
export function strip(text: string, match: RegExpMatchArray): string {
  return (text.slice(0, match.index) + text.slice(match.index! + match[0].length))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pull a clock time ("3pm", "3:30pm", "15:00", "noon", "midnight") out of the text. */
export function extractTime(text: string): { time: ClockTime; rest: string } | null {
  let m: RegExpMatchArray | null;

  if ((m = text.match(/\bnoon\b/))) return { time: { h: 12, m: 0 }, rest: strip(text, m) };
  if ((m = text.match(/\bmidnight\b/))) return { time: { h: 0, m: 0 }, rest: strip(text, m) };

  // 12-hour clock with am/pm, e.g. "3pm", "3:30 pm", "9 a.m."
  if ((m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/))) {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    if (h > 12 || min > 59) return null;
    const pm = m[3][0] === 'p';
    if (h === 12) h = 0;
    if (pm) h += 12;
    return { time: { h, m: min }, rest: strip(text, m) };
  }

  // 24-hour clock with a colon, e.g. "15:00", "9:05"
  if ((m = text.match(/\b(\d{1,2}):(\d{2})\b/))) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return { time: { h, m: min }, rest: strip(text, m) };
  }

  return null;
}

/** Pull a named day-part ("morning", "evening", …) out of the text. */
export function extractDayPart(text: string): { time: ClockTime; rest: string; part: string } | null {
  const m = text.match(/\b(morning|afternoon|evening|night)\b/);
  if (!m) return null;
  return { time: { h: DAY_PARTS[m[1]], m: 0 }, rest: strip(text, m), part: m[1] };
}

export interface DatePart {
  date: Date; // at start-of-day unless explicitTime is true
  explicitTime: boolean;
}

function relativeUnit(unit: string, n: number, now: Date): DatePart | null {
  if (/^min/.test(unit)) return { date: addMinutes(now, n), explicitTime: true };
  if (/^h/.test(unit)) return { date: addHours(now, n), explicitTime: true };
  if (/^d/.test(unit)) return { date: startOfDay(addDays(now, n)), explicitTime: false };
  if (/^w/.test(unit)) return { date: startOfDay(addWeeks(now, n)), explicitTime: false };
  if (/^mo/.test(unit)) return { date: startOfDay(addMonths(now, n)), explicitTime: false };
  if (/^y/.test(unit)) return { date: startOfDay(addYears(now, n)), explicitTime: false };
  return null;
}

/** Resolve a month/day (and optional year) to a date, rolling into next year if already past. */
function monthDay(month: number, day: number, year: number | null, now: Date): DatePart | null {
  if (day < 1 || day > 31) return null;
  let y = year ?? now.getFullYear();
  let date = startOfDay(new Date(y, month, day));
  if (date.getMonth() !== month) return null; // overflow guard, e.g. "feb 31"
  if (year === null && date < startOfDay(now)) {
    date = startOfDay(new Date(y + 1, month, day));
  }
  return { date, explicitTime: false };
}

export function parseDatePart(input: string, now: Date): DatePart | null {
  const text = input.trim();
  if (text === '') return null;

  // Fixed keywords
  if (text === 'today' || text === 'tod') return { date: startOfDay(now), explicitTime: false };
  if (text === 'tonight') return { date: atTime(now, 20, 0), explicitTime: true };
  if (text === 'tomorrow' || text === 'tmrw' || text === 'tmr' || text === 'tom') {
    return { date: startOfDay(addDays(now, 1)), explicitTime: false };
  }
  if (text === 'yesterday') return { date: startOfDay(addDays(now, -1)), explicitTime: false };

  if (text === 'next week') return { date: startOfDay(addWeeks(now, 1)), explicitTime: false };
  if (text === 'next month') return { date: startOfDay(addMonths(now, 1)), explicitTime: false };
  if (text === 'next year') return { date: startOfDay(addYears(now, 1)), explicitTime: false };

  let m: RegExpMatchArray | null;

  // "in 2 weeks", "in 30 min", "in 1 hour"
  if ((m = text.match(/^in\s+(\d+)\s+(min(?:ute)?s?|hours?|hrs?|days?|weeks?|wks?|months?|years?|yrs?)$/))) {
    return relativeUnit(m[2], parseInt(m[1], 10), now);
  }
  // "in a week", "in an hour"
  if ((m = text.match(/^in\s+an?\s+(min(?:ute)?|hour|hr|day|week|wk|month|year|yr)$/))) {
    return relativeUnit(m[1], 1, now);
  }

  // Weekend
  if ((m = text.match(/^(?:this\s+|next\s+|the\s+)?weekend$/))) {
    let date = nextDay(now, 6 as Day); // upcoming Saturday
    if (/^next/.test(text) && isSameWeek(date, now)) date = addWeeks(date, 1);
    return { date: startOfDay(date), explicitTime: false };
  }

  // "oxt weekend" — the weekend after next
  if (text === 'oxt weekend') {
    let date = nextDay(now, 6 as Day);
    if (isSameWeek(date, now)) date = addWeeks(date, 1);
    date = addWeeks(date, 1);
    return { date: startOfDay(date), explicitTime: false };
  }

  // "oxt monday" — the weekday after "next X" (i.e. two occurrences away)
  if ((m = text.match(/^oxt\s+([a-z]+)$/))) {
    const wd = matchWeekday(m[1]);
    if (wd !== undefined) {
      let date = nextDay(now, wd);
      if (isSameWeek(date, now)) date = addWeeks(date, 1);
      date = addWeeks(date, 1);
      return { date: startOfDay(date), explicitTime: false };
    }
  }

  // Weekday, optionally prefixed: "monday", "this fri", "next monday", "on tuesday"
  if ((m = text.match(/^(?:(this|next|coming|on)\s+)?([a-z]+)$/))) {
    const wd = matchWeekday(m[2]);
    if (wd !== undefined) {
      let date = nextDay(now, wd); // strictly the next occurrence (1–7 days ahead)
      if (m[1] === 'next' && isSameWeek(date, now)) date = addWeeks(date, 1);
      return { date: startOfDay(date), explicitTime: false };
    }
  }

  // "jun 15", "june 15 2026"
  if ((m = text.match(/^([a-z]+)\.?\s+(\d{1,2})(?:\s+(\d{4}))?$/))) {
    const month = MONTHS[m[1]];
    if (month !== undefined) {
      return monthDay(month, parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : null, now);
    }
  }
  // "15 jun", "15 june 2026"
  if ((m = text.match(/^(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?$/))) {
    const month = MONTHS[m[2]];
    if (month !== undefined) {
      return monthDay(month, parseInt(m[1], 10), m[3] ? parseInt(m[3], 10) : null, now);
    }
  }

  // ISO date "2026-12-25"
  if ((m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    return monthDay(parseInt(m[2], 10) - 1, parseInt(m[3], 10), parseInt(m[1], 10), now);
  }

  // Numeric "12/25", "12/25/2026", "12/25/26" (month first)
  if ((m = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) {
    let month = parseInt(m[1], 10) - 1;
    let day = parseInt(m[2], 10);
    if (month > 11 && day <= 12) {
      // Looks like day/month — swap.
      [month, day] = [day - 1, month + 1];
    }
    if (month > 11) return null;
    let year: number | null = null;
    if (m[3]) {
      year = parseInt(m[3], 10);
      if (year < 100) year += 2000;
    }
    return monthDay(month, day, year, now);
  }

  return null;
}

export function parseNaturalDate(input: string, now: Date = new Date()): Date | null {
  if (!input) return null;
  let text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return null;

  // Peel off a time-of-day first, so what's left is purely the date phrase.
  let time: ClockTime | null = null;
  const clock = extractTime(text);
  if (clock) {
    time = clock.time;
    text = clock.rest;
  } else {
    const part = extractDayPart(text);
    if (part) {
      time = part.time;
      text = part.rest;
    }
  }

  // Drop connector words/punctuation left dangling by the time extraction.
  text = text.replace(/\bat\b/g, ' ').replace(/@/g, ' ').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  const datePart = parseDatePart(text, now);

  let date: Date;
  let explicitTime = false;
  if (datePart) {
    date = datePart.date;
    explicitTime = datePart.explicitTime;
  } else if (time) {
    date = startOfDay(now); // time-only input → today
  } else {
    return null;
  }

  if (time) {
    date = atTime(date, time.h, time.m);
    // Pure time in the past (e.g. "3pm" typed at 5pm) rolls to tomorrow.
    if (!datePart && date.getTime() <= now.getTime()) {
      date = addDays(date, 1);
    }
  } else if (!explicitTime) {
    date = atTime(date, DEFAULT_HOUR, 0);
  }

  return date;
}
