import {
  RECENT_HELPING_LIMIT,
  creditedKeys,
  foodLastAmounts,
  foodLogRecency,
  helpingAgain,
  rankByRecency,
  recentUnlinkedHelpings,
  usualForSlot,
} from '../utils/foodLogRecents';
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

describe('foodLastAmounts', () => {
  function logged(amount: string, overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
    const base = entry(overrides);
    return { ...base, quantity: amount, nutrition: { ...base.nutrition, servingText: amount } };
  }

  it('keeps the most recent amount each row was logged in', () => {
    // Marcus has 250 g of Greek yogurt every morning. The yogurt already
    // floats to the top; this is what saves him typing 250 again.
    const amounts = foodLastAmounts([
      logged('200g', { itemId: 'yogurt', atISO: '2026-04-01T08:00:00.000Z' }),
      logged('250g', { itemId: 'yogurt', atISO: '2026-04-03T08:00:00.000Z' }),
      logged('150g', { itemId: 'yogurt', atISO: '2026-04-02T08:00:00.000Z' }),
    ]);
    expect(amounts.get('i:yogurt')).toEqual({ amount: '250g', dishMeasure: null });
  });

  it('credits a box its own amount and leaves the item behind it alone', () => {
    // "1 container" is a portion of the pot's panel and may mean nothing to
    // the generic row's, unlike the ranking, which credits both.
    const amounts = foodLastAmounts([
      logged('1 container', { itemId: 'yogurt', productId: 'fage', atISO: '2026-04-03T08:00:00.000Z' }),
      logged('250g', { itemId: 'yogurt', atISO: '2026-04-01T08:00:00.000Z' }),
    ]);
    expect(amounts.get('p:fage')).toEqual({ amount: '1 container', dishMeasure: null });
    expect(amounts.get('i:yogurt')).toEqual({ amount: '250g', dishMeasure: null });
  });

  it('reads a dish back as a number and the measure it was asked in', () => {
    const amounts = foodLastAmounts([logged('320 g', { recipeId: 'lasagne' })]);
    expect(amounts.get('r:lasagne')).toEqual({ amount: '320', dishMeasure: 'weight' });
  });

  it('recalls nothing when the latest entry cannot be read back, rather than reaching past it', () => {
    // Reaching back to an older entry would offer an amount that is not the
    // last one this dish was logged in.
    const amounts = foodLastAmounts([
      logged('2 servings', { recipeId: 'soup', atISO: '2026-04-01T08:00:00.000Z' }),
      logged('1 serving, plus baguette', { recipeId: 'soup', atISO: '2026-04-02T08:00:00.000Z' }),
    ]);
    expect(amounts.has('r:soup')).toBe(true);
    expect(amounts.get('r:soup')).toBeNull();
  });

  it('remembers nothing for a food logged against no row', () => {
    expect(foodLastAmounts([logged('a bowl of ramen')]).size).toBe(0);
  });
});

describe('recentUnlinkedHelpings (#2914)', () => {
  const at = (day: number) => `2026-04-${String(day).padStart(2, '0')}T12:00:00.000Z`;
  const estimated = (label: string, day: number, calorieKcal = 900) => entry({
    label,
    atISO: at(day),
    quantity: '1 plate',
    grams: null,
    nutrition: {
      basis: 'perServing', servingGrams: null, servingText: '1 plate', amounts: { calorieKcal },
      portions: [], source: 'estimated', sourceId: null, recordedAt: at(day),
    },
  });

  it('offers foods logged under no row, most recent first', () => {
    const helpings = recentUnlinkedHelpings([
      estimated('Pad thai', 1),
      entry({ label: 'Chicken breast', atISO: at(3) }),
      estimated('Burrito bowl', 2),
    ]);
    expect(helpings.map(e => e.label)).toEqual(['Chicken breast', 'Burrito bowl', 'Pad thai']);
  });

  it('leaves out anything with a row, which the list already offers', () => {
    const helpings = recentUnlinkedHelpings([
      entry({ label: 'Milk', itemId: 'milk', atISO: at(3) }),
      entry({ label: 'Yogurt', productId: 'fage', itemId: 'yogurt', atISO: at(3) }),
      entry({ label: 'Lasagne', recipeId: 'r1', atISO: at(3) }),
      estimated('Pad thai', 1),
    ]);
    expect(helpings.map(e => e.label)).toEqual(['Pad thai']);
  });

  it('leaves out the day\'s water, which the water card steps rather than logs again', () => {
    const water = entry({
      label: 'Water',
      atISO: at(3),
      nutrition: {
        basis: 'perServing', servingGrams: null, servingText: '500 ml', amounts: { waterMl: 500 },
        portions: [], source: 'manual', sourceId: null, recordedAt: at(3),
      },
    });
    expect(recentUnlinkedHelpings([water, estimated('Pad thai', 1)]).map(e => e.label)).toEqual(['Pad thai']);
  });

  it('keeps one per description and source, the most recent', () => {
    const helpings = recentUnlinkedHelpings([
      estimated('Pad thai', 1, 800),
      estimated('pad Thai', 4, 950),
      estimated('Pad thai', 2, 700),
    ]);
    expect(helpings).toHaveLength(1);
    expect(helpings[0].nutrition.amounts.calorieKcal).toBe(950);
  });

  it('keeps an estimate and a database answer for one food apart, since they are two claims', () => {
    const helpings = recentUnlinkedHelpings([
      estimated('Chicken breast', 1),
      entry({ label: 'Chicken breast', atISO: at(2) }),
    ]);
    expect(helpings.map(e => e.nutrition.source)).toEqual(['fdc', 'estimated']);
  });

  it('caps the offer, and narrows by the search before capping', () => {
    const many = Array.from({ length: 8 }, (_, i) => estimated(`Takeout ${i + 1}`, i + 2));
    many.push(estimated('Pho', 1));
    expect(recentUnlinkedHelpings(many)).toHaveLength(RECENT_HELPING_LIMIT);
    // The oldest of all, still found when it is what was typed.
    expect(recentUnlinkedHelpings(many, 'pho').map(e => e.label)).toEqual(['Pho']);
    expect(recentUnlinkedHelpings(many, 'sushi')).toEqual([]);
  });
});

describe('helpingAgain', () => {
  it('copies the helping verbatim, and the panel it kept', () => {
    const kept = {
      basis: 'per100g' as const, servingGrams: null, servingText: null, amounts: { calorieKcal: 165 },
      portions: [], source: 'fdc' as const, sourceId: '171477', recordedAt: '2026-04-01T00:00:00.000Z',
    };
    const earlier = entry({
      label: 'Chicken breast', quantity: '150 g', grams: 150, sourcePanel: kept, slot: 'lunch', mealPlanEntryId: 'plan-1',
    });
    const again = helpingAgain(earlier);
    expect(again).toEqual({
      label: 'Chicken breast',
      quantity: '150 g',
      grams: 150,
      nutrition: earlier.nutrition,
      sourcePanel: kept,
    });
    // Where it landed and the planned meal it answered are the caller's to decide.
    expect(again).not.toHaveProperty('slot');
    expect(again).not.toHaveProperty('mealPlanEntryId');
  });

  it('keeps none when the earlier entry kept none', () => {
    expect(helpingAgain(entry({ label: 'Pad thai' })).sourcePanel).toBeNull();
  });
});

describe('usualForSlot', () => {
  const rows = [{ key: 'i:bread' }, { key: 'i:yogurt' }, { key: 'i:soup' }, { key: 'r:sandwich' }];

  it('offers what was eaten at this meal at least twice, most often first', () => {
    const log = [
      entry({ slot: 'breakfast', itemId: 'yogurt' }),
      entry({ slot: 'breakfast', itemId: 'yogurt' }),
      entry({ slot: 'breakfast', itemId: 'yogurt' }),
      entry({ slot: 'breakfast', itemId: 'bread' }),
      entry({ slot: 'breakfast', itemId: 'bread' }),
    ];
    expect(usualForSlot(rows, log, 'breakfast').map(r => r.key)).toEqual(['i:yogurt', 'i:bread']);
  });

  it('leaves out a row eaten only once at this meal', () => {
    const log = [entry({ slot: 'lunch', itemId: 'soup' })];
    expect(usualForSlot(rows, log, 'lunch')).toEqual([]);
  });

  it('counts only entries filed under this meal', () => {
    const log = [
      entry({ slot: 'dinner', recipeId: 'sandwich' }),
      entry({ slot: 'dinner', recipeId: 'sandwich' }),
      entry({ slot: 'lunch', recipeId: 'sandwich' }),
    ];
    expect(usualForSlot(rows, log, 'lunch')).toEqual([]);
    expect(usualForSlot(rows, log, 'dinner').map(r => r.key)).toEqual(['r:sandwich']);
  });

  it('offers nothing for no meal, and stops at the limit', () => {
    const log = ['bread', 'yogurt', 'soup'].flatMap(id => [
      entry({ slot: 'snack', itemId: id }),
      entry({ slot: 'snack', itemId: id }),
    ]);
    expect(usualForSlot(rows, log, null)).toEqual([]);
    expect(usualForSlot(rows, log, 'snack', 2)).toHaveLength(2);
  });

  it('ignores a food logged under no row', () => {
    const log = [entry({ slot: 'breakfast' }), entry({ slot: 'breakfast' })];
    expect(usualForSlot(rows, log, 'breakfast')).toEqual([]);
  });
});
