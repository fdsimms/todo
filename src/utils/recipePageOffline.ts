import type { ExtractedRecipe, RecipeGroceryItem } from '../services/aiSuggestions';
import type { RecipeIngredient } from '../types';
import type { ParsedRecipePage } from './recipeUrl';
import { cleanRecipeName, ingredientsFromText, parseServingsRange } from './recipeUtils';

/**
 * Importing a recipe from a link with no API key at all.
 *
 * `extractRecipe` is the good path and stays the good path; this is what the
 * link import does when there is no key to spend, the same arrangement
 * `receiptOffline.ts` has with `extractReceipt`. It exists because most of a
 * recipe page never needed the model: a page publishing `schema.org/Recipe`
 * already states its title, method, yield, time and attribution as data
 * (`parseRecipePage` has been reading those for the model's benefit all
 * along), and its ingredient lines are exactly what the keyless parser behind
 * "paste ingredients into a recipe" reads (`ingredientsFromText`).
 *
 * **It is honestly worse, and only for the ingredients.** The model names each
 * line the way a shop labels it, splits prep out of the name, marks optional
 * lines and water, and files a section; the offline parse does the first two
 * as well as the editor's own add field does and the rest not at all. Every
 * row is still reviewed before anything is written, the same as the model's.
 *
 * **It refuses rather than guesses.** A page with no structured recipe, or one
 * whose recipe lists no ingredients, returns null: reading a recipe out of
 * stripped page text is the model's job, and a guess at it here is how a
 * sidebar ends up in the ingredient list (the same reason `parseRecipePage`
 * never takes a method from page text).
 */

/** One ingredient row as the review list holds it, keeping what the parse split out. */
export type OfflineRecipeItem = RecipeGroceryItem & Pick<RecipeIngredient, 'purpose'> & { example?: string };

/**
 * A page's `recipeYield` as either a serving count or a free-text yield, the
 * two fields `ExtractedRecipe` keeps apart. "4 servings", "Serves 4-6" and a
 * bare "4" are servings; "2 loaves" and "3 cups" are what the recipe makes.
 */
export function servingsFromYield(
  recipeYield: string | null,
): Pick<ExtractedRecipe, 'servings' | 'servingsMax' | 'recipeYield'> {
  const text = recipeYield?.trim() ?? '';
  if (!text) return { servings: null, servingsMax: null, recipeYield: null };
  const servingsLike = /^\s*(?:serves|makes|yield:?)?\s*\d+(?:\s*(?:-|–|to)\s*\d+)?\s*(?:servings?|people|persons?|portions?)?\s*$/i
    .test(text);
  const range = servingsLike ? parseServingsRange(text) : null;
  if (range) {
    const clamp = (n: number) => Math.min(99, Math.max(1, n));
    const servings = clamp(range.servings);
    const max = range.servingsMax !== null ? clamp(range.servingsMax) : null;
    return { servings, servingsMax: max !== null && max > servings ? max : null, recipeYield: null };
  }
  return { servings: null, servingsMax: null, recipeYield: text };
}

/**
 * The page read as `extractRecipe` would have returned it, or null when it
 * published nothing to build from. `aisleFor` is the caller's own filing rule
 * (the sheet passes the one it already uses for an edited row's name).
 */
export function recipeFromPageOffline(
  page: ParsedRecipePage,
  aisleFor: (name: string) => string,
): ExtractedRecipe | null {
  if (!page.structured || page.ingredients.length === 0) return null;
  const ingredients: OfflineRecipeItem[] = ingredientsFromText(page.ingredients.join('\n')).map(ingredient => {
    const item: OfflineRecipeItem = {
      name: ingredient.name,
      quantity: ingredient.quantity,
      aisle: aisleFor(ingredient.name),
      section: null,
      prep: ingredient.prep,
      purpose: ingredient.purpose,
    };
    if (ingredient.example) item.example = ingredient.example;
    return item;
  });
  if (ingredients.length === 0) return null;
  return {
    name: page.title ? cleanRecipeName(page.title) : '',
    ...servingsFromYield(page.recipeYield),
    // The page's total time, which is what the extractor's `prepMinutes`
    // carries too: the sheet files it under `estimatedMinutes` for that reason.
    prepMinutes: page.totalMinutes !== null && page.totalMinutes > 0 ? page.totalMinutes : null,
    leftoverKeepDays: null,
    ingredients,
    // The page's own attribution is read by `sourceFieldsFor` off the page
    // itself, so there is nothing for these to add.
    sourceTitle: null,
    sourceAuthor: null,
    sourcePage: null,
    sourceType: null,
    references: [],
    steps: page.steps,
    prepTasks: [],
  };
}
