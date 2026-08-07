import { useGroceryStore } from '../store/useGroceryStore';
import {
  dbGetAllGroceryItems,
  dbGetGroceryAisleOrder,
  dbSetGroceryAisleOrder,
  dbInsertGroceryItem,
  dbUpdateGroceryItem,
  dbDeleteGroceryItem,
  dbFinishGroceryShopping,
  dbClearGroceryList,
  dbGetAllGroceryShops,
  dbInsertGroceryShop,
  dbUpdateGroceryShop,
  dbDeleteGroceryShop,
  dbGetAllItemShopLinks,
  dbSetItemShopLink,
  dbDeleteItemShopLink,
  dbGetLastShopId,
  dbSetLastShopId,
} from '../db/database';
import { groceryNameKey } from '../utils/groceryParse';
import { DEFAULT_AISLES, OTHER_AISLE } from '../utils/groceryAisles';
import type { GroceryItem, ItemShopLink, Shop } from '../types';

jest.mock('../db/database', () => ({
  dbGetAllGroceryItems: jest.fn().mockReturnValue([]),
  dbGetGroceryAisleOrder: jest.fn().mockReturnValue(null),
  dbSetGroceryAisleOrder: jest.fn(),
  dbInsertGroceryItem: jest.fn(),
  dbUpdateGroceryItem: jest.fn(),
  dbDeleteGroceryItem: jest.fn(),
  dbFinishGroceryShopping: jest.fn().mockReturnValue([]),
  dbClearGroceryList: jest.fn().mockReturnValue([]),
  dbGetAllGroceryShops: jest.fn().mockReturnValue([]),
  dbInsertGroceryShop: jest.fn(),
  dbUpdateGroceryShop: jest.fn(),
  dbDeleteGroceryShop: jest.fn(),
  dbGetAllItemShopLinks: jest.fn().mockReturnValue([]),
  dbSetItemShopLink: jest.fn(),
  dbDeleteItemShopLink: jest.fn(),
  dbGetLastShopId: jest.fn().mockReturnValue(null),
  dbSetLastShopId: jest.fn(),
}));

let seq = 0;
function makeItem(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  const name = overrides.name;
  return {
    id: `id-${++seq}`,
    nameKey: groceryNameKey(name),
    aisle: OTHER_AISLE,
    quantity: null,
    note: '',
    onList: false,
    checked: false,
    sortOrder: seq,
    favorite: false,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeShop(name: string, overrides: Partial<Shop> = {}): Shop {
  return {
    id: `shop-${++seq}`,
    name,
    nameKey: groceryNameKey(name),
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function seed(items: GroceryItem[], shops: Shop[] = [], itemShops: ItemShopLink[] = []) {
  useGroceryStore.setState({
    items,
    aisleOrder: [...DEFAULT_AISLES],
    shops,
    itemShops,
    lastShopId: null,
    cartHoldIds: [],
    initialized: true,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetAllGroceryItems as jest.Mock).mockReturnValue([]);
  (dbGetGroceryAisleOrder as jest.Mock).mockReturnValue(null);
  (dbFinishGroceryShopping as jest.Mock).mockReturnValue([]);
  (dbClearGroceryList as jest.Mock).mockReturnValue([]);
  (dbGetAllGroceryShops as jest.Mock).mockReturnValue([]);
  (dbGetAllItemShopLinks as jest.Mock).mockReturnValue([]);
  (dbGetLastShopId as jest.Mock).mockReturnValue(null);
  seed([]);
});

// ─── initialize ──────────────────────────────────────────────────────────────

describe('initialize', () => {
  it('loads rows and the default walk order', () => {
    const milk = makeItem({ name: 'Milk' });
    (dbGetAllGroceryItems as jest.Mock).mockReturnValue([milk]);

    useGroceryStore.getState().initialize();

    expect(useGroceryStore.getState().items).toEqual([milk]);
    expect(useGroceryStore.getState().aisleOrder).toEqual([...DEFAULT_AISLES]);
    expect(useGroceryStore.getState().initialized).toBe(true);
  });

  it('repairs a stored order WITHOUT writing it back', () => {
    // The whole point: shipping a bigger DEFAULT_AISLES later needs no
    // migration, and can't clobber an order arranged to match a real store.
    (dbGetGroceryAisleOrder as jest.Mock).mockReturnValue(['Frozen', 'Produce']);

    useGroceryStore.getState().initialize();

    const order = useGroceryStore.getState().aisleOrder;
    expect(order[0]).toBe('Frozen');
    expect(order).toContain('Bakery');
    expect(dbSetGroceryAisleOrder).not.toHaveBeenCalled();
  });

  it('takes in an aisle only a row knows about', () => {
    (dbGetAllGroceryItems as jest.Mock).mockReturnValue([makeItem({ name: 'Steak', aisle: 'Butcher' })]);
    useGroceryStore.getState().initialize();
    expect(useGroceryStore.getState().aisleOrder).toContain('Butcher');
  });
});

// ─── addByName ───────────────────────────────────────────────────────────────

describe('addByName', () => {
  it('inserts a genuinely new item, filed by the lexicon', () => {
    const item = useGroceryStore.getState().addByName('Milk');

    expect(dbInsertGroceryItem).toHaveBeenCalledTimes(1);
    expect(item.name).toBe('Milk');
    expect(item.nameKey).toBe('milk');
    expect(item.aisle).toBe('Dairy & Eggs');
    expect(item.onList).toBe(true);
    expect(item.checked).toBe(false);
    expect(useGroceryStore.getState().items).toHaveLength(1);
  });

  it('files an unrecognised item under Other rather than leaving it aisle-less', () => {
    expect(useGroceryStore.getState().addByName('nduja').aisle).toBe(OTHER_AISLE);
  });

  it('splits the quantity off the name so the key stays clean', () => {
    const item = useGroceryStore.getState().addByName('2 lb chicken thighs');
    expect(item.name).toBe('chicken thighs');
    expect(item.quantity).toBe('2 lb');
    expect(item.aisle).toBe('Meat & Seafood');
  });

  it('puts a known item back on the list instead of inserting a duplicate', () => {
    // This is the whole product insight — no duplicates, ever.
    seed([makeItem({ name: 'Milk', onList: false, purchaseCount: 7 })]);

    useGroceryStore.getState().addByName('milk');

    expect(dbInsertGroceryItem).not.toHaveBeenCalled();
    expect(dbUpdateGroceryItem).toHaveBeenCalledTimes(1);
    const items = useGroceryStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].onList).toBe(true);
    expect(items[0].purchaseCount).toBe(7);
  });

  it('matches on the normalised key, not the typed string', () => {
    seed([makeItem({ name: 'Milk' })]);
    useGroceryStore.getState().addByName('  MILK,  ');
    expect(useGroceryStore.getState().items).toHaveLength(1);
  });

  it('takes the newly typed name as the label', () => {
    seed([makeItem({ name: 'milk' })]);
    useGroceryStore.getState().addByName('Milk');
    expect(useGroceryStore.getState().items[0].name).toBe('Milk');
  });

  it('keeps the existing quantity when the re-add carries none', () => {
    seed([makeItem({ name: 'Milk', quantity: '2 gal' })]);
    useGroceryStore.getState().addByName('milk');
    expect(useGroceryStore.getState().items[0].quantity).toBe('2 gal');
  });

  it('overwrites the quantity when the re-add carries one', () => {
    seed([makeItem({ name: 'Milk', quantity: '2 gal' })]);
    useGroceryStore.getState().addByName('1 gal milk');
    expect(useGroceryStore.getState().items[0].quantity).toBe('1 gal');
  });

  // Two punctuation-only names both normalise to an empty key; without a
  // fallback they'd collide on the UNIQUE index and the second insert would
  // throw out of whatever was calling — a paste, or the Reminders drain
  // mid-batch.
  it('keeps a key for a name with no letters or digits', () => {
    const a = useGroceryStore.getState().addByName('???');
    const b = useGroceryStore.getState().addByName('!!!');
    expect(a.nameKey).not.toBe('');
    expect(b.nameKey).not.toBe('');
    expect(a.nameKey).not.toBe(b.nameKey);
    expect(useGroceryStore.getState().items).toHaveLength(2);
  });

  it('un-checks a checked row that gets re-added', () => {
    seed([makeItem({ name: 'Milk', onList: true, checked: true })]);
    useGroceryStore.getState().addByName('milk');
    expect(useGroceryStore.getState().items[0].checked).toBe(false);
  });
});

// ─── addManyFromText ─────────────────────────────────────────────────────────

describe('addManyFromText', () => {
  it('adds one item per line and reports what was already there', () => {
    seed([makeItem({ name: 'Milk', onList: true })]);

    const { added, alreadyOnList } = useGroceryStore.getState().addManyFromText('milk\neggs\nbread');

    expect(added.map(i => i.name)).toEqual(['eggs', 'bread']);
    expect(alreadyOnList.map(i => i.name)).toEqual(['milk']);
    expect(useGroceryStore.getState().items).toHaveLength(3);
  });

  it('strips bullets and numbering from a pasted recipe', () => {
    useGroceryStore.getState().addManyFromText('- milk\n1. eggs\n• bread');
    expect(useGroceryStore.getState().items.map(i => i.name)).toEqual(['milk', 'eggs', 'bread']);
  });

  it('counts a catalog item that was off the list as newly added', () => {
    seed([makeItem({ name: 'Milk', onList: false })]);
    const { added, alreadyOnList } = useGroceryStore.getState().addManyFromText('milk');
    expect(added).toHaveLength(1);
    expect(alreadyOnList).toHaveLength(0);
  });
});

// ─── toggleChecked and the cart hold ─────────────────────────────────────────

describe('toggleChecked', () => {
  it('checks a listed row and holds it in place', () => {
    const milk = makeItem({ name: 'Milk', onList: true });
    seed([milk]);

    useGroceryStore.getState().toggleChecked(milk.id);

    expect(useGroceryStore.getState().items[0].checked).toBe(true);
    expect(useGroceryStore.getState().cartHoldIds).toEqual([milk.id]);
  });

  it('drops the hold when un-checked inside the window', () => {
    const milk = makeItem({ name: 'Milk', onList: true });
    seed([milk]);

    useGroceryStore.getState().toggleChecked(milk.id);
    useGroceryStore.getState().toggleChecked(milk.id);

    expect(useGroceryStore.getState().items[0].checked).toBe(false);
    expect(useGroceryStore.getState().cartHoldIds).toEqual([]);
  });

  it('clears the hold once the timer fires, batching a whole burst together', () => {
    jest.useFakeTimers();
    const milk = makeItem({ name: 'Milk', onList: true });
    const eggs = makeItem({ name: 'Eggs', onList: true });
    seed([milk, eggs]);

    useGroceryStore.getState().toggleChecked(milk.id);
    useGroceryStore.getState().toggleChecked(eggs.id);
    expect(useGroceryStore.getState().cartHoldIds).toHaveLength(2);

    jest.advanceTimersByTime(5000);
    expect(useGroceryStore.getState().cartHoldIds).toEqual([]);
    jest.useRealTimers();
  });

  it('refuses to check a row that is not on the list', () => {
    // The checked ⇒ onList invariant.
    const milk = makeItem({ name: 'Milk', onList: false });
    seed([milk]);

    useGroceryStore.getState().toggleChecked(milk.id);

    expect(useGroceryStore.getState().items[0].checked).toBe(false);
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });
});

// ─── finishShopping / clearList ──────────────────────────────────────────────

describe('finishShopping', () => {
  it('records the purchase, empties the list and deletes nothing', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true, purchaseCount: 3 });
    const eggs = makeItem({ name: 'Eggs', onList: true, checked: false });
    seed([milk, eggs]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    expect(useGroceryStore.getState().finishShopping()).toBe(1);

    const after = useGroceryStore.getState().items;
    expect(after).toHaveLength(2);
    expect(dbDeleteGroceryItem).not.toHaveBeenCalled();

    const milkAfter = after.find(i => i.id === milk.id)!;
    expect(milkAfter.onList).toBe(false);
    expect(milkAfter.checked).toBe(false);
    // The ranking signal, which is the real reason this isn't a delete.
    expect(milkAfter.purchaseCount).toBe(4);
    expect(milkAfter.lastPurchasedAt).not.toBeNull();

    // The unchecked one stays on the list for next time.
    expect(after.find(i => i.id === eggs.id)!.onList).toBe(true);
  });

  it('is a no-op with an empty trolley', () => {
    seed([makeItem({ name: 'Milk', onList: true })]);
    expect(useGroceryStore.getState().finishShopping()).toBe(0);
    expect(useGroceryStore.getState().items[0].onList).toBe(true);
  });
});

describe('clearList', () => {
  it('empties the list without crediting a purchase', () => {
    // Nothing was bought — inflating purchaseCount would teach autocomplete a lie.
    const milk = makeItem({ name: 'Milk', onList: true, purchaseCount: 3 });
    seed([milk]);
    (dbClearGroceryList as jest.Mock).mockReturnValue([milk.id]);

    expect(useGroceryStore.getState().clearList()).toBe(1);

    const after = useGroceryStore.getState().items[0];
    expect(after.onList).toBe(false);
    expect(after.purchaseCount).toBe(3);
    expect(dbDeleteGroceryItem).not.toHaveBeenCalled();
  });
});

// ─── renameItem ──────────────────────────────────────────────────────────────

describe('renameItem', () => {
  it('renames and re-keys', () => {
    const milk = makeItem({ name: 'Milk' });
    seed([milk]);

    expect(useGroceryStore.getState().renameItem(milk.id, 'Whole milk')).toBe(true);
    expect(useGroceryStore.getState().items[0].nameKey).toBe('whole milk');
  });

  it('refuses a collision rather than merging two catalog rows', () => {
    // Merging means picking whose purchaseCount survives, and there's no right answer.
    const milk = makeItem({ name: 'Milk' });
    const bread = makeItem({ name: 'Bread' });
    seed([milk, bread]);

    expect(useGroceryStore.getState().renameItem(bread.id, 'milk')).toBe(false);
    expect(useGroceryStore.getState().items.find(i => i.id === bread.id)!.name).toBe('Bread');
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });

  it('allows a re-capitalisation of the same key', () => {
    const milk = makeItem({ name: 'milk' });
    seed([milk]);
    expect(useGroceryStore.getState().renameItem(milk.id, 'Milk')).toBe(true);
  });

  it('refuses a blank name', () => {
    const milk = makeItem({ name: 'Milk' });
    seed([milk]);
    expect(useGroceryStore.getState().renameItem(milk.id, '   ')).toBe(false);
  });
});

// ─── the rest ────────────────────────────────────────────────────────────────

describe('list membership', () => {
  it('removeFromList keeps the catalog row', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk]);

    useGroceryStore.getState().removeFromList(milk.id);

    expect(useGroceryStore.getState().items).toHaveLength(1);
    expect(useGroceryStore.getState().items[0].onList).toBe(false);
    expect(useGroceryStore.getState().items[0].checked).toBe(false);
  });

  it('addExistingMany only touches rows that are off the list', () => {
    const milk = makeItem({ name: 'Milk', onList: false });
    const eggs = makeItem({ name: 'Eggs', onList: true });
    seed([milk, eggs]);

    useGroceryStore.getState().addExistingMany([milk.id, eggs.id]);

    expect(dbUpdateGroceryItem).toHaveBeenCalledTimes(1);
    expect(useGroceryStore.getState().items.every(i => i.onList)).toBe(true);
  });

  it('deleteItem is the one real delete', () => {
    const milk = makeItem({ name: 'Milk' });
    seed([milk]);

    useGroceryStore.getState().deleteItem(milk.id);

    expect(dbDeleteGroceryItem).toHaveBeenCalledWith(milk.id);
    expect(useGroceryStore.getState().items).toEqual([]);
  });
});

describe('aisles', () => {
  it('setAisle moves one row and takes a new aisle into the walk order', () => {
    const item = makeItem({ name: 'nduja' });
    seed([item]);

    useGroceryStore.getState().setAisle(item.id, 'Butcher');

    expect(useGroceryStore.getState().items[0].aisle).toBe('Butcher');
    expect(useGroceryStore.getState().aisleOrder).toContain('Butcher');
  });

  it('setAisleOrder persists a normalised order', () => {
    useGroceryStore.getState().setAisleOrder(['Frozen', 'Produce']);

    expect(dbSetGroceryAisleOrder).toHaveBeenCalledTimes(1);
    const written = (dbSetGroceryAisleOrder as jest.Mock).mock.calls[0][0] as string[];
    expect(written[0]).toBe('Frozen');
    expect(written[written.length - 1]).toBe(OTHER_AISLE);
  });
});

// ─── stores ──────────────────────────────────────────────────────────────────

describe('shops', () => {
  it('addShop inserts and takes the name as typed', () => {
    const shop = useGroceryStore.getState().addShop("  Trader Joe's  ");

    expect(shop).not.toBeNull();
    expect(shop!.name).toBe("Trader Joe's");
    expect(shop!.nameKey).toBe(groceryNameKey("Trader Joe's"));
    expect(dbInsertGroceryShop).toHaveBeenCalledTimes(1);
    expect(useGroceryStore.getState().shops).toHaveLength(1);
  });

  it('addShop refuses a duplicate rather than handing back the existing one', () => {
    seed([], [makeShop('Costco')]);

    expect(useGroceryStore.getState().addShop('costco')).toBeNull();
    expect(dbInsertGroceryShop).not.toHaveBeenCalled();
    expect(useGroceryStore.getState().shops).toHaveLength(1);
  });

  it('addShop refuses an empty name', () => {
    expect(useGroceryStore.getState().addShop('   ')).toBeNull();
  });

  it('addShop keeps a punctuation-only name unique instead of colliding on an empty key', () => {
    const first = useGroceryStore.getState().addShop('???');
    const second = useGroceryStore.getState().addShop('!!!');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.nameKey).not.toBe(second!.nameKey);
  });

  it('renameShop leaves every link alone — they point at the id', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    const links = [{ itemId: milk.id, shopId: costco.id, purchaseCount: 3, lastPurchasedAt: null }];
    seed([milk], [costco], links);

    expect(useGroceryStore.getState().renameShop(costco.id, 'Costco Wholesale')).toBe(true);

    expect(useGroceryStore.getState().shops[0].name).toBe('Costco Wholesale');
    expect(useGroceryStore.getState().itemShops).toEqual(links);
  });

  it('renameShop refuses a collision with another store', () => {
    const costco = makeShop('Costco');
    const safeway = makeShop('Safeway');
    seed([], [costco, safeway]);

    expect(useGroceryStore.getState().renameShop(safeway.id, 'COSTCO')).toBe(false);
    expect(useGroceryStore.getState().shops.find(s => s.id === safeway.id)!.name).toBe('Safeway');
  });

  it('renameShop allows a store to keep its own key (a capitalisation fix)', () => {
    const costco = makeShop('costco');
    seed([], [costco]);

    expect(useGroceryStore.getState().renameShop(costco.id, 'Costco')).toBe(true);
    expect(useGroceryStore.getState().shops[0].name).toBe('Costco');
  });

  it('reorderShops renumbers in the order given', () => {
    const a = makeShop('Aldi');
    const b = makeShop('Big Y');
    const c = makeShop('Costco');
    seed([], [a, b, c]);

    useGroceryStore.getState().reorderShops([c.id, a.id, b.id]);

    expect(useGroceryStore.getState().shops.map(s => s.name)).toEqual(['Costco', 'Aldi', 'Big Y']);
    expect(useGroceryStore.getState().shops.map(s => s.sortOrder)).toEqual([1, 2, 3]);
  });

  it('reorderShops keeps a store the caller forgot rather than dropping it', () => {
    const a = makeShop('Aldi');
    const b = makeShop('Big Y');
    seed([], [a, b]);

    useGroceryStore.getState().reorderShops([b.id]);

    expect(useGroceryStore.getState().shops.map(s => s.name)).toEqual(['Big Y', 'Aldi']);
  });

  it('deleteShop takes its links with it', () => {
    const costco = makeShop('Costco');
    const safeway = makeShop('Safeway');
    const milk = makeItem({ name: 'Milk' });
    seed(
      [milk],
      [costco, safeway],
      [
        { itemId: milk.id, shopId: costco.id, purchaseCount: 2, lastPurchasedAt: null },
        { itemId: milk.id, shopId: safeway.id, purchaseCount: 1, lastPurchasedAt: null },
      ]
    );

    useGroceryStore.getState().deleteShop(costco.id);

    expect(dbDeleteGroceryShop).toHaveBeenCalledWith(costco.id);
    expect(useGroceryStore.getState().shops.map(s => s.name)).toEqual(['Safeway']);
    expect(useGroceryStore.getState().itemShops).toHaveLength(1);
    expect(useGroceryStore.getState().itemShops[0].shopId).toBe(safeway.id);
  });

  it('deleteShop clears the remembered store when it was the one deleted', () => {
    const costco = makeShop('Costco');
    seed([], [costco]);
    useGroceryStore.setState({ lastShopId: costco.id });

    useGroceryStore.getState().deleteShop(costco.id);

    expect(useGroceryStore.getState().lastShopId).toBeNull();
    expect(dbSetLastShopId).toHaveBeenCalledWith(null);
  });

  it('linkItemShop asserts availability with no purchase behind it', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], [costco]);

    useGroceryStore.getState().linkItemShop(milk.id, costco.id);

    expect(useGroceryStore.getState().itemShops).toEqual([
      { itemId: milk.id, shopId: costco.id, purchaseCount: 0, lastPurchasedAt: null },
    ]);
    expect(dbSetItemShopLink).toHaveBeenCalledTimes(1);
  });

  it('linkItemShop will not overwrite a link that already has purchases', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], [costco], [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 5, lastPurchasedAt: null },
    ]);

    useGroceryStore.getState().linkItemShop(milk.id, costco.id);

    expect(useGroceryStore.getState().itemShops[0].purchaseCount).toBe(5);
    expect(dbSetItemShopLink).not.toHaveBeenCalled();
  });

  it('linkItemShop ignores an unknown item or store', () => {
    seed([], []);
    useGroceryStore.getState().linkItemShop('nope', 'also-nope');
    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
  });

  it('unlinkItemShop removes just that pair', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    const eggs = makeItem({ name: 'Eggs' });
    seed([milk, eggs], [costco], [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 1, lastPurchasedAt: null },
      { itemId: eggs.id, shopId: costco.id, purchaseCount: 1, lastPurchasedAt: null },
    ]);

    useGroceryStore.getState().unlinkItemShop(milk.id, costco.id);

    expect(useGroceryStore.getState().itemShops.map(l => l.itemId)).toEqual([eggs.id]);
  });

  it('deleting an item drops its links too', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], [costco], [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 4, lastPurchasedAt: null },
    ]);

    useGroceryStore.getState().deleteItem(milk.id);

    expect(useGroceryStore.getState().items).toHaveLength(0);
    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
  });

  it('initialize drops a remembered store that no longer exists', () => {
    (dbGetLastShopId as jest.Mock).mockReturnValue('shop-gone');

    useGroceryStore.getState().initialize();

    expect(useGroceryStore.getState().lastShopId).toBeNull();
  });

  it('initialize keeps a remembered store that does', () => {
    const costco = makeShop('Costco');
    (dbGetAllGroceryShops as jest.Mock).mockReturnValue([costco]);
    (dbGetLastShopId as jest.Mock).mockReturnValue(costco.id);

    useGroceryStore.getState().initialize();

    expect(useGroceryStore.getState().lastShopId).toBe(costco.id);
  });
});

describe('finishShopping with a store', () => {
  it('creates a link on the first trip and remembers the store', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk], [costco]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(costco.id);

    expect(dbFinishGroceryShopping).toHaveBeenCalledWith(expect.any(String), costco.id);
    const links = useGroceryStore.getState().itemShops;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ itemId: milk.id, shopId: costco.id, purchaseCount: 1 });
    expect(links[0].lastPurchasedAt).not.toBeNull();
    expect(useGroceryStore.getState().lastShopId).toBe(costco.id);
  });

  it('bumps an existing link on a repeat trip instead of adding a second', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true, purchaseCount: 2 });
    seed([milk], [costco], [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 2, lastPurchasedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(costco.id);

    const links = useGroceryStore.getState().itemShops;
    expect(links).toHaveLength(1);
    expect(links[0].purchaseCount).toBe(3);
    expect(links[0].lastPurchasedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('turns a hand-asserted link into an observed one', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk], [costco], [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 0, lastPurchasedAt: null },
    ]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(costco.id);

    expect(useGroceryStore.getState().itemShops[0].purchaseCount).toBe(1);
  });

  it('leaves another store’s link for the same item alone', () => {
    const costco = makeShop('Costco');
    const safeway = makeShop('Safeway');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk], [costco, safeway], [
      { itemId: milk.id, shopId: safeway.id, purchaseCount: 4, lastPurchasedAt: null },
    ]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(costco.id);

    const links = useGroceryStore.getState().itemShops;
    expect(links).toHaveLength(2);
    expect(links.find(l => l.shopId === safeway.id)!.purchaseCount).toBe(4);
    expect(links.find(l => l.shopId === costco.id)!.purchaseCount).toBe(1);
  });

  // The point of the whole feature being additive: no store is a real answer.
  it('records no link when the trip names no store', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk], [makeShop('Costco')]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping();

    expect(dbFinishGroceryShopping).toHaveBeenCalledWith(expect.any(String), null);
    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
    // ...and the item-level count still moved, which is what makes the two
    // numbers diverge and why nothing may sum links to get a total.
    expect(useGroceryStore.getState().items[0].purchaseCount).toBe(1);
    expect(dbSetLastShopId).not.toHaveBeenCalled();
  });

  it('ignores a store id that no longer resolves', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk], []);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping('shop-deleted-mid-sheet');

    expect(dbFinishGroceryShopping).toHaveBeenCalledWith(expect.any(String), null);
    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
  });

  it('writes nothing at all when the trolley is empty', () => {
    const costco = makeShop('Costco');
    seed([makeItem({ name: 'Milk', onList: true })], [costco]);

    expect(useGroceryStore.getState().finishShopping(costco.id)).toBe(0);
    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
    expect(useGroceryStore.getState().lastShopId).toBeNull();
  });

  it('clearList records no purchase anywhere, store or not', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk], [costco]);
    (dbClearGroceryList as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().clearList();

    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
    expect(useGroceryStore.getState().items[0].purchaseCount).toBe(0);
  });
});
