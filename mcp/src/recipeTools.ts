/**
 * Cookbooks, their indexes, the Up next shelf and a logged cook time: the
 * recipe library's own writes past a single recipe's fields (those are
 * `save_recipe` / `update_recipe` in logTools.ts). Each goes through the recipe
 * store's own action, which the replica loads (see `Replica.renameCookbook`).
 */
import type { CookbookIndexEntry } from '../../src/types';
import type { IndexEntryInput, Replica } from './replica';
import { getRecipe } from './kitchenTools';

function serializeEntry(e: CookbookIndexEntry) {
  return {
    id: e.id,
    title: e.title,
    ...(e.page ? { page: e.page } : {}),
    ...(e.ingredients.length > 0 ? { ingredients: e.ingredients } : {}),
  };
}

export function listCookbooks(replica: Replica) {
  return {
    cookbooks: replica.cookbookSummaries()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(c => ({ id: c.id, title: c.title, ...(c.author ? { author: c.author } : {}), recipes: c.recipes, indexEntries: c.indexEntries })),
  };
}

export function getCookbookIndex(replica: Replica, cookbookId: string) {
  const book = replica.cookbookSummaries().find(c => c.id === cookbookId);
  if (!book) throw new Error(`No cookbook with id ${cookbookId}. list_cookbooks lists them.`);
  return {
    cookbook: { id: book.id, title: book.title, ...(book.author ? { author: book.author } : {}) },
    // An index line is a pointer to a page, not a recipe; recipe_from_index_entry makes one.
    entries: replica.cookbookIndex(cookbookId).sort((a, b) => a.title.localeCompare(b.title)).map(serializeEntry),
  };
}

export function renameCookbook(replica: Replica, id: string, title: string, author?: string | null) {
  const book = replica.renameCookbook(id, title, author);
  return { cookbook: { id: book.id, title: book.title, ...(book.author ? { author: book.author } : {}) } };
}

export function mergeCookbooks(replica: Replica, keepId: string, mergeId: string) {
  const r = replica.mergeCookbooks(keepId, mergeId);
  return {
    kept: { id: r.survivor.id, title: r.survivor.title },
    merged: r.merged.title,
    recipesMoved: r.recipesMoved,
  };
}

export function saveIndexEntry(replica: Replica, input: IndexEntryInput) {
  return { entry: serializeEntry(replica.saveIndexEntry(input)) };
}

export function deleteIndexEntry(replica: Replica, id: string) {
  const e = replica.deleteIndexEntry(id);
  return { deleted: { id: e.id, title: e.title } };
}

export function recipeFromIndexEntry(replica: Replica, id: string) {
  const { recipe, created } = replica.recipeFromIndexEntry(id);
  return {
    recipe: getRecipe(replica, recipe.id),
    created,
    ...(created ? { note: 'It has the book and page and nothing else yet; update_recipe fills in its ingredients and steps.' } : { note: 'That book already had this recipe.' }),
  };
}

export function reorderUpNext(replica: Replica, ids: string[]) {
  return { upNext: replica.reorderUpNext(ids).map(r => ({ id: r.id, name: r.name })) };
}

export function logCookTime(replica: Replica, id: string, minutes: number) {
  const r = replica.logCookTime(id, minutes);
  return { recipe: { id: r.id, name: r.name }, lastCookMinutes: r.lastCookMinutes, ...(r.estimatedMinutes ? { estimatedMinutes: r.estimatedMinutes } : {}) };
}
