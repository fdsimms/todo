import { projectBlueprint, templateFromProject } from '../utils/projectTemplate';
import type { Project, Task, TaskGroup } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

const task = (overrides: Partial<Task>): Task => ({
  id: 't', title: 'Task', notes: '', projectId: 'p1', parentId: null, completed: false, completedAt: null,
  archived: false, sortOrder: 0, groupId: null, seriesId: null, previousOccurrenceId: null,
  dueDate: null, deadline: null, tags: [], category: null, priority: 0, effort: 0, timeSegments: [],
  estimatedMinutes: null, recurrenceType: 'none', recurrenceInterval: 1, recurrenceDays: [],
  recurrenceMonthDay: null, recurrenceMonth: null, recurrenceFromCompletion: false,
  vacationPause: false, excludeFromSuggestions: false, deliverableKind: null,
  chainEnabled: false, chainItems: [], chainIndex: 0,
  ...overrides,
} as unknown as Task);

const group = (id: string, title: string, sortOrder: number): TaskGroup => ({
  id, title, notes: '', tags: [], category: null, sortOrder, collapsed: false, onToday: false, projectId: 'p1',
});

describe('projectBlueprint', () => {
  it('lists each task once in page order, with sections, subtasks, and no archived rows', () => {
    const tasks = [
      task({ id: 'loose', title: 'Book the venue', sortOrder: 1 }),
      task({ id: 'r1', title: 'Water plants', recurrenceType: 'weekly', completed: true, completedAt: '2026-01-01T09:00:00.000Z', sortOrder: 5 }),
      task({ id: 'r2', title: 'Water plants', recurrenceType: 'weekly', previousOccurrenceId: 'r1', sortOrder: 5 }),
      task({ id: 's1', title: 'Order cake', groupId: 'food', sortOrder: 2 }),
      task({ id: 's2', title: 'Buy drinks', groupId: 'food', sortOrder: 1 }),
      task({ id: 'gone', title: 'Filed away', archived: true, sortOrder: 0 }),
      task({ id: 'sub', title: 'Chocolate', parentId: 's1', sortOrder: 1 }),
    ];
    const blueprint = projectBlueprint('p1', tasks, [group('food', 'Food', 3)]);
    expect(blueprint.sections).toEqual([{ id: 'food', title: 'Food', checklist: false }]);
    expect(blueprint.entries.map(e => e.task.id)).toEqual(['loose', 's2', 's1', 'r2']);
    expect(blueprint.entries.find(e => e.task.id === 's1')?.subtasks).toEqual(['Chocolate']);
  });
});

describe('templateFromProject', () => {
  const project = (overrides: Partial<Project>): Project => ({
    id: 'p1', title: 'Birthday party', deadline: null, awayStart: null, ...overrides,
  } as unknown as Project);

  it("dates each task from the project's deadline, as days before the end date", () => {
    const tasks = [task({ id: 'a', title: 'Send invites', dueDate: new Date(2026, 5, 1, 12).toISOString() })];
    const draft = templateFromProject(project({ deadline: new Date(2026, 5, 15, 12).toISOString() }), tasks, []);
    expect(draft.applyContainer).toBe('project');
    expect(draft.anchorsAreAway).toBe(false);
    expect(draft.items[0]).toEqual(expect.objectContaining({ title: 'Send invites', anchor: 'end', dueOffsetDays: -14 }));
  });

  it('counts from the event date ahead of the deadline, so tasks after the event keep their place', () => {
    const tasks = [
      task({ id: 'a', title: 'Get the license', dueDate: new Date(2026, 4, 1, 12).toISOString() }),
      task({ id: 'b', title: 'Thank-you notes', dueDate: new Date(2026, 5, 21, 12).toISOString() }),
    ];
    const draft = templateFromProject(project({
      eventDate: new Date(2026, 5, 14, 12).toISOString(),
      deadline: new Date(2026, 6, 31, 12).toISOString(),
    }), tasks, []);
    expect(draft.items.map(i => i.dueOffsetDays)).toEqual([-44, 7]);
  });

  it("keeps a branch, pointed at the item its question became, and drops one on a task it doesn't carry", () => {
    const tasks = [
      task({ id: 'q', title: 'Venue?', deliverableKind: 'choice', deliverableOptions: ['Hall', 'Park'] } as Partial<Task>),
      task({ id: 'h', title: 'Book the hall', answerGate: { taskId: 'q', answers: ['Hall'] } } as Partial<Task>),
      task({ id: 'x', title: 'Elsewhere', answerGate: { taskId: 'outside', answers: ['Yes'] } } as Partial<Task>),
    ];
    const draft = templateFromProject(project({}), tasks, []);
    const [venue, hall, other] = draft.items;
    expect(hall.answerGate).toEqual({ itemId: venue.id, answers: ['Hall'] });
    expect(other.answerGate).toBeNull();
  });

  it("counts from a trip's departure and marks the template as a trip", () => {
    const tasks = [task({ id: 'a', title: 'Renew passport', dueDate: new Date(2026, 4, 1, 12).toISOString() })];
    const draft = templateFromProject(project({ awayStart: new Date(2026, 5, 12, 12).toISOString() }), tasks, []);
    expect(draft.anchorsAreAway).toBe(true);
    expect(draft.items[0]).toEqual(expect.objectContaining({ anchor: 'start', dueOffsetDays: -42 }));
  });

  it('keeps "waiting on" inside the project, and a target, phone and email', () => {
    const tasks = [
      task({ id: 'a', title: 'Book venue', sortOrder: 1, phoneNumber: '555-0100', emailAddress: 'v@example.com' } as Partial<Task>),
      task({ id: 'b', title: 'Send invites', sortOrder: 2, blockedById: 'a', blockedByIds: ['outside'], targetCount: 3, quotaPeriod: 'week' } as Partial<Task>),
    ];
    const draft = templateFromProject(project({}), tasks, []);
    const [venue, invites] = draft.items;
    // The blocker outside the project is left behind, as a gate is.
    expect(invites.blockedByItemIds).toEqual([venue.id]);
    expect(invites).toMatchObject({ targetCount: 3, quotaPeriod: 'week' });
    expect(venue).toMatchObject({ phoneNumber: '555-0100', emailAddress: 'v@example.com' });
  });

  it('keeps sections as item groups', () => {
    const tasks = [task({ id: 's', title: 'Order cake', groupId: 'food' })];
    const draft = templateFromProject(project({}), tasks, [group('food', 'Food', 1)]);
    expect(draft.itemGroups.map(g => g.title)).toEqual(['Food']);
    expect(draft.items[0].groupId).toBe(draft.itemGroups[0].id);
    expect(draft.items[0].dueOffsetDays).toBeNull();
  });

  it('keeps a checklist section a checklist, and a task its time window, link and location', () => {
    const tasks = [task({ id: 's', title: 'Socks', groupId: 'pack', windowStart: '08:00', windowEnd: '10:00', linkUrl: 'https://example.com/socks', location: 'Hall closet' } as Partial<Task>)];
    const draft = templateFromProject(project({}), tasks, [{ ...group('pack', 'Packing', 1), checklist: true } as TaskGroup]);
    expect(draft.itemGroups[0].checklist).toBe(true);
    expect(draft.items[0]).toEqual(expect.objectContaining({ windowStart: '08:00', windowEnd: '10:00', linkUrl: 'https://example.com/socks', location: 'Hall closet' }));
  });
});
