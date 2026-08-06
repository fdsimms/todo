import { useTaskStore } from '../store/useTaskStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTemplateStore } from '../store/useTemplateStore';
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
  dbBulkDeleteTasks,
  dbBulkSetPriority,
  dbBulkSetDefer,
  dbBulkSetPinned,
  dbBulkAddTags,
  dbMarkTaskSeen,
  dbTransaction,
} from '../db/database';
import {
  scheduleTaskReminder,
  cancelTaskReminder,
  rescheduleAllReminders,
} from '../utils/notifications';
import { isGroupHiddenToday, isRelevantToGroupToday } from '../utils/visibilityUtils';
import type { Task, TaskGroup } from '../types';

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
  dbBulkDeleteTasks: jest.fn(),
  dbBulkSetPriority: jest.fn(),
  dbBulkSetDefer: jest.fn(),
  dbBulkSetCategory: jest.fn(),
  dbBulkSetPinned: jest.fn(),
  dbBulkAddTags: jest.fn(),
  dbMarkTaskSeen: jest.fn(),
  dbTransaction: jest.fn((fn: () => void) => fn()),
  dbGetAllTemplates: jest.fn().mockReturnValue([]),
  dbInsertTemplate: jest.fn(),
  dbUpdateTemplate: jest.fn(),
  dbDeleteTemplate: jest.fn(),
}));

jest.mock('../store/useCategoryStore', () => ({
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
      getCategoryByName: jest.fn().mockReturnValue(null),
    })),
  },
}));

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: jest.fn(() => ({ dayResetTime: '00:00', autoArchiveProjectsOnComplete: false, activeHoursStart: '08:00', activeHoursEnd: '22:00' })),
  },
}));

jest.mock('../utils/notifications', () => ({
  scheduleTaskReminder: jest.fn().mockResolvedValue(undefined),
  cancelTaskReminder: jest.fn().mockResolvedValue(undefined),
  rescheduleAllReminders: jest.fn().mockResolvedValue(undefined),
  scheduleTimerAlarm: jest.fn().mockResolvedValue(undefined),
  cancelTimerAlarm: jest.fn().mockResolvedValue(undefined),
  rescheduleAllTimerAlarms: jest.fn().mockResolvedValue(undefined),
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
  progressCount: 0,
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
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
  completedAt: null,
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
  createdAt: '2025-01-01T00:00:00.000Z',
  nudgeCadenceDays: 14,
  autoSchedule: false,
  ...overrides,
});

const makeTemplate = (overrides: Partial<import('../types').TaskTemplate> = {}): import('../types').TaskTemplate => ({
  id: 'tpl-1',
  name: 'Test Template',
  items: [],
  itemGroups: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  sortOrder: 1,
  category: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetAllTasks as jest.Mock).mockReturnValue([]);
  useTaskStore.setState({ tasks: [], initialized: false, lastAction: null, completionHoldIds: [] });
  useTaskGroupStore.setState({ groups: [], initialized: false });
  useProjectStore.setState({ projects: [], initialized: false });
  useTemplateStore.setState({ templates: [], initialized: false });
  const { useSettingsStore } = jest.requireMock('../store/useSettingsStore') as { useSettingsStore: { getState: jest.Mock } };
  useSettingsStore.getState.mockReturnValue({ dayResetTime: '00:00', autoArchiveProjectsOnComplete: false, activeHoursStart: '08:00', activeHoursEnd: '22:00' });
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
    expect(rescheduleAllReminders).toHaveBeenCalledWith(tasks);
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
          { id: 'a', title: 'Step A', notes: '' },
          { id: 'b', title: 'Step B', notes: '' },
          { id: 'c', title: 'Step C', notes: '' },
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
});

// ─── completeTask ─────────────────────────────────────────────────────────────

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
        { id: 'a', title: 'Step A', notes: '' },
        { id: 'b', title: 'Step B', notes: '' },
        { id: 'c', title: 'Step C', notes: '' },
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
        { id: 'a', title: 'Step A', notes: '' },
        { id: 'b', title: 'Step B', notes: '' },
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
        { id: 'a', title: 'Step A', notes: '' },
        { id: 'b', title: 'Step B', notes: '' },
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
        { id: 'a', title: 'Step A', notes: '' },
        { id: 'b', title: 'Step B', notes: '' },
        { id: 'c', title: 'Step C', notes: '' },
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

  it('carries subtasks onto the spawned chain step, reset to unchecked', () => {
    const task = makeTask({
      id: 'chained-with-subtasks',
      chainEnabled: true,
      chainItems: [
        { id: 'a', title: 'Step A', notes: '' },
        { id: 'b', title: 'Step B', notes: '' },
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
        { id: 'a', title: 'Step A', notes: '' },
        { id: 'b', title: 'Step B', notes: '' },
        { id: 'c', title: 'Step C', notes: '' },
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
        { id: 'a', title: 'Step A', notes: '' },
        { id: 'b', title: 'Step B', notes: '' },
        { id: 'c', title: 'Step C', notes: '' },
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

  it('advances the schedule and wraps the chain back to 0 when skipping the last step', () => {
    const task = makeTask({
      id: 't1',
      recurrenceType: 'daily',
      recurrenceInterval: 1,
      dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
      recurrenceCount: 5,
      chainEnabled: true,
      chainItems: [
        { id: 'a', title: 'Step A', notes: '' },
        { id: 'b', title: 'Step B', notes: '' },
        { id: 'c', title: 'Step C', notes: '' },
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

// ─── renameCategory ──────────────────────────────────────────────────────────

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

// ─── reorderWithCategoryUpdates ─────────────────────────────────────────────

describe('reorderWithCategoryUpdates', () => {
  it('assigns sortOrder and applies category updates', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'a', sortOrder: 1, category: 'Work' }),
        makeTask({ id: 'b', sortOrder: 2, category: null }),
      ],
    });
    useTaskStore.getState().reorderWithCategoryUpdates(['b', 'a'], [{ id: 'b', category: 'Work' }]);
    const { tasks } = useTaskStore.getState();
    expect(tasks.find(t => t.id === 'b')).toMatchObject({ sortOrder: 1, category: 'Work' });
    expect(tasks.find(t => t.id === 'a')).toMatchObject({ sortOrder: 2, category: 'Work' });
    expect(dbUpdateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', category: 'Work' }));
  });

  it('queues an undo action that restores the previous category', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', sortOrder: 1, category: null })],
    });
    useTaskStore.getState().reorderWithCategoryUpdates(['a'], [{ id: 'a', category: 'Errands' }]);
    expect(useTaskStore.getState().tasks[0].category).toBe('Errands');

    useTaskStore.getState().undoLastAction();
    expect(useTaskStore.getState().tasks[0].category).toBe(null);
  });

  it('does not queue an undo action when no category changed', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', sortOrder: 1 }), makeTask({ id: 'b', sortOrder: 2 })],
      lastAction: null,
    });
    useTaskStore.getState().reorderWithCategoryUpdates(['b', 'a'], []);
    expect(useTaskStore.getState().lastAction).toBe(null);
  });

  it('captures seriesDefaults instead of overwriting the series when scope is occurrence', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', sortOrder: 1, category: 'Work', recurrenceType: 'daily' })],
    });
    useTaskStore.getState().reorderWithCategoryUpdates(['a'], [{ id: 'a', category: 'Home' }], { scope: 'occurrence' });
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
        { id: 'a', title: 'Step A', notes: '' },
        { id: 'b', title: 'Step B', notes: '' },
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

describe('dismissGroup', () => {
  it('stamps the group completedAt without touching any child', () => {
    const today = new Date().toISOString();
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', groupId: 'g1', completed: true, completedAt: today })],
    });
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.getState().dismissGroup('g1');
    expect(useTaskGroupStore.getState().getGroupById('g1')?.completedAt).not.toBeNull();
    expect(useTaskStore.getState().tasks.find(t => t.id === 'a')?.completed).toBe(true);
  });

  it('is undoable via lastAction', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.getState().dismissGroup('g1');
    useTaskStore.getState().lastAction?.undo();
    expect(useTaskGroupStore.getState().getGroupById('g1')?.completedAt).toBeNull();
  });

  it('does nothing if the group is already dismissed today', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', completedAt: new Date().toISOString() })] });
    useTaskStore.getState().dismissGroup('g1');
    expect(useTaskStore.getState().lastAction).toBeNull();
  });

  it('re-stamps a group left dismissed on an earlier day', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', completedAt: '2026-01-01T00:00:00.000Z' })] });
    useTaskStore.getState().dismissGroup('g1');
    expect(useTaskGroupStore.getState().getGroupById('g1')?.completedAt).not.toBe('2026-01-01T00:00:00.000Z');
    expect(useTaskStore.getState().lastAction).not.toBeNull();
  });

  // The stamp is deliberately NOT cleared when a stack gains live work again
  // — isGroupHiddenToday requires everything due today to still be done, so
  // the stack un-hides itself and no event has to be intercepted. These cover
  // the ways that used to need an explicit clearGroupDismissal call.
  it('stays hidden when a completed daily child spawns tomorrow\'s occurrence', () => {
    // The spawn isn't today's work, so it must not drag the stack back onto
    // Today — the old design cleared the stamp here and it reappeared,
    // unchecked, seconds after the user dismissed it.
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', completedAt: new Date().toISOString() })] });
    useTaskStore.setState({
      tasks: [makeTask({
        id: 'a', groupId: 'g1', completed: false, dueDate: new Date().toISOString(),
        recurrenceType: 'daily', recurrenceInterval: 1,
      })],
    });
    useTaskStore.getState().completeTask('a');
    const group = useTaskGroupStore.getState().getGroupById('g1')!;
    const dueToday = useTaskStore.getState().groupRosterOf('g1').filter(isRelevantToGroupToday);
    expect(isGroupHiddenToday(group.completedAt, dueToday)).toBe(true);
  });

  it('stops hiding the stack when a member becomes due again today', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', completedAt: new Date().toISOString() })] });
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'done', groupId: 'g1', completed: true, completedAt: new Date().toISOString() }),
        makeTask({ id: 'now-due', groupId: 'g1', dueDate: new Date().toISOString() }),
      ],
    });
    const group = useTaskGroupStore.getState().getGroupById('g1')!;
    const dueToday = useTaskStore.getState().groupRosterOf('g1').filter(isRelevantToGroupToday);
    expect(isGroupHiddenToday(group.completedAt, dueToday)).toBe(false);
  });

  it('stops hiding the stack when an incomplete task is added to it', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', completedAt: new Date().toISOString() })] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', groupId: null, completed: false })] });
    useTaskStore.getState().addExistingToGroup('a', 'g1');
    const group = useTaskGroupStore.getState().getGroupById('g1')!;
    const dueToday = useTaskStore.getState().groupRosterOf('g1').filter(isRelevantToGroupToday);
    expect(isGroupHiddenToday(group.completedAt, dueToday)).toBe(false);
  });

  it('stops hiding the stack when one of its children is uncompleted', () => {
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1', completedAt: new Date().toISOString() })] });
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', groupId: 'g1', completed: true, completedAt: new Date().toISOString() })],
    });
    useTaskStore.getState().uncompleteTask('a');
    const group = useTaskGroupStore.getState().getGroupById('g1')!;
    const dueToday = useTaskStore.getState().groupRosterOf('g1').filter(isRelevantToGroupToday);
    expect(isGroupHiddenToday(group.completedAt, dueToday)).toBe(false);
  });

  it('hides a fully-done stack for today, then lets it back tomorrow', () => {
    const now = new Date().toISOString();
    useTaskGroupStore.setState({ groups: [makeGroup({ id: 'g1' })] });
    useTaskStore.setState({
      tasks: [makeTask({ id: 'a', groupId: 'g1', completed: true, completedAt: now })],
    });
    useTaskStore.getState().dismissGroup('g1');
    const stamp = useTaskGroupStore.getState().getGroupById('g1')!.completedAt;
    const dueToday = useTaskStore.getState().groupRosterOf('g1').filter(isRelevantToGroupToday);
    expect(isGroupHiddenToday(stamp, dueToday)).toBe(true);
    // Same stamp, read on a later day: the dismissal has expired on its own.
    expect(isGroupHiddenToday('2026-01-01T00:00:00.000Z', dueToday)).toBe(false);
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
        makeTask({ id: 'a', sortOrder: 2, windowEnd: '13:00' }),
        makeTask({ id: 'b', sortOrder: 1, windowEnd: '13:00' }),
      ],
    });
    expect(useTaskStore.getState().expiredTasks().map(t => t.id)).toEqual(['b', 'a']);
  });

  it('excludes tasks whose window has not closed yet', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 't1', windowEnd: '18:00' })] });
    expect(useTaskStore.getState().expiredTasks()).toHaveLength(0);
  });

  it('excludes subtasks', () => {
    useTaskStore.setState({
      tasks: [makeTask({ id: 't1', parentId: 'parent', windowEnd: '13:00' })],
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

  it('leaves expired tasks in place when the setting is off', () => {
    settingsStoreMock().getState.mockReturnValue({
      dayResetTime: '00:00',
      autoArchiveProjectsOnComplete: false,
      autoRemoveExpiredTasks: false,
      vacationMode: false,
    });
    useTaskStore.setState({ tasks: [makeTask({ id: 'expired', windowEnd: '13:00' })] });
    useTaskStore.getState().sweepExpiredTasks();
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['expired']);
    expect(dbBulkDeleteTasks).not.toHaveBeenCalled();
  });

  it('deletes expired tasks when the setting is on, leaving active ones', () => {
    settingsStoreMock().getState.mockReturnValue({
      dayResetTime: '00:00',
      autoArchiveProjectsOnComplete: false,
      autoRemoveExpiredTasks: true,
      vacationMode: false,
    });
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'expired', windowEnd: '13:00' }),
        makeTask({ id: 'active', windowEnd: '18:00' }),
      ],
    });
    useTaskStore.getState().sweepExpiredTasks();
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['active']);
    expect(dbBulkDeleteTasks).toHaveBeenCalledWith(['expired']);
  });

  it('spares a vacation-paused expired task while vacation mode is on', () => {
    settingsStoreMock().getState.mockReturnValue({
      dayResetTime: '00:00',
      autoArchiveProjectsOnComplete: false,
      autoRemoveExpiredTasks: true,
      vacationMode: true,
    });
    useTaskStore.setState({
      tasks: [makeTask({ id: 'paused', windowEnd: '13:00', vacationPause: true })],
    });
    useTaskStore.getState().sweepExpiredTasks();
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual(['paused']);
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

  it('logManualTime sets actual + estimate without needing a running timer', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a' })] });
    useTaskStore.getState().logManualTime('a', 90);
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.actualMinutes).toBe(90);
    expect(task.estimatedMinutes).toBe(90);
    expect(task.effort).toBe(4); // ≤150min → M
  });

  it('stopTimer records actual minutes but leaves a typed estimate untouched', () => {
    const started = new Date(Date.now() - 10 * 60000).toISOString(); // 10 minutes ago
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', timerStartedAt: started, estimatedMinutes: 30, effort: 3 })] });
    useTaskStore.getState().stopTimer('a');
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.actualMinutes).toBe(10);
    expect(task.estimatedMinutes).toBe(30);
    expect(task.effort).toBe(3);
  });

  it('logManualTime records actual minutes but leaves a typed estimate untouched', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', estimatedMinutes: 60, effort: 4 })] });
    useTaskStore.getState().logManualTime('a', 90);
    const task = useTaskStore.getState().tasks.find(t => t.id === 'a')!;
    expect(task.actualMinutes).toBe(90);
    expect(task.estimatedMinutes).toBe(60);
    expect(task.effort).toBe(4);
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

  it('ignores tasks with no projectId', () => {
    useSettingsStore.getState.mockReturnValue({ dayResetTime: '00:00', autoArchiveProjectsOnComplete: true });
    useProjectStore.setState({ projects: [] });
    useTaskStore.setState({ tasks: [makeTask({ id: 'a', projectId: null })] });
    expect(() => useTaskStore.getState().completeTask('a')).not.toThrow();
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
});
