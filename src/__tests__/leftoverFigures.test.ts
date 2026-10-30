import { containerFigures, containerPanelFromAmounts, fridgeMatches } from '../utils/leftoverFigures';
import type { FoodLogEntry, FoodNutrition } from '../types';
import type { DishFigures } from '../utils/mealLog';

const NOW = new Date(2026, 9, 30, 12);

const panel = (calories: number): FoodNutrition => ({
  basis: 'perServing', servingGrams: null, servingText: '1 bowl', amounts: { calorieKcal: calories },
  source: 'estimated', sourceId: null, portions: [], recordedAt: NOW.toISOString(),
});

const entry = (label: string, calories: number): FoodLogEntry => ({
  id: label, dayKey: '2026-10-29', atISO: '2026-10-29T18:00:00.000Z', slot: null, label,
  recipeId: null, itemId: null, productId: null, mealPlanEntryId: null, quantity: '1 bowl', grams: null,
  nutrition: panel(calories),
} as unknown as FoodLogEntry);

const dish: DishFigures = { total: { calorieKcal: 2000 }, perServing: { calorieKcal: 500 }, servings: 4, cookedGrams: 1000 };
const bare = { title: 'Massaman curry', recipeId: null, weightG: null, nutrition: null };

describe('containerFigures', () => {
  it('uses the stored panel first, as the whole container', () => {
    const r = containerFigures({ leftover: { ...bare, nutrition: panel(700) }, dish: null, entries: [entry('Massaman curry', 400)], now: NOW });
    expect(r?.source).toBe('container');
    expect(r?.nutrition.amounts.calorieKcal).toBe(700);
  });

  it('scales a recipe by what the container weighs', () => {
    const r = containerFigures({ leftover: { ...bare, recipeId: 'r', weightG: 250 }, dish, entries: [], now: NOW });
    expect(r?.source).toBe('recipe');
    expect(r?.nutrition.amounts.calorieKcal).toBe(500);
    expect(r?.grams).toBe(250);
  });

  it('gives up on the recipe without a weight, or when the container outweighs the dish', () => {
    expect(containerFigures({ leftover: { ...bare, recipeId: 'r' }, dish, entries: [], now: NOW })).toBeNull();
    expect(containerFigures({ leftover: { ...bare, recipeId: 'r', weightG: 5000 }, dish, entries: [], now: NOW })).toBeNull();
  });

  it('falls back to the same name logged earlier, exact name only', () => {
    const r = containerFigures({ leftover: bare, dish: null, entries: [entry('massaman curry', 410)], now: NOW });
    expect(r?.source).toBe('earlier');
    expect(r?.nutrition.amounts.calorieKcal).toBe(410);
    expect(containerFigures({ leftover: bare, dish: null, entries: [entry('Massaman curry with rice', 410)], now: NOW })).toBeNull();
  });

  it('is null when nothing is known', () => {
    expect(containerFigures({ leftover: bare, dish: null, entries: [], now: NOW })).toBeNull();
  });
});

describe('containerPanelFromAmounts', () => {
  it('builds a per-serving panel for the whole container', () => {
    const p = containerPanelFromAmounts({ calorieKcal: 650, proteinG: 30 }, { now: NOW });
    expect(p?.basis).toBe('perServing');
    expect(p?.source).toBe('estimated');
    expect(p?.servingText).toBe('whole container');
  });
  it('refuses an unknown nutrient or a bad figure, and returns null for none', () => {
    expect(() => containerPanelFromAmounts({ zinc_oz: 1 })).toThrow(/isn't a nutrient/);
    expect(() => containerPanelFromAmounts({ calorieKcal: -1 })).toThrow(/0 or more/);
    expect(containerPanelFromAmounts({})).toBeNull();
  });
});

describe('fridgeMatches', () => {
  const rows = [{ title: 'Massaman curry' }, { title: 'Chili' }];
  it('shows everything with nothing typed', () => expect(fridgeMatches(rows, '  ')).toHaveLength(2));
  it('needs every typed word in the name', () => {
    expect(fridgeMatches(rows, 'massaman')).toHaveLength(1);
    expect(fridgeMatches(rows, 'curry mass')).toHaveLength(1);
    expect(fridgeMatches(rows, 'curry chili')).toHaveLength(0);
  });
});
