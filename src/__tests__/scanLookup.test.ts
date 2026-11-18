import type { FoodNutrition } from '../types';
import { describeScanPanel } from '../utils/scanLookup';

function panel(over: Partial<FoodNutrition> = {}): FoodNutrition {
  return {
    basis: 'perServing',
    servingGrams: 28,
    servingText: '28 g',
    amounts: { calorieKcal: 140, proteinG: 12, carbsG: 5.04, fatG: 6 },
    source: 'openFoodFacts',
    sourceId: '0123456789012',
    portions: [],
    recordedAt: '2026-09-10T09:00:00.000Z',
    ...over,
  };
}

describe('describeScanPanel', () => {
  it('names the headline figures and what they are measured against', () => {
    expect(describeScanPanel(panel())).toBe('140 cal · 12 g protein · 5 g carbs · 6 g fat per serving (28 g)');
  });

  it('keeps one decimal below 10 g so a small figure does not round up to the next whole gram', () => {
    expect(describeScanPanel(panel({ amounts: { calorieKcal: 20, fatG: 0.5 } }))).toBe(
      '20 cal · 0.5 g fat per serving (28 g)'
    );
  });

  it('leaves out a figure the source did not state, and keeps a stated zero', () => {
    expect(describeScanPanel(panel({ amounts: { calorieKcal: 90, fatG: 0 } }))).toBe(
      '90 cal · 0 g fat per serving (28 g)'
    );
  });

  it('says what a per-100 record is against without converting it', () => {
    expect(describeScanPanel(panel({ basis: 'per100g', amounts: { calorieKcal: 250 } }))).toBe('250 cal per 100 g');
    expect(describeScanPanel(panel({ basis: 'per100ml', amounts: { calorieKcal: 42 } }))).toBe('42 cal per 100 ml');
  });

  it('says per serving alone when the source printed no serving text', () => {
    expect(describeScanPanel(panel({ servingText: null, amounts: { calorieKcal: 60 } }))).toBe('60 cal per serving');
  });

  it('is null when no headline figure was stated, or there is no panel', () => {
    expect(describeScanPanel(panel({ amounts: { sodiumMg: 300 } }))).toBeNull();
    expect(describeScanPanel(null)).toBeNull();
    expect(describeScanPanel(undefined)).toBeNull();
  });
});
