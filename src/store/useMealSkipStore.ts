import { create } from 'zustand';
import type { MealSkip, MealSlot } from '../types';
import { dbDeleteMealSkip, dbGetMealSkipsSince, dbInsertMealSkip } from '../db/database';
import { dayKeyOf, getLogicalToday } from '../utils/dateUtils';
import { shiftDayKey } from '../utils/mealPlan';
import { derivedId, spawnSeed } from '../utils/syncIds';

/**
 * Meals the person said they skipped (`MealSkip`), set from the meal strip on
 * Today. CRUD and nothing else: what a skip means for the strip is
 * `mealStripCells` in `src/utils/mealStrip.ts`.
 *
 * Loads a week back from the logical today rather than everything: the strip
 * only draws today, and a skip is three rows a day at most, so the window is
 * a bound on a table that otherwise only grows. A skip set during the session
 * is kept whatever its day.
 */

/** How many days back from today `initialize` loads. */
const LOAD_DAYS_BACK = 7;

/** The id of the skip for one meal of one day; one row per meal, on every device. */
export function mealSkipId(dayKey: string, slot: MealSlot): string {
  return derivedId(spawnSeed.mealSkip(dayKey, slot));
}

interface MealSkipStore {
  skips: MealSkip[];
  initialized: boolean;
  initialize: () => void;
  /** Whether this meal of this day is marked skipped. */
  isSkipped: (dayKey: string, slot: MealSlot) => boolean;
  /**
   * Marks a meal skipped or not. Returns the undo for the opposite write, or
   * null when nothing changed (already in that state).
   */
  setSkipped: (dayKey: string, slot: MealSlot, skipped: boolean) => (() => void) | null;
}

export const useMealSkipStore = create<MealSkipStore>((set, get) => ({
  skips: [],
  initialized: false,

  initialize() {
    const from = shiftDayKey(dayKeyOf(getLogicalToday()), -LOAD_DAYS_BACK);
    set({ skips: dbGetMealSkipsSince(from), initialized: true });
  },

  isSkipped(dayKey, slot) {
    return get().skips.some(s => s.dayKey === dayKey && s.slot === slot);
  },

  setSkipped(dayKey, slot, skipped) {
    const id = mealSkipId(dayKey, slot);
    const existing = get().skips.find(s => s.id === id);
    if (skipped) {
      if (existing) return null;
      const skip: MealSkip = { id, dayKey, slot, createdAt: new Date().toISOString() };
      dbInsertMealSkip(skip);
      set({ skips: [...get().skips, skip] });
    } else {
      if (!existing) return null;
      dbDeleteMealSkip(id);
      set({ skips: get().skips.filter(s => s.id !== id) });
    }
    return () => { get().setSkipped(dayKey, slot, !skipped); };
  },
}));
