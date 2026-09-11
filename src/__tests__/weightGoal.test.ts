import {
  MAINTAIN_BAND_KG,
  MAX_RATE_KG_PER_WEEK,
  RATE_RANGE,
  daysToTarget,
  goalDirection,
  goalPace,
  goalProgress,
  paceWeightAfterDays,
  parseWeightGoal,
  serializeWeightGoal,
  signedRateKgPerWeek,
  weightSinceGoalStart,
  type WeightGoal,
} from '@/utils/weightGoal';
import type { WeightPoint } from '@/utils/weightLog';

// `weightGoal` reaches `dayKeyToDate`, and `dateUtils` pulls the settings store
// in at module load for `dayResetTime`. Nothing under test reads it — a day key
// parses the same under any reset time — so the store is stubbed rather than
// loaded, the same shape `dateUtils.test.ts` uses for its own import of it.
jest.mock('@/store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

/** A losing goal: 80kg down to 75kg at half a kilo a week, set on Sep 1. */
function losingGoal(overrides: Partial<WeightGoal> = {}): WeightGoal {
  return { startKg: 80, startDayKey: '2026-09-01', targetKg: 75, rateKgPerWeek: 0.5, ...overrides };
}

describe('goalDirection', () => {
  it('reads the direction off the target, not off a stored sign', () => {
    expect(goalDirection(losingGoal())).toBe('lose');
    expect(goalDirection(losingGoal({ targetKg: 85 }))).toBe('gain');
  });

  it('calls a target within a displayed tenth of the start a maintain', () => {
    expect(goalDirection(losingGoal({ targetKg: 80 }))).toBe('maintain');
    expect(goalDirection(losingGoal({ targetKg: 80.04 }))).toBe('maintain');
    expect(goalDirection(losingGoal({ targetKg: 80.2 }))).toBe('gain');
  });
});

describe('signedRateKgPerWeek', () => {
  it('signs the magnitude by the direction', () => {
    expect(signedRateKgPerWeek(losingGoal())).toBe(-0.5);
    expect(signedRateKgPerWeek(losingGoal({ targetKg: 85 }))).toBe(0.5);
  });

  it('ignores a magnitude stored on a maintain goal', () => {
    expect(signedRateKgPerWeek(losingGoal({ targetKg: 80, rateKgPerWeek: 0.5 }))).toBe(0);
  });

  it('never trusts a negative magnitude to mean the direction', () => {
    expect(signedRateKgPerWeek(losingGoal({ rateKgPerWeek: -0.5 }))).toBe(-0.5);
    expect(signedRateKgPerWeek(losingGoal({ targetKg: 85, rateKgPerWeek: -0.5 }))).toBe(0.5);
  });
});

describe('goalProgress', () => {
  it('reports the fraction of the span covered', () => {
    const progress = goalProgress(losingGoal(), 77.5);
    expect(progress.fraction).toBeCloseTo(0.5);
    expect(progress.changedKg).toBeCloseTo(-2.5);
    expect(progress.remainingKg).toBeCloseTo(-2.5);
    expect(progress.reached).toBe(false);
  });

  it('clamps at both ends, so moving away is never a negative bar', () => {
    expect(goalProgress(losingGoal(), 82).fraction).toBe(0);
    expect(goalProgress(losingGoal(), 70).fraction).toBe(1);
  });

  it('keeps the signed change honest even where the fraction is clamped', () => {
    expect(goalProgress(losingGoal(), 82).changedKg).toBeCloseTo(2);
  });

  it('marks a target reached or passed, in either direction', () => {
    expect(goalProgress(losingGoal(), 75).reached).toBe(true);
    expect(goalProgress(losingGoal(), 74).reached).toBe(true);
    expect(goalProgress(losingGoal({ targetKg: 85 }), 86).reached).toBe(true);
    expect(goalProgress(losingGoal({ targetKg: 85 }), 84).reached).toBe(false);
  });

  it('reads a maintain goal as a band rather than a ratio', () => {
    const maintain = losingGoal({ targetKg: 80 });
    expect(goalProgress(maintain, 80).fraction).toBe(1);
    expect(goalProgress(maintain, 80 + MAINTAIN_BAND_KG).reached).toBe(true);
    expect(goalProgress(maintain, 80 + MAINTAIN_BAND_KG + 0.1).reached).toBe(false);
    expect(goalProgress(maintain, 81).fraction).toBe(0);
  });
});

describe('paceWeightAfterDays', () => {
  it('walks the chosen rate forward', () => {
    expect(paceWeightAfterDays(losingGoal(), 0)).toBe(80);
    expect(paceWeightAfterDays(losingGoal(), 7)).toBeCloseTo(79.5);
    expect(paceWeightAfterDays(losingGoal(), 14)).toBeCloseTo(79);
  });

  it('stops on the target rather than continuing through it', () => {
    expect(paceWeightAfterDays(losingGoal(), 70)).toBe(75);
    expect(paceWeightAfterDays(losingGoal(), 700)).toBe(75);
  });

  it('stops on the target for a gaining goal too', () => {
    expect(paceWeightAfterDays(losingGoal({ targetKg: 85 }), 700)).toBe(85);
  });

  it('has nowhere to walk for a maintain goal', () => {
    expect(paceWeightAfterDays(losingGoal({ targetKg: 80 }), 50)).toBe(80);
  });
});

describe('goalPace', () => {
  it('reports the gap against the pace, signed toward the target', () => {
    // Two weeks in, the pace says 79. At 78.5 they are half a kilo further
    // toward the goal than the rate called for.
    const pace = goalPace(losingGoal(), 78.5, new Date(2026, 8, 15));
    expect(pace).not.toBeNull();
    expect(pace!.daysElapsed).toBe(14);
    expect(pace!.paceKg).toBeCloseTo(79);
    expect(pace!.aheadKg).toBeCloseTo(0.5);
  });

  it('signs a gaining goal the same way round', () => {
    const pace = goalPace(losingGoal({ targetKg: 85 }), 81.5, new Date(2026, 8, 15));
    expect(pace!.paceKg).toBeCloseTo(81);
    expect(pace!.aheadKg).toBeCloseTo(0.5);
  });

  it('reports behind as a negative gap', () => {
    const pace = goalPace(losingGoal(), 79.5, new Date(2026, 8, 15));
    expect(pace!.aheadKg).toBeCloseTo(-0.5);
  });

  it('refuses a day before the goal was set', () => {
    expect(goalPace(losingGoal(), 80, new Date(2026, 7, 20))).toBeNull();
  });
});

describe('daysToTarget', () => {
  it('divides what is left by the rate', () => {
    expect(daysToTarget(losingGoal(), 80)).toBe(70);
    expect(daysToTarget(losingGoal(), 77.5)).toBe(35);
  });

  it('has no answer for a maintain goal', () => {
    expect(daysToTarget(losingGoal({ targetKg: 80 }), 80)).toBeNull();
  });

  it('has no answer once the target is reached', () => {
    expect(daysToTarget(losingGoal(), 75)).toBeNull();
    expect(daysToTarget(losingGoal(), 74)).toBeNull();
  });

  it('still projects from the wrong side of the start', () => {
    // Above where they began is further from the target, not past it: the
    // forecast is longer, not withheld.
    expect(daysToTarget(losingGoal(), 82)).toBe(98);
  });
});

describe('weightSinceGoalStart', () => {
  const points: WeightPoint[] = [
    { dayKey: '2026-08-20', kilograms: 84 },
    { dayKey: '2026-08-31', kilograms: 83 },
    { dayKey: '2026-09-03', kilograms: 79 },
    { dayKey: '2026-09-04', kilograms: null },
    { dayKey: '2026-09-08', kilograms: 78.4 },
  ];

  it('takes the last reading on or after the start day', () => {
    expect(weightSinceGoalStart(losingGoal(), points)).toBe(78.4);
  });

  it('ignores readings from before the goal existed', () => {
    expect(weightSinceGoalStart(losingGoal({ startDayKey: '2026-09-20' }), points)).toBeNull();
  });

  it('counts a reading on the start day itself', () => {
    expect(weightSinceGoalStart(losingGoal({ startDayKey: '2026-08-31' }), points.slice(0, 2))).toBe(83);
  });
});

describe('storage', () => {
  it('round-trips a goal', () => {
    const goal = losingGoal();
    expect(parseWeightGoal(serializeWeightGoal(goal))).toEqual(goal);
  });

  it('reads nothing back as no goal', () => {
    expect(parseWeightGoal(null)).toBeNull();
    expect(parseWeightGoal('')).toBeNull();
    expect(parseWeightGoal('not json')).toBeNull();
    expect(parseWeightGoal('[]')).toBeNull();
  });

  it('refuses a goal missing or mangling a weight', () => {
    expect(parseWeightGoal(JSON.stringify({ ...losingGoal(), targetKg: 0 }))).toBeNull();
    expect(parseWeightGoal(JSON.stringify({ ...losingGoal(), startKg: 5000 }))).toBeNull();
    expect(parseWeightGoal(JSON.stringify({ ...losingGoal(), startKg: 'heavy' }))).toBeNull();
  });

  it('refuses a start day that is not one', () => {
    expect(parseWeightGoal(JSON.stringify({ ...losingGoal(), startDayKey: 'yesterday' }))).toBeNull();
    expect(parseWeightGoal(JSON.stringify({ ...losingGoal(), startDayKey: 20260901 }))).toBeNull();
  });

  it('clamps an over-range rate rather than dropping the goal', () => {
    const parsed = parseWeightGoal(JSON.stringify({ ...losingGoal(), rateKgPerWeek: 99 }));
    expect(parsed?.rateKgPerWeek).toBeCloseTo(MAX_RATE_KG_PER_WEEK);
  });

  it('refuses a negative rate, which no writer here produces', () => {
    expect(parseWeightGoal(JSON.stringify({ ...losingGoal(), rateKgPerWeek: -1 }))).toBeNull();
  });
});

describe('RATE_RANGE', () => {
  it('opens each unit on a step of its own grid', () => {
    for (const unit of ['kg', 'lb'] as const) {
      const range = RATE_RANGE[unit];
      expect(range.default).toBeGreaterThanOrEqual(range.min);
      expect(range.default).toBeLessThanOrEqual(range.max);
      expect(Math.round(range.min / range.step)).toBeCloseTo(range.min / range.step);
    }
  });

  it('has no rate of zero, since maintain is said with the target', () => {
    expect(RATE_RANGE.kg.min).toBeGreaterThan(0);
    expect(RATE_RANGE.lb.min).toBeGreaterThan(0);
  });
});
