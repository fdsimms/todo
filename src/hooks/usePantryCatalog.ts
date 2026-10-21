import { useRef } from 'react';
import type { GroceryItem } from '../types';
import { samePantryCatalog } from '../utils/recipeUtils';

/**
 * A grocery store selector for the catalog that keeps handing back the
 * previous array while `samePantryCatalog` says nothing a pantry count reads
 * has changed: `useGroceryStore(usePantryCatalog())`. zustand's own
 * `useShallow` with that comparison in place of a shallow one, and the same
 * shape: the ref is the selector's memory between renders.
 *
 * For a screen whose work over the catalog never reads `checked` (Recipes'
 * counts, the meal plan's suggestions, costs and nutrition), so ticking a
 * row off at the shop doesn't redo all of it. A screen that does read it (the
 * list itself, a cart total) wants the plain `items`.
 */
export function usePantryCatalog() {
  const prev = useRef<GroceryItem[] | null>(null);
  return (state: { items: GroceryItem[] }): GroceryItem[] => {
    const next = state.items;
    if (prev.current !== null && samePantryCatalog(prev.current, next)) return prev.current;
    prev.current = next;
    return next;
  };
}
