import type { ClassifiedIngredient, PlanCategory } from '../utils/mealPlanGroceries';
import type { MealPlanEntry, MealSlot } from '../types';
import {
  decidableNights,
  describeBareWeek,
  describeWeekDecision,
  describeWeekShopping,
  summarizeWeekShopping,
  weekNights,
} from '../utils/weekPlan';

// weekPlan reaches dateUtils for dayKeyOf, which reaches the settings store for
// dayResetTime — which nothing here needs: a meal plan day key is a calendar
// day and carries no time at all.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;
function entry(
  date: string,
  slot: MealSlot,
  overrides: Partial<MealPlanEntry> = {}
): MealPlanEntry {
  seq += 1;
  return {
    id: `m-${seq}`,
    date,
    slot,
    recipeId: null,
    title: `Meal ${seq}`,
    sortOrder: 1,
    createdAt: `2026-01-01T00:00:0${seq % 10}.000Z`,
    cookedAt: null,
    leftoverId: null,
    recipeChoices: [],
    recipeScale: 1,
    cookTask: null,
    calendarEventId: null,
    ...overrides,
  };
}

// Noon, so nothing here can be pushed onto the neighbouring day by a timezone.
function day(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

// Mon 3 Aug 2026 → Sun 9 Aug 2026.
const WEEK = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']
  .map(day);

function row(category: PlanCategory): ClassifiedIngredient {
  seq += 1;
  return {
    nameKey: `k-${seq}`,
    name: `Item ${seq}`,
    aisle: null,
    quantity: '',
    sources: [],
    category,
    known: category !== 'needToBuy',
    reason: null,
    choiceGroup: null,
    swappedFrom: null,
    sourceRecipeId: null,
    sourceRecipeTitle: null,
  };
}

describe('weekNights', () => {
  it('marks a night open when the anchor slot is empty, whatever else is on the day', () => {
    const entries = [
      entry('2026-08-04', 'breakfast'),
      entry('2026-08-05', 'dinner'),
    ];
    const nights = weekNights(entries, WEEK, '2026-08-03');
    expect(nights.map(n => n.open)).toEqual([true, true, false, true, true, true, true]);
    // The breakfast is still the day's, and still rendered — it just doesn't
    // settle the night.
    expect(nights[1].entries).toHaveLength(1);
  });

  it('marks past and today off the day key, not off the entries', () => {
    const nights = weekNights([], WEEK, '2026-08-06');
    expect(nights.map(n => n.past)).toEqual([true, true, true, false, false, false, false]);
    expect(nights.filter(n => n.today).map(n => n.dayKey)).toEqual(['2026-08-06']);
  });

  it('reads a day in reading order', () => {
    const entries = [
      entry('2026-08-05', 'dinner', { title: 'Chilli' }),
      entry('2026-08-05', 'breakfast', { title: 'Porridge' }),
    ];
    const nights = weekNights(entries, WEEK, '2026-08-03');
    expect(nights[2].entries.map(e => e.title)).toEqual(['Porridge', 'Chilli']);
  });

  it('takes the anchor slot as a parameter', () => {
    const entries = [entry('2026-08-05', 'dinner')];
    expect(weekNights(entries, WEEK, '2026-08-03', 'lunch')[2].open).toBe(true);
  });

  it('has nothing to say about an empty week of days', () => {
    expect(weekNights([entry('2026-08-05', 'dinner')], [], '2026-08-03')).toEqual([]);
  });
});

describe('decidableNights', () => {
  it('drops an open night that has already passed', () => {
    const nights = weekNights([], WEEK, '2026-08-06');
    expect(decidableNights(nights).map(d => d.getDate())).toEqual([6, 7, 8, 9]);
  });

  it('drops a night that is spoken for', () => {
    const entries = [entry('2026-08-07', 'dinner')];
    const nights = weekNights(entries, WEEK, '2026-08-06');
    expect(decidableNights(nights).map(d => d.getDate())).toEqual([6, 8, 9]);
  });

  it('is empty for a week entirely behind the reader', () => {
    expect(decidableNights(weekNights([], WEEK, '2026-08-20'))).toEqual([]);
  });
});

describe('describeWeekDecision', () => {
  it('counts only the nights still to decide', () => {
    expect(describeWeekDecision(weekNights([], WEEK, '2026-08-06'))).toBe('4 nights without a dinner');
  });

  it('says a past week has happened rather than reporting nothing left', () => {
    // Four of these nights never got a dinner; "Every night is planned" would
    // be the untruth this branch exists to avoid.
    expect(describeWeekDecision(weekNights([], WEEK, '2026-08-20'))).toBe('This week has already happened');
  });

  it('inflects a single night', () => {
    const entries = WEEK.slice(0, 6).map((_, i) => entry(`2026-08-0${i + 3}`, 'dinner'));
    expect(describeWeekDecision(weekNights(entries, WEEK, '2026-08-03'))).toBe('1 night without a dinner');
  });

  it('says so when the week is full', () => {
    const entries = WEEK.map((_, i) => entry(`2026-08-0${i + 3}`, 'dinner'));
    expect(describeWeekDecision(weekNights(entries, WEEK, '2026-08-03'))).toBe('Every night is planned');
  });

  it('is empty with no days at all', () => {
    expect(describeWeekDecision([])).toBe('');
  });
});

describe('summarizeWeekShopping', () => {
  it('reads the cart as being on the list', () => {
    const s = summarizeWeekShopping([row('alreadyOnList'), row('inCart'), row('needToBuy')]);
    expect(s).toMatchObject({ needToBuy: 1, onList: 2, probablyHave: 0, staple: 0, total: 3 });
  });

  it('keeps the pantry guess out of every other count', () => {
    const s = summarizeWeekShopping([row('probablyHave'), row('probablyHave'), row('staple')]);
    expect(s).toMatchObject({ needToBuy: 0, onList: 0, probablyHave: 2, staple: 1, total: 3 });
  });
});

describe('describeWeekShopping', () => {
  it('says nothing at all about a week with no ingredients behind it', () => {
    expect(describeWeekShopping(summarizeWeekShopping([]))).toBeNull();
  });

  it('never sums the guess into the facts', () => {
    const rows = [row('needToBuy'), row('needToBuy'), row('alreadyOnList'), row('probablyHave')];
    expect(describeWeekShopping(summarizeWeekShopping(rows))).toEqual({
      lead: '2 ingredients to buy',
      rest: '1 already on your list · 1 you probably have',
    });
  });

  it('leads with the shop being done rather than with a zero', () => {
    expect(describeWeekShopping(summarizeWeekShopping([row('alreadyOnList')]))).toEqual({
      lead: 'Nothing left to buy',
      rest: '1 already on your list',
    });
  });

  it('never names a staple — it is not a decision this week changes', () => {
    expect(describeWeekShopping(summarizeWeekShopping([row('needToBuy'), row('staple'), row('staple')])))
      .toEqual({ lead: '1 ingredient to buy', rest: '' });
  });
});

describe('describeBareWeek', () => {
  it('says nothing once the week holds anything', () => {
    expect(describeBareWeek(1, 0)).toBeNull();
  });

  it('names the recipe box when there is nothing to suggest from', () => {
    expect(describeBareWeek(0, 0)).toContain('add recipes');
  });

  it('just points at the nights once there are recipes', () => {
    expect(describeBareWeek(0, 4)).toBe('Nothing planned this week. Tap a night to plan a meal.');
  });
});
