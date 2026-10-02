import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { FoodLogEntry, FoodNutritionSource, NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { dayKeyToDate } from './dateUtils';
import type { CookingWindow } from './cookingStats';
import type { FoodDayInput } from './moodInsights';
import { isNutrientOnlyEntry } from './nutrientLog';

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
  /**
   * The complete days before today: exactly the pool `nutrientAverages` draws
   * from, which stops at yesterday. A nutrient's own day count is compared
   * against this, not against `daysComplete`, or once today was logged past
   * one meal every average read as covering fewer days than it did.
   */
  daysAveraged: number;
  /** Entries in the window, across every day. */
  entries: number;
}

/** One nutrient's average over the days that were logged. */
export interface NutrientAverage {
  key: NutrientKey;
  /** Summed across the window's completed days. */
  total: number;
  /**
   * How many of those days stated this nutrient in every food entry: the
   * divisor. Water's own row counts the days anything stated it (see
   * `nutrientAverages`).
   */
  days: number;
  /** `total / days`, rounded to a tenth. */
  average: number;
}

/** One row of the most-logged leaderboard. */
export interface LoggedFood {
  /** Which food this is, as `foodKeyResolver` keys it. Stable across renames. */
  key: string;
  /**
   * What to call it: the catalog row's or recipe's current name when the
   * caller supplied one, and otherwise the label it was most recently logged
   * under.
   */
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
  daysAveraged: 0,
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
    // The day's water, or any other nutrient a task logged on its own, is not a
    // meal (it is filed unslotted, and would otherwise be the second "meal"
    // that makes breakfast alone read as a complete day).
    if (isNutrientOnlyEntry(entry)) continue;
    // An unslotted entry is its own bucket rather than being pooled: two snacks
    // outside any meal are one moment of logging, not two.
    const slot = entry.slot ?? 'none';
    const seen = slotsByDay.get(entry.dayKey);
    if (seen) seen.add(slot);
    else slotsByDay.set(entry.dayKey, new Set([slot]));
  }

  let daysComplete = 0;
  let daysAveraged = 0;
  for (const [dayKey, slots] of slotsByDay) {
    if (slots.size < COMPLETE_DAY_SLOTS) continue;
    daysComplete += 1;
    if (dayKey < window.todayKey) daysAveraged += 1;
  }

  return {
    days: Math.max(
      0,
      differenceInCalendarDays(dayKeyToDate(window.endKey), dayKeyToDate(window.startKey)) + 1,
    ),
    daysLogged: slotsByDay.size,
    daysComplete,
    daysAveraged,
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
 * **And a day states a nutrient only when every food entry on it did**, the
 * coverage rule `foodDayInputs` below applies, for the reason it gives: across
 * days there is nowhere to print "from 1 of 3 entries", and the coverage varies
 * day to day, so the variation reads as variation in the food. Summing whatever
 * was stated used to let one scanned cereal's 3 g of fibre stand for a whole
 * day's fibre beside a lunch and a dinner that stated none, and since every
 * complete day had *some* entry stating it, the row's "across N days" clause
 * never appeared. A day that fails the rule for one nutrient still counts for
 * the others it did state throughout.
 *
 * **The day's water is on its own path.** It is the one entry that states
 * `waterMl` and nothing else, so it would veto every other nutrient under the
 * rule above, and the rule would veto water on every day with a meal. So it
 * feeds only the water row, and water keeps the plain rule: a day counts when
 * anything on it stated a volume.
 *
 * Absent throughout means absent from the result. A nutrient nothing in the
 * window ever stated has no average, rather than an average of zero.
 */
export function nutrientAverages(
  entries: readonly FoodLogEntry[],
  window: CookingWindow,
): NutrientAverage[] {
  const totals = new Map<string, Partial<Record<NutrientKey, number>>>();
  // Per day, how many food entries stated each nutrient, against how many food
  // entries the day has: a nutrient counts for a day only when the two match.
  const statedByDay = new Map<string, Partial<Record<NutrientKey, number>>>();
  const foodEntriesByDay = new Map<string, number>();
  const slotsByDay = new Map<string, Set<string>>();

  for (const entry of inWindow(entries, window)) {
    // The averaging window stops at yesterday: a partial day drags every
    // figure down, and today is partial by definition.
    if (entry.dayKey >= window.todayKey) continue;
    const day = totals.get(entry.dayKey) ?? {};
    totals.set(entry.dayKey, day);

    // A nutrient logged on its own (the day's water, a task's sodium) feeds
    // that nutrient's average and nothing else. It is not a meal, so it never
    // counts toward a day's completeness (see nutritionCounts), and it is not
    // a food, so it never vetoes another nutrient's coverage.
    if (isNutrientOnlyEntry(entry)) {
      for (const key of NUTRIENT_KEYS) {
        const amount = entry.nutrition.amounts[key];
        if (amount !== undefined) day[key] = (day[key] ?? 0) + amount;
      }
      continue;
    }

    const slot = entry.slot ?? 'none';
    const seen = slotsByDay.get(entry.dayKey);
    if (seen) seen.add(slot);
    else slotsByDay.set(entry.dayKey, new Set([slot]));
    foodEntriesByDay.set(entry.dayKey, (foodEntriesByDay.get(entry.dayKey) ?? 0) + 1);

    const stated = statedByDay.get(entry.dayKey) ?? {};
    statedByDay.set(entry.dayKey, stated);
    for (const key of NUTRIENT_KEYS) {
      const amount = entry.nutrition.amounts[key];
      if (amount === undefined) continue;
      day[key] = (day[key] ?? 0) + amount;
      stated[key] = (stated[key] ?? 0) + 1;
    }
  }

  const out: NutrientAverage[] = [];
  for (const key of NUTRIENT_KEYS) {
    let total = 0;
    let days = 0;
    for (const [dayKey, day] of totals) {
      if ((slotsByDay.get(dayKey)?.size ?? 0) < COMPLETE_DAY_SLOTS) continue;
      const amount = day[key];
      if (amount === undefined) continue;
      // Water keeps the plain rule; everything else needs every food entry
      // that day to have stated it, or the day is left out of this row.
      if (key !== 'waterMl'
        && (statedByDay.get(dayKey)?.[key] ?? 0) < (foodEntriesByDay.get(dayKey) ?? 0)) continue;
      total += amount;
      days += 1;
    }
    if (days === 0) continue;
    out.push({ key, total: round(total), days, average: round(total / days) });
  }
  return out;
}

/** The current names of catalog rows and recipes, for naming a food key. */
export interface FoodNameLookup {
  items?: ReadonlyMap<string, string>;
  recipes?: ReadonlyMap<string, string>;
}

const ITEM_KEY = 'item:';
const RECIPE_KEY = 'recipe:';

/** The identity a linked entry carries, or null for one linked to nothing. */
function linkedFoodKey(entry: FoodLogEntry): string | null {
  if (entry.recipeId) return `${RECIPE_KEY}${entry.recipeId}`;
  if (entry.itemId) return `${ITEM_KEY}${entry.itemId}`;
  return null;
}

/**
 * Which food an entry is, for every read that groups the log by food: the
 * most-logged board, and the mood and symptom contrasts through
 * `foodDayInputs`.
 *
 * **A linked entry is its catalog row or its recipe** (`item:<id>`,
 * `recipe:<id>`), and only an unlinked one is its lowercased label (#2947).
 * Keying everything by label used to be the rule, and its reason still holds
 * for the entries it was about: `itemId` and `recipeId` are null for anything
 * typed in or estimated, and dropping those would misreport what somebody ate.
 * It does not hold where the link is there. The entry picker offers an item
 * and each of its boxes as separate rows ("Bread" and "Bread, Dave's Killer 21
 * grain"), so a person testing whether bread gives them headaches logged
 * whichever was on top, and the branded days landed in plain bread's
 * "didn't" group. The one read in the app somebody might change their diet
 * over was comparing bread days against bread days. A box counts as its item
 * for the same reason `foodLogRecents.ts` credits one: eating a pot of yogurt
 * is eating yogurt.
 *
 * **An unlinked label joins the food a linked entry was logged under by that
 * same label**, so "bread" typed by hand still counts as the Bread row the way
 * it did when everything keyed by label. Only when the label is unambiguous:
 * one that linked entries carry for two different rows stays a label, since
 * guessing between them would put the day in a group it may not belong to.
 *
 * Built over the whole run of entries being read, because the aliases are:
 * a resolver built over a narrower run can key the same entry differently.
 */
export function foodKeyResolver(entries: readonly FoodLogEntry[]): (entry: FoodLogEntry) => string | null {
  const aliases = new Map<string, string | null>();
  for (const entry of entries) {
    const linked = linkedFoodKey(entry);
    const label = entry.label.trim().toLowerCase();
    if (!linked || !label) continue;
    const seen = aliases.get(label);
    if (seen === undefined) aliases.set(label, linked);
    else if (seen !== linked) aliases.set(label, null);
  }
  return entry => {
    const linked = linkedFoodKey(entry);
    if (linked) return linked;
    // Lowercased for matching, the same call `symptomKey` makes and for the
    // same reason: "Coffee" and "coffee" are one food, and two groups built
    // from one habit halve the days on each side of every contrast.
    const label = entry.label.trim().toLowerCase();
    if (!label) return null;
    return aliases.get(label) ?? label;
  };
}

/**
 * What to call each food key `foodKeyResolver` produces over these entries.
 *
 * A catalog row or recipe is called by its current name when `lookup` has it,
 * so a food is named by the item it is rather than by whichever box happened
 * to be logged last; one since deleted falls back to the label it was most
 * recently logged under, and so does every unlinked food, as it was typed.
 */
export function foodKeyNames(
  entries: readonly FoodLogEntry[],
  lookup: FoodNameLookup = {},
): Map<string, string> {
  const keyOf = foodKeyResolver(entries);
  const latest = new Map<string, { label: string; atISO: string }>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const label = entry.label.trim();
    if (!key || !label) continue;
    const seen = latest.get(key);
    if (!seen || entry.atISO >= seen.atISO) latest.set(key, { label, atISO: entry.atISO });
  }
  const out = new Map<string, string>();
  for (const [key, { label }] of latest) out.set(key, nameForFoodKey(key, lookup) ?? label);
  return out;
}

function nameForFoodKey(key: string, lookup: FoodNameLookup): string | null {
  if (key.startsWith(ITEM_KEY)) return lookup.items?.get(key.slice(ITEM_KEY.length)) ?? null;
  if (key.startsWith(RECIPE_KEY)) return lookup.recipes?.get(key.slice(RECIPE_KEY.length)) ?? null;
  return null;
}

/**
 * The most-logged foods in the window, highest first.
 *
 * Grouped by `foodKeyResolver`: a linked entry by the row or recipe it points
 * at, and an unlinked one by its label, so a hand-typed food is still on the
 * board and an item logged as two different boxes is still one food. Named
 * through `lookup` when the caller has the catalog's names, and otherwise by
 * the label most recently logged.
 *
 * Ties break on the most recent, then on the label, so the order is stable
 * rather than however the rows came back.
 */
export function mostLoggedFoods(
  entries: readonly FoodLogEntry[],
  window: CookingWindow,
  limit = 5,
  lookup: FoodNameLookup = {},
): LoggedFood[] {
  const keyOf = foodKeyResolver(entries);
  const byKey = new Map<string, LoggedFood>();
  for (const entry of inWindow(entries, window)) {
    // The day's water is a running total, not a food, and logged daily it
    // topped this list for anybody who drank anything. A task's nutrient is
    // the same shape.
    if (isNutrientOnlyEntry(entry)) continue;
    const label = entry.label.trim();
    const key = keyOf(entry);
    if (!label || !key) continue;
    const row = byKey.get(key);
    if (row) {
      row.count += 1;
      if (entry.atISO > row.lastAtISO) {
        row.lastAtISO = entry.atISO;
        row.label = label;
      }
    } else {
      byKey.set(key, { key, label, count: 1, lastAtISO: entry.atISO });
    }
  }
  for (const row of byKey.values()) row.label = nameForFoodKey(row.key, lookup) ?? row.label;
  return [...byKey.values()]
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
    // Water states a volume, not figures anybody sourced, and it read as the
    // largest "typed" share of every water drinker's record. A task's logged
    // nutrient is the same.
    if (isNutrientOnlyEntry(entry)) continue;
    mix[SOURCE_FIELD[entry.nutrition.source]] += 1;
    if (entry.recipeId) mix.fromRecipe += 1;
  }
  return mix;
}

/**
 * A day's eating in the shape the mood insights can pair against, for the days
 * the log can actually speak for.
 *
 * This is the one function in the file that hands its answer to another
 * feature, and it lives here rather than in `moodInsights.ts` because both
 * rules it enforces are the food log's own and are already written down on
 * this side. `FoodDayInput` states them from the reader's end; this is where
 * they are applied.
 *
 * **The completeness bar is `nutrientAverages`' bar, deliberately the same
 * one.** A day with breakfast alone in it is already refused from the average
 * day on this screen, for the reason that it is "a smaller number that is not a
 * smaller day". Pairing it against a mood would be that same wrong number doing
 * considerably more damage: not a slightly low average, but a low-calorie day
 * fed to a correlation, which is how "your mood is lower on the days you eat
 * less" gets manufactured out of the days somebody stopped logging at 11am. One
 * constant answers for both, because a day either stands for a day's eating or
 * it doesn't, and that question has one answer per day rather than one per
 * reader.
 *
 * **Unlike the averages here, today is kept.** That window stops at yesterday
 * because a partial day drags an average down; this one is paired rather than
 * averaged, and the completeness bar already asks the question that would have
 * excluded a half-eaten day. A day that reached two meals is a day whose mood
 * entry is worth pairing, and dropping today would silently cost a person the
 * day they are most likely to be looking at.
 *
 * **The coverage rule is stricter here than anywhere else in the file**, and it
 * is the difference between a figure and a comparable one. A total covering
 * five of seven entries is perfectly good on the day's own card, where
 * `describeFoodLogTotals` prints the clause that says so. Across days there is
 * nowhere to print it, and the coverage varies day to day, so the variation
 * reads as variation in the food. A nutrient not stated by every entry that day
 * is therefore absent for the day rather than partial: the same refuse-rather-
 * than-approximate posture `scalePanelToAmount` takes one file over.
 */
export function foodDayInputs(entries: readonly FoodLogEntry[]): FoodDayInput[] {
  const keyOf = foodKeyResolver(entries);
  const byDay = new Map<string, FoodLogEntry[]>();
  const standaloneByDay = new Map<string, Partial<Record<NutrientKey, number>>>();
  for (const entry of entries) {
    // The day's water is not a food: counted as one it completed a breakfast-
    // only day, joined the contrasts as a label, and (stating nothing but
    // water) vetoed every other nutrient under the coverage rule below. A
    // nutrient a task logged on its own is the same: not a food, but what it
    // states is still eaten or drunk, so it is added to that nutrient's day
    // total below without counting toward coverage.
    if (isNutrientOnlyEntry(entry)) {
      const extra = standaloneByDay.get(entry.dayKey) ?? {};
      standaloneByDay.set(entry.dayKey, extra);
      for (const key of NUTRIENT_KEYS) {
        const amount = entry.nutrition.amounts[key];
        if (amount !== undefined) extra[key] = (extra[key] ?? 0) + amount;
      }
      continue;
    }
    const list = byDay.get(entry.dayKey);
    if (list) list.push(entry);
    else byDay.set(entry.dayKey, [entry]);
  }

  const out: FoodDayInput[] = [];
  for (const [dayKey, dayEntries] of byDay) {
    // An unslotted entry is its own bucket rather than being pooled, exactly
    // as `nutritionCounts` treats it: two snacks outside any meal are one
    // moment of logging, not two.
    const slots = new Set(dayEntries.map(e => e.slot ?? 'none'));
    if (slots.size < COMPLETE_DAY_SLOTS) continue;

    const nutrients: Partial<Record<NutrientKey, number>> = {};
    for (const key of NUTRIENT_KEYS) {
      let total = 0;
      let stated = 0;
      for (const entry of dayEntries) {
        const amount = entry.nutrition.amounts[key];
        if (amount === undefined) continue;
        total += amount;
        stated += 1;
      }
      if (stated === dayEntries.length) nutrients[key] = round(total + (standaloneByDay.get(dayKey)?.[key] ?? 0));
    }

    // Which foods, keyed by what each entry is rather than by what it was
    // called: see `foodKeyResolver` for why a box and its item are one food.
    const labels = new Set<string>();
    for (const entry of dayEntries) {
      const key = keyOf(entry);
      if (key) labels.add(key);
    }

    out.push({ dayKey, nutrients, labels: [...labels].sort() });
  }
  return out.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
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
  // Days with food in them, not entries: a record of only water has nothing
  // for this section to say, and used to open on "Days you logged 0 of 30".
  return counts !== null && counts.daysLogged > 0;
}
