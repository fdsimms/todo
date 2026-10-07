import { agentRevertLabel, agentRevertPlan, deletedTaskRevert } from '../utils/agentRevert';
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
  it('restores a task the agent deleted, until the task exists again', () => {
    const snapshot = { task: task(), subtasks: [task({ id: 's1', title: 'Find the card' })] };
    const deleted = entry({ action: 'cleared', revert: deletedTaskRevert(snapshot) });
    const plan = agentRevertPlan(deleted, null);
    expect(plan).toEqual({ kind: 'restoreDeletedTask', snapshot });
    expect(agentRevertLabel(plan)).toBe('Restore');
    expect(agentRevertPlan(deleted, task())).toEqual({ kind: 'none', reason: 'Restored since' });
  });

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

  it('reopens an occurrence the agent marked missed, and reads a reopened one as undone', () => {
    expect(agentRevertPlan(entry({ action: 'missed', revert: null }), task({ completed: true })))
      .toEqual({ kind: 'uncomplete', taskId: 't1' });
    expect(agentRevertPlan(entry({ action: 'missed', revert: null }), task()))
      .toEqual({ kind: 'none', reason: 'Reopened since' });
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
