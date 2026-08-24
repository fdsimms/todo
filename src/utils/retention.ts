/**
 * Completed-task retention — the pure half of "keep completed tasks for N".
 *
 * Nothing purged completed rows before this, so every completion of a
 * recurring task left a tombstone that stayed in SQLite for good. The app
 * already compensated for that at read time in two places — groupRoster()
 * collapses a stack's ever-growing child rows, and projectProgress does its
 * own collapse so a recurring member's tombstones stop inflating the
 * denominator — but nothing ever bounded the growth at the source.
 *
 * This decides *which* rows a purge may take; useTaskStore.purgeOldCompletedTasks
 * does the deleting, so the rules can be tested without a database.
 *
 * **Defaults to forever.** A retention window silently deleting history would
 * be a data-loss feature, so an install that never opens the setting keeps
 * every row it has, and choosing a window is a confirmed, explicit act (see
 * SettingsScreen) now that export/backup exists to get the history off the
 * device first.
 */

import { subDays } from 'date-fns/subDays';
import { getDayStart } from './dateUtils';
import type { Task } from '../types';
import { deliverableKindFor } from './deliverables';

/**
 * How long completed tasks are kept, in days. `null` = forever, the default.
 *
 * Days rather than months so the cutoff is one subtraction and needs no
 * calendar-length special cases; the labels are what the user sees.
 */
export type RetentionDays = number | null;

export const RETENTION_OPTIONS: { value: RetentionDays; label: string }[] = [
  { value: 90, label: '3 months' },
  { value: 365, label: '1 year' },
  { value: null, label: 'Forever' },
];

/** The Settings row's summary line — also the wording used in the confirm dialog. */
export function retentionLabel(days: RetentionDays): string {
  return RETENTION_OPTIONS.find(o => o.value === days)?.label ?? 'Forever';
}

/**
 * Parses the stored settings value. Anything unrecognised reads as forever:
 * the failure mode of a garbled value has to be "keep everything", never
 * "delete more than asked".
 */
export function parseRetentionDays(raw: string | null): RetentionDays {
  if (!raw) return null;
  const n = Number(raw);
  return RETENTION_OPTIONS.some(o => o.value === n) ? n : null;
}

/**
 * The instant before which a completion is old enough to purge, or null when
 * retention is off.
 *
 * Anchored to the start of the logical day (dayResetTime) rather than to the
 * current clock time, so "3 months" means the same thing whenever the app
 * happens to be opened — otherwise a launch at 9am and one at 11pm would take
 * a different set of rows on the same day.
 */
export function retentionCutoff(
  days: RetentionDays,
  now: Date = new Date(),
  dayResetTime?: string
): Date | null {
  if (days === null) return null;
  return subDays(getDayStart(now, dayResetTime), days);
}

/**
 * The top-level rows a purge may delete: completed, stamped, older than the
 * cutoff, and not archived.
 *
 * Only top-level rows are candidates — subtasks ride along with their parent
 * in dbBulkDeleteTasks. A completed subtask under a *live* parent is part of
 * that task rather than history, and deleting it would silently un-check a
 * step of something the user is still working on.
 *
 * Archived rows are exempt on purpose. Archiving is the user explicitly
 * filing something away to keep, and the Archived screen is the one place
 * they'd go looking for it; a retention window is about the tombstones
 * accumulating behind their back, not about the things they chose to keep.
 *
 * **An answered decision task is exempt for exactly that reason.** Its
 * `deliverableValue` is not a record that the task happened — it's a value the
 * user typed and expects to be able to read back ("we're going on the 12th"),
 * and on a one-off task this row is the only thing holding it. Deleting it
 * would be the data-loss case the "defaults to forever" note above exists to
 * avoid, arriving three months late and silently. The exemption is narrow on
 * purpose: a decision task completed *without* an answer recorded nothing, so
 * it's an ordinary tombstone and purges with the rest.
 *
 * **Streaks survive this.** streakCount/streakDate and their previous* snapshot
 * live on the row that carries the streak — the live occurrence — and are never
 * summed back across the chain, so deleting old tombstones can't shorten a
 * streak. The backward pointers that *do* cross rows (previousOccurrenceId,
 * blockedById) are all resolve-or-shrug at every reader: canBlock(undefined) is
 * false, and every previousOccurrenceId walk stops when the lookup misses. They
 * already dangle this way after a manual Logbook delete, so a purge leaves them
 * as-is rather than rewriting rows it isn't deleting.
 */
export function selectPurgeableTaskIds(tasks: Task[], cutoff: Date): string[] {
  return tasks
    .filter(
      t =>
        !t.parentId &&
        t.completed &&
        !t.archived &&
        !(deliverableKindFor(t) !== null && t.deliverableValue !== null) &&
        t.completedAt !== null &&
        new Date(t.completedAt).getTime() < cutoff.getTime()
    )
    .map(t => t.id);
}
