import {
  effectiveWaterTargetMl,
  parseWaterExerciseBoost,
  serializeWaterExerciseBoost,
  waterExerciseBoostApplies,
  WATER_EXERCISE_BOOST_ML_RANGE,
  WATER_EXERCISE_BOOST_MINUTES_RANGE,
  type WaterExerciseBoost,
} from '../utils/waterExerciseBoost';

const BOOST: WaterExerciseBoost = { minExerciseMinutes: 45, boostMl: 500 };

describe('waterExerciseBoostApplies', () => {
  it('is false with no boost configured', () => {
    expect(waterExerciseBoostApplies(60, null)).toBe(false);
  });

  it('is false on a null reading, never treating absence as a zero', () => {
    expect(waterExerciseBoostApplies(null, BOOST)).toBe(false);
  });

  it('is false below the threshold', () => {
    expect(waterExerciseBoostApplies(44, BOOST)).toBe(false);
  });

  it('is true at and above the threshold', () => {
    expect(waterExerciseBoostApplies(45, BOOST)).toBe(true);
    expect(waterExerciseBoostApplies(90, BOOST)).toBe(true);
  });
});

describe('effectiveWaterTargetMl', () => {
  it('returns undefined when there is no base target, even with the boost cleared', () => {
    expect(effectiveWaterTargetMl(undefined, 90, BOOST)).toBeUndefined();
  });

  it('returns the base target unchanged with no boost configured', () => {
    expect(effectiveWaterTargetMl(2000, 90, null)).toBe(2000);
  });

  it('returns the base target unchanged below the threshold', () => {
    expect(effectiveWaterTargetMl(2000, 30, BOOST)).toBe(2000);
  });

  it('returns the base target unchanged on a null reading', () => {
    expect(effectiveWaterTargetMl(2000, null, BOOST)).toBe(2000);
  });

  it('raises the base target by the boost amount at and above the threshold', () => {
    expect(effectiveWaterTargetMl(2000, 45, BOOST)).toBe(2500);
    expect(effectiveWaterTargetMl(2000, 120, BOOST)).toBe(2500);
  });
});

describe('parseWaterExerciseBoost / serializeWaterExerciseBoost', () => {
  it('round-trips a real boost', () => {
    expect(parseWaterExerciseBoost(serializeWaterExerciseBoost(BOOST))).toEqual(BOOST);
  });

  it('reads a missing or empty value as no boost', () => {
    expect(parseWaterExerciseBoost(null)).toBeNull();
    expect(parseWaterExerciseBoost(undefined)).toBeNull();
    expect(parseWaterExerciseBoost('')).toBeNull();
  });

  it('reads unparseable JSON as no boost rather than throwing', () => {
    expect(parseWaterExerciseBoost('not json')).toBeNull();
  });

  it('rejects a value missing a field', () => {
    expect(parseWaterExerciseBoost(JSON.stringify({ minExerciseMinutes: 45 }))).toBeNull();
  });

  it('clamps a field outside its stepper range rather than rejecting the whole boost', () => {
    const parsed = parseWaterExerciseBoost(JSON.stringify({ minExerciseMinutes: 9999, boostMl: -50 }));
    expect(parsed).toEqual({
      minExerciseMinutes: WATER_EXERCISE_BOOST_MINUTES_RANGE.max,
      boostMl: WATER_EXERCISE_BOOST_ML_RANGE.min,
    });
  });
});
