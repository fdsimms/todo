import { create } from 'zustand';
import { differenceInCalendarDays } from 'date-fns';
import type { Task, TaskDraft } from '../types';
import {
  initDatabase,
  dbGetAllTasks,
  dbInsertTask,
  dbUpdateTask,
  dbDeleteTask,
  dbClearAllFocus,
} from '../db/database';
import { useSettingsStore } from './useSettingsStore';
import { generateId } from '../utils/id';
import { getNextDueDate, getDayStart, getCurrentDayStart } from '../utils/dateUtils';
import { isTaskVisible, isTaskDeferred } from '../utils/visibilityUtils';

interface TaskStore {
  tasks: Task[];
  initialized: boolean;

  initialize: () => void;
  addTask: (draft: Partial<TaskDraft>) => Task;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  completeTask: (id: string) => void;
  deferTask: (id: string, until: Date) => void;
  toggleFocus: (id: string) => void;
  clearAllFocus: () => void;

  visibleTasks: () => Task[];
  deferredTasks: () => Task[];
  focusedTasks: () => Task[];
  allTags: () => string[];
  tasksByTag: (tag: string) => Task[];
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  initialized: false,

  initialize() {
    initDatabase();
    set({ tasks: dbGetAllTasks(), initialized: true });
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
      showAfterTime: draft.showAfterTime ?? null,
      recurrenceType: draft.recurrenceType ?? 'none',
      recurrenceInterval: draft.recurrenceInterval ?? 1,
      recurrenceDays: draft.recurrenceDays ?? [],
      recurrenceEndDate: draft.recurrenceEndDate ?? null,
      tags: draft.tags ?? [],
      sortOrder: maxOrder + 1,
      focused: draft.focused ?? false,
      priority: draft.priority ?? 0,
      effort: draft.effort ?? 0,
      streakCount: 0,
      streakDate: null,
    };
    dbInsertTask(task);
    set(s => ({ tasks: [...s.tasks, task] }));
    return task;
  },

  updateTask(id, updates) {
    const tasks = get().tasks.map(t => {
      if (t.id !== id) return t;
      const updated = { ...t, ...updates };
      dbUpdateTask(updated);
      return updated;
    });
    set({ tasks });
  },

  deleteTask(id) {
    dbDeleteTask(id);
    set(s => ({ tasks: s.tasks.filter(t => t.id !== id) }));
  },

  completeTask(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;

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

    let nextTask: Task | null = null;
    if (task.recurrenceType !== 'none') {
      const nextDue = getNextDueDate(task, dayResetTime);
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
      };
      dbInsertTask(nextTask);
    }

    set(s => ({
      tasks: [
        ...s.tasks.map(t => (t.id === id ? completed : t)),
        ...(nextTask ? [nextTask] : []),
      ],
    }));
  },

  deferTask(id, until) {
    get().updateTask(id, { deferUntil: until.toISOString() });
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

  visibleTasks() {
    return get().tasks.filter(isTaskVisible);
  },

  deferredTasks() {
    return get().tasks.filter(isTaskDeferred);
  },

  focusedTasks() {
    return get().tasks.filter(t => t.focused && !t.completed);
  },

  allTags() {
    const tagSet = new Set<string>();
    get().tasks.forEach(t => t.tags.forEach(tag => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  },

  tasksByTag(tag) {
    return get().tasks.filter(t => !t.completed && t.tags.includes(tag));
  },
}));
