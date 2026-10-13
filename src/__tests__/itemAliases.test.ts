import type { GroceryItem } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import { catalogItemForKey } from '../utils/groceryPlural';
import {
  aliasIndex, cleanOtherNames, itemKeyIndex, otherNameKeysOf,
} from '../utils/itemAliases';
import { matchIngredientToCatalog } from '../utils/ingredientCatalogMatch';
import { mergedItemRow, setOtherNamesRow } from '../utils/groceryItemWrite';
import { classifyPlanned } from '../utils/mealPlanGroceries';

// dateUtils reaches the settings store for dayResetTime, which reaches expo-sqlite.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;
function makeItem(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    nameFromScan: false,
    id: `id-${++seq}`,
    name,
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
    purchaseIntervalDays: null,
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

describe('otherNameKeysOf', () => {
  it('derives keys, dropping the item’s own key and repeats', () => {
    const item = makeItem('Dashima', { otherNames: ['Kombu', 'KOMBU', 'dashima', ' Konbu '] });
    expect(otherNameKeysOf(item)).toEqual(['kombu', 'konbu']);
  });
});

describe('aliasIndex', () => {
  it('maps another name to its item', () => {
    const dashima = makeItem('Dashima', { otherNames: ['Kombu'] });
    expect(aliasIndex([dashima, makeItem('Salt')]).get('kombu')).toBe(dashima);
  });

  it('lets an item’s own name beat any other name', () => {
    const kombu = makeItem('Kombu');
    const dashima = makeItem('Dashima', { otherNames: ['Kombu'] });
    const index = itemKeyIndex([dashima, kombu]);
    expect(index.get('kombu')).toBe(kombu);
  });

  it('resolves a name two items both claim to neither', () => {
    const a = makeItem('Scallions', { otherNames: ['Green onion'] });
    const b = makeItem('Spring onions', { otherNames: ['green onion'] });
    expect(aliasIndex([a, b]).has('green onion')).toBe(false);
  });
});

describe('catalogItemForKey', () => {
  it('finds an item by another name, after an exact name', () => {
    const dashima = makeItem('Dashima', { otherNames: ['Kombu'] });
    expect(catalogItemForKey('kombu', [dashima])).toBe(dashima);
    expect(catalogItemForKey('dashima', [dashima])).toBe(dashima);
    expect(catalogItemForKey('nori', [dashima])).toBeNull();
  });
});

describe('cleanOtherNames', () => {
  it('trims, dedupes and refuses the item’s own name and another item’s name', () => {
    const dashima = makeItem('Dashima');
    const nori = makeItem('Nori', { otherNames: ['Laver'] });
    const r = cleanOtherNames([dashima, nori], dashima.id, [' Kombu ', 'kombu', 'dashima', 'Nori', 'laver', '  ']);
    expect(r.names).toEqual(['Kombu']);
    expect(r.refused.map(x => x.name)).toEqual(['dashima', 'Nori', 'laver']);
  });
});

describe('setOtherNamesRow', () => {
  it('sets and clears the names, and reports no change as a null row', () => {
    const dashima = makeItem('Dashima');
    const set = setOtherNamesRow([dashima], dashima.id, ['Kombu'])!;
    expect(set.row?.otherNames).toEqual(['Kombu']);
    const same = setOtherNamesRow([set.row!], dashima.id, ['Kombu'])!;
    expect(same.row).toBeNull();
    const cleared = setOtherNamesRow([set.row!], dashima.id, [])!;
    expect(cleared.row).not.toBeNull();
    expect('otherNames' in cleared.row!).toBe(false);
    expect(setOtherNamesRow([dashima], 'missing', ['x'])).toBeNull();
  });
});

describe('mergedItemRow', () => {
  it('keeps the loser’s name as another name of the survivor', () => {
    const dashima = makeItem('Dashima');
    const kombu = makeItem('Kombu', { otherNames: ['Konbu'] });
    expect(mergedItemRow(dashima, kombu).otherNames).toEqual(['Konbu', 'Kombu']);
  });

  it('adds nothing when the names match', () => {
    const a = makeItem('Dashima');
    const b = makeItem('dashima');
    expect('otherNames' in mergedItemRow(a, b)).toBe(false);
  });
});

describe('matchIngredientToCatalog', () => {
  it('links a line using another name, with reason alias', () => {
    const dashima = makeItem('Dashima', { otherNames: ['Kombu'] });
    const m = matchIngredientToCatalog('kombu', [dashima], new Date());
    expect(m).toMatchObject({ kind: 'linked', reason: 'alias', item: dashima });
  });
});

describe('classifyPlanned', () => {
  it('files a line using another name under the item, remembering the recipe’s word', () => {
    const dashima = makeItem('Dashima', { otherNames: ['Kombu'], isStaple: true });
    const planned = [{ name: 'Kombu', nameKey: 'kombu', quantity: '2', aisle: null, source: 'Tue Stew' }];
    const [row] = classifyPlanned(planned, [dashima], new Date(), [], null, []);
    expect(row).toMatchObject({ nameKey: 'dashima', name: 'Dashima', swappedFrom: 'Kombu', category: 'staple' });
  });
});
