import { useTaskGroupStore } from '../store/useTaskGroupStore';
import {
  dbGetAllTaskGroups,
  dbInsertTaskGroup,
  dbUpdateTaskGroup,
  dbDeleteTaskGroup,
} from '../db/database';
import type { TaskGroup } from '../types';

jest.mock('../db/database', () => ({
  dbGetAllTaskGroups: jest.fn().mockReturnValue([]),
  dbInsertTaskGroup: jest.fn(),
  dbUpdateTaskGroup: jest.fn(),
  dbDeleteTaskGroup: jest.fn(),
}));

const group = (title: string, sortOrder: number, id = `g-${title}`, extra: Partial<TaskGroup> = {}): TaskGroup => ({
  id,
  title,
  notes: '',
  tags: [],
  category: null,
  sortOrder,
  collapsed: true,
  ...extra,
});

const seed = (...groups: TaskGroup[]) => {
  useTaskGroupStore.setState({ groups, initialized: true });
};

beforeEach(() => {
  jest.clearAllMocks();
  useTaskGroupStore.setState({ groups: [], initialized: false });
});

describe('initialize', () => {
  it('loads whatever the db hands back', () => {
    (dbGetAllTaskGroups as jest.Mock).mockReturnValue([group('Kitchen refresh', 1)]);
    useTaskGroupStore.getState().initialize();
    expect(useTaskGroupStore.getState().groups.map(g => g.title)).toEqual(['Kitchen refresh']);
    expect(useTaskGroupStore.getState().initialized).toBe(true);
  });
});

describe('createGroup', () => {
  it('inserts a row and appends it at the top of the sort order', () => {
    seed(group('Home', 3));
    const created = useTaskGroupStore.getState().createGroup('Errands', 'Home');
    expect(dbInsertTaskGroup).toHaveBeenCalledWith(created);
    expect(created.sortOrder).toBe(4);
    expect(created.collapsed).toBe(true);
    expect(useTaskGroupStore.getState().groups.map(g => g.title)).toEqual(['Home', 'Errands']);
  });

  it('starts a fresh sort order at 1 with nothing else on the board', () => {
    const created = useTaskGroupStore.getState().createGroup('Errands', null);
    expect(created.sortOrder).toBe(1);
  });
});

describe('updateGroup', () => {
  it('patches the row and writes it through the db', () => {
    seed(group('Errands', 1));
    useTaskGroupStore.getState().updateGroup('g-Errands', { title: 'Chores' });
    expect(dbUpdateTaskGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 'g-Errands', title: 'Chores' }));
    expect(useTaskGroupStore.getState().groups[0].title).toBe('Chores');
  });

  it('is a no-op on a group that is not there', () => {
    useTaskGroupStore.getState().updateGroup('ghost', { title: 'Chores' });
    expect(dbUpdateTaskGroup).not.toHaveBeenCalled();
  });
});

describe('setGroupCollapsed', () => {
  it('flips the flag and writes it', () => {
    seed(group('Errands', 1, 'g-Errands', { collapsed: false }));
    useTaskGroupStore.getState().setGroupCollapsed('g-Errands', true);
    expect(dbUpdateTaskGroup).toHaveBeenCalledWith(expect.objectContaining({ collapsed: true }));
    expect(useTaskGroupStore.getState().groups[0].collapsed).toBe(true);
  });

  it('skips the write when the value already matches', () => {
    seed(group('Errands', 1, 'g-Errands', { collapsed: true }));
    useTaskGroupStore.getState().setGroupCollapsed('g-Errands', true);
    expect(dbUpdateTaskGroup).not.toHaveBeenCalled();
  });
});

describe('getGroupById', () => {
  it('finds a row by id, and answers null for one that is not there', () => {
    seed(group('Errands', 1));
    expect(useTaskGroupStore.getState().getGroupById('g-Errands')?.title).toBe('Errands');
    expect(useTaskGroupStore.getState().getGroupById('ghost')).toBeNull();
  });
});

describe('removeGroupRow / restoreGroup', () => {
  it('drops the row — the task cascade lives in useTaskStore, not here', () => {
    seed(group('Errands', 1), group('Home', 2));
    useTaskGroupStore.getState().removeGroupRow('g-Errands');
    expect(dbDeleteTaskGroup).toHaveBeenCalledWith('g-Errands');
    expect(useTaskGroupStore.getState().groups.map(g => g.title)).toEqual(['Home']);
  });

  it('restores a snapshot back into the list', () => {
    const errands = group('Errands', 1);
    seed(group('Home', 2));
    useTaskGroupStore.getState().restoreGroup(errands);
    expect(dbInsertTaskGroup).toHaveBeenCalledWith(errands);
    expect(useTaskGroupStore.getState().groups.map(g => g.title)).toEqual(['Home', 'Errands']);
  });
});
