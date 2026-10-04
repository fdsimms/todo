import { createProject, getProject, updateProject } from '../projectTools';
import type { Replica } from '../replica';
import type { Project, Task } from '../../../src/types';

const task = (over: Partial<Task> & { id: string; title: string }): Task =>
  ({ notes: '', completed: false, completedAt: null, archived: false, category: null, tags: [], timeSegments: [], priority: 0,
     parentId: null, projectId: 'p1', dueDate: null, deadline: null, deferUntil: null, recurrenceType: 'none',
     chainItems: [], chainIndex: 0, pinned: false, sortOrder: 0, blockedById: null, blockedByIds: [], ...over }) as Task;

const project = { id: 'p1', title: 'Hall', notes: '', deadline: null, kind: 'project', category: null, defaultTaskCategory: null, completed: false, archived: false } as unknown as Project;

function stub(tasks: Task[], over: Partial<Replica> = {}): Replica {
  return {
    projects: () => [project],
    tasks: () => tasks,
    projectProgress: () => ({ done: 1, total: 3 }),
    displayTitle: (t: Task) => t.title,
    estimatedMinutes: () => null,
    deliverableKind: () => null,
    deliverableOptions: () => [],
    isBlocked: (t: Task) => !!t.blockedById,
    ...over,
  } as unknown as Replica;
}

describe('getProject', () => {
  const tasks = [
    task({ id: 'b', title: 'Buy paint', sortOrder: 2, blockedById: 'a' }),
    task({ id: 'a', title: 'Pick colour', sortOrder: 1 }),
    task({ id: 's', title: 'Rollers', parentId: 'b', sortOrder: 1 }),
    task({ id: 'd', title: 'Measure', completed: true, completedAt: '2026-10-01T10:00:00.000Z' }),
    task({ id: 'x', title: 'Archived', archived: true }),
    task({ id: 'o', title: 'Elsewhere', projectId: 'p2' }),
  ];

  it('lists open steps in order with their checklist and blockers, and the recently done', () => {
    const result = getProject(stub(tasks), 'p1')!;
    expect(result.project).toMatchObject({ id: 'p1', kind: 'project', done: 1, total: 3 });
    expect(result.open.map(t => t.id)).toEqual(['a', 'b']);
    expect(result.open[1]).toMatchObject({ subtasks: [{ id: 's', title: 'Rollers', done: false }], waitsOn: ['a'], blocked: true });
    expect(result.recentlyDone).toEqual([{ id: 'd', title: 'Measure', completedAt: '2026-10-01T10:00:00.000Z' }]);
  });

  it('is null for an unknown project', () => {
    expect(getProject(stub([]), 'nope')).toBeNull();
  });
});

describe('createProject', () => {
  it('turns each step\'s checklist and "after" positions into the plan the replica builds', () => {
    const createProjectPlan = jest.fn(() => ({ project, tasks: [] }));
    createProject(stub([], { createProjectPlan }), {
      title: 'Hall',
      steps: [{ title: 'Pick colour' }, { title: 'Buy paint', subtasks: ['Rollers'], after: [0], estimatedMinutes: 30 }],
    });
    expect(createProjectPlan).toHaveBeenCalledWith({
      title: 'Hall',
      steps: [
        { fields: { title: 'Pick colour' }, subtasks: undefined, waitsOn: undefined },
        { fields: { title: 'Buy paint', estimatedMinutes: 30 }, subtasks: ['Rollers'], waitsOn: [0] },
      ],
    });
  });
});

describe('updateProject', () => {
  it('refuses an empty change', () => {
    expect(() => updateProject(stub([]), 'p1', {})).toThrow(/Nothing to change/);
  });
});
