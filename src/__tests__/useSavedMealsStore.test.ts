import { useSavedMealsStore } from '../store/useSavedMealsStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { dbDeleteSavedMeal, dbGetSavedMeals, dbInsertSavedMeal } from '../db/database';
import type { FoodLogEntry, FoodNutrition, SavedMeal } from '../types';

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

/** Standing in for the tables rather than for one call, same shape useFoodLogStore.test.ts keeps. */
const mockFoodLogRows: { dayKey: string }[] = [];
let mockSavedMealRows: SavedMeal[] = [];

jest.mock('../db/database', () => ({
  dbGetFoodLogEntries: jest.fn((startKey: string, endKey: string) =>
    mockFoodLogRows.filter(r => r.dayKey >= startKey && r.dayKey <= endKey)),
  dbGetFoodLogEntry: jest.fn(() => null),
  dbCountFoodLogEntries: jest.fn(() => 0),
  dbInsertFoodLogEntry: jest.fn((entry: { dayKey: string }) => { mockFoodLogRows.push(entry); }),
  dbUpdateFoodLogEntry: jest.fn(),
  dbDeleteFoodLogEntry: jest.fn(),
  dbBulkDeleteFoodLogEntries: jest.fn(),
  dbBulkSetFoodLogSlot: jest.fn(),
  dbBulkUpdateFoodLogPlacement: jest.fn(),
  dbGetSavedMeals: jest.fn(() => mockSavedMealRows),
  dbInsertSavedMeal: jest.fn((meal: SavedMeal) => { mockSavedMealRows.push(meal); }),
  dbDeleteSavedMeal: jest.fn((id: string) => {
    mockSavedMealRows = mockSavedMealRows.filter(m => m.id !== id);
  }),
}));

jest.mock('../utils/healthFoodSync', () => ({
  logFoodEntryToHealth: jest.fn(() => Promise.resolve({ outcome: 'unavailable', sampleIds: [] })),
  retractFoodEntryFromHealth: jest.fn(() => Promise.resolve(true)),
}));

const mockSettingsState = {
  healthFoodWriteRefusalSeen: false,
  setHealthFoodWriteRefusalSeen: jest.fn((seen: boolean) => {
    mockSettingsState.healthFoodWriteRefusalSeen = seen;
  }),
};
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettingsState },
}));

jest.mock('../utils/dateUtils', () => ({
  dayKeyOf: jest.fn((d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }),
  getCurrentDayStart: jest.fn(() => new Date(2026, 3, 2)),
  getLogicalDayKey: jest.fn((d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }),
}));

function nutrition(calorieKcal: number): FoodNutrition {
  return {
    basis: 'perServing',
    servingGrams: null,
    servingText: '1 cup',
    amounts: { calorieKcal },
    source: 'manual',
    sourceId: null,
    portions: [],
    recordedAt: new Date(2026, 3, 1).toISOString(),
  };
}

function makeEntry(overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    id: 'e1',
    dayKey: '2026-04-01',
    atISO: new Date(2026, 3, 1, 8).toISOString(),
    slot: 'breakfast',
    label: 'Milk',
    recipeId: null,
    itemId: 'item-milk',
    productId: null,
    mealPlanEntryId: null,
    quantity: '1 cup',
    grams: 240,
    nutrition: nutrition(150),
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: new Date(2026, 3, 1).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  mockFoodLogRows.length = 0;
  mockSavedMealRows = [];
  useSavedMealsStore.setState({ meals: [], initialized: false });
  useFoodLogStore.setState({
    entries: [], rangeStart: null, rangeEnd: null,
    windowEntries: [], windowStart: null, windowEnd: null,
    insightEntries: [], insightStart: null, insightEnd: null,
    totalCount: 0, initialized: false,
  });
  jest.clearAllMocks();
});

describe('useSavedMealsStore', () => {
  it('reads every saved meal on initialize', () => {
    mockSavedMealRows = [{ id: 'm1', name: 'Usual breakfast', items: [], createdAt: '' }];
    useSavedMealsStore.getState().initialize();
    expect(useSavedMealsStore.getState().meals).toHaveLength(1);
    expect(useSavedMealsStore.getState().initialized).toBe(true);
  });

  describe('addFromEntries', () => {
    it('bundles the given entries into a new saved meal, dropping their placement', () => {
      const entry = makeEntry();
      const meal = useSavedMealsStore.getState().addFromEntries('Usual breakfast', [entry]);
      expect(meal).not.toBeNull();
      expect(meal?.name).toBe('Usual breakfast');
      expect(meal?.items).toEqual([{
        label: 'Milk',
        recipeId: null,
        itemId: 'item-milk',
        productId: null,
        quantity: '1 cup',
        grams: 240,
        nutrition: entry.nutrition,
      }]);
      expect(dbInsertSavedMeal).toHaveBeenCalledTimes(1);
      expect(useSavedMealsStore.getState().meals).toHaveLength(1);
    });

    it('refuses a blank name, same as addEntry refuses a blank label', () => {
      const meal = useSavedMealsStore.getState().addFromEntries('   ', [makeEntry()]);
      expect(meal).toBeNull();
      expect(dbInsertSavedMeal).not.toHaveBeenCalled();
    });

    it('refuses an empty selection', () => {
      const meal = useSavedMealsStore.getState().addFromEntries('Nothing', []);
      expect(meal).toBeNull();
      expect(dbInsertSavedMeal).not.toHaveBeenCalled();
    });
  });

  describe('removeMeal', () => {
    it('deletes the meal from the table and the store', () => {
      useSavedMealsStore.getState().addFromEntries('Usual breakfast', [makeEntry()]);
      const id = useSavedMealsStore.getState().meals[0].id;
      useSavedMealsStore.getState().removeMeal(id);
      expect(dbDeleteSavedMeal).toHaveBeenCalledWith(id);
      expect(useSavedMealsStore.getState().meals).toHaveLength(0);
    });
  });

  describe('logMeal', () => {
    it('writes one new food log entry per item, at the given slot and moment', () => {
      const meal = useSavedMealsStore.getState().addFromEntries('Usual breakfast', [
        makeEntry({ label: 'Milk' }),
        makeEntry({ label: 'Greek yogurt', itemId: 'item-yogurt', nutrition: nutrition(120) }),
      ]);
      expect(meal).not.toBeNull();

      const at = new Date(2026, 3, 5, 9);
      const written = useSavedMealsStore.getState().logMeal(meal as SavedMeal, 'lunch', at);

      expect(written).toHaveLength(2);
      expect(written.every(e => e.slot === 'lunch')).toBe(true);
      expect(written.every(e => e.dayKey === '2026-04-05')).toBe(true);
      expect(written.map(e => e.label)).toEqual(['Milk', 'Greek yogurt']);
      // Each write is a fresh row — re-logging the meal must not resurrect the
      // ids of whatever it was originally saved from.
      expect(new Set(written.map(e => e.id)).size).toBe(2);
    });

    it('skips an item addEntry itself would refuse, same as any other caller', () => {
      const meal: SavedMeal = {
        id: 'm1',
        name: 'Broken meal',
        items: [{
          label: '',
          recipeId: null,
          itemId: null,
          productId: null,
          quantity: '1 cup',
          grams: null,
          nutrition: nutrition(100),
        }],
        createdAt: '',
      };
      const written = useSavedMealsStore.getState().logMeal(meal, null, new Date(2026, 3, 5));
      expect(written).toHaveLength(0);
    });
  });
});
