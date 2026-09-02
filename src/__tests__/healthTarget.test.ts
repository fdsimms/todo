import {
  HEALTH_TARGET_RANGES,
  describeHealthTarget,
  hasHealthTarget,
  healthTargetProgress,
  healthTargetValue,
  isHealthTargetReady,
  type HealthTargetReading,
  type HealthTargetState,
} from '../utils/healthTarget';

const TODAY = '2026-09-02';

function target(over: Partial<HealthTargetState> = {}): HealthTargetState {
  return { healthMetric: 'steps', healthTarget: 8000, ...over };
}

function reading(over: Partial<HealthTargetReading> = {}): HealthTargetReading {
  return { dayKey: TODAY, steps: 4120, sleepHours: 7, ...over };
}

describe('hasHealthTarget', () => {
  it('needs both halves, and a number worth reaching', () => {
    expect(hasHealthTarget(target())).toBe(true);
    expect(hasHealthTarget(target({ healthMetric: null }))).toBe(false);
    expect(hasHealthTarget(target({ healthTarget: null }))).toBe(false);
    expect(hasHealthTarget(target({ healthTarget: 0 }))).toBe(false);
  });
});

describe('healthTargetValue', () => {
  it('reads the metric the task asked for', () => {
    expect(healthTargetValue(target(), reading(), TODAY)).toBe(4120);
    expect(healthTargetValue(target({ healthMetric: 'sleepHours', healthTarget: 8 }), reading(), TODAY)).toBe(7);
  });

  it('refuses a reading from a day that has turned over', () => {
    expect(healthTargetValue(target(), reading({ dayKey: '2026-09-01' }), TODAY)).toBeNull();
  });

  it('answers null when there is no reading at all', () => {
    expect(healthTargetValue(target(), null, TODAY)).toBeNull();
    expect(healthTargetValue(target(), reading({ steps: null }), TODAY)).toBeNull();
  });

  it('says nothing about a task with no target', () => {
    expect(healthTargetValue(target({ healthMetric: null }), reading(), TODAY)).toBeNull();
  });
});

describe('isHealthTargetReady', () => {
  it('is ready at the target and past it', () => {
    expect(isHealthTargetReady(target(), 8000)).toBe(true);
    expect(isHealthTargetReady(target(), 12000)).toBe(true);
  });

  it('is not ready below it', () => {
    expect(isHealthTargetReady(target(), 7999)).toBe(false);
  });

  it('is never ready without a reading', () => {
    // Null covers a refused read, so treating it as zero would be one thing and
    // treating it as *met* would be very much another.
    expect(isHealthTargetReady(target(), null)).toBe(false);
  });

  it('is never ready for a task with no target', () => {
    expect(isHealthTargetReady(target({ healthTarget: null }), 99999)).toBe(false);
  });

  it('is met by reaching, where a rule fires by falling short', () => {
    // The two directions are mirror images on purpose: a target is something to
    // achieve, a rule something to notice.
    expect(isHealthTargetReady(target({ healthTarget: 5000 }), 6000)).toBe(true);
    expect(isHealthTargetReady(target({ healthTarget: 5000 }), 4000)).toBe(false);
  });
});

describe('healthTargetProgress', () => {
  it('runs 0 to 1 and clamps past the end', () => {
    expect(healthTargetProgress(target(), 0)).toBe(0);
    expect(healthTargetProgress(target(), 4000)).toBe(0.5);
    expect(healthTargetProgress(target(), 8000)).toBe(1);
    expect(healthTargetProgress(target(), 20000)).toBe(1);
  });

  it('is empty rather than undefined when nothing is known', () => {
    // A bar has to draw something, and empty is the honest picture.
    expect(healthTargetProgress(target(), null)).toBe(0);
    expect(healthTargetProgress(target({ healthMetric: null }), 4000)).toBe(0);
  });
});

describe('describeHealthTarget', () => {
  it('reads as a fraction of the target', () => {
    expect(describeHealthTarget(target(), 4120)).toBe('4,120 / 8,000 steps');
    expect(describeHealthTarget(target({ healthMetric: 'sleepHours', healthTarget: 8 }), 7))
      .toBe('7 / 8 hrs asleep');
  });

  it('shows a half hour rather than a long decimal', () => {
    expect(describeHealthTarget(target({ healthMetric: 'sleepHours', healthTarget: 8 }), 6.42))
      .toBe('6.5 / 8 hrs asleep');
  });

  it('says nothing at all when the reading has not arrived', () => {
    // "0 / 8,000" is the same figure somebody who refused the read would see,
    // and it would be the app telling them they had walked nowhere.
    expect(describeHealthTarget(target(), null)).toBeNull();
  });

  it('says nothing for a task with no target', () => {
    expect(describeHealthTarget(target({ healthTarget: null }), 4120)).toBeNull();
  });

  it('keeps a genuine zero, which is a reading rather than an absence', () => {
    expect(describeHealthTarget(target(), 0)).toBe('0 / 8,000 steps');
  });
});

describe('HEALTH_TARGET_RANGES', () => {
  it('defaults to a number somebody would set as a goal', () => {
    // A floor and a goal are different numbers, which is why this is not the
    // rules module's table: that one defaults to 3,000 steps as a shortfall bar.
    expect(HEALTH_TARGET_RANGES.steps.default).toBe(8000);
    expect(HEALTH_TARGET_RANGES.sleepHours.default).toBe(8);
  });

  it('keeps every default inside its own range', () => {
    for (const range of Object.values(HEALTH_TARGET_RANGES)) {
      expect(range.default).toBeGreaterThanOrEqual(range.min);
      expect(range.default).toBeLessThanOrEqual(range.max);
      expect(range.default % range.step).toBe(0);
    }
  });
});
