import type { FoodNutrition, GroceryItem, ItemProduct } from '../types';
import { lineWeightGrams, lineWeightText, panelForLine } from '../utils/lineWeight';

function panel(portions: FoodNutrition['portions']): FoodNutrition {
  return {
    basis: 'per100g',
    servingGrams: null,
    servingText: null,
    amounts: { calorieKcal: 364 },
    portions,
    source: 'fdc',
    sourceId: null,
    recordedAt: '2026-01-01T00:00:00.000Z',
  };
}

const flour = panel([{ amount: 1, label: 'cup', grams: 125 }]);
const onion = panel([
  { amount: 1, label: 'cup, chopped', grams: 160 },
  { amount: 1, label: 'cup, sliced', grams: 115 },
  { amount: 1, label: 'medium', grams: 110 },
]);

describe('lineWeightGrams', () => {
  it('weighs a volume line through the food\'s own portion table', () => {
    expect(lineWeightGrams('2 cups', null, flour)).toBeCloseTo(250, 5);
    // Read as a density, so a spoon is answered from the cup row.
    expect(lineWeightGrams('1 tbsp', null, flour)).toBeCloseTo(125 / 16, 5);
  });

  it('uses a portion the user weighed themselves exactly like a stated one', () => {
    const weighed = panel([{ amount: 3, label: 'tbsp', grams: 40, custom: true }]);
    expect(lineWeightGrams('3 tbsp', null, weighed)).toBeCloseTo(40, 5);
  });

  it('weighs a named count', () => {
    expect(lineWeightGrams('2 medium', null, onion)).toBe(220);
  });

  it('lets the prep clause pick between disagreeing volume rows, and refuses without one', () => {
    expect(lineWeightGrams('1 cup', 'chopped', onion)).toBe(160);
    expect(lineWeightGrams('1 cup', null, onion)).toBeNull();
  });

  it('adds nothing to a line already written as a weight', () => {
    expect(lineWeightGrams('200 g', null, flour)).toBeNull();
    expect(lineWeightGrams('1 lb', null, flour)).toBeNull();
  });

  it('refuses a range rather than captioning its low end', () => {
    expect(lineWeightGrams('1 to 2 cups', null, flour)).toBeNull();
  });

  it('refuses with no figures, no portions, or no amount', () => {
    expect(lineWeightGrams('1 cup', null, null)).toBeNull();
    expect(lineWeightGrams('1 cup', null, panel([]))).toBeNull();
    expect(lineWeightGrams('to taste', null, flour)).toBeNull();
    expect(lineWeightGrams('', null, flour)).toBeNull();
  });

  it('refuses a counted container', () => {
    const tomatoes = panel([{ amount: 1, label: 'can', grams: 400 }]);
    expect(lineWeightGrams('2 14 oz cans', null, tomatoes)).toBeNull();
  });
});

describe('lineWeightText', () => {
  it('writes grams for a metric or as-written reader and ounces for a US one', () => {
    expect(lineWeightText('1 cup', null, flour, 'asWritten')).toBe('≈125 g');
    expect(lineWeightText('1 cup', null, flour, 'metric')).toBe('≈125 g');
    expect(lineWeightText('1 cup', null, flour, 'us')).toMatch(/^≈4 1\/2 oz$/);
  });

  it('rounds to the gram, not to a chart step, so a weighed portion reads back as weighed', () => {
    expect(lineWeightText('1 tbsp', null, flour, 'metric')).toBe('≈8 g');
    expect(lineWeightText('3 cups', null, flour, 'metric')).toBe('≈375 g');
  });

  it('moves to kilograms for a large amount', () => {
    expect(lineWeightText('10 cups', null, flour, 'metric')).toBe('≈1.25 kg');
  });

  it('is null whenever the grams are', () => {
    expect(lineWeightText('200 g', null, flour, 'metric')).toBeNull();
  });
});

describe('panelForLine', () => {
  const item = (over: Partial<GroceryItem>): GroceryItem => ({
    id: 'i1', name: 'Onion', nameKey: 'onion', nutrition: onion, preferredProductId: null,
    ...over,
  } as GroceryItem);

  it('finds the catalog row by key, tolerating a plural', () => {
    const byKey = new Map([['onion', item({})]]);
    expect(panelForLine('onion', byKey, new Map())).toBe(onion);
    expect(panelForLine('onions', byKey, new Map())).toBe(onion);
    expect(panelForLine('garlic', byKey, new Map())).toBeNull();
  });

  it('prefers the preferred box\'s panel over the row\'s own', () => {
    const boxPanel = panel([{ amount: 1, label: 'cup', grams: 130 }]);
    const byKey = new Map([['flour', item({ nameKey: 'flour', nutrition: flour, preferredProductId: 'p1' })]]);
    const products = new Map([['p1', { id: 'p1', nutrition: boxPanel } as ItemProduct]]);
    expect(panelForLine('flour', byKey, products)).toBe(boxPanel);
  });
});
