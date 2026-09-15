import {
  buildPantryIndex,
  parseQueuedDisposals,
  resolveQueuedPantryItem,
  MAX_PANTRY_INDEX_ENTRIES,
} from '../utils/pantryIndex';
import { OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem } from '../types';

let seq = 0;
function makeItem(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  const name = overrides.name;
  return {
    nameFromScan: false,
    id: `id-${++seq}`,
    nameKey: groceryNameKey(name),
    preferredProductId: null,
    productStrict: false,
    aisle: 'Other',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
    sortOrder: seq,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
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
    useUpTask: null,
    pantryCheckDeclinedAt: null,
    pantryReviewedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    varietyOfKey: null,
    nutrition: null,
    backfillDismissedFields: [],
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    ...overrides,
  };
}

// ─── buildPantryIndex ────────────────────────────────────────────────────────

describe('buildPantryIndex', () => {
  it('carries only the id and the name', () => {
    const index = buildPantryIndex([makeItem({ name: 'Banana', aisle: 'Produce', quantity: '6' })]);
    expect(index).toEqual([{ id: index[0].id, name: 'Banana' }]);
  });

  it('drops rows already marked out of it, since marking them again does nothing', () => {
    const index = buildPantryIndex([
      makeItem({ name: 'Banana' }),
      makeItem({ name: 'Spinach', onHandUntil: OUT_OF_IT_UNTIL }),
    ]);
    expect(index.map(e => e.name)).toEqual(['Banana']);
  });

  it('keeps a row the app has no pantry opinion about', () => {
    // probablyHaveReason answers null for a row never bought through the app,
    // and that row is exactly the one somebody has to say out loud.
    const index = buildPantryIndex([makeItem({ name: 'Saffron', purchaseCount: 0 })]);
    expect(index.map(e => e.name)).toEqual(['Saffron']);
  });

  it('drops a row whose name is blank', () => {
    expect(buildPantryIndex([makeItem({ name: '   ' })])).toEqual([]);
  });

  it('sorts by name so an unchanged catalog serialises to identical bytes', () => {
    const items = [makeItem({ name: 'Yeast' }), makeItem({ name: 'Anchovies' })];
    expect(buildPantryIndex(items).map(e => e.name)).toEqual(['Anchovies', 'Yeast']);
    expect(JSON.stringify(buildPantryIndex(items))).toBe(
      JSON.stringify(buildPantryIndex([...items].reverse()))
    );
  });

  it('caps how much the intent process has to parse', () => {
    const items = Array.from({ length: MAX_PANTRY_INDEX_ENTRIES + 25 }, (_, i) =>
      makeItem({ name: `Item ${String(i).padStart(4, '0')}` })
    );
    expect(buildPantryIndex(items)).toHaveLength(MAX_PANTRY_INDEX_ENTRIES);
  });
});

// ─── parseQueuedDisposals ────────────────────────────────────────────────────

describe('parseQueuedDisposals', () => {
  it('reads what the intent queues', () => {
    const json = JSON.stringify([{ id: 'a1', name: 'Bananas', outcome: 'usedUp' }]);
    expect(parseQueuedDisposals(json)).toEqual([
      { id: 'a1', name: 'Bananas', outcome: 'usedUp' },
    ]);
  });

  it('keeps an entry the entity query could not resolve an id for', () => {
    const json = JSON.stringify([{ id: null, name: 'Bananas', outcome: 'spoiled' }]);
    expect(parseQueuedDisposals(json)).toEqual([
      { id: null, name: 'Bananas', outcome: 'spoiled' },
    ]);
  });

  it('is empty for anything unparseable, rather than throwing into the drain', () => {
    expect(parseQueuedDisposals('')).toEqual([]);
    expect(parseQueuedDisposals('not json')).toEqual([]);
    expect(parseQueuedDisposals('{"id":"a1"}')).toEqual([]);
  });

  it('drops an entry whose outcome is not one this build knows', () => {
    // A file written by an older or newer build of the app — the one input
    // here that crossed a process boundary and need not match these types.
    const json = JSON.stringify([
      { id: 'a1', name: 'Bananas', outcome: 'composted' },
      { id: 'a2', name: 'Milk', outcome: 'usedUp' },
    ]);
    expect(parseQueuedDisposals(json).map(e => e.name)).toEqual(['Milk']);
  });

  it('drops an entry with no usable name, since the name is the fallback', () => {
    const json = JSON.stringify([
      { id: 'a1', name: '  ', outcome: 'usedUp' },
      { id: 'a2', outcome: 'usedUp' },
      null,
    ]);
    expect(parseQueuedDisposals(json)).toEqual([]);
  });

  it('reads an empty id as no id at all', () => {
    const json = JSON.stringify([{ id: '', name: 'Bananas', outcome: 'usedUp' }]);
    expect(parseQueuedDisposals(json)[0].id).toBeNull();
  });
});

// ─── resolveQueuedPantryItem ─────────────────────────────────────────────────

describe('resolveQueuedPantryItem', () => {
  it('prefers the id the entity query resolved', () => {
    const banana = makeItem({ name: 'Banana' });
    const milk = makeItem({ name: 'Milk' });
    const found = resolveQueuedPantryItem({ id: milk.id, name: 'Banana' }, [banana, milk]);
    expect(found).toBe(milk);
  });

  it('falls back to the name when the id names a row that has since gone', () => {
    const banana = makeItem({ name: 'Banana' });
    expect(resolveQueuedPantryItem({ id: 'deleted', name: 'Banana' }, [banana])).toBe(banana);
  });

  it('matches a spoken plural against the row that holds it singular', () => {
    const banana = makeItem({ name: 'Banana' });
    expect(resolveQueuedPantryItem({ id: null, name: 'Bananas' }, [banana])).toBe(banana);
  });

  it('is case and whitespace insensitive, the way anything dictated has to be', () => {
    const item = makeItem({ name: 'Olive oil' });
    expect(resolveQueuedPantryItem({ id: null, name: '  OLIVE OIL ' }, [item])).toBe(item);
  });

  it('never mints a row for a name the catalog has never heard of', () => {
    const banana = makeItem({ name: 'Banana' });
    expect(resolveQueuedPantryItem({ id: null, name: 'Rambutan' }, [banana])).toBeNull();
  });

  it('is null when neither half answers', () => {
    expect(resolveQueuedPantryItem({ id: null, name: '' }, [])).toBeNull();
    expect(resolveQueuedPantryItem({}, [makeItem({ name: 'Banana' })])).toBeNull();
  });
});
