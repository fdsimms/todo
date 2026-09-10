import { create } from 'zustand';
import type { FoodLogEntry, FoodNutrition, MealSlot } from '../types';
import {
  dbCountFoodLogEntries,
  dbDeleteFoodLogEntry,
  dbGetFoodLogEntries,
  dbGetFoodLogEntry,
  dbInsertFoodLogEntry,
  dbUpdateFoodLogEntry,
} from '../db/database';
import { generateId } from '../utils/id';
import { dayKeyOf, getCurrentDayStart, getLogicalDayKey } from '../utils/dateUtils';
import { logFoodEntryToHealth, retractFoodEntryFromHealth } from '../utils/healthFoodSync';

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
 * How far back `loadInsightWindow` reads for the mood pairings.
 *
 * `HEALTH_HISTORY_DAYS`' span, matched to it on purpose: both are the same kind
 * of second dataset paired against the same days, and two windows would mean a
 * finding about steps and a finding about calories on one screen quietly
 * speaking for different stretches of somebody's life.
 *
 * It is a ceiling on the read rather than on what counts. The thin-day rule
 * (see `foodDayInputs`) drops most of what comes back for anybody logging
 * casually, which is why the window is wide: ninety days of ordinary logging is
 * what it takes to clear `MIN_PAIRED_DAYS` of days complete enough to pair.
 *
 * Here rather than on a screen because two screens read this window now, the
 * same reason `HEALTH_HISTORY_DAYS` sits in the store that fetches it.
 */
export const FOOD_INSIGHT_DAYS = 90;

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
   * A second window, for a reader that isn't the day view.
   *
   * Kept apart from `entries` rather than widening it, the same split
   * `useMealPlanStore` keeps for `cookingCounts`: the food log screen owns
   * `entries` and steps it one day at a time, and Stats wants a month. Sharing
   * one window would have each screen's read clobber the other's, so stepping
   * to yesterday would empty a section on a screen nobody had touched.
   *
   * Rows rather than a computed tally, because everything derived from them is
   * pure and lives in `nutritionStats.ts` — a store that also did the
   * arithmetic would put it somewhere jest can't reach.
   */
  windowEntries: FoodLogEntry[];
  windowStart: string | null;
  windowEnd: string | null;
  loadWindow: (startKey: string, endKey: string) => void;
  /**
   * A third window, for the Mood screen's insight reads.
   *
   * The same argument that split `windowEntries` off from `entries`, applied
   * once more rather than stretched: Stats owns that one and steps it to its
   * own span, and a Mood screen sharing it would empty a section on a screen
   * nobody had touched. Both are blurred tabs that stay mounted for the life
   * of the session, so a clobbered window is not a frame of wrongness — it
   * lasts until that screen is focused again.
   *
   * Deliberately not a fourth: three named windows is where this stops being
   * worth a keyed map, and a fourth reader is the moment to build one rather
   * than to paste this again.
   */
  insightEntries: FoodLogEntry[];
  insightStart: string | null;
  insightEnd: string | null;
  loadInsightWindow: (startKey: string, endKey: string) => void;
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
  windowEntries: [],
  windowStart: null,
  windowEnd: null,
  insightEntries: [],
  insightStart: null,
  insightEnd: null,
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

  loadWindow(startKey, endKey) {
    set({
      windowEntries: dbGetFoodLogEntries(startKey, endKey),
      windowStart: startKey,
      windowEnd: endKey,
    });
  },

  loadInsightWindow(startKey, endKey) {
    set({
      insightEntries: dbGetFoodLogEntries(startKey, endKey),
      insightStart: startKey,
      insightEnd: endKey,
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
      // Empty at insert and filled in by the Health write below once it comes
      // back, rather than awaited: this action is synchronous because every
      // caller uses the entry it returns to close a sheet, and a meal must land
      // in the log whether or not Health accepts it.
      healthSampleIds: [],
      createdAt: new Date().toISOString(),
    };
    dbInsertFoodLogEntry(entry);
    set(s => ({ totalCount: s.totalCount + 1 }));

    // Only into the window on screen. An entry backdated outside it is stored
    // and simply isn't in `entries`, which is the same contract the range read
    // already keeps rather than a gap.
    const { rangeStart, rangeEnd, windowStart, windowEnd, insightStart, insightEnd } = get();
    const byInstant = (a: FoodLogEntry, b: FoodLogEntry) => a.atISO.localeCompare(b.atISO);
    if (rangeStart && rangeEnd && entry.dayKey >= rangeStart && entry.dayKey <= rangeEnd) {
      set(s => ({ entries: [...s.entries, entry].sort(byInstant) }));
    }
    // And into the wider windows on the same terms, so a section reading either
    // of them doesn't disagree with the day view until the next time it's
    // focused.
    if (windowStart && windowEnd && entry.dayKey >= windowStart && entry.dayKey <= windowEnd) {
      set(s => ({ windowEntries: [...s.windowEntries, entry].sort(byInstant) }));
    }
    if (insightStart && insightEnd && entry.dayKey >= insightStart && entry.dayKey <= insightEnd) {
      set(s => ({ insightEntries: [...s.insightEntries, entry].sort(byInstant) }));
    }

    // The one trigger. `logFoodEntryToHealth` is called from here and from
    // nowhere else, the same single-writer rule the water write keeps and for
    // the same reason: a caller that looped it into a save, a sweep or a sync
    // pass would put meals nobody ate into somebody's medical record. It owns
    // every guard (demo mode, the write switch, the bridge), so this is not the
    // place to add another.
    //
    // Fire-and-forget with a follow-up patch, because the write is a native
    // round trip and this action is synchronous. A failure needs nothing done:
    // the entry keeps its empty `healthSampleIds`, which is exactly what "wrote
    // nothing, so there is nothing to retract" means.
    void logFoodEntryToHealth(entry).then(({ outcome, sampleIds }) => {
      if (outcome !== 'written') return;
      // Written straight through rather than via `updateEntry`, which only
      // finds rows inside the loaded range: a meal backdated outside the window
      // on screen is stored and simply isn't in `entries`, and losing its ids
      // would mean samples that can never be retracted. The row is rebuilt from
      // the entry this closure already holds, so no read is needed either.
      dbUpdateFoodLogEntry({ ...entry, healthSampleIds: sampleIds });
      const stamp = (e: FoodLogEntry) => (e.id === entry.id ? { ...e, healthSampleIds: sampleIds } : e);
      set(s => ({
        entries: s.entries.map(stamp),
        windowEntries: s.windowEntries.map(stamp),
        insightEntries: s.insightEntries.map(stamp),
      }));
    });

    return entry;
  },

  /**
   * Patches a row. Deliberately dumb, and deliberately not a Health writer.
   *
   * This is what `addEntry`'s own Health write calls back into to store the
   * sample ids, so a retract-and-rewrite here would chase its own tail. It is
   * also unused by the UI today: an entry is deleted and logged again rather
   * than edited.
   *
   * **If an edit path ever reaches `nutrition` or `label`, it must retract the
   * old samples and write new ones**, not patch the row and leave Health
   * stating the meal as first typed. `retractFoodEntryFromHealth` then
   * `logFoodEntryToHealth` is the pair, in that order.
   */
  updateEntry(id, patch) {
    const entry = get().entries.find(e => e.id === id);
    if (!entry) return;
    // `atISO` and `dayKey` are deliberately not patchable. They were stamped
    // together from one instant under one reset time, and letting an edit move
    // one without the other is how an entry ends up counted on a day it did not
    // happen on. Re-dating means a new entry.
    const updated: FoodLogEntry = { ...entry, ...patch };
    dbUpdateFoodLogEntry(updated);
    set(s => ({
      entries: s.entries.map(e => (e.id === id ? updated : e)),
      windowEntries: s.windowEntries.map(e => (e.id === id ? updated : e)),
      insightEntries: s.insightEntries.map(e => (e.id === id ? updated : e)),
    }));
  },

  setPendingMealLog(pending) {
    set({ pendingMealLog: pending });
  },

  removeEntry(id) {
    // Read before the delete, since the ids are on the row that is about to go.
    // A meal removed from the log has to be removed from Health too: an entry
    // logged against the wrong picker and left in a medical record is the
    // permanent-false-fact case this whole feature is arranged around. Nothing
    // is awaited and nothing is undone on failure — the row is gone either way,
    // and Health's own record is something the person can delete there.
    // Read from the database rather than from the loaded arrays, for the same
    // reason the write above does not go through `updateEntry`: a backdated
    // entry outside the window on screen is an ordinary row, and finding it
    // only when it happens to be loaded would strand its samples.
    const written = dbGetFoodLogEntry(id)?.healthSampleIds ?? [];
    if (written.length > 0) void retractFoodEntryFromHealth(written);

    dbDeleteFoodLogEntry(id);
    set(s => ({
      entries: s.entries.filter(e => e.id !== id),
      windowEntries: s.windowEntries.filter(e => e.id !== id),
      insightEntries: s.insightEntries.filter(e => e.id !== id),
      // Floored, so a delete of a row outside the loaded window can't drive the
      // count negative and make the screen vanish while it still holds entries.
      totalCount: Math.max(0, s.totalCount - 1),
    }));
  },
}));
