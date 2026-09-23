import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Person, Task } from '../types';
import { getDayStart } from './dateUtils';
import { canWaitOn } from './blocking';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';
import { displayTitleFor } from './visibilityUtils';

/**
 * "Follow up with Dustin about 'Get the quote back'" — a task waiting on
 * somebody (`Task.waitingOnPersonId`), waited on long enough, becomes a task
 * of its own.
 *
 * Structurally this is `reachOutTasks.ts` one shelf over, sourced on the
 * waiting task rather than the person: a person can be the far end of several
 * independent waits at once ("waiting on Dustin for the photos" and "waiting
 * on Dustin to confirm Saturday" are two different things to be nudged
 * about), and it's the *task* that stops wanting a nudge — released,
 * completed, archived, deleted — not the person. See `GeneratedKind`'s own
 * note on 'waitingFollowUp' for why the source is the task.
 *
 * Pure, and takes `today` rather than reading the clock, matching every other
 * generator's rules module.
 */

/** Row-per-wait ceiling, the same two `reachOut` caps itself at: these arrive
 * uninvited and are about a person on the other end, same as that one. */
export const MAX_WAITING_FOLLOW_UP_TASKS = 2;

/** How long a swipe-away holds for — reachOut's own constant and reasoning:
 * a nudge about a wait ending tomorrow reads as the app disagreeing with you
 * about it, not as work still open. */
export const WAITING_FOLLOW_UP_DECLINE_DAYS = 7;

/** How long a wait has to have gone on before it's worth a nudge about. */
export const WAITING_FOLLOW_UP_THRESHOLD_DAYS = 7;

/** The waiting task a follow-up task speaks for, or null for any other task. */
export function waitingFollowUpTaskId(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  return generatedSourceOf(task, 'waitingFollowUp');
}

/** The row's title — names the person and the thing they're holding up. */
export function waitingFollowUpTitle(
  person: Pick<Person, 'name' | 'nickname'>,
  waitingTask: Task
): string {
  const who = person.nickname.trim() || person.name.trim();
  return `Follow up with ${who} about "${displayTitleFor(waitingTask)}"`;
}

/** Whether this wait's nudge was swiped away recently enough to still hold. */
function declinedRecently(task: Pick<Task, 'waitingFollowUpDeclinedAt'>, today: Date): boolean {
  if (!task.waitingFollowUpDeclinedAt) return false;
  const since = differenceInCalendarDays(today, getDayStart(new Date(task.waitingFollowUpDeclinedAt)));
  return since < WAITING_FOLLOW_UP_DECLINE_DAYS;
}

/**
 * Waiting tasks whose nudge has already been dealt with, and for how long
 * that counts.
 *
 * Ticking a follow-up off leaves no live task, so without this the next sweep
 * writes an identical one straight back — the same blind spot
 * `reachOutsHandledRecently` covers, and for the same reason: completing
 * "Follow up with Dustin about the quote" answers *this* nudge, not the wait
 * itself, which is still open until the task it names is released or done.
 * Held for the decline window rather than the day, matching reachOut.
 */
export function waitingFollowUpsHandledRecently(
  tasks: readonly Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'completedAt' | 'archived' | 'archivedAt'>[],
  today: Date,
  holdDays: number = WAITING_FOLLOW_UP_DECLINE_DAYS
): Set<string> {
  const done = new Set<string>();
  for (const task of tasks) {
    const waitingTaskId = waitingFollowUpTaskId(task);
    if (!waitingTaskId) continue;
    const stamp = (task.completed && task.completedAt) || (task.archived && task.archivedAt) || null;
    if (!stamp) continue;
    if (differenceInCalendarDays(today, getDayStart(new Date(stamp))) < holdDays) done.add(waitingTaskId);
  }
  return done;
}

/** One wait that should have a follow-up task sitting on the list right now. */
export interface WaitingFollowUpWant {
  taskId: string;
  personId: string;
  title: string;
  phoneNumber: string | null;
}

/**
 * Which waits should have a nudge right now.
 *
 * Order follows `tasks` (the store's own order) rather than ranking by how
 * long each has been waiting — the same refusal `reachOut` makes about
 * ranking people by neglect applies here with a task standing in for a
 * person: sorting the due set by longest-waiting would still be the app
 * quietly deciding whose wait matters most, just measured on the task instead
 * of the person.
 */
export function wantedWaitingFollowUps(
  tasks: readonly Task[],
  people: readonly Person[],
  today: Date,
  handledRecently: ReadonlySet<string> = new Set(),
  cap: number = MAX_WAITING_FOLLOW_UP_TASKS
): WaitingFollowUpWant[] {
  const peopleById = new Map(people.map(p => [p.id, p]));
  const wants: WaitingFollowUpWant[] = [];
  for (const task of tasks) {
    if (wants.length >= Math.max(0, cap)) break;
    if (task.completed || task.archived || task.parentId) continue;
    if (!task.waitingOnPersonId) continue;
    const person = peopleById.get(task.waitingOnPersonId);
    if (!canWaitOn(person)) continue;
    if (handledRecently.has(task.id)) continue;
    if (declinedRecently(task, today)) continue;
    // No stamp is a task waiting on somebody from before this generator
    // existed — treated as "not long enough yet" rather than guessed at,
    // the same refusal `hasNoDateSignal`'s callers make about a field that
    // predates the read asking about it.
    if (!task.waitingOnPersonSince) continue;
    const waitingDays = differenceInCalendarDays(today, getDayStart(new Date(task.waitingOnPersonSince)));
    if (waitingDays < WAITING_FOLLOW_UP_THRESHOLD_DAYS) continue;
    wants.push({
      taskId: task.id,
      personId: person!.id,
      title: waitingFollowUpTitle(person!, task),
      phoneNumber: person!.phoneNumber,
    });
  }
  return wants;
}

/**
 * The follow-up tasks sitting there whose reason has gone.
 *
 * A wait stops being one the moment its task is released, completed,
 * archived or deleted, or the person it named is deleted or archived — none
 * of which knows a "Follow up with X" row is sitting on Today naming the old
 * state. Same reasoning `staleReachOutTasks`/`staleProjectReviewTasks` give
 * for running this on a sweep rather than only at creation.
 */
export function staleWaitingFollowUpTasks<
  T extends Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>
>(
  tasks: readonly T[],
  waitingTasks: readonly Pick<Task, 'id' | 'completed' | 'archived' | 'waitingOnPersonId'>[],
  people: readonly Person[]
): T[] {
  const peopleById = new Map(people.map(p => [p.id, p]));
  const waitingById = new Map(waitingTasks.map(t => [t.id, t]));
  return liveGeneratedTasksOfKind(tasks, 'waitingFollowUp').filter(task => {
    const waitingTaskId = waitingFollowUpTaskId(task);
    const source = waitingTaskId ? waitingById.get(waitingTaskId) : undefined;
    if (!source || source.completed || source.archived) return true;
    if (!source.waitingOnPersonId) return true;
    return !canWaitOn(peopleById.get(source.waitingOnPersonId));
  });
}
