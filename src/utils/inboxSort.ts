import type { Task } from '../types';
import { addDays } from 'date-fns/addDays';

/** The When answers the Inbox's sort card offers. */
export type InboxSortWhen = 'today' | 'tomorrow' | 'weekend' | 'none';

/**
 * The day an answer means, from the logical today (never `new Date()`, or the
 * grace window before the day's reset lands it a day late). "This weekend" is
 * Saturday, or today once Saturday has gone (on Sunday the weekend in progress
 * is the one meant, and a day already past is no answer). `none` leaves the
 * task undated.
 */
export function inboxSortDay(when: InboxSortWhen, today: Date): Date | null {
  if (when === 'today') return today;
  if (when === 'tomorrow') return addDays(today, 1);
  if (when === 'weekend') {
    const weekday = today.getDay();
    return weekday === 0 ? today : addDays(today, 6 - weekday);
  }
  return null;
}

/**
 * The cards still to show: the Inbox as it is now, less the ones skipped this
 * session. Recomputed rather than indexed, the way Backfill's queue is, so a
 * task answered (and so no longer in the Inbox) drops out by itself and one
 * added meanwhile joins the end.
 */
export function inboxSortQueue(inbox: readonly Task[], skipped: ReadonlySet<string>): Task[] {
  return inbox.filter(t => !skipped.has(t.id));
}
