import { create } from 'zustand';
import type { MealPlanEntry, MealSlot, Task } from '../types';
import {
  dbGetMealPlanEntries,
  dbGetMealPlanEntry,
  dbInsertMealPlanEntry,
  dbUpdateMealPlanEntry,
  dbDeleteMealPlanEntry,
  dbPurgeOldMealPlanEntries,
  dbGetMealPlanAddedToList,
  dbSetMealPlanAddedToList,
} from '../db/database';
// useTaskStore imports this module back (its initialize() fans out to every
// store), so these two form an import cycle. It's inert: neither module touches
// the other while it's being evaluated — every reference below is inside an
// action body, by which time both have finished loading. Same shape as
// useGroceryStore reaching into useRecipeStore.
import { useTaskStore } from './useTaskStore';
import { useSettingsStore } from './useSettingsStore';
import { useRecipeStore } from './useRecipeStore';
import { useGroceryStore } from './useGroceryStore';
import { cookTaskDraft, cookTaskFields, cookTaskNeedsUpdate, wantsCookTask } from '../utils/mealTasks';
import { liveGeneratedTask } from '../utils/generatedTasks';
import { dropGeneratedTask, reconcileGeneratedTask } from './generatedTaskSync';
import { syncMealEvent } from '../utils/mealCalendarSync';
import { deleteCalendarEvent } from '../utils/calendarSync';
import { classifyPlanned, consumedRows, plannedIngredientsForRecipe } from '../utils/mealPlanGroceries';
import { standingSwapMap } from '../utils/standingSwaps';
import { generateId } from '../utils/id';
import { normalizeScale } from '../utils/recipeScale';
import { mealCookCounts, type CookingWindow, type MealCookCounts } from '../utils/cookingStats';
import {
  cleanMealTitle,
  isKeyInRange,
  mealPlanPurgeCutoffKey,
  nextSortOrder,
  resolveBulkMoveTargets,
  shiftDayKey,
  sortMealEntries,
  weekCopyDrafts,
} from '../utils/mealPlan';
import { countPlannedSlots } from '../utils/mealPlanNudge';
import { dayKeyToDate } from '../utils/dateUtils';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';

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
  /** See useTaskStore's UndoableAction — same flag, same UndoBar. */
  destructive?: boolean;
}

export interface MealPlanDraft {
  date: string;
  slot: MealSlot;
  /** Null for a free-text meal — a first-class answer, not a skipped step. */
  recipeId?: string | null;
  /** Set when the plan is "eat the chilli that's in the fridge". Null otherwise. */
  leftoverId?: string | null;
  title: string;
  /**
   * An explicit answer to "does this one get a Cook task?", for the callers
   * that have one at plan time. Omitted (or null) leaves it to the setting —
   * see MealPlanEntry.cookTask.
   */
  cookTask?: boolean | null;
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
/**
 * What the post-cook "out of anything?" offer needs to name its subject and
 * recompute its own lines: the dish, and the two things about *this* cooking
 * that decide which ingredients it actually used (which side was made, and how
 * much of it). Carried by value rather than as an entry id because the entry is
 * not the subject — the question is about the recipe that was cooked, and it
 * survives that night's row being edited or deleted out from under it.
 */
export interface CookedOffer {
  recipeId: string;
  /** For the banner's wording. The recipe's own name at the time it was cooked. */
  recipeName: string;
  choices: string[];
  scale: number;
}

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
   * The meal just marked cooked, when there is something worth asking whether
   * it used up — the subject of CookedUseUpOffer's banner.
   *
   * **It lives in the store rather than on the meal plan screen**, which is the
   * one structural difference from the restock offer next to it. Cooking is the
   * only moment this app learns something was *consumed*, and a meal can be
   * ticked off from Today as readily as from the plan (`setCookedPaired`); a
   * signal that important shouldn't depend on which screen the tap happened to
   * land on. The restock offer stays screen-local because buying is a meal-plan
   * question with two other entry points already.
   *
   * Set only where a *person* said they cooked one meal — `setCooked`, and so
   * `setCookedPaired` through it. Deliberately **not** `bulkSetCooked`:
   * marking last week's five dinners cooked on a Sunday is bookkeeping, and
   * asking what each of them used up would be asking someone to recall five
   * kitchens. Un-cooking retracts it, since the tap it was about is undone.
   *
   * Session-only, like the restock offer: it's about a tap you just made, so
   * there is nothing for it to mean on the next launch.
   */
  cookedOffer: CookedOffer | null;
  /**
   * Dismissed by hand, or retired by the banner once every line it could name
   * has been answered. Both are "there is no longer anything to ask", which is
   * also what un-suppresses the restock banner behind it.
   */
  clearCookedOffer: () => void;

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

  /**
   * How many of each day's three meals are planned, keyed by day key — what the
   * weekly nudge's per-day tasks show as "2/3 planned" (#1585). A day with no
   * key here is one nothing has asked about, and its row shows no counter at
   * all rather than a 0 it can't stand behind.
   *
   * **Deliberately outside the window contract**, and the second piece of state
   * in this store that is (`addedToListAt` is the other). `entries` is a single
   * shared window that MealPlanScreen owns; a nudge task sits on *Today*, in a
   * week that screen usually hasn't loaded and often can't — the tasks fire on
   * a Sunday for the week after, which is never the week on screen. Reading the
   * window for them would report 0/3 across a fully planned week, and 0/3 is
   * exactly the state the row is meant to draw attention to. Calling loadRange
   * to fix that is the thing `selectTodayMealEntries` documents at length as
   * not doing: it would clobber whichever week Meal plan has open, on a hidden
   * tab that stays mounted and never reloads (see `enableScreens(false)`).
   *
   * So it's a separate, tiny read — seven integers, no rows retained — and it's
   * a snapshot rather than a subscription, refreshed by `refreshPlannedSlotCounts`.
   */
  plannedSlotCounts: Record<string, number>;

  /**
   * Recounts the given days from SQLite, replacing the map wholesale.
   *
   * Callers pass exactly the days they want counted (the live nudge tasks'), so
   * the map never grows past what something is rendering, and days that stop
   * being asked about fall out on the next call rather than accumulating for
   * the life of the install.
   *
   * **Pull, not push.** Every one of this store's ~15 mutators would otherwise
   * need a line to keep this in step — the "four call sites and still missed
   * one" shape that the stack's `completedAt` stamp was deleted for. Nothing
   * writes it on the way past; the reader refreshes when it's about to be seen
   * (see `useMealPlanNudgeProgress`), which also covers the writes this store
   * never sees at all: a restored backup, a demo swap, another device's sync.
   *
   * Returns without a `set` when the counts are unchanged, so the refresh can
   * be wired to something that fires often without re-rendering every nudge row
   * each time an unrelated meal moves.
   */
  refreshPlannedSlotCounts: (dayKeys: readonly string[]) => void;

  /**
   * What the last month of the plan says about cooking — the meal half of the
   * Stats screen's cooking section (#1367). Null until something has asked,
   * which is a third answer and renders no section rather than a row of zeroes,
   * the same call `plannedSlotCounts` makes about an absent count.
   *
   * **Deliberately outside the window contract**, for the same reason and by
   * the same mechanism as `plannedSlotCounts` above: Stats is a hidden tab
   * asking about a rolling 30 days, which is never the week MealPlanScreen has
   * open, and `loadRange`ing to fetch it would clobber that screen's window on
   * a tab that stays mounted and never reloads (`enableScreens(false)`).
   *
   * Counts, not rows — the read is a month of entries but nothing keeps them,
   * so this stays four integers however much someone plans.
   */
  cookingCounts: MealCookCounts | null;

  /**
   * Recounts `cookingCounts` from SQLite over the given window.
   *
   * **Pull, not push**, like the refresh above it: the reader calls this when
   * the section is about to be seen, so none of this store's ~15 mutators needs
   * a line to keep it in step, and the writes this store never sees at all (a
   * restored backup, a demo swap) are covered for free.
   *
   * Returns without a `set` when nothing moved, so wiring it to a screen focus
   * doesn't re-render on every visit.
   */
  refreshCookingCounts: (window: CookingWindow) => void;

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
   * Records that this meal is being cooked at some multiple of the recipe —
   * see MealPlanEntry.recipeScale. Clamped through normalizeScale, so a caller
   * passing 0 sets as-written rather than nothing.
   *
   * Allowed on an already-cooked entry for the same reason setRecipeChoices is:
   * it's a note about the meal, and nothing downstream counts it.
   */
  setRecipeScale: (id: string, scale: number) => void;

  /**
   * Stamps or clears cookedAt. Idempotent per entry — an entry already in the
   * target state isn't written again, which is what keeps the recipe's
   * cookCount (bumped separately by the caller via useRecipeStore.markCooked)
   * to one bump per cooking.
   *
   * **Reversible, as the bulk form always was.** It used to be one-way here
   * and two-way in the bulk bar, so the only way back from a mis-tap on a row
   * was to enter selection mode, select that one meal, and use "Uncook"
   * (#1361). Registering no undo made it worse: a shake after the mis-tap
   * offered some unrelated earlier action instead.
   *
   * Registers no `lastAction` of its own — the caller does, because marking a
   * meal cooked is two writes (this and the recipe's counters) and only the
   * caller knows they were one action. See MealPlanScreen's setCooked.
   */
  setCooked: (id: string, cooked: boolean) => void;

  /**
   * Says whether this meal gets a "Cook X" task, or hands the decision back to
   * the `mealCookTasks` setting with `null` (#1402).
   *
   * Writes the flag and then reconciles, so the task appears or disappears on
   * the same tap. The one caller that passes `false` without the user having
   * touched a toggle is `useTaskStore.deleteTask` — deleting the task *is* the
   * user saying no to it, and recording that is what stops the next edit to
   * this meal reconciling it straight back.
   */
  setCookTask: (id: string, value: boolean | null) => void;

  /**
   * "Cooked" as a single user action: stamps `cookedAt` **and** bumps the
   * recipe's counters, returning an undo that reverses both — the same pairing,
   * and the same asymmetry about counters, that MealPlanScreen's own `setCooked`
   * composes by hand (see its doc comment: undo restores `lastCookedAt`, a
   * plain un-tick never does). It lives here rather than in a screen because the
   * pairing is a fact about meals, and it *returns* the undo rather than
   * registering one because the caller knows what the user actually did and owns
   * the label — see `setLastAction`.
   *
   * Two callers, neither of them the meal plan: `useTaskStore.completeTask`,
   * for the "Cook X" task ticked off on Today (#1402), and Today's own meal row
   * for a meal that never got one (a leftover, a takeaway, a dinner typed by
   * hand — see `mealContextRows`). It was `setCookedFromTask` while the task was
   * the only way in; the pairing was never about tasks.
   *
   * Resolves the entry through SQLite when it isn't in the loaded window,
   * which is the normal case: ticking a meal off on Today says nothing about
   * which week Meal plan happens to have open, and on a cold start it has none.
   *
   * Returns null when there was nothing to do — no such entry, or it already
   * says what's being asked — so the caller stores no undo for a no-op.
   */
  setCookedPaired: (id: string, cooked: boolean) => (() => void) | null;

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

  /**
   * Deletes every named entry. Confirmation and copy live in the screen, same
   * as removeEntry's single-row delete.
   *
   * **Clears `lastAction` rather than merely declining to set one.** Not
   * offering an undo only holds if there isn't one left lying around: the
   * queue survives for UNDO_ACTION_MAX_AGE_MS, so a delete performed shortly
   * after any other meal-plan action would leave *that* action armed, and a
   * shake right after "This can't be undone" would offer to undo something
   * else entirely — restoring a meal the user never asked about while every
   * deletion stayed gone. Declining the slot means emptying it.
   */
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
   *
   * `recipeScale` is left untouched too, which is the deliberate asymmetry with
   * `recipeChoices`: a choice group belongs to the recipe that defined it and
   * can't survive a swap, but "I'm feeding eight on Sunday" is a fact about the
   * night and stays true whichever dish lands on it.
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

  /**
   * Copies a whole week onto another one, shifting every entry by the gap
   * between the two week starts. Returns how many rows were written.
   *
   * Reads the source out of SQLite rather than out of `entries`: the week
   * being copied *from* is by definition not the one on screen, so it is
   * never the loaded window. What carries and what doesn't is
   * `weekCopyDrafts`' call, not this one's.
   *
   * One `lastAction` for the whole copy, removing every row it wrote — the
   * same "one action, one undo" the bulk methods keep. A copy that had to be
   * undone seven times would be worse than no undo at all.
   */
  copyWeek: (fromStartKey: string, toStartKey: string) => number;

  /**
   * The start of the most recent week at or before `beforeStartKey` that has
   * anything planned in it, looking back at most `maxWeeksBack` weeks — or
   * null if they're all empty.
   *
   * Searches rather than assuming "last week", because a week that was itself
   * empty is nothing to copy: someone who plans fortnightly, or who is coming
   * back after a holiday, would otherwise be offered a copy of nothing. The
   * caller names whatever this finds (see describeWeekRange), so the offer
   * always says which week it means rather than saying "last week" and being
   * wrong.
   */
  findPlannedWeekBefore: (beforeStartKey: string, maxWeeksBack: number) => string | null;

  /** Enforces the 180-day horizon. Returns how many rows went. */
  purgeOldEntries: () => number;
}

export const useMealPlanStore = create<MealPlanStore>((set, get) => ({
  entries: [],
  rangeStart: null,
  rangeEnd: null,
  addedToListAt: {},
  plannedSlotCounts: {},
  cookingCounts: null,
  initialized: false,
  lastAction: null,
  cookedOffer: null,

  clearCookedOffer() {
    set({ cookedOffer: null });
  },

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
    // cookingCounts goes back to "nobody has looked" rather than being
    // recounted here: this runs on every database swap (demo, restore), and a
    // count carried across describes a database that no longer exists. Its
    // reader refreshes on focus, so the cost of clearing it is one render with
    // no section rather than one render of the wrong numbers.
    if (rangeStart && rangeEnd) {
      set({
        entries: sortMealEntries(dbGetMealPlanEntries(rangeStart, rangeEnd)),
        addedToListAt,
        cookingCounts: null,
        initialized: true,
      });
      return;
    }
    // Nothing has asked for a window yet, so there is nothing to hold. The
    // screen loads its own on mount.
    set({ entries: [], addedToListAt, cookingCounts: null, initialized: true });
  },

  loadRange(startKey, endKey) {
    set({
      entries: sortMealEntries(dbGetMealPlanEntries(startKey, endKey)),
      rangeStart: startKey,
      rangeEnd: endKey,
    });
  },

  refreshPlannedSlotCounts(dayKeys) {
    const current = get().plannedSlotCounts;
    if (dayKeys.length === 0) {
      // Nothing is asking any more — the last nudge task was completed or the
      // generator turned off. Drop the map rather than leaving the final week's
      // counts behind for whatever renders next.
      if (Object.keys(current).length > 0) set({ plannedSlotCounts: {} });
      return;
    }

    // One range read over the whole span rather than a query per day: the keys
    // are a week, and `date` is what the table is indexed on.
    const sorted = [...dayKeys].sort();
    const rows = dbGetMealPlanEntries(sorted[0], sorted[sorted.length - 1]);

    const next: Record<string, number> = {};
    for (const dayKey of dayKeys) next[dayKey] = countPlannedSlots(rows, dayKey);

    const keys = Object.keys(next);
    const unchanged =
      keys.length === Object.keys(current).length &&
      keys.every(key => current[key] === next[key]);
    if (unchanged) return;

    set({ plannedSlotCounts: next });
  },

  refreshCookingCounts(window) {
    const next = mealCookCounts(
      dbGetMealPlanEntries(window.startKey, window.endKey),
      window
    );
    const current = get().cookingCounts;
    const unchanged =
      current !== null &&
      current.days === next.days &&
      current.daysCooked === next.daysCooked &&
      current.planned === next.planned &&
      current.plannedCooked === next.plannedCooked;
    if (unchanged) return;

    set({ cookingCounts: next });
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
      // As written, for the same reason: how much of it you're making is a
      // question a plan is allowed not to have answered.
      recipeScale: 1,
      // Unanswered, so the setting decides — see MealPlanEntry.cookTask. The
      // picker can pass an explicit answer, which is how "add a cook task" is
      // said at plan time.
      cookTask: draft.cookTask ?? null,
      // Nothing on the device yet. reconcileMealEvent below writes the id
      // back if a calendar is picked.
      calendarEventId: null,
    };

    dbInsertMealPlanEntry(entry);
    patchInRange(set, get, entry);
    reconcileCookTask(entry);
    reconcileMealEvent(entry);
    get().setLastAction({
      label: `Planned "${entry.title}"`,
      undo: () => {
        dropCookTask(entry.id);
        dropMealEvent(entry.id);
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
    // Moving the meal moves its cook task: the day and the slot are two of the
    // three fields the entry owns on it. The calendar event carries both too —
    // the day it sits on and the slot in its title.
    reconcileCookTask(moved);
    reconcileMealEvent(moved);
    get().setLastAction({
      label: `Moved "${entry.title}"`,
      undo: () => {
        dbUpdateMealPlanEntry(entry);
        set(s => ({ entries: sortMealEntries(s.entries.filter(e => e.id !== id)) }));
        patchInRange(set, get, entry);
        reconcileCookTask(entry);
        reconcileMealEvent(entry);
      },
    });
  },

  removeEntry(id) {
    const entry = get().entries.find(e => e.id === id);
    // Before the row goes: the meal is the only thing that knows this task was
    // its. A cook task already completed is left alone — it's history now, the
    // same call deleteGroup makes about a stack's past occurrences.
    dropCookTask(id);
    dropMealEvent(id);
    dbDeleteMealPlanEntry(id);
    set(s => ({ entries: s.entries.filter(e => e.id !== id) }));
    if (entry) {
      get().setLastAction({
        label: `Removed "${entry.title}"`,
        destructive: true,
        undo: () => {
          dbInsertMealPlanEntry(entry);
          patchInRange(set, get, entry);
          reconcileCookTask(entry);
          reconcileMealEvent(entry);
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
    reconcileCookTask(renamed);
    reconcileMealEvent(renamed);
    // The only single-entry mutation here that used to write without one.
    get().setLastAction({
      label: `Renamed "${entry.title}"`,
      undo: () => {
        dbUpdateMealPlanEntry(entry);
        set(s => ({ entries: s.entries.map(e => e.id === id ? entry : e) }));
        reconcileCookTask(entry);
        reconcileMealEvent(entry);
      },
    });
  },

  setRecipeChoices(id, recipeChoices) {
    const entry = get().entries.find(e => e.id === id);
    if (!entry) return;
    const chosen: MealPlanEntry = { ...entry, recipeChoices };
    dbUpdateMealPlanEntry(chosen);
    set(s => ({ entries: s.entries.map(e => e.id === id ? chosen : e) }));
  },

  setRecipeScale(id, scale) {
    const entry = get().entries.find(e => e.id === id);
    if (!entry) return;
    const next = normalizeScale(scale);
    if (next === normalizeScale(entry.recipeScale)) return;
    const scaled: MealPlanEntry = { ...entry, recipeScale: next };
    dbUpdateMealPlanEntry(scaled);
    set(s => ({ entries: s.entries.map(e => e.id === id ? scaled : e) }));
  },

  setCooked(id, cooked) {
    // Resolved through SQLite when it isn't in the loaded window. The `.map`
    // below is then a no-op, which is exactly right: an entry outside the
    // window has no business being added to `entries` (see patchInRange), and
    // the next loadRange reads the written row.
    const entry = resolveEntry(get, id);
    if (!entry || !!entry.cookedAt === cooked) return;
    const next: MealPlanEntry = { ...entry, cookedAt: cooked ? new Date().toISOString() : null };
    dbUpdateMealPlanEntry(next);
    set(s => ({ entries: s.entries.map(e => e.id === id ? next : e) }));
    set({ cookedOffer: cooked ? useUpOfferFor(next) : null });
    // Ticking the meal ticks its task, and un-ticking un-ticks it. The
    // ping-pong this would otherwise cause is broken by the guard above plus
    // the one in completeTask: whichever side moves first has already written
    // its own state by the time the other calls back, so the callee returns
    // early. Don't remove either guard.
    syncCookTaskCompletion(id, cooked);
  },

  setCookTask(id, value) {
    const entry = resolveEntry(get, id);
    if (!entry || entry.cookTask === value) return;
    const next: MealPlanEntry = { ...entry, cookTask: value };
    dbUpdateMealPlanEntry(next);
    set(s => ({ entries: s.entries.map(e => e.id === id ? next : e) }));
    reconcileCookTask(next);
  },

  setCookedPaired(id, cooked) {
    const entry = resolveEntry(get, id);
    if (!entry || !!entry.cookedAt === cooked) return null;

    get().setCooked(id, cooked);

    // Only a cooking bumps the recipe, exactly as MealPlanScreen's setCooked
    // has it — un-ticking is "not cooked now", and cookCount only ever rises.
    const recipe = cooked && entry.recipeId
      ? useRecipeStore.getState().recipes.find(r => r.id === entry.recipeId)
      : undefined;
    const before = recipe ? useRecipeStore.getState().markCooked(recipe.id) : null;

    return () => {
      get().setCooked(id, !cooked);
      if (recipe && before) useRecipeStore.getState().restoreCookStats(recipe.id, before);
    };
  },

  bulkDeleteEntries(ids) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    ids.forEach(dropCookTask);
    ids.forEach(dropMealEvent);
    ids.forEach(id => dbDeleteMealPlanEntry(id));
    // lastAction: null — see the doc comment. The delete registers no undo of
    // its own *and* takes the slot away from whatever was in it, so a shake
    // after this can't offer an unrelated action the user has moved on from.
    set(s => ({ entries: s.entries.filter(e => !idSet.has(e.id)), lastAction: null }));
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
    moved.forEach(reconcileCookTask);
    moved.forEach(reconcileMealEvent);

    get().setLastAction({
      label: `${moved.length} meal${moved.length === 1 ? '' : 's'} moved`,
      undo: () => {
        originals.forEach(dbUpdateMealPlanEntry);
        set(s => ({ entries: sortMealEntries(s.entries.filter(e => !movedIds.has(e.id))) }));
        originals.forEach(entry => patchInRange(set, get, entry));
        originals.forEach(reconcileCookTask);
        originals.forEach(reconcileMealEvent);
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
    // Retitles the cook tasks, and can create or remove them outright: swapping
    // a free-text night for a recipe is exactly the change that makes a meal
    // qualify. `cookTask` is deliberately kept by the replace (see the note on
    // recipeScale surviving a swap for the same reason), so an explicit
    // per-meal answer isn't quietly undone by changing what's cooked.
    updated.forEach(reconcileCookTask);
    updated.forEach(reconcileMealEvent);

    get().setLastAction({
      label: `${updated.length} meal${updated.length === 1 ? '' : 's'} replaced`,
      undo: () => {
        toUpdate.forEach(dbUpdateMealPlanEntry);
        const originalById = new Map(toUpdate.map(e => [e.id, e]));
        set(s => ({ entries: s.entries.map(e => originalById.get(e.id) ?? e) }));
        toUpdate.forEach(reconcileCookTask);
        toUpdate.forEach(reconcileMealEvent);
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
    updated.forEach(e => syncCookTaskCompletion(e.id, cooked));

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
        toUpdate.forEach(e => syncCookTaskCompletion(e.id, !!e.cookedAt));
      },
    });
  },

  stampAddedToList(weekStartKey) {
    const next = { ...get().addedToListAt, [weekStartKey]: new Date().toISOString() };
    dbSetMealPlanAddedToList(next);
    set({ addedToListAt: next });
  },

  copyWeek(fromStartKey, toStartKey) {
    const source = dbGetMealPlanEntries(fromStartKey, shiftDayKey(fromStartKey, 6));
    const shift = differenceInCalendarDays(dayKeyToDate(toStartKey), dayKeyToDate(fromStartKey));
    const drafts = weekCopyDrafts(source, shift);
    if (drafts.length === 0) return 0;

    const created: MealPlanEntry[] = drafts.map(draft => ({
      ...draft,
      id: generateId(),
      createdAt: new Date().toISOString(),
      // Its own event, never the source week's — see MealCopyDraft.
      calendarEventId: null,
    }));
    created.forEach(dbInsertMealPlanEntry);
    created.forEach(entry => patchInRange(set, get, entry));
    created.forEach(reconcileCookTask);
    created.forEach(reconcileMealEvent);

    const ids = new Set(created.map(e => e.id));
    get().setLastAction({
      label: `Copied ${created.length} meal${created.length === 1 ? '' : 's'}`,
      undo: () => {
        created.forEach(e => dropCookTask(e.id));
        created.forEach(e => dropMealEvent(e.id));
        created.forEach(e => dbDeleteMealPlanEntry(e.id));
        set(s => ({ entries: s.entries.filter(e => !ids.has(e.id)) }));
      },
    });
    return created.length;
  },

  findPlannedWeekBefore(beforeStartKey, maxWeeksBack) {
    for (let back = 1; back <= maxWeeksBack; back += 1) {
      const start = shiftDayKey(beforeStartKey, -7 * back);
      if (dbGetMealPlanEntries(start, shiftDayKey(start, 6)).length > 0) return start;
    }
    return null;
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

/**
 * One entry by id, from the loaded window if it's there and from SQLite if it
 * isn't.
 *
 * Every other read in this store is deliberately window-scoped, and stays that
 * way. This exists for the cook-task link alone, which is inherently
 * cross-screen: a task ticked off on Today knows its entry's id and nothing
 * about which week Meal plan has open — usually none at all, since the store
 * only loads a range once that screen has been visited.
 */
function resolveEntry(get: () => MealPlanStore, id: string): MealPlanEntry | null {
  return get().entries.find(e => e.id === id) ?? dbGetMealPlanEntry(id);
}

/**
 * The offer a just-cooked meal raises, or null when there's nothing to ask.
 *
 * **Gated on there being at least one line to name**, exactly as the restock
 * banner is gated on `restockRows` — an offer that exists but shows nothing
 * would be indistinguishable from one that hasn't been dismissed, and the
 * screen suppresses the restock banner while this is set. `consumedRows` is
 * what it can defend: the lines the app is already claiming you have.
 *
 * The count isn't stored. It's recomputed live by the banner off the same
 * three utils, so answering the questions empties the set and retires the
 * offer — the same "hidden rather than hedged" call the restock banner makes,
 * and what makes the two hand over to each other with no plumbing between them.
 *
 * Reads two other stores at write time, like `setCookedPaired` reaching into
 * `useRecipeStore` just below. A free-text meal has no recipe and so no
 * ingredients, which is not an error — just a meal with nothing to ask about.
 */
function useUpOfferFor(entry: MealPlanEntry): CookedOffer | null {
  if (!entry.recipeId) return null;
  const recipes = useRecipeStore.getState().recipes;
  const recipe = recipes.find(r => r.id === entry.recipeId);
  if (!recipe) return null;

  const recipesById = new Map(recipes.map(r => [r.id, r]));
  const scale = normalizeScale(entry.recipeScale);
  // Swapped: what a cook used up is what they actually cooked with, so a
  // standing "oat milk for milk" asks after the oat milk.
  const { items, itemSubs } = useGroceryStore.getState();
  const rows = consumedRows(
    classifyPlanned(
      plannedIngredientsForRecipe(
        recipe, recipesById, { chosen: entry.recipeChoices }, scale, standingSwapMap(itemSubs, items)
      ),
      items,
      new Date()
    )
  );
  if (rows.length === 0) return null;

  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    choices: [...entry.recipeChoices],
    scale,
  };
}

// ─── Cook tasks (#1402) ─────────────────────────────────────────────────────
//
// The meal plan is the master and the task is the replica; these helpers are
// every write that crosses the line. The projection rules themselves — which
// meals qualify, what the task says, which fields the meal owns — are in
// utils/mealTasks so jest can reach them, and the create/update/delete
// machinery they feed is shared with the other three generators in
// store/generatedTaskSync (#1524).

/** This meal's live cook task, if it has one. */
function liveCookTaskFor(entryId: string): Task | undefined {
  return liveGeneratedTask(useTaskStore.getState().tasks, 'mealCook', entryId);
}

/**
 * Brings this meal's cook task into line: creates it, updates it, or removes
 * it, depending on what the meal now says.
 *
 * **A cooked meal is left entirely alone.** Its task has either been ticked
 * (that's what cooked it) or is deliberately outstanding, and either way the
 * night has happened — re-dating or re-titling the task at that point edits
 * history. This is also what stops a completed cook task from being replaced
 * by a fresh one on the next edit. It's the one gate `reconcileGeneratedTask`
 * knows nothing about, because "cooked" is a fact about a meal.
 *
 * **It never spawns a second task for one meal**, even when the existing one
 * is completed or archived — that's `blocksOnFinished`, and cook tasks are the
 * only generator that sets it. A meal is one event; see `hasAnyGeneratedTask`
 * for why a grocery item and a leftover answer the opposite way.
 */
function reconcileCookTask(entry: MealPlanEntry): void {
  if (entry.cookedAt) return;

  const { mealCookTasks, mealCookTaskCategory } = useSettingsStore.getState();
  reconcileGeneratedTask({
    kind: 'mealCook',
    sourceId: entry.id,
    wanted: wantsCookTask(entry, mealCookTasks),
    drift: existing => (cookTaskNeedsUpdate(existing, entry) ? cookTaskFields(entry) : null),
    draft: () => cookTaskDraft(entry, mealCookTaskCategory),
    blocksOnFinished: true,
  });
}

/**
 * Drops this meal's cook task because the meal itself is going.
 *
 * Deliberately not `reconcileCookTask` with the flag off: that records an
 * opt-out, which is meaningless for a row about to stop existing, and it would
 * also skip the delete entirely for an entry that had already been cooked.
 * Completed cook tasks stay either way — deleting a meal must not erase the
 * Logbook, the same rule deleteGroup keeps for a stack's history.
 */
function dropCookTask(entryId: string): void {
  dropGeneratedTask('mealCook', entryId);
}

/**
 * Ticks this meal's cook task off, or back on, to match the meal.
 *
 * The other half of the loop-breaking pair described on `setCooked`: both
 * `completeTask` and `uncompleteTask` return early when the task is already in
 * the state being asked for, so the call back into this store is a no-op.
 */
function syncCookTaskCompletion(entryId: string, cooked: boolean): void {
  const { tasks, completeTask, uncompleteTask } = useTaskStore.getState();
  if (cooked) {
    const live = liveCookTaskFor(entryId);
    if (live) completeTask(live.id);
    return;
  }
  // Deliberately not liveGeneratedTask: this one wants the *completed* task, to
  // untick it. Archived rows stay excluded — see liveGeneratedTask's note.
  const done = tasks.find(
    t => t.generatedKind === 'mealCook' && t.generatedSourceId === entryId
      && t.completed && !t.archived
  );
  if (done) uncompleteTask(done.id);
}

// ─── Calendar events (#1494) ────────────────────────────────────────────────
//
// The third replica of the same master, and the plumbing half of it: the rules
// for what a meal's event says, and whether it should have one at all, are in
// utils/mealCalendarSync so jest can reach them without a native module.

/**
 * Brings this meal's device calendar event in line with the meal,
 * fire-and-forget — the same shape as `reconcileDeadlineEvent` in
 * useTaskStore, and for the same reason: the write is async and best-effort,
 * so nothing here awaits it and a failure is retried on the next reconcile
 * rather than surfaced.
 *
 * The two guards are what keep it cheap: most reconciles hand back the id the
 * entry already has and write nothing, and an entry deleted while the device
 * write was in flight is left alone rather than resurrected in SQLite.
 */
function reconcileMealEvent(entry: MealPlanEntry): void {
  syncMealEvent(entry)
    .then(calendarEventId => {
      if (calendarEventId === entry.calendarEventId) return;
      const current = resolveEntry(useMealPlanStore.getState, entry.id);
      if (!current) return;
      const updated = { ...current, calendarEventId };
      dbUpdateMealPlanEntry(updated);
      useMealPlanStore.setState(s => ({
        entries: s.entries.map(e => (e.id === entry.id ? updated : e)),
      }));
    })
    .catch(() => {});
}

/**
 * Deletes this meal's event because the meal itself is going.
 *
 * Deliberately not `reconcileMealEvent` on a copy with the calendar unset:
 * the row is about to stop existing, so there is nothing left to write the
 * cleared id back onto, and nothing will ever revisit it to notice a dangling
 * event. Same call `deleteTask` makes about a task's own calendar event.
 *
 * **Takes an id and re-resolves the row, rather than trusting a caller's
 * copy.** `reconcileMealEvent` writes the id back asynchronously, so an entry
 * captured in an undo closure — every caller here is one — is very likely to
 * predate the write and carry a null where the event id now is. Reading it
 * back at call time is what stops that leaking the event permanently. Must
 * still be called *before* the row is deleted, same as `dropCookTask`.
 */
function dropMealEvent(entryId: string): void {
  const current = resolveEntry(useMealPlanStore.getState, entryId);
  if (current?.calendarEventId) deleteCalendarEvent(current.calendarEventId);
}
