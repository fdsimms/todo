import type { Task } from '../types';

// dateUtils reads the day reset time from the settings store, which reaches the
// database; a fixed midnight reset is all these tests need.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

import {
  followedWaterTaskDoneOn,
  waterShortfallMl,
  waterShortfallTitle,
} from '../utils/waterShortfallTasks';

const done = (overrides: Partial<Task> = {}) => ({
  followWaterTarget: true,
  completed: true,
  archived: false,
  completedAt: new Date(2026, 9, 2, 15).toISOString(),
  logHealthMetric: 'waterMl',
  ...overrides,
}) as Task;

describe('waterShortfallMl', () => {
  it('is what the total sits below the target, rounded up to one step', () => {
    expect(waterShortfallMl(2500, 2000)).toBe(500);
    expect(waterShortfallMl(2500, 2100)).toBe(500);
    expect(waterShortfallMl(2500, 2250)).toBe(250);
  });

  it('is null at or past the target', () => {
    expect(waterShortfallMl(2000, 2000)).toBeNull();
    expect(waterShortfallMl(2000, 2600)).toBeNull();
  });

  it('is null for a gap smaller than one step', () => {
    expect(waterShortfallMl(2000, 1900)).toBeNull();
  });

  it('is null with no target set', () => {
    expect(waterShortfallMl(undefined, 0)).toBeNull();
    expect(waterShortfallMl(0, 0)).toBeNull();
  });
});

describe('waterShortfallTitle', () => {
  it('names the amount in the unit the person reads water in', () => {
    expect(waterShortfallTitle(500, 'ml')).toBe('Drink 500 ml more water');
    expect(waterShortfallTitle(500, 'flOz')).toBe('Drink 17 fl oz more water');
  });
});

describe('followedWaterTaskDoneOn', () => {
  it('is true for a followed water task completed that day', () => {
    expect(followedWaterTaskDoneOn([done()], '2026-10-02')).toBe(true);
  });

  it('is false for one completed another day', () => {
    expect(followedWaterTaskDoneOn([done()], '2026-10-03')).toBe(false);
  });

  it('is false while the task is still open', () => {
    expect(followedWaterTaskDoneOn([done({ completed: false, completedAt: null })], '2026-10-02')).toBe(false);
  });

  it('is false for a task that does not follow the target', () => {
    expect(followedWaterTaskDoneOn([done({ followWaterTarget: false })], '2026-10-02')).toBe(false);
  });
});
