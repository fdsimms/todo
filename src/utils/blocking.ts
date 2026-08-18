import type { Task } from '../types';

/**
 * "Waiting on" — task-to-task blocking (see Task.blockedById).
 *
 * Everything here is pure and takes its task data as a parameter, matching the
 * other utils in this folder (pinSuggest, projectPull, deloadPlan). The one hot
 * caller — isTaskVisible — supplies a memoized lookup rather than an array, so
 * resolving a blocker stays O(1) per row instead of a find() per visibility
 * check.
 */

/** Resolves a task id to its row, or undefined if there's no such task. */
export type TaskResolver = (id: string) => Task | undefined;

/** Build a resolver over a plain array. For tests and cold paths. */
export function resolverFor(tasks: Task[]): TaskResolver {
  const byId = new Map(tasks.map(t => [t.id, t]));
  return id => byId.get(id);
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

/** The task this one is waiting on, or undefined if it isn't waiting. */
export function blockerOf(task: Task, resolve: TaskResolver): Task | undefined {
  if (!task.blockedById) return undefined;
  const blocker = resolve(task.blockedById);
  return canBlock(blocker) ? blocker : undefined;
}

/** True while `task` is held back by another task that isn't done yet. */
export function isBlocked(task: Task, resolve: TaskResolver): boolean {
  return blockerOf(task, resolve) !== undefined;
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
  const seen = new Set<string>();
  let current: string | undefined = blockerId;
  while (current) {
    if (current === taskId) return true;
    if (seen.has(current)) return false; // pre-existing loop, doesn't reach taskId
    seen.add(current);
    current = resolve(current)?.blockedById ?? undefined;
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
  return tasks.filter(t => t.blockedById === taskId && !t.completed && !t.archived && !t.parentId);
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
 * Whether `candidate` can be offered as something `blockerId` blocks — that
 * is, whether its own `blockedById` may be pointed at `blockerId`.
 *
 * The same eligibility with the cycle check turned round, plus the one rule
 * this direction needs and the other doesn't: `blockedById` is a single
 * pointer, so a candidate already waiting on some *other* task can't be taken
 * without silently dropping a relationship set from over there. It's left out
 * of the list rather than offered and overwritten — the sheet says why, and
 * that task's own editor is still where its blocker changes.
 */
export function canBeBlockedBy(candidate: Task, blockerId: string | null, resolve: TaskResolver): boolean {
  if (candidate.parentId || candidate.completed || candidate.archived) return false;
  if (candidate.id === blockerId) return false;
  if (candidate.blockedById && candidate.blockedById !== blockerId) return false;
  return !(blockerId && wouldCycle(candidate.id, blockerId, resolve));
}

/** The writes that make `taskIds` the set of tasks waiting on `blockerId`. */
export interface BlocksEdit {
  /** Tasks to point at the blocker. */
  link: string[];
  /** Tasks to release, i.e. write `blockedById: null` to. */
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
    return task != null && task.blockedById !== blockerId && canBeBlockedBy(task, blockerId, resolve);
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
