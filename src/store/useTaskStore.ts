import { create } from 'zustand';
import { differenceInCalendarDays } from 'date-fns';
import type { Task, TaskDraft, Priority } from '../types';
import {
  initDatabase,
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
  dbGetTagRegistry,
  dbAddToTagRegistry,
  dbRemoveFromTagRegistry,
  dbRemoveTagFromAllTasks,
} from '../db/database';
import { useSettingsStore } from './useSettingsStore';
import { useCategoryStore } from './useCategoryStore';
import { useTemplateStore } from './useTemplateStore';
import { generateId } from '../utils/id';
import { getNextDueDate, getDayStart, getCurrentDayStart } from '../utils/dateUtils';
import { isTaskVisible, isTaskDeferred, isUpcomingToday, isHiddenForVacation } from '../utils/visibilityUtils';
import { scheduleTaskReminder, cancelTaskReminder, rescheduleAllReminders } from '../utils/notifications';

interface TaskStore {
  tasks: Task[];
  tagRegistry: string[];
  initialized: boolean;
  lastEditSnapshot: { id: string; snapshot: Task } | null;

  initialize: () => void;
  addTask: (draft: Partial<TaskDraft>) => Task;
  updateTask: (id: string, updates: Partial<Task>) => void;
  setLastEditSnapshot: (snap: { id: string; snapshot: Task } | null) => void;
  undoTaskEdit: () => void;
  deleteTask: (id: string) => void;
  completeTask: (id: string) => void;
  uncompleteTask: (id: string) => void;
  deferTask: (id: string, until: Date) => void;
  skipNextRecurrence: (id: string) => void;
  toggleFocus: (id: string) => void;
  clearAllFocus: () => void;
  reorderTasks: (orderedIds: string[]) => void;
  reorderWithCategoryUpdates: (orderedIds: string[], categoryUpdates: Array<{ id: string; category: string | null }>) => void;

  addSubtask: (parentId: string, title: string) => Task;
  toggleSubtask: (id: string) => void;
  deleteSubtask: (id: string) => void;
  reorderSubtasks: (parentId: string, orderedIds: string[]) => void;

  forgivVacationStreaks: () => void;
  bulkCompleteTasks: (ids: string[]) => void;
  bulkDeleteTasks: (ids: string[]) => void;
  bulkSetPriority: (ids: string[], priority: Priority) => void;
  bulkDefer: (ids: string[], until: Date) => void;
  bulkAddTags: (ids: string[], tags: string[]) => void;
  addTag: (tag: string) => void;
  deleteTag: (tag: string) => void;
  allCategories: () => string[];
  addCategory: (name: string) => void;
  deleteCategory: (name: string) => void;
  tasksByCategory: (category: string) => Task[];

  visibleTasks: () => Task[];
  upcomingTodayTasks: () => Task[];
  deferredTasks: () => Task[];
  vacationHiddenTasks: () => Task[];
  focusedTasks: () => Task[];
  completedTasks: () => Task[];
  subtasksOf: (parentId: string) => Task[];
  allTags: () => string[];
  tasksByTag: (tag: string) => Task[];
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  tagRegistry: [],
  initialized: false,
  lastEditSnapshot: null,

  initialize() {
    initDatabase();
    useCategoryStore.getState().initialize();
    useTemplateStore.getState().initialize();
    const tasks = dbGetAllTasks();
    const tagRegistry = dbGetTagRegistry();
    set({ tasks, tagRegistry, initialized: true });
    rescheduleAllReminders(tasks);
  },

  addTask(draft) {
    const now = new Date().toISOString();
    const maxOrder = get().tasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    const task: Task = {
      id: generateId(),
      title: draft.title ?? '',
      notes: draft.notes ?? '',
      completed: false,
      completedAt: null,
      createdAt: now,
      dueDate: draft.dueDate ?? null,
      deferUntil: draft.deferUntil ?? null,
      timeSegments: draft.timeSegments ?? [],
      recurrenceType: draft.recurrenceType ?? 'none',
      recurrenceInterval: draft.recurrenceInterval ?? 1,
      recurrenceDays: draft.recurrenceDays ?? [],
      recurrenceEndDate: draft.recurrenceEndDate ?? null,
      recurrenceFromCompletion: draft.recurrenceFromCompletion ?? false,
      tags: draft.tags ?? [],
      category: draft.category ?? null,
      sortOrder: maxOrder + 1,
      focused: draft.focused ?? false,
      priority: draft.priority ?? 0,
      effort: draft.effort ?? 0,
      streakCount: 0,
      streakDate: null,
      parentId: draft.parentId ?? null,
      reminderTime: draft.reminderTime ?? null,
      cycleEnabled: draft.cycleEnabled ?? false,
      cycleIndex: draft.cycleIndex ?? 0,
      cycleItems: draft.cycleItems ?? [],
      vacationPause: draft.vacationPause ?? false,
    };
    dbInsertTask(task);
    set(s => ({ tasks: [...s.tasks, task] }));
    scheduleTaskReminder(task);
    return task;
  },

  updateTask(id, updates) {
    const tasks = get().tasks.map(t => {
      if (t.id !== id) return t;
      const updated = { ...t, ...updates };
      dbUpdateTask(updated);
      cancelTaskReminder(id);
      scheduleTaskReminder(updated);
      return updated;
    });
    set({ tasks });
  },

  setLastEditSnapshot(snap) {
    set({ lastEditSnapshot: snap });
  },

  undoTaskEdit() {
    const snap = get().lastEditSnapshot;
    if (!snap) return;
    const tasks = get().tasks.map(t => {
      if (t.id !== snap.id) return t;
      dbUpdateTask(snap.snapshot);
      cancelTaskReminder(snap.id);
      scheduleTaskReminder(snap.snapshot);
      return snap.snapshot;
    });
    set({ tasks, lastEditSnapshot: null });
  },

  deleteTask(id) {
    dbDeleteSubtasks(id);
    dbDeleteTask(id);
    cancelTaskReminder(id);
    set(s => ({ tasks: s.tasks.filter(t => t.id !== id && t.parentId !== id) }));
  },

  completeTask(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.completed) return;

    const now = new Date();
    const { dayResetTime } = useSettingsStore.getState();

    // Calculate streak
    let newStreakCount = 1;
    if (task.recurrenceType !== 'none' && task.streakDate) {
      const lastDay = getDayStart(new Date(task.streakDate), dayResetTime);
      const todayDay = getCurrentDayStart();
      const daysBetween = differenceInCalendarDays(todayDay, lastDay);

      if (daysBetween === 0) {
        // Already completed this logical day — don't increment
        newStreakCount = task.streakCount;
      } else if (daysBetween === 1) {
        // Consecutive — increment
        newStreakCount = task.streakCount + 1;
      }
      // else: missed days → reset to 1 (already set above)
    }

    const completed: Task = {
      ...task,
      completed: true,
      completedAt: now.toISOString(),
      streakCount: task.recurrenceType !== 'none' ? newStreakCount : task.streakCount,
      streakDate: task.recurrenceType !== 'none' ? getCurrentDayStart().toISOString() : task.streakDate,
    };
    dbUpdateTask(completed);

    cancelTaskReminder(id);

    let nextTask: Task | null = null;
    if (task.recurrenceType !== 'none') {
      const nextDue = getNextDueDate(task, dayResetTime);
      if (nextDue !== null) {
        let nextReminderTime: string | null = null;
        if (task.reminderTime) {
          const original = new Date(task.reminderTime);
          const next = new Date(nextDue);
          next.setHours(original.getHours(), original.getMinutes(), 0, 0);
          nextReminderTime = next.toISOString();
        }
        const nextCycleIndex =
          task.cycleEnabled && task.cycleItems.length > 0
            ? (task.cycleIndex + 1) % task.cycleItems.length
            : task.cycleIndex;
        nextTask = {
          ...task,
          id: generateId(),
          completed: false,
          completedAt: null,
          createdAt: now.toISOString(),
          dueDate: nextDue.toISOString(),
          deferUntil: null,
          focused: false, // focus resets on new occurrence
          streakCount: newStreakCount,
          streakDate: getCurrentDayStart().toISOString(),
          reminderTime: nextReminderTime,
          cycleIndex: nextCycleIndex,
          // vacationPause carries over so recurring tasks stay paused across occurrences
        };
        dbInsertTask(nextTask);
        scheduleTaskReminder(nextTask);
      }
    }

    set(s => ({
      tasks: [
        ...s.tasks.map(t => (t.id === id ? completed : t)),
        ...(nextTask ? [nextTask] : []),
      ],
    }));
  },

  uncompleteTask(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    const updated = { ...task, completed: false, completedAt: null };
    dbUpdateTask(updated);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? updated : t)) }));
  },

  deferTask(id, until) {
    get().updateTask(id, { deferUntil: until.toISOString() });
  },

  skipNextRecurrence(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.recurrenceType === 'none') return;
    const { dayResetTime } = useSettingsStore.getState();
    const nextDue = getNextDueDate(task, dayResetTime);
    if (!nextDue) return;
    let nextReminderTime: string | null = task.reminderTime;
    if (task.reminderTime) {
      const original = new Date(task.reminderTime);
      const next = new Date(nextDue);
      next.setHours(original.getHours(), original.getMinutes(), 0, 0);
      nextReminderTime = next.toISOString();
    }
    const nextCycleIndex =
      task.cycleEnabled && task.cycleItems.length > 0
        ? (task.cycleIndex + 1) % task.cycleItems.length
        : task.cycleIndex;
    get().updateTask(id, {
      dueDate: nextDue.toISOString(),
      deferUntil: null,
      reminderTime: nextReminderTime,
      cycleIndex: nextCycleIndex,
    });
  },

  toggleFocus(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    get().updateTask(id, { focused: !task.focused });
  },

  clearAllFocus() {
    dbClearAllFocus();
    set(s => ({
      tasks: s.tasks.map(t => (t.focused ? { ...t, focused: false } : t)),
    }));
  },

  reorderTasks(orderedIds) {
    const updates = orderedIds.map((id, index) => ({ id, sortOrder: index + 1 }));
    dbBatchUpdateSortOrders(updates);
    set(s => ({
      tasks: s.tasks.map(t => {
        const u = updates.find(x => x.id === t.id);
        return u ? { ...t, sortOrder: u.sortOrder } : t;
      }),
    }));
  },

  reorderWithCategoryUpdates(orderedIds, categoryUpdates) {
    const orderUpdates = orderedIds.map((id, index) => ({ id, sortOrder: index + 1 }));
    dbBatchUpdateSortOrders(orderUpdates);
    categoryUpdates.forEach(u => {
      const task = get().tasks.find(t => t.id === u.id);
      if (task) dbUpdateTask({ ...task, category: u.category });
    });
    set(s => ({
      tasks: s.tasks.map(t => {
        const orderUpdate = orderUpdates.find(x => x.id === t.id);
        const categoryUpdate = categoryUpdates.find(x => x.id === t.id);
        if (!orderUpdate && !categoryUpdate) return t;
        return {
          ...t,
          ...(orderUpdate ? { sortOrder: orderUpdate.sortOrder } : {}),
          ...(categoryUpdate ? { category: categoryUpdate.category } : {}),
        };
      }),
    }));
  },

  addSubtask(parentId, title) {
    const now = new Date().toISOString();
    const siblings = get().tasks.filter(t => t.parentId === parentId);
    const maxOrder = siblings.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    const subtask: Task = {
      id: generateId(),
      title,
      notes: '',
      completed: false,
      completedAt: null,
      createdAt: now,
      dueDate: null,
      deferUntil: null,
      timeSegments: [],
      recurrenceType: 'none',
      recurrenceInterval: 1,
      recurrenceDays: [],
      recurrenceEndDate: null,
      recurrenceFromCompletion: false,
      tags: [],
      category: null,
      sortOrder: maxOrder + 1,
      focused: false,
      priority: 0,
      effort: 0,
      streakCount: 0,
      streakDate: null,
      parentId,
      reminderTime: null,
      cycleEnabled: false,
      cycleIndex: 0,
      cycleItems: [],
      vacationPause: false,
    };
    dbInsertTask(subtask);
    set(s => ({ tasks: [...s.tasks, subtask] }));
    return subtask;
  },

  toggleSubtask(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    const updated = {
      ...task,
      completed: !task.completed,
      completedAt: !task.completed ? new Date().toISOString() : null,
    };
    dbUpdateTask(updated);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? updated : t)) }));
  },

  deleteSubtask(id) {
    dbDeleteTask(id);
    set(s => ({ tasks: s.tasks.filter(t => t.id !== id) }));
  },

  reorderSubtasks(parentId, orderedIds) {
    const updates = orderedIds.map((id, index) => ({ id, sortOrder: index + 1 }));
    dbBatchUpdateSortOrders(updates);
    set(s => ({
      tasks: s.tasks.map(t => {
        const u = updates.find(x => x.id === t.id);
        return u ? { ...t, sortOrder: u.sortOrder } : t;
      }),
    }));
  },

  forgivVacationStreaks() {
    const today = getCurrentDayStart().toISOString();
    const toUpdate = get().tasks.filter(
      t => t.vacationPause && t.recurrenceType !== 'none' && !t.completed && t.streakCount > 0
    );
    if (toUpdate.length === 0) return;
    toUpdate.forEach(t => {
      const updated = { ...t, streakDate: today };
      dbUpdateTask(updated);
    });
    set(s => ({
      tasks: s.tasks.map(t =>
        t.vacationPause && t.recurrenceType !== 'none' && !t.completed && t.streakCount > 0
          ? { ...t, streakDate: today }
          : t
      ),
    }));
  },

  bulkCompleteTasks(ids) {
    if (ids.length === 0) return;
    ids.forEach(id => get().completeTask(id));
  },

  bulkDeleteTasks(ids) {
    if (ids.length === 0) return;
    dbBulkDeleteTasks(ids);
    ids.forEach(id => cancelTaskReminder(id));
    set(s => ({
      tasks: s.tasks.filter(t => !ids.includes(t.id) && (t.parentId === null || !ids.includes(t.parentId))),
    }));
  },

  bulkSetPriority(ids, priority) {
    if (ids.length === 0) return;
    dbBulkSetPriority(ids, priority);
    set(s => ({
      tasks: s.tasks.map(t => ids.includes(t.id) ? { ...t, priority } : t),
    }));
  },

  bulkDefer(ids, until) {
    if (ids.length === 0) return;
    const deferUntil = until.toISOString();
    dbBulkSetDefer(ids, deferUntil);
    set(s => ({
      tasks: s.tasks.map(t => ids.includes(t.id) ? { ...t, deferUntil } : t),
    }));
  },

  bulkAddTags(ids, tags) {
    if (ids.length === 0 || tags.length === 0) return;
    dbBulkAddTags(ids, tags);
    set(s => ({
      tasks: s.tasks.map(t => {
        if (!ids.includes(t.id)) return t;
        return { ...t, tags: Array.from(new Set([...t.tags, ...tags])) };
      }),
    }));
  },

  visibleTasks() {
    return get().tasks
      .filter(t => !t.parentId && isTaskVisible(t))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  upcomingTodayTasks() {
    return get().tasks
      .filter(t => !t.parentId && isUpcomingToday(t))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  deferredTasks() {
    return get().tasks
      .filter(t => !t.parentId && isTaskDeferred(t))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  vacationHiddenTasks() {
    return get().tasks
      .filter(t => !t.parentId && isHiddenForVacation(t))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  focusedTasks() {
    const { vacationMode } = useSettingsStore.getState();
    return get().tasks
      .filter(t => !t.parentId && t.focused && !t.completed && !(vacationMode && t.vacationPause))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  completedTasks() {
    return get().tasks.filter(t => !t.parentId && t.completed && t.completedAt);
  },

  subtasksOf(parentId) {
    return get().tasks
      .filter(t => t.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  allTags() {
    const tagSet = new Set<string>(get().tagRegistry);
    get().tasks.forEach(t => t.tags.forEach(tag => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  },

  addTag(tag) {
    const t = tag.trim().toLowerCase();
    if (!t) return;
    if (get().allTags().includes(t)) return;
    dbAddToTagRegistry(t);
    set(s => ({ tagRegistry: [...s.tagRegistry, t] }));
  },

  deleteTag(tag) {
    dbRemoveTagFromAllTasks(tag);
    dbRemoveFromTagRegistry(tag);
    set(s => ({
      tasks: s.tasks.map(t => ({ ...t, tags: t.tags.filter(tg => tg !== tag) })),
      tagRegistry: s.tagRegistry.filter(t => t !== tag),
    }));
  },

  allCategories() {
    const catSet = new Set<string>(
      useCategoryStore.getState().categories.map(c => c.name)
    );
    get().tasks.forEach(t => { if (t.category) catSet.add(t.category); });
    return Array.from(catSet).sort();
  },

  addCategory(name) {
    const n = name.trim();
    if (!n) return;
    useCategoryStore.getState().addCategory(n);
  },

  deleteCategory(name) {
    useCategoryStore.getState().deleteCategory(name);
    set(s => ({
      tasks: s.tasks.map(t => t.category === name ? { ...t, category: null } : t),
    }));
  },

  tasksByTag(tag) {
    return get().tasks.filter(t => !t.completed && t.tags.includes(tag));
  },

  tasksByCategory(category) {
    return get().tasks.filter(t => !t.completed && !t.parentId && t.category === category);
  },
}));
