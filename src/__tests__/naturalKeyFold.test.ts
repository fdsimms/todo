import { foldRows, foldWinner, REFERENCES, SETTING_REFERENCES } from '../utils/naturalKeyFold';

describe('foldRows', () => {
  const phone = {
    id: 'a1', name: 'Milk', name_key: 'milk', aisle: 'Dairy', note: '',
    purchase_count: 5, last_purchased_at: '2026-03-01T00:00:00.000Z', created_at: '2026-01-05T00:00:00.000Z',
    is_staple: 0, price_history: JSON.stringify([{ at: '2026-03-01', priceMinor: 199 }]),
    last_price_minor: 199, last_priced_at: '2026-03-01', last_price_quantity: '1 gal',
    backfill_dismissed_fields: '["brand"]', updated_at: '2026-03-01T00:00:00.000Z',
  };
  const ipad = {
    id: 'b2', name: 'milk', name_key: 'milk', aisle: 'Other', note: 'oat',
    purchase_count: 3, last_purchased_at: '2026-04-01T00:00:00.000Z', created_at: '2026-02-01T00:00:00.000Z',
    is_staple: 1, price_history: JSON.stringify([{ at: '2026-04-01', priceMinor: 249 }]),
    last_price_minor: 249, last_priced_at: '2026-04-01', last_price_quantity: '1 gal',
    backfill_dismissed_fields: '["aisle"]', updated_at: '2026-04-01T00:00:00.000Z',
  };

  it('combines each column by its rule', () => {
    const out = foldRows('grocery_items', phone, ipad);
    expect(out).toMatchObject({
      id: 'a1',
      name: 'Milk',                 // survivor's plain value
      aisle: 'Dairy',
      note: 'oat',                  // blank on the survivor, filled
      purchase_count: 5,            // the larger, not the sum
      last_purchased_at: '2026-04-01T00:00:00.000Z',
      created_at: '2026-01-05T00:00:00.000Z',
      is_staple: 1,
      last_price_minor: 249,        // the price block from the later side
      last_priced_at: '2026-04-01',
    });
    expect(JSON.parse(String(out.price_history)).map((o: { priceMinor: number }) => o.priceMinor)).toEqual([249, 199]);
    expect(JSON.parse(String(out.backfill_dismissed_fields))).toEqual(['brand', 'aisle']);
    expect(out).not.toHaveProperty('updated_at');
  });

  // The property the whole design rests on: two devices folding the same pair,
  // or a merged row meeting its loser again, must not count anything twice.
  it('is idempotent: folding the loser in again changes nothing', () => {
    const once = foldRows('grocery_items', phone, ipad);
    const twice = foldRows('grocery_items', once, ipad);
    expect(twice).toEqual(once);
  });

  it('takes a recipe\'s cook-time total with the count it is over', () => {
    const out = foldRows(
      'recipes',
      { id: 'a', cook_time_count: 2, total_cook_minutes: 60, cook_count: 2 },
      { id: 'b', cook_time_count: 5, total_cook_minutes: 200, cook_count: 6 },
    );
    expect(out).toMatchObject({ cook_time_count: 5, total_cook_minutes: 200, cook_count: 6 });
  });

  it('keeps a list entry unchecked unless both copies were checked', () => {
    expect(foldRows('grocery_list_items', { checked: 1 }, { checked: 0 }).checked).toBe(0);
    expect(foldRows('grocery_list_items', { checked: 1 }, { checked: 1 }).checked).toBe(1);
  });
});

describe('foldWinner', () => {
  it('picks the same id whichever side asks', () => {
    expect(foldWinner('a1', 'b2')).toBe('a1');
    expect(foldWinner('b2', 'a1')).toBe('a1');
  });
});

describe('REFERENCES', () => {
  const ref = (table: string, column: string) =>
    REFERENCES.find(r => r.table === table && r.column === column && r.target === 'grocery_items')!;

  it('moves a plain id and leaves other rows alone', () => {
    expect(ref('food_logs', 'item_id').rewrite({ id: 'f', item_id: 'b2' }, 'b2', 'a1')).toEqual({ id: 'f', item_id: 'a1' });
    expect(ref('food_logs', 'item_id').rewrite({ id: 'f', item_id: 'c3' }, 'b2', 'a1')).toBeNull();
  });

  it('only moves a generated task\'s source for the kinds whose source is an item', () => {
    const r = ref('tasks', 'generated_source_id');
    expect(r.rewrite({ generated_kind: 'groceryUseUp', generated_source_id: 'b2' }, 'b2', 'a1')?.generated_source_id).toBe('a1');
    expect(r.rewrite({ generated_kind: 'birthday', generated_source_id: 'b2' }, 'b2', 'a1')).toBeNull();
  });

  it('moves an id inside a link without touching a longer id that starts the same', () => {
    const r = ref('tasks', 'link_url');
    expect(r.rewrite({ link_url: 'dundundun://kitchen?item=grocery-b2' }, 'b2', 'a1')?.link_url)
      .toBe('dundundun://kitchen?item=grocery-a1');
    expect(r.rewrite({ link_url: 'dundundun://kitchen?item=grocery-b22' }, 'b2', 'a1')).toBeNull();
  });

  it('moves an id inside a JSON list', () => {
    const r = ref('saved_meals', 'items');
    const out = r.rewrite({ items: JSON.stringify([{ itemId: 'b2', label: 'milk' }, { itemId: 'x' }]) }, 'b2', 'a1');
    expect(JSON.parse(String(out?.items))).toEqual([{ itemId: 'a1', label: 'milk' }, { itemId: 'x' }]);
  });
});

describe('SETTING_REFERENCES', () => {
  it('moves the trip\'s store and a collapsed recipe group', () => {
    const trip = SETTING_REFERENCES.find(s => s.key === 'grocery_trip_shop_id')!;
    expect(trip.rewrite('s2', 's2', 's1')).toBe('s1');
    expect(trip.rewrite('s9', 's2', 's1')).toBeNull();
    const collapsed = SETTING_REFERENCES.find(s => s.key === 'collapsedGroceryGroups')!;
    expect(JSON.parse(collapsed.rewrite('["recipe:r2","aisle:Dairy"]', 'r2', 'r1')!)).toEqual(['recipe:r1', 'aisle:Dairy']);
  });
});
