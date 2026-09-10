import type { GroceryItem, MealPlanEntry, Recipe } from '../types';
import { catalogItemForKey } from './groceryPlural';
import { varietyIndex } from './itemVarieties';
import { plannedIngredientsForRecipe } from './mealPlanGroceries';
import { isWithinShopWindow } from './mealShortfallTasks';
import { NO_STANDING_SWAPS, type StandingSwapMap } from './standingSwaps';

/**
 * Which planned recipes the current trolley is being shopped for, and which of
 * its rows each one needs — the source for the recipe strip above the grocery
 * list and the filter tapping it applies.
 *
 * **Membership is derived here, never read off `GroceryItem.sourceRecipeId`.**
 * That column is the obvious candidate and it is the wrong one: its own note in
 * `types/index.ts` says it is stamped *only* when `addFromPlan` mints a
 * genuinely new catalog row, so a staple that already existed carries nothing,
 * and a row first created for one recipe keeps that credit for ever even once a
 * different recipe is the reason it is on the list this week. A filter built on
 * it would hide rows the selected recipe genuinely needs (every staple) and
 * attribute others to a recipe nobody is cooking. The field is a provenance
 * snapshot and is honest about being one; it just cannot answer "why is this on
 * the list *now*".
 *
 * So the question is answered the way the rest of the app answers it: flatten
 * what the plan actually calls for (`plannedIngredientsForRecipe`, which
 * already handles a composed recipe's components, the entry's own scale and
 * choices, and standing swaps) and resolve each line against the trolley
 * through the catalog bridge. Nothing is stored, so nothing can drift: a recipe
 * dropped from the plan leaves the strip on the next render, and an ingredient
 * two recipes share is correctly claimed by both — the many-to-many a single
 * column could never hold.
 *
 * **This is also why the `groupBy: 'recipe'` lens keeps reading
 * `sourceRecipeId` and is not "fixed" to use this.** A grouping needs each row
 * in exactly one section, and live membership is a set relation: the onion two
 * recipes want has no single bucket. Grouping wants a snapshot and filtering
 * wants the live relation, so the two legitimately read different things.
 *
 * Nothing here writes.
 */

/** One recipe being shopped for, and the trolley rows it needs. */
export interface ShoppedRecipe {
  recipeId: string;
  /** The recipe's current name — a live lookup, since it came from the plan. */
  title: string;
  /** Ids of rows in the trolley this recipe calls for, checked ones included. */
  itemIds: string[];
  /** How many of those are still to buy. 0 means the recipe is fully in the cart. */
  remaining: number;
}

/**
 * The trolley rows one ingredient line resolves to.
 *
 * The `linked` half of `matchIngredientToCatalog`'s ladder and deliberately
 * only that half: an exact `nameKey`, the row it is a plural of, or the
 * declared varieties of the generic it names. The suggestion tiers that module
 * also offers (a leading-word trim, a prefix, the autocomplete's ranking, one
 * character out) are things a person is asked to confirm, and a filter is not a
 * place to act on a guess — silently hiding a row because "lime" scored near
 * "line" is worse than showing it.
 *
 * Every variety comes back rather than the first, which is where this parts
 * company with `matchIngredientToCatalog`'s single answer. That function picks
 * one because it is offering a rename; this one is deciding what stays on
 * screen, and if both a white and a red onion are in the trolley against an
 * "onion" line, either could be the one meant. Showing an extra row costs a
 * glance, hiding a needed one costs a second trip.
 */
function rowsForKey(
  key: string,
  listRows: readonly GroceryItem[],
  varieties: ReadonlyMap<string, GroceryItem[]>
): readonly GroceryItem[] {
  if (!key) return [];
  const direct = catalogItemForKey(key, listRows);
  if (direct) return [direct];
  return varieties.get(key) ?? [];
}

/**
 * The recipes worth offering as a filter, in the order the strip shows them.
 *
 * The three entries skipped are `collectPlannedIngredients`' own refusals, for
 * its reasons: a free-text night ("leftovers") has no ingredient list, a
 * `recipeId` that no longer resolves is resolve-or-shrug like every other
 * cross-row pointer, and a meal already marked cooked has been made — its
 * ingredients were bought or are moot, so offering to filter by it reads as the
 * app not knowing what already happened.
 *
 * Attribution is to the **entry's own recipe**, not to the recipe each line is
 * written on, which is why this flattens per entry rather than calling
 * `collectPlannedIngredients` over the window. That function credits
 * `flat.recipe` so a breakdown can say which component wants the butter; here
 * that would split "Steak dinner" into a pill for the steak and another for the
 * mash, when what the user planned — and what they are shopping for — is one
 * dinner.
 *
 * Two nights of the same recipe collapse to one pill, since they are one thing
 * to shop for and one thing to filter by.
 *
 * `todayKey` is the caller's *logical* today (see `isWithinShopWindow`, and the
 * grace-window note in CLAUDE.md): read off the calendar date instead and the
 * window opens a day early for anyone with a late `dayResetTime`.
 */
export function shoppedRecipes(
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  listRows: readonly GroceryItem[],
  todayKey: string,
  leadDays: number,
  swaps: StandingSwapMap = NO_STANDING_SWAPS
): ShoppedRecipe[] {
  if (listRows.length === 0) return [];
  const varieties = varietyIndex(listRows);
  const checked = new Set(listRows.filter(r => r.checked).map(r => r.id));

  // Insertion order is the entry walk; the sort below is what actually decides
  // the strip's order, so this only has to be stable.
  const byRecipe = new Map<string, { title: string; ids: Set<string> }>();

  for (const entry of entries) {
    if (!entry.recipeId) continue;
    if (entry.cookedAt) continue;
    if (!isWithinShopWindow(entry.date, todayKey, leadDays)) continue;
    const recipe = recipesById.get(entry.recipeId);
    if (!recipe) continue;

    const bucket = byRecipe.get(recipe.id) ?? { title: recipe.name, ids: new Set<string>() };
    for (const line of plannedIngredientsForRecipe(
      recipe,
      recipesById,
      { chosen: entry.recipeChoices },
      entry.recipeScale,
      swaps
    )) {
      for (const row of rowsForKey(line.nameKey, listRows, varieties)) bucket.ids.add(row.id);
    }
    byRecipe.set(recipe.id, bucket);
  }

  const out: ShoppedRecipe[] = [];
  for (const [recipeId, { title, ids }] of byRecipe) {
    // A planned recipe with nothing of its own in the trolley is not something
    // this trolley is being shopped for, so it gets no pill — otherwise every
    // meal in the window would offer a filter that empties the list.
    if (ids.size === 0) continue;
    const itemIds = [...ids];
    out.push({
      recipeId,
      title,
      itemIds,
      remaining: itemIds.filter(id => !checked.has(id)).length,
    });
  }

  // By title, so the strip's order doesn't shuffle as the week is cooked
  // through: keying off the plan's dates would move a pill every time a night
  // was marked cooked or a meal was dragged to another day.
  return out.sort((a, b) => a.title.localeCompare(b.title) || a.recipeId.localeCompare(b.recipeId));
}

/**
 * The trolley narrowed to the selected recipes, or all of it when nothing is
 * selected.
 *
 * Applied to the rows *before* they are grouped, so the aisle/recipe sections,
 * the flat row list, the remaining count and what a bulk selection can reach
 * all follow from one filter rather than each needing to know about it.
 *
 * A selected id with no entry in `shopped` contributes nothing rather than
 * throwing the whole list away — see `pruneRecipeSelection`, which is what
 * keeps that from happening in the first place.
 */
export function filterRowsByRecipes(
  rows: readonly GroceryItem[],
  shopped: readonly ShoppedRecipe[],
  selectedRecipeIds: readonly string[]
): GroceryItem[] {
  if (selectedRecipeIds.length === 0) return [...rows];
  const wanted = new Set(selectedRecipeIds);
  const keep = new Set<string>();
  for (const recipe of shopped) {
    if (!wanted.has(recipe.recipeId)) continue;
    for (const id of recipe.itemIds) keep.add(id);
  }
  return rows.filter(row => keep.has(row.id));
}

/**
 * Drops selected recipes that are no longer being shopped for.
 *
 * Without this the filter is a trap with no visible way out: cook the meal,
 * finish the shop, or drag it past the window, and its pill leaves the strip
 * while the selection it left behind hides every row — an empty grocery list
 * whose reason is no longer on screen. Pruning is deliberately silent, since
 * the pill disappearing is itself the explanation, and an empty result then
 * means the list is empty rather than filtered.
 */
export function pruneRecipeSelection(
  selected: readonly string[],
  shopped: readonly ShoppedRecipe[]
): string[] {
  if (selected.length === 0) return [];
  const live = new Set(shopped.map(r => r.recipeId));
  return selected.filter(id => live.has(id));
}
