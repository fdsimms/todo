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
 * The minutes finishing this task gives back, or null when it gives back
 * nothing.
 *
 * **A credit shortens a block that is already being served; it never buys time
 * you were not otherwise blocked from.** That distinction is the whole design.
 * The inverse of a penalty is the penalty coming off, and anything that hands
 * out unblocked minutes on its own is a rewards feature wearing this one's
 * clothes — it would mean the app blocking apps it had no reason to block, so
 * that finishing something could unblock them.
 *
 * Which is why the credit is not a number of its own: it is *this task's own*
 * `penaltyMinutes`, given back by the task that charged them. You cannot
 * manufacture one, because there is nothing to credit until this row has
 * actually cost you something.
 *
 * Four refusals, and each is one of `penaltyChargeFor`'s read backwards:
 *
 * - **Never charged, nothing to give back.** No `penaltyFiredAt` means this row
 *   has taken nothing from anybody, and finishing it on time is the ordinary
 *   case rather than a transaction.
 * - **A charge that was recorded but never served gives nothing**, tested the
 *   same way `penaltyChargeFor` decides not to serve it: a charge whose cutoff
 *   falls outside the logical day being asked about bought no block, and
 *   refunding a block that was never imposed is inventing credit. The two rules
 *   have to agree, or a week away from the app would come back as seven
 *   unserved charges that could each be cashed in.
 * - **Once only.** `penaltyCreditedAt` is the stamp, so completing, undoing and
 *   completing again yields one credit. Without it the whole feature is a
 *   button that prints minutes.
 * - **A negative task never credits.** There is nothing to *do* that undoes a
 *   slip — that is what makes it a slip — so the only way to claim one would be
 *   retracting the record, which is exactly what `undoSlip` refuses to pay for.
 *   A credit model that hands back what `undoSlip` will not is the same hole
 *   from the other side.
 */
export function penaltyCreditFor(
  task: Task,
  now: Date,
  dayResetTime: string,
): number | null {
  if (task.penaltyMinutes === null) return null;
  if (task.polarity === 'negative') return null;
  if (task.penaltyFiredAt === null) return null;
  if (task.penaltyCreditedAt !== null) return null;

  // The mirror of `penaltyChargeFor`'s `servable`: a charge stamped for a
  // cutoff outside today's logical day was let go rather than served.
  const firedAt = new Date(task.penaltyFiredAt);
  if (logicalDayStart(now, dayResetTime) > firedAt) return null;

  return task.penaltyMinutes;
}

/**
 * Take `minutes` off a standing block, and never off anything else.
 *
 * The inverse of `extendShieldUntil`, and deliberately its mirror in the one
 * way that matters: that one keeps the later end so a second failure cannot
 * shorten the first's block, and this one floors at `now` so a credit cannot
 * push the end *before* the present and bank the difference against a future
 * charge. Minutes already served are spent; only what is left can come back.
 *
 * Null out means no block, which is the same value `penaltyShieldUntil` holds
 * when nothing is being served — so a credit that covers the whole remainder
 * ends the block rather than leaving a stale instant behind.
 *
 * It knows nothing about the gate or the focus shield, and must not: those are
 * two of the three reasons `appShield` ORs together, and a credit earned
 * against a penalty has no business clearing a block somebody's own gate is
 * holding. Shortening this one value is what keeps that true by construction.
 */
export function creditShieldUntil(
  until: string | null,
  minutes: number,
  now: Date,
): string | null {
  if (until === null) return null;
  const end = new Date(until);
  // Already run out: there is nothing left to give back, and moving the
  // instant further into the past would do nothing but confuse a later read.
  if (end <= now) return until;
  const credited = new Date(end.getTime() - minutes * 60_000);
  return credited <= now ? null : credited.toISOString();
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
