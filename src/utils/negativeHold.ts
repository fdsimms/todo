import type { Task } from '../types';
import { effectiveWindowEnd } from './visibilityUtils';
import { onLogicalDay } from './clockTime';
import { negativeHoldFor, type NegativeHold } from './negativeHabits';

/**
 * What a long press on an avoid-task's box offers right now, or null when there
 * is nothing to offer. Shared by the task row and the Search checkbox for the
 * reason `confirmSlip` is: two tap targets, one answer. The answer picks which
 * rows `NegativeHoldMenu` shows.
 */
export function negativeHoldNow(task: Task, todayStart: Date, now = new Date()): NegativeHold | null {
  return negativeHoldFor(task, todayStart, { windowClosed: windowHasClosed(task, todayStart, now) });
}

/** Whether a long press on this avoid-task's box has anything to do right now. */
export function negativeHoldOffered(task: Task, todayStart: Date, now = new Date()): boolean {
  return negativeHoldNow(task, todayStart, now) !== null;
}

function windowHasClosed(task: Task, todayStart: Date, now: Date): boolean {
  const end = effectiveWindowEnd(task);
  return !!end && now >= onLogicalDay(todayStart, end);
}
