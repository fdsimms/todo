import type { GroceryItem, GroceryList } from '../types';

/**
 * Separate shopping lists — the reads. `useGroceryStore` owns the writes, and
 * `GroceryList` in types owns the reasoning; this is the pure half, so the
 * screen, the picker and the counts can't each work out "which rows are on this
 * list" a slightly different way.
 *
 * The one thing to hold on to: **null is the home list, and it has no row**.
 * Every function here takes `string | null` rather than a `GroceryList`, and
 * that is why.
 */

/**
 * What the home list is called wherever one is named — the picker, the screen
 * header, the away banner's "back to" wording.
 *
 * It matches the tab and the hub pill on purpose. A user who has never made a
 * second list should not be able to tell this feature shipped, and the way that
 * fails is the home list quietly acquiring a name like "Home" or "Default" that
 * nothing else on the screen agrees with.
 */
export const HOME_LIST_NAME = 'Groceries';

/**
 * Whether this list is one you're away from home for — which is every list
 * except home.
 *
 * A function rather than a bare `!== null` at each call site because it is the
 * whole of what "away" means and it decides what a finished trip records (see
 * `GroceryList`). Written out once, it can be read; spelled `!== null` in
 * eleven places, the rule stops being visible in the code that follows it.
 */
export function isAwayList(listId: string | null): boolean {
  return listId !== null;
}

/**
 * The name of a list, home included. Falls back to the home name for an id
 * nothing matches, which is the same reading `GroceryItem.listId` gets
 * everywhere else: an unresolvable list is no list, and no list is home.
 */
export function listNameFor(listId: string | null, lists: readonly GroceryList[]): string {
  if (listId === null) return HOME_LIST_NAME;
  return lists.find(l => l.id === listId)?.name ?? HOME_LIST_NAME;
}

/**
 * The rows in one list's trolley.
 *
 * Both halves matter and neither is redundant: `onList` says the row is in a
 * trolley at all, and `listId` says which. A row that has parked keeps neither
 * (see `GroceryItem.listId`), so testing `listId` alone would be a filter over
 * the whole catalog rather than over a list.
 */
export function itemsOnList(
  items: readonly GroceryItem[],
  listId: string | null
): GroceryItem[] {
  return items.filter(i => i.onList && i.listId === listId);
}

/** How many rows are in one list's trolley. */
export function listCount(items: readonly GroceryItem[], listId: string | null): number {
  let n = 0;
  for (const item of items) if (item.onList && item.listId === listId) n += 1;
  return n;
}

/**
 * One entry per list the picker draws, home first and then the user's own in
 * their stored order, each with what's currently in its trolley.
 *
 * Home leads unconditionally rather than sorting in among the others. It is not
 * one of them — it's the list you come back to, it can't be renamed or deleted,
 * and a picker that sorted it into third place would be offering the way home
 * as one option among several.
 */
export function listPickerRows(
  items: readonly GroceryItem[],
  lists: readonly GroceryList[]
): Array<{ id: string | null; name: string; count: number; away: boolean }> {
  const ordered = [...lists].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)
  );
  return [
    { id: null, name: HOME_LIST_NAME, count: listCount(items, null), away: false },
    ...ordered.map(l => ({ id: l.id, name: l.name, count: listCount(items, l.id), away: true })),
  ];
}
