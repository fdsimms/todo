import type { ExtractedRecipe, RecipeGroceryItem } from '../services/aiSuggestions';
import type { RecipeIngredient } from '../types';
import { RECIPE_SECTION_MAX_LENGTH } from '../types';
import type { ParsedRecipePage } from './recipeUrl';
import { cleanRecipeName, makeIngredient, parseServingsRange } from './recipeUtils';

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
 * as well as the editor's own add field does, files a section only where the
 * page writes a heading line, and the rest not at all. Every
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
 * A line that heads the ingredients under it ("For the sauce:", "Dressing:"),
 * read as its label, or null for an ingredient. A trailing colon and no
 * leading amount: an ingredient line is never written that way.
 */
function ingredientHeading(line: string): string | null {
  const text = line.trim();
  if (!text.endsWith(':') || /^[\d\u00BC-\u00BE\u2150-\u215E]/.test(text)) return null;
  const label = text.slice(0, -1).trim().slice(0, RECIPE_SECTION_MAX_LENGTH).trim();
  return label || null;
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
  // Line by line rather than as one pasted block: a paste dedupes by name and
  // caps, which dropped the "1/4 cup olive oil" a page lists after "2 tbsp
  // olive oil" (the review flags a repeat for the person to settle) and a long
  // list's tail. Only a line repeated word for word is dropped. A heading line
  // ("For the sauce:") files the lines after it, rather than becoming an
  // ingredient row of its own that would go on the shopping list.
  const ingredients: OfflineRecipeItem[] = [];
  const seenLines = new Set<string>();
  let section: string | null = null;
  for (const line of page.ingredients) {
    const said = `${section ?? ''}\n${line.trim().toLowerCase()}`;
    if (seenLines.has(said)) continue;
    seenLines.add(said);
    const heading = ingredientHeading(line);
    if (heading !== null) {
      section = heading;
      continue;
    }
    const ingredient = makeIngredient(line.trim(), section);
    if (!ingredient) continue;
    const item: OfflineRecipeItem = {
      name: ingredient.name,
      quantity: ingredient.quantity,
      aisle: aisleFor(ingredient.name),
      section: ingredient.section,
      prep: ingredient.prep,
      purpose: ingredient.purpose,
    };
    if (ingredient.example) item.example = ingredient.example;
    ingredients.push(item);
  }
  if (ingredients.length === 0) return null;
  return {
    name: page.title ? cleanRecipeName(page.title) : '',
    ...servingsFromYield(page.recipeYield),
    // The page's total time, which is what the extractor's `prepMinutes`
    // carries too: the sheet files it under `estimatedMinutes` for that reason.
    prepMinutes: page.totalMinutes !== null && page.totalMinutes > 0 ? page.totalMinutes : null,
    leftoverKeepDays: null,
    ovenTemp: null,
    ovenTempUnit: 'F',
    ovenTempStep: null,
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
