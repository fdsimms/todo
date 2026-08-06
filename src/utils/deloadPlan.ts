import type { Task } from '../types';
import { computeSnoozeSuggestion } from './snoozeEngine';
import { effortToMinutes } from './effort';
import { getTaskDayStart } from './dateUtils';
import { useSettingsStore } from '../store/useSettingsStore';

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
 * the vocabulary matches what Suggest already says.
 */

/** Why a task is blocked outright, or merely unchecked by default. */
export type DeloadBlocker =
  | 'pinned'
  | 'running'
  | 'deadline'
  | 'urgent'
  | 'quota'
  | 'chain'
  | 'streak'
  | 'started'
  | 'high-priority';

/** Blockers that leave the task movable but unchecked — the user can opt in. */
const SOFT_BLOCKERS: ReadonlySet<DeloadBlocker> = new Set(['streak', 'started', 'high-priority']);

export interface DeloadProposal {
  task: Task;
  /** Minutes this task is holding on today's total. */
  minutes: number;
  /** Destination day, or null when the task can't move at all. */
  date: Date | null;
  /** "Thursday", "Tomorrow" — from the snooze engine. */
  dayLabel: string | null;
  /** "light day", "good for \"email\"" — from the snooze engine. */
  reason: string | null;
  /**
   * How the move should be applied. Recurring tasks and series members defer
   * (dueDate untouched) — a recurrence has a grid that getNextDueDate anchors
   * to, and a series date was hand-picked, so neither should be overwritten by
   * a bulk sweep. A plain one-off reschedules outright, since there's nothing
   * to protect and a stale dueDate would read as overdue on arrival.
   */
  mode: 'defer' | 'reschedule';
  /** Checked by default in the sheet. */
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

// Matches sumEstimatedMinutes, so the sheet's "5.5h → 3.0h" reconciles with the
// Today header's "5.5h planned today". (Note a timed task's timedMinutes isn't
// part of that sum on either side — a pre-existing gap in the workload readout,
// not one to close from in here.)
function taskMinutes(t: Task): number {
  return t.estimatedMinutes ?? effortToMinutes(t.effort) ?? 0;
}

/**
 * Does this task's dueDate carry meaning beyond "the day it shows up"? A
 * recurrence anchors its whole future grid to it (getNextDueDate), and a
 * series member's date was hand-picked out of a set. Both move by deferring so
 * the stored date survives; everything else can just be rescheduled.
 */
function isAnchored(task: Task): boolean {
  return task.recurrenceType !== 'none' || task.seriesId !== null;
}

/**
 * Hard and soft blockers, in the order they should be reported. Hard blockers
 * mean "this can't move at all"; they're still listed so the sheet can explain
 * why the day won't get any lighter than it does.
 */
function findBlocker(task: Task): { blocker: DeloadBlocker; label: string } | null {
  if (task.pinned) return { blocker: 'pinned', label: 'Pinned to today' };
  if (task.timerStartedAt !== null) return { blocker: 'running', label: 'Timer running' };
  if (task.priority === 4) return { blocker: 'urgent', label: 'Urgent' };
  // A quota is a per-day target that resets with each occurrence (progressCount
  // starts at 0), so moving today's occurrence just discards today's progress.
  if (task.targetCount !== null) return { blocker: 'quota', label: 'Daily target' };
  // A mid-chain step was spawned by the step before it and has no schedule of
  // its own to move; the chain advances on completion, not by date.
  if (task.chainEnabled && task.chainItems.length > 0 && task.chainIndex > 0) {
    return { blocker: 'chain', label: 'Mid-chain step' };
  }
  // Soft from here down — movable, but never checked for you.
  if (task.streakCount > 1) {
    return { blocker: 'streak', label: `${task.streakCount}-day streak` };
  }
  // Banked countdown time means this occurrence was already worked on today.
  // The banked seconds travel with the row, so moving it loses nothing — but
  // it shouldn't be swept along by default either. (timerElapsedSeconds resets
  // to 0 on each new occurrence, so this only ever means "started *today*".)
  if (task.timerElapsedSeconds > 0) {
    return { blocker: 'started', label: 'Already started' };
  }
  if (task.priority === 3) return { blocker: 'high-priority', label: 'High priority' };
  return null;
}

/**
 * True when moving the task to `dest` would push it past its own deadline.
 * Also catches a deadline that's already today or earlier, since every
 * candidate destination is at least tomorrow.
 */
function missesDeadline(task: Task, dest: Date, dayResetTime: string): boolean {
  if (!task.deadline) return false;
  return (
    getTaskDayStart(dest, dayResetTime) >
    getTaskDayStart(new Date(task.deadline), dayResetTime)
  );
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

  const proposals: DeloadProposal[] = ordered.map(({ task, minutes }) => {
    const found = findBlocker(task);
    const hardBlocked = found !== null && !SOFT_BLOCKERS.has(found.blocker);

    if (hardBlocked) {
      return {
        task,
        minutes,
        date: null,
        dayLabel: null,
        reason: null,
        mode: isAnchored(task) ? 'defer' : 'reschedule',
        selected: false,
        blocker: found!.blocker,
        blockerLabel: found!.label,
      };
    }

    const suggestion = computeSnoozeSuggestion(task, working);
    const mode: 'defer' | 'reschedule' = isAnchored(task) ? 'defer' : 'reschedule';

    if (missesDeadline(task, suggestion.date, resetTime)) {
      return {
        task,
        minutes,
        date: null,
        dayLabel: null,
        reason: null,
        mode,
        selected: false,
        blocker: 'deadline',
        blockerLabel: 'Deadline too close',
      };
    }

    // Only a proposal the user is likely to accept should occupy its
    // destination day for the tasks scored after it.
    const selected = found === null;
    if (selected) {
      const iso = suggestion.date.toISOString();
      const moved: Task =
        mode === 'defer' ? { ...task, deferUntil: iso } : { ...task, dueDate: iso, deferUntil: null };
      working = working.map(t => (t.id === task.id ? moved : t));
    }

    return {
      task,
      minutes,
      date: suggestion.date,
      dayLabel: suggestion.dayLabel,
      reason: suggestion.reason,
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

/** The field updates that apply one proposal, matching its `mode`. */
export function deloadUpdates(proposal: DeloadProposal): Partial<Task> | null {
  if (!proposal.date) return null;
  const iso = proposal.date.toISOString();
  return proposal.mode === 'defer' ? { deferUntil: iso } : { dueDate: iso, deferUntil: null };
}
