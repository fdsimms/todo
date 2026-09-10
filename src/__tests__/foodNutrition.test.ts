import {
  nutritionFor,
  parseFoodNutrition,
  serializeFoodNutrition,
} from '../utils/foodNutrition';
import { NUTRIENT_KEYS } from '../types';
import { HEALTH_NUTRIENT_METRICS } from '../utils/healthRules';
import type { FoodNutrition } from '../types';

const RECORDED_AT = '2026-09-09T12:00:00.000Z';

function nutrition(overrides: Partial<FoodNutrition> = {}): FoodNutrition {
  return {
    basis: 'per100g',
    servingGrams: null,
    servingText: null,
    amounts: { calorieKcal: 52, proteinG: 1.4 },
    source: 'fdc',
    sourceId: '170000',
    recordedAt: RECORDED_AT,
    ...overrides,
  };
}

/** The stored column value for a blob, so a test can hand `parseFoodNutrition` something hand-shaped. */
function stored(blob: unknown): string {
  return JSON.stringify(blob);
}

describe('parseFoodNutrition', () => {
  it('reads back what serializeFoodNutrition wrote', () => {
    const original = nutrition({
      basis: 'perServing',
      servingGrams: 170,
      servingText: '1 container (170g)',
      amounts: { calorieKcal: 90, proteinG: 15, sugarG: 4, sodiumMg: 55 },
      source: 'openFoodFacts',
      sourceId: '0894700010045',
    });
    expect(parseFoodNutrition(serializeFoodNutrition(original))).toEqual(original);
  });

  it('answers null for an empty column, which is every row predating the migration', () => {
    expect(parseFoodNutrition(null)).toBeNull();
    expect(parseFoodNutrition(undefined)).toBeNull();
    expect(parseFoodNutrition('')).toBeNull();
  });

  it('shrugs at a blob it cannot read rather than throwing', () => {
    expect(parseFoodNutrition('not json at all')).toBeNull();
    expect(parseFoodNutrition('null')).toBeNull();
    expect(parseFoodNutrition('[]')).toBeNull();
    expect(parseFoodNutrition('"a string"')).toBeNull();
  });

  describe('the three things it refuses to do without', () => {
    it('refuses a record with no basis, since the figures would be unreadable', () => {
      expect(parseFoodNutrition(stored({ ...nutrition(), basis: undefined }))).toBeNull();
    });

    it('refuses a basis it does not recognise rather than picking one', () => {
      expect(parseFoodNutrition(stored({ ...nutrition(), basis: 'perOunce' }))).toBeNull();
    });

    it('refuses a record with no figures in it', () => {
      expect(parseFoodNutrition(stored({ ...nutrition(), amounts: {} }))).toBeNull();
      expect(parseFoodNutrition(stored({ ...nutrition(), amounts: undefined }))).toBeNull();
    });

    it('refuses a record this app never stamped', () => {
      expect(parseFoodNutrition(stored({ ...nutrition(), recordedAt: undefined }))).toBeNull();
      expect(parseFoodNutrition(stored({ ...nutrition(), recordedAt: '' }))).toBeNull();
    });
  });

  describe('an absent figure is unknown, never zero', () => {
    it('leaves a nutrient the source never mentioned absent', () => {
      const parsed = parseFoodNutrition(stored(nutrition({ amounts: { calorieKcal: 52 } })));
      expect(parsed!.amounts.calorieKcal).toBe(52);
      expect(parsed!.amounts.fiberG).toBeUndefined();
      expect('fiberG' in parsed!.amounts).toBe(false);
    });

    it('keeps a real zero, because a food containing no fat is a thing a source can state', () => {
      const parsed = parseFoodNutrition(stored(nutrition({ amounts: { calorieKcal: 52, fatG: 0 } })));
      expect(parsed!.amounts.fatG).toBe(0);
    });

    it('drops a figure that is not a usable number', () => {
      const parsed = parseFoodNutrition(
        stored(nutrition({ amounts: { calorieKcal: 52, proteinG: 'lots', fiberG: NaN, sugarG: -3 } as never }))
      );
      expect(parsed!.amounts).toEqual({ calorieKcal: 52 });
    });

    it('drops a nutrient this build has no unit for', () => {
      const parsed = parseFoodNutrition(
        stored(nutrition({ amounts: { calorieKcal: 52, vitaminDMcg: 2.4 } as never }))
      );
      expect(parsed!.amounts).toEqual({ calorieKcal: 52 });
    });
  });

  describe('serving weight', () => {
    it('keeps one the source stated', () => {
      expect(parseFoodNutrition(stored(nutrition({ servingGrams: 170 })))!.servingGrams).toBe(170);
    });

    it('refuses a weight of nothing, which could not scale anything', () => {
      expect(parseFoodNutrition(stored(nutrition({ servingGrams: 0 })))!.servingGrams).toBeNull();
      expect(parseFoodNutrition(stored(nutrition({ servingGrams: -5 })))!.servingGrams).toBeNull();
    });

    it('degrades an unreadable weight rather than dropping the whole record', () => {
      const parsed = parseFoodNutrition(stored(nutrition({ servingGrams: 'about 6oz' as never })));
      expect(parsed).not.toBeNull();
      expect(parsed!.servingGrams).toBeNull();
    });

    it('keeps the printed serving as text and never treats it as the number', () => {
      const parsed = parseFoodNutrition(stored(nutrition({ servingText: '2 cookies', servingGrams: 30 })));
      expect(parsed!.servingText).toBe('2 cookies');
      expect(parsed!.servingGrams).toBe(30);
    });
  });

  describe('provenance', () => {
    it.each(['fdc', 'openFoodFacts', 'manual', 'estimated'] as const)('keeps a known source (%s)', source => {
      expect(parseFoodNutrition(stored(nutrition({ source })))!.source).toBe(source);
    });

    it('demotes a source it cannot explain to the weakest claim rather than dropping the record', () => {
      const parsed = parseFoodNutrition(stored({ ...nutrition(), source: 'someFutureDatabase' }));
      expect(parsed).not.toBeNull();
      expect(parsed!.source).toBe('estimated');
    });

    it('never promotes an unknown source to one that asserts a person typed it', () => {
      expect(parseFoodNutrition(stored({ ...nutrition(), source: undefined }))!.source).not.toBe('manual');
    });

    it('drops a source id that is not one', () => {
      expect(parseFoodNutrition(stored(nutrition({ sourceId: 12345 as never })))!.sourceId).toBeNull();
    });
  });
});

describe('serializeFoodNutrition', () => {
  it('writes an empty column for no record, which is what parse answers null for', () => {
    expect(serializeFoodNutrition(null)).toBeNull();
  });

  it('writes something parse can read', () => {
    expect(parseFoodNutrition(serializeFoodNutrition(nutrition()))).toEqual(nutrition());
  });
});

describe('nutritionFor', () => {
  const itemFigures = nutrition({ amounts: { calorieKcal: 59 }, source: 'fdc' });
  const boxFigures = nutrition({ amounts: { calorieKcal: 90 }, source: 'openFoodFacts' });

  it('prefers the box in hand over the generic catalog row', () => {
    expect(nutritionFor({ nutrition: itemFigures }, { nutrition: boxFigures })).toBe(boxFigures);
  });

  it('falls back to the item when the box has nothing of its own', () => {
    expect(nutritionFor({ nutrition: itemFigures }, { nutrition: null })).toBe(itemFigures);
  });

  it('answers the item when there is no box at all', () => {
    expect(nutritionFor({ nutrition: itemFigures })).toBe(itemFigures);
    expect(nutritionFor({ nutrition: itemFigures }, null)).toBe(itemFigures);
  });

  it('answers null when neither knows anything, rather than an empty panel', () => {
    expect(nutritionFor({ nutrition: null }, { nutrition: null })).toBeNull();
    expect(nutritionFor(null)).toBeNull();
    expect(nutritionFor(undefined)).toBeNull();
  });
});

describe('the vocabulary lines up with the health rules', () => {
  // The whole reason NutrientKey spells its keys the way it does: a figure
  // logged here has to be able to answer a rule the user already set up
  // against Apple Health. A ninth metric over there with no home here would
  // be a rule this app could never satisfy from its own data.
  it('has a home for every nutrient a health rule can watch', () => {
    for (const metric of HEALTH_NUTRIENT_METRICS) {
      expect(NUTRIENT_KEYS).toContain(metric);
    }
  });

  it('lists each key exactly once', () => {
    expect(new Set(NUTRIENT_KEYS).size).toBe(NUTRIENT_KEYS.length);
  });
});
