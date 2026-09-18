import {
  ACTIVE_ENERGY_BASELINE_RANGE,
  activeEnergyBoostKcal,
  effectiveCalorieTargetKcal,
  MIN_TYPICAL_ACTIVE_ENERGY_DAYS,
  parseActiveEnergyBoost,
  serializeActiveEnergyBoost,
  snapToBaselineStep,
  typicalActiveEnergyKcal,
  type ActiveEnergyBoost,
} from '../utils/activeEnergyBoost';

const BOOST: ActiveEnergyBoost = { baselineKcal: 500 };

describe('activeEnergyBoostKcal', () => {
  it('is zero with no boost configured', () => {
    expect(activeEnergyBoostKcal(900, null)).toBe(0);
  });

  it('is zero on a null reading, never treating absence as an ordinary day', () => {
    expect(activeEnergyBoostKcal(null, BOOST)).toBe(0);
  });

  it('is zero on a day that has not passed the baseline', () => {
    expect(activeEnergyBoostKcal(500, BOOST)).toBe(0);
    expect(activeEnergyBoostKcal(120, BOOST)).toBe(0);
  });

  it('never goes negative, so a morning reading does not lower the target', () => {
    expect(activeEnergyBoostKcal(0, BOOST)).toBe(0);
  });

  it('adds only what the day burned past the baseline', () => {
    expect(activeEnergyBoostKcal(800, BOOST)).toBe(300);
  });

  it('adds the whole reading when the baseline is zero', () => {
    expect(activeEnergyBoostKcal(640, { baselineKcal: 0 })).toBe(640);
  });

  it('rounds to whole calories', () => {
    expect(activeEnergyBoostKcal(800.4, BOOST)).toBe(300);
  });

  it('refuses a non-finite reading rather than propagating it into a target', () => {
    expect(activeEnergyBoostKcal(Number.NaN, BOOST)).toBe(0);
    expect(activeEnergyBoostKcal(Number.POSITIVE_INFINITY, BOOST)).toBe(0);
  });
});

describe('effectiveCalorieTargetKcal', () => {
  it('returns undefined when no calorie target is set, since a boost is not a target', () => {
    expect(effectiveCalorieTargetKcal(undefined, 900, BOOST)).toBeUndefined();
  });

  it('returns the base target unchanged with no boost configured', () => {
    expect(effectiveCalorieTargetKcal(2000, 900, null)).toBe(2000);
  });

  it('returns the base target unchanged on a null reading', () => {
    expect(effectiveCalorieTargetKcal(2000, null, BOOST)).toBe(2000);
  });

  it('raises the target by the excess on a day of more movement than usual', () => {
    expect(effectiveCalorieTargetKcal(2000, 900, BOOST)).toBe(2400);
  });

  it('leaves an ordinary day alone', () => {
    expect(effectiveCalorieTargetKcal(2000, 480, BOOST)).toBe(2000);
  });
});

describe('parseActiveEnergyBoost', () => {
  it('reads nothing back as off', () => {
    expect(parseActiveEnergyBoost(null)).toBeNull();
    expect(parseActiveEnergyBoost('')).toBeNull();
    expect(parseActiveEnergyBoost(undefined)).toBeNull();
  });

  it('refuses malformed JSON, an array and a missing baseline', () => {
    expect(parseActiveEnergyBoost('{oops')).toBeNull();
    expect(parseActiveEnergyBoost('[]')).toBeNull();
    expect(parseActiveEnergyBoost('{}')).toBeNull();
    expect(parseActiveEnergyBoost('{"baselineKcal":"500"}')).toBeNull();
  });

  it('round-trips a stored boost', () => {
    expect(parseActiveEnergyBoost(serializeActiveEnergyBoost(BOOST))).toEqual(BOOST);
  });

  it('keeps a stored zero baseline, which is a real choice rather than an absence', () => {
    expect(parseActiveEnergyBoost('{"baselineKcal":0}')).toEqual({ baselineKcal: 0 });
  });

  it('clamps a figure outside the range rather than dropping the whole setting', () => {
    expect(parseActiveEnergyBoost('{"baselineKcal":-200}')).toEqual({
      baselineKcal: ACTIVE_ENERGY_BASELINE_RANGE.min,
    });
    expect(parseActiveEnergyBoost('{"baselineKcal":99999}')).toEqual({
      baselineKcal: ACTIVE_ENERGY_BASELINE_RANGE.max,
    });
  });
});

describe('typicalActiveEnergyKcal', () => {
  const days = (...values: (number | null)[]) => values;

  it('withholds an answer below the minimum number of known days', () => {
    expect(typicalActiveEnergyKcal(days(400, 500, 600))).toBeNull();
  });

  it('counts known days only, so a window of mostly nulls still withholds', () => {
    const window = [400, 500, 600, null, null, null, null, null, null, null];
    expect(window.length).toBeGreaterThanOrEqual(MIN_TYPICAL_ACTIVE_ENERGY_DAYS);
    expect(typicalActiveEnergyKcal(window)).toBeNull();
  });

  it('answers with the median once there are enough days', () => {
    expect(typicalActiveEnergyKcal(days(100, 200, 300, 400, 500, 600, 700))).toBe(400);
  });

  it('averages the middle pair on an even count', () => {
    expect(typicalActiveEnergyKcal(days(100, 200, 300, 400, 500, 600, 700, 800))).toBe(450);
  });

  it('is unmoved by one enormous day, which a mean would not be', () => {
    expect(typicalActiveEnergyKcal(days(400, 410, 420, 430, 440, 450, 9000))).toBe(430);
  });

  it('does not depend on the order the days arrive in', () => {
    expect(typicalActiveEnergyKcal(days(700, 100, 500, 300, 600, 200, 400))).toBe(400);
  });

  it('drops null days rather than counting them as zero', () => {
    expect(typicalActiveEnergyKcal(days(400, 400, 400, 400, 400, 400, 400, null, null))).toBe(400);
  });

  it('keeps a genuine zero day, which is a reading rather than an absence', () => {
    expect(typicalActiveEnergyKcal(days(0, 0, 0, 0, 400, 400, 400))).toBe(0);
  });
});

describe('snapToBaselineStep', () => {
  it('lands on a value the stepper can hold', () => {
    expect(snapToBaselineStep(487) % ACTIVE_ENERGY_BASELINE_RANGE.step).toBe(0);
    expect(snapToBaselineStep(487)).toBe(500);
    expect(snapToBaselineStep(474)).toBe(450);
  });

  it('clamps to the range', () => {
    expect(snapToBaselineStep(-50)).toBe(ACTIVE_ENERGY_BASELINE_RANGE.min);
    expect(snapToBaselineStep(50000)).toBe(ACTIVE_ENERGY_BASELINE_RANGE.max);
  });
});
