import type { GroceryItem, GroceryList, GroceryListEntry } from '../types';

/**
 * Separate shopping lists — the reads. `useGroceryStore` owns the writes,
 * `GroceryListEntry` in types owns the reasoning; this is the pure half, so the
 * screen, the picker and the counts can't each work out "which rows are on this
 * list" a slightly different way.
 *
 * Two things to hold on to:
 *
 * **Null is the home list, and it has no row.** Every function here takes
 * `string | null` rather than a `GroceryList`, and that is why.
 *
 * **`itemsOnList` projects, it doesn't just filter.** A row can be in two
 * trolleys at once with a different `checked` in each, so the rows it returns
 * carry that list's `checked`/`sortOrder`/`choiceGroup` written over the item's
 * own. That is what lets every consumer downstream keep taking `GroceryItem[]`
 * and reading those three fields exactly as it always did.
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
 * `GroceryList`). Written out once, it can be read; spelled `!== null` in eleven
 * places, the rule stops being visible in the code that follows it.
 */
export function isAwayList(listId: string | null): boolean {
  return listId !== null;
}

/**
 * The name of a list, home included. Falls back to the home name for an id
 * nothing matches, which is the same resolve-or-shrug every cross-row pointer in
 * groceries takes.
 */
export function listNameFor(listId: string | null, lists: readonly GroceryList[]): string {
  if (listId === null) return HOME_LIST_NAME;
  return lists.find(l => l.id === listId)?.name ?? HOME_LIST_NAME;
}

/** This item's membership of this list, or null if it isn't in that trolley. */
export function entryFor(
  entries: readonly GroceryListEntry[],
  itemId: string,
  listId: string | null
): GroceryListEntry | null {
  return entries.find(e => e.itemId === itemId && e.listId === listId) ?? null;
}

/**
 * Whether this row is in *any* trolley.
 *
 * The broader question `GroceryItem.onList` deliberately doesn't answer — that
 * one is the home list, because it is what every reader written before separate
 * lists meant by "on the list". This is for the four that mean "in some
 * trolley", and each of them would do real damage reading the narrow one:
 * `hasUserFacts` and `catalogPruneCandidates` would sweep a row that is on the
 * Airbnb list as unused, `pantryCheckTasks` would ask whether you still have
 * something you are on your way to buy, and the Pantry row would say nothing
 * where it should say "on the list".
 */
export function onListAnywhere(entries: readonly GroceryListEntry[], itemId: string): boolean {
  return entries.some(e => e.itemId === itemId);
}

/** The same question as a set, for a reader asking it of a whole catalog. */
export function listedAnywhere(entries: readonly GroceryListEntry[]): ReadonlySet<string> {
  return new Set(entries.map(e => e.itemId));
}

/**
 * The rows in one list's trolley, each carrying that list's own membership.
 *
 * **The projection is the point, not the filter.** `checked`, `sortOrder` and
 * `choiceGroup` live on the entry now (see `GroceryListEntry`), and writing them
 * over the item's copies is what keeps `buildGrocerySections`, the drag maths,
 * the share text, the trip planner and the finish sheet taking a plain
 * `GroceryItem[]` and reading the fields they always read. A caller that filtered
 * `items` by entry instead would hand every one of them the *home* list's ticks.
 *
 * Sorted by the list's own walk order so the projection is a drop-in for the
 * `items` array it replaces.
 */
export function itemsOnList(
  items: readonly GroceryItem[],
  entries: readonly GroceryListEntry[],
  listId: string | null
): GroceryItem[] {
  const mine = new Map<string, GroceryListEntry>();
  for (const entry of entries) if (entry.listId === listId) mine.set(entry.itemId, entry);
  if (mine.size === 0) return [];
  const out: GroceryItem[] = [];
  for (const item of items) {
    const entry = mine.get(item.id);
    if (!entry) continue;
    out.push({
      ...item,
      onList: true,
      checked: entry.checked,
      sortOrder: entry.sortOrder,
      choiceGroup: entry.choiceGroup,
    });
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return out;
}

/**
 * Recomputes the four membership columns on the items named, from the entries.
 *
 * **The in-memory twin of `dbSyncGroceryHomeColumns`**, and it has to stay
 * exactly that: the store patches state rather than re-reading after a write, so
 * these two are the only two writers of those columns and a disagreement between
 * them survives until the next cold start. `onList` is the broad "in any
 * trolley" question and the other three are the home entry's — see
 * `GroceryItem.onList` for why those differ.
 *
 * Items not in `touched` are returned by reference, so a membership change to
 * one row doesn't hand every other row a new identity and re-render the list.
 */
export function withHomeMembership(
  items: readonly GroceryItem[],
  entries: readonly GroceryListEntry[],
  touched: ReadonlySet<string>
): GroceryItem[] {
  if (touched.size === 0) return items as GroceryItem[];
  const home = new Map<string, GroceryListEntry>();
  const anywhere = new Set<string>();
  for (const entry of entries) {
    anywhere.add(entry.itemId);
    if (entry.listId === null) home.set(entry.itemId, entry);
  }
  return items.map(item => {
    if (!touched.has(item.id)) return item;
    const entry = home.get(item.id) ?? null;
    return {
      ...item,
      onList: anywhere.has(item.id),
      checked: entry?.checked ?? false,
      sortOrder: entry?.sortOrder ?? item.sortOrder,
      choiceGroup: entry?.choiceGroup ?? null,
    };
  });
}

/**
 * One list's trolley as `itemId → checked`, for the readers that need to ask
 * "is this row in *that* list, and is it already in the cart" without wanting
 * the rows themselves.
 *
 * A map rather than a set because the two questions are one lookup, and the
 * callers (the add field's "On list" pill, a meal plan's `alreadyOnList` versus
 * `inCart`) both need the second as soon as they have the first.
 */
export function trolleyStateFor(
  entries: readonly GroceryListEntry[],
  listId: string | null
): ReadonlyMap<string, boolean> {
  const out = new Map<string, boolean>();
  for (const entry of entries) if (entry.listId === listId) out.set(entry.itemId, entry.checked);
  return out;
}

/** How many rows are in one list's trolley. */
export function listCount(entries: readonly GroceryListEntry[], listId: string | null): number {
  let n = 0;
  for (const entry of entries) if (entry.listId === listId) n += 1;
  return n;
}

/** How many of one list's rows are still to buy — the count a badge shows. */
export function listRemainingCount(
  entries: readonly GroceryListEntry[],
  listId: string | null
): number {
  let n = 0;
  for (const entry of entries) if (entry.listId === listId && !entry.checked) n += 1;
  return n;
}

/** How many of one list's rows are in the trolley — what Finish acts on. */
export function listCheckedCount(
  entries: readonly GroceryListEntry[],
  listId: string | null
): number {
  let n = 0;
  for (const entry of entries) if (entry.listId === listId && entry.checked) n += 1;
  return n;
}

/**
 * The next free rank in one list's walk order.
 *
 * Per list, because each list is walked in its own order — a row appended to the
 * Airbnb list must not be ranked against the forty rows on the list at home and
 * land somewhere arbitrary in it.
 */
export function nextListSortOrder(
  entries: readonly GroceryListEntry[],
  listId: string | null
): number {
  let max = 0;
  for (const entry of entries) if (entry.listId === listId) max = Math.max(max, entry.sortOrder);
  return max + 1;
}

/**
 * One entry per list the picker draws, home first and then the user's own in
 * their stored order, each with what's currently in its trolley.
 *
 * Home leads unconditionally rather than sorting in among the others. It is not
 * one of them — it's the list you come back to, it can't be renamed or deleted,
 * and a picker that sorted it into third place would be offering the way home as
 * one option among several.
 */
export function listPickerRows(
  entries: readonly GroceryListEntry[],
  lists: readonly GroceryList[]
): Array<{ id: string | null; name: string; count: number; away: boolean }> {
  const ordered = [...lists].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)
  );
  return [
    { id: null, name: HOME_LIST_NAME, count: listCount(entries, null), away: false },
    ...ordered.map(l => ({ id: l.id, name: l.name, count: listCount(entries, l.id), away: true })),
  ];
}
