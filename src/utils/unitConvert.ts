import {
  formatQuantityAmount,
  inflectUnit,
  parseQuantity,
  rationalToNumber,
  unitKey,
} from './quantity';

/**
 * Showing a quantity in the units the cook actually thinks in — "1 lb" read as
 * "≈450 g", "500 g" read as "≈1.1 lbs".
 *
 * This is the second place in the app allowed to do arithmetic on a `quantity`,
 * and it deliberately does the one thing recipeScale's rule 2 forbids: it
 * converts between units. That rule stands where it was written. Scaling
 * multiplies a number the user gave and must hand back the same measurement
 * they wrote, so "500 g" doubled is "1000 g"; converting is the opposite
 * request — the user has asked, in Settings, to be shown a *different*
 * measurement of the same amount, and answering it in the unit they already
 * had would be answering nothing.
 *
 * What keeps it honest is that the conversion is display-only and says so:
 *
 * 1. **Nothing is ever written back.** Every call site renders the result; the
 *    stored `quantity` on the recipe or the grocery row is untouched, which is
 *    why editable fields (RecipeIngredientSheet, GroceryItemSheet) and previews
 *    of text about to be saved (the AI/extract sheets, GroceryAddField's token)
 *    deliberately do NOT convert. A field you are about to write has to show
 *    what will be written.
 * 2. **Converted text is marked `≈`**, always, because every conversion here is
 *    rounded (rule 4). It's the one signal that the number is the app's and not
 *    the recipe's, and it costs one character at every render site rather than
 *    a styling change at each one.
 * 3. **A closed table, never a guess** — the same discipline as groceryParse's
 *    unit whitelist. Mass and volume only. A count ("3", "x2", "4 cloves",
 *    "2 cans"), an unparseable amount ("a pinch") and a unit not in the table
 *    all pass through verbatim, flagged `converted: false`.
 * 4. **Rounded to what a person would write**, not to full precision: 1 cup is
 *    shown as 240 ml, not 236.59 ml, and 1 kg as 2 1/4 lbs, not 2.2046 lbs.
 *    The rounding rules are per-system and spelled out at each one below. This
 *    is the part that makes the feature useful and it's also why `≈` is not
 *    optional.
 *
 * The sharp case is the same one scaling has: **a container's size never
 * converts.** "14 oz can" names a product on a shelf, and "≈400 g can" is a
 * product nobody sells — so a container line passes through whole, recognised
 * as `Quantity.container` by the same parse the scaler reads.
 */

/**
 * `asWritten` is the default and means the app leaves quantities exactly as
 * they were typed or imported — the behaviour every install had before this
 * existed. The other two are targets, not descriptions of the source: a recipe
 * can mix "500 g" and "2 cups" line by line, and each line converts only if it
 * isn't already in the target system.
 */
export type UnitSystem = 'asWritten' | 'metric' | 'us';

export const UNIT_SYSTEMS: UnitSystem[] = ['asWritten', 'metric', 'us'];

export type Dimension = 'mass' | 'volume';

interface KnownUnit {
  dimension: Dimension;
  system: 'metric' | 'us';
  /** Grams (mass) or millilitres (volume) in one of this unit. */
  base: number;
}

const GRAMS_PER_OUNCE = 28.349523125;
const GRAMS_PER_POUND = 453.59237;
const ML_PER_TSP = 4.92892159375;
const ML_PER_TBSP = 14.78676478125;
const ML_PER_CUP = 236.5882365;
const ML_PER_PINT = 473.176473;
const ML_PER_QUART = 946.352946;
const ML_PER_GALLON = 3785.411784;

/**
 * Every unit this module is willing to convert, keyed by `unitKey` so both
 * spellings of an inflected word ("cup"/"cups", "lb"/"lbs") land on one entry.
 *
 * Volumes are US customary, which is what "cup" means in every recipe this app
 * will meet. Deliberately absent: `oz` is mass here and only mass — the parser
 * has no "fl oz" in its whitelist, so there is no ambiguous ounce to resolve —
 * and every count word (dozen, clove, can, bunch, slice, head, pack) is absent
 * because there is nothing to convert it to.
 */
const KNOWN_UNITS: Record<string, KnownUnit> = {
  oz: { dimension: 'mass', system: 'us', base: GRAMS_PER_OUNCE },
  ounce: { dimension: 'mass', system: 'us', base: GRAMS_PER_OUNCE },
  lb: { dimension: 'mass', system: 'us', base: GRAMS_PER_POUND },
  pound: { dimension: 'mass', system: 'us', base: GRAMS_PER_POUND },
  g: { dimension: 'mass', system: 'metric', base: 1 },
  gram: { dimension: 'mass', system: 'metric', base: 1 },
  kg: { dimension: 'mass', system: 'metric', base: 1000 },
  tsp: { dimension: 'volume', system: 'us', base: ML_PER_TSP },
  teaspoon: { dimension: 'volume', system: 'us', base: ML_PER_TSP },
  tbsp: { dimension: 'volume', system: 'us', base: ML_PER_TBSP },
  tablespoon: { dimension: 'volume', system: 'us', base: ML_PER_TBSP },
  cup: { dimension: 'volume', system: 'us', base: ML_PER_CUP },
  pt: { dimension: 'volume', system: 'us', base: ML_PER_PINT },
  pint: { dimension: 'volume', system: 'us', base: ML_PER_PINT },
  qt: { dimension: 'volume', system: 'us', base: ML_PER_QUART },
  quart: { dimension: 'volume', system: 'us', base: ML_PER_QUART },
  gal: { dimension: 'volume', system: 'us', base: ML_PER_GALLON },
  gallon: { dimension: 'volume', system: 'us', base: ML_PER_GALLON },
  ml: { dimension: 'volume', system: 'metric', base: 1 },
  l: { dimension: 'volume', system: 'metric', base: 1000 },
  liter: { dimension: 'volume', system: 'metric', base: 1000 },
  litre: { dimension: 'volume', system: 'metric', base: 1000 },
};

// ---------------------------------------------------------------------------
// Rendering the metric side
// ---------------------------------------------------------------------------

/**
 * Metric amounts are written to a round step, and which step depends on the
 * magnitude — nobody writes "236.59 ml" or "2.5 g" of flour. The buckets are
 * the ones that make the conversions people actually meet come out at the
 * numbers the charts print: 1 tsp → 5 ml, 1 tbsp → 15 ml, 1/4 cup → 60 ml,
 * 1 cup → 240 ml, 1 lb → 450 g.
 */
function roundMetric(value: number): number {
  const step = value < 5 ? 0.25 : value < 10 ? 0.5 : value < 100 ? 5 : 10;
  return Math.round(value / step) * step;
}

/** Trims the float noise a division leaves — "1.36", "2.5", "240". */
function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The big unit takes over at a thousand, which is the whole of the metric
 * ladder: 1000 g is 1 kg and 1000 ml is 1 L, so there is no threshold to pick.
 * `L` is capitalised on its own because a lowercase "l" next to a number reads
 * as a 1; `ml` is not, because "mL" next to "kg" and "g" reads as a typo.
 */
function renderMetric(base: number, dimension: Dimension): string | null {
  const rounded = roundMetric(base);
  if (rounded <= 0) return null;
  if (rounded >= 1000) {
    const unit = dimension === 'mass' ? 'kg' : 'L';
    return `${trimNumber(rounded / 1000)} ${unit}`;
  }
  return `${trimNumber(rounded)} ${dimension === 'mass' ? 'g' : 'ml'}`;
}

// ---------------------------------------------------------------------------
// Rendering the US side
// ---------------------------------------------------------------------------

/**
 * The fractions a US cook measures in, per dimension, tried simplest first.
 *
 * Thirds are volume-only and that's the point of splitting the two lists: a
 * measuring-cup set comes with a 1/3 cup, so "1/3 cup" is a real instruction,
 * while "3 1/3 lbs" is a number nobody weighs to. Without the split, 1.5 kg
 * renders as 3 1/3 lbs (which is closer) instead of 3 1/4 lbs (which is what
 * you'd write).
 */
const VOLUME_DENOMINATORS = [1, 2, 3, 4];
const MASS_DENOMINATORS = [1, 2, 4];

/**
 * How far a snapped fraction may sit from the true value, per dimension.
 *
 * Volume is looser because a cup is loose — 250 ml is "1 cup" in every recipe
 * ever written, and that's 5.4% off. Mass is tighter because a scale isn't: at
 * the volume tolerance, 1.5 kg would round to "3 1/2 lbs" (nearly 90 g out),
 * where 4% pushes it to "3 1/4 lbs". Both are still well inside the band where
 * `≈` is doing the honest work.
 */
const VOLUME_TOLERANCE = 0.06;
const MASS_TOLERANCE = 0.04;

/**
 * `value` as a cooking fraction, or null when no fraction is close enough —
 * the refusal that keeps "1.1 lbs" from being rendered as the "1 lb" it isn't.
 *
 * Simplest denominator wins rather than closest: at 250 ml every denominator
 * snaps to the same 1 cup, and "1 cup" is the answer, not "4/4".
 */
function snapToFraction(value: number, dimension: Dimension): number | null {
  const denominators = dimension === 'mass' ? MASS_DENOMINATORS : VOLUME_DENOMINATORS;
  const tolerance = dimension === 'mass' ? MASS_TOLERANCE : VOLUME_TOLERANCE;
  for (const den of denominators) {
    const snapped = Math.round(value * den) / den;
    if (snapped > 0 && Math.abs(snapped - value) <= value * tolerance) return snapped;
  }
  return null;
}

/** A US amount as text plus the number it rounded to, so the unit can agree with it. */
function renderUsAmount(value: number, dimension: Dimension): { text: string; value: number } {
  const snapped = snapToFraction(value, dimension);
  if (snapped != null) return { text: formatQuantityAmount(snapped), value: snapped };
  // No fraction fits, so say the decimal rather than claim a fraction. One
  // place above 1 (a scale reads "1.1 lbs"), two below it (a tenth of a
  // teaspoon is not a measurement).
  const rounded = value >= 1 ? Math.round(value * 10) / 10 : Math.round(value * 100) / 100;
  return { text: trimNumber(rounded), value: rounded };
}

/** Below this many millilitres a cup fraction is too coarse — see renderUs. */
const TBSP_FALLBACK_CEILING = ML_PER_CUP / 2;

/**
 * The US ladder, chosen so the number in front of the unit stays small and
 * measurable: teaspoons under a tablespoon, tablespoons under a quarter cup,
 * cups under a quart, then quarts and gallons.
 *
 * The one wrinkle is the tablespoon fallback. Under half a cup the cup
 * fractions run out — 100 ml is 0.42 of a cup, which is no fraction anyone
 * owns a measure for — so an amount that won't snap gets said in tablespoons
 * instead ("7 tbsp"), which is a thing you can actually do. Above half a cup
 * the tablespoon count gets absurd before it gets useful, so those fall back
 * to a decimal cup.
 */
function renderUs(base: number, dimension: Dimension): string | null {
  if (base <= 0) return null;

  if (dimension === 'mass') {
    const useOunces = base < GRAMS_PER_POUND;
    const unit = useOunces ? 'oz' : 'lb';
    const amount = renderUsAmount(base / (useOunces ? GRAMS_PER_OUNCE : GRAMS_PER_POUND), 'mass');
    if (amount.value <= 0) return null;
    return `${amount.text} ${inflectUnit(unit, amount.value)}`;
  }

  const ladder: { unit: string; base: number }[] =
    base < ML_PER_TBSP ? [{ unit: 'tsp', base: ML_PER_TSP }]
      : base < ML_PER_CUP / 4 ? [{ unit: 'tbsp', base: ML_PER_TBSP }]
        : base < ML_PER_QUART ? [{ unit: 'cup', base: ML_PER_CUP }]
          : base < ML_PER_GALLON ? [{ unit: 'qt', base: ML_PER_QUART }]
            : [{ unit: 'gal', base: ML_PER_GALLON }];
  const [{ unit, base: unitBase }] = ladder;

  if (unit === 'cup' && base < TBSP_FALLBACK_CEILING && snapToFraction(base / ML_PER_CUP, 'volume') == null) {
    const spoons = renderUsAmount(base / ML_PER_TBSP, 'volume');
    if (spoons.value > 0) return `${spoons.text} ${inflectUnit('tbsp', spoons.value)}`;
  }

  const amount = renderUsAmount(base / unitBase, 'volume');
  if (amount.value <= 0) return null;
  return `${amount.text} ${inflectUnit(unit, amount.value)}`;
}

// ---------------------------------------------------------------------------
// Converting a quantity string
// ---------------------------------------------------------------------------

/** How mergeQuantities joins quantities it refused to add together. */
const MERGE_SEPARATOR = ' · ';

export interface ConvertedQuantity {
  /** What to render. Equal to the input, trimmed, whenever `converted` is false. */
  text: string;
  /**
   * False when nothing in the string was converted — because the setting is
   * `asWritten`, because it's already in the target system, or because it's one
   * of the shapes this module refuses (a container size, a count, an
   * unparseable amount).
   */
  converted: boolean;
}

/** One quantity, with no `≈` of its own — see convertQuantity for the marker. */
function convertOne(part: string, target: 'metric' | 'us'): ConvertedQuantity {
  const q = parseQuantity(part);
  const unchanged: ConvertedQuantity = { text: q.raw, converted: false };
  if (q.amount === null) return unchanged;
  const value = rationalToNumber(q.amount);
  if (value <= 0) return unchanged;

  // A sized container: the leading number is how big the tin is, not how much
  // of something you have, so converting it renames a product off the shelf.
  if (q.container) return unchanged;

  // A range ("1 to 2 tbsp"): converting the low end alone and rendering it in
  // place of the whole range would silently drop the high end. recipeScale is
  // the one reader built to carry both ends through; this one refuses.
  if (q.rangeMax) return unchanged;

  if (!q.unit) return unchanged;
  const known = KNOWN_UNITS[q.unit];
  if (!known || known.system === target) return unchanged;

  const rendered = target === 'metric'
    ? renderMetric(value * known.base, known.dimension)
    : renderUs(value * known.base, known.dimension);
  if (!rendered) return unchanged;

  // Whatever followed the unit is prose — a size clause ("1 cup, packed"), a
  // prep note — and carries through untouched, exactly as scaling carries it.
  return { text: `${rendered}${q.trailing}`, converted: true };
}

export interface MeasuredQuantity {
  /** How much, in the dimension's base unit: grams for mass, millilitres for volume. */
  base: number;
  dimension: Dimension;
  /** Which system it was written in, so a reader can be answered in their own units. */
  system: 'metric' | 'us';
}

/**
 * How much of something a quantity string names — "2 lb" as 907 g, "500 ml" as
 * 500 ml — or null when it isn't a measurement off the table above.
 *
 * This is the measuring half of the module rather than the rendering half, and
 * it's what lets a price be compared per unit (see groceryPrice). It writes
 * nothing back either; the rule that keeps conversion honest is unchanged.
 *
 * **A sized container is measured here, where convertOne refuses it**, and the
 * two are consistent: rendering "14 oz can" as "≈400 g can" invents a product
 * nobody sells, which is why that path passes it through whole — but fourteen
 * ounces is genuinely how much is in the tin, so dividing a price by it renames
 * nothing. A container line that names a *count* of sized tins ("2 14 oz cans")
 * is refused, which is the refusal that matters: two of them is not fourteen
 * ounces.
 */
export function measureQuantity(quantity: string): MeasuredQuantity | null {
  const q = parseQuantity(quantity);
  if (q.amount === null) return null;
  const value = rationalToNumber(q.amount);
  if (value <= 0) return null;
  // A range ("1 to 2 tbsp") names two amounts; measuring the low end alone
  // would misreport how much the line actually calls for.
  if (q.rangeMax) return null;

  // A bare sized container takes its unit from the size word, and its leading
  // amount *is* that size — "14 oz can" is fourteen ounces. A counted one
  // ("2 14 oz cans") names a count instead, and two of them is not fourteen
  // ounces, so it falls out here rather than measuring the wrong number.
  if (q.container) {
    if (q.container.count) return null;
    const sized = KNOWN_UNITS[unitKey(q.container.sizeUnit)];
    if (!sized) return null;
    return { base: value * sized.base, dimension: sized.dimension, system: sized.system };
  }

  if (!q.unit) return null;
  const known = KNOWN_UNITS[q.unit];
  if (!known) return null;
  return { base: value * known.base, dimension: known.dimension, system: known.system };
}

/**
 * The unit a per-unit price is worth quoting in — what a shelf label uses. Per
 * kilo or per pound for mass, per litre or per quart for volume, picked by the
 * system the quantity was written in so the reader gets their own units back.
 *
 * One unit per (dimension, system) rather than a ladder like renderUs's: all
 * four are big enough that a real grocery price never rounds away to nothing in
 * them, which is the only thing a ladder would be here to prevent.
 */
export function shelfUnit(
  dimension: Dimension,
  system: 'metric' | 'us'
): { unit: string; base: number } {
  if (dimension === 'mass') {
    return system === 'metric' ? { unit: 'kg', base: 1000 } : { unit: 'lb', base: GRAMS_PER_POUND };
  }
  return system === 'metric' ? { unit: 'L', base: 1000 } : { unit: 'qt', base: ML_PER_QUART };
}

// ---------------------------------------------------------------------------
// Converting between two units, exactly
// ---------------------------------------------------------------------------

/**
 * How many `to` make one `from` — `unitFactor('tbsp', 'tsp')` is 3, and
 * `unitFactor('lb', 'oz')` is 16.
 *
 * **Same dimension *and* same system, which is deliberately narrower than
 * everything else in this module**, because those are the pairs whose true
 * ratio is a whole number: a tablespoon *is* three teaspoons, a pound *is*
 * sixteen ounces. Nothing is rounded to say so, so a caller may do arithmetic
 * with the factor and write the answer back into stored data. (The division
 * below still leaves the float noise any division does — 1/3 comes back as
 * 0.33333333333333337 — but that is the noise `scaleQuantity`'s denominator
 * search exists to absorb, not a rounded quantity.)
 *
 * A cross-system pair is different in kind rather than in precision: 1 tsp is
 * 4.929 ml, a number that has to be *rounded* before anyone would write it,
 * which is rule 4 and is why rule 2 marks that whole path `≈` and never writes
 * it back. There is nowhere to put an `≈` on a number that gets saved, so this
 * refuses rather than let the app's rounding be stored as the user's amount.
 *
 * Null is every refusal: a unit off the table (a clove, a can, a bunch, which
 * convert to nothing), the two dimensions, and the two systems.
 */
export function unitFactor(from: string, to: string): number | null {
  const a = KNOWN_UNITS[unitKey(from)];
  const b = KNOWN_UNITS[unitKey(to)];
  if (!a || !b) return null;
  if (a.dimension !== b.dimension || a.system !== b.system) return null;
  return a.base / b.base;
}

/**
 * The family a unit converts inside of, as a phrase a hint can drop in —
 * "volume, like tsp, tbsp or cups". Null for a unit off the table, which
 * converts to nothing and has to be named on its own instead.
 *
 * The examples are written out rather than derived from `KNOWN_UNITS`, which
 * holds every spelling of each unit ("tsp" and "teaspoon", "l" and "litre")
 * and no notion of which one a person would want shown. Keep them in step with
 * the table if a unit is added there.
 */
const UNIT_FAMILIES: Record<string, string> = {
  'volume:us': 'volume, like tsp, tbsp or cups',
  'volume:metric': 'volume, like ml or L',
  'mass:us': 'weight, like oz or lbs',
  'mass:metric': 'weight, like g or kg',
};

export function describeUnitFamily(unit: string): string | null {
  const known = KNOWN_UNITS[unitKey(unit)];
  if (!known) return null;
  return UNIT_FAMILIES[`${known.dimension}:${known.system}`] ?? null;
}

/**
 * `quantity` shown in `system` — "1 lb" in metric is "≈450 g".
 *
 * A merged quantity ("1 lb · 2 kg", what mergeQuantities emits when it won't
 * add two measurements together) is converted part by part and rejoined, since
 * the alternative is converting the first measurement and leaving the rest of
 * the string as a stray tail. The `≈` goes on the front once, for the whole
 * string, rather than on each part.
 *
 * `asWritten` returns the input trimmed and flagged unconverted, so every call
 * site can pass the preference unconditionally.
 */
export function convertQuantity(quantity: string, system: UnitSystem): ConvertedQuantity {
  const text = quantity.trim();
  if (system === 'asWritten' || !text) return { text, converted: false };

  const parts = text.split(MERGE_SEPARATOR).map(part => convertOne(part, system));
  if (!parts.some(part => part.converted)) return { text, converted: false };
  return { text: `≈${parts.map(part => part.text).join(MERGE_SEPARATOR)}`, converted: true };
}
