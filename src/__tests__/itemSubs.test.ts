import { describeSubstitutes, substituteForItems, substitutesFor } from '../utils/itemSubs';
import { groceryNameKey } from '../utils/groceryParse';
import { OTHER_AISLE } from '../utils/groceryAisles';
import type { GroceryItem, ItemSubLink } from '../types';

function makeItem(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: `item-${groceryNameKey(name).replace(/\s/g, '-')}`,
    name,
    nameKey: groceryNameKey(name),
    brand: null,
    brandStrict: false,
    variant: null,
    aisle: OTHER_AISLE,
    quantity: null,
    note: '',
    onList: false,
    checked: false,
    inCatalog: true,
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
    useUpTask: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    ...overrides,
  };
}

function sub(
  itemId: string,
  subItemId: string,
  overrides: Partial<ItemSubLink> = {}
): ItemSubLink {
  return {
    itemId,
    subItemId,
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const butter = makeItem('Butter');
const margarine = makeItem('Margarine');
const ghee = makeItem('Ghee');
const oil = makeItem('Olive oil');
const ITEMS = [butter, margarine, ghee, oil];

describe('substitutesFor', () => {
  it('names what you would use instead of an item', () => {
    const links = [sub(butter.id, margarine.id, { note: 'Not for baking' })];
    const out = substitutesFor(butter.id, links, ITEMS);
    expect(out).toHaveLength(1);
    expect(out[0].item.name).toBe('Margarine');
    expect(out[0].link.note).toBe('Not for baking');
  });

  it('does not read a link backwards', () => {
    // The whole point of the link being directional: "milk instead of
    // buttermilk" is not "buttermilk instead of milk".
    const links = [sub(butter.id, margarine.id)];
    expect(substitutesFor(margarine.id, links, ITEMS)).toEqual([]);
  });

  it('reports a pair as mutual only when both rows exist', () => {
    const oneWay = [sub(butter.id, margarine.id)];
    expect(substitutesFor(butter.id, oneWay, ITEMS)[0].isMutual).toBe(false);

    const bothWays = [sub(butter.id, margarine.id), sub(margarine.id, butter.id)];
    expect(substitutesFor(butter.id, bothWays, ITEMS)[0].isMutual).toBe(true);
    expect(substitutesFor(margarine.id, bothWays, ITEMS)[0].isMutual).toBe(true);
  });

  it('drops a link whose other half is gone', () => {
    const links = [sub(butter.id, margarine.id), sub(butter.id, 'deleted-row')];
    const out = substitutesFor(butter.id, links, ITEMS);
    expect(out.map(s => s.item.name)).toEqual(['Margarine']);
  });

  it('keeps creation order rather than re-ranking', () => {
    const links = [
      sub(butter.id, ghee.id, { createdAt: '2026-03-01T00:00:00.000Z' }),
      sub(butter.id, margarine.id, { createdAt: '2026-02-01T00:00:00.000Z' }),
    ];
    expect(substitutesFor(butter.id, links, ITEMS).map(s => s.item.name)).toEqual([
      'Margarine',
      'Ghee',
    ]);
  });
});

describe('substituteForItems', () => {
  it('answers the reverse question — what this stands in for', () => {
    const links = [sub(butter.id, margarine.id), sub(oil.id, margarine.id)];
    expect(substituteForItems(margarine.id, links, ITEMS).map(s => s.item.name)).toEqual([
      'Butter',
      'Olive oil',
    ]);
  });

  it('drops a link whose original is gone', () => {
    const links = [sub('deleted-row', margarine.id)];
    expect(substituteForItems(margarine.id, links, ITEMS)).toEqual([]);
  });
});

describe('describeSubstitutes', () => {
  const resolve = (links: ItemSubLink[]) => substitutesFor(butter.id, links, ITEMS);

  it('is silent with nothing recorded', () => {
    expect(describeSubstitutes(resolve([]))).toBeNull();
  });

  it('names one and two', () => {
    expect(describeSubstitutes(resolve([sub(butter.id, margarine.id)]))).toBe('Margarine');
    expect(
      describeSubstitutes(
        resolve([
          sub(butter.id, margarine.id, { createdAt: '2026-01-01T00:00:00.000Z' }),
          sub(butter.id, ghee.id, { createdAt: '2026-01-02T00:00:00.000Z' }),
        ])
      )
    ).toBe('Margarine, Ghee');
  });

  it('falls back to a count past two, which is what fits on one line', () => {
    expect(
      describeSubstitutes(
        resolve([
          sub(butter.id, margarine.id, { createdAt: '2026-01-01T00:00:00.000Z' }),
          sub(butter.id, ghee.id, { createdAt: '2026-01-02T00:00:00.000Z' }),
          sub(butter.id, oil.id, { createdAt: '2026-01-03T00:00:00.000Z' }),
        ])
      )
    ).toBe('3 substitutes');
  });
});
