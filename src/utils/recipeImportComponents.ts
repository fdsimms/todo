import type { Recipe } from '../types';
import type { ExtractedRecipeReference, RecipeGroceryItem } from '../services/aiSuggestions';
import { groceryNameKey } from './groceryParse';
import { recipeMap, wouldCreateRecipeCycle } from './recipeComponents';

/**
 * Turning "…and there's a salsa verde on page 45" into something the import
 * sheets can offer to act on.
 *
 * A cookbook page is the one recipe source that routinely points at *another*
 * recipe the app can't go and fetch — the book is paper, page 45 is a page
 * turn away, and the only person who can get it is the one already holding the
 * phone over the book. So the callout is deliberately made **during the
 * import, while the book is still open**, rather than filed as a note to act on
 * later: the whole value of it is that the next photo is one page turn away.
 * Nothing here is persisted; a reference the user ignores leaves no trace, and
 * the ingredient line it was attached to stays exactly as it always was.
 *
 * The model's half of this lives in `extractRecipe` (`referencedRecipes`);
 * this half decides which of what came back is worth offering, and what
 * accepting one does to the shopping list.
 */

/**
 * One reference, sized up against the recipe box it landed in.
 *
 * `match` is what decides the whole shape of the offer: a reference the user
 * already has a recipe for is one tap (link the two), and one they don't is an
 * invitation to turn to that page and take a second photo.
 */
export interface ReferenceCandidate {
  /** What the model read off the page, verbatim. */
  reference: ExtractedRecipeReference;
  /** `groceryNameKey(reference.name)` — the identity everything here matches on. */
  key: string;
  /** The recipe already in the box that this names, or null. */
  match: Recipe | null;
  /** "45", "112-115", or null when the locator isn't a page number at all. */
  page: string | null;
}

/**
 * The page number inside a locator, for stamping onto the recipe imported from
 * it (`Recipe.sourcePage`, alongside `sourceType: 'cookbook'`).
 *
 * This is the same class of thing a link import's `siteName` is: the source's
 * own statement about where it lives, taken verbatim rather than guessed at.
 * A locator that isn't a page ("opposite", "see the sauces chapter") returns
 * null and the imported recipe simply carries no page, which is honest — the
 * alternative is writing "opposite" into a field the source picker renders as
 * a page number.
 *
 * A range is only a range when it counts upward ("112-115"); "45-2" is a typo
 * or a hyphenated something-else, and the first number alone is the safe read.
 */
export function referencePageNumber(reference: string): string | null {
  const match = /\b(?:pages?|pgs?|p\.?)\s*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?\b/i.exec(reference);
  if (!match) return null;
  const from = match[1];
  const to = match[2];
  if (to && Number(to) > Number(from)) return `${from}-${to}`;
  return from;
}

/**
 * Which of the model's references are worth putting in front of the user.
 *
 * Every rule here is a case where offering the reference would be offering
 * something the app would then refuse to do, which is worse than staying
 * quiet:
 *
 * - **A reference naming the recipe being imported.** A page that repeats its
 *   own title in a "see also" is common enough, and a recipe cannot be its own
 *   component.
 * - **A reference already linked as a component.** Re-importing a page into a
 *   recipe that already has the mash attached shouldn't offer the mash again.
 * - **A reference whose link would be a cycle.** `addComponent` refuses these
 *   (and must — see docs/arch/recipes.md), so an offer that ends in a silent
 *   no-op is an offer not worth making. Checked with the same helper the store
 *   checks with, so the two can't come to disagree.
 *
 * `parent` is null from `RecipeCreateSheet`, where the recipe doesn't exist
 * yet: nothing it could collide with exists either, so every reference the
 * model gave survives.
 */
export function importableReferences(
  references: readonly ExtractedRecipeReference[],
  recipes: readonly Recipe[],
  parent: Recipe | null,
): ReferenceCandidate[] {
  const byId = parent ? recipeMap(recipes) : null;
  const seen = new Set<string>();
  const result: ReferenceCandidate[] = [];

  for (const reference of references) {
    const key = groceryNameKey(reference.name);
    if (!key || seen.has(key)) continue;
    if (parent && key === parent.nameKey) continue;

    const match = recipes.find(r => r.nameKey === key) ?? null;
    if (parent && match) {
      if (match.id === parent.id) continue;
      if (parent.components.some(c => c.recipeId === match.id)) continue;
      if (byId && wouldCreateRecipeCycle(byId, parent.id, match.id)) continue;
    }

    seen.add(key);
    result.push({
      reference,
      key,
      match,
      page: referencePageNumber(reference.reference),
    });
  }
  return result;
}

/**
 * The ingredient rows a set of accepted references makes redundant, by index.
 *
 * **This is a correctness rule, not tidiness.** Every shopping read flattens a
 * recipe through its components (docs/arch/recipes.md), so once "Salsa verde"
 * is a component, its tomatillos and chillies are already on the list. Leaving
 * the parent's own "salsa verde" line ticked as well buys a jar of the thing
 * you are about to spend twenty minutes making — the exact double the
 * component graph exists to avoid.
 *
 * Matched on the same `groceryNameKey` the reference itself is keyed by, which
 * is also the key the catalog files under, so "Salsa Verde" the recipe and
 * "salsa verde" the ingredient line meet without either side being asked to
 * spell it the other's way.
 */
export function coveredIngredients(
  ingredients: readonly RecipeGroceryItem[],
  candidates: readonly ReferenceCandidate[],
  acceptedKeys: ReadonlySet<string>,
): Map<number, string> {
  const covered = new Map<number, string>();
  if (acceptedKeys.size === 0) return covered;

  // The name the *first* page used for it, not the title of whatever page 45
  // turned out to be called: it's the ingredient line's own word for the thing,
  // which is what makes the note read as an explanation of that line.
  const nameByKey = new Map<string, string>();
  for (const candidate of candidates) {
    if (acceptedKeys.has(candidate.key)) nameByKey.set(candidate.key, candidate.reference.name);
  }

  ingredients.forEach((row, index) => {
    const key = groceryNameKey(row.name);
    const name = key ? nameByKey.get(key) : undefined;
    if (name) covered.set(index, name);
  });
  return covered;
}
