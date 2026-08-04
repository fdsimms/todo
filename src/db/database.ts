import * as SQLite from 'expo-sqlite';
import type { Task, Category, TaskGroup, Project, TaskTemplate, TemplateItem, TimeOfDay } from '../types';
import { generateId } from '../utils/id';
import { normalizeTemplateItem } from '../utils/templateUtils';

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
      seen_at TEXT,
      due_date TEXT,
      defer_until TEXT,
      time_of_day TEXT,
      window_start TEXT,
      window_end TEXT,
      recurrence_type TEXT NOT NULL DEFAULT 'none',
      recurrence_interval INTEGER NOT NULL DEFAULT 1,
      recurrence_days TEXT NOT NULL DEFAULT '[]',
      recurrence_end_date TEXT,
      recurrence_count INTEGER,
      recurrence_from_completion INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      sort_order REAL NOT NULL DEFAULT 0,
      focused INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      effort INTEGER NOT NULL DEFAULT 0,
      estimated_minutes INTEGER,
      streak_count INTEGER NOT NULL DEFAULT 0,
      streak_date TEXT,
      parent_id TEXT,
      reminder_time TEXT,
      cycle_enabled INTEGER NOT NULL DEFAULT 0,
      cycle_index INTEGER NOT NULL DEFAULT 0,
      cycle_items TEXT NOT NULL DEFAULT '[]',
      timer_started_at TEXT,
      actual_minutes INTEGER,
      previous_occurrence_id TEXT,
      group_id TEXT
    );

    CREATE TABLE IF NOT EXISTS task_groups (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 0,
      category TEXT,
      sort_order REAL NOT NULL DEFAULT 0,
      collapsed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      target_start_date TEXT,
      target_end_date TEXT,
      sort_order REAL NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      schedule_days TEXT,
      schedule_start TEXT,
      schedule_end TEXT,
      sort_order REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      sort_order REAL NOT NULL DEFAULT 0
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
    'ALTER TABLE tasks ADD COLUMN time_of_day TEXT',
    'ALTER TABLE tasks ADD COLUMN category TEXT',
    'ALTER TABLE tasks ADD COLUMN vacation_pause INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER',
    'ALTER TABLE categories ADD COLUMN hide_on_vacation INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN recurrence_count INTEGER',
    'ALTER TABLE tasks ADD COLUMN timer_started_at TEXT',
    'ALTER TABLE tasks ADD COLUMN actual_minutes INTEGER',
    'ALTER TABLE tasks ADD COLUMN window_start TEXT',
    'ALTER TABLE tasks ADD COLUMN window_end TEXT',
    'ALTER TABLE tasks ADD COLUMN previous_occurrence_id TEXT',
    'ALTER TABLE tasks ADD COLUMN seen_at TEXT',
    'ALTER TABLE tasks ADD COLUMN deadline TEXT',
    'ALTER TABLE categories ADD COLUMN sort_order REAL NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN previous_streak_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN previous_streak_date TEXT',
    'ALTER TABLE tasks ADD COLUMN series_defaults TEXT',
    'ALTER TABLE tasks ADD COLUMN deadline_offset_days INTEGER',
    'ALTER TABLE tasks ADD COLUMN group_id TEXT',
    'ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN archived_at TEXT',
    'ALTER TABLE categories ADD COLUMN emoji TEXT',
    'ALTER TABLE tasks ADD COLUMN project_id TEXT',
    'ALTER TABLE projects ADD COLUMN category TEXT',
  ];
  for (const sql of migrations) {
    try { db.runSync(sql); } catch (_) { /* column already exists */ }
  }

  // Backfill seen_at for tasks that predate the "new" dot feature so they
  // don't all light up as new the moment this ships — treat them as already
  // seen as of their creation. New rows always insert with seen_at set, so
  // this only ever touches legacy rows and is a no-op after the first run.
  try { db.runSync('UPDATE tasks SET seen_at = created_at WHERE seen_at IS NULL'); } catch (_) {}

  // One-time migration: populate categories table from legacy category_registry setting
  const catCount = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM categories')?.n ?? 0;
  if (catCount === 0) {
    const registry = dbGetCategoryRegistry();
    for (const name of registry) {
      try {
        db.runSync('INSERT OR IGNORE INTO categories (id, name) VALUES (?, ?)', [generateId(), name]);
      } catch (_) {}
    }
  }

  // One-time migration: give existing categories a stable sort_order (their
  // prior alphabetical position) so introducing manual reordering doesn't
  // reshuffle everyone's existing category list.
  if (dbGetSetting('category_sort_order_migration_done') !== '1') {
    const rows = db.getAllSync<{ id: string }>('SELECT id FROM categories ORDER BY name ASC');
    rows.forEach((row, i) => {
      try { db.runSync('UPDATE categories SET sort_order = ? WHERE id = ?', [i + 1, row.id]); } catch (_) {}
    });
    dbSetSetting('category_sort_order_migration_done', '1');
  }

  // One-time migration: introducing the XXS bucket at effort=1 shifts every
  // existing preset (previously XS=1..XL=5) up by one, so XS=2..XL=6. Bump
  // stored values so old tasks/templates keep their original size.
  if (dbGetSetting('effort_xxs_migration_done') !== '1') {
    try { db.runSync('UPDATE tasks SET effort = effort + 1 WHERE effort >= 1'); } catch (_) {}
    const templateRows = db.getAllSync<{ id: string; items: string }>('SELECT id, items FROM templates');
    for (const row of templateRows) {
      try {
        const items = JSON.parse(row.items ?? '[]') as Array<Record<string, unknown>>;
        let changed = false;
        const shifted = items.map(item => {
          const e = item.effort as number | undefined;
          if (typeof e === 'number' && e >= 1) { changed = true; return { ...item, effort: e + 1 }; }
          return item;
        });
        if (changed) db.runSync('UPDATE templates SET items = ? WHERE id = ?', [JSON.stringify(shifted), row.id]);
      } catch (_) {}
    }
    dbSetSetting('effort_xxs_migration_done', '1');
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
    seenAt: (row.seen_at as string) ?? null,
    dueDate: (row.due_date as string) ?? null,
    deadline: (row.deadline as string) ?? null,
    deadlineOffsetDays: (row.deadline_offset_days as number | null) ?? null,
    deferUntil: (row.defer_until as string) ?? null,
    timeSegments: parseTimeSegments(row.time_of_day),
    windowStart: (row.window_start as string) ?? null,
    windowEnd: (row.window_end as string) ?? null,
    recurrenceType: (row.recurrence_type as Task['recurrenceType']) ?? 'none',
    recurrenceInterval: (row.recurrence_interval as number) ?? 1,
    recurrenceDays: JSON.parse((row.recurrence_days as string) ?? '[]') as number[],
    recurrenceEndDate: (row.recurrence_end_date as string) ?? null,
    recurrenceCount: (row.recurrence_count as number | null) ?? null,
    recurrenceFromCompletion: Boolean(row.recurrence_from_completion),
    tags: JSON.parse((row.tags as string) ?? '[]') as string[],
    category: (row.category as string) ?? null,
    sortOrder: row.sort_order as number,
    focused: Boolean(row.focused),
    priority: ((row.priority as number) ?? 0) as Task['priority'],
    effort: ((row.effort as number) ?? 0) as Task['effort'],
    estimatedMinutes: (row.estimated_minutes as number | null) ?? null,
    streakCount: (row.streak_count as number) ?? 0,
    streakDate: (row.streak_date as string) ?? null,
    parentId: (row.parent_id as string) ?? null,
    groupId: (row.group_id as string) ?? null,
    projectId: (row.project_id as string) ?? null,
    reminderTime: (row.reminder_time as string) ?? null,
    // Column names stay cycle_* — this is the pre-rename "Cycle" feature
    // (now "Chain") and renaming the columns would need a data migration
    // for existing installs. The JS-facing field names are the new ones.
    chainEnabled: Boolean(row.cycle_enabled),
    chainIndex: (row.cycle_index as number) ?? 0,
    chainItems: JSON.parse((row.cycle_items as string) ?? '[]'),
    vacationPause: Boolean(row.vacation_pause),
    timerStartedAt: (row.timer_started_at as string | null) ?? null,
    actualMinutes: (row.actual_minutes as number | null) ?? null,
    previousOccurrenceId: (row.previous_occurrence_id as string | null) ?? null,
    previousStreakCount: (row.previous_streak_count as number) ?? 0,
    previousStreakDate: (row.previous_streak_date as string) ?? null,
    seriesDefaults: row.series_defaults ? (JSON.parse(row.series_defaults as string) as Partial<Task>) : null,
    archived: Boolean(row.archived),
    archivedAt: (row.archived_at as string) ?? null,
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
      id, title, notes, completed, completed_at, created_at, seen_at,
      due_date, deadline, deadline_offset_days, defer_until, time_of_day, window_start, window_end,
      recurrence_type, recurrence_interval, recurrence_days, recurrence_end_date, recurrence_count, recurrence_from_completion,
      tags, category, sort_order, focused, priority, effort, estimated_minutes, streak_count, streak_date, parent_id, reminder_time,
      cycle_enabled, cycle_index, cycle_items, vacation_pause, timer_started_at, actual_minutes, previous_occurrence_id,
      previous_streak_count, previous_streak_date, series_defaults, group_id, archived, archived_at, project_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      task.id, task.title, task.notes, task.completed ? 1 : 0,
      task.completedAt, task.createdAt, task.seenAt, task.dueDate, task.deadline, task.deadlineOffsetDays ?? null, task.deferUntil,
      task.timeSegments.length ? JSON.stringify(task.timeSegments) : null, task.windowStart, task.windowEnd,
      task.recurrenceType, task.recurrenceInterval,
      JSON.stringify(task.recurrenceDays), task.recurrenceEndDate, task.recurrenceCount,
      task.recurrenceFromCompletion ? 1 : 0,
      JSON.stringify(task.tags), task.category ?? null, task.sortOrder,
      task.focused ? 1 : 0, task.priority, task.effort, task.estimatedMinutes ?? null,
      task.streakCount, task.streakDate, task.parentId ?? null, task.reminderTime,
      task.chainEnabled ? 1 : 0, task.chainIndex, JSON.stringify(task.chainItems),
      task.vacationPause ? 1 : 0, task.timerStartedAt ?? null, task.actualMinutes ?? null,
      task.previousOccurrenceId ?? null,
      task.previousStreakCount, task.previousStreakDate,
      task.seriesDefaults ? JSON.stringify(task.seriesDefaults) : null,
      task.groupId ?? null,
      task.archived ? 1 : 0, task.archivedAt ?? null,
      task.projectId ?? null,
    ]
  );
}

export function dbUpdateTask(task: Task): void {
  db.runSync(
    `UPDATE tasks SET
      title=?, notes=?, completed=?, completed_at=?, seen_at=?,
      due_date=?, deadline=?, deadline_offset_days=?, defer_until=?, time_of_day=?, window_start=?, window_end=?,
      recurrence_type=?, recurrence_interval=?, recurrence_days=?, recurrence_end_date=?, recurrence_count=?, recurrence_from_completion=?,
      tags=?, category=?, sort_order=?, focused=?, priority=?, effort=?, estimated_minutes=?,
      streak_count=?, streak_date=?, parent_id=?, reminder_time=?,
      cycle_enabled=?, cycle_index=?, cycle_items=?, vacation_pause=?, timer_started_at=?, actual_minutes=?,
      previous_occurrence_id=?, previous_streak_count=?, previous_streak_date=?, series_defaults=?, group_id=?,
      archived=?, archived_at=?, project_id=?
    WHERE id=?`,
    [
      task.title, task.notes, task.completed ? 1 : 0, task.completedAt, task.seenAt,
      task.dueDate, task.deadline, task.deadlineOffsetDays ?? null, task.deferUntil, task.timeSegments.length ? JSON.stringify(task.timeSegments) : null,
      task.windowStart, task.windowEnd,
      task.recurrenceType, task.recurrenceInterval,
      JSON.stringify(task.recurrenceDays), task.recurrenceEndDate, task.recurrenceCount,
      task.recurrenceFromCompletion ? 1 : 0,
      JSON.stringify(task.tags), task.category ?? null, task.sortOrder,
      task.focused ? 1 : 0, task.priority, task.effort, task.estimatedMinutes ?? null,
      task.streakCount, task.streakDate, task.parentId ?? null, task.reminderTime,
      task.chainEnabled ? 1 : 0, task.chainIndex, JSON.stringify(task.chainItems),
      task.vacationPause ? 1 : 0, task.timerStartedAt ?? null, task.actualMinutes ?? null,
      task.previousOccurrenceId ?? null,
      task.previousStreakCount, task.previousStreakDate,
      task.seriesDefaults ? JSON.stringify(task.seriesDefaults) : null,
      task.groupId ?? null,
      task.archived ? 1 : 0, task.archivedAt ?? null,
      task.projectId ?? null,
      task.id,
    ]
  );
}

export function dbMarkTaskSeen(id: string, seenAt: string): void {
  db.runSync('UPDATE tasks SET seen_at = ? WHERE id = ?', [seenAt, id]);
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

export function dbBulkSetWhen(ids: string[], dueDate: string | null, timeSegments: TimeOfDay[]): void {
  if (ids.length === 0) return;
  const timeOfDay = timeSegments.length ? JSON.stringify(timeSegments) : null;
  db.withTransactionSync(() => {
    for (const id of ids) {
      db.runSync('UPDATE tasks SET due_date = ?, time_of_day = ? WHERE id = ?', [dueDate, timeOfDay, id]);
    }
  });
}

export function dbBulkSetCategory(ids: string[], category: string | null): void {
  if (ids.length === 0) return;
  db.withTransactionSync(() => {
    for (const id of ids) {
      db.runSync('UPDATE tasks SET category = ? WHERE id = ?', [category, id]);
    }
  });
}

export function dbBulkSetFocus(ids: string[], focused: boolean): void {
  if (ids.length === 0) return;
  db.withTransactionSync(() => {
    for (const id of ids) {
      db.runSync('UPDATE tasks SET focused = ? WHERE id = ?', [focused ? 1 : 0, id]);
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

// ─── Categories ───────────────────────────────────────────────────────────────

function rowToCategory(row: Record<string, unknown>): Category {
  return {
    id: row.id as string,
    name: row.name as string,
    scheduleDays: row.schedule_days ? JSON.parse(row.schedule_days as string) as number[] : null,
    scheduleStart: (row.schedule_start as string) ?? null,
    scheduleEnd: (row.schedule_end as string) ?? null,
    hideOnVacation: Boolean(row.hide_on_vacation),
    sortOrder: row.sort_order as number,
    emoji: (row.emoji as string | null) ?? null,
  };
}

export function dbGetAllCategories(): Category[] {
  const rows = db.getAllSync<Record<string, unknown>>('SELECT * FROM categories ORDER BY sort_order ASC, name ASC');
  return rows.map(rowToCategory);
}

export function dbInsertCategory(name: string): Category {
  const id = generateId();
  const maxOrder = db.getFirstSync<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories')?.m ?? 0;
  const sortOrder = maxOrder + 1;
  db.runSync('INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)', [id, name, sortOrder]);
  return { id, name, scheduleDays: null, scheduleStart: null, scheduleEnd: null, hideOnVacation: false, sortOrder, emoji: null };
}

export function dbBatchUpdateCategorySortOrders(updates: { id: string; sortOrder: number }[]): void {
  db.withTransactionSync(() => {
    for (const { id, sortOrder } of updates) {
      db.runSync('UPDATE categories SET sort_order = ? WHERE id = ?', [sortOrder, id]);
    }
  });
}

export function dbSetCategoryHideOnVacation(id: string, hide: boolean): void {
  db.runSync('UPDATE categories SET hide_on_vacation = ? WHERE id = ?', [hide ? 1 : 0, id]);
}

export function dbSetCategoryEmoji(id: string, emoji: string | null): void {
  db.runSync('UPDATE categories SET emoji = ? WHERE id = ?', [emoji, id]);
}

export function dbUpdateCategory(id: string, updates: Partial<Pick<Category, 'scheduleDays' | 'scheduleStart' | 'scheduleEnd'>>): void {
  db.runSync(
    'UPDATE categories SET schedule_days = ?, schedule_start = ?, schedule_end = ? WHERE id = ?',
    [
      updates.scheduleDays ? JSON.stringify(updates.scheduleDays) : null,
      updates.scheduleStart ?? null,
      updates.scheduleEnd ?? null,
      id,
    ]
  );
}

export function dbDeleteCategory(name: string): void {
  db.runSync('DELETE FROM categories WHERE name = ?', [name]);
  db.runSync('UPDATE tasks SET category = NULL WHERE category = ?', [name]);
}

export function dbRenameCategory(id: string, oldName: string, newName: string): void {
  db.withTransactionSync(() => {
    db.runSync('UPDATE categories SET name = ? WHERE id = ?', [newName, id]);
    db.runSync('UPDATE tasks SET category = ? WHERE category = ?', [newName, oldName]);
    db.runSync('UPDATE task_groups SET category = ? WHERE category = ?', [newName, oldName]);
  });
}

// ─── Task Groups ────────────────────────────────────────────────────────────

function rowToTaskGroup(row: Record<string, unknown>): TaskGroup {
  return {
    id: row.id as string,
    title: row.title as string,
    notes: row.notes as string,
    tags: JSON.parse((row.tags as string) ?? '[]') as string[],
    priority: ((row.priority as number) ?? 0) as TaskGroup['priority'],
    category: (row.category as string) ?? null,
    sortOrder: row.sort_order as number,
    collapsed: Boolean(row.collapsed),
  };
}

export function dbGetAllTaskGroups(): TaskGroup[] {
  const rows = db.getAllSync<Record<string, unknown>>('SELECT * FROM task_groups ORDER BY sort_order ASC');
  return rows.map(rowToTaskGroup);
}

export function dbInsertTaskGroup(group: TaskGroup): void {
  db.runSync(
    'INSERT INTO task_groups (id, title, notes, tags, priority, category, sort_order, collapsed) VALUES (?,?,?,?,?,?,?,?)',
    [
      group.id, group.title, group.notes, JSON.stringify(group.tags), group.priority,
      group.category ?? null, group.sortOrder, group.collapsed ? 1 : 0,
    ]
  );
}

export function dbUpdateTaskGroup(group: TaskGroup): void {
  db.runSync(
    'UPDATE task_groups SET title=?, notes=?, tags=?, priority=?, category=?, sort_order=?, collapsed=? WHERE id=?',
    [
      group.title, group.notes, JSON.stringify(group.tags), group.priority,
      group.category ?? null, group.sortOrder, group.collapsed ? 1 : 0, group.id,
    ]
  );
}

export function dbDeleteTaskGroup(id: string): void {
  db.runSync('DELETE FROM task_groups WHERE id = ?', [id]);
}

export function dbBatchUpdateTaskGroupSortOrders(updates: { id: string; sortOrder: number }[]): void {
  db.withTransactionSync(() => {
    for (const { id, sortOrder } of updates) {
      db.runSync('UPDATE task_groups SET sort_order = ? WHERE id = ?', [sortOrder, id]);
    }
  });
}

// ─── Projects ───────────────────────────────────────────────────────────────

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    title: row.title as string,
    notes: row.notes as string,
    targetStartDate: (row.target_start_date as string) ?? null,
    targetEndDate: (row.target_end_date as string) ?? null,
    category: (row.category as string) ?? null,
    sortOrder: row.sort_order as number,
    archived: Boolean(row.archived),
    archivedAt: (row.archived_at as string) ?? null,
    createdAt: row.created_at as string,
  };
}

export function dbGetAllProjects(): Project[] {
  const rows = db.getAllSync<Record<string, unknown>>('SELECT * FROM projects ORDER BY sort_order ASC');
  return rows.map(rowToProject);
}

export function dbInsertProject(project: Project): void {
  db.runSync(
    'INSERT INTO projects (id, title, notes, target_start_date, target_end_date, category, sort_order, archived, archived_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [
      project.id, project.title, project.notes, project.targetStartDate, project.targetEndDate,
      project.category, project.sortOrder, project.archived ? 1 : 0, project.archivedAt, project.createdAt,
    ]
  );
}

export function dbUpdateProject(project: Project): void {
  db.runSync(
    'UPDATE projects SET title=?, notes=?, target_start_date=?, target_end_date=?, category=?, sort_order=?, archived=?, archived_at=? WHERE id=?',
    [
      project.title, project.notes, project.targetStartDate, project.targetEndDate,
      project.category, project.sortOrder, project.archived ? 1 : 0, project.archivedAt, project.id,
    ]
  );
}

export function dbDeleteProject(id: string): void {
  db.runSync('DELETE FROM projects WHERE id = ?', [id]);
}

export function dbBatchUpdateProjectSortOrders(updates: { id: string; sortOrder: number }[]): void {
  db.withTransactionSync(() => {
    for (const { id, sortOrder } of updates) {
      db.runSync('UPDATE projects SET sort_order = ? WHERE id = ?', [sortOrder, id]);
    }
  });
}

// ─── Templates ────────────────────────────────────────────────────────────────

function parseTemplateItems(raw: unknown): TemplateItem[] {
  try {
    const parsed = JSON.parse((raw as string) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTemplateItem);
  } catch {
    return [];
  }
}

function rowToTemplate(row: Record<string, unknown>): TaskTemplate {
  return {
    id: row.id as string,
    name: row.name as string,
    items: parseTemplateItems(row.items),
    createdAt: row.created_at as string,
    sortOrder: row.sort_order as number,
  };
}

export function dbGetAllTemplates(): TaskTemplate[] {
  const rows = db.getAllSync<Record<string, unknown>>(
    'SELECT * FROM templates ORDER BY sort_order ASC, created_at ASC'
  );
  return rows.map(rowToTemplate);
}

export function dbInsertTemplate(template: TaskTemplate): void {
  db.runSync(
    'INSERT INTO templates (id, name, items, created_at, sort_order) VALUES (?,?,?,?,?)',
    [template.id, template.name, JSON.stringify(template.items), template.createdAt, template.sortOrder]
  );
}

export function dbUpdateTemplate(template: TaskTemplate): void {
  db.runSync(
    'UPDATE templates SET name = ?, items = ?, sort_order = ? WHERE id = ?',
    [template.name, JSON.stringify(template.items), template.sortOrder, template.id]
  );
}

export function dbDeleteTemplate(id: string): void {
  db.runSync('DELETE FROM templates WHERE id = ?', [id]);
}
