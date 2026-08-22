import { create } from 'zustand';
import type { Task, TaskDraft, Priority, TimeOfDay, TitleRule } from '../types';
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
  dbBatchUpdatePinnedOrders,
  dbBatchUpdatePostponeCounts,
  dbBulkAddTags,
  dbGetTagRegistry,
  dbAddToTagRegistry,
  dbRemoveFromTagRegistry,
  dbRemoveTagFromAllTasks,
  dbMarkTaskSeen,
  dbTransaction,
  dbGetMealPlanEntries,
} from '../db/database';
import { useSettingsStore } from './useSettingsStore';
import { useCategoryStore, ensureCalendarEventCategory, ensureGeneratedTaskCategories, ensureGeneratedTaskCategory } from './useCategoryStore';
import { useTemplateStore } from './useTemplateStore';
import { useTaskGroupStore } from './useTaskGroupStore';
import { useProjectStore, projectProgress } from './useProjectStore';
import { useProjectCategoryStore } from './useProjectCategoryStore';
import { useTemplateCategoryStore } from './useTemplateCategoryStore';
import { useGroceryStore } from './useGroceryStore';
import { useRecipeStore } from './useRecipeStore';
import { useMealPlanStore } from './useMealPlanStore';
import { useLeftoverStore } from './useLeftoverStore';
import { dripCandidate, findProjectStalls, projectPullUpdates } from '../utils/projectPull';
import {
  projectReviewLinkUrl,
  projectReviewProjectId,
  projectsReviewedToday,
  staleProjectReviewTasks,
  wantedProjectReviews,
} from '../utils/projectReviewTasks';
import {
  pantryCheckItemId,
  pantryCheckLinkUrl,
  stalePantryCheckTasks,
  wantedPantryChecks,
} from '../utils/pantryCheckTasks';
import {
  dueMealPlanNudge,
  mealPlanNudgeLinkUrl,
  mealPlanNudgeSuppressed,
  partitionMealPlanNudgeTasks,
} from '../utils/mealPlanNudge';
// Imports this module back, like useMealPlanStore does — inert for the same
// reason: the reference is inside an action body, by which time both modules
// have finished loading.
import { deleteGeneratedTaskQuietly, dropGeneratedTask, reconcileGeneratedTask } from './generatedTaskSync';
import { generatedBy, generatedSourceOf, generatedTaskCountOf, hasAnyGeneratedTask, liveGeneratedTask } from '../utils/generatedTasks';
import type { MealSlot, TaskGroup } from '../types';
import { generateId } from '../utils/id';
import { derivedId, spawnSeed } from '../utils/syncIds';
import { reorderSubset } from '../utils/reorder';
import { liveProjectSteps, slotUpdates } from '../utils/projectOrder';
import { applyMeasuredTime } from '../utils/effort';
import { normalizeTargetUnit } from '../utils/quotaUnit';
import { getNextDueDate, getCurrentDayStart, getLogicalToday, getTaskDayStart, dayKeyOf, getDeadlineFromOffset, getDeadlineFromMonthDay, getStreakOutcome, getNextSeriesDates } from '../utils/dateUtils';
import { entriesForSlot, shiftDayKey } from '../utils/mealPlan';
import { MEAL_SLOT_TASK_DAYS, completesMealSlot, mealSlotSourceId, mealSlotTaskDraft, parseMealSlotSource } from '../utils/mealSlotTasks';
import { isTaskVisible, isTaskNew, isTaskDeferred, isUpcomingToday, isHiddenForVacation, isVisibleApartFromVacation, isTaskExpired, isTaskSweepable, isRecurrenceNotYetDue, isLiveRecurring, isInboxTask, isUnscheduledTask, isWaitingTask, isRelevantToGroupToday, groupRoster, hasNoDateSignal, isQuotaTask, isQuotaOnPace, isMissed, sameTimeSegments, isCompletionOnTime } from '../utils/visibilityUtils';
import { retentionCutoff, selectPurgeableTaskIds } from '../utils/retention';
import {
  postponeOutcome,
  nextPostponeCount,
  nextDriftingSince,
  driftingTaskList,
  driftingTasks,
  type DriftEntry,
} from '../utils/postpone';
import { extraTaskRule, advanceExtraTaskTally } from '../utils/extraTask';
import { resolveTitleRules, titleRuleBacklog } from '../utils/titleRules';
import { registerTaskSource } from '../utils/blockerRegistry';
import { resolveBlocksEdit, waitingOn } from '../utils/blocking';
import { scheduleTaskReminder, cancelTaskReminder, rescheduleAllReminders, scheduleTimerAlarm, cancelTimerAlarm } from '../utils/notifications';
import { syncDeadlineEvent } from '../utils/deadlineCalendarSync';
import {
  deleteCalendarEvent,
  presentTimeBlockCreate,
  presentTimeBlockEdit,
  readTimeBlockEvent,
  updateTimeBlockEvent,
} from '../utils/calendarSync';
import { timeBlockFieldsFor, timeBlockUpdateFor } from '../utils/timeBlock';
import { useCalendarStore } from './useCalendarStore';
import { isTimedTask, timerElapsed } from '../utils/timer';
import { apportionedMinutes, segmentMinutesOf } from '../utils/timerSegments';

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
  /**
   * Marks an action irreversible-feeling enough to warrant the transient
   * UndoBar (src/components/UndoBar.tsx), not just the shake gesture — a
   * delete or a clear, not an add or a reschedule. See UndoBar's own doc
   * comment for the full rule; this flag is the only thing it reads.
   */
  destructive?: boolean;
}

// Fields that silently carry forward to the next occurrence today (spread
// via `...task` in completeTask). These are the only fields "this task only"
// edits (updateTask's { scope: 'occurrence' }) need to protect via
// seriesDefaults — recurrence-rule, chain, and schedule fields are excluded
// because each already has exactly one sensible interpretation (see
// isLiveRecurring / CLAUDE.md recurrence docs for why).
export const CONTENT_FIELDS: (keyof Task)[] = [
  'title', 'notes', 'tags', 'category', 'priority', 'effort',
  'estimatedMinutes', 'timedMinutes', 'windowStart', 'windowEnd', 'timeSegments', 'reminderTime', 'reminderKind', 'linkUrl', 'phoneNumber', 'emailAddress',
  // The question, not the answer — `deliverableValue` is per-occurrence data
  // like progressCount and is deliberately absent, or a scope:'occurrence'
  // edit would capture one date's answer as the default for every date after.
  'deliverableKind',
  // Grouped with the other visibility gates (windowStart, timeSegments) rather
  // than the recurrence rule: "this occurrence waits on that one-off errand" is
  // a normal thing to want, and without this a scope:'occurrence' edit would
  // quietly become the template for every occurrence after it.
  'blockedById',
  // Deliberately NOT here: postponeCount / postponeMuted. A scope:'occurrence'
  // edit captures every content field into seriesDefaults, which is applied on
  // top of the row that spawns the next occurrence — so listing them would hand
  // a fresh occurrence a stale count that completeTask had just reset to 0.
];

/**
 * The updateTask option for a date write nobody chose — series reconciliation,
 * a recurrence skip, a background drip. See utils/postpone.ts for the rule this
 * opts out of.
 *
 * applyTaskDates is the sharp case: without it an editor save that adds an
 * *earlier* extra date counts the push it just made and then immediately resets
 * it, because the reconcile re-points the anchor at `sorted[0]` — the earliest
 * date of the new set.
 */
const SKIP_POSTPONE = { skipPostponeCount: true } as const;

function captureField<K extends keyof Task>(target: Partial<Task>, source: Task, key: K): void {
  target[key] = source[key];
}

// The time-of-day a brand-new task starts with: its own if the draft named
// one, else its category's default (Category.defaultTimeSegments), else
// Settings' newTaskDefaults.timeSegment.
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
function resolveTimeSegments(draft: Partial<TaskDraft>, defaultSegment: TimeOfDay | null): TimeOfDay[] {
  if (draft.timeSegments && draft.timeSegments.length > 0) return draft.timeSegments;
  if (draft.category) {
    const cat = useCategoryStore.getState().getCategoryByName(draft.category);
    if (cat?.defaultTimeSegments.length) return [...cat.defaultTimeSegments];
  }
  if (defaultSegment) return [defaultSegment];
  return draft.timeSegments ?? [];
}

/**
 * Files a draft by whatever title rules its title fires (see utils/titleRules
 * and TitleRule): a rule sits one step more specific than Settings'
 * newTaskDefaults and obeys the same contract, filling a field the draft left
 * unanswered and never overruling one it named. Precedence, top down: what the
 * person picked → what a rule says → the app-wide default.
 *
 * It runs here rather than in newTaskFromDraft because that is also the
 * *clone* builder (buildSeriesRow), where an unset field is the source row's
 * own answer rather than an open question — re-filing every date of a series
 * against a rule written afterwards is not what "add a second date" means.
 *
 * Three creations opt out, and each has a person or a rule that has already
 * answered:
 *  - a **subtask** (`parentId`), which is a step inside a task and never files
 *    itself anywhere — it has no row in a category section to land in;
 *  - anything passing `skipTitleRules`: the app's own generated tasks ("Cook
 *    X", "Use up X" — titles it wrote itself, filed by their own settings);
 *    quick add, which resolves the same rules a keystroke at a time so the
 *    person can see and undo what fired before saving; and TaskEditor's create
 *    path, where every field a rule could fill is on screen and left empty is
 *    an answer;
 *  - a draft carrying no title at all, which has nothing to match.
 *
 * One *field* opts out rather than a caller: see `projectId` below.
 */
function applyTitleRulesToDraft(
  draft: Partial<TaskDraft>,
  options?: { skipTitleRules?: boolean },
): Partial<TaskDraft> {
  if (options?.skipTitleRules || draft.parentId || !draft.title) return draft;
  // `?? []` guards a partial settings state rather than a real absence — the
  // store's own default is [].
  const rules = useSettingsStore.getState().titleRules ?? [];
  if (rules.length === 0) return draft;
  const fill = resolveTitleRules(draft.title, rules);
  if (!fill) return draft;
  return {
    ...draft,
    title: fill.cleanTitle,
    category: draft.category ?? fill.category,
    // **A rule's project is deliberately not filled here**, and it's the one
    // field held back. Every field a rule sets is meant to be visible on the
    // row it just created, and `projectId` is the exception: `isTaskVisible`
    // bails on `projectId && !dueDate`, and both `isInboxTask` and
    // `isUnscheduledTask` require a null one. So a rule filing an undated task
    // into a project takes it off every list the person was looking at.
    //
    // In quick add that's fine and wanted — the caption names the project as
    // you type and the ✕ takes it back — and quick add resolves the rules
    // itself, so it isn't reached by this at all. What *is* reached by this is
    // only the headless creations (a dictated Apple reminder, a deep link, a
    // template run), where nothing ever says a project was chosen and there is
    // no list left to find the task on. A dictated capture that lands nowhere
    // is the failure this avoids; a dictated capture that merely lands unfiled
    // is the Inbox working.
    //
    // The catch-up offer (titleRuleBacklog) still applies it, for the same
    // reason quick add does: it's an explicit tap on a card naming what the
    // rule sets, over rows already on screen, with an Undo beside it.
    projectId: draft.projectId,
    // `!draft.priority` covers both an absent field and an explicit 0, which
    // is what "None" is everywhere one is picked. Left exactly as it arrived
    // when the rule says nothing, so an explicit 0 still means 0 rather than
    // being handed back to newTaskDefaults.
    priority: fill.priority !== 0 && !draft.priority ? fill.priority : draft.priority,
    effort: fill.effort !== 0 && !draft.effort ? fill.effort : draft.effort,
    // Tags are additive rather than a slot to claim, the same split
    // parseCategoryAndTagsInput makes — a rule's tag joins whatever the draft
    // already carries instead of being refused by a non-empty list.
    tags: fill.tags.length > 0
      ? [...(draft.tags ?? []), ...fill.tags.filter(t => !(draft.tags ?? []).includes(t))]
      : draft.tags,
  };
}

// The one place a Task's defaults are spelled out. Shared by addTask and the
// dated-series builder below so a new field can't end up defaulted in one
// path and undefined in the other. Settings' newTaskDefaults (category,
// priority, effort, timeSegment) is read here for the same reason — a
// fallback under whatever the draft already named, never an override of it.
//
// `seedFromCategory` is off by default because this is also the *clone*
// builder: buildSeriesRow feeds it an existing row when a series is
// reconciled or rolls over, and there an empty timeSegments is the source
// row's deliberate answer, not an unanswered question. Only the two paths
// where a person is creating a task from scratch turn it on. The category
// and priority/effort defaults below apply regardless of seedFromCategory —
// unlike timeSegments, a cloned series row already carries its own category/
// priority/effort explicitly (spread from the source row), so the ?? never
// fires on a clone; it's only ever a fallback for an unanswered field.
function newTaskFromDraft(
  draft: Partial<TaskDraft>,
  now: string,
  sortOrder: number,
  seedFromCategory = false,
  id?: string,
  skipCategoryDefault = false,
): Task {
  const defaults = useSettingsStore.getState().newTaskDefaults;
  return {
    id: id ?? generateId(),
    title: draft.title ?? '',
    notes: draft.notes ?? '',
    completed: false,
    completedAt: null,
    missedAt: null,
    autoScheduledAt: null,
    createdAt: now,
    seenAt: now,
    dueDate: draft.dueDate ?? null,
    deadline: draft.deadline ?? null,
    deadlineOffsetDays: draft.deadlineOffsetDays ?? null,
    deadlineMonthDay: draft.deadlineMonthDay ?? null,
    deferUntil: draft.deferUntil ?? null,
    timeSegments: seedFromCategory ? resolveTimeSegments(draft, defaults.timeSegment) : (draft.timeSegments ?? []),
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
    targetUnit: normalizeTargetUnit(draft.targetUnit),
    allowOvershoot: draft.allowOvershoot ?? false,
    tags: draft.tags ?? [],
    category: skipCategoryDefault ? (draft.category ?? null) : (draft.category ?? defaults.category),
    sortOrder,
    pinned: draft.pinned ?? false,
    pinnedOrder: 0,
    priority: draft.priority ?? defaults.priority ?? 0,
    effort: draft.effort ?? defaults.effort ?? 0,
    estimatedMinutes: draft.estimatedMinutes ?? null,
    streakCount: 0,
    streakDate: null,
    previousStreakCount: 0,
    previousStreakDate: null,
    showStreak: draft.showStreak ?? false,
    streakRequiresWindow: draft.streakRequiresWindow ?? false,
    parentId: draft.parentId ?? null,
    groupId: draft.groupId ?? null,
    projectId: draft.projectId ?? null,
    reminderTime: draft.reminderTime ?? null,
    reminderKind: draft.reminderKind ?? 'notification',
    chainEnabled: draft.chainEnabled ?? false,
    chainIndex: draft.chainIndex ?? 0,
    chainItems: draft.chainItems ?? [],
    chainStepOnSchedule: draft.chainStepOnSchedule ?? false,
    extraTaskEveryN: draft.extraTaskEveryN ?? null,
    extraTaskTitle: draft.extraTaskTitle ?? null,
    extraTaskDraft: draft.extraTaskDraft ?? null,
    vacationPause: draft.vacationPause ?? false,
    timerStartedAt: draft.timerStartedAt ?? null,
    actualMinutes: draft.actualMinutes ?? null,
    timedMinutes: draft.timedMinutes ?? null,
    timerElapsedSeconds: draft.timerElapsedSeconds ?? 0,
    previousOccurrenceId: draft.previousOccurrenceId ?? null,
    generatedKind: draft.generatedKind ?? null,
    generatedSourceId: draft.generatedSourceId ?? null,
    deadlineOnCalendar: draft.deadlineOnCalendar ?? false,
    // Never read off the draft, same reasoning as deliverableValue just
    // below: a duplicate or template application starting with someone
    // else's device event id would either point at the wrong task's event or
    // silently overwrite it on the first reconcile.
    calendarEventId: null,
    // Same rule, and both are off the draft type for it (see TaskDraft).
    timeBlockEventId: null,
    seriesId: draft.seriesId ?? null,
    seriesMonthDays: draft.seriesMonthDays ?? [],
    seriesRepeatMonths: draft.seriesRepeatMonths ?? 1,
    seriesDefaults: null,
    archived: false,
    archivedAt: null,
    linkUrl: draft.linkUrl ?? null,
    phoneNumber: draft.phoneNumber ?? null,
    emailAddress: draft.emailAddress ?? null,
    blockedById: draft.blockedById ?? null,
    deliverableKind: draft.deliverableKind ?? null,
    // Never read off the draft: the question carries, the answer doesn't. A
    // template or a duplicate that arrived holding someone else's answer would
    // read as a decision already made.
    deliverableValue: null,
    pendingImport: draft.pendingImport ?? null,
    // Not read off the draft — they're omitted from TaskDraft on purpose, so a
    // series row or a template application can't inherit someone else's count.
    postponeCount: 0,
    postponeMuted: false,
    driftingSince: null,
    extraTaskTally: 0,
    previousExtraTaskTally: 0,
  };
}

/**
 * Brings a task's device deadline event in line with the task, fire-and-
 * forget — same shape as every `scheduleTaskReminder(...)` call in this
 * file: the write is async and best-effort, so nothing here awaits it.
 *
 * Only patches the task if the resulting id actually changed (most calls are
 * a no-op — most saves don't touch the deadline), and only if the task is
 * still around by the time the device write finishes; one deleted mid-write
 * has nothing left to patch. `syncDeadlineEvent` (deadlineCalendarSync.ts)
 * owns the decision of what the device event should look like; this is only
 * the plumbing back into SQLite and the store, which is why it lives here
 * rather than there — that file has no business reaching into this store.
 */
function reconcileDeadlineEvent(task: Task): void {
  syncDeadlineEvent(task)
    .then(calendarEventId => {
      if (calendarEventId === task.calendarEventId) return;
      const current = useTaskStore.getState().tasks.find(t => t.id === task.id);
      if (!current) return;
      const updated = { ...current, calendarEventId };
      dbUpdateTask(updated);
      useTaskStore.setState(s => ({ tasks: s.tasks.map(t => (t.id === task.id ? updated : t)) }));
    })
    .catch(() => {});
}

/**
 * Write (or take back) the "this source doesn't need a task" answer that
 * deleting a generated task records on the row it came from.
 *
 * One dispatch over `Task.generatedKind` in place of the three near-identical
 * blocks `deleteTask` used to carry (#1524). The switch is not an abstraction
 * leak waiting to be tidied — each generator's flag lives on its own source
 * row, in its own store, under its own name, and that placement is the thing
 * the issue explicitly decided to keep: a generic suppression record keyed by
 * `(kind, sourceId)` would grow without bound, since nothing prunes it. On the
 * source row it's bounded for free.
 *
 * Two asymmetries preserved from the code this replaced:
 *
 * - **The meal path passes no `reconcile: false`**, because `setCookTask` has
 *   no such option — it always reconciles, which on the undo path finds the
 *   just-restored task live and leaves it alone.
 * - **`mealPlanNudge` writes nothing**, having no source row to write on. Its
 *   equivalent of an opt-out is the Settings toggle, and its equivalent of
 *   "don't hand it back" is `mealPlanNudgeLastFiredWeekKey`. It gets an
 *   explicit case rather than falling through the default: its source id used
 *   to be null, so the guard below was what kept it out of here, and that guard
 *   stopped applying when its tasks started carrying a day key. A day key names
 *   a square on the calendar, not a row — there is nothing to write "no" on,
 *   and deleting one of the seven means only that this day doesn't need
 *   planning, which the next firing has already moved past.
 */
function writeGeneratedOptOut(task: Task, value: false | null): void {
  const sourceId = task.generatedSourceId;
  if (!sourceId) return;
  const reconcileOff = { reconcile: false } as const;
  switch (task.generatedKind) {
    case 'mealPlanNudge':
      return;
    // Nothing to write, for the nudge's reason: a day and a slot name a square
    // on the calendar, not a row. Swiping today's lunch task away is honoured
    // by mealSlotTasksWrittenThroughDayKey instead — the pass only ever writes
    // days ahead of its mark, so a day it has covered is never revisited and
    // the row stays gone. That's what keeps this generator off the
    // growing-record path generatedTasks.ts warns about.
    case 'mealSlot':
      return;
    // A stamp, not a `false`, and the one generator whose opt-out expires. The
    // fields a project could carry a permanent "no" on are nudgeOptIn and
    // nudgeCadenceDays, and both mean "never chase me about this again" — far
    // more than a swipe says. See Project.reviewDeclinedAt.
    //
    // `value === null` is the undo path, and restores exactly what the delete
    // wrote: a stamp that was already there before the delete is a *previous*
    // day's (today's would have suppressed the task in the first place), so
    // clearing it changes nothing the reader can see.
    case 'projectReview':
      useProjectStore.getState()
        .updateProject(sourceId, { reviewDeclinedAt: value === false ? new Date().toISOString() : null });
      return;
    case 'mealCook':
      useMealPlanStore.getState().setCookTask(sourceId, value);
      return;
    case 'groceryUseUp':
      useGroceryStore.getState()
        .setUseUpTask(sourceId, value, value === null ? reconcileOff : undefined);
      return;
    // A stamp like projectReview's above, for the same reason — a permanent
    // `false` would mean "never ask about this item again", where a swipe only
    // means "not about this bag". It's spent against the item's own
    // lastPurchasedAt rather than against the day, so the question comes back
    // when there's a new purchase to lapse and not before. See
    // GroceryItem.pantryCheckDeclinedAt.
    //
    // `value === null` is the undo path, and restores exactly what the delete
    // wrote: any stamp already sitting there predated the last purchase (a
    // later one would have suppressed the task in the first place), so clearing
    // it changes nothing the reader can see.
    case 'pantryCheck':
      useGroceryStore.getState()
        .setPantryCheckDeclinedAt(sourceId, value === false ? new Date().toISOString() : null);
      return;
    case 'leftoverUseUp':
      useLeftoverStore.getState()
        .setUseUpTask(sourceId, value, value === null ? reconcileOff : undefined);
      return;
    default:
      return;
  }
}

/**
 * The meal a slot task's day and slot currently hold, or null for a slot with
 * nothing in it.
 *
 * Read from SQLite rather than from `useMealPlanStore.entries`, which holds
 * only the week the Meal Plan screen has open — a task ticked off on Today is
 * routinely about a day that store has never loaded, and a bare filter over it
 * would report every meal as unplanned. Same call `checkMealPlanNudge` makes
 * for the same reason.
 */
function mealSlotEntryId(task: Task): string | null {
  const source = parseMealSlotSource(generatedSourceOf(task, 'mealSlot'));
  if (!source) return null;
  const entries = dbGetMealPlanEntries(source.dayKey, source.dayKey);
  return entriesForSlot(entries, source.dayKey, source.slot)[0]?.id ?? null;
}

/**
 * Write the missing meal tasks for a span of days and a set of meals.
 *
 * Shared by the daily pass and the settings backfill, which differ only in
 * which days and which meals they are asking about. One SQLite read covers the
 * whole span — the meals already planned in it are what decide each task's
 * steps (see mealSlotChain).
 */
function writeMealSlotTasks(fromKey: string, toKey: string, slots: readonly MealSlot[]): void {
  const entries = dbGetMealPlanEntries(fromKey, toKey);
  // Ensured here as well as at startup for checkProjectReviewTasks' reason:
  // this generator ships on, so nobody flips the switch that would otherwise
  // create the category, and an uncategorized row lands in the loose block
  // above every section.
  ensureGeneratedTaskCategory('mealSlot');
  const category = useSettingsStore.getState().mealCookTaskCategory;

  for (let dayKey = fromKey; dayKey <= toKey; dayKey = shiftDayKey(dayKey, 1)) {
    for (const slot of slots) {
      const tasks = useTaskStore.getState().tasks;
      const sourceId = mealSlotSourceId(dayKey, slot);
      // Live or finished: a slot dealt with already is not a slot to ask about
      // again. Same question blocksOnFinished asks for a cook task, and the
      // same answer — a meal is one event.
      if (hasAnyGeneratedTask(tasks, 'mealSlot', sourceId)) continue;
      const entry = entriesForSlot(entries, dayKey, slot)[0] ?? null;
      // A meal the user has explicitly refused a task for keeps its refusal
      // through the fold: MealPlanEntry.cookTask is still the per-meal "no",
      // and it's the one thing a slot task inherits from the cook task it
      // replaces. `true` needs no case — an enabled slot gets a row anyway.
      if (entry?.cookTask === false) continue;
      // A legacy cook task for this slot's meal still covers it. Only matters
      // for the launch or two after the fold, while rows written as `mealCook`
      // drain; without it the first pass would write a second row under a
      // "Cook X" the user is already looking at.
      if (entry && liveGeneratedTask(tasks, 'mealCook', entry.id)) continue;
      // Already cooked before the pass ran — there is nothing left to do and
      // nothing to ask.
      if (entry?.cookedAt) continue;
      useTaskStore.getState().addTask(
        mealSlotTaskDraft(dayKey, slot, entry, category),
        derivedId(spawnSeed.generated('mealSlot', sourceId, generatedTaskCountOf(tasks, 'mealSlot', sourceId))),
        { skipCategoryDefault: true, skipTitleRules: true },
      );
    }
  }
}

/** Points a task at its time block, if the task is still around to write to. */
function setTimeBlockEventId(taskId: string, value: string | null): void {
  const current = useTaskStore.getState().tasks.find(t => t.id === taskId);
  if (!current || current.timeBlockEventId === value) return;
  const updated = { ...current, timeBlockEventId: value };
  dbUpdateTask(updated);
  useTaskStore.setState(s => ({ tasks: s.tasks.map(t => (t.id === taskId ? updated : t)) }));
}

/**
 * Brings a task's time block in line with the task — fire-and-forget, like
 * `reconcileDeadlineEvent` above, and far quieter.
 *
 * It does nothing at all unless a block already exists: a reconcile never
 * *creates* one, because putting time in someone's calendar is a thing they
 * ask for once, per task, through the system sheet. And what it writes is only
 * ever the title and the length (see `timeBlockUpdateFor`) — never the start,
 * which belongs to the event from the moment it exists.
 *
 * An event that's been deleted out from under us reads back as null, and the
 * task drops its pointer rather than writing a replacement. That's the
 * opposite of the deadline mirror's resolve-or-shrug-then-recreate, and
 * deliberately so: a deadline event nobody asked for individually can be
 * re-minted silently, but a block the user deleted in their calendar was
 * deleted on purpose.
 */
function reconcileTimeBlockEvent(task: Task): void {
  const eventId = task.timeBlockEventId;
  if (!eventId) return;
  readTimeBlockEvent(eventId)
    .then(async event => {
      if (!event) {
        setTimeBlockEventId(task.id, null);
        return;
      }
      const update = timeBlockUpdateFor(task, event);
      if (update) await updateTimeBlockEvent(eventId, update);
    })
    .catch(() => {});
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
  | 'recurrenceFromCompletion' | 'showStreak' | 'streakRequiresWindow'
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
  // Same reasoning as showStreak above: a series row is a one-off with no
  // streak of its own, so nothing is left on for it to be late against.
  streakRequiresWindow: false,
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

// pinnedTasks() ignores visibility on purpose (see CLAUDE.md), which is right
// for a task that just isn't due today — but a daily target that reaches its
// own pace is a different case: it would otherwise sit pinned at the top of
// Today, at quota, until the next unit falls due hours later. So a pinned
// quota task unpins itself the moment logging catches it up to pace, same as
// it unpins on full completion above. It gets the same grace window rather
// than clearing on the tap that crossed the line — logQuotaUnit runs whether
// the tap landed on the pinned row or the original, and either one still owns
// a live burst (four glasses at once): unpinning instantly would drop the
// pinned row out from under the next tap exactly as an unheld quota row used
// to (see QUOTA_HOLD_BACKSTOP_MS above).
const QUOTA_PACE_UNPIN_HOLD_MS = 4000;
let quotaPaceUnpinTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPaceUnpinIds: string[] = [];

function schedulePaceUnpin(id: string) {
  if (!pendingPaceUnpinIds.includes(id)) pendingPaceUnpinIds.push(id);
  if (quotaPaceUnpinTimer) clearTimeout(quotaPaceUnpinTimer);
  quotaPaceUnpinTimer = setTimeout(() => {
    quotaPaceUnpinTimer = null;
    const ids = pendingPaceUnpinIds;
    pendingPaceUnpinIds = [];
    // Re-checked against current state, not trusted from when it was
    // scheduled — an undo, a manual unpin, or the unit that finished the
    // target outright (which unpins through its own hold, above) can all
    // have happened in the meantime.
    const stillPinnedIds = useTaskStore.getState().tasks
      .filter(t => ids.includes(t.id) && t.pinned && !t.completed && isQuotaTask(t) && isQuotaOnPace(t))
      .map(t => t.id);
    if (stillPinnedIds.length === 0) return;
    dbBulkSetPinned(stillPinnedIds, false);
    useTaskStore.setState(s => ({
      tasks: s.tasks.map(t => (stillPinnedIds.includes(t.id) ? { ...t, pinned: false } : t)),
    }));
  }, QUOTA_PACE_UNPIN_HOLD_MS);
  (quotaPaceUnpinTimer as unknown as { unref?: () => void }).unref?.();
}

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

/**
 * Per-task postpone counts for a bulk reschedule, persisted and returned so the
 * in-memory patch can carry them too.
 *
 * bulkSetWhen and bulkDefer set one date across a selection but land a
 * *different* count on each task, since the rule compares against where each one
 * was — so this can't ride along on dbBulkSetWhen / dbBulkSetDefer, which stay
 * single-purpose. Same split dbBatchUpdatePinnedOrders makes beside
 * bulkTogglePin. Only rows whose count actually moves are written.
 *
 * Carries driftingSince alongside, since the two are one fact (see
 * nextDriftingSince) and splitting them across two passes would let a batch
 * write half of it.
 */
function bulkPostponeCounts(
  tasks: Task[],
  ids: string[],
  // Partial on purpose: dbBulkSetDefer writes defer_until and nothing else,
  // dbBulkSetWhen writes due_date and nothing else. Spelling the untouched
  // field as an explicit null here would wipe it from the comparison and make
  // every bulk defer look like it had cleared the task's due date.
  next: Partial<Pick<Task, 'dueDate' | 'deferUntil'>>,
  dayResetTime: string,
): Map<string, { postponeCount: number; driftingSince: string | null }> {
  const idSet = new Set(ids);
  const counts = new Map<string, { postponeCount: number; driftingSince: string | null }>();
  for (const t of tasks) {
    if (!idSet.has(t.id)) continue;
    const outcome = postponeOutcome(t, { ...t, ...next }, dayResetTime);
    const postponeCount = nextPostponeCount(t.postponeCount, outcome);
    const driftingSince = nextDriftingSince(t.driftingSince, t.postponeCount, outcome, t, dayResetTime);
    if (postponeCount !== t.postponeCount || driftingSince !== t.driftingSince) {
      counts.set(t.id, { postponeCount, driftingSince });
    }
  }
  return counts;
}

/**
 * The rank a newly pinned task should take: one past the highest currently in
 * use, so a pin lands at the *bottom* of the Pinned section.
 *
 * Appending rather than slotting in by sortOrder is the whole point — the
 * section is hand-orderable now (see Task.pinnedOrder), and dropping a new pin
 * into the middle of an order the user arranged would look like the list moved
 * on its own. Every path that turns `pinned` on goes through this: updateTask
 * covers the editor, the suggested-pins sheet and togglePin, and the two bulk
 * writers stamp a run of consecutive ranks themselves.
 *
 * Counts unpinned rows out but not their stale ranks — an unpin leaves the old
 * number on the row, which is harmless because nothing reads it while
 * `pinned` is false and re-pinning overwrites it here.
 */
function nextPinnedOrder(tasks: Task[]): number {
  let max = 0;
  for (const t of tasks) {
    if (t.pinned && t.pinnedOrder > max) max = t.pinnedOrder;
  }
  return max + 1;
}

/**
 * Consecutive fresh ranks for the ids a bulk pin is about to turn on.
 *
 * Only the ones that weren't already pinned get a rank, for the same reason
 * updateTask guards on the transition: "Pin" over a selection that is half
 * pinned already must not reshuffle the half that was there. Call it *before*
 * the write, while the store can still tell which were which.
 */
function freshPinRanks(tasks: Task[], ids: string[]): { id: string; pinnedOrder: number }[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  let next = nextPinnedOrder(tasks);
  const out: { id: string; pinnedOrder: number }[] = [];
  for (const id of ids) {
    const t = byId.get(id);
    if (!t || t.pinned) continue;
    out.push({ id, pinnedOrder: next++ });
  }
  return out;
}

function rankFor(
  ranks: { id: string; pinnedOrder: number }[] | null,
  id: string,
): { pinnedOrder?: number } {
  const hit = ranks?.find(r => r.id === id);
  return hit ? { pinnedOrder: hit.pinnedOrder } : {};
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
  /**
   * `id` is for the app's own unattended generators only — a person's task
   * always gets a fresh `generateId()`. Passing a `derivedId` (see syncIds.ts)
   * is what lets two devices that independently create "the same" generated
   * task before ever syncing converge on one row instead of two (#1751).
   *
   * `skipCategoryDefault` is for the same generators: `category` on their
   * draft is always their own dedicated setting (`leftoverUseUpTaskCategory`
   * and siblings), already resolved and possibly deliberately null — not an
   * unanswered field the way a fresh editor draft's null is. Without this,
   * `??` can't tell "generator says no category" from "person hasn't picked
   * one yet" and silently substitutes the unrelated newTaskDefaults.category
   * for the former (#1724).
   */
  addTask: (
    draft: Partial<TaskDraft>,
    id?: string,
    options?: { skipCategoryDefault?: boolean; skipTitleRules?: boolean },
  ) => Task;
  duplicateTask: (id: string) => Task | null;
  /**
   * Opens the system event sheet to block out time for a task — the new-event
   * sheet when it has no block yet, the edit sheet for the one it has. Resolves
   * to whether the task now has a block; nothing is written unless the user
   * saves, and the sheet is the only thing in the app that deletes one.
   */
  putTaskOnCalendar: (id: string) => Promise<boolean>;
  // scope 'occurrence' ("this task only") applies `updates` to this row but
  // preserves whatever content-field values existed before the edit in
  // seriesDefaults, so the next occurrence (see completeTask) reverts to
  // them instead of carrying the one-off edit forward. Default ('series' /
  // omitted, "this and future tasks") is a plain patch, same as always.
  // With scope 'series' on a task that belongs to a dated series (see
  // Task.seriesId), content-field updates also fan out to the set's later
  // still-incomplete dates — "this and future tasks" means the same thing for
  // a series as it does for a recurrence, it just has real rows to write to.
  updateTask: (
    id: string,
    updates: Partial<Task>,
    // skipPostponeCount: this move wasn't the user ducking the task — an engine
    // proposed it, or it's bookkeeping. See utils/postpone.ts.
    options?: { scope?: 'occurrence' | 'series'; skipPostponeCount?: boolean },
  ) => void;
  /** The live tasks waiting on this one (see utils/blocking's waitingOn). */
  blockedTasksOf: (id: string) => Task[];
  /**
   * The other side of "Waiting on": makes `taskIds` the set of tasks held back
   * by `blockerId`, pointing each one's `blockedById` at it and releasing
   * whatever was waiting on it and no longer is.
   *
   * The relationship is still one pointer on the blocked task — this is the
   * write that lets it be set from the blocking task's editor instead of
   * having to go and find each waiter. Completed and archived waiters are left
   * alone (see resolveBlocksEdit): what a finished task waited for is history.
   */
  setBlockedTasks: (blockerId: string, taskIds: string[]) => void;
  // The two ends of an Apple Reminders suggestion (see Task.pendingImport).
  // Applying writes the parsed schedule onto the task, which is also the
  // moment it stops satisfying isInboxTask and leaves the Inbox for Today or
  // Later — the whole point of holding it until the user asks for it.
  // Dismissing drops the suggestion and leaves the task exactly as dictated.
  applyPendingImport: (id: string) => void;
  dismissPendingImport: (id: string) => void;
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
  /**
   * `skipGeneratedOptOut` is for a delete the app performs on its own behalf —
   * see dropGeneratedTask. A user's delete is an instruction to the source and
   * must keep writing it.
   */
  deleteTask: (id: string, opts?: { skipGeneratedOptOut?: boolean }) => void;
  /**
   * `deliverableValue` records the answer a decision task was completed with
   * (see Task.deliverableKind). Omitting it completes with no answer, which
   * every non-interactive caller does and is always allowed — bulk complete,
   * the stack cascade, the widget queue and the overshoot sweep have nobody to
   * ask, and a completion may never be blocked on an answer.
   */
  completeTask: (id: string, options?: { missed?: boolean; deliverableValue?: string | null }) => void;
  uncompleteTask: (id: string) => void;
  /**
   * Writes (or clears) the answer on an already-completed task — the Logbook's
   * "Edit answer". Separate from updateTask only in that it's the one write
   * that means "I'm correcting what I decided", so it registers its own undo.
   */
  setDeliverableValue: (id: string, value: string | null) => void;
  /**
   * Closes out a recurring occurrence as *not done* and moves to the next one.
   *
   * Deliberately routed through completeTask rather than reimplemented: every
   * hard part of rolling an occurrence over — chain steps, per-step scheduling,
   * relative deadlines, reminder re-anchoring, series set rollover, the
   * completion hold that animates the row out — is the same whether the
   * occurrence was done or missed, and a second copy of it would drift.
   * `missed` branches only the four things that genuinely differ: the stamp,
   * the streak, the quota count, and the undo label.
   *
   * Recurring only, like the skip it replaces. "I didn't do this" needs a next
   * occurrence to move on to; on a one-off it would just be a delete.
   */
  markMissed: (id: string) => void;
  logQuotaUnit: (id: string) => void;
  unlogQuotaUnit: (id: string) => void;
  /** Keeps a back-on-pace daily target on Today until releaseQuotaHold. */
  holdQuotaOnToday: (id: string) => void;
  releaseQuotaHold: (id: string) => void;
  rolloverQuotas: () => void;
  /** Opt-in counterpart to rolloverQuotas for allowOvershoot tasks — see its doc comment. */
  sweepOvershootQuotas: () => void;
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
  /**
   * Files the tasks a rule just written would have filed, had it existed when
   * they were typed (see utils/titleRules.titleRuleBacklog). Offered once, at
   * the moment a rule is authored — a rule still never fires on its own after
   * a task exists, so this is the one way an existing row is filed by one.
   *
   * Recomputes the backlog rather than taking a list of ids: the prompt names
   * a count, and a task edited between reading it and answering it deserves
   * the answer it has now. Returns how many rows it wrote to.
   */
  applyTitleRuleToExisting: (rule: TitleRule) => number;
  // Layer B of the same feature: projects the user opted into auto-scheduling
  // date their own next task when they run dry. Idempotent by construction —
  // dating a member makes the project non-stalled, so a second call in the same
  // session finds nothing, exactly as rolloverQuotas' condition self-clears.
  dripStalledProjects: () => void;
  /**
   * The opt-in "plan meals for the week" nudge (#1121) — creates a real Task
   * reminding the user to plan that week's meals, at most once a week
   * and only when that week has nothing planned yet. See
   * src/utils/mealPlanNudge.ts for the firing/suppression rules this wraps.
   */
  checkMealPlanNudge: () => void;
  /**
   * Give every quiet project a "Review X" task, and clear the ones whose
   * project has stopped being quiet. See src/utils/projectReviewTasks.ts.
   */
  checkProjectReviewTasks: () => void;
  /**
   * Write today's meal tasks, once per logical day — see the implementation
   * for why the day is both the unit and the whole opt-out.
   */
  checkMealSlotTasks: () => void;
  /**
   * Fill the already-written days with meals just switched on in Settings —
   * see the implementation for why the mark is never rewound instead.
   */
  backfillMealSlotTasks: (slots: readonly MealSlot[]) => void;
  /**
   * Give every grocery item whose pantry guess has just run out a "Check if you
   * still have X" task, and clear the ones that have since been answered,
   * restocked or put back on the list. See src/utils/pantryCheckTasks.ts.
   */
  checkPantryCheckTasks: () => void;
  /**
   * Rolls a recurring task onto its next date in place, silently — no record,
   * no history row, nothing in the Logbook.
   *
   * **Not user-facing any more.** It used to back a Skip button on the task row
   * and a "Skip This Occurrence" branch in the delete prompts; those are now
   * markMissed, because a silent roll-forward and an explicit "I didn't do
   * this" look identical afterwards, and only one of them can be counted.
   * Its single remaining caller is sweepExpiredTasks, which needs exactly the
   * silence: that's an unattended background write, and stamping a miss the
   * user never made would put fabricated entries in their Logbook.
   *
   * Don't wire a button to this — reach for markMissed.
   */
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
  /** Hand-order the Pinned section; see Task.pinnedOrder. */
  reorderPinnedTasks: (orderedIds: string[]) => void;
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
  /**
   * Correct the time the stopwatch recorded. The stopwatch is the only writer
   * of `actualMinutes`, and stopping it late otherwise leaves the wrong number
   * on the task for good — which reaches further than it looks, because
   * `applyMeasuredTime` makes the measurement the estimate too.
   *
   * Deliberately routed through the same `applyMeasuredTime` a real run is, so
   * a corrected number lands on exactly the fields a measured one does rather
   * than leaving the estimate and the effort bucket disagreeing with it.
   */
  setMeasuredTime: (id: string, minutes: number) => void;
  reorderTasks: (orderedIds: string[]) => void;
  // Explicit sortOrders rather than ids-in-order: the Today list's ranks are
  // shared with the stacks sitting in it (see resolveDrop), so the gaps a
  // stack leaves in the task numbering are load-bearing.
  reorderWithCategoryUpdates: (
    orders: Array<{ id: string; sortOrder: number }>,
    categoryUpdates: Array<{ id: string; category: string | null }>,
    options?: { scope?: 'occurrence' | 'series' },
  ) => void;
  /**
   * Reorder a project's live members. Unlike reorderTasks this renumbers
   * nothing — the members swap the sortOrder slots they already hold, so a
   * dated project task keeps its place among the loose tasks on Today. See
   * utils/projectOrder.slotUpdates.
   */
  reorderProjectTasks: (projectId: string, orderedIds: string[]) => void;

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
  // Marking a project complete is independent of archiving it (see
  // Project.completed). When incomplete member tasks remain, the caller
  // decides via opts whether they're archived along with the project or left
  // exactly where they are — ProjectEditor asks the user which before calling
  // this, the same way it asks before a cascading delete.
  completeProject: (projectId: string, opts: { archiveRemaining: boolean }) => void;
  uncompleteProject: (projectId: string) => void;
  // Bulk selection on the Projects screen. One undo entry covers the whole
  // batch — see the note on bulkDeleteProjects.
  bulkDeleteProjects: (projectIds: string[], opts: { cascade: boolean }) => void;
  bulkSetProjectArchived: (projectIds: string[], archived: boolean) => void;

  deleteTemplate: (id: string) => void;
  bulkDeleteTemplates: (ids: string[]) => void;

  forgivVacationStreaks: () => void;
  checkVacationExpiry: () => void;
  resetAllStreaks: () => void;
  bulkCompleteTasks: (ids: string[]) => void;
  bulkUncompleteTasks: (ids: string[]) => void;
  bulkMarkMissed: (ids: string[]) => void;
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
  driftingTaskList: () => Task[];
  driftingTasks: () => DriftEntry[];
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
    // After the categories load, because it may add one: an install that
    // already had the calendar read on predates events having a section to
    // land in, and this is the whole of that migration (see
    // ensureCalendarEventCategory for why it only ever fills an *absent*
    // answer, never a cleared one).
    ensureCalendarEventCategory();
    // And the same for the tasks the app writes itself. Both are here rather
    // than in the settings store because they add a category, and the
    // categories have just finished loading.
    ensureGeneratedTaskCategories();
    useTemplateStore.getState().initialize();
    useTaskGroupStore.getState().initialize();
    useProjectStore.getState().initialize();
    useProjectCategoryStore.getState().initialize();
    useTemplateCategoryStore.getState().initialize();
    // Groceries ride this fan-out rather than being initialized from App.tsx,
    // and that placement is load-bearing: enterDemoMode/exitDemoMode and
    // restore-from-backup all reload by calling *this* function after swapping
    // the database file. A store initialized outside it would keep its
    // in-memory rows pointed at the previous database while every other
    // surface showed the new one — i.e. your real groceries on a demo phone.
    useGroceryStore.getState().initialize();
    // Same reasoning, and the same swap-the-database hazard: recipes bridge to
    // the catalog by name_key, so a stale recipe list next to a fresh catalog
    // would match nothing.
    useRecipeStore.getState().initialize();
    // And the plan, which points at those recipes by id. Range-scoped, so this
    // reloads whatever week is on screen rather than the whole table.
    useMealPlanStore.getState().initialize();
    // What's in the fridge — pointed at by the plan the same way recipes are,
    // and on the same swap-the-database hazard.
    useLeftoverStore.getState().initialize();
    const tasks = dbGetAllTasks();
    const tagRegistry = dbGetTagRegistry();

    set({ tasks, tagRegistry, initialized: true });
    const { tripShopId, tripStartedAt, shops } = useGroceryStore.getState();
    rescheduleAllReminders(tasks, { shopId: tripShopId, startedAt: tripStartedAt, shops });
    // Deliberately after the set() above, not inside useLeftoverStore's own
    // initialize(): reconciling reads useTaskStore.getState().tasks to find
    // each leftover's live task, and at the point leftovers load (just above)
    // that array is still whatever this store held before this call — stale
    // rows on a demo-mode swap, or simply unset on a cold start. Running the
    // sweep here means it sees the tasks this launch actually has.
    useLeftoverStore.getState().reconcileAllLeftoverTasks();
  },

  // Must run after useSettingsStore.initialize() so autoRemoveExpiredTasks,
  // vacationMode and dayResetTime are the user's real values rather than
  // defaults — see App.tsx call order.
  sweepExpiredTasks() {
    const grace = useSettingsStore.getState().autoRemoveExpiredTasks;
    if (grace === null) return;
    const expired = get().tasks.filter(t => !t.parentId && isTaskSweepable(t, grace));
    if (expired.length === 0) return;

    // A recurring task's row *is* its schedule — the next occurrence only
    // comes into existence when this one is completed — so deleting the row
    // ends the series for good. Missing this morning's window is not "I'm
    // done with this habit", and a setting about tidying away time-limited
    // tasks must not quietly retire a daily one. An expired occurrence that
    // still has a next date is rolled forward onto it instead. Only rows with
    // nothing after them are deleted: one-offs, and series that have reached
    // their recurrenceEndDate/recurrenceCount.
    //
    // Deliberately skipNextRecurrence and not markMissed, even though an
    // expired occurrence is, in plain terms, one the user missed. This runs
    // unattended at startup, and a miss is a claim about the user that shows
    // up in their Logbook and their stats — the app doesn't get to enter those
    // on their behalf for a window that closed while the app was shut.
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

  addTask(draft, id, options) {
    const now = new Date().toISOString();
    const maxOrder = get().tasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    const task = newTaskFromDraft(
      applyTitleRulesToDraft(draft, options), now, maxOrder + 1, true, id, options?.skipCategoryDefault);
    dbInsertTask(task);
    set(s => ({ tasks: [...s.tasks, task] }));
    scheduleTaskReminder(task);
    reconcileDeadlineEvent(task);
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
      reconcileDeadlineEvent(row);
    });
    set(s => ({ tasks: [...s.tasks, ...rows] }));
    return rows;
  },

  seriesRowsOf(seriesId) {
    return get().tasks.filter(t => t.seriesId === seriesId && !t.parentId);
  },

  blockedTasksOf(id) {
    // Rows, not a roster: a dated set whose dates all wait on this task is
    // several waiters, each with its own day to be freed on, and the "N
    // waiting" chip on the row counts them the same way. Collapsing them here
    // and nowhere else would make the editor and the chip disagree.
    return waitingOn(id, get().tasks);
  },

  setBlockedTasks(blockerId, taskIds) {
    // One updateTask per row rather than a single bulk write: blockedById is a
    // content field, so a waiter that belongs to a dated series has to fan out
    // to that set's later dates exactly as it does when set from its own
    // editor.
    const { unlink } = resolveBlocksEdit(blockerId, taskIds, get().tasks);
    unlink.forEach(id => get().updateTask(id, { blockedById: null }));
    // Recomputed against what the releases left behind rather than decided up
    // front, and that's the whole reason for the second call: releasing one
    // date of a dated set fans the release out to the set's later dates, which
    // may be rows this edit is keeping. Deciding both passes from the state
    // before either ran would drop those on the floor.
    const { link } = resolveBlocksEdit(blockerId, taskIds, get().tasks);
    link.forEach(id => get().updateTask(id, { blockedById: blockerId }));
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
        get().updateTask(
          taskId,
          { dueDate: sorted[0]?.toISOString() ?? anchor.dueDate },
          SKIP_POSTPONE,
        );
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
        if (t.calendarEventId) deleteCalendarEvent(t.calendarEventId);
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
      }, SKIP_POSTPONE);
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
    }, SKIP_POSTPONE);

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
      // The row is gone for good, not archived — nothing will ever revisit
      // it to notice a dangling event, so clean it up now, same as deleteTask.
      if (t.calendarEventId) deleteCalendarEvent(t.calendarEventId);
    });
    added.forEach(t => {
      dbInsertTask(t);
      scheduleTaskReminder(t);
      reconcileDeadlineEvent(t);
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
      destructive: true,
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
      missedAt: null,
      // A copy is the user's own doing, whatever put the date on the original.
      autoScheduledAt: null,
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
      // Same split as actualMinutes above: the copy still asks the question,
      // it just hasn't been answered yet.
      deliverableValue: null,
      previousOccurrenceId: null,
      seriesId: null,
      seriesMonthDays: [],
      seriesRepeatMonths: 1,
      seriesDefaults: null,
      archived: false,
      archivedAt: null,
      chainIndex: 0, // a duplicate starts a chain fresh, not mid-way through the original
      // Both, unlike a recurrence successor: a copy is a new task the user just
      // made, so it has neither a history of being ducked nor a mute they set.
      postponeCount: 0,
      postponeMuted: false,
      driftingSince: null,
      // deadlineOnCalendar (the preference) carries via ...original, same as
      // every other setting on the copy, but the device event does not —
      // two tasks pointing at one event means editing either one's deadline
      // silently drags the other's calendar entry with it.
      calendarEventId: null,
      // Same reasoning, and the copy has no claim on the original's slot
      // anyway — the block was time set aside for one piece of work.
      timeBlockEventId: null,
    };
    const copy: Task = {
      ...original,
      ...resetForCopy,
      id: generateId(),
      sortOrder: maxOrder + 1,
    };
    dbInsertTask(copy);
    scheduleTaskReminder(copy);
    reconcileDeadlineEvent(copy);

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

  /**
   * The one entry point that creates a time block, and it does so by handing
   * the decision to Apple's own event sheet — see the #1492 section of
   * `calendarSync.ts` for why the write goes through the system UI rather than
   * `createEventAsync`.
   *
   * The proposed slot is only a prefill. `timeBlockFieldsFor` reads the
   * calendar window to find a gap the task actually fits in, but the user is
   * looking at a real calendar UI by the time it matters, so a poor guess
   * costs a drag rather than a wrong event.
   *
   * `loaded` is what's passed rather than `events`, for the reason the flag
   * exists: an empty window and a calendar we couldn't open are both `[]`, and
   * only one of them means the day is free.
   */
  async putTaskOnCalendar(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return false;

    // Already has one — this is the edit sheet, and the only place in the app
    // a block can be deleted.
    if (task.timeBlockEventId) {
      const result = await presentTimeBlockEdit(task.timeBlockEventId);
      if (result.deleted) {
        setTimeBlockEventId(id, null);
        return false;
      }
      if (result.saved) return true;

      // Nothing came back: either the user closed the sheet without changing
      // anything, or it never opened. Only one of those is worth acting on, so
      // ask whether the event is actually still there before assuming the
      // worst — `presentTimeBlockEdit` deliberately doesn't guess (see there).
      if (await readTimeBlockEvent(task.timeBlockEventId)) return true;

      // Genuinely gone — deleted from the Calendar app, or on a calendar that
      // was removed from the device. Drop the stale pointer and fall through
      // to offering a fresh block, so the tap that found the rot also fixes it.
      setTimeBlockEventId(id, null);
    }

    const { activeHoursStart, activeHoursEnd } = useSettingsStore.getState();
    const { events, loaded } = useCalendarStore.getState();
    const fields = timeBlockFieldsFor(task, {
      now: new Date(),
      activeHoursStart,
      activeHoursEnd,
      events: loaded ? events : null,
    });
    if (!fields) return false;

    const result = await presentTimeBlockCreate(fields);
    // A saved event with no id — which iOS can return — is a real event we
    // simply can't point at. Claiming a block we can't reconcile or reopen
    // would be worse than admitting we have none, so the pointer stays null
    // and the action offers to create another.
    if (!result.saved || !result.eventId) return false;
    setTimeBlockEventId(id, result.eventId);
    return true;
  },

  updateTask(id, updates, options) {
    // Raising a completed quota task's target past what's already logged
    // means there's more to do today, but isTaskVisible bails out on
    // `completed` before it ever looks at targetCount — the row would stay
    // stuck done, invisible on Today, with no way to log the rest (#1752).
    // Reopen it the same way undoing its completion would (which also
    // deletes the next occurrence completing it already spawned, so raising
    // the target can't leave two live rows for the same series), then
    // restore the count actually logged — nothing was undone, only the
    // completion.
    const current = get().tasks.find(t => t.id === id);
    if (
      current?.completed &&
      isQuotaTask(current) &&
      !isMissed(current) &&
      'targetCount' in updates &&
      updates.targetCount != null &&
      updates.targetCount > current.progressCount
    ) {
      const loggedSoFar = current.progressCount;
      get().uncompleteTask(id);
      updates = { ...updates, progressCount: loggedSoFar };
    }

    const scope = options?.scope ?? 'series';
    // Computed once, outside the map: it scans every task, and the map is
    // already a full pass. Only consumed on the 0→1 transition below.
    const freshPinnedOrder = updates.pinned === true ? nextPinnedOrder(get().tasks) : 0;
    const dayResetTime = useSettingsStore.getState().dayResetTime;
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

      // Taking a drip-scheduled task over: the user picked a date themselves,
      // so the row stops narrating where it came from. Clearing a date is
      // deliberately *not* this — the stamp is what records the refusal, and
      // dripStalledProjects reads it (see Task.autoScheduledAt). The drip's own
      // write passes autoScheduledAt explicitly and so exempts itself.
      const takenOver =
        'dueDate' in updates &&
        updates.dueDate != null &&
        !('autoScheduledAt' in updates) &&
        t.autoScheduledAt !== null;

      // How many times the user has pushed this out (see utils/postpone.ts).
      // Derived from the move rather than asked for, so every hand-picked date —
      // the row's swipe, the editor's Date row — is counted without its call
      // site having to remember to.
      //
      // Two ways out, and both are needed. An update that names postponeCount
      // itself wins outright, which is what makes every snapshot undo correct
      // for free: they replay a whole pre-write `{ ...task }`, so the count goes
      // back to what it was instead of being re-judged by a backward date move.
      // And skipPostponeCount covers the engine paths that undo with a narrow
      // {dueDate, deferUntil} patch (deloadTasks, pullProjectTasks) — there's no
      // field there to hide behind, and that backward move would otherwise read
      // as "resolved" and wipe the history this feature exists to keep.
      //
      // driftingSince rides on the same outcome and the same escape hatches, so
      // the count and the day it started from can never be judged differently:
      // one call to postponeOutcome answers both.
      const derivedPostpone =
        options?.skipPostponeCount || 'postponeCount' in updates || 'driftingSince' in updates
          ? undefined
          : (() => {
              const outcome = postponeOutcome(t, { ...t, ...updates }, dayResetTime);
              return {
                postponeCount: nextPostponeCount(t.postponeCount, outcome),
                driftingSince: nextDriftingSince(
                  t.driftingSince,
                  t.postponeCount,
                  outcome,
                  t,
                  dayResetTime,
                ),
              };
            })();

      const next = {
        ...t,
        ...updates,
        seriesDefaults,
        ...(derivedPostpone ?? {}),
        ...(takenOver ? { autoScheduledAt: null } : {}),
        // Only on the transition, never on a re-save of an already-pinned
        // task: the editor writes `pinned: true` on every save of a pinned
        // task, and restamping there would shuffle it to the bottom of the
        // section each time it was opened.
        ...(updates.pinned === true && !t.pinned ? { pinnedOrder: freshPinnedOrder } : {}),
        // Normalized on the way in, like addTask does, so a unit typed as
        // "  glasses " is stored the way every reader formats it.
        ...('targetUnit' in updates ? { targetUnit: normalizeTargetUnit(updates.targetUnit) } : {}),
      };

      // Re-filing a task must not, on its own, make it read as "new".
      // isTaskNew answers "has a day gate let this through since you last
      // looked at it", but two of the things that suppress the answer are the
      // *category's* (excludeFromNewTasksBanner, and a schedule whose window
      // is shut) — and while a task is suppressed nothing ever advances its
      // seenAt, because both the banner's OK and TaskItem's mark-on-tap only
      // fire for a row already showing as new. So its seenAt keeps whatever
      // stale value it had, and the first move into a category that doesn't
      // suppress hands the user a week-old task in the "you have N new todos"
      // banner. Stamping seenAt on that transition is the honest answer: they
      // are holding the task right now, so they have seen it.
      //
      // Only on the transition into new, so a task that was already new keeps
      // its dot through a move (and through the narrow {category} patches the
      // group undos replay), and only when the update doesn't name seenAt
      // itself, which is what lets a full-snapshot undo put the old value back.
      const recategorizedIntoNew =
        'category' in updates &&
        updates.category !== t.category &&
        !('seenAt' in updates) &&
        !isTaskNew(t) &&
        isTaskNew(next);
      const updated = recategorizedIntoNew
        ? { ...next, seenAt: new Date().toISOString() }
        : next;
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
      if (
        'deadline' in updates ||
        'deadlineOffsetDays' in updates ||
        'deadlineMonthDay' in updates ||
        'deadlineOnCalendar' in updates ||
        'completed' in updates ||
        'archived' in updates ||
        'title' in updates
      ) {
        reconcileDeadlineEvent(updated);
      }
      // The two fields a block mirrors, plus the chain position that decides
      // which step's title and estimate those are. Not gated on completed or
      // archived: a block is never removed for either (see Task.timeBlockEventId).
      if (
        'title' in updates ||
        'estimatedMinutes' in updates ||
        'effort' in updates ||
        'chainItems' in updates ||
        'chainIndex' in updates
      ) {
        reconcileTimeBlockEvent(updated);
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

  applyPendingImport(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task?.pendingImport) return;
    // One updateTask call rather than a write of its own, so the suggestion
    // goes through the same path any other edit does — which is also what
    // reschedules the notification, since updateTask cancels and re-schedules
    // whenever reminderTime or title is among the updates, and a suggestion
    // carrying an alarm has both.
    get().updateTask(id, { ...task.pendingImport, pendingImport: null });
  },

  dismissPendingImport(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task?.pendingImport) return;
    // Only the suggestion goes. The title stays exactly as it was dictated —
    // the parse's stripped version was never written to the row, so there is
    // nothing here to undo.
    get().updateTask(id, { pendingImport: null });
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

  deleteTask(id, opts = {}) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    const subtasks = get().subtasksOf(id);

    dbDeleteSubtasks(id);
    dbDeleteTask(id);
    cancelTaskReminder(id);
    if (task.timerStartedAt !== null) cancelTimerAlarm(id);
    // Fire-and-forget, same as every other calendar/notification side effect
    // here. Not restored on undo below — deleting a device event isn't
    // reversible, so an undone delete gets a fresh event on its next
    // reconcile rather than a promise this can't keep.
    if (task.calendarEventId) deleteCalendarEvent(task.calendarEventId);
    set(s => ({ tasks: s.tasks.filter(t => t.id !== id && t.parentId !== id) }));

    // Deleting a generated task is the user saying this source doesn't need
    // one, and that has to be written down on the source: the meal is still on
    // the calendar, the item is still in the catalog, the container is still in
    // the fridge, and the next reconcile would otherwise hand the task straight
    // back — weekly, for a staple. The one deliberate exception to "the source
    // is the master": a delete here is an instruction to it, not drift from it.
    //
    // Only this path, not bulkDeleteTasks: the sweeps and purges that route
    // through the bulk form aren't the user saying anything, and a generated
    // task they reach has been completed for months anyway.
    //
    // And not when the app is the one deleting: a reconcile clearing a task
    // whose reason has gone is tidying up, not the source changing its mind
    // (see dropGeneratedTask, which is the only caller that passes this).
    if (!opts.skipGeneratedOptOut) writeGeneratedOptOut(task, false);

    get().setLastAction({
      label: 'Task deleted',
      destructive: true,
      undo: () => {
        dbInsertTask(task);
        scheduleTaskReminder(task);
        // The device event was deleted above and isn't coming back under the
        // same id — this writes a fresh one and repoints calendarEventId at
        // it, rather than leaving the restored task pointing at nothing
        // until its next unrelated edit.
        reconcileDeadlineEvent(task);
        subtasks.forEach(sub => {
          dbInsertTask(sub);
          scheduleTaskReminder(sub);
        });
        set(s => ({ tasks: [...s.tasks, task, ...subtasks] }));
        // Back to "the setting decides" rather than to whatever it was: the
        // opt-out above is the only thing that could have written it, so this
        // is its exact inverse — and skipped in the same breath when the
        // delete never wrote one.
        if (!opts.skipGeneratedOptOut) writeGeneratedOptOut(task, null);
      },
    });
  },

  markMissed(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.completed || task.recurrenceType === 'none') return;
    // A recurring row can be showing in Later ahead of its own day, and you
    // cannot have missed something that hasn't come round yet — completeTask
    // refuses it outright (isRecurrenceNotYetDue), which would make every
    // caller here a silent no-op: a dead button on the row, and a bulk delete
    // that deletes nothing. The intent is the same either way — "deal with
    // just this occurrence and move on" — so it degrades to the silent roll
    // forward, which is exactly that minus a claim that isn't true yet.
    if (isRecurrenceNotYetDue(task)) {
      get().skipNextRecurrence(id);
      return;
    }
    get().completeTask(id, { missed: true });
  },

  completeTask(id, options) {
    const missed = options?.missed ?? false;
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
    // A miss never walks forward into the next step — that would read as
    // having done Step 2 the moment Step 1 was marked missed. It ends the
    // whole chain attempt on the spot, same as reaching the real last step,
    // so the run's own bookkeeping (streak, recurrenceCount) treats a
    // mid-chain miss as a missed cycle rather than a free pass through it.
    const atChainEnd = chainAdvances && (missed || task.chainIndex >= task.chainItems.length - 1);
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
    // Per-step scheduling ("Next step: on the next repeat") makes every step
    // wait for the recurrence instead of spawning immediately, so the chain
    // rotates one step per occurrence. It needs a schedule to wait for, hence
    // the `recurs` guard — the flag is inert on a chain with no Repeat set.
    const stepsBySchedule = chainAdvances && recurs && task.chainStepOnSchedule;
    // Deliberately two flags, not one. `advancesBySchedule` is the recurrence's
    // *bookkeeping* — recurrenceCount, recurrenceEndDate — and stays once per
    // full cycle in both modes, because "repeat 10 times" means ten times
    // through the chain rather than ten steps. `datesBySchedule` is the
    // narrower question of whether the row we spawn gets a scheduled date,
    // which per-step mode answers yes to on every step. Collapsing them would
    // let a mid-chain step burn a cycle of the count and let the end date
    // strand a chain half-finished.
    const datesBySchedule = advancesBySchedule || stepsBySchedule;

    // Calculate streak — see getStreakOutcome for the cadence-aware gap check (#691).
    // A miss skips all of it and breaks the streak outright (below). The gap
    // check would eventually catch it anyway — it measures the distance to the
    // next completion against the cadence — but only *lazily*, so the row would
    // keep displaying "12 day streak" until the next time the task was done.
    // An explicit miss is the one case where the break is known at the time.
    let newStreakCount = 1;
    if (!missed && recurs && datesBySchedule && task.streakDate) {
      // #1255: a task opted into streakRequiresWindow that's completed
      // outside its own timeSegments/windowStart-windowEnd window forfeits
      // the calendar-gap outcome below entirely — a late completion still
      // logs (see `completed` below), it just can't continue or preserve the
      // streak the way an on-time one does. isCompletionOnTime is vacuously
      // true for a task with no window, so the setting is inert there.
      const onTime = !task.streakRequiresWindow || isCompletionOnTime(task);
      const outcome = onTime ? getStreakOutcome(task, dayResetTime) : 'reset';
      if (outcome === 'same-day') {
        newStreakCount = task.streakCount;
      } else if (outcome === 'continued') {
        newStreakCount = task.streakCount + 1;
      }
      // else 'reset': missed too many cadence units, or completed outside the
      // task's own window → reset to 1 (already set above)
    }

    // Per step, not per cycle, when the steps are scheduled — and that isn't a
    // preference. getStreakOutcome measures the gap against the recurrence's
    // own cadence, so a 5-step daily rotation advancing its streak once per
    // cycle would show a 5-day gap against an expected 1 and read as 'reset'
    // every single time round: a streak that can never exceed 1.
    const streakAdvances = !missed && recurs && datesBySchedule;
    // A missed occurrence breaks the streak where a completed one advances it.
    // Both write through the same previous* snapshot, so uncompleteTask undoes
    // either one without needing to know which happened.
    const streakBreaks = missed && recurs && datesBySchedule;

    // "Extra task" — every Nth completion adds a separate one-off task (see
    // Task.extraTaskEveryN). The tally is advanced here, not derived from the
    // completed rows, which completedRetentionDays eventually purges.
    //
    // Gated on advancesBySchedule for the same reason the streak is: mid-chain
    // a completion is one *step* of the task rather than a completion of it,
    // so a three-step chain would otherwise reach "every 4th" in a day and a
    // bit. A miss doesn't count either — the rule counts completions, and
    // markMissed comes through here too.
    const extraRule = extraTaskRule(task);
    const extraAdvance = extraRule && !missed && advancesBySchedule
      ? advanceExtraTaskTally(task.extraTaskTally, extraRule.everyN)
      : null;
    const nextExtraTally = extraAdvance ? extraAdvance.tally : task.extraTaskTally;

    const completed: Task = {
      ...task,
      completed: true,
      completedAt: now.toISOString(),
      // What makes this row a miss rather than a completion. It is set
      // alongside `completed`, never instead of it — see Task.missedAt.
      missedAt: missed ? now.toISOString() : task.missedAt,
      // Pin is cleared once the completion hold below expires, not
      // immediately — otherwise a pinned row would vanish from the Pinned
      // section instantly instead of getting the same fade-out grace period
      // every other list gives a completed task.
      streakCount: streakBreaks ? 0 : streakAdvances ? newStreakCount : task.streakCount,
      streakDate: streakBreaks ? null : streakAdvances ? getCurrentDayStart().toISOString() : task.streakDate,
      previousStreakCount: task.streakCount,
      previousStreakDate: task.streakDate,
      // Completing a quota task outright (the last unit, a swipe, a bulk
      // action) means the whole quota is done, so the row reads 8/8 rather
      // than being logged as a partial (see isQuotaPartial). A miss keeps
      // whatever count it actually reached — that's the record of the day, the
      // same way rolloverQuotas leaves a partial alone.
      //
      // allowOvershoot is the one exception: its whole point is a tally that
      // can land over, at, or under target, so clamping it here would erase
      // the overshoot the sweep exists to preserve (see sweepOvershootQuotas).
      progressCount: isQuotaTask(task) && !missed && !task.allowOvershoot ? task.targetCount! : task.progressCount,
      // What was decided, where the caller had somewhere to ask. Omitted means
      // "nobody asked" — every non-interactive path (bulk, cascade, widget,
      // sweep) and every miss — which completes the row exactly as it did
      // before this feature existed, keeping whatever was already there rather
      // than nulling it. Explicit null is the user declining to answer.
      deliverableValue: options?.deliverableValue !== undefined
        ? options.deliverableValue
        : task.deliverableValue,
      extraTaskTally: nextExtraTally,
      previousExtraTaskTally: task.extraTaskTally,
    };
    if (task.pinned) pendingUnpinIds.push(id);
    dbUpdateTask(completed);
    // A completed row has nothing left to be late for — its deadline event,
    // if it had one, is deleted rather than left dangling on the calendar.
    reconcileDeadlineEvent(completed);

    cancelTaskReminder(id);

    let nextTask: Task | null = null;
    let nextSubtasks: Task[] = [];
    const spawnsNext = chainAdvances ? (recurs || !atChainEnd) : recurs;
    if (spawnsNext) {
      // The recurrence's schedule only decides the date at the point it
      // actually applies (see advancesBySchedule above) — everywhere else
      // there's no date to compute.
      const nextDue = recurs && datesBySchedule ? getNextDueDate(task, dayResetTime) : null;
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
        // Under per-step scheduling nextDue is set on every step, so it wins
        // and midChainDue never applies. The one case it still catches there
        // is a rotation whose recurrenceEndDate has passed: getNextDueDate
        // returns null, and the remaining steps land on today rather than
        // losing their date and dropping out of view. Ending the *repeat* is
        // not a request to abandon the run that's already in progress — the
        // spawn-skip below is likewise gated on advancesBySchedule, so a
        // rotation can only stop at the wrap, never half-finished.
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
          // Derived, not random: completing this task on two devices while
          // they are apart must produce one successor, not two. See syncIds.
          id: derivedId(spawnSeed.occurrence(task.id)),
          completed: false,
          completedAt: null,
          missedAt: null, // a miss belongs to the occurrence that was missed, never to its successor
          // Same reasoning one field up: the drip dated the occurrence that was
          // just completed, not this one, whose date came from the schedule.
          autoScheduledAt: null,
          createdAt: now.toISOString(),
          seenAt: now.toISOString(),
          dueDate: effectiveDue ? effectiveDue.toISOString() : null,
          deadline: nextDeadline,
          deferUntil: null,
          pinned: false, // pin resets on new occurrence
          progressCount: 0, // a quota starts the new day empty
          // The question carries via ...effective, the answer doesn't: this
          // occurrence hasn't been decided yet. Same split actualMinutes makes,
          // and it's what turns a recurring decision task's Logbook into the
          // log of its answers rather than one answer copied forward for ever.
          deliverableValue: null,
          // The pushes belong to the occurrence that was pushed. postponeMuted
          // deliberately isn't reset here — it rides through on ...effective,
          // because "stop asking about this one" is a statement about the task,
          // not about today's row, and a muted chore would otherwise start
          // nagging again next week just as the count climbs back.
          postponeCount: 0,
          // Cleared with it: a fresh occurrence has no run of pushes, so it has
          // no day one started from.
          driftingSince: null,
          // Carries the broken streak forward on a miss, not the pre-miss one:
          // the streak lives on whichever row is currently running it, so
          // resetting only the missed row would hand the next occurrence the
          // old count straight back and the break would never be visible.
          streakCount: streakBreaks ? 0 : streakAdvances ? newStreakCount : task.streakCount,
          streakDate: streakBreaks ? null : streakAdvances ? getCurrentDayStart().toISOString() : task.streakDate,
          previousStreakCount: task.streakCount,
          previousStreakDate: task.streakDate,
          // Rides onto the successor like the streak does, and for the same
          // reason: every occurrence is a fresh id, so a tally left on the
          // completed row would restart the count from zero every time.
          extraTaskTally: nextExtraTally,
          previousExtraTaskTally: task.extraTaskTally,
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
          // Carries via ...effective otherwise, and must not: the source this
          // points at is still the same meal, the same catalog row, the same
          // container, so a spawned occurrence would be a second task claiming
          // it — enough to make the reconcile decline to create the real one
          // later, and enough for a stray tick to un-cook a night that already
          // happened or reopen a leftover already closed out. A generated task
          // is a one-off by construction (nothing gives one a recurrence rule);
          // this is the defensive half of that, for a row the user made
          // recurring by hand.
          //
          // **A mid-chain step is the exception, and it's the case the rule
          // above was never about.** The reasoning is a *recurrence* one — a
          // second occupant claiming a source the first one already answered.
          // Stepping from "Choose lunch" to "Prepare lunch" isn't a second
          // claimant, it's the same run continuing, and exactly one row is live
          // at any point in it. Cleared here, a chained generated task loses
          // its identity at step two: its reconcile stops finding it (so a plan
          // change no longer reaches the row), its delete stops writing an
          // opt-out, and the next firing pass, seeing nothing live, writes a
          // duplicate underneath it. So the clear stops at the wrap: the last
          // step of a repeating chain starts a fresh cycle and does have to let
          // go, which is what `!atChainEnd` says. See utils/mealSlotTasks.ts,
          // the first generator whose task is a chain.
          generatedKind: chainAdvances && !atChainEnd ? effective.generatedKind : null,
          generatedSourceId: chainAdvances && !atChainEnd ? effective.generatedSourceId : null,
          // Never carried forward: the old occurrence's device event still
          // shows the old deadline, and this is a fresh row with a fresh
          // deadline (nextDeadline above) that needs its own event, created
          // by the reconcile call below.
          calendarEventId: null,
          // Nor this: last Tuesday's block was time spent on last Tuesday's
          // occurrence. The next one starts unblocked, and asking for a slot
          // is a decision the user makes per occurrence — there is no
          // reconcile here to create one, deliberately.
          timeBlockEventId: null,
        };
        dbInsertTask(nextTask);
        scheduleTaskReminder(nextTask);
        reconcileDeadlineEvent(nextTask);

        // Subtasks belong to the series, not a single occurrence — carry them
        // onto the fresh occurrence the same way duplicateTask does, reset to
        // unchecked (a subtask always starts unchecked — see TemplateItem.subtasks).
        // Chains spawn a new row on every step, so without this a chained
        // task's subtasks would vanish after the first step.
        nextSubtasks = get().subtasksOf(task.id).map(sub => ({
          ...sub,
          id: derivedId(spawnSeed.subtask(nextTask!.id, sub.id)),
          parentId: nextTask!.id,
          completed: false,
          completedAt: null,
          missedAt: null,
          autoScheduledAt: null,
          createdAt: now.toISOString(),
          seenAt: now.toISOString(),
        }));
        nextSubtasks.forEach(sub => {
          dbInsertTask(sub);
          scheduleTaskReminder(sub);
        });
      }
    }

    // The extra task is due on the *next* occurrence's day rather than piling
    // onto the completion that earned it — you rosin the bow at the bench, and
    // the practice that just finished is over. With no next occurrence (a
    // one-off, or a series that has run out) there's nothing to ride, so it
    // lands today.
    //
    // A top-level row rather than a subtask of the occurrence: every top-level
    // selector filters `!t.parentId`, so a subtask would only ever be visible
    // inside the practice row, couldn't be moved to another day on its own,
    // and would disappear the moment its parent was ticked.
    //
    // What the added task looks like past its title is the rule's own
    // `draft` (Task.extraTaskDraft) when there is one. With none — every rule
    // written before drafts existed — each field below falls back to exactly
    // what it was: filed where the spawning task lives, and `undefined` for
    // priority and effort so newTaskFromDraft's new-task defaults still
    // apply. What the draft deliberately can't name is the stack: a stack
    // owns its members' category and cascades over them, and this is a
    // different piece of work that happens to have been earned by one of
    // them.
    let extraTask: Task | null = null;
    let extraSubtasks: Task[] = [];
    if (extraRule && extraAdvance?.spawns) {
      const maxOrder = get().tasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
      const spec = extraRule.draft;
      extraTask = newTaskFromDraft({
        title: extraRule.title,
        dueDate: nextTask?.dueDate ?? getCurrentDayStart().toISOString(),
        notes: spec?.notes ?? '',
        // Null on the draft means "the same as the task that spawned it", so
        // it doesn't sit loose above the categories — see ExtraTaskDraft.
        category: spec?.category ?? task.category,
        projectId: spec?.projectId ?? task.projectId,
        tags: spec?.tags ?? [],
        // undefined, not 0, when there's no draft: 0 is a real answer here
        // and would override a configured new-task default.
        priority: spec?.priority,
        effort: spec?.effort,
        estimatedMinutes: spec?.estimatedMinutes ?? null,
        timeSegments: spec?.timeSegments ?? [],
        // Undo comes free: uncompleteTask deletes every uncompleted row
        // pointing back at the completion being undone, which is exactly the
        // scope wanted here — undoing the 4th practice takes the rosin task
        // with it, and the tally goes back with the restored row.
        previousOccurrenceId: task.id,
      }, now.toISOString(), maxOrder + 1);
      // Derived for the same reason the occurrence above is: one milestone
      // task per completion, however many devices saw that completion.
      extraTask = { ...extraTask, id: derivedId(spawnSeed.extra(task.id)) };
      dbInsertTask(extraTask);

      // Real subtask rows, since that's the only thing a subtask ever is
      // here — the draft holds title-only stubs, like TemplateItem.subtasks.
      // They ride the same undo as their parent: uncompleteTask deletes the
      // subtasks of every follow-up it takes back.
      const parentId = extraTask.id;
      extraSubtasks = (spec?.subtasks ?? []).map((sub, i) => newTaskFromDraft(
        // The new-task defaults are for a task someone is creating, and a
        // checklist step under one isn't that — addSubtask spells out a bare
        // row for the same reason, so category, priority and effort are said
        // rather than left to fall through.
        { title: sub.title, parentId, priority: 0, effort: 0 },
        now.toISOString(),
        i + 1,
        false,
        derivedId(spawnSeed.subtask(parentId, sub.id)),
        true,
      ));
      extraSubtasks.forEach(sub => dbInsertTask(sub));
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
            // Derived per date, so a rollover triggered on two devices lands
            // on one row per date rather than two. See syncIds.
            id: derivedId(spawnSeed.seriesDate(id, date.toISOString())),
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
        ...(extraTask ? [extraTask] : []),
        ...extraSubtasks,
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
    // Never on a miss: the setting archives a project whose work is *finished*,
    // and projectProgress agrees (a group of nothing but missed rows isn't
    // done). Filing a project away because its last task went undone would be
    // the opposite of what the toggle promises.
    let autoArchivedProjectId: string | null = null;
    if (!missed && task.projectId && useSettingsStore.getState().autoArchiveProjectsOnComplete) {
      const progress = projectProgress(task.projectId, get().tasks);
      const project = useProjectStore.getState().getProjectById(task.projectId);
      if (progress.total > 0 && progress.done === progress.total && project && !project.archived) {
        useProjectStore.getState().applyProjectArchived(task.projectId, true);
        autoArchivedProjectId = task.projectId;
      }
    }

    // Ticking a "Cook X" task off marks its meal cooked, and bumps the recipe's
    // counters exactly as ticking the meal itself would (#1402) — the cook task
    // is a second control on one thing, so it can't be a lesser version of the
    // control on the meal plan screen. Like the auto-archive above it, this
    // rides on the completion's own undo rather than registering an action of
    // its own: it wasn't a separate thing the user did.
    //
    // Placed after the set() so the task is already committed as completed,
    // which is what makes the call back into this store from setCooked a no-op.
    // Never on a miss — marking a task missed says the cooking didn't happen.
    //
    // A meal task asks the same question one step later. A cook task answered
    // it by existing — one task, one tick, one cooking — but a chain's first
    // tick is "I've decided what to have", which is nowhere near having had it.
    // So only the step that finishes the chain counts (completesMealSlot), and
    // a slot with nothing planned in it has no meal to mark either way.
    const cookedEntryId =
      generatedSourceOf(task, 'mealCook') ??
      (completesMealSlot(task) ? mealSlotEntryId(task) : null);
    const undoMealCooked = !missed && cookedEntryId
      ? useMealPlanStore.getState().setCookedPaired(cookedEntryId, true)
      : null;

    // Ticking a "Use up X" task off is the moment the user can say what
    // actually happened to the thing it's about — surfaced immediately as
    // that item's own resolve sheet (UseUpResolveSheet, mounted in
    // AppNavigator like the trip bar and demo banner, since completion can
    // land here from Today, Search, Waiting, the widget, or a bulk-complete,
    // not just one screen) rather than left as a checked-off reminder with
    // the pantry or fridge untouched. Never on a miss, same as the cook
    // pairing above: a missed deadline didn't resolve anything.
    if (!missed) {
      const groceryUseUpId = generatedSourceOf(task, 'groceryUseUp');
      if (groceryUseUpId) useGroceryStore.getState().setPendingUseUpItem(groceryUseUpId);
      const leftoverUseUpId = generatedSourceOf(task, 'leftoverUseUp');
      if (leftoverUseUpId) useLeftoverStore.getState().setPendingUseUpLeftover(leftoverUseUpId);
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
      label: missed ? 'Task marked missed' : 'Task completed',
      undo: () => {
        if (autoArchivedProjectId) {
          useProjectStore.getState().applyProjectArchived(autoArchivedProjectId, false);
        }
        // Before uncompleteTask, which would otherwise un-cook the meal on its
        // own and leave the recipe's counters bumped — this closure puts both
        // back together, and by then the entry is no longer cooked so
        // uncompleteTask's own sync finds nothing to do.
        undoMealCooked?.();
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
      // Re-opening a missed occurrence puts it back on the board as ordinary
      // outstanding work — the whole point of undoing a miss. Nothing else is
      // needed to restore the streak it broke: the snapshot below covers it,
      // exactly as it covers an undone completion.
      missedAt: null,
      // Restore the streak to what it was before this completion, so
      // undoing a completion (e.g. from the Logbook) doesn't leave the
      // streak incremented for something that no longer happened.
      streakCount: task.previousStreakCount,
      streakDate: task.previousStreakDate,
      // A re-opened quota task sits one unit short of its target rather than
      // at a completed-looking 8/8 — undoing the last glass leaves you at 7/8.
      // A missed one is exempt: marking missed never forced the count up to the
      // target the way completing does, so its progressCount is already the
      // real one and pulling it down to target-1 would invent progress.
      progressCount:
        isQuotaTask(task) && !isMissed(task) ? Math.max(0, task.targetCount! - 1) : task.progressCount,
      // Same restore as the streak, and it has to be a snapshot rather than a
      // decrement: a completion that fired the rule reset the tally to 0, so
      // subtracting one would leave it at 0 and the next completion would fire
      // again immediately. The extra task itself is deleted below, as an
      // uncompleted row pointing back at this one.
      extraTaskTally: task.previousExtraTaskTally,
    };
    dbUpdateTask(updated);
    // Reopened, so a deadline it still carries is live again.
    reconcileDeadlineEvent(updated);

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

    // Un-ticking a cook task un-cooks its meal — the plain "not cooked now"
    // claim, so the recipe's counters are deliberately left alone (see
    // MealPlanScreen's setCooked for why undo and un-tick differ here). Safe to
    // call unconditionally: the entry is already un-cooked when this runs as
    // part of a completion's undo, so setCooked returns early.
    const uncookedEntryId =
      generatedSourceOf(task, 'mealCook') ??
      // The mirror of the completion's own test: un-ticking the step that ended
      // the chain is the one that un-cooks the meal. Read off the row as it
      // stands, which is the step that was ticked — the chain hasn't moved on,
      // since finishing one spawns nothing.
      (completesMealSlot(task) ? mealSlotEntryId(task) : null);
    if (uncookedEntryId) useMealPlanStore.getState().setCooked(uncookedEntryId, false);

    // Un-ticking a "Use up X" task retracts whatever resolve prompt it just
    // triggered — same reasoning as the cook pairing above, and unconditional
    // for the same reason setCooked's own clear is: the flag is session-only
    // with nothing durable to reconcile, so clearing it outright is simpler
    // than checking whose it currently is.
    if (generatedSourceOf(task, 'groceryUseUp')) useGroceryStore.getState().setPendingUseUpItem(null);
    if (generatedSourceOf(task, 'leftoverUseUp')) useLeftoverStore.getState().setPendingUseUpLeftover(null);

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

  setDeliverableValue(id, value) {
    const task = get().tasks.find(t => t.id === id);
    // Guarded on the kind, not on `completed`: the answer belongs to a task
    // that asks a question, and a row can be un-completed and re-completed
    // without the answer needing to be retyped.
    if (!task || task.deliverableKind === null) return;
    const previous = task.deliverableValue;
    if (previous === value) return;
    const updated = { ...task, deliverableValue: value };
    dbUpdateTask(updated);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? updated : t)) }));
    get().setLastAction({
      label: value === null ? 'Answer cleared' : 'Answer saved',
      undo: () => get().setDeliverableValue(id, previous),
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
    // See schedulePaceUnpin above — a pinned target that this unit just
    // caught up to pace unpins itself after a grace window, rather than
    // sitting pinned at the top of Today until the next unit falls due.
    if (updated.pinned && isQuotaOnPace(updated)) {
      schedulePaceUnpin(id);
    }
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
      // allowOvershoot tasks get their own sweep (sweepOvershootQuotas, below)
      // that goes through completeTask so an overshot count survives — this
      // manual close always writes progressCount as-is but forces
      // streakCount to 0, which is right for a shortfall but wrong for a
      // task that actually met or beat its target.
      !t.allowOvershoot &&
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
        id: derivedId(spawnSeed.catchUp(task.id)),
        completed: false,
        completedAt: null,
        missedAt: null,
        autoScheduledAt: null,
        createdAt: now,
        seenAt: now,
        dueDate: nextDue.toISOString(),
        deferUntil: null,
        pinned: false,
        progressCount: 0,
        // Same as completeTask's successor: the count resets, the mute carries.
        postponeCount: 0,
        driftingSince: null,
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

  // Closes out allowOvershoot quota tasks whose day has ended — the opt-in
  // counterpart to rolloverQuotas above, kept separate because the two need
  // different completion paths. rolloverQuotas' manual close forces
  // streakCount to 0 unconditionally, which is right for a task that's
  // simply been abandoned but wrong here: an allowOvershoot completion is
  // never a miss (see below), so it should advance the streak exactly as any
  // other non-missed completeTask call does, on the recurrence's normal
  // cadence check, regardless of whether the tally landed under, at, or over
  // target. Routing it through completeTask gets that for free, plus the
  // recurrence spawn and Logbook entry every other completion gets. See the
  // allowOvershoot branch on completeTask's progressCount line for why the
  // tally itself survives uncapped.
  //
  // Gated on progressCount > 0 — deliberately, and unlike rolloverQuotas
  // above. A target the user never touched today isn't "done with 0 of 12",
  // it's simply not due yet resolved, so it's left overdue like any other
  // undone task rather than manufactured into a completion record nobody
  // asked for.
  //
  // Never passes { missed: true }: the user opted into "let this ride to
  // end of day" for this specific task, a deliberate choice to defer
  // judgment on the exact count, not a signal they expect to be marked as
  // having failed it (see CLAUDE.md).
  sweepOvershootQuotas() {
    const { dayResetTime } = useSettingsStore.getState();
    const todayStart = getCurrentDayStart();
    const stale = get().tasks.filter(t =>
      t.allowOvershoot &&
      isQuotaTask(t) &&
      !t.completed &&
      !t.archived &&
      t.progressCount > 0 &&
      !isHiddenForVacation(t) &&
      t.dueDate !== null &&
      getTaskDayStart(new Date(t.dueDate), dayResetTime) < todayStart
    );
    stale.forEach(t => get().completeTask(t.id));
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

  applyTitleRuleToExisting(rule) {
    const entries = titleRuleBacklog(get().tasks, rule);
    if (entries.length === 0) return 0;

    // Snapshotted before anything is written, so the whole catch-up undoes as
    // one action — the shape deloadTasks below uses, and for the same reason:
    // a fan-out of N separate undo entries is N shakes to put one decision
    // back. Only the five fields a rule can fill are captured; the undo is a
    // narrow patch, never a whole-task replay.
    const snapshots = entries.map(({ task }) => ({
      id: task.id,
      category: task.category,
      projectId: task.projectId,
      priority: task.priority,
      effort: task.effort,
      tags: task.tags,
    }));

    dbTransaction(() => {
      entries.forEach(e => get().updateTask(e.task.id, e.updates));
    });

    get().setLastAction({
      label: `${entries.length} task${entries.length === 1 ? '' : 's'} filed`,
      undo: () => snapshots.forEach(s => get().updateTask(s.id, {
        category: s.category,
        projectId: s.projectId,
        priority: s.priority,
        effort: s.effort,
        tags: s.tags,
      })),
    });
    return entries.length;
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

    // postponeCount rides along in the snapshot because the undo below is a
    // narrow patch, not a whole-task replay: without it the restore moves each
    // date *backward*, which reads as "resolved" and would zero a count the
    // user never resolved. See utils/postpone.ts.
    const snapshots = applied.map(m => {
      const t = byId.get(m.id)!;
      return { id: m.id, dueDate: t.dueDate, deferUntil: t.deferUntil, postponeCount: t.postponeCount };
    });

    // Deliberately counted, unlike every other engine-proposed move here:
    // "Lighten this day" is the most explicit *I am pushing today's work* action
    // in the app, and exempting it would leave the person who deloads six days
    // running sitting at a count of zero — exactly the person the prompt exists
    // for. The prompt still only ever appears in the date picker, so a task
    // moved in a batch is noted here and mentioned later, not accused now.
    dbTransaction(() => {
      applied.forEach(m => get().updateTask(m.id, m.updates));
    });

    get().setLastAction({
      label: `${applied.length} task${applied.length === 1 ? '' : 's'} moved`,
      undo: () => snapshots.forEach(s =>
        get().updateTask(s.id, { dueDate: s.dueDate, deferUntil: s.deferUntil, postponeCount: s.postponeCount })
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

    // Never counted, both ways: this pulls tasks *in*, and its members are
    // undated by construction (see findProjectStalls), so there's no earlier
    // date for the rule to compare against anyway. Belt and braces.
    dbTransaction(() => {
      applied.forEach(m => get().updateTask(m.id, m.updates, { skipPostponeCount: true }));
    });

    // This is the direct, user-initiated action that resolves a project's
    // "quiet" state, including from the review task's own row — don't make
    // that wait for the next launch/foreground sweep to notice.
    get().checkProjectReviewTasks();

    get().setLastAction({
      label: `${applied.length} task${applied.length === 1 ? '' : 's'} pulled in`,
      undo: () => snapshots.forEach(s =>
        get().updateTask(s.id, { dueDate: s.dueDate, deferUntil: s.deferUntil }, { skipPostponeCount: true })
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
        const today = getCurrentDayStart();
        today.setHours(12, 0, 0, 0);
        // The stamp goes on here rather than inside projectPullUpdates, which
        // the pull sheet shares: a date the user picked off a proposal is a
        // date the user picked, and has nothing to explain or to back off from.
        // Real `now`, not the noon dueDate — it records when this ran, and the
        // day it belongs to is resolved by the same getDayStart the back-off
        // check uses, so the two always agree about which logical day it was.
        const updates: Partial<Task> = {
          ...projectPullUpdates(today),
          autoScheduledAt: new Date().toISOString(),
        };
        return { id: task.id, updates };
      })
      .filter((p): p is { id: string; updates: Partial<Task> } => p !== null);

    if (picks.length === 0) return;

    // Never counted: nobody performed this. (Like the pull it shares updates
    // with, the candidates are undated anyway, so the rule couldn't fire.)
    dbTransaction(() => {
      picks.forEach(p => get().updateTask(p.id, p.updates, { skipPostponeCount: true }));
    });

    // Deliberately no setLastAction: an unattended background write must not
    // occupy the undo slot for an action the user never saw. It surfaces
    // through machinery that already exists instead — the newly dated task has
    // an old seenAt and a dueDate of today, so isTaskNew is true and it shows
    // up in the existing NewTasksBanner with a new dot.
  },

  checkMealPlanNudge() {
    const settings = useSettingsStore.getState();
    // Checked alongside mealPlanNudgeEnabled rather than switching it off:
    // this is the loudest thing the kitchen area does when nobody's looking —
    // it creates a task, carrying a link to a screen the menu no longer lists.
    // Skipping without recording weekKey, like the vacation gate below, so the
    // nudge resumes properly if the area comes back mid-week.
    if (!settings.kitchenEnabled) return;
    if (!settings.mealPlanNudgeEnabled) return;
    // Same reasoning as findProjectStalls' vacation gate: every route out of
    // this check creates a task unattended, and vacation is a deliberate
    // "hide work from me" the user set today. Deliberately doesn't record
    // weekKey when skipped this way, so the same week's trigger fires for
    // real the first time the app is opened after vacation ends.
    if (settings.vacationMode) return;

    const due = dueMealPlanNudge(
      new Date(),
      settings.weekStartsOn,
      settings.mealPlanNudgeWeekday,
      settings.mealPlanNudgeTime,
      settings.mealPlanNudgeLastFiredWeekKey
    );
    if (!due) return;

    // Recorded before the suppression checks below, and unconditionally: a
    // week that's already handled — planned, or still carrying last week's
    // untouched nudge — must not be re-diagnosed the same way on every later
    // launch this week either, so every outcome counts as "handled" for the
    // idempotency key's purposes.
    settings.setMealPlanNudgeLastFiredWeekKey(due.weekKey);

    // This is a fresh write every week, not one recurring row that only spawns
    // its successor on completion (see mealPlanNudge.ts) — so without a gate,
    // ignoring one nudge would pile up another set every week instead of just
    // leaving the same tasks unread. `current` is this week's set, which blocks
    // a second one; `stale` is a previous week's, asking about days that have
    // already happened.
    const { current, stale } = partitionMealPlanNudgeTasks(get().tasks, due);
    stale.forEach(task => deleteGeneratedTaskQuietly(task.id));
    if (current.length > 0) return;

    const plannedEntries = dbGetMealPlanEntries(due.targetWeekStartKey, due.targetWeekEndKey);
    if (mealPlanNudgeSuppressed(due, plannedEntries)) return;

    // Filed like the other three generators' tasks. Without this the one thing
    // the app writes entirely on its own schedule was also the one with no
    // category, so it landed loose above every section.
    const category = settings.mealPlanNudgeTaskCategory;
    const groupStore = useTaskGroupStore.getState();

    // One stack, reused and retitled week after week (see mealPlanNudgeGroupId).
    // Resolve-or-shrug: a stack the user deleted reads back as null here and a
    // new one takes its place, rather than the week's tasks landing loose
    // because a row went missing.
    const existing = settings.mealPlanNudgeGroupId
      ? groupStore.getGroupById(settings.mealPlanNudgeGroupId)
      : null;
    const group = existing ?? groupStore.createGroup(due.title, category);
    if (existing) {
      groupStore.updateGroup(group.id, { title: due.title, category });
    } else {
      // Stacks are created collapsed, which is right for one a person just
      // built out of tasks they picked — they know what's in it. A stack that
      // appears unattended showing "0 of 7 done today" and no rows hides the
      // whole week behind a chevron nobody was told to tap. Only on creation:
      // a stack the user collapsed last week stays collapsed.
      groupStore.setGroupCollapsed(group.id, false);
    }
    if (group.id !== settings.mealPlanNudgeGroupId) {
      settings.setMealPlanNudgeGroupId(group.id);
    }

    due.days.forEach((day, index) => {
      const task = get().addTask({
        title: day.title,
        // Every day shares the firing day's due date rather than taking its
        // own — see mealPlanNudge.ts. Planning next week is work for today.
        dueDate: due.dueDate.toISOString(),
        // The link opens the Meal Plan screen on this task's own day. It no
        // longer doubles as the marker saying who wrote the task — generatedKind
        // does that now, for this generator as for the other three.
        linkUrl: mealPlanNudgeLinkUrl(day.dayKey),
        category,
        groupId: group.id,
        ...generatedBy('mealPlanNudge', day.dayKey),
        // skipTitleRules for the reason generatedTaskSync passes it: "Plan
        // meals for Monday" is a title the app wrote, and this generator has
        // its own "File them under" setting (mealPlanNudgeTaskCategory). A
        // user rule matching one of its words would file it somewhere that
        // setting didn't say.
      }, derivedId(spawnSeed.generated(
        'mealPlanNudge',
        day.dayKey,
        generatedTaskCountOf(get().tasks, 'mealPlanNudge', day.dayKey)
      )), { skipTitleRules: true });
      // The stack's own 1..K order, which is a separate number space from the
      // list order addTask just stamped (see reorderGroupChildren). Set the way
      // groupTasks sets it, so the rows read down the week.
      get().updateTask(task.id, { sortOrder: index + 1 }, { skipPostponeCount: true });
    });
    // Deliberately no setLastAction, same reasoning as dripStalledProjects:
    // an unattended background write shouldn't occupy the shake-to-undo slot
    // for an action nobody saw happen.
  },

  checkProjectReviewTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.projectReviewTasks) return;

    const tasks = get().tasks;
    const projects = useProjectStore.getState().projects;
    // 'nudge' mode, like the banner this replaced: every route out of here
    // writes a task nobody asked for, so each project's own cadence still
    // decides whether the app speaks first. Opening the pull sheet by hand
    // asks in 'ask' mode and sees more (see StallMode) — the two disagreeing
    // is the design.
    //
    // Vacation needs no gate of its own here: findProjectStalls returns
    // nothing while it's on, so every live review task falls into `stale`
    // below and is cleared. That's the right reading of a deliberate "hide
    // work from me" — and clearing them costs nothing, since the sweep after
    // vacation ends writes them straight back.
    const stalls = findProjectStalls(projects, tasks, 'nudge');
    // Anything already ticked off or archived today is left alone rather than
    // handed straight back — see projectsReviewedToday.
    const wanted = wantedProjectReviews(stalls, projectsReviewedToday(tasks));

    // Clear first, create second, and never the reverse: the stale set
    // includes the task for a project the user has just acted on from this
    // very row, and a create pass that ran first would be deciding against a
    // list still holding it. Judged against every stall rather than against
    // the capped `wanted` — see staleProjectReviewTasks.
    const stale = staleProjectReviewTasks(tasks, stalls);
    // dropGeneratedTask, not deleteGeneratedTaskQuietly: that one routes
    // through deleteTask, which writes the source's opt-out — here it would
    // stamp reviewDeclinedAt on a project the user never touched, and so
    // suppress tomorrow's task on the strength of the app's own tidying up.
    // Only a delete the *user* performs is an instruction to the source.
    stale.forEach(task => dropGeneratedTask('projectReview', projectReviewProjectId(task)));

    if (wanted.length === 0) return;

    // The category is ensured here as well as at startup, because this
    // generator ships ON — nobody flips the switch that would otherwise create
    // it, so without this the very first review task would land in the loose
    // block above every section, which is exactly where the banner used to sit.
    ensureGeneratedTaskCategory('projectReview');
    const category = useSettingsStore.getState().projectReviewTaskCategory;
    // Noon today, the same landing dripStalledProjects picks and for the same
    // reason: an offer dated forward is an offer you can't see. Deferring it
    // afterwards is the user's own call, and one the banner never allowed.
    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    // Run over every want, not just the ones with no task yet: the shared
    // reconcile is what turns "wanted, none exists" into a create and "wanted,
    // one exists" into a drift check, and going through it is also what gets
    // this generator the derived id two unsynced devices need to agree on.
    wanted.forEach(want => {
      reconcileGeneratedTask({
        kind: 'projectReview',
        sourceId: want.projectId,
        // Never false: the not-wanted half of this generator is decided over
        // the whole set at once, and was handled by the drop pass above. A
        // `false` here would delete through deleteTask and stamp the project
        // as declined.
        wanted: true,
        // The title is the only thing a live row chases, and only when the
        // project has been renamed under it. Deliberately not the due date: by
        // the time a second sweep runs the user may have deferred this row to
        // Saturday, and rewriting it back to today would undo the one thing
        // the banner could never do.
        drift: existing => (existing.title === want.title ? null : { title: want.title }),
        draft: () => ({
          title: want.title,
          dueDate: dueDate.toISOString(),
          // Opens the pull sheet scoped to this project alone — the same thing
          // tapping the banner's own project row used to do.
          linkUrl: projectReviewLinkUrl(want.projectId),
          category,
          // Deliberately no projectId: a dated member is what makes a project
          // *not* quiet, so filing this row into the project it describes
          // would delete it on the next sweep and recreate it on the one
          // after, for ever. See projectReviewTasks.ts.
          ...generatedBy('projectReview', want.projectId),
        }),
      });
    });
    // No setLastAction, same reasoning as checkMealPlanNudge above.
  },

  /**
   * Lay down meal tasks for the days ahead — one per meal the user says they
   * eat, for each day out to `MEAL_SLOT_TASK_DAYS`.
   *
   * The generator `mealCook` folded into (see utils/mealSlotTasks.ts). A cook
   * task was projected from a *meal*, so it could only exist where one had
   * already been planned; this is projected from the *day*, so the slot nobody
   * has answered gets a row too, and its first step is answering it.
   *
   * **The written-through mark is the whole opt-out**, and the reason this only
   * ever looks forward. A slot names a square on the calendar rather than a
   * row, so there is nowhere to write a per-source "no" the way a meal, a
   * grocery item or a leftover carries one — and a growing (kind, sourceId)
   * suppression record is the shape generatedTasks.ts warns against, because
   * nothing prunes it. A high-water mark solves it with one string: days at or
   * before it are never revisited, so a row the user deleted stays deleted, and
   * each launch writes the one new day that has come into range rather than
   * re-deciding the window.
   *
   * That is also what makes it cheap to run on every foreground.
   */
  checkMealSlotTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.mealCookTasks || settings.mealSlotsEnabled.length === 0) return;

    // The *logical* day, not the calendar one: at 1am with a 2am reset the meal
    // tasks that belong on screen are still yesterday's, and dayKeyOf(new Date())
    // would open the window a day early. See CLAUDE.md on the grace window.
    const today = dayKeyOf(getLogicalToday());
    const horizonEnd = shiftDayKey(today, MEAL_SLOT_TASK_DAYS - 1);
    const mark = settings.mealSlotTasksWrittenThroughDayKey;
    // A mark behind today means the app has been closed for a while: pick up
    // from today rather than filling in the days that have already gone past,
    // which is the one direction a meal task is no use in.
    const from = mark && mark >= today ? shiftDayKey(mark, 1) : today;
    if (from > horizonEnd) return;

    writeMealSlotTasks(from, horizonEnd, settings.mealSlotsEnabled);
    settings.setMealSlotTasksWrittenThroughDayKey(horizonEnd);
    // No setLastAction, same reasoning as checkMealPlanNudge above.
  },

  /**
   * Give the days already written the meals that have just been switched on.
   *
   * The counterpart to the mark never being rewound. Rewinding would make the
   * next pass rewrite the whole window, and rewriting a window is exactly what
   * resurrects a row the user deleted — turn breakfast on and last Thursday's
   * deleted dinner comes back with it. So the mark stands and this fills in the
   * one thing that changed, scoped to the added slots.
   *
   * Without it a newly-named meal would produce nothing until the horizon rolled
   * past the mark, which with a week's window is a week of silence after
   * answering a question in Settings.
   */
  backfillMealSlotTasks(slots) {
    const settings = useSettingsStore.getState();
    if (!settings.mealCookTasks || slots.length === 0) return;
    const today = dayKeyOf(getLogicalToday());
    const mark = settings.mealSlotTasksWrittenThroughDayKey;
    // Nothing written yet, or nothing still ahead of us: the ordinary pass has
    // the whole window to do and will pick these up with everything else.
    if (!mark || mark < today) return;
    writeMealSlotTasks(today, mark, slots);
  },

  checkPantryCheckTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.pantryCheckTasks) return;
    // The whole grocery area can be switched off (kitchenEnabled), and unlike
    // every other grocery generator this one fires on time passing rather than
    // on a purchase or an edit — so without this gate it would be the one part
    // of a hidden feature still writing rows onto Today.
    if (!settings.kitchenEnabled) return;

    const tasks = get().tasks;
    const items = useGroceryStore.getState().items;
    // One `now` for both passes: the qualifier is a day-count comparison, and
    // two clocks a few milliseconds apart could in principle have the create
    // pass disagree with the drop pass about a lapse landing exactly on the
    // boundary. Bare `new Date()` on purpose — a pantry window is measured in
    // real elapsed days from a till receipt, not in logical days (see the
    // dayResetTime note in CLAUDE.md, and isTaskExpired for the same call).
    const now = new Date();

    // Clear first, create second, and never the reverse — same ordering
    // checkProjectReviewTasks runs on, and for the same reason: the stale set
    // includes the row for an item the user has just answered from this very
    // task, and a create pass running first would be deciding against a list
    // that still held it.
    //
    // dropGeneratedTask rather than deleteGeneratedTaskQuietly: that routes
    // through deleteTask, which writes the source's opt-out — here it would
    // stamp pantryCheckDeclinedAt on an item the user never turned down, and so
    // suppress the question after the *next* purchase on the strength of the
    // app's own tidying up.
    const stale = stalePantryCheckTasks(tasks, items, now);
    stale.forEach(task => dropGeneratedTask('pantryCheck', pantryCheckItemId(task)));

    const wanted = wantedPantryChecks(items, tasks, now);
    if (wanted.length === 0) return;

    ensureGeneratedTaskCategory('pantryCheck');
    const category = useSettingsStore.getState().pantryCheckTaskCategory;
    // Noon today, the landing every other unattended writer picks: an offer
    // dated forward is an offer you can't see, and deferring it afterwards is
    // the user's own call.
    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    wanted.forEach(want => {
      reconcileGeneratedTask({
        kind: 'pantryCheck',
        sourceId: want.itemId,
        // Never false: the not-wanted half is decided over the whole catalog at
        // once and was handled by the drop pass above. A `false` here would
        // delete through deleteTask and stamp the item as declined.
        wanted: true,
        // The title is the only thing a live row chases, and only when the item
        // has been renamed under it. Deliberately not the due date: by the time
        // a second sweep runs the user may have deferred this row to Saturday,
        // and rewriting it back to today would take that back.
        drift: existing => (existing.title === want.title ? null : { title: want.title }),
        draft: () => ({
          title: want.title,
          dueDate: dueDate.toISOString(),
          // Opens the item's own sheet on the Pantry pills — the two answers
          // this row is asking for. See pantryCheckLinkUrl.
          linkUrl: pantryCheckLinkUrl(want.itemId),
          category,
          ...generatedBy('pantryCheck', want.itemId),
        }),
      });
    });
    // No setLastAction, same reasoning as checkMealPlanNudge above.
  },

  skipNextRecurrence(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.recurrenceType === 'none') return;
    // Mirror completeTask's advancesBySchedule split: a mid-chain step never
    // consults the recurrence schedule, so skipping one should only move the
    // chain position — pushing dueDate/recurrenceCount here would burn a full
    // cycle of the recurrence on a step that isn't scheduled at all.
    const { dayResetTime } = useSettingsStore.getState();
    const chainAdvances = task.chainEnabled && task.chainItems.length > 0;
    const atChainEnd = chainAdvances && task.chainIndex >= task.chainItems.length - 1;
    if (chainAdvances && !atChainEnd) {
      // With per-step scheduling the step being skipped occupies a day of its
      // own, so moving the position isn't enough — the date has to move with
      // it or the next step stays parked on the day the skipped one had.
      // recurrenceCount is left alone in both modes: skipping a step isn't
      // skipping a cycle (same reasoning as completeTask's two flags).
      if (!task.chainStepOnSchedule) {
        get().updateTask(id, { chainIndex: task.chainIndex + 1 });
        return;
      }
      const stepDue = getNextDueDate(task, dayResetTime);
      if (!stepDue) {
        get().updateTask(id, { chainIndex: task.chainIndex + 1 });
        return;
      }
      let stepReminderTime: string | null = task.reminderTime;
      if (task.reminderTime) {
        const original = new Date(task.reminderTime);
        const next = new Date(stepDue);
        next.setHours(original.getHours(), original.getMinutes(), 0, 0);
        stepReminderTime = next.toISOString();
      }
      get().updateTask(id, {
        chainIndex: task.chainIndex + 1,
        dueDate: stepDue.toISOString(),
        deferUntil: null,
        reminderTime: stepReminderTime,
      }, SKIP_POSTPONE);
      return;
    }
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
    }, SKIP_POSTPONE);
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

  /**
   * Hand-order the Pinned section. `orderedIds` is the section exactly as the
   * user just dragged it, which is the whole of it — unlike a stack's
   * children, a pinned row is never hidden from the section it's being
   * reordered in, so there's no reorderSubset fold to do here.
   *
   * Renumbers from 1 so no row is left on the 0 that means "never ranked".
   */
  reorderPinnedTasks(orderedIds) {
    if (orderedIds.length === 0) return;
    const updates = orderedIds.map((id, index) => ({ id, pinnedOrder: index + 1 }));
    dbBatchUpdatePinnedOrders(updates);
    const byId = new Map(updates.map(u => [u.id, { pinnedOrder: u.pinnedOrder }]));
    set(s => ({ tasks: patchTasksById(s.tasks, byId) }));
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
    const ranks = nextPinned ? freshPinRanks(get().tasks, ids) : null;
    dbBulkSetPinned(ids, nextPinned);
    if (ranks) dbBatchUpdatePinnedOrders(ranks);
    set(s => ({
      tasks: patchTasks(s.tasks, ids, t => ({
        pinned: nextPinned,
        ...rankFor(ranks, t.id),
      })),
    }));
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
      ...applyMeasuredTime(minutes),
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

  setMeasuredTime(id, minutes) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    get().updateTask(id, applyMeasuredTime(minutes));
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

  reorderProjectTasks(projectId, orderedIds) {
    const members = liveProjectSteps(projectId, get().tasks);
    const updates = slotUpdates(members, orderedIds);
    if (updates.length === 0) return;
    dbBatchUpdateSortOrders(updates);
    const byId = new Map(updates.map(u => [u.id, { sortOrder: u.sortOrder }]));
    set(s => ({ tasks: patchTasksById(s.tasks, byId) }));
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
      missedAt: null,
      autoScheduledAt: null,
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
      pinnedOrder: 0,
      priority: 0,
      effort: 0,
      estimatedMinutes: null,
      streakCount: 0,
      streakDate: null,
      previousStreakCount: 0,
      previousStreakDate: null,
      showStreak: false,
      streakRequiresWindow: false,
      parentId,
      groupId: null,
      projectId: null,
      targetCount: null,
      progressCount: 0,
      targetUnit: null,
      allowOvershoot: false,
      reminderTime: null,
      reminderKind: 'notification',
      chainEnabled: false,
      chainIndex: 0,
      chainItems: [],
      chainStepOnSchedule: false,
      extraTaskEveryN: null,
      extraTaskTitle: null,
      extraTaskDraft: null,
      extraTaskTally: 0,
      previousExtraTaskTally: 0,
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
      phoneNumber: null,
      emailAddress: null,
      blockedById: null,
      deliverableKind: null,
      deliverableValue: null,
      generatedKind: null,
      generatedSourceId: null,
      deadlineOnCalendar: false,
      calendarEventId: null,
      timeBlockEventId: null,
      pendingImport: null,
      postponeCount: 0,
      postponeMuted: false,
      driftingSince: null,
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
    // A subtask carrying a stretch of its parent's timer is part of that
    // timer's length (see utils/timerSegments.ts), so deleting it has to
    // re-total the parent — the editor is not the only place a subtask can go.
    // Deleting the *last* stretch leaves the total where it was rather than
    // clearing it: the split is gone, but the task is still a timed task of
    // that length, and a null here would quietly demote it to a plain one.
    const parent = subtask.parentId ? get().tasks.find(t => t.id === subtask.parentId) : undefined;
    const retotal = parent != null && parent.timedMinutes != null && segmentMinutesOf(subtask) !== null;
    const previousTotal = parent?.timedMinutes ?? null;

    dbDeleteTask(id);
    set(s => ({ tasks: s.tasks.filter(t => t.id !== id) }));

    if (retotal) {
      const total = apportionedMinutes(get().subtasksOf(parent!.id));
      if (total !== null) get().updateTask(parent!.id, { timedMinutes: total });
    }

    get().setLastAction({
      label: 'Subtask deleted',
      destructive: true,
      undo: () => {
        dbInsertTask(subtask);
        set(s => ({ tasks: [...s.tasks, subtask] }));
        if (retotal) get().updateTask(parent!.id, { timedMinutes: previousTotal });
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
      missedAt: null,
      autoScheduledAt: null,
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
      pinnedOrder: 0,
      priority: 0,
      effort: 0,
      estimatedMinutes: null,
      streakCount: 0,
      streakDate: null,
      previousStreakCount: 0,
      previousStreakDate: null,
      showStreak: false,
      streakRequiresWindow: false,
      parentId: null,
      groupId,
      projectId: null,
      targetCount: null,
      progressCount: 0,
      targetUnit: null,
      allowOvershoot: false,
      reminderTime: null,
      reminderKind: 'notification',
      chainEnabled: false,
      chainIndex: 0,
      chainItems: [],
      chainStepOnSchedule: false,
      extraTaskEveryN: null,
      extraTaskTitle: null,
      extraTaskDraft: null,
      extraTaskTally: 0,
      previousExtraTaskTally: 0,
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
      phoneNumber: null,
      emailAddress: null,
      blockedById: null,
      deliverableKind: null,
      deliverableValue: null,
      generatedKind: null,
      generatedSourceId: null,
      deadlineOnCalendar: false,
      calendarEventId: null,
      timeBlockEventId: null,
      pendingImport: null,
      postponeCount: 0,
      postponeMuted: false,
      driftingSince: null,
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
      destructive: true,
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

  // Same shape as archiveProject/unarchiveProject, plus the option to archive
  // whatever's still open in the project — never delete: completing a project
  // isn't a request to lose data, so the only cascade this offers is the
  // reversible one. Undo restores both the project and every task it archived.
  completeProject(projectId, opts) {
    const project = useProjectStore.getState().getProjectById(projectId);
    if (!project || project.completed) return;
    const members = get().tasks.filter(
      t => t.projectId === projectId && t.parentId === null && !t.completed && !t.archived
    );
    const undos: Array<() => void> = [];
    if (opts.archiveRemaining && members.length > 0) {
      dbTransaction(() => {
        members.forEach(member => {
          get().archiveTask(member.id);
          const action = get().lastAction;
          if (action) undos.push(action.undo);
        });
      });
    }
    useProjectStore.getState().applyProjectCompleted(projectId, true);
    get().setLastAction({
      label: opts.archiveRemaining && members.length > 0
        ? 'Project completed, remaining tasks archived'
        : 'Project completed',
      undo: () => {
        useProjectStore.getState().applyProjectCompleted(projectId, false);
        undos.forEach(fn => fn());
      },
    });
  },

  uncompleteProject(projectId) {
    const project = useProjectStore.getState().getProjectById(projectId);
    if (!project || !project.completed) return;
    const completedAt = project.completedAt;
    useProjectStore.getState().applyProjectCompleted(projectId, false);
    get().setLastAction({
      label: 'Project restored to active',
      undo: () => useProjectStore.getState().applyProjectCompleted(projectId, true, completedAt),
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
      destructive: true,
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

  // Bulk deletes go one project at a time — deleteProject already knows how to
  // unfile or cascade a project's tasks, and half of that logic copied here is
  // how the two drift apart. What can't be reused is the undo: each call leaves
  // its own entry, and the queue holds one, so the last project deleted would
  // be the only one a shake brings back. So each undo is collected and the
  // batch registers a single entry that runs all of them.
  bulkDeleteProjects(projectIds, opts) {
    const store = useProjectStore.getState();
    // Filtered to rows that exist, so a stale id can't leave the previous
    // action's undo in the batch below.
    const ids = projectIds.filter(id => store.getProjectById(id) !== null);
    if (ids.length === 0) return;
    const undos: Array<() => void> = [];
    ids.forEach(id => {
      get().deleteProject(id, opts);
      const action = get().lastAction;
      if (action) undos.push(action.undo);
    });
    get().setLastAction({
      label: `${ids.length} project${ids.length === 1 ? '' : 's'} deleted`,
      destructive: true,
      undo: () => undos.forEach(fn => fn()),
    });
  },

  bulkSetProjectArchived(projectIds, archived) {
    const idSet = new Set(projectIds);
    // Snapshotted before the write so undoing an unarchive can hand each
    // project back the day it was originally archived, exactly as
    // unarchiveProject does for one.
    const changed = useProjectStore
      .getState()
      .projects.filter(p => idSet.has(p.id) && p.archived !== archived);
    if (changed.length === 0) return;
    changed.forEach(p => useProjectStore.getState().applyProjectArchived(p.id, archived));
    get().setLastAction({
      label: `${changed.length} project${changed.length === 1 ? '' : 's'} ${archived ? 'archived' : 'restored'}`,
      undo: () =>
        changed.forEach(p =>
          useProjectStore.getState().applyProjectArchived(p.id, !archived, p.archivedAt),
        ),
    });
  },

  deleteTemplate(id) {
    const template = useTemplateStore.getState().templates.find(t => t.id === id);
    if (!template) return;
    useTemplateStore.getState().removeTemplateRow(id);
    get().setLastAction({
      label: 'Template deleted',
      destructive: true,
      undo: () => useTemplateStore.getState().restoreTemplate(template),
    });
  },

  // Same one-entry-per-batch rule as bulkDeleteProjects; the rows themselves are
  // snapshotted up front and re-inserted wholesale, which is all deleteTemplate's
  // undo does for one of them.
  bulkDeleteTemplates(ids) {
    const idSet = new Set(ids);
    const templates = useTemplateStore.getState().templates.filter(t => idSet.has(t.id));
    if (templates.length === 0) return;
    templates.forEach(t => useTemplateStore.getState().removeTemplateRow(t.id));
    get().setLastAction({
      label: `${templates.length} template${templates.length === 1 ? '' : 's'} deleted`,
      destructive: true,
      undo: () => templates.forEach(t => useTemplateStore.getState().restoreTemplate(t)),
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
      destructive: true,
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

  // Bulk equivalent of markMissed. Same per-task guard applies (recurring
  // and not already completed; a task not yet due rolls forward silently
  // instead of stamping a miss), so a mixed selection just skips whatever
  // doesn't qualify rather than needing its own filtering here.
  bulkMarkMissed(ids) {
    if (ids.length === 0) return;
    const missedIds: string[] = [];
    dbTransaction(() => {
      ids.forEach(id => {
        get().markMissed(id);
        if (get().tasks.find(t => t.id === id)?.missedAt) missedIds.push(id);
      });
    });
    if (missedIds.length === 0) return;
    get().setLastAction({
      label: `${missedIds.length} task${missedIds.length === 1 ? '' : 's'} marked missed`,
      undo: () => missedIds.forEach(id => get().uncompleteTask(id)),
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
      destructive: true,
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
      get().setLastAction({ label: 'Logbook cleared', destructive: true, undo });
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
    const ranks = nextPinned ? freshPinRanks(get().tasks, ids) : null;
    dbBulkSetPinned(ids, nextPinned);
    if (ranks) dbBatchUpdatePinnedOrders(ranks);
    set(s => ({
      tasks: patchTasks(s.tasks, ids, t => ({
        pinned: nextPinned,
        ...rankFor(ranks, t.id),
      })),
    }));
  },

  bulkDefer(ids, until) {
    if (ids.length === 0) return;
    const deferUntil = until.toISOString();
    const snapshots = ids
      .map(id => get().tasks.find(t => t.id === id))
      .filter((t): t is Task => t !== undefined)
      .map(t => ({ ...t }));
    const counts = bulkPostponeCounts(
      get().tasks, ids, { deferUntil }, useSettingsStore.getState().dayResetTime,
    );
    dbBulkSetDefer(ids, deferUntil);
    if (counts.size > 0) {
      dbBatchUpdatePostponeCounts([...counts].map(([id, moved]) => ({ id, ...moved })));
    }
    set(s => ({
      tasks: patchTasks(s.tasks, ids, t => ({
        deferUntil,
        ...(counts.get(t.id) ?? {}),
      })),
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
    const counts = bulkPostponeCounts(
      get().tasks, ids, { dueDate }, useSettingsStore.getState().dayResetTime,
    );
    dbBulkSetWhen(ids, dueDate, timeSegments);
    if (counts.size > 0) {
      dbBatchUpdatePostponeCounts([...counts].map(([id, moved]) => ({ id, ...moved })));
    }
    set(s => ({
      tasks: patchTasks(s.tasks, ids, t => ({
        dueDate,
        timeSegments,
        ...(counts.get(t.id) ?? {}),
      })),
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
    // Same rule as updateTask's recategorizedIntoNew, which this path doesn't
    // go through: the move itself must not turn a task "new". See the comment
    // there for why a suppressed category leaves a stale seenAt behind.
    const staleNew = get().tasks
      .filter(t => ids.includes(t.id) && t.category !== category)
      .filter(t => !isTaskNew(t) && isTaskNew({ ...t, category }))
      .map(t => t.id);
    dbBulkSetCategory(ids, category);
    set(s => ({ tasks: patchTasks(s.tasks, ids, { category }) }));
    get().markTasksSeen(staleNew);
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

  // Reads the user's own threshold rather than a constant of its own: the
  // screen and the date picker's prompt have to agree about what "keeps getting
  // pushed" means, or a task can be listed here while the picker stays silent
  // about it.
  //
  // Returns the raw, sorted Task[] — stable references DriftScreen can select
  // with useShallow — rather than driftingTasks()'s DriftEntry[] below, whose
  // freshly-built wrapper objects defeat that comparison every render.
  driftingTaskList() {
    return driftingTaskList(get().tasks, useSettingsStore.getState().postponeCheckThreshold);
  },

  driftingTasks() {
    return driftingTasks(get().tasks, useSettingsStore.getState().postponeCheckThreshold);
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
      // isHiddenForVacation alone says *why* a task is hidden, not whether it
      // would otherwise be on Today — isVisibleApartFromVacation is what makes
      // this "what vacation is currently hiding from today" rather than
      // "every vacation-paused task that exists".
      .filter(t => !t.parentId && isHiddenForVacation(t) && isVisibleApartFromVacation(t))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  pinnedTasks() {
    const { vacationMode } = useSettingsStore.getState();
    const { tasks, completionHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds)
      .filter(t => !t.parentId && t.pinned && !t.completed && !t.archived && !(vacationMode && t.vacationPause))
      // sortOrder breaks ties rather than being the sort: every row starts at
      // pinnedOrder 0, so an install that has never dragged a pin (or upgraded
      // into the column) reads exactly as it did before. See Task.pinnedOrder.
      .sort((a, b) => a.pinnedOrder - b.pinnedOrder || a.sortOrder - b.sortOrder);
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
    const affectedTaskIds = get().tasks.filter(t => t.tags.includes(tag)).map(t => t.id);
    const wasRegistered = get().tagRegistry.includes(tag);

    dbRemoveTagFromAllTasks(tag);
    dbRemoveFromTagRegistry(tag);
    set(s => ({
      tasks: s.tasks.map(t => ({ ...t, tags: t.tags.filter(tg => tg !== tag) })),
      tagRegistry: s.tagRegistry.filter(t => t !== tag),
    }));

    get().setLastAction({
      label: `Deleted tag "${tag}"`,
      destructive: true,
      undo: () => {
        if (wasRegistered) {
          dbAddToTagRegistry(tag);
          set(s => ({ tagRegistry: [...s.tagRegistry, tag] }));
        }
        if (affectedTaskIds.length > 0) {
          dbBulkAddTags(affectedTaskIds, [tag]);
          set(s => ({
            tasks: patchTasks(s.tasks, affectedTaskIds, t => ({ tags: Array.from(new Set([...t.tags, tag])) })),
          }));
        }
      },
    });
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

    // Same rule as updateTask's recategorizedIntoNew: losing a category the
    // task never chose to leave must not turn it "new" either. A deleted
    // category takes its excludeFromNewTasksBanner and its schedule with it,
    // so without this every task it was suppressing arrives in the banner at
    // once, on the strength of a seenAt that stayed stale the whole time it
    // was filed there.
    const staleNew = get().tasks
      .filter(t => t.category === name)
      .filter(t => !isTaskNew(t) && isTaskNew({ ...t, category: null }))
      .map(t => t.id);

    useCategoryStore.getState().deleteCategory(name);
    set(s => ({
      tasks: s.tasks.map(t => t.category === name ? { ...t, category: null } : t),
    }));
    get().markTasksSeen(staleNew);
    useTaskGroupStore.setState(s => ({
      groups: s.groups.map(g => g.category === name ? { ...g, category: null } : g),
    }));

    // Two settings that *place* something rather than describe it have to let
    // go, which is the opposite call to the template one above and for a
    // concrete reason: a template item naming a dead category is a stale
    // reference nobody acts on, while these two would be re-*created* from.
    // Events file under their category by name, so a setting still naming this
    // one would draw a header for a section the user just deleted — and a
    // collapse remembered for it would fold whatever category later takes the
    // name. Both are restored by the undo below.
    const settings = useSettingsStore.getState();
    const hadEventCategory = settings.calendarEventCategory === name;
    const hadCollapsed = settings.collapsedCategories.includes(name);
    if (hadEventCategory) settings.setCalendarEventCategory(null);
    if (hadCollapsed) {
      settings.setCollapsedCategories(settings.collapsedCategories.filter(c => c !== name));
    }

    if (!category) return;
    get().setLastAction({
      label: 'Category deleted',
      destructive: true,
      undo: () => {
        useCategoryStore.getState().restoreCategory(category);
        const s2 = useSettingsStore.getState();
        if (hadEventCategory) s2.setCalendarEventCategory(name);
        if (hadCollapsed && !s2.collapsedCategories.includes(name)) {
          s2.setCollapsedCategories([...s2.collapsedCategories, name]);
        }
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
    // So do the settings that name a category, which was the same gap one
    // level further out: every one of these files something *into* a category
    // by name, so a rename left them pointing at a name nothing had any more.
    // The next generated task then landed in a category that no longer
    // existed — which allCategories() promptly resurrects as a phantom
    // section, so the rename appeared to half-undo itself.
    const settings = useSettingsStore.getState();
    if (settings.mealCookTaskCategory === name) settings.setMealCookTaskCategory(trimmed);
    if (settings.groceryUseUpTaskCategory === name) settings.setGroceryUseUpTaskCategory(trimmed);
    if (settings.leftoverUseUpTaskCategory === name) settings.setLeftoverUseUpTaskCategory(trimmed);
    if (settings.calendarEventCategory === name) settings.setCalendarEventCategory(trimmed);
    if (settings.collapsedCategories.includes(name)) {
      settings.setCollapsedCategories(
        settings.collapsedCategories.map(c => (c === name ? trimmed : c)),
      );
    }
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
