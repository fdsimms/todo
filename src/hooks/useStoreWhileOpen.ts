import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { StoreApi, UseBoundStore } from 'zustand';

/**
 * A store slice for a sheet that only reads it while it is open:
 * `useTasksWhileOpen`'s rule for any store.
 *
 * While `open` this is the live slice. Once closed it keeps returning the last
 * value it saw while open, so the selector never reports a change and the
 * sheet stops re-rendering, and recomputing whatever it builds from the slice,
 * on writes nobody is looking at. It never falls back to `closed` after the
 * first open, which would blank the sheet in the middle of its own dismissal;
 * `closed` is only what a sheet that has never opened holds.
 *
 * It catches up in the render that opens the sheet, so an effect keyed on
 * `visible` reads the current value rather than a stale one. Compared
 * shallowly, so a new array of the same rows is not a change.
 */
export function useStoreWhileOpen<S, T>(
  useStore: UseBoundStore<StoreApi<S>>,
  open: boolean,
  select: (state: S) => T,
  closed: T,
): T {
  const last = useRef<T>(closed);
  const value = useStore(useShallow((state: S) => (open ? select(state) : last.current)));
  if (open) last.current = value;
  return value;
}
