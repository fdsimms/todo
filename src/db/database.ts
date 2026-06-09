import * as SQLite from 'expo-sqlite';
import type { Task, Project, TimeOfDay } from '../types';

function parseTimeSegments(raw: unknown): TimeOfDay[] {
  if (!raw) return [];
  const s = raw as string;
  if (s.startsWith('[')) {
    try { return JSON.parse(s) as TimeOfDay[]; } catch { return []; }
  }
  return [s as TimeOfDay];
}

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
      time_of_day TEXT,
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
      cycle_enabled INTEGER NOT NULL DEFAULT 0,
      cycle_index INTEGER NOT NULL DEFAULT 0,
      cycle_items TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      color TEXT NOT NULL DEFAULT '#0A84FF',
      sort_order REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
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
    'ALTER TABLE tasks ADD COLUMN cycle_enabled INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN cycle_index INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE tasks ADD COLUMN cycle_items TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE tasks ADD COLUMN project_id TEXT',
    'ALTER TABLE tasks ADD COLUMN time_of_day TEXT',
    'ALTER TABLE tasks ADD COLUMN category TEXT',
    'ALTER TABLE tasks ADD COLUMN vacation_pause INTEGER NOT NULL DEFAULT 0',
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
    timeSegments: parseTimeSegments(row.time_of_day),
    recurrenceType: (row.recurrence_type as Task['recurrenceType']) ?? 'none',
    recurrenceInterval: (row.recurrence_interval as number) ?? 1,
    recurrenceDays: JSON.parse((row.recurrence_days as string) ?? '[]') as number[],
    recurrenceEndDate: (row.recurrence_end_date as string) ?? null,
    recurrenceFromCompletion: Boolean(row.recurrence_from_completion),
    tags: JSON.parse((row.tags as string) ?? '[]') as string[],
    category: (row.category as string) ?? null,
    sortOrder: row.sort_order as number,
    focused: Boolean(row.focused),
    priority: ((row.priority as number) ?? 0) as Task['priority'],
    effort: ((row.effort as number) ?? 0) as Task['effort'],
    streakCount: (row.streak_count as number) ?? 0,
    streakDate: (row.streak_date as string) ?? null,
    parentId: (row.parent_id as string) ?? null,
    reminderTime: (row.reminder_time as string) ?? null,
    cycleEnabled: Boolean(row.cycle_enabled),
    cycleIndex: (row.cycle_index as number) ?? 0,
    cycleItems: JSON.parse((row.cycle_items as string) ?? '[]'),
    projectId: (row.project_id as string) ?? null,
    vacationPause: Boolean(row.vacation_pause),
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
      due_date, defer_until, time_of_day,
      recurrence_type, recurrence_interval, recurrence_days, recurrence_end_date, recurrence_from_completion,
      tags, category, sort_order, focused, priority, effort, streak_count, streak_date, parent_id, reminder_time,
      cycle_enabled, cycle_index, cycle_items, project_id, vacation_pause
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      task.id, task.title, task.notes, task.completed ? 1 : 0,
      task.completedAt, task.createdAt, task.dueDate, task.deferUntil,
      task.timeSegments.length ? JSON.stringify(task.timeSegments) : null, task.recurrenceType, task.recurrenceInterval,
      JSON.stringify(task.recurrenceDays), task.recurrenceEndDate,
      task.recurrenceFromCompletion ? 1 : 0,
      JSON.stringify(task.tags), task.category ?? null, task.sortOrder,
      task.focused ? 1 : 0, task.priority, task.effort,
      task.streakCount, task.streakDate, task.parentId ?? null, task.reminderTime,
      task.cycleEnabled ? 1 : 0, task.cycleIndex, JSON.stringify(task.cycleItems),
      task.projectId ?? null, task.vacationPause ? 1 : 0,
    ]
  );
}

export function dbUpdateTask(task: Task): void {
  db.runSync(
    `UPDATE tasks SET
      title=?, notes=?, completed=?, completed_at=?,
      due_date=?, defer_until=?, time_of_day=?,
      recurrence_type=?, recurrence_interval=?, recurrence_days=?, recurrence_end_date=?, recurrence_from_completion=?,
      tags=?, category=?, sort_order=?, focused=?, priority=?, effort=?,
      streak_count=?, streak_date=?, parent_id=?, reminder_time=?,
      cycle_enabled=?, cycle_index=?, cycle_items=?, project_id=?, vacation_pause=?
    WHERE id=?`,
    [
      task.title, task.notes, task.completed ? 1 : 0, task.completedAt,
      task.dueDate, task.deferUntil, task.timeSegments.length ? JSON.stringify(task.timeSegments) : null,
      task.recurrenceType, task.recurrenceInterval,
      JSON.stringify(task.recurrenceDays), task.recurrenceEndDate,
      task.recurrenceFromCompletion ? 1 : 0,
      JSON.stringify(task.tags), task.category ?? null, task.sortOrder,
      task.focused ? 1 : 0, task.priority, task.effort,
      task.streakCount, task.streakDate, task.parentId ?? null, task.reminderTime,
      task.cycleEnabled ? 1 : 0, task.cycleIndex, JSON.stringify(task.cycleItems),
      task.projectId ?? null, task.vacationPause ? 1 : 0,
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

export function dbBulkDeleteTasks(ids: string[]): void {
  if (ids.length === 0) return;
  db.withTransactionSync(() => {
    for (const id of ids) {
      db.runSync('DELETE FROM tasks WHERE parent_id = ?', [id]);
      db.runSync('DELETE FROM tasks WHERE id = ?', [id]);
    }
  });
}

export function dbBulkSetPriority(ids: string[], priority: number): void {
  if (ids.length === 0) return;
  db.withTransactionSync(() => {
    for (const id of ids) {
      db.runSync('UPDATE tasks SET priority = ? WHERE id = ?', [priority, id]);
    }
  });
}

export function dbBulkSetDefer(ids: string[], deferUntil: string): void {
  if (ids.length === 0) return;
  db.withTransactionSync(() => {
    for (const id of ids) {
      db.runSync('UPDATE tasks SET defer_until = ? WHERE id = ?', [deferUntil, id]);
    }
  });
}

export function dbGetTagRegistry(): string[] {
  const val = dbGetSetting('tag_registry');
  if (!val) return [];
  try { return JSON.parse(val) as string[]; } catch { return []; }
}

export function dbAddToTagRegistry(tag: string): void {
  const current = dbGetTagRegistry();
  if (!current.includes(tag)) {
    dbSetSetting('tag_registry', JSON.stringify([...current, tag]));
  }
}

export function dbRemoveFromTagRegistry(tag: string): void {
  const current = dbGetTagRegistry();
  dbSetSetting('tag_registry', JSON.stringify(current.filter(t => t !== tag)));
}

export function dbRemoveTagFromAllTasks(tag: string): void {
  const rows = db.getAllSync<{ id: string; tags: string }>(
    "SELECT id, tags FROM tasks WHERE tags != '[]'"
  );
  db.withTransactionSync(() => {
    for (const row of rows) {
      const existing: string[] = JSON.parse(row.tags ?? '[]');
      if (!existing.includes(tag)) continue;
      const updated = existing.filter(t => t !== tag);
      db.runSync('UPDATE tasks SET tags = ? WHERE id = ?', [JSON.stringify(updated), row.id]);
    }
  });
}

export function dbBulkAddTags(ids: string[], tagsToAdd: string[]): void {
  if (ids.length === 0 || tagsToAdd.length === 0) return;
  db.withTransactionSync(() => {
    for (const id of ids) {
      const row = db.getFirstSync<{ tags: string }>('SELECT tags FROM tasks WHERE id = ?', [id]);
      if (!row) continue;
      const existing: string[] = JSON.parse(row.tags ?? '[]');
      const merged = Array.from(new Set([...existing, ...tagsToAdd]));
      db.runSync('UPDATE tasks SET tags = ? WHERE id = ?', [JSON.stringify(merged), id]);
    }
  });
}

export function dbGetCategoryRegistry(): string[] {
  const val = dbGetSetting('category_registry');
  if (!val) return [];
  try { return JSON.parse(val) as string[]; } catch { return []; }
}

export function dbAddToCategoryRegistry(name: string): void {
  const current = dbGetCategoryRegistry();
  if (!current.includes(name)) {
    dbSetSetting('category_registry', JSON.stringify([...current, name]));
  }
}

export function dbRemoveFromCategoryRegistry(name: string): void {
  const current = dbGetCategoryRegistry();
  dbSetSetting('category_registry', JSON.stringify(current.filter(c => c !== name)));
}

export function dbRemoveCategoryFromAllTasks(name: string): void {
  db.runSync("UPDATE tasks SET category = NULL WHERE category = ?", [name]);
}

// ─── Projects ─────────────────────────────────────────────────────────────────

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    notes: row.notes as string,
    dueDate: (row.due_date as string) ?? null,
    color: row.color as string,
    order: row.sort_order as number,
    createdAt: row.created_at as string,
  };
}

export function dbGetAllProjects(): Project[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    'SELECT * FROM projects ORDER BY sort_order ASC, created_at ASC'
  );
  return rows.map(rowToProject);
}

export function dbInsertProject(project: Project): void {
  db.runSync(
    'INSERT INTO projects (id, name, notes, due_date, color, sort_order, created_at) VALUES (?,?,?,?,?,?,?)',
    [project.id, project.name, project.notes, project.dueDate, project.color, project.order, project.createdAt]
  );
}

export function dbUpdateProject(project: Project): void {
  db.runSync(
    'UPDATE projects SET name=?, notes=?, due_date=?, color=?, sort_order=? WHERE id=?',
    [project.name, project.notes, project.dueDate, project.color, project.order, project.id]
  );
}

export function dbDeleteProject(id: string): void {
  db.runSync('DELETE FROM projects WHERE id = ?', [id]);
  db.runSync('UPDATE tasks SET project_id = NULL WHERE project_id = ?', [id]);
}

export function dbBatchUpdateProjectOrders(updates: { id: string; order: number }[]): void {
  db.withTransactionSync(() => {
    for (const { id, order } of updates) {
      db.runSync('UPDATE projects SET sort_order = ? WHERE id = ?', [order, id]);
    }
  });
}
