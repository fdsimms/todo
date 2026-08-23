import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * The "what's still being typed when Add is tapped" registry for the recipe
 * import sheets.
 *
 * Tapping Add can beat an inline field's own blur, so a sheet that trusted its
 * React state would drop whatever edit was in flight — the same race
 * `TaskEditor`'s `resolveX` functions guard against. `ExtractedIngredientRow`
 * solved it for the ingredient rows with an imperative handle and a `Map` of
 * refs in each sheet; that worked for one editable row type and stops working
 * at four, which is what making the whole review list editable needs. One
 * registry the sheet asks once replaces one ref map per editable thing.
 *
 * **The resolvers return values; they must not commit.** A resolver that
 * called its own `onCommit` would schedule a `setState` the sheet's very next
 * synchronous line can't see — which is the bug this exists to avoid, not a
 * tidier version of it. `resolveAll()` hands back a plain map the caller
 * merges over its own state before reading it.
 */
export interface PendingEdits {
  /**
   * Registers this field's resolver under `key`, returning the unregister to
   * run on unmount. The resolver returns what a commit *would* write, or null
   * when there's nothing pending or the draft is the value already there.
   */
  register: (key: string, resolve: () => string | null) => () => void;
  /** Every pending draft, keyed as registered. Empty when nothing is mid-edit. */
  resolveAll: () => Map<string, string>;
}

export function usePendingEdits(): PendingEdits {
  const resolvers = useRef(new Map<string, () => string | null>());

  const register = useCallback((key: string, resolve: () => string | null) => {
    resolvers.current.set(key, resolve);
    return () => {
      // Guarded on identity: a re-registration under the same key (a row
      // re-keyed by a list edit above it) would otherwise have its new
      // resolver deleted by the old one's cleanup running afterwards.
      if (resolvers.current.get(key) === resolve) resolvers.current.delete(key);
    };
  }, []);

  const resolveAll = useCallback(() => {
    const pending = new Map<string, string>();
    resolvers.current.forEach((resolve, key) => {
      const value = resolve();
      if (value !== null) pending.set(key, value);
    });
    return pending;
  }, []);

  // Memoised because `useRegisterPendingEdit` keys its effect on this object:
  // a fresh literal every render would unregister and re-register every field
  // on every keystroke typed into any of them.
  return useMemo(() => ({ register, resolveAll }), [register, resolveAll]);
}

/**
 * The field half of the contract above: keeps `resolve` registered under `key`
 * for as long as the field is mounted. `resolve` is read through a ref so a
 * field that re-renders on every keystroke doesn't re-register on every
 * keystroke too.
 */
export function useRegisterPendingEdit(
  edits: PendingEdits,
  key: string,
  resolve: () => string | null,
): void {
  const latest = useRef(resolve);
  latest.current = resolve;
  useEffect(() => edits.register(key, () => latest.current()), [edits, key]);
}
