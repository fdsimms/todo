import { addDays } from 'date-fns/addDays';
import { subDays } from 'date-fns/subDays';
import {
  describeProjectDeadline,
  projectCardCaption,
  projectMatchesQuery,
  projectNextStepTitle,
  projectProgressNote,
  sortProjects,
} from '../utils/projectList';
import type { Project, Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ getCategoryByName: () => null, categories: [] }) },
}));

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  title: 'Kitchen',
  notes: '',
  deadline: null,
  category: null,
  defaultTaskCategory: null,
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  completed: false,
  completedAt: null,
  ongoing: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  nudgeCadenceDays: 0,
  autoSchedule: false,
  nudgeOptIn: true,
  weekendSource: false,
  reviewDeclinedAt: null,
  reviewedAt: null,
  backfillDismissedFields: [],
  kind: 'project',
  awayStart: null,
  awayEnd: null,
  awayPauses: false,
  awayPauseDeclinedFor: null,
  destination: null,
  awayListId: null,
  awayListDeclinedFor: null,
  ...overrides,
});

const makeTask = (overrides: Partial<Task>): Task => ({
  id: 't',
  title: 'Task',
  projectId: 'p1',
  parentId: null,
  completed: false,
  archived: false,
  sortOrder: 0,
  chainItems: [],
  chainIndex: 0,
  ...overrides,
} as unknown as Task);

const noon = (d: Date) => { const c = new Date(d); c.setHours(12, 0, 0, 0); return c.toISOString(); };

describe('describeProjectDeadline', () => {
  it('marks a deadline in the next couple of days as soon, and a later one not', () => {
    expect(describeProjectDeadline(makeProject({ deadline: noon(new Date()) }), false)?.soon).toBe(true);
    expect(describeProjectDeadline(makeProject({ deadline: noon(addDays(new Date(), 2)) }), false)?.soon).toBe(true);
    expect(describeProjectDeadline(makeProject({ deadline: noon(addDays(new Date(), 3)) }), false)?.soon).toBe(false);
  });

  it('says nothing without a deadline', () => {
    expect(describeProjectDeadline(makeProject(), false)).toBeNull();
  });

  it('reads "Due today" and "Due tomorrow" rather than "By Today"', () => {
    expect(describeProjectDeadline(makeProject({ deadline: noon(new Date()) }), false)?.text).toBe('Due today');
    expect(describeProjectDeadline(makeProject({ deadline: noon(addDays(new Date(), 1)) }), false)?.text)
      .toBe('Due tomorrow');
  });

  // It used to read "Overdue · By 3d overdue".
  it('says how late once a deadline passes with work open, and says it once', () => {
    const caption = describeProjectDeadline(makeProject({ deadline: noon(subDays(new Date(), 3)) }), true);
    expect(caption).toEqual({ text: '3d overdue', overdue: true });
  });

  it('keeps a plain date for a deadline that passed after everything was done', () => {
    const caption = describeProjectDeadline(makeProject({ deadline: noon(subDays(new Date(), 3)) }), false);
    expect(caption?.overdue).toBe(false);
    expect(caption?.text).toMatch(/^Due [A-Z][a-z]{2} \d+/);
  });
});

describe('projectCardCaption', () => {
  it('names when a project was completed or archived on those lists, ahead of its deadline', () => {
    const project = makeProject({
      deadline: noon(subDays(new Date(), 3)),
      completedAt: noon(subDays(new Date(), 1)),
      archivedAt: noon(subDays(new Date(), 1)),
    });
    expect(projectCardCaption(project, false, 'completed')?.text).toMatch(/^Completed /);
    expect(projectCardCaption(project, false, 'archived')?.text).toMatch(/^Archived /);
    expect(projectCardCaption(project, true, 'active')?.text).toBe('3d overdue');
  });
});

describe('projectProgressNote', () => {
  it('says an empty project has no tasks rather than drawing nothing', () => {
    expect(projectProgressNote(makeProject(), { done: 0, total: 0 })).toBe('No tasks yet');
  });

  it('leaves an ordinary project to its bar', () => {
    expect(projectProgressNote(makeProject(), { done: 2, total: 5 })).toBeNull();
  });

  it('counts what is open on an ongoing project, which has no finish line to fill toward', () => {
    expect(projectProgressNote(makeProject({ ongoing: true }), { done: 2, total: 5 })).toBe('3 open');
    expect(projectProgressNote(makeProject({ ongoing: true }), { done: 5, total: 5 })).toBe('Nothing open');
  });
});

describe('projectNextStepTitle', () => {
  it('names the top of the project order, skipping done, archived and subtasks', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'Done already', sortOrder: 0, completed: true }),
      makeTask({ id: 'b', title: 'Filed away', sortOrder: 1, archived: true }),
      makeTask({ id: 'c', title: 'A step of something', sortOrder: 2, parentId: 'x' }),
      makeTask({ id: 'd', title: 'Measure the wall', sortOrder: 4 }),
      makeTask({ id: 'e', title: 'Order tiles', sortOrder: 3 }),
      makeTask({ id: 'f', title: 'Elsewhere', sortOrder: -1, projectId: 'p2' }),
    ];
    expect(projectNextStepTitle('p1', tasks)).toBe('Order tiles');
  });

  it('is null for a project with nothing open', () => {
    expect(projectNextStepTitle('p1', [])).toBeNull();
  });
});

describe('sortProjects', () => {
  const a = makeProject({ id: 'a', title: 'beta', sortOrder: 0, deadline: null });
  const b = makeProject({ id: 'b', title: 'Alpha', sortOrder: 1, deadline: '2030-05-01T12:00:00.000Z' });
  const c = makeProject({ id: 'c', title: 'gamma', sortOrder: 2, deadline: '2030-03-01T12:00:00.000Z' });
  const d = makeProject({ id: 'd', title: 'Delta', sortOrder: 3, deadline: null });
  const progress = new Map([
    ['a', { done: 1, total: 4 }],
    ['b', { done: 0, total: 0 }],
    ['c', { done: 3, total: 4 }],
    ['d', { done: 1, total: 2 }],
  ]);
  const ids = (ps: Project[]) => ps.map(p => p.id);

  it('keeps the hand-set order for "Your order"', () => {
    expect(ids(sortProjects([d, b, a, c], 'manual', progress))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('puts the nearest deadline first and leaves the rest in hand-set order', () => {
    expect(ids(sortProjects([a, b, c, d], 'deadline', progress))).toEqual(['c', 'b', 'a', 'd']);
  });

  it('puts the most-done first and an empty project last', () => {
    expect(ids(sortProjects([a, b, c, d], 'progress', progress))).toEqual(['c', 'd', 'a', 'b']);
  });

  it('sorts by name without regard to case', () => {
    expect(ids(sortProjects([a, b, c, d], 'name', progress))).toEqual(['b', 'a', 'd', 'c']);
  });
});

describe('projectMatchesQuery', () => {
  const project = makeProject({ title: 'Lisbon trip', notes: 'Book early', destination: 'Portugal' });

  it('matches every word anywhere in the project or its open tasks, ignoring case', () => {
    expect(projectMatchesQuery(project, [], 'lisbon')).toBe(true);
    expect(projectMatchesQuery(project, [], 'PORTUGAL early')).toBe(true);
    expect(projectMatchesQuery(project, ['Renew passport'], 'passport')).toBe(true);
  });

  it('refuses when any word is missing', () => {
    expect(projectMatchesQuery(project, ['Renew passport'], 'passport visa')).toBe(false);
  });

  it('matches everything on an empty query', () => {
    expect(projectMatchesQuery(project, [], '   ')).toBe(true);
  });
});
