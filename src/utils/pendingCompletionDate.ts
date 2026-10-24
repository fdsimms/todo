// A day the person said a task was really done on, handed from the sheet that
// asked to the completion that follows it.
//
// The catch-up prompt's "When" row is the only writer today. It leaves the day
// here rather than passing it on because the sheet is opened from half a dozen
// places (a row's animation, the answer-first queue, Stuck, a project page) and
// `completeTask` is the one place they all pour into, the same reason it claims
// a widget tap's time itself (`claimTappedAt`).

/**
 * How long a left day stays claimable. The completion follows the sheet within
 * seconds; past this it evidently never happened (the person cancelled after
 * picking), and a later completion of the same task must not be backdated to it.
 */
export const PENDING_COMPLETION_DATE_WINDOW_MS = 30 * 60 * 1000;

const pending = new Map<string, { at: string; setAt: number }>();

/** Leaves `at` (ISO) for `taskId`'s next completion; null withdraws it. */
export function setPendingCompletionDate(taskId: string, at: string | null, now: number = Date.now()): void {
  if (at === null) pending.delete(taskId);
  else pending.set(taskId, { at, setAt: now });
}

/**
 * The day left for this task's completion, once. Undefined when none is live,
 * it has aged out, or it doesn't parse or lies in the future (a done task has no
 * tomorrow, and a clock that moved since is no better than now).
 */
export function claimPendingCompletionDate(taskId: string, now: number = Date.now()): string | undefined {
  const record = pending.get(taskId);
  pending.delete(taskId);
  if (!record || now - record.setAt > PENDING_COMPLETION_DATE_WINDOW_MS) return undefined;
  const parsed = Date.parse(record.at);
  if (!Number.isFinite(parsed) || parsed > now) return undefined;
  return new Date(parsed).toISOString();
}
