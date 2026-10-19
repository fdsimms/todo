// Where the cook is in a recipe's method, kept while a cook timer is running.
//
// CookModeSheet resets to the start on every close, because a cooking is one
// sitting and step 6 of yesterday's dish is worse than the start. A running
// cook timer says the sitting is still going, so closing the sheet (or coming
// back from a Live Activity tap) must not throw the place away. Held in memory
// only: an app restart is a new sitting as far as this is concerned.

export interface CookPosition {
  /** -1 is the mise en place screen, 0.. a step. */
  rawIndex: number;
  /** Past the last step, on the end screen. */
  finished: boolean;
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
): CookPosition {
  const saved = cookRunning ? savedCookPosition(recipeId) : null;
  return saved ?? { rawIndex: hasIngredients ? -1 : 0, finished: false };
}
