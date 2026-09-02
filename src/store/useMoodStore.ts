import { create } from 'zustand';
import type { LoggedSymptom, MoodLevel, MoodLog } from '../types';
import {
  dbGetAllMoodLogs,
  dbInsertMoodLog,
  dbUpdateMoodLog,
  dbDeleteMoodLog,
} from '../db/database';
import { generateId } from '../utils/id';
import { dayKeyOf, getCurrentDayStart, getDayStart } from '../utils/dateUtils';
import { renameSymptomInLogs, symptomKey } from '../utils/moodLog';

/**
 * The mood/symptom log — see `src/utils/moodLog.ts` for every rule and
 * `src/utils/moodInsights.ts` for what a pile of these is read to mean.
 *
 * Its own store rather than a slice of `useTaskStore`, for the reason
 * `usePersonNoteStore` is its own: these are rows with their own lifecycle that
 * nothing else points at. It is CRUD and nothing else — the vocabulary, the day
 * collapses and every correlation live in the two pure modules, so they can be
 * exercised without standing up SQLite.
 *
 * Loaded wholesale at startup, the same call `usePersonNoteStore` and the focus
 * log make: a handful of small rows a day at the very most, and the Mood screen
 * wants several cuts of the whole history at once.
 */

export type MoodLogPatch = Partial<Pick<MoodLog, 'mood' | 'symptoms' | 'note'>>;

interface MoodStore {
  logs: MoodLog[];
  initialized: boolean;
  initialize: () => void;
  /**
   * Record how you are doing, right now.
   *
   * The day key is stamped here, from `dayResetTime`, rather than derived from
   * `loggedAt` on read — see `MoodLog.dayKey`. This is the grace-window rule
   * from CLAUDE.md applied to a write: an entry made at 1am with a 02:00 reset
   * belongs to yesterday, the day whose list it was still working through.
   */
  addLog: (
    mood: MoodLevel | null,
    symptoms: LoggedSymptom[],
    note?: string | null,
    /**
     * The moment being recorded, defaulting to now.
     *
     * An entry is a record of a moment, and the moment is not always the one
     * you are typing in: logging this morning's headache at bedtime is an
     * ordinary thing to want. The day key is derived from whatever instant
     * lands here, under the same `dayResetTime` rule, so a backdated entry
     * counts toward the day it happened on rather than the day it was typed.
     *
     * No UI passes it yet — the sheet always records now. `demoSeed` uses it
     * to lay down a fortnight of history, which is what the insights on the
     * Mood screen need before they will say anything at all.
     */
    at?: Date,
  ) => MoodLog | null;
  updateLog: (id: string, patch: MoodLogPatch) => void;
  removeLog: (id: string) => void;
  /**
   * Rename a symptom everywhere it appears, merging into an existing name if
   * one already matches. Returns how many entries it rewrote.
   *
   * The only action here that touches more than one row, and the only one that
   * edits what a past entry *says*. That is allowed where moving `dayKey` or
   * `loggedAt` is not, and the line between them is worth stating: a rename
   * changes what you called something, not which day it happened on, so every
   * correlation on the Mood screen re-reads the same days afterwards. The
   * caller still confirms first, with a count — see `renameSymptomInLogs`,
   * which decides the whole rewrite before any of it is written.
   */
  renameSymptom: (fromKey: string, toName: string) => number;
}

export const useMoodStore = create<MoodStore>((set, get) => ({
  logs: [],
  initialized: false,

  initialize() {
    set({ logs: dbGetAllMoodLogs(), initialized: true });
  },

  addLog(mood, symptoms, note = null, at) {
    const cleaned = cleanSymptoms(symptoms);
    const trimmedNote = note?.trim() || null;
    // Refuses an entry that records nothing, the same rule `addNote` follows:
    // the sheet's Save is the only way in, and an empty row would be a day
    // marked as logged with nothing on it — which every read here would then
    // have to distinguish from a real one.
    if (mood === null && cleaned.length === 0 && !trimmedNote) return null;

    const when = at ?? new Date();
    const log: MoodLog = {
      id: generateId(),
      loggedAt: when.toISOString(),
      // getCurrentDayStart for the common case, so the default path is the one
      // CLAUDE.md's grace-window rule names; getDayStart for a backdated
      // entry, which is the same rule applied to an instant that isn't now.
      dayKey: dayKeyOf(at ? getDayStart(when) : getCurrentDayStart()),
      mood,
      symptoms: cleaned,
      note: trimmedNote,
    };
    dbInsertMoodLog(log);
    // Newest first, matching what dbGetAllMoodLogs hands back on the next
    // launch: a list that reorders itself when you relaunch the app is the
    // usual way one of these drifts.
    set({ logs: [log, ...get().logs] });
    return log;
  },

  updateLog(id, patch) {
    const existing = get().logs.find(l => l.id === id);
    if (!existing) return;
    const next: MoodLog = { ...existing, ...patch };
    if (patch.symptoms !== undefined) next.symptoms = cleanSymptoms(patch.symptoms);
    if (patch.note !== undefined) next.note = patch.note?.trim() || null;
    // `loggedAt` and `dayKey` are deliberately not patchable. An entry records a
    // moment, and editing what you said about that moment must not move which
    // day it counts toward — that would rewrite history under every correlation
    // on the Mood screen, silently.
    dbUpdateMoodLog(next);
    set({ logs: get().logs.map(l => (l.id === id ? next : l)) });
  },

  removeLog(id) {
    dbDeleteMoodLog(id);
    set({ logs: get().logs.filter(l => l.id !== id) });
  },

  renameSymptom(fromKey, toName) {
    // Recomputed here rather than taken from the caller, so the rows written
    // are the ones the store holds now — the confirmation the user answered
    // was built off a snapshot, and an entry could have landed since.
    const { changes } = renameSymptomInLogs(get().logs, fromKey, toName);
    if (changes.length === 0) return 0;

    const bySymptoms = new Map(changes.map(c => [c.id, c.symptoms]));
    const next = get().logs.map(log => {
      const symptoms = bySymptoms.get(log.id);
      // cleanSymptoms is a no-op on what renameSymptomInLogs produces — it
      // collapses the same pair by the same rule — and runs anyway so this
      // path can't be the one that puts an unclean list in the database.
      return symptoms ? { ...log, symptoms: cleanSymptoms(symptoms) } : log;
    });
    // One row at a time, like renameAisle: there is no bulk mood write, and a
    // rename touches a handful of entries rather than a table.
    for (const log of next) {
      if (bySymptoms.has(log.id)) dbUpdateMoodLog(log);
    }
    set({ logs: next });
    return changes.length;
  },
}));

/**
 * Drop blanks and collapse two spellings of one symptom, keeping the worst.
 *
 * Belt and braces over `withSymptom`, which already refuses a duplicate as the
 * sheet builds the list — this is the store's own guard for anything reaching
 * it another way (a restored backup, a demo seed, a future importer).
 */
function cleanSymptoms(symptoms: readonly LoggedSymptom[]): LoggedSymptom[] {
  const byKey = new Map<string, LoggedSymptom>();
  for (const symptom of symptoms) {
    const name = symptom.name.trim();
    if (!name) continue;
    const key = symptomKey(name);
    const seen = byKey.get(key);
    if (!seen || symptom.severity > seen.severity) {
      byKey.set(key, { name, severity: symptom.severity });
    }
  }
  return [...byKey.values()];
}
