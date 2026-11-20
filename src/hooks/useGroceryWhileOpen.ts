import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGroceryStore } from '../store/useGroceryStore';

type GroceryState = ReturnType<typeof useGroceryStore.getState>;

/**
 * A slice of the grocery store for a sheet that only reads it while it is open:
 * `useTasksWhileOpen`, for groceries, and for the same reason.
 *
 * A sheet stays mounted once it has been opened, and a bare
 * `useGroceryStore(s => s.items)` re-renders it, and recomputes every memo
 * keyed on the catalog, on every grocery write for as long as its screen is up.
 * Each item checked off the list re-ranked the whole catalog in a sheet nobody
 * was looking at.
 *
 * While `open` this is the live value. Once closed it keeps returning the last
 * one it saw, so the selector never reports a change. It does not fall back to
 * `closed`, which would blank the sheet in the middle of its own dismissal;
 * `closed` is only what a sheet that has never opened holds. It catches up in
 * the render that opens the sheet.
 *
 * Compared shallowly, as the selectors this replaces were.
 */
export function useGroceryWhileOpen<T>(open: boolean, pick: (state: GroceryState) => T, closed: T): T {
  const last = useRef<T>(closed);
  const value = useGroceryStore(useShallow((state: GroceryState) => (open ? pick(state) : last.current)));
  if (open) last.current = value;
  return value;
}
