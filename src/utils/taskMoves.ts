import type { Task } from '../types';
import { getTaskDayStart } from './dateUtils';

/**
 * Whether a task may be swept off the day it is on, what moving it means, and
 * the field updates that do it.
 *
 * Its own module, and a **leaf**, for the two reasons that keep recurring in
 * this app. It is one rule with two callers — `deloadPlan` spreads a day
 * across the best nearby days, `lookAhead` pushes a whole window past a trip,
 * and both have to agree about what a pinned task or a live streak means, so a
 * second copy would drift the moment either was touched. And it has to be
 * importable from a `node`-environment test: `deloadPlan` reaches
 * `snoozeEngine` → `useSettingsStore` → the db → `expo-sqlite`, which throws on
 * sight under Jest, so anything a pure module needs cannot live there. Same
 * reason `dayLoad` restates `BUSY_DAY_MINUTES` rather than importing it from
 * `projectPull`, and the same reason `missed.ts` is its own leaf.
 *
 * Everything here is a read over one task plus a candidate date. Nothing picks
 * a destination — that judgement belongs to whichever planner is calling.
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
  | 'high-priority'
  | 'people';

/**
 * Blockers that leave the task movable but unchecked — the user can opt in.
 *
 * Exported, along with the three helpers below, because `lookAhead`'s push
 * plan asks the same four questions of a task ("may this move at all", "what
 * does moving it mean", "would the destination miss its deadline") about a
 * different destination. One rule with two callers, rather than the second
 * copy that would drift the moment either is touched.
 */
export const SOFT_DELOAD_BLOCKERS: ReadonlySet<DeloadBlocker> = new Set([
  'streak',
  'started',
  'high-priority',
  'people',
]);

/** Where a task could go, in one of the sheet's two destination modes. */

/**
 * Does this task's dueDate carry meaning beyond "the day it shows up"? A
 * recurrence anchors its whole future grid to it (getNextDueDate), and a
 * series member's date was hand-picked out of a set. Both move by deferring so
 * the stored date survives; everything else can just be rescheduled.
 */
export function isDateAnchored(task: Task): boolean {
  return task.recurrenceType !== 'none' || task.seriesId !== null;
}

/**
 * Hard and soft blockers, in the order they should be reported. Hard blockers
 * mean "this can't move at all"; they're still listed so the sheet can explain
 * why the day won't get any lighter than it does.
 */
export function deloadBlockerFor(task: Task): { blocker: DeloadBlocker; label: string } | null {
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
  // Somebody else is involved, so moving this has a social cost the day-load
  // math can't see: "beach with Dustin and Ansley" is not the same thing to
  // push to Saturday as "clean the bathroom", even when the minutes agree
  // (#2088). Soft rather than hard — the day might genuinely need to get
  // lighter, and refusing outright would be the app deciding you can't
  // reschedule seeing a friend. The label names the fact and judges nothing.
  if (task.personIds.length > 0) {
    return { blocker: 'people', label: 'Someone else is involved' };
  }
  return null;
}

/**
 * True when moving the task to `dest` would push it past its own deadline.
 * Also catches a deadline that's already today or earlier, since every
 * candidate destination is at least tomorrow.
 */
export function wouldMissDeadline(task: Task, dest: Date, dayResetTime?: string): boolean {
  if (!task.deadline) return false;
  return (
    getTaskDayStart(dest, dayResetTime) >
    getTaskDayStart(new Date(task.deadline), dayResetTime)
  );
}

/**
 * The field updates that move one task to `date`, matching its `mode`.
 *
 * The destination is passed in rather than read off the proposal because every
 * caller offers more than one: the deload sheet has the engine's pick,
 * tomorrow, and a hand-picked override, and the look-ahead sheet has the day
 * after the trip and an override.
 */
export function deloadUpdates(
  proposal: { mode: 'defer' | 'reschedule' },
  date: Date | null,
): Partial<Task> | null {
  if (!date) return null;
  const iso = date.toISOString();
  return proposal.mode === 'defer' ? { deferUntil: iso } : { dueDate: iso, deferUntil: null };
}
