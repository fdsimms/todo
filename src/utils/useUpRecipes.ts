import type { KitchenEntry } from './kitchenInventory';
import type { GroceryItem, Recipe } from '../types';
import { freshnessRank } from './freshness';
import { resolvePluralKey } from './groceryPlural';

/**
 * "You could make X with what's about to go off."
 *
 * The kitchen already knows what's dying (`useUpEntries`) and a recipe already
 * knows what it's made of, and until this nothing joined the two. That join is
 * the payoff a pantry is *for*: a "Use up spinach" task tells you the spinach
 * is going, which you can see, and stops exactly where the useful part starts.
 *
 * **The join is `nameKey`, and it's the only honest one available.**
 * `RecipeIngredient.nameKey` is described in `types` as "THE bridge to the
 * catalog", and `KitchenEntry.matchKey` is a catalog row's own `nameKey`. So
 * the match is exact-key and nothing else: no fuzzy matching, no substring
 * guessing, no lexicon of near-misses. A wrong suggestion here costs more than
 * a missing one — being told to make a stir-fry because "cream" fuzzily hit
 * "ice cream" is the kind of thing that gets a feature switched off — and the
 * app already refuses this class of guess for a wrong shelf life
 * (`shelfLifeDaysFor`) for the same reason.
 *
 * The one widening is not a guess: a dying item that *declares itself a
 * variety* of a generic name (`GroceryItem.varietyOfKey`, user-authored) also
 * answers for that name, so a recipe calling for "onion" counts as using up
 * the white onion that's about to turn. Still exact keys on both hops, still
 * one hop, and still specific-satisfies-generic only — dying generic "onion"
 * never claims a line that asked for red onion in particular.
 *
 * **Groceries only.** A `KitchenEntry` can be a container of leftover chilli,
 * and a leftover's `matchKey` comes from its own free-typed title rather than
 * from the catalog, so it would only ever match by accident. Leftovers also
 * aren't ingredients: you reheat last night's chilli, you don't cook with it.
 * `LeftoversCard` is where a container gets planned onto a night.
 *
 * **It reads; it writes nothing and schedules nothing.** No task is spawned, no
 * meal is planned. Cooking something tonight is a decision, and the two
 * generators that *do* write unattended (`groceryExpiry`, `leftoverTasks`) each
 * had to earn that with a setting and a per-row opt-out. A suggestion the user
 * taps is not in that category and shouldn't grow into it.
 */

/** One recipe worth cooking, and what it would use up. */
export interface UseUpRecipe {
  recipe: Recipe;
  /**
   * The dying entries this recipe calls for, most urgent first. Never empty —
   * a recipe that uses none of them isn't a suggestion.
   */
  uses: KitchenEntry[];
}

/**
 * Recipes that would use up what's about to be wasted, best first.
 *
 * `entries` is meant to be `useUpEntries(...)`'s output — what's down to its
 * last day or already past it — rather than the whole kitchen. Passing the
 * whole kitchen would "work" and would suggest a recipe for every dinner you
 * could possibly cook, which is a different feature (and one the recipe list
 * already is).
 *
 * The ranking, in order:
 *
 * 1. **How many dying things it uses.** A recipe that clears the spinach *and*
 *    the mushrooms is worth more than two separate recipes, and this is the
 *    whole reason to rank rather than to list.
 * 2. **How urgent the worst of them is** (`freshnessRank`), so that between two
 *    recipes each using one thing, the one using today's casualty wins.
 * 3. **Name**, so the order is stable rather than depending on library
 *    insertion order — the same last-resort tie-break `compareKitchenEntries`
 *    uses.
 *
 * Deliberately *not* ranked by how much of the recipe you already have. That
 * reads as the better question and can't be answered honestly: the pantry
 * knows about the items it has a reason to vouch for and is silent about
 * everything else (`probablyHaveReason` returning null is ignorance, not
 * absence), so "you have 6 of 8 ingredients" would be a confident number built
 * on a set that was never meant to carry one.
 */
export function useUpRecipes(
  entries: readonly KitchenEntry[],
  recipes: readonly Recipe[],
  /**
   * The catalog, for the variety declarations — see the header. Defaulted
   * empty so the older callers and tests read exactly as before: with no
   * items there are no declarations, and the join is the bare exact key.
   */
  items: readonly GroceryItem[] = []
): UseUpRecipe[] {
  const dying = new Map<string, KitchenEntry>();
  for (const entry of entries) {
    // Groceries only, and a blank key never matches: `groceryNameKey` returns
    // '' for a name with no letters or digits, and an ingredient that
    // normalised away would otherwise match every one of them at once.
    if (entry.kind !== 'grocery' || !entry.matchKey) continue;
    dying.set(entry.matchKey, entry);
  }
  if (dying.size === 0) return [];

  // A dying variety answers for its generic name too. Aliases are resolved
  // before being applied so a real dying entry under the generic key always
  // wins over an alias, and two dying varieties of one generic settle on the
  // more urgent — the ranking currency everything else here already uses.
  const aliases = new Map<string, KitchenEntry>();
  for (const item of items) {
    if (!item.varietyOfKey || item.varietyOfKey === item.nameKey) continue;
    const entry = dying.get(item.nameKey);
    if (!entry) continue;
    const current = aliases.get(item.varietyOfKey);
    if (!current || compareByUrgency(entry, current) < 0) {
      aliases.set(item.varietyOfKey, entry);
    }
  }
  for (const [key, entry] of aliases) {
    if (!dying.has(key)) dying.set(key, entry);
  }

  const out: UseUpRecipe[] = [];
  for (const recipe of recipes) {
    // A Map keyed by the entry id rather than a filter over `dying`, because a
    // recipe can name one item on two lines ("2 tomatoes" for the sauce, "1
    // tomato" to garnish) and that is one tomato being used up, not two.
    const uses = new Map<string, KitchenEntry>();
    for (const ingredient of recipe.ingredients) {
      if (!ingredient.nameKey) continue;
      // Its own plural counts, the same way it does everywhere the catalog
      // resolves a name (`groceryPlural.ts`) — a line reading "serrano pepper"
      // is exactly the Serrano peppers going soft in the drawer.
      const key = dying.has(ingredient.nameKey)
        ? ingredient.nameKey
        : resolvePluralKey(ingredient.nameKey, dying.keys());
      const entry = key ? dying.get(key) : undefined;
      if (entry) uses.set(entry.id, entry);
    }
    if (uses.size === 0) continue;
    out.push({ recipe, uses: [...uses.values()].sort(compareByUrgency) });
  }

  return out.sort(
    (a, b) =>
      b.uses.length - a.uses.length ||
      freshnessRank(a.uses[0].freshness) - freshnessRank(b.uses[0].freshness) ||
      a.recipe.name.localeCompare(b.recipe.name)
  );
}

/**
 * Most urgent first, so `uses[0]` is the worst case and the ranking above can
 * read the recipe's urgency off one element.
 *
 * `freshnessRank` rather than the day itself, unlike `compareKitchenEntries`:
 * everything here is already inside the use-up threshold, so the states are
 * what separate them and the exact days would only re-sort within a state.
 */
function compareByUrgency(a: KitchenEntry, b: KitchenEntry): number {
  return (
    freshnessRank(a.freshness) - freshnessRank(b.freshness) ||
    a.title.localeCompare(b.title)
  );
}

/**
 * "Uses your spinach and mushrooms" — what a suggestion row says under the
 * recipe's name.
 *
 * Names the food rather than counting it ("uses 2 things going off"), because
 * the names are the reason to tap: the whole question the row answers is
 * *which* of tonight's casualties this would deal with. Capped at two names
 * plus a count, which is where the line stops fitting.
 */
export function describeUseUpRecipe(suggestion: UseUpRecipe): string {
  const names = suggestion.uses.map(e => e.title);
  if (names.length === 1) return `Uses your ${names[0]}`;
  if (names.length === 2) return `Uses your ${names[0]} and ${names[1]}`;
  return `Uses your ${names[0]}, ${names[1]} and ${names.length - 2} more`;
}
