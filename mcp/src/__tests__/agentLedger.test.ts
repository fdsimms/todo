/**
 * The ledger wrapper against a real database: an agent's write leaves an entry
 * the phone can read, and an edit's entry carries exactly what the app's undo
 * rule (`agentRevertPlan`) needs to put it back.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { taskRevert } from '../agentLedger';
import { agentRevertPlan } from '../../../src/utils/agentRevert';
import type { Task, UnattendedEntry } from '../../../src/types';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

let replica: ReturnType<typeof openReplica>;

/** The ledger as the phone reads it, through the app's own row mapping. */
function ledger(): UnattendedEntry[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dbGetUnattendedLog } = require('../../../src/db/database') as typeof import('../../../src/db/database');
  return dbGetUnattendedLog();
}

beforeAll(() => {
  replica = openReplica(':memory:');
});

beforeEach(() => {
  mockRaw.runSync('DELETE FROM tasks');
  mockRaw.runSync('DELETE FROM unattended_log');
  replica.refresh();
});

describe('taskRevert', () => {
  it('keeps only the fields that changed', () => {
    const before = { id: 't', title: 'A', tags: [], notes: '' } as unknown as Task;
    expect(taskRevert(before, { ...before, title: 'B' })).toEqual({ before: { title: 'A' }, after: { title: 'B' } });
    expect(taskRevert(before, { ...before })).toBeNull();
  });
});

describe('the agent ledger', () => {
  it('records a creation, an edit with its before and after, and a completion, as Claude\'s', () => {
    const task = replica.createTask({ title: 'Call bank' });
    replica.updateTask(task.id, { title: 'Call the bank', tags: ['errand'] });
    replica.completeTask(task.id);

    const [completed, edited, created] = ledger();
    expect(created).toMatchObject({ action: 'created', actor: 'agent', subject: 'task', taskId: task.id, title: 'Call bank' });
    expect(edited.revert?.before).toMatchObject({ title: 'Call bank', tags: [] });
    expect(edited.revert?.after).toMatchObject({ title: 'Call the bank', tags: ['errand'] });
    expect(completed).toMatchObject({ action: 'completed', actor: 'agent' });
  });

  it('hands the phone an edit it can undo while the task is unchanged since', () => {
    const task = replica.createTask({ title: 'Water plants' });
    replica.updateTask(task.id, { notes: 'Twice a week' });
    const edit = ledger().find(e => e.action === 'edited')!;
    const plan = agentRevertPlan(edit, replica.taskById(task.id));
    expect(plan).toMatchObject({ kind: 'restore', patch: { notes: '' } });
  });

  it('records nothing for a write that was refused', () => {
    expect(() => replica.updateTask('nope', { title: 'x' })).toThrow();
    expect(ledger()).toEqual([]);
  });

  it('records grocery writes without a way back, since those are a tap in the app', () => {
    const { item } = replica.addGroceryItem('Oat milk');
    replica.setGroceryChecked(item.id, true);
    expect(ledger().map(e => [e.subject, e.action])).toEqual([['grocery', 'completed'], ['grocery', 'created']]);
  });
});

describe('dryRun', () => {
  it('runs the write, reports what it would record, and keeps none of it', () => {
    const { result, effects } = replica.dryRun(() => replica.createTask({ title: 'Only a preview' }));
    expect(result.title).toBe('Only a preview');
    expect(effects).toEqual([expect.objectContaining({ action: 'created', subject: 'task', title: 'Only a preview' })]);
    replica.refresh();
    expect(replica.tasks().map(t => t.title)).not.toContain('Only a preview');
    expect(ledger()).toEqual([]);
  });

  it('measures an edit against the row as it stands, and rolls it back', () => {
    const task = replica.createTask({ title: 'Real task' });
    mockRaw.runSync('DELETE FROM unattended_log');
    const { effects } = replica.dryRun(() => replica.updateTask(task.id, { title: 'Renamed' }));
    expect(effects[0].revert?.after).toMatchObject({ title: 'Renamed' });
    expect(replica.taskById(task.id)!.title).toBe('Real task');
  });

  it('lets a refused write throw as it would for real', () => {
    expect(() => replica.dryRun(() => replica.updateTask('nope', { title: 'x' }))).toThrow(/No task/);
  });
});


describe('batches', () => {
  it('stamps every entry one confirmed write records with the same batch id, and none outside it', () => {
    const a = replica.createTask({ title: 'Loose' });
    replica.withBatch('batch-1', () => {
      replica.updateTask(a.id, { title: 'Renamed' });
      replica.createTask({ title: 'Second' });
    });
    replica.createTask({ title: 'After' });

    const byTitle = Object.fromEntries(ledger().map(e => [`${e.action}:${e.title}`, e.batchId ?? null]));
    expect(byTitle['edited:Renamed']).toBe('batch-1');
    expect(byTitle['created:Second']).toBe('batch-1');
    expect(byTitle['created:Loose']).toBeNull();
    expect(byTitle['created:After']).toBeNull();
  });

  it('releases the batch when the write throws', () => {
    expect(() => replica.withBatch('batch-2', () => replica.updateTask('nope', { title: 'x' }))).toThrow(/No task/);
    replica.createTask({ title: 'Later' });
    expect(ledger().find(e => e.title === 'Later')?.batchId ?? null).toBeNull();
  });
});

describe('records an undo can find again', () => {
  it('names the grocery item and the meal an entry is about', () => {
    const outcome = replica.addGroceryItem('ledger test kefir');
    const meal = replica.planMeal({ date: '2026-10-05', slot: 'dinner', title: 'Soup' });
    const entries = ledger();
    expect(entries.find(e => e.subject === 'grocery')?.recordId).toBe(outcome.item.id);
    expect(entries.find(e => e.subject === 'meal')?.recordId).toBe(meal.id);
  });

  it('records a rule list as the whole list before and after, named by its type', () => {
    const before = replica.ruleLists().title;
    replica.setRuleList('title', []);
    const entry = ledger().find(e => e.subject === 'automation')!;
    expect(entry.recordId).toBe('title');
    expect(entry.revert).toEqual({ before: { rules: before }, after: { rules: [] } });
  });
});
