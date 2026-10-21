import type { Recipe } from '../types';
import { sortRecipesForDisplay } from './recipeUtils';

/** How long a loved recipe goes uncooked before the picker brings it up again. */
export const LOVED_RESTING_DAYS = 21;
/** How many of those it brings up at once. */
const LOVED_RESTING_LIMIT = 5;

export interface MealPickerShelves {
  /** Bookmarked to cook next, in the order the person put them. */
  upNext: Recipe[];
  /** Loved and not cooked in three weeks, longest-rested first. */
  lovedResting: Recipe[];
  /** Everything else, in the recipe box's own order, up to what's left of `limit`. */
  rest: Recipe[];
  /** The whole recipe box, for saying how much of it is shown. */
  total: number;
}

/**
 * What the meal picker shows before anything is typed. It used to be the
 * first thirty recipes in box order, which never surfaced a dish bookmarked
 * for next or a favorite that had gone quiet, and gave no sign there were
 * more. A recipe sits on one shelf only.
 */
export function mealPickerShelves(recipes: readonly Recipe[], now: Date, limit: number): MealPickerShelves {
  const upNext = recipes.filter(r => r.upNext).sort((a, b) => a.upNextOrder - b.upNextOrder);
  const cutoff = now.getTime() - LOVED_RESTING_DAYS * 24 * 60 * 60 * 1000;
  const cookedAt = (r: Recipe) => (r.lastCookedAt ? Date.parse(r.lastCookedAt) : 0);
  const lovedResting = recipes
    .filter(r => !r.upNext && r.vote === 'loved' && cookedAt(r) < cutoff)
    .sort((a, b) => cookedAt(a) - cookedAt(b))
    .slice(0, LOVED_RESTING_LIMIT);
  const shelved = new Set([...upNext, ...lovedResting].map(r => r.id));
  const rest = sortRecipesForDisplay(recipes)
    .filter(r => !shelved.has(r.id))
    .slice(0, Math.max(0, limit - shelved.size));
  return { upNext, lovedResting, rest, total: recipes.length };
}
