import { useCallback, useMemo, useRef, useState, type DependencyList } from 'react';
import { useFocusEffect } from '@react-navigation/native';

/**
 * Rows read straight from the database rather than out of a store, read again
 * each time the screen is focused, since another screen may have written them
 * meanwhile. The rows come back as the same array while a read finds the same
 * contents, so whatever is keyed on them isn't rebuilt.
 *
 * This replaced a nonce bumped on every focus. The nonce worked, but it
 * re-rendered the whole screen and redid every read and every memo keyed on
 * one on each return to it, nearly always to find exactly what was there. Here
 * the focus re-reads quietly and re-renders only on a difference.
 *
 * `read` runs with whatever it closes over from the render that last ran it,
 * which the focus re-read reuses. `deps` are the read's own inputs, exactly as
 * a `useMemo` around it would list them. `same` compares a held read with a
 * fresh one, and must be a stable function (a module-level one).
 */
export function useFocusRefreshedRead<T>(
  read: () => T[],
  deps: DependencyList,
  same: (held: readonly T[], fresh: readonly T[]) => boolean,
): T[] {
  const [changedOnFocus, setChangedOnFocus] = useState(0);
  const held = useRef<{ read: () => T[]; rows: T[] } | null>(null);

  const rows = useMemo(() => {
    const fresh = read();
    const last = held.current;
    const next = last && same(last.rows, fresh) ? last.rows : fresh;
    held.current = { read, rows: next };
    return next;
    // `read` is deliberately not a dependency: it is a fresh closure each
    // render, and its inputs are what `deps` lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, changedOnFocus]);

  useFocusEffect(
    useCallback(() => {
      const last = held.current;
      if (last && !same(last.rows, last.read())) setChangedOnFocus(n => n + 1);
    }, [same]),
  );

  return rows;
}
