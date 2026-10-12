/** The column codec for `GroceryItem.recipeSources`, apart from `recipeSources.ts` so `database.ts` can import it without a cycle through the plan code. */
import type { GroceryRecipeSource } from '../types';

export function parseRecipeSources(json: string | null | undefined): GroceryRecipeSource[] | undefined {
  if (!json) return undefined;
  try {
    const raw: unknown = JSON.parse(json);
    if (!Array.isArray(raw)) return undefined;
    const out: GroceryRecipeSource[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.title !== 'string' || !e.title) continue;
      out.push({
        recipeId: typeof e.recipeId === 'string' ? e.recipeId : null,
        title: e.title,
        quantity: typeof e.quantity === 'string' && e.quantity ? e.quantity : null,
      });
    }
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

export function serializeRecipeSources(sources: readonly GroceryRecipeSource[] | undefined): string | null {
  return sources && sources.length > 0 ? JSON.stringify(sources) : null;
}
