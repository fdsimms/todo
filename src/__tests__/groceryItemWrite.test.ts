import type { GroceryItem, GroceryList, GroceryListEntry, ItemProduct, ItemShopLink, ItemSubLink, Shop, StoreAlias } from '../types';
import { newItemRow } from '../utils/groceryAdd';
import {
  aliasRow,
  clearOtherStandingLinks,
  deletedItemSnapshot,
  listNameProblem,
  mergedItemRow,
  chosenOptionRows,
  newListRow,
  newShopRow,
  planFinishShopping,
  preferredProductRow,
  pricedRows,
  productEditRow,
  renameRows,
  renamedShopRow,
  shopLinkRow,
  subLinkRows,
} from '../utils/groceryItemWrite';

// dateUtils reaches the settings store for dayResetTime, which reaches expo-sqlite.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const NOW = '2026-08-23T12:00:00.000Z';

const item = (name: string, over: Partial<GroceryItem> = {}): GroceryItem => ({
  ...newItemRow({ name, nameKey: name.toLowerCase(), aisle: 'Other', onList: false, sortOrder: 1, createdAt: NOW }),
  id: `id-${name}`,
  ...over,
});

const box = (over: Partial<ItemProduct> = {}): ItemProduct =>
  ({ id: 'b1', itemId: 'id-Bread', brand: 'Acme', variant: null, productKey: 'acme', note: '', rating: null, isPortion: false, ...over }) as ItemProduct;

const link = (over: Partial<ItemShopLink> = {}): ItemShopLink =>
  ({ itemId: 'i', shopId: 's', purchaseCount: 3, lastPurchasedAt: NOW, unavailableAt: null, productId: null, unavailableProductIds: {}, lastPriceMinor: 100, lastPricedAt: NOW, lastPriceQuantity: null, priceHistory: [], ...over }) as ItemShopLink;

describe('pricedRows', () => {
  it('pairs the price with the current quantity, and a recipe quantity pairs with nothing', () => {
    expect(pricedRows(item('Milk', { quantity: '1 gal' }), undefined, 449, NOW).item).toMatchObject({ lastPriceMinor: 449, lastPricedAt: NOW, lastPriceQuantity: '1 gal' });
    expect(pricedRows(item('Milk', { quantity: '3 cups', quantityFromRecipe: true }), undefined, 449, NOW).item.lastPriceQuantity).toBeNull();
  });

  it('clears the stamp and quantity with the price, and only touches a link it is given', () => {
    const cleared = pricedRows(item('Milk', { quantity: '1 gal' }), link(), null, NOW);
    expect(cleared.item).toMatchObject({ lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null });
    expect(cleared.link).toMatchObject({ lastPriceMinor: null, lastPricedAt: null });
    expect(pricedRows(item('Milk'), undefined, 100, NOW).link).toBeNull();
  });
});

describe('productEditRow', () => {
  const sibling = box({ id: 'b2', brand: 'Arnold', productKey: 'arnold|' });

  it('edits a box, recomputing its key', () => {
    const result = productEditRow(box(), [box(), sibling], { variant: 'Whole wheat', note: ' soft ' });
    expect('row' in result && result.row).toMatchObject({ variant: 'Whole wheat', note: 'soft' });
  });

  it('refuses a portion, a box with no words, and a clash with a sibling', () => {
    expect(productEditRow(box({ isPortion: true }), [], { note: 'x' })).toEqual({ refusal: expect.stringMatching(/portion/) });
    expect(productEditRow(box(), [box()], { brand: null })).toEqual({ refusal: expect.stringMatching(/brand or a variant/) });
    expect(productEditRow(box(), [box(), sibling], { brand: 'Arnold' })).toEqual({ refusal: expect.stringMatching(/already has a box/) });
  });
});

describe('preferredProductRow', () => {
  it('takes only one of the item\'s own non-portion boxes, and is null when nothing changes', () => {
    const bread = item('Bread');
    expect(preferredProductRow(bread, [box()], 'b1')?.preferredProductId).toBe('b1');
    expect(preferredProductRow(bread, [box({ itemId: 'other' })], 'b1')).toBeNull();
    expect(preferredProductRow(bread, [box({ isPortion: true })], 'b1')).toBeNull();
    expect(preferredProductRow({ ...bread, preferredProductId: 'b1' }, [box()], 'b1')).toBeNull();
    expect(preferredProductRow({ ...bread, preferredProductId: 'b1' }, [box()], null)?.preferredProductId).toBeNull();
  });
});

describe('renameRows', () => {
  it('refuses an empty name and a name another item has, and follows varieties of the old key', () => {
    const items = [item('onion'), item('white onion', { varietyOfKey: 'onion' }), item('leek')];
    expect(renameRows(items, 'id-onion', '  ')).toEqual({ refusal: expect.stringMatching(/needs a name/) });
    expect(renameRows(items, 'id-onion', 'Leek')).toEqual({ refusal: expect.stringMatching(/already an item/) });
    const done = renameRows(items, 'id-onion', 'Yellow onion');
    expect('item' in done && done.item).toMatchObject({ name: 'Yellow onion', nameFromScan: false });
    expect('repointed' in done && done.repointed.map(r => r.varietyOfKey)).toEqual(['yellow onion']);
  });

  it('clears a variety declaration that now points at itself', () => {
    const done = renameRows([item('a', { varietyOfKey: 'b' }), item('b')], 'id-a', 'B');
    // 'b' is taken, so refused; renaming onto its own key is the self-variety case.
    expect('refusal' in done).toBe(true);
    const own = renameRows([item('a', { varietyOfKey: 'a2' })], 'id-a', 'A2');
    expect('item' in own && own.item.varietyOfKey).toBeNull();
  });
});

describe('shopLinkRow and the shop rows', () => {
  it('an existing positive link is left alone, a negative one is corrected keeping its purchases, a new one starts at zero', () => {
    expect(shopLinkRow(link(), 'i', 's')).toBeNull();
    expect(shopLinkRow(link({ unavailableAt: NOW }), 'i', 's')).toMatchObject({ unavailableAt: null, purchaseCount: 3 });
    expect(shopLinkRow(undefined, 'i', 's')).toMatchObject({ purchaseCount: 0, unavailableAt: null });
  });

  it('refuses a duplicate or empty store name, and a rename onto another store', () => {
    const a = newShopRow('Safeway', [], 's1', NOW)!;
    expect(newShopRow('safeway', [a], 's2', NOW)).toBeNull();
    expect(newShopRow('  ', [a], 's2', NOW)).toBeNull();
    const b = newShopRow('Costco', [a], 's2', NOW)!;
    expect(b.sortOrder).toBe(a.sortOrder + 1);
    expect(renamedShopRow(b, 'Safeway', [a, b])).toBeNull();
    expect(renamedShopRow(b, 'Costco Wholesale', [a, b])?.name).toBe('Costco Wholesale');
  });
});

describe('subLinkRows', () => {
  const existing: ItemSubLink[] = [];

  it('refuses a self-link, needs both halves of a ratio, and swaps the ratio on the reverse row', () => {
    expect(subLinkRows('a', 'a', existing, {}, NOW)).toBeNull();
    expect(subLinkRows('a', 'b', existing, { ratioFrom: '1 cup' }, NOW)!.written[0]).toMatchObject({ ratioFrom: null, ratioTo: null });
    const both = subLinkRows('a', 'b', existing, { ratioFrom: '1 clove', ratioTo: '1/8 tsp', bothWays: true, standing: true }, NOW)!;
    expect(both.written).toEqual([
      expect.objectContaining({ itemId: 'a', subItemId: 'b', ratioFrom: '1 clove', ratioTo: '1/8 tsp', standing: true }),
      expect.objectContaining({ itemId: 'b', subItemId: 'a', ratioFrom: '1/8 tsp', ratioTo: '1 clove', standing: false }),
    ]);
  });

  it('keeps the original createdAt on a re-link, and a standing link clears the one it would conflict with', () => {
    const prior: ItemSubLink = { itemId: 'a', subItemId: 'c', note: null, createdAt: 'old', ratioFrom: null, ratioTo: null, standing: true };
    const again: ItemSubLink = { itemId: 'a', subItemId: 'b', note: null, createdAt: 'older', ratioFrom: null, ratioTo: null, standing: false };
    const rows = subLinkRows('a', 'b', [prior, again], { standing: true }, NOW)!;
    expect(rows.written[0].createdAt).toBe('older');
    expect(rows.cleared).toEqual([{ ...prior, standing: false }]);
    expect(clearOtherStandingLinks([prior], 'b', 'a')).toEqual([]);
  });
});

describe('lists and aliases', () => {
  const lists: GroceryList[] = [{ id: 'l1', name: 'Lake house', sortOrder: 2, createdAt: NOW }];

  it('names are case-insensitive, unique, and not the home list\'s', () => {
    expect(listNameProblem('', lists)).toMatch(/needs a name/);
    expect(listNameProblem('groceries', lists)).toMatch(/home/);
    expect(listNameProblem('LAKE HOUSE', lists)).toMatch(/already/);
    expect(listNameProblem('Lake house', lists, 'l1')).toBeNull();
    expect(newListRow(' Cabin ', lists, 'l2', NOW)).toMatchObject({ name: 'Cabin', sortOrder: 3 });
  });

  it('aliasRow bumps an existing pair, keeps its id and createdAt, and skips an empty key', () => {
    const prior: StoreAlias = { id: 'a1', shopId: 's', rawKey: 'gv mlk', itemId: 'old', hitCount: 2, createdAt: 'then', lastUsedAt: 'then' };
    expect(aliasRow([prior], 's', 'GV MLK', 'milk', 'new', NOW)).toMatchObject({ id: 'a1', itemId: 'milk', hitCount: 3, createdAt: 'then', lastUsedAt: NOW });
    expect(aliasRow([], null, 'GV MLK', 'milk', 'new', NOW)).toMatchObject({ id: 'new', shopId: '', hitCount: 1 });
    expect(aliasRow([], 's', '   ', 'milk', 'new', NOW)).toBeNull();
  });
});

describe('planFinishShopping', () => {
  const shops = [newShopRow('Costco', [], 's1', NOW)!];
  const milk = item('milk');
  const entry = (listId: string | null): GroceryListEntry => ({ itemId: milk.id, listId, checked: true, sortOrder: 1, choiceGroup: null, addedAt: NOW });
  const base = { items: [milk], shops, shopId: 's1', priceById: { [milk.id]: 449 }, purchasedAt: NOW };

  it('a home trip keeps the store and the prices and dates the shelf-life items', () => {
    const plan = planFinishShopping({ ...base, entries: [entry(null)], listId: null });
    expect(plan).toMatchObject({ shopId: 's1', away: false, priceById: { [milk.id]: 449 } });
    expect(Object.keys(plan.expiresAtById)).toEqual([milk.id]);
  });

  it('an away trip drops the store, the prices and the use-by days', () => {
    const plan = planFinishShopping({ ...base, entries: [entry('l1')], listId: 'l1' });
    expect(plan).toEqual({ shopId: null, expiresAtById: {}, priceById: {}, away: true });
  });

  it('a store deleted since is dropped rather than written as a link nothing resolves', () => {
    expect(planFinishShopping({ ...base, entries: [entry(null)], listId: null, shopId: 'gone' }).shopId).toBeNull();
  });
});

describe('deletedItemSnapshot', () => {
  it('captures only what belongs to the item, with the substitutes on either end and the remembered aisle', () => {
    const bread = item('Bread');
    const snap = deletedItemSnapshot('id-Bread', {
      items: [bread, item('Milk')],
      entries: [{ itemId: 'id-Bread', listId: null }, { itemId: 'id-Milk', listId: null }] as GroceryListEntry[],
      boxes: [box(), box({ id: 'b9', itemId: 'id-Milk' })],
      shopLinks: [link({ itemId: 'id-Bread' }), link({ itemId: 'id-Milk' })],
      subLinks: [{ itemId: 'id-Bread', subItemId: 'x' }, { itemId: 'x', subItemId: 'id-Bread' }, { itemId: 'y', subItemId: 'z' }] as ItemSubLink[],
      aliases: [{ itemId: 'id-Bread' }, { itemId: 'id-Milk' }] as StoreAlias[],
      aisleOverrides: { bread: 'Bakery' },
    })!;
    expect(snap.entries).toHaveLength(1);
    expect(snap.boxes.map(b => b.id)).toEqual(['b1']);
    expect(snap.shopLinks).toHaveLength(1);
    expect(snap.subLinks).toHaveLength(2);
    expect(snap.aliases).toHaveLength(1);
    expect(snap.aisleOverride).toBe('Bakery');
    expect(deletedItemSnapshot('nope', { items: [], entries: [], boxes: [], shopLinks: [], subLinks: [], aliases: [], aisleOverrides: {} })).toBeNull();
  });
});

describe('the shared Shop type', () => {
  it('a new store reads as an ordinary receipt with every aisle', () => {
    const shop: Shop = newShopRow('Costco', [], 's', NOW)!;
    expect(shop).toMatchObject({ receiptStyle: 'itemized', aisles: null, aisleOrder: null, excludeFromSuggestions: false });
  });
});

describe('mergedItemRow', () => {
  it('keeps a frozen loser\'s pantry claim whole, rather than half of it', () => {
    const coriander = item('Coriander');
    const cilantro = item('Cilantro', {
      onHandUntil: '2026-09-30T12:00:00.000Z', frozenAt: '2026-08-01T12:00:00.000Z', expiresAt: '2026-08-05',
    });
    const merged = mergedItemRow(coriander, cilantro);
    expect(merged).toMatchObject({
      id: coriander.id, name: 'Coriander',
      onHandUntil: cilantro.onHandUntil, frozenAt: cilantro.frozenAt, expiresAt: '2026-08-05',
    });
  });

  it('keeps the survivor\'s pantry claim when its on-hand day is the later one', () => {
    const milk = item('Milk', { onHandUntil: '2026-09-30T12:00:00.000Z', openedAt: null });
    const other = item('Whole milk', { onHandUntil: '2026-09-01T12:00:00.000Z', openedAt: '2026-08-20T12:00:00.000Z' });
    expect(mergedItemRow(milk, other).openedAt).toBeNull();
  });

  it('fills the survivor\'s gaps from the loser and sums the counts', () => {
    const nutrition = { source: 'label' } as unknown as GroceryItem['nutrition'];
    const merged = mergedItemRow(
      item('Coriander', { usedUpCount: 1, spoiledCount: 0 }),
      item('Cilantro', { note: 'the bunch, not dried', aisle: 'Produce', nutrition, usedUpCount: 2, spoiledCount: 3, shelfLifeDays: 6 }),
    );
    expect(merged).toMatchObject({
      note: 'the bunch, not dried', aisle: 'Produce', nutrition, usedUpCount: 3, spoiledCount: 3, shelfLifeDays: 6,
    });
  });

  it('never fills over something the survivor already says', () => {
    const merged = mergedItemRow(item('A', { note: 'mine', aisle: 'Produce' }), item('B', { note: 'theirs', aisle: 'Deli' }));
    expect(merged).toMatchObject({ note: 'mine', aisle: 'Produce' });
  });

  it('keeps both rows\' price history and the more recent last price', () => {
    const merged = mergedItemRow(
      item('A', { lastPriceMinor: 100, lastPricedAt: '2026-08-01T00:00:00.000Z', priceHistory: [{ minor: 100, quantity: null, at: '2026-08-01T00:00:00.000Z', productId: null }] }),
      item('B', { lastPriceMinor: 200, lastPricedAt: '2026-08-10T00:00:00.000Z', priceHistory: [{ minor: 200, quantity: null, at: '2026-08-10T00:00:00.000Z', productId: null }] }),
    );
    expect(merged.lastPriceMinor).toBe(200);
    expect(merged.priceHistory.map(o => o.minor)).toEqual([200, 100]);
  });
});

describe('chosenOptionRows', () => {
  const entry = (itemId: string, over: Partial<GroceryListEntry> = {}): GroceryListEntry => ({
    itemId, listId: null, checked: false, choiceGroup: 'g', addedAt: NOW, sortOrder: 1, ...over,
  });

  it('ends the winner\'s option and takes the rest of its group off that list only', () => {
    const entries = [entry('a'), entry('b'), entry('b', { listId: 'away' }), entry('c', { choiceGroup: null })];
    const items = [item('a', { id: 'a' }), item('b', { id: 'b', quantity: '2 cups', quantityFromRecipe: true })];
    const plan = chosenOptionRows(entries, items, 'a', null)!;
    expect(plan.winner.choiceGroup).toBeNull();
    expect(plan.remove.map(e => [e.itemId, e.listId])).toEqual([['b', null]]);
    expect(plan.parked[0]).toMatchObject({ id: 'b', quantity: null, quantityFromRecipe: false });
  });

  it('is null for a row that is not an option', () => {
    expect(chosenOptionRows([entry('c', { choiceGroup: null })], [], 'c', null)).toBeNull();
  });
});
