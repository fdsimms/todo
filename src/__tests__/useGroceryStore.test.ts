import { useGroceryStore } from '../store/useGroceryStore';
import {
  dbGetAllGroceryItems,
  dbGetGroceryAisleOrder,
  dbSetGroceryAisleOrder,
  dbGetGroceryAisleOverrides,
  dbSetGroceryAisleOverrides,
  dbInsertGroceryItem,
  dbUpdateGroceryItem,
  dbDeleteGroceryItem,
  dbFinishGroceryShopping,
  dbClearGroceryList,
} from '../db/database';
import { groceryNameKey } from '../utils/groceryParse';
import { DEFAULT_AISLES, OTHER_AISLE } from '../utils/groceryAisles';
import type { GroceryItem } from '../types';

jest.mock('../db/database', () => ({
  dbGetAllGroceryItems: jest.fn().mockReturnValue([]),
  dbGetGroceryAisleOrder: jest.fn().mockReturnValue(null),
  dbSetGroceryAisleOrder: jest.fn(),
  dbGetGroceryAisleOverrides: jest.fn().mockReturnValue({}),
  dbSetGroceryAisleOverrides: jest.fn(),
  dbInsertGroceryItem: jest.fn(),
  dbUpdateGroceryItem: jest.fn(),
  dbDeleteGroceryItem: jest.fn(),
  dbFinishGroceryShopping: jest.fn().mockReturnValue([]),
  dbClearGroceryList: jest.fn().mockReturnValue([]),
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
    inCatalog: true,
    sortOrder: seq,
    favorite: false,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function seed(items: GroceryItem[], aisleOverrides: Record<string, string> = {}) {
  useGroceryStore.setState({
    items,
    aisleOrder: [...DEFAULT_AISLES],
    aisleOverrides,
    cartHoldIds: [],
    initialized: true,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetAllGroceryItems as jest.Mock).mockReturnValue([]);
  (dbGetGroceryAisleOrder as jest.Mock).mockReturnValue(null);
  (dbGetGroceryAisleOverrides as jest.Mock).mockReturnValue({});
  (dbFinishGroceryShopping as jest.Mock).mockReturnValue([]);
  (dbClearGroceryList as jest.Mock).mockReturnValue([]);
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

  // A name typed once is on the list, not in the catalog — see removeFromList.
  it('starts a brand-new name provisional', () => {
    expect(useGroceryStore.getState().addByName('nduja').inCatalog).toBe(false);
  });

  it('leaves a catalog row in the catalog when it comes back on the list', () => {
    seed([makeItem({ name: 'Milk', onList: false, inCatalog: true })]);
    expect(useGroceryStore.getState().addByName('milk').inCatalog).toBe(true);
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

  it('promotes a provisional row that was actually bought', () => {
    const nduja = makeItem({ name: 'nduja', onList: true, checked: true, inCatalog: false });
    seed([nduja]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([nduja.id]);

    useGroceryStore.getState().finishShopping();

    expect(useGroceryStore.getState().items[0].inCatalog).toBe(true);
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

  // The confirm says nothing is deleted, so clearing parks a provisional row
  // rather than forgetting it — and that keeps !onList ⇒ inCatalog true.
  it('parks a provisional row in the catalog rather than deleting it', () => {
    const nduja = makeItem({ name: 'nduja', onList: true, inCatalog: false });
    seed([nduja]);
    (dbClearGroceryList as jest.Mock).mockReturnValue([nduja.id]);

    useGroceryStore.getState().clearList();

    expect(dbDeleteGroceryItem).not.toHaveBeenCalled();
    expect(useGroceryStore.getState().items[0].inCatalog).toBe(true);
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

  it('removeFromList deletes a provisional row instead of parking it', () => {
    // Typed once, never bought, never starred: it only existed as this line of
    // the list, so leaving it behind is what fills the catalog with typos.
    const nduja = makeItem({ name: 'nduja', onList: true, inCatalog: false });
    seed([nduja]);

    useGroceryStore.getState().removeFromList(nduja.id);

    expect(dbDeleteGroceryItem).toHaveBeenCalledWith(nduja.id);
    expect(useGroceryStore.getState().items).toEqual([]);
  });

  it('removeFromList keeps a row that was in the catalog before this trip', () => {
    // The whole point of the distinction: "not this week" must not forget
    // something you buy most weeks.
    const milk = makeItem({ name: 'Milk', onList: true, inCatalog: true, purchaseCount: 9 });
    seed([milk]);

    useGroceryStore.getState().removeFromList(milk.id);

    expect(dbDeleteGroceryItem).not.toHaveBeenCalled();
    expect(useGroceryStore.getState().items[0].purchaseCount).toBe(9);
  });

  it('starring promotes a provisional row, unstarring does not demote it', () => {
    const nduja = makeItem({ name: 'nduja', onList: true, inCatalog: false });
    seed([nduja]);

    useGroceryStore.getState().toggleFavorite(nduja.id);
    expect(useGroceryStore.getState().items[0].inCatalog).toBe(true);

    // A mis-tap on a star must not arm a delete.
    useGroceryStore.getState().toggleFavorite(nduja.id);
    expect(useGroceryStore.getState().items[0].favorite).toBe(false);
    expect(useGroceryStore.getState().items[0].inCatalog).toBe(true);
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

  it('applyDrop writes the new order and any aisle the drop changed', () => {
    const apples = makeItem({ name: 'Apples', aisle: 'Produce', onList: true, sortOrder: 1 });
    const milk = makeItem({ name: 'Milk', aisle: 'Dairy', onList: true, sortOrder: 2 });
    const bread = makeItem({ name: 'Bread', aisle: 'Bakery', onList: true, sortOrder: 3 });
    seed([apples, milk, bread]);

    // Milk dragged up under the Produce header: same slot, new aisle.
    useGroceryStore.getState().applyDrop([
      { id: apples.id, sortOrder: 1, aisle: 'Produce' },
      { id: milk.id, sortOrder: 2, aisle: 'Produce' },
      { id: bread.id, sortOrder: 3, aisle: 'Bakery' },
    ]);

    const items = useGroceryStore.getState().items;
    expect(items.find(i => i.id === milk.id)).toMatchObject({ sortOrder: 2, aisle: 'Produce' });
    // Nothing else moved, so only the row that changed is written.
    expect(dbUpdateGroceryItem).toHaveBeenCalledTimes(1);
    expect((dbUpdateGroceryItem as jest.Mock).mock.calls[0][0].id).toBe(milk.id);
  });

  it('applyDrop takes a new aisle into the walk order and ignores unknown ids', () => {
    const item = makeItem({ name: 'nduja', onList: true, sortOrder: 1 });
    seed([item]);

    useGroceryStore.getState().applyDrop([
      { id: item.id, sortOrder: 1, aisle: 'Butcher' },
      { id: 'gone', sortOrder: 2, aisle: 'Butcher' },
    ]);

    expect(useGroceryStore.getState().items[0].aisle).toBe('Butcher');
    expect(useGroceryStore.getState().aisleOrder).toContain('Butcher');
  });

  it('applyDrop writes nothing when the drop changed nothing', () => {
    const item = makeItem({ name: 'Milk', aisle: 'Dairy', onList: true, sortOrder: 3 });
    seed([item]);

    useGroceryStore.getState().applyDrop([{ id: item.id, sortOrder: 3, aisle: 'Dairy' }]);

    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });

  it('setAisleOrder persists a normalised order', () => {
    useGroceryStore.getState().setAisleOrder(['Frozen', 'Produce']);

    expect(dbSetGroceryAisleOrder).toHaveBeenCalledTimes(1);
    const written = (dbSetGroceryAisleOrder as jest.Mock).mock.calls[0][0] as string[];
    expect(written[0]).toBe('Frozen');
    expect(written[written.length - 1]).toBe(OTHER_AISLE);
  });
});

// ─── remembered aisles ───────────────────────────────────────────────────────

describe('remembered aisles', () => {
  it('setAisle records the filing under the item name', () => {
    const item = makeItem({ name: 'Protein powder' });
    seed([item]);

    useGroceryStore.getState().setAisle(item.id, 'Household');

    expect(dbSetGroceryAisleOverrides).toHaveBeenCalledWith({ 'protein powder': 'Household' });
    expect(useGroceryStore.getState().aisleOverrides).toEqual({ 'protein powder': 'Household' });
  });

  it('a new row is filed where the user last put that name, over the lexicon', () => {
    // The lexicon would say Dairy & Eggs; their shop keeps it somewhere else.
    seed([], { milk: 'Frozen' });

    const item = useGroceryStore.getState().addByName('Milk');

    expect(item.aisle).toBe('Frozen');
  });

  it('survives the provisional row it was made on being deleted', () => {
    // The case the memory exists for: a name typed for the first time is
    // provisional, so taking it off the list deletes the row outright.
    const item = useGroceryStore.getState().addByName('Nduja');
    useGroceryStore.getState().setAisle(item.id, 'Butcher');
    useGroceryStore.getState().removeFromList(item.id);
    expect(useGroceryStore.getState().items).toEqual([]);

    expect(useGroceryStore.getState().addByName('nduja').aisle).toBe('Butcher');
  });

  it('leaves an existing catalog row alone — its own aisle is already the truth', () => {
    const item = makeItem({ name: 'Milk', aisle: 'Dairy & Eggs' });
    seed([item], { milk: 'Frozen' });

    expect(useGroceryStore.getState().addByName('Milk').aisle).toBe('Dairy & Eggs');
  });

  it('applyDrop remembers a row dragged into another aisle', () => {
    const item = makeItem({ name: 'Nduja', aisle: OTHER_AISLE, onList: true, sortOrder: 1 });
    seed([item]);

    useGroceryStore.getState().applyDrop([{ id: item.id, sortOrder: 2, aisle: 'Deli' }]);

    expect(useGroceryStore.getState().aisleOverrides).toEqual({ nduja: 'Deli' });
  });

  it('applyDrop remembers nothing when the drag only reordered within an aisle', () => {
    const item = makeItem({ name: 'Milk', aisle: 'Dairy & Eggs', onList: true, sortOrder: 1 });
    seed([item]);

    useGroceryStore.getState().applyDrop([{ id: item.id, sortOrder: 5, aisle: 'Dairy & Eggs' }]);

    expect(dbSetGroceryAisleOverrides).not.toHaveBeenCalled();
    expect(useGroceryStore.getState().aisleOverrides).toEqual({});
  });

  it('follows a rename, so the filing survives fixing a typo', () => {
    const item = makeItem({ name: 'Protien powder' });
    seed([item], { 'protien powder': 'Household' });

    useGroceryStore.getState().renameItem(item.id, 'Protein powder');

    expect(useGroceryStore.getState().aisleOverrides).toEqual({ 'protein powder': 'Household' });
    expect(dbSetGroceryAisleOverrides).toHaveBeenCalledWith({ 'protein powder': 'Household' });
  });

  it('writes nothing when the filing is the one already remembered', () => {
    const item = makeItem({ name: 'Nduja', aisle: OTHER_AISLE });
    seed([item], { nduja: 'Deli' });

    useGroceryStore.getState().setAisle(item.id, 'Deli');

    expect(dbSetGroceryAisleOverrides).not.toHaveBeenCalled();
  });

  it('initialize loads what was remembered', () => {
    (dbGetGroceryAisleOverrides as jest.Mock).mockReturnValue({ nduja: 'Deli' });

    useGroceryStore.getState().initialize();

    expect(useGroceryStore.getState().rememberedAisleFor('Nduja')).toBe('Deli');
    expect(useGroceryStore.getState().rememberedAisleFor('Milk')).toBeNull();
  });
});
