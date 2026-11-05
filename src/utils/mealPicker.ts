import type { Recipe, SavedMeal } from '../types';
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

/** How many saved meals the picker lists before anything is typed. */
export const SAVED_MEALS_BROWSE_LIMIT = 5;

/**
 * The saved meals the plan sheet offers. With nothing typed, the first few in
 * the saved-meals order; once something is typed, every saved meal whose name
 * contains it. A plain substring, like the fridge's match: a handful of rows
 * the person named themselves has nothing for a ranker to sort out.
 */
export function pickerSavedMeals(meals: readonly SavedMeal[], query: string): SavedMeal[] {
  const q = query.trim().toLowerCase();
  if (!q) return meals.slice(0, SAVED_MEALS_BROWSE_LIMIT);
  return meals.filter(m => m.name.toLowerCase().includes(q));
}
