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
  MOOD_LEVELS,
} from './moodLog';
import type { MoodLog, NutrientKey, Task, TimeOfDay } from '../types';

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
  /**
   * What the day's food log added up to, or null when it cannot speak for the
   * day. See `FoodDayInput` for the two rules that decide which.
   *
   * Null is the normal case and covers every reason at once: nothing was
   * logged, the kitchen half is switched off, or the day was logged too
   * thinly to stand for a day's eating. Rule 3 of this file's header with a
   * second face — a partly logged day is the one gap that arrives looking
   * like a *number* rather than like a hole, which is why it is refused
   * upstream rather than filtered here.
   */
  nutrients: Partial<Record<NutrientKey, number>> | null;
  /**
   * The foods logged that day, lowercased for matching. Empty whenever
   * `nutrients` is null, for the reason `FoodDayInput.labels` gives: an
   * absence only means something on a day that was fully logged.
   */
  foodKeys: string[];
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
 * A day's eating, in the shape the day builder can decorate a day with.
 *
 * Built by `foodDayInputs` (`nutritionStats.ts`), which owns both of the rules
 * that decide whether a day gets one of these at all. They are stated there
 * because that is where the food log's own completeness vocabulary already
 * lives, and repeated here because they are what makes this axis honest:
 *
 * - **A day logged too thinly gets no row.** Somebody who logged breakfast and
 *   got on with their life did not eat 300 calories that day, and a correlation
 *   fed that figure would report "your mood is lower on the days you eat less"
 *   out of the days somebody stopped logging at 11am. This is the food log's
 *   version of rule 3, and the dangerous one: an unlogged day is an obvious
 *   hole, where a half-logged day arrives looking exactly like a small number.
 * - **A nutrient only counts for a day every entry stated.** A day's fibre
 *   built from three of its seven entries is a real figure on the day's own
 *   card, where a coverage clause travels with it. Across days it is not
 *   comparable — the coverage varies per day, and that variation reads as
 *   variation in the food.
 *
 * A day that fails either one simply isn't in the list, so `MoodDay.nutrients`
 * stays null and every read below drops it. There is no half-present row.
 */
export interface FoodDayInput {
  dayKey: string;
  /** The day's totals. Only nutrients every entry that day stated. */
  nutrients: Partial<Record<NutrientKey, number>>;
  /**
   * What was eaten, lowercased for matching.
   *
   * Present only on a day that earned a row, which is what makes "the days you
   * didn't eat it" a real group: on a thinly logged day an absent food may
   * simply be a dinner nobody wrote down.
   */
  labels: string[];
}

/**
 * The nutrients a mood comparison is offered for, and the list is short on
 * purpose.
 *
 * Ten nutrients against two outcomes is twenty comparisons run over the same
 * thirty-odd days, and at that width a couple of them land at something
 * eye-catching by arithmetic alone. `MIN_PAIRED_DAYS` guards each comparison
 * against being built on too little; nothing guards a *screenful* of them
 * against the one that happened to hit, so the count is held down at the
 * source instead.
 *
 * Two, each for a stated reason rather than because it was in the type:
 *
 * - **Calories**, because "did I eat enough today" is the question the thin-day
 *   rule above exists to keep answerable, and it is the figure nearly every
 *   source states.
 * - **Sugar**, the folk hypothesis everybody has and almost nobody has ever
 *   held up against their own days.
 *
 * **Caffeine is the one that should be here and cannot be**, which is worth
 * writing down because it is the first thing anybody will try to add. It has
 * the best same-day mechanism of anything in the list and it is what people
 * actually wonder about. But `FoodDayInput`'s coverage rule needs every entry
 * on a day to state a nutrient before the day's total is comparable, and
 * almost nothing states caffeine: a day of coffee, toast and a bowl of pasta
 * has one entry out of three carrying a figure. `nutritionParse.ts` makes the
 * same call from the other end — `OFF_UNINFORMATIVE_ZERO` throws away a
 * *stated* caffeine zero from Open Food Facts as untrustworthy — so the app
 * already holds that an absent caffeine figure is not a zero and a declared
 * one often isn't either. Adding the key back would ship a row that silently
 * never appears. Making it appear would mean summing absent caffeine as zero,
 * which is the one thing `foodLog.ts` refuses outright.
 *
 * **Protein was the fourth and was cut for a reason worth keeping written
 * down**, because it is the one somebody would think to add back: it is the
 * app's other headline figure (see `SUMMARY_KEYS`), which made it look like it
 * belonged. But nobody actually holds a hypothesis about their protein and
 * their mood, so its two rows would have been two more comparisons run for the
 * sake of symmetry with a card elsewhere. Its average is still on the screen,
 * which is what that figure was ever good for here.
 *
 * Widening this is a real feature decision each time, on the same terms
 * `mood-log.md` sets for the log sheet's one auto-suggestion. It is not a list
 * to extend because a nutrient exists, and it is the kind of list that only
 * ever grows unless somebody says so.
 */
export const NUTRIENT_INSIGHT_KEYS = [
  'calorieKcal', 'sugarG',
] as const satisfies readonly NutrientKey[];

/**
 * The nutrients the list above names.
 *
 * A type off the constant rather than a second hand-written union, so
 * `NUTRIENT_PHRASE` below is checked against the list itself: adding a key
 * with no sentence to say about it fails `tsc` on that table, naming the
 * member with nowhere to live, rather than falling through at runtime to a
 * line reading "the days you have more calorie kcal". Same trick
 * `WithNutrientKeyHome` plays in `types/index.ts`, and made for its reason.
 */
export type InsightNutrient = typeof NUTRIENT_INSIGHT_KEYS[number];

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
  meals: readonly FoodDayInput[] = [],
): MoodDay[] {
  const days = new Map<string, MoodDay>();
  const dayFor = (dayKey: string): MoodDay => {
    let day = days.get(dayKey);
    if (!day) {
      day = {
        dayKey, mood: null, symptomKeys: [], contextTagKeys: [], completed: 0,
        categories: [], taskKeys: [], steps: null, sleepHours: null,
        nutrients: null, foodKeys: [],
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

  // **A day's eating decorates a day too, and never creates one** — the same
  // rule the readings above follow, reached by a different argument and worth
  // spelling out because the obvious objection is good. A step count is
  // ambient, recorded by a device whether or not anybody was paying attention,
  // which is the whole reason folding one in must not conjure a day. A food
  // entry is nothing of the sort: somebody typed it, so a day carrying one is
  // a day they were using the app.
  //
  // It still doesn't belong in the union, because the union is what
  // `completed: 0` is charged against. A day somebody logged lunch on and
  // finished nothing is not evidence about their task load — they were
  // recording their dinner, not clearing their list — and admitting it would
  // pull the completion reads toward zero through a dataset that has no
  // opinion about tasks. The food axis loses nothing by it: every read below
  // needs a mood or a completion beside it anyway, so a day with only food on
  // it has nothing to be paired *with*.
  for (const meal of meals) {
    const day = days.get(meal.dayKey);
    if (!day) continue;
    day.nutrients = meal.nutrients;
    day.foodKeys = meal.labels;
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

/**
 * The paired days whose food log can speak for the day, for the reads about
 * what you ate.
 *
 * Its own filter for the reason `taskPairedDays` is: narrowing the symptom and
 * context contrasts to the days somebody happened to log their lunch would
 * throw away a record those reads are entitled to all of.
 *
 * The stricter half is what the *without* group means. "The days you didn't
 * eat it" has to be days the log would have said so — on a day logged too
 * thinly to earn a row, an absent food is as likely to be a dinner nobody
 * wrote down. `nutrients !== null` is exactly that bar (see `FoodDayInput`),
 * so one gate answers for both the totals and the labels.
 */
export function foodPairedDays(days: readonly MoodDay[]): MoodDay[] {
  return days.filter(d => d.mood !== null && d.nutrients !== null);
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

/**
 * Everything a day can be measured *by*: a reading off Apple Health, or a
 * nutrient off the food log.
 *
 * One union rather than two because every rule that makes a comparison honest
 * is the same whichever side the number came from, and `insightFor` below is
 * one body for exactly that reason. The two vocabularies stay distinct at the
 * doors (`healthInsight`, `nutrientInsight`) so a caller can't ask Health for
 * sugar, and they cannot collide: `NutrientKey` has no member named for an
 * activity.
 */
export type InsightMetric = HealthMetric | NutrientKey;

/** What a reading is being compared against. */
export type HealthAgainst = 'mood' | 'completed';

export interface DayInsight<M extends InsightMetric = InsightMetric> {
  metric: M;
  against: HealthAgainst;
  /** Days carrying both the metric and the thing it is compared against. */
  dayCount: number;
  /** Null below `MIN_PAIRED_DAYS`, or when the correlation is undefined. */
  r: number | null;
  strength: CorrelationStrength | null;
  /** "more" means the two rise together. */
  direction: 'more' | 'fewer' | null;
}

export type HealthInsight = DayInsight<HealthMetric>;
export type NutrientInsight = DayInsight<NutrientKey>;

/** A day's value on one axis, or null when the day cannot speak to it. */
function axisValue(day: MoodDay, axis: InsightMetric | HealthAgainst): number | null {
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
    // A nutrient. Absent on a day that stated it patchily or was logged too
    // thinly to count — never a zero, which for calories would be a day
    // somebody didn't eat. See `FoodDayInput`.
    default: return day.nutrients?.[axis] ?? null;
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
  return insightFor(days, metric, against);
}

/**
 * Does a nutrient move with how you felt, or with what you finished?
 *
 * `healthInsight`'s argument pointed at the one dataset the user typed
 * themselves, and every rule above carries over unchanged. **The completions
 * pairing is again the one nobody else can make**, and here it is starker than
 * it is for steps: the app store is full of food loggers and not one of them
 * knows what you got done on the days it recorded. "You finish fewer tasks on
 * the days you eat less" is a sentence only a program holding both halves can
 * even attempt.
 *
 * Two cautions particular to this axis, neither of which is fixable and both
 * of which are reasons the copy stays descriptive:
 *
 * - **The day is one bucket, so some of the food came after the mood.** An
 *   evening entry is part of a total that includes the dinner eaten after it.
 *   The health readings have exactly the same shape (steps accumulate all day
 *   against a mood logged at noon) and it is accepted there for the same
 *   reason: a lag would be a guess about mechanism, which is precisely the
 *   claim this file refuses to make. It is stated rather than corrected.
 * - **What somebody logs is not what somebody ate.** The thin-day rule keeps
 *   the worst of that out (see `FoodDayInput`), but a fully logged day is
 *   still a day of self-report, and a person who logs more carefully when they
 *   feel better has a correlation here that is about their logging.
 *
 * Which is the whole reason `NUTRIENT_INSIGHT_KEYS` is four long: this is the
 * axis where a wide search would most easily find something to say.
 */
export function nutrientInsight(
  days: readonly MoodDay[],
  metric: NutrientKey,
  against: HealthAgainst,
): NutrientInsight {
  return insightFor(days, metric, against);
}

/**
 * The body both doors share, so the rules above can't drift apart between an
 * activity reading and a nutrient. See `healthInsight` for what they are.
 */
function insightFor<M extends InsightMetric>(
  days: readonly MoodDay[],
  metric: M,
  against: HealthAgainst,
): DayInsight<M> {
  const paired = days.filter(
    d => axisValue(d, metric) !== null && axisValue(d, against) !== null,
  );
  const base: DayInsight<M> = {
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
 * How a nutrient is named in a sentence: what it is called as a thing, and
 * what "more of it" is called as a day.
 *
 * A table rather than a formatter, because "how much you eat" and "the days
 * you eat more" are not derivable from "calorieKcal". Keyed on
 * `InsightNutrient`, so it is the compiler rather than a reviewer that keeps
 * it level with `NUTRIENT_INSIGHT_KEYS`.
 */
const NUTRIENT_PHRASE: Record<InsightNutrient, { subject: string; onDays: string }> = {
  calorieKcal: { subject: 'how much you eat', onDays: 'the days you eat more' },
  sugarG: { subject: 'your sugar', onDays: 'the days you eat more sugar' },
};

/**
 * The phrase for a nutrient, or undefined for one this screen never talks
 * about.
 *
 * The one widening in the file, and it is here rather than at the callers
 * because `nutrientInsight` deliberately accepts any `NutrientKey` — the
 * vocabulary cap is a decision about what the *screen* asks, not a reason the
 * axis should refuse to compute. So the lookup has to answer for a key the
 * table has no row for, and says so with undefined.
 */
function nutrientPhrase(key: NutrientKey): { subject: string; onDays: string } | undefined {
  return (NUTRIENT_PHRASE as Partial<Record<NutrientKey, { subject: string; onDays: string }>>)[key];
}

/**
 * One line saying what a nutrient comparison found, or null when it found
 * nothing sayable.
 *
 * `describeHealthInsight`'s three rules, unchanged and load-bearing in the same
 * order. The middle one is worth restating where food is the subject: a
 * description is "your mood runs higher on the days you eat more", and advice
 * is "eat more". The gap between those two sentences is a claim about cause
 * that nobody here is in a position to make, and on this axis it is also close
 * to telling somebody what to eat, which this app does not do at all. See
 * `nutritionStats.ts` on counts never being a score.
 */
export function describeNutrientInsight(insight: NutrientInsight): string | null {
  if (insight.strength === null || insight.direction === null) return null;
  const phrase = nutrientPhrase(insight.metric);
  if (!phrase) return null;

  if (insight.strength === 'none') {
    return insight.against === 'mood'
      ? `No clear pattern between ${phrase.subject} and your mood.`
      : `No clear pattern between ${phrase.subject} and what you finish.`;
  }
  if (insight.against === 'mood') {
    return insight.direction === 'more'
      ? `Your mood runs higher on ${phrase.onDays}.`
      : `Your mood runs lower on ${phrase.onDays}.`;
  }
  return insight.direction === 'more'
    ? `You finish more tasks on ${phrase.onDays}.`
    : `You finish fewer tasks on ${phrase.onDays}.`;
}

/**
 * Every line the eating card has to say, in `NUTRIENT_INSIGHT_KEYS`' own order.
 *
 * A fixed order rather than one sorted by what landed, so somebody coming back
 * to the screen finds the same line in the same place and a strong finding
 * isn't promoted over "no clear pattern" by the layout. Within a nutrient,
 * what you finished comes before your mood — the same call the health card
 * makes, and for the same reason: the completions pairing is the one no food
 * logger can make, and the card above it already covers mood against what you
 * finish.
 *
 * **A nutrient that found nothing either way costs one line, not two.** This is
 * presentation rather than a softening of rule 3, and the distinction matters:
 * "no clear pattern" is still said, out loud, for every nutrient that has
 * nothing to report. What is gone is *saying it twice about the same nutrient*.
 * The card was built and looked at first (`three nutrients × two pairings`
 * against a health card that shows two lines), and half of it was the same six
 * words with a different noun on the end, which is how a screenful of hedges
 * teaches somebody to skip the paragraph the real findings are in.
 *
 * Grouping in a function rather than in the screen's JSX for the reason
 * `describeHealthInsight` is a function at all: it is copy that has to not
 * overclaim, and copy that has to not overclaim should be testable.
 */
export function nutrientFindings(days: readonly MoodDay[]): { key: string; text: string }[] {
  const rows: { key: string; text: string }[] = [];
  for (const nutrient of NUTRIENT_INSIGHT_KEYS) {
    const done = nutrientInsight(days, nutrient, 'completed');
    const mood = nutrientInsight(days, nutrient, 'mood');
    const phrase = nutrientPhrase(nutrient);
    if (phrase && done.strength === 'none' && mood.strength === 'none') {
      rows.push({
        key: `${nutrient}-none`,
        text: `No clear pattern between ${phrase.subject} and your mood or what you finish.`,
      });
      continue;
    }
    for (const insight of [done, mood]) {
      const text = describeNutrientInsight(insight);
      if (text) rows.push({ key: `${insight.metric}-${insight.against}`, text });
    }
  }
  return rows;
}

/**
 * For each food you log: how your mood ran on the days you ate it, against the
 * days you didn't.
 *
 * **`taskMoodContrasts`' argument pointed at the plate**, and the same
 * observation makes it: that read exists because a tablet or a walk is already
 * a repeating task here, so "how do the days I take it compare" needs no second
 * vocabulary. A food you ate is already a food log entry here, for the same
 * reason and with the same payoff — this is the elimination-diet question, and
 * every symptom tracker that asks it makes you keep a whole separate food diary
 * to answer it, next to the log you were already keeping.
 *
 * Grouped by the entry's own label, which is `mostLoggedFoods`' choice and made
 * for its reason: `itemId` and `recipeId` are null for anything typed in, so
 * keying on them would silently drop every hand-entered food and misreport what
 * somebody eats.
 *
 * Two gates, and the second is the one that makes the answer mean anything:
 *
 * - `MIN_CONTRAST_DAYS` on both sides, which is also what keeps a food eaten
 *   once off the screen — the same honest gate one-off tasks meet, rather than
 *   a hand-written filter.
 * - `foodPairedDays` rather than `pairedDays`, so the "without" group is days
 *   the log would have mentioned it. Compared against every mood day, this read
 *   would really be "the days I logged my food against the days I didn't", with
 *   a food's name on it.
 */
export function foodMoodContrasts(days: readonly MoodDay[]): GroupContrast[] {
  const paired = foodPairedDays(days);
  if (paired.length < MIN_PAIRED_DAYS) return [];
  const labels = new Set<string>();
  for (const day of paired) for (const key of day.foodKeys) labels.add(key);
  return contrastsFor(paired, [...labels], (day, label) => day.foodKeys.includes(label));
}

/**
 * Whether the day carries a log entry at all.
 *
 * The definition `moodSummary` has always used, named here because the symptom
 * read below depends on it being exactly right: a day is "logged" if it has a
 * mood *or* a symptom, since an entry can carry either without the other.
 */
export function hasMoodEntry(day: MoodDay): boolean {
  return day.mood !== null || day.symptomKeys.length > 0;
}

/**
 * How often a symptom turned up, on the days a food was logged against the
 * days it wasn't.
 *
 * A rate rather than a mean, so it gets its own shape rather than being forced
 * through `GroupContrast`: "how often did this happen" and "what was the
 * average" are different questions, and a `moodWith` field holding a frequency
 * is how a reader ends up rendering one as the other.
 */
export interface RateContrast {
  /** The food, lowercased for matching, as `foodKeys` holds it. */
  label: string;
  /** Days in each group. Both reported, never hidden — they are the sample. */
  withDays: number;
  withoutDays: number;
  /** Days in the group that carried the symptom. */
  withHits: number;
  withoutHits: number;
  /** `withHits / withDays`, 0..1. */
  rateWith: number;
  rateWithout: number;
  /** Positive means the symptom turned up more often on the days you ate it. */
  delta: number;
}

/**
 * How full a bar drawn for a mood should be, 0..1.
 *
 * **Anchored at zero, not at 1.** Mood runs 1..5, so `(mood - 1) / 4` is the
 * tempting scale and it is the one that lies: it turns the gap between 3.9 and
 * 4.1 into a fifth of the track when it is a twentieth of the scale. Truncating
 * an axis to make a difference look bigger is the oldest misleading chart there
 * is, and this file spends most of its length refusing to overstate a
 * comparison in words — a bar may not do it in pixels either.
 *
 * The cost is that a mood of 1 draws a fifth of the track rather than nothing,
 * which is correct: 1 is a real answer somebody gave, not an absence.
 */
export function moodBarFraction(mood: number): number {
  return Math.min(1, Math.max(0, mood / MOOD_LEVELS.length));
}

/**
 * The shortest bar a value above zero is allowed to draw, as a percentage.
 *
 * A rate of 1 day in 30 is 3% of a track, which at a phone's width is a couple
 * of pixels and reads as an empty bar — as *none*, which is a different fact
 * from the one it holds. So a nonzero value never draws nothing.
 */
export const CONTRAST_BAR_MIN_PERCENT = 4;

/**
 * How wide a bar should be, 0..100, for a fraction of its track.
 *
 * **The floor overstates a very small value slightly, and that is the lesser of
 * the two errors.** Rounding 3% up to 4% moves a bar by a pixel; drawing it as
 * empty says the symptom never happened on those days, which is wrong rather
 * than imprecise. The figures sit beside the bar in text and are the record,
 * so the bar is an aid to comparison and not the number itself.
 *
 * Zero stays zero. A day count of none is exactly what an empty track means,
 * and giving it a stub would be the same error pointed the other way.
 */
export function contrastBarPercent(fraction: number): number {
  if (!(fraction > 0)) return 0;
  return Math.min(100, Math.max(CONTRAST_BAR_MIN_PERCENT, Math.round(fraction * 100)));
}

/**
 * The days that can answer a symptom-against-food question at all.
 *
 * Two conditions, and the second is the one a naive version drops.
 *
 * `nutrients !== null` is `foodPairedDays`' bar, for its reason: on a thinly
 * logged day an absent food may be a dinner nobody wrote down, so "the days you
 * didn't eat it" would not mean that.
 *
 * **And the day has to carry a log entry, or its silence would read as a day
 * without the symptom.** This is rule 3 in the place it does the most damage in
 * the whole file: a day nobody logged is not a day nobody had a headache on,
 * and counting it as one deflates the rate on whichever side of the contrast
 * holds more unlogged days. The mood side takes care of itself for every other
 * read here, because `pairedDays` needs a *number*; a symptom is a presence, and
 * absence-of-record and absence-of-symptom look identical unless something
 * insists on the difference.
 *
 * What is still not fixable, and is why the copy stays a count of days: a day
 * somebody logged their mood on and did not bother recording a headache reads
 * as a headache-free day. The log is the record, and self-report is what it is.
 */
export function symptomFoodDays(days: readonly MoodDay[]): MoodDay[] {
  return days.filter(d => d.nutrients !== null && hasMoodEntry(d));
}

/**
 * For each food: how often you logged a symptom on the days you ate it,
 * against the days you logged food without it.
 *
 * **The elimination-diet question, and the most loaded read in the app.** It is
 * one step past `foodMoodContrasts` in what a person might do about it: a mood
 * comparison invites a shrug, and "you logged a headache on most of the days
 * you ate bread" invites somebody to stop eating bread. Which is exactly why
 * it is here rather than nowhere — a person tracking a symptom is *already*
 * forming that hypothesis, and every symptom tracker that supports it makes
 * them keep a second food diary to do it. Four things keep it honest:
 *
 * 1. **It is scoped to one symptom the person opened.** It lives on
 *    `SymptomDetailScreen` and takes the symptom as an argument, rather than
 *    searching every symptom against every food for whatever pair lands. Ten
 *    symptoms against twenty foods is two hundred comparisons and a guaranteed
 *    finding; this is one question a person asked.
 * 2. **Both gates, unchanged.** `MIN_PAIRED_DAYS` of days that can answer at
 *    all, and `MIN_CONTRAST_DAYS` on each side — which is also what keeps a
 *    food eaten once off the screen, by the same honest route one-off tasks
 *    take.
 * 3. **Days, not percentages, at the call site.** "6 of 9 days against 2 of 14"
 *    carries its own sample size in a way "67% against 14%" does not, and the
 *    shape returned here reports the counts alongside the rates so a caller
 *    cannot render the second without the first.
 * 4. **It is a count and never a cause.** The file's own rule, and the place it
 *    matters most: this cannot tell a food apart from everything else about the
 *    days that food was eaten on, and the card says so.
 */
export function symptomFoodContrasts(
  days: readonly MoodDay[],
  symptom: string,
): RateContrast[] {
  const paired = symptomFoodDays(days);
  if (paired.length < MIN_PAIRED_DAYS) return [];
  const labels = new Set<string>();
  for (const day of paired) for (const key of day.foodKeys) labels.add(key);

  const rows: RateContrast[] = [];
  for (const label of labels) {
    const withIt = paired.filter(d => d.foodKeys.includes(label));
    const without = paired.filter(d => !d.foodKeys.includes(label));
    if (withIt.length < MIN_CONTRAST_DAYS || without.length < MIN_CONTRAST_DAYS) continue;
    const withHits = withIt.filter(d => d.symptomKeys.includes(symptom)).length;
    const withoutHits = without.filter(d => d.symptomKeys.includes(symptom)).length;
    const rateWith = withHits / withIt.length;
    const rateWithout = withoutHits / without.length;
    rows.push({
      label,
      withDays: withIt.length,
      withoutDays: without.length,
      withHits,
      withoutHits,
      rateWith,
      rateWithout,
      delta: rateWith - rateWithout,
    });
  }
  // By the size of the gap in either direction, like every other contrast here:
  // "it happens less on the days I eat that" is exactly as interesting as the
  // reverse, and a one-sided sort would only ever show bad news.
  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/**
 * The metric's own average across the days it was recorded, or null.
 *
 * For the one line an insight needs beside its direction: "you averaged 6,400
 * steps on the days you logged". Absent days are absent, so this is an average
 * over what is known rather than over the window.
 *
 * Named for the axis rather than for Health, because it answers for a nutrient
 * on the same terms and a function called `healthAverage` returning somebody's
 * sugar is the drift this file is otherwise careful about.
 */
export function metricAverage(
  days: readonly MoodDay[],
  metric: InsightMetric,
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
  const logged = days.filter(hasMoodEntry);
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
