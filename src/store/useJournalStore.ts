import { create } from 'zustand';
import type { JournalEntry, JournalKind } from '../types';
import {
  dbGetAllJournalEntries,
  dbInsertJournalEntry,
  dbUpdateJournalEntry,
  dbDeleteJournalEntry,
} from '../db/database';
import { generateId } from '../utils/id';
import { dayKeyOf, getCurrentDayStart, getDayStart } from '../utils/dateUtils';

/**
 * The journal and the dream log — see `docs/arch/journal.md`.
 *
 * One store for both kinds, since they are one shape and the screens split
 * them by `kind`. CRUD and nothing else, the same call `useMoodStore` makes;
 * the reads live in `src/utils/journal.ts`.
 *
 * Loaded wholesale at startup, like the mood log: a few rows a day at most.
 */

interface JournalStore {
  entries: JournalEntry[];
  initialized: boolean;
  initialize: () => void;
  /**
   * Write something down. `at` backdates it (noon of an earlier day, as the
   * mood sheet does); the day key is stamped from it under `dayResetTime`, so
   * a 1am entry with a 02:00 reset files under yesterday. Refuses blank text.
   */
  addEntry: (kind: JournalKind, text: string, at?: Date) => JournalEntry | null;
  /** Change the words. The day is fixed once written, as a mood entry's is. */
  updateEntry: (id: string, text: string) => void;
  removeEntry: (id: string) => void;
}

export const useJournalStore = create<JournalStore>((set, get) => ({
  entries: [],
  initialized: false,

  initialize() {
    set({ entries: dbGetAllJournalEntries(), initialized: true });
  },

  addEntry(kind, text, at) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const when = at ?? new Date();
    const entry: JournalEntry = {
      id: generateId(),
      kind,
      loggedAt: when.toISOString(),
      dayKey: dayKeyOf(at ? getDayStart(when) : getCurrentDayStart()),
      text: trimmed,
    };
    dbInsertJournalEntry(entry);
    // Kept in the order dbGetAllJournalEntries hands back, so nothing reorders
    // on relaunch. A backdated entry sorts into place rather than to the top.
    set({ entries: [entry, ...get().entries].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt)) });
    return entry;
  },

  updateEntry(id, text) {
    const existing = get().entries.find(e => e.id === id);
    const trimmed = text.trim();
    // Clearing the words is a delete, which the sheet offers as its own
    // action; an empty entry would be a day marked written with nothing on it.
    if (!existing || !trimmed || trimmed === existing.text) return;
    const next: JournalEntry = { ...existing, text: trimmed };
    dbUpdateJournalEntry(next);
    set({ entries: get().entries.map(e => (e.id === id ? next : e)) });
  },

  removeEntry(id) {
    dbDeleteJournalEntry(id);
    set({ entries: get().entries.filter(e => e.id !== id) });
  },
}));
