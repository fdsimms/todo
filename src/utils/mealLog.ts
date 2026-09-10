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
}

/** What one helping works out to, and what to call it. */
export interface MealHelping {
  amounts: Partial<Record<NutrientKey, number>>;
  /** Rendered on the entry — "2 servings", "the whole dish". */
  servingText: string;
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

  return { amounts, servingText: describeHelping(helpings, countsServings), countsServings };
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
