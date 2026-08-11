import type { GroceryItem, Recipe, RecipeIngredient, RecipeMealType, RecipePrepTask } from '../types';
import {
  RECIPE_CHOICE_GROUP_MAX_LENGTH,
  RECIPE_MEAL_TYPES,
  RECIPE_MEAL_TYPE_LABELS,
  RECIPE_NAME_MAX_LENGTH,
  RECIPE_SOURCE_MAX_LENGTH,
  RECIPE_SECTION_MAX_LENGTH,
  PREP_MAX_LENGTH,
  GROCERY_NAME_MAX_LENGTH,
  GROCERY_QUANTITY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from '../types';
import { format } from 'date-fns/format';
import { groceryNameKey, parseGroceryInput, splitGroceryLines, splitPrep, splitPurpose } from './groceryParse';
import { generateId } from './id';
import { resolveOffsetDate } from './templateUtils';
import { classifyPlanned, plannedIngredientsForRecipe } from './mealPlanGroceries';
import { formatDuration } from './effort';
import {
  countChoiceAware,
  describeComponents,
  flattenRecipeIngredients,
  flattenRecipePrepTasks,
  recipeMap,
  type ChoiceResolution,
} from './recipeComponents';

// splitPrep lives in groceryParse.ts now — the plain grocery quick-add field
// runs the same split for its live preview, not just recipe ingredient lines
// — but re-exported here so existing imports of it from this module keep
// working.
export { splitPrep } from './groceryParse';

/**
 * Everything between raw recipe text and a stored Recipe. Pure and store-free
 * so it stays testable under the node jest env, same as groceryParse.
 *
 * The offline path is not a stub: splitGroceryLines + parseGroceryInput turn
 * the ingredient list most recipe sites hand you ("2 lb chicken thighs / 1
 * bunch parsley / 3 cloves garlic") into named, quantified rows with no API
 * key involved. AI only ever gets to do the part a parser genuinely can't —
 * separating the method from the shopping.
 */

/** Tolerates a null column, a corrupt blob, or a shape from a newer app version. */
export function parseRecipeIngredients(raw: unknown): RecipeIngredient[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw as string); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeIngredient).filter((i): i is RecipeIngredient => i !== null);
}

/**
 * Repairs one stored ingredient. Returns null for a row with no usable name —
 * a nameless ingredient can't be shopped for and can't be edited into one, so
 * dropping it beats rendering a blank row forever.
 *
 * Recomputes `nameKey` from the name rather than trusting the stored one, so a
 * blob written by an older build (or hand-edited in a restored backup) can't
 * carry a key that no longer matches its own name.
 */
export function normalizeIngredient(raw: unknown): RecipeIngredient | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RecipeIngredient>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, GROCERY_NAME_MAX_LENGTH) : '';
  if (!name) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : generateId(),
    name,
    nameKey: groceryNameKey(name),
    quantity: typeof r.quantity === 'string'
      ? r.quantity.trim().slice(0, GROCERY_QUANTITY_MAX_LENGTH)
      : '',
    aisle: typeof r.aisle === 'string' && r.aisle ? r.aisle : null,
    prep: typeof r.prep === 'string' && r.prep.trim()
      ? r.prep.trim().slice(0, PREP_MAX_LENGTH)
      : null,
    purpose: typeof r.purpose === 'string' && r.purpose.trim()
      ? r.purpose.trim().slice(0, PREP_MAX_LENGTH)
      : null,
    section: typeof r.section === 'string' && r.section.trim()
      ? r.section.trim().slice(0, RECIPE_SECTION_MAX_LENGTH)
      : null,
    choiceGroup: cleanChoiceGroup(typeof r.choiceGroup === 'string' ? r.choiceGroup : null),
  };
}

/**
 * One typed line ("2 lb chicken thighs") into an ingredient.
 *
 * Deliberately leaves `aisle` null rather than calling aisleForName here: the
 * lexicon's guess is worth making at *add* time, when addByName can weigh it
 * against what the user has actually filed. Baking a guess into the recipe
 * would outrank their own filings for ever after — the same mistake
 * deleteAisle avoids by forgetting overrides rather than rewriting them.
 */
export function makeIngredient(line: string): RecipeIngredient | null {
  const { name: rawName, quantity } = parseGroceryInput(line);
  if (!rawName.trim()) return null;
  const { name: afterPrep, prep } = splitPrep(rawName);
  if (!afterPrep.trim()) return null;
  // splitPurpose only runs when splitPrep didn't already take a comma clause
  // — a comma-based prep clause can legitimately contain "for" on its own
  // ("cheese, plus more for topping" is one prep note), so a raw line with a
  // comma has already had its trailing text claimed. `rawName` (not
  // `afterPrep`) is what's checked, since the comma sits before the prep
  // split either way.
  const purposeSplit = rawName.includes(',') ? null : splitPurpose(afterPrep);
  const name = purposeSplit ? purposeSplit.name : afterPrep;
  if (!name.trim()) return null;
  return {
    id: generateId(),
    name,
    nameKey: groceryNameKey(name),
    quantity: quantity ?? '',
    aisle: null,
    prep,
    purpose: purposeSplit?.purpose ?? null,
    section: null,
    choiceGroup: null,
  };
}

/**
 * A pasted ingredient list into ingredients, deduped on the catalog's own key
 * so a recipe listing salt twice doesn't carry it twice.
 *
 * splitGroceryLines already strips bullets and caps the paste; this adds only
 * the parse and the empty-name guard.
 */
export function ingredientsFromText(raw: string): RecipeIngredient[] {
  const out: RecipeIngredient[] = [];
  const seen = new Set<string>();
  for (const line of splitGroceryLines(raw)) {
    const ingredient = makeIngredient(line);
    if (!ingredient) continue;
    const key = ingredient.nameKey || ingredient.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ingredient);
  }
  return out;
}

/**
 * Merges new ingredients into an existing list, keeping the first occurrence of
 * each key. Used by both paste-into-an-existing-recipe and the editor's add
 * field, so "garlic" typed twice edits rather than duplicates.
 *
 * The *existing* row wins on a collision: it may carry a quantity or an aisle
 * the user set by hand, and silently replacing that with a freshly-parsed line
 * is the kind of quiet overwrite addByName refuses to do to a quantity.
 */
export function mergeIngredients(
  existing: readonly RecipeIngredient[],
  incoming: readonly RecipeIngredient[],
): RecipeIngredient[] {
  const out = [...existing];
  const seen = new Set(existing.map(i => i.nameKey || i.name.toLowerCase()));
  for (const ingredient of incoming) {
    const key = ingredient.nameKey || ingredient.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ingredient);
  }
  return out;
}

/**
 * Rewrites every ingredient sitting on `fromKey` to `toKey` across a set of
 * recipes, returning only the recipes that actually changed.
 *
 * This is the other half of the nameKey bridge: renaming a grocery item
 * rewrites its key, and without this the recipe keeps pointing at a spelling
 * that no longer exists. Returning only the changed rows is what lets the
 * store skip the write when a rename touches nothing — the same
 * null-when-unchanged shape rememberAisles uses.
 */
export function remapIngredientKeyIn(
  recipes: readonly Recipe[],
  fromKey: string,
  toKey: string,
): Recipe[] {
  if (!fromKey || !toKey || fromKey === toKey) return [];
  const changed: Recipe[] = [];
  for (const recipe of recipes) {
    if (!recipe.ingredients.some(i => i.nameKey === fromKey)) continue;
    changed.push({
      ...recipe,
      ingredients: recipe.ingredients.map(i =>
        i.nameKey === fromKey ? { ...i, nameKey: toKey } : i
      ),
    });
  }
  return changed;
}

/** Tolerates a null column, a corrupt blob, or a shape from a newer app version — same as parseRecipeIngredients. */
export function parsePrepTasks(raw: unknown): RecipePrepTask[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw as string); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizePrepTask).filter((t): t is RecipePrepTask => t !== null);
}

/** Repairs one stored prep task. Returns null for a row with no usable title — see normalizeIngredient. */
export function normalizePrepTask(raw: unknown): RecipePrepTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RecipePrepTask>;
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, TITLE_MAX_LENGTH) : '';
  if (!title) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : generateId(),
    title,
    offsetDays: typeof r.offsetDays === 'number' && Number.isFinite(r.offsetDays) ? Math.round(r.offsetDays) : 0,
    reminderOffsetMinutes: typeof r.reminderOffsetMinutes === 'number' && Number.isFinite(r.reminderOffsetMinutes)
      ? Math.round(r.reminderOffsetMinutes)
      : null,
  };
}

/**
 * A prep task plus the meal date it's attached to, into what `addTask` needs.
 *
 * Reuses templateUtils.resolveOffsetDate rather than re-deriving the same
 * noon-normalized-day math a second time — a prep task's `offsetDays` is
 * TemplateItem's `dueOffsetDays` reduced to one anchor (the meal itself,
 * never null), so the date arithmetic is identical. The reminder instant is
 * the same inline "dueDate minus N minutes" buildDraftsFromTemplate already
 * does, for the same reason: no separate "compute a reminder" helper exists
 * to call instead.
 */
export function resolvePrepTaskDraft(
  prepTask: RecipePrepTask,
  mealDate: Date
): { dueDate: string; reminderTime: string | null } {
  // Never null: mealDate is always a real Date and offsetDays is never null
  // on a RecipePrepTask (see the type).
  const dueDate = resolveOffsetDate(mealDate, prepTask.offsetDays)!;
  const reminderTime = prepTask.reminderOffsetMinutes !== null
    ? new Date(new Date(dueDate).getTime() - prepTask.reminderOffsetMinutes * 60_000).toISOString()
    : null;
  return { dueDate, reminderTime };
}

/** One prep step, resolved against a meal date and shaped for addTask. */
export interface PrepTaskDraft {
  title: string;
  dueDate: string;
  reminderTime: string | null;
}

/**
 * Every prep step a meal implies, resolved against the date it's planned for.
 *
 * Goes through flattenRecipePrepTasks rather than `recipe.prepTasks`, the same
 * discipline every shopping read keeps: a dish that is mostly its components
 * would otherwise look like it needed no prep at all. One place both callers
 * share — the offer made when the meal is planned, and the entry sheet's "Add
 * prep tasks" — so the two can't drift on which steps a composed dish has.
 *
 * `resolution` carries the meal's own either/or picks (MealPlanEntry.recipeChoices)
 * so a night having the roast potatoes doesn't get "boil the potatoes" on its
 * prep list. Omitted at plan time, when nothing has been chosen yet — the
 * offer that fires right after planning always sees the defaults.
 */
export function prepTaskDraftsForMeal(
  recipe: Recipe,
  recipesById: ReadonlyMap<string, Recipe>,
  mealDate: Date,
  resolution?: ChoiceResolution
): PrepTaskDraft[] {
  return flattenRecipePrepTasks(recipe, recipesById, resolution).map(({ prepTask }) => ({
    title: prepTask.title,
    ...resolvePrepTaskDraft(prepTask, mealDate),
  }));
}

/**
 * "4" or "4-6" — just the number(s), for callers that want to build their own
 * sentence around it (the editor's collapsed value, the extract preview).
 * Null when there's no servings count at all. A `max` that doesn't exceed
 * `servings` is ignored rather than trusted — `setServings` and
 * `extractRecipe` are the only writers and already refuse to store one, but a
 * restored backup could still carry a stale pair.
 */
export function formatServingsRange(servings: number | null, max: number | null): string | null {
  if (!servings) return null;
  if (max && max > servings) return `${servings}-${max}`;
  return String(servings);
}

/** Same as `formatServingsRange`, reading straight off a `Recipe`. */
export function formatServings(recipe: Recipe): string | null {
  return formatServingsRange(recipe.servings, recipe.servingsMax);
}

/**
 * "Breakfast · 8 ingredients · 1 component · 6 likely in pantry · serves 4-6 ·
 * NYT Cooking" — the recipe row's subtitle. `likelyInPantry` is optional and
 * omitted (both the param and, given a falsy count, the phrase) rather than
 * ever rendering "0 likely in pantry" — see `countLikelyInPantry`. The meal
 * type leads, ahead of the ingredient count, since it's the fact someone
 * scanning the list is most likely browsing by (see RecipeMealType).
 *
 * The ingredient count is the recipe's *own* lines, never the flattened total,
 * because it has to agree with the list the detail screen puts on screen right
 * under it. What the component clause is for is saying there's more: "3
 * ingredients" alone would read as the whole shop for a dish that's mostly its
 * parts.
 */
export function describeRecipe(recipe: Recipe, likelyInPantry?: number | null): string {
  // Choice-aware, so "serrano or jalapeño" reads as the one pepper a meal of
  // this actually buys — see countChoiceAware.
  const count = countChoiceAware(recipe.ingredients);
  const parts: string[] = [];
  if (recipe.mealType) parts.push(RECIPE_MEAL_TYPE_LABELS[recipe.mealType]);
  parts.push(count === 1 ? '1 ingredient' : `${count} ingredients`);
  const components = describeComponents(recipe);
  if (components) parts.push(components);
  if (likelyInPantry) {
    parts.push(likelyInPantry === 1 ? '1 likely in pantry' : `${likelyInPantry} likely in pantry`);
  }
  const servings = formatServings(recipe);
  if (servings) parts.push(`serves ${servings}`);
  if (recipe.recipeYield) parts.push(`makes ${recipe.recipeYield}`);
  if (recipe.estimatedMinutes) parts.push(formatDuration(recipe.estimatedMinutes));
  const attribution = describeAttribution(recipe);
  if (attribution) parts.push(attribution);
  return parts.join(' · ');
}

/**
 * How many of a recipe's ingredients grocerySuggest's pantry guess would call
 * "probably have" — the same `classifyPlanned` signal RecipeToListSheet and
 * AddWeekToListSheet already use to pre-collapse their "Probably have"
 * section, reused here rather than re-deriving it, and reduced to a count for
 * the recipe list row. Null (never 0) when there's nothing worth showing: no
 * ingredients, or nothing in the catalog reads as still on hand.
 *
 * `recipesById` counts a composed recipe's components in, so the number means
 * the same thing the "Add ingredients to list" sheet will show. Optional for
 * the same reason plannedIngredientsForRecipe's is.
 */
export function countLikelyInPantry(
  recipe: Recipe,
  items: readonly GroceryItem[],
  now: Date,
  recipesById?: ReadonlyMap<string, Recipe>,
): number | null {
  const coverage = pantryCoverageForRecipe(recipe, items, now, recipesById);
  return coverage.probablyHave > 0 ? coverage.probablyHave : null;
}

/**
 * The richer form of `countLikelyInPantry` (#1103) — a percentage plus enough
 * of its denominator for a caller to tell "we checked and it's low" apart
 * from "there's nothing to check against yet", which a bare count can't say.
 */
export interface PantryCoverage {
  /** Ingredient lines counted, after flattening to the resolved defaults — same denominator scoreRecipeAgainstCatalog uses. */
  total: number;
  /**
   * How many of those lines have *any* catalog row, matched or not — the
   * denominator for whether there's purchase history to judge by at all.
   * Zero here (with `total` > 0) is what makes `percent` null rather than 0:
   * a recipe of ingredients nobody has ever bought isn't "0% likely on
   * hand", it's unjudged.
   */
  catalogMatches: number;
  /** How many lines `classifyPlanned` currently calls "probably have" — grocerySuggest's pantry guess, or an explicit `onHandUntil` assertion. */
  probablyHave: number;
  /** `probablyHave / total` as a whole-number percentage. Null when there's nothing to compute it from: no ingredients, or none of them has ever been added to the grocery catalog. */
  percent: number | null;
}

/**
 * The pantry-coverage signal for one recipe — "you probably have ~60% of
 * this already" — built on the same `plannedIngredientsForRecipe` +
 * `classifyPlanned` pass `countLikelyInPantry` already reduces to a count,
 * kept here as a shape a suggestion row can render directly (see
 * `describePantryCoverage` and `SuggestMealsSheet`).
 *
 * `recipesById` folds a composed recipe's components in, same as
 * `countLikelyInPantry` — a dish that's mostly its parts must not read as
 * fully unjudged just because its own two lines are.
 */
export function pantryCoverageForRecipe(
  recipe: Recipe,
  items: readonly GroceryItem[],
  now: Date,
  recipesById?: ReadonlyMap<string, Recipe>,
): PantryCoverage {
  const planned = plannedIngredientsForRecipe(recipe, recipesById);
  if (planned.length === 0) return { total: 0, catalogMatches: 0, probablyHave: 0, percent: null };

  const classified = classifyPlanned(planned, items, now);
  const total = classified.length;
  const itemKeys = new Set(items.map(i => i.nameKey));
  const catalogMatches = classified.filter(row => itemKeys.has(row.nameKey)).length;
  const probablyHave = classified.filter(row => row.category === 'probablyHave').length;
  const percent = catalogMatches > 0 ? Math.round((probablyHave / total) * 100) : null;

  return { total, catalogMatches, probablyHave, percent };
}

/**
 * "~60% likely on hand" / "No purchase history for these yet" — the one line
 * a suggestion row renders next to a recipe. Null only when there's nothing
 * to say at all (no ingredients), same as `countLikelyInPantry`'s null.
 *
 * The no-catalog-match case is worded as a state, not a number: a bare "0%"
 * there would read as "you have none of this" when the honest answer is
 * "we've never seen these ingredients bought, so we can't guess" — the
 * graceful-degradation case #1103 asks for.
 */
export function describePantryCoverage(coverage: PantryCoverage): string | null {
  if (coverage.total === 0) return null;
  if (coverage.catalogMatches === 0) return 'No purchase history for these yet';
  return `~${coverage.percent}% likely on hand`;
}

/**
 * "by Alison Roman — Nothing Fancy", or whichever of author/source is set.
 * Falls back to the legacy sourceName only when neither new field has ever
 * been given a value — an old recipe nobody has re-edited since #1266.
 */
export function describeAttribution(recipe: Recipe): string | null {
  if (recipe.author && recipe.source) return `by ${recipe.author} — ${recipe.source}`;
  if (recipe.author) return `by ${recipe.author}`;
  if (recipe.source) return recipe.source;
  return recipe.sourceName || null;
}

/** Trims and caps a name for storage. Empty means "not a name" — callers refuse it. */
export function cleanRecipeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, RECIPE_NAME_MAX_LENGTH).trim();
}

/** Trims and caps a source byline ("NYT Cooking"). Empty is a valid answer — no attribution. */
export function cleanRecipeSource(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, RECIPE_SOURCE_MAX_LENGTH).trim();
}

/**
 * Trims and caps a choice group label, collapsing "no label" to null.
 *
 * The whitespace collapse is what makes typing an existing label join that
 * group rather than start a lookalike beside it — the label *is* the grouping
 * key (same as an aisle name), so "Side " and "Side" have to be one thing.
 */
export function cleanChoiceGroup(raw: string | null | undefined): string | null {
  const clean = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, RECIPE_CHOICE_GROUP_MAX_LENGTH).trim();
  return clean || null;
}

/**
 * Ranks recipes for the library's search field, mirroring
 * rankGrocerySuggestions' 3/2/1 prefix / word-start / substring weighting so
 * searching here behaves the way searching the catalog already does. Favorites
 * break ties; nothing else does, because Phase 1 has no cook history to rank on.
 *
 * The ingredient match runs over the *flattened* list, built from the same
 * `recipes` array rather than a second parameter — searching "potato" has to
 * find the dinner whose mash is where the potatoes are written down, or a
 * component is a place ingredients go to hide from search.
 */
export function rankRecipes(query: string, recipes: readonly Recipe[]): Recipe[] {
  const q = groceryNameKey(query);
  if (!q) return [...recipes];
  const byId = recipeMap(recipes);
  const scored: Array<{ recipe: Recipe; weight: number }> = [];
  for (const recipe of recipes) {
    const key = recipe.nameKey;
    let weight = 0;
    if (key.startsWith(q)) weight = 3;
    else if (key.split(' ').some(word => word.startsWith(q))) weight = 2;
    else if (key.includes(q)) weight = 1;
    // An ingredient match is a real hit — "what can I make with fennel" is the
    // question a recipe box is for — but it must never outrank a name match.
    // `allOptions` here and nowhere else that shops: an alternative the user
    // isn't cooking tonight is still an ingredient this recipe can call for, and
    // hiding it would make a recipe unfindable by a search for the very thing
    // it's sometimes made of. A result is an invitation to look, not a purchase.
    else if (flattenRecipeIngredients(recipe, byId, { allOptions: true })
      .some(f => f.ingredient.nameKey.includes(q))) weight = 0.5;
    if (weight > 0) scored.push({ recipe, weight });
  }
  return scored
    .sort((a, b) =>
      b.weight - a.weight ||
      Number(b.recipe.favorite) - Number(a.recipe.favorite) ||
      a.recipe.name.localeCompare(b.recipe.name)
    )
    .map(s => s.recipe);
}

/**
 * Field updates to apply when a cook timer session finishes — the recipe
 * counterpart of effort.ts's applyMeasuredTime. `lastCookMinutes` is always
 * set and `cookTimeCount`/`totalCookMinutes` always advance; `estimatedMinutes`
 * is only backfilled when the recipe has never had a duration of its own, so a
 * typed estimate is never silently overwritten by a single measurement —
 * exactly the rule applyMeasuredTime uses for a task's estimate/effort.
 */
export function applyMeasuredCookTime(
  minutes: number,
  recipe: Pick<Recipe, 'estimatedMinutes' | 'cookTimeCount' | 'totalCookMinutes'>
): {
  lastCookMinutes: number;
  cookTimeCount: number;
  totalCookMinutes: number;
  estimatedMinutes?: number;
} {
  const rounded = Math.max(1, Math.round(minutes));
  const patch = {
    lastCookMinutes: rounded,
    cookTimeCount: recipe.cookTimeCount + 1,
    totalCookMinutes: recipe.totalCookMinutes + rounded,
  };
  if (recipe.estimatedMinutes != null) return patch;
  return { ...patch, estimatedMinutes: rounded };
}

/**
 * The running average of logged cook sessions — `totalCookMinutes /
 * cookTimeCount`, derived at read time rather than stored, same as
 * describeShops derives a grocery item's per-store share from its links
 * rather than ever summing them into a stored total. Null until at least one
 * session has been logged.
 */
export function avgCookMinutes(recipe: Pick<Recipe, 'cookTimeCount' | 'totalCookMinutes'>): number | null {
  if (recipe.cookTimeCount <= 0) return null;
  return Math.round(recipe.totalCookMinutes / recipe.cookTimeCount);
}

/**
 * "Est. 25m · took 32m last time" / "Est. 25m · avg 30m over 4 cooks" — the
 * line that puts a recipe's static estimate next to what cooking it has
 * actually taken, so the two can be compared rather than the estimate just
 * being trusted forever. Empty when there's nothing to say yet.
 */
export function describeCookTime(recipe: Recipe): string {
  const parts: string[] = [];
  if (recipe.estimatedMinutes) parts.push(`Est. ${formatDuration(recipe.estimatedMinutes)}`);
  if (recipe.lastCookMinutes != null) {
    parts.push(recipe.cookTimeCount > 1
      ? `took ${formatDuration(recipe.lastCookMinutes)} last time`
      : `took ${formatDuration(recipe.lastCookMinutes)}`);
  }
  const avg = avgCookMinutes(recipe);
  if (avg != null && recipe.cookTimeCount > 1) {
    parts.push(`avg ${formatDuration(avg)} over ${recipe.cookTimeCount} cooks`);
  }
  return parts.join(' · ');
}

/**
 * Favorites-first ordering for the unfiltered recipe box — the same sort
 * RecipesScreen has always applied to its flat list, pulled out so
 * groupRecipesByMealType can give each of its sections the identical order
 * instead of inventing a second one. A search ranking (rankRecipes) is a
 * different question — "what matches this text" — so it's never routed
 * through here.
 */
export function sortRecipesForDisplay(recipes: readonly Recipe[]): Recipe[] {
  return [...recipes].sort((a, b) =>
    Number(b.favorite) - Number(a.favorite) || a.sortOrder - b.sortOrder
  );
}

export interface RecipeMealTypeSection {
  /** null is the trailing "Untagged" section — RecipeMealType has no null member of its own. */
  mealType: RecipeMealType | null;
  title: string;
  data: Recipe[];
}

/**
 * Groups recipes into sections by RecipeMealType, in RECIPE_MEAL_TYPES' fixed
 * display order — mirroring how makeCategoryGroups orders Today's category
 * sections by a fixed list rather than alphabetically or by section size.
 * Untagged recipes (mealType: null) trail in their own section rather than
 * leading like Today's header-less loose group, because here there's no drag
 * to strand a recipe "above": a section list is read top to bottom, and most
 * existing recipes predate this field, so leading with a wall of "Untagged"
 * would bury the very grouping the user just asked for.
 *
 * A meal type with no recipes is omitted entirely rather than rendered empty,
 * same as makeCategoryGroups omitting empty categories.
 */
export function groupRecipesByMealType(recipes: readonly Recipe[]): RecipeMealTypeSection[] {
  const byType = new Map<string, Recipe[]>();
  recipes.forEach(recipe => {
    const key = recipe.mealType ?? '';
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push(recipe);
  });

  const sections: RecipeMealTypeSection[] = [];
  RECIPE_MEAL_TYPES.forEach(mealType => {
    const list = byType.get(mealType);
    if (list && list.length > 0) {
      sections.push({ mealType, title: RECIPE_MEAL_TYPE_LABELS[mealType], data: sortRecipesForDisplay(list) });
    }
  });
  const untagged = byType.get('');
  if (untagged && untagged.length > 0) {
    sections.push({ mealType: null, title: 'Untagged', data: sortRecipesForDisplay(untagged) });
  }
  return sections;
}

/** "Cooked once" / "Cooked 4× · last on 12 Jul" — empty when never cooked. */
export function describeCookHistory(recipe: Recipe): string {
  if (recipe.cookCount === 0) return '';
  const times = recipe.cookCount === 1 ? 'once' : `${recipe.cookCount}×`;
  if (!recipe.lastCookedAt) return `Cooked ${times}`;
  return `Cooked ${times} · last on ${format(new Date(recipe.lastCookedAt), 'd MMM')}`;
}

const DAY_MS = 86_400_000;
/** Score halves every this many days since last cooked — mirrors grocerySuggest's monthly halving. */
const COOK_RECENCY_HALF_LIFE_DAYS = 30;

function cookFamiliarity(recipe: Recipe, now: Date): number {
  const frequency = 1 + Math.log1p(recipe.cookCount);
  const days = recipe.lastCookedAt
    ? Math.max(0, (now.getTime() - new Date(recipe.lastCookedAt).getTime()) / DAY_MS)
    : Infinity;
  const recency = days === Infinity ? 0.5 : 0.5 ** (days / COOK_RECENCY_HALF_LIFE_DAYS);
  return frequency * recency;
}

/**
 * The "Cook again" shelf — recipes made often and made recently, same
 * frequency × recency halving as rankGrocerySuggestions/buyAgainItems so this
 * behaves the way the grocery autocomplete has already taught the user to
 * expect. Only recipes with at least one cooking: a never-made recipe has
 * nothing to rank on here (rankRecipes' search already covers "what do I have").
 */
export function rankRecipeSuggestions(recipes: readonly Recipe[], now: Date, limit = 3): Recipe[] {
  return recipes
    .filter(r => r.cookCount > 0)
    .map(recipe => ({ recipe, score: cookFamiliarity(recipe, now) }))
    .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name))
    .slice(0, limit)
    .map(x => x.recipe);
}

/** Score halves every this many days since last bought — same monthly cadence as the cook-history one above. */
const PURCHASE_RECENCY_HALF_LIFE_DAYS = 30;

function purchaseRecency(item: GroceryItem, now: Date): number {
  if (!item.lastPurchasedAt) return 0.5; // in the catalog but never bought — a wash, not a penalty
  const days = Math.max(0, (now.getTime() - new Date(item.lastPurchasedAt).getTime()) / DAY_MS);
  return 0.5 ** (days / PURCHASE_RECENCY_HALF_LIFE_DAYS);
}

/**
 * How much a "what can I cook" suggestion should be discounted for having
 * been cooked recently (#1103) — the mirror image of `cookFamiliarity`
 * above: that one *rewards* a recent cook for the "Cook again" shelf,
 * because pulling up something you already know you like is the point of
 * that shelf. This one *penalizes* it, because the point of an empty-night
 * suggestion is variety — the same dinner every week is exactly what this
 * feature exists to avoid repeating.
 *
 * A two-week half-life (not the 30-day one used elsewhere) so "made this two
 * nights ago" reads as a real discount instead of a rounding error, while a
 * favorite from three-plus weeks back is most of the way back to full
 * strength. Never cooked (or no cook history) applies no discount at all —
 * `1`, not a bonus — since a made-up recency can't be more novel than
 * genuinely unknown.
 *
 * Bounded to at most a `MAX_RECENCY_DISCOUNT` (50%) cut, deliberately not
 * closer to 100%: catalog coverage is what answers "can I actually cook
 * this tonight", and recency is a nudge on top of that answer, not a veto —
 * a well-stocked recipe must still be able to outrank a poorly-stocked one
 * cooked a month ago, however many nights it's been.
 */
const SUGGESTION_NOVELTY_HALF_LIFE_DAYS = 14;
const MAX_RECENCY_DISCOUNT = 0.5;

function suggestionNovelty(recipe: Pick<Recipe, 'lastCookedAt'>, now: Date): number {
  if (!recipe.lastCookedAt) return 1;
  const days = Math.max(0, (now.getTime() - new Date(recipe.lastCookedAt).getTime()) / DAY_MS);
  const closeness = 0.5 ** (days / SUGGESTION_NOVELTY_HALF_LIFE_DAYS); // 1 right after cooking, → 0 as it fades
  return 1 - MAX_RECENCY_DISCOUNT * closeness;
}

/**
 * How well a recipe fits what's actually in the catalog, for "what can I
 * make tonight" — not what the user has cooked before (that's
 * rankRecipeSuggestions' job), but what they could cook *right now* without
 * a special trip. Coverage (the fraction of the recipe's ingredients that
 * are already known items) dominates; how recently those ingredients were
 * bought only nudges the ranking, since an item you bought once six months
 * ago still means you've made this before and know how to get it.
 *
 * How recently the *recipe itself* was last cooked nudges it the other way
 * (#1103, `suggestionNovelty`) — a recipe made two nights ago is discounted
 * so it doesn't crowd out something that hasn't come up in a while, without
 * that discount ever being able to drop a well-stocked recipe below a
 * poorly-stocked one just because it's due for a repeat.
 *
 * Zero for a recipe with no ingredients or nothing in common with the
 * catalog — there is nothing here to recommend it over any other empty
 * night, regardless of how long it's been since it was cooked.
 */
export function scoreRecipeAgainstCatalog(
  recipe: Recipe,
  items: readonly GroceryItem[],
  now: Date,
  recipesById?: ReadonlyMap<string, Recipe>,
): number {
  // Coverage has to be measured over everything the dish actually needs — a
  // parent with two ingredients of its own would otherwise score as a night's
  // cooking away from ready while its components' shopping list is untouched.
  //
  // Resolved to the defaults, deliberately unlike rankRecipes' `allOptions`
  // search: this is a fraction, and counting every alternative inflates the
  // denominator with lines that will never be bought, so a recipe offering a
  // choice would score as less ready than the same recipe without one.
  const ingredients = flattenRecipeIngredients(recipe, recipesById ?? new Map([[recipe.id, recipe]]))
    .map(f => f.ingredient);
  if (ingredients.length === 0) return 0;
  const byKey = new Map(items.map(i => [i.nameKey, i]));
  let matched = 0;
  let recencySum = 0;
  for (const ingredient of ingredients) {
    const item = byKey.get(ingredient.nameKey);
    if (!item) continue;
    matched += 1;
    recencySum += purchaseRecency(item, now);
  }
  if (matched === 0) return 0;
  const coverage = matched / ingredients.length;
  const avgRecency = recencySum / matched;
  const catalogFit = coverage * (0.5 + 0.5 * avgRecency);
  return catalogFit * suggestionNovelty(recipe, now);
}

/**
 * The "what can I make from what I've got" shelf for an empty night —
 * `scoreRecipeAgainstCatalog`, ranked and capped. Deliberately offline and
 * ungated: the AI half of meal-idea suggestion (inventing a new recipe from
 * nothing) is a separate, much larger surface — this is "the offline
 * suggestions should be the better ones" being taken at its word, not a
 * fallback for when there's no API key.
 */
export function suggestRecipesForEmptyNight(
  recipes: readonly Recipe[],
  items: readonly GroceryItem[],
  now: Date,
  limit = 3,
): Recipe[] {
  const byId = recipeMap(recipes);
  return recipes
    .map(recipe => ({ recipe, score: scoreRecipeAgainstCatalog(recipe, items, now, byId) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name))
    .slice(0, limit)
    .map(x => x.recipe);
}
