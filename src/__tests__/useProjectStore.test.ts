import {
  useProjectStore,
  projectProgress,
  isProjectPastWindow,
} from '../store/useProjectStore';
import { DEFAULT_NUDGE_CADENCE_DAYS } from '../types';
import {
  dbGetAllProjects,
  dbInsertProject,
  dbUpdateProject,
  dbDeleteProject,
  dbBatchUpdateProjectSortOrders,
} from '../db/database';
import type { Task, Project } from '../types';

jest.mock('../db/database', () => ({
  dbGetAllProjects: jest.fn().mockReturnValue([]),
  dbInsertProject: jest.fn(),
  dbUpdateProject: jest.fn(),
  dbDeleteProject: jest.fn(),
  dbBatchUpdateProjectSortOrders: jest.fn(),
}));

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  seenAt: null,
  dueDate: null,
  deadline: null,
  deadlineOffsetDays: null,
  deadlineMonthDay: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  targetCount: null,
  targetUnit: null,
  allowOvershoot: false,
  progressCount: 0,
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  vacationPause: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
  phoneNumber: null,
  emailAddress: null,
  blockedById: null,
  pendingImport: null,
  ...overrides,
});

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  title: 'Summer Bucket List',
  notes: '',
  targetStartDate: null,
  targetEndDate: null,
  category: null,
  sortOrder: 1,
  archived: false,
  archivedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  nudgeCadenceDays: 14,
  autoSchedule: false,
  sequential: false,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetAllProjects as jest.Mock).mockReturnValue([]);
  useProjectStore.setState({ projects: [], initialized: false });
});

// ─── projectProgress ────────────────────────────────────────────────────────

describe('projectProgress', () => {
  it('is 0/0 for a project with no tasks', () => {
    expect(projectProgress('p1', [])).toEqual({ done: 0, total: 0 });
  });

  it('counts partial completion', () => {
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1', completed: true }),
      makeTask({ id: 'b', projectId: 'p1', completed: false }),
      makeTask({ id: 'c', projectId: 'p1', completed: false }),
    ];
    expect(projectProgress('p1', tasks)).toEqual({ done: 1, total: 3 });
  });

  it('does not count a member whose only row was marked missed', () => {
    // A miss is stored as a completed row (see Task.missedAt), so the plain
    // `completed` test would call this project finished. Normally the miss
    // spawns a successor that keeps the member outstanding; this is the case
    // where the recurrence ran out on the very occurrence that got missed.
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1', completed: true }),
      makeTask({ id: 'b', projectId: 'p1', completed: true, missedAt: '2025-01-05T00:00:00.000Z' }),
    ];
    expect(projectProgress('p1', tasks)).toEqual({ done: 1, total: 2 });
  });

  it('still counts a member that was missed once and completed later', () => {
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1', completed: true, missedAt: '2025-01-05T00:00:00.000Z' }),
      makeTask({ id: 'b', projectId: 'p1', completed: true, previousOccurrenceId: 'a' }),
    ];
    expect(projectProgress('p1', tasks)).toEqual({ done: 1, total: 1 });
  });

  it('is fully done when every member task is complete', () => {
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1', completed: true }),
      makeTask({ id: 'b', projectId: 'p1', completed: true }),
    ];
    expect(projectProgress('p1', tasks)).toEqual({ done: 2, total: 2 });
  });

  it('excludes true subtasks even if their parent is in the project', () => {
    const tasks = [
      makeTask({ id: 'parent', projectId: 'p1', completed: false }),
      makeTask({ id: 'sub', projectId: 'p1', parentId: 'parent', completed: true }),
    ];
    expect(projectProgress('p1', tasks)).toEqual({ done: 0, total: 1 });
  });

  it('excludes individually-archived tasks from both sides of the ratio', () => {
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1', completed: true }),
      makeTask({ id: 'b', projectId: 'p1', completed: false, archived: true }),
    ];
    expect(projectProgress('p1', tasks)).toEqual({ done: 1, total: 1 });
  });

  // Counting rows grew the denominator by one per completion forever: a
  // project holding a single daily task read 0/1, 1/2, 2/3, 3/4 — a bar
  // creeping toward a 100% it could never reach, off a total that was really a
  // completion count.
  it('counts a recurring member once, however many occurrences it has left behind', () => {
    const tasks = [
      makeTask({ id: 'r1', projectId: 'p1', completed: true, completedAt: '2025-01-01T09:00:00.000Z' }),
      makeTask({ id: 'r2', projectId: 'p1', completed: true, completedAt: '2025-01-02T09:00:00.000Z', previousOccurrenceId: 'r1' }),
      makeTask({ id: 'r3', projectId: 'p1', completed: true, completedAt: '2025-01-03T09:00:00.000Z', previousOccurrenceId: 'r2' }),
      makeTask({ id: 'r4', projectId: 'p1', completed: false, previousOccurrenceId: 'r3' }),
    ];
    expect(projectProgress('p1', tasks)).toEqual({ done: 0, total: 1 });
  });

  it('reads a habit as outstanding rather than done, alongside finished one-offs', () => {
    const tasks = [
      makeTask({ id: 'one', projectId: 'p1', completed: true, completedAt: '2025-01-01T09:00:00.000Z' }),
      makeTask({ id: 'r1', projectId: 'p1', completed: true, completedAt: '2025-01-01T09:00:00.000Z' }),
      makeTask({ id: 'r2', projectId: 'p1', completed: false, previousOccurrenceId: 'r1' }),
    ];
    expect(projectProgress('p1', tasks)).toEqual({ done: 1, total: 2 });
  });

  it('counts a recurring member as done once its schedule has run out', () => {
    const tasks = [
      makeTask({ id: 'r1', projectId: 'p1', completed: true, completedAt: '2025-01-01T09:00:00.000Z' }),
      makeTask({ id: 'r2', projectId: 'p1', completed: true, completedAt: '2025-01-02T09:00:00.000Z', previousOccurrenceId: 'r1' }),
    ];
    expect(projectProgress('p1', tasks)).toEqual({ done: 1, total: 1 });
  });

  // A dated series is several rows standing for one commitment.
  it('counts a dated series once, and done only when every date is', () => {
    const partial = [
      makeTask({ id: 's1', projectId: 'p1', seriesId: 'set', completed: true, completedAt: '2025-01-01T09:00:00.000Z' }),
      makeTask({ id: 's2', projectId: 'p1', seriesId: 'set', completed: false }),
    ];
    expect(projectProgress('p1', partial)).toEqual({ done: 0, total: 1 });

    const finished = partial.map(t => ({ ...t, completed: true, completedAt: '2025-01-01T09:00:00.000Z' }));
    expect(projectProgress('p1', finished)).toEqual({ done: 1, total: 1 });
  });

  it('still counts a one-off finished long ago as a done member', () => {
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1', completed: true, completedAt: '2024-06-01T09:00:00.000Z' }),
      makeTask({ id: 'b', projectId: 'p1', completed: false }),
    ];
    expect(projectProgress('p1', tasks)).toEqual({ done: 1, total: 2 });
  });

  it('survives a previousOccurrenceId loop rather than spinning during render', () => {
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1', previousOccurrenceId: 'b' }),
      makeTask({ id: 'b', projectId: 'p1', previousOccurrenceId: 'a' }),
    ];
    expect(projectProgress('p1', tasks).total).toBeGreaterThan(0);
  });

  it('includes tasks that also belong to a TaskGroup', () => {
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1', groupId: 'g1', completed: false }),
    ];
    expect(projectProgress('p1', tasks)).toEqual({ done: 0, total: 1 });
  });

  it('ignores tasks belonging to a different project', () => {
    const tasks = [makeTask({ id: 'a', projectId: 'p2' })];
    expect(projectProgress('p1', tasks)).toEqual({ done: 0, total: 0 });
  });
});

// ─── isProjectPastWindow ────────────────────────────────────────────────────

describe('isProjectPastWindow', () => {
  it('is false when there is no target end date', () => {
    const project = makeProject({ targetEndDate: null });
    expect(isProjectPastWindow(project, { done: 0, total: 2 })).toBe(false);
  });

  it('is false when the target end date is in the future', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    const project = makeProject({ targetEndDate: future });
    expect(isProjectPastWindow(project, { done: 0, total: 2 })).toBe(false);
  });

  it('is true when the target end date has passed and the project is incomplete and not archived', () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    const project = makeProject({ targetEndDate: past, archived: false });
    expect(isProjectPastWindow(project, { done: 1, total: 2 })).toBe(true);
  });

  it('is false when the project is archived, even past its window', () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    const project = makeProject({ targetEndDate: past, archived: true });
    expect(isProjectPastWindow(project, { done: 1, total: 2 })).toBe(false);
  });

  it('is false when the project hit 100% naturally, even if not archived', () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    const project = makeProject({ targetEndDate: past, archived: false });
    expect(isProjectPastWindow(project, { done: 2, total: 2 })).toBe(false);
  });
});

// ─── store CRUD ─────────────────────────────────────────────────────────────

describe('createProject / updateProject / getProjectById', () => {
  it('creates a project with the given fields and persists it', () => {
    const project = useProjectStore.getState().createProject('Summer Bucket List', null, '2026-09-01T00:00:00.000Z');
    expect(project.title).toBe('Summer Bucket List');
    expect(project.targetEndDate).toBe('2026-09-01T00:00:00.000Z');
    expect(project.archived).toBe(false);
    expect(dbInsertProject).toHaveBeenCalledWith(project);
    expect(useProjectStore.getState().projects).toContainEqual(project);
  });

  it('updates fields on an existing project', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', title: 'Old' })] });
    useProjectStore.getState().updateProject('p1', { title: 'New' });
    expect(useProjectStore.getState().getProjectById('p1')?.title).toBe('New');
    expect(dbUpdateProject).toHaveBeenCalled();
  });

  it('is a no-op when updating a project that does not exist', () => {
    useProjectStore.getState().updateProject('missing', { title: 'New' });
    expect(dbUpdateProject).not.toHaveBeenCalled();
  });

  it('gives a new project the default nudge cadence, with auto-scheduling off', () => {
    const project = useProjectStore.getState().createProject('Kitchen remodel', null, null);
    expect(project.nudgeCadenceDays).toBe(DEFAULT_NUDGE_CADENCE_DAYS);
    expect(project.autoSchedule).toBe(false);
  });

  // Regression test for the narrow patch whitelist: these two are only
  // writable because updateProject's Pick was widened to include them.
  it('writes the nudge settings through updateProject', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });

    useProjectStore.getState().updateProject('p1', { nudgeCadenceDays: 3, autoSchedule: true });

    const updated = useProjectStore.getState().getProjectById('p1');
    expect(updated?.nudgeCadenceDays).toBe(3);
    expect(updated?.autoSchedule).toBe(true);
    expect(dbUpdateProject).toHaveBeenCalledWith(expect.objectContaining({ nudgeCadenceDays: 3, autoSchedule: true }));
  });
});

describe('bulkSetProjectCategory', () => {
  it('files every named project, leaving the rest alone', () => {
    useProjectStore.setState({
      projects: [
        makeProject({ id: 'p1', category: null }),
        makeProject({ id: 'p2', category: 'Home' }),
        makeProject({ id: 'p3', category: null }),
      ],
    });
    useProjectStore.getState().bulkSetProjectCategory(['p1', 'p2'], 'Work');
    expect(useProjectStore.getState().projects.map(p => p.category)).toEqual(['Work', 'Work', null]);
    expect(dbUpdateProject).toHaveBeenCalledTimes(2);
  });

  it('clears the category when passed null', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', category: 'Work' })] });
    useProjectStore.getState().bulkSetProjectCategory(['p1'], null);
    expect(useProjectStore.getState().getProjectById('p1')!.category).toBeNull();
  });

  it('writes nothing when every named project already has that category', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', category: 'Work' })] });
    useProjectStore.getState().bulkSetProjectCategory(['p1', 'missing'], 'Work');
    expect(dbUpdateProject).not.toHaveBeenCalled();
  });
});

describe('applyProjectArchived', () => {
  it('archives a project, stamping archivedAt', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', archived: false })] });
    useProjectStore.getState().applyProjectArchived('p1', true);
    const project = useProjectStore.getState().getProjectById('p1')!;
    expect(project.archived).toBe(true);
    expect(project.archivedAt).not.toBeNull();
  });

  it('keeps a passed-in archivedAt instead of stamping now', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', archived: false })] });
    useProjectStore.getState().applyProjectArchived('p1', true, '2025-01-01T00:00:00.000Z');
    expect(useProjectStore.getState().getProjectById('p1')!.archivedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('unarchives a project, clearing archivedAt', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', archived: true, archivedAt: '2025-01-01T00:00:00.000Z' })] });
    useProjectStore.getState().applyProjectArchived('p1', false);
    const project = useProjectStore.getState().getProjectById('p1')!;
    expect(project.archived).toBe(false);
    expect(project.archivedAt).toBeNull();
  });

  it('is a no-op when the project is already in the requested state', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', archived: true, archivedAt: '2025-01-01T00:00:00.000Z' })] });
    useProjectStore.getState().applyProjectArchived('p1', true);
    expect(useProjectStore.getState().getProjectById('p1')!.archivedAt).toBe('2025-01-01T00:00:00.000Z');
  });
});

describe('reorderProjects', () => {
  it('reassigns sortOrder to match the given id order', () => {
    useProjectStore.setState({
      projects: [makeProject({ id: 'a', sortOrder: 1 }), makeProject({ id: 'b', sortOrder: 2 })],
    });
    useProjectStore.getState().reorderProjects(['b', 'a']);
    const ids = useProjectStore.getState().projects.map(p => p.id);
    expect(ids).toEqual(['b', 'a']);
    expect(dbBatchUpdateProjectSortOrders).toHaveBeenCalled();
  });
});

describe('reorderProjectsWithCategoryUpdates', () => {
  it('reorders and applies category changes together', () => {
    useProjectStore.setState({
      projects: [
        makeProject({ id: 'a', sortOrder: 1, category: 'Work' }),
        makeProject({ id: 'b', sortOrder: 2, category: null }),
      ],
    });
    useProjectStore.getState().reorderProjectsWithCategoryUpdates(
      ['b', 'a'],
      [{ id: 'b', category: 'Work' }],
    );
    const projects = useProjectStore.getState().projects;
    expect(projects.map(p => p.id)).toEqual(['b', 'a']);
    expect(useProjectStore.getState().getProjectById('b')?.category).toBe('Work');
    expect(dbBatchUpdateProjectSortOrders).toHaveBeenCalled();
    expect(dbUpdateProject).toHaveBeenCalled();
  });
});

describe('removeProjectRow / restoreProject', () => {
  it('deletes the row and removes it from state', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useProjectStore.getState().removeProjectRow('p1');
    expect(dbDeleteProject).toHaveBeenCalledWith('p1');
    expect(useProjectStore.getState().projects).toHaveLength(0);
  });

  it('restores a project row', () => {
    const project = makeProject({ id: 'p1' });
    useProjectStore.getState().restoreProject(project);
    expect(dbInsertProject).toHaveBeenCalledWith(project);
    expect(useProjectStore.getState().projects).toContainEqual(project);
  });
});
