import { buildProjectListItems, projectCopyText, projectPageOrder, alphabeticalPageOrder, orderWithInserted, filterProjectListItems, filterTasksByTitle } from '../utils/projectStacks';
import type { Task, TaskGroup } from '../types';

const group = (id: string, overrides: Partial<TaskGroup> = {}): TaskGroup => ({
  id,
  title: id,
  notes: '',
  tags: [],
  category: null,
  sortOrder: 1,
  collapsed: true,
  onToday: false,
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

describe('projectCopyText', () => {
  const t = (id: string, overrides: Partial<Task> = {}): Task =>
    ({ id, title: id, projectId: 'p1', completed: false, sortOrder: 0, ...overrides } as Task);

  it('keeps section headings and indents open subtasks', () => {
    const items = [
      { type: 'task' as const, task: t('Book flights') },
      {
        type: 'group' as const,
        group: group('g1', { title: 'Packing' }),
        children: [t('Passport'), t('Chargers'), t('From another project', { projectId: 'p2' })],
      },
      { type: 'task' as const, task: t('Pay deposit') },
    ];
    const subs: Record<string, Task[]> = {
      'Book flights': [t('Aisle seat', { sortOrder: 2 }), t('Check bag', { sortOrder: 1 }), t('Done one', { completed: true })],
    };
    expect(projectCopyText(items, id => subs[id] ?? [], 'p1')).toBe(
      ['Book flights', '  Check bag', '  Aisle seat', '', 'Packing', '  Passport', '  Chargers', '', 'Pay deposit'].join('\n'),
    );
  });

  it('skips a section with none of this project\'s tasks', () => {
    const items = [{ type: 'group' as const, group: group('g1'), children: [] }];
    expect(projectCopyText(items, () => [], 'p1')).toBe('');
  });
});

describe('projectPageOrder', () => {
  it('flattens the page: loose tasks by their order, a section in its slot with its own tasks in theirs', () => {
    const tasks = [task('late', null, 30), task('early', null, 10), task('s2', 'g', 2), task('s1', 'g', 1)];
    const order = projectPageOrder(tasks, [group('g', { sortOrder: 20 })], 'p1');
    expect(order.map(t => t.id)).toEqual(['early', 's1', 's2', 'late']);
  });
});

describe('alphabeticalPageOrder', () => {
  const titled = (id: string, title: string, groupId: string | null = null, sortOrder = 0): Task =>
    ({ id, title, groupId, sortOrder } as Task);

  it('sorts loose lines among their own slots and leaves a section where it is', () => {
    const items = buildProjectListItems(
      [titled('c', 'cherry', null, 1), titled('a', 'Apple', null, 2), titled('b', 'banana', null, 9)],
      [group('g', { sortOrder: 5 })],
      'p1',
    );
    // g is homed nowhere and holds nothing here, so only the three loose lines show.
    expect(alphabeticalPageOrder(items).top).toEqual(['a', 'b', 'c']);
  });

  it('keeps a section in its slot and sorts inside it, numbers as numbers', () => {
    const items = buildProjectListItems(
      [
        titled('z', 'Zucchini', null, 1),
        titled('ch10', 'Chapter 10', 'g', 1),
        titled('ch2', 'Chapter 2', 'g', 2),
        titled('m', 'mango', null, 9),
      ],
      [group('g', { sortOrder: 5 })],
      'p1',
    );
    const order = alphabeticalPageOrder(items);
    expect(order.top).toEqual(['m', 'g', 'z']);
    expect(order.sections).toEqual([{ groupId: 'g', ids: ['ch2', 'ch10'] }]);
  });
});

describe('orderWithInserted', () => {
  const titled = (id: string, groupId: string | null = null, sortOrder = 0): Task =>
    ({ id, title: id, groupId, sortOrder } as Task);

  it('puts a new loose line right after the one it follows', () => {
    const items = buildProjectListItems([titled('a', null, 1), titled('b', null, 2)], [], 'p1');
    expect(orderWithInserted(items, 'a', 'new')).toEqual({ groupId: null, ids: ['a', 'new', 'b'] });
  });

  it('puts it inside the section when the line it follows is in one', () => {
    const items = buildProjectListItems(
      [titled('x', null, 1), titled('s1', 'g', 1), titled('s2', 'g', 2)],
      [group('g', { sortOrder: 5 })],
      'p1',
    );
    expect(orderWithInserted(items, 's1', 'new')).toEqual({ groupId: 'g', ids: ['s1', 'new', 's2'] });
  });

  it('is null for a line that is not on the page', () => {
    expect(orderWithInserted([], 'gone', 'new')).toBeNull();
  });
});

describe('filterProjectListItems', () => {
  const titled = (id: string, title: string, groupId: string | null = null, sortOrder = 0): Task =>
    ({ id, title, groupId, sortOrder } as Task);
  const items = () => buildProjectListItems(
    [titled('a', 'Crème fraîche', null, 1), titled('b', 'Bread', null, 2), titled('c', 'Cream cheese', 'g', 1), titled('d', 'Eggs', 'g', 2)],
    [group('g', { title: 'Dairy', sortOrder: 5 })],
    'p1',
  );

  it('keeps matching lines, ignoring case and accents, and trims a section to its matches', () => {
    const out = filterProjectListItems(items(), 'creme');
    expect(titles(out)).toEqual(['a']);
    const cream = filterProjectListItems(items(), 'CREAM');
    expect(titles(cream)).toEqual(['[g]']);
    expect(cream[0].type === 'group' && cream[0].children.map(t => t.id)).toEqual(['c']);
  });

  it('keeps a whole section whose title matches, and everything for an empty query', () => {
    const dairy = filterProjectListItems(items(), 'dairy');
    expect(dairy[0].type === 'group' && dairy[0].children).toHaveLength(2);
    expect(filterProjectListItems(items(), '  ')).toHaveLength(items().length);
  });
});

describe('filterTasksByTitle', () => {
  const tasks = [
    { id: 'a', title: 'Crème brûlée' },
    { id: 'b', title: 'Tent' },
  ] as Task[];

  it('matches like filterProjectListItems: case and accents ignored', () => {
    expect(filterTasksByTitle(tasks, 'CREME').map(t => t.id)).toEqual(['a']);
  });

  it('keeps everything for a blank query', () => {
    expect(filterTasksByTitle(tasks, '  ').map(t => t.id)).toEqual(['a', 'b']);
  });
});
