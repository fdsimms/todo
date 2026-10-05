import { agentRevertLabel, agentRevertPlan, revertBatch, revertableInBatch } from '../utils/agentRevert';
import type { Task, UnattendedEntry } from '../types';

const task = (over: Partial<Task> = {}): Task =>
  ({ id: 't1', title: 'Call the bank', completed: false, tags: [], dueDate: null, ...over }) as Task;

const entry = (over: Partial<UnattendedEntry> = {}): UnattendedEntry => ({
  id: 'e1', at: '2026-10-04T10:00:00.000Z', action: 'edited', kind: null, title: 'Call the bank', taskId: 't1',
  count: 1, actor: 'agent', subject: 'task',
  revert: { before: { title: 'Call bank', tags: [] }, after: { title: 'Call the bank', tags: ['errand'] } },
  ...over,
});

describe('agentRevertPlan', () => {
  it('restores the touched fields while the task is still how the agent left it', () => {
    const plan = agentRevertPlan(entry(), task({ tags: ['errand'] }));
    expect(plan).toEqual({ kind: 'restore', taskId: 't1', patch: { title: 'Call bank', tags: [] } });
    expect(agentRevertLabel(plan)).toBe('Undo');
  });

  it('offers nothing once the person has changed a touched field since, and says so', () => {
    expect(agentRevertPlan(entry(), task({ title: 'Call the bank today', tags: ['errand'] })))
      .toEqual({ kind: 'none', reason: 'Changed since' });
  });

  it('reads an already restored task as undone, so a second tap does nothing', () => {
    expect(agentRevertPlan(entry(), task({ title: 'Call bank', tags: [] }))).toEqual({ kind: 'none', reason: 'Undone' });
  });

  it('removes a task the agent created, and reopens one it completed', () => {
    expect(agentRevertPlan(entry({ action: 'created', revert: null }), task())).toEqual({ kind: 'delete', taskId: 't1' });
    expect(agentRevertPlan(entry({ action: 'created', revert: null }), task({ completed: true })))
      .toEqual({ kind: 'none', reason: 'Completed since' });
    expect(agentRevertPlan(entry({ action: 'completed', revert: null }), task({ completed: true })))
      .toEqual({ kind: 'uncomplete', taskId: 't1' });
    expect(agentRevertLabel({ kind: 'uncomplete', taskId: 't1' })).toBe('Reopen');
  });

  it('unarchives a task Claude archived, while it is still archived', () => {
    const archived = entry({ action: 'cleared', revert: { before: { archived: false }, after: { archived: true } } });
    expect(agentRevertPlan(archived, task({ archived: true } as Partial<Task>))).toMatchObject({ kind: 'restore', patch: { archived: false } });
    expect(agentRevertPlan(archived, task({ archived: false } as Partial<Task>))).toEqual({ kind: 'none', reason: 'Undone' });
  });

  it('offers nothing for the app\'s own entries, other subjects, or a task that is gone', () => {
    expect(agentRevertPlan(entry({ actor: 'app' }), task())).toEqual({ kind: 'none', reason: null });
    expect(agentRevertPlan(entry({ subject: 'grocery' }), task())).toEqual({ kind: 'none', reason: null });
    expect(agentRevertPlan(entry(), null)).toEqual({ kind: 'none', reason: 'Since removed' });
  });
});

describe('revertBatch', () => {
  const batch = (over: Partial<UnattendedEntry>) => entry({ batchId: 'b1', ...over });

  /** A tiny task store, so the batch is applied against state that moves as it runs. */
  const world = (tasks: Task[]) => {
    const byId = new Map(tasks.map(t => [t.id, t]));
    return {
      get: (id: string) => byId.get(id) ?? null,
      apply: (plan: { kind: string; taskId: string; patch?: Partial<Task> }) => {
        if (plan.kind === 'delete') byId.delete(plan.taskId);
        else if (plan.kind === 'uncomplete') byId.set(plan.taskId, { ...byId.get(plan.taskId)!, completed: false });
        else byId.set(plan.taskId, { ...byId.get(plan.taskId)!, ...plan.patch });
      },
    };
  };

  it('undoes two edits to one task by taking the newest back first', () => {
    const entries = [
      batch({ id: 'e1', at: '2026-10-04T10:00:00.000Z', revert: { before: { title: 'A' }, after: { title: 'B' } } }),
      batch({ id: 'e2', at: '2026-10-04T10:00:01.000Z', revert: { before: { title: 'B' }, after: { title: 'C' } } }),
    ];
    const w = world([task({ title: 'C' })]);
    expect(revertBatch(entries, 'b1', w.get, w.apply)).toEqual({ reverted: 2, skipped: 0 });
    expect(w.get('t1')?.title).toBe('A');
  });

  it('undoes a later edit and then removes the created task, with nothing counted as a refusal', () => {
    const entries = [
      batch({ id: 'e1', at: '2026-10-04T10:00:00.000Z', action: 'created', revert: null }),
      batch({ id: 'e2', at: '2026-10-04T10:00:01.000Z', revert: { before: { title: 'A' }, after: { title: 'B' } } }),
    ];
    const w = world([task({ title: 'B' })]);
    expect(revertBatch(entries, 'b1', w.get, w.apply)).toEqual({ reverted: 2, skipped: 0 });
    expect(w.get('t1')).toBeNull();
  });

  it('leaves a task the person changed since, and reports it', () => {
    const entries = [
      batch({ id: 'e1', taskId: 't1', revert: { before: { title: 'A' }, after: { title: 'B' } } }),
      batch({ id: 'e2', taskId: 't2', revert: { before: { title: 'X' }, after: { title: 'Y' } } }),
    ];
    const w = world([task({ id: 't1', title: 'B edited by hand' }), task({ id: 't2', title: 'Y' })]);
    expect(revertBatch(entries, 'b1', w.get, w.apply)).toEqual({ reverted: 1, skipped: 1 });
    expect(w.get('t1')?.title).toBe('B edited by hand');
    expect(w.get('t2')?.title).toBe('X');
  });

  it('touches only the named batch, and never an entry that is not an agent task row', () => {
    const entries = [
      batch({ id: 'e1', batchId: 'other', revert: { before: { title: 'A' }, after: { title: 'B' } } }),
      batch({ id: 'e2', subject: 'grocery', taskId: null, revert: null }),
    ];
    const w = world([task({ title: 'B' })]);
    expect(revertBatch(entries, 'b1', w.get, w.apply)).toEqual({ reverted: 0, skipped: 0 });
    expect(w.get('t1')?.title).toBe('B');
  });

  it('counts what is still open to an undo, for the button', () => {
    const entries = [
      batch({ id: 'e1', taskId: 't1' }),
      batch({ id: 'e2', taskId: 't2' }),
      batch({ id: 'e3', taskId: 't3' }),
    ];
    const w = world([task({ id: 't1', tags: ['errand'] }), task({ id: 't2', title: 'changed' }), task({ id: 't3', tags: ['errand'] })]);
    expect(revertableInBatch(entries, 'b1', w.get)).toBe(2);
  });
});
