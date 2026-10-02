import { followedWaterTargetCount } from '../utils/waterTargetUnits';

const task = {
  followWaterTarget: true,
  logHealthMetric: 'waterMl' as const,
  logHealthAmount: 250,
  targetCount: 8,
  quotaPeriod: 'day' as const,
};
const boost = { minExerciseMinutes: 30, boostMl: 500 };

describe('followedWaterTargetCount', () => {
  it('divides the target by the amount one unit logs', () => {
    expect(followedWaterTargetCount(task, 2000, null, null, false)).toBe(8);
  });

  it('rounds up, so a partial last glass is still owed', () => {
    expect(followedWaterTargetCount(task, 2100, null, null, false)).toBe(9);
  });

  it('raises the count when today\'s exercise clears the boost threshold', () => {
    expect(followedWaterTargetCount(task, 2000, 30, boost, true)).toBe(10);
  });

  it('is the base target on a day read with too little exercise', () => {
    expect(followedWaterTargetCount(task, 2000, 10, boost, true)).toBe(8);
  });

  it('is the base target on a day read with nothing recorded', () => {
    expect(followedWaterTargetCount(task, 2000, null, boost, true)).toBe(8);
  });

  it('declines to answer while a configured boost has no reading to judge', () => {
    expect(followedWaterTargetCount(task, 2000, null, boost, false)).toBeNull();
  });

  it('does not need a reading when no boost is configured', () => {
    expect(followedWaterTargetCount(task, 2000, null, null, false)).toBe(8);
  });

  it('declines when the toggle is off', () => {
    expect(followedWaterTargetCount({ ...task, followWaterTarget: false }, 2000, null, null, false)).toBeNull();
  });

  it('declines with no water target set, rather than inventing one', () => {
    expect(followedWaterTargetCount(task, undefined, null, null, false)).toBeNull();
  });

  it('declines for a task that does not log water, or has no amount', () => {
    expect(followedWaterTargetCount({ ...task, logHealthMetric: 'caffeineMg' as never }, 2000, null, null, false)).toBeNull();
    expect(followedWaterTargetCount({ ...task, logHealthAmount: null }, 2000, null, null, false)).toBeNull();
  });

  it('declines for a weekly target and for an ordinary task', () => {
    expect(followedWaterTargetCount({ ...task, quotaPeriod: 'week' as never }, 2000, null, null, false)).toBeNull();
    expect(followedWaterTargetCount({ ...task, targetCount: null }, 2000, null, null, false)).toBeNull();
  });

  it('declines when the answer would be one unit, which is not a target', () => {
    expect(followedWaterTargetCount({ ...task, logHealthAmount: 2000 }, 2000, null, null, false)).toBeNull();
  });

  it('caps at the largest count a target can hold', () => {
    expect(followedWaterTargetCount({ ...task, logHealthAmount: 10 }, 5000, null, null, false)).toBe(99);
  });
});
