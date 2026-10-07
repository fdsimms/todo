import type { GroceryItem, ItemProduct, MealPlanEntry, Recipe } from '../types';
import { comparableQuantity, describePriceAge, formatPrice } from './groceryPrice';
import { measureLineAmount } from './ingredientGrams';
import { parseQuantity } from './quantity';
import { flattenRecipeIngredients, type ChoiceResolution } from './recipeComponents';
import { collectPlannedIngredients } from './mealPlanGroceries';
import { normalizeScale } from './recipeScale';
import { NO_STANDING_SWAPS, type StandingSwapMap } from './standingSwaps';
import { resolvePluralKey } from './groceryPlural';
import { onHandNameKeys } from './grocerySuggest';

/**
 * What a recipe, or a week of planned meals, is likely to cost — the one place
 * a `GroceryItem`'s remembered price is related to a *different* quantity than
 * the one it was recorded for (#1672).
 *
 * **Still an observation, never a ledger.** Same rule groceryPrice.ts is built
 * on: nothing here estimates a price that was never actually paid, and every
 * total travels with how much of the dish it actually accounts for.
 *
 * **Relating two quantities is all-or-nothing, and it's not a new rule.**
 * `comparableQuantity` (groceryPrice.ts) already answers "can these two
 * amounts be safely divided", for comparing one item's price across stores —
 * measured quantities in the same dimension (via unitConvert, so "2 lb" and "1
 * kg" relate fine), or counts sharing the exact same unit word ("3 cloves"
 * against "10 cloves", never "3 cloves" against "1 bulb"). A line whose
 * quantity doesn't parse, or that doesn't relate to how the item was last
 * bought, is uncovered — never a guessed cost, the same refusal
 * `unitPricesFor` makes about a set it won't rank.
 *
 * **Below a coverage floor, the estimate declines rather than answers.** Three
 * priced ingredients out of nine is a number confident about mostly nothing;
 * `MIN_COST_COVERAGE` is the line between that and something worth reading,
 * picked so it separates exactly those two examples from #1672's own writeup
 * (3 of 9 refuses, 6 of 9 answers) — there's no science past that, a threshold
 * has to be picked somewhere.
 *
 * **A staple contributes to neither side of the fraction.** Salt is on a
 * recipe because it's in the dish, not because anyone prices it — the same
 * exclusion `estimateListTotal` already makes for the shopping list, so a
 * pantry staple can't drag a recipe's coverage down (or up).
 *
 * **The oldest price behind the total travels with it.** A recipe costed
 * entirely from eighteen-month-old observations should say so — `oldestPricedAt`
 * is rendered through the same `describePriceAge` wording every per-item price
 * caption already uses, not a second phrasing.
 *
 * **Recipe and week costing share one line-costing rule.** A recipe's own
 * flattened ingredients (`flattenRecipeIngredients`, scale applied per line)
 * and a week's planned ingredients (`collectPlannedIngredients`, which already
 * applies each entry's own scale and choices) both reduce to a flat list of
 * `(nameKey, quantity, factor)` lines — costed one line at a time and summed in
 * minor units directly, never through the display-only `mergeQuantities`.
 *
 * **A line is costed as written and the scale multiplies the cost**, rather
 * than the scaled text being costed, the same order `recipeNutrition.ts` uses
 * and for the same reason (#2918). The scaled text is a shopping notation: it
 * leaves a "14 oz can" alone at 1.5x, since there is no way to write half a
 * tin, and it rewrites the same can doubled as "2 14 oz cans". Costing that
 * text priced a can and a half as one can. A cost is linear in the amount on
 * every key `comparableQuantity` relates, so multiplying after is the same
 * number wherever scaling succeeds and the right one where it doesn't.
 *
 * **A counted sized container is also a weight or a volume.** "2 14 oz cans"
 * is twenty-eight ounces, and relates to a price recorded by the pound (or by
 * the single tin) through `measureLineAmount`, the reading nutrition already
 * gives it. Only when the two quantities have no key in common: tins of one
 * size against tins of the same size still relate by count, which is the same
 * answer.
 */

export interface CostEstimate {
  /** The sum of what's known, in minor units. */
  totalMinor: number;
  /** How many lines contributed a cost… */
  priced: number;
  /** …out of how many the dish (or week) actually calls for. */
  total: number;
  /** The oldest `lastPricedAt` behind a contributing line, or null if none carried one. */
  oldestPricedAt: string | null;
}

/** Half the lines priced is the line #1672's own bad (3/9) and good (6/9) examples fall either side of. */
const MIN_COST_COVERAGE = 0.5;

/**
 * How much of what was bought `quantity` is, as a fraction of the purchase, or
 * null when the two don't relate.
 *
 * `comparableQuantity` first, which is the whole rule for every shape but one.
 * The exception is a counted sized container on either side, keyed by its tin
 * size there so tins of different sizes never rank as equals: measured through
 * `measureLineAmount` here instead, since "2 14 oz cans" against "1 lb" is a
 * weight against a weight (see the header).
 */
function purchaseFraction(quantity: string, purchaseQuantity: string | null): number | null {
  const line = comparableQuantity(quantity);
  const purchase = comparableQuantity(purchaseQuantity);
  if (line && purchase && line.key === purchase.key) {
    return purchase.amount > 0 ? line.amount / purchase.amount : null;
  }
  const lineParsed = parseQuantity(quantity);
  const purchaseParsed = parseQuantity(purchaseQuantity ?? '');
  if (!lineParsed.container?.count && !purchaseParsed.container?.count) return null;
  const lineMeasured = measureLineAmount(lineParsed);
  const purchaseMeasured = measureLineAmount(purchaseParsed);
  if (!lineMeasured || !purchaseMeasured) return null;
  if (lineMeasured.dimension !== purchaseMeasured.dimension || purchaseMeasured.base <= 0) return null;
  return lineMeasured.base / purchaseMeasured.base;
}

/**
 * One line's contribution, or null when it can't be honestly costed: no
 * catalog match, no remembered price, or a quantity that doesn't relate to
 * the one the price was recorded for.
 *
 * `quantity` is the line as written and `factor` the scale it's cooked at,
 * multiplied in after relating the two (see the header).
 */
function costLine(
  quantity: string,
  item: GroceryItem,
  factor: number,
): { minor: number; pricedAt: string | null } | null {
  if (item.lastPriceMinor === null) return null;
  const fraction = purchaseFraction(quantity, item.lastPriceQuantity);
  if (fraction === null) return null;
  return {
    minor: item.lastPriceMinor * fraction * factor,
    pricedAt: item.lastPricedAt,
  };
}

/** Folds one more line into a running estimate, staples excluded from both sides of the fraction. */
function accumulate(
  acc: { totalMinor: number; priced: number; total: number; oldestPricedAt: string | null },
  nameKey: string,
  /** As written, unscaled: `factor` multiplies what it costs. */
  quantity: string,
  factor: number,
  byKey: ReadonlyMap<string, GroceryItem>
): void {
  // Plural-tolerant like every other catalog read (`groceryPlural.ts`), or a
  // line one letter off its own row counts against coverage while the price it
  // needs sits right there.
  const resolved = byKey.has(nameKey) ? nameKey : resolvePluralKey(nameKey, byKey.keys());
  const item = resolved ? byKey.get(resolved) : undefined;
  if (item?.isStaple) return;
  acc.total += 1;
  if (!item) return;
  const cost = costLine(quantity, item, factor);
  if (!cost) return;
  acc.totalMinor += cost.minor;
  acc.priced += 1;
  if (cost.pricedAt && (acc.oldestPricedAt === null || cost.pricedAt < acc.oldestPricedAt)) {
    acc.oldestPricedAt = cost.pricedAt;
  }
}

function finish(acc: { totalMinor: number; priced: number; total: number; oldestPricedAt: string | null }): CostEstimate | null {
  if (acc.total === 0 || acc.priced / acc.total < MIN_COST_COVERAGE) return null;
  return { totalMinor: Math.round(acc.totalMinor), priced: acc.priced, total: acc.total, oldestPricedAt: acc.oldestPricedAt };
}

/**
 * What one meal of `recipe` — scaled, with its components and choices
 * resolved — is likely to cost, or null when too little of it is priced to
 * say.
 *
 * Mirrors `plannedIngredientsForRecipe`'s own parameter order and defaults
 * (recipesById, resolution, scale, swaps): the same flattening this recipe's
 * shopping read already goes through, so a swap changes what's costed exactly
 * as it changes what's bought.
 */
export function estimateRecipeCost(
  recipe: Recipe,
  items: readonly GroceryItem[],
  recipesById: ReadonlyMap<string, Recipe> = new Map([[recipe.id, recipe]]),
  resolution?: ChoiceResolution,
  scale = 1,
  swaps: StandingSwapMap = NO_STANDING_SWAPS
): CostEstimate | null {
  const flat = flattenRecipeIngredients(recipe, recipesById, resolution, swaps);
  if (flat.length === 0) return null;

  const byKey = new Map(items.map(i => [i.nameKey, i]));
  const factor = normalizeScale(scale);
  const acc = { totalMinor: 0, priced: 0, total: 0, oldestPricedAt: null as string | null };
  for (const line of flat) {
    // Costed as written, then scaled: see the header for why not the scaled text.
    accumulate(acc, line.ingredient.nameKey, line.ingredient.quantity, factor, byKey);
  }
  return finish(acc);
}

/**
 * What the planned meals in `range` are likely to cost, or null when too
 * little of the week is priced to say.
 *
 * Reads through `collectPlannedIngredients` rather than re-walking
 * `entries` itself, so a cooked entry is excluded and each entry's own scale
 * and choices apply exactly as they do for "Add week to list" — costing what
 * the week actually plans to buy, not a second reading of it.
 */
export function estimateWeekCost(
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  items: readonly GroceryItem[],
  range: { startKey: string; endKey: string },
  // The boxes, so an either/or resolves to the option on hand the way the
  // week's shopping read and weekNutrition resolve it, and the two figures
  // price the same arm of a choice.
  products: readonly ItemProduct[],
  swaps: StandingSwapMap = NO_STANDING_SWAPS
): CostEstimate | null {
  const planned = collectPlannedIngredients(
    entries, recipesById, range, swaps, onHandNameKeys(items, new Date(), products)
  );
  if (planned.length === 0) return null;

  const byKey = new Map(items.map(i => [i.nameKey, i]));
  const acc = { totalMinor: 0, priced: 0, total: 0, oldestPricedAt: null as string | null };
  for (const line of planned) {
    // The line as the recipe wrote it and the entry's scale, rather than the
    // scaled shopping text: see the header.
    accumulate(acc, line.nameKey, line.unscaled?.quantity ?? line.quantity, line.unscaled?.factor ?? 1, byKey);
  }
  return finish(acc);
}

/** The clause every cost estimate renders through — the shared half of describeRecipeCost/describeWeekCost. */
function describeCostEstimate(estimate: CostEstimate, symbol: string, now: Date, noun: string): string {
  const total = formatPrice(estimate.totalMinor, symbol);
  const coverage =
    estimate.priced === estimate.total ? `≈ ${total}` : `≈ ${total}, from ${estimate.priced} of ${estimate.total} ${noun}`;
  const age = estimate.oldestPricedAt ? describePriceAge(estimate.oldestPricedAt, now) : null;
  return age ? `${coverage} · prices as of ${age}` : coverage;
}

/** "≈ $14, from 6 of 9 ingredients", or null while there's nothing worth saying. */
export function describeRecipeCost(estimate: CostEstimate | null, symbol: string, now: Date): string | null {
  return estimate ? describeCostEstimate(estimate, symbol, now, 'ingredients') : null;
}

/** "≈ $58, from 13 of 22 items", or null while there's nothing worth saying. */
export function describeWeekCost(estimate: CostEstimate | null, symbol: string, now: Date): string | null {
  return estimate ? describeCostEstimate(estimate, symbol, now, 'items') : null;
}
