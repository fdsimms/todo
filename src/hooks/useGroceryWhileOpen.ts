import { useGroceryStore } from '../store/useGroceryStore';
import { useStoreWhileOpen } from './useStoreWhileOpen';

type GroceryState = ReturnType<typeof useGroceryStore.getState>;

/**
 * A slice of the grocery store for a sheet that only reads it while it is
 * open: `useStoreWhileOpen` for groceries, where it began. Closed, a sheet
 * subscribed to the catalog re-ranked the whole of it on every item checked
 * off the list.
 */
export function useGroceryWhileOpen<T>(open: boolean, pick: (state: GroceryState) => T, closed: T): T {
  return useStoreWhileOpen(useGroceryStore, open, pick, closed);
}
