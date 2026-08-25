import { usePersonNoteStore } from '../store/usePersonNoteStore';
import {
  dbGetAllPersonNotes,
  dbInsertPersonNote,
  dbUpdatePersonNote,
  dbDeletePersonNote,
} from '../db/database';

jest.mock('../db/database', () => ({
  dbGetAllPersonNotes: jest.fn(() => []),
  dbInsertPersonNote: jest.fn(),
  dbUpdatePersonNote: jest.fn(),
  dbDeletePersonNote: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  usePersonNoteStore.setState({ notes: [], initialized: false });
});

const state = () => usePersonNoteStore.getState();

describe('addNote', () => {
  it('writes the note and holds it', () => {
    const note = state().addNote('p1', 'gift', 'The pottery class');
    expect(note).not.toBeNull();
    expect(state().notes).toHaveLength(1);
    expect(dbInsertPersonNote).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 'p1', kind: 'gift', text: 'The pottery class' })
    );
  });

  it('trims, and refuses a blank rather than writing an empty row', () => {
    expect(state().addNote('p1', 'note', '  padded  ')!.text).toBe('padded');
    expect(state().addNote('p1', 'note', '   ')).toBeNull();
    expect(state().notes).toHaveLength(1);
  });

  it('appends within its own kind, so ordering one does not renumber another', () => {
    state().addNote('p1', 'note', 'first');
    state().addNote('p1', 'gift', 'a gift');
    const second = state().addNote('p1', 'note', 'second')!;
    const gift = state().notes.find(n => n.kind === 'gift')!;
    expect(second.sortOrder).toBe(2);
    expect(gift.sortOrder).toBe(1);
  });

  it('starts with no day, which is the common case rather than a skipped step', () => {
    expect(state().addNote('p1', 'food', 'No shellfish')!.relevantOn).toBeNull();
  });
});

describe('updateNote', () => {
  it('patches and writes back', () => {
    const note = state().addNote('p1', 'note', 'before')!;
    state().updateNote(note.id, { text: 'after', kind: 'gift' });
    expect(state().notes[0].text).toBe('after');
    expect(state().notes[0].kind).toBe('gift');
    expect(dbUpdatePersonNote).toHaveBeenCalled();
  });

  it('trims a patched text too', () => {
    const note = state().addNote('p1', 'note', 'before')!;
    state().updateNote(note.id, { text: '  after  ' });
    expect(state().notes[0].text).toBe('after');
  });

  it('is a no-op for a note that is not there', () => {
    state().updateNote('missing', { text: 'x' });
    expect(dbUpdatePersonNote).not.toHaveBeenCalled();
  });
});

describe('removeNotesFor', () => {
  // A note is *about* somebody and has no meaning without them, unlike a task
  // naming them, which is still a thing you did.
  it('drops every note about one person and leaves the rest', () => {
    state().addNote('p1', 'note', 'theirs');
    state().addNote('p1', 'food', 'no shellfish');
    state().addNote('p2', 'note', 'somebody else');

    state().removeNotesFor('p1');

    expect(state().notes.map(n => n.personId)).toEqual(['p2']);
    expect(dbDeletePersonNote).toHaveBeenCalledTimes(2);
  });

  it('writes nothing when there is nothing to drop', () => {
    state().removeNotesFor('nobody');
    expect(dbDeletePersonNote).not.toHaveBeenCalled();
  });
});

describe('initialize', () => {
  it('loads what the table holds', () => {
    (dbGetAllPersonNotes as jest.Mock).mockReturnValueOnce([
      { id: 'a', personId: 'p1', kind: 'note', text: 'hi', createdAt: 'x', relevantOn: null, archivedAt: null, sortOrder: 1 },
    ]);
    state().initialize();
    expect(state().notes).toHaveLength(1);
    expect(state().initialized).toBe(true);
  });
});
