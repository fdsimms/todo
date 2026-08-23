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
import { generatedTaskCountOf, hasAnyGeneratedTask, liveGeneratedTask } from '../utils/generatedTasks';
import { derivedId, spawnSeed } from '../utils/syncIds';
import { ensureGeneratedTaskCategory } from './useCategoryStore';
import { deleteGeneratedTaskQuietly, dropGeneratedTask } from './generatedTaskSync';
import { syncMealEvent } from '../utils/mealCalendarSync';
import { deleteCalendarEvent } from '../utils/calendarSync';
import {
  classifyPlanned,
  consumedRows,
  plannedIngredientsForRecipe,
  type ClassifiedIngredient,
} from '../utils/mealPlanGroceries';
import { standingSwapMap } from '../utils/standingSwaps';
import { generateId } from '../utils/id';
import { normalizeScale } from '../utils/recipeScale';
import { mealCookCounts, type CookingWindow, type MealCookCounts } from '../utils/cookingStats';
import { totalMinutes } from '../utils/recipeUtils';
import {
  cleanMealTitle,
  entriesForSlot,
  isKeyInRange,
  mealPlanPurgeCutoffKey,
  nextSortOrder,
  recipeIndex,
  resolveBulkMoveTargets,
  shiftDayKey,
  sortMealEntries,
  titleForEntry,
  weekCopyDrafts,
} from '../utils/mealPlan';
import { countPlannedSlots } from '../utils/mealPlanNudge';
import { mealSlotDrift, mealSlotSourceId, mealSlotTaskDraft } from '../utils/mealSlotTasks';
import { dayKeyOf, dayKeyToDate, getLogicalToday } from '../utils/dateUtils';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { setHours } from 'date-fns/setHours';

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

/**
 * The meal a just-ticked "Cook X" task left behind, and everything the log
 * sheet needs to open on it — the subject of `LogLeftoversOffer`'s banner.
 *
 * **Set only from `setCookedPaired`, which is the task side of the tick.** The
 * meal plan already puts "Log leftovers" on the entry's own sheet, and that
 * placement is deliberate (see `MealPlanScreen.logLeftoversFor`: not every meal
 * leaves any, so nothing about marking one cooked should assume it did). The
 * task list had no such action at all — ticking "Cook Chili" off Today finished
 * the cooking and said nothing about the two tubs on the counter, and the only
 * way to record them was to go and find the meal on the plan. So this is that
 * one action, reached from the side that was missing it.
 *
 * It's an offer rather than a sheet for exactly the reason the entry action is
 * an action: a modal opening uninvited after every cooking is a second one
 * chasing the ingredients question. `OfferBanner` is the tier the app
 * already settled on for this.
 *
 * Carried by value like `CookedOffer` beside it, plus the `entryId` that
 * becomes `Leftover.sourceEntryId` — resolve-or-shrug, so the row being edited
 * or deleted out from under it costs the pointer and nothing else.
 *
 * Session-only, same as `cookedOffer`: it's about a tap you just made.
 */
export interface LeftoverOffer {
  entryId: string;
  /** The meal's name as it was cooked, which is what the container gets called. */
  title: string;
  recipeId: string | null;
  /** Which side of each either/or was made, so a losing component isn't offered. */
  choices: string[];
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
   * The meal a just-ticked cook task left behind — see `LeftoverOffer`.
   *
   * Ranked *behind* `cookedOffer` by the banner itself rather than by either
   * screen, because two of these side by side is the noise the passive
   * treatment exists to avoid, and the consumption question is the one that
   * retires itself the moment it's answered.
   */
  leftoverOffer: LeftoverOffer | null;
  /** Dismissed by hand, or once the log sheet it opened has been through. */
  clearLeftoverOffer: () => void;

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

  /**
   * Every meal ever marked cooked that hasn't been purged — the meal half of
   * the Logbook's cooking lens (#1779). Null until something has asked, the
   * same third answer `cookingCounts` and `plannedSlotCounts` keep.
   *
   * **Deliberately outside the window contract**, third and last of the reads
   * that are, and for the identical reason: the Logbook is a hidden tab asking
   * about the whole retention horizon, which is never the week MealPlanScreen
   * has open, and `loadRange`ing to fetch it would clobber that screen's window
   * on a tab that stays mounted and never reloads (`enableScreens(false)`).
   *
   * Rows, where `cookingCounts` keeps four integers — a per-row history has
   * nothing to reduce to. What bounds it is the filter rather than the range:
   * the read spans 180 days of plan and only the *cooked* rows are kept, so
   * this holds as many meals as the user has actually cooked, not as many as
   * they have planned.
   */
  cookHistory: MealPlanEntry[] | null;

  /**
   * Re-reads `cookHistory` over an inclusive day-key window.
   *
   * **Pull, not push**, like the two refreshes above it, and returning without
   * a `set` when nothing moved so wiring it to a screen focus doesn't re-render
   * the list on every visit.
   */
  refreshCookHistory: (startKey: string, endKey: string) => void;

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
  cookHistory: null,
  initialized: false,
  lastAction: null,
  cookedOffer: null,
  leftoverOffer: null,

  clearCookedOffer() {
    set({ cookedOffer: null });
  },

  clearLeftoverOffer() {
    set({ leftoverOffer: null });
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
    // cookingCounts and cookHistory go back to "nobody has looked" rather than
    // being re-read here: this runs on every database swap (demo, restore), and
    // either one carried across describes a database that no longer exists.
    // Both readers refresh on focus, so the cost of clearing them is one render
    // with no section rather than one render of the wrong rows.
    if (rangeStart && rangeEnd) {
      set({
        entries: sortMealEntries(dbGetMealPlanEntries(rangeStart, rangeEnd)),
        addedToListAt,
        cookingCounts: null,
        cookHistory: null,
        initialized: true,
      });
      return;
    }
    // Nothing has asked for a window yet, so there is nothing to hold. The
    // screen loads its own on mount.
    set({
      entries: [],
      addedToListAt,
      cookingCounts: null,
      cookHistory: null,
      initialized: true,
    });
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

  refreshCookHistory(startKey, endKey) {
    const next = dbGetMealPlanEntries(startKey, endKey).filter(entry => entry.cookedAt !== null);
    const current = get().cookHistory;
    // Compared on what a row is built from rather than by identity: the read
    // allocates fresh objects every time, so anything shallower than this would
    // never match and anything deeper would compare fields no row draws.
    const unchanged =
      current !== null &&
      current.length === next.length &&
      current.every((entry, i) => {
        const other = next[i];
        return (
          entry.id === other.id &&
          entry.date === other.date &&
          entry.slot === other.slot &&
          entry.title === other.title &&
          entry.recipeId === other.recipeId &&
          entry.cookedAt === other.cookedAt
        );
      });
    if (unchanged) return;

    set({ cookHistory: next });
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
    reconcileMealSlot(get, entry);
    reconcileMealEvent(entry);
    get().setLastAction({
      label: `Planned "${entry.title}"`,
      undo: () => {
        dropCookTask(entry.id);
        dropMealEvent(entry.id);
        dbDeleteMealPlanEntry(entry.id);
        set(s => ({ entries: s.entries.filter(e => e.id !== entry.id) }));
        // After the delete, never before: the slot's task reads the slot as it
        // now stands, and an emptied slot is what turns "Cook Chili" back into
        // "Choose dinner". Same ordering everywhere a meal is removed below.
        reconcileMealSlot(get, entry);
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
    reconcileMealSlot(get, moved);
    // And the slot it vacated — a move is two slots changing, and only one of
    // them is the one being moved to. Without this, dragging dinner to Friday
    // leaves Thursday's row still saying "Cook Chili" for a meal that isn't
    // there any more. A no-op when the move stayed inside one slot.
    reconcileMealSlot(get, entry);
    reconcileMealEvent(moved);
    get().setLastAction({
      label: `Moved "${entry.title}"`,
      undo: () => {
        dbUpdateMealPlanEntry(entry);
        set(s => ({ entries: sortMealEntries(s.entries.filter(e => e.id !== id)) }));
        patchInRange(set, get, entry);
        reconcileMealSlot(get, entry);
        reconcileMealSlot(get, moved);
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
    if (entry) reconcileMealSlot(get, entry);
    if (entry) {
      get().setLastAction({
        label: `Removed "${entry.title}"`,
        destructive: true,
        undo: () => {
          dbInsertMealPlanEntry(entry);
          patchInRange(set, get, entry);
          reconcileMealSlot(get, entry);
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
    reconcileMealSlot(get, renamed);
    reconcileMealEvent(renamed);
    // The only single-entry mutation here that used to write without one.
    get().setLastAction({
      label: `Renamed "${entry.title}"`,
      undo: () => {
        dbUpdateMealPlanEntry(entry);
        set(s => ({ entries: s.entries.map(e => e.id === id ? entry : e) }));
        reconcileMealSlot(get, entry);
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
    // One walk of the recipe answers both halves of a cooking: what to ask
    // about (the offer) and what it opened (stamped here and now, since nothing
    // has to be asked for that — see markConsumedOpened). The offer is set
    // first because the opening doesn't change the set: `probablyHaveReason`
    // reads assertions, the freezer and purchase history, and `openedAt` is
    // none of the three, so the banner recomputing live still finds these rows.
    const consumption = cooked ? cookedConsumption(next) : null;
    set({ cookedOffer: consumption?.offer ?? null });
    if (consumption) markConsumedOpened(next, consumption.rows);
    // Cleared in both directions, and set nowhere here: the leftovers offer
    // belongs to the task side of the tick (see setCookedPaired). Clearing it
    // on a plan-side tick is what stops a stale offer for last night's dinner
    // outliving the meal it was about.
    set({ leftoverOffer: null });
    // Ticking the meal ticks its task, and un-ticking un-ticks it. The
    // ping-pong this would otherwise cause is broken by the guard above plus
    // the one in completeTask: whichever side moves first has already written
    // its own state by the time the other calls back, so the callee returns
    // early. Don't remove either guard.
    syncCookTaskCompletion(next, cooked);
  },

  setCookTask(id, value) {
    const entry = resolveEntry(get, id);
    if (!entry || entry.cookTask === value) return;
    const next: MealPlanEntry = { ...entry, cookTask: value };
    dbUpdateMealPlanEntry(next);
    set(s => ({ entries: s.entries.map(e => e.id === id ? next : e) }));
    // The one path that may create a meal task outside the daily pass, and the
    // exception proves the rule: every other caller of reconcileMealSlot is a
    // *plan* change, where creating on demand would hand back the row the user
    // swiped away. This is the user asking for the row in as many words, from
    // the meal's own sheet. So an explicit per-meal "yes" beats the day's set
    // of meals in both directions, exactly as the cook task's own tri-state
    // beat the global setting — a lunch you cook once a month can have a task
    // without lunch being a meal you want asked about every day.
    if (value === true) createMealSlotTask(get, next);
    reconcileMealSlot(get, next);
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

    // After setCooked, which clears whatever was there — this is the one
    // caller that puts something back. Read off the entry as it was resolved
    // above rather than re-reading: the only field the write touched is
    // cookedAt, and nothing here reads it.
    if (cooked) set({ leftoverOffer: leftoverOfferFor(entry) });

    return () => {
      get().setCooked(id, !cooked);
      if (recipe && before) useRecipeStore.getState().restoreCookStats(recipe.id, before);
    };
  },

  bulkDeleteEntries(ids) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    // Captured before the rows go — the slot each meal occupied is the only
    // thing that says which meal tasks now have nothing behind them.
    const vacated = ids
      .map(id => get().entries.find(e => e.id === id) ?? dbGetMealPlanEntry(id))
      .filter((e): e is MealPlanEntry => !!e)
      .map(e => ({ date: e.date, slot: e.slot }));
    ids.forEach(dropCookTask);
    ids.forEach(dropMealEvent);
    ids.forEach(id => dbDeleteMealPlanEntry(id));
    // lastAction: null — see the doc comment. The delete registers no undo of
    // its own *and* takes the slot away from whatever was in it, so a shake
    // after this can't offer an unrelated action the user has moved on from.
    set(s => ({ entries: s.entries.filter(e => !idSet.has(e.id)), lastAction: null }));
    // After the delete, never before: reconcileMealSlot reads the slot's
    // current contents off this same `entries` array, and a reconcile run
    // before the filter above still sees the just-removed meal as planned —
    // so the live task never reverts to "Choose dinner". Same ordering
    // removeEntry and copyWeek's undo already keep; this was the one path
    // that had it backwards.
    vacated.forEach(e => reconcileMealSlot(get, e));
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
    moved.forEach(e => reconcileMealSlot(get, e));
    // The slots they came from, for moveEntry's reason one row at a time.
    originals.forEach(e => reconcileMealSlot(get, e));
    moved.forEach(reconcileMealEvent);

    get().setLastAction({
      label: `${moved.length} meal${moved.length === 1 ? '' : 's'} moved`,
      undo: () => {
        originals.forEach(dbUpdateMealPlanEntry);
        set(s => ({ entries: sortMealEntries(s.entries.filter(e => !movedIds.has(e.id))) }));
        originals.forEach(entry => patchInRange(set, get, entry));
        originals.forEach(e => reconcileMealSlot(get, e));
        moved.forEach(e => reconcileMealSlot(get, e));
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
    updated.forEach(e => reconcileMealSlot(get, e));
    updated.forEach(reconcileMealEvent);

    get().setLastAction({
      label: `${updated.length} meal${updated.length === 1 ? '' : 's'} replaced`,
      undo: () => {
        toUpdate.forEach(dbUpdateMealPlanEntry);
        const originalById = new Map(toUpdate.map(e => [e.id, e]));
        set(s => ({ entries: s.entries.map(e => originalById.get(e.id) ?? e) }));
        toUpdate.forEach(e => reconcileMealSlot(get, e));
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
    updated.forEach(e => syncCookTaskCompletion(e, cooked));

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
        toUpdate.forEach(e => syncCookTaskCompletion(e, !!e.cookedAt));
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
    created.forEach(e => reconcileMealSlot(get, e));
    created.forEach(reconcileMealEvent);

    const ids = new Set(created.map(e => e.id));
    get().setLastAction({
      label: `Copied ${created.length} meal${created.length === 1 ? '' : 's'}`,
      undo: () => {
        created.forEach(e => dropCookTask(e.id));
        created.forEach(e => dropMealEvent(e.id));
        created.forEach(e => dbDeleteMealPlanEntry(e.id));
        set(s => ({ entries: s.entries.filter(e => !ids.has(e.id)) }));
        created.forEach(e => reconcileMealSlot(get, e));
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
 * What a just-cooked meal could leave in the fridge, or null because there is
 * nothing to offer.
 *
 * Two meals are refused. One already *is* leftovers (`leftoverId`): eating a
 * tub of chilli is what closes that container out, not what fills a new one,
 * which is why the entry sheet swaps its "Log leftovers" row for "Finished the
 * leftovers" on exactly this test. And one with no name at all has nothing to
 * call the container — the store refuses a blank title anyway, so offering it
 * would be a banner leading to a button that can't be pressed.
 *
 * The parts and the keep-for window are deliberately *not* resolved here. They
 * come from the recipe, which the banner reads live for the same reason
 * `cookedConsumption`'s rows are recomputed rather than snapshotted: a recipe
 * edited between the tick and the tap should be read as it now stands.
 */
function leftoverOfferFor(entry: MealPlanEntry): LeftoverOffer | null {
  if (entry.leftoverId) return null;
  const title = titleForEntry(entry, recipeIndex(useRecipeStore.getState().recipes));
  if (!title.trim()) return null;
  return {
    entryId: entry.id,
    title,
    recipeId: entry.recipeId,
    choices: entry.recipeChoices,
  };
}

/**
 * What a just-cooked meal was made of, and the offer to raise about it — or
 * null when there's nothing to ask and nothing to open.
 *
 * One walk of the recipe answers both, because both are the same set of lines:
 * `consumedRows` is what the offer can defend (the lines the app is already
 * claiming you have) and it's the same restraint that decides what a cooking
 * may mark opened. See `markConsumedOpened` for where the two part ways.
 *
 * **Gated on there being at least one line to name**, exactly as the restock
 * banner is gated on `restockRows` — an offer that exists but shows nothing
 * would be indistinguishable from one that hasn't been dismissed, and the
 * screen suppresses the restock banner while this is set.
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
function cookedConsumption(
  entry: MealPlanEntry
): { offer: CookedOffer; rows: ClassifiedIngredient[] } | null {
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
    offer: {
      recipeId: recipe.id,
      recipeName: recipe.name,
      choices: [...entry.recipeChoices],
      scale,
    },
    rows,
  };
}

/**
 * When a cooking opened what it opened: now, or the meal's own day once that
 * day has passed.
 *
 * A Tuesday dinner is routinely ticked off on Thursday — from the plan, or from
 * a "Cook X" task that sat on Today for two days — and `openedAt` re-dates a
 * use-by day, so stamping the tap would hand the jar two days of shelf life it
 * hasn't got. Every other pantry assertion stamps now because every other one
 * is a statement about the present ("I'm out of it", "I have it"); this one is
 * a statement about when something happened. Noon rather than midnight for
 * `getLogicalToday`'s reason — a day, not a boundary — and `dayKeyOf` reads the
 * *logical* today, so a meal ticked off at 1am with a 2am reset is still that
 * day's cooking rather than yesterday's.
 */
function openedAtForCook(entry: MealPlanEntry): Date {
  const now = new Date();
  return entry.date < dayKeyOf(getLogicalToday()) ? setHours(dayKeyToDate(entry.date), 12) : now;
}

/**
 * Records that a cooking opened the things it was made of.
 *
 * **This is the one claim a cooking is allowed to make on its own**, and the
 * line it stops at is the one `CookedUseUpSheet` guards: how much of anything
 * is left is a question about real-world amounts that only the person can
 * answer, so consumption is still asked and never inferred. That a packet got
 * *opened*, though, follows from the cooking itself — you cannot cook with a
 * sealed jar — and it was the state the app had no way to hear about unless
 * someone went and toggled it on the item's own sheet, one row at a time.
 *
 * It writes over the same set the sheet asks about (`consumedRows`), so the
 * restraint there carries: only lines the app already claims you have, never a
 * staple, never something it has no catalog row for. A row that turns out to
 * have been finished rather than merely opened is marked out by the sheet and
 * leaves the pantry, which outranks anything said here.
 *
 * **Not retracted by un-cooking, deliberately.** The store cannot tell an undo
 * from an "I haven't cooked this after all", and the same cooking's other
 * write — what `markOutOfMany` marked out from the sheet — isn't retracted
 * either. Resealing is one tap on the item's own sheet.
 */
function markConsumedOpened(entry: MealPlanEntry, rows: readonly ClassifiedIngredient[]): void {
  const { items, markOpenedMany } = useGroceryStore.getState();
  // Resolved back to catalog ids here rather than carried on the row, the same
  // way CookedUseUpSheet does it: a ClassifiedIngredient is keyed by name, and
  // the pantry assertion lives on the row. A key with no live row is dropped
  // rather than minting one.
  const byKey = new Map(items.map(i => [i.nameKey, i.id]));
  const ids = rows
    .map(r => byKey.get(r.nameKey))
    .filter((id): id is string => !!id);
  markOpenedMany(ids, openedAtForCook(entry));
}

// ─── Meal tasks (#1402, folded into slots) ──────────────────────────────────
//
// The meal plan is the master and the task is the replica; these helpers are
// every write that crosses the line. The projection rules themselves — what a
// slot's task says, which fields the slot owns, when the chain may be rewritten
// — are in utils/mealSlotTasks so jest can reach them.
//
// **Creation is not here.** A meal task belongs to a day and a slot rather than
// to a meal, so the row exists before the meal does and is written once a day
// by useTaskStore.checkMealSlotTasks. What crosses the line here is the update:
// planning dinner rewrites the row from "Choose dinner" to "Cook Chili", and
// clearing the slot rewrites it back. The one exception is setCookTask(true),
// which is the user asking for the row in as many words.

/** This meal's live legacy cook task, if it still has one. */
function liveCookTaskFor(entryId: string): Task | undefined {
  return liveGeneratedTask(useTaskStore.getState().tasks, 'mealCook', entryId);
}

/** The recipe's prep + cook time, for the Cook step of a slot's chain — read live, like `useUpOfferFor`. */
function recipeMinutesFor(recipeId: string | null): number | null {
  if (!recipeId) return null;
  const recipe = recipeIndex(useRecipeStore.getState().recipes).get(recipeId);
  return recipe ? totalMinutes(recipe) : null;
}

/** The live meal task for a day and a slot, if there is one. */
function liveMealSlotTask(dayKey: string, slot: MealSlot): Task | undefined {
  return liveGeneratedTask(useTaskStore.getState().tasks, 'mealSlot', mealSlotSourceId(dayKey, slot));
}

/**
 * What is currently in a slot — the loaded window first, SQLite for a day
 * outside it.
 *
 * The same two-step `resolveEntry` makes one row at a time, and for the same
 * reason: `entries` is the one week the Meal Plan screen has open, and a
 * reconcile can be triggered from well outside it (a bulk move landing next
 * month, an undo after the week was paged away). Reading only the store would
 * report those slots as empty and rewrite a perfectly good task back to
 * "Choose lunch"; reading only SQLite would go to disk for a day already in
 * hand on every mutation.
 */
function slotEntry(get: () => MealPlanStore, dayKey: string, slot: MealSlot): MealPlanEntry | null {
  const { entries, rangeStart, rangeEnd } = get();
  const source = rangeStart && rangeEnd && isKeyInRange(dayKey, rangeStart, rangeEnd)
    ? entries
    : dbGetMealPlanEntries(dayKey, dayKey);
  return entriesForSlot(source, dayKey, slot)[0] ?? null;
}

/**
 * Writes a meal task for this meal's slot, if there isn't one and the generator
 * is on at all.
 *
 * Only `setCookTask(true)` reaches this — see the note there on why creation is
 * otherwise `checkMealSlotTasks`' alone. Deliberately not gated on
 * `mealSlotsEnabled`: the slot set says which meals to *ask* about daily, and
 * this is a meal saying it wants a task regardless.
 */
function createMealSlotTask(get: () => MealPlanStore, entry: MealPlanEntry): void {
  if (!useSettingsStore.getState().mealCookTasks) return;
  const sourceId = mealSlotSourceId(entry.date, entry.slot);
  const { tasks, addTask } = useTaskStore.getState();
  if (hasAnyGeneratedTask(tasks, 'mealSlot', sourceId)) return;
  ensureGeneratedTaskCategory('mealSlot');
  addTask(
    // Re-read after ensureGeneratedTaskCategory, which may have just filled it.
    mealSlotTaskDraft(
      entry.date, entry.slot, entry, useSettingsStore.getState().mealCookTaskCategory, recipeMinutesFor(entry.recipeId)
    ),
    derivedId(spawnSeed.generated('mealSlot', sourceId, generatedTaskCountOf(tasks, 'mealSlot', sourceId))),
    { skipCategoryDefault: true, skipTitleRules: true },
  );
}

/**
 * Brings a slot's meal task into line with what the slot now holds.
 *
 * **It never creates one**, which is the difference from the cook-task
 * reconcile it replaces and the reason it doesn't go through
 * `reconcileGeneratedTask`. Creation belongs to `checkMealSlotTasks`, which
 * fires once per logical day — and that once-a-day firing *is* this
 * generator's opt-out (see its doc comment), so a reconcile that created on
 * demand would hand back the lunch task the user swiped away the moment they
 * planned lunch from the meal plan screen instead.
 *
 * So this is the update half only: planning dinner rewrites the row you're
 * looking at from "Choose dinner" into "Cook Chili", and clearing the slot
 * again rewrites it back.
 *
 * **A cooked meal is left alone**, the same gate the cook task had: the night
 * has happened, and re-titling the task at that point edits history.
 */
function reconcileMealSlot(get: () => MealPlanStore, entry: Pick<MealPlanEntry, 'date' | 'slot'>): void {
  const { date: dayKey, slot } = entry;
  const live = liveMealSlotTask(dayKey, slot);
  if (!live) return;

  const current = slotEntry(get, dayKey, slot);
  if (current?.cookedAt) return;
  // The per-meal "no" survives the fold — MealPlanEntry.cookTask is still how
  // one meal says it doesn't want a task, and it's the only thing a slot task
  // inherits from the cook task it replaces. skipOptOut because this is the
  // app tidying up after the answer, not the user giving one: routing through
  // deleteTask would write `false` back onto a row that already says it.
  if (current?.cookTask === false) {
    deleteGeneratedTaskQuietly(live.id, { skipOptOut: true });
    return;
  }

  const updates = mealSlotDrift(live, dayKey, slot, current, recipeMinutesFor(current?.recipeId ?? null));
  // skipPostponeCount for reconcileGeneratedTask's reason: this row's date is
  // the slot's date, and dragging Tuesday's dinner to Friday is not the user
  // ducking anything.
  if (updates) useTaskStore.getState().updateTask(live.id, updates, { skipPostponeCount: true });
}

/**
 * Drops this meal's cook task because the meal itself is going.
 *
 * Deliberately not `reconcileMealSlot` with the flag off: that records an
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
function syncCookTaskCompletion(entry: MealPlanEntry, cooked: boolean): void {
  const { tasks, completeTask, uncompleteTask } = useTaskStore.getState();
  const entryId = entry.id;
  if (cooked) {
    const live = liveCookTaskFor(entryId);
    if (live) completeTask(live.id);
    // A meal task is a chain, so "the meal happened" can't be one tick: ticking
    // "Prepare lunch" from here would leave "Eat lunch" outstanding on a night
    // already marked cooked. Marking cooked says every remaining step happened,
    // so every remaining step is completed — each spawning the next, which is
    // what the loop walks. Bounded by the chain's own length rather than by
    // `while (live)`, so a step that declines to complete can't spin.
    let next = liveMealSlotTask(entry.date, entry.slot);
    for (let i = 0; next && i <= (next.chainItems?.length || 1); i++) {
      completeTask(next.id);
      next = liveMealSlotTask(entry.date, entry.slot);
    }
    return;
  }
  // Un-ticking only ever reaches the step that ended the chain — the one whose
  // completion marked the meal cooked in the first place (see completesMealSlot
  // in useTaskStore). The earlier steps stay done, because they were.
  const doneSlot = tasks.find(
    t => t.generatedKind === 'mealSlot'
      && t.generatedSourceId === mealSlotSourceId(entry.date, entry.slot)
      && t.completed && !t.archived
  );
  if (doneSlot) uncompleteTask(doneSlot.id);
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
