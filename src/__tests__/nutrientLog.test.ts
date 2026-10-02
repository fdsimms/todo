import type { FoodLogEntry } from '../types';
import { isNutrientOnlyEntry, nutrientHelping, nutrientOnlyEntryOf, nutrientOnlyKey } from '../utils/nutrientLog';

function entry(amounts: Record<string, number>, overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    id: 'e1',
    dayKey: '2026-09-16',
    atISO: '2026-09-16T08:00:00.000Z',
    slot: null,
    label: 'Sodium',
    recipeId: null,
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    quantity: '',
    grams: null,
    nutrition: {
      basis: 'perServing',
      servingGrams: null,
      servingText: '',
      amounts,
      source: 'manual',
      sourceId: null,
      portions: [],
      recordedAt: '2026-09-16T08:00:00.000Z',
    },
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: '2026-09-16T08:00:00.000Z',
    ...overrides,
  };
}

describe('isNutrientOnlyEntry / nutrientOnlyKey', () => {
  it('is an unlinked entry stating exactly one nutrient', () => {
    expect(isNutrientOnlyEntry(entry({ sodiumMg: 500 }))).toBe(true);
    expect(nutrientOnlyKey(entry({ sodiumMg: 500 }))).toBe('sodiumMg');
    expect(nutrientOnlyKey(entry({ waterMl: 250 }))).toBe('waterMl');
  });

  it('is not a one-figure estimate of a food, or a slotted entry', () => {
    expect(isNutrientOnlyEntry(entry({ calorieKcal: 600 }, { label: 'Chicken breast' }))).toBe(false);
    expect(isNutrientOnlyEntry(entry({ sodiumMg: 500 }, { slot: 'dinner' }))).toBe(false);
  });

  it('is not an entry with two nutrients or none', () => {
    expect(isNutrientOnlyEntry(entry({ sodiumMg: 500, proteinG: 4 }))).toBe(false);
    expect(isNutrientOnlyEntry(entry({}))).toBe(false);
  });

  it('is not a food somebody picked', () => {
    expect(isNutrientOnlyEntry(entry({ sodiumMg: 500 }, { itemId: 'i' }))).toBe(false);
    expect(isNutrientOnlyEntry(entry({ sodiumMg: 500 }, { productId: 'p' }))).toBe(false);
    expect(isNutrientOnlyEntry(entry({ sodiumMg: 500 }, { recipeId: 'r' }))).toBe(false);
  });
});

describe('nutrientOnlyEntryOf', () => {
  it('finds the labelled entry for that nutrient', () => {
    const found = entry({ sodiumMg: 500 });
    expect(nutrientOnlyEntryOf([entry({ caffeineMg: 95 }, { id: 'c', label: 'Caffeine' }), found], 'sodiumMg')).toBe(found);
  });

  it('skips a single-nutrient entry the person named themselves', () => {
    expect(nutrientOnlyEntryOf([entry({ sodiumMg: 500 }, { label: 'Pickle brine' })], 'sodiumMg')).toBeNull();
  });

  it('matches water by what it states, whatever it is called', () => {
    const water = entry({ waterMl: 250 }, { label: 'Water' });
    expect(nutrientOnlyEntryOf([water], 'waterMl')).toBe(water);
  });
});

describe('nutrientHelping', () => {
  it('states the nutrient alone, with its label and unit', () => {
    const built = nutrientHelping('caffeineMg', 95)!;
    expect(built.label).toBe('Caffeine');
    expect(built.quantity).toBe('95 mg');
    expect(built.nutrition.amounts).toEqual({ caffeineMg: 95 });
  });

  it('keeps one decimal place and no more', () => {
    expect(nutrientHelping('proteinG', 12.34)!.nutrition.amounts).toEqual({ proteinG: 12.3 });
  });

  it('is null for a total with nothing to state', () => {
    expect(nutrientHelping('sodiumMg', 0)).toBeNull();
    expect(nutrientHelping('sodiumMg', -5)).toBeNull();
    expect(nutrientHelping('sodiumMg', Number.NaN)).toBeNull();
  });

  it('hands water to the water entry’s own wording', () => {
    expect(nutrientHelping('waterMl', 1500)!.quantity).toBe('1.5 L');
  });
});
