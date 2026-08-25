import {
  formatQuantityAmount,
  formatRational,
  inflectUnit,
  multiplyRational,
  parseQuantity,
  rationalFromNumber,
  rationalToNumber,
} from './quantity';

/**
 * Halving and doubling a recipe — the one place in this app that does
 * arithmetic on a `quantity`.
 *
 * Everything else deliberately refuses to (see the header of
 * mealPlanGroceries.ts, and RecipeIngredient.quantity), because `quantity` is
 * free text and a wrong guess about what the words mean silently changes what
 * the user buys. That refusal still stands as the *default*: this module is
 * narrow on purpose and is only ever reached through an explicit scale factor
 * the user picked.
 *
 * What makes it safe is the same discipline groceryParse's LEADING_QTY uses —
 * a whitelist and a closed shape, never an interpretation of the words:
 *
 * 1. Only the **leading amount** is ever touched. Everything after it (unit,
 *    size clause, container word) is carried through verbatim, apart from
 *    pluralising a unit off a closed table.
 * 2. **No unit conversion, ever.** "500 g" doubled is "1000 g", not "1 kg".
 *    Converting means knowing that g and kg measure the same thing, which is
 *    exactly the knowledge this app doesn't claim to have — and "1000 g" is
 *    never *wrong*, only unidiomatic.
 * 3. A quantity whose amount doesn't parse is returned **verbatim and flagged**
 *    (`scaled: false`), never guessed at. "a pinch" doubled is "a pinch"; the
 *    UI says so rather than inventing "2 pinches", and the cook decides.
 * 4. Arithmetic is **exact rational**, not floating point, so a third of a cup
 *    halved is "1/6 cup" rather than "0.17 cup" — and 1/3 tripled is exactly
 *    "1", which a decimal round-trip would render as "0.99".
 *
 * Rule 3 is the important one. A scaler that covers 95% of lines and admits
 * the other 5% is useful; one that covers 100% by guessing at "a knob of
 * butter" is a liability.
 *
 * Rules 1, 3 and 4 are all `quantity.ts`'s now — the leading amount, the
 * refusals and the rationals are one value type shared with every other reader
 * of a quantity string. What's left here is the multiplication and the shapes
 * it renders back, which is all this module ever really was.
 */

// ---------------------------------------------------------------------------
// Scaling
// ---------------------------------------------------------------------------

export interface ScaledQuantity {
  /** What to render. Equal to the input, trimmed, whenever `scaled` is false. */
  text: string;
  /**
   * False when the quantity was carried through untouched because its amount
   * couldn't be parsed — the signal the UI needs to tell the cook which lines
   * it didn't do the arithmetic for. See describeUnscaled.
   */
  scaled: boolean;
}

/**
 * `quantity` multiplied by `factor` — "2 cups" doubled is "4 cups", halved is
 * "1 cup".
 *
 * The cases, in the order they're tried:
 *
 * - **`x2`** — parseGroceryInput's trailing-count notation, scaled as the
 *   count it is. It's the one shape whose amount `parseQuantity` deliberately
 *   leaves null (see `Quantity.countNotation`), because scaling is the only
 *   reader with a use for it.
 * - **A sized container with no count** ("14 oz can", from "14-ounce can
 *   broth") — the leading number is the can's *size*, not how many cans, so
 *   scaling it would turn two cans of broth into one 28 oz can. Doubling emits
 *   a count instead ("2 14 oz cans"); a fractional factor can't be expressed
 *   this way at all and refuses.
 * - **A counted sized container** ("2 14 oz cans") — the count scales, the size
 *   never does.
 * - **A range** ("1 to 2 tbsp", "1-2 tbsp") — both ends scale by the same
 *   factor and the unit agrees with the scaled high end, so "1 to 2 tbsp"
 *   halved is "1/2 to 1 tbsp", not the low end alone with the high end
 *   carried through unchanged.
 * - **Anything opening with an amount** — the amount scales and the first
 *   following word, if it's a known unit, agrees with the result.
 * - **Anything else** ("a pinch", "to taste", "dozen") — verbatim, flagged.
 *
 * A factor of exactly 1 is a no-op that reports `scaled: false`, so an
 * unscaled read is indistinguishable from one that never asked to be scaled —
 * which is what lets every caller pass a factor unconditionally.
 */
export function scaleQuantity(quantity: string, factor: number): ScaledQuantity {
  const q = parseQuantity(quantity);
  const unchanged: ScaledQuantity = { text: q.raw, scaled: false };
  if (!q.raw) return unchanged;
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return unchanged;

  const multiplier = rationalFromNumber(factor);

  if (q.countNotation) {
    const scaled = multiplyRational(q.countNotation, multiplier);
    return { text: `x${formatRational(scaled, false)}`, scaled: true };
  }

  if (q.amount === null) return unchanged;

  if (q.container) {
    const { count, sizeText, sizeUnit, word } = q.container;
    if (count) {
      const scaled = multiplyRational(count, multiplier);
      const container = inflectUnit(word, rationalToNumber(scaled));
      return {
        text: `${formatRational(scaled, q.decimal)} ${sizeText} ${sizeUnit} ${container}`,
        scaled: true,
      };
    }
    // The factor *is* the new count: one 14 oz can, doubled, is two of them.
    if (!Number.isInteger(factor)) return unchanged;
    return {
      text: `${factor} ${sizeText} ${sizeUnit} ${inflectUnit(word, factor)}`,
      scaled: true,
    };
  }

  if (q.rangeMax) {
    const scaledMin = multiplyRational(q.amount, multiplier);
    const scaledMax = multiplyRational(q.rangeMax, multiplier);
    const renderedMin = formatRational(scaledMin, q.decimal);
    const renderedMax = formatRational(scaledMax, q.decimal);
    const joined =
      q.rangeSeparator === '-' ? `${renderedMin}-${renderedMax}` : `${renderedMin} to ${renderedMax}`;
    if (!q.unitWritten) return { text: `${joined}${q.trailing}`, scaled: true };
    const inflected = inflectUnit(q.unitWritten, rationalToNumber(scaledMax));
    return { text: `${joined} ${inflected}${q.trailing}`, scaled: true };
  }

  const scaled = multiplyRational(q.amount, multiplier);
  const rendered = formatRational(scaled, q.decimal);
  if (!q.rest) return { text: rendered, scaled: true };

  // A size clause rather than a unit — parseGroceryInput emits "1, medium",
  // and splitting that on spaces would produce "2 , medium".
  if (!q.unitWritten) return { text: `${rendered}${q.trailing}`, scaled: true };

  const inflected = inflectUnit(q.unitWritten, rationalToNumber(scaled));
  return { text: `${rendered} ${inflected}${q.trailing}`, scaled: true };
}

// ---------------------------------------------------------------------------
// The factors themselves
// ---------------------------------------------------------------------------

/**
 * The factors the pickers offer. Halves and small whole multiples, which is
 * what a cook actually reaches for — and deliberately not derived from a
 * target servings count, because `Recipe.servings` is nullable and plenty of
 * recipes never had one, so a "cook for 6" stepper would be unavailable
 * exactly where a factor still makes perfect sense. Scaled servings are shown
 * *alongside* the factor when the recipe happens to know them (see
 * scaleServings).
 */
export const RECIPE_SCALE_FACTORS = [0.5, 1, 1.5, 2, 3] as const;

/** True for the do-nothing factor, including the `null`/legacy absence of one. */
export function isUnscaled(factor: number | null | undefined): boolean {
  return factor == null || factor === 1;
}

/**
 * A stored factor clamped to something usable — 1 for anything absent, zero,
 * negative or not a number, so a hand-edited database row or a restored backup
 * can't make a recipe render with no quantities.
 */
export function normalizeScale(factor: number | null | undefined): number {
  if (factor == null || !Number.isFinite(factor) || factor <= 0) return 1;
  return factor;
}

/**
 * "½×", "1½×", "2×" — the chip label and the badge on a scaled meal.
 *
 * Built on `formatQuantityAmount` rather than its own rounding, because a
 * factor typed as a target servings count ("makes 8, I need 3") is rarely one
 * of the presets — 3/8 is a real factor this app now produces, not just
 * 0.5/1.5/2/3 — and it deserves the same exact-fraction treatment a quantity
 * gets rather than degrading to "0.38×". The ½ glyph is kept as a special case
 * purely to match the chip glyphs the presets already render.
 */
export function formatScale(factor: number): string {
  const normalized = normalizeScale(factor);
  if (Number.isInteger(normalized)) return `${normalized}×`;
  const rendered = formatQuantityAmount(normalized);
  const half = /^(\d*)\s*1\/2$/.exec(rendered);
  if (half) return `${half[1]}½×`;
  return `${rendered}×`;
}

/**
 * A recipe's servings under a scale factor, rounded to whole people — nobody
 * cooks for 7.5. Returns nulls untouched, so a recipe that never said how many
 * it serves still doesn't claim to know.
 */
export function scaleServings(
  servings: number | null,
  servingsMax: number | null,
  factor: number,
): { servings: number | null; servingsMax: number | null } {
  const normalized = normalizeScale(factor);
  if (servings == null) return { servings: null, servingsMax: null };
  const scale = (value: number) => Math.max(1, Math.round(value * normalized));
  return {
    servings: scale(servings),
    servingsMax: servingsMax == null ? null : scale(servingsMax),
  };
}

/**
 * The other direction: "this recipe makes `baseServings`, I need `target`" as
 * a scale factor — what the servings stepper in RecipeScaleChips computes on
 * every keystroke, so typing 3 against an 8-serving recipe drives the exact
 * same `recipeScale`/`quantity` machinery a chip tap does. `baseServings` of
 * zero or less has no ratio to compute; it returns 1 (as-written) rather than
 * dividing by it, though the stepper never renders without a positive one.
 */
export function factorForServings(target: number, baseServings: number): number {
  if (!Number.isFinite(target) || target <= 0) return 1;
  if (!Number.isFinite(baseServings) || baseServings <= 0) return 1;
  return target / baseServings;
}

/**
 * The servings a live factor currently implies, for seeding the stepper —
 * after a chip tap as much as after typing a number. Delegates to
 * `scaleServings` rather than re-deriving the round-to-a-whole-person-and-
 * floor-at-one rule a second time.
 */
export function targetServingsFor(baseServings: number, factor: number): number {
  return scaleServings(baseServings, null, factor).servings ?? Math.max(1, Math.round(baseServings));
}

/**
 * "2 lines couldn't be scaled — check them" — the footnote a scaled ingredient
 * list needs, since rule 3 means some lines are passing through untouched and
 * a cook reading "a pinch" on a doubled recipe deserves to be told the app
 * didn't do that arithmetic rather than left it deliberately.
 *
 * Null at a factor of 1 (nothing was scaled, so nothing is unscaled) and when
 * every line scaled cleanly.
 */
export function describeUnscaled(count: number, factor: number): string | null {
  if (isUnscaled(factor) || count <= 0) return null;
  const lines = count === 1 ? '1 ingredient' : `${count} ingredients`;
  return `${lines} couldn't be scaled automatically. Adjust by eye`;
}
