import { addDays } from 'date-fns/addDays';
import type { Task } from '../types';
import { hhmmToDate, logicalDayStart, taskDayStart } from './clockTime';

/**
 * What failing a task costs: the apps picked in Settings, blocked for a while.
 *
 * The sibling of `focusShield.ts`, and deliberately the same shape — pure
 * arithmetic over state passed in as arguments, with the delivery living
 * elsewhere. Both feed one reconciler (`appShield.ts`), because both drive the
 * *same* system shield and a second independent one would clear the first's
 * block the moment its own reason ended.
 *
 * Two things fail a task, and they are not symmetrical:
 *
 * - A **positive** task fails by still being incomplete when its cutoff passes.
 *   Nothing runs at that moment — iOS may never grant a background refresh, and
 *   "can decide never" is the documented behaviour — so the charge is found
 *   afterwards by a sweep, which is why it needs both an idempotency stamp and
 *   the staleness rule below.
 * - A **negative** task fails on a tap. `logSlip` is already the failure report,
 *   so there is nothing to sweep for, nothing to be late about and nothing to
 *   make idempotent: every slip is its own event and charges its own block.
 *
 * Nothing here touches the store or the clock. `now` is always a parameter, so
 * a test states the moment rather than arranging for it.
 */

/**
 * The moment a positive task has to have been finished by, or null when it
 * cannot be late at all.
 *
 * Null covers the three shapes with nothing to be late against: a task with no
 * penalty configured, a negative task (which has no cutoff — see above), and a
 * task with no `dueDate`. That last one is the same refusal `isTaskExpired`
 * makes and for the same reason: a task carrying no day has no day to have
 * missed, and inventing one would make "someday" tasks punishable.
 *
 * The clock arithmetic is the part worth reading twice. A cutoff is a time of
 * day laid over the task's *logical* day, so under a 02:00 reset the logical
 * day that starts Monday runs to Tuesday 02:00, and a cutoff of "01:00" means
 * Tuesday's 01:00 — the small hours at the end of that day, not a moment 23
 * hours before it began. Comparing the assembled cutoff against the day's own
 * start is what sorts the two cases, which is why this is arithmetic rather
 * than a branch on whether the string sorts below `dayResetTime`.
 *
 * A cutoff landing exactly on the day's start is read as the day's *end* for
 * the same reason a missing one is: a deadline at the first instant of the day
 * would be missed before the day had begun, which is never what it meant.
 */
export function penaltyCutoffAt(task: Task, dayResetTime: string): Date | null {
  if (task.penaltyMinutes === null) return null;
  if (task.polarity === 'negative') return null;
  if (!task.dueDate) return null;

  const dayStart = taskDayStart(new Date(task.dueDate), dayResetTime);
  if (task.penaltyCutoffTime === null) return addDays(dayStart, 1);

  const cutoff = hhmmToDate(task.penaltyCutoffTime, dayStart);
  return cutoff <= dayStart ? addDays(cutoff, 1) : cutoff;
}

/** A charge that fell due: what to stamp on the row, and what to block until. */
export interface PenaltyCharge {
  /** ISO instant to write to `Task.penaltyFiredAt`. Always the cutoff itself. */
  firedAt: string;
  /**
   * When the block this charge buys should run out, or null when the charge is
   * recorded but served no block — see the staleness rule in `penaltyChargeFor`.
   */
  until: Date | null;
}

/**
 * The charge a positive task owes right now, or null when it owes nothing.
 *
 * `excused` is a required option rather than something worked out here, for the
 * reason `cleanDayPatch` takes `{ paused }`: the answer needs the two stores
 * this module must not import, and making the caller state it keeps the rule
 * visible at the call site instead of buried behind a default. Pass true for a
 * task the person could not have done — held back waiting on another task or a
 * person, or hidden by vacation mode. Punishing somebody for a task the app
 * itself was withholding is the one outcome this feature must not have, and it
 * is exactly the distinction `isVisibleApartFromVacation` already draws between
 * "not yet today" and "cannot be done at all".
 *
 * **`until` can be null on a charge that is otherwise real.** A sweep finds
 * misses whenever it happens to run, which may be a day later or, via the
 * background refresh, at four in the morning. A charge is only *served* when
 * its cutoff falls inside the logical day the sweep is running in; older ones
 * are stamped and let go. Without that, a week away from the app would come
 * back as seven charges stacking into one enormous block (see
 * `extendShieldUntil`, which never shortens), all of them for days too far gone
 * to connect the block to the miss that earned it. Stamping rather than
 * skipping is what stops the same dead charge being reconsidered on every
 * launch forever.
 */
export function penaltyChargeFor(
  task: Task,
  now: Date,
  dayResetTime: string,
  { excused }: { excused: boolean },
): PenaltyCharge | null {
  if (task.penaltyMinutes === null) return null;
  if (task.penaltyFiredAt !== null) return null;
  if (task.completed || task.archived) return null;
  if (excused) return null;

  const cutoff = penaltyCutoffAt(task, dayResetTime);
  if (cutoff === null || now < cutoff) return null;

  const servable = logicalDayStart(now, dayResetTime) <= cutoff;
  return {
    firedAt: cutoff.toISOString(),
    until: servable ? new Date(now.getTime() + task.penaltyMinutes * 60_000) : null,
  };
}

/**
 * How long a slip on a negative task blocks for, measured from the tap, or null
 * when that task carries no penalty.
 *
 * No cutoff, no stamp and no staleness: the tap is the failure and it just
 * happened, so the only question left is how long.
 *
 * **`undoSlip` deliberately does not lift the block**, though it does take back
 * the slip itself. Undo here corrects the record — the count and the streak —
 * and a block already being served is a consequence rather than a record. The
 * alternative is a hole straight through the feature: with the block retracted
 * too, anyone sitting out a missed deadline could log a slip against any
 * negative task and undo it a second later to buy their apps back. Accidental
 * taps are answered where they happen instead, by asking first (see the slip
 * confirmation in `TaskItem`), which costs one tap and closes nothing.
 */
export function slipPenaltyUntil(task: Task, now: Date): Date | null {
  if (task.penaltyMinutes === null) return null;
  if (task.polarity !== 'negative') return null;
  return new Date(now.getTime() + task.penaltyMinutes * 60_000);
}

/**
 * Fold a new block into whatever is already being served, keeping the later end.
 *
 * Charges accumulate rather than replace, which is the only answer that can't
 * be gamed: taking the *new* end would let a second failure five minutes into a
 * two-hour block cut it down to the length of the shorter one, so failing twice
 * would be a way out of failing once.
 */
export function extendShieldUntil(current: string | null, candidate: Date): string {
  if (current === null) return candidate.toISOString();
  const existing = new Date(current);
  return existing > candidate ? existing.toISOString() : candidate.toISOString();
}

/**
 * Whether a penalty block should be in force at this moment.
 *
 * Every arm but one returns false, the same asymmetry `shieldWanted` has in
 * `focusShield.ts` and for the same reason: this is asked about states the rest
 * of the app may grow, and the safe answer to an unfamiliar one is to unblock.
 */
export function penaltyShieldWanted(until: string | null, enabled: boolean, now: Date): boolean {
  if (!enabled || until === null) return false;
  return new Date(until) > now;
}
