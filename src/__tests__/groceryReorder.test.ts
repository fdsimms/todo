import {
  resolveGroceryDrop,
  groceryDragRange,
  placeNewGroceryItems,
  type GroceryDropRow,
  type KeyedGroceryDropRow,
} from '../utils/groceryReorder';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem } from '../types';

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
    onList: true,
    checked: false,
    sortOrder: seq,
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
    pantryReviewedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    varietyOfKey: null, nutrition: null, backfillDismissedFields: [],
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  };
}

const aisle = (name: string): GroceryDropRow => ({ type: 'aisle', aisle: name });
const row = (item: GroceryItem): GroceryDropRow => ({ type: 'item', item });
const cart: GroceryDropRow = { type: 'cartHeader' };
const notHere: GroceryDropRow = { type: 'unavailableHeader' };

// ─── resolveGroceryDrop ──────────────────────────────────────────────────────

describe('resolveGroceryDrop', () => {
  it('hands each aisle its own slots back in the new order', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 5 });
    const eggs = makeItem('Eggs', { aisle: 'Dairy', sortOrder: 6 });
    const apples = makeItem('Apples', { aisle: 'Produce', sortOrder: 1 });

    // Eggs dragged above milk.
    const placements = resolveGroceryDrop([
      aisle('Dairy'), row(eggs), row(milk),
      aisle('Produce'), row(apples),
    ]);

    expect(placements).toEqual([
      { id: eggs.id, sortOrder: 5, aisle: 'Dairy' },
      { id: milk.id, sortOrder: 6, aisle: 'Dairy' },
      { id: apples.id, sortOrder: 1, aisle: 'Produce' },
    ]);
  });

  // The rows handed in are only what's on screen. Renumbering them 1..n moved
  // the cart rows and collapsed aisles that weren't there.
  it('keeps a row in the cart where it was among the rows around it', () => {
    const apples = makeItem('Apples', { aisle: 'Produce', sortOrder: 1 });
    // Ticked, so below the cart header and not in the rows handed in.
    const bananas = makeItem('Bananas', { aisle: 'Produce', sortOrder: 11, checked: true });
    const carrots = makeItem('Carrots', { aisle: 'Produce', sortOrder: 12 });
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 20 });
    const eggs = makeItem('Eggs', { aisle: 'Dairy', sortOrder: 21 });

    const placements = resolveGroceryDrop([
      aisle('Produce'), row(apples), row(carrots),
      aisle('Dairy'), row(eggs), row(milk),
      cart, row(bananas),
    ]);

    const order = (id: string) => placements.find(p => p.id === id)?.sortOrder ?? bananas.sortOrder;
    expect(placements.find(p => p.id === bananas.id)).toBeUndefined();
    // Apples and carrots didn't move, so bananas is still between them.
    expect(order(apples.id)).toBeLessThan(order(bananas.id));
    expect(order(bananas.id)).toBeLessThan(order(carrots.id));
    expect(order(eggs.id)).toBeLessThan(order(milk.id));
  });

  it('keeps a hidden row in the same aisle where it was when the others are reordered', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 5 });
    const eggs = makeItem('Eggs', { aisle: 'Dairy', sortOrder: 6 });
    // In the cart, after both.
    const cheese = makeItem('Cheese', { aisle: 'Dairy', sortOrder: 7, checked: true });

    const placements = resolveGroceryDrop([aisle('Dairy'), row(eggs), row(milk), cart, row(cheese)]);

    const order = (id: string) => placements.find(p => p.id === id)?.sortOrder ?? cheese.sortOrder;
    expect(order(eggs.id)).toBeLessThan(order(milk.id));
    expect(order(milk.id)).toBeLessThan(order(cheese.id));
  });

  it('forces tied slots apart so a drag among them has something to write', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 3 });
    const eggs = makeItem('Eggs', { aisle: 'Dairy', sortOrder: 3 });

    const placements = resolveGroceryDrop([aisle('Dairy'), row(eggs), row(milk)]);

    expect(placements).toEqual([
      { id: eggs.id, sortOrder: 3, aisle: 'Dairy' },
      { id: milk.id, sortOrder: 4, aisle: 'Dairy' },
    ]);
  });

  it('gives an item the aisle of the nearest header above it', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 4 });
    // Dropped under Produce — the drag is the whole of how an aisle changes.
    const placements = resolveGroceryDrop([
      aisle('Dairy'),
      aisle('Produce'), row(milk),
    ]);
    expect(placements).toEqual([{ id: milk.id, sortOrder: 4, aisle: 'Produce' }]);
  });

  it('brings a row that changed aisle into the new aisle with its own slot in the pool', () => {
    const apples = makeItem('Apples', { aisle: 'Produce', sortOrder: 1 });
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 5 });
    const eggs = makeItem('Eggs', { aisle: 'Dairy', sortOrder: 6 });

    // Apples dragged down between milk and eggs.
    const placements = resolveGroceryDrop([
      aisle('Produce'),
      aisle('Dairy'), row(milk), row(apples), row(eggs),
    ]);

    expect(placements).toEqual([
      { id: milk.id, sortOrder: 1, aisle: 'Dairy' },
      { id: apples.id, sortOrder: 5, aisle: 'Dairy' },
      { id: eggs.id, sortOrder: 6, aisle: 'Dairy' },
    ]);
  });

  it('keeps an item that somehow sits above every header in its own aisle', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 2 });
    const placements = resolveGroceryDrop([row(milk), aisle('Produce')]);
    expect(placements).toEqual([{ id: milk.id, sortOrder: 2, aisle: 'Dairy' }]);
  });

  it('leaves everything from the cart header down alone', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 1 });
    const bought = makeItem('Bread', { aisle: 'Bakery', checked: true });

    const placements = resolveGroceryDrop([
      aisle('Dairy'), row(milk),
      cart, row(bought),
    ]);

    expect(placements).toEqual([{ id: milk.id, sortOrder: 1, aisle: 'Dairy' }]);
  });

  it('resolves the same whether the cart section is expanded or collapsed', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy' });
    const bought = makeItem('Bread', { aisle: 'Bakery', checked: true });
    const open = resolveGroceryDrop([aisle('Dairy'), row(milk), cart, row(bought)]);
    const collapsed = resolveGroceryDrop([aisle('Dairy'), row(milk), cart]);
    expect(open).toEqual(collapsed);
  });

  it('returns nothing for a list with no items', () => {
    expect(resolveGroceryDrop([aisle('Dairy'), aisle('Produce')])).toEqual([]);
    expect(resolveGroceryDrop([])).toEqual([]);
  });

  // A "Not here" header is a label inside an aisle, not a new one — only an
  // actual aisle row is allowed to change currentAisle.
  it('keeps items after an unavailableHeader in the same aisle, ranked in place', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 1 });
    const cream = makeItem('Cream', { aisle: 'Dairy', sortOrder: 2 });
    const apples = makeItem('Apples', { aisle: 'Produce', sortOrder: 3 });

    const placements = resolveGroceryDrop([
      aisle('Dairy'), row(milk),
      notHere, row(cream),
      aisle('Produce'), row(apples),
    ]);

    expect(placements).toEqual([
      { id: milk.id, sortOrder: 1, aisle: 'Dairy' },
      { id: cream.id, sortOrder: 2, aisle: 'Dairy' },
      { id: apples.id, sortOrder: 3, aisle: 'Produce' },
    ]);
  });

  // Drag is off in the store lens, so this is the type being honest rather
  // than a real path: a store header never files a row into an aisle, and a
  // row under one keeps the aisle it already had.
  it('never reads a store header as an aisle', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 1 });
    const placements = resolveGroceryDrop([{ type: 'storeHeader' }, row(milk)]);
    expect(placements).toEqual([{ id: milk.id, sortOrder: 1, aisle: 'Dairy' }]);
  });
});

// ─── groceryDragRange ────────────────────────────────────────────────────────

describe('groceryDragRange', () => {
  const rows: GroceryDropRow[] = [
    aisle('Dairy'), row(makeItem('Milk')), row(makeItem('Eggs')),
    aisle('Produce'), row(makeItem('Apples')),
  ];

  it('stops an item from landing above the first aisle header', () => {
    expect(groceryDragRange(rows, 1)).toEqual([1, 4]);
  });

  it('stops an item from landing in the cart section', () => {
    const withCart: GroceryDropRow[] = [...rows, cart, row(makeItem('Bread', { checked: true }))];
    expect(groceryDragRange(withCart, 1)).toEqual([1, 4]);
  });

  it('pins a row in place when there is nowhere legal to drop it', () => {
    // Cart header first, so there is no aisle row to move among.
    expect(groceryDragRange([cart, row(makeItem('Bread'))], 1)).toEqual([1, 1]);
    expect(groceryDragRange([aisle('Dairy'), cart], 0)).toEqual([0, 0]);
  });
});

// ─── placeNewGroceryItems ────────────────────────────────────────────────────

describe('placeNewGroceryItems', () => {
  const kAisle = (name: string): KeyedGroceryDropRow => ({
    type: 'aisle', key: `aisle:${name}`, aisle: name,
  });
  const kRow = (item: GroceryItem): KeyedGroceryDropRow => ({
    type: 'item', key: item.id, item,
  });
  const kCart: KeyedGroceryDropRow = { type: 'cartHeader', key: 'cartHeader' };

  // A created row's sortOrder is its entry's slot on the active list; the
  // caller projects it (see placeNewGroceryItems). A fresh add is appended, so
  // its slot is above everything already on the list.
  it('lands a new item on the seam below the row it was dropped on', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 1 });
    const eggs = makeItem('Eggs', { aisle: 'Dairy', sortOrder: 2 });
    const butter = makeItem('Butter', { aisle: 'Other', sortOrder: 3 });

    const placements = placeNewGroceryItems(
      [kAisle('Dairy'), kRow(milk), kRow(eggs)],
      milk.id,
      false,
      [butter],
    );

    expect(placements).toEqual([
      { id: milk.id, sortOrder: 1, aisle: 'Dairy' },
      { id: butter.id, sortOrder: 2, aisle: 'Dairy' },
      { id: eggs.id, sortOrder: 3, aisle: 'Dairy' },
    ]);
  });

  it('lands it above the row when the drop was on that row’s top half', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 1 });
    const butter = makeItem('Butter', { aisle: 'Other', sortOrder: 2 });

    const placements = placeNewGroceryItems([kAisle('Dairy'), kRow(milk)], milk.id, true, [butter]);

    expect(placements).toEqual([
      { id: butter.id, sortOrder: 1, aisle: 'Dairy' },
      { id: milk.id, sortOrder: 2, aisle: 'Dairy' },
    ]);
  });

  it('takes the aisle of the header it was dropped on', () => {
    const apples = makeItem('Apples', { aisle: 'Produce', sortOrder: 1 });
    // The lexicon filed it under Other; dropping on Produce overrides that,
    // exactly as dragging the row there would.
    const crisps = makeItem('Crisps', { aisle: 'Other', sortOrder: 2 });

    const placements = placeNewGroceryItems(
      [kAisle('Produce'), kRow(apples)],
      'aisle:Produce',
      false,
      [crisps],
    );

    expect(placements).toEqual([
      { id: crisps.id, sortOrder: 1, aisle: 'Produce' },
      { id: apples.id, sortOrder: 2, aisle: 'Produce' },
    ]);
  });

  it('keeps a pasted block in the order it was typed', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 1 });
    const a = makeItem('Cheese', { aisle: 'Other', sortOrder: 2 });
    const b = makeItem('Yoghurt', { aisle: 'Other', sortOrder: 3 });

    const placements = placeNewGroceryItems([kAisle('Dairy'), kRow(milk)], milk.id, false, [a, b]);

    expect(placements).toEqual([
      { id: milk.id, sortOrder: 1, aisle: 'Dairy' },
      { id: a.id, sortOrder: 2, aisle: 'Dairy' },
      { id: b.id, sortOrder: 3, aisle: 'Dairy' },
    ]);
  });

  it('moves a name that was already on the list rather than doubling it', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 1 });
    const apples = makeItem('Apples', { aisle: 'Produce', sortOrder: 2 });

    // "Apples" typed into a sheet opened by dropping in Dairy: addByName hands
    // back the row that already exists, so it has to leave Produce.
    const placements = placeNewGroceryItems(
      [kAisle('Dairy'), kRow(milk), kAisle('Produce'), kRow(apples)],
      milk.id,
      false,
      [apples],
    );

    expect(placements).toEqual([
      { id: milk.id, sortOrder: 1, aisle: 'Dairy' },
      { id: apples.id, sortOrder: 2, aisle: 'Dairy' },
    ]);
  });

  it('leaves the cart section alone', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy', sortOrder: 1 });
    const bought = makeItem('Bread', { aisle: 'Bakery', checked: true, sortOrder: 2 });
    const butter = makeItem('Butter', { aisle: 'Other', sortOrder: 3 });

    const placements = placeNewGroceryItems(
      [kAisle('Dairy'), kRow(milk), kCart, kRow(bought)],
      milk.id,
      false,
      [butter],
    );

    expect(placements).toEqual([
      { id: milk.id, sortOrder: 1, aisle: 'Dairy' },
      { id: butter.id, sortOrder: 3, aisle: 'Dairy' },
    ]);
  });

  it('gives up when the anchor row is gone, rather than guessing a spot', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy' });
    const butter = makeItem('Butter', { aisle: 'Other' });
    expect(placeNewGroceryItems([kAisle('Dairy'), kRow(milk)], 'gone', false, [butter])).toBeNull();
  });

  it('has nothing to place when nothing was added', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy' });
    expect(placeNewGroceryItems([kAisle('Dairy'), kRow(milk)], milk.id, false, [])).toBeNull();
  });
});
