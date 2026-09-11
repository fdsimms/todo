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

import type { LoggedSymptom, MoodLevel, MoodLog, SymptomSeverity } from '../types';
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
}

export const EMPTY_MOOD_FILTER: MoodFilter = {
  symptomKeys: [], contextTagKeys: [], moods: [],
};

export function isMoodFilterActive(filter: MoodFilter): boolean {
  return filter.symptomKeys.length > 0
    || filter.contextTagKeys.length > 0
    || filter.moods.length > 0;
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
