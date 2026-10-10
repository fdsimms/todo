import { create } from 'zustand';
import type { MedicationLog } from '../types';
import {
  dbGetAllMedicationLogs,
  dbInsertMedicationLog,
  dbUpdateMedicationLog,
  dbDeleteMedicationLog,
  dbDeleteMedicationLogsForTask,
  dbGetSetting,
  dbSetSetting,
} from '../db/database';
import { generateId } from '../utils/id';
import { dayKeyOf, getCurrentDayStart, getDayStart } from '../utils/dateUtils';
import {
  ARCHIVED_MEDICATIONS_SETTING_KEY,
  medicationKey,
  parseArchivedMedications,
} from '../utils/medicationLog';
import {
  renamedKeys,
  renamedLogs,
  renamedSettings,
  type DoseFill,
} from '../utils/medicationRename';
import {
  MEDICATION_SETTINGS_KEY,
  parseMedicationSettings,
  prefsFor,
  refilledSupply,
  supplyRemaining,
  withPrefs,
  type MedicationLimit,
  type MedicationSettingsMap,
  type MedicationSupply,
} from '../utils/medicationSettings';

/** When a summary for a visit was last shared (synced, health-scoped). */
export const SUMMARY_LAST_SETTING_KEY = 'medication_summary_last';

/** Medication keys whose "mark the day you started" offer was turned down. */
export const MILESTONE_DISMISSED_SETTING_KEY = 'medication_milestone_dismissed';

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
  /** `medicationKey`s you have archived. A set of names, not a flag on a dose. */
  archived: string[];
  /**
   * The limit and supply you set per medication, keyed by `medicationKey`.
   * See `src/utils/medicationSettings.ts`.
   */
  settings: MedicationSettingsMap;
  /** When a summary for a visit was last shared, as an ISO instant. */
  lastSummaryAt: string | null;
  /** `medicationKey`s whose milestone offer was turned down (`milestoneOffers`). */
  milestoneDismissed: string[];
  initialized: boolean;
  initialize: () => void;
  /**
   * Set or clear a medication's limit. `since` is restamped whenever either
   * cap changes, so a tightened limit never judges doses taken under the old
   * one; toggling only the notification keeps it.
   */
  setLimit: (name: string, limit: Omit<MedicationLimit, 'since'> | null) => void;
  /** Set or clear a medication's supply, counted from now. */
  setSupply: (name: string, supply: Omit<MedicationSupply, 'since' | 'declinedAt'> | null) => void;
  /** Add a refill to what's left. */
  refillSupply: (name: string, added: number) => void;
  /** Turn down the refill offer at the current count. */
  declineRefill: (name: string) => void;
  /** Stop offering to mark the day this medication was started. */
  dismissMilestoneOffer: (name: string) => void;
  /** Record that a summary was just shared. */
  markSummaryShared: (at: Date) => void;
  /** Move a medication out of "what you take". Deletes no doses. */
  archiveMedication: (name: string) => void;
  /** Put an archived medication back. */
  unarchiveMedication: (name: string) => void;
  /**
   * Rename every dose of a medication, moving its limit, supply, archived and
   * milestone state with it. A `to` that is already another medication folds
   * the two together and keeps the target's own limit and supply. `fill`
   * stamps a strength onto doses that recorded none. Returns the number of
   * doses rewritten, or null when `to` is blank or `from` has no doses.
   */
  renameMedication: (from: string, to: string, fill?: DoseFill | null) => number | null;
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
  archived: [],
  settings: {},
  lastSummaryAt: null,
  milestoneDismissed: [],
  initialized: false,

  initialize() {
    const logs = dbGetAllMedicationLogs();
    const archived = parseArchivedMedications(dbGetSetting(ARCHIVED_MEDICATIONS_SETTING_KEY));
    const settings = parseMedicationSettings(dbGetSetting(MEDICATION_SETTINGS_KEY));
    const lastSummary = dbGetSetting(SUMMARY_LAST_SETTING_KEY);
    const milestoneDismissed = parseArchivedMedications(dbGetSetting(MILESTONE_DISMISSED_SETTING_KEY));
    set({
      milestoneDismissed,
      logs,
      archived,
      settings,
      lastSummaryAt: lastSummary && !Number.isNaN(Date.parse(lastSummary)) ? lastSummary : null,
      initialized: true,
    });
  },

  setLimit(name, limit) {
    if (!medicationKey(name)) return;
    const current = prefsFor(get().settings, name);
    let next: MedicationLimit | null = null;
    if (limit && (limit.minHours !== null || limit.maxPer24h !== null)) {
      const capsUnchanged = current.limit
        && current.limit.minHours === limit.minHours
        && current.limit.maxPer24h === limit.maxPer24h;
      next = {
        ...limit,
        since: capsUnchanged && current.limit ? current.limit.since : new Date().toISOString(),
      };
    }
    writeSettings(set, withPrefs(get().settings, name, { ...current, limit: next }));
  },

  setSupply(name, supply) {
    if (!medicationKey(name)) return;
    const current = prefsFor(get().settings, name);
    const next: MedicationSupply | null = supply
      ? { ...supply, since: new Date().toISOString(), declinedAt: null }
      : null;
    writeSettings(set, withPrefs(get().settings, name, { ...current, supply: next }));
  },

  refillSupply(name, added) {
    const current = prefsFor(get().settings, name);
    if (!current.supply) return;
    const remaining = supplyRemaining(get().logs, name, current.supply) ?? 0;
    const supply = refilledSupply(current.supply, remaining, added, new Date());
    writeSettings(set, withPrefs(get().settings, name, { ...current, supply }));
  },

  declineRefill(name) {
    const current = prefsFor(get().settings, name);
    if (!current.supply) return;
    const remaining = supplyRemaining(get().logs, name, current.supply) ?? 0;
    const supply = { ...current.supply, declinedAt: remaining };
    writeSettings(set, withPrefs(get().settings, name, { ...current, supply }));
  },

  dismissMilestoneOffer(name) {
    const key = medicationKey(name);
    if (!key || get().milestoneDismissed.includes(key)) return;
    const milestoneDismissed = [...get().milestoneDismissed, key];
    dbSetSetting(MILESTONE_DISMISSED_SETTING_KEY, JSON.stringify(milestoneDismissed));
    set({ milestoneDismissed });
  },

  markSummaryShared(at) {
    const iso = at.toISOString();
    dbSetSetting(SUMMARY_LAST_SETTING_KEY, iso);
    set({ lastSummaryAt: iso });
  },

  archiveMedication(name) {
    const key = medicationKey(name);
    if (!key || get().archived.includes(key)) return;
    writeArchived(set, [...get().archived, key]);
  },

  unarchiveMedication(name) {
    const key = medicationKey(name);
    if (!get().archived.includes(key)) return;
    writeArchived(set, get().archived.filter(k => k !== key));
  },

  renameMedication(from, to, fill = null) {
    const fromKey = medicationKey(from);
    const name = to.trim();
    const toKey = medicationKey(name);
    if (!fromKey || !toKey) return null;
    const { logs } = get();
    if (!logs.some(l => medicationKey(l.name) === fromKey)) return null;
    const cleanFill = fill && Number.isFinite(fill.amount) && fill.amount > 0 && fill.unit.trim()
      ? { amount: fill.amount, unit: fill.unit.trim() }
      : null;

    const changed = renamedLogs(logs, fromKey, name, cleanFill);
    const byId = new Map(changed.map(l => [l.id, l]));
    changed.forEach(dbUpdateMedicationLog);
    set({ logs: logs.map(l => byId.get(l.id) ?? l) });

    if (fromKey === toKey) return changed.length;

    const { settings, archived, milestoneDismissed } = get();
    // Archived follows the doses: the target stays archived only if it already
    // was, or had no doses of its own for the renamed ones to un-archive.
    const targetHadDoses = logs.some(l => medicationKey(l.name) === toKey);
    const carryArchived = archived.includes(toKey) || !targetHadDoses;
    const nextSettings = renamedSettings(settings, fromKey, toKey);
    if (nextSettings !== settings) writeSettings(set, nextSettings);
    if (archived.includes(fromKey)) writeArchived(set, renamedKeys(archived, fromKey, toKey, carryArchived));
    // Doses of a live medication landing on an archived one is recording it
    // again, the same rule `updateLog` applies to a single renamed dose.
    else get().unarchiveMedication(name);
    if (milestoneDismissed.includes(fromKey)) {
      const next = renamedKeys(milestoneDismissed, fromKey, toKey, true);
      dbSetSetting(MILESTONE_DISMISSED_SETTING_KEY, JSON.stringify(next));
      set({ milestoneDismissed: next });
    }
    return changed.length;
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
    // A dose of an archived medication means you are taking it again, whether
    // a person recorded it or a scheduled task's completion did. Restoring it
    // here is what keeps "archived" from hiding something still being logged.
    get().unarchiveMedication(name);
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
      // Renaming a dose onto an archived medication is recording it again.
      get().unarchiveMedication(name);
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

function writeSettings(
  set: (partial: { settings: MedicationSettingsMap }) => void,
  settings: MedicationSettingsMap,
): void {
  dbSetSetting(MEDICATION_SETTINGS_KEY, JSON.stringify(settings));
  set({ settings });
}

function writeArchived(
  set: (partial: { archived: string[] }) => void,
  archived: string[],
): void {
  dbSetSetting(ARCHIVED_MEDICATIONS_SETTING_KEY, JSON.stringify(archived));
  set({ archived });
}

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
