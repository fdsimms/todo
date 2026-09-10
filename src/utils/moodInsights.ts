import { format } from 'date-fns/format';
import { logicalDayStart } from './clockTime';
import { isRealCompletion } from './missed';
import {
  contextTagKey,
  dayContextTags,
  dayMoodAverage,
  daySymptoms,
  symptomKey,
  LOW_MOOD_AT_OR_BELOW,
} from './moodLog';
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
  /** Context tag names logged that day, lowercased for matching. */
  contextTagKeys: string[];
  /**
   * Top-level real completions that day, or null when the task record for the
   * day is gone. Subtasks and missed rows excluded.
   *
   * **Null is a purged day, and it is not a zero.** `completedRetentionDays`
   * deletes completed rows past its window while the mood log keeps every
   * entry forever, so a year of logging under a three-month window leaves nine
   * months of days that really were worked and now hold no rows to prove it.
   * Counted as zeros, those days would drag every completion read toward "you
   * finish nothing when you feel like that" — rule 3 of this file's header,
   * breached by the app's own housekeeping rather than by a gap in the data.
   * See `completionsKnownFrom` in `buildMoodDays`.
   */
  completed: number | null;
  /** Categories completed that day, each counted once — the "kind" of work. Empty on a purged day. */
  categories: string[];
  /**
   * The recurring tasks completed that day, by series identity rather than by
   * row id — see `taskIdentityKey`. Empty on a purged day.
   *
   * One key per *task*, not per occurrence: "Take the tablets" completed every
   * morning is one thing you do, and keying on the row would make every day's
   * completion a different label with one day behind it.
   */
  taskKeys: string[];
  /**
   * Steps recorded for that day, or null. Apple Health's, never this app's.
   *
   * Null is the normal case and covers every reason at once: the read is off,
   * the day is before it was turned on, nothing was recorded, or the read was
   * refused — HealthKit deliberately serves a refusal as an empty store, so the
   * last two are indistinguishable. Rule 3 already says an absent day is not a
   * zero; here the API enforces it. See `docs/arch/health-data.md`.
   */
  steps: number | null;
  /** Hours asleep recorded for that day, or null. Same rules as `steps`. */
  sleepHours: number | null;
}

/**
 * The identity a task keeps across its occurrences.
 *
 * A series first, then the root of the `previousOccurrenceId` chain, then the
 * row's own id — the same collapse `projectProgress` makes and for the same
 * reason: completing a recurring task spawns a *new row*, so the raw ids of
 * "Take the tablets" over a fortnight are fourteen different tasks unless
 * something walks them back to one.
 *
 * Resolve-or-shrug at every step, like every other chain walk in the app: a
 * pointer at a row that has been purged or deleted stops the walk where it is
 * rather than throwing, which leaves the surviving rows keyed on the oldest
 * ancestor still present. That splits one long-running task into a couple of
 * identities across a purge boundary, which is the honest answer — the rows
 * that would have joined them are gone.
 */
export function taskIdentityKey(task: Task, byId: ReadonlyMap<string, Task>): string {
  if (task.seriesId) return `series:${task.seriesId}`;
  const seen = new Set<string>([task.id]);
  let current = task;
  while (current.previousOccurrenceId) {
    const previous = byId.get(current.previousOccurrenceId);
    if (!previous || seen.has(previous.id)) break;
    seen.add(previous.id);
    current = previous;
  }
  return current.id;
}

/** A health reading the day builder can decorate a day with. */
export interface HealthDayInput {
  dayKey: string;
  steps: number | null;
  sleepHours: number | null;
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
 *
 * `completionsKnownFrom` is the first day the task record is complete for,
 * which is `completedRetentionDays`' cutoff (see `retentionCutoff`) and null
 * when retention is off. Days before it keep their mood and their symptoms and
 * lose their completions, because the rows that would have answered for them
 * have been deleted. It is a parameter rather than a read of the setting for
 * the reason the whole module is store-free, and it is not optional politeness:
 * the mood log is kept forever and the task history is not, so any install with
 * a retention window accumulates days where one half of every join is missing
 * and nothing else in the app would notice.
 */
export function buildMoodDays(
  logs: readonly MoodLog[],
  tasks: readonly Task[],
  dayResetTime: string,
  readings: readonly HealthDayInput[] = [],
  completionsKnownFrom: string | null = null,
): MoodDay[] {
  const days = new Map<string, MoodDay>();
  const dayFor = (dayKey: string): MoodDay => {
    let day = days.get(dayKey);
    if (!day) {
      day = {
        dayKey, mood: null, symptomKeys: [], contextTagKeys: [], completed: 0,
        categories: [], taskKeys: [], steps: null, sleepHours: null,
      };
      days.set(dayKey, day);
    }
    return day;
  };

  for (const log of logs) {
    const day = dayFor(log.dayKey);
    if (day.mood === null) {
      day.mood = dayMoodAverage(logs, log.dayKey);
      day.symptomKeys = daySymptoms(logs, log.dayKey).map(s => symptomKey(s.name));
      day.contextTagKeys = dayContextTags(logs, log.dayKey).map(contextTagKey);
    }
  }
  // A day whose entries were all symptoms/tags-only still needs them, and the
  // loop above only fills them alongside a mood it found. Cheap to redo for
  // the handful of such days rather than restructuring the pass.
  for (const day of days.values()) {
    if (day.symptomKeys.length === 0) {
      day.symptomKeys = daySymptoms(logs, day.dayKey).map(s => symptomKey(s.name));
    }
    if (day.contextTagKeys.length === 0) {
      day.contextTagKeys = dayContextTags(logs, day.dayKey).map(contextTagKey);
    }
  }

  const categoriesByDay = new Map<string, Set<string>>();
  const taskKeysByDay = new Map<string, Set<string>>();
  const byId = new Map(tasks.map(t => [t.id, t]));
  for (const task of tasks) {
    if (task.parentId || !isRealCompletion(task) || !task.completedAt) continue;
    const dayKey = completionDayKey(task.completedAt, dayResetTime);
    const day = dayFor(dayKey);
    day.completed = (day.completed ?? 0) + 1;
    if (task.category) {
      let set = categoriesByDay.get(dayKey);
      if (!set) categoriesByDay.set(dayKey, (set = new Set()));
      set.add(task.category);
    }
    let keys = taskKeysByDay.get(dayKey);
    if (!keys) taskKeysByDay.set(dayKey, (keys = new Set()));
    keys.add(taskIdentityKey(task, byId));
  }
  for (const [dayKey, set] of categoriesByDay) {
    dayFor(dayKey).categories = [...set].sort();
  }
  for (const [dayKey, set] of taskKeysByDay) {
    dayFor(dayKey).taskKeys = [...set].sort();
  }

  // Days whose completed rows have been purged say nothing about what was
  // done, and must say *nothing* rather than "none" — see `MoodDay.completed`.
  // Applied after the count so a row that survived the window (an archived
  // one, or a decision task holding an answer) can't make a purged day look
  // like a fully recorded one with a single completion on it.
  if (completionsKnownFrom !== null) {
    for (const day of days.values()) {
      if (day.dayKey >= completionsKnownFrom) continue;
      day.completed = null;
      day.categories = [];
      day.taskKeys = [];
    }
  }

  // Health readings **decorate days that already exist and never create one.**
  // This is the whole of what keeps the axis honest, and it is worth being
  // explicit about because the obvious implementation gets it wrong: HealthKit
  // will happily return ninety days of step counts, and folding those in
  // through `dayFor` would conjure ninety days into the set, every one of them
  // carrying `completed: 0` and `mood: null`. That is a fortnight of invented
  // zero-completion days for somebody who simply didn't open the app — rule 3's
  // exact failure mode, arriving through the one dataset the user never
  // entered. A reading says how a day went; it does not say the day was one you
  // were logging.
  for (const reading of readings) {
    const day = days.get(reading.dayKey);
    if (!day) continue;
    day.steps = reading.steps;
    day.sleepHours = reading.sleepHours;
  }

  return [...days.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

/** Only the days that can actually be compared: a mood *and* a task count. */
export function pairedDays(days: readonly MoodDay[]): MoodDay[] {
  return days.filter(d => d.mood !== null);
}

/**
 * The paired days whose task record survived, for the reads that are about
 * what got done.
 *
 * Separate from `pairedDays` because the symptom and context contrasts only
 * ever touch the mood side, and narrowing those to the retention window would
 * throw away years of perfectly good symptom history to fix a problem they
 * don't have.
 */
export function taskPairedDays(days: readonly MoodDay[]): MoodDay[] {
  return days.filter(d => d.mood !== null && d.completed !== null);
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
  const paired = taskPairedDays(days);
  const base: MoodCompletionInsight = {
    dayCount: paired.length,
    r: null,
    strength: null,
    direction: null,
    completedOnGoodDays: null,
    completedOnLowDays: null,
  };
  if (paired.length < MIN_PAIRED_DAYS) return base;

  const r = correlation(paired.map(d => d.mood as number), paired.map(d => d.completed as number));
  const good = paired.filter(d => (d.mood as number) > 3);
  const low = paired.filter(d => (d.mood as number) <= LOW_MOOD_AT_OR_BELOW);
  return {
    ...base,
    r,
    strength: r === null ? null : correlationStrength(r),
    direction: r === null ? null : r >= 0 ? 'more' : 'fewer',
    completedOnGoodDays: good.length > 0 ? mean(good.map(d => d.completed as number)) : null,
    completedOnLowDays: low.length > 0 ? mean(low.map(d => d.completed as number)) : null,
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
  const paired = taskPairedDays(days);
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

/**
 * For each context tag: how your mood ran on the days it applied, against the
 * days it didn't.
 *
 * Same shape and same rules as `symptomMoodContrasts` — a tag reaching this
 * screen is exactly what #1223 called an association, never a cause, so
 * "vacation" landing here reads the same as "headache" does: a comparison,
 * not a diagnosis.
 */
export function contextTagMoodContrasts(days: readonly MoodDay[]): GroupContrast[] {
  const paired = pairedDays(days);
  if (paired.length < MIN_PAIRED_DAYS) return [];
  const labels = new Set<string>();
  for (const day of paired) for (const t of day.contextTagKeys) labels.add(t);
  return contrastsFor(paired, [...labels], (day, label) => day.contextTagKeys.includes(label));
}

/**
 * For each recurring task: how your mood ran on the days you completed it,
 * against the days you didn't.
 *
 * The same contrast the category read makes, one level down, and it is the
 * answer this app gives to the thing every symptom tracker builds a separate
 * feature for: **a medication, a supplement, a stretch or a walk is already a
 * repeating task here**, so "how do the days I take it compare" needs no
 * schema, no second vocabulary and no pill-shaped UI. A tracker that asks you
 * to log the tablets *again*, in its own list, next to the task reminding you
 * to take them, is asking for the same fact twice.
 *
 * One-offs cannot reach the screen and are not filtered out by hand: a task
 * completed once has one "with" day, and `contrastsFor` needs
 * `MIN_CONTRAST_DAYS` on both sides. That is the honest gate rather than
 * `recurrenceType !== 'none'` — a task repeated by hand every morning is
 * exactly as real as one carrying a rule, and a rule the user added yesterday
 * says nothing about the fortnight behind it.
 *
 * Labelled by identity key (see `taskIdentityKey`), which the caller resolves
 * back to a title through `taskContrastTitles` — the same key-to-display step
 * the symptom rows already make.
 */
export function taskMoodContrasts(days: readonly MoodDay[]): GroupContrast[] {
  const paired = taskPairedDays(days);
  if (paired.length < MIN_PAIRED_DAYS) return [];
  const labels = new Set<string>();
  for (const day of paired) for (const key of day.taskKeys) labels.add(key);
  return contrastsFor(paired, [...labels], (day, label) => day.taskKeys.includes(label));
}

/**
 * Identity key -> the title to show for it, taken from the most recent
 * occurrence.
 *
 * The most recent rather than the oldest, because a task the user has since
 * renamed should read under the name they use now — the identity is the chain,
 * not the wording. `displayTitleFor` is deliberately not used: a chain step's
 * title is the step, and a contrast is about the whole repeating thing.
 */
export function taskContrastTitles(tasks: readonly Task[]): Map<string, string> {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const newest = new Map<string, { title: string; at: string }>();
  for (const task of tasks) {
    if (task.parentId || !isRealCompletion(task) || !task.completedAt) continue;
    const key = taskIdentityKey(task, byId);
    const seen = newest.get(key);
    if (!seen || task.completedAt > seen.at) {
      newest.set(key, { title: task.title, at: task.completedAt });
    }
  }
  return new Map([...newest].map(([key, v]) => [key, v.title]));
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
/** Which Health reading an insight is about. */
export type HealthMetric = 'steps' | 'sleepHours';

/** What a reading is being compared against. */
export type HealthAgainst = 'mood' | 'completed';

export interface HealthInsight {
  metric: HealthMetric;
  against: HealthAgainst;
  /** Days carrying both the reading and the thing it is compared against. */
  dayCount: number;
  /** Null below `MIN_PAIRED_DAYS`, or when the correlation is undefined. */
  r: number | null;
  strength: CorrelationStrength | null;
  /** "more" means the two rise together. */
  direction: 'more' | 'fewer' | null;
}

/** A day's value on one axis, or null when the day cannot speak to it. */
function axisValue(day: MoodDay, axis: HealthMetric | HealthAgainst): number | null {
  switch (axis) {
    case 'steps': return day.steps;
    case 'sleepHours': return day.sleepHours;
    case 'mood': return day.mood;
    // A real zero where it is a number: a day is only in the set at all
    // because something was logged or finished on it, so "none finished" is
    // something that happened rather than something missing. Null is the one
    // case that isn't — a day whose completed rows have been purged (see
    // `MoodDay.completed`), which drops out of the pairing like a missing
    // reading does.
    case 'completed': return day.completed;
  }
}

/**
 * Does a Health reading move with how you felt, or with what you finished?
 *
 * One function for all four pairings rather than four near-copies, because
 * every rule that makes this honest is the same in each and writing it out four
 * times is how two of them would quietly drift apart. `moodCompletionInsight`
 * above stays its own function on purpose: it reports the two group averages
 * the screen leads with, which is a claim about mood specifically.
 *
 * **The completions pairing is the one a health app cannot make.** That is the
 * same argument this whole file rests on, pointed at a second dataset: Health
 * knows how much somebody walked and this app knows what they got done, and
 * only one program has both. The mood pairings are the smaller half and are
 * here because the Mood screen is where a person is already reading about
 * their days.
 *
 * All three rules from the file header apply unchanged, and two of them do more
 * work here than they do above:
 *
 * 1. **Nothing below `MIN_PAIRED_DAYS`.** A health axis makes this *easier* to
 *    breach by accident, because HealthKit can answer for days the user was
 *    never logging on — which is exactly why `buildMoodDays` refuses to create
 *    a day from a reading.
 * 2. **A direction and a strength, never a coefficient.** `r` is on the shape
 *    for tests and for `correlationStrength`; nothing renders it.
 * 3. **A day without the reading is absent, not a zero.** Enforced here rather
 *    than left to the caller, and it is not optional politeness: null covers a
 *    refused read, and treating that as "walked nowhere" would turn somebody
 *    declining to share their steps into a finding about their life.
 *
 * And the rule this file inherits from `mood-log.md`: an association, never a
 * cause. "You finish more on the days you move more" is a description of two
 * numbers. It is not advice, and nothing built on it may become advice.
 */
export function healthInsight(
  days: readonly MoodDay[],
  metric: HealthMetric,
  against: HealthAgainst,
): HealthInsight {
  const paired = days.filter(
    d => axisValue(d, metric) !== null && axisValue(d, against) !== null,
  );
  const base: HealthInsight = {
    metric,
    against,
    dayCount: paired.length,
    r: null,
    strength: null,
    direction: null,
  };
  if (paired.length < MIN_PAIRED_DAYS) return base;

  const r = correlation(
    paired.map(d => axisValue(d, metric) as number),
    paired.map(d => axisValue(d, against) as number),
  );
  return {
    ...base,
    r,
    strength: r === null ? null : correlationStrength(r),
    direction: r === null ? null : r >= 0 ? 'more' : 'fewer',
  };
}

/**
 * One line saying what an insight found, or null when it found nothing sayable.
 *
 * Here rather than in the screen's JSX because it is the copy that has to not
 * overclaim, and copy that has to not overclaim should be testable — the same
 * reason `moodTasks.test.ts` asserts directly that the nudge never names a
 * feeling. `describeRhythm` is the same shape one file over.
 *
 * Three rules, all inherited and none of them decoration:
 *
 * - **A description, never advice.** "You finish more on the days you walk
 *   more" is a statement about two numbers. "Try walking more" is a claim about
 *   cause and a suggestion about somebody's life, and this app does not make
 *   either from a correlation.
 * - **No coefficient.** A strength word and a direction, because `r = 0.42`
 *   reads as a finding to anybody who last met the word at school.
 * - **"No clear pattern" is a real answer and gets said.** Hiding it would
 *   leave only the findings that happened to land, which is how a screen full
 *   of associations starts looking like a screen full of results.
 */
export function describeHealthInsight(insight: HealthInsight): string | null {
  if (insight.strength === null || insight.direction === null) return null;

  const subject = insight.metric === 'steps' ? 'steps' : 'sleep';
  const onDays = insight.metric === 'steps'
    ? 'the days you walk more'
    : 'the days you sleep more';

  if (insight.strength === 'none') {
    return insight.against === 'mood'
      ? `No clear pattern between your ${subject} and your mood.`
      : `No clear pattern between your ${subject} and what you finish.`;
  }
  if (insight.against === 'mood') {
    return insight.direction === 'more'
      ? `Your mood runs higher on ${onDays}.`
      : `Your mood runs lower on ${onDays}.`;
  }
  return insight.direction === 'more'
    ? `You finish more tasks on ${onDays}.`
    : `You finish fewer tasks on ${onDays}.`;
}

/**
 * The metric's own average across the days it was recorded, or null.
 *
 * For the one line an insight needs beside its direction: "you averaged 6,400
 * steps on the days you logged". Absent days are absent, so this is an average
 * over what is known rather than over the window.
 */
export function healthAverage(
  days: readonly MoodDay[],
  metric: HealthMetric,
): number | null {
  const values = days
    .map(d => axisValue(d, metric))
    .filter((v): v is number => v !== null);
  return values.length > 0 ? mean(values) : null;
}

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
