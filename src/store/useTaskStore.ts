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
  dbGetSetting,
  dbMarkTaskSeen,
} from '../db/database';
import { useSettingsStore } from './useSettingsStore';
import { useCategoryStore } from './useCategoryStore';
import { useTemplateStore } from './useTemplateStore';
import { generateId } from '../utils/id';
import { applyMeasuredTime } from '../utils/effort';
import { getNextDueDate, getDayStart, getCurrentDayStart } from '../utils/dateUtils';
import { isTaskVisible, isTaskDeferred, isUpcomingToday, isHiddenForVacation, isTaskExpired, isRecurrenceNotYetDue } from '../utils/visibilityUtils';
import { scheduleTaskReminder, cancelTaskReminder, rescheduleAllReminders } from '../utils/notifications';

interface UndoableAction {
  label: string;
  undo: () => void;
}

// A completed task keeps appearing wherever it would if it were still
// incomplete, for COMPLETION_HOLD_MS after it's completed. Checking off
// several tasks in a row would otherwise reflow the list after every single
// tap; holding them lets the whole burst finish before the list collapses
// around whatever's left, once completions pause for COMPLETION_HOLD_MS.
const COMPLETION_HOLD_MS = 2000;
let completionHoldTimer: ReturnType<typeof setTimeout> | null = null;

// Caches the masked (completed: false) copy of each held task, keyed by the
// underlying task's own reference. Selectors like visibleTasks() call this on
// every render (Zustand re-invokes selectors to build each render's snapshot,
// not just on store changes), so returning a fresh `{ ...t, completed: false }`
// object every call — as this used to — made every held task's row a "new"
// array element to useShallow on every single render. That kept every screen
// depending on it re-rendering forever for the whole hold window (an infinite
// loop that starved the JS thread and crashed the app). Reusing the same
// masked object across calls, as long as the source task hasn't actually
// changed, lets useShallow see it as unchanged and break the loop.
const heldMaskCache = new Map<string, { source: Task; masked: Task }>();

function withHeldCompletions(tasks: Task[], heldIds: string[]): Task[] {
  if (heldIds.length === 0) return tasks;
  const held = new Set(heldIds);
  for (const id of heldMaskCache.keys()) {
    if (!held.has(id)) heldMaskCache.delete(id);
  }
  return tasks.map(t => {
    if (!held.has(t.id)) return t;
    const cached = heldMaskCache.get(t.id);
    if (cached && cached.source === t) return cached.masked;
    const masked = { ...t, completed: false };
    heldMaskCache.set(t.id, { source: t, masked });
    return masked;
  });
}

interface TaskStore {
  tasks: Task[];
  tagRegistry: string[];
  initialized: boolean;
  lastAction: UndoableAction | null;
  // Ids of tasks completed within the last COMPLETION_HOLD_MS — see
  // withHeldCompletions above.
  completionHoldIds: string[];

  initialize: () => void;
  addTask: (draft: Partial<TaskDraft>) => Task;
  duplicateTask: (id: string) => Task | null;
  updateTask: (id: string, updates: Partial<Task>) => void;
  markTaskSeen: (id: string) => void;
  setLastAction: (action: UndoableAction | null) => void;
  undoLastAction: () => void;
  deleteTask: (id: string) => void;
  completeTask: (id: string) => void;
  uncompleteTask: (id: string) => void;
  deferTask: (id: string, until: Date) => void;
  skipNextRecurrence: (id: string) => void;
  toggleFocus: (id: string) => void;
  clearAllFocus: () => void;
  startTimer: (id: string) => void;
  stopTimer: (id: string) => void;
  discardTimer: (id: string) => void;
  logManualTime: (id: string, minutes: number) => void;
  reorderTasks: (orderedIds: string[]) => void;
  reorderWithCategoryUpdates: (orderedIds: string[], categoryUpdates: Array<{ id: string; category: string | null }>) => void;

  addSubtask: (parentId: string, title: string) => Task;
  toggleSubtask: (id: string) => void;
  deleteSubtask: (id: string) => void;
  reorderSubtasks: (parentId: string, orderedIds: string[]) => void;

  forgivVacationStreaks: () => void;
  resetAllStreaks: () => void;
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
  expiredTasks: () => Task[];
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
  lastAction: null,
  completionHoldIds: [],

  initialize() {
    initDatabase();
    useCategoryStore.getState().initialize();
    useTemplateStore.getState().initialize();
    let tasks = dbGetAllTasks();
    const tagRegistry = dbGetTagRegistry();

    // Read the setting straight from the DB rather than useSettingsStore —
    // this runs before useSettingsStore.initialize() (see App.tsx), so the
    // store would still be holding its default value at this point.
    if (dbGetSetting('autoRemoveExpiredTasks') === 'true') {
      const expiredIds = tasks.filter(t => !t.parentId && isTaskExpired(t)).map(t => t.id);
      if (expiredIds.length > 0) {
        dbBulkDeleteTasks(expiredIds);
        tasks = tasks.filter(t => !expiredIds.includes(t.id) && (t.parentId === null || !expiredIds.includes(t.parentId)));
      }
    }

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
      seenAt: now,
      dueDate: draft.dueDate ?? null,
      deadline: draft.deadline ?? null,
      deferUntil: draft.deferUntil ?? null,
      timeSegments: draft.timeSegments ?? [],
      windowStart: draft.windowStart ?? null,
      windowEnd: draft.windowEnd ?? null,
      recurrenceType: draft.recurrenceType ?? 'none',
      recurrenceInterval: draft.recurrenceInterval ?? 1,
      recurrenceDays: draft.recurrenceDays ?? [],
      recurrenceEndDate: draft.recurrenceEndDate ?? null,
      recurrenceCount: draft.recurrenceCount ?? null,
      recurrenceFromCompletion: draft.recurrenceFromCompletion ?? false,
      tags: draft.tags ?? [],
      category: draft.category ?? null,
      sortOrder: maxOrder + 1,
      focused: draft.focused ?? false,
      priority: draft.priority ?? 0,
      effort: draft.effort ?? 0,
      estimatedMinutes: draft.estimatedMinutes ?? null,
      streakCount: 0,
      streakDate: null,
      previousStreakCount: 0,
      previousStreakDate: null,
      parentId: draft.parentId ?? null,
      reminderTime: draft.reminderTime ?? null,
      chainEnabled: draft.chainEnabled ?? false,
      chainIndex: draft.chainIndex ?? 0,
      chainItems: draft.chainItems ?? [],
      vacationPause: draft.vacationPause ?? false,
      timerStartedAt: draft.timerStartedAt ?? null,
      actualMinutes: draft.actualMinutes ?? null,
      previousOccurrenceId: draft.previousOccurrenceId ?? null,
    };
    dbInsertTask(task);
    set(s => ({ tasks: [...s.tasks, task] }));
    scheduleTaskReminder(task);
    return task;
  },

  duplicateTask(id) {
    const original = get().tasks.find(t => t.id === id);
    if (!original) return null;

    const now = new Date().toISOString();
    const maxOrder = get().tasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    const resetForCopy = {
      completed: false,
      completedAt: null,
      createdAt: now,
      seenAt: now,
      focused: false,
      streakCount: 0,
      streakDate: null,
      previousStreakCount: 0,
      previousStreakDate: null,
      timerStartedAt: null,
      actualMinutes: null,
      previousOccurrenceId: null,
    };
    const copy: Task = {
      ...original,
      ...resetForCopy,
      id: generateId(),
      sortOrder: maxOrder + 1,
    };
    dbInsertTask(copy);
    scheduleTaskReminder(copy);

    const subtaskCopies = get().subtasksOf(id).map(sub => ({
      ...sub,
      ...resetForCopy,
      id: generateId(),
      parentId: copy.id,
    }));
    subtaskCopies.forEach(sub => {
      dbInsertTask(sub);
      scheduleTaskReminder(sub);
    });

    set(s => ({ tasks: [...s.tasks, copy, ...subtaskCopies] }));
    return copy;
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

  markTaskSeen(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    const now = new Date().toISOString();
    dbMarkTaskSeen(id, now);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? { ...t, seenAt: now } : t)) }));
  },

  setLastAction(action) {
    set({ lastAction: action });
  },

  undoLastAction() {
    const action = get().lastAction;
    if (!action) return;
    try {
      action.undo();
    } catch (e) {
      console.error('undoLastAction failed', e);
    }
    set({ lastAction: null });
  },

  deleteTask(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    const subtasks = get().subtasksOf(id);

    dbDeleteSubtasks(id);
    dbDeleteTask(id);
    cancelTaskReminder(id);
    set(s => ({ tasks: s.tasks.filter(t => t.id !== id && t.parentId !== id) }));

    get().setLastAction({
      label: 'Task deleted',
      undo: () => {
        dbInsertTask(task);
        scheduleTaskReminder(task);
        subtasks.forEach(sub => {
          dbInsertTask(sub);
          scheduleTaskReminder(sub);
        });
        set(s => ({ tasks: [...s.tasks, task, ...subtasks] }));
      },
    });
  },

  completeTask(id) {
    let task = get().tasks.find(t => t.id === id);
    if (!task || task.completed) return;
    // Recurring tasks shown early in Later (deferred to, or due on, a future
    // day) can't be completed ahead of schedule — doing so would generate the
    // next occurrence off today instead of the task's real day. Non-recurring
    // tasks have no such next-occurrence math, so early completion is fine.
    if (isRecurrenceNotYetDue(task)) return;

    // If a timer is still running, stop it first so the session's time is saved.
    if (task.timerStartedAt !== null) {
      get().stopTimer(id);
      task = get().tasks.find(t => t.id === id)!;
    }

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
      previousStreakCount: task.streakCount,
      previousStreakDate: task.streakDate,
    };
    dbUpdateTask(completed);

    cancelTaskReminder(id);

    let nextTask: Task | null = null;
    const recurs = task.recurrenceType !== 'none';
    const chainAdvances = task.chainEnabled && task.chainItems.length > 0;
    const atChainEnd = chainAdvances && task.chainIndex >= task.chainItems.length - 1;
    // A chain is a singly linked list of steps: completing one immediately
    // creates the next, with no schedule needed, and it simply ends after
    // the last step. Repeat changes only what happens at that last step —
    // instead of ending, the whole chain loops back to the first item on
    // the recurrence's schedule. A chain with no Repeat set never spawns
    // past its last item; a plain recurring task with no chain just keeps
    // recurring on schedule as always.
    const spawnsNext = recurs ? true : (chainAdvances && !atChainEnd);
    if (spawnsNext) {
      const nextDue = recurs ? getNextDueDate(task, dayResetTime) : null;
      if (!recurs || nextDue !== null) {
        let nextReminderTime: string | null = task.reminderTime;
        if (nextDue && task.reminderTime) {
          const original = new Date(task.reminderTime);
          const next = new Date(nextDue);
          next.setHours(original.getHours(), original.getMinutes(), 0, 0);
          nextReminderTime = next.toISOString();
        }
        const nextChainIndex = chainAdvances
          ? (atChainEnd ? 0 : task.chainIndex + 1)
          : task.chainIndex;
        nextTask = {
          ...task,
          id: generateId(),
          completed: false,
          completedAt: null,
          createdAt: now.toISOString(),
          seenAt: now.toISOString(),
          dueDate: nextDue ? nextDue.toISOString() : null,
          deadline: null, // deadline is a one-off target date, doesn't carry to the next occurrence
          deferUntil: null,
          focused: false, // focus resets on new occurrence
          streakCount: recurs ? newStreakCount : task.streakCount,
          streakDate: recurs ? getCurrentDayStart().toISOString() : task.streakDate,
          reminderTime: nextReminderTime,
          chainIndex: nextChainIndex,
          recurrenceCount: task.recurrenceCount !== null ? task.recurrenceCount - 1 : null,
          timerStartedAt: null, // fresh occurrence isn't running; actualMinutes/estimate carry via ...task
          // vacationPause carries over so recurring tasks stay paused across occurrences
          previousOccurrenceId: task.id, // lets uncompleting `task` remove this occurrence again
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
      completionHoldIds: [...s.completionHoldIds, id],
    }));

    if (completionHoldTimer) clearTimeout(completionHoldTimer);
    completionHoldTimer = setTimeout(() => {
      completionHoldTimer = null;
      // No animateLayout() here: this commit unmounts the completed row's
      // Swipeable (react-native-gesture-handler). Firing a LayoutAnimation in
      // the same tick a Swipeable unmounts crashes on iOS — RNGH's native
      // animated-event cleanup (removeAnimatedEventFromView) races the layout
      // transition and can segfault mid-GC. The row already faded to
      // opacity 0 during the completion animation, so the list just loses its
      // slot cleanly without needing an extra transition here.
      set({ completionHoldIds: [] });
    }, COMPLETION_HOLD_MS);
    // Node (tests) returns a Timeout with unref(); React Native's timer is a
    // plain number without it — don't keep a test process alive over this.
    (completionHoldTimer as unknown as { unref?: () => void }).unref?.();

    get().setLastAction({
      label: 'Task completed',
      undo: () => get().uncompleteTask(id),
    });
  },

  uncompleteTask(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    const updated = {
      ...task,
      completed: false,
      completedAt: null,
      // Restore the streak to what it was before this completion, so
      // undoing a completion (e.g. from the Logbook) doesn't leave the
      // streak incremented for something that no longer happened.
      streakCount: task.previousStreakCount,
      streakDate: task.previousStreakDate,
    };
    dbUpdateTask(updated);

    // Completing a recurring task spawns a fresh next occurrence. Undoing
    // that completion means it never happened, so the occurrence it
    // generated shouldn't exist either — unless the user has since
    // completed it themselves, in which case it's a real completion.
    const followUp = get().tasks.find(t => t.previousOccurrenceId === id && !t.completed);
    if (followUp) {
      dbDeleteSubtasks(followUp.id);
      dbDeleteTask(followUp.id);
      cancelTaskReminder(followUp.id);
    }

    set(s => ({
      tasks: s.tasks
        .filter(t => !followUp || (t.id !== followUp.id && t.parentId !== followUp.id))
        .map(t => (t.id === id ? updated : t)),
      completionHoldIds: s.completionHoldIds.filter(x => x !== id),
    }));
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
    const nextChainIndex =
      task.chainEnabled && task.chainItems.length > 0
        ? (task.chainIndex + 1) % task.chainItems.length
        : task.chainIndex;
    get().updateTask(id, {
      dueDate: nextDue.toISOString(),
      deferUntil: null,
      reminderTime: nextReminderTime,
      chainIndex: nextChainIndex,
      recurrenceCount: task.recurrenceCount !== null ? task.recurrenceCount - 1 : null,
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

  startTimer(id) {
    // Only one task times at a time — stop any other running timer first.
    const running = get().tasks.find(t => t.timerStartedAt !== null && t.id !== id);
    if (running) get().stopTimer(running.id);
    get().updateTask(id, { timerStartedAt: new Date().toISOString() });
  },

  stopTimer(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.timerStartedAt === null) return;
    const elapsedMs = Date.now() - new Date(task.timerStartedAt).getTime();
    const minutes = elapsedMs / 60000;
    get().updateTask(id, { timerStartedAt: null, ...applyMeasuredTime(minutes) });
  },

  discardTimer(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.timerStartedAt === null) return;
    get().updateTask(id, { timerStartedAt: null });
  },

  logManualTime(id, minutes) {
    if (!(minutes > 0)) return;
    get().updateTask(id, { timerStartedAt: null, ...applyMeasuredTime(minutes) });
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
      seenAt: now,
      dueDate: null,
      deadline: null,
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
      sortOrder: maxOrder + 1,
      focused: false,
      priority: 0,
      effort: 0,
      estimatedMinutes: null,
      streakCount: 0,
      streakDate: null,
      previousStreakCount: 0,
      previousStreakDate: null,
      parentId,
      reminderTime: null,
      chainEnabled: false,
      chainIndex: 0,
      chainItems: [],
      vacationPause: false,
      timerStartedAt: null,
      actualMinutes: null,
      previousOccurrenceId: null,
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
    const subtask = get().tasks.find(t => t.id === id);
    if (!subtask) return;

    dbDeleteTask(id);
    set(s => ({ tasks: s.tasks.filter(t => t.id !== id) }));

    get().setLastAction({
      label: 'Subtask deleted',
      undo: () => {
        dbInsertTask(subtask);
        set(s => ({ tasks: [...s.tasks, subtask] }));
      },
    });
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

  resetAllStreaks() {
    const toReset = get().tasks.filter(t => t.streakCount > 0 || t.streakDate !== null);
    if (toReset.length === 0) return;

    const snapshot = toReset.map(t => ({ id: t.id, streakCount: t.streakCount, streakDate: t.streakDate }));

    toReset.forEach(t => {
      dbUpdateTask({ ...t, streakCount: 0, streakDate: null });
    });
    set(s => ({
      tasks: s.tasks.map(t =>
        toReset.some(r => r.id === t.id) ? { ...t, streakCount: 0, streakDate: null } : t
      ),
    }));

    get().setLastAction({
      label: 'Streaks reset',
      undo: () => {
        snapshot.forEach(({ id, streakCount, streakDate }) => {
          const task = get().tasks.find(t => t.id === id);
          if (!task) return;
          dbUpdateTask({ ...task, streakCount, streakDate });
        });
        set(s => ({
          tasks: s.tasks.map(t => {
            const r = snapshot.find(x => x.id === t.id);
            return r ? { ...t, streakCount: r.streakCount, streakDate: r.streakDate } : t;
          }),
        }));
      },
    });
  },

  bulkCompleteTasks(ids) {
    if (ids.length === 0) return;
    ids.forEach(id => get().completeTask(id));
    get().setLastAction({
      label: `${ids.length} task${ids.length === 1 ? '' : 's'} completed`,
      undo: () => ids.forEach(id => get().uncompleteTask(id)),
    });
  },

  bulkDeleteTasks(ids) {
    if (ids.length === 0) return;
    const deleted = get().tasks.filter(t => ids.includes(t.id) || (t.parentId !== null && ids.includes(t.parentId)));

    dbBulkDeleteTasks(ids);
    ids.forEach(id => cancelTaskReminder(id));
    set(s => ({
      tasks: s.tasks.filter(t => !ids.includes(t.id) && (t.parentId === null || !ids.includes(t.parentId))),
    }));

    get().setLastAction({
      label: `${ids.length} task${ids.length === 1 ? '' : 's'} deleted`,
      undo: () => {
        deleted.forEach(t => {
          dbInsertTask(t);
          scheduleTaskReminder(t);
        });
        set(s => ({ tasks: [...s.tasks, ...deleted] }));
      },
    });
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
    const { tasks, completionHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds)
      .filter(t => !t.parentId && isTaskVisible(t))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  upcomingTodayTasks() {
    const { tasks, completionHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds)
      .filter(t => !t.parentId && isUpcomingToday(t))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  deferredTasks() {
    const { tasks, completionHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds)
      .filter(t => !t.parentId && isTaskDeferred(t))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  expiredTasks() {
    const { tasks, completionHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds)
      .filter(t => !t.parentId && isTaskExpired(t))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  vacationHiddenTasks() {
    const { tasks, completionHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds)
      .filter(t => !t.parentId && isHiddenForVacation(t))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  focusedTasks() {
    const { vacationMode } = useSettingsStore.getState();
    const { tasks, completionHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds)
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
    // Registered categories keep their manually-chosen order; any category
    // only found on a task (predating the registry) is appended alphabetically.
    // Sorted by sortOrder here (rather than trusting array position) because
    // reorderCategories() only patches each category's sortOrder field in
    // place, it doesn't physically reposition the store's array.
    const registered = [...useCategoryStore.getState().categories]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(c => c.name);
    const known = new Set(registered);
    const phantom = new Set<string>();
    get().tasks.forEach(t => { if (t.category && !known.has(t.category)) phantom.add(t.category); });
    return [...registered, ...Array.from(phantom).sort()];
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
    const { tasks, completionHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds).filter(t => !t.completed && t.tags.includes(tag));
  },

  tasksByCategory(category) {
    const { tasks, completionHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds).filter(t => !t.completed && !t.parentId && t.category === category);
  },
}));
