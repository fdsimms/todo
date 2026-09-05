/**
 * The tool layer against a stub replica.
 *
 * No database and no SDK, which is the point of `tools.ts` taking a `Replica`
 * rather than reaching for one: the lenses, the caps and the projection are
 * ordinary functions over ordinary data. replica.test.ts is where the same
 * functions meet a real database.
 */
import { serializeTask } from '../serialize';
import { getTask, listGroceryItems, listProjects, listTasks, searchTasks, DEFAULT_LIMIT, MAX_LIMIT } from '../tools';
import type { Replica } from '../replica';
import type { GroceryItem, Project, Task } from '../../../src/types';

const task = (over: Partial<Task> & { id: string; title: string }): Task =>
  ({
    notes: '',
    completed: false,
    category: null,
    tags: [],
    timeSegments: [],
    priority: 0,
    parentId: null,
    projectId: null,
    dueDate: null,
    deadline: null,
    deferUntil: null,
    recurrenceType: 'none',
    chainItems: [],
    chainIndex: 0,
    pinned: false,
    ...over,
  }) as Task;

/**
 * Visibility is stubbed by convention rather than computed: a task whose id
 * starts with the lens name belongs to it. The real model is tested against a
 * real database in replica.test.ts, and duplicating it here would be testing
 * the stub.
 */
function stubReplica(over: Partial<Replica> = {}): Replica {
  const tasks: Task[] = [];
  return {
    path: ':stub:',
    refresh: () => {},
    tasks: () => tasks,
    taskById: (id: string) => tasks.find(t => t.id === id) ?? null,
    projects: () => [],
    categories: () => [],
    groceryItems: () => [],
    isVisible: (t: Task) => t.id.startsWith('today'),
    isUnscheduled: (t: Task) => t.id.startsWith('unscheduled'),
    isInbox: (t: Task) => t.id.startsWith('inbox'),
    isBlocked: (t: Task) => t.id.startsWith('blocked'),
    visibleAt: () => new Date('2099-01-01T00:00:00.000Z'),
    search: () => [],
    displayTitle: (t: Task) => t.title,
    estimatedMinutes: () => null,
    deliverableKind: () => null,
    deviceId: () => 'stub-device',
    syncable: () => true,
    ...over,
  };
}

const withTasks = (tasks: Task[], over: Partial<Replica> = {}) =>
  stubReplica({ tasks: () => tasks, taskById: id => tasks.find(t => t.id === id) ?? null, ...over });

describe('listTasks', () => {
  const everything = [
    task({ id: 'today-1', title: 'Due now' }),
    task({ id: 'later-1', title: 'Deferred' }),
    task({ id: 'unscheduled-1', title: 'Someday' }),
    task({ id: 'inbox-1', title: 'Untriaged' }),
  ];

  it('defaults to today', () => {
    const result = listTasks(withTasks(everything));
    expect(result.view).toBe('today');
    expect(result.tasks.map(t => t.id)).toEqual(['today-1']);
  });

  it('treats later as the leftover of the other three, not as its own predicate', () => {
    // This is the property that lets the four lenses stay disjoint without
    // tools.ts owning a fifth definition of "later".
    expect(listTasks(withTasks(everything), { view: 'later' }).tasks.map(t => t.id)).toEqual(['later-1']);
  });

  it.each(['unscheduled', 'inbox'] as const)('routes %s to its own selector', view => {
    expect(listTasks(withTasks(everything), { view }).tasks.map(t => t.id)).toEqual([`${view}-1`]);
  });

  it('excludes subtasks from every lens', () => {
    const tasks = [task({ id: 'today-1', title: 'Parent' }), task({ id: 'today-2', title: 'Step', parentId: 'today-1' })];
    expect(listTasks(withTasks(tasks), { view: 'all' }).tasks.map(t => t.id)).toEqual(['today-1']);
  });

  it('hides completed tasks unless asked', () => {
    const tasks = [task({ id: 'today-1', title: 'Open' }), task({ id: 'today-2', title: 'Done', completed: true })];
    expect(listTasks(withTasks(tasks), { view: 'all' }).tasks).toHaveLength(1);
    expect(listTasks(withTasks(tasks), { view: 'all', includeCompleted: true }).tasks).toHaveLength(2);
  });

  it('filters by category, tag and project', () => {
    const tasks = [
      task({ id: 'today-1', title: 'A', category: 'Home', tags: ['errand'], projectId: 'p1' }),
      task({ id: 'today-2', title: 'B', category: 'Work', tags: ['deep'], projectId: 'p2' }),
    ];
    expect(listTasks(withTasks(tasks), { category: 'Home' }).tasks.map(t => t.id)).toEqual(['today-1']);
    expect(listTasks(withTasks(tasks), { tag: 'deep' }).tasks.map(t => t.id)).toEqual(['today-2']);
    expect(listTasks(withTasks(tasks), { projectId: 'p1' }).tasks.map(t => t.id)).toEqual(['today-1']);
  });

  it('caps the list but still reports what matched', () => {
    const many = Array.from({ length: 300 }, (_, i) => task({ id: `today-${i}`, title: `T${i}` }));
    const capped = listTasks(withTasks(many));
    expect(capped.tasks).toHaveLength(DEFAULT_LIMIT);
    // The count is what tells the caller the answer was cut, so it counts
    // matches rather than what survived the cap.
    expect(capped.matched).toBe(300);

    expect(listTasks(withTasks(many), { limit: 9999 }).tasks).toHaveLength(MAX_LIMIT);
    expect(listTasks(withTasks(many), { limit: 0 }).tasks).toHaveLength(1);
  });
});

describe('searchTasks', () => {
  it('hands the query to the replica and caps the result', () => {
    const hits = Array.from({ length: 80 }, (_, i) => ({
      task: task({ id: `t${i}`, title: `T${i}` }),
      score: 1,
      projectName: null,
    }));
    const result = searchTasks(stubReplica({ search: () => hits }), { query: 'plant' });

    expect(result.query).toBe('plant');
    expect(result.matched).toBe(80);
    expect(result.tasks).toHaveLength(DEFAULT_LIMIT);
  });
});

describe('getTask', () => {
  const parent = task({ id: 'today-1', title: 'Book haircut', projectId: 'p1', chainItems: [{ title: 'Book' }, { title: 'Go' }] as Task['chainItems'], chainIndex: 1 });
  const child = task({ id: 'today-2', title: 'Find a barber', parentId: 'today-1' });
  const project = { id: 'p1', title: 'Errands', notes: '', deadline: null, archived: false } as Project;

  it('returns null for an id that is not there', () => {
    expect(getTask(stubReplica(), 'nope')).toBeNull();
  });

  it('gathers subtasks, the chain and the project', () => {
    const result = getTask(withTasks([parent, child], { projects: () => [project] }), 'today-1')!;

    expect(result.subtasks.map(t => t.id)).toEqual(['today-2']);
    expect(result.chain).toEqual({ index: 1, steps: ['Book', 'Go'] });
    expect(result.project).toEqual({ id: 'p1', title: 'Errands' });
  });

  it('says when a task is hidden and until when, and stays quiet when it is not', () => {
    expect(getTask(withTasks([parent]), 'today-1')!.hiddenUntil).toBeUndefined();

    const hidden = task({ id: 'later-1', title: 'Deferred' });
    expect(getTask(withTasks([hidden]), 'later-1')!.hiddenUntil).toBe('2099-01-01T00:00:00.000Z');
  });
});

describe('listProjects', () => {
  const projects = [
    { id: 'p1', title: 'Kitchen', notes: '', deadline: null, archived: false },
    { id: 'p2', title: 'Old thing', notes: '', deadline: null, archived: true },
  ] as Project[];

  it('leaves archived projects out', () => {
    expect(listProjects(stubReplica({ projects: () => projects })).map(p => p.id)).toEqual(['p1']);
  });

  it('counts live top-level members only', () => {
    const tasks = [
      task({ id: 'a', title: 'Open', projectId: 'p1' }),
      task({ id: 'b', title: 'Done', projectId: 'p1', completed: true }),
      task({ id: 'c', title: 'Subtask', projectId: 'p1', parentId: 'a' }),
    ];
    expect(listProjects(withTasks(tasks, { projects: () => projects }))[0].outstanding).toBe(1);
  });
});

describe('listGroceryItems', () => {
  const items = [
    { id: 'g1', name: 'Milk', quantity: '2L', aisle: 'Dairy', onList: true, checked: false },
    { id: 'g2', name: 'Paprika', quantity: null, aisle: '', onList: false, checked: false },
  ] as GroceryItem[];

  it('shows the list by default and the catalog on request', () => {
    const replica = stubReplica({ groceryItems: () => items });
    expect(listGroceryItems(replica).map(i => i.id)).toEqual(['g1']);
    expect(listGroceryItems(replica, { onListOnly: false }).map(i => i.id)).toEqual(['g1', 'g2']);
  });

  it('drops empty strings rather than reporting them', () => {
    const [, catalog] = listGroceryItems(stubReplica({ groceryItems: () => items }), { onListOnly: false });
    expect(catalog.quantity).toBeUndefined();
    expect(catalog.aisle).toBeUndefined();
  });
});

describe('serializeTask', () => {
  it('drops nulls and empty arrays rather than serializing them', () => {
    const result = serializeTask(stubReplica(), task({ id: 't', title: 'Bare' }));
    expect(result).toEqual({ id: 't', title: 'Bare', completed: false });
  });

  it('names the priority rather than emitting its number, and omits None', () => {
    expect(serializeTask(stubReplica(), task({ id: 't', title: 'A', priority: 4 })).priority).toBe('Urgent');
    expect(serializeTask(stubReplica(), task({ id: 't', title: 'A', priority: 0 })).priority).toBeUndefined();
  });

  it('takes the title from the live chain step, not from the task', () => {
    const chained = task({
      id: 't',
      title: 'Haircut',
      chainItems: [{ title: 'Book' }, { title: 'Go' }] as Task['chainItems'],
      chainIndex: 1,
    });
    const replica = stubReplica({ displayTitle: () => 'Go' });

    expect(serializeTask(replica, chained)).toMatchObject({ title: 'Go', chainStep: 'Go' });
  });

  it('does not call a single-item chain a chain', () => {
    const one = task({ id: 't', title: 'Solo', chainItems: [{ title: 'Solo' }] as Task['chainItems'] });
    expect(serializeTask(stubReplica(), one).chainStep).toBeUndefined();
  });

  it('reports blocked separately from merely not being due', () => {
    expect(serializeTask(stubReplica(), task({ id: 'blocked-1', title: 'Waiting' })).blocked).toBe(true);
    expect(serializeTask(stubReplica(), task({ id: 'today-1', title: 'Free' })).blocked).toBeUndefined();
  });
});
