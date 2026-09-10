import type { FoodNutrition, GroceryItem, ItemProduct, MealPlanEntry, NutrientKey, Recipe } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { nutritionFor } from './foodNutrition';
import { panelMultiplier } from './ingredientGrams';
import { resolvePluralKey } from './groceryPlural';
import { collectPlannedIngredients } from './mealPlanGroceries';
import { flattenRecipeIngredients, type ChoiceResolution } from './recipeComponents';
import { normalizeScale, scaleQuantity } from './recipeScale';
import { NO_STANDING_SWAPS, type StandingSwapMap } from './standingSwaps';

/**
 * What a recipe, or a week of planned meals, is made of.
 *
 * **Deliberately `recipeCost.ts` with a different per-line value.** Read that
 * file first: it already solved flattening, resolution, per-line refusal,
 * coverage and the declining-rather-than-answering rule, and every one of
 * those applies here unchanged. What is new is below.
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
 * **Scale then convert, in that order**, matching `unitConvert`'s own note: the
 * multiplication is exact and the gram resolution rounds, so rounding last is
 * the only order that doesn't compound.
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
  /** …out of how many the dish calls for, staples excluded from both sides. */
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

interface Accumulator {
  total: Partial<Record<NutrientKey, number>>;
  reported: Partial<Record<NutrientKey, number>>;
  covered: number;
  lines: number;
}

/** Folds one more line in, staples excluded from both sides of the fraction. */
function accumulate(
  acc: Accumulator,
  nameKey: string,
  quantity: string,
  prep: string | null,
  byKey: ReadonlyMap<string, GroceryItem>,
  productFor: (item: GroceryItem) => ItemProduct | null,
): void {
  // Plural-tolerant like every other catalog read (`groceryPlural.ts`), or a
  // line one letter off its own row counts against coverage while the panel it
  // needs sits right there.
  const resolved = byKey.has(nameKey) ? nameKey : resolvePluralKey(nameKey, byKey.keys());
  const item = resolved ? byKey.get(resolved) : undefined;
  if (item?.isStaple) return;
  acc.lines += 1;
  if (!item) return;

  const nutrition = nutritionFor(item, productFor(item));
  if (!nutrition) return;
  const multiplier = panelMultiplier(quantity, prep, nutrition);
  if (multiplier === null) return;

  acc.covered += 1;
  for (const key of NUTRIENT_KEYS) {
    const amount = nutrition.amounts[key];
    if (amount === undefined) continue;
    acc.total[key] = (acc.total[key] ?? 0) + amount * multiplier;
    acc.reported[key] = (acc.reported[key] ?? 0) + 1;
  }
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
  const flat = flattenRecipeIngredients(recipe, recipesById, resolution, swaps);
  if (flat.length === 0) return null;
  if (hasUnresolvedChoice(flat)) return null;

  const byKey = new Map(items.map(i => [i.nameKey, i]));
  const productFor = preferredProductLookup(products);
  const factor = normalizeScale(scale);
  const acc: Accumulator = { total: {}, reported: {}, covered: 0, lines: 0 };
  for (const line of flat) {
    const quantity = scaleQuantity(line.ingredient.quantity, factor).text;
    accumulate(acc, line.ingredient.nameKey, quantity, line.ingredient.prep, byKey, productFor);
  }
  return finish(acc, recipe.servings === null ? null : recipe.servings * factor);
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
  const planned = collectPlannedIngredients(entries, recipesById, range, swaps);
  if (planned.length === 0) return null;

  const byKey = new Map(items.map(i => [i.nameKey, i]));
  const productFor = preferredProductLookup(products);
  const acc: Accumulator = { total: {}, reported: {}, covered: 0, lines: 0 };
  for (const line of planned) {
    accumulate(acc, line.nameKey, line.quantity, null, byKey, productFor);
  }
  return finish(acc, null);
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
