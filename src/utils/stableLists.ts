/**
 * A grouped map rebuilt from the whole task list on every store write, with
 * each list swapped back for last time's wherever its members haven't changed.
 *
 * The rebuild hands every key a fresh array, so a memoized row or header given
 * one re-renders on every write anywhere in the app, even when its own members
 * are exactly what they were: adding one task to a project re-rendered every
 * section header and every task with subtasks on the page. Same members in the
 * same order (by identity, which the store keeps for untouched rows) means the
 * old array is still the right answer, and when that holds for every key, so
 * is the old map.
 */
export function reuseUnchangedLists<K, T>(
  prev: ReadonlyMap<K, readonly T[]> | null,
  next: Map<K, T[]>,
): Map<K, T[]> {
  if (!prev) return next;
  let unchanged = prev.size === next.size;
  for (const [key, list] of next) {
    const old = prev.get(key);
    if (old && sameMembers(old, list)) next.set(key, old as T[]);
    else unchanged = false;
  }
  // The same keys holding the same lists is the same map, and last time's is
  // handed back whole. A new map of old lists kept the rows from re-rendering
  // but still changed identity on every write, so whatever a screen builds
  // from the map (Today's stacks, sections and list items) was rebuilt on
  // each task write, even one that touched no stack.
  return unchanged ? (prev as Map<K, T[]>) : next;
}

function sameMembers<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
