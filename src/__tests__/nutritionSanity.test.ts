import type { FoodNutrition, NutrientKey } from '../types';
import { panelWarnings } from '../utils/nutritionSanity';

function panel(
  amounts: Partial<Record<NutrientKey, number>>,
  over: Partial<FoodNutrition> = {},
): FoodNutrition {
  return {
    basis: 'perServing',
    servingGrams: 35,
    servingText: '1 bar',
    amounts,
    source: 'manual',
    sourceId: null,
    portions: [],
    recordedAt: '2026-10-12T12:00:00.000Z',
    ...over,
  };
}

const keys = (p: FoodNutrition) => panelWarnings(p).map(w => w.key);

describe('panelWarnings', () => {
  it('flags grams of sodium misread for milligrams', () => {
    const warnings = panelWarnings(panel({ sodiumMg: 16000, calorieKcal: 130 }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].key).toBe('sodiumMg');
    expect(warnings[0].message).toContain('16,000 mg');
  });

  it('flags a high sodium figure in a heavier serving that is still absurd', () => {
    expect(keys(panel({ sodiumMg: 16000 }, { servingGrams: 60 }))).toEqual(['sodiumMg']);
  });

  it('flags sodium over the per-serving ceiling when the weight is unknown', () => {
    expect(keys(panel({ sodiumMg: 16000 }, { servingGrams: null }))).toEqual(['sodiumMg']);
  });

  it('passes a normal panel', () => {
    expect(panelWarnings(panel({
      calorieKcal: 140, fatG: 4, satFatG: 1, carbsG: 25, fiberG: 3, sugarG: 12, proteinG: 2, sodiumMg: 160,
    }))).toEqual([]);
  });

  it('passes foods that really are salty or dense', () => {
    // Bouillon: about 200 mg of sodium per gram.
    expect(panelWarnings(panel({ sodiumMg: 800 }, { servingGrams: 4 }))).toEqual([]);
    // Soy sauce per 100 g.
    expect(panelWarnings(panel({ sodiumMg: 5500 }, { basis: 'per100g', servingGrams: null }))).toEqual([]);
    // Pure oil per 100 g.
    expect(panelWarnings(panel({ calorieKcal: 900, fatG: 100 }, { basis: 'per100g', servingGrams: null }))).toEqual([]);
  });

  it('flags macros that outweigh the serving', () => {
    expect(keys(panel({ fatG: 20, carbsG: 30, proteinG: 10 }, { servingGrams: 35 }))).toContain('carbsG');
  });

  it('flags calories beyond what the serving weight can hold', () => {
    expect(keys(panel({ calorieKcal: 1300 }, { servingGrams: 35 }))).toEqual(['calorieKcal']);
  });

  it('flags a part larger than its whole, allowing for rounding', () => {
    expect(keys(panel({ carbsG: 10, sugarG: 15 }))).toEqual(['sugarG']);
    expect(panelWarnings(panel({ carbsG: 10, sugarG: 10.5 }))).toEqual([]);
    expect(keys(panel({ fatG: 2, satFatG: 5 }))).toEqual(['satFatG']);
    expect(keys(panel({ sugarG: 5, addedSugarG: 9 }))).toEqual(['addedSugarG']);
  });

  it('flags calories that do not match the macros', () => {
    expect(keys(panel({ calorieKcal: 900, proteinG: 5, carbsG: 20, fatG: 3 }, { servingGrams: null }))).toEqual(['calorieKcal']);
  });

  it('allows the usual gap fiber and rounding leave', () => {
    expect(panelWarnings(panel({ calorieKcal: 120, proteinG: 3, carbsG: 25, fatG: 2 }))).toEqual([]);
  });

  it('skips the energy check when a macro is unknown', () => {
    expect(panelWarnings(panel({ calorieKcal: 900, proteinG: 5 }, { servingGrams: null }))).toEqual([]);
  });

  it('applies per-serving ceilings only to a per-serving panel', () => {
    expect(keys(panel({ caffeineMg: 900 }, { servingGrams: null }))).toEqual(['caffeineMg']);
    expect(panelWarnings(panel({ caffeineMg: 900 }, { basis: 'per100g', servingGrams: null }))).toEqual([]);
  });

  it('reports one warning per figure', () => {
    const warnings = panelWarnings(panel({ sodiumMg: 16000 }, { servingGrams: 5 }));
    expect(warnings.filter(w => w.key === 'sodiumMg')).toHaveLength(1);
  });
});
