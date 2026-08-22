/**
 * Reading a barcode source's own category as one of our aisles.
 *
 * **A last resort, deliberately below `aisleForName`.** The name lexicon is a
 * hand-written map of grocery words the user's own vocabulary shares; this is a
 * foreign taxonomy that happens to be about the same shelves. So the scan path
 * asks the user's remembered aisle first, then the name, then this — which
 * means it can only improve a row that would otherwise land in `Other`, and can
 * never move one the lexicon already places correctly. Nine realistic product
 * names run through `aisleForName` put four of them in `Other`
 * ("Oatly Oat Drink Barista Edition", "Cheez-It Original", "Beyond Burger
 * Plant-Based Patties", "Bounty Select-A-Size Paper Towels"); those four are
 * the entire point of this file.
 *
 * **One table for three vocabularies, not three tables.** Open Food Facts gives
 * dehyphenated tags ("vegan sausages"), FoodData Central gives shelf labels
 * ("Ice Cream & Frozen Yogurt"), Go-UPC gives a breadcrumb path ("Food,
 * Beverages & Tobacco > Food Items > Snack Foods"). Normalised to lowercase
 * words they are the same kind of string, and a phrase that means Frozen in one
 * means Frozen in all three. Three tables would be three places to add "gelato".
 */

/**
 * The table is written in the singular and every source pluralises: OFF files
 * "vegan sausages" and "oat milks", FDC "Breads & Buns". Rather than a stemmer
 * (which turns "cookies" into "cooky" as readily as "patties" into "patty"),
 * each phrase is simply tried with each of these on the end. Irregulars that
 * this can't reach get their own row in the table.
 */
const PLURAL_SUFFIXES = ['', 's', 'es'];

/** Word characters only, so `>`, `&` and commas stop separating differently per source. */
function normalizeCategory(raw: string): string {
  return ` ${raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/**
 * Phrase → aisle, **checked in order, first hit winning**. The order is the
 * data structure here, not an accident of editing:
 *
 * 1. Compounds whose head word means something else on its own — "ice cream"
 *    before "cream", "paper towel" before "towel".
 * 2. Words that name a *shelf* regardless of the food — "frozen" beats
 *    "vegetable", because frozen peas are in Frozen.
 * 3. The non-food aisles, whose words ("shampoo", "detergent") are unambiguous
 *    and shouldn't be reachable by a later food phrase.
 * 4. Foods, specific before general.
 *
 * Matched as whole words against a space-padded string, so "oil" cannot fire
 * inside "boiled" and "tea" cannot fire inside "steamed".
 */
export const CATEGORY_AISLES: ReadonlyArray<readonly [string, string]> = [
  // 1 + 2 — compounds and shelf-naming modifiers.
  ['ice cream', 'Frozen'],
  ['frozen yogurt', 'Frozen'],
  ['frozen', 'Frozen'],
  ['gelato', 'Frozen'],
  ['sorbet', 'Frozen'],
  ['popsicle', 'Frozen'],

  // 3 — non-food.
  ['paper towel', 'Household'],
  ['toilet paper', 'Household'],
  ['laundry', 'Household'],
  ['detergent', 'Household'],
  ['dishwashing', 'Household'],
  ['cleaner', 'Household'],
  ['cleaning', 'Household'],
  ['trash bag', 'Household'],
  ['aluminium foil', 'Household'],
  ['aluminum foil', 'Household'],
  ['napkin', 'Household'],
  ['household', 'Household'],
  ['shampoo', 'Personal Care'],
  ['conditioner', 'Personal Care'],
  ['toothpaste', 'Personal Care'],
  ['deodorant', 'Personal Care'],
  ['lotion', 'Personal Care'],
  ['razor', 'Personal Care'],
  ['soap', 'Personal Care'],
  ['personal care', 'Personal Care'],
  ['hygiene', 'Personal Care'],
  ['cosmetic', 'Personal Care'],
  ['beauty', 'Personal Care'],

  // 4 — foods.
  ['deli', 'Deli'],
  ['charcuterie', 'Deli'],
  ['cold cut', 'Deli'],
  ['sausage', 'Meat & Seafood'],
  ['frankfurter', 'Meat & Seafood'],
  ['bacon', 'Meat & Seafood'],
  ['meat', 'Meat & Seafood'],
  ['beef', 'Meat & Seafood'],
  ['pork', 'Meat & Seafood'],
  ['poultry', 'Meat & Seafood'],
  ['chicken', 'Meat & Seafood'],
  ['turkey', 'Meat & Seafood'],
  ['seafood', 'Meat & Seafood'],
  ['fish', 'Meat & Seafood'],
  ['salmon', 'Meat & Seafood'],
  ['shrimp', 'Meat & Seafood'],
  ['burger', 'Meat & Seafood'],
  ['patty', 'Meat & Seafood'],
  ['patties', 'Meat & Seafood'],
  ['tofu', 'Meat & Seafood'],
  ['tempeh', 'Meat & Seafood'],
  ['seitan', 'Meat & Seafood'],
  ['bread', 'Bakery'],
  ['bun', 'Bakery'],
  ['bagel', 'Bakery'],
  ['tortilla', 'Bakery'],
  ['pastry', 'Bakery'],
  ['croissant', 'Bakery'],
  ['muffin', 'Bakery'],
  ['cake', 'Bakery'],
  ['bakery', 'Bakery'],
  ['cheese', 'Dairy & Eggs'],
  ['yogurt', 'Dairy & Eggs'],
  ['yoghurt', 'Dairy & Eggs'],
  ['butter', 'Dairy & Eggs'],
  ['cream', 'Dairy & Eggs'],
  ['egg', 'Dairy & Eggs'],
  ['dairy', 'Dairy & Eggs'],
  ['milk', 'Dairy & Eggs'],
  ['cereal', 'Breakfast'],
  ['granola', 'Breakfast'],
  ['oatmeal', 'Breakfast'],
  ['pancake', 'Breakfast'],
  ['syrup', 'Breakfast'],
  ['breakfast', 'Breakfast'],
  ['snack', 'Snacks'],
  ['chip', 'Snacks'],
  ['crisp', 'Snacks'],
  ['cracker', 'Snacks'],
  ['candy', 'Snacks'],
  ['chocolate', 'Snacks'],
  ['confection', 'Snacks'],
  ['cookie', 'Snacks'],
  ['biscuit', 'Snacks'],
  ['popcorn', 'Snacks'],
  ['pretzel', 'Snacks'],
  ['water', 'Beverages'],
  ['juice', 'Beverages'],
  ['soda', 'Beverages'],
  ['soft drink', 'Beverages'],
  ['coffee', 'Beverages'],
  ['tea', 'Beverages'],
  ['beer', 'Beverages'],
  ['wine', 'Beverages'],
  ['beverage', 'Beverages'],
  ['drink', 'Beverages'],
  ['canned', 'Canned & Jarred'],
  ['tinned', 'Canned & Jarred'],
  ['jarred', 'Canned & Jarred'],
  ['pickle', 'Canned & Jarred'],
  ['preserve', 'Canned & Jarred'],
  ['baking', 'Baking & Spices'],
  ['flour', 'Baking & Spices'],
  ['sugar', 'Baking & Spices'],
  ['spice', 'Baking & Spices'],
  ['seasoning', 'Baking & Spices'],
  ['yeast', 'Baking & Spices'],
  ['fruit', 'Produce'],
  ['vegetable', 'Produce'],
  ['produce', 'Produce'],
  ['salad', 'Produce'],
  ['pasta', 'Pantry'],
  ['noodle', 'Pantry'],
  ['rice', 'Pantry'],
  ['sauce', 'Pantry'],
  ['condiment', 'Pantry'],
  ['oil', 'Pantry'],
  ['vinegar', 'Pantry'],
  ['bean', 'Pantry'],
  ['legume', 'Pantry'],
  ['soup', 'Pantry'],
  ['grain', 'Pantry'],
];

/**
 * The aisle a source's category names, or null when none of them does.
 *
 * Null rather than `Other`, matching `aisleForName`: this is one guess in a
 * chain, and the caller is what decides where a row with no answer at all
 * lands. Never returns an aisle outside `DEFAULT_AISLES`, so `placeAisle` still
 * has the last word on whether that aisle currently exists.
 */
export function aisleForProductCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  const haystack = normalizeCategory(category);
  if (haystack.trim() === '') return null;
  for (const [phrase, aisle] of CATEGORY_AISLES) {
    for (const suffix of PLURAL_SUFFIXES) {
      if (haystack.includes(` ${phrase}${suffix} `)) return aisle;
    }
  }
  return null;
}
