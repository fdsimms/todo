import type {
  FoodNutrition,
  GroceryItem,
  ItemProduct,
  MealPlanEntry,
  NutrientKey,
  Recipe,
} from '../types';
import { NUTRIENT_KEYS } from '../types';
import { nutritionFor } from './foodNutrition';
import { panelMultiplier } from './ingredientGrams';
import { resolvePluralKey } from './groceryPlural';
import { collectPlannedIngredients } from './mealPlanGroceries';
import { flattenRecipeIngredients, type ChoiceResolution } from './recipeComponents';
import { normalizeScale, scaleQuantity } from './recipeScale';
import { NO_STANDING_SWAPS, type StandingSwapMap } from './standingSwaps';
import { onHandNameKeys } from './grocerySuggest';

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
 * **One walk, read twice.** `recipeNutritionLines` resolves each line and stops;
 * `recipeNutrition` is that plus `fold`. The second reader is the recipe page's
 * nutrition sheet, which lists the lines that *didn't* count so they can be
 * filled in, and it has to be describing the same lines the coverage clause
 * counted — a gap list built from its own rules would send somebody to correct
 * an ingredient the total had already used. Same call `calendarMonth.ts` makes
 * about there being one projection walk.
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
 * line at all. Salt missing a nutrition panel is not a gap in a dish's figures.
 */
function resolveLine(
  nameKey: string,
  quantity: string,
  prep: string | null,
  byKey: ReadonlyMap<string, GroceryItem>,
  productFor: (item: GroceryItem) => ItemProduct | null,
): LineResolution | null {
  // Plural-tolerant like every other catalog read (`groceryPlural.ts`), or a
  // line one letter off its own row counts against coverage while the panel it
  // needs sits right there.
  const resolved = byKey.has(nameKey) ? nameKey : resolvePluralKey(nameKey, byKey.keys());
  const item = resolved ? byKey.get(resolved) : undefined;
  if (item?.isStaple) return null;
  if (!item) return { state: 'unmatched', item: null, product: null, nutrition: null, multiplier: null };

  const product = productFor(item);
  const nutrition = nutritionFor(item, product);
  if (!nutrition) return { state: 'noPanel', item, product, nutrition: null, multiplier: null };

  const multiplier = panelMultiplier(quantity, prep, nutrition);
  if (multiplier === null) return { state: 'unmeasured', item, product, nutrition, multiplier: null };

  return { state: 'covered', item, product, nutrition, multiplier };
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

/** A dish's figures, the lines behind them, and what is missing, from one walk. */
export interface RecipeNutritionReading {
  /** The rollup, or null while too little of the dish is known to total it. */
  nutrition: RecipeNutrition | null;
  /** Every line that counts toward the fraction, staples excluded. */
  lines: NutritionLine[];
  gaps: NutritionGaps;
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
  /** Scaled, matching what the ingredient list shows and what was measured. */
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
 * Staples are absent, exactly as they are absent from both sides of that
 * fraction.
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

  const byKey = new Map(items.map(i => [i.nameKey, i]));
  const productFor = preferredProductLookup(products);
  const factor = normalizeScale(scale);

  const out: NutritionLine[] = [];
  for (const line of flat) {
    // Excluded outright, same as a staple: not a line that failed to count,
    // not a line at all.
    if (line.ingredient.excludeFromNutrition) continue;
    const quantity = scaleQuantity(line.ingredient.quantity, factor).text;
    const resolved = resolveLine(line.ingredient.nameKey, quantity, line.ingredient.prep, byKey, productFor);
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

  const byKey = new Map(items.map(i => [i.nameKey, i]));
  const productFor = preferredProductLookup(products);
  const resolved: LineResolution[] = [];
  for (const line of planned) {
    if (line.excludeFromNutrition) continue;
    const one = resolveLine(line.nameKey, line.quantity, null, byKey, productFor);
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

/** A dish's lines sorted into what can be done about them. */
export interface NutritionGaps {
  /** Lines that reached the total. */
  covered: number;
  /** Lines the dish calls for, staples excluded — the denominator on screen. */
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
