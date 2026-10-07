import { create } from 'zustand';
import { addDays } from 'date-fns/addDays';
import type { Task, TaskDraft, Priority, TimeOfDay, TitleRule, Person, QuotaPeriod, Polarity, Difficulty, MealPlanEntry, FoodLogEntry } from '../types';
import {
  initDatabase,
  dbGetAllTasks,
  dbInsertTask,
  dbUpdateTask,
  dbUpdateTaskCalendarLinks,
  dbFillTaskCalendarExternalIds,
  dbDeleteTask,
  dbDeleteSubtasks,
  dbClearAllPins,
  dbBatchUpdateSortOrders,
  dbBulkDeleteTasks,
  dbBulkSetPriority,
  dbBulkSetDifficulty,
  dbBulkSetDefer,
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
  dbGetMealPlanEntry,
  dbGetFoodLogEntries,
} from '../db/database';
import { useSettingsStore } from './useSettingsStore';
import { useWidgetCompletionStore } from './useWidgetCompletionStore';
import { useCategoryStore, ensureCalendarEventCategory, ensureHealthCategory, ensureGeneratedTaskCategories, ensureGeneratedTaskCategory, renameGeneratedCategorySettings, clearGeneratedCategorySettings, setGeneratedCategory } from './useCategoryStore';
import { renameInRuleCategories, ruleCategoryFor } from '../utils/ruleCategory';
import { renameInFollowUpDraft, renameInReminderCaptures, renameInSeriesDefaults, renameInTitleRules, renameInViewClauses } from '../utils/categoryRename';
import { useTemplateStore } from './useTemplateStore';
import { useTaskGroupStore } from './useTaskGroupStore';
import { useSavedViewStore } from './useSavedViewStore';
import { useFocusStore } from './useFocusStore';
import { useUnattendedStore } from './useUnattendedStore';
import { useProjectStore, projectProgress } from './useProjectStore';
import { useProjectCategoryStore } from './useProjectCategoryStore';
import { projectBlueprint } from '../utils/projectTemplate';
import { useTemplateCategoryStore } from './useTemplateCategoryStore';
import { listedAnywhere } from '../utils/groceryLists';
import { useGroceryStore } from './useGroceryStore';
import { useEventReminderStore } from './useEventReminderStore';
import { useHiddenEventsStore } from './useHiddenEventsStore';
import { useEventPeopleStore } from './useEventPeopleStore';
import { useEventTaskLinkStore } from './useEventTaskLinkStore';
import { useRecipeStore } from './useRecipeStore';
import { useMealPlanStore } from './useMealPlanStore';
import { useLeftoverStore } from './useLeftoverStore';
import { isLiveLeftover } from '../utils/leftovers';
import { dripCandidate, findProjectStalls, nextPullCandidate, projectPullUpdates } from '../utils/projectPull';
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
import { buildPantryReviewDeck } from '../utils/pantryReview';
import {
  PANTRY_REVIEW_LINK_URL,
  PANTRY_REVIEW_TITLE,
  pantryReviewCadenceElapsed,
  pantryReviewDayKey,
  stalePantryReviewTasks,
  wantsPantryReview,
} from '../utils/pantryReviewTasks';
import {
  MAX_MEAL_SHORTFALL_TASKS,
  mealShortfallEntryId,
  mealShortfallLinkUrl,
  staleMealShortfallTasks,
  wantedMealShortfalls,
} from '../utils/mealShortfallTasks';
import { mealThawEntryId, staleMealThawTasks, wantedMealThaws } from '../utils/mealThawTasks';
import {
  MEAL_LOG_NUDGE_LOOKBACK_DAYS,
  isMealLogged,
  mealLogNudgeEntryId,
  mealLogNudgeLinkUrl,
  staleMealLogNudgeTasks,
  wantedMealLogNudges,
  type MealLogRecord,
} from '../utils/mealLogNudgeTasks';
import { loggedMealSlotKeys } from '../utils/mealLogCoverage';
import { standingSwapMap } from '../utils/standingSwaps';
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
import { readSavedEvents, updateSavedEvent, writeSavedEvents, type SavedEvent } from '../utils/savedEvents';
import { bookDueDay, bookSourceId, bookTaskNotes, bookTaskTitle, wantsBookTask } from '../utils/savedEventTasks';
import { reopenedTask } from '../utils/taskReopen';
import { forgiveVacationStreaks } from '../utils/vacationStreaks';
import { generatedBy, generatedSourceOf, generatedTaskCountOf, generatorPausedForVacation, hasAnyGeneratedTask, liveGeneratedTask, liveGeneratedTasksOfKind } from '../utils/generatedTasks';
import { featureHidden } from '../utils/simpleMode';
import { CALENDAR_REVIEW_TITLE, calendarReviewDayKey, wantsCalendarReview } from '../utils/calendarReviewTasks';
import { MOOD_LOG_TITLE, MOOD_NUDGE_TITLE, moodLogDayKey, moodLogSourceId, moodNudgeNotes, wantsMoodNudge } from '../utils/moodTasks';
import { DREAM_LOG_TITLE, JOURNAL_LOG_TITLE, JOURNAL_TASK_KIND, journalLogUrl, journalTaskDayKey, journalTaskSourceId } from '../utils/journalTasks';
import {
  WEIGH_IN_LINK_URL,
  WEIGH_IN_TITLE,
  clampWeighInEveryDays,
  wantsWeighIn,
  weighInDayKey,
  weighInDeclineHolds,
  weighInNotes,
} from '../utils/weightTasks';
import { buildMoodDays, lowMoodRun } from '../utils/moodInsights';
import {
  WEEKEND_NUDGE_TITLE,
  isWeekendBare,
  staleWeekendNudgeTasks,
  upcomingWeekend,
  wantsWeekendNudge,
  weekendNudgeLinkUrl,
  weekendNudgeNotes,
  weekendNudgeWeekendKey,
  weekendPlanTitles,
  weekendSourceProjects,
} from '../utils/weekendTasks';
import { buildDayBuckets } from '../utils/calendarMonth';
import { scheduleMoveUpdates } from '../utils/taskMoves';
import { assumedMinutesFor, buildDayLoads } from '../utils/dayLoad';
import { hasLogOnDay, hasLoggedSince } from '../utils/moodLog';
import { useFoodLogStore } from './useFoodLogStore';
import { useSavedMealsStore } from './useSavedMealsStore';
import { useMoodStore } from './useMoodStore';
import { useJournalStore } from './useJournalStore';
import { useMilestoneStore } from './useMilestoneStore';
import { useMedicationStore } from './useMedicationStore';
import { useRewardStore } from './useRewardStore';
import {
  canPostBounty,
  coinsForCompletion,
  coinsForLoss,
  liveBountyCount,
  nextBountyPushes,
  taskEarnsCoins,
  BOUNTY_WITHDRAWN,
} from '../utils/rewards';
import { medicationFor } from '../utils/medicationLog';
import { eventsIn } from '../utils/calendarBusy';
import { isDemoModeActive } from '../utils/demoState';
import type { JournalKind, MealSlot, Project, TaskGroup, WeatherCondition, WeatherRule } from '../types';
import { awayPauseDriver, departureFromAnswer, departureMoveFromAnswer, isProjectAwayNow } from '../utils/awayDates';
import { generateId } from '../utils/id';
import {
  applyTitleRulesToDraft,
  newTaskFromDraft,
  reanchorReminder,
  buildSeriesRow,
  NO_RECURRENCE,
} from '../utils/taskDraft';
import { buildCompletion, completionSettings } from '../utils/taskCompletion';
import { derivedId, spawnSeed } from '../utils/syncIds';
import { reorderSubset } from '../utils/reorder';
import { liveProjectSteps, slotUpdates } from '../utils/projectOrder';
import { applyMeasuredTime, draftHasEstimate } from '../utils/effort';
import {
  ruleEstimateDraft, withRuleEstimate, withGeneratorEstimate, holdsKindEstimate,
} from '../utils/ruleEstimate';
import { chainStepDatedByAnswer, cleanDeliverableReasoning, deliverableDate, deliverableKindFor, isTentativeAnswer, reasoningOf, type DeliverableReasoning } from '../utils/deliverables';
import { totalMinutes } from '../utils/recipeUtils';
import { normalizeTargetUnit } from '../utils/quotaUnit';
import {
  CONTENT_FIELDS,
  QUOTA_SPAN_FIELDS,
  captureField,
  ROTATION_TARGET_FIELDS,
  mergeTaskUpdate,
  nextPinnedOrder,
  seriesFanOutRows,
} from '../utils/taskUpdate';
// Re-exported: TaskEditor reads both from here, and they lived here first.
export { CONTENT_FIELDS, derivedTargetCount } from '../utils/taskUpdate';
import {
  canHoldSupply,
  clampSupplyCount,
  clampSupplyLeadDays,
  clampSupplyRefillCount,
  clampSupplyReorderAt,
  DEFAULT_SUPPLY_REORDER_AT,
  restockedSupplyCount,
  staleSupplyReorderTasks,
  suppliesWantingList,
  supplyReorderSourceId,
  supplyRestockReleasesItem,
  wantedSupplyReorders,
} from '../utils/supply';
import { getNextDueDate, getCurrentDayStart, getLogicalDayKey, getLogicalToday, getLogicalTomorrow, getTaskDayStart, getEffectiveTaskDate, dayKeyOf, dayKeyToDate, getDeadlineFromOffset, getDeadlineFromMonthDay, getReminderOffsetDate, getStreakOutcome, getNextSeriesDates, recurrenceAnchorDayFor, captureReminderOffset, reanchorReminderToWallClock } from '../utils/dateUtils';
import { entriesForSlot, shiftDayKey } from '../utils/mealPlan';
import { MEAL_SLOT_TASK_DAYS, completesMealSlot, loggedMealSlotTasks, mealSlotSourceId, mealSlotStepTimeSegments, mealSlotTaskDraft, parseMealSlotSource, slotEntryForTask, staleMealSlotTasks } from '../utils/mealSlotTasks';
import { wantsMealLogPrompt } from '../utils/mealLog';
import { quotaRunSpan, quotaTargetForInterval, quotaDueTimesAfter, isQuotaRunOver, quotaWeekStart } from '../utils/quotaSchedule';
import { isRotationTask, rotationCoversNew, rotationPick, rotationPlanFor, rotationUnpick, rotationUnpickUncovers } from '../utils/rotation';
import { MIN_TARGET_COUNT, MAX_TARGET_COUNT, taskKindOf } from '../utils/taskKinds';
import { nextStreakRecord } from '../utils/streakRecord';
import { isNegativeTask, slipPatch, undoSlipPatch, cleanDayPatch, nextSlipIsFree, lastSlipWasFree } from '../utils/negativeHabits';
import { creditShieldUntil, extendShieldUntil, penaltyChargeFor, penaltyCreditFor, slipPenaltyUntil, uncreditShieldUntil } from '../utils/penaltyShield';
// One name per line, deliberately, and not to be re-joined. See the note
// on the settings load in useSettingsStore.ts: this is a list every new
// visibility helper is added to, so one line is a guaranteed conflict.
import {
  isTaskVisible,
  isTaskNew,
  isTaskDeferred,
  isUpcomingToday,
  isHeldBack,
  isTaskNotNeeded,
  isHiddenForVacation,
  isWithheld,
  isInPausedProject,
  isVisibleApartFromVacation,
  isTaskExpired,
  isTaskSweepable,
  isRecurrenceNotYetDue,
  isLiveRecurring,
  isMissableMealPlanTask,
  isInboxTask,
  isUnscheduledTask,
  isWaitingTask,
  isRelevantToGroupToday,
  groupRoster,
  hasNoDateSignal,
  isQuotaTask,
  isQuotaOnPace,
  quotaRidesOutTheDay,
  isMissed,
  sameTimeSegments,
  isCompletionOnTime,
  isCategoryScheduledDay,
  currentTimeSegment,
  timeSegmentThreshold,
  displayTitleFor,
  getVisibleAt,
  beginVisibleAtPass,
} from '../utils/visibilityUtils';
import { retentionCutoff, selectPurgeableTaskIds } from '../utils/retention';
import { categoryLabel } from '../utils/categoryLabel';
import {
  postponeOutcome,
  nextPostponeCount,
  nextDriftingSince,
  driftingTaskList,
  driftingTasks,
  type DriftEntry,
} from '../utils/postpone';
import {
  followUpTaskRule, advanceFollowUpTaskTally, followUpTaskSuppressedBy, canHoldFollowUpTask,
  emptyFollowUpTaskDraft, followUpTaskDraftIsEmpty,
} from '../utils/followUpTask';
import type { FollowUpTaskSuppression } from '../utils/followUpTask';
import { normalizeTitle } from '../utils/taskInstances';
import { resolveTitleRules, titleRuleBacklog } from '../utils/titleRules';
import { registerTaskSource, resolveBlocker } from '../utils/blockerRegistry';
import { registerPersonTaskSource } from '../utils/peopleRegistry';
import {
  birthdayDrift,
  birthdayGiftDrift,
  parseBirthdaySource,
  parseBirthdayGiftSource,
  personLinkUrl,
  wantedBirthdayTasks,
  wantedBirthdayGiftTasks,
  staleBirthdayTasks,
  staleBirthdayGiftTasks,
} from '../utils/birthdayTasks';
import {
  declinedRecently,
  reachOutPersonId,
  reachOutTitle,
  reachOutsHandledRecently,
  staleReachOutTasks,
  wantedReachOuts,
  collapseGroupedReachOuts,
  reachOutHistoryIds,
  sharedReachOutGroupId,
  MAX_REACH_OUT_TASKS,
  type ReachOutCandidate,
} from '../utils/reachOutTasks';
import { lastTogether, personHistory } from '../utils/personHistory';
import { usePersonStore } from './usePersonStore';
import { usePersonGroupStore } from './usePersonGroupStore';
import { usePersonNoteStore } from './usePersonNoteStore';
import { giftIdeasText } from '../utils/personNotes';
import { resolveBlocksEdit, waitingOn, canWaitOn, blockerFields, blockerIdsOf, blockerOf } from '../utils/blocking';
import {
  waitingFollowUpTaskId,
  wantedWaitingFollowUps,
  MAX_WAITING_FOLLOW_UP_TASKS,
  waitingFollowUpsHandledRecently,
  staleWaitingFollowUpTasks,
} from '../utils/waitingFollowUpTasks';
import { scheduleTaskReminder, cancelTaskReminder, rescheduleAllReminders, scheduleTimerAlarm, cancelTimerAlarm, scheduleQuotaNudges, cancelQuotaNudges, cancelCompletionTimer } from '../utils/notifications';
import { syncDeadlineEvent, taskEventsAfterSync, deadlineEventLink, deleteDeadlineEvent } from '../utils/deadlineCalendarSync';
import type { ApplyReport } from '../utils/syncMerge';
import { logTaskCompletionToCalendar, completionEventLink, deleteCompletionEvent } from '../utils/completionCalendarSync';
import { logTaskHealthValue, unlogTaskNutrientFromFoodLog } from '../utils/healthCompletionSync';
import { waterTotalMl } from '../utils/waterLog';
import { followedWaterTargetCount } from '../utils/waterTargetUnits';
import {
  followedWaterTaskDoneOn, waterShortfallMl, waterShortfallTitle, WATER_SHORTFALL_NOTES,
} from '../utils/waterShortfallTasks';
import {
  loggedKcalToday, snackNudgeApplies, snackNudgeTitle, SNACK_NUDGE_NOTES,
} from '../utils/snackNudgeTasks';
import { effectiveCalorieTargetKcal } from '../utils/activeEnergyBoost';
import { effectiveWaterTargetMl } from '../utils/waterExerciseBoost';
import {
  getCalendarPermission,
  readTimeBlockEvent,
  updateTimeBlockEvent,
  type TimeBlockEvent,
} from '../utils/calendarSync';
import {
  NO_EVENT_LINK,
  adoptableTimeBlockId,
  eventsWithExternalId,
  filledExternalId,
  readExternalEventId,
  type CalendarEventLink,
} from '../utils/calendarEventLink';
import { timeBlockFieldsFor, timeBlockUpdateFor, type TimeBlockFields } from '../utils/timeBlock';
import { useCalendarStore } from './useCalendarStore';
import { useWeatherStore } from './useWeatherStore';
import { classifyWeather } from '../utils/weatherCondition';
import { decideWeatherWait } from '../utils/weatherWait';
import {
  weatherSourceId,
  parseWeatherSourceId,
  ruleMatchesToday,
  weatherWindowFor,
  describeWeatherWindow,
  weatherTaskTitle,
  weatherRuleIdOf,
  WEATHER_AHEAD_FROM_HOUR,
  WEATHER_LINK_URL,
} from '../utils/weatherTasks';
import {
  eventTaskRuleIdOf,
  matchedEventTasks,
  matchedFollowUpTasks,
  pruneHandledEventTasks,
  type HandledEventTasks,
} from '../utils/eventTasks';
import { taskFieldsFromEvent } from '../utils/calendarEventImport';
import {
  isTravelTaskStale,
  matchedTravelTasks,
  travelOriginKey,
  travelSourceOf,
  travelTaskTitle,
  describeTravelEstimate,
} from '../utils/travelTasks';
import { describeDisruptions, journeyDisruptions } from '../utils/transitAlerts';
import { carryClockTime, dateToHHMM } from '../utils/clockTime';
import { useTransitStore } from './useTransitStore';
import { travelOriginOfEvent, useTravelTimeStore } from './useTravelTimeStore';
import { useScreenTimeStore } from './useScreenTimeStore';
import { useHealthStore } from './useHealthStore';
import { screenTimeSourceId, parseScreenTimeSourceId, crossingWantsTask, screenTimeRuleIdOf } from '../utils/screenTimeRules';
import {
  healthSourceId,
  parseHealthSourceId,
  healthRuleDirection,
  healthTaskNote,
  ruleCanBeJudgedYet,
  ruleShortfallToday,
  healthTaskLinkUrl,
  healthRuleIdOf,
} from '../utils/healthRules';
import { isTimedTask, timerElapsed } from '../utils/timer';
import { apportionedMinutes, segmentMinutesOf } from '../utils/timerSegments';

import {
  UndoableAction,
  UndoHistoryActions,
  undoHistoryActions,
} from '../utils/undoHistory';


/**
 * Fold a fresh block into whatever is already being served.
 *
 * The single write point for the penalty shield, shared by the tap that logs a
 * slip and the sweep that finds a missed cutoff. Does nothing while the feature
 * is off, which is also what keeps a charge from being banked against the day
 * somebody switches it on.
 *
 * Nothing here touches Screen Time. This writes a setting, and the subscription
 * in `useAppShieldSync` is what turns that into a shield — so demo mode needs
 * no gate of its own at this level (the write lands in the throwaway database
 * like any other) and the one gate that matters stays where the bridge is.
 */
function chargePenaltyShield(until: Date, reason: string): void {
  const settings = useSettingsStore.getState();
  if (!settings.penaltyShieldEnabled) return;
  const next = extendShieldUntil(settings.penaltyShieldUntil, until);
  // The reason belongs to whichever charge owns the end. A shorter charge
  // landing mid-block moves nothing, so it must not rename the block either —
  // the shield screen would otherwise credit a block to the wrong task.
  if (next === settings.penaltyShieldUntil) return;
  settings.setPenaltyShieldUntil(next, reason);
}

/**
 * The other direction: finishing a task you were charged for takes that charge
 * off the block being served.
 *
 * Returns the stamp to write onto the row, or null when nothing was credited —
 * so the caller records a credit only where one actually happened, and a second
 * completion of the same row cannot claim it again.
 *
 * It writes the *same one setting* `chargePenaltyShield` writes, which is what
 * makes the composition safe without any work: `appShield` ORs the penalty, the
 * gate and the focus shield, so shortening this value cannot lift a gate
 * somebody's own task is holding or end a focus session early. A credit that
 * reached past this setting would be a different and much worse feature.
 *
 * The reason line is deliberately left alone. It names whatever charge owns the
 * end of the block, and a credit that shortens the block without ending it has
 * not changed whose block it is.
 */
/**
 * An occurrence's reminder moved onto a new due date: the same clock time on
 * the new day (or the same offset before it), or, for a reminder that tracks
 * visibility, the moment the moved row becomes visible. The rule
 * buildCompletion applies to a successor, for the two paths that re-date a row
 * outside a completion: skipping one, and a daily target's rollover.
 */
function reminderOnto(effective: Task, due: Date, overrides: Partial<Task> = {}): Pick<Task, 'reminderTime' | 'reminderUtcOffsetMinutes'> {
  if (!effective.reminderTime) {
    return { reminderTime: effective.reminderTime, reminderUtcOffsetMinutes: effective.reminderUtcOffsetMinutes };
  }
  if (effective.reminderTracksVisibility) {
    const next = getVisibleAt({ ...effective, ...overrides, dueDate: due.toISOString(), deferUntil: null });
    return { reminderTime: next.toISOString(), reminderUtcOffsetMinutes: next.getTimezoneOffset() };
  }
  const original = new Date(effective.reminderTime);
  const onto = effective.reminderOffsetDays !== null ? getReminderOffsetDate(due, effective.reminderOffsetDays) : due;
  // The clock time on the new day's *logical* day (carryClockTime), not copied
  // onto its calendar date: a 1 AM reminder sits at the end of its day under a
  // 4 AM reset, and copied it landed a whole day early on every successor.
  const next = carryClockTime(onto, original, useSettingsStore.getState().dayResetTime);
  return { reminderTime: next.toISOString(), reminderUtcOffsetMinutes: next.getTimezoneOffset() };
}

/**
 * A relative deadline recomputed against a new due date, as buildCompletion
 * does for a successor. A fixed deadline is a one-off date, so it's returned
 * unchanged here: re-dating the same row doesn't make it stop applying.
 */
function deadlineOnto(effective: Task, due: Date): string | null {
  if (effective.deadlineOffsetDays !== null) return getDeadlineFromOffset(due, effective.deadlineOffsetDays).toISOString();
  if (effective.deadlineMonthDay !== null) return getDeadlineFromMonthDay(due, effective.deadlineMonthDay).toISOString();
  return effective.deadline;
}

/**
 * Gives back to the block what completing `task` took off it, when unticking
 * undoes that completion. Without it, tick-then-untick shortened a block with
 * the task still undone.
 */
function uncreditPenaltyShield(task: Task, now: Date): void {
  if (task.penaltyCreditedAt === null || task.penaltyMinutes === null) return;
  const settings = useSettingsStore.getState();
  if (!settings.penaltyShieldEnabled) return;
  const next = uncreditShieldUntil(settings.penaltyShieldUntil, task.penaltyMinutes, task.penaltyCreditedAt, now);
  if (next !== settings.penaltyShieldUntil) {
    settings.setPenaltyShieldUntil(next, settings.penaltyShieldReason ?? displayTitleFor(task));
  }
}

function creditPenaltyShield(task: Task, now: Date): string | null {
  const settings = useSettingsStore.getState();
  if (!settings.penaltyShieldEnabled) return null;
  const minutes = penaltyCreditFor(task, now, settings.dayResetTime);
  if (minutes === null) return null;

  const next = creditShieldUntil(settings.penaltyShieldUntil, minutes, now);
  // Stamped even when the block had already run out. The charge has been
  // answered by doing the thing, and leaving the row unstamped would let the
  // same credit be claimed against a *later* block it did nothing to earn.
  if (next !== settings.penaltyShieldUntil) {
    settings.setPenaltyShieldUntil(next, next === null ? null : settings.penaltyShieldReason);
  }
  return now.toISOString();
}

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




/**
 * Fills in `recurrenceAnchorDay` for rows that predate the column, in place.
 *
 * A one-off pass over the loaded rows rather than a SQL migration: the value is
 * the *local* day-of-month of an ISO due date, and SQLite's `strftime` would
 * read a stored `Z` offset as UTC and hand back the wrong day for anything near
 * midnight. It re-runs on every launch and is a no-op after the first, because
 * a row it fills no longer matches — and a monthly rule with no due date never
 * matches at all, which is right: there's no date to anchor to.
 *
 * A row whose date has *already* drifted (a task that has been through a
 * February since it was created) is anchored to the drifted day. That's all
 * that can be recovered — the day it was originally set to isn't stored
 * anywhere — and it at least stops the drift where it is.
 */
function backfillRecurrenceAnchors(tasks: Task[]): void {
  for (const task of tasks) {
    if (task.recurrenceAnchorDay !== null) continue;
    const anchor = recurrenceAnchorDayFor(task);
    if (anchor === null) continue;
    task.recurrenceAnchorDay = anchor;
    dbUpdateTask(task);
  }
}

/**
 * How a reconcile writes the calendar link it ends with.
 *
 * The link columns are device-local and never leave this device, so writing
 * them changes nothing about the row a peer could want. Written through the
 * ordinary row update they still restamp the row as edited here just now,
 * which is right after a local edit (the row did change) and wrong for a pass
 * that runs unattended over rows another device changed: there, every row it
 * touched would read as this device's latest edit, at the one moment a peer's
 * own edits are least likely to have all arrived, and the next sync would put
 * this device's stale copy over each of them. `keepStamp` routes the write
 * through `dbUpdateTaskCalendarLinks`, which puts the row's stamp back.
 */
interface ReconcileWrite {
  keepStamp?: boolean;
}

/**
 * Brings a task's device deadline event in line with the task, fire-and-
 * forget — same shape as every `scheduleTaskReminder(...)` call in this
 * file: the write is async and best-effort, so nothing here awaits it.
 *
 * Only patches the task if the resulting link actually changed (most calls
 * are a no-op — most saves don't touch the deadline), and only if the task is
 * still around by the time the device write finishes; one deleted mid-write
 * has nothing left to patch. `syncDeadlineEvent` (deadlineCalendarSync.ts)
 * owns the decision of what the device event should look like; this is only
 * the plumbing back into SQLite and the store, which is why it lives here
 * rather than there — that file has no business reaching into this store.
 *
 * `keepStamp` (see `ReconcileWrite`) is passed by the one caller that runs
 * unattended over rows this device didn't edit, `reconcileSyncedEvents`. Every
 * other call follows a real local edit — a save, an insert, a completion, an
 * undo — on a row that genuinely changed here and was stamped for it, so the
 * link it writes back rides the ordinary whole-row write.
 */
function reconcileDeadlineEvent(task: Task, write?: ReconcileWrite): void {
  syncDeadlineEvent(task)
    .then(link => {
      if (
        link.eventId === task.calendarEventId &&
        link.externalId === (task.calendarEventExternalId ?? null)
      ) return;
      const current = useTaskStore.getState().tasks.find(t => t.id === task.id);
      if (!current) return;
      const updated = { ...current, calendarEventId: link.eventId, calendarEventExternalId: link.externalId };
      if (write?.keepStamp) {
        dbUpdateTaskCalendarLinks(task.id, { calendarEventId: link.eventId, calendarEventExternalId: link.externalId });
      } else {
        dbUpdateTask(updated);
      }
      useTaskStore.setState(s => ({ tasks: s.tasks.map(t => (t.id === task.id ? updated : t)) }));
    })
    .catch(() => {});
}

/**
 * Writes the silent, one-shot completion event for a task that has
 * `logCompletionToCalendar` on — fire-and-forget, same shape as
 * `reconcileDeadlineEvent` above, but simpler: `logTaskCompletionToCalendar`
 * (completionCalendarSync.ts) never reconciles or rewrites, so there's no
 * "did the id change" check, only the write and the patch of the id it
 * returns. Still guards against the task having vanished by the time the
 * device write resolves, the same reason `reconcileDeadlineEvent` does.
 *
 * Called only when `task.logCompletionToCalendar` is true (checked by the
 * caller, not here) rather than unconditionally on every completion the way
 * `reconcileDeadlineEvent` is — the util itself checks the settings side
 * too, but there's no reason to fire a promise on every completion in the
 * app just to have it resolve to null for the ones with the flag off.
 */
function logCompletionEvent(task: Task, completedAt: Date): void {
  logTaskCompletionToCalendar(task, completedAt)
    .then(async completionCalendarEventId => {
      if (!completionCalendarEventId) return;
      // The server id beside it, so reopening the task on a phone this backup is
      // restored to can still find the event to delete (#2950).
      const completionCalendarEventExternalId = await readExternalEventId(completionCalendarEventId);
      const current = useTaskStore.getState().tasks.find(t => t.id === task.id);
      if (!current) return;
      const updated = { ...current, completionCalendarEventId, completionCalendarEventExternalId };
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
 * - **`calendarReview` writes nothing either, for the same reason** — its
 *   source id is tomorrow's day key, not a row. Its "don't hand it back" is
 *   `calendarReviewLastDayKey`, set unconditionally by `checkCalendarReviewTasks`
 *   the moment a day is considered, whatever the outcome, so a swiped-away task
 *   isn't re-diagnosed on the very next sweep.
 * - **`pantryReview` is the third of these** — its source id is the day the
 *   offer was raised on, and there is no one item it is about to write a "no"
 *   onto. `pantryReviewLastDayKey` does the same job, and carries the cadence
 *   as well, so a swiped-away offer stays gone for a fortnight rather than
 *   until tomorrow.
 */
function writeGeneratedOptOut(task: Task, value: false | null): void {
  const sourceId = task.generatedSourceId;
  if (!sourceId) return;
  const reconcileOff = { reconcile: false } as const;
  switch (task.generatedKind) {
    case 'mealPlanNudge':
      return;
    case 'calendarReview':
      return;
    case 'weather':
      // Nothing to write — the source is a rule living in settings, not a
      // row. The idempotency mark (WeatherRule.lastFiredDayKey) is what
      // stops a swiped-away task coming straight back, and checkWeatherTasks
      // writes it unconditionally, the same order calendarReview's own mark
      // is written in.
      return;
    case 'eventTask':
      // Nothing to write, and for two reasons rather than one: the rule lives
      // in settings, and the other half of the source is a calendar event,
      // which is not this app's row to stamp anything on at all. The mark is
      // `eventTaskHandled`, written by checkEventTasks as it creates the task
      // — which is also what stops a swiped-away one coming back, since the
      // entry outlives the task and is pruned on the occurrence's own end.
      return;
    case 'travel':
      // The same answer as eventTask, for the same reason: the source is an
      // event in EventKit. `travelTaskHandled` is the mark, written as the task
      // is created, and outlives the task until the occurrence ends.
      return;
    case 'screenTime':
      // Nothing to write either, and for the same reason: the source is a
      // rule in settings. ScreenTimeRule.lastFiredDayKey is the mark, written
      // by checkScreenTimeTasks as it turns a crossing into a task — it can't
      // be spent ahead of the decision the way weather's is, because the
      // deciding is the OS's (see the field's own note).
      return;
    case 'health':
      // The third of them, and the same answer: a rule in settings is not a row
      // a decline could be stamped on. HealthRule.lastFiredDayKey is the mark,
      // spent when the rule is considered — which for a steps rule is not until
      // evening, since a shortfall before then is not a shortfall yet.
      return;
    case 'pantryReview':
      return;
    // Nothing to write, for the nudge's reason: a day and a slot name a square
    // on the calendar, not a row. Swiping today's lunch task away is honoured
    // by mealSlotTasksWrittenThroughDayKey instead — the pass only ever writes
    // days ahead of its mark, so a day it has covered is never revisited and
    // the row stays gone. That's what keeps this generator off the
    // growing-record path generatedTasks.ts warns about.
    case 'mealSlot':
      return;
    // A settings stamp rather than a row one, since a day key names no row,
    // and one that expires: deleting "Record your weight" means "not this
    // time", so it holds for weighInEveryDays from today (weighInDeclineHolds)
    // and no longer. Without it the request came back the next morning, since
    // the window still had no reading in it. The pass's own clearing of a
    // request whose day has gone drops it rather than deleting, so an ignored
    // request never lands here.
    //
    // `value === null` is the undo path, and restores what the delete found: a
    // stamp already sitting there was old enough to have let this request be
    // written, so clearing it changes nothing the reader can see.
    case 'weighIn':
      useSettingsStore.getState()
        .setWeighInDeclinedDayKey(value === false ? dayKeyOf(getCurrentDayStart()) : null);
      return;
    // A settings stamp for the same reason weighIn's is, and a shorter one: the
    // task is about today's water, so deleting it means "not today". `null` is
    // the undo path and clears what the delete wrote.
    case 'waterShortfall':
      useSettingsStore.getState()
        .setWaterShortfallDeclinedDayKey(value === false ? dayKeyOf(getCurrentDayStart()) : null);
      return;
    // The same one-day stamp, for the same reason: the task is about today's
    // food log, so deleting it means "not today".
    case 'snackNudge':
      useSettingsStore.getState()
        .setSnackNudgeDeclinedDayKey(value === false ? dayKeyOf(getCurrentDayStart()) : null);
      return;
    // On the saved event itself, scoped to the cycle the task was for: the
    // next appointment added from it starts a fresh one. Undo clears it.
    case 'bookEvent': {
      const list = readSavedEvents();
      const event = list.find(e => bookSourceId(e) === sourceId);
      if (!event) return;
      writeSavedEvents(updateSavedEvent(list, event.title, { bookDeclinedFor: value === false ? event.lastStart : null }));
      return;
    }
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
    // A permanent `false` rather than one of the self-expiring stamps above,
    // and the difference is what the swipe means. A quiet project and a lapsed
    // pantry guess both come round again on their own, so a stamp spent against
    // the day or the purchase is the honest record of "not right now". A meal
    // on the 22nd happens once: "don't warn me about this one, I'm buying it
    // fresh" is an answer about that night and nothing else, and the row it's
    // written on is deleted with the meal. That is the bounded-for-free
    // property generatedTasks.ts asks a per-source opt-out to have.
    case 'mealShortfall':
      useMealPlanStore.getState().setShopTask(sourceId, value);
      return;
    // The same permanent-for-this-meal `false` shopTask gets, for the same
    // reason: a meal on the 22nd happens once, and "I'm not thawing anything
    // for this one" is an answer about that night alone.
    case 'mealThaw':
      useMealPlanStore.getState().setThawTask(sourceId, value);
      return;
    // The same field the completion-time log prompt's "Don't ask for this
    // meal" already writes — see mealLogNudgeTasks.ts. Declining either one
    // means the same thing about the same meal.
    case 'mealLogNudge':
      useMealPlanStore.getState().setLogMeal(sourceId, value);
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
    // A stamp like projectReview's and pantryCheck's, spent against the supply
    // rather than against the day: swiping "Order more filters" away means "not
    // for these three filters", and asking again tomorrow about the same three
    // is the nag those two stamps exist to avoid. It lapses by itself on the
    // next restock (see updateTask, where a rising count clears it), so there
    // is nothing here that could suppress the offer for good.
    //
    // The source is a *task*, so this is the one arm of this switch that writes
    // back into this very store. Written directly rather than through
    // updateTask: the caller is deleteTask, mid-write, and routing a second
    // store action through it would run the postpone derivation and the
    // series fan-out over a field that is neither.
    //
    // `value === null` is the undo path, and restores what the delete found:
    // any stamp already sitting there was at a count this one or lower (a
    // higher one would have suppressed the task rather than let it exist), so
    // clearing it changes nothing a reader can see.
    // A stamp like projectReview's and pantryCheck's: swiping "Catch up with
    // X" away means "not for now", not "never ask about this person again"
    // (nudgeOptIn already exists for that). Spent against the person rather
    // than the day, and read back by declinedRecently in reachOutTasks.ts.
    //
    // `value === null` is the undo path, and restores exactly what the delete
    // wrote: a stamp already sitting there predated this decline (a more
    // recent one would have suppressed the task in the first place), so
    // clearing it changes nothing the reader can see.
    case 'reachOut': {
      const stamp = value === false ? new Date().toISOString() : null;
      // A collapsed group task's sourceId is a PersonGroup id rather than a
      // personId (see collapseGroupedReachOuts) — decline it for every
      // current member, or the other half of the couple would pop right back
      // up on the next sweep having never been told "not now" at all.
      const group = usePersonGroupStore.getState().getGroupById(sourceId);
      if (group) {
        const { people, updatePerson } = usePersonStore.getState();
        people.filter(p => p.groupId === sourceId).forEach(p =>
          updatePerson(p.id, { reachOutDeclinedAt: stamp })
        );
      } else {
        usePersonStore.getState().updatePerson(sourceId, { reachOutDeclinedAt: stamp });
      }
      return;
    }
    case 'supplyReorder': {
      const source = useTaskStore.getState().tasks.find(t => t.id === sourceId);
      if (!source || source.supplyCount === null) return;
      const stamp = value === false ? source.supplyCount : null;
      if (source.supplyDeclinedAtCount === stamp) return;
      const patched = { ...source, supplyDeclinedAtCount: stamp };
      dbUpdateTask(patched);
      useTaskStore.setState(s => ({
        tasks: s.tasks.map(t => (t.id === sourceId ? patched : t)),
      }));
      return;
    }
    // A stamp like projectReview's and reachOut's: swiping "Follow up with X
    // about Y" away means "not right now", not "never ask about this wait
    // again" — there's no field that would mean the second thing anyway,
    // since the wait itself is still open. Spent against the waiting task
    // rather than the day, and read back by wantedWaitingFollowUps.
    //
    // The source is a *task*, so this writes directly into this store's own
    // rows, the same shape supplyReorder's case takes and for the same
    // reason: the caller is deleteTask mid-write, and routing a second store
    // action through it would run the postpone derivation over a field that
    // isn't one.
    case 'waitingFollowUp': {
      const source = useTaskStore.getState().tasks.find(t => t.id === sourceId);
      if (!source) return;
      const stamp = value === false ? new Date().toISOString() : null;
      if (source.waitingFollowUpDeclinedAt === stamp) return;
      const patched = { ...source, waitingFollowUpDeclinedAt: stamp };
      dbUpdateTask(patched);
      useTaskStore.setState(s => ({
        tasks: s.tasks.map(t => (t.id === sourceId ? patched : t)),
      }));
      return;
    }
    default:
      return;
  }
}

/**
 * The offer a meal's own finish, or its missed-log nudge, makes — the moment
 * either completes and the meal isn't already opted out of it.
 *
 * A recipe-backed meal gets the auto-computed prompt (`pendingMealLog`,
 * `mealLog.ts`/`LogMealPrompt.tsx`), which can measure it. Anything else —
 * a leftover with no recipe, takeout, a typed answer — gets the search sheet
 * instead (`pendingManualMealLog`, `FoodLogEntrySheet.tsx`), prefilled with
 * the meal's own name so finding it is a tap rather than a retype. Both
 * check the same per-meal "no" first, because both are the same offer with
 * two different ways of answering "how much".
 */
function offerMealLog(loggable: MealPlanEntry, asked = false): void {
  if (!wantsMealLogPrompt(loggable, useSettingsStore.getState().mealLogPrompt)) return;
  // Already logged, so there is nothing to offer. The meal's own square is not
  // the only way food gets into that slot (`mealLogCoverage.ts` says why the
  // join is the slot rather than `mealPlanEntryId`), and offering to log a
  // lunch somebody typed in an hour ago is the same wrong question the nudge
  // task used to ask the next morning — just sooner.
  const logged = dbGetFoodLogEntries(loggable.date, loggable.date);
  if (isMealLogged(loggable, mealLogRecord(logged))) return;
  useFoodLogStore.getState().offerMealLog(loggable, { asked });
}

/**
 * The two readings of "logged" a window of food log entries supports, for the
 * generator and the completion offer alike — see `MealLogRecord`.
 */
function mealLogRecord(entries: readonly FoodLogEntry[]): MealLogRecord {
  return {
    entryIds: new Set(
      entries.map(e => e.mealPlanEntryId).filter((id): id is string => id !== null)
    ),
    slotKeys: loggedMealSlotKeys(entries),
  };
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
function writeMealSlotTasks(
  fromKey: string,
  toKey: string,
  slots: readonly MealSlot[],
  /**
   * Whether each row written goes in the unattended ledger: true from the
   * daily pass, false from the Settings backfill, which is a person turning a
   * switch on and watching the rows arrive.
   */
  record: boolean,
): void {
  const entries = dbGetMealPlanEntries(fromKey, toKey);
  // Ensured here as well as at startup for checkProjectReviewTasks' reason:
  // this generator ships on, so nobody flips the switch that would otherwise
  // create the category, and an uncategorized row lands in the loose block
  // above every section.
  ensureGeneratedTaskCategory('mealSlot');
  const category = useSettingsStore.getState().mealCookTaskCategory;
  const library = useRecipeStore.getState();

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
      // A meal whose recipe was deleted is written as the typed meal it now
      // reads as, rather than "Make X" linking to a recipe that's gone.
      const planned = slotEntryForTask(entry, library);
      const recipe = planned?.recipeId ? library.recipes.find(r => r.id === planned.recipeId) : undefined;
      const created = useTaskStore.getState().addTask(
        mealSlotTaskDraft(
          dayKey, slot, planned, category, recipe ? totalMinutes(recipe) : null,
          useSettingsStore.getState().mealSlotStepEstimates
        ),
        derivedId(spawnSeed.generated('mealSlot', sourceId, generatedTaskCountOf(tasks, 'mealSlot', sourceId))),
        { skipCategoryDefault: true, skipTitleRules: true },
      );
      // Written straight through addTask rather than reconcileGeneratedTask,
      // so the ledger entry that path records has to be made here — see the
      // note on the one in generatedTaskSync.ts.
      if (record) useUnattendedStore.getState().recordGenerated('created', created);
    }
  }
}

/**
 * Points a task at its time block and the calendar server's id for it
 * (#2950), if the task is still around to write to. Answers whether the task
 * now holds that link.
 *
 * `from`, when given, is the block the caller read before an await, and the
 * write only lands while the task still points at it: an answer about one
 * block can't be written over the next one the user made meanwhile.
 */
/** What the time-block action opens: see `planTimeBlock`. */
export type TimeBlockPlan =
  | { mode: 'edit'; eventId: string }
  | { mode: 'create'; fields: TimeBlockFields };

function setTimeBlockLink(
  taskId: string,
  link: CalendarEventLink,
  from?: string | null,
  write?: ReconcileWrite
): boolean {
  const current = useTaskStore.getState().tasks.find(t => t.id === taskId);
  if (!current) return false;
  if (from !== undefined && current.timeBlockEventId !== from) return false;
  if (current.timeBlockEventId === link.eventId && (current.timeBlockExternalId ?? null) === link.externalId) {
    return true;
  }
  const updated = { ...current, timeBlockEventId: link.eventId, timeBlockExternalId: link.externalId };
  // `keepStamp` reaches here only from `reconcileTimeBlockEvent` run after a
  // sync (see ReconcileWrite); a tap in the editor, and the reconcile that
  // follows a save, write the row as they always have.
  if (write?.keepStamp) {
    dbUpdateTaskCalendarLinks(taskId, { timeBlockEventId: link.eventId, timeBlockExternalId: link.externalId });
  } else {
    dbUpdateTask(updated);
  }
  useTaskStore.setState(s => ({ tasks: s.tasks.map(t => (t.id === taskId ? updated : t)) }));
  return true;
}

/**
 * Finds a task's block again by the calendar server's id when the id the task
 * holds no longer resolves, points the task at it, and returns it; null leaves
 * the caller to drop the pointer as it always has (#2950).
 *
 * The case this is for is a backup restored on a new phone. The old phone's
 * local id names nothing here, while the block itself came down from the
 * calendar account under the same server id. A block is never recreated (it
 * is time the user set aside, through the system sheet), so without this the
 * task would simply forget it: the reconcile and the editor's "On your
 * calendar" row both drop a pointer they can't open. `adoptableTimeBlockId`
 * decides when one event is safely the block, and it answers only for exactly
 * one.
 */
async function adoptTimeBlock(
  task: Task,
  write?: ReconcileWrite
): Promise<{ eventId: string; event: TimeBlockEvent } | null> {
  const from = task.timeBlockEventId;
  const externalId = task.timeBlockExternalId ?? null;
  if (!from || !externalId) return null;
  const adopted = adoptableTimeBlockId(await eventsWithExternalId(externalId));
  if (!adopted || adopted === from) return null;
  const event = await readTimeBlockEvent(adopted);
  if (!event) return null;
  if (!setTimeBlockLink(task.id, { eventId: adopted, externalId }, from, write)) return null;
  return { eventId: adopted, event };
}

/**
 * Keeps the server id of a block the task points at, read in the background:
 * one made before the id was kept, or whose id the read straight after the
 * sheet didn't get. Written only while the task still points at that block.
 */
function recordTimeBlockExternalId(taskId: string, eventId: string, write?: ReconcileWrite): void {
  readExternalEventId(eventId)
    .then(externalId => {
      if (externalId) setTimeBlockLink(taskId, { eventId, externalId }, eventId, write);
    })
    .catch(() => {});
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
 * deleted on purpose. Before dropping it, though, the block is looked for by
 * the calendar server's id (`adoptTimeBlock`, #2950): an id that stopped
 * resolving because a backup was restored on a new phone is not a block the
 * user deleted.
 *
 * `write` is handed to every pointer write below it, for `reconcileDeadlineEvent`'s
 * reason: after a sync they land on rows this device didn't edit.
 */
function reconcileTimeBlockEvent(task: Task, write?: ReconcileWrite): void {
  const eventId = task.timeBlockEventId;
  if (!eventId) return;
  // Demo mode: the row is seeded fiction, and this would retitle and resize a
  // real event in the user's calendar to match it (or drop the pointer on the
  // strength of a real read). Same gate the deadline mirror has.
  if (isDemoModeActive()) return;
  readTimeBlockEvent(eventId)
    .then(async event => {
      const block = event ? { eventId, event } : await adoptTimeBlock(task, write);
      if (!block) {
        setTimeBlockLink(task.id, NO_EVENT_LINK, eventId, write);
        return;
      }
      if (event && !task.timeBlockExternalId) recordTimeBlockExternalId(task.id, eventId, write);
      const update = timeBlockUpdateFor(task, block.event);
      if (update) await updateTimeBlockEvent(block.eventId, update);
    })
    .catch(() => {});
}

// Identity of a date as the user picked it off a calendar — deliberately the
// literal Y/M/D rather than getDayStart, since reconciling a series matches
// rows against dates chosen in a date picker, where dayResetTime plays no part.
function calendarDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
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
 * bulkDefer sets one date across a selection but lands a *different* count on
 * each task, since the rule compares against where each one was — so this can't
 * ride along on dbBulkSetDefer, which stays single-purpose. Same split
 * dbBatchUpdatePinnedOrders makes beside bulkTogglePin. Only rows whose count
 * actually moves are written.
 *
 * bulkSetWhen used to share this and no longer does: its rows stopped sharing a
 * patch once each one's date move started going through scheduleMoveUpdates, so
 * it re-dates through updateTask and the count is derived there. See its own
 * note. This is deliberately not generalised to cover both again — the whole
 * reason that path changed is that a selection is not one move.
 *
 * Carries driftingSince alongside, since the two are one fact (see
 * nextDriftingSince) and splitting them across two passes would let a batch
 * write half of it.
 */
function bulkPostponeCounts(
  tasks: Task[],
  ids: string[],
  // Partial on purpose: dbBulkSetDefer writes defer_until and nothing else.
  // Spelling the untouched field as an explicit null here would wipe it from
  // the comparison and make every bulk defer look like it had cleared the
  // task's due date.
  next: Partial<Pick<Task, 'dueDate' | 'deferUntil'>>,
  dayResetTime: string,
): Map<string, { postponeCount: number; driftingSince: string | null; bountyPushes: number | null }> {
  const idSet = new Set(ids);
  const counts = new Map<string, { postponeCount: number; driftingSince: string | null; bountyPushes: number | null }>();
  for (const t of tasks) {
    if (!idSet.has(t.id)) continue;
    const outcome = postponeOutcome(t, { ...t, ...next }, dayResetTime);
    const postponeCount = nextPostponeCount(t.postponeCount, outcome);
    const driftingSince = nextDriftingSince(t.driftingSince, t.postponeCount, outcome, t, dayResetTime);
    const bountyPushes = nextBountyPushes(t.bountyPushes, outcome === 'pushed');
    if (postponeCount !== t.postponeCount || driftingSince !== t.driftingSince || bountyPushes !== (t.bountyPushes ?? null)) {
      counts.set(t.id, { postponeCount, driftingSince, bountyPushes });
    }
  }
  return counts;
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

interface TaskStore extends UndoHistoryActions {
  tasks: Task[];
  tagRegistry: string[];
  initialized: boolean;
  /**
   * The top of `undoStack`, mirrored — not a field of its own. Kept because
   * the whole app reads it: both undo consumers, the batch actions below that
   * capture a child action's undo, and TitleRulesSheet's identity check.
   */
  lastAction: UndoableAction | null;
  undoStack: UndoableAction[];
  redoStack: UndoableAction[];
  /**
   * Tasks a completion just freed that have no day to go to: the last thing
   * each waited on is done, but an undated task goes nowhere on its own, so
   * "ready" would otherwise be invisible. ReadyOfferBar reads this and offers
   * a day; `at` tells a fresh offer from the one already shown. Session-only.
   */
  readyOffer: { taskIds: string[]; at: number } | null;
  /**
   * A question about a trip's dates that a date answer raised (see
   * `deliverableSetsAway`): ask for Coming back once Leaving has just been
   * filled, or offer to move a Leaving date a new answer disagrees with.
   * TripDatePrompt asks it; `at` tells a fresh one from the one shown.
   */
  tripDatePrompt:
    | { kind: 'return'; projectId: string; at: number }
    | { kind: 'moveLeaving'; projectId: string; awayStart: string; at: number }
    | null;
  clearTripDatePrompt: () => void;
  clearReadyOffer: () => void;
  /** Dates every task in the offer on `date`, undoably, and clears it. */
  placeReadyTasks: (date: Date) => void;
  /**
   * Moves each repeating task to its next day on or after today, keeping its
   * grid (`getNextDueDate`'s catch-up), or to today for one counted from
   * completion. What a project coming off a pause offers its overdue
   * routines (overdueRoutines). One undo step.
   */
  redateRoutines: (taskIds: string[]) => void;
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
   * Brings this device's task calendar events in line with what a sync just
   * applied (#2950): the deadline event of each changed task that holds one is
   * rewritten (or deleted) through the same reconcile a local edit runs, its
   * time block gets the task's title and length, the completion event of a
   * task another device reopened is deleted and unlinked as a local uncomplete
   * would, and the deadline event of each task another device deleted is
   * deleted here. Which tasks, and why one with no event of this device's is
   * left alone, is `taskEventsAfterSync`'s call; this does the device writes,
   * fire-and-forget like every other deadline and time block reconcile.
   *
   * Called after the stores reload from the sync (`registerSyncReload`), so
   * the rows it reads and any link it writes back are the synced ones.
   */
  reconcileSyncedEvents: (applied: Pick<ApplyReport, 'taskIds' | 'removedTaskEvents'>) => void;
  /**
   * Fills in the calendar server id beside each of a task's device event ids
   * (deadline event, time block, completion event) that `found` names and the
   * task has none for yet, in the database and in memory, without restamping
   * the rows for sync (`dbFillTaskCalendarExternalIds` says why). The write
   * half of the one-time launch backfill (`backfillCalendarExternalIds`).
   */
  fillCalendarExternalIds: (found: Readonly<Record<string, string>>) => void;
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
   * A row that is created already done, dated when it happened.
   *
   * The one writer behind every entry in a person's history — see
   * `docs/arch/people.md`. **An ordinary completed task and never a second kind
   * of record**, which is the whole reason there is no interactions table: what
   * you did with somebody is a task you ticked off, so the same row serves the
   * Logbook, Stats and `personHistory` with nothing new to teach any of them.
   *
   * Three calls rather than one because `completeTask` stamps the moment it
   * runs, so a thing that happened an hour ago has its `completedAt` written
   * afterwards — the same `updateTask` the Logbook's own "change the date"
   * makes, and the field `personHistory` actually reads.
   *
   * It lives here rather than beside any one of its callers because there are
   * now four (the manual "Add to history" row, an accepted calendar offer, and
   * a confirmed tap on Call/Text/Email from either a person's page or a task
   * row), two of which are not on a screen that could own it.
   */
  addCompletedTask: (title: string, at: Date, personIds: string[]) => Task;
  /**
   * What the time-block action should open for a task: the in-app event card
   * editing the block it has, or creating one with a proposed slot. Null when
   * there is nothing to open (demo mode, no such task, no length to block out).
   * Writes nothing itself except dropping a pointer it finds stale; the card
   * writes the event, then calls `linkTimeBlock` or `unlinkTimeBlock`.
   */
  planTimeBlock: (id: string) => Promise<TimeBlockPlan | null>;
  /** Records the event the card just saved as this task's block. */
  linkTimeBlock: (id: string, eventId: string) => void;
  /** Drops this task's block pointer, once the user has deleted the event from the card. */
  unlinkTimeBlock: (id: string) => void;
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
    // markSeenOnBecomeVisible: the user is looking at this task right now, so
    // if this write is what makes it visible today, it must not also read as
    // unseen — see the seenAt-stamping note inside updateTask.
    options?: { scope?: 'occurrence' | 'series'; skipPostponeCount?: boolean; markSeenOnBecomeVisible?: boolean },
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
   *
   * `neutral` closes the occurrence without the streak moving either way —
   * for a quota day-close sweep finding today wasn't a scheduled day for the
   * task's category (see #2201, isCategoryScheduledDay): the day didn't
   * count as work, so it shouldn't count as a miss either. Mutually
   * exclusive with `missed` in practice (nothing passes both); `missed`
   * still wins if it somehow were, since a miss is the more specific claim.
   */
  completeTask: (id: string, options?: {
    missed?: boolean;
    /** See CompletionOptions.missChain (taskCompletion.ts) — ends a mid-chain miss here rather than advancing to the next step. */
    missChain?: boolean;
    deliverableValue?: string | null;
    /** Why that answer, and what would reopen it. See CompletionOptions.deliverableReasoning. */
    deliverableReasoning?: DeliverableReasoning;
    neutral?: boolean;
    completedAt?: string;
    logEarly?: boolean;
    /**
     * The row animated its own transition to the successor's look before
     * calling this (see TaskItem's runCompletion and chainStepAdvancesInPlace)
     * — so the usual completion hold, which keeps a just-ticked row's slot
     * open for a batched collapse, would only fight that: it'd mask this row
     * back to its real (pre-transition) content for the rest of the hold
     * window, undoing the crossfade the moment it lands. Skipping the hold
     * lets the old id disappear and the new one take its place in the same
     * commit, which is invisible precisely because the row already looks
     * like the successor by the time this fires.
     */
    chainStepInPlace?: boolean;
    /**
     * Internal — set by syncWaterQuotaTasks when a water-quota task is
     * completed because the food log's own total reached its target, rather
     * than by a tap on the task. The amount is already sitting in the food
     * log (that's what triggered this), so the usual logHealthMetric write
     * this call would otherwise make is skipped rather than double-added.
     */
    skipHealthLog?: boolean;
  }) => void;
  uncompleteTask: (id: string) => void;
  /**
   * Writes (or clears) the answer on an already-completed task — the Logbook's
   * "Edit answer". Separate from updateTask only in that it's the one write
   * that means "I'm correcting what I decided", so it registers its own undo.
   */
  /**
   * Change a recorded answer after the fact, and with it the reasoning given
   * for it (Task.deliverableWhy / deliverableRevisitIf) when `reasoning` is
   * passed. Clearing the answer clears the reasoning too.
   */
  setDeliverableValue: (id: string, value: string | null, reasoning?: DeliverableReasoning) => void;
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
   *
   * `wholeChain` forwards to `completeTask`'s `missChain` — for a mid-chain
   * step whose later steps depend on this one (meal-slot's Choose → Prepare
   * → Eat), ending the routine here instead of advancing into a step that
   * now has nothing to act on.
   */
  markMissed: (id: string, options?: { wholeChain?: boolean }) => void;
  /**
   * Report a slip against a negative habit — the tap that says "I smoked".
   *
   * The counterpart to `completeTask` for the other polarity, and deliberately
   * not a completion: an avoid-task is never finished, so it never leaves the
   * feed and never spawns a successor. What it does is break the run and record
   * the event. Repeated taps on the same day keep counting, which is how a
   * frequency-logged habit ("how many, not whether") works without needing a
   * second kind of task behind it. See src/utils/negativeHabits.ts.
   */
  logSlip: (id: string) => void;
  /**
   * Takes back a slip logged today, restoring the run it ended.
   *
   * Restores the record only. A penalty block the slip bought stays in force —
   * see `slipPenaltyUntil`, where taking it back would also be a way to buy
   * back a block earned by something else entirely.
   */
  undoSlip: (id: string) => void;
  /**
   * Charge the penalty on every task that has gone past its cutoff undone.
   *
   * The other half of `logSlip` above, for the polarity that fails by *not*
   * doing something: there is no tap to hang it on, so it has to be swept for.
   * Idempotent, which is what lets it sit in the catch-up list — a charge
   * stamps `penaltyFiredAt` on the row it belongs to, and a stamped row is
   * never charged twice however often this runs.
   *
   * Does nothing at all while the feature is switched off, so an install that
   * has never used it cannot accumulate charges waiting to be served.
   */
  sweepTaskPenalties: () => void;
  /**
   * Credits the clean days that have gone by since each negative habit was last
   * accounted for.
   *
   * The one pass in the app that advances a streak without a completion, and it
   * has to be: a negative streak is made of days on which nothing happened, so
   * there is no event for the lazy gap check in `completeTask` to measure from.
   * Runs alongside rolloverQuotas at day rollover and on launch, and is a no-op
   * on almost every call — see cleanDayPatch.
   */
  rolloverNegativeStreaks: () => void;
  logQuotaUnit: (id: string) => void;
  unlogQuotaUnit: (id: string) => void;
  /**
   * Reconciles every daily water-quota task's `progressCount` to what the
   * food log's own water total for today actually says, completing a task
   * outright once that total reaches its target.
   *
   * The log-to-task half of the connection `logHealthMetric: 'waterMl'`
   * makes — see the note on `logTaskHealthValue` in `healthCompletionSync.ts`
   * for the whole picture and why the two directions can't both write to the
   * food log in the same pass. Called by `useFoodLogStore` after any add,
   * revision or delete that touches today's water, so a glass logged through
   * the day view's stepper (or a bottled water logged as food) catches the
   * task up exactly as tapping it would have — including finishing it, with
   * no further tap needed, once the log alone carries it past the target.
   *
   * Scoped to `quotaPeriod === 'day'` tasks that don't ride out the day
   * (`quotaRidesOutTheDay`): a weekly target's relevant total isn't "today's
   * food log", and an overshoot or interval quota's target isn't a finish
   * line to begin with, so both are left to log purely from taps, as before.
   */
  syncWaterQuotaTasks: () => void;
  /** The `snackNudge` pass, called from the food log's writes and the catch-up sweep. */
  syncSnackNudgeTasks: () => void;
  /** The `bookEvent` pass: "Book <saved event>" once its interval is nearly up. */
  checkBookEventTasks: () => void;
  /**
   * Write one pick into a rotation's ledger without completing anything, and
   * report whether the set is now covered.
   *
   * Separate from `logRotationUnit` so the row can record the pick *first* and
   * then drive its own completion animation — the same divert `handleQuotaTap`
   * makes at target, except that a rotation's closing pick has to land in the
   * ledger before the week closes over it.
   */
  recordRotationPick: (id: string, itemId: string) => boolean;
  /** Log one pick against a rotation, completing the task if it covers the set. */
  logRotationUnit: (id: string, itemId: string) => void;
  unlogRotationUnit: (id: string) => void;
  /**
   * Plans a member for today (or clears it when it is already the one planned).
   * A note about the day and nothing more: it hides and completes nothing, see
   * `Task.rotationPlan`.
   */
  planRotationItem: (id: string, itemId: string) => void;
  /** Keeps a back-on-pace daily target on Today until releaseQuotaHold. */
  holdQuotaOnToday: (id: string) => void;
  releaseQuotaHold: (id: string) => void;
  rolloverQuotas: () => void;
  /** Opt-in counterpart to rolloverQuotas for allowOvershoot tasks — see its doc comment. */
  sweepOvershootQuotas: () => void;
  /**
   * Re-expresses every 'wallClock' reminder's stored instant under the
   * device's current timezone, so a reminder set for "9am" still fires at
   * 9am after the device has moved zones instead of at whatever 9am-in-the-
   * old-zone now reads as here. Run on launch (initialize) and on every
   * foreground (TodayScreen's AppState listener), since a phone left closed
   * never sees a cold start and a timezone change while backgrounded is
   * exactly the case this exists for. A 'fixed' reminder, or a task with no
   * captured reminderUtcOffsetMinutes (a pre-migration row nobody has
   * touched yet), is left alone. See #1205.
   */
  reanchorWallClockReminders: () => void;
  /**
   * Closes out interval quotas whose run has ended, at whatever count they
   * reached — see its doc comment. The third quota day-close, and the only one
   * that fires mid-day, because a run ends when its window shuts rather than
   * when the logical day turns over.
   */
  sweepFinishedQuotaRuns: () => void;
  /**
   * Begin today's run now, for a task whose window is a default rather than a
   * commitment — the "start now" half of an optional fixed schedule.
   *
   * Stamps the moment on the occurrence and lets the derived-count rule in
   * updateTask do the rest: a shorter span holds fewer units at the same
   * interval, which is what keeping the cadence and losing the count means.
   */
  startQuotaRun: (id: string) => void;
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
   * Applies an accepted "the trip moved" plan (see utils/awayShift) under one
   * undo entry. deloadTasks' mirror, and deliberately *not* deloadTasks: that
   * one counts postpones, which would blame the user for a flight change, and
   * its undo snapshot drops recurrenceAnchorDate, which a pull-forward writes.
   */
  shiftAwayTasks: (moves: readonly { id: string; updates: Partial<Task> }[]) => void;
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
   * Give everybody with a birthday coming up a task a few days ahead of it, and
   * clear the ones whose reason has gone. See src/utils/birthdayTasks.ts.
   */
  checkBirthdayTasks: () => void;
  /**
   * Give everybody with a birthday coming up (who hasn't opted out) a task to
   * get them a gift, on its own separately configured lead time, and clear the
   * ones whose reason has gone. See src/utils/birthdayTasks.ts.
   */
  checkBirthdayGiftTasks: () => void;
  /**
   * Give everybody whose cadence has run out a "Catch up with X" task, and
   * clear the ones whose reason has gone. See src/utils/reachOutTasks.ts.
   */
  checkReachOutTasks: () => void;
  checkWaitingFollowUpTasks: () => void;
  /**
   * Write today's meal tasks, once per logical day — see the implementation
   * for why the day is both the unit and the whole opt-out.
   */
  checkMealSlotTasks: () => void;
  /** Drop the meal tasks whose (day, slot) already has food logged in it. */
  syncLoggedMealSlotTasks: () => void;
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
   * Once every couple of weeks, and only when several things are in doubt at
   * once, a single task to go through the whole cupboard on the swipe deck.
   * See src/utils/pantryReviewTasks.ts.
   */
  checkPantryReviewTasks: () => void;
  /**
   * Give every planned meal the kitchen can't currently make a "Shop for X"
   * task, and clear the ones whose meal has since been re-planned, moved,
   * cooked, deleted or shopped for. See src/utils/mealShortfallTasks.ts.
   */
  checkMealShortfallTasks: () => void;
  /**
   * Give every meal planned for today or tomorrow that uses something only on
   * hand frozen a "Take X out of the freezer" task, and clear the ones whose
   * meal or freezer has since changed. See src/utils/mealThawTasks.ts.
   */
  checkMealThawTasks: () => void;
  /**
   * Give every planned meal a few days in the past with nothing logged
   * against it a "Log X" task, and clear the ones whose meal has since been
   * logged, told not to ask, deleted, or has fallen out of the window. See
   * src/utils/mealLogNudgeTasks.ts.
   */
  checkMealLogNudgeTasks: () => void;
  /**
   * Give every supply that's running low an "Order more X" task, put every
   * *linked* supply's grocery item on the shopping list instead, and clear the
   * rows whose supply has since been topped back up. See src/utils/supply.ts.
   */
  checkSupplyReorderTasks: () => void;
  /**
   * Once a day, a task to review tomorrow's calendar — only while tomorrow
   * actually has something on it. See src/utils/calendarReviewTasks.ts.
   */
  checkCalendarReviewTasks: () => void;
  checkWeatherTasks: () => void;
  /**
   * Moves every one-off task that is waiting for a kind of day to the first
   * forecast day that matches, and lets it go once that day arrives. Reads the
   * forecast `useWeatherStore` already holds and never fetches; see
   * `src/utils/weatherWait.ts` for the decision.
   */
  applyWeatherWaits: () => void;
  checkEventTasks: () => void;
  /**
   * "Leave for X" for each upcoming event with a location, its reminder at the
   * event's start less `travelLeadMinutes`, and an MTA note in its title when
   * the transit snapshot has one. See src/utils/travelTasks.ts.
   */
  checkTravelTasks: () => void;
  checkScreenTimeTasks: () => void;
  checkHealthTasks: () => void;
  /**
   * Once a day, a task to log how you're feeling — and, after a run of low
   * days, one to plan something you enjoy. See src/utils/moodTasks.ts.
   */
  checkMoodTasks: () => void;
  /**
   * The journal reminder (once a day, or one per configured part of the day)
   * and the daily dream reminder. See src/utils/journalTasks.ts.
   */
  checkJournalTasks: () => void;
  /** The bare-weekend offer — see src/utils/weekendTasks.ts. */
  checkWeekendNudgeTasks: () => void;
  /**
   * The weigh-in request — see src/utils/weightTasks.ts. The one generator pass
   * that takes a Health read of its own rather than judging a snapshot, so the
   * only one that is async.
   */
  checkWeighInTasks: () => Promise<void>;
  /** Tick off today's weigh-in request, if one is live, after a weight is saved. */
  completeWeighInTaskForToday: () => void;
  /**
   * Tick off today's "Log how you're feeling" task, if one is live.
   *
   * Called by the logging sheet once an entry is saved — logging *is* the task,
   * so leaving it on the list after the thing it asks for has been done would
   * be the app not listening. Completed rather than deleted: it is a real
   * record of something done, it belongs in the Logbook and in Stats like any
   * other completion, and the tick is the feedback that the entry landed.
   */
  completeMoodLogTaskForToday: () => void;
  /** The same for the journal or dream reminder, once an entry of that kind is saved for today. */
  completeJournalTaskForToday: (kind: JournalKind) => void;
  /**
   * Rolls a recurring task onto its next date in place, silently — no record,
   * no history row, nothing in the Logbook, streak left exactly as it was.
   *
   * Backs TaskItem's Skip button (distinct from the neighboring Mark Missed
   * button, which is `markMissed` and does leave a record) for "I didn't need
   * to do this one" as opposed to "I forgot" — the two are different claims
   * about the user and only one of them should show up in their history.
   * Also the one thing `sweepExpiredTasks` needs for its own unattended
   * roll-forward: that's a background write with no user present, and
   * stamping a miss they never made would put a fabricated entry in their
   * Logbook.
   */
  skipNextRecurrence: (id: string) => void;
  togglePin: (id: string) => void;
  /**
   * Post a bounty on a task (see "Bounties" in utils/rewards.ts). Refused with
   * 'full' when every slot (`bountyLimit`) is taken, and 'not-allowed' when the
   * task can't hold one: done, a subtask, a negative habit, or already posted
   * on this occurrence.
   */
  postBounty: (id: string) => 'posted' | 'full' | 'not-allowed';
  /** Take a live bounty down. Spends it: it can't be posted again on this occurrence. */
  withdrawBounty: (id: string) => void;
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
  /** Marks a completion timer's countdown as begun — see Task.completionTimerStartedAt. */
  startCompletionTimer: (id: string) => void;
  /** Ends a completion timer's Live Activity early without touching its still-pending notification. */
  dismissCompletionTimer: (id: string) => void;
  /** Dismisses any completion timer whose countdown has already reached zero — see maintenancePasses.ts. */
  sweepExpiredCompletionTimers: () => void;
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
   *
   * Items, not tasks: a stack homed on the project (TaskGroup.projectId) is a
   * row of this list too, and one with no members has only its own id to be
   * moved by. Pass a group id where a stack holds its own slot, and its
   * members' ids where the stack is found through them.
   */
  reorderProjectItems: (projectId: string, orderedIds: string[]) => void;

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
  /**
   * `skipIds` leaves those members alone — the bulk paths use it to complete
   * everything that doesn't ask a question and hand the rest to the prompt
   * queue (see useAnswerFirstCompletion). Omitted, every live member is
   * completed, which is what every non-interactive caller wants.
   */
  completeGroup: (groupId: string, options?: { skipIds?: readonly string[] }) => void;
  uncompleteGroup: (groupId: string) => void;
  deferGroup: (groupId: string, until: Date) => void;
  pinGroup: (groupId: string) => void;
  deleteGroup: (groupId: string, opts: { cascade: boolean }) => void;
  // Bulk selection on the Stacks screen. Same one-entry-per-batch undo rule as
  // bulkDeleteProjects: deleteGroup already knows how to unfile or cascade a
  // stack's roster, so each id goes through it and only the undo is batched.
  bulkDeleteGroups: (groupIds: string[], opts: { cascade: boolean }) => void;
  // Cascades to the roster the same way TaskGroupEditor's saveAndClose does
  // for a single stack — the stack's category is its members' category, so a
  // bulk move re-files them too.
  bulkSetGroupCategory: (groupIds: string[], category: string | null) => void;

  addExistingToProject: (taskId: string, projectId: string) => void;
  // Deleting a project category unfiles the projects in it; the undo entry is
  // registered here with every other undoable action, same split as
  // deleteCategory above.
  deleteProjectCategory: (name: string) => void;
  removeFromProject: (taskId: string) => void;
  /** Unfiles a selection from whatever project each is in, as one undo entry. */
  bulkRemoveFromProject: (taskIds: string[]) => void;
  /** Files the selection under another project, as one undo entry. */
  bulkMoveToProject: (taskIds: string[], projectId: string) => void;
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
  /**
   * A new project with this one's tasks and sections, every task open again
   * and every date cleared, for doing the same thing another time (next
   * year's party, the next trip). The original is left as it was. Returns the
   * new project, or null when the id names nothing.
   */
  startFreshFromProject: (projectId: string) => Project | null;
  // Bulk selection on the Projects screen. One undo entry covers the whole
  // batch — see the note on bulkDeleteProjects.
  bulkDeleteProjects: (projectIds: string[], opts: { cascade: boolean }) => void;
  bulkSetProjectArchived: (projectIds: string[], archived: boolean) => void;

  deleteTemplate: (id: string) => void;
  bulkDeleteTemplates: (ids: string[]) => void;

  forgivVacationStreaks: () => void;
  checkVacationExpiry: () => void;
  /**
   * Arm vacation mode for a nominated trip that has started, and keep its end
   * date in step. The "off" half is checkVacationExpiry above, which already
   * shipped — see this action's own doc for the four rules it holds to.
   */
  checkAwayVacation: () => void;
  resetAllStreaks: () => void;
  bulkCompleteTasks: (ids: string[]) => void;
  bulkUncompleteTasks: (ids: string[]) => void;
  bulkMarkMissed: (ids: string[]) => void;
  /** `skipGeneratedOptOut` has the same meaning as `deleteTask`'s — see its doc comment. */
  bulkDeleteTasks: (ids: string[], opts?: { skipGeneratedOptOut?: boolean; registerUndo?: boolean }) => void;
  clearLogbook: () => void;
  /** A list's "Delete checked": every checked item on it, one Undo step. */
  deleteCheckedListItems: (projectId: string) => void;
  bulkSetPriority: (ids: string[], priority: Priority) => void;
  /** The bulk bar's Difficulty. Null clears the rating back to unrated. */
  bulkSetDifficulty: (ids: string[], difficulty: Difficulty | null) => void;
  bulkTogglePin: (ids: string[]) => void;
  bulkDefer: (ids: string[], until: Date) => void;
  bulkSetWhen: (ids: string[], date: Date | null, timeSegments: TimeOfDay[], options?: { restartSchedules?: boolean; scope?: 'occurrence' | 'series' }) => void;
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

/**
 * The row holding the follow-up rule that wrote `task`, now.
 *
 * `followUpTaskSourceId` names the successor that was live when the follow-up
 * landed, and goes stale once that row is completed in turn. Each completion's
 * successor points back at it through `previousOccurrenceId`, so the walk
 * steps forward along those until it reaches a row still open. A follow-up
 * task points back the same way, which is why rows carrying
 * `followUpTaskSourceTitle` are passed over. Null when the chain ends (the
 * rule's task stopped repeating, or a purge took a link).
 */
function liveFollowUpSource(task: Task, tasks: readonly Task[]): Task | null {
  let row = tasks.find(t => t.id === task.followUpTaskSourceId);
  for (let steps = 0; row && row.completed && steps < 1000; steps++) {
    const prev: Task = row;
    row = tasks.find(t => t.previousOccurrenceId === prev.id && !t.followUpTaskSourceTitle);
  }
  return row && !row.completed && followUpTaskRule(row) ? row : null;
}

/**
 * Carry an estimate edited on an app-written task back to the generator that
 * writes the next one, so it is there next time rather than dying with this
 * row. Where each kind of generator keeps it is in `ruleEstimate.ts`.
 */
function writeEstimateToSource(task: Task): void {
  const estimate = { estimatedMinutes: task.estimatedMinutes, effort: task.effort };
  if (task.followUpTaskSourceId) {
    const store = useTaskStore.getState();
    const source = liveFollowUpSource(task, store.tasks);
    if (source) {
      const draft = source.followUpTaskDraft ?? emptyFollowUpTaskDraft();
      if (draft.estimatedMinutes !== estimate.estimatedMinutes || draft.effort !== estimate.effort) {
        const next = { ...draft, ...estimate };
        store.updateTask(source.id, { followUpTaskDraft: followUpTaskDraftIsEmpty(next) ? null : next });
      }
    }
  }
  const settings = useSettingsStore.getState();
  switch (task.generatedKind) {
    case 'weather': {
      const ruleId = weatherRuleIdOf(task);
      const next = ruleId ? withRuleEstimate(settings.weatherRules, ruleId, estimate) : null;
      if (next) settings.setWeatherRules(next);
      break;
    }
    case 'screenTime': {
      const ruleId = screenTimeRuleIdOf(task);
      const next = ruleId ? withRuleEstimate(settings.screenTimeRules, ruleId, estimate) : null;
      if (next) settings.setScreenTimeRules(next);
      break;
    }
    case 'health': {
      const ruleId = healthRuleIdOf(task);
      const next = ruleId ? withRuleEstimate(settings.healthRules, ruleId, estimate) : null;
      if (next) settings.setHealthRules(next);
      break;
    }
    case 'eventTask': {
      const ruleId = eventTaskRuleIdOf(task);
      const next = ruleId ? withRuleEstimate(settings.eventRules, ruleId, estimate) : null;
      if (next) settings.setEventRules(next);
      break;
    }
    default: {
      if (!task.generatedKind || !holdsKindEstimate(task.generatedKind)) break;
      const next = withGeneratorEstimate(settings.generatorEstimates ?? {}, task.generatedKind, estimate);
      if (next) settings.setGeneratorEstimates(next);
    }
  }
}

/**
 * The `waterShortfall` generator's whole pass: a one-off task for the water
 * still owed, once the daily water task that follows the food log's target was
 * finished before the target rose. See `src/utils/waterShortfallTasks.ts`.
 *
 * Runs at the end of `syncWaterQuotaTasks`, the one place already called
 * whenever today's water total, the target or today's exercise changes, rather
 * than on a clock of its own.
 */
function reconcileWaterShortfall(args: {
  todayKey: string;
  totalMl: number;
  exerciseReadToday: boolean;
  exerciseMinutes: number | null;
  tasks: Task[];
}): void {
  const settings = useSettingsStore.getState();
  if (!settings.waterShortfallTasks || !settings.waterShortfallTaskCategory) return;
  if (generatorPausedForVacation('waterShortfall', settings.vacationMode)) return;
  // A configured boost with no reading for today can't say what the target is,
  // and a target that is unknown is not a target that is lower. Same refusal
  // followedWaterTargetCount makes: leave whatever is there alone.
  if (settings.waterExerciseBoost && !args.exerciseReadToday) return;

  const targetMl = effectiveWaterTargetMl(
    settings.nutritionTargets.waterMl, args.exerciseMinutes, settings.waterExerciseBoost,
  );
  const owedMl = waterShortfallMl(targetMl, args.totalMl);
  const wanted =
    owedMl !== null &&
    followedWaterTaskDoneOn(args.tasks, args.todayKey) &&
    settings.waterShortfallDeclinedDayKey !== args.todayKey;

  const dueDate = getCurrentDayStart();
  dueDate.setHours(12, 0, 0, 0);

  // A request from a day that has gone is dropped rather than deleted quietly
  // with an opt-out: nobody declined it, the day just ended.
  liveGeneratedTasksOfKind(args.tasks, 'waterShortfall')
    .filter(t => t.generatedSourceId !== args.todayKey)
    .forEach(t => dropGeneratedTask('waterShortfall', t.generatedSourceId));

  reconcileGeneratedTask({
    kind: 'waterShortfall',
    sourceId: args.todayKey,
    wanted,
    // A completed one blocks a second today, which is what stops completing it
    // (and logging only part of what it asked for) from asking again.
    blocksOnFinished: true,
    drift: existing => {
      if (owedMl === null) return null;
      const title = waterShortfallTitle(owedMl, settings.waterUnit);
      if (existing.title === title && existing.logHealthAmount === owedMl) return null;
      return { title, logHealthAmount: owedMl };
    },
    draft: () => ({
      title: waterShortfallTitle(owedMl ?? 0, settings.waterUnit),
      notes: WATER_SHORTFALL_NOTES,
      dueDate: dueDate.toISOString(),
      category: settings.waterShortfallTaskCategory,
      // Completing it logs the water it asked for, through the same path the
      // daily task uses, so the food log and the target both move.
      logHealthMetric: 'waterMl',
      logHealthAmount: owedMl ?? undefined,
      ...generatedBy('waterShortfall', args.todayKey),
    }),
  });
}

/**
 * The `bookEvent` generator's whole pass. See `src/utils/savedEventTasks.ts`.
 *
 * Its sources are the saved events, a synced setting read fresh each time.
 * A live task for a cycle that no longer wants one (the next appointment was
 * added, the interval was cleared, the event was removed) is dropped without
 * an opt-out: nobody declined it.
 */
function reconcileBookEvents(tasks: Task[]): void {
  const settings = useSettingsStore.getState();
  if (!settings.bookEventTasks || !settings.bookEventTaskCategory) return;
  if (generatorPausedForVacation('bookEvent', settings.vacationMode)) return;
  // Saved events are a setting the demo database doesn't hold for real.
  if (isDemoModeActive()) return;

  const today = getLogicalToday();
  const wanted = new Map<string, SavedEvent>();
  for (const event of readSavedEvents()) {
    const id = bookSourceId(event);
    if (id && wantsBookTask(event, today)) wanted.set(id, event);
  }

  liveGeneratedTasksOfKind(tasks, 'bookEvent')
    .filter(t => !t.generatedSourceId || !wanted.has(t.generatedSourceId))
    .forEach(t => dropGeneratedTask('bookEvent', t.generatedSourceId));

  const category = settings.bookEventTaskCategory;
  for (const [sourceId, event] of wanted) {
    reconcileGeneratedTask({
      kind: 'bookEvent',
      sourceId,
      wanted: true,
      // Ticked off means booked for this cycle; adding the appointment then
      // moves the source to the next one.
      blocksOnFinished: true,
      // The date is the source's, and only a new cycle moves it, which is a new
      // source id. Nothing to drift.
      drift: () => null,
      draft: () => ({
        title: bookTaskTitle(event.title),
        notes: bookTaskNotes(event),
        dueDate: (bookDueDay(event) ?? today).toISOString(),
        category,
        ...generatedBy('bookEvent', sourceId),
      }),
    });
  }
}

/**
 * The `snackNudge` generator's whole pass. See `src/utils/snackNudgeTasks.ts`.
 *
 * Judged on every food log write for today and on every catch-up sweep: the
 * first is what removes the task once a snack is logged, the second is what
 * brings it on when 3 PM arrives with nothing having been logged since.
 */
function reconcileSnackNudge(tasks: Task[]): void {
  const settings = useSettingsStore.getState();
  if (!settings.snackNudgeTasks || !settings.snackNudgeTaskCategory) return;
  if (generatorPausedForVacation('snackNudge', settings.vacationMode)) return;
  // The demo database holds a seeded task for this kind (demoSeed.ts) that no
  // food log backs, and this pass would delete it as unwanted on the next sweep.
  if (isDemoModeActive()) return;

  const todayKey = dayKeyOf(getCurrentDayStart());
  const healthToday = useHealthStore.getState().today;
  const activeEnergyRead = healthToday?.dayKey === todayKey;
  // A configured boost with no reading for today can't say what the target is,
  // and a target that is unknown is not a target that is lower: leave whatever
  // is there alone, the refusal reconcileWaterShortfall makes.
  if (settings.activeEnergyBoost && !activeEnergyRead) return;

  const targetKcal = effectiveCalorieTargetKcal(
    settings.nutritionTargets.calorieKcal,
    activeEnergyRead ? healthToday?.activeEnergyKcal ?? null : null,
    settings.activeEnergyBoost,
  );
  const loggedKcal = loggedKcalToday(dbGetFoodLogEntries(todayKey, todayKey));
  const wanted =
    snackNudgeApplies(
      loggedKcal, targetKcal, new Date(), settings.snackNudgeFromHour, settings.snackNudgeSharePercent,
    ) &&
    settings.snackNudgeDeclinedDayKey !== todayKey;

  const dueDate = getCurrentDayStart();
  dueDate.setHours(12, 0, 0, 0);

  // A request from a day that has gone is dropped rather than deleted quietly
  // with an opt-out: nobody declined it, the day just ended.
  liveGeneratedTasksOfKind(tasks, 'snackNudge')
    .filter(t => t.generatedSourceId !== todayKey)
    .forEach(t => dropGeneratedTask('snackNudge', t.generatedSourceId));

  reconcileGeneratedTask({
    kind: 'snackNudge',
    sourceId: todayKey,
    wanted,
    // A completed one blocks a second today: eating the snack and logging it
    // should end the question, not ask it again at the next write.
    blocksOnFinished: true,
    drift: existing => {
      if (loggedKcal === null || targetKcal === undefined) return null;
      const title = snackNudgeTitle(loggedKcal, targetKcal);
      return existing.title === title ? null : { title };
    },
    draft: () => ({
      title: snackNudgeTitle(loggedKcal ?? 0, targetKcal ?? 0),
      notes: SNACK_NUDGE_NOTES,
      dueDate: dueDate.toISOString(),
      category: settings.snackNudgeTaskCategory,
      ...generatedBy('snackNudge', todayKey),
    }),
  });
}

/**
 * The reminders of the tasks whose answer gate rides on `questionId`, put in
 * step with its answer: a branch that was just ruled out has its reminder
 * cancelled, and one an answer correction brought back has it rescheduled.
 * `rescheduleAllReminders` would get there on the next launch; this is so the
 * phone doesn't buzz for "Book City Hall" an hour after you chose otherwise.
 */
function syncGatedReminders(questionId: string, tasks: Task[]): void {
  for (const t of tasks) {
    if (t.answerGate?.taskId !== questionId || !t.reminderTime || t.completed || t.archived) continue;
    if (isTaskNotNeeded(t)) cancelTaskReminder(t.id);
    else scheduleTaskReminder(t);
  }
}

/**
 * The redo half of an undo that restores whole task rows. Call it after the
 * edit has been written: it captures the rows as the edit left them, and
 * writes those back when the undo is itself undone.
 */
export function redoRestoringRows(ids: string[]): () => void {
  const after = useTaskStore.getState().tasks.filter(t => ids.includes(t.id)).map(t => ({ ...t }));
  return () => after.forEach(t => useTaskStore.getState().updateTask(t.id, t));
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  tagRegistry: [],
  initialized: false,
  lastAction: null,
  undoStack: [],
  redoStack: [],
  readyOffer: null,
  tripDatePrompt: null,
  clearTripDatePrompt() {
    set({ tripDatePrompt: null });
  },
  clearReadyOffer() {
    set({ readyOffer: null });
  },
  redateRoutines(taskIds) {
    const resetTime = useSettingsStore.getState().dayResetTime;
    const today = getLogicalToday(resetTime);
    const snapshots = get().tasks.filter(t => taskIds.includes(t.id) && !t.completed).map(t => ({ ...t }));
    if (snapshots.length === 0) return;
    for (const task of snapshots) {
      const next = task.recurrenceFromCompletion ? today : getNextDueDate(task, resetTime, { catchUp: true });
      if (!next) continue;
      get().updateTask(task.id, { dueDate: next.toISOString(), deferUntil: null }, { skipPostponeCount: true });
    }
    get().setLastAction({
      label: snapshots.length === 1 ? 'Routine moved' : `${snapshots.length} routines moved`,
      undo: () => snapshots.forEach(snapshot => get().updateTask(snapshot.id, snapshot)),
      redo: redoRestoringRows(snapshots.map(t => t.id)),
    });
  },
  placeReadyTasks(date) {
    const offer = get().readyOffer;
    set({ readyOffer: null });
    if (!offer) return;
    const snapshots = get().tasks.filter(t => offer.taskIds.includes(t.id) && !t.completed).map(t => ({ ...t }));
    if (snapshots.length === 0) return;
    const day = new Date(date);
    day.setHours(12, 0, 0, 0);
    for (const task of snapshots) {
      get().updateTask(task.id, { dueDate: day.toISOString() }, { markSeenOnBecomeVisible: true });
    }
    get().setLastAction({
      label: snapshots.length === 1 ? 'Task scheduled' : `${snapshots.length} tasks scheduled`,
      undo: () => snapshots.forEach(snapshot => get().updateTask(snapshot.id, snapshot)),
      redo: redoRestoringRows(snapshots.map(t => t.id)),
    });
  },
  ...undoHistoryActions(set, get),
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
    // And the same for the Health reading, which files the same way for the
    // same reasons.
    ensureHealthCategory();
    // And the same for the tasks the app writes itself. Both are here rather
    // than in the settings store because they add a category, and the
    // categories have just finished loading.
    ensureGeneratedTaskCategories();
    useTemplateStore.getState().initialize();
    useTaskGroupStore.getState().initialize();
    useProjectStore.getState().initialize();
    useProjectCategoryStore.getState().initialize();
    // Beside the other task-metadata stores, and on the fan-out for the same
    // swap-the-database reason: a saved view is a lens over tasks, so a list
    // left pointed at the previous database would filter the new one with the
    // old one's views.
    useSavedViewStore.getState().initialize();
    // Rides the same fan-out as everything below it, and for the identical
    // swap-the-database reason: a person list left pointed at the previous
    // database while tasks showed the new one would render demo tasks naming
    // real people, or the reverse.
    usePersonStore.getState().initialize();
    // Immediately after the people, and on the same fan-out for the same
    // database-swap reason: notes left pointed at the previous database would
    // render real facts about real people under demo names.
    usePersonNoteStore.getState().initialize();
    // Also immediately after the people, for the identical reason: a group
    // left pointed at the previous database would name people who don't
    // exist in the new one.
    usePersonGroupStore.getState().initialize();
    // On the same fan-out as everything else here, and for the same
    // swap-the-database reason: a mood history left pointed at the previous
    // database would show a demo session's invented entries as the real
    // person's own record, or the reverse — and this is the one store where
    // that mistake is a claim about somebody's health.
    useMoodStore.getState().initialize();
    // Beside the mood log, on the same fan-out and for the same reason:
    // milestones are read against it, so a device swap that left them out of
    // step would date a before/after split against the wrong person's phone.
    useMilestoneStore.getState().initialize();
    // The journal grew out of the mood entry's note, so it sits beside it on
    // the fan-out for the same swap-the-database reason.
    useJournalStore.getState().initialize();
    // Beside the mood log, same fan-out, and the sharpest version of the same
    // stakes: a medication history left pointed at the previous database would
    // report a demo session's invented doses as a real person's record of what
    // they have taken.
    useMedicationStore.getState().initialize();
    // The coin ledger. Same fan-out, so a demo session's invented coins never
    // sit on top of a real balance.
    useRewardStore.getState().initialize();
    // Beside the mood log and for the identical reason, with the same stakes:
    // a food log left pointed at the previous database would show a demo
    // session's invented meals as somebody's own record of what they ate.
    useFoodLogStore.getState().initialize();
    // Beside the food log it's built from, for the same demo-mode stakes: a
    // saved meal left pointed at the previous database would offer a demo
    // session's invented combination as something to log again for real.
    useSavedMealsStore.getState().initialize();
    // On the same fan-out for the plainest version of the reason: the ledger is
    // an account of what the app did to *this* database, so one left pointed at
    // the previous one would report a demo session's invented generators against
    // the real list, and the passes that run moments later would append to a log
    // belonging to a database they are not touching.
    useUnattendedStore.getState().initialize();
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
    // Read from the settings table the same way, and on the same
    // swap-the-database hazard: a reminder set in one database (real or
    // demo) is meaningless once the file underneath has changed.
    useEventReminderStore.getState().initialize();
    // Same settings-table read, same swap-the-database hazard: an event hidden
    // in one database (real or demo) is meaningless once the file underneath
    // has changed.
    useHiddenEventsStore.getState().initialize();
    // Same again: who an event is with names demo people in a demo database.
    useEventPeopleStore.getState().initialize();
    useEventTaskLinkStore.getState().initialize();
    const tasks = dbGetAllTasks();
    backfillRecurrenceAnchors(tasks);
    const tagRegistry = dbGetTagRegistry();
    // After the tasks, and given them: a stored focus session points at task
    // ids, and the first thing it does is drop the stretches belonging to
    // tasks that were completed or deleted while the app was shut. Rides this
    // fan-out rather than App.tsx for the swap-the-database reason above.
    useFocusStore.getState().initialize(tasks);

    set({ tasks, tagRegistry, initialized: true });
    // The device's timezone can have changed while the app was shut — a cold
    // start is the only chance to notice, since nothing runs while it's
    // closed. Reanchoring has to happen before rescheduling the native
    // notifications below, or they'd be scheduled against the stale instant;
    // re-reading get().tasks afterward (rather than reusing the local
    // `tasks` from above) is what makes that ordering actually take effect.
    // See #1205.
    get().reanchorWallClockReminders();
    const { tripShopId, tripStartedAt, shops } = useGroceryStore.getState();
    const eventReminders = Object.values(useEventReminderStore.getState().remindersByKey);
    rescheduleAllReminders(get().tasks, { shopId: tripShopId, startedAt: tripStartedAt, shops }, eventReminders);
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

    // One WAL transaction for the whole roll-forward rather than one per row.
    // Each skipNextRecurrence ends in an updateTask, which is an ~85-column
    // UPDATE plus its sync trigger, and this runs unattended at launch over
    // however many windows closed while the app was shut.
    //
    // Safe despite updateTask scheduling a reminder: withTransactionSync runs
    // its body synchronously and every scheduleTaskReminder call in this store
    // is deliberately fire-and-forget, so the transaction commits before any
    // of those promises resolve. It is the db writes that are batched, not the
    // notification work. The per-row set() stays, because collapsing that would
    // mean reimplementing skipNextRecurrence's own rules out here.
    dbTransaction(() => rolled.forEach(t => get().skipNextRecurrence(t.id)));
    // skipGeneratedOptOut: this runs unattended at startup — a window closing
    // on its own is the app tidying up, not the user declining the source.
    // registerUndo: false for the same reason, so the first shake of the
    // session doesn't offer to bring back rows the user never deleted.
    if (doomed.length > 0) {
      // Recorded before the delete, so the titles are still there to snapshot.
      // Only the deleted rows: a recurring occurrence that was rolled forward
      // still exists and nothing was taken, so an entry for it would report a
      // loss that didn't happen. The entry says the window closed, which is all
      // this sweep is entitled to claim — see the note above on why it refuses
      // to call any of this a miss.
      useUnattendedStore.getState().recordMany(
        doomed.map(t => ({
          action: 'expired' as const,
          kind: t.generatedKind,
          title: t.title,
          taskId: t.id,
        })),
      );
      get().bulkDeleteTasks(doomed.map(t => t.id), { skipGeneratedOptOut: true, registerUndo: false });
    }
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

    // Focus history rides the same window — one promise from the user's side,
    // rather than a second setting that would let the Logbook and the Stats
    // focus sections disagree about how far back the app remembers. Before the
    // early return below, since a day with no purgeable tasks can still have
    // sessions old enough to go. Not added to the returned count, which is
    // about tasks and is what the caller reports.
    useFocusStore.getState().purgeHistoryBefore(cutoff);

    const listIds = new Set(useProjectStore.getState().projects.filter(p => p.kind === 'list').map(p => p.id));
    const ids = selectPurgeableTaskIds(get().tasks, cutoff, listIds);
    if (ids.length === 0) return 0;
    const idSet = new Set(ids);

    dbBulkDeleteTasks(ids);
    set(s => ({
      tasks: s.tasks.filter(t => !idSet.has(t.id) && (t.parentId === null || !idSet.has(t.parentId))),
    }));
    // One entry for the set rather than one per row, and the only entry in the
    // ledger that carries a count. A purge takes tombstones by the hundred on
    // the launch after a window is first chosen, and a line per row would bury
    // every other thing the app did that day under history the user already
    // asked to be rid of.
    useUnattendedStore.getState().record({
      action: 'purged', kind: null, title: '', taskId: null, count: ids.length,
    });
    return ids.length;
  },

  reconcileSyncedEvents(applied) {
    const find = (id: string) => get().tasks.find(t => t.id === id) ?? null;
    const plan = taskEventsAfterSync(applied, find);
    if (
      plan.deadlines.length === 0 &&
      plan.timeBlocks.length === 0 &&
      plan.uncompleted.length === 0 &&
      plan.remove.length === 0
    ) return;
    // Only with calendar access, for the meal reconcile's reason. Without it
    // the deadline move fails, the fallback creates nothing and returns null,
    // and that null written over the link orphans an event this device can no
    // longer name; a time block reads back as null and loses its pointer the
    // same way. This runs unasked, over every task another device touched, so
    // it skips instead, and the task's next local reconcile once access is back
    // puts its events right.
    void getCalendarPermission()
      .then(permission => {
        if (permission !== 'granted') return;
        // Re-read after the await: the row may have moved on, or gone. A link
        // cleared meanwhile is not recreated here, for the reason the rule
        // gives for a task that never had one.
        //
        // Every write below lands on a row another device edited and this one
        // didn't, and changes only the device-local link columns, so each
        // keeps the row's sync stamp (`keepStamp`, `dbUpdateTaskCalendarLinks`):
        // restamped, the row would read as this device's edit of a moment ago
        // and win the next merge over the peer's edit that put it here.
        const unattended: ReconcileWrite = { keepStamp: true };
        for (const task of plan.deadlines) {
          const current = find(task.id);
          if (current?.calendarEventId) reconcileDeadlineEvent(current, unattended);
        }
        for (const task of plan.timeBlocks) {
          const current = find(task.id);
          if (current) reconcileTimeBlockEvent(current, unattended);
        }
        // Reopened on another device, so the completion this device's event
        // recorded didn't happen: the same delete and unlink `uncompleteTask`
        // runs. Only while the row still says so, since it may have been
        // completed again, or reopened here, while the permission was read.
        for (const task of plan.uncompleted) {
          const current = find(task.id);
          if (!current || current.completed || !current.completionCalendarEventId) continue;
          void deleteCompletionEvent(completionEventLink(current));
          const updated = { ...current, completionCalendarEventId: null, completionCalendarEventExternalId: null };
          dbUpdateTaskCalendarLinks(current.id, { completionCalendarEventId: null, completionCalendarEventExternalId: null });
          set(s => ({ tasks: s.tasks.map(t => (t.id === updated.id ? updated : t)) }));
        }
        for (const link of plan.remove) void deleteDeadlineEvent(link);
      })
      .catch(() => {});
  },

  fillCalendarExternalIds(found) {
    const written = new Set(dbFillTaskCalendarExternalIds(found));
    if (written.size === 0) return;
    set(s => ({
      tasks: s.tasks.map(t => (written.has(t.id)
        ? {
            ...t,
            calendarEventExternalId: filledExternalId(t.calendarEventId, t.calendarEventExternalId, found),
            timeBlockExternalId: filledExternalId(t.timeBlockEventId, t.timeBlockExternalId, found),
            completionCalendarEventExternalId: filledExternalId(
              t.completionCalendarEventId, t.completionCalendarEventExternalId, found
            ),
          }
        : t)),
    }));
  },

  addTask(draft, id, options) {
    const now = new Date().toISOString();
    const maxOrder = get().tasks.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    // A generated task is a fresh row each time, so it starts from the
    // estimate its generator keeps (ruleEstimate.ts). A rule's own estimate
    // is already on the draft; this is the per-kind one.
    const kindEstimate = draft.generatedKind && !draftHasEstimate(draft) && holdsKindEstimate(draft.generatedKind)
      ? useSettingsStore.getState().generatorEstimates?.[draft.generatedKind] ?? null
      : null;
    const task = newTaskFromDraft(
      applyTitleRulesToDraft(kindEstimate ? { ...draft, ...kindEstimate } : draft, options),
      now, maxOrder + 1, true, id, options?.skipCategoryDefault);
    dbInsertTask(task);
    set(s => ({ tasks: [...s.tasks, task] }));
    scheduleTaskReminder(task);
    scheduleQuotaNudges(task);
    reconcileDeadlineEvent(task);
    return task;
  },

  addCompletedTask(title, at, personIds) {
    const iso = at.toISOString();
    const task = get().addTask({ title, dueDate: iso, personIds });
    get().completeTask(task.id);
    get().updateTask(task.id, { completedAt: iso });
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
    // Each write adds or removes this one blocker and keeps whatever else the
    // row waits on: a task can wait on several now (Task.blockedByIds).
    const without = (id: string) => {
      const row = get().tasks.find(t => t.id === id);
      return row ? blockerFields(blockerIdsOf(row).filter(b => b !== blockerId)) : blockerFields([]);
    };
    const withIt = (id: string) => {
      const row = get().tasks.find(t => t.id === id);
      return blockerFields([...(row ? blockerIdsOf(row) : []), blockerId]);
    };
    const { unlink } = resolveBlocksEdit(blockerId, taskIds, get().tasks);
    unlink.forEach(id => get().updateTask(id, without(id)));
    // Recomputed against what the releases left behind rather than decided up
    // front, and that's the whole reason for the second call: releasing one
    // date of a dated set fans the release out to the set's later dates, which
    // may be rows this edit is keeping. Deciding both passes from the state
    // before either ran would drop those on the floor.
    const { link } = resolveBlocksEdit(blockerId, taskIds, get().tasks);
    link.forEach(id => get().updateTask(id, withIt(id)));
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
        cancelQuotaNudges(t.id);
        if (t.calendarEventId) void deleteDeadlineEvent(deadlineEventLink(t));
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
    // Repointed onto a wanted date no other open row of the set already holds.
    // Always taking the earliest could land it on a sibling's date, and the
    // reconcile below then kept one and deleted the other: editing the 10th's
    // dates to {15th, 20th} deleted the 15th that was already there, with its
    // notes and subtasks.
    const heldByOthers = new Set(
      (anchor.seriesId ? get().seriesRowsOf(anchor.seriesId) : [])
        .filter(t => t.id !== taskId && !t.completed && !t.archived && t.dueDate)
        .map(t => calendarDayKey(new Date(t.dueDate!)))
    );
    const repointTo = sorted.find(d => !heldByOthers.has(calendarDayKey(d))) ?? sorted[0];
    get().updateTask(taskId, {
      dueDate: anchorKept ? anchor.dueDate : repointTo.toISOString(),
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
    // A row whose own date was dropped goes last, so if every wanted date was
    // already held (see repointTo above) it's the one left over, not a sibling
    // that still had its date.
    const live = rows
      .filter(t => !t.completed && !t.archived)
      .sort((a, b) => (anchorKept ? 0 : Number(a.id === taskId) - Number(b.id === taskId)));

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
      cancelQuotaNudges(t.id);
      // The row is gone for good, not archived — nothing will ever revisit
      // it to notice a dangling event, so clean it up now, same as deleteTask.
      if (t.calendarEventId) void deleteDeadlineEvent(deadlineEventLink(t));
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
      cancelQuotaNudges(t.id);
    });
    set(s => ({ tasks: s.tasks.filter(t => !ids.has(t.id) && !(t.parentId && ids.has(t.parentId))) }));

    get().setLastAction({
      label: live.length === 1 ? 'Task deleted' : `${live.length} dates deleted`,
      destructive: true,
      redo: () => get().deleteSeries(seriesId),
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
      priorBestStreak: 0,
      timerStartedAt: null,
      actualMinutes: null,
      // The duplicate keeps the duration but starts its countdown fresh. The
      // health target is not reset alongside it, and neither is timedMinutes:
      // the countdown's *progress* is what belongs to the original run, where
      // the target is part of what the task is.
      timerElapsedSeconds: 0,
      // Same split as actualMinutes above: the copy still asks the question,
      // it just hasn't been answered yet.
      deliverableValue: null,
      deliverableWhy: null,
      deliverableRevisitIf: null,
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
      bountyPushes: null,
      // deadlineOnCalendar (the preference) carries via ...original, same as
      // every other setting on the copy, but the device event does not —
      // two tasks pointing at one event means editing either one's deadline
      // silently drags the other's calendar entry with it. Nor its server id,
      // which would let the copy find the original's event again (#2950).
      calendarEventId: null,
      calendarEventExternalId: null,
      // logCompletionToCalendar carries via ...original the same way, but a
      // copy is a fresh, uncompleted task — it hasn't logged anything yet.
      completionCalendarEventId: null,
      completionCalendarEventExternalId: null,
      // Same reasoning, and the copy has no claim on the original's slot
      // anyway — the block was time set aside for one piece of work.
      timeBlockEventId: null,
      timeBlockExternalId: null,
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
   * The time-block action's plan. Creating and editing both happen in the
   * in-app event card (`QuickEventSheet`), which saves through `rewriteEvent`
   * like every other event write; this only says which one to open.
   *
   * The proposed slot is only a prefill. `timeBlockFieldsFor` reads the
   * calendar window to find a gap the task actually fits in, and the card shows
   * it on its date chip, so a poor guess costs a tap rather than a wrong event.
   * `loaded` is what's passed rather than `events`, for the reason the flag
   * exists: an empty window and a calendar we couldn't open are both `[]`, and
   * only one of them means the day is free.
   */
  async planTimeBlock(id) {
    // The same guard the three automatic calendar syncs keep: the demo
    // database is thrown away, so a block made from seeded fiction would leave
    // a real event on a real calendar with the only pointer to it discarded.
    if (isDemoModeActive()) return null;

    const task = get().tasks.find(t => t.id === id);
    if (!task) return null;

    if (task.timeBlockEventId) {
      if (await readTimeBlockEvent(task.timeBlockEventId)) {
        return { mode: 'edit', eventId: task.timeBlockEventId };
      }
      // Not there under its own id. A backup restored on a new phone looks
      // exactly like this, with the block still on the calendar under the
      // server's id, so look for it by that before giving up on it (#2950).
      const adopted = await adoptTimeBlock(task);
      if (adopted) return { mode: 'edit', eventId: adopted.eventId };
      // Genuinely gone: deleted from the Calendar app, or on a calendar that
      // was removed. Drop the stale pointer and offer a fresh block instead,
      // so the tap that found the rot also fixes it.
      setTimeBlockLink(id, NO_EVENT_LINK);
    }

    const { activeHoursStart, activeHoursEnd, dayResetTime } = useSettingsStore.getState();
    const { events, loaded } = useCalendarStore.getState();
    const fields = timeBlockFieldsFor(get().tasks.find(t => t.id === id) ?? task, {
      now: new Date(),
      dayResetTime,
      activeHoursStart,
      activeHoursEnd,
      events: loaded ? events : null,
    });
    return fields ? { mode: 'create', fields } : null;
  },

  linkTimeBlock(id, eventId) {
    setTimeBlockLink(id, { eventId, externalId: null });
    // And the server's id for it, so a backup restored on a new phone can find
    // the block again (#2950). In the background: the block is made whether or
    // not the read answers.
    recordTimeBlockExternalId(id, eventId);
  },

  unlinkTimeBlock(id) {
    setTimeBlockLink(id, NO_EVENT_LINK);
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

      const updated = mergeTaskUpdate(t, updates, {
        scope,
        freshPinnedOrder,
        dayResetTime,
        skipPostponeCount: options?.skipPostponeCount,
        markSeenOnBecomeVisible: options?.markSeenOnBecomeVisible,
      });
      dbUpdateTask(updated);
      if (
        'reminderTime' in updates ||
        'reminderKind' in updates ||
        'reminderOffsetDays' in updates ||
        'reminderTracksVisibility' in updates ||
        'completed' in updates ||
        'archived' in updates ||
        'title' in updates ||
        'notes' in updates
      ) {
        cancelTaskReminder(id);
        scheduleTaskReminder(updated);
      }
      // The nudge grid is rebuilt whenever anything it's derived from moves —
      // the span fields, the count that divides it, the toggle itself — plus
      // the two states that mean there is nothing left to nudge about, and the
      // title/notes the notification is written from. Wider than the reminder
      // gate above because a nudge is derived from more: a reminder is one
      // stored instant, a run is a whole schedule.
      if (
        QUOTA_SPAN_FIELDS.some(f => f in updates) ||
        ROTATION_TARGET_FIELDS.some(f => f in updates) ||
        'quotaReminders' in updates ||
        'targetCount' in updates ||
        'vacationPause' in updates ||
        'completed' in updates ||
        'archived' in updates ||
        'title' in updates ||
        'notes' in updates
      ) {
        scheduleQuotaNudges(updated);
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
    // A restock that satisfies a linked supply takes back the "running low" the
    // supply put on its grocery item, so the next time it runs down it asks
    // again rather than reading as already handled (#2935). See
    // supplyRestockReleasesItem. registerUndo: false because it adds nothing
    // to a list: clearing the flag leaves the row wherever it is, and nobody
    // tapped the grocery item.
    const releasedItemId = current && edited ? supplyRestockReleasesItem(current, edited, dayResetTime) : null;
    if (releasedItemId) useGroceryStore.getState().setRunningLow(releasedItemId, false, { registerUndo: false });
    // Compared on the values rather than on the patch's keys, since an undo
    // and a whole-row write both name these fields without changing them.
    if (current && edited && (edited.generatedKind || edited.followUpTaskSourceId)
      && (current.estimatedMinutes !== edited.estimatedMinutes || current.effort !== edited.effort)) {
      writeEstimateToSource(edited);
    }
    if (scope === 'series' && edited?.seriesId) {
      const patched = seriesFanOutRows(edited, updates, get().tasks);
      if (patched.length > 0) {
        patched.forEach(t => {
          dbUpdateTask(t);
          cancelTaskReminder(t.id);
          cancelQuotaNudges(t.id);
          scheduleTaskReminder(t);
        });
        const byId = new Map(patched.map(t => [t.id, t]));
        set(s => ({ tasks: s.tasks.map(t => byId.get(t.id) ?? t) }));
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

  deleteTask(id, opts = {}) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    const subtasks = get().subtasksOf(id);

    dbDeleteSubtasks(id);
    dbDeleteTask(id);
    cancelTaskReminder(id);
    if (task.quotaReminders) cancelQuotaNudges(id);
    cancelCompletionTimer(id);
    if (task.timerStartedAt !== null) cancelTimerAlarm(id);
    // Fire-and-forget, same as every other calendar/notification side effect
    // here. Not restored on undo below — deleting a device event isn't
    // reversible, so an undone delete gets a fresh event on its next
    // reconcile rather than a promise this can't keep.
    if (task.calendarEventId) void deleteDeadlineEvent(deadlineEventLink(task));
    set(s => ({ tasks: s.tasks.filter(t => t.id !== id && t.parentId !== id) }));

    // Deleting a generated task is the user saying this source doesn't need
    // one, and that has to be written down on the source: the meal is still on
    // the calendar, the item is still in the catalog, the container is still in
    // the fridge, and the next reconcile would otherwise hand the task straight
    // back — weekly, for a staple. The one deliberate exception to "the source
    // is the master": a delete here is an instruction to it, not drift from it.
    //
    // bulkDeleteTasks writes the same opt-out for the same reason — a
    // selection-bar delete of a live "Catch up with Sarah" is exactly as much
    // an instruction to the source as this single-row path is. It defaults to
    // skipping only for the sweeps that route through it on the app's own
    // behalf (see sweepExpiredTasks), which is the case this comment used to
    // describe as "not user-initiated" for the whole function.
    //
    // And not when the app is the one deleting: a reconcile clearing a task
    // whose reason has gone is tidying up, not the source changing its mind
    // (generatedTaskSync's deleteGeneratedTaskQuietly passes this for both of
    // its paths: reconcileGeneratedTask's `!wanted` branch and dropGeneratedTask).
    if (!opts.skipGeneratedOptOut) writeGeneratedOptOut(task, false);

    get().setLastAction({
      // A list's rows are items, and the page they were deleted from says so.
      label: task.projectId && useProjectStore.getState().projects.some(p => p.id === task.projectId && p.kind === 'list')
        ? 'Item deleted'
        : 'Task deleted',
      destructive: true,
      redo: () => get().deleteTask(id, opts),
      undo: () => {
        dbInsertTask(task);
        scheduleTaskReminder(task);
        scheduleQuotaNudges(task);
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

  markMissed(id, options) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.completed) return;
    // A meal-plan task is recurring in every way a user would recognize —
    // writeMealSlotTasks writes a fresh row per day of its rolling window
    // regardless of what happened to this one — but it never carries a
    // recurrenceType, since its schedule comes from that generator rather
    // than the recurrence engine. isMissableMealPlanTask is its equivalent
    // of "eligible, and its day has come" (it has no schedule to roll
    // forward on, so unlike a recurring task it just isn't missable yet).
    if (task.recurrenceType === 'none' && !isMissableMealPlanTask(task)) return;
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
    get().completeTask(id, { missed: true, missChain: options?.wholeChain });
  },

  completeTask(id, options) {
    const missed = options?.missed ?? false;
    const neutral = options?.neutral ?? false;
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
    // There is no tap that finishes "don't smoke", so a negative habit has no
    // completion to run — see Task.polarity. Refused here rather than at each
    // caller because this is the funnel every completion path in the app pours
    // into: the bulk bar, a stack cascade, the focus session's Done, a widget
    // tap, the missed sweep. Any one of them reaching a negative habit would
    // otherwise mark it done, spawn a successor and take it off the feed, which
    // is precisely the row that is supposed to sit there all day. `logSlip` is
    // the action this polarity has instead.
    if (isNegativeTask(task)) return;
    // Recurring tasks shown early in Later (deferred to, or due on, a future
    // day) can't be completed ahead of schedule — doing so would generate the
    // next occurrence off today instead of the task's real day. Non-recurring
    // tasks have no such next-occurrence math, so early completion is fine.
    // An 'hours' recurrence is the one exception: it has no calendar grid to
    // knock off schedule (its next occurrence is always measured from the
    // moment it's actually logged — see taskCompletion.ts's nextDeferUntil),
    // so a caller can confirm past its lock with logEarly.
    if (isRecurrenceNotYetDue(task) && !(task.recurrenceType === 'hours' && options?.logEarly)) return;
    // "Maybe" to a pick-one question is recorded but doesn't finish the task:
    // the guest hasn't decided, so the row stays to be answered again, and the
    // tally counts it as Maybe meanwhile. Here rather than in the prompt so
    // every path that answers (the bulk queue, the focus session) agrees.
    if (!missed && deliverableKindFor(task) === 'choice' && isTentativeAnswer(options?.deliverableValue)) {
      const snapshot = { ...task };
      const reasoning = options?.deliverableReasoning ? cleanDeliverableReasoning(options.deliverableReasoning) : null;
      get().updateTask(id, {
        deliverableValue: options!.deliverableValue!.trim(),
        ...(reasoning ? { deliverableWhy: reasoning.why, deliverableRevisitIf: reasoning.revisitIf } : {}),
      }, { skipPostponeCount: true });
      get().setLastAction({ label: `Answered ${options!.deliverableValue!.trim()}`, undo: () => get().updateTask(snapshot.id, snapshot), redo: redoRestoringRows([id]) });
      return;
    }

    // If a timer is still running — or a countdown was paused with time banked
    // on it — stop it first so the session's time is saved.
    if (task.timerStartedAt !== null || task.timerElapsedSeconds > 0) {
      get().stopTimer(id);
      task = get().tasks.find(t => t.id === id)!;
    }

    const now = new Date();
    // A widget, notification or Live Activity tap reaches this some time after
    // it happened, and its own moment is the completion's. Claimed here rather
    // than passed down because four paths finish one of those (the row's
    // animation, the question sheet, the direct call for a row not on Today,
    // and the answer-first queue), and this is the one they all pour into.
    if (options?.completedAt === undefined && !missed) {
      const tappedAt = useWidgetCompletionStore.getState().claimTappedAt(id);
      if (tappedAt) options = { ...options, completedAt: tappedAt };
    }
    // The morning check-in and a queued tap complete a task after the fact
    // and want the record to say so. Everything else this function writes
    // (the successor's createdAt/seenAt, the streak's getCurrentDayStart()
    // calls) stays keyed to the real moment; only the completed row's own
    // timestamps move, and the date a repeat-after-completion successor is
    // measured from (see buildCompletion).
    const completedAt = options?.completedAt ? new Date(options.completedAt) : now;
    const { dayResetTime } = useSettingsStore.getState();

    // Every row this completion produces, computed before any of them is
    // written. The rules behind them — the six chain/recurrence flags, the
    // streak, the supply decrement, the series rollover — live in
    // utils/taskCompletion.ts so the MCP server can complete a task in Node
    // without reaching this store. See that file's header for why a second
    // copy was never an option.
    const built = buildCompletion(task, options, {
      ...completionSettings(),
      now,
      allTasks: get().tasks,
      subtasks: get().subtasksOf(task.id),
    });
    // The three guards above already refused everything buildCompletion
    // refuses, so this is unreachable; it is here because the two run the same
    // rule and only one of them may be the authority on it.
    if (!built) return;
    const { completed, nextTask, nextSubtasks, followUpTask, followUpSubtasks, rolledOver } = built;

    if (task.pinned) pendingUnpinIds.push(id);

    // Doing the thing after it cost you takes that cost back off the block.
    // Read off the pre-completion row rather than `completed`, because the
    // whole question is whether *this* row was charged — and computed before
    // the write so the stamp rides along on it rather than needing a second
    // update. See penaltyCreditFor for the four things it refuses.
    const creditedAt = creditPenaltyShield(task, now);
    if (creditedAt !== null) completed.penaltyCreditedAt = creditedAt;

    dbUpdateTask(completed);
    // Coins: a completion earns, a miss costs (src/utils/rewards.ts). Both are
    // no-ops while rewards are off. A neutral completion is the app closing a
    // run on its own, which nobody did, so it moves nothing either way. The
    // streak read is the one this completion just wrote, so the occurrence
    // that reaches a bonus step is the first to be paid it.
    if (!neutral && taskEarnsCoins(task)) {
      const rewards = useRewardStore.getState();
      const label = displayTitleFor(task);
      if (missed) rewards.recordMiss(id, coinsForLoss(task), label, completedAt.toISOString());
      else rewards.recordEarn(id, coinsForCompletion(task, completed.streakCount), label, completedAt.toISOString());
    }
    // A completed row has nothing left to be late for — its deadline event,
    // if it had one, is deleted rather than left dangling on the calendar.
    reconcileDeadlineEvent(completed);
    // Opt-in and one-shot, unlike the reconcile above — only fired when the
    // task actually asked for it.
    if (task.logCompletionToCalendar) logCompletionEvent(completed, completedAt);
    // Opt-in like the two above, but deliberately *not* one-shot: this writes
    // into the app's own record rather than somebody else's database, and
    // uncompleteTask takes it back (see Task.medicationName). Nothing is asked
    // at the tick — the dose is what the task already says it is, and asking
    // again would be the "same fact twice" the medication log exists not to be.
    //
    // A missed sweep completes the row without anybody having taken anything,
    // so it records no dose: `missed` is exactly the case where the task closed
    // because the day ended rather than because it was done.
    //
    // Read through medicationFor rather than off the task, so a chain step
    // carrying its own medication records that one — "morning pills / evening
    // pills" would otherwise log the morning dose again at night.
    const completedDose = options?.missed ? null : medicationFor(task);
    if (completedDose) {
      useMedicationStore.getState().addLog({
        ...completedDose,
        taskId: id,
        at: completedAt,
      });
    }

    cancelTaskReminder(id);
    // A target's own nudges too, which cancelTaskReminder doesn't reach: met
    // for the day, it went on saying "one is due now" until evening.
    if (task.quotaReminders) cancelQuotaNudges(id);

    if (nextTask) {
      dbInsertTask(nextTask);
      scheduleTaskReminder(nextTask);
      scheduleQuotaNudges(nextTask);
      reconcileDeadlineEvent(nextTask);
    }
    nextSubtasks.forEach(sub => {
      dbInsertTask(sub);
      scheduleTaskReminder(sub);
    });
    if (followUpTask) dbInsertTask(followUpTask);
    followUpSubtasks.forEach(sub => dbInsertTask(sub));
    rolledOver.forEach(row => {
      dbInsertTask(row);
      scheduleTaskReminder(row);
    });

    set(s => ({
      tasks: [
        ...s.tasks.map(t => (t.id === id ? completed : t)),
        ...(nextTask ? [nextTask] : []),
        ...nextSubtasks,
        ...rolledOver,
        ...(followUpTask ? [followUpTask] : []),
        ...followUpSubtasks,
      ],
      // See the option's own doc comment: a row that already animated its own
      // transition to the successor's look has nothing left for the hold to
      // protect, and masking it back to its pre-transition content for the
      // rest of the window would undo that crossfade the moment it lands.
      completionHoldIds: options?.chainStepInPlace ? s.completionHoldIds : [...s.completionHoldIds, id],
      // A daily target that completes mid-hold hands over to the completion
      // hold, which masks it as incomplete for its own window. Leaving it in
      // both would keep the finished row on Today past that.
      quotaHoldIds: s.quotaHoldIds.filter(x => x !== id),
    }));

    // Same shape as the calendar log above: opt-in, one-shot, fire and
    // forget. See logTaskHealthValue's own comment for why there is no
    // write-back id to store and no undo on uncomplete. Placed after the
    // set() above (moved there deliberately) rather than beside the calendar
    // log it mirrors: a water write reads back through
    // syncWaterQuotaTasks (useFoodLogStore's addEntry/reviseEntry calls it
    // synchronously), and that reads get().tasks — which has to already show
    // this task as completed, or the sync would find the pre-completion row
    // still incomplete and try to complete it a second time. skipHealthLog is
    // for that same sync: a completion it already drove from the food log's
    // own total needs no second write of the amount that got it there.
    if (task.logHealthMetric && !options?.skipHealthLog) void logTaskHealthValue(completed);

    // Opt-in convenience only (autoCompleteProjectsOnDone, default off) —
    // finishing a project never happens automatically otherwise; the user
    // decides when a 100%-complete project is actually called done. It rides on
    // the completion's own undo instead of setting its own entry: it wasn't a
    // separate action the user took, so undoing the tick has to take it back.
    // Never on a miss: the setting finishes a project whose work is *finished*,
    // and projectProgress agrees (a group of nothing but missed rows isn't
    // done). Calling a project done because its last task went undone would be
    // the opposite of what the toggle promises.
    //
    // **Completes the project, never archives it.** The setting used to archive,
    // which put it at odds with every affordance a person taps for the same
    // moment: the detail screen's offer banner, the green check on the Projects
    // row and the editor's Mark complete row all set `completed`. With the
    // setting on, a project that finished never reached the Completed list that
    // exists for exactly this, because the automatic path filed it somewhere
    // else. Archiving is still available afterwards, and is still a separate
    // decision (see Project.completed).
    let autoCompletedProjectId: string | null = null;
    if (!missed && task.projectId && useSettingsStore.getState().autoCompleteProjectsOnDone) {
      const progress = projectProgress(task.projectId, get().tasks);
      const project = useProjectStore.getState().getProjectById(task.projectId);
      // Never an ongoing one (Project.ongoing): a running list has no finish
      // line, and every other "you're done" path already refuses it.
      if (progress.total > 0 && progress.done === progress.total && project && !project.completed && !project.archived && !project.ongoing) {
        useProjectStore.getState().applyProjectCompleted(task.projectId, true);
        autoCompletedProjectId = task.projectId;
      }
    }

    // Ticking a "Make X" task off marks its meal cooked, and bumps the recipe's
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
    // A mealLogNudge task's own completion is the other moment this offer can
    // come from — see offerMealLog below. Kept apart from cookedEntryId,
    // which also drives the cook-pairing and leftover-finish logic right
    // below: ticking "Log breakfast" three days late must not re-ask "was
    // that the last of the leftover?" on a meal already settled one way or
    // the other.
    const logNudgeEntryId = generatedSourceOf(task, 'mealLogNudge');
    const undoMealCooked = !missed && cookedEntryId
      ? useMealPlanStore.getState().setCookedPaired(cookedEntryId, true)
      : null;

    // A leftover-backed meal's entry (`MealPlanEntry.leftoverId`) is the one
    // case the pairing above doesn't close out: eating a tub of chilli is
    // what empties the container, and the app has no way to know that on its
    // own (Leftover.finishedAt is deliberately never implied by planning or
    // cooking a meal against it — a pot of soup feeds two dinners). So the
    // moment this tick finishes that meal, point a session-only id at the
    // leftover — FinishLeftoverPrompt (mounted in AppNavigator, same
    // reasoning as the Use-up prompts below) asks whether that was the last
    // of it. Gated on the leftover still being live so a container already
    // closed out isn't asked about twice. Never on a miss, same as the cook
    // pairing above.
    if (!missed && cookedEntryId) {
      const cookedEntryLeftoverId = dbGetMealPlanEntry(cookedEntryId)?.leftoverId;
      const cookedLeftover = cookedEntryLeftoverId
        ? useLeftoverStore.getState().leftovers.find(l => l.id === cookedEntryLeftoverId)
        : null;
      // Skipped when UseUpResolveSheet is already open (or about to open, see
      // below) on this same container: its own Finished it/Threw it out rows
      // already answer "was that the last of it?", so also popping this
      // Alert stacks a native alert on top of that sheet — which is exactly
      // what happens when the use-up task and the meal task for one leftover
      // both get ticked within moments of each other.
      if (
        cookedLeftover &&
        isLiveLeftover(cookedLeftover) &&
        useLeftoverStore.getState().pendingUseUpLeftoverId !== cookedLeftover.id
      ) {
        useLeftoverStore.getState().setPendingFinishLeftover(cookedLeftover.id);
      }
    }

    // ...and the same tick is the cheapest logging moment the app will ever
    // have: the step that finished a meal-slot chain is literally "Eat", and
    // the entry behind it already names the dish and, for a recipe-backed
    // one, the scale it was cooked at and the either/or answers that went
    // into it. A mealLogNudge task's own completion is the other way in —
    // see offerMealLog.
    //
    // An offer, never a write — see mealLog.ts. A plan can diverge from
    // reality (the dinner was cooked, then everyone went out), which is the
    // same reason mealSlotDrift withholds the chain once it is under way.
    // Never on a miss, matching the cook pairing above: a missed deadline did
    // not feed anybody.
    if (!missed) {
      const loggableEntryId = cookedEntryId ?? logNudgeEntryId;
      const loggable = loggableEntryId ? dbGetMealPlanEntry(loggableEntryId) : null;
      if (loggable) {
        // A "Log dinner" nudge ticked is a request to log it, so a recipe with
        // no figures goes on to the search sheet rather than completing with
        // nothing opened (see PendingMealLog.asked). The Eat step is the app
        // volunteering, and stays quiet for one.
        offerMealLog(loggable, !cookedEntryId);
      } else if (task.logMealSlot) {
        // An arbitrary task ("Log breakfast", "Pack lunch") opted into the
        // same offer, but names no recipe and no meal-plan entry — so it
        // always gets the manual search sheet, never the auto-computed
        // prompt offerMealLog uses for a recipe-backed meal above.
        useFoodLogStore.getState().setPendingManualMealLog({
          label: displayTitleFor(task),
          slot: task.logMealSlot,
          // The day this task was scheduled for, same call offerMealLog makes
          // from a meal plan entry's own date — a task with no due date (an
          // undated "Pack lunch") has no day to be planned for, so it falls
          // back to today rather than a grace-window-unsafe `new Date()`.
          dayKey: task.dueDate ? dayKeyOf(new Date(task.dueDate)) : dayKeyOf(getCurrentDayStart()),
          mealPlanEntryId: null,
        });
      }
    }

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
      if (leftoverUseUpId) {
        // The sheet this is about to open covers the same question
        // FinishLeftoverPrompt's Alert asks, in more depth (it also offers
        // freezing/splitting) — so a pending Alert for this same leftover is
        // superseded, not stacked. See the pendingUseUpLeftoverId check above
        // for the mirror case.
        if (useLeftoverStore.getState().pendingFinishLeftoverId === leftoverUseUpId) {
          useLeftoverStore.getState().setPendingFinishLeftover(null);
        }
        useLeftoverStore.getState().setPendingUseUpLeftover(leftoverUseUpId);
      }
    }

    // Ticking "Order more filters" off is what puts the units back — the one
    // place a supply ever goes up by itself.
    //
    // **This is the second reader of a deliverable's answer**, after a date
    // step placing the step behind it (see src/utils/deliverables.ts, which
    // says there is one). It is deliberately the same shape rather than the
    // start of a general write-anywhere mechanism: one kind, one field, in this
    // same function, reusing an answer the task was recording anyway. The
    // reorder task is generated, so its `deliverableKind: 'number'` is set by
    // the generator rather than by a user who could point it anywhere.
    //
    // **Completing it without an answer is not a no-op.** Left alone the supply
    // would still be under its threshold, so the very next sweep would write an
    // identical row and the tick would achieve nothing — the unrefusable-offer
    // trap `projectsReviewedToday` exists to close. So an unanswered tick
    // stamps the decline instead: a tick means "I've dealt with this" and
    // nothing more, exactly the reading `pantryCheckTasks` gives one, and the
    // stamp lapses by itself the moment a real restock raises the count.
    // What the restock below overwrote on its source, for this completion's
    // undo: unticking the reorder reopened it but left the supply topped up,
    // so completing it again added the same order a second time.
    let restockBefore: { id: string; supplyCount: number | null; supplyDeclinedAtCount: number | null } | null = null;
    if (!missed) {
      const restockTaskId = supplyReorderSourceId(task);
      if (restockTaskId) {
        const source = get().tasks.find(t => t.id === restockTaskId);
        if (source && source.supplyCount !== null) {
          restockBefore = {
            id: restockTaskId,
            supplyCount: source.supplyCount,
            supplyDeclinedAtCount: source.supplyDeclinedAtCount,
          };
          const answered = completed.deliverableValue;
          const bought = answered === null ? null : Number(answered);
          const restocked = restockedSupplyCount(source.supplyCount, bought);
          get().updateTask(
            restockTaskId,
            restocked !== null && restocked > source.supplyCount
              ? { supplyCount: restocked }
              : { supplyDeclinedAtCount: source.supplyCount },
            // The reorder task's date is the app's, not a schedule the user
            // picked, and this write moves no date at all — same reasoning
            // reconcileGeneratedTask passes it for a source-owned field.
            { skipPostponeCount: true },
          );
        }
      }
    }

    // A date answer that opted into being the trip's departure fills the
    // project's empty Leaving date. See departureFromAnswer. Remembered for
    // this completion's undo, which empties it again.
    let departureSet: { projectId: string; awayStart: string } | null = null;
    if (!missed && task.deliverableSetsAway && task.projectId && deliverableKindFor(task) === 'date') {
      const project = useProjectStore.getState().projects.find(p => p.id === task.projectId);
      const awayStart = project ? departureFromAnswer(project, deliverableDate(completed.deliverableValue)) : null;
      if (project && awayStart) {
        useProjectStore.getState().updateProject(project.id, { awayStart });
        departureSet = { projectId: project.id, awayStart };
        // "Pick dates" is both ends: with the leaving day in, ask for the
        // coming-back day while the dates are in mind (TripDatePrompt).
        if (!project.awayEnd) set({ tripDatePrompt: { kind: 'return', projectId: project.id, at: Date.now() } });
      } else if (project) {
        // A trip that already has a Leaving date isn't moved by an answer on
        // its own; a different day is offered instead.
        const moveTo = departureMoveFromAnswer(project, deliverableDate(completed.deliverableValue));
        if (moveTo) set({ tripDatePrompt: { kind: 'moveLeaving', projectId: project.id, awayStart: moveTo, at: Date.now() } });
      }
    }

    syncGatedReminders(id, get().tasks);

    // The tasks this was the last thing holding back, if they have no day of
    // their own: ready now, but an undated task goes nowhere by itself, so
    // nothing on screen would say so. ReadyOfferBar offers them a day. Not for
    // a miss or an unattended completion, which nobody is watching.
    if (!missed && !neutral) {
      const freed = get().tasks.filter(t =>
        !t.completed && !t.archived && !t.parentId &&
        (blockerIdsOf(t).includes(id) || t.answerGate?.taskId === id) &&
        !isHeldBack(t) && !isInPausedProject(t) &&
        t.dueDate == null && t.deferUntil == null
      );
      if (freed.length > 0) set({ readyOffer: { taskIds: freed.map(t => t.id), at: Date.now() } });
    }

    // Spending the second-to-last filter is the moment the offer to order more
    // becomes true, and making it wait for the next foreground would mean
    // ticking the task off and being told nothing — the same "don't make that
    // wait for the next sweep" call `pullProjectTasks` makes about a project
    // going quiet.
    //
    // Narrowed to the two completions that can actually change a supply, so an
    // ordinary tick doesn't pay for a generator pass: this task held one (its
    // successor is now a unit lighter), or this task *was* a reorder task (the
    // block above either topped one up or stamped it). There is no loop in the
    // second case — a completed row is in neither `wantedSupplyReorders` nor
    // `liveGeneratedTasksOfKind`.
    if (task.supplyCount !== null || task.generatedKind === 'supplyReorder') {
      get().checkSupplyReorderTasks();
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

    // A recurrence that has just run out says so, instead of the task quietly
    // never coming back.
    //
    // `recurrenceCount` has always been a countdown — "occurrences remaining,
    // including this one" — and its ending was the one event in the app with no
    // telling at all: getNextDueDate returns null, no successor is written, and
    // a task the user had set to happen ten times simply wasn't there on the
    // eleventh. Whether that was the schedule finishing or something going
    // wrong was unanswerable from the outside.
    //
    // The undo bar is the right surface and not a consolation prize: it is
    // where the app's other "here is what that tap did" lines go, and it costs
    // the user nothing to ignore. `recurs` is what separates it from an
    // ordinary one-off, which also spawns nothing and always did.
    //
    // It only reaches that bar because the entry marks itself `destructive`,
    // which is the flag UndoBar filters on. That is the one exception to
    // "completes stay shake-only" and it is deliberate: an ordinary completion
    // is undone by un-ticking the row, so a bar after every tick would be
    // chrome, while a schedule quietly reaching its end leaves nothing on
    // screen to notice or reverse. Without the flag this message was written
    // but never shown — the bar it names was never raised for it.
    const finishedRecurrence = built.recurs && built.advancesBySchedule && !missed && nextTask === null;
    get().setLastAction({
      destructive: finishedRecurrence,
      label: missed
        ? 'Task marked missed'
        : finishedRecurrence
          ? 'Last one, this won\'t repeat again'
          : 'Task completed',
      redo: () => get().completeTask(id, options),
      undo: () => {
        if (autoCompletedProjectId) {
          useProjectStore.getState().applyProjectCompleted(autoCompletedProjectId, false);
        }
        // Before uncompleteTask, which would otherwise un-cook the meal on its
        // own and leave the recipe's counters bumped — this closure puts both
        // back together, and by then the entry is no longer cooked so
        // uncompleteTask's own sync finds nothing to do.
        undoMealCooked?.();
        get().uncompleteTask(id);
        if (restockBefore) {
          const { id: sourceId, ...supply } = restockBefore;
          get().updateTask(sourceId, supply, { skipPostponeCount: true });
        }
        // Only while the project still holds the date this completion wrote:
        // one moved by hand since then is the person's, not this answer's.
        if (departureSet) {
          const project = useProjectStore.getState().projects.find(p => p.id === departureSet!.projectId);
          if (project?.awayStart === departureSet.awayStart) {
            useProjectStore.getState().updateProject(project.id, { awayStart: null });
          }
        }
      },
    });
  },

  uncompleteTask(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || !task.completed) return;
    const original = task;
    const updated = reopenedTask(task);
    uncreditPenaltyShield(task, new Date());
    // Whatever this completion or miss did to the coin balance goes with it.
    // Unlike the penalty credit above, nothing here can be bought back by a
    // round trip: the entry removed is exactly the one the completion wrote.
    useRewardStore.getState().takeBackTask(id);
    if (task.completionCalendarEventId) void deleteCompletionEvent(completionEventLink(task));
    // The dose this completion recorded goes with it. Unlike the Apple Health
    // write, which is one-shot because a sample is a historical record in
    // somebody else's database, this is the app's own record of what went into
    // a person — and a task ticked by mistake means the dose was not taken.
    // Leaving it behind would put a phantom dose in the one log whose whole
    // job is to be accurate. See Task.medicationName.
    //
    // For a daily target only the last dose goes, the one this completion
    // logged: the earlier ones were logged unit by unit and stay, as the
    // progress count (target - 1, above) says they should. Removing every
    // log for the task wiped the whole day's doses on one uncheck.
    if (medicationFor(task)) {
      const medication = useMedicationStore.getState();
      if (isQuotaTask(task) && !isMissed(task)) medication.removeLatestLogForTask(id);
      else medication.removeLogsForTask(id);
    }
    dbUpdateTask(updated);
    // Reopened, so a deadline it still carries is live again.
    reconcileDeadlineEvent(updated);
    // The completion timer this task's own completion may have scheduled no
    // longer means anything once that completion is undone.
    cancelCompletionTimer(id);

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
    // The mirror of logNudgeEntryId in completeTask — kept apart from
    // uncookedEntryId for the same reason it's kept apart from cookedEntryId
    // there: un-ticking "Log breakfast" must not un-cook a meal that was
    // never this task's to mark either way.
    const logNudgeUncompleteEntryId = generatedSourceOf(task, 'mealLogNudge');

    // Mirrors the retraction just above: un-ticking the step that finished a
    // leftover-backed meal takes back whatever finish-the-container ask it
    // just triggered. Unconditional on the entry actually carrying a
    // leftoverId — clearing a flag that wasn't this task's to begin with is
    // harmless, same reasoning the Use-up clears below rely on.
    if (uncookedEntryId && dbGetMealPlanEntry(uncookedEntryId)?.leftoverId) {
      useLeftoverStore.getState().setPendingFinishLeftover(null);
    }
    // Taking the tick back takes the offer back with it: the meal did not
    // happen after all, so there is nothing to be asked about. Covers both
    // shapes offerMealLog can have raised, and both the meal-slot and the
    // log-nudge tick that can each have raised them.
    const uncookedOfferEntryId = uncookedEntryId ?? logNudgeUncompleteEntryId;
    if (uncookedOfferEntryId && useFoodLogStore.getState().pendingMealLog?.mealPlanEntryId === uncookedOfferEntryId) {
      useFoodLogStore.getState().setPendingMealLog(null);
    }
    if (
      uncookedOfferEntryId &&
      useFoodLogStore.getState().pendingManualMealLog?.mealPlanEntryId === uncookedOfferEntryId
    ) {
      useFoodLogStore.getState().setPendingManualMealLog(null);
    }

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
      redo: () => get().uncompleteTask(id),
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

  setDeliverableValue(id, value, reasoning) {
    const task = get().tasks.find(t => t.id === id);
    // Guarded on the kind, not on `completed`: the answer belongs to a task
    // that asks a question, and a row can be un-completed and re-completed
    // without the answer needing to be retyped. Through the resolver, since
    // the question may be the chain step's rather than the task's — a
    // completed row's chainIndex still points at the step that asked.
    if (!task || deliverableKindFor(task) === null) return;
    const previous = task.deliverableValue;
    const previousReasoning = reasoningOf(task);
    // No answer, no reasoning: there is nothing left for it to be about.
    const nextReasoning = value === null
      ? { why: null, revisitIf: null }
      : reasoning ? cleanDeliverableReasoning(reasoning) : previousReasoning;
    if (previous === value
      && nextReasoning.why === previousReasoning.why
      && nextReasoning.revisitIf === previousReasoning.revisitIf) return;
    const updated = { ...task, deliverableValue: value, deliverableWhy: nextReasoning.why, deliverableRevisitIf: nextReasoning.revisitIf };
    dbUpdateTask(updated);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? updated : t)) }));
    syncGatedReminders(id, get().tasks);
    get().setLastAction({
      label: value === null ? 'Answer cleared' : 'Answer saved',
      undo: () => get().setDeliverableValue(id, previous, previousReasoning),
      redo: () => get().setDeliverableValue(id, value, nextReasoning),
    });
    // An answered "Pick dates" edited later still speaks for the trip, the
    // same way completing it did: offered as a move, never written unasked.
    if (task.completed && task.deliverableSetsAway && task.projectId && deliverableKindFor(task) === 'date') {
      const project = useProjectStore.getState().projects.find(p => p.id === task.projectId);
      const moveTo = project ? departureMoveFromAnswer(project, deliverableDate(value)) : null;
      if (project && moveTo) set({ tripDatePrompt: { kind: 'moveLeaving', projectId: project.id, awayStart: moveTo, at: Date.now() } });
    }
  },

  logSlip(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || !isNegativeTask(task) || task.archived) return;
    const dayStart = getCurrentDayStart();
    // A slip inside the day's allowance is recorded and nothing else: no block,
    // no coins, and slipPatch leaves the streak alone.
    const free = nextSlipIsFree(task, dayStart);
    const updated = { ...task, ...slipPatch(task, dayStart) };
    dbUpdateTask(updated);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? updated : t)) }));
    if (free) {
      get().setLastAction({
        label: 'Logged',
        undo: () => get().undoSlip(id),
        redo: () => get().logSlip(id),
      });
      return;
    }
    // The tap is the failure, so the cost lands with it rather than waiting for
    // a sweep to notice. Deliberately not undone by `undoSlip` below — see
    // slipPenaltyUntil for why taking the block back would be a way out of
    // every other block too.
    const slipUntil = slipPenaltyUntil(updated, new Date());
    if (slipUntil) chargePenaltyShield(slipUntil, displayTitleFor(updated));
    // A slip costs coins too, when rewards are on. Unlike the block, this one
    // *is* refunded by undoSlip: the refund removes this slip's own entry, so
    // a log-and-undo round trip nets zero rather than buying anything back.
    useRewardStore.getState().recordSlip(id, coinsForLoss(updated), displayTitleFor(updated));
    // A tap here costs a run that may be weeks long, so the undo is offered
    // rather than buried — the same affordance a logged quota unit gets, for a
    // mis-tap that is considerably more expensive.
    get().setLastAction({
      label: task.streakCount > 0 && updated.streakCount === 0 ? `Streak reset (was ${task.streakCount})` : 'Logged',
      undo: () => get().undoSlip(id),
      redo: () => get().logSlip(id),
    });
  },

  undoSlip(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || !isNegativeTask(task)) return;
    const dayStart = getCurrentDayStart();
    const patch = undoSlipPatch(task, dayStart);
    if (!patch) return;
    // A free slip wrote no coin entry, so there is nothing of its own to take
    // back, and the latest loss entry belongs to some other slip.
    const free = lastSlipWasFree(task, dayStart);
    const updated = { ...task, ...patch };
    dbUpdateTask(updated);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? updated : t)) }));
    if (!free) useRewardStore.getState().takeBackSlip(id);
  },

  sweepTaskPenalties() {
    const settings = useSettingsStore.getState();
    if (!settings.penaltyShieldEnabled) return;

    const now = new Date();
    const charged: Task[] = [];
    let until = settings.penaltyShieldUntil;
    // Tracked alongside the end rather than taken from the last task charged:
    // with several failing at once, the block belongs to whichever one pushed
    // its end furthest out, and that is what the shield screen should name.
    let reason = settings.penaltyShieldReason;

    for (const task of get().tasks) {
      const charge = penaltyChargeFor(task, now, settings.dayResetTime, {
        // The two ways the app itself was the reason a task didn't get done.
        // Charging for either would be punishing somebody for the app's own
        // gate — see penaltyChargeFor, where this is a required argument
        // rather than a default precisely so it has to be answered here.
        excused: isHeldBack(task) || isWithheld(task),
      });
      if (!charge) continue;
      charged.push({ ...task, penaltyFiredAt: charge.firedAt });
      if (!charge.until) continue;
      const next = extendShieldUntil(until, charge.until);
      if (next !== until) reason = displayTitleFor(task);
      until = next;
    }

    if (charged.length === 0) return;
    dbTransaction(() => {
      for (const task of charged) dbUpdateTask(task);
    });
    const byId = new Map(charged.map(t => [t.id, t]));
    set(s => ({ tasks: s.tasks.map(t => byId.get(t.id) ?? t) }));
    // One write for however many charges landed, so the shield reconciles once
    // rather than once per failed task.
    if (until !== settings.penaltyShieldUntil) settings.setPenaltyShieldUntil(until, reason);
  },

  rolloverNegativeStreaks() {
    const todayStart = getCurrentDayStart();
    const patched = get().tasks.flatMap(t => {
      if (!isNegativeTask(t) || t.archived) return [];
      // Vacation protects the run rather than growing it, which is the call
      // every other streak here makes. Read through isWithheld so a category
      // paused for vacation, or a paused project, covers its habits too,
      // exactly as it does for the tasks the quota rollover skips.
      const patch = cleanDayPatch(t, todayStart, { paused: isWithheld(t) });
      return patch ? [{ ...t, ...patch }] : [];
    });
    if (patched.length === 0) return;
    dbTransaction(() => patched.forEach(dbUpdateTask));
    const byId = new Map(patched.map(t => [t.id, t]));
    set(s => ({ tasks: s.tasks.map(t => byId.get(t.id) ?? t) }));
  },

  logQuotaUnit(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.completed || !isQuotaTask(task)) return;
    // The unit that reaches the target isn't a count bump, it's a completion —
    // hand off so recurrence, streaks, reminders and the Logbook all run
    // exactly as they do for any other task.
    //
    // Unless the task is one of the two kinds that ride the day out instead.
    // allowOvershoot says so outright ("a 13th glass against a target of 12"),
    // and this guard was missing: isQuotaOnPace deliberately keeps such a task
    // on Today past its target so the extra can be logged, and the very next
    // tap completed it — the feature's whole point, undone one line from where
    // it was declared. An interval quota is the second: its count is span ÷
    // interval rather than a goal, so "reaching" it is the clock running out,
    // which the run-ended sweep owns and a tap does not.
    if (!quotaRidesOutTheDay(task) && task.progressCount + 1 >= task.targetCount!) {
      get().completeTask(id);
      return;
    }
    const updated = { ...task, progressCount: task.progressCount + 1 };
    dbUpdateTask(updated);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? updated : t)) }));
    // Same reasoning as the dose below: a daily target is several units, not
    // one completion, so a task logging to Health logs once per unit here —
    // otherwise a 13-cup water quota would sit at zero in the food log until
    // the 13th glass. Only this branch records: the unit that reaches the
    // target hands off to completeTask above, which logs it there, and
    // logging here too would count the last unit of every day twice.
    if (task.logHealthMetric) void logTaskHealthValue(updated);
    const unitDose = medicationFor(task);
    if (unitDose) {
      useMedicationStore.getState().addLog({ ...unitDose, taskId: id });
    }
    get().setLastAction({
      label: 'Logged',
      undo: () => get().unlogQuotaUnit(id),
      redo: () => get().logQuotaUnit(id),
    });
    // See schedulePaceUnpin above — a pinned target that this unit just
    // caught up to pace unpins itself after a grace window, rather than
    // sitting pinned at the top of Today until the next unit falls due.
    if (updated.pinned && isQuotaOnPace(updated)) {
      schedulePaceUnpin(id);
    }
  },

  /**
   * The rotation counterpart of `logQuotaUnit`: same counting, but the caller
   * says *which* member, and the ledger records it.
   *
   * Two things differ from the quota path and both are the feature rather than
   * an inconsistency. It writes the ledger and *then* hands off to
   * `completeTask`, where the quota path completes instead of bumping — a
   * rotation's last pick has to land in the ledger before the week closes, or
   * the closed row's record is missing the pick that closed it. And a repeat
   * (a member already down this period) logs without moving `progressCount`,
   * because the week is about coverage; listening to Spanish twice is a real
   * thing to do and refusing to record it would be the app arguing with you,
   * but it is not one of the five.
   */
  recordRotationPick(id, itemId) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.completed || !isRotationTask(task) || !isQuotaTask(task)) return false;
    const { weekStartsOn } = useSettingsStore.getState();
    const dayStart = getCurrentDayStart();
    const covers = rotationCoversNew(task, itemId, dayStart, weekStartsOn);
    const patch = rotationPick(task, itemId, new Date(), dayStart, weekStartsOn);
    if (!patch) return false;
    // A repeat logs without moving the count: the week is about coverage, and
    // a second Spanish is a real listen but not a sixth language.
    const progressCount = covers ? task.progressCount + 1 : task.progressCount;
    const updated = { ...task, ...patch, progressCount };
    dbUpdateTask(updated);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? updated : t)) }));
    return covers && progressCount >= task.targetCount!;
  },

  logRotationUnit(id, itemId) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.completed || !isRotationTask(task) || !isQuotaTask(task)) return;
    const covered = get().recordRotationPick(id, itemId);
    const updated = get().tasks.find(t => t.id === id);
    if (!updated) return;
    if (covered) {
      // The set is covered, so the period is done and the recurrence spawns
      // next week's. completeTask reads the row back out of the store, which
      // recordRotationPick has already updated, so it closes over the full
      // ledger rather than over one pick short of it.
      get().completeTask(id);
      return;
    }
    // Only on the branch that doesn't complete, for the reason logQuotaUnit
    // gives: completeTask logs these itself, and doing both counts one pick
    // twice.
    if (task.logHealthMetric) void logTaskHealthValue(updated);
    const unitDose = medicationFor(task);
    if (unitDose) {
      useMedicationStore.getState().addLog({ ...unitDose, taskId: id });
    }
    get().setLastAction({
      label: 'Logged',
      undo: () => get().unlogRotationUnit(id),
      redo: () => get().logRotationUnit(id, itemId),
    });
    if (updated.pinned && isQuotaOnPace(updated)) {
      schedulePaceUnpin(id);
    }
  },

  /**
   * Takes the most recent pick back — what a long-press on the meter does.
   *
   * `progressCount` only falls when the pick being removed was the one
   * covering that member, which is the mirror of the repeat rule above: undoing
   * a second Spanish leaves Spanish covered, because the first one still
   * counts.
   */
  planRotationItem(id, itemId) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.completed || !isRotationTask(task)) return;
    const updated = { ...task, rotationPlan: rotationPlanFor(task, itemId, getCurrentDayStart()) };
    dbUpdateTask(updated);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? updated : t)) }));
  },

  unlogRotationUnit(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || !isRotationTask(task)) return;
    const { weekStartsOn } = useSettingsStore.getState();
    const dayStart = getCurrentDayStart();
    const patch = rotationUnpick(task, dayStart, weekStartsOn);
    if (!patch) return;
    const uncovers = rotationUnpickUncovers(task, dayStart, weekStartsOn);
    const updated = {
      ...task,
      ...patch,
      progressCount: uncovers ? Math.max(0, task.progressCount - 1) : task.progressCount,
    };
    dbUpdateTask(updated);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? updated : t)) }));
  },

  unlogQuotaUnit(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || !isQuotaTask(task) || task.progressCount === 0) return;
    const updated = { ...task, progressCount: task.progressCount - 1 };
    dbUpdateTask(updated);
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? updated : t)) }));
    // The unit being taken back is the dose that unit recorded, and only that
    // one — the day's earlier doses were still taken.
    if (medicationFor(task)) useMedicationStore.getState().removeLatestLogForTask(id);
    // Same reasoning, for a logged nutrient: the tap this undoes had logged
    // one unit into the food log (logQuotaUnit's own logTaskHealthValue call).
    // For water, leaving that in place would have syncWaterQuotaTasks read the
    // unchanged total back and immediately bump progressCount up again on the
    // next food-log write, undoing this undo. Set after progressCount above, so
    // that sync (triggered synchronously from within this call) reads the count
    // this line just wrote rather than the one from before the tap was undone.
    if (task.logHealthMetric && task.logHealthAmount) {
      unlogTaskNutrientFromFoodLog(task.logHealthMetric, task.logHealthAmount, new Date());
    }
  },

  syncWaterQuotaTasks() {
    const dayResetTime = useSettingsStore.getState().dayResetTime;
    const todayStart = getCurrentDayStart();
    const todayKey = dayKeyOf(todayStart);
    const totalMl = waterTotalMl(dbGetFoodLogEntries(todayKey, todayKey));
    // What the followed target is judged against. The reading counts only for
    // the logical today: `today` outlives the day reset until the next refresh.
    const { nutritionTargets, waterExerciseBoost } = useSettingsStore.getState();
    const healthToday = useHealthStore.getState().today;
    const exerciseReadToday = healthToday?.dayKey === todayKey;
    const exerciseMinutes = exerciseReadToday ? healthToday?.exerciseMinutes ?? null : null;

    for (const task of get().tasks) {
      if (
        !isQuotaTask(task) ||
        task.completed ||
        task.archived ||
        task.logHealthMetric !== 'waterMl' ||
        !task.logHealthAmount ||
        task.logHealthAmount <= 0 ||
        task.quotaPeriod !== 'day' ||
        quotaRidesOutTheDay(task)
      ) {
        continue;
      }
      // Only the occurrence actually on today's board — a task deferred to a
      // later day still holds whatever progressCount its last real day left
      // it with, and today's water total has nothing to say about that.
      const effectiveDate = getEffectiveTaskDate(task, dayResetTime);
      if (!effectiveDate || +getTaskDayStart(new Date(effectiveDate), dayResetTime) !== +todayStart) {
        continue;
      }

      // A task following the food log's water target takes its count from it
      // first, so progress below is judged against today's target and not
      // yesterday's. Only an occurrence still open gets here (the guard above),
      // which is the point: a day already completed keeps the count it
      // finished against.
      const followed = followedWaterTargetCount(
        task, nutritionTargets.waterMl, exerciseMinutes, waterExerciseBoost, exerciseReadToday,
      );
      const current = followed !== null && followed !== task.targetCount
        ? { ...task, targetCount: followed }
        : task;
      if (current !== task) {
        dbUpdateTask(current);
        set(s => ({ tasks: s.tasks.map(t => (t.id === task.id ? current : t)) }));
      }

      const units = Math.min(current.targetCount!, Math.floor(totalMl / current.logHealthAmount!));
      if (units === current.progressCount) continue;

      if (units >= current.targetCount!) {
        // buildCompletion stamps progressCount to targetCount on its own —
        // see taskCompletion.ts — so there's nothing to write here first.
        // skipHealthLog: the amount that got the log to this total is
        // already there; completeTask's own logHealthMetric write would add
        // it a second time.
        get().completeTask(task.id, { skipHealthLog: true });
      } else {
        const updated = { ...current, progressCount: units };
        dbUpdateTask(updated);
        set(s => ({ tasks: s.tasks.map(t => (t.id === task.id ? updated : t)) }));
      }
    }

    reconcileWaterShortfall({
      todayKey, totalMl, exerciseReadToday, exerciseMinutes,
      tasks: get().tasks,
    });
  },

  syncSnackNudgeTasks() {
    reconcileSnackNudge(get().tasks);
  },

  checkBookEventTasks() {
    reconcileBookEvents(get().tasks);
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
    const { dayResetTime, weekStartsOn } = useSettingsStore.getState();
    const todayStart = getCurrentDayStart();
    // Which period a date belongs to, as that period's opening instant. Two
    // dates compare equal exactly when they share a period, which is the test
    // this sweep is really making — "has the stretch this row was counting
    // across finished" — rather than the day comparison it used to make.
    const periodStartOf = (date: Date, period: QuotaPeriod): number => {
      const dayStart = getTaskDayStart(date, dayResetTime);
      return +(period === 'week' ? quotaWeekStart(dayStart, weekStartsOn) : dayStart);
    };
    const stale = get().tasks.filter(t =>
      isQuotaTask(t) &&
      !t.completed &&
      !t.archived &&
      // A quota with no repeat has no next day to reset into — it's a one-off
      // ("read 8 chapters"), so it stays overdue like any other undone task
      // rather than being closed out and silently re-spawned as a habit.
      t.recurrenceType !== 'none' &&
      // Vacation-paused tasks are protected from streak loss by design.
      !isWithheld(t) &&
      // allowOvershoot tasks get their own sweep (sweepOvershootQuotas, below)
      // that goes through completeTask so an overshot count survives — this
      // manual close always writes progressCount as-is but forces
      // streakCount to 0, which is right for a shortfall but wrong for a
      // task that actually met or beat its target.
      //
      // An interval quota is excluded for a stronger version of the same
      // reason: it has no shortfall to record. Its target is span ÷ interval,
      // so falling "short" of it means nothing more than not having tapped
      // every nudge, and closing the day with streakCount: 0 for that would
      // break the streak on essentially every day the feature works. See
      // sweepFinishedQuotaRuns, which closes it at the end of its run instead.
      !quotaRidesOutTheDay(t) &&
      t.dueDate !== null &&
      // "Its own period is over", not "its own day is over" — a weekly target
      // has six days left to run on the morning after it was spawned, and the
      // day test would close it out short every single night. See
      // Task.quotaPeriod, and periodStartOf just below for the two readings.
      //
      // getEffectiveTaskDate rather than the raw dueDate: a quota task pushed
      // out with deferUntil is hidden until that later day (isTaskVisible),
      // so its stored dueDate reads as overdue every launch in between even
      // though the user moved it forward on purpose. Without this, the row
      // got closed as a shortfall (breaking its streak) and a fresh successor
      // spawned for today — reappearing on Today despite having just been
      // rescheduled later, and duplicating it once the deferred date itself
      // arrived and rolled over a second time.
      periodStartOf(new Date(getEffectiveTaskDate(t, dayResetTime)!), t.quotaPeriod) <
        periodStartOf(todayStart, t.quotaPeriod)
    );
    if (stale.length === 0) return;

    const closed: Task[] = [];
    const spawned: Task[] = [];
    const now = new Date().toISOString();
    for (const task of stale) {
      // Stamped at the end of the period it belonged to, not now — the partial
      // is a record of *that* day (or week), and the Logbook groups by
      // completedAt.
      const ownPeriodStart = periodStartOf(new Date(task.dueDate!), task.quotaPeriod);
      // addDays rather than a fixed 24h: the DST spring-forward day is 23
      // hours long, and a fixed stride landed the stamp at 00:59 the next
      // morning, which getLogicalDayKey filed under the wrong day.
      const ownDayEnd = new Date(+addDays(ownPeriodStart, task.quotaPeriod === 'week' ? 7 : 1) - 1);
      // A day the task's own category schedule doesn't cover (see #2201,
      // isCategoryScheduledDay) wasn't a work day, so it closes as a no-op
      // rather than a shortfall — neither advancing nor breaking the streak.
      // Day-period only: a weekly target can still be met on any of the
      // category's scheduled days within its week, so a single day-of-week
      // check doesn't say anything about whether the week itself was worked.
      // `nextStreak` reused for both fields the same way completeTask does,
      // so nextStreakRecord folds nothing when it's unchanged.
      const neutral = task.quotaPeriod !== 'week' && !isCategoryScheduledDay(task.category, new Date(ownPeriodStart));
      const nextStreak = neutral ? task.streakCount : 0;
      closed.push({
        ...task,
        completed: true,
        completedAt: ownDayEnd.toISOString(),
        // progressCount deliberately left as-is — that's the record.
        streakCount: nextStreak,
        streakDate: neutral ? task.streakDate : null,
        previousStreakCount: task.streakCount,
        previousStreakDate: task.streakDate,
        // A partial day closes the run out, so the run it ends is a candidate
        // for the personal best like any other ending.
        priorBestStreak: nextStreakRecord(task, nextStreak),
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
        // Same as completeTask's successor: the stamp is per-occurrence, and
        // carrying it would leave this row unable to be charged at all.
        penaltyFiredAt: null,
        penaltyCreditedAt: null,
        autoScheduledAt: null,
        createdAt: now,
        seenAt: now,
        dueDate: nextDue.toISOString(),
        deferUntil: null,
        // Same as completeTask's successor: pinned only when the task asked
        // for every occurrence to be.
        pinned: !!task.pinEachOccurrence,
        progressCount: 0,
        // Same as completeTask's successor: the count resets, the mute carries.
        postponeCount: 0,
        driftingSince: null,
        bountyPushes: null,
        // A neutral close (see nextStreak above) carries the live streak
        // forward exactly as it stood — a non-work day never happened, so
        // the successor picking it up must not read as day one either.
        streakCount: nextStreak,
        streakDate: neutral ? task.streakDate : null,
        previousStreakCount: 0,
        previousStreakDate: null,
        // Not 0, unlike everything else reset on this successor: the streak
        // starts again but the record is the task's history, and this row is
        // where the task continues.
        priorBestStreak: nextStreakRecord(task, nextStreak),
        timerStartedAt: null,
        previousOccurrenceId: task.id,
        seriesDefaults: null,
        // The rest of what buildCompletion resets on a successor, which this
        // row had been spreading forward from the day it replaces. Left as
        // they were, yesterday's reminder time was in the past and never fired
        // again, and a repeat count never ran down however many days fell short.
        ...reminderOnto(effective, nextDue),
        deadline: deadlineOnto({ ...effective, deadline: null }, nextDue),
        recurrenceCount: task.recurrenceCount !== null ? task.recurrenceCount - 1 : null,
        recurrenceAnchorDate: null,
        deliverableValue: null,
        deliverableWhy: null,
        deliverableRevisitIf: null,
        rotationLog: [],
        rotationPeriodStart: null,
        quotaStartedAt: null,
        calendarEventId: null,
        calendarEventExternalId: null,
        completionCalendarEventId: null,
        completionCalendarEventExternalId: null,
      });
    }

    // One WAL transaction for the whole rollover rather than one per row:
    // this runs at launch and on every background refresh, and a day's worth
    // of quota tasks is a row each. Scheduling the reminders stays outside it,
    // since that reaches the notification system rather than the database.
    dbTransaction(() => {
      closed.forEach(dbUpdateTask);
      spawned.forEach(dbInsertTask);
    });
    spawned.forEach(scheduleTaskReminder);
    // The day's nudges belong to the row that just closed; the new day's come
    // from its successor.
    closed.forEach(t => { if (t.quotaReminders) cancelQuotaNudges(t.id); });
    spawned.forEach(t => { scheduleQuotaNudges(t); });
    const closedById = new Map(closed.map(t => [t.id, t]));
    set(s => ({
      tasks: [...s.tasks.map(t => closedById.get(t.id) ?? t), ...spawned],
    }));
  },

  // Folded into one loop rather than split into a sibling function: both
  // halves are "does this live task's reminderTime need correcting", they
  // share the same completed/archived guard and the same batching/reschedule
  // tail, and a task could in principle need both checks run (though
  // reminderTracksVisibility wins when both apply — see below).
  reanchorWallClockReminders() {
    const updated: Task[] = [];
    const pass = beginVisibleAtPass();
    for (const task of get().tasks) {
      if (task.reminderTime === null || task.completed || task.archived) continue;

      // A visibility-tracking reminder's whole point is that getVisibleAt's
      // own answer moves on its own as time passes — a deferUntil date
      // arrives, a time-of-day segment threshold passes — unlike an offset
      // reminder, which only changes when dueDate itself moves (handled at
      // the write sites: completeTask, skipNextRecurrence, updateTask's
      // series fan-out). So this is the one periodic recompute it needs, and
      // it takes priority over the wall-clock check below: there's no
      // reading of "stay at this wall-clock time" for a reminder that isn't
      // fixed to a clock time to begin with.
      if (task.reminderTracksVisibility) {
        const next = getVisibleAt(task, pass);
        const nextIso = next.toISOString();
        if (nextIso === task.reminderTime) continue;
        updated.push({
          ...task,
          reminderTime: nextIso,
          reminderUtcOffsetMinutes: next.getTimezoneOffset(),
        });
        continue;
      }

      if (task.reminderTimeAnchor !== 'wallClock' || task.reminderUtcOffsetMinutes === null) continue;
      const reanchored = reanchorReminderToWallClock(task.reminderTime, task.reminderUtcOffsetMinutes);
      // The device hasn't actually moved zones since this was last captured —
      // nothing to write.
      if (reanchored === task.reminderTime) continue;
      updated.push({
        ...task,
        reminderTime: reanchored,
        // The offset in effect here *at the reminder*, not now — every other
        // write captures it that way, and it's what the next pass subtracts.
        // Stamping today's offset on a reminder across a DST change from today
        // made the next pass read it as another zone move and shift it an
        // hour, again on every launch.
        reminderUtcOffsetMinutes: new Date(reanchored).getTimezoneOffset(),
      });
    }
    if (updated.length === 0) return;

    // This is the app moving the row itself, not a user edit or a schedule
    // move — same low-level write updateTask's own side effects (series
    // fan-out, postpone bumps, seriesDefaults handling) aren't wanted for,
    // same as rolloverQuotas above. The notification has to be rescheduled
    // here explicitly: the launch call path chains into
    // rescheduleAllReminders right after this, but the foreground listener
    // doesn't, so this is the only place that would ever correct it there.
    dbTransaction(() => updated.forEach(dbUpdateTask));
    updated.forEach(scheduleTaskReminder);
    const updatedById = new Map(updated.map(t => [t.id, t]));
    set(s => ({
      tasks: s.tasks.map(t => updatedById.get(t.id) ?? t),
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
      // An interval quota closes at the end of its own run rather than at day
      // rollover, and does it whatever the count — sweepFinishedQuotaRuns
      // owns it even when it also carries allowOvershoot, or a run that ended
      // at 17:00 would sit unclosed until the small hours.
      t.quotaIntervalMinutes === null &&
      isQuotaTask(t) &&
      !t.completed &&
      !t.archived &&
      t.progressCount > 0 &&
      !isWithheld(t) &&
      t.dueDate !== null &&
      // Weekly targets are deliberately out of scope for the overshoot and
      // interval kinds (see Task.quotaPeriod), and this is the guard rather
      // than the rule: if the combination ever arrives from a template, an
      // import or a synced row, closing it on the day test would end its week
      // six days early. Left daily, it is merely closed on time.
      t.quotaPeriod === 'day' &&
      getTaskDayStart(new Date(t.dueDate), dayResetTime) < todayStart
    );
    // neutral on a day the task's own category schedule didn't cover — see
    // #2201, isCategoryScheduledDay, and rolloverQuotas' own note above.
    //
    // Stamped at the end of its own day, as rolloverQuotas stamps a partial:
    // the tally is a record of that day, and a repeat-after-completion
    // successor measured from the sweep's own moment skipped a day.
    stale.forEach(t => {
      const ownDayStart = getTaskDayStart(new Date(t.dueDate!), dayResetTime);
      get().completeTask(t.id, {
        neutral: !isCategoryScheduledDay(t.category, ownDayStart),
        completedAt: new Date(+addDays(ownDayStart, 1) - 1).toISOString(),
      });
    });
  },

  startQuotaRun(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.completed || task.archived || !isQuotaTask(task)) return;
    // Through updateTask rather than a direct write, so QUOTA_SPAN_FIELDS
    // re-derives targetCount against the span that just shrank, and the undo
    // entry below restores the count with the stamp it belonged to.
    const before = { quotaStartedAt: task.quotaStartedAt, targetCount: task.targetCount };
    get().updateTask(id, { quotaStartedAt: new Date().toISOString() });
    get().setLastAction({
      label: 'Started',
      undo: () => get().updateTask(id, before),
      redo: redoRestoringRows([id]),
    });
  },

  sweepFinishedQuotaRuns() {
    const { dayResetTime, activeHoursStart, activeHoursEnd } = useSettingsStore.getState();
    const todayStart = getCurrentDayStart();
    const now = new Date();
    const finished = get().tasks.filter(t => {
      if (t.quotaIntervalMinutes === null || !isQuotaTask(t)) return false;
      if (t.completed || t.archived) return false;
      // Same protection from streak loss vacation gives everywhere else, and
      // it matters more here: a paused task is one whose run was never
      // supposed to happen.
      if (isWithheld(t)) return false;
      if (t.dueDate === null) return false;
      const taskDay = getTaskDayStart(new Date(t.dueDate), dayResetTime);
      // A run from an earlier day is over by definition, whatever the clock
      // says now — the app may simply have been closed since. Today's run is
      // over once its own span has closed.
      if (taskDay < todayStart) return true;
      if (taskDay > todayStart) return false;
      return isQuotaRunOver(
        quotaRunSpan({
          windowStart: t.windowStart,
          windowEnd: t.windowEnd,
          quotaStartedAt: t.quotaStartedAt,
          activeHoursStart,
          activeHoursEnd,
          dayStart: todayStart,
        }),
        now,
      );
    });
    // Through completeTask, at whatever count was reached — including zero.
    //
    // Zero is the case sweepOvershootQuotas deliberately leaves alone, on the
    // reading that a tally nobody touched is a day the task was abandoned. An
    // interval quota inverts that: the nudges fired whether or not any was
    // tapped, so the run *did* happen, and leaving it incomplete would stack
    // an overdue row per day for the one routine most likely to go untapped.
    // A completion here is what it says — the run finished — and the count
    // beside it is the record of how much of it you took.
    //
    // neutral on a day the task's own category schedule didn't cover — see
    // #2201, isCategoryScheduledDay, and rolloverQuotas' own note above.
    finished.forEach(t => get().completeTask(t.id, {
      neutral: !isCategoryScheduledDay(t.category, getTaskDayStart(new Date(t.dueDate!), dayResetTime)),
    }));
  },

  deferTask(id, until) {
    const task = get().tasks.find(t => t.id === id);
    if (!task) return;
    const snapshot = { ...task };
    get().updateTask(id, { deferUntil: until.toISOString() });
    get().setLastAction({
      label: 'Task rescheduled',
      redo: () => get().deferTask(id, until),
      undo: () => get().updateTask(snapshot.id, snapshot),
    });
  },

  applyTitleRuleToExisting(rule) {
    const entries = titleRuleBacklog(get().tasks, rule);
    if (entries.length === 0) return 0;

    // Snapshotted before anything is written, so the whole catch-up undoes as
    // one action — the shape deloadTasks below uses, and for the same reason:
    // a fan-out of N separate undo entries is N shakes to put one decision
    // back. Only the six fields a rule can fill are captured; the undo is a
    // narrow patch, never a whole-task replay.
    const snapshots = entries.map(({ task }) => ({
      id: task.id,
      category: task.category,
      projectId: task.projectId,
      priority: task.priority,
      effort: task.effort,
      tags: task.tags,
      linkUrl: task.linkUrl,
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
        linkUrl: s.linkUrl,
      })),
      redo: redoRestoringRows(snapshots.map(s => s.id)),
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
      return {
        id: m.id, dueDate: t.dueDate, deferUntil: t.deferUntil,
        // Restored beside dueDate, as shiftAwayTasks does: a patch naming
        // dueDate without the anchor clears it (mergeTaskUpdate), which would
        // turn undoing a deload on a pulled-forward recurring task into a
        // rebase of its grid.
        recurrenceAnchorDate: t.recurrenceAnchorDate,
        postponeCount: t.postponeCount, bountyPushes: t.bountyPushes ?? null,
      };
    });

    // Deliberately counted, unlike every other engine-proposed move here:
    // "Lighten this day" is the most explicit *I am pushing today's work* action
    // in the app, and exempting it would leave the person who deloads six days
    // running sitting at a count of zero — exactly the person the prompt exists
    // for. The prompt still only ever appears in the date picker, so a task
    // moved in a batch is noted here and mentioned later, not accused now.
    dbTransaction(() => {
      applied.forEach(m => get().updateTask(m.id, m.updates, { markSeenOnBecomeVisible: true }));
    });

    get().setLastAction({
      label: `${applied.length} task${applied.length === 1 ? '' : 's'} moved`,
      redo: () => get().deloadTasks(moves),
      undo: () => snapshots.forEach(s =>
        get().updateTask(s.id, {
          dueDate: s.dueDate, deferUntil: s.deferUntil, recurrenceAnchorDate: s.recurrenceAnchorDate,
          postponeCount: s.postponeCount, bountyPushes: s.bountyPushes,
        })
      ),
    });
  },

  shiftAwayTasks(moves) {
    const byId = new Map(get().tasks.map(t => [t.id, t]));
    const applied = moves.filter(m => byId.has(m.id));
    if (applied.length === 0) return;

    // The anchor rides in the snapshot, unlike deloadTasks' three fields. A
    // shift can *pull* a recurring member forward, which writes
    // recurrenceAnchorDate, and an undo that restored only the two dates would
    // leave that behind — silently rotating the grid the rest of the
    // schedule steps from, the exact back-door rotation the "only ever set
    // once" rule in scheduleMoveUpdates exists to prevent.
    const snapshots = applied.map(m => {
      const t = byId.get(m.id)!;
      return {
        id: m.id,
        dueDate: t.dueDate,
        deferUntil: t.deferUntil,
        recurrenceAnchorDate: t.recurrenceAnchorDate,
        // A deadline written on the row moves with it too (awayShiftUpdates).
        deadline: t.deadline,
      };
    });

    // Never counted, deliberately, and this is the half deloadTasks gets the
    // other way round. "Lighten this day" is the most explicit *I am pushing
    // today's work* action in the app, so it counts; a trip moving because the
    // airline moved it is not the user postponing anything, and counting it
    // would feed the "you've pushed this five times" prompt (utils/postpone)
    // with pushes nobody made.
    dbTransaction(() => {
      applied.forEach(m => get().updateTask(m.id, m.updates, { skipPostponeCount: true, markSeenOnBecomeVisible: true }));
    });

    get().setLastAction({
      label: `${applied.length} task${applied.length === 1 ? '' : 's'} moved with the trip`,
      redo: () => get().shiftAwayTasks(moves),
      undo: () => snapshots.forEach(s =>
        get().updateTask(
          s.id,
          { dueDate: s.dueDate, deferUntil: s.deferUntil, recurrenceAnchorDate: s.recurrenceAnchorDate, deadline: s.deadline },
          { skipPostponeCount: true },
        )
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
      applied.forEach(m => get().updateTask(m.id, m.updates, { skipPostponeCount: true, markSeenOnBecomeVisible: true }));
    });

    // This is the direct, user-initiated action that resolves a project's
    // "quiet" state, including from the review task's own row — don't make
    // that wait for the next launch/foreground sweep to notice.
    get().checkProjectReviewTasks();

    get().setLastAction({
      label: `${applied.length} task${applied.length === 1 ? '' : 's'} pulled in`,
      redo: () => get().pullProjectTasks(moves),
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
    //
    // Through the registry rather than reading vacationMode directly: this was
    // the only generator of nineteen that answered this question, and one rule
    // with one exception is how the other eighteen came to have no answer.
    // mealPlanNudgeIgnoresVacation is checked ahead of it rather than folded
    // into the registry: some people plan meals *for* the trip, and this is
    // the one generator where "hide work from me" isn't what vacation mode
    // should mean for everybody.
    if (!settings.mealPlanNudgeIgnoresVacation && generatorPausedForVacation('mealPlanNudge', settings.vacationMode)) return;

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
    if (mealPlanNudgeSuppressed(due, plannedEntries, settings.mealPlanNudgeSlots)) return;

    // Filed like every other generator's tasks. Without this the one thing
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
        // own — see mealPlanNudge.ts. Planning the week is work for today.
        dueDate: due.dueDate.toISOString(),
        // The link opens the Meal Plan screen on this task's own day. It no
        // longer doubles as the marker saying who wrote the task — generatedKind
        // does that now, for this generator as for the other three.
        linkUrl: mealPlanNudgeLinkUrl(day.dayKey),
        category,
        groupId: group.id,
        ...generatedBy('mealPlanNudge', day.dayKey),
        // After the spread, which pauses the row on vacation like every kind
        // that stands down for it: with "Also during vacation" on, these rows
        // are written during a trip on purpose, so hiding them would undo it.
        vacationPause: !settings.mealPlanNudgeIgnoresVacation,
        // skipTitleRules for the reason generatedTaskSync passes it: "Plan
        // meals for Monday" is a title the app wrote, and this generator has
        // its own "File them under" setting (mealPlanNudgeTaskCategory). A
        // user rule matching one of its words would file it somewhere that
        // setting didn't say.
      }, derivedId(spawnSeed.generated(
        'mealPlanNudge',
        day.dayKey,
        generatedTaskCountOf(get().tasks, 'mealPlanNudge', day.dayKey)
        // skipCategoryDefault too, for the reason generatedTaskSync passes
        // it: a "File them under: None" here meant none, and without the flag
        // addTask filed the rows under the new-task default category instead.
      )), { skipTitleRules: true, skipCategoryDefault: true });
      // An unattended create like any other generator's, so it belongs in the
      // ledger; this path doesn't go through reconcileGeneratedTask, which is
      // where the others are recorded.
      useUnattendedStore.getState().recordGenerated('created', task);
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
    // Work the app invents, and vacation mode is the deliberate "hide work
    // from me" — see GeneratedKindSpec.pausedOnVacation. Skipped without
    // recording anything, so the trigger declined here fires for real the
    // first time the app is opened after vacation ends.
    if (generatorPausedForVacation('projectReview', settings.vacationMode)) return;
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

  checkBirthdayTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.birthdayTasks) return;

    const tasks = get().tasks;
    const people = usePersonStore.getState().people;
    // The clock is read here and passed down, so birthdayTasks.ts stays pure
    // and every rule in it is testable without standing up the settings store.
    // getCurrentDayStart rather than `new Date()`: this decides which day a task
    // lands on, and a bare clock reading is off by one for anybody whose day
    // starts after midnight.
    const today = getCurrentDayStart();
    const wanted = wantedBirthdayTasks(people, settings.birthdayLeadDays, today);

    // Clear first, create second, and never the reverse — the same ordering
    // checkProjectReviewTasks explains. The stale set here is wider than it
    // looks: a person deleted, archived, or with their birthday cleared or
    // corrected all leave a row naming a day that is nobody's birthday, and
    // none of those mutations knows the row is sitting there.
    const stale = staleBirthdayTasks(tasks, wanted);
    // dropGeneratedTask, not deleteGeneratedTaskQuietly: the latter routes
    // through deleteTask, which stamps the source's opt-out. Here that would
    // set birthdayTaskOptOut on somebody the user never touched, silencing
    // their birthday for good on the strength of the app's own tidying up.
    stale.forEach(task => {
      const source = parseBirthdaySource(task);
      dropGeneratedTask('birthday', source ? `${source.personId}#${source.year}` : null);
    });

    if (wanted.length === 0) return;

    // Ensured here as well as at startup because this generator ships ON:
    // nobody flips the switch that would otherwise create the category, so the
    // very first birthday task would land in the loose block above every
    // section. Same reasoning as projectReview's.
    ensureGeneratedTaskCategory('birthday');
    const category = useSettingsStore.getState().birthdayTaskCategory;

    wanted.forEach(want => {
      reconcileGeneratedTask({
        kind: 'birthday',
        sourceId: want.sourceId,
        // Never false: the not-wanted half is decided over the whole set at
        // once and was handled by the drop pass above. A `false` here would
        // delete through deleteTask and stamp the person as opted out.
        wanted: true,
        // Only ever chases a birthday that actually moved, read off the task's
        // own deadline — see birthdayDrift. The lead-day setting deliberately
        // doesn't move a live row: by the time it changes, the user may have
        // deferred this one, and rewriting its date would undo that.
        drift: existing => birthdayDrift(existing, want),
        draft: () => ({
          title: want.title,
          dueDate: want.dueDate.toISOString(),
          // The birthday itself, on the field that exists for a day that can't
          // move. The lead time decides when the row surfaces; this is what it
          // is actually about, and it's what a corrected birthday is compared
          // against on the next sweep.
          deadline: want.deadline.toISOString(),
          linkUrl: personLinkUrl(want.personId),
          // So the row's own call and text buttons work on the day, with no new
          // UI: TaskItem already renders both off this field.
          phoneNumber: want.phoneNumber,
          category,
          // The gift ideas you wrote down in March, which is the whole point of
          // having written them (#2047). **Creation only, never a reconcile** —
          // `category` right above takes the same line, and `mealSlotTaskDraft`
          // states the rule: a field the generator doesn't *own* is applied once
          // and then belongs to the user. `notes` is emphatically theirs to
          // edit, and a drift pass rewriting it would eat what they added on
          // the day. In practice ideas are written months ahead and the row is
          // written days ahead, so it arrives carrying them.
          notes: giftIdeasText(usePersonNoteStore.getState().notes, want.personId, today),
          // Deliberately **no personIds**, for the reason projectReview carries
          // no projectId. A task naming somebody is the record that something
          // happened *with* them (see Task.personIds), and the app writing that
          // record on its own behalf would put its own rows into a history
          // meant to hold yours — and, once the reach-out nudge reads that
          // history (#2046), ticking off "Tessa's birthday" would reset a
          // clock you never actually reached out on. It points at its person
          // through generatedSourceId, like every generator points at its
          // source.
          ...generatedBy('birthday', want.sourceId),
        }),
      });
    });
    // No setLastAction, same reasoning as checkProjectReviewTasks above.
  },

  checkBirthdayGiftTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.birthdayGiftTasks) return;

    const tasks = get().tasks;
    const people = usePersonStore.getState().people;
    const today = getCurrentDayStart();
    const wanted = wantedBirthdayGiftTasks(people, settings.birthdayGiftLeadDays, today);

    // Same ordering as checkBirthdayTasks, for the same reason: a person
    // deleted, archived, or with their birthday cleared or corrected all leave
    // a row naming a day that is no longer anybody's gift to buy.
    const stale = staleBirthdayGiftTasks(tasks, wanted);
    stale.forEach(task => {
      const source = parseBirthdayGiftSource(task);
      dropGeneratedTask('birthdayGift', source ? `${source.personId}#${source.year}` : null);
    });

    if (wanted.length === 0) return;

    // Ensured here rather than only at startup, for the reason birthday's own
    // does — this generator ships off, so nobody flips a switch that would
    // otherwise create the category on its own.
    ensureGeneratedTaskCategory('birthdayGift');
    const category = useSettingsStore.getState().birthdayGiftTaskCategory;

    wanted.forEach(want => {
      reconcileGeneratedTask({
        kind: 'birthdayGift',
        sourceId: want.sourceId,
        wanted: true,
        drift: existing => birthdayGiftDrift(existing, want),
        draft: () => ({
          title: want.title,
          dueDate: want.dueDate.toISOString(),
          deadline: want.deadline.toISOString(),
          linkUrl: personLinkUrl(want.personId),
          category,
          // The gift ideas you wrote down in March — the same read the
          // birthday task's own draft makes, and creation-only for the same
          // reason (see the note there). Both tasks carry it rather than one
          // stealing it from the other: one names the day, the other is the
          // shopping trip, and the ideas are useful sitting on either.
          notes: giftIdeasText(usePersonNoteStore.getState().notes, want.personId, today),
          // No personIds and no phoneNumber, for birthday's own reasons: this
          // is the app's own row, not a record of time spent with them, and
          // there is nobody to call about a shopping errand.
          ...generatedBy('birthdayGift', want.sourceId),
        }),
      });
    });
    // No setLastAction, same reasoning as checkBirthdayTasks above.
  },

  checkReachOutTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.reachOutTasks) return;

    const tasks = get().tasks;
    const people = usePersonStore.getState().people;
    const today = getCurrentDayStart();

    // A grouped person's "together" history folds in every current member of
    // their PersonGroup, not just their own personIds — hanging out with one
    // half of a couple is time spent with the pair, and reading only their
    // own id would have the app ask to "catch up" with someone seen an hour
    // ago under their partner's name. See docs/arch/people.md's "Groups"
    // section.
    // A group set to catch up separately shares nothing: each member reads
    // only the tasks naming them.
    const groups = usePersonGroupStore.getState().groups;
    const namedIdsFor = (person: Person): string[] => reachOutHistoryIds(person, people, groups);

    // The history is derived per person from the rows that name them, which is
    // the same read the person's own screen does — there is no stored "last
    // contacted" anywhere, by design.
    const candidates: ReachOutCandidate[] = people
      // Opted-in people only, so an install where nobody has been opted in does
      // no work at all rather than building a history for everybody on every
      // foreground.
      .filter(p => p.nudgeOptIn && p.cadenceDays > 0 && !p.archived)
      .map(person => {
        const namedIds = namedIdsFor(person);
        const theirs = tasks.filter(t => t.personIds.some(id => namedIds.includes(id)));
        return { person, lastTogether: lastTogether(personHistory(theirs)) };
      });

    // A generated task's sourceId reads back as either a personId or a
    // PersonGroup id (see collapseGroupedReachOuts below) — resolve-or-shrug,
    // the same pattern every other cross-entity pointer in this layer uses.
    const groupIdOf = (personId: string) => {
      const person = people.find(p => p.id === personId);
      return person ? sharedReachOutGroupId(person, groups) : null;
    };
    const groupNameOf = (groupId: string) => usePersonGroupStore.getState().getGroupById(groupId)?.name ?? null;

    const handledRaw = reachOutsHandledRecently(tasks, today);
    // A "handled" id can itself be a group id — expand it back to every
    // current member so wantedReachOuts' own per-person check (which only
    // ever reads a personId) suppresses both, not only whichever member's id
    // happens to equal the collapsed row's own sourceId.
    const handled = new Set<string>(handledRaw);
    for (const id of handledRaw) {
      if (usePersonGroupStore.getState().getGroupById(id)) {
        people.filter(p => p.groupId === id).forEach(p => handled.add(p.id));
      }
    }

    // Uncapped and still in the user's own sortOrder — collapsing runs before
    // the cap so a couple due at once merges into one row instead of one of
    // them losing the contest for a slot.
    const allWanted = wantedReachOuts(candidates, today, handled, candidates.length);
    const collapsedWanted = collapseGroupedReachOuts(allWanted, groupIdOf, groupNameOf);
    const wanted = collapsedWanted.slice(0, MAX_REACH_OUT_TASKS);

    // Everybody still due, uncapped — a row that lost the contest for a slot is
    // not stale, and deleting one the user deferred to Saturday would be the
    // app taking back an offer it already made.
    const stillDue = new Set(collapsedWanted.map(w => w.sourceId));
    // dropGeneratedTask rather than deleteGeneratedTaskQuietly: the latter
    // routes through deleteTask, which stamps the source's opt-out. Here that
    // would record a decline the user never made and silence the person for a
    // week on the strength of the app's own tidying up.
    staleReachOutTasks(tasks, stillDue).forEach(task =>
      dropGeneratedTask('reachOut', reachOutPersonId(task))
    );

    if (wanted.length === 0) return;

    ensureGeneratedTaskCategory('reachOut');
    const category = useSettingsStore.getState().reachOutTaskCategory;
    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    wanted.forEach(want => {
      reconcileGeneratedTask({
        kind: 'reachOut',
        sourceId: want.sourceId,
        wanted: true,
        // Chases the title only, and only when it has actually changed — a
        // renamed person, or an "ask about" note added or answered since the
        // row was written. Deliberately never the date: by the time a second
        // sweep runs the user may have deferred this to Saturday.
        drift: existing => (existing.title === want.title ? null : { title: want.title }),
        draft: () => ({
          title: want.title,
          dueDate: dueDate.toISOString(),
          linkUrl: personLinkUrl(want.personId),
          // So the row's own call and text buttons work: the whole point is
          // that the nudge is one tap from actually doing the thing.
          phoneNumber: want.phoneNumber,
          category,
          // No personIds, for the reason the birthday task carries none: a task
          // naming somebody is the record that something happened with them,
          // and ticking this off would otherwise reset the very clock that
          // wrote it without you having actually reached out.
          ...generatedBy('reachOut', want.sourceId),
        }),
      });
    });
  },

  /**
   * "Follow up with X about Y" — a task waiting on somebody, waited on long
   * enough, gets a task of its own. See src/utils/waitingFollowUpTasks.ts.
   */
  checkWaitingFollowUpTasks() {
    const settings = useSettingsStore.getState();
    // Work the app invents on the strength of a wait dragging on, not
    // sunscreen — see GeneratedKindSpec.pausedOnVacation.
    if (generatorPausedForVacation('waitingFollowUp', settings.vacationMode)) return;
    // The setting gates the app asking unasked. A wait with its own follow-up
    // day (Task.followUpOn) was asked for, so it runs either way; with the
    // setting off, those are the only ones wanted.

    const tasks = get().tasks;
    const people = usePersonStore.getState().people;
    const today = getCurrentDayStart();

    // Anything already ticked off or archived recently is left alone rather
    // than handed straight back — see waitingFollowUpsHandledRecently.
    const handled = waitingFollowUpsHandledRecently(tasks, today);
    const wanted = wantedWaitingFollowUps(
      tasks, people, today, handled, MAX_WAITING_FOLLOW_UP_TASKS, settings.waitingFollowUpTasks,
    );

    // Clear first, create second, and never the reverse — the same ordering
    // checkProjectReviewTasks and checkReachOutTasks run on: the stale set
    // includes the row for a wait the user has just released or finished from
    // this very task, and a create pass running first would be deciding
    // against a list that still held it.
    //
    // dropGeneratedTask, not deleteGeneratedTaskQuietly: that one routes
    // through deleteTask, which writes the source's opt-out — here it would
    // stamp waitingFollowUpDeclinedAt on a task the user never swiped away,
    // silencing a future wait on the strength of the app's own tidying up.
    staleWaitingFollowUpTasks(tasks, tasks, people).forEach(task =>
      dropGeneratedTask('waitingFollowUp', waitingFollowUpTaskId(task))
    );

    if (wanted.length === 0) return;

    ensureGeneratedTaskCategory('waitingFollowUp');
    const category = useSettingsStore.getState().waitingFollowUpTaskCategory;
    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    wanted.forEach(want => {
      reconcileGeneratedTask({
        kind: 'waitingFollowUp',
        sourceId: want.taskId,
        // Never false: the not-wanted half is decided over the whole set at
        // once and was handled by the drop pass above.
        wanted: true,
        // Chases the title only, and only when it's actually changed — the
        // waiting task renamed, or waitingOnPersonId repointed at somebody
        // else since this row was written. Deliberately never the date: by
        // the time a second sweep runs the user may have deferred this to
        // Saturday.
        drift: existing => (existing.title === want.title ? null : { title: want.title }),
        draft: () => ({
          title: want.title,
          dueDate: dueDate.toISOString(),
          linkUrl: personLinkUrl(want.personId),
          // So the row's own call and text buttons work, the same as
          // reachOut's: the whole point is that the nudge is one tap from
          // actually doing the thing.
          phoneNumber: want.phoneNumber,
          category,
          // Filed where the wait is: chasing the contractor is part of the
          // kitchen, and belongs on its page beside the task it's about.
          projectId: want.projectId,
          // No personIds, for the reason the birthday and reachOut tasks
          // carry none: a task naming somebody is the record that something
          // happened with them, and ticking this off would otherwise reset a
          // clock this generator has no business touching.
          ...generatedBy('waitingFollowUp', want.taskId),
        }),
      });
    });
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
    // Work the app invents, and vacation mode is the deliberate "hide work
    // from me" — see GeneratedKindSpec.pausedOnVacation. Skipped without
    // recording anything, so the trigger declined here fires for real the
    // first time the app is opened after vacation ends.
    if (generatorPausedForVacation('mealSlot', settings.vacationMode)) return;

    // The *logical* day, not the calendar one: at 1am with a 2am reset the meal
    // tasks that belong on screen are still yesterday's, and dayKeyOf(new Date())
    // would open the window a day early. See CLAUDE.md on the grace window.
    const today = dayKeyOf(getLogicalToday());

    // Clear first, and ahead of the switch and kitchen gates below: those stop
    // this pass *writing*, and a row about a meal that has already gone by is
    // stale whether or not the generator is still on. Only rows nobody started
    // or moved go (see staleMealSlotTasks). dropGeneratedTask writes no opt-out,
    // and a slot has nothing to write one on anyway, so the mark alone still
    // keeps a dropped day from being written again.
    staleMealSlotTasks(get().tasks, today).forEach(task =>
      dropGeneratedTask('mealSlot', task.generatedSourceId)
    );
    // And the rows for a meal that is already in the food log, which food
    // logged straight into the day would otherwise leave sitting on Today.
    get().syncLoggedMealSlotTasks();

    // The same gate checkPantryCheckTasks takes, and for the same reason —
    // which that one's comment claimed was unique to it, back when it was. This
    // pass fires on time passing rather than on a purchase or an edit, so with
    // the area hidden it went on laying down three meal tasks a day (both
    // settings ship on) with no Settings row left rendering to stop them.
    // Skipping without advancing mealSlotTasksWrittenThroughDayKey, the way the
    // nudge skips without recording its week: the mark is a high-water the pass
    // only ever writes past, so moving it here would punch a hole in the window
    // that the area coming back could never fill in.
    if (!settings.kitchenEnabled) return;
    if (!settings.mealCookTasks || settings.mealSlotsEnabled.length === 0) return;

    const horizonEnd = shiftDayKey(today, MEAL_SLOT_TASK_DAYS - 1);
    const mark = settings.mealSlotTasksWrittenThroughDayKey;
    // A mark behind today means the app has been closed for a while: pick up
    // from today rather than filling in the days that have already gone past,
    // which is the one direction a meal task is no use in.
    const from = mark && mark >= today ? shiftDayKey(mark, 1) : today;
    if (from > horizonEnd) return;

    writeMealSlotTasks(from, horizonEnd, settings.mealSlotsEnabled, true);
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
  syncLoggedMealSlotTasks() {
    const tasks = get().tasks;
    if (liveGeneratedTasksOfKind(tasks, 'mealSlot').length === 0) return;
    // The window the pass writes, read from SQLite: the food log store holds
    // only the range a screen has open. A past day's rows are the stale
    // sweep's, so the read starts at the logical today.
    const today = dayKeyOf(getLogicalToday());
    const logged = loggedMealSlotKeys(
      dbGetFoodLogEntries(today, shiftDayKey(today, MEAL_SLOT_TASK_DAYS - 1))
    );
    // dropGeneratedTask writes no opt-out and the mark keeps the day from
    // being written again, so a row dropped here stays dropped even if the
    // entry is deleted later.
    loggedMealSlotTasks(tasks, logged).forEach(task =>
      dropGeneratedTask('mealSlot', task.generatedSourceId)
    );
  },

  backfillMealSlotTasks(slots) {
    const settings = useSettingsStore.getState();
    // The same gate the pass above takes. Unreachable today — the only caller
    // is a Settings row that stops rendering with the area off — but that is a
    // fact about a component two files away, and "the UI can't call it" is
    // exactly the reasoning that left checkMealSlotTasks ungated while it wrote
    // three tasks a day. A write path states its own preconditions.
    if (!settings.kitchenEnabled) return;
    if (!settings.mealCookTasks || slots.length === 0) return;
    const today = dayKeyOf(getLogicalToday());
    const mark = settings.mealSlotTasksWrittenThroughDayKey;
    // Nothing written yet, or nothing still ahead of us: the ordinary pass has
    // the whole window to do and will pick these up with everything else.
    if (!mark || mark < today) return;
    writeMealSlotTasks(today, mark, slots, false);
  },

  checkPantryCheckTasks() {
    const settings = useSettingsStore.getState();
    // Work the app invents, and vacation mode is the deliberate "hide work
    // from me" — see GeneratedKindSpec.pausedOnVacation. Skipped without
    // recording anything, so the trigger declined here fires for real the
    // first time the app is opened after vacation ends.
    if (generatorPausedForVacation('pantryCheck', settings.vacationMode)) return;
    // The switch and the whole grocery area (kitchenEnabled) gate *creating*
    // only, and are checked below the clear rather than here. This generator
    // fires on time passing rather than on a purchase or an edit — so without
    // the gate it would be a hidden feature still writing rows onto Today. This
    // used to say "unlike every other grocery generator", which stopped being
    // true the moment mealSlot arrived firing on the same trigger — and that
    // stale claim is most of why mealSlot shipped without the gate. Which
    // generators need one is `GeneratedKindSpec.kitchen` now, rather than a
    // sentence here that goes out of date silently.
    //
    // But returning above the clear froze every row already written: an item
    // bought again or deleted after the switch went off left its "Check if you
    // still have X" on Today until somebody deleted it by hand. Off means stop
    // asking, not stop tidying up, the same line reconcileGeneratedTask draws
    // for vacation. With nothing live there is nothing to clear, so an off
    // switch still costs nothing.
    const creating = settings.pantryCheckTasks && settings.kitchenEnabled;
    const tasks = get().tasks;
    if (!creating && liveGeneratedTasksOfKind(tasks, 'pantryCheck').length === 0) return;

    const { items, listEntries, itemProducts } = useGroceryStore.getState();
    // Every trolley, not just the one at home: a row already on the Airbnb list
    // is shopping you are on your way to do, so asking whether you still have it
    // is asking the wrong question. See pantryCheckLapse.
    const listed = listedAnywhere(listEntries);
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
    const stale = stalePantryCheckTasks(tasks, items, now, itemProducts, listed);
    stale.forEach(task => dropGeneratedTask('pantryCheck', pantryCheckItemId(task)));
    if (!creating) return;

    // One review row already asks about the whole cupboard, so the drip stands
    // down rather than adding three more questions about individual shelves of
    // it (see pantryReviewTasks.ts for the split). Deliberately only the
    // *create* half: rows raised before the review appeared are left alone,
    // since a deferred one is the user's, and answering them from the deck
    // clears them through the stale pass above for free — a card answered makes
    // its item's lapse null, which is exactly what that pass tests.
    if (liveGeneratedTasksOfKind(tasks, 'pantryReview').length > 0) return;

    const wanted = wantedPantryChecks(items, tasks, now, itemProducts, undefined, listed);
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

  checkPantryReviewTasks() {
    const settings = useSettingsStore.getState();
    // Work the app invents, and vacation mode is the deliberate "hide work
    // from me" — see GeneratedKindSpec.pausedOnVacation. Skipped without
    // recording anything, so the trigger declined here fires for real the
    // first time the app is opened after vacation ends.
    if (generatorPausedForVacation('pantryReview', settings.vacationMode)) return;
    // The switch and the same kitchenEnabled gate checkPantryCheckTasks takes
    // directly above, for the same reason: this fires on time passing rather
    // than on a purchase or an edit, so without it this would be the one part
    // of a switched-off feature still writing rows onto Today. Checked below
    // the clear for that pass's reason too: off stops the offer, and a row
    // whose deck has since emptied still goes.
    const creating = settings.pantryReviewTasks && settings.kitchenEnabled;
    const tasks = get().tasks;
    if (!creating && liveGeneratedTasksOfKind(tasks, 'pantryReview').length === 0) return;

    const grocery = useGroceryStore.getState();
    // Bare `new Date()` on purpose, the call checkPantryCheckTasks makes and
    // for its reason: a pantry window is real elapsed days from a till receipt
    // rather than logical days (see the dayResetTime note in CLAUDE.md).
    const deck = buildPantryReviewDeck(grocery.items, new Date(), grocery.itemProducts);

    // Clear first, create second, the ordering every generator here runs on.
    // dropGeneratedTask rather than deleteGeneratedTaskQuietly for the reason
    // checkPantryCheckTasks gives — except that here there is nothing to stamp
    // at all (no source row), so the two would agree; it stays the honest call
    // for what this is, which is the app tidying up rather than the user
    // declining.
    stalePantryReviewTasks(tasks, deck).forEach(task =>
      dropGeneratedTask('pantryReview', pantryReviewDayKey(task))
    );
    // Before the mark below, which is spent only on a day the offer could
    // actually have been made.
    if (!creating) return;

    // The day boundary is the user's own here, unlike the deck's window above:
    // this is "have I offered this today", which is a question about their
    // calendar rather than about a shelf.
    const todayStart = getCurrentDayStart();
    const todayKey = dayKeyOf(todayStart);
    if (!pantryReviewCadenceElapsed(settings.pantryReviewLastDayKey, todayStart)) return;
    // Recorded before the deck is judged, and unconditionally: a day already
    // considered — offered, or found not doubtful enough — must not be
    // re-diagnosed on every later sweep, and with no source row this mark is
    // the only thing standing between a swiped-away row and an identical one on
    // the very next foreground (see writeGeneratedOptOut's pantryReview case).
    // Same idempotency calendarReviewLastDayKey gives, carrying the cadence too.
    settings.setPantryReviewLastDayKey(todayKey);

    // One at a time. A row raised a fortnight ago and still sitting there means
    // the offer has been ignored or deferred, and a second one is the pile-up
    // every generator here has a rule against — the mark above has just been
    // refreshed, so the next offer is another cadence out.
    if (liveGeneratedTasksOfKind(tasks, 'pantryReview').length > 0) return;
    if (!wantsPantryReview(deck)) return;

    ensureGeneratedTaskCategory('pantryReview');
    const category = useSettingsStore.getState().pantryReviewTaskCategory;
    // Noon today, the landing every other unattended writer picks.
    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    reconcileGeneratedTask({
      kind: 'pantryReview',
      sourceId: todayKey,
      // Never false: the not-wanted half is the stale pass above.
      wanted: true,
      // The title never varies, so there is nothing to chase — and the due date
      // deliberately isn't chased either, for checkPantryCheckTasks' reason: by
      // the time a second sweep runs the user may have deferred this row.
      drift: () => null,
      draft: () => ({
        title: PANTRY_REVIEW_TITLE,
        dueDate: dueDate.toISOString(),
        // Opens the Pantry screen with the deck already up. See
        // PANTRY_REVIEW_LINK_URL.
        linkUrl: PANTRY_REVIEW_LINK_URL,
        category,
        ...generatedBy('pantryReview', todayKey),
      }),
    });
    // No setLastAction, same reasoning as checkMealPlanNudge above.
  },

  /**
   * Raise a "Shop for X" task for every meal coming up that the kitchen can't
   * currently make, and clear the ones whose meal has changed under them.
   *
   * **The whole answer to a meal plan being a thing people re-plan is that the
   * clear pass re-runs the create predicate** rather than intercepting the ~15
   * mutations that can change a week. See `staleMealShortfallTasks` for the
   * list of plan changes that fall out of it for free.
   *
   * Reads the entry window straight from the database rather than from
   * `useMealPlanStore.entries`, for the reason `refreshPlannedSlotCounts` does:
   * that array is the single range the Meal Plan screen happens to be showing,
   * which is usually not the two days this is asking about and is empty until
   * the screen has been opened at all.
   */
  checkMealShortfallTasks() {
    const settings = useSettingsStore.getState();
    // Work the app invents, and vacation mode is the deliberate "hide work
    // from me" — see GeneratedKindSpec.pausedOnVacation. Skipped without
    // recording anything, so the trigger declined here fires for real the
    // first time the app is opened after vacation ends.
    if (generatorPausedForVacation('mealShortfall', settings.vacationMode)) return;
    // The whole grocery area can be switched off, and this generator reads the
    // catalog to decide what's missing — without this gate it would be part of
    // a hidden feature still writing rows onto Today. Same gate
    // checkPantryCheckTasks takes, for the same reason, and below the clear for
    // that pass's reason as well: a "Shop for Ragu" whose meal was dropped from
    // the plan after the switch went off otherwise stayed on Today naming a
    // meal that no longer existed.
    const creating = settings.mealShortfallTasks && settings.kitchenEnabled;
    const tasks = get().tasks;
    if (!creating && liveGeneratedTasksOfKind(tasks, 'mealShortfall').length === 0) return;

    const leadDays = settings.mealShortfallLeadDays;
    // The *logical* today: this decides which meals are close enough to shop
    // for, which is a scheduling decision, and at 1am with a 2am reset the
    // calendar date would open the window a day early. See CLAUDE.md.
    const todayKey = dayKeyOf(getLogicalToday());
    // One `now` for both passes, so the create and the clear can't disagree
    // about a pantry guess landing exactly on its boundary. Bare `new Date()`
    // on purpose — `probablyHaveReason` measures real elapsed days from a till
    // receipt, not logical ones.
    const now = new Date();

    // Read one day wider than the window on each side so the clear pass can see
    // a meal that has just moved *out* of range: a task whose entry isn't in
    // this set at all is treated as an entry that no longer exists, which for a
    // meal merely dragged to next week would be the right answer by luck rather
    // than by reading its new date.
    const entries = dbGetMealPlanEntries(
      shiftDayKey(todayKey, -1),
      shiftDayKey(todayKey, Math.max(0, leadDays) + 1)
    );
    const recipes = useRecipeStore.getState().recipes;
    const recipesById = new Map(recipes.map(r => [r.id, r]));
    // The boxes too, so a packet frozen or marked "Got it" counts as having it
    // here the way it does in the Pantry (see classifyPlanned's `products`).
    const { items, itemSubs, itemProducts } = useGroceryStore.getState();
    const swaps = standingSwapMap(itemSubs, items);

    // Clear first, create second, and never the reverse — the ordering
    // checkPantryCheckTasks and checkProjectReviewTasks both run on, for the
    // same reason: the stale set includes the row for a meal the user has just
    // shopped for from this very task, and a create pass running first would be
    // deciding against a list that still held it.
    //
    // dropGeneratedTask rather than deleteGeneratedTaskQuietly: that routes
    // through deleteTask, which writes the source's opt-out — here it would
    // stamp shopTask: false on a meal the user never turned down, and so
    // suppress the offer for ever on the strength of the app's own tidying up.
    const stale = staleMealShortfallTasks(
      tasks, entries, recipesById, items, itemSubs, swaps, todayKey, now, leadDays, itemProducts
    );
    stale.forEach(task => dropGeneratedTask('mealShortfall', mealShortfallEntryId(task)));
    if (!creating) return;

    const wanted = wantedMealShortfalls(
      entries, recipesById, items, itemSubs, swaps, todayKey, now, leadDays,
      MAX_MEAL_SHORTFALL_TASKS, itemProducts
    );
    if (wanted.length === 0) return;

    ensureGeneratedTaskCategory('mealShortfall');
    const category = useSettingsStore.getState().mealShortfallTaskCategory;
    // Noon today, the landing every other unattended writer picks: an offer
    // dated forward is an offer you can't see, and this one is already only
    // raised once the meal is inside the lead window — so "today" *is* the day
    // the shop wants doing. Deferring it afterwards is the user's own call.
    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    wanted.forEach(want => {
      reconcileGeneratedTask({
        kind: 'mealShortfall',
        sourceId: want.entryId,
        // Never false: the not-wanted half is decided over the whole window at
        // once and was handled by the drop pass above. A `false` here would
        // delete through deleteTask and stamp the meal as declined.
        wanted: true,
        // A finished one blocks a new one, alone among the generators still
        // firing. A meal is one event — having shopped for Tuesday's ragù, a
        // second row asking again would be an invention. This is the reading
        // cook tasks had, inherited for the same reason and not by copying.
        blocksOnFinished: true,
        // The title is the only thing a live row chases, and only when the
        // recipe has been renamed under it. Deliberately not the due date: by
        // the time a second sweep runs the user may have deferred this row, and
        // rewriting it back to today would take that back. A meal that moves
        // *day* isn't drift at all — it leaves the window or re-enters it, and
        // the stale pass above owns that.
        drift: existing => (existing.title === want.title ? null : { title: want.title }),
        draft: () => ({
          title: want.title,
          dueDate: dueDate.toISOString(),
          // Opens the Meal Plan screen straight on the add-to-list sheet for
          // this meal. See mealShortfallLinkUrl.
          linkUrl: mealShortfallLinkUrl(want.dayKey, want.entryId),
          category,
          ...generatedBy('mealShortfall', want.entryId),
        }),
      });
    });
    // No setLastAction, same reasoning as checkMealPlanNudge above.
  },

  /**
   * Raise a "Take X out of the freezer" task for a meal today or tomorrow that
   * uses something only on hand frozen, and clear the ones whose reason has
   * gone (#2926). `checkMealShortfallTasks` with a different question: the
   * same entries, catalog and classification, the same clear-then-create order
   * and the same reasons for each gate. See src/utils/mealThawTasks.ts.
   */
  checkMealThawTasks() {
    const settings = useSettingsStore.getState();
    if (generatorPausedForVacation('mealThaw', settings.vacationMode)) return;
    // Refuse to create without the switch or the kitchen, never to clear: a
    // row naming a meal since dropped goes either way.
    const creating = settings.mealThawTasks && settings.kitchenEnabled;
    const tasks = get().tasks;
    if (!creating && liveGeneratedTasksOfKind(tasks, 'mealThaw').length === 0) return;

    // Logical today, for the grace-window reason checkMealShortfallTasks gives.
    const todayKey = dayKeyOf(getLogicalToday());
    const now = new Date();
    // One day wider on each side than the window (today and tomorrow), for
    // checkMealShortfallTasks' reason: a meal that has just moved out has to
    // be read at its new date rather than looking deleted.
    const entries = dbGetMealPlanEntries(shiftDayKey(todayKey, -1), shiftDayKey(todayKey, 2));
    const recipesById = new Map(useRecipeStore.getState().recipes.map(r => [r.id, r]));
    const { leftovers } = useLeftoverStore.getState();
    const { items, itemSubs, itemProducts } = useGroceryStore.getState();
    const swaps = standingSwapMap(itemSubs, items);

    // Clear first, then create, and through dropGeneratedTask so the app's own
    // tidying up never stamps thawTask: false on a meal nobody declined.
    staleMealThawTasks(
      tasks, entries, recipesById, leftovers, items, itemSubs, swaps, todayKey, now, itemProducts
    ).forEach(task => dropGeneratedTask('mealThaw', mealThawEntryId(task)));
    if (!creating) return;

    const wanted = wantedMealThaws(
      entries, recipesById, leftovers, items, itemSubs, swaps, todayKey, now, undefined, itemProducts
    );
    if (wanted.length === 0) return;

    ensureGeneratedTaskCategory('mealThaw');
    const category = useSettingsStore.getState().mealThawTaskCategory;
    // Noon today, the landing every other unattended writer picks: the window
    // is only today and tomorrow, so today *is* the day to do it.
    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    wanted.forEach(want => {
      reconcileGeneratedTask({
        kind: 'mealThaw',
        sourceId: want.entryId,
        wanted: true,
        // A meal is one event: having taken the chicken out for Thursday, a
        // second row asking again would be an invention.
        blocksOnFinished: true,
        // The title and the link follow what's frozen (a second item frozen,
        // one thawed); the date never does, so a deferral stands.
        drift: existing => {
          const updates: Partial<Task> = {};
          if (existing.title !== want.title) updates.title = want.title;
          if (existing.linkUrl !== want.linkUrl) updates.linkUrl = want.linkUrl;
          return Object.keys(updates).length > 0 ? updates : null;
        },
        draft: () => ({
          title: want.title,
          dueDate: dueDate.toISOString(),
          linkUrl: want.linkUrl,
          category,
          ...generatedBy('mealThaw', want.entryId),
        }),
      });
    });
    // No setLastAction, same reasoning as checkMealPlanNudge above.
  },

  /**
   * Give every planned meal a few days in the past with nothing logged
   * against it a "Log X" task. See src/utils/mealLogNudgeTasks.ts for the
   * window, the cap, and why `cookedAt` is never consulted.
   *
   * Reads both the entry window and the food log window straight from the
   * database, for `checkMealShortfallTasks`' own reason: the loaded stores
   * hold only whatever range a screen happened to have open.
   */
  checkMealLogNudgeTasks() {
    const settings = useSettingsStore.getState();
    if (generatorPausedForVacation('mealLogNudge', settings.vacationMode)) return;
    // The switch and the kitchen gate stop creating only, below the clear, for
    // checkPantryCheckTasks' reason: a row for a meal since logged or deleted
    // goes whether or not the generator is still on.
    const creating = settings.mealLogNudgeTasks && settings.kitchenEnabled;
    const tasks = get().tasks;
    if (!creating && liveGeneratedTasksOfKind(tasks, 'mealLogNudge').length === 0) return;

    const todayKey = dayKeyOf(getLogicalToday());
    // One day wider on the near edge, for the reason checkMealShortfallTasks
    // reads one day wider on each of its own: a task whose entry has moved is
    // told apart from one whose entry has vanished only by what's actually in
    // this set.
    const windowStart = shiftDayKey(todayKey, -MEAL_LOG_NUDGE_LOOKBACK_DAYS - 1);
    const entries = dbGetMealPlanEntries(windowStart, todayKey);
    const logged = mealLogRecord(dbGetFoodLogEntries(windowStart, todayKey));

    // Clear first, create second, the same ordering every generator here
    // runs on: the stale set includes the row for a meal just logged from
    // this very task, and a create pass running first would be deciding
    // against a list that still held it.
    const stale = staleMealLogNudgeTasks(tasks, entries, logged, todayKey);
    stale.forEach(task => dropGeneratedTask('mealLogNudge', mealLogNudgeEntryId(task)));
    if (!creating) return;

    const wanted = wantedMealLogNudges(entries, logged, todayKey);
    if (wanted.length === 0) return;

    ensureGeneratedTaskCategory('mealLogNudge');
    const category = useSettingsStore.getState().mealLogNudgeTaskCategory;
    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    wanted.forEach(want => {
      reconcileGeneratedTask({
        kind: 'mealLogNudge',
        sourceId: want.entryId,
        wanted: true,
        // A meal is one event — see the module header on why a finished row
        // (whether or not it actually led to a log entry) never comes back.
        blocksOnFinished: true,
        drift: existing => (existing.title === want.title ? null : { title: want.title }),
        draft: () => ({
          title: want.title,
          dueDate: dueDate.toISOString(),
          linkUrl: mealLogNudgeLinkUrl(want.dayKey),
          category,
          ...generatedBy('mealLogNudge', want.entryId),
        }),
      });
    });
    // No setLastAction, same reasoning as checkMealPlanNudge above.
  },

  checkSupplyReorderTasks() {
    const settings = useSettingsStore.getState();
    // Work the app invents, and vacation mode is the deliberate "hide work
    // from me" — see GeneratedKindSpec.pausedOnVacation. Skipped without
    // recording anything, so the trigger declined here fires for real the
    // first time the app is opened after vacation ends.
    if (generatorPausedForVacation('supplyReorder', settings.vacationMode)) return;
    const { dayResetTime } = settings;
    const tasks = get().tasks;

    // The grocery half first, and outside the setting gate on purpose: putting
    // a linked item on the shopping list is not the generator writing a task,
    // it's the supply doing the one thing the user asked for by linking it.
    // "Reorder tasks for supplies" is a switch about rows appearing on Today,
    // and switching it off shouldn't quietly stop the list working too. It is
    // still gated on the kitchen existing at all.
    if (settings.kitchenEnabled) {
      const grocery = useGroceryStore.getState();
      const lowIds = suppliesWantingList(tasks, grocery.items, dayResetTime);
      // registerUndo: false — nobody tapped anything. This runs from the launch
      // sweep, the Today foreground and a completion, so the add left under the
      // user's next shake would be labelled as something they had just done and
      // point at an item they may never have opened. Same reason the completed
      // task purge doesn't route through bulkDeleteTasks.
      // listId: null — the home list, the one the supply is restocked from.
      // The active list may be an away one (checkAwayGroceryList switches to
      // it), and a supply flagged low there is never restocked by that trip
      // and, already flagged, never reaches the home list after it.
      lowIds.forEach(itemId => grocery.setRunningLow(itemId, true, { registerUndo: false, listId: null }));
    }

    if (!settings.supplyReorderTasks) return;

    // Clear first, create second, and never the reverse — the same ordering
    // checkProjectReviewTasks and checkPantryCheckTasks run on, for the same
    // reason: the stale set includes the row for a supply the user has just
    // restocked from this very task, and a create pass running first would be
    // deciding against a list that still held it.
    //
    // dropGeneratedTask rather than deleteGeneratedTaskQuietly: that routes
    // through deleteTask, which writes the source's opt-out — here it would
    // stamp supplyDeclinedAtCount on a task the user never turned down, and so
    // silence the offer until the *next* restock on the strength of the app's
    // own tidying up.
    // The rows a supply's grocery link can act through: every live catalog row
    // with the kitchen on, none with it off. A link outside that set asks
    // through a reorder task instead (see supplyLinkActs), or a supply whose
    // item was deleted would ask nowhere at all. Undefined, meaning "trust
    // every link", until the grocery store has loaded: an empty catalog
    // mid-launch is not every item having been deleted.
    const grocery = useGroceryStore.getState();
    const actingItemIds = !settings.kitchenEnabled
      ? new Set<string>()
      : grocery.initialized ? new Set(grocery.items.map(i => i.id)) : undefined;
    const stale = staleSupplyReorderTasks(tasks, dayResetTime, actingItemIds);
    stale.forEach(task => dropGeneratedTask('supplyReorder', supplyReorderSourceId(task)));

    const wanted = wantedSupplyReorders(get().tasks, dayResetTime, undefined, actingItemIds);
    if (wanted.length === 0) return;

    // Noon today, the landing every other unattended writer picks: an offer
    // dated forward is an offer you can't see. The *lead time* is what decides
    // which day this row first appears (see supplyReorderReason), so by the
    // time it's wanted at all, today is exactly when it wants to be read.
    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    wanted.forEach(want => {
      reconcileGeneratedTask({
        kind: 'supplyReorder',
        sourceId: want.taskId,
        // Never false: the not-wanted half is decided over every supply at once
        // and was handled by the drop pass above. A `false` here would delete
        // through deleteTask and stamp the source as declined.
        wanted: true,
        // The title is the only thing a live row chases, and only when the
        // supply has been renamed under it. Deliberately not the due date: by
        // the time a second sweep runs the user may have deferred this row to
        // Saturday, and rewriting it back to today would take that back. Nor
        // the deadline — the run-out day moves every time the source is
        // completed, and a deadline that walks forward under the row is one
        // nobody can plan against.
        drift: existing => (existing.title === want.title ? null : { title: want.title }),
        draft: () => ({
          title: want.title,
          dueDate: dueDate.toISOString(),
          // The day the last unit gets spent, when the schedule can say. This
          // is the whole reason the lead time is worth asking for: the row
          // carries a real "needed by" rather than a vague urgency, and every
          // deadline surface in the app — the countdown chip, the calendar
          // mirror, look-ahead — reads it for free.
          deadline: want.runOut ? want.runOut.toISOString() : null,
          // Where you actually buy it. A consumable ordered online is a task
          // whose entire content is that link, and the source task already
          // holds one for exactly this reason — so it's inherited rather than
          // asked for twice.
          linkUrl: want.linkUrl,
          // "How many did you get?" on completion, which is what puts the
          // units back. See the restock block in completeTask.
          deliverableKind: 'number' as const,
          // Filed under the generator's own "File them under" setting, same
          // as every other generated kind — see GeneratedKindSpec.categorized.
          category: settings.supplyReorderTaskCategory,
          ...generatedBy('supplyReorder', want.taskId),
        }),
      });
    });
    // No setLastAction, same reasoning as checkMealPlanNudge above.
  },

  /**
   * Once a day, a task to review tomorrow's calendar — only while tomorrow
   * actually has something on it.
   *
   * Structurally this is `mealPlanNudge` one shelf over: no source row (its
   * source id is tomorrow's day key), so no per-source stamp to decline onto,
   * and the same settings-level idempotency mark in its place
   * (`calendarReviewLastDayKey`, recorded unconditionally the moment a day is
   * considered — see writeGeneratedOptOut). Unlike the nudge it writes at most
   * one task, not a week's worth, so there is no cap and no stack.
   *
   * `calendarReviewTimeSegment` holds it back until a part of the day, same as
   * a task's own Time of day field — read once, at creation, so changing the
   * setting shapes the next task this writes rather than reaching back to
   * rewrite one already on the list.
   */
  checkCalendarReviewTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.calendarReviewTasks) return;
    // Real device data has no place in a demo session — same refusal
    // TodayScreen's own event rows make (`!demoActive`), and more load-bearing
    // here: a context row is gone the moment demo mode ends, but a task this
    // generator wrote would persist in the demo database as a fact about the
    // real calendar.
    if (isDemoModeActive()) return;
    // This is the one generator that fires on time passing rather than on an
    // edit to something the read produced, so without this it would be the
    // one part of a switched-off feature still writing rows onto Today.
    if (!settings.calendarReadEnabled) return;

    const calendar = useCalendarStore.getState();
    // Not the same question as `events` being empty — see CalendarState.loaded.
    // An unread window must not be read as "tomorrow is free".
    if (!calendar.loaded) return;

    const tomorrowStart = getLogicalTomorrow(settings.dayResetTime);
    const tomorrowKey = dayKeyOf(tomorrowStart);

    // Clear a task left over from a previous day's "tomorrow" before deciding
    // whether today's is wanted — same clear-first-create-second ordering
    // checkProjectReviewTasks/checkPantryCheckTasks use. There's at most one of
    // these, so no dropGeneratedTask lookup is needed: whatever's live and
    // isn't about tomorrow is stale by construction.
    const tasks = get().tasks;
    liveGeneratedTasksOfKind(tasks, 'calendarReview')
      .filter(task => calendarReviewDayKey(task) !== tomorrowKey)
      .forEach(task => deleteGeneratedTaskQuietly(task.id));

    // Recorded before the events check below, and unconditionally: a day
    // already decided — created, or found to have nothing worth reviewing —
    // must not be re-diagnosed on every later sweep this same day, the same
    // idempotency checkMealPlanNudge's week key gives the nudge. Without it a
    // task the user just swiped away would come straight back on the very next
    // foreground, since nothing else is standing between a delete and a
    // recreate here (see writeGeneratedOptOut).
    if (settings.calendarReviewLastDayKey === tomorrowKey) return;
    settings.setCalendarReviewLastDayKey(tomorrowKey);

    const tomorrowEvents = eventsIn(calendar.events, tomorrowStart, addDays(tomorrowStart, 1));
    if (!wantsCalendarReview(tomorrowEvents)) return;

    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    reconcileGeneratedTask({
      kind: 'calendarReview',
      sourceId: tomorrowKey,
      // Never false: the clear pass above already handles "not wanted".
      wanted: true,
      // The title never varies, so nothing to chase.
      drift: () => null,
      draft: () => ({
        title: CALENDAR_REVIEW_TITLE,
        dueDate: dueDate.toISOString(),
        timeSegments: settings.calendarReviewTimeSegment ? [settings.calendarReviewTimeSegment] : [],
        category: settings.calendarReviewTaskCategory,
        ...generatedBy('calendarReview', tomorrowKey),
      }),
    });
    // No setLastAction, same reasoning as checkMealPlanNudge above.
  },

  applyWeatherWaits() {
    // Nothing here is written for the demo database: the forecast is a fact
    // about the real world, and a held task would outlive the session.
    if (isDemoModeActive()) return;
    const waiting = get().tasks.filter(t => t.weatherWait);
    if (waiting.length === 0) return;

    // A snapshot from an earlier logical day is not an answer for today. A held
    // task whose day has arrived is still released without one (see
    // decideWeatherWait), so a missing forecast only stops new decisions.
    const weather = useWeatherStore.getState();
    const todayKey = dayKeyOf(getCurrentDayStart());
    const forecast = weather.snapshotDayKey === todayKey ? weather.snapshot?.forecast ?? [] : [];

    for (const task of waiting) {
      const decision = decideWeatherWait(task, forecast, todayKey);
      if (decision.kind === 'release') {
        get().updateTask(task.id, { weatherWait: null, deferUntil: null });
      } else if (decision.kind === 'defer') {
        // Idempotent: a pass that finds the hold already on this day writes
        // nothing, which is what keeps the task-store subscription that
        // triggers this from re-running it forever.
        if (task.deferUntil && dayKeyOf(new Date(task.deferUntil)) === decision.dayKey) continue;
        get().updateTask(task.id, { deferUntil: dayKeyToDate(decision.dayKey).toISOString() });
      }
    }
  },

  /**
   * The fourteenth generator, and the first whose "source" is a rule the
   * user wrote rather than a row or a square on the calendar alone — see
   * `src/utils/weatherTasks.ts`. Structurally it's `checkCalendarReviewTasks`
   * run once per rule instead of once per day: same clear-before-decide
   * ordering, same "mark the day considered before deciding" idempotency, and
   * the same refusal to ever pass `wanted: false` into `reconcileGeneratedTask`
   * (the clear pass above already handles "not wanted").
   */
  checkWeatherTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.weatherTasks) return;
    // Same refusal checkCalendarReviewTasks makes: a task this generator
    // wrote would persist in the demo database as a fact about the real
    // weather, long after the demo session that invented it ends.
    if (isDemoModeActive()) return;
    if (!settings.weatherTaskCategory) return;

    const weather = useWeatherStore.getState();
    const todayKey = dayKeyOf(getCurrentDayStart());
    // Not the same as `snapshot` being unset — a reading from a previous
    // logical day must not be read as an answer for today (see
    // WeatherState.snapshotDayKey). useWeatherSync is what keeps this
    // current; this only ever reads whatever it already fetched.
    if (!weather.snapshot || weather.snapshotDayKey !== todayKey) return;

    const tomorrowKey = dayKeyOf(addDays(getCurrentDayStart(), 1));

    const tasks = get().tasks;
    const activeRuleIds = new Set(settings.weatherRules.map(r => r.id));
    // Clear a task whose rule has since been deleted, or whose day has
    // rolled over, before deciding today's — same ordering
    // checkCalendarReviewTasks and checkProjectReviewTasks use. Tomorrow's are
    // spared alongside today's, since the day-ahead pass below writes a row
    // keyed to the day its *weather* falls on, which is the day after the one
    // it was written on.
    liveGeneratedTasksOfKind(tasks, 'weather')
      .filter(task => {
        const parsed = parseWeatherSourceId(task.generatedSourceId);
        if (!parsed) return true;
        if (!activeRuleIds.has(parsed.ruleId)) return true;
        return parsed.dayKey !== todayKey && parsed.dayKey !== tomorrowKey;
      })
      .forEach(task => deleteGeneratedTaskQuietly(task.id));

    // Unioned with today's day-level forecast code, not just the instant the
    // snapshot was read at — a rule considered at the first read of the day
    // (typically morning) would otherwise only ever see whatever the sky was
    // doing right then, and rain due this afternoon would go unwarned about
    // until it actually started, by which point the mark for today is often
    // already spent. `todayWeatherCode` is Open-Meteo's own summary for the
    // whole day, so this is a look-ahead rather than a second live reading.
    const conditions = Array.from(new Set([
      ...classifyWeather(weather.snapshot.weatherCode, weather.snapshot.tempF),
      ...(weather.snapshot.todayWeatherCode != null
        ? classifyWeather(weather.snapshot.todayWeatherCode, weather.snapshot.tempF)
        : []),
    ]));
    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    // Each rule carries its own idempotency mark rather than one shared day
    // key, since — unlike calendarReview, which asks exactly one question a
    // day — several rules can each be considered and answered independently.
    // The real clock, not the logical day — this decides which stretch of
    // weather is still ahead of you, which is a wall-clock question the way
    // `isTaskExpired`'s is. `getCurrentDayStart()` above is what answers the
    // scheduling half, and does.
    const nowHour = new Date().getHours();
    // Captured rather than reached through `weather.snapshot` below, which the
    // guard above narrows but the closure doesn't keep narrowed.
    const { todayHours, tomorrowHours } = weather.snapshot;

    // Tomorrow's conditions come off its hours alone, where today's union the
    // day-level code above. Not an inconsistency: the day-ahead pass refuses
    // to write anything it can't put an hour to (see below), so a condition
    // only the daily summary knows about could never produce a row here
    // anyway, and reading the hours is what lets "cold" answer to the small
    // hours rather than to a single temperature standing for the whole day.
    const tomorrowConditions = Array.from(new Set(
      (tomorrowHours ?? []).flatMap(h => classifyWeather(h.weatherCode, h.tempF)),
    ));
    const aheadOpen = nowHour >= WEATHER_AHEAD_FROM_HOUR && !!tomorrowHours;

    /**
     * Write, or bring into line, the task for one rule on one day.
     *
     * `considered` is that day's mark already spent. A rule considered may
     * still have a task whose window wants correcting, but must never get a
     * *new* one — the mark is the whole of what stands between a task swiped
     * away and a task straight back, so creation is gated on it where drift
     * deliberately isn't.
     */
    const applyRule = (opts: {
      rule: WeatherRule;
      dayKey: string;
      hours: typeof todayHours;
      dayConditions: readonly WeatherCondition[];
      /** Where in the day to start looking for a run, 0 for a day not yet begun. */
      fromHour: number;
      tomorrow: boolean;
      considered: boolean;
      due: Date;
    }) => {
      const { rule, dayKey, hours, dayConditions, fromHour, tomorrow, considered, due } = opts;
      const sourceId = weatherSourceId(dayKey, rule.id);
      const existing = liveGeneratedTask(tasks, 'weather', sourceId);
      if (considered && !existing) return;
      const category = ruleCategoryFor(rule, settings.weatherTaskCategory);
      if (!ruleMatchesToday(rule, dayConditions)) return;

      // What the day-level code already established, placed in the day: the
      // rule fired because it is rainy *today*, and this is the hour that
      // happens at. A day whose hourly block didn't parse, or whose match came
      // from the current reading alone with no hour agreeing, says nothing
      // rather than guessing (see `weatherTaskTitle`) — except a day ahead,
      // where a window is the entire reason to speak up early and there is
      // nothing worth writing without one.
      const window = weatherWindowFor(hours, rule.condition, fromHour);
      if (tomorrow && !window) return;
      const title = weatherTaskTitle(rule.title, window ? describeWeatherWindow(rule.condition, window, tomorrow) : null);

      reconcileGeneratedTask({
        kind: 'weather',
        sourceId,
        wanted: true,
        // The forecast is re-read through the day now (see SNAPSHOT_STALE_MS),
        // so a window that moves corrects the row rather than leaving it
        // asserting an hour that has changed. It is also what takes the word
        // "tomorrow" back out of a day-ahead title once that day is the one
        // you are on: the same source id is reached by today's pass then, and
        // finds the row already there.
        drift: existing => (existing.title === title ? null : { title }),
        draft: () => ({
          title,
          dueDate: due.toISOString(),
          category,
          linkUrl: WEATHER_LINK_URL,
          ...ruleEstimateDraft(rule),
          ...generatedBy('weather', sourceId),
        }),
      });
    };

    let rulesChanged = false;
    const nextRules = settings.weatherRules.map(rule => {
      let next = rule;

      const consideredToday = rule.lastFiredDayKey === todayKey;
      applyRule({
        rule,
        dayKey: todayKey,
        hours: todayHours,
        dayConditions: conditions,
        fromHour: nowHour,
        tomorrow: false,
        considered: consideredToday,
        due: dueDate,
      });
      if (!consideredToday) {
        next = { ...next, lastFiredDayKey: todayKey };
        rulesChanged = true;
      }

      // Tomorrow, from the evening on. Its own mark, because this rule has by
      // now answered two different questions and one scalar can only hold the
      // answer to whichever was asked last — see WeatherRule.lastAheadDayKey.
      if (aheadOpen) {
        const consideredAhead = rule.lastAheadDayKey === tomorrowKey;
        applyRule({
          rule,
          dayKey: tomorrowKey,
          hours: tomorrowHours,
          dayConditions: tomorrowConditions,
          // The whole of tomorrow is ahead of you, so its first matching run
          // is the one to name rather than the one after the current hour.
          fromHour: 0,
          tomorrow: true,
          considered: consideredAhead,
          due: getLogicalTomorrow(settings.dayResetTime),
        });
        if (!consideredAhead) {
          next = { ...next, lastAheadDayKey: tomorrowKey };
          rulesChanged = true;
        }
      }

      return next;
    });
    if (rulesChanged) settings.setWeatherRules(nextRules);
  },

  /**
   * The twenty-third generator, and the fourth whose source is a rule the user
   * wrote — see `src/utils/eventTasks.ts`. Structurally it is
   * `checkWeatherTasks` with the calendar in place of the forecast, and it
   * parts company with it on exactly one thing: **the idempotency mark.**
   *
   * A weather rule asks one question a day, so it can carry its own
   * `lastFiredDayKey` and spend it unconditionally before deciding. A rule here
   * is asked about every event in a fourteen-day window at once, so a day key
   * cannot say which of them has been answered. The mark is therefore a record
   * keyed by occurrence (`eventTaskHandled`), written as a task is created, and
   * pruned every sweep to occurrences that have not yet finished. That pruning
   * is what keeps it clear of the growing-record path `generatedTasks.ts` rules
   * out: the objection there is to a *generic* suppression record, which has
   * nothing general to say about when an entry stops mattering. An occurrence
   * that is over is never coming back.
   *
   * It is also why a non-matching pair is deliberately **not** marked. Weather
   * marks "considered and found not to apply" because tomorrow is a different
   * question; here the same event asked again tomorrow is the same question,
   * and an event renamed to match a rule should fire it.
   */
  checkEventTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.eventTasks) return;
    // Same refusal checkCalendarReviewTasks makes, and it carries the same
    // weight: a task written here would persist in the demo database as a
    // claim about the real calendar, long after the demo session ends.
    if (isDemoModeActive()) return;
    // The read half of the calendar feature being off means there is no window
    // to match against — and, more to the point, that the user has said not to
    // read one.
    if (!settings.calendarReadEnabled) return;

    const calendar = useCalendarStore.getState();
    // Not the same question as `events` being empty (see CalendarState.loaded).
    // An unread window must not be read as "nothing is coming up" — the same
    // refusal checkCalendarReviewTasks makes one method above.
    if (!calendar.loaded) return;

    const now = new Date();
    const tasks = get().tasks;
    const activeRuleIds = new Set(settings.eventRules.map(r => r.id));

    // Clear a task whose rule has since been deleted, before deciding what is
    // wanted — the same clear-before-create ordering every generator here uses.
    //
    // **An event vanishing from the window is deliberately not a reason to
    // clear.** It is ambiguous in a way a deleted rule is not: an occurrence
    // leaves the window when it is cancelled *and* when it simply happens, and
    // the second is the ordinary case. Reading it as "cancelled" would delete
    // the task on the morning after the flight it was written for, which is a
    // row the user may well have deferred and is in any case theirs by then.
    liveGeneratedTasksOfKind(tasks, 'eventTask')
      .filter(task => {
        const ruleId = eventTaskRuleIdOf(task);
        return !ruleId || !activeRuleIds.has(ruleId);
      })
      .forEach(task => deleteGeneratedTaskQuietly(task.id));

    const handled = pruneHandledEventTasks(settings.eventTaskHandled, now);
    // Follow-up rules read their own wider window and are refused while it is
    // unread, for `loaded`'s reason: an empty list would read as "no other
    // appointment is booked" and write a task that isn't wanted.
    const followUps = calendar.followUpLoaded
      ? matchedFollowUpTasks(settings.eventRules, calendar.followUpEvents, now, handled)
      : [];
    const matches = [
      ...matchedEventTasks(settings.eventRules, calendar.events, now, handled),
      ...followUps,
    ];
    const followUpSourceIds = new Set(followUps.map(m => m.sourceId));
    // Noon on the logical day, off getCurrentDayStart rather than the clock so
    // a follow-up written at 1 AM under a 2 AM reset belongs to the day the
    // person is still in.
    const followUpDay = getCurrentDayStart();
    followUpDay.setHours(12, 0, 0, 0);
    const followUpDueDate = followUpDay.toISOString();

    // Pruning alone can change the record, so it is written back even when
    // nothing matched — otherwise a finished occurrence's entry survives until
    // the next sweep that happens to write one.
    const nextHandled: HandledEventTasks = { ...handled };

    for (const match of matches) {
      const category = ruleCategoryFor(match.rule, settings.eventTaskCategory);
      reconcileGeneratedTask({
        kind: 'eventTask',
        sourceId: match.sourceId,
        // Never false: the clear pass above already handles "not wanted", and
        // a match that should not fire never reaches this loop.
        wanted: true,
        // The title is the rule's own and does not vary. The *date* could in
        // principle chase the event moving, and deliberately does not: see the
        // #1953 note in docs/arch/generated-tasks.md — a reconcile that
        // re-dates a row from anything but its source silently overwrites the
        // one field the user is most likely to have changed by hand, and
        // deferring one of these is exactly what somebody would do.
        drift: () => null,
        draft: () => ({
          ...taskFieldsFromEvent(match.event, match.rule.leadDays),
          // A follow-up is written after its event, so the event's own day is
          // already behind us; it belongs on the logical today instead.
          ...(followUpSourceIds.has(match.sourceId) ? { dueDate: followUpDueDate } : {}),
          // The rule's title is what the task says; the event's is only what
          // matched it.
          title: match.rule.title,
          category,
          ...ruleEstimateDraft(match.rule),
          ...generatedBy('eventTask', match.sourceId),
        }),
      });
      nextHandled[match.sourceId] = match.endsAt;
    }

    const changed = matches.length > 0
      || Object.keys(nextHandled).length !== Object.keys(settings.eventTaskHandled).length;
    if (changed) settings.setEventTaskHandled(nextHandled);
    // No setLastAction, same reasoning as every other generator's sweep.
  },

  /**
   * Leave-by reminders — see `src/utils/travelTasks.ts`. Structurally
   * `checkEventTasks`, whose occurrence key and handled record it shares, and
   * it departs from it in two places, both because this row has to stay true
   * to something that moves after it is written.
   *
   * **It drifts.** An event task's title is the rule's and never changes, so
   * that sweep has nothing to say to a row it already wrote. This one's title
   * carries the MTA note and its reminder carries the lead, so every handled
   * occurrence that still has a live row is reconciled again. A handled one
   * with *no* live row is skipped: the user deleted it or finished it, and the
   * handled entry is what keeps that answer.
   *
   * **It clears on a change, never on the event happening.** A row is deleted
   * when its event is cancelled, moved or loses its location while still
   * ahead, which is the creation predicate turning false. Once the start has
   * passed, the row is left to the `windowEnd` it carries and the user's own
   * expiry setting; `isTravelTaskStale` has the reasoning, and it is the line
   * `checkEventTasks` draws for the same reason.
   */
  checkTravelTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.travelTasks) return;
    // checkEventTasks' refusal, for its reason: a task written here would sit
    // in the demo database as a claim about the real calendar.
    if (isDemoModeActive()) return;
    if (!settings.calendarReadEnabled) return;
    if (!settings.travelTaskCategory) return;

    const calendar = useCalendarStore.getState();
    // An unread window is not an empty one — and here, reading it as empty
    // would clear every row whose event is still ahead.
    if (!calendar.loaded) return;

    const now = new Date();
    const nowMs = now.getTime();

    liveGeneratedTasksOfKind(get().tasks, 'travel')
      .filter(task => {
        const sourceId = travelSourceOf(task);
        return !sourceId || isTravelTaskStale(sourceId, calendar.events, now);
      })
      .forEach(task => deleteGeneratedTaskQuietly(task.id));

    const handled = pruneHandledEventTasks(settings.travelTaskHandled, now);
    // Through the end of the logical tomorrow, so the evening before is
    // enough to queue a morning reminder. Off getCurrentDayStart rather than
    // the clock: at 1am under a 2am reset, "tomorrow" is still a day away.
    const horizonEnd = addDays(getCurrentDayStart(), 2);
    // Read only while the switch is on, for the transit snapshot's reason
    // below: turning it off puts every reminder back on the typed lead on the
    // next sweep, even if estimates are still held.
    const estimated = settings.travelEstimates
      ? {
          estimates: useTravelTimeStore.getState().estimates,
          mode: settings.travelMode,
          originKeyFor: (eventId: string) => travelOriginKey(travelOriginOfEvent(eventId)),
        }
      : undefined;
    const matches = matchedTravelTasks(
      { defaultMinutes: settings.travelLeadMinutes, byCalendar: settings.travelLeadByCalendar },
      calendar.events, now, horizonEnd, handled, estimated, settings.travelEventPrefs);
    // Read only while the switch is on, so turning it off takes the notes off
    // on the next sweep even if a snapshot is still held.
    const transit = settings.transitAlerts ? useTransitStore.getState().snapshot : null;

    const nextHandled: HandledEventTasks = { ...handled };
    let wroteNew = false;

    for (const match of matches) {
      if (match.handled && !liveGeneratedTask(get().tasks, 'travel', match.sourceId)) continue;

      const leaveMs = Date.parse(match.leaveAt);
      const startMs = Date.parse(match.event.start);
      // Judged over the trip itself, leaving to arriving — see alertOverlaps.
      const note = describeDisruptions(
        journeyDisruptions(transit, settings.transitLines, leaveMs, startMs, nowMs));
      const estimateNote = match.estimate
        ? describeTravelEstimate(match.estimate.minutes, match.estimate.mode)
        : null;
      const title = travelTaskTitle(match.event.title, note, estimateNote);

      reconcileGeneratedTask({
        kind: 'travel',
        sourceId: match.sourceId,
        wanted: true,
        // The title and the reminder follow the feed and the lead. The date is
        // the occurrence's own and never moves (a moved event is a new key),
        // so there is no date to chase and the #1953 rule is not in play.
        drift: existing => {
          const patch: Partial<Task> = {};
          if (existing.title !== title) patch.title = title;
          if (existing.reminderTime !== match.leaveAt) patch.reminderTime = match.leaveAt;
          return Object.keys(patch).length > 0 ? patch : null;
        },
        draft: () => ({
          ...taskFieldsFromEvent(match.event, 0),
          title,
          reminderTime: match.leaveAt,
          // The event's start as the window's close, so the row expires once
          // leaving is no longer possible and the user's expiry setting
          // decides what happens to it then.
          windowEnd: dateToHHMM(new Date(startMs)),
          category: settings.travelTaskCategory,
          ...generatedBy('travel', match.sourceId),
        }),
      });
      if (!match.handled) {
        nextHandled[match.sourceId] = match.endsAt;
        wroteNew = true;
      }
    }

    const changed = wroteNew
      || Object.keys(nextHandled).length !== Object.keys(settings.travelTaskHandled).length;
    if (changed) settings.setTravelTaskHandled(nextHandled);
  },

  /**
   * The fifteenth generator, and the second whose "source" is a rule the user
   * wrote — see `src/utils/screenTimeRules.ts`. Structurally it is
   * `checkWeatherTasks` with the decision taken out: weather reads a forecast
   * and applies the rule itself, whereas here iOS was armed with a threshold
   * and reports having crossed it, so what this walks is the crossings rather
   * than the rules.
   *
   * That inversion is why the idempotency mark can't be spent ahead of the
   * decision the way weather's is (`ScreenTimeRule.lastFiredDayKey`), and why
   * there is no "considered and found not to apply" case to mark: a rule that
   * didn't trip produces no crossing to consider.
   */
  checkScreenTimeTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.screenTimeTasks) return;
    // Same refusal checkWeatherTasks makes, and the more important one here:
    // the crossings this reads are drained destructively from the OS, so
    // acting on them against a database about to be discarded would lose them
    // outright rather than merely writing fiction. useScreenTimeStore's own
    // gate (screenTimeBridge) already refuses to drain in demo mode; this is
    // the second half of the same rule.
    if (isDemoModeActive()) return;

    const todayKey = dayKeyOf(getCurrentDayStart());
    const tasks = get().tasks;
    const activeRuleIds = new Set(settings.screenTimeRules.map(r => r.id));
    // Clear a task whose rule has since been deleted, or whose day has rolled
    // over, before deciding today's — same ordering checkWeatherTasks uses.
    liveGeneratedTasksOfKind(tasks, 'screenTime')
      .filter(task => {
        const parsed = parseScreenTimeSourceId(task.generatedSourceId);
        return !parsed || parsed.dayKey !== todayKey || !activeRuleIds.has(parsed.ruleId);
      })
      .forEach(task => deleteGeneratedTaskQuietly(task.id));

    const crossings = useScreenTimeStore.getState().crossings;
    if (crossings.length === 0) return;

    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);
    const rulesById = new Map(settings.screenTimeRules.map(r => [r.id, r]));

    let rulesChanged = false;
    const fired = new Set<string>();
    const nextRules = [...settings.screenTimeRules];

    for (const crossing of crossings) {
      // A crossing stamped with another logical day is stale — the phone was
      // left open across a boundary, or the monitor was armed before the
      // user moved dayResetTime. It is spent either way rather than held,
      // since the day it belongs to has gone.
      fired.add(crossing.ruleId);
      if (crossing.dayKey !== todayKey) continue;

      const rule = rulesById.get(crossing.ruleId);
      if (!rule || !crossingWantsTask(rule, todayKey)) continue;
      const category = ruleCategoryFor(rule, settings.screenTimeTaskCategory);

      const sourceId = screenTimeSourceId(todayKey, rule.id);
      reconcileGeneratedTask({
        kind: 'screenTime',
        sourceId,
        wanted: true,
        // The title is the rule's own and never varies mid-day.
        drift: () => null,
        draft: () => ({
          title: rule.title,
          dueDate: dueDate.toISOString(),
          category,
          ...ruleEstimateDraft(rule),
          ...generatedBy('screenTime', sourceId),
        }),
      });

      const index = nextRules.findIndex(r => r.id === rule.id);
      if (index !== -1) {
        nextRules[index] = { ...nextRules[index], lastFiredDayKey: todayKey };
        rulesChanged = true;
      }
    }

    if (rulesChanged) settings.setScreenTimeRules(nextRules);
    // Spent whether or not they produced anything — a crossing held back
    // would be re-examined against the same rule and same day for ever.
    if (fired.size > 0) useScreenTimeStore.getState().consume([...fired]);
  },

  /**
   * Health rules — "under six hours of sleep, keep today light".
   *
   * `checkWeatherTasks` one shelf over, because like the forecast the app holds
   * the reading and does the deciding itself. Two things are its own:
   *
   * - **A rule whose hour has not come is skipped without spending its mark.**
   *   Every other day-keyed generator writes the mark ahead of the decision, so
   *   a task swiped away cannot come straight back. That order is unavailable
   *   for a shortfall: "under 3,000 steps" is true at 7am for everybody who is
   *   not out running, and marking the day considered then would mean the rule
   *   could never fire. `ruleCanBeJudgedYet` gates the whole consideration, and
   *   it covers the reading as well as the clock: a sleep rule has no hour to
   *   wait for, so without that half the pass would judge it at 00:05, find the
   *   night hasn't happened yet, and retire the rule until tomorrow.
   * - **It needs the read switched on as well as itself.** A generator that
   *   fires off Health data cannot run while the app is not allowed to read
   *   any, so both switches gate the pass — and the rules sheet says so, rather
   *   than leaving somebody with a toggle that visibly does nothing.
   * - **A ceiling rule (saturated fat) spends its mark the other way round.**
   *   Every other rule here is a floor, so `ruleCanBeJudgedYet` returning true
   *   is the only gate: whatever the reading says once the checkpoint has
   *   passed is final, because more steps or more sodium later only helps.
   *   Saturated fat only gets worse as the day goes on, so an early "still
   *   under" is not a day-long answer — the mark is withheld until the rule
   *   actually matches, and only then does this behave like every other
   *   generator ("considered and it fired" spends the mark for good). See
   *   `ruleCanBeJudgedYet`'s own comment in `healthRules.ts` for the full
   *   argument.
   *
   * Reads whatever snapshot `useHealthStore` already has and never fetches, the
   * split `checkWeatherTasks` draws against `useWeatherStore`: a cold launch
   * before the first read resolves finds nothing to do, and the foreground
   * sweep does the real work.
   */
  checkHealthTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.healthTasks || !settings.healthReadEnabled) return;
    // The third generator gated on this, and the sharpest case of the rule: a
    // reading taken in demo mode is a real person's, and a task written from it
    // would be a claim about their body sitting in a database about to be
    // thrown away. `healthBridge` refuses the read too; this is the other half.
    if (isDemoModeActive()) return;

    const dayStart = getCurrentDayStart();
    const todayKey = dayKeyOf(dayStart);
    const tasks = get().tasks;
    const activeRuleIds = new Set(settings.healthRules.map(r => r.id));
    // Clear a task whose rule has since been deleted, or whose day has rolled
    // over, before deciding today's — the ordering every rule generator uses.
    liveGeneratedTasksOfKind(tasks, 'health')
      .filter(task => {
        const parsed = parseHealthSourceId(task.generatedSourceId);
        return !parsed || parsed.dayKey !== todayKey || !activeRuleIds.has(parsed.ruleId);
      })
      .forEach(task => deleteGeneratedTaskQuietly(task.id));

    const reading = useHealthStore.getState().today;
    // A reading from a day that has already turned over is not an answer about
    // this one. Nothing else stands between that and a rule firing on
    // yesterday's numbers.
    if (!reading || reading.dayKey !== todayKey) return;

    // How far into the *logical* day it is, which is what a shortfall has to be
    // judged against: with a 4am reset, 6pm is fourteen hours in, and reading
    // the wall clock instead would let a step rule fire two hours early for
    // anybody whose day does not start at midnight.
    const hoursIntoDay = (Date.now() - dayStart.getTime()) / (60 * 60 * 1000);

    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    let rulesChanged = false;
    const nextRules = settings.healthRules.map(rule => {
      // Not yet judgeable — the hour hasn't come, or the number hasn't arrived.
      // No task, and, the whole point, no mark either: spending it here is what
      // would silently retire the rule for the rest of the day.
      if (!ruleCanBeJudgedYet(rule, hoursIntoDay, reading)) return rule;
      if (rule.lastFiredDayKey === todayKey) return rule;

      const category = ruleCategoryFor(rule, settings.healthTaskCategory);

      const matched = ruleShortfallToday(rule, reading);
      if (matched) {
        const sourceId = healthSourceId(todayKey, rule.id);
        reconcileGeneratedTask({
          kind: 'health',
          sourceId,
          wanted: true,
          // The title is the rule's own and never varies mid-day; same for the
          // reading behind the note, so nothing here needs drift either.
          drift: () => null,
          draft: () => ({
            title: rule.title,
            notes: healthTaskNote(rule, reading),
            dueDate: dueDate.toISOString(),
            category,
            linkUrl: healthTaskLinkUrl(rule.metric),
            ...ruleEstimateDraft(rule),
            ...generatedBy('health', sourceId),
          }),
        });
      } else if (healthRuleDirection(rule) === 'over') {
        // A ceiling can only get easier to cross as the day goes on — "still
        // under 20g of saturated fat" at 9am says nothing about 6pm the way a
        // floor's "still under 3,000 steps" at 6pm does. Leaving the mark
        // unspent is what lets the next sweep judge it again once more of the
        // day has actually happened, rather than retiring the rule the moment
        // it happens to be checked while still safe.
        return rule;
      }

      // Spent whether or not it matched, the way checkWeatherTasks spends its
      // mark: "considered and did not apply" and "considered and fired" both
      // mean this day has been answered, and without that a task swiped away
      // comes straight back on the next foreground sweep. For an 'under' rule
      // that is true the moment it's judged at all; for an 'over' rule it's
      // only true once matched, which is exactly the branch above this one.
      rulesChanged = true;
      return { ...rule, lastFiredDayKey: todayKey };
    });

    if (rulesChanged) settings.setHealthRules(nextRules);
  },

  /**
   * The mood log's two generators, fired together — see
   * `src/utils/moodTasks.ts` for the rules and the three that keep the second
   * one honest.
   *
   * One pass rather than two because they read the same data and answer in the
   * same breath: the check-in asks "has today been logged", the nudge asks
   * "how have the logged days been going", and splitting them would mean
   * rebuilding the day series twice on every foreground.
   *
   * Both are day-keyed with no source row, the position `calendarReview` is in,
   * so neither has a per-source stamp to decline onto and both use a
   * settings-level mark instead (`moodLogLastDayKey`, `moodNudgeLastDayKey`).
   * `moodLogLastDayKey` holds the check-in's whole sourceId, not just the day —
   * see `moodLogTimeSegments` and `moodLogSourceId` — so it still works as "the
   * slot already decided" once a day can hold more than one.
   */
  checkMoodTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.moodLogTasks && !settings.moodNudgeTasks) return;
    // The mood log is the user's own data and demo mode swaps the database
    // under it, so a demo session's entries are fiction and a task written
    // from them would persist in the demo database as a claim about the real
    // person. Same refusal every other time-triggered generator makes.
    if (isDemoModeActive()) return;

    const todayKey = dayKeyOf(getCurrentDayStart());
    const logs = useMoodStore.getState().logs;
    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    if (settings.moodLogTasks && settings.moodLogTaskCategory) {
      const segments = settings.moodLogTimeSegments;
      // The slot this pass is deciding: the segment the clock is currently
      // in, or null for the any-time task an empty list still means. With
      // segments configured, "before the first one's threshold" is a real
      // third state (see noSlotYet below) — there's no day-one fallback the
      // way the any-time case has.
      const segment = segments.length > 0 ? currentTimeSegment(segments) : null;
      const noSlotYet = segments.length > 0 && segment === null;
      const sourceId = noSlotYet ? null : moodLogSourceId(todayKey, segment);

      // Clear anything not for this exact slot — a previous day's check-in
      // (the original rule), and, once segments are configured, an earlier
      // segment's today, or everything today while nothing has opened yet.
      // At most one check-in is ever live: an earlier segment's unanswered
      // task is a question about a part of the day that's passed, not a task
      // still owed, the same reasoning the day-to-day clear always used.
      liveGeneratedTasksOfKind(get().tasks, 'moodLog')
        .filter(task => moodLogDayKey(task) !== todayKey || task.generatedSourceId !== sourceId)
        .forEach(task => deleteGeneratedTaskQuietly(task.id));

      // Recorded before the "already logged" check below and unconditionally,
      // for the reason calendarReviewLastDayKey is: a slot already decided
      // must not be re-diagnosed on every later sweep, or a check-in swiped
      // away at breakfast comes straight back at lunch. Comparing the whole
      // sourceId rather than just the day is what makes a new segment's
      // arrival reconsider, the same way a new day already did.
      if (sourceId !== null && settings.moodLogLastDayKey !== sourceId) {
        settings.setMoodLogLastDayKey(sourceId);
        // Nothing to ask if this slot is already answered — someone who
        // opened the sheet before the app got round to firing has answered
        // the question, and a task asking it again is the app not listening.
        // The any-time case asks "was the day logged at all"; a segment asks
        // the narrower "was anything logged since this segment began" — an
        // entry from this morning must not silence the evening check-in.
        const answered = segment
          ? hasLoggedSince(logs, timeSegmentThreshold(segment).toISOString())
          : hasLogOnDay(logs, todayKey);
        if (!answered) {
          reconcileGeneratedTask({
            kind: 'moodLog',
            sourceId,
            wanted: true,
            // The title never varies, so nothing to chase.
            drift: () => null,
            draft: () => ({
              title: MOOD_LOG_TITLE,
              dueDate: dueDate.toISOString(),
              // Held back until this segment, if one is chosen — read once,
              // here at creation, so changing the setting shapes the next
              // check-in rather than reaching back to move the one already on
              // today's list. Same rule checkCalendarReviewTasks states for
              // calendarReviewTimeSegment.
              timeSegments: segment ? [segment] : [],
              category: settings.moodLogTaskCategory,
              // The row's link button opens the sheet that answers it. Without
              // this the only thing to do with a check-in is tick it, which
              // completes the task without logging anything — the question
              // marked answered and no answer recorded.
              linkUrl: 'dundundun://mood?log=1',
              ...generatedBy('moodLog', sourceId),
            }),
          });
        }
      }
    }

    if (settings.moodNudgeTasks && settings.moodNudgeTaskCategory) {
      // Built off the mood entries alone — the task half of a MoodDay is not
      // read here, so the tasks argument is deliberately empty rather than the
      // whole store. `lowMoodRun` looks only at `mood`, and handing it every
      // task in the app would rebuild a categories index on every foreground
      // for nothing.
      const days = buildMoodDays(logs, [], settings.dayResetTime);
      if (wantsMoodNudge(days, todayKey, settings.moodNudgeAfterDays, settings.moodNudgeLastDayKey)) {
        // Stamped before the create, like the check-in's mark above: a nudge
        // swiped away must not return on the next foreground of the same bad
        // day, which is the one place in the app where handing the row back
        // would be actively unkind.
        settings.setMoodNudgeLastDayKey(todayKey);
        const run = lowMoodRun(days, todayKey);
        reconcileGeneratedTask({
          kind: 'moodNudge',
          sourceId: todayKey,
          wanted: true,
          drift: () => null,
          draft: () => ({
            title: MOOD_NUDGE_TITLE,
            notes: moodNudgeNotes(run),
            dueDate: dueDate.toISOString(),
            category: settings.moodNudgeTaskCategory,
            ...generatedBy('moodNudge', todayKey),
          }),
        });
      }
    }
    // No setLastAction, same reasoning as the other unattended passes: this is
    // not something the user just did.
  },

  /**
   * `checkMoodTasks`' check-in, twice over: the journal reminder with the same
   * per-segment slots (`journalLogTimeSegments`), and the dream reminder with
   * none. Clear anything not for the current slot, stamp the slot decided, and
   * write a task only if that slot has nothing written yet.
   */
  checkJournalTasks() {
    const settings = useSettingsStore.getState();
    if (!settings.journalLogTasks && !settings.dreamLogTasks) return;
    // A demo session's entries are fiction, the refusal checkMoodTasks makes.
    if (isDemoModeActive()) return;

    const todayKey = dayKeyOf(getCurrentDayStart());
    const entries = useJournalStore.getState().entries;
    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    const run = (
      kind: JournalKind,
      category: string | null,
      segments: readonly TimeOfDay[],
      lastKey: string | null,
      setLastKey: (key: string | null) => void,
      title: string,
    ) => {
      const generatedKind = JOURNAL_TASK_KIND[kind];
      const segment = segments.length > 0 ? currentTimeSegment(segments) : null;
      const noSlotYet = segments.length > 0 && segment === null;
      const sourceId = noSlotYet ? null : journalTaskSourceId(todayKey, segment);
      liveGeneratedTasksOfKind(get().tasks, generatedKind)
        .filter(task => journalTaskDayKey(task, kind) !== todayKey || task.generatedSourceId !== sourceId)
        .forEach(task => deleteGeneratedTaskQuietly(task.id));
      if (sourceId === null || lastKey === sourceId) return;
      // Stamped before deciding, so a swiped-away reminder stays away for its slot.
      setLastKey(sourceId);
      const written = entries.filter(e => e.kind === kind);
      const answered = segment
        ? hasLoggedSince(written, timeSegmentThreshold(segment).toISOString())
        : hasLogOnDay(written, todayKey);
      if (answered) return;
      reconcileGeneratedTask({
        kind: generatedKind,
        sourceId,
        wanted: true,
        drift: () => null,
        draft: () => ({
          title,
          dueDate: dueDate.toISOString(),
          timeSegments: segment ? [segment] : [],
          category,
          // Opens the sheet that answers it, so ticking isn't the only option.
          linkUrl: journalLogUrl(kind),
          ...generatedBy(generatedKind, sourceId),
        }),
      });
    };

    if (settings.journalLogTasks && settings.journalLogTaskCategory) {
      run('journal', settings.journalLogTaskCategory, settings.journalLogTimeSegments,
        settings.journalLogLastDayKey, settings.setJournalLogLastDayKey, JOURNAL_LOG_TITLE);
    }
    if (settings.dreamLogTasks && settings.dreamLogTaskCategory) {
      run('dream', settings.dreamLogTaskCategory, [],
        settings.dreamLogLastDayKey, settings.setDreamLogLastDayKey, DREAM_LOG_TITLE);
    }
  },

  /**
   * The weekend nudge — see `src/utils/weekendTasks.ts` for the five rules the
   * pure half holds, which is where anything about *what* a bare weekend is
   * belongs. This is only the plumbing: read the state, clear what has gone
   * stale, then create at most one row.
   *
   * Clear-then-create, the ordering every generator whose trigger is time
   * passing uses: a nudge whose weekend has arrived, or whose weekend the user
   * has since filled, must go before this decides whether to write another, or
   * the sweep that follows somebody acting on the row would find its own
   * leftover and do nothing.
   */
  checkWeekendNudgeTasks() {
    const settings = useSettingsStore.getState();
    // Work the app invents, and vacation mode is the deliberate "hide work
    // from me" — see GeneratedKindSpec.pausedOnVacation. Skipped without
    // recording anything, so the trigger declined here fires for real the
    // first time the app is opened after vacation ends.
    if (generatorPausedForVacation('weekendNudge', settings.vacationMode)) return;
    if (!settings.weekendNudgeTasks || !settings.weekendNudgeTaskCategory) return;
    // Gated like calendarReview, and for its reason rather than the general
    // one: the busy half of this reading is the *real device calendar*, which
    // demo mode must never read from or expose the existence of. The demo's own
    // example row is seeded directly in demoSeed.ts.
    if (isDemoModeActive()) return;

    const tasks = get().tasks;
    const today = getCurrentDayStart();
    const window = upcomingWeekend(today);

    // One walk for all three days, handed to both readings below so they cannot
    // disagree about what lands on the weekend.
    const buckets = buildDayBuckets(tasks, {
      from: dayKeyToDate(window.fridayKey),
      to: dayKeyToDate(window.sundayKey),
      dayResetTime: settings.dayResetTime,
    });
    const taskById = new Map(tasks.map(t => [t.id, t]));
    const calendar = useCalendarStore.getState();
    const loads = buildDayLoads(
      [dayKeyToDate(window.saturdayKey), dayKeyToDate(window.sundayKey)],
      buckets,
      {
        taskById,
        busyEvents: settings.calendarReadEnabled && calendar.loaded ? calendar.events : [],
        busyWindow: calendar.windowStart && calendar.windowEnd
          ? { start: new Date(calendar.windowStart), end: new Date(calendar.windowEnd) }
          : null,
        dayResetTime: settings.dayResetTime,
        assumedTaskMinutes: assumedMinutesFor(tasks),
      },
    );
    const planTitles = weekendPlanTitles(window, buckets, taskById);
    const bare = isWeekendBare(window, loads, planTitles.length, settings.weekendNudgePlanThreshold);

    // dropGeneratedTask rather than deleteGeneratedTaskQuietly, like
    // projectReview's clear: this is the app tidying up after itself, and
    // stamping an opt-out for it would be reading the app's own housekeeping as
    // the user declining something.
    for (const task of staleWeekendNudgeTasks(tasks, window, bare)) {
      dropGeneratedTask('weekendNudge', weekendNudgeWeekendKey(task));
    }

    // Rule 6: the mood nudge already asked for the same thing, off a more
    // specific signal. Read here rather than from a settings flag because what
    // suppresses is a *live row*, not the generator being switched on — a nudge
    // ticked off this morning stops standing in the way.
    const moodNudgeLive = liveGeneratedTasksOfKind(tasks, 'moodNudge').length > 0;
    if (!wantsWeekendNudge(today, window, bare, settings.weekendNudgeLastWeekendKey, {
      leadDays: settings.weekendNudgeLeadDays,
      moodNudgeLive,
    })) return;
    // Marked before the row is written, the order every day-keyed generator
    // uses: with no source row to stamp a decline onto, this is the only thing
    // standing between a swiped-away nudge and an identical one on the next
    // foreground sweep.
    settings.setWeekendNudgeLastWeekendKey(window.saturdayKey);

    // The nominated project, and the one thing it would have you do. Read
    // through `dripCandidate` rather than by picking a member off the project,
    // so the task quoted here is the same one the pull sheet the row links to
    // will offer first.
    // The first nominated project that has something to offer, in the user's
    // own order; only the first was ever tried, so one with nothing pullable
    // hid the rest.
    const sources = weekendSourceProjects(useProjectStore.getState().projects, getLogicalDayKey(new Date(), settings.dayResetTime));
    const nominated = sources.find(p => nextPullCandidate(p, tasks) !== null) ?? sources[0] ?? null;
    const suggestion = nominated
      ? {
          projectId: nominated.id,
          projectTitle: nominated.title,
          candidateTitle: (() => {
            const next = nextPullCandidate(nominated, tasks);
            return next ? displayTitleFor(next) : null;
          })(),
        }
      : null;

    // Dated to the Friday rather than to today: the row is about the weekend,
    // and a Thursday-dated task saying "make plans for the weekend" is one the
    // user has to move themselves to get it out of Thursday's way.
    const dueDate = dayKeyToDate(window.fridayKey);
    dueDate.setHours(12, 0, 0, 0);

    reconcileGeneratedTask({
      kind: 'weekendNudge',
      sourceId: window.saturdayKey,
      wanted: true,
      drift: () => null,
      draft: () => ({
        title: WEEKEND_NUDGE_TITLE,
        notes: weekendNudgeNotes(planTitles, suggestion),
        dueDate: dueDate.toISOString(),
        category: settings.weekendNudgeTaskCategory,
        linkUrl: weekendNudgeLinkUrl(suggestion?.projectId ?? null, window.saturdayKey),
        ...generatedBy('weekendNudge', window.saturdayKey),
      }),
    });
    // No setLastAction, same reasoning as the other unattended passes: this is
    // not something the user just did.
  },

  /**
   * The `weighIn` generator: a task asking for a weight, when Health hasn't had
   * one for a while.
   *
   * **Its trigger is the absence of data rather than a cadence**, which is the
   * one thing it does differently from `checkMoodTasks` above — see
   * `src/utils/weightTasks.ts` for why. The practical effect: somebody who
   * weighs themselves every morning unprompted never sees this task, because
   * every window it looks at already has a reading in it.
   *
   * **Async, and the only generator pass that is.** Every other one judges a
   * snapshot some foreground effect already took; this one asks HealthKit a
   * question of its own, because the long window `useHealthSync` would have to
   * refresh for it is a six-month query the Weight screen alone should pay for.
   * Nothing is ordered after it, so the maintenance list fires it and moves on.
   */
  async checkWeighInTasks() {
    const settings = useSettingsStore.getState();
    // Work the app invents, and vacation mode is the deliberate "hide work
    // from me" — see GeneratedKindSpec.pausedOnVacation. Being asked to find a
    // set of scales in a hotel is exactly the chore that should stand down.
    if (generatorPausedForVacation('weighIn', settings.vacationMode)) return;
    if (!settings.weighInTasks || !settings.weighInTaskCategory) return;
    // Both Health switches, not just the read: the pass needs the read to know
    // whether to ask, and the answer needs the write to be recordable. A task
    // asking for a weight the sheet would then refuse to save is worse than no
    // task at all.
    if (!settings.healthReadEnabled || !settings.healthWriteEnabled) return;
    // A reading taken in demo mode is a real person's, and a task written from
    // it would be a claim about their logging sitting in a database about to be
    // thrown away. `healthBridge` refuses the read too; this is the other half.
    if (isDemoModeActive()) return;

    const todayKey = dayKeyOf(getCurrentDayStart());
    const dueDate = getCurrentDayStart();
    dueDate.setHours(12, 0, 0, 0);

    // Clear a request from a day that has gone before deciding today's — the
    // clear-first-create-second ordering every day-keyed generator uses. An
    // unanswered request is a question about a window that has moved on, not a
    // task still owed.
    //
    // Dropped rather than deleted quietly: the quiet delete writes the opt-out,
    // which for this kind is the decline stamp below, and a request nobody
    // answered has not been declined.
    liveGeneratedTasksOfKind(get().tasks, 'weighIn')
      .filter(task => weighInDayKey(task) !== todayKey)
      .forEach(task => dropGeneratedTask('weighIn', task.generatedSourceId));

    if (settings.weighInLastDayKey === todayKey) return;

    const everyDays = clampWeighInEveryDays(settings.weighInEveryDays);
    // A deleted request holds for the window from the day it was deleted on,
    // rather than until tomorrow. Checked before the read, which it makes
    // unnecessary, and without spending the mark, which has nothing to say
    // about a day nobody asked about.
    if (weighInDeclineHolds(settings.weighInDeclinedDayKey, todayKey, everyDays)) return;
    const points = await useHealthStore.getState().readRecentWeights(everyDays);
    // **Null is not an empty window.** It means there was no way to ask at all
    // (not iOS, no Health, demo mode), which is evidence of nothing — and
    // unlike a refused read, it is a state the app can actually recognise. So
    // it returns without spending the mark, and the question gets asked again
    // on the next foreground rather than being silently answered "no readings"
    // for the whole day.
    if (points === null) return;

    // Spent only now, once the read has actually happened, and before the
    // window is judged. Before the read would burn the day on a failure;
    // after the decision would let a swiped-away request come straight back on
    // the next foreground, which is what this mark exists to prevent.
    settings.setWeighInLastDayKey(todayKey);
    if (!wantsWeighIn(points)) return;

    reconcileGeneratedTask({
      kind: 'weighIn',
      sourceId: todayKey,
      wanted: true,
      // Title and notes are both derived from the settings alone, and the
      // window they describe cannot change under a live row without the day
      // rolling over and deleting it above. Nothing to chase.
      drift: () => null,
      draft: () => ({
        title: WEIGH_IN_TITLE,
        notes: weighInNotes(everyDays),
        dueDate: dueDate.toISOString(),
        category: settings.weighInTaskCategory,
        // The row's link button opens the sheet that answers it. Without this
        // the only thing to do with the request is tick it, which completes the
        // task and records nothing — and unlike a missed mood entry, the number
        // it was asking for cannot be reconstructed later.
        linkUrl: WEIGH_IN_LINK_URL,
        ...generatedBy('weighIn', todayKey),
      }),
    });
    // No setLastAction, same reasoning as the other unattended passes: this is
    // not something the user just did.
  },

  /**
   * Tick off today's weigh-in request, if there is one, because a weight was
   * just recorded.
   *
   * The counterpart to `completeMoodLogTaskForToday` below and called from the
   * same place in spirit: the sheet that answers the question, on success.
   * Without it, recording a weight leaves the task asking for one still sitting
   * on Today.
   */
  completeWeighInTaskForToday() {
    const todayKey = dayKeyOf(getCurrentDayStart());
    const task = liveGeneratedTasksOfKind(get().tasks, 'weighIn')
      .find(t => weighInDayKey(t) === todayKey);
    if (!task) return;
    get().completeTask(task.id);
  },

  completeJournalTaskForToday(kind) {
    const todayKey = dayKeyOf(getCurrentDayStart());
    const task = liveGeneratedTasksOfKind(get().tasks, JOURNAL_TASK_KIND[kind])
      .find(t => journalTaskDayKey(t, kind) === todayKey);
    if (!task) return;
    get().completeTask(task.id);
  },

  completeMoodLogTaskForToday() {
    const todayKey = dayKeyOf(getCurrentDayStart());
    const task = liveGeneratedTasksOfKind(get().tasks, 'moodLog')
      .find(t => moodLogDayKey(t) === todayKey);
    if (!task) return;
    get().completeTask(task.id);
  },

  skipNextRecurrence(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.recurrenceType === 'none') return;
    // This rolls the row onto its next occurrence *in place* rather than
    // spawning a fresh one, so it's the one other place (besides completeTask
    // and rolloverQuotas) that has to apply a pending "this task only"
    // edit's seriesDefaults revert itself — nothing else ever will for this
    // row. Skipped without it, an occurrence-scoped content edit made just
    // before a task expired (or was marked missed ahead of its day) never
    // gets undone: the row that was supposed to carry it for one occurrence
    // only just keeps rolling forward with it forever.
    const effective: Task = { ...task, ...(task.seriesDefaults ?? {}) };
    const contentReset: Partial<Task> = {};
    for (const key of CONTENT_FIELDS) captureField(contentReset, effective, key);
    // Mirror completeTask's advancesBySchedule split: a mid-chain step never
    // consults the recurrence schedule, so skipping one should only move the
    // chain position — pushing dueDate/recurrenceCount here would burn a full
    // cycle of the recurrence on a step that isn't scheduled at all.
    const { dayResetTime } = useSettingsStore.getState();
    // Same as completeTask's successor: the row stays pinned into its next
    // occurrence only when the task asked for every occurrence to be, so a
    // skip doesn't leave a pin on the block the user already cleared it from.
    const pinReset: Partial<Task> = { pinned: !!task.pinEachOccurrence };
    const chainAdvances = task.chainEnabled && task.chainItems.length > 0;
    const atChainEnd = chainAdvances && task.chainIndex >= task.chainItems.length - 1;
    if (chainAdvances && !atChainEnd) {
      // With per-step scheduling the step being skipped occupies a day of its
      // own, so moving the position isn't enough — the date has to move with
      // it or the next step stays parked on the day the skipped one had.
      // recurrenceCount is left alone in both modes: skipping a step isn't
      // skipping a cycle (same reasoning as completeTask's two flags).
      if (!task.chainStepOnSchedule) {
        get().updateTask(id, { ...contentReset, ...pinReset, chainIndex: task.chainIndex + 1 });
        return;
      }
      const stepDue = getNextDueDate(task, dayResetTime, { catchUp: true });
      if (!stepDue) {
        get().updateTask(id, { ...contentReset, ...pinReset, chainIndex: task.chainIndex + 1 });
        return;
      }
      // Same shape as completeTask's successor: see reminderOnto.
      const stepReminder = reminderOnto(effective, stepDue, contentReset);
      get().updateTask(id, {
        ...contentReset,
        ...pinReset,
        chainIndex: task.chainIndex + 1,
        dueDate: stepDue.toISOString(),
        deferUntil: null,
        ...stepReminder,
        deadline: deadlineOnto(effective, stepDue),
        // Named so updateTask doesn't re-derive it from the date this skip
        // lands on: the app moving a row must never re-anchor the grid, or a
        // task on the 31st skipped through February stays on the 28th.
        recurrenceAnchorDay: task.recurrenceAnchorDay,
        // Same as completeTask's successor: this step is landing on a new
        // day, so it starts that day with no pushes against it yet — the
        // count belongs to the occurrence that was skipped, not the one
        // taking its place.
        postponeCount: 0,
        driftingSince: null,
        bountyPushes: null,
      }, SKIP_POSTPONE);
      return;
    }
    // Same catchUp as completeTask's: skipping an occurrence that's a month
    // overdue means the next one you'll actually do, not the one after the one
    // you already missed. sweepExpiredTasks rolls expired occurrences forward
    // through here, so an app left shut for a week lands them on today rather
    // than on the day after they expired.
    const nextDue = getNextDueDate(task, dayResetTime, { catchUp: true });
    if (!nextDue) return;
    const nextReminder = reminderOnto(effective, nextDue, contentReset);
    const nextChainIndex = chainAdvances ? 0 : task.chainIndex;
    get().updateTask(id, {
      ...contentReset,
      ...pinReset,
      dueDate: nextDue.toISOString(),
      deferUntil: null,
      ...nextReminder,
      // A relative deadline follows the date, as it does on completion; see
      // the chain-step branch above for the anchor day.
      deadline: deadlineOnto(effective, nextDue),
      recurrenceAnchorDay: task.recurrenceAnchorDay,
      chainIndex: nextChainIndex,
      recurrenceCount: task.recurrenceCount !== null ? task.recurrenceCount - 1 : null,
      // Same as completeTask's successor: rolling forward to the next
      // occurrence — whether the user chose to skip it or sweepExpiredTasks
      // rolled it forward unattended — starts a fresh run with no pushes
      // against it yet.
      postponeCount: 0,
      driftingSince: null,
      bountyPushes: null,
    }, SKIP_POSTPONE);
  },

  postBounty(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || !canPostBounty(task)) return 'not-allowed';
    if (liveBountyCount(get().tasks) >= useSettingsStore.getState().bountyLimit) return 'full';
    get().updateTask(id, { bountyPushes: 0 }, SKIP_POSTPONE);
    return 'posted';
  },

  withdrawBounty(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.bountyPushes == null) return;
    get().updateTask(id, { bountyPushes: BOUNTY_WITHDRAWN }, SKIP_POSTPONE);
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
      redo: redoRestoringRows([id]),
    });
  },

  unarchiveTask(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || !task.archived) return;
    // Resuming is lossy — it breaks the streak and drops the archived-on
    // stamp — so the undo restores those exact values rather than re-archiving
    // from scratch, which would stamp today and leave the streak at 0.
    const { archivedAt, streakCount, streakDate, priorBestStreak } = task;
    get().updateTask(id, {
      archived: false,
      archivedAt: null,
      streakCount: 0,
      streakDate: null,
      // The streak restarts, the record does not: the resume alert promises
      // history and stats carry over, and a run you actually completed before
      // filing the task away is history. Folded like any other ending.
      priorBestStreak: nextStreakRecord(task, 0),
    });
    get().setLastAction({
      label: 'Task resumed',
      undo: () => get().updateTask(id, { archived: true, archivedAt, streakCount, streakDate, priorBestStreak }),
      redo: redoRestoringRows([id]),
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
      redo: () => get().setCategoryTimeSegments(category, segments),
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
      // `task` is the row as it stands before the overwrite, which is exactly
      // what applyMeasuredTime needs to keep the guess being replaced.
      ...applyMeasuredTime(minutes, task),
    });
  },

  discardTimer(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.timerStartedAt === null) return;
    cancelTimerAlarm(id);
    get().updateTask(id, { timerStartedAt: null });
  },

  // Paired with scheduleCompletionTimer (src/utils/notifications.ts), which
  // schedules the notification — this is the other half, giving
  // liveActivity.ts a start time to render a live countdown from. The two
  // are separate calls, not one, so the Live Activity can be dismissed
  // (dismissCompletionTimer below) without touching the still-pending
  // notification.
  startCompletionTimer(id) {
    get().updateTask(id, { completionTimerStartedAt: new Date().toISOString() });
  },

  // The Live Activity's own Done button — ends the countdown early. Reminder
  // kept: the notification set up alongside it still fires later, same as
  // dismissing a Timer app activity doesn't cancel the alarm it was counting
  // down to.
  dismissCompletionTimer(id) {
    const task = get().tasks.find(t => t.id === id);
    if (!task || task.completionTimerStartedAt === null) return;
    get().updateTask(id, { completionTimerStartedAt: null });
  },

  // The Done button and the notification tap (notificationTapSync.ts) both
  // dismiss the Live Activity, but either needs the user to actually see and
  // act on one of them — swipe the notification away unread, or never tap
  // the Lock Screen button, and completionTimerStartedAt is never cleared.
  // liveActivity.ts renders the countdown by comparing "now" to a fixed
  // target every time it runs, so a run left undismissed doesn't grow
  // incorrect, it just sits at 0:00 forever with nothing left to trigger a
  // resync — buildTimerRuns only runs off a task/recipe/settings write, not a
  // clock. This is that clock: same shape as sweepExpiredTasks, run at launch
  // and in the background (see catchUpPasses in maintenancePasses.ts) so a
  // countdown nobody acknowledged still clears on its own.
  sweepExpiredCompletionTimers() {
    const now = Date.now();
    const expired = get().tasks.filter(t => {
      if (t.completionTimerStartedAt === null || t.archived) return false;
      const targetEndMs =
        new Date(t.completionTimerStartedAt).getTime() + (t.completionTimerMinutes ?? 0) * 60000;
      return now >= targetEndMs;
    });
    expired.forEach(t => get().dismissCompletionTimer(t.id));
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
    get().updateTask(id, applyMeasuredTime(minutes, task));
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
        redo: redoRestoringRows(snapshots.map(t => t.id)),
      });
    }
  },

  reorderProjectItems(projectId, orderedIds) {
    const tasks = liveProjectSteps(projectId, get().tasks);
    // Every stack this project lists: the ones holding tasks here and the ones
    // homed here with none. Both hold slots in the same number space the tasks
    // use (see TaskGroup.sortOrder), so the two are reordered against each
    // other in one pass rather than in a second space to be kept in step.
    //
    // The stacked tasks in `tasks` are deliberately still in the universe but
    // never named by the caller, which is the point: their sortOrder is their
    // within-stack order, so they're skipped here and keep it, and the slot
    // pool is built from the rows that actually appear in this list.
    const memberGroupIds = new Set(tasks.map(t => t.groupId).filter((id): id is string => !!id));
    const listedGroups = useTaskGroupStore.getState().groups
      .filter(g => g.projectId === projectId || memberGroupIds.has(g.id));
    const updates = slotUpdates([...tasks, ...listedGroups], orderedIds);
    if (updates.length === 0) return;
    const taskIds = new Set(tasks.map(t => t.id));
    const taskUpdates = updates.filter(u => taskIds.has(u.id));
    if (taskUpdates.length > 0) {
      dbBatchUpdateSortOrders(taskUpdates);
      const byId = new Map(taskUpdates.map(u => [u.id, { sortOrder: u.sortOrder }]));
      set(s => ({ tasks: patchTasksById(s.tasks, byId) }));
    }
    for (const update of updates) {
      if (taskIds.has(update.id)) continue;
      useTaskGroupStore.getState().updateGroup(update.id, { sortOrder: update.sortOrder });
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
      recurrenceMonth: null,
      recurrenceWeekOrdinal: null,
      recurrenceAnchorDay: null,
    recurrenceAnchorDate: null,
      recurrenceEndDate: null,
      recurrenceCount: null,
      recurrenceFromCompletion: false,
      supplyCount: null,
      supplyUnit: null,
      supplyRefillCount: null,
      supplyReorderAt: 1,
      supplyLeadDays: null,
      supplyDeclinedAtCount: null,
      supplyGroceryItemId: null,
      tags: [],
      personIds: [],
      category: null,
      sortOrder: maxOrder + 1,
      pinned: false,
      pinnedOrder: 0,
      priority: 0,
      effort: 0,
      estimatedMinutes: null,
      backfillDismissedFields: [],
      streakCount: 0,
      streakDate: null,
      previousStreakCount: 0,
      previousStreakDate: null,
      priorBestStreak: 0,
      showStreak: false,
      streakRequiresWindow: false,
      polarity: 'positive',
      slipCount: 0,
      slipDate: null,
      penaltyMinutes: null,
      penaltyCutoffTime: null,
      penaltyFiredAt: null,
      penaltyCreditedAt: null,
      gatesApps: false,
      medicationName: null,
      medicationAmount: null,
      medicationUnit: null,
      logMealSlot: null,
      estimateBeforeTiming: null,
      parentId,
      groupId: null,
      projectId: null,
      targetCount: null,
      progressCount: 0,
      targetUnit: null,
      allowOvershoot: false,
      quotaIntervalMinutes: null,
      quotaReminders: false,
      quotaStartedAt: null,
      quotaAlwaysVisible: false,
      followWaterTarget: false,
      quotaPeriod: 'day',
      rotationEnabled: false,
      rotationItems: [],
      rotationLog: [],
      rotationPeriodStart: null,
      rotationLastDone: {},
      rotationPlan: null,
      reminderTime: null,
      reminderKind: 'notification',
      reminderOffsetDays: null,
      reminderTracksVisibility: false,
      reminderTimeAnchor: 'wallClock',
      reminderUtcOffsetMinutes: null,
      chainEnabled: false,
      chainIndex: 0,
      chainItems: [],
      chainStepOnSchedule: false,
      followUpTaskEveryN: null,
      followUpTaskTitle: null,
      followUpTaskDraft: null,
      followUpTaskOneAtATime: false,
      followUpTaskAtEnd: false,
      followUpTaskTally: 0,
      previousFollowUpTaskTally: 0,
      followUpTaskSourceTitle: null,
      followUpTaskSourceId: null,
      vacationPause: false,
      excludeFromSuggestions: false,
      pinEachOccurrence: false,
      timerStartedAt: null,
      actualMinutes: null,
      timedMinutes: null,
      timerElapsedSeconds: 0,
      healthMetric: null,
      healthTarget: null, healthFollowGoal: false, completionTimerMinutes: null, completionTimerNote: null, completionTimerStartedAt: null, logHealthMetric: null, logHealthAmount: null,
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
      location: null,
      blockedById: null,
      waitingOnPersonId: null,
      waitingOnPersonSince: null,
      waitingFollowUpDeclinedAt: null,
      deliverableKind: null,
      deliverableValue: null,
      deliverableWhy: null,
      deliverableRevisitIf: null,
      generatedKind: null,
      generatedSourceId: null,
      deadlineOnCalendar: false,
      calendarEventId: null,
      logCompletionToCalendar: false,
      completionCalendarEventId: null,
      timeBlockEventId: null,
      pendingImport: null,
      postponeCount: 0,
      postponeMuted: false,
      driftingSince: null,
      bountyPushes: null,
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
      redo: () => get().deleteSubtask(id),
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
      recurrenceMonth: null,
      recurrenceWeekOrdinal: null,
      recurrenceAnchorDay: null,
    recurrenceAnchorDate: null,
      recurrenceEndDate: null,
      recurrenceCount: null,
      recurrenceFromCompletion: false,
      supplyCount: null,
      supplyUnit: null,
      supplyRefillCount: null,
      supplyReorderAt: 1,
      supplyLeadDays: null,
      supplyDeclinedAtCount: null,
      supplyGroceryItemId: null,
      tags: [],
      personIds: [],
      category: group?.category ?? null,
      sortOrder: maxOrder + 1,
      pinned: false,
      pinnedOrder: 0,
      priority: 0,
      effort: 0,
      estimatedMinutes: null,
      backfillDismissedFields: [],
      streakCount: 0,
      streakDate: null,
      previousStreakCount: 0,
      previousStreakDate: null,
      priorBestStreak: 0,
      showStreak: false,
      streakRequiresWindow: false,
      polarity: 'positive',
      slipCount: 0,
      slipDate: null,
      penaltyMinutes: null,
      penaltyCutoffTime: null,
      penaltyFiredAt: null,
      penaltyCreditedAt: null,
      gatesApps: false,
      medicationName: null,
      medicationAmount: null,
      medicationUnit: null,
      logMealSlot: null,
      estimateBeforeTiming: null,
      parentId: null,
      groupId,
      projectId: null,
      targetCount: null,
      progressCount: 0,
      targetUnit: null,
      allowOvershoot: false,
      quotaIntervalMinutes: null,
      quotaReminders: false,
      quotaStartedAt: null,
      quotaAlwaysVisible: false,
      followWaterTarget: false,
      quotaPeriod: 'day',
      rotationEnabled: false,
      rotationItems: [],
      rotationLog: [],
      rotationPeriodStart: null,
      rotationLastDone: {},
      rotationPlan: null,
      reminderTime: null,
      reminderKind: 'notification',
      reminderOffsetDays: null,
      reminderTracksVisibility: false,
      reminderTimeAnchor: 'wallClock',
      reminderUtcOffsetMinutes: null,
      chainEnabled: false,
      chainIndex: 0,
      chainItems: [],
      chainStepOnSchedule: false,
      followUpTaskEveryN: null,
      followUpTaskTitle: null,
      followUpTaskDraft: null,
      followUpTaskOneAtATime: false,
      followUpTaskAtEnd: false,
      followUpTaskTally: 0,
      previousFollowUpTaskTally: 0,
      followUpTaskSourceTitle: null,
      followUpTaskSourceId: null,
      vacationPause: false,
      excludeFromSuggestions: false,
      pinEachOccurrence: false,
      timerStartedAt: null,
      actualMinutes: null,
      timedMinutes: null,
      timerElapsedSeconds: 0,
      healthMetric: null,
      healthTarget: null, healthFollowGoal: false, completionTimerMinutes: null, completionTimerNote: null, completionTimerStartedAt: null, logHealthMetric: null, logHealthAmount: null,
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
      location: null,
      blockedById: null,
      waitingOnPersonId: null,
      waitingOnPersonSince: null,
      waitingFollowUpDeclinedAt: null,
      deliverableKind: null,
      deliverableValue: null,
      deliverableWhy: null,
      deliverableRevisitIf: null,
      generatedKind: null,
      generatedSourceId: null,
      deadlineOnCalendar: false,
      calendarEventId: null,
      logCompletionToCalendar: false,
      completionCalendarEventId: null,
      timeBlockEventId: null,
      pendingImport: null,
      postponeCount: 0,
      postponeMuted: false,
      driftingSince: null,
      bountyPushes: null,
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
  // files them into it. Not wrapped in a dbTransaction of its own:
  // applyTemplate already calls this from inside one.
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
    const roster = get().groupRosterOf(groupId);
    // The roster names one row per member, and a dated series has several, so
    // cascading over it alone re-files only whichever date spoke for the
    // member. `updateTask`'s default series scope carries `category` (a
    // CONTENT_FIELD) out to the set's *later* dates, which covers most of it —
    // but it reaches nothing earlier, and the roster entry is not always the
    // earliest row. `collapseSeries` ranks a date that is live today ahead of
    // one that isn't, and only falls back to the earliest between two that
    // rank the same; `isRelevantToGroupToday` is `isTaskVisible`, so an
    // *earlier* date that is hidden loses to a later one that isn't. An
    // overdue date is visible and so was never the problem: a **deferred** one
    // is, which bulkSetWhen now makes routine, since pushing a series member
    // out is exactly what it writes. That row kept the old category, leaving a
    // member filed under two at once — the "renders under Home on Today and
    // under Work everywhere else" state the stack-owns-its-members'-category
    // rule exists to prevent, and it bites beyond the name because a Category
    // carries scheduleDays and hideOnVacation too. Each roster entry is
    // expanded back to its live sibling rows, the same way deleteGroup's
    // cascade does and for the same reason. Completed and archived rows stay
    // out: they're history, and the Logbook must keep the category they were
    // finished under.
    const series = new Set(
      roster.map(t => t.seriesId).filter((id): id is string => id != null),
    );
    const members = new Map(roster.map(t => [t.id, t]));
    if (series.size > 0) {
      for (const child of get().groupChildrenOf(groupId)) {
        if (child.seriesId && series.has(child.seriesId) && !child.completed && !child.archived) {
          members.set(child.id, child);
        }
      }
    }

    const changed = [...members.values()].filter(t => t.category !== category);
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
  completeGroup(groupId, options) {
    // Same as uncompleteGroup: the one entry for the batch replaces each
    // child's own, or the stack is left holding a shake per child that undoes
    // nothing once the batch entry has.
    const historyBefore = get().undoStack;
    const children = get().groupRosterOf(groupId);
    const skip = new Set(options?.skipIds ?? []);
    const completedIds: string[] = [];
    // Each child's own undo, which knows what its completion touched (a meal
    // marked cooked, a project it finished) — a bare uncompleteTask doesn't.
    const undos: Array<() => void> = [];
    dbTransaction(() => {
      children.forEach(child => {
        if (child.completed || skip.has(child.id)) return;
        get().completeTask(child.id);
        if (get().tasks.find(t => t.id === child.id)?.completed) {
          completedIds.push(child.id);
          const action = get().lastAction;
          if (action) undos.push(action.undo);
        }
      });
    });
    if (completedIds.length === 0) return;
    get().setLastAction({
      label: `${completedIds.length} task${completedIds.length === 1 ? '' : 's'} completed`,
      redo: () => get().completeGroup(groupId, options),
      undo: () => [...undos].reverse().forEach(fn => fn()),
    }, { replacing: historyBefore });
  },

  uncompleteGroup(groupId) {
    // The stack as it was before the children below register theirs, so the
    // one entry filed for this batch replaces them rather than sitting on top.
    const historyBefore = get().undoStack;
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
      redo: () => get().uncompleteGroup(groupId),
      undo: () => undos.forEach(fn => fn()),
    }, { replacing: historyBefore });
  },

  // Roster-scoped: deferring or pinning a stack must not write to the
  // completed occurrences left behind by its recurring members, which aren't
  // part of the stack any more and would just be silently mutated history.
  deferGroup(groupId, until) {
    const ids = get().groupRosterOf(groupId).filter(c => !c.completed).map(c => c.id);
    if (ids.length === 0) return;
    get().bulkDefer(ids, until);
  },

  // Scoped to today's members, not the whole roster: pinnedTasks() ignores
  // visibility once a task is pinned (see the Pinning note in CLAUDE.md), so
  // pinning a member dated weeks out used to land it in the Pinned block and
  // strand it there. Members not due today keep whatever pinned state they
  // already had, even though the editor still lists them alongside the ones
  // this actually toggles.
  pinGroup(groupId) {
    const ids = get().groupRosterOf(groupId).filter(c => !c.completed && isRelevantToGroupToday(c)).map(c => c.id);
    if (ids.length === 0) return;
    const allPinned = ids.every(id => get().tasks.find(t => t.id === id)?.pinned);
    const nextPinned = !allPinned;
    dbBulkSetPinned(ids, nextPinned);
    set(s => ({ tasks: patchTasks(s.tasks, ids, { pinned: nextPinned }) }));
  },

  deleteGroup(groupId, opts) {
    // The stack as it was before the children below register theirs, so the
    // one entry filed for this batch replaces them rather than sitting on top.
    const historyBefore = get().undoStack;
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
      label: opts.cascade ? 'Stack and its tasks deleted' : 'Stack deleted',
      destructive: true,
      redo: () => get().deleteGroup(groupId, opts),
      undo: () => {
        useTaskGroupStore.getState().restoreGroup(group);
        undos.forEach(fn => fn());
        children.forEach(child => {
          if (!doomed.has(child.id)) get().addExistingToGroup(child.id, groupId);
        });
      },
    }, { replacing: historyBefore });
  },

  // Same one-entry-per-batch rule as bulkDeleteProjects; the ids are filtered
  // to rows that exist first, so a stale id can't leave the previous action's
  // undo in the batch below.
  bulkDeleteGroups(groupIds, opts) {
    // The stack as it was before the children below register theirs, so the
    // one entry filed for this batch replaces them rather than sitting on top.
    const historyBefore = get().undoStack;
    const groupStore = useTaskGroupStore.getState();
    const ids = groupIds.filter(id => groupStore.getGroupById(id) !== null);
    if (ids.length === 0) return;
    const undos: Array<() => void> = [];
    ids.forEach(id => {
      get().deleteGroup(id, opts);
      const action = get().lastAction;
      if (action) undos.push(action.undo);
    });
    get().setLastAction({
      label: `${ids.length} stack${ids.length === 1 ? '' : 's'}${opts.cascade ? ' and their tasks' : ''} deleted`,
      destructive: true,
      redo: () => get().bulkDeleteGroups(groupIds, opts),
      undo: () => undos.forEach(fn => fn()),
    }, { replacing: historyBefore });
  },

  bulkSetGroupCategory(groupIds, category) {
    const groupStore = useTaskGroupStore.getState();
    const groups = groupIds
      .map(id => groupStore.getGroupById(id))
      .filter((g): g is TaskGroup => g !== null && g.category !== category);
    if (groups.length === 0) return;
    const groupUndos = groups.map(g => ({ id: g.id, category: g.category }));
    const taskUndos: Array<{ id: string; category: string | null }> = [];
    groups.forEach(g => {
      groupStore.updateGroup(g.id, { category });
      taskUndos.push(...get().applyGroupCategory(g.id, category));
    });
    const categoryList = useCategoryStore.getState().categories;
    get().setLastAction({
      label: `${groups.length} stack${groups.length === 1 ? '' : 's'} moved to ${category ? categoryLabel(category, categoryList) : 'no category'}`,
      undo: () => {
        groupUndos.forEach(g => groupStore.updateGroup(g.id, { category: g.category }));
        taskUndos.forEach(t => get().updateTask(t.id, { category: t.category }));
      },
    });
  },

  /**
   * Delete a project category and unfile the projects in it, undoably.
   *
   * Far smaller than its task-category counterpart above, and that asymmetry is
   * the model rather than an omission: a project category groups projects on
   * the Projects page and never reaches the tasks inside them (see
   * Project.category), so there are no tasks to re-seen, no stacks to unfile,
   * and no generated-task setting that files *into* it by name. The projects
   * are the whole blast radius.
   */
  deleteProjectCategory(name) {
    const category = useProjectCategoryStore.getState().getCategoryByName(name);
    if (!category) return;
    const filedIds = useProjectStore.getState().projects.filter(p => p.category === name).map(p => p.id);
    useProjectCategoryStore.getState().removeCategoryRow(name);
    useProjectStore.setState(s => ({
      projects: s.projects.map(p => (p.category === name ? { ...p, category: null } : p)),
    }));
    get().setLastAction({
      label: `Category "${name}" deleted`,
      destructive: true,
      redo: () => get().deleteProjectCategory(name),
      undo: () => {
        // The row first, so the projects are re-filed into a category that
        // exists — the picker reads the pool, not the names on the rows.
        useProjectCategoryStore.getState().restoreCategory(category);
        useProjectStore.getState().bulkSetProjectCategory(filedIds, name);
      },
    });
  },

  addExistingToProject(taskId, projectId) {
    // A task created on a project's page is already filed there, and the
    // page calls this for it anyway: skipping the no-op keeps that add to one
    // store write rather than two full re-renders of every screen.
    if (get().tasks.find(t => t.id === taskId)?.projectId === projectId) return;
    get().updateTask(taskId, { projectId });
  },

  removeFromProject(taskId) {
    get().updateTask(taskId, { projectId: null });
  },

  // One entry for the batch, same rule as every other bulk action: each call
  // to updateTask leaves its own, and the queue holds one, so the last task
  // unfiled would be the only one a shake brings back. Each task's *own*
  // previous projectId is snapshotted rather than one shared value — the
  // action is scoped to a project's screen today, but a selection spanning two
  // of them must not all come back into whichever was read first.
  bulkRemoveFromProject(taskIds) {
    const idSet = new Set(taskIds);
    const previous = get().tasks
      .filter(t => idSet.has(t.id) && t.projectId !== null)
      .map(t => ({ id: t.id, projectId: t.projectId }));
    if (previous.length === 0) return;
    dbTransaction(() => {
      previous.forEach(p => get().updateTask(p.id, { projectId: null }));
    });
    get().setLastAction({
      label: `${previous.length} task${previous.length === 1 ? '' : 's'} removed from project`,
      undo: () => previous.forEach(p => get().updateTask(p.id, { projectId: p.projectId })),
    });
  },

  // The same shape as bulkRemoveFromProject, pointed at another project rather
  // than at none: each task's own previous project is what undo restores.
  bulkMoveToProject(taskIds, projectId) {
    const idSet = new Set(taskIds);
    const previous = get().tasks
      .filter(t => idSet.has(t.id) && t.projectId !== projectId)
      .map(t => ({ id: t.id, projectId: t.projectId }));
    if (previous.length === 0) return;
    dbTransaction(() => {
      previous.forEach(p => get().updateTask(p.id, { projectId }));
    });
    const title = useProjectStore.getState().getProjectById(projectId)?.title;
    get().setLastAction({
      label: `${previous.length} task${previous.length === 1 ? '' : 's'} moved${title ? ` to ${title}` : ''}`,
      undo: () => previous.forEach(p => get().updateTask(p.id, { projectId: p.projectId })),
    });
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
    // The stack as it was before the children below register theirs, so the
    // one entry filed for this batch replaces them rather than sitting on top.
    const historyBefore = get().undoStack;
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
      redo: () => get().completeProject(projectId, opts),
      undo: () => {
        useProjectStore.getState().applyProjectCompleted(projectId, false);
        undos.forEach(fn => fn());
      },
    }, { replacing: historyBefore });
  },

  startFreshFromProject(projectId) {
    const source = useProjectStore.getState().getProjectById(projectId);
    if (!source) return null;
    const historyBefore = get().undoStack;
    const blueprint = projectBlueprint(projectId, get().tasks, useTaskGroupStore.getState().groups);
    const projectStore = useProjectStore.getState();
    const created = projectStore.createProject(source.title, { category: source.category, kind: source.kind });
    // The settings the person chose carry over; its dates and its done-ness
    // don't, since those were about the last time.
    projectStore.updateProject(created.id, {
      notes: source.notes,
      defaultTaskCategory: source.defaultTaskCategory,
      taskDefaults: source.taskDefaults ?? null,
      ongoing: source.ongoing,
      nudgeOptIn: source.nudgeOptIn,
      nudgeCadenceDays: source.nudgeCadenceDays,
      autoSchedule: source.autoSchedule,
      weekendSource: source.weekendSource,
      destination: source.destination,
      personIds: source.personIds,
      links: source.links,
      inOrder: source.inOrder,
      showChecked: source.showChecked,
    });

    const sectionFor = new Map<string, string>();
    const checklistSections = new Set(
      useTaskGroupStore.getState().groups.filter(g => g.checklist).map(g => g.id),
    );
    dbTransaction(() => {
      for (const section of blueprint.sections) {
        const copy = useTaskGroupStore.getState().createGroup(section.title, null, created.id);
        if (checklistSections.has(section.id)) useTaskGroupStore.getState().updateGroup(copy.id, { checklist: true });
        sectionFor.set(section.id, copy.id);
      }
      const order: string[] = [];
      const childrenOf = new Map<string, string[]>();
      const copyOf = new Map<string, string>();
      for (const { task, sectionId, subtasks } of blueprint.entries) {
        const groupId = sectionId ? sectionFor.get(sectionId) ?? null : null;
        const copy = get().addTask({
          title: task.title,
          notes: task.notes,
          tags: task.tags,
          category: task.category,
          priority: task.priority,
          effort: task.effort,
          estimatedMinutes: task.estimatedMinutes,
          timeSegments: task.timeSegments,
          recurrenceType: task.recurrenceType,
          recurrenceInterval: task.recurrenceInterval,
          recurrenceDays: task.recurrenceDays,
          recurrenceMonthDay: task.recurrenceMonthDay,
          recurrenceMonth: task.recurrenceMonth,
          recurrenceFromCompletion: task.recurrenceFromCompletion,
          chainEnabled: task.chainEnabled,
          chainItems: task.chainItems,
          // The whole question, not just its kind: a guest's Yes/No/Maybe
          // copied without its options asked in free text and fell out of
          // the tally.
          deliverableKind: task.deliverableKind,
          deliverableOptions: task.deliverableOptions ?? [],
          deliverableSetsAway: task.deliverableSetsAway ?? false,
          windowStart: task.windowStart,
          windowEnd: task.windowEnd,
          linkUrl: task.linkUrl,
          vacationPause: task.vacationPause,
          excludeFromSuggestions: task.excludeFromSuggestions,
          difficulty: task.difficulty ?? null,
          pinEachOccurrence: task.pinEachOccurrence,
          projectId: created.id,
          groupId,
          // Last time's dates belong to last time, so one-offs start undated.
          // A repeating task starts today instead: undated, a project task is
          // on no list, and Pull never offers a routine, so it was stranded.
          dueDate: task.recurrenceType !== 'none' ? getLogicalToday().toISOString() : null,
        }, undefined, { skipTitleRules: true, skipCategoryDefault: true });
        copyOf.set(task.id, copy.id);
        subtasks.forEach(title => get().addSubtask(copy.id, title));
        if (groupId) {
          if (!childrenOf.has(groupId)) { childrenOf.set(groupId, []); order.push(groupId); }
          childrenOf.get(groupId)!.push(copy.id);
        } else {
          order.push(copy.id);
        }
      }
      // What each copy waits on, pointed at the copies: "Send invitations"
      // waits on this year's venue and guest list, not last year's done ones.
      // A blocker outside the project isn't carried, since it was about then.
      for (const { task } of blueprint.entries) {
        const mapped = blockerIdsOf(task).map(id => copyOf.get(id)).filter((id): id is string => !!id);
        if (mapped.length > 0) get().updateTask(copyOf.get(task.id)!, blockerFields(mapped));
        // A branch rides on this copy's own question, which starts unanswered.
        const question = task.answerGate ? copyOf.get(task.answerGate.taskId) : undefined;
        if (question) get().updateTask(copyOf.get(task.id)!, { answerGate: { taskId: question, answers: task.answerGate!.answers } });
      }
      // Sections with nothing in them keep their place at the end.
      for (const id of sectionFor.values()) if (!childrenOf.has(id)) order.push(id);
      get().reorderProjectItems(created.id, order);
      for (const [groupId, ids] of childrenOf) get().reorderGroupChildren(groupId, ids);
    });

    get().setLastAction({
      label: 'Project copied',
      undo: () => {
        get().deleteProject(created.id, { cascade: true });
        // deleteProject unfiles a project's stacks rather than deleting them,
        // which is right for one the person built; these were only ever this
        // copy's, and left behind they were empty stacks with no page.
        for (const id of sectionFor.values()) useTaskGroupStore.getState().removeGroupRow(id);
      },
    }, { replacing: historyBefore });
    return useProjectStore.getState().getProjectById(created.id) ?? created;
  },

  uncompleteProject(projectId) {
    const project = useProjectStore.getState().getProjectById(projectId);
    if (!project || !project.completed) return;
    const completedAt = project.completedAt;
    useProjectStore.getState().applyProjectCompleted(projectId, false);
    get().setLastAction({
      label: 'Project restored to active',
      redo: () => get().uncompleteProject(projectId),
      undo: () => useProjectStore.getState().applyProjectCompleted(projectId, true, completedAt),
    });
  },

  deleteProject(projectId, opts) {
    // The stack as it was before the children below register theirs, so the
    // one entry filed for this batch replaces them rather than sitting on top.
    const historyBefore = get().undoStack;
    const members = get().tasks.filter(t => t.projectId === projectId);
    const project = useProjectStore.getState().getProjectById(projectId);
    // Stacks built inside this project (see TaskGroup.projectId). They're
    // unfiled rather than deleted even on a cascade: the cascade is about the
    // project's *tasks*, and a stack is a label whose members may well sit in
    // other projects too. Unfiled, one keeps whatever members it has and is
    // scoped by them again, exactly like a stack made anywhere else — it's
    // only a memberless one that goes quiet, which is the same nothing it
    // would show if the project were still here and empty. Left pointing at a
    // deleted project it would instead be unreachable from every screen.
    const homedGroups = useTaskGroupStore.getState().groups.filter(g => g.projectId === projectId);
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
    for (const group of homedGroups) {
      useTaskGroupStore.getState().updateGroup(group.id, { projectId: null });
    }
    useProjectStore.getState().removeProjectRow(projectId);
    // Not part of `members`: a review task carries no `projectId` (see
    // projectReviewTasks.ts), so the loop above never touches it and a
    // deleted project's "Review <title>" row was otherwise left sitting on
    // Today until the next foreground sweep. dropGeneratedTask, not
    // deleteGeneratedTaskQuietly: the project row is already gone, so an
    // opt-out write would have nothing to land on anyway, same reasoning
    // checkProjectReviewTasks itself follows. Called before setLastAction
    // below, since dropGeneratedTask clears any pending lastAction.
    dropGeneratedTask('projectReview', projectId);
    if (!project) return;
    get().setLastAction({
      label: opts.cascade ? 'Project and its tasks deleted' : 'Project deleted',
      destructive: true,
      redo: () => get().deleteProject(projectId, opts),
      undo: () => {
        useProjectStore.getState().restoreProject(project);
        for (const group of homedGroups) {
          useTaskGroupStore.getState().updateGroup(group.id, { projectId });
        }
        if (opts.cascade) {
          undos.forEach(fn => fn());
        } else {
          members.forEach(member => get().addExistingToProject(member.id, projectId));
        }
      },
    }, { replacing: historyBefore });
  },

  // Bulk deletes go one project at a time — deleteProject already knows how to
  // unfile or cascade a project's tasks, and half of that logic copied here is
  // how the two drift apart. What can't be reused is the undo: each call leaves
  // its own entry, and the queue holds one, so the last project deleted would
  // be the only one a shake brings back. So each undo is collected and the
  // batch registers a single entry that runs all of them.
  bulkDeleteProjects(projectIds, opts) {
    // The stack as it was before the children below register theirs, so the
    // one entry filed for this batch replaces them rather than sitting on top.
    const historyBefore = get().undoStack;
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
      redo: () => get().bulkDeleteProjects(projectIds, opts),
      undo: () => undos.forEach(fn => fn()),
    }, { replacing: historyBefore });
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
      redo: () => get().deleteTemplate(id),
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
      redo: () => get().bulkDeleteTemplates(ids),
      undo: () => templates.forEach(t => useTemplateStore.getState().restoreTemplate(t)),
    });
  },

  // The rule is `forgiveVacationStreaks` (vacationStreaks.ts), shared with the
  // MCP server's own vacation switch, which cannot load this store.
  forgivVacationStreaks() {
    // isHiddenForVacation, not the per-task flag alone: a task hidden through
    // its category's hide-on-vacation was withheld exactly the same way and
    // lost its streak at the end of every vacation. Both callers run this
    // before switching vacation mode off, which is what the check reads.
    const forgiven = forgiveVacationStreaks(get().tasks, getCurrentDayStart().toISOString(), isHiddenForVacation);
    if (forgiven.length === 0) return;
    forgiven.forEach(t => dbUpdateTask(t));
    const byId = new Map(forgiven.map(t => [t.id, t]));
    set(s => ({ tasks: s.tasks.map(t => byId.get(t.id) ?? t) }));
  },

  // Auto-turns-off vacation mode once its optional end date has passed —
  // call on app start and whenever the app returns to the foreground, since
  // there's no timer running while the app is backgrounded/closed.
  checkVacationExpiry() {
    const { vacationMode, vacationEnd, setVacationMode } = useSettingsStore.getState();
    if (!vacationMode || !vacationEnd) return;
    // Compared as logical days, not instants: a trip's awayEnd is stored at noon
    // of the return day, and the return day isn't away from its own reset on.
    if (getCurrentDayStart() < getTaskDayStart(new Date(vacationEnd))) return;
    get().forgivVacationStreaks();
    setVacationMode(false);
  },

  /**
   * Switch vacation mode on for a trip that has started, and reconcile the end
   * date it should turn itself off on. See docs/arch/away-dates.md.
   *
   * **This is the "on" half only.** `checkVacationExpiry` above already turns
   * vacation off once `vacationEnd` passes, so arming with the trip's return
   * date hands the other half to code that has shipped for years. It also
   * keeps `vacationStart` honest: that stamp is `new Date()` at switch-on, and
   * firing *on* the departure day rather than arming in advance means it still
   * records when you went.
   *
   * Four rules, none of them optional:
   *
   * - **It may only turn off what it turned on** (`vacationDrivenBy`). A mode
   *   somebody switched on by hand is theirs, and the existing `vacationEnd`
   *   is the only thing that may end it.
   * - **Mode off while `vacationDrivenBy` still names a live trip means the
   *   user switched it off**, and that is declined for the whole span rather
   *   than for the day (`Project.awayPauseDeclinedFor`) — a day-scoped opt-out
   *   would re-arm every morning for the rest of the week.
   * - **It reconciles rather than arming once**, since moving the return date
   *   in the editor has to move the date expiry will read.
   * - **Several trips at once need no tie-break.** Vacation mode is a boolean,
   *   so the question is only whether *any* nominated trip covers today.
   */
  checkAwayVacation() {
    const settings = useSettingsStore.getState();
    const { vacationMode, vacationEnd, vacationDrivenBy } = settings;
    const today = getCurrentDayStart();
    const projects = useProjectStore.getState().projects;
    const covers = (p: Project) => isProjectAwayNow(p, today);

    // Turned off by hand since we armed it. Judged on the trip still covering
    // today, so the ordinary case — checkVacationExpiry having just ended a
    // finished trip — is read as the expiry it is rather than as a refusal.
    if (!vacationMode && vacationDrivenBy) {
      const driver = projects.find(p => p.id === vacationDrivenBy);
      const live = driver ? covers(driver) : false;
      if (live && driver?.awayStart) {
        useProjectStore.getState().updateProject(driver.id, {
          awayPauseDeclinedFor: driver.awayStart,
        });
      }
      settings.setVacationDrivenBy(null);
      if (live) return;
    }

    // The same call `isTaskExpired` makes, so the sweep that runs before this
    // pass and this pass itself cannot disagree about whose trip is driving.
    const driver = awayPauseDriver(projects, today);

    if (!driver) {
      // Nothing should be driving. Clear a stale pointer left by an expiry, so
      // the branch above can't read it later as a refusal that never happened.
      if (!vacationMode && vacationDrivenBy) settings.setVacationDrivenBy(null);
      return;
    }

    if (!vacationMode) {
      settings.setVacationMode(true, driver.awayEnd);
      settings.setVacationDrivenBy(driver.id);
      return;
    }
    // Already on. Only a mode this pass owns may have its end date moved —
    // rewriting the end of a vacation somebody set by hand is exactly the
    // "turn off what you turned on" rule, one field over.
    if (vacationDrivenBy === driver.id && vacationEnd !== driver.awayEnd) {
      settings.setVacationEnd(driver.awayEnd);
    }
  },

  resetAllStreaks() {
    const toReset = get().tasks.filter(t => t.streakCount > 0 || t.streakDate !== null);
    if (toReset.length === 0) return;

    // Records go with them, and the undo puts them back. This is the one
    // ending that isn't a run finishing on its own terms — it's "start me over"
    // — and leaving the records behind would mean the next run had to beat an
    // old best before anything showed for it, which is what was just cleared.
    const snapshot = toReset.map(t => ({
      id: t.id, streakCount: t.streakCount, streakDate: t.streakDate, priorBestStreak: t.priorBestStreak,
    }));

    toReset.forEach(t => {
      dbUpdateTask({ ...t, streakCount: 0, streakDate: null, priorBestStreak: 0 });
    });
    set(s => ({
      tasks: s.tasks.map(t =>
        toReset.some(r => r.id === t.id) ? { ...t, streakCount: 0, streakDate: null, priorBestStreak: 0 } : t
      ),
    }));

    get().setLastAction({
      label: 'Streaks reset',
      destructive: true,
      redo: () => get().resetAllStreaks(),
      undo: () => {
        snapshot.forEach(({ id, streakCount, streakDate, priorBestStreak }) => {
          const task = get().tasks.find(t => t.id === id);
          if (!task) return;
          dbUpdateTask({ ...task, streakCount, streakDate, priorBestStreak });
        });
        set(s => ({
          tasks: s.tasks.map(t => {
            const r = snapshot.find(x => x.id === t.id);
            return r ? { ...t, streakCount: r.streakCount, streakDate: r.streakDate, priorBestStreak: r.priorBestStreak } : t;
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
      redo: () => get().bulkCompleteTasks(ids),
      undo: () => completedIds.forEach(id => get().uncompleteTask(id)),
    });
  },

  // Bulk equivalent of markMissed. Same per-task guard applies (recurring or
  // a meal-plan task, and not already completed; a task not yet due rolls
  // forward or is skipped instead of stamping a miss), so a mixed selection
  // just skips whatever doesn't qualify rather than needing its own
  // filtering here.
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
      redo: () => get().bulkMarkMissed(ids),
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
    // The stack as it was before the children below register theirs, so the
    // one entry filed for this batch replaces them rather than sitting on top.
    const historyBefore = get().undoStack;
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
      // Several at once is a list's "Uncheck all", and checking thirty lines
      // back off by hand is what a stray tap there would cost, so the Undo bar
      // offers it. One line is a tap to put back.
      destructive: undos.length > 1,
      redo: () => get().bulkUncompleteTasks(ids),
      undo: () => undos.forEach(u => u()),
    }, { replacing: historyBefore });
  },

  bulkDeleteTasks(ids, opts = {}) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const deleted = get().tasks.filter(t => idSet.has(t.id) || (t.parentId !== null && idSet.has(t.parentId)));
    // Subtasks never carry a generatedKind of their own, but filtering to the
    // requested ids rather than to `deleted` keeps that explicit instead of
    // relying on it.
    const deletedTopLevel = deleted.filter(t => idSet.has(t.id));

    dbBulkDeleteTasks(ids);
    // Only ids that actually had a reminder are worth a native cancel call —
    // see the same predicate in rescheduleAllReminders.
    deleted.forEach(t => {
      if (idSet.has(t.id) && t.reminderTime) cancelTaskReminder(t.id);
      if (idSet.has(t.id) && t.quotaReminders) cancelQuotaNudges(t.id);
      if (idSet.has(t.id) && t.timerStartedAt !== null) cancelTimerAlarm(t.id);
      // What deleteTask does for one row, which this path had skipped: the
      // deadline's event stayed on the device calendar, and a completion
      // timer kept counting down for a task that no longer existed.
      if (idSet.has(t.id)) cancelCompletionTimer(t.id);
      if (idSet.has(t.id) && t.calendarEventId) void deleteDeadlineEvent(deadlineEventLink(t));
    });
    set(s => ({
      tasks: s.tasks.filter(t => !idSet.has(t.id) && (t.parentId === null || !idSet.has(t.parentId))),
    }));

    // See deleteTask's matching call for why this exists at all.
    if (!opts.skipGeneratedOptOut) deletedTopLevel.forEach(t => writeGeneratedOptOut(t, false));

    // An unattended delete (the launch-time expiry sweep) must not sit under
    // the user's first shake of the session waiting to be reversed: they
    // didn't just do it. Same reason purgeOldCompletedTasks bypasses this.
    if (opts.registerUndo === false) return;
    get().setLastAction({
      label: `${ids.length} task${ids.length === 1 ? '' : 's'} deleted`,
      destructive: true,
      redo: () => get().bulkDeleteTasks(ids, opts),
      undo: () => {
        deleted.forEach(t => {
          dbInsertTask(t);
          scheduleTaskReminder(t);
          scheduleQuotaNudges(t);
          // A fresh event, as deleteTask's undo writes: the old one is gone.
          reconcileDeadlineEvent(t);
        });
        set(s => ({ tasks: [...s.tasks, ...deleted] }));
        if (!opts.skipGeneratedOptOut) deletedTopLevel.forEach(t => writeGeneratedOptOut(t, null));
      },
    });
  },

  // Deletes every completed top-level task (and their subtasks) via
  // bulkDeleteTasks, then relabels the undo it already set up — the same
  // snapshot-and-reinsert undo bulkDeleteTasks gives any other bulk delete.
  clearLogbook() {
    // The stack as it was before the children below register theirs, so the
    // one entry filed for this batch replaces them rather than sitting on top.
    const historyBefore = get().undoStack;
    const ids = get().completedTasks().map(t => t.id);
    if (ids.length === 0) return;
    // skipGeneratedOptOut: clearing history is not declining a generator. A
    // completed "Use up spinach" in the logbook is a task that was done, and
    // its row going wrote the item's "never again" exactly as swiping the live
    // task away would have, so clearing the Logbook turned off every use-up
    // reminder whose task had ever been finished.
    get().bulkDeleteTasks(ids, { skipGeneratedOptOut: true });
    const undo = get().lastAction?.undo;
    if (undo) {
      get().setLastAction({
        label: 'Logbook cleared',
        destructive: true,
        undo,
        // The ids it actually cleared, not a second call to this action: a
        // redo re-runs against the logbook as it stands now, and anything
        // completed since the undo is not part of the clear being replayed.
        redo: () => get().bulkDeleteTasks(ids, { skipGeneratedOptOut: true }),
      }, { replacing: historyBefore });
    }
  },

  // A list's checked items are exempt from the retention purge (see
  // retention.ts), so without this they piled up under "Show N checked" for
  // good, and the only way to be rid of them was to select each one. Same
  // shape as clearLogbook: bulkDeleteTasks' undo, relabelled.
  deleteCheckedListItems(projectId) {
    const historyBefore = get().undoStack;
    const ids = get().tasks
      .filter(t => t.projectId === projectId && t.parentId === null && t.completed && !t.archived)
      .map(t => t.id);
    if (ids.length === 0) return;
    get().bulkDeleteTasks(ids);
    const undo = get().lastAction?.undo;
    if (undo) {
      get().setLastAction({
        label: `${ids.length} checked item${ids.length === 1 ? '' : 's'} deleted`,
        destructive: true,
        undo,
        redo: () => get().bulkDeleteTasks(ids),
      }, { replacing: historyBefore });
    }
  },

  bulkSetPriority(ids, priority) {
    if (ids.length === 0) return;
    dbBulkSetPriority(ids, priority);
    set(s => ({ tasks: patchTasks(s.tasks, ids, { priority }) }));
  },

  bulkSetDifficulty(ids, difficulty) {
    if (ids.length === 0) return;
    dbBulkSetDifficulty(ids, difficulty);
    set(s => ({ tasks: patchTasks(s.tasks, ids, { difficulty }) }));
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
    const dayResetTime = useSettingsStore.getState().dayResetTime;
    const snapshots = ids
      .map(id => get().tasks.find(t => t.id === id))
      .filter((t): t is Task => t !== undefined)
      .map(t => ({ ...t }));
    const counts = bulkPostponeCounts(
      get().tasks, ids, { deferUntil }, dayResetTime,
    );
    // Same rule as updateTask's transitionedIntoNew (markSeenOnBecomeVisible),
    // which this path doesn't go through: moving a task onto today right now
    // must not also read as unseen. See the comment there.
    const staleNew = snapshots
      .filter(t => !isTaskNew(t) && isTaskNew({ ...t, deferUntil }))
      .map(t => t.id);
    // Pinning is for today's block specifically — a task actually moving to a
    // different day no longer belongs there (see the row's own reschedule in
    // TaskItem, which does the same check).
    const untilDay = getTaskDayStart(until, dayResetTime).getTime();
    const unpinIds = snapshots
      .filter(t => t.pinned)
      .filter(t => {
        const prev = getEffectiveTaskDate(t, dayResetTime);
        const prevDay = prev ? getTaskDayStart(new Date(prev), dayResetTime).getTime() : null;
        return prevDay !== untilDay;
      })
      .map(t => t.id);
    dbBulkSetDefer(ids, deferUntil);
    if (unpinIds.length > 0) dbBulkSetPinned(unpinIds, false);
    if (counts.size > 0) {
      dbBatchUpdatePostponeCounts([...counts].map(([id, moved]) => ({ id, ...moved })));
    }
    set(s => ({
      tasks: patchTasks(s.tasks, ids, t => ({
        deferUntil,
        ...(unpinIds.includes(t.id) ? { pinned: false } : {}),
        ...(counts.get(t.id) ?? {}),
      })),
    }));
    get().markTasksSeen(staleNew);
    if (snapshots.length > 0) {
      get().setLastAction({
        label: snapshots.length === 1 ? 'Task rescheduled' : `${snapshots.length} tasks rescheduled`,
        redo: () => get().bulkDefer(ids, until),
        undo: () => snapshots.forEach(snapshot => get().updateTask(snapshot.id, snapshot)),
      });
    }
  },

  /**
   * The bulk bar's When, and the same gesture as a row's own date picker: one
   * `WhenPicker`, one `(date, timeSegments)` payload. So it has to make the
   * same decision that picker makes, and it used to write a flat `dueDate` to
   * every selected row instead.
   *
   * That skipped both rules a date-anchored task depends on. Pushing a
   * recurring occurrence out wrote `dueDate` where `scheduleMoveUpdates`
   * writes `deferUntil`, rebasing the whole future grid — move one Tuesday to
   * Thursday from the bulk bar and it was a Thursday task for ever, which is
   * #1953 arriving by the other door. A series member had its hand-picked date
   * silently rewritten, and the next `applyTaskDates` reconcile compares by
   * calendar day, so the moved row read as dropped and was deleted. And going
   * around `updateTask` left `recurrenceAnchorDate` and `recurrenceAnchorDay`
   * untouched, so a monthly task bulk-moved from the 15th to the 3rd came back
   * on the 15th while the row's own picker landed it on the 3rd: two UI paths
   * for one action, giving two different schedules.
   *
   * So each row is re-dated through `updateTask` with the patch
   * `scheduleMoveUpdates` decides for it, exactly as `TaskItem`'s picker does,
   * including folding the unpin into the same patch. The single-statement
   * `dbBulkSetWhen` fast path cannot serve it, because the whole point is that
   * the rows no longer share one patch. `postponeCount`, `driftingSince` and
   * `transitionedIntoNew` are all derived inside `updateTask`, and are more
   * accurate for it: `bulkPostponeCounts` judged every row as a `dueDate` move,
   * which is the wrong question for one being deferred.
   *
   * Wrapped in one transaction, the shape `applyGroupCategory` already uses for
   * a per-row cascade. The selection is whatever a person tapped, so N is small.
   *
   * `restartSchedules` is the answer to confirmScheduleMove: a repeating row
   * pulled forward then counts its schedule from the new date rather than
   * keeping its grid (see pullForwardChoice). `scope: 'occurrence'` is the
   * answer to confirmSegmentScope: the new time of day stays on these rows and
   * the repeats after them keep the old one.
   */
  bulkSetWhen(ids, date, timeSegments, options) {
    if (ids.length === 0) return;
    const dayResetTime = useSettingsStore.getState().dayResetTime;
    const snapshots = ids
      .map(id => get().tasks.find(t => t.id === id))
      .filter((t): t is Task => t !== undefined)
      .map(t => ({ ...t }));
    // Same reasoning as bulkDefer above: moving a pinned task to a different
    // day (or clearing its date entirely) drops the pin. Compared against the
    // effective date, not the stored one, so a pinned recurring task's anchor
    // doesn't read as "unchanged" when the visible day actually moved.
    const newDay = date ? getTaskDayStart(date, dayResetTime).getTime() : null;
    dbTransaction(() => {
      snapshots.forEach(snapshot => {
        const prev = getEffectiveTaskDate(snapshot, dayResetTime);
        const prevDay = prev ? getTaskDayStart(new Date(prev), dayResetTime).getTime() : null;
        const moved = snapshot.pinned && prevDay !== newDay;
        get().updateTask(
          snapshot.id,
          {
            ...scheduleMoveUpdates(snapshot, date, dayResetTime, { restartSchedule: options?.restartSchedules }),
            timeSegments,
            ...(moved ? { pinned: false } : {}),
          },
          // The user picked this date a moment ago, so a task pulled onto today
          // by it must not come back reading as unseen. Opt-in because the
          // engine writers of these same fields want the opposite (see
          // transitionedIntoNew); the row's own picker makes the same claim for
          // the same reason, and this is the same gesture.
          { markSeenOnBecomeVisible: true, ...(options?.scope === 'occurrence' ? { scope: 'occurrence' as const } : {}) },
        );
      });
    });
    if (snapshots.length > 0) {
      get().setLastAction({
        label: snapshots.length === 1 ? 'Task rescheduled' : `${snapshots.length} tasks rescheduled`,
        redo: () => get().bulkSetWhen(ids, date, timeSegments, options),
        undo: () => snapshots.forEach(snapshot => get().updateTask(snapshot.id, snapshot)),
      });
    }
  },

  bulkSetCategory(ids, category) {
    if (ids.length === 0) return;
    // Same rule as updateTask's transitionedIntoNew, which this path doesn't
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
    // Keyed on whichever wait holds the task, so equal keys arrive adjacent and
    // the screen only has to break the runs apart. The blocker task wins when
    // both are set, matching how the screen files it.
    // With several blockers, the first one still open is the one it's filed under.
    const waitKey = (t: Task) => blockerOf(t, resolveBlocker)?.id ?? blockerIdsOf(t)[0] ?? t.waitingOnPersonId ?? '';
    return get().tasks
      .filter(isWaitingTask)
      .sort((a, b) => waitKey(a).localeCompare(waitKey(b)) || a.sortOrder - b.sortOrder);
  },

  // Reads the user's own threshold rather than a constant of its own: the
  // screen and the date picker's prompt have to agree about what "keeps getting
  // pushed" means, or a task can be listed here while the picker stays silent
  // about it.
  //
  // Returns the raw, sorted Task[] — stable references StuckScreen can select
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
    const { tasks, completionHoldIds } = get();
    return withHeldCompletions(tasks, completionHoldIds)
      // Pinning overrides the *clock* — a pinned task shows here whether or not
      // it is due today, which is the whole feature. It does not override the
      // one hide that isn't a clock: isVisibleApartFromVacation puts isHeldBack
      // ahead of every time gate on purpose, "being blocked isn't a 'not yet'
      // that a clock resolves". This filter is written out by hand rather than
      // reusing that rule, so the two non-clock hides it already honours
      // (archived, vacation) were right and this one leaked — a task waiting on
      // another task, or on a person, sat at the top of Today with nothing the
      // user could do about it while its own ordinary row had correctly left.
      // It comes back the moment the blocker clears, exactly as that row does.
      // A paused project's task is the other non-clock hide: the pause is the
      // person saying "not until then", which pinning doesn't answer.
      .filter(t => !t.parentId && t.pinned && !t.completed && !t.archived
        && !isHeldBack(t) && !isWithheld(t))
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

    // Same rule as updateTask's transitionedIntoNew: losing a category the
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

    // Settings that *place* something rather than describe it have to let go,
    // which is the opposite call to the template one above and for a concrete
    // reason: a template item naming a dead category is a stale reference
    // nobody acts on, while these would be re-*created* from. Events, cook
    // tasks and use-up tasks all file under their category by name, so a
    // setting still naming this one would draw a header for a section the
    // user just deleted — and a collapse remembered for it would fold
    // whatever category later takes the name. All are restored by the undo
    // below.
    const settings = useSettingsStore.getState();
    const hadEventCategory = settings.calendarEventCategory === name;
    const hadCollapsed = settings.collapsedCategories.includes(name);
    if (hadEventCategory) settings.setCalendarEventCategory(null);
    // Every generator's category, not a hand-kept few: a setting left naming
    // this category files the next generated task under a name nothing has.
    const clearedKinds = clearGeneratedCategorySettings(name, null);
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
        clearedKinds.forEach(kind => setGeneratedCategory(kind, name));
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
    // category itself was renamed in SQL by the category store. The two JSON
    // columns that can also carry a name (a series' shared defaults, a
    // follow-up's draft) are rewritten here and written back row by row.
    const jsonRenamed: Task[] = [];
    set(s => ({
      tasks: s.tasks.map(t => {
        const seriesDefaults = renameInSeriesDefaults(t.seriesDefaults, name, trimmed);
        const followUpTaskDraft = renameInFollowUpDraft(t.followUpTaskDraft, name, trimmed);
        const category = t.category === name ? trimmed : t.category;
        if (category === t.category && seriesDefaults === t.seriesDefaults && followUpTaskDraft === t.followUpTaskDraft) {
          return t;
        }
        const next = { ...t, category, seriesDefaults, followUpTaskDraft };
        if (seriesDefaults !== t.seriesDefaults || followUpTaskDraft !== t.followUpTaskDraft) jsonRenamed.push(next);
        return next;
      }),
    }));
    for (const t of jsonRenamed) dbUpdateTask(t);
    useProjectStore.setState(s => ({
      projects: s.projects.map(p =>
        p.defaultTaskCategory === name ? { ...p, defaultTaskCategory: trimmed } : p),
    }));
    const views = useSavedViewStore.getState();
    for (const v of views.views) {
      const clauses = renameInViewClauses(v.clauses, name, trimmed);
      if (clauses !== v.clauses) views.updateView(v.id, { clauses });
    }
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
    renameGeneratedCategorySettings(name, trimmed);
    const settings = useSettingsStore.getState();
    if (settings.calendarEventCategory === name) settings.setCalendarEventCategory(trimmed);
    if (settings.healthCategory === name) settings.setHealthCategory(trimmed);
    if (settings.newTaskDefaults.category === name) settings.setNewTaskDefaults({ category: trimmed });
    const titleRules = renameInTitleRules(settings.titleRules, name, trimmed);
    if (titleRules !== settings.titleRules) settings.setTitleRules(titleRules);
    const weatherRules = renameInRuleCategories(settings.weatherRules, name, trimmed);
    if (weatherRules !== settings.weatherRules) settings.setWeatherRules(weatherRules);
    const screenTimeRules = renameInRuleCategories(settings.screenTimeRules, name, trimmed);
    if (screenTimeRules !== settings.screenTimeRules) settings.setScreenTimeRules(screenTimeRules);
    const healthRules = renameInRuleCategories(settings.healthRules, name, trimmed);
    if (healthRules !== settings.healthRules) settings.setHealthRules(healthRules);
    const eventRules = renameInRuleCategories(settings.eventRules, name, trimmed);
    if (eventRules !== settings.eventRules) settings.setEventRules(eventRules);
    const captures = renameInReminderCaptures(settings.reminderCaptures, name, trimmed);
    if (captures !== settings.reminderCaptures) settings.setReminderCaptures(captures);
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
registerPersonTaskSource(() => useTaskStore.getState().tasks);
