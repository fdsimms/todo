import { create } from 'zustand';
import type { Leftover, LeftoverOutcome } from '../types';
import { LEFTOVER_KEEP_DAYS_DEFAULT } from '../types';
import {
  dbGetAllLeftovers,
  dbInsertLeftover,
  dbUpdateLeftover,
  dbDeleteLeftover,
  dbPurgeOldLeftovers,
} from '../db/database';
import { generateId } from '../utils/id';
import {
  cleanLeftoverTitle,
  keepDaysBetween,
  keepUntilKeyFor,
  leftoverPurgeCutoff,
  sortLeftovers,
} from '../utils/leftovers';
import { useUpTaskDraft, useUpTaskFields, useUpTaskNeedsUpdate, wantsUseUpTask } from '../utils/leftoverTasks';
import { dropGeneratedTask, reconcileGeneratedTask } from './generatedTaskSync';
import { useTaskStore } from './useTaskStore';
import { useSettingsStore } from './useSettingsStore';

export interface LeftoverDraft {
  title: string;
  /** ISO instant it went in the fridge. Defaults to now. */
  storedAt?: string;
  /** Keep-for window in days, converted to a `keepUntil` day key on the way in. */
  keepDays?: number;
  /** The recipe it was made from, when logged off a cooked meal. */
  recipeId?: string | null;
  /** The planned meal it was logged from. */
  sourceEntryId?: string | null;
}

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
interface LeftoverStore {
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
   */
  reconcileAllLeftoverTasks: () => void;

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
 * machinery is shared with the other three generators (store/generatedTaskSync,
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
    wanted: wantsUseUpTask(leftover, leftoverUseUpTasks),
    drift: existing => (useUpTaskNeedsUpdate(existing, leftover) ? useUpTaskFields(leftover) : null),
    draft: () => useUpTaskDraft(leftover, leftoverUseUpTaskCategory),
    useUpCap: useUpTaskCap,
  });
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

  initialize() {
    set({
      leftovers: sortLeftovers(dbGetAllLeftovers()),
      pendingUseUpLeftoverId: null,
      initialized: true,
    });
  },

  setPendingUseUpLeftover(id) {
    set({ pendingUseUpLeftoverId: id });
  },

  logLeftover(draft) {
    const title = cleanLeftoverTitle(draft.title);
    if (!title) return null;

    const storedAt = draft.storedAt ?? new Date().toISOString();
    const leftover: Leftover = {
      id: generateId(),
      title,
      recipeId: draft.recipeId ?? null,
      sourceEntryId: draft.sourceEntryId ?? null,
      storedAt,
      keepUntil: keepUntilKeyFor(storedAt, draft.keepDays ?? LEFTOVER_KEEP_DAYS_DEFAULT),
      finishedAt: null,
      outcome: null,
      createdAt: new Date().toISOString(),
      useUpTask: null,
    };
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
    const updated = { ...leftover, keepUntil: keepUntilKeyFor(leftover.storedAt, days) };
    save(set, updated);
    reconcileLeftoverTask(updated);
  },

  finishLeftover(id, outcome) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (!leftover || leftover.finishedAt) return;
    save(set, { ...leftover, finishedAt: new Date().toISOString(), outcome });
    // The row's no longer live, so its use-up task's job is done — dropped
    // directly rather than through reconcile, same call dropUseUpTask makes:
    // this is a row that won't be live any more, not a correction to one.
    dropLeftoverTask(id);
  },

  reopenLeftover(id) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (!leftover || !leftover.finishedAt) return;
    const updated = { ...leftover, finishedAt: null, outcome: null };
    save(set, updated);
    reconcileLeftoverTask(updated);
  },

  deleteLeftover(id) {
    dbDeleteLeftover(id);
    set(s => ({ leftovers: s.leftovers.filter(l => l.id !== id) }));
    dropLeftoverTask(id);
  },

  setUseUpTask(id, value, options) {
    const leftover = get().leftovers.find(l => l.id === id);
    if (!leftover || leftover.useUpTask === value) return;
    const updated = { ...leftover, useUpTask: value };
    save(set, updated);
    if (options?.reconcile !== false) reconcileLeftoverTask(updated);
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
