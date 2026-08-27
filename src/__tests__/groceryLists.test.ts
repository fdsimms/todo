import {
  HOME_LIST_NAME,
  isAwayList,
  listNameFor,
  entryFor,
  onListAnywhere,
  listedAnywhere,
  itemsOnList,
  withHomeMembership,
  trolleyStateFor,
  listCount,
  listRemainingCount,
  listCheckedCount,
  nextListSortOrder,
  listPickerRows,
} from '../utils/groceryLists';
import type { GroceryItem, GroceryList, GroceryListEntry } from '../types';

function makeList(id: string, name: string, sortOrder: number, createdAt = '2026-01-01T00:00:00.000Z'): GroceryList {
  return { id, name, sortOrder, createdAt };
}

function entry(
  itemId: string,
  listId: string | null,
  overrides: Partial<GroceryListEntry> = {}
): GroceryListEntry {
  return {
    itemId,
    listId,
    checked: false,
    sortOrder: 1,
    choiceGroup: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeItem(overrides: Partial<GroceryItem> & { id: string }): GroceryItem {
  return {
    name: overrides.id,
    nameKey: overrides.id,
    preferredProductId: null,
    productStrict: false,
    aisle: 'Other',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: true,
    checked: false,
    sortOrder: 1,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null,
    sourceRecipeId: null,
    sourceRecipeTitle: null,
    choiceGroup: null,
    isStaple: false,
    expiresAt: null,
    frozenAt: null,
    openedAt: null,
    runningLowAt: null,
    shelfLifeDays: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    useUpTask: null,
    pantryCheckDeclinedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    varietyOfKey: null, backfillDismissedFields: [],
    priceHistory: [],
    ...overrides,
  };
}

describe('isAwayList', () => {
  it('is false for the list at home, which has no row', () => {
    expect(isAwayList(null)).toBe(false);
  });

  it('is true for every list the user made', () => {
    expect(isAwayList('list-1')).toBe(true);
  });
});

describe('listNameFor', () => {
  const lists = [makeList('l1', 'Airbnb', 1)];

  it('names the home list without needing a row for it', () => {
    expect(listNameFor(null, lists)).toBe(HOME_LIST_NAME);
  });

  it('names an away list', () => {
    expect(listNameFor('l1', lists)).toBe('Airbnb');
  });

  it('falls back to home for an id nothing matches, rather than throwing', () => {
    // Same resolve-or-shrug every cross-row pointer in groceries takes. It
    // should not happen — deleting a list drops its entries — but a reader
    // leaning on that is how a restore turns into a crash.
    expect(listNameFor('gone', lists)).toBe(HOME_LIST_NAME);
  });
});

describe('a row in two trolleys at once', () => {
  // The case the whole join table exists for: the staples you need in both
  // kitchens. Milk is on the list at home *and* on the Airbnb list, already
  // ticked off at the shop near the rental and still to buy at home.
  const items = [makeItem({ id: 'milk' }), makeItem({ id: 'eggs' })];
  const entries = [
    entry('milk', null, { sortOrder: 1 }),
    entry('milk', 'l1', { checked: true, sortOrder: 1 }),
    entry('eggs', null, { sortOrder: 2 }),
  ];

  it('returns the row on both lists', () => {
    expect(itemsOnList(items, entries, null).map(i => i.id)).toEqual(['milk', 'eggs']);
    expect(itemsOnList(items, entries, 'l1').map(i => i.id)).toEqual(['milk']);
  });

  it('gives each list its own tick for the same row', () => {
    expect(itemsOnList(items, entries, null).find(i => i.id === 'milk')!.checked).toBe(false);
    expect(itemsOnList(items, entries, 'l1').find(i => i.id === 'milk')!.checked).toBe(true);
  });

  it('counts it once per list', () => {
    expect(listCount(entries, null)).toBe(2);
    expect(listCount(entries, 'l1')).toBe(1);
    expect(listRemainingCount(entries, null)).toBe(2);
    expect(listRemainingCount(entries, 'l1')).toBe(0);
    expect(listCheckedCount(entries, 'l1')).toBe(1);
  });
});

describe('itemsOnList', () => {
  const items = [
    makeItem({ id: 'milk', checked: true, sortOrder: 9, choiceGroup: 'home-group' }),
    makeItem({ id: 'coffee' }),
  ];

  it('writes the list’s own membership over the item’s copies', () => {
    // The projection is the point: the row's own four columns mirror the *home*
    // list, so handing an away list's consumers the raw item would give them
    // home's ticks.
    const entries = [entry('milk', 'l1', { checked: false, sortOrder: 3, choiceGroup: 'away-group' })];
    const [row] = itemsOnList(items, entries, 'l1');
    expect(row.checked).toBe(false);
    expect(row.sortOrder).toBe(3);
    expect(row.choiceGroup).toBe('away-group');
    expect(row.onList).toBe(true);
  });

  it('leaves everything that is a fact about the item alone', () => {
    const entries = [entry('milk', 'l1')];
    const [row] = itemsOnList(items, entries, 'l1');
    expect(row.aisle).toBe('Other');
    expect(row.nameKey).toBe('milk');
  });

  it('returns the list in its own walk order', () => {
    const entries = [entry('coffee', null, { sortOrder: 1 }), entry('milk', null, { sortOrder: 2 })];
    expect(itemsOnList(items, entries, null).map(i => i.id)).toEqual(['coffee', 'milk']);
  });

  it('returns nothing for a list with an empty trolley', () => {
    expect(itemsOnList(items, [entry('milk', 'l1')], 'l2')).toEqual([]);
  });

  it('ignores an entry naming an item that is gone', () => {
    expect(itemsOnList(items, [entry('deleted', null)], null)).toEqual([]);
  });
});

describe('onListAnywhere', () => {
  const entries = [entry('coffee', 'l1')];

  it('is true for a row in a trolley that is not the one at home', () => {
    // The whole reason it exists: the item's own `onList` answers for home, so
    // a prune or a pantry check reading that would treat this row as unused.
    expect(onListAnywhere(entries, 'coffee')).toBe(true);
  });

  it('is false for a row in no trolley at all', () => {
    expect(onListAnywhere(entries, 'milk')).toBe(false);
  });

  it('answers the same question as a set', () => {
    expect([...listedAnywhere(entries)]).toEqual(['coffee']);
  });
});

describe('withHomeMembership', () => {
  const items = [makeItem({ id: 'milk', onList: false, checked: false, choiceGroup: null })];

  it('mirrors the home entry onto the row', () => {
    const entries = [entry('milk', null, { checked: true, sortOrder: 4, choiceGroup: 'g' })];
    const [row] = withHomeMembership(items, entries, new Set(['milk']));
    expect(row.onList).toBe(true);
    expect(row.checked).toBe(true);
    expect(row.sortOrder).toBe(4);
    expect(row.choiceGroup).toBe('g');
  });

  it('reads onList as "in any trolley" but the rest as home’s', () => {
    // The one asymmetry, and it's deliberate: the sweep in clearList and the
    // catalog prune both read onList to decide whether a row is unused, and a
    // row on the Airbnb list is not unused. The other three are home's, because
    // that is what every reader written before separate lists meant.
    const entries = [entry('milk', 'l1', { checked: true, choiceGroup: 'g' })];
    const [row] = withHomeMembership(items, entries, new Set(['milk']));
    expect(row.onList).toBe(true);
    expect(row.checked).toBe(false);
    expect(row.choiceGroup).toBeNull();
  });

  it('clears the row when it is in no trolley', () => {
    const listed = [makeItem({ id: 'milk', onList: true, checked: true })];
    const [row] = withHomeMembership(listed, [], new Set(['milk']));
    expect(row.onList).toBe(false);
    expect(row.checked).toBe(false);
  });

  it('returns an untouched row by reference, so nothing else re-renders', () => {
    const [row] = withHomeMembership(items, [], new Set(['other']));
    expect(row).toBe(items[0]);
  });
});

describe('trolleyStateFor', () => {
  it('maps this list’s rows to their own ticks', () => {
    const entries = [
      entry('milk', null, { checked: true }),
      entry('milk', 'l1', { checked: false }),
      entry('coffee', 'l1', { checked: true }),
    ];
    const home = trolleyStateFor(entries, null);
    expect(home.get('milk')).toBe(true);
    expect(home.has('coffee')).toBe(false);
    const away = trolleyStateFor(entries, 'l1');
    expect(away.get('milk')).toBe(false);
    expect(away.get('coffee')).toBe(true);
  });
});

describe('nextListSortOrder', () => {
  it('ranks against that list alone, not every trolley', () => {
    // A row appended to the Airbnb list must not be ranked against the forty
    // rows on the list at home and land somewhere arbitrary in it.
    const entries = [entry('milk', null, { sortOrder: 40 }), entry('coffee', 'l1', { sortOrder: 2 })];
    expect(nextListSortOrder(entries, 'l1')).toBe(3);
    expect(nextListSortOrder(entries, null)).toBe(41);
  });

  it('starts at 1 for an empty list', () => {
    expect(nextListSortOrder([], 'l1')).toBe(1);
  });
});

describe('entryFor', () => {
  const entries = [entry('milk', null), entry('milk', 'l1')];

  it('picks the membership of the list asked about', () => {
    expect(entryFor(entries, 'milk', 'l1')!.listId).toBe('l1');
    expect(entryFor(entries, 'milk', null)!.listId).toBeNull();
  });

  it('is null for a row not in that trolley', () => {
    expect(entryFor(entries, 'milk', 'l2')).toBeNull();
  });
});

describe('listPickerRows', () => {
  const entries = [entry('milk', null), entry('eggs', null), entry('coffee', 'l2')];

  it('puts home first, ahead of a list that sorts before it', () => {
    // Home is not one of the away lists and never sorts among them: it is the
    // list you come back to, and a picker that filed it third would offer the
    // way home as one option among several.
    const lists = [makeList('l2', 'Airbnb', 1), makeList('l1', 'Beach house', 2)];
    expect(listPickerRows(entries, lists).map(r => r.name)).toEqual([
      HOME_LIST_NAME, 'Airbnb', 'Beach house',
    ]);
  });

  it('gives home a null id and the away lists their own', () => {
    const lists = [makeList('l2', 'Airbnb', 1)];
    expect(listPickerRows(entries, lists).map(r => r.id)).toEqual([null, 'l2']);
  });

  it('marks only the away lists away', () => {
    const lists = [makeList('l2', 'Airbnb', 1)];
    expect(listPickerRows(entries, lists).map(r => r.away)).toEqual([false, true]);
  });

  it('carries each list’s own count', () => {
    const lists = [makeList('l2', 'Airbnb', 1), makeList('l1', 'Beach house', 2)];
    expect(listPickerRows(entries, lists).map(r => r.count)).toEqual([2, 1, 0]);
  });

  it('follows the stored order, then createdAt for a tie', () => {
    const lists = [
      makeList('l1', 'Second', 5, '2026-02-01T00:00:00.000Z'),
      makeList('l2', 'First', 5, '2026-01-01T00:00:00.000Z'),
    ];
    expect(listPickerRows([], lists).map(r => r.name)).toEqual([HOME_LIST_NAME, 'First', 'Second']);
  });

  it('is just the home row when nothing else has been made', () => {
    expect(listPickerRows(entries, []).map(r => r.name)).toEqual([HOME_LIST_NAME]);
  });
});
