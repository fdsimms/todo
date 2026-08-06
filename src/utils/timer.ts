import type { Task } from '../types';

/**
 * Countdown math for timed tasks ("play violin for 15 minutes").
 *
 * A timed task carries a target (`timedMinutes`) and counts down against it.
 * Only the three raw fields below are ever stored — how much time is left, and
 * whether the task is ready to complete, are always *derived* from them against
 * the current clock. That's deliberate: a stored "ready" flag would need
 * clearing on pause, on reset, and on every new occurrence of a recurring task,
 * and it would go stale the moment the app is backgrounded or killed. Deriving
 * it means a phone that was off for an hour comes back with the right answer for
 * free.
 *
 * `timerStartedAt` is shared with the plain count-up stopwatch — non-null means
 * a run segment is in flight either way. `timerElapsedSeconds` banks the
 * segments that have already finished, which is what makes a countdown
 * pausable.
 */
export type TimerState = Pick<Task, 'timedMinutes' | 'timerElapsedSeconds' | 'timerStartedAt'>;

/** Does this task count down? A non-positive target is treated as no target. */
export function isTimedTask(task: TimerState): boolean {
  return task.timedMinutes != null && task.timedMinutes > 0;
}

/** Is a run segment in flight right now? */
export function isTimerRunning(task: TimerState): boolean {
  return task.timerStartedAt !== null;
}

/** Total seconds spent, banked segments plus the one currently running. */
export function timerElapsed(task: TimerState, now: number = Date.now()): number {
  const banked = Math.max(0, task.timerElapsedSeconds ?? 0);
  if (task.timerStartedAt === null) return banked;
  const started = new Date(task.timerStartedAt).getTime();
  // A clock that moved backwards (timezone change, manual set) would otherwise
  // hand back a negative segment and rewind the countdown.
  return banked + Math.max(0, (now - started) / 1000);
}

/**
 * Seconds left on the countdown. Goes negative once the timer has run out —
 * callers that display it should clamp (`formatStopwatch` already does), but
 * `isTimerReady` needs the sign. Always 0 for a task with no target.
 */
export function timerRemaining(task: TimerState, now: number = Date.now()): number {
  if (!isTimedTask(task)) return 0;
  return (task.timedMinutes as number) * 60 - timerElapsed(task, now);
}

/** How far through the countdown, 0–1. 0 for a task with no target. */
export function timerProgress(task: TimerState, now: number = Date.now()): number {
  if (!isTimedTask(task)) return 0;
  const total = (task.timedMinutes as number) * 60;
  return Math.min(1, Math.max(0, timerElapsed(task, now) / total));
}

/**
 * Has the countdown run out? This marks the task as ready to complete — it
 * never blocks completing it early, which stays a normal tap at any point.
 */
export function isTimerReady(task: TimerState, now: number = Date.now()): boolean {
  return isTimedTask(task) && timerRemaining(task, now) <= 0;
}
