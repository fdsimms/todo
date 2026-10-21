/**
 * A guess at which of the common allergens an ingredient list contains, read
 * off the ingredient names with a keyword list.
 *
 * It is a guess and every surface that shows it says so: a name can hide an
 * allergen ("Worcestershire sauce" holds fish, "mayonnaise" holds egg) and a
 * name can read like one that isn't ("coconut milk", "eggplant"). The
 * keywords here cover the plain cases and the false friends most likely to
 * mislead; what they miss stays unlisted, which is why the printout carries
 * a "check labels" line whether or not anything was found. Nothing here is
 * stored: it is read off a recipe each time a page is printed.
 */

export type Allergen = 'milk' | 'eggs' | 'fish' | 'shellfish' | 'tree nuts' | 'peanuts' | 'wheat' | 'soy' | 'sesame';

interface AllergenRule {
  allergen: Allergen;
  /** Words that point to it, matched whole and case-insensitively. */
  words: RegExp;
  /** Phrases that contain a keyword without containing the allergen. */
  notThese?: RegExp;
}

const RULES: AllergenRule[] = [
  {
    allergen: 'milk',
    words: /\b(milk|butter|buttermilk|cream|cheese|cheddar|mozzarella|parmesan|parmigiano|feta|ricotta|mascarpone|yogurt|yoghurt|ghee|whey|casein|custard|paneer|gouda|brie|halloumi|half-and-half)\b/i,
    notThese: /\b(coconut|almond|oat|soy|rice|cashew|cocoa|shea|peanut|almond) (milk|butter|cream|cheese|yogurt)\b|\b(butternut|butterscotch|cream of tartar|vegan|dairy-free|nut)\b/i,
  },
  { allergen: 'eggs', words: /\b(eggs?|egg yolks?|egg whites?|mayo|mayonnaise|meringue|aioli)\b/i, notThese: /\b(eggplants?|vegan mayo|vegan mayonnaise)\b/i },
  { allergen: 'fish', words: /\b(fish|salmon|tuna|cod|anchov(y|ies)|sardines?|tilapia|trout|halibut|haddock|mackerel|fish sauce|worcestershire)\b/i },
  { allergen: 'shellfish', words: /\b(shrimp|prawns?|crab|lobster|crayfish|crawfish|scallops?|clams?|mussels|oysters?|shellfish)\b/i },
  {
    allergen: 'tree nuts',
    words: /\b(almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|macadamias?|pine nuts?|brazil nuts?|marzipan|praline|nutella|amaretto)\b/i,
    notThese: /\bwater chestnuts?\b/i,
  },
  { allergen: 'peanuts', words: /\bpeanuts?\b/i },
  {
    allergen: 'wheat',
    words: /\b(wheat|flour|bread|breadcrumbs?|panko|pasta|orzo|couscous|spaghetti|noodles?|tortillas?|pita|naan|bulgur|farro|semolina|barley|rye|seitan|crackers?|croutons?|macaroni|penne|fettuccine|linguine|lasagna|pizza dough|puff pastry)\b/i,
    notThese: /\b(gluten-free|rice noodles?|rice flour|almond flour|coconut flour|corn tortillas?|chickpea flour|buckwheat)\b/i,
  },
  { allergen: 'soy', words: /\b(soy|soya|soybeans?|tofu|tempeh|edamame|miso|tamari|soy sauce)\b/i },
  { allergen: 'sesame', words: /\b(sesame|tahini)\b/i },
];

const ORDER = RULES.map(r => r.allergen);

/**
 * The allergens that any of `names` appears to contain, in a fixed order so
 * the same recipe always prints the same line. An empty list means none were
 * recognised, not that there are none.
 */
export function guessAllergens(names: readonly string[]): Allergen[] {
  const found = new Set<Allergen>();
  for (const name of names) {
    for (const rule of RULES) {
      if (!rule.words.test(name)) continue;
      if (rule.notThese?.test(name)) continue;
      found.add(rule.allergen);
    }
  }
  return ORDER.filter(a => found.has(a));
}

/** "Contains milk, eggs and wheat", or null when none were recognised. */
export function describeAllergens(allergens: readonly Allergen[]): string | null {
  if (allergens.length === 0) return null;
  const list = allergens.length === 1
    ? allergens[0]
    : `${allergens.slice(0, -1).join(', ')} and ${allergens[allergens.length - 1]}`;
  return `Contains ${list}`;
}
