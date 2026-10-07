/**
 * The task writes that aren't a field edit, against a real database: what each
 * writes, what it refuses before writing anything, and the way back Activity
 * is offered.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { deleteTag, deleteTasks, duplicateTask, reorderTasks, setCompletionDate, setTaskDates, skipOccurrence } from '../taskTools';
import { createTask, listTasks, updateTask } from '../tools';
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

function ledger(): UnattendedEntry[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dbGetUnattendedLog } = require('../../../src/db/database') as typeof import('../../../src/db/database');
  return dbGetUnattendedLog();
}

beforeAll(() => {
  replica = openReplica(':memory:');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useCategoryStore } = require('../../../src/store/useCategoryStore') as typeof import('../../../src/store/useCategoryStore');
  useCategoryStore.getState().addCategory('Home');
  replica.refresh();
});

beforeEach(() => {
  mockRaw.runSync('DELETE FROM tasks');
  mockRaw.runSync('DELETE FROM people');
  mockRaw.runSync('DELETE FROM unattended_log');
  replica.refresh();
});

const make = (title: string, extra: Partial<Task> = {}): Task => replica.createTask({ title, category: 'Home', ...extra });
const local = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('the new task fields', () => {
  it('sets who, where and how to reach, and a blank clears one', () => {
    mockRaw.runSync("INSERT INTO people (id, name, created_at) VALUES ('p1', 'Sam', '2026-01-01T00:00:00.000Z')");
    replica.refresh();
    const made = createTask(replica, {
      title: 'Dinner with Sam', category: 'Home', personIds: ['p1'],
      location: ' Luigi\'s ', phoneNumber: '+1 555 0100', emailAddress: 'sam@example.com', linkUrl: 'https://example.com',
      vacationPause: true, medication: { name: 'Vitamin D', amount: 1000, unit: 'IU' },
    });
    const row = replica.taskById(made.task.id)!;
    expect(row).toMatchObject({
      personIds: ['p1'], location: 'Luigi\'s', phoneNumber: '+1 555 0100', emailAddress: 'sam@example.com',
      linkUrl: 'https://example.com', vacationPause: true, medicationName: 'Vitamin D', medicationAmount: 1000, medicationUnit: 'IU',
    });
    updateTask(replica, row.id, { location: '  ', medication: null, personIds: [] });
    expect(replica.taskById(row.id)).toMatchObject({ location: null, medicationName: null, medicationAmount: null, personIds: [] });
  });

  it('refuses a person who is not theirs', () => {
    expect(() => createTask(replica, { title: 'Call', category: 'Home', personIds: ['nobody'] })).toThrow(/no person with id nobody/);
  });

  it('works out a deadline and a reminder from the date, and follows the date when it moves', () => {
    const made = createTask(replica, {
      title: 'Rent', category: 'Home', dueDate: '2026-11-10',
      deadlineRule: { daysBeforeDate: 2 }, reminderRule: { daysBeforeDate: 1, at: '09:30' },
    });
    let row = replica.taskById(made.task.id)!;
    expect(row.deadlineOffsetDays).toBe(2);
    expect(local(row.deadline)).toBe('2026-11-08');
    expect(local(row.reminderTime)).toBe('2026-11-09');
    expect(new Date(row.reminderTime!).getHours()).toBe(9);
    expect(row.reminderUtcOffsetMinutes).toBe(new Date(row.reminderTime!).getTimezoneOffset());

    updateTask(replica, row.id, { dueDate: '2026-11-20' });
    row = replica.taskById(row.id)!;
    expect(local(row.deadline)).toBe('2026-11-18');
    expect(local(row.reminderTime)).toBe('2026-11-19');
    expect(new Date(row.reminderTime!).getMinutes()).toBe(30);

    // A fixed reminder replaces the rule, as the editor's fixed time does.
    updateTask(replica, row.id, { reminderTime: '2026-11-15T08:00' });
    expect(replica.taskById(row.id)!.reminderOffsetDays).toBeNull();
  });

  it('refuses a rule with nothing to count from', () => {
    expect(() => createTask(replica, { title: 'x', category: 'Home', deadlineRule: { daysAfterDate: 3 } })).toThrow(/Give dueDate too/);
    expect(() => createTask(replica, { title: 'x', category: 'Home', dueDate: '2026-11-10', reminderRule: { daysBeforeDate: 1 } })).toThrow(/needs a time of day/);
    expect(() => createTask(replica, { title: 'x', category: 'Home', reminderRule: { whenItSurfaces: true } })).toThrow(/needs a deferUntil or a time of day/);
    expect(() => createTask(replica, { title: 'x', category: 'Home', dueDate: '2026-11-10', deadlineRule: { dayOfMonth: 'last' } })).toThrow(/repeats monthly/);
  });

  it('rings when the task surfaces', () => {
    const made = createTask(replica, { title: 'Water plants', category: 'Home', deferUntil: '2026-12-01', reminderRule: { whenItSurfaces: true } });
    const row = replica.taskById(made.task.id)!;
    expect(row.reminderTracksVisibility).toBe(true);
    expect(local(row.reminderTime)).toBe('2026-12-01');
  });
});

describe('delete_task', () => {
  it('deletes a task with its checklist and keeps what Activity needs to restore it', () => {
    const t = make('Pack');
    const sub = replica.createTask({ title: 'Socks', parentId: t.id });
    const result = deleteTasks(replica, [t.id]);
    expect(result.deleted).toEqual([{ id: t.id, title: 'Pack', checklistItems: 1 }]);
    expect(replica.taskById(t.id)).toBeNull();
    expect(replica.taskById(sub.id)).toBeNull();

    const entry = ledger().find(e => e.taskId === t.id)!;
    expect(entry.action).toBe('cleared');
    const plan = agentRevertPlan(entry, null);
    expect(plan.kind).toBe('restoreDeletedTask');
    if (plan.kind === 'restoreDeletedTask') expect(plan.snapshot.subtasks.map(s => s.title)).toEqual(['Socks']);
    // Once something is back under that id, there is nothing to restore.
    expect(agentRevertPlan(entry, t).kind).toBe('none');
  });

  it('deletes one checklist item, and a checklist item named with its task goes once', () => {
    const t = make('Pack');
    const a = replica.createTask({ title: 'Socks', parentId: t.id });
    const b = replica.createTask({ title: 'Shirts', parentId: t.id });
    deleteTasks(replica, [a.id]);
    expect(replica.taskById(b.id)).not.toBeNull();
    expect(deleteTasks(replica, [b.id, t.id]).deleted.map(d => d.title)).toEqual(['Pack']);
  });

  it('refuses a task the app wrote, before deleting anything', () => {
    const mine = make('Mine');
    const generated = make('Use up spinach');
    mockRaw.runSync("UPDATE tasks SET generated_kind = 'leftover' WHERE id = ?", [generated.id]);
    replica.refresh();
    expect(() => deleteTasks(replica, [mine.id, generated.id])).toThrow(/written by the app/);
    expect(replica.taskById(mine.id)).not.toBeNull();
  });
});

describe('skip_occurrence', () => {
  it('moves a repeating task to its next date with nothing completed', () => {
    const made = createTask(replica, { title: 'Bins', category: 'Home', dueDate: '2026-11-10', repeat: { every: 'week' } });
    const result = skipOccurrence(replica, made.task.id);
    const row = replica.taskById(made.task.id)!;
    expect(row.completed).toBe(false);
    expect(local(row.dueDate)).not.toBe('2026-11-10');
    expect(result.next).toMatch(/next occurrence is on/);
    expect(replica.tasks().filter(t => t.title === 'Bins')).toHaveLength(1);
    const entry = ledger().find(e => e.taskId === row.id)!;
    expect(entry.action).toBe('moved');
    expect(agentRevertPlan(entry, row).kind).toBe('restore');
  });

  it('refuses a task that does not repeat', () => {
    expect(() => skipOccurrence(replica, make('Once').id)).toThrow(/doesn't repeat/);
  });
});

describe('reorder_tasks', () => {
  it('puts the named checklist items first and keeps the rest after them', () => {
    const t = make('Pack');
    const [a, b, c] = ['A', 'B', 'C'].map(title => replica.createTask({ title, parentId: t.id }));
    const result = reorderTasks(replica, { parentId: t.id, ids: [c.id] });
    expect(result.order.map(o => o.title)).toEqual(['C', 'A', 'B']);
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
  });

  it('swaps a project\'s steps within the slots they hold', () => {
    mockRaw.runSync("INSERT INTO projects (id, title, created_at) VALUES ('pr', 'Move', '2026-01-01T00:00:00.000Z')");
    replica.refresh();
    const loose = make('Loose');
    const [a, b] = ['First', 'Second'].map(title => make(title, { projectId: 'pr' }));
    const slots = [a, b].map(t => replica.taskById(t.id)!.sortOrder).sort((x, y) => x - y);
    reorderTasks(replica, { projectId: 'pr', ids: [b.id, a.id] });
    expect(replica.taskById(b.id)!.sortOrder).toBe(slots[0]);
    expect(replica.taskById(a.id)!.sortOrder).toBe(slots[1]);
    expect(replica.taskById(loose.id)!.sortOrder).toBe(loose.sortOrder);
  });

  it('refuses a task that is not in the list, and a call naming no list', () => {
    const t = make('Pack');
    expect(() => reorderTasks(replica, { parentId: t.id, ids: ['nope'] })).toThrow(/Not in that list/);
    expect(() => reorderTasks(replica, { ids: [t.id] })).toThrow(/Name one list/);
  });
});

describe('set_task_dates', () => {
  it('puts a task on several dates, then back to one', () => {
    const made = createTask(replica, { title: 'Walk the dog', category: 'Home', dueDate: '2026-11-10' });
    const set = setTaskDates(replica, made.task.id, ['2026-11-10', '2026-11-15']);
    expect(set.dates).toEqual(['2026-11-10', '2026-11-15']);
    expect(set.added).toBe(1);
    const rows = replica.tasks().filter(t => t.title === 'Walk the dog');
    expect(new Set(rows.map(r => r.seriesId)).size).toBe(1);

    const back = setTaskDates(replica, made.task.id, ['2026-11-10']);
    expect(back.removed).toBe(1);
    expect(replica.tasks().filter(t => t.title === 'Walk the dog')).toHaveLength(1);
    expect(replica.taskById(made.task.id)!.seriesId).toBeNull();
  });

  it('records the dates it dropped as restorable deletes', () => {
    const made = createTask(replica, { title: 'Walk', category: 'Home', dueDate: '2026-11-10' });
    setTaskDates(replica, made.task.id, ['2026-11-10', '2026-11-15']);
    mockRaw.runSync('DELETE FROM unattended_log');
    setTaskDates(replica, made.task.id, ['2026-11-10']);
    const dropped = ledger().find(e => e.action === 'cleared')!;
    expect(agentRevertPlan(dropped, null).kind).toBe('restoreDeletedTask');
  });
});

describe('duplicate_task, delete_tag and set_completion_date', () => {
  it('copies a task and its checklist with progress started over', () => {
    const t = make('Pack', { tags: ['trip'] });
    replica.createTask({ title: 'Socks', parentId: t.id });
    const copy = duplicateTask(replica, t.id);
    expect(copy.task.id).not.toBe(t.id);
    expect(copy.task.tags).toEqual(['trip']);
    expect(replica.tasks().filter(x => x.parentId === copy.task.id).map(x => x.title)).toEqual(['Socks']);
  });

  it('takes a tag off every task, with an undo per task', () => {
    const a = make('A', { tags: ['errand', 'quick'] });
    make('B', { tags: ['quick'] });
    const result = deleteTag(replica, 'Quick');
    expect(result.removedFrom).toBe(2);
    expect(replica.taskById(a.id)!.tags).toEqual(['errand']);
    expect(result.tags).not.toContain('quick');
    const entry = ledger().find(e => e.taskId === a.id)!;
    expect(agentRevertPlan(entry, replica.taskById(a.id)).kind).toBe('restore');
    expect(() => deleteTag(replica, 'nope')).toThrow(/No tag "nope"/);
  });

  it('moves a completion\'s date, and refuses a task that is not done', () => {
    const t = make('Read');
    expect(() => setCompletionDate(replica, t.id, '2026-01-02T12:00')).toThrow(/isn't completed/);
    replica.completeTask(t.id);
    const moved = setCompletionDate(replica, t.id, '2026-01-02T12:00');
    expect(local(replica.taskById(moved.id)!.completedAt)).toBe('2026-01-02');
  });

  it('lists archived tasks in their own view only', () => {
    const t = make('Old');
    replica.setTaskArchived(t.id, true);
    expect(listTasks(replica, { view: 'archived' }).tasks.map(x => x.title)).toEqual(['Old']);
    expect(listTasks(replica, { view: 'all' }).tasks.map(x => x.title)).not.toContain('Old');
  });
});
