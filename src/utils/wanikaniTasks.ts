import type { Task } from '../types';
import { dateToHHMM, logicalDayStart, onLogicalDay, taskDayStart } from './clockTime';
import { generatedSourceOf } from './generatedTasks';

/**
 * The `wanikani` generator: "WaniKani: 42 reviews" when the person's WaniKani
 * review queue reaches a number, and "WaniKani: 5 lessons" once a day. See the
 * `wanikani` section of `docs/arch/generated-tasks.md`.
 *
 * Everything here is pure. `useWaniKaniStore` holds the last read of the
 * person's account (`src/services/wanikani.ts` makes it) and
 * `checkWaniKaniTasks` in `useTaskStore` is the plumbing. Four rules live
 * here, and each was a choice:
 *
 * - **A forecast places the task, not a poll.** WaniKani's summary says how
 *   many reviews arrive in each of the next 24 hours, and the app can't fetch
 *   while it is closed. So a task wanted later today is written now, held
 *   until the hour the forecast says the queue reaches the number
 *   (`dueDate` + `windowStart`, since a same-day `deferUntil` holds nothing,
 *   see `deferBlocksNow`). It surfaces on Today on its own at that hour.
 * - **A wave is measured from the last task's close.** Reviews arrive every
 *   hour, so "a task whenever the queue is over N" would put a fresh task
 *   back the moment one was checked off with reviews left. The next task
 *   waits until N more have arrived than the lowest the queue has been since
 *   the last one closed (`WaniKaniReviewState.baseline`). Clearing the queue
 *   brings that down to zero; ticking with thirty left asks for thirty plus N.
 * - **Nothing here completes a task.** A queue read as empty makes the row
 *   *ready* (`isWaniKaniTaskReady`) and drops the count from its title. The
 *   tap stays a person's, the rule `healthTarget.ts` opens with.
 * - **A held task can move or go; a surfaced one only changes its count.** The
 *   hold follows the forecast until it arrives (reviews done on the website
 *   in the meantime push it later or take it away). Once on Today it stays
 *   until somebody checks it off, so it can't vanish out from under them.
 */

/** The hour-by-hour shape of one read. `src/services/wanikani.ts` builds it. */
export interface WaniKaniSnapshot {
  /** When the read landed (ISO). */
  fetchedAt: string;
  /** Reviews available when the read landed: the summary's first hour. */
  reviewsNow: number;
  /** Reviews arriving in each later hour of the next 24, only the hours that add any, in order. */
  upcoming: { at: string; count: number }[];
  /** Lessons available when the read landed. */
  lessonsNow: number;
  /** The logical day `lessonsDone` counts, as a day key. */
  dayKey: string;
  /** Lessons finished since that day started, or null when lessons weren't asked about. */
  lessonsDone: number | null;
  /** Items in Apprentice (SRS stages 1 to 4), or null when not asked about. */
  apprentice: number | null;
}

/**
 * Where the next review task stands, kept per device. `openSourceId` is the
 * live task this device last saw, so a pass can tell that it has since been
 * checked off or deleted; `baseline` is the lowest the queue has been since
 * the last one closed.
 */
export interface WaniKaniReviewState {
  baseline: number;
  openSourceId: string | null;
}

export const WANIKANI_INITIAL_REVIEW_STATE: WaniKaniReviewState = { baseline: 0, openSourceId: null };

export const WANIKANI_REVIEW_THRESHOLD_DEFAULT = 10;
export const WANIKANI_REVIEW_THRESHOLD_MIN = 1;
export const WANIKANI_REVIEW_THRESHOLD_MAX = 500;

export const WANIKANI_LESSONS_PER_DAY_MIN = 1;
export const WANIKANI_LESSONS_PER_DAY_MAX = 100;

export const WANIKANI_APPRENTICE_CAP_DEFAULT = 100;
export const WANIKANI_APPRENTICE_CAP_MIN = 10;
export const WANIKANI_APPRENTICE_CAP_MAX = 500;
export const WANIKANI_APPRENTICE_CAP_STEP = 10;

/** The pages a task's link opens. The person can point a task elsewhere (another app) and it stays. */
export const WANIKANI_REVIEW_URL = 'https://www.wanikani.com/subjects/review';
export const WANIKANI_LESSON_URL = 'https://www.wanikani.com/subjects/lesson';
/** Where a token is made, for the Settings row that asks for one. */
export const WANIKANI_TOKEN_URL = 'https://www.wanikani.com/settings/personal_access_tokens';
/**
 * A held reviews task's note, written with its reminder: a task's notes are
 * its notification's body, and without one it reads "You have a task coming up".
 */
export const WANIKANI_REVIEW_NOTES = 'Your reviews are up on WaniKani.';

function clampInt(value: unknown, min: number, max: number, fallback: number, step = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const stepped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, stepped));
}

/** `wanikaniReviewThreshold` clamped to what the stepper offers, defaulting anything unusable. */
export function clampWaniKaniReviewThreshold(value: unknown): number {
  return clampInt(value, WANIKANI_REVIEW_THRESHOLD_MIN, WANIKANI_REVIEW_THRESHOLD_MAX,
    WANIKANI_REVIEW_THRESHOLD_DEFAULT);
}

/** `wanikaniLessonsPerDay` clamped, with null (no lessons task) kept as null. */
export function clampWaniKaniLessonsPerDay(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return clampInt(value, WANIKANI_LESSONS_PER_DAY_MIN, WANIKANI_LESSONS_PER_DAY_MAX, WANIKANI_LESSONS_PER_DAY_MIN);
}

/** `wanikaniApprenticeCap` clamped, with null (no cap) kept as null. */
export function clampWaniKaniApprenticeCap(value: unknown): number | null {
  if (value === null) return null;
  return clampInt(value, WANIKANI_APPRENTICE_CAP_MIN, WANIKANI_APPRENTICE_CAP_MAX,
    WANIKANI_APPRENTICE_CAP_DEFAULT, WANIKANI_APPRENTICE_CAP_STEP);
}

/** A stored review state back into its shape, or the initial one when it doesn't parse. */
export function parseWaniKaniReviewState(raw: string | null): WaniKaniReviewState {
  if (!raw) return WANIKANI_INITIAL_REVIEW_STATE;
  try {
    const parsed = JSON.parse(raw);
    const baseline = typeof parsed?.baseline === 'number' && parsed.baseline >= 0 ? parsed.baseline : 0;
    const openSourceId = typeof parsed?.openSourceId === 'string' ? parsed.openSourceId : null;
    return { baseline, openSourceId };
  } catch {
    return WANIKANI_INITIAL_REVIEW_STATE;
  }
}

// ==== source ids ====

const REVIEWS_PREFIX = 'reviews:';
const LESSONS_PREFIX = 'lessons:';

/** The local hour an instant falls in, as `YYYY-MM-DDTHH`. Local, never `toISOString`. */
function hourKeyOf(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  const h = String(at.getHours()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}`;
}

/** A wave of reviews is named by the hour its task was placed at. */
export function wanikaniReviewSourceId(at: Date): string {
  return `${REVIEWS_PREFIX}${hourKeyOf(at)}`;
}

/** A day's lessons task is named by the logical day. */
export function wanikaniLessonsSourceId(dayKey: string): string {
  return `${LESSONS_PREFIX}${dayKey}`;
}

/** Which of the two tasks a row is, or null when it isn't one of this generator's. */
export function wanikaniTaskKind(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): 'reviews' | 'lessons' | null {
  const sourceId = generatedSourceOf(task, 'wanikani');
  if (sourceId?.startsWith(REVIEWS_PREFIX)) return 'reviews';
  if (sourceId?.startsWith(LESSONS_PREFIX)) return 'lessons';
  return null;
}

/** The day a lessons task is for, or null for anything else. */
export function wanikaniLessonsDayKey(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): string | null {
  const sourceId = generatedSourceOf(task, 'wanikani');
  return sourceId?.startsWith(LESSONS_PREFIX) ? sourceId.slice(LESSONS_PREFIX.length) : null;
}

// ==== titles ====

export function wanikaniReviewTitle(count: number): string {
  if (count <= 0) return 'WaniKani reviews';
  return `WaniKani: ${count} ${count === 1 ? 'review' : 'reviews'}`;
}

export function wanikaniLessonTitle(count: number): string {
  if (count <= 0) return 'WaniKani lessons';
  return `WaniKani: ${count} ${count === 1 ? 'lesson' : 'lessons'}`;
}

// ==== the queue ====

/**
 * How many reviews the read says are waiting at `at`: what was there when it
 * landed plus every later hour that has arrived since. Past the read's own
 * 24 hours it stops growing, so it is a floor rather than a guess.
 */
export function wanikaniQueueAt(snapshot: WaniKaniSnapshot, at: Date): number {
  const atMs = at.getTime();
  let total = snapshot.reviewsNow;
  for (const hour of snapshot.upcoming) {
    if (Date.parse(hour.at) <= atMs) total += hour.count;
  }
  return total;
}

/**
 * The first moment from `now` on at which the queue stands `threshold` above
 * `baseline`: `now` itself when it already does, the hour the forecast gets
 * there, or null when the next 24 hours never do.
 */
export function wanikaniReviewsDueAt(
  snapshot: WaniKaniSnapshot,
  baseline: number,
  threshold: number,
  now: Date,
): Date | null {
  if (wanikaniQueueAt(snapshot, now) - baseline >= threshold) return now;
  const nowMs = now.getTime();
  const later = snapshot.upcoming
    .map(hour => ({ ms: Date.parse(hour.at), count: hour.count }))
    .filter(hour => Number.isFinite(hour.ms) && hour.ms > nowMs)
    .sort((a, b) => a.ms - b.ms);
  let total = wanikaniQueueAt(snapshot, now);
  for (const hour of later) {
    total += hour.count;
    if (total - baseline >= threshold) return new Date(hour.ms);
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
export function wanikaniHoldFields(at: Date, dayResetTime: string): { dueDate: string; windowStart: string } {
  const due = logicalDayStart(at, dayResetTime);
  due.setHours(12, 0, 0, 0);
  return { dueDate: due.toISOString(), windowStart: dateToHHMM(at) };
}

/**
 * When a task is held until, or null when it is already on Today: read from
 * its own `dueDate` and `windowStart`, the two fields the visibility gate
 * reads, so the answer can't disagree with where the row actually is.
 */
export function wanikaniHeldUntil(
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
export type WaniKaniReviewAction =
  | { type: 'none' }
  /** Take the held task away quietly: the forecast no longer gets there. */
  | { type: 'drop' }
  /**
   * Write the task for `sourceId`, creating it if there's none: `count` is
   * its title's number and `holdUntil` the hour it waits for, or null for now.
   */
  | { type: 'write'; sourceId: string; count: number; holdUntil: Date | null };

export interface WaniKaniReviewDecision {
  action: WaniKaniReviewAction;
  state: WaniKaniReviewState;
}

/**
 * The reviews task's whole rule. `live` is the open task, if there is one, and
 * when it is held until; `state` is what the last pass left.
 */
export function decideWaniKaniReviews(input: {
  snapshot: WaniKaniSnapshot;
  now: Date;
  threshold: number;
  live: { sourceId: string; heldUntil: Date | null } | null;
  state: WaniKaniReviewState;
}): WaniKaniReviewDecision {
  const { snapshot, now, threshold, live } = input;
  const queueNow = wanikaniQueueAt(snapshot, now);

  if (live) {
    const state = { ...input.state, openSourceId: live.sourceId };
    // On Today already: only its count follows the queue.
    if (live.heldUntil === null || live.heldUntil.getTime() <= now.getTime()) {
      return { state, action: { type: 'write', sourceId: live.sourceId, count: queueNow, holdUntil: null } };
    }
    const dueAt = wanikaniReviewsDueAt(snapshot, state.baseline, threshold, now);
    if (dueAt === null) {
      // Not a close: nobody checked it off, the forecast just stopped getting
      // there (reviews done on the website). The baseline still follows the queue down.
      return {
        state: { baseline: Math.min(state.baseline, queueNow), openSourceId: null },
        action: { type: 'drop' },
      };
    }
    const holdUntil = dueAt.getTime() > now.getTime() ? dueAt : null;
    return {
      state,
      action: { type: 'write', sourceId: live.sourceId, count: wanikaniQueueAt(snapshot, dueAt), holdUntil },
    };
  }

  // The task this device last saw has gone, checked off or deleted, so a new
  // wave starts from wherever the queue is now.
  const baseline = input.state.openSourceId !== null
    ? queueNow
    : Math.min(input.state.baseline, queueNow);
  const dueAt = wanikaniReviewsDueAt(snapshot, baseline, threshold, now);
  if (dueAt === null) {
    return { state: { baseline, openSourceId: null }, action: { type: 'none' } };
  }
  const sourceId = wanikaniReviewSourceId(dueAt);
  const holdUntil = dueAt.getTime() > now.getTime() ? dueAt : null;
  return {
    state: { baseline, openSourceId: sourceId },
    action: { type: 'write', sourceId, count: wanikaniQueueAt(snapshot, dueAt), holdUntil },
  };
}

/** How many of today's lessons are left: the day's number less those done, never more than are available. */
export function wanikaniLessonsLeft(snapshot: WaniKaniSnapshot, perDay: number): number | null {
  if (snapshot.lessonsDone === null) return null;
  return Math.max(0, Math.min(perDay - snapshot.lessonsDone, snapshot.lessonsNow));
}

/**
 * Whether today's lessons task should be written now. Once a day, and only
 * while there are lessons to do, fewer than the day's number are done, and
 * Apprentice is under the cap. A day that doesn't qualify yet can later (a
 * level-up unlocks lessons, reviews bring Apprentice down), so the day is
 * spent only by writing the task, never by declining to.
 */
export function wantsWaniKaniLessonsTask(input: {
  snapshot: WaniKaniSnapshot;
  todayKey: string;
  perDay: number | null;
  apprenticeCap: number | null;
  lastDayKey: string | null;
}): boolean {
  const { snapshot, todayKey, perDay, apprenticeCap, lastDayKey } = input;
  if (perDay === null) return false;
  if (lastDayKey === todayKey) return false;
  if (snapshot.dayKey !== todayKey) return false;
  const left = wanikaniLessonsLeft(snapshot, perDay);
  if (left === null || left <= 0) return false;
  if (apprenticeCap !== null) {
    // Unread is not under the cap: wait for a read that says.
    if (snapshot.apprentice === null || snapshot.apprentice >= apprenticeCap) return false;
  }
  return true;
}

/**
 * Whether a WaniKani row reads as ready to check off: its queue is empty, or
 * its day's lessons are done. Derived only, from the latest read.
 */
export function isWaniKaniTaskReady(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
  snapshot: WaniKaniSnapshot | null,
  perDay: number | null,
  now: Date,
): boolean {
  if (!snapshot) return false;
  const kind = wanikaniTaskKind(task);
  if (kind === 'reviews') return wanikaniQueueAt(snapshot, now) === 0;
  if (kind === 'lessons') {
    if (perDay === null || wanikaniLessonsDayKey(task) !== snapshot.dayKey) return false;
    return wanikaniLessonsLeft(snapshot, perDay) === 0;
  }
  return false;
}
