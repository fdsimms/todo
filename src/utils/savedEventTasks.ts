import { addDays } from 'date-fns/addDays';
import { addMonths } from 'date-fns/addMonths';
import type { Task } from '../types';
import { dayKeyOf } from './dateUtils';
import { eventMemoryKey } from './eventMemory';
import { generatedSourceOf } from './generatedTasks';
import type { SavedEvent } from './savedEvents';

/**
 * `bookEvent`: "Book Optometrist" once it has been long enough since the last
 * one. See `docs/arch/generated-tasks.md` for the mechanism it shares.
 *
 * The source is a saved event (`savedEvents.ts`) with `bookEveryMonths` set,
 * which is the opt-in: nothing is asked about an event the person hasn't given
 * an interval. It counts from `lastStart`, the start of the last event added
 * from it, so booking and adding the next appointment is what ends the
 * question. A start in the future (the appointment is already booked) puts the
 * next ask past it.
 *
 * **The source id names the cycle as well as the event** (`key|YYYY-MM-DD`,
 * the day of `lastStart`). A completed "Book Optometrist" then blocks a second
 * one for that cycle only (`blocksOnFinished`), and adding the next
 * appointment moves to a new id, so the old cycle's live task is dropped as
 * stale rather than re-dated. A delete stamps `bookDeclinedFor` with the
 * cycle's `lastStart` on the saved event itself, so it syncs with the event
 * and goes when the event does.
 */

/** How long before the interval is up the task appears: time to get an appointment. */
export const BOOK_LEAD_DAYS = 30;

const SEPARATOR = '|';

/** The cycle-scoped source id, or null while there is nothing to count from. */
export function bookSourceId(event: Pick<SavedEvent, 'title' | 'lastStart' | 'bookEveryMonths'>): string | null {
  if (event.bookEveryMonths === null || event.lastStart === null) return null;
  const key = eventMemoryKey(event.title);
  return key ? `${key}${SEPARATOR}${dayKeyOf(new Date(event.lastStart))}` : null;
}

/** The source id of a "Book …" task, or null for any other task. */
export function bookEventSourceOf(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): string | null {
  return generatedSourceOf(task, 'bookEvent');
}

/**
 * The day the task falls due: the interval after the last one, less the lead
 * time, and never on or before the last one's own day (a one-month interval
 * would otherwise ask on the day of the appointment).
 */
export function bookDueDay(event: Pick<SavedEvent, 'lastStart' | 'bookEveryMonths'>): Date | null {
  if (event.bookEveryMonths === null || event.lastStart === null) return null;
  const last = new Date(event.lastStart);
  const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate());
  const due = addDays(addMonths(lastDay, event.bookEveryMonths), -BOOK_LEAD_DAYS);
  const floor = addDays(lastDay, 1);
  return due < floor ? floor : due;
}

/** Whether this saved event wants its booking task, on the logical day `today` (a midnight). */
export function wantsBookTask(event: SavedEvent, today: Date): boolean {
  const due = bookDueDay(event);
  if (!due || !bookSourceId(event)) return false;
  if (event.bookDeclinedFor !== null && event.bookDeclinedFor === event.lastStart) return false;
  return today >= due;
}

export function bookTaskTitle(title: string): string {
  return `Book ${title}`;
}

/** Why it's on the list: when the last one was, and the interval the person set. */
export function bookTaskNotes(event: Pick<SavedEvent, 'lastStart' | 'bookEveryMonths'>): string {
  const last = event.lastStart
    ? new Date(event.lastStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const every = event.bookEveryMonths === 1 ? 'every month' : `every ${event.bookEveryMonths} months`;
  return last
    ? `The last one was on ${last}. Set to ${every} in Settings › Calendar › Saved events.`
    : `Set to ${every} in Settings › Calendar › Saved events.`;
}
