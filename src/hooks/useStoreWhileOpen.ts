import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

/** A zustand store's hook, as far as this needs it. */
type StoreHook<S> = <U>(selector: (state: S) => U) => U;

/**
 * A slice of a store for a sheet that only reads it while it is open.
 *
 * A sheet stays mounted once it has been opened, and a bare
 * `useStore(s => s.rows)` re-renders it, and recomputes every memo keyed on
 * those rows, on every write to that store for as long as its screen is up:
 * work done for a sheet nobody is looking at.
 *
 * While `open` this is the live value. Once closed it keeps returning the last
 * one it saw, so the selector never reports a change. It does not fall back to
 * `closed`, which would blank the sheet in the middle of its own dismissal
 * (iOS goes on drawing a modal's content until its animation ends); `closed`
 * is only what a sheet that has never opened holds. It catches up in the
 * render that opens the sheet, since `open` is already true when the selector
 * runs.
 *
 * Compared shallowly, so a selector that builds a new array of the same rows
 * is not a change. `useTasksWhileOpen` and `useGroceryWhileOpen` are this for
 * their stores.
 */
export function useStoreWhileOpen<S, T>(useStore: StoreHook<S>, open: boolean, pick: (state: S) => T, closed: T): T {
  const last = useRef<T>(closed);
  const value = useStore(useShallow((state: S) => (open ? pick(state) : last.current)));
  if (open) last.current = value;
  return value;
}
