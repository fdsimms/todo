import { groceryNameKey } from './groceryParse';

/**
 * Where an item sits in the store, and in what order you walk past it.
 *
 * The lexicon is offline and always present: the whole feature has to work
 * with no Anthropic API key, exactly like every other AI-adjacent thing in
 * this app is additive rather than load-bearing. AI only ever fills gaps the
 * lexicon leaves (see suggestGroceryAisles).
 */

// The default walk order — roughly how a supermarket is laid out, perimeter
// first. 'Other' is always last and always exists: aisleForName returning null
// means "not recognised", and an unrecognised item is *in* Other rather than
// aisle-less, which keeps the null branch out of every grouping path.
export const DEFAULT_AISLES = [
  'Produce',
  'Bakery',
  'Deli',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Frozen',
  'Pantry',
  'Canned & Jarred',
  'Snacks',
  'Beverages',
  'Breakfast',
  'Baking & Spices',
  'Household',
  'Personal Care',
  'Other',
] as const;

export const OTHER_AISLE = 'Other';

/**
 * name_key → aisle. A literal object on purpose: a computed one would cost
 * parse time on every cold start for no benefit, and this is imported by the
 * store, which initialises during app startup.
 *
 * Every value here must be a member of DEFAULT_AISLES — a typo would invent a
 * section that nothing renders in order. groceryAisles.test.ts asserts it.
 */
export const AISLE_LEXICON: Record<string, string> = {
  // ─── Produce ───
  apple: 'Produce', apples: 'Produce', avocado: 'Produce', avocados: 'Produce',
  banana: 'Produce', bananas: 'Produce', basil: 'Produce', beet: 'Produce', beets: 'Produce',
  blackberries: 'Produce', blueberries: 'Produce', broccoli: 'Produce',
  'brussels sprouts': 'Produce', cabbage: 'Produce', cantaloupe: 'Produce',
  carrot: 'Produce', carrots: 'Produce', cauliflower: 'Produce', celery: 'Produce',
  cherries: 'Produce', cilantro: 'Produce', corn: 'Produce', cucumber: 'Produce',
  cucumbers: 'Produce', dill: 'Produce', eggplant: 'Produce', garlic: 'Produce',
  ginger: 'Produce', grapefruit: 'Produce', grapes: 'Produce', 'green beans': 'Produce',
  'green onion': 'Produce', 'green onions': 'Produce', herbs: 'Produce', jalapeno: 'Produce',
  kale: 'Produce', kiwi: 'Produce', leek: 'Produce', leeks: 'Produce', lemon: 'Produce',
  lemons: 'Produce', lettuce: 'Produce', lime: 'Produce', limes: 'Produce',
  mango: 'Produce', mint: 'Produce', mushroom: 'Produce', mushrooms: 'Produce',
  nectarines: 'Produce', onion: 'Produce', onions: 'Produce', orange: 'Produce',
  oranges: 'Produce', parsley: 'Produce', parsnip: 'Produce', peach: 'Produce',
  peaches: 'Produce', pear: 'Produce', pears: 'Produce', peppers: 'Produce',
  pineapple: 'Produce', plums: 'Produce', potato: 'Produce', potatoes: 'Produce',
  pumpkin: 'Produce', radish: 'Produce', raspberries: 'Produce', rosemary: 'Produce',
  salad: 'Produce', scallions: 'Produce', shallot: 'Produce', shallots: 'Produce',
  spinach: 'Produce', squash: 'Produce', strawberries: 'Produce', 'sweet potato': 'Produce',
  'sweet potatoes': 'Produce', thyme: 'Produce', tomato: 'Produce', tomatoes: 'Produce',
  watermelon: 'Produce', zucchini: 'Produce',

  // ─── Bakery ───
  bagel: 'Bakery', bagels: 'Bakery', baguette: 'Bakery', bread: 'Bakery',
  'bread rolls': 'Bakery', brioche: 'Bakery', bun: 'Bakery', buns: 'Bakery',
  cake: 'Bakery', ciabatta: 'Bakery', croissant: 'Bakery', croissants: 'Bakery',
  donuts: 'Bakery', focaccia: 'Bakery', muffin: 'Bakery', muffins: 'Bakery',
  naan: 'Bakery', pita: 'Bakery', 'pita bread': 'Bakery', rolls: 'Bakery',
  sourdough: 'Bakery', tortilla: 'Bakery', tortillas: 'Bakery',

  // ─── Deli ───
  bacon: 'Deli', bologna: 'Deli', 'cold cuts': 'Deli', ham: 'Deli', hummus: 'Deli',
  olives: 'Deli', pastrami: 'Deli', pepperoni: 'Deli', prosciutto: 'Deli',
  salami: 'Deli', 'sliced turkey': 'Deli',

  // ─── Meat & Seafood ───
  beef: 'Meat & Seafood', 'chicken breast': 'Meat & Seafood', chicken: 'Meat & Seafood',
  'chicken thighs': 'Meat & Seafood', clams: 'Meat & Seafood', cod: 'Meat & Seafood',
  crab: 'Meat & Seafood', 'ground beef': 'Meat & Seafood', 'ground turkey': 'Meat & Seafood',
  lamb: 'Meat & Seafood', lobster: 'Meat & Seafood', mussels: 'Meat & Seafood',
  pork: 'Meat & Seafood', 'pork chops': 'Meat & Seafood', prawns: 'Meat & Seafood',
  ribs: 'Meat & Seafood', salmon: 'Meat & Seafood', sausage: 'Meat & Seafood',
  sausages: 'Meat & Seafood', scallops: 'Meat & Seafood', shrimp: 'Meat & Seafood',
  steak: 'Meat & Seafood', tilapia: 'Meat & Seafood', tuna: 'Meat & Seafood',
  turkey: 'Meat & Seafood',

  // ─── Dairy & Eggs ───
  butter: 'Dairy & Eggs', brie: 'Dairy & Eggs', cheddar: 'Dairy & Eggs',
  cheese: 'Dairy & Eggs', 'cottage cheese': 'Dairy & Eggs', cream: 'Dairy & Eggs',
  'cream cheese': 'Dairy & Eggs', creamer: 'Dairy & Eggs', egg: 'Dairy & Eggs',
  eggs: 'Dairy & Eggs', feta: 'Dairy & Eggs', 'goat cheese': 'Dairy & Eggs',
  'greek yogurt': 'Dairy & Eggs', 'half and half': 'Dairy & Eggs',
  'heavy cream': 'Dairy & Eggs', kefir: 'Dairy & Eggs', margarine: 'Dairy & Eggs',
  milk: 'Dairy & Eggs', mozzarella: 'Dairy & Eggs', 'oat milk': 'Dairy & Eggs',
  parmesan: 'Dairy & Eggs', ricotta: 'Dairy & Eggs', 'sour cream': 'Dairy & Eggs',
  'soy milk': 'Dairy & Eggs', yoghurt: 'Dairy & Eggs', yogurt: 'Dairy & Eggs',

  // ─── Frozen ───
  'frozen berries': 'Frozen', 'frozen peas': 'Frozen', 'frozen pizza': 'Frozen',
  'frozen vegetables': 'Frozen', 'fish sticks': 'Frozen', 'ice cream': 'Frozen',
  popsicles: 'Frozen', waffles: 'Frozen',

  // ─── Pantry ───
  'almond butter': 'Pantry', 'balsamic vinegar': 'Pantry', barley: 'Pantry',
  breadcrumbs: 'Pantry', broth: 'Pantry', couscous: 'Pantry', honey: 'Pantry',
  ketchup: 'Pantry', lentils: 'Pantry', mayo: 'Pantry', mayonnaise: 'Pantry',
  mustard: 'Pantry', noodles: 'Pantry', oil: 'Pantry', 'olive oil': 'Pantry',
  pasta: 'Pantry', 'peanut butter': 'Pantry', quinoa: 'Pantry', rice: 'Pantry',
  'rice noodles': 'Pantry', salsa: 'Pantry', 'sesame oil': 'Pantry',
  'soy sauce': 'Pantry', spaghetti: 'Pantry', 'sriracha': 'Pantry',
  stock: 'Pantry', syrup: 'Pantry', tahini: 'Pantry', vinegar: 'Pantry',
  'vegetable oil': 'Pantry',

  // ─── Canned & Jarred ───
  'baked beans': 'Canned & Jarred', 'black beans': 'Canned & Jarred',
  'canned corn': 'Canned & Jarred', 'canned tomatoes': 'Canned & Jarred',
  'chickpeas': 'Canned & Jarred', 'coconut milk': 'Canned & Jarred',
  'kidney beans': 'Canned & Jarred', jam: 'Canned & Jarred', jelly: 'Canned & Jarred',
  'pasta sauce': 'Canned & Jarred', pickles: 'Canned & Jarred',
  'refried beans': 'Canned & Jarred', 'tomato paste': 'Canned & Jarred',
  'tomato sauce': 'Canned & Jarred',

  // ─── Snacks ───
  almonds: 'Snacks', cashews: 'Snacks', chips: 'Snacks', chocolate: 'Snacks',
  cookies: 'Snacks', crackers: 'Snacks', 'granola bars': 'Snacks', nuts: 'Snacks',
  peanuts: 'Snacks', popcorn: 'Snacks', pretzels: 'Snacks', 'trail mix': 'Snacks',
  walnuts: 'Snacks',

  // ─── Beverages ───
  beer: 'Beverages', 'coconut water': 'Beverages', coffee: 'Beverages',
  cola: 'Beverages', juice: 'Beverages', kombucha: 'Beverages', lemonade: 'Beverages',
  'orange juice': 'Beverages', seltzer: 'Beverages', soda: 'Beverages',
  'sparkling water': 'Beverages', tea: 'Beverages', water: 'Beverages', wine: 'Beverages',

  // ─── Breakfast ───
  cereal: 'Breakfast', granola: 'Breakfast', oatmeal: 'Breakfast', oats: 'Breakfast',
  'pancake mix': 'Breakfast', 'maple syrup': 'Breakfast',

  // ─── Baking & Spices ───
  'baking powder': 'Baking & Spices', 'baking soda': 'Baking & Spices',
  'brown sugar': 'Baking & Spices', cinnamon: 'Baking & Spices',
  'chocolate chips': 'Baking & Spices', cocoa: 'Baking & Spices', cumin: 'Baking & Spices',
  flour: 'Baking & Spices', 'garlic powder': 'Baking & Spices', nutmeg: 'Baking & Spices',
  oregano: 'Baking & Spices', paprika: 'Baking & Spices', pepper: 'Baking & Spices',
  salt: 'Baking & Spices', sugar: 'Baking & Spices', turmeric: 'Baking & Spices',
  vanilla: 'Baking & Spices', yeast: 'Baking & Spices',

  // ─── Household ───
  batteries: 'Household', bleach: 'Household', 'dish soap': 'Household',
  'dishwasher tablets': 'Household', detergent: 'Household', foil: 'Household',
  'garbage bags': 'Household', 'laundry detergent': 'Household',
  'light bulbs': 'Household', 'paper towels': 'Household', 'parchment paper': 'Household',
  'plastic wrap': 'Household', sponges: 'Household', 'toilet paper': 'Household',
  'trash bags': 'Household', 'ziploc bags': 'Household',

  // ─── Personal Care ───
  'body wash': 'Personal Care', conditioner: 'Personal Care', deodorant: 'Personal Care',
  floss: 'Personal Care', 'hand soap': 'Personal Care', lotion: 'Personal Care',
  razors: 'Personal Care', shampoo: 'Personal Care', 'shaving cream': 'Personal Care',
  soap: 'Personal Care', sunscreen: 'Personal Care', tampons: 'Personal Care',
  toothbrush: 'Personal Care', toothpaste: 'Personal Care', vitamins: 'Personal Care',
};

/**
 * Best guess at which aisle an item belongs to, or null if we don't know.
 *
 * A fixed cascade rather than a fuzzy match, so it's deterministic and
 * testable: the full key first, then the *last* token (English puts the head
 * noun last — "greek yogurt" → "yogurt" → Dairy & Eggs, "frozen peas" is
 * already an exact entry), then any token ("chicken noodle soup" → chicken).
 * Multi-word entries win because the full key is tried first.
 */
export function aisleForName(name: string): string | null {
  const key = groceryNameKey(name);
  if (!key) return null;

  const exact = AISLE_LEXICON[key];
  if (exact) return exact;

  const tokens = key.split(' ');
  if (tokens.length > 1) {
    const last = AISLE_LEXICON[tokens[tokens.length - 1]];
    if (last) return last;
    for (const token of tokens) {
      const hit = AISLE_LEXICON[token];
      if (hit) return hit;
    }
  }

  return null;
}

/**
 * Aisles the user has filed by hand, keyed by `name_key` — the memory that
 * outlives the row.
 *
 * `aisleForName` is a guess about *groceries*; this is a fact about *your*
 * shop, so it wins. It's kept beside the row rather than on it because the row
 * is not guaranteed to survive: a provisional one (never bought) is deleted
 * outright by removeFromList, which is precisely the case this exists for —
 * file "protein powder" under Household, take it off the list, and without
 * this the next add puts it back in Other.
 *
 * Keyed by name_key and not by id for the same reason: the id dies with the
 * row, the name is what gets typed again. That also makes it a *preference*,
 * in `settings` beside the walk order rather than in `grocery_items` — a
 * deleted item is forgotten, but where you'd file it isn't.
 *
 * Returns null when nothing changed, so callers can skip the write.
 */
export function rememberAisles(
  current: Readonly<Record<string, string>>,
  entries: ReadonlyArray<{ nameKey: string; aisle: string }>
): Record<string, string> | null {
  let next: Record<string, string> | null = null;
  for (const { nameKey, aisle } of entries) {
    const key = nameKey.trim();
    const value = aisle.trim();
    // An empty key can't ever be looked up again, and an empty aisle isn't a
    // placement — recording either would just be a row that never matches.
    if (!key || !value) continue;
    if ((next ?? current)[key] === value) continue;
    next = { ...(next ?? current), [key]: value };
  }
  return next;
}

/**
 * Retargets every filing that pointed at `from` onto `to`, so renaming an aisle
 * carries the memory with it — a name typed again after the rename lands in the
 * renamed section rather than falling back to the lexicon's guess.
 *
 * Returns null when nothing matched, so callers can skip the write.
 */
export function remapRememberedAisle(
  current: Readonly<Record<string, string>>,
  from: string,
  to: string
): Record<string, string> | null {
  if (!from || !to || from === to) return null;
  let next: Record<string, string> | null = null;
  for (const [key, aisle] of Object.entries(current)) {
    if (aisle !== from) continue;
    next = next ?? { ...current };
    next[key] = to;
  }
  return next;
}

/**
 * Drops every filing that pointed at a deleted aisle.
 *
 * Deliberately a delete rather than a rewrite to 'Other': the aisle is gone,
 * and recording "the user files chips under Other" is a claim they never made,
 * which would also outrank the lexicon for ever. Forgetting lets the next add
 * guess again.
 */
export function forgetRememberedAisle(
  current: Readonly<Record<string, string>>,
  aisle: string
): Record<string, string> | null {
  if (!aisle) return null;
  let next: Record<string, string> | null = null;
  for (const [key, value] of Object.entries(current)) {
    if (value !== aisle) continue;
    next = next ?? { ...current };
    delete next[key];
  }
  return next;
}

/**
 * Follows a remembered aisle across a rename, so correcting a typo doesn't
 * strand the filing under the misspelling.
 */
export function renameRememberedAisle(
  current: Readonly<Record<string, string>>,
  fromKey: string,
  toKey: string
): Record<string, string> | null {
  const aisle = current[fromKey];
  if (!aisle || fromKey === toKey || !toKey) return null;
  const next = { ...current, [toKey]: aisle };
  delete next[fromKey];
  return next;
}

/**
 * Repairs a stored walk order against what the app and the user's rows
 * actually use, at read time, WITHOUT writing back.
 *
 * That's the whole design: shipping a bigger DEFAULT_AISLES in a later version
 * needs no migration, and can't clobber the order someone spent time arranging
 * to match their store. Order of precedence is the user's stored sequence
 * first, then anything new appended — and 'Other' is forced last however it
 * arrived, because a catch-all in the middle of a walk order is never what
 * anyone meant.
 *
 * `hidden` is what makes deleting or renaming a *built-in* aisle stick: the
 * defaults pass would otherwise put 'Snacks' straight back the next time this
 * runs, and the delete would look like it silently failed. It suppresses only
 * that pass — an aisle a live row still carries comes back regardless, because
 * a section with no place in the order renders unplaced, which is worse than a
 * resurrected name.
 */
export function normalizeAisleOrder(
  stored: string[] | null,
  used: readonly string[] = [],
  hidden: readonly string[] = []
): string[] {
  const suppressed = new Set(hidden);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (aisle: string) => {
    const trimmed = aisle.trim();
    if (!trimmed || trimmed === OTHER_AISLE || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  for (const aisle of stored ?? []) push(aisle);
  for (const aisle of DEFAULT_AISLES) {
    if (!suppressed.has(aisle)) push(aisle);
  }
  // An aisle a row carries but the order has never heard of — a custom one
  // from a device whose settings row didn't survive, or an AI suggestion.
  for (const aisle of used) push(aisle);

  out.push(OTHER_AISLE);
  return out;
}

/**
 * The built-in aisles a saved walk order leaves out — the tombstone list
 * `normalizeAisleOrder` needs to keep a deletion from being undone on the next
 * read. Derived from the order the user just saved rather than tracked
 * separately, so "the list you saved is the list you get" and nothing can drift
 * between the two.
 */
export function hiddenDefaultAisles(order: readonly string[]): string[] {
  const present = new Set(order);
  return DEFAULT_AISLES.filter(a => a !== OTHER_AISLE && !present.has(a));
}

/**
 * Pins a proposed aisle to one that actually exists, falling back to Other.
 *
 * The lexicon and the remembered filings both name aisles by string and neither
 * knows what the user has deleted — so without this, deleting 'Snacks' and then
 * typing "chips" files the new row under 'Snacks' and `normalizeAisleOrder`'s
 * `used` pass dutifully brings the section back.
 */
export function placeAisle(aisle: string | null | undefined, order: readonly string[]): string {
  if (!aisle) return OTHER_AISLE;
  // An empty order means nothing has loaded yet, not that every aisle is gone.
  if (order.length === 0) return aisle;
  return order.includes(aisle) ? aisle : OTHER_AISLE;
}
