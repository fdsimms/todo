import type { FoodNutrition } from '../types';
import { parseQuantity } from './quantity';
import { measureParsedQuantity } from './unitConvert';

/**
 * How much of a scanned package was eaten.
 *
 * **The one genuinely new question a logging scan asks.** Shopping and pantry
 * scans are done once a barcode resolves: the thing is on a list or in a
 * cupboard. Logging needs an amount, and a label panel gives exactly two
 * answers worth offering without typing: one serving, and the whole package.
 * `servingText` and `servingGrams` are the inputs for the first, which is why
 * the nutrient record insists on storing both.
 *
 * **The whole-package option is offered only when it can be worked out**, and
 * withheld otherwise rather than guessed. It needs the pack size to parse as a
 * mass or a volume *and* a serving weight to divide by; a packet whose size
 * the source never stated has no number of servings, and inventing one would
 * multiply a real per-serving figure by a made-up count. That is the same
 * refusal `scalePanelToAmount` makes about an amount it cannot measure.
 *
 * Everything here is pure and reaches no store, so the arithmetic that decides
 * what somebody's calorie count is can be exercised without a database.
 */

/** One offered amount, and what it multiplies the panel's own serving by. */
export interface PackageChoice {
  key: 'serving' | 'package';
  /** What the button says — "1 serving (45g)", "The whole package (11 servings)". */
  label: string;
  /** How many of the panel's servings this is. */
  servings: number;
}

/**
 * How many servings a package holds, or null when that cannot be worked out.
 *
 * Both halves are required and neither is guessable: the pack size as the
 * source printed it ("500 g", "1 L"), and what one serving weighs. A per-100g
 * panel with no serving weight has no serving to count, and a pack size in
 * pieces ("6 bars") is not a mass this can divide.
 *
 * Refuses a package that works out to less than one serving as well. That is
 * either a pack size the source got wrong or a unit mismatch, and either way
 * the honest answer is to let the person type the amount.
 */
export function servingsPerPackage(
  nutrition: FoodNutrition,
  packSize: string | null,
): number | null {
  if (!packSize?.trim()) return null;
  const grams = nutrition.servingGrams;
  if (grams === null || !(grams > 0)) return null;

  const measured = measureParsedQuantity(parseQuantity(packSize));
  // A volume is accepted against a per-100ml panel only, for the reason
  // `panelMultiplier` gives: turning millilitres into grams needs a density
  // this app deliberately has not got.
  if (!measured) return null;
  if (measured.dimension === 'mass' && nutrition.basis === 'per100ml') return null;
  if (measured.dimension === 'volume' && nutrition.basis !== 'per100ml') return null;

  const servings = measured.base / grams;
  if (!Number.isFinite(servings) || servings < 1) return null;
  return Math.round(servings * 10) / 10;
}

/**
 * The amounts worth offering as a tap, for a scanned package.
 *
 * Empty when the panel states no serving at all, which is a real case: a
 * per-100g panel with no serving weight can still be logged, but only by
 * typing an amount, and offering "1 serving" for it would be inventing the
 * serving.
 */
export function packageChoices(
  nutrition: FoodNutrition,
  packSize: string | null,
): PackageChoice[] {
  const out: PackageChoice[] = [];
  const grams = nutrition.servingGrams;
  const servingLabel = nutrition.servingText?.trim();

  if (nutrition.basis === 'perServing' || grams !== null) {
    out.push({
      key: 'serving',
      // The packet's own words when it gave any, since that is what the person
      // is holding and can check against. "1 serving" only as the fallback.
      label: servingLabel ? `1 serving (${servingLabel})` : '1 serving',
      servings: 1,
    });
  }

  const perPack = servingsPerPackage(nutrition, packSize);
  if (perPack !== null && perPack > 1) {
    out.push({
      key: 'package',
      label: `The whole package (${trim(perPack)} servings)`,
      servings: perPack,
    });
  }
  return out;
}

/**
 * What `servings` of a package works out to, as a panel of its own.
 *
 * The basis becomes `perServing` and the figures are the amounts actually
 * eaten, matching what `scalePanelToAmount` produces for a catalog food: an
 * entry records one helping rather than a food, so the scaling has happened by
 * the time anything reads it back.
 *
 * **The source is carried through unchanged**, because who declared the
 * underlying figures is exactly as true of the helping as of the packet. A
 * manufacturer's label scaled to two servings is still a manufacturer's label.
 */
export function packageHelping(
  nutrition: FoodNutrition,
  servings: number,
  label: string,
  now: Date = new Date(),
): FoodNutrition | null {
  if (!(servings > 0)) return null;
  // A per-100g panel is scaled through its own serving weight, so a helping
  // means the same thing whichever basis the source used.
  const perServing = nutrition.basis === 'perServing'
    ? 1
    : nutrition.servingGrams !== null && nutrition.servingGrams > 0
      ? nutrition.servingGrams / 100
      : null;
  if (perServing === null) return null;

  const amounts: FoodNutrition['amounts'] = {};
  for (const [key, amount] of Object.entries(nutrition.amounts)) {
    if (amount === undefined) continue;
    amounts[key as keyof typeof amounts] = round(amount * perServing * servings);
  }
  if (Object.keys(amounts).length === 0) return null;

  return {
    basis: 'perServing',
    servingGrams: nutrition.servingGrams === null ? null : round(nutrition.servingGrams * servings),
    servingText: label,
    amounts,
    source: nutrition.source,
    sourceId: nutrition.sourceId,
    // Dropped for `scalePanelToAmount`'s reason: a portion table describes the
    // food, and this describes a helping already measured out of it.
    portions: [],
    recordedAt: now.toISOString(),
  };
}

function round(amount: number): number {
  return Math.round(amount * 10) / 10;
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}
