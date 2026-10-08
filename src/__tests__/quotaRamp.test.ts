import {
  advanceQuotaRamp,
  canRampQuota,
  describeQuotaRamp,
  hasQuotaRamp,
  quotaRampAtGoal,
} from '../utils/quotaRamp';

const ramp = (o: Record<string, unknown> = {}) => ({
  targetCount: 3,
  recurrenceType: 'daily' as const,
  quotaRampStep: 1,
  quotaRampEvery: 1,
  quotaRampGoal: null,
  quotaRampHits: 0,
  ...o,
});

describe('canRampQuota', () => {
  it('accepts a plain repeating count', () => {
    expect(canRampQuota(ramp())).toBe(true);
  });

  it('refuses a task that is not a target', () => {
    expect(canRampQuota(ramp({ targetCount: null }))).toBe(false);
  });

  it('refuses the kinds whose count something else already writes', () => {
    expect(canRampQuota(ramp({ quotaIntervalMinutes: 30 }))).toBe(false);
    expect(canRampQuota(ramp({ followWaterTarget: true }))).toBe(false);
    expect(canRampQuota(ramp({ allowOvershoot: true }))).toBe(false);
    expect(canRampQuota(ramp({ rotationEnabled: true }))).toBe(false);
  });

  it('refuses a target that does not repeat', () => {
    expect(canRampQuota(ramp({ recurrenceType: 'none' }))).toBe(false);
  });
});

describe('advanceQuotaRamp', () => {
  it('adds the step on every hit when the cadence is one', () => {
    expect(advanceQuotaRamp(ramp(), true)).toEqual({ targetCount: 4, quotaRampHits: 0 });
  });

  it('counts hits until the cadence is reached', () => {
    const first = advanceQuotaRamp(ramp({ quotaRampEvery: 3 }), true);
    expect(first).toEqual({ targetCount: 3, quotaRampHits: 1 });
    const third = advanceQuotaRamp(ramp({ quotaRampEvery: 3, quotaRampHits: 2 }), true);
    expect(third).toEqual({ targetCount: 4, quotaRampHits: 0 });
  });

  it('neither steps nor resets after a day that was not a hit', () => {
    expect(advanceQuotaRamp(ramp({ quotaRampEvery: 3, quotaRampHits: 2 }), false))
      .toEqual({ targetCount: 3, quotaRampHits: 2 });
  });

  it('clamps the last step to the goal', () => {
    expect(advanceQuotaRamp(ramp({ targetCount: 9, quotaRampStep: 5, quotaRampGoal: 10 }), true).targetCount).toBe(10);
  });

  it('holds at the goal and keeps the hit count at zero', () => {
    expect(advanceQuotaRamp(ramp({ targetCount: 10, quotaRampGoal: 10, quotaRampHits: 4 }), true))
      .toEqual({ targetCount: 10, quotaRampHits: 0 });
  });

  it('never passes the app maximum when there is no goal', () => {
    expect(advanceQuotaRamp(ramp({ targetCount: 98, quotaRampStep: 5 }), true).targetCount).toBe(99);
  });

  it('does nothing when there is no ramp, or the target cannot ramp', () => {
    expect(advanceQuotaRamp(ramp({ quotaRampStep: null }), true).targetCount).toBe(3);
    expect(advanceQuotaRamp(ramp({ quotaIntervalMinutes: 20 }), true).targetCount).toBe(3);
  });
});

describe('hasQuotaRamp and quotaRampAtGoal', () => {
  it('reads a step as the switch', () => {
    expect(hasQuotaRamp({ quotaRampStep: 2 })).toBe(true);
    expect(hasQuotaRamp({ quotaRampStep: null })).toBe(false);
    expect(hasQuotaRamp({})).toBe(false);
  });

  it('is at goal on or past it', () => {
    expect(quotaRampAtGoal(ramp({ targetCount: 5, quotaRampGoal: 5 }))).toBe(true);
    expect(quotaRampAtGoal(ramp({ targetCount: 4, quotaRampGoal: 5 }))).toBe(false);
  });
});

describe('describeQuotaRamp', () => {
  it('words a daily ramp with a goal', () => {
    expect(describeQuotaRamp({ quotaRampStep: 1, quotaRampEvery: 7, quotaRampGoal: 20, quotaPeriod: 'day' }))
      .toBe('Adds 1 after every 7 days you hit it, up to 20');
  });

  it('words a weekly ramp with no goal', () => {
    expect(describeQuotaRamp({ quotaRampStep: 2, quotaRampEvery: 1, quotaPeriod: 'week' }))
      .toBe('Adds 2 after every week you hit it');
  });

  it('is null when off', () => {
    expect(describeQuotaRamp({ quotaRampStep: null })).toBeNull();
  });
});
