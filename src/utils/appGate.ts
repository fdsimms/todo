import type { Task } from '../types';

/**
 * Apps stay blocked until a task is done.
 *
 * The third reason the shield goes up, and the opposite direction from
 * `penaltyShield.ts`: that one is a consequence measured in minutes after a
 * task was failed, this is a precondition with no length of its own. A gate
 * ends when the task does, which means the person holding it decides how long
 * it lasts.
 *
 * Two things make that safe rather than a way to be locked out of a phone:
 *
 * - **There are always two one-tap exits**, completing the task or moving it to
 *   another day. Someone who ticks a walk they didn't take has defeated the
 *   feature, and that is fine: this is friction, not enforcement, and every
 *   self-restriction tool works the same way. What it must never be is a state
 *   somebody cannot get out of at all.
 * - **A gate is live exactly while its task is**, which is `isTaskVisible`'s
 *   answer and deliberately not a clock of this feature's own. That is what
 *   keeps "before my morning walk" from meaning eleven the night before, and it
 *   inherits every existing reason a task isn't yours to do yet: a deferral, a
 *   time-of-day segment, vacation mode, waiting on another task or a person.
 *   Being gated by something the app itself is withholding is the one outcome
 *   this must not have, and reusing that rule rules it out by construction —
 *   where `penaltyChargeFor` had to be handed the same answer as an argument
 *   and could be handed the wrong one.
 *
 * Store-free like its siblings: the visibility predicate arrives as a
 * parameter, so this stays testable with plain objects in the `node`
 * environment.
 */

/**
 * Whether this task gates the apps at all, ignoring whether it's outstanding.
 *
 * A negative task is refused here rather than merely hidden in the editor: it
 * is never completed (see `Task.polarity`), so a gate hung on one could never
 * be satisfied and would block for as long as the task existed. That is the
 * one shape of this feature that really would trap somebody, so it's refused
 * at the rule rather than at the UI that happens to write the field.
 */
export function isGateTask(task: Task): boolean {
  return task.gatesApps && task.polarity !== 'negative';
}

/**
 * The gate tasks standing between the person and their apps right now.
 *
 * `isVisible` is the caller's — `isTaskVisible` in practice — because it reads
 * two stores this module must not import. Completed and archived are checked
 * here anyway rather than left to it: they are facts on the row, and a reader
 * of this function shouldn't have to know whether the predicate it was handed
 * happens to cover them.
 */
export function outstandingGates(
  tasks: readonly Task[],
  isVisible: (task: Task) => boolean,
): Task[] {
  return tasks.filter(t => isGateTask(t) && !t.completed && !t.archived && isVisible(t));
}

/**
 * Whether a gate wants the apps blocked at this moment.
 *
 * Every arm but one returns false, the same asymmetry the other two shield
 * rules have: this is asked about states the rest of the app may grow, and the
 * safe answer to an unfamiliar one is to unblock.
 */
export function gateShieldWanted(outstanding: number, enabled: boolean): boolean {
  return enabled && outstanding > 0;
}

/**
 * The line the shield screen shows when a gate is what's blocking.
 *
 * Built here rather than in the extension, unlike the penalty's, and the reason
 * is grammar: a gate can be one task or several, and "isn't" against "are still
 * to do" is exactly the kind of thing that ends up wrong in a Swift file nobody
 * can run a test against. The penalty's sentence stays on the Swift side
 * because it needs a time formatted in the reader's own locale, which is the
 * one thing this side can't do.
 *
 * It says what to do as well as what's wrong. The screen has no way to offer
 * an action — the system draws it, and the only response a shield button can
 * give is to close the app — so naming where the task lives is as far as
 * pointing somebody at it can go.
 */
export function gateSubtitle(titles: readonly string[]): string | null {
  const named = titles.filter(t => t.trim().length > 0);
  if (named.length === 0) return null;

  const [first, ...rest] = named;
  if (rest.length === 0) {
    return `${first} isn't done yet. Finish it in dundundun to unblock.`;
  }
  const others = rest.length === 1 ? '1 more task' : `${rest.length} more tasks`;
  return `${first} and ${others} are still to do. Finish them in dundundun to unblock.`;
}
