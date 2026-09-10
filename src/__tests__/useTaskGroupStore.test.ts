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
  onToday: false,
  projectId: null,
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

  // A stack is otherwise scoped by its children, so one made anywhere but a
  // project's own screen has no home to record — see TaskGroup.projectId.
  it('leaves projectId null when no project is named', () => {
    expect(useTaskGroupStore.getState().createGroup('Errands', null).projectId).toBeNull();
  });

  it('homes the stack on a project when one is named', () => {
    const created = useTaskGroupStore.getState().createGroup('Quotes', 'Home', 'p-kitchen');
    expect(created.projectId).toBe('p-kitchen');
    expect(dbInsertTaskGroup).toHaveBeenCalledWith(created);
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

describe('syncTodayPresence', () => {
  const sync = (...ids: string[]) => useTaskGroupStore.getState().syncTodayPresence(new Set(ids));

  it('collapses a stack arriving on Today, and records that it is there', () => {
    seed(group('Errands', 1, 'g-Errands', { collapsed: false, onToday: false }));
    sync('g-Errands');
    const [g] = useTaskGroupStore.getState().groups;
    expect(g.collapsed).toBe(true);
    expect(g.onToday).toBe(true);
    expect(dbUpdateTaskGroup).toHaveBeenCalledWith(expect.objectContaining({ collapsed: true, onToday: true }));
  });

  it('leaves a stack that was already there alone, expanded or not', () => {
    seed(group('Errands', 1, 'g-Errands', { collapsed: false, onToday: true }));
    sync('g-Errands');
    expect(useTaskGroupStore.getState().groups[0].collapsed).toBe(false);
    expect(dbUpdateTaskGroup).not.toHaveBeenCalled();
  });

  it('records a stack leaving without touching its collapse state', () => {
    seed(group('Errands', 1, 'g-Errands', { collapsed: false, onToday: true }));
    sync();
    const [g] = useTaskGroupStore.getState().groups;
    expect(g.onToday).toBe(false);
    expect(g.collapsed).toBe(false);
    expect(dbUpdateTaskGroup).toHaveBeenCalledWith(expect.objectContaining({ onToday: false }));
  });

  it('collapses a stack that comes back after leaving', () => {
    seed(group('Errands', 1, 'g-Errands', { collapsed: true, onToday: true }));
    useTaskGroupStore.getState().setGroupCollapsed('g-Errands', false);
    sync();
    sync('g-Errands');
    expect(useTaskGroupStore.getState().groups[0].collapsed).toBe(true);
  });

  it('writes only the rows that changed', () => {
    seed(
      group('Errands', 1, 'g-Errands', { onToday: true }),
      group('Home', 2, 'g-Home', { onToday: false }),
    );
    sync('g-Errands', 'g-Home');
    expect(dbUpdateTaskGroup).toHaveBeenCalledTimes(1);
    expect(dbUpdateTaskGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 'g-Home' }));
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
