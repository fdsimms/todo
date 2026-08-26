import { usePersonGroupStore } from '../store/usePersonGroupStore';
import { usePersonStore } from '../store/usePersonStore';
import {
  dbInsertPersonGroup,
  dbUpdatePersonGroup,
  dbDeletePersonGroup,
} from '../db/database';

jest.mock('../db/database', () => ({
  dbGetAllPersonGroups: jest.fn().mockReturnValue([]),
  dbInsertPersonGroup: jest.fn(),
  dbUpdatePersonGroup: jest.fn(),
  dbDeletePersonGroup: jest.fn(),
  dbGetAllPeople: jest.fn().mockReturnValue([]),
  dbInsertPerson: jest.fn(),
  dbUpdatePerson: jest.fn(),
  dbDeletePerson: jest.fn(),
  dbBatchUpdatePersonSortOrders: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  usePersonGroupStore.setState({ groups: [], initialized: false });
  usePersonStore.setState({ people: [], initialized: false });
});

describe('a new group', () => {
  it('starts named and hand-ordered, nothing else claimed', () => {
    const group = usePersonGroupStore.getState().createGroup('Household');
    expect(group.name).toBe('Household');
    expect(dbInsertPersonGroup).toHaveBeenCalledWith(expect.objectContaining({ name: 'Household' }));
    expect(usePersonGroupStore.getState().groups).toEqual([group]);
  });

  it('trims the name it was given', () => {
    expect(usePersonGroupStore.getState().createGroup('  Ortegas  ').name).toBe('Ortegas');
  });

  it('lands at the end of the list rather than the top', () => {
    const first = usePersonGroupStore.getState().createGroup('A');
    const second = usePersonGroupStore.getState().createGroup('B');
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder);
  });
});

describe('renaming', () => {
  it('writes the new name through to the database', () => {
    const group = usePersonGroupStore.getState().createGroup('Household');
    usePersonGroupStore.getState().updateGroup(group.id, { name: 'The Ortegas' });
    expect(dbUpdatePersonGroup).toHaveBeenCalledWith(expect.objectContaining({ id: group.id, name: 'The Ortegas' }));
    expect(usePersonGroupStore.getState().getGroupById(group.id)?.name).toBe('The Ortegas');
  });

  it('shrugs at an id that isn\'t there rather than writing a row', () => {
    usePersonGroupStore.getState().updateGroup('nobody', { name: 'X' });
    expect(dbUpdatePersonGroup).not.toHaveBeenCalled();
  });
});

describe('the order', () => {
  it('is whatever the user dragged it to, its own independent space', () => {
    const a = usePersonGroupStore.getState().createGroup('A');
    const b = usePersonGroupStore.getState().createGroup('B');
    usePersonGroupStore.getState().reorderGroups([b.id, a.id]);
    expect(usePersonGroupStore.getState().groups.map(g => g.name)).toEqual(['B', 'A']);
  });
});

describe('deleting a group', () => {
  it('removes the row', () => {
    const group = usePersonGroupStore.getState().createGroup('Household');
    usePersonGroupStore.getState().removeGroupRow(group.id);
    expect(dbDeletePersonGroup).toHaveBeenCalledWith(group.id);
    expect(usePersonGroupStore.getState().groups).toEqual([]);
  });

  // Nobody in it is deleted, only unlinked — the same shrug-not-cascade rule
  // the rest of the people layer applies to a dangling pointer.
  it('frees every member rather than deleting them', () => {
    const group = usePersonGroupStore.getState().createGroup('Household');
    const dustin = usePersonStore.getState().createPerson('Dustin');
    const ansley = usePersonStore.getState().createPerson('Ansley');
    usePersonStore.getState().updatePerson(dustin.id, { groupId: group.id });
    usePersonStore.getState().updatePerson(ansley.id, { groupId: group.id });

    usePersonGroupStore.getState().removeGroupRow(group.id);

    expect(usePersonStore.getState().people).toHaveLength(2);
    expect(usePersonStore.getState().getPersonById(dustin.id)?.groupId).toBeNull();
    expect(usePersonStore.getState().getPersonById(ansley.id)?.groupId).toBeNull();
  });
});
