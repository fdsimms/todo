import * as SQLite from 'expo-sqlite';
import type { Task } from '../types';

const db = SQLite.openDatabaseSync('todo.db');

export function initDatabase(): void {
  db.execSync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      due_date TEXT,
      defer_until TEXT,
      show_after_time TEXT,
      recurrence_type TEXT NOT NULL DEFAULT 'none',
      recurrence_interval INTEGER NOT NULL DEFAULT 1,
      recurrence_days TEXT NOT NULL DEFAULT '[]',
      recurrence_end_date TEXT,
      recurrence_from_completion INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      sort_order REAL NOT NULL DEFAULT 0,
      focused INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      effort INTEGER NOT NULL DEFAULT 0,
      streak_count INTEGER NOT NULL DEFAULT 0,
      streak_date TEXT,
      parent_id TEXT,
      reminder_time TEXT,
      someday INTEGER NOT NULL DEFAULT 0,
      cycle_enabled INTEGER NOT NULL DEFAULT 0,
      cycle_index INTEGER NOT NULL DEFAULT 0,
      cycle_items TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrations for existing installs (safe to run multiple times — fails silently if column exists)
  const migrations = [
    'ALTER TABLE tasks ADD COLUMN focused INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN effort INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN streak_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN streak_date TEXT',
    'ALTER TABLE tasks ADD COLUMN recurrence_from_completion INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN parent_id TEXT',
    'ALTER TABLE tasks ADD COLUMN reminder_time TEXT',
    'ALTER TABLE tasks ADD COLUMN someday INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN cycle_enabled INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN cycle_index INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE tasks ADD COLUMN cycle_items TEXT NOT NULL DEFAULT '[]'",
  ];
  for (const sql of migrations) {
    try { db.runSync(sql); } catch (_) { /* column already exists */ }
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function dbGetSetting(key: string): string | null {
  return db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])?.value ?? null;
}

export function dbSetSetting(key: string, value: string): void {
  db.runSync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    notes: row.notes as string,
    completed: Boolean(row.completed),
    completedAt: (row.completed_at as string) ?? null,
    createdAt: row.created_at as string,
    dueDate: (row.due_date as string) ?? null,
    deferUntil: (row.defer_until as string) ?? null,
    showAfterTime: (row.show_after_time as string) ?? null,
    recurrenceType: (row.recurrence_type as Task['recurrenceType']) ?? 'none',
    recurrenceInterval: (row.recurrence_interval as number) ?? 1,
    recurrenceDays: JSON.parse((row.recurrence_days as string) ?? '[]') as number[],
    recurrenceEndDate: (row.recurrence_end_date as string) ?? null,
    recurrenceFromCompletion: Boolean(row.recurrence_from_completion),
    tags: JSON.parse((row.tags as string) ?? '[]') as string[],
    sortOrder: row.sort_order as number,
    focused: Boolean(row.focused),
    priority: ((row.priority as number) ?? 0) as Task['priority'],
    effort: ((row.effort as number) ?? 0) as Task['effort'],
    streakCount: (row.streak_count as number) ?? 0,
    streakDate: (row.streak_date as string) ?? null,
    parentId: (row.parent_id as string) ?? null,
    reminderTime: (row.reminder_time as string) ?? null,
    someday: Boolean(row.someday),
    cycleEnabled: Boolean(row.cycle_enabled),
    cycleIndex: (row.cycle_index as number) ?? 0,
    cycleItems: JSON.parse((row.cycle_items as string) ?? '[]'),
  };
}

export function dbGetAllTasks(): Task[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    'SELECT * FROM tasks ORDER BY sort_order ASC, created_at ASC'
  );
  return rows.map(rowToTask);
}

export function dbInsertTask(task: Task): void {
  db.runSync(
    `INSERT INTO tasks (
      id, title, notes, completed, completed_at, created_at,
      due_date, defer_until, show_after_time,
      recurrence_type, recurrence_interval, recurrence_days, recurrence_end_date, recurrence_from_completion,
      tags, sort_order, focused, priority, effort, streak_count, streak_date, parent_id, reminder_time, someday,
      cycle_enabled, cycle_index, cycle_items
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      task.id, task.title, task.notes, task.completed ? 1 : 0,
      task.completedAt, task.createdAt, task.dueDate, task.deferUntil,
      task.showAfterTime, task.recurrenceType, task.recurrenceInterval,
      JSON.stringify(task.recurrenceDays), task.recurrenceEndDate,
      task.recurrenceFromCompletion ? 1 : 0,
      JSON.stringify(task.tags), task.sortOrder,
      task.focused ? 1 : 0, task.priority, task.effort,
      task.streakCount, task.streakDate, task.parentId ?? null, task.reminderTime,
      task.someday ? 1 : 0,
      task.cycleEnabled ? 1 : 0, task.cycleIndex, JSON.stringify(task.cycleItems),
    ]
  );
}

export function dbUpdateTask(task: Task): void {
  db.runSync(
    `UPDATE tasks SET
      title=?, notes=?, completed=?, completed_at=?,
      due_date=?, defer_until=?, show_after_time=?,
      recurrence_type=?, recurrence_interval=?, recurrence_days=?, recurrence_end_date=?, recurrence_from_completion=?,
      tags=?, sort_order=?, focused=?, priority=?, effort=?,
      streak_count=?, streak_date=?, parent_id=?, reminder_time=?, someday=?,
      cycle_enabled=?, cycle_index=?, cycle_items=?
    WHERE id=?`,
    [
      task.title, task.notes, task.completed ? 1 : 0, task.completedAt,
      task.dueDate, task.deferUntil, task.showAfterTime,
      task.recurrenceType, task.recurrenceInterval,
      JSON.stringify(task.recurrenceDays), task.recurrenceEndDate,
      task.recurrenceFromCompletion ? 1 : 0,
      JSON.stringify(task.tags), task.sortOrder,
      task.focused ? 1 : 0, task.priority, task.effort,
      task.streakCount, task.streakDate, task.parentId ?? null, task.reminderTime,
      task.someday ? 1 : 0,
      task.cycleEnabled ? 1 : 0, task.cycleIndex, JSON.stringify(task.cycleItems),
      task.id,
    ]
  );
}

export function dbBatchUpdateSortOrders(updates: { id: string; sortOrder: number }[]): void {
  db.withTransactionSync(() => {
    for (const { id, sortOrder } of updates) {
      db.runSync('UPDATE tasks SET sort_order = ? WHERE id = ?', [sortOrder, id]);
    }
  });
}

export function dbDeleteTask(id: string): void {
  db.runSync('DELETE FROM tasks WHERE id = ?', [id]);
}

export function dbDeleteSubtasks(parentId: string): void {
  db.runSync('DELETE FROM tasks WHERE parent_id = ?', [parentId]);
}

export function dbClearAllFocus(): void {
  db.runSync('UPDATE tasks SET focused = 0 WHERE focused = 1');
}
