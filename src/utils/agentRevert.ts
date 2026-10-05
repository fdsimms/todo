import type { Task, UnattendedEntry } from '../types';

/**
 * Whether, and how, an agent's write can be taken back from the Activity screen.
 *
 * An agent's edits reach the phone by sync (docs/arch/mcp-server.md), so the
 * person was not watching when they landed and has no undo stack holding them.
 * The ledger row is what they have, and this reads it against the task as it
 * stands now.
 *
 * **Only while the task is still how the agent left it.** An undo that
 * restored the "before" over an edit the person has made since would throw
 * their edit away to put back one they never saw, so a row whose touched
 * fields no longer match the agent's "after" offers nothing and says why. That
 * check is also what makes undoing twice a no-op: once restored, the fields
 * match "before", not "after".
 *
 * Derived on every read rather than recorded, so the ledger stays write-once
 * (see `unattended_log` in database.ts): there is no "reverted" flag to sync,
 * and a revert made on one phone shows as done on the other the moment the
 * task itself syncs.
 *
 * Only task entries can be undone. A grocery, project or meal entry is a record
 * of what was done and nothing more; those are a tap to change in the app.
 */
export type AgentRevertPlan =
  | { kind: 'delete'; taskId: string }
  | { kind: 'restore'; taskId: string; patch: Partial<Task> }
  | { kind: 'uncomplete'; taskId: string }
  | { kind: 'none'; reason: string | null };

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function agentRevertPlan(entry: UnattendedEntry, task: Task | null): AgentRevertPlan {
  if (entry.actor !== 'agent' || entry.subject !== 'task' || !entry.taskId) return { kind: 'none', reason: null };
  if (!task) return { kind: 'none', reason: 'Since removed' };

  switch (entry.action) {
    case 'created':
      if (task.completed) return { kind: 'none', reason: 'Completed since' };
      return { kind: 'delete', taskId: task.id };
    case 'completed':
      if (!task.completed) return { kind: 'none', reason: 'Reopened since' };
      return { kind: 'uncomplete', taskId: task.id };
    case 'edited':
    case 'moved':
    case 'cleared': {
      const revert = entry.revert;
      if (!revert) return { kind: 'none', reason: null };
      if (task.completed) return { kind: 'none', reason: 'Completed since' };
      const record = task as unknown as Record<string, unknown>;
      const keys = Object.keys(revert.after);
      if (keys.every(k => same(record[k], revert.before[k]))) return { kind: 'none', reason: 'Undone' };
      if (!keys.every(k => same(record[k], revert.after[k]))) return { kind: 'none', reason: 'Changed since' };
      return { kind: 'restore', taskId: task.id, patch: revert.before as Partial<Task> };
    }
    default:
      return { kind: 'none', reason: null };
  }
}

/** The button's label for a plan that can be acted on. */
export function agentRevertLabel(plan: AgentRevertPlan): string | null {
  switch (plan.kind) {
    case 'delete': return 'Remove';
    case 'uncomplete': return 'Reopen';
    case 'restore': return 'Undo';
    case 'none': return null;
  }
}

/**
 * Taking back everything one confirmed agent call did.
 *
 * Every write the server makes is previewed and then confirmed once, and the
 * entries it records share a `batchId`, so "what did that request do" is a
 * question the ledger can answer. A batch is undone by running each entry's own
 * `agentRevertPlan` and nothing broader, so every rule above still holds: a task
 * changed since is skipped and left alone rather than overwritten.
 *
 * **Newest first, re-reading the task between steps.** Two edits to one task in
 * a batch (A to B, then B to C) only pass the "still how the agent left it"
 * check in that order: undoing the second makes the first match again. Judging
 * every entry against the task as it stands before any of them ran would skip
 * the first for good.
 */
export interface BatchRevertResult {
  reverted: number;
  /** Entries whose task had been changed, completed or removed by someone else since. */
  skipped: number;
}

/** The entries of one batch that can be acted on at all, judged against the tasks as they stand. */
export function revertableInBatch(
  entries: readonly UnattendedEntry[],
  batchId: string,
  getTask: (id: string) => Task | null,
): number {
  let n = 0;
  for (const e of entries) {
    if (e.batchId !== batchId || !e.taskId) continue;
    if (agentRevertPlan(e, getTask(e.taskId)).kind !== 'none') n += 1;
  }
  return n;
}

export function revertBatch(
  entries: readonly UnattendedEntry[],
  batchId: string,
  getTask: (id: string) => Task | null,
  apply: (plan: Exclude<AgentRevertPlan, { kind: 'none' }>) => void,
): BatchRevertResult {
  const batch = entries
    .filter(e => e.batchId === batchId && e.actor === 'agent' && e.subject === 'task' && e.taskId)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const removedHere = new Set<string>();
  let reverted = 0;
  let skipped = 0;
  for (const entry of batch) {
    const id = entry.taskId as string;
    // The task this batch itself just removed: its other entries have nothing
    // left to undo, and that is the batch working, not a refusal.
    if (removedHere.has(id)) continue;
    const plan = agentRevertPlan(entry, getTask(id));
    if (plan.kind === 'none') {
      // "Undone" is an entry already taken back, not one that was refused.
      if (plan.reason !== 'Undone') skipped += 1;
      continue;
    }
    apply(plan);
    reverted += 1;
    if (plan.kind === 'delete') removedHere.add(id);
  }
  return { reverted, skipped };
}
