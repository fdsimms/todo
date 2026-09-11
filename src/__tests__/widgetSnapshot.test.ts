import {
  buildGroceries,
  buildKitchen,
  buildMeals,
  buildWidgetSnapshot,
  isWidgetWorthy,
  toWidgetTask,
} from '../utils/widgetSnapshot';
import type {
  GroceryItem,
  GroceryList,
  GroceryListEntry,
  MealPlanEntry,
  Recipe,
  Shop,
  Task,
} from '../types';
import type { KitchenEntry } from '../utils/kitchenInventory';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

// visibilityUtils reaches the category store for displayTitleFor's sake, and
// that store opens the database at import time — the same stub every other
// node-env test of a visibilityUtils consumer keeps.
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: jest.fn(() => ({
      categories: [],
      getCategoryByName: jest.fn().mockReturnValue(null),
    })),
  },
}));

const NOW = new Date(2026, 7, 6, 9, 0, 0); // Thu Aug 6 2026, 9 AM

const makeTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    title: 'Task',
    completed: false,
    archived: false,
    parentId: null,
    dueDate: null,
    deadline: null,
    priority: 'none',
    pinned: false,
    category: null,
    streakCount: 0,
    recurrenceType: 'none',
    targetCount: null,
    progressCount: 0,
    targetUnit: null,
    polarity: 'positive',
    generatedKind: null,
    ...overrides,
  }) as Task;

const makeItem = (overrides: Partial<GroceryItem> = {}): GroceryItem =>
  ({ id: 'i1', name: 'Milk', sortOrder: 0, checked: false, onList: true, ...overrides }) as GroceryItem;

const makeEntry = (overrides: Partial<GroceryListEntry> = {}): GroceryListEntry => ({
  itemId: 'i1',
  listId: null,
  checked: false,
  sortOrder: 0,
  choiceGroup: null,
  addedAt: NOW.toISOString(),
  ...overrides,
});

const groceryInput = (overrides: Partial<Parameters<typeof buildGroceries>[0]> = {}) => ({
  lists: [] as GroceryList[],
  listEntries: [] as GroceryListEntry[],
  items: [] as GroceryItem[],
  activeListId: null,
  shops: [] as Shop[],
  tripShopId: null,
  tripStartedAt: null,
  ...overrides,
});

const snapshotInput = (overrides: Partial<Parameters<typeof buildWidgetSnapshot>[0]> = {}) => ({
  now: NOW,
  visibleTasks: [] as Task[],
  pinnedTasks: [] as Task[],
  allTasks: [] as Task[],
  categories: [] as string[],
  dayResetTime: '00:00',
  doneToday: 0,
  grocery: null,
  meals: null,
  recipes: [] as Recipe[],
  kitchen: null,
  ...overrides,
});

describe('isWidgetWorthy', () => {
  it('drops a negative habit, whose checkbox the widget could not honour', () => {
    expect(isWidgetWorthy(makeTask({ polarity: 'negative' }))).toBe(false);
  });

  it('drops the meal-plan nudge stack, which reads as bare dates off its header', () => {
    expect(isWidgetWorthy(makeTask({ generatedKind: 'mealPlanNudge' } as Partial<Task>))).toBe(false);
  });

  it('keeps an ordinary task', () => {
    expect(isWidgetWorthy(makeTask())).toBe(true);
  });
});

describe('toWidgetTask', () => {
  it('carries a daily target as its parts rather than as a rendered fraction', () => {
    const row = toWidgetTask(makeTask({ targetCount: 8, progressCount: 3, targetUnit: 'glasses' }));
    expect(row.targetCount).toBe(8);
    expect(row.progressCount).toBe(3);
    expect(row.targetUnit).toBe('glasses');
  });

  it('leaves targetCount null on an ordinary task', () => {
    expect(toWidgetTask(makeTask()).targetCount).toBeNull();
  });
});

describe('buildGroceries', () => {
  it('puts the home list first when nothing else is active', () => {
    const built = buildGroceries(
      groceryInput({ lists: [{ id: 'l1', name: 'Airbnb' } as GroceryList] }),
      NOW
    );
    expect(built.lists.map(l => l.id)).toEqual([null, 'l1']);
  });

  it('puts the active list first', () => {
    const built = buildGroceries(
      groceryInput({ lists: [{ id: 'l1', name: 'Airbnb' } as GroceryList], activeListId: 'l1' }),
      NOW
    );
    expect(built.lists[0].id).toBe('l1');
    expect(built.lists[0].name).toBe('Airbnb');
  });

  it('counts only the rows still to buy, and names only those', () => {
    const built = buildGroceries(
      groceryInput({
        items: [makeItem(), makeItem({ id: 'i2', name: 'Bread', sortOrder: 1 })],
        listEntries: [makeEntry(), makeEntry({ itemId: 'i2', sortOrder: 1, checked: true })],
      }),
      NOW
    );
    expect(built.lists[0].remaining).toBe(1);
    expect(built.lists[0].items).toEqual(['Milk']);
  });

  it('reports a live trip as a name and the raw stamp, leaving the minutes to Swift', () => {
    const startedAt = new Date(NOW.getTime() - 20 * 60_000).toISOString();
    const built = buildGroceries(
      groceryInput({
        shops: [{ id: 's1', name: 'Tesco' } as Shop],
        tripShopId: 's1',
        tripStartedAt: startedAt,
      }),
      NOW
    );
    expect(built.tripShopName).toBe('Tesco');
    expect(built.tripStartedAt).toBe(startedAt);
  });

  it('reports no trip once one has aged out', () => {
    const built = buildGroceries(
      groceryInput({
        shops: [{ id: 's1', name: 'Tesco' } as Shop],
        tripShopId: 's1',
        tripStartedAt: new Date(NOW.getTime() - 9 * 60 * 60_000).toISOString(),
      }),
      NOW
    );
    expect(built.tripShopName).toBeNull();
    expect(built.tripStartedAt).toBeNull();
  });

  it('reports no trip for a shop that has since been deleted', () => {
    const built = buildGroceries(
      groceryInput({ tripShopId: 's1', tripStartedAt: NOW.toISOString() }),
      NOW
    );
    expect(built.tripShopName).toBeNull();
  });
});

describe('buildMeals', () => {
  const entry = (overrides: Partial<MealPlanEntry> = {}): MealPlanEntry =>
    ({
      id: 'm1',
      date: '2026-08-06',
      slot: 'dinner',
      recipeId: null,
      title: 'Chilli',
      cookedAt: null,
      sortOrder: 0,
      createdAt: NOW.toISOString(),
      ...overrides,
    }) as MealPlanEntry;

  it('drops what has already been cooked', () => {
    const meals = buildMeals(
      [entry(), entry({ id: 'm2', slot: 'lunch', title: 'Soup', cookedAt: NOW.toISOString() })],
      []
    );
    expect(meals.map(m => m.title)).toEqual(['Chilli']);
  });

  it("prefers the live recipe's name over the captured fallback", () => {
    const meals = buildMeals(
      [entry({ recipeId: 'r1', title: 'Old name' })],
      [{ id: 'r1', name: 'Chilli con carne' } as Recipe]
    );
    expect(meals[0].title).toBe('Chilli con carne');
  });

  it('labels the slot for the widget rather than making it spell the enum', () => {
    expect(buildMeals([entry()], [])[0].slotLabel).toBe('Dinner');
  });
});

describe('buildKitchen', () => {
  const kitchenEntry = (overrides: Partial<KitchenEntry> = {}): KitchenEntry =>
    ({
      id: 'item:i1',
      sourceId: 'i1',
      kind: 'item',
      title: 'Spinach',
      productName: null,
      useBy: '2026-08-06',
      ...overrides,
    }) as KitchenEntry;

  it('ranks the soonest use-by first', () => {
    const built = buildKitchen([
      kitchenEntry({ id: 'a', title: 'Rice', useBy: '2026-08-08' }),
      kitchenEntry({ id: 'b', title: 'Spinach', useBy: '2026-08-06' }),
    ]);
    expect(built.map(k => k.title)).toEqual(['Spinach', 'Rice']);
  });

  it('carries the day key rather than a phrase that goes stale overnight', () => {
    expect(buildKitchen([kitchenEntry()])[0].useBy).toBe('2026-08-06');
  });
});

describe('buildWidgetSnapshot', () => {
  it('distinguishes a store that was never initialized from an empty one', () => {
    expect(buildWidgetSnapshot(snapshotInput()).groceries).toBeNull();
    expect(buildWidgetSnapshot(snapshotInput({ grocery: groceryInput() })).groceries).not.toBeNull();
  });

  it('filters the task rows the widget cannot honour', () => {
    const snapshot = buildWidgetSnapshot(
      snapshotInput({
        visibleTasks: [makeTask({ id: 'a' }), makeTask({ id: 'b', polarity: 'negative' })],
      })
    );
    expect(snapshot.visibleTasks.map(t => t.id)).toEqual(['a']);
  });

  it('carries the category names in the order given, for the configuration picker', () => {
    const snapshot = buildWidgetSnapshot(snapshotInput({ categories: ['Work', 'Home'] }));
    expect(snapshot.categories).toEqual(['Work', 'Home']);
  });

  it('counts the agenda off every task, not only what is visible right now', () => {
    const snapshot = buildWidgetSnapshot(
      snapshotInput({
        allTasks: [
          makeTask({ id: 'a', dueDate: new Date(2026, 7, 6, 12).toISOString() }),
          makeTask({ id: 'b', dueDate: new Date(2026, 7, 4, 12).toISOString() }),
        ],
      })
    );
    expect(snapshot.agenda.due).toBe(1);
    expect(snapshot.agenda.carriedOver).toBe(1);
  });

  it('stamps the write time so the widget can tell a stale snapshot', () => {
    expect(buildWidgetSnapshot(snapshotInput()).updatedAt).toBe(NOW.toISOString());
  });
});
