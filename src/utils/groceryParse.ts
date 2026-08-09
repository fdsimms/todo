import { GROCERY_NAME_MAX_LENGTH, GROCERY_QUANTITY_MAX_LENGTH } from '../types';

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
  'dozen', 'doz', 'loaf', 'loaves', 'x',
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

// "2 lb", "1.5kg", "3 x" — a number, optionally glued to a unit.
const LEADING_QTY = /^(\d+(?:\.\d+)?)\s*([a-z]+)?\.?\s+(.*)$/i;
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
 */
export function parseGroceryInput(raw: string): { name: string; quantity: string | null } {
  const input = raw.trim().replace(/\s+/g, ' ');
  if (!input) return { name: '', quantity: null };

  const leading = LEADING_QTY.exec(input);
  if (leading) {
    const [, count, maybeUnit, rest] = leading;
    if (rest.trim()) {
      const unit = maybeUnit?.toLowerCase();
      if (unit && UNIT_SET.has(unit)) {
        const canonicalUnit = UNIT_ABBREVIATIONS[unit] ?? unit;
        return { name: clampName(rest), quantity: clampQuantity(`${count} ${canonicalUnit}`) };
      }
      if (!maybeUnit) {
        // Bare count: "3 avocados". The unit slot was whitespace, so `rest`
        // already holds the whole name.
        return { name: clampName(rest), quantity: clampQuantity(count) };
      }
      // A number followed by a word we don't know as a unit — the word belongs
      // to the name.
      return { name: clampName(`${maybeUnit} ${rest}`), quantity: clampQuantity(count) };
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
