import { nameHintFor } from '../utils/catalogNameHint';
import { newItemRow } from '../utils/groceryAdd';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem, ItemProduct } from '../types';

const item = (name: string, over: Partial<GroceryItem> = {}): GroceryItem => ({
  ...newItemRow({
    name,
    nameKey: groceryNameKey(name),
    aisle: 'Pantry',
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    onList: false,
  }),
  ...over,
});

const product = (itemId: string, brand: string | null): ItemProduct =>
  ({ id: `${itemId}-${brand}`, itemId, brand, variant: null, productKey: `${brand}|` }) as ItemProduct;

describe('nameHintFor', () => {
  it('says nothing about a name that already finds a row', () => {
    const items = [item('ginger powder', { otherNames: ['ground ginger'] }), item('onions')];
    expect(nameHintFor('ground ginger', items, [])).toBeNull();
    expect(nameHintFor('Ginger Powder', items, [])).toBeNull();
    expect(nameHintFor('onion', items, [])).toBeNull();
  });

  it('flags a brand the catalog already keeps, and offers the name without it', () => {
    const chips = item('protein chips');
    const hint = nameHintFor('Quest protein chips', [chips], [product(chips.id, 'Quest')]);
    expect(hint).toEqual({ kind: 'brand', brand: 'Quest', generic: 'protein chips' });
  });

  it('offers no generic when the whole name is the brand', () => {
    const chips = item('protein chips');
    expect(nameHintFor('Quest', [chips], [product(chips.id, 'Quest')])).toEqual({ kind: 'brand', brand: 'Quest', generic: null });
  });

  it('finds a multi-word brand inside the name', () => {
    const sausage = item('vegan sausages');
    const hint = nameHintFor('Beyond Meat brats', [sausage], [product(sausage.id, 'Beyond Meat')]);
    expect(hint).toEqual({ kind: 'brand', brand: 'Beyond Meat', generic: 'brats' });
  });

  it('flags a new name that is an existing row in other words', () => {
    const items = [item('ginger powder'), item('vegetable broth')];
    expect(nameHintFor('ground ginger', items, [])).toEqual({ kind: 'same_thing', item: { id: items[0].id, name: 'ginger powder' } });
    expect(nameHintFor('vegetable stock', items, [])?.kind).toBe('same_thing');
  });

  it('says nothing about an unrelated name or an empty one', () => {
    expect(nameHintFor('rutabaga', [item('salt')], [])).toBeNull();
    expect(nameHintFor('   ', [item('salt')], [])).toBeNull();
    expect(nameHintFor('???', [item('salt')], [])).toBeNull();
  });

  it('does not match a brand on part of a word', () => {
    const bar = item('protein bar');
    expect(nameHintFor('bearings', [bar], [product(bar.id, 'Bear')])).toBeNull();
  });
});
