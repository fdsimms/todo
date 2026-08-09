/**
 * Database layer integration tests.
 *
 * expo-sqlite is replaced with an in-memory better-sqlite3 instance so every
 * SQL query, JSON serialisation round-trip, and migration can be exercised
 * without a device or simulator.
 */

import {
  initDatabase,
  dbGetSetting,
  dbSetSetting,
  dbGetAllTasks,
  dbInsertTask,
  dbUpdateTask,
  dbDeleteTask,
  dbDeleteSubtasks,
  dbClearAllPins,
  dbBatchUpdateSortOrders,
  dbBulkDeleteTasks,
  dbBulkSetPriority,
  dbBulkSetDefer,
  dbBulkSetTimeSegments,
  dbSetCategoryDefaultTimeSegments,
  dbBulkAddTags,
  dbRemoveTagFromAllTasks,
  dbGetTagRegistry,
  dbAddToTagRegistry,
  dbRemoveFromTagRegistry,
  dbGetCategoryRegistry,
  dbGetAllTemplates,
  dbInsertTemplate,
  dbUpdateTemplate,
  dbDeleteTemplate,
  dbGetAllProjects,
  dbInsertProject,
  dbUpdateProject,
  dbDeleteProject,
  dbBatchUpdateProjectSortOrders,
  dbTransaction,
  dbGetAllCategories,
  dbInsertCategory,
  dbInsertCategoryRow,
  dbDeleteCategory,
  dbGetAllTaskGroups,
  dbInsertTaskGroup,
  dbTableColumns,
  dbExportTables,
  dbReplaceAllData,
  BACKUP_TABLES,
  dbGetAllGroceryItems,
  dbInsertGroceryItem,
  dbUpdateGroceryItem,
  dbDeleteGroceryItem,
  dbFinishGroceryShopping,
  dbClearGroceryList,
  dbGetGroceryAisleOrder,
  dbGetGroceryAisleOverrides,
  dbSetGroceryAisleOverrides,
  dbSetGroceryAisleOrder,
  dbGetMealPlanEntries,
  dbInsertMealPlanEntry,
  dbUpdateMealPlanEntry,
  dbDeleteMealPlanEntry,
  dbPurgeOldMealPlanEntries,
} from '../db/database';
import { buildBackup, serializeBackup, parseBackup } from '../utils/backup';
import type { Task, TaskTemplate, TemplateItem, Project, Category, TaskGroup, GroceryItem, MealPlanEntry, MealSlot } from '../types';

// ---------------------------------------------------------------------------
// Mock expo-sqlite with an in-memory better-sqlite3 database.
// The factory is called lazily (when database.ts first imports expo-sqlite),
// so `mockRawDb` is always assigned before any test runs.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockRawDb: any; // better-sqlite3 Database instance — set by the mock factory below

jest.mock('expo-sqlite', () => {
  // Must use require() inside the factory because jest.mock is hoisted
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BS = require('better-sqlite3');
  mockRawDb = new BS(':memory:');

  return {
    openDatabaseSync: () => ({
      execSync(sql: string) {
        mockRawDb.exec(sql);
      },
      // Returns better-sqlite3's result, which carries `changes` — expo-sqlite's
      // does too, and dbPurgeOldMealPlanEntries reads it to report what a purge
      // took.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runSync(sql: string, params: any[] = []) {
        return mockRawDb.prepare(sql).run(...params);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getAllSync<T>(sql: string, params: any[] = []): T[] {
        return mockRawDb.prepare(sql).all(...params) as T[];
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getFirstSync<T>(sql: string, params: any[] = []): T | null {
        return (mockRawDb.prepare(sql).get(...params) as T) ?? null;
      },
      withTransactionSync(fn: () => void) {
        mockRawDb.transaction(fn)();
      },
    }),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  showStreak: false,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
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
  blockedById: null,
  pendingImport: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Setup — create schema once, clear rows before each test
// ---------------------------------------------------------------------------

beforeAll(() => {
  initDatabase();
});

beforeEach(() => {
  mockRawDb.exec('DELETE FROM tasks; DELETE FROM settings; DELETE FROM templates; DELETE FROM projects; DELETE FROM grocery_items;');
});

// ---------------------------------------------------------------------------
// initDatabase
// ---------------------------------------------------------------------------

describe('initDatabase', () => {
  it('creates the tasks table', () => {
    const row = mockRawDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('tasks');
  });

  it('creates the settings table', () => {
    const row = mockRawDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('settings');
  });

  it('adds all migration columns to tasks', () => {
    const cols = (
      mockRawDb.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]
    ).map((c) => c.name);
    for (const col of [
      'focused', 'pinned', 'priority', 'effort', 'streak_count', 'streak_date',
      'recurrence_from_completion', 'parent_id', 'reminder_time',
      'cycle_enabled', 'cycle_index', 'cycle_items',
      'time_of_day', 'category', 'vacation_pause', 'estimated_minutes',
      'window_start', 'window_end', 'missed_at',
    ]) {
      expect(cols).toContain(col);
    }
  });

  it('round-trips missed_at, so a miss survives a restart', () => {
    dbInsertTask(makeTask({
      id: 'missed-1',
      completed: true,
      completedAt: '2025-01-05T09:00:00.000Z',
      missedAt: '2025-01-05T09:00:00.000Z',
    }));
    dbInsertTask(makeTask({ id: 'done-1', completed: true, completedAt: '2025-01-05T09:00:00.000Z' }));

    const byId = new Map(dbGetAllTasks().map(t => [t.id, t]));
    expect(byId.get('missed-1')!.missedAt).toBe('2025-01-05T09:00:00.000Z');
    // Null, not undefined — every legacy row reads this way too, which is what
    // keeps isRealCompletion true for the whole existing Logbook.
    expect(byId.get('done-1')!.missedAt).toBeNull();

    dbUpdateTask({ ...byId.get('missed-1')!, missedAt: null });
    expect(dbGetAllTasks().find(t => t.id === 'missed-1')!.missedAt).toBeNull();
  });

  it('round-trips auto_scheduled_at, both with and without a date beside it', () => {
    dbInsertTask(makeTask({
      id: 'dripped',
      dueDate: '2025-01-05T12:00:00.000Z',
      autoScheduledAt: '2025-01-05T09:00:00.000Z',
    }));
    // The shape a decline leaves behind: stamp, no date. It has to survive a
    // restart or the back-off would forget itself the moment the app is killed.
    dbInsertTask(makeTask({ id: 'declined', autoScheduledAt: '2025-01-05T09:00:00.000Z' }));
    dbInsertTask(makeTask({ id: 'plain', dueDate: '2025-01-05T12:00:00.000Z' }));

    const byId = new Map(dbGetAllTasks().map(t => [t.id, t]));
    expect(byId.get('dripped')!.autoScheduledAt).toBe('2025-01-05T09:00:00.000Z');
    expect(byId.get('declined')!.autoScheduledAt).toBe('2025-01-05T09:00:00.000Z');
    // Null, not undefined — how every row written before this shipped reads,
    // so no existing task starts out claiming the app scheduled it.
    expect(byId.get('plain')!.autoScheduledAt).toBeNull();

    dbUpdateTask({ ...byId.get('dripped')!, autoScheduledAt: null });
    expect(dbGetAllTasks().find(t => t.id === 'dripped')!.autoScheduledAt).toBeNull();
  });

  it('is idempotent — safe to call multiple times', () => {
    expect(() => initDatabase()).not.toThrow();
  });

  it('creates an index on tasks(parent_id)', () => {
    const row = mockRawDb
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tasks_parent_id'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('idx_tasks_parent_id');
  });

  it('backfills seen_at from created_at for legacy rows so they are not treated as new', () => {
    mockRawDb
      .prepare(
        "INSERT INTO tasks (id, created_at, seen_at) VALUES ('legacy-row', '2025-01-01T00:00:00.000Z', NULL)"
      )
      .run();
    initDatabase();
    const row = mockRawDb.prepare('SELECT seen_at FROM tasks WHERE id = ?').get('legacy-row') as { seen_at: string };
    expect(row.seen_at).toBe('2025-01-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('dbGetSetting / dbSetSetting', () => {
  it('returns null for a missing key', () => {
    expect(dbGetSetting('nonexistent')).toBeNull();
  });

  it('stores and retrieves a value', () => {
    dbSetSetting('theme', 'dark');
    expect(dbGetSetting('theme')).toBe('dark');
  });

  it('overwrites an existing value (INSERT OR REPLACE semantics)', () => {
    dbSetSetting('theme', 'light');
    dbSetSetting('theme', 'dark');
    expect(dbGetSetting('theme')).toBe('dark');
  });

  it('stores multiple independent keys', () => {
    dbSetSetting('a', '1');
    dbSetSetting('b', '2');
    expect(dbGetSetting('a')).toBe('1');
    expect(dbGetSetting('b')).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// Tasks — CRUD
// ---------------------------------------------------------------------------

describe('dbGetAllTasks', () => {
  it('returns an empty array when no tasks exist', () => {
    expect(dbGetAllTasks()).toEqual([]);
  });

  it('returns tasks ordered by sort_order ASC then created_at ASC', () => {
    dbInsertTask(makeTask({ id: 'a', sortOrder: 2, createdAt: '2025-01-01T00:00:00.000Z' }));
    dbInsertTask(makeTask({ id: 'b', sortOrder: 1, createdAt: '2025-01-02T00:00:00.000Z' }));
    dbInsertTask(makeTask({ id: 'c', sortOrder: 1, createdAt: '2025-01-01T00:00:00.000Z' }));
    expect(dbGetAllTasks().map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('dbInsertTask + rowToTask round-trip', () => {
  it('returns a task with all scalar fields intact', () => {
    const task = makeTask({ id: 't1', title: 'My Task', notes: 'some notes', sortOrder: 5 });
    dbInsertTask(task);
    const [result] = dbGetAllTasks();
    expect(result.id).toBe('t1');
    expect(result.title).toBe('My Task');
    expect(result.notes).toBe('some notes');
    expect(result.sortOrder).toBe(5);
  });

  it('round-trips projectId', () => {
    dbInsertTask(makeTask({ id: 'proj', projectId: 'project-1' }));
    const [t] = dbGetAllTasks();
    expect(t.projectId).toBe('project-1');
  });

  it('round-trips estimatedMinutes (precise time estimate)', () => {
    dbInsertTask(makeTask({ id: 'est', estimatedMinutes: 75 }));
    const [t] = dbGetAllTasks();
    expect(t.estimatedMinutes).toBe(75);
  });

  it('returns null estimatedMinutes when unset', () => {
    dbInsertTask(makeTask({ id: 'noest' }));
    const [t] = dbGetAllTasks();
    expect(t.estimatedMinutes).toBeNull();
  });

  it('round-trips a daily target and its unit', () => {
    dbInsertTask(makeTask({ id: 'quota', targetCount: 12, progressCount: 5, targetUnit: '8oz glasses' }));
    const [t] = dbGetAllTasks();
    expect(t.targetCount).toBe(12);
    expect(t.progressCount).toBe(5);
    expect(t.targetUnit).toBe('8oz glasses');
  });

  it('returns null targetUnit when unset', () => {
    dbInsertTask(makeTask({ id: 'nounit', targetCount: 12 }));
    const [t] = dbGetAllTasks();
    expect(t.targetUnit).toBeNull();
  });

  it('deserialises boolean columns back to JS booleans', () => {
    dbInsertTask(
      makeTask({
        id: 'bools',
        completed: true,
        completedAt: '2025-06-10T10:00:00.000Z',
        pinned: true,
        recurrenceFromCompletion: true,
        targetCount: null,
        targetUnit: null,
        progressCount: 0,
        chainEnabled: true,
        vacationPause: true,
      }),
    );
    const [t] = dbGetAllTasks();
    expect(t.completed).toBe(true);
    expect(t.pinned).toBe(true);
    expect(t.recurrenceFromCompletion).toBe(true);
    expect(t.chainEnabled).toBe(true);
    expect(t.vacationPause).toBe(true);
  });

  it('deserialises false boolean columns correctly', () => {
    dbInsertTask(makeTask({ id: 'falsy' }));
    const [t] = dbGetAllTasks();
    expect(t.completed).toBe(false);
    expect(t.pinned).toBe(false);
    expect(t.recurrenceFromCompletion).toBe(false);
    expect(t.chainEnabled).toBe(false);
    expect(t.vacationPause).toBe(false);
  });

  it('deserialises JSON array columns (tags, recurrenceDays, chainItems)', () => {
    const tags = ['work', 'urgent'];
    const recurrenceDays = [1, 3, 5];
    const chainItems = [{ id: 'ci', title: 'Item A', estimatedMinutes: null }];
    dbInsertTask(makeTask({ id: 'json', tags, recurrenceDays, chainItems }));
    const [t] = dbGetAllTasks();
    expect(t.tags).toEqual(tags);
    expect(t.recurrenceDays).toEqual(recurrenceDays);
    expect(t.chainItems).toEqual(chainItems);
  });

  it('round-trips chainStepOnSchedule through both insert and update', () => {
    dbInsertTask(makeTask({ id: 'rot', chainStepOnSchedule: true }));
    expect(dbGetAllTasks()[0].chainStepOnSchedule).toBe(true);
    // Both statements bind it positionally at the end of a long placeholder
    // list, so exercise the update path too — a misaligned parameter there
    // writes a neighbouring column's value instead of failing.
    dbUpdateTask({ ...dbGetAllTasks()[0], chainStepOnSchedule: false, title: 'Renamed' });
    const [t] = dbGetAllTasks();
    expect(t.chainStepOnSchedule).toBe(false);
    expect(t.title).toBe('Renamed');
  });

  it('round-trips phoneNumber through both insert and update', () => {
    // Bound last in both statements, same positional risk as
    // chainStepOnSchedule above — and stored verbatim, so the formatting has
    // to survive the trip too.
    dbInsertTask(makeTask({ id: 'ph', phoneNumber: '+44 20 7946 0018' }));
    expect(dbGetAllTasks()[0].phoneNumber).toBe('+44 20 7946 0018');
    dbUpdateTask({ ...dbGetAllTasks()[0], phoneNumber: '(555) 123-4567', title: 'Renamed' });
    const [t] = dbGetAllTasks();
    expect(t.phoneNumber).toBe('(555) 123-4567');
    expect(t.title).toBe('Renamed');
  });

  it('returns null phoneNumber when unset', () => {
    dbInsertTask(makeTask({ id: 'nophone' }));
    expect(dbGetAllTasks()[0].phoneNumber).toBeNull();
  });

  it('deserialises timeSegments from a JSON array', () => {
    dbInsertTask(makeTask({ id: 'ts', timeSegments: ['morning', 'evening'] }));
    expect(dbGetAllTasks()[0].timeSegments).toEqual(['morning', 'evening']);
  });

  it('round-trips windowStart and windowEnd', () => {
    dbInsertTask(makeTask({ id: 'win', windowStart: '08:00', windowEnd: '13:00' }));
    const [t] = dbGetAllTasks();
    expect(t.windowStart).toBe('08:00');
    expect(t.windowEnd).toBe('13:00');
  });

  it('returns null windowStart/windowEnd when unset', () => {
    dbInsertTask(makeTask({ id: 'nowin' }));
    const [t] = dbGetAllTasks();
    expect(t.windowStart).toBeNull();
    expect(t.windowEnd).toBeNull();
  });

  it('stores empty timeSegments as NULL in the column', () => {
    dbInsertTask(makeTask({ id: 'nots' }));
    const row = mockRawDb
      .prepare('SELECT time_of_day FROM tasks WHERE id = ?')
      .get('nots') as { time_of_day: string | null };
    expect(row.time_of_day).toBeNull();
  });

  it('handles legacy single-string time_of_day format (non-JSON)', () => {
    dbInsertTask(makeTask({ id: 'legacy' }));
    mockRawDb.prepare("UPDATE tasks SET time_of_day = 'afternoon' WHERE id = 'legacy'").run();
    expect(dbGetAllTasks()[0].timeSegments).toEqual(['afternoon']);
  });

  it('returns null for all nullable optional fields when not set', () => {
    dbInsertTask(makeTask({ id: 'nulls' }));
    const [t] = dbGetAllTasks();
    expect(t.dueDate).toBeNull();
    expect(t.deadline).toBeNull();
    expect(t.deferUntil).toBeNull();
    expect(t.completedAt).toBeNull();
    expect(t.recurrenceEndDate).toBeNull();
    expect(t.recurrenceCount).toBeNull();
    expect(t.streakDate).toBeNull();
    expect(t.parentId).toBeNull();
    expect(t.reminderTime).toBeNull();
    expect(t.category).toBeNull();
    expect(t.previousOccurrenceId).toBeNull();
    expect(t.seriesDefaults).toBeNull();
  });

  it('round-trips previousOccurrenceId', () => {
    dbInsertTask(makeTask({ id: 'occurrence', previousOccurrenceId: 'original-task' }));
    const [t] = dbGetAllTasks();
    expect(t.previousOccurrenceId).toBe('original-task');
  });

  it('round-trips a dated series id and its repeat rule', () => {
    dbInsertTask(makeTask({ id: 'series-row', seriesId: 'set-1', seriesMonthDays: [10, 15], seriesRepeatMonths: 2 }));
    const [t] = dbGetAllTasks();
    expect(t.seriesId).toBe('set-1');
    expect(t.seriesMonthDays).toEqual([10, 15]);
    expect(t.seriesRepeatMonths).toBe(2);
  });

  it('defaults a task with no series to null / empty / 1', () => {
    dbInsertTask(makeTask({ id: 'plain-row' }));
    const [t] = dbGetAllTasks();
    expect(t.seriesId).toBeNull();
    expect(t.seriesMonthDays).toEqual([]);
    expect(t.seriesRepeatMonths).toBe(1);
  });

  it('round-trips seriesDefaults', () => {
    dbInsertTask(makeTask({ id: 'with-series-defaults', title: 'Edited', seriesDefaults: { title: 'Original' } }));
    const [t] = dbGetAllTasks();
    expect(t.seriesDefaults).toEqual({ title: 'Original' });
  });

  it('returns null seriesDefaults when unset', () => {
    dbInsertTask(makeTask({ id: 'no-series-defaults' }));
    const [t] = dbGetAllTasks();
    expect(t.seriesDefaults).toBeNull();
  });

  it('round-trips pendingImport through both insert and update', () => {
    const pending = {
      recurrenceType: 'daily' as const,
      recurrenceInterval: 1,
      recurrenceFromCompletion: true,
      title: 'go running',
    };
    dbInsertTask(makeTask({ id: 'with-pending', pendingImport: pending }));
    expect(dbGetAllTasks()[0].pendingImport).toEqual(pending);

    // Applying or dismissing a suggestion clears it through dbUpdateTask, so
    // the update half has to carry the column too.
    dbUpdateTask(makeTask({ id: 'with-pending', pendingImport: null }));
    expect(dbGetAllTasks()[0].pendingImport).toBeNull();
  });

  it('returns null pendingImport when unset, as every pre-existing row is', () => {
    dbInsertTask(makeTask({ id: 'no-pending' }));
    expect(dbGetAllTasks()[0].pendingImport).toBeNull();
  });

  it('round-trips previousStreakCount and previousStreakDate', () => {
    dbInsertTask(makeTask({
      id: 'streaky',
      previousStreakCount: 4,
      previousStreakDate: '2025-06-09T00:00:00.000Z',
    }));
    const [t] = dbGetAllTasks();
    expect(t.previousStreakCount).toBe(4);
    expect(t.previousStreakDate).toBe('2025-06-09T00:00:00.000Z');
  });

  it('round-trips showStreak', () => {
    dbInsertTask(makeTask({ id: 'habit', showStreak: true }));
    dbInsertTask(makeTask({ id: 'plain' }));
    const tasks = dbGetAllTasks();
    expect(tasks.find(t => t.id === 'habit')!.showStreak).toBe(true);
    expect(tasks.find(t => t.id === 'plain')!.showStreak).toBe(false);
  });

  it('persists showStreak through an update', () => {
    dbInsertTask(makeTask({ id: 'habit-upd' }));
    const [before] = dbGetAllTasks();
    dbUpdateTask({ ...before, showStreak: true });
    expect(dbGetAllTasks()[0].showStreak).toBe(true);
  });

  it('round-trips seenAt', () => {
    dbInsertTask(makeTask({ id: 'seen', seenAt: '2025-06-10T08:00:00.000Z' }));
    const [t] = dbGetAllTasks();
    expect(t.seenAt).toBe('2025-06-10T08:00:00.000Z');
  });

  it('returns null seenAt when unset', () => {
    dbInsertTask(makeTask({ id: 'unseen', seenAt: null }));
    const [t] = dbGetAllTasks();
    expect(t.seenAt).toBeNull();
  });

  it('persists non-null optional fields', () => {
    const task = makeTask({
      id: 'full',
      dueDate: '2025-07-01T00:00:00.000Z',
      deadline: '2025-07-04T00:00:00.000Z',
      deferUntil: '2025-06-15T00:00:00.000Z',
      completedAt: '2025-06-10T10:00:00.000Z',
      recurrenceEndDate: '2025-12-31T00:00:00.000Z',
      recurrenceCount: 5,
      streakDate: '2025-06-09T00:00:00.000Z',
      parentId: 'parent-id',
      reminderTime: '2025-06-10T08:00:00.000Z',
      category: 'Work',
    });
    dbInsertTask(task);
    const [t] = dbGetAllTasks();
    expect(t.dueDate).toBe(task.dueDate);
    expect(t.deadline).toBe(task.deadline);
    expect(t.deferUntil).toBe(task.deferUntil);
    expect(t.reminderTime).toBe(task.reminderTime);
    expect(t.category).toBe(task.category);
    expect(t.recurrenceEndDate).toBe(task.recurrenceEndDate);
    expect(t.recurrenceCount).toBe(task.recurrenceCount);
  });
});

describe('dbUpdateTask', () => {
  it('updates all mutable fields and leaves the id unchanged', () => {
    dbInsertTask(makeTask({ id: 'u1', title: 'Original' }));
    const updated: Task = {
      ...makeTask({ id: 'u1' }),
      title: 'Updated',
      notes: 'new notes',
      completed: true,
      completedAt: '2025-06-10T00:00:00.000Z',
      dueDate: '2025-07-01T00:00:00.000Z',
      deadline: '2025-07-04T00:00:00.000Z',
      timeSegments: ['afternoon'],
      windowStart: '08:00',
      windowEnd: '13:00',
      recurrenceType: 'weekly',
      recurrenceInterval: 2,
      recurrenceDays: [1, 5],
      tags: ['updated'],
      category: 'Work',
      sortOrder: 99,
      pinned: true,
      priority: 3,
      effort: 2,
      estimatedMinutes: 75,
      streakCount: 5,
      chainEnabled: true,
      chainItems: [{ id: 'ci', title: 'C', estimatedMinutes: null }],
      vacationPause: true,
    };
    dbUpdateTask(updated);
    const [result] = dbGetAllTasks();
    expect(result.id).toBe('u1');
    expect(result.title).toBe('Updated');
    expect(result.completed).toBe(true);
    expect(result.recurrenceType).toBe('weekly');
    expect(result.tags).toEqual(['updated']);
    expect(result.priority).toBe(3);
    expect(result.effort).toBe(2);
    expect(result.estimatedMinutes).toBe(75);
    expect(result.streakCount).toBe(5);
    expect(result.vacationPause).toBe(true);
    expect(result.windowStart).toBe('08:00');
    expect(result.windowEnd).toBe('13:00');
    expect(result.deadline).toBe('2025-07-04T00:00:00.000Z');
  });

  it('writes a target unit, and clears it again', () => {
    dbInsertTask(makeTask({ id: 'q', targetCount: 12 }));
    dbUpdateTask(makeTask({ id: 'q', targetCount: 12, targetUnit: 'glasses' }));
    expect(dbGetAllTasks()[0].targetUnit).toBe('glasses');

    dbUpdateTask(makeTask({ id: 'q', targetCount: 12, targetUnit: null }));
    expect(dbGetAllTasks()[0].targetUnit).toBeNull();
  });

  it('does not touch other rows', () => {
    dbInsertTask(makeTask({ id: 'keep', title: 'Keep Me' }));
    dbInsertTask(makeTask({ id: 'edit', title: 'Edit Me' }));
    dbUpdateTask(makeTask({ id: 'edit', title: 'Edited' }));
    expect(dbGetAllTasks().find((t) => t.id === 'keep')?.title).toBe('Keep Me');
  });

  it('round-trips seriesDefaults through an update, including clearing it back to null', () => {
    dbInsertTask(makeTask({ id: 'sd', title: 'Edited today' }));
    dbUpdateTask(makeTask({ id: 'sd', title: 'Edited today', seriesDefaults: { title: 'Series title' } }));
    expect(dbGetAllTasks()[0].seriesDefaults).toEqual({ title: 'Series title' });

    dbUpdateTask(makeTask({ id: 'sd', title: 'Edited today', seriesDefaults: null }));
    expect(dbGetAllTasks()[0].seriesDefaults).toBeNull();
  });
});

describe('dbDeleteTask', () => {
  it('removes the specified task', () => {
    dbInsertTask(makeTask({ id: 'del' }));
    dbDeleteTask('del');
    expect(dbGetAllTasks()).toHaveLength(0);
  });

  it('leaves other tasks untouched', () => {
    dbInsertTask(makeTask({ id: 'keep' }));
    dbInsertTask(makeTask({ id: 'del' }));
    dbDeleteTask('del');
    expect(dbGetAllTasks().map((t) => t.id)).toEqual(['keep']);
  });

  it('is a no-op for a non-existent id', () => {
    dbInsertTask(makeTask({ id: 'a' }));
    expect(() => dbDeleteTask('nonexistent')).not.toThrow();
    expect(dbGetAllTasks()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Subtasks
// ---------------------------------------------------------------------------

describe('dbDeleteSubtasks', () => {
  it('removes tasks whose parent_id matches', () => {
    dbInsertTask(makeTask({ id: 'parent' }));
    dbInsertTask(makeTask({ id: 'child', parentId: 'parent' }));
    dbDeleteSubtasks('parent');
    const ids = dbGetAllTasks().map((t) => t.id);
    expect(ids).toContain('parent');
    expect(ids).not.toContain('child');
  });

  it('leaves tasks belonging to a different parent alone', () => {
    dbInsertTask(makeTask({ id: 'child-a', parentId: 'A' }));
    dbInsertTask(makeTask({ id: 'child-b', parentId: 'B' }));
    dbDeleteSubtasks('A');
    expect(dbGetAllTasks().map((t) => t.id)).toEqual(['child-b']);
  });

  it('is safe when there are no matching subtasks', () => {
    dbInsertTask(makeTask({ id: 'lone' }));
    expect(() => dbDeleteSubtasks('lone')).not.toThrow();
    expect(dbGetAllTasks()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Pin
// ---------------------------------------------------------------------------

describe('dbClearAllPins', () => {
  it('sets pinned = false on every pinned task', () => {
    dbInsertTask(makeTask({ id: 'f1', pinned: true }));
    dbInsertTask(makeTask({ id: 'f2', pinned: true }));
    dbInsertTask(makeTask({ id: 'n', pinned: false }));
    dbClearAllPins();
    dbGetAllTasks().forEach((t) => expect(t.pinned).toBe(false));
  });

  it('is safe to call when no tasks are pinned', () => {
    dbInsertTask(makeTask({ id: 'n' }));
    expect(() => dbClearAllPins()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Batch sort orders
// ---------------------------------------------------------------------------

describe('dbBatchUpdateSortOrders', () => {
  it('updates sort_order for each specified task', () => {
    dbInsertTask(makeTask({ id: 'a', sortOrder: 1 }));
    dbInsertTask(makeTask({ id: 'b', sortOrder: 2 }));
    dbBatchUpdateSortOrders([
      { id: 'a', sortOrder: 10 },
      { id: 'b', sortOrder: 5 },
    ]);
    const tasks = dbGetAllTasks();
    expect(tasks.find((t) => t.id === 'a')?.sortOrder).toBe(10);
    expect(tasks.find((t) => t.id === 'b')?.sortOrder).toBe(5);
  });

  it('is a no-op for an empty array', () => {
    dbInsertTask(makeTask({ id: 'a', sortOrder: 42 }));
    dbBatchUpdateSortOrders([]);
    expect(dbGetAllTasks()[0].sortOrder).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Bulk task operations
// ---------------------------------------------------------------------------

describe('dbTransaction', () => {
  it('commits every write made inside the callback', () => {
    dbTransaction(() => {
      dbInsertTask(makeTask({ id: 'a' }));
      dbInsertTask(makeTask({ id: 'b' }));
    });
    expect(dbGetAllTasks().map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('rolls back every write if the callback throws', () => {
    dbInsertTask(makeTask({ id: 'existing' }));
    expect(() => {
      dbTransaction(() => {
        dbInsertTask(makeTask({ id: 'a' }));
        throw new Error('boom');
      });
    }).toThrow('boom');
    expect(dbGetAllTasks().map((t) => t.id)).toEqual(['existing']);
  });
});

describe('dbBulkDeleteTasks', () => {
  it('deletes the specified task and cascades to its subtasks', () => {
    dbInsertTask(makeTask({ id: 'p' }));
    dbInsertTask(makeTask({ id: 'child', parentId: 'p' }));
    dbInsertTask(makeTask({ id: 'other' }));
    dbBulkDeleteTasks(['p']);
    expect(dbGetAllTasks().map((t) => t.id)).toEqual(['other']);
  });

  it('deletes multiple tasks in one call', () => {
    dbInsertTask(makeTask({ id: 'a' }));
    dbInsertTask(makeTask({ id: 'b' }));
    dbInsertTask(makeTask({ id: 'c' }));
    dbBulkDeleteTasks(['a', 'b']);
    expect(dbGetAllTasks().map((t) => t.id)).toEqual(['c']);
  });

  it('is a no-op for an empty array', () => {
    dbInsertTask(makeTask({ id: 'a' }));
    dbBulkDeleteTasks([]);
    expect(dbGetAllTasks()).toHaveLength(1);
  });

  it('chunks past the 500-id batch size, deleting parents and subtasks across chunks', () => {
    const ids = Array.from({ length: 600 }, (_, i) => `p${i}`);
    for (const id of ids) {
      dbInsertTask(makeTask({ id }));
      dbInsertTask(makeTask({ id: `${id}-child`, parentId: id }));
    }
    dbInsertTask(makeTask({ id: 'survivor' }));
    dbBulkDeleteTasks(ids);
    expect(dbGetAllTasks().map((t) => t.id)).toEqual(['survivor']);
  });
});

describe('dbBulkSetPriority', () => {
  it('updates priority on the specified tasks only', () => {
    dbInsertTask(makeTask({ id: 'a', priority: 0 }));
    dbInsertTask(makeTask({ id: 'b', priority: 0 }));
    dbBulkSetPriority(['a'], 3);
    const tasks = dbGetAllTasks();
    expect(tasks.find((t) => t.id === 'a')?.priority).toBe(3);
    expect(tasks.find((t) => t.id === 'b')?.priority).toBe(0);
  });

  it('is a no-op for an empty array', () => {
    dbInsertTask(makeTask({ id: 'a', priority: 1 }));
    dbBulkSetPriority([], 4);
    expect(dbGetAllTasks()[0].priority).toBe(1);
  });
});

describe('dbBulkSetDefer', () => {
  it('sets defer_until on the specified tasks only', () => {
    const until = '2025-06-20T00:00:00.000Z';
    dbInsertTask(makeTask({ id: 'a' }));
    dbInsertTask(makeTask({ id: 'b' }));
    dbBulkSetDefer(['a'], until);
    const tasks = dbGetAllTasks();
    expect(tasks.find((t) => t.id === 'a')?.deferUntil).toBe(until);
    expect(tasks.find((t) => t.id === 'b')?.deferUntil).toBeNull();
  });

  it('is a no-op for an empty array', () => {
    dbInsertTask(makeTask({ id: 'a' }));
    dbBulkSetDefer([], '2025-12-01T00:00:00.000Z');
    expect(dbGetAllTasks()[0].deferUntil).toBeNull();
  });
});

describe('dbBulkSetTimeSegments', () => {
  it('sets time_of_day on the specified tasks only', () => {
    dbInsertTask(makeTask({ id: 'a', timeSegments: ['evening'] }));
    dbInsertTask(makeTask({ id: 'b', timeSegments: ['evening'] }));

    dbBulkSetTimeSegments(['a'], ['night']);

    const tasks = dbGetAllTasks();
    expect(tasks.find((t) => t.id === 'a')?.timeSegments).toEqual(['night']);
    expect(tasks.find((t) => t.id === 'b')?.timeSegments).toEqual(['evening']);
  });

  // The point of having this alongside dbBulkSetWhen: that one writes
  // due_date in the same statement, so it can't move a segment without
  // unscheduling the task.
  it('leaves due_date alone', () => {
    dbInsertTask(makeTask({ id: 'a', dueDate: '2025-06-20T00:00:00.000Z', timeSegments: ['evening'] }));

    dbBulkSetTimeSegments(['a'], ['night']);

    expect(dbGetAllTasks()[0].dueDate).toBe('2025-06-20T00:00:00.000Z');
  });

  it('writes null rather than an empty array when the set is cleared', () => {
    dbInsertTask(makeTask({ id: 'a', timeSegments: ['evening'] }));

    dbBulkSetTimeSegments(['a'], []);

    expect(dbGetAllTasks()[0].timeSegments).toEqual([]);
  });

  it('is a no-op for an empty array', () => {
    dbInsertTask(makeTask({ id: 'a', timeSegments: ['evening'] }));
    dbBulkSetTimeSegments([], ['night']);
    expect(dbGetAllTasks()[0].timeSegments).toEqual(['evening']);
  });
});

describe('dbBulkAddTags', () => {
  it('merges new tags with existing tags', () => {
    dbInsertTask(makeTask({ id: 'a', tags: ['work'] }));
    dbBulkAddTags(['a'], ['urgent', 'focus']);
    expect(dbGetAllTasks()[0].tags).toEqual(expect.arrayContaining(['work', 'urgent', 'focus']));
  });

  it('deduplicates tags that already exist', () => {
    dbInsertTask(makeTask({ id: 'a', tags: ['work'] }));
    dbBulkAddTags(['a'], ['work', 'new']);
    const tags = dbGetAllTasks()[0].tags;
    expect(tags.filter((t) => t === 'work')).toHaveLength(1);
    expect(tags).toContain('new');
  });

  it('updates multiple tasks in one call', () => {
    dbInsertTask(makeTask({ id: 'a', tags: [] }));
    dbInsertTask(makeTask({ id: 'b', tags: [] }));
    dbBulkAddTags(['a', 'b'], ['shared']);
    dbGetAllTasks().forEach((t) => expect(t.tags).toContain('shared'));
  });

  it('is a no-op when ids is empty', () => {
    dbInsertTask(makeTask({ id: 'a', tags: ['x'] }));
    dbBulkAddTags([], ['new']);
    expect(dbGetAllTasks()[0].tags).toEqual(['x']);
  });

  it('is a no-op when tagsToAdd is empty', () => {
    dbInsertTask(makeTask({ id: 'a', tags: ['x'] }));
    dbBulkAddTags(['a'], []);
    expect(dbGetAllTasks()[0].tags).toEqual(['x']);
  });
});

// ---------------------------------------------------------------------------
// Tag registry
// ---------------------------------------------------------------------------

describe('Tag Registry', () => {
  it('dbGetTagRegistry returns [] when no registry has been set', () => {
    expect(dbGetTagRegistry()).toEqual([]);
  });

  it('dbAddToTagRegistry adds a new tag', () => {
    dbAddToTagRegistry('work');
    expect(dbGetTagRegistry()).toContain('work');
  });

  it('dbAddToTagRegistry does not add a duplicate', () => {
    dbAddToTagRegistry('work');
    dbAddToTagRegistry('work');
    expect(dbGetTagRegistry().filter((t) => t === 'work')).toHaveLength(1);
  });

  it('dbRemoveFromTagRegistry removes the tag and leaves others', () => {
    dbAddToTagRegistry('work');
    dbAddToTagRegistry('home');
    dbRemoveFromTagRegistry('work');
    const registry = dbGetTagRegistry();
    expect(registry).not.toContain('work');
    expect(registry).toContain('home');
  });

  it('dbRemoveTagFromAllTasks strips the tag from matching tasks', () => {
    dbInsertTask(makeTask({ id: 'a', tags: ['work', 'urgent'] }));
    dbInsertTask(makeTask({ id: 'b', tags: ['home'] }));
    dbRemoveTagFromAllTasks('work');
    const tasks = dbGetAllTasks();
    expect(tasks.find((t) => t.id === 'a')?.tags).toEqual(['urgent']);
    expect(tasks.find((t) => t.id === 'b')?.tags).toEqual(['home']);
  });

  it('dbRemoveTagFromAllTasks leaves tasks with no tags untouched', () => {
    dbInsertTask(makeTask({ id: 'a', tags: [] }));
    expect(() => dbRemoveTagFromAllTasks('anything')).not.toThrow();
    expect(dbGetAllTasks()[0].tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Category registry
// ---------------------------------------------------------------------------

describe('Category Registry', () => {
  it('dbGetCategoryRegistry returns [] when not set', () => {
    expect(dbGetCategoryRegistry()).toEqual([]);
  });
});

describe('Templates', () => {
  const makeTemplateItem = (overrides: Partial<TemplateItem> = {}): TemplateItem => ({
    id: 'item-1',
    title: 'Pack bags',
    notes: '',
    optional: false,
    anchor: 'start',
    dueOffsetDays: null,
    deferOffsetDays: null,
    deadlineOffsetDays: null,
    windowStart: null,
    windowEnd: null,
    reminderOffsetMinutes: null,
    timeSegments: [],
    tags: [],
    category: null,
    priority: 0,
    effort: 0,
    recurrenceType: 'none',
    recurrenceInterval: 1,
    recurrenceDays: [],
    recurrenceMonthDay: null,
    recurrenceFromCompletion: false,
    recurrenceCount: null,
    vacationPause: false,
    estimatedMinutes: null,
    chainEnabled: false,
    chainItems: [],
    subtasks: [],
    groupId: null,
    refTemplateId: null,
    refTemplateName: '',
    ...overrides,
  });

  const makeTemplate = (overrides: Partial<TaskTemplate> = {}): TaskTemplate => ({
    id: 'tpl-1',
    name: 'Pre-vacation',
    items: [],
    itemGroups: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    sortOrder: 1,
    category: null,
    applyContainer: 'stack',
    ...overrides,
  });

  it('insert → getAll round-trips items JSON', () => {
    const items = [
      makeTemplateItem({ id: 'a', title: 'Trash', dueOffsetDays: 0, timeSegments: ['morning'], tags: ['home'] }),
      makeTemplateItem({ id: 'b', title: 'Rental car', dueOffsetDays: -1, optional: true, priority: 2 }),
    ];
    dbInsertTemplate(makeTemplate({ items }));
    const [tpl] = dbGetAllTemplates();
    expect(tpl.name).toBe('Pre-vacation');
    expect(tpl.items).toEqual(items);
  });

  it('insert → getAll round-trips itemGroups JSON', () => {
    const itemGroups = [{ id: 'g1', title: 'Supplements', sortOrder: 1 }];
    dbInsertTemplate(makeTemplate({ itemGroups }));
    const [tpl] = dbGetAllTemplates();
    expect(tpl.itemGroups).toEqual(itemGroups);
  });

  it('orders by sort_order then created_at', () => {
    dbInsertTemplate(makeTemplate({ id: 'b', name: 'B', sortOrder: 2 }));
    dbInsertTemplate(makeTemplate({ id: 'a', name: 'A', sortOrder: 1 }));
    expect(dbGetAllTemplates().map(t => t.name)).toEqual(['A', 'B']);
  });

  it('dbUpdateTemplate updates name and items', () => {
    dbInsertTemplate(makeTemplate());
    dbUpdateTemplate(makeTemplate({ name: 'Trip prep', items: [makeTemplateItem()] }));
    const [tpl] = dbGetAllTemplates();
    expect(tpl.name).toBe('Trip prep');
    expect(tpl.items).toHaveLength(1);
  });

  it('dbDeleteTemplate removes the row', () => {
    dbInsertTemplate(makeTemplate());
    dbDeleteTemplate('tpl-1');
    expect(dbGetAllTemplates()).toHaveLength(0);
  });

  it('returns [] items for corrupted JSON', () => {
    dbInsertTemplate(makeTemplate());
    mockRawDb.prepare('UPDATE templates SET items = ? WHERE id = ?').run('not json', 'tpl-1');
    expect(dbGetAllTemplates()[0].items).toEqual([]);
  });

  it('fills defaults for items missing fields (forward compat)', () => {
    dbInsertTemplate(makeTemplate());
    mockRawDb
      .prepare('UPDATE templates SET items = ? WHERE id = ?')
      .run(JSON.stringify([{ id: 'x', title: 'Old item', futureField: 123 }]), 'tpl-1');
    const [tpl] = dbGetAllTemplates();
    expect(tpl.items[0]).toMatchObject({
      id: 'x',
      title: 'Old item',
      optional: false,
      dueOffsetDays: null,
      tags: [],
      priority: 0,
    });
  });
});

describe('Projects', () => {
  const makeProject = (overrides: Partial<Project> = {}): Project => ({
    id: 'project-1',
    title: 'Summer Bucket List',
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
    sequential: false,
    ...overrides,
  });

  it('insert → getAll round-trips a project', () => {
    dbInsertProject(makeProject({ targetStartDate: '2026-06-01T00:00:00.000Z', targetEndDate: '2026-09-01T00:00:00.000Z' }));
    const [p] = dbGetAllProjects();
    expect(p.title).toBe('Summer Bucket List');
    expect(p.targetStartDate).toBe('2026-06-01T00:00:00.000Z');
    expect(p.targetEndDate).toBe('2026-09-01T00:00:00.000Z');
    expect(p.archived).toBe(false);
  });

  it('orders by sort_order', () => {
    dbInsertProject(makeProject({ id: 'b', title: 'B', sortOrder: 2 }));
    dbInsertProject(makeProject({ id: 'a', title: 'A', sortOrder: 1 }));
    expect(dbGetAllProjects().map(p => p.title)).toEqual(['A', 'B']);
  });

  it('round-trips the nudge settings, with auto-schedule as a real boolean', () => {
    dbInsertProject(makeProject({ nudgeCadenceDays: 3, autoSchedule: true }));
    const [p] = dbGetAllProjects();
    expect(p.nudgeCadenceDays).toBe(3);
    expect(p.autoSchedule).toBe(true);
  });

  it('updates the nudge settings in place', () => {
    dbInsertProject(makeProject());
    dbUpdateProject(makeProject({ nudgeCadenceDays: 0, autoSchedule: false }));
    const [p] = dbGetAllProjects();
    expect(p.nudgeCadenceDays).toBe(0);
    expect(p.autoSchedule).toBe(false);
  });

  it('updates fields in place', () => {
    dbInsertProject(makeProject());
    dbUpdateProject(makeProject({ title: 'Renamed', archived: true, archivedAt: '2025-02-01T00:00:00.000Z' }));
    const [p] = dbGetAllProjects();
    expect(p.title).toBe('Renamed');
    expect(p.archived).toBe(true);
    expect(p.archivedAt).toBe('2025-02-01T00:00:00.000Z');
  });

  it('deletes a project', () => {
    dbInsertProject(makeProject());
    dbDeleteProject('project-1');
    expect(dbGetAllProjects()).toHaveLength(0);
  });

  it('batch-updates sort orders', () => {
    dbInsertProject(makeProject({ id: 'a', sortOrder: 1 }));
    dbInsertProject(makeProject({ id: 'b', sortOrder: 2 }));
    dbBatchUpdateProjectSortOrders([{ id: 'a', sortOrder: 2 }, { id: 'b', sortOrder: 1 }]);
    expect(dbGetAllProjects().map(p => p.id)).toEqual(['b', 'a']);
  });

  it('a task references a project by id', () => {
    dbInsertProject(makeProject());
    dbInsertTask(makeTask({ id: 't1', projectId: 'project-1' }));
    const [t] = dbGetAllTasks();
    expect(t.projectId).toBe('project-1');
  });
});

describe('Categories', () => {
  const makeTaskGroup = (overrides: Partial<TaskGroup> = {}): TaskGroup => ({
    id: 'group-1',
    title: 'Test Group',
    notes: '',
    tags: [],
    category: null,
    sortOrder: 1,
    collapsed: false,
    ...overrides,
  });

  it('dbSetCategoryDefaultTimeSegments round-trips, and clears back to empty', () => {
    const { id } = dbInsertCategory('Evening tasks');
    expect(dbGetAllCategories()[0].defaultTimeSegments).toEqual([]);

    dbSetCategoryDefaultTimeSegments(id, ['night']);
    expect(dbGetAllCategories()[0].defaultTimeSegments).toEqual(['night']);

    dbSetCategoryDefaultTimeSegments(id, []);
    expect(dbGetAllCategories()[0].defaultTimeSegments).toEqual([]);

    // This describe has no per-test cleanup and the two tests below assert on
    // the whole categories table, so put the row back.
    dbDeleteCategory('Evening tasks');
  });

  it('dbDeleteCategory removes the row and nulls category on both tasks and stacks', () => {
    dbInsertCategory('Home');
    dbInsertTask(makeTask({ id: 't1', category: 'Home' }));
    dbInsertTaskGroup(makeTaskGroup({ id: 'g1', category: 'Home' }));

    dbDeleteCategory('Home');

    expect(dbGetAllCategories()).toHaveLength(0);
    expect(dbGetAllTasks()[0].category).toBeNull();
    expect(dbGetAllTaskGroups()[0].category).toBeNull();
  });

  it('dbInsertCategoryRow restores a full category snapshot, including schedule fields', () => {
    const category: Category = {
      id: 'cat-1',
      name: 'Home',
      scheduleDays: [1, 2, 3],
      scheduleStart: '09:00',
      scheduleEnd: '17:00',
      hideOnVacation: true,
      excludeFromPinSuggestions: true,
      defaultTimeSegments: ['evening'],
      sortOrder: 3,
      emoji: '🏠',
    };
    dbInsertCategoryRow(category);
    expect(dbGetAllCategories()).toEqual([category]);
  });
});

// ---------------------------------------------------------------------------
// Backup / restore
// ---------------------------------------------------------------------------

describe('backup and restore', () => {
  beforeEach(() => {
    mockRawDb.exec(
      'DELETE FROM tasks; DELETE FROM settings; DELETE FROM templates; DELETE FROM projects;' +
      'DELETE FROM categories; DELETE FROM task_groups; DELETE FROM project_categories;' +
      'DELETE FROM template_categories;'
    );
  });

  it('dbTableColumns reports the live schema, migrations included', () => {
    const columns = dbTableColumns('tasks');
    expect(columns).toContain('id');
    expect(columns).toContain('title');
    // Added by a migration rather than the CREATE TABLE, so its presence is
    // what proves this reads the real schema and not the original statement.
    expect(columns).toContain('series_id');
  });

  it('dbExportTables returns every backed-up table, even the empty ones', () => {
    const tables = dbExportTables();
    for (const table of BACKUP_TABLES) {
      expect(Array.isArray(tables[table])).toBe(true);
    }
  });

  it('exports rows as raw columns rather than model objects', () => {
    dbInsertTask(makeTask({ id: 't1', title: 'Walk the dog', completed: true }));
    const [row] = dbExportTables().tasks;
    // snake_case column names and SQLite's 0/1 booleans — the raw row.
    expect(row.id).toBe('t1');
    expect(row.title).toBe('Walk the dog');
    expect(row.completed).toBe(1);
  });

  it('round-trips a full database through export and restore', () => {
    dbInsertTask(makeTask({ id: 't1', title: 'Walk the dog', tags: ['home'], priority: 3 }));
    dbInsertTask(makeTask({ id: 't2', title: 'Pay rent', completed: true }));
    dbInsertProject({
      id: 'p1', title: 'Summer list', notes: '', targetStartDate: null, targetEndDate: null,
      category: null, sortOrder: 1, archived: false, archivedAt: null,
      createdAt: '2025-01-01T00:00:00.000Z', nudgeCadenceDays: 14, autoSchedule: false, sequential: false,
    });
    dbInsertCategory('Home');
    dbSetSetting('themeMode', 'light');

    const before = dbExportTables();
    const backup = buildBackup(before, { appVersion: '1.0.0', exportedAt: new Date() });

    // Wipe everything, exactly as a fresh install would look.
    mockRawDb.exec('DELETE FROM tasks; DELETE FROM settings; DELETE FROM projects; DELETE FROM categories;');
    expect(dbGetAllTasks()).toHaveLength(0);

    dbReplaceAllData(backup.tables);

    expect(dbExportTables()).toEqual(before);
    expect(dbGetAllTasks().map(t => t.id).sort()).toEqual(['t1', 't2']);
    expect(dbGetAllProjects()).toHaveLength(1);
    expect(dbGetAllCategories()).toHaveLength(1);
    expect(dbGetSetting('themeMode')).toBe('light');
  });

  it('survives a serialize/parse round trip on the way through', () => {
    dbInsertTask(makeTask({ id: 't1', title: 'Quoted "title" and \\ backslash', notes: 'a\nb' }));
    const backup = buildBackup(dbExportTables(), { appVersion: '1.0.0', exportedAt: new Date() });

    const parsed = parseBackup(serializeBackup(backup));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    mockRawDb.exec('DELETE FROM tasks;');
    dbReplaceAllData(parsed.backup.tables);

    const [task] = dbGetAllTasks();
    expect(task.title).toBe('Quoted "title" and \\ backslash');
    expect(task.notes).toBe('a\nb');
  });

  it('replaces rather than merges — rows absent from the backup are gone', () => {
    dbInsertTask(makeTask({ id: 'keep', title: 'In the backup' }));
    const backup = dbExportTables();

    dbInsertTask(makeTask({ id: 'added-later', title: 'Not in the backup' }));
    expect(dbGetAllTasks()).toHaveLength(2);

    dbReplaceAllData(backup);
    expect(dbGetAllTasks().map(t => t.id)).toEqual(['keep']);
  });

  it('drops columns the running schema does not have', () => {
    const rows = [{ id: 't1', title: 'From the future', created_at: '2025-01-01T00:00:00.000Z', invented_in_v2: 'ignored' }];
    expect(() => dbReplaceAllData({ tasks: rows })).not.toThrow();
    expect(dbGetAllTasks()[0].title).toBe('From the future');
  });

  it('fills in the schema default for a column the backup predates', () => {
    // An old backup with only the original columns still restores; everything
    // added by a migration since falls back to its default.
    dbReplaceAllData({ tasks: [{ id: 't1', title: 'Old backup', created_at: '2025-01-01T00:00:00.000Z' }] });
    const [task] = dbGetAllTasks();
    expect(task.title).toBe('Old backup');
    expect(task.priority).toBe(0);
    expect(task.seriesMonthDays).toEqual([]);
  });

  // The column names reach SQL as text, so this is the guard that matters.
  it('ignores a column name carrying SQL instead of executing it', () => {
    const evil = [{ id: 't1', title: 'Nice try', created_at: '2025-01-01T00:00:00.000Z', 'x"); DROP TABLE tasks; --': 'boom' }];
    expect(() => dbReplaceAllData({ tasks: evil })).not.toThrow();
    expect(dbTableColumns('tasks')).toContain('id'); // table still exists
    expect(dbGetAllTasks()[0].title).toBe('Nice try');
  });

  it('leaves the old data in place when the restore throws part way', () => {
    dbInsertTask(makeTask({ id: 'original', title: 'Still here' }));
    const good = dbExportTables();

    // A row whose id is the right type but whose value violates NOT NULL —
    // enough to fail the insert after the DELETEs have already run.
    const broken = { ...good, tasks: [{ id: 't1', title: 'ok' }, { id: null, title: 'bad' }] };
    expect(() => dbReplaceAllData(broken as never)).toThrow();

    // The whole thing is one transaction, so the failure rolled the DELETEs
    // back too and the user still has what they had.
    expect(dbGetAllTasks().map(t => t.id)).toEqual(['original']);
  });

  it('restores an empty backup to an empty database without throwing', () => {
    dbInsertTask(makeTask({ id: 't1' }));
    dbReplaceAllData({});
    expect(dbGetAllTasks()).toHaveLength(0);
  });

  it('does not carry the API key out of the database', () => {
    dbSetSetting('anthropicApiKey', 'sk-ant-secret');
    dbSetSetting('themeMode', 'dark');
    const backup = buildBackup(dbExportTables(), { appVersion: '1.0.0', exportedAt: new Date() });

    const keys = backup.tables.settings.map(r => r.key);
    expect(keys).not.toContain('anthropicApiKey');
    expect(keys).toContain('themeMode');
    expect(serializeBackup(backup)).not.toContain('sk-ant-secret');
  });

  // Restoring must not wipe a key the user entered on this device: the backup
  // deliberately doesn't carry one, so there'd be nothing to put it back from.
  it('leaves an existing API key in place across a restore', () => {
    dbSetSetting('anthropicApiKey', 'sk-ant-local');
    dbSetSetting('themeMode', 'dark');
    const backup = buildBackup(dbExportTables(), { appVersion: '1.0.0', exportedAt: new Date() });

    dbSetSetting('themeMode', 'light'); // a change the restore should undo
    dbReplaceAllData(backup.tables);

    expect(dbGetSetting('anthropicApiKey')).toBe('sk-ant-local');
    expect(dbGetSetting('themeMode')).toBe('dark');
  });

  it('keeps the device key even when restoring a backup that carries one', () => {
    dbSetSetting('anthropicApiKey', 'sk-ant-local');
    // A hand-edited file, or one from a build that didn't redact.
    dbReplaceAllData({ settings: [{ key: 'anthropicApiKey', value: 'sk-ant-from-file' }] });
    expect(dbGetSetting('anthropicApiKey')).toBe('sk-ant-local');
  });

  it('does not invent an API key row when the device has none', () => {
    dbReplaceAllData({ settings: [{ key: 'themeMode', value: 'dark' }] });
    expect(dbGetSetting('anthropicApiKey')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Groceries
// ---------------------------------------------------------------------------

function makeGroceryItem(overrides: Partial<GroceryItem> & { id: string; name: string }): GroceryItem {
  return {
    nameKey: overrides.name.toLowerCase(),
    aisle: 'Other',
    quantity: null,
    note: '',
    onList: true,
    checked: false,
    inCatalog: true,
    sortOrder: 1,
    favorite: false,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null,
    ...overrides,
  };
}

describe('grocery items', () => {
  it('round-trips every field through rowToGroceryItem', () => {
    const item = makeGroceryItem({
      id: 'g1',
      name: 'Whole Milk',
      nameKey: 'whole milk',
      aisle: 'Dairy & Eggs',
      quantity: '2 gal',
      note: 'the blue cap one',
      onList: true,
      checked: true,
      sortOrder: 4,
      favorite: true,
      purchaseCount: 12,
      lastAddedAt: '2026-08-01T00:00:00.000Z',
      lastPurchasedAt: '2026-07-25T00:00:00.000Z',
    });
    dbInsertGroceryItem(item);

    expect(dbGetAllGroceryItems()).toEqual([item]);
  });

  it('keeps null quantity null rather than turning it into a string', () => {
    dbInsertGroceryItem(makeGroceryItem({ id: 'g1', name: 'Milk' }));
    expect(dbGetAllGroceryItems()[0].quantity).toBeNull();
  });

  it('stores booleans as 0/1 and reads them back as booleans', () => {
    dbInsertGroceryItem(makeGroceryItem({
      id: 'g1', name: 'Milk', onList: false, checked: false, favorite: true, inCatalog: false,
    }));
    const raw = mockRawDb.prepare('SELECT on_list, favorite, in_catalog FROM grocery_items WHERE id = ?').get('g1') as {
      on_list: number;
      favorite: number;
      in_catalog: number;
    };
    expect(raw.on_list).toBe(0);
    expect(raw.favorite).toBe(1);
    expect(raw.in_catalog).toBe(0);

    const item = dbGetAllGroceryItems()[0];
    expect(item.onList).toBe(false);
    expect(item.favorite).toBe(true);
    expect(item.inCatalog).toBe(false);
  });

  // The migration's default, and the only safe one: a row that predates the
  // provisional idea is a catalog member, not something a Remove from list may
  // delete out from under the user.
  it('reads a row written without in_catalog as a catalog member', () => {
    mockRawDb
      .prepare('INSERT INTO grocery_items (id, name, name_key, created_at) VALUES (?,?,?,?)')
      .run('g1', 'Milk', 'milk', '2026-01-01T00:00:00.000Z');
    expect(dbGetAllGroceryItems()[0].inCatalog).toBe(true);
  });

  // The no-duplicates guarantee lives in the schema, not in a store method a
  // future call site could bypass.
  it('rejects a second row with the same name_key', () => {
    dbInsertGroceryItem(makeGroceryItem({ id: 'g1', name: 'Milk', nameKey: 'milk' }));
    expect(() =>
      dbInsertGroceryItem(makeGroceryItem({ id: 'g2', name: 'MILK', nameKey: 'milk' }))
    ).toThrow();
  });

  it('updates in place', () => {
    const item = makeGroceryItem({ id: 'g1', name: 'Milk' });
    dbInsertGroceryItem(item);
    dbUpdateGroceryItem({ ...item, aisle: 'Dairy & Eggs', quantity: '1 gal', checked: true });

    const [after] = dbGetAllGroceryItems();
    expect(after.aisle).toBe('Dairy & Eggs');
    expect(after.quantity).toBe('1 gal');
    expect(after.checked).toBe(true);
  });

  it('deletes', () => {
    dbInsertGroceryItem(makeGroceryItem({ id: 'g1', name: 'Milk' }));
    dbDeleteGroceryItem('g1');
    expect(dbGetAllGroceryItems()).toEqual([]);
  });

  it('orders by sort_order', () => {
    dbInsertGroceryItem(makeGroceryItem({ id: 'g1', name: 'Zucchini', nameKey: 'zucchini', sortOrder: 9 }));
    dbInsertGroceryItem(makeGroceryItem({ id: 'g2', name: 'Apples', nameKey: 'apples', sortOrder: 2 }));
    expect(dbGetAllGroceryItems().map(i => i.id)).toEqual(['g2', 'g1']);
  });

  describe('dbFinishGroceryShopping', () => {
    it('touches only the checked rows and returns their ids', () => {
      dbInsertGroceryItem(makeGroceryItem({ id: 'g1', name: 'Milk', nameKey: 'milk', checked: true, purchaseCount: 3 }));
      dbInsertGroceryItem(makeGroceryItem({ id: 'g2', name: 'Eggs', nameKey: 'eggs', checked: false }));

      expect(dbFinishGroceryShopping('2026-08-07T12:00:00.000Z')).toEqual(['g1']);

      const byId = new Map(dbGetAllGroceryItems().map(i => [i.id, i]));
      expect(byId.get('g1')!.onList).toBe(false);
      expect(byId.get('g1')!.checked).toBe(false);
      expect(byId.get('g1')!.purchaseCount).toBe(4);
      expect(byId.get('g1')!.lastPurchasedAt).toBe('2026-08-07T12:00:00.000Z');
      // Not bought, so still on the list for next time.
      expect(byId.get('g2')!.onList).toBe(true);
    });

    it('promotes what was bought into the catalog', () => {
      dbInsertGroceryItem(makeGroceryItem({ id: 'g1', name: 'Milk', checked: true, inCatalog: false }));
      dbFinishGroceryShopping('2026-08-07T12:00:00.000Z');
      expect(dbGetAllGroceryItems()[0].inCatalog).toBe(true);
    });

    // Deleting would lose the ranking signal, not just the row.
    it('never deletes', () => {
      dbInsertGroceryItem(makeGroceryItem({ id: 'g1', name: 'Milk', checked: true }));
      dbFinishGroceryShopping('2026-08-07T12:00:00.000Z');
      expect(dbGetAllGroceryItems()).toHaveLength(1);
    });

    it('ignores a checked row that is already off the list', () => {
      dbInsertGroceryItem(makeGroceryItem({ id: 'g1', name: 'Milk', onList: false, checked: true }));
      expect(dbFinishGroceryShopping('2026-08-07T12:00:00.000Z')).toEqual([]);
    });

    it('is a no-op on an empty trolley', () => {
      dbInsertGroceryItem(makeGroceryItem({ id: 'g1', name: 'Milk' }));
      expect(dbFinishGroceryShopping('2026-08-07T12:00:00.000Z')).toEqual([]);
      expect(dbGetAllGroceryItems()[0].purchaseCount).toBe(0);
    });

    it('writes a per-item on_hand_until rather than one shared value', () => {
      dbInsertGroceryItem(makeGroceryItem({ id: 'g1', name: 'Milk', checked: true }));
      dbInsertGroceryItem(makeGroceryItem({ id: 'g2', name: 'Eggs', checked: true }));

      dbFinishGroceryShopping('2026-08-07T12:00:00.000Z', {
        g1: '2026-08-21T00:00:00.000Z',
        g2: '2026-08-14T00:00:00.000Z',
      });

      const byId = new Map(dbGetAllGroceryItems().map(i => [i.id, i]));
      expect(byId.get('g1')!.onHandUntil).toBe('2026-08-21T00:00:00.000Z');
      expect(byId.get('g2')!.onHandUntil).toBe('2026-08-14T00:00:00.000Z');
    });

    it('leaves on_hand_until untouched for a row the map says nothing about', () => {
      dbInsertGroceryItem(makeGroceryItem({ id: 'g1', name: 'Milk', checked: true, onHandUntil: '2026-08-01T00:00:00.000Z' }));
      dbFinishGroceryShopping('2026-08-07T12:00:00.000Z', {});
      expect(dbGetAllGroceryItems()[0].onHandUntil).toBe('2026-08-01T00:00:00.000Z');
    });
  });

  describe('dbClearGroceryList', () => {
    it('empties the list without crediting a purchase', () => {
      dbInsertGroceryItem(makeGroceryItem({ id: 'g1', name: 'Milk', nameKey: 'milk', checked: true, purchaseCount: 3 }));
      dbInsertGroceryItem(makeGroceryItem({ id: 'g2', name: 'Eggs', nameKey: 'eggs' }));

      expect(dbClearGroceryList().sort()).toEqual(['g1', 'g2']);

      const items = dbGetAllGroceryItems();
      expect(items.every(i => !i.onList && !i.checked)).toBe(true);
      expect(items.find(i => i.id === 'g1')!.purchaseCount).toBe(3);
    });

    // Parking, not forgetting — which is what the confirm promises, and what
    // keeps !onList ⇒ inCatalog true for the rows a provisional add left.
    it('promotes what it parks into the catalog', () => {
      dbInsertGroceryItem(makeGroceryItem({ id: 'g1', name: 'Milk', inCatalog: false }));
      dbClearGroceryList();
      expect(dbGetAllGroceryItems()[0].inCatalog).toBe(true);
    });
  });

  describe('aisle order', () => {
    it('is null on a fresh database', () => {
      expect(dbGetGroceryAisleOrder()).toBeNull();
    });

    it('survives a round trip', () => {
      dbSetGroceryAisleOrder(['Frozen', 'Produce', 'Other']);
      expect(dbGetGroceryAisleOrder()).toEqual(['Frozen', 'Produce', 'Other']);
    });

    it('shrugs off a corrupt value rather than throwing on startup', () => {
      dbSetSetting('grocery_aisle_order', 'not json');
      expect(dbGetGroceryAisleOrder()).toBeNull();
      dbSetSetting('grocery_aisle_order', '{"nope":1}');
      expect(dbGetGroceryAisleOrder()).toBeNull();
    });

    it('drops non-string entries', () => {
      dbSetSetting('grocery_aisle_order', '["Produce",7,null,"Frozen"]');
      expect(dbGetGroceryAisleOrder()).toEqual(['Produce', 'Frozen']);
    });
  });

  describe('remembered aisles', () => {
    it('is empty on a fresh database', () => {
      expect(dbGetGroceryAisleOverrides()).toEqual({});
    });

    it('survives a round trip', () => {
      dbSetGroceryAisleOverrides({ nduja: 'Deli', milk: 'Frozen' });
      expect(dbGetGroceryAisleOverrides()).toEqual({ nduja: 'Deli', milk: 'Frozen' });
    });

    it('shrugs off a corrupt value rather than throwing on startup', () => {
      dbSetSetting('grocery_aisle_overrides', 'not json');
      expect(dbGetGroceryAisleOverrides()).toEqual({});
      dbSetSetting('grocery_aisle_overrides', '["Produce"]');
      expect(dbGetGroceryAisleOverrides()).toEqual({});
    });

    it('drops entries that are not a name filed under an aisle', () => {
      dbSetSetting('grocery_aisle_overrides', '{"nduja":"Deli","milk":7,"bread":null,"":"Bakery"}');
      expect(dbGetGroceryAisleOverrides()).toEqual({ nduja: 'Deli' });
    });
  });

  describe('backup', () => {
    it('is in BACKUP_TABLES, so the first restore does not silently destroy it', () => {
      expect(BACKUP_TABLES).toContain('grocery_items');
    });

    it('survives an export/restore round trip', () => {
      const item = makeGroceryItem({
        id: 'g1',
        name: 'Whole Milk',
        nameKey: 'whole milk',
        aisle: 'Dairy & Eggs',
        quantity: '2 gal',
        purchaseCount: 12,
      });
      dbInsertGroceryItem(item);

      const backup = dbExportTables();
      mockRawDb.exec('DELETE FROM grocery_items');
      expect(dbGetAllGroceryItems()).toEqual([]);

      dbReplaceAllData(backup);
      expect(dbGetAllGroceryItems()).toEqual([item]);
    });
  });
});

// ---------------------------------------------------------------------------
// Meal plan
// ---------------------------------------------------------------------------

describe('meal plan entries', () => {
  let mealSeq = 0;
  const makeEntry = (
    date: string,
    slot: MealSlot = 'dinner',
    overrides: Partial<MealPlanEntry> = {}
  ): MealPlanEntry => {
    mealSeq += 1;
    return {
      id: `meal-${mealSeq}`,
      date,
      slot,
      recipeId: null,
      title: `Meal ${mealSeq}`,
      sortOrder: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      cookedAt: null,
      ...overrides,
    };
  };

  beforeEach(() => {
    mockRawDb.exec('DELETE FROM meal_plan_entries');
    mealSeq = 0;
  });

  it('round-trips an entry', () => {
    const planned = makeEntry('2026-08-05', 'dinner', {
      recipeId: 'r1', title: 'Sausage ragù', sortOrder: 2,
    });
    dbInsertMealPlanEntry(planned);

    expect(dbGetMealPlanEntries('2026-08-03', '2026-08-09')).toEqual([planned]);
  });

  it('stores a free-text meal with a null recipe', () => {
    const planned = makeEntry('2026-08-05', 'dinner', { recipeId: null, title: 'Leftovers' });
    dbInsertMealPlanEntry(planned);

    expect(dbGetMealPlanEntries('2026-08-05', '2026-08-05')[0].recipeId).toBeNull();
  });

  it('reads a range inclusively at both ends and excludes what falls outside', () => {
    dbInsertMealPlanEntry(makeEntry('2026-08-02'));
    dbInsertMealPlanEntry(makeEntry('2026-08-03'));
    dbInsertMealPlanEntry(makeEntry('2026-08-09'));
    dbInsertMealPlanEntry(makeEntry('2026-08-10'));

    expect(dbGetMealPlanEntries('2026-08-03', '2026-08-09').map(e => e.date))
      .toEqual(['2026-08-03', '2026-08-09']);
  });

  it('orders by day then by sort order', () => {
    dbInsertMealPlanEntry(makeEntry('2026-08-05', 'dinner', { sortOrder: 2 }));
    dbInsertMealPlanEntry(makeEntry('2026-08-05', 'dinner', { sortOrder: 1 }));
    dbInsertMealPlanEntry(makeEntry('2026-08-04', 'dinner', { sortOrder: 9 }));

    expect(dbGetMealPlanEntries('2026-08-01', '2026-08-31').map(e => [e.date, e.sortOrder]))
      .toEqual([['2026-08-04', 9], ['2026-08-05', 1], ['2026-08-05', 2]]);
  });

  // Two things on one dinner is real — chicken *and* a salad — so there is
  // deliberately no UNIQUE(date, slot) for an insert to trip over.
  it('accepts two entries in the same slot on the same day', () => {
    dbInsertMealPlanEntry(makeEntry('2026-08-05', 'dinner'));
    dbInsertMealPlanEntry(makeEntry('2026-08-05', 'dinner', { sortOrder: 2 }));

    expect(dbGetMealPlanEntries('2026-08-05', '2026-08-05')).toHaveLength(2);
  });

  it('updates a moved entry in place', () => {
    const planned = makeEntry('2026-08-05', 'dinner');
    dbInsertMealPlanEntry(planned);
    dbUpdateMealPlanEntry({ ...planned, date: '2026-08-07', slot: 'lunch', sortOrder: 3 });

    expect(dbGetMealPlanEntries('2026-08-01', '2026-08-31')).toEqual([
      { ...planned, date: '2026-08-07', slot: 'lunch', sortOrder: 3 },
    ]);
  });

  it('deletes one entry and leaves the rest', () => {
    const a = makeEntry('2026-08-05');
    const b = makeEntry('2026-08-06');
    dbInsertMealPlanEntry(a);
    dbInsertMealPlanEntry(b);

    dbDeleteMealPlanEntry(a.id);

    expect(dbGetMealPlanEntries('2026-08-01', '2026-08-31').map(e => e.id)).toEqual([b.id]);
  });

  // The column is a bare string and a restored backup can carry anything. An
  // entry that renders in the wrong slot is recoverable; one that vanishes from
  // the week is not.
  it('reads an unrecognised slot as dinner rather than dropping the row', () => {
    mockRawDb.prepare(
      `INSERT INTO meal_plan_entries (id, date, slot, recipe_id, title, sort_order, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run('m-odd', '2026-08-05', 'brunch', null, 'Shakshuka', 1, '2026-01-01T00:00:00.000Z');

    const [row] = dbGetMealPlanEntries('2026-08-05', '2026-08-05');
    expect(row.slot).toBe('dinner');
    expect(row.title).toBe('Shakshuka');
  });

  describe('purge', () => {
    it('takes everything before the cutoff and reports how many', () => {
      dbInsertMealPlanEntry(makeEntry('2026-02-08'));
      dbInsertMealPlanEntry(makeEntry('2026-02-09'));
      dbInsertMealPlanEntry(makeEntry('2026-08-05'));

      expect(dbPurgeOldMealPlanEntries('2026-02-09')).toBe(1);
      expect(dbGetMealPlanEntries('2026-01-01', '2026-12-31').map(e => e.date))
        .toEqual(['2026-02-09', '2026-08-05']);
    });

    it('is a no-op when nothing is old enough', () => {
      dbInsertMealPlanEntry(makeEntry('2026-08-05'));
      expect(dbPurgeOldMealPlanEntries('2026-02-09')).toBe(0);
      expect(dbGetMealPlanEntries('2026-01-01', '2026-12-31')).toHaveLength(1);
    });
  });

  describe('backup', () => {
    it('is in BACKUP_TABLES, so the first restore does not silently destroy it', () => {
      expect(BACKUP_TABLES).toContain('meal_plan_entries');
    });

    it('survives an export/restore round trip', () => {
      const planned = makeEntry('2026-08-05', 'dinner', { recipeId: 'r1', title: 'Sausage ragù' });
      dbInsertMealPlanEntry(planned);

      const backup = dbExportTables();
      mockRawDb.exec('DELETE FROM meal_plan_entries');
      expect(dbGetMealPlanEntries('2026-08-01', '2026-08-31')).toEqual([]);

      dbReplaceAllData(backup);
      expect(dbGetMealPlanEntries('2026-08-01', '2026-08-31')).toEqual([planned]);
    });
  });
});
