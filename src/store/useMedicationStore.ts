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
  REGISTERED_MEDICATIONS_SETTING_KEY,
  isCountedUnit,
  medicationKey,
  parseArchivedMedications,
  parseRegisteredMedications,
} from '../utils/medicationLog';
import {
  renamedKeys,
  renamedLogs,
  renamedSettings,
  type DoseFill,
} from '../utils/medicationRename';
import {
  MEDICATION_SETTINGS_KEY,
  defaultUsualDose,
  parseMedicationSettings,
  parseStrength,
  prefsFor,
  refilledSupply,
  supplyRemaining,
  withPrefs,
  type AmountCap,
  type MedicationLimit,
  type MedicationSettingsMap,
  type MedicationSupply,
  type SupplementPanel,
  MAX_USUAL_DOSES,
  type UsualDose,
} from '../utils/medicationSettings';
import { parseSchedule, type MedicationSchedule } from '../utils/medicationSchedule';

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
  /**
   * When no amount is given, fill it from the medication's default usual
   * amount. Set by a task's completion, whose dose is "whatever you usually
   * take" unless the task names an amount; a hand-recorded dose with no amount
   * means exactly that and is left alone. Read at record time, so the dose
   * keeps what the usual amount was then.
   */
  useUsualDose?: boolean;
}

/**
 * What follows a dose being written, edited or removed, installed by whoever
 * can act on it.
 *
 * **A seam rather than an import**, because the one thing that follows a dose
 * is a supplement's nutrients landing in the food log (`supplementDose.ts`),
 * and the food log store reaches Apple Health and React Native. This store is
 * loaded by the MCP server too, which can load neither. So the app installs the
 * store-backed version at launch (`installSupplementDoseEffects`) and the MCP
 * replica installs one that writes the rows directly; a process that installs
 * nothing simply records doses, as before.
 *
 * Called after the dose is stored, so an effect that throws can't lose a dose.
 */
export interface DoseEffects {
  added: (log: MedicationLog) => void;
  /** `before` is the row as it stood; `after` as it stands now. */
  updated: (before: MedicationLog, after: MedicationLog) => void;
  /** Called before the rows are deleted. */
  removed: (logs: MedicationLog[]) => void;
}

let doseEffects: DoseEffects | null = null;

export function setDoseEffects(effects: DoseEffects | null): void {
  doseEffects = effects;
}

/** Run an effect without letting it fail the write that triggered it. */
function runEffect(run: (fx: DoseEffects) => void): void {
  if (!doseEffects) return;
  try {
    run(doseEffects);
  } catch {
    // The dose is already stored; an effect that can't complete leaves it a
    // plain dose, which is what it was before effects existed.
  }
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
   * Medications added by name, spelled as typed. Lets a medication exist before
   * its first dose and stay listed after its last one is deleted; one with doses
   * needs no entry here (see `medicationVocabulary`).
   */
  registered: string[];
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
  /**
   * Set or clear what a serving of a medication contains. Doses recorded after
   * this add those nutrients to the day; earlier doses are left as they were.
   */
  setSupplementPanel: (name: string, panel: SupplementPanel | null) => void;
  /** Say whether it is taken as needed or on a schedule; null goes back to reading it off the doses. */
  setAsNeeded: (name: string, asNeeded: boolean | null) => void;
  /** Set the days it is taken on, or null to clear them. */
  setSchedule: (name: string, schedule: MedicationSchedule | null) => void;
  /**
   * Replace the amounts you usually take. The first is the default, the rest are
   * quick picks. Anything not a positive amount with a unit is dropped, repeats
   * are folded, and the list is cut to `MAX_USUAL_DOSES`.
   */
  setUsualDoses: (name: string, doses: UsualDose[]) => void;
  /**
   * Set or clear what one capsule, tablet, puff or drop contains. Doses recorded
   * after this carry it; earlier doses keep what they were stamped with.
   */
  setStrength: (name: string, strength: AmountCap | null) => void;
  /** Add a refill to what's left. */
  refillSupply: (name: string, added: number) => void;
  /** Turn down the refill offer at the current count. */
  declineRefill: (name: string) => void;
  /** Stop offering to mark the day this medication was started. */
  dismissMilestoneOffer: (name: string) => void;
  /** Record that a summary was just shared. */
  markSummaryShared: (at: Date) => void;
  /**
   * Add a medication to the list with no dose. Restores it when archived and
   * returns false for a blank name or one already listed.
   */
  addMedication: (name: string) => boolean;
  /**
   * Take a medication with no doses off the list, along with its limit and
   * supply. Refuses (returns false) one that has doses: those are the record,
   * and are deleted one at a time.
   */
  removeMedication: (name: string) => boolean;
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
   * Put a deleted dose back exactly as it was (same id, time, day and task), for
   * an undo. A dose already present is left alone. Not `addLog`: that would
   * stamp a new id and time, and unarchive a medication a restore says nothing about.
   */
  restoreLog: (log: MedicationLog) => void;
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
  registered: [],
  settings: {},
  lastSummaryAt: null,
  milestoneDismissed: [],
  initialized: false,

  initialize() {
    const logs = dbGetAllMedicationLogs();
    const archived = parseArchivedMedications(dbGetSetting(ARCHIVED_MEDICATIONS_SETTING_KEY));
    const registered = parseRegisteredMedications(dbGetSetting(REGISTERED_MEDICATIONS_SETTING_KEY));
    const settings = parseMedicationSettings(dbGetSetting(MEDICATION_SETTINGS_KEY));
    const lastSummary = dbGetSetting(SUMMARY_LAST_SETTING_KEY);
    const milestoneDismissed = parseArchivedMedications(dbGetSetting(MILESTONE_DISMISSED_SETTING_KEY));
    set({
      milestoneDismissed,
      logs,
      archived,
      registered,
      settings,
      lastSummaryAt: lastSummary && !Number.isNaN(Date.parse(lastSummary)) ? lastSummary : null,
      initialized: true,
    });
  },

  setLimit(name, limit) {
    if (!medicationKey(name)) return;
    const current = prefsFor(get().settings, name);
    let next: MedicationLimit | null = null;
    const amountCap = limit?.maxAmount24h ?? null;
    const doseCap = limit?.maxDose ?? null;
    if (limit && (limit.minHours !== null || limit.maxPer24h !== null || amountCap || doseCap)) {
      const before = current.limit?.maxAmount24h ?? null;
      const doseBefore = current.limit?.maxDose ?? null;
      const capsUnchanged = current.limit
        && current.limit.minHours === limit.minHours
        && current.limit.maxPer24h === limit.maxPer24h
        && before?.amount === amountCap?.amount
        && before?.unit === amountCap?.unit
        && doseBefore?.amount === doseCap?.amount
        && doseBefore?.unit === doseCap?.unit;
      next = {
        ...limit,
        maxAmount24h: amountCap,
        maxDose: doseCap,
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

  setSupplementPanel(name, panel) {
    if (!medicationKey(name)) return;
    const current = prefsFor(get().settings, name);
    writeSettings(set, withPrefs(get().settings, name, { ...current, nutrition: panel }));
  },

  setAsNeeded(name, asNeeded) {
    if (!medicationKey(name)) return;
    const current = prefsFor(get().settings, name);
    writeSettings(set, withPrefs(get().settings, name, { ...current, asNeeded }));
  },

  setSchedule(name, schedule) {
    if (!medicationKey(name)) return;
    const current = prefsFor(get().settings, name);
    const { schedule: _dropped, ...rest } = current;
    const clean = parseSchedule(schedule);
    writeSettings(set, withPrefs(get().settings, name, clean ? { ...rest, schedule: clean } : rest));
  },

  setUsualDoses(name, doses) {
    if (!medicationKey(name)) return;
    const current = prefsFor(get().settings, name);
    const usualDoses: UsualDose[] = [];
    for (const d of doses) {
      if (!Number.isFinite(d.amount) || d.amount <= 0 || !d.unit) continue;
      if (usualDoses.some(u => u.amount === d.amount && u.unit === d.unit)) continue;
      usualDoses.push({ amount: d.amount, unit: d.unit });
      if (usualDoses.length >= MAX_USUAL_DOSES) break;
    }
    const { usualDoses: _dropped, ...rest } = current;
    writeSettings(set, withPrefs(get().settings, name, usualDoses.length > 0 ? { ...rest, usualDoses } : rest));
  },

  setStrength(name, strength) {
    if (!medicationKey(name)) return;
    const current = prefsFor(get().settings, name);
    const { strength: _dropped, ...rest } = current;
    const clean = parseStrength(strength);
    writeSettings(set, withPrefs(get().settings, name, clean ? { ...rest, strength: clean } : rest));
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

  addMedication(name) {
    const clean = name.trim();
    const key = medicationKey(clean);
    if (!key) return false;
    const { logs, registered, archived } = get();
    const listed = logs.some(l => medicationKey(l.name) === key)
      || registered.some(r => medicationKey(r) === key);
    // Adding an archived one is taking it again, the rule `addLog` applies.
    if (listed && !archived.includes(key)) return false;
    if (!registered.some(r => medicationKey(r) === key) && !logs.some(l => medicationKey(l.name) === key)) {
      writeRegistered(set, [...registered, clean]);
    }
    get().unarchiveMedication(clean);
    return true;
  },

  removeMedication(name) {
    const key = medicationKey(name);
    if (!key || get().logs.some(l => medicationKey(l.name) === key)) return false;
    const { registered, archived, settings } = get();
    if (registered.some(r => medicationKey(r) === key)) {
      writeRegistered(set, registered.filter(r => medicationKey(r) !== key));
    }
    if (archived.includes(key)) writeArchived(set, archived.filter(k => k !== key));
    if (settings[key]) {
      const next = { ...settings };
      delete next[key];
      writeSettings(set, next);
    }
    return true;
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
    const { logs, registered } = get();
    const fromRegistered = registered.some(r => medicationKey(r) === fromKey);
    if (!fromRegistered && !logs.some(l => medicationKey(l.name) === fromKey)) return null;
    const cleanFill = fill && Number.isFinite(fill.amount) && fill.amount > 0 && fill.unit.trim()
      ? { amount: fill.amount, unit: fill.unit.trim() }
      : null;

    const changed = renamedLogs(logs, fromKey, name, cleanFill);
    const byId = new Map(changed.map(l => [l.id, l]));
    changed.forEach(dbUpdateMedicationLog);
    set({ logs: logs.map(l => byId.get(l.id) ?? l) });
    // A supplement dose's food log entry carries the medication's name and
    // scales with the dose, so a renamed or re-filled dose updates it too.
    const before = new Map(logs.map(l => [l.id, l]));
    changed.forEach(after => runEffect(fx => fx.updated(before.get(after.id)!, after)));

    // The added-by-name list follows the name too; a spelling change keeps the
    // entry (so a dose-less medication takes its new spelling), a fold drops it.
    if (fromRegistered) {
      const kept = registered.filter(r => medicationKey(r) !== fromKey);
      const next = kept.some(r => medicationKey(r) === toKey) ? kept : [...kept, name];
      writeRegistered(set, next);
    }

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

    const prefs = prefsFor(get().settings, name);
    const usual = input.useUsualDose && input.amount == null ? defaultUsualDose(prefs) : null;
    const { amount, unit } = cleanDose(usual?.amount ?? input.amount ?? null, usual?.unit ?? input.unit ?? null);
    // A counted dose carries what one of them contained, as the medication says
    // now, so a later change of strength doesn't rewrite it.
    const strength = isCountedUnit(unit) && prefs.strength ? { ...prefs.strength } : null;
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
      ...(strength ? { strength } : {}),
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
    runEffect(fx => fx.added(log));
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
    runEffect(fx => fx.updated(existing, next));
  },

  removeLog(id) {
    const removed = get().logs.filter(l => l.id === id);
    runEffect(fx => fx.removed(removed));
    dbDeleteMedicationLog(id);
    set({ logs: get().logs.filter(l => l.id !== id) });
    keepListed(get, set, removed);
  },

  restoreLog(log) {
    if (get().logs.some(l => l.id === log.id)) return;
    dbInsertMedicationLog(log);
    // Newest first by when it was taken, which is where it was before it was deleted.
    set({ logs: [...get().logs, log].sort((a, b) => b.takenAt.localeCompare(a.takenAt)) });
    runEffect(fx => fx.added(log));
  },

  removeLogsForTask(taskId) {
    const removed = get().logs.filter(l => l.taskId === taskId);
    runEffect(fx => fx.removed(removed));
    dbDeleteMedicationLogsForTask(taskId);
    set({ logs: get().logs.filter(l => l.taskId !== taskId) });
    keepListed(get, set, removed);
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

/**
 * After doses are deleted, keep a medication that just lost its last one on the
 * list. Medications that were only ever derived from doses have no entry of
 * their own, so without this the last delete would remove the medication
 * itself, with its limit and supply stranded under a name nothing lists.
 */
function keepListed(
  get: () => { logs: MedicationLog[]; registered: string[] },
  set: (partial: { registered: string[] }) => void,
  removed: readonly MedicationLog[],
): void {
  const { logs, registered } = get();
  const next = [...registered];
  for (const log of removed) {
    const key = medicationKey(log.name);
    if (!key) continue;
    if (logs.some(l => medicationKey(l.name) === key)) continue;
    if (next.some(r => medicationKey(r) === key)) continue;
    next.push(log.name.trim());
  }
  if (next.length !== registered.length) writeRegistered(set, next);
}

function writeRegistered(
  set: (partial: { registered: string[] }) => void,
  registered: string[],
): void {
  dbSetSetting(REGISTERED_MEDICATIONS_SETTING_KEY, JSON.stringify(registered));
  set({ registered });
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
