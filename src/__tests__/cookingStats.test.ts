import {
  cookingWindow,
  hasCookingData,
  leftoverHistoryIn,
  leftoversFinishedIn,
  mealCookCounts,
  mostCookedRecipes,
  type CookingWindow,
} from '../utils/cookingStats';
import type { Leftover, MealPlanEntry, MealSlot, Recipe } from '../types';

// cookingStats reaches dateUtils for dayKeyOf, which reaches the settings store
// for dayResetTime — which nothing here needs, since every date it compares is a
// calendar day key. Same stub mealPlan.test.ts / leftovers.test.ts use.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

// A fixed Thursday, so a run at 23:59 is the same test as a run at noon.
const TODAY = new Date(2026, 7, 13, 15, 0, 0);
const WINDOW = cookingWindow(TODAY, 30);

let seq = 0;

function entry(date: string, overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  seq += 1;
  return {
    id: `m-${seq}`,
    date,
    slot: 'dinner' as MealSlot,
    recipeId: null,
    title: `Meal ${seq}`,
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookedAt: null,
    leftoverId: null,
    recipeChoices: [],
    recipeScale: 1,
    cookTask: null,
    shopTask: null,
    logMeal: null,
    calendarEventId: null,
    ...overrides,
  };
}

/** Shorthand: an entry on that day, marked cooked. */
function cooked(date: string, overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return entry(date, { cookedAt: `${date}T19:30:00.000Z`, ...overrides });
}

function leftover(overrides: Partial<Leftover> = {}): Leftover {
  seq += 1;
  return {
    id: `lo-${seq}`,
    title: 'Chilli',
    recipeId: null,
    sourceEntryId: null,
    storedAt: '2026-08-01T09:00:00.000Z',
    keepUntil: '2026-08-04',
    finishedAt: null,
    outcome: null,
    frozenAt: null,
    weightG: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    useUpTask: null,
    ...overrides,
  };
}

function recipe(name: string, overrides: Partial<Recipe> = {}): Recipe {
  seq += 1;
  return {
    backfillDismissedFields: [],
    id: `r-${seq}`,
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
    cookedWeightG: null,
    leftoverKeepDays: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients: [],
    emptySections: [],
    emptyStepSections: [],
    components: [],
    prepTasks: [],
    steps: [],
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
    upNext: false,
    upNextOrder: 0,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    sourceType: null,
    sourcePage: null,
    cookbookId: null,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
    ...overrides,
  };
}

describe('cookingWindow', () => {
  it('ends on the day it is handed and spans that day inclusively', () => {
    expect(WINDOW).toEqual({
      startKey: '2026-07-15',
      endKey: '2026-08-13',
      todayKey: '2026-08-13',
    });
    expect(mealCookCounts([], WINDOW).days).toBe(30);
  });

  it('a one-day window is a single day, not an empty one', () => {
    const single = cookingWindow(TODAY, 1);
    expect(single.startKey).toBe('2026-08-13');
    expect(mealCookCounts([], single).days).toBe(1);
  });

  it('never builds a backwards window from a nonsense span', () => {
    expect(cookingWindow(TODAY, 0).startKey).toBe('2026-08-13');
  });
});

describe('mealCookCounts', () => {
  it('is all zeroes for no entries', () => {
    expect(mealCookCounts([], WINDOW)).toEqual({
      days: 30,
      daysCooked: 0,
      planned: 0,
      plannedCooked: 0,
    });
  });

  it('counts planned meals on days that have passed, and how many were cooked', () => {
    const counts = mealCookCounts(
      [cooked('2026-08-10'), entry('2026-08-11'), cooked('2026-08-12')],
      WINDOW
    );
    expect(counts.planned).toBe(3);
    expect(counts.plannedCooked).toBe(2);
  });

  it("excludes today's meals from the denominator — tonight isn't a meal you failed to cook", () => {
    const counts = mealCookCounts([entry('2026-08-13'), entry('2026-08-12')], WINDOW);
    expect(counts.planned).toBe(1);
  });

  it('excludes meals planned for days still ahead', () => {
    const counts = mealCookCounts([entry('2026-08-20'), entry('2026-08-12')], WINDOW);
    expect(counts.planned).toBe(1);
  });

  it("still counts today's cooking as a day cooked", () => {
    const counts = mealCookCounts([cooked('2026-08-13')], WINDOW);
    expect(counts.daysCooked).toBe(1);
    expect(counts.planned).toBe(0);
    expect(counts.plannedCooked).toBe(0);
  });

  it('counts a day once however many meals on it were cooked', () => {
    const counts = mealCookCounts(
      [cooked('2026-08-10', { slot: 'lunch' }), cooked('2026-08-10'), cooked('2026-08-09')],
      WINDOW
    );
    expect(counts.daysCooked).toBe(2);
  });

  it('ignores entries outside the window on either side', () => {
    const counts = mealCookCounts(
      [cooked('2026-07-14'), cooked('2026-07-15'), cooked('2026-08-12')],
      WINDOW
    );
    expect(counts.daysCooked).toBe(2);
    expect(counts.planned).toBe(2);
  });

  it('does not count a meal eaten from leftovers as cooking', () => {
    // Chili from the fridge card on Wednesday, ticked because it was eaten.
    // It is not a day cooked, and not a planned meal that was or wasn't cooked.
    const counts = mealCookCounts(
      [
        cooked('2026-08-10', { leftoverId: 'lo-1', title: 'Chili (leftovers)' }),
        entry('2026-08-11', { leftoverId: 'lo-2' }),
        cooked('2026-08-12', { recipeId: 'r-1' }),
      ],
      WINDOW
    );
    expect(counts.daysCooked).toBe(1);
    expect(counts.planned).toBe(1);
    expect(counts.plannedCooked).toBe(1);
  });

  it('keeps a free-text meal, since its fields do not say whether it was cooked', () => {
    const counts = mealCookCounts([cooked('2026-08-12', { title: 'Takeout' })], WINDOW);
    expect(counts.daysCooked).toBe(1);
    expect(counts.planned).toBe(1);
    expect(counts.plannedCooked).toBe(1);
  });

  it('buckets by the plan day, not by when it was actually cooked', () => {
    // Sunday's dinner, actually made on Monday. It stays Sunday's meal, so the
    // numerator can never escape the denominator's window.
    const counts = mealCookCounts(
      [entry('2026-08-09', { cookedAt: '2026-08-10T19:00:00.000Z' })],
      WINDOW
    );
    expect(counts.planned).toBe(1);
    expect(counts.plannedCooked).toBe(1);
    expect(counts.daysCooked).toBe(1);
  });

  it('never reports more cooked than planned', () => {
    const counts = mealCookCounts(
      Array.from({ length: 5 }, (_, i) => cooked(`2026-08-0${i + 1}`)),
      WINDOW
    );
    expect(counts.plannedCooked).toBeLessThanOrEqual(counts.planned);
  });
});

describe('leftoverHistoryIn', () => {
  it('splits closed-out containers by outcome', () => {
    const history = leftoverHistoryIn(
      [
        leftover({ finishedAt: '2026-08-10T18:00:00.000Z', outcome: 'eaten' }),
        leftover({ finishedAt: '2026-08-11T18:00:00.000Z', outcome: 'eaten' }),
        leftover({ finishedAt: '2026-08-12T18:00:00.000Z', outcome: 'tossed' }),
      ],
      WINDOW
    );
    expect(history).toEqual({ eaten: 2, tossed: 1 });
  });

  it('ignores containers still in the fridge', () => {
    expect(leftoverHistoryIn([leftover(), leftover()], WINDOW)).toEqual({ eaten: 0, tossed: 0 });
  });

  it('windows on when it was closed out, not on when it was stored', () => {
    // Stored well before the window opened, finished inside it — the ending is
    // the event being counted.
    const history = leftoverHistoryIn(
      [
        leftover({
          storedAt: '2026-05-01T09:00:00.000Z',
          finishedAt: '2026-08-10T18:00:00.000Z',
          outcome: 'eaten',
        }),
      ],
      WINDOW
    );
    expect(history).toEqual({ eaten: 1, tossed: 0 });
  });

  it('drops containers closed out before the window opened', () => {
    const history = leftoverHistoryIn(
      [leftover({ finishedAt: '2026-06-01T18:00:00.000Z', outcome: 'tossed' })],
      WINDOW
    );
    expect(history).toEqual({ eaten: 0, tossed: 0 });
  });

  it('keys a container finished before dayResetTime to the day it belongs to', () => {
    // 00:30 on Aug 14 under a 4 AM reset is still the window's last day, Aug 13.
    const late = leftover({ finishedAt: new Date(2026, 7, 14, 0, 30).toISOString(), outcome: 'eaten' });
    expect(leftoversFinishedIn([late], WINDOW, '04:00')).toHaveLength(1);
    expect(leftoversFinishedIn([late], WINDOW, '00:00')).toHaveLength(0);
  });

  it('counts an outcome-less closed row as eaten, matching outcomeCounts', () => {
    const history = leftoverHistoryIn(
      [leftover({ finishedAt: '2026-08-10T18:00:00.000Z', outcome: null })],
      WINDOW
    );
    expect(history).toEqual({ eaten: 1, tossed: 0 });
  });
});

describe('mostCookedRecipes', () => {
  it('skips recipes that have never been cooked', () => {
    expect(mostCookedRecipes([recipe('Ragu'), recipe('Salmon')])).toEqual([]);
  });

  it('ranks by cook count, highest first', () => {
    const list = mostCookedRecipes([
      recipe('Salmon', { cookCount: 2 }),
      recipe('Ragu', { cookCount: 6 }),
      recipe('Stir fry', { cookCount: 4 }),
    ]);
    expect(list.map(r => r.name)).toEqual(['Ragu', 'Stir fry', 'Salmon']);
  });

  it('breaks a tie on the most recently cooked, then on name', () => {
    const list = mostCookedRecipes([
      recipe('Salmon', { cookCount: 3, lastCookedAt: '2026-08-01T18:00:00.000Z' }),
      recipe('Ragu', { cookCount: 3, lastCookedAt: '2026-08-10T18:00:00.000Z' }),
      recipe('Chowder', { cookCount: 3, lastCookedAt: null }),
      recipe('Bread', { cookCount: 3, lastCookedAt: null }),
    ]);
    expect(list.map(r => r.name)).toEqual(['Ragu', 'Salmon', 'Bread', 'Chowder']);
  });

  it('carries the average cook time, and null until a session was logged', () => {
    const list = mostCookedRecipes([
      recipe('Ragu', { cookCount: 4, cookTimeCount: 2, totalCookMinutes: 65 }),
      recipe('Salmon', { cookCount: 2 }),
    ]);
    expect(list[0].avgMinutes).toBe(33);
    expect(list[1].avgMinutes).toBeNull();
  });

  it('caps at the limit', () => {
    const many = Array.from({ length: 8 }, (_, i) => recipe(`R${i}`, { cookCount: i + 1 }));
    expect(mostCookedRecipes(many, 3)).toHaveLength(3);
    expect(mostCookedRecipes(many)).toHaveLength(5);
  });
});

describe('hasCookingData', () => {
  const none = { eaten: 0, tossed: 0 };
  const empty: CookingWindow = WINDOW;

  it('is false when nothing has been looked up yet', () => {
    expect(hasCookingData(null, none, [])).toBe(false);
  });

  it('is false when every read came back empty', () => {
    expect(hasCookingData(mealCookCounts([], empty), none, [])).toBe(false);
  });

  it('is true on a planned meal alone, cooked or not', () => {
    expect(hasCookingData(mealCookCounts([entry('2026-08-10')], empty), none, [])).toBe(true);
  });

  it('is true on fridge history alone', () => {
    expect(hasCookingData(null, { eaten: 0, tossed: 1 }, [])).toBe(true);
  });

  it('is true on a cooked recipe alone, which outlives the entry purge', () => {
    expect(hasCookingData(null, none, mostCookedRecipes([recipe('Ragu', { cookCount: 9 })]))).toBe(
      true
    );
  });
});
