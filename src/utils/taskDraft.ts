/**
 * How a new task is built from a draft, and the title rules applied on the way.
 *
 * Lifted out of `useTaskStore` unchanged so it can be reached from outside the
 * app. The MCP server writes tasks into a replica of this database in a Node
 * process (see docs/arch/mcp-server.md), and `useTaskStore` cannot be imported
 * there at all: it reaches `expo-notifications` through `useFocusStore`, which
 * has no native side to bind to. Nothing in here has that problem — it reads
 * `useSettingsStore` and `useCategoryStore`, both plain zustand over the
 * database, and otherwise only pure utils.
 *
 * The point of moving it rather than writing a second one is that the defaults
 * below are the *only* copy. A task built anywhere else would drift from
 * `newTaskDefaults`, the category seed, the recurrence anchor and the supply
 * and target clamps the first time any of them changed, and nothing would fail
 * to say so.
 *
 * The side effects `addTask` performs around this — scheduling the reminder,
 * the quota nudges, the deadline calendar event — deliberately stayed behind in
 * the store. They are device work, and a task arriving on a phone by sync has
 * them done for it by `rebuildNotificationQueue`, which reschedules from every
 * task rather than from the one that changed.
 */
import type { Task, TaskDraft, TimeOfDay, Polarity } from '../types';
import { generateId } from './id';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { resolveTitleRules } from './titleRules';
import { taskKindOf, MIN_TARGET_COUNT, MAX_TARGET_COUNT } from './taskKinds';
import {
  getCurrentDayStart,
  recurrenceAnchorDayFor,
  captureReminderOffset,
  getReminderOffsetDate,
  getDeadlineFromOffset,
  getDeadlineFromMonthDay,
} from './dateUtils';
import { canHoldFollowUpTask } from './followUpTask';
import { normalizeTargetUnit } from './quotaUnit';
import { canHoldSupply, clampSupplyReorderAt, DEFAULT_SUPPLY_REORDER_AT } from './supply';

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
export function applyTitleRulesToDraft(
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
    linkUrl: draft.linkUrl ?? fill.linkUrl,
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
export function newTaskFromDraft(
  draft: Partial<TaskDraft>,
  now: string,
  sortOrder: number,
  seedFromCategory = false,
  id?: string,
  skipCategoryDefault = false,
): Task {
  const defaults = useSettingsStore.getState().newTaskDefaults;
  // An avoid-task is never completed (see Task.polarity), so it can only be the
  // plain kind: every other kind is a shape for *completing* something, and all
  // four of their mechanisms hang off a completion that will never come. The
  // editor already enforces this at the near end — applyKind resets polarity
  // whenever the kind moves away from 'task' — but that is one door of several,
  // and a template, an Apple Reminders import, a restored backup or a synced row
  // arrives here instead. So the rule lives at the door all of them pass
  // through, the same call canHoldSupply makes just below.
  //
  // The kind wins rather than the polarity, which matches taskKindOf's own
  // precedence: a row carrying both reads as its kind everywhere else in the
  // app, so leaving the polarity set would leave the Goal row hidden behind
  // that kind with no way to reach it and turn the polarity back off.
  const resolvedPolarity: Polarity =
    taskKindOf({
      chainEnabled: draft.chainEnabled ?? false,
      targetCount: draft.targetCount ?? null,
      timedMinutes: draft.timedMinutes ?? null,
      healthMetric: draft.healthMetric ?? null,
      healthTarget: draft.healthTarget ?? null,
    }) === 'task'
      ? (draft.polarity ?? 'positive')
      : 'positive';
  const task: Task = {
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
    recurrenceAnchorDay: null,
    recurrenceAnchorDate: null,
    recurrenceEndDate: draft.recurrenceEndDate ?? null,
    recurrenceCount: draft.recurrenceCount ?? null,
    recurrenceFromCompletion: draft.recurrenceFromCompletion ?? false,
    targetCount: draft.targetCount ?? null,
    progressCount: draft.progressCount ?? 0,
    targetUnit: normalizeTargetUnit(draft.targetUnit),
    allowOvershoot: draft.allowOvershoot ?? false,
    quotaIntervalMinutes: draft.quotaIntervalMinutes ?? null,
    quotaReminders: draft.quotaReminders ?? false,
    quotaAlwaysVisible: draft.quotaAlwaysVisible ?? false,
    quotaPeriod: draft.quotaPeriod ?? 'day',
    // Never seeded from a draft: a run is started by tapping "start now" on a
    // task that exists, so a row arriving already mid-run would be claiming a
    // morning nobody had yet.
    quotaStartedAt: null,
    // Refused outright on a task that can't spend it, rather than trusted from
    // the draft. A supply counts down by riding onto the successor completeTask
    // spawns, so on a one-off it would sit at its starting number for ever
    // while the filters were actually being used — a chip that lies, and no way
    // to tell from looking at it. The editor and quick add both clear it on
    // their own save; this is the door all of them pass through, and the one
    // place a draft assembled anywhere else (a template, an import, a restored
    // backup) is also checked. Same rule canHoldSupply states and NO_RECURRENCE
    // enforces when a task becomes a dated series.
    ...(canHoldSupply({
      recurrenceType: draft.recurrenceType ?? 'none',
      parentId: draft.parentId ?? null,
    })
      ? {
          supplyCount: draft.supplyCount ?? null,
          // Same normaliser the daily target's unit uses, deliberately rather
          // than a twin: both are a short free-text noun shown beside a number
          // on a row, and two functions with one rule between them is how the
          // copy drifts.
          supplyUnit: normalizeTargetUnit(draft.supplyUnit),
          supplyRefillCount: draft.supplyRefillCount ?? null,
          supplyReorderAt: clampSupplyReorderAt(draft.supplyReorderAt),
          supplyLeadDays: draft.supplyLeadDays ?? null,
          supplyGroceryItemId: draft.supplyGroceryItemId ?? null,
        }
      : {
          supplyCount: null,
          supplyUnit: null,
          supplyRefillCount: null,
          supplyReorderAt: DEFAULT_SUPPLY_REORDER_AT,
          supplyLeadDays: null,
          supplyGroceryItemId: null,
        }),
    // Never seeded from the draft either way: a decline is something the user
    // does to a task that already exists, and a *new* task carrying one would
    // start life with its first reorder offer already refused.
    supplyDeclinedAtCount: null,
    tags: draft.tags ?? [],
    personIds: draft.personIds ?? [],
    category: skipCategoryDefault ? (draft.category ?? null) : (draft.category ?? defaults.category),
    sortOrder,
    pinned: draft.pinned ?? false,
    pinnedOrder: 0,
    priority: draft.priority ?? defaults.priority ?? 0,
    effort: draft.effort ?? defaults.effort ?? 0,
    estimatedMinutes: draft.estimatedMinutes ?? null,
    backfillDismissedFields: [],
    streakCount: 0,
    // A negative habit is anchored at the day it was created, where a positive
    // one has no anchor until its first completion. The anchor is what
    // cleanDayPatch counts forward from, and leaving it null would make the
    // first rollover spend a pass just laying it down — which is harmless but
    // means a habit created on Monday can't credit Tuesday until Wednesday's
    // pass has run twice. Today is deliberately the anchor rather than a day
    // earlier: half of it happened before the commitment existed.
    streakDate: resolvedPolarity === 'negative' ? getCurrentDayStart().toISOString() : null,
    previousStreakCount: 0,
    previousStreakDate: null,
    priorBestStreak: 0,
    slipCount: 0,
    slipDate: null,
    penaltyMinutes: draft.penaltyMinutes ?? null,
    penaltyCutoffTime: draft.penaltyCutoffTime ?? null,
    // Never seeded from the draft: a charge belongs to the occurrence that
    // earned it, so a new row — including the successor of one that was
    // charged — starts owing nothing.
    penaltyFiredAt: null,
    gatesApps: draft.gatesApps ?? false,
    polarity: resolvedPolarity,
    // On by default for a negative habit and off for everything else. A flame on
    // every recurring row is noise (the reasoning behind the field), but the run
    // of clean days is the *only* feedback an avoid-task ever gives: it is never
    // completed, so without the chip the row never changes at all.
    showStreak: draft.showStreak ?? resolvedPolarity === 'negative',
    streakRequiresWindow: draft.streakRequiresWindow ?? false,
    parentId: draft.parentId ?? null,
    groupId: draft.groupId ?? null,
    projectId: draft.projectId ?? null,
    reminderTime: draft.reminderTime ?? null,
    reminderKind: draft.reminderKind ?? 'notification',
    reminderOffsetDays: draft.reminderOffsetDays ?? null,
    reminderTimeAnchor: draft.reminderTimeAnchor ?? 'wallClock',
    reminderUtcOffsetMinutes: draft.reminderUtcOffsetMinutes ?? captureReminderOffset(draft.reminderTime ?? null),
    chainEnabled: draft.chainEnabled ?? false,
    chainIndex: draft.chainIndex ?? 0,
    chainItems: draft.chainItems ?? [],
    chainStepOnSchedule: draft.chainStepOnSchedule ?? false,
    // The same door the supply block above passes through, and the same rule:
    // the tally rides onto the successor a completion spawns, so a one-off or a
    // subtask has nowhere to carry it and the rule could never reach its second
    // completion. See canHoldFollowUpTask.
    ...(canHoldFollowUpTask({
      recurrenceType: draft.recurrenceType ?? 'none',
      parentId: draft.parentId ?? null,
    })
      ? {
          followUpTaskEveryN: draft.followUpTaskEveryN ?? null,
          followUpTaskTitle: draft.followUpTaskTitle ?? null,
          followUpTaskDraft: draft.followUpTaskDraft ?? null,
          followUpTaskOneAtATime: draft.followUpTaskOneAtATime ?? false,
        }
      : {
          followUpTaskEveryN: null,
          followUpTaskTitle: null,
          followUpTaskDraft: null,
          followUpTaskOneAtATime: false,
        }),
    vacationPause: draft.vacationPause ?? false,
    excludeFromSuggestions: draft.excludeFromSuggestions ?? false,
    timerStartedAt: draft.timerStartedAt ?? null,
    actualMinutes: draft.actualMinutes ?? null,
    timedMinutes: draft.timedMinutes ?? null,
    timerElapsedSeconds: draft.timerElapsedSeconds ?? 0,
    healthMetric: draft.healthMetric ?? null,
    healthTarget: draft.healthTarget ?? null,
    completionTimerMinutes: draft.completionTimerMinutes ?? null,
    logHealthMetric: draft.logHealthMetric ?? null,
    logHealthAmount: draft.logHealthAmount ?? null,
    medicationName: draft.medicationName ?? null,
    medicationAmount: draft.medicationAmount ?? null,
    medicationUnit: draft.medicationUnit ?? null,
    previousOccurrenceId: draft.previousOccurrenceId ?? null,
    generatedKind: draft.generatedKind ?? null,
    generatedSourceId: draft.generatedSourceId ?? null,
    deadlineOnCalendar: draft.deadlineOnCalendar ?? false,
    logCompletionToCalendar: draft.logCompletionToCalendar ?? false,
    // Never read off the draft, same reasoning as deliverableValue just
    // below: a duplicate or template application starting with someone
    // else's device event id would either point at the wrong task's event or
    // silently overwrite it on the first reconcile.
    calendarEventId: null,
    // Same rule: a fresh row hasn't logged a completion yet.
    completionCalendarEventId: null,
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
    location: draft.location ?? null,
    blockedById: draft.blockedById ?? null,
    waitingOnPersonId: null,
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
    followUpTaskTally: 0,
    previousFollowUpTaskTally: 0,
    followUpTaskSourceTitle: draft.followUpTaskSourceTitle ?? null,
  };
  // Captured here rather than defaulted to null in the literal above: a task
  // created with a monthly rule and a due date on the 31st has to carry the
  // 31st from its first row, or the first February clamps it away before
  // anything gets the chance to. See Task.recurrenceAnchorDay.
  return { ...task, recurrenceAnchorDay: recurrenceAnchorDayFor(task) };
}

/**
 * Re-anchor a reminder onto a different day (or onto its offset from that day,
 * see `Task.reminderOffsetDays`), keeping its time of day.
 *
 * A set of dates shares an hour, not a moment — copying the source row's
 * `reminderTime` verbatim would fire every date's notification on the first
 * one. Also recaptures `reminderUtcOffsetMinutes` for the moved instant, since
 * a reminder re-anchored onto a different day may cross a DST boundary and
 * land under a different UTC offset than the one its source row had (#1205).
 */
export function reanchorReminder(
  reminderTime: string | null,
  date: Date,
  offsetDays: number | null = null
): { reminderTime: string | null; reminderUtcOffsetMinutes: number | null } {
  if (!reminderTime) return { reminderTime: null, reminderUtcOffsetMinutes: null };
  const original = new Date(reminderTime);
  const next = new Date(offsetDays !== null ? getReminderOffsetDate(date, offsetDays) : date);
  next.setHours(original.getHours(), original.getMinutes(), 0, 0);
  return { reminderTime: next.toISOString(), reminderUtcOffsetMinutes: next.getTimezoneOffset() };
}

type RecurrenceFields = Pick<
  Task,
  | 'recurrenceType' | 'recurrenceInterval' | 'recurrenceDays' | 'recurrenceMonthDay'
  | 'recurrenceWeekOrdinal' | 'recurrenceAnchorDay' | 'recurrenceAnchorDate'
  | 'recurrenceEndDate' | 'recurrenceCount'
  | 'recurrenceFromCompletion' | 'showStreak' | 'streakRequiresWindow'
  | 'supplyCount' | 'supplyUnit' | 'supplyRefillCount' | 'supplyReorderAt'
  | 'supplyLeadDays' | 'supplyDeclinedAtCount' | 'supplyGroceryItemId'
>;

/**
 * What a row of a dated series is *not*.
 *
 * A dated series and a recurrence rule are two schedules for one task, and a
 * series row is deliberately an ordinary one-off (see `Task.seriesId`) — the
 * set comes back, if it comes back at all, through `seriesMonthDays`. Left in
 * place, a rule carried onto every row of the set and completing one date
 * spawned an extra occurrence *inside the same series*: the set grew by a row
 * per completion, and the next date edit deleted the rows it no longer
 * recognised. So forming a series clears the rule rather than trying to run
 * both.
 */
export const NO_RECURRENCE: RecurrenceFields = {
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceAnchorDay: null,
  recurrenceAnchorDate: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  // A supply counts down by riding onto the successor completeTask spawns, and
  // a series row spawns none (see canHoldSupply) — so a supply left on one
  // would sit at its starting number for ever while the filters were actually
  // being used, which is worse than not tracking it. Cleared with the rule for
  // the same reason showStreak is: the state it describes stops existing.
  supplyCount: null,
  supplyUnit: null,
  supplyRefillCount: null,
  supplyReorderAt: DEFAULT_SUPPLY_REORDER_AT,
  supplyLeadDays: null,
  supplyDeclinedAtCount: null,
  supplyGroceryItemId: null,
  // Only a recurring task has a streak to show, and the editor only offers the
  // toggle there — same reasoning as the showStreak reset in TaskEditor.
  showStreak: false,
  // Same reasoning as showStreak above: a series row is a one-off with no
  // streak of its own, so nothing is left on for it to be late against.
  streakRequiresWindow: false,
};

/**
 * One row of a dated series (`Task.seriesId`).
 *
 * Every field but the date comes from the source row/draft; a relative
 * deadline recomputes against this row's own date the same way it does for a
 * new recurrence occurrence, while a fixed one is a single absolute target and
 * carries over untouched.
 */
export function buildSeriesRow(
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
    // buildCompletion) set it themselves on top of this.
    previousOccurrenceId: null,
    deadline:
      base.deadlineOffsetDays !== null
        ? getDeadlineFromOffset(date, base.deadlineOffsetDays).toISOString()
        : base.deadlineMonthDay !== null
          ? getDeadlineFromMonthDay(date, base.deadlineMonthDay).toISOString()
          : base.deadline,
    ...reanchorReminder(base.reminderTime, date, base.reminderOffsetDays),
  };
}
