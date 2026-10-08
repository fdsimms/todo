import { createProject, getProject, nextInProject, updateProject } from '../projectTools';
import type { ShimDatabase } from '../expoSqliteShim';
import type { Replica } from '../replica';
import type { Project, Task } from '../../../src/types';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

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
    liveBlockers: (t: Task) => tasks.filter(b => b.id === t.blockedById && !b.completed && !b.archived),
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

  it('does not name a finished blocker as waitsOn', () => {
    const done = task({ id: 'a', title: 'Pick colour', completed: true, completedAt: '2026-10-01T10:00:00' });
    const after = task({ id: 'b', title: 'Buy paint', blockedById: 'a' });
    const result = getProject(stub([done, after], { isBlocked: () => false }), 'p1')!;
    expect(result.open.map(t => t.id)).toEqual(['b']);
    expect(result.open[0].waitsOn).toBeUndefined();
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

describe('nextInProject', () => {
  const tasks = [
    task({ id: 'a', title: 'Pick colour', sortOrder: 1 }),
    task({ id: 'b', title: 'Buy paint', sortOrder: 2, blockedById: 'a' }),
    task({ id: 'c1', title: 'Roller', parentId: 'a', sortOrder: 1, completed: true }),
    task({ id: 'c2', title: 'Tape', parentId: 'a', sortOrder: 2 }),
    task({ id: 'c3', title: 'Brush', parentId: 'a', sortOrder: 3 }),
  ];

  it('names the first unchecked item of the first open step that is not waiting', () => {
    expect(nextInProject(stub(tasks), 'p1')).toMatchObject({
      step: { id: 'a', title: 'Pick colour' },
      next: { id: 'c2', title: 'Tape' },
      checklist: { done: 1, total: 3 },
    });
  });

  it('answers for a named step, including one that is waiting, and says when there is no item', () => {
    const waiting = nextInProject(stub(tasks), 'p1', 'b')!;
    expect(waiting.step).toMatchObject({ id: 'b', waitsOn: ['a'] });
    expect(waiting.next).toBeNull();
    expect(waiting.note).toMatch(/no checklist/);
  });

  it('says why there is nothing to name, and is null for an unknown project', () => {
    expect(nextInProject(stub(tasks), 'p1', 'zzz')).toMatchObject({ step: null, note: expect.stringMatching(/not an open step/) });
    expect(nextInProject(stub([task({ id: 'b', title: 'Buy', blockedById: 'a' }), task({ id: 'a', title: 'x', completed: true, completedAt: 'y' })], { isBlocked: () => false }), 'p1')!.step).toMatchObject({ id: 'b' });
    expect(nextInProject(stub([]), 'nope')).toBeNull();
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

describe('the project writes, against a real database', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { openReplica } = require('../replica') as typeof import('../replica');
  const tools = require('../projectTools') as typeof import('../projectTools');
  const { agentRecordPlan } = require('../../../src/utils/agentRecordRevert') as typeof import('../../../src/utils/agentRecordRevert');
  /* eslint-enable @typescript-eslint/no-require-imports */
  let real: ReturnType<typeof openReplica>;
  const raw = () => (require('../expoSqliteShim') as typeof import('../expoSqliteShim')) && mockRaw; // eslint-disable-line @typescript-eslint/no-require-imports
  const ledger = () => (require('../../../src/db/database') as typeof import('../../../src/db/database')).dbGetUnattendedLog(); // eslint-disable-line @typescript-eslint/no-require-imports

  beforeAll(() => {
    real = openReplica(':memory:');
    (require('../../../src/store/useCategoryStore') as typeof import('../../../src/store/useCategoryStore')).useCategoryStore.getState().addCategory('Home'); // eslint-disable-line @typescript-eslint/no-require-imports
    real.refresh();
  });

  const plan = () => tools.createProject(real, { title: 'Party', steps: [{ title: 'Invite' }, { title: 'Cake' }], defaultTaskCategory: 'Home' } as never).project.id;

  it('sets the editor\'s other fields, and reads them back', () => {
    const id = plan();
    raw().runSync("INSERT INTO people (id, name, created_at) VALUES ('pp', 'Ana', '2026-01-01T00:00:00.000Z')");
    real.refresh();
    const result = tools.updateProject(real, id, {
      pausedUntil: '2099-01-01', inOrder: true, personIds: ['pp'], links: [{ url: 'https://example.com', label: 'Booking' }], nudgeCadenceDays: 14,
    });
    expect(result.project).toMatchObject({
      pausedUntil: '2099-01-01', inOrder: true, people: [{ id: 'pp', name: 'Ana' }], links: [{ label: 'Booking', url: 'https://example.com' }],
      nudge: expect.objectContaining({ cadenceDays: 14 }),
    });
    expect(() => tools.updateProject(real, id, { pausedUntil: '2001-01-01' })).toThrow(/after today/);
  });

  it('puts a project in Planning and marks it ready, reported by name rather than as its day', () => {
    const created = tools.createProject(real, { title: 'Move', planning: true, steps: [{ title: 'Pack' }], defaultTaskCategory: 'Home' } as never);
    expect(created.project).toMatchObject({ planning: true });
    expect(created.project).not.toHaveProperty('pausedUntil');
    const id = created.project.id;
    expect(() => tools.updateProject(real, id, { planning: true, pausedUntil: null })).toThrow(/not both/);
    expect(tools.updateProject(real, id, { planning: false }).project).not.toHaveProperty('planning');
    // Marking ready leaves a dated pause alone.
    tools.updateProject(real, id, { pausedUntil: '2099-01-01' });
    expect(tools.updateProject(real, id, { planning: false, title: 'Move house' }).project).toMatchObject({ pausedUntil: '2099-01-01' });
    expect(tools.updateProject(real, id, { planning: true }).project).toMatchObject({ planning: true });
  });

  it('completes a project and archives what is left when asked', () => {
    const id = plan();
    const result = tools.updateProject(real, id, { completed: true }, { archiveRemaining: true });
    expect(result.archivedRemaining).toBe(2);
    expect(real.tasks().filter(t => t.projectId === id && !t.archived)).toHaveLength(0);
  });

  it('deletes a project, leaving or taking its tasks, restorable from Activity', () => {
    const id = plan();
    expect(tools.deleteProject(real, id)).toMatchObject({ tasksDeleted: 0, tasksLeftInNoProject: 2 });
    const second = plan();
    expect(tools.deleteProject(real, second, true).tasksDeleted).toBe(2);
    const entry = ledger().find(e => e.subject === 'project' && e.recordId === second)!;
    expect(agentRecordPlan(entry, { project: () => null } as never).kind).toBe('restoreDeletedProject');
  });

  it('starts a project fresh and saves one as a template', () => {
    const id = plan();
    const fresh = tools.startFreshProject(real, id);
    expect(fresh.project.id).not.toBe(id);
    expect(fresh.open.map(t => t.title)).toEqual(['Invite', 'Cake']);
    const saved = tools.saveProjectAsTemplate(real, id, 'Party plan');
    expect(saved.template).toMatchObject({ name: 'Party plan', items: 2 });
    expect(() => tools.saveProjectAsTemplate(real, id, 'party plan')).toThrow(/already a template/);
  });

  it('adds, renames and deletes a project category, and reorders projects', () => {
    expect(tools.saveProjectCategory(real, { name: 'Life' }).categories).toContain('Life');
    expect(tools.saveProjectCategory(real, { name: 'Life', newName: 'Home life' }).name).toBe('Home life');
    expect(tools.saveProjectCategory(real, { name: 'Home life', delete: true }).categories).not.toContain('Home life');
    const a = plan();
    const b = plan();
    const order = tools.reorderProjects(real, { ids: [b, a] }).projects.map(p => p.id);
    expect(order.indexOf(b)).toBeLessThan(order.indexOf(a));
  });
});
