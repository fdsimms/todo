import { useProjectStore } from '../store/useProjectStore';
import {
  dbGetAllProjects,
  dbInsertProject,
  dbUpdateProject,
  dbDeleteProject,
  dbBatchUpdateProjectOrders,
} from '../db/database';
import type { Project } from '../types';

jest.mock('../db/database', () => ({
  dbGetAllProjects: jest.fn().mockReturnValue([]),
  dbInsertProject: jest.fn(),
  dbUpdateProject: jest.fn(),
  dbDeleteProject: jest.fn(),
  dbBatchUpdateProjectOrders: jest.fn(),
}));

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'proj-1',
  name: 'Test Project',
  notes: '',
  dueDate: null,
  color: '#FF0000',
  order: 1,
  createdAt: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetAllProjects as jest.Mock).mockReturnValue([]);
  useProjectStore.setState({ projects: [], initialized: false });
});

// ─── initial state ────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('starts with empty projects array', () => {
    expect(useProjectStore.getState().projects).toEqual([]);
  });

  it('starts uninitialized', () => {
    expect(useProjectStore.getState().initialized).toBe(false);
  });
});

// ─── initialize ──────────────────────────────────────────────────────────────

describe('initialize', () => {
  it('loads projects from the database and marks as initialized', () => {
    const projects = [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })];
    (dbGetAllProjects as jest.Mock).mockReturnValue(projects);
    useProjectStore.getState().initialize();
    expect(useProjectStore.getState().projects).toEqual(projects);
    expect(useProjectStore.getState().initialized).toBe(true);
  });

  it('starts with empty array when db has no projects', () => {
    useProjectStore.getState().initialize();
    expect(useProjectStore.getState().projects).toHaveLength(0);
    expect(useProjectStore.getState().initialized).toBe(true);
  });
});

// ─── addProject ──────────────────────────────────────────────────────────────

describe('addProject', () => {
  it('adds project to state and returns it', () => {
    const draft = { name: 'My Project', notes: 'notes', dueDate: null, color: '#0000FF', order: 0 };
    const project = useProjectStore.getState().addProject(draft);
    expect(project.name).toBe('My Project');
    expect(useProjectStore.getState().projects).toHaveLength(1);
    expect(useProjectStore.getState().projects[0]).toBe(project);
  });

  it('persists to the database', () => {
    useProjectStore.getState().addProject({ name: 'New', notes: '', dueDate: null, color: '#fff', order: 0 });
    expect(dbInsertProject).toHaveBeenCalledTimes(1);
    expect(dbInsertProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'New' }));
  });

  it('assigns a generated id', () => {
    const project = useProjectStore.getState().addProject({ name: 'P', notes: '', dueDate: null, color: '#fff', order: 0 });
    expect(project.id).toBeTruthy();
    expect(typeof project.id).toBe('string');
  });

  it('sets order to 1 when there are no existing projects', () => {
    const project = useProjectStore.getState().addProject({ name: 'P', notes: '', dueDate: null, color: '#fff', order: 0 });
    expect(project.order).toBe(1);
  });

  it('sets order to maxOrder + 1', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', order: 5 })] });
    const project = useProjectStore.getState().addProject({ name: 'P2', notes: '', dueDate: null, color: '#fff', order: 0 });
    expect(project.order).toBe(6);
  });
});

// ─── updateProject ───────────────────────────────────────────────────────────

describe('updateProject', () => {
  it('updates matching project fields in state', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1', name: 'Old Name' })] });
    useProjectStore.getState().updateProject('p1', { name: 'New Name' });
    expect(useProjectStore.getState().projects[0].name).toBe('New Name');
  });

  it('persists updates to the database', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useProjectStore.getState().updateProject('p1', { name: 'Updated' });
    expect(dbUpdateProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', name: 'Updated' }));
  });

  it('does not modify other projects', () => {
    const p1 = makeProject({ id: 'p1', name: 'P1' });
    const p2 = makeProject({ id: 'p2', name: 'P2' });
    useProjectStore.setState({ projects: [p1, p2] });
    useProjectStore.getState().updateProject('p1', { name: 'Updated P1' });
    expect(useProjectStore.getState().projects.find(p => p.id === 'p2')?.name).toBe('P2');
  });
});

// ─── deleteProject ───────────────────────────────────────────────────────────

describe('deleteProject', () => {
  it('removes the project from state', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })] });
    useProjectStore.getState().deleteProject('p1');
    expect(useProjectStore.getState().projects).toHaveLength(1);
    expect(useProjectStore.getState().projects[0].id).toBe('p2');
  });

  it('calls dbDeleteProject with the correct id', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' })] });
    useProjectStore.getState().deleteProject('p1');
    expect(dbDeleteProject).toHaveBeenCalledWith('p1');
  });
});

// ─── reorderProjects ─────────────────────────────────────────────────────────

describe('reorderProjects', () => {
  it('updates order values based on the new id sequence', () => {
    const p1 = makeProject({ id: 'p1', order: 1 });
    const p2 = makeProject({ id: 'p2', order: 2 });
    useProjectStore.setState({ projects: [p1, p2] });

    useProjectStore.getState().reorderProjects(['p2', 'p1']);

    const projects = useProjectStore.getState().projects;
    expect(projects.find(p => p.id === 'p2')?.order).toBe(1);
    expect(projects.find(p => p.id === 'p1')?.order).toBe(2);
  });

  it('persists new sort orders to the database', () => {
    useProjectStore.setState({ projects: [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })] });
    useProjectStore.getState().reorderProjects(['p2', 'p1']);
    expect(dbBatchUpdateProjectOrders).toHaveBeenCalledWith([
      { id: 'p2', order: 1 },
      { id: 'p1', order: 2 },
    ]);
  });
});
