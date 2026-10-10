import type { FoodLogEntry, MedicationLog } from '../types';
import { setDoseEffects, useMedicationStore, type DoseEffects } from '../store/useMedicationStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { dbGetFoodLogEntries } from '../db/database';
import { getLogicalDayKey } from './dateUtils';
import { prefsFor } from './medicationSettings';
import { entryForDose, supplementHelping } from './supplementDose';

/**
 * The app's half of a supplement dose adding its nutrients: what runs when a
 * dose is written, edited or removed, through the food log store so the entry
 * reaches Apple Health the way any logged meal does. `supplementDose.ts` holds
 * the rules (what the entry is, how it scales); this holds the wiring.
 *
 * **Installed once at launch, from `useTaskStore.initialize`**, because the
 * medication store is shared with the MCP server and can't import the food log
 * store itself (`DoseEffects`).
 *
 * **Never undoable through the food log.** The dose has its own undo bar and
 * its own delete; an entry that registered a second "Logged X" action would
 * leave shake-to-undo offering to take back half of a dose. Edits go through a
 * remove and a fresh add rather than `reviseEntry` for the same reason (it
 * always records an undo), and Health still gets its retract-then-write.
 *
 * **An edit only touches an entry that exists.** Changing the amount of a dose
 * recorded before a panel was entered must not conjure nutrients onto a past
 * day; a panel is for doses recorded after it. A dose renamed onto a
 * supplement is likewise a correction of a label, not a new dose.
 */

/** The entry a dose wrote, or null. Searches the day it was taken on. */
function findEntry(log: MedicationLog): FoodLogEntry | null {
  // Both keys, because the dose stamps its day at write time from the same
  // reset time the entry does, but a reset time changed between the two
  // writes could separate them.
  const keys = new Set([getLogicalDayKey(new Date(log.takenAt)), log.dayKey]);
  for (const key of keys) {
    const hit = entryForDose(dbGetFoodLogEntries(key, key), log.id);
    if (hit) return hit;
  }
  return null;
}

/** Write the entry for a dose, when its medication has a panel. */
function writeEntry(log: MedicationLog): void {
  const panel = prefsFor(useMedicationStore.getState().settings, log.name).nutrition;
  if (!panel) return;
  const helping = supplementHelping(panel, log);
  if (!helping) return;
  useFoodLogStore.getState().addEntry(
    {
      label: helping.label,
      quantity: helping.quantity,
      grams: null,
      nutrition: helping.nutrition,
      slot: null,
      recipeId: null,
      itemId: null,
      productId: null,
      mealPlanEntryId: null,
      at: new Date(log.takenAt),
    },
    { undoable: false },
  );
}

const effects: DoseEffects = {
  added: writeEntry,

  updated(before, after) {
    const changed = before.name !== after.name || before.amount !== after.amount || before.unit !== after.unit;
    if (!changed) return;
    const existing = findEntry(before);
    if (!existing) return;
    useFoodLogStore.getState().removeEntry(existing.id, { undoable: false });
    writeEntry(after);
  },

  removed(logs) {
    for (const log of logs) {
      const existing = findEntry(log);
      if (existing) useFoodLogStore.getState().removeEntry(existing.id, { undoable: false });
    }
  },
};

/** Start adding a supplement dose's nutrients to the food log. Safe to call twice. */
export function installSupplementDoseEffects(): void {
  setDoseEffects(effects);
}
