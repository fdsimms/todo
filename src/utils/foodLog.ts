import type { FoodLogEntry, FoodNutrition, MealSlot, NutrientKey } from '../types';
import { MEAL_SLOTS, NUTRIENT_KEYS } from '../types';
import { gramsForLine, panelMultiplier } from './ingredientGrams';
import { parseQuantity } from './quantity';

/**
 * The food log's rules: what a helping of something works out to, and what a
 * day of them adds up to.
 *
 * **Eating is the thing this app has never had.** `MealPlanEntry.cookedAt` is
 * when a dish was made and `Leftover.outcome` is whether a container ended up
 * empty; both types say outright that neither is somebody eating a known
 * amount. See `FoodLogEntry` for why a log is the right shape for it and a task
 * or a quota is not.
 *
 * **A total never sums an absent figure as zero.** This is the same rule
 * `FoodNutrition.amounts` states and `moodInsights` states generally as "a day
 * you didn't log is not a zero", and a day's totals are where it does the most
 * damage: a US label declares a short list, so a day of ordinary food will have
 * fibre on three entries and not the other four. Adding those as zeroes gives a
 * fibre total that looks like a measurement and is not one. So a nutrient
 * absent everywhere stays absent from the total, and every total carries a
 * count of how many entries actually stated it.
 *
 * **Nothing here grades anything.** No daily-value percentages, no colours, no
 * "good day". Those need an RDA the app has never asked for, and
 * `cookingStats.ts`'s rule holds here as it does on the recipe line: counts,
 * never a score.
 *
 * The scaling half deliberately reuses `panelMultiplier` rather than repeating
 * it. A helping measured by one rule here and another rule in the recipe
 * rollup would be two different calorie counts for one plate of food.
 *
 * **Nothing here imports `recipeNutrition.ts`, and that is load-bearing rather
 * than tidiness.** That module reaches the meal plan and through it the
 * settings store and SQLite, so importing it would make this one impossible to
 * exercise without standing up a database, which is exactly the split
 * `foodSearchMatch` keeps against the service it ranks for. So the per-serving
 * figures of a cooked dish are *passed in* rather than computed here: the
 * caller already holds a `RecipeNutrition` and can divide it.
 */

/** A day's figures, and how much of the day each one actually speaks for. */
export interface FoodLogTotals {
  /** Summed amounts. A nutrient no entry stated is absent, never 0. */
  total: Partial<Record<NutrientKey, number>>;
  /** How many entries stated each nutrient, so a caller can say what a figure covers. */
  reported: Partial<Record<NutrientKey, number>>;
  /** How many entries went into this. */
  entries: number;
}

/** One meal's worth of the day, plus what it came to. */
export interface FoodLogSection {
  /** Null for the run of entries eaten outside a meal. */
  slot: MealSlot | null;
  entries: FoodLogEntry[];
  totals: FoodLogTotals;
}

/**
 * A stored panel is rounded to a tenth, because a figure carried to fourteen
 * decimal places is float noise pretending to be precision, and these numbers
 * are read back and summed rather than recomputed.
 */
function round(amount: number): number {
  return Math.round(amount * 10) / 10;
}

/**
 * What one helping of a food works out to, and what it weighs.
 *
 * **Refuses rather than approximates**, which is the posture the whole nutrition
 * tree keeps and matters most here: this figure is what a day's total is built
 * from and, eventually, what goes into a health record. An amount that cannot
 * be measured against this food's own panel gets no entry rather than a guessed
 * one. `panelMultiplier` states the three ways that happens.
 *
 * The result's `basis` is `perServing` and its figures are the amounts actually
 * eaten. An entry records one helping rather than a food, so the scaling has
 * already happened by the time anything reads it back and no reader needs to
 * know what the source panel was per 100g. Its `source` is carried through
 * unchanged, because who stated the underlying figures is exactly as true of
 * the helping as of the food.
 */
export function scalePanelToAmount(
  panel: FoodNutrition,
  quantity: string,
  prep: string | null,
  now: Date = new Date(),
): { nutrition: FoodNutrition; grams: number | null } | null {
  const factor = panelMultiplier(quantity, prep, panel);
  if (factor === null || !(factor > 0)) return null;

  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const amount = panel.amounts[key];
    if (amount !== undefined) amounts[key] = round(amount * factor);
  }
  if (Object.keys(amounts).length === 0) return null;

  // Best effort and allowed to fail on its own: a volume against a per-100ml
  // panel is a perfectly good entry whose weight nobody knows, and inventing
  // one would need a density this app deliberately has not got.
  //
  // Rounded here rather than in `gramsForLine`, which is right to hand back
  // whatever the arithmetic gave it: the recipe rollup divides its answer by
  // 100 and never shows it, where this one is stored on the row and rendered
  // as a weight. A cup of milk off a 244g portion comes back as
  // 243.99999999999997, and that is a number nobody should be shown.
  const rawGrams = gramsForLine(parseQuantity(quantity), prep, panel.portions);
  const grams = rawGrams === null ? null : round(rawGrams);

  return {
    grams,
    nutrition: {
      basis: 'perServing',
      servingGrams: grams,
      servingText: quantity.trim() || null,
      amounts,
      source: panel.source,
      sourceId: panel.sourceId,
      // Deliberately dropped. A portion table describes the food, and this
      // describes one helping of it that has already been measured: carrying
      // the rows forward would invite something to scale an amount that is
      // already scaled.
      portions: [],
      recordedAt: now.toISOString(),
    },
  };
}

/**
 * What some number of helpings of a cooked dish works out to.
 *
 * **Takes the dish's per-serving figures, not the dish**, so this module needs
 * nothing from `recipeNutrition.ts` at runtime. The caller has a
 * `RecipeNutrition` already and `perServing` is what turns one into these; the
 * coverage floor has been applied by the time it answers at all, so anything
 * reaching here is a dish whose figures were worth stating.
 *
 * **Null when the caller had no per-serving figures**, which is what
 * `perServing` answers for a recipe that never said how many servings it makes.
 * Treating the whole dish as one helping instead is the failure worth refusing:
 * "how much of this did you eat" has no answer without a servings count, and a
 * whole tray of lasagne logged as one serving is out by a factor of six while
 * looking entirely plausible on the screen.
 */
export function recipeHelpingNutrition(
  perServingAmounts: Partial<Record<NutrientKey, number>> | null,
  helpings: number,
  source: FoodNutrition['source'] = 'estimated',
  now: Date = new Date(),
): FoodNutrition | null {
  if (!perServingAmounts) return null;
  if (!(helpings > 0)) return null;

  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const amount = perServingAmounts[key];
    if (amount !== undefined) amounts[key] = round(amount * helpings);
  }
  if (Object.keys(amounts).length === 0) return null;

  return {
    basis: 'perServing',
    servingGrams: null,
    servingText: helpings === 1 ? '1 serving' : `${helpings} servings`,
    amounts,
    // A dish's figures are built from its ingredients' panels through a
    // coverage floor, so the dish itself is an estimate however good the
    // panels under it were. Nothing downstream may render this the way it
    // renders a label. See FoodNutrition.source.
    source,
    sourceId: null,
    portions: [],
    recordedAt: now.toISOString(),
  };
}

/** What a run of entries came to, absent figures staying absent. */
export function foodLogTotals(entries: readonly FoodLogEntry[]): FoodLogTotals {
  const total: Partial<Record<NutrientKey, number>> = {};
  const reported: Partial<Record<NutrientKey, number>> = {};
  for (const entry of entries) {
    for (const key of NUTRIENT_KEYS) {
      const amount = entry.nutrition.amounts[key];
      if (amount === undefined) continue;
      total[key] = round((total[key] ?? 0) + amount);
      reported[key] = (reported[key] ?? 0) + 1;
    }
  }
  return { total, reported, entries: entries.length };
}

/**
 * A day's entries split into meals, in the order a day is read.
 *
 * A slot with nothing in it is dropped rather than rendered empty: a day with
 * no breakfast should not have a heading saying so. The unslotted run comes
 * last, since it is a catch-all rather than a time of day, and it is present
 * only when something is in it.
 */
export function foodLogSections(entries: readonly FoodLogEntry[]): FoodLogSection[] {
  const ordered = [...entries].sort((a, b) => a.atISO.localeCompare(b.atISO));
  const sections: FoodLogSection[] = [];
  for (const slot of MEAL_SLOTS) {
    const inSlot = ordered.filter(e => e.slot === slot);
    if (inSlot.length > 0) sections.push({ slot, entries: inSlot, totals: foodLogTotals(inSlot) });
  }
  const loose = ordered.filter(e => e.slot === null);
  if (loose.length > 0) sections.push({ slot: null, entries: loose, totals: foodLogTotals(loose) });
  return sections;
}

/** The nutrients a day's one-line summary leads with, same two the recipe line uses. */
const SUMMARY_KEYS: readonly NutrientKey[] = ['calorieKcal', 'proteinG'];

const SUMMARY_LABEL: Record<string, (amount: number) => string> = {
  calorieKcal: n => `${Math.round(n)} cal`,
  proteinG: n => `${Math.round(n)}g protein`,
};

/**
 * "1,840 cal, 78g protein, from 5 of 7 entries", or null while there is nothing
 * worth saying.
 *
 * **The coverage clause is not optional**, and is what stops the number reading
 * as the day's calorie count rather than as the count of what was logged and
 * measurable. It drops only when every entry stated the nutrient, exactly as
 * `describeRecipeNutrition` drops its own. Counted per nutrient rather than per
 * day, because a day where every entry has calories and three have fibre is
 * fully covered for one figure and not the other.
 */
export function describeFoodLogTotals(totals: FoodLogTotals): string | null {
  if (totals.entries === 0) return null;
  const parts = SUMMARY_KEYS
    .filter(key => totals.total[key] !== undefined)
    .map(key => SUMMARY_LABEL[key](totals.total[key] as number));
  if (parts.length === 0) return null;

  const covered = Math.min(...SUMMARY_KEYS
    .filter(key => totals.total[key] !== undefined)
    .map(key => totals.reported[key] ?? 0));
  const clause = covered === totals.entries
    ? ''
    : `, from ${covered} of ${totals.entries} ${totals.entries === 1 ? 'entry' : 'entries'}`;
  return `${parts.join(', ')}${clause}`;
}

/** One entry's stated amount of a nutrient, or `null` when it never said. */
export interface NutrientContribution {
  entry: FoodLogEntry;
  amount: number | null;
}

/**
 * What each of a run of entries put toward one nutrient, most first.
 *
 * This is `foodLogTotals` broken back out by entry, for the one place a total
 * needs to answer "which of these": the coverage clause on the day's card
 * says a figure speaks for 5 of 7 entries and nothing else there says which
 * five. An entry that never stated the nutrient sorts to the bottom rather
 * than being dropped, so the list still accounts for every entry the total's
 * coverage count is measured against.
 */
export function nutrientContributions(
  entries: readonly FoodLogEntry[],
  key: NutrientKey,
): NutrientContribution[] {
  return entries
    .map(entry => ({ entry, amount: entry.nutrition.amounts[key] ?? null }))
    .sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
}

/**
 * How an entry's amount and provenance read on its row.
 *
 * The source is named rather than assumed because it decides what the figure
 * may be taken for: a label a manufacturer declared, a database's analysis, a
 * person's own transcription and a dish estimated from its ingredients are four
 * different claims, and the row is the only place a person can tell them apart.
 */
export function describeFoodLogEntry(entry: FoodLogEntry): string {
  const calories = entry.nutrition.amounts.calorieKcal;
  const parts: string[] = [];
  if (entry.quantity.trim()) parts.push(entry.quantity.trim());
  if (calories !== undefined) parts.push(`${Math.round(calories)} cal`);
  if (entry.nutrition.source === 'estimated') parts.push('estimated');
  return parts.join(' · ');
}
