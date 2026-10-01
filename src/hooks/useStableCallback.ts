import { useCallback, useRef } from 'react';

/**
 * A callback whose identity never changes, and which always calls the latest
 * `fn` it was rendered with.
 *
 * For handing a handler to a memoized child that stays mounted while hidden
 * (QuickAddModal is the case it was written for): a plain function prop is
 * new on every render of the host, so the child re-renders with it, hidden or
 * not. Only call the result from an event or effect, never during render,
 * since it reads whatever `fn` the last render left behind.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
