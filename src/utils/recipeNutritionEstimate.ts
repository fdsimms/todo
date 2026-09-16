import type { NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';

/**
 * A model's estimate of what a whole recipe contains, read from its own
 * ingredient list rather than measured.
 *
 * **The fallback for the case `recipeNutrition.ts` correctly refuses.** That
 * module sums real catalog figures and stops rather than guess at a nutrient
 * too few lines report — which is right, but leaves a recipe with several
 * unlinked or unfigured ingredients with nothing at all. This is the other
 * honest answer to that gap: a model's own read of the ingredient list,
 * offered only once the real rollup has come back with too little to total
 * (`RecipeNutritionSheet` gates on `!nutrition`), never in place of a total
 * that already has real figures behind it.
 *
 * **It is a proposal, not a write.** Unlike `nutritionEstimate.ts`'s meal
 * estimate, there is nothing here to confirm into: a recipe carries no stored
 * nutrition panel of its own (`recipeNutrition.ts`'s own note — "computed at
 * read time... a stored total goes stale the moment an ingredient is
 * edited"), and this estimate is exactly as perishable. So it lives only in
 * the sheet's own state, recomputed on request, never written to the recipe,
 * the catalog, or anywhere else. Asking again after editing the recipe is the
 * only way to keep it current, which is the same trade a stored one would
 * have forced onto every other reader instead.
 *
 * **No basis, no attribution.** `NutritionEstimate` (a restaurant meal) draws
 * a real distinction between a chain's published figures and the model's own
 * guess. A home recipe has no menu to publish for the *specific ingredients
 * it was actually made from*, so the estimate is always the model's own
 * reasoning — `confidence` is the only claim it gets to make about itself.
 *
 * **No per-ingredient breakdown.** The meal estimate's `breakdown` exists so
 * a whole-meal number can be checked against something smaller; this sheet
 * already has that in the COUNTED/NOT COUNTED sections built from the real
 * ingredient list, so a second, AI-guessed breakdown of the same lines would
 * be a line someone could second-guess against a number that was never
 * asking to be trusted more than the total already is.
 */

/** How sure the model is, which is its own to state rather than ours to infer. */
export type RecipeEstimateConfidence = 'high' | 'medium' | 'low';

/** A proposal, not a stored total. Nothing is written anywhere until this is read. */
export interface RecipeNutritionEstimate {
  /** For the whole recipe, at whatever scale it was asked about. */
  amounts: Partial<Record<NutrientKey, number>>;
  confidence: RecipeEstimateConfidence;
}

/** The reply shape, before any of it is believed. */
export interface RawRecipeNutritionEstimate {
  amounts?: unknown;
  confidence?: unknown;
}

/**
 * A stated figure, or absent.
 *
 * Same rule `nutritionEstimate.ts`'s own `amount()` states: absent stays
 * absent and never becomes zero, and a figure that can't be true (negative,
 * non-finite) is dropped rather than clamped.
 */
function amount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 10) / 10;
}

/**
 * What a reply actually carries, or null when it carries nothing usable.
 *
 * Refuses rather than repairs — an estimate with no figures at all is not a
 * smaller estimate, it is a failed read, and the caller shows that plainly
 * rather than a total that came back empty.
 *
 * `confidence` falls back to the weakest reading when omitted or invented,
 * the same direction `nutritionEstimate.ts` defaults in and for the same
 * reason: understating how sure the model is can only make the estimate read
 * as more tentative than it should, never as more confident than it is.
 */
export function readRecipeNutritionEstimate(
  raw: RawRecipeNutritionEstimate | null | undefined,
): RecipeNutritionEstimate | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = (raw.amounts ?? {}) as Record<string, unknown>;
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;

  const amounts: Partial<Record<NutrientKey, number>> = {};
  for (const key of NUTRIENT_KEYS) {
    const value = amount(source[key]);
    if (value !== undefined) amounts[key] = value;
  }
  if (Object.keys(amounts).length === 0) return null;

  return {
    amounts,
    confidence: raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low',
  };
}

/**
 * What the estimate claims, in one flat sentence.
 *
 * Same two rules `describeEstimate` states for the meal version: a
 * description, never advice or a comment on the dish, and the weaker claim
 * said out loud rather than smoothed over.
 */
export function describeRecipeNutritionEstimate(estimate: RecipeNutritionEstimate): string {
  const sure = estimate.confidence === 'high'
    ? ''
    : estimate.confidence === 'medium'
      ? ' Close, not exact.'
      : ' A rough guess.';
  return `Read from the ingredient list, not measured.${sure}`;
}
