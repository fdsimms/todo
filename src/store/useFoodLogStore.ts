import { create } from 'zustand';
import type { FoodLogEntry, FoodNutrition, MealSlot } from '../types';
import {
  dbCountFoodLogEntries,
  dbDeleteFoodLogEntry,
  dbGetFoodLogEntries,
  dbInsertFoodLogEntry,
  dbUpdateFoodLogEntry,
} from '../db/database';
import { generateId } from '../utils/id';
import { dayKeyOf, getCurrentDayStart, getLogicalDayKey } from '../utils/dateUtils';

/**
 * The food log — what was eaten, and when.
 *
 * See `src/utils/foodLog.ts` for every rule about what a helping works out to
 * and what a day of them adds up to, and `FoodLogEntry` for why this is a log
 * rather than a task or a quota.
 *
 * Its own store rather than a slice of `useMealPlanStore`, for the reason
 * `useMoodStore` is its own: these are rows with their own lifecycle that
 * nothing else points at. A meal plan entry is a plan for a square on a
 * calendar and this is a record of something that happened; the two point at
 * each other and are not the same row.
 *
 * **Loaded for a window rather than wholesale**, which is where this parts
 * company with the mood log. Several rows a day forever is a great many more
 * rows than a mood history accumulates, each carrying a nutrition blob, and
 * every screen that wants them wants one day or one week. Same call
 * `useMealPlanStore` makes over the same key format, including the corollary:
 * `entries` holds exactly the loaded window and is never a superset, so
 * anything wanting a day that isn't on screen reads SQLite directly.
 *
 * It is CRUD and nothing else. Nothing here writes to Health, so nothing here
 * needs a demo-mode gate: the database swap already contains it, and the guard
 * belongs on the outbound write when there is one.
 */

/**
 * A new entry, before the store stamps the parts only it can decide.
 *
 * `nutrition` arrives already built and already scaled — see
 * `scalePanelToAmount` and `recipeHelpingNutrition`. It is a snapshot from this
 * moment on: nothing recomputes it, and editing the recipe or the catalog row
 * it came from next month must not rewrite what somebody ate last Tuesday.
 */
export interface FoodLogDraft {
  label: string;
  quantity: string;
  grams: number | null;
  nutrition: FoodNutrition;
  slot?: MealSlot | null;
  recipeId?: string | null;
  itemId?: string | null;
  productId?: string | null;
  mealPlanEntryId?: string | null;
  /**
   * The moment being recorded, defaulting to now.
   *
   * An entry is a record of a moment and the moment is not always the one you
   * are typing in: logging lunch at bedtime is an ordinary thing to want. Same
   * parameter `addLog` takes one store over, and for the same reason.
   */
  at?: Date;
}

/**
 * A meal that just finished, waiting to be offered as a log entry.
 *
 * Session-only and deliberately id-shaped: the prompt resolves the recipe and
 * computes the figures itself when it opens, so this store never reaches the
 * recipe store or the meal plan. Same posture `pendingFinishLeftoverId` keeps
 * one store over, and the same reason it is not persisted — an offer nobody
 * answered before the app closed is an offer that has expired.
 */
export interface PendingMealLog {
  /** What to call it, captured now so a renamed recipe cannot rewrite the offer. */
  label: string;
  /** Which meal it was, when the moment knows. */
  slot: MealSlot | null;
  /** The dish, for its figures. Null for a leftover whose source no longer resolves. */
  recipeId: string | null;
  /** The planned meal this came from, or null for a leftover. */
  mealPlanEntryId: string | null;
  /** How much of the recipe the cooking made, so the figures match what was on the plate. */
  scale: number;
  /** The either/or answers that cooking used, so the figures match what went in. */
  choices: string[];
}

/** What an edit may change. The instant and its day key are deliberately not on it. */
export type FoodLogPatch = Partial<
  Pick<FoodLogEntry, 'label' | 'quantity' | 'grams' | 'nutrition' | 'slot'>
>;

interface FoodLogStore {
  /** Exactly the loaded window, oldest instant first. Never a superset. */
  entries: FoodLogEntry[];
  rangeStart: string | null;
  rangeEnd: string | null;
  /**
   * How many entries exist in total, across every day.
   *
   * Kept apart from `entries.length`, which counts only the loaded window.
   * Simplified mode asks whether there is a history here at all, and answering
   * that from one day's rows would hide the screen and its months of entries
   * on any day nobody had logged yet. See `screenShown`.
   */
  totalCount: number;
  initialized: boolean;
  initialize: () => void;
  /** Replaces `entries` with the inclusive run of logical days between the keys. */
  loadRange: (startKey: string, endKey: string) => void;
  /**
   * Record something eaten.
   *
   * The day key is stamped here from `dayResetTime`, never derived from the
   * instant on read — see `FoodLogEntry.dayKey`. This is the grace-window rule
   * from CLAUDE.md, and the food log is where it bites hardest: an 11pm snack
   * recorded at 12:30am with a 02:00 reset belongs to the evening it happened
   * in, not to the day that had barely started.
   */
  addEntry: (draft: FoodLogDraft) => FoodLogEntry | null;
  updateEntry: (id: string, patch: FoodLogPatch) => void;
  /**
   * Forget an entry.
   *
   * Once something writes nutrients to Health this is also where those samples
   * are retracted, which is what `FoodLogEntry.healthSampleIds` exists for. A
   * typo'd entry that cannot be unwritten from a medical record is the failure
   * the whole feature is arranged around.
   */
  removeEntry: (id: string) => void;

  /**
   * The meal a just-finished "Eat" step, or a just-emptied leftover, is
   * offering to log. Null while there is nothing to ask about.
   *
   * Watched by `LogMealPrompt` (mounted in AppNavigator beside
   * `FinishLeftoverPrompt`, since a completion can land from Today, Search, a
   * bulk action or the widget rather than from any one screen). Cleared by the
   * prompt's own answer, and by `uncompleteTask` when the tick that set it is
   * taken back.
   */
  pendingMealLog: PendingMealLog | null;
  setPendingMealLog: (pending: PendingMealLog | null) => void;
}

export const useFoodLogStore = create<FoodLogStore>((set, get) => ({
  entries: [],
  rangeStart: null,
  rangeEnd: null,
  totalCount: 0,
  initialized: false,
  pendingMealLog: null,

  initialize() {
    // The current logical day, because that is what a day view opens on and it
    // is one small read. Anything wider is the screen's own loadRange call.
    const todayKey = dayKeyOf(getCurrentDayStart());
    set({
      entries: dbGetFoodLogEntries(todayKey, todayKey),
      rangeStart: todayKey,
      rangeEnd: todayKey,
      totalCount: dbCountFoodLogEntries(),
      initialized: true,
    });
  },

  loadRange(startKey, endKey) {
    set({
      entries: dbGetFoodLogEntries(startKey, endKey),
      rangeStart: startKey,
      rangeEnd: endKey,
    });
  },

  addEntry(draft) {
    const label = draft.label.trim();
    // An entry with nothing to call it renders as a blank row on a day's list,
    // which is a thing eaten that nobody can identify. Refused rather than
    // stored, the same call addLog makes about an entry recording nothing.
    if (!label) return null;
    if (Object.keys(draft.nutrition.amounts).length === 0) return null;

    const at = draft.at ?? new Date();
    const entry: FoodLogEntry = {
      id: generateId(),
      dayKey: getLogicalDayKey(at),
      atISO: at.toISOString(),
      slot: draft.slot ?? null,
      label,
      recipeId: draft.recipeId ?? null,
      itemId: draft.itemId ?? null,
      productId: draft.productId ?? null,
      mealPlanEntryId: draft.mealPlanEntryId ?? null,
      quantity: draft.quantity.trim(),
      grams: draft.grams,
      nutrition: draft.nutrition,
      // Nothing writes to Health yet, so nothing has been written to retract.
      healthSampleIds: [],
      createdAt: new Date().toISOString(),
    };
    dbInsertFoodLogEntry(entry);
    set(s => ({ totalCount: s.totalCount + 1 }));

    // Only into the window on screen. An entry backdated outside it is stored
    // and simply isn't in `entries`, which is the same contract the range read
    // already keeps rather than a gap.
    const { rangeStart, rangeEnd } = get();
    if (rangeStart && rangeEnd && entry.dayKey >= rangeStart && entry.dayKey <= rangeEnd) {
      set(s => ({
        entries: [...s.entries, entry].sort((a, b) => a.atISO.localeCompare(b.atISO)),
      }));
    }
    return entry;
  },

  updateEntry(id, patch) {
    const entry = get().entries.find(e => e.id === id);
    if (!entry) return;
    // `atISO` and `dayKey` are deliberately not patchable. They were stamped
    // together from one instant under one reset time, and letting an edit move
    // one without the other is how an entry ends up counted on a day it did not
    // happen on. Re-dating means a new entry.
    const updated: FoodLogEntry = { ...entry, ...patch };
    dbUpdateFoodLogEntry(updated);
    set(s => ({ entries: s.entries.map(e => (e.id === id ? updated : e)) }));
  },

  setPendingMealLog(pending) {
    set({ pendingMealLog: pending });
  },

  removeEntry(id) {
    dbDeleteFoodLogEntry(id);
    set(s => ({
      entries: s.entries.filter(e => e.id !== id),
      // Floored, so a delete of a row outside the loaded window can't drive the
      // count negative and make the screen vanish while it still holds entries.
      totalCount: Math.max(0, s.totalCount - 1),
    }));
  },
}));
