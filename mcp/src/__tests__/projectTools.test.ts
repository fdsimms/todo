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
    projectDecisions: () => [],
    displayTitle: (t: Task) => t.title,
    estimatedMinutes: () => null,
    deliverableKind: () => null,
    deliverableOptions: () => [],
    isBlocked: (t: Task) => !!t.blockedById,
    isNotNeeded: () => false,
    // The real awaySpanOf keeps an end only when it falls after the start.
    awaySpan: (p: Project) => (p.awayStart ? { start: new Date(p.awayStart), end: p.awayEnd && p.awayEnd > p.awayStart ? new Date(p.awayEnd) : null } : null),
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

  it('lists decisions from the replica, and carries an answer onto a recently done row', () => {
    const answered = task({ id: 'q', title: 'Ceremony format?', completed: true, completedAt: '2026-10-02T09:00:00.000Z', deliverableValue: 'City Hall', deliverableWhy: 'Under 20 guests' } as Partial<Task> & { id: string; title: string });
    const result = getProject(stub([...tasks, answered], {
      projectDecisions: () => [answered],
      deliverableKind: (t: Task) => (t.id === 'q' ? 'choice' : null),
    }), 'p1')!;
    expect(result.decisions).toEqual([
      { id: 'q', question: 'Ceremony format?', kind: 'choice', answer: 'City Hall', decidedAt: '2026-10-02T09:00:00.000Z', why: 'Under 20 guests' },
    ]);
    expect(result.recentlyDone[0]).toEqual({ id: 'q', title: 'Ceremony format?', completedAt: '2026-10-02T09:00:00.000Z', answer: 'City Hall' });
  });

  it('is null for an unknown project', () => {
    expect(getProject(stub([]), 'nope')).toBeNull();
  });

  it('shows the away span, the destination and the vacation nomination, and leaves a half-set end out', () => {
    const trip = { ...project, awayStart: '2026-11-03T12:00:00.000Z', awayEnd: '2026-11-10T12:00:00.000Z', destination: 'Lisbon', awayPauses: true } as unknown as Project;
    expect(getProject(stub([], { projects: () => [trip] }), 'p1')!.project).toMatchObject({
      awayStart: trip.awayStart, awayEnd: trip.awayEnd, destination: 'Lisbon', pausesTasksWhileAway: true,
    });
    const halfSet = { ...trip, awayEnd: '2026-11-01T12:00:00.000Z', awayPauses: false } as unknown as Project;
    const detail = getProject(stub([], { projects: () => [halfSet] }), 'p1')!.project;
    expect(detail).toMatchObject({ awayStart: trip.awayStart, destination: 'Lisbon' });
    expect(detail).not.toHaveProperty('awayEnd');
    expect(detail).not.toHaveProperty('pausesTasksWhileAway');
    expect(getProject(stub([]), 'p1')!.project).not.toHaveProperty('awayStart');
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

  describe('the away span', () => {
    const trip = { ...project, awayStart: '2026-11-03T12:00:00.000Z', awayEnd: '2026-11-10T12:00:00.000Z', destination: 'Lisbon', awayPauses: true, awayListId: null } as unknown as Project;
    const replicaWith = (after: Partial<Project>) => stub([], {
      projects: () => [trip],
      updateProject: jest.fn(() => ({ ...trip, ...after })),
    });

    it('says when the return moved with the departure, which the replica does as the editor does', () => {
      const moved = updateProject(replicaWith({ awayStart: '2026-11-06T12:00:00.000Z', awayEnd: '2026-11-13T12:00:00.000Z' }), 'p1', { awayStart: '2026-11-06' });
      expect(moved.awayNote).toMatch(/moved with the departure.*2026-11-13/);
      // An end given alongside was asked for, so there is nothing to point out.
      const both = updateProject(replicaWith({ awayStart: '2026-11-06T12:00:00.000Z', awayEnd: '2026-11-13T12:00:00.000Z' }), 'p1', { awayStart: '2026-11-06', awayEnd: '2026-11-13' });
      expect(both).not.toHaveProperty('awayNote');
    });

    it('says what clearing the departure took with it', () => {
      const cleared = updateProject(replicaWith({ awayStart: null, awayEnd: null, destination: null, awayPauses: false }), 'p1', { awayStart: null });
      expect(cleared.awayNote).toMatch(/also cleared the return date, the destination/);
      const bare = stub([], { projects: () => [project], updateProject: jest.fn(() => project) });
      expect(updateProject(bare, 'p1', { awayStart: null })).not.toHaveProperty('awayNote');
    });
  });

  describe('moving the event', () => {
    const june = '2027-06-14T12:00:00.000Z';
    const july = '2027-07-14T12:00:00.000Z';
    const dated = [task({ id: 'l', title: 'License', dueDate: '2027-04-15T12:00:00.000Z' }), task({ id: 'u', title: 'Song' })];
    const replicaWith = (moveProjectTasks = jest.fn()) => {
      let event = june;
      return {
        moveProjectTasks,
        replica: stub(dated, {
          projects: () => [{ ...project, eventDate: event }],
          updateProject: jest.fn((_id: string, patch: { eventDate?: string }) => {
            if (patch.eventDate) event = patch.eventDate;
            return { ...project, eventDate: event };
          }),
          moveProjectTasks,
        }),
      };
    };

    it('leaves the tasks unless asked, and says how to move them afterwards', () => {
      const { replica, moveProjectTasks } = replicaWith();
      const result = updateProject(replica, 'p1', { eventDate: july });
      expect(moveProjectTasks).not.toHaveBeenCalled();
      expect(result.eventMove).toMatchObject({ days: 30, wouldMove: 1 });
      expect(result.eventMove!.note).toContain(`moveTasksFrom: "${june}"`);
    });

    it('moves them with moveTasks, or later with moveTasksFrom naming the old date', () => {
      const moved = jest.fn(() => ({ deltaDays: 30, moved: [dated[0]], skipped: [] }));
      const now = replicaWith(moved);
      expect(updateProject(now.replica, 'p1', { eventDate: july }, { moveTasks: true }).eventMove)
        .toMatchObject({ days: 30, moved: [{ id: 'l', title: 'License' }] });
      expect(moved).toHaveBeenCalledWith('p1', new Date(june), new Date(july));

      const later = replicaWith(moved);
      updateProject(later.replica, 'p1', { eventDate: july });
      updateProject(later.replica, 'p1', {}, { moveTasksFrom: june });
      expect(moved).toHaveBeenLastCalledWith('p1', expect.any(Date), new Date(july));
    });
  });
});
