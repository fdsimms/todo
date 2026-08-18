/**
 * A `quantity` string, read once.
 *
 * `quantity` is free text everywhere it's stored (RecipeIngredient.quantity,
 * GroceryItem.quantity, ItemShopLink.lastPriceQuantity) and that isn't
 * changing — this is a parse-on-read value type, not a migration, and nothing
 * here is ever written back. What it replaces is the six separate readers that
 * had accreted around those strings: the scaler, the converter, the price
 * comparison, the substitute ratio, the merge in mealPlanGroceries and the
 * container recognition in groceryParse each pulled a leading amount out and
 * each had its own idea of what "unreadable" meant. Now they're transformations
 * over one type.
 *
 * The rules they were written to keep are unchanged, and each still lives with
 * the module that owns it: scaling never converts units, conversion is
 * display-only and marks `≈`, a container's size neither scales nor converts,
 * and `mergeQuantities` still refuses to collapse units that merely measure
 * alike. What moved here is the *reading*, not the policy.
 *
 * Two fields carry the whole contract:
 *
 * - **`raw` is always what renders when `amount` is null.** "a pinch" comes
 *   back as "a pinch", which is how every one of those modules already behaved
 *   and why none of them needs its own refusal branch any more.
 * - **`amount === null` is every refusal, stated once** — no leading number
 *   ("to taste"), the `x2` notation (see `countNotation`), and a percentage
 *   ("2%", which is part of a product name and never an amount).
 *
 * Nothing here decides *whether* arithmetic is allowed. That judgement is the
 * caller's and it hasn't moved: recipeScale multiplies through a factor the
 * user picked, unitConvert converts for a setting, groceryPrice divides to
 * compare, itemSubs applies a ratio the user typed. A parsed quantity is
 * evidence, not permission.
 */

// ---------------------------------------------------------------------------
// Exact rationals
// ---------------------------------------------------------------------------

/** A non-negative exact rational. `den` is always > 0 and the pair is reduced. */
export interface Rational {
  num: number;
  den: number;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

export function rational(num: number, den: number): Rational {
  const divisor = gcd(Math.abs(num), Math.abs(den)) || 1;
  return { num: num / divisor, den: den / divisor };
}

export function multiplyRational(a: Rational, b: Rational): Rational {
  return rational(a.num * b.num, a.den * b.den);
}

export function rationalToNumber(r: Rational): number {
  return r.num / r.den;
}

/**
 * A number as an exact rational. The factors the UI offers are all halves and
 * thirds, and a servings-derived one ("4 servings → 6") is a ratio of two
 * integers, so a denominator search bounded at 1000 is exact for every factor
 * this app can produce and falls back to a plain approximation rather than
 * throwing for anything stranger.
 */
export function rationalFromNumber(value: number): Rational {
  if (Number.isInteger(value)) return { num: value, den: 1 };
  for (let den = 2; den <= 1000; den++) {
    const num = value * den;
    if (Math.abs(num - Math.round(num)) < 1e-9) return rational(Math.round(num), den);
  }
  return rational(Math.round(value * 1000), 1000);
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
 * denominator falls back to a 2-place decimal for the same reason `amount`
 * refuses rather than guesses — an honest approximation beats "17/50 cup".
 */
export function formatRational(value: Rational, preferDecimal: boolean): string {
  const n = rationalToNumber(value);
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

/**
 * Renders an amount back to text the same way a parsed one renders, so a sum
 * ("1/2 cup" + "1/4 cup") and a scale (a halved "1 1/2 cups") read alike.
 */
export function formatQuantityAmount(value: number, preferDecimal = false): string {
  return formatRational(rationalFromNumber(value), preferDecimal);
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
  deciliter: 'deciliters',
  sprig: 'sprigs',
  stalk: 'stalks',
  rib: 'ribs',
  stem: 'stems',
  stick: 'sticks',
  sheet: 'sheets',
  fillet: 'fillets',
  piece: 'pieces',
  ear: 'ears',
  wedge: 'wedges',
  strip: 'strips',
  pinch: 'pinches',
  dash: 'dashes',
  handful: 'handfuls',
};

const UNIT_SINGULARS: Record<string, string> = Object.fromEntries(
  Object.entries(UNIT_PLURALS).map(([singular, plural]) => [plural, singular]),
);

/**
 * The identity of a unit word, ignoring number — "cups" and "cup" are one unit.
 *
 * What `Quantity.unit` is keyed by, and what a caller compares two quantities
 * on before it may add them or apply a ratio across them. Comparing the raw
 * strings was survivable while every quantity came from something the user
 * typed; it stopped being once scaling started *generating* both forms, so
 * "1/2 cup" (halved) and "2 cups" (as written) would list side by side rather
 * than sum.
 *
 * Only inflections in the table collapse. "g" and "grams" stay two units,
 * because treating them as one is a unit conversion — which is unitConvert's
 * job, done on an explicit setting and marked `≈`, never something a unit
 * lookup does quietly.
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
// Containers
// ---------------------------------------------------------------------------

// Weight/volume units usable as a container's *size* ("14 oz cans", "1 L
// bottles"). Deliberately narrower than groceryParse's unit whitelist as a
// whole — cup/tbsp/tsp/dozen aren't how a can or jar gets sized, and including
// them would just make the container shapes fire on more inputs without any of
// them being real container phrasing.
export const SIZE_UNITS = new Set([
  'lb', 'lbs', 'pound', 'pounds',
  'oz', 'ounce', 'ounces',
  'kg', 'g', 'gram', 'grams',
  'l', 'ml', 'liter', 'liters', 'litre', 'litres',
  'gal', 'gallon', 'gallons', 'qt', 'quart', 'quarts', 'pt', 'pint', 'pints',
]);

// The container word — always the last unit in "N SIZE-UNIT CONTAINER"
// ("2 14 oz cans"). Same words groceryParse already treats as a bare quantity
// on their own ("2 cans"); this only adds a size in front of them.
export const CONTAINER_UNITS = new Set([
  'can', 'cans', 'jar', 'jars', 'box', 'boxes', 'bag', 'bags',
  'bottle', 'bottles', 'package', 'packages', 'pkg', 'pouch', 'pouches',
]);

/** Whether `size`/`container` name a real container shape — "oz"/"can", not "cup"/"flour". */
export function isSizedContainer(size: string, container: string): boolean {
  return SIZE_UNITS.has(size.toLowerCase()) && CONTAINER_UNITS.has(container.toLowerCase());
}

/**
 * A sized container, the shape whose leading number is a *size* rather than a
 * count — "14 oz can" is one tin of a given size, and scaling or converting
 * that number changes what you buy rather than how much of it.
 *
 * `sizeText`, `sizeUnit` and `word` are all verbatim, because a container line
 * is carried through rather than restated: the two modules allowed to do
 * arithmetic on a quantity both leave the size exactly as it was written.
 */
export interface ContainerInfo {
  /**
   * How many containers the line names — "2 14 oz cans". Null for a bare
   * "14 oz can", which names no count at all; that's the distinction
   * `measureQuantity` turns on, since fourteen ounces is how much is in the
   * tin but two of them is not fourteen ounces.
   */
  count: Rational | null;
  /** How big one container is, for a caller that measures it. */
  size: Rational;
  /** The same size as written ("14", "14.5"), for a caller that renders it back. */
  sizeText: string;
  /** The size's unit as written ("oz"). Key it with `unitKey` to look it up. */
  sizeUnit: string;
  /** The container word as written ("can", "cans"). */
  word: string;
}

// ---------------------------------------------------------------------------
// The value type
// ---------------------------------------------------------------------------

export interface Quantity {
  /** The input, trimmed. **Always what renders when `amount` is null.** */
  raw: string;
  /**
   * The leading amount, exact. **Null is every refusal** — no leading number,
   * the `x2` notation, a percentage — so a caller that can't act without one
   * has exactly one thing to check.
   */
  amount: Rational | null;
  /**
   * True when the amount was written as a decimal ("1.5"), so a caller
   * rendering an answer hands back the notation it was given rather than
   * fractions someone didn't ask for.
   */
  decimal: boolean;
  /**
   * Everything after the amount, trimmed — "cups, packed" out of
   * "2 cups, packed". `''` when the amount was the whole string.
   *
   * Kept alongside `unit` because two readers genuinely want the whole tail
   * rather than the unit word: a ratio has to agree on the *entire*
   * measurement it was written against, and a hint naming the unit back at the
   * user says what they typed.
   */
  rest: string;
  /** `rest`'s leading word keyed by `unitKey` — "cup" for both "cup" and "cups". */
  unit: string | null;
  /** The same word verbatim, for a caller that inflects or echoes it. */
  unitWritten: string | null;
  /**
   * Whatever followed the unit word, verbatim and untrimmed — ", packed", the
   * size clause parseGroceryInput emits as ", medium". Equal to `rest` when
   * there was no unit word to take off the front, so it is always the prose a
   * rendered answer carries through.
   */
  trailing: string;
  /** A sized container, when the line is one — see ContainerInfo. */
  container: ContainerInfo | null;
  /**
   * The `x2` trailing-count notation parseGroceryInput emits, as its count.
   *
   * It deliberately leaves `amount` null: scaling is the one reader with any
   * use for it, and every other reader — measuring, converting, comparing,
   * merging — refused it before this type existed and still does, for free.
   */
  countNotation: Rational | null;
}

// The three notations, in this order and for this reason: a mixed number has
// to be tried before a bare decimal, or "1 1/2 cups" is read as "1" with
// "1/2 cups" left over.
const MIXED_NUMBER = /^(\d+)\s+(\d+)\/(\d+)/;
const FRACTION = /^(\d+)\/(\d+)/;
const DECIMAL = /^\d+(?:\.\d+)?/;

/** parseGroceryInput's trailing-count notation, on its own. */
const TRAILING_COUNT = /^x\s*(\d+)$/i;

/**
 * The leading unit word of whatever follows an amount, if it is a word at all
 * — "cup" out of "cup flour", but nothing out of ", medium onion" (a size
 * clause, not a unit).
 */
const LEADING_WORD = /^[a-z]+/i;

/** A bare sized container's trailing half — "oz can" out of "14 oz can". */
const BARE_CONTAINER = /^([a-z]+)\.?\s+([a-z]+)$/i;

/** A counted sized container's trailing half — "14 oz cans" out of "2 14 oz cans". */
const COUNTED_CONTAINER = /^(\d+(?:\.\d+)?)\s*-?\s*([a-z]+)\.?\s+([a-z]+)$/i;

interface LeadingAmount {
  value: Rational;
  /** How many characters of the input the amount occupied. */
  length: number;
  decimal: boolean;
}

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
 * `raw` read as a quantity. Total — there is no failure mode, only a `Quantity`
 * whose `amount` is null, which is what every caller's refusal branch tests.
 *
 * The order the shapes are tried in is the order they can be told apart:
 * `x2` first (it opens with a letter, so no amount reader would see it), then
 * the amount, then the two container shapes — which can't collide, since a bare
 * container's tail is two words and a counted one's is three.
 */
export function parseQuantity(raw: string): Quantity {
  const text = raw.trim();
  const none: Quantity = {
    raw: text,
    amount: null,
    decimal: false,
    rest: '',
    unit: null,
    unitWritten: null,
    trailing: '',
    container: null,
    countNotation: null,
  };
  if (!text) return none;

  const counted = TRAILING_COUNT.exec(text);
  if (counted) return { ...none, countNotation: { num: Number(counted[1]), den: 1 } };

  const amount = readLeadingAmount(text);
  if (!amount) return none;
  const rest = text.slice(amount.length).trim();

  // "2%" — a percentage is part of the product ("2% milk"), never an amount to
  // do arithmetic with. parseGroceryInput already keeps it out of `quantity`,
  // so this covers hand-typed and imported text.
  if (rest.startsWith('%')) return none;

  const base: Quantity = { ...none, amount: amount.value, decimal: amount.decimal, rest };

  const bare = BARE_CONTAINER.exec(rest);
  if (bare && isSizedContainer(bare[1], bare[2])) {
    return {
      ...base,
      container: {
        count: null,
        size: amount.value,
        sizeText: text.slice(0, amount.length),
        sizeUnit: bare[1],
        word: bare[2],
      },
    };
  }

  const withCount = COUNTED_CONTAINER.exec(rest);
  const size = withCount ? readLeadingAmount(withCount[1]) : null;
  if (withCount && size && isSizedContainer(withCount[2], withCount[3])) {
    return {
      ...base,
      container: {
        count: amount.value,
        size: size.value,
        sizeText: withCount[1],
        sizeUnit: withCount[2],
        word: withCount[3],
      },
    };
  }

  const word = LEADING_WORD.exec(rest);
  if (!word) return { ...base, trailing: rest };
  return {
    ...base,
    unit: unitKey(word[0]),
    unitWritten: word[0],
    trailing: rest.slice(word[0].length),
  };
}

/**
 * Whether a quantity is nothing but an amount and an optional unit word — the
 * shape a caller needs before it may treat two quantities as the same
 * measurement (see mergeQuantities' rule 4).
 *
 * Strict at both ends on purpose: "2 14 oz cans" and "1 cup, packed" are
 * measurements of something, but neither is one number in one unit, so both
 * get listed rather than summed.
 */
export function isWholeAmount(
  quantity: Quantity,
): quantity is Quantity & { amount: Rational } {
  return quantity.amount !== null && !quantity.container && !quantity.trailing;
}
