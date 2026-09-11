import { creditedKeys, foodLogRecency, rankByRecency } from '../utils/foodLogRecents';
import type { FoodLogEntry } from '../types';

let seq = 0;
function entry(overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
  seq += 1;
  return {
    id: `e-${seq}`,
    dayKey: '2026-04-02',
    atISO: `2026-04-02T0${seq % 10}:00:00.000Z`,
    slot: 'breakfast',
    label: 'Milk',
    recipeId: null,
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    quantity: '1 cup',
    grams: 244,
    nutrition: {
      basis: 'perServing',
      servingGrams: 244,
      servingText: '1 cup',
      amounts: { calorieKcal: 149 },
      portions: [],
      source: 'fdc',
      sourceId: null,
      recordedAt: '2026-04-02T00:00:00.000Z',
    },
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: '2026-04-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('creditedKeys', () => {
  it('credits the box and the item it belongs to, not just the box', () => {
    // Both are offered on the picker's list, so floating the specific pot while
    // leaving the generic food far down is the same complaint one level in.
    expect(creditedKeys({ itemId: 'milk', productId: 'horizon', recipeId: null }))
      .toEqual(['p:horizon', 'i:milk']);
  });

  it('credits nothing for a food logged against no row at all', () => {
    // An estimate, or a database result nobody filed. There is no row for it to
    // be, so there is nothing to promote.
    expect(creditedKeys({ itemId: null, productId: null, recipeId: null })).toEqual([]);
  });
});

describe('foodLogRecency', () => {
  it('counts each row and keeps the latest instant', () => {
    const recency = foodLogRecency([
      entry({ itemId: 'milk', atISO: '2026-04-01T08:00:00.000Z' }),
      entry({ itemId: 'milk', atISO: '2026-04-03T08:00:00.000Z' }),
      entry({ itemId: 'milk', atISO: '2026-04-02T08:00:00.000Z' }),
    ]);
    expect(recency.get('i:milk')).toEqual({ count: 3, lastAtISO: '2026-04-03T08:00:00.000Z' });
  });

  it('counts one row under two labels once, which is the whole reason it keys on ids', () => {
    // A food found in a database and filed onto the Milk row logs under its own
    // description one week and under "Milk" the next. Two labels, one row.
    const recency = foodLogRecency([
      entry({ itemId: 'milk', label: 'Milk' }),
      entry({ itemId: 'milk', label: 'Milk, whole, 3.25% milkfat' }),
    ]);
    expect(recency.get('i:milk')?.count).toBe(2);
  });
});

describe('rankByRecency', () => {
  const candidates = [
    { key: 'i:a' }, { key: 'i:b' }, { key: 'i:c' }, { key: 'i:d' },
  ];

  it('puts what has been eaten in front, most-eaten first', () => {
    const recency = foodLogRecency([
      entry({ itemId: 'd' }),
      entry({ itemId: 'b' }),
      entry({ itemId: 'b' }),
    ]);
    expect(rankByRecency(candidates, recency).map(c => c.key))
      .toEqual(['i:b', 'i:d', 'i:a', 'i:c']);
  });

  it('breaks a tie on count with whichever was eaten most recently', () => {
    const recency = foodLogRecency([
      entry({ itemId: 'a', atISO: '2026-04-01T08:00:00.000Z' }),
      entry({ itemId: 'c', atISO: '2026-04-05T08:00:00.000Z' }),
    ]);
    expect(rankByRecency(candidates, recency).map(c => c.key).slice(0, 2))
      .toEqual(['i:c', 'i:a']);
  });

  it('leaves the order of everything unlogged exactly as it arrived', () => {
    // It promotes rather than sorts: a list that re-sorts wholesale is one you
    // cannot learn, which is why the long tail is not touched.
    const recency = foodLogRecency([entry({ itemId: 'c' })]);
    expect(rankByRecency(candidates, recency).map(c => c.key))
      .toEqual(['i:c', 'i:a', 'i:b', 'i:d']);
  });

  it('changes nothing when nothing has been logged', () => {
    expect(rankByRecency(candidates, foodLogRecency([])).map(c => c.key))
      .toEqual(['i:a', 'i:b', 'i:c', 'i:d']);
  });
});
