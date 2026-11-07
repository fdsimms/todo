import type { MealPlanEntry, MealSlot } from '../types';
import { daySkips, skippedLine, skippedSlotsOn, skipStands } from '../utils/mealSkips';

// mealPlan.ts reaches dateUtils and so the settings store; nothing here needs it.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const DAY = '2026-11-07';

function entry(slot: MealSlot, overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: `m-${slot}`, date: DAY, slot, recipeId: null, title: 'Oats', sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z', cookedAt: null, leftoverId: null,
    recipeChoices: [], recipeOverrides: [], recipeScale: 1,
    cookTask: null, shopTask: null, logMeal: null, calendarEventId: null,
    ...overrides,
  };
}

const logRow = { id: 'f' } as never;

describe('skipStands', () => {
  it('stands over nothing, or over a plan not yet eaten', () => {
    expect(skipStands(undefined)).toBe(true);
    expect(skipStands({ planned: [entry('lunch')], logged: [] })).toBe(true);
  });

  it('gives way to food in the log or a meal marked cooked', () => {
    expect(skipStands({ planned: [], logged: [logRow] })).toBe(false);
    expect(skipStands({ planned: [entry('lunch', { cookedAt: '2026-11-07T12:00:00.000Z' })], logged: [] })).toBe(false);
  });
});

describe('skippedSlotsOn', () => {
  it('lists one day in the order of the day', () => {
    const skips = [
      { dayKey: DAY, slot: 'dinner' as const },
      { dayKey: '2026-11-06', slot: 'lunch' as const },
      { dayKey: DAY, slot: 'breakfast' as const },
    ];
    expect(skippedSlotsOn(skips, DAY)).toEqual(['breakfast', 'dinner']);
  });
});

describe('daySkips', () => {
  it('puts a planned slot in its row, an unplanned one on the line, and drops one that was eaten', () => {
    const coverage = new Map<MealSlot, { planned: MealPlanEntry[]; logged: never[] }>([
      ['lunch', { planned: [entry('lunch')], logged: [] }],
      ['dinner', { planned: [], logged: [logRow] }],
    ]);
    const out = daySkips(coverage, ['breakfast', 'lunch', 'dinner']);
    expect([...out.inRows]).toEqual(['lunch']);
    expect(out.unplanned).toEqual(['breakfast']);
  });
});

describe('skippedLine', () => {
  it('names the meals in a sentence', () => {
    expect(skippedLine([])).toBeNull();
    expect(skippedLine(['breakfast'])).toBe('Skipped breakfast');
    expect(skippedLine(['breakfast', 'lunch'])).toBe('Skipped breakfast and lunch');
    expect(skippedLine(['breakfast', 'lunch', 'dinner'])).toBe('Skipped breakfast, lunch and dinner');
  });
});
