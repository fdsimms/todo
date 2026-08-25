import { create } from 'zustand';
import type { PersonNote, PersonNoteKind } from '../types';
import {
  dbGetAllPersonNotes,
  dbInsertPersonNote,
  dbUpdatePersonNote,
  dbDeletePersonNote,
} from '../db/database';
import { generateId } from '../utils/id';

/**
 * The things you have written down about the people you keep track of — see
 * `docs/arch/people.md` and `utils/personNotes.ts`, which holds every rule.
 *
 * Its own store rather than a slice of `usePersonStore` for the reason
 * `useProjectStore` is separate from tasks: these are rows with their own
 * lifecycle, and the person store's whole discipline is that it derives nothing
 * about anybody. This one derives nothing either — it is CRUD, and the sorting,
 * staleness and per-kind reads all live in the pure module so they can be
 * exercised without standing up SQLite.
 *
 * Loaded wholesale at startup. These are short strings and there are as many of
 * them as somebody has bothered to write, which is a different order of
 * magnitude from tasks or grocery rows.
 */

export type PersonNotePatch = Partial<Pick<PersonNote,
  'kind' | 'text' | 'relevantOn' | 'archivedAt'
>>;

interface PersonNoteStore {
  notes: PersonNote[];
  initialized: boolean;
  initialize: () => void;
  addNote: (personId: string, kind: PersonNoteKind, text: string, relevantOn?: string | null) => PersonNote | null;
  updateNote: (id: string, patch: PersonNotePatch) => void;
  removeNote: (id: string) => void;
  /** Drops every note about somebody, for the delete that follows theirs. */
  removeNotesFor: (personId: string) => void;
}

export const usePersonNoteStore = create<PersonNoteStore>((set, get) => ({
  notes: [],
  initialized: false,

  initialize() {
    set({ notes: dbGetAllPersonNotes(), initialized: true });
  },

  // Refuses a blank, the same rule planMeal and renameEntry follow: an empty
  // note is a row with nothing in it, and the sheet's Save is the only way in.
  addNote(personId, kind, text, relevantOn = null) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const maxOrder = get().notes
      .filter(n => n.personId === personId && n.kind === kind)
      .reduce((m, n) => Math.max(m, n.sortOrder), 0);
    const note: PersonNote = {
      id: generateId(),
      personId,
      kind,
      text: trimmed,
      createdAt: new Date().toISOString(),
      relevantOn,
      archivedAt: null,
      sortOrder: maxOrder + 1,
    };
    dbInsertPersonNote(note);
    set({ notes: [...get().notes, note] });
    return note;
  },

  updateNote(id, patch) {
    const note = get().notes.find(n => n.id === id);
    if (!note) return;
    const next: PersonNote = { ...note, ...patch };
    if (patch.text !== undefined) next.text = patch.text.trim();
    dbUpdatePersonNote(next);
    set({ notes: get().notes.map(n => (n.id === id ? next : n)) });
  },

  removeNote(id) {
    dbDeletePersonNote(id);
    set({ notes: get().notes.filter(n => n.id !== id) });
  },

  // The one place the people layer doesn't shrug at a dangling pointer: a note
  // is *about* somebody and has no meaning without them, unlike a task naming
  // them, which is still a thing you did. Leaving these would mean keeping a
  // private file on somebody the user asked to be rid of.
  removeNotesFor(personId) {
    if (!get().notes.some(n => n.personId === personId)) return;
    for (const note of get().notes.filter(n => n.personId === personId)) {
      dbDeletePersonNote(note.id);
    }
    set({ notes: get().notes.filter(n => n.personId !== personId) });
  },
}));
