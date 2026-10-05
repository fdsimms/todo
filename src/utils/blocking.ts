import type { AnswerGate, Person, Task } from '../types';
import { deliverableOptionsFor } from './deliverables';

/**
 * "Waiting on" — task-to-task blocking (see Task.blockedById). A task can wait
 * on several, and waits for all of them (Task.blockedByIds).
 *
 * Everything here is pure and takes its task data as a parameter, matching the
 * other utils in this folder (pinSuggest, projectPull, deloadPlan). The one hot
 * caller — isTaskVisible — supplies a memoized lookup rather than an array, so
 * resolving a blocker stays O(1) per row instead of a find() per visibility
 * check.
 */

/** Resolves a task id to its row, or undefined if there's no such task. */
export type TaskResolver = ((id: string) => Task | undefined) & {
  /**
   * The row a task's completion spawned (`previousOccurrenceId` pointing back
   * at it), if it has one. Optional: a resolver without it simply can't follow
   * a series, so `waitForSeriesEnd` holds nothing there.
   */
  successorOf?: (id: string) => Task | undefined;
};

/** Build a resolver over a plain array. For tests and cold paths. */
export function resolverFor(tasks: Task[]): TaskResolver {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const next = new Map<string, Task>();
  for (const t of tasks) {
    if (t.previousOccurrenceId && !t.archived) next.set(t.previousOccurrenceId, t);
  }
  const resolve: TaskResolver = id => byId.get(id);
  resolve.successorOf = id => next.get(id);
  return resolve;
}

/**
 * Whether a task is currently capable of holding something else back.
 *
 * This is the whole derivation, and the reason nothing is written when a
 * blocker completes: a missing row (deleted) and an archived row both stop
 * blocking on their own, so deleteTask/archiveTask need no cascade. A stored
 * "unblocked" flag would need one in each, and a missed cascade strands the
 * waiter invisible with no user action able to recover it.
 */
export function canBlock(task: Task | undefined): boolean {
  return task != null && !task.completed && !task.archived;
}

/**
 * Every task this one waits on, in order, repeats dropped: `blockedById`
 * first, then `blockedByIds`. The one read of the set, so no reader can treat
 * the first as the whole of it.
 */
export function blockerIdsOf(task: Pick<Task, 'blockedById'> & { blockedByIds?: readonly string[] }): string[] {
  const ids: string[] = [];
  for (const id of [task.blockedById, ...(task.blockedByIds ?? [])]) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The two fields that store a set of blockers, in step: the first in
 * `blockedById`, where everything written before the list existed looks, and
 * the rest in `blockedByIds`. The one writer, so the list never has entries
 * while the single field is empty.
 */
export function blockerFields(ids: readonly string[]): Pick<Task, 'blockedById'> & { blockedByIds: string[] } {
  const unique = ids.filter((id, i) => !!id && ids.indexOf(id) === i);
  return { blockedById: unique[0] ?? null, blockedByIds: unique.slice(1) };
}

/**
 * Every task this one waits for: its blockers, then the question its
 * `answerGate` waits on. A read for holding back only — never write this back
 * through `blockerFields`, which would turn the question into a blocker.
 */
export function waitIdsOf(task: Pick<Task, 'blockedById' | 'answerGate'> & { blockedByIds?: readonly string[] }): string[] {
  const ids = blockerIdsOf(task);
  const gate = task.answerGate?.taskId;
  if (gate && !ids.includes(gate)) ids.push(gate);
  return ids;
}

/**
 * Whether a recorded answer is one of the answers a gate opens on. Matched as
 * the option's text, ignoring case and outer spaces, the way template
 * conditions compare (see `TemplateItemCondition`).
 */
export function answerOpensGate(gate: AnswerGate, value: string | null | undefined): boolean {
  if (value == null) return false;
  const v = value.trim().toLowerCase();
  return gate.answers.some(a => a.trim().toLowerCase() === v);
}

/**
 * True when a task belongs to a branch that was not taken, so it will never
 * be done: "Book City Hall" once "Ceremony format?" was answered "Officiant".
 *
 * **Derived, never stored**, the same call `canBlock` makes and for the same
 * reason: answers get corrected after the fact (`setDeliverableValue`), and a
 * stored flag would need a cascade at every place an answer or a completion
 * changes. Worked out here, a corrected answer swaps the branches on its own.
 *
 * Three ways in:
 * - its `answerGate` question was answered with something else. A question
 *   completed *without* an answer, archived or deleted opens the gate instead:
 *   nobody chose a branch, and a hidden task with no way back is the failure
 *   `canBlock` exists to prevent.
 * - its gate question is itself not needed, so it will never be answered.
 * - everything it still waits on is not needed. "Pay the City Hall fee",
 *   waiting only on "Book City Hall", goes with it. A task also waiting on
 *   something live waits for that alone (see `isBlocked`), which is what lets
 *   "Send invitations" wait on whichever venue branch was taken.
 */
export function isNotNeeded(task: Task, resolve: TaskResolver, seen: Set<string> = new Set()): boolean {
  if (task.completed || task.archived) return false;
  // A loop that arrived some other way would otherwise spin; on the way back
  // round, a task in it isn't evidence either way.
  if (seen.has(task.id)) return false;
  seen.add(task.id);

  const gate = task.answerGate;
  if (gate) {
    const question = resolve(gate.taskId);
    if (question && !question.archived) {
      if (question.completed) {
        if (question.deliverableValue != null && !answerOpensGate(gate, question.deliverableValue)) return true;
      } else if (isNotNeeded(question, resolve, seen)) {
        return true;
      }
    }
  }

  const live = blockerIdsOf(task).map(resolve).filter((t): t is Task => canBlock(t));
  return live.length > 0 && live.every(b => isNotNeeded(b, resolve, new Set(seen)));
}

/** Whether a waiting task still has to wait for `t`: open, and on a branch that's still live. */
function holds(t: Task | undefined, resolve: TaskResolver): t is Task {
  return canBlock(t) && !isNotNeeded(t!, resolve);
}

/**
 * The occurrence of a repeating blocker that is still open, found by following
 * completed occurrences to the successor each one spawned. Undefined when the
 * series has ended: the last occurrence is done, or its successor was archived
 * or deleted. This is what `waitForSeriesEnd` waits on, derived each time so
 * uncompleting an occurrence (which deletes its successor) needs no cascade.
 */
export function openOccurrenceOf(t: Task | undefined, resolve: TaskResolver): Task | undefined {
  const seen = new Set<string>();
  let cur = t;
  while (cur && !seen.has(cur.id)) {
    if (canBlock(cur)) return cur;
    if (cur.archived) return undefined;
    seen.add(cur.id);
    cur = resolve.successorOf?.(cur.id);
  }
  return undefined;
}

/**
 * The task holding `waiter` back on account of the blocker `id`, or undefined.
 * With `waitForSeriesEnd` a finished blocker hands over to its open successor.
 */
function holder(waiter: Task, id: string, resolve: TaskResolver): Task | undefined {
  const t = resolve(id);
  if (holds(t, resolve)) return t;
  if (!waiter.waitForSeriesEnd || !blockerIdsOf(waiter).includes(id)) return undefined;
  const open = openOccurrenceOf(t, resolve);
  return holds(open, resolve) ? open : undefined;
}

/**
 * The tasks still holding this one back, in order: every blocker that can
 * still block, then an unanswered gate question. A blocker on a branch not
 * taken holds nothing.
 */
export function liveBlockersOf(task: Task, resolve: TaskResolver): Task[] {
  return waitIdsOf(task)
    .map(id => holder(task, id, resolve))
    .filter((t): t is Task => t !== undefined);
}

/**
 * The first task this one is still waiting on, or undefined if it isn't
 * waiting. With several, the others are `liveBlockersOf`; this is the one a
 * row names.
 */
export function blockerOf(task: Task, resolve: TaskResolver): Task | undefined {
  return liveBlockersOf(task, resolve)[0];
}

/**
 * True while `task` is held back by another task that isn't done yet. With
 * several blockers it waits for all of them: any one still open holds it.
 */
export function isBlocked(task: Task, resolve: TaskResolver): boolean {
  return waitIdsOf(task).some(id => holder(task, id, resolve) !== undefined);
}

/** Resolves a person id to their row, or undefined. `peopleRegistry` supplies it. */
export type PersonResolver = (id: string) => Person | undefined;

/**
 * Somebody still worth waiting on: on file, and not filed away.
 *
 * **`canBlock` for people**, and deliberately the same shape. A deleted person
 * resolves to nothing and an archived one is an explicit "out of my way", so
 * either frees their waiters rather than stranding them — which is what makes a
 * cascade unnecessary when a person is deleted, exactly as it is when a blocker
 * task is. A stranded waiter is invisible with no user action able to recover
 * it, which is the failure this shape exists to make impossible.
 */
export function canWaitOn(person: Person | undefined): boolean {
  return person != null && !person.archived;
}

/** The person this task is waiting on, or undefined if it isn't waiting on one. */
export function personBlockerOf(task: Pick<Task, 'waitingOnPersonId'>, resolve: PersonResolver): Person | undefined {
  if (!task.waitingOnPersonId) return undefined;
  const person = resolve(task.waitingOnPersonId);
  return canWaitOn(person) ? person : undefined;
}

/**
 * True while `task` is held back by somebody.
 *
 * **Nothing ends this on its own**, which is the one real difference from
 * `isBlocked`: a blocker task completes and frees its waiters, and nobody
 * completes a person. So the clearing action lives on the row and on the
 * Waiting screen rather than only in the editor — see `Task.waitingOnPersonId`.
 */
export function isWaitingOnPerson(task: Pick<Task, 'waitingOnPersonId'>, resolve: PersonResolver): boolean {
  return personBlockerOf(task, resolve) !== undefined;
}

/**
 * Would pointing `taskId` at `blockerId` close a loop?
 *
 * Walks up the blockedById chain from the proposed blocker looking for the task
 * being edited. Guards the picker — a cycle makes every task in it permanently
 * invisible, since each is waiting on something that can never complete.
 *
 * The visited set is not just for the loop we're trying to create: a cycle that
 * arrived some other way (a future import or bulk path) would otherwise spin
 * here forever, and this runs during render.
 */
export function wouldCycle(taskId: string, blockerId: string, resolve: TaskResolver): boolean {
  // A walk over every blocker each task has, now that a task can wait on
  // several: the loop can close through any of them.
  const seen = new Set<string>();
  const stack = [blockerId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue; // pre-existing loop, doesn't reach taskId
    seen.add(current);
    const row = resolve(current);
    // Through the gate question too: a task can't wait on the answer to a
    // question that itself waits on it.
    if (row) stack.push(...waitIdsOf(row));
  }
  return false;
}

/**
 * Where the waiting task sits, so the picker can float its neighbours to the top.
 *
 * Taken as loose fields rather than a Task because the caller is an open editor:
 * the user may have just moved the task into a stack and not saved yet, and the
 * picker should rank against what they're looking at, not against the row.
 */
export interface BlockerContext {
  groupId?: string | null;
  projectId?: string | null;
  category?: string | null;
}

/**
 * How near a candidate is to the waiting task — 0 is nearest, 3 is unrelated.
 *
 * Stack beats project beats category because that's the order of how
 * deliberately the user put the two tasks together: a stack is hand-assembled,
 * a project is a shared goal, a category is a bucket half the list is in. A
 * null side never matches — "neither is in a project" isn't a relationship.
 */
export function blockerAffinity(task: Task, ctx: BlockerContext): number {
  if (ctx.groupId && task.groupId === ctx.groupId) return 0;
  if (ctx.projectId && task.projectId === ctx.projectId) return 1;
  if (ctx.category && task.category === ctx.category) return 2;
  return 3;
}

/**
 * Orders picker candidates by affinity, keeping the incoming order within each
 * tier — which is the store's order for the unsearched list and the match score
 * for a searched one, so relevance still decides among equals.
 *
 * Sorting before the list is truncated is the point: what a task waits on is
 * nearly always something next to it, and those can sit arbitrarily deep in a
 * few hundred tasks.
 */
export function sortByBlockerAffinity(tasks: Task[], ctx: BlockerContext): Task[] {
  return tasks
    .map((task, index) => ({ task, index, tier: blockerAffinity(task, ctx) }))
    .sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : a.index - b.index))
    .map(e => e.task);
}

/**
 * The live tasks waiting on this one — the "N waiting" chip on a blocker's row.
 *
 * Completed and archived waiters are excluded: the chip is about work queued
 * behind this task, and a waiter that's already done or filed away isn't that.
 */
export function waitingOn(taskId: string, tasks: Task[]): Task[] {
  return tasks.filter(t => !t.completed && !t.archived && !t.parentId && blockerIdsOf(t).includes(taskId));
}

/**
 * Whether `candidate` can be offered as the task `taskId` waits on.
 *
 * Pulled out of the picker now that the same sheet fills the relationship from
 * either end. The rules a candidate has to pass are the ones a blocker needs:
 * it has to be a live top-level row, and pointing at it must not close a loop —
 * a cycle makes every task in it permanently invisible, since each is waiting
 * on something that can never complete.
 *
 * A null `taskId` is a task being created: it has no row to loop back to yet.
 */
export function canBeBlockerOf(candidate: Task, taskId: string | null, resolve: TaskResolver): boolean {
  if (candidate.parentId || candidate.completed || candidate.archived) return false;
  if (candidate.id === taskId) return false;
  return !(taskId && wouldCycle(taskId, candidate.id, resolve));
}

/**
 * Whether `candidate` can be the question task `taskId`'s answer gate rides on.
 *
 * It has to ask a pick-one question ('choice' with options, or 'yesno'), since
 * a gate opens on listed answers and a free-text or number answer has none to
 * list. Unlike a blocker it may already be done: gating on a decision already
 * made is fine, and is simply settled the moment it's saved. The cycle check
 * is the same one, since an unanswered question holds its gated tasks back.
 */
export function canBeGateOf(candidate: Task, taskId: string | null, resolve: TaskResolver): boolean {
  if (candidate.parentId || candidate.archived) return false;
  if (candidate.id === taskId) return false;
  if (deliverableOptionsFor(candidate).length < 2) return false;
  return !(taskId && wouldCycle(taskId, candidate.id, resolve));
}

/**
 * Whether `candidate` can be offered as something `blockerId` blocks — that
 * is, whether `blockerId` may be added to what it waits on.
 *
 * The same eligibility with the cycle check turned round. A candidate already
 * waiting on some other task is fine: it gains this one as well and waits for
 * both. (It used to be left out, when a task could wait on one thing only and
 * taking it would have dropped the relationship set from over there.)
 */
export function canBeBlockedBy(candidate: Task, blockerId: string | null, resolve: TaskResolver): boolean {
  if (candidate.parentId || candidate.completed || candidate.archived) return false;
  if (candidate.id === blockerId) return false;
  return !(blockerId && wouldCycle(candidate.id, blockerId, resolve));
}

/** The writes that make `taskIds` the set of tasks waiting on `blockerId`. */
export interface BlocksEdit {
  /** Tasks to add the blocker to. */
  link: string[];
  /** Tasks to take the blocker off, leaving whatever else they wait on. */
  unlink: string[];
}

/**
 * Turns "these are the tasks this one blocks" into the writes that say so.
 *
 * The releases come from `waitingOn`, so completed and archived waiters are
 * never touched: a task that was held up by this one and has since been done
 * is history, and rewriting its pointer would edit the record of what it
 * waited for. The links are re-checked against `canBeBlockedBy` rather than
 * trusted — the picker filters the same way, but a set assembled with the
 * editor open can be saved against a task list that has moved on since.
 */
export function resolveBlocksEdit(blockerId: string, taskIds: string[], tasks: Task[]): BlocksEdit {
  const resolve = resolverFor(tasks);
  const wanted = new Set(taskIds);
  const link = [...wanted].filter(id => {
    const task = resolve(id);
    return task != null && !blockerIdsOf(task).includes(blockerId) && canBeBlockedBy(task, blockerId, resolve);
  });
  const unlink = waitingOn(blockerId, tasks).filter(t => !wanted.has(t.id)).map(t => t.id);
  return { link, unlink };
}

/**
 * The "Blocks" row's value in the task editor — one task's name, or a count.
 *
 * Two names truncate mid-word at 390pt (the row renders its value on one
 * line), the same call `describeSubstitutes` makes, and the names are all
 * listed under the row the moment it's open. A title that no longer resolves
 * comes through as an empty string and is named as the missing row it is,
 * matching what the "Waiting on" row says about a deleted blocker.
 */
export function describeBlocks(titles: string[]): string | undefined {
  if (titles.length === 0) return undefined;
  if (titles.length === 1) return titles[0] || 'Task no longer exists';
  return `${titles.length} tasks`;
}
