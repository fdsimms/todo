import { format } from 'date-fns/format';
import type { MedicationLog } from '../types';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { dbGetFoodLogEntries } from '../db/database';
import { getLogicalDayKey } from './dateUtils';
import { confirmWithinLimit, recordDose, unrecordDose } from './doseRecording';
import { formatDose } from './medicationLog';
import { describeWater, waterEntryOf, waterHelping, waterTotalMl } from './waterLog';
import { resetToMood } from '../navigation/navigationRef';
import type { DoseAction, GroceryAction, MoodAction, SearchAction, WaterAction } from './searchActions';

/**
 * Running a search action (see `searchActions.ts`): the write, through the
 * same path the feature's own screen uses, and a way to take it back.
 *
 * A row that wrote something stays in the search results saying what it did,
 * with an Undo beside it, rather than closing the search: a mis-tap on a row
 * above the results is easy, and an undo that went away with the card would
 * leave a dose that was never taken in a health record, or milk on a list.
 */
export interface SearchActionReceipt {
  title: string;
  meta: string;
  undo: () => void;
}

/** The store's water for one logical day, in ml. */
function waterOnDay(dayKey: string): { entryId: string | null; ml: number } {
  const entry = waterEntryOf(dbGetFoodLogEntries(dayKey, dayKey));
  return { entryId: entry?.id ?? null, ml: entry ? waterTotalMl([entry]) : 0 };
}

/**
 * Move the day's water row to `totalMl`, the way the food log's own stepper
 * commits: revise the row, create it on the day's first glass, delete it when
 * the total reaches nothing (`waterHelping`'s "absent, never a zero").
 */
function setWaterOnDay(dayKey: string, totalMl: number, at: Date): void {
  const { entryId } = waterOnDay(dayKey);
  const built = waterHelping(totalMl, at);
  const { addEntry, reviseEntry, removeEntry } = useFoodLogStore.getState();
  if (!built) {
    if (entryId) removeEntry(entryId);
    return;
  }
  if (entryId) {
    reviseEntry(entryId, built);
    return;
  }
  addEntry({
    ...built,
    grams: null,
    slot: null,
    recipeId: null,
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    at,
  });
}

/** Today's water in ml, for the row's "so far" line. */
export function waterTodayMl(now: Date = new Date()): number {
  return waterOnDay(getLogicalDayKey(now, useSettingsStore.getState().dayResetTime)).ml;
}

async function runDose(action: DoseAction): Promise<SearchActionReceipt | null> {
  // Through `recordDose` like every other door a dose comes in by, so the
  // limit is asked about and a low supply offers a refill.
  if (!(await confirmWithinLimit(action.dose.name))) return null;
  const log: MedicationLog | null = recordDose(action.dose);
  if (!log) return null;
  return {
    title: `Recorded ${log.name}`,
    meta: [formatDose(log), format(new Date(log.takenAt), 'h:mm a')].filter(Boolean).join(' · '),
    undo: () => unrecordDose(log),
  };
}

function runWater(action: WaterAction): SearchActionReceipt {
  const at = new Date();
  const dayKey = getLogicalDayKey(at, useSettingsStore.getState().dayResetTime);
  const total = waterOnDay(dayKey).ml + action.ml;
  setWaterOnDay(dayKey, total, at);
  const unit = useSettingsStore.getState().waterUnit;
  return {
    title: `Logged ${describeWater(action.ml, unit)} of water`,
    meta: `${describeWater(total, unit)} today`,
    // Re-read rather than restoring the old total: the day's row may have
    // been stepped from somewhere else since, and an undo takes back only
    // what this tap added.
    undo: () => setWaterOnDay(dayKey, waterOnDay(dayKey).ml - action.ml, at),
  };
}

function runGrocery(action: GroceryAction): SearchActionReceipt | null {
  if (action.onList !== null) return null;
  const store = useGroceryStore.getState();
  const preexisting = new Set(store.items.map(i => i.id));
  // The list named explicitly: this isn't the grocery screen, and a caller
  // that isn't passes the list it means (see CLAUDE.md). The store's own
  // undo is off because this row carries its own.
  const item = store.addByName(action.raw, undefined, undefined, { registerUndo: false, listId: action.listId });
  return {
    title: `Added ${item.name} to ${action.listName}`,
    meta: item.quantity ?? '',
    // Deletes the row if this add created it and nothing has been recorded on
    // it since, otherwise takes it back off the list.
    undo: () => useGroceryStore.getState().undoForAdds([item.id], preexisting)(),
  };
}

/** Open the mood log, filled in with what the words named. */
export function openMoodLogFor(action: MoodAction): void {
  resetToMood(true, { mood: action.mood, symptom: action.symptom });
}

/**
 * Run an action that writes. Resolves null when nothing was written (a dose
 * the limit confirm was cancelled on, a grocery row that's already on the
 * list). A mood action opens a screen instead; use `openMoodLogFor`.
 */
export async function runSearchAction(action: SearchAction): Promise<SearchActionReceipt | null> {
  switch (action.kind) {
    case 'dose': return runDose(action);
    case 'water': return runWater(action);
    case 'grocery': return runGrocery(action);
    case 'mood': return null;
  }
}
