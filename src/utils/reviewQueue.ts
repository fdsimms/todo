import { dateToHHMM, logicalDayStart, onLogicalDay, taskDayStart } from './clockTime';
import type { Task } from '../types';

/**
 * The rules for a task that follows another app's review queue: "WaniKani: 42
 * reviews" (`wanikaniTasks.ts`) and "Franki: 30 reviews" (`frankiTasks.ts`).
 * Written for WaniKani first and moved here when Franki needed the same
 * answers, so the two can't drift apart. Each generator's module names its
 * own source ids, titles and links; what's here is the queue, the wave and
 * the hold. See the `wanikani` and `franki` sections of
 * `docs/arch/generated-tasks.md`.
 *
 * - **A forecast places the task, not a poll.** A read says how many reviews
 *   are waiting now and how many arrive later, and the app can't read while it
 *   is closed. So a task wanted later today is written now, held until the
 *   moment the forecast says the queue reaches the number (`dueDate` +
 *   `windowStart`, since a same-day `deferUntil` holds nothing, see
 *   `deferBlocksNow`). It surfaces on Today on its own at that moment.
 * - **A wave is measured from the last task's close.** Reviews keep arriving,
 *   so "a task whenever the queue is over N" would put a fresh task back the
 *   moment one was checked off with reviews left. The next task waits until N
 *   more have arrived than the lowest the queue has been since the last one
 *   closed (`ReviewWaveState.baseline`). Clearing the queue brings that down
 *   to zero; ticking with thirty left asks for thirty plus N.
 * - **Nothing here completes a task.** A queue read as empty makes the row
 *   ready and drops the count from its title. The tap stays a person's.
 * - **A held task can move or go; a surfaced one only changes its count.**
 *   The hold follows the forecast until it arrives (reviews done elsewhere in
 *   the meantime push it later or take it away). Once on Today it stays until
 *   somebody checks it off, so it can't vanish out from under them.
 */

/** One read of a queue: what was waiting when it landed, and what arrives after. */
export interface ReviewQueue {
  /** Reviews waiting when the read landed. */
  reviewsNow: number;
  /** Reviews arriving later, only the moments that add any, in order (ISO instants). */
  upcoming: { at: string; count: number }[];
}

/**
 * Where the next review task stands, kept per device. `openSourceId` is the
 * live task this device last saw, so a pass can tell that it has since been
 * checked off or deleted; `baseline` is the lowest the queue has been since
 * the last one closed.
 */
export interface ReviewWaveState {
  baseline: number;
  openSourceId: string | null;
}

export const REVIEW_WAVE_INITIAL_STATE: ReviewWaveState = { baseline: 0, openSourceId: null };

/** A stored wave state back into its shape, or the initial one when it doesn't parse. */
export function parseReviewWaveState(raw: string | null): ReviewWaveState {
  if (!raw) return REVIEW_WAVE_INITIAL_STATE;
  try {
    const parsed = JSON.parse(raw);
    const baseline = typeof parsed?.baseline === 'number' && parsed.baseline >= 0 ? parsed.baseline : 0;
    const openSourceId = typeof parsed?.openSourceId === 'string' ? parsed.openSourceId : null;
    return { baseline, openSourceId };
  } catch {
    return REVIEW_WAVE_INITIAL_STATE;
  }
}

/** The local hour an instant falls in, as `YYYY-MM-DDTHH`. Local, never `toISOString`. */
export function hourKeyOf(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  const h = String(at.getHours()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}`;
}

// ==== the queue ====

/**
 * How many reviews the read says are waiting at `at`: what was there when it
 * landed plus everything forecast to have arrived since. Past the end of the
 * forecast it stops growing, so it is a floor rather than a guess.
 */
export function reviewQueueAt(queue: ReviewQueue, at: Date): number {
  const atMs = at.getTime();
  let total = queue.reviewsNow;
  for (const arrival of queue.upcoming) {
    if (Date.parse(arrival.at) <= atMs) total += arrival.count;
  }
  return total;
}

/**
 * The first moment from `now` on at which the queue stands `threshold` above
 * `baseline`: `now` itself when it already does, the moment the forecast gets
 * there, or null when the forecast never does.
 */
export function reviewQueueDueAt(
  queue: ReviewQueue,
  baseline: number,
  threshold: number,
  now: Date,
): Date | null {
  if (reviewQueueAt(queue, now) - baseline >= threshold) return now;
  const nowMs = now.getTime();
  const later = queue.upcoming
    .map(arrival => ({ ms: Date.parse(arrival.at), count: arrival.count }))
    .filter(arrival => Number.isFinite(arrival.ms) && arrival.ms > nowMs)
    .sort((a, b) => a.ms - b.ms);
  let total = reviewQueueAt(queue, now);
  for (const arrival of later) {
    total += arrival.count;
    if (total - baseline >= threshold) return new Date(arrival.ms);
  }
  return null;
}

// ==== placing a held task ====

/**
 * The fields that hold a task until `at`: the logical day `at` falls on (at
 * noon, the anchor the other day-keyed generators use) and `at`'s clock time
 * as the window's start. `onLogicalDay` reads them back to the same instant,
 * including an hour after midnight but before the day's reset.
 */
export function reviewHoldFields(at: Date, dayResetTime: string): { dueDate: string; windowStart: string } {
  const due = logicalDayStart(at, dayResetTime);
  due.setHours(12, 0, 0, 0);
  return { dueDate: due.toISOString(), windowStart: dateToHHMM(at) };
}

/**
 * When a task is held until, or null when it is already on Today: read from
 * its own `dueDate` and `windowStart`, the two fields the visibility gate
 * reads, so the answer can't disagree with where the row actually is.
 */
export function reviewHeldUntil(
  task: Pick<Task, 'dueDate' | 'windowStart'>,
  dayResetTime: string,
): Date | null {
  if (!task.dueDate || !task.windowStart) return null;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return null;
  return onLogicalDay(taskDayStart(due, dayResetTime), task.windowStart);
}

// ==== deciding ====

/** What the pass should do with the reviews task. */
export type ReviewWaveAction =
  | { type: 'none' }
  /** Take the held task away quietly: the forecast no longer gets there. */
  | { type: 'drop' }
  /**
   * Write the task for `sourceId`, creating it if there's none: `count` is
   * its title's number and `holdUntil` the moment it waits for, or null for now.
   */
  | { type: 'write'; sourceId: string; count: number; holdUntil: Date | null };

export interface ReviewWaveDecision {
  action: ReviewWaveAction;
  state: ReviewWaveState;
}

/**
 * The reviews task's whole rule. `live` is the open task, if there is one, and
 * when it is held until; `state` is what the last pass left; `sourceIdFor`
 * names a new wave by the moment it is placed at.
 */
export function decideReviewWave(input: {
  queue: ReviewQueue;
  now: Date;
  threshold: number;
  live: { sourceId: string; heldUntil: Date | null } | null;
  state: ReviewWaveState;
  sourceIdFor: (at: Date) => string;
}): ReviewWaveDecision {
  const { queue, now, threshold, live } = input;
  const queueNow = reviewQueueAt(queue, now);

  if (live) {
    const state = { ...input.state, openSourceId: live.sourceId };
    // On Today already: only its count follows the queue.
    if (live.heldUntil === null || live.heldUntil.getTime() <= now.getTime()) {
      return { state, action: { type: 'write', sourceId: live.sourceId, count: queueNow, holdUntil: null } };
    }
    const dueAt = reviewQueueDueAt(queue, state.baseline, threshold, now);
    if (dueAt === null) {
      // Not a close: nobody checked it off, the forecast just stopped getting
      // there (reviews done elsewhere). The baseline still follows the queue down.
      return {
        state: { baseline: Math.min(state.baseline, queueNow), openSourceId: null },
        action: { type: 'drop' },
      };
    }
    const holdUntil = dueAt.getTime() > now.getTime() ? dueAt : null;
    return {
      state,
      action: { type: 'write', sourceId: live.sourceId, count: reviewQueueAt(queue, dueAt), holdUntil },
    };
  }

  // The task this device last saw has gone, checked off or deleted, so a new
  // wave starts from wherever the queue is now.
  const baseline = input.state.openSourceId !== null
    ? queueNow
    : Math.min(input.state.baseline, queueNow);
  const dueAt = reviewQueueDueAt(queue, baseline, threshold, now);
  if (dueAt === null) {
    return { state: { baseline, openSourceId: null }, action: { type: 'none' } };
  }
  const sourceId = input.sourceIdFor(dueAt);
  const holdUntil = dueAt.getTime() > now.getTime() ? dueAt : null;
  return {
    state: { baseline, openSourceId: sourceId },
    action: { type: 'write', sourceId, count: reviewQueueAt(queue, dueAt), holdUntil },
  };
}
