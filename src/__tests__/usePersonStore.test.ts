import { usePersonStore, blankPerson, displayNameOf } from '../store/usePersonStore';
import { usePersonNoteStore } from '../store/usePersonNoteStore';
import { dbInsertPerson, dbUpdatePerson, dbDeletePerson, dbBatchUpdatePersonSortOrders } from '../db/database';
import { resetReplayForTests } from '../utils/undoHistory';
import type { Person } from '../types';

jest.mock('../db/database', () => ({
  dbGetAllPeople: jest.fn().mockReturnValue([]),
  dbInsertPerson: jest.fn(),
  dbUpdatePerson: jest.fn(),
  dbDeletePerson: jest.fn(),
  dbBatchUpdatePersonSortOrders: jest.fn(),
  dbGetAllPersonNotes: jest.fn().mockReturnValue([]),
  dbInsertPersonNote: jest.fn(),
  dbUpdatePersonNote: jest.fn(),
  dbDeletePersonNote: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetReplayForTests();
  usePersonStore.setState({ people: [], initialized: false, undoStack: [], redoStack: [], lastAction: null });
  usePersonNoteStore.setState({ notes: [], initialized: false });
});

describe('a new person', () => {
  it('starts with nothing claimed about them but a name', () => {
    const person = blankPerson('Dustin', 1);
    expect(person.name).toBe('Dustin');
    expect(person.nickname).toBe('');
    expect(person.notes).toBe('');
    expect(person.birthdayMonth).toBeNull();
    expect(person.birthdayDay).toBeNull();
    expect(person.birthYear).toBeNull();
    expect(person.archived).toBe(false);
  });

  // Rule 4 in docs/arch/people.md, and the thing that keeps "who am I
  // neglecting" a question the app never asks: with no cadence on anybody,
  // there is nothing to compare people against.
  it('is opted out of every nudge surface, which is the whole design', () => {
    const person = blankPerson('Dustin', 1);
    expect(person.nudgeOptIn).toBe(false);
    expect(person.cadenceDays).toBe(0);
    expect(person.reachOutDeclinedAt).toBeNull();
    expect(person.birthdayTaskOptOut).toBe(false);
    expect(person.birthdayGiftTaskOptOut).toBe(false);
  });

  it('trims the name it was given', () => {
    expect(blankPerson('  Ansley  ', 1).name).toBe('Ansley');
  });

  it('belongs to no group', () => {
    expect(blankPerson('Dustin', 1).groupId).toBeNull();
  });

  it('is written to the database and put in the store', () => {
    const person = usePersonStore.getState().createPerson('Dustin');
    expect(dbInsertPerson).toHaveBeenCalledWith(expect.objectContaining({ name: 'Dustin' }));
    expect(usePersonStore.getState().people).toEqual([person]);
  });

  it('lands at the end of the list rather than the top', () => {
    const first = usePersonStore.getState().createPerson('A');
    const second = usePersonStore.getState().createPerson('B');
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder);
  });
});

describe('what to call somebody', () => {
  it('is their name', () => {
    expect(displayNameOf({ name: 'Ansley', nickname: '' })).toBe('Ansley');
  });

  it('is their nickname when they have one', () => {
    expect(displayNameOf({ name: 'Ansley Brown', nickname: 'Ans' })).toBe('Ans');
  });

  it('ignores a nickname that is only whitespace', () => {
    expect(displayNameOf({ name: 'Ansley', nickname: '   ' })).toBe('Ansley');
  });
});

describe('editing', () => {
  it('writes the patch through to the database', () => {
    const person = usePersonStore.getState().createPerson('Dustin');
    usePersonStore.getState().updatePerson(person.id, { birthdayMonth: 3, birthdayDay: 14 });
    expect(dbUpdatePerson).toHaveBeenCalledWith(
      expect.objectContaining({ id: person.id, birthdayMonth: 3, birthdayDay: 14 })
    );
    expect(usePersonStore.getState().getPersonById(person.id)?.birthdayDay).toBe(14);
  });

  it('shrugs at an id that isn\'t there rather than writing a row', () => {
    usePersonStore.getState().updatePerson('nobody', { name: 'X' });
    expect(dbUpdatePerson).not.toHaveBeenCalled();
  });
});

describe('the order', () => {
  // The list is the only ranking the feature contains and it is one the user
  // made on purpose — see rule 3 in docs/arch/people.md. Nothing re-ranks it.
  it('is whatever the user dragged it to', () => {
    const a = usePersonStore.getState().createPerson('A');
    const b = usePersonStore.getState().createPerson('B');
    const c = usePersonStore.getState().createPerson('C');

    usePersonStore.getState().reorderPeople([c.id, a.id, b.id]);

    expect(usePersonStore.getState().people.map(p => p.name)).toEqual(['C', 'A', 'B']);
    expect(dbBatchUpdatePersonSortOrders).toHaveBeenCalledWith([
      { id: c.id, sortOrder: 1 },
      { id: a.id, sortOrder: 2 },
      { id: b.id, sortOrder: 3 },
    ]);
  });
});

describe('archiving', () => {
  it('stamps the day it happened', () => {
    const person = usePersonStore.getState().createPerson('Dustin');
    usePersonStore.getState().applyPersonArchived(person.id, true);
    const stored = usePersonStore.getState().getPersonById(person.id)!;
    expect(stored.archived).toBe(true);
    expect(stored.archivedAt).not.toBeNull();
  });

  it('keeps the original day when an unarchive is undone', () => {
    const person = usePersonStore.getState().createPerson('Dustin');
    usePersonStore.getState().applyPersonArchived(person.id, true, '2026-01-01T00:00:00.000Z');
    expect(usePersonStore.getState().getPersonById(person.id)?.archivedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('clears the stamp on the way back out', () => {
    const person = usePersonStore.getState().createPerson('Dustin');
    usePersonStore.getState().applyPersonArchived(person.id, true);
    usePersonStore.getState().applyPersonArchived(person.id, false);
    expect(usePersonStore.getState().getPersonById(person.id)?.archivedAt).toBeNull();
  });

  it('takes them out of the active list without deleting anything', () => {
    const person = usePersonStore.getState().createPerson('Dustin');
    usePersonStore.getState().applyPersonArchived(person.id, true);
    expect(usePersonStore.getState().activePeople()).toEqual([]);
    expect(usePersonStore.getState().people).toHaveLength(1);
  });
});

describe('deleting', () => {
  it('removes the row', () => {
    const person = usePersonStore.getState().createPerson('Dustin');
    usePersonStore.getState().removePersonRow(person.id);
    expect(dbDeletePerson).toHaveBeenCalledWith(person.id);
    expect(usePersonStore.getState().people).toEqual([]);
  });

  it('puts a restored person back in their own place in the order', () => {
    const a = usePersonStore.getState().createPerson('A');
    const b = usePersonStore.getState().createPerson('B');
    usePersonStore.getState().removePersonRow(a.id);
    usePersonStore.getState().restorePerson(a as Person);
    expect(usePersonStore.getState().people.map(p => p.id)).toEqual([a.id, b.id]);
  });

  it('can be undone, notes and all', () => {
    const person = usePersonStore.getState().createPerson('Dustin');
    usePersonNoteStore.getState().addNote(person.id, 'note', 'Loves margaritas');

    usePersonStore.getState().removePersonRow(person.id);
    expect(usePersonStore.getState().people).toEqual([]);
    expect(usePersonNoteStore.getState().notes).toEqual([]);

    usePersonStore.getState().undoLastAction();

    expect(usePersonStore.getState().people.map(p => p.id)).toEqual([person.id]);
    expect(usePersonNoteStore.getState().notes.map(n => n.text)).toEqual(['Loves margaritas']);
  });

  it('can be redone after an undo', () => {
    const person = usePersonStore.getState().createPerson('Dustin');
    usePersonStore.getState().removePersonRow(person.id);
    usePersonStore.getState().undoLastAction();
    usePersonStore.getState().redoLastUndone();
    expect(usePersonStore.getState().people).toEqual([]);
  });
});

describe('deleting several at once', () => {
  it('removes every row named', () => {
    const a = usePersonStore.getState().createPerson('A');
    const b = usePersonStore.getState().createPerson('B');
    const c = usePersonStore.getState().createPerson('C');
    usePersonStore.getState().bulkRemovePeople([a.id, b.id]);
    expect(usePersonStore.getState().people.map(p => p.id)).toEqual([c.id]);
  });

  // One entry for the whole batch, same shape as bulkDeleteGroups in
  // useTaskStore — otherwise each person's own delete would leave its own
  // entry underneath and one undo would only bring back the last of them.
  it('undoes the whole batch in a single step', () => {
    const a = usePersonStore.getState().createPerson('A');
    const b = usePersonStore.getState().createPerson('B');
    const c = usePersonStore.getState().createPerson('C');
    usePersonStore.getState().bulkRemovePeople([a.id, b.id]);

    expect(usePersonStore.getState().undoStack).toHaveLength(1);
    usePersonStore.getState().undoLastAction();

    expect(usePersonStore.getState().people.map(p => p.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(usePersonStore.getState().undoStack).toEqual([]);
  });
});

describe('freeing a deleted group\'s members', () => {
  it('clears groupId on everybody who was in it', () => {
    const a = usePersonStore.getState().createPerson('A');
    const b = usePersonStore.getState().createPerson('B');
    const c = usePersonStore.getState().createPerson('C');
    usePersonStore.getState().updatePerson(a.id, { groupId: 'g1' });
    usePersonStore.getState().updatePerson(b.id, { groupId: 'g1' });

    usePersonStore.getState().clearGroupMembership('g1');

    expect(usePersonStore.getState().getPersonById(a.id)?.groupId).toBeNull();
    expect(usePersonStore.getState().getPersonById(b.id)?.groupId).toBeNull();
    expect(usePersonStore.getState().getPersonById(c.id)?.groupId).toBeNull();
  });

  it('does nothing when nobody was in that group', () => {
    usePersonStore.getState().createPerson('A');
    jest.clearAllMocks();
    usePersonStore.getState().clearGroupMembership('nonexistent');
    expect(dbUpdatePerson).not.toHaveBeenCalled();
  });
});
