import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import { isSameYear } from 'date-fns/isSameYear';
import type { Task } from '../types';
import { isRealCompletion } from './missed';

/**
 * What you and somebody have actually done together — see `docs/arch/people.md`.
 *
 * **There is no interactions table, and this is why there doesn't need to be.**
 * A completed task carrying somebody's id *is* the record that something
 * happened with them, so the history writes itself out of ordinary use: you
 * type "beach with @dustin sat" because you are making a plan, and ticking it
 * off is the logging. Everything here is derived at read time from those rows.
 *
 * Nothing in this module scores, ranks or grades anybody. It answers "what did
 * we do" and "when was the last one", and the second is deliberately rendered
 * as a *date* rather than a duration everywhere except the person's own screen
 * — see `describeLastTogether` against `describeDaysSince` below, and rule 2 in
 * the arch doc for why those are different claims.
 *
 * Pure, and takes `today` rather than reading the clock, so the rules are
 * exercisable without standing up the settings store.
 */

/** One thing you did together: a completed task that named them. */
export interface HistoryEntry {
  taskId: string;
  title: string;
  /** ISO, from the task's own `completedAt`. */
  at: string;
  /** The other people who were on the same row. */
  alsoPersonIds: string[];
}

/**
 * Which of these tasks count as history, newest first.
 *
 * Three filters, and each is load-bearing:
 *
 * - **`isRealCompletion`, never bare `completed`.** A *missed* task is stored
 *   as a completed row carrying `missedAt` (see `missed.ts`), so counting
 *   `completed` would read a "Call Mom" you missed as having called her. That
 *   is the app writing down something about a relationship that did not
 *   happen, which is the one thing the arch doc forbids outright.
 * - **Top-level rows only.** A subtask is a step of a bigger thing, so a "Beach
 *   day" with three subtasks would otherwise read as four separate times you
 *   saw somebody — and once a cadence is derived from this (#2046), that is
 *   four times the evidence for one afternoon. Same `!t.parentId` filter most
 *   store selectors already apply.
 * - **No collapsing of repeats**, unlike `groupRoster` and `projectProgress`.
 *   Those two collapse because they count *members*; this counts *events*, and
 *   a standing Sunday call really is one entry per Sunday. Same data, a
 *   different question, exactly as the note on `projectProgress` sets out.
 *
 * An archived row still counts: archiving is an explicit "keep this, out of my
 * way", and a thing you did is not undone by being filed away.
 */
export function personHistory(tasks: readonly Task[]): HistoryEntry[] {
  return tasks
    .filter(t => t.parentId === null && isRealCompletion(t) && t.completedAt !== null)
    .map(t => ({
      taskId: t.id,
      title: t.title,
      at: t.completedAt!,
      alsoPersonIds: t.personIds,
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** One thing you have planned together: a live, dated task that names them. */
export interface UpcomingEntry {
  taskId: string;
  title: string;
  /** ISO, from the task's own `dueDate`. */
  on: string;
}

/**
 * What is still to come, soonest first.
 *
 * The counterpart to the history and the reason the screen does not read as an
 * obituary: a person you are seeing on Saturday should say so, above whatever
 * you last did. Undated live tasks are left out — "someday, coffee with Dustin"
 * is a wish rather than a plan, and listing it under something called Coming up
 * would be the app overstating what you have arranged.
 */
export function personUpcoming(tasks: readonly Task[]): UpcomingEntry[] {
  return tasks
    .filter(t => t.parentId === null && !t.completed && !t.archived && t.dueDate !== null)
    .map(t => ({ taskId: t.id, title: t.title, on: t.dueDate! }))
    .sort((a, b) => a.on.localeCompare(b.on));
}

/** When the most recent one was, or null when there is nothing on file yet. */
export function lastTogether(entries: readonly HistoryEntry[]): Date | null {
  return entries.length > 0 ? new Date(entries[0].at) : null;
}

/**
 * "Today", "Yesterday", "Last Tuesday", "March 14" — the phrase that may appear
 * anywhere, including places the user did not go looking.
 *
 * **A date, never a duration.** Rule 2 in the arch doc: "Last together: March
 * 14" helps you remember and "94 days ago" grades you, and the information is
 * identical. A rising number invites you to want it lower, which is the whole
 * disease. The weekday form is used only inside a week, where "March 14" reads
 * oddly for something that happened on Tuesday; past that it is the plain date,
 * with the year once it is not this year.
 */
export function describeLastTogether(at: Date, today: Date): string {
  const days = differenceInCalendarDays(today, at);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `Last ${format(at, 'EEEE')}`;
  return isSameYear(at, today) ? format(at, 'MMMM d') : format(at, 'MMMM d, yyyy');
}

/**
 * How many days it has been — **for the person's own screen and nowhere else.**
 *
 * The one exception to rule 2, decided deliberately: opening somebody's screen
 * is an act of going to look, and being told is what grades you. Looking is
 * just remembering.
 *
 * Calendar days across the logical day boundary rather than a millisecond
 * division, the same call `projectQuietDays` makes for the same timezone
 * reason. Null when there is nothing on file, which must render as an empty
 * state rather than as zero: "nothing yet" and "0" are different claims.
 */
export function daysSinceTogether(at: Date | null, today: Date): number | null {
  if (!at) return null;
  return Math.max(0, differenceInCalendarDays(today, at));
}

/**
 * The day count's own words, in the one place it is allowed.
 *
 * Plainly and with no colour meaning late — a birthday coming up is a nice
 * thing and a gap is not a debt, so nothing here is ever red. Today and
 * yesterday are named rather than counted, because "0 days ago" is not how
 * anybody says it.
 */
export function describeDaysSince(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}
