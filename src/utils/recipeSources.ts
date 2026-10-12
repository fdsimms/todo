/**
 * What each recipe asked of one grocery row, once more than one has.
 *
 * `GroceryItem.sourceRecipeId` is a single credit and drops to null the moment
 * a second recipe wants the same row, because crediting either one would be
 * wrong. That left a row like "scallions" holding a merged amount ("2, chopped,
 * white and green parts divided · 2, chopped") with nothing saying which part
 * was for which dish. These are the per-recipe amounts behind that string.
 *
 * Stored as JSON on the row and meaningful only while `quantityFromRecipe` is
 * true (`recipeLedgerFor` enforces it): every site that ends a shop already
 * clears that flag, so none of them has to clear this too.
 */
import type { GroceryItem, GroceryRecipeSource } from '../types';
import { mergeQuantities } from './mealPlanGroceries';
import { parseRecipeSources, serializeRecipeSources } from './recipeSourcesCodec';

export { parseRecipeSources, serializeRecipeSources };

const sameRecipe = (a: GroceryRecipeSource, b: GroceryRecipeSource) =>
  a.recipeId !== null && b.recipeId !== null ? a.recipeId === b.recipeId : a.title === b.title;

/**
 * Folds `incoming` into `base`, one entry per recipe. A recipe already present
 * has its amounts added the way the row's own quantity is (`mergeQuantities`),
 * so the entries always agree with the merged string.
 */
export function foldRecipeSources(
  base: readonly GroceryRecipeSource[],
  incoming: readonly GroceryRecipeSource[],
): GroceryRecipeSource[] {
  const out = base.map(s => ({ ...s }));
  for (const next of incoming) {
    const at = out.findIndex(s => sameRecipe(s, next));
    if (at === -1) { out.push({ ...next }); continue; }
    const merged = mergeQuantities([out[at]!.quantity ?? '', next.quantity ?? '']);
    out[at] = { ...out[at]!, quantity: merged || null };
  }
  return out;
}

/** The sources a single planned line contributes: its own, or the one recipe it names. */
export function incomingSourcesOf(row: {
  quantity: string | null;
  sourceRecipeId?: string | null;
  sourceRecipeTitle?: string | null;
  recipeSources?: readonly GroceryRecipeSource[];
}): GroceryRecipeSource[] {
  if (row.recipeSources && row.recipeSources.length > 0) return [...row.recipeSources];
  if (!row.sourceRecipeTitle) return [];
  return [{ recipeId: row.sourceRecipeId ?? null, title: row.sourceRecipeTitle, quantity: row.quantity || null }];
}

/** A row's sources as they stand: the stored list, else the single credit it carries. */
export function currentSourcesOf(item: Pick<GroceryItem, 'recipeSources' | 'sourceRecipeId' | 'sourceRecipeTitle' | 'quantity'>): GroceryRecipeSource[] {
  if (item.recipeSources && item.recipeSources.length > 0) return [...item.recipeSources];
  if (!item.sourceRecipeTitle) return [];
  return [{ recipeId: item.sourceRecipeId, title: item.sourceRecipeTitle, quantity: item.quantity || null }];
}

export type RecipeLedger =
  /** Amounts that can't be added: one line per recipe, each with its own amount. */
  | { kind: 'ledger'; lines: GroceryRecipeSource[] }
  /** Amounts that already sum into the row's one quantity: only the number of recipes is left to say. */
  | { kind: 'count'; count: number };

/**
 * How a row from two or more recipes should say so, or null when it isn't one.
 * Null unless the recipes still own the quantity (see the header): a row whose
 * amount was typed by hand, or whose shop is over, says nothing about them.
 */
export function recipeLedgerFor(
  item: Pick<GroceryItem, 'recipeSources' | 'quantityFromRecipe'>,
): RecipeLedger | null {
  const sources = item.recipeSources;
  if (!item.quantityFromRecipe || !sources || sources.length < 2) return null;
  const quantities = sources.map(s => s.quantity ?? '').filter(Boolean);
  const merged = mergeQuantities(quantities);
  if (quantities.length < 2 || !merged.includes(' · ')) return { kind: 'count', count: sources.length };
  return { kind: 'ledger', lines: sources };
}

/**
 * The patch a recipe adding to a row already on the list makes to its sources,
 * or null when the row stays a single-recipe one (or isn't recipe-owned).
 */
export function sourcesAfterMerge(
  existing: GroceryItem,
  row: Parameters<typeof incomingSourcesOf>[0],
): GroceryRecipeSource[] | null {
  if (!existing.quantityFromRecipe) return null;
  const incoming = incomingSourcesOf(row);
  if (incoming.length === 0) return null;
  const next = foldRecipeSources(currentSourcesOf(existing), incoming);
  if (next.length < 2) return null;
  return JSON.stringify(next) === JSON.stringify(existing.recipeSources ?? []) ? null : next;
}
