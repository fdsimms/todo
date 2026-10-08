import {
  DEFAULT_FOOD_LOG_PINNED_NUTRIENTS,
  DEFAULT_HEALTH_WRITE_NUTRIENTS,
  NUTRITION_TARGET_RANGES,
  activeLimits,
  describeAgainstTarget,
  describeLimit,
  describeLimitImpact,
  limitImpact,
  limitStatus,
  parseNutritionLimits,
  serializeNutritionLimits,
  parseFoodLogPinnedNutrients,
  parseHealthWriteNutrients,
  parseNutritionTargets,
  serializeFoodLogPinnedNutrients,
  serializeHealthWriteNutrients,
  serializeNutritionTargets,
  targetProgress,
  targetStatus,
  targetedNutrients,
} from '../utils/nutritionTargets';
import { HEALTH_WRITABLE_NUTRIENTS, NUTRIENT_KEYS } from '../types';

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

  it('keeps a target of zero, which is a goal somebody chose, and drops a negative', () => {
    expect(parseNutritionTargets('{"caffeineMg":0,"proteinG":-4}')).toEqual({ caffeineMg: 0 });
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

  it('reads an unstated nutrient as zero when a target is set', () => {
    // A target is something to aim at for the whole day, so a day with
    // nothing logged yet hasn't missed it — it just hasn't been recorded
    // against yet, and the target line should say so rather than disappear.
    expect(describeAgainstTarget('calorieKcal', undefined, { calorieKcal: 2000 }))
      .toBe('0 of 2,000 cal');
  });

  it('says nothing when there is no target to read against', () => {
    expect(describeAgainstTarget('calorieKcal', 1840, {})).toBeNull();
  });

  it('keeps a real zero, which is a stated figure rather than an absence', () => {
    expect(describeAgainstTarget('caffeineMg', 0, { caffeineMg: 400 })).toBe('0 of 400mg');
  });
});

describe('parseFoodLogPinnedNutrients', () => {
  it('defaults to calories and protein for an install that never chose', () => {
    expect(parseFoodLogPinnedNutrients(null)).toEqual(DEFAULT_FOOD_LOG_PINNED_NUTRIENTS);
    expect(parseFoodLogPinnedNutrients(undefined)).toEqual(DEFAULT_FOOD_LOG_PINNED_NUTRIENTS);
  });

  it('keeps a stored empty array empty, since that is a real choice', () => {
    expect(parseFoodLogPinnedNutrients('[]')).toEqual([]);
  });

  it('reads what somebody chose', () => {
    expect(parseFoodLogPinnedNutrients('["fiberG","sodiumMg"]')).toEqual(['fiberG', 'sodiumMg']);
  });

  it('drops a nutrient this build has no unit for, and water', () => {
    expect(parseFoodLogPinnedNutrients('["unobtainium","waterMl","proteinG"]')).toEqual(['proteinG']);
  });

  it('falls back to the default on a malformed or non-array blob', () => {
    expect(parseFoodLogPinnedNutrients('not json')).toEqual(DEFAULT_FOOD_LOG_PINNED_NUTRIENTS);
    expect(parseFoodLogPinnedNutrients('{"calorieKcal":true}')).toEqual(DEFAULT_FOOD_LOG_PINNED_NUTRIENTS);
  });

  it('round-trips through its own serializer', () => {
    const keys = ['fatG', 'sugarG'] as const;
    expect(parseFoodLogPinnedNutrients(serializeFoodLogPinnedNutrients([...keys]))).toEqual(keys);
  });
});

describe('parseHealthWriteNutrients', () => {
  it('defaults to every nutrient Health has a type for, for an install that never chose', () => {
    expect(parseHealthWriteNutrients(null)).toEqual(DEFAULT_HEALTH_WRITE_NUTRIENTS);
    expect(parseHealthWriteNutrients(undefined)).toEqual(DEFAULT_HEALTH_WRITE_NUTRIENTS);
    expect(DEFAULT_HEALTH_WRITE_NUTRIENTS).toEqual(HEALTH_WRITABLE_NUTRIENTS);
    expect(DEFAULT_HEALTH_WRITE_NUTRIENTS).not.toContain('addedSugarG');
  });

  it('drops a nutrient Health has no type for', () => {
    expect(parseHealthWriteNutrients('["transFatG","cholesterolMg","addedSugarG","satFatG"]')).toEqual(['cholesterolMg', 'satFatG']);
  });

  it('keeps a stored empty array empty, since that is a real choice', () => {
    expect(parseHealthWriteNutrients('[]')).toEqual([]);
  });

  it('reads what somebody chose, water included', () => {
    // Unlike the pinned-nutrient selection, water is a real thing to exclude
    // here: it goes through this same write when a food log entry logs one.
    expect(parseHealthWriteNutrients('["fiberG","waterMl"]')).toEqual(['fiberG', 'waterMl']);
  });

  it('drops a nutrient this build has no unit for', () => {
    expect(parseHealthWriteNutrients('["unobtainium","proteinG"]')).toEqual(['proteinG']);
  });

  it('falls back to the default on a malformed or non-array blob', () => {
    expect(parseHealthWriteNutrients('not json')).toEqual(DEFAULT_HEALTH_WRITE_NUTRIENTS);
    expect(parseHealthWriteNutrients('{"calorieKcal":true}')).toEqual(DEFAULT_HEALTH_WRITE_NUTRIENTS);
  });

  it('round-trips through its own serializer', () => {
    const keys = ['fatG', 'sugarG'] as const;
    expect(parseHealthWriteNutrients(serializeHealthWriteNutrients([...keys]))).toEqual(keys);
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

describe('a target of zero', () => {
  it('reads an empty day as met and any amount as over', () => {
    expect(targetStatus('caffeineMg', undefined, { caffeineMg: 0 })).toBe('met');
    expect(targetStatus('caffeineMg', 0, { caffeineMg: 0 })).toBe('met');
    expect(targetStatus('caffeineMg', 80, { caffeineMg: 0 })).toBe('over');
  });

  it('draws a full bar only once something is logged', () => {
    expect(targetProgress('caffeineMg', 0, { caffeineMg: 0 })).toBe(0);
    expect(targetProgress('caffeineMg', 80, { caffeineMg: 0 })).toBe(1);
  });

  it('lets every nutrient, water included, step down to it', () => {
    for (const key of NUTRIENT_KEYS) {
      expect(NUTRITION_TARGET_RANGES[key].min).toBe(0);
    }
  });
});

describe('targetStatus', () => {
  it('reads under for a total well short of the target', () => {
    expect(targetStatus('calorieKcal', 1000, { calorieKcal: 2000 })).toBe('under');
  });

  it('reads over for a total well past the target', () => {
    expect(targetStatus('calorieKcal', 3000, { calorieKcal: 2000 })).toBe('over');
  });

  it('reads met inside the tolerance band on either side, not just on the number itself', () => {
    expect(targetStatus('calorieKcal', 2000, { calorieKcal: 2000 })).toBe('met');
    expect(targetStatus('calorieKcal', 1950, { calorieKcal: 2000 })).toBe('met');
    expect(targetStatus('calorieKcal', 2050, { calorieKcal: 2000 })).toBe('met');
  });

  it('reads under/over right at the edge of the band', () => {
    expect(targetStatus('calorieKcal', 1799, { calorieKcal: 2000 })).toBe('under');
    expect(targetStatus('calorieKcal', 2201, { calorieKcal: 2000 })).toBe('over');
  });

  it('reads under for nothing logged, same as an empty progress bar', () => {
    expect(targetStatus('calorieKcal', undefined, { calorieKcal: 2000 })).toBe('under');
  });

  it('reads under when there is no target, so a caller with no track drawn gets a harmless default', () => {
    expect(targetStatus('calorieKcal', 1840, {})).toBe('under');
  });
});

describe('limits', () => {
  it('ships with none, and reads back what somebody chose in label order', () => {
    expect(parseNutritionLimits(null)).toEqual([]);
    expect(parseNutritionLimits(serializeNutritionLimits(['sugarG', 'satFatG']))).toEqual(['satFatG', 'sugarG']);
  });

  it('drops water, unknown keys and a malformed blob', () => {
    expect(parseNutritionLimits('["waterMl","nope","sodiumMg"]')).toEqual(['sodiumMg']);
    expect(parseNutritionLimits('{')).toEqual([]);
    expect(parseNutritionLimits('{"a":1}')).toEqual([]);
  });

  it('is only active where a target is set', () => {
    expect(activeLimits({ satFatG: 16 }, ['satFatG', 'sugarG'])).toEqual(['satFatG']);
  });

  it('has no met band: anything past the limit is over', () => {
    expect(limitStatus('satFatG', 16.5, { satFatG: 16 })).toBe('over');
    expect(limitStatus('satFatG', 16, { satFatG: 16 })).toBe('near');
    expect(limitStatus('satFatG', 11.9, { satFatG: 16 })).toBe('within');
    expect(limitStatus('satFatG', 12, { satFatG: 16 })).toBe('near');
    expect(limitStatus('satFatG', 12, { satFatG: 16 }, 90)).toBe('within');
    expect(limitStatus('satFatG', undefined, { satFatG: 16 })).toBe('within');
  });

  it('reads a limit of zero as passed by any amount', () => {
    expect(limitStatus('caffeineMg', 0, { caffeineMg: 0 })).toBe('within');
    expect(limitStatus('caffeineMg', 5, { caffeineMg: 0 })).toBe('over');
  });

  it('says what is left, or how far over', () => {
    expect(describeLimit('satFatG', 12, { satFatG: 16 })).toBe('4g left');
    expect(describeLimit('satFatG', 19.25, { satFatG: 16 })).toBe('3.3g over');
    expect(describeLimit('satFatG', 16, { satFatG: 16 })).toBe('At the limit');
    expect(describeLimit('calorieKcal', 1500, { calorieKcal: 2000 })).toBe('500 cal left');
    expect(describeLimit('satFatG', 12, {})).toBeNull();
  });
});

describe('limitImpact', () => {
  const targets = { satFatG: 16, sugarG: 35, proteinG: 150 };
  const limits = ['satFatG', 'sugarG'] as const;

  it('reports only the limits the entry states', () => {
    const impacts = limitImpact({ satFatG: 5, proteinG: 20 }, { satFatG: 4, sugarG: 30 }, targets, [...limits]);
    expect(impacts).toEqual([{ key: 'satFatG', after: 9, target: 16, status: 'within', crosses: false }]);
  });

  it('marks the entry that takes the day past a limit', () => {
    const [impact] = limitImpact({ satFatG: 6 }, { satFatG: 12 }, targets, [...limits]);
    expect(impact).toMatchObject({ after: 18, status: 'over', crosses: true });
    expect(describeLimitImpact(impact)).toBe('Puts you at 18 of 16g saturated fat, 2g over');
  });

  it('does not call a day already over a crossing', () => {
    const [impact] = limitImpact({ sugarG: 5 }, { sugarG: 40 }, targets, [...limits]);
    expect(impact).toMatchObject({ status: 'over', crosses: false });
  });

  it('ignores a stated zero and an unset target', () => {
    expect(limitImpact({ satFatG: 0 }, {}, targets, [...limits])).toEqual([]);
    expect(limitImpact({ sodiumMg: 900 }, {}, targets, ['sodiumMg'])).toEqual([]);
  });

  it('reads plainly below the limit', () => {
    const [impact] = limitImpact({ sugarG: 10 }, { sugarG: 5 }, targets, [...limits]);
    expect(describeLimitImpact(impact)).toBe('Puts you at 15 of 35g total sugars');
  });
});
