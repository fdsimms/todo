import { buildProjectListItems } from '../utils/projectStacks';
import type { Task, TaskGroup } from '../types';

const group = (id: string, overrides: Partial<TaskGroup> = {}): TaskGroup => ({
  id,
  title: id,
  notes: '',
  tags: [],
  category: null,
  sortOrder: 1,
  collapsed: true,
  projectId: null,
  ...overrides,
});

// Only the fields buildProjectListItems reads — it never looks at a task
// beyond its id and groupId, so a full Task factory would be noise here.
const task = (id: string, groupId: string | null = null, sortOrder = 0): Task =>
  ({ id, groupId, sortOrder } as Task);

const titles = (items: ReturnType<typeof buildProjectListItems>) =>
  items.map(i => (i.type === 'task' ? i.task.id : `[${i.group.id}]`));

describe('buildProjectListItems', () => {
  it('keeps loose tasks in the order given', () => {
    const items = buildProjectListItems([task('a'), task('b')], [], 'p1');
    expect(titles(items)).toEqual(['a', 'b']);
  });

  it('collapses a stack into one row carrying every member', () => {
    const items = buildProjectListItems(
      [task('a', null, 10), task('b', 'g1', 1), task('c', null, 20), task('d', 'g1', 2)],
      [group('g1', { sortOrder: 15 })],
      'p1',
    );
    expect(titles(items)).toEqual(['a', '[g1]', 'c']);
    const stack = items.find(i => i.type === 'group');
    expect(stack?.type === 'group' && stack.children.map(t => t.id)).toEqual(['b', 'd']);
  });

  // The bug this module was rewritten to kill. A member's sortOrder is its
  // within-stack 1..K order, which is far below any loose task's, so reading
  // the stack's position off it pinned every stack to the top of the project.
  it('positions a stack by its own sortOrder, not its members', () => {
    const items = buildProjectListItems(
      [task('first', null, 10), task('second', null, 20), task('member', 'g1', 1)],
      [group('g1', { sortOrder: 30 })],
      'p1',
    );
    expect(titles(items)).toEqual(['first', 'second', '[g1]']);
  });

  // The other half of the same fix: gaining a first member must not move the
  // stack, or one filled by dragging a task onto it jumps up the list.
  it('does not move a stack when it takes its first member', () => {
    const groups = [group('g1', { projectId: 'p1', sortOrder: 30 })];
    const before = buildProjectListItems([task('a', null, 10), task('b', null, 20)], groups, 'p1');
    const after = buildProjectListItems(
      [task('a', null, 10), task('b', null, 20), task('joined', 'g1', 1)],
      groups,
      'p1',
    );
    expect(titles(before)).toEqual(['a', 'b', '[g1]']);
    expect(titles(after)).toEqual(['a', 'b', '[g1]']);
  });

  it('renders a task loose when its groupId points at no stack', () => {
    const items = buildProjectListItems([task('a', 'gone')], [], 'p1');
    expect(titles(items)).toEqual(['a']);
  });

  // The point of TaskGroup.projectId: the membership walk can only reach a
  // stack through a task pointing at it, so an empty one needs its own route.
  it('shows a stack homed on this project that has no members', () => {
    const items = buildProjectListItems(
      [task('a', null, 10)],
      [group('g1', { projectId: 'p1', sortOrder: 20 })],
      'p1',
    );
    expect(titles(items)).toEqual(['a', '[g1]']);
    const stack = items.find(i => i.type === 'group');
    expect(stack?.type === 'group' && stack.children).toEqual([]);
  });

  it('leaves an empty stack homed on another project out', () => {
    const items = buildProjectListItems([task('a')], [group('g1', { projectId: 'p2' })], 'p1');
    expect(titles(items)).toEqual(['a']);
  });

  it('leaves an empty stack with no home out', () => {
    const items = buildProjectListItems([task('a')], [group('g1')], 'p1');
    expect(titles(items)).toEqual(['a']);
  });

  // The overlap that must not double up: homed here *and* holding tasks here.
  it('lists a homed stack that also holds tasks here exactly once', () => {
    const items = buildProjectListItems(
      [task('a', 'g1', 1), task('b', null, 20)],
      [group('g1', { projectId: 'p1', sortOrder: 10 })],
      'p1',
    );
    expect(titles(items)).toEqual(['[g1]', 'b']);
    expect(items.filter(i => i.type === 'group')).toHaveLength(1);
  });

  it('orders several empty stacks among themselves by sortOrder', () => {
    const items = buildProjectListItems(
      [task('a', null, 1)],
      [
        group('late', { projectId: 'p1', sortOrder: 9 }),
        group('early', { projectId: 'p1', sortOrder: 2 }),
      ],
      'p1',
    );
    expect(titles(items)).toEqual(['a', '[early]', '[late]']);
  });

  // TaskGroup.sortOrder is the same space as Task.sortOrder, so an empty stack
  // slots among the tasks rather than being parked at the end of the list.
  it('slots a stack between tasks by sortOrder', () => {
    const items = buildProjectListItems(
      [task('a', null, 1), task('b', null, 5)],
      [group('mid', { projectId: 'p1', sortOrder: 3 })],
      'p1',
    );
    expect(titles(items)).toEqual(['a', '[mid]', 'b']);
  });

  it('puts an empty stack above every task when it sorts first', () => {
    const items = buildProjectListItems(
      [task('a', null, 4)],
      [group('top', { projectId: 'p1', sortOrder: 1 })],
      'p1',
    );
    expect(titles(items)).toEqual(['[top]', 'a']);
  });

  // The merge only inserts — it must never re-sort the loose rows it was
  // handed, since the caller has already put them in the project's own order.
  it('leaves the given task order alone', () => {
    const items = buildProjectListItems(
      [task('b', null, 9), task('a', null, 2)],
      [],
      'p1',
    );
    expect(titles(items)).toEqual(['b', 'a']);
  });

  // A stack whose members are all finished drops out of the incomplete list,
  // which is what used to take the whole row away mid-project.
  it('keeps a homed stack once every member is complete', () => {
    const items = buildProjectListItems([], [group('g1', { projectId: 'p1', sortOrder: 5 })], 'p1');
    expect(titles(items)).toEqual(['[g1]']);
  });
});
