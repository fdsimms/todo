import { buildTodayProjectBands } from '../utils/todayProjectBands';
import type { Project, Task, TaskGroup } from '../types';

const project = (id: string, overrides: Partial<Project> = {}): Project =>
  ({ id, title: id, sortOrder: 0, archived: false, groupOnToday: true, ...overrides } as Project);

const task = (id: string, overrides: Partial<Task> = {}): Task =>
  ({ id, groupId: null, projectId: null, sortOrder: 0, ...overrides } as Task);

const group = (id: string, overrides: Partial<TaskGroup> = {}): TaskGroup =>
  ({ id, title: id, sortOrder: 0, projectId: null, collapsed: true, ...overrides } as TaskGroup);

const shape = (result: ReturnType<typeof buildTodayProjectBands>) =>
  result.bands.map(b => ({
    project: b.project.id,
    items: b.items.map(i => (i.type === 'task' ? i.task.id : `[${i.group.id}]`)),
    count: b.taskCount,
  }));

describe('buildTodayProjectBands', () => {
  it('takes nothing when no project is switched on', () => {
    const result = buildTodayProjectBands(
      [task('a', { projectId: 'p1' })],
      [],
      [project('p1', { groupOnToday: false })],
    );
    expect(result.bands).toEqual([]);
    expect(result.bandedTaskIds.size).toBe(0);
  });

  it('gathers a project’s loose tasks and leaves every other task where it was', () => {
    const result = buildTodayProjectBands(
      [task('a', { projectId: 'p1' }), task('b'), task('c', { projectId: 'p2' })],
      [],
      [project('p1'), project('p2', { groupOnToday: false })],
    );
    expect(shape(result)).toEqual([{ project: 'p1', items: ['a'], count: 1 }]);
    expect([...result.bandedTaskIds]).toEqual(['a']);
  });

  it('takes a stack homed on the project, whoever its members belong to', () => {
    const shirts = task('shirts', { groupId: 'clothes', projectId: 'p1' });
    const borrowed = task('borrowed', { groupId: 'clothes', projectId: 'other' });
    const result = buildTodayProjectBands(
      [shirts, borrowed],
      [{ group: group('clothes', { projectId: 'p1' }), children: [shirts, borrowed] }],
      [project('p1')],
    );
    expect(shape(result)).toEqual([{ project: 'p1', items: ['[clothes]'], count: 2 }]);
    expect([...result.bandedGroupIds]).toEqual(['clothes']);
    // A stacked task rides with its stack and is never a loose row as well.
    expect(result.bandedTaskIds.size).toBe(0);
  });

  it('takes a stack homed nowhere only when every member it shows is in the project', () => {
    const a = task('a', { groupId: 'mine', projectId: 'p1' });
    const b = task('b', { groupId: 'mine', projectId: 'p1' });
    const c = task('c', { groupId: 'split', projectId: 'p1' });
    const d = task('d', { groupId: 'split', projectId: null });
    const result = buildTodayProjectBands(
      [a, b, c, d],
      [
        { group: group('mine'), children: [a, b] },
        { group: group('split'), children: [c, d] },
      ],
      [project('p1')],
    );
    expect(shape(result)).toEqual([{ project: 'p1', items: ['[mine]'], count: 2 }]);
  });

  it('leaves a stack homed on a project that is not switched on', () => {
    const a = task('a', { groupId: 'g', projectId: 'p1' });
    const result = buildTodayProjectBands(
      [a],
      [{ group: group('g', { projectId: 'p2' }), children: [a] }],
      [project('p1'), project('p2', { groupOnToday: false })],
    );
    expect(result.bands).toEqual([]);
  });

  it('orders a band by the project’s own order, stacks and tasks in one space', () => {
    const member = task('m', { groupId: 'g', projectId: 'p1', sortOrder: 1 });
    const result = buildTodayProjectBands(
      [task('late', { projectId: 'p1', sortOrder: 30 }), member, task('early', { projectId: 'p1', sortOrder: 10 })],
      [{ group: group('g', { projectId: 'p1', sortOrder: 20 }), children: [member] }],
      [project('p1')],
    );
    expect(shape(result)[0].items).toEqual(['early', '[g]', 'late']);
  });

  it('orders bands by the Projects page and drops a project with nothing on the day', () => {
    const result = buildTodayProjectBands(
      [task('a', { projectId: 'second' }), task('b', { projectId: 'first' })],
      [],
      [project('second', { sortOrder: 2 }), project('first', { sortOrder: 1 }), project('idle', { sortOrder: 0 })],
    );
    expect(shape(result).map(b => b.project)).toEqual(['first', 'second']);
  });

  it('ignores an archived project', () => {
    const result = buildTodayProjectBands(
      [task('a', { projectId: 'p1' })],
      [],
      [project('p1', { archived: true })],
    );
    expect(result.bands).toEqual([]);
  });
});
