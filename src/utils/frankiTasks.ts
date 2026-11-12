import type { Task } from '../types';
import { generatedSourceOf } from './generatedTasks';
import { hourKeyOf, reviewHeldUntil, reviewQueueAt, type ReviewQueue } from './reviewQueue';

/**
 * The `franki` generator: "Franki: 30 reviews" when the person's flashcards
 * (Franki, their Anki collection) have that many reviews waiting, and
 * "Read & Listen: Thai" once a day while a text is waiting in Franki's Read &
 * Listen and none was read today. See the `franki` section of
 * `docs/arch/generated-tasks.md`.
 *
 * Everything here is pure. `useFrankiStore` holds the last read of Franki's
 * server (`src/services/franki.ts` makes it) and `checkFrankiTasks` in
 * `useTaskStore` is the plumbing. The reviews task is WaniKani's, rule for
 * rule (`reviewQueue.ts`): the forecast is the learning cards Anki says come
 * due later today. The Read & Listen task is a day-keyed one:
 *
 * - **Once a day, spent by writing it.** Only while a text is waiting and
 *   nothing was read to the end since the logical day began. A day that
 *   doesn't qualify yet can later (a text gets written), so declining spends
 *   nothing.
 * - **Nothing here completes a task.** A text read today, or a queue read as
 *   empty, makes the row ready (`isFrankiTaskReady`). The tap stays a person's.
 * - **Yesterday's goes** at the day's first pass, like WaniKani's lessons.
 */

/** Read & Listen's side of a read: the language being read and its shelf. */
export interface FrankiReadListen {
  /** The language's code on Franki's server ("th", "pl"). */
  language: string;
  /** Its name in English, for the title ("Thai"). */
  name: string;
  /** Texts waiting to be read in it. */
  waiting: number;
  /** When a text in it was last read to the end (ISO), or null for never. */
  lastReadAt: string | null;
}

/**
 * One read of Franki's server. `reviewsNow` is every card due now, reviews and
 * learning cards alike; `upcoming` is the learning cards coming due later in
 * Anki's study day. New cards aren't counted: Franki's own progress gate can
 * hold them back where Anki's count wouldn't.
 */
export interface FrankiSnapshot extends ReviewQueue {
  /** When the read landed (ISO). */
  fetchedAt: string;
  /** When Anki's next study day starts (ISO), when the server said. */
  dayEndsAt: string | null;
  /** Null when the server didn't say (Read & Listen isn't set up there). */
  readListen: FrankiReadListen | null;
}

export const FRANKI_REVIEW_THRESHOLD_DEFAULT = 10;
export const FRANKI_REVIEW_THRESHOLD_MIN = 1;
export const FRANKI_REVIEW_THRESHOLD_MAX = 500;

/** Where each task opens: Franki's deck list, and its Read & Listen tab. */
export const FRANKI_REVIEW_URL = 'franki://';
export const FRANKI_READ_URL = 'franki://read';

/** `frankiReviewThreshold` clamped to what the stepper offers, defaulting anything unusable. */
export function clampFrankiReviewThreshold(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return FRANKI_REVIEW_THRESHOLD_DEFAULT;
  return Math.min(FRANKI_REVIEW_THRESHOLD_MAX, Math.max(FRANKI_REVIEW_THRESHOLD_MIN, Math.round(value)));
}

/**
 * The status address for what the person typed: the sync server's address
 * ("anki.example.com"), Read & Listen's ("…/reader") or the route's own. A
 * bare host gets its https://. Null when there's nothing to read from. The one
 * reader of `frankiServer`, so Settings and the fetch can't disagree on it.
 */
export function frankiStatusUrl(typed: string | null | undefined): string | null {
  let base = (typed ?? '').trim();
  if (!base) return null;
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, '');
  base = base.replace(/\/api\/status$/i, '').replace(/\/reader$/i, '');
  return `${base}/reader/api/status`;
}

// ==== source ids ====

const REVIEWS_PREFIX = 'reviews:';
const READ_PREFIX = 'read:';

/** A wave of reviews is named by the hour its task was placed at. */
export function frankiReviewSourceId(at: Date): string {
  return `${REVIEWS_PREFIX}${hourKeyOf(at)}`;
}

/** A day's Read & Listen task is named by the logical day. */
export function frankiReadSourceId(dayKey: string): string {
  return `${READ_PREFIX}${dayKey}`;
}

/** Which of the two tasks a row is, or null when it isn't one of this generator's. */
export function frankiTaskKind(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): 'reviews' | 'read' | null {
  const sourceId = generatedSourceOf(task, 'franki');
  if (sourceId?.startsWith(REVIEWS_PREFIX)) return 'reviews';
  if (sourceId?.startsWith(READ_PREFIX)) return 'read';
  return null;
}

/** The day a Read & Listen task is for, or null for anything else. */
export function frankiReadDayKey(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): string | null {
  const sourceId = generatedSourceOf(task, 'franki');
  return sourceId?.startsWith(READ_PREFIX) ? sourceId.slice(READ_PREFIX.length) : null;
}

// ==== titles ====

export function frankiReviewTitle(count: number): string {
  if (count <= 0) return 'Franki reviews';
  return `Franki: ${count} ${count === 1 ? 'review' : 'reviews'}`;
}

export function frankiReadTitle(readListen: Pick<FrankiReadListen, 'name'> | null): string {
  return readListen?.name ? `Read & Listen: ${readListen.name}` : 'Read & Listen';
}

// ==== Read & Listen ====

/** Whether a text was read to the end since `dayStart`. */
export function frankiReadSince(readListen: FrankiReadListen | null, dayStart: Date): boolean {
  if (!readListen?.lastReadAt) return false;
  const at = Date.parse(readListen.lastReadAt);
  return Number.isFinite(at) && at >= dayStart.getTime();
}

/**
 * Whether today's Read & Listen task should be written now: once a day, while
 * a text is waiting and none was read to the end today. Not spent by
 * declining, so a text written later in the day can still bring it.
 */
export function wantsFrankiReadTask(input: {
  snapshot: FrankiSnapshot;
  todayKey: string;
  dayStart: Date;
  lastDayKey: string | null;
}): boolean {
  const { snapshot, todayKey, dayStart, lastDayKey } = input;
  if (lastDayKey === todayKey) return false;
  const readListen = snapshot.readListen;
  if (!readListen || readListen.waiting <= 0) return false;
  return !frankiReadSince(readListen, dayStart);
}

/**
 * Whether a Franki row reads as ready to check off: its queue is empty, or a
 * text was read today. Derived only, from the latest read. A reviews task
 * still held for the forecast is never ready: the queue is empty *because*
 * the cards haven't come due yet.
 */
export function isFrankiTaskReady(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'> & Partial<Pick<Task, 'dueDate' | 'windowStart'>>,
  snapshot: FrankiSnapshot | null,
  now: Date,
  dayStart: Date,
  dayResetTime = '00:00',
): boolean {
  if (!snapshot) return false;
  const kind = frankiTaskKind(task);
  if (kind === 'reviews') {
    const heldUntil = reviewHeldUntil({ dueDate: task.dueDate ?? null, windowStart: task.windowStart ?? null }, dayResetTime);
    if (heldUntil && heldUntil.getTime() > now.getTime()) return false;
    return reviewQueueAt(snapshot, now) === 0;
  }
  if (kind === 'read') return frankiReadSince(snapshot.readListen, dayStart);
  return false;
}
