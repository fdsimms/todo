import { create } from 'zustand';
import type { Person } from '../types';
import {
  dbGetAllPeople,
  dbInsertPerson,
  dbUpdatePerson,
  dbDeletePerson,
  dbBatchUpdatePersonSortOrders,
} from '../db/database';
import { generateId } from '../utils/id';
import { registerPersonSource } from '../utils/peopleRegistry';
import { usePersonNoteStore } from './usePersonNoteStore';

/**
 * The people you want to keep track of — see `docs/arch/people.md`.
 *
 * Modeled on `useProjectStore`, and deliberately thinner than it. A project
 * store computes progress, decisions and whether something is past its window,
 * because a project is work and those are real questions about it. **Nothing
 * equivalent belongs here.** There is no `personProgress`, no health, no "how
 * are we doing" derivation of any kind, and adding one is the way this feature
 * turns into the thing the arch doc exists to prevent. What a person's history
 * *is* gets derived from tasks at read time (#2045), not stored or scored here.
 *
 * The one derived thing this store does own is the reverse index — which tasks
 * name which person — and even that lives in `peopleRegistry.ts` for the same
 * reason `blockerRegistry.ts` exists: `visibilityUtils` and the row renderers
 * can't import a store that pulls in expo-sqlite.
 */

/** What a fresh person looks like: named, and nothing else claimed about them. */
export function blankPerson(name: string, sortOrder: number): Person {
  return {
    id: generateId(),
    name: name.trim(),
    nickname: '',
    notes: '',
    sortOrder,
    archived: false,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    birthdayMonth: null,
    birthdayDay: null,
    birthdayTaskOptOut: false,
    birthdayGiftTaskOptOut: false,
    phoneNumber: null,
    email: null,
    linkUrl: null,
    // Off, and off is the whole design. Every person starts with no cadence and
    // no nudges, which is what keeps "who am I neglecting" a question the app
    // never asks and never answers. See rule 4 in docs/arch/people.md.
    cadenceDays: 0,
    nudgeOptIn: false,
    reachOutDeclinedAt: null,
    askAbout: '',
  };
}

/** What to call somebody: their nickname if they have one, else their name. */
export function displayNameOf(person: Pick<Person, 'name' | 'nickname'>): string {
  return person.nickname.trim() || person.name.trim();
}

/** The fields the editor may write. Deliberately every field except identity and order. */
export type PersonPatch = Partial<Pick<Person,
  | 'name' | 'nickname' | 'notes'
  | 'birthdayMonth' | 'birthdayDay' | 'birthdayTaskOptOut' | 'birthdayGiftTaskOptOut'
  | 'phoneNumber' | 'email' | 'linkUrl'
  | 'cadenceDays' | 'nudgeOptIn' | 'reachOutDeclinedAt' | 'askAbout'
>>;

interface PersonStore {
  people: Person[];
  initialized: boolean;
  initialize: () => void;
  /** Everyone not filed away, in the user's own order. */
  activePeople: () => Person[];
  getPersonById: (id: string) => Person | null;
  createPerson: (name: string) => Person;
  updatePerson: (id: string, patch: PersonPatch) => void;
  reorderPeople: (orderedIds: string[]) => void;
  applyPersonArchived: (id: string, archived: boolean, archivedAt?: string | null) => void;
  removePersonRow: (id: string) => void;
  restorePerson: (person: Person) => void;
}

export const usePersonStore = create<PersonStore>((set, get) => ({
  people: [],
  initialized: false,

  initialize() {
    set({ people: dbGetAllPeople(), initialized: true });
  },

  activePeople() {
    return get().people.filter(p => !p.archived);
  },

  getPersonById(id) {
    return get().people.find(p => p.id === id) ?? null;
  },

  createPerson(name) {
    const maxOrder = get().people.reduce((m, p) => Math.max(m, p.sortOrder), 0);
    const person = blankPerson(name, maxOrder + 1);
    dbInsertPerson(person);
    set({ people: [...get().people, person] });
    return person;
  },

  updatePerson(id, patch) {
    const person = get().people.find(p => p.id === id);
    if (!person) return;
    const next: Person = { ...person, ...patch };
    dbUpdatePerson(next);
    set({ people: get().people.map(p => (p.id === id ? next : p)) });
  },

  // The order is the user's own and is never re-ranked by recency, by how long
  // it has been, or by anything else the app worked out for itself. This list
  // is the only ranking the feature contains and it is one a person made on
  // purpose — see rule 3 in docs/arch/people.md.
  reorderPeople(orderedIds) {
    const updates = orderedIds.map((id, i) => ({ id, sortOrder: i + 1 }));
    dbBatchUpdatePersonSortOrders(updates);
    const bySort = new Map(updates.map(u => [u.id, u.sortOrder]));
    set({
      people: get().people
        .map(p => (bySort.has(p.id) ? { ...p, sortOrder: bySort.get(p.id)! } : p))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    });
  },

  // `archivedAt` is passed back explicitly when undoing an unarchive, so the
  // person keeps the day they were originally filed away rather than being
  // re-stamped as archived just now. Same shape as applyProjectArchived.
  applyPersonArchived(id, archived, archivedAt) {
    const person = get().people.find(p => p.id === id);
    if (!person) return;
    const next: Person = {
      ...person,
      archived,
      archivedAt: archived ? (archivedAt ?? new Date().toISOString()) : null,
    };
    dbUpdatePerson(next);
    set({ people: get().people.map(p => (p.id === id ? next : p)) });
  },

  removePersonRow(id) {
    // Their notes go with them, and this is the one place the people layer
    // doesn't shrug at a dangling pointer. A note is *about* somebody and has
    // no meaning without them, unlike a task naming them, which is still a
    // thing you did — so leaving the rows would mean keeping a private file on
    // somebody the user asked to be rid of. Done here rather than at the call
    // site so it can't be forgotten by a second one.
    usePersonNoteStore.getState().removeNotesFor(id);
    dbDeletePerson(id);
    set({ people: get().people.filter(p => p.id !== id) });
  },

  restorePerson(person) {
    dbInsertPerson(person);
    set({ people: [...get().people, person].sort((a, b) => a.sortOrder - b.sortOrder) });
  },
}));

// Pushed in at module load, the same way useTaskStore hands blockerRegistry its
// getter: the registry is a leaf module importing nothing but types, so the
// row renderers can resolve a person without pulling expo-sqlite into the
// `node` test environment.
registerPersonSource(() => usePersonStore.getState().people);
