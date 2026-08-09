import type { GroceryItem, Recipe, RecipeIngredient, RecipePrepTask } from '../types';
import {
  RECIPE_NAME_MAX_LENGTH,
  RECIPE_SOURCE_MAX_LENGTH,
  PREP_MAX_LENGTH,
  GROCERY_NAME_MAX_LENGTH,
  GROCERY_QUANTITY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from '../types';
import { format } from 'date-fns/format';
import { groceryNameKey, parseGroceryInput, splitGroceryLines, splitPrep } from './groceryParse';
import { generateId } from './id';
import { resolveOffsetDate } from './templateUtils';

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
  const { name, prep } = splitPrep(rawName);
  if (!name.trim()) return null;
  return {
    id: generateId(),
    name,
    nameKey: groceryNameKey(name),
    quantity: quantity ?? '',
    aisle: null,
    prep,
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

/** "8 ingredients · serves 4 · NYT Cooking" — the recipe row's subtitle. */
export function describeRecipe(recipe: Recipe): string {
  const count = recipe.ingredients.length;
  const parts = [count === 1 ? '1 ingredient' : `${count} ingredients`];
  if (recipe.servings) parts.push(`serves ${recipe.servings}`);
  if (recipe.sourceName) parts.push(recipe.sourceName);
  return parts.join(' · ');
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
 * Ranks recipes for the library's search field, mirroring
 * rankGrocerySuggestions' 3/2/1 prefix / word-start / substring weighting so
 * searching here behaves the way searching the catalog already does. Favorites
 * break ties; nothing else does, because Phase 1 has no cook history to rank on.
 */
export function rankRecipes(query: string, recipes: readonly Recipe[]): Recipe[] {
  const q = groceryNameKey(query);
  if (!q) return [...recipes];
  const scored: Array<{ recipe: Recipe; weight: number }> = [];
  for (const recipe of recipes) {
    const key = recipe.nameKey;
    let weight = 0;
    if (key.startsWith(q)) weight = 3;
    else if (key.split(' ').some(word => word.startsWith(q))) weight = 2;
    else if (key.includes(q)) weight = 1;
    // An ingredient match is a real hit — "what can I make with fennel" is the
    // question a recipe box is for — but it must never outrank a name match.
    else if (recipe.ingredients.some(i => i.nameKey.includes(q))) weight = 0.5;
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
 * How well a recipe fits what's actually in the catalog, for "what can I
 * make tonight" — not what the user has cooked before (that's
 * rankRecipeSuggestions' job), but what they could cook *right now* without
 * a special trip. Coverage (the fraction of the recipe's ingredients that
 * are already known items) dominates; how recently those ingredients were
 * bought only nudges the ranking, since an item you bought once six months
 * ago still means you've made this before and know how to get it.
 *
 * Zero for a recipe with no ingredients or nothing in common with the
 * catalog — there is nothing here to recommend it over any other empty
 * night.
 */
export function scoreRecipeAgainstCatalog(
  recipe: Recipe,
  items: readonly GroceryItem[],
  now: Date,
): number {
  if (recipe.ingredients.length === 0) return 0;
  const byKey = new Map(items.map(i => [i.nameKey, i]));
  let matched = 0;
  let recencySum = 0;
  for (const ingredient of recipe.ingredients) {
    const item = byKey.get(ingredient.nameKey);
    if (!item) continue;
    matched += 1;
    recencySum += purchaseRecency(item, now);
  }
  if (matched === 0) return 0;
  const coverage = matched / recipe.ingredients.length;
  const avgRecency = recencySum / matched;
  return coverage * (0.5 + 0.5 * avgRecency);
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
  return recipes
    .map(recipe => ({ recipe, score: scoreRecipeAgainstCatalog(recipe, items, now) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name))
    .slice(0, limit)
    .map(x => x.recipe);
}
