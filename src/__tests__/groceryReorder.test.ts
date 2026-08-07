import { resolveGroceryDrop, groceryDragRange, type GroceryDropRow } from '../utils/groceryReorder';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem } from '../types';

let seq = 0;
function makeItem(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: `id-${++seq}`,
    name,
    nameKey: groceryNameKey(name),
    aisle: 'Other',
    quantity: null,
    note: '',
    onList: true,
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

const aisle = (name: string): GroceryDropRow => ({ type: 'aisle', aisle: name });
const row = (item: GroceryItem): GroceryDropRow => ({ type: 'item', item });
const cart: GroceryDropRow = { type: 'cartHeader' };

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
