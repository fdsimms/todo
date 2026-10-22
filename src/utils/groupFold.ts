import type { TaskGroup } from '../types';

/**
 * The stack fields that only say whether a stack is drawn open, and nothing
 * about what is in it or where it sits.
 */
const FOLD_FIELDS: ReadonlySet<string> = new Set<keyof TaskGroup>(['collapsed', 'onToday']);

/**
 * Whether two stack lists differ only in which stacks are folded open.
 *
 * Today builds most of its list from the stacks (each stack's roster, the
 * section rows, the counts, the drop zones), and none of that reads whether a
 * stack is open. Folding one replaces its object in the store, though, so
 * keyed on the store's array every one of those passes re-ran on each tap of
 * a stack header, before the tray could start moving. Today holds on to the
 * array those passes were built from while this says nothing else changed,
 * and the rows that draw a stack open or shut read it from the live store.
 *
 * Compares field by field with `===`, so an edit that rebuilds a field (new
 * tags) counts as a change, which is the safe direction to be wrong in.
 */
export function sameGroupsApartFromFold(a: readonly TaskGroup[], b: readonly TaskGroup[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const key of keys) {
      if (FOLD_FIELDS.has(key)) continue;
      if ((x as unknown as Record<string, unknown>)[key] !== (y as unknown as Record<string, unknown>)[key]) return false;
    }
  }
  return true;
}
