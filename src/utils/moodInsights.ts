import { format } from 'date-fns/format';
import { logicalDayStart } from './clockTime';
import { isRealCompletion } from './missed';
import { dayMoodAverage, daySymptoms, symptomKey, LOW_MOOD_AT_OR_BELOW } from './moodLog';
import type { MoodLog, Task, TimeOfDay } from '../types';

/**
 * Reading a pile of mood entries *against the tasks you got done*.
 *
 * This is the half of the feature that justifies it living in a to-do app at
 * all: a standalone mood tracker is a solved problem and the app store is full
 * of them, but none of them know what you did on the days they recorded. Every
 * number here is a join between two datasets only this app holds at once.
 *
 * Deliberately store-free, like `weatherTasks.ts` and `calendarReviewTasks.ts`
 * — the caller passes `dayResetTime` rather than this module reaching
 * `useSettingsStore`, which would drag `expo-sqlite` into every test that
 * imports it.
 *
 * **Everything here is an association and none of it is a cause**, and that is
 * a correctness constraint rather than a disclaimer to print under a chart. A
 * feature that tells somebody their headaches are caused by their task load is
 * making a medical claim off a handful of self-reported days. Three rules keep
 * that honest, and none of them should be relaxed to make a screen look
 * fuller:
 *
 * 1. **Nothing is reported below `MIN_PAIRED_DAYS` paired days.** With four
 *    days of data every pair of variables correlates at something eye-catching.
 * 2. **The correlation is reported as a direction and a strength, never as a
 *    coefficient.** `r = 0.42` reads as a finding to a person who last met the
 *    word in school; "you tend to finish a little more on better days" reads as
 *    what it is.
 * 3. **A day you didn't log is not a zero.** It is absent, everywhere, in every
 *    read here — see `pairedDays`. Treating it as a zero is the single easiest
 *    way to invent a trend out of a fortnight of not opening the app.
 */

/**
 * The fewest paired days before any comparison is offered.
 *
 * Not a statistical threshold — no threshold makes a fortnight of self-reports
 * a study. It is the point below which a number is obviously noise to the
 * person reading it, chosen so the screen stays quiet for the first couple of
 * weeks rather than showing a confident-looking finding built from four days.
 */
export const MIN_PAIRED_DAYS = 10;

/** The fewest days on each side before a two-group contrast is offered. */
export const MIN_CONTRAST_DAYS = 3;

/** One logical day, with what you recorded and what you finished on it. */
export interface MoodDay {
  dayKey: string;
  /** The day's average mood, or null for a day logged without one. */
  mood: number | null;
  /** Symptom names logged that day, lowercased for matching. */
  symptomKeys: string[];
  /** Top-level real completions that day. Subtasks and missed rows excluded. */
  completed: number;
  /** Categories completed that day, each counted once — the "kind" of work. */
  categories: string[];
}

/**
 * The logical day an instant belongs to, under the user's own reset time.
 *
 * The grace-window rule from CLAUDE.md, applied to a *read* rather than to
 * scheduling: a task finished at 1am with a 02:00 reset was finished on
 * yesterday's list, and counting it under the calendar date would file it
 * against a mood entry from a different day. That is the exact off-by-one this
 * whole join would be wrong by, every night, for anyone with a non-midnight
 * reset — and unlike a misplaced task it would never look like a bug, just
 * like a weak correlation.
 */
export function completionDayKey(completedAt: string, dayResetTime: string): string {
  return format(logicalDayStart(new Date(completedAt), dayResetTime), 'yyyy-MM-dd');
}

/**
 * Every day either dataset says something about, oldest first.
 *
 * Days are built from the union of "you logged" and "you finished something",
 * then filtered by the readers below to whatever each one needs paired. A day
 * present in only one dataset is kept here and dropped there — which is what
 * makes rule 3 above a property of the data rather than a thing every caller
 * has to remember.
 */
export function buildMoodDays(
  logs: readonly MoodLog[],
  tasks: readonly Task[],
  dayResetTime: string,
): MoodDay[] {
  const days = new Map<string, MoodDay>();
  const dayFor = (dayKey: string): MoodDay => {
    let day = days.get(dayKey);
    if (!day) {
      day = { dayKey, mood: null, symptomKeys: [], completed: 0, categories: [] };
      days.set(dayKey, day);
    }
    return day;
  };

  for (const log of logs) {
    const day = dayFor(log.dayKey);
    if (day.mood === null) {
      day.mood = dayMoodAverage(logs, log.dayKey);
      day.symptomKeys = daySymptoms(logs, log.dayKey).map(s => symptomKey(s.name));
    }
  }
  // A day whose entries were all symptoms-only still needs its symptoms, and
  // the loop above only fills them alongside a mood it found. Cheap to redo
  // for the handful of such days rather than restructuring the pass.
  for (const day of days.values()) {
    if (day.symptomKeys.length === 0) {
      day.symptomKeys = daySymptoms(logs, day.dayKey).map(s => symptomKey(s.name));
    }
  }

  const categoriesByDay = new Map<string, Set<string>>();
  for (const task of tasks) {
    if (task.parentId || !isRealCompletion(task) || !task.completedAt) continue;
    const dayKey = completionDayKey(task.completedAt, dayResetTime);
    const day = dayFor(dayKey);
    day.completed++;
    if (task.category) {
      let set = categoriesByDay.get(dayKey);
      if (!set) categoriesByDay.set(dayKey, (set = new Set()));
      set.add(task.category);
    }
  }
  for (const [dayKey, set] of categoriesByDay) {
    dayFor(dayKey).categories = [...set].sort();
  }

  return [...days.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

/** Only the days that can actually be compared: a mood *and* a task count. */
export function pairedDays(days: readonly MoodDay[]): MoodDay[] {
  return days.filter(d => d.mood !== null);
}

/** Pearson's r over two equal-length series, or null when it is undefined. */
export function correlation(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let dxSq = 0;
  let dySq = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    dxSq += dx * dx;
    dySq += dy * dy;
  }
  // Zero variance on either side: every mood the same, or the same number of
  // tasks every day. Genuinely undefined rather than zero — "no relationship"
  // would be a claim, and there is nothing here to have one.
  if (dxSq === 0 || dySq === 0) return null;
  return num / Math.sqrt(dxSq * dySq);
}

export type CorrelationStrength = 'none' | 'slight' | 'moderate' | 'strong';

/**
 * What a coefficient is allowed to be called out loud.
 *
 * Bands rather than the number, per rule 2 above. The cut-offs are the
 * conventional social-science ones and are not load-bearing — what matters is
 * that everything below 0.2 is reported as no pattern rather than as a weak
 * one, since that band is where a fortnight of noise lands.
 */
export function correlationStrength(r: number): CorrelationStrength {
  const abs = Math.abs(r);
  if (abs < 0.2) return 'none';
  if (abs < 0.4) return 'slight';
  if (abs < 0.6) return 'moderate';
  return 'strong';
}

export interface MoodCompletionInsight {
  /** Days with both a mood and a completion count. */
  dayCount: number;
  /** Null when there aren't enough days, or the correlation is undefined. */
  r: number | null;
  strength: CorrelationStrength | null;
  direction: 'more' | 'fewer' | null;
  /** Average completions on good days (mood > 3) and on low days. */
  completedOnGoodDays: number | null;
  completedOnLowDays: number | null;
}

/**
 * Does what you get done move with how you feel?
 *
 * The headline read, and the one the feature was asked for. Returns the shape
 * even when there isn't enough data — with nulls in it — so the screen can say
 * "keep logging, 4 days to go" rather than rendering nothing and leaving
 * somebody wondering whether it is broken.
 */
export function moodCompletionInsight(days: readonly MoodDay[]): MoodCompletionInsight {
  const paired = pairedDays(days);
  const base: MoodCompletionInsight = {
    dayCount: paired.length,
    r: null,
    strength: null,
    direction: null,
    completedOnGoodDays: null,
    completedOnLowDays: null,
  };
  if (paired.length < MIN_PAIRED_DAYS) return base;

  const r = correlation(paired.map(d => d.mood as number), paired.map(d => d.completed));
  const good = paired.filter(d => (d.mood as number) > 3);
  const low = paired.filter(d => (d.mood as number) <= LOW_MOOD_AT_OR_BELOW);
  return {
    ...base,
    r,
    strength: r === null ? null : correlationStrength(r),
    direction: r === null ? null : r >= 0 ? 'more' : 'fewer',
    completedOnGoodDays: good.length > 0 ? mean(good.map(d => d.completed)) : null,
    completedOnLowDays: low.length > 0 ? mean(low.map(d => d.completed)) : null,
  };
}

function mean(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export interface GroupContrast {
  /** The category or symptom this row is about. */
  label: string;
  /** Days in the group, and days outside it. Both are reported, never hidden. */
  withDays: number;
  withoutDays: number;
  moodWith: number;
  moodWithout: number;
  /** Positive means better mood on the days this thing was present. */
  delta: number;
}

/**
 * For each category of work: how your mood ran on the days you finished some,
 * against the days you didn't.
 *
 * This is the "kind of tasks" half of the ask. A contrast rather than a
 * correlation because the variable is a yes/no — you either got some admin
 * done that day or you didn't — and averaging two groups is both the honest
 * summary and the one a person can check against their own memory.
 *
 * Sorted by the size of the gap in either direction, since "the days I do
 * chores are noticeably worse" is exactly as interesting as the reverse and a
 * one-sided sort would only ever show good news.
 */
export function categoryMoodContrasts(days: readonly MoodDay[]): GroupContrast[] {
  const paired = pairedDays(days);
  if (paired.length < MIN_PAIRED_DAYS) return [];
  const labels = new Set<string>();
  for (const day of paired) for (const c of day.categories) labels.add(c);
  return contrastsFor(paired, [...labels], (day, label) => day.categories.includes(label));
}

/**
 * For each symptom: how your mood ran on the days you had it, against the days
 * you didn't.
 *
 * Same shape as the category read and deliberately so — one function below
 * builds both. What differs is only which days count as "with", and writing
 * that twice is how the two would drift into reporting the same thing two
 * different ways.
 */
export function symptomMoodContrasts(days: readonly MoodDay[]): GroupContrast[] {
  const paired = pairedDays(days);
  if (paired.length < MIN_PAIRED_DAYS) return [];
  const labels = new Set<string>();
  for (const day of paired) for (const s of day.symptomKeys) labels.add(s);
  return contrastsFor(paired, [...labels], (day, label) => day.symptomKeys.includes(label));
}

function contrastsFor(
  paired: readonly MoodDay[],
  labels: readonly string[],
  present: (day: MoodDay, label: string) => boolean,
): GroupContrast[] {
  const rows: GroupContrast[] = [];
  for (const label of labels) {
    const withIt = paired.filter(d => present(d, label));
    const without = paired.filter(d => !present(d, label));
    // Both sides need enough days: a symptom logged twice tells you nothing
    // about its days, and a category you completed on every single day has no
    // "without" to compare against.
    if (withIt.length < MIN_CONTRAST_DAYS || without.length < MIN_CONTRAST_DAYS) continue;
    const moodWith = mean(withIt.map(d => d.mood as number));
    const moodWithout = mean(without.map(d => d.mood as number));
    rows.push({
      label,
      withDays: withIt.length,
      withoutDays: without.length,
      moodWith,
      moodWithout,
      delta: moodWith - moodWithout,
    });
  }
  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/**
 * How your mood runs by time of day — the "and when" half of the ask.
 *
 * Bucketed by the app's own time-of-day segments rather than by the hour, so
 * it lines up with the segments tasks are already scheduled into and a person
 * reading "evenings are worse" can act on it with a control the app already
 * has.
 */
export interface TimeOfDayMood {
  segment: TimeOfDay;
  entryCount: number;
  mood: number;
}

export function moodByTimeOfDay(
  logs: readonly MoodLog[],
  segmentOf: (loggedAt: string) => TimeOfDay,
): TimeOfDayMood[] {
  const buckets = new Map<TimeOfDay, number[]>();
  for (const log of logs) {
    if (log.mood === null) continue;
    const segment = segmentOf(log.loggedAt);
    const list = buckets.get(segment) ?? [];
    list.push(log.mood);
    buckets.set(segment, list);
  }
  const order: TimeOfDay[] = ['morning', 'afternoon', 'evening'];
  return order
    .filter(s => (buckets.get(s)?.length ?? 0) > 0)
    .map(s => ({
      segment: s,
      entryCount: buckets.get(s)!.length,
      mood: mean(buckets.get(s)!),
    }));
}

/**
 * How many logical days up to and including `todayKey` end a run of low ones.
 *
 * The nudge's trigger (see `moodTasks.ts`). Counts backwards from today over
 * *logged* days only, and stops at the first day that was logged and wasn't
 * low. Days you didn't log neither break the run nor count toward it: not
 * opening the app is not evidence you were fine, and it is not evidence you
 * weren't either.
 *
 * Requires today itself to be logged and low. Without that the run is a
 * statement about the past, and the app would offer to cheer you up on the
 * strength of a bad patch that ended on Tuesday.
 */
export function lowMoodRun(days: readonly MoodDay[], todayKey: string): number {
  const logged = days
    .filter(d => d.mood !== null && d.dayKey <= todayKey)
    .sort((a, b) => b.dayKey.localeCompare(a.dayKey));
  if (logged.length === 0 || logged[0].dayKey !== todayKey) return 0;
  let run = 0;
  for (const day of logged) {
    if ((day.mood as number) > LOW_MOOD_AT_OR_BELOW) break;
    run++;
  }
  return run;
}

/**
 * The chart, said out loud.
 *
 * **One sentence for the whole chart rather than a label per bar**, which is
 * the choice worth recording. Labelling each column is the obvious move and
 * makes the chart fourteen stops in the swipe order, in the middle of a screen
 * whose entry list already carries every day in full and in words. The shape a
 * chart conveys at a glance is a summary, so the spoken version is a summary
 * too, and the detail stays where a screen reader can already reach it.
 *
 * Says how many days are missing rather than skipping them: a gap is the one
 * thing the visual version conveys with a flat line and no other cue, so it is
 * exactly what would be lost.
 */
export function describeMoodChart(
  days: readonly { dayKey: string; mood: number | null }[],
): string {
  if (days.length === 0) return 'Mood chart. Nothing logged.';
  const logged = days.filter(d => d.mood !== null) as { dayKey: string; mood: number }[];
  const missing = days.length - logged.length;
  const missingPart = missing === 0
    ? ''
    : ` ${missing} ${missing === 1 ? 'day' : 'days'} not logged.`;
  if (logged.length === 0) {
    return `Mood chart, last ${days.length} days. Nothing logged.`;
  }
  const avg = logged.reduce((sum, d) => sum + d.mood, 0) / logged.length;
  const best = logged.reduce((a, b) => (b.mood > a.mood ? b : a));
  const worst = logged.reduce((a, b) => (b.mood < a.mood ? b : a));
  const spokenDay = (key: string) => format(new Date(`${key}T00:00:00`), 'EEEE d MMMM');
  const range = best.mood === worst.mood
    // One flat fortnight: naming a highest and a lowest that are the same
    // number reads as two findings where there is none.
    ? `Every logged day at ${best.mood}.`
    : `Highest ${spokenDay(best.dayKey)} at ${best.mood}, lowest ${spokenDay(worst.dayKey)} at ${worst.mood}.`;
  return `Mood chart, last ${days.length} days. `
    + `${logged.length} logged, average ${avg.toFixed(1)} out of 5. `
    + `${range}${missingPart}`;
}

export interface MoodSummary {
  /** Days with at least one entry. */
  loggedDays: number;
  /** Days with a mood on them — the denominator for `averageMood`. */
  moodDays: number;
  averageMood: number | null;
  lowDays: number;
  /** Consecutive logged days ending today, however they went. */
  streak: number;
}

/** The header numbers on the Mood screen. */
export function moodSummary(days: readonly MoodDay[], todayKey: string): MoodSummary {
  const logged = days.filter(d => d.mood !== null || d.symptomKeys.length > 0);
  const withMood = days.filter(d => d.mood !== null);
  return {
    loggedDays: logged.length,
    moodDays: withMood.length,
    averageMood: withMood.length > 0 ? mean(withMood.map(d => d.mood as number)) : null,
    lowDays: withMood.filter(d => (d.mood as number) <= LOW_MOOD_AT_OR_BELOW).length,
    streak: loggingStreak(logged, todayKey),
  };
}

/**
 * Consecutive days ending today (or yesterday) with something logged.
 *
 * Tolerates today being unlogged so the number doesn't read as broken every
 * morning before you have opened the sheet — the streak you finished yesterday
 * is still the streak you are on until the day ends. Same grace the daily
 * targets take, and the reason this counts *days present in the data* rather
 * than walking a calendar.
 */
export function loggingStreak(days: readonly MoodDay[], todayKey: string): number {
  const keys = new Set(days.map(d => d.dayKey));
  if (keys.size === 0) return 0;
  const step = (key: string, back: number): string => {
    const d = new Date(`${key}T00:00:00`);
    d.setDate(d.getDate() - back);
    return format(d, 'yyyy-MM-dd');
  };
  const start = keys.has(todayKey) ? todayKey : step(todayKey, 1);
  if (!keys.has(start)) return 0;
  let run = 0;
  let cursor = start;
  while (keys.has(cursor)) {
    run++;
    cursor = step(cursor, 1);
  }
  return run;
}
