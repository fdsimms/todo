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
    case 'moved': {
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
