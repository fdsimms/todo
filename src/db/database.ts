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
      tags TEXT NOT NULL DEFAULT '[]',
      sort_order REAL NOT NULL DEFAULT 0
    );
  `);
}

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
    tags: JSON.parse((row.tags as string) ?? '[]') as string[],
    sortOrder: row.sort_order as number,
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
      recurrence_type, recurrence_interval, recurrence_days, recurrence_end_date,
      tags, sort_order
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      task.id,
      task.title,
      task.notes,
      task.completed ? 1 : 0,
      task.completedAt,
      task.createdAt,
      task.dueDate,
      task.deferUntil,
      task.showAfterTime,
      task.recurrenceType,
      task.recurrenceInterval,
      JSON.stringify(task.recurrenceDays),
      task.recurrenceEndDate,
      JSON.stringify(task.tags),
      task.sortOrder,
    ]
  );
}

export function dbUpdateTask(task: Task): void {
  db.runSync(
    `UPDATE tasks SET
      title=?, notes=?, completed=?, completed_at=?,
      due_date=?, defer_until=?, show_after_time=?,
      recurrence_type=?, recurrence_interval=?, recurrence_days=?, recurrence_end_date=?,
      tags=?, sort_order=?
    WHERE id=?`,
    [
      task.title,
      task.notes,
      task.completed ? 1 : 0,
      task.completedAt,
      task.dueDate,
      task.deferUntil,
      task.showAfterTime,
      task.recurrenceType,
      task.recurrenceInterval,
      JSON.stringify(task.recurrenceDays),
      task.recurrenceEndDate,
      JSON.stringify(task.tags),
      task.sortOrder,
      task.id,
    ]
  );
}

export function dbDeleteTask(id: string): void {
  db.runSync('DELETE FROM tasks WHERE id = ?', [id]);
}
