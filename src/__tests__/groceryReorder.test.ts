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
    inCatalog: true,
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
    shelfLifeDays: null,
    useUpTask: null,
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
  it('ranks every item in list order across all aisles', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy' });
    const eggs = makeItem('Eggs', { aisle: 'Dairy' });
    const apples = makeItem('Apples', { aisle: 'Produce' });

    const placements = resolveGroceryDrop([
      aisle('Dairy'), row(milk), row(eggs),
      aisle('Produce'), row(apples),
    ]);

    expect(placements).toEqual([
      { id: milk.id, sortOrder: 1, aisle: 'Dairy' },
      { id: eggs.id, sortOrder: 2, aisle: 'Dairy' },
      { id: apples.id, sortOrder: 3, aisle: 'Produce' },
    ]);
  });

  it('gives an item the aisle of the nearest header above it', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy' });
    // Dropped under Produce — the drag is the whole of how an aisle changes.
    const placements = resolveGroceryDrop([
      aisle('Dairy'),
      aisle('Produce'), row(milk),
    ]);
    expect(placements).toEqual([{ id: milk.id, sortOrder: 1, aisle: 'Produce' }]);
  });

  it('keeps an item that somehow sits above every header in its own aisle', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy' });
    const placements = resolveGroceryDrop([row(milk), aisle('Produce')]);
    expect(placements).toEqual([{ id: milk.id, sortOrder: 1, aisle: 'Dairy' }]);
  });

  it('leaves everything from the cart header down alone', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy' });
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
    const milk = makeItem('Milk', { aisle: 'Dairy' });
    const cream = makeItem('Cream', { aisle: 'Dairy' });
    const apples = makeItem('Apples', { aisle: 'Produce' });

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

  it('lands a new item on the seam below the row it was dropped on', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy' });
    const eggs = makeItem('Eggs', { aisle: 'Dairy' });
    const butter = makeItem('Butter', { aisle: 'Other' });

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
    const milk = makeItem('Milk', { aisle: 'Dairy' });
    const butter = makeItem('Butter', { aisle: 'Other' });

    const placements = placeNewGroceryItems([kAisle('Dairy'), kRow(milk)], milk.id, true, [butter]);

    expect(placements).toEqual([
      { id: butter.id, sortOrder: 1, aisle: 'Dairy' },
      { id: milk.id, sortOrder: 2, aisle: 'Dairy' },
    ]);
  });

  it('takes the aisle of the header it was dropped on', () => {
    const apples = makeItem('Apples', { aisle: 'Produce' });
    // The lexicon filed it under Other; dropping on Produce overrides that,
    // exactly as dragging the row there would.
    const crisps = makeItem('Crisps', { aisle: 'Other' });

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
    const milk = makeItem('Milk', { aisle: 'Dairy' });
    const a = makeItem('Cheese', { aisle: 'Other' });
    const b = makeItem('Yoghurt', { aisle: 'Other' });

    const placements = placeNewGroceryItems([kAisle('Dairy'), kRow(milk)], milk.id, false, [a, b]);

    expect(placements).toEqual([
      { id: milk.id, sortOrder: 1, aisle: 'Dairy' },
      { id: a.id, sortOrder: 2, aisle: 'Dairy' },
      { id: b.id, sortOrder: 3, aisle: 'Dairy' },
    ]);
  });

  it('moves a name that was already on the list rather than doubling it', () => {
    const milk = makeItem('Milk', { aisle: 'Dairy' });
    const apples = makeItem('Apples', { aisle: 'Produce' });

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
    const milk = makeItem('Milk', { aisle: 'Dairy' });
    const bought = makeItem('Bread', { aisle: 'Bakery', checked: true });
    const butter = makeItem('Butter', { aisle: 'Other' });

    const placements = placeNewGroceryItems(
      [kAisle('Dairy'), kRow(milk), kCart, kRow(bought)],
      milk.id,
      false,
      [butter],
    );

    expect(placements).toEqual([
      { id: milk.id, sortOrder: 1, aisle: 'Dairy' },
      { id: butter.id, sortOrder: 2, aisle: 'Dairy' },
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
