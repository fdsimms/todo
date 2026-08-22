import type { Task } from '../types';
import { computeSnoozeSuggestion } from './snoozeEngine';
import { estimatedMinutesFor } from './effort';
import { getLogicalTomorrow } from './dateUtils';
import type { BusyEvent } from './calendarBusy';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  SOFT_DELOAD_BLOCKERS,
  deloadBlockerFor,
  isDateAnchored,
  wouldMissDeadline,
  type DeloadBlocker,
} from './taskMoves';

// Re-exported so the sheet and the tests keep one import for the whole
// feature; the rules themselves live in the leaf, see its own note.
export { deloadUpdates, type DeloadBlocker } from './taskMoves';

/**
 * "Lighten this day" — takes the tasks currently sitting on Today and proposes
 * a destination day for the ones that can move, so a busy day can be thinned
 * out in one pass.
 *
 * Deliberately a *proposal*: every entry carries its destination, its reason,
 * and whether it's checked by default, and the caller commits only what the
 * user approves. The previous take on this (see #356) picked tasks with an AI
 * call and moved them to tomorrow on one tap, which both relocated the load
 * rather than spreading it and gave the user nothing to inspect beforehand.
 * Destinations here come from computeSnoozeSuggestion — the same engine behind
 * the date picker's Suggest button — so each task lands on its own best day and
 * the vocabulary matches what Suggest already says. Every row also carries plain
 * tomorrow, because "not today, deal with it tomorrow" is the move people
 * actually want half the time and spreading the day out is the other half.
 */

/** Where a task could go, in one of the sheet's two destination modes. */
export interface DeloadDestination {
  date: Date;
  /** "Thursday", "Tomorrow". */
  dayLabel: string;
  /** "light day", "good for \"email\"" — from the snooze engine; null for plain tomorrow. */
  reason: string | null;
}

export interface DeloadProposal {
  task: Task;
  /** Minutes this task is holding on today's total. */
  minutes: number;
  /** The engine's pick, or null when the task can't move there (or at all). */
  suggested: DeloadDestination | null;
  /**
   * Tomorrow, offered alongside the pick so the whole day can be pushed one
   * day out in a tap — the thing people actually reach for on a day that got
   * away from them. Null on the same terms as `suggested`: a hard blocker, or
   * a deadline that even tomorrow would miss.
   */
  tomorrow: DeloadDestination | null;
  /**
   * How the move should be applied. Recurring tasks and series members defer
   * (dueDate untouched) — a recurrence has a grid that getNextDueDate anchors
   * to, and a series date was hand-picked, so neither should be overwritten by
   * a bulk sweep. A plain one-off reschedules outright, since there's nothing
   * to protect and a stale dueDate would read as overdue on arrival.
   */
  mode: 'defer' | 'reschedule';
  /** Checked by default in the sheet, in its default (suggested) mode. */
  selected: boolean;
  blocker: DeloadBlocker | null;
  /** One-line explanation shown in place of the destination, e.g. "12-day streak". */
  blockerLabel: string | null;
}

export interface DeloadPlan {
  proposals: DeloadProposal[];
  /** Estimated minutes on the day as it stands. */
  currentMinutes: number;
  /** What that becomes if every pre-checked proposal is applied. */
  projectedMinutes: number;
}

// The same read sumEstimatedMinutes uses, so the sheet's "5.5h → 3.0h"
// reconciles with the Today header's "5.5h planned today" — including mid-chain,
// where it resolves to the active step's own estimate rather than the whole
// chain's. (Note a timed task's timedMinutes isn't part of that sum on either
// side — a pre-existing gap in the workload readout, not one to close from in
// here.)
function taskMinutes(t: Task): number {
  return estimatedMinutesFor(t) ?? 0;
}

/**
 * Builds the plan for a day.
 *
 * `todaysTasks` is what's on the day being lightened (TodayScreen's visible
 * list); `allTasks` is the full store, needed by the snooze engine to score
 * candidate days by their existing load.
 */
export function buildDeloadPlan(
  todaysTasks: readonly Task[],
  allTasks: readonly Task[],
  dayResetTime?: string,
  // Forwarded straight to computeSnoozeSuggestion — see its own doc comment.
  // Omitted (not just empty) is the caller saying "don't factor calendar in".
  busyEvents?: readonly BusyEvent[],
): DeloadPlan {
  const resetTime = dayResetTime ?? useSettingsStore.getState().dayResetTime;
  const movable = todaysTasks.filter(t => !t.parentId && !t.completed && !t.archived);

  // Biggest first, so the top row recovers the most time. Ties keep list order.
  const ordered = [...movable]
    .map((task, index) => ({ task, index, minutes: taskMinutes(task) }))
    .sort((a, b) => b.minutes - a.minutes || a.index - b.index);

  // Each accepted destination is fed back in before scoring the next task —
  // otherwise every task is scored against the same untouched day loads and
  // they all pick the same "lightest" day, landing the whole sweep on one date.
  let working: Task[] = [...allTasks];

  const tomorrowDate = getLogicalTomorrow(resetTime);
  tomorrowDate.setHours(12, 0, 0, 0);

  const proposals: DeloadProposal[] = ordered.map(({ task, minutes }) => {
    const found = deloadBlockerFor(task);
    const hardBlocked = found !== null && !SOFT_DELOAD_BLOCKERS.has(found.blocker);
    const mode: 'defer' | 'reschedule' = isDateAnchored(task) ? 'defer' : 'reschedule';

    if (hardBlocked) {
      return {
        task,
        minutes,
        suggested: null,
        tomorrow: null,
        mode,
        selected: false,
        blocker: found!.blocker,
        blockerLabel: found!.label,
      };
    }

    // Tomorrow is the nearest any destination gets, so a deadline it misses is
    // one nothing can satisfy — that's the whole task blocked, not one option.
    if (wouldMissDeadline(task, tomorrowDate, resetTime)) {
      return {
        task,
        minutes,
        suggested: null,
        tomorrow: null,
        mode,
        selected: false,
        blocker: 'deadline',
        blockerLabel: 'Deadline too close',
      };
    }

    const tomorrow: DeloadDestination = { date: tomorrowDate, dayLabel: 'Tomorrow', reason: null };
    const pick = computeSnoozeSuggestion(task, working, busyEvents ?? []);
    // A pick past the deadline drops only that option — tomorrow still stands,
    // and the sheet lists the row under whichever mode can take it.
    const suggested: DeloadDestination | null = wouldMissDeadline(task, pick.date, resetTime)
      ? null
      : { date: pick.date, dayLabel: pick.dayLabel, reason: pick.reason };

    // Only a proposal the user is likely to accept should occupy its
    // destination day for the tasks scored after it.
    const selected = found === null && suggested !== null;
    if (selected) {
      const iso = suggested!.date.toISOString();
      const moved: Task =
        mode === 'defer' ? { ...task, deferUntil: iso } : { ...task, dueDate: iso, deferUntil: null };
      working = working.map(t => (t.id === task.id ? moved : t));
    }

    return {
      task,
      minutes,
      suggested,
      tomorrow,
      mode,
      selected,
      blocker: found?.blocker ?? null,
      blockerLabel: found?.label ?? null,
    };
  });

  const currentMinutes = movable.reduce((sum, t) => sum + taskMinutes(t), 0);
  const movedMinutes = proposals
    .filter(p => p.selected)
    .reduce((sum, p) => sum + p.minutes, 0);

  return { proposals, currentMinutes, projectedMinutes: currentMinutes - movedMinutes };
}
