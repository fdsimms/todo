import {
  useProjectStore,
  projectProgress,
  isProjectPastWindow,
} from '../store/useProjectStore';
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
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  vacationPause: false,
  timerStartedAt: null,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
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
});

describe('archiveProject / unarchiveProject', () => {
  it('archives a project, stamping archivedAt', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', archived: false })] });
    useProjectStore.getState().archiveProject('p1');
    const project = useProjectStore.getState().getProjectById('p1')!;
    expect(project.archived).toBe(true);
    expect(project.archivedAt).not.toBeNull();
  });

  it('unarchives a project, clearing archivedAt', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', archived: true, archivedAt: '2025-01-01T00:00:00.000Z' })] });
    useProjectStore.getState().unarchiveProject('p1');
    const project = useProjectStore.getState().getProjectById('p1')!;
    expect(project.archived).toBe(false);
    expect(project.archivedAt).toBeNull();
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
