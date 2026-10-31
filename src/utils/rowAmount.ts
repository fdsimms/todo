import { formatScale, scaleQuantity } from './recipeScale';

/**
 * How much of one line to add from a recipe ("we already have half a block of
 * tofu"). A factor on top of whatever the sheet's whole-recipe scale already
 * made of the line, applied only to what is written to the list: the recipe
 * itself is never touched.
 *
 * The amount is worked out by `scaleQuantity`, which refuses a shape it can't
 * scale whole ("a pinch", "2 cups plus 2 tbsp", one 14 oz can halved). A
 * refusal is surfaced as `null`, never as the unchanged line, so the sheet
 * can withhold the choice rather than say "half" and add all of it.
 */

/** The shortcuts the amount card offers, in the order it shows them. */
export const ROW_AMOUNT_PRESETS = [1, 0.5, 0.25] as const;

/** The largest typed factor. Past this the recipe's own scale chips are the tool. */
export const MAX_ROW_FACTOR = 10;

/** `quantity` at `factor`, or null when that amount can't be worked out. */
export function adjustedQuantity(quantity: string, factor: number): string | null {
  if (factor === 1) return quantity;
  const scaled = scaleQuantity(quantity, factor);
  return scaled.scaled ? scaled.text : null;
}

/** Whether the line has an amount that can be reduced at all. */
export function canAdjustAmount(quantity: string | null | undefined): boolean {
  if (!quantity) return false;
  return adjustedQuantity(quantity, 0.5) !== null;
}

/**
 * A typed factor: "3/4", "0.75", "1 1/2" or "2". Null for anything that isn't
 * a positive number up to `MAX_ROW_FACTOR`, so the field can say so.
 */
export function parseRowFactor(input: string): number | null {
  const text = input.trim().replace(/×$/, '').trim();
  if (!text) return null;
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(text);
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  const decimal = /^\d*\.?\d+$/.exec(text);
  let value: number;
  if (mixed) {
    if (Number(mixed[3]) === 0) return null;
    value = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  } else if (fraction) {
    if (Number(fraction[2]) === 0) return null;
    value = Number(fraction[1]) / Number(fraction[2]);
  } else if (decimal) {
    value = Number(text);
  } else {
    return null;
  }
  if (!Number.isFinite(value) || value <= 0 || value > MAX_ROW_FACTOR) return null;
  return value;
}

/** The note under an adjusted row: what was done to the recipe's amount. */
export function describeRowFactor(factor: number): string {
  if (factor === 0.5) return 'Adding half the amount';
  if (factor === 0.25) return 'Adding a quarter of the amount';
  return `Adding ${formatScale(factor)} the amount`;
}
