import type { FoodKind, GroceryItem } from '../types';
import { FRUITS, LEGUMES, NON_PULSE_BEAN, VEGETABLES, stems, tokensOf } from './produceServings';

/**
 * What kind of food a catalog item is, for filling a recipe's blank ("a grain",
 * "any vegetables"; see `RecipeBlank`).
 *
 * **A guess from the name, which the person can overrule per item.** The guess
 * is what makes a blank useful on day one: nobody files sixty catalog rows
 * before a grain bowl works. The override (`GroceryItem.foodKinds`) is what
 * makes it honest, because a lexicon will always meet a "tofurky". Same split
 * the aisle lexicon makes with a person's own filings.
 *
 * **The head noun decides.** The last word of a name is what the thing is, and
 * the words before it say which one: "oat milk" is milk, "vegan popcorn
 * chicken" is chicken, "vegan fish sauce" is a sauce. A head this file doesn't
 * know falls back to the first word it does ("Cashews Dill Pickle Flavored" is
 * cashews), and a head that names a form rather than a food ("chicken stock",
 * "protein powder", "tortilla chips") stops the guess outright, since a
 * fallback past it would find the food the form was made of.
 *
 * **A wrong guess is worse than none**, the rule `useUpRecipes` states for the
 * same reason: being offered a battery as a vegetable is how a feature gets
 * switched off. So the lists are short and literal, and anything unknown is no
 * kind at all. Non-food aisles are the caller's to filter (`isNonFoodAisle`).
 */

export const FOOD_KINDS: readonly FoodKind[] = [
  'grain', 'protein', 'vegetable', 'legume', 'fruit', 'dairy', 'nuts', 'sauce', 'herb',
];

/** What a kind is called on screen, as a heading and in the editor's picker. */
export const FOOD_KIND_LABELS: Record<FoodKind, string> = {
  grain: 'Grains & starches',
  protein: 'Protein',
  vegetable: 'Vegetables',
  legume: 'Beans & lentils',
  fruit: 'Fruit',
  dairy: 'Cheese & yogurt',
  nuts: 'Nuts & seeds',
  sauce: 'Sauces',
  herb: 'Herbs',
};

const GRAINS = stems(
  'rice quinoa farro barley couscous bulgur bulgar oat oatmeal polenta grit pasta penne spaghetti '
  + 'linguine fettuccine fusilli rigatoni macaroni orzo noodle ramen udon soba vermicelli tortilla '
  + 'bread pita naan bagel bun roll baguette sourdough flatbread gnocchi millet buckwheat freekeh '
  + 'sorghum',
);

const PROTEINS = stems(
  'chicken beef pork turkey lamb duck fish salmon tuna cod tilapia halibut trout sardine anchovy '
  + 'shrimp prawn scallop crab lobster mussel clam sausage bacon ham steak mince egg tofu tempeh '
  + 'seitan tofurky meatball nugget patty burger',
);

/** Cheese and the spoonable dairy a bowl takes. Not milk, butter or cream: those cook, they don't top. */
const DAIRY = stems(
  'cheese cheddar feta brie gouda mozzarella parmesan parmigiano pecorino ricotta halloumi paneer '
  + 'mascarpone burrata gruyere yogurt yoghurt skyr kefir labneh',
);

const NUTS = stems(
  'nut almond walnut cashew pecan pistachio peanut hazelnut macadamia pine seed sesame sunflower '
  + 'pumpkinseed pepita chia flax hemp',
);

const SAUCES = stems(
  'sauce dressing vinaigrette ketchup mayo mayonnaise mustard salsa sriracha pesto tahini hoisin '
  + 'miso harissa chutney relish aioli gravy molasses gochujang sambal',
);

/** Leafy herbs. Garlic and ginger are aromatics, not something a blank of herbs should offer. */
const HERBS = stems('basil parsley cilantro coriander mint chive dill thyme rosemary oregano sage tarragon herb');

/** A head that names a form rather than a food, which stops the guess rather than looking past it. */
const FORMS = stems(
  'stock broth bouillon powder chip crisp cracker cookie bar candy juice soda drink milk butter '
  + 'cream water seasoning spice mix extract oil flour starch syrup jam jelly vinegar cider',
);

/** Whole names whose words mislead, said outright. Keys are stemmed tokens joined by a space. */
const PHRASES: Record<string, FoodKind[]> = {
  'ice cream': [],
  'sour cream': ['dairy'],
  'peanut butter': ['nuts'],
  'almond butter': ['nuts'],
  'cottage cheese': ['dairy'],
  'sweet potato': ['vegetable'],
  'cream cheese': ['dairy'],
};

const CHILE_WORDS = new Set(['bell', 'sweet', 'jalapeno', 'poblano', 'serrano', 'chile', 'chili']);

/** The kinds one word names, in the context of the rest of the name. */
function kindsOfToken(token: string, tokens: readonly string[]): FoodKind[] {
  if (token === 'bean') {
    if (tokens.some(t => t === 'jelly' || t === 'coffee' || t === 'vanilla' || t === 'cocoa')) return [];
    return tokens.some(t => NON_PULSE_BEAN.has(t)) ? ['vegetable'] : ['legume', 'protein'];
  }
  // Bare "pepper" is the spice; a bell or chile pepper is the vegetable.
  if (token === 'pepper') return tokens.some(t => CHILE_WORDS.has(t)) ? ['vegetable'] : [];
  if (token === 'potato') return ['grain'];
  if (token === 'pea' && tokens.includes('split')) return ['legume', 'protein'];
  if (LEGUMES.has(token)) return ['legume', 'protein'];
  const out: FoodKind[] = [];
  if (GRAINS.has(token)) out.push('grain');
  if (PROTEINS.has(token)) out.push('protein');
  if (VEGETABLES.has(token)) out.push('vegetable');
  if (FRUITS.has(token)) out.push('fruit');
  if (DAIRY.has(token)) out.push('dairy');
  if (NUTS.has(token)) out.push('nuts');
  if (SAUCES.has(token)) out.push('sauce');
  if (HERBS.has(token)) out.push('herb');
  return out;
}

/** The kinds a name reads as, or an empty list when it reads as none. */
export function guessFoodKinds(name: string): FoodKind[] {
  const tokens = tokensOf(name);
  if (tokens.length === 0) return [];
  const phrase = tokens.slice(-2).join(' ');
  if (PHRASES[phrase]) return [...PHRASES[phrase]];
  const head = tokens[tokens.length - 1];
  if (FORMS.has(head)) return [];
  const fromHead = kindsOfToken(head, tokens);
  if (fromHead.length > 0) return fromHead;
  for (const token of tokens) {
    if (FORMS.has(token)) return [];
    const kinds = kindsOfToken(token, tokens);
    if (kinds.length > 0) return kinds;
  }
  return [];
}

/** The kinds an item answers to: the person's own filing when there is one, else the name's guess. */
export function foodKindsOf(item: Pick<GroceryItem, 'name' | 'foodKinds'>): FoodKind[] {
  return item.foodKinds ? [...item.foodKinds] : guessFoodKinds(item.name);
}

/** Whether `kind` is one of the closed set, for anything read back from storage or an agent. */
export function isFoodKind(value: unknown): value is FoodKind {
  return typeof value === 'string' && (FOOD_KINDS as readonly string[]).includes(value);
}

/**
 * A stored `food_kinds` column. NULL (or anything unreadable) is "never filed",
 * which is `undefined` so the name's guess applies; a stored empty list is an
 * answer and survives. Unknown kinds are dropped and duplicates folded, in the
 * order `FOOD_KINDS` lists them.
 */
export function parseFoodKinds(raw: unknown): FoodKind[] | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return undefined; }
  }
  if (!Array.isArray(parsed)) return undefined;
  return normalizeFoodKinds(parsed);
}

/** A list of kinds in the canonical order, unknown values dropped. */
export function normalizeFoodKinds(values: readonly unknown[]): FoodKind[] {
  return FOOD_KINDS.filter(kind => values.includes(kind));
}

/** The column value for `foodKinds`: NULL when never filed, the JSON list otherwise. */
export function serializeFoodKinds(kinds: readonly FoodKind[] | undefined): string | null {
  return kinds ? JSON.stringify(normalizeFoodKinds(kinds)) : null;
}

/** "Protein, Beans & lentils", or null when there are none. */
export function describeFoodKinds(kinds: readonly FoodKind[]): string | null {
  return kinds.length > 0 ? kinds.map(k => FOOD_KIND_LABELS[k]).join(', ') : null;
}
