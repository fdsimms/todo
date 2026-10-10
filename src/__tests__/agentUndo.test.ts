import { agentUndoLabel, agentUndoPlan, revertBatch, revertableInBatch, type AgentUndoReaders } from '../utils/agentUndo';
import { agentRecordPlan, type RecordState } from '../utils/agentRecordRevert';
import type { Project, Task, UnattendedEntry } from '../types';

const task = (over: Partial<Task> = {}): Task =>
  ({ id: 't1', title: 'Call the bank', completed: false, tags: [], dueDate: null, ...over }) as Task;

const entry = (over: Partial<UnattendedEntry> = {}): UnattendedEntry => ({
  id: 'e1', at: '2026-10-04T10:00:00.000Z', action: 'edited', kind: null, title: 'Call the bank', taskId: 't1',
  count: 1, actor: 'agent', subject: 'task',
  revert: { before: { title: 'Call bank', tags: [] }, after: { title: 'Call the bank', tags: ['errand'] } },
  batchId: null, recordId: null,
  ...over,
});

const state = (over: Partial<RecordState> = {}): RecordState => ({
  project: () => null,
  stack: () => null,
  person: () => null,
  groceryHome: () => null,
  groceryItem: () => null,
  itemBoxes: () => [],
  leftover: () => null,
  aisleOverride: () => null,
  itemKeyTaken: () => false,
  exists: () => false,
  ruleList: () => [],
  hasNote: () => false,
  calendarRequest: () => null,
  ...over,
});

describe('agentRecordPlan', () => {
  it('restores a project\'s edited fields only while they are still how the agent left them', () => {
    const e = entry({ taskId: null, subject: 'project', recordId: 'p1', revert: { before: { title: 'Old' }, after: { title: 'New' } } });
    const project = (title: string) => ({ id: 'p1', title }) as Project;
    expect(agentRecordPlan(e, state({ project: () => project('New') })))
      .toEqual({ kind: 'restoreProject', id: 'p1', patch: { title: 'Old' } });
    expect(agentRecordPlan(e, state({ project: () => project('Mine') }))).toEqual({ kind: 'none', reason: 'Changed since' });
    expect(agentRecordPlan(e, state({ project: () => project('Old') }))).toEqual({ kind: 'none', reason: 'Undone' });
    expect(agentRecordPlan(e, state())).toEqual({ kind: 'none', reason: 'Removed since' });
  });

  it('takes an added grocery item back off the list unless it has been checked off since', () => {
    const e = entry({ taskId: null, subject: 'grocery', action: 'created', recordId: 'g1', revert: null });
    expect(agentRecordPlan(e, state({ groceryHome: () => ({ checked: false }) }))).toEqual({ kind: 'groceryRemove', itemId: 'g1' });
    expect(agentRecordPlan(e, state({ groceryHome: () => ({ checked: true }) }))).toEqual({ kind: 'none', reason: 'Checked off since' });
    expect(agentRecordPlan(e, state())).toEqual({ kind: 'none', reason: 'Removed since' });
  });

  it('unchecks what the agent checked off, and reads an item already unchecked as undone', () => {
    const e = entry({ taskId: null, subject: 'grocery', action: 'completed', recordId: 'g1', revert: null });
    expect(agentRecordPlan(e, state({ groceryHome: () => ({ checked: true }) }))).toEqual({ kind: 'groceryCheck', itemId: 'g1', checked: false });
    expect(agentRecordPlan(e, state({ groceryHome: () => ({ checked: false }) }))).toEqual({ kind: 'none', reason: 'Undone' });
  });

  it('offers nothing for a grocery item the agent took off the list', () => {
    const e = entry({ taskId: null, subject: 'grocery', action: 'cleared', recordId: 'g1', revert: null });
    expect(agentRecordPlan(e, state({ groceryHome: () => ({ checked: false }) }))).toEqual({ kind: 'none', reason: null });
  });

  it('removes a log entry or meal the agent wrote while it still exists', () => {
    for (const subject of ['meal', 'food', 'mood', 'medication'] as const) {
      const e = entry({ taskId: null, subject, action: 'created', recordId: 'r1', revert: null });
      expect(agentRecordPlan(e, state({ exists: () => true }))).toEqual({ kind: 'removeRecord', subject, id: 'r1' });
      expect(agentRecordPlan(e, state())).toEqual({ kind: 'none', reason: 'Removed since' });
    }
  });

  it('restores a rule list while it is still what the agent saved', () => {
    const e = entry({ taskId: null, subject: 'automation', recordId: 'title', revert: { before: { rules: [1] }, after: { rules: [1, 2] } } });
    expect(agentRecordPlan(e, state({ ruleList: () => [1, 2] }))).toEqual({ kind: 'restoreRules', type: 'title', rules: [1] });
    expect(agentRecordPlan(e, state({ ruleList: () => [9] }))).toEqual({ kind: 'none', reason: 'Changed since' });
    expect(agentRecordPlan(e, state({ ruleList: () => [1] }))).toEqual({ kind: 'none', reason: 'Undone' });
  });

  it('forgets a note the agent remembered, and remembers one it forgot', () => {
    const made = entry({ taskId: null, subject: 'note', action: 'created', title: 'Prefers mornings', revert: null });
    const forgot = entry({ taskId: null, subject: 'note', action: 'cleared', title: 'Prefers mornings', revert: null });
    expect(agentRecordPlan(made, state({ hasNote: () => true }))).toEqual({ kind: 'noteRemove', text: 'Prefers mornings' });
    expect(agentRecordPlan(forgot, state())).toEqual({ kind: 'noteAdd', text: 'Prefers mornings' });
    expect(agentRecordPlan(forgot, state({ hasNote: () => true }))).toEqual({ kind: 'none', reason: 'Undone' });
  });

  it('cancels a calendar request only while it is still waiting for the phone', () => {
    const e = entry({ taskId: null, subject: 'event', action: 'created', title: 'Dentist', recordId: 'c1', revert: null });
    const at = (status: 'pending' | 'written' | 'failed' | 'cancelled') => state({ calendarRequest: () => ({ status }) });
    expect(agentRecordPlan(e, at('pending'))).toEqual({ kind: 'cancelCalendarRequest', id: 'c1' });
    expect(agentUndoLabel(agentRecordPlan(e, at('pending')))).toBe('Don’t add');
    expect(agentRecordPlan(e, at('written'))).toEqual({ kind: 'none', reason: 'On your calendar' });
    expect(agentRecordPlan(e, at('failed'))).toEqual({ kind: 'none', reason: 'Not added' });
    expect(agentRecordPlan(e, at('cancelled'))).toEqual({ kind: 'none', reason: 'Undone' });
    expect(agentRecordPlan(e, state())).toEqual({ kind: 'none', reason: 'Removed since' });
  });

  it('offers nothing for the entry that records a cancelled request', () => {
    const e = entry({ taskId: null, subject: 'event', action: 'cleared', title: 'Dentist', recordId: 'c1', revert: null });
    expect(agentRecordPlan(e, state({ calendarRequest: () => ({ status: 'cancelled' }) }))).toEqual({ kind: 'none', reason: null });
  });

  it('never acts on an entry the app wrote, or on a recipe, template or stack', () => {
    expect(agentRecordPlan(entry({ actor: 'app', subject: 'grocery', taskId: null, recordId: 'g' }), state())).toEqual({ kind: 'none', reason: null });
    for (const subject of ['recipe', 'template', 'stack'] as const) {
      expect(agentRecordPlan(entry({ subject, taskId: null, action: 'created', recordId: 'x', revert: null }), state({ exists: () => true })))
        .toEqual({ kind: 'none', reason: null });
    }
  });
});

describe('agentUndoPlan', () => {
  it('sends a task entry to the task rules and anything else to the record rules', () => {
    const readers: AgentUndoReaders = { task: () => task({ tags: ['errand'] }), record: state({ groceryHome: () => ({ checked: false }) }) };
    expect(agentUndoLabel(agentUndoPlan(entry(), readers))).toBe('Undo');
    const grocery = entry({ taskId: null, subject: 'grocery', action: 'created', recordId: 'g1', revert: null });
    expect(agentUndoLabel(agentUndoPlan(grocery, readers))).toBe('Remove');
  });

  it('removes the task row behind a person\'s history note', () => {
    const note = entry({ subject: 'person', action: 'created', revert: null });
    expect(agentUndoPlan(note, { task: () => task(), record: state() })).toEqual({ kind: 'delete', taskId: 't1' });
  });
});

describe('revertBatch', () => {
  const batch = (over: Partial<UnattendedEntry>) => entry({ batchId: 'b1', ...over });

  /** A tiny world, so the batch is applied against state that moves as it runs. */
  const world = (tasks: Task[], groceries: Record<string, { checked: boolean }> = {}) => {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const home = { ...groceries };
    const readers: AgentUndoReaders = {
      task: id => byId.get(id) ?? null,
      record: state({ groceryHome: id => home[id] ?? null }),
    };
    const planFor = (e: UnattendedEntry) => agentUndoPlan(e, readers);
    const apply = (plan: ReturnType<typeof agentUndoPlan>) => {
      if (plan.kind === 'delete') byId.delete(plan.taskId);
      else if (plan.kind === 'uncomplete') byId.set(plan.taskId, { ...byId.get(plan.taskId)!, completed: false });
      else if (plan.kind === 'restore') byId.set(plan.taskId, { ...byId.get(plan.taskId)!, ...plan.patch });
      else if (plan.kind === 'groceryRemove') delete home[plan.itemId];
      else if (plan.kind === 'groceryCheck') home[plan.itemId] = { checked: plan.checked };
    };
    return { byId, home, planFor, apply };
  };

  it('undoes two edits to one task by taking the newest back first', () => {
    const entries = [
      batch({ id: 'e1', at: '2026-10-04T10:00:00.000Z', revert: { before: { title: 'A' }, after: { title: 'B' } } }),
      batch({ id: 'e2', at: '2026-10-04T10:00:01.000Z', revert: { before: { title: 'B' }, after: { title: 'C' } } }),
    ];
    const w = world([task({ title: 'C' })]);
    expect(revertBatch(entries, 'b1', w.planFor, w.apply)).toEqual({ reverted: 2, skipped: 0 });
    expect(w.byId.get('t1')?.title).toBe('A');
  });

  it('undoes a later edit and then removes the created task, with nothing counted as a refusal', () => {
    const entries = [
      batch({ id: 'e1', at: '2026-10-04T10:00:00.000Z', action: 'created', revert: null }),
      batch({ id: 'e2', at: '2026-10-04T10:00:01.000Z', revert: { before: { title: 'A' }, after: { title: 'B' } } }),
    ];
    const w = world([task({ title: 'B' })]);
    expect(revertBatch(entries, 'b1', w.planFor, w.apply)).toEqual({ reverted: 2, skipped: 0 });
    expect(w.byId.has('t1')).toBe(false);
  });

  it('leaves a task the person changed since, and reports it', () => {
    const entries = [
      batch({ id: 'e1', taskId: 't1', revert: { before: { title: 'A' }, after: { title: 'B' } } }),
      batch({ id: 'e2', taskId: 't2', revert: { before: { title: 'X' }, after: { title: 'Y' } } }),
    ];
    const w = world([task({ id: 't1', title: 'B edited by hand' }), task({ id: 't2', title: 'Y' })]);
    expect(revertBatch(entries, 'b1', w.planFor, w.apply)).toEqual({ reverted: 1, skipped: 1 });
    expect(w.byId.get('t1')?.title).toBe('B edited by hand');
    expect(w.byId.get('t2')?.title).toBe('X');
  });

  it('undoes tasks and groceries together, touching only the named batch', () => {
    const entries = [
      batch({ id: 'e1', action: 'created', revert: null }),
      batch({ id: 'e2', taskId: null, subject: 'grocery', action: 'created', recordId: 'g1', revert: null }),
      batch({ id: 'e3', batchId: 'other', taskId: null, subject: 'grocery', action: 'created', recordId: 'g2', revert: null }),
    ];
    const w = world([task()], { g1: { checked: false }, g2: { checked: false } });
    expect(revertBatch(entries, 'b1', w.planFor, w.apply)).toEqual({ reverted: 2, skipped: 0 });
    expect(w.byId.has('t1')).toBe(false);
    expect(Object.keys(w.home)).toEqual(['g2']);
  });

  it('counts what is still open to an undo, for the button', () => {
    const entries = [batch({ id: 'e1', taskId: 't1' }), batch({ id: 'e2', taskId: 't2' }), batch({ id: 'e3', taskId: 't3' })];
    const w = world([task({ id: 't1', tags: ['errand'] }), task({ id: 't2', title: 'changed' }), task({ id: 't3', tags: ['errand'] })]);
    expect(revertableInBatch(entries, 'b1', w.planFor)).toBe(2);
  });
});
