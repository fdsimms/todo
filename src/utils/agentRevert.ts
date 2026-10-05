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
 * This is the task half. What an agent wrote to anything else is
 * `agentRecordPlan` (agentRecordRevert.ts), and `agentUndoPlan` (agentUndo.ts)
 * picks between them.
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
  // A person's history note is a task row the agent created, so it comes back out the same way.
  const aboutATask = entry.subject === 'task' || (entry.subject === 'person' && entry.action === 'created');
  if (entry.actor !== 'agent' || !aboutATask || !entry.taskId) return { kind: 'none', reason: null };
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
