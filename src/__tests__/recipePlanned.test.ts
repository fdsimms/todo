import { upcomingRecipeMeals, plannedMealLabel, PLANNED_MEAL_LIMIT } from '../utils/recipePlanned';
import type { MealPlanEntry } from '../types';

// dateUtils reaches the settings store, which nothing here needs. Same mock
// as dateUtils.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

function entry(id: string, date: string, slot: MealPlanEntry['slot'] = 'dinner', extra: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return { id, date, slot, recipeId: 'r1', title: 'Roast tomato pasta', leftoverId: null, ...extra } as MealPlanEntry;
}

describe('upcomingRecipeMeals', () => {
  it('keeps today on, soonest first', () => {
    const got = upcomingRecipeMeals(
      [entry('c', '2026-10-09'), entry('past', '2026-10-01'), entry('a', '2026-10-04'), entry('b', '2026-10-06')],
      '2026-10-04',
    );
    expect(got.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('leaves out leftovers, which are a second meal from one cook', () => {
    const got = upcomingRecipeMeals(
      [entry('cook', '2026-10-05'), entry('leftover', '2026-10-06', 'lunch', { leftoverId: 'l1' })],
      '2026-10-04',
    );
    expect(got.map(e => e.id)).toEqual(['cook']);
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: 8 }, (_, i) => entry(`e${i}`, `2026-10-${String(10 + i).padStart(2, '0')}`));
    expect(upcomingRecipeMeals(many, '2026-10-04')).toHaveLength(PLANNED_MEAL_LIMIT);
  });
});

describe('plannedMealLabel', () => {
  const today = '2026-10-04'; // a Sunday

  it('says today and tomorrow in words', () => {
    expect(plannedMealLabel(entry('a', '2026-10-04', 'dinner'), today)).toBe("Today's dinner");
    expect(plannedMealLabel(entry('a', '2026-10-05', 'lunch'), today)).toBe("Tomorrow's lunch");
  });

  it('names the weekday within the week ahead, and the date past it', () => {
    expect(plannedMealLabel(entry('a', '2026-10-06', 'dinner'), today)).toBe('Tue dinner');
    expect(plannedMealLabel(entry('a', '2026-10-14', 'breakfast'), today)).toBe('Oct 14 breakfast');
  });
});
