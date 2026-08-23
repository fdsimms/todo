import { useTaskStore } from '../store/useTaskStore';
import { isMissed, isRealCompletion } from '../utils/missed';
import { isTaskNew } from '../utils/visibilityUtils';
import { derivedId, spawnSeed } from '../utils/syncIds';
import { emptyExtraTaskDraft } from '../utils/extraTask';
import type { MealPlanEntry, MealSlot } from '../types';
import { useCategoryStore } from '../store/useCategoryStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useProjectStore } from '../store/useProjectStore';
import { MAX_PROJECT_REVIEW_TASKS } from '../utils/projectReviewTasks';
import { MAX_PANTRY_CHECK_TASKS } from '../utils/pantryCheckTasks';
import { OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
import { useTemplateStore } from '../store/useTemplateStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { normalizeTemplateItem } from '../utils/templateUtils';
import {
  initDatabase,
  dbGetAllTasks,
  dbGetTagRegistry,
  dbInsertTask,
  dbUpdateTask,
  dbDeleteTask,
  dbDeleteSubtasks,
  dbClearAllPins,
  dbBatchUpdateSortOrders,
  dbBatchUpdatePinnedOrders,
  dbBatchUpdatePostponeCounts,
  dbBulkDeleteTasks,
  dbBulkSetPriority,
  dbBulkSetDefer,
  dbBulkSetPinned,
  dbBulkSetCategory,
  dbBulkSetTimeSegments,
  dbBulkAddTags,
  dbMarkTaskSeen,
  dbTransaction,
  dbGetMealPlanEntries,
} from '../db/database';
import {
  scheduleTaskReminder,
  cancelTaskReminder,
  rescheduleAllReminders,
} from '../utils/notifications';
import { syncDeadlineEvent } from '../utils/deadlineCalendarSync';
import { deleteCalendarEvent } from '../utils/calendarSync';
import type { GroceryItem, Project, Task, TaskGroup, TitleRule } from '../types';

jest.mock('../db/database', () => ({
  initDatabase: jest.fn(),
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbGetAllTasks: jest.fn().mockReturnValue([]),
  dbGetTagRegistry: jest.fn().mockReturnValue([]),
  dbGetCategoryRegistry: jest.fn().mockReturnValue([]),
  dbGetAllCategories: jest.fn().mockReturnValue([]),
  dbInsertCategory: jest.fn(),
  dbUpdateCategory: jest.fn(),
  dbDeleteCategory: jest.fn(),
  dbGetAllTaskGroups: jest.fn().mockReturnValue([]),
  dbGetFocusSession: jest.fn().mockReturnValue(null),
  dbSaveFocusSession: jest.fn(),
  dbClearFocusSession: jest.fn(),
  dbInsertTaskGroup: jest.fn(),
  dbUpdateTaskGroup: jest.fn(),
  dbDeleteTaskGroup: jest.fn(),
  dbGetAllProjects: jest.fn().mockReturnValue([]),
  dbInsertProject: jest.fn(),
  dbUpdateProject: jest.fn(),
  dbDeleteProject: jest.fn(),
  dbBatchUpdateProjectSortOrders: jest.fn(),
  dbGetAllProjectCategories: jest.fn().mockReturnValue([]),
  dbInsertProjectCategory: jest.fn(),
  dbGetAllTemplateCategories: jest.fn().mockReturnValue([]),
  dbInsertTemplateCategory: jest.fn(),
  dbInsertTask: jest.fn(),
  dbUpdateTask: jest.fn(),
  dbDeleteTask: jest.fn(),
  dbDeleteSubtasks: jest.fn(),
  dbClearAllPins: jest.fn(),
  dbBatchUpdateSortOrders: jest.fn(),
  dbBatchUpdatePinnedOrders: jest.fn(),
  dbBatchUpdatePostponeCounts: jest.fn(),
  dbBulkDeleteTasks: jest.fn(),
  dbBulkSetPriority: jest.fn(),
  dbBulkSetDefer: jest.fn(),
  dbBulkSetWhen: jest.fn(),
  dbBulkSetCategory: jest.fn(),
  dbBulkSetTimeSegments: jest.fn(),
  dbBulkSetPinned: jest.fn(),
  dbBulkAddTags: jest.fn(),
  dbAddToTagRegistry: jest.fn(),
  dbRemoveFromTagRegistry: jest.fn(),
  dbRemoveTagFromAllTasks: jest.fn(),
  dbMarkTaskSeen: jest.fn(),
  dbTransaction: jest.fn((fn: () => void) => fn()),
  dbGetAllTemplates: jest.fn().mockReturnValue([]),
  dbInsertTemplate: jest.fn(),
  dbUpdateTemplate: jest.fn(),
  dbDeleteTemplate: jest.fn(),
  // Reached only via the initialize() fan-out — groceries and recipes are
  // otherwise untouched by this file's subject.
  dbGetAllRecipes: jest.fn().mockReturnValue([]),
  dbGetAllGroceryItems: jest.fn().mockReturnValue([]),
  dbGetGroceryAisleOrder: jest.fn().mockReturnValue(null),
  dbGetGroceryHiddenAisles: jest.fn().mockReturnValue([]),
  // useTaskStore.initialize() initialises the grocery store too, so its whole
  // read path has to be stubbed here even though nothing in this file is about
  // groceries.
  dbGetGroceryAisleOverrides: jest.fn().mockReturnValue({}),
  dbGetGroceryGroupBy: jest.fn().mockReturnValue('aisle'),
  dbGetAllGroceryShops: jest.fn().mockReturnValue([]),
  dbGetAllItemShopLinks: jest.fn().mockReturnValue([]),
  dbGetAllItemSubLinks: jest.fn().mockReturnValue([]),
  dbGetAllItemProducts: jest.fn().mockReturnValue([]),
  dbGetAllStoreAliases: jest.fn().mockReturnValue([]),
  dbSetStoreAlias: jest.fn(),
  dbGetLastShopId: jest.fn().mockReturnValue(null),
  dbGetTripShopId: jest.fn().mockReturnValue(null),
  dbGetTripStartedAt: jest.fn().mockReturnValue(null),
  dbSetTrip: jest.fn(),
  // Written when deleting a use-up task records the item's opt-out — the one
  // place this file's subject writes to the grocery catalog.
  dbUpdateGroceryItem: jest.fn(),
  // useTaskStore.initialize() fans out to the meal plan store too.
  dbGetMealPlanAddedToList: jest.fn().mockReturnValue({}),
  // Read directly by checkMealPlanNudge, not through useMealPlanStore.
  dbGetMealPlanEntries: jest.fn().mockReturnValue([]),
  // …and to the leftover store.
  dbGetAllLeftovers: jest.fn().mockReturnValue([]),
}));

jest.mock('../store/useCategoryStore', () => ({
  // Called by initialize() to give the day's calendar events a section; a
  // no-op here, since this suite's category store is a mock with no rows.
  ensureCalendarEventCategory: jest.fn(),
  ensureGeneratedTaskCategories: jest.fn(),
  // Called by checkProjectReviewTasks before it writes its first task — that
  // generator ships on, so nobody flips the switch that would otherwise create
  // its category.
  ensureGeneratedTaskCategory: jest.fn(),
  useCategoryStore: {
    getState: jest.fn(() => ({
      categories: [],
      initialized: false,
      initialize: jest.fn(),
      addCategory: jest.fn(name => ({ id: 'cat-1', name, scheduleDays: null, scheduleStart: null, scheduleEnd: null })),
      deleteCategory: jest.fn(),
      restoreCategory: jest.fn(),
      renameCategory: jest.fn().mockReturnValue(true),
      setCategorySchedule: jest.fn(),
      removeCategorySchedule: jest.fn(),
      setCategoryDefaultTimeSegments: jest.fn(),
      getCategoryByName: jest.fn().mockReturnValue(null),
    })),
  },
}));

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: jest.fn(() => ({
      dayResetTime: '00:00', autoArchiveProjectsOnComplete: false, activeHoursStart: '08:00', activeHoursEnd: '22:00',
      newTaskDefaults: { category: null, priority: null, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false },
      // The settings that name a category — renaming or deleting one has to
      // carry them with it (see renameCategory/deleteCategory).
      mealCookTaskCategory: null, groceryUseUpTaskCategory: null, leftoverUseUpTaskCategory: null,
      calendarEventCategory: null, collapsedCategories: [], titleRules: [],
      setMealCookTaskCategory: jest.fn(), setGroceryUseUpTaskCategory: jest.fn(),
      setLeftoverUseUpTaskCategory: jest.fn(), setCalendarEventCategory: jest.fn(),
      setCollapsedCategories: jest.fn(),
    })),
  },
}));

jest.mock('../utils/notifications', () => ({
  scheduleTaskReminder: jest.fn().mockResolvedValue(undefined),
  cancelTaskReminder: jest.fn().mockResolvedValue(undefined),
  rescheduleAllReminders: jest.fn().mockResolvedValue(undefined),
  scheduleTimerAlarm: jest.fn().mockResolvedValue(undefined),
  cancelTimerAlarm: jest.fn().mockResolvedValue(undefined),
  rescheduleAllTimerAlarms: jest.fn().mockResolvedValue(undefined),
  // Reached through useTaskStore.initialize, which hands the task list to
  // useFocusStore so a stored session can be reconciled against it.
  scheduleFocusStepAlarm: jest.fn().mockResolvedValue(undefined),
  cancelFocusStepAlarm: jest.fn().mockResolvedValue(undefined),
  // Not exercised by this suite's grocery-store tests (they only touch
  // useUpTask fields), but useGroceryStore.ts imports these unconditionally —
  // an incomplete mock would leave them undefined the moment a test does call
  // startTrip/endTrip.
  scheduleTripReminder: jest.fn().mockResolvedValue(undefined),
  cancelTripReminder: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/deadlineCalendarSync', () => ({
  syncDeadlineEvent: jest.fn().mockResolvedValue(null),
}));

jest.mock('../utils/calendarSync', () => ({
  deleteCalendarEvent: jest.fn().mockResolvedValue(undefined),
  // The #1492 half. Stubbed to "the user cancelled" / "no such event" by
  // default so nothing writes unless a test says so; the time-block block at
  // the bottom of this file drives them.
  presentTimeBlockCreate: jest.fn().mockResolvedValue({ saved: false, deleted: false, eventId: null }),
  presentTimeBlockEdit: jest.fn().mockResolvedValue({ saved: false, deleted: false, eventId: null }),
  readTimeBlockEvent: jest.fn().mockResolvedValue(null),
  updateTimeBlockEvent: jest.fn().mockResolvedValue(true),
}));
jest.mock('../store/useCalendarStore', () => ({
  useCalendarStore: { getState: () => ({ events: [], loaded: false }) },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  UIManager: { setLayoutAnimationEnabledExperimental: jest.fn() },
  LayoutAnimation: {
    configureNext: jest.fn(),
    create: jest.fn(),
    Types: { easeInEaseOut: 'easeInEaseOut' },
    Properties: { opacity: 'opacity' },
  },
}));

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  seenAt: null,
  dueDate: null,
  deadline: null,
  deadlineOffsetDays: null,
  deadlineMonthDay: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  targetCount: null,
  targetUnit: null,
  progressCount: 0,
  allowOvershoot: false,
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
  pinnedOrder: 0,
  postponeCount: 0,
  postponeMuted: false,
  driftingSince: null,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  streakRequiresWindow: false,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  vacationPause: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
  phoneNumber: null,
  emailAddress: null,
  blockedById: null,
  deliverableKind: null,
  deliverableValue: null,
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  timeBlockEventId: null,
  pendingImport: null,
  ...overrides,
});

const makeGroup = (overrides: Partial<TaskGroup> = {}): TaskGroup => ({
  id: 'group-1',
  title: 'Test Group',
  notes: '',
  tags: [],
  category: null,
  sortOrder: 1,
  collapsed: false,
  ...overrides,
});

const makeProject = (overrides: Partial<import('../types').Project> = {}): import('../types').Project => ({
  id: 'project-1',
  title: 'Test Project',
  notes: '',
  targetStartDate: null,
  targetEndDate: null,
  category: null,
  sortOrder: 1,
  archived: false,
  archivedAt: null,
  completed: false,
  completedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  nudgeCadenceDays: 14,
  autoSchedule: false,
  sequential: false,
  nudgeOptIn: true,
  reviewDeclinedAt: null,
  ...overrides,
});

const makeTemplate = (overrides: Partial<import('../types').TaskTemplate> = {}): import('../types').TaskTemplate => ({
  id: 'tpl-1',
  name: 'Test Template',
  items: [],
  itemGroups: [],
  questions: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  sortOrder: 1,
  category: null,
  applyContainer: 'stack',
  schedule: null,
  scheduleLastFiredKey: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetAllTasks as jest.Mock).mockReturnValue([]);
  useTaskStore.setState({
    tasks: [], initialized: false, lastAction: null,
    completionHoldIds: [], completionCollapseIds: [], quotaHoldIds: [],
  });
  useTaskGroupStore.setState({ groups: [], initialized: false });
  useProjectStore.setState({ projects: [], initialized: false });
  useTemplateStore.setState({ templates: [], initialized: false });
  const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as { useSettingsStore: { getState: jest.Mock } };
  useSettingsStore.getState.mockReturnValue({
    dayResetTime: '00:00', autoArchiveProjectsOnComplete: false, activeHoursStart: '08:00', activeHoursEnd: '22:00',
    newTaskDefaults: { category: null, priority: null, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false },
    mealCookTaskCategory: null, groceryUseUpTaskCategory: null, leftoverUseUpTaskCategory: null,
    calendarEventCategory: null, collapsedCategories: [], titleRules: [],
    setMealCookTaskCategory: jest.fn(), setGroceryUseUpTaskCategory: jest.fn(),
    setLeftoverUseUpTaskCategory: jest.fn(), setCalendarEventCategory: jest.fn(),
    setCollapsedCategories: jest.fn(),
  });
  // re-register the category store mock after clearAllMocks
  const { useCategoryStore } = jest.requireMock('../store/useCategoryStore') as { useCategoryStore: { getState: jest.Mock } };
  useCategoryStore.getState.mockReturnValue({
    categories: [],
    initialized: false,
    initialize: jest.fn(),
    addCategory: jest.fn(name => ({ id: 'cat-1', name, scheduleDays: null, scheduleStart: null, scheduleEnd: null })),
    deleteCategory: jest.fn(),
    restoreCategory: jest.fn(),
    renameCategory: jest.fn().mockReturnValue(true),
    setCategorySchedule: jest.fn(),
    removeCategorySchedule: jest.fn(),
    getCategoryByName: jest.fn().mockReturnValue(null),
  });
});

// ─── initialize ───────────────────────────────────────────────────────────────

describe('initialize', () => {
  it('calls initDatabase, loads tasks, and marks as initialized', () => {
    const tasks = [makeTask({ id: 'a' })];
    (dbGetAllTasks as jest.Mock).mockReturnValue(tasks);
    useTaskStore.getState().initialize();
    expect(initDatabase).toHaveBeenCalledTimes(1);
    expect(useTaskStore.getState().tasks).toEqual(tasks);
    expect(useTaskStore.getState().initialized).toBe(true);
  });

  it('reschedules all reminders on startup', () => {
    const tasks = [makeTask()];
    (dbGetAllTasks as jest.Mock).mockReturnValue(tasks);
    useTaskStore.getState().initialize();
    expect(rescheduleAllReminders).toHaveBeenCalledWith(
      tasks,
      { shopId: null, startedAt: null, shops: [] }
    );
  });
});

// ─── addTask ─────────────────────────────────────────────────────────────────

describe('addTask', () => {
  it('adds a task to state and returns it', () => {
    const task = useTaskStore.getState().addTask({ title: 'My Task' });
    expect(task.title).toBe('My Task');
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useTaskStore.getState().tasks[0]).toEqual(task);
  });

  it('uses sensible defaults for omitted fields', () => {
    const task = useTaskStore.getState().addTask({});
    expect(task.completed).toBe(false);
    expect(task.notes).toBe('');
    expect(task.tags).toEqual([]);
    expect(task.recurrenceType).toBe('none');
    expect(task.pinned).toBe(false);
    expect(task.parentId).toBeNull();
    expect(task.showStreak).toBe(false);
  });

  it('applies draft overrides', () => {
    const task = useTaskStore.getState().addTask({
      title: 'Tagged',
      tags: ['work'],
      priority: 2,
    });
    expect(task.tags).toEqual(['work']);
    expect(task.priority).toBe(2);
  });

  it('sets sortOrder to 1 when store is empty', () => {
    const task = useTaskStore.getState().addTask({ title: 'First' });
    expect(task.sortOrder).toBe(1);
  });

  // ─── title rules ───────────────────────────────────────────────────────────
  // The headless half of the feature: quick add resolves rules itself (and
  // passes skipTitleRules), so what these cover is every *other* way a task
  // gets made — a dictated Apple reminder, a deep link, a template run.
  describe('title rules', () => {
    const settings = () =>
      (jest.requireMock('../store/useSettingsStore') as { useSettingsStore: { getState: jest.Mock } })
        .useSettingsStore;

    const withRules = (titleRules: unknown[], extra: Record<string, unknown> = {}) => {
      const store = settings();
      const base = store.getState();
      store.getState.mockReturnValue({ ...base, titleRules, ...extra });
    };

    const expenseRule = {
      id: 'r1', keywords: ['expense'], match: 'startsWith',
      category: 'Work', projectId: null, tags: ['receipts'],
      priority: 0, effort: 0, stripKeyword: false, enabled: true,
    };

    it('files a matching task by the rule', () => {
      withRules([expenseRule]);
      const task = useTaskStore.getState().addTask({ title: 'expense the client lunch' });
      expect(task.category).toBe('Work');
      expect(task.tags).toEqual(['receipts']);
    });

    it('leaves a title that does not match alone', () => {
      withRules([expenseRule]);
      const task = useTaskStore.getState().addTask({ title: 'expensive dinner' });
      expect(task.category).toBeNull();
      expect(task.tags).toEqual([]);
    });

    it('never overrides a category the caller named', () => {
      withRules([expenseRule]);
      const task = useTaskStore.getState().addTask({ title: 'expense lunch', category: 'Personal' });
      expect(task.category).toBe('Personal');
    });

    it('adds its tags to the ones the caller named rather than replacing them', () => {
      withRules([expenseRule]);
      const task = useTaskStore.getState().addTask({ title: 'expense lunch', tags: ['urgent'] });
      expect(task.tags).toEqual(['urgent', 'receipts']);
    });

    it('outranks the app-wide new-task default it is more specific than', () => {
      withRules([expenseRule], {
        newTaskDefaults: { category: 'Inbox', priority: null, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false },
      });
      expect(useTaskStore.getState().addTask({ title: 'expense lunch' }).category).toBe('Work');
      expect(useTaskStore.getState().addTask({ title: 'buy milk' }).category).toBe('Inbox');
    });

    it('leaves an explicit priority of 0 at 0 rather than handing it back to the default', () => {
      withRules([expenseRule], {
        newTaskDefaults: { category: null, priority: 3, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false },
      });
      expect(useTaskStore.getState().addTask({ title: 'expense lunch', priority: 0 }).priority).toBe(0);
    });

    it('sets a priority the rule names on a draft that has none', () => {
      withRules([{ ...expenseRule, priority: 4 }]);
      expect(useTaskStore.getState().addTask({ title: 'expense lunch' }).priority).toBe(4);
    });

    it('strips the keyword when the rule asks', () => {
      withRules([{ ...expenseRule, stripKeyword: true }]);
      expect(useTaskStore.getState().addTask({ title: 'Expense: client lunch' }).title).toBe('client lunch');
    });

    it('ignores a disabled rule', () => {
      withRules([{ ...expenseRule, enabled: false }]);
      expect(useTaskStore.getState().addTask({ title: 'expense lunch' }).category).toBeNull();
    });

    it('leaves a subtask alone — a step inside a task files itself nowhere', () => {
      withRules([expenseRule]);
      const parent = useTaskStore.getState().addTask({ title: 'Trip admin' });
      const sub = useTaskStore.getState().addTask({ title: 'expense the flights', parentId: parent.id });
      expect(sub.category).toBeNull();
      expect(sub.tags).toEqual([]);
    });

    it('leaves a caller that opts out alone', () => {
      withRules([expenseRule]);
      const task = useTaskStore.getState().addTask(
        { title: 'expense lunch' }, undefined, { skipTitleRules: true });
      expect(task.category).toBeNull();
    });

    // The one field held back here rather than by a caller: only the headless
    // creations reach this at all, and none of them has anywhere to say a
    // project was chosen — while an undated project task is on no list.
    it('never files a project, since nothing reaching this can say it did', () => {
      withRules([{ ...expenseRule, projectId: 'p1' }]);
      const task = useTaskStore.getState().addTask({ title: 'expense the client lunch' });
      expect(task.projectId).toBeNull();
      // The rest of the rule still applies — this is a field opting out, not
      // the rule.
      expect(task.category).toBe('Work');
    });

    it('still honours a project the caller named itself', () => {
      withRules([{ ...expenseRule, projectId: 'p1' }]);
      const task = useTaskStore.getState().addTask({ title: 'expense lunch', projectId: 'p2' });
      expect(task.projectId).toBe('p2');
    });
  });

  it('sets sortOrder to maxExisting + 1', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'x', sortOrder: 7 })] });
    const task = useTaskStore.getState().addTask({ title: 'Second' });
    expect(task.sortOrder).toBe(8);
  });

  it('persists to db and schedules reminder', () => {
    const task = useTaskStore.getState().addTask({ title: 'Reminder' });
    expect(dbInsertTask).toHaveBeenCalledWith(task);
    expect(scheduleTaskReminder).toHaveBeenCalledWith(task);
  });

  it('reconciles the deadline calendar event', () => {
    const task = useTaskStore.getState().addTask({ title: 'Renew passport' });
    expect(syncDeadlineEvent).toHaveBeenCalledWith(task);
  });
});

// ─── newTaskFromDraft: Settings' newTaskDefaults ────────────────────────────
//
// newTaskFromDraft (addTask's builder, shared with the series builder) is
// "the one place a Task's defaults are spelled out" — see its comment. These
// exercise the settings.newTaskDefaults fallback layer it reads: a draft that
// leaves a field unspecified picks up the setting, one that names a value
// explicitly is never overridden, and — with no newTaskDefaults configured —
// today's actual behavior (before this setting existed) is unchanged.
describe('newTaskFromDraft: newTaskDefaults', () => {
  const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as { useSettingsStore: { getState: jest.Mock } };

  const withDefaults = (newTaskDefaults: Record<string, unknown>) => {
    useSettingsStore.getState.mockReturnValue({
      dayResetTime: '00:00', autoArchiveProjectsOnComplete: false, activeHoursStart: '08:00', activeHoursEnd: '22:00',
      newTaskDefaults,
    });
  };

  it('with no newTaskDefaults configured, an omitted field defaults exactly as before this setting existed', () => {
    withDefaults({ category: null, priority: null, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false });
    const task = useTaskStore.getState().addTask({ title: 'Plain' });
    expect(task.category).toBeNull();
    expect(task.priority).toBe(0);
    expect(task.effort).toBe(0);
    expect(task.timeSegments).toEqual([]);
  });

  it('fills an unspecified field from newTaskDefaults', () => {
    withDefaults({ category: 'Home', priority: 3, effort: 2, timeSegment: 'evening', destination: 'today', openEditorAfterQuickAdd: false });
    const task = useTaskStore.getState().addTask({ title: 'Defaulted' });
    expect(task.category).toBe('Home');
    expect(task.priority).toBe(3);
    expect(task.effort).toBe(2);
    expect(task.timeSegments).toEqual(['evening']);
  });

  it('never overrides a field the draft already named, even when it is a falsy/zero value', () => {
    withDefaults({ category: 'Home', priority: 3, effort: 2, timeSegment: 'evening', destination: 'today', openEditorAfterQuickAdd: false });
    const task = useTaskStore.getState().addTask({
      title: 'Explicit',
      category: 'Work',
      priority: 0,
      effort: 0,
      timeSegments: ['morning'],
    });
    expect(task.category).toBe('Work');
    expect(task.priority).toBe(0);
    expect(task.effort).toBe(0);
    expect(task.timeSegments).toEqual(['morning']);
  });

  it('an explicit category still wins over the default', () => {
    withDefaults({ category: 'Home', priority: null, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false });
    const task = useTaskStore.getState().addTask({ title: 'x', category: 'Work' });
    expect(task.category).toBe('Work');
  });

  it('the series builder (addTaskSeries) picks up the same defaults', () => {
    withDefaults({ category: 'Errands', priority: 1, effort: 4, timeSegment: 'morning', destination: 'today', openEditorAfterQuickAdd: false });
    const rows = useTaskStore.getState().addTaskSeries(
      { title: 'Walk the dog' },
      [new Date(2025, 8, 10, 12, 0, 0), new Date(2025, 8, 15, 12, 0, 0)],
    );
    expect(rows.every(r => r.category === 'Errands')).toBe(true);
    expect(rows.every(r => r.priority === 1)).toBe(true);
    expect(rows.every(r => r.effort === 4)).toBe(true);
    expect(rows.every(r => r.timeSegments && r.timeSegments[0] === 'morning')).toBe(true);
  });

  // #1724: a generator's own category setting (possibly deliberately null,
  // e.g. "None" chosen for leftover use-up tasks) must not be read as an
  // unanswered field and swapped for the unrelated newTaskDefaults.category.
  describe('skipCategoryDefault (generated tasks, #1724)', () => {
    it('leaves the task uncategorized rather than falling back to newTaskDefaults', () => {
      withDefaults({ category: 'Home', priority: null, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false });
      const task = useTaskStore.getState().addTask({ title: 'Use up spinach', category: null }, undefined, { skipCategoryDefault: true });
      expect(task.category).toBeNull();
    });

    it('still honors an explicit category', () => {
      withDefaults({ category: 'Home', priority: null, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false });
      const task = useTaskStore.getState().addTask({ title: 'Use up spinach', category: 'Leftovers' }, undefined, { skipCategoryDefault: true });
      expect(task.category).toBe('Leftovers');
    });
  });
});

// ─── updateTask ──────────────────────────────────────────────────────────────

describe('updateTask', () => {
  it('updates matching task fields', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', title: 'Old' })] });
    useTaskStore.getState().updateTask('t1', { title: 'New', priority: 3 });
    const updated = useTaskStore.getState().tasks[0];
    expect(updated.title).toBe('New');
    expect(updated.priority).toBe(3);
  });

  it('does not affect other tasks', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2', title: 'Untouched' })],
    });
    useTaskStore.getState().updateTask('t1', { title: 'Changed' });
    expect(useTaskStore.getState().tasks.find(t => t.id === 't2')?.title).toBe('Untouched');
  });

  it('persists to db and refreshes reminder', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
    useTaskStore.getState().updateTask('t1', { title: 'Updated' });
    expect(dbUpdateTask).toHaveBeenCalledTimes(1);
    expect(cancelTaskReminder).toHaveBeenCalledWith('t1');
    expect(scheduleTaskReminder).toHaveBeenCalledTimes(1);
  });

  it('does not touch reminders when the update does not affect the notification', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
    useTaskStore.getState().updateTask('t1', { priority: 2, sortOrder: 5 });
    expect(dbUpdateTask).toHaveBeenCalledTimes(1);
    expect(cancelTaskReminder).not.toHaveBeenCalled();
    expect(scheduleTaskReminder).not.toHaveBeenCalled();
  });

  it('reconciles the deadline calendar event when the deadline changes', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
    useTaskStore.getState().updateTask('t1', { deadline: new Date(2025, 5, 11).toISOString() });
    expect(syncDeadlineEvent).toHaveBeenCalledTimes(1);
  });

  it('reconciles the deadline calendar event when the per-task toggle changes', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', deadline: new Date(2025, 5, 11).toISOString() })] });
    useTaskStore.getState().updateTask('t1', { deadlineOnCalendar: true });
    expect(syncDeadlineEvent).toHaveBeenCalledTimes(1);
  });

  it('does not touch the deadline calendar event when the update does not affect it', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
    useTaskStore.getState().updateTask('t1', { priority: 2, sortOrder: 5 });
    expect(syncDeadlineEvent).not.toHaveBeenCalled();
  });

  describe('scope: "occurrence" ("this task only")', () => {
    it('captures the pre-edit value of changed content fields into seriesDefaults', () => {
      useTaskStore.setState({ tasks: [makeTask({ id: 't1', title: 'Original', recurrenceType: 'daily' })] });
      useTaskStore.getState().updateTask('t1', { title: 'Just today' }, { scope: 'occurrence' });
      const updated = useTaskStore.getState().tasks[0];
      expect(updated.title).toBe('Just today');
      expect(updated.seriesDefaults).toEqual({ title: 'Original' });
    });

    it('does not clobber an already-captured seriesDefaults value on a second occurrence-scoped edit', () => {
      useTaskStore.setState({ tasks: [makeTask({ id: 't1', title: 'Original', recurrenceType: 'daily' })] });
      useTaskStore.getState().updateTask('t1', { title: 'First edit' }, { scope: 'occurrence' });
      useTaskStore.getState().updateTask('t1', { title: 'Second edit' }, { scope: 'occurrence' });
      const updated = useTaskStore.getState().tasks[0];
      expect(updated.title).toBe('Second edit');
      expect(updated.seriesDefaults).toEqual({ title: 'Original' });
    });

    it('does not populate seriesDefaults for non-content (schedule/rule) fields', () => {
      useTaskStore.setState({ tasks: [makeTask({ id: 't1', recurrenceType: 'daily' })] });
      useTaskStore.getState().updateTask(
        't1',
        { dueDate: new Date(2025, 5, 11).toISOString() },
        { scope: 'occurrence' }
      );
      expect(useTaskStore.getState().tasks[0].seriesDefaults).toBeNull();
    });
  });

  describe('scope: "series" (default, "this and future tasks")', () => {
    it('clears a stale seriesDefaults entry for a field it now deliberately overrides', () => {
      useTaskStore.setState({
        tasks: [makeTask({
          id: 't1', title: 'Just today', recurrenceType: 'daily',
          seriesDefaults: { title: 'Original' },
        })],
      });
      useTaskStore.getState().updateTask('t1', { title: 'New series title' });
      const updated = useTaskStore.getState().tasks[0];
      expect(updated.title).toBe('New series title');
      expect(updated.seriesDefaults).toBeNull();
    });

    it('leaves unrelated seriesDefaults entries intact', () => {
      useTaskStore.setState({
        tasks: [makeTask({
          id: 't1', title: 'Just today', notes: 'Just today notes', recurrenceType: 'daily',
          seriesDefaults: { title: 'Original title', notes: 'Original notes' },
        })],
      });
      useTaskStore.getState().updateTask('t1', { title: 'New series title' });
      expect(useTaskStore.getState().tasks[0].seriesDefaults).toEqual({ notes: 'Original notes' });
    });
  });

  describe('moving a task to another category', () => {
    // "Routines" keeps its tasks out of the new todos banner, so nothing ever
    // advances their seenAt — which is what leaves a stale one behind for the
    // move out to trip over.
    const routines = {
      id: 'cat-routines', name: 'Routines', scheduleDays: null, scheduleStart: null, scheduleEnd: null,
      hideOnVacation: false, excludeFromPinSuggestions: false, excludeFromNewTasksBanner: true,
      defaultTimeSegments: [], sortOrder: 1, emoji: null,
    };

    const mockCategories = (byName: Record<string, typeof routines>) => {
      const { useCategoryStore } = jest.requireMock('../store/useCategoryStore') as { useCategoryStore: { getState: jest.Mock } };
      useCategoryStore.getState.mockReturnValue({
        categories: Object.values(byName),
        initialized: true,
        initialize: jest.fn(),
        addCategory: jest.fn(),
        deleteCategory: jest.fn(),
        restoreCategory: jest.fn(),
        renameCategory: jest.fn().mockReturnValue(true),
        setCategorySchedule: jest.fn(),
        removeCategorySchedule: jest.fn(),
        getCategoryByName: jest.fn((name: string) => byName[name] ?? null),
      });
    };

    // Due today, last looked at years ago: new everywhere except a category
    // that suppresses it.
    const staleTask = (overrides: Partial<Task> = {}) => makeTask({
      id: 't1',
      dueDate: new Date().toISOString(),
      seenAt: '2020-01-01T00:00:00.000Z',
      ...overrides,
    });

    it('marks it seen when leaving a category that suppressed the new flag', () => {
      mockCategories({ Routines: routines });
      useTaskStore.setState({ tasks: [staleTask({ category: 'Routines' })] });

      useTaskStore.getState().updateTask('t1', { category: 'Home' });

      const moved = useTaskStore.getState().tasks[0];
      expect(moved.seenAt).not.toBe('2020-01-01T00:00:00.000Z');
      expect(isTaskNew(moved)).toBe(false);
    });

    it('leaves a task that was already new alone, so the move does not clear its dot', () => {
      mockCategories({});
      useTaskStore.setState({ tasks: [staleTask({ category: 'Errands' })] });

      useTaskStore.getState().updateTask('t1', { category: 'Home' });

      const moved = useTaskStore.getState().tasks[0];
      expect(moved.seenAt).toBe('2020-01-01T00:00:00.000Z');
      expect(isTaskNew(moved)).toBe(true);
    });

    it('leaves seenAt alone when the category is written but unchanged', () => {
      mockCategories({ Routines: routines });
      useTaskStore.setState({ tasks: [staleTask({ category: 'Routines' })] });

      useTaskStore.getState().updateTask('t1', { category: 'Routines', title: 'Renamed' });

      expect(useTaskStore.getState().tasks[0].seenAt).toBe('2020-01-01T00:00:00.000Z');
    });

    it('lets a snapshot undo put the old seenAt back', () => {
      mockCategories({ Routines: routines });
      const before = staleTask({ category: 'Routines' });
      useTaskStore.setState({ tasks: [before] });

      useTaskStore.getState().updateTask('t1', { category: 'Home' });
      useTaskStore.getState().updateTask('t1', { ...before });

      expect(useTaskStore.getState().tasks[0].seenAt).toBe('2020-01-01T00:00:00.000Z');
    });
  });
});

// ─── deleteTask ──────────────────────────────────────────────────────────────

describe('deleteTask', () => {
  it('removes the task from state', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
    });
    useTaskStore.getState().deleteTask('t1');
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['t2']);
  });

  it('also removes subtasks', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'parent' }),
        makeTask({ id: 'child', parentId: 'parent' }),
      ],
    });
    useTaskStore.getState().deleteTask('parent');
    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  it('calls db cleanup and cancels reminder', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
    useTaskStore.getState().deleteTask('t1');
    expect(dbDeleteSubtasks).toHaveBeenCalledWith('t1');
    expect(dbDeleteTask).toHaveBeenCalledWith('t1');
    expect(cancelTaskReminder).toHaveBeenCalledWith('t1');
  });

  it('deletes the linked calendar event when the task has one', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', calendarEventId: 'evt-1' })] });
    useTaskStore.getState().deleteTask('t1');
    expect(deleteCalendarEvent).toHaveBeenCalledWith('evt-1');
  });

  it('does not call deleteCalendarEvent when the task has no linked event', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', calendarEventId: null })] });
    useTaskStore.getState().deleteTask('t1');
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
  });

  it('does not queue an undo action for a nonexistent task', () => {
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().deleteTask('missing');
    expect(useTaskStore.getState().lastAction).toBeNull();
  });

  it('queues an undo action that restores the task and its subtasks', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'parent', title: 'Parent' }),
        makeTask({ id: 'child', parentId: 'parent', title: 'Child' }),
      ],
    });
    useTaskStore.getState().deleteTask('parent');
    expect(useTaskStore.getState().tasks).toHaveLength(0);

    const lastAction = useTaskStore.getState().lastAction;
    expect(lastAction?.label).toBe('Task deleted');
    lastAction?.undo();

    expect(useTaskStore.getState().tasks.map(t => t.id).sort()).toEqual(['child', 'parent']);
    expect(dbInsertTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'parent' }));
    expect(dbInsertTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'child' }));
  });

  it('reconciles a fresh calendar event for the restored task on undo', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', calendarEventId: 'evt-1' })] });
    useTaskStore.getState().deleteTask('t1');
    (syncDeadlineEvent as jest.Mock).mockClear();
    useTaskStore.getState().lastAction?.undo();
    expect(syncDeadlineEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });
});

// ─── duplicateTask ────────────────────────────────────────────────────────────

describe('duplicateTask', () => {
  it('returns null when the task does not exist', () => {
    const result = useTaskStore.getState().duplicateTask('missing');
    expect(result).toBeNull();
    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  it('creates a copy with a new id but the same settings', () => {
    useTaskStore.setState({
      tasks: [makeTask({
        id: 't1',
        title: 'Take multivitamins',
        notes: 'With food',
        tags: ['health'],
        category: 'Morning',
        priority: 2,
        effort: 1,
        recurrenceType: 'daily',
        recurrenceInterval: 1,
        dueDate: '2025-01-05T00:00:00.000Z',
        timeSegments: ['morning'],
        sortOrder: 3,
      })],
    });
    const copy = useTaskStore.getState().duplicateTask('t1');
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe('t1');
    expect(copy!.title).toBe('Take multivitamins');
    expect(copy!.notes).toBe('With food');
    expect(copy!.tags).toEqual(['health']);
    expect(copy!.category).toBe('Morning');
    expect(copy!.priority).toBe(2);
    expect(copy!.effort).toBe(1);
    expect(copy!.recurrenceType).toBe('daily');
    expect(copy!.dueDate).toBe('2025-01-05T00:00:00.000Z');
    expect(copy!.timeSegments).toEqual(['morning']);
    expect(useTaskStore.getState().tasks).toHaveLength(2);
  });

  it('keeps showStreak on the copy even though the streak itself resets', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', recurrenceType: 'daily', showStreak: true, streakCount: 5 })],
    });
    const copy = useTaskStore.getState().duplicateTask('t1')!;
    expect(copy.showStreak).toBe(true);
    expect(copy.streakCount).toBe(0);
  });

  it('resets completion, streak, timer, and occurrence bookkeeping', () => {
    useTaskStore.setState({
      tasks: [makeTask({
        id: 't1',
        completed: true,
        completedAt: '2025-01-01T00:00:00.000Z',
        streakCount: 5,
        streakDate: '2025-01-01T00:00:00.000Z',
        timerStartedAt: '2025-01-01T00:00:00.000Z',
        actualMinutes: 30,
        previousOccurrenceId: 'prev',
        pinned: true,
      })],
    });
    const copy = useTaskStore.getState().duplicateTask('t1')!;
    expect(copy.completed).toBe(false);
    expect(copy.completedAt).toBeNull();
    expect(copy.streakCount).toBe(0);
    expect(copy.streakDate).toBeNull();
    expect(copy.timerStartedAt).toBeNull();
    expect(copy.actualMinutes).toBeNull();
    expect(copy.previousOccurrenceId).toBeNull();
    expect(copy.pinned).toBe(false);
  });

  it('resets chainIndex to 0 instead of copying the mid-chain position', () => {
    useTaskStore.setState({
      tasks: [makeTask({
        id: 't1',
        chainEnabled: true,
        chainItems: [
          { id: 'a', title: 'Step A', estimatedMinutes: null },
          { id: 'b', title: 'Step B', estimatedMinutes: null },
          { id: 'c', title: 'Step C', estimatedMinutes: null },
        ],
        chainIndex: 2,
      })],
    });
    const copy = useTaskStore.getState().duplicateTask('t1')!;
    expect(copy.chainIndex).toBe(0);
  });

  it('sets sortOrder to maxExisting + 1', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 't1', sortOrder: 3 }),
        makeTask({ id: 't2', sortOrder: 7 }),
      ],
    });
    const copy = useTaskStore.getState().duplicateTask('t1')!;
    expect(copy.sortOrder).toBe(8);
  });

  it('also duplicates subtasks under the new parent', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'parent', sortOrder: 1 }),
        makeTask({ id: 'child-1', parentId: 'parent', title: 'Sub A', sortOrder: 1 }),
        makeTask({ id: 'child-2', parentId: 'parent', title: 'Sub B', sortOrder: 2, completed: true }),
      ],
    });
    const copy = useTaskStore.getState().duplicateTask('parent')!;
    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(6);
    const copiedSubtasks = tasks.filter(t => t.parentId === copy.id);
    expect(copiedSubtasks).toHaveLength(2);
    expect(copiedSubtasks.map(t => t.title).sort()).toEqual(['Sub A', 'Sub B']);
    expect(copiedSubtasks.every(t => !t.completed)).toBe(true);
    // Original subtasks are untouched
    expect(tasks.filter(t => t.parentId === 'parent')).toHaveLength(2);
  });

  it('persists the copy to db and schedules its reminder', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
    const copy = useTaskStore.getState().duplicateTask('t1')!;
    expect(dbInsertTask).toHaveBeenCalledWith(copy);
    expect(scheduleTaskReminder).toHaveBeenCalledWith(copy);
  });

  it('does not carry the original calendar event id onto the copy', () => {
    useTaskStore.setState({
      tasks: [makeTask({
        id: 't1', calendarEventId: 'evt-1', deadlineOnCalendar: true,
        deadline: new Date(2025, 5, 20).toISOString(),
      })],
    });
    const copy = useTaskStore.getState().duplicateTask('t1')!;
    expect(copy.calendarEventId).toBeNull();
    // The preference carries; the event doesn't — two tasks must never point
    // at one device event.
    expect(copy.deadlineOnCalendar).toBe(true);
    expect(syncDeadlineEvent).toHaveBeenCalledWith(copy);
  });
});

// ─── completeTask ─────────────────────────────────────────────────────────────

describe('completeTask spawns a stable successor id', () => {
  it('gives the same successor id when the same completion is redone', () => {
    // Stands in for the two-device case, which is the same thing in space
    // rather than in time: the id must come from the completion, not from a
    // random draw, or completing on the phone and the Mac while apart makes
    // two successors where there should be one.
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', recurrenceType: 'daily' })] });

    useTaskStore.getState().completeTask('t1');
    const first = useTaskStore.getState().tasks.find(t => t.previousOccurrenceId === 't1');
    expect(first).toBeDefined();

    useTaskStore.getState().uncompleteTask('t1');
    useTaskStore.getState().completeTask('t1');
    const second = useTaskStore.getState().tasks.find(t => t.previousOccurrenceId === 't1');

    expect(second?.id).toBe(first?.id);
  });

  it('gives different successor ids to different tasks', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 't1', recurrenceType: 'daily' }),
        makeTask({ id: 't2', recurrenceType: 'daily' }),
      ],
    });

    useTaskStore.getState().completeTask('t1');
    useTaskStore.getState().completeTask('t2');

    const spawned = useTaskStore.getState().tasks.filter(t => t.previousOccurrenceId !== null);
    expect(new Set(spawned.map(t => t.id)).size).toBe(spawned.length);
  });
});

describe('completeTask', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 10, 0, 0)); // June 10, 2025 10:00 AM
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('marks the task completed with a completedAt timestamp', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
    useTaskStore.getState().completeTask('t1');
    const task = useTaskStore.getState().tasks.find(t => t.id === 't1');
    expect(task?.completed).toBe(true);
    expect(task?.completedAt).toBeTruthy();
  });

  it('reconciles the deadline calendar event for the completed row', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', deadline: new Date(2025, 5, 20).toISOString() })] });
    useTaskStore.getState().completeTask('t1');
    expect(syncDeadlineEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', completed: true }));
  });

  it('clears calendarEventId on the fresh occurrence of a recurring task', () => {
    useTaskStore.setState({
      tasks: [makeTask({
        id: 't1', recurrenceType: 'daily', dueDate: new Date(2025, 5, 10).toISOString(),
        deadlineOffsetDays: 1, calendarEventId: 'old-evt', deadlineOnCalendar: true,
      })],
    });
    useTaskStore.getState().completeTask('t1');
    const next = useTaskStore.getState().tasks.find(t => t.previousOccurrenceId === 't1');
    expect(next?.calendarEventId).toBeNull();
  });

  it('persists the completed task to the db', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
    useTaskStore.getState().completeTask('t1');
    expect(dbUpdateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', completed: true }));
  });

  it('keeps pinned true through the completion hold, then clears it', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', pinned: true })] });
    useTaskStore.getState().completeTask('t1');
    expect(useTaskStore.getState().tasks.find(t => t.id === 't1')?.pinned).toBe(true);

    jest.advanceTimersByTime(1200);
    expect(useTaskStore.getState().tasks.find(t => t.id === 't1')?.pinned).toBe(false);
  });

  it('does not clear pinned if the completion is undone before the hold expires', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', pinned: true })] });
    useTaskStore.getState().completeTask('t1');
    useTaskStore.getState().uncompleteTask('t1');

    jest.advanceTimersByTime(1200);
    expect(useTaskStore.getState().tasks.find(t => t.id === 't1')?.pinned).toBe(true);
  });

  it('cancels the reminder when completed', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
    useTaskStore.getState().completeTask('t1');
    expect(cancelTaskReminder).toHaveBeenCalledWith('t1');
  });

  it('does not create a next task for non-recurring tasks', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', recurrenceType: 'none' })] });
    useTaskStore.getState().completeTask('t1');
    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });

  it('queues an undo action that uncompletes the task', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', recurrenceType: 'none' })] });
    useTaskStore.getState().completeTask('t1');

    const lastAction = useTaskStore.getState().lastAction;
    expect(lastAction?.label).toBe('Task completed');
    lastAction?.undo();

    expect(useTaskStore.getState().tasks.find(t => t.id === 't1')?.completed).toBe(false);
  });

  it('creates a next task for a daily recurring task', () => {
    const task = makeTask({
      id: 'recurring',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('recurring');

    const { tasks } = useTaskStore.getState();
    expect(tasks).toHaveLength(2);

    const original = tasks.find(t => t.id === 'recurring');
    const next = tasks.find(t => t.id !== 'recurring');
    expect(original?.completed).toBe(true);
    expect(next?.completed).toBe(false);
    expect(next?.pinned).toBe(false); // pin resets
    expect(next?.deferUntil).toBeNull();
    expect(new Date(next!.dueDate!).getTime()).toBeGreaterThan(new Date(task.dueDate!).getTime());
  });

  it('drops a fixed deadline on the next occurrence', () => {
    const task = makeTask({
      id: 'recurring',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      deadline: new Date(2025, 5, 9, 0, 0, 0).toISOString(),
      deadlineOffsetDays: null,
      deadlineMonthDay: null,
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('recurring');

    const next = useTaskStore.getState().tasks.find(t => t.id !== 'recurring');
    expect(next?.deadline).toBeNull();
  });

  it('recomputes a relative deadline against the next occurrence\'s dueDate', () => {
    // Claim the free Epic Games game every Thursday, deadline the Wednesday before
    // (i.e. before the next week's reset) — 1 day before dueDate, every occurrence.
    jest.setSystemTime(new Date(2025, 5, 12, 10, 0, 0)); // Thursday, June 12 2025 — due today
    const task = makeTask({
      id: 'recurring',
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 12, 0, 0, 0).toISOString(), // Thursday, June 12 2025
      deadline: new Date(2025, 5, 11, 0, 0, 0).toISOString(), // Wednesday, June 11 2025
      deadlineOffsetDays: 1,
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('recurring');

    const next = useTaskStore.getState().tasks.find(t => t.id !== 'recurring');
    expect(next?.deadlineOffsetDays).toBe(1);
    expect(new Date(next!.dueDate!).toISOString()).toBe(new Date(2025, 5, 19, 0, 0, 0).toISOString()); // next Thursday
    expect(new Date(next!.deadline!).toISOString()).toBe(new Date(2025, 5, 18, 0, 0, 0).toISOString()); // next Wednesday
  });

  it('recomputes a deadline set *after* the due date against the next occurrence', () => {
    // Filed on the 1st of the month, has to clear by the 10th — the deadline
    // trails the due date rather than leading it, which a negative offset is.
    jest.setSystemTime(new Date(2026, 0, 1, 10, 0, 0)); // Jan 1, 2026 — due today
    const task = makeTask({
      id: 'recurring',
      recurrenceType: 'monthly',
      recurrenceInterval: 1,
      recurrenceMonthDay: 1,
      dueDate: new Date(2026, 0, 1, 0, 0, 0).toISOString(),
      deadline: new Date(2026, 0, 11, 0, 0, 0).toISOString(),
      deadlineOffsetDays: -10,
      deadlineMonthDay: null,
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('recurring');

    const next = useTaskStore.getState().tasks.find(t => t.id !== 'recurring');
    expect(next?.deadlineOffsetDays).toBe(-10);
    expect(new Date(next!.dueDate!).toISOString()).toBe(new Date(2026, 1, 1, 0, 0, 0).toISOString()); // Feb 1
    expect(new Date(next!.deadline!).toISOString()).toBe(new Date(2026, 1, 11, 0, 0, 0).toISOString()); // Feb 11
  });

  it('recomputes a "last day of the month" deadline against the next occurrence\'s dueDate', () => {
    // Due the 20th of every month, deadline the last day of that same month —
    // a fixed day offset can't express this since month lengths vary.
    jest.setSystemTime(new Date(2026, 0, 20, 10, 0, 0)); // Jan 20, 2026 — due today
    const task = makeTask({
      id: 'recurring',
      recurrenceType: 'monthly',
      recurrenceInterval: 1,
      recurrenceMonthDay: 20,
      dueDate: new Date(2026, 0, 20, 0, 0, 0).toISOString(),
      deadline: new Date(2026, 0, 31, 0, 0, 0).toISOString(),
      deadlineOffsetDays: null,
      deadlineMonthDay: -1,
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('recurring');

    const next = useTaskStore.getState().tasks.find(t => t.id !== 'recurring');
    expect(next?.deadlineMonthDay).toBe(-1);
    expect(new Date(next!.dueDate!).toISOString()).toBe(new Date(2026, 1, 20, 0, 0, 0).toISOString()); // Feb 20
    expect(new Date(next!.deadline!).toISOString()).toBe(new Date(2026, 1, 28, 0, 0, 0).toISOString()); // last day of Feb (2026 not leap)
  });

  it('stamps the next occurrence with previousOccurrenceId pointing back at the completed task', () => {
    const task = makeTask({
      id: 'recurring',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('recurring');

    const next = useTaskStore.getState().tasks.find(t => t.id !== 'recurring');
    expect(next?.previousOccurrenceId).toBe('recurring');
  });

  it('applies seriesDefaults content overrides to the next occurrence and resets seriesDefaults on it', () => {
    const task = makeTask({
      id: 'recurring',
      title: 'Edited just today',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      seriesDefaults: { title: 'Series title' },
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('recurring');

    const next = useTaskStore.getState().tasks.find(t => t.id !== 'recurring');
    expect(next?.title).toBe('Series title');
    expect(next?.seriesDefaults).toBeNull();
  });

  it('does not create a next task when recurrenceEndDate is already reached', () => {
    const task = makeTask({
      id: 'ending',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      recurrenceEndDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(), // same as due — next would exceed
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('ending');
    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });

  it('decrements recurrenceCount on the next occurrence', () => {
    const task = makeTask({
      id: 'counted',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      recurrenceCount: 3,
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('counted');

    const { tasks } = useTaskStore.getState();
    const next = tasks.find(t => t.id !== 'counted');
    expect(next?.recurrenceCount).toBe(2);
  });

  it('does not create a next task when recurrenceCount reaches 0', () => {
    const task = makeTask({
      id: 'last-one',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      recurrenceCount: 1,
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('last-one');
    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });

  it('advances a chain immediately with no due date when the task does not recur', () => {
    const task = makeTask({
      id: 'chained',
      recurrenceType: 'none',
      dueDate: null,
      chainEnabled: true,
      chainItems: [
        { id: 'a', title: 'Step A', estimatedMinutes: null },
        { id: 'b', title: 'Step B', estimatedMinutes: null },
        { id: 'c', title: 'Step C', estimatedMinutes: null },
      ],
      chainIndex: 0,
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('chained');

    const { tasks } = useTaskStore.getState();
    expect(tasks).toHaveLength(2);
    const next = tasks.find(t => t.id !== 'chained');
    expect(next?.chainIndex).toBe(1);
    expect(next?.dueDate).toBeNull();
    expect(next?.completed).toBe(false);
  });

  it('ends a non-recurring chain after its last item instead of wrapping around', () => {
    const task = makeTask({
      id: 'chained-end',
      recurrenceType: 'none',
      chainEnabled: true,
      chainItems: [
        { id: 'a', title: 'Step A', estimatedMinutes: null },
        { id: 'b', title: 'Step B', estimatedMinutes: null },
      ],
      chainIndex: 1, // already on the last item
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('chained-end');

    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });

  it('wraps a chain back to its first item when the task recurs and reaches the end', () => {
    const task = makeTask({
      id: 'chained-recurring',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      chainEnabled: true,
      chainItems: [
        { id: 'a', title: 'Step A', estimatedMinutes: null },
        { id: 'b', title: 'Step B', estimatedMinutes: null },
      ],
      chainIndex: 1, // already on the last item
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('chained-recurring');

    const next = useTaskStore.getState().tasks.find(t => t.id !== 'chained-recurring');
    expect(next?.chainIndex).toBe(0); // whole chain repeats
    expect(next?.dueDate).not.toBeNull();
  });

  it('advances a mid-chain step immediately on a repeating chain instead of waiting a full cycle', () => {
    const task = makeTask({
      id: 'mid-chain-recurring',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      recurrenceCount: 5,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      streakCount: 2,
      streakDate: new Date(2025, 5, 9, 0, 0, 0).toISOString(),
      chainEnabled: true,
      chainItems: [
        { id: 'a', title: 'Step A', estimatedMinutes: null },
        { id: 'b', title: 'Step B', estimatedMinutes: null },
        { id: 'c', title: 'Step C', estimatedMinutes: null },
      ],
      chainIndex: 0, // not the last step
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('mid-chain-recurring');

    const { tasks } = useTaskStore.getState();
    expect(tasks).toHaveLength(2);
    const completed = tasks.find(t => t.id === 'mid-chain-recurring')!;
    const next = tasks.find(t => t.id !== 'mid-chain-recurring')!;
    expect(next.chainIndex).toBe(1);
    // Spawns today, not on the daily schedule's next date (2025-06-11).
    expect(next.dueDate).not.toBeNull();
    expect(new Date(next.dueDate!).toDateString()).toBe(new Date().toDateString());
    expect(new Date(next.dueDate!).toDateString()).not.toBe('Wed Jun 11 2025');
    // The recurrence's own schedule (count, streak) only advances at the end
    // of the chain, not on every intermediate step.
    expect(next.recurrenceCount).toBe(5);
    expect(next.streakCount).toBe(task.streakCount);
    expect(completed.streakCount).toBe(task.streakCount);
  });

  // ---- per-step scheduling ("Next step: on the next repeat") ----

  const rotationSteps = () => [
    { id: 'a', title: 'Step A', estimatedMinutes: null },
    { id: 'b', title: 'Step B', estimatedMinutes: null },
    { id: 'c', title: 'Step C', estimatedMinutes: null },
  ];

  it('lands a mid-chain step on the next occurrence when steps are scheduled', () => {
    const task = makeTask({
      id: 'rotation',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      chainEnabled: true,
      chainStepOnSchedule: true,
      chainItems: rotationSteps(),
      chainIndex: 0,
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('rotation');

    const next = useTaskStore.getState().tasks.find(t => t.id !== 'rotation')!;
    expect(next.chainIndex).toBe(1);
    // The daily schedule's next date, not today — this is the whole difference
    // from the default mode, which spawns onto the completion day.
    expect(new Date(next.dueDate!).toDateString()).toBe('Wed Jun 11 2025');
  });

  it('advances the streak on every scheduled step but the recurrence count only per cycle', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const task = makeTask({
      id: 'rotation-count',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      recurrenceCount: 5,
      dueDate: new Date().toISOString(),
      streakCount: 3,
      streakDate: yesterday.toISOString(),
      chainEnabled: true,
      chainStepOnSchedule: true,
      chainItems: rotationSteps(),
      chainIndex: 0, // mid-chain
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('rotation-count');

    const next = useTaskStore.getState().tasks.find(t => t.id !== 'rotation-count')!;
    // Per step, and not a preference: getStreakOutcome measures the gap against
    // the daily cadence, so advancing once per cycle would show a 3-day gap
    // against an expected 1 and reset the streak every time round.
    expect(next.streakCount).toBe(4);
    // "Repeat 5 times" still means five times through the chain, not five steps.
    expect(next.recurrenceCount).toBe(5);
  });

  it('decrements the recurrence count when a scheduled chain wraps', () => {
    const task = makeTask({
      id: 'rotation-wrap',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      recurrenceCount: 5,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      chainEnabled: true,
      chainStepOnSchedule: true,
      chainItems: rotationSteps(),
      chainIndex: 2, // last step
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('rotation-wrap');

    const next = useTaskStore.getState().tasks.find(t => t.id !== 'rotation-wrap')!;
    expect(next.chainIndex).toBe(0);
    expect(next.recurrenceCount).toBe(4);
  });

  it('finishes a scheduled chain already in progress when the repeat has expired', () => {
    const task = makeTask({
      id: 'rotation-expired',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      recurrenceEndDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      chainEnabled: true,
      chainStepOnSchedule: true,
      chainItems: rotationSteps(),
      chainIndex: 0,
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('rotation-expired');

    const next = useTaskStore.getState().tasks.find(t => t.id !== 'rotation-expired');
    // Ending the repeat isn't a request to abandon the run in progress, so the
    // remaining steps still spawn — and fall back to today rather than losing
    // their date and dropping out of every list.
    expect(next).toBeDefined();
    expect(next!.chainIndex).toBe(1);
    expect(new Date(next!.dueDate!).toDateString()).toBe(new Date().toDateString());
  });

  it('ignores per-step scheduling on a chain with no repeat to wait for', () => {
    const task = makeTask({
      id: 'rotation-no-repeat',
      recurrenceType: 'none',
      dueDate: null,
      chainEnabled: true,
      chainStepOnSchedule: true,
      chainItems: rotationSteps(),
      chainIndex: 0,
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('rotation-no-repeat');

    const next = useTaskStore.getState().tasks.find(t => t.id !== 'rotation-no-repeat')!;
    expect(next.chainIndex).toBe(1);
    expect(next.dueDate).toBeNull();
  });

  it('carries subtasks onto the spawned chain step, reset to unchecked', () => {
    const task = makeTask({
      id: 'chained-with-subtasks',
      chainEnabled: true,
      chainItems: [
        { id: 'a', title: 'Step A', estimatedMinutes: null },
        { id: 'b', title: 'Step B', estimatedMinutes: null },
      ],
      chainIndex: 0,
    });
    const sub1 = makeTask({ id: 'sub-1', parentId: 'chained-with-subtasks', title: 'Sub A', sortOrder: 1 });
    const sub2 = makeTask({
      id: 'sub-2', parentId: 'chained-with-subtasks', title: 'Sub B', sortOrder: 2, completed: true,
    });
    useTaskStore.setState({ tasks: [task, sub1, sub2] });
    useTaskStore.getState().completeTask('chained-with-subtasks');

    const { tasks } = useTaskStore.getState();
    const next = tasks.find(t => t.chainIndex === 1 && !t.parentId)!;
    expect(next).toBeDefined();
    const nextSubtasks = tasks.filter(t => t.parentId === next.id);
    expect(nextSubtasks).toHaveLength(2);
    expect(nextSubtasks.map(s => s.title).sort()).toEqual(['Sub A', 'Sub B']);
    expect(nextSubtasks.every(s => !s.completed)).toBe(true);
    // Original subtasks are untouched, still attached to the now-completed step.
    expect(tasks.filter(t => t.parentId === 'chained-with-subtasks')).toHaveLength(2);
  });

  it('does not complete a recurring task whose dueDate is a future day', () => {
    const task = makeTask({
      id: 't1',
      recurrenceType: 'daily',
      dueDate: new Date(2025, 5, 12, 0, 0, 0).toISOString(), // 2 days out
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('t1');
    expect(dbUpdateTask).not.toHaveBeenCalled();
    expect(dbInsertTask).not.toHaveBeenCalled();
    const stored = useTaskStore.getState().tasks.find(t => t.id === 't1');
    expect(stored?.completed).toBe(false);
  });

  it('does not complete a recurring task deferred to a future day', () => {
    const task = makeTask({
      id: 't1',
      recurrenceType: 'daily',
      deferUntil: new Date(2025, 5, 11, 0, 0, 0).toISOString(),
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('t1');
    expect(dbUpdateTask).not.toHaveBeenCalled();
    const stored = useTaskStore.getState().tasks.find(t => t.id === 't1');
    expect(stored?.completed).toBe(false);
  });

  it('completes a recurring task whose dueDate is today or in the past', () => {
    const task = makeTask({
      id: 't1',
      recurrenceType: 'daily',
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('t1');
    const stored = useTaskStore.getState().tasks.find(t => t.id === 't1');
    expect(stored?.completed).toBe(true);
  });

  it('completes a non-recurring task even with a future dueDate', () => {
    const task = makeTask({
      id: 't1',
      recurrenceType: 'none',
      dueDate: new Date(2025, 5, 12, 0, 0, 0).toISOString(),
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('t1');
    const stored = useTaskStore.getState().tasks.find(t => t.id === 't1');
    expect(stored?.completed).toBe(true);
  });

  it('does nothing when task id is not found', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
    useTaskStore.getState().completeTask('nonexistent');
    expect(dbUpdateTask).not.toHaveBeenCalled();
  });

  it('is a no-op when called again on an already-completed task', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', completed: true, completedAt: '2025-06-10T09:00:00.000Z' })] });
    useTaskStore.getState().completeTask('t1');
    expect(dbUpdateTask).not.toHaveBeenCalled();
    const task = useTaskStore.getState().tasks.find(t => t.id === 't1');
    expect(task?.completedAt).toBe('2025-06-10T09:00:00.000Z');
  });

  it('does not create duplicate next tasks when a recurring task is completed twice', () => {
    const task = makeTask({
      id: 'recurring',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('recurring');
    useTaskStore.getState().completeTask('recurring');

    expect(useTaskStore.getState().tasks).toHaveLength(2);
    expect(dbInsertTask).toHaveBeenCalledTimes(1);
  });

  describe('streak logic', () => {
    it('sets streak to 1 on first completion of a recurring task', () => {
      const task = makeTask({ recurrenceType: 'daily', streakCount: 0, streakDate: null });
      useTaskStore.setState({ tasks: [task] });
      useTaskStore.getState().completeTask(task.id);
      const completed = useTaskStore.getState().tasks.find(t => t.id === task.id);
      expect(completed?.streakCount).toBe(1);
    });

    it('preserves streak when completed again on the same logical day', () => {
      const todayStart = new Date(2025, 5, 10, 0, 0, 0).toISOString();
      const task = makeTask({ recurrenceType: 'daily', streakCount: 5, streakDate: todayStart });
      useTaskStore.setState({ tasks: [task] });
      useTaskStore.getState().completeTask(task.id);
      const completed = useTaskStore.getState().tasks.find(t => t.id === task.id);
      expect(completed?.streakCount).toBe(5);
    });

    it('increments streak when completed on the following day', () => {
      const yesterdayStart = new Date(2025, 5, 9, 0, 0, 0).toISOString();
      const task = makeTask({ recurrenceType: 'daily', streakCount: 3, streakDate: yesterdayStart });
      useTaskStore.setState({ tasks: [task] });
      useTaskStore.getState().completeTask(task.id);
      const completed = useTaskStore.getState().tasks.find(t => t.id === task.id);
      expect(completed?.streakCount).toBe(4);
    });

    it('resets streak to 1 when a day was missed', () => {
      const twoDaysAgoStart = new Date(2025, 5, 8, 0, 0, 0).toISOString();
      const task = makeTask({ recurrenceType: 'daily', streakCount: 10, streakDate: twoDaysAgoStart });
      useTaskStore.setState({ tasks: [task] });
      useTaskStore.getState().completeTask(task.id);
      const completed = useTaskStore.getState().tasks.find(t => t.id === task.id);
      expect(completed?.streakCount).toBe(1);
    });

    it('does not modify streakCount for non-recurring tasks', () => {
      const task = makeTask({ recurrenceType: 'none', streakCount: 7 });
      useTaskStore.setState({ tasks: [task] });
      useTaskStore.getState().completeTask(task.id);
      const completed = useTaskStore.getState().tasks.find(t => t.id === task.id);
      expect(completed?.streakCount).toBe(7);
    });

    it('snapshots the pre-completion streak onto previousStreakCount/previousStreakDate', () => {
      const yesterdayStart = new Date(2025, 5, 9, 0, 0, 0).toISOString();
      const task = makeTask({ recurrenceType: 'daily', streakCount: 3, streakDate: yesterdayStart });
      useTaskStore.setState({ tasks: [task] });
      useTaskStore.getState().completeTask(task.id);
      const completed = useTaskStore.getState().tasks.find(t => t.id === task.id);
      expect(completed?.previousStreakCount).toBe(3);
      expect(completed?.previousStreakDate).toBe(yesterdayStart);
    });

    // #1255: a task opted into streakRequiresWindow. System time throughout
    // this describe is June 10, 2025, 10:00 AM (the outer beforeEach).
    describe('streakRequiresWindow', () => {
      it('continues the streak on a completion inside the window', () => {
        const yesterdayStart = new Date(2025, 5, 9, 0, 0, 0).toISOString();
        const task = makeTask({
          recurrenceType: 'daily', streakCount: 3, streakDate: yesterdayStart,
          streakRequiresWindow: true, windowStart: '08:00', windowEnd: '18:00',
        });
        useTaskStore.setState({ tasks: [task] });
        useTaskStore.getState().completeTask(task.id);
        const completed = useTaskStore.getState().tasks.find(t => t.id === task.id);
        expect(completed?.streakCount).toBe(4);
      });

      it('still logs the completion but resets the streak on a completion outside the window', () => {
        const yesterdayStart = new Date(2025, 5, 9, 0, 0, 0).toISOString();
        const task = makeTask({
          recurrenceType: 'daily', streakCount: 3, streakDate: yesterdayStart,
          streakRequiresWindow: true, windowStart: '07:00', windowEnd: '09:00', // closed by 10:00 AM
        });
        useTaskStore.setState({ tasks: [task] });
        useTaskStore.getState().completeTask(task.id);
        const completed = useTaskStore.getState().tasks.find(t => t.id === task.id);
        expect(completed?.completed).toBe(true);
        expect(completed?.completedAt).toBeTruthy();
        expect(completed?.streakCount).toBe(1);
        expect(completed?.streakDate).toBeTruthy();
      });

      it('is inert on a task with no window at all', () => {
        const yesterdayStart = new Date(2025, 5, 9, 0, 0, 0).toISOString();
        const task = makeTask({
          recurrenceType: 'daily', streakCount: 3, streakDate: yesterdayStart,
          streakRequiresWindow: true,
        });
        useTaskStore.setState({ tasks: [task] });
        useTaskStore.getState().completeTask(task.id);
        const completed = useTaskStore.getState().tasks.find(t => t.id === task.id);
        expect(completed?.streakCount).toBe(4);
      });

      it('behaves like an on-time completion when the setting is off, even outside a window', () => {
        const yesterdayStart = new Date(2025, 5, 9, 0, 0, 0).toISOString();
        const task = makeTask({
          recurrenceType: 'daily', streakCount: 3, streakDate: yesterdayStart,
          streakRequiresWindow: false, windowStart: '07:00', windowEnd: '09:00',
        });
        useTaskStore.setState({ tasks: [task] });
        useTaskStore.getState().completeTask(task.id);
        const completed = useTaskStore.getState().tasks.find(t => t.id === task.id);
        expect(completed?.streakCount).toBe(4);
      });
    });
  });

  describe('completion hold (deferred list removal)', () => {
    // June 10, 2025 10:00 AM (this describe's beforeEach system time) — every
    // task here needs a due date of today, otherwise it'd never have counted
    // as visible in the first place (see isTaskVisible's Inbox/Unscheduled
    // date-signal gate), independent of the completion hold under test.
    const dueToday = new Date(2025, 5, 10, 0, 0, 0).toISOString();

    it('keeps a just-completed task in visibleTasks until the hold window passes', () => {
      useTaskStore.setState({ tasks: [makeTask({ id: 't1', dueDate: dueToday })] });
      useTaskStore.getState().completeTask('t1');
      expect(useTaskStore.getState().visibleTasks().map(t => t.id)).toEqual(['t1']);

      jest.advanceTimersByTime(1200);
      expect(useTaskStore.getState().visibleTasks()).toHaveLength(0);
    });

    it('resets the hold window on each new completion, so a burst clears together', () => {
      useTaskStore.setState({
        tasks: [
          makeTask({ id: 't1', sortOrder: 1, dueDate: dueToday }),
          makeTask({ id: 't2', sortOrder: 2, dueDate: dueToday }),
        ],
      });
      useTaskStore.getState().completeTask('t1');
      jest.advanceTimersByTime(400);
      useTaskStore.getState().completeTask('t2');
      jest.advanceTimersByTime(800);
      // t1 completed 1200ms ago, but t2's completion pushed the window out,
      // so both are still held together.
      expect(useTaskStore.getState().visibleTasks().map(t => t.id).sort()).toEqual(['t1', 't2']);

      jest.advanceTimersByTime(300);
      expect(useTaskStore.getState().visibleTasks()).toHaveLength(0);
    });

    it('also holds a just-completed task in pinnedTasks', () => {
      useTaskStore.setState({ tasks: [makeTask({ id: 't1', pinned: true })] });
      useTaskStore.getState().completeTask('t1');
      expect(useTaskStore.getState().pinnedTasks().map(t => t.id)).toEqual(['t1']);

      jest.advanceTimersByTime(1200);
      expect(useTaskStore.getState().pinnedTasks()).toHaveLength(0);
    });
  });

  describe('completion collapse (batched gap close)', () => {
    const collapsed = () => [...useTaskStore.getState().completionCollapseIds].sort();
    const store = () => useTaskStore.getState();

    it('calls the collapse in once completions settle', () => {
      useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
      store().beginCompletionAnimation('t1');
      store().completeTask('t1');
      expect(collapsed()).toEqual([]);

      jest.advanceTimersByTime(300);
      expect(collapsed()).toEqual(['t1']);
      // Well inside the hold, so the row is still in the list to be collapsed
      // rather than being unmounted mid-shrink.
      expect(useTaskStore.getState().completionHoldIds).toEqual(['t1']);
    });

    it('waits for a tap that is still animating, so a burst collapses together', () => {
      useTaskStore.setState({ tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })] });
      store().beginCompletionAnimation('t1');
      store().completeTask('t1');
      // The second tap lands while t1 is waiting on its collapse — long enough
      // after it that a settle timer of its own would already have fired.
      store().beginCompletionAnimation('t2');
      jest.advanceTimersByTime(400);
      expect(collapsed()).toEqual([]);

      store().completeTask('t2');
      jest.advanceTimersByTime(300);
      expect(collapsed()).toEqual(['t1', 't2']);
    });

    it('stops waiting on a completion the user took back', () => {
      useTaskStore.setState({ tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })] });
      store().beginCompletionAnimation('t1');
      store().completeTask('t1');
      store().beginCompletionAnimation('t2');
      jest.advanceTimersByTime(400);
      expect(collapsed()).toEqual([]);

      store().cancelCompletionAnimation('t2');
      jest.advanceTimersByTime(300);
      expect(collapsed()).toEqual(['t1']);
    });

    it('stops waiting on a completion that turns out to be a no-op', () => {
      useTaskStore.setState({
        tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2', completed: true })],
      });
      store().beginCompletionAnimation('t1');
      store().completeTask('t1');
      // Already completed, so completeTask returns without holding anything —
      // it still has to let go of the batch on its way out.
      store().beginCompletionAnimation('t2');
      store().completeTask('t2');
      jest.advanceTimersByTime(300);
      expect(collapsed()).toEqual(['t1']);
    });

    it('clears the batch along with the hold', () => {
      useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
      store().beginCompletionAnimation('t1');
      store().completeTask('t1');
      jest.advanceTimersByTime(1200);
      expect(collapsed()).toEqual([]);
      expect(useTaskStore.getState().completionHoldIds).toEqual([]);
    });

    it('takes an uncompleted row back out of the batch', () => {
      useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
      store().beginCompletionAnimation('t1');
      store().completeTask('t1');
      jest.advanceTimersByTime(300);
      expect(collapsed()).toEqual(['t1']);

      store().uncompleteTask('t1');
      expect(collapsed()).toEqual([]);
    });

    // The two ways the hold can let a row go, which TaskItem has to tell apart:
    // the row it releases on expiry is gone from the list and unmounts on its
    // own, while the one it releases to an undo is still there — and still
    // collapsed to nothing from the batch, unless the row puts itself back
    // (see restoreFromCompletion in TaskItem).
    it('drops a released row from the list on expiry, but keeps an uncompleted one', () => {
      // Due today, like the completion-hold block above: an undated task never
      // counts as visible in the first place, so the list assertions below
      // would pass for the wrong reason.
      const dueToday = new Date(2025, 5, 10, 0, 0, 0).toISOString();
      useTaskStore.setState({ tasks: [makeTask({ id: 't1', dueDate: dueToday })] });
      store().beginCompletionAnimation('t1');
      store().completeTask('t1');
      jest.advanceTimersByTime(300);
      expect(useTaskStore.getState().completionHoldIds).toEqual(['t1']);

      store().uncompleteTask('t1');
      expect(useTaskStore.getState().completionHoldIds).toEqual([]);
      expect(store().visibleTasks().map(t => t.id)).toEqual(['t1']);

      store().beginCompletionAnimation('t1');
      store().completeTask('t1');
      jest.advanceTimersByTime(1200);
      expect(useTaskStore.getState().completionHoldIds).toEqual([]);
      expect(store().visibleTasks()).toHaveLength(0);
    });
  });
});

// ─── checkVacationExpiry ────────────────────────────────────────────────────

describe('checkVacationExpiry', () => {
  const getSettingsMock = () => {
    const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as { useSettingsStore: { getState: jest.Mock } };
    return useSettingsStore;
  };

  it('does nothing when vacation mode is off', () => {
    const setVacationMode = jest.fn();
    getSettingsMock().getState.mockReturnValue({
      dayResetTime: '00:00', vacationMode: false, vacationEnd: '2025-06-01T23:59:59.999Z', setVacationMode,
    });
    useTaskStore.getState().checkVacationExpiry();
    expect(setVacationMode).not.toHaveBeenCalled();
  });

  it('does nothing when no end date is set', () => {
    const setVacationMode = jest.fn();
    getSettingsMock().getState.mockReturnValue({
      dayResetTime: '00:00', vacationMode: true, vacationEnd: null, setVacationMode,
    });
    useTaskStore.getState().checkVacationExpiry();
    expect(setVacationMode).not.toHaveBeenCalled();
  });

  it('does nothing when the end date has not passed yet', () => {
    const setVacationMode = jest.fn();
    const future = new Date(Date.now() + 60_000).toISOString();
    getSettingsMock().getState.mockReturnValue({
      dayResetTime: '00:00', vacationMode: true, vacationEnd: future, setVacationMode,
    });
    useTaskStore.getState().checkVacationExpiry();
    expect(setVacationMode).not.toHaveBeenCalled();
  });

  it('turns vacation mode off and forgives streaks once the end date has passed', () => {
    const setVacationMode = jest.fn();
    const past = new Date(Date.now() - 60_000).toISOString();
    getSettingsMock().getState.mockReturnValue({
      dayResetTime: '00:00', vacationMode: true, vacationEnd: past, setVacationMode,
    });
    const streakDate = new Date(2025, 0, 1).toISOString();
    const task = makeTask({ id: 't1', vacationPause: true, recurrenceType: 'daily', streakCount: 3, streakDate });
    useTaskStore.setState({ tasks: [task] });

    useTaskStore.getState().checkVacationExpiry();

    expect(setVacationMode).toHaveBeenCalledWith(false);
    const updated = useTaskStore.getState().tasks.find(t => t.id === 't1');
    expect(updated?.streakDate).not.toBe(streakDate);
  });
});

// ─── uncompleteTask ───────────────────────────────────────────────────────────

describe('uncompleteTask', () => {
  it('clears completed flag and completedAt', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', completed: true, completedAt: '2025-06-10T10:00:00.000Z' })],
    });
    useTaskStore.getState().uncompleteTask('t1');
    const task = useTaskStore.getState().tasks[0];
    expect(task.completed).toBe(false);
    expect(task.completedAt).toBeNull();
  });

  it('persists the change to the db', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', completed: true, completedAt: 'now' })] });
    useTaskStore.getState().uncompleteTask('t1');
    expect(dbUpdateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', completed: false }));
  });

  it('removes the untouched follow-up occurrence spawned by the completion', () => {
    const original = makeTask({ id: 't1', completed: true, completedAt: 'now', recurrenceType: 'daily' });
    const followUp = makeTask({ id: 't2', previousOccurrenceId: 't1', completed: false });
    useTaskStore.setState({ tasks: [original, followUp] });

    useTaskStore.getState().uncompleteTask('t1');

    const { tasks } = useTaskStore.getState();
    expect(tasks.map(t => t.id)).toEqual(['t1']);
    expect(dbDeleteTask).toHaveBeenCalledWith('t2');
    expect(dbDeleteSubtasks).toHaveBeenCalledWith('t2');
    expect(cancelTaskReminder).toHaveBeenCalledWith('t2');
  });

  it('also removes subtasks of the deleted follow-up occurrence', () => {
    const original = makeTask({ id: 't1', completed: true, completedAt: 'now', recurrenceType: 'daily' });
    const followUp = makeTask({ id: 't2', previousOccurrenceId: 't1', completed: false });
    const followUpSubtask = makeTask({ id: 't2-sub', parentId: 't2' });
    useTaskStore.setState({ tasks: [original, followUp, followUpSubtask] });

    useTaskStore.getState().uncompleteTask('t1');

    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['t1']);
  });

  it('keeps a follow-up occurrence that has itself already been completed', () => {
    const original = makeTask({ id: 't1', completed: true, completedAt: 'now', recurrenceType: 'daily' });
    const followUp = makeTask({ id: 't2', previousOccurrenceId: 't1', completed: true });
    useTaskStore.setState({ tasks: [original, followUp] });

    useTaskStore.getState().uncompleteTask('t1');

    const { tasks } = useTaskStore.getState();
    expect(tasks.map(t => t.id).sort()).toEqual(['t1', 't2']);
    expect(dbDeleteTask).not.toHaveBeenCalled();
  });

  it('does not touch unrelated tasks', () => {
    const original = makeTask({ id: 't1', completed: true, completedAt: 'now', recurrenceType: 'daily' });
    const unrelated = makeTask({ id: 't3', previousOccurrenceId: null, completed: false });
    useTaskStore.setState({ tasks: [original, unrelated] });

    useTaskStore.getState().uncompleteTask('t1');

    expect(useTaskStore.getState().tasks.map(t => t.id).sort()).toEqual(['t1', 't3']);
    expect(dbDeleteTask).not.toHaveBeenCalled();
  });

  it('restores the pre-completion chainIndex when undoing a mid-chain step, and removes the spawned next step', () => {
    const task = makeTask({
      id: 't1',
      chainEnabled: true,
      chainItems: [
        { id: 'a', title: 'Step A', estimatedMinutes: null },
        { id: 'b', title: 'Step B', estimatedMinutes: null },
        { id: 'c', title: 'Step C', estimatedMinutes: null },
      ],
      chainIndex: 0,
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().completeTask('t1');

    let tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(2);
    const spawned = tasks.find(t => t.id !== 't1')!;
    expect(spawned.chainIndex).toBe(1);

    useTaskStore.getState().uncompleteTask('t1');

    tasks = useTaskStore.getState().tasks;
    expect(tasks.map(t => t.id)).toEqual(['t1']);
    const restored = tasks[0];
    expect(restored.completed).toBe(false);
    expect(restored.chainIndex).toBe(0);
  });

  it('restores streakCount/streakDate to their pre-completion values', () => {
    const yesterdayStart = new Date(2025, 5, 9, 0, 0, 0).toISOString();
    const task = makeTask({
      id: 't1',
      completed: true,
      completedAt: 'now',
      recurrenceType: 'daily',
      streakCount: 6,
      streakDate: '2025-06-10T00:00:00.000Z',
      previousStreakCount: 5,
      previousStreakDate: yesterdayStart,
    });
    useTaskStore.setState({ tasks: [task] });

    useTaskStore.getState().uncompleteTask('t1');

    const updated = useTaskStore.getState().tasks.find(t => t.id === 't1');
    expect(updated?.streakCount).toBe(5);
    expect(updated?.streakDate).toBe(yesterdayStart);
    expect(dbUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1', streakCount: 5, streakDate: yesterdayStart })
    );
  });

  it('undoes a completion end-to-end back to the exact prior streak', () => {
    // Complete a task whose streak was 5 (last completed yesterday), then
    // undo it via uncompleteTask — the streak should land back on 5, not 0.
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 10, 0, 0)); // June 10, 2025 10:00 AM
    try {
      const yesterdayStart = new Date(2025, 5, 9, 0, 0, 0).toISOString();
      const task = makeTask({ id: 't1', recurrenceType: 'daily', streakCount: 5, streakDate: yesterdayStart });
      useTaskStore.setState({ tasks: [task] });

      useTaskStore.getState().completeTask('t1');
      expect(useTaskStore.getState().tasks.find(t => t.id === 't1')?.streakCount).toBe(6);

      useTaskStore.getState().uncompleteTask('t1');
      const reverted = useTaskStore.getState().tasks.find(t => t.id === 't1');
      expect(reverted?.streakCount).toBe(5);
      expect(reverted?.streakDate).toBe(yesterdayStart);
    } finally {
      jest.useRealTimers();
    }
  });

  it('queues an undo action that restores the completed task (e.g. un-completing from the Logbook)', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', completed: true, completedAt: 'now', recurrenceType: 'none' })],
    });
    useTaskStore.getState().uncompleteTask('t1');
    expect(useTaskStore.getState().tasks.find(t => t.id === 't1')?.completed).toBe(false);

    const lastAction = useTaskStore.getState().lastAction;
    expect(lastAction?.label).toBe('Task uncompleted');
    lastAction?.undo();

    expect(useTaskStore.getState().tasks.find(t => t.id === 't1')?.completed).toBe(true);
  });

  it('undo restores the follow-up occurrence it removed', () => {
    const original = makeTask({ id: 't1', completed: true, completedAt: 'now', recurrenceType: 'daily' });
    const followUp = makeTask({ id: 't2', previousOccurrenceId: 't1', completed: false });
    useTaskStore.setState({ tasks: [original, followUp] });

    useTaskStore.getState().uncompleteTask('t1');
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['t1']);

    useTaskStore.getState().lastAction?.undo();

    expect(useTaskStore.getState().tasks.map(t => t.id).sort()).toEqual(['t1', 't2']);
    expect(useTaskStore.getState().tasks.find(t => t.id === 't1')?.completed).toBe(true);
  });
});

// ─── deferTask ────────────────────────────────────────────────────────────────

describe('deferTask', () => {
  it('sets deferUntil on the task', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1' })] });
    const until = new Date(2025, 5, 15, 9, 0, 0);
    useTaskStore.getState().deferTask('t1', until);
    const task = useTaskStore.getState().tasks[0];
    expect(task.deferUntil).toBe(until.toISOString());
  });
});

// ─── deloadTasks ────────────────────────────────────────────────────────────

describe('deloadTasks', () => {
  const thursday = new Date(2025, 5, 12, 12, 0, 0).toISOString();
  const friday = new Date(2025, 5, 13, 12, 0, 0).toISOString();

  it('applies each move with its own field updates', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'recurring', dueDate: new Date(2025, 5, 10).toISOString() }),
        makeTask({ id: 'oneoff', dueDate: new Date(2025, 5, 10).toISOString() }),
      ],
    });

    useTaskStore.getState().deloadTasks([
      { id: 'recurring', updates: { deferUntil: thursday } },
      { id: 'oneoff', updates: { dueDate: friday, deferUntil: null } },
    ]);

    const [recurring, oneoff] = useTaskStore.getState().tasks;
    expect(recurring.deferUntil).toBe(thursday);
    expect(recurring.dueDate).toBe(new Date(2025, 5, 10).toISOString());
    expect(oneoff.dueDate).toBe(friday);
    expect(oneoff.deferUntil).toBeNull();
  });

  it('undoes the whole batch as one action', () => {
    const originalDue = new Date(2025, 5, 10).toISOString();
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', dueDate: originalDue }),
        makeTask({ id: 'b', dueDate: originalDue, deferUntil: null }),
      ],
    });

    useTaskStore.getState().deloadTasks([
      { id: 'a', updates: { deferUntil: thursday } },
      { id: 'b', updates: { dueDate: friday, deferUntil: null } },
    ]);
    expect(useTaskStore.getState().lastAction?.label).toBe('2 tasks moved');

    useTaskStore.getState().undoLastAction();

    const [a, b] = useTaskStore.getState().tasks;
    expect(a.deferUntil).toBeNull();
    expect(a.dueDate).toBe(originalDue);
    expect(b.dueDate).toBe(originalDue);
  });

  it('labels a single move in the singular', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' })] });
    useTaskStore.getState().deloadTasks([{ id: 'a', updates: { deferUntil: thursday } }]);
    expect(useTaskStore.getState().lastAction?.label).toBe('1 task moved');
  });

  it('ignores moves for tasks that no longer exist', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' })] });
    useTaskStore.getState().deloadTasks([
      { id: 'a', updates: { deferUntil: thursday } },
      { id: 'gone', updates: { deferUntil: thursday } },
    ]);
    expect(useTaskStore.getState().lastAction?.label).toBe('1 task moved');
    expect(useTaskStore.getState().tasks[0].deferUntil).toBe(thursday);
  });

  it('records no action for an empty batch', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' })], lastAction: null });
    useTaskStore.getState().deloadTasks([]);
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

// ─── applyTitleRuleToExisting ───────────────────────────────────────────────

describe('applyTitleRuleToExisting', () => {
  const expenseRule: TitleRule = {
    id: 'rule-1',
    keywords: ['expense'],
    match: 'startsWith',
    category: 'Work',
    projectId: null,
    tags: ['admin'],
    priority: 0,
    effort: 1,
    stripKeyword: false,
    enabled: true,
  };

  it('files the matching live tasks and leaves everything else alone', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', title: 'Expense the client lunch' }),
        makeTask({ id: 'b', title: 'Water the plants' }),
        makeTask({ id: 'c', title: 'Expense the taxi', completed: true }),
      ],
    });

    expect(useTaskStore.getState().applyTitleRuleToExisting(expenseRule)).toBe(1);

    const [a, b, c] = useTaskStore.getState().tasks;
    expect(a).toMatchObject({ category: 'Work', effort: 1, tags: ['admin'] });
    expect(b.category).toBeNull();
    expect(c.category).toBeNull();
  });

  it('fills a blank field without overriding one the task already answered', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', title: 'Expense the client lunch', category: 'Home', effort: 4 })],
    });

    useTaskStore.getState().applyTitleRuleToExisting(expenseRule);

    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      category: 'Home', effort: 4, tags: ['admin'],
    });
  });

  it('undoes the whole catch-up as one action', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', title: 'Expense the client lunch' }),
        makeTask({ id: 'b', title: 'Expense the taxi', tags: ['bills'] }),
      ],
    });

    useTaskStore.getState().applyTitleRuleToExisting(expenseRule);
    expect(useTaskStore.getState().lastAction?.label).toBe('2 tasks filed');

    useTaskStore.getState().undoLastAction();

    const [a, b] = useTaskStore.getState().tasks;
    expect(a).toMatchObject({ category: null, effort: 0, tags: [] });
    expect(b).toMatchObject({ category: null, effort: 0, tags: ['bills'] });
  });

  it('records no action when nothing matches', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', title: 'Water the plants' })], lastAction: null });
    expect(useTaskStore.getState().applyTitleRuleToExisting(expenseRule)).toBe(0);
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

// ─── pullProjectTasks / dripStalledProjects ─────────────────────────────────

describe('pullProjectTasks', () => {
  const monday = new Date(2025, 5, 16, 12, 0, 0).toISOString();

  it('dates each pulled task and undoes the whole batch as one action', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', projectId: 'p1' }),
        makeTask({ id: 'b', projectId: 'p2', deferUntil: monday }),
      ],
    });

    useTaskStore.getState().pullProjectTasks([
      { id: 'a', updates: { dueDate: monday, deferUntil: null } },
      { id: 'b', updates: { dueDate: monday, deferUntil: null } },
    ]);
    expect(useTaskStore.getState().lastAction?.label).toBe('2 tasks pulled in');
    expect(useTaskStore.getState().tasks.map(t => t.dueDate)).toEqual([monday, monday]);

    useTaskStore.getState().undoLastAction();

    const [a, b] = useTaskStore.getState().tasks;
    expect(a.dueDate).toBeNull();
    expect(b.dueDate).toBeNull();
    // Both fields are snapshotted, so an undo restores the defer too.
    expect(b.deferUntil).toBe(monday);
  });

  it('ignores moves for tasks that no longer exist and labels the rest', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });

    useTaskStore.getState().pullProjectTasks([
      { id: 'a', updates: { dueDate: monday, deferUntil: null } },
      { id: 'gone', updates: { dueDate: monday, deferUntil: null } },
    ]);

    expect(useTaskStore.getState().lastAction?.label).toBe('1 task pulled in');
  });

  it('records no action for an empty batch', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' })], lastAction: null });
    useTaskStore.getState().pullProjectTasks([]);
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

describe('dripStalledProjects', () => {
  const quietProject = (overrides = {}) =>
    makeProject({
      id: 'p1',
      autoSchedule: true,
      nudgeCadenceDays: 14,
      createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      ...overrides,
    });

  it('dates the top-ranked task of an opted-in quiet project', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', projectId: 'p1', sortOrder: 0 }),
        makeTask({ id: 'b', projectId: 'p1', sortOrder: 1 }),
      ],
      lastAction: null,
    });

    useTaskStore.getState().dripStalledProjects();

    const [a, b] = useTaskStore.getState().tasks;
    expect(a.dueDate).not.toBeNull();
    expect(b.dueDate).toBeNull();
  });

  // The whole point of deriving "stalled" rather than storing a flag: the
  // second call finds the project already has a dated member.
  it('is a no-op on a second call — only ever one task in flight', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', projectId: 'p1', sortOrder: 0 }),
        makeTask({ id: 'b', projectId: 'p1', sortOrder: 1 }),
      ],
    });

    useTaskStore.getState().dripStalledProjects();
    useTaskStore.getState().dripStalledProjects();

    expect(useTaskStore.getState().tasks.filter(t => t.dueDate !== null)).toHaveLength(1);
  });

  it('skips projects that have not opted in', () => {
    useProjectStore.setState({ projects: [quietProject({ autoSchedule: false })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });

    useTaskStore.getState().dripStalledProjects();

    expect(useTaskStore.getState().tasks[0].dueDate).toBeNull();
  });

  // An unattended background write must not occupy the undo slot for something
  // the user never saw happen.
  it('leaves the undo slot alone', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })], lastAction: null });

    useTaskStore.getState().dripStalledProjects();

    expect(useTaskStore.getState().lastAction).toBeNull();
  });

  it('stamps what it schedules, so the row can say where it came from', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });

    useTaskStore.getState().dripStalledProjects();

    expect(useTaskStore.getState().tasks[0].autoScheduledAt).not.toBeNull();
  });

  // The reported bug, end to end: clear what the drip scheduled and the next
  // foreground used to put the same task straight back.
  it('does not re-date a task the user cleared today', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });

    useTaskStore.getState().dripStalledProjects();
    // Exactly what the date picker's Clear button writes.
    useTaskStore.getState().updateTask('a', { dueDate: null, timeSegments: [] });
    useTaskStore.getState().dripStalledProjects();

    expect(useTaskStore.getState().tasks[0].dueDate).toBeNull();
    // The stamp stays: it is the record of the refusal, and what expires it is
    // the day rolling over, not a reset.
    expect(useTaskStore.getState().tasks[0].autoScheduledAt).not.toBeNull();
  });

  it('drops the stamp when the user dates the task themselves', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });

    useTaskStore.getState().dripStalledProjects();
    useTaskStore.getState().updateTask('a', { dueDate: new Date(2025, 5, 20).toISOString() });

    expect(useTaskStore.getState().tasks[0].autoScheduledAt).toBeNull();
  });

  // A date the user picked off the pull sheet is a date the user picked — it
  // has nothing to explain and nothing to back off from.
  it('leaves an unstamped task unstamped when it is pulled by hand', () => {
    useProjectStore.setState({ projects: [quietProject({ autoSchedule: false })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });

    useTaskStore.getState().pullProjectTasks([
      { id: 'a', updates: { dueDate: new Date().toISOString(), deferUntil: null } },
    ]);

    expect(useTaskStore.getState().tasks[0].autoScheduledAt).toBeNull();
  });

  it('honours dayResetTime during the early-morning grace window', () => {
    const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as {
      useSettingsStore: { getState: jest.Mock };
    };
    const defaultSettings = useSettingsStore.getState();

    jest.useFakeTimers();
    // 1:30 AM on June 11, with a 2:00 AM reset — still "June 10" logically.
    jest.setSystemTime(new Date(2025, 5, 11, 1, 30, 0));
    useSettingsStore.getState.mockReturnValue({
      ...defaultSettings,
      dayResetTime: '02:00',
      vacationMode: false,
    });

    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1', sortOrder: 0 })] });

    useTaskStore.getState().dripStalledProjects();

    const dueDate = useTaskStore.getState().tasks[0].dueDate;
    expect(dueDate).not.toBeNull();
    expect(new Date(dueDate!).getDate()).toBe(10);
    expect(new Date(dueDate!).getMonth()).toBe(5);

    jest.useRealTimers();
    useSettingsStore.getState.mockReturnValue(defaultSettings);
  });
});

// ─── checkProjectReviewTasks ────────────────────────────────────────────────

describe('checkProjectReviewTasks', () => {
  const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as {
    useSettingsStore: { getState: jest.Mock };
  };

  const settings = (overrides: Record<string, unknown> = {}) => ({
    dayResetTime: '00:00',
    vacationMode: false,
    projectReviewTasks: true,
    projectReviewTaskCategory: 'Projects',
    newTaskDefaults: { category: null, priority: null, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false },
    titleRules: [],
    collapsedCategories: [],
    ...overrides,
  });

  // Quiet by construction: opted in, past its cadence, and holding one undated
  // member so there is something to pull.
  const quietProject = (overrides: Partial<Project> = {}) =>
    makeProject({
      id: 'p1',
      title: 'Kitchen renovation',
      nudgeOptIn: true,
      nudgeCadenceDays: 14,
      autoSchedule: false,
      createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      ...overrides,
    });

  const reviewTasks = () =>
    useTaskStore.getState().tasks.filter(t => t.generatedKind === 'projectReview');

  beforeEach(() => {
    useSettingsStore.getState.mockReturnValue(settings());
  });

  it('writes one review task per quiet project, pointed at the pull sheet', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });

    useTaskStore.getState().checkProjectReviewTasks();

    const [review] = reviewTasks();
    expect(review.title).toBe('Review Kitchen renovation');
    expect(review.generatedSourceId).toBe('p1');
    expect(review.linkUrl).toBe('dundundun://projects?pull=p1');
    expect(review.category).toBe('Projects');
    expect(review.dueDate).not.toBeNull();
  });

  // The sharp one. A review task filed *into* the project it describes is a
  // dated member, which makes the project not quiet, which deletes the task,
  // which makes it quiet again — a flip-flop with no bottom.
  it('never files the task into the project it is about', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });

    useTaskStore.getState().checkProjectReviewTasks();
    expect(reviewTasks()[0].projectId).toBeNull();

    // And so the project is still quiet on the next pass, and the task it
    // already has is left exactly where it is.
    useTaskStore.getState().checkProjectReviewTasks();
    expect(reviewTasks()).toHaveLength(1);
  });

  it('caps the set however many projects have gone quiet', () => {
    const projects = Array.from({ length: 6 }, (_, i) =>
      quietProject({ id: `p${i}`, title: `Project ${i}`, sortOrder: i })
    );
    useProjectStore.setState({ projects });
    useTaskStore.setState({
      tasks: projects.map((p, i) => makeTask({ id: `t${i}`, projectId: p.id })),
    });

    useTaskStore.getState().checkProjectReviewTasks();

    expect(reviewTasks()).toHaveLength(MAX_PROJECT_REVIEW_TASKS);
  });

  it('is a no-op while the setting is off', () => {
    useSettingsStore.getState.mockReturnValue(settings({ projectReviewTasks: false }));
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });

    useTaskStore.getState().checkProjectReviewTasks();

    expect(reviewTasks()).toHaveLength(0);
  });

  it('leaves an auto-scheduled project to the drip', () => {
    useProjectStore.setState({ projects: [quietProject({ autoSchedule: true })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });

    useTaskStore.getState().checkProjectReviewTasks();

    expect(reviewTasks()).toHaveLength(0);
  });

  // The drift the sweep exists for: acting on the offer is what makes it stale,
  // and nothing about dating that task knows a row is describing the old state.
  it('clears a task whose project has stopped being quiet', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().checkProjectReviewTasks();
    expect(reviewTasks()).toHaveLength(1);

    // Pull something in, exactly as tapping the row would.
    useTaskStore.getState().updateTask('a', { dueDate: new Date().toISOString() });
    useTaskStore.getState().checkProjectReviewTasks();

    expect(reviewTasks()).toHaveLength(0);
  });

  // The real entry point for "acting on the offer": tapping the review task
  // opens the pull sheet, and pullProjectTasks is what commits it. That
  // action shouldn't need a separate sweep to notice it just answered itself.
  it('is cleared by pullProjectTasks itself, not just a later sweep', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().checkProjectReviewTasks();
    expect(reviewTasks()).toHaveLength(1);

    useTaskStore.getState().pullProjectTasks([
      { id: 'a', updates: { dueDate: new Date().toISOString(), deferUntil: null } },
    ]);

    expect(reviewTasks()).toHaveLength(0);
  });

  // …and clearing it must not read as the user declining. The reconcile's own
  // delete path writes the source's opt-out; this one deliberately doesn't.
  it('does not stamp the project as declined when it clears its own task', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().checkProjectReviewTasks();

    useTaskStore.getState().updateTask('a', { dueDate: new Date().toISOString() });
    useTaskStore.getState().checkProjectReviewTasks();

    expect(useProjectStore.getState().projects[0].reviewDeclinedAt).toBeNull();
  });

  it('takes a deleted task as “not today”, and offers again once the day turns', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().checkProjectReviewTasks();

    useTaskStore.getState().deleteTask(reviewTasks()[0].id);
    expect(useProjectStore.getState().projects[0].reviewDeclinedAt).not.toBeNull();

    useTaskStore.getState().checkProjectReviewTasks();
    expect(reviewTasks()).toHaveLength(0);

    // The stamp is a day, not a verdict — nudgeOptIn is what "never again"
    // would have had to write, and a swipe must not be able to say that.
    expect(useProjectStore.getState().projects[0].nudgeOptIn).toBe(true);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    useProjectStore.getState().updateProject('p1', { reviewDeclinedAt: yesterday });
    useTaskStore.getState().checkProjectReviewTasks();
    expect(reviewTasks()).toHaveLength(1);
  });

  // Ticking it off without pulling anything in is a refusal, and the row going
  // away is what makes it one. Nothing here is live afterwards, so without the
  // day scope the very next foreground would write an identical task.
  it('does not hand back a task the user has just ticked off', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().checkProjectReviewTasks();

    useTaskStore.getState().completeTask(reviewTasks()[0].id);
    useTaskStore.getState().checkProjectReviewTasks();

    expect(reviewTasks().filter(t => !t.completed)).toHaveLength(0);
  });

  it('does not hand back one the user archived either', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().checkProjectReviewTasks();

    useTaskStore.getState().archiveTask(reviewTasks()[0].id);
    useTaskStore.getState().checkProjectReviewTasks();

    expect(reviewTasks().filter(t => !t.archived)).toHaveLength(0);
  });

  // …but only for the day. A project goes quiet again every few months, and
  // blocking on a finished task for ever is the cook task's rule, not this one.
  it('asks again once the day turns', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().checkProjectReviewTasks();

    const reviewId = reviewTasks()[0].id;
    useTaskStore.getState().completeTask(reviewId);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    useTaskStore.getState().updateTask(reviewId, { completedAt: yesterday });

    useTaskStore.getState().checkProjectReviewTasks();

    expect(reviewTasks().filter(t => !t.completed)).toHaveLength(1);
  });

  it('chases a renamed project, and leaves a rescheduled row where the user put it', () => {
    useProjectStore.setState({ projects: [quietProject()] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().checkProjectReviewTasks();

    // Put it off till later in the week, the thing the banner could never do.
    const saturday = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    useTaskStore.getState().updateTask(reviewTasks()[0].id, { dueDate: saturday });
    useProjectStore.getState().updateProject('p1', { title: 'Kitchen reno' });

    useTaskStore.getState().checkProjectReviewTasks();

    const [review] = reviewTasks();
    expect(review.title).toBe('Review Kitchen reno');
    expect(review.dueDate).toBe(saturday);
  });
});

// ─── checkPantryCheckTasks ──────────────────────────────────────────────────

describe('checkPantryCheckTasks', () => {
  const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as {
    useSettingsStore: { getState: jest.Mock };
  };

  const settings = (overrides: Record<string, unknown> = {}) => ({
    dayResetTime: '00:00',
    vacationMode: false,
    kitchenEnabled: true,
    pantryCheckTasks: true,
    pantryCheckTaskCategory: 'Groceries',
    newTaskDefaults: { category: null, priority: null, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false },
    titleRules: [],
    collapsedCategories: [],
    ...overrides,
  });

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  /**
   * A catalog row whose purchase reading has just run out: bought three times
   * over a year (a 122-day cadence) and last bought 125 days ago.
   */
  const lapsedItem = (overrides: Partial<GroceryItem> = {}): GroceryItem => ({
    id: 'g-1', name: 'Flour', nameKey: 'flour', preferredProductId: null, productStrict: false,
    aisle: 'Baking', quantity: null, quantityFromRecipe: false, note: '',
    onList: false, checked: false, inCatalog: true, sortOrder: 1,
    purchaseCount: 3, lastAddedAt: null, lastPurchasedAt: daysAgo(125), createdAt: daysAgo(366),
    onHandUntil: null, sourceRecipeId: null, sourceRecipeTitle: null, choiceGroup: null,
    isStaple: false, expiresAt: null, frozenAt: null, openedAt: null, runningLowAt: null,
    shelfLifeDays: null, useUpTask: null, pantryCheckDeclinedAt: null,
    usedUpCount: 0, spoiledCount: 0, lastSpoiledAt: null,
    lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  });

  const seedItems = (...items: GroceryItem[]) => {
    useGroceryStore.setState({
      items, aisleOrder: [], hiddenAisles: [], aisleOverrides: {},
      shops: [], itemShops: [], lastShopId: null, cartHoldIds: [],
      pendingUseUpItemId: null, initialized: true,
    });
  };

  const checkTasks = () =>
    useTaskStore.getState().tasks.filter(t => t.generatedKind === 'pantryCheck' && !t.completed && !t.archived);

  beforeEach(() => {
    useSettingsStore.getState.mockReturnValue(settings());
    useTaskStore.setState({ tasks: [] });
  });

  it('writes a check for an item the pantry has stopped vouching for', () => {
    seedItems(lapsedItem());

    useTaskStore.getState().checkPantryCheckTasks();

    const [check] = checkTasks();
    expect(check.title).toBe('Check if you still have Flour');
    expect(check.generatedSourceId).toBe('g-1');
    // The item's own sheet, which is where the two answers live.
    expect(check.linkUrl).toBe('dundundun://kitchen?item=grocery-g-1');
    expect(check.category).toBe('Groceries');
    expect(check.dueDate).not.toBeNull();
  });

  it('writes nothing while the item is still inside its window', () => {
    seedItems(lapsedItem({ lastPurchasedAt: daysAgo(30) }));

    useTaskStore.getState().checkPantryCheckTasks();

    expect(checkTasks()).toHaveLength(0);
  });

  it('is a no-op while the setting is off', () => {
    useSettingsStore.getState.mockReturnValue(settings({ pantryCheckTasks: false }));
    seedItems(lapsedItem());

    useTaskStore.getState().checkPantryCheckTasks();

    expect(checkTasks()).toHaveLength(0);
  });

  // The gate the other grocery generators don't need: they fire on a purchase
  // or an edit, which can't happen while the area is hidden, and this one fires
  // on time passing.
  it('is a no-op while the whole grocery area is switched off', () => {
    useSettingsStore.getState.mockReturnValue(settings({ kitchenEnabled: false }));
    seedItems(lapsedItem());

    useTaskStore.getState().checkPantryCheckTasks();

    expect(checkTasks()).toHaveLength(0);
  });

  it('does not pile up a second task on the next sweep', () => {
    seedItems(lapsedItem());

    useTaskStore.getState().checkPantryCheckTasks();
    useTaskStore.getState().checkPantryCheckTasks();

    expect(checkTasks()).toHaveLength(1);
  });

  it('caps how many it asks at once', () => {
    seedItems(...['Flour', 'Rice', 'Oats', 'Barley', 'Lentils'].map((name, i) =>
      lapsedItem({ id: `g-${i}`, name, nameKey: name.toLowerCase(), lastPurchasedAt: daysAgo(125 + i) })
    ));

    useTaskStore.getState().checkPantryCheckTasks();

    expect(checkTasks()).toHaveLength(MAX_PANTRY_CHECK_TASKS);
  });

  // The drift the sweep exists for. Answering happens on the item sheet, and
  // nothing about writing onHandUntil knows a task is sitting on Today asking
  // the question it just answered.
  it('clears a task once the user says they still have it', () => {
    seedItems(lapsedItem());
    useTaskStore.getState().checkPantryCheckTasks();
    expect(checkTasks()).toHaveLength(1);

    useGroceryStore.setState({
      items: [lapsedItem({ onHandUntil: new Date(Date.now() + 30 * 86_400_000).toISOString() })],
    });
    useTaskStore.getState().checkPantryCheckTasks();

    expect(checkTasks()).toHaveLength(0);
  });

  it('clears a task once the user says they are out of it', () => {
    seedItems(lapsedItem());
    useTaskStore.getState().checkPantryCheckTasks();

    useGroceryStore.setState({ items: [lapsedItem({ onHandUntil: OUT_OF_IT_UNTIL })] });
    useTaskStore.getState().checkPantryCheckTasks();

    expect(checkTasks()).toHaveLength(0);
  });

  // …and clearing it must not read as the user declining, or the question would
  // be suppressed after the *next* purchase on the strength of the app's own
  // tidying up.
  it('does not stamp the item as declined when it clears its own task', () => {
    seedItems(lapsedItem());
    useTaskStore.getState().checkPantryCheckTasks();

    useGroceryStore.setState({ items: [lapsedItem({ onHandUntil: OUT_OF_IT_UNTIL })] });
    useTaskStore.getState().checkPantryCheckTasks();

    expect(useGroceryStore.getState().items[0].pantryCheckDeclinedAt).toBeNull();
  });

  it('takes a deleted task as a refusal, and does not hand it back', () => {
    seedItems(lapsedItem());
    useTaskStore.getState().checkPantryCheckTasks();

    useTaskStore.getState().deleteTask(checkTasks()[0].id);
    expect(useGroceryStore.getState().items[0].pantryCheckDeclinedAt).not.toBeNull();

    useTaskStore.getState().checkPantryCheckTasks();
    expect(checkTasks()).toHaveLength(0);
  });

  // A stamp, not a verdict: unlike useUpTask's `false`, it is spent the moment
  // there is a new purchase to lapse. A refusal from before the last trip is a
  // refusal about the bag that trip replaced.
  it('asks again once the item has been bought since the refusal', () => {
    seedItems(lapsedItem({
      purchaseCount: 4,
      pantryCheckDeclinedAt: daysAgo(200),
      lastPurchasedAt: daysAgo(95), // past a 366/4 = 91.5-day window
    }));

    useTaskStore.getState().checkPantryCheckTasks();

    expect(checkTasks()).toHaveLength(1);
  });

  it('undo clears the refusal again, and leaves the restored task alone', () => {
    seedItems(lapsedItem());
    useTaskStore.getState().checkPantryCheckTasks();
    const taskId = checkTasks()[0].id;

    useTaskStore.getState().deleteTask(taskId);
    useTaskStore.getState().lastAction!.undo();

    expect(useGroceryStore.getState().items[0].pantryCheckDeclinedAt).toBeNull();
    expect(useTaskStore.getState().tasks.find(t => t.id === taskId)).toBeDefined();
  });

  // Ticking it off is an answer for this bag, and the row going away is what
  // makes it one — nothing is live afterwards, so without it the very next
  // foreground would write an identical task.
  it('does not hand back a task the user has just ticked off', () => {
    seedItems(lapsedItem());
    useTaskStore.getState().checkPantryCheckTasks();

    useTaskStore.getState().completeTask(checkTasks()[0].id);
    useTaskStore.getState().checkPantryCheckTasks();

    expect(checkTasks()).toHaveLength(0);
  });

  it('does not hand back one the user archived either', () => {
    seedItems(lapsedItem());
    useTaskStore.getState().checkPantryCheckTasks();

    useTaskStore.getState().archiveTask(checkTasks()[0].id);
    useTaskStore.getState().checkPantryCheckTasks();

    expect(checkTasks()).toHaveLength(0);
  });

  it('chases a renamed item, and leaves a rescheduled row where the user put it', () => {
    seedItems(lapsedItem());
    useTaskStore.getState().checkPantryCheckTasks();

    const saturday = new Date(Date.now() + 3 * 86_400_000).toISOString();
    useTaskStore.getState().updateTask(checkTasks()[0].id, { dueDate: saturday });
    useGroceryStore.setState({ items: [lapsedItem({ name: 'Plain flour', nameKey: 'plain flour' })] });

    useTaskStore.getState().checkPantryCheckTasks();

    const [check] = checkTasks();
    expect(check.title).toBe('Check if you still have Plain flour');
    expect(check.dueDate).toBe(saturday);
  });
});

// ─── checkMealPlanNudge ─────────────────────────────────────────────────────

describe('checkMealPlanNudge', () => {
  const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as {
    useSettingsStore: { getState: jest.Mock };
  };

  // Sun Aug 3 2025 – Sat Aug 9 2025 is a real calendar week (see
  // mealPlanNudge.test.ts), so weekday 0 / time 09:00 fires right at the top
  // of it and asks about that same week, Sun Aug 3 – Sat Aug 9.
  const settings = (overrides: Record<string, unknown> = {}) => ({
    dayResetTime: '00:00',
    weekStartsOn: 0,
    vacationMode: false,
    kitchenEnabled: true,
    mealPlanNudgeEnabled: true,
    mealPlanNudgeWeekday: 0,
    mealPlanNudgeTime: '09:00',
    mealPlanNudgeLastFiredWeekKey: null as string | null,
    setMealPlanNudgeLastFiredWeekKey: jest.fn(),
    mealPlanNudgeTaskCategory: null as string | null,
    mealPlanNudgeGroupId: null as string | null,
    setMealPlanNudgeGroupId: jest.fn(),
    // addTask -> newTaskFromDraft reads this unconditionally.
    newTaskDefaults: { category: null, priority: null, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false },
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Its rows are titled "Monday 08/04" — words the app chose, on a task with
  // its own "File them under" setting, same as the other three generators. A
  // rule written about a weekday must not reach them.
  it('files its rows by its own setting rather than by a title rule', () => {
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    useSettingsStore.getState.mockReturnValue(settings({
      titleRules: [{
        id: 'r1', keywords: ['monday'], match: 'startsWith',
        category: 'Work', projectId: null, tags: ['admin'],
        priority: 0, effort: 0, stripKeyword: false, enabled: true,
      }],
    }));
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    const rows = useTaskStore.getState().tasks;
    expect(rows.some(t => t.title.startsWith('Monday'))).toBe(true);
    expect(rows.every(t => t.category === null && t.tags.length === 0)).toBe(true);
  });

  it('is a no-op while the setting is off', () => {
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    useSettingsStore.getState.mockReturnValue(settings({ mealPlanNudgeEnabled: false }));
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  // The loudest thing the groceries/meals area does unattended: it creates a
  // task, carrying a link to a screen the menu no longer lists.
  it('is a no-op with the groceries area off, and does not record the week as fired', () => {
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    const s = settings({ kitchenEnabled: false });
    useSettingsStore.getState.mockReturnValue(s);
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().tasks).toHaveLength(0);
    // Not recorded, so the nudge fires properly for this week if the area
    // comes back before the week is out — same restraint as vacation below.
    expect(s.setMealPlanNudgeLastFiredWeekKey).not.toHaveBeenCalled();
  });

  it('is a no-op during vacation mode, and does not record the week as fired', () => {
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    const s = settings({ vacationMode: true });
    useSettingsStore.getState.mockReturnValue(s);
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().tasks).toHaveLength(0);
    expect(s.setMealPlanNudgeLastFiredWeekKey).not.toHaveBeenCalled();
  });

  it('does nothing before the configured day/time arrives', () => {
    jest.setSystemTime(new Date(2025, 7, 3, 8, 59, 0));
    useSettingsStore.getState.mockReturnValue(settings());
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  it('creates a stack of seven day tasks once the trigger arrives', () => {
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    const s = settings();
    useSettingsStore.getState.mockReturnValue(s);
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(7);
    expect(tasks.map(t => t.title)).toEqual([
      'Sunday 08/03',
      'Monday 08/04',
      'Tuesday 08/05',
      'Wednesday 08/06',
      'Thursday 08/07',
      'Friday 08/08',
      'Saturday 08/09',
    ]);
    expect(dbGetMealPlanEntries).toHaveBeenCalledWith('2025-08-03', '2025-08-09');
    expect(s.setMealPlanNudgeLastFiredWeekKey).toHaveBeenCalledWith('2025-08-03');
  });

  it('stamps each day task with its own day key and a link that opens on it', () => {
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    useSettingsStore.getState.mockReturnValue(settings());
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    const tasks = useTaskStore.getState().tasks;
    expect(tasks.map(t => t.generatedSourceId)).toEqual([
      '2025-08-03', '2025-08-04', '2025-08-05', '2025-08-06',
      '2025-08-07', '2025-08-08', '2025-08-09',
    ]);
    expect(tasks.every(t => t.generatedKind === 'mealPlanNudge')).toBe(true);
    expect(tasks[3].linkUrl).toBe('dundundun://mealplan?date=2025-08-06');
  });

  it('gives every day the firing day\'s due date, not its own', () => {
    // Planning is work for today — a task due on Thursday would be
    // hidden until the week it was meant to prepare for had started.
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    useSettingsStore.getState.mockReturnValue(settings());
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    const due = useTaskStore.getState().tasks.map(t => t.dueDate);
    expect(new Set(due).size).toBe(1);
    const only = new Date(due[0]!);
    expect(only.getDate()).toBe(3);
    expect(only.getHours()).toBe(12);
  });

  it('derives each day task\'s id from its day key, so two devices agree without syncing (#1751)', () => {
    // The bug: two devices whose clocks each cross the trigger before either
    // has synced with the other independently fire the nudge and each mint
    // their own random ids for what is meant to be one weekly stack — the
    // ordinary sync merge then keeps both sets, and whichever tasks were
    // already completed on one device come back as duplicates from the other.
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    useSettingsStore.getState.mockReturnValue(settings());
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    const firstRunIds = useTaskStore.getState().tasks.map(t => t.id);
    expect(firstRunIds).toEqual([
      '2025-08-03', '2025-08-04', '2025-08-05', '2025-08-06',
      '2025-08-07', '2025-08-08', '2025-08-09',
    ].map(dayKey => derivedId(spawnSeed.generated('mealPlanNudge', dayKey, 0))));

    // A second "device" that has never seen the first device's tasks —
    // simulated by resetting the store back to empty before firing again for
    // the same week — computes the exact same ids.
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(firstRunIds);
  });

  it('files the seven under one stack, expanded, and remembers which', () => {
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    const s = settings();
    useSettingsStore.getState.mockReturnValue(s);
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    const groups = useTaskGroupStore.getState().groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Plan this week's meals");
    // A stack that appears unattended showing "0 of 7 done today" and no rows
    // hides the whole week behind a chevron nobody was told to tap.
    expect(groups[0].collapsed).toBe(false);
    const tasks = useTaskStore.getState().tasks;
    expect(tasks.every(t => t.groupId === groups[0].id)).toBe(true);
    // Ordered down the week within the stack.
    expect(tasks.map(t => t.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.setMealPlanNudgeGroupId).toHaveBeenCalledWith(groups[0].id);
  });

  it('reuses and retitles the same stack the following week', () => {
    // A stack is a label. A fresh one every Sunday leaves a year of empty
    // stacks behind it, each a row in the Stacks screen that nothing prunes.
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    useSettingsStore.getState.mockReturnValue(settings());
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().checkMealPlanNudge();

    const groupId = useTaskGroupStore.getState().groups[0].id;
    // Next week's firing, with last week's set finished off.
    jest.setSystemTime(new Date(2025, 7, 10, 9, 0, 0));
    useSettingsStore.getState.mockReturnValue(
      settings({ mealPlanNudgeLastFiredWeekKey: '2025-08-03', mealPlanNudgeGroupId: groupId })
    );
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskGroupStore.getState().groups).toHaveLength(1);
    expect(useTaskGroupStore.getState().groups[0].id).toBe(groupId);
    expect(useTaskGroupStore.getState().groups[0].title).toBe("Plan this week's meals");
  });

  it('makes a new stack when the remembered one has been deleted', () => {
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    const s = settings({ mealPlanNudgeGroupId: 'gone' });
    useSettingsStore.getState.mockReturnValue(s);
    useTaskStore.setState({ tasks: [] });
    useTaskGroupStore.setState({ groups: [] });

    useTaskStore.getState().checkMealPlanNudge();

    const groups = useTaskGroupStore.getState().groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].id).not.toBe('gone');
    expect(useTaskStore.getState().tasks.every(t => t.groupId === groups[0].id)).toBe(true);
  });

  it('does not create a second task on a later call the same week', () => {
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    useSettingsStore.getState.mockReturnValue(
      settings({ mealPlanNudgeLastFiredWeekKey: '2025-08-03' })
    );
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  it('fires again once the next week starts', () => {
    jest.setSystemTime(new Date(2025, 7, 10, 9, 0, 0));
    const s = settings({ mealPlanNudgeLastFiredWeekKey: '2025-08-03' });
    useSettingsStore.getState.mockReturnValue(s);
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().tasks).toHaveLength(7);
    expect(s.setMealPlanNudgeLastFiredWeekKey).toHaveBeenCalledWith('2025-08-10');
  });

  it("is suppressed — no new tasks, but the week still counts as handled — when this week's set is already there", () => {
    jest.setSystemTime(new Date(2025, 7, 10, 9, 0, 0));
    const s = settings({ mealPlanNudgeLastFiredWeekKey: '2025-08-03' });
    useSettingsStore.getState.mockReturnValue(s);
    useTaskStore.setState({
      // One day of the week being asked about, still live: the set is already
      // laid down, so a second one must not be.
      tasks: [makeTask({
        id: 'nudge-1',
        title: 'Wednesday 13 Aug',
        linkUrl: 'dundundun://mealplan?date=2025-08-13',
        generatedKind: 'mealPlanNudge',
        generatedSourceId: '2025-08-13',
      })],
    });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().tasks).toHaveLength(1); // unchanged
    expect(s.setMealPlanNudgeLastFiredWeekKey).toHaveBeenCalledWith('2025-08-10');
  });

  it("clears last week's leftovers and lays down the new set", () => {
    // One task for the week used to mean "left it untouched? then no new one".
    // Seven mean that one ignored Saturday would block every future nudge — and
    // a task asking about a day that has already happened can't be done anyway.
    jest.setSystemTime(new Date(2025, 7, 10, 9, 0, 0));
    useSettingsStore.getState.mockReturnValue(
      settings({ mealPlanNudgeLastFiredWeekKey: '2025-08-03' })
    );
    useTaskStore.setState({
      tasks: [
        makeTask({
          id: 'stale-1',
          title: 'Saturday 9 Aug',
          generatedKind: 'mealPlanNudge',
          generatedSourceId: '2025-08-09',
        }),
        makeTask({ id: 'mine', title: 'Something I wrote' }),
      ],
    });

    useTaskStore.getState().checkMealPlanNudge();

    const tasks = useTaskStore.getState().tasks;
    expect(tasks.find(t => t.id === 'stale-1')).toBeUndefined();
    // The user's own task is untouched, and the new week is there in full.
    expect(tasks.find(t => t.id === 'mine')).toBeDefined();
    expect(tasks.filter(t => t.generatedKind === 'mealPlanNudge')).toHaveLength(7);
  });

  it("does not arm shake-to-undo when clearing last week's leftovers", () => {
    jest.setSystemTime(new Date(2025, 7, 10, 9, 0, 0));
    useSettingsStore.getState.mockReturnValue(
      settings({ mealPlanNudgeLastFiredWeekKey: '2025-08-03' })
    );
    useTaskStore.setState({
      tasks: [makeTask({
        id: 'stale-1',
        generatedKind: 'mealPlanNudge',
        generatedSourceId: '2025-08-09',
      })],
      lastAction: null,
    });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().lastAction).toBeNull();
  });

  it("leaves last week's completed and archived tasks alone as the record of them", () => {
    jest.setSystemTime(new Date(2025, 7, 10, 9, 0, 0));
    useSettingsStore.getState.mockReturnValue(
      settings({ mealPlanNudgeLastFiredWeekKey: '2025-08-03' })
    );
    useTaskStore.setState({
      tasks: [
        makeTask({
          id: 'done-1',
          generatedKind: 'mealPlanNudge',
          generatedSourceId: '2025-08-16',
          completed: true,
          completedAt: '2025-08-16T00:00:00.000Z',
        }),
        makeTask({
          id: 'archived-1',
          generatedKind: 'mealPlanNudge',
          generatedSourceId: '2025-08-15',
          archived: true,
        }),
      ],
    });

    useTaskStore.getState().checkMealPlanNudge();

    const tasks = useTaskStore.getState().tasks;
    expect(tasks.find(t => t.id === 'done-1')).toBeDefined();
    expect(tasks.find(t => t.id === 'archived-1')).toBeDefined();
    expect(tasks.filter(t => t.generatedKind === 'mealPlanNudge' && !t.completed && !t.archived))
      .toHaveLength(7);
  });

  it('fires again once last week\'s nudge task has been completed', () => {
    jest.setSystemTime(new Date(2025, 7, 10, 9, 0, 0));
    const s = settings({ mealPlanNudgeLastFiredWeekKey: '2025-08-03' });
    useSettingsStore.getState.mockReturnValue(s);
    useTaskStore.setState({
      tasks: [makeTask({ id: 'nudge-1', linkUrl: 'dundundun://mealplan', completed: true, completedAt: '2025-08-04T00:00:00.000Z' })],
    });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().tasks).toHaveLength(8);
  });

  it('fires again once last week\'s nudge task has been archived', () => {
    jest.setSystemTime(new Date(2025, 7, 10, 9, 0, 0));
    const s = settings({ mealPlanNudgeLastFiredWeekKey: '2025-08-03' });
    useSettingsStore.getState.mockReturnValue(s);
    useTaskStore.setState({
      tasks: [makeTask({ id: 'nudge-1', linkUrl: 'dundundun://mealplan', archived: true })],
    });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().tasks).toHaveLength(8);
  });

  it('is not blocked by an unrelated live task that happens to link elsewhere', () => {
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    const s = settings();
    useSettingsStore.getState.mockReturnValue(s);
    useTaskStore.setState({ tasks: [makeTask({ id: 'other', linkUrl: null })] });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().tasks).toHaveLength(8);
  });

  it('is suppressed — no task, but the week still counts as handled — when this week is already planned', () => {
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    const s = settings();
    useSettingsStore.getState.mockReturnValue(s);
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      { id: 'm1', date: '2025-08-05', slot: 'dinner', recipeId: null, title: 'Tacos', sortOrder: 1, createdAt: '2025-08-01T00:00:00.000Z', cookedAt: null, leftoverId: null, recipeChoices: [] },
    ]);
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().tasks).toHaveLength(0);
    expect(s.setMealPlanNudgeLastFiredWeekKey).toHaveBeenCalledWith('2025-08-03');
  });

  it('leaves the undo slot alone, like the other unattended background writes', () => {
    jest.setSystemTime(new Date(2025, 7, 3, 9, 0, 0));
    useSettingsStore.getState.mockReturnValue(settings());
    useTaskStore.setState({ tasks: [], lastAction: null });

    useTaskStore.getState().checkMealPlanNudge();

    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

// ─── checkMealSlotTasks ─────────────────────────────────────────────────────

describe('checkMealSlotTasks', () => {
  const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as {
    useSettingsStore: { getState: jest.Mock };
  };

  // Stands in for the real setting, so a test can run the pass twice and see
  // the second run act on what the first one wrote.
  let writtenThrough: string | null = null;
  const setWrittenThrough = jest.fn((key: string | null) => { writtenThrough = key; });

  const settings = (overrides: Record<string, unknown> = {}) => ({
    dayResetTime: '00:00',
    vacationMode: false,
    kitchenEnabled: true,
    mealCookTasks: true,
    mealCookTaskCategory: 'Meal Plan',
    mealSlotsEnabled: ['breakfast', 'lunch', 'dinner'] as MealSlot[],
    get mealSlotTasksWrittenThroughDayKey() { return writtenThrough; },
    setMealSlotTasksWrittenThroughDayKey: setWrittenThrough,
    newTaskDefaults: { category: null, priority: null, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false },
    ...overrides,
  });

  function mealEntry(date: string, slot: MealSlot, over: Partial<MealPlanEntry> = {}): MealPlanEntry {
    return {
      id: `m-${date}-${slot}`, date, slot, recipeId: null, title: 'Chili', sortOrder: 1,
      createdAt: '2026-01-01T00:00:00.000Z', cookedAt: null, leftoverId: null,
      recipeChoices: [], recipeScale: 1, cookTask: null, calendarEventId: null,
      ...over,
    };
  }

  const slotRows = () =>
    useTaskStore.getState().tasks.filter(t => t.generatedKind === 'mealSlot');
  const sourceIds = () => slotRows().map(t => t.generatedSourceId);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 22, 9, 0, 0));
    writtenThrough = null;
    setWrittenThrough.mockClear();
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([]);
  });

  afterEach(() => { jest.useRealTimers(); });

  it('writes a week of rows per meal, each a chain that starts by choosing', () => {
    // A meal you *have* planned has something to say ahead of time, and a slot
    // you haven't is honestly undecided — both belong on Later, dated forward
    // and hidden by isTaskVisible until their day.
    useSettingsStore.getState.mockReturnValue(settings({ mealSlotsEnabled: ['lunch'] }));
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealSlotTasks();

    expect(sourceIds()).toEqual([
      '2026-08-22#lunch', '2026-08-23#lunch', '2026-08-24#lunch', '2026-08-25#lunch',
      '2026-08-26#lunch', '2026-08-27#lunch', '2026-08-28#lunch',
    ]);
    const today = slotRows()[0];
    expect(today.title).toBe('Lunch');
    expect(today.chainItems.map(c => c.title))
      .toEqual(['Choose lunch', 'Prepare lunch', 'Eat lunch']);
    // Not hidden — Choose is step 0 of 3, nowhere near the meal itself, so
    // it's visible from the start of the day. Only the step that finishes
    // the chain (Eat lunch) hides until the meal is roughly due.
    expect(today.timeSegments).toEqual([]);
    expect(today.category).toBe('Meal Plan');
    // Each row lands on its own day, so the week reads as a week.
    expect(slotRows()[3].dueDate!.startsWith('2026-08-25')).toBe(true);
    expect(setWrittenThrough).toHaveBeenCalledWith('2026-08-28');
  });

  it('lays a day down breakfast first, whatever order the meals were named in', () => {
    useSettingsStore.getState.mockReturnValue(settings({ mealSlotsEnabled: ['dinner', 'breakfast'] }));
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().checkMealSlotTasks();
    expect(sourceIds().slice(0, 2)).toEqual(['2026-08-22#dinner', '2026-08-22#breakfast']);
  });

  it('skips the choosing for a slot that is already answered', () => {
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      mealEntry('2026-08-25', 'dinner', { recipeId: 'r1', title: 'Chili' }),
    ]);
    useSettingsStore.getState.mockReturnValue(settings({ mealSlotsEnabled: ['dinner'] }));
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealSlotTasks();

    const friday = slotRows().find(t => t.generatedSourceId === '2026-08-25#dinner')!;
    expect(friday.chainItems.map(c => c.title)).toEqual(['Cook Chili', 'Eat Chili']);
    expect(friday.title).toBe('Chili');
    // And the nights around it are still the choosing question.
    expect(slotRows().find(t => t.generatedSourceId === '2026-08-24#dinner')!.title).toBe('Dinner');
  });

  it('writes nothing for a meal that has said no', () => {
    // MealPlanEntry.cookTask is still the per-meal refusal, and it's the one
    // thing a meal task inherits from the cook task it replaces.
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      mealEntry('2026-08-22', 'dinner', { recipeId: 'r1', cookTask: false }),
    ]);
    useSettingsStore.getState.mockReturnValue(settings({ mealSlotsEnabled: ['dinner'] }));
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealSlotTasks();
    expect(sourceIds()).not.toContain('2026-08-22#dinner');
    expect(slotRows()).toHaveLength(6);
  });

  it('leaves a meal already cooked alone', () => {
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      mealEntry('2026-08-22', 'dinner', { recipeId: 'r1', cookedAt: '2026-08-22T02:00:00.000Z' }),
    ]);
    useSettingsStore.getState.mockReturnValue(settings({ mealSlotsEnabled: ['dinner'] }));
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealSlotTasks();
    expect(sourceIds()).not.toContain('2026-08-22#dinner');
  });

  it('advances a day at a time once the window has been written', () => {
    useSettingsStore.getState.mockReturnValue(settings({ mealSlotsEnabled: ['lunch'] }));
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().checkMealSlotTasks();
    expect(slotRows()).toHaveLength(7);

    // Same day again: the mark already covers the window, so there is nothing
    // to do and the pass is free to run on every foreground.
    useTaskStore.getState().checkMealSlotTasks();
    expect(slotRows()).toHaveLength(7);

    // Tomorrow: one new day comes into range, and only that one is written.
    jest.setSystemTime(new Date(2026, 7, 23, 9, 0, 0));
    useTaskStore.getState().checkMealSlotTasks();
    expect(slotRows()).toHaveLength(8);
    expect(sourceIds()).toContain('2026-08-29#lunch');
  });

  it('never revisits a day it has written, so a deleted row stays deleted', () => {
    // The mark is this generator's entire opt-out: it has no source row to
    // stamp a "no" on, and a growing (kind, sourceId) suppression record is the
    // shape generatedTasks.ts forbids because nothing prunes it.
    useSettingsStore.getState.mockReturnValue(settings({ mealSlotsEnabled: ['lunch'] }));
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().checkMealSlotTasks();
    const thursday = slotRows().find(t => t.generatedSourceId === '2026-08-27#lunch')!;
    useTaskStore.getState().deleteTask(thursday.id);

    // Every subsequent run, today's and the next few days', leaves it gone.
    useTaskStore.getState().checkMealSlotTasks();
    jest.setSystemTime(new Date(2026, 7, 24, 9, 0, 0));
    useTaskStore.getState().checkMealSlotTasks();

    expect(sourceIds()).not.toContain('2026-08-27#lunch');
  });

  it('picks up from today after a long gap rather than filling in the past', () => {
    // A meal task is no use on a day that has already gone.
    writtenThrough = '2026-08-10';
    useSettingsStore.getState.mockReturnValue(settings({ mealSlotsEnabled: ['lunch'] }));
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().checkMealSlotTasks();

    expect(sourceIds()[0]).toBe('2026-08-22#lunch');
    expect(slotRows()).toHaveLength(7);
  });

  it('keeps its identity across a step, and writes no second row for the slot', () => {
    // Completing a step spawns the next, and `completeTask` used to clear
    // generatedKind on every spawn — which would leave "Prepare lunch"
    // unrecognisable, so this pass would see nothing for the slot and write a
    // duplicate underneath it. A mid-chain step is the same run continuing,
    // not a second claimant.
    useSettingsStore.getState.mockReturnValue(settings({ mealSlotsEnabled: ['lunch'] }));
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().checkMealSlotTasks();
    const today = slotRows().find(t => t.generatedSourceId === '2026-08-22#lunch')!;
    useTaskStore.getState().completeTask(today.id);

    const spawned = useTaskStore.getState().tasks.find(
      t => !t.completed && t.generatedSourceId === '2026-08-22#lunch'
    )!;
    expect(spawned.generatedKind).toBe('mealSlot');
    expect(spawned.chainIndex).toBe(1);
    // "Prepare lunch" is step 1 of 3 — still not the meal itself, so still
    // not hidden behind the afternoon segment.
    expect(spawned.timeSegments).toEqual([]);

    // One ticked step plus the one it spawned, never a third.
    jest.setSystemTime(new Date(2026, 7, 23, 9, 0, 0));
    useTaskStore.getState().checkMealSlotTasks();
    expect(slotRows().filter(t => t.generatedSourceId === '2026-08-22#lunch')).toHaveLength(2);
  });

  it('picks up the time gate on the step that finally finishes the chain', () => {
    useSettingsStore.getState.mockReturnValue(settings({ mealSlotsEnabled: ['lunch'] }));
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().checkMealSlotTasks();
    const choose = slotRows().find(t => t.generatedSourceId === '2026-08-22#lunch')!;
    expect(choose.timeSegments).toEqual([]);

    useTaskStore.getState().completeTask(choose.id);
    const prepare = useTaskStore.getState().tasks.find(
      t => !t.completed && t.generatedSourceId === '2026-08-22#lunch'
    )!;
    expect(prepare.chainIndex).toBe(1);
    expect(prepare.timeSegments).toEqual([]);

    useTaskStore.getState().completeTask(prepare.id);
    const eat = useTaskStore.getState().tasks.find(
      t => !t.completed && t.generatedSourceId === '2026-08-22#lunch'
    )!;
    expect(eat.chainIndex).toBe(2);
    // "Eat lunch" finishes the chain — it's the meal itself, so it hides
    // behind the afternoon segment same as any recurring task's own due time.
    expect(eat.timeSegments).toEqual(['afternoon']);
  });

  it('lets go of the source at the wrap of a repeating chain', () => {
    // The clear is right there and only there: a new cycle is a second run, and
    // a fresh occupant of a source the last one already answered is exactly
    // what the rule in completeTask exists to prevent.
    useSettingsStore.getState.mockReturnValue(settings());
    useTaskStore.setState({ tasks: [] });
    const looping = useTaskStore.getState().addTask({
      title: 'Lunch',
      recurrenceType: 'daily',
      chainEnabled: true,
      chainItems: [{ id: 'a', title: 'A', estimatedMinutes: null }],
      generatedKind: 'mealSlot',
      generatedSourceId: '2026-08-22#lunch',
    });

    useTaskStore.getState().completeTask(looping.id);

    const next = useTaskStore.getState().tasks.find(t => !t.completed && t.title === 'Lunch')!;
    expect(next.generatedKind).toBeNull();
    expect(next.generatedSourceId).toBeNull();
  });

  it('stands aside for a legacy cook task still covering the slot', () => {
    // Only matters for the launch or two after the fold, while rows written as
    // `mealCook` drain — but without it the first pass writes a second row
    // under a "Cook X" the user is already looking at.
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([
      mealEntry('2026-08-22', 'dinner', { id: 'm-legacy', recipeId: 'r1' }),
    ]);
    useSettingsStore.getState.mockReturnValue(settings({ mealSlotsEnabled: ['dinner'] }));
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().addTask({
      title: 'Cook Chili', generatedKind: 'mealCook', generatedSourceId: 'm-legacy',
    });

    useTaskStore.getState().checkMealSlotTasks();

    expect(sourceIds()).not.toContain('2026-08-22#dinner');
  });

  it('writes nothing while the generator is off, or no meals are named', () => {
    useSettingsStore.getState.mockReturnValue(settings({ mealCookTasks: false }));
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().checkMealSlotTasks();
    expect(slotRows()).toHaveLength(0);

    useSettingsStore.getState.mockReturnValue(settings({ mealSlotsEnabled: [] }));
    useTaskStore.getState().checkMealSlotTasks();
    expect(slotRows()).toHaveLength(0);
    // And neither counts as having written anything, so naming a meal later
    // still gets the whole window rather than starting from a stale mark.
    expect(setWrittenThrough).not.toHaveBeenCalled();
  });

  it('derives each row\'s id from its day and slot, so two devices agree without syncing', () => {
    useSettingsStore.getState.mockReturnValue(settings({ mealSlotsEnabled: ['lunch'] }));
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().checkMealSlotTasks();
    const first = slotRows().map(t => t.id);

    writtenThrough = null;
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().checkMealSlotTasks();
    expect(slotRows().map(t => t.id)).toEqual(first);
  });
});

describe('backfillMealSlotTasks', () => {
  const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as {
    useSettingsStore: { getState: jest.Mock };
  };

  let writtenThrough: string | null = null;
  const settings = (overrides: Record<string, unknown> = {}) => ({
    dayResetTime: '00:00',
    mealCookTasks: true,
    mealCookTaskCategory: 'Meal Plan',
    mealSlotsEnabled: ['lunch'] as MealSlot[],
    get mealSlotTasksWrittenThroughDayKey() { return writtenThrough; },
    setMealSlotTasksWrittenThroughDayKey: jest.fn((k: string | null) => { writtenThrough = k; }),
    newTaskDefaults: { category: null, priority: null, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false },
    ...overrides,
  });

  const sourceIds = () => useTaskStore.getState().tasks
    .filter(t => t.generatedKind === 'mealSlot')
    .map(t => t.generatedSourceId);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 22, 9, 0, 0));
    writtenThrough = null;
    (dbGetMealPlanEntries as jest.Mock).mockReturnValue([]);
  });

  afterEach(() => { jest.useRealTimers(); });

  it('fills the written days with a meal just switched on', () => {
    // Without it a newly-named meal produces nothing until the horizon rolls
    // past the mark, which with a week's window is a week of silence after
    // answering a question in Settings.
    useSettingsStore.getState.mockReturnValue(settings());
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().checkMealSlotTasks();

    useTaskStore.getState().backfillMealSlotTasks(['breakfast']);

    expect(sourceIds().filter(id => id!.endsWith('#breakfast'))).toHaveLength(7);
    expect(sourceIds()).toContain('2026-08-22#breakfast');
    expect(sourceIds()).toContain('2026-08-28#breakfast');
  });

  it('does not resurrect a row deleted in another slot', () => {
    // The reason the mark is never rewound: rewinding would rewrite the whole
    // window, and turning breakfast on would bring Thursday's deleted lunch
    // back with it.
    useSettingsStore.getState.mockReturnValue(settings());
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().checkMealSlotTasks();
    const thursday = useTaskStore.getState().tasks.find(
      t => t.generatedSourceId === '2026-08-27#lunch'
    )!;
    useTaskStore.getState().deleteTask(thursday.id);

    useTaskStore.getState().backfillMealSlotTasks(['breakfast']);

    expect(sourceIds()).not.toContain('2026-08-27#lunch');
    expect(sourceIds()).toContain('2026-08-27#breakfast');
  });

  it('stands aside when the ordinary pass has the window to do anyway', () => {
    // Nothing written yet, or a mark left behind by a long gap: the daily pass
    // covers the whole window on its next run, so doing it here would be a
    // second writer racing the first.
    useSettingsStore.getState.mockReturnValue(settings());
    useTaskStore.setState({ tasks: [] });

    useTaskStore.getState().backfillMealSlotTasks(['breakfast']);
    expect(sourceIds()).toHaveLength(0);

    writtenThrough = '2026-08-10';
    useTaskStore.getState().backfillMealSlotTasks(['breakfast']);
    expect(sourceIds()).toHaveLength(0);
  });

  it('writes nothing while the generator is off', () => {
    writtenThrough = '2026-08-28';
    useSettingsStore.getState.mockReturnValue(settings({ mealCookTasks: false }));
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().backfillMealSlotTasks(['breakfast']);
    expect(sourceIds()).toHaveLength(0);
  });
});

// ─── skipNextRecurrence ─────────────────────────────────────────────────────

describe('skipNextRecurrence', () => {
  it('advances dueDate to the next occurrence', () => {
    const task = makeTask({
      id: 't1',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().skipNextRecurrence('t1');
    const updated = useTaskStore.getState().tasks[0];
    expect(new Date(updated.dueDate!).getTime()).toBeGreaterThan(new Date(task.dueDate!).getTime());
  });

  it('decrements recurrenceCount', () => {
    const task = makeTask({
      id: 't1',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      recurrenceCount: 3,
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().skipNextRecurrence('t1');
    expect(useTaskStore.getState().tasks[0].recurrenceCount).toBe(2);
  });

  it('does nothing when recurrenceCount is already 1 (no next occurrence)', () => {
    const task = makeTask({
      id: 't1',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      recurrenceCount: 1,
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().skipNextRecurrence('t1');
    const updated = useTaskStore.getState().tasks[0];
    expect(updated.dueDate).toBe(task.dueDate);
    expect(updated.recurrenceCount).toBe(1);
  });

  it('advances only the chain position on a mid-chain step, leaving the schedule untouched', () => {
    const task = makeTask({
      id: 't1',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      recurrenceCount: 5,
      chainEnabled: true,
      chainItems: [
        { id: 'a', title: 'Step A', estimatedMinutes: null },
        { id: 'b', title: 'Step B', estimatedMinutes: null },
        { id: 'c', title: 'Step C', estimatedMinutes: null },
      ],
      chainIndex: 0, // not the last step
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().skipNextRecurrence('t1');
    const updated = useTaskStore.getState().tasks[0];
    expect(updated.chainIndex).toBe(1);
    // A mid-chain step never consults the recurrence schedule — skipping it
    // shouldn't burn a cycle of the recurrence the way completing it wouldn't either.
    expect(updated.dueDate).toBe(task.dueDate);
    expect(updated.recurrenceCount).toBe(5);
  });

  it('moves the date too when skipping a mid-chain step that has one of its own', () => {
    const task = makeTask({
      id: 't1',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      recurrenceCount: 5,
      chainEnabled: true,
      chainStepOnSchedule: true,
      chainItems: [
        { id: 'a', title: 'Step A', estimatedMinutes: null },
        { id: 'b', title: 'Step B', estimatedMinutes: null },
        { id: 'c', title: 'Step C', estimatedMinutes: null },
      ],
      chainIndex: 0, // not the last step
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().skipNextRecurrence('t1');
    const updated = useTaskStore.getState().tasks[0];
    expect(updated.chainIndex).toBe(1);
    // The skipped step occupied a day of its own, so the position moving
    // without the date would park the next step on the day just skipped.
    expect(new Date(updated.dueDate!).toDateString()).toBe('Wed Jun 11 2025');
    // Still not a skipped *cycle*, same split as completeTask.
    expect(updated.recurrenceCount).toBe(5);
  });

  it('advances the schedule and wraps the chain back to 0 when skipping the last step', () => {
    const task = makeTask({
      id: 't1',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      recurrenceCount: 5,
      chainEnabled: true,
      chainItems: [
        { id: 'a', title: 'Step A', estimatedMinutes: null },
        { id: 'b', title: 'Step B', estimatedMinutes: null },
        { id: 'c', title: 'Step C', estimatedMinutes: null },
      ],
      chainIndex: 2, // last step
    });
    useTaskStore.setState({ tasks: [task] });
    useTaskStore.getState().skipNextRecurrence('t1');
    const updated = useTaskStore.getState().tasks[0];
    expect(updated.chainIndex).toBe(0);
    expect(new Date(updated.dueDate!).getTime()).toBeGreaterThan(new Date(task.dueDate!).getTime());
    expect(updated.recurrenceCount).toBe(4);
  });
});

// ─── markMissed ─────────────────────────────────────────────────────────────

describe('markMissed', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 10, 0, 0)); // June 10, 2025 10:00 AM
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const recurring = (overrides: Partial<Task> = {}) => makeTask({
    id: 't1',
    recurrenceType: 'daily',
    recurrenceInterval: 1,
    dueDate: new Date(2025, 5, 10, 9, 0, 0).toISOString(),
    ...overrides,
  });

  it('closes the occurrence out as history and spawns the next one', () => {
    useTaskStore.setState({ tasks: [recurring()] });
    useTaskStore.getState().markMissed('t1');

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(2);
    const missed = tasks.find(t => t.id === 't1')!;
    const next = tasks.find(t => t.id !== 't1')!;

    // Stored as a completed row on purpose — that's what keeps it off Today.
    expect(missed.completed).toBe(true);
    expect(missed.completedAt).not.toBeNull();
    expect(missed.missedAt).not.toBeNull();

    expect(next.completed).toBe(false);
    expect(next.missedAt).toBeNull();
    expect(next.previousOccurrenceId).toBe('t1');
    expect(new Date(next.dueDate!).getTime()).toBeGreaterThan(new Date(missed.dueDate!).getTime());
  });

  it('is not counted as a completion', () => {
    useTaskStore.setState({ tasks: [recurring()] });
    useTaskStore.getState().markMissed('t1');
    const missed = useTaskStore.getState().tasks.find(t => t.id === 't1')!;
    expect(isRealCompletion(missed)).toBe(false);
    expect(isMissed(missed)).toBe(true);
  });

  it('breaks the streak instead of advancing it, on the missed row and its successor', () => {
    useTaskStore.setState({ tasks: [recurring({
      streakCount: 12,
      streakDate: new Date(2025, 5, 9, 9, 0, 0).toISOString(),
    })] });
    useTaskStore.getState().markMissed('t1');

    const tasks = useTaskStore.getState().tasks;
    const missed = tasks.find(t => t.id === 't1')!;
    const next = tasks.find(t => t.id !== 't1')!;
    expect(missed.streakCount).toBe(0);
    expect(missed.streakDate).toBeNull();
    // The successor is the row that carries the streak from here on: leaving
    // it at 12 would hand the broken streak straight back.
    expect(next.streakCount).toBe(0);
    expect(next.streakDate).toBeNull();
    // Snapshotted so undoing the miss restores it.
    expect(missed.previousStreakCount).toBe(12);
  });

  it('restores the streak and removes the successor when undone', () => {
    useTaskStore.setState({ tasks: [recurring({
      streakCount: 12,
      streakDate: new Date(2025, 5, 9, 9, 0, 0).toISOString(),
    })] });
    useTaskStore.getState().markMissed('t1');
    useTaskStore.getState().uncompleteTask('t1');

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    const restored = tasks[0];
    expect(restored.completed).toBe(false);
    expect(restored.missedAt).toBeNull();
    expect(restored.streakCount).toBe(12);
  });

  it('keeps a quota task at the count it actually reached rather than filling it in', () => {
    useTaskStore.setState({ tasks: [recurring({ targetCount: 8, progressCount: 3 })] });
    useTaskStore.getState().markMissed('t1');
    const missed = useTaskStore.getState().tasks.find(t => t.id === 't1')!;
    expect(missed.progressCount).toBe(3);
  });

  it('burns one of a bounded recurrence, since the occurrence did come round', () => {
    useTaskStore.setState({ tasks: [recurring({ recurrenceCount: 3 })] });
    useTaskStore.getState().markMissed('t1');
    const next = useTaskStore.getState().tasks.find(t => t.id !== 't1')!;
    expect(next.recurrenceCount).toBe(2);
  });

  it('ends the chain attempt on the spot instead of advancing to the next step, and burns a cycle', () => {
    useTaskStore.setState({ tasks: [recurring({
      recurrenceCount: 5,
      chainEnabled: true,
      chainItems: [
        { id: 'a', title: 'Step A', estimatedMinutes: null },
        { id: 'b', title: 'Step B', estimatedMinutes: null },
      ],
      chainIndex: 0,
    })] });
    useTaskStore.getState().markMissed('t1');
    const next = useTaskStore.getState().tasks.find(t => t.id !== 't1')!;
    // A missed step is not a completed one — the successor starts the whole
    // chain over, not partway through it, and the missed cycle counts against
    // a bounded recurrence the same as a missed non-chain occurrence does.
    expect(next.chainIndex).toBe(0);
    expect(next.recurrenceCount).toBe(4);
  });

  it('does nothing on a non-recurring task — there is no next occurrence to move to', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', recurrenceType: 'none' })] });
    useTaskStore.getState().markMissed('t1');
    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].completed).toBe(false);
    expect(tasks[0].missedAt).toBeNull();
  });

  it('does nothing on an already-closed row', () => {
    useTaskStore.setState({ tasks: [recurring({ completed: true, completedAt: new Date().toISOString() })] });
    useTaskStore.getState().markMissed('t1');
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useTaskStore.getState().tasks[0].missedAt).toBeNull();
  });

  it('rolls a not-yet-due occurrence forward silently instead of no-opping', () => {
    // It is showing in Later, ahead of its own day — there is nothing to have
    // missed yet, and completeTask refuses it outright. Without the fallback
    // this call would do nothing at all and the button would be dead.
    const future = new Date(2025, 5, 20, 9, 0, 0).toISOString();
    useTaskStore.setState({ tasks: [recurring({ dueDate: future })] });
    useTaskStore.getState().markMissed('t1');

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(1); // rolled in place, no history row spawned
    expect(tasks[0].completed).toBe(false);
    expect(tasks[0].missedAt).toBeNull();
    expect(new Date(tasks[0].dueDate!).getTime()).toBeGreaterThan(new Date(future).getTime());
  });

  it('leaves a real completion alone — completeTask still stamps no miss', () => {
    useTaskStore.setState({ tasks: [recurring()] });
    useTaskStore.getState().completeTask('t1');
    const done = useTaskStore.getState().tasks.find(t => t.id === 't1')!;
    expect(done.missedAt).toBeNull();
    expect(isRealCompletion(done)).toBe(true);
  });

  // A meal-plan task never carries a recurrenceType — its day-to-day
  // repetition comes from writeMealSlotTasks writing a fresh row per day
  // rather than from the recurrence engine — but it's recurring in every way
  // a user would recognize, so it gets the same treatment.
  const mealPlanTask = (overrides: Partial<Task> = {}) => makeTask({
    id: 't1',
    recurrenceType: 'none',
    generatedKind: 'mealSlot',
    generatedSourceId: '2025-06-10#dinner',
    dueDate: new Date(2025, 5, 10, 9, 0, 0).toISOString(),
    ...overrides,
  });

  it('stamps a miss on a meal-plan task whose day has come, same as a recurring one', () => {
    useTaskStore.setState({ tasks: [mealPlanTask()] });
    useTaskStore.getState().markMissed('t1');
    const missed = useTaskStore.getState().tasks.find(t => t.id === 't1')!;
    expect(missed.completed).toBe(true);
    expect(missed.missedAt).not.toBeNull();
    expect(isRealCompletion(missed)).toBe(false);
    expect(isMissed(missed)).toBe(true);
  });

  it('spawns nothing for a missed meal-plan task — tomorrow\'s row already exists on its own', () => {
    useTaskStore.setState({ tasks: [mealPlanTask()] });
    useTaskStore.getState().markMissed('t1');
    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });

  it('does nothing on a meal-plan task not yet due — nothing to have missed yet, and no schedule to roll forward', () => {
    const future = new Date(2025, 5, 20, 9, 0, 0).toISOString();
    useTaskStore.setState({ tasks: [mealPlanTask({ dueDate: future })] });
    useTaskStore.getState().markMissed('t1');
    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].completed).toBe(false);
    expect(tasks[0].missedAt).toBeNull();
  });

  it('still does nothing on a plain generated task that is neither recurring nor a meal-plan task', () => {
    useTaskStore.setState({ tasks: [makeTask({
      id: 't1', recurrenceType: 'none', generatedKind: 'groceryUseUp', generatedSourceId: 'g-1',
    })] });
    useTaskStore.getState().markMissed('t1');
    const tasks = useTaskStore.getState().tasks;
    expect(tasks[0].completed).toBe(false);
    expect(tasks[0].missedAt).toBeNull();
  });
});

// ─── togglePin ─────────────────────────────────────────────────────────────

describe('togglePin', () => {
  it('sets pinned to true when currently false', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', pinned: false })] });
    useTaskStore.getState().togglePin('t1');
    expect(useTaskStore.getState().tasks[0].pinned).toBe(true);
  });

  it('sets pinned to false when currently true', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', pinned: true })] });
    useTaskStore.getState().togglePin('t1');
    expect(useTaskStore.getState().tasks[0].pinned).toBe(false);
  });

  it('does not touch reminders, since pinning does not affect the notification', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', pinned: false })] });
    useTaskStore.getState().togglePin('t1');
    expect(cancelTaskReminder).not.toHaveBeenCalled();
    expect(scheduleTaskReminder).not.toHaveBeenCalled();
  });
});

// ─── archiveTask / unarchiveTask ────────────────────────────────────────────

describe('archiveTask', () => {
  it('sets archived and archivedAt, leaving streak fields untouched', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', recurrenceType: 'daily', streakCount: 12, streakDate: '2025-06-10T00:00:00.000Z' })],
    });
    useTaskStore.getState().archiveTask('t1');
    const task = useTaskStore.getState().tasks[0];
    expect(task.archived).toBe(true);
    expect(task.archivedAt).not.toBeNull();
    expect(task.streakCount).toBe(12);
    expect(task.streakDate).toBe('2025-06-10T00:00:00.000Z');
  });

  it('is a no-op on an already-archived task', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', archived: true, archivedAt: '2025-01-01T00:00:00.000Z' })] });
    useTaskStore.getState().archiveTask('t1');
    expect(useTaskStore.getState().tasks[0].archivedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('is undoable via lastAction', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1' })], lastAction: null });
    useTaskStore.getState().archiveTask('t1');
    useTaskStore.getState().undoLastAction();
    expect(useTaskStore.getState().tasks[0].archived).toBe(false);
    expect(useTaskStore.getState().tasks[0].archivedAt).toBeNull();
  });

  it('clears pinned when archiving a pinned task', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', pinned: true })] });
    useTaskStore.getState().archiveTask('t1');
    expect(useTaskStore.getState().tasks[0].pinned).toBe(false);
  });

  it('restores the pin on undo', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', pinned: true })], lastAction: null });
    useTaskStore.getState().archiveTask('t1');
    useTaskStore.getState().undoLastAction();
    expect(useTaskStore.getState().tasks[0].pinned).toBe(true);
  });
});

describe('unarchiveTask', () => {
  it('clears archived state and breaks the streak', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', archived: true, archivedAt: '2025-01-01T00:00:00.000Z', streakCount: 30, streakDate: '2025-01-01T00:00:00.000Z' })],
    });
    useTaskStore.getState().unarchiveTask('t1');
    const task = useTaskStore.getState().tasks[0];
    expect(task.archived).toBe(false);
    expect(task.archivedAt).toBeNull();
    expect(task.streakCount).toBe(0);
    expect(task.streakDate).toBeNull();
  });

  it('is a no-op on a task that is not archived', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', archived: false, streakCount: 5 })] });
    useTaskStore.getState().unarchiveTask('t1');
    expect(useTaskStore.getState().tasks[0].streakCount).toBe(5);
  });

  it('is undoable, restoring the archived stamp and the broken streak', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', archived: true, archivedAt: '2025-01-01T00:00:00.000Z', streakCount: 30, streakDate: '2024-12-31T00:00:00.000Z' })],
      lastAction: null,
    });
    useTaskStore.getState().unarchiveTask('t1');
    useTaskStore.getState().undoLastAction();
    const task = useTaskStore.getState().tasks[0];
    expect(task.archived).toBe(true);
    expect(task.archivedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(task.streakCount).toBe(30);
    expect(task.streakDate).toBe('2024-12-31T00:00:00.000Z');
  });

  it('leaves no undo entry when the task is not archived', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', archived: false })], lastAction: null });
    useTaskStore.getState().unarchiveTask('t1');
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

describe('archivedTasks', () => {
  it('returns only archived, incomplete, top-level tasks', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', archived: true }),
        makeTask({ id: 'b', archived: false }),
        makeTask({ id: 'c', archived: true, completed: true, completedAt: '2025-01-01T00:00:00.000Z' }),
        makeTask({ id: 'd', archived: true, parentId: 'a' }),
      ],
    });
    const ids = useTaskStore.getState().archivedTasks().map(t => t.id);
    expect(ids).toEqual(['a']);
  });
});

// ─── pinnedOrder ─────────────────────────────────────────────────────────────

describe('pinned ordering', () => {
  it('orders pinnedTasks by sortOrder while nothing has been ranked', () => {
    // Every row starts at pinnedOrder 0 — including every row on a device that
    // upgraded into the column — so the section must read exactly as it did
    // before the column existed.
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'b', pinned: true, sortOrder: 2 }),
        makeTask({ id: 'a', pinned: true, sortOrder: 1 }),
      ],
    });
    expect(useTaskStore.getState().pinnedTasks().map(t => t.id)).toEqual(['a', 'b']);
  });

  it('appends a newly pinned task to the bottom of the section', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'ranked', pinned: true, pinnedOrder: 1, sortOrder: 99 }),
        makeTask({ id: 'fresh', pinned: false, sortOrder: 1 }),
      ],
    });
    useTaskStore.getState().togglePin('fresh');
    // Would sort first on sortOrder alone; the fresh rank is what puts it last.
    expect(useTaskStore.getState().pinnedTasks().map(t => t.id)).toEqual(['ranked', 'fresh']);
  });

  it('does not restamp a task that was already pinned', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', pinned: true, pinnedOrder: 1 }),
        makeTask({ id: 'b', pinned: true, pinnedOrder: 2 }),
      ],
    });
    // What the editor does on every save of an already-pinned task.
    useTaskStore.getState().updateTask('a', { pinned: true, title: 'edited' });
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.pinnedOrder).toBe(1);
    expect(useTaskStore.getState().pinnedTasks().map(t => t.id)).toEqual(['a', 'b']);
  });

  it('keeps unpinning free of ranks', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', pinned: true, pinnedOrder: 3 })] });
    useTaskStore.getState().togglePin('a');
    expect(useTaskStore.getState().pinnedTasks()).toEqual([]);
  });

  it('gives a bulk pin consecutive ranks, leaving the already-pinned alone', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'old', pinned: true, pinnedOrder: 1, sortOrder: 50 }),
        makeTask({ id: 'x', pinned: false, sortOrder: 1 }),
        makeTask({ id: 'y', pinned: false, sortOrder: 2 }),
      ],
    });
    useTaskStore.getState().bulkTogglePin(['old', 'x', 'y']);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'old')?.pinnedOrder).toBe(1);
    expect(tasks.find(t => t.id === 'x')?.pinnedOrder).toBe(2);
    expect(tasks.find(t => t.id === 'y')?.pinnedOrder).toBe(3);
    expect(useTaskStore.getState().pinnedTasks().map(t => t.id)).toEqual(['old', 'x', 'y']);
  });
});

// ─── reorderPinnedTasks ──────────────────────────────────────────────────────

describe('reorderPinnedTasks', () => {
  it('renumbers the section from 1 in the given order', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', pinned: true, sortOrder: 1 }),
        makeTask({ id: 'b', pinned: true, sortOrder: 2 }),
        makeTask({ id: 'c', pinned: true, sortOrder: 3 }),
      ],
    });
    useTaskStore.getState().reorderPinnedTasks(['c', 'a', 'b']);
    expect(useTaskStore.getState().pinnedTasks().map(t => t.id)).toEqual(['c', 'a', 'b']);
    // From 1, so no row is left on the 0 that means "never ranked".
    expect(useTaskStore.getState().tasks.map(t => t.pinnedOrder).sort()).toEqual([1, 2, 3]);
  });

  it('leaves sortOrder alone, so the rows keep their place in their categories', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', pinned: true, category: 'Work', sortOrder: 1 }),
        makeTask({ id: 'b', pinned: true, category: 'Work', sortOrder: 2 }),
      ],
    });
    useTaskStore.getState().reorderPinnedTasks(['b', 'a']);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'a')?.sortOrder).toBe(1);
    expect(tasks.find(t => t.id === 'b')?.sortOrder).toBe(2);
  });

  it('persists through one batched write', () => {
    (dbBatchUpdatePinnedOrders as jest.Mock).mockClear();
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', pinned: true }), makeTask({ id: 'b', pinned: true })],
    });
    useTaskStore.getState().reorderPinnedTasks(['b', 'a']);
    expect(dbBatchUpdatePinnedOrders).toHaveBeenCalledWith([
      { id: 'b', pinnedOrder: 1 },
      { id: 'a', pinnedOrder: 2 },
    ]);
  });

  it('is a no-op on an empty list', () => {
    (dbBatchUpdatePinnedOrders as jest.Mock).mockClear();
    useTaskStore.getState().reorderPinnedTasks([]);
    expect(dbBatchUpdatePinnedOrders).not.toHaveBeenCalled();
  });
});

// ─── clearAllPins ────────────────────────────────────────────────────────────

describe('clearAllPins', () => {
  it('sets pinned to false on all pinned tasks', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 't1', pinned: true }),
        makeTask({ id: 't2', pinned: true }),
        makeTask({ id: 't3', pinned: false }),
      ],
    });
    useTaskStore.getState().clearAllPins();
    const { tasks } = useTaskStore.getState();
    expect(tasks.every(t => !t.pinned)).toBe(true);
  });

  it('calls dbClearAllPins', () => {
    useTaskStore.getState().clearAllPins();
    expect(dbClearAllPins).toHaveBeenCalledTimes(1);
  });
});

// ─── pinCategory ───────────────────────────────────────────────────────────

describe('pinCategory', () => {
  it('pins every incomplete task in the category when not all are pinned', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 't1', category: 'Work', pinned: false }),
        makeTask({ id: 't2', category: 'Work', pinned: true }),
        makeTask({ id: 't3', category: 'Home', pinned: false }),
      ],
    });
    useTaskStore.getState().pinCategory('Work');
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 't1')?.pinned).toBe(true);
    expect(tasks.find(t => t.id === 't2')?.pinned).toBe(true);
    expect(tasks.find(t => t.id === 't3')?.pinned).toBe(false);
    expect(dbBulkSetPinned).toHaveBeenCalledWith(['t1', 't2'], true);
  });

  it('unpins every task in the category when all are already pinned', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 't1', category: 'Work', pinned: true }),
        makeTask({ id: 't2', category: 'Work', pinned: true }),
      ],
    });
    useTaskStore.getState().pinCategory('Work');
    const { tasks } = useTaskStore.getState();
    expect(tasks.every(t => !t.pinned)).toBe(true);
    expect(dbBulkSetPinned).toHaveBeenCalledWith(['t1', 't2'], false);
  });

  it('does nothing when the category has no tasks', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', category: 'Home', pinned: false })] });
    useTaskStore.getState().pinCategory('Work');
    expect(dbBulkSetPinned).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks[0].pinned).toBe(false);
  });
});

// ─── setCategoryTimeSegments ─────────────────────────────────────────────────

describe('setCategoryTimeSegments', () => {
  it('moves every live task in the category and leaves other categories alone', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 't1', category: 'Evening tasks', timeSegments: ['evening'] }),
        makeTask({ id: 't2', category: 'Evening tasks', timeSegments: ['evening'] }),
        makeTask({ id: 't3', category: 'Work', timeSegments: ['evening'] }),
      ],
    });

    const moved = useTaskStore.getState().setCategoryTimeSegments('Evening tasks', ['night']);

    expect(moved).toBe(2);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 't1')?.timeSegments).toEqual(['night']);
    expect(tasks.find(t => t.id === 't2')?.timeSegments).toEqual(['night']);
    expect(tasks.find(t => t.id === 't3')?.timeSegments).toEqual(['evening']);
    expect(dbBulkSetTimeSegments).toHaveBeenCalledWith(['t1', 't2'], ['night']);
  });

  // The whole reason this isn't bulkSetWhen(ids, null, segments): that one
  // writes due_date too, so reusing it would unschedule everything it touched.
  it('leaves due dates untouched', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', category: 'Evening tasks', dueDate: '2026-08-06T00:00:00.000Z', timeSegments: ['evening'] })],
    });

    useTaskStore.getState().setCategoryTimeSegments('Evening tasks', ['night']);

    expect(useTaskStore.getState().tasks[0].dueDate).toBe('2026-08-06T00:00:00.000Z');
  });

  it('skips completed, archived and subtask rows', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'live', category: 'Evening tasks', timeSegments: ['evening'] }),
        makeTask({ id: 'done', category: 'Evening tasks', timeSegments: ['evening'], completed: true }),
        makeTask({ id: 'filed', category: 'Evening tasks', timeSegments: ['evening'], archived: true }),
        makeTask({ id: 'sub', category: 'Evening tasks', timeSegments: ['evening'], parentId: 'live' }),
      ],
    });

    expect(useTaskStore.getState().setCategoryTimeSegments('Evening tasks', ['night'])).toBe(1);
    expect(dbBulkSetTimeSegments).toHaveBeenCalledWith(['live'], ['night']);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'done')?.timeSegments).toEqual(['evening']);
    expect(tasks.find(t => t.id === 'filed')?.timeSegments).toEqual(['evening']);
    expect(tasks.find(t => t.id === 'sub')?.timeSegments).toEqual(['evening']);
  });

  it('clears the segment when given an empty set', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', category: 'Evening tasks', timeSegments: ['evening'] })] });

    useTaskStore.getState().setCategoryTimeSegments('Evening tasks', []);

    expect(useTaskStore.getState().tasks[0].timeSegments).toEqual([]);
    expect(dbBulkSetTimeSegments).toHaveBeenCalledWith(['t1'], []);
  });

  // Re-tapping an already-applied segment must not push a no-op onto the undo
  // stack, or it buries whatever real action was under it.
  it('does nothing when every task already agrees', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', category: 'Evening tasks', timeSegments: ['night'] })],
      lastAction: { label: 'Something else', undo: jest.fn() },
    });

    expect(useTaskStore.getState().setCategoryTimeSegments('Evening tasks', ['night'])).toBe(0);
    expect(dbBulkSetTimeSegments).not.toHaveBeenCalled();
    expect(useTaskStore.getState().lastAction?.label).toBe('Something else');
  });

  it('does nothing when the category has no live tasks', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', category: 'Work', timeSegments: ['evening'] })] });

    expect(useTaskStore.getState().setCategoryTimeSegments('Evening tasks', ['night'])).toBe(0);
    expect(dbBulkSetTimeSegments).not.toHaveBeenCalled();
  });

  it('registers an undo that puts the old segments back', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 't1', category: 'Evening tasks', timeSegments: ['evening'] }),
        makeTask({ id: 't2', category: 'Evening tasks', timeSegments: [] }),
      ],
    });

    useTaskStore.getState().setCategoryTimeSegments('Evening tasks', ['night']);
    expect(useTaskStore.getState().lastAction?.label).toBe('2 tasks rescheduled');

    useTaskStore.getState().lastAction!.undo();

    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 't1')?.timeSegments).toEqual(['evening']);
    expect(tasks.find(t => t.id === 't2')?.timeSegments).toEqual([]);
  });
});

// ─── category default time-of-day (creation-time seed) ───────────────────────

describe('Category.defaultTimeSegments seeding', () => {
  const withCategoryDefault = (name: string, defaultTimeSegments: string[]) => {
    (useCategoryStore.getState as unknown as jest.Mock).mockReturnValue({
      categories: [],
      getCategoryByName: (n: string) => (n === name ? { id: 'c1', name, defaultTimeSegments } : null),
    });
  };

  afterEach(() => {
    (useCategoryStore.getState as unknown as jest.Mock).mockReset();
    (useCategoryStore.getState as unknown as jest.Mock).mockReturnValue({
      categories: [],
      getCategoryByName: () => null,
    });
  });

  it('starts a new task in the category on the category default', () => {
    withCategoryDefault('Evening tasks', ['night']);

    const task = useTaskStore.getState().addTask({ title: 'Floss', category: 'Evening tasks' });

    expect(task.timeSegments).toEqual(['night']);
  });

  // Every editor sends timeSegments unconditionally from its state, so `[]`
  // means "never opened the row", not "deliberately none" — treating it as a
  // choice would make the default fire for approximately nobody.
  it('treats an empty draft array as unset rather than as a deliberate none', () => {
    withCategoryDefault('Evening tasks', ['night']);

    const task = useTaskStore.getState().addTask({ title: 'Floss', category: 'Evening tasks', timeSegments: [] });

    expect(task.timeSegments).toEqual(['night']);
  });

  it('lets an explicit segment on the draft win over the default', () => {
    withCategoryDefault('Evening tasks', ['night']);

    const task = useTaskStore.getState().addTask({ title: 'Floss', category: 'Evening tasks', timeSegments: ['morning'] });

    expect(task.timeSegments).toEqual(['morning']);
  });

  it('leaves a task in a category with no default alone', () => {
    withCategoryDefault('Evening tasks', []);

    const task = useTaskStore.getState().addTask({ title: 'Floss', category: 'Evening tasks' });

    expect(task.timeSegments).toEqual([]);
  });

  it('leaves an uncategorized task alone', () => {
    withCategoryDefault('Evening tasks', ['night']);

    expect(useTaskStore.getState().addTask({ title: 'Floss' }).timeSegments).toEqual([]);
  });

  it('seeds each row of a series created from scratch', () => {
    withCategoryDefault('Evening tasks', ['night']);

    const rows = useTaskStore.getState().addTaskSeries(
      { title: 'Walk the dog', category: 'Evening tasks' },
      [new Date('2026-08-10T12:00:00.000Z'), new Date('2026-08-15T12:00:00.000Z')],
    );

    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.timeSegments.length === 1 && r.timeSegments[0] === 'night')).toBe(true);
  });

  // buildSeriesRow is the clone builder as well as the create builder, and a
  // clone's empty timeSegments is the source row's deliberate answer — not an
  // unanswered question for the category to fill in. Without the seed being
  // gated, next month's set would gain a segment this month's never had.
  it('does not reseed the next set when a series rolls over', () => {
    withCategoryDefault('Evening tasks', ['night']);
    useTaskStore.setState({
      tasks: [
        makeTask({
          id: 's1', title: 'Rent', category: 'Evening tasks', timeSegments: [],
          seriesId: 'ser-1', dueDate: '2026-08-10T12:00:00.000Z',
          seriesMonthDays: [10], seriesRepeatMonths: 1,
        }),
      ],
    });

    useTaskStore.getState().completeTask('s1');

    const spawned = useTaskStore.getState().tasks.filter(t => t.id !== 's1' && !t.completed);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].timeSegments).toEqual([]);
  });

  // The default is a seed, not a live rule: once the row exists its own
  // segments are what everything reads, so changing the category later must
  // not reach back and move it.
  it('does not move a task that already exists', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', category: 'Evening tasks', timeSegments: ['evening'] })] });
    withCategoryDefault('Evening tasks', ['night']);

    expect(useTaskStore.getState().tasks[0].timeSegments).toEqual(['evening']);
  });
});

// ─── renameCategory ──────────────────────────────────────────────────────────

/** A template whose items carry the given categories, for the rename cascade. */
function makeTemplateWithItemCategories(id: string, categories: (string | null)[]) {
  return {
    id,
    name: 'Weekly reset',
    items: categories.map((category, i) => normalizeTemplateItem({ id: `${id}-i${i}`, title: `Item ${i}`, category })),
    itemGroups: [],
    questions: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    sortOrder: 1,
    category: null,
    applyContainer: 'stack' as const,
    schedule: null,
    scheduleLastFiredKey: null,
  };
}

describe('renameCategory', () => {
  it('updates the category on every task that had the old name', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 't1', category: 'Work' }),
        makeTask({ id: 't2', category: 'Home' }),
      ],
    });
    const ok = useTaskStore.getState().renameCategory('Work', 'Job');
    expect(ok).toBe(true);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 't1')?.category).toBe('Job');
    expect(tasks.find(t => t.id === 't2')?.category).toBe('Home');
  });

  it('updates the category on task groups that had the old name', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', category: 'Work' })] });
    useTaskStore.getState().renameCategory('Work', 'Job');
    expect(useTaskGroupStore.getState().groups.find(g => g.id === 'g1')?.category).toBe('Job');
  });

  it('leaves tasks untouched and returns false when the underlying rename fails', () => {
    const { useCategoryStore } = jest.requireMock('../store/useCategoryStore') as { useCategoryStore: { getState: jest.Mock } };
    useCategoryStore.getState.mockReturnValue({
      categories: [],
      renameCategory: jest.fn().mockReturnValue(false),
    });
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', category: 'Work' })] });
    const ok = useTaskStore.getState().renameCategory('Work', 'Job');
    expect(ok).toBe(false);
    expect(useTaskStore.getState().tasks[0].category).toBe('Work');
  });

  // Templates used to be the one holder of a category name that a rename
  // didn't reach, which left them naming something unresolvable — exactly what
  // findMissingRefs reports, but with no user action behind it.
  it('updates the category on template items that had the old name', () => {
    useTemplateStore.setState({
      templates: [makeTemplateWithItemCategories('tpl-1', ['Work', 'Home'])],
      initialized: true,
    });
    useTaskStore.getState().renameCategory('Work', 'Job');
    expect(useTemplateStore.getState().templates[0].items.map(i => i.category))
      .toEqual(['Job', 'Home']);
  });

  it('does not touch template items when the underlying rename fails', () => {
    const { useCategoryStore } = jest.requireMock('../store/useCategoryStore') as { useCategoryStore: { getState: jest.Mock } };
    useCategoryStore.getState.mockReturnValue({
      categories: [],
      renameCategory: jest.fn().mockReturnValue(false),
    });
    useTemplateStore.setState({
      templates: [makeTemplateWithItemCategories('tpl-1', ['Work'])],
      initialized: true,
    });
    useTaskStore.getState().renameCategory('Work', 'Job');
    expect(useTemplateStore.getState().templates[0].items[0].category).toBe('Work');
  });
});

// ─── reorderTasks ────────────────────────────────────────────────────────────

describe('reorderTasks', () => {
  it('assigns sortOrder based on position in the new id sequence', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', sortOrder: 1 }), makeTask({ id: 'b', sortOrder: 2 })],
    });
    useTaskStore.getState().reorderTasks(['b', 'a']);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'b')?.sortOrder).toBe(1);
    expect(tasks.find(t => t.id === 'a')?.sortOrder).toBe(2);
  });

  it('persists new sort orders to the db', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b' })],
    });
    useTaskStore.getState().reorderTasks(['b', 'a']);
    expect(dbBatchUpdateSortOrders).toHaveBeenCalledWith([
      { id: 'b', sortOrder: 1 },
      { id: 'a', sortOrder: 2 },
    ]);
  });
});

// ─── reorderProjectTasks ─────────────────────────────────────────────────────

describe('reorderProjectTasks', () => {
  // The whole point of the separate action: renumbering the project 1..N would
  // drag every dated member of it to the top of Today.
  it('swaps the members between the slots they already held', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', projectId: 'p1', sortOrder: 40 }),
        makeTask({ id: 'b', projectId: 'p1', sortOrder: 90 }),
        makeTask({ id: 'loose', sortOrder: 60 }),
      ],
    });
    useTaskStore.getState().reorderProjectTasks('p1', ['b', 'a']);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'b')?.sortOrder).toBe(40);
    expect(tasks.find(t => t.id === 'a')?.sortOrder).toBe(90);
    expect(tasks.find(t => t.id === 'loose')?.sortOrder).toBe(60);
    expect(dbBatchUpdateSortOrders).toHaveBeenCalledWith([
      { id: 'b', sortOrder: 40 },
      { id: 'a', sortOrder: 90 },
    ]);
  });

  it('leaves other projects, completed and archived members alone', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', projectId: 'p1', sortOrder: 10 }),
        makeTask({ id: 'b', projectId: 'p1', sortOrder: 20 }),
        makeTask({ id: 'done', projectId: 'p1', sortOrder: 15, completed: true }),
        makeTask({ id: 'filed', projectId: 'p1', sortOrder: 17, archived: true }),
        makeTask({ id: 'other', projectId: 'p2', sortOrder: 12 }),
      ],
    });
    useTaskStore.getState().reorderProjectTasks('p1', ['b', 'a', 'done', 'filed', 'other']);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'done')?.sortOrder).toBe(15);
    expect(tasks.find(t => t.id === 'filed')?.sortOrder).toBe(17);
    expect(tasks.find(t => t.id === 'other')?.sortOrder).toBe(12);
    expect(tasks.find(t => t.id === 'b')?.sortOrder).toBe(10);
  });

  it('writes nothing when the drop changed nothing', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', projectId: 'p1', sortOrder: 10 }),
        makeTask({ id: 'b', projectId: 'p1', sortOrder: 20 }),
      ],
    });
    (dbBatchUpdateSortOrders as jest.Mock).mockClear();
    useTaskStore.getState().reorderProjectTasks('p1', ['a', 'b']);
    expect(dbBatchUpdateSortOrders).not.toHaveBeenCalled();
  });
});

// ─── reorderWithCategoryUpdates ─────────────────────────────────────────────

describe('reorderWithCategoryUpdates', () => {
  it('assigns sortOrder and applies category updates', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', sortOrder: 1, category: 'Work' }),
        makeTask({ id: 'b', sortOrder: 2, category: null }),
      ],
    });
    useTaskStore.getState().reorderWithCategoryUpdates(
      [{ id: 'b', sortOrder: 1 }, { id: 'a', sortOrder: 2 }],
      [{ id: 'b', category: 'Work' }],
    );
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'b')).toMatchObject({ sortOrder: 1, category: 'Work' });
    expect(tasks.find(t => t.id === 'a')).toMatchObject({ sortOrder: 2, category: 'Work' });
    expect(dbUpdateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', category: 'Work' }));
  });

  it('queues an undo action that restores the previous category', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', sortOrder: 1, category: null })],
    });
    useTaskStore.getState().reorderWithCategoryUpdates([{ id: 'a', sortOrder: 1 }], [{ id: 'a', category: 'Errands' }]);
    expect(useTaskStore.getState().tasks[0].category).toBe('Errands');

    useTaskStore.getState().undoLastAction();
    expect(useTaskStore.getState().tasks[0].category).toBe(null);
  });

  it('does not queue an undo action when no category changed', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', sortOrder: 1 }), makeTask({ id: 'b', sortOrder: 2 })],
      lastAction: null,
    });
    useTaskStore.getState().reorderWithCategoryUpdates([{ id: 'b', sortOrder: 1 }, { id: 'a', sortOrder: 2 }], []);
    expect(useTaskStore.getState().lastAction).toBe(null);
  });

  it('captures seriesDefaults instead of overwriting the series when scope is occurrence', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', sortOrder: 1, category: 'Work', recurrenceType: 'daily' })],
    });
    useTaskStore.getState().reorderWithCategoryUpdates([{ id: 'a', sortOrder: 1 }], [{ id: 'a', category: 'Home' }], { scope: 'occurrence' });
    const task = useTaskStore.getState().tasks[0];
    expect(task.category).toBe('Home');
    expect(task.seriesDefaults).toMatchObject({ category: 'Work' });
  });
});

// ─── addSubtask ──────────────────────────────────────────────────────────────

describe('addSubtask', () => {
  it('creates a subtask with the correct parentId', () => {
    useTaskStore.getState().addSubtask('parent-1', 'Sub item');
    const task = useTaskStore.getState().tasks[0];
    expect(task.parentId).toBe('parent-1');
    expect(task.title).toBe('Sub item');
  });

  it('persists to the db', () => {
    useTaskStore.getState().addSubtask('parent-1', 'Sub');
    expect(dbInsertTask).toHaveBeenCalledTimes(1);
  });
});

// ─── toggleSubtask ───────────────────────────────────────────────────────────

describe('toggleSubtask', () => {
  it('marks a subtask as completed', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'sub', completed: false, parentId: 'p' })] });
    useTaskStore.getState().toggleSubtask('sub');
    expect(useTaskStore.getState().tasks[0].completed).toBe(true);
    expect(useTaskStore.getState().tasks[0].completedAt).toBeTruthy();
  });

  it('marks a completed subtask as incomplete', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'sub', completed: true, completedAt: 'now', parentId: 'p' })],
    });
    useTaskStore.getState().toggleSubtask('sub');
    expect(useTaskStore.getState().tasks[0].completed).toBe(false);
    expect(useTaskStore.getState().tasks[0].completedAt).toBeNull();
  });
});

// ─── deleteSubtask ───────────────────────────────────────────────────────────

describe('deleteSubtask', () => {
  it('removes the subtask from state', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'sub', parentId: 'p' })] });
    useTaskStore.getState().deleteSubtask('sub');
    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  it('calls dbDeleteTask', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'sub', parentId: 'p' })] });
    useTaskStore.getState().deleteSubtask('sub');
    expect(dbDeleteTask).toHaveBeenCalledWith('sub');
  });

  // A timed task's duration is the sum of the stretches its subtasks carry, and
  // a subtask can be deleted from the task row as well as the editor.
  const apportioned = () => ({
    tasks: [
      makeTask({ id: 'p', timedMinutes: 25 }),
      makeTask({ id: 's1', parentId: 'p', sortOrder: 1, timedMinutes: 5 }),
      makeTask({ id: 's2', parentId: 'p', sortOrder: 2, timedMinutes: 10 }),
      makeTask({ id: 's3', parentId: 'p', sortOrder: 3, timedMinutes: 10 }),
    ],
  });

  it("re-totals the parent's countdown when a stretch is deleted", () => {
    useTaskStore.setState(apportioned());
    useTaskStore.getState().deleteSubtask('s3');
    expect(useTaskStore.getState().tasks.find(t => t.id === 'p')!.timedMinutes).toBe(15);
  });

  it('puts the old total back when the delete is undone', () => {
    useTaskStore.setState(apportioned());
    useTaskStore.getState().deleteSubtask('s3');
    useTaskStore.getState().lastAction!.undo();
    expect(useTaskStore.getState().tasks.find(t => t.id === 'p')!.timedMinutes).toBe(25);
    expect(useTaskStore.getState().tasks.some(t => t.id === 's3')).toBe(true);
  });

  it('leaves the duration alone when the last stretch goes — the task is still timed', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'p', timedMinutes: 5 }),
        makeTask({ id: 's1', parentId: 'p', sortOrder: 1, timedMinutes: 5 }),
      ],
    });
    useTaskStore.getState().deleteSubtask('s1');
    expect(useTaskStore.getState().tasks.find(t => t.id === 'p')!.timedMinutes).toBe(5);
  });

  it("doesn't touch a parent whose subtasks never carried a stretch", () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'p', timedMinutes: 25 }),
        makeTask({ id: 's1', parentId: 'p', sortOrder: 1 }),
      ],
    });
    useTaskStore.getState().deleteSubtask('s1');
    expect(useTaskStore.getState().tasks.find(t => t.id === 'p')!.timedMinutes).toBe(25);
  });

  it('never promotes an untimed parent to a timed one', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'p', timedMinutes: null }),
        makeTask({ id: 's1', parentId: 'p', sortOrder: 1, timedMinutes: 5 }),
        makeTask({ id: 's2', parentId: 'p', sortOrder: 2, timedMinutes: 10 }),
      ],
    });
    useTaskStore.getState().deleteSubtask('s2');
    expect(useTaskStore.getState().tasks.find(t => t.id === 'p')!.timedMinutes).toBeNull();
  });
});

// ─── task groups ─────────────────────────────────────────────────────────────

describe('groupChildrenOf', () => {
  it('returns tasks with that groupId, sorted by sortOrder', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'b', groupId: 'g1', sortOrder: 2 }),
        makeTask({ id: 'a', groupId: 'g1', sortOrder: 1 }),
        makeTask({ id: 'other', groupId: 'g2', sortOrder: 1 }),
      ],
    });
    expect(useTaskStore.getState().groupChildrenOf('g1').map(t => t.id)).toEqual(['a', 'b']);
  });
});

describe('groupRosterOf', () => {
  const today = () => new Date().toISOString();
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
  const daysAhead = (n: number) => new Date(Date.now() + n * 86400000).toISOString();

  it('drops the completion tombstones a recurring member leaves behind', () => {
    // The reported bug: 8 nightly habits reading as 22 tasks in the stack.
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'floss-live', groupId: 'g1', dueDate: today(), sortOrder: 1 }),
        makeTask({ id: 'floss-1', groupId: 'g1', completed: true, completedAt: daysAgo(1), sortOrder: 1 }),
        makeTask({ id: 'floss-2', groupId: 'g1', completed: true, completedAt: daysAgo(2), sortOrder: 1 }),
        makeTask({ id: 'floss-3', groupId: 'g1', completed: true, completedAt: daysAgo(3), sortOrder: 1 }),
      ],
    });
    expect(useTaskStore.getState().groupRosterOf('g1').map(t => t.id)).toEqual(['floss-live']);
  });

  it('counts a member completed today, not the occurrence it just spawned', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'done', groupId: 'g1', completed: true, completedAt: today(), sortOrder: 1 }),
        makeTask({ id: 'tomorrow', groupId: 'g1', dueDate: daysAhead(1), previousOccurrenceId: 'done', sortOrder: 1 }),
      ],
    });
    // One member, shown as done — not two, and not zero.
    expect(useTaskStore.getState().groupRosterOf('g1').map(t => t.id)).toEqual(['done']);
  });

  it('keeps a member that is not due today (iron every other day)', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'daily', groupId: 'g1', dueDate: today(), sortOrder: 1 }),
        makeTask({ id: 'iron', groupId: 'g1', dueDate: daysAhead(1), sortOrder: 2 }),
      ],
    });
    expect(useTaskStore.getState().groupRosterOf('g1').map(t => t.id)).toEqual(['daily', 'iron']);
  });

  it('keeps a chain step that spawned dated and is due right now', () => {
    const step1 = makeTask({
      id: 'step-1', groupId: 'g1', dueDate: today(), chainEnabled: true,
      chainItems: [
        { id: 'a', title: 'Step A', estimatedMinutes: null },
        { id: 'b', title: 'Step B', estimatedMinutes: null },
      ],
      chainIndex: 0, sortOrder: 1,
    });
    useTaskStore.setState({ tasks: [step1] });
    useTaskStore.getState().completeTask('step-1');

    const { tasks } = useTaskStore.getState();
    const step2 = tasks.find(t => t.id !== 'step-1')!;
    expect(step2.dueDate).not.toBeNull();
    expect(useTaskStore.getState().groupRosterOf('g1').map(t => t.id)).toEqual(['step-1', step2.id]);
  });

  it('drops a one-off member once the day it was completed has passed', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'live', groupId: 'g1', dueDate: today(), sortOrder: 1 }),
        makeTask({ id: 'old-oneoff', groupId: 'g1', completed: true, completedAt: daysAgo(3), sortOrder: 2 }),
      ],
    });
    expect(useTaskStore.getState().groupRosterOf('g1').map(t => t.id)).toEqual(['live']);
  });

  it('drops archived members', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'live', groupId: 'g1', dueDate: today(), sortOrder: 1 }),
        makeTask({ id: 'gone', groupId: 'g1', archived: true, archivedAt: daysAgo(1), sortOrder: 2 }),
      ],
    });
    expect(useTaskStore.getState().groupRosterOf('g1').map(t => t.id)).toEqual(['live']);
  });

  it('counts a dated series as one member, not one per date', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'dog-10', groupId: 'g1', seriesId: 'set-1', dueDate: today(), sortOrder: 1 }),
        makeTask({ id: 'dog-15', groupId: 'g1', seriesId: 'set-1', dueDate: daysAhead(5), sortOrder: 2 }),
        makeTask({ id: 'other', groupId: 'g1', dueDate: today(), sortOrder: 3 }),
      ],
    });
    expect(useTaskStore.getState().groupRosterOf('g1').map(t => t.id)).toEqual(['dog-10', 'other']);
  });

  it("lets a series' date that is due today speak for it", () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'dog-past', groupId: 'g1', seriesId: 'set-1', dueDate: daysAhead(9), sortOrder: 1 }),
        makeTask({ id: 'dog-today', groupId: 'g1', seriesId: 'set-1', dueDate: today(), sortOrder: 2 }),
      ],
    });
    expect(useTaskStore.getState().groupRosterOf('g1').map(t => t.id)).toEqual(['dog-today']);
  });

  it('stays flat as a recurring member is completed day after day', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', groupId: 'g1', dueDate: today(), recurrenceType: 'daily', recurrenceInterval: 1 })],
    });
    for (let day = 0; day < 5; day++) {
      const live = useTaskStore.getState().groupRosterOf('g1').find(t => !t.completed);
      if (live) useTaskStore.getState().completeTask(live.id);
      expect(useTaskStore.getState().groupRosterOf('g1')).toHaveLength(1);
    }
    // The occurrences themselves are still on disk for the Logbook.
    expect(useTaskStore.getState().groupChildrenOf('g1').length).toBeGreaterThan(1);
  });
});

describe('addNewGroupedTask', () => {
  it('creates a real top-level task with groupId set and no parentId', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', category: 'health' })] });
    const task = useTaskStore.getState().addNewGroupedTask('g1', 'Iron');
    expect(task.groupId).toBe('g1');
    expect(task.parentId).toBeNull();
    expect(task.title).toBe('Iron');
    expect(task.category).toBe('health');
  });

  it('scopes sortOrder to siblings in the same group', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', groupId: 'g1', sortOrder: 5 })],
    });
    const task = useTaskStore.getState().addNewGroupedTask('g1', 'Second');
    expect(task.sortOrder).toBe(6);
  });
});

describe('reorderGroupChildren', () => {
  it('renumbers the children into the given order', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', groupId: 'g1', sortOrder: 1 }),
        makeTask({ id: 'b', groupId: 'g1', sortOrder: 2 }),
        makeTask({ id: 'c', groupId: 'g1', sortOrder: 3 }),
      ],
    });
    useTaskStore.getState().reorderGroupChildren('g1', ['c', 'a', 'b']);
    expect(useTaskStore.getState().groupChildrenOf('g1').map(t => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('leaves members that were not on screen where they were', () => {
    // Today renders only the members due today, so a drag there hands back a
    // subset. Renumbering just that subset 1..n would drop the members nobody
    // could see into slots they never asked for.
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'visible-1', groupId: 'g1', sortOrder: 1 }),
        makeTask({ id: 'hidden', groupId: 'g1', sortOrder: 2 }),
        makeTask({ id: 'visible-2', groupId: 'g1', sortOrder: 3 }),
      ],
    });
    useTaskStore.getState().reorderGroupChildren('g1', ['visible-2', 'visible-1']);
    expect(useTaskStore.getState().groupChildrenOf('g1').map(t => t.id))
      .toEqual(['visible-2', 'hidden', 'visible-1']);
  });

  it('does not disturb another stack', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', groupId: 'g1', sortOrder: 1 }),
        makeTask({ id: 'b', groupId: 'g1', sortOrder: 2 }),
        makeTask({ id: 'other', groupId: 'g2', sortOrder: 9 }),
      ],
    });
    useTaskStore.getState().reorderGroupChildren('g1', ['b', 'a']);
    expect(useTaskStore.getState().tasks.find(t => t.id === 'other')!.sortOrder).toBe(9);
  });
});

describe('addExistingToGroup / removeFromGroup', () => {
  it('sets groupId on an existing task', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', groupId: null })] });
    useTaskStore.getState().addExistingToGroup('t1', 'g1');
    expect(useTaskStore.getState().tasks[0].groupId).toBe('g1');
  });

  it('clears groupId, returning the task to standalone', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', groupId: 'g1' })] });
    useTaskStore.getState().removeFromGroup('t1');
    expect(useTaskStore.getState().tasks[0].groupId).toBeNull();
  });

  it('adopts the stack’s category on join', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', category: 'Home' })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', groupId: null, category: 'Work' })] });
    useTaskStore.getState().addExistingToGroup('t1', 'g1');
    expect(useTaskStore.getState().tasks[0].category).toBe('Home');
  });

  it('leaves the category alone when the stack row is missing', () => {
    // A stale groupId shouldn't read as "this stack has no category" and
    // quietly erase the field.
    useTaskGroupStore.setState({ groups: [] });
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', groupId: null, category: 'Work' })] });
    useTaskStore.getState().addExistingToGroup('t1', 'gone');
    expect(useTaskStore.getState().tasks[0].category).toBe('Work');
  });

  it('undoes the join and the category together', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', category: 'Home' })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', groupId: null, category: 'Work' })] });
    useTaskStore.getState().addExistingToGroup('t1', 'g1');
    useTaskStore.getState().undoLastAction();
    const task = useTaskStore.getState().tasks[0];
    expect(task.groupId).toBeNull();
    expect(task.category).toBe('Work');
  });

  it('keeps the inherited category after leaving the stack', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', category: 'Home' })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', groupId: 'g1', category: 'Home' })] });
    useTaskStore.getState().removeFromGroup('t1');
    expect(useTaskStore.getState().tasks[0].category).toBe('Home');
  });
});

describe('applyGroupCategory', () => {
  it('re-files every live member under the stack’s category', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', groupId: 'g1', category: 'Work' }),
        makeTask({ id: 'b', groupId: 'g1', category: null }),
        makeTask({ id: 'outside', groupId: null, category: 'Work' }),
      ],
    });
    useTaskStore.getState().applyGroupCategory('g1', 'Home');
    const byId = (id: string) => useTaskStore.getState().tasks.find(t => t.id === id);
    expect(byId('a')?.category).toBe('Home');
    expect(byId('b')?.category).toBe('Home');
    expect(byId('outside')?.category).toBe('Work');
  });

  it('leaves completed occurrences on the category they were finished under', () => {
    // Roster-scoped, like every other stack cascade: the Logbook and the
    // by-category stats are history and mustn't be rewritten underneath.
    const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'live', groupId: 'g1', category: 'Work', sortOrder: 1 }),
        makeTask({ id: 'old-1', groupId: 'g1', category: 'Work', completed: true, completedAt: daysAgo(1), sortOrder: 1 }),
        makeTask({ id: 'old-2', groupId: 'g1', category: 'Work', completed: true, completedAt: daysAgo(2), sortOrder: 1 }),
      ],
    });
    useTaskStore.getState().applyGroupCategory('g1', 'Home');
    const byId = (id: string) => useTaskStore.getState().tasks.find(t => t.id === id);
    expect(byId('live')?.category).toBe('Home');
    expect(byId('old-1')?.category).toBe('Work');
    expect(byId('old-2')?.category).toBe('Work');
  });

  it('returns the prior values so the whole cascade undoes as one', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', groupId: 'g1', category: 'Work' }),
        makeTask({ id: 'b', groupId: 'g1', category: null }),
      ],
    });
    const previous = useTaskStore.getState().applyGroupCategory('g1', 'Home');
    expect(previous).toEqual([
      { id: 'a', category: 'Work' },
      { id: 'b', category: null },
    ]);
    previous.forEach(p => useTaskStore.getState().updateTask(p.id, { category: p.category }));
    const byId = (id: string) => useTaskStore.getState().tasks.find(t => t.id === id);
    expect(byId('a')?.category).toBe('Work');
    expect(byId('b')?.category).toBeNull();
  });

  it('does nothing when every member already matches', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', groupId: 'g1', category: 'Home' })] });
    expect(useTaskStore.getState().applyGroupCategory('g1', 'Home')).toEqual([]);
  });
});

describe('groupTasks', () => {
  it('creates a group and assigns every given task to it', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' })],
    });
    const group = useTaskStore.getState().groupTasks(['a', 'b'], 'Take supplements', 'health');
    expect(group.title).toBe('Take supplements');
    expect(group.category).toBe('health');
    expect(useTaskGroupStore.getState().groups).toContainEqual(group);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'a')?.groupId).toBe(group.id);
    expect(tasks.find(t => t.id === 'b')?.groupId).toBe(group.id);
    expect(tasks.find(t => t.id === 'c')?.groupId).toBeNull();
  });

  it('opens no transaction of its own', () => {
    // applyTemplate calls this from inside a dbTransaction, and expo-sqlite's
    // withTransactionSync can't nest — a transaction here would throw on
    // device while this suite, which mocks dbTransaction, stayed green.
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' })] });
    (dbTransaction as jest.Mock).mockClear();
    useTaskStore.getState().groupTasks(['a'], 'Take supplements', 'health');
    expect(dbTransaction).not.toHaveBeenCalled();
  });

  it('puts every member on the new stack’s category', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', category: 'Work' }), makeTask({ id: 'b', category: null })],
    });
    useTaskStore.getState().groupTasks(['a', 'b'], 'Take supplements', 'health');
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'a')?.category).toBe('health');
    expect(tasks.find(t => t.id === 'b')?.category).toBe('health');
  });
});

describe('completeGroup', () => {
  it('completes every incomplete child', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', groupId: 'g1', completed: false, recurrenceType: 'none' }),
        makeTask({ id: 'b', groupId: 'g1', completed: false, recurrenceType: 'none' }),
      ],
    });
    useTaskStore.getState().completeGroup('g1');
    expect(useTaskStore.getState().tasks.every(t => t.completed)).toBe(true);
  });

  it('runs its writes inside a single db transaction', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', groupId: 'g1', completed: false, recurrenceType: 'none' }),
        makeTask({ id: 'b', groupId: 'g1', completed: false, recurrenceType: 'none' }),
      ],
    });
    useTaskStore.getState().completeGroup('g1');
    expect(dbTransaction).toHaveBeenCalledTimes(1);
  });

  it('never force-completes a child not yet due (mismatched recurrence cadence)', () => {
    const farFuture = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'due-today', groupId: 'g1', completed: false, recurrenceType: 'none' }),
        makeTask({ id: 'not-due', groupId: 'g1', completed: false, recurrenceType: 'weekly', dueDate: farFuture }),
      ],
    });
    useTaskStore.getState().completeGroup('g1');
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'due-today')?.completed).toBe(true);
    expect(tasks.find(t => t.id === 'not-due')?.completed).toBe(false);
  });

  it('skips children already completed and does nothing if none were newly completed', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', groupId: 'g1', completed: true, completedAt: 'now' })],
    });
    useTaskStore.getState().completeGroup('g1');
    expect(useTaskStore.getState().lastAction).toBeNull();
  });

  it('queues one combined undo that uncompletes every child it completed', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', groupId: 'g1', completed: false, recurrenceType: 'none' }),
        makeTask({ id: 'b', groupId: 'g1', completed: false, recurrenceType: 'none' }),
      ],
    });
    useTaskStore.getState().completeGroup('g1');
    expect(useTaskStore.getState().lastAction?.label).toBe('2 tasks completed');
    useTaskStore.getState().lastAction?.undo();
    expect(useTaskStore.getState().tasks.every(t => !t.completed)).toBe(true);
  });
});

describe('uncompleteGroup', () => {
  it('uncompletes every child completed today', () => {
    const today = new Date().toISOString();
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', groupId: 'g1', completed: true, completedAt: today }),
        makeTask({ id: 'b', groupId: 'g1', completed: true, completedAt: today }),
      ],
    });
    useTaskStore.getState().uncompleteGroup('g1');
    expect(useTaskStore.getState().tasks.every(t => !t.completed)).toBe(true);
  });

  it('does nothing when no children are completed', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', groupId: 'g1', completed: false })],
    });
    useTaskStore.getState().uncompleteGroup('g1');
    expect(useTaskStore.getState().lastAction).toBeNull();
  });

  it('leaves children completed on a previous day untouched (recurring history piling up under the same groupId)', () => {
    const today = new Date().toISOString();
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'today', groupId: 'g1', completed: true, completedAt: today }),
        makeTask({ id: 'old-1', groupId: 'g1', completed: true, completedAt: lastWeek }),
        makeTask({ id: 'old-2', groupId: 'g1', completed: true, completedAt: lastWeek }),
      ],
    });
    useTaskStore.getState().uncompleteGroup('g1');
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'today')?.completed).toBe(false);
    expect(tasks.find(t => t.id === 'old-1')?.completed).toBe(true);
    expect(tasks.find(t => t.id === 'old-2')?.completed).toBe(true);
  });
});

describe('a finished stack leaving Today', () => {
  // Today renders a stack exactly while one of its members is in
  // visibleTasks (see visibleGroupItems in TodayScreen) — there's no stack
  // state of its own any more, so these cover the store side of "the stack
  // goes when its last task does".
  const groupVisible = (groupId: string) =>
    useTaskStore.getState().visibleTasks().filter(t => t.groupId === groupId);

  it('has no visible member left once every member is completed', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', groupId: 'g1', dueDate: new Date().toISOString() }),
        makeTask({ id: 'b', groupId: 'g1', dueDate: new Date().toISOString() }),
      ],
    });
    useTaskStore.getState().completeTask('a');
    expect(groupVisible('g1').map(t => t.id)).toEqual(['a', 'b']);

    useTaskStore.getState().completeTask('b');
    // Both are still held so their rows can finish their completion
    // animation — the stack rides that window out with them rather than
    // disappearing a beat early.
    expect(groupVisible('g1')).toHaveLength(2);
    useTaskStore.setState({ completionHoldIds: [] });
    expect(groupVisible('g1')).toHaveLength(0);
  });

  it('comes back with a member that is uncompleted again', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.setState({
      tasks: [makeTask({
        id: 'a', groupId: 'g1', dueDate: new Date().toISOString(),
        completed: true, completedAt: new Date().toISOString(),
      })],
    });
    expect(groupVisible('g1')).toHaveLength(0);
    useTaskStore.getState().uncompleteTask('a');
    expect(groupVisible('g1').map(t => t.id)).toEqual(['a']);
  });

  it('comes back tomorrow via a daily member\u2019s next occurrence', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.setState({
      tasks: [makeTask({
        id: 'a', groupId: 'g1', dueDate: new Date().toISOString(),
        recurrenceType: 'daily', recurrenceInterval: 1,
      })],
    });
    useTaskStore.getState().completeTask('a');
    useTaskStore.setState({ completionHoldIds: [] });
    // The spawned occurrence is due tomorrow, so nothing is visible today...
    expect(groupVisible('g1')).toHaveLength(0);
    const next = useTaskStore.getState().tasks.find(t => t.previousOccurrenceId === 'a');
    expect(next).toBeDefined();
    // ...but it is a member with a date, which is all it takes for the stack
    // to render again once that date arrives.
    expect(next!.groupId).toBe('g1');
    expect(next!.completed).toBe(false);
  });
});

describe('deferGroup', () => {
  it('defers every child without touching recurrence fields', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', groupId: 'g1', recurrenceType: 'weekly', recurrenceInterval: 3 }),
        makeTask({ id: 'b', groupId: 'g1', recurrenceType: 'none' }),
      ],
    });
    const until = new Date('2025-06-01T12:00:00.000Z');
    useTaskStore.getState().deferGroup('g1', until);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'a')?.deferUntil).toBe(until.toISOString());
    expect(tasks.find(t => t.id === 'a')?.recurrenceType).toBe('weekly');
    expect(tasks.find(t => t.id === 'a')?.recurrenceInterval).toBe(3);
    expect(tasks.find(t => t.id === 'b')?.deferUntil).toBe(until.toISOString());
  });
});

describe('pinGroup', () => {
  it('pins every child when none are pinned', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', groupId: 'g1', pinned: false }),
        makeTask({ id: 'b', groupId: 'g1', pinned: false }),
      ],
    });
    useTaskStore.getState().pinGroup('g1');
    expect(useTaskStore.getState().tasks.every(t => t.pinned)).toBe(true);
  });

  it('unpins every child when all are already pinned', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', groupId: 'g1', pinned: true }),
        makeTask({ id: 'b', groupId: 'g1', pinned: true }),
      ],
    });
    useTaskStore.getState().pinGroup('g1');
    expect(useTaskStore.getState().tasks.every(t => !t.pinned)).toBe(true);
  });

  it('leaves past completed occurrences alone', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'live', groupId: 'g1', dueDate: new Date().toISOString(), pinned: false }),
        makeTask({
          id: 'old', groupId: 'g1', pinned: false,
          completed: true, completedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        }),
      ],
    });
    useTaskStore.getState().pinGroup('g1');
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'live')?.pinned).toBe(true);
    expect(tasks.find(t => t.id === 'old')?.pinned).toBe(false);
  });
});

describe('deleteGroup', () => {
  it('orphans children (cascade: false) — they become standalone tasks', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', groupId: 'g1' }), makeTask({ id: 'b', groupId: 'g1' })],
    });
    useTaskStore.getState().deleteGroup('g1', { cascade: false });
    expect(useTaskStore.getState().tasks.every(t => t.groupId === null)).toBe(true);
    expect(useTaskStore.getState().tasks).toHaveLength(2);
    expect(useTaskGroupStore.getState().groups).toHaveLength(0);
  });

  it('deletes children too (cascade: true)', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', groupId: 'g1' }), makeTask({ id: 'keep', groupId: null })],
    });
    useTaskStore.getState().deleteGroup('g1', { cascade: true });
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['keep']);
    expect(useTaskGroupStore.getState().groups).toHaveLength(0);
  });

  it('runs its cascade writes inside a single db transaction', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', groupId: 'g1' }), makeTask({ id: 'b', groupId: 'g1' })],
    });
    useTaskStore.getState().deleteGroup('g1', { cascade: true });
    expect(dbTransaction).toHaveBeenCalledTimes(1);
  });

  it('queues an undo that restores the group and its orphaned children', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', title: 'Supplements' })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', groupId: 'g1' })] });
    useTaskStore.getState().deleteGroup('g1', { cascade: false });
    useTaskStore.getState().lastAction?.undo();
    expect(useTaskGroupStore.getState().groups.map(g => g.id)).toEqual(['g1']);
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.groupId).toBe('g1');
  });

  it('queues an undo that restores the group and cascade-deleted children', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', groupId: 'g1', title: 'Iron' })] });
    useTaskStore.getState().deleteGroup('g1', { cascade: true });
    useTaskStore.getState().lastAction?.undo();
    expect(useTaskGroupStore.getState().groups.map(g => g.id)).toEqual(['g1']);
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['a']);
  });

  it('cascade-deletes the live members but keeps completed occurrences as history', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'live', groupId: 'g1', dueDate: new Date().toISOString() }),
        makeTask({
          id: 'old', groupId: 'g1', title: 'Floss',
          completed: true, completedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        }),
      ],
    });
    useTaskStore.getState().deleteGroup('g1', { cascade: true });
    const { tasks } = useTaskStore.getState();
    // Deleting a stack you've run nightly for a year must not erase a year of
    // Logbook entries — the past occurrences are only unfiled.
    expect(tasks.map(t => t.id)).toEqual(['old']);
    expect(tasks[0].groupId).toBeNull();
    expect(tasks[0].completed).toBe(true);
  });

  // The roster names one row per member and a dated series has several, so
  // cascading over roster ids alone deleted the date that spoke for the member
  // and left the rest of the set behind, loose and unfiled.
  it('cascade-deletes every live date of a series member, not just the one in the roster', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.setState({ tasks: [] });
    useTaskStore.getState().addTaskSeries(
      { title: 'Walk the dog', groupId: 'g1' },
      [new Date(2025, 5, 10, 12), new Date(2025, 5, 15, 12)],
    );
    expect(useTaskStore.getState().groupRosterOf('g1')).toHaveLength(1);

    useTaskStore.getState().deleteGroup('g1', { cascade: true });
    expect(useTaskStore.getState().tasks).toEqual([]);
  });

  it('still keeps a series member’s completed and archived dates as history', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.setState({ tasks: [] });
    const rows = useTaskStore.getState().addTaskSeries(
      { title: 'Walk the dog', groupId: 'g1' },
      [new Date(2025, 5, 1, 12), new Date(2025, 5, 10, 12), new Date(2025, 5, 15, 12)],
    );
    useTaskStore.setState({
      tasks: useTaskStore.getState().tasks.map(t =>
        t.id === rows[0].id ? { ...t, completed: true, completedAt: new Date(2025, 5, 1, 13).toISOString() }
        : t.id === rows[1].id ? { ...t, archived: true, archivedAt: new Date(2025, 5, 9).toISOString() }
        : t
      ),
    });

    useTaskStore.getState().deleteGroup('g1', { cascade: true });
    const { tasks } = useTaskStore.getState();
    expect(tasks.map(t => t.id).sort()).toEqual([rows[0].id, rows[1].id].sort());
    expect(tasks.every(t => t.groupId === null)).toBe(true);
  });
});

// ─── bulk operations ─────────────────────────────────────────────────────────

describe('bulkDeleteTasks', () => {
  it('removes all specified tasks from state', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' })],
    });
    useTaskStore.getState().bulkDeleteTasks(['a', 'b']);
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['c']);
  });

  it('also removes subtasks of deleted tasks', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'parent' }), makeTask({ id: 'child', parentId: 'parent' })],
    });
    useTaskStore.getState().bulkDeleteTasks(['parent']);
    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  it('calls dbBulkDeleteTasks and cancels reminders for tasks that have one', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', reminderTime: '2025-06-01T09:00:00.000Z' }),
        makeTask({ id: 'b' }),
      ],
    });
    useTaskStore.getState().bulkDeleteTasks(['a', 'b']);
    expect(dbBulkDeleteTasks).toHaveBeenCalledWith(['a', 'b']);
    expect(cancelTaskReminder).toHaveBeenCalledWith('a');
    expect(cancelTaskReminder).not.toHaveBeenCalledWith('b');
  });

  it('does nothing for an empty id list', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' })] });
    useTaskStore.getState().bulkDeleteTasks([]);
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(dbBulkDeleteTasks).not.toHaveBeenCalled();
  });

  it('queues an undo action that restores all deleted tasks', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' })],
    });
    useTaskStore.getState().bulkDeleteTasks(['a', 'b']);

    const lastAction = useTaskStore.getState().lastAction;
    expect(lastAction?.label).toBe('2 tasks deleted');
    lastAction?.undo();

    expect(useTaskStore.getState().tasks.map(t => t.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('clearLogbook', () => {
  it('deletes every completed task but leaves incomplete ones', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', completed: true, completedAt: '2026-01-01T00:00:00.000Z' }),
        makeTask({ id: 'b', completed: true, completedAt: '2026-01-02T00:00:00.000Z' }),
        makeTask({ id: 'c', completed: false }),
      ],
    });
    useTaskStore.getState().clearLogbook();
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['c']);
  });

  it('does nothing when the logbook is empty', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', completed: false })] });
    useTaskStore.getState().clearLogbook();
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(dbBulkDeleteTasks).not.toHaveBeenCalled();
  });

  it('queues an undo, labeled for the logbook, that restores the completed tasks', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', completed: true, completedAt: '2026-01-01T00:00:00.000Z' }),
        makeTask({ id: 'b', completed: true, completedAt: '2026-01-02T00:00:00.000Z' }),
      ],
    });
    useTaskStore.getState().clearLogbook();

    const lastAction = useTaskStore.getState().lastAction;
    expect(lastAction?.label).toBe('Logbook cleared');
    lastAction?.undo();

    expect(useTaskStore.getState().tasks.map(t => t.id).sort()).toEqual(['a', 'b']);
  });
});

describe('bulkCompleteTasks', () => {
  it('completes every specified task', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', recurrenceType: 'none' }), makeTask({ id: 'b', recurrenceType: 'none' })],
    });
    useTaskStore.getState().bulkCompleteTasks(['a', 'b']);
    expect(useTaskStore.getState().tasks.every(t => t.completed)).toBe(true);
  });

  it('runs its writes inside a single db transaction', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', recurrenceType: 'none' }), makeTask({ id: 'b', recurrenceType: 'none' })],
    });
    useTaskStore.getState().bulkCompleteTasks(['a', 'b']);
    expect(dbTransaction).toHaveBeenCalledTimes(1);
  });

  it('queues an undo action that uncompletes every specified task', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', recurrenceType: 'none' }), makeTask({ id: 'b', recurrenceType: 'none' })],
    });
    useTaskStore.getState().bulkCompleteTasks(['a', 'b']);

    const lastAction = useTaskStore.getState().lastAction;
    expect(lastAction?.label).toBe('2 tasks completed');
    lastAction?.undo();

    expect(useTaskStore.getState().tasks.every(t => !t.completed)).toBe(true);
  });

  it('does nothing for an empty id list', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' })] });
    useTaskStore.getState().bulkCompleteTasks([]);
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

describe('bulkMarkMissed', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 10, 0, 0)); // June 10, 2025 10:00 AM
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const recurring = (id: string, overrides: Partial<Task> = {}) => makeTask({
    id,
    recurrenceType: 'daily',
    recurrenceInterval: 1,
    dueDate: new Date(2025, 5, 10, 9, 0, 0).toISOString(),
    ...overrides,
  });

  it('marks every recurring task in the selection missed', () => {
    useTaskStore.setState({ tasks: [recurring('a'), recurring('b')] });
    useTaskStore.getState().bulkMarkMissed(['a', 'b']);
    const tasks = useTaskStore.getState().tasks;
    expect(tasks.find(t => t.id === 'a')?.missedAt).not.toBeNull();
    expect(tasks.find(t => t.id === 'b')?.missedAt).not.toBeNull();
  });

  it('runs its writes inside a single db transaction', () => {
    useTaskStore.setState({ tasks: [recurring('a'), recurring('b')] });
    useTaskStore.getState().bulkMarkMissed(['a', 'b']);
    expect(dbTransaction).toHaveBeenCalledTimes(1);
  });

  // Same per-task guard as markMissed itself — a mixed selection just skips
  // whatever doesn't qualify rather than needing its own filtering here.
  it('skips non-recurring tasks in a mixed selection', () => {
    useTaskStore.setState({
      tasks: [recurring('a'), makeTask({ id: 'b', recurrenceType: 'none' })],
    });
    useTaskStore.getState().bulkMarkMissed(['a', 'b']);
    expect(useTaskStore.getState().lastAction?.label).toBe('1 task marked missed');
    expect(useTaskStore.getState().tasks.find(t => t.id === 'b')?.missedAt).toBeNull();
  });

  it('queues an undo that restores every marked task', () => {
    useTaskStore.setState({ tasks: [recurring('a'), recurring('b')] });
    useTaskStore.getState().bulkMarkMissed(['a', 'b']);

    const lastAction = useTaskStore.getState().lastAction;
    expect(lastAction?.label).toBe('2 tasks marked missed');
    lastAction?.undo();

    const tasks = useTaskStore.getState().tasks;
    expect(tasks.find(t => t.id === 'a')?.missedAt).toBeNull();
    expect(tasks.find(t => t.id === 'b')?.missedAt).toBeNull();
  });

  it('does nothing for an empty id list', () => {
    useTaskStore.setState({ tasks: [recurring('a')] });
    useTaskStore.getState().bulkMarkMissed([]);
    expect(useTaskStore.getState().lastAction).toBeNull();
  });

  it('leaves no undo when nothing in the selection qualified', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', recurrenceType: 'none' })] });
    useTaskStore.getState().bulkMarkMissed(['a']);
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

describe('bulkUncompleteTasks', () => {
  it('uncompletes every specified task', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', completed: true, completedAt: '2024-01-01T10:00:00.000Z' }),
        makeTask({ id: 'b', completed: true, completedAt: '2024-01-01T11:00:00.000Z' }),
      ],
    });
    useTaskStore.getState().bulkUncompleteTasks(['a', 'b']);
    expect(useTaskStore.getState().tasks.every(t => !t.completed && t.completedAt === null)).toBe(true);
  });

  it('runs its writes inside a single db transaction', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', completed: true, completedAt: '2024-01-01T10:00:00.000Z' }),
        makeTask({ id: 'b', completed: true, completedAt: '2024-01-01T11:00:00.000Z' }),
      ],
    });
    useTaskStore.getState().bulkUncompleteTasks(['a', 'b']);
    expect(dbTransaction).toHaveBeenCalledTimes(1);
  });

  it('skips ids that are not completed', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', completed: true, completedAt: '2024-01-01T10:00:00.000Z' }),
        makeTask({ id: 'b', completed: false }),
      ],
    });
    useTaskStore.getState().bulkUncompleteTasks(['a', 'b']);
    expect(useTaskStore.getState().lastAction?.label).toBe('1 task uncompleted');
  });

  // The undo replays each uncompleteTask's own restore closure, so a
  // completion comes back with the exact timestamp and streak it had — not a
  // fresh one recomputed off "now" the way completeTask would.
  it('queues one undo that restores every completion as it was', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', completed: true, completedAt: '2024-01-01T10:00:00.000Z', streakCount: 4 }),
        makeTask({ id: 'b', completed: true, completedAt: '2024-01-01T11:00:00.000Z', streakCount: 2 }),
      ],
    });
    useTaskStore.getState().bulkUncompleteTasks(['a', 'b']);

    const lastAction = useTaskStore.getState().lastAction;
    expect(lastAction?.label).toBe('2 tasks uncompleted');
    lastAction?.undo();

    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'a')).toMatchObject({
      completed: true,
      completedAt: '2024-01-01T10:00:00.000Z',
      streakCount: 4,
    });
    expect(tasks.find(t => t.id === 'b')).toMatchObject({
      completed: true,
      completedAt: '2024-01-01T11:00:00.000Z',
      streakCount: 2,
    });
  });

  it('does nothing for an empty id list', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', completed: true })] });
    useTaskStore.getState().bulkUncompleteTasks([]);
    expect(useTaskStore.getState().lastAction).toBeNull();
  });

  it('leaves no undo when nothing in the selection was completed', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', completed: false })] });
    useTaskStore.getState().bulkUncompleteTasks(['a']);
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

describe('bulkSetPriority', () => {
  it('updates priority on all specified tasks', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', priority: 0 }), makeTask({ id: 'b', priority: 0 })],
    });
    useTaskStore.getState().bulkSetPriority(['a', 'b'], 3);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'a')?.priority).toBe(3);
    expect(tasks.find(t => t.id === 'b')?.priority).toBe(3);
  });

  it('does not affect unselected tasks', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', priority: 0 }), makeTask({ id: 'b', priority: 0 })],
    });
    useTaskStore.getState().bulkSetPriority(['a'], 2);
    expect(useTaskStore.getState().tasks.find(t => t.id === 'b')?.priority).toBe(0);
  });

  it('calls dbBulkSetPriority', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' })] });
    useTaskStore.getState().bulkSetPriority(['a'], 1);
    expect(dbBulkSetPriority).toHaveBeenCalledWith(['a'], 1);
  });
});

describe('bulkSetCategory', () => {
  const routines = {
    id: 'cat-routines', name: 'Routines', scheduleDays: null, scheduleStart: null, scheduleEnd: null,
    hideOnVacation: false, excludeFromPinSuggestions: false, excludeFromNewTasksBanner: true,
    defaultTimeSegments: [], sortOrder: 1, emoji: null,
  };

  const mockRoutinesCategory = () => {
    const { useCategoryStore } = jest.requireMock('../store/useCategoryStore') as { useCategoryStore: { getState: jest.Mock } };
    useCategoryStore.getState.mockReturnValue({
      categories: [routines],
      initialized: true,
      initialize: jest.fn(),
      addCategory: jest.fn(),
      deleteCategory: jest.fn(),
      restoreCategory: jest.fn(),
      renameCategory: jest.fn().mockReturnValue(true),
      setCategorySchedule: jest.fn(),
      removeCategorySchedule: jest.fn(),
      getCategoryByName: jest.fn((name: string) => (name === 'Routines' ? routines : null)),
    });
  };

  it('files every specified task under the new category', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b' })] });
    useTaskStore.getState().bulkSetCategory(['a', 'b'], 'Home');
    const { tasks } = useTaskStore.getState();
    expect(tasks.every(t => t.category === 'Home')).toBe(true);
    expect(dbBulkSetCategory).toHaveBeenCalledWith(['a', 'b'], 'Home');
  });

  // Same rule as updateTask's: see the "moving a task to another category"
  // block above for why the old category left a stale seenAt behind.
  it('marks a task seen when the move out of a suppressing category would make it new', () => {
    mockRoutinesCategory();
    useTaskStore.setState({
      tasks: [makeTask({
        id: 'a', category: 'Routines',
        dueDate: new Date().toISOString(), seenAt: '2020-01-01T00:00:00.000Z',
      })],
    });

    useTaskStore.getState().bulkSetCategory(['a'], 'Home');

    const moved = useTaskStore.getState().tasks[0];
    expect(moved.seenAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(isTaskNew(moved)).toBe(false);
  });

  it('leaves a task that was already new alone', () => {
    mockRoutinesCategory();
    useTaskStore.setState({
      tasks: [makeTask({
        id: 'a', category: 'Errands',
        dueDate: new Date().toISOString(), seenAt: '2020-01-01T00:00:00.000Z',
      })],
    });

    useTaskStore.getState().bulkSetCategory(['a'], 'Home');

    expect(useTaskStore.getState().tasks[0].seenAt).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('bulkTogglePin', () => {
  it('pins the whole selection when only some of it is pinned', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', pinned: false }),
        makeTask({ id: 'b', pinned: true }),
        makeTask({ id: 'c', pinned: false }),
      ],
    });
    useTaskStore.getState().bulkTogglePin(['a', 'b']);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'a')?.pinned).toBe(true);
    expect(tasks.find(t => t.id === 'b')?.pinned).toBe(true);
    expect(tasks.find(t => t.id === 'c')?.pinned).toBe(false);
    expect(dbBulkSetPinned).toHaveBeenCalledWith(['a', 'b'], true);
  });

  it('unpins the selection when every task in it is already pinned', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', pinned: true }), makeTask({ id: 'b', pinned: true })],
    });
    useTaskStore.getState().bulkTogglePin(['a', 'b']);
    expect(useTaskStore.getState().tasks.every(t => !t.pinned)).toBe(true);
    expect(dbBulkSetPinned).toHaveBeenCalledWith(['a', 'b'], false);
  });

  it('does nothing for an empty selection', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', pinned: false })] });
    useTaskStore.getState().bulkTogglePin([]);
    expect(dbBulkSetPinned).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks[0].pinned).toBe(false);
  });
});

describe('bulkDefer', () => {
  it('sets deferUntil on all specified tasks', () => {
    const until = new Date(2025, 5, 20);
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b' })],
    });
    useTaskStore.getState().bulkDefer(['a', 'b'], until);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'a')?.deferUntil).toBe(until.toISOString());
    expect(tasks.find(t => t.id === 'b')?.deferUntil).toBe(until.toISOString());
  });

  it('calls dbBulkSetDefer', () => {
    const until = new Date(2025, 5, 20);
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' })] });
    useTaskStore.getState().bulkDefer(['a'], until);
    expect(dbBulkSetDefer).toHaveBeenCalledWith(['a'], until.toISOString());
  });
});

describe('bulkAddTags', () => {
  it('merges new tags into existing tags', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', tags: ['work'] })] });
    useTaskStore.getState().bulkAddTags(['a'], ['urgent', 'focus']);
    expect(useTaskStore.getState().tasks[0].tags).toEqual(['work', 'urgent', 'focus']);
  });

  it('deduplicates tags', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', tags: ['work'] })] });
    useTaskStore.getState().bulkAddTags(['a'], ['work', 'new']);
    expect(useTaskStore.getState().tasks[0].tags).toEqual(['work', 'new']);
  });

  it('does nothing for empty ids or empty tags', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', tags: ['work'] })] });
    useTaskStore.getState().bulkAddTags([], ['new']);
    useTaskStore.getState().bulkAddTags(['a'], []);
    expect(dbBulkAddTags).not.toHaveBeenCalled();
  });
});

describe('markTasksSeen', () => {
  it('sets seenAt on every specified task', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', seenAt: null }), makeTask({ id: 'b', seenAt: null }), makeTask({ id: 'c', seenAt: null })],
    });
    useTaskStore.getState().markTasksSeen(['a', 'b']);
    const tasks = useTaskStore.getState().tasks;
    expect(tasks.find(t => t.id === 'a')?.seenAt).not.toBeNull();
    expect(tasks.find(t => t.id === 'b')?.seenAt).not.toBeNull();
    expect(tasks.find(t => t.id === 'c')?.seenAt).toBeNull();
  });

  it('calls dbMarkTaskSeen for each id', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b' })] });
    useTaskStore.getState().markTasksSeen(['a', 'b']);
    expect(dbMarkTaskSeen).toHaveBeenCalledWith('a', expect.any(String));
    expect(dbMarkTaskSeen).toHaveBeenCalledWith('b', expect.any(String));
  });

  it('does nothing for an empty id list', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', seenAt: null })] });
    useTaskStore.getState().markTasksSeen([]);
    expect(dbMarkTaskSeen).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks[0].seenAt).toBeNull();
  });
});

// ─── selectors ───────────────────────────────────────────────────────────────

describe('visibleTasks', () => {
  it('returns non-completed, non-subtask tasks sorted by sortOrder', () => {
    const dueToday = new Date().toISOString();
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'b', sortOrder: 2, dueDate: dueToday }),
        makeTask({ id: 'a', sortOrder: 1, dueDate: dueToday }),
      ],
    });
    const visible = useTaskStore.getState().visibleTasks();
    expect(visible.map(t => t.id)).toEqual(['a', 'b']);
  });

  it('excludes completed tasks', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', completed: true, completedAt: 'now' })] });
    expect(useTaskStore.getState().visibleTasks()).toHaveLength(0);
  });

  it('excludes subtasks', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', parentId: 'parent' })] });
    expect(useTaskStore.getState().visibleTasks()).toHaveLength(0);
  });
});

describe('pinnedTasks', () => {
  it('returns pinned, non-completed, non-subtask tasks sorted by sortOrder', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'f2', pinned: true, sortOrder: 2 }),
        makeTask({ id: 'f1', pinned: true, sortOrder: 1 }),
        makeTask({ id: 'n1', pinned: false }),
      ],
    });
    const pinned = useTaskStore.getState().pinnedTasks();
    expect(pinned.map(t => t.id)).toEqual(['f1', 'f2']);
  });

  it('excludes completed pinned tasks', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', pinned: true, completed: true, completedAt: 'now' })],
    });
    expect(useTaskStore.getState().pinnedTasks()).toHaveLength(0);
  });
});

describe('deferredTasks', () => {
  it('returns deferred, non-subtask tasks sorted by sortOrder', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'b', sortOrder: 2, deferUntil: future.toISOString() }),
        makeTask({ id: 'a', sortOrder: 1, deferUntil: future.toISOString() }),
      ],
    });
    const deferred = useTaskStore.getState().deferredTasks();
    expect(deferred.map(t => t.id)).toEqual(['a', 'b']);
  });

  it('excludes tasks that are not deferred', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', deferUntil: null })] });
    expect(useTaskStore.getState().deferredTasks()).toHaveLength(0);
  });

  it('excludes subtasks', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', parentId: 'parent', deferUntil: future.toISOString() })],
    });
    expect(useTaskStore.getState().deferredTasks()).toHaveLength(0);
  });
});

describe('vacationHiddenTasks', () => {
  const settingsStoreMock = () => {
    const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as { useSettingsStore: { getState: jest.Mock } };
    return useSettingsStore;
  };

  const enableVacationMode = () => {
    settingsStoreMock().getState.mockReturnValue({
      ...settingsStoreMock().getState(),
      vacationMode: true,
    });
  };

  // #1753: this used to be every vacation-paused/vacation-hidden-category task
  // that exists, not just the ones that would otherwise be on Today.
  it('includes a vacation-paused task that is due today', () => {
    enableVacationMode();
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', vacationPause: true, dueDate: new Date().toISOString() })],
    });
    expect(useTaskStore.getState().vacationHiddenTasks().map(t => t.id)).toEqual(['t1']);
  });

  it('excludes a vacation-paused task deferred to a future day', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    enableVacationMode();
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', vacationPause: true, deferUntil: future.toISOString() })],
    });
    expect(useTaskStore.getState().vacationHiddenTasks()).toHaveLength(0);
  });

  it('excludes a vacation-paused task with no date signal', () => {
    enableVacationMode();
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', vacationPause: true })],
    });
    expect(useTaskStore.getState().vacationHiddenTasks()).toHaveLength(0);
  });

  it('excludes non-paused tasks', () => {
    enableVacationMode();
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', dueDate: new Date().toISOString() })],
    });
    expect(useTaskStore.getState().vacationHiddenTasks()).toHaveLength(0);
  });
});

describe('expiredTasks', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 14, 0, 0)); // 2:00 PM
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns non-subtask tasks whose time window has closed, sorted by sortOrder', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', sortOrder: 2, windowStart: '08:00', windowEnd: '13:00' }),
        makeTask({ id: 'b', sortOrder: 1, windowStart: '08:00', windowEnd: '13:00' }),
      ],
    });
    expect(useTaskStore.getState().expiredTasks().map(t => t.id)).toEqual(['b', 'a']);
  });

  it('excludes tasks whose window has not closed yet', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', windowStart: '08:00', windowEnd: '18:00' })] });
    expect(useTaskStore.getState().expiredTasks()).toHaveLength(0);
  });

  it('excludes subtasks', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', parentId: 'parent', windowStart: '08:00', windowEnd: '13:00' })],
    });
    expect(useTaskStore.getState().expiredTasks()).toHaveLength(0);
  });
});

describe('sweepExpiredTasks', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 14, 0, 0)); // 2:00 PM
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const settingsStoreMock = () => {
    const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as { useSettingsStore: { getState: jest.Mock } };
    return useSettingsStore;
  };

  it('leaves expired tasks in place when the setting is Never', () => {
    settingsStoreMock().getState.mockReturnValue({
      dayResetTime: '00:00',
      autoArchiveProjectsOnComplete: false,
      autoRemoveExpiredTasks: null,
      vacationMode: false,
    });
    useTaskStore.setState({ tasks: [makeTask({ id: 'expired', windowStart: '08:00', windowEnd: '13:00' })] });
    useTaskStore.getState().sweepExpiredTasks();
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['expired']);
    expect(dbBulkDeleteTasks).not.toHaveBeenCalled();
  });

  it('deletes expired tasks when the setting is Immediately, leaving active ones', () => {
    settingsStoreMock().getState.mockReturnValue({
      dayResetTime: '00:00',
      autoArchiveProjectsOnComplete: false,
      autoRemoveExpiredTasks: 0,
      vacationMode: false,
    });
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'expired', windowStart: '08:00', windowEnd: '13:00' }),
        makeTask({ id: 'active', windowStart: '08:00', windowEnd: '18:00' }),
      ],
    });
    useTaskStore.getState().sweepExpiredTasks();
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['active']);
    expect(dbBulkDeleteTasks).toHaveBeenCalledWith(['expired']);
  });

  // Deleting the row of a recurring task ends the schedule: the next
  // occurrence is only created by completing this one. Missing a window is not
  // a decision to stop the habit.
  it('rolls an expired recurring task forward instead of deleting it', () => {
    settingsStoreMock().getState.mockReturnValue({
      dayResetTime: '00:00',
      autoArchiveProjectsOnComplete: false,
      autoRemoveExpiredTasks: 0,
      vacationMode: false,
    });
    useTaskStore.setState({
      tasks: [
        makeTask({
          id: 'gym',
          recurrenceType: 'daily',
          recurrenceInterval: 1,
          dueDate: new Date(2025, 5, 10, 12).toISOString(),
          windowStart: '06:00',
          windowEnd: '09:00',
        }),
      ],
    });
    useTaskStore.getState().sweepExpiredTasks();

    const gym = useTaskStore.getState().tasks.find(t => t.id === 'gym')!;
    expect(gym).toBeDefined();
    expect(new Date(gym.dueDate!).getDate()).toBe(11);
    expect(dbBulkDeleteTasks).not.toHaveBeenCalled();
  });

  it('still deletes a recurring task whose schedule has already run out', () => {
    settingsStoreMock().getState.mockReturnValue({
      dayResetTime: '00:00',
      autoArchiveProjectsOnComplete: false,
      autoRemoveExpiredTasks: 0,
      vacationMode: false,
    });
    useTaskStore.setState({
      tasks: [
        makeTask({
          id: 'last',
          recurrenceType: 'daily',
          recurrenceInterval: 1,
          dueDate: new Date(2025, 5, 10, 12).toISOString(),
          recurrenceEndDate: new Date(2025, 5, 10, 23).toISOString(),
          windowStart: '06:00',
          windowEnd: '09:00',
        }),
      ],
    });
    useTaskStore.getState().sweepExpiredTasks();
    expect(dbBulkDeleteTasks).toHaveBeenCalledWith(['last']);
  });

  it('spares a vacation-paused expired task while vacation mode is on', () => {
    settingsStoreMock().getState.mockReturnValue({
      dayResetTime: '00:00',
      autoArchiveProjectsOnComplete: false,
      autoRemoveExpiredTasks: 0,
      vacationMode: true,
    });
    useTaskStore.setState({
      tasks: [makeTask({ id: 'paused', windowStart: '08:00', windowEnd: '13:00', vacationPause: true })],
    });
    useTaskStore.getState().sweepExpiredTasks();
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['paused']);
    expect(dbBulkDeleteTasks).not.toHaveBeenCalled();
  });

  // ─── grace period (issue #898) ────────────────────────────────────────────

  it('leaves a just-expired task alone while its grace period has not elapsed', () => {
    settingsStoreMock().getState.mockReturnValue({
      dayResetTime: '00:00',
      autoArchiveProjectsOnComplete: false,
      autoRemoveExpiredTasks: 7, // 7-day grace period
      vacationMode: false,
    });
    // Window closed at 1pm today (2025-06-10); "now" is mocked to 2pm the same day.
    useTaskStore.setState({
      tasks: [makeTask({ id: 'expired', windowStart: '08:00', windowEnd: '13:00' })],
    });
    useTaskStore.getState().sweepExpiredTasks();
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['expired']);
    expect(dbBulkDeleteTasks).not.toHaveBeenCalled();
  });

  it('deletes a task once its grace period has elapsed past the window close', () => {
    settingsStoreMock().getState.mockReturnValue({
      dayResetTime: '00:00',
      autoArchiveProjectsOnComplete: false,
      autoRemoveExpiredTasks: 7, // 7-day grace period
      vacationMode: false,
    });
    // Window closed at 1pm on 2025-06-03; "now" is mocked to 2pm on 2025-06-10 —
    // exactly 7 days later, so the grace period has fully elapsed.
    useTaskStore.setState({
      tasks: [makeTask({
        id: 'stale',
        dueDate: new Date(2025, 5, 3, 12).toISOString(),
        windowStart: '08:00',
        windowEnd: '13:00',
      })],
    });
    useTaskStore.getState().sweepExpiredTasks();
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual([]);
    expect(dbBulkDeleteTasks).toHaveBeenCalledWith(['stale']);
  });
});

describe('purgeOldCompletedTasks', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const settingsStoreMock = () => {
    const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as { useSettingsStore: { getState: jest.Mock } };
    return useSettingsStore;
  };

  const withRetention = (completedRetentionDays: number | null) => {
    settingsStoreMock().getState.mockReturnValue({
      dayResetTime: '00:00',
      autoArchiveProjectsOnComplete: false,
      autoRemoveExpiredTasks: false,
      vacationMode: false,
      completedRetentionDays,
    });
  };

  /** A completed row stamped `daysAgo` before the mocked now. */
  const completedDaysAgo = (id: string, daysAgo: number, overrides: Partial<Task> = {}) => {
    const at = new Date(2026, 5, 1, 12, 0, 0);
    at.setDate(at.getDate() - daysAgo);
    return makeTask({ id, completed: true, completedAt: at.toISOString(), ...overrides });
  };

  it('does nothing when retention is forever', () => {
    withRetention(null);
    useTaskStore.setState({ tasks: [completedDaysAgo('ancient', 3000)] });
    expect(useTaskStore.getState().purgeOldCompletedTasks()).toBe(0);
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['ancient']);
    expect(dbBulkDeleteTasks).not.toHaveBeenCalled();
  });

  it('deletes completions past the window and keeps the rest', () => {
    withRetention(90);
    useTaskStore.setState({
      tasks: [completedDaysAgo('old', 200), completedDaysAgo('recent', 10), makeTask({ id: 'live' })],
    });
    expect(useTaskStore.getState().purgeOldCompletedTasks()).toBe(1);
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['recent', 'live']);
    expect(dbBulkDeleteTasks).toHaveBeenCalledWith(['old']);
  });

  it('drops the subtasks of a purged parent from state too', () => {
    withRetention(90);
    useTaskStore.setState({
      tasks: [
        completedDaysAgo('parent', 200),
        completedDaysAgo('sub', 200, { parentId: 'parent' }),
        makeTask({ id: 'live' }),
      ],
    });
    // Only the parent is named; SQLite's cascade takes the subtask by parent_id.
    expect(useTaskStore.getState().purgeOldCompletedTasks()).toBe(1);
    expect(dbBulkDeleteTasks).toHaveBeenCalledWith(['parent']);
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['live']);
  });

  // The tombstones behind a habit are exactly what the window is for, and the
  // streak has to survive losing them: it lives on the row still running it.
  it('clears a recurring task\'s old occurrences without touching its streak', () => {
    withRetention(90);
    useTaskStore.setState({
      tasks: [
        completedDaysAgo('occ1', 300),
        completedDaysAgo('occ2', 200, { previousOccurrenceId: 'occ1' }),
        makeTask({ id: 'live', previousOccurrenceId: 'occ2', streakCount: 42, streakDate: '2026-05-31T00:00:00.000Z' }),
      ],
    });
    expect(useTaskStore.getState().purgeOldCompletedTasks()).toBe(2);
    const [live] = useTaskStore.getState().tasks;
    expect(live.id).toBe('live');
    expect(live.streakCount).toBe(42);
  });

  it('leaves archived tasks alone', () => {
    withRetention(90);
    useTaskStore.setState({
      tasks: [completedDaysAgo('filed', 400, { archived: true, archivedAt: '2025-01-01T00:00:00.000Z' })],
    });
    expect(useTaskStore.getState().purgeOldCompletedTasks()).toBe(0);
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['filed']);
    expect(dbBulkDeleteTasks).not.toHaveBeenCalled();
  });

  // A startup purge must not be sitting under the user's first shake of the
  // session — undo is for actions they just took.
  it('does not arm shake-to-undo', () => {
    withRetention(90);
    useTaskStore.setState({ tasks: [completedDaysAgo('old', 200)], lastAction: null });
    useTaskStore.getState().purgeOldCompletedTasks();
    expect(useTaskStore.getState().lastAction).toBeNull();
  });

  it('touches the database only when something actually falls outside', () => {
    withRetention(365);
    useTaskStore.setState({ tasks: [completedDaysAgo('recent', 30)] });
    expect(useTaskStore.getState().purgeOldCompletedTasks()).toBe(0);
    expect(dbBulkDeleteTasks).not.toHaveBeenCalled();
  });
});

describe('completedTasks', () => {
  it('returns only completed non-subtask tasks with a completedAt', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'c1', completed: true, completedAt: '2025-01-01T00:00:00.000Z' }),
        makeTask({ id: 'c2', completed: false }),
        makeTask({ id: 'c3', completed: true, completedAt: '2025-01-01T00:00:00.000Z', parentId: 'p' }),
      ],
    });
    const completed = useTaskStore.getState().completedTasks();
    expect(completed.map(t => t.id)).toEqual(['c1']);
  });
});

describe('subtasksOf', () => {
  it('returns tasks whose parentId matches', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'parent' }),
        makeTask({ id: 'child1', parentId: 'parent' }),
        makeTask({ id: 'child2', parentId: 'parent' }),
        makeTask({ id: 'other', parentId: 'other-parent' }),
      ],
    });
    const subs = useTaskStore.getState().subtasksOf('parent');
    expect(subs.map(t => t.id).sort()).toEqual(['child1', 'child2']);
  });
});

describe('allTags', () => {
  it('returns sorted unique tags from all tasks', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', tags: ['work', 'urgent'] }),
        makeTask({ id: 'b', tags: ['home', 'work'] }),
      ],
    });
    expect(useTaskStore.getState().allTags()).toEqual(['home', 'urgent', 'work']);
  });

  it('returns empty array when no tags exist', () => {
    useTaskStore.setState({ tasks: [makeTask({ tags: [] })] });
    expect(useTaskStore.getState().allTags()).toEqual([]);
  });
});

describe('tasksByTag', () => {
  it('returns non-completed tasks that include the tag', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', tags: ['work'] }),
        makeTask({ id: 'b', tags: ['home'] }),
        makeTask({ id: 'c', tags: ['work'], completed: true, completedAt: 'now' }),
      ],
    });
    const tagged = useTaskStore.getState().tasksByTag('work');
    expect(tagged.map(t => t.id)).toEqual(['a']);
  });
});

// ─── Time tracking ──────────────────────────────────────────────────────────────

describe('timers', () => {
  it('startTimer sets timerStartedAt on the task', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' })] });
    useTaskStore.getState().startTimer('a');
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.timerStartedAt).not.toBeNull();
  });

  it('only one timer runs at a time — starting a second stops the first', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b' })] });
    useTaskStore.getState().startTimer('a');
    useTaskStore.getState().startTimer('b');
    const a = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    const b = useTaskStore.getState().tasks.find(t => t.id === 'b')!;
    expect(a.timerStartedAt).toBeNull();
    expect(b.timerStartedAt).not.toBeNull();
  });

  it('stopTimer records elapsed minutes as actual + estimate and clears the timer', () => {
    const started = new Date(Date.now() - 10 * 60000).toISOString(); // 10 minutes ago
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', timerStartedAt: started })] });
    useTaskStore.getState().stopTimer('a');
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.timerStartedAt).toBeNull();
    expect(task.actualMinutes).toBe(10);
    expect(task.estimatedMinutes).toBe(10);
    expect(task.effort).toBe(2); // ≤20min → XS
  });

  it('discardTimer clears the timer without recording any elapsed time', () => {
    const started = new Date(Date.now() - 10 * 60000).toISOString(); // 10 minutes ago
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', timerStartedAt: started })] });
    useTaskStore.getState().discardTimer('a');
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.timerStartedAt).toBeNull();
    expect(task.actualMinutes).toBeNull();
    expect(task.estimatedMinutes).toBeNull();
  });

  it('discardTimer is a no-op when no timer is running', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' })] });
    useTaskStore.getState().discardTimer('a');
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.timerStartedAt).toBeNull();
  });

  // Timing a task exists to correct its estimate, so a measurement replaces
  // one rather than deferring to it — a task estimated once used to keep that
  // guess however many times it was subsequently timed.
  it('stopTimer overwrites a typed estimate with what it measured', () => {
    const started = new Date(Date.now() - 10 * 60000).toISOString(); // 10 minutes ago
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', timerStartedAt: started, estimatedMinutes: 30, effort: 3 })] });
    useTaskStore.getState().stopTimer('a');
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.actualMinutes).toBe(10);
    expect(task.estimatedMinutes).toBe(10);
    expect(task.effort).toBe(2);
  });

  // The stopwatch is the only writer of actualMinutes, so a run stopped ten
  // minutes late otherwise leaves the wrong number on the task for good — and
  // since a measurement overwrites the estimate, it takes that with it.
  it('setMeasuredTime corrects the recorded time, the estimate and the effort together', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', actualMinutes: 40, estimatedMinutes: 40, effort: 3 })],
    });
    useTaskStore.getState().setMeasuredTime('a', 10);
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.actualMinutes).toBe(10);
    expect(task.estimatedMinutes).toBe(10);
    expect(task.effort).toBe(2);
  });

  it('setMeasuredTime rounds and floors the same way a measured run does', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', actualMinutes: 40 })] });
    useTaskStore.getState().setMeasuredTime('a', 0.2);
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')!.actualMinutes).toBe(1);
  });

  it('setMeasuredTime is a no-op for a task that is not there', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', actualMinutes: 40 })] });
    useTaskStore.getState().setMeasuredTime('missing', 10);
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')!.actualMinutes).toBe(40);
  });

  it('completing a task with a running timer saves the elapsed time first', () => {
    const started = new Date(Date.now() - 5 * 60000).toISOString();
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', timerStartedAt: started })] });
    useTaskStore.getState().completeTask('a');
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.completed).toBe(true);
    expect(task.actualMinutes).toBe(5);
  });

  it('carries the measured time forward to the next recurrence but resets the running timer', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', recurrenceType: 'daily', actualMinutes: 10, estimatedMinutes: 10, effort: 1 })],
    });
    useTaskStore.getState().completeTask('a');
    const next = useTaskStore.getState().tasks.find(t => !t.completed)!;
    expect(next).toBeDefined();
    expect(next.actualMinutes).toBe(10);
    expect(next.estimatedMinutes).toBe(10);
    expect(next.timerStartedAt).toBeNull();
  });

  it('carries showStreak onto the next occurrence', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', recurrenceType: 'daily', showStreak: true })],
    });
    useTaskStore.getState().completeTask('a');
    const next = useTaskStore.getState().tasks.find(t => !t.completed)!;
    expect(next.showStreak).toBe(true);
  });
});

// ─── countdowns on timed tasks ───────────────────────────────────────────────

describe('timed tasks', () => {
  it('pauseTimer banks the elapsed time without logging it as measured', () => {
    const started = new Date(Date.now() - 5 * 60000).toISOString();
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', timedMinutes: 15, timerStartedAt: started })] });
    useTaskStore.getState().pauseTimer('a');
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.timerStartedAt).toBeNull();
    expect(task.timerElapsedSeconds).toBeCloseTo(300, 0);
    expect(task.actualMinutes).toBeNull();
  });

  it('resuming after a pause continues from the banked time', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', timedMinutes: 15, timerElapsedSeconds: 300 })],
    });
    useTaskStore.getState().startTimer('a');
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.timerStartedAt).not.toBeNull();
    expect(task.timerElapsedSeconds).toBe(300); // untouched — the new segment runs on top
  });

  it('resetTimer throws away the banked time', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', timedMinutes: 15, timerElapsedSeconds: 300 })],
    });
    useTaskStore.getState().resetTimer('a');
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.timerElapsedSeconds).toBe(0);
    expect(task.timerStartedAt).toBeNull();
    expect(task.actualMinutes).toBeNull();
  });

  it('starting one timer pauses a running countdown rather than logging it', () => {
    const started = new Date(Date.now() - 5 * 60000).toISOString();
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', timedMinutes: 15, timerStartedAt: started }),
        makeTask({ id: 'b' }),
      ],
    });
    useTaskStore.getState().startTimer('b');
    const displaced = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(displaced.timerStartedAt).toBeNull();
    expect(displaced.timerElapsedSeconds).toBeCloseTo(300, 0);
    expect(displaced.actualMinutes).toBeNull(); // banked, not measured
  });

  it('starting one timer still stops (and logs) a plain stopwatch', () => {
    const started = new Date(Date.now() - 5 * 60000).toISOString();
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', timerStartedAt: started }), makeTask({ id: 'b' })],
    });
    useTaskStore.getState().startTimer('b');
    const displaced = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(displaced.actualMinutes).toBe(5);
  });

  it('completing a task logs time banked by a paused countdown', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', timedMinutes: 15, timerElapsedSeconds: 8 * 60 })],
    });
    useTaskStore.getState().completeTask('a');
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.completed).toBe(true);
    expect(task.actualMinutes).toBe(8);
    expect(task.timerElapsedSeconds).toBe(0);
  });

  it('stopTimer sums banked time and the live segment', () => {
    const started = new Date(Date.now() - 3 * 60000).toISOString();
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', timedMinutes: 15, timerElapsedSeconds: 5 * 60, timerStartedAt: started })],
    });
    useTaskStore.getState().stopTimer('a');
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.actualMinutes).toBe(8);
    expect(task.timerElapsedSeconds).toBe(0);
  });

  it('the next occurrence keeps the duration but restarts its countdown', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', recurrenceType: 'daily', timedMinutes: 15, timerElapsedSeconds: 9 * 60 }),
      ],
    });
    useTaskStore.getState().completeTask('a');
    const next = useTaskStore.getState().tasks.find(t => !t.completed)!;
    expect(next.timedMinutes).toBe(15);
    expect(next.timerElapsedSeconds).toBe(0);
    expect(next.timerStartedAt).toBeNull();
  });
});

// ─── deleteProject / addExistingToProject / removeFromProject ─────────────────

describe('deleteProject', () => {
  it('orphans member tasks (cascade: false) — they stay, just unassigned', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', projectId: 'p1' }), makeTask({ id: 'b', projectId: 'p1' })],
    });
    useTaskStore.getState().deleteProject('p1', { cascade: false });
    expect(useTaskStore.getState().tasks.every(t => t.projectId === null)).toBe(true);
    expect(useTaskStore.getState().tasks).toHaveLength(2);
    expect(useProjectStore.getState().projects).toHaveLength(0);
  });

  it('runs its cascade writes inside a single db transaction', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', projectId: 'p1' }), makeTask({ id: 'b', projectId: 'p1' })],
    });
    useTaskStore.getState().deleteProject('p1', { cascade: true });
    expect(dbTransaction).toHaveBeenCalledTimes(1);
  });

  it('deletes member tasks too (cascade: true)', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', projectId: 'p1' }), makeTask({ id: 'keep', projectId: null })],
    });
    useTaskStore.getState().deleteProject('p1', { cascade: true });
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['keep']);
    expect(useProjectStore.getState().projects).toHaveLength(0);
  });

  it('queues an undo that restores the project and its orphaned tasks', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', title: 'Summer Bucket List' })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().deleteProject('p1', { cascade: false });
    useTaskStore.getState().lastAction?.undo();
    expect(useProjectStore.getState().projects.map(p => p.id)).toEqual(['p1']);
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.projectId).toBe('p1');
  });
});

// ─── bulkDeleteProjects ─────────────────────────────────────────────────────

describe('bulkDeleteProjects', () => {
  it('deletes every selected project, unfiling their tasks (cascade: false)', () => {
    useProjectStore.setState({
      projects: [makeProject({ id: 'p1' }), makeProject({ id: 'p2' }), makeProject({ id: 'p3' })],
    });
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', projectId: 'p1' }), makeTask({ id: 'b', projectId: 'p2' })],
    });
    useTaskStore.getState().bulkDeleteProjects(['p1', 'p2'], { cascade: false });
    expect(useProjectStore.getState().projects.map(p => p.id)).toEqual(['p3']);
    expect(useTaskStore.getState().tasks.every(t => t.projectId === null)).toBe(true);
  });

  it('deletes member tasks too (cascade: true)', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })] });
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', projectId: 'p1' }),
        makeTask({ id: 'b', projectId: 'p2' }),
        makeTask({ id: 'keep', projectId: null }),
      ],
    });
    useTaskStore.getState().bulkDeleteProjects(['p1', 'p2'], { cascade: true });
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['keep']);
  });

  // The point of the action: one undo entry for the batch, not one per project
  // with only the last one reachable.
  it('queues a single undo that brings every project back', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })], lastAction: null });
    useTaskStore.getState().bulkDeleteProjects(['p1', 'p2'], { cascade: false });
    expect(useTaskStore.getState().lastAction?.label).toBe('2 projects deleted');
    useTaskStore.getState().undoLastAction();
    expect(useProjectStore.getState().projects.map(p => p.id).sort()).toEqual(['p1', 'p2']);
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.projectId).toBe('p1');
  });

  it('ignores unknown ids rather than banking the previous action as an undo', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({ tasks: [], lastAction: null });
    useTaskStore.getState().bulkDeleteProjects(['missing'], { cascade: false });
    expect(useProjectStore.getState().projects).toHaveLength(1);
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

// ─── bulkSetProjectArchived ─────────────────────────────────────────────────

describe('bulkSetProjectArchived', () => {
  it('archives every selected project under one undo entry', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })] });
    useTaskStore.setState({ lastAction: null });
    useTaskStore.getState().bulkSetProjectArchived(['p1', 'p2'], true);
    expect(useProjectStore.getState().projects.every(p => p.archived)).toBe(true);
    expect(useTaskStore.getState().lastAction?.label).toBe('2 projects archived');
    useTaskStore.getState().undoLastAction();
    expect(useProjectStore.getState().projects.every(p => !p.archived)).toBe(true);
  });

  it('undoing an unarchive gives each project its original archivedAt back', () => {
    useProjectStore.setState({
      projects: [
        makeProject({ id: 'p1', archived: true, archivedAt: '2025-01-01T00:00:00.000Z' }),
        makeProject({ id: 'p2', archived: true, archivedAt: '2025-02-02T00:00:00.000Z' }),
      ],
    });
    useTaskStore.setState({ lastAction: null });
    useTaskStore.getState().bulkSetProjectArchived(['p1', 'p2'], false);
    useTaskStore.getState().undoLastAction();
    expect(useProjectStore.getState().getProjectById('p1')!.archivedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(useProjectStore.getState().getProjectById('p2')!.archivedAt).toBe('2025-02-02T00:00:00.000Z');
  });

  it('counts only the projects that actually changed, and no-ops when none do', () => {
    useProjectStore.setState({
      projects: [makeProject({ id: 'p1', archived: true }), makeProject({ id: 'p2' })],
    });
    useTaskStore.setState({ lastAction: null });
    useTaskStore.getState().bulkSetProjectArchived(['p1', 'p2'], true);
    expect(useTaskStore.getState().lastAction?.label).toBe('1 project archived');

    useTaskStore.setState({ lastAction: null });
    useTaskStore.getState().bulkSetProjectArchived(['p1', 'p2'], true);
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

// ─── deleteTemplate ─────────────────────────────────────────────────────────

describe('deleteTemplate', () => {
  it('removes the template from state', () => {
    useTemplateStore.setState({ templates: [makeTemplate({ id: 'tpl-1' })] });
    useTaskStore.getState().deleteTemplate('tpl-1');
    expect(useTemplateStore.getState().templates).toHaveLength(0);
  });

  it('queues an undo that restores the template', () => {
    useTemplateStore.setState({ templates: [makeTemplate({ id: 'tpl-1', name: 'Packing List' })] });
    useTaskStore.getState().deleteTemplate('tpl-1');
    useTaskStore.getState().lastAction?.undo();
    expect(useTemplateStore.getState().templates.map(t => t.id)).toEqual(['tpl-1']);
    expect(useTemplateStore.getState().templates[0].name).toBe('Packing List');
  });

  it('is a no-op for an unknown id', () => {
    useTemplateStore.setState({ templates: [makeTemplate({ id: 'tpl-1' })] });
    useTaskStore.getState().deleteTemplate('missing');
    expect(useTemplateStore.getState().templates).toHaveLength(1);
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

// ─── bulkDeleteTemplates ────────────────────────────────────────────────────

describe('bulkDeleteTemplates', () => {
  it('removes every selected template and leaves the rest', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({ id: 'tpl-1' }), makeTemplate({ id: 'tpl-2' }), makeTemplate({ id: 'tpl-3' })],
    });
    useTaskStore.getState().bulkDeleteTemplates(['tpl-1', 'tpl-3']);
    expect(useTemplateStore.getState().templates.map(t => t.id)).toEqual(['tpl-2']);
  });

  it('queues a single undo that restores all of them', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({ id: 'tpl-1', name: 'Packing List' }), makeTemplate({ id: 'tpl-2', name: 'Race Day' })],
    });
    useTaskStore.setState({ lastAction: null });
    useTaskStore.getState().bulkDeleteTemplates(['tpl-1', 'tpl-2']);
    expect(useTaskStore.getState().lastAction?.label).toBe('2 templates deleted');
    useTaskStore.getState().undoLastAction();
    expect(useTemplateStore.getState().templates.map(t => t.name).sort()).toEqual(['Packing List', 'Race Day']);
  });

  it('leaves no undo entry when nothing matched', () => {
    useTemplateStore.setState({ templates: [makeTemplate({ id: 'tpl-1' })] });
    useTaskStore.setState({ lastAction: null });
    useTaskStore.getState().bulkDeleteTemplates(['missing']);
    expect(useTemplateStore.getState().templates).toHaveLength(1);
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

// ─── deleteCategory ─────────────────────────────────────────────────────────

describe('deleteCategory', () => {
  it('nulls the category on affected tasks and stacks', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', category: 'Home' })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', category: 'Home' })] });
    useTaskStore.getState().deleteCategory('Home');
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.category).toBeNull();
    expect(useTaskGroupStore.getState().groups.find(g => g.id === 'g1')?.category).toBeNull();
  });

  it('queues an undo that restores the category on affected tasks and stacks', () => {
    const { useCategoryStore } = jest.requireMock('../store/useCategoryStore') as { useCategoryStore: { getState: jest.Mock } };
    const category = { id: 'cat-1', name: 'Home', scheduleDays: null, scheduleStart: null, scheduleEnd: null, hideOnVacation: false, sortOrder: 1, emoji: null };
    useCategoryStore.getState.mockReturnValue({
      categories: [category],
      initialized: true,
      initialize: jest.fn(),
      addCategory: jest.fn(),
      deleteCategory: jest.fn(),
      restoreCategory: jest.fn(),
      renameCategory: jest.fn().mockReturnValue(true),
      setCategorySchedule: jest.fn(),
      removeCategorySchedule: jest.fn(),
      getCategoryByName: jest.fn().mockReturnValue(category),
    });
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', category: 'Home' })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', category: 'Home' })] });

    useTaskStore.getState().deleteCategory('Home');
    useTaskStore.getState().lastAction?.undo();

    expect(useCategoryStore.getState().restoreCategory).toHaveBeenCalledWith(category);
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.category).toBe('Home');
    expect(useTaskGroupStore.getState().groups.find(g => g.id === 'g1')?.category).toBe('Home');
  });

  it('does not queue an undo when the category is unknown', () => {
    useTaskStore.getState().deleteCategory('Ghost');
    expect(useTaskStore.getState().lastAction).toBeNull();
  });

  // Same rule as the move paths: the category going away must not make its
  // tasks read as new. See updateTask's recategorizedIntoNew.
  it('marks tasks seen when losing the category would make them new', () => {
    const { useCategoryStore } = jest.requireMock('../store/useCategoryStore') as { useCategoryStore: { getState: jest.Mock } };
    const routines = {
      id: 'cat-routines', name: 'Routines', scheduleDays: null, scheduleStart: null, scheduleEnd: null,
      hideOnVacation: false, excludeFromPinSuggestions: false, excludeFromNewTasksBanner: true,
      defaultTimeSegments: [], sortOrder: 1, emoji: null,
    };
    useCategoryStore.getState.mockReturnValue({
      categories: [routines],
      initialized: true,
      initialize: jest.fn(),
      addCategory: jest.fn(),
      deleteCategory: jest.fn(),
      restoreCategory: jest.fn(),
      renameCategory: jest.fn().mockReturnValue(true),
      setCategorySchedule: jest.fn(),
      removeCategorySchedule: jest.fn(),
      getCategoryByName: jest.fn((name: string) => (name === 'Routines' ? routines : null)),
    });
    useTaskStore.setState({
      tasks: [makeTask({
        id: 'a', category: 'Routines',
        dueDate: new Date().toISOString(), seenAt: '2020-01-01T00:00:00.000Z',
      })],
    });

    useTaskStore.getState().deleteCategory('Routines');

    const orphaned = useTaskStore.getState().tasks[0];
    expect(orphaned.category).toBeNull();
    expect(isTaskNew(orphaned)).toBe(false);
  });

  // The generated-task category settings (mealCookTaskCategory,
  // groceryUseUpTaskCategory, leftoverUseUpTaskCategory) file new tasks into
  // a category by name, same as calendarEventCategory — losing the category
  // without clearing them left a use-up/cook task landing in a resurrected
  // phantom section for a category the user had just deleted.
  it('clears every generated-task category setting naming the deleted category, and restores them on undo', () => {
    const { useCategoryStore } = jest.requireMock('../store/useCategoryStore') as { useCategoryStore: { getState: jest.Mock } };
    const category = { id: 'cat-1', name: 'Kitchen', scheduleDays: null, scheduleStart: null, scheduleEnd: null, hideOnVacation: false, sortOrder: 1, emoji: null };
    useCategoryStore.getState.mockReturnValue({
      categories: [category],
      initialized: true,
      initialize: jest.fn(),
      addCategory: jest.fn(),
      deleteCategory: jest.fn(),
      restoreCategory: jest.fn(),
      renameCategory: jest.fn().mockReturnValue(true),
      setCategorySchedule: jest.fn(),
      removeCategorySchedule: jest.fn(),
      getCategoryByName: jest.fn().mockReturnValue(category),
    });

    const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as { useSettingsStore: { getState: jest.Mock } };
    const setMealCookTaskCategory = jest.fn();
    const setGroceryUseUpTaskCategory = jest.fn();
    const setLeftoverUseUpTaskCategory = jest.fn();
    const setCalendarEventCategory = jest.fn();
    useSettingsStore.getState.mockReturnValue({
      dayResetTime: '00:00', autoArchiveProjectsOnComplete: false, activeHoursStart: '08:00', activeHoursEnd: '22:00',
      newTaskDefaults: { category: null, priority: null, effort: null, timeSegment: null, destination: 'today', openEditorAfterQuickAdd: false },
      mealCookTaskCategory: 'Kitchen', groceryUseUpTaskCategory: 'Kitchen', leftoverUseUpTaskCategory: 'Kitchen',
      calendarEventCategory: 'Kitchen', collapsedCategories: [], titleRules: [],
      setMealCookTaskCategory, setGroceryUseUpTaskCategory,
      setLeftoverUseUpTaskCategory, setCalendarEventCategory,
      setCollapsedCategories: jest.fn(),
    });

    useTaskStore.getState().deleteCategory('Kitchen');

    expect(setMealCookTaskCategory).toHaveBeenCalledWith(null);
    expect(setGroceryUseUpTaskCategory).toHaveBeenCalledWith(null);
    expect(setLeftoverUseUpTaskCategory).toHaveBeenCalledWith(null);
    expect(setCalendarEventCategory).toHaveBeenCalledWith(null);

    useTaskStore.getState().lastAction?.undo();

    expect(setMealCookTaskCategory).toHaveBeenCalledWith('Kitchen');
    expect(setGroceryUseUpTaskCategory).toHaveBeenCalledWith('Kitchen');
    expect(setLeftoverUseUpTaskCategory).toHaveBeenCalledWith('Kitchen');
    expect(setCalendarEventCategory).toHaveBeenCalledWith('Kitchen');
  });
});

// ─── deleteTag ──────────────────────────────────────────────────────────────

describe('deleteTag', () => {
  it('strips the tag from every task and the registry', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', tags: ['urgent', 'home'] }), makeTask({ id: 'b', tags: ['urgent'] })],
      tagRegistry: ['urgent', 'home'],
    });
    useTaskStore.getState().deleteTag('urgent');
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.tags).toEqual(['home']);
    expect(useTaskStore.getState().tasks.find(t => t.id === 'b')?.tags).toEqual([]);
    expect(useTaskStore.getState().tagRegistry).toEqual(['home']);
  });

  it('queues an undo that restores the tag on affected tasks and the registry', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', tags: ['urgent'] }), makeTask({ id: 'b', tags: [] })],
      tagRegistry: ['urgent'],
      lastAction: null,
    });
    useTaskStore.getState().deleteTag('urgent');
    useTaskStore.getState().undoLastAction();
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.tags).toEqual(['urgent']);
    expect(useTaskStore.getState().tasks.find(t => t.id === 'b')?.tags).toEqual([]);
    expect(useTaskStore.getState().tagRegistry).toEqual(['urgent']);
  });

  it('registers an undo even for a tag that only lives on tasks, not the registry', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', tags: ['adhoc'] })],
      tagRegistry: [],
      lastAction: null,
    });
    useTaskStore.getState().deleteTag('adhoc');
    useTaskStore.getState().undoLastAction();
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.tags).toEqual(['adhoc']);
    expect(useTaskStore.getState().tagRegistry).toEqual([]);
  });
});

describe('addExistingToProject / removeFromProject', () => {
  it('assigns an existing task to a project', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: null })] });
    useTaskStore.getState().addExistingToProject('a', 'p1');
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.projectId).toBe('p1');
  });

  it('clears a task\'s project assignment', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().removeFromProject('a');
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.projectId).toBeNull();
  });
});

// ─── archiveProject / unarchiveProject ──────────────────────────────────────

describe('archiveProject', () => {
  it('archives the project and is undoable', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({ lastAction: null });
    useTaskStore.getState().archiveProject('p1');
    expect(useProjectStore.getState().getProjectById('p1')!.archived).toBe(true);
    useTaskStore.getState().undoLastAction();
    const project = useProjectStore.getState().getProjectById('p1')!;
    expect(project.archived).toBe(false);
    expect(project.archivedAt).toBeNull();
  });

  it('leaves no undo entry for an already-archived project', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', archived: true, archivedAt: '2025-01-01T00:00:00.000Z' })] });
    useTaskStore.setState({ lastAction: null });
    useTaskStore.getState().archiveProject('p1');
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

describe('unarchiveProject', () => {
  it('restores the project and undoes back to the original archivedAt', () => {
    useProjectStore.setState({
      projects: [makeProject({ id: 'p1', archived: true, archivedAt: '2025-01-01T00:00:00.000Z' })],
    });
    useTaskStore.setState({ lastAction: null });
    useTaskStore.getState().unarchiveProject('p1');
    expect(useProjectStore.getState().getProjectById('p1')!.archived).toBe(false);
    useTaskStore.getState().undoLastAction();
    const project = useProjectStore.getState().getProjectById('p1')!;
    expect(project.archived).toBe(true);
    expect(project.archivedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('leaves no undo entry for a project that is not archived', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({ lastAction: null });
    useTaskStore.getState().unarchiveProject('p1');
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

// ─── completeProject / uncompleteProject ────────────────────────────────────

describe('completeProject', () => {
  it('completes the project and is undoable', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({ tasks: [], lastAction: null });
    useTaskStore.getState().completeProject('p1', { archiveRemaining: false });
    expect(useProjectStore.getState().getProjectById('p1')!.completed).toBe(true);
    useTaskStore.getState().undoLastAction();
    const project = useProjectStore.getState().getProjectById('p1')!;
    expect(project.completed).toBe(false);
    expect(project.completedAt).toBeNull();
  });

  it('leaves incomplete member tasks untouched when archiveRemaining is false', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1', completed: false })], lastAction: null });
    useTaskStore.getState().completeProject('p1', { archiveRemaining: false });
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.archived).toBe(false);
  });

  it('archives incomplete member tasks when archiveRemaining is true, and undo restores them', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', projectId: 'p1', completed: false }),
        makeTask({ id: 'b', projectId: 'p1', completed: true }),
      ],
      lastAction: null,
    });
    useTaskStore.getState().completeProject('p1', { archiveRemaining: true });
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.archived).toBe(true);
    // Already-completed member is untouched — nothing left to archive.
    expect(useTaskStore.getState().tasks.find(t => t.id === 'b')?.archived).toBe(false);

    useTaskStore.getState().undoLastAction();
    expect(useProjectStore.getState().getProjectById('p1')!.completed).toBe(false);
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.archived).toBe(false);
  });

  it('is a no-op when the project is already complete', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', completed: true, completedAt: '2025-01-01T00:00:00.000Z' })] });
    useTaskStore.setState({ tasks: [], lastAction: null });
    useTaskStore.getState().completeProject('p1', { archiveRemaining: false });
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

describe('uncompleteProject', () => {
  it('restores the project and undoes back to the original completedAt', () => {
    useProjectStore.setState({
      projects: [makeProject({ id: 'p1', completed: true, completedAt: '2025-01-01T00:00:00.000Z' })],
    });
    useTaskStore.setState({ lastAction: null });
    useTaskStore.getState().uncompleteProject('p1');
    expect(useProjectStore.getState().getProjectById('p1')!.completed).toBe(false);
    useTaskStore.getState().undoLastAction();
    const project = useProjectStore.getState().getProjectById('p1')!;
    expect(project.completed).toBe(true);
    expect(project.completedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('leaves no undo entry for a project that is not completed', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({ lastAction: null });
    useTaskStore.getState().uncompleteProject('p1');
    expect(useTaskStore.getState().lastAction).toBeNull();
  });
});

// ─── completeTask: project auto-archive ────────────────────────────────────────

describe('completeTask auto-archiving a finished project', () => {
  const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as { useSettingsStore: { getState: jest.Mock } };

  it('does nothing when autoArchiveProjectsOnComplete is off (default)', () => {
    useSettingsStore.getState.mockReturnValue({ dayResetTime: '00:00', autoArchiveProjectsOnComplete: false });
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().completeTask('a');
    expect(useProjectStore.getState().projects.find(p => p.id === 'p1')?.archived).toBe(false);
  });

  it('archives the project when the last task completes and the setting is on', () => {
    useSettingsStore.getState.mockReturnValue({ dayResetTime: '00:00', autoArchiveProjectsOnComplete: true });
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().completeTask('a');
    expect(useProjectStore.getState().projects.find(p => p.id === 'p1')?.archived).toBe(true);
  });

  it('does not archive the project while other tasks in it are still incomplete', () => {
    useSettingsStore.getState.mockReturnValue({ dayResetTime: '00:00', autoArchiveProjectsOnComplete: true });
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', projectId: 'p1' }), makeTask({ id: 'b', projectId: 'p1', completed: false })],
    });
    useTaskStore.getState().completeTask('a');
    expect(useProjectStore.getState().projects.find(p => p.id === 'p1')?.archived).toBe(false);
  });

  // The fresh occurrence a recurring completion spawns is real outstanding
  // work, so ticking tonight's habit must not archive the project out from
  // under tomorrow's.
  it('does not archive a project whose only member is a recurring task', () => {
    useSettingsStore.getState.mockReturnValue({ dayResetTime: '00:00', autoArchiveProjectsOnComplete: true });
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({
      tasks: [makeTask({
        id: 'habit',
        projectId: 'p1',
        recurrenceType: 'daily',
        recurrenceInterval: 1,
        dueDate: new Date().toISOString(),
      })],
    });
    useTaskStore.getState().completeTask('habit');
    expect(useProjectStore.getState().projects.find(p => p.id === 'p1')?.archived).toBe(false);
  });

  it('ignores tasks with no projectId', () => {
    useSettingsStore.getState.mockReturnValue({ dayResetTime: '00:00', autoArchiveProjectsOnComplete: true });
    useProjectStore.setState({ projects: [] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: null })] });
    expect(() => useTaskStore.getState().completeTask('a')).not.toThrow();
  });

  it('unarchives the project again when the completion is undone', () => {
    useSettingsStore.getState.mockReturnValue({ dayResetTime: '00:00', autoArchiveProjectsOnComplete: true });
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().completeTask('a');
    useTaskStore.getState().undoLastAction();
    expect(useProjectStore.getState().getProjectById('p1')!.archived).toBe(false);
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.completed).toBe(false);
  });

  it('leaves a project the user had already archived alone when the completion is undone', () => {
    useSettingsStore.getState.mockReturnValue({ dayResetTime: '00:00', autoArchiveProjectsOnComplete: true });
    useProjectStore.setState({
      projects: [makeProject({ id: 'p1', archived: true, archivedAt: '2025-01-01T00:00:00.000Z' })],
    });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: 'p1' })] });
    useTaskStore.getState().completeTask('a');
    useTaskStore.getState().undoLastAction();
    expect(useProjectStore.getState().getProjectById('p1')!.archived).toBe(true);
  });
});

describe('quota tasks', () => {
  const quota = (overrides: Partial<Task> = {}) =>
    makeTask({
      id: 'water',
      title: 'Drink water',
      targetCount: 8,
      progressCount: 0,
      recurrenceType: 'daily',
      dueDate: new Date(2025, 5, 10, 12, 0, 0).toISOString(),
      ...overrides,
    });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 10, 0, 0)); // June 10, 2025 10:00 AM
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('logQuotaUnit', () => {
    it('logs one unit without completing the task', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 3 })] });
      useTaskStore.getState().logQuotaUnit('water');

      const task = useTaskStore.getState().tasks.find(t => t.id === 'water')!;
      expect(task.progressCount).toBe(4);
      expect(task.completed).toBe(false);
      expect(dbUpdateTask).toHaveBeenCalled();
    });

    it('completes the task on the unit that reaches the target', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 7 })] });
      useTaskStore.getState().logQuotaUnit('water');

      const done = useTaskStore.getState().tasks.find(t => t.id === 'water')!;
      expect(done.completed).toBe(true);
      expect(done.progressCount).toBe(8);
    });

    it('spawns tomorrow\'s occurrence empty when the target is reached', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 7 })] });
      useTaskStore.getState().logQuotaUnit('water');

      const next = useTaskStore.getState().tasks.find(t => t.id !== 'water')!;
      expect(next).toBeDefined();
      expect(next.progressCount).toBe(0);
      expect(next.targetCount).toBe(8);
      expect(next.completed).toBe(false);
      expect(next.previousOccurrenceId).toBe('water');
    });

    it('advances the streak once for the day, not once per unit', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 5, streakCount: 4, streakDate: new Date(2025, 5, 9).toISOString() })] });
      const store = useTaskStore.getState();
      store.logQuotaUnit('water');
      store.logQuotaUnit('water');
      expect(useTaskStore.getState().tasks.find(t => t.id === 'water')!.streakCount).toBe(4);

      store.logQuotaUnit('water'); // the eighth
      expect(useTaskStore.getState().tasks.find(t => t.id === 'water')!.streakCount).toBe(5);
    });

    it('ignores tasks that are not quotas, and completed ones', () => {
      useTaskStore.setState({ tasks: [makeTask({ id: 'plain' }), quota({ id: 'done', completed: true, progressCount: 8 })] });
      const store = useTaskStore.getState();
      store.logQuotaUnit('plain');
      store.logQuotaUnit('done');

      expect(useTaskStore.getState().tasks.find(t => t.id === 'plain')!.progressCount).toBe(0);
      expect(useTaskStore.getState().tasks.find(t => t.id === 'done')!.progressCount).toBe(8);
    });

    it('is undoable a unit at a time', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 3 })] });
      useTaskStore.getState().logQuotaUnit('water');
      expect(useTaskStore.getState().tasks[0].progressCount).toBe(4);

      useTaskStore.getState().lastAction!.undo();
      expect(useTaskStore.getState().tasks[0].progressCount).toBe(3);
    });
  });

  describe('targetUnit', () => {
    it('carries the unit onto the next occurrence', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 7, targetUnit: '8oz glasses' })] });
      useTaskStore.getState().logQuotaUnit('water');

      const next = useTaskStore.getState().tasks.find(t => t.id !== 'water')!;
      expect(next.targetUnit).toBe('8oz glasses');
    });

    it('normalizes what addTask is given, and defaults to no unit', () => {
      const withUnit = useTaskStore.getState().addTask({ title: 'Water', targetCount: 8, targetUnit: '  8oz   glasses ' });
      expect(withUnit.targetUnit).toBe('8oz glasses');

      const plain = useTaskStore.getState().addTask({ title: 'Post office' });
      expect(plain.targetUnit).toBeNull();
    });

    it('normalizes an edit, and takes a blank one as clearing it', () => {
      useTaskStore.setState({ tasks: [quota({ targetUnit: 'glasses' })] });
      useTaskStore.getState().updateTask('water', { targetUnit: ' reps ' });
      expect(useTaskStore.getState().tasks[0].targetUnit).toBe('reps');

      useTaskStore.getState().updateTask('water', { targetUnit: '   ' });
      expect(useTaskStore.getState().tasks[0].targetUnit).toBeNull();
    });
  });

  describe('unlogQuotaUnit', () => {
    it('takes one back but never below zero', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 1 })] });
      const store = useTaskStore.getState();
      store.unlogQuotaUnit('water');
      expect(useTaskStore.getState().tasks[0].progressCount).toBe(0);

      store.unlogQuotaUnit('water');
      expect(useTaskStore.getState().tasks[0].progressCount).toBe(0);
    });
  });

  // At 10:00 of an 08:00–22:00 day, 2 of 8 are owed: a task sitting at 1 is on
  // Today, and the unit that takes it to 2 is the one that used to make the row
  // vanish under the finger.
  describe('holdQuotaOnToday', () => {
    const behind = () => quota({ progressCount: 1 });
    const ids = (tasks: Task[]) => tasks.map(t => t.id);

    it('drops off Today on the catching-up unit without a hold', () => {
      useTaskStore.setState({ tasks: [behind()] });
      expect(ids(useTaskStore.getState().visibleTasks())).toEqual(['water']);

      useTaskStore.getState().logQuotaUnit('water');
      expect(ids(useTaskStore.getState().visibleTasks())).toEqual([]);
      expect(ids(useTaskStore.getState().deferredTasks())).toEqual(['water']);
    });

    it('keeps it on Today through the unit that puts it back on pace', () => {
      useTaskStore.setState({ tasks: [behind()] });
      const store = useTaskStore.getState();
      store.holdQuotaOnToday('water');
      store.logQuotaUnit('water');

      expect(ids(useTaskStore.getState().visibleTasks())).toEqual(['water']);
      // And only there — the two lists are disjoint lenses over the same task.
      expect(ids(useTaskStore.getState().deferredTasks())).toEqual([]);
    });

    it('lets the rest of a burst be logged in the same place', () => {
      useTaskStore.setState({ tasks: [behind()] });
      const store = useTaskStore.getState();
      store.holdQuotaOnToday('water');
      store.logQuotaUnit('water');
      store.logQuotaUnit('water');
      store.logQuotaUnit('water');

      expect(useTaskStore.getState().tasks[0].progressCount).toBe(4);
      expect(ids(useTaskStore.getState().visibleTasks())).toEqual(['water']);
    });

    it('hands the task over to Later when the hold is released', () => {
      useTaskStore.setState({ tasks: [behind()] });
      const store = useTaskStore.getState();
      store.holdQuotaOnToday('water');
      store.logQuotaUnit('water');
      store.releaseQuotaHold('water');

      expect(ids(useTaskStore.getState().visibleTasks())).toEqual([]);
      expect(ids(useTaskStore.getState().deferredTasks())).toEqual(['water']);
    });

    it('leaves a released task that is behind pace again on Today', () => {
      useTaskStore.setState({ tasks: [behind()] });
      const store = useTaskStore.getState();
      store.holdQuotaOnToday('water');
      store.logQuotaUnit('water');
      store.unlogQuotaUnit('water'); // the long-press undo
      store.releaseQuotaHold('water');

      expect(ids(useTaskStore.getState().visibleTasks())).toEqual(['water']);
    });

    it('gives the hold up when the target is met, rather than holding a finished row', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 6 })] });
      const store = useTaskStore.getState();
      store.holdQuotaOnToday('water');
      store.logQuotaUnit('water'); // 7th, back on pace at best
      store.logQuotaUnit('water'); // 8th — completes

      expect(useTaskStore.getState().quotaHoldIds).toEqual([]);
      expect(useTaskStore.getState().tasks.find(t => t.id === 'water')!.completed).toBe(true);
    });

    it('expires on its own if the row never releases it', () => {
      useTaskStore.setState({ tasks: [behind()] });
      const store = useTaskStore.getState();
      store.holdQuotaOnToday('water');
      store.logQuotaUnit('water');

      jest.advanceTimersByTime(30000);
      expect(useTaskStore.getState().quotaHoldIds).toEqual([]);
      expect(ids(useTaskStore.getState().visibleTasks())).toEqual([]);
    });

    it('holds nothing for a task that is not a daily target', () => {
      useTaskStore.setState({ tasks: [makeTask({ id: 'plain', dueDate: new Date(2025, 5, 11, 12, 0, 0).toISOString() })] });
      useTaskStore.getState().holdQuotaOnToday('plain');

      expect(ids(useTaskStore.getState().visibleTasks())).toEqual([]);
    });
  });

  // A pinned target shows regardless of visibility (pinnedTasks() ignores it on
  // purpose) — except pace, which unpins it after the same grace window a
  // completion gets, rather than leaving it stuck pinned at quota until the
  // next unit falls due.
  describe('logQuotaUnit — pinned targets unpin on pace', () => {
    it('keeps a pinned target pinned through the tap that catches it up to pace', () => {
      useTaskStore.setState({ tasks: [quota({ pinned: true, progressCount: 1 })] });
      useTaskStore.getState().logQuotaUnit('water');

      expect(useTaskStore.getState().tasks[0].pinned).toBe(true);
      expect(dbBulkSetPinned).not.toHaveBeenCalled();
    });

    it('unpins once the grace window passes with no further logging', () => {
      useTaskStore.setState({ tasks: [quota({ pinned: true, progressCount: 1 })] });
      useTaskStore.getState().logQuotaUnit('water');

      jest.advanceTimersByTime(4000);
      expect(useTaskStore.getState().tasks[0].pinned).toBe(false);
      expect(dbBulkSetPinned).toHaveBeenCalledWith(['water'], false);
    });

    it('lets a burst of logging land before unpinning', () => {
      useTaskStore.setState({ tasks: [quota({ pinned: true, progressCount: 1 })] });
      const store = useTaskStore.getState();
      store.logQuotaUnit('water'); // 1 -> 2, catches up to pace
      jest.advanceTimersByTime(2000);
      store.logQuotaUnit('water'); // 2 -> 3, still on pace — resets the window
      jest.advanceTimersByTime(2000);

      expect(useTaskStore.getState().tasks[0].pinned).toBe(true);

      jest.advanceTimersByTime(2000);
      expect(useTaskStore.getState().tasks[0].pinned).toBe(false);
    });

    it('does not schedule an unpin for a task that is not pinned', () => {
      useTaskStore.setState({ tasks: [quota({ pinned: false, progressCount: 1 })] });
      useTaskStore.getState().logQuotaUnit('water');

      jest.advanceTimersByTime(4000);
      expect(dbBulkSetPinned).not.toHaveBeenCalled();
    });

    it('leaves it pinned if the catching-up log is undone before the window closes', () => {
      useTaskStore.setState({ tasks: [quota({ pinned: true, progressCount: 1 })] });
      const store = useTaskStore.getState();
      store.logQuotaUnit('water');
      store.unlogQuotaUnit('water'); // the long-press undo — back behind pace

      jest.advanceTimersByTime(4000);
      expect(useTaskStore.getState().tasks[0].pinned).toBe(true);
      expect(dbBulkSetPinned).not.toHaveBeenCalled();
    });
  });

  // A target you're keeping up with is Later Today's, same as a task whose
  // segment hasn't opened — it isn't due yet and it's back when the next unit
  // falls due.
  describe('upcomingTodayTasks — daily targets', () => {
    const ids = (tasks: Task[]) => tasks.map(t => t.id);

    it('lists a target you are keeping up with', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 2 })] });
      expect(ids(useTaskStore.getState().upcomingTodayTasks())).toEqual(['water']);
    });

    it('leaves out one that is behind pace — that one is on Today itself', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 1 })] });
      expect(ids(useTaskStore.getState().upcomingTodayTasks())).toEqual([]);
      expect(ids(useTaskStore.getState().visibleTasks())).toEqual(['water']);
    });

    it('leaves out one still held on Today, so it is not in two places at once', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 1 })] });
      const store = useTaskStore.getState();
      store.holdQuotaOnToday('water');
      store.logQuotaUnit('water');

      expect(ids(useTaskStore.getState().upcomingTodayTasks())).toEqual([]);
      expect(ids(useTaskStore.getState().visibleTasks())).toEqual(['water']);

      // Once the row has played out, Later Today takes it.
      store.releaseQuotaHold('water');
      expect(ids(useTaskStore.getState().upcomingTodayTasks())).toEqual(['water']);
      expect(ids(useTaskStore.getState().visibleTasks())).toEqual([]);
    });

    // Meeting the target completes the row, and the completion hold masks it
    // back to incomplete for a second so it can collapse with its burst. The
    // mask has to leave it in the list it was already in — at 8/8 it would read
    // as on pace wherever it came from, and hop lists on the way out.
    it('keeps a target finished from the reveal in the reveal for the hold', () => {
      // 7 of 8 at 10:00 is miles ahead of the 2 owed, so this one is in Later
      // Today to begin with.
      useTaskStore.setState({ tasks: [quota({ progressCount: 7 })] });
      expect(ids(useTaskStore.getState().upcomingTodayTasks())).toEqual(['water']);

      useTaskStore.getState().logQuotaUnit('water'); // the eighth completes it
      expect(useTaskStore.getState().tasks.find(t => t.id === 'water')!.completed).toBe(true);
      expect(ids(useTaskStore.getState().upcomingTodayTasks())).toEqual(['water']);
      expect(ids(useTaskStore.getState().visibleTasks())).toEqual([]);
    });

    it('keeps a target finished from Today on Today for the hold', () => {
      jest.setSystemTime(new Date(2025, 5, 10, 23, 0, 0)); // all 8 owed by now
      useTaskStore.setState({ tasks: [quota({ progressCount: 7 })] });
      expect(ids(useTaskStore.getState().visibleTasks())).toEqual(['water']);

      useTaskStore.getState().logQuotaUnit('water');
      expect(ids(useTaskStore.getState().visibleTasks())).toEqual(['water']);
      expect(ids(useTaskStore.getState().upcomingTodayTasks())).toEqual([]);
    });

    it('leaves out one held back by something other than pace', () => {
      useTaskStore.setState({
        tasks: [quota({ progressCount: 2, dueDate: new Date(2025, 5, 11, 12, 0, 0).toISOString() })],
      });
      expect(ids(useTaskStore.getState().upcomingTodayTasks())).toEqual([]);
    });
  });

  describe('uncompleteTask', () => {
    it('reopens a finished quota one unit short of its target', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 7 })] });
      useTaskStore.getState().logQuotaUnit('water');
      useTaskStore.getState().uncompleteTask('water');

      const task = useTaskStore.getState().tasks.find(t => t.id === 'water')!;
      expect(task.completed).toBe(false);
      expect(task.progressCount).toBe(7);
    });
  });

  // #1752: raising the target on a quota task that already hit its old one
  // used to leave it stuck completed and invisible on Today, with no way to
  // log the rest of the day's new target.
  describe('updateTask reopening a completed quota task', () => {
    it('reopens the task when the new target exceeds what was already logged', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 7 })] });
      useTaskStore.getState().logQuotaUnit('water'); // 7 -> 8, completes for the day

      useTaskStore.getState().updateTask('water', { targetCount: 12 });

      const task = useTaskStore.getState().tasks.find(t => t.id === 'water')!;
      expect(task.completed).toBe(false);
      // Nothing was un-logged — only the completion — so the count actually
      // reached today is preserved rather than dropped to targetCount - 1.
      expect(task.progressCount).toBe(8);
      expect(task.targetCount).toBe(12);
    });

    it('deletes the next occurrence the completion had already spawned', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 7 })] });
      useTaskStore.getState().logQuotaUnit('water');
      expect(useTaskStore.getState().tasks).toHaveLength(2);

      useTaskStore.getState().updateTask('water', { targetCount: 12 });

      expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['water']);
    });

    it('leaves a still-active (not yet completed) quota task alone', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 3 })] });
      useTaskStore.getState().updateTask('water', { targetCount: 12 });

      const task = useTaskStore.getState().tasks[0];
      expect(task.completed).toBe(false);
      expect(task.progressCount).toBe(3);
      expect(task.targetCount).toBe(12);
    });

    it('leaves a completed quota task alone when the target is not raised past what was logged', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 7 })] });
      useTaskStore.getState().logQuotaUnit('water');

      useTaskStore.getState().updateTask('water', { targetCount: 8 });

      const task = useTaskStore.getState().tasks.find(t => t.id === 'water')!;
      expect(task.completed).toBe(true);
      expect(task.progressCount).toBe(8);
    });
  });

  describe('rolloverQuotas', () => {
    it('closes out an unfinished day as a partial record', () => {
      useTaskStore.setState({
        tasks: [quota({ progressCount: 5, dueDate: new Date(2025, 5, 9, 12, 0, 0).toISOString() })],
      });
      useTaskStore.getState().rolloverQuotas();

      const partial = useTaskStore.getState().tasks.find(t => t.id === 'water')!;
      expect(partial.completed).toBe(true);
      expect(partial.progressCount).toBe(5); // the record of that day
      // Stamped on the day it belonged to, not today.
      expect(new Date(partial.completedAt!).getDate()).toBe(9);
    });

    it('breaks the streak on a day that fell short', () => {
      useTaskStore.setState({
        tasks: [quota({
          progressCount: 5,
          streakCount: 12,
          streakDate: new Date(2025, 5, 8).toISOString(),
          dueDate: new Date(2025, 5, 9, 12, 0, 0).toISOString(),
        })],
      });
      useTaskStore.getState().rolloverQuotas();

      const partial = useTaskStore.getState().tasks.find(t => t.id === 'water')!;
      expect(partial.streakCount).toBe(0);
      expect(useTaskStore.getState().tasks.find(t => t.id !== 'water')!.streakCount).toBe(0);
    });

    it('starts today fresh, even after the app sat closed for a week', () => {
      useTaskStore.setState({
        tasks: [quota({ progressCount: 2, dueDate: new Date(2025, 5, 3, 12, 0, 0).toISOString() })],
      });
      useTaskStore.getState().rolloverQuotas();

      const next = useTaskStore.getState().tasks.find(t => t.id !== 'water')!;
      expect(next.progressCount).toBe(0);
      expect(new Date(next.dueDate!).getDate()).toBe(10); // today, not June 4
      expect(next.completed).toBe(false);
    });

    it('leaves today\'s own unfinished quota alone', () => {
      useTaskStore.setState({ tasks: [quota({ progressCount: 2 })] });
      useTaskStore.getState().rolloverQuotas();

      expect(useTaskStore.getState().tasks).toHaveLength(1);
      expect(useTaskStore.getState().tasks[0].completed).toBe(false);
    });

    it('leaves a one-off quota with no repeat overdue instead of re-spawning it', () => {
      useTaskStore.setState({
        tasks: [quota({
          recurrenceType: 'none',
          progressCount: 2,
          dueDate: new Date(2025, 5, 9, 12, 0, 0).toISOString(),
        })],
      });
      useTaskStore.getState().rolloverQuotas();

      expect(useTaskStore.getState().tasks).toHaveLength(1);
      expect(useTaskStore.getState().tasks[0].completed).toBe(false);
    });

    it('records the partial but spawns nothing once the series has ended', () => {
      useTaskStore.setState({
        tasks: [quota({
          progressCount: 5,
          recurrenceCount: 1, // this was the last occurrence
          dueDate: new Date(2025, 5, 9, 12, 0, 0).toISOString(),
        })],
      });
      useTaskStore.getState().rolloverQuotas();

      const tasks = useTaskStore.getState().tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].completed).toBe(true);
      expect(tasks[0].progressCount).toBe(5);
    });

    it('leaves ordinary overdue tasks alone', () => {
      useTaskStore.setState({
        tasks: [makeTask({ id: 'plain', dueDate: new Date(2025, 5, 9, 12, 0, 0).toISOString() })],
      });
      useTaskStore.getState().rolloverQuotas();

      expect(useTaskStore.getState().tasks).toHaveLength(1);
      expect(useTaskStore.getState().tasks[0].completed).toBe(false);
    });

    it('leaves an allowOvershoot task alone — sweepOvershootQuotas owns it', () => {
      useTaskStore.setState({
        tasks: [quota({
          allowOvershoot: true,
          progressCount: 5,
          dueDate: new Date(2025, 5, 9, 12, 0, 0).toISOString(),
        })],
      });
      useTaskStore.getState().rolloverQuotas();

      const task = useTaskStore.getState().tasks.find(t => t.id === 'water')!;
      expect(task.completed).toBe(false);
      expect(task.progressCount).toBe(5);
    });
  });

  describe('sweepOvershootQuotas', () => {
    it('completes a below-target day with the low count, not a miss', () => {
      useTaskStore.setState({
        tasks: [quota({
          allowOvershoot: true,
          progressCount: 5,
          streakCount: 3,
          streakDate: new Date(2025, 5, 9).toISOString(),
          dueDate: new Date(2025, 5, 9, 12, 0, 0).toISOString(),
        })],
      });
      useTaskStore.getState().sweepOvershootQuotas();

      const done = useTaskStore.getState().tasks.find(t => t.id === 'water')!;
      expect(done.completed).toBe(true);
      expect(done.progressCount).toBe(5); // under target(8), kept as the tally
      expect(done.missedAt).toBeNull(); // not a miss
      // Not the manual-close streak break rolloverQuotas uses — a normal
      // completeTask call, so the cadence-based streak advances.
      expect(done.streakCount).toBe(4);
    });

    it('completes an overshot day with the high count', () => {
      useTaskStore.setState({
        tasks: [quota({
          allowOvershoot: true,
          progressCount: 13, // past the target of 8
          dueDate: new Date(2025, 5, 9, 12, 0, 0).toISOString(),
        })],
      });
      useTaskStore.getState().sweepOvershootQuotas();

      const done = useTaskStore.getState().tasks.find(t => t.id === 'water')!;
      expect(done.completed).toBe(true);
      expect(done.progressCount).toBe(13); // preserved, not clamped to target
    });

    it('leaves an allowOvershoot task nobody logged today alone', () => {
      useTaskStore.setState({
        tasks: [quota({
          allowOvershoot: true,
          progressCount: 0,
          dueDate: new Date(2025, 5, 9, 12, 0, 0).toISOString(),
        })],
      });
      useTaskStore.getState().sweepOvershootQuotas();

      const task = useTaskStore.getState().tasks.find(t => t.id === 'water')!;
      expect(task.completed).toBe(false);
      expect(task.progressCount).toBe(0);
    });

    it('leaves an opted-out quota task alone — rolloverQuotas owns it', () => {
      useTaskStore.setState({
        tasks: [quota({
          progressCount: 5,
          dueDate: new Date(2025, 5, 9, 12, 0, 0).toISOString(),
        })],
      });
      useTaskStore.getState().sweepOvershootQuotas();

      const task = useTaskStore.getState().tasks.find(t => t.id === 'water')!;
      expect(task.completed).toBe(false);
      expect(task.progressCount).toBe(5);
    });

    it('spawns the next occurrence, same as any other completion', () => {
      useTaskStore.setState({
        tasks: [quota({
          allowOvershoot: true,
          progressCount: 5,
          dueDate: new Date(2025, 5, 9, 12, 0, 0).toISOString(),
        })],
      });
      useTaskStore.getState().sweepOvershootQuotas();

      const tasks = useTaskStore.getState().tasks;
      expect(tasks).toHaveLength(2);
      const next = tasks.find(t => t.id !== 'water')!;
      expect(next.progressCount).toBe(0);
      expect(next.completed).toBe(false);
    });
  });
});

// ─── dated series ────────────────────────────────────────────────────────────

describe('addTaskSeries', () => {
  it('creates one row per date, sharing a series id', () => {
    const rows = useTaskStore.getState().addTaskSeries(
      { title: 'Walk the dog' },
      [new Date(2025, 8, 15, 12, 0, 0), new Date(2025, 8, 10, 12, 0, 0)],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].seriesId).toBe(rows[1].seriesId);
    expect(rows[0].seriesId).toBeTruthy();
    // Sorted, so the set reads earliest-first wherever it's listed.
    expect(new Date(rows[0].dueDate!).getDate()).toBe(10);
    expect(new Date(rows[1].dueDate!).getDate()).toBe(15);
    expect(rows.every(r => r.title === 'Walk the dog')).toBe(true);
    expect(useTaskStore.getState().tasks).toHaveLength(2);
  });

  it('gives every date its own row so each one is separately due', () => {
    const rows = useTaskStore.getState().addTaskSeries(
      { title: 'Dog' },
      [new Date(2025, 8, 10, 12, 0, 0), new Date(2025, 8, 15, 12, 0, 0)],
    );
    expect(new Set(rows.map(r => r.id)).size).toBe(2);
    expect(rows.every(r => r.recurrenceType === 'none')).toBe(true);
  });

  it('re-anchors the reminder onto each date, keeping its time of day', () => {
    const rows = useTaskStore.getState().addTaskSeries(
      { title: 'Dog', reminderTime: new Date(2025, 8, 10, 8, 30, 0).toISOString() },
      [new Date(2025, 8, 10, 12, 0, 0), new Date(2025, 8, 15, 12, 0, 0)],
    );
    const second = new Date(rows[1].reminderTime!);
    expect(second.getDate()).toBe(15);
    expect(second.getHours()).toBe(8);
    expect(second.getMinutes()).toBe(30);
  });

  it('does nothing for an empty date list', () => {
    expect(useTaskStore.getState().addTaskSeries({ title: 'x' }, [])).toEqual([]);
    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });
});

// The editor saves recurrenceType and the extra dates independently, so a
// repeat rule and a set of dates can arrive on the same save. They're two
// schedules for one task, and leaving both in place meant every completed date
// spawned an extra occurrence inside the same series.
describe('a series and a recurrence rule never coexist', () => {
  it('clears the rule off the anchor and every date when a series forms', () => {
    useTaskStore.setState({
      tasks: [makeTask({
        id: 'r1',
        recurrenceType: 'daily',
        recurrenceInterval: 2,
        recurrenceCount: 5,
        showStreak: true,
        dueDate: new Date(2025, 5, 10, 12).toISOString(),
      })],
    });
    useTaskStore.getState().applyTaskDates('r1', [new Date(2025, 5, 10, 12), new Date(2025, 5, 15, 12)]);

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks.every(t => t.recurrenceType === 'none')).toBe(true);
    expect(tasks.every(t => t.recurrenceCount === null)).toBe(true);
    expect(tasks.every(t => t.showStreak === false)).toBe(true);
  });

  it('leaves a completed date spawning nothing at all', () => {
    useTaskStore.setState({
      tasks: [makeTask({
        id: 'r1',
        recurrenceType: 'daily',
        recurrenceInterval: 1,
        dueDate: new Date(2025, 5, 10, 12).toISOString(),
      })],
    });
    useTaskStore.getState().applyTaskDates('r1', [new Date(2025, 5, 10, 12), new Date(2025, 5, 15, 12)]);
    useTaskStore.getState().completeTask('r1');

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks.filter(t => !t.completed).map(t => new Date(t.dueDate!).getDate())).toEqual([15]);
  });

  // A chain step spawns onto the same day it was completed, so inheriting the
  // seriesId put a second row on a date the set already had — and the next
  // date edit, which reconciles by calendar day, deleted one of the pair.
  it('leaves the set when a chain step spawns from one of its dates', () => {
    const rows = useTaskStore.getState().addTaskSeries(
      { title: 'Meal prep', chainEnabled: true, chainItems: [{ id: 'a', title: 'Shop', estimatedMinutes: null }, { id: 'b', title: 'Cook', estimatedMinutes: null }] },
      [new Date(2025, 5, 10, 12), new Date(2025, 5, 15, 12)],
    );
    useTaskStore.getState().completeTask(rows[0].id);

    const spawned = useTaskStore.getState().tasks.find(t => t.chainIndex === 1)!;
    expect(spawned.seriesId).toBeNull();
    expect(useTaskStore.getState().seriesRowsOf(rows[0].seriesId!)).toHaveLength(2);
  });

  it('drops the rule from a series built from scratch', () => {
    const rows = useTaskStore.getState().addTaskSeries(
      { title: 'Dog', recurrenceType: 'weekly', recurrenceDays: [1], showStreak: true },
      [new Date(2025, 5, 10, 12), new Date(2025, 5, 15, 12)],
    );
    expect(rows.every(r => r.recurrenceType === 'none' && r.recurrenceDays.length === 0)).toBe(true);
  });
});

describe('applyTaskDates', () => {
  it('turns a plain dated task into a series when it gains a date', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', dueDate: new Date(2025, 8, 10, 12, 0, 0).toISOString() })],
    });
    useTaskStore.getState().applyTaskDates('a', [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks[0].seriesId).toBeTruthy();
    expect(tasks.every(t => t.seriesId === tasks[0].seriesId)).toBe(true);
  });

  it('keeps the edited row on its own date rather than repointing it', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', dueDate: new Date(2025, 8, 15, 12, 0, 0).toISOString() })],
    });
    useTaskStore.getState().applyTaskDates('a', [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);

    const edited = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(new Date(edited.dueDate!).getDate()).toBe(15);
  });

  it('drops the incomplete row for a date removed from the set', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().applyTaskDates(rows[0].id, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 20, 12, 0, 0),
    ]);

    const days = useTaskStore.getState().tasks.map(t => new Date(t.dueDate!).getDate()).sort((a, b) => a - b);
    expect(days).toEqual([10, 20]);
  });

  it('deletes the calendar event of a row dropped from the set', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.setState({
      tasks: useTaskStore.getState().tasks.map(t =>
        t.id === rows[1].id ? { ...t, calendarEventId: 'evt-dropped' } : t
      ),
    });
    (deleteCalendarEvent as jest.Mock).mockClear();
    useTaskStore.getState().applyTaskDates(rows[0].id, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 20, 12, 0, 0),
    ]);
    expect(deleteCalendarEvent).toHaveBeenCalledWith('evt-dropped');
  });

  it('never deletes a completed date — it is history, not schedule', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.setState({
      tasks: useTaskStore.getState().tasks.map(t =>
        t.id === rows[0].id ? { ...t, completed: true, completedAt: new Date().toISOString() } : t
      ),
    });
    // Rewrite the set to a date that doesn't include the completed one.
    useTaskStore.getState().applyTaskDates(rows[1].id, [
      new Date(2025, 8, 15, 12, 0, 0),
      new Date(2025, 8, 20, 12, 0, 0),
    ]);

    const completed = useTaskStore.getState().tasks.find(t => t.id === rows[0].id);
    expect(completed).toBeDefined();
    expect(completed!.completed).toBe(true);
  });

  // Archived rows counted as live, so a date edit deleted a filed-away row
  // outright when its date was dropped from the set.
  it('never deletes an archived date either', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().archiveTask(rows[1].id);
    useTaskStore.getState().applyTaskDates(rows[0].id, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 20, 12, 0, 0),
    ]);

    const archived = useTaskStore.getState().tasks.find(t => t.id === rows[1].id);
    expect(archived).toBeDefined();
    expect(archived!.archived).toBe(true);
  });

  // ...and when the date was kept, the archived row satisfied it, leaving the
  // set with nothing actionable on a day the user had just asked for.
  it('gives a kept date a live row of its own rather than letting an archived one stand for it', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().archiveTask(rows[1].id);
    useTaskStore.getState().applyTaskDates(rows[0].id, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);

    const live = useTaskStore.getState().tasks.filter(t => !t.archived);
    expect(live.map(t => new Date(t.dueDate!).getDate()).sort((a, b) => a - b)).toEqual([10, 15]);
    expect(useTaskStore.getState().tasks.filter(t => t.archived)).toHaveLength(1);
  });

  it('keeps an archived date out of the set when it dissolves back to a plain task', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().archiveTask(rows[1].id);
    useTaskStore.getState().applyTaskDates(rows[0].id, [new Date(2025, 8, 10, 12, 0, 0)]);

    const archived = useTaskStore.getState().tasks.find(t => t.id === rows[1].id);
    expect(archived).toBeDefined();
    expect(archived!.seriesId).toBeNull();
  });

  it('dissolves the series back to a plain task when the set drops to one date', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().applyTaskDates(rows[0].id, [new Date(2025, 8, 10, 12, 0, 0)]);

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].seriesId).toBeNull();
    expect(tasks[0].seriesMonthDays).toEqual([]);
  });

  it('stores the repeat rule on every row of the set', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().applyTaskDates(
      rows[0].id,
      [new Date(2025, 8, 10, 12, 0, 0), new Date(2025, 8, 15, 12, 0, 0)],
      { monthDays: [10, 15], repeatMonths: 1 },
    );

    expect(useTaskStore.getState().tasks.every(t => t.seriesMonthDays.join() === '10,15')).toBe(true);
  });
});

describe('updateTask series fan-out', () => {
  it("applies content edits to the set's later dates", () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().updateTask(rows[0].id, { title: 'Walk the neighbour dog' });

    const later = useTaskStore.getState().tasks.find(t => t.id === rows[1].id)!;
    expect(later.title).toBe('Walk the neighbour dog');
  });

  it('leaves earlier dates alone — "this and later", not the whole set', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().updateTask(rows[1].id, { title: 'Changed' });

    expect(useTaskStore.getState().tasks.find(t => t.id === rows[0].id)!.title).toBe('Dog');
  });

  it('does not fan out an occurrence-scoped edit', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().updateTask(rows[0].id, { title: 'Just today' }, { scope: 'occurrence' });

    expect(useTaskStore.getState().tasks.find(t => t.id === rows[1].id)!.title).toBe('Dog');
  });

  it('does not fan out the due date, which is per-row', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().updateTask(rows[0].id, { dueDate: new Date(2025, 8, 11, 12, 0, 0).toISOString() });

    expect(new Date(useTaskStore.getState().tasks.find(t => t.id === rows[1].id)!.dueDate!).getDate()).toBe(15);
  });

  it("re-anchors a fanned-out reminder onto each date's own day", () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().updateTask(rows[0].id, {
      reminderTime: new Date(2025, 8, 10, 7, 15, 0).toISOString(),
    });

    const later = new Date(useTaskStore.getState().tasks.find(t => t.id === rows[1].id)!.reminderTime!);
    expect(later.getDate()).toBe(15);
    expect(later.getHours()).toBe(7);
    expect(later.getMinutes()).toBe(15);
  });

  it('fans a blocker out to the whole set', () => {
    const errand = useTaskStore.getState().addTask({ title: 'Collect the key' });
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().updateTask(rows[0].id, { blockedById: errand.id });

    expect(useTaskStore.getState().tasks.find(t => t.id === rows[1].id)!.blockedById).toBe(errand.id);
  });

  // wouldCycle() keeps the picker from offering a blocker that would close a
  // loop, but the fan-out doesn't go through the picker: naming a later date of
  // the same set handed that row a pointer at its own id, and a task waiting on
  // itself is invisible everywhere with no user action able to free it.
  it('never blocks a date on itself when the blocker is a later date of the same set', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
      new Date(2025, 8, 20, 12, 0, 0),
    ]);
    useTaskStore.getState().updateTask(rows[0].id, { blockedById: rows[2].id });

    const tasks = useTaskStore.getState().tasks;
    expect(tasks.every(t => t.blockedById !== t.id)).toBe(true);
    expect(tasks.find(t => t.id === rows[1].id)!.blockedById).toBe(rows[2].id);
    expect(tasks.find(t => t.id === rows[2].id)!.blockedById).toBeNull();
  });
});

describe('deleteSeries', () => {
  it('deletes the incomplete dates and keeps completed ones in the Logbook', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
      new Date(2025, 8, 20, 12, 0, 0),
    ]);
    useTaskStore.setState({
      tasks: useTaskStore.getState().tasks.map(t =>
        t.id === rows[0].id ? { ...t, completed: true, completedAt: new Date().toISOString() } : t
      ),
    });
    useTaskStore.getState().deleteSeries(rows[0].seriesId!);

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(rows[0].id);
    expect(tasks[0].completed).toBe(true);
  });
});

describe('completeTask — series rollover', () => {
  const makeRepeatingSet = () =>
    useTaskStore.getState().addTaskSeries(
      { title: 'Dog' },
      [new Date(2025, 8, 10, 12, 0, 0), new Date(2025, 8, 15, 12, 0, 0)],
      { monthDays: [10, 15], repeatMonths: 1 },
    );

  it('does not roll over while another date is still outstanding', () => {
    const rows = makeRepeatingSet();
    useTaskStore.getState().completeTask(rows[0].id);

    expect(useTaskStore.getState().tasks.filter(t => !t.completed)).toHaveLength(1);
  });

  it('inserts next month\'s set once every date is done', () => {
    const rows = makeRepeatingSet();
    useTaskStore.getState().completeTask(rows[0].id);
    useTaskStore.getState().completeTask(rows[1].id);

    const live = useTaskStore.getState().tasks.filter(t => !t.completed);
    expect(live).toHaveLength(2);
    const next = live.map(t => new Date(t.dueDate!)).sort((a, b) => +a - +b);
    expect(next.map(d => d.getMonth())).toEqual([9, 9]); // October
    expect(next.map(d => d.getDate())).toEqual([10, 15]);
    expect(live.every(t => t.seriesId === rows[0].seriesId)).toBe(true);
  });

  it('rolls over regardless of the order the dates are finished in', () => {
    const rows = makeRepeatingSet();
    useTaskStore.getState().completeTask(rows[1].id);
    useTaskStore.getState().completeTask(rows[0].id);

    expect(useTaskStore.getState().tasks.filter(t => !t.completed)).toHaveLength(2);
  });

  it('ends after one pass when the set does not repeat', () => {
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().completeTask(rows[0].id);
    useTaskStore.getState().completeTask(rows[1].id);

    expect(useTaskStore.getState().tasks.filter(t => !t.completed)).toHaveLength(0);
    expect(useTaskStore.getState().tasks).toHaveLength(2);
  });

  // A recurrence's next occurrence is removed when its completion is undone;
  // the set a rollover inserts is the same thing, several rows at a time, and
  // was being left behind after the completion that conjured it was taken back.
  it('takes the whole next set back out when the completion is undone', () => {
    const rows = makeRepeatingSet();
    useTaskStore.getState().completeTask(rows[0].id);
    useTaskStore.getState().completeTask(rows[1].id);
    expect(useTaskStore.getState().tasks).toHaveLength(4);

    useTaskStore.getState().undoLastAction();

    const tasks = useTaskStore.getState().tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks.map(t => t.id).sort()).toEqual(rows.map(r => r.id).sort());
    expect(tasks.find(t => t.id === rows[1].id)!.completed).toBe(false);
  });

  it('re-inserts the next set when the uncomplete is itself undone', () => {
    const rows = makeRepeatingSet();
    useTaskStore.getState().completeTask(rows[0].id);
    useTaskStore.getState().completeTask(rows[1].id);

    useTaskStore.getState().uncompleteTask(rows[1].id);
    useTaskStore.getState().lastAction!.undo();

    const live = useTaskStore.getState().tasks.filter(t => !t.completed);
    expect(live.map(t => new Date(t.dueDate!).getDate()).sort((a, b) => a - b)).toEqual([10, 15]);
    expect(live.every(t => new Date(t.dueDate!).getMonth() === 9)).toBe(true);
  });

  it('keeps a date the user completed themselves out of the undo', () => {
    const rows = makeRepeatingSet();
    useTaskStore.getState().completeTask(rows[0].id);
    useTaskStore.getState().completeTask(rows[1].id);
    const next = useTaskStore.getState().tasks.filter(t => !t.completed);
    useTaskStore.getState().completeTask(next[0].id);

    useTaskStore.getState().uncompleteTask(rows[1].id);

    // The October date the user actually ticked survives; only the untouched
    // one goes back out with the completion that created it.
    expect(useTaskStore.getState().tasks.map(t => t.id)).toContain(next[0].id);
    expect(useTaskStore.getState().tasks.map(t => t.id)).not.toContain(next[1].id);
  });

  it('collapses to one roster entry for a stack after a rollover', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    const rows = useTaskStore.getState().addTaskSeries(
      { title: 'Dog', groupId: 'g1' },
      [new Date(2025, 8, 10, 12, 0, 0), new Date(2025, 8, 15, 12, 0, 0)],
      { monthDays: [10, 15], repeatMonths: 1 },
    );
    useTaskStore.getState().completeTask(rows[0].id);
    useTaskStore.getState().completeTask(rows[1].id);

    expect(useTaskStore.getState().groupRosterOf('g1')).toHaveLength(1);
  });
});

// ─── Waiting on (blockedById) ─────────────────────────────────────────────────

describe('blocking', () => {
  const TODAY = new Date(2025, 5, 10, 0, 0, 0).toISOString();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 10, 0, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists blocked tasks under waitingTasks and keeps them off Today', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'blocker', title: 'Cancel the internet plan', dueDate: TODAY }),
        makeTask({ id: 'waiter', title: 'Return the router', dueDate: TODAY, blockedById: 'blocker' }),
      ],
    });

    expect(useTaskStore.getState().waitingTasks().map(t => t.id)).toEqual(['waiter']);
    expect(useTaskStore.getState().visibleTasks().map(t => t.id)).toEqual(['blocker']);
  });

  it('sets the relationship from the blocking task, and releases what it drops', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'blocker', dueDate: TODAY }),
        makeTask({ id: 'was', dueDate: TODAY, blockedById: 'blocker' }),
        makeTask({ id: 'now', dueDate: TODAY }),
      ],
    });

    useTaskStore.getState().setBlockedTasks('blocker', ['now']);

    const byId = (id: string) => useTaskStore.getState().tasks.find(t => t.id === id)!;
    expect(byId('now').blockedById).toBe('blocker');
    expect(byId('was').blockedById).toBeNull();
    expect(useTaskStore.getState().blockedTasksOf('blocker').map(t => t.id)).toEqual(['now']);
  });

  it('leaves a completed waiter pointing at what held it up', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'blocker', dueDate: TODAY }),
        makeTask({ id: 'done', dueDate: TODAY, blockedById: 'blocker', completed: true }),
      ],
    });

    useTaskStore.getState().setBlockedTasks('blocker', []);

    expect(useTaskStore.getState().tasks.find(t => t.id === 'done')!.blockedById).toBe('blocker');
  });

  // Releasing one date of a dated set fans that release out to the set's later
  // dates (blockedById is a content field), so a set half-kept has to come back
  // out the other side still blocked.
  it('keeps the dates of a set it is keeping when it releases an earlier one', () => {
    const blocker = useTaskStore.getState().addTask({ title: 'Collect the key' });
    const rows = useTaskStore.getState().addTaskSeries({ title: 'Dog' }, [
      new Date(2025, 8, 10, 12, 0, 0),
      new Date(2025, 8, 15, 12, 0, 0),
    ]);
    useTaskStore.getState().updateTask(rows[0].id, { blockedById: blocker.id });

    useTaskStore.getState().setBlockedTasks(blocker.id, [rows[1].id]);

    const byId = (id: string) => useTaskStore.getState().tasks.find(t => t.id === id)!;
    expect(byId(rows[0].id).blockedById).toBeNull();
    expect(byId(rows[1].id).blockedById).toBe(blocker.id);
  });

  // The picker can't offer one, but the editor holds its set while the store
  // moves on underneath it, so the write re-checks.
  it('refuses a link that would close a loop', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', dueDate: TODAY, blockedById: 'b' }),
        makeTask({ id: 'b', dueDate: TODAY }),
      ],
    });

    useTaskStore.getState().setBlockedTasks('a', ['b']);

    expect(useTaskStore.getState().tasks.find(t => t.id === 'b')!.blockedById).toBeNull();
  });

  it('surfaces the waiter when the blocker is completed, without writing anything to it', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'blocker', dueDate: TODAY }),
        makeTask({ id: 'waiter', dueDate: TODAY, blockedById: 'blocker' }),
      ],
    });

    useTaskStore.getState().completeTask('blocker');

    // 'blocker' itself lingers here for the completion-hold window, so this
    // asserts the waiter arrived rather than the exact list.
    expect(useTaskStore.getState().visibleTasks().map(t => t.id)).toContain('waiter');
    expect(useTaskStore.getState().waitingTasks()).toEqual([]);
    // The link is untouched — nothing "unblocks" a task, the state is derived.
    expect(useTaskStore.getState().tasks.find(t => t.id === 'waiter')!.blockedById).toBe('blocker');
  });

  it('re-blocks the waiter when the blocker is uncompleted', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'blocker', dueDate: TODAY }),
        makeTask({ id: 'waiter', dueDate: TODAY, blockedById: 'blocker' }),
      ],
    });

    useTaskStore.getState().completeTask('blocker');
    expect(useTaskStore.getState().waitingTasks()).toEqual([]);

    useTaskStore.getState().uncompleteTask('blocker');
    expect(useTaskStore.getState().waitingTasks().map(t => t.id)).toEqual(['waiter']);
  });

  it('frees the waiter when the blocker is deleted rather than stranding it', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'blocker', dueDate: TODAY }),
        makeTask({ id: 'waiter', dueDate: TODAY, blockedById: 'blocker' }),
      ],
    });

    useTaskStore.getState().deleteTask('blocker');

    expect(useTaskStore.getState().waitingTasks()).toEqual([]);
    expect(useTaskStore.getState().visibleTasks().map(t => t.id)).toEqual(['waiter']);
  });

  it('frees the waiter when the blocker is archived', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'blocker', dueDate: TODAY }),
        makeTask({ id: 'waiter', dueDate: TODAY, blockedById: 'blocker' }),
      ],
    });

    useTaskStore.getState().archiveTask('blocker');

    expect(useTaskStore.getState().waitingTasks()).toEqual([]);
    expect(useTaskStore.getState().visibleTasks().map(t => t.id)).toEqual(['waiter']);
  });

  // The deliberate semantic: a recurring blocker's completion spawns a NEW row
  // with a new id, so the waiter keeps pointing at the completed original and
  // is freed for good — "wait for trash day to happen once", not every week.
  it('unblocks permanently when a recurring blocker is completed', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'bins', title: 'Put the bins out', dueDate: TODAY, recurrenceType: 'weekly', recurrenceDays: [2] }),
        makeTask({ id: 'waiter', title: 'Scrub the bin', dueDate: TODAY, blockedById: 'bins' }),
      ],
    });

    useTaskStore.getState().completeTask('bins');

    const spawned = useTaskStore.getState().tasks.find(t => !t.completed && t.title === 'Put the bins out');
    expect(spawned).toBeDefined();
    expect(spawned!.id).not.toBe('bins');
    expect(useTaskStore.getState().waitingTasks()).toEqual([]);
  });

  it('keeps a blocked task out of the Inbox and Unscheduled selectors', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'blocker', dueDate: TODAY }),
        makeTask({ id: 'bare', blockedById: 'blocker' }),
        makeTask({ id: 'filed', blockedById: 'blocker', category: 'Home' }),
      ],
    });

    expect(useTaskStore.getState().inboxTasks()).toEqual([]);
    expect(useTaskStore.getState().unscheduledTasks()).toEqual([]);
    expect(useTaskStore.getState().waitingTasks().map(t => t.id).sort()).toEqual(['bare', 'filed']);
  });

  it('groups the waiting list by blocker', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'aaa' }),
        makeTask({ id: 'bbb' }),
        makeTask({ id: 'w1', blockedById: 'bbb', sortOrder: 0 }),
        makeTask({ id: 'w2', blockedById: 'aaa', sortOrder: 1 }),
        makeTask({ id: 'w3', blockedById: 'bbb', sortOrder: 2 }),
      ],
    });

    expect(useTaskStore.getState().waitingTasks().map(t => t.id)).toEqual(['w2', 'w1', 'w3']);
  });
});

describe('pending Apple Reminders imports', () => {
  const SUGGESTION = {
    recurrenceType: 'daily' as const,
    recurrenceInterval: 1,
    recurrenceFromCompletion: true,
    title: 'go running',
  };

  it('leaves a task with a pending suggestion in the Inbox', () => {
    // The regression that matters most. Every field the suggestion holds is one
    // isInboxTask treats as "filed" — if any of them leaked onto the row, or if
    // isInboxTask ever started reading pendingImport, an unreviewed voice
    // capture would file itself onto Today and the whole feature would be
    // pointless.
    useTaskStore.setState({
      tasks: [
        makeTask({
          id: 'imported',
          title: 'go running every day after completion',
          pendingImport: SUGGESTION,
        }),
      ],
    });

    expect(useTaskStore.getState().inboxTasks().map(t => t.id)).toEqual(['imported']);
  });

  it('applies the suggestion and clears it, which is what takes the task out of the Inbox', () => {
    const task = useTaskStore.getState().addTask({
      title: 'go running every day after completion',
      pendingImport: SUGGESTION,
    });

    useTaskStore.getState().applyPendingImport(task.id);

    const applied = useTaskStore.getState().tasks.find(t => t.id === task.id)!;
    expect(applied.recurrenceType).toBe('daily');
    expect(applied.recurrenceFromCompletion).toBe(true);
    expect(applied.title).toBe('go running');
    expect(applied.pendingImport).toBeNull();
    expect(useTaskStore.getState().inboxTasks()).toEqual([]);
  });

  it('dismisses the suggestion, keeping the title exactly as it was dictated', () => {
    const task = useTaskStore.getState().addTask({
      title: 'go running every day after completion',
      pendingImport: SUGGESTION,
    });

    useTaskStore.getState().dismissPendingImport(task.id);

    const kept = useTaskStore.getState().tasks.find(t => t.id === task.id)!;
    expect(kept.pendingImport).toBeNull();
    // The stripped title was never written to the row, so there is nothing to
    // put back — the task still says what the user said.
    expect(kept.title).toBe('go running every day after completion');
    expect(kept.recurrenceType).toBe('none');
    expect(useTaskStore.getState().inboxTasks().map(t => t.id)).toEqual([task.id]);
  });

  it('schedules the notification when an applied suggestion carries a reminder', () => {
    const at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const task = useTaskStore.getState().addTask({
      title: 'Pay rent',
      pendingImport: { reminderTime: at },
    });
    (scheduleTaskReminder as jest.Mock).mockClear();

    useTaskStore.getState().applyPendingImport(task.id);

    // updateTask reschedules whenever reminderTime is among the updates; this
    // is the path a suggestion's alarm actually arrives by.
    expect(scheduleTaskReminder).toHaveBeenCalled();
    expect(useTaskStore.getState().tasks.find(t => t.id === task.id)!.reminderTime).toBe(at);
  });

  it('does nothing for a task with no suggestion, or one that is gone', () => {
    const task = useTaskStore.getState().addTask({ title: 'Plain' });

    useTaskStore.getState().applyPendingImport(task.id);
    useTaskStore.getState().dismissPendingImport(task.id);
    useTaskStore.getState().applyPendingImport('does-not-exist');

    expect(useTaskStore.getState().tasks.find(t => t.id === task.id)!.title).toBe('Plain');
  });
});

// ─── placing a newly added task at a chosen seam ─────────────────────────────
//
// The in-card add button (MiniFab) can be dropped between two rows rather than
// tapped. Both store adds append, so the editors place by adding and then
// handing the whole intended order back — these cover that two-step, which is
// the part that can silently put a row somewhere nobody asked for.

describe('placing a new subtask at an index', () => {
  const seed = () => useTaskStore.setState({
    tasks: [
      makeTask({ id: 'p' }),
      makeTask({ id: 'a', parentId: 'p', sortOrder: 1 }),
      makeTask({ id: 'b', parentId: 'p', sortOrder: 2 }),
    ],
  });

  // What TaskEditor's commitSubtask does: snapshot, add, splice, renumber.
  const addAt = (index: number) => {
    const ids = useTaskStore.getState().subtasksOf('p').map(s => s.id);
    const created = useTaskStore.getState().addSubtask('p', 'new');
    ids.splice(index, 0, created.id);
    useTaskStore.getState().reorderSubtasks('p', ids);
    return created;
  };

  it('drops the new subtask into the middle of its siblings', () => {
    seed();
    const created = addAt(1);
    expect(useTaskStore.getState().subtasksOf('p').map(s => s.id)).toEqual(['a', created.id, 'b']);
  });

  it('places at the very front', () => {
    seed();
    const created = addAt(0);
    expect(useTaskStore.getState().subtasksOf('p').map(s => s.id)).toEqual([created.id, 'a', 'b']);
  });

  it('renumbers the whole run 1..n, leaving no gaps behind', () => {
    seed();
    addAt(1);
    expect(useTaskStore.getState().subtasksOf('p').map(s => s.sortOrder)).toEqual([1, 2, 3]);
  });

  it('leaves another parent\'s subtasks alone', () => {
    seed();
    useTaskStore.setState({
      tasks: [...useTaskStore.getState().tasks, makeTask({ id: 'q-sub', parentId: 'q', sortOrder: 7 })],
    });
    addAt(0);
    expect(useTaskStore.getState().tasks.find(t => t.id === 'q-sub')!.sortOrder).toBe(7);
  });
});

describe('placing a new stack member at an index', () => {
  // A roster of two with a completion tombstone sitting between them — the
  // shape that makes this more than a splice. The roster hides the tombstone,
  // so the editor can only hand back roster order, and reorderGroupChildren
  // has to fold that back into the full child list.
  const seedWithTombstone = (tombstoneOrder: number) => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'A', groupId: 'g1', sortOrder: tombstoneOrder === 1 ? 2 : 1 }),
        makeTask({
          id: 'T', groupId: 'g1', sortOrder: tombstoneOrder,
          completed: true, completedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        }),
        makeTask({ id: 'B', groupId: 'g1', sortOrder: 3 }),
      ],
    });
  };

  // What TaskGroupEditor's commitChild does.
  const addAt = (index: number) => {
    const ids = useTaskStore.getState().groupRosterOf('g1').map(m => m.id);
    const created = useTaskStore.getState().addNewGroupedTask('g1', 'new');
    ids.splice(index, 0, created.id);
    useTaskStore.getState().reorderGroupChildren('g1', ids);
    return created;
  };

  it('places the new member in roster order, tombstone in the middle', () => {
    seedWithTombstone(2);
    expect(useTaskStore.getState().groupRosterOf('g1').map(t => t.id)).toEqual(['A', 'B']);
    const created = addAt(1);
    expect(useTaskStore.getState().groupRosterOf('g1').map(t => t.id))
      .toEqual(['A', created.id, 'B']);
  });

  it('leaves the tombstone in its own slot rather than renumbering over it', () => {
    seedWithTombstone(2);
    addAt(1);
    // The tombstone keeps the position it held among ALL the children; only
    // the roster's own ids were rearranged around it.
    const all = useTaskStore.getState().groupChildrenOf('g1').map(t => t.id);
    expect(all).toHaveLength(4);
    expect(all[1]).toBe('T');
  });

  it('handles a tombstone sitting at the front', () => {
    seedWithTombstone(1);
    const created = addAt(1);
    expect(useTaskStore.getState().groupRosterOf('g1').map(t => t.id))
      .toEqual(['A', created.id, 'B']);
    expect(useTaskStore.getState().groupChildrenOf('g1')[0].id).toBe('T');
  });

  it('places at the front of the roster', () => {
    seedWithTombstone(2);
    const created = addAt(0);
    expect(useTaskStore.getState().groupRosterOf('g1').map(t => t.id))
      .toEqual([created.id, 'A', 'B']);
  });
});

// ─── postpone counting ───
//
// The rule itself is tested in postpone.test.ts; these cover the wiring — which
// store paths count a move, which opt out, and what survives an undo.
describe('postponeCount', () => {
  // Fixed "now" so "today" and "tomorrow" are unambiguous, matching the
  // dayResetTime: '00:00' the shared beforeEach installs.
  const TODAY = new Date(2025, 5, 10, 12, 0, 0);
  const TOMORROW = new Date(2025, 5, 11, 12, 0, 0);
  const NEXT_WEEK = new Date(2025, 5, 17, 12, 0, 0);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 9, 0, 0));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const dueToday = (overrides: Partial<Task> = {}) =>
    makeTask({ id: 'a', dueDate: TODAY.toISOString(), ...overrides });

  it('counts a hand-picked push through updateTask', () => {
    useTaskStore.setState({ tasks: [dueToday()] });
    useTaskStore.getState().updateTask('a', { dueDate: TOMORROW.toISOString() });
    expect(useTaskStore.getState().tasks[0].postponeCount).toBe(1);
  });

  it('accumulates across successive pushes', () => {
    useTaskStore.setState({ tasks: [dueToday({ postponeCount: 3 })] });
    useTaskStore.getState().updateTask('a', { dueDate: TOMORROW.toISOString() });
    expect(useTaskStore.getState().tasks[0].postponeCount).toBe(4);
  });

  it('clears the count when the task is pulled back to today', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', dueDate: NEXT_WEEK.toISOString(), postponeCount: 6 })],
    });
    useTaskStore.getState().updateTask('a', { dueDate: TODAY.toISOString() });
    expect(useTaskStore.getState().tasks[0].postponeCount).toBe(0);
  });

  it('leaves the count alone on an edit that touches no date', () => {
    // TaskEditor's save payload writes dueDate on every save, so an unchanged
    // date must not read as a resolve — that would zero the count on a rename.
    useTaskStore.setState({ tasks: [dueToday({ postponeCount: 4 })] });
    useTaskStore.getState().updateTask('a', { title: 'Renamed', dueDate: TODAY.toISOString() });
    expect(useTaskStore.getState().tasks[0].postponeCount).toBe(4);
  });

  it('restores the previous count when a push is undone', () => {
    // Every undo in the app replays a whole pre-write snapshot, which names
    // postponeCount and so wins over the derived value.
    const snapshot = dueToday({ postponeCount: 2 });
    useTaskStore.setState({ tasks: [snapshot] });
    useTaskStore.getState().updateTask('a', { dueDate: TOMORROW.toISOString() });
    expect(useTaskStore.getState().tasks[0].postponeCount).toBe(3);

    useTaskStore.getState().updateTask('a', { ...snapshot });
    expect(useTaskStore.getState().tasks[0].postponeCount).toBe(2);
  });

  it('counts a bulk reschedule per task, from where each one was', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', dueDate: TODAY.toISOString(), postponeCount: 1 }),
        // Already scheduled for next week, so moving it further out is
        // re-planning, not ducking — it must not count.
        makeTask({ id: 'b', dueDate: NEXT_WEEK.toISOString(), postponeCount: 1 }),
      ],
    });
    useTaskStore.getState().bulkSetWhen(['a', 'b'], new Date(2025, 5, 20, 12, 0, 0), []);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'a')?.postponeCount).toBe(2);
    expect(tasks.find(t => t.id === 'b')?.postponeCount).toBe(1);
    // The count and the day it started from go in one write, so a batch can
    // never leave a row claiming pushes with no start. The stamp is the *day*
    // the task was leaving, not the instant it held — the screen renders a date.
    expect(dbBatchUpdatePostponeCounts).toHaveBeenCalledWith([
      { id: 'a', postponeCount: 2, driftingSince: new Date(2025, 5, 10).toISOString() },
    ]);
  });

  it('counts a bulk defer without being confused by the untouched dueDate', () => {
    useTaskStore.setState({ tasks: [dueToday()] });
    useTaskStore.getState().bulkDefer(['a'], NEXT_WEEK);
    expect(useTaskStore.getState().tasks[0].postponeCount).toBe(1);
  });

  it('counts a deload move but survives its undo', () => {
    // Deload is deliberately counted — it's the most explicit "push today's
    // work" gesture there is. Its undo is a narrow patch, so the count has to
    // ride along in the snapshot or the restore would zero it.
    useTaskStore.setState({ tasks: [dueToday({ postponeCount: 2 })] });
    useTaskStore.getState().deloadTasks([{ id: 'a', updates: { dueDate: NEXT_WEEK.toISOString() } }]);
    expect(useTaskStore.getState().tasks[0].postponeCount).toBe(3);

    useTaskStore.getState().lastAction?.undo();
    expect(useTaskStore.getState().tasks[0].postponeCount).toBe(2);
  });

  it('does not count a recurrence skip', () => {
    useTaskStore.setState({
      tasks: [dueToday({ recurrenceType: 'daily', postponeCount: 2 })],
    });
    useTaskStore.getState().skipNextRecurrence('a');
    expect(useTaskStore.getState().tasks[0].postponeCount).toBe(2);
  });

  it('gives a recurring successor a clean count but keeps the mute', () => {
    useTaskStore.setState({
      tasks: [dueToday({ recurrenceType: 'daily', postponeCount: 5, postponeMuted: true })],
    });
    useTaskStore.getState().completeTask('a');
    const successor = useTaskStore.getState().tasks.find(t => t.id !== 'a');
    expect(successor?.postponeCount).toBe(0);
    expect(successor?.postponeMuted).toBe(true);
  });

  it('never captures either field into seriesDefaults', () => {
    // They aren't CONTENT_FIELDS, and mustn't become them: seriesDefaults is
    // applied on top of the row that spawns the next occurrence, so a captured
    // count would undo the reset above.
    useTaskStore.setState({ tasks: [dueToday({ postponeCount: 4 })] });
    useTaskStore.getState().updateTask('a', { title: 'Scoped edit' }, { scope: 'occurrence' });
    const defaults = useTaskStore.getState().tasks[0].seriesDefaults ?? {};
    expect(defaults).not.toHaveProperty('postponeCount');
    expect(defaults).not.toHaveProperty('postponeMuted');
  });

  it('starts a brand-new task at zero', () => {
    const created = useTaskStore.getState().addTask({ title: 'Fresh' });
    expect(created.postponeCount).toBe(0);
    expect(created.postponeMuted).toBe(false);
  });
});

// ─── Use-up tasks, from the task side (#1106) ───────────────────────────────
//
// The grocery half is covered in useGroceryStore.test.ts against a mocked task
// store; this is the other direction, against the real one.

describe('deleting a use-up task', () => {
  const item = {
    id: 'g-1', name: 'Spinach', nameKey: 'spinach', preferredProductId: null, productStrict: false, variant: null, aisle: 'Produce', quantity: null, quantityFromRecipe: false, note: '',
    onList: false, checked: false, inCatalog: true, sortOrder: 1, purchaseCount: 3,
    lastAddedAt: null, lastPurchasedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null, sourceRecipeId: null, sourceRecipeTitle: null, choiceGroup: null,
    isStaple: false, expiresAt: '2026-08-17', frozenAt: null, openedAt: null, runningLowAt: null, shelfLifeDays: null, useUpTask: null,
    pantryCheckDeclinedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [],
  };

  const seedItem = () => {
    useGroceryStore.setState({
      items: [{ ...item }], aisleOrder: [], hiddenAisles: [], aisleOverrides: {},
      shops: [], itemShops: [], lastShopId: null, cartHoldIds: [], initialized: true,
    });
  };

  it('records the item\'s opt-out, so the next purchase doesn\'t hand it back', () => {
    seedItem();
    const task = useTaskStore.getState().addTask({ title: 'Use up Spinach', generatedKind: 'groceryUseUp', generatedSourceId: 'g-1' });

    useTaskStore.getState().deleteTask(task.id);

    expect(useGroceryStore.getState().items[0].useUpTask).toBe(false);
  });

  it('undo clears the opt-out again, and leaves the restored task alone', () => {
    seedItem();
    const task = useTaskStore.getState().addTask({ title: 'Use up Spinach', generatedKind: 'groceryUseUp', generatedSourceId: 'g-1' });
    useTaskStore.getState().deleteTask(task.id);

    useTaskStore.getState().lastAction!.undo();

    expect(useGroceryStore.getState().items[0].useUpTask).toBeNull();
    expect(useTaskStore.getState().tasks.find(t => t.id === task.id)).toBeDefined();
  });

  it('leaves an ordinary task\'s delete alone', () => {
    seedItem();
    const task = useTaskStore.getState().addTask({ title: 'Buy stamps' });

    useTaskStore.getState().deleteTask(task.id);

    expect(useGroceryStore.getState().items[0].useUpTask).toBeNull();
  });
});

describe('completing a use-up task', () => {
  const groceryItem = {
    id: 'g-1', name: 'Spinach', nameKey: 'spinach', preferredProductId: null, productStrict: false, variant: null, aisle: 'Produce', quantity: null, quantityFromRecipe: false, note: '',
    onList: false, checked: false, inCatalog: true, sortOrder: 1, purchaseCount: 3,
    lastAddedAt: null, lastPurchasedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null, sourceRecipeId: null, sourceRecipeTitle: null, choiceGroup: null,
    isStaple: false, expiresAt: '2026-08-17', frozenAt: null, openedAt: null, runningLowAt: null, shelfLifeDays: null, useUpTask: null,
    pantryCheckDeclinedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [],
  };
  const seedItem = () => {
    useGroceryStore.setState({
      items: [{ ...groceryItem }], aisleOrder: [], hiddenAisles: [], aisleOverrides: {},
      shops: [], itemShops: [], lastShopId: null, cartHoldIds: [], pendingUseUpItemId: null, initialized: true,
    });
  };

  const leftover = {
    id: 'l-1', title: 'Chicken stir-fry', recipeId: null, sourceEntryId: null,
    storedAt: '2026-08-10T18:00:00.000Z', keepUntil: '2026-08-14', finishedAt: null,
    outcome: null, frozenAt: null, createdAt: '2026-08-10T18:00:00.000Z', useUpTask: null,
  };
  const seedLeftover = () => {
    useLeftoverStore.setState({ leftovers: [{ ...leftover }], pendingUseUpLeftoverId: null, initialized: true });
  };

  it('points the pantry at the item whose use-up task was just completed', () => {
    seedItem();
    const task = useTaskStore.getState().addTask({ title: 'Use up Spinach', generatedKind: 'groceryUseUp', generatedSourceId: 'g-1' });

    useTaskStore.getState().completeTask(task.id);

    expect(useGroceryStore.getState().pendingUseUpItemId).toBe('g-1');
  });

  it('points the fridge at the leftover whose use-up task was just completed', () => {
    seedLeftover();
    const task = useTaskStore.getState().addTask({ title: 'Use up Chicken stir-fry', generatedKind: 'leftoverUseUp', generatedSourceId: 'l-1' });

    useTaskStore.getState().completeTask(task.id);

    expect(useLeftoverStore.getState().pendingUseUpLeftoverId).toBe('l-1');
  });

  it('leaves an ordinary task\'s completion alone', () => {
    seedItem();
    seedLeftover();
    const task = useTaskStore.getState().addTask({ title: 'Buy stamps' });

    useTaskStore.getState().completeTask(task.id);

    expect(useGroceryStore.getState().pendingUseUpItemId).toBeNull();
    expect(useLeftoverStore.getState().pendingUseUpLeftoverId).toBeNull();
  });

  it('does not prompt when the deadline passed instead of it being resolved', () => {
    seedItem();
    const task = useTaskStore.getState().addTask({ title: 'Use up Spinach', generatedKind: 'groceryUseUp', generatedSourceId: 'g-1' });

    useTaskStore.getState().completeTask(task.id, { missed: true });

    expect(useGroceryStore.getState().pendingUseUpItemId).toBeNull();
  });

  it('retracts the prompt when the completion is undone', () => {
    seedItem();
    const task = useTaskStore.getState().addTask({ title: 'Use up Spinach', generatedKind: 'groceryUseUp', generatedSourceId: 'g-1' });
    useTaskStore.getState().completeTask(task.id);
    expect(useGroceryStore.getState().pendingUseUpItemId).toBe('g-1');

    useTaskStore.getState().lastAction!.undo();

    expect(useGroceryStore.getState().pendingUseUpItemId).toBeNull();
  });

  it('retracts the prompt on a direct uncomplete too, e.g. from the Logbook', () => {
    seedLeftover();
    const task = useTaskStore.getState().addTask({ title: 'Use up Chicken stir-fry', generatedKind: 'leftoverUseUp', generatedSourceId: 'l-1' });
    useTaskStore.getState().completeTask(task.id);
    expect(useLeftoverStore.getState().pendingUseUpLeftoverId).toBe('l-1');

    useTaskStore.getState().uncompleteTask(task.id);

    expect(useLeftoverStore.getState().pendingUseUpLeftoverId).toBeNull();
  });
});

// ─── Extra task (every Nth completion) ───────────────────────────────────────

describe('completeTask: extra task every Nth completion', () => {
  const practice = (overrides: Partial<Task> = {}) => makeTask({
    id: 'practice',
    title: 'Practice violin',
    recurrenceType: 'daily',
    recurrenceInterval: 1,
    dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
    extraTaskEveryN: 4,
    extraTaskTitle: 'Rosin the bow',
    ...overrides,
  });

  /** Completes the live occurrence and returns the one it spawned. */
  const completeOccurrence = (id: string) => {
    useTaskStore.getState().completeTask(id);
    return useTaskStore.getState().tasks.find(
      t => !t.completed && t.title === 'Practice violin'
    )!;
  };

  const extras = () =>
    useTaskStore.getState().tasks.filter(t => t.title === 'Rosin the bow');

  it('counts completions up without adding anything before the Nth', () => {
    useTaskStore.setState({ tasks: [practice()] });

    let live = completeOccurrence('practice');
    expect(live.extraTaskTally).toBe(1);
    expect(extras()).toHaveLength(0);

    live = completeOccurrence(live.id);
    expect(live.extraTaskTally).toBe(2);
    expect(extras()).toHaveLength(0);
  });

  it('adds the task on the Nth completion and starts the count again', () => {
    useTaskStore.setState({ tasks: [practice({ extraTaskTally: 3 })] });

    const live = completeOccurrence('practice');
    expect(extras()).toHaveLength(1);
    expect(live.extraTaskTally).toBe(0);
  });

  it('carries the tally across occurrences, since each one is a fresh id', () => {
    useTaskStore.setState({ tasks: [practice()] });

    let live = practice();
    let id = 'practice';
    for (let i = 0; i < 4; i++) {
      live = completeOccurrence(id);
      id = live.id;
    }
    expect(extras()).toHaveLength(1);
    expect(live.id).not.toBe('practice');
  });

  it('dates it with the next occurrence rather than the completion that earned it', () => {
    useTaskStore.setState({ tasks: [practice({ extraTaskTally: 3 })] });

    const live = completeOccurrence('practice');
    expect(extras()[0].dueDate).toBe(live.dueDate);
  });

  it('makes a top-level task filed where the one that spawned it lives', () => {
    useTaskStore.setState({
      tasks: [practice({ extraTaskTally: 3, category: 'Music', projectId: 'p1' })],
    });

    useTaskStore.getState().completeTask('practice');
    const extra = extras()[0];
    expect(extra.parentId).toBeNull();
    expect(extra.category).toBe('Music');
    expect(extra.projectId).toBe('p1');
    expect(extra.recurrenceType).toBe('none');
    expect(extra.completed).toBe(false);
  });

  // Both halves are needed for the rule to be live, so a half-filled one is
  // inert rather than half-applied: the count is left exactly where it was,
  // and naming the task later picks up from there.
  it('adds nothing and does not count without a title', () => {
    useTaskStore.setState({
      tasks: [practice({ extraTaskTally: 3, extraTaskTitle: null })],
    });

    const live = completeOccurrence('practice');
    expect(useTaskStore.getState().tasks.filter(t => !t.completed)).toHaveLength(1);
    expect(live.extraTaskTally).toBe(3);
  });

  it('does not count a miss — the rule counts completions', () => {
    useTaskStore.setState({ tasks: [practice({ extraTaskTally: 3 })] });

    useTaskStore.getState().markMissed('practice');
    expect(extras()).toHaveLength(0);
    const live = useTaskStore.getState().tasks.find(t => !t.completed)!;
    expect(live.extraTaskTally).toBe(3);
  });

  it('counts a run through a chain once, not once per step', () => {
    useTaskStore.setState({
      tasks: [practice({
        extraTaskTally: 3,
        chainEnabled: true,
        chainIndex: 0,
        chainItems: [
          { id: 'c1', title: 'Scales', estimatedMinutes: null },
          { id: 'c2', title: 'Etude', estimatedMinutes: null },
        ],
      })],
    });

    // First step: mid-chain, so the task hasn't been completed yet.
    const midChain = completeOccurrence('practice');
    expect(extras()).toHaveLength(0);
    expect(midChain.extraTaskTally).toBe(3);

    // Last step finishes the run, which is the completion the rule counts.
    completeOccurrence(midChain.id);
    expect(extras()).toHaveLength(1);
  });

  it('takes the task back and restores the tally when the completion is undone', () => {
    useTaskStore.setState({ tasks: [practice({ extraTaskTally: 3 })] });

    useTaskStore.getState().completeTask('practice');
    expect(extras()).toHaveLength(1);

    useTaskStore.getState().uncompleteTask('practice');
    expect(extras()).toHaveLength(0);
    const restored = useTaskStore.getState().tasks.find(t => t.id === 'practice')!;
    expect(restored.extraTaskTally).toBe(3);
    expect(restored.completed).toBe(false);
  });

  it('restores a mid-cycle tally too, rather than leaving it incremented', () => {
    useTaskStore.setState({ tasks: [practice({ extraTaskTally: 1 })] });

    useTaskStore.getState().completeTask('practice');
    useTaskStore.getState().uncompleteTask('practice');
    expect(useTaskStore.getState().tasks.find(t => t.id === 'practice')!.extraTaskTally).toBe(1);
  });

  it('leaves a task with no rule completely alone', () => {
    useTaskStore.setState({
      tasks: [practice({ extraTaskEveryN: null, extraTaskTitle: null })],
    });

    const live = completeOccurrence('practice');
    expect(live.extraTaskTally).toBe(0);
    expect(useTaskStore.getState().tasks.filter(t => !t.completed)).toHaveLength(1);
  });

  // ── What the added task looks like past its title (Task.extraTaskDraft) ──

  describe('the draft the rule carries', () => {
    it('applies every field the draft names', () => {
      useTaskStore.setState({
        tasks: [practice({
          extraTaskTally: 3,
          category: 'Music',
          projectId: 'p1',
          extraTaskDraft: {
            notes: 'The tin lives in the case pocket',
            category: 'Home',
            projectId: 'p2',
            tags: ['upkeep'],
            priority: 3,
            effort: 1,
            estimatedMinutes: 5,
            timeSegments: ['evening'],
            subtasks: [],
          },
        })],
      });

      useTaskStore.getState().completeTask('practice');

      const extra = extras()[0];
      expect(extra.notes).toBe('The tin lives in the case pocket');
      expect(extra.category).toBe('Home');
      expect(extra.projectId).toBe('p2');
      expect(extra.tags).toEqual(['upkeep']);
      expect(extra.priority).toBe(3);
      expect(extra.effort).toBe(1);
      expect(extra.estimatedMinutes).toBe(5);
      expect(extra.timeSegments).toEqual(['evening']);
    });

    // Null on the draft is "the same as the task that spawned it", not "no
    // category" — filing it there is what keeps it out of the loose section
    // above the categories.
    it('follows the spawning task where the draft says nothing', () => {
      useTaskStore.setState({
        tasks: [practice({
          extraTaskTally: 3,
          category: 'Music',
          projectId: 'p1',
          extraTaskDraft: { ...emptyExtraTaskDraft(), notes: 'Just a note' },
        })],
      });

      useTaskStore.getState().completeTask('practice');

      const extra = extras()[0];
      expect(extra.category).toBe('Music');
      expect(extra.projectId).toBe('p1');
      expect(extra.notes).toBe('Just a note');
    });

    // The behaviour of every rule written before drafts existed.
    it('adds a bare task filed with its parent when there is no draft', () => {
      useTaskStore.setState({
        tasks: [practice({ extraTaskTally: 3, category: 'Music', tags: ['violin'], priority: 4 })],
      });

      useTaskStore.getState().completeTask('practice');

      const extra = extras()[0];
      expect(extra.category).toBe('Music');
      expect(extra.notes).toBe('');
      // Never inherited: they describe the task that spawned it, and this is
      // a different piece of work.
      expect(extra.tags).toEqual([]);
      expect(extra.priority).toBe(0);
    });

    it('creates the draft\'s subtasks as real rows under it, unchecked and in order', () => {
      useTaskStore.setState({
        tasks: [practice({
          extraTaskTally: 3,
          extraTaskDraft: {
            ...emptyExtraTaskDraft(),
            subtasks: [
              { id: 's1', title: 'Wipe the strings' },
              { id: 's2', title: 'Tighten the bow' },
            ],
          },
        })],
      });

      useTaskStore.getState().completeTask('practice');

      const extra = extras().find(t => t.parentId === null)!;
      const subs = useTaskStore.getState().tasks
        .filter(t => t.parentId === extra.id)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      expect(subs.map(t => t.title)).toEqual(['Wipe the strings', 'Tighten the bow']);
      expect(subs.every(t => !t.completed)).toBe(true);
    });

    it('takes the subtasks back with the task when the completion is undone', () => {
      useTaskStore.setState({
        tasks: [practice({
          extraTaskTally: 3,
          extraTaskDraft: {
            ...emptyExtraTaskDraft(),
            subtasks: [{ id: 's1', title: 'Wipe the strings' }],
          },
        })],
      });

      useTaskStore.getState().completeTask('practice');
      expect(useTaskStore.getState().tasks.filter(t => t.title === 'Wipe the strings')).toHaveLength(1);

      useTaskStore.getState().uncompleteTask('practice');
      expect(extras()).toHaveLength(0);
      expect(useTaskStore.getState().tasks.filter(t => t.title === 'Wipe the strings')).toHaveLength(0);
    });

    // Derived like the task itself: one milestone task per completion,
    // however many devices saw that completion.
    it('gives each subtask an id derived from its stub, not a fresh one', () => {
      const seed = () => useTaskStore.setState({
        tasks: [practice({
          extraTaskTally: 3,
          extraTaskDraft: {
            ...emptyExtraTaskDraft(),
            subtasks: [{ id: 's1', title: 'Wipe the strings' }],
          },
        })],
      });

      seed();
      useTaskStore.getState().completeTask('practice');
      const first = useTaskStore.getState().tasks.find(t => t.title === 'Wipe the strings')!.id;

      seed();
      useTaskStore.getState().completeTask('practice');
      const second = useTaskStore.getState().tasks.find(t => t.title === 'Wipe the strings')!.id;

      expect(first).toBe(second);
      expect(first).toBe(derivedId(spawnSeed.subtask(derivedId(spawnSeed.extra('practice')), 's1')));
    });
  });
});

describe('completeTask: decision tasks capture an answer', () => {
  const decide = (overrides: Partial<Task> = {}) => makeTask({
    id: 'trip-date',
    title: 'Pick a date for the trip',
    deliverableKind: 'date',
    ...overrides,
  });

  const rowOf = (id: string) => useTaskStore.getState().tasks.find(t => t.id === id)!;

  it('stamps the answer onto the completed row', () => {
    useTaskStore.setState({ tasks: [decide()] });

    useTaskStore.getState().completeTask('trip-date', { deliverableValue: '2026-09-12T00:00:00.000Z' });

    const row = rowOf('trip-date');
    expect(row.completed).toBe(true);
    expect(row.deliverableValue).toBe('2026-09-12T00:00:00.000Z');
  });

  it('completes with no answer when the caller has nobody to ask', () => {
    useTaskStore.setState({ tasks: [decide()] });

    // Every non-interactive path — bulk complete, the stack cascade, the
    // widget queue, the rollover sweep — completes exactly like this.
    useTaskStore.getState().completeTask('trip-date');

    const row = rowOf('trip-date');
    expect(row.completed).toBe(true);
    expect(row.deliverableValue).toBeNull();
  });

  it('completes when the answer is explicitly declined', () => {
    useTaskStore.setState({ tasks: [decide()] });

    useTaskStore.getState().completeTask('trip-date', { deliverableValue: null });

    expect(rowOf('trip-date').completed).toBe(true);
    expect(rowOf('trip-date').deliverableValue).toBeNull();
  });

  it('keeps an existing answer when a later completion says nothing', () => {
    // Un-completing keeps the answer, so re-ticking without answering again
    // must not throw away what was already decided.
    useTaskStore.setState({ tasks: [decide({ deliverableValue: 'The Anchor', deliverableKind: 'text' })] });

    useTaskStore.getState().completeTask('trip-date');

    expect(rowOf('trip-date').deliverableValue).toBe('The Anchor');
  });

  it('keeps the answer on the row when it is un-completed', () => {
    useTaskStore.setState({ tasks: [decide({ deliverableKind: 'text' })] });

    useTaskStore.getState().completeTask('trip-date', { deliverableValue: 'The Anchor' });
    useTaskStore.getState().uncompleteTask('trip-date');

    const row = rowOf('trip-date');
    expect(row.completed).toBe(false);
    expect(row.deliverableValue).toBe('The Anchor');
  });

  it('hands the next occurrence the question but not the answer', () => {
    useTaskStore.setState({
      tasks: [decide({
        deliverableKind: 'number',
        recurrenceType: 'weekly',
        recurrenceInterval: 1,
        title: 'Log the weigh-in',
        dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      })],
    });

    useTaskStore.getState().completeTask('trip-date', { deliverableValue: '181' });

    const next = useTaskStore.getState().tasks.find(t => !t.completed && t.title === 'Log the weigh-in')!;
    expect(next.deliverableKind).toBe('number');
    expect(next.deliverableValue).toBeNull();
    // The completed row keeps its own, which is what makes the Logbook the
    // log of answers over time rather than one answer copied forward.
    expect(rowOf('trip-date').deliverableValue).toBe('181');
  });

  it('leaves an ordinary task alone', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'bins', title: 'Take the bins out' })] });

    useTaskStore.getState().completeTask('bins');

    expect(rowOf('bins').deliverableKind).toBeNull();
    expect(rowOf('bins').deliverableValue).toBeNull();
  });

  it('a duplicate asks the same question with a clean slate', () => {
    useTaskStore.setState({ tasks: [decide({ deliverableKind: 'text', deliverableValue: 'The Anchor' })] });

    const copy = useTaskStore.getState().duplicateTask('trip-date')!;

    expect(copy.deliverableKind).toBe('text');
    expect(copy.deliverableValue).toBeNull();
  });
});

describe('setDeliverableValue', () => {
  const decide = (overrides: Partial<Task> = {}) => makeTask({
    id: 'budget',
    title: 'Decide on the budget',
    deliverableKind: 'number',
    completed: true,
    completedAt: new Date(2025, 5, 10).toISOString(),
    ...overrides,
  });

  const rowOf = (id: string) => useTaskStore.getState().tasks.find(t => t.id === id)!;

  it('corrects the answer on a completed entry', () => {
    useTaskStore.setState({ tasks: [decide({ deliverableValue: '2400' })] });

    useTaskStore.getState().setDeliverableValue('budget', '2600');

    expect(rowOf('budget').deliverableValue).toBe('2600');
    // Still completed — correcting an answer is not re-opening the task.
    expect(rowOf('budget').completed).toBe(true);
  });

  it('answers an entry that was completed without one', () => {
    useTaskStore.setState({ tasks: [decide({ deliverableValue: null })] });

    useTaskStore.getState().setDeliverableValue('budget', '2400');

    expect(rowOf('budget').deliverableValue).toBe('2400');
  });

  it('clears the answer', () => {
    useTaskStore.setState({ tasks: [decide({ deliverableValue: '2400' })] });

    useTaskStore.getState().setDeliverableValue('budget', null);

    expect(rowOf('budget').deliverableValue).toBeNull();
  });

  it('is undoable', () => {
    useTaskStore.setState({ tasks: [decide({ deliverableValue: '2400' })] });

    useTaskStore.getState().setDeliverableValue('budget', '2600');
    useTaskStore.getState().lastAction!.undo();

    expect(rowOf('budget').deliverableValue).toBe('2400');
  });

  it('refuses to write an answer onto a task that asks nothing', () => {
    useTaskStore.setState({ tasks: [decide({ deliverableKind: null, deliverableValue: null })] });

    useTaskStore.getState().setDeliverableValue('budget', '2400');

    expect(rowOf('budget').deliverableValue).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Time blocks (#1492) — the wiring between the system event sheet and the task
// row. What slot gets proposed is timeBlock.test.ts's job; this is only about
// which pointer ends up on the task.

const rowOf = (id: string) => useTaskStore.getState().tasks.find(t => t.id === id)!;

describe('putTaskOnCalendar', () => {
  const sync = jest.requireMock('../utils/calendarSync') as {
    presentTimeBlockCreate: jest.Mock;
    presentTimeBlockEdit: jest.Mock;
    readTimeBlockEvent: jest.Mock;
    updateTimeBlockEvent: jest.Mock;
  };

  const blockable = (overrides: Partial<Task> = {}) =>
    makeTask({ id: 'report', title: 'Write the report', estimatedMinutes: 45, ...overrides });

  it('stores the event id once the user saves the sheet', async () => {
    useTaskStore.setState({ tasks: [blockable()] });
    sync.presentTimeBlockCreate.mockResolvedValueOnce({ saved: true, deleted: false, eventId: 'ev-1' });

    await expect(useTaskStore.getState().putTaskOnCalendar('report')).resolves.toBe(true);

    expect(rowOf('report').timeBlockEventId).toBe('ev-1');
  });

  it('writes nothing when the sheet is cancelled', async () => {
    useTaskStore.setState({ tasks: [blockable()] });

    await expect(useTaskStore.getState().putTaskOnCalendar('report')).resolves.toBe(false);

    expect(rowOf('report').timeBlockEventId).toBeNull();
    expect(sync.presentTimeBlockCreate).toHaveBeenCalled();
  });

  it('refuses a task with no length to block out', async () => {
    useTaskStore.setState({ tasks: [blockable({ estimatedMinutes: null, effort: 0 })] });

    await expect(useTaskStore.getState().putTaskOnCalendar('report')).resolves.toBe(false);

    expect(sync.presentTimeBlockCreate).not.toHaveBeenCalled();
  });

  it('opens the edit sheet, not a second sheet, once a block exists', async () => {
    useTaskStore.setState({ tasks: [blockable({ timeBlockEventId: 'ev-1' })] });
    sync.presentTimeBlockEdit.mockResolvedValueOnce({ saved: true, deleted: false, eventId: 'ev-1' });

    await expect(useTaskStore.getState().putTaskOnCalendar('report')).resolves.toBe(true);

    expect(sync.presentTimeBlockEdit).toHaveBeenCalledWith('ev-1');
    expect(sync.presentTimeBlockCreate).not.toHaveBeenCalled();
    expect(rowOf('report').timeBlockEventId).toBe('ev-1');
  });

  it('drops the pointer when the user deletes the event from the sheet', async () => {
    useTaskStore.setState({ tasks: [blockable({ timeBlockEventId: 'ev-1' })] });
    sync.presentTimeBlockEdit.mockResolvedValueOnce({ saved: false, deleted: true, eventId: null });

    await expect(useTaskStore.getState().putTaskOnCalendar('report')).resolves.toBe(false);

    expect(rowOf('report').timeBlockEventId).toBeNull();
  });

  it('keeps the pointer when the edit sheet closes and the event is still there', async () => {
    useTaskStore.setState({ tasks: [blockable({ timeBlockEventId: 'ev-1' })] });
    // Cancelled, or the sheet failed to present — either way the event lives.
    sync.readTimeBlockEvent.mockResolvedValueOnce({
      title: 'Write the report', start: new Date(), end: new Date(), allDay: false,
    });

    await expect(useTaskStore.getState().putTaskOnCalendar('report')).resolves.toBe(true);

    expect(rowOf('report').timeBlockEventId).toBe('ev-1');
  });

  it('replaces a block that was deleted in the Calendar app', async () => {
    useTaskStore.setState({ tasks: [blockable({ timeBlockEventId: 'gone' })] });
    // Edit sheet does nothing, and the event genuinely isn't there any more.
    sync.readTimeBlockEvent.mockResolvedValueOnce(null);
    sync.presentTimeBlockCreate.mockResolvedValueOnce({ saved: true, deleted: false, eventId: 'ev-2' });

    await expect(useTaskStore.getState().putTaskOnCalendar('report')).resolves.toBe(true);

    // The stale pointer is gone and the same tap produced a fresh block.
    expect(rowOf('report').timeBlockEventId).toBe('ev-2');
  });

  it('ignores a saved event iOS gave us no id for', async () => {
    useTaskStore.setState({ tasks: [blockable()] });
    sync.presentTimeBlockCreate.mockResolvedValueOnce({ saved: true, deleted: false, eventId: null });

    await expect(useTaskStore.getState().putTaskOnCalendar('report')).resolves.toBe(false);

    // An event we can't point at is one we can't reconcile or reopen; better to
    // hold no pointer than a broken one.
    expect(rowOf('report').timeBlockEventId).toBeNull();
  });
});

describe('time block reconcile', () => {
  const sync = jest.requireMock('../utils/calendarSync') as {
    readTimeBlockEvent: jest.Mock;
    updateTimeBlockEvent: jest.Mock;
  };

  const blocked = (overrides: Partial<Task> = {}) =>
    makeTask({
      id: 'report', title: 'Write the report', estimatedMinutes: 45,
      timeBlockEventId: 'ev-1', ...overrides,
    });

  const onDevice = (overrides: Partial<{ title: string; start: Date; end: Date; allDay: boolean }> = {}) => ({
    title: 'Write the report',
    start: new Date(2026, 7, 13, 14, 0),
    end: new Date(2026, 7, 13, 14, 45),
    allDay: false,
    ...overrides,
  });

  it('pushes a renamed task onto the event, keeping the time the user chose', async () => {
    useTaskStore.setState({ tasks: [blocked()] });
    sync.readTimeBlockEvent.mockResolvedValue(onDevice());

    useTaskStore.getState().updateTask('report', { title: 'Write the Q3 report' });
    await Promise.resolve();
    await Promise.resolve();

    expect(sync.updateTimeBlockEvent).toHaveBeenCalledWith('ev-1', {
      title: 'Write the Q3 report',
      // Re-ended from the event's own 14:00 start — never moved.
      endDate: new Date(2026, 7, 13, 14, 45),
    });
  });

  it('resizes the event when the estimate changes', async () => {
    useTaskStore.setState({ tasks: [blocked()] });
    sync.readTimeBlockEvent.mockResolvedValue(onDevice());

    useTaskStore.getState().updateTask('report', { estimatedMinutes: 90 });
    await Promise.resolve();
    await Promise.resolve();

    expect(sync.updateTimeBlockEvent).toHaveBeenCalledWith('ev-1', {
      title: 'Write the report',
      endDate: new Date(2026, 7, 13, 15, 30),
    });
  });

  it('does not touch a task that has no block', async () => {
    useTaskStore.setState({ tasks: [blocked({ timeBlockEventId: null })] });

    useTaskStore.getState().updateTask('report', { title: 'Renamed' });
    await Promise.resolve();

    expect(sync.readTimeBlockEvent).not.toHaveBeenCalled();
    expect(sync.updateTimeBlockEvent).not.toHaveBeenCalled();
  });

  it('drops the pointer instead of re-creating an event that is gone', async () => {
    useTaskStore.setState({ tasks: [blocked()] });
    sync.readTimeBlockEvent.mockResolvedValue(null);

    useTaskStore.getState().updateTask('report', { title: 'Renamed' });
    await Promise.resolve();
    await Promise.resolve();

    expect(rowOf('report').timeBlockEventId).toBeNull();
    expect(sync.updateTimeBlockEvent).not.toHaveBeenCalled();
  });

  it('leaves the block alone when a task is completed', async () => {
    useTaskStore.setState({ tasks: [blocked()] });
    sync.readTimeBlockEvent.mockResolvedValue(onDevice());

    useTaskStore.getState().completeTask('report');
    await Promise.resolve();
    await Promise.resolve();

    // Time already set aside — and possibly shared with other people — is not
    // this app's to withdraw. See Task.timeBlockEventId.
    expect(rowOf('report').timeBlockEventId).toBe('ev-1');
  });
});

// The one path a user can actually write a draft through — TaskEditor hands
// the whole form to updateTask, so a field the update path drops is a field
// the sheet only appears to save.
describe('updateTask: the extra task draft', () => {
  it('saves a draft onto the task and takes it back off again', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'practice', extraTaskEveryN: 4, extraTaskTitle: 'Rosin the bow' })],
    });
    const draft = { ...emptyExtraTaskDraft(), notes: 'In the case pocket', priority: 2 as const };

    useTaskStore.getState().updateTask('practice', { extraTaskDraft: draft });
    expect(useTaskStore.getState().tasks[0].extraTaskDraft).toEqual(draft);

    useTaskStore.getState().updateTask('practice', { extraTaskDraft: null });
    expect(useTaskStore.getState().tasks[0].extraTaskDraft).toBeNull();
  });
});
