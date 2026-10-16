import type {
  FoodNutrition,
  GroceryItem,
  ItemProduct,
  MealPlanEntry,
  NutrientKey,
  Recipe,
  RecipeComponent,
} from '../types';
import { NUTRIENT_KEYS } from '../types';
import { nutritionFor } from './foodNutrition';
import { panelMultiplier } from './ingredientGrams';
import { resolvePluralKey } from './groceryPlural';
import { itemKeyIndex } from './itemAliases';
import { collectPlannedIngredients } from './mealPlanGroceries';
import { flattenRecipeIngredients, optionalCounts, type ChoiceResolution } from './recipeComponents';
import { normalizeScale, scaleQuantity } from './recipeScale';
import { NO_STANDING_SWAPS, type StandingSwapMap } from './standingSwaps';
import { onHandNameKeys } from './grocerySuggest';
import { groceryNameKey } from './groceryParse';
import { parseQuantity, rationalToNumber } from './quantity';
import { measureQuantity, ML_PER_TBSP } from './unitConvert';

/**
 * What a recipe, or a week of planned meals, is made of.
 *
 * **Deliberately `recipeCost.ts` with a different per-line value.** Read that
 * file first: it already solved flattening, resolution, per-line refusal,
 * coverage and the declining-rather-than-answering rule, and every one of
 * those applies here unchanged, with one exception noted where it lives
 * (`resolveLine`'s staple carve-out — a staple has no marginal *cost* at any
 * quantity, which cost's own exclusion is right to rely on, but it still has
 * real calories once the amount is more than a dash). What else is new is
 * below.
 *
 * **Coverage is per nutrient, not just per line**, which is the difference from
 * cost and the easiest thing to get wrong. A cost is one number and a line
 * either has it or doesn't. Nutrition is ten numbers, and a food may report
 * calories and protein but not fibre. Summing an absent fibre as 0 gives a
 * confident-looking total that is wrong in a way nothing on screen indicates —
 * a "0g fiber" line on a bean stew is the exact failure this whole tree is
 * arranged to avoid. So every nutrient carries how many contributing lines
 * actually reported it, and one below the floor comes back unknown.
 *
 * **Nothing is written back onto the recipe.** Computed at read time, like the
 * cost estimate, the scale factor and the unit conversion. A stored total goes
 * stale the moment an ingredient is edited.
 *
 * **One walk, read twice.** `recipeNutritionLines` resolves each line and stops;
 * `recipeNutrition` is that plus `fold`. The second reader is the recipe page's
 * nutrition sheet, which lists the lines that *didn't* count so they can be
 * filled in, and it has to be describing the same lines the coverage clause
 * counted — a gap list built from its own rules would send somebody to correct
 * an ingredient the total had already used. Same call `calendarMonth.ts` makes
 * about there being one projection walk.
 *
 * **The line is measured as written and the scale multiplies what it came
 * to**, rather than the scaled text being measured (#2918). The scaled text is
 * a shopping notation: it refuses shapes it has no way to write (1.5 of a
 * "14 oz can") and rewrites others into shapes that read differently ("14 oz
 * can" doubled is "2 14 oz cans"), so measuring it undercounted a can by a
 * third at 1.5x. The amount itself scales linearly on every basis
 * `panelMultiplier` reads, and nothing on the way to grams rounds (rounding is
 * `unitConvert`'s display step), so multiplying after is the same number
 * wherever scaling succeeds and the right one where it doesn't. The scaled
 * text is still what a line *shows*, so the list reads like the recipe.
 */

export interface RecipeNutrition {
  /**
   * The whole recipe. Per-serving is this over `servings`, computed by
   * `perServing` below rather than stored, since a stored one would have to be
   * kept in step with a scale factor that lives in view state.
   */
  total: Partial<Record<NutrientKey, number>>;
  /**
   * Per nutrient, how many contributing lines actually reported it. A nutrient
   * missing from `total` is unknown, never zero.
   */
  reported: Partial<Record<NutrientKey, number>>;
  /** Lines that resolved to an amount of a food whose panel is known… */
  covered: number;
  /** …out of how many the dish calls for, negligible staples excluded from both sides (see `resolveLine`). */
  lines: number;
  /**
   * How many servings *this* total is, which is the recipe's own count times
   * whatever scale was applied. Null when the recipe never named one.
   *
   * Scaled deliberately: doubling a recipe makes twice as many servings, not
   * twice as large a serving. Carrying the scaled count is what keeps a
   * per-serving figure still when the scale chips move, which is the built-in
   * check that the arithmetic is right.
   */
  servings: number | null;
}

/** The same line #1672 drew for cost: half the lines is what separates its own bad and good examples. */
const MIN_LINE_COVERAGE = 0.5;

/**
 * How many of the covered lines have to report a nutrient before its total is
 * worth showing.
 *
 * The same half, and for the same reason there is no science past it: a fibre
 * figure summed from one of six contributing foods is a number about mostly
 * nothing, dressed as a fact about the dish. A threshold has to be picked
 * somewhere, and picking the one cost already uses keeps the two readings of
 * "not enough of this is known" consistent.
 */
const MIN_NUTRIENT_COVERAGE = 0.5;

/**
 * Whether one line reached the total, and where it stopped if it didn't.
 *
 * **The three refusals are named rather than collapsed into "no", because they
 * are three different things to do about it.** The rollup only ever needed to
 * know that a line didn't count, which is why this started life as a sequence
 * of bare early returns inside the fold. A screen offering to *fill the gap*
 * needs to know which gap it is: a line with no catalog row wants linking, a
 * row with no figures wants a label typed in, and figures that can't be
 * related to the amount asked for want a portion weighed. Offering the wrong
 * one of those three is worse than offering nothing.
 */
export type NutritionLineState =
  /** Reached the total. */
  | 'covered'
  /** No catalog row of this name, so there is nothing yet to hold figures. */
  | 'unmatched'
  /** A catalog row, but neither it nor its preferred box states any figures. */
  | 'noPanel'
  /** Figures, but nothing relates *this* amount to them. See `panelMultiplier`. */
  | 'unmeasured';

interface LineResolution {
  state: NutritionLineState;
  /** The catalog row this line resolved to, null only when `unmatched`. */
  item: GroceryItem | null;
  /**
   * The preferred box whose panel spoke for it, when one did.
   *
   * Carried so a remedy writes back to whichever of the two rows
   * `nutritionFor` actually read — correcting a generic yogurt's figures
   * because a specific pot's were the ones on screen is the write version of
   * the bug that precedence rule exists to prevent.
   */
  product: ItemProduct | null;
  /** Whichever panel spoke, null for `unmatched` and `noPanel`. */
  nutrition: FoodNutrition | null;
  /** How many hundred units of that panel the line came to, null unless `covered`. */
  multiplier: number | null;
}

/**
 * Grams at or above which a staple's own line is too much to wave through
 * unmeasured, the way a dash of salt is.
 *
 * A weight needs no food-specific density to be read (`measureQuantity` below),
 * so "1 lb" is unambiguously not a pinch. No science past the number itself: a
 * packet of yeast ("7 g") or a knob of butter ("20 g") stay comfortably under
 * it, and a recipe calling for a pound of something (453 g) — the case that
 * surfaced this, sugar marked "Always have it" in a recipe that actually uses
 * a pound of it — clears it easily. Same kind of threshold as
 * `MIN_LINE_COVERAGE` below: it has to be picked somewhere.
 */
const STAPLE_BULK_THRESHOLD_G = 100;

/**
 * The volume counterpart: a tablespoon. Weights alone left this blind to the
 * way a staple is usually written: "3 tbsp olive oil" (about 360 kcal) was
 * waved through as negligible, so the dish read "7 of 7 counted" with a fifth
 * of its calories missing and nothing on screen to say so. Teaspoons and
 * smaller stay under it, which is where a dash of salt, pepper or a spice is
 * actually written; a counted unit ("3 cloves") and a range have no volume
 * to measure and stay waved through.
 */
const STAPLE_BULK_THRESHOLD_ML = ML_PER_TBSP;

/**
 * Whether a staple's own line names an amount too large to treat as
 * negligible, at `factor` times the amount written (see the header on
 * scaling).
 */
function isBulkStapleQuantity(quantity: string, factor: number): boolean {
  const measured = measureQuantity(quantity);
  if (measured === null) return false;
  const scaled = measured.base * factor;
  if (measured.dimension === 'mass') return scaled >= STAPLE_BULK_THRESHOLD_G;
  if (measured.dimension === 'volume') return scaled >= STAPLE_BULK_THRESHOLD_ML;
  return false;
}

/**
 * Where one line got to, or null for a staple.
 *
 * **The one place the per-line rule lives**, read by the fold below and by
 * `recipeNutritionLines`. It used to be the fold's own early returns, which
 * was fine while the rollup was the only reader; a second copy written for the
 * gap list would be two answers to "does this line count", and the screen
 * offering to fix a line the total had already counted is exactly how that
 * drift would show up.
 *
 * A staple is null rather than a state of its own: it is excluded from *both*
 * sides of the coverage fraction, so it is not a line that failed, it is not a
 * line at all. Salt missing a nutrition panel is not a gap in a dish's figures
 * — **unless the line itself says otherwise**. `isBulkStapleQuantity` is the
 * one exception: a staple written in a genuinely large amount (100 g or a
 * tablespoon and up) is treated as an
 * ordinary ingredient (falling through to `unmatched`/`noPanel`/`unmeasured`/
 * `covered` below) rather than silently dropped, because a pound of something
 * is a real contribution to a dish's figures whether or not it's also
 * something the cook always keeps stocked. `recipeCost.ts` doesn't need this
 * — being stocked already, rather than bought for this recipe, is a reason a
 * staple has no marginal *cost* here at any quantity, which is a different
 * claim from "this amount has no calories".
 */
function resolveLine(
  nameKey: string,
  /** As written, unscaled: `factor` multiplies what it measures to. */
  quantity: string,
  prep: string | null,
  byKey: ReadonlyMap<string, GroceryItem>,
  productFor: (item: GroceryItem) => ItemProduct | null,
  factor = 1,
): LineResolution | null {
  // Plural-tolerant like every other catalog read (`groceryPlural.ts`), or a
  // line one letter off its own row counts against coverage while the panel it
  // needs sits right there.
  const resolved = byKey.has(nameKey) ? nameKey : resolvePluralKey(nameKey, byKey.keys());
  const item = resolved ? byKey.get(resolved) : undefined;
  if (item?.isStaple && !isBulkStapleQuantity(quantity, factor)) return null;
  if (!item) return { state: 'unmatched', item: null, product: null, nutrition: null, multiplier: null };

  const product = productFor(item);
  const nutrition = nutritionFor(item, product);
  if (!nutrition) return { state: 'noPanel', item, product, nutrition: null, multiplier: null };

  const multiplier = panelMultiplier(quantity, prep, nutrition);
  if (multiplier === null) return { state: 'unmeasured', item, product, nutrition, multiplier: null };

  return { state: 'covered', item, product, nutrition, multiplier: multiplier * factor };
}

interface Accumulator {
  total: Partial<Record<NutrientKey, number>>;
  reported: Partial<Record<NutrientKey, number>>;
  covered: number;
  lines: number;
}

/** Folds the resolved lines into one reading, staples already dropped. */
function fold(
  resolutions: readonly LineResolution[],
  servings: number | null,
): RecipeNutrition | null {
  const acc: Accumulator = { total: {}, reported: {}, covered: 0, lines: 0 };
  for (const line of resolutions) {
    acc.lines += 1;
    if (line.state !== 'covered' || !line.nutrition || line.multiplier === null) continue;
    acc.covered += 1;
    for (const key of NUTRIENT_KEYS) {
      const amount = line.nutrition.amounts[key];
      if (amount === undefined) continue;
      acc.total[key] = (acc.total[key] ?? 0) + amount * line.multiplier;
      acc.reported[key] = (acc.reported[key] ?? 0) + 1;
    }
  }
  return finish(acc, servings);
}

/** Drops the nutrients too few lines reported, and refuses outright below the line floor. */
function finish(acc: Accumulator, servings: number | null): RecipeNutrition | null {
  if (acc.lines === 0 || acc.covered / acc.lines < MIN_LINE_COVERAGE) return null;

  const total: Partial<Record<NutrientKey, number>> = {};
  const reported: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const count = acc.reported[key];
    if (count === undefined) continue;
    reported[key] = count;
    if (count / acc.covered < MIN_NUTRIENT_COVERAGE) continue;
    total[key] = Math.round((acc.total[key] ?? 0) * 10) / 10;
  }
  if (Object.keys(total).length === 0) return null;
  return { total, reported, covered: acc.covered, lines: acc.lines, servings };
}

/**
 * Whether an either/or slot came through with more than one option still
 * standing.
 *
 * `ChoiceResolution.undecided` yields *both* options in the flattened list,
 * which for shopping means buying either and for nutrition would mean counting
 * both. Serrano and jalapeño are close enough that nobody would notice; mash or
 * roast potatoes is not. So a recipe with an unresolved choice is refused
 * rather than answered.
 *
 * Refusing is the honest option of the two the issue offered. Resolving to the
 * default and saying so would put a number on screen that the user could read
 * as being about the dish they actually picked, and the caption saying
 * otherwise is exactly the sort of thing nobody reads.
 */
function hasUnresolvedChoice(
  flat: readonly { ingredient: { choiceGroup: string | null }; recipe: { id: string } }[],
): boolean {
  const seen = new Map<string, number>();
  for (const line of flat) {
    if (!line.ingredient.choiceGroup) continue;
    const key = `${line.recipe.id}:${line.ingredient.choiceGroup}`;
    const count = (seen.get(key) ?? 0) + 1;
    if (count > 1) return true;
    seen.set(key, count);
  }
  return false;
}

/** Looks a catalog item's preferred box up, so a specific pot's panel beats the generic row's. */
function preferredProductLookup(
  products: readonly ItemProduct[],
): (item: GroceryItem) => ItemProduct | null {
  const byId = new Map(products.map(p => [p.id, p]));
  return item => (item.preferredProductId ? byId.get(item.preferredProductId) ?? null : null);
}

/**
 * What one meal of `recipe` — scaled, with its components and choices
 * resolved — is made of, or null when too little of it is known to say.
 *
 * Mirrors `estimateRecipeCost`'s parameter order exactly, so the two readings
 * of a recipe can't drift: the same flattening, the same swaps, the same
 * scale.
 */
export function recipeNutrition(
  recipe: Recipe,
  items: readonly GroceryItem[],
  products: readonly ItemProduct[] = [],
  recipesById: ReadonlyMap<string, Recipe> = new Map([[recipe.id, recipe]]),
  resolution?: ChoiceResolution,
  scale = 1,
  swaps: StandingSwapMap = NO_STANDING_SWAPS,
): RecipeNutrition | null {
  return readRecipeNutrition(recipe, items, products, recipesById, resolution, scale, swaps).nutrition;
}

/**
 * How much of each used recipe a dish actually eats, as a fraction of the
 * batch the part's own recipe makes, keyed by that recipe's id. A recipe not
 * in the map counts whole.
 *
 * A used recipe's lines are flattened in whole, so "1 tbsp Fishy Seasoning"
 * charged the dish for the entire 3/4 cup batch. The amount comes from the
 * link's own `amountUsed` when one was typed ("1 tbsp", "2 fillets", or a
 * bare "1/4" for a quarter of the batch), else from the parent's own
 * ingredient line naming the part. It is only believed when it can be
 * compared with the part's `recipeYield`: both measured in one dimension, or
 * both counting the same unit. Anything else (no amount, no yield, "to taste",
 * mismatched units) counts whole, as it always did. Shares compound down a
 * chain of parts. A recipe's `cookedWeightG` is not consulted: a line in
 * tablespoons has no weight until the part's own panel is worked out.
 */
export function componentShares(
  root: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
): Map<string, number> {
  const shares = new Map<string, number>();
  const visited = new Set<string>([root.id]);
  const walk = (node: Recipe, share: number): void => {
    for (const component of node.components ?? []) {
      if (visited.has(component.recipeId)) continue;
      const part = recipesById.get(component.recipeId);
      if (!part) continue;
      visited.add(part.id);
      const used = usedFraction(node, component, part);
      const partShare = share * (used ?? 1);
      if (partShare !== 1) shares.set(part.id, partShare);
      walk(part, partShare);
    }
  };
  walk(root, 1);
  return shares;
}

/** `amount` as a fraction of `yielded`, or null when the two cannot be compared. */
function fractionOf(amount: string, yielded: string | null): number | null {
  const q = parseQuantity(amount);
  if (!q.amount) return null;
  const used = rationalToNumber(q.amount);
  if (!(used > 0)) return null;
  // A bare number is a number of batches: "1/4" is a quarter of it.
  if (q.unit === null && q.rest === '') return used;
  if (!yielded) return null;
  const a = measureQuantity(amount);
  const y = measureQuantity(yielded);
  if (a && y) return a.dimension === y.dimension && y.base > 0 ? a.base / y.base : null;
  // Counts of one thing: "2 fillets" of "4 fillets".
  const yq = parseQuantity(yielded);
  if (q.unit && yq.amount && yq.unit === q.unit) {
    const total = rationalToNumber(yq.amount);
    return total > 0 ? used / total : null;
  }
  return null;
}

function usedFraction(parent: Recipe, component: RecipeComponent, part: Recipe): number | null {
  if (component.amountUsed) return fractionOf(component.amountUsed, part.recipeYield);
  if (!part.recipeYield) return null;
  const line = parent.ingredients.find(i => i.nameKey === groceryNameKey(part.name));
  return line ? fractionOf(line.quantity, part.recipeYield) : null;
}

/** A dish's figures, the lines behind them, and what is missing, from one walk. */
export interface RecipeNutritionReading {
  /** The rollup, or null while too little of the dish is known to total it. */
  nutrition: RecipeNutrition | null;
  /** Every line that counts toward the fraction, negligible staples excluded. */
  lines: NutritionLine[];
  gaps: NutritionGaps;
  /**
   * Lines the person deliberately left out, purely for display. Not part of
   * `gaps` or the fraction it describes — an excluded line was never a gap,
   * so listing it there would offer to fix something nobody asked to fix.
   * This exists only so "don't count this" isn't a one-way door: a line that
   * disappeared with no trace is a line nobody can reconsider or undo.
   */
  excluded: ExcludedNutritionLine[];
}

/**
 * Everything a screen showing a dish's nutrition needs, resolved once.
 *
 * The recipe page wants three readings of the same walk — a summary line, a
 * count of what is missing, and the list behind it — and taking them from
 * three calls would be three chances for the sentence and the list under it to
 * describe different lines. `recipeNutrition` is this, narrowed to the rollup,
 * for the callers that only ever wanted that.
 */
export function readRecipeNutrition(
  recipe: Recipe,
  items: readonly GroceryItem[],
  products: readonly ItemProduct[] = [],
  recipesById: ReadonlyMap<string, Recipe> = new Map([[recipe.id, recipe]]),
  resolution?: ChoiceResolution,
  scale = 1,
  swaps: StandingSwapMap = NO_STANDING_SWAPS,
): RecipeNutritionReading {
  const lines = recipeNutritionLines(recipe, items, products, recipesById, resolution, scale, swaps);
  const factor = normalizeScale(scale);
  return {
    lines,
    nutrition: fold(lines, recipe.servings === null ? null : recipe.servings * factor),
    gaps: nutritionGaps(lines),
    excluded: excludedNutritionLines(recipe, recipesById, resolution, swaps),
  };
}

/**
 * One line of a dish, and what its figures came to.
 *
 * Everything a screen needs to name the gap and write the fix back, and
 * nothing derived: `state` says which of the three remedies applies, `item`
 * and `product` say which row a correction belongs on, and `nutrition` is the
 * panel already on file — the one a correction edits rather than replaces.
 */
export interface NutritionLine extends LineResolution {
  /** The recipe line's own id, unique across a flattened dish. */
  id: string;
  /**
   * The recipe this line is actually written on — the root for a plain
   * dish, but a component's own id for a line that came in through one (see
   * `flattenRecipeIngredients`). Excluding a line writes back to
   * `RecipeIngredient.excludeFromNutrition`, and that write has to land on
   * the recipe holding the ingredient, not on whichever recipe the sheet
   * opened for.
   */
  recipeId: string;
  /** As the recipe writes it, so a row here reads like the row on the page. */
  name: string;
  /**
   * Scaled, matching what the ingredient list shows. Display only: the figures
   * are the as-written line measured and then multiplied by the scale (see the
   * header), so a line whose scaled text reads differently still counts.
   */
  quantity: string;
  prep: string | null;
}

/**
 * Every line of a dish that counts toward its figures, resolved but not summed.
 *
 * **The rollup's own walk, stopped one step early.** `recipeNutrition` is this
 * plus `fold`, which is what keeps "from 6 of 9 ingredients" and the list of
 * the other three describing the same nine lines. A screen listing gaps by its
 * own rules would eventually disagree with the count that sent someone looking
 * for them.
 *
 * A negligible staple is absent, exactly as it's absent from both sides of
 * that fraction — but one written in a bulk weight isn't (see `resolveLine`),
 * so it shows up here like any other line, gap and all.
 *
 * **A dish with an undecided either/or comes back empty**, matching the
 * refusal `recipeNutrition` already makes and for the same reason: both
 * options are in the flattened list, so a gap list built from it would ask
 * someone to fill in figures for the pepper they aren't cooking. The choice is
 * the thing to settle first, and `ComponentChoiceSheet` is where that happens.
 */
export function recipeNutritionLines(
  recipe: Recipe,
  items: readonly GroceryItem[],
  products: readonly ItemProduct[] = [],
  recipesById: ReadonlyMap<string, Recipe> = new Map([[recipe.id, recipe]]),
  resolution?: ChoiceResolution,
  scale = 1,
  swaps: StandingSwapMap = NO_STANDING_SWAPS,
): NutritionLine[] {
  const flat = flattenRecipeIngredients(recipe, recipesById, resolution, swaps);
  if (flat.length === 0) return [];
  if (hasUnresolvedChoice(flat)) return [];

  const byKey = itemKeyIndex(items);
  const productFor = preferredProductLookup(products);
  const factor = normalizeScale(scale);
  const shares = componentShares(recipe, recipesById);

  const out: NutritionLine[] = [];
  for (const line of flat) {
    // Excluded outright, same as a staple: not a line that failed to count,
    // not a line at all.
    if (line.ingredient.excludeFromNutrition) continue;
    // An optional line the meal didn't pick is not part of what was eaten.
    if (!optionalCounts(line.ingredient, resolution)) continue;
    const quantity = scaleQuantity(line.ingredient.quantity, factor).text;
    // Measured as written, then scaled: see the header for why not `quantity`.
    const resolved = resolveLine(
      line.ingredient.nameKey, line.ingredient.quantity, line.ingredient.prep, byKey, productFor,
      // The share a used recipe is eaten at rides on the multiplier only; the
      // quantity shown is still the line as the part's recipe wrote it.
      factor * (shares.get(line.recipe.id) ?? 1),
    );
    if (!resolved) continue;
    out.push({
      ...resolved,
      id: line.ingredient.id,
      recipeId: line.recipe.id,
      name: line.ingredient.name,
      quantity,
      prep: line.ingredient.prep,
    });
  }
  return out;
}

/** A line left out of a dish's figures on purpose, named so it can be undone. */
export interface ExcludedNutritionLine {
  /** The recipe line's own id, unique across a flattened dish. */
  id: string;
  /** The recipe holding the ingredient — see `NutritionLine.recipeId`. */
  recipeId: string;
  name: string;
}

/**
 * Every line of a dish marked `RecipeIngredient.excludeFromNutrition`.
 *
 * A second, much smaller walk rather than a state `recipeNutritionLines`
 * returns for these lines too: that function's own tests and callers treat
 * an excluded line exactly like a staple — "not a line that failed to count,
 * not a line at all" — and folding it back in there would put it back into
 * the coverage fraction's denominator, which is the one thing "don't count
 * this" must never do. What's missing isn't a place in that fraction, it's
 * anywhere at all that names what got left out, so a person can see it and
 * change their mind. This is only that: no catalog resolution, no state,
 * just which lines and what to call them.
 */
export function excludedNutritionLines(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe> = new Map([[recipe.id, recipe]]),
  resolution?: ChoiceResolution,
  swaps: StandingSwapMap = NO_STANDING_SWAPS,
): ExcludedNutritionLine[] {
  const flat = flattenRecipeIngredients(recipe, recipesById, resolution, swaps);
  if (flat.length === 0 || hasUnresolvedChoice(flat)) return [];
  return flat
    .filter(line => line.ingredient.excludeFromNutrition)
    .map(line => ({ id: line.ingredient.id, recipeId: line.recipe.id, name: line.ingredient.name }));
}

/**
 * What one covered line actually added to the total, or null for a line that
 * didn't reach it.
 *
 * The same `amount * multiplier` the fold sums, read back per line instead of
 * summed — so a screen naming each ingredient's share and the total it adds up
 * to can't disagree about the arithmetic. Rounded the same way `finish` rounds
 * the total, for the same reason: tenths, calories whole.
 */
export function lineContribution(line: NutritionLine): Partial<Record<NutrientKey, number>> | null {
  if (line.state !== 'covered' || !line.nutrition || line.multiplier === null) return null;
  const out: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const amount = line.nutrition.amounts[key];
    if (amount === undefined) continue;
    out[key] = Math.round(amount * line.multiplier * 10) / 10;
  }
  return out;
}

/**
 * What the planned meals in `range` are made of, or null when too little of the
 * week is known.
 *
 * Reads through `collectPlannedIngredients` rather than re-walking `entries`,
 * exactly as `estimateWeekCost` does, so a cooked entry is excluded and each
 * entry's own scale and choices apply. Servings is null: a week is not a
 * recipe and has no serving count of its own.
 */
export function weekNutrition(
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  items: readonly GroceryItem[],
  range: { startKey: string; endKey: string },
  products: readonly ItemProduct[] = [],
  swaps: StandingSwapMap = NO_STANDING_SWAPS,
): RecipeNutrition | null {
  const planned = collectPlannedIngredients(
    entries, recipesById, range, swaps, onHandNameKeys(items, new Date(), products)
  );
  if (planned.length === 0) return null;

  const byKey = itemKeyIndex(items);
  const productFor = preferredProductLookup(products);
  const resolved: LineResolution[] = [];
  for (const line of planned) {
    // `optional` on a planned row is an optional line its meal didn't pick.
    if (line.excludeFromNutrition || line.optional) continue;
    // Measured as written, then scaled, like a single recipe's lines: the
    // planned row's own `quantity` is the scaled shopping text (see the header).
    const one = resolveLine(
      line.nameKey,
      line.unscaled?.quantity ?? line.quantity,
      null,
      byKey,
      productFor,
      line.unscaled?.factor ?? 1,
    );
    if (one) resolved.push(one);
  }
  return fold(resolved, null);
}

/**
 * One serving's worth, or null when the recipe never said how many it makes.
 *
 * **Never invents a servings count.** Cronometer's own worst behaviour is
 * confidently dividing by a number nobody entered, and `recipeScale.ts` already
 * notes that plenty of recipes never had one — which is why the scale chips
 * exist instead of a servings stepper. A recipe without servings gets a whole
 * -recipe total and nothing else.
 *
 * The scale cancels out: doubling a recipe doubles the total *and* the
 * servings it makes, so a serving is the same size either way. That the
 * per-serving figures don't move with the scale chips is a built-in check that
 * the arithmetic is right.
 */
export function perServing(
  nutrition: RecipeNutrition | null,
): Partial<Record<NutrientKey, number>> | null {
  if (!nutrition || !nutrition.servings || nutrition.servings <= 0) return null;
  const out: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const amount = nutrition.total[key];
    if (amount === undefined) continue;
    out[key] = Math.round((amount / nutrition.servings) * 10) / 10;
  }
  return out;
}

/**
 * The nutrients a one-line summary leads with.
 *
 * **Two, not ten, and the number was decided in a mock rather than guessed.**
 * This sits directly under the cost estimate, which carries a coverage clause
 * of its own, so a nutrition line that wraps puts two ragged two-line captions
 * on top of each other. Calories and protein fit one line at 390pt with the
 * coverage clause still attached; adding carbohydrate wrapped it and orphaned
 * the word "ingredients".
 *
 * The rest of the panel is in `total` and unshown, waiting for a surface with
 * room for it. Nothing is lost, only not led with.
 */
const SUMMARY_KEYS: readonly NutrientKey[] = ['calorieKcal', 'proteinG'];

/** How each summarised nutrient is written. Calories carry no unit suffix, the way a label prints them. */
const SUMMARY_LABEL: Record<string, (amount: number) => string> = {
  calorieKcal: n => `${Math.round(n)} cal`,
  proteinG: n => `${Math.round(n)}g protein`,
};

/**
 * "≈ 520 cal, 31g protein per serving, from 6 of 9 ingredients", or null while
 * there is nothing worth saying.
 *
 * Three moves, the same three `describeRecipeCost` makes and for the same
 * reasons: the approximation marker, the coverage clause, and no claim beyond
 * what the data supports.
 *
 * **Per serving leads when the recipe has a servings count, and the whole
 * recipe when it doesn't.** Never both at once, because two totals differing by
 * a factor nobody stated is how a reader ends up quoting the wrong one.
 *
 * **The coverage clause is not optional**, and is what stops the number reading
 * as a fact. It drops only at full coverage, exactly as `describeCostEstimate`
 * drops it when everything is priced.
 *
 * No daily-value percentages, no grading, no colour. Those need an RDA the app
 * has never asked for, and `cookingStats.ts`'s rule holds here too: counts,
 * never a score.
 */
function describeNutrition(nutrition: RecipeNutrition, noun: string): string | null {
  const per = perServing(nutrition);
  const figures = per ?? nutrition.total;

  const parts = SUMMARY_KEYS
    .filter(key => figures[key] !== undefined)
    .map(key => SUMMARY_LABEL[key](figures[key] as number));
  if (parts.length === 0) return null;

  const basis = per ? ' per serving' : '';
  const coverage =
    nutrition.covered === nutrition.lines
      ? ''
      : `, from ${nutrition.covered} of ${nutrition.lines} ${noun}`;
  return `≈ ${parts.join(', ')}${basis}${coverage}`;
}

export function describeRecipeNutrition(nutrition: RecipeNutrition | null): string | null {
  return nutrition ? describeNutrition(nutrition, 'ingredients') : null;
}

/** How each summarised nutrient is written as a range, low to high. */
const SUMMARY_RANGE_LABEL: Record<string, (low: number, high: number) => string> = {
  calorieKcal: (low, high) => `${Math.round(low)}–${Math.round(high)} cal`,
  proteinG: (low, high) => `${Math.round(low)}–${Math.round(high)}g protein`,
};

/**
 * A recipe's figures as a range when its optional lines would change them:
 * "≈ 320–610 cal, 12–20g protein per serving, the higher with every optional
 * line". `withOptional` is the reading with every optional line counted
 * (`ChoiceResolution.withOptional`). The low end is what a meal that picks
 * none of them comes to, which is what `nutrition` is; a nutrient the two
 * agree on reads as one number, and when they agree on all of them, or the
 * top can't be counted, this is `describeRecipeNutrition`.
 */
export function describeRecipeNutritionRange(
  nutrition: RecipeNutrition | null,
  withOptional: RecipeNutrition | null,
): string | null {
  if (!nutrition || !withOptional) return describeRecipeNutrition(nutrition);
  const low = perServing(nutrition) ?? nutrition.total;
  const high = perServing(withOptional) ?? withOptional.total;
  const differs = SUMMARY_KEYS.some(key =>
    low[key] !== undefined && high[key] !== undefined && Math.round(low[key] as number) !== Math.round(high[key] as number));
  if (!differs) return describeRecipeNutrition(nutrition);
  const parts = SUMMARY_KEYS
    .filter(key => low[key] !== undefined)
    .map(key => {
      const lo = low[key] as number;
      const hi = high[key];
      return hi === undefined || Math.round(hi) === Math.round(lo)
        ? SUMMARY_LABEL[key](lo)
        : SUMMARY_RANGE_LABEL[key](Math.min(lo, hi), Math.max(lo, hi));
    });
  const basis = perServing(nutrition) ? ' per serving' : '';
  const coverage =
    nutrition.covered === nutrition.lines ? '' : `, from ${nutrition.covered} of ${nutrition.lines} ingredients`;
  return `≈ ${parts.join(', ')}${basis}${coverage}, the higher with every optional line`;
}

/** A dish's lines sorted into what can be done about them. */
export interface NutritionGaps {
  /** Lines that reached the total. */
  covered: number;
  /** Lines the dish calls for, negligible staples excluded — the denominator on screen. */
  total: number;
  /**
   * The lines somebody can answer from the recipe page: a catalog row missing
   * its figures, or figures nothing relates this amount to.
   */
  fillable: NutritionLine[];
  /**
   * Lines with no catalog row at all.
   *
   * Separated because they are listed rather than offered. Linking a line to
   * the catalog is a thing this app already does, in its own sheet, by
   * renaming the line — reproducing it here would be a second way to do one
   * job, and most one-off ingredients are meant to stay unlinked anyway.
   */
  unmatched: NutritionLine[];
}

export function nutritionGaps(lines: readonly NutritionLine[]): NutritionGaps {
  return {
    covered: lines.filter(l => l.state === 'covered').length,
    total: lines.length,
    fillable: lines.filter(l => l.state === 'noPanel' || l.state === 'unmeasured'),
    unmatched: lines.filter(l => l.state === 'unmatched'),
  };
}

/**
 * "Nutrition from 3 of 9 ingredients", or null for a dish with no lines to
 * count.
 *
 * What the summary row says when there are not yet enough figures for
 * `describeRecipeNutrition` to say anything — which is most recipes before
 * anyone has filled a gap in, and precisely when somebody would want to.
 *
 * It reads "from N of M" rather than naming a defect, because a line without
 * figures is not a fault: an ingredient nobody has scanned or typed a label
 * for is the ordinary state of most of a catalog. The phrasing is the rollup's
 * own coverage clause, so the row says the same thing in the same words
 * whether or not there is a total in front of it.
 */
export function describeNutritionCoverage(gaps: NutritionGaps): string | null {
  if (gaps.total === 0) return null;
  return `Nutrition from ${gaps.covered} of ${gaps.total} ingredients`;
}

/**
 * "≈ 8,400 cal, 380g protein, from 13 of 22 items", or null while there is
 * nothing worth saying.
 *
 * The same split `describeRecipeCost` and `describeWeekCost` already make over
 * one body: a recipe is read as a list of ingredients and a week as a list of
 * items to buy, and the two nouns are what the reader is actually looking at.
 *
 * It never carries a per-serving basis, because `weekNutrition` sets no
 * servings count. A week is not a recipe and dividing its total by anything
 * would be inventing a number of eaters.
 */
export function describeWeekNutrition(nutrition: RecipeNutrition | null): string | null {
  return nutrition ? describeNutrition(nutrition, 'items') : null;
}

/**
 * The recipes a search matches by name that the food log cannot offer, because
 * their figures came back unknown (below `MIN_LINE_COVERAGE`) or they name no
 * serving count. The log's list silently drops such a recipe, so a person who
 * typed its name saw "No matching food" for a dish they could see in Recipes.
 * Matches the way the list does (`groceryNameKey`, substring), and returns
 * nothing for an empty query, where there is no name to have matched.
 */
export function recipesWithoutFigures(
  recipes: readonly Pick<Recipe, 'id' | 'name'>[],
  loggableIds: ReadonlySet<string>,
  query: string,
): string[] {
  const key = groceryNameKey(query);
  if (!key) return [];
  return recipes
    .filter(r => !loggableIds.has(r.id) && groceryNameKey(r.name).includes(key))
    .map(r => r.name);
}
