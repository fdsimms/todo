import type { FoodLogEntry } from '../types';
import {
  clampSnackNudgeFromHour,
  clampSnackNudgeSharePercent,
  DEFAULT_SNACK_NUDGE_FROM_HOUR,
  DEFAULT_SNACK_NUDGE_SHARE_PERCENT,
  describeSnackNudgeHour,
  loggedKcalToday,
  snackNudgeApplies,
  snackNudgeTitle,
} from '../utils/snackNudgeTasks';

const entry = (calorieKcal?: number): FoodLogEntry => ({
  nutrition: { amounts: calorieKcal === undefined ? {} : { calorieKcal } },
}) as FoodLogEntry;

const at = (hour: number) => new Date(2026, 9, 5, hour, 30);

describe('loggedKcalToday', () => {
  it('sums the calories entries state', () => {
    expect(loggedKcalToday([entry(300), entry(250)])).toBe(550);
  });

  it('is null for an empty log', () => {
    expect(loggedKcalToday([])).toBeNull();
  });

  it('is null when no entry states calories, rather than zero', () => {
    expect(loggedKcalToday([entry(), entry()])).toBeNull();
  });

  it('ignores entries that state none beside ones that do', () => {
    expect(loggedKcalToday([entry(), entry(400)])).toBe(400);
  });
});

describe('snackNudgeApplies', () => {
  it('is true after the hour with the log under half the target', () => {
    expect(snackNudgeApplies(900, 2000, at(DEFAULT_SNACK_NUDGE_FROM_HOUR))).toBe(true);
  });

  it('is false before the hour', () => {
    expect(snackNudgeApplies(900, 2000, at(DEFAULT_SNACK_NUDGE_FROM_HOUR - 1))).toBe(false);
  });

  it('is false at half the target or more', () => {
    expect(snackNudgeApplies(1000, 2000, at(16))).toBe(false);
    expect(snackNudgeApplies(1800, 2000, at(16))).toBe(false);
  });

  it('is false with nothing usable logged', () => {
    expect(snackNudgeApplies(null, 2000, at(16))).toBe(false);
  });

  it('is false with no target set', () => {
    expect(snackNudgeApplies(300, undefined, at(16))).toBe(false);
    expect(snackNudgeApplies(300, 0, at(16))).toBe(false);
  });
});

describe('snackNudgeApplies with the settings', () => {
  it('honors a later start hour', () => {
    expect(snackNudgeApplies(300, 2000, at(15), 17)).toBe(false);
    expect(snackNudgeApplies(300, 2000, at(17), 17)).toBe(true);
  });

  it('honors a different share', () => {
    expect(snackNudgeApplies(1200, 2000, at(16), 15, 50)).toBe(false);
    expect(snackNudgeApplies(1200, 2000, at(16), 15, 70)).toBe(true);
  });
});

describe('the setting clamps', () => {
  it('keeps the hour in range and falls back on nonsense', () => {
    expect(clampSnackNudgeFromHour(3)).toBe(12);
    expect(clampSnackNudgeFromHour(23)).toBe(20);
    expect(clampSnackNudgeFromHour(NaN)).toBe(DEFAULT_SNACK_NUDGE_FROM_HOUR);
  });

  it('snaps the share to its step and keeps it in range', () => {
    expect(clampSnackNudgeSharePercent(47)).toBe(50);
    expect(clampSnackNudgeSharePercent(0)).toBe(10);
    expect(clampSnackNudgeSharePercent(100)).toBe(90);
    expect(clampSnackNudgeSharePercent(NaN)).toBe(DEFAULT_SNACK_NUDGE_SHARE_PERCENT);
  });
});

describe('describeSnackNudgeHour', () => {
  it('reads as a clock time', () => {
    expect(describeSnackNudgeHour(12)).toBe('12 PM');
    expect(describeSnackNudgeHour(15)).toBe('3 PM');
  });
});

describe('snackNudgeTitle', () => {
  it('names the figures it judged by', () => {
    expect(snackNudgeTitle(620, 2000)).toBe('Have a snack (620 of 2,000 kcal logged)');
  });
});
