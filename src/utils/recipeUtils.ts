import type { Recipe, RecipeIngredient } from '../types';
import {
  RECIPE_NAME_MAX_LENGTH,
  RECIPE_SOURCE_MAX_LENGTH,
  GROCERY_NAME_MAX_LENGTH,
  GROCERY_QUANTITY_MAX_LENGTH,
} from '../types';
import { groceryNameKey, parseGroceryInput, splitGroceryLines } from './groceryParse';
import { generateId } from './id';

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
  const { name, quantity } = parseGroceryInput(line);
  if (!name.trim()) return null;
  return {
    id: generateId(),
    name,
    nameKey: groceryNameKey(name),
    quantity: quantity ?? '',
    aisle: null,
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
