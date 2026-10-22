import type { FoodNutrition } from '../types';
import {
  panelGramsFor,
  parseStatedAmount,
  ratioFromBatch,
  readCooking,
  stateUnitLabel,
} from '../utils/cookedState';
import { amountHint, composeFoodAmount, foodUnitOptionsFor, parseFoodAmount, scalePanelToAmount } from '../utils/foodLog';
import { parseFoodNutrition, serializeFoodNutrition } from '../utils/foodNutrition';

const NOW = new Date(2026, 9, 22, 12);

function rice(over: Partial<FoodNutrition> = {}): FoodNutrition {
  return {
    basis: 'per100g',
    servingGrams: null,
    servingText: null,
    amounts: { calorieKcal: 360, carbsG: 80 },
    source: 'manual',
    sourceId: null,
    portions: [],
    recordedAt: NOW.toISOString(),
    cooking: { panelState: 'raw', cookedPerRaw: 2.8 },
    ...over,
  };
}

describe('readCooking', () => {
  it('reads a whole record and refuses anything else', () => {
    expect(readCooking({ panelState: 'raw', cookedPerRaw: 2.8 })).toEqual({ panelState: 'raw', cookedPerRaw: 2.8 });
    expect(readCooking({ panelState: 'steamed', cookedPerRaw: 2.8 })).toBeNull();
    expect(readCooking({ panelState: 'raw', cookedPerRaw: 0 })).toBeNull();
    expect(readCooking({ panelState: 'raw', cookedPerRaw: 400 })).toBeNull();
    expect(readCooking({ panelState: 'raw', cookedPerRaw: '2.8' })).toBeNull();
    expect(readCooking(null)).toBeNull();
  });

  it('survives the stored blob, and a record without it reads as it always did', () => {
    const back = parseFoodNutrition(serializeFoodNutrition(rice()));
    expect(back?.cooking).toEqual({ panelState: 'raw', cookedPerRaw: 2.8 });
    const plain = parseFoodNutrition(serializeFoodNutrition(rice({ cooking: undefined })));
    expect(plain).not.toBeNull();
    expect('cooking' in (plain as object)).toBe(false);
  });

  it('drops an unreadable ratio without dropping the panel', () => {
    const blob = JSON.stringify({ ...rice(), cooking: { panelState: 'raw', cookedPerRaw: -1 } });
    const back = parseFoodNutrition(blob);
    expect(back).not.toBeNull();
    expect(back?.cooking).toBeUndefined();
  });
});

describe('ratioFromBatch', () => {
  it('divides cooked by raw and rounds to two places', () => {
    expect(ratioFromBatch(200, 560)).toBe(2.8);
    expect(ratioFromBatch(150, 330)).toBe(2.2);
  });
  it('refuses a missing weight or an out-of-range result', () => {
    expect(ratioFromBatch(0, 100)).toBeNull();
    expect(ratioFromBatch(100, 0)).toBeNull();
    expect(ratioFromBatch(1, 500)).toBeNull();
  });
});

describe('parseStatedAmount', () => {
  it('reads grams, ounces and pounds, with raw, dry or uncooked and cooked', () => {
    expect(parseStatedAmount('100 g raw')).toEqual({ grams: 100, state: 'raw' });
    expect(parseStatedAmount('100g dry')).toEqual({ grams: 100, state: 'raw' });
    expect(parseStatedAmount('250 cooked')).toEqual({ grams: 250, state: 'cooked' });
    expect(parseStatedAmount('1 lb uncooked')?.grams).toBeCloseTo(453.59, 1);
    expect(parseStatedAmount('3.5 oz cooked')?.grams).toBeCloseTo(99.2, 1);
  });
  it('leaves every other amount alone', () => {
    expect(parseStatedAmount('100g')).toBeNull();
    expect(parseStatedAmount('1 cup cooked')).toBeNull();
    expect(parseStatedAmount('2 servings')).toBeNull();
    expect(parseStatedAmount('0 g raw')).toBeNull();
  });
});

describe('panelGramsFor', () => {
  it('converts the other state through the ratio, in both directions', () => {
    expect(panelGramsFor(rice(), '280 g cooked')).toEqual({ grams: 100 });
    const cookedPanel = rice({ cooking: { panelState: 'cooked', cookedPerRaw: 2.8 } });
    expect(panelGramsFor(cookedPanel, '100 g raw')).toEqual({ grams: 280 });
    expect(panelGramsFor(cookedPanel, '280 g cooked')).toEqual({ grams: 280 });
  });
  it("takes the panel's own state as plain grams", () => {
    expect(panelGramsFor(rice(), '75 g raw')).toEqual({ grams: 75 });
  });
  it('returns null for an amount that names no state', () => {
    expect(panelGramsFor(rice(), '100g')).toBeNull();
  });
  it('refuses a stated amount the food cannot answer', () => {
    expect(panelGramsFor(rice({ cooking: undefined }), '100 g cooked')).toBe('refused');
    expect(panelGramsFor(rice({ basis: 'per100ml' }), '100 g cooked')).toBe('refused');
    expect(panelGramsFor(rice({ basis: 'perServing', servingGrams: null }), '100 g cooked')).toBe('refused');
  });
});

describe('scalePanelToAmount with a state', () => {
  it('logs cooked rice off a raw panel by the raw weight it came from', () => {
    // 280 g cooked is 100 g raw at a ratio of 2.8, so the whole 360 kcal.
    const out = scalePanelToAmount(rice({ cooking: { panelState: 'raw', cookedPerRaw: 2.8 } }), '280 g cooked', null, NOW);
    expect(out?.grams).toBe(100);
    expect(out?.nutrition.amounts.calorieKcal).toBe(360);
  });

  it('logs raw grams against a cooked panel by what they come to cooked', () => {
    const cooked = rice({ amounts: { calorieKcal: 130, carbsG: 28 }, cooking: { panelState: 'cooked', cookedPerRaw: 2.8 } });
    const out = scalePanelToAmount(cooked, '100 g raw', null, NOW);
    expect(out?.grams).toBe(280);
    expect(out?.nutrition.amounts.calorieKcal).toBe(364);
  });

  it('keeps what was typed as the serving text and drops the ratio from the helping', () => {
    const out = scalePanelToAmount(rice(), '100 g raw', null, NOW);
    expect(out?.nutrition.servingText).toBe('100 g raw');
    expect(out?.nutrition.cooking).toBeUndefined();
  });

  it('refuses a state amount on a food without a ratio instead of reading plain grams', () => {
    expect(scalePanelToAmount(rice({ cooking: undefined }), '100 g cooked', null, NOW)).toBeNull();
  });

  it('is unchanged for an ordinary amount', () => {
    const out = scalePanelToAmount(rice(), '50g', null, NOW);
    expect(out?.grams).toBe(50);
    expect(out?.nutrition.amounts.calorieKcal).toBe(180);
  });
});

describe('the unit pill', () => {
  it('offers the other state beside the weights, and round-trips through reopening', () => {
    const options = foodUnitOptionsFor(rice());
    const pill = options.find(o => o.label === 'g cooked');
    expect(pill).toBeDefined();
    expect(stateUnitLabel(rice().cooking!)).toBe('g cooked');
    const text = composeFoodAmount('200', pill);
    expect(text).toBe('200 g cooked');
    expect(parseFoodAmount(text, options)).toEqual({ number: '200', unitKey: pill!.key });
  });

  it('offers none without a ratio, and says so in the hint only when it applies', () => {
    expect(foodUnitOptionsFor(rice({ cooking: undefined })).some(o => /cooked|raw/.test(o.label))).toBe(false);
    expect(amountHint(rice())).toContain('100 g cooked');
    expect(amountHint(rice({ cooking: undefined }))).not.toContain('cooked');
  });
});
