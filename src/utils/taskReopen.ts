/**
 * The row a completed or missed task becomes when it is reopened.
 *
 * Lifted out of `useTaskStore.uncompleteTask` unchanged, for the reason
 * `taskCompletion.ts` was lifted out of `completeTask`: the MCP server reopens
 * tasks from a Node process where the store cannot be imported. Only the row is
 * here. Taking back the coins, the dose, the successor and every device effect
 * stays with the caller, since each of those lives in a store or on the phone.
 */
import type { Task } from '../types';
import { isMissed, isQuotaTask } from './visibilityUtils';

export function reopenedTask(task: Task): Task {
  return {
    ...task,
    completed: false,
    completedAt: null,
    // Re-opening a missed occurrence puts it back on the board as ordinary
    // outstanding work — the whole point of undoing a miss. Nothing else is
    // needed to restore the streak it broke: the snapshot below covers it,
    // exactly as it covers an undone completion.
    missedAt: null,
    doneByOtherAt: null,
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
    // again immediately. The follow-up task itself is deleted by the caller, as
    // an uncompleted row pointing back at this one.
    followUpTaskTally: task.previousFollowUpTaskTally,
    // Un-completing means the completion the event logged didn't actually
    // happen, so there's nothing left for it to record.
    completionCalendarEventId: null,
    completionCalendarEventExternalId: null,
    // The completion timer this task's own completion may have started no
    // longer means anything once that completion is undone.
    completionTimerStartedAt: null,
    // The credit goes back with the completion that earned it, so the row is
    // creditable again when it's actually done.
    penaltyCreditedAt: null,
  };
}
