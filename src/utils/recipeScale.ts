import { CONTAINER_UNITS, SIZE_UNITS } from './groceryParse';

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
 */

// ---------------------------------------------------------------------------
// Exact rationals
// ---------------------------------------------------------------------------

/** A non-negative exact rational. `den` is always > 0 and the pair is reduced. */
interface Rational {
  num: number;
  den: number;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function rational(num: number, den: number): Rational {
  const divisor = gcd(Math.abs(num), Math.abs(den)) || 1;
  return { num: num / divisor, den: den / divisor };
}

function multiply(a: Rational, b: Rational): Rational {
  return rational(a.num * b.num, a.den * b.den);
}

function toNumber(r: Rational): number {
  return r.num / r.den;
}

/**
 * A scale factor as an exact rational. The factors the UI offers are all
 * halves and thirds, and a servings-derived one ("4 servings → 6") is a ratio
 * of two integers, so a denominator search bounded at 1000 is exact for every
 * factor this app can produce and falls back to a plain approximation rather
 * than throwing for anything stranger.
 */
function factorToRational(factor: number): Rational {
  if (Number.isInteger(factor)) return { num: factor, den: 1 };
  for (let den = 2; den <= 1000; den++) {
    const num = factor * den;
    if (Math.abs(num - Math.round(num)) < 1e-9) return rational(Math.round(num), den);
  }
  return rational(Math.round(factor * 1000), 1000);
}

// The denominators a cook writes. 6 and 16 are in because they're what halving
// a third and an eighth produce — without them "1/3 cup" halved would fall
// back to a decimal, which is the one place a fraction really is clearer.
const DENOMINATORS = [2, 3, 4, 6, 8, 16];

/**
 * A rational as the text a recipe would be written with: "3", "1/2",
 * "1 1/2" — ASCII rather than "½", matching what parseGroceryInput already
 * produces and stores.
 *
 * `preferDecimal` keeps a quantity in the notation it arrived in: "1.5 kg"
 * doubled reads "3 kg" and halved "0.75 kg", because someone writing decimals
 * doesn't want fractions handed back. A rational that lands on no cooking
 * denominator falls back to a 2-place decimal for the same reason rule 3
 * exists — an honest approximation beats "17/50 cup".
 */
function formatRational(value: Rational, preferDecimal: boolean): string {
  const n = toNumber(value);
  if (value.den === 1) return String(value.num);
  if (preferDecimal) return String(Math.round(n * 100) / 100);

  const whole = Math.floor(n);
  const remainder = n - whole;
  for (const den of DENOMINATORS) {
    const num = remainder * den;
    if (Math.abs(num - Math.round(num)) < 1e-9) {
      const fraction = `${Math.round(num)}/${den}`;
      return whole ? `${whole} ${fraction}` : fraction;
    }
  }
  return String(Math.round(n * 100) / 100);
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/**
 * Singular → plural for every unit in groceryParse's UNITS whitelist that
 * inflects at all. A table rather than a rule because English pluralisation
 * isn't one ("loaf" → "loaves", "bunch" → "bunches"), and because a naive `+s`
 * on an *unknown* word is precisely the guess this module refuses to make: a
 * unit that isn't here is passed through untouched, so "1 bulb" doubles to
 * "2 bulb". Slightly wrong grammar, visibly the user's own word, and nothing
 * about what they buy has changed — the trade groceryParse's unit whitelist
 * already makes for the same reason.
 *
 * Units that never inflect (oz, kg, g, ml, l, tbsp, tsp, qt, pt, gal, dozen)
 * are simply absent.
 */
const UNIT_PLURALS: Record<string, string> = {
  lb: 'lbs',
  pound: 'pounds',
  ounce: 'ounces',
  gram: 'grams',
  liter: 'liters',
  litre: 'litres',
  gallon: 'gallons',
  quart: 'quarts',
  pint: 'pints',
  cup: 'cups',
  tablespoon: 'tablespoons',
  teaspoon: 'teaspoons',
  pack: 'packs',
  box: 'boxes',
  bag: 'bags',
  can: 'cans',
  jar: 'jars',
  bottle: 'bottles',
  bunch: 'bunches',
  head: 'heads',
  clove: 'cloves',
  loaf: 'loaves',
  slice: 'slices',
  link: 'links',
  pouch: 'pouches',
  package: 'packages',
};

const UNIT_SINGULARS: Record<string, string> = Object.fromEntries(
  Object.entries(UNIT_PLURALS).map(([singular, plural]) => [plural, singular]),
);

/**
 * A unit word agreeing with `amount`, preserving the original when the word
 * isn't one we know how to inflect.
 *
 * The threshold is `> 1`, not `!== 1`: a fraction under one takes the singular
 * ("1/2 cup", "1/4 teaspoon"), which is why this can't just test for equality
 * with one.
 */
/**
 * The identity of a unit word, ignoring number — "cups" and "cup" are one unit.
 *
 * Exported for mergeQuantities, which has to decide whether two quantities are
 * measured in the same thing before it may add them. Comparing the raw strings
 * was survivable while every quantity came from something the user typed; it
 * stopped being once scaling started *generating* both forms, so "1/2 cup"
 * (halved) and "2 cups" (as written) would list side by side rather than sum.
 *
 * Only inflections in the table collapse. "g" and "grams" stay two units,
 * because treating them as one is a unit conversion — see rule 2 above.
 */
export function unitKey(unit: string): string {
  const lower = unit.trim().toLowerCase();
  return UNIT_SINGULARS[lower] ?? lower;
}

/**
 * A unit word agreeing with `amount`, preserving the original when the word
 * isn't one we know how to inflect.
 *
 * The threshold is `> 1`, not `!== 1`: a fraction under one takes the singular
 * ("1/2 cup", "1/4 teaspoon"), which is why this can't just test for equality
 * with one.
 */
export function inflectUnit(unit: string, amount: number): string {
  const singular = unitKey(unit);
  const plural = UNIT_PLURALS[singular];
  if (!plural) return unit;
  return amount > 1 ? plural : singular;
}

// ---------------------------------------------------------------------------
// Amount parsing
// ---------------------------------------------------------------------------

// The same three notations LEADING_QTY accepts, in the same order and for the
// same reason: a mixed number has to be tried before a bare decimal, or
// "1 1/2 cups" is read as "1" with "1/2 cups" left over.
const MIXED_NUMBER = /^(\d+)\s+(\d+)\/(\d+)/;
const FRACTION = /^(\d+)\/(\d+)/;
const DECIMAL = /^\d+(?:\.\d+)?/;

interface LeadingAmount {
  value: Rational;
  /** How many characters of the input the amount occupied. */
  length: number;
  /** True when it was written as a decimal — see formatRational. */
  decimal: boolean;
}

/** The leading amount of a quantity string, or null when it doesn't open with one. */
function readLeadingAmount(text: string): LeadingAmount | null {
  const mixed = MIXED_NUMBER.exec(text);
  if (mixed) {
    const den = Number(mixed[3]);
    if (den === 0) return null;
    return {
      value: rational(Number(mixed[1]) * den + Number(mixed[2]), den),
      length: mixed[0].length,
      decimal: false,
    };
  }
  const fraction = FRACTION.exec(text);
  if (fraction) {
    const den = Number(fraction[2]);
    if (den === 0) return null;
    return { value: rational(Number(fraction[1]), den), length: fraction[0].length, decimal: false };
  }
  const decimal = DECIMAL.exec(text);
  if (decimal) {
    const [whole, places = ''] = decimal[0].split('.');
    const den = 10 ** places.length;
    return {
      value: rational(Number(whole) * den + Number(places || 0), den),
      length: decimal[0].length,
      decimal: places.length > 0,
    };
  }
  return null;
}

/**
 * `quantity` as an exact rational, for a caller that needs to *add* two
 * quantities rather than scale one — see mergeQuantities. Null when the string
 * doesn't open with a parseable amount.
 *
 * Exported as the shared amount reader so scaling and merging can't drift into
 * two different ideas of what "1 1/2" means.
 */
export function quantityAmount(quantity: string): { value: number; decimal: boolean } | null {
  const amount = readLeadingAmount(quantity.trim());
  if (!amount) return null;
  return { value: toNumber(amount.value), decimal: amount.decimal };
}

/**
 * The same read, plus whatever followed the amount — for a caller that has to
 * look at the unit word itself rather than only at the number (unitConvert).
 *
 * Exported alongside `quantityAmount` rather than widening it, so the three
 * notations stay defined in exactly one place: a second copy of the mixed-number
 * ordering is how a converter and a scaler would come to disagree about what
 * "1 1/2" means.
 */
export function splitLeadingAmount(
  quantity: string,
): { value: number; decimal: boolean; rest: string } | null {
  const text = quantity.trim();
  const amount = readLeadingAmount(text);
  if (!amount) return null;
  return {
    value: toNumber(amount.value),
    decimal: amount.decimal,
    rest: text.slice(amount.length).trim(),
  };
}

/**
 * Renders a summed amount back to text, matching how scaling renders one, so
 * "1/2 cup" + "1/4 cup" reads "3/4 cup" rather than "0.75 cup".
 */
export function formatQuantityAmount(value: number, preferDecimal = false): string {
  return formatRational(factorToRational(value), preferDecimal);
}

// ---------------------------------------------------------------------------
// Scaling
// ---------------------------------------------------------------------------

/** A sized container's trailing half — "oz can" out of "14 oz can". */
const BARE_CONTAINER = /^([a-z]+)\.?\s+([a-z]+)$/i;
/** A counted sized container's trailing half — "14 oz cans" out of "2 14 oz cans". */
const COUNTED_CONTAINER = /^(\d+(?:\.\d+)?)\s*-?\s*([a-z]+)\.?\s+([a-z]+)$/i;
/** The leading unit word of whatever follows the amount, if it is a word at all. */
const LEADING_WORD = /^[a-z]+/i;

function isContainer(size: string, container: string): boolean {
  return SIZE_UNITS.has(size.toLowerCase()) && CONTAINER_UNITS.has(container.toLowerCase());
}

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
 *   count it is.
 * - **A sized container with no count** ("14 oz can", from "14-ounce can
 *   broth") — the leading number is the can's *size*, not how many cans, so
 *   scaling it would turn two cans of broth into one 28 oz can. Doubling emits
 *   a count instead ("2 14 oz cans"); a fractional factor can't be expressed
 *   this way at all and refuses.
 * - **A counted sized container** ("2 14 oz cans") — the count scales, the size
 *   never does.
 * - **Anything opening with an amount** — the amount scales and the first
 *   following word, if it's a known unit, agrees with the result.
 * - **Anything else** ("a pinch", "to taste", "dozen") — verbatim, flagged.
 *
 * A factor of exactly 1 is a no-op that reports `scaled: false`, so an
 * unscaled read is indistinguishable from one that never asked to be scaled —
 * which is what lets every caller pass a factor unconditionally.
 */
export function scaleQuantity(quantity: string, factor: number): ScaledQuantity {
  const text = quantity.trim();
  const unchanged: ScaledQuantity = { text, scaled: false };
  if (!text) return unchanged;
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return unchanged;

  const multiplier = factorToRational(factor);

  const trailingCount = /^x\s*(\d+)$/i.exec(text);
  if (trailingCount) {
    const scaled = multiply({ num: Number(trailingCount[1]), den: 1 }, multiplier);
    return { text: `x${formatRational(scaled, false)}`, scaled: true };
  }

  const amount = readLeadingAmount(text);
  if (!amount) return unchanged;
  const rest = text.slice(amount.length).trim();

  // "2%" — a percentage is part of the product ("2% milk"), never an amount to
  // multiply. parseGroceryInput already keeps it out of `quantity`, so this is
  // a guard against hand-typed and imported text rather than a live path.
  if (rest.startsWith('%')) return unchanged;

  const bare = BARE_CONTAINER.exec(rest);
  if (bare && isContainer(bare[1], bare[2])) {
    // The factor *is* the new count: one 14 oz can, doubled, is two of them.
    if (!Number.isInteger(factor)) return unchanged;
    const container = inflectUnit(bare[2], factor);
    return {
      text: `${factor} ${formatRational(amount.value, amount.decimal)} ${bare[1]} ${container}`,
      scaled: true,
    };
  }

  const counted = COUNTED_CONTAINER.exec(rest);
  if (counted && isContainer(counted[2], counted[3])) {
    const count = multiply(amount.value, multiplier);
    const container = inflectUnit(counted[3], toNumber(count));
    return {
      text: `${formatRational(count, amount.decimal)} ${counted[1]} ${counted[2]} ${container}`,
      scaled: true,
    };
  }

  const scaled = multiply(amount.value, multiplier);
  const rendered = formatRational(scaled, amount.decimal);
  if (!rest) return { text: rendered, scaled: true };

  // A size clause rather than a unit — parseGroceryInput emits "1, medium",
  // and splitting that on spaces would produce "2 , medium".
  const unit = LEADING_WORD.exec(rest);
  if (!unit) return { text: `${rendered}${rest}`, scaled: true };

  const inflected = inflectUnit(unit[0], toNumber(scaled));
  return { text: `${rendered} ${inflected}${rest.slice(unit[0].length)}`, scaled: true };
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
  return `${lines} couldn't be scaled automatically — adjust by eye`;
}
