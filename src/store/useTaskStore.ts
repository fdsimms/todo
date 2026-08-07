import { create } from 'zustand';
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
  dbBulkSetTimeSegments,
  dbBulkSetCategory,
  dbBulkSetPinned,
  dbBulkAddTags,
  dbGetTagRegistry,
  dbAddToTagRegistry,
  dbRemoveFromTagRegistry,
  dbRemoveTagFromAllTasks,
  dbMarkTaskSeen,
  dbTransaction,
} from '../db/database';
import { useSettingsStore } from './useSettingsStore';
import { useCategoryStore } from './useCategoryStore';
import { useTemplateStore } from './useTemplateStore';
import { useTaskGroupStore } from './useTaskGroupStore';
import { useProjectStore, projectProgress } from './useProjectStore';
import { useProjectCategoryStore } from './useProjectCategoryStore';
import { useTemplateCategoryStore } from './useTemplateCategoryStore';
import { dripCandidate, projectPullUpdates } from '../utils/projectPull';
import type { TaskGroup } from '../types';
import { generateId } from '../utils/id';
import { reorderSubset } from '../utils/reorder';
import { applyMeasuredTime } from '../utils/effort';
import { getNextDueDate, getCurrentDayStart, getTaskDayStart, getDeadlineFromOffset, getDeadlineFromMonthDay, getStreakOutcome, getNextSeriesDates } from '../utils/dateUtils';
import { isTaskVisible, isTaskDeferred, isUpcomingToday, isHiddenForVacation, isTaskExpired, isRecurrenceNotYetDue, isLiveRecurring, isInboxTask, isUnscheduledTask, isWaitingTask, isRelevantToGroupToday, groupRoster, hasNoDateSignal, isQuotaTask, sameTimeSegments } from '../utils/visibilityUtils';
import { retentionCutoff, selectPurgeableTaskIds } from '../utils/retention';
import { registerTaskSource } from '../utils/blockerRegistry';
import { scheduleTaskReminder, cancelTaskReminder, rescheduleAllReminders, scheduleTimerAlarm, cancelTimerAlarm } from '../utils/notifications';
import { isTimedTask, timerElapsed } from '../utils/timer';

interface UndoableAction {
  label: string;
  undo: () => void;
  /**
   * When the action happened, stamped centrally by setLastAction — call
   * sites never pass it. Shake-to-undo uses it to refuse actions old enough
   * that offering to undo them would be a surprise rather than a rescue
   * (see UNDO_ACTION_MAX_AGE_MS in utils/shakeDetect.ts).
   */
  at?: number;
}

// Fields that silently carry forward to the next occurrence today (spread
// via `...task` in completeTask). These are the only fields "this task only"
// edits (updateTask's { scope: 'occurrence' }) need to protect via
// seriesDefaults — recurrence-rule, chain, and schedule fields are excluded
// because each already has exactly one sensible interpretation (see
// isLiveRecurring / CLAUDE.md recurrence docs for why).
export const CONTENT_FIELDS: (keyof Task)[] = [
  'title', 'notes', 'tags', 'category', 'priority', 'effort',
  'estimatedMinutes', 'timedMinutes', 'windowStart', 'windowEnd', 'timeSegments', 'reminderTime', 'reminderKind', 'linkUrl',
  // Grouped with the other visibility gates (windowStart, timeSegments) rather
  // than the recurrence rule: "this occurrence waits on that one-off errand" is
  // a normal thing to want, and without this a scope:'occurrence' edit would
  // quietly become the template for every occurrence after it.
  'blockedById',
];

function captureField<K extends keyof Task>(target: Partial<Task>, source: Task, key: K): void {
  target[key] = source[key];
}

// The time-of-day a brand-new task starts with: its own if the draft named
// one, else its category's default (Category.defaultTimeSegments).
//
// An empty draft array counts as "didn't name one" rather than as an explicit
// "no segment", because every editor sends timeSegments unconditionally from
// its state — TaskEditor and QuickAdd both pass `[]` when the user simply
// never opened the Time of day row, so treating `[]` as a deliberate choice
// would make the default fire for approximately nobody.
//
// Creation only, and the resolved value is written onto the row like any
// other: after this the task's own timeSegments are what everything reads, so
// clearing the category's default never moves a task that already exists.
function resolveTimeSegments(draft: Partial<TaskDraft>): TimeOfDay[] {
  if (draft.timeSegments && draft.timeSegments.length > 0) return draft.timeSegments;
  if (!draft.category) return draft.timeSegments ?? [];
  const cat = useCategoryStore.getState().getCategoryByName(draft.category);
  return cat?.defaultTimeSegments.length ? [...cat.defaultTimeSegments] : (draft.timeSegments ?? []);
}

// The one place a Task's defaults are spelled out. Shared by addTask and the
// dated-series builder below so a new field can't end up defaulted in one
// path and undefined in the other.
//
// `seedFromCategory` is off by default because this is also the *clone*
// builder: buildSeriesRow feeds it an existing row when a series is
// reconciled or rolls over, and there an empty timeSegments is the source
// row's deliberate answer, not an unanswered question. Only the two paths
// where a person is creating a task from scratch turn it on.
function newTaskFromDraft(
  draft: Partial<TaskDraft>,
  now: string,
  sortOrder: number,
  seedFromCategory = false,
): Task {
  return {
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
    timeSegments: seedFromCategory ? resolveTimeSegments(draft) : (draft.timeSegments ?? []),
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
    targetCount: draft.targetCount ?? null,
    progressCount: draft.progressCount ?? 0,
    tags: draft.tags ?? [],
    category: draft.category ?? null,
    sortOrder,
    pinned: draft.pinned ?? false,
    priority: draft.priority ?? 0,
    effort: draft.effort ?? 0,
    estimatedMinutes: draft.estimatedMinutes ?? null,
    streakCount: 0,
    streakDate: null,
    previousStreakCount: 0,
    previousStreakDate: null,
    showStreak: draft.showStreak ?? false,
    parentId: draft.parentId ?? null,
    groupId: draft.groupId ?? null,
    projectId: draft.projectId ?? null,
    reminderTime: draft.reminderTime ?? null,
    reminderKind: draft.reminderKind ?? 'notification',
    chainEnabled: draft.chainEnabled ?? false,
    chainIndex: draft.chainIndex ?? 0,
    chainItems: draft.chainItems ?? [],
    vacationPause: draft.vacationPause ?? false,
    timerStartedAt: draft.timerStartedAt ?? null,
    actualMinutes: draft.actualMinutes ?? null,
    timedMinutes: draft.timedMinutes ?? null,
    timerElapsedSeconds: draft.timerElapsedSeconds ?? 0,
    previousOccurrenceId: draft.previousOccurrenceId ?? null,
    seriesId: draft.seriesId ?? null,
    seriesMonthDays: draft.seriesMonthDays ?? [],
    seriesRepeatMonths: draft.seriesRepeatMonths ?? 1,
    seriesDefaults: null,
    archived: false,
    archivedAt: null,
    linkUrl: draft.linkUrl ?? null,
    blockedById: draft.blockedById ?? null,
  };
}

// Identity of a date as the user picked it off a calendar — deliberately the
// literal Y/M/D rather than getDayStart, since reconciling a series matches
// rows against dates chosen in a date picker, where dayResetTime plays no part.
function calendarDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Moves an absolute reminder instant onto `date`, keeping its time of day.
// A set of dates shares an hour, not a moment — copying the source row's
// reminderTime verbatim would fire every date's notification on the first one.
function reanchorReminder(reminderTime: string | null, date: Date): string | null {
  if (!reminderTime) return null;
  const original = new Date(reminderTime);
  const next = new Date(date);
  next.setHours(original.getHours(), original.getMinutes(), 0, 0);
  return next.toISOString();
}

// A dated series and a recurrence rule are two schedules for one task, and a
// series row is deliberately an ordinary one-off (see Task.seriesId) — the set
// comes back, if it comes back at all, through seriesMonthDays. Left in place,
// a rule carried onto every row of the set and completing one date spawned an
// extra occurrence *inside the same series*: the set grew by a row per
// completion, and the next date edit deleted the rows it no longer recognised.
// So forming a series clears the rule rather than trying to run both.
type RecurrenceFields = Pick<
  Task,
  | 'recurrenceType' | 'recurrenceInterval' | 'recurrenceDays' | 'recurrenceMonthDay'
  | 'recurrenceWeekOrdinal' | 'recurrenceEndDate' | 'recurrenceCount'
  | 'recurrenceFromCompletion' | 'showStreak'
>;

const NO_RECURRENCE: RecurrenceFields = {
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  // Only a recurring task has a streak to show, and the editor only offers the
  // toggle there — same reasoning as the showStreak reset in TaskEditor.
  showStreak: false,
};

// One row of a dated series (Task.seriesId). Every field but the date comes
// from the source row/draft; a relative deadline recomputes against this row's
// own date the same way it does for a new recurrence occurrence, while a fixed
// one is a single absolute target and carries over untouched.
function buildSeriesRow(
  source: Partial<TaskDraft>,
  date: Date,
  seriesId: string,
  repeat?: { monthDays: number[]; repeatMonths: number },
  seedFromCategory = false,
): Task {
  const now = new Date().toISOString();
  const base = newTaskFromDraft(source, now, 0, seedFromCategory);
  return {
    ...base,
    ...NO_RECURRENCE,
    dueDate: date.toISOString(),
    // Each date stands on its own; a defer set on the row this was cloned
    // from would otherwise hide every date behind that one day.
    deferUntil: null,
    pinned: false,
    seriesId,
    seriesMonthDays: repeat?.monthDays ?? [],
    seriesRepeatMonths: repeat?.repeatMonths ?? 1,
    // Cloned from a template row, which may itself have been spawned by a
    // completion — inheriting that pointer would make this row read as the
    // follow-up to a completion it has nothing to do with, and uncompleting
    // that one would delete it. Callers that do want the link (the rollover in
    // completeTask) set it themselves on top of this.
    previousOccurrenceId: null,
    deadline:
      base.deadlineOffsetDays !== null
        ? getDeadlineFromOffset(date, base.deadlineOffsetDays).toISOString()
        : base.deadlineMonthDay !== null
          ? getDeadlineFromMonthDay(date, base.deadlineMonthDay).toISOString()
          : base.deadline,
    reminderTime: reanchorReminder(base.reminderTime, date),
  };
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

// The held rows shrink away as a batch, and this is how long the store waits
// before deciding the batch is closed. Every row completed in a burst closes
// its gap in the same frame, rather than each one closing its own the instant
// its tap's animation happened to finish — tapping four tasks used to reflow
// the list four times, in tap order, which is exactly what the hold above
// exists to avoid. It's much shorter than the hold because it doesn't have to
// guess whether the burst is over: a tap that is still playing its completion
// animation has already registered itself as in-flight
// (beginCompletionAnimation), and this timer isn't armed until every one of
// those has landed. So a lone completion collapses promptly, while a run of
// them waits for the last row to catch up. The collapse animation
// (animation.duration.normal, 250ms) then has to finish inside the remaining
// hold, or rows would be unmounted mid-shrink — both timers are armed by the
// same completion, so this has to stay under COMPLETION_HOLD_MS minus that.
const COMPLETION_COLLAPSE_MS = 300;
let completionCollapseTimer: ReturnType<typeof setTimeout> | null = null;
// Ids whose completion animation is playing but hasn't reached completeTask
// yet. Only the collapse timing reads it, so it stays out of the store's state
// — a row doesn't re-render because a *different* row was tapped.
let pendingCompletionIds: string[] = [];

// The same idea as the completion hold, for the other way a task leaves Today
// under its own steam: a daily target that a logged unit just put back on pace.
// That one used to go on the tap that logged it, which capped a real burst —
// four glasses of water at once — at one unit per trip to the list, with the
// rest only loggable from Later. So the row asks for the task to be pinned to
// Today while it plays itself out, and lets go once it has (see handleQuotaTap
// in TaskItem).
//
// Unlike the completion hold, this one is released by the row rather than by a
// timer here: the row owns the animation whose end the release marks, and two
// timers racing over one row is how it would start blinking. The backstop below
// only catches a hold whose row went away without releasing it — a screen
// change or a filter mid-window — where the release would otherwise never come.
const QUOTA_HOLD_BACKSTOP_MS = 30000;
let quotaHoldTimer: ReturnType<typeof setTimeout> | null = null;
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

// Arms (or re-arms) the batched collapse. Called from every completion and
// whenever an in-flight one is cancelled; while any tap is still playing its
// animation the timer stays down, and that tap's own completion re-arms it.
// If an in-flight completion never lands (its row unmounted mid-animation),
// nothing collapses and the hold above still unmounts the rows on schedule —
// the same send-off they got before there was a collapse at all.
function armCompletionCollapse() {
  if (completionCollapseTimer) clearTimeout(completionCollapseTimer);
  completionCollapseTimer = null;
  if (pendingCompletionIds.length > 0) return;
  completionCollapseTimer = setTimeout(() => {
    completionCollapseTimer = null;
    const held = useTaskStore.getState().completionHoldIds;
    if (held.length > 0) useTaskStore.setState({ completionCollapseIds: held });
  }, COMPLETION_COLLAPSE_MS);
  (completionCollapseTimer as unknown as { unref?: () => void }).unref?.();
}

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
    // "Wherever it would be if it were still incomplete" has to include the
    // count for a daily target, because completion *is* the count reaching the
    // target: a mask left at 8/8 reads as a target on pace rather than as the
    // row that was there before the tap, and lands it in whichever list it
    // hadn't been in. One finished on Today would jump into Later Today's
    // on-pace run for the length of the hold; one finished from that run would
    // drop out of it and skip the batched collapse. A unit short is also what
    // uncompleteTask restores, for the same reason.
    const masked = isQuotaTask(t)
      ? { ...t, completed: false, progressCount: Math.max(0, t.targetCount! - 1) }
      : { ...t, completed: false };
    heldMaskCache.set(t.id, { source: t, masked });
    return masked;
  });
}

// A daily target whose row is still playing out its send-off (see
// QUOTA_HOLD_BACKSTOP_MS) counts as on Today even though the pace gate has
// closed on it — and correspondingly isn't in Later yet, since the two lists
// are disjoint lenses and a task can't be waiting in one while it's still in
// the other.
function isQuotaHeld(task: Task, heldIds: string[]): boolean {
  if (heldIds.length === 0) return false;
  return (
    heldIds.includes(task.id) &&
    !task.parentId &&
    !task.completed &&
    !task.archived &&
    isQuotaTask(task)
  );
}

// O(n) task-array patch shared by every "apply a change to N ids" call site
// below, in place of the O(n*m) `ids.includes(t.id)` / `updates.find(...)`
// scan each site used to repeat inside its own `.map()` over all tasks.
// `patch` may be a function when the new fields depend on the task itself
// (e.g. bulkAddTags's merge).
function patchTasks(tasks: Task[], ids: string[], patch: Partial<Task> | ((t: Task) => Partial<Task>)): Task[] {
  if (ids.length === 0) return tasks;
  const idSet = new Set(ids);
  return tasks.map(t => {
    if (!idSet.has(t.id)) return t;
    return { ...t, ...(typeof patch === 'function' ? patch(t) : patch) };
  });
}

// Map variant for the reorder sites, where every id's patch (its new
// sortOrder) differs.
function patchTasksById(tasks: Task[], updates: Map<string, Partial<Task>>): Task[] {
  if (updates.size === 0) return tasks;
  return tasks.map(t => {
    const u = updates.get(t.id);
    return u ? { ...t, ...u } : t;
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
  // The subset of those rows that has been told to shrink away. Set in one
  // go once the burst settles, so every row completed in it closes its gap
  // together (see COMPLETION_COLLAPSE_MS) — TaskItem watches for its own id
  // appearing here and runs its height collapse then.
  completionCollapseIds: string[];
  // Ids of daily targets pinned to Today past the moment they went back on
  // pace, so the row can be tapped again — see QUOTA_HOLD_BACKSTOP_MS.
  quotaHoldIds: string[];

  initialize: () => void;
  // Marks a completion as animating so the batched collapse waits for it.
  // Called when the row's completion animation starts, i.e. a beat before the
  // completeTask that follows it.
  beginCompletionAnimation: (id: string) => void;
  // The same animation was cancelled (the user tapped the row again to take
  // the completion back) — stop holding the batch for it.
  cancelCompletionAnimation: (id: string) => void;
  sweepExpiredTasks: () => void;
  /** Deletes completions older than the retention window; returns how many went. */
  purgeOldCompletedTasks: () => number;
  addTask: (draft: Partial<TaskDraft>) => Task;
  duplicateTask: (id: string) => Task | null;
  // scope 'occurrence' ("this task only") applies `updates` to this row but
  // preserves whatever content-field values existed before the edit in
  // seriesDefaults, so the next occurrence (see completeTask) reverts to
  // them instead of carrying the one-off edit forward. Default ('series' /
  // omitted, "this and future tasks") is a plain patch, same as always.
  // With scope 'series' on a task that belongs to a dated series (see
  // Task.seriesId), content-field updates also fan out to the set's later
  // still-incomplete dates — "this and future tasks" means the same thing for
  // a series as it does for a recurrence, it just has real rows to write to.
  updateTask: (id: string, updates: Partial<Task>, options?: { scope?: 'occurrence' | 'series' }) => void;
  // Creates one row per date, all sharing a new seriesId. `monthDays`
  // non-empty makes the set repeat that many months later (see
  // Task.seriesMonthDays); pass [] for a set that happens once.
  addTaskSeries: (
    draft: Partial<TaskDraft>,
    dates: Date[],
    repeat?: { monthDays: number[]; repeatMonths: number },
  ) => Task[];
  // The editor's one entry point for a task's set of dates, whatever it is
  // now and whatever it's becoming: it creates a series around `taskId`,
  // reconciles an existing one, or dissolves it back to a plain single-date
  // task when the set drops to one. Reconciling adds rows for dates that
  // gained one and drops the still-incomplete rows for dates that lost one;
  // completed rows are never touched, since a date that already happened is
  // history rather than schedule.
  applyTaskDates: (
    taskId: string,
    dates: Date[],
    repeat?: { monthDays: number[]; repeatMonths: number },
  ) => void;
  /** Deletes the series' incomplete rows, leaving its completed history in the Logbook. */
  deleteSeries: (seriesId: string) => void;
  seriesRowsOf: (seriesId: string) => Task[];
  markTaskSeen: (id: string) => void;
  markTasksSeen: (ids: string[]) => void;
  setLastAction: (action: UndoableAction | null) => void;
  undoLastAction: () => void;
  deleteTask: (id: string) => void;
  completeTask: (id: string) => void;
  uncompleteTask: (id: string) => void;
  logQuotaUnit: (id: string) => void;
  unlogQuotaUnit: (id: string) => void;
  /** Keeps a back-on-pace daily target on Today until releaseQuotaHold. */
  holdQuotaOnToday: (id: string) => void;
  releaseQuotaHold: (id: string) => void;
  rolloverQuotas: () => void;
  deferTask: (id: string, until: Date) => void;
  // Applies a batch of approved "lighten this day" moves (see
  // utils/deloadPlan) under one undo entry — each move carries its own field
  // updates, since a recurring task defers while a one-off reschedules.
  deloadTasks: (moves: readonly { id: string; updates: Partial<Task> }[]) => void;
  // Applies a batch of approved "pull from projects" picks (see
  // utils/projectPull) under one undo entry — the mirror of deloadTasks, and
  // simpler because a pull candidate is undated, so there's no existing date to
  // protect and every move is a plain reschedule.
  pullProjectTasks: (moves: readonly { id: string; updates: Partial<Task> }[]) => void;
  // Layer B of the same feature: projects the user opted into auto-scheduling
  // date their own next task when they run dry. Idempotent by construction —
  // dating a member makes the project non-stalled, so a second call in the same
  // session finds nothing, exactly as rolloverQuotas' condition self-clears.
  dripStalledProjects: () => void;
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
  setCategoryTimeSegments: (category: string, segments: TimeOfDay[]) => number;
  startTimer: (id: string) => void;
  stopTimer: (id: string) => void;
  discardTimer: (id: string) => void;
  // Timed tasks only: pause banks the running segment without logging it, so
  // the countdown can be resumed later; reset throws the banked time away.
  pauseTimer: (id: string) => void;
  resetTimer: (id: string) => void;
  logManualTime: (id: string, minutes: number) => void;
  reorderTasks: (orderedIds: string[]) => void;
  // Explicit sortOrders rather than ids-in-order: the Today list's ranks are
  // shared with the stacks sitting in it (see resolveDrop), so the gaps a
  // stack leaves in the task numbering are load-bearing.
  reorderWithCategoryUpdates: (
    orders: Array<{ id: string; sortOrder: number }>,
    categoryUpdates: Array<{ id: string; category: string | null }>,
    options?: { scope?: 'occurrence' | 'series' },
  ) => void;

  addSubtask: (parentId: string, title: string) => Task;
  toggleSubtask: (id: string) => void;
  deleteSubtask: (id: string) => void;
  reorderSubtasks: (parentId: string, orderedIds: string[]) => void;

  groupChildrenOf: (groupId: string) => Task[];
  groupRosterOf: (groupId: string) => Task[];
  addNewGroupedTask: (groupId: string, title: string) => Task;
  addExistingToGroup: (taskId: string, groupId: string) => void;
  removeFromGroup: (taskId: string) => void;
  reorderGroupChildren: (groupId: string, orderedIds: string[]) => void;
  groupTasks: (taskIds: string[], title: string, category: string | null) => TaskGroup;
  /** Re-files the stack's live members under `category`; returns their prior values for undo. */
  applyGroupCategory: (groupId: string, category: string | null) => Array<{ id: string; category: string | null }>;
  completeGroup: (groupId: string) => void;
  uncompleteGroup: (groupId: string) => void;
  deferGroup: (groupId: string, until: Date) => void;
  pinGroup: (groupId: string) => void;
  deleteGroup: (groupId: string, opts: { cascade: boolean }) => void;

  addExistingToProject: (taskId: string, projectId: string) => void;
  removeFromProject: (taskId: string) => void;
  deleteProject: (projectId: string, opts: { cascade: boolean }) => void;
  // Archive/restore a project through here rather than through useProjectStore
  // directly — these are the ones that register an undo entry.
  archiveProject: (projectId: string) => void;
  unarchiveProject: (projectId: string) => void;

  deleteTemplate: (id: string) => void;

  forgivVacationStreaks: () => void;
  checkVacationExpiry: () => void;
  resetAllStreaks: () => void;
  bulkCompleteTasks: (ids: string[]) => void;
  bulkUncompleteTasks: (ids: string[]) => void;
  bulkDeleteTasks: (ids: string[]) => void;
  clearLogbook: () => void;
  bulkSetPriority: (ids: string[], priority: Priority) => void;
  bulkTogglePin: (ids: string[]) => void;
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
  waitingTasks: () => Task[];
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
  completionCollapseIds: [],
  quotaHoldIds: [],

  beginCompletionAnimation(id) {
    if (!pendingCompletionIds.includes(id)) pendingCompletionIds.push(id);
    if (completionCollapseTimer) clearTimeout(completionCollapseTimer);
    completionCollapseTimer = null;
  },

  cancelCompletionAnimation(id) {
    if (!pendingCompletionIds.includes(id)) return;
    pendingCompletionIds = pendingCompletionIds.filter(x => x !== id);
    armCompletionCollapse();
  },

  initialize() {
    initDatabase();
    useCategoryStore.getState().initialize();
    useTemplateStore.getState().initialize();
    useTaskGroupStore.getState().initialize();
    useProjectStore.getState().initialize();
    useProjectCategoryStore.getState().initialize();
    useTemplateCategoryStore.getState().initialize();
    const tasks = dbGetAllTasks();
    const tagRegistry = dbGetTagRegistry();

    set({ tasks, tagRegistry, initialized: true });
    rescheduleAllReminders(tasks);
  },

  // Must run after useSettingsStore.initialize() so autoRemoveExpiredTasks,
  // vacationMode and dayResetTime are the user's real values rather than
  // defaults — see App.tsx call order.
  sweepExpiredTasks() {
    if (!useSettingsStore.getState().autoRemoveExpiredTasks) return;
    const expired = get().tasks.filter(t => !t.parentId && isTaskExpired(t));
    if (expired.length === 0) return;

    // A recurring task's row *is* its schedule — the next occurrence only
    // comes into existence when this one is completed — so deleting the row
    // ends the series for good. Missing this morning's window is not "I'm
    // done with this habit", and a setting about tidying away time-limited
    // tasks must not quietly retire a daily one. An expired occurrence that
    // still has a next date is rolled forward onto it instead, which is what
    // skipNextRecurrence does when the user deals with an expired recurring
    // task by hand. Only rows with nothing after them are deleted: one-offs,
    // and series that have reached their recurrenceEndDate/recurrenceCount.
    const rolled = expired.filter(isLiveRecurring);
    const doomed = expired.filter(t => !isLiveRecurring(t));

    rolled.forEach(t => get().skipNextRecurrence(t.id));
    if (doomed.length > 0) get().bulkDeleteTasks(doomed.map(t => t.id));
  },

  // Enforces the "keep completed tasks for" window — the only thing that has
  // ever bounded the tombstone a completion leaves behind. Runs at startup
  // (after settings load, like sweepExpiredTasks) and again when the window
  // itself changes, so picking one acts on the backlog rather than only on
  // what happens to age out later.
  //
  // Deliberately does NOT go through bulkDeleteTasks: that arms shake-to-undo,
  // and a purge the user didn't just perform must not be sitting under their
  // first shake of the session waiting to be reversed. Everything else about
  // the delete is the same, including the subtask cascade dbBulkDeleteTasks
  // does in SQL — minus the reminder cancels, which have nothing to cancel
  // here: completeTask already cancelled this row's, and upcomingReminders
  // filters completed tasks out of every reschedule since.
  purgeOldCompletedTasks() {
    const { completedRetentionDays, dayResetTime } = useSettingsStore.getState();
    const cutoff = retentionCutoff(completedRetentionDays, new Date(), dayResetTime);
    if (!cutoff) return 0;

    const ids = selectPurgeableTaskIds(get().tasks, cutoff);
    if (ids.length === 0) return 0;
    const idSet = new Set(ids);

    dbBulkDeleteTasks(ids);
    set(s => ({
      tasks: s.tasks.filter(t => !idSet.has(t.id) && (t.parentId === null || !idSet.has(t.parentId))),
    }));
    return ids.length;
  },

  addTask(draft) {
    const now = new Date().toISOString();
    const maxOrder = get().tasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    const task = newTaskFromDraft(draft, now, maxOrder + 1, true);
    dbInsertTask(task);
    set(s => ({ tasks: [...s.tasks, task] }));
    scheduleTaskReminder(task);
    return task;
  },

  addTaskSeries(draft, dates, repeat) {
    const sorted = [...dates].sort((a, b) => +a - +b);
    if (sorted.length === 0) return [];

    const seriesId = generateId();
    const now = new Date().toISOString();
    let order = get().tasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);

    const rows = sorted.map(date => {
      order += 1;
      return {
        ...buildSeriesRow(draft, date, seriesId, repeat, true),
        createdAt: now,
        seenAt: now,
        sortOrder: order,
      };
    });

    rows.forEach(row => {
      dbInsertTask(row);
      scheduleTaskReminder(row);
    });
    set(s => ({ tasks: [...s.tasks, ...rows] }));
    return rows;
  },

  seriesRowsOf(seriesId) {
    return get().tasks.filter(t => t.seriesId === seriesId && !t.parentId);
  },

  applyTaskDates(taskId, dates, repeat) {
    const anchor = get().tasks.find(t => t.id === taskId);
    if (!anchor) return;

    const sorted = [...dates].sort((a, b) => +a - +b);
    const monthDays = repeat?.monthDays ?? [];
    const repeatMonths = repeat?.repeatMonths ?? 1;

    // One date or none isn't a series. If this task was in one, the rest of
    // the set goes away and the row becomes an ordinary dated task again —
    // except for its completed dates, which are history and stay put, just
    // unfiled from a series that no longer exists.
    if (sorted.length <= 1) {
      if (!anchor.seriesId) {
        get().updateTask(taskId, { dueDate: sorted[0]?.toISOString() ?? anchor.dueDate });
        return;
      }
      const others = get().seriesRowsOf(anchor.seriesId).filter(t => t.id !== taskId);
      const dropped = others.filter(t => !t.completed && !t.archived);
      const unfiled = others
        .filter(t => t.completed || t.archived)
        .map(t => ({ ...t, seriesId: null, seriesMonthDays: [], seriesRepeatMonths: 1 }));

      dropped.forEach(t => {
        dbDeleteSubtasks(t.id);
        dbDeleteTask(t.id);
        cancelTaskReminder(t.id);
      });
      unfiled.forEach(dbUpdateTask);

      const droppedIds = new Set(dropped.map(t => t.id));
      const unfiledById = new Map(unfiled.map(t => [t.id, t]));
      set(s => ({
        tasks: s.tasks
          .filter(t => !droppedIds.has(t.id) && !(t.parentId && droppedIds.has(t.parentId)))
          .map(t => unfiledById.get(t.id) ?? t),
      }));
      get().updateTask(taskId, {
        dueDate: sorted[0]?.toISOString() ?? anchor.dueDate,
        seriesId: null,
        seriesMonthDays: [],
        seriesRepeatMonths: 1,
      });
      return;
    }

    // Two or more dates: the anchor takes the series id, whether it's already
    // in a series or is a plain task being given extra dates for the first
    // time. It keeps its own date whenever that date survived the edit — the
    // row the user has open shouldn't silently become a different date, and
    // moving it would also make the reconcile below read it as dropped and
    // delete it. Only a row whose date was edited away gets repointed.
    const seriesId = anchor.seriesId ?? generateId();
    const anchorDay = anchor.dueDate ? calendarDayKey(new Date(anchor.dueDate)) : null;
    const anchorKept = anchorDay !== null && sorted.some(d => calendarDayKey(d) === anchorDay);
    get().updateTask(taskId, {
      dueDate: anchorKept ? anchor.dueDate : sorted[0].toISOString(),
      seriesId,
      seriesMonthDays: monthDays,
      seriesRepeatMonths: repeatMonths,
      // The anchor gives up its recurrence rule along with the rows cloned
      // from it — the dates are the schedule now (see NO_RECURRENCE).
      ...NO_RECURRENCE,
    });

    const rows = get().seriesRowsOf(seriesId);
    if (rows.length === 0) return;

    // New rows clone the row the user was actually editing, so a title or
    // category changed in the same save reaches the dates added by it.
    const template = rows.find(t => t.id === taskId) ?? rows.find(t => !t.completed) ?? rows[0];

    // Completed rows hold their date permanently — they're a record of a day
    // that happened, so they neither get rewritten nor count as a date the
    // set still owes. Everything below reconciles the incomplete rows only.
    //
    // Archived rows are held the same way, and for a sharper reason: they used
    // to count as live, so editing the dates deleted one outright when its date
    // was dropped from the set — filed-away data destroyed by an unrelated
    // edit. And when its date was *kept*, the archived row satisfied it, so the
    // set ended up with nothing actionable on a day the user had just asked
    // for. Excluded from `live` here, they're neither deleted nor counted, and
    // a kept date gets a real row of its own alongside them.
    const wanted = new Map(sorted.map(d => [calendarDayKey(d), d]));
    const live = rows.filter(t => !t.completed && !t.archived);

    const kept: Task[] = [];
    const removed: Task[] = [];
    for (const row of live) {
      const key = row.dueDate ? calendarDayKey(new Date(row.dueDate)) : null;
      if (key !== null && wanted.has(key)) {
        wanted.delete(key);
        kept.push(row);
      } else {
        removed.push(row);
      }
    }

    let order = get().tasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    const added = Array.from(wanted.values())
      .sort((a, b) => +a - +b)
      .map(date => {
        order += 1;
        return { ...buildSeriesRow(template, date, seriesId, repeat), sortOrder: order };
      });

    // The repeat rule lives on every row of the set (they share one schedule),
    // so a change to it has to reach the rows that already existed too.
    const rewritten = [...kept, ...rows.filter(t => t.completed || t.archived)].map(t => ({
      ...t,
      seriesMonthDays: monthDays,
      seriesRepeatMonths: repeatMonths,
    }));

    removed.forEach(t => {
      dbDeleteSubtasks(t.id);
      dbDeleteTask(t.id);
      cancelTaskReminder(t.id);
    });
    added.forEach(t => {
      dbInsertTask(t);
      scheduleTaskReminder(t);
    });
    rewritten.forEach(dbUpdateTask);

    const removedIds = new Set(removed.map(t => t.id));
    const rewrittenById = new Map(rewritten.map(t => [t.id, t]));
    set(s => ({
      tasks: [
        ...s.tasks
          .filter(t => !removedIds.has(t.id) && !(t.parentId && removedIds.has(t.parentId)))
          .map(t => rewrittenById.get(t.id) ?? t),
        ...added,
      ],
    }));
  },

  deleteSeries(seriesId) {
    const live = get().seriesRowsOf(seriesId).filter(t => !t.completed);
    if (live.length === 0) return;
    const subtasks = live.flatMap(t => get().subtasksOf(t.id));
    const ids = new Set(live.map(t => t.id));

    live.forEach(t => {
      dbDeleteSubtasks(t.id);
      dbDeleteTask(t.id);
      cancelTaskReminder(t.id);
    });
    set(s => ({ tasks: s.tasks.filter(t => !ids.has(t.id) && !(t.parentId && ids.has(t.parentId))) }));

    get().setLastAction({
      label: live.length === 1 ? 'Task deleted' : `${live.length} dates deleted`,
      undo: () => {
        [...live, ...subtasks].forEach(t => {
          dbInsertTask(t);
          scheduleTaskReminder(t);
        });
        set(s => ({ tasks: [...s.tasks, ...live, ...subtasks] }));
      },
    });
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
      // The duplicate keeps the duration but starts its countdown fresh.
      timerElapsedSeconds: 0,
      previousOccurrenceId: null,
      seriesId: null,
      seriesMonthDays: [],
      seriesRepeatMonths: 1,
      seriesDefaults: null,
      archived: false,
      archivedAt: null,
      chainIndex: 0, // a duplicate starts a chain fresh, not mid-way through the original
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
      if (
        'reminderTime' in updates ||
        'reminderKind' in updates ||
        'completed' in updates ||
        'archived' in updates ||
        'title' in updates ||
        'notes' in updates
      ) {
        cancelTaskReminder(id);
        scheduleTaskReminder(updated);
      }
      // Archiving out from under a running countdown would otherwise leave its
      // alarm to fire for a task the user can no longer see.
      if (updated.archived && updated.timerStartedAt !== null) cancelTimerAlarm(id);
      return updated;
    });
    set({ tasks });

    // "This and future tasks" on a dated series has real rows to write to
    // rather than a next occurrence that doesn't exist yet, so the same
    // content fields are pushed onto the set's later still-incomplete dates.
    // Only CONTENT_FIELDS: dueDate and the series' own fields are per-row or
    // per-set and would flatten the whole schedule onto one day.
    const edited = get().tasks.find(t => t.id === id);
    if (scope === 'series' && edited?.seriesId) {
      const fanOut: Partial<Task> = {};
      for (const key of CONTENT_FIELDS) {
        if (key in updates) captureField(fanOut, edited, key);
      }
      if (Object.keys(fanOut).length > 0) {
        const from = edited.dueDate ? +new Date(edited.dueDate) : -Infinity;
        const siblings = get().tasks.filter(
          t => t.seriesId === edited.seriesId &&
            t.id !== id &&
            !t.completed &&
            !t.archived &&
            (t.dueDate ? +new Date(t.dueDate) > from : false)
        );
        if (siblings.length > 0) {
          const patched = siblings.map(t => ({
            ...t,
            ...fanOut,
            // reminderTime is absolute; every date keeps its own instant at
            // the edited time of day rather than inheriting this row's.
            ...('reminderTime' in fanOut
              ? { reminderTime: reanchorReminder(fanOut.reminderTime ?? null, new Date(t.dueDate!)) }
              : {}),
            // A set shares one blocker, but no row can wait on itself. Picking
            // a later date of this same set as the blocker would otherwise
            // hand that row a pointer at its own id, and a task waiting on
            // itself is invisible everywhere and can never be unblocked by
            // anything the user does to another task. wouldCycle() guards the
            // picker against exactly this; the fan-out doesn't go through it,
            // so it re-checks here and leaves that one row's blocker alone.
            ...('blockedById' in fanOut && fanOut.blockedById === t.id
              ? { blockedById: t.blockedById }
              : {}),
          }));
          patched.forEach(t => {
            dbUpdateTask(t);
            cancelTaskReminder(t.id);
            scheduleTaskReminder(t);
          });
          const byId = new Map(patched.map(t => [t.id, t]));
          set(s => ({ tasks: s.tasks.map(t => byId.get(t.id) ?? t) }));
        }
      }
    }
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
    set(s => ({ tasks: patchTasks(s.tasks, ids, { seenAt: now }) }));
  },

  setLastAction(action) {
    set({ lastAction: action ? { ...action, at: Date.now() } : null });
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
    if (task.timerStartedAt !== null) cancelTimerAlarm(id);
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
    // The row's animation is over whatever this call decides, so release it
    // from the collapse batch before the guards below — a completion that
    // turns out to be a no-op would otherwise hold the batch down for good.
    // Arming here is harmless in the normal case: the call at the end re-arms
    // the same timer once the hold is set up.
    if (pendingCompletionIds.includes(id)) {
      pendingCompletionIds = pendingCompletionIds.filter(x => x !== id);
      armCompletionCollapse();
    }
    let task = get().tasks.find(t => t.id === id);
    if (!task || task.completed) return;
    // Recurring tasks shown early in Later (deferred to, or due on, a future
    // day) can't be completed ahead of schedule — doing so would generate the
    // next occurrence off today instead of the task's real day. Non-recurring
    // tasks have no such next-occurrence math, so early completion is fine.
    if (isRecurrenceNotYetDue(task)) return;

    // If a timer is still running — or a countdown was paused with time banked
    // on it — stop it first so the session's time is saved.
    if (task.timerStartedAt !== null || task.timerElapsedSeconds > 0) {
      get().stopTimer(id);
      task = get().tasks.find(t => t.id === id)!;
    }

    const now = new Date();
    const { dayResetTime } = useSettingsStore.getState();

    const recurs = task.recurrenceType !== 'none';
    const chainAdvances = task.chainEnabled && task.chainItems.length > 0;
    const atChainEnd = chainAdvances && task.chainIndex >= task.chainItems.length - 1;
    // A chain is a singly linked list of steps: completing one immediately
    // creates the next, with no schedule needed, and it simply ends after
    // the last step. Repeat changes only what happens at that last step —
    // instead of ending, the whole chain loops back to the first item on
    // the recurrence's schedule. A chain with no Repeat set never spawns
    // past its last item; a plain recurring task with no chain just keeps
    // recurring on schedule as always. So the recurrence's own schedule
    // (streak, recurrenceCount, getNextDueDate) only ever applies once per
    // cycle — at the last step of a repeating chain, or on every completion
    // of a plain recurring task with no chain at all — never on a mid-chain
    // step, which always advances immediately.
    const advancesBySchedule = !chainAdvances || atChainEnd;

    // Calculate streak — see getStreakOutcome for the cadence-aware gap check (#691).
    let newStreakCount = 1;
    if (recurs && advancesBySchedule && task.streakDate) {
      const outcome = getStreakOutcome(task, dayResetTime);
      if (outcome === 'same-day') {
        newStreakCount = task.streakCount;
      } else if (outcome === 'continued') {
        newStreakCount = task.streakCount + 1;
      }
      // else 'reset': missed too many cadence units → reset to 1 (already set above)
    }

    const streakAdvances = recurs && advancesBySchedule;
    const completed: Task = {
      ...task,
      completed: true,
      completedAt: now.toISOString(),
      // Pin is cleared once the completion hold below expires, not
      // immediately — otherwise a pinned row would vanish from the Pinned
      // section instantly instead of getting the same fade-out grace period
      // every other list gives a completed task.
      streakCount: streakAdvances ? newStreakCount : task.streakCount,
      streakDate: streakAdvances ? getCurrentDayStart().toISOString() : task.streakDate,
      previousStreakCount: task.streakCount,
      previousStreakDate: task.streakDate,
      // Completing a quota task outright (the last unit, a swipe, a bulk
      // action) means the whole quota is done, so the row reads 8/8 rather
      // than being logged as a partial (see isQuotaPartial).
      progressCount: isQuotaTask(task) ? task.targetCount! : task.progressCount,
    };
    if (task.pinned) pendingUnpinIds.push(id);
    dbUpdateTask(completed);

    cancelTaskReminder(id);

    let nextTask: Task | null = null;
    let nextSubtasks: Task[] = [];
    const spawnsNext = chainAdvances ? (recurs || !atChainEnd) : recurs;
    if (spawnsNext) {
      // The recurrence's schedule only decides the date at the point it
      // actually applies (see advancesBySchedule above) — everywhere else
      // there's no date to compute.
      const nextDue = recurs && advancesBySchedule ? getNextDueDate(task, dayResetTime) : null;
      // Skip the spawn only when we actually consulted the schedule and it
      // says the series has ended — a mid-chain step never consults it, so
      // it always spawns regardless of recurrenceEndDate/recurrenceCount.
      if (!advancesBySchedule || nextDue !== null) {
        // A "this task only" edit (see updateTask) stores what content fields
        // should revert to for the next occurrence in seriesDefaults — apply
        // it before spreading so the clone below reflects the series' real
        // values, not a one-off edit made on this occurrence.
        const effective: Task = { ...task, ...(task.seriesDefaults ?? {}) };
        // A mid-chain step carries no schedule of its own, so it only gets a
        // date when the step it's replacing had one — preserving placement
        // rather than always dating (which would drop a fully undated chain's
        // steps into having dates, and would drop a dated chain's steps out
        // of view entirely once they lost theirs — see isTaskVisible).
        //
        // Accepted trade-off: getNextDueDate's fixed-schedule anchor
        // (dateUtils.ts) reads the last step's own dueDate, which is now
        // "today" (whatever day that step happened to be completed) rather
        // than the cycle's original schedule-anchored date. For the normal
        // case — a chain finished in one sitting, same day it started — this
        // anchors identically to the old fixed schedule. A chain left
        // mid-way across a day boundary drifts the grid forward to the
        // completion day instead, i.e. behaves like recurrenceFromCompletion
        // for that cycle. Chosen deliberately over adding a separate
        // cycle-anchor field, which no other part of the schema needs.
        const midChainDue =
          chainAdvances && !advancesBySchedule && !hasNoDateSignal(task)
            ? (() => { const d = getCurrentDayStart(); d.setHours(12, 0, 0, 0); return d; })()
            : null;
        const effectiveDue = nextDue ?? midChainDue;
        let nextReminderTime: string | null = effective.reminderTime;
        if (effectiveDue && effective.reminderTime) {
          const original = new Date(effective.reminderTime);
          const next = new Date(effectiveDue);
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
          !effectiveDue ? null
          : effective.deadlineOffsetDays !== null
            ? getDeadlineFromOffset(effectiveDue, effective.deadlineOffsetDays).toISOString()
          : effective.deadlineMonthDay !== null
            ? getDeadlineFromMonthDay(effectiveDue, effective.deadlineMonthDay).toISOString()
            : null;
        nextTask = {
          ...effective,
          id: generateId(),
          completed: false,
          completedAt: null,
          createdAt: now.toISOString(),
          seenAt: now.toISOString(),
          dueDate: effectiveDue ? effectiveDue.toISOString() : null,
          deadline: nextDeadline,
          deferUntil: null,
          pinned: false, // pin resets on new occurrence
          progressCount: 0, // a quota starts the new day empty
          streakCount: streakAdvances ? newStreakCount : task.streakCount,
          streakDate: streakAdvances ? getCurrentDayStart().toISOString() : task.streakDate,
          previousStreakCount: task.streakCount,
          previousStreakDate: task.streakDate,
          reminderTime: nextReminderTime,
          chainIndex: nextChainIndex,
          recurrenceCount:
            advancesBySchedule && task.recurrenceCount !== null ? task.recurrenceCount - 1 : task.recurrenceCount,
          timerStartedAt: null, // fresh occurrence isn't running; actualMinutes/estimate carry via ...effective
          timerElapsedSeconds: 0, // countdown restarts from the top; timedMinutes carries via ...effective
          // vacationPause carries over so recurring tasks stay paused across occurrences
          // blockedById carries via ...effective too, and harmlessly: for this
          // occurrence to have been completed its blocker was already done, so
          // the new row inherits a pointer at a completed task and isn't blocked.
          previousOccurrenceId: task.id, // lets uncompleting `task` remove this occurrence again
          seriesDefaults: null, // fresh occurrence starts with no pending "this task only" overrides
          // A spawned row is never one of the dates the user picked. Since a
          // series carries no recurrence rule (see NO_RECURRENCE), the only
          // way to get here from a series row is mid-chain — and a chain step
          // spawns onto the *same day* it was completed, so inheriting the
          // seriesId put a second row on a date the set already had. The next
          // date edit reconciles by calendar day, so it deleted one of them
          // and the chain's position went with it.
          seriesId: null,
          seriesMonthDays: [],
          seriesRepeatMonths: 1,
        };
        dbInsertTask(nextTask);
        scheduleTaskReminder(nextTask);

        // Subtasks belong to the series, not a single occurrence — carry them
        // onto the fresh occurrence the same way duplicateTask does, reset to
        // unchecked (a subtask always starts unchecked — see TemplateItem.subtasks).
        // Chains spawn a new row on every step, so without this a chained
        // task's subtasks would vanish after the first step.
        nextSubtasks = get().subtasksOf(task.id).map(sub => ({
          ...sub,
          id: generateId(),
          parentId: nextTask!.id,
          completed: false,
          completedAt: null,
          createdAt: now.toISOString(),
          seenAt: now.toISOString(),
        }));
        nextSubtasks.forEach(sub => {
          dbInsertTask(sub);
          scheduleTaskReminder(sub);
        });
      }
    }

    // A repeating dated series rolls over as a whole set, not row by row:
    // the next month's dates appear only once every date in the current set
    // is done, so ticking off the 10th doesn't conjure a third row while the
    // 15th is still outstanding. Order-independent — whichever date you
    // finish last is the one that triggers it. Series rows carry
    // recurrenceType 'none' (enforced by NO_RECURRENCE, since the editor will
    // happily save a repeat rule alongside extra dates), so the recurrence
    // spawn above can never run on the same completion as this.
    const rolledOver: Task[] = [];
    if (task.seriesId && task.seriesMonthDays.length > 0) {
      const siblings = get().tasks.filter(
        t => t.seriesId === task.seriesId && !t.parentId && t.id !== id
      );
      const setComplete = siblings.every(t => t.completed || t.archived);
      if (setComplete) {
        const dueDates = [...siblings, completed]
          .filter(t => t.dueDate)
          .map(t => new Date(t.dueDate!));
        const nextDates = getNextSeriesDates(dueDates, task.seriesMonthDays, task.seriesRepeatMonths);
        let order = get().tasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
        for (const date of nextDates) {
          order += 1;
          const row = {
            ...buildSeriesRow(
              { ...task, ...(task.seriesDefaults ?? {}) },
              date,
              task.seriesId,
              { monthDays: task.seriesMonthDays, repeatMonths: task.seriesRepeatMonths },
            ),
            sortOrder: order,
            // Linked to the completion that produced it, exactly as a
            // recurrence's next occurrence is, so undoing that completion
            // takes the next set back out with it (see uncompleteTask).
            previousOccurrenceId: id,
          };
          dbInsertTask(row);
          scheduleTaskReminder(row);
          rolledOver.push(row);
        }
      }
    }

    set(s => ({
      tasks: [
        ...s.tasks.map(t => (t.id === id ? completed : t)),
        ...(nextTask ? [nextTask] : []),
        ...nextSubtasks,
        ...rolledOver,
      ],
      completionHoldIds: [...s.completionHoldIds, id],
      // A daily target that completes mid-hold hands over to the completion
      // hold, which masks it as incomplete for its own window. Leaving it in
      // both would keep the finished row on Today past that.
      quotaHoldIds: s.quotaHoldIds.filter(x => x !== id),
    }));

    // Opt-in convenience only (autoArchiveProjectsOnComplete, default off) —
    // finishing a project never happens automatically otherwise; the user
    // decides when a 100%-complete project actually gets archived. It rides on
    // the completion's own undo instead of setting its own entry: it wasn't a
    // separate action the user took, so undoing the tick has to take it back.
    let autoArchivedProjectId: string | null = null;
    if (task.projectId && useSettingsStore.getState().autoArchiveProjectsOnComplete) {
      const progress = projectProgress(task.projectId, get().tasks);
      const project = useProjectStore.getState().getProjectById(task.projectId);
      if (progress.total > 0 && progress.done === progress.total && project && !project.archived) {
        useProjectStore.getState().applyProjectArchived(task.projectId, true);
        autoArchivedProjectId = task.projectId;
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
        completionCollapseIds: [],
        tasks: stillPinnedIds.length > 0
          ? s.tasks.map(t => (stillPinnedIds.includes(t.id) ? { ...t, pinned: false } : t))
          : s.tasks,
      }));
    }, COMPLETION_HOLD_MS);
    // Node (tests) returns a Timeout with unref(); React Native's timer is a
    // plain number without it — don't keep a test process alive over this.
    (completionHoldTimer as unknown as { unref?: () => void }).unref?.();
    armCompletionCollapse();

    get().setLastAction({
      label: 'Task completed',
      undo: () => {
        if (autoArchivedProjectId) {
          useProjectStore.getState().applyProjectArchived(autoArchivedProjectId, false);
        }
        get().uncompleteTask(id);
      },
    });
  },

  uncompleteTask(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || !task.completed) return;
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
      // A re-opened quota task sits one unit short of its target rather than
      // at a completed-looking 8/8 — undoing the last glass leaves you at 7/8.
      progressCount: isQuotaTask(task) ? Math.max(0, task.targetCount! - 1) : task.progressCount,
    };
    dbUpdateTask(updated);

    // Completing a recurring task spawns a fresh next occurrence. Undoing
    // that completion means it never happened, so the occurrence it
    // generated shouldn't exist either — unless the user has since
    // completed it themselves, in which case it's a real completion.
    //
    // Plural because a repeating dated series rolls over as a *set*: finishing
    // its last outstanding date inserts every date of the next set at once
    // (see completeTask). Matching only the first left next month on the board
    // after the completion that conjured it had been taken back.
    const followUps = get().tasks.filter(t => t.previousOccurrenceId === id && !t.completed);
    const followUpIds = new Set(followUps.map(f => f.id));
    const followUpSubtasks = followUps.flatMap(f => get().subtasksOf(f.id));
    followUps.forEach(f => {
      dbDeleteSubtasks(f.id);
      dbDeleteTask(f.id);
      cancelTaskReminder(f.id);
    });

    set(s => ({
      tasks: s.tasks
        .filter(t => !followUpIds.has(t.id) && !(t.parentId && followUpIds.has(t.parentId)))
        .map(t => (t.id === id ? updated : t)),
      completionHoldIds: s.completionHoldIds.filter(x => x !== id),
      completionCollapseIds: s.completionCollapseIds.filter(x => x !== id),
    }));

    // Un-completing a task (e.g. from the Logbook) is itself undoable via
    // shake-to-undo — this restores the exact prior completed state rather
    // than re-running completeTask, which would recompute streak/dueDate
    // off "now" instead of reproducing what was actually undone.
    get().setLastAction({
      label: 'Task uncompleted',
      undo: () => {
        dbUpdateTask(original);
        [...followUps, ...followUpSubtasks].forEach(t => {
          dbInsertTask(t);
          scheduleTaskReminder(t);
        });
        set(s => ({
          tasks: [
            ...s.tasks.map(t => (t.id === id ? original : t)),
            ...followUps,
            ...followUpSubtasks,
          ],
        }));
      },
    });
  },

  logQuotaUnit(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.completed || !isQuotaTask(task)) return;
    // The unit that reaches the target isn't a count bump, it's a completion —
    // hand off so recurrence, streaks, reminders and the Logbook all run
    // exactly as they do for any other task.
    if (task.progressCount + 1 >= task.targetCount!) {
      get().completeTask(id);
      return;
    }
    const updated = { ...task, progressCount: task.progressCount + 1 };
    dbUpdateTask(updated);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? updated : t)) }));
    get().setLastAction({
      label: 'Logged',
      undo: () => get().unlogQuotaUnit(id),
    });
  },

  unlogQuotaUnit(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || !isQuotaTask(task) || task.progressCount === 0) return;
    const updated = { ...task, progressCount: task.progressCount - 1 };
    dbUpdateTask(updated);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? updated : t)) }));
  },

  holdQuotaOnToday(id) {
    if (!get().quotaHoldIds.includes(id)) {
      set(s => ({ quotaHoldIds: [...s.quotaHoldIds, id] }));
    }
    // One timer for all of them, pushed back by each new hold, exactly as the
    // completion hold does — it's a leak catcher, not the thing that ends a
    // hold, so it doesn't need to be per-id.
    if (quotaHoldTimer) clearTimeout(quotaHoldTimer);
    quotaHoldTimer = setTimeout(() => {
      quotaHoldTimer = null;
      set({ quotaHoldIds: [] });
    }, QUOTA_HOLD_BACKSTOP_MS);
    (quotaHoldTimer as unknown as { unref?: () => void }).unref?.();
  },

  releaseQuotaHold(id) {
    if (!get().quotaHoldIds.includes(id)) return;
    set(s => ({ quotaHoldIds: s.quotaHoldIds.filter(x => x !== id) }));
  },

  // Close out quota occurrences left unfinished when their day ended. A quota
  // task only completes itself by reaching its target, so a day you fall short
  // on would otherwise leave the occurrence sitting overdue forever and the
  // series never advancing. Each stale one is logged as a partial record (the
  // count is kept, so isQuotaPartial can tell 5/8 from 8/8), its streak breaks,
  // and a fresh occurrence starts today at zero.
  //
  // Called on foreground and at startup rather than on a timer — like
  // checkVacationExpiry, it's "time passed while we weren't looking" cleanup,
  // and the app may have been closed for days.
  rolloverQuotas() {
    const { dayResetTime } = useSettingsStore.getState();
    const todayStart = getCurrentDayStart();
    const stale = get().tasks.filter(t =>
      isQuotaTask(t) &&
      !t.completed &&
      !t.archived &&
      // A quota with no repeat has no next day to reset into — it's a one-off
      // ("read 8 chapters"), so it stays overdue like any other undone task
      // rather than being closed out and silently re-spawned as a habit.
      t.recurrenceType !== 'none' &&
      // Vacation-paused tasks are protected from streak loss by design.
      !isHiddenForVacation(t) &&
      t.dueDate !== null &&
      getTaskDayStart(new Date(t.dueDate), dayResetTime) < todayStart
    );
    if (stale.length === 0) return;

    const closed: Task[] = [];
    const spawned: Task[] = [];
    const now = new Date().toISOString();
    for (const task of stale) {
      // Stamped at the end of the day it belonged to, not now — the partial
      // is a record of *that* day, and the Logbook groups by completedAt.
      const ownDayEnd = new Date(+getTaskDayStart(new Date(task.dueDate!), dayResetTime) + 24 * 60 * 60 * 1000 - 1);
      closed.push({
        ...task,
        completed: true,
        completedAt: ownDayEnd.toISOString(),
        // progressCount deliberately left as-is — that's the record.
        streakCount: 0,
        streakDate: null,
        previousStreakCount: task.streakCount,
        previousStreakDate: task.streakDate,
      });
      // A series that has run out (recurrenceEndDate/recurrenceCount) gets the
      // partial record but no successor — the schedule is consulted only for
      // *whether* it continues, since its answer for *when* would still be in
      // the past if the app sat closed for a week.
      if (getNextDueDate(task, dayResetTime) === null) continue;
      const nextDue = new Date(todayStart);
      nextDue.setHours(12, 0, 0, 0);
      const effective: Task = { ...task, ...(task.seriesDefaults ?? {}) };
      spawned.push({
        ...effective,
        id: generateId(),
        completed: false,
        completedAt: null,
        createdAt: now,
        seenAt: now,
        dueDate: nextDue.toISOString(),
        deferUntil: null,
        pinned: false,
        progressCount: 0,
        streakCount: 0,
        streakDate: null,
        previousStreakCount: 0,
        previousStreakDate: null,
        timerStartedAt: null,
        previousOccurrenceId: task.id,
        seriesDefaults: null,
      });
    }

    closed.forEach(dbUpdateTask);
    spawned.forEach(t => {
      dbInsertTask(t);
      scheduleTaskReminder(t);
    });
    const closedById = new Map(closed.map(t => [t.id, t]));
    set(s => ({
      tasks: [...s.tasks.map(t => closedById.get(t.id) ?? t), ...spawned],
    }));
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

  // A batch of approved deload moves. Each carries its own updates because the
  // mechanism differs per task — a recurring task gets deferUntil so its
  // schedule grid stays anchored, a one-off gets a real new dueDate (see
  // deloadUpdates in utils/deloadPlan). Snapshots are taken before anything is
  // written so the whole sweep undoes as one action rather than N toasts.
  deloadTasks(moves) {
    const byId = new Map(get().tasks.map(t => [t.id, t]));
    const applied = moves.filter(m => byId.has(m.id));
    if (applied.length === 0) return;

    const snapshots = applied.map(m => {
      const t = byId.get(m.id)!;
      return { id: m.id, dueDate: t.dueDate, deferUntil: t.deferUntil };
    });

    dbTransaction(() => {
      applied.forEach(m => get().updateTask(m.id, m.updates));
    });

    get().setLastAction({
      label: `${applied.length} task${applied.length === 1 ? '' : 's'} moved`,
      undo: () => snapshots.forEach(s =>
        get().updateTask(s.id, { dueDate: s.dueDate, deferUntil: s.deferUntil })
      ),
    });
  },

  pullProjectTasks(moves) {
    const byId = new Map(get().tasks.map(t => [t.id, t]));
    const applied = moves.filter(m => byId.has(m.id));
    if (applied.length === 0) return;

    const snapshots = applied.map(m => {
      const t = byId.get(m.id)!;
      return { id: m.id, dueDate: t.dueDate, deferUntil: t.deferUntil };
    });

    dbTransaction(() => {
      applied.forEach(m => get().updateTask(m.id, m.updates));
    });

    get().setLastAction({
      label: `${applied.length} task${applied.length === 1 ? '' : 's'} pulled in`,
      undo: () => snapshots.forEach(s =>
        get().updateTask(s.id, { dueDate: s.dueDate, deferUntil: s.deferUntil })
      ),
    });
  },

  dripStalledProjects() {
    const projects = useProjectStore.getState().projects.filter(p => p.autoSchedule);
    if (projects.length === 0) return;

    const tasks = get().tasks;
    const picks = projects
      .map(p => {
        const task = dripCandidate(p, tasks);
        if (!task) return null;
        // Today, not a suggested future day: the whole point is that an
        // opted-in project puts its next thing in front of you without being
        // asked, and a date a week out would leave it invisible until then.
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        return { id: task.id, updates: projectPullUpdates(today) };
      })
      .filter((p): p is { id: string; updates: Partial<Task> } => p !== null);

    if (picks.length === 0) return;

    dbTransaction(() => {
      picks.forEach(p => get().updateTask(p.id, p.updates));
    });

    // Deliberately no setLastAction: an unattended background write must not
    // occupy the undo slot for an action the user never saw. It surfaces
    // through machinery that already exists instead — the newly dated task has
    // an old seenAt and a dueDate of today, so isTaskNew is true and it shows
    // up in the existing NewTasksBanner with a new dot.
  },

  skipNextRecurrence(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.recurrenceType === 'none') return;
    // Mirror completeTask's advancesBySchedule split: a mid-chain step never
    // consults the recurrence schedule, so skipping one should only move the
    // chain position — pushing dueDate/recurrenceCount here would burn a full
    // cycle of the recurrence on a step that isn't scheduled at all.
    const chainAdvances = task.chainEnabled && task.chainItems.length > 0;
    const atChainEnd = chainAdvances && task.chainIndex >= task.chainItems.length - 1;
    if (chainAdvances && !atChainEnd) {
      get().updateTask(id, { chainIndex: task.chainIndex + 1 });
      return;
    }
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
    const nextChainIndex = chainAdvances ? 0 : task.chainIndex;
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
    // Archiving unpins, so the undo has to put the pin back — otherwise
    // undoing lands the task back on the list without the pin it had.
    const pinned = task.pinned;
    get().updateTask(id, { archived: true, archivedAt: new Date().toISOString(), pinned: false });
    get().setLastAction({
      label: 'Task archived',
      undo: () => get().updateTask(id, { archived: false, archivedAt: null, pinned }),
    });
  },

  unarchiveTask(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || !task.archived) return;
    // Resuming is lossy — it breaks the streak and drops the archived-on
    // stamp — so the undo restores those exact values rather than re-archiving
    // from scratch, which would stamp today and leave the streak at 0.
    const { archivedAt, streakCount, streakDate } = task;
    get().updateTask(id, {
      archived: false,
      archivedAt: null,
      streakCount: 0,
      streakDate: null,
    });
    get().setLastAction({
      label: 'Task resumed',
      undo: () => get().updateTask(id, { archived: true, archivedAt, streakCount, streakDate }),
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
    set(s => ({ tasks: patchTasks(s.tasks, ids, { pinned: nextPinned }) }));
  },

  // Moves every live task in a category to a time-of-day in one act, and
  // returns how many it touched. This is the retroactive half of
  // Category.defaultTimeSegments: the default only seeds tasks created after
  // it was set, so without this, switching an "Evening tasks" category to
  // night still means opening the eight tasks already in it one at a time.
  //
  // Scoped through tasksByCategory, so it reaches exactly the rows the
  // category screen lists — no completed occurrences (a task finished last
  // night happened in the evening and always will), no archived rows, no
  // subtasks (they aren't independently scheduled, and their parent carries
  // the segment).
  setCategoryTimeSegments(category, segments) {
    const targets = get().tasksByCategory(category);
    // Nothing to do when they already agree — and worth checking, because
    // otherwise re-tapping an already-applied segment would push a no-op onto
    // the undo stack and bury whatever real action was under it.
    const changing = targets.filter(t => !sameTimeSegments(t.timeSegments, segments));
    if (changing.length === 0) return 0;
    const ids = changing.map(t => t.id);
    const snapshots = changing.map(t => ({ ...t }));
    dbBulkSetTimeSegments(ids, segments);
    set(s => ({ tasks: patchTasks(s.tasks, ids, { timeSegments: segments }) }));
    get().setLastAction({
      label: changing.length === 1 ? 'Task rescheduled' : `${changing.length} tasks rescheduled`,
      undo: () => snapshots.forEach(snapshot => get().updateTask(snapshot.id, snapshot)),
    });
    return changing.length;
  },

  startTimer(id) {
    // Only one task times at a time — stop any other running timer first. A
    // timed task gets paused rather than stopped, so its countdown progress is
    // banked instead of being logged as a finished measurement.
    const running = get().tasks.find(t => t.timerStartedAt !== null && t.id !== id);
    if (running) {
      if (isTimedTask(running)) get().pauseTimer(running.id);
      else get().stopTimer(running.id);
    }
    get().updateTask(id, { timerStartedAt: new Date().toISOString() });
    const started = get().tasks.find(t => t.id === id);
    if (started) scheduleTimerAlarm(started);
  },

  stopTimer(id) {
    const task = get().tasks.find(t => t.id === id);
    // Finish and log: banked time from earlier segments counts too, so pausing
    // a countdown and then completing the task still records the full session.
    if (!task || (task.timerStartedAt === null && task.timerElapsedSeconds <= 0)) return;
    const minutes = timerElapsed(task) / 60;
    cancelTimerAlarm(id);
    get().updateTask(id, {
      timerStartedAt: null,
      timerElapsedSeconds: 0,
      ...applyMeasuredTime(minutes, task.estimatedMinutes),
    });
  },

  discardTimer(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.timerStartedAt === null) return;
    cancelTimerAlarm(id);
    get().updateTask(id, { timerStartedAt: null });
  },

  pauseTimer(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.timerStartedAt === null) return;
    cancelTimerAlarm(id);
    get().updateTask(id, { timerStartedAt: null, timerElapsedSeconds: timerElapsed(task) });
  },

  resetTimer(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    cancelTimerAlarm(id);
    get().updateTask(id, { timerStartedAt: null, timerElapsedSeconds: 0 });
  },

  logManualTime(id, minutes) {
    if (!(minutes > 0)) return;
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    get().updateTask(id, { timerStartedAt: null, ...applyMeasuredTime(minutes, task.estimatedMinutes) });
  },

  reorderTasks(orderedIds) {
    const updates = orderedIds.map((id, index) => ({ id, sortOrder: index + 1 }));
    dbBatchUpdateSortOrders(updates);
    const byId = new Map(updates.map(u => [u.id, { sortOrder: u.sortOrder }]));
    set(s => ({ tasks: patchTasksById(s.tasks, byId) }));
  },

  reorderWithCategoryUpdates(orders, categoryUpdates, options) {
    const scope = options?.scope ?? 'series';
    dbBatchUpdateSortOrders(orders);
    const byId = new Map(orders.map(u => [u.id, { sortOrder: u.sortOrder }]));
    set(s => ({ tasks: patchTasksById(s.tasks, byId) }));

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
      showStreak: false,
      parentId,
      groupId: null,
      projectId: null,
      targetCount: null,
      progressCount: 0,
      reminderTime: null,
      reminderKind: 'notification',
      chainEnabled: false,
      chainIndex: 0,
      chainItems: [],
      vacationPause: false,
      timerStartedAt: null,
      actualMinutes: null,
      timedMinutes: null,
      timerElapsedSeconds: 0,
      previousOccurrenceId: null,
      seriesId: null,
      seriesMonthDays: [],
      seriesRepeatMonths: 1,
      seriesDefaults: null,
      archived: false,
      archivedAt: null,
      linkUrl: null,
      blockedById: null,
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
    const byId = new Map(updates.map(u => [u.id, { sortOrder: u.sortOrder }]));
    set(s => ({ tasks: patchTasksById(s.tasks, byId) }));
  },

  // Every row ever assigned to the stack, completed occurrences included.
  // Almost nothing wants this — see groupRosterOf for what the user thinks of
  // as "the tasks in this stack". Kept for the few places that genuinely mean
  // "all history too", like re-filing rows when the stack is deleted.
  groupChildrenOf(groupId) {
    return get().tasks
      .filter(t => t.groupId === groupId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  // The stack's membership as the user understands it: one entry per task
  // series, no completion tombstones. This is what every count, cascade and
  // list should be built on (see groupRoster).
  groupRosterOf(groupId) {
    return groupRoster(get().groupChildrenOf(groupId));
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
      showStreak: false,
      parentId: null,
      groupId,
      projectId: null,
      targetCount: null,
      progressCount: 0,
      reminderTime: null,
      reminderKind: 'notification',
      chainEnabled: false,
      chainIndex: 0,
      chainItems: [],
      vacationPause: false,
      timerStartedAt: null,
      actualMinutes: null,
      timedMinutes: null,
      timerElapsedSeconds: 0,
      previousOccurrenceId: null,
      seriesId: null,
      seriesMonthDays: [],
      seriesRepeatMonths: 1,
      seriesDefaults: null,
      archived: false,
      archivedAt: null,
      linkUrl: null,
      blockedById: null,
    };
    dbInsertTask(task);
    set(s => ({ tasks: [...s.tasks, task] }));
    return task;
  },

  // Joining a stack adopts its category, and the move is undoable as one
  // step. Worth being deliberate about, because a Category isn't only a
  // label: it carries scheduleDays/scheduleStart/scheduleEnd and
  // hideOnVacation, so this can change *when the task is visible*. That's the
  // price of the stack owning the field — a member that renders under Home on
  // Today and under Work everywhere else is the thing being fixed — but it's
  // why the undo restores the category alongside the membership rather than
  // just unfiling the task.
  addExistingToGroup(taskId, groupId) {
    const task = get().tasks.find(t => t.id === taskId);
    if (!task) return;
    const group = useTaskGroupStore.getState().getGroupById(groupId);
    const siblings = get().tasks.filter(t => t.groupId === groupId);
    const maxOrder = siblings.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    const prevCategory = task.category;
    const prevGroupId = task.groupId;
    // No group row to read a category off (a stale id) means leave the task's
    // own alone — inheriting `null` from a stack that isn't there would just
    // be erasing the field.
    get().updateTask(taskId, {
      groupId,
      sortOrder: maxOrder + 1,
      ...(group ? { category: group.category } : {}),
    });
    get().setLastAction({
      label: group ? `Added to ${group.title}` : 'Added to stack',
      undo: () => get().updateTask(taskId, { groupId: prevGroupId, category: prevCategory }),
    });
  },

  removeFromGroup(taskId) {
    get().updateTask(taskId, { groupId: null });
  },

  // `orderedIds` is whatever list the user actually dragged in, which is
  // rarely the whole stack: Today shows only the members due today, and the
  // editor shows the roster but not the completed occurrences behind it.
  // Renumbering just those 1..n would drop every unseen row into a slot it
  // never asked for, so the new order is folded back into the full child list
  // (see reorderSubset) and the renumber runs across all of it.
  reorderGroupChildren(groupId, orderedIds) {
    const children = get().groupChildrenOf(groupId);
    const fullOrder = reorderSubset(children.map(c => c.id), orderedIds);
    const updates = fullOrder.map((id, index) => ({ id, sortOrder: index + 1 }));
    dbBatchUpdateSortOrders(updates);
    const byId = new Map(updates.map(u => [u.id, { sortOrder: u.sortOrder }]));
    set(s => ({ tasks: patchTasksById(s.tasks, byId) }));
  },

  // Members adopt the new stack's category as part of the same write that
  // files them into it. Deliberately *not* wrapped in a dbTransaction:
  // applyTemplate already calls this from inside one, and expo-sqlite's
  // withTransactionSync can't nest — it would throw on device while the tests,
  // which mock dbTransaction, stayed green.
  groupTasks(taskIds, title, category) {
    const group = useTaskGroupStore.getState().createGroup(title, category);
    // A stack holds a slot in the list order like a task does (see
    // TaskGroup.sortOrder), so put the new one where its members already were
    // — the members' own sortOrders are about to be overwritten with their
    // within-stack order, and createGroup only counts other stacks, so
    // without this, stacking two tasks from the middle of Today teleports
    // them to the top of the section.
    const anchors = taskIds
      .map(id => get().tasks.find(t => t.id === id)?.sortOrder)
      .filter((order): order is number => order !== undefined);
    if (anchors.length > 0) {
      useTaskGroupStore.getState().updateGroup(group.id, { sortOrder: Math.min(...anchors) });
    }
    taskIds.forEach((id, index) => {
      get().updateTask(id, { groupId: group.id, sortOrder: index + 1, category });
    });
    // The row as it now stands, not createGroup's pre-anchor copy.
    return useTaskGroupStore.getState().getGroupById(group.id) ?? group;
  },

  // Re-files every live member under the stack's category. Roster-scoped, so
  // a recurring member's completed occurrences keep the category they were
  // finished under — deleting or recategorizing a stack must not rewrite the
  // Logbook or the by-category stats behind it.
  //
  // Returns the previous values so the caller can offer a single undo across
  // the whole cascade; nothing here writes lastAction itself, since the
  // interesting label depends on what prompted the change.
  applyGroupCategory(groupId, category) {
    const changed = get().groupRosterOf(groupId).filter(t => t.category !== category);
    if (changed.length === 0) return [];
    const previous = changed.map(t => ({ id: t.id, category: t.category }));
    dbTransaction(() => {
      changed.forEach(t => get().updateTask(t.id, { category }));
    });
    return previous;
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
    const children = get().groupRosterOf(groupId);
    const completedIds: string[] = [];
    dbTransaction(() => {
      children.forEach(child => {
        if (child.completed) return;
        get().completeTask(child.id);
        if (get().tasks.find(t => t.id === child.id)?.completed) completedIds.push(child.id);
      });
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
    // Roster-scoped, so this can only ever touch what the checkbox currently
    // represents — the stack's past occurrences aren't members and can't be
    // resurrected here (see groupRoster).
    const children = get().groupRosterOf(groupId).filter(c => c.completed && isRelevantToGroupToday(c));
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

  // Roster-scoped: deferring or pinning a stack must not write to the
  // completed occurrences left behind by its recurring members, which aren't
  // part of the stack any more and would just be silently mutated history.
  deferGroup(groupId, until) {
    const ids = get().groupRosterOf(groupId).filter(c => !c.completed).map(c => c.id);
    if (ids.length === 0) return;
    get().bulkDefer(ids, until);
  },

  pinGroup(groupId) {
    const ids = get().groupRosterOf(groupId).filter(c => !c.completed).map(c => c.id);
    if (ids.length === 0) return;
    const allPinned = ids.every(id => get().tasks.find(t => t.id === id)?.pinned);
    const nextPinned = !allPinned;
    dbBulkSetPinned(ids, nextPinned);
    set(s => ({ tasks: patchTasks(s.tasks, ids, { pinned: nextPinned }) }));
  },

  deleteGroup(groupId, opts) {
    const children = get().groupChildrenOf(groupId);
    const group = useTaskGroupStore.getState().getGroupById(groupId);
    const undos: Array<() => void> = [];
    // "Delete stack and all its tasks" means the live tasks — the roster.
    // The completed occurrences its recurring members left behind are
    // Logbook and Stats history, not stack membership, so they're only
    // unfiled (group_id cleared), never destroyed. Deleting a stack the
    // user has run nightly for a year shouldn't erase a year of completions.
    //
    // The roster is a set of task *series*, though, so it names one row per
    // member and a dated series has several (see Task.seriesId). Cascading
    // over roster ids alone deleted whichever date spoke for the member and
    // left the rest of the set behind as loose, unfiled tasks — "walk the dog
    // on the 10th and the 15th" lost the 10th and kept the 15th, still on
    // Later, no longer in any stack. Each roster entry is expanded back to its
    // live sibling rows here. Completed and archived rows stay out for the
    // same reason as above: they're history, not schedule.
    const doomed = new Set<string>();
    if (opts.cascade) {
      const series = new Set<string>();
      for (const member of get().groupRosterOf(groupId)) {
        doomed.add(member.id);
        if (member.seriesId) series.add(member.seriesId);
      }
      for (const child of children) {
        if (child.seriesId && series.has(child.seriesId) && !child.completed && !child.archived) {
          doomed.add(child.id);
        }
      }
    }
    dbTransaction(() => {
      children.forEach(child => {
        if (doomed.has(child.id)) {
          get().deleteTask(child.id);
          const action = get().lastAction;
          if (action) undos.push(action.undo);
        } else {
          get().removeFromGroup(child.id);
        }
      });
    });
    useTaskGroupStore.getState().removeGroupRow(groupId);
    if (!group) return;
    get().setLastAction({
      label: opts.cascade ? 'Group and its tasks deleted' : 'Group deleted',
      undo: () => {
        useTaskGroupStore.getState().restoreGroup(group);
        undos.forEach(fn => fn());
        children.forEach(child => {
          if (!doomed.has(child.id)) get().addExistingToGroup(child.id, groupId);
        });
      },
    });
  },

  addExistingToProject(taskId, projectId) {
    get().updateTask(taskId, { projectId });
  },

  removeFromProject(taskId) {
    get().updateTask(taskId, { projectId: null });
  },

  // Archiving a project lives here rather than in useProjectStore for the same
  // reason deleting one does: the undo queue is a task-store concern, and every
  // undoable action registers its entry through setLastAction.
  archiveProject(projectId) {
    const project = useProjectStore.getState().getProjectById(projectId);
    if (!project || project.archived) return;
    useProjectStore.getState().applyProjectArchived(projectId, true);
    get().setLastAction({
      label: 'Project archived',
      undo: () => useProjectStore.getState().applyProjectArchived(projectId, false),
    });
  },

  unarchiveProject(projectId) {
    const project = useProjectStore.getState().getProjectById(projectId);
    if (!project || !project.archived) return;
    const archivedAt = project.archivedAt;
    useProjectStore.getState().applyProjectArchived(projectId, false);
    get().setLastAction({
      label: 'Project restored',
      undo: () => useProjectStore.getState().applyProjectArchived(projectId, true, archivedAt),
    });
  },

  deleteProject(projectId, opts) {
    const members = get().tasks.filter(t => t.projectId === projectId);
    const project = useProjectStore.getState().getProjectById(projectId);
    const undos: Array<() => void> = [];
    dbTransaction(() => {
      if (opts.cascade) {
        members.forEach(member => {
          get().deleteTask(member.id);
          const action = get().lastAction;
          if (action) undos.push(action.undo);
        });
      } else {
        members.forEach(member => get().removeFromProject(member.id));
      }
    });
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

  deleteTemplate(id) {
    const template = useTemplateStore.getState().templates.find(t => t.id === id);
    if (!template) return;
    useTemplateStore.getState().removeTemplateRow(id);
    get().setLastAction({
      label: 'Template deleted',
      undo: () => useTemplateStore.getState().restoreTemplate(template),
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
    const completedIds: string[] = [];
    dbTransaction(() => {
      ids.forEach(id => {
        get().completeTask(id);
        if (get().tasks.find(t => t.id === id)?.completed) completedIds.push(id);
      });
    });
    if (completedIds.length === 0) return;
    get().setLastAction({
      label: `${completedIds.length} task${completedIds.length === 1 ? '' : 's'} completed`,
      undo: () => completedIds.forEach(id => get().uncompleteTask(id)),
    });
  },

  // Re-opens a selection of completed tasks (the Logbook's bulk bar). Unlike
  // bulkCompleteTasks, the undo can't just be the inverse call in a loop —
  // completeTask would recompute streaks and the next due date off "now"
  // instead of restoring what was there. Each uncompleteTask already registers
  // an undo that puts its own row back exactly as it was, so this collects
  // those closures and replays them as one action (same trick as clearLogbook).
  bulkUncompleteTasks(ids) {
    if (ids.length === 0) return;
    const undos: Array<() => void> = [];
    dbTransaction(() => {
      ids.forEach(id => {
        if (!get().tasks.find(t => t.id === id)?.completed) return;
        get().uncompleteTask(id);
        const undo = get().lastAction?.undo;
        if (undo) undos.push(undo);
      });
    });
    if (undos.length === 0) return;
    get().setLastAction({
      label: `${undos.length} task${undos.length === 1 ? '' : 's'} uncompleted`,
      undo: () => undos.forEach(u => u()),
    });
  },

  bulkDeleteTasks(ids) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const deleted = get().tasks.filter(t => idSet.has(t.id) || (t.parentId !== null && idSet.has(t.parentId)));

    dbBulkDeleteTasks(ids);
    // Only ids that actually had a reminder are worth a native cancel call —
    // see the same predicate in rescheduleAllReminders.
    deleted.forEach(t => {
      if (idSet.has(t.id) && t.reminderTime) cancelTaskReminder(t.id);
      if (idSet.has(t.id) && t.timerStartedAt !== null) cancelTimerAlarm(t.id);
    });
    set(s => ({
      tasks: s.tasks.filter(t => !idSet.has(t.id) && (t.parentId === null || !idSet.has(t.parentId))),
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
    set(s => ({ tasks: patchTasks(s.tasks, ids, { priority }) }));
  },

  // Mixed selections pin (same rule as pinGroup/pinCategory): a selection is
  // only unpinned when every task in it is already pinned, so the common case
  // of "these three, plus that one I'd already pinned" adds rather than clears.
  bulkTogglePin(ids) {
    if (ids.length === 0) return;
    const allPinned = ids.every(id => get().tasks.find(t => t.id === id)?.pinned);
    const nextPinned = !allPinned;
    dbBulkSetPinned(ids, nextPinned);
    set(s => ({ tasks: patchTasks(s.tasks, ids, { pinned: nextPinned }) }));
  },

  bulkDefer(ids, until) {
    if (ids.length === 0) return;
    const deferUntil = until.toISOString();
    const snapshots = ids
      .map(id => get().tasks.find(t => t.id === id))
      .filter((t): t is Task => t !== undefined)
      .map(t => ({ ...t }));
    dbBulkSetDefer(ids, deferUntil);
    set(s => ({ tasks: patchTasks(s.tasks, ids, { deferUntil }) }));
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
    set(s => ({ tasks: patchTasks(s.tasks, ids, { dueDate, timeSegments }) }));
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
    set(s => ({ tasks: patchTasks(s.tasks, ids, { category }) }));
  },

  bulkAddTags(ids, tags) {
    if (ids.length === 0 || tags.length === 0) return;
    dbBulkAddTags(ids, tags);
    set(s => ({
      tasks: patchTasks(s.tasks, ids, t => ({ tags: Array.from(new Set([...t.tags, ...tags])) })),
    }));
  },

  visibleTasks() {
    const { tasks, completionHoldIds, quotaHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds)
      .filter(t => !t.parentId && (isTaskVisible(t) || isQuotaHeld(t, quotaHoldIds)))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  // Feeds Today's "later today" reveal, which is where a daily target lives
  // while you're keeping up with it (isUpcomingToday). A target inside its hold
  // window is left out: it's still on Today proper for those few seconds, and
  // the two lists can't both be showing it.
  upcomingTodayTasks() {
    const { tasks, completionHoldIds, quotaHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds)
      .filter(t => !t.parentId && isUpcomingToday(t) && !isQuotaHeld(t, quotaHoldIds))
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

  // Grouped by blocker so everything queued behind one task reads as a run,
  // rather than by sortOrder, which says nothing about what a task is waiting on.
  waitingTasks() {
    return get().tasks
      .filter(isWaitingTask)
      .sort((a, b) => (a.blockedById ?? '').localeCompare(b.blockedById ?? '')
        || a.sortOrder - b.sortOrder);
  },

  deferredTasks() {
    const { tasks, completionHoldIds, quotaHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds)
      .filter(t => !t.parentId && isTaskDeferred(t) && !isQuotaHeld(t, quotaHoldIds))
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
    const category = useCategoryStore.getState().getCategoryByName(name);
    const affectedTaskIds = get().tasks.filter(t => t.category === name).map(t => t.id);
    const affectedGroupIds = useTaskGroupStore.getState().groups.filter(g => g.category === name).map(g => g.id);

    useCategoryStore.getState().deleteCategory(name);
    set(s => ({
      tasks: s.tasks.map(t => t.category === name ? { ...t, category: null } : t),
    }));
    useTaskGroupStore.setState(s => ({
      groups: s.groups.map(g => g.category === name ? { ...g, category: null } : g),
    }));

    if (!category) return;
    get().setLastAction({
      label: 'Category deleted',
      undo: () => {
        useCategoryStore.getState().restoreCategory(category);
        if (affectedTaskIds.length > 0) {
          dbBulkSetCategory(affectedTaskIds, name);
          set(s => ({
            tasks: s.tasks.map(t => affectedTaskIds.includes(t.id) ? { ...t, category: name } : t),
          }));
        }
        affectedGroupIds.forEach(id => useTaskGroupStore.getState().updateGroup(id, { category: name }));
      },
    });
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
    // Templates follow the rename too. Deleting deliberately doesn't cascade
    // here — an item left naming a deleted category is reported by
    // findMissingRefs, because there's no correct value to rewrite it to and
    // silently blanking it would throw away what the user chose. A rename has
    // an obvious correct value, so leaving it stale was just a gap.
    useTemplateStore.getState().renameItemCategory(name, trimmed);
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

// Lets visibilityUtils resolve Task.blockedById without importing this store —
// it can't, since this module pulls in expo-sqlite and already imports it. See
// src/utils/blockerRegistry.ts for why this is a getter rather than a snapshot.
registerTaskSource(() => useTaskStore.getState().tasks);
