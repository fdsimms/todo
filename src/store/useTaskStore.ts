import { create } from 'zustand';
import type { Task, TaskDraft } from '../types';
import {
  initDatabase,
  dbGetAllTasks,
  dbInsertTask,
  dbUpdateTask,
  dbDeleteTask,
} from '../db/database';
import { generateId } from '../utils/id';
import { getNextDueDate } from '../utils/dateUtils';
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

  // Derived selectors
  visibleTasks: () => Task[];
  deferredTasks: () => Task[];
  allTags: () => string[];
  tasksByTag: (tag: string) => Task[];
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  initialized: false,

  initialize() {
    initDatabase();
    const tasks = dbGetAllTasks();
    set({ tasks, initialized: true });
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

    const now = new Date().toISOString();
    const completed = { ...task, completed: true, completedAt: now };
    dbUpdateTask(completed);

    let nextTask: Task | null = null;
    if (task.recurrenceType !== 'none') {
      const nextDue = getNextDueDate(task);
      nextTask = {
        ...task,
        id: generateId(),
        completed: false,
        completedAt: null,
        createdAt: now,
        dueDate: nextDue.toISOString(),
        deferUntil: null, // reset one-time snooze on new occurrence
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

  visibleTasks() {
    return get().tasks.filter(isTaskVisible);
  },

  deferredTasks() {
    return get().tasks.filter(isTaskDeferred);
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
