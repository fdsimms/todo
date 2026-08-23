import {
  describeSubstitutes,
  describeSubstitutesOnHand,
  resolveShoppingSubstitutes,
  substituteForItems,
  substituteQuantity,
  substitutesFor,
  substitutesOnHand,
} from '../utils/itemSubs';
import { groceryNameKey } from '../utils/groceryParse';
import { OTHER_AISLE } from '../utils/groceryAisles';
import type { GroceryItem, ItemSubLink } from '../types';

function makeItem(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: `item-${groceryNameKey(name).replace(/\s/g, '-')}`,
    name,
    nameKey: groceryNameKey(name),
    preferredProductId: null,
    productStrict: false,
    aisle: OTHER_AISLE,
    quantity: null,
    quantityFromRecipe: false,
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
    frozenAt: null,
    openedAt: null,
    runningLowAt: null,
    shelfLifeDays: null,
    useUpTask: null,
    pantryCheckDeclinedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null, priceHistory: [],
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
    ratioFrom: null,
    ratioTo: null,
    standing: false,
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

describe('substituteQuantity', () => {
  it('converts a matching-unit line through the ratio', () => {
    // The motivating example: a clove of garlic is about 1/4 tsp of powder.
    expect(substituteQuantity('3 cloves', '1 clove', '1/4 tsp')).toEqual({
      text: '3/4 tsp',
      converted: true,
    });
  });

  it('scales past a whole number cleanly', () => {
    expect(substituteQuantity('4 cloves', '1 clove', '1/4 tsp')).toEqual({
      text: '1 tsp',
      converted: true,
    });
  });

  it('inflects the resulting unit', () => {
    expect(substituteQuantity('4 cloves', '1 clove', '1 tsp')).toEqual({
      text: '4 tsp',
      converted: true,
    });
    expect(substituteQuantity('1 clove', '1 clove', '1 tsp')).toEqual({
      text: '1 tsp',
      converted: true,
    });
  });

  it('is exact, not a decimal round-trip — a third tripled is exactly one', () => {
    // Mirrors recipeScale's own "1/3 tripled is exactly 1, not 0.99" case,
    // now going through a factor computed by division rather than a picked
    // scale — see substituteQuantity's comment on why that's still safe.
    expect(substituteQuantity('1 cup', '1/3 cup', '1 tbsp')).toEqual({
      text: '3 tbsp',
      converted: true,
    });
    expect(substituteQuantity('2/3 cup', '1/3 cup', '1 tbsp')).toEqual({
      text: '2 tbsp',
      converted: true,
    });
  });

  it('handles the exact-1x identity case, which scaleQuantity itself would call a no-op', () => {
    // The line names precisely one `ratioFrom`, so the converted amount is
    // `ratioTo` verbatim — a real conversion, not "nothing to do".
    expect(substituteQuantity('1 clove', '1 clove', '1/4 tsp')).toEqual({
      text: '1/4 tsp',
      converted: true,
    });
    // Reducible fractions that are the same value after GCD-reduction still
    // hit the identity path exactly, not a near-miss.
    expect(substituteQuantity('2/6 cup', '1/3 cup', '1 tbsp')).toEqual({
      text: '1 tbsp',
      converted: true,
    });
  });

  it('refuses when the units do not match — the load-bearing case', () => {
    // A ratio written per clove must not silently apply to a whole bulb.
    expect(substituteQuantity('1 bulb', '1 clove', '1/4 tsp')).toEqual({
      text: '1 bulb',
      converted: false,
    });
  });

  it('refuses when the line has no unit to compare at all', () => {
    expect(substituteQuantity('3', '1 clove', '1/4 tsp')).toEqual({
      text: '3',
      converted: false,
    });
  });

  it('refuses when the line amount does not parse — "a pinch of garlic" stays "a pinch"', () => {
    expect(substituteQuantity('a pinch', '1 clove', '1/4 tsp')).toEqual({
      text: 'a pinch',
      converted: false,
    });
  });

  it('refuses when the ratio itself has no parseable amount on either side', () => {
    expect(substituteQuantity('3 cloves', 'some', '1/4 tsp')).toEqual({
      text: '3 cloves',
      converted: false,
    });
    expect(substituteQuantity('3 cloves', '1 clove', 'some')).toEqual({
      text: '3 cloves',
      converted: false,
    });
  });

  it('refuses on an empty line quantity', () => {
    expect(substituteQuantity('', '1 clove', '1/4 tsp')).toEqual({ text: '', converted: false });
  });

  it('compares units by identity, so an inflected line still matches a singular ratio', () => {
    expect(substituteQuantity('1 clove', '1 cloves', '1/4 tsp')).toEqual({
      text: '1/4 tsp',
      converted: true,
    });
  });
});

describe('substitutesOnHand', () => {
  const NOW = new Date('2026-08-14T12:00:00.000Z');
  const onHand = (i: GroceryItem) => ({ ...i, onHandUntil: '2026-09-01T00:00:00.000Z' });
  const outOf = (i: GroceryItem) => ({ ...i, onHandUntil: '2026-01-01T00:00:00.000Z' });

  it('keeps only the substitutes the app thinks you have', () => {
    const items = [butter, onHand(margarine), ghee];
    const links = [sub(butter.id, margarine.id), sub(butter.id, ghee.id)];
    expect(substitutesOnHand(butter.id, links, items, NOW).map(s => s.item.name)).toEqual([
      'Margarine',
    ]);
  });

  it('says nothing when the app has no opinion — ignorance is not absence', () => {
    // The default state of nearly every item, which is why this must not be
    // read as "you have not got it".
    const links = [sub(butter.id, margarine.id)];
    expect(substitutesOnHand(butter.id, links, ITEMS, NOW)).toEqual([]);
  });

  it('drops one the user has marked out of', () => {
    const links = [sub(butter.id, margarine.id)];
    expect(substitutesOnHand(butter.id, links, [butter, outOf(margarine)], NOW)).toEqual([]);
  });

  it('counts a staple, which needs no purchase history', () => {
    const links = [sub(butter.id, ghee.id)];
    const items = [butter, { ...ghee, isStaple: true }];
    expect(substitutesOnHand(butter.id, links, items, NOW).map(s => s.item.name)).toEqual(['Ghee']);
  });
});

describe('describeSubstitutesOnHand', () => {
  const NOW = new Date('2026-08-14T12:00:00.000Z');
  const onHand = (i: GroceryItem) => ({ ...i, onHandUntil: '2026-09-01T00:00:00.000Z' });

  const line = (subNames: GroceryItem[]) =>
    describeSubstitutesOnHand(
      substitutesOnHand(
        butter.id,
        subNames.map((s, i) => sub(butter.id, s.id, { createdAt: `2026-0${i + 1}-01T00:00:00.000Z` })),
        [butter, ...subNames.map(onHand)],
        NOW
      )
    );

  it('is silent with nothing on hand', () => {
    expect(describeSubstitutesOnHand([])).toBeNull();
  });

  it('names one and two, lower-cased for a sentence', () => {
    expect(line([margarine])).toBe('you have margarine');
    expect(line([margarine, ghee])).toBe('you have margarine or ghee');
  });

  it('counts past two, since this lands in a one-line row subtitle', () => {
    expect(line([margarine, ghee, oil])).toBe('you have 3 substitutes');
  });
});

describe('resolveShoppingSubstitutes', () => {
  it('writes nothing for an empty answer', () => {
    expect(resolveShoppingSubstitutes([butter.id], {})).toEqual([]);
  });

  it('drops an answer for a row that was never ticked unavailable', () => {
    // Stale from before the row was un-ticked, or an id that was never on the
    // unavailable list at all — either way, not something to write.
    expect(resolveShoppingSubstitutes([], { [butter.id]: margarine.id })).toEqual([]);
  });

  it('keeps an answer for a row that is ticked unavailable and answered', () => {
    expect(resolveShoppingSubstitutes([butter.id], { [butter.id]: margarine.id })).toEqual([
      { itemId: butter.id, subItemId: margarine.id },
    ]);
  });

  it('only writes the ticked rows that were actually answered', () => {
    const result = resolveShoppingSubstitutes([butter.id, oil.id], { [butter.id]: margarine.id });
    expect(result).toEqual([{ itemId: butter.id, subItemId: margarine.id }]);
  });
});
