import type { MealPlanEntry, NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';

/**
 * Turning a meal that just happened into an offer to log it.
 *
 * **The cheapest logging moment the app will ever have.** A meal-slot chain's
 * last step is literally "Eat", and finishing a leftover already means somebody
 * ate it. Both are moments where the app already knows what the food was and
 * roughly what was in it, so the only thing left to ask is how much.
 *
 * **It offers and never writes.** A plan is a plan and plans go wrong: the
 * dinner was cooked, then everyone went out instead. An entry written for food
 * nobody ate is the write-side failure `docs/arch/health-data.md` describes at
 * length, and it is worse than no entry at all because nothing downstream would
 * ever question it. `mealSlotDrift` already establishes that a generated meal
 * task owns only six fields and withholds the chain once the chain is under
 * way, precisely because the plan can diverge from reality; the same caution
 * applies to acting on it.
 *
 * **Declining costs one tap and is never punished.** No badge, no "you didn't
 * log", no streak. That is the mood nudge's rule and the reason the app is
 * pleasant to live with.
 *
 * **Nothing here imports `recipeNutrition.ts`**, which reaches the meal plan
 * and through it the settings store and SQLite. The dish's figures are passed
 * in already divided, so this module stays exercisable without a database.
 * Same split `foodLog.ts` keeps, and for the same reason.
 */

/** A dish's figures, as the recipe rollup answers them. */
export interface DishFigures {
  /** The whole dish. */
  total: Partial<Record<NutrientKey, number>>;
  /** Divided by servings, or null when the dish never said how many it makes. */
  perServing: Partial<Record<NutrientKey, number>> | null;
  /**
   * How many servings `total` is — `RecipeNutrition.servings`, so already
   * scaled. Null when the recipe never said.
   *
   * Carried alongside `perServing` rather than inferred by dividing one set of
   * figures by the other: a nutrient absent from either would give a different
   * count, and a count is not a thing to guess twice.
   */
  servings: number | null;
  /**
   * What the whole cooked dish weighed, in grams, already multiplied by this
   * cooking's scale. Null when nobody has weighed it, which is every dish
   * until somebody does.
   */
  cookedGrams: number | null;
}

/** What one helping works out to, and what to call it. */
export interface MealHelping {
  amounts: Partial<Record<NutrientKey, number>>;
  /** Rendered on the entry — "2 servings", "the whole dish", "320 g". */
  servingText: string;
  /**
   * What the helping weighed, for `FoodLogEntry.grams`, or null when nothing
   * says. Known two ways: weighed on the plate, or worked out from a dish
   * whose own weight is recorded.
   */
  grams: number | null;
  /**
   * Whether the count means servings of the dish or whole dishes.
   *
   * The prompt says which, because "2" against a lasagne that states four
   * servings and "2" against one that states none are different meals by a
   * factor of four.
   */
  countsServings: boolean;
}

/**
 * Whether finishing this meal should offer to log it.
 *
 * **Deliberately not `wantsGeneratedTask`**, for the reason `declinedShop`
 * gives about its own tri-state: that helper lets an explicit `true` act with
 * the setting off, which is right for a task somebody asked to be reminded
 * about and wrong for a prompt. Somebody who has switched the prompt off has
 * said they do not want to be asked, and a per-meal `true` set months ago
 * should not talk over that.
 *
 * So the answer only ever subtracts: the setting is the ceiling, and the
 * per-meal value is how one meal opts out from under it.
 */
export function wantsMealLogPrompt(
  entry: Pick<MealPlanEntry, 'logMeal'> | null | undefined,
  enabled: boolean,
): boolean {
  if (!enabled) return false;
  return entry?.logMeal !== false;
}

/**
 * The default number of helpings to offer.
 *
 * One serving when the dish said how many it makes, and one whole dish when it
 * didn't. That is the same nullable-servings hole the rollup already has,
 * answered the same way rather than with a fresh guess: a dish with no servings
 * count has no way to express "a quarter of it", so the honest default is the
 * thing itself and the person corrects it.
 */
export function defaultHelpings(): number {
  return 1;
}

/**
 * What `helpings` of a dish works out to, or null when there is nothing to log.
 *
 * **Null is the ordinary answer for a dish whose figures the rollup refused.**
 * `recipeNutrition` already declines a dish it could not measure enough of, so
 * an offer built on nothing at all is one nobody should be shown: it would ask
 * a question whose only possible answer is an empty record.
 */
export function mealHelping(figures: DishFigures | null, helpings: number): MealHelping | null {
  if (!figures) return null;
  if (!(helpings > 0)) return null;

  const countsServings = figures.perServing !== null;
  const base = figures.perServing ?? figures.total;

  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const amount = base[key];
    if (amount !== undefined) amounts[key] = Math.round(amount * helpings * 10) / 10;
  }
  if (Object.keys(amounts).length === 0) return null;

  return {
    amounts,
    // Counted in the same unit the figures were: a weighed dish knows what one
    // serving of it weighs, so a helping counted in servings still has a
    // weight to record even though nobody put this plate on a scale.
    grams: helpingGrams(figures, helpings, countsServings),
    servingText: describeHelping(helpings, countsServings),
    countsServings,
  };
}

/** What `helpings` of a weighed dish comes to on the scale, or null when it was never weighed. */
function helpingGrams(figures: DishFigures, helpings: number, countsServings: boolean): number | null {
  const unit = countsServings ? servingGrams(figures) : figures.cookedGrams;
  if (unit === null) return null;
  return Math.round(unit * helpings);
}

/**
 * What one serving of the dish weighs, or null while either half is missing.
 *
 * The whole dish over its servings count, which is the only sense in which a
 * serving has ever had a size: nothing else in the app knows what a serving of
 * anything weighs. Shown as a hint beside the servings stepper so the two ways
 * of answering "how much" can be read against each other.
 */
export function servingGrams(figures: DishFigures): number | null {
  if (figures.cookedGrams === null) return null;
  if (!figures.servings || figures.servings <= 0) return null;
  return Math.round(figures.cookedGrams / figures.servings);
}

/**
 * What a weighed plate of the dish works out to.
 *
 * **The accurate answer to "how much did I eat", and the reason
 * `Recipe.cookedWeightG` exists.** The plate over the dish is the fraction of
 * the dish that was eaten, and multiplying the dish's own figures by it needs
 * no servings count, no equal portions and no guess about how big a "serving"
 * was. A recipe that never said how many it serves is logged exactly as
 * accurately as one that did.
 *
 * **It scales the whole dish, never the per-serving figures**, so a scaled
 * cooking is measured against what that cooking actually weighed — see
 * `cookedDishGrams`, which is what puts the scale on `cookedGrams` in the
 * first place.
 *
 * Null on an unweighed dish, a plate weighing nothing, and a plate heavier
 * than the dish it came off — the last one is a typo (3200 for 320) rather
 * than a meal, and inventing a helping ten times the dish out of it is the
 * write-side failure `docs/arch/health-data.md` describes.
 */
export function weighedHelping(
  figures: DishFigures | null,
  platedGrams: number,
): MealHelping | null {
  if (!figures || figures.cookedGrams === null) return null;
  if (!(platedGrams > 0) || platedGrams > figures.cookedGrams) return null;

  const fraction = platedGrams / figures.cookedGrams;
  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const amount = figures.total[key];
    if (amount !== undefined) amounts[key] = Math.round(amount * fraction * 10) / 10;
  }
  if (Object.keys(amounts).length === 0) return null;

  const grams = Math.round(platedGrams);
  return { amounts, grams, servingText: `${grams} g`, countsServings: false };
}

/**
 * What this cooking of the dish weighed, from the recipe's as-written weight.
 *
 * `Recipe.cookedWeightG` is what the recipe makes as written, so a doubled
 * cooking weighs twice that — the same multiplication `recipeNutrition`
 * already applies to the figures this weight is used to divide. Both sides
 * have to move together or a doubled batch logs a plate as half what it was.
 */
export function cookedDishGrams(cookedWeightG: number | null, scale: number): number | null {
  if (cookedWeightG === null || !(cookedWeightG > 0)) return null;
  if (!(scale > 0)) return null;
  return Math.round(cookedWeightG * scale);
}

/** The lightest and heaviest finished dish anyone can record. */
export const COOKED_WEIGHT_MIN_G = 1;
export const COOKED_WEIGHT_MAX_G = 50000;

/**
 * A typed cooked weight, or null when there is no number in it.
 *
 * Clamped rather than validated at the call site, the same call
 * `setLeftoverKeepDays` makes: a restored backup or a hand-edited row can
 * carry anything, and a dish weighing zero would divide a plate by nothing.
 * Rounded to the gram, which is finer than any kitchen scale reads.
 */
export function clampCookedWeight(grams: number | null): number | null {
  if (grams === null || !Number.isFinite(grams) || grams <= 0) return null;
  return Math.min(COOKED_WEIGHT_MAX_G, Math.max(COOKED_WEIGHT_MIN_G, Math.round(grams)));
}

/**
 * The as-written weight to store, given what a scaled cooking weighed.
 *
 * The inverse of `cookedDishGrams`, and it lives here beside it so the two
 * halves of the same conversion can't drift: weighing a doubled batch at
 * 1,450g records 725 on the recipe, and every later cooking multiplies back
 * up by its own scale.
 */
export function asWrittenCookedWeight(weighedGrams: number, scale: number): number | null {
  if (!(scale > 0)) return null;
  return clampCookedWeight(weighedGrams / scale);
}

/**
 * "2 servings", "half the dish", "the whole dish".
 *
 * Named rather than left as a bare number because the number means different
 * things in the two cases, and the entry it ends up on is read back weeks
 * later by somebody who no longer remembers which.
 */
export function describeHelping(helpings: number, countsServings: boolean): string {
  if (countsServings) {
    return helpings === 1 ? '1 serving' : `${trim(helpings)} servings`;
  }
  if (helpings === 1) return 'the whole dish';
  if (helpings === 0.5) return 'half the dish';
  return `${trim(helpings)} of the dish`;
}

/** Drops a trailing `.0` so a whole number reads as one. */
function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
