import type { FoodLogEntry, FoodNutrition, GroceryItem, ItemProduct, Recipe } from '../types';
import {
  addProduceGrams,
  emptyProduceGrams,
  produceKindOf,
  type ProduceGrams,
  type RecipeProduceResolver,
} from './produceServings';
import { parseQuantity, rationalToNumber } from './quantity';
import { recipeNutritionLines, type NutritionLine } from './recipeNutrition';
import { NO_STANDING_SWAPS, type StandingSwapMap } from './standingSwaps';

/**
 * The vegetable and fruit in a logged recipe, for `dayProduce`.
 *
 * Kept apart from `produceServings.ts` because it needs the catalog and the
 * recipe walk (`recipeNutrition.ts`, which reaches the settings store), where
 * that file is pure.
 *
 * **It reads `recipeNutritionLines`, the rollup's own walk**, so a line counts
 * here exactly when it counts toward the dish's calories. A second walk would
 * disagree with the recipe page about which ingredients were weighed.
 *
 * **A dish with a produce ingredient it could not weigh is refused, not
 * undercounted.** "Tomato" with no portion table is a line the walk calls
 * `unmeasured`; summing the other lines would report a stew's vegetables as less
 * than they are and say nothing. The caller counts the refusal as `unmeasured`
 * and says so.
 */

/** Below this share of lines weighed, the dish is not worth a figure; the floor `recipeNutrition` uses. */
const MIN_LINE_COVERAGE = 0.5;

/** What a covered line weighed, in grams, or null when its panel has no mass to say. */
function lineGrams(line: NutritionLine): number | null {
  const { nutrition, multiplier } = line;
  if (!nutrition || multiplier === null) return null;
  return gramsOf(nutrition, multiplier);
}

function gramsOf(nutrition: FoodNutrition, multiplier: number): number | null {
  if (nutrition.basis === 'per100g') return multiplier * 100;
  if (nutrition.basis === 'perServing' && nutrition.servingGrams !== null && nutrition.servingGrams > 0) {
    return multiplier * nutrition.servingGrams;
  }
  // Per 100 ml has no mass without a density this app does not assume.
  return null;
}

/**
 * Grams of each kind in the whole dish at its written size, or null when too
 * little of it could be weighed to say.
 */
export function recipeProduceGrams(
  recipe: Recipe,
  items: readonly GroceryItem[],
  products: readonly ItemProduct[] = [],
  recipesById: ReadonlyMap<string, Recipe> = new Map([[recipe.id, recipe]]),
  swaps: StandingSwapMap = NO_STANDING_SWAPS,
): ProduceGrams | null {
  const lines = recipeNutritionLines(recipe, items, products, recipesById, undefined, 1, swaps);
  if (lines.length === 0) return null;

  const covered = lines.filter(line => line.state === 'covered').length;
  if (covered / lines.length < MIN_LINE_COVERAGE) return null;

  const out = emptyProduceGrams();
  for (const line of lines) {
    const kind = produceKindOf(line.name);
    if (kind === null || kind === 'mixed') continue;
    const grams = line.state === 'covered' ? lineGrams(line) : null;
    if (grams === null) return null;
    addProduceGrams(out, { [kind]: grams });
  }
  return out;
}

/**
 * How many helpings a logged quantity names: "2 servings" or a bare "2". Null
 * for anything else ("340g", "1 bowl"), which names an amount of something the
 * recipe's own servings count cannot be divided into.
 */
export function helpingsOf(quantity: string): number | null {
  const parsed = parseQuantity(quantity);
  if (parsed.amount === null) return null;
  if (parsed.unit !== null && parsed.unit !== 'serving') return null;
  const value = rationalToNumber(parsed.amount);
  return value > 0 ? value : null;
}

/**
 * What share of the dish one entry was, or null when nothing says.
 *
 * A weighed plate against a weighed dish (`Recipe.cookedWeightG`) is the exact
 * answer and is preferred. Otherwise helpings over the recipe's servings, which
 * needs the recipe to have named a count: treating the whole dish as one
 * helping is the failure `recipeHelpingNutrition` already refuses.
 */
export function dishShare(entry: FoodLogEntry, recipe: Recipe): number | null {
  if (recipe.cookedWeightG !== null && recipe.cookedWeightG > 0 && entry.grams !== null && entry.grams > 0) {
    return entry.grams / recipe.cookedWeightG;
  }
  const helpings = helpingsOf(entry.quantity);
  if (helpings === null || recipe.servings === null || recipe.servings <= 0) return null;
  return helpings / recipe.servings;
}

/**
 * A resolver for `dayProduce` over one catalog and recipe set. The dish's grams
 * are worked out once per recipe, since a day can log the same one twice and a
 * window logs it dozens of times.
 */
export function recipeProduceResolver(
  recipes: readonly Recipe[],
  items: readonly GroceryItem[],
  products: readonly ItemProduct[] = [],
  swaps: StandingSwapMap = NO_STANDING_SWAPS,
): RecipeProduceResolver {
  const byId = new Map(recipes.map(recipe => [recipe.id, recipe]));
  const dishes = new Map<string, ProduceGrams | null>();

  return entry => {
    if (entry.recipeId === null) return null;
    const recipe = byId.get(entry.recipeId);
    if (!recipe) return null;

    if (!dishes.has(recipe.id)) dishes.set(recipe.id, recipeProduceGrams(recipe, items, products, byId, swaps));
    const dish = dishes.get(recipe.id) ?? null;
    if (!dish) return null;

    const share = dishShare(entry, recipe);
    if (share === null) return null;
    return {
      vegetable: dish.vegetable * share,
      fruit: dish.fruit * share,
      dried: dish.dried * share,
      legume: dish.legume * share,
    };
  };
}
