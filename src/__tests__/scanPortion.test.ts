import type { FoodNutrition } from '../types';
import { packageChoices, packageHelping, servingsPerPackage } from '../utils/scanPortion';

function panel(over: Partial<FoodNutrition> = {}): FoodNutrition {
  return {
    basis: 'per100g',
    servingGrams: 45,
    servingText: '45g',
    amounts: { calorieKcal: 220, proteinG: 8, sodiumMg: 300 },
    source: 'openFoodFacts',
    sourceId: '5000159407236',
    portions: [],
    recordedAt: '2026-09-10T09:00:00.000Z',
    ...over,
  };
}

describe('servingsPerPackage', () => {
  it('divides a stated pack size by the stated serving', () => {
    expect(servingsPerPackage(panel(), '500 g')).toBe(11.1);
  });

  it('refuses a pack size the source never stated', () => {
    // Inventing a count would multiply a real per-serving figure by a made-up
    // one, which is the whole thing this must not do.
    expect(servingsPerPackage(panel(), null)).toBeNull();
    expect(servingsPerPackage(panel(), '   ')).toBeNull();
  });

  it('refuses a panel with no serving weight to divide by', () => {
    expect(servingsPerPackage(panel({ servingGrams: null }), '500 g')).toBeNull();
    expect(servingsPerPackage(panel({ servingGrams: 0 }), '500 g')).toBeNull();
  });

  it('refuses a pack size in pieces, which is not a mass', () => {
    expect(servingsPerPackage(panel(), '6 bars')).toBeNull();
    expect(servingsPerPackage(panel(), 'family size')).toBeNull();
  });

  it('measures a volume against a per-100ml panel only', () => {
    const drink = panel({ basis: 'per100ml', servingGrams: 250, servingText: '250ml' });
    expect(servingsPerPackage(drink, '1 L')).toBe(4);
    // Millilitres into grams needs a density this app deliberately hasn't got.
    expect(servingsPerPackage(panel(), '1 L')).toBeNull();
    expect(servingsPerPackage(drink, '500 g')).toBeNull();
  });

  it('refuses a package smaller than one of its own servings', () => {
    // Either the pack size is wrong or the units disagree; typing the amount is
    // the honest way out of both.
    expect(servingsPerPackage(panel({ servingGrams: 400 }), '250 g')).toBeNull();
  });

  it('accepts a package that is exactly one serving', () => {
    expect(servingsPerPackage(panel({ servingGrams: 330 }), '330 g')).toBe(1);
  });
});

describe('packageChoices', () => {
  it('offers the serving in the words on the packet, and the package', () => {
    expect(packageChoices(panel(), '500 g')).toEqual([
      { key: 'serving', label: '1 serving (45g)', servings: 1 },
      { key: 'package', label: 'The whole package (11.1 servings)', servings: 11.1 },
    ]);
  });

  it('says just "1 serving" when the source stated no serving text', () => {
    expect(packageChoices(panel({ servingText: null }), null)).toEqual([
      { key: 'serving', label: '1 serving', servings: 1 },
    ]);
  });

  it('offers nothing for a per-100g panel with no serving at all', () => {
    // It can still be logged, but only by typing an amount. Offering "1
    // serving" here would be inventing the serving.
    expect(packageChoices(panel({ servingGrams: null, servingText: null }), '500 g')).toEqual([]);
  });

  it('keeps the serving for a perServing panel that states no weight', () => {
    const perServing = panel({ basis: 'perServing', servingGrams: null, servingText: '2 biscuits' });
    expect(packageChoices(perServing, null)).toEqual([
      { key: 'serving', label: '1 serving (2 biscuits)', servings: 1 },
    ]);
  });

  it('withholds the package when it works out to a single serving', () => {
    expect(packageChoices(panel({ servingGrams: 330, servingText: '330g' }), '330 g'))
      .toEqual([{ key: 'serving', label: '1 serving (330g)', servings: 1 }]);
  });

  it('prints a whole number of servings without a decimal point', () => {
    const choices = packageChoices(panel({ servingGrams: 100, servingText: '100g' }), '500 g');
    expect(choices[1].label).toBe('The whole package (5 servings)');
  });

  it('does not repeat "serving" when the source already wrote it', () => {
    // Open Food Facts' own serving_size is sometimes "1 serving (80 g)"
    // already, not just the size — prepending "1 serving" again would read
    // as "1 serving (1 serving (80 g))".
    const choices = packageChoices(panel({ servingGrams: 80, servingText: '1 serving (80 g)' }), null);
    expect(choices).toEqual([{ key: 'serving', label: '1 serving (80 g)', servings: 1 }]);
  });
});

describe('packageHelping', () => {
  it('scales a per-100g panel through its own serving weight', () => {
    const helping = packageHelping(panel(), 1, '1 serving (45g)', new Date('2026-09-10T12:00:00Z'));
    expect(helping?.basis).toBe('perServing');
    expect(helping?.amounts).toEqual({ calorieKcal: 99, proteinG: 3.6, sodiumMg: 135 });
    expect(helping?.servingGrams).toBe(45);
    expect(helping?.servingText).toBe('1 serving (45g)');
  });

  it('multiplies out a whole package', () => {
    const helping = packageHelping(panel({ servingGrams: 100 }), 5, 'The whole package');
    expect(helping?.amounts).toEqual({ calorieKcal: 1100, proteinG: 40, sodiumMg: 1500 });
    expect(helping?.servingGrams).toBe(500);
  });

  it('takes a perServing panel as it stands', () => {
    const perServing = panel({ basis: 'perServing', amounts: { calorieKcal: 150 } });
    expect(packageHelping(perServing, 2, 'Two')?.amounts).toEqual({ calorieKcal: 300 });
  });

  it('carries the source through unchanged', () => {
    // A manufacturer's label scaled to two servings is still a manufacturer's
    // label. Who declared the figures is as true of the helping as of the packet.
    const helping = packageHelping(panel(), 2, 'Two servings');
    expect(helping?.source).toBe('openFoodFacts');
    expect(helping?.sourceId).toBe('5000159407236');
  });

  it('drops the portion table, which describes the food rather than the helping', () => {
    const withPortions = panel({
      portions: [{ amount: 1, label: 'slice', grams: 30 }],
    });
    expect(packageHelping(withPortions, 1, 'One')?.portions).toEqual([]);
  });

  it('leaves an absent nutrient absent rather than making it zero', () => {
    const sparse = panel({ amounts: { calorieKcal: 220 } });
    const helping = packageHelping(sparse, 1, 'One');
    expect(helping?.amounts).toEqual({ calorieKcal: 99 });
    expect('proteinG' in (helping?.amounts ?? {})).toBe(false);
  });

  it('refuses a per-100g panel it cannot scale, rather than guessing a serving', () => {
    expect(packageHelping(panel({ servingGrams: null }), 1, 'One')).toBeNull();
  });

  it('refuses a helping of nothing', () => {
    expect(packageHelping(panel(), 0, 'None')).toBeNull();
    expect(packageHelping(panel(), -1, 'Less than none')).toBeNull();
  });

  it('refuses a panel that states no figures at all', () => {
    expect(packageHelping(panel({ amounts: {} }), 1, 'One')).toBeNull();
  });
});
