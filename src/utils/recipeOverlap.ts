import type { GroceryItem, Recipe } from '../types';
import type { PlannedIngredient } from './mealPlanGroceries';
import { catalogItemForKey, resolvePluralKey } from './groceryPlural';
import { flattenRecipeIngredients } from './recipeComponents';
import { NO_STANDING_SWAPS, type StandingSwapMap } from './standingSwaps';

/**
 * "Which recipes would I be buying the same things for?"
 *
 * The app could already rank recipes against what's about to go off
 * (`useUpRecipes`) and could shop for a whole planned week at once
 * (`collectPlannedIngredients`), but nothing ever compared two recipes to each
 * other. So cooking a week that shares a bunch of cilantro, or roasting one
 * tray of chicken thighs for three dinners, was left entirely to memory.
 *
 * This is that comparison: a **seed** (the meals already on a week, or one
 * recipe the user is looking at) and a ranking of every other recipe by how
 * many ingredients it shares with it.
 *
 * **It counts ingredients in common. It does not count quantities, and it must
 * not start.** Two recipes sharing "chicken stock" saves a carton only if the
 * amounts happen to work out, and nothing here reads an amount. Everything
 * this feature says to the user is phrased as *shares*, never as a saving, so
 * the number it shows is one it can actually stand behind.
 *
 * **The join is `nameKey`, on exactly the terms `useUpRecipes` already sets.**
 * `RecipeIngredient` carries no `itemId`, so the key is the only real bridge
 * there is, and the two widenings allowed on it are the two that aren't
 * guesses: a word's own plural, resolved against the keys actually in play
 * (`resolvePluralKey`, which refuses ambiguity), and a **user-declared**
 * variety (`GroceryItem.varietyOfKey`). No fuzzy matching. In particular
 * `textSimilar.ts` and the `suggested` tiers of `ingredientCatalogMatch.ts`
 * are deliberately not used here: those exist to *offer* a link a person then
 * confirms, and quietly merging two recipes because "cream" came within one
 * edit of "ice cream" is the kind of wrong answer that gets a feature switched
 * off rather than corrected.
 *
 * **Varieties resolve one hop, and never two.** A seed line naming a declared
 * variety answers for its generic ("white onion" in the seed is matched by a
 * candidate's plain "onion"), and a candidate naming a declared variety
 * answers for a generic the seed named ("onion" in the seed is matched by a
 * candidate's "red onion"). Both are specific-satisfies-generic, which is the
 * same direction `useUpRecipes` and `classifyPlanned` already travel. What is
 * refused is chaining the two: a seed's "white onion" must not reach a
 * candidate's "red onion" by way of the generic they happen to share, because
 * those are two different onions and buying one does not get you the other.
 * `aliasKeys` is what holds that line — see `resolveAgainstSeed`.
 *
 * **Staples are shown and never scored.** Salt, water and olive oil turn up in
 * everything, so counting them makes "shares 4 ingredients" mean nothing at
 * all. `GroceryItem.isStaple` is user-authored, so demoting on it is reading a
 * fact rather than inventing one — and a fresh catalog marks nothing, which is
 * exactly the right failure: the score degrades to a plain shared count and
 * sharpens as the user marks things. Inferring staples from how often a name
 * turns up in the library ("in more than 60% of recipes") was the obvious
 * alternative and is the kind of silent inference this codebase refuses
 * elsewhere; it would also make one recipe's score move when you added an
 * unrelated one.
 *
 * **It reads; it writes nothing.** Ranking is a suggestion to look, and the
 * sheet is where a person picks. Nothing here plans a meal or touches a list.
 */

/** One ingredient two recipes both call for. */
export interface SharedIngredient {
  /** The seed's canonical key for it — what `labelByKey` and `stapleKeys` are keyed by. */
  key: string;
  name: string;
  staple: boolean;
}

/** What a set of recipes calls for, in the shape the ranking needs to match against. */
export interface OverlapSeed {
  /**
   * Every key a candidate line may match, mapped to the canonical seed key it
   * stands for. A key the seed names outright maps to itself; a declared
   * variety's generic name maps back to the variety.
   */
  matchable: ReadonlyMap<string, string>;
  /**
   * The subset of `matchable`'s keys that are there by variety declaration
   * rather than because the seed named them. A candidate may not reach one of
   * these through a variety declaration of its own — see the header.
   */
  aliasKeys: ReadonlySet<string>;
  /** Canonical keys the catalog marks `isStaple`: matched and shown, never scored. */
  stapleKeys: ReadonlySet<string>;
  /** Canonical key to the name to print on a chip. */
  labelByKey: ReadonlyMap<string, string>;
  /**
   * Every recipe the seed is made of, components included, so nothing is ever
   * offered back as something to cook alongside itself. A component counts:
   * the steamed rice inside a planned stir-fry is already being made.
   */
  recipeIds: ReadonlySet<string>;
}

/** One recipe worth cooking alongside the seed, and what it would share with it. */
export interface OverlapMatch {
  recipe: Recipe;
  /** The shared ingredients that count, best first. Never empty — see `rankOverlapRecipes`. */
  shared: SharedIngredient[];
  /** Shared staples, shown so the row is honest about them, never scored. */
  sharedStaples: SharedIngredient[];
  /** `shared.length`. Named separately because the sort reads it and the row prints it. */
  score: number;
}

/** One line on its way into a seed, from either of the two builders. */
interface SeedLine {
  nameKey: string;
  name: string;
}

const EMPTY_SEED: OverlapSeed = {
  matchable: new Map(),
  aliasKeys: new Set(),
  stapleKeys: new Set(),
  labelByKey: new Map(),
  recipeIds: new Set(),
};

function buildSeed(
  lines: readonly SeedLine[],
  recipeIds: ReadonlySet<string>,
  items: readonly GroceryItem[]
): OverlapSeed {
  const matchable = new Map<string, string>();
  const labelByKey = new Map<string, string>();
  for (const line of lines) {
    // `groceryNameKey` returns '' for a name with no letters or digits, and a
    // blank key would otherwise match every other blank at once.
    if (!line.nameKey) continue;
    matchable.set(line.nameKey, line.nameKey);
    const current = labelByKey.get(line.nameKey);
    if (!current || line.name.length < current.length) labelByKey.set(line.nameKey, line.name);
  }
  if (matchable.size === 0) return { ...EMPTY_SEED, recipeIds };

  // A seed line naming a declared variety answers for its generic name too, so
  // a candidate calling for plain onion shares the white onion this week
  // already needs. Specific-satisfies-generic only, and skipped where the seed
  // names the generic outright — that key is its own canonical already.
  const aliasKeys = new Set<string>();
  for (const item of items) {
    if (!item.varietyOfKey || item.varietyOfKey === item.nameKey) continue;
    if (!matchable.has(item.nameKey) || matchable.has(item.varietyOfKey)) continue;
    matchable.set(item.varietyOfKey, item.nameKey);
    aliasKeys.add(item.varietyOfKey);
  }

  // Per canonical key rather than per line: a key is a staple or it isn't, and
  // `catalogItemForKey` is the plural-tolerant lookup a bare `.find` would miss.
  const stapleKeys = new Set<string>();
  for (const canonical of new Set(matchable.values())) {
    const item = catalogItemForKey(canonical, items);
    if (!item) continue;
    if (item.isStaple) stapleKeys.add(canonical);
    // The catalog's own name is what the user typed, so it wins the chip —
    // same precedence `classifyPlanned` gives a row's display name.
    labelByKey.set(canonical, item.name);
  }

  return { matchable, aliasKeys, stapleKeys, labelByKey, recipeIds };
}

/**
 * A seed built from a planned week.
 *
 * Takes `collectPlannedIngredients`' output rather than walking entries itself,
 * so this can't drift from what "Add week to list" shops for: the range
 * refilter, the skipped free-text and already-cooked entries, each entry's own
 * `recipeChoices` and `recipeScale`, and the component flattening are all
 * decided there, once, for every week-scoped read in the app.
 */
export function overlapSeedFromPlanned(
  planned: readonly PlannedIngredient[],
  items: readonly GroceryItem[] = []
): OverlapSeed {
  const recipeIds = new Set<string>();
  for (const line of planned) {
    if (line.recipeId) recipeIds.add(line.recipeId);
  }
  return buildSeed(planned, recipeIds, items);
}

/**
 * A seed built from recipes directly — the "cook something with this" entry
 * point, where there is no planned week to read.
 *
 * Choices resolve to their defaults (no `ChoiceResolution`) rather than
 * contributing every alternative: `allOptions` is for search, and a read whose
 * end is a meal getting planned and shopped for must not count both sides of
 * an either/or.
 */
export function overlapSeedFromRecipes(
  roots: readonly Recipe[],
  recipesById: ReadonlyMap<string, Recipe>,
  items: readonly GroceryItem[] = [],
  swaps: StandingSwapMap = NO_STANDING_SWAPS
): OverlapSeed {
  const lines: SeedLine[] = [];
  const recipeIds = new Set<string>();
  for (const root of roots) {
    recipeIds.add(root.id);
    for (const flat of flattenRecipeIngredients(root, recipesById, undefined, swaps)) {
      recipeIds.add(flat.recipe.id);
      if (flat.ingredient.excludeFromShoppingList) continue;
      lines.push({ nameKey: flat.ingredient.nameKey, name: flat.ingredient.name });
    }
  }
  return buildSeed(lines, recipeIds, items);
}

/**
 * The canonical seed key a candidate's line answers to, or null.
 *
 * Three rungs, tried in order and each narrower than a guess: the key itself,
 * its own plural resolved against the keys in play, and the generic that the
 * candidate's key is a declared variety of. The last one is refused against an
 * alias key, which is what stops two varieties of one generic reaching each
 * other through it.
 */
function resolveAgainstSeed(
  key: string,
  seed: OverlapSeed,
  varietyOf: ReadonlyMap<string, string>
): string | null {
  const exact = seed.matchable.get(key);
  if (exact) return exact;

  const plural = resolvePluralKey(key, seed.matchable.keys());
  if (plural) return seed.matchable.get(plural) ?? null;

  const generic = varietyOf.get(key);
  if (generic && !seed.aliasKeys.has(generic)) return seed.matchable.get(generic) ?? null;

  return null;
}

/**
 * Recipes worth cooking alongside the seed, most shared first.
 *
 * A recipe already in the seed is never offered back, and neither is one whose
 * only overlap is staples — "you could also make this, it also uses salt" is
 * noise wearing the shape of a suggestion.
 */
export function rankOverlapRecipes(
  seed: OverlapSeed,
  recipes: readonly Recipe[],
  recipesById: ReadonlyMap<string, Recipe>,
  items: readonly GroceryItem[] = [],
  swaps: StandingSwapMap = NO_STANDING_SWAPS,
  /**
   * Recipes to keep even where they share nothing worth scoring — the ones the
   * user picked by hand and carried here from another screen. A suggestion is
   * this module's to withhold; a choice already made is not, and dropping one
   * would lose it with nothing said. They still sort last, and a recipe the
   * seed is made of is still never offered back.
   */
  alwaysInclude: ReadonlySet<string> = new Set()
): OverlapMatch[] {
  if (seed.matchable.size === 0 && alwaysInclude.size === 0) return [];

  const varietyOf = new Map<string, string>();
  for (const item of items) {
    if (!item.varietyOfKey || item.varietyOfKey === item.nameKey) continue;
    varietyOf.set(item.nameKey, item.varietyOfKey);
  }

  const out: OverlapMatch[] = [];
  for (const recipe of recipes) {
    if (seed.recipeIds.has(recipe.id)) continue;

    // Keyed by the canonical seed key, so a recipe naming one thing on two
    // lines ("2 tomatoes" for the sauce, "1 tomato" to garnish) shares one
    // tomato rather than two — same dedupe `useUpRecipes` makes by entry id.
    const hits = new Map<string, SharedIngredient>();
    for (const flat of flattenRecipeIngredients(recipe, recipesById, undefined, swaps)) {
      const { ingredient } = flat;
      if (!ingredient.nameKey || ingredient.excludeFromShoppingList) continue;
      const canonical = resolveAgainstSeed(ingredient.nameKey, seed, varietyOf);
      if (!canonical || hits.has(canonical)) continue;
      hits.set(canonical, {
        key: canonical,
        name: seed.labelByKey.get(canonical) ?? ingredient.name,
        staple: seed.stapleKeys.has(canonical),
      });
    }

    const shared: SharedIngredient[] = [];
    const sharedStaples: SharedIngredient[] = [];
    for (const hit of hits.values()) (hit.staple ? sharedStaples : shared).push(hit);
    if (shared.length === 0 && !alwaysInclude.has(recipe.id)) continue;

    shared.sort((a, b) => a.name.localeCompare(b.name));
    sharedStaples.sort((a, b) => a.name.localeCompare(b.name));
    out.push({ recipe, shared, sharedStaples, score: shared.length });
  }

  return out.sort(
    (a, b) =>
      b.score - a.score ||
      b.sharedStaples.length - a.sharedStaples.length ||
      a.recipe.name.localeCompare(b.recipe.name)
  );
}

/**
 * "Shares garlic, ginger and 2 more" — the one-line summary under a row.
 *
 * Staples are named last and only once the counted ones run out, so a row
 * never leads with the salt.
 */
export function describeOverlap(match: OverlapMatch, limit = 3): string {
  const names = [...match.shared, ...match.sharedStaples].map(s => s.name);
  if (names.length === 0) return '';
  const shown = names.slice(0, limit);
  const rest = names.length - shown.length;
  // With a remainder the tail is "and N more", so the names before it stay
  // comma-separated — "a, b and c and 2 more" reads as a mistake.
  if (rest > 0) return `Shares ${shown.join(', ')} and ${rest} more`;
  if (shown.length === 1) return `Shares ${shown[0]}`;
  return `Shares ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}
