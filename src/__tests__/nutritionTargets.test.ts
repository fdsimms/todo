import {
  NUTRITION_TARGET_RANGES,
  describeAgainstTarget,
  parseNutritionTargets,
  serializeNutritionTargets,
  targetProgress,
  targetedNutrients,
} from '../utils/nutritionTargets';
import { NUTRIENT_KEYS } from '../types';

describe('NUTRITION_TARGET_RANGES', () => {
  it('covers every nutrient, so no target is unsettable', () => {
    for (const key of NUTRIENT_KEYS) {
      expect(NUTRITION_TARGET_RANGES[key]).toBeDefined();
    }
  });

  it('opens each stepper on a figure inside its own range', () => {
    for (const key of NUTRIENT_KEYS) {
      const range = NUTRITION_TARGET_RANGES[key];
      expect(range.default >= range.min).toBe(true);
      expect(range.default <= range.max).toBe(true);
      expect(range.step > 0).toBe(true);
    }
  });
});

describe('parseNutritionTargets', () => {
  it('ships empty, because nothing here suggests a figure', () => {
    expect(parseNutritionTargets(null)).toEqual({});
    expect(parseNutritionTargets('')).toEqual({});
    expect(parseNutritionTargets('{}')).toEqual({});
  });

  it('reads what somebody set', () => {
    expect(parseNutritionTargets('{"calorieKcal":2000,"proteinG":60}'))
      .toEqual({ calorieKcal: 2000, proteinG: 60 });
  });

  it('drops a nutrient this build has no unit for', () => {
    expect(parseNutritionTargets('{"unobtainium":5,"proteinG":60}')).toEqual({ proteinG: 60 });
  });

  it('refuses a target of zero or less, which is not a thing to aim at', () => {
    expect(parseNutritionTargets('{"calorieKcal":0,"proteinG":-4}')).toEqual({});
  });

  it('shrugs at a malformed blob rather than failing the settings load', () => {
    expect(parseNutritionTargets('not json')).toEqual({});
    expect(parseNutritionTargets('[1,2]')).toEqual({});
  });

  it('round-trips through its own serializer', () => {
    const targets = { calorieKcal: 2200, fiberG: 30 };
    expect(parseNutritionTargets(serializeNutritionTargets(targets))).toEqual(targets);
  });
});

describe('targetedNutrients', () => {
  it('lists what has a target, in the order a label prints them', () => {
    expect(targetedNutrients({ proteinG: 60, calorieKcal: 2000 }))
      .toEqual(['calorieKcal', 'proteinG']);
  });

  it('is empty for somebody who has set none', () => {
    expect(targetedNutrients({})).toEqual([]);
  });
});

describe('describeAgainstTarget', () => {
  it('reports the number and the target and stops', () => {
    // No "400 left", no encouragement, no verdict. Counts, never a score.
    expect(describeAgainstTarget('calorieKcal', 1840, { calorieKcal: 2000 }))
      .toBe('1,840 of 2,000 cal');
    expect(describeAgainstTarget('proteinG', 42, { proteinG: 60 })).toBe('42 of 60g');
  });

  it('says nothing for a nutrient nothing logged today stated', () => {
    // A day nobody has eaten in has no total, and "0 of 2,000" every morning
    // reads as a scold to somebody who has not eaten and as a bug to everybody
    // else. Same refusal the step row makes.
    expect(describeAgainstTarget('calorieKcal', undefined, { calorieKcal: 2000 })).toBeNull();
  });

  it('says nothing when there is no target to read against', () => {
    expect(describeAgainstTarget('calorieKcal', 1840, {})).toBeNull();
  });

  it('keeps a real zero, which is a stated figure rather than an absence', () => {
    expect(describeAgainstTarget('caffeineMg', 0, { caffeineMg: 400 })).toBe('0 of 400mg');
  });
});

describe('targetProgress', () => {
  it('measures how far through the day is', () => {
    expect(targetProgress('calorieKcal', 1000, { calorieKcal: 2000 })).toBe(0.5);
  });

  it('clamps at the end, since a bar past its own end says nothing more', () => {
    // And this is the one place a reading could be made to look like a
    // failure, which it must not.
    expect(targetProgress('calorieKcal', 4000, { calorieKcal: 2000 })).toBe(1);
  });

  it('draws empty when nothing is known', () => {
    expect(targetProgress('calorieKcal', undefined, { calorieKcal: 2000 })).toBe(0);
    expect(targetProgress('calorieKcal', 1000, {})).toBe(0);
  });
});
