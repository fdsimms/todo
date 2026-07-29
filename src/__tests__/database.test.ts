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
  dbClearAllFocus,
  dbBatchUpdateSortOrders,
  dbBulkDeleteTasks,
  dbBulkSetPriority,
  dbBulkSetDefer,
  dbBulkAddTags,
  dbRemoveTagFromAllTasks,
  dbGetTagRegistry,
  dbAddToTagRegistry,
  dbRemoveFromTagRegistry,
  dbGetCategoryRegistry,
  dbAddToCategoryRegistry,
  dbRemoveFromCategoryRegistry,
  dbRemoveCategoryFromAllTasks,
  dbGetAllTemplates,
  dbInsertTemplate,
  dbUpdateTemplate,
  dbDeleteTemplate,
} from '../db/database';
import type { Task, TaskTemplate, TemplateItem } from '../types';

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runSync(sql: string, params: any[] = []) {
        mockRawDb.prepare(sql).run(...params);
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
  createdAt: '2025-01-01T00:00:00.000Z',
  seenAt: null,
  dueDate: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  tags: [],
  category: null,
  sortOrder: 1,
  focused: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  parentId: null,
  reminderTime: null,
  cycleEnabled: false,
  cycleIndex: 0,
  cycleItems: [],
  vacationPause: false,
  timerStartedAt: null,
  actualMinutes: null,
  previousOccurrenceId: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Setup — create schema once, clear rows before each test
// ---------------------------------------------------------------------------

beforeAll(() => {
  initDatabase();
});

beforeEach(() => {
  mockRawDb.exec('DELETE FROM tasks; DELETE FROM settings; DELETE FROM templates;');
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
      'focused', 'priority', 'effort', 'streak_count', 'streak_date',
      'recurrence_from_completion', 'parent_id', 'reminder_time',
      'cycle_enabled', 'cycle_index', 'cycle_items',
      'time_of_day', 'category', 'vacation_pause', 'estimated_minutes',
      'window_start', 'window_end',
    ]) {
      expect(cols).toContain(col);
    }
  });

  it('is idempotent — safe to call multiple times', () => {
    expect(() => initDatabase()).not.toThrow();
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

  it('deserialises boolean columns back to JS booleans', () => {
    dbInsertTask(
      makeTask({
        id: 'bools',
        completed: true,
        completedAt: '2025-06-10T10:00:00.000Z',
        focused: true,
        recurrenceFromCompletion: true,
        cycleEnabled: true,
        vacationPause: true,
      }),
    );
    const [t] = dbGetAllTasks();
    expect(t.completed).toBe(true);
    expect(t.focused).toBe(true);
    expect(t.recurrenceFromCompletion).toBe(true);
    expect(t.cycleEnabled).toBe(true);
    expect(t.vacationPause).toBe(true);
  });

  it('deserialises false boolean columns correctly', () => {
    dbInsertTask(makeTask({ id: 'falsy' }));
    const [t] = dbGetAllTasks();
    expect(t.completed).toBe(false);
    expect(t.focused).toBe(false);
    expect(t.recurrenceFromCompletion).toBe(false);
    expect(t.cycleEnabled).toBe(false);
    expect(t.vacationPause).toBe(false);
  });

  it('deserialises JSON array columns (tags, recurrenceDays, cycleItems)', () => {
    const tags = ['work', 'urgent'];
    const recurrenceDays = [1, 3, 5];
    const cycleItems = [{ id: 'ci', title: 'Item A', notes: '' }];
    dbInsertTask(makeTask({ id: 'json', tags, recurrenceDays, cycleItems }));
    const [t] = dbGetAllTasks();
    expect(t.tags).toEqual(tags);
    expect(t.recurrenceDays).toEqual(recurrenceDays);
    expect(t.cycleItems).toEqual(cycleItems);
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
    expect(t.deferUntil).toBeNull();
    expect(t.completedAt).toBeNull();
    expect(t.recurrenceEndDate).toBeNull();
    expect(t.recurrenceCount).toBeNull();
    expect(t.streakDate).toBeNull();
    expect(t.parentId).toBeNull();
    expect(t.reminderTime).toBeNull();
    expect(t.category).toBeNull();
    expect(t.previousOccurrenceId).toBeNull();
  });

  it('round-trips previousOccurrenceId', () => {
    dbInsertTask(makeTask({ id: 'occurrence', previousOccurrenceId: 'original-task' }));
    const [t] = dbGetAllTasks();
    expect(t.previousOccurrenceId).toBe('original-task');
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
      timeSegments: ['afternoon'],
      windowStart: '08:00',
      windowEnd: '13:00',
      recurrenceType: 'weekly',
      recurrenceInterval: 2,
      recurrenceDays: [1, 5],
      tags: ['updated'],
      category: 'Work',
      sortOrder: 99,
      focused: true,
      priority: 3,
      effort: 2,
      estimatedMinutes: 75,
      streakCount: 5,
      cycleEnabled: true,
      cycleItems: [{ id: 'ci', title: 'C', notes: '' }],
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
  });

  it('does not touch other rows', () => {
    dbInsertTask(makeTask({ id: 'keep', title: 'Keep Me' }));
    dbInsertTask(makeTask({ id: 'edit', title: 'Edit Me' }));
    dbUpdateTask(makeTask({ id: 'edit', title: 'Edited' }));
    expect(dbGetAllTasks().find((t) => t.id === 'keep')?.title).toBe('Keep Me');
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
// Focus
// ---------------------------------------------------------------------------

describe('dbClearAllFocus', () => {
  it('sets focused = false on every focused task', () => {
    dbInsertTask(makeTask({ id: 'f1', focused: true }));
    dbInsertTask(makeTask({ id: 'f2', focused: true }));
    dbInsertTask(makeTask({ id: 'n', focused: false }));
    dbClearAllFocus();
    dbGetAllTasks().forEach((t) => expect(t.focused).toBe(false));
  });

  it('is safe to call when no tasks are focused', () => {
    dbInsertTask(makeTask({ id: 'n' }));
    expect(() => dbClearAllFocus()).not.toThrow();
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

  it('dbAddToCategoryRegistry adds a category', () => {
    dbAddToCategoryRegistry('Work');
    expect(dbGetCategoryRegistry()).toContain('Work');
  });

  it('dbAddToCategoryRegistry does not duplicate', () => {
    dbAddToCategoryRegistry('Work');
    dbAddToCategoryRegistry('Work');
    expect(dbGetCategoryRegistry().filter((c) => c === 'Work')).toHaveLength(1);
  });

  it('dbRemoveFromCategoryRegistry removes the entry and leaves others', () => {
    dbAddToCategoryRegistry('Work');
    dbAddToCategoryRegistry('Home');
    dbRemoveFromCategoryRegistry('Work');
    expect(dbGetCategoryRegistry()).not.toContain('Work');
    expect(dbGetCategoryRegistry()).toContain('Home');
  });

  it('dbRemoveCategoryFromAllTasks nullifies category on matching tasks', () => {
    dbInsertTask(makeTask({ id: 'a', category: 'Work' }));
    dbInsertTask(makeTask({ id: 'b', category: 'Home' }));
    dbRemoveCategoryFromAllTasks('Work');
    const tasks = dbGetAllTasks();
    expect(tasks.find((t) => t.id === 'a')?.category).toBeNull();
    expect(tasks.find((t) => t.id === 'b')?.category).toBe('Home');
  });

  it('dbRemoveCategoryFromAllTasks is a no-op when no tasks match', () => {
    dbInsertTask(makeTask({ id: 'a', category: 'Other' }));
    expect(() => dbRemoveCategoryFromAllTasks('NonExistent')).not.toThrow();
    expect(dbGetAllTasks()[0].category).toBe('Other');
  });
});

describe('Templates', () => {
  const makeTemplateItem = (overrides: Partial<TemplateItem> = {}): TemplateItem => ({
    id: 'item-1',
    title: 'Pack bags',
    notes: '',
    optional: false,
    dueOffsetDays: null,
    deferOffsetDays: null,
    timeSegments: [],
    tags: [],
    category: null,
    priority: 0,
    effort: 0,
    ...overrides,
  });

  const makeTemplate = (overrides: Partial<TaskTemplate> = {}): TaskTemplate => ({
    id: 'tpl-1',
    name: 'Pre-vacation',
    items: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    sortOrder: 1,
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
