import {
  useCategoryStore,
  ensureCalendarEventCategory,
  ensureGeneratedTaskCategory,
  ensureGeneratedTaskCategories,
  CALENDAR_EVENTS_CATEGORY,
} from '../store/useCategoryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { dbGetSetting, dbInsertCategory } from '../db/database';
import type { Category } from '../types';

/**
 * The "give it somewhere to land" pass, which is the whole of how events and
 * generated tasks reach a category (#1571).
 *
 * What's worth pinning down is the absent/cleared distinction: an *absent*
 * stored row means the question has never been answered and gets the default,
 * while an *empty* one is the user having said "nowhere" — by deleting the
 * category, or by picking None in Settings — and must survive every launch
 * after it. Getting that backwards makes a deleted category come back for good.
 */
jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
  dbGetAllCategories: jest.fn().mockReturnValue([]),
  dbInsertCategory: jest.fn(),
  dbInsertCategoryRow: jest.fn(),
  dbUpdateCategory: jest.fn(),
  dbDeleteCategory: jest.fn(),
  dbRenameCategory: jest.fn(),
  dbSetCategoryHideOnVacation: jest.fn(),
  dbSetCategoryExcludeFromSuggestions: jest.fn(),
  dbSetCategoryExcludeFromNewTasksBanner: jest.fn(),
  dbSetCategoryBackfillDismissedFields: jest.fn(),
  dbSetCategoryEmoji: jest.fn(),
  dbSetCategoryDefaultTimeSegments: jest.fn(),
  dbBatchUpdateCategorySortOrders: jest.fn(),
}));

const category = (name: string): Category => ({
  id: `cat-${name}`,
  name,
  scheduleDays: null,
  scheduleStart: null,
  scheduleEnd: null,
  hideOnVacation: false,
  excludeFromSuggestions: false,
  excludeFromNewTasksBanner: false,
  defaultTimeSegments: [],
  sortOrder: 1,
  emoji: null,
  backfillDismissedFields: [],
});

/** Whatever the ensure pass wrote, per settings key. */
const storedRows = new Map<string, string | null>();

beforeEach(() => {
  jest.clearAllMocks();
  storedRows.clear();
  (dbInsertCategory as jest.Mock).mockImplementation((name: string) => category(name));
  // The stored row is what tells "never answered" from "answered nowhere".
  (dbGetSetting as jest.Mock).mockImplementation((key: string) => storedRows.get(key) ?? null);
  useCategoryStore.setState({ categories: [], initialized: true });
  useSettingsStore.setState({
    calendarReadEnabled: false,
    calendarEventCategory: null,
    mealCookTasks: false,
    mealCookTaskCategory: null,
    groceryUseUpTasks: false,
    groceryUseUpTaskCategory: null,
    leftoverUseUpTasks: false,
    leftoverUseUpTaskCategory: null,
    mealPlanNudgeEnabled: false,
    mealPlanNudgeTaskCategory: null,
    calendarReviewTasks: false,
  });
});

describe('ensureCalendarEventCategory', () => {
  it('does nothing while the calendar read is off', () => {
    ensureCalendarEventCategory({ force: true });
    expect(useSettingsStore.getState().calendarEventCategory).toBeNull();
    expect(useCategoryStore.getState().categories).toEqual([]);
  });

  it('creates the category and points the setting at it when the read goes on', () => {
    useSettingsStore.setState({ calendarReadEnabled: true });
    ensureCalendarEventCategory({ force: true });
    expect(useSettingsStore.getState().calendarEventCategory).toBe(CALENDAR_EVENTS_CATEGORY);
    expect(useCategoryStore.getState().categories.map(c => c.name)).toEqual([CALENDAR_EVENTS_CATEGORY]);
  });

  it('leaves a category the user already picked alone', () => {
    useSettingsStore.setState({ calendarReadEnabled: true, calendarEventCategory: 'Diary' });
    ensureCalendarEventCategory({ force: true });
    expect(useSettingsStore.getState().calendarEventCategory).toBe('Diary');
    expect(dbInsertCategory).not.toHaveBeenCalled();
  });

  it('fills in an absent answer at startup — the whole of the migration', () => {
    useSettingsStore.setState({ calendarReadEnabled: true });
    ensureCalendarEventCategory();
    expect(useSettingsStore.getState().calendarEventCategory).toBe(CALENDAR_EVENTS_CATEGORY);
  });

  it('does not undo a cleared answer at startup', () => {
    // What deleting the category leaves behind: a row that exists and is empty.
    storedRows.set('calendarEventCategory', '');
    useSettingsStore.setState({ calendarReadEnabled: true });
    ensureCalendarEventCategory();
    expect(useSettingsStore.getState().calendarEventCategory).toBeNull();
    expect(dbInsertCategory).not.toHaveBeenCalled();
  });
});

describe('ensureGeneratedTaskCategory', () => {
  it('files cook tasks and the weekly nudge under one category', () => {
    useSettingsStore.setState({ mealCookTasks: true, mealPlanNudgeEnabled: true });
    ensureGeneratedTaskCategory('mealCook', { force: true });
    ensureGeneratedTaskCategory('mealPlanNudge', { force: true });
    const s = useSettingsStore.getState();
    expect(s.mealCookTaskCategory).toBe('Meal Plan');
    expect(s.mealPlanNudgeTaskCategory).toBe('Meal Plan');
    // One category, not two: addCategory returns the existing row by name.
    expect(useCategoryStore.getState().categories.map(c => c.name)).toEqual(['Meal Plan']);
  });

  it('leaves a generator that is switched off unfiled', () => {
    ensureGeneratedTaskCategory('leftoverUseUp', { force: true });
    expect(useSettingsStore.getState().leftoverUseUpTaskCategory).toBeNull();
  });

  it('does not undo "None" picked in Settings', () => {
    storedRows.set('leftoverUseUpTaskCategory', '');
    useSettingsStore.setState({ leftoverUseUpTasks: true });
    ensureGeneratedTaskCategory('leftoverUseUp');
    expect(useSettingsStore.getState().leftoverUseUpTaskCategory).toBeNull();
  });

  it('covers every generator that is on at startup, and only those', () => {
    useSettingsStore.setState({ leftoverUseUpTasks: true, mealCookTasks: true });
    ensureGeneratedTaskCategories();
    const s = useSettingsStore.getState();
    expect(s.leftoverUseUpTaskCategory).toBe('Leftovers');
    expect(s.mealCookTaskCategory).toBe('Meal Plan');
    expect(s.groceryUseUpTaskCategory).toBeNull();
  });

  // calendarReview reuses calendarEventCategory rather than owning a category
  // setting (GeneratedKindSpec.categorized: false), so there's nothing for
  // this to fill in even switched on — and, unlike every other kind, calling
  // it must not throw.
  it('leaves calendarReview alone, on or off', () => {
    useSettingsStore.setState({ calendarReviewTasks: true });
    expect(() => ensureGeneratedTaskCategory('calendarReview', { force: true })).not.toThrow();
    expect(useCategoryStore.getState().categories).toEqual([]);
    expect(() => ensureGeneratedTaskCategories()).not.toThrow();
  });

  // supplyReorder inherits the category of the task its supply is on
  // (GeneratedKindSpec.categorized: false) rather than owning a category
  // setting of its own, so there's nothing for this to fill in either.
  it('leaves supplyReorder alone, on or off', () => {
    useSettingsStore.setState({ supplyReorderTasks: true });
    expect(() => ensureGeneratedTaskCategory('supplyReorder', { force: true })).not.toThrow();
    expect(useCategoryStore.getState().categories).toEqual([]);
    expect(() => ensureGeneratedTaskCategories()).not.toThrow();
  });
});
