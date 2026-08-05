import { create } from 'zustand';
import { differenceInCalendarDays } from 'date-fns';
import type { Task, TaskDraft, Priority, TimeOfDay } from '../types';
import {
  initDatabase,
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
  dbBulkSetWhen,
  dbBulkSetCategory,
  dbBulkSetPinned,
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
import { useTaskGroupStore } from './useTaskGroupStore';
import { useProjectStore, projectProgress } from './useProjectStore';
import { useProjectCategoryStore } from './useProjectCategoryStore';
import { useTemplateCategoryStore } from './useTemplateCategoryStore';
import type { TaskGroup } from '../types';
import { generateId } from '../utils/id';
import { applyMeasuredTime } from '../utils/effort';
import { getNextDueDate, getDayStart, getCurrentDayStart, getDeadlineFromOffset, getDeadlineFromMonthDay } from '../utils/dateUtils';
import { isTaskVisible, isTaskDeferred, isUpcomingToday, isHiddenForVacation, isTaskExpired, isRecurrenceNotYetDue, isInboxTask, isUnscheduledTask, isRelevantToGroupToday } from '../utils/visibilityUtils';
import { scheduleTaskReminder, cancelTaskReminder, rescheduleAllReminders } from '../utils/notifications';

interface UndoableAction {
  label: string;
  undo: () => void;
}

// Fields that silently carry forward to the next occurrence today (spread
// via `...task` in completeTask). These are the only fields "this task only"
// edits (updateTask's { scope: 'occurrence' }) need to protect via
// seriesDefaults — recurrence-rule, chain, and schedule fields are excluded
// because each already has exactly one sensible interpretation (see
// isLiveRecurring / CLAUDE.md recurrence docs for why).
export const CONTENT_FIELDS: (keyof Task)[] = [
  'title', 'notes', 'tags', 'category', 'priority', 'effort',
  'estimatedMinutes', 'windowStart', 'windowEnd', 'timeSegments', 'reminderTime', 'linkUrl',
];

function captureField<K extends keyof Task>(target: Partial<Task>, source: Task, key: K): void {
  target[key] = source[key];
}

// A dismissed stack (TaskGroup.completedAt set — see TaskGroupHeader) is only
// ever hidden while every child is actually done. Anything that hands the
// group a new incomplete child — a recurring/chained spawn, an undo, or
// adding an existing task to it — must un-dismiss it here, otherwise it
// would keep hiding live work on Today.
function clearGroupDismissal(groupId: string | null): void {
  if (!groupId) return;
  const group = useTaskGroupStore.getState().getGroupById(groupId);
  if (group?.completedAt) useTaskGroupStore.getState().setGroupCompletedAt(groupId, null);
}

// A completed task keeps appearing wherever it would if it were still
// incomplete, for COMPLETION_HOLD_MS after it's completed — and every new
// completion pushes the hold back out (see the clearTimeout/setTimeout pair
// below), so a burst of completions keeps every one of them in place until a
// full second has passed since the *last* tap. That gives the user a beat to
// keep tapping through a list without the rows they already completed
// vanishing out from under them mid-burst.
const COMPLETION_HOLD_MS = 1000;
let completionHoldTimer: ReturnType<typeof setTimeout> | null = null;
// Ids of tasks completed while pinned, whose pin should be cleared once the
// completion hold above expires — keeps a pinned row from vanishing out of
// the Pinned section instantly on tap, same grace period as everywhere else.
let pendingUnpinIds: string[] = [];

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
  // scope 'occurrence' ("this task only") applies `updates` to this row but
  // preserves whatever content-field values existed before the edit in
  // seriesDefaults, so the next occurrence (see completeTask) reverts to
  // them instead of carrying the one-off edit forward. Default ('series' /
  // omitted, "this and future tasks") is a plain patch, same as always.
  updateTask: (id: string, updates: Partial<Task>, options?: { scope?: 'occurrence' | 'series' }) => void;
  markTaskSeen: (id: string) => void;
  markTasksSeen: (ids: string[]) => void;
  setLastAction: (action: UndoableAction | null) => void;
  undoLastAction: () => void;
  deleteTask: (id: string) => void;
  completeTask: (id: string) => void;
  uncompleteTask: (id: string) => void;
  deferTask: (id: string, until: Date) => void;
  skipNextRecurrence: (id: string) => void;
  togglePin: (id: string) => void;
  // Hides a recurring task indefinitely (unlike vacationPause, not tied to
  // vacation mode) without touching its completion history. Streak fields
  // are left as-is on archive; unarchiveTask is what breaks the streak.
  archiveTask: (id: string) => void;
  // Resuming an archived task deliberately breaks its streak (resets
  // streakCount/streakDate to 0/null) since the gap is real, but leaves past
  // completions untouched so Stats/Logbook history "picks up where it left off."
  unarchiveTask: (id: string) => void;
  clearAllPins: () => void;
  pinCategory: (category: string) => void;
  startTimer: (id: string) => void;
  stopTimer: (id: string) => void;
  discardTimer: (id: string) => void;
  logManualTime: (id: string, minutes: number) => void;
  reorderTasks: (orderedIds: string[]) => void;
  reorderWithCategoryUpdates: (
    orderedIds: string[],
    categoryUpdates: Array<{ id: string; category: string | null }>,
    options?: { scope?: 'occurrence' | 'series' },
  ) => void;

  addSubtask: (parentId: string, title: string) => Task;
  toggleSubtask: (id: string) => void;
  deleteSubtask: (id: string) => void;
  reorderSubtasks: (parentId: string, orderedIds: string[]) => void;

  groupChildrenOf: (groupId: string) => Task[];
  addNewGroupedTask: (groupId: string, title: string) => Task;
  addExistingToGroup: (taskId: string, groupId: string) => void;
  removeFromGroup: (taskId: string) => void;
  reorderGroupChildren: (groupId: string, orderedIds: string[]) => void;
  groupTasks: (taskIds: string[], title: string, category: string | null) => TaskGroup;
  completeGroup: (groupId: string) => void;
  uncompleteGroup: (groupId: string) => void;
  dismissGroup: (groupId: string) => void;
  deferGroup: (groupId: string, until: Date) => void;
  pinGroup: (groupId: string) => void;
  deleteGroup: (groupId: string, opts: { cascade: boolean }) => void;

  addExistingToProject: (taskId: string, projectId: string) => void;
  removeFromProject: (taskId: string) => void;
  deleteProject: (projectId: string, opts: { cascade: boolean }) => void;

  forgivVacationStreaks: () => void;
  checkVacationExpiry: () => void;
  resetAllStreaks: () => void;
  bulkCompleteTasks: (ids: string[]) => void;
  bulkDeleteTasks: (ids: string[]) => void;
  clearLogbook: () => void;
  bulkSetPriority: (ids: string[], priority: Priority) => void;
  bulkDefer: (ids: string[], until: Date) => void;
  bulkSetWhen: (ids: string[], date: Date | null, timeSegments: TimeOfDay[]) => void;
  bulkSetCategory: (ids: string[], category: string | null) => void;
  bulkAddTags: (ids: string[], tags: string[]) => void;
  addTag: (tag: string) => void;
  deleteTag: (tag: string) => void;
  allCategories: () => string[];
  addCategory: (name: string) => void;
  deleteCategory: (name: string) => void;
  renameCategory: (name: string, newName: string) => boolean;
  tasksByCategory: (category: string) => Task[];

  visibleTasks: () => Task[];
  upcomingTodayTasks: () => Task[];
  inboxTasks: () => Task[];
  unscheduledTasks: () => Task[];
  deferredTasks: () => Task[];
  expiredTasks: () => Task[];
  vacationHiddenTasks: () => Task[];
  pinnedTasks: () => Task[];
  completedTasks: () => Task[];
  archivedTasks: () => Task[];
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
    useTaskGroupStore.getState().initialize();
    useProjectStore.getState().initialize();
    useProjectCategoryStore.getState().initialize();
    useTemplateCategoryStore.getState().initialize();
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
      deadlineOffsetDays: draft.deadlineOffsetDays ?? null,
      deadlineMonthDay: draft.deadlineMonthDay ?? null,
      deferUntil: draft.deferUntil ?? null,
      timeSegments: draft.timeSegments ?? [],
      windowStart: draft.windowStart ?? null,
      windowEnd: draft.windowEnd ?? null,
      recurrenceType: draft.recurrenceType ?? 'none',
      recurrenceInterval: draft.recurrenceInterval ?? 1,
      recurrenceDays: draft.recurrenceDays ?? [],
      recurrenceMonthDay: draft.recurrenceMonthDay ?? null,
      recurrenceWeekOrdinal: draft.recurrenceWeekOrdinal ?? null,
      recurrenceEndDate: draft.recurrenceEndDate ?? null,
      recurrenceCount: draft.recurrenceCount ?? null,
      recurrenceFromCompletion: draft.recurrenceFromCompletion ?? false,
      tags: draft.tags ?? [],
      category: draft.category ?? null,
      sortOrder: maxOrder + 1,
      pinned: draft.pinned ?? false,
      priority: draft.priority ?? 0,
      effort: draft.effort ?? 0,
      estimatedMinutes: draft.estimatedMinutes ?? null,
      streakCount: 0,
      streakDate: null,
      previousStreakCount: 0,
      previousStreakDate: null,
      parentId: draft.parentId ?? null,
      groupId: draft.groupId ?? null,
      projectId: draft.projectId ?? null,
      reminderTime: draft.reminderTime ?? null,
      chainEnabled: draft.chainEnabled ?? false,
      chainIndex: draft.chainIndex ?? 0,
      chainItems: draft.chainItems ?? [],
      vacationPause: draft.vacationPause ?? false,
      timerStartedAt: draft.timerStartedAt ?? null,
      actualMinutes: draft.actualMinutes ?? null,
      previousOccurrenceId: draft.previousOccurrenceId ?? null,
      seriesDefaults: null,
      archived: false,
      archivedAt: null,
      linkUrl: draft.linkUrl ?? null,
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
      pinned: false,
      streakCount: 0,
      streakDate: null,
      previousStreakCount: 0,
      previousStreakDate: null,
      timerStartedAt: null,
      actualMinutes: null,
      previousOccurrenceId: null,
      seriesDefaults: null,
      archived: false,
      archivedAt: null,
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

  updateTask(id, updates, options) {
    const scope = options?.scope ?? 'series';
    const tasks = get().tasks.map(t => {
      if (t.id !== id) return t;

      let seriesDefaults = t.seriesDefaults;
      if (scope === 'occurrence') {
        const captured: Partial<Task> = {};
        for (const key of CONTENT_FIELDS) {
          if (key in updates && !(seriesDefaults && key in seriesDefaults)) {
            captureField(captured, t, key);
          }
        }
        if (Object.keys(captured).length > 0) {
          seriesDefaults = { ...(seriesDefaults ?? {}), ...captured };
        }
      } else if (seriesDefaults) {
        // A deliberate series-wide change makes any pending "revert to"
        // value for that field stale — drop it.
        const next = { ...seriesDefaults };
        let changed = false;
        for (const key of CONTENT_FIELDS) {
          if (key in updates && key in next) {
            delete next[key];
            changed = true;
          }
        }
        seriesDefaults = changed ? (Object.keys(next).length > 0 ? next : null) : seriesDefaults;
      }

      const updated = { ...t, ...updates, seriesDefaults };
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

  markTasksSeen(ids) {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    ids.forEach(id => dbMarkTaskSeen(id, now));
    set(s => ({ tasks: s.tasks.map(t => (ids.includes(t.id) ? { ...t, seenAt: now } : t)) }));
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
      // Pin is cleared once the completion hold below expires, not
      // immediately — otherwise a pinned row would vanish from the Pinned
      // section instantly instead of getting the same fade-out grace period
      // every other list gives a completed task.
      streakCount: task.recurrenceType !== 'none' ? newStreakCount : task.streakCount,
      streakDate: task.recurrenceType !== 'none' ? getCurrentDayStart().toISOString() : task.streakDate,
      previousStreakCount: task.streakCount,
      previousStreakDate: task.streakDate,
    };
    if (task.pinned) pendingUnpinIds.push(id);
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
        // A "this task only" edit (see updateTask) stores what content fields
        // should revert to for the next occurrence in seriesDefaults — apply
        // it before spreading so the clone below reflects the series' real
        // values, not a one-off edit made on this occurrence.
        const effective: Task = { ...task, ...(task.seriesDefaults ?? {}) };
        let nextReminderTime: string | null = effective.reminderTime;
        if (nextDue && effective.reminderTime) {
          const original = new Date(effective.reminderTime);
          const next = new Date(nextDue);
          next.setHours(original.getHours(), original.getMinutes(), 0, 0);
          nextReminderTime = next.toISOString();
        }
        const nextChainIndex = chainAdvances
          ? (atChainEnd ? 0 : task.chainIndex + 1)
          : task.chainIndex;
        // A fixed deadline is a one-off target date and doesn't carry to the next
        // occurrence. A relative deadline (deadlineOffsetDays or deadlineMonthDay
        // set — mutually exclusive) recomputes against the new dueDate instead,
        // so e.g. "the day before it's due" or "the last day of the month"
        // keeps meaning that on every future occurrence too.
        const nextDeadline =
          !nextDue ? null
          : effective.deadlineOffsetDays !== null
            ? getDeadlineFromOffset(nextDue, effective.deadlineOffsetDays).toISOString()
          : effective.deadlineMonthDay !== null
            ? getDeadlineFromMonthDay(nextDue, effective.deadlineMonthDay).toISOString()
            : null;
        nextTask = {
          ...effective,
          id: generateId(),
          completed: false,
          completedAt: null,
          createdAt: now.toISOString(),
          seenAt: now.toISOString(),
          dueDate: nextDue ? nextDue.toISOString() : null,
          deadline: nextDeadline,
          deferUntil: null,
          pinned: false, // pin resets on new occurrence
          streakCount: recurs ? newStreakCount : task.streakCount,
          streakDate: recurs ? getCurrentDayStart().toISOString() : task.streakDate,
          reminderTime: nextReminderTime,
          chainIndex: nextChainIndex,
          recurrenceCount: task.recurrenceCount !== null ? task.recurrenceCount - 1 : null,
          timerStartedAt: null, // fresh occurrence isn't running; actualMinutes/estimate carry via ...effective
          // vacationPause carries over so recurring tasks stay paused across occurrences
          previousOccurrenceId: task.id, // lets uncompleting `task` remove this occurrence again
          seriesDefaults: null, // fresh occurrence starts with no pending "this task only" overrides
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
    if (nextTask) clearGroupDismissal(nextTask.groupId);

    // Opt-in convenience only (autoArchiveProjectsOnComplete, default off) —
    // finishing a project never happens automatically otherwise; the user
    // decides when a 100%-complete project actually gets archived.
    if (task.projectId && useSettingsStore.getState().autoArchiveProjectsOnComplete) {
      const progress = projectProgress(task.projectId, get().tasks);
      if (progress.total > 0 && progress.done === progress.total) {
        useProjectStore.getState().archiveProject(task.projectId);
      }
    }

    if (completionHoldTimer) clearTimeout(completionHoldTimer);
    completionHoldTimer = setTimeout(() => {
      completionHoldTimer = null;
      const unpinIds = pendingUnpinIds;
      pendingUnpinIds = [];
      // Re-check completed && pinned against current state rather than
      // trusting the ids blindly — if the completion was undone in the
      // meantime (uncompleteTask), the task is no longer completed and its
      // pin was never actually touched, so it must stay untouched here too.
      const stillPinnedIds = get().tasks
        .filter(t => unpinIds.includes(t.id) && t.completed && t.pinned)
        .map(t => t.id);
      if (stillPinnedIds.length > 0) dbBulkSetPinned(stillPinnedIds, false);
      // No animateLayout() here: this commit unmounts the completed row's
      // Swipeable (react-native-gesture-handler). Firing a LayoutAnimation in
      // the same tick a Swipeable unmounts crashes on iOS — RNGH's native
      // animated-event cleanup (removeAnimatedEventFromView) races the layout
      // transition and can segfault mid-GC. The row already faded to
      // opacity 0 during the completion animation, so the list just loses its
      // slot cleanly without needing an extra transition here.
      set(s => ({
        completionHoldIds: [],
        tasks: stillPinnedIds.length > 0
          ? s.tasks.map(t => (stillPinnedIds.includes(t.id) ? { ...t, pinned: false } : t))
          : s.tasks,
      }));
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
    const original = task;
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
    const followUpSubtasks = followUp ? get().subtasksOf(followUp.id) : [];
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
    clearGroupDismissal(task.groupId);

    // Un-completing a task (e.g. from the Logbook) is itself undoable via
    // shake-to-undo — this restores the exact prior completed state rather
    // than re-running completeTask, which would recompute streak/dueDate
    // off "now" instead of reproducing what was actually undone.
    get().setLastAction({
      label: 'Task uncompleted',
      undo: () => {
        dbUpdateTask(original);
        if (followUp) {
          dbInsertTask(followUp);
          scheduleTaskReminder(followUp);
          followUpSubtasks.forEach(sub => {
            dbInsertTask(sub);
            scheduleTaskReminder(sub);
          });
        }
        set(s => ({
          tasks: [
            ...s.tasks.map(t => (t.id === id ? original : t)),
            ...(followUp ? [followUp, ...followUpSubtasks] : []),
          ],
        }));
      },
    });
  },

  deferTask(id, until) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    const snapshot = { ...task };
    get().updateTask(id, { deferUntil: until.toISOString() });
    get().setLastAction({
      label: 'Task rescheduled',
      undo: () => get().updateTask(snapshot.id, snapshot),
    });
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

  togglePin(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    get().updateTask(id, { pinned: !task.pinned });
  },

  archiveTask(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.archived) return;
    get().updateTask(id, { archived: true, archivedAt: new Date().toISOString(), pinned: false });
    get().setLastAction({
      label: 'Task archived',
      undo: () => get().updateTask(id, { archived: false, archivedAt: null }),
    });
  },

  unarchiveTask(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || !task.archived) return;
    get().updateTask(id, {
      archived: false,
      archivedAt: null,
      streakCount: 0,
      streakDate: null,
    });
  },

  clearAllPins() {
    dbClearAllPins();
    set(s => ({
      tasks: s.tasks.map(t => (t.pinned ? { ...t, pinned: false } : t)),
    }));
  },

  pinCategory(category) {
    const ids = get().tasksByCategory(category).map(t => t.id);
    if (ids.length === 0) return;
    const allPinned = ids.every(id => get().tasks.find(t => t.id === id)?.pinned);
    const nextPinned = !allPinned;
    dbBulkSetPinned(ids, nextPinned);
    set(s => ({
      tasks: s.tasks.map(t => (ids.includes(t.id) ? { ...t, pinned: nextPinned } : t)),
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

  reorderWithCategoryUpdates(orderedIds, categoryUpdates, options) {
    const scope = options?.scope ?? 'series';
    const orderUpdates = orderedIds.map((id, index) => ({ id, sortOrder: index + 1 }));
    dbBatchUpdateSortOrders(orderUpdates);
    set(s => ({
      tasks: s.tasks.map(t => {
        const orderUpdate = orderUpdates.find(x => x.id === t.id);
        return orderUpdate ? { ...t, sortOrder: orderUpdate.sortOrder } : t;
      }),
    }));

    // Snapshot full pre-drop tasks so a category move can be undone, and
    // route the category write through updateTask so it gets the same
    // recurring-series handling (seriesDefaults capture for 'occurrence'
    // scope) as any other content-field edit.
    const snapshots = categoryUpdates
      .map(u => get().tasks.find(t => t.id === u.id))
      .filter((t): t is Task => t !== undefined)
      .map(t => ({ ...t }));

    categoryUpdates.forEach(u => {
      get().updateTask(u.id, { category: u.category }, scope === 'occurrence' ? { scope: 'occurrence' } : undefined);
    });

    if (snapshots.length > 0) {
      get().setLastAction({
        label: snapshots.length === 1 ? 'Category changed' : `${snapshots.length} tasks recategorized`,
        undo: () => snapshots.forEach(snapshot => get().updateTask(snapshot.id, snapshot)),
      });
    }
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
      tags: [],
      category: null,
      sortOrder: maxOrder + 1,
      pinned: false,
      priority: 0,
      effort: 0,
      estimatedMinutes: null,
      streakCount: 0,
      streakDate: null,
      previousStreakCount: 0,
      previousStreakDate: null,
      parentId,
      groupId: null,
      projectId: null,
      reminderTime: null,
      chainEnabled: false,
      chainIndex: 0,
      chainItems: [],
      vacationPause: false,
      timerStartedAt: null,
      actualMinutes: null,
      previousOccurrenceId: null,
      seriesDefaults: null,
      archived: false,
      archivedAt: null,
      linkUrl: null,
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

  groupChildrenOf(groupId) {
    return get().tasks
      .filter(t => t.groupId === groupId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  addNewGroupedTask(groupId, title) {
    const now = new Date().toISOString();
    const group = useTaskGroupStore.getState().getGroupById(groupId);
    const siblings = get().tasks.filter(t => t.groupId === groupId);
    const maxOrder = siblings.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    const task: Task = {
      id: generateId(),
      title,
      notes: '',
      completed: false,
      completedAt: null,
      createdAt: now,
      seenAt: now,
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
      tags: [],
      category: group?.category ?? null,
      sortOrder: maxOrder + 1,
      pinned: false,
      priority: 0,
      effort: 0,
      estimatedMinutes: null,
      streakCount: 0,
      streakDate: null,
      previousStreakCount: 0,
      previousStreakDate: null,
      parentId: null,
      groupId,
      projectId: null,
      reminderTime: null,
      chainEnabled: false,
      chainIndex: 0,
      chainItems: [],
      vacationPause: false,
      timerStartedAt: null,
      actualMinutes: null,
      previousOccurrenceId: null,
      seriesDefaults: null,
      archived: false,
      archivedAt: null,
      linkUrl: null,
    };
    dbInsertTask(task);
    set(s => ({ tasks: [...s.tasks, task] }));
    clearGroupDismissal(groupId);
    return task;
  },

  addExistingToGroup(taskId, groupId) {
    const task = get().tasks.find(t => t.id === taskId);
    if (!task) return;
    const siblings = get().tasks.filter(t => t.groupId === groupId);
    const maxOrder = siblings.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    get().updateTask(taskId, { groupId, sortOrder: maxOrder + 1 });
    if (!task.completed) clearGroupDismissal(groupId);
  },

  removeFromGroup(taskId) {
    get().updateTask(taskId, { groupId: null });
  },

  reorderGroupChildren(groupId, orderedIds) {
    const updates = orderedIds.map((id, index) => ({ id, sortOrder: index + 1 }));
    dbBatchUpdateSortOrders(updates);
    set(s => ({
      tasks: s.tasks.map(t => {
        const u = updates.find(x => x.id === t.id);
        return u ? { ...t, sortOrder: u.sortOrder } : t;
      }),
    }));
  },

  groupTasks(taskIds, title, category) {
    const group = useTaskGroupStore.getState().createGroup(title, category);
    taskIds.forEach((id, index) => {
      get().updateTask(id, { groupId: group.id, sortOrder: index + 1 });
    });
    return group;
  },

  // Cascades complete/uncomplete/defer/pin to every child, reusing each
  // child's own completeTask/uncompleteTask/updateTask so per-child guards
  // (already-completed, isRecurrenceNotYetDue), streak math, recurrence
  // spawns, and chain advances all keep working exactly as if tapped
  // individually. A mismatched-cadence child (e.g. iron every 3 days) can
  // never be force-completed early — completeTask's own guard silently
  // no-ops it. Skip is deliberately NOT cascaded here: it only makes sense
  // per-child (see skipNextRecurrence), and cascading it across children on
  // different cadences would desync them unpredictably.
  completeGroup(groupId) {
    const children = get().groupChildrenOf(groupId);
    const completedIds: string[] = [];
    children.forEach(child => {
      if (child.completed) return;
      get().completeTask(child.id);
      if (get().tasks.find(t => t.id === child.id)?.completed) completedIds.push(child.id);
    });
    if (completedIds.length === 0) return;
    get().setLastAction({
      label: `${completedIds.length} task${completedIds.length === 1 ? '' : 's'} completed`,
      undo: () => completedIds.forEach(id => get().uncompleteTask(id)),
    });
  },

  uncompleteGroup(groupId) {
    // The group's checkbox is a live readout (see TaskGroupHeader), not its
    // own stored field — so unchecking it can only mean "uncomplete
    // whichever children are currently done." Each uncompleteTask call sets
    // its own precise, snapshot-based undo (restores exact prior
    // completed/streak state and re-inserts any deleted follow-up
    // occurrence — see uncompleteTask) as get().lastAction; capture each one
    // immediately so this can compose them into a single combined undo
    // instead of just the last child's.
    // Only children completed as part of *today's* tally (isRelevantToGroupToday) —
    // a recurring task's groupId is shared by every past completed occurrence
    // forever (see Recurrence in CLAUDE.md), so without this filter unchecking
    // the stack would resurrect every historical completion as incomplete,
    // not just what the checkbox currently represents.
    const children = get().groupChildrenOf(groupId).filter(c => c.completed && isRelevantToGroupToday(c));
    if (children.length === 0) return;
    const undos: Array<() => void> = [];
    children.forEach(child => {
      get().uncompleteTask(child.id);
      const action = get().lastAction;
      if (action) undos.push(action.undo);
    });
    get().setLastAction({
      label: `${children.length} task${children.length === 1 ? '' : 's'} uncompleted`,
      undo: () => undos.forEach(fn => fn()),
    });
  },

  // Marks a fully-done stack as explicitly dismissed so it drops off Today
  // (see TaskGroupHeader/visibleGroupItems) instead of sitting there checked
  // off forever. Distinct from uncompleteGroup: this doesn't touch any
  // child's completed state at all, it only stamps the group itself.
  dismissGroup(groupId) {
    const group = useTaskGroupStore.getState().getGroupById(groupId);
    if (!group || group.completedAt) return;
    useTaskGroupStore.getState().setGroupCompletedAt(groupId, new Date().toISOString());
    get().setLastAction({
      label: 'Stack completed',
      undo: () => useTaskGroupStore.getState().setGroupCompletedAt(groupId, null),
    });
  },

  deferGroup(groupId, until) {
    const ids = get().groupChildrenOf(groupId).map(c => c.id);
    get().bulkDefer(ids, until);
  },

  pinGroup(groupId) {
    const ids = get().groupChildrenOf(groupId).map(c => c.id);
    if (ids.length === 0) return;
    const allPinned = ids.every(id => get().tasks.find(t => t.id === id)?.pinned);
    const nextPinned = !allPinned;
    dbBulkSetPinned(ids, nextPinned);
    set(s => ({
      tasks: s.tasks.map(t => (ids.includes(t.id) ? { ...t, pinned: nextPinned } : t)),
    }));
  },

  deleteGroup(groupId, opts) {
    const children = get().groupChildrenOf(groupId);
    const group = useTaskGroupStore.getState().getGroupById(groupId);
    const undos: Array<() => void> = [];
    if (opts.cascade) {
      children.forEach(child => {
        get().deleteTask(child.id);
        const action = get().lastAction;
        if (action) undos.push(action.undo);
      });
    } else {
      children.forEach(child => get().removeFromGroup(child.id));
    }
    useTaskGroupStore.getState().removeGroupRow(groupId);
    if (!group) return;
    get().setLastAction({
      label: opts.cascade ? 'Group and its tasks deleted' : 'Group deleted',
      undo: () => {
        useTaskGroupStore.getState().restoreGroup(group);
        if (opts.cascade) {
          undos.forEach(fn => fn());
        } else {
          children.forEach(child => get().addExistingToGroup(child.id, groupId));
        }
      },
    });
  },

  addExistingToProject(taskId, projectId) {
    get().updateTask(taskId, { projectId });
  },

  removeFromProject(taskId) {
    get().updateTask(taskId, { projectId: null });
  },

  deleteProject(projectId, opts) {
    const members = get().tasks.filter(t => t.projectId === projectId);
    const project = useProjectStore.getState().getProjectById(projectId);
    const undos: Array<() => void> = [];
    if (opts.cascade) {
      members.forEach(member => {
        get().deleteTask(member.id);
        const action = get().lastAction;
        if (action) undos.push(action.undo);
      });
    } else {
      members.forEach(member => get().removeFromProject(member.id));
    }
    useProjectStore.getState().removeProjectRow(projectId);
    if (!project) return;
    get().setLastAction({
      label: opts.cascade ? 'Project and its tasks deleted' : 'Project deleted',
      undo: () => {
        useProjectStore.getState().restoreProject(project);
        if (opts.cascade) {
          undos.forEach(fn => fn());
        } else {
          members.forEach(member => get().addExistingToProject(member.id, projectId));
        }
      },
    });
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

  // Auto-turns-off vacation mode once its optional end date has passed —
  // call on app start and whenever the app returns to the foreground, since
  // there's no timer running while the app is backgrounded/closed.
  checkVacationExpiry() {
    const { vacationMode, vacationEnd, setVacationMode } = useSettingsStore.getState();
    if (!vacationMode || !vacationEnd) return;
    if (new Date() < new Date(vacationEnd)) return;
    get().forgivVacationStreaks();
    setVacationMode(false);
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

  // Deletes every completed top-level task (and their subtasks) via
  // bulkDeleteTasks, then relabels the undo it already set up — the same
  // snapshot-and-reinsert undo bulkDeleteTasks gives any other bulk delete.
  clearLogbook() {
    const ids = get().completedTasks().map(t => t.id);
    if (ids.length === 0) return;
    get().bulkDeleteTasks(ids);
    const undo = get().lastAction?.undo;
    if (undo) {
      get().setLastAction({ label: 'Logbook cleared', undo });
    }
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
    const snapshots = ids
      .map(id => get().tasks.find(t => t.id === id))
      .filter((t): t is Task => t !== undefined)
      .map(t => ({ ...t }));
    dbBulkSetDefer(ids, deferUntil);
    set(s => ({
      tasks: s.tasks.map(t => ids.includes(t.id) ? { ...t, deferUntil } : t),
    }));
    if (snapshots.length > 0) {
      get().setLastAction({
        label: snapshots.length === 1 ? 'Task rescheduled' : `${snapshots.length} tasks rescheduled`,
        undo: () => snapshots.forEach(snapshot => get().updateTask(snapshot.id, snapshot)),
      });
    }
  },

  bulkSetWhen(ids, date, timeSegments) {
    if (ids.length === 0) return;
    const dueDate = date ? date.toISOString() : null;
    const snapshots = ids
      .map(id => get().tasks.find(t => t.id === id))
      .filter((t): t is Task => t !== undefined)
      .map(t => ({ ...t }));
    dbBulkSetWhen(ids, dueDate, timeSegments);
    set(s => ({
      tasks: s.tasks.map(t => ids.includes(t.id) ? { ...t, dueDate, timeSegments } : t),
    }));
    if (snapshots.length > 0) {
      get().setLastAction({
        label: snapshots.length === 1 ? 'Task rescheduled' : `${snapshots.length} tasks rescheduled`,
        undo: () => snapshots.forEach(snapshot => get().updateTask(snapshot.id, snapshot)),
      });
    }
  },

  bulkSetCategory(ids, category) {
    if (ids.length === 0) return;
    dbBulkSetCategory(ids, category);
    set(s => ({
      tasks: s.tasks.map(t => ids.includes(t.id) ? { ...t, category } : t),
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

  inboxTasks() {
    return get().tasks
      .filter(isInboxTask)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  unscheduledTasks() {
    return get().tasks
      .filter(isUnscheduledTask)
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

  pinnedTasks() {
    const { vacationMode } = useSettingsStore.getState();
    const { tasks, completionHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds)
      .filter(t => !t.parentId && t.pinned && !t.completed && !t.archived && !(vacationMode && t.vacationPause))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  completedTasks() {
    return get().tasks.filter(t => !t.parentId && t.completed && t.completedAt);
  },

  archivedTasks() {
    return get().tasks
      .filter(t => !t.parentId && t.archived && !t.completed)
      .sort((a, b) => a.sortOrder - b.sortOrder);
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

  renameCategory(name, newName) {
    const renamed = useCategoryStore.getState().renameCategory(name, newName);
    if (!renamed) return false;
    const trimmed = newName.trim();
    set(s => ({
      tasks: s.tasks.map(t => t.category === name ? { ...t, category: trimmed } : t),
    }));
    useTaskGroupStore.setState(s => ({
      groups: s.groups.map(g => g.category === name ? { ...g, category: trimmed } : g),
    }));
    return true;
  },

  tasksByTag(tag) {
    const { tasks, completionHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds).filter(t => !t.completed && !t.archived && t.tags.includes(tag));
  },

  tasksByCategory(category) {
    const { tasks, completionHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds).filter(t => !t.completed && !t.archived && !t.parentId && t.category === category);
  },
}));
