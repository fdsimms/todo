import type { Task } from '../types';
import { formatDeadlineDate, formatScheduledDate, getEffectiveTaskDate, getDayStart } from './dateUtils';

/**
 * The one line under a blocker's name on the Waiting screen: when the tasks
 * queued behind it can expect to be let go.
 *
 * The screen used to name the blocker and stop there, which left the only
 * question it exists to answer — "when does this free up?" — unanswerable
 * without opening the blocker. A blocker due tomorrow and one with no date at
 * all rendered identically, and so did one that is itself waiting on a third
 * task, which is the case where the run isn't going anywhere at all.
 */
export interface BlockerWait {
  text: string;
  /**
   * Whether to say this in the warning tint. True *only* for a blown
   * `deadline` — see `formatScheduledDate`'s note: a do-date that has passed
   * has elapsed, it isn't late, and colouring one orange smuggles back in the
   * judgment that formatter exists to keep off scheduled dates.
   */
  late: boolean;
}

/**
 * Whether `deadline` is behind us, in the user's logical day.
 *
 * A date comparison establishing before/after today, so it anchors both sides
 * to `dayResetTime` rather than reading a bare `new Date()`: at 1am under a
 * 2am reset, a deadline of "yesterday" is still today's, and flagging the
 * section orange in the small hours is exactly the off-by-one that rule is
 * there to prevent.
 */
function deadlinePassed(deadline: string, dayResetTime?: string): boolean {
  return getDayStart(new Date(deadline), dayResetTime) < getDayStart(new Date(), dayResetTime);
}

/**
 * `blockedItself` is passed in rather than derived so this stays pure — the
 * "is it blocked" answer needs the whole task list, which the screen already
 * holds and this module deliberately doesn't reach for (the same shape
 * `blocking.ts` uses with its `TaskResolver`).
 */
export function describeBlockerWait(
  blocker: Pick<Task, 'dueDate' | 'deferUntil' | 'deadline'>,
  options: { blockedItself?: boolean; dayResetTime?: string } = {},
): BlockerWait {
  const { blockedItself = false, dayResetTime } = options;

  // First, because it outranks the blocker's own schedule: a date on a task
  // that can't start yet isn't when the run gets released.
  if (blockedItself) return { text: 'Waiting on another task', late: false };

  if (blocker.deadline && deadlinePassed(blocker.deadline, dayResetTime)) {
    return { text: `Deadline ${formatDeadlineDate(blocker.deadline, dayResetTime)}`, late: true };
  }

  const iso = getEffectiveTaskDate(blocker, dayResetTime);
  if (iso) {
    // "Hidden until" for a defer, because that's what the date means there and
    // the blocker genuinely isn't on anyone's list before it — where a plain
    // dueDate is something you could go and do today if you wanted.
    const deferred = blocker.deferUntil === iso && blocker.deferUntil !== blocker.dueDate;
    const when = formatScheduledDate(iso, dayResetTime);
    return { text: deferred ? `Hidden until ${when}` : `Due ${when}`, late: false };
  }

  // Not a failure state and not styled as one — plenty of blockers are things
  // you'll simply get to ("hear back from the landlord"). It's said out loud
  // because "no date" is the answer, and a blank line reads as missing data.
  return { text: 'No date set', late: false };
}
