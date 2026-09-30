import type { Cookbook, CookbookIndexEntry, Recipe } from '../types';
import { GROCERY_NAME_MAX_LENGTH } from '../types';
import { groceryNameKey } from './groceryParse';
import { pluralKeyVariants } from './groceryPlural';
import { flattenRecipeIngredients, recipeMap } from './recipeComponents';
import { cleanRecipeName, cleanSourcePage, recipeInBook, recipeNameKey, recipeVoteRank } from './recipeUtils';
import { cookbookPageKey } from './cookbookRecipes';

/**
 * A cookbook's index, and the "Cook with" finder that searches it.
 *
 * An index entry is a dish, its page and the ingredients the index files it
 * under, and it is **deliberately not a recipe** (see `CookbookIndexEntry` in
 * types, and docs/arch/recipes.md). Nothing in the recipe box, the pickers,
 * the meal plan or the grocery list reads the table, so an index of 150 dishes
 * can't turn up anywhere it wasn't asked for. The finder is the one place it
 * is asked for: "what can I make with lentils?", answered from the recipes you
 * have typed up and from the books on your shelf.
 *
 * Pure and store-free, so the rules below are tested without a database.
 */

/** An index lists a handful of ingredients under a dish, never a whole list. */
export const MAX_INDEX_INGREDIENTS = 12;

/** A dish's name as the index prints it, trimmed and capped like a recipe's. */
export function cleanIndexTitle(raw: string): string {
  return cleanRecipeName(raw);
}

/**
 * A page as printed ("142", "112-115", "xiv"), or null for none. The same
 * cleaning `setSourcePage` gives a recipe's page, so a page that moves from an
 * entry onto the recipe made from it reads the same on both.
 */
export function cleanIndexPage(raw: string | null | undefined): string | null {
  return cleanSourcePage(raw) || null;
}

/**
 * The ingredient words worth keeping: trimmed, capped, empties dropped, and a
 * second spelling of one already kept ("Lentils" after "lentils") dropped too.
 * Order is kept, since it is the order they were typed or printed in.
 */
export function cleanIndexIngredients(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    const word = raw.trim().replace(/\s+/g, ' ').slice(0, GROCERY_NAME_MAX_LENGTH).trim();
    const key = groceryNameKey(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= MAX_INDEX_INGREDIENTS) break;
  }
  return out;
}

/** What the entry form hands the store: every field as typed. */
export interface IndexEntryFields {
  title: string;
  page: string | null;
  ingredients: readonly string[];
}

/** The fields as stored, or null when there's no title to file them under. */
export function cleanIndexEntryFields(
  fields: IndexEntryFields,
): Pick<CookbookIndexEntry, 'title' | 'page' | 'ingredients'> | null {
  const title = cleanIndexTitle(fields.title);
  if (!title) return null;
  return { title, page: cleanIndexPage(fields.page), ingredients: cleanIndexIngredients(fields.ingredients) };
}

/**
 * The line already in `cookbookId`'s index under this dish's name, which is
 * what `addIndexEntry` refuses a second one over. Keyed by `recipeNameKey`,
 * the key a recipe's name is refused on, so the entry and the recipe made
 * from it (`recipeFromIndexEntry`) are one name to both.
 */
export function indexEntryInBook(
  entries: readonly CookbookIndexEntry[],
  title: string,
  cookbookId: string,
): CookbookIndexEntry | null {
  const key = recipeNameKey(title);
  if (!key) return null;
  return entries.find(e => e.cookbookId === cookbookId && recipeNameKey(e.title) === key) ?? null;
}

/** "lentils, shallots; parsley" → the three words, as the entry form takes them. */
export function splitIngredientText(text: string): string[] {
  return text.split(/[,;\n]/);
}

/** The same word, or its singular or plural ("lentil" and "lentils"). */
function sameWord(a: string, b: string): boolean {
  return a === b || pluralKeyVariants(a).includes(b);
}

/**
 * Whether a key names the wanted ingredient, word for word: "red lentils"
 * mentions "lentils", "lentil" mentions "lentils", and "eggplant" does not
 * mention "egg".
 *
 * Whole words rather than a substring, which is what `rankRecipes` uses, since
 * here every result claims to *use* the thing and "egg" turning up aubergine
 * dishes would be a claim that's plainly wrong. Tolerant of a plural on each
 * word through `pluralKeyVariants`, the one rule the catalog already uses for
 * "is this the same shelf item", rather than a second stemmer. It does let
 * "cream" find "ice cream", which `useUpRecipes` refuses: that one suggests
 * cooking something unasked, where this answers a search someone typed, and
 * a result they can look past costs less than one they never see.
 */
export function mentionsIngredient(key: string, wantedKey: string): boolean {
  const words = key.split(' ').filter(Boolean);
  const wanted = wantedKey.split(' ').filter(Boolean);
  if (wanted.length === 0 || wanted.length > words.length) return false;
  for (let start = 0; start + wanted.length <= words.length; start++) {
    if (wanted.every((w, i) => sameWord(words[start + i], w))) return true;
  }
  return false;
}

/** A recipe you have typed up that uses some of what was asked for. */
export interface FinderRecipeHit {
  recipe: Recipe;
  /** The wanted ingredients it uses, as they were asked for, in that order. */
  matched: string[];
}

/** A cookbook index line that uses some of what was asked for. */
export interface FinderEntryHit {
  entry: CookbookIndexEntry;
  cookbook: Cookbook | null;
  matched: string[];
  /**
   * The recipe already made from this entry (same book, same name), when it
   * has nothing typed into it yet. Opening the entry opens that. An entry whose
   * recipe *has* been typed up isn't a hit at all: the recipe answers for it.
   */
  recipe: Recipe | null;
}

export interface FinderResults {
  recipes: FinderRecipeHit[];
  entries: FinderEntryHit[];
}

/**
 * Everything that uses any of `wanted`, most matches first.
 *
 * Any rather than all, because the question is "what could I make with
 * these", and a dish using two of three is still an answer; the count decides
 * the order, so the dishes using all of them come first.
 *
 * - **Your recipes** are matched on their whole ingredient list, flattened
 *   through components with every option of a choice counted (`allOptions`,
 *   the same read `rankRecipes` makes), since a recipe that can be made with
 *   lentils uses them. Its name isn't read: a recipe says what it uses.
 * - **Index entries** are matched on the ingredients the index files them
 *   under *and* on their title, since a title-only index ("Lentil soup, 88")
 *   says what a dish uses in its name and nowhere else.
 * - An entry whose recipe you have already typed up is left out: that recipe
 *   is the better answer, and shows under yours when it matches.
 */
export function findWithIngredients(
  wanted: readonly string[],
  recipes: readonly Recipe[],
  entries: readonly CookbookIndexEntry[],
  cookbooks: readonly Cookbook[],
): FinderResults {
  const asked = cleanIndexIngredients(wanted).map(word => ({ word, key: groceryNameKey(word) }));
  if (asked.length === 0) return { recipes: [], entries: [] };
  const matchedIn = (keys: readonly string[]) =>
    asked.filter(a => keys.some(key => mentionsIngredient(key, a.key))).map(a => a.word);

  const byId = recipeMap(recipes);
  const recipeHits: FinderRecipeHit[] = [];
  for (const recipe of recipes) {
    const keys = flattenRecipeIngredients(recipe, byId, { allOptions: true }).map(f => f.ingredient.nameKey);
    const matched = matchedIn(keys);
    if (matched.length > 0) recipeHits.push({ recipe, matched });
  }
  recipeHits.sort((a, b) =>
    b.matched.length - a.matched.length
    || recipeVoteRank(a.recipe.vote) - recipeVoteRank(b.recipe.vote)
    || a.recipe.name.localeCompare(b.recipe.name));

  const booksById = new Map(cookbooks.map(c => [c.id, c]));
  const entryHits: FinderEntryHit[] = [];
  for (const entry of entries) {
    const recipe = recipeInBook(recipes, entry.title, entry.cookbookId);
    if (recipe && hasContent(recipe)) continue;
    const keys = [...entry.ingredients.map(groceryNameKey), groceryNameKey(entry.title)];
    const matched = matchedIn(keys);
    if (matched.length === 0) continue;
    entryHits.push({ entry, cookbook: booksById.get(entry.cookbookId) ?? null, matched, recipe });
  }
  entryHits.sort((a, b) =>
    b.matched.length - a.matched.length
    || (a.cookbook?.title ?? '').localeCompare(b.cookbook?.title ?? '')
    || comparePages(a.entry.page, b.entry.page)
    || a.entry.title.localeCompare(b.entry.title));

  return { recipes: recipeHits, entries: entryHits };
}

/** A book's index in the book's own order: page, then name. */
export function entriesInCookbook(entries: readonly CookbookIndexEntry[], cookbookId: string): CookbookIndexEntry[] {
  return entries
    .filter(e => e.cookbookId === cookbookId)
    .sort((a, b) => comparePages(a.page, b.page) || a.title.localeCompare(b.title));
}

/**
 * "Six Seasons, p. 142", or whichever half exists: where to go and look. The
 * book comes first because that's the thing on the shelf.
 */
export function describeIndexLocation(entry: CookbookIndexEntry, cookbook: Cookbook | null): string {
  const page = entry.page ? `p. ${entry.page}` : null;
  return [cookbook?.title ?? null, page].filter(Boolean).join(', ');
}

/** Whether a recipe has anything in it beyond a name: the difference between typed up and not. */
function hasContent(recipe: Recipe): boolean {
  return recipe.ingredients.length > 0 || recipe.components.length > 0 || recipe.steps.length > 0;
}

function comparePages(a: string | null, b: string | null): number {
  const ka = cookbookPageKey(a);
  const kb = cookbookPageKey(b);
  return ka.band - kb.band || ka.n - kb.n;
}
