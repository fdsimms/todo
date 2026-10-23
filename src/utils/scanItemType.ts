import { GROCERY_NAME_MAX_LENGTH, GROCERY_VARIANT_MAX_LENGTH } from '../types';
import { groceryNameKey } from './groceryParse';
import { shopperNameFor, variantFor } from './scanResolve';

/**
 * What kind of thing a scanned product is ("Ice cream"), as opposed to what the
 * barcode database calls it ("Black Tie Tiramisu").
 *
 * A product's own name is mostly its flavor or line, so filing the item under it
 * puts "Black Tie Tiramisu" on the list where the shopper wrote "ice cream". The
 * type comes from two places, tried in this order by the sheet: the source's own
 * category (this file, offline) and then a model (`suggestItemType`, only when
 * the category had nothing usable). **Both are only ever offered, never applied**:
 * a source's category is often a department rather than a noun, and a model can
 * be confidently wrong, so a tap on a chip is what renames a row.
 */

/** Packaging a category sometimes names after the food: "ice cream tubs". */
const PACKAGING = new Set([
  'tub', 'tubs', 'bottle', 'bottles', 'can', 'cans', 'jar', 'jars', 'box', 'boxes',
  'bag', 'bags', 'pack', 'packs', 'pouch', 'pouches', 'carton', 'cartons',
  'container', 'containers', 'packaged',
]);

/**
 * Last words that mean a department rather than a thing: "snacks" holds a
 * hundred different items and naming a row after it is worse than the barcode's
 * own name.
 */
const DEPARTMENT_WORDS = new Set([
  'food', 'foods', 'product', 'products', 'item', 'items', 'goods', 'beverage',
  'beverages', 'drink', 'drinks', 'snack', 'snacks', 'dessert', 'desserts', 'meal',
  'meals', 'grocery', 'groceries', 'dairy', 'spread', 'spreads', 'sweet', 'sweets',
]);

/**
 * Categories are plural by convention in the sources that supply them ("ice
 * creams", "cheeses"), but a list item is "Ice cream". Only these singularize,
 * because a rule that did every word would turn "chips" into "chip" and
 * "noodles" into "noodle", which are the names people actually use.
 */
const MASS_NOUN_SINGULAR: Record<string, string> = {
  creams: 'cream', cheeses: 'cheese', yogurts: 'yogurt', yoghurts: 'yogurt', breads: 'bread',
  milks: 'milk', juices: 'juice', waters: 'water', sodas: 'soda', butters: 'butter',
  cereals: 'cereal', chocolates: 'chocolate', coffees: 'coffee', teas: 'tea', sauces: 'sauce',
  soups: 'soup', oils: 'oil', vinegars: 'vinegar', wines: 'wine', beers: 'beer', jams: 'jam',
  honeys: 'honey', pastas: 'pasta', rices: 'rice', flours: 'flour', sugars: 'sugar',
  salts: 'salt', sorbets: 'sorbet', gelatos: 'gelato', hummuses: 'hummus', kefirs: 'kefir',
  crackers: 'cracker', granolas: 'granola', ketchups: 'ketchup', mustards: 'mustard',
  mayonnaises: 'mayonnaise', salsas: 'salsa', pizzas: 'pizza', sausages: 'sausage',
};

function sentenceCase(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * A usable item type out of a barcode source's category, or null when it holds
 * none. Refusing is the normal outcome and the safe one: a category that lists
 * several things ("Chips, Pretzels & Snacks"), names a department ("snacks") or
 * isn't a short noun phrase has no single name to offer, and the model takes
 * those.
 *
 * `category` arrives already reduced by `productLookup`: Open Food Facts' most
 * specific tag with hyphens as spaces, or another source's own string, which may
 * be a `>` hierarchy.
 */
export function itemTypeFromCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  const parts = category.toLowerCase().split('>').map(p => p.trim()).filter(Boolean);
  const phrase = parts[parts.length - 1];
  if (!phrase) return null;
  if (/[/,&;:()\d]|\b(and|or|other|misc|miscellaneous|assorted|various)\b/.test(phrase)) return null;
  let words = phrase.split(/\s+/).filter(Boolean);
  while (words.length > 0 && PACKAGING.has(words[words.length - 1])) words = words.slice(0, -1);
  while (words.length > 0 && PACKAGING.has(words[0])) words = words.slice(1);
  if (words.length === 0 || words.length > 3) return null;
  const last = words[words.length - 1];
  if (DEPARTMENT_WORDS.has(last)) return null;
  words[words.length - 1] = MASS_NOUN_SINGULAR[last] ?? last;
  const type = words.join(' ').slice(0, GROCERY_NAME_MAX_LENGTH);
  return sentenceCase(type);
}

/**
 * A model's answer reduced to a name worth offering, or null. The model is told
 * what shape to answer in and this is the layer that doesn't believe it: no
 * digits, no sentence, a handful of words, and never the brand, which is the
 * mistake a small model makes most ("Jeni's" for Jeni's ice cream).
 */
export function cleanModelItemType(raw: unknown, brand: string | null): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/^["'“”]+|["'“”.]+$/g, '').replace(/\s+/g, ' ');
  if (!text || /\d/.test(text) || /[,;:!?/]/.test(text)) return null;
  if (text.split(' ').length > 3) return null;
  const maker = brand?.trim().toLowerCase();
  if (maker && text.toLowerCase() === maker) return null;
  return sentenceCase(text.slice(0, GROCERY_NAME_MAX_LENGTH).toLowerCase());
}

/**
 * The catalog's own spelling of a type, when it already has that item, so a
 * suggestion for "Ice cream" lands on the "Ice Cream" row rather than minting a
 * second one. Compared by `groceryNameKey`, the key the store refuses duplicates on.
 */
export function catalogSpellingOf(type: string, catalogNames: readonly string[]): string {
  const key = groceryNameKey(type);
  return catalogNames.find(n => groceryNameKey(n) === key) ?? type;
}

/** Crude, and the same crudeness `receiptMatch.ts` tolerates: "eggs" meets "egg". */
function stem(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/**
 * Whether the shopper name already says what the thing is. "Whole Milk" scanned
 * with the type "Milk" has nothing to add, and a chip on every row would be
 * noise the person learns to ignore. Every word of the type has to appear.
 */
function nameSaysType(name: string, type: string): boolean {
  const have = new Set(name.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean).map(stem));
  const want = type.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean).map(stem);
  return want.length > 0 && want.every(w => have.has(w));
}

/** What tapping the chip writes: the type as the name, the product's words as the variant. */
export interface ItemTypeMove {
  name: string;
  variant: string;
}

/**
 * The rename a type suggestion would make for a scanned row, or null when it
 * shouldn't be offered at all.
 *
 * Not offered once the person has touched the name or the variant (they have
 * already answered what this is), when the name already contains the type, or
 * when there is no product wording to move.
 */
export function itemTypeMoveFor(
  row: {
    gtin: string | null;
    label: string;
    brand: string | null;
    name: string;
    variantEdit?: string;
  },
  type: string | null | undefined,
): ItemTypeMove | null {
  const typeName = type?.trim();
  if (!typeName || !row.gtin || !row.label || row.variantEdit !== undefined) return null;
  const proposed = shopperNameFor(row.label, row.brand);
  if (!proposed || row.name.trim() !== proposed) return null;
  if (nameSaysType(proposed, typeName)) return null;
  const variant = variantFor(row.label, row.brand, typeName) ?? proposed;
  return { name: typeName, variant: variant.slice(0, GROCERY_VARIANT_MAX_LENGTH) };
}
