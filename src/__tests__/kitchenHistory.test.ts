import {
  kitchenEvents,
  kitchenHistoryDays,
  filterKitchenEvents,
} from '../utils/kitchenHistory';
import type { Leftover, MealPlanEntry, Recipe } from '../types';

// kitchenHistory reaches dateUtils for getLogicalDayKey, which falls back to the
// settings store for dayResetTime — which nothing here needs, since the one case
// that cares passes the reset time explicitly. Same stub cookingStats.test.ts /
// mealPlan.test.ts use.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

function entry(overrides: Partial<MealPlanEntry> & { id: string; date: string }): MealPlanEntry {
  return {
    slot: 'dinner',
    recipeId: null,
    title: 'Something',
    sortOrder: 0,
    createdAt: '2026-08-01T12:00:00.000Z',
    cookedAt: null,
    leftoverId: null,
    recipeChoices: [],
    recipeScale: 1,
    cookTask: null,
    shopTask: null,
    calendarEventId: null,
    ...overrides,
  };
}

function leftover(overrides: Partial<Leftover> & { id: string }): Leftover {
  return {
    title: 'Something',
    recipeId: null,
    sourceEntryId: null,
    storedAt: '2026-08-01T12:00:00.000Z',
    keepUntil: '2026-08-04',
    finishedAt: null,
    outcome: null,
    frozenAt: null,
    createdAt: '2026-08-01T12:00:00.000Z',
    useUpTask: null,
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
    sourceType: null,
    sourcePage: null,
    servings: null,
    servingsMax: null,
    recipeYield: null,
    leftoverKeepDays: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients: [],
    emptySections: [],
    components: [],
    prepTasks: [],
    steps: [],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-08-01T12:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
  };
}

describe('kitchenEvents', () => {
  it('ignores a planned meal that was never cooked', () => {
    const events = kitchenEvents(
      [entry({ id: 'a', date: '2026-08-10', title: 'Chicken tacos' })],
      [],
      []
    );
    expect(events).toEqual([]);
  });

  it('ignores a leftover still in the fridge', () => {
    const events = kitchenEvents([], [leftover({ id: 'l1', title: 'Chilli' })], []);
    expect(events).toEqual([]);
  });

  it('files a cooked meal under its own date, not the instant it was ticked', () => {
    // Ticked four days after the night it was for — the sweep-the-week case
    // `bulkSetCooked` exists for. Reading `cookedAt` would file it on the 14th.
    const events = kitchenEvents(
      [
        entry({
          id: 'a',
          date: '2026-08-10',
          title: 'Seared steak',
          cookedAt: '2026-08-14T19:00:00.000Z',
        }),
      ],
      [],
      []
    );
    expect(events).toHaveLength(1);
    expect(events[0].dayKey).toBe('2026-08-10');
  });

  it('resolves a recipe-backed meal to the recipe’s current name', () => {
    const events = kitchenEvents(
      [
        entry({
          id: 'a',
          date: '2026-08-10',
          title: 'Salmon',
          recipeId: 'r1',
          cookedAt: '2026-08-10T19:00:00.000Z',
        }),
      ],
      [],
      [recipe('r1', 'Lemon garlic salmon')]
    );
    expect(events[0].title).toBe('Lemon garlic salmon');
    expect(events[0].recipeId).toBe('r1');
  });

  it('falls back to the captured title when the recipe is gone', () => {
    const events = kitchenEvents(
      [
        entry({
          id: 'a',
          date: '2026-08-10',
          title: 'Salmon',
          recipeId: 'deleted',
          cookedAt: '2026-08-10T19:00:00.000Z',
        }),
      ],
      [],
      []
    );
    expect(events[0].title).toBe('Salmon');
  });

  it('names the slot on a cooked meal and the outcome on a leftover', () => {
    const events = kitchenEvents(
      [entry({ id: 'a', date: '2026-08-10', slot: 'lunch', cookedAt: '2026-08-10T13:00:00.000Z' })],
      [
        leftover({ id: 'l1', finishedAt: '2026-08-10T20:00:00.000Z', outcome: 'eaten' }),
        leftover({ id: 'l2', finishedAt: '2026-08-10T20:00:00.000Z', outcome: 'tossed' }),
      ],
      []
    );
    expect(events.map(e => e.detail)).toEqual(
      expect.arrayContaining(['Lunch', 'Eaten', 'Thrown out'])
    );
  });

  it('reads a finished leftover with no outcome as eaten, like the row mapper does', () => {
    const events = kitchenEvents(
      [],
      [leftover({ id: 'l1', finishedAt: '2026-08-10T20:00:00.000Z', outcome: null })],
      []
    );
    expect(events[0].outcome).toBe('eaten');
    expect(events[0].detail).toBe('Eaten');
  });

  it('keys rows by kind, so a meal and a leftover sharing an id can co-exist', () => {
    const events = kitchenEvents(
      [entry({ id: 'x', date: '2026-08-10', cookedAt: '2026-08-10T19:00:00.000Z' })],
      [leftover({ id: 'x', finishedAt: '2026-08-10T20:00:00.000Z', outcome: 'eaten' })],
      []
    );
    expect(new Set(events.map(e => e.key)).size).toBe(2);
  });

  it('sorts newest day first, then through the day by slot, leftovers last', () => {
    const events = kitchenEvents(
      [
        entry({ id: 'd', date: '2026-08-10', slot: 'dinner', title: 'Steak', cookedAt: '2026-08-10T19:00:00.000Z' }),
        entry({ id: 'b', date: '2026-08-10', slot: 'breakfast', title: 'Porridge', cookedAt: '2026-08-10T08:00:00.000Z' }),
        entry({ id: 'old', date: '2026-08-09', slot: 'dinner', title: 'Curry', cookedAt: '2026-08-09T19:00:00.000Z' }),
      ],
      [leftover({ id: 'l1', title: 'Chilli', finishedAt: '2026-08-10T12:00:00.000Z', outcome: 'eaten' })],
      []
    );
    expect(events.map(e => e.title)).toEqual(['Porridge', 'Steak', 'Chilli', 'Curry']);
  });

  it('breaks a tie on title, so two dinners on one night hold a stable order', () => {
    const forward = kitchenEvents(
      [
        entry({ id: 'a', date: '2026-08-10', title: 'Zucchini', cookedAt: '2026-08-10T19:00:00.000Z' }),
        entry({ id: 'b', date: '2026-08-10', title: 'Aubergine', cookedAt: '2026-08-10T19:00:00.000Z' }),
      ],
      [],
      []
    );
    const reversed = kitchenEvents(
      [
        entry({ id: 'b', date: '2026-08-10', title: 'Aubergine', cookedAt: '2026-08-10T19:00:00.000Z' }),
        entry({ id: 'a', date: '2026-08-10', title: 'Zucchini', cookedAt: '2026-08-10T19:00:00.000Z' }),
      ],
      [],
      []
    );
    expect(forward.map(e => e.title)).toEqual(['Aubergine', 'Zucchini']);
    expect(reversed.map(e => e.title)).toEqual(forward.map(e => e.title));
  });

  it('takes dayResetTime for a leftover’s instant but never for a meal’s date', () => {
    // 00:30 local on the 11th, under a 02:00 reset, is still the 10th.
    const finishedAt = new Date(2026, 7, 11, 0, 30).toISOString();
    const events = kitchenEvents(
      [entry({ id: 'a', date: '2026-08-11', cookedAt: '2026-08-11T19:00:00.000Z' })],
      [leftover({ id: 'l1', finishedAt, outcome: 'eaten' })],
      [],
      '02:00'
    );
    const byKind = Object.fromEntries(events.map(e => [e.kind, e.dayKey]));
    expect(byKind.leftover).toBe('2026-08-10');
    // The meal's date is a calendar day the user picked; no reset time reaches it.
    expect(byKind.cooked).toBe('2026-08-11');
  });
});

describe('kitchenHistoryDays', () => {
  it('groups into days, newest first, keeping each day’s order', () => {
    const events = kitchenEvents(
      [
        entry({ id: 'a', date: '2026-08-10', slot: 'breakfast', title: 'Porridge', cookedAt: '2026-08-10T08:00:00.000Z' }),
        entry({ id: 'b', date: '2026-08-10', slot: 'dinner', title: 'Steak', cookedAt: '2026-08-10T19:00:00.000Z' }),
        entry({ id: 'c', date: '2026-08-08', slot: 'dinner', title: 'Curry', cookedAt: '2026-08-08T19:00:00.000Z' }),
      ],
      [],
      []
    );
    expect(kitchenHistoryDays(events)).toEqual([
      { dayKey: '2026-08-10', events: [events[0], events[1]] },
      { dayKey: '2026-08-08', events: [events[2]] },
    ]);
  });

  it('is empty for no events', () => {
    expect(kitchenHistoryDays([])).toEqual([]);
  });
});

describe('filterKitchenEvents', () => {
  const events = kitchenEvents(
    [
      entry({ id: 'a', date: '2026-08-10', title: 'Lemon garlic salmon', cookedAt: '2026-08-10T19:00:00.000Z' }),
      entry({ id: 'b', date: '2026-08-09', title: 'Takeout curry', cookedAt: '2026-08-09T19:00:00.000Z' }),
    ],
    [leftover({ id: 'l1', title: 'Chicken stir-fry', finishedAt: '2026-08-08T19:00:00.000Z', outcome: 'tossed' })],
    []
  );

  it('returns everything for a blank query', () => {
    expect(filterKitchenEvents(events, '   ')).toHaveLength(3);
  });

  it('matches titles across both kinds', () => {
    expect(filterKitchenEvents(events, 'chicken').map(e => e.title)).toEqual(['Chicken stir-fry']);
    expect(filterKitchenEvents(events, 'salmon').map(e => e.title)).toEqual(['Lemon garlic salmon']);
  });

  it('does not match the detail word, or "eaten" would return the whole fridge', () => {
    expect(filterKitchenEvents(events, 'thrown out')).toEqual([]);
  });

  it('keeps chronological order rather than ranking by relevance', () => {
    expect(filterKitchenEvents(events, 'c').map(e => e.title)).toEqual([
      'Lemon garlic salmon',
      'Takeout curry',
      'Chicken stir-fry',
    ]);
  });
});
