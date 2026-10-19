import type { Task } from '../types';
import { isQuotaTask, isRecurrenceNotYetDue } from './visibilityUtils';
import { asksOnCompletion } from './deliverables';
import { activeMealSlotStepId, completesMealSlot, mealSlotOf } from './mealSlotTasks';
import { mealLogNudgeEntryId } from './mealLogNudgeTasks';
import { isRotationTask } from './rotation';
import { isNegativeTask } from './negativeHabits';
import { projectReviewProjectId } from './projectReviewTasks';
import { isAnsweredByRecord } from './recordTasks';
import { offersBlockStart } from './blockOfferTasks';

/**
 * What a tap on a task's checkbox should do, for the surfaces that show a
 * task's completion state without being the task row itself — Search, and the
 * quick-search palette.
 *
 * TaskItem doesn't use this: its own tap handler is tangled up with the
 * completion animation, the pace send-off and the hold window, none of which
 * these surfaces have. But the *decision* — tick, ask first, log one unit,
 * refuse — is the same one, and it was the part that got copied wrong when a
 * second surface wanted it, so it lives here with tests rather than being
 * re-derived from `task.targetCount` at each call site.
 */
export type CompletionTap =
  /** Ordinary tick: complete it. */
  | 'complete'
  /** A decision task (see Task.deliverableKind) — ask for the answer first. */
  | 'ask'
  /** A meal-slot task's own "Choose <meal>" step — open the meal picker, not the checkmark. */
  | 'pick-meal'
  /** A quiet project's review task — open the pull sheet, not the checkmark. */
  | 'review-project'
  /** A block offer (see blockOfferTasks.ts) whose block has not run: the tap offers to start the block, since a tick before it ran would pay for nothing. */
  | 'start-block'
  /** A task a record answers (mood, journal, dream, weigh-in) with no entry yet — open its sheet. Once the entry exists the tap is an ordinary 'complete'. */
  | 'open-log'
  /** A rotation (see utils/rotation.ts) — ask which member was done, then log that. */
  | 'pick'
  /** A daily target below its count: this tap logs one unit, not the lot. */
  | 'log-unit'
  /** Already done: put it back on the list. */
  | 'uncomplete'
  /** A negative habit: this tap reports a slip, it doesn't complete anything. */
  | 'slip'
  /** A recurring task whose day hasn't come round yet; it can't be ticked early. */
  | 'locked';

/**
 * Order matters here, and each step is load-bearing:
 *
 * - `completed` first, because `isQuotaTask` is a shape test (targetCount > 1)
 *   and stays true for a finished target — asked later it would offer to log a
 *   ninth glass onto a task that closed out yesterday.
 * - `locked` before anything that writes, so a recurring task showing early in
 *   a search result can't be completed ahead of its day. Same gate TaskItem's
 *   box uses (`completionLocked`). Being *blocked* by another task is
 *   deliberately not a lock: TaskItem lets a blocked task be ticked too, and
 *   search is one of the two places a blocked task is even listed.
 * - `log-unit` before `ask`, so the unit that *meets* the target still gets the
 *   question a decision task is owed. Below the target there's nothing to ask
 *   about: the task isn't finishing.
 * - `allowOvershoot` never auto-completes at the target — logging past it just
 *   keeps counting, and the rollover sweep closes the task out (see
 *   sweepOvershootQuotas).
 * - `slip` sits above everything but `uncomplete`, because polarity decides
 *   what a tap *means* before any of the questions below it are worth asking.
 *   It is deliberately not below `locked`: a negative habit is never "not due
 *   yet" — it applies every day — so there is nothing for that gate to refuse.
 */
export function completionTapFor(task: Task, recordReady = false): CompletionTap {
  if (task.completed) return 'uncomplete';
  if (isNegativeTask(task)) return 'slip';
  // Above every question below: the app knows from the saved entry whether
  // this was done, so a tap can't say so before there is one (see recordTasks.ts).
  // `recordReady` is the caller's `useRecordTaskReady`; a caller with no way to
  // read it leaves it false and the tap opens the sheet, which is always safe.
  if (isAnsweredByRecord(task) && !recordReady) return 'open-log';
  if (offersBlockStart(task)) return 'start-block';
  if (isRecurrenceNotYetDue(task)) return 'locked';
  // Ahead of the quota branch because it is the more specific claim about the
  // same tap: a rotation *is* a quota, so that branch would answer 'log-unit'
  // and log an anonymous unit against a set whose whole point is that the
  // units have names. Unlike the quota's own split, this applies at every
  // count including the last — the pick that closes the week still has to say
  // which member closed it.
  if (isRotationTask(task) && isQuotaTask(task)) return 'pick';
  if (isQuotaTask(task)) {
    const reachesTarget = !task.allowOvershoot && task.progressCount + 1 >= task.targetCount!;
    if (!reachesTarget) return 'log-unit';
  }
  // Same reasoning as `ask`, checked first: this step isn't answered by
  // ticking it, it's answered by putting something in the slot — see
  // mealSlotChain in mealSlotTasks.ts.
  // A ready row has nothing left to choose (the meal was logged or cooked), so
  // its tap is the ordinary tick the green ring is offering.
  if (!task.generatedReadyAt && activeMealSlotStepId(task)?.endsWith('-choose')) return 'pick-meal';
  if (projectReviewProjectId(task)) return 'review-project';
  if (asksOnCompletion(task)) return 'ask';
  return 'complete';
}

/**
 * Whether completing this task raises `offerMealLog`'s "what did you eat?"
 * prompt afterward — the meal-slot chain's own last step ("Eat <dish>"), or a
 * `mealLogNudge` task asking about a meal from a previous day (see
 * `offerMealLog` in `useTaskStore.ts`). Unlike every `CompletionTap` value
 * above, the tap still completes the task normally; this only says a sheet
 * follows it, which is why it's a separate boolean rather than another
 * `CompletionTap` case.
 *
 * Approximated off the task's own fields and the settings flag alone — the
 * per-meal "don't ask" opt-out (`MealPlanEntry.logMeal`) is only known once
 * `offerMealLog` reads the meal plan entry at completion time, which a list
 * row can't repeat on every render. So a meal already told not to ask can
 * still show this, on the rare meal declined individually rather than through
 * the settings switch.
 *
 * `task.logMealSlot` (a reminder capture filed as a meal — see
 * `docs/arch/reminders-import.md`) is checked ahead of the setting rather than
 * folded into it: `completeTask` raises the same manual-entry sheet for it
 * unconditionally, with no `mealLogPrompt` gate, so gating the icon on that
 * setting would show a plain checkbox for a task that pops the sheet anyway.
 */
export function offersMealLogOnCompletion(task: Task, mealLogPromptEnabled: boolean): boolean {
  if (task.completed) return false;
  // A named food is logged by the tick itself, so no sheet follows it.
  if (task.logMealSlot && !task.logSavedMealId) return true;
  if (!mealLogPromptEnabled) return false;
  return (mealSlotOf(task) !== null && completesMealSlot(task)) || mealLogNudgeEntryId(task) !== null;
}

/** How long after a target completes that a tap on its box is read as a stray one. */
export const TARGET_FINISH_TAP_GUARD_MS = 1500;

/**
 * True when a tap on a completed target's box lands so soon after the unit that
 * finished it that it is almost certainly the next tap of the same burst.
 *
 * The box is one control with two meanings: on an open target it logs a unit,
 * on a completed one it un-completes. The unit that reaches the target flips it
 * from the first to the second, so a quick extra tap on Search or the palette
 * (which hold the row in place) took the finished day straight back to
 * target - 1 with an empty box and nothing to say why. Judged off
 * `completedAt` rather than component state so a remounted row is guarded too.
 */
export function isStrayTapOnFinishedTarget(task: Task, now: number): boolean {
  if (!task.completed || !task.completedAt || !isQuotaTask(task)) return false;
  const elapsed = now - new Date(task.completedAt).getTime();
  return elapsed >= 0 && elapsed < TARGET_FINISH_TAP_GUARD_MS;
}
