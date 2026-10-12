import type { RecipeNutritionEstimate } from './recipeNutritionEstimate';

/**
 * A recipe's nutrition estimate asked for with no connection, kept until one
 * can be made.
 *
 * `recipeNutritionEstimate.ts` documents the estimate as display-only and never
 * stored, because it is exactly as perishable as the ingredient list it was
 * read from. **Keeping a result for later is the one place that rule bends, and
 * the bend is bounded by the sheet's own `estimateKey`**: the fingerprint of the
 * name, the servings and every ingredient line the estimate was asked about. A
 * row is shown only while its key equals the key of what is on screen
 * (`liveFor`), so a recipe edited, a line filled in or the scale changed makes
 * it invisible rather than quoting a dish that no longer exists. It is still
 * never written to the recipe, the catalog or anywhere a total is read from;
 * it is a cache that the sheet declines to believe.
 *
 * One row per recipe, replaced by a newer ask for the same recipe. A row whose
 * key does not match is not deleted when the page is only scaled: scaling back
 * makes it valid again, and only a newer ask or a person removes one.
 *
 * What a person sees of it lives in `RecipeNutritionSheet`: there is no list
 * of these anywhere, because unlike a meal there is nothing to confirm into
 * the log, so no surface that needs one.
 */

export type PendingRecipeEstimateStatus = 'waiting' | 'ready' | 'failed';

export interface PendingRecipeEstimate {
  /** The recipe it was asked about, and the row's identity: one per recipe. */
  recipeId: string;
  /** The sheet's `estimateKey` at the time of the ask. */
  estimateKey: string;
  /** What `estimateRecipeNutrition` is called with. */
  title: string;
  servings: number | null;
  lines: string[];
  status: PendingRecipeEstimateStatus;
  /** Set once `status` is `ready`. */
  estimate: RecipeNutritionEstimate | null;
  /** Set when `status` is `failed`: what to tell the person. */
  error: string | null;
  createdAt: string;
}

/**
 * The queued row that speaks for what is on screen, or null.
 *
 * The only reader the sheet uses, so the key comparison cannot be forgotten at
 * a call site: a row for the same recipe under another key is not "the"
 * estimate for this reading.
 */
export function liveFor(
  pending: readonly PendingRecipeEstimate[],
  recipeId: string,
  estimateKey: string,
): PendingRecipeEstimate | null {
  const row = pending.find(p => p.recipeId === recipeId);
  return row && row.estimateKey === estimateKey ? row : null;
}

/** The ones a drain should ask the API about. A `failed` one is retried by hand. */
export function awaitingRecipeEstimate(pending: readonly PendingRecipeEstimate[]): PendingRecipeEstimate[] {
  return pending
    .filter(p => p.status === 'waiting')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
