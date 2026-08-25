import { GROCERY_NAME_MAX_LENGTH, GROCERY_QUANTITY_MAX_LENGTH, PREP_MAX_LENGTH } from '../types';
import { isSizedContainer } from './quantity';

/**
 * Everything between raw keystrokes and a catalog row. Pure and store-free so
 * it stays testable under the node jest env, same as parseTaskInput.
 *
 * This is the *name* half of the grocery text problem — where a quantity stops
 * and the thing you're buying starts. Reading the quantity itself is
 * `quantity.ts`, which owns the units, the container shapes and the amount
 * notations; this file only has to recognise enough of one to know how much of
 * a typed line isn't the name.
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
  'l', 'ml', 'liter', 'liters', 'litre', 'litres', 'dl', 'deciliter', 'deciliters',
  'gal', 'gallon', 'gallons', 'qt', 'quart', 'quarts', 'pt', 'pint', 'pints',
  'cup', 'cups', 'tbsp', 'tsp',
  'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons',
  'pack', 'packs', 'pkg', 'box', 'boxes', 'bag', 'bags', 'can', 'cans',
  'jar', 'jars', 'bottle', 'bottles', 'bunch', 'bunches', 'head', 'heads',
  'clove', 'cloves', 'dozen', 'doz', 'loaf', 'loaves', 'x',
  'slice', 'slices', 'link', 'links',
  'package', 'packages', 'pouch', 'pouches',
  'sprig', 'sprigs', 'stalk', 'stalks', 'rib', 'ribs', 'stem', 'stems',
  'stick', 'sticks', 'sheet', 'sheets', 'fillet', 'fillets', 'piece', 'pieces',
  'ear', 'ears', 'wedge', 'wedges', 'strip', 'strips',
  'pinch', 'pinches', 'dash', 'dashes', 'handful', 'handfuls',
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

// "2 14 oz cans black beans", "2 (14.5 oz) jars salsa", "14-ounce can broth"
// — a container line names both how many containers there are and how big
// each one is, which LEADING_QTY can't express on its own (it only pulls one
// number and one unit, so the second number would otherwise get read as part
// of the name). Tried first, and gated on `isSizedContainer` — the same gate
// `parseQuantity` recognises the shape with, so this file and every reader
// downstream can't come to disagree about what a container line is — so it
// only fires on real container phrasing rather than swallowing the first two
// words of an ordinary line ("2 lb chicken thighs" has a unit but no container
// word, so the gate fails and it falls through to LEADING_QTY untouched).
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
    if (isSizedContainer(sizeUnit, containerWord) && rest.trim()) {
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
// Beyond the trailing clause, a small whitelist below (LEADING_PREP_WORDS)
// also peels a *leading* prep word ("grated cheddar", "chopped onion") — but
// only for words curated as unambiguous. In general a leading modifier is
// sometimes the actual product ("sliced almonds" and "ground beef" are their
// own shelf items, not "almonds"/"beef" plus a prep note), and guessing wrong
// there costs the first word of the name — the exact failure the unit
// whitelist above is built to avoid. Anything not on the whitelist is left to
// the AI extractor.
const PREP_SPLIT = /^(.*?),\s*(.+)$/;

// A small, deliberately curated whitelist of leading prep words safe enough
// to split unconditionally — unlike the general leading-word case above,
// these essentially never have a standalone-product reading. Explicitly
// excludes "sliced" and "ground" (per the issue this whitelist came from):
// "sliced almonds" and "ground beef" are real shelf items, so guessing on
// those costs the first word of the name, the exact failure this file is
// built to avoid. Keep this list tight — scope creep here is worse than an
// incomplete list.
const LEADING_PREP_WORDS = ['minced', 'chopped', 'diced', 'crushed', 'grated'];
const LEADING_PREP_SPLIT = new RegExp(
  `^(${LEADING_PREP_WORDS.join('|')})\\s+(.+)$`,
  'i',
);

export function splitPrep(name: string): { name: string; prep: string | null } {
  const trimmed = name.trim();

  // "chicken, beef, or lamb" is a list of options, not a name and a prep
  // clause. Taking the comma here would store "chicken" with "beef, or lamb"
  // hanging off it as prep, which loses two of the three things the line names
  // *and* puts the split suggestion out of reach — see looksLikeAlternativeList
  // for why only the Oxford-comma form qualifies.
  if (looksLikeAlternativeList(trimmed)) return { name: trimmed, prep: null };

  const match = PREP_SPLIT.exec(trimmed);
  if (match) {
    const [, core, prep] = match;
    if (core.trim()) {
      return {
        name: core.trim(),
        prep: prep.trim().slice(0, PREP_MAX_LENGTH) || null,
      };
    }
  }

  const leading = LEADING_PREP_SPLIT.exec(trimmed);
  if (leading) {
    const [, prepWord, rest] = leading;
    if (rest.trim()) {
      return {
        name: rest.trim(),
        prep: prepWord.toLowerCase().slice(0, PREP_MAX_LENGTH),
      };
    }
  }

  // A trailing parenthetical left in the name after parseGroceryInput's own
  // leading-quantity match already claimed the actual amount — "tempeh
  // (steamed 10 min)". Reusing TRAILING_PARENS here is safe in a way it isn't
  // inside parseGroceryInput: that call only fires when NO leading quantity
  // was found, where a trailing paren is read as a size/quantity descriptor
  // ("eggs (dozen)"). By the time a name reaches splitPrep, any leading
  // quantity has already been extracted, so a paren clause left over can only
  // be describing what to do to the item, not how much of it there is.
  const parens = TRAILING_PARENS.exec(trimmed);
  if (parens && parens[1].trim()) {
    return {
      name: parens[1].trim(),
      prep: parens[2].trim().slice(0, PREP_MAX_LENGTH) || null,
    };
  }

  return { name: trimmed, prep: null };
}

// Recipe sites also write *why* an ingredient is on the list as a trailing
// "for " clause — "Limes for margaritas", "flour for dusting", "cheese for
// topping" — rather than a comma. Same convention-match discipline as
// PREP_SPLIT: it's safe to split unconditionally not because "for" is an
// unambiguous word (it isn't — "before", "fortune", "comfort" all contain
// it), but because the match requires a *standalone* " for " — whitespace on
// both sides — which only ever appears as the connective word, never glued
// inside a product name. Greedy on the core so "chicken stock for soup for
// tonight" (two "for"s) splits at the *last* one, which reads as the more
// specific purpose.
//
// Deliberately does NOT run when splitPrep already found a comma clause: a
// prep clause can itself legitimately contain "for" ("cheese, plus more for
// topping" is one prep note, not a name plus a purpose), so this only ever
// looks at text that had no comma to begin with. That ordering is the
// caller's job (see makeIngredient), not this function's — splitPurpose only
// knows about the string it's given.
//
// Known false positive, accepted rather than guarded against: a product
// whose real name ends in " for " something ("Room For Cream", a real
// off-brand energy drink) reads identically to a purpose clause and would be
// split. There's no whitelist of real product names to check against — the
// same asymmetry LEADING_PREP_WORDS is curated for the *other* direction
// isn't available here, since "for" isn't a closed set of prep verbs, it's
// the connective word itself. Left editable in the item sheet, same as the
// "7 Up" miss in parseGroceryInput.
const PURPOSE_SPLIT = /^(.*\S)\s+for\s+(\S.*)$/i;

export function splitPurpose(name: string): { name: string; purpose: string | null } {
  const trimmed = name.trim();
  const match = PURPOSE_SPLIT.exec(trimmed);
  if (!match) return { name: trimmed, purpose: null };
  const [, core, purpose] = match;
  if (!core.trim()) return { name: trimmed, purpose: null };
  return {
    name: core.trim(),
    purpose: purpose.trim().slice(0, PREP_MAX_LENGTH) || null,
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
 * Words that make an "or" a hedge about *how much*, not a choice between two
 * things: "salt or more to taste", "1 cup or so", "bake 40 minutes or until
 * golden". Matched against the first word after the "or".
 */
const NOT_AN_ALTERNATIVE = new Set([
  'so', 'more', 'less', 'until', 'to', 'as', 'thereabouts', 'otherwise', 'whatever', 'any',
]);

/** Beyond this many parts a line is prose, not a choice — see splitAlternativeNames. */
const MAX_ALTERNATIVES = 4;

/**
 * A comma immediately before the "or" — "serrano, jalapeño, or habanero".
 *
 * This is what licenses treating a line's *other* commas as list separators
 * rather than as the prep clause `PREP_SPLIT` reads them as, and it's a
 * punctuation convention rather than a guess about the words — exactly the
 * argument PREP_SPLIT itself makes. Without it there is nothing to tell
 * "chicken, beef, or lamb" (three things to choose between) from "onion, red or
 * white" (one thing and a note about it), since both are a comma, some words,
 * an "or" and some more words.
 *
 * The cost is that "limes, lemons or grapefruit" — the same list without the
 * Oxford comma — is left to the plain "or" split, which reads it as two
 * options. That's a suggestion the user can decline, where mis-splitting a prep
 * clause would quietly cost the name.
 */
const OXFORD_OR = /,\s*or\s+/i;

/**
 * Splits on commas *and* whole-word "or", the list form OXFORD_OR licenses.
 * The optional "or" after the comma is what keeps ", or habanero" one
 * separator rather than a comma followed by a part called "or habanero"; the
 * trailing `\s+` in it is also what keeps ", orange juice" a plain comma.
 */
const LIST_SEPARATOR = /\s*,\s*(?:or\s+)?|\s+or\s+/i;

/**
 * Words that mean a comma-separated part is a note about the thing rather than
 * another thing — "black beans, drained and rinsed or canned". Matched against
 * the part's first word, the same shape NOT_AN_ALTERNATIVE uses.
 *
 * Deliberately wider than LEADING_PREP_WORDS above, and it can afford to be:
 * that list decides what to *take out* of a name, so a wrong entry costs the
 * first word of the name. This one only decides whether to offer a split at
 * all, so a wrong entry costs a suggestion nobody sees.
 */
const PREP_CLAUSE_WORDS = new Set([
  'minced', 'chopped', 'diced', 'crushed', 'grated', 'sliced', 'shredded', 'ground',
  'peeled', 'seeded', 'stemmed', 'trimmed', 'halved', 'quartered', 'cubed', 'julienned',
  'drained', 'rinsed', 'washed', 'melted', 'softened', 'thawed', 'toasted', 'divided',
  'room', 'plus', 'preferably', 'optional', 'packed', 'sifted', 'beaten', 'zested', 'juiced',
]);

/**
 * "cheddar or manchego" → `['cheddar', 'manchego']`, and null for anything that
 * isn't a genuine either/or.
 *
 * Recipes write alternatives inline constantly ("chicken or vegetable stock",
 * and "grated cheddar or manchego cheese" turned up verbatim in an imported
 * recipe), which is a problem specific to this app: `nameKey` is the bridge to
 * the grocery catalog, so storing that as one line mints a catalog row called
 * "cheddar or manchego" — a row no real purchase can ever match. Two rows in a
 * choice group is the fix (see RecipeIngredient.choiceGroup); this is how the
 * app notices the line wants to be two.
 *
 * **It only ever feeds a suggestion the user confirms, and that's load-bearing
 * rather than timidity.** The split is deliberately verbatim — "chicken or
 * vegetable stock" comes back as `['chicken', 'vegetable stock']`, not the
 * `['chicken stock', 'vegetable stock']` a person means. Distributing that
 * trailing noun is unsafe in general and the counterexample is the same shape:
 * "butter or olive oil" would become "butter oil". Nothing here can tell those
 * two apart without knowing what the words mean, so the honest move is to show
 * the parts and let the user fix the one case that needs it — the same call
 * splitPrep makes about leading prep words, and the same reason
 * suggestShorterCatalogName confirms against the catalog rather than guessing.
 *
 * Matches "or" only as a whole word, so "oregano" and "orange" are safe.
 * Deliberately does not split on "/": a slash is a fraction far more often than
 * a choice here ("1/2 tsp"), and "salt/pepper" usually means both.
 *
 * **Commas count as separators too, but only in the Oxford-comma form** — see
 * OXFORD_OR. "serrano, jalapeño, or habanero" is three options; "onion, red or
 * white" is left alone.
 */
export function splitAlternativeNames(name: string): string[] | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const asList = OXFORD_OR.test(trimmed);
  const parts = trimmed
    .split(asList ? LIST_SEPARATOR : /\s+or\s+/i)
    .map(part => part.trim())
    .filter(part => part.length > 0);
  if (parts.length < 2 || parts.length > MAX_ALTERNATIVES) return null;
  // Every part has to stand on its own as something to buy.
  if (parts.some(part => !/[a-z]/i.test(part))) return null;
  // A hedge about quantity reads exactly like a choice up to this point.
  if (parts.slice(1).some(part => NOT_AN_ALTERNATIVE.has(firstWord(part)))) return null;
  // A prep clause caught by the comma split is a note about the first part, not
  // a further option. Only reachable in list form — the plain "or" split never
  // looks inside a comma clause.
  if (asList && parts.some(part => PREP_CLAUSE_WORDS.has(firstWord(part)))) return null;
  // Two spellings of one thing aren't two things to choose between.
  const keys = parts.map(groceryNameKey);
  if (new Set(keys).size !== keys.length) return null;
  return parts;
}

function firstWord(part: string): string {
  return part.split(/\s+/)[0].toLowerCase();
}

/**
 * Whether a line reads as a comma-separated list of alternatives, which is the
 * one case `splitPrep` has to stand down for: "chicken, beef, or lamb" would
 * otherwise become the name "chicken" with "beef, or lamb" as its prep, and the
 * split this app wants to offer would never be reachable.
 *
 * Narrow on purpose — the plain "or" form ("cheddar or manchego") has no comma
 * for splitPrep to take, so it isn't this function's business.
 */
export function looksLikeAlternativeList(name: string): boolean {
  return OXFORD_OR.test(name) && splitAlternativeNames(name) !== null;
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
 *
 * Purpose ("limes for margs") is read last and **only when no comma clause was
 * taken**, exactly the ordering makeIngredient uses for the same two splits: a
 * prep clause can legitimately contain "for" ("cheese, plus more for topping"
 * is one note, not a name plus a purpose), so the purpose split may only ever
 * look at text no comma has already claimed. Both land in the row's note; the
 * name is the shelf label, which is what the aisle lexicon and the catalog key
 * are matched against, so a purpose left in it mints "limes for margs" as a
 * catalog row nothing you ever buy can match.
 */
export function resolveGroceryTokens(
  raw: string,
  rejected: { quantity: string | null; prep: string | null; purpose: string | null },
): {
  quantity: string | null;
  quantityAccepted: boolean;
  prep: string | null;
  prepAccepted: boolean;
  purpose: string | null;
  purposeAccepted: boolean;
  /** What the split pieces amount to as a row note, or null for nothing to say. */
  note: string | null;
  name: string;
} {
  const trimmed = raw.trim();
  const { name: afterQty, quantity } = parseGroceryInput(trimmed);
  const quantityAccepted = !!quantity && quantity !== rejected.quantity;

  const base = quantityAccepted ? afterQty : trimmed;
  const { name: withoutPrep, prep } = splitPrep(base);
  const prepAccepted = !!prep && prep !== rejected.prep;
  const afterPrep = prepAccepted ? withoutPrep : base;

  const { name: withoutPurpose, purpose } = prepAccepted
    ? { name: afterPrep, purpose: null }
    : splitPurpose(afterPrep);
  const purposeAccepted = !!purpose && purpose !== rejected.purpose;

  const noteParts = [
    prepAccepted ? prep : null,
    // Kept with its "for", the way the user typed it and the way the recipe
    // ingredient list reads it back ("for margs", not "margs") — the word is
    // what makes the clause a purpose rather than a second name.
    purposeAccepted ? `for ${purpose}` : null,
  ].filter(Boolean);

  return {
    quantity,
    quantityAccepted,
    prep,
    prepAccepted,
    purpose,
    purposeAccepted,
    note: noteParts.length > 0 ? noteParts.join(' · ') : null,
    name: purposeAccepted ? withoutPurpose : afterPrep,
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
