import { create } from 'zustand';
import type { MealPlanEntry, MealSlot } from '../types';
import {
  dbGetMealPlanEntries,
  dbInsertMealPlanEntry,
  dbUpdateMealPlanEntry,
  dbDeleteMealPlanEntry,
  dbPurgeOldMealPlanEntries,
  dbGetMealPlanAddedToList,
  dbSetMealPlanAddedToList,
} from '../db/database';
import { generateId } from '../utils/id';
import {
  cleanMealTitle,
  isKeyInRange,
  mealPlanPurgeCutoffKey,
  nextSortOrder,
  resolveBulkMoveTargets,
  sortMealEntries,
} from '../utils/mealPlan';

/**
 * Mirrors useTaskStore/useGroceryStore's UndoableAction — see
 * useGroceryStore's doc comment. A third independent queue rather than
 * folding into either of those: meal plan entries aren't tasks or catalog
 * rows, and useShakeToUndo just adds a third candidate to the freshest-wins
 * comparison it already does between the other two.
 */
interface UndoableAction {
  label: string;
  undo: () => void;
  at?: number;
}

export interface MealPlanDraft {
  date: string;
  slot: MealSlot;
  /** Null for a free-text meal — a first-class answer, not a skipped step. */
  recipeId?: string | null;
  /** Set when the plan is "eat the chilli that's in the fridge". Null otherwise. */
  leftoverId?: string | null;
  title: string;
}

/**
 * The week plan.
 *
 * **Range-scoped, not wholesale**, which is the one structural thing to get
 * right here. `entries` holds exactly the day-key window last asked for and
 * nothing else — a write outside that window goes to SQLite and is deliberately
 * *not* patched into memory, because "everything the screen is showing" is the
 * only invariant this array has.
 *
 * Two reasons it isn't the whole table. `enableScreens(false)` makes
 * `freezeOnBlur` inert app-wide (see CLAUDE.md), so a blurred MealPlanScreen
 * stays mounted and re-renders on every store change — the smaller the thing it
 * selects, the less that costs. And these are per-event rows: the table grows
 * for as long as the user plans meals, bounded only by the 180-day purge, so
 * "load it all into memory" gets slowly worse in a way a task list doesn't.
 *
 * Thin on purpose — the logic lives in utils/mealPlan where jest can reach it.
 */
interface MealPlanStore {
  /** Exactly the loaded window, in reading order. Never a superset. */
  entries: MealPlanEntry[];
  /** The inclusive day-key window `entries` covers; null before the first load. */
  rangeStart: string | null;
  rangeEnd: string | null;
  initialized: boolean;

  /** The most recent undoable meal-plan mutation — see useShakeToUndo. */
  lastAction: UndoableAction | null;
  setLastAction: (action: UndoableAction | null) => void;
  undoLastAction: () => void;

  /**
   * Reloads whatever window is currently loaded. Rides useTaskStore.initialize's
   * fan-out for the same reason groceries and recipes do: enterDemoMode,
   * exitDemoMode and restore-from-backup all reload by calling that after
   * swapping the database file, and a store initialized outside it would keep
   * showing rows from the previous database.
   */
  initialize: () => void;

  /** Loads an inclusive day-key window, replacing whatever was loaded before. */
  loadRange: (startKey: string, endKey: string) => void;

  /** Null when the title is empty and no recipe was named. */
  planMeal: (draft: MealPlanDraft) => MealPlanEntry | null;

  /** Moves an entry to another day and/or slot, re-ordering it to the end of where it lands. */
  moveEntry: (id: string, to: { date?: string; slot?: MealSlot }) => void;

  removeEntry: (id: string) => void;

  /**
   * Rewrites a free-text entry's title in place. Refuses a blank result (same
   * rule as planMeal) and is a no-op on a recipe-backed entry — that title
   * comes from the recipe, and renaming it here would just be overwritten the
   * next time titleForEntry resolves the recipe again.
   */
  renameEntry: (id: string, title: string) => void;

  /**
   * Records which alternative this meal is having, as the whole list of chosen
   * component link ids — see MealPlanEntry.recipeChoices. Replaces rather
   * than merges, because the caller builds the new list with
   * applyChoice, which is where the one-answer-per-group rule lives.
   *
   * Allowed on an already-cooked entry: the pick is a note about the meal, and
   * correcting Tuesday to say it was actually roast potatoes is a fair edit —
   * unlike markCooked, nothing downstream counts it.
   */
  setRecipeChoices: (id: string, recipeChoices: string[]) => void;

  /**
   * Stamps cookedAt with now. Idempotent — a second tap on an already-cooked
   * entry is a no-op, since the recipe's cookCount (bumped separately by the
   * caller via useRecipeStore.markCooked) must only ever go up once per
   * entry. One-way by design: there's no unmark, matching the streaks/
   * completed-task precedent of not undoing a counted event.
   */
  markCooked: (id: string) => void;

  /**
   * The bulk-selection actions (#1110) — mirrors of planMeal/moveEntry/
   * removeEntry/markCooked for a whole selection at once, kept thin the same
   * way those are: the resolution logic that can be tested without a
   * database lives in utils/mealPlan (resolveBulkMoveTargets), this just
   * writes it through.
   *
   * `bulkMoveEntries`, `bulkReplaceItem` and `bulkSetCooked` now register
   * `lastAction` and are offered by shake-to-undo, same as the single-entry
   * actions above. `bulkDeleteEntries` deliberately does not: its confirm
   * dialog tells the user outright "This can't be undone" (same call
   * useRecipeStore.bulkDeleteRecipes makes), and shake-to-undo quietly
   * reviving a delete the app just promised was permanent would be a lie by
   * omission — worse than not offering an undo path at all.
   */

  /** Deletes every named entry. Confirmation and copy live in the screen, same as removeEntry's single-row delete. */
  bulkDeleteEntries: (ids: string[]) => void;

  /**
   * Moves every named entry to another day and/or slot in one go — the bulk
   * form of moveEntry. Entries destined for the same (date, slot) (two
   * selected dinners both sent to Thursday) are ordered against each other as
   * well as against what's already there, so a batch move never collides the
   * way N sequential single moves could.
   */
  bulkMoveEntries: (ids: string[], to: { date?: string; slot?: MealSlot }) => void;

  /**
   * Swaps the recipe/title on every named entry — e.g. bulk-replacing a
   * recipe that's been renamed or retired across every planned occurrence of
   * it. `recipeChoices` is always reset to `[]` (a different recipe's choice
   * groups don't carry over — same as a fresh planMeal) and `leftoverId` is
   * always cleared (the entry is now backed by a recipe or a plain title, not
   * a tracked container — the same mutually-exclusive-backing rule planMeal
   * keeps). `cookedAt` is left untouched: relabelling what a past night was
   * doesn't un-cook it.
   */
  bulkReplaceItem: (ids: string[], replacement: { recipeId: string | null; title: string }) => void;

  /**
   * Bulk-toggles cookedAt across the selection — unlike the single-row
   * markCooked, this direction is reversible on purpose (the issue this
   * shipped for asks for "mark cooked / uncooked" explicitly), but it still
   * only ever writes the entry's own cookedAt. It never touches a recipe's
   * cookCount either way: bumping it for entries newly marked cooked is the
   * screen's job (mirroring the single-row markCooked flow, which calls
   * useRecipeStore.markCooked itself), and marking uncooked never decrements
   * it — cookCount is a counter that only goes up, same as everywhere else it
   * appears in this app.
   */
  bulkSetCooked: (ids: string[], cooked: boolean) => void;

  /**
   * When "Add week to list" was last used for a given week, keyed by the
   * week's start day key. A stamp, not a lock — adding twice because you
   * forgot the mushrooms is a real action, so nothing here ever blocks a
   * repeat add. Loaded wholesale (it's a small settings-JSON map, not a
   * per-event table) and kept in step by stampAddedToList/purgeOldEntries.
   */
  addedToListAt: Record<string, string>;
  /** Stamps `weekStartKey` with now, for the week header's "Added to list on X" line. */
  stampAddedToList: (weekStartKey: string) => void;

  /** Enforces the 180-day horizon. Returns how many rows went. */
  purgeOldEntries: () => number;
}

export const useMealPlanStore = create<MealPlanStore>((set, get) => ({
  entries: [],
  rangeStart: null,
  rangeEnd: null,
  addedToListAt: {},
  initialized: false,
  lastAction: null,

  setLastAction(action) {
    set({ lastAction: action ? { ...action, at: Date.now() } : null });
  },

  undoLastAction() {
    const action = get().lastAction;
    if (!action) return;
    try {
      action.undo();
    } catch (e) {
      console.error('undoLastAction failed', e);
    }
    set({ lastAction: null });
  },

  initialize() {
    const addedToListAt = dbGetMealPlanAddedToList();
    const { rangeStart, rangeEnd } = get();
    if (rangeStart && rangeEnd) {
      set({
        entries: sortMealEntries(dbGetMealPlanEntries(rangeStart, rangeEnd)),
        addedToListAt,
        initialized: true,
      });
      return;
    }
    // Nothing has asked for a window yet, so there is nothing to hold. The
    // screen loads its own on mount.
    set({ entries: [], addedToListAt, initialized: true });
  },

  loadRange(startKey, endKey) {
    set({
      entries: sortMealEntries(dbGetMealPlanEntries(startKey, endKey)),
      rangeStart: startKey,
      rangeEnd: endKey,
    });
  },

  planMeal(draft) {
    const title = cleanMealTitle(draft.title);
    if (!title) return null;

    const entry: MealPlanEntry = {
      id: generateId(),
      date: draft.date,
      slot: draft.slot,
      recipeId: draft.recipeId ?? null,
      title,
      // Ordered against SQLite's answer for that slot rather than against
      // `entries`, so planning into a day outside the loaded window still lands
      // at the end of it instead of colliding on 1.
      sortOrder: nextSortOrder(
        dbGetMealPlanEntries(draft.date, draft.date),
        draft.date,
        draft.slot
      ),
      createdAt: new Date().toISOString(),
      cookedAt: null,
      // Planning against a leftover deliberately does *not* close it out — see
      // Leftover.finishedAt. Nothing here touches the leftover store at all;
      // the "was that the last of it?" offer is the picker's, and it's an
      // offer.
      leftoverId: draft.leftoverId ?? null,
      // Nothing picked yet, which resolves to every choice group's default —
      // planning a meal must never be gated on answering "mash or roast?", the
      // same call MealPlanEntry.recipeId makes about naming a recipe at all.
      recipeChoices: [],
    };

    dbInsertMealPlanEntry(entry);
    patchInRange(set, get, entry);
    get().setLastAction({
      label: `Planned "${entry.title}"`,
      undo: () => {
        dbDeleteMealPlanEntry(entry.id);
        set(s => ({ entries: s.entries.filter(e => e.id !== entry.id) }));
      },
    });
    return entry;
  },

  moveEntry(id, to) {
    const entry = get().entries.find(e => e.id === id);
    if (!entry) return;
    const date = to.date ?? entry.date;
    const slot = to.slot ?? entry.slot;
    if (date === entry.date && slot === entry.slot) return;

    const moved: MealPlanEntry = {
      ...entry,
      date,
      slot,
      sortOrder: nextSortOrder(dbGetMealPlanEntries(date, date), date, slot),
    };
    dbUpdateMealPlanEntry(moved);
    set(s => ({ entries: sortMealEntries(s.entries.filter(e => e.id !== id)) }));
    patchInRange(set, get, moved);
    get().setLastAction({
      label: `Moved "${entry.title}"`,
      undo: () => {
        dbUpdateMealPlanEntry(entry);
        set(s => ({ entries: sortMealEntries(s.entries.filter(e => e.id !== id)) }));
        patchInRange(set, get, entry);
      },
    });
  },

  removeEntry(id) {
    const entry = get().entries.find(e => e.id === id);
    dbDeleteMealPlanEntry(id);
    set(s => ({ entries: s.entries.filter(e => e.id !== id) }));
    if (entry) {
      get().setLastAction({
        label: `Removed "${entry.title}"`,
        undo: () => {
          dbInsertMealPlanEntry(entry);
          patchInRange(set, get, entry);
        },
      });
    }
  },

  renameEntry(id, title) {
    const entry = get().entries.find(e => e.id === id);
    // A backed entry's title says what it's backed by — a recipe's live name, or
    // the leftover-and-its-age captured at plan time — so neither is
    // independently editable here. Free text is the only thing this renames.
    if (!entry || entry.recipeId || entry.leftoverId) return;
    const cleaned = cleanMealTitle(title);
    if (!cleaned || cleaned === entry.title) return;
    const renamed: MealPlanEntry = { ...entry, title: cleaned };
    dbUpdateMealPlanEntry(renamed);
    set(s => ({ entries: s.entries.map(e => e.id === id ? renamed : e) }));
  },

  setRecipeChoices(id, recipeChoices) {
    const entry = get().entries.find(e => e.id === id);
    if (!entry) return;
    const chosen: MealPlanEntry = { ...entry, recipeChoices };
    dbUpdateMealPlanEntry(chosen);
    set(s => ({ entries: s.entries.map(e => e.id === id ? chosen : e) }));
  },

  markCooked(id) {
    const entry = get().entries.find(e => e.id === id);
    if (!entry || entry.cookedAt) return;
    const cooked: MealPlanEntry = { ...entry, cookedAt: new Date().toISOString() };
    dbUpdateMealPlanEntry(cooked);
    set(s => ({ entries: s.entries.map(e => e.id === id ? cooked : e) }));
  },

  bulkDeleteEntries(ids) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    ids.forEach(id => dbDeleteMealPlanEntry(id));
    set(s => ({ entries: s.entries.filter(e => !idSet.has(e.id)) }));
  },

  bulkMoveEntries(ids, to) {
    const targets = resolveBulkMoveTargets(get().entries, ids, to);
    if (targets.length === 0) return;
    const byId = new Map(get().entries.map(e => [e.id, e]));
    // Captured before any row is touched, so undo restores each entry's own
    // original date/slot/sortOrder rather than one shared destination.
    const originals = targets.map(({ id }) => byId.get(id)!);

    // Entries landing in the same (date, slot) this batch are numbered against
    // each other, not just against what's already on the table — read once per
    // destination and incremented locally, the same "land at the end" rule
    // nextSortOrder gives a single move.
    const destBase = new Map<string, number>();
    const moved: MealPlanEntry[] = targets.map(({ id, date, slot }) => {
      const entry = byId.get(id)!;
      const key = `${date}|${slot}`;
      const sortOrder = destBase.has(key)
        ? destBase.get(key)!
        : nextSortOrder(dbGetMealPlanEntries(date, date), date, slot);
      destBase.set(key, sortOrder + 1);
      return { ...entry, date, slot, sortOrder };
    });

    moved.forEach(dbUpdateMealPlanEntry);
    const movedIds = new Set(moved.map(e => e.id));
    set(s => ({ entries: sortMealEntries(s.entries.filter(e => !movedIds.has(e.id))) }));
    moved.forEach(entry => patchInRange(set, get, entry));

    get().setLastAction({
      label: `${moved.length} meal${moved.length === 1 ? '' : 's'} moved`,
      undo: () => {
        originals.forEach(dbUpdateMealPlanEntry);
        set(s => ({ entries: sortMealEntries(s.entries.filter(e => !movedIds.has(e.id))) }));
        originals.forEach(entry => patchInRange(set, get, entry));
      },
    });
  },

  bulkReplaceItem(ids, replacement) {
    const title = cleanMealTitle(replacement.title);
    if (!title || ids.length === 0) return;
    const idSet = new Set(ids);
    const toUpdate = get().entries.filter(e => idSet.has(e.id));
    if (toUpdate.length === 0) return;

    const updated = toUpdate.map((e): MealPlanEntry => ({
      ...e,
      recipeId: replacement.recipeId,
      title,
      recipeChoices: [],
      leftoverId: null,
    }));
    updated.forEach(dbUpdateMealPlanEntry);
    const byId = new Map(updated.map(e => [e.id, e]));
    set(s => ({ entries: s.entries.map(e => byId.get(e.id) ?? e) }));

    get().setLastAction({
      label: `${updated.length} meal${updated.length === 1 ? '' : 's'} replaced`,
      undo: () => {
        toUpdate.forEach(dbUpdateMealPlanEntry);
        const originalById = new Map(toUpdate.map(e => [e.id, e]));
        set(s => ({ entries: s.entries.map(e => originalById.get(e.id) ?? e) }));
      },
    });
  },

  bulkSetCooked(ids, cooked) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const cookedAt = cooked ? new Date().toISOString() : null;
    // Idempotent per entry, same as markCooked: an entry already at the
    // target state isn't written again.
    const toUpdate = get().entries.filter(e => idSet.has(e.id) && !!e.cookedAt !== cooked);
    if (toUpdate.length === 0) return;

    const updated = toUpdate.map((e): MealPlanEntry => ({ ...e, cookedAt }));
    updated.forEach(dbUpdateMealPlanEntry);
    const byId = new Map(updated.map(e => [e.id, e]));
    set(s => ({ entries: s.entries.map(e => byId.get(e.id) ?? e) }));

    // Restores each entry's own original cookedAt, not just the opposite of
    // `cooked` — same reasoning as bulkMoveEntries' `originals`. Never touches
    // recipe cookCount either direction, matching bulkSetCooked itself.
    get().setLastAction({
      label: cooked
        ? `${toUpdate.length} meal${toUpdate.length === 1 ? '' : 's'} marked cooked`
        : `${toUpdate.length} meal${toUpdate.length === 1 ? '' : 's'} marked not cooked`,
      undo: () => {
        toUpdate.forEach(dbUpdateMealPlanEntry);
        const originalById = new Map(toUpdate.map(e => [e.id, e]));
        set(s => ({ entries: s.entries.map(e => originalById.get(e.id) ?? e) }));
      },
    });
  },

  stampAddedToList(weekStartKey) {
    const next = { ...get().addedToListAt, [weekStartKey]: new Date().toISOString() };
    dbSetMealPlanAddedToList(next);
    set({ addedToListAt: next });
  },

  purgeOldEntries() {
    const cutoff = mealPlanPurgeCutoffKey();
    const removed = dbPurgeOldMealPlanEntries(cutoff);
    if (removed > 0) {
      // The loaded window can overlap the horizon (someone paging back through
      // spring), so memory has to follow the delete rather than wait for the
      // next load.
      set(s => ({ entries: s.entries.filter(e => e.date >= cutoff) }));
    }

    // Bounds the stamp map the same way the prune bounds entries — nothing
    // else ever removes a key from it, so without this it would grow for as
    // long as the user keeps adding weeks to their list.
    const stamps = get().addedToListAt;
    const trimmed = Object.fromEntries(Object.entries(stamps).filter(([key]) => key >= cutoff));
    if (Object.keys(trimmed).length !== Object.keys(stamps).length) {
      dbSetMealPlanAddedToList(trimmed);
      set({ addedToListAt: trimmed });
    }

    return removed;
  },
}));

type SetState = (fn: (s: { entries: MealPlanEntry[] }) => { entries: MealPlanEntry[] }) => void;

/**
 * Adds a written row to `entries` only when its day falls inside the loaded
 * window — the invariant that makes this store range-scoped rather than a
 * partial copy of the table that grows every time you plan something offscreen.
 */
function patchInRange(
  set: SetState,
  get: () => MealPlanStore,
  entry: MealPlanEntry
): void {
  const { rangeStart, rangeEnd } = get();
  if (!rangeStart || !rangeEnd || !isKeyInRange(entry.date, rangeStart, rangeEnd)) return;
  set(s => ({ entries: sortMealEntries([...s.entries, entry]) }));
}
