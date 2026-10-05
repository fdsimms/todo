import type { FoodLogEntry } from '../types';
import {
  loggedKcalToday,
  snackNudgeApplies,
  snackNudgeTitle,
  SNACK_NUDGE_FROM_HOUR,
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
    expect(snackNudgeApplies(900, 2000, at(SNACK_NUDGE_FROM_HOUR))).toBe(true);
  });

  it('is false before the hour', () => {
    expect(snackNudgeApplies(900, 2000, at(SNACK_NUDGE_FROM_HOUR - 1))).toBe(false);
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

describe('snackNudgeTitle', () => {
  it('names the figures it judged by', () => {
    expect(snackNudgeTitle(620, 2000)).toBe('Have a snack (620 of 2,000 kcal logged)');
  });
});
