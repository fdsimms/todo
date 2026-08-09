import { useEffect, useState } from 'react';

/**
 * Returns `value`, but only after it has stopped changing for `delayMs`.
 *
 * Exists so an expensive computation (a `useMemo` filtering the whole task
 * list, say) can depend on the debounced value while the input driving it
 * — a controlled `TextInput`'s `value`/`onChangeText` — stays bound to the
 * raw, undebounced state. That split is the point: the input's own re-render
 * must stay cheap and immediate no matter how expensive the downstream work
 * is, or a controlled `TextInput` can desync from fast native keystrokes
 * (see SearchScreen). Debouncing the state that feeds the *input* itself
 * would only slow the input down along with the computation.
 *
 * A plain `useEffect` + `setTimeout` wrapper — there's no timing logic here
 * worth extracting into a pure function to unit test.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
