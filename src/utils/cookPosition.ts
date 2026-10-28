// Where the cook is in a recipe's method, kept while a cook timer is running.
//
// CookModeSheet resets to the start on every close, because a cooking is one
// sitting and step 6 of yesterday's dish is worse than the start. A running
// cook timer says the sitting is still going, so closing the sheet (or coming
// back from a Live Activity tap) must not throw the place away. Held in memory
// only: an app restart is a new sitting as far as this is concerned.

import type { RecipeOverride } from '../types';

export interface CookPosition {
  /** -1 is the mise en place screen, 0.. a step. */
  rawIndex: number;
  /** Past the last step, on the end screen. */
  finished: boolean;
  /**
   * The step `rawIndex` was on, when it was on one. Restored by id when the
   * step is still there, so a step added or removed above it while the sheet
   * was closed doesn't hand the cook the step next to theirs.
   */
  stepId?: string;
}

const positions = new Map<string, CookPosition>();

export function saveCookPosition(recipeId: string, position: CookPosition): void {
  positions.set(recipeId, { ...position });
}

export function savedCookPosition(recipeId: string): CookPosition | null {
  const saved = positions.get(recipeId);
  return saved ? { ...saved } : null;
}

export function clearCookPosition(recipeId: string): void {
  positions.delete(recipeId);
  setups.delete(recipeId);
}

/**
 * What the cooking is for: the factor and the either/or picks. Screen state on
 * RecipeDetailScreen, and re-entering through CookingBar navigates with fresh
 * route params that carry none of it, so the screen reseeds to 1x. Kept here
 * for the same reason the position is, and restored only on that re-entry.
 */
export interface CookSetup {
  scale: number;
  choices: string[];
  overrides: RecipeOverride[];
}

const setups = new Map<string, CookSetup>();

export function saveCookSetup(recipeId: string, setup: CookSetup): void {
  setups.set(recipeId, { scale: setup.scale, choices: [...setup.choices], overrides: [...setup.overrides] });
}

export function savedCookSetup(recipeId: string): CookSetup | null {
  return setups.get(recipeId) ?? null;
}

/**
 * The position a sheet should rest at while closed: the saved one when the
 * cook timer is running, otherwise the start (mise en place where there is
 * something to gather, step 1 where there isn't).
 */
export function restingCookPosition(
  recipeId: string,
  cookRunning: boolean,
  hasIngredients: boolean,
  /** The method's step ids as they are now, to find a saved step by. */
  stepIds: readonly string[] = [],
): CookPosition {
  const saved = cookRunning ? savedCookPosition(recipeId) : null;
  if (!saved) return { rawIndex: hasIngredients ? -1 : 0, finished: false };
  const at = saved.stepId ? stepIds.indexOf(saved.stepId) : -1;
  return at >= 0 ? { ...saved, rawIndex: at } : saved;
}
