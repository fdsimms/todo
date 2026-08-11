import type { MealPlanEntry, MealSlot, Recipe } from '../types';
import {
  cleanMealTitle,
  dayKeyRange,
  defaultPlanningDay,
  describeAddedToList,
  describeWeekPlan,
  describeWeekRange,
  entriesForDay,
  entriesForSlot,
  isKeyInRange,
  mealPlanPurgeCutoffKey,
  nextSortOrder,
  recipeIndex,
  resolveBulkMoveTargets,
  selectTodayMealEntries,
  slotLabel,
  slotRank,
  sortMealEntries,
  titleForEntry,
} from '../utils/mealPlan';

// mealPlan reaches dateUtils for dayKeyOf, which reaches the settings store for
// dayResetTime — which nothing here needs, since a day key is a calendar day
// and carries no time at all.
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
    ...overrides,
  };
}

function recipe(id: string, name: string): Recipe {
  return {
    id,
    name,
    nameKey: name.toLowerCase(),
    notes: '',
    sourceUrl: null,
    sourceName: null,
    author: null,
    source: null,
    servings: null,
    servingsMax: null,
    recipeYield: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients: [],
    components: [],
    prepTasks: [],
    favorite: false,
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    sourceType: null,
    sourcePage: null,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
  };
}

beforeEach(() => { seq = 0; });

describe('slotRank', () => {
  it('orders the day', () => {
    expect(slotRank('breakfast')).toBeLessThan(slotRank('lunch'));
    expect(slotRank('lunch')).toBeLessThan(slotRank('dinner'));
    expect(slotRank('dinner')).toBeLessThan(slotRank('snack'));
  });

  // A row the reader doesn't understand — a restored backup from a build with
  // more slots — must not push breakfast down the day.
  it('sorts an unknown slot last rather than first', () => {
    expect(slotRank('brunch' as MealSlot)).toBeGreaterThan(slotRank('snack'));
  });
});

describe('slotLabel', () => {
  it('names each slot', () => {
    expect(slotLabel('breakfast')).toBe('Breakfast');
    expect(slotLabel('snack')).toBe('Snack');
  });

  it('falls back rather than rendering undefined', () => {
    expect(slotLabel('brunch' as MealSlot)).toBe('Meal');
  });
});

describe('sortMealEntries', () => {
  it('orders by day, then down the day, then within the meal', () => {
    const a = entry('2026-08-05', 'dinner', { sortOrder: 2 });
    const b = entry('2026-08-05', 'dinner', { sortOrder: 1 });
    const c = entry('2026-08-05', 'breakfast');
    const d = entry('2026-08-04', 'snack');

    expect(sortMealEntries([a, b, c, d]).map(e => e.id)).toEqual([d.id, c.id, b.id, a.id]);
  });

  it('breaks a sortOrder tie on createdAt so the order is stable', () => {
    const later = entry('2026-08-05', 'dinner', { createdAt: '2026-08-01T10:00:00.000Z' });
    const earlier = entry('2026-08-05', 'dinner', { createdAt: '2026-08-01T09:00:00.000Z' });
    expect(sortMealEntries([later, earlier]).map(e => e.id)).toEqual([earlier.id, later.id]);
  });

  it('does not mutate its input', () => {
    const entries = [entry('2026-08-05', 'dinner'), entry('2026-08-04', 'lunch')];
    const before = entries.map(e => e.id);
    sortMealEntries(entries);
    expect(entries.map(e => e.id)).toEqual(before);
  });

  it('sorts day keys by date rather than by string length', () => {
    // Zero-padding is what makes a lexical sort correct — "2026-08-09" before
    // "2026-08-10" only works because the day is two digits.
    const ninth = entry('2026-08-09', 'dinner');
    const tenth = entry('2026-08-10', 'dinner');
    expect(sortMealEntries([tenth, ninth]).map(e => e.date)).toEqual(['2026-08-09', '2026-08-10']);
  });
});

describe('entriesForDay / entriesForSlot', () => {
  const week = [
    entry('2026-08-05', 'dinner', { sortOrder: 2 }),
    entry('2026-08-05', 'dinner', { sortOrder: 1 }),
    entry('2026-08-05', 'breakfast'),
    entry('2026-08-06', 'dinner'),
  ];

  it('takes only the day asked for, in reading order', () => {
    const day = entriesForDay(week, '2026-08-05');
    expect(day).toHaveLength(3);
    expect(day[0].slot).toBe('breakfast');
    expect(day.map(e => e.sortOrder)).toEqual([1, 1, 2]);
  });

  it('returns nothing for an unplanned day', () => {
    expect(entriesForDay(week, '2026-08-07')).toEqual([]);
  });

  // Two things on one dinner is real — chicken *and* a salad — which is why
  // there is no UNIQUE(date, slot).
  it('returns every entry in a slot, not just the first', () => {
    expect(entriesForSlot(week, '2026-08-05', 'dinner')).toHaveLength(2);
    expect(entriesForSlot(week, '2026-08-05', 'lunch')).toEqual([]);
  });
});

describe('nextSortOrder', () => {
  it('lands a new entry at the end of its slot', () => {
    const entries = [
      entry('2026-08-05', 'dinner', { sortOrder: 1 }),
      entry('2026-08-05', 'dinner', { sortOrder: 4 }),
    ];
    expect(nextSortOrder(entries, '2026-08-05', 'dinner')).toBe(5);
  });

  it('starts at 1 in an empty slot', () => {
    expect(nextSortOrder([], '2026-08-05', 'dinner')).toBe(1);
  });

  it('is scoped to the slot, not to the day', () => {
    const entries = [entry('2026-08-05', 'breakfast', { sortOrder: 9 })];
    expect(nextSortOrder(entries, '2026-08-05', 'dinner')).toBe(1);
  });

  it('is scoped to the day, not to the whole plan', () => {
    const entries = [entry('2026-08-04', 'dinner', { sortOrder: 9 })];
    expect(nextSortOrder(entries, '2026-08-05', 'dinner')).toBe(1);
  });
});

describe('resolveBulkMoveTargets', () => {
  it('moves every named entry to the new day, keeping each one\'s own slot', () => {
    const a = entry('2026-08-05', 'dinner');
    const b = entry('2026-08-05', 'breakfast');
    const targets = resolveBulkMoveTargets([a, b], [a.id, b.id], { date: '2026-08-07' });

    expect(targets).toEqual([
      { id: a.id, date: '2026-08-07', slot: 'dinner' },
      { id: b.id, date: '2026-08-07', slot: 'breakfast' },
    ]);
  });

  it('changes only the slot, keeping each entry\'s own day, when no date is given', () => {
    const a = entry('2026-08-05', 'dinner');
    const b = entry('2026-08-06', 'dinner');
    const targets = resolveBulkMoveTargets([a, b], [a.id, b.id], { slot: 'lunch' });

    expect(targets).toEqual([
      { id: a.id, date: '2026-08-05', slot: 'lunch' },
      { id: b.id, date: '2026-08-06', slot: 'lunch' },
    ]);
  });

  it('sets both when both are given', () => {
    const a = entry('2026-08-05', 'dinner');
    const targets = resolveBulkMoveTargets([a], [a.id], { date: '2026-08-07', slot: 'lunch' });
    expect(targets).toEqual([{ id: a.id, date: '2026-08-07', slot: 'lunch' }]);
  });

  it('only touches the named ids', () => {
    const a = entry('2026-08-05', 'dinner');
    const untouched = entry('2026-08-05', 'lunch');
    const targets = resolveBulkMoveTargets([a, untouched], [a.id], { date: '2026-08-07' });
    expect(targets).toEqual([{ id: a.id, date: '2026-08-07', slot: 'dinner' }]);
  });

  it('drops an entry that would land exactly where it already is', () => {
    const a = entry('2026-08-05', 'dinner');
    const targets = resolveBulkMoveTargets([a], [a.id], { date: '2026-08-05', slot: 'dinner' });
    expect(targets).toEqual([]);
  });

  it('is a no-op when neither date nor slot is given', () => {
    const a = entry('2026-08-05', 'dinner');
    expect(resolveBulkMoveTargets([a], [a.id], {})).toEqual([]);
  });

  it('returns nothing for an id it does not hold', () => {
    expect(resolveBulkMoveTargets([], ['gone'], { date: '2026-08-07' })).toEqual([]);
  });
});

describe('cleanMealTitle', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanMealTitle('  Sausage   ragù ')).toBe('Sausage ragù');
  });

  it('reads an empty or blank input as "not a name"', () => {
    expect(cleanMealTitle('')).toBe('');
    expect(cleanMealTitle('   ')).toBe('');
  });

  it('caps a long one', () => {
    expect(cleanMealTitle('x'.repeat(200))).toHaveLength(80);
  });
});

describe('titleForEntry', () => {
  const ragu = recipe('r1', 'Sausage ragù');
  const index = recipeIndex([ragu]);

  it('prefers the live recipe name, so a rename follows through onto the plan', () => {
    const planned = entry('2026-08-05', 'dinner', { recipeId: 'r1', title: 'Old name' });
    expect(titleForEntry(planned, index)).toBe('Sausage ragù');
  });

  // No cascade on recipe_id is deliberate: deleting a recipe must not blank
  // last Tuesday.
  it('falls back to the captured title when the recipe is gone', () => {
    const planned = entry('2026-08-05', 'dinner', { recipeId: 'deleted', title: 'Sausage ragù' });
    expect(titleForEntry(planned, index)).toBe('Sausage ragù');
  });

  it('uses the typed title for a free-text meal', () => {
    const planned = entry('2026-08-05', 'dinner', { recipeId: null, title: 'Leftovers' });
    expect(titleForEntry(planned, index)).toBe('Leftovers');
  });
});

describe('dayKeyRange', () => {
  it('spans the first and last day', () => {
    const days = [new Date(2026, 7, 3), new Date(2026, 7, 6), new Date(2026, 7, 9)];
    expect(dayKeyRange(days)).toEqual({ startKey: '2026-08-03', endKey: '2026-08-09' });
  });

  // The caller passes whatever buildWeekDays handed back; a range read that
  // quietly depended on that array being sorted would break the day something
  // reorders it.
  it('takes the min and max rather than the first and last', () => {
    const days = [new Date(2026, 7, 9), new Date(2026, 7, 3)];
    expect(dayKeyRange(days)).toEqual({ startKey: '2026-08-03', endKey: '2026-08-09' });
  });

  it('is null for no days at all', () => {
    expect(dayKeyRange([])).toBeNull();
  });
});

describe('defaultPlanningDay', () => {
  it('picks today when the week on screen includes it', () => {
    const days = [new Date(2026, 7, 10), new Date(2026, 7, 11), new Date(2026, 7, 12)];
    expect(defaultPlanningDay(days, new Date(2026, 7, 11, 9, 30))).toBe('2026-08-11');
  });

  it('falls back to the first day once paging has moved off the current week', () => {
    const nextWeek = [new Date(2026, 7, 17), new Date(2026, 7, 18), new Date(2026, 7, 19)];
    expect(defaultPlanningDay(nextWeek, new Date(2026, 7, 11))).toBe('2026-08-17');
  });

  it('is null for no days at all', () => {
    expect(defaultPlanningDay([], new Date(2026, 7, 11))).toBeNull();
  });
});

describe('isKeyInRange', () => {
  it('includes both ends', () => {
    expect(isKeyInRange('2026-08-03', '2026-08-03', '2026-08-09')).toBe(true);
    expect(isKeyInRange('2026-08-09', '2026-08-03', '2026-08-09')).toBe(true);
  });

  it('excludes what falls outside', () => {
    expect(isKeyInRange('2026-08-02', '2026-08-03', '2026-08-09')).toBe(false);
    expect(isKeyInRange('2026-08-10', '2026-08-03', '2026-08-09')).toBe(false);
  });

  it('compares by date across a month boundary', () => {
    expect(isKeyInRange('2026-08-01', '2026-07-28', '2026-08-03')).toBe(true);
    expect(isKeyInRange('2026-09-01', '2026-07-28', '2026-08-03')).toBe(false);
  });
});

describe('selectTodayMealEntries', () => {
  const todayKey = '2026-08-11';

  it('is null when nothing has been loaded yet', () => {
    expect(selectTodayMealEntries([], null, null, todayKey)).toBeNull();
  });

  it('is null when the loaded window does not cover today', () => {
    const entries = [entry('2026-08-18', 'dinner')];
    expect(selectTodayMealEntries(entries, '2026-08-17', '2026-08-23', todayKey)).toBeNull();
  });

  it('is an empty array when today is loaded but nothing is planned', () => {
    const entries = [entry('2026-08-10', 'dinner'), entry('2026-08-12', 'dinner')];
    expect(selectTodayMealEntries(entries, '2026-08-10', '2026-08-16', todayKey)).toEqual([]);
  });

  it('returns only today\'s entries, ordered by slot', () => {
    const dinner = entry(todayKey, 'dinner');
    const breakfast = entry(todayKey, 'breakfast');
    const lunch = entry(todayKey, 'lunch');
    const otherDay = entry('2026-08-12', 'breakfast');
    const entries = [dinner, breakfast, otherDay, lunch];
    expect(selectTodayMealEntries(entries, '2026-08-10', '2026-08-16', todayKey)).toEqual([
      breakfast,
      lunch,
      dinner,
    ]);
  });

  it('includes today when it sits exactly on either edge of the range', () => {
    const meal = entry(todayKey, 'lunch');
    expect(selectTodayMealEntries([meal], todayKey, '2026-08-16', todayKey)).toEqual([meal]);
    expect(selectTodayMealEntries([meal], '2026-08-10', todayKey, todayKey)).toEqual([meal]);
  });
});

describe('describeWeekPlan', () => {
  it('says nothing is planned rather than "0 meals"', () => {
    expect(describeWeekPlan([])).toBe('Nothing planned yet');
  });

  it('counts entries, singular and plural', () => {
    expect(describeWeekPlan([entry('2026-08-05', 'dinner')])).toBe('1 meal planned');
    expect(describeWeekPlan([
      entry('2026-08-05', 'dinner'),
      entry('2026-08-06', 'dinner'),
    ])).toBe('2 meals planned');
  });

  // "Leftovers" is a plan. A count that quietly ignored it would tell the user
  // their week is emptier than it is.
  it('counts a free-text meal exactly like a recipe-backed one', () => {
    expect(describeWeekPlan([
      entry('2026-08-05', 'dinner', { recipeId: 'r1' }),
      entry('2026-08-06', 'dinner', { recipeId: null, title: 'Leftovers' }),
    ])).toBe('2 meals planned');
  });
});

describe('describeWeekRange', () => {
  const week = (y: number, m: number, d: number) =>
    Array.from({ length: 7 }, (_, i) => new Date(y, m, d + i));

  it('drops the repeated month inside one month', () => {
    expect(describeWeekRange(week(2026, 7, 3))).toBe('3 – 9 Aug');
  });

  it('names both months across a month boundary', () => {
    expect(describeWeekRange(week(2026, 6, 28))).toBe('28 Jul – 3 Aug');
  });

  // The year is the one thing you can't read off the rest of the screen when a
  // week straddles New Year.
  it('adds the year only across a year boundary', () => {
    expect(describeWeekRange(week(2026, 11, 28))).toBe('28 Dec – 3 Jan 2027');
  });

  it('is empty for no days', () => {
    expect(describeWeekRange([])).toBe('');
  });

  it('does not depend on the order it is given', () => {
    const days = week(2026, 7, 3);
    expect(describeWeekRange([...days].reverse())).toBe('3 – 9 Aug');
  });
});

describe('mealPlanPurgeCutoffKey', () => {
  it('is the day key `days` before now', () => {
    expect(mealPlanPurgeCutoffKey(new Date(2026, 7, 8), 180)).toBe('2026-02-09');
  });

  it('defaults to the 180-day horizon', () => {
    expect(mealPlanPurgeCutoffKey(new Date(2026, 7, 8)))
      .toBe(mealPlanPurgeCutoffKey(new Date(2026, 7, 8), 180));
  });

  // Anchored to the calendar day, so it takes the same rows whenever in the day
  // the app happens to be opened — the rows it judges carry no time at all.
  it('ignores the time of day', () => {
    expect(mealPlanPurgeCutoffKey(new Date(2026, 7, 8, 0, 0, 1), 30))
      .toBe(mealPlanPurgeCutoffKey(new Date(2026, 7, 8, 23, 59, 59), 30));
  });
});

describe('describeAddedToList', () => {
  // Wednesday, so "days back" within the same Sunday-first week actually
  // lands on different days rather than rolling into the previous one.
  const now = new Date(2026, 7, 12);

  it('says today and yesterday', () => {
    expect(describeAddedToList(new Date(2026, 7, 12, 9).toISOString(), now))
      .toBe('Added to list today');
    expect(describeAddedToList(new Date(2026, 7, 11, 9).toISOString(), now))
      .toBe('Added to list yesterday');
  });

  it('names the weekday for anything else in the same week, including its first day', () => {
    expect(describeAddedToList(new Date(2026, 7, 10).toISOString(), now, 0))
      .toBe('Added to list on Monday');
    expect(describeAddedToList(new Date(2026, 7, 9).toISOString(), now, 0))
      .toBe('Added to list on Sunday');
  });

  it('respects weekStartsOn', () => {
    // Sunday Aug 9 2026: inside the Sun-Sat week `now` (Wed Aug 12) falls in
    // when weeks start Sunday, but it's the *last* day of the *previous*
    // Mon-Sun week when they start Monday — so the same instant reads as a
    // weekday name under one flag and a calendar date under the other.
    const sun = new Date(2026, 7, 9);
    expect(describeAddedToList(sun.toISOString(), now, 0)).toBe('Added to list on Sunday');
    expect(describeAddedToList(sun.toISOString(), now, 1)).toBe('Added to list on Aug 9');
  });

  it('falls back to a calendar date once it is out of the week, with a year suffix across one', () => {
    expect(describeAddedToList(new Date(2026, 7, 8).toISOString(), now, 0))
      .toBe('Added to list on Aug 8');
    expect(describeAddedToList(new Date(2025, 11, 20).toISOString(), new Date(2026, 0, 5)))
      .toBe('Added to list on Dec 20, 2025');
  });
});
