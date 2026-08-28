import { useMealPlanStore } from '../store/useMealPlanStore';
import {
  dbGetMealPlanEntries,
  dbInsertMealPlanEntry,
  dbUpdateMealPlanEntry,
  dbDeleteMealPlanEntry,
  dbPurgeOldMealPlanEntries,
  dbGetMealPlanAddedToList,
  dbSetMealPlanAddedToList,
  dbGetMealPlanEntry,
} from '../db/database';
import type { GroceryItem, MealPlanEntry, MealSlot, Recipe, Task } from '../types';
import { useGroceryStore } from '../store/useGroceryStore';
import { groceryNameKey } from '../utils/groceryParse';
import { mealSlotSourceId, mealSlotTaskDraft } from '../utils/mealSlotTasks';
import { dayKeyOf } from '../utils/dateUtils';

jest.mock('../db/database', () => ({
  dbGetMealPlanEntries: jest.fn().mockReturnValue([]),
  dbGetMealPlanEntry: jest.fn().mockReturnValue(null),
  dbInsertMealPlanEntry: jest.fn(),
  dbUpdateMealPlanEntry: jest.fn(),
  dbDeleteMealPlanEntry: jest.fn(),
  dbPurgeOldMealPlanEntries: jest.fn().mockReturnValue(0),
  dbGetMealPlanAddedToList: jest.fn().mockReturnValue({}),
  dbSetMealPlanAddedToList: jest.fn(),
  // The real grocery store is driven below, and a cooking now writes to it —
  // marking what it used as opened. Nothing here asserts the row hit SQLite,
  // only what the store holds afterwards.
  dbUpdateGroceryItem: jest.fn(),
}));

// mealCookTasks defaults on, matching the real store — so every test here runs
// with cook-task reconciliation live rather than only the ones that opt in.
let mockMealCookTasks = true;
// mealCalendarId defaults to null, also matching the real store: the calendar
// mirror is off until a calendar is picked, so only the tests that opt in run
// with it live.
let mockMealCalendarId: string | null = null;
// Mocked for the same reason the task store below is: this suite is about what
// the meal plan asks of its collaborators, and the one path here that creates a
// task (setCookTask(true)) makes sure its category exists first — which is the
// real store's job, tested in useCategoryStore's own suite.
jest.mock('../store/useCategoryStore', () => ({
  ensureGeneratedTaskCategory: jest.fn(),
  useCategoryStore: { getState: () => ({ categories: [], addCategory: jest.fn() }) },
}));

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      dayResetTime: '00:00',
      get mealCookTasks() { return mockMealCookTasks; },
      get mealCalendarId() { return mockMealCalendarId; },
    }),
  },
}));

// useMealPlanStore reaches calendarSync.ts (a real react-native import) both
// directly, for the delete on a vanishing meal, and via mealCalendarSync.ts —
// same reason useTaskStore.test.ts and useDemoStore.test.ts mock it.
const mockDeleteCalendarEvent = jest.fn().mockResolvedValue(undefined);
const mockCreateAllDayEvent = jest.fn().mockResolvedValue('evt-new');
const mockUpdateAllDayEvent = jest.fn().mockResolvedValue(true);
jest.mock('../utils/calendarSync', () => ({
  deleteCalendarEvent: (...args: unknown[]) => mockDeleteCalendarEvent(...args),
  createAllDayEvent: (...args: unknown[]) => mockCreateAllDayEvent(...args),
  updateAllDayEvent: (...args: unknown[]) => mockUpdateAllDayEvent(...args),
}));

// useGroceryStore (real, below) imports these unconditionally for
// startTrip/endTrip — same expo-notifications-in-node problem the task store
// mock above exists for.
jest.mock('../utils/notifications', () => ({
  scheduleTripReminder: jest.fn().mockResolvedValue(undefined),
  cancelTripReminder: jest.fn().mockResolvedValue(undefined),
}));

// The task store is mocked rather than driven for real: this suite is about
// what the meal plan *asks* of it, and the real one drags expo-notifications
// into a node environment. The other side of the link — a completion actually
// stamping cookedAt — is covered against the real stores in
// useTaskStore.test.ts.
const mockTaskState = {
  tasks: [] as Task[],
  addTask: jest.fn((draft: Partial<Task>) => {
    const task = { id: `t-${mockTaskState.tasks.length + 1}`, completed: false, archived: false, ...draft } as Task;
    mockTaskState.tasks.push(task);
    return task;
  }),
  // The options param is unused by the mock but declared, so a test can assert
  // what was passed — reconcileCookTask has to opt out of postpone counting.
  updateTask: jest.fn((
    id: string,
    updates: Partial<Task>,
    _options?: { scope?: 'occurrence' | 'series'; skipPostponeCount?: boolean },
  ) => {
    mockTaskState.tasks = mockTaskState.tasks.map(t => (t.id === id ? { ...t, ...updates } : t));
  }),
  deleteTask: jest.fn((id: string) => {
    mockTaskState.tasks = mockTaskState.tasks.filter(t => t.id !== id);
  }),
  setLastAction: jest.fn(),
  completeTask: jest.fn((id: string) => {
    mockTaskState.tasks = mockTaskState.tasks.map(t => (t.id === id ? { ...t, completed: true } : t));
  }),
  uncompleteTask: jest.fn((id: string) => {
    mockTaskState.tasks = mockTaskState.tasks.map(t => (t.id === id ? { ...t, completed: false } : t));
  }),
};
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => mockTaskState },
}));

// Mutable, so the cooked-offer tests below can put a recipe behind an entry —
// the offer is computed from the cooked recipe's ingredient lines.
const mockRecipeState = {
  recipes: [] as Recipe[],
  markCooked: jest.fn(),
  restoreCookStats: jest.fn(),
};
jest.mock('../store/useRecipeStore', () => ({
  useRecipeStore: { getState: () => mockRecipeState },
}));

/** The live cook task for an entry, as the store's own helpers find it. */
const cookTaskFor = (entryId: string) =>
  mockTaskState.tasks.find(t => t.generatedSourceId === entryId && !t.completed);

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
    createdAt: '2026-01-01T00:00:00.000Z',
    cookedAt: null,
    leftoverId: null,
    recipeChoices: [],
    personIds: [],
    recipeScale: 1,
    cookTask: null,
    shopTask: null,
    calendarEventId: null,
    ...overrides,
  };
}

const getEntries = () => useMealPlanStore.getState().entries;

/** Loads the week of 3–9 Aug 2026 with whatever rows the db is pretending to hold. */
function loadWeek(rows: MealPlanEntry[] = []) {
  (dbGetMealPlanEntries as jest.Mock).mockReturnValue(rows);
  useMealPlanStore.getState().loadRange('2026-08-03', '2026-08-09');
  (dbGetMealPlanEntries as jest.Mock).mockReturnValue([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  seq = 0;
  mockMealCookTasks = true;
  mockMealCalendarId = null;
  mockCreateAllDayEvent.mockResolvedValue('evt-new');
  mockUpdateAllDayEvent.mockResolvedValue(true);
  mockTaskState.tasks = [];
  (dbGetMealPlanEntries as jest.Mock).mockReturnValue([]);
  (dbGetMealPlanEntry as jest.Mock).mockReturnValue(null);
  (dbPurgeOldMealPlanEntries as jest.Mock).mockReturnValue(0);
  (dbGetMealPlanAddedToList as jest.Mock).mockReturnValue({});
  mockRecipeState.recipes = [];
  useGroceryStore.setState({ items: [] });
  useMealPlanStore.setState({
    entries: [], rangeStart: null, rangeEnd: null, addedToListAt: {}, initialized: false,
    lastAction: null, cookRecap: null, plannedSlotCounts: {}, cookingCounts: null,
  });
});

// ─── Fixtures for the post-cook recap ──────────────────────────────────────
//
// Only the handful of fields the recap's own pipeline reads
// (plannedIngredientsForRecipe → classifyPlanned → consumedRows); cast rather
// than filled out, since this suite is about which cook paths raise an offer
// and the shapes themselves are pinned in mealPlanGroceries.test.ts.

function recipeWith(name: string, ingredientNames: string[]): Recipe {
  return {
    id: `r-${name}`,
    name,
    ingredients: ingredientNames.map((n, i) => ({
      id: `${name}-i${i}`, name: n, nameKey: groceryNameKey(n),
      quantity: '', aisle: null, prep: null, purpose: null, section: null, choiceGroup: null,
    })),
    emptySections: [],
    components: [],
  } as unknown as Recipe;
}

/** A catalog row the pantry claims you have — an explicit, unexpired "Got it". */
function onHand(name: string): GroceryItem {
  return {
    id: `g-${name}`,
    name,
    nameKey: groceryNameKey(name),
    onList: false,
    checked: false,
    isStaple: false,
    purchaseCount: 0,
    onHandUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  } as unknown as GroceryItem;
}

describe('refreshPlannedSlotCounts', () => {
  const counts = () => useMealPlanStore.getState().plannedSlotCounts;

  it('counts each asked-for day out of three, from the database rather than the window', () => {
    // Nothing is loaded — which is the normal state for the week a nudge asks
    // about, since it fires for the week *after* the one on screen.
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-08-11', 'breakfast'),
      entry('2026-08-11', 'dinner'),
      entry('2026-08-12', 'dinner'),
    ]);

    useMealPlanStore.getState().refreshPlannedSlotCounts(['2026-08-11', '2026-08-12', '2026-08-13']);

    expect(counts()).toEqual({ '2026-08-11': 2, '2026-08-12': 1, '2026-08-13': 0 });
    expect(useMealPlanStore.getState().entries).toEqual([]); // window untouched
  });

  it('reads the whole span in one query', () => {
    useMealPlanStore.getState().refreshPlannedSlotCounts(['2026-08-13', '2026-08-11', '2026-08-16']);

    expect(dbGetMealPlanEntries).toHaveBeenCalledTimes(1);
    expect(dbGetMealPlanEntries).toHaveBeenCalledWith('2026-08-11', '2026-08-16');
  });

  it('leaves the loaded window alone', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([entry('2026-08-11', 'lunch')]);

    useMealPlanStore.getState().refreshPlannedSlotCounts(['2026-08-11']);

    expect(useMealPlanStore.getState().rangeStart).toBe('2026-08-03');
    expect(useMealPlanStore.getState().entries).toHaveLength(1);
    expect(useMealPlanStore.getState().entries[0].date).toBe('2026-08-05');
  });

  it('drops days that stop being asked about', () => {
    useMealPlanStore.setState({ plannedSlotCounts: { '2026-08-04': 3 } });

    useMealPlanStore.getState().refreshPlannedSlotCounts(['2026-08-11']);

    expect(counts()).toEqual({ '2026-08-11': 0 });
  });

  it('clears the map when nothing is asking any more', () => {
    useMealPlanStore.setState({ plannedSlotCounts: { '2026-08-11': 2 } });

    useMealPlanStore.getState().refreshPlannedSlotCounts([]);

    expect(counts()).toEqual({});
    expect(dbGetMealPlanEntries).not.toHaveBeenCalled();
  });

  it('keeps the same object when the counts have not changed', () => {
    // It's wired to something that fires often (every change to the loaded
    // window, plus every focus), so an unrelated meal moving must not
    // re-render a stack of seven rows.
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([entry('2026-08-11', 'dinner')]);
    useMealPlanStore.getState().refreshPlannedSlotCounts(['2026-08-11']);
    const first = counts();

    useMealPlanStore.getState().refreshPlannedSlotCounts(['2026-08-11']);

    expect(counts()).toBe(first);
  });
});

describe('refreshPeopleYearMealCount', () => {
  it('is null until something asks — an absent count is not a zero', () => {
    expect(useMealPlanStore.getState().peopleYearMealCount).toBeNull();
  });

  it('counts a cooked meal with a guest out of the database, not the loaded week', () => {
    loadWeek([entry('2026-03-05', 'dinner')]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-06-01', 'dinner', { cookedAt: '2026-06-01T19:00:00.000Z', personIds: ['p1'] }),
      entry('2026-06-02', 'dinner', { cookedAt: '2026-06-02T19:00:00.000Z', personIds: [] }),
      entry('2026-06-03', 'dinner', { personIds: ['p1'] }),
    ]);

    useMealPlanStore.getState().refreshPeopleYearMealCount('2026-01-01', '2026-12-31');

    expect(useMealPlanStore.getState().peopleYearMealCount).toBe(1);
    expect(dbGetMealPlanEntries).toHaveBeenLastCalledWith('2026-01-01', '2026-12-31');
  });

  it('does not re-render on an unchanged count', () => {
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-06-01', 'dinner', { cookedAt: '2026-06-01T19:00:00.000Z', personIds: ['p1'] }),
    ]);
    useMealPlanStore.getState().refreshPeopleYearMealCount('2026-01-01', '2026-12-31');
    const before = useMealPlanStore.getState();
    useMealPlanStore.getState().refreshPeopleYearMealCount('2026-01-01', '2026-12-31');
    expect(useMealPlanStore.getState()).toBe(before);
  });
});

describe('refreshCookingCounts', () => {
  const window = { startKey: '2026-07-15', endKey: '2026-08-13', todayKey: '2026-08-13' };
  const cooked = (date: string, slot: MealSlot = 'dinner') =>
    entry(date, slot, { cookedAt: `${date}T19:00:00.000Z` });

  it('is null until something asks — an absent count is not a zero', () => {
    expect(useMealPlanStore.getState().cookingCounts).toBeNull();
  });

  it('counts the window out of the database rather than the loaded week', () => {
    // The window MealPlanScreen has open is a different week entirely, which is
    // the normal case for a hidden tab asking about a rolling month.
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      cooked('2026-08-10'),
      entry('2026-08-11', 'dinner'),
      cooked('2026-08-12'),
    ]);

    useMealPlanStore.getState().refreshCookingCounts(window);

    expect(useMealPlanStore.getState().cookingCounts).toEqual({
      days: 30,
      daysCooked: 2,
      planned: 3,
      plannedCooked: 2,
    });
    expect(dbGetMealPlanEntries).toHaveBeenLastCalledWith('2026-07-15', '2026-08-13');
  });

  it('leaves the loaded window alone', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([cooked('2026-08-10')]);

    useMealPlanStore.getState().refreshCookingCounts(window);

    expect(useMealPlanStore.getState().rangeStart).toBe('2026-08-03');
    expect(useMealPlanStore.getState().entries).toHaveLength(1);
    expect(useMealPlanStore.getState().entries[0].date).toBe('2026-08-05');
  });

  it('keeps the same object when nothing moved', () => {
    // Wired to a screen focus, so a revisit that changes nothing must not
    // re-render the section.
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([cooked('2026-08-10')]);
    useMealPlanStore.getState().refreshCookingCounts(window);
    const first = useMealPlanStore.getState().cookingCounts;

    useMealPlanStore.getState().refreshCookingCounts(window);

    expect(useMealPlanStore.getState().cookingCounts).toBe(first);
  });

  it('picks up a meal marked cooked since the last read', () => {
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([entry('2026-08-10', 'dinner')]);
    useMealPlanStore.getState().refreshCookingCounts(window);
    expect(useMealPlanStore.getState().cookingCounts!.plannedCooked).toBe(0);

    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([cooked('2026-08-10')]);
    useMealPlanStore.getState().refreshCookingCounts(window);

    expect(useMealPlanStore.getState().cookingCounts!.plannedCooked).toBe(1);
  });

  it('goes back to null on initialize, rather than describing a swapped-out database', () => {
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([cooked('2026-08-10')]);
    useMealPlanStore.getState().refreshCookingCounts(window);
    expect(useMealPlanStore.getState().cookingCounts).not.toBeNull();

    useMealPlanStore.getState().initialize();

    expect(useMealPlanStore.getState().cookingCounts).toBeNull();
  });
});

describe('refreshCookHistory', () => {
  const cooked = (date: string, slot: MealSlot = 'dinner') =>
    entry(date, slot, { cookedAt: `${date}T19:00:00.000Z` });

  it('is null until something asks — an absent history is not an empty one', () => {
    expect(useMealPlanStore.getState().cookHistory).toBeNull();
  });

  it('keeps the cooked rows and drops the merely planned ones', () => {
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      cooked('2026-08-10'),
      entry('2026-08-11', 'dinner'),
      cooked('2026-08-12'),
    ]);

    useMealPlanStore.getState().refreshCookHistory('2026-02-14', '2026-08-13');

    expect(useMealPlanStore.getState().cookHistory!.map(e => e.date)).toEqual([
      '2026-08-10',
      '2026-08-12',
    ]);
    expect(dbGetMealPlanEntries).toHaveBeenLastCalledWith('2026-02-14', '2026-08-13');
  });

  it('leaves the loaded window alone', () => {
    // The whole point of the separate read: the Logbook asks about six months
    // on a tab that stays mounted, and must not clobber the week Meal plan has
    // open (see the note on `cookHistory`).
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([cooked('2026-03-10')]);

    useMealPlanStore.getState().refreshCookHistory('2026-02-14', '2026-08-13');

    expect(useMealPlanStore.getState().rangeStart).toBe('2026-08-03');
    expect(useMealPlanStore.getState().entries).toHaveLength(1);
    expect(useMealPlanStore.getState().entries[0].date).toBe('2026-08-05');
  });

  it('keeps the same array when nothing moved', () => {
    // Wired to a screen focus, so a revisit that changes nothing must not
    // re-render the list.
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([cooked('2026-08-10')]);
    useMealPlanStore.getState().refreshCookHistory('2026-02-14', '2026-08-13');
    const first = useMealPlanStore.getState().cookHistory;

    // A fresh read allocates fresh row objects, so identity alone would never
    // match — the guard compares what a row is built from.
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      { ...cooked('2026-08-10'), id: first![0].id, title: first![0].title },
    ]);
    useMealPlanStore.getState().refreshCookHistory('2026-02-14', '2026-08-13');

    expect(useMealPlanStore.getState().cookHistory).toBe(first);
  });

  it('picks up a meal marked cooked since the last read', () => {
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([entry('2026-08-10', 'dinner')]);
    useMealPlanStore.getState().refreshCookHistory('2026-02-14', '2026-08-13');
    expect(useMealPlanStore.getState().cookHistory).toEqual([]);

    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([cooked('2026-08-10')]);
    useMealPlanStore.getState().refreshCookHistory('2026-02-14', '2026-08-13');

    expect(useMealPlanStore.getState().cookHistory).toHaveLength(1);
  });

  it('notices a renamed meal, which only the title compare can catch', () => {
    const row = cooked('2026-08-10');
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([row]);
    useMealPlanStore.getState().refreshCookHistory('2026-02-14', '2026-08-13');

    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([{ ...row, title: 'Takeout curry' }]);
    useMealPlanStore.getState().refreshCookHistory('2026-02-14', '2026-08-13');

    expect(useMealPlanStore.getState().cookHistory![0].title).toBe('Takeout curry');
  });

  it('goes back to null on initialize, rather than describing a swapped-out database', () => {
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([cooked('2026-08-10')]);
    useMealPlanStore.getState().refreshCookHistory('2026-02-14', '2026-08-13');
    expect(useMealPlanStore.getState().cookHistory).not.toBeNull();

    useMealPlanStore.getState().initialize();

    expect(useMealPlanStore.getState().cookHistory).toBeNull();
  });
});

describe('loadRange', () => {
  it('reads only the window asked for', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);

    expect(dbGetMealPlanEntries).toHaveBeenCalledWith('2026-08-03', '2026-08-09');
    expect(getEntries()).toHaveLength(1);
    expect(useMealPlanStore.getState().rangeStart).toBe('2026-08-03');
    expect(useMealPlanStore.getState().rangeEnd).toBe('2026-08-09');
  });

  it('puts what it loaded into reading order', () => {
    loadWeek([
      entry('2026-08-05', 'dinner'),
      entry('2026-08-05', 'breakfast'),
      entry('2026-08-04', 'dinner'),
    ]);

    expect(getEntries().map(e => [e.date, e.slot])).toEqual([
      ['2026-08-04', 'dinner'],
      ['2026-08-05', 'breakfast'],
      ['2026-08-05', 'dinner'],
    ]);
  });

  it('replaces the previous window rather than accumulating', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([entry('2026-08-12', 'dinner')]);
    useMealPlanStore.getState().loadRange('2026-08-10', '2026-08-16');

    expect(getEntries().map(e => e.date)).toEqual(['2026-08-12']);
  });
});

describe('entriesForDayLive', () => {
  it('reads the loaded window rather than going to disk, for a day inside it', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbGetMealPlanEntries as jest.Mock).mockClear();

    const result = useMealPlanStore.getState().entriesForDayLive('2026-08-05');

    expect(result).toHaveLength(1);
    expect(dbGetMealPlanEntries).not.toHaveBeenCalled();
  });

  it('falls through to SQLite for a day outside the loaded window', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([entry('2026-09-01', 'lunch')]);

    const result = useMealPlanStore.getState().entriesForDayLive('2026-09-01');

    expect(dbGetMealPlanEntries).toHaveBeenCalledWith('2026-09-01', '2026-09-01');
    expect(result.map(e => e.slot)).toEqual(['lunch']);
  });

  it('goes to SQLite for any day before anything has been loaded', () => {
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([entry('2026-08-05', 'breakfast')]);

    const result = useMealPlanStore.getState().entriesForDayLive('2026-08-05');

    expect(dbGetMealPlanEntries).toHaveBeenCalledWith('2026-08-05', '2026-08-05');
    expect(result).toHaveLength(1);
  });
});

describe('initialize', () => {
  it('reloads whatever window is loaded, so a database swap is picked up', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([entry('2026-08-06', 'lunch')]);

    useMealPlanStore.getState().initialize();

    expect(dbGetMealPlanEntries).toHaveBeenLastCalledWith('2026-08-03', '2026-08-09');
    expect(getEntries().map(e => e.date)).toEqual(['2026-08-06']);
    expect(useMealPlanStore.getState().initialized).toBe(true);
  });

  it('holds nothing when no window has been asked for yet', () => {
    useMealPlanStore.getState().initialize();

    expect(dbGetMealPlanEntries).not.toHaveBeenCalled();
    expect(getEntries()).toEqual([]);
    expect(useMealPlanStore.getState().initialized).toBe(true);
  });

  it('loads addedToListAt from the database, same as any other database swap', () => {
    (dbGetMealPlanAddedToList as jest.Mock).mockReturnValue({ '2026-08-09': '2026-08-09T00:00:00.000Z' });
    useMealPlanStore.getState().initialize();
    expect(useMealPlanStore.getState().addedToListAt).toEqual({ '2026-08-09': '2026-08-09T00:00:00.000Z' });
  });
});

describe('planMeal', () => {
  it('writes the row and shows it on the week', () => {
    loadWeek();
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: '  Sausage   ragù ',
    })!;

    expect(planned.title).toBe('Sausage ragù');
    expect(planned.recipeId).toBe('r1');
    expect(dbInsertMealPlanEntry).toHaveBeenCalledWith(planned);
    expect(getEntries()).toEqual([planned]);
  });

  it('carries a tracked leftover, and touches nothing about the leftover itself', () => {
    loadWeek();
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', leftoverId: 'lo-1', title: 'Chilli (2 days old)',
    })!;

    expect(planned.leftoverId).toBe('lo-1');
    expect(planned.recipeId).toBeNull();
  });

  it('leaves leftoverId null for an ordinary plan', () => {
    loadWeek();
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragù',
    })!;

    expect(planned.leftoverId).toBeNull();
  });

  // "Leftovers" is a plan, not a skipped step.
  it('accepts a meal with no recipe at all', () => {
    loadWeek();
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', title: 'Leftovers',
    })!;

    expect(planned.recipeId).toBeNull();
    expect(getEntries()).toEqual([planned]);
  });

  it('refuses a blank title', () => {
    loadWeek();
    expect(useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', title: '   ',
    })).toBeNull();
    expect(dbInsertMealPlanEntry).not.toHaveBeenCalled();
    expect(getEntries()).toEqual([]);
  });

  // Two things on one dinner is real — chicken *and* a salad.
  it('lets a slot hold more than one thing, ordered behind what is there', () => {
    loadWeek();
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-08-05', 'dinner', { sortOrder: 3 }),
    ]);
    const second = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', title: 'Green salad',
    })!;

    expect(second.sortOrder).toBe(4);
  });

  /**
   * The invariant that makes this store range-scoped rather than a partial copy
   * of the table that grows every time something is planned offscreen.
   */
  it('writes a row outside the loaded window without holding it in memory', () => {
    loadWeek();
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-09-20', slot: 'dinner', title: 'Roast',
    })!;

    expect(dbInsertMealPlanEntry).toHaveBeenCalledWith(planned);
    expect(getEntries()).toEqual([]);
  });

  it('holds nothing before a window has been loaded', () => {
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', title: 'Roast',
    })!;

    expect(dbInsertMealPlanEntry).toHaveBeenCalledWith(planned);
    expect(getEntries()).toEqual([]);
  });

  it('registers an undo that removes the planned meal again', () => {
    loadWeek();
    const planned = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', title: 'Roast',
    })!;

    expect(useMealPlanStore.getState().lastAction?.label).toBe('Planned "Roast"');
    useMealPlanStore.getState().undoLastAction();

    expect(dbDeleteMealPlanEntry).toHaveBeenCalledWith(planned.id);
    expect(getEntries()).toEqual([]);
  });
});

describe('moveEntry', () => {
  it('moves a meal to another day', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().moveEntry(dinner.id, { date: '2026-08-07' });

    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: dinner.id, date: '2026-08-07', slot: 'dinner' })
    );
    expect(getEntries().map(e => e.date)).toEqual(['2026-08-07']);
  });

  it('changes the slot without touching the day', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().moveEntry(dinner.id, { slot: 'lunch' });

    expect(getEntries()[0]).toEqual(expect.objectContaining({
      date: '2026-08-05', slot: 'lunch',
    }));
  });

  it('re-orders to the end of where it lands', () => {
    const moving = entry('2026-08-05', 'dinner', { sortOrder: 1 });
    loadWeek([moving]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-08-07', 'dinner', { sortOrder: 5 }),
    ]);

    useMealPlanStore.getState().moveEntry(moving.id, { date: '2026-08-07' });

    expect(getEntries()[0].sortOrder).toBe(6);
  });

  it('drops a meal moved out of the loaded window from memory', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().moveEntry(dinner.id, { date: '2026-10-01' });

    expect(dbUpdateMealPlanEntry).toHaveBeenCalledTimes(1);
    expect(getEntries()).toEqual([]);
  });

  it('does nothing when the move changes nothing', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().moveEntry(dinner.id, { date: '2026-08-05', slot: 'dinner' });

    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('shrugs at an id it does not hold', () => {
    loadWeek();
    useMealPlanStore.getState().moveEntry('gone', { date: '2026-08-07' });
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('registers an undo that moves the meal back to its original day and slot', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().moveEntry(dinner.id, { date: '2026-08-07', slot: 'lunch' });
    expect(useMealPlanStore.getState().lastAction?.label).toBe(`Moved "${dinner.title}"`);
    useMealPlanStore.getState().undoLastAction();

    expect(dbUpdateMealPlanEntry).toHaveBeenLastCalledWith(dinner);
    expect(getEntries()[0]).toEqual(expect.objectContaining({ date: '2026-08-05', slot: 'dinner' }));
  });
});

describe('removeEntry', () => {
  it('deletes the row and takes it off the week', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().removeEntry(dinner.id);

    expect(dbDeleteMealPlanEntry).toHaveBeenCalledWith(dinner.id);
    expect(getEntries()).toEqual([]);
  });

  it('registers an undo that re-inserts the removed meal', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().removeEntry(dinner.id);
    expect(useMealPlanStore.getState().lastAction?.label).toBe(`Removed "${dinner.title}"`);
    useMealPlanStore.getState().undoLastAction();

    expect(dbInsertMealPlanEntry).toHaveBeenCalledWith(dinner);
    expect(getEntries()).toEqual([dinner]);
  });

  it('does not register an undo for an id it does not hold', () => {
    loadWeek();
    useMealPlanStore.getState().removeEntry('gone');
    expect(useMealPlanStore.getState().lastAction).toBeNull();
  });
});

describe('renameEntry', () => {
  it('rewrites a free-text entry title and writes it back', () => {
    const dinner = entry('2026-08-05', 'dinner', { title: 'Eating out' });
    loadWeek([dinner]);

    useMealPlanStore.getState().renameEntry(dinner.id, '  Takeout night  ');

    const updated = getEntries().find(e => e.id === dinner.id)!;
    expect(updated.title).toBe('Takeout night');
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: dinner.id, title: 'Takeout night' })
    );
  });

  it('refuses a blank title', () => {
    const dinner = entry('2026-08-05', 'dinner', { title: 'Eating out' });
    loadWeek([dinner]);

    useMealPlanStore.getState().renameEntry(dinner.id, '   ');

    expect(getEntries()[0].title).toBe('Eating out');
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('is a no-op on a recipe-backed entry', () => {
    const dinner = entry('2026-08-05', 'dinner', { title: 'Sausage ragù', recipeId: 'r1' });
    loadWeek([dinner]);

    useMealPlanStore.getState().renameEntry(dinner.id, 'Something else');

    expect(getEntries()[0].title).toBe('Sausage ragù');
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('is a no-op on a leftover-backed entry — the title carries its age', () => {
    const dinner = entry('2026-08-05', 'dinner', { title: 'Chilli (2 days old)', leftoverId: 'lo-1' });
    loadWeek([dinner]);

    useMealPlanStore.getState().renameEntry(dinner.id, 'Something else');

    expect(getEntries()[0].title).toBe('Chilli (2 days old)');
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('shrugs at an unknown id', () => {
    loadWeek([]);
    expect(() => useMealPlanStore.getState().renameEntry('gone', 'New title')).not.toThrow();
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });
});

describe('setRecipeChoices', () => {
  it('records the pick and writes it back', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().setRecipeChoices(dinner.id, ['c-roast']);

    expect(getEntries().find(e => e.id === dinner.id)!.recipeChoices).toEqual(['c-roast']);
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: dinner.id, recipeChoices: ['c-roast'] })
    );
  });

  it('replaces rather than merges, so going back to the default clears it', () => {
    const dinner = entry('2026-08-05', 'dinner', { recipeChoices: ['c-roast'] });
    loadWeek([dinner]);

    useMealPlanStore.getState().setRecipeChoices(dinner.id, []);

    expect(getEntries().find(e => e.id === dinner.id)!.recipeChoices).toEqual([]);
  });

  it('shrugs at an unknown entry', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbUpdateMealPlanEntry as jest.Mock).mockClear();

    useMealPlanStore.getState().setRecipeChoices('gone', ['c-roast']);

    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });
});

describe('setMealGuests', () => {
  it('records who is coming and writes it back', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().setMealGuests(dinner.id, ['p1', 'p2']);

    expect(getEntries().find(e => e.id === dinner.id)!.personIds).toEqual(['p1', 'p2']);
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: dinner.id, personIds: ['p1', 'p2'] })
    );
  });

  it('replaces rather than merges, so unticking somebody removes them', () => {
    const dinner = entry('2026-08-05', 'dinner', { personIds: ['p1', 'p2'] });
    loadWeek([dinner]);

    useMealPlanStore.getState().setMealGuests(dinner.id, ['p1']);

    expect(getEntries().find(e => e.id === dinner.id)!.personIds).toEqual(['p1']);
  });

  it('is a no-op for an entry that is not loaded', () => {
    loadWeek([]);
    useMealPlanStore.getState().setMealGuests('missing', ['p1']);
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });
});

describe('setRecipeScale', () => {
  it('records the factor and writes it back', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().setRecipeScale(dinner.id, 2);

    expect(getEntries().find(e => e.id === dinner.id)!.recipeScale).toBe(2);
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: dinner.id, recipeScale: 2 })
    );
  });

  it('goes back to as-written', () => {
    const dinner = entry('2026-08-05', 'dinner', { recipeScale: 0.5 });
    loadWeek([dinner]);

    useMealPlanStore.getState().setRecipeScale(dinner.id, 1);

    expect(getEntries().find(e => e.id === dinner.id)!.recipeScale).toBe(1);
  });

  it('clamps a nonsense factor to as-written rather than storing it', () => {
    const dinner = entry('2026-08-05', 'dinner', { recipeScale: 2 });
    loadWeek([dinner]);

    useMealPlanStore.getState().setRecipeScale(dinner.id, 0);

    expect(getEntries().find(e => e.id === dinner.id)!.recipeScale).toBe(1);
  });

  it('skips the write when the factor is unchanged', () => {
    const dinner = entry('2026-08-05', 'dinner', { recipeScale: 2 });
    loadWeek([dinner]);
    (dbUpdateMealPlanEntry as jest.Mock).mockClear();

    useMealPlanStore.getState().setRecipeScale(dinner.id, 2);

    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('is allowed on an already-cooked entry, same as a pick', () => {
    const dinner = entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' });
    loadWeek([dinner]);

    useMealPlanStore.getState().setRecipeScale(dinner.id, 2);

    expect(getEntries().find(e => e.id === dinner.id)!.recipeScale).toBe(2);
  });

  it('shrugs at an unknown entry', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    (dbUpdateMealPlanEntry as jest.Mock).mockClear();

    useMealPlanStore.getState().setRecipeScale('gone', 2);

    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });
});

describe('setCooked', () => {
  it('stamps cookedAt and writes it back', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().setCooked(dinner.id, true);

    const updated = getEntries().find(e => e.id === dinner.id)!;
    expect(updated.cookedAt).not.toBeNull();
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(expect.objectContaining({ id: dinner.id, cookedAt: expect.any(String) }));
  });

  // The half that used not to exist: a row could be ticked and never un-ticked
  // except through the bulk bar (#1361).
  it('clears cookedAt again', () => {
    const dinner = entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' });
    loadWeek([dinner]);

    useMealPlanStore.getState().setCooked(dinner.id, false);

    expect(getEntries().find(e => e.id === dinner.id)!.cookedAt).toBeNull();
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(expect.objectContaining({ id: dinner.id, cookedAt: null }));
  });

  // Idempotence is what holds the recipe's cookCount to one bump per cooking.
  it('is a no-op on an entry already in the target state', () => {
    const dinner = entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' });
    loadWeek([dinner]);

    useMealPlanStore.getState().setCooked(dinner.id, true);

    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('is a no-op un-cooking something that was never cooked', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().setCooked(dinner.id, false);

    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  // The undo is the caller's: marking cooked is two writes (this and the
  // recipe's counters) and only the caller knows they were one action.
  it('registers no undo of its own', () => {
    const dinner = entry('2026-08-05', 'dinner');
    loadWeek([dinner]);

    useMealPlanStore.getState().setCooked(dinner.id, true);

    expect(useMealPlanStore.getState().lastAction).toBeNull();
  });

  it('shrugs at an unknown id', () => {
    loadWeek([]);
    expect(() => useMealPlanStore.getState().setCooked('gone', true)).not.toThrow();
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });
});

describe('copyWeek', () => {
  it('writes the source week onto the target, shifted', () => {
    loadWeek();
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-08-05', 'dinner', { title: 'Ragù', recipeId: 'r1' }),
      entry('2026-08-07', 'lunch', { title: 'Soup' }),
    ]);

    const n = useMealPlanStore.getState().copyWeek('2026-08-03', '2026-08-10');

    expect(n).toBe(2);
    const written = (dbInsertMealPlanEntry as jest.Mock).mock.calls.map(c => c[0]);
    expect(written.map(e => [e.date, e.slot, e.title])).toEqual([
      ['2026-08-12', 'dinner', 'Ragù'],
      ['2026-08-14', 'lunch', 'Soup'],
    ]);
  });

  it('gives every copy its own id rather than reusing the source row', () => {
    loadWeek();
    const source = entry('2026-08-05', 'dinner');
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([source]);

    useMealPlanStore.getState().copyWeek('2026-08-03', '2026-08-10');

    const written = (dbInsertMealPlanEntry as jest.Mock).mock.calls[0][0];
    expect(written.id).not.toBe(source.id);
  });

  it('writes nothing and reports zero for an empty source week', () => {
    loadWeek();
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([]);

    expect(useMealPlanStore.getState().copyWeek('2026-08-03', '2026-08-10')).toBe(0);
    expect(dbInsertMealPlanEntry).not.toHaveBeenCalled();
    expect(useMealPlanStore.getState().lastAction).toBeNull();
  });

  it('holds the copies in memory when they land in the loaded window', () => {
    loadWeek();
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([entry('2026-07-30', 'dinner')]);

    // 27 Jul → 3 Aug, i.e. into the week loadWeek loaded.
    useMealPlanStore.getState().copyWeek('2026-07-27', '2026-08-03');

    expect(getEntries().map(e => e.date)).toEqual(['2026-08-06']);
  });

  // Same range-scoping invariant every other write here keeps.
  it('writes outside the loaded window without holding it', () => {
    loadWeek();
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([entry('2026-08-05', 'dinner')]);

    useMealPlanStore.getState().copyWeek('2026-08-03', '2026-09-14');

    expect(dbInsertMealPlanEntry).toHaveBeenCalledTimes(1);
    expect(getEntries()).toEqual([]);
  });

  // One action, one undo — a copy that took seven shakes to unpick would be
  // worse than no undo at all.
  it('undoes the whole copy in one go', () => {
    loadWeek();
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-07-30', 'dinner'),
      entry('2026-07-31', 'dinner'),
    ]);
    useMealPlanStore.getState().copyWeek('2026-07-27', '2026-08-03');
    expect(getEntries()).toHaveLength(2);

    useMealPlanStore.getState().undoLastAction();

    expect(getEntries()).toEqual([]);
    expect(dbDeleteMealPlanEntry).toHaveBeenCalledTimes(2);
  });
});

describe('findPlannedWeekBefore', () => {
  it('finds the most recent week that has anything in it', () => {
    (dbGetMealPlanEntries as jest.Mock)
      .mockReturnValueOnce([])                              // 1 week back
      .mockReturnValueOnce([entry('2026-07-29', 'dinner')]); // 2 weeks back

    expect(useMealPlanStore.getState().findPlannedWeekBefore('2026-08-10', 4))
      .toBe('2026-07-27');
  });

  it('takes last week when last week has something', () => {
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([entry('2026-08-05', 'dinner')]);
    expect(useMealPlanStore.getState().findPlannedWeekBefore('2026-08-10', 4))
      .toBe('2026-08-03');
  });

  it('gives up rather than searching forever', () => {
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([]);
    expect(useMealPlanStore.getState().findPlannedWeekBefore('2026-08-10', 4)).toBeNull();
    expect(dbGetMealPlanEntries).toHaveBeenCalledTimes(4);
  });
});

describe('purgeOldEntries', () => {
  it('reports what the delete took', () => {
    (dbPurgeOldMealPlanEntries as jest.Mock).mockReturnValue(4);
    expect(useMealPlanStore.getState().purgeOldEntries()).toBe(4);
  });

  it('passes a day key 180 days back', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 8));
    useMealPlanStore.getState().purgeOldEntries();
    expect(dbPurgeOldMealPlanEntries).toHaveBeenCalledWith('2026-02-09');
    jest.useRealTimers();
  });

  // The loaded window can overlap the horizon — someone paging back through
  // spring — so memory has to follow the delete rather than wait for a reload.
  it('drops purged days from the loaded window too', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 8));
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-02-08', 'dinner'),
      entry('2026-02-10', 'dinner'),
    ]);
    useMealPlanStore.getState().loadRange('2026-02-08', '2026-02-14');
    (dbPurgeOldMealPlanEntries as jest.Mock).mockReturnValue(1);

    useMealPlanStore.getState().purgeOldEntries();

    expect(getEntries().map(e => e.date)).toEqual(['2026-02-10']);
    jest.useRealTimers();
  });

  it('leaves the window alone when nothing was old enough', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    useMealPlanStore.getState().purgeOldEntries();
    expect(getEntries()).toHaveLength(1);
  });

  it('trims addedToListAt stamps past the same horizon', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 8));
    useMealPlanStore.setState({
      addedToListAt: { '2026-02-08': '2026-02-08T00:00:00.000Z', '2026-08-03': '2026-08-03T00:00:00.000Z' },
    });

    useMealPlanStore.getState().purgeOldEntries();

    expect(useMealPlanStore.getState().addedToListAt).toEqual({
      '2026-08-03': '2026-08-03T00:00:00.000Z',
    });
    expect(dbSetMealPlanAddedToList).toHaveBeenCalledWith({ '2026-08-03': '2026-08-03T00:00:00.000Z' });
    jest.useRealTimers();
  });

  it('does not touch storage when no stamp was old enough to trim', () => {
    useMealPlanStore.setState({ addedToListAt: { '2026-08-03': '2026-08-03T00:00:00.000Z' } });
    useMealPlanStore.getState().purgeOldEntries();
    expect(dbSetMealPlanAddedToList).not.toHaveBeenCalled();
  });
});

describe('undoLastAction', () => {
  it('is a no-op with nothing to undo', () => {
    loadWeek();
    expect(() => useMealPlanStore.getState().undoLastAction()).not.toThrow();
  });

  it('clears lastAction after undoing, so a second shake finds nothing', () => {
    loadWeek();
    useMealPlanStore.getState().planMeal({ date: '2026-08-05', slot: 'dinner', title: 'Roast' });
    useMealPlanStore.getState().undoLastAction();
    expect(useMealPlanStore.getState().lastAction).toBeNull();
  });
});

describe('stampAddedToList', () => {
  it('records now against the week key and persists it', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 12, 9, 30));
    useMealPlanStore.getState().stampAddedToList('2026-08-09');

    expect(useMealPlanStore.getState().addedToListAt['2026-08-09']).toBe(
      new Date(2026, 7, 12, 9, 30).toISOString()
    );
    expect(dbSetMealPlanAddedToList).toHaveBeenCalledWith(
      expect.objectContaining({ '2026-08-09': expect.any(String) })
    );
    jest.useRealTimers();
  });

  it('keeps stamps for other weeks rather than replacing the whole map', () => {
    useMealPlanStore.setState({ addedToListAt: { '2026-08-02': '2026-08-02T00:00:00.000Z' } });
    useMealPlanStore.getState().stampAddedToList('2026-08-09');

    const stamps = useMealPlanStore.getState().addedToListAt;
    expect(Object.keys(stamps).sort()).toEqual(['2026-08-02', '2026-08-09']);
  });
});

// Bulk selection (#1110).

describe('bulkDeleteEntries', () => {
  it('deletes every named row and drops it from the week', () => {
    const a = entry('2026-08-05', 'dinner');
    const b = entry('2026-08-06', 'lunch');
    const untouched = entry('2026-08-07', 'dinner');
    loadWeek([a, b, untouched]);

    useMealPlanStore.getState().bulkDeleteEntries([a.id, b.id]);

    expect(dbDeleteMealPlanEntry).toHaveBeenCalledWith(a.id);
    expect(dbDeleteMealPlanEntry).toHaveBeenCalledWith(b.id);
    expect(dbDeleteMealPlanEntry).toHaveBeenCalledTimes(2);
    expect(getEntries().map(e => e.id)).toEqual([untouched.id]);
  });

  it('does nothing for an empty selection', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    useMealPlanStore.getState().bulkDeleteEntries([]);
    expect(dbDeleteMealPlanEntry).not.toHaveBeenCalled();
  });

  // The confirm dialog tells the user this can't be undone — see the store's
  // doc comment. It must not register a lastAction that would quietly
  // contradict that.
  it('does not register an undo — the confirm dialog promises it cannot be undone', () => {
    const a = entry('2026-08-05', 'dinner');
    loadWeek([a]);
    useMealPlanStore.getState().bulkDeleteEntries([a.id]);
    expect(useMealPlanStore.getState().lastAction).toBeNull();
  });

  // Not registering one isn't enough on its own: the queue outlives the action
  // that filled it (UNDO_ACTION_MAX_AGE_MS), so a delete that only declined to
  // set a lastAction would leave the *previous* one armed — and a shake right
  // after "This can't be undone" would offer to undo something else entirely.
  it('clears an undo left by an earlier action rather than leaving it armed', () => {
    const a = entry('2026-08-05', 'dinner');
    loadWeek([a]);
    useMealPlanStore.getState().planMeal({ date: '2026-08-06', slot: 'dinner', title: 'Chilli' });
    expect(useMealPlanStore.getState().lastAction).not.toBeNull();

    useMealPlanStore.getState().bulkDeleteEntries([a.id]);

    expect(useMealPlanStore.getState().lastAction).toBeNull();
  });

  // Regression: reconcileMealSlot used to run before the `entries` array had
  // the removed rows filtered out of it, so it read the slot as still planned
  // and left the live task saying "Make X" forever — the same bug removeEntry
  // and copyWeek's undo already avoided by reconciling after the state write.
  it('puts the choosing back on the slot the removed meal vacated', () => {
    loadWeek();
    mockTaskState.addTask({
      ...mealSlotTaskDraft('2026-08-05', 'dinner', null, 'Meal Plan'),
    } as Partial<Task>);
    const meal = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragu',
    })!;
    const slotTaskFor = (dayKey: string, slot: MealSlot) =>
      mockTaskState.tasks.find(
        (t: Task) => t.generatedSourceId === mealSlotSourceId(dayKey, slot) && !t.completed
      );
    expect(slotTaskFor('2026-08-05', 'dinner')!.title).toBe('Ragu');

    useMealPlanStore.getState().bulkDeleteEntries([meal.id]);

    const task = slotTaskFor('2026-08-05', 'dinner')!;
    expect(task.title).toBe('Dinner');
    expect(task.chainItems.map((c: { title: string }) => c.title))
      .toEqual(['Choose dinner', 'Prepare dinner', 'Eat dinner']);
  });
});

describe('bulkMoveEntries', () => {
  it('moves every named entry to the new day', () => {
    const a = entry('2026-08-05', 'dinner');
    const b = entry('2026-08-05', 'lunch');
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkMoveEntries([a.id, b.id], { date: '2026-08-07' });

    expect(getEntries().map(e => [e.date, e.slot]).sort()).toEqual([
      ['2026-08-07', 'dinner'],
      ['2026-08-07', 'lunch'],
    ]);
  });

  it('orders two moved entries landing on the same slot against each other, not just against the table', () => {
    const a = entry('2026-08-05', 'dinner', { sortOrder: 1 });
    const b = entry('2026-08-06', 'lunch', { sortOrder: 1 });
    loadWeek([a, b]);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-08-07', 'dinner', { sortOrder: 5 }),
    ]);

    useMealPlanStore.getState().bulkMoveEntries([a.id, b.id], { date: '2026-08-07', slot: 'dinner' });

    const sortOrders = getEntries().map(e => e.sortOrder).sort((x, y) => x - y);
    expect(sortOrders).toEqual([6, 7]);
  });

  it('drops an entry moved out of the loaded window from memory', () => {
    const a = entry('2026-08-05', 'dinner');
    loadWeek([a]);

    useMealPlanStore.getState().bulkMoveEntries([a.id], { date: '2026-10-01' });

    expect(getEntries()).toEqual([]);
  });

  it('skips an entry that would land exactly where it already is', () => {
    const a = entry('2026-08-05', 'dinner');
    const b = entry('2026-08-05', 'lunch');
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkMoveEntries([a.id, b.id], { date: '2026-08-05', slot: 'dinner' });

    // Only b (lunch → dinner) actually moves; a is already there.
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledTimes(1);
    expect(getEntries().find(e => e.id === b.id)!.slot).toBe('dinner');
  });

  it('does nothing for an empty selection or an unchanged target', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    useMealPlanStore.getState().bulkMoveEntries([], { date: '2026-08-07' });
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('registers an undo that moves every entry back to its own original day and slot', () => {
    const a = entry('2026-08-05', 'dinner');
    const b = entry('2026-08-06', 'lunch');
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkMoveEntries([a.id, b.id], { date: '2026-08-07' });
    useMealPlanStore.getState().undoLastAction();

    expect(getEntries().map(e => [e.id, e.date, e.slot]).sort()).toEqual([
      [a.id, '2026-08-05', 'dinner'],
      [b.id, '2026-08-06', 'lunch'],
    ]);
  });
});

describe('bulkReplaceItem', () => {
  it('swaps the recipe and title on every named entry', () => {
    const a = entry('2026-08-05', 'dinner', { recipeId: 'old-recipe', title: 'Old ragù' });
    const b = entry('2026-08-06', 'dinner', { recipeId: 'old-recipe', title: 'Old ragù' });
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkReplaceItem([a.id, b.id], { recipeId: 'new-recipe', title: 'New ragù' });

    for (const e of getEntries()) {
      expect(e.recipeId).toBe('new-recipe');
      expect(e.title).toBe('New ragù');
    }
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledTimes(2);
  });

  it('accepts a free-text replacement with no recipe', () => {
    const a = entry('2026-08-05', 'dinner', { recipeId: 'r1', title: 'Sausage ragù' });
    loadWeek([a]);

    useMealPlanStore.getState().bulkReplaceItem([a.id], { recipeId: null, title: 'Takeout' });

    const updated = getEntries().find(e => e.id === a.id)!;
    expect(updated.recipeId).toBeNull();
    expect(updated.title).toBe('Takeout');
  });

  it('clears recipeChoices and leftoverId — a different item carries neither over', () => {
    const a = entry('2026-08-05', 'dinner', {
      recipeId: 'r1', recipeChoices: ['c-roast'], leftoverId: 'lo-1',
    });
    loadWeek([a]);

    useMealPlanStore.getState().bulkReplaceItem([a.id], { recipeId: 'r2', title: 'New dish' });

    const updated = getEntries().find(e => e.id === a.id)!;
    expect(updated.recipeChoices).toEqual([]);
    expect(updated.leftoverId).toBeNull();
  });

  it('leaves cookedAt untouched — relabelling a past night does not un-cook it', () => {
    const a = entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' });
    loadWeek([a]);

    useMealPlanStore.getState().bulkReplaceItem([a.id], { recipeId: null, title: 'New name' });

    expect(getEntries().find(e => e.id === a.id)!.cookedAt).toBe('2026-08-05T18:00:00.000Z');
  });

  it('refuses a blank title', () => {
    const a = entry('2026-08-05', 'dinner', { title: 'Original' });
    loadWeek([a]);

    useMealPlanStore.getState().bulkReplaceItem([a.id], { recipeId: null, title: '   ' });

    expect(getEntries()[0].title).toBe('Original');
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('registers an undo that restores every entry to its original recipe and title', () => {
    const a = entry('2026-08-05', 'dinner', {
      recipeId: 'old-recipe', title: 'Old ragù', recipeChoices: ['c-roast'], leftoverId: 'lo-1',
    });
    loadWeek([a]);

    useMealPlanStore.getState().bulkReplaceItem([a.id], { recipeId: 'new-recipe', title: 'New ragù' });
    useMealPlanStore.getState().undoLastAction();

    expect(getEntries()[0]).toEqual(a);
  });
});

describe('cookRecap', () => {
  /** A cooked meal of `recipe`, with the catalog holding `stocked`. */
  function cook(recipe: Recipe, stocked: GroceryItem[]) {
    mockRecipeState.recipes = [recipe];
    useGroceryStore.setState({ items: stocked });
    const dinner = entry('2026-08-05', 'dinner', { recipeId: recipe.id, title: recipe.name });
    loadWeek([dinner]);
    useMealPlanStore.getState().setCooked(dinner.id, true);
    return dinner;
  }

  const chili = () => recipeWith('Chili', ['soy sauce', 'cumin', 'gochujang']);

  it('is raised by a cook, naming the meal and the dish', () => {
    const dinner = cook(chili(), [onHand('soy sauce'), onHand('cumin')]);

    expect(useMealPlanStore.getState().cookRecap).toEqual({
      entryId: dinner.id,
      title: 'Chili',
      canLogLeftovers: true,
      recipeId: 'r-Chili',
      recipeName: 'Chili',
      choices: [],
      scale: 1,
    });
  });

  // The gate the used-up banner needed and a sheet doesn't: each section is
  // gated on its own subject, so a cooking the app can say nothing about the
  // pantry for still has a rating and a fridge to ask about. CookRecap is what
  // declines to open when every section turns out empty.
  it('is raised even when the app claims nothing about any of the ingredients', () => {
    cook(chili(), []);
    expect(useMealPlanStore.getState().cookRecap?.recipeName).toBe('Chili');
  });

  // A free-text meal has no ingredients and no rating, but it can still have
  // left half a tray of it in the fridge.
  it('is raised by a free-text meal, carrying no recipe', () => {
    useGroceryStore.setState({ items: [onHand('soy sauce')] });
    const dinner = entry('2026-08-05', 'dinner', { title: 'Leftover night curry' });
    loadWeek([dinner]);

    useMealPlanStore.getState().setCooked(dinner.id, true);

    expect(useMealPlanStore.getState().cookRecap).toMatchObject({
      title: 'Leftover night curry',
      canLogLeftovers: true,
      recipeId: null,
      recipeName: null,
    });
  });

  // Eating a tub of chilli closes that container out; it doesn't fill a new
  // one. The recap is still raised — the cooking may have used things up — but
  // with the fridge question withheld.
  it('withholds the leftovers question from a meal that is itself leftovers', () => {
    mockRecipeState.recipes = [];
    const e = entry('2026-08-05', 'dinner', { title: 'Chilli', leftoverId: 'lo-1' });
    loadWeek([e]);

    useMealPlanStore.getState().setCooked(e.id, true);

    expect(useMealPlanStore.getState().cookRecap?.canLogLeftovers).toBe(false);
  });

  it('withholds it from a meal with no name to call a container', () => {
    mockRecipeState.recipes = [];
    const e = entry('2026-08-05', 'dinner', { title: '  ' });
    loadWeek([e]);

    useMealPlanStore.getState().setCooked(e.id, true);

    expect(useMealPlanStore.getState().cookRecap?.canLogLeftovers).toBe(false);
  });

  it('is retracted by un-cooking — the tap it was about is undone', () => {
    const dinner = cook(chili(), [onHand('soy sauce')]);
    expect(useMealPlanStore.getState().cookRecap).not.toBeNull();

    useMealPlanStore.getState().setCooked(dinner.id, false);

    expect(useMealPlanStore.getState().cookRecap).toBeNull();
  });

  // Ticking the "Make X" task off on Today is a cooking too, and the whole
  // reason this lives in the store rather than on the meal plan screen. It is
  // also the path that used to raise the leftovers question all by itself.
  it('is raised by a cook logged from the task, leftovers question and all', () => {
    mockRecipeState.recipes = [chili()];
    useGroceryStore.setState({ items: [onHand('soy sauce')] });
    const dinner = entry('2026-08-05', 'dinner', { recipeId: 'r-Chili', title: 'Chili' });
    loadWeek([dinner]);

    useMealPlanStore.getState().setCookedPaired(dinner.id, true);

    expect(useMealPlanStore.getState().cookRecap).toMatchObject({
      recipeName: 'Chili',
      canLogLeftovers: true,
    });
  });

  it('is retracted by un-ticking that same task', () => {
    mockRecipeState.recipes = [chili()];
    const dinner = entry('2026-08-05', 'dinner', { recipeId: 'r-Chili', title: 'Chili' });
    loadWeek([dinner]);
    useMealPlanStore.getState().setCookedPaired(dinner.id, true);

    useMealPlanStore.getState().setCookedPaired(dinner.id, false);

    expect(useMealPlanStore.getState().cookRecap).toBeNull();
  });

  // Marking last week's dinners cooked on a Sunday is bookkeeping. Asking about
  // each of them would be asking someone to recall five kitchens.
  it('is never raised by a bulk mark', () => {
    mockRecipeState.recipes = [chili()];
    useGroceryStore.setState({ items: [onHand('soy sauce')] });
    const a = entry('2026-08-05', 'dinner', { recipeId: 'r-Chili', title: 'Chili' });
    const b = entry('2026-08-06', 'dinner', { recipeId: 'r-Chili', title: 'Chili' });
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkSetCooked([a.id, b.id], true);

    expect(useMealPlanStore.getState().cookRecap).toBeNull();
  });

  it('carries the entry’s own picks and batch, so it asks about what was actually made', () => {
    mockRecipeState.recipes = [chili()];
    useGroceryStore.setState({ items: [onHand('soy sauce')] });
    const dinner = entry('2026-08-05', 'dinner', {
      recipeId: 'r-Chili', title: 'Chili', recipeChoices: ['c-1'], recipeScale: 2,
    });
    loadWeek([dinner]);

    useMealPlanStore.getState().setCooked(dinner.id, true);

    expect(useMealPlanStore.getState().cookRecap).toMatchObject({ choices: ['c-1'], scale: 2 });
  });

  // Resolve-or-shrug at the point the pointer is captured, so the sheet's
  // sections don't each repeat a lookup that already failed.
  it('carries no recipe when the one it names has since been deleted', () => {
    mockRecipeState.recipes = [];
    const dinner = entry('2026-08-05', 'dinner', { recipeId: 'r-gone', title: 'Chili' });
    loadWeek([dinner]);

    useMealPlanStore.getState().setCooked(dinner.id, true);

    expect(useMealPlanStore.getState().cookRecap).toMatchObject({
      title: 'Chili',
      recipeId: null,
      recipeName: null,
    });
  });

  it('is cleared on request — skipped, or answered out', () => {
    cook(chili(), [onHand('soy sauce')]);

    useMealPlanStore.getState().clearCookRecap();

    expect(useMealPlanStore.getState().cookRecap).toBeNull();
  });
});

// The one claim a cooking makes without being asked: you cannot cook with a
// sealed jar. What it *used up* is still the offer's question above.
describe('a cooking marks what it used as opened', () => {
  const chili = () => recipeWith('Chili', ['soy sauce', 'cumin', 'gochujang']);
  const openedOf = (name: string) =>
    useGroceryStore.getState().items.find(i => i.name === name)?.openedAt ?? null;

  /** A meal of `recipe` on `date`, ticked cooked, with the catalog holding `stocked`. */
  function cookOn(date: string, recipe: Recipe, stocked: GroceryItem[]) {
    mockRecipeState.recipes = [recipe];
    useGroceryStore.setState({ items: stocked });
    const dinner = entry(date, 'dinner', { recipeId: recipe.id, title: recipe.name });
    loadWeek([dinner]);
    useMealPlanStore.getState().setCooked(dinner.id, true);
    return dinner;
  }

  it('opens the lines the app already claims you have', () => {
    cookOn('2026-08-05', chili(), [onHand('soy sauce'), onHand('cumin')]);

    expect(openedOf('soy sauce')).not.toBeNull();
    expect(openedOf('cumin')).not.toBeNull();
  });

  // Same restraint consumedRows imposes on the question: a standing "I always
  // have salt" isn't a packet, and a row the app doesn't think you have wasn't
  // what got cooked with.
  it('leaves a staple and a row it does not claim you have alone', () => {
    cookOn('2026-08-05', recipeWith('Chili', ['salt', 'cumin']), [
      { ...onHand('salt'), isStaple: true },
      { ...onHand('cumin'), onHandUntil: '2026-01-01T00:00:00.000Z' },
    ]);

    expect(openedOf('salt')).toBeNull();
    expect(openedOf('cumin')).toBeNull();
  });

  // A Tuesday dinner is routinely ticked off on Thursday, and openedAt re-dates
  // a use-by day — stamping the tap would hand the jar the days in between.
  it('dates the opening to the meal’s own day once that day has passed', () => {
    cookOn('2026-08-05', chili(), [onHand('soy sauce')]);

    expect(openedOf('soy sauce')).toBe(new Date('2026-08-05T12:00:00').toISOString());
  });

  it('dates today’s cooking to now', () => {
    const today = dayKeyOf(new Date());
    const before = Date.now();
    cookOn(today, chili(), [onHand('soy sauce')]);

    const opened = Date.parse(openedOf('soy sauce')!);
    expect(opened).toBeGreaterThanOrEqual(before);
    expect(opened).toBeLessThanOrEqual(Date.now());
  });

  // Bookkeeping, for the same reason the offer refuses it: the opening dates
  // would be the Sunday somebody caught up on, not the nights they cooked.
  it('is never written by a bulk mark', () => {
    mockRecipeState.recipes = [chili()];
    useGroceryStore.setState({ items: [onHand('soy sauce')] });
    const a = entry('2026-08-05', 'dinner', { recipeId: 'r-Chili', title: 'Chili' });
    const b = entry('2026-08-06', 'dinner', { recipeId: 'r-Chili', title: 'Chili' });
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkSetCooked([a.id, b.id], true);

    expect(openedOf('soy sauce')).toBeNull();
  });

  // The store can't tell an undo from "I haven't cooked this after all", and
  // the same cooking's other write isn't retracted either. Resealing is a tap
  // on the item's own sheet.
  it('is not retracted by un-cooking', () => {
    const dinner = cookOn('2026-08-05', chili(), [onHand('soy sauce')]);

    useMealPlanStore.getState().setCooked(dinner.id, false);

    expect(openedOf('soy sauce')).not.toBeNull();
  });

  it('opens nothing for a free-text meal, which has no ingredients', () => {
    useGroceryStore.setState({ items: [onHand('soy sauce')] });
    const dinner = entry('2026-08-05', 'dinner', { title: 'Takeout' });
    loadWeek([dinner]);

    useMealPlanStore.getState().setCooked(dinner.id, true);

    expect(openedOf('soy sauce')).toBeNull();
  });
});

describe('bulkSetCooked', () => {
  it('stamps cookedAt on every named entry not already cooked', () => {
    const a = entry('2026-08-05', 'dinner');
    const b = entry('2026-08-06', 'lunch');
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkSetCooked([a.id, b.id], true);

    for (const e of getEntries()) expect(e.cookedAt).not.toBeNull();
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledTimes(2);
  });

  it('clears cookedAt on every named entry that has one', () => {
    const a = entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' });
    loadWeek([a]);

    useMealPlanStore.getState().bulkSetCooked([a.id], false);

    expect(getEntries()[0].cookedAt).toBeNull();
  });

  it('is idempotent — an entry already at the target state is not rewritten', () => {
    const alreadyCooked = entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' });
    const alreadyRaw = entry('2026-08-06', 'lunch');
    loadWeek([alreadyCooked, alreadyRaw]);

    useMealPlanStore.getState().bulkSetCooked([alreadyCooked.id], true);
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();

    useMealPlanStore.getState().bulkSetCooked([alreadyRaw.id], false);
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('does nothing for an empty selection', () => {
    loadWeek([entry('2026-08-05', 'dinner')]);
    useMealPlanStore.getState().bulkSetCooked([], true);
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
  });

  it('registers an undo that restores each entry to its own original cookedAt', () => {
    const a = entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' });
    const b = entry('2026-08-06', 'lunch', { cookedAt: null });
    loadWeek([a, b]);

    useMealPlanStore.getState().bulkSetCooked([a.id, b.id], true);
    useMealPlanStore.getState().undoLastAction();

    const byId = new Map(getEntries().map(e => [e.id, e]));
    expect(byId.get(a.id)!.cookedAt).toBe('2026-08-05T18:00:00.000Z');
    expect(byId.get(b.id)!.cookedAt).toBeNull();
  });
});


// ─── Cook tasks (#1402) ─────────────────────────────────────────────────────

describe('meal tasks', () => {
  /**
   * A meal task as `checkMealSlotTasks` would have laid it down that morning —
   * planted directly, because creating one is deliberately not this store's
   * job. That split is the thing most of these tests are about: the meal plan
   * only ever *updates* the row the daily pass wrote, so that swiping today's
   * lunch away isn't undone by planning lunch (see reconcileMealSlot).
   */
  function plantSlotTask(dayKey: string, slot: MealSlot, entry: MealPlanEntry | null = null) {
    return mockTaskState.addTask({
      ...mealSlotTaskDraft(dayKey, slot, entry, 'Meal Plan'),
    } as Partial<Task>);
  }

  const slotTaskFor = (dayKey: string, slot: MealSlot) =>
    mockTaskState.tasks.find(
      t => t.generatedSourceId === mealSlotSourceId(dayKey, slot) && !t.completed
    );

  it('plants as a three-step chain when the slot is empty', () => {
    const task = plantSlotTask('2026-08-05', 'lunch');
    expect(task.title).toBe('Lunch');
    expect(task.generatedKind).toBe('mealSlot');
    expect(task.generatedSourceId).toBe('2026-08-05#lunch');
    expect(task.chainEnabled).toBe(true);
    expect(task.chainItems.map(c => c.title))
      .toEqual(['Choose lunch', 'Prepare lunch', 'Eat lunch']);
    // Choose lunch isn't hidden — it's step 0 of 3, nowhere near the meal
    // itself. Only Eat lunch, the step that finishes the chain, hides until
    // afternoon.
    expect(task.timeSegments).toEqual([]);
    // And its link opens the picker already on the right slot.
    expect(task.linkUrl).toBe('dundundun://mealplan?date=2026-08-05&pick=lunch');
  });

  it('planning a meal never creates a task — only the daily pass does', () => {
    loadWeek();
    useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Frijoles de la olla',
    });
    expect(mockTaskState.addTask).not.toHaveBeenCalled();
  });

  it('planning a recipe rewrites the live row past its first step', () => {
    loadWeek();
    plantSlotTask('2026-08-05', 'dinner');
    mockTaskState.addTask.mockClear();

    useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Frijoles de la olla',
    });

    const task = slotTaskFor('2026-08-05', 'dinner')!;
    // "Already chosen" is the same task with its first step gone.
    expect(task.chainItems.map(c => c.title))
      .toEqual(['Make Frijoles de la olla', 'Eat Frijoles de la olla']);
    expect(task.title).toBe('Frijoles de la olla');
    // Answered with a recipe, so the link opens that instead of the day.
    expect(task.linkUrl).toBe('dundundun://recipe?id=r1');
    expect(mockTaskState.addTask).not.toHaveBeenCalled();
  });

  it('a leftover or a takeaway leaves one step and no chain at all', () => {
    loadWeek();
    plantSlotTask('2026-08-05', 'dinner');

    useMealPlanStore.getState().planMeal({ date: '2026-08-05', slot: 'dinner', title: 'Takeaway' });

    const task = slotTaskFor('2026-08-05', 'dinner')!;
    // There is nothing to cook, so there is nothing to step through — and a
    // single-item chain reads as a plain task everywhere anyway.
    expect(task.chainEnabled).toBe(false);
    expect(task.title).toBe('Eat Takeaway');
  });

  it('clearing the slot puts the choosing back', () => {
    loadWeek();
    plantSlotTask('2026-08-05', 'dinner');
    const meal = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragu',
    })!;
    expect(slotTaskFor('2026-08-05', 'dinner')!.title).toBe('Ragu');

    useMealPlanStore.getState().removeEntry(meal.id);

    const task = slotTaskFor('2026-08-05', 'dinner')!;
    expect(task.title).toBe('Dinner');
    expect(task.chainItems.map(c => c.title))
      .toEqual(['Choose dinner', 'Prepare dinner', 'Eat dinner']);
    // The row itself survives the meal — it's the day's dinner question, not
    // the meal's task.
    expect(mockTaskState.deleteTask).not.toHaveBeenCalled();
  });

  it('a move rewrites both slots', () => {
    // Two slots change, and only one of them is the one being moved to. The
    // dates are already right on both — a meal task's day comes from its source
    // id and never moves, so a meal changing day is two rows changing content.
    loadWeek();
    plantSlotTask('2026-08-05', 'dinner');
    plantSlotTask('2026-08-07', 'breakfast');
    const meal = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragu',
    })!;

    useMealPlanStore.getState().moveEntry(meal.id, { date: '2026-08-07', slot: 'breakfast' });

    // Where it landed…
    const landed = slotTaskFor('2026-08-07', 'breakfast')!;
    expect(landed.title).toBe('Ragu');
    expect(landed.dueDate!.startsWith('2026-08-07')).toBe(true);
    // …and the slot it left, which is the half a one-sided reconcile misses.
    expect(slotTaskFor('2026-08-05', 'dinner')!.title).toBe('Dinner');

    // Never the date: that's the user's to move, and rewriting a row they
    // deferred back onto today is the one thing this must not do.
    expect(mockTaskState.updateTask.mock.calls.every(call => !('dueDate' in call[1]))).toBe(true);
    // Written as a consequence of the meal moving, not as the user ducking it.
    expect(mockTaskState.updateTask.mock.calls[0][2]).toEqual({ skipPostponeCount: true });
  });

  it('retitles the row when the meal is renamed', () => {
    loadWeek();
    plantSlotTask('2026-08-05', 'dinner');
    const meal = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', title: 'Beans',
    })!;
    useMealPlanStore.getState().renameEntry(meal.id, 'Frijoles');
    expect(slotTaskFor('2026-08-05', 'dinner')!.title).toBe('Eat Frijoles');
  });

  it('leaves the steps alone once the chain has been started', () => {
    // chainIndex > 0 means a step has been ticked and the next row spawned, and
    // the index is only meaningful against the list it came from. Step 1 of
    // [Choose, Prepare, Eat] has no honest answer in [Make X, Eat X].
    loadWeek();
    const planted = plantSlotTask('2026-08-05', 'dinner');
    mockTaskState.updateTask(planted.id, { chainIndex: 1 } as Partial<Task>);

    useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragu',
    });

    const task = slotTaskFor('2026-08-05', 'dinner')!;
    expect(task.chainItems.map(c => c.title))
      .toEqual(['Choose dinner', 'Prepare dinner', 'Eat dinner']);
    // The fields that aren't the steps still chase the meal.
    expect(task.title).toBe('Ragu');
  });

  it('leaves a cooked meal alone rather than re-titling its row', () => {
    loadWeek([entry('2026-08-05', 'dinner', {
      recipeId: 'r1', title: 'Ragu', cookedAt: '2026-08-05T18:00:00.000Z',
    })]);
    plantSlotTask('2026-08-05', 'dinner');
    const cooked = getEntries()[0];
    mockTaskState.updateTask.mockClear();

    useMealPlanStore.getState().moveEntry(cooked.id, { date: '2026-08-07' });
    // The night has happened; re-dating its row at that point edits history.
    expect(mockTaskState.updateTask).not.toHaveBeenCalled();
  });

  it('setCookTask(false) removes the row and stops it coming back', () => {
    // The per-meal "no" survives the fold — it's the one thing a meal task
    // inherits from the cook task it replaces.
    loadWeek();
    plantSlotTask('2026-08-05', 'dinner');
    const meal = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragu',
    })!;
    expect(slotTaskFor('2026-08-05', 'dinner')).toBeDefined();

    useMealPlanStore.getState().setCookTask(meal.id, false);
    expect(slotTaskFor('2026-08-05', 'dinner')).toBeUndefined();
    // Deleted as the app tidying up, not as the user deciding — so no opt-out
    // is written back onto the row that already says it.
    expect(mockTaskState.deleteTask).toHaveBeenCalledWith(
      expect.any(String), { skipGeneratedOptOut: true }
    );
  });

  it('marking cooked walks the whole chain, not just its current step', () => {
    // A cook task answered "did this happen" by existing. A chain's first tick
    // is "I have decided what to have", so ticking one step from here would
    // leave "Eat dinner" outstanding on a night already marked cooked.
    loadWeek();
    plantSlotTask('2026-08-05', 'dinner');
    const meal = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragu',
    })!;

    useMealPlanStore.getState().setCooked(meal.id, true);

    expect(slotTaskFor('2026-08-05', 'dinner')).toBeUndefined();
    expect(mockTaskState.completeTask).toHaveBeenCalled();
  });

  it('un-ticking a cooked meal reopens the step that ended the chain', () => {
    loadWeek();
    const planted = plantSlotTask('2026-08-05', 'dinner');
    const meal = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', title: 'Takeaway',
    })!;
    useMealPlanStore.getState().setCooked(meal.id, true);
    mockTaskState.uncompleteTask.mockClear();

    useMealPlanStore.getState().setCooked(meal.id, false);
    expect(mockTaskState.uncompleteTask).toHaveBeenCalledWith(planted.id);
  });

  it('setCookedPaired resolves an entry outside the loaded window', () => {
    const offscreen = entry('2026-09-20', 'dinner', { recipeId: 'r1' });
    (dbGetMealPlanEntry as jest.Mock).mockReturnValue(offscreen);
    loadWeek();

    const undo = useMealPlanStore.getState().setCookedPaired(offscreen.id, true);
    expect(undo).not.toBeNull();
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: offscreen.id, cookedAt: expect.any(String) })
    );
  });

  it('setCookedPaired returns null when there is nothing to do', () => {
    loadWeek([entry('2026-08-05', 'dinner', { cookedAt: '2026-08-05T18:00:00.000Z' })]);
    const cooked = getEntries()[0];
    expect(useMealPlanStore.getState().setCookedPaired(cooked.id, true)).toBeNull();
    expect(useMealPlanStore.getState().setCookedPaired('nope', true)).toBeNull();
  });

  it('setCookTask(true) is the one way a row appears outside the daily pass', () => {
    // An explicit per-meal yes beats the day's set of meals, the same way the
    // cook task's own tri-state beat the global setting: a lunch you cook once
    // a month can have a task without lunch being a meal you want asked about
    // every day.
    loadWeek();
    const meal = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'lunch', recipeId: 'r1', title: 'Ragu',
    })!;
    expect(slotTaskFor('2026-08-05', 'lunch')).toBeUndefined();

    useMealPlanStore.getState().setCookTask(meal.id, true);

    const task = slotTaskFor('2026-08-05', 'lunch')!;
    expect(task.chainItems.map(c => c.title)).toEqual(['Make Ragu', 'Eat Ragu']);
  });

  it('a slot with no task is left alone entirely', () => {
    // Every mutation reconciles, and most days have no meal task at all — a
    // slot nobody enabled, a day the pass hasn't reached. None of them should
    // write anything.
    loadWeek();
    const meal = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragu',
    })!;
    useMealPlanStore.getState().moveEntry(meal.id, { date: '2026-08-06' });
    useMealPlanStore.getState().removeEntry(meal.id);

    expect(mockTaskState.addTask).not.toHaveBeenCalled();
    expect(mockTaskState.updateTask).not.toHaveBeenCalled();
    expect(mockTaskState.deleteTask).not.toHaveBeenCalled();
  });
});

describe('meal tasks and the undo queue', () => {
  it('arms no task-store undo when setCookTask(false) takes a row', () => {
    loadWeek();
    mockTaskState.addTask({
      ...mealSlotTaskDraft('2026-08-05', 'dinner', null, 'Meal Plan'),
    } as Partial<Task>);
    const meal = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragu',
    })!;

    useMealPlanStore.getState().setCookTask(meal.id, false);

    // The meal's own answer owns this; a competing "Task deleted" under the
    // next shake would be a second offer for one gesture.
    expect(mockTaskState.setLastAction).toHaveBeenCalledWith(null);
  });

  it('leaves nothing armed after a bulk delete that promised it could not be undone', () => {
    loadWeek();
    const a = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragu',
    })!;
    const b = useMealPlanStore.getState().planMeal({
      date: '2026-08-06', slot: 'dinner', recipeId: 'r2', title: 'Salmon',
    })!;

    useMealPlanStore.getState().bulkDeleteEntries([a.id, b.id]);

    expect(useMealPlanStore.getState().lastAction).toBeNull();
  });
});

describe('calendar events (#1494)', () => {
  /** Lets the fire-and-forget reconcile settle before asserting on it. */
  const settle = () => new Promise<void>(resolve => setImmediate(resolve));

  it('writes nothing while no calendar is picked', async () => {
    loadWeek();
    useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragu',
    });
    await settle();

    expect(mockCreateAllDayEvent).not.toHaveBeenCalled();
    expect(getEntries()[0].calendarEventId).toBeNull();
  });

  it('creates an all-day event for a planned meal and links it back', async () => {
    mockMealCalendarId = 'cal-1';
    loadWeek();
    const meal = useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragu',
    })!;
    await settle();

    expect(mockCreateAllDayEvent).toHaveBeenCalledWith('cal-1', {
      title: 'Dinner: Ragu',
      date: expect.any(Date),
    });
    // The id is persisted, not just held in memory — otherwise the next
    // reconcile writes a second event for the same night.
    expect(getEntries().find(e => e.id === meal.id)!.calendarEventId).toBe('evt-new');
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: meal.id, calendarEventId: 'evt-new' })
    );
  });

  it('updates the existing event in place when a meal moves day', async () => {
    mockMealCalendarId = 'cal-1';
    loadWeek([entry('2026-08-05', 'dinner', { id: 'm-a', title: 'Ragu', calendarEventId: 'evt-1' })]);

    useMealPlanStore.getState().moveEntry('m-a', { date: '2026-08-07' });
    await settle();

    expect(mockUpdateAllDayEvent).toHaveBeenCalledWith('evt-1', expect.objectContaining({
      title: 'Dinner: Ragu',
    }));
    expect(mockCreateAllDayEvent).not.toHaveBeenCalled();
  });

  it('renames the event when the meal is renamed', async () => {
    mockMealCalendarId = 'cal-1';
    loadWeek([entry('2026-08-05', 'dinner', { id: 'm-a', title: 'Ragu', calendarEventId: 'evt-1' })]);

    useMealPlanStore.getState().renameEntry('m-a', 'Lasagne');
    await settle();

    expect(mockUpdateAllDayEvent).toHaveBeenCalledWith('evt-1', expect.objectContaining({
      title: 'Dinner: Lasagne',
    }));
  });

  it('deletes the event when the meal is removed', async () => {
    mockMealCalendarId = 'cal-1';
    loadWeek([entry('2026-08-05', 'dinner', { id: 'm-a', calendarEventId: 'evt-1' })]);

    useMealPlanStore.getState().removeEntry('m-a');

    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith('evt-1');
  });

  it('deletes the event of a meal whose id was only just written back', async () => {
    // The undo closure captured the entry before reconcileMealEvent had an id
    // to write, so dropMealEvent has to re-resolve the row — trusting the
    // closure's copy leaks the event for good.
    mockMealCalendarId = 'cal-1';
    loadWeek();
    useMealPlanStore.getState().planMeal({
      date: '2026-08-05', slot: 'dinner', recipeId: 'r1', title: 'Ragu',
    });
    await settle();

    useMealPlanStore.getState().undoLastAction();

    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith('evt-new');
  });

  it('deletes every event a bulk delete takes', async () => {
    mockMealCalendarId = 'cal-1';
    loadWeek([
      entry('2026-08-05', 'dinner', { id: 'm-a', calendarEventId: 'evt-1' }),
      entry('2026-08-06', 'dinner', { id: 'm-b', calendarEventId: 'evt-2' }),
    ]);

    useMealPlanStore.getState().bulkDeleteEntries(['m-a', 'm-b']);

    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith('evt-1');
    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith('evt-2');
  });

  it('gives a copied week its own events rather than the source week\'s', async () => {
    mockMealCalendarId = 'cal-1';
    loadWeek();
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      entry('2026-08-05', 'dinner', { id: 'm-a', title: 'Ragu', calendarEventId: 'evt-1' }),
    ]);

    useMealPlanStore.getState().copyWeek('2026-08-03', '2026-08-10');
    await settle();

    // Two rows pointing at one device event means whichever reconciles last
    // rewrites the other's night.
    expect(mockUpdateAllDayEvent).not.toHaveBeenCalledWith('evt-1', expect.anything());
    expect(mockCreateAllDayEvent).toHaveBeenCalledWith('cal-1', expect.objectContaining({
      title: 'Dinner: Ragu',
    }));
  });

  it('leaves a cooked meal on the calendar when it is ticked off', async () => {
    mockMealCalendarId = 'cal-1';
    loadWeek([entry('2026-08-05', 'dinner', { id: 'm-a', calendarEventId: 'evt-1' })]);

    useMealPlanStore.getState().setCooked('m-a', true);
    await settle();

    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
  });
});

// ─── finishCookForRecipe — Done on a cook timer's Live Activity ─────────────
//
// The recipe-shaped door onto the pairing setCookedPaired is the entry-shaped
// door onto: the caller knows which dish came off the heat and nothing else.
describe('finishCookForRecipe', () => {
  const today = dayKeyOf(new Date());
  const stats = { cookCount: 3, lastCookedAt: '2026-01-01T00:00:00.000Z' };

  /**
   * Today's plan as SQLite would answer it. Both reads are stubbed because
   * both happen for real: this action reads the day, and `setCookedPaired`
   * re-resolves the row it names — an entry outside the loaded window is the
   * normal case here, since the plan screen may never have been opened.
   */
  function planToday(rows: MealPlanEntry[]) {
    const byId = new Map(rows.map(r => [r.id, r]));
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue(rows);
    (dbGetMealPlanEntry as jest.Mock).mockImplementation((id: string) => byId.get(id) ?? null);
    // Writes land back in the map, so the undo below re-resolves the row as it
    // now stands rather than as it was — otherwise `setCooked`'s own guard
    // reads it as already un-ticked and does nothing.
    (dbUpdateMealPlanEntry as jest.Mock).mockImplementation((row: MealPlanEntry) => {
      byId.set(row.id, row);
    });
  }

  afterEach(() => {
    (dbUpdateMealPlanEntry as jest.Mock).mockReset();
  });

  beforeEach(() => {
    // The pairing looks the recipe up before it bumps anything, so the library
    // has to hold the dish being cooked in every one of these.
    mockRecipeState.recipes = [{ ...recipeWith('Ragu', []), id: 'r1' }];
    mockRecipeState.markCooked.mockReturnValue(stats);
  });

  it('ticks off today’s planned meal for that recipe', () => {
    const dinner = entry(today, 'dinner', { recipeId: 'r1', title: 'Ragu' });
    planToday([dinner]);

    useMealPlanStore.getState().finishCookForRecipe('r1');

    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: dinner.id, cookedAt: expect.any(String) })
    );
    expect(mockRecipeState.markCooked).toHaveBeenCalledWith('r1');
  });

  // The post-cook sheet is the point of preferring the plan: the rating, the
  // fridge and the used-up ingredients are questions about the cooking, not
  // about which surface the tap landed on.
  it('raises the post-cook sheet, same as ticking the row would', () => {
    mockRecipeState.recipes = [recipeWith('Chili', ['soy sauce', 'cumin'])];
    useGroceryStore.setState({ items: [onHand('soy sauce')] });
    planToday([entry(today, 'dinner', { recipeId: 'r-Chili', title: 'Chili' })]);

    useMealPlanStore.getState().finishCookForRecipe('r-Chili');

    expect(useMealPlanStore.getState().cookRecap).toMatchObject({ recipeName: 'Chili' });
  });

  // The loaded window is whatever the plan screen last asked for, and is empty
  // until someone opens it — a cook started from the recipe library must still
  // find the meal it was planned as.
  it('reads the day straight from SQLite rather than the loaded window', () => {
    loadWeek();
    const dinner = entry(today, 'dinner', { recipeId: 'r1', title: 'Ragu' });
    planToday([dinner]);

    useMealPlanStore.getState().finishCookForRecipe('r1');

    expect(dbGetMealPlanEntries).toHaveBeenLastCalledWith(today, today);
    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: dinner.id, cookedAt: expect.any(String) })
    );
  });

  it('bumps the recipe’s own counters when nothing on the plan matches', () => {
    planToday([entry(today, 'dinner', { recipeId: 'r2', title: 'Something else' })]);

    useMealPlanStore.getState().finishCookForRecipe('r1');

    expect(mockRecipeState.markCooked).toHaveBeenCalledWith('r1');
    expect(dbUpdateMealPlanEntry).not.toHaveBeenCalled();
    // No entry, so no sheet — CookRecap is built around an entry id.
    expect(useMealPlanStore.getState().cookRecap).toBeNull();
  });

  it('does nothing at all for a recipe that no longer exists', () => {
    mockRecipeState.recipes = [];

    useMealPlanStore.getState().finishCookForRecipe('r-gone');

    expect(mockRecipeState.markCooked).not.toHaveBeenCalled();
    expect(useMealPlanStore.getState().lastAction).toBeNull();
  });

  // A Done pressed by accident on a Lock Screen is exactly the tap worth being
  // able to take back: lastCookedAt steers the suggestion ranking for weeks.
  it('registers an undo that puts the meal and the counters back', () => {
    const dinner = entry(today, 'dinner', { recipeId: 'r1', title: 'Ragu' });
    planToday([dinner]);

    useMealPlanStore.getState().finishCookForRecipe('r1');
    const action = useMealPlanStore.getState().lastAction!;
    expect(action.label).toBe('Cooked "Ragu"');

    action.undo();

    expect(dbUpdateMealPlanEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: dinner.id, cookedAt: null })
    );
    expect(mockRecipeState.restoreCookStats).toHaveBeenCalledWith('r1', stats);
  });

  it('registers an undo for the off-plan cooking too', () => {
    useMealPlanStore.getState().finishCookForRecipe('r1');
    const action = useMealPlanStore.getState().lastAction!;
    expect(action.label).toBe('Cooked "Ragu"');

    action.undo();

    expect(mockRecipeState.restoreCookStats).toHaveBeenCalledWith('r1', stats);
  });

  // A dish cooked twice in a day ticks the row that hasn't happened yet.
  it('skips a row already ticked off and takes the next one', () => {
    const lunch = entry(today, 'lunch', {
      recipeId: 'r1', title: 'Ragu', cookedAt: '2026-01-01T12:00:00.000Z',
    });
    const dinner = entry(today, 'dinner', { recipeId: 'r1', title: 'Ragu' });
    planToday([lunch, dinner]);

    useMealPlanStore.getState().finishCookForRecipe('r1');

    expect(dbUpdateMealPlanEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: dinner.id, cookedAt: expect.any(String) })
    );
  });
});
