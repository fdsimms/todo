import { create } from 'zustand';
import type { Person, PersonNote } from '../types';
import {
  dbGetAllPeople,
  dbInsertPerson,
  dbUpdatePerson,
  dbDeletePerson,
  dbBatchUpdatePersonSortOrders,
  dbGetSetting,
  dbSetSetting,
  dbDeleteSetting,
} from '../db/database';
import { generateId } from '../utils/id';
import {
  isReachOutPromptLive,
  parsePendingReachOut,
  serializePendingReachOut,
  type PendingReachOut,
  type ReachOutKind,
} from '../utils/reachOutIntent';
import { registerPersonSource } from '../utils/peopleRegistry';
import { usePersonNoteStore } from './usePersonNoteStore';
import { undoHistoryActions, type UndoHistoryActions, type UndoHistoryState } from '../utils/undoHistory';

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
    birthYear: null,
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
    cadenceSetAt: null,
    reachOutDeclinedAt: null,
    reachOutOfferDeclinedAt: null,
    askAbout: '',
    backfillDismissedFields: [],
    groupId: null,
    location: null,
  };
}

/** What to call somebody: their nickname if they have one, else their name. */
export function displayNameOf(person: Pick<Person, 'name' | 'nickname'>): string {
  return person.nickname.trim() || person.name.trim();
}

/** The fields the editor may write. Deliberately every field except identity and order. */
export type PersonPatch = Partial<Pick<Person,
  | 'name' | 'nickname' | 'notes'
  | 'birthdayMonth' | 'birthdayDay' | 'birthYear' | 'birthdayTaskOptOut' | 'birthdayGiftTaskOptOut'
  | 'phoneNumber' | 'email' | 'linkUrl'
  | 'cadenceDays' | 'nudgeOptIn' | 'cadenceSetAt' | 'reachOutDeclinedAt' | 'reachOutOfferDeclinedAt' | 'askAbout'
  // Written by the Backfill screen rather than by the editor, through the same
  // patch path everything else uses — the project side does the same with
  // `updateProject`, and there is nothing about it worth a setter of its own.
  | 'backfillDismissedFields'
  | 'groupId'
  | 'location'
>>;

interface PersonStore extends UndoHistoryState, UndoHistoryActions {
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
  /** Deletes several people at once, filed as a single undo entry. */
  bulkRemovePeople: (ids: string[]) => void;
  /**
   * Frees every member of a deleted `PersonGroup` — called by
   * `usePersonGroupStore.removeGroupRow` rather than the other way around, so
   * a person store change never has to import the group store back.
   */
  clearGroupMembership: (groupId: string) => void;

  /**
   * Stamps a tap on Call or Text, to be confirmed when the user comes back.
   *
   * See `src/utils/reachOutIntent.ts` for why a tap is the only thing there is
   * to record here, and why it is asked about rather than written down.
   *
   * **The three actions below hold nothing in memory, and that is the design
   * rather than an omission.** Every one of them reads or writes the `settings`
   * table on the spot, so they follow whichever database is live — which is
   * what makes demo mode correct for free. `useSharedLinkStore` and
   * `useStepTimerStore` are the two stores that do keep a cached copy of a
   * settings-backed value, and both had to be given a `reload` that
   * `useDemoStore` calls by hand on the way in *and* the way out, because
   * otherwise the real value stays on screen inside the demo and the demo's
   * writes land on it. A stamp read fresh each time cannot desync from the
   * database it came out of, and it is read at most twice per visit to a
   * person's screen, so there is nothing for a cache to buy.
   */
  notePendingReachOut: (personId: string, kind: ReachOutKind) => void;
  /**
   * The stamp worth asking about right now, or null when there isn't one or it
   * has gone stale. Not scoped to a person: the prompt fires wherever the user
   * is and names whoever the stamp names — see `isReachOutPromptLive`.
   */
  peekPendingReachOut: (now: Date) => PendingReachOut | null;
  /** Drops the stamp, however it got answered. */
  clearPendingReachOut: () => void;
}

/** One row in `settings`, holding at most one un-answered tap. */
const PENDING_REACH_OUT_KEY = 'pendingReachOut';

export const usePersonStore = create<PersonStore>((set, get) => ({
  people: [],
  initialized: false,
  undoStack: [],
  redoStack: [],
  lastAction: null,
  ...undoHistoryActions(set, get),

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
    const person = get().people.find(p => p.id === id);
    // Snapshotted before the delete, so the undo below can put back exactly
    // what was there rather than an empty history for them.
    const notes = usePersonNoteStore.getState().notes.filter(n => n.personId === id);

    // Their notes go with them, and this is the one place the people layer
    // doesn't shrug at a dangling pointer. A note is *about* somebody and has
    // no meaning without them, unlike a task naming them, which is still a
    // thing you did — so leaving the rows would mean keeping a private file on
    // somebody the user asked to be rid of. Done here rather than at the call
    // site so it can't be forgotten by a second one.
    usePersonNoteStore.getState().removeNotesFor(id);
    dbDeletePerson(id);
    set({ people: get().people.filter(p => p.id !== id) });

    if (!person) return;
    get().setLastAction({
      label: `Deleted ${displayNameOf(person)}`,
      destructive: true,
      undo: () => {
        get().restorePerson(person);
        notes.forEach(n => usePersonNoteStore.getState().restoreNote(n));
      },
      redo: () => get().removePersonRow(id),
    });
  },

  // One undo entry for the batch, same shape as bulkDeleteGroups in
  // useTaskStore: without `replacing`, each person's own removePersonRow
  // would leave its own entry underneath, so undoing the batch would strand
  // the rest of it one row at a time.
  bulkRemovePeople(ids) {
    const before = get().undoStack;
    const people = ids.map(id => get().people.find(p => p.id === id)).filter((p): p is Person => p != null);
    const notesByPerson = new Map(people.map(p => [p.id, usePersonNoteStore.getState().notes.filter(n => n.personId === p.id)]));
    ids.forEach(id => get().removePersonRow(id));
    if (people.length === 0) return;
    const label = people.length === 1
      ? `Deleted ${displayNameOf(people[0])}`
      : `Deleted ${people.length} people`;
    get().setLastAction({
      label,
      destructive: true,
      undo: () => {
        people.forEach(p => {
          get().restorePerson(p);
          (notesByPerson.get(p.id) ?? []).forEach(n => usePersonNoteStore.getState().restoreNote(n));
        });
      },
      redo: () => ids.forEach(id => get().removePersonRow(id)),
    }, { replacing: before });
  },

  restorePerson(person) {
    dbInsertPerson(person);
    set({ people: [...get().people, person].sort((a, b) => a.sortOrder - b.sortOrder) });
  },

  clearGroupMembership(groupId) {
    const members = get().people.filter(p => p.groupId === groupId);
    if (members.length === 0) return;
    members.forEach(p => dbUpdatePerson({ ...p, groupId: null }));
    set({
      people: get().people.map(p => (p.groupId === groupId ? { ...p, groupId: null } : p)),
    });
  },

  notePendingReachOut(personId, kind) {
    // `new Date()` deliberately, not a logical-day helper: this is a timestamp
    // of something that just happened, which is the case CLAUDE.md's
    // grace-window rule explicitly sets apart from placing a task on a day.
    const pending: PendingReachOut = { personId, kind, at: new Date().toISOString() };
    try {
      // Replaces any earlier stamp rather than queueing beside it. Two
      // un-answered taps means the first one was already left unconfirmed, and
      // the honest reading of that is "no", not a backlog of questions waiting
      // on the next person's screen.
      dbSetSetting(PENDING_REACH_OUT_KEY, serializePendingReachOut(pending));
    } catch {
      // The tap still opens the dialler; all that is lost is being asked about
      // it afterwards, which is the same outcome as answering "Not now".
    }
  },

  peekPendingReachOut(now) {
    let pending: PendingReachOut | null = null;
    try {
      pending = parsePendingReachOut(dbGetSetting(PENDING_REACH_OUT_KEY));
    } catch {
      return null;
    }
    return isReachOutPromptLive(pending, now) ? pending : null;
  },

  clearPendingReachOut() {
    try {
      // Deletes the row rather than storing a tombstone, the same treatment an
      // emptied registry gets: the settings table stays honest about which
      // features have ever been used.
      dbDeleteSetting(PENDING_REACH_OUT_KEY);
    } catch {
      // Worst case the stamp outlives its window and is dropped unasked by
      // `isReachOutPromptLive` instead.
    }
  },
}));

// Pushed in at module load, the same way useTaskStore hands blockerRegistry its
// getter: the registry is a leaf module importing nothing but types, so the
// row renderers can resolve a person without pulling expo-sqlite into the
// `node` test environment.
registerPersonSource(() => usePersonStore.getState().people);
