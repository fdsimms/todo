import type { Task, UnattendedEntry } from '../types';
import { agentRevertLabel, agentRevertPlan, type AgentRevertPlan } from './agentRevert';
import { agentRecordLabel, agentRecordPlan, type AgentRecordPlan, type RecordState } from './agentRecordRevert';

/**
 * One answer to "can this agent entry be taken back, and how", whatever the
 * entry is about. The Activity screen asks this and nothing narrower; the task
 * rules live in agentRevert.ts and the rest in agentRecordRevert.ts.
 */
export type AgentUndo = AgentRevertPlan | AgentRecordPlan;
export type AgentUndoAction = Exclude<AgentUndo, { kind: 'none' }>;

export interface AgentUndoReaders {
  task(id: string): Task | null;
  record: RecordState;
}

export function agentUndoPlan(entry: UnattendedEntry, readers: AgentUndoReaders): AgentUndo {
  if (entry.actor !== 'agent') return { kind: 'none', reason: null };
  if (entry.taskId) return agentRevertPlan(entry, readers.task(entry.taskId));
  return agentRecordPlan(entry, readers.record);
}

export function agentUndoLabel(plan: AgentUndo): string | null {
  switch (plan.kind) {
    case 'delete':
    case 'uncomplete':
    case 'restore':
    case 'restoreDeletedTask':
    case 'none':
      return agentRevertLabel(plan);
    default:
      return agentRecordLabel(plan);
  }
}

/**
 * Taking back everything one confirmed agent call did.
 *
 * Every write the server makes is previewed and then confirmed once, and the
 * entries it records share a `batchId`, so "what did that request do" is a
 * question the ledger can answer. A batch is undone by running each entry's own
 * plan and nothing broader, so every guard still holds: a record changed since
 * is skipped and left alone rather than overwritten.
 *
 * **Newest first, re-reading the world between steps.** Two edits to one task in
 * a batch (A to B, then B to C) only pass the "still how the agent left it"
 * check in that order: undoing the second makes the first match again. Judging
 * every entry against the state before any of them ran would skip the first for
 * good.
 */
export interface BatchRevertResult {
  reverted: number;
  /** Entries whose record had been changed, completed or removed by someone else since. */
  skipped: number;
}

function inBatch(entries: readonly UnattendedEntry[], batchId: string): UnattendedEntry[] {
  return entries.filter(e => e.batchId === batchId && e.actor === 'agent');
}

/** How many entries of one batch can be acted on at all, judged against the world as it stands. */
export function revertableInBatch(entries: readonly UnattendedEntry[], batchId: string, planFor: (e: UnattendedEntry) => AgentUndo): number {
  return inBatch(entries, batchId).filter(e => planFor(e).kind !== 'none').length;
}

export function revertBatch(
  entries: readonly UnattendedEntry[],
  batchId: string,
  planFor: (e: UnattendedEntry) => AgentUndo,
  apply: (plan: AgentUndoAction) => void,
): BatchRevertResult {
  const batch = inBatch(entries, batchId).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const removedHere = new Set<string>();
  let reverted = 0;
  let skipped = 0;
  for (const entry of batch) {
    const key = entry.taskId ?? entry.recordId ?? entry.id;
    // The row this batch itself just removed: its other entries have nothing
    // left to undo, and that is the batch working, not a refusal.
    if (removedHere.has(key)) continue;
    const plan = planFor(entry);
    if (plan.kind === 'none') {
      // Nothing to say about an entry with no undo at all, and an entry already
      // taken back is not one that was refused.
      if (plan.reason && plan.reason !== 'Undone') skipped += 1;
      continue;
    }
    apply(plan);
    reverted += 1;
    if (plan.kind === 'delete' || plan.kind === 'removeRecord' || plan.kind === 'groceryRemove') removedHere.add(key);
  }
  return { reverted, skipped };
}
