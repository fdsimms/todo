import { create } from 'zustand';
import type { Leftover, LeftoverOutcome } from '../types';
import {
  dbGetAllLeftovers,
  dbInsertLeftover,
  dbUpdateLeftover,
  dbDeleteLeftover,
  dbPurgeOldLeftovers,
  dbGetMealPlanEntry,
  dbGetMealPlanEntriesForLeftover,
} from '../db/database';
import { generateId } from '../utils/id';
import { leftoverFinishedRow, leftoverFrozenRow, leftoverKeepDaysRow, leftoverReopenedRow, newLeftoverRow, type LeftoverDraft } from '../utils/pantryWrite';
import { dayKeyOf, getLogicalToday } from '../utils/dateUtils';
import {
  cleanLeftoverTitle,
  isLiveLeftover,
  keepDaysBetween,
  keepUntilKeyFor,
  leftoverPurgeCutoff,
  sortLeftovers,
} from '../utils/leftovers';
import { plannedMealRowFor, useUpTaskDraft, useUpTaskDrift, wantsUseUpTask } from '../utils/leftoverTasks';
import { liveGeneratedTask } from '../utils/generatedTasks';
import { mealSlotSourceId } from '../utils/mealSlotTasks';
import { clampCookedWeight } from '../utils/mealLog';
import { dropGeneratedTask, reconcileGeneratedTask } from './generatedTaskSync';
import { useTaskStore } from './useTaskStore';
import { useSettingsStore } from './useSettingsStore';
import { useFoodLogStore } from './useFoodLogStore';

import {
  UndoableAction,
  UndoHistoryActions,
  undoHistoryActions,
} from '../utils/undoHistory';

export type { LeftoverDraft };

/**
 * What's in the fridge.
 *
 * **Wholesale, not range-scoped** — the opposite call to useMealPlanStore, and
 * for a reason that isn't laziness: the plan is a week the user is looking at,
 * so it has a window to scope to, whereas "what's in the fridge right now" is a
 * set with no window at all. It's also small by construction. The live rows are
 * bounded by what physically fits in a fridge, and the closed-out ones by
 * LEFTOVER_RETENTION_DAYS, so this array does not have the unbounded-growth
 * problem that made the plan range-scoped.
 *
 * Thin on purpose — the logic lives in utils/leftovers where jest can reach it.
 */
interface LeftoverStore extends UndoHistoryActions {
  /** Every leftover, live and closed out, most urgent first. */
  leftovers: Leftover[];
  initialized: boolean;
  /**
   * The leftover a just-completed "Use up X" task points at — the peer of
   * useGroceryStore's pendingUseUpItemId, and what UseUpResolveSheet (mounted
   * in AppNavigator) opens LeftoverSheet on as soon as it's set. Set by
   * useTaskStore.completeTask, cleared by uncompleteTask and by the sheet's
   * own onClose. Session-only — there's nothing for a just-made tap to mean
   * on the next launch.
   */
  pendingUseUpLeftoverId: string | null;
  setPendingUseUpLeftover: (id: string | null) => void;

  /**
   * The leftover a just-completed leftover-backed meal task points at — set
   * by useTaskStore.completeTask when the step that finished a mealSlot chain
   * belongs to an entry with `leftoverId` set, so ticking "Eat X" off asks
   * whether that closed the container out. The peer of pendingUseUpLeftoverId,
   * but watched by FinishLeftoverPrompt (mounted in AppNavigator) rather than
   * UseUpResolveSheet: this is a yes/no ask, not the leftover's whole editor.
   * Cleared by uncompleteTask and by the prompt's own answer. Session-only,
   * same reasoning as pendingUseUpLeftoverId.
   */
  pendingFinishLeftoverId: string | null;
  setPendingFinishLeftover: (id: string | null) => void;

  /** The most recent undoable action — see UndoableAction and useTaskStore's twin. */
  /** The top of `undoStack`, mirrored. See useTaskStore's own note. */
  lastAction: UndoableAction | null;
  undoStack: UndoableAction[];
  redoStack: UndoableAction[];

  /**
   * Rides useTaskStore.initialize's fan-out for the same reason groceries,
   * recipes and the meal plan do: enterDemoMode, exitDemoMode and
   * restore-from-backup all reload by calling that after swapping the database
   * file, and a store initialized outside it would keep showing rows from the
   * previous database — i.e. your real fridge on a demo phone.
   */
  initialize: () => void;

  /** Null when the title is empty. Blank titles are the only thing refused. */
  logLeftover: (draft: LeftoverDraft) => Leftover | null;

  /** False on an empty title. */
  renameLeftover: (id: string, title: string) => boolean;
  /** Moves the "put away" instant, holding the keep-for window steady. */
  setStoredAt: (id: string, storedAt: string) => void;
  /** Re-resolves `keepUntil` from the row's own `storedAt`. */
  setKeepDays: (id: string, days: number) => void;
  /**
   * What the container holds, in grams. null clears it back to unweighed.
   *
   * Clamped through `clampCookedWeight`, the same call `setCookedWeight`
   * makes: it is the same measurement of the same food, and a container
   * weighing zero would be a fraction of nothing. See `Leftover.weightG`.
   */
  setLeftoverWeight: (id: string, grams: number | null) => void;
  /**
   * Puts this container in the freezer, or takes it back out.
   *
   * The fridge half of `useGroceryStore.setFrozen`, with the same two rules:
   * freezing stamps the instant and leaves `keepUntil` alone (it stops being
   * read, via `liveKeepUntil`), and thawing hands back the *same window the
   * container was given*, measured from now.
   *
   * The same window rather than the remaining days, which was the other
   * candidate: a portion frozen on day three of four would come back with one
   * day, on the theory that the clock merely paused. It didn't pause, it
   * stopped — freezing is what arrests the spoiling this window is about — so
   * restarting it whole is both the truer model and the safer one to be wrong
   * about in the user's favour. `keepDaysBetween` is where that window is read
   * back from, so a container whose keep-for was edited keeps the edited one.
   *
   * **It never closes the container out.** `finishedAt` stays null through
   * both directions: a frozen portion is still in the kitchen and still
   * plannable onto a night of the week, which is most of what anyone freezes
   * one for.
   */
  setFrozen: (id: string, frozen: boolean) => void;

  /**
   * Splits a live container in two — one copy staying exactly where it is, a
   * second logged on the opposite side of the fridge/freezer line. What
   * `setFrozen` can't do on its own: it moves the one row you have, so
   * freezing half a pot logged to the fridge on Sunday meant deleting it and
   * re-logging as "Both", losing the days it had already spent there.
   *
   * The new row shares `title`, `recipeId` and `sourceEntryId` with the
   * original — same dish, same cooking — and its `storedAt` is the
   * *original's* `storedAt`, not now: the food is that old regardless of which
   * half of it this row is. Built through `logLeftover` so a split row is
   * indistinguishable from one the "Both" log flow would have written.
   *
   * The original is left untouched. No merge-back: finishing one and editing
   * the other already says the same thing a merge would.
   *
   * Null when there's no such live container to split.
   */
  splitLeftover: (id: string) => Leftover | null;

  /**
   * Closes the row out — the explicit action that is deliberately *not* implied
   * by planning a meal against it (see Leftover.finishedAt). Idempotent: a
   * second call on an already-closed row is ignored rather than restamping it,
   * matching markCooked.
   */
  finishLeftover: (id: string, outcome: LeftoverOutcome) => void;
  /**
   * Puts a closed-out row back in the fridge. Unlike markCooked this *does*
   * reverse, because closing out is a two-button question asked at the moment
   * of picking a meal — the exact place a wrong tap is cheap and likely — and
   * "eaten" is a claim about a container that is still physically there.
   */
  reopenLeftover: (id: string) => void;
  /** Writes a snapshot of the stored/keep/frozen/finished fields back, for the Activity screen's undo of an agent's change. */
  restoreLeftover: (id: string, patch: Record<string, unknown>) => void;
  deleteLeftover: (id: string) => void;

  /**
   * The per-leftover answer to "does this get a use-up task" — true, false, or
   * null to hand the question back to the leftoverUseUpTasks setting.
   * Reconciles immediately, same shape as useGroceryStore's setUseUpTask.
   *
   * `reconcile: false` records the answer and stops there — exactly one
   * caller wants that: deleteTask's opt-out writeback in useTaskStore, which
   * has already deleted the task itself and would otherwise immediately spawn
   * it right back with the feature on.
   */
  setUseUpTask: (id: string, value: boolean | null, options?: { reconcile?: boolean }) => void;

  /** Drops closed-out rows past the retention horizon. Returns how many went. */
  purgeOldLeftovers: () => number;

  /**
   * Sweeps every live leftover's use-up task into line — created, updated or
   * dropped, whichever `wantsUseUpTask` now says. Run once at startup (after
   * tasks have loaded) and again on app foreground, since `needsAttention` is
   * a function of the wall clock: a leftover can age from "fresh" into "soon"
   * purely by time passing, with no leftover mutation to trigger a reconcile.
   *
   * The launch-time call in `useTaskStore.initialize` is this one. The catch-up and
   * foreground sweeps go through `useGroceryStore.reconcileAllUseUpTasks`
   * instead, which visits these same leftovers interleaved with the grocery
   * items by use-by day, so the shared cap goes to the soonest of both (#2924).
   */
  reconcileAllLeftoverTasks: () => void;

  /**
   * One live leftover's use-up task, brought into line. For the meal plan
   * (#2932): planning a leftover into a meal whose task already says to eat
   * it stands the use-up task down, and clearing or moving that meal brings it
   * back, with no leftover mutation to trigger either. Also the step
   * `useGroceryStore.reconcileAllUseUpTasks` takes for each leftover in its
   * merged queue (#2924). A finished or unknown id is a no-op.
   */
  reconcileLeftoverUseUpTask: (id: string) => void;

  leftoverById: (id: string) => Leftover | undefined;
}

// ─── Use-up tasks ───────────────────────────────────────────────────────────
//
// The leftover is the master and the task is the replica; these two helpers
// are every write that crosses the line. The projection rules — which
// leftovers qualify, what the task says, which fields the leftover owns once
// it exists — are in utils/leftoverTasks so jest can reach them. Same shape
// as reconcileUseUpTask/dropUseUpTask in useGroceryStore.ts.

/**
 * Brings this leftover's use-up task into line: creates it, updates it, or
 * removes it, depending on what the leftover now says. The create/update/delete
 * machinery is shared with every other generator (store/generatedTaskSync,
 * #1524); what's decided here is only what a leftover wants.
 *
 * No `blocksOnFinished`, for the reason groceries don't have it either: a
 * container logged today is not last week's container, even where the two share
 * a title.
 */
function reconcileLeftoverTask(leftover: Leftover): void {
  const { leftoverUseUpTasks, leftoverUseUpTaskCategory, useUpTaskCap } = useSettingsStore.getState();
  reconcileGeneratedTask({
    kind: 'leftoverUseUp',
    sourceId: leftover.id,
    wanted: wantsUseUpTask(leftover, leftoverUseUpTasks, eatenAsPlanned(leftover)),
    drift: existing => useUpTaskDrift(existing, leftover),
    draft: () => useUpTaskDraft(leftover, leftoverUseUpTaskCategory),
    useUpCap: useUpTaskCap,
  });
}

/**
 * Whether a planned meal's own task already says to eat this leftover — see
 * `plannedMealRowFor`. Read from SQLite rather than the meal plan store, whose
 * `entries` is only the week that screen has loaded.
 */
function eatenAsPlanned(leftover: Leftover): boolean {
  const { tasks } = useTaskStore.getState();
  return plannedMealRowFor(
    leftover,
    dbGetMealPlanEntriesForLeftover(leftover.id),
    dayKeyOf(getLogicalToday()),
    (dayKey, slot) => !!liveGeneratedTask(tasks, 'mealSlot', mealSlotSourceId(dayKey, slot)),
  ) !== null;
}

/**
 * Drops this leftover's use-up task because the leftover itself is closing
 * out or going away.
 *
 * Deliberately not `reconcileLeftoverTask` on a finish/delete: those paths
 * are a row that won't be live any more, while reconcile is a correction to
 * one that still is. Completed tasks stay either way — closing out a
 * leftover must not erase the Logbook.
 */
function dropLeftoverTask(leftoverId: string): void {
  dropGeneratedTask('leftoverUseUp', leftoverId);
}

export const useLeftoverStore = create<LeftoverStore>((set, get) => ({
  leftovers: [],
  initialized: false,
  pendingUseUpLeftoverId: null,
  pendingFinishLeftoverId: null,
  lastAction: null,
  undoStack: [],
  redoStack: [],
  ...undoHistoryActions(set, get),

  initialize() {
    set({
      leftovers: sortLeftovers(dbGetAllLeftovers()),
      pendingUseUpLeftoverId: null,
      pendingFinishLeftoverId: null,
      initialized: true,
    });
  },

  setPendingUseUpLeftover(id) {
    set({ pendingUseUpLeftoverId: id });
  },

  setPendingFinishLeftover(id) {
    set({ pendingFinishLeftoverId: id });
  },

  logLeftover(draft) {
    // The row is `newLeftoverRow`'s, shared with the MCP server's log_leftover.
    const leftover = newLeftoverRow(draft, generateId(), new Date().toISOString());
    if (!leftover) return null;
    dbInsertLeftover(leftover);
    set(s => ({ leftovers: sortLeftovers([...s.leftovers, leftover]) }));
    reconcileLeftoverTask(leftover);
    return leftover;
  },

  renameLeftover(id, title) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (!leftover) return false;
    const clean = cleanLeftoverTitle(title);
    if (!clean) return false;
    // No collision check, unlike renameRecipe: two containers of chilli is a
    // normal Tuesday, and the name is not this row's identity.
    save(set, { ...leftover, title: clean });
    return true;
  },

  setStoredAt(id, storedAt) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (!leftover) return;
    // The keep-for *window* is what the user set, so correcting "actually I
    // made this yesterday" has to carry the deadline back with it. Re-resolving
    // from the old keepUntil instead would silently turn a 3-day window into a
    // 2-day one, which is the kind of drift storing an absolute day was meant
    // to avoid — the absolute day is authoritative for reading, not for edits
    // to the thing it was derived from.
    const days = keepDaysBetween(leftover.storedAt, leftover.keepUntil);
    const updated = { ...leftover, storedAt, keepUntil: keepUntilKeyFor(storedAt, days) };
    save(set, updated);
    reconcileLeftoverTask(updated);
  },

  setKeepDays(id, days) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (!leftover) return;
    const updated = leftoverKeepDaysRow(leftover, days);
    save(set, updated);
    reconcileLeftoverTask(updated);
  },

  setFrozen(id, frozen) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (!leftover) return;
    const updated = leftoverFrozenRow(leftover, frozen, new Date().toISOString());
    if (!updated) return;
    save(set, updated);
    // Freezing drops a use-up task that needsAttention no longer wants;
    // thawing spawns one if the restarted window lands inside the threshold.
    // Dropped on the way in, which writes no "never", for the reason the
    // grocery store's own setFrozen gives: a container frozen with a live task
    // used to lose use-up tasks for good. See reconcileGeneratedTask.
    if (frozen) dropLeftoverTask(id);
    else reconcileLeftoverTask(updated);
  },

  splitLeftover(id) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (!leftover || !isLiveLeftover(leftover)) return null;
    return get().logLeftover({
      title: leftover.title,
      recipeId: leftover.recipeId,
      sourceEntryId: leftover.sourceEntryId,
      // The original's own put-away instant, not now — see this action's own
      // doc comment on the store interface.
      storedAt: leftover.storedAt,
      keepDays: keepDaysBetween(leftover.storedAt, leftover.keepUntil),
      // The opposite side from where the original already is.
      frozen: !leftover.frozenAt,
    });
  },

  setLeftoverWeight(id, grams) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (!leftover) return;
    save(set, { ...leftover, weightG: clampCookedWeight(grams) });
  },

  finishLeftover(id, outcome) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (!leftover) return;
    const finished = leftoverFinishedRow(leftover, outcome, new Date().toISOString());
    if (!finished) return;
    save(set, finished);
    // The row's no longer live, so its use-up task's job is done — dropped
    // directly rather than through reconcile, same call dropUseUpTask makes:
    // this is a row that won't be live any more, not a correction to one.
    dropLeftoverTask(id);
    // Eating it is the second free logging moment, and unlike the meal task's
    // it is the *only* one for a container: the five UI paths that finish a
    // leftover all come through here, so this is where the offer belongs
    // rather than on any one of them. Only 'eaten' — a leftover thrown out
    // fed nobody, which is the whole distinction LeftoverOutcome exists to
    // keep. Offer, never write; see mealLog.ts.
    //
    // A recipe behind it gets the auto-computed prompt, which can measure it;
    // anything else — half a takeaway, a hand-logged container with no
    // recipe — gets the search sheet instead, the same split offerMealLog
    // makes in useTaskStore.ts for a meal-slot completion.
    //
    // Skipped when an offer is already waiting. Ticking a leftover-backed
    // meal's Eat step raises the plan's own offer (with its slot and its link
    // to the plan entry) and then asks whether that was the last of it, and
    // answering "Finished it" landed here: a second offer for the same meal
    // on top of the first, or a slotless one replacing it that logged the
    // dinner without covering the plan. One offer per meal, and the plan's
    // knows which meal it was.
    const foodLog = useFoodLogStore.getState();
    const offerWaiting = foodLog.pendingMealLog !== null || foodLog.pendingManualMealLog !== null;
    if (outcome === 'eaten' && useSettingsStore.getState().mealLogPrompt && !offerWaiting) {
      if (leftover.recipeId) {
        const source = leftover.sourceEntryId ? dbGetMealPlanEntry(leftover.sourceEntryId) : null;
        foodLog.setPendingMealLog({
          label: leftover.title,
          // A container has no meal of the day: it was eaten whenever it was
          // eaten, and inventing a slot would file it under one it wasn't in.
          slot: null,
          // Finishing a leftover is a right-now action, unlike a meal-plan
          // entry's own fixed day — so this is always today.
          dayKey: dayKeyOf(getLogicalToday()),
          recipeId: leftover.recipeId,
          mealPlanEntryId: null,
          // The cooking this came from, when its plan entry still resolves: the
          // scale it was made at and the either/or answers that went in. A
          // helping counted in servings reads the same either way (a doubled
          // batch doubles its servings too), but a weighed container is
          // measured against the whole dish's cooked weight, and at the
          // as-written scale a normal container from a doubled pot weighed
          // more than the entire dish and was refused. A leftover with no
          // surviving plan entry falls back to the dish as written.
          scale: source?.recipeScale ?? 1,
          choices: source?.recipeChoices ?? [],
          // What this container weighed, when it was weighed — the container
          // against the dish's own cooked weight is the fraction of the recipe
          // that was in it, and finishing it as eaten means that fraction was
          // eaten. Offered as the figure the prompt opens on rather than written:
          // a container is finished off after somebody picked at it too, and the
          // whole posture here is offer, never write.
          grams: leftover.weightG,
        });
      } else {
        foodLog.setPendingManualMealLog({
          label: leftover.title,
          slot: null,
          dayKey: dayKeyOf(getLogicalToday()),
          mealPlanEntryId: null,
        });
      }
    }
    // Not `destructive` — this is a completion, the same call completeTask
    // makes about its own lastAction, not a delete. reopenLeftover is the
    // exact reverse (see its own doc comment on why this one, unlike
    // markCooked, gets to un-happen) and already re-reconciles the use-up
    // task dropped above.
    get().setLastAction({
      label: outcome === 'tossed' ? `Threw out "${leftover.title}"` : `Finished "${leftover.title}"`,
      redo: () => get().finishLeftover(id, outcome),
      undo: () => get().reopenLeftover(id),
    });
  },

  restoreLeftover(id, patch) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (!leftover) return;
    const updated = { ...leftover, ...patch } as Leftover;
    save(set, updated);
    reconcileLeftoverTask(updated);
  },

  reopenLeftover(id) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (!leftover) return;
    const updated = leftoverReopenedRow(leftover);
    if (!updated) return;
    save(set, updated);
    reconcileLeftoverTask(updated);
  },

  deleteLeftover(id) {
    const leftover = get().leftovers.find(l => l.id === id);
    dbDeleteLeftover(id);
    set(s => ({ leftovers: s.leftovers.filter(l => l.id !== id) }));
    dropLeftoverTask(id);
    if (leftover) {
      get().setLastAction({
        label: `Deleted "${leftover.title}"`,
        destructive: true,
        redo: () => get().deleteLeftover(id),
        undo: () => {
          dbInsertLeftover(leftover);
          set(s => ({ leftovers: sortLeftovers([...s.leftovers, leftover]) }));
          // Only a still-live container's use-up task comes back — a
          // finished one had already dropped its task on the way out for a
          // reason undoing the delete doesn't reverse.
          if (isLiveLeftover(leftover)) reconcileLeftoverTask(leftover);
        },
      });
    }
  },

  setUseUpTask(id, value, options) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (!leftover || leftover.useUpTask === value) return;
    const updated = { ...leftover, useUpTask: value };
    save(set, updated);
    if (options?.reconcile !== false) reconcileLeftoverTask(updated);
  },

  reconcileLeftoverUseUpTask(id) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (leftover && !leftover.finishedAt) reconcileLeftoverTask(leftover);
  },

  reconcileAllLeftoverTasks() {
    // `get().leftovers` is sorted soonest-keepUntil-first (sortLeftovers), so
    // this sweep already visits the most urgent candidates first — which is
    // what spends any open useUpTaskCap slots on them rather than on whichever
    // leftover happened to be logged first (#1675).
    for (const leftover of get().leftovers) {
      if (!leftover.finishedAt) reconcileLeftoverTask(leftover);
    }
  },

  purgeOldLeftovers() {
    const cutoff = leftoverPurgeCutoff();
    const removed = dbPurgeOldLeftovers(cutoff);
    if (removed === 0) return 0;
    set(s => ({
      leftovers: s.leftovers.filter(l => !l.finishedAt || l.finishedAt >= cutoff),
    }));
    return removed;
  },

  leftoverById(id) {
    return get().leftovers.find(l => l.id === id);
  },
}));

type SetLeftovers = (fn: (s: { leftovers: Leftover[] }) => { leftovers: Leftover[] }) => void;

/**
 * Write-then-patch, re-sorting on every write.
 *
 * The sort key is `keepUntil`, which most of these mutations can move, so the
 * array is rebuilt rather than mapped in place — a list ordered by urgency that
 * only re-sorts on reload would leave a just-shortened window sitting at the
 * bottom of the fridge card, which is precisely the row that needed to be at
 * the top.
 */
function save(set: SetLeftovers, leftover: Leftover): void {
  dbUpdateLeftover(leftover);
  set(s => ({
    leftovers: sortLeftovers(s.leftovers.map(l => (l.id === leftover.id ? leftover : l))),
  }));
}
