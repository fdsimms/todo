import { GROCERY_NAME_MAX_LENGTH, GROCERY_QUANTITY_MAX_LENGTH, PREP_MAX_LENGTH } from '../types';

/**
 * Everything between raw keystrokes and a catalog row. Pure and store-free so
 * it stays testable under the node jest env, same as parseTaskInput.
 */

/**
 * The identity of a grocery item. "Milk", "milk " and "MILK" are one shelf
 * item; the *display* name stays whatever was typed last, because "Whole milk"
 * and "milk" reading identically in the list would be worse than a
 * near-duplicate.
 *
 * Deliberately does not stem plurals. "chips" → "chip" and "glasses" →
 * "glasse" are merges nobody asked for, and plural-tolerance belongs in the
 * autocomplete *match* (where a wrong guess costs one extra keystroke) rather
 * than in the identity key (where it silently merges two shelf items forever).
 *
 * CHANGING THIS FUNCTION STRANDS EVERY EXISTING ROW'S name_key — lookups would
 * start missing and quietly creating duplicates of things already in the
 * catalog. A change needs a guarded one-time backfill in the style of the
 * seen_at/category_registry migrations in database.ts: recompute every row's
 * key inside a `dbGetSetting('..._done') !== '1'` gate, then set the flag.
 *
 * That backfill now has to cover four places, not one. grocery_items.name_key
 * and grocery_shops.name_key are plain columns an UPDATE can reach; recipes
 * carry a name_key column AND a nameKey on every ingredient inside the
 * `ingredients` JSON blob, which no UPDATE can rewrite — that half has to read
 * each recipe, remap its ingredients, and write the row back. A stranded
 * ingredient is the quiet failure of the set: it still renders correctly and
 * merely stops matching the catalog, so nothing looks broken.
 */
export function groceryNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    // Strip diacritics so "jalapeño" and "jalapeno" are one item.
    .replace(/[\u0300-\u036f]/g, '')
    // Keep digits and % — "2% milk" and "7up" are names, not decoration.
    .replace(/[^a-z0-9%\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Units we're willing to treat as a leading quantity. A whitelist rather than
// a pattern because the failure mode of guessing is eating the first word of
// the item name, which is the one thing the key must keep.
const UNITS = [
  'lb', 'lbs', 'pound', 'pounds',
  'oz', 'ounce', 'ounces',
  'kg', 'g', 'gram', 'grams',
  'l', 'ml', 'liter', 'liters', 'litre', 'litres',
  'gal', 'gallon', 'gallons', 'qt', 'quart', 'quarts', 'pt', 'pint', 'pints',
  'cup', 'cups', 'tbsp', 'tsp',
  'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons',
  'pack', 'packs', 'pkg', 'box', 'boxes', 'bag', 'bags', 'can', 'cans',
  'jar', 'jars', 'bottle', 'bottles', 'bunch', 'bunches', 'head', 'heads',
  'clove', 'cloves', 'dozen', 'doz', 'loaf', 'loaves', 'x',
  'slice', 'slices', 'link', 'links',
];
const UNIT_SET = new Set(UNITS);

// Spelled-out units collapse to the abbreviation someone would've typed by
// hand — "1 tablespoon sugar" and "1 tbsp sugar" must produce the same
// quantity string, or the two spellings pile up as separate-looking rows
// even though parseGroceryInput correctly pulled the name out of both.
const UNIT_ABBREVIATIONS: Record<string, string> = {
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
};

// "2 lb", "1.5kg", "1/4 cup", "1 1/2 tbsp", "3 x" — a number (whole, decimal,
// a bare fraction, or a mixed number) optionally glued to a unit. The mixed
// and bare-fraction alternatives are tried before the plain-decimal one so
// "1 1/2 cups" isn't cut short at "1" with "1/2 cups" left dangling in front
// of the unit match.
const LEADING_QTY = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*([a-z]+)?\.?\s+(.*)$/i;

// Weight/volume units usable as a container's *size* ("14 oz cans", "1 L
// bottles"). Deliberately narrower than UNIT_SET as a whole — cup/tbsp/tsp/
// dozen aren't how a can or jar gets sized, and including them would just
// make CONTAINER_QTY fire on more inputs without any of them being real
// container-size phrasing.
const SIZE_UNITS = new Set([
  'lb', 'lbs', 'pound', 'pounds',
  'oz', 'ounce', 'ounces',
  'kg', 'g', 'gram', 'grams',
  'l', 'ml', 'liter', 'liters', 'litre', 'litres',
  'gal', 'gallon', 'gallons', 'qt', 'quart', 'quarts', 'pt', 'pint', 'pints',
]);

// The container word — always the second unit in "N SIZE-UNIT CONTAINER"
// ("2 14 oz cans"). Same words UNIT_SET already treats as a bare quantity on
// their own ("2 cans"); this only adds a size in front of them.
const CONTAINER_UNITS = new Set([
  'can', 'cans', 'jar', 'jars', 'box', 'boxes', 'bag', 'bags',
  'bottle', 'bottles', 'package', 'packages', 'pkg', 'pouch', 'pouches',
]);

// "2 14 oz cans black beans", "2 (14.5 oz) jars salsa", "14-ounce can broth"
// — a container line names both how many containers there are and how big
// each one is, which LEADING_QTY can't express on its own (it only pulls one
// number and one unit, so the second number would otherwise get read as part
// of the name). Tried first, and gated on both SIZE_UNITS and CONTAINER_UNITS
// — same discipline as every other unit match here — so it only fires on
// real container phrasing rather than swallowing the first two words of an
// ordinary line ("2 lb chicken thighs" has a unit but no container word, so
// the gate fails and it falls through to LEADING_QTY untouched).
const CONTAINER_QTY =
  /^(?:(\d+(?:\.\d+)?)\s+)?\(?(\d+(?:\.\d+)?)\s*-?\s*([a-z]+)\.?\)?\s+([a-z]+)\s+(.+)$/i;
// Size words, closed set. Unlike splitPrep's trailing clause (open-ended free
// text, safe only because it's confirmed against a comma), a size adjective
// right after the quantity is safe to split unconditionally, same reasoning
// as UNIT_SET: it's a known word list, not a guess at arbitrary text, so it
// can't eat the actual product name the way a leading-prep guess could
// ("sliced almonds" is a real product; "medium onion" never has "medium" as
// the product). Kept tight per the issue: small/medium/large plus the two
// compound sizes groceries actually get called.
const SIZE_WORDS = new Set(['small', 'medium', 'large', 'extra-large', 'jumbo']);

// "1 medium onion", "2 large eggs" — a size descriptor glued to the front of
// the name after the quantity/unit match has already run. Folded into the
// quantity string ("2, large") rather than added as a third return field:
// quantity is already rendered as opaque free text everywhere (GroceryRow,
// the item sheet, the AI sheet), so "2, large" reads fine there and a new
// field would mean touching every one of those call sites for one adjective.
// Only the word right at the START of what's left is a size — "mix greens
// with large tomatoes" has "large" mid-name and must be left alone, so this
// only ever looks at the first word.
const LEADING_SIZE = /^(small|medium|large|extra-large|jumbo)\s+(.+)$/i;

function extractLeadingSize(name: string, quantity: string): { name: string; quantity: string } {
  const match = LEADING_SIZE.exec(name);
  if (!match) return { name, quantity };
  const [, sizeWord, rest] = match;
  if (!rest.trim()) return { name, quantity };
  const size = sizeWord.toLowerCase();
  if (!SIZE_WORDS.has(size)) return { name, quantity };
  return { name: rest, quantity: `${quantity}, ${size}` };
}

// "milk x2", "eggs x 12"
const TRAILING_X = /^(.*?)\s+x\s*(\d+)$/i;
// "eggs (dozen)", "milk (2%)" — only when the parens close the string.
const TRAILING_PARENS = /^(.*?)\s*\((.+)\)$/;

function clampName(s: string): string {
  return s.trim().slice(0, GROCERY_NAME_MAX_LENGTH).trim();
}

function clampQuantity(s: string): string {
  return s.trim().slice(0, GROCERY_QUANTITY_MAX_LENGTH).trim();
}

/**
 * Splits "2 lb chicken thighs" into `{ name: 'chicken thighs', quantity: '2 lb' }`.
 *
 * The point is to get the quantity *out of the name* so the name stays a clean
 * catalog key — buying 1 milk this week and 2 next week must not create two
 * rows. Quantity is free text from here on; nothing does arithmetic on it.
 *
 * Guards worth keeping: a bare leading integer is only a quantity when
 * something follows it ("3 avocados"), a percent sign right after the number
 * means it's part of the name ("2% milk"), and an unrecognised word after the
 * number is treated as the start of the name rather than as a unit — so
 * "2 amazing tomatoes" yields quantity "2", not "2 amazing". Known miss:
 * "7 Up" parses as 7 × "Up". It stays editable in the item sheet.
 *
 * The leading count also accepts a bare fraction ("1/4 cup") and a mixed
 * number ("1 1/2 tbsp") — recipe quantities are written that way as often as
 * decimals, and without it "1/4 cup tomato paste" doesn't even look like it
 * has a quantity.
 *
 * A container line ("2 14 oz cans black beans") also names a size in front of
 * the container word — see CONTAINER_QTY — which needs its own pass since
 * LEADING_QTY only ever captures one number and one unit.
 */
export function parseGroceryInput(raw: string): { name: string; quantity: string | null } {
  const input = raw.trim().replace(/\s+/g, ' ');
  if (!input) return { name: '', quantity: null };

  const container = CONTAINER_QTY.exec(input);
  if (container) {
    const [, count, sizeNum, sizeUnitRaw, containerRaw, rest] = container;
    const sizeUnit = sizeUnitRaw.toLowerCase();
    const containerWord = containerRaw.toLowerCase();
    if (SIZE_UNITS.has(sizeUnit) && CONTAINER_UNITS.has(containerWord) && rest.trim()) {
      const quantity = [count, sizeNum, sizeUnit, containerWord].filter(Boolean).join(' ');
      const sized = extractLeadingSize(rest.trim(), quantity);
      return { name: clampName(sized.name), quantity: clampQuantity(sized.quantity) };
    }
  }

  const leading = LEADING_QTY.exec(input);
  if (leading) {
    const [, count, maybeUnit, rest] = leading;
    if (rest.trim()) {
      const unit = maybeUnit?.toLowerCase();
      if (unit && UNIT_SET.has(unit)) {
        const canonicalUnit = UNIT_ABBREVIATIONS[unit] ?? unit;
        // "2 boxes of cereal" — the unit already carries the container, so the
        // connecting "of" isn't part of the name. Only stripped when something
        // remains after it ("2 boxes of" alone keeps "of" rather than emptying
        // the name).
        const stripped = rest.replace(/^of\s+/i, '');
        const name = stripped.trim() ? stripped : rest;
        const sized = extractLeadingSize(name.trim(), `${count} ${canonicalUnit}`);
        return { name: clampName(sized.name), quantity: clampQuantity(sized.quantity) };
      }
      if (!maybeUnit) {
        // Bare count: "3 avocados". The unit slot was whitespace, so `rest`
        // already holds the whole name.
        const sized = extractLeadingSize(rest.trim(), count);
        return { name: clampName(sized.name), quantity: clampQuantity(sized.quantity) };
      }
      // A number followed by a word we don't know as a unit — the word belongs
      // to the name, unless it's a size word, which is a known closed set
      // rather than an unrecognised one.
      const fullName = `${maybeUnit} ${rest}`;
      const sized = extractLeadingSize(fullName.trim(), count);
      return { name: clampName(sized.name), quantity: clampQuantity(sized.quantity) };
    }
  }

  const trailingX = TRAILING_X.exec(input);
  if (trailingX && trailingX[1].trim()) {
    return { name: clampName(trailingX[1]), quantity: clampQuantity(`x${trailingX[2]}`) };
  }

  const parens = TRAILING_PARENS.exec(input);
  if (parens && parens[1].trim()) {
    return { name: clampName(parens[1]), quantity: clampQuantity(parens[2]) };
  }

  return { name: clampName(input), quantity: null };
}

// Recipe sites (and plenty of shopping lists) write prep as a trailing clause
// after a comma — "garlic, peeled and sliced", "black beans, drained and
// rinsed", "cheese, plus more for topping" — never as the essential part of
// the name. Splitting on the first comma is a convention match, not a guess
// about the *words*, which is what makes it safe in the way LEADING_QTY's
// unit whitelist is: it can't eat the name because the name is always
// everything before the first comma.
//
// Deliberately doesn't also try to peel a *leading* prep word ("grated
// cheddar", "chopped onion"): unlike a trailing clause, a leading modifier is
// sometimes the actual product ("sliced almonds" and "ground beef" are their
// own shelf items, not "almonds"/"beef" plus a prep note), and guessing wrong
// there costs the first word of the name — the exact failure the unit
// whitelist above is built to avoid. That case is left to the AI extractor.
const PREP_SPLIT = /^(.*?),\s*(.+)$/;

export function splitPrep(name: string): { name: string; prep: string | null } {
  const trimmed = name.trim();
  const match = PREP_SPLIT.exec(trimmed);
  if (!match) return { name: trimmed, prep: null };
  const [, core, prep] = match;
  if (!core.trim()) return { name: trimmed, prep: null };
  return {
    name: core.trim(),
    prep: prep.trim().slice(0, PREP_MAX_LENGTH) || null,
  };
}

/**
 * "cloves garlic" → "garlic", when "garlic" (and not "cloves garlic") is
 * already a name in the catalog — a one-tap correction for exactly the
 * leading-prep-word case splitPrep above declines to guess at ("sprigs
 * thyme", "handful spinach", any word the unit whitelist hasn't heard of).
 *
 * This is the "surface it rather than solve it" answer to that same problem:
 * guessing which leading word is prep is unsafe in general (see splitPrep's
 * comment — "sliced almonds" is a real product), but *confirming against
 * the user's own catalog* isn't a guess anymore. If "garlic" already exists
 * as a name someone typed and bought, "cloves garlic" matching it once the
 * first word is dropped is evidence, not a pattern match on the word
 * "cloves" itself — so this only ever offers a name that's already real to
 * this user, and never invents one.
 *
 * Only tries dropping exactly the *first* word. Two matches in a row
 * ("a bunch of X" → "of X" → "X") is the pattern the leading-word guess is
 * unsafe about in the first place; one confirmed hit is a correction, a
 * chain of them is exactly the guessing this function exists to avoid.
 */
export function suggestShorterCatalogName(name: string, catalogKeys: ReadonlySet<string>): string | null {
  const key = groceryNameKey(name);
  if (!key || catalogKeys.has(key)) return null;
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return null;
  const rest = words.slice(1).join(' ').trim();
  const restKey = groceryNameKey(rest);
  return restKey && catalogKeys.has(restKey) ? rest : null;
}

/**
 * What typing a line into the grocery quick-add field would produce, with the
 * quantity and prep pieces each independently overridable — see
 * `GroceryAddField`'s per-token × button, the whole reason this exists rather
 * than callers chaining parseGroceryInput + splitPrep themselves.
 *
 * `rejected` names values the user has already dismissed *by their exact
 * parsed text* rather than a plain on/off flag: typing further and landing on
 * a different quantity or prep clause is a new candidate and re-offers itself,
 * while continuing to type past a value that didn't change leaves it
 * dismissed. That's what makes this safe to recompute on every keystroke
 * rather than needing an effect to reconcile it.
 *
 * Quantity is peeled off first and prep is read from what's left, matching
 * makeIngredient's order — but rejecting the quantity doesn't also swallow
 * the prep clause: it re-runs the split against the *original* text, since a
 * trailing comma clause sits after where the quantity would have been either
 * way.
 */
export function resolveGroceryTokens(
  raw: string,
  rejected: { quantity: string | null; prep: string | null },
): {
  quantity: string | null;
  quantityAccepted: boolean;
  prep: string | null;
  prepAccepted: boolean;
  name: string;
} {
  const trimmed = raw.trim();
  const { name: afterQty, quantity } = parseGroceryInput(trimmed);
  const quantityAccepted = !!quantity && quantity !== rejected.quantity;

  const base = quantityAccepted ? afterQty : trimmed;
  const { name: withoutPrep, prep } = splitPrep(base);
  const prepAccepted = !!prep && prep !== rejected.prep;

  return {
    quantity,
    quantityAccepted,
    prep,
    prepAccepted,
    name: prepAccepted ? withoutPrep : base,
  };
}

// Bullet markers a pasted list might carry. The numbered form REQUIRES the
// trailing punctuation — "1. milk" is a numbered list, "1 lb milk" is a
// quantity, and without the punctuation requirement this would eat the second.
const BULLET = /^\s*(?:[-*•·–—]|\d{1,3}[.)])\s+/;

const MAX_PASTE_LINES = 100;

/**
 * Turns a pasted block into one item per line. Nothing else in the repo splits
 * on newlines, so this is the whole multi-line paste feature.
 *
 * Dedupes within the paste (a recipe that lists salt twice shouldn't produce
 * two adds) but not against the catalog — that's addByName's job, and it has
 * the store. Capped because a mis-paste of a whole document shouldn't write
 * ten thousand rows.
 */
export function splitGroceryLines(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line.replace(BULLET, '').trim();
    if (!cleaned) continue;
    const key = groceryNameKey(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned.slice(0, GROCERY_NAME_MAX_LENGTH));
    if (out.length >= MAX_PASTE_LINES) break;
  }
  return out;
}
