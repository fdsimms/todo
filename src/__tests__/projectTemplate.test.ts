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
    expect(blueprint.sections).toEqual([{ id: 'food', title: 'Food' }]);
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

  it("counts from a trip's departure and marks the template as a trip", () => {
    const tasks = [task({ id: 'a', title: 'Renew passport', dueDate: new Date(2026, 4, 1, 12).toISOString() })];
    const draft = templateFromProject(project({ awayStart: new Date(2026, 5, 12, 12).toISOString() }), tasks, []);
    expect(draft.anchorsAreAway).toBe(true);
    expect(draft.items[0]).toEqual(expect.objectContaining({ anchor: 'start', dueOffsetDays: -42 }));
  });

  it('keeps sections as item groups', () => {
    const tasks = [task({ id: 's', title: 'Order cake', groupId: 'food' })];
    const draft = templateFromProject(project({}), tasks, [group('food', 'Food', 1)]);
    expect(draft.itemGroups.map(g => g.title)).toEqual(['Food']);
    expect(draft.items[0].groupId).toBe(draft.itemGroups[0].id);
    expect(draft.items[0].dueOffsetDays).toBeNull();
  });
});
