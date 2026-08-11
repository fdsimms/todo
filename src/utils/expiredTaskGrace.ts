/**
 * Auto-remove expired tasks — the pure half of "delete after N days".
 *
 * This used to be a boolean: delete the instant a time window closes, or keep
 * the task in the Expired section forever until deleted by hand. Both are
 * extremes — the middle ground people actually want is a grace period to
 * notice the task expired before it's swept away.
 *
 * `null` = Never (keep forever, the old `false`), `0` = Immediately (delete on
 * window close, the old `true`), and a positive count of days is the grace
 * period sweepExpiredTasks waits past the window closing before deleting.
 * Days rather than hours for the same reason completedRetentionDays uses days
 * — the cutoff is one addition and needs no calendar-length special cases.
 */

export type ExpiredTaskGraceDays = number | null;

export const EXPIRED_TASK_GRACE_OPTIONS: { value: ExpiredTaskGraceDays; label: string }[] = [
  { value: null, label: 'Never' },
  { value: 1, label: '1 day' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 0, label: 'Immediately' },
];

/** The Settings row's summary line. */
export function expiredTaskGraceLabel(days: ExpiredTaskGraceDays): string {
  return EXPIRED_TASK_GRACE_OPTIONS.find(o => o.value === days)?.label ?? 'Never';
}

/**
 * Parses the persisted `autoRemoveExpiredTasks` value, still read from the
 * same settings key the boolean used. Handles both shapes:
 *
 * - Legacy `'true'` / `'false'` from before this setting became a duration —
 *   `'true'` (delete on close) maps to `0` (Immediately) and `'false'` (keep
 *   forever) maps to `null` (Never), so an existing install's behaviour
 *   doesn't silently change on upgrade.
 * - The new shape: `''` for Never, or a stringified day count.
 *
 * Anything else unrecognised reads as Never, matching parseRetentionDays'
 * failure mode — a garbled value must fail toward keeping tasks, not deleting
 * them.
 */
export function parseExpiredTaskGrace(raw: string | null): ExpiredTaskGraceDays {
  if (raw === null || raw === '' || raw === 'false') return null;
  if (raw === 'true') return 0;
  const n = Number(raw);
  return EXPIRED_TASK_GRACE_OPTIONS.some(o => o.value === n) ? n : null;
}

/** What's written back to the settings table for a given grace value. */
export function serializeExpiredTaskGrace(days: ExpiredTaskGraceDays): string {
  return days === null ? '' : String(days);
}
