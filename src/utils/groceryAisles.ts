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
 * Whether `item`'s aisle has been flagged as not food (see
 * `useGroceryStore.nonFoodAisles`) — the gate every automatic nutrition/
 * food-log prompt checks before treating a catalog row as something to eat.
 * Aisle names are free text with no fixed non-food set, so this is a lookup
 * against what the user has actually flagged, never a guess from the name.
 */
export function isNonFoodAisle(aisle: string, nonFoodAisles: readonly string[]): boolean {
  return nonFoodAisles.includes(aisle);
}

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
  apple: 'Produce', apples: 'Produce', apricot: 'Produce', apricots: 'Produce',
  artichoke: 'Produce', artichokes: 'Produce', arugula: 'Produce',
  asparagus: 'Produce', avocado: 'Produce', avocados: 'Produce',
  banana: 'Produce', bananas: 'Produce', basil: 'Produce', beet: 'Produce', beets: 'Produce',
  blackberries: 'Produce', blackberry: 'Produce', blueberries: 'Produce',
  broccoli: 'Produce', broccolini: 'Produce',
  'brussels sprouts': 'Produce', cabbage: 'Produce', cantaloupe: 'Produce',
  carrot: 'Produce', carrots: 'Produce', cauliflower: 'Produce', celery: 'Produce', chard: 'Produce',
  cherries: 'Produce', chives: 'Produce', cilantro: 'Produce', corn: 'Produce', cucumber: 'Produce',
  cucumbers: 'Produce', dill: 'Produce', eggplant: 'Produce', endive: 'Produce', fennel: 'Produce',
  garlic: 'Produce',
  ginger: 'Produce', grapefruit: 'Produce', grapes: 'Produce', 'green beans': 'Produce',
  'green onion': 'Produce', 'green onions': 'Produce', herbs: 'Produce', honeydew: 'Produce',
  jalapeno: 'Produce',
  kale: 'Produce', kiwi: 'Produce', leek: 'Produce', leeks: 'Produce', lemon: 'Produce',
  lemons: 'Produce', lettuce: 'Produce', lime: 'Produce', limes: 'Produce',
  mango: 'Produce', melon: 'Produce', mint: 'Produce', mushroom: 'Produce', mushrooms: 'Produce',
  nectarines: 'Produce', okra: 'Produce', onion: 'Produce', onions: 'Produce', orange: 'Produce',
  oranges: 'Produce', parsley: 'Produce', parsnip: 'Produce', peach: 'Produce',
  peaches: 'Produce', pear: 'Produce', pears: 'Produce', peppers: 'Produce',
  // Explicit multi-word overrides: 'pepper' alone is Baking & Spices (ground
  // pepper), so "bell pepper" etc. would otherwise resolve via the last-token
  // fallback to the wrong aisle entirely, same as "ice cream" needs its own
  // entry to beat plain "cream".
  'bell pepper': 'Produce', 'red pepper': 'Produce', 'green pepper': 'Produce',
  'yellow pepper': 'Produce', 'orange pepper': 'Produce', 'chili pepper': 'Produce',
  'jalapeno pepper': 'Produce', 'poblano pepper': 'Produce', 'serrano pepper': 'Produce',
  'habanero pepper': 'Produce', 'banana pepper': 'Produce', 'sweet pepper': 'Produce',
  pineapple: 'Produce', plum: 'Produce', plums: 'Produce', potato: 'Produce', potatoes: 'Produce',
  pumpkin: 'Produce', radicchio: 'Produce', radish: 'Produce', radishes: 'Produce',
  raspberries: 'Produce', raspberry: 'Produce', rosemary: 'Produce',
  salad: 'Produce', scallions: 'Produce', shallot: 'Produce', shallots: 'Produce',
  spinach: 'Produce', sprouts: 'Produce', squash: 'Produce', strawberries: 'Produce',
  'sweet potato': 'Produce',
  'sweet potatoes': 'Produce', thyme: 'Produce', tomato: 'Produce', tomatoes: 'Produce',
  turnip: 'Produce', turnips: 'Produce', watermelon: 'Produce', zucchini: 'Produce',

  // ─── Bakery ───
  bagel: 'Bakery', bagels: 'Bakery', baguette: 'Bakery', biscuit: 'Bakery', biscuits: 'Bakery',
  bread: 'Bakery',
  'bread rolls': 'Bakery', brioche: 'Bakery', bun: 'Bakery', buns: 'Bakery',
  cake: 'Bakery', ciabatta: 'Bakery', croissant: 'Bakery', croissants: 'Bakery',
  donuts: 'Bakery', doughnut: 'Bakery', doughnuts: 'Bakery', focaccia: 'Bakery',
  muffin: 'Bakery', muffins: 'Bakery',
  naan: 'Bakery', pastry: 'Bakery', pastries: 'Bakery', pie: 'Bakery',
  pita: 'Bakery', 'pita bread': 'Bakery', rolls: 'Bakery',
  sourdough: 'Bakery', tortilla: 'Bakery', tortillas: 'Bakery',

  // ─── Deli ───
  bacon: 'Deli', bologna: 'Deli', 'cold cuts': 'Deli', 'deli meat': 'Deli', ham: 'Deli',
  hummus: 'Deli', 'lunch meat': 'Deli', mortadella: 'Deli',
  olives: 'Deli', pastrami: 'Deli', pepperoni: 'Deli', prosciutto: 'Deli',
  salami: 'Deli', 'sliced turkey': 'Deli',

  // ─── Meat & Seafood ───
  anchovies: 'Meat & Seafood',
  beef: 'Meat & Seafood', brisket: 'Meat & Seafood',
  calamari: 'Meat & Seafood', catfish: 'Meat & Seafood',
  'chicken breast': 'Meat & Seafood', chicken: 'Meat & Seafood',
  'chicken thighs': 'Meat & Seafood', clams: 'Meat & Seafood', cod: 'Meat & Seafood',
  crab: 'Meat & Seafood', duck: 'Meat & Seafood',
  frankfurter: 'Meat & Seafood', frankfurters: 'Meat & Seafood',
  'ground beef': 'Meat & Seafood', 'ground turkey': 'Meat & Seafood',
  haddock: 'Meat & Seafood', halibut: 'Meat & Seafood',
  hamburger: 'Meat & Seafood', 'hot dog': 'Meat & Seafood', 'hot dogs': 'Meat & Seafood',
  lamb: 'Meat & Seafood', lobster: 'Meat & Seafood',
  mackerel: 'Meat & Seafood', meatballs: 'Meat & Seafood', mussels: 'Meat & Seafood',
  octopus: 'Meat & Seafood', oysters: 'Meat & Seafood',
  pork: 'Meat & Seafood', 'pork chops': 'Meat & Seafood', prawns: 'Meat & Seafood',
  ribs: 'Meat & Seafood', salmon: 'Meat & Seafood', sardines: 'Meat & Seafood', sausage: 'Meat & Seafood',
  sausages: 'Meat & Seafood', scallops: 'Meat & Seafood', shrimp: 'Meat & Seafood',
  sole: 'Meat & Seafood', squid: 'Meat & Seafood', steak: 'Meat & Seafood',
  swordfish: 'Meat & Seafood', tilapia: 'Meat & Seafood', trout: 'Meat & Seafood', tuna: 'Meat & Seafood',
  turkey: 'Meat & Seafood', veal: 'Meat & Seafood', venison: 'Meat & Seafood',

  // ─── Dairy & Eggs ───
  butter: 'Dairy & Eggs', brie: 'Dairy & Eggs', buttermilk: 'Dairy & Eggs', cheddar: 'Dairy & Eggs',
  cheese: 'Dairy & Eggs', 'colby jack': 'Dairy & Eggs', 'cottage cheese': 'Dairy & Eggs',
  cream: 'Dairy & Eggs',
  'cream cheese': 'Dairy & Eggs', creamer: 'Dairy & Eggs', egg: 'Dairy & Eggs',
  eggs: 'Dairy & Eggs', feta: 'Dairy & Eggs', 'goat cheese': 'Dairy & Eggs', gouda: 'Dairy & Eggs',
  'greek yogurt': 'Dairy & Eggs', 'half and half': 'Dairy & Eggs',
  // "half & half" normalises to "half half" (the ampersand becomes a space),
  // which is a different key from "half and half" above — both need an entry.
  'half half': 'Dairy & Eggs',
  'heavy cream': 'Dairy & Eggs', kefir: 'Dairy & Eggs', margarine: 'Dairy & Eggs',
  milk: 'Dairy & Eggs', mozzarella: 'Dairy & Eggs', 'oat milk': 'Dairy & Eggs',
  parmesan: 'Dairy & Eggs', provolone: 'Dairy & Eggs', ricotta: 'Dairy & Eggs',
  'sour cream': 'Dairy & Eggs',
  'soy milk': 'Dairy & Eggs', yoghurt: 'Dairy & Eggs', yogurt: 'Dairy & Eggs',

  // ─── Frozen ───
  'frozen berries': 'Frozen', 'frozen burritos': 'Frozen', 'frozen dinner': 'Frozen',
  'frozen fries': 'Frozen', 'frozen fruit': 'Frozen', 'frozen peas': 'Frozen', 'frozen pizza': 'Frozen',
  'frozen vegetables': 'Frozen', 'fish sticks': 'Frozen', 'french fries': 'Frozen',
  'ice cream': 'Frozen',
  popsicles: 'Frozen', sorbet: 'Frozen', 'tater tots': 'Frozen', waffles: 'Frozen',

  // ─── Pantry ───
  'almond butter': 'Pantry', 'balsamic vinegar': 'Pantry', barley: 'Pantry',
  'bbq sauce': 'Pantry',
  breadcrumbs: 'Pantry', broth: 'Pantry', 'cooking spray': 'Pantry', couscous: 'Pantry',
  'fish sauce': 'Pantry', honey: 'Pantry', 'hot sauce': 'Pantry',
  ketchup: 'Pantry', lentils: 'Pantry', linguine: 'Pantry', macaroni: 'Pantry',
  mayo: 'Pantry', mayonnaise: 'Pantry',
  mustard: 'Pantry', noodles: 'Pantry', oil: 'Pantry', 'olive oil': 'Pantry',
  'oyster sauce': 'Pantry',
  panko: 'Pantry',
  pasta: 'Pantry', 'peanut butter': 'Pantry', penne: 'Pantry', quinoa: 'Pantry', ramen: 'Pantry',
  rice: 'Pantry',
  'rice noodles': 'Pantry', salsa: 'Pantry', 'sesame oil': 'Pantry',
  'soy sauce': 'Pantry',
  // "spaghetti sauce" would otherwise fall through to the any-token loop and
  // hit "spaghetti" (Pantry) before it ever tries "sauce" — it means the same
  // jarred sauce as "pasta sauce" below, so it gets the same aisle.
  'spaghetti sauce': 'Canned & Jarred',
  spaghetti: 'Pantry', 'sriracha': 'Pantry',
  stock: 'Pantry', syrup: 'Pantry', tahini: 'Pantry', vinegar: 'Pantry',
  'vegetable oil': 'Pantry', 'worcestershire sauce': 'Pantry',

  // ─── Canned & Jarred ───
  'alfredo sauce': 'Canned & Jarred', applesauce: 'Canned & Jarred',
  'baked beans': 'Canned & Jarred', 'black beans': 'Canned & Jarred',
  // Canned fruit and canned/jarred tomato prep both name a fresh-produce word
  // as their last token ("peaches", "tomatoes"), so without an explicit entry
  // they'd resolve to Produce instead of the shelf they're actually sold on —
  // same reasoning as the two 'canned' entries already here.
  'canned corn': 'Canned & Jarred', 'canned peaches': 'Canned & Jarred',
  'canned pineapple': 'Canned & Jarred', 'canned tomatoes': 'Canned & Jarred',
  'chickpeas': 'Canned & Jarred', 'coconut milk': 'Canned & Jarred',
  'crushed tomatoes': 'Canned & Jarred', 'diced tomatoes': 'Canned & Jarred',
  'garbanzo beans': 'Canned & Jarred',
  'kidney beans': 'Canned & Jarred', jam: 'Canned & Jarred', jelly: 'Canned & Jarred',
  'marinara sauce': 'Canned & Jarred', marmalade: 'Canned & Jarred',
  'pasta sauce': 'Canned & Jarred', pickles: 'Canned & Jarred',
  'pinto beans': 'Canned & Jarred',
  'refried beans': 'Canned & Jarred', 'tomato paste': 'Canned & Jarred',
  'tomato sauce': 'Canned & Jarred',

  // ─── Snacks ───
  almonds: 'Snacks', 'beef jerky': 'Snacks',
  cashews: 'Snacks', chips: 'Snacks', chocolate: 'Snacks',
  cookies: 'Snacks', crackers: 'Snacks', 'dried fruit': 'Snacks',
  'fruit snacks': 'Snacks', 'granola bar': 'Snacks', 'granola bars': 'Snacks',
  jerky: 'Snacks', nuts: 'Snacks',
  peanuts: 'Snacks', pecans: 'Snacks', pistachios: 'Snacks', popcorn: 'Snacks',
  'pretzel': 'Snacks', pretzels: 'Snacks',
  'protein bar': 'Snacks', 'protein bars': 'Snacks',
  raisins: 'Snacks',
  // "rice cakes" would otherwise fall through to the any-token loop and hit
  // plain "rice" (Pantry) before it ever tries "cakes".
  'rice cakes': 'Snacks',
  'trail mix': 'Snacks',
  walnuts: 'Snacks',

  // ─── Beverages ───
  beer: 'Beverages', champagne: 'Beverages', 'coconut water': 'Beverages', coffee: 'Beverages',
  cola: 'Beverages', 'energy drink': 'Beverages', gatorade: 'Beverages',
  juice: 'Beverages', kombucha: 'Beverages', lemonade: 'Beverages',
  'orange juice': 'Beverages', rum: 'Beverages', seltzer: 'Beverages', soda: 'Beverages',
  'sparkling water': 'Beverages', 'sports drink': 'Beverages',
  tea: 'Beverages', vodka: 'Beverages', water: 'Beverages', whiskey: 'Beverages', wine: 'Beverages',

  // ─── Breakfast ───
  'breakfast bar': 'Breakfast',
  cereal: 'Breakfast', granola: 'Breakfast', oatmeal: 'Breakfast', oats: 'Breakfast',
  // "pancake syrup" needs the same override plain "maple syrup" already has —
  // bare "syrup" is a Pantry entry, so without one both would resolve there.
  'pancake mix': 'Breakfast', 'pancake syrup': 'Breakfast', 'maple syrup': 'Breakfast',

  // ─── Baking & Spices ───
  allspice: 'Baking & Spices',
  'baking powder': 'Baking & Spices', 'baking soda': 'Baking & Spices',
  'bay leaves': 'Baking & Spices',
  'brown sugar': 'Baking & Spices', 'chili powder': 'Baking & Spices', cinnamon: 'Baking & Spices',
  'chocolate chips': 'Baking & Spices', cloves: 'Baking & Spices', cocoa: 'Baking & Spices',
  cornstarch: 'Baking & Spices', cumin: 'Baking & Spices',
  'food coloring': 'Baking & Spices',
  flour: 'Baking & Spices', 'garlic powder': 'Baking & Spices', nutmeg: 'Baking & Spices',
  // "onion powder" would otherwise fall through to the any-token loop and hit
  // plain "onion" (Produce) before ever reaching a spice — same override
  // pattern "garlic powder" above has always needed.
  'onion powder': 'Baking & Spices',
  oregano: 'Baking & Spices', paprika: 'Baking & Spices', pepper: 'Baking & Spices',
  salt: 'Baking & Spices', sugar: 'Baking & Spices', turmeric: 'Baking & Spices',
  vanilla: 'Baking & Spices', yeast: 'Baking & Spices',

  // ─── Household ───
  'air freshener': 'Household', 'all purpose cleaner': 'Household',
  batteries: 'Household', bleach: 'Household', 'dish soap': 'Household',
  'dishwasher tablets': 'Household', detergent: 'Household', 'dryer sheets': 'Household',
  'fabric softener': 'Household', foil: 'Household',
  'garbage bags': 'Household', 'glass cleaner': 'Household',
  'laundry detergent': 'Household', 'light bulb': 'Household',
  'light bulbs': 'Household', matches: 'Household', napkins: 'Household',
  'paper cups': 'Household', 'paper plates': 'Household',
  'paper towels': 'Household', 'parchment paper': 'Household',
  'plastic wrap': 'Household', 'stain remover': 'Household', sponges: 'Household',
  'toilet paper': 'Household',
  'trash bags': 'Household', 'trash can liners': 'Household', 'ziploc bags': 'Household',

  // ─── Personal Care ───
  aspirin: 'Personal Care', 'baby wipes': 'Personal Care', chapstick: 'Personal Care',
  'cotton balls': 'Personal Care', 'cotton swabs': 'Personal Care',
  diapers: 'Personal Care', 'facial tissue': 'Personal Care',
  'hand sanitizer': 'Personal Care', ibuprofen: 'Personal Care',
  'lip balm': 'Personal Care', mouthwash: 'Personal Care', 'nail polish': 'Personal Care',
  tissues: 'Personal Care',
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
 * is not guaranteed to survive: `clearList` sweeps a row carrying nothing (see
 * `hasUserFacts`), and `deleteItem` takes any row at all — file "protein
 * powder" under Household, abandon the trip, and without this the next add
 * puts it back in Other.
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
