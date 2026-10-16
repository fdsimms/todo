/**
 * Cookbooks, the Up next shelf and a logged cook time: the
 * recipe library's own writes past a single recipe's fields (those are
 * `save_recipe` / `update_recipe` in logTools.ts). Each goes through the recipe
 * store's own action, which the replica loads (see `Replica.renameCookbook`).
 */
import type { Replica } from './replica';

export function listCookbooks(replica: Replica) {
  return {
    cookbooks: replica.cookbookSummaries()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(c => ({ id: c.id, title: c.title, ...(c.author ? { author: c.author } : {}), recipes: c.recipes })),
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

export function deleteCookbook(replica: Replica, id: string) {
  const r = replica.deleteCookbook(id);
  return { deleted: { id: r.cookbook.id, title: r.cookbook.title }, recipesUnlinked: r.recipesUnlinked };
}

export function reorderUpNext(replica: Replica, ids: string[]) {
  return { upNext: replica.reorderUpNext(ids).map(r => ({ id: r.id, name: r.name })) };
}

export function logCookTime(replica: Replica, id: string, minutes: number) {
  const r = replica.logCookTime(id, minutes);
  return { recipe: { id: r.id, name: r.name }, lastCookMinutes: r.lastCookMinutes, ...(r.estimatedMinutes ? { estimatedMinutes: r.estimatedMinutes } : {}) };
}
