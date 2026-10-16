import { COOKED_WEIGHT_MAX_G } from './mealLog';

/**
 * Pots, pans, lids and tubs, kept so a dish can be weighed with its pot.
 *
 * The scale reads the pot and the food together, and a hot pot is the part
 * nobody wants to handle, so the app holds each piece's empty weight and takes
 * it off. Only the number typed changes: `Recipe.cookedWeightG` and
 * `Leftover.weightG` still hold the food alone, and nothing remembers which pot
 * a dish was weighed in, so deleting or reweighing a pot rewrites no history.
 */

/** Heavier than any kitchen scale reads and any pot a person owns. */
export const COOKWARE_MAX_G = COOKED_WEIGHT_MAX_G;

/**
 * A pot's empty weight, whole grams, or null when it isn't a weight at all.
 * Zero is refused because a pot that weighs nothing subtracts nothing, which is
 * what "No pot" is for.
 */
export function clampCookwareWeight(grams: number | null): number | null {
  if (grams === null || !Number.isFinite(grams) || grams <= 0) return null;
  return Math.min(COOKWARE_MAX_G, Math.round(grams));
}

/** What a typed weight field holds, as a number. Accepts a decimal comma. */
export function parseWeightText(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export type NetWeight =
  | { ok: true; grams: number }
  | { ok: false; reason: string };

/**
 * The food's weight, given what the scale read and the pieces on it.
 *
 * A reading at or under the pieces' own weight is refused with the reason
 * rather than clamped to something small: it means the wrong pot is picked or
 * the pot was weighed empty, and a dish of 1 g would pass every later check.
 * With nothing picked it passes the reading through unchanged, which is how
 * the field behaved before cookware existed.
 */
export function netWeight(scaleGrams: number, tares: readonly number[]): NetWeight {
  const tare = tares.reduce((sum, g) => sum + g, 0);
  const net = scaleGrams - tare;
  if (!(net > 0)) {
    return {
      ok: false,
      reason: `That is lighter than the ${tare.toLocaleString('en-US')} g it sits in. Check which pot is picked.`,
    };
  }
  return { ok: true, grams: Math.round(net) };
}
