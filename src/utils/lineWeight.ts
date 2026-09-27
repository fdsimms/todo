import type { FoodNutrition, GroceryItem, ItemProduct } from '../types';
import { nutritionFor } from './foodNutrition';
import { resolvePluralKey } from './groceryPlural';
import { gramsForLine } from './ingredientGrams';
import { parseQuantity } from './quantity';
import { formatScaleWeight, measureParsedQuantity, type UnitSystem } from './unitConvert';

/**
 * What a recipe line written in cups, spoons or pieces weighs, for someone
 * cooking with a scale — "1 cup flour" beside "≈125 g".
 *
 * **Only ever read off the food's own portion table**, through the same
 * `gramsForLine` the nutrition rollup uses, and so under every refusal it
 * makes: no global density, no guessed size, a chopped cup and a sliced cup
 * kept apart. A line the rollup can't weigh gets no caption here either, which
 * is what keeps the number beside the ingredient and the one inside the
 * calorie count the same number. A portion the user weighed themselves
 * (`FoodPortion.custom`) counts exactly like a stated one: that is the
 * measurement this exists to put to use.
 *
 * Display only. Nothing is written back to the recipe, the same posture
 * `unitConvert.ts` takes for the same reason: the line stays the recipe's own
 * words, and the weight is the app's arithmetic beside it.
 */

/**
 * Grams for one line, or null when there is nothing to add.
 *
 * Null in three cases beyond `gramsForLine`'s own refusals:
 *
 * - **The line is already a weight.** "200 g" beside "≈200 g" says nothing.
 * - **A range.** `gramsForLine` takes the low end, which is right for a
 *   calorie count and wrong for a caption: "1 to 2 cups" beside one cup's
 *   weight reads as the weight of the whole line. `convertQuantity` refuses
 *   ranges for the same reason.
 * - **No figures on file**, so there is no portion table to read.
 */
export function lineWeightGrams(
  quantity: string,
  prep: string | null,
  nutrition: FoodNutrition | null,
): number | null {
  if (!nutrition || nutrition.portions.length === 0) return null;
  const parsed = parseQuantity(quantity);
  if (parsed.amount === null || parsed.rangeMax) return null;
  if (measureParsedQuantity(parsed)?.dimension === 'mass') return null;
  const grams = gramsForLine(parsed, prep, nutrition.portions);
  return grams !== null && grams > 0 ? grams : null;
}

/** `lineWeightGrams` written for the page — "≈125 g", or "≈4 1/2 oz" for a US reader. */
export function lineWeightText(
  quantity: string,
  prep: string | null,
  nutrition: FoodNutrition | null,
  system: UnitSystem,
): string | null {
  const grams = lineWeightGrams(quantity, prep, nutrition);
  return grams === null ? null : formatScaleWeight(grams, system);
}

/**
 * The panel a line named `nameKey` would be weighed against: its catalog row's
 * preferred box first, then the row itself — the same precedence
 * `nutritionFor` gives the rollup, and the same plural-tolerant lookup.
 *
 * Takes the lookup maps rather than the arrays so a screen building one per
 * render doesn't rebuild them per line.
 */
export function panelForLine(
  nameKey: string,
  byKey: ReadonlyMap<string, GroceryItem>,
  productsById: ReadonlyMap<string, ItemProduct>,
): FoodNutrition | null {
  const resolved = byKey.has(nameKey) ? nameKey : resolvePluralKey(nameKey, byKey.keys());
  const item = resolved ? byKey.get(resolved) : undefined;
  if (!item) return null;
  const product = item.preferredProductId ? productsById.get(item.preferredProductId) ?? null : null;
  return nutritionFor(item, product);
}
