/**
 * Reading the mood log as *history*: the whole of it, filtered, and one
 * symptom at a time.
 *
 * The third pure module of the feature, and the split is the same one
 * `moodLog.ts` and `moodInsights.ts` already make. `moodLog.ts` answers what an
 * entry is and what a single day of them says; `moodInsights.ts` answers what a
 * pile of them means *against your tasks*, which is where all the arithmetic
 * that can lie lives. Neither answers "show me every headache I have had",
 * which needs no join and makes no claim — it is the log itself, narrowed.
 *
 * **Nothing here is an insight and nothing here is allowed to become one.**
 * Every number is a count or a date the user can check against their own
 * entries: how many days a symptom appeared on, when it last did, how bad it
 * got. `moodInsights.ts`'s three rules govern comparisons between two
 * variables; a tally of one variable is not a comparison, which is why
 * `MIN_PAIRED_DAYS` has no business gating this and does not. A person who has
 * logged a headache twice is entitled to see both of them.
 */

import { addMonths } from 'date-fns/addMonths';
import { format } from 'date-fns/format';
import type { JournalEntry, LoggedSymptom, MoodLevel, MoodLog, SymptomSeverity } from '../types';
import { contextTagKey, symptomKey } from './moodLog';

/**
 * What the history list is narrowed to.
 *
 * Every dimension is a set, empty meaning "no constraint on this". Within a
 * dimension the sets are OR (any of these symptoms), across dimensions they are
 * AND (a headache day *that was also* a travel day) — the shape a person reads
 * a filter row as, and the one `LogbookFilterSheet` already uses for tags.
 */
export interface MoodFilter {
  /** Match keys (see `symptomKey`), not display names. */
  symptomKeys: string[];
  /** Match keys (see `contextTagKey`), not display names. */
  contextTagKeys: string[];
  moods: MoodLevel[];
  /** Only entries with words in them. A switch rather than a set, so it ANDs with the rest. */
  withNote: boolean;
}

export const EMPTY_MOOD_FILTER: MoodFilter = {
  symptomKeys: [], contextTagKeys: [], moods: [], withNote: false,
};

export function isMoodFilterActive(filter: MoodFilter): boolean {
  return filter.symptomKeys.length > 0
    || filter.contextTagKeys.length > 0
    || filter.moods.length > 0
    || filter.withNote;
}

/** True when the entry has a note with something other than whitespace in it. */
export function hasWrittenNote(log: MoodLog): boolean {
  return !!log.note && log.note.trim().length > 0;
}

/** Add or remove one value from one of the filter's sets. */
export function toggleFilterValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter(v => v !== value) : [...values, value];
}

/**
 * The entries a filter keeps, newest first.
 *
 * Filters *entries* rather than days, which matters for the one case where the
 * two disagree: several entries a day is the normal case (see `mood-log.md`),
 * so a day holding a cheerful morning and a rough evening is a day you want
 * shown as its rough evening when you have asked for the low ones. Collapsing
 * to the day first would answer with the average, which is a number nobody
 * logged.
 *
 * An entry with no mood never matches a mood filter. It is not a 3.
 */
export function filterMoodLogs(logs: readonly MoodLog[], filter: MoodFilter): MoodLog[] {
  return logs.filter(log => {
    if (filter.withNote && !hasWrittenNote(log)) return false;
    if (filter.moods.length > 0 && (log.mood === null || !filter.moods.includes(log.mood))) {
      return false;
    }
    if (filter.symptomKeys.length > 0) {
      const keys = log.symptoms.map(s => symptomKey(s.name));
      if (!filter.symptomKeys.some(k => keys.includes(k))) return false;
    }
    if (filter.contextTagKeys.length > 0) {
      const keys = log.contextTags.map(contextTagKey);
      if (!filter.contextTagKeys.some(k => keys.includes(k))) return false;
    }
    return true;
  });
}

/**
 * The entries whose note contains every word of `query`, in any order,
 * ignoring case. An empty query keeps everything.
 *
 * Written text only: symptoms and tags already have their own filter chips, and
 * matching them here too would make a search for "head" answer with every
 * headache whether or not you wrote the word. Plain substring matching
 * (`textMatchesQuery`), for the reason `symptomKey` refuses anything fuzzier: a
 * search that quietly returns near-misses is an answer about words the person
 * did not write.
 */
export function searchMoodLogs(logs: readonly MoodLog[], query: string): MoodLog[] {
  if (queryWords(query).length === 0) return [...logs];
  return logs.filter(log => hasWrittenNote(log) && textMatchesQuery(log.note!, query));
}

function queryWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Whether `text` contains every word of `query`, in any order, ignoring case.
 * An empty query matches. The rule the mood note search and the journal
 * search share, so the two can't drift apart.
 */
export function textMatchesQuery(text: string, query: string): boolean {
  const words = queryWords(query);
  if (words.length === 0) return true;
  const lower = text.toLowerCase();
  return words.every(w => lower.includes(w));
}

/**
 * The nearest days either side of `dayKey` that have an entry, for paging a
 * diary one written day at a time. Days with nothing logged are skipped rather
 * than shown as blank pages, which is rule 3 of `moodInsights.ts` as a layout
 * rule again.
 */
export function adjacentLogDays(
  logs: readonly Pick<MoodLog, 'dayKey'>[],
  dayKey: string,
): { previous: string | null; next: string | null } {
  let previous: string | null = null;
  let next: string | null = null;
  for (const log of logs) {
    const k = log.dayKey;
    if (k < dayKey && (previous === null || k > previous)) previous = k;
    if (k > dayKey && (next === null || k < next)) next = k;
  }
  return { previous, next };
}

/** One day's worth of the history list. */
export interface MoodLogDay {
  dayKey: string;
  /** Oldest first — the order a day happened in. */
  logs: MoodLog[];
}

/**
 * The entries grouped into days, newest day first and each day read forwards.
 *
 * The two orders are deliberately opposite and both are right: a history list
 * starts with the most recent day, and a day is a morning followed by an
 * evening.
 */
export function groupLogsByDay(logs: readonly MoodLog[]): MoodLogDay[] {
  const byDay = new Map<string, MoodLog[]>();
  for (const log of logs) {
    const bucket = byDay.get(log.dayKey);
    if (bucket) bucket.push(log);
    else byDay.set(log.dayKey, [log]);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dayKey, entries]) => ({
      dayKey,
      logs: [...entries].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)),
    }));
}

/** Everything the log holds about one symptom. Counts and dates, never a claim. */
export interface SymptomStat {
  /** The match key. */
  key: string;
  /** What to show: the casing used on the most recent entry carrying it. */
  name: string;
  /** Days it appeared on. The headline number, since a day is the unit here. */
  dayCount: number;
  /** Entries it appeared on, which is larger whenever a day was logged twice. */
  entryCount: number;
  /** Most recent day it appeared on, and the first. Both `yyyy-MM-dd`. */
  lastDayKey: string;
  firstDayKey: string;
  /** How many days it reached each severity at its worst that day. */
  daysBySeverity: Record<SymptomSeverity, number>;
}

/**
 * The stats for every symptom in the log, most days first.
 *
 * Counted at the day's *worst*, the same collapse `daySymptoms` makes: a
 * headache that started mild and ended severe was a severe-headache day, and
 * counting both would have one day appear in two severity buckets.
 */
export function symptomStats(logs: readonly MoodLog[]): SymptomStat[] {
  const acc = new Map<string, {
    name: string;
    nameAt: string;
    entryCount: number;
    worstByDay: Map<string, SymptomSeverity>;
  }>();
  for (const log of logs) {
    for (const symptom of log.symptoms) {
      const key = symptomKey(symptom.name);
      if (!key) continue;
      let row = acc.get(key);
      if (!row) {
        acc.set(key, (row = {
          name: symptom.name.trim(), nameAt: log.loggedAt, entryCount: 0, worstByDay: new Map(),
        }));
      }
      // The casing from the most recent entry, so a symptom the user has since
      // started capitalising reads the way they write it now.
      if (log.loggedAt > row.nameAt) {
        row.name = symptom.name.trim();
        row.nameAt = log.loggedAt;
      }
      row.entryCount++;
      const worst = row.worstByDay.get(log.dayKey);
      if (worst === undefined || symptom.severity > worst) {
        row.worstByDay.set(log.dayKey, symptom.severity);
      }
    }
  }

  const stats: SymptomStat[] = [];
  for (const [key, row] of acc) {
    const dayKeys = [...row.worstByDay.keys()].sort();
    const daysBySeverity: Record<SymptomSeverity, number> = { 1: 0, 2: 0, 3: 0 };
    for (const severity of row.worstByDay.values()) daysBySeverity[severity]++;
    stats.push({
      key,
      name: row.name,
      dayCount: dayKeys.length,
      entryCount: row.entryCount,
      firstDayKey: dayKeys[0],
      lastDayKey: dayKeys[dayKeys.length - 1],
      daysBySeverity,
    });
  }
  return stats.sort((a, b) => b.dayCount - a.dayCount || a.name.localeCompare(b.name));
}

/** One symptom's stats, or null when nothing in the log carries it. */
export function symptomStatFor(logs: readonly MoodLog[], key: string): SymptomStat | null {
  return symptomStats(logs).find(s => s.key === symptomKey(key)) ?? null;
}

/**
 * How bad one symptom got on one day, or null for a day it wasn't logged on.
 *
 * Null rather than 0 because 0 is not on the severity scale and a day without
 * a symptom is not a day with a very mild one. The chart draws a gap.
 */
export function symptomSeverityOnDay(
  logs: readonly MoodLog[],
  key: string,
  dayKey: string,
): SymptomSeverity | null {
  const match = symptomKey(key);
  let worst: SymptomSeverity | null = null;
  for (const log of logs) {
    if (log.dayKey !== dayKey) continue;
    for (const symptom of log.symptoms) {
      if (symptomKey(symptom.name) !== match) continue;
      if (worst === null || symptom.severity > worst) worst = symptom.severity;
    }
  }
  return worst;
}

/** Every entry carrying one symptom, newest first. */
export function logsWithSymptom(logs: readonly MoodLog[], key: string): MoodLog[] {
  const match = symptomKey(key);
  return logs.filter(log => log.symptoms.some(s => symptomKey(s.name) === match));
}

/** The severity recorded for one symptom on one entry, for a row that shows it. */
export function symptomOnLog(log: MoodLog, key: string): LoggedSymptom | null {
  const match = symptomKey(key);
  return log.symptoms.find(s => symptomKey(s.name) === match) ?? null;
}

/**
 * The entries falling within a day range, inclusive at both ends.
 *
 * Day keys compare as strings because `yyyy-MM-dd` sorts lexically, which is
 * the same reason every other day-key comparison in the feature is a string
 * comparison rather than a `Date` round trip.
 */
export function logsInDayRange(
  logs: readonly MoodLog[],
  fromDayKey: string | null,
  toDayKey: string | null,
): MoodLog[] {
  return logs.filter(log =>
    (fromDayKey === null || log.dayKey >= fromDayKey)
    && (toDayKey === null || log.dayKey <= toDayKey));
}

/** How far back "looking back" reaches, in months: a month, a season, then each year. */
const LOOK_BACK_MONTHS = [1, 3, 6, 12, 24, 36, 48, 60];

/** Most look-backs shown at once, so a long log doesn't turn the card into a feed. */
const MAX_LOOK_BACKS = 3;

export interface LookBack {
  /** "A month ago", "A year ago"; the same wording on every device. */
  label: string;
  dayKey: string;
  /** That day's entries that have words in them, oldest first. */
  logs: MoodLog[];
  /** That day's journal entries and dreams, oldest first (`docs/arch/journal.md`). */
  journal: JournalEntry[];
}

function lookBackLabel(months: number): string {
  if (months === 1) return 'A month ago';
  if (months < 12) return `${months} months ago`;
  const years = months / 12;
  return years === 1 ? 'A year ago' : `${years} years ago`;
}

/**
 * Days you wrote something on, one month, three, six and then each year back
 * from `todayDayKey`, the diary's "on this day".
 *
 * **Only entries with words count**: a mood entry's note, or a journal entry or
 * dream from that day. A mood with no words is a number, and a
 * number from a year ago with nothing to say about it is not something to
 * resurface. **A day with nothing to show is absent, never filled in** (rule 3
 * of `moodInsights.ts`, here as a layout rule): no placeholder for the month
 * you didn't write, and the card disappears when there is nothing at all.
 *
 * It reads and never interprets: no comparison with today's mood, no "you were
 * happier then". That would be a claim, and this is the log itself, narrowed.
 * Most recent first, capped at `MAX_LOOK_BACKS`.
 */
export function lookBacks(
  logs: readonly MoodLog[],
  todayDayKey: string,
  journal: readonly JournalEntry[] = [],
): LookBack[] {
  // Not `dateUtils`: that module pulls in the database, and this one stays pure.
  const today = new Date(`${todayDayKey}T00:00:00`);
  const found: LookBack[] = [];
  for (const months of LOOK_BACK_MONTHS) {
    const dayKey = format(addMonths(today, -months), 'yyyy-MM-dd');
    const written = logs
      .filter(l => l.dayKey === dayKey && hasWrittenNote(l))
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
    const pages = journal
      .filter(e => e.dayKey === dayKey)
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
    if (written.length > 0 || pages.length > 0) {
      found.push({ label: lookBackLabel(months), dayKey, logs: written, journal: pages });
    }
    if (found.length === MAX_LOOK_BACKS) break;
  }
  return found;
}
