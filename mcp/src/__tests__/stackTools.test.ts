/**
 * The stack tools against a real database: what filing a task in a stack does
 * to it, what is refused before anything is written, and the way back the
 * Activity screen is offered.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { assignToStack, createStack, listStacks } from '../stackTools';
import { serializeTask } from '../serialize';
import { agentRevertPlan } from '../../../src/utils/agentRevert';
import type { UnattendedEntry } from '../../../src/types';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

let replica: ReturnType<typeof openReplica>;

function ledger(): UnattendedEntry[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dbGetUnattendedLog } = require('../../../src/db/database') as typeof import('../../../src/db/database');
  return dbGetUnattendedLog();
}

beforeAll(() => {
  replica = openReplica(':memory:');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useCategoryStore } = require('../../../src/store/useCategoryStore') as typeof import('../../../src/store/useCategoryStore');
  useCategoryStore.getState().addCategory('Routine');
  useCategoryStore.getState().addCategory('Evening Tasks');
  replica.refresh();
});

beforeEach(() => {
  mockRaw.runSync('DELETE FROM tasks');
  mockRaw.runSync('DELETE FROM task_groups');
  mockRaw.runSync('DELETE FROM unattended_log');
  replica.refresh();
});

const make = (title: string, category = 'Routine') => replica.createTask({ title, category });

describe('create_stack', () => {
  it('uses the category its tasks share, and lists them in the order they were named', () => {
    const a = make('Algae oil');
    const b = make('Vitamin D');
    const result = createStack(replica, { title: 'Morning supplements', taskIds: [a.id, b.id] });
    expect(result.stack).toMatchObject({ title: 'Morning supplements', category: 'Routine' });
    expect(result.stack!.members.map(m => m.title)).toEqual(['Algae oil', 'Vitamin D']);
    expect(result.moved.every(m => !m.category)).toBe(true);
    expect(result.note).toBeUndefined();
    expect(listStacks(replica)).toHaveLength(1);
    expect(serializeTask(replica, replica.taskById(a.id)!).stackId).toBe(result.stack!.id);
  });

  it('counts a dated series once among the members', () => {
    // A task given two dates is two open rows sharing a seriesId (CLAUDE.md,
    // "Series"); the roster names the member once, as the app's editor does.
    const a = make('Water the plants');
    const b = make('Water the plants');
    mockRaw.runSync("UPDATE tasks SET series_id = 'plants' WHERE id IN (?, ?)", [a.id, b.id]);
    replica.refresh();
    const stack = createStack(replica, { title: 'Garden', taskIds: [a.id, b.id] }).stack!;
    expect(stack.members.map(m => m.title)).toEqual(['Water the plants']);
    expect(listStacks(replica)[0].members).toHaveLength(1);
  });

  it('will not guess a category when its tasks are in different ones', () => {
    const a = make('Brush teeth', 'Routine');
    const b = make('Floss', 'Evening Tasks');
    expect(() => createStack(replica, { title: 'Evening', taskIds: [a.id, b.id] })).toThrow(/different categories \(Routine, Evening Tasks\)/);
    expect(replica.stacks()).toEqual([]);
  });

  it('re-files every task under the chosen category and says so', () => {
    const a = make('Brush teeth', 'Routine');
    const b = make('Floss', 'Evening Tasks');
    const result = createStack(replica, { title: 'Evening', category: 'evening tasks', taskIds: [a.id, b.id] });
    expect(result.stack!.category).toBe('Evening Tasks');
    expect(result.moved).toEqual([
      { id: a.id, title: 'Brush teeth', category: { from: 'Routine', to: 'Evening Tasks' } },
      { id: b.id, title: 'Floss' },
    ]);
    expect(result.note).toMatch(/owns its members' category/);
    replica.refresh();
    expect(replica.taskById(a.id)!.category).toBe('Evening Tasks');
  });

  it('refuses a category that does not exist, and a blank title, before writing', () => {
    expect(() => createStack(replica, { title: 'X', category: 'Nowhere' })).toThrow(/not one of your categories/);
    expect(() => createStack(replica, { title: '  ' })).toThrow(/needs a title/);
    expect(replica.stacks()).toEqual([]);
  });

  it('refuses a bad task before the stack exists', () => {
    const a = make('Floss');
    expect(() => createStack(replica, { title: 'Evening', taskIds: [a.id, 'nope'] })).toThrow(/No task with id nope/);
    expect(replica.stacks()).toEqual([]);
  });
});

describe('assign_to_stack', () => {
  it('files tasks in a stack after the ones already there', () => {
    const first = make('Algae oil');
    const stack = createStack(replica, { title: 'Morning', taskIds: [first.id] }).stack!;
    const second = make('Vitamin D');
    const result = assignToStack(replica, stack.id, [second.id]);
    expect(result.stack!.members.map(m => m.title)).toEqual(['Algae oil', 'Vitamin D']);
  });

  it('takes tasks out with a null stack and leaves their category alone', () => {
    const a = make('Floss', 'Evening Tasks');
    const stack = createStack(replica, { title: 'Evening', taskIds: [a.id] }).stack!;
    const result = assignToStack(replica, null, [a.id]);
    expect(result.stack).toBeNull();
    replica.refresh();
    expect(replica.taskById(a.id)).toMatchObject({ groupId: null, category: 'Evening Tasks' });
    expect(listStacks(replica).find(s => s.id === stack.id)!.members).toEqual([]);
  });

  it('moves nothing when any task is refused', () => {
    const stack = createStack(replica, { title: 'Morning' }).stack!;
    const ok = make('Algae oil');
    const done = make('Old');
    replica.completeTask(done.id, {});
    mockRaw.runSync("INSERT INTO tasks (id, title, created_at, parent_id) VALUES ('sub', 'Step', '2026-01-01T00:00:00.000Z', ?)", [ok.id]);
    replica.refresh();
    expect(() => assignToStack(replica, stack.id, [ok.id, done.id, 'sub'])).toThrow(/completed.*subtask|subtask.*completed/s);
    replica.refresh();
    expect(replica.taskById(ok.id)!.groupId ?? null).toBeNull();
  });

  it('refuses an unknown stack and an empty list', () => {
    const a = make('Floss');
    expect(() => assignToStack(replica, 'nope', [a.id])).toThrow(/No stack with id nope/);
    expect(() => assignToStack(replica, null, [])).toThrow(/at least one task/);
  });

  it('keeps a task\'s own category in a stack that has none', () => {
    const a = make('Floss', 'Evening Tasks');
    const stack = createStack(replica, { title: 'Loose', category: null }).stack!;
    assignToStack(replica, stack.id, [a.id]);
    replica.refresh();
    expect(replica.taskById(a.id)).toMatchObject({ groupId: stack.id, category: 'Evening Tasks' });
  });
});

describe('the Activity ledger', () => {
  it('records the stack, and an edit to each task that can be taken back', () => {
    const a = make('Brush teeth', 'Routine');
    const result = createStack(replica, { title: 'Evening', category: 'Evening Tasks', taskIds: [a.id] });

    const [edited, created] = ledger();
    expect(created).toMatchObject({ action: 'created', subject: 'stack', title: 'Evening', actor: 'agent' });
    expect(edited).toMatchObject({ action: 'edited', subject: 'task', taskId: a.id });
    expect(edited.revert?.after).toMatchObject({ groupId: result.stack!.id, category: 'Evening Tasks' });

    const plan = agentRevertPlan(edited, replica.taskById(a.id));
    expect(plan).toMatchObject({ kind: 'restore', patch: { groupId: null, category: 'Routine' } });
  });
});
