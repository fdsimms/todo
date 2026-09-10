import type { GroceryItem, MealPlanEntry, Recipe } from '../types';
import { catalogItemForKey } from './groceryPlural';
import { varietyIndex } from './itemVarieties';
import { plannedIngredientsForRecipe } from './mealPlanGroceries';
import { isWithinShopWindow } from './mealShortfallTasks';
import type { ChoiceResolution } from './recipeComponents';
import { NO_STANDING_SWAPS, type StandingSwapMap } from './standingSwaps';

/**
 * Which planned recipes the current trolley is being shopped for, and which of
 * its rows each one needs — the source for the recipe strip above the grocery
 * list and the filter tapping it applies.
 *
 * **Membership is derived here, never read off `GroceryItem.sourceRecipeId`.**
 * That column is the obvious candidate and it is the wrong one. Per its own note
 * in `types/index.ts` it is stamped when `addFromPlan` mints a genuinely new
 * catalog row and restamped when it re-lists a row that had fallen off every
 * list — but explicitly *not* when the row is already standing on one. So the
 * gaps that matter here are the ones no restamping closes:
 *
 * - a row already on the list when a recipe is added gets no credit for it,
 *   which is `addFromPlan`'s own `alreadyOnList` branch and covers most staples;
 * - one row holds one credit, so an ingredient two recipes both want can only
 *   ever name one of them;
 * - the credit then persists for as long as the row stays on the list, so it
 *   can be stale about why the row is needed now.
 *
 * A filter built on it would hide rows the selected recipe genuinely needs and
 * attribute others to a recipe nobody is cooking. The field is a provenance
 * snapshot and is honest about being one; it just cannot answer "why is this on
 * the list *now*".
 *
 * So the question is answered the way the rest of the app answers it: flatten
 * what the recipe actually calls for (`plannedIngredientsForRecipe`, which
 * already handles a composed recipe's components, the entry's own scale and
 * choices, and standing swaps) and resolve each line against the trolley
 * through the catalog bridge. Nothing is stored, so nothing can drift: a recipe
 * dropped from the plan leaves the strip on the next render, and an ingredient
 * two recipes share is correctly claimed by both — the many-to-many a single
 * column could never hold.
 *
 * **`sourceRecipeId` does have one job here, and it is the one it is good at.**
 * Membership is the question it cannot answer; *discovery* — "did this recipe
 * put something in this trolley" — is exactly what it records, since that is
 * the moment it is stamped. A recipe added straight to the list with no meal
 * planned (`RecipeToListSheet`) has no entry to be found by, so the rows it
 * minted are the only trace it left, and reading them is what keeps the strip
 * from being meal-plan-only. What that turns into is still a *candidate*: the
 * pill's rows are derived like every other, so a staple the stamp never
 * credited is claimed anyway and a stale stamp cannot drag an unrelated row in.
 * The known cost is a recipe whose stamped row has sat unbought on the list for
 * months keeping its pill — a row that stays listed is exactly the one no
 * restamping reaches. That is a fair reading of the evidence rather than a bug:
 * you did add it for that recipe, and you never bought it.
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
 * Candidates come from two places, and a recipe in both is one pill: the meals
 * planned inside the shop window, and — for a shop nobody planned a meal for —
 * the recipes that stamped rows currently in the trolley (see the note above on
 * what `sourceRecipeId` is and isn't good for). The planned pass runs first so
 * an entry's own scale and choices are what get flattened; the ad-hoc pass only
 * picks up what it didn't already claim, where a recipe stands for itself at
 * its written scale, since an ad-hoc add has no entry to carry either.
 *
 * The three entries skipped are `collectPlannedIngredients`' own refusals, for
 * its reasons: a free-text night ("leftovers") has no ingredient list, a
 * `recipeId` that no longer resolves is resolve-or-shrug like every other
 * cross-row pointer, and a meal already marked cooked has been made — its
 * ingredients were bought or are moot, so offering to filter by it reads as the
 * app not knowing what already happened. A cooked meal stays refused through
 * the ad-hoc pass too, or its stamped rows would hand back the pill the first
 * rule just declined to give.
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

  // Insertion order is the two walks below; the sort at the end is what actually
  // decides the strip's order, so this only has to be stable.
  const byRecipe = new Map<string, { title: string; ids: Set<string> }>();

  const claim = (recipe: Recipe, resolution: ChoiceResolution | undefined, scale: number) => {
    const bucket = byRecipe.get(recipe.id) ?? { title: recipe.name, ids: new Set<string>() };
    for (const line of plannedIngredientsForRecipe(recipe, recipesById, resolution, scale, swaps)) {
      for (const row of rowsForKey(line.nameKey, listRows, varieties)) bucket.ids.add(row.id);
    }
    byRecipe.set(recipe.id, bucket);
  };

  // Planned: the meals close enough to shop for.
  const cookedInWindow = new Set<string>();
  for (const entry of entries) {
    if (!entry.recipeId) continue;
    if (!isWithinShopWindow(entry.date, todayKey, leadDays)) continue;
    if (entry.cookedAt) { cookedInWindow.add(entry.recipeId); continue; }
    const recipe = recipesById.get(entry.recipeId);
    if (!recipe) continue;
    claim(recipe, { chosen: entry.recipeChoices }, entry.recipeScale);
  }

  // Ad-hoc: a recipe added straight to the list, found by the rows it minted.
  for (const row of listRows) {
    if (!row.sourceRecipeId) continue;
    if (byRecipe.has(row.sourceRecipeId) || cookedInWindow.has(row.sourceRecipeId)) continue;
    const recipe = recipesById.get(row.sourceRecipeId);
    if (!recipe) continue;
    // No entry, so no picks and no scale to honour: the recipe as written, which
    // is what `RecipeToListSheet` shopped for unless the user said otherwise.
    claim(recipe, undefined, 1);
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
