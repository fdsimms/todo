import { create } from 'zustand';
import type { MedicationLog } from '../types';
import {
  dbGetAllMedicationLogs,
  dbInsertMedicationLog,
  dbUpdateMedicationLog,
  dbDeleteMedicationLog,
  dbDeleteMedicationLogsForTask,
} from '../db/database';
import { generateId } from '../utils/id';
import { dayKeyOf, getCurrentDayStart, getDayStart } from '../utils/dateUtils';

/**
 * The medication log — see `src/utils/medicationLog.ts` for every rule,
 * including why this exists beside the task-based answer rather than replacing
 * it, and what it deliberately refuses to compute.
 *
 * Its own store rather than a slice of `useTaskStore`, the same call
 * `useMoodStore` makes: rows with their own lifecycle that nothing else points
 * at. CRUD and nothing else — the vocabulary, the day reads and the one
 * frequency comparison live in the pure module, so they can be exercised
 * without standing up SQLite.
 */

/**
 * What a dose is recorded from.
 *
 * An object rather than a positional list because the two ways in disagree
 * about which fields they have: a task completion knows the name, the dose and
 * its own id but never `asNeeded`, and the sheet knows all of them but no task.
 * `useMoodStore.addLog`'s five positional parameters are the version of this
 * that was already at its limit.
 */
export interface DoseInput {
  name: string;
  amount?: number | null;
  unit?: string | null;
  asNeeded?: boolean;
  note?: string | null;
  /**
   * The moment being recorded, defaulting to now. Backdating exists for the
   * same reason it does on a mood entry — remembering at bedtime that you took
   * something at noon — and the demo seed uses it to lay down a history.
   */
  at?: Date;
  /** The task whose completion is recording this. Provenance only. */
  taskId?: string | null;
}

/**
 * What can be edited after the fact.
 *
 * `takenAt`, `dayKey` and `taskId` are deliberately absent. The first two are
 * the `MoodLog` rule — correcting what you said about a moment must not move
 * which day it counts toward, or every window in `medicationLog.ts` is
 * rewritten underneath itself. `taskId` is absent because provenance is a fact
 * about how the row got here, not a property of the dose: re-pointing it would
 * let unticking one task delete another task's dose.
 */
export type MedicationLogPatch =
  Partial<Pick<MedicationLog, 'name' | 'amount' | 'unit' | 'asNeeded' | 'note'>>;

interface MedicationStore {
  logs: MedicationLog[];
  initialized: boolean;
  initialize: () => void;
  addLog: (input: DoseInput) => MedicationLog | null;
  updateLog: (id: string, patch: MedicationLogPatch) => void;
  removeLog: (id: string) => void;
  /**
   * Drop every dose a task's completion recorded — what unticking that task
   * runs. See `Task.medicationName` for why this is not one-shot the way the
   * Apple Health write beside it is.
   */
  removeLogsForTask: (taskId: string) => void;
  /**
   * Drop the most recent dose a task recorded, leaving its earlier ones alone.
   *
   * What undoing one unit of a daily target runs. A task set to three doses a
   * day records one per unit, so taking a unit back may not take the day's
   * other doses with it — which is exactly what `removeLogsForTask` would do.
   */
  removeLatestLogForTask: (taskId: string) => void;
}

export const useMedicationStore = create<MedicationStore>((set, get) => ({
  logs: [],
  initialized: false,

  initialize() {
    set({ logs: dbGetAllMedicationLogs(), initialized: true });
  },

  addLog(input) {
    const name = input.name.trim();
    // A dose of nothing is not a dose. Same refusal `useMoodStore.addLog`
    // makes for an entry recording nothing: the alternative is a row every
    // read then has to tell apart from a real one.
    if (!name) return null;

    const { amount, unit } = cleanDose(input.amount ?? null, input.unit ?? null);
    const when = input.at ?? new Date();
    const log: MedicationLog = {
      id: generateId(),
      name,
      takenAt: when.toISOString(),
      // getCurrentDayStart for the common case, getDayStart for a backdated
      // one — CLAUDE.md's grace-window rule applied to a write, exactly as
      // useMoodStore does it. A dose taken at 1am with a 02:00 reset belongs
      // to the day it was still the end of.
      dayKey: dayKeyOf(input.at ? getDayStart(when) : getCurrentDayStart()),
      amount,
      unit,
      asNeeded: input.asNeeded ?? false,
      taskId: input.taskId ?? null,
      note: input.note?.trim() || null,
    };
    dbInsertMedicationLog(log);
    // Newest first, matching what dbGetAllMedicationLogs hands back on the
    // next launch — a list that reorders itself on relaunch is the usual way
    // one of these drifts.
    set({ logs: [log, ...get().logs] });
    return log;
  },

  updateLog(id, patch) {
    const existing = get().logs.find(l => l.id === id);
    if (!existing) return;
    const next: MedicationLog = { ...existing, ...patch };
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      // An edit may not blank the name, for the reason addLog refuses one:
      // there would be nothing left to say which medicine the row is about.
      if (!name) return;
      next.name = name;
    }
    if (patch.amount !== undefined || patch.unit !== undefined) {
      const { amount, unit } = cleanDose(next.amount, next.unit);
      next.amount = amount;
      next.unit = unit;
    }
    if (patch.note !== undefined) next.note = patch.note?.trim() || null;
    dbUpdateMedicationLog(next);
    set({ logs: get().logs.map(l => (l.id === id ? next : l)) });
  },

  removeLog(id) {
    dbDeleteMedicationLog(id);
    set({ logs: get().logs.filter(l => l.id !== id) });
  },

  removeLogsForTask(taskId) {
    dbDeleteMedicationLogsForTask(taskId);
    set({ logs: get().logs.filter(l => l.taskId !== taskId) });
  },

  removeLatestLogForTask(taskId) {
    // Newest by `takenAt` rather than by list position: the in-memory list is
    // newest-first, but a backdated dose can be inserted at the front of it
    // while belonging to last Tuesday, and the unit being undone is the one
    // just recorded.
    const latest = get().logs
      .filter(l => l.taskId === taskId)
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
    if (!latest) return;
    get().removeLog(latest.id);
  },
}));

/**
 * Keep an amount and its unit together, or drop both.
 *
 * A number with no unit is unreadable and a unit with no number states
 * nothing, so half a dose is recorded as no dose rather than as a figure a
 * reader would have to guess at. A non-finite amount goes the same way: it can
 * only have come from parsing something that wasn't a number.
 */
function cleanDose(
  amount: number | null,
  unit: string | null,
): { amount: number | null; unit: string | null } {
  const trimmedUnit = unit?.trim() || null;
  const usable = amount !== null && Number.isFinite(amount) && !!trimmedUnit;
  return usable ? { amount, unit: trimmedUnit } : { amount: null, unit: null };
}
