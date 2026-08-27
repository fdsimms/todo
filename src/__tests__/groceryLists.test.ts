import {
  HOME_LIST_NAME,
  isAwayList,
  listNameFor,
  itemsOnList,
  listCount,
  listPickerRows,
} from '../utils/groceryLists';
import type { GroceryItem, GroceryList } from '../types';

function makeList(id: string, name: string, sortOrder: number, createdAt = '2026-01-01T00:00:00.000Z'): GroceryList {
  return { id, name, sortOrder, createdAt };
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
    listId: null,
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
    // should not happen — deleteList unlists its rows — but a reader leaning on
    // that is how a restore turns into a crash.
    expect(listNameFor('gone', lists)).toBe(HOME_LIST_NAME);
  });
});

describe('itemsOnList', () => {
  const home = makeItem({ id: 'milk' });
  const away = makeItem({ id: 'coffee', listId: 'l1' });
  // A parked row keeps neither flag; this one is the belt-and-braces case of a
  // stale listId on an off-list row, which must still read as "not on a list".
  const parked = makeItem({ id: 'flour', onList: false, listId: 'l1' });
  const items = [home, away, parked];

  it('returns only the home rows for the home list', () => {
    expect(itemsOnList(items, null).map(i => i.id)).toEqual(['milk']);
  });

  it('returns only that list’s rows for an away list', () => {
    expect(itemsOnList(items, 'l1').map(i => i.id)).toEqual(['coffee']);
  });

  it('never returns a parked row, whatever list id it still carries', () => {
    expect(itemsOnList(items, 'l1').some(i => i.id === 'flour')).toBe(false);
  });

  it('returns nothing for a list with an empty trolley', () => {
    expect(itemsOnList(items, 'l2')).toEqual([]);
  });
});

describe('listCount', () => {
  it('counts each list separately', () => {
    const items = [
      makeItem({ id: 'a' }),
      makeItem({ id: 'b' }),
      makeItem({ id: 'c', listId: 'l1' }),
      makeItem({ id: 'd', onList: false }),
    ];
    expect(listCount(items, null)).toBe(2);
    expect(listCount(items, 'l1')).toBe(1);
  });

  it('counts checked rows too — they are still in the trolley', () => {
    const items = [makeItem({ id: 'a', checked: true })];
    expect(listCount(items, null)).toBe(1);
  });
});

describe('listPickerRows', () => {
  const items = [
    makeItem({ id: 'milk' }),
    makeItem({ id: 'eggs' }),
    makeItem({ id: 'coffee', listId: 'l2' }),
  ];

  it('puts home first, ahead of a list that sorts before it', () => {
    // Home is not one of the away lists and never sorts among them: it is the
    // list you come back to, and a picker that filed it third would offer the
    // way home as one option among several.
    const lists = [makeList('l2', 'Airbnb', 1), makeList('l1', 'Beach house', 2)];
    expect(listPickerRows(items, lists).map(r => r.name)).toEqual([
      HOME_LIST_NAME, 'Airbnb', 'Beach house',
    ]);
  });

  it('gives home a null id and the away lists their own', () => {
    const lists = [makeList('l2', 'Airbnb', 1)];
    expect(listPickerRows(items, lists).map(r => r.id)).toEqual([null, 'l2']);
  });

  it('marks only the away lists away', () => {
    const lists = [makeList('l2', 'Airbnb', 1)];
    expect(listPickerRows(items, lists).map(r => r.away)).toEqual([false, true]);
  });

  it('carries each list’s own count', () => {
    const lists = [makeList('l2', 'Airbnb', 1), makeList('l1', 'Beach house', 2)];
    expect(listPickerRows(items, lists).map(r => r.count)).toEqual([2, 1, 0]);
  });

  it('follows the stored order, then createdAt for a tie', () => {
    const lists = [
      makeList('l1', 'Second', 5, '2026-02-01T00:00:00.000Z'),
      makeList('l2', 'First', 5, '2026-01-01T00:00:00.000Z'),
    ];
    expect(listPickerRows([], lists).map(r => r.name)).toEqual([HOME_LIST_NAME, 'First', 'Second']);
  });

  it('is just the home row when nothing else has been made', () => {
    expect(listPickerRows(items, []).map(r => r.name)).toEqual([HOME_LIST_NAME]);
  });
});
