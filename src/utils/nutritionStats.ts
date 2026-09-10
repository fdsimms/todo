import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { FoodLogEntry, FoodNutritionSource, NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { dayKeyToDate } from './dateUtils';
import type { CookingWindow } from './cookingStats';

/**
 * What the Stats screen can say about eating, derived from food log entries
 * that already exist. Nothing here is stored and nothing new is recorded.
 *
 * **Counts, never a score.** `cookingStats.ts` states this rule twice and it
 * binds harder here than anywhere else in the app: nutrition stats are the
 * exact surface where a task app turns into something that makes people feel
 * bad about eating. So there are no percentages of a goal, no red and green, no
 * streaks, no encouragement, and nothing that reads as a result. A daily target
 * is a number the user typed and belongs beside the day it was set against; a
 * month of days measured against it is a report card, which is a different
 * object and not one this screen produces. `docs/arch/mood-log.md`'s rule that
 * the app never names a state back at the user applies in full.
 *
 * **A day nobody logged is not a day of nothing.** Every average here divides
 * by days that were actually logged, never by the width of the window, for the
 * same reason `foodLogTotals` refuses to sum an absent nutrient as zero: an
 * average over unlogged days is a smaller number that looks like a measurement
 * and is not one. The count of days it covers travels with it so a caller can
 * say what the figure speaks for.
 *
 * **The window used for an average stops at yesterday.** Today is still in
 * progress and a partial day drags every average down — the call `mealCookCounts`
 * already makes about its own denominator. `daysLogged` has no such problem and
 * does include today, since it counts days that happened rather than averaging
 * over them.
 *
 * **Bucketed by the entry's own `dayKey`, never by its `atISO` instant.** That
 * key was stamped from `dayResetTime` when the entry was written, so an 11pm
 * snack recorded after midnight belongs to the evening it happened in. Deriving
 * the day from the instant here would undo that at read time.
 *
 * Store-free and node-testable, like `cookingStats.ts` and `stats.ts` beside it.
 * The window type is borrowed from `cookingStats` rather than redeclared:
 * nothing about a span of logical days is cooking-specific, and a second copy
 * is how the two would come to disagree about what `todayKey` means.
 */

/** How much of the window has anything in it at all. */
export interface NutritionCounts {
  /** How many days the window covers, inclusive of both ends. */
  days: number;
  /** Distinct days in the window with at least one entry. Includes today. */
  daysLogged: number;
  /**
   * Days carrying entries in at least two different meals.
   *
   * A day with an entry at breakfast and nothing after is a day somebody
   * started logging and stopped, and averaging it beside a fully logged one
   * would report a calorie count nobody ate. Named rather than filtered out:
   * this figure is how the screen says what its averages are built on top of,
   * and hiding the shortfall would be the same overstatement the day view's
   * own coverage clause exists to prevent.
   */
  daysComplete: number;
  /** Entries in the window, across every day. */
  entries: number;
}

/** One nutrient's average over the days that were logged. */
export interface NutrientAverage {
  key: NutrientKey;
  /** Summed across the window's completed days. */
  total: number;
  /** How many of those days stated this nutrient at all — the divisor. */
  days: number;
  /** `total / days`, rounded to a tenth. */
  average: number;
}

/** One row of the most-logged leaderboard. */
export interface LoggedFood {
  /** The label the entries share, which is also the grouping key. */
  label: string;
  count: number;
  /** The most recent instant it was logged at, for a stable tie-break. */
  lastAtISO: string;
}

/**
 * Where the window's figures came from, counted per entry.
 *
 * **The one statistic here nobody else's food logger has**, and it is worth
 * more than it sounds: it says how much of the record to trust. A manufacturer's
 * declared label, a food database's analysis, somebody's own transcription and a
 * dish estimated from its ingredients are four different claims, and a month of
 * numbers built mostly from the last of those is a different thing from a month
 * built from the first.
 *
 * Reported as counts and never as a grade. There is no better or worse source
 * here: a typed panel off a jar in your hand is a perfectly good record, and an
 * estimate is the honest answer for a bowl of soup.
 */
export interface SourceMix {
  /** `openFoodFacts` — a manufacturer's own declared label. */
  label: number;
  /** `fdc` — FoodData Central's analysis of a food. */
  database: number;
  /** `manual` — typed in from the packet. */
  manual: number;
  /** `estimated` — computed from something else, chiefly a recipe's ingredients. */
  estimated: number;
  /** Of all of the above, how many were a helping of one of the user's own recipes. */
  fromRecipe: number;
}

export const EMPTY_NUTRITION_COUNTS: NutritionCounts = {
  days: 0,
  daysLogged: 0,
  daysComplete: 0,
  entries: 0,
};

export const EMPTY_SOURCE_MIX: SourceMix = {
  label: 0,
  database: 0,
  manual: 0,
  estimated: 0,
  fromRecipe: 0,
};

/** How many distinct meals a day needs before its figures stand for the day. */
const COMPLETE_DAY_SLOTS = 2;

function round(amount: number): number {
  return Math.round(amount * 10) / 10;
}

/** The entries inside the window, by their own day key. */
function inWindow(
  entries: readonly FoodLogEntry[],
  window: CookingWindow,
): FoodLogEntry[] {
  // Day keys are zero-padded, so the range test is a lexical compare — the same
  // property that lets the SQLite read be a plain `day_key >= ? AND <= ?`.
  return entries.filter(e => e.dayKey >= window.startKey && e.dayKey <= window.endKey);
}

/** How much of the window was logged. */
export function nutritionCounts(
  entries: readonly FoodLogEntry[],
  window: CookingWindow,
): NutritionCounts {
  const slotsByDay = new Map<string, Set<string>>();
  let count = 0;
  for (const entry of inWindow(entries, window)) {
    count += 1;
    // An unslotted entry is its own bucket rather than being pooled: two snacks
    // outside any meal are one moment of logging, not two.
    const slot = entry.slot ?? 'none';
    const seen = slotsByDay.get(entry.dayKey);
    if (seen) seen.add(slot);
    else slotsByDay.set(entry.dayKey, new Set([slot]));
  }

  let daysComplete = 0;
  for (const slots of slotsByDay.values()) {
    if (slots.size >= COMPLETE_DAY_SLOTS) daysComplete += 1;
  }

  return {
    days: Math.max(
      0,
      differenceInCalendarDays(dayKeyToDate(window.endKey), dayKeyToDate(window.startKey)) + 1,
    ),
    daysLogged: slotsByDay.size,
    daysComplete,
    entries: count,
  };
}

/**
 * The average day, per nutrient, over the window's completed days.
 *
 * **Only days that were logged completely enough to mean something**, per
 * `NutritionCounts.daysComplete`, and only days that have finished. A day with
 * breakfast alone in it is a smaller number that is not a smaller day, and
 * today is a day still being eaten.
 *
 * **A nutrient's divisor is the days that stated it**, not the days that were
 * logged. A US label declares a short list, so fibre appears on some days and
 * not others; dividing by every day would report a fibre average built from
 * three days as if it were built from thirty. The count travels back on the row.
 *
 * Absent throughout means absent from the result. A nutrient nothing in the
 * window ever stated has no average, rather than an average of zero.
 */
export function nutrientAverages(
  entries: readonly FoodLogEntry[],
  window: CookingWindow,
): NutrientAverage[] {
  const totals = new Map<string, Partial<Record<NutrientKey, number>>>();
  const slotsByDay = new Map<string, Set<string>>();

  for (const entry of inWindow(entries, window)) {
    // The averaging window stops at yesterday: a partial day drags every
    // figure down, and today is partial by definition.
    if (entry.dayKey >= window.todayKey) continue;
    const slot = entry.slot ?? 'none';
    const seen = slotsByDay.get(entry.dayKey);
    if (seen) seen.add(slot);
    else slotsByDay.set(entry.dayKey, new Set([slot]));

    const day = totals.get(entry.dayKey) ?? {};
    for (const key of NUTRIENT_KEYS) {
      const amount = entry.nutrition.amounts[key];
      if (amount === undefined) continue;
      day[key] = (day[key] ?? 0) + amount;
    }
    totals.set(entry.dayKey, day);
  }

  const out: NutrientAverage[] = [];
  for (const key of NUTRIENT_KEYS) {
    let total = 0;
    let days = 0;
    for (const [dayKey, day] of totals) {
      if ((slotsByDay.get(dayKey)?.size ?? 0) < COMPLETE_DAY_SLOTS) continue;
      const amount = day[key];
      if (amount === undefined) continue;
      total += amount;
      days += 1;
    }
    if (days === 0) continue;
    out.push({ key, total: round(total), days, average: round(total / days) });
  }
  return out;
}

/**
 * The most-logged foods in the window, highest first.
 *
 * Grouped by the entry's own `label` rather than by `itemId` or `recipeId`,
 * because those are null for anything typed in and a leaderboard that silently
 * dropped every hand-entered food would misreport what somebody eats. The label
 * is what the row says and what the reader recognises.
 *
 * Ties break on the most recent, then on the label, so the order is stable
 * rather than however the rows came back.
 */
export function mostLoggedFoods(
  entries: readonly FoodLogEntry[],
  window: CookingWindow,
  limit = 5,
): LoggedFood[] {
  const byLabel = new Map<string, LoggedFood>();
  for (const entry of inWindow(entries, window)) {
    const label = entry.label.trim();
    if (!label) continue;
    const row = byLabel.get(label);
    if (row) {
      row.count += 1;
      if (entry.atISO > row.lastAtISO) row.lastAtISO = entry.atISO;
    } else {
      byLabel.set(label, { label, count: 1, lastAtISO: entry.atISO });
    }
  }
  return [...byLabel.values()]
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.lastAtISO !== a.lastAtISO) return b.lastAtISO.localeCompare(a.lastAtISO);
      return a.label.localeCompare(b.label);
    })
    .slice(0, limit);
}

const SOURCE_FIELD: Record<FoodNutritionSource, keyof SourceMix> = {
  openFoodFacts: 'label',
  fdc: 'database',
  manual: 'manual',
  estimated: 'estimated',
};

/** Where the window's figures came from. See `SourceMix`. */
export function sourceMix(
  entries: readonly FoodLogEntry[],
  window: CookingWindow,
): SourceMix {
  const mix = { ...EMPTY_SOURCE_MIX };
  for (const entry of inWindow(entries, window)) {
    mix[SOURCE_FIELD[entry.nutrition.source]] += 1;
    if (entry.recipeId) mix.fromRecipe += 1;
  }
  return mix;
}

/**
 * Whether there is anything at all to show — the gate a caller renders the
 * whole section behind.
 *
 * Deliberately not "are the counts zero": a `null` means nothing has looked
 * yet, which is a third answer and must not render as a row of zeroes. Same
 * call `hasCookingData` makes.
 */
export function hasNutritionData(counts: NutritionCounts | null): boolean {
  return counts !== null && counts.entries > 0;
}
