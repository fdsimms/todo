import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import type { BusyEvent } from './calendarBusy';
import { allDayRangeMs, isLiveEvent } from './calendarBusy';
import { clockTimeToken, logicalDayStart } from './clockTime';
import { EVENT_MATCH_MAX_LENGTH, EVENT_MATCH_MIN_LENGTH, ruleMatchesTitle } from './eventTasks';

/**
 * On call: the stretches of the calendar the user is reachable for work, found
 * from the events the phone already reads, and what to say about them.
 *
 * Pure and store-free like `eventConflicts.ts`: the read is `useOnCallStore`, the
 * settings are `onCallCalendarIds` and `onCallWords`, and everything that decides
 * what counts and how it reads is here, where it is tested.
 *
 * **An event is on call when its calendar is marked as one, or its title holds one
 * of the words.** Either alone is enough, so a dedicated on-call calendar works
 * with no word set and a shared calendar works with only a word. The word test is
 * `ruleMatchesTitle`'s (whole word, case-insensitive, the same three-character
 * floor), so "on call" does not fire on "Oncology" and a word means here what it
 * means in an event rule.
 *
 * **Why this is not `occupiesTime` and `overlappingEvents`.** Those answer "is the
 * user busy", and they leave out all-day events and events marked Free. Both are
 * how on-call shifts are usually written: a weekend or a holiday is an all-day
 * event, and the shift is not something that blocks a meeting out. An on-call
 * span counts whatever its all-day flag or availability says. A canceled event
 * does not count, as everywhere else.
 *
 * **An all-day span is whole local days and a timed span is a moment range.**
 * `allDayRangeMs` reads an all-day event's own dates back as local midnights,
 * so "Saturday" is Saturday in any time zone, and a day the app calls Saturday
 * (starting at `dayResetTime`) still contains it from 4 AM on Saturday until 4 AM
 * on Sunday, not until midnight.
 */

/** How far ahead on-call is read: a trip is planned weeks out, past the fortnight. */
export const ON_CALL_WINDOW_DAYS = 90;

/** The most words that can mark an event as on call, as `EVENT_RULE_MAX_MATCHES` caps a rule. */
export const ON_CALL_MAX_WORDS = 6;

export interface OnCallConfig {
  /** EventKit ids of the calendars that are on call. */
  calendarIds: readonly string[];
  words: readonly string[];
}

/** One on-call stretch. `start`/`end` are epoch ms, `end` exclusive. */
export interface OnCallSpan {
  start: number;
  end: number;
  /** Whole local days (an all-day event) rather than a clock range. */
  allDay: boolean;
}

/** Whether anything is set that could mark an event as on call. */
export function onCallConfigured(config: OnCallConfig): boolean {
  return config.calendarIds.length > 0 || cleanWords(config.words).length > 0;
}

/**
 * A word list as stored: strings, trimmed, deduplicated ignoring case, at least
 * `EVENT_MATCH_MIN_LENGTH` characters (a shorter cue is inside far too much) and at
 * most `EVENT_MATCH_MAX_LENGTH`, and no more than `ON_CALL_MAX_WORDS` of them.
 */
export function cleanWords(words: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    if (typeof word !== 'string') continue;
    const trimmed = word.trim().replace(/\s+/g, ' ');
    const key = trimmed.toLowerCase();
    if (trimmed.length < EVENT_MATCH_MIN_LENGTH || trimmed.length > EVENT_MATCH_MAX_LENGTH) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length === ON_CALL_MAX_WORDS) break;
  }
  return out;
}

/** The words as typed in the Settings field: comma-separated. */
export function splitTypedWords(typed: string): string[] {
  return typed.split(',').map(part => part.trim()).filter(part => part.length > 0);
}

/**
 * Why some of what was typed will not be used, or null when all of it will be.
 * `cleanWords` drops a word that is too short, too long or past the cap, and a
 * field that quietly drops what it was given is the one thing a field may not do,
 * so the row says it while it is typed.
 */
export function onCallWordsProblem(typed: string): string | null {
  const parts = splitTypedWords(typed);
  const short = parts.find(part => part.length < EVENT_MATCH_MIN_LENGTH);
  if (short !== undefined) {
    return `\u201c${short}\u201d is too short. Each word needs at least ${EVENT_MATCH_MIN_LENGTH} letters.`;
  }
  const long = parts.find(part => part.length > EVENT_MATCH_MAX_LENGTH);
  if (long !== undefined) return `Each word can be at most ${EVENT_MATCH_MAX_LENGTH} letters. Shorten \u201c${long.slice(0, 12)}\u2026\u201d.`;
  if (cleanWords(parts).length < new Set(parts.map(part => part.toLowerCase().replace(/\s+/g, ' '))).size) {
    return `Only the first ${ON_CALL_MAX_WORDS} words are used. Remove some to use the rest.`;
  }
  return null;
}

/** The stored words, or none for anything unreadable. */
export function parseOnCallWords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? cleanWords(parsed) : [];
  } catch {
    return [];
  }
}

/** Whether this event is an on-call one. */
export function isOnCallEvent(event: BusyEvent, config: OnCallConfig): boolean {
  if (!isLiveEvent(event)) return false;
  if (config.calendarIds.includes(event.calendarId)) return true;
  const words = cleanWords(config.words);
  return words.length > 0 && ruleMatchesTitle({ matches: words }, event.title);
}

/**
 * The on-call spans in these events, earliest first and merged: overlapping or
 * touching spans of one kind become one, so Saturday and Sunday written as two
 * all-day events are one weekend, and a shift copied onto two calendars is one
 * shift. All-day and timed spans are never merged into each other.
 */
export function onCallSpans(events: readonly BusyEvent[], config: OnCallConfig): OnCallSpan[] {
  const raw: OnCallSpan[] = [];
  for (const event of events) {
    if (!isOnCallEvent(event, config)) continue;
    if (event.allDay) {
      const range = allDayRangeMs(event);
      if (range && range.end > range.start) raw.push({ ...range, allDay: true });
    } else {
      const start = Date.parse(event.start);
      const end = Date.parse(event.end);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) raw.push({ start, end, allDay: false });
    }
  }
  raw.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: OnCallSpan[] = [];
  // The last span of each kind, since the two are never merged into each other.
  const lastOfKind: { timed?: OnCallSpan; allDay?: OnCallSpan } = {};
  for (const span of raw) {
    const key = span.allDay ? 'allDay' : 'timed';
    const last = lastOfKind[key];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      const next = { ...span };
      merged.push(next);
      lastOfKind[key] = next;
    }
  }
  return merged.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Local midnight at the start of the calendar date `date` falls on. */
function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Whether a span touches [start, end). A timed span is compared as moments. An
 * all-day span has a date to be on, not a clock time to be inside, so the range
 * is widened to the whole local days it touches first (`allDayWindowMs` in
 * `calendarBusy.ts` is the same widening, for the same bug).
 */
export function spanTouches(span: OnCallSpan, start: Date, end: Date): boolean {
  if (!(end.getTime() > start.getTime())) return false;
  if (!span.allDay) return span.start < end.getTime() && span.end > start.getTime();
  const first = localMidnight(start);
  const lastExclusive = addDays(localMidnight(new Date(end.getTime() - 1)), 1);
  return span.start < lastExclusive.getTime() && span.end > first.getTime();
}

/** The spans touching [start, end), earliest first. */
export function onCallDuring(spans: readonly OnCallSpan[], start: Date, end: Date): OnCallSpan[] {
  return spans.filter(span => spanTouches(span, start, end));
}

/**
 * The spans touching one app day, [start, end) from `appDay`. An all-day span is
 * compared against the calendar date the day starts on, not both dates a 4 AM to
 * 4 AM day reaches into: Friday's app day does not touch Saturday's all-day event
 * for its last four hours (#2019 is the same mistake in `calendarBusy.ts`).
 */
function onCallOnDay(spans: readonly OnCallSpan[], day: { start: Date; end: Date }): OnCallSpan[] {
  const date = localMidnight(day.start);
  return spans.filter(span => (span.allDay
    ? spanTouches(span, date, addDays(date, 1))
    : spanTouches(span, day.start, day.end)));
}

/** The app's day that the instant `date` falls in, as [start, next start). */
function appDay(date: Date, dayResetTime: string): { start: Date; end: Date } {
  const start = logicalDayStart(date, dayResetTime);
  return { start, end: addDays(start, 1) };
}

/**
 * The app's day for a calendar date a picker returned. Anchored at noon, never at
 * the date's own midnight: midnight is before the reset time, so it reads as the
 * day before (the bug `getDayStart`'s callers guard against).
 */
function appDayOfDate(date: Date, dayResetTime: string): { start: Date; end: Date } {
  return appDay(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12), dayResetTime);
}

// ---- Events that clash with a shift ----

/**
 * The events that run into an on-call stretch: live, not themselves on call, and
 * not marked Free (a free event is one the user says does not take them away). An
 * all-day event counts, by the days it names; a timed one by its hours. These are
 * what the "find someone to swap" tasks (`onCallSwapTasks.ts`) are written for.
 */
export function onCallConflicts(
  events: readonly BusyEvent[],
  config: OnCallConfig,
  spans: readonly OnCallSpan[],
): BusyEvent[] {
  if (spans.length === 0) return [];
  return events.filter(event => {
    if (!isLiveEvent(event) || isOnCallEvent(event, config) || event.availability === 'free') return false;
    let start: Date;
    let end: Date;
    if (event.allDay) {
      const range = allDayRangeMs(event);
      if (!range || range.end <= range.start) return false;
      start = new Date(range.start);
      end = new Date(range.end);
    } else {
      start = new Date(event.start);
      end = new Date(event.end);
    }
    return spans.some(span => spanTouches(span, start, end));
  });
}

// ---- Today's strip ----

/**
 * What a day's strip says, one line per stretch: nothing when the user is not on
 * call that day. `now` and `dayResetTime` are parameters so a test can pin both.
 *
 * - **All-day:** "All day", or "All day through Sun, Nov 22" while the run goes on
 *   past today.
 * - **A shift still to come:** "9:00 AM to 5:00 PM", with the day named only when it
 *   crosses midnight ("5:00 PM today to 8:00 AM tomorrow"), since a time with no
 *   day is how an overnight shift reads as ending before it began.
 * - **A shift under way:** "Until 5:00 PM", and "Until 8:00 AM tomorrow" if that is
 *   the next day. A shift that has ended is not listed.
 */
export function onCallStripLines(
  spans: readonly OnCallSpan[],
  now: Date,
  dayResetTime: string,
  use24Hour: boolean,
): string[] {
  const day = appDay(now, dayResetTime);
  const today = localMidnight(day.start);
  const lines: string[] = [];
  for (const span of spans) {
    if (!span.allDay || !onCallOnDay([span], day).length) continue;
    // The merged run's last day is the day before its exclusive end.
    const lastDay = addDays(new Date(span.end), -1);
    lines.push(differenceInCalendarDays(lastDay, today) <= 0
      ? 'All day'
      : `All day through ${format(lastDay, 'EEE, MMM d')}`);
  }
  const clock = clockTimeToken(use24Hour);
  const dayWord = (date: Date): string => {
    const diff = differenceInCalendarDays(appDay(date, dayResetTime).start, day.start);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    return format(date, 'EEE, MMM d');
  };
  for (const span of spans) {
    if (span.allDay || !onCallOnDay([span], day).length) continue;
    const start = new Date(span.start);
    const end = new Date(span.end);
    if (end.getTime() <= now.getTime()) continue;
    const endsToday = appDay(new Date(span.end - 1), dayResetTime).start.getTime() === day.start.getTime();
    if (start.getTime() <= now.getTime()) {
      lines.push(`Until ${format(end, clock)}${endsToday ? '' : ` ${dayWord(new Date(span.end - 1))}`}`);
    } else if (endsToday) {
      lines.push(`${format(start, clock)} to ${format(end, clock)}`);
    } else {
      lines.push(`${format(start, clock)} ${dayWord(start)} to ${format(end, clock)} ${dayWord(new Date(span.end - 1))}`);
    }
  }
  return lines;
}

// ---- Warnings ----

const YOURE_ON_CALL = 'You’re on call';

/** A stretch as a phrase, for a warning about one moment or one day. */
function describeSpan(span: OnCallSpan, around: Date, use24Hour: boolean): string {
  if (span.allDay) return 'all day';
  const clock = clockTimeToken(use24Hour);
  const start = new Date(span.start);
  const end = new Date(span.end);
  // A day word on the end that isn't the day being asked about, so an overnight
  // shift does not read as 5 PM to 8 AM of the same date.
  const named = (d: Date, dayOf: Date) => (differenceInCalendarDays(d, dayOf) === 0
    ? format(d, clock)
    : `${format(d, 'EEE')} ${format(d, clock)}`);
  return `${named(start, around)} to ${named(end, around)}`;
}

function joinPhrases(phrases: string[]): string {
  if (phrases.length <= 2) return phrases.join(' and ');
  return `${phrases[0]}, ${phrases[1]} and ${phrases.length - 2} more`;
}

/**
 * The warning for a time: a timed event, or a task with a clock time, over
 * [start, end). Null when it clears every on-call stretch. A task with a time is
 * a moment, so its `end` is `start` plus a minute.
 *
 * Says when, since an on-call day is often only part of one ("You're on call 9:00
 * AM to 5:00 PM") and a warning for a dinner at 7 that says only "on call" sends
 * the user to the calendar to find out it doesn't clash.
 */
export function onCallWarningForTime(
  spans: readonly OnCallSpan[],
  start: Date,
  end: Date,
  use24Hour: boolean,
): string | null {
  const hits = onCallDuring(spans, start, end);
  if (hits.length === 0) return null;
  const phrases = [...new Set(hits.map(span => describeSpan(span, start, use24Hour)))];
  return `${YOURE_ON_CALL} ${joinPhrases(phrases)}`;
}

/**
 * The warning for a day with no time on it: a task dated that day, or an all-day
 * event. Any stretch that day counts.
 */
export function onCallWarningForDay(
  spans: readonly OnCallSpan[],
  date: Date,
  dayResetTime: string,
  use24Hour: boolean,
): string | null {
  const day = appDayOfDate(date, dayResetTime);
  const hits = onCallOnDay(spans, day);
  if (hits.length === 0) return null;
  if (hits.some(span => span.allDay)) return `${YOURE_ON_CALL} all day`;
  const phrases = hits.map(span => describeSpan(span, day.start, use24Hour));
  return `${YOURE_ON_CALL} ${joinPhrases(phrases)}`;
}

/**
 * The warning for a run of days, a trip's: how many of them have any on-call
 * stretch. `first` and `last` are the first and last day, both included.
 */
export function onCallWarningForDays(
  spans: readonly OnCallSpan[],
  first: Date,
  last: Date,
  dayResetTime: string,
): string | null {
  const total = differenceInCalendarDays(last, first) + 1;
  if (total < 1) return null;
  let count = 0;
  for (let i = 0; i < total; i++) {
    const day = appDayOfDate(addDays(first, i), dayResetTime);
    if (onCallOnDay(spans, day).length > 0) count += 1;
  }
  if (count === 0) return null;
  if (total === 1) return `${YOURE_ON_CALL} on this day`;
  if (count === total) return `${YOURE_ON_CALL} on all ${total} of these days`;
  return `${YOURE_ON_CALL} on ${count} of these ${total} days`;
}
