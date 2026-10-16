import type { FocusStep } from '../types';

/**
 * How a focus session shows a stack.
 *
 * A session's plan is a flat list of per-task steps and stays one (see
 * `docs/arch/focus-sessions.md`): nothing here is stored, and nothing runs a
 * stack as a unit. These are two display reads over the order the rows
 * already have, so a stack's members look like a stack in the setup sheet and
 * the running session says where in it you are.
 */

/** What a row needs of a task to be placed: an id and the stack it hangs off. */
export interface StackedTask {
  id: string;
  groupId?: string | null;
}

/**
 * Where a row sits relative to its stack.
 *
 * - `tray`: one of two or more members of the same stack that are next to each
 *   other in the order. The first draws the stack's header, and the run is
 *   enclosed.
 * - `caption`: a member with no neighbour from its stack, so there is nothing
 *   to enclose, but the row still says which stack it came from.
 *
 * A task with no stack, or one whose stack is gone, has no placement.
 */
export type StackPlacement =
  | {
      kind: 'tray';
      groupId: string;
      name: string;
      /** Every member of this run, in order. */
      runIds: readonly string[];
      first: boolean;
      last: boolean;
    }
  | { kind: 'caption'; groupId: string; name: string };

/**
 * A run is derived from adjacency every time, never stored, so dragging a row
 * out of the middle splits it into two runs (each with its own header) and
 * dragging one next to its stack joins it. `names` maps a stack id to its
 * title; a member whose stack isn't in it (deleted) is treated as unstacked.
 */
export function stackPlacements(
  tasks: readonly StackedTask[],
  names: ReadonlyMap<string, string>,
): Map<string, StackPlacement> {
  const out = new Map<string, StackPlacement>();
  const nameOf = (t: StackedTask): string | null => (t.groupId ? names.get(t.groupId) ?? null : null);

  let i = 0;
  while (i < tasks.length) {
    const name = nameOf(tasks[i]);
    if (name === null) {
      i += 1;
      continue;
    }
    const groupId = tasks[i].groupId as string;
    let end = i + 1;
    while (end < tasks.length && tasks[end].groupId === groupId) end += 1;
    const run = tasks.slice(i, end);
    if (run.length === 1) {
      out.set(run[0].id, { kind: 'caption', groupId, name });
    } else {
      const runIds = run.map(t => t.id);
      run.forEach((t, k) => {
        out.set(t.id, { kind: 'tray', groupId, name, runIds, first: k === 0, last: k === run.length - 1 });
      });
    }
    i = end;
  }
  return out;
}

/** A run's tick state: every member in, none, or some. */
export type RunSelection = 'all' | 'none' | 'some';

export function runSelection(runIds: readonly string[], selected: ReadonlySet<string>): RunSelection {
  const n = runIds.filter(id => selected.has(id)).length;
  if (n === 0) return 'none';
  return n === runIds.length ? 'all' : 'some';
}

/**
 * The header's tap: a stack with everything in goes fully out, anything else
 * goes fully in. So a half-ticked stack fills up first, the way a select-all
 * checkbox in a mixed state does.
 */
export function toggleRun(runIds: readonly string[], selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  const all = runSelection(runIds, selected) === 'all';
  for (const id of runIds) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** Where the current task sits among its stack's tasks in this session. */
export interface StackProgress {
  groupId: string;
  /** 1-based place of the current task. */
  position: number;
  total: number;
  /** Members already passed, so the bar can draw them filled. */
  done: number;
}

/**
 * "Task 2 of 4 in Morning supplements" for the step the cursor is on.
 *
 * `passedIds` is every task the session has already finished, worked or
 * skipped (`completedTaskIds` plus `stepLog`'s work rows); `steps` is what
 * is left, since the plan is pruned as tasks leave it (steps behind the cursor
 * are read as passed too). A stack counts only
 * what this session holds, so a member left out of the queue isn't a task
 * the chip waits for. Null for a break, an unstacked task, or a stack with
 * nothing else in this session.
 */
export function stackProgress(
  steps: readonly FocusStep[],
  stepIndex: number,
  passedIds: readonly string[],
  groupOf: (taskId: string) => string | null | undefined,
): StackProgress | null {
  const current = steps[stepIndex];
  if (!current || current.kind !== 'work' || current.taskId === null) return null;
  const groupId = groupOf(current.taskId);
  if (!groupId) return null;

  // Steps behind the cursor are kept in the plan as the record of what ran
  // (`pruneFocusPlan`), so they count as passed, not as what is ahead.
  const workIds = (list: readonly FocusStep[]): string[] =>
    list.flatMap(s => (s.kind === 'work' && s.taskId !== null ? [s.taskId] : []));
  const ahead = [...new Set(workIds(steps.slice(stepIndex)))];
  const aheadSet = new Set(ahead);
  const passed = [...new Set([...passedIds, ...workIds(steps.slice(0, stepIndex))])].filter(id => !aheadSet.has(id) && groupOf(id) === groupId);
  const members = ahead.filter(id => groupOf(id) === groupId);

  const total = passed.length + members.length;
  if (total < 2) return null;
  return {
    groupId,
    position: passed.length + members.indexOf(current.taskId) + 1,
    total,
    done: passed.length,
  };
}
