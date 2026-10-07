import type { Task } from '../types';
import { carryClockTime } from './clockTime';
import { getDeadlineFromMonthDay, getDeadlineFromOffset, getNextDueDate, getReminderOffsetDate } from './dateUtils';
import { CONTENT_FIELDS, captureField } from './taskUpdate';
import { getVisibleAt } from './visibilityUtils';

/**
 * Skipping a repeating task's occurrence: the row rolls onto its next date in
 * place, with no completion and nothing in the Logbook. The rule
 * `skipNextRecurrence` writes, lifted out of the store so the MCP server's
 * `skip_occurrence` writes the same row (docs/arch/mcp-server.md).
 */

/**
 * An occurrence's reminder moved onto a new due date: the same clock time on
 * the new day (or the same offset before it), or, for a reminder that tracks
 * visibility, the moment the moved row becomes visible. The rule
 * buildCompletion applies to a successor, for the two paths that re-date a row
 * outside a completion: skipping one, and a daily target's rollover.
 */
export function reminderOnto(
  effective: Task,
  due: Date,
  dayResetTime: string,
  overrides: Partial<Task> = {},
): Pick<Task, 'reminderTime' | 'reminderUtcOffsetMinutes'> {
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
  const next = carryClockTime(onto, original, dayResetTime);
  return { reminderTime: next.toISOString(), reminderUtcOffsetMinutes: next.getTimezoneOffset() };
}

/**
 * A relative deadline recomputed against a new due date, as buildCompletion
 * does for a successor. A fixed deadline is a one-off date, so it's returned
 * unchanged here: re-dating the same row doesn't make it stop applying.
 */
export function deadlineOnto(effective: Task, due: Date): string | null {
  if (effective.deadlineOffsetDays !== null) return getDeadlineFromOffset(due, effective.deadlineOffsetDays).toISOString();
  if (effective.deadlineMonthDay !== null) return getDeadlineFromMonthDay(due, effective.deadlineMonthDay).toISOString();
  return effective.deadline;
}

/**
 * The patch that rolls `task` onto its next occurrence, or null when it has
 * none (no repeat, or a schedule that has ended). Written with the store's
 * SKIP_POSTPONE: a skip is not the person ducking the task.
 */
export function skipPatch(task: Task, dayResetTime: string): Partial<Task> | null {
  if (task.recurrenceType === 'none') return null;
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
  // Same as completeTask's successor: the row stays pinned into its next
  // occurrence only when the task asked for every occurrence to be, so a
  // skip doesn't leave a pin on the block the user already cleared it from.
  const pinReset: Partial<Task> = { pinned: !!task.pinEachOccurrence };
  // Mirror completeTask's advancesBySchedule split: a mid-chain step never
  // consults the recurrence schedule, so skipping one should only move the
  // chain position — pushing dueDate/recurrenceCount here would burn a full
  // cycle of the recurrence on a step that isn't scheduled at all.
  const chainAdvances = task.chainEnabled && task.chainItems.length > 0;
  const atChainEnd = chainAdvances && task.chainIndex >= task.chainItems.length - 1;
  if (chainAdvances && !atChainEnd) {
    // With per-step scheduling the step being skipped occupies a day of its
    // own, so moving the position isn't enough — the date has to move with
    // it or the next step stays parked on the day the skipped one had.
    // recurrenceCount is left alone in both modes: skipping a step isn't
    // skipping a cycle (same reasoning as completeTask's two flags).
    if (!task.chainStepOnSchedule) return { ...contentReset, ...pinReset, chainIndex: task.chainIndex + 1 };
    const stepDue = getNextDueDate(task, dayResetTime, { catchUp: true });
    if (!stepDue) return { ...contentReset, ...pinReset, chainIndex: task.chainIndex + 1 };
    return {
      ...contentReset,
      ...pinReset,
      chainIndex: task.chainIndex + 1,
      dueDate: stepDue.toISOString(),
      deferUntil: null,
      // Same shape as completeTask's successor: see reminderOnto.
      ...reminderOnto(effective, stepDue, dayResetTime, contentReset),
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
    };
  }
  // Same catchUp as completeTask's: skipping an occurrence that's a month
  // overdue means the next one you'll actually do, not the one after the one
  // you already missed. sweepExpiredTasks rolls expired occurrences forward
  // through here, so an app left shut for a week lands them on today rather
  // than on the day after they expired.
  const nextDue = getNextDueDate(task, dayResetTime, { catchUp: true });
  if (!nextDue) return null;
  return {
    ...contentReset,
    ...pinReset,
    dueDate: nextDue.toISOString(),
    deferUntil: null,
    ...reminderOnto(effective, nextDue, dayResetTime, contentReset),
    // A relative deadline follows the date, as it does on completion; see
    // the chain-step branch above for the anchor day.
    deadline: deadlineOnto(effective, nextDue),
    recurrenceAnchorDay: task.recurrenceAnchorDay,
    chainIndex: chainAdvances ? 0 : task.chainIndex,
    recurrenceCount: task.recurrenceCount !== null ? task.recurrenceCount - 1 : null,
    // Same as completeTask's successor: rolling forward to the next
    // occurrence — whether the user chose to skip it or sweepExpiredTasks
    // rolled it forward unattended — starts a fresh run with no pushes
    // against it yet.
    postponeCount: 0,
    driftingSince: null,
    bountyPushes: null,
  };
}
