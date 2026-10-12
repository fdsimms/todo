import { create } from 'zustand';
import type { FoodLogEntry, MealSlot } from '../types';
import {
  dbDeletePendingEstimate,
  dbGetPendingEstimates,
  dbSavePendingEstimate,
} from '../db/database';
import { generateId } from '../utils/id';
import { isDemoModeActive } from '../utils/demoState';
import {
  awaitingEstimate,
  canQueueAnother,
  findDuplicate,
  isQueueableFailure,
  sortPending,
  type PendingEstimate,
} from '../utils/estimateQueue';
import { estimateToPanel, type EstimateContextFood } from '../utils/nutritionEstimate';
import { useFoodLogStore } from './useFoodLogStore';

/**
 * The offline food log queue: meals described with no connection, estimated
 * when there is one, logged only when a person confirms them.
 *
 * Rules and the reasons for them are in `utils/estimateQueue.ts`. In short:
 * this store holds descriptions and the estimates that come back for them,
 * never a food log entry, so a queued meal adds nothing to a day's totals and
 * writes nothing to Health until `log` is called by a tap.
 *
 * **It is device-local.** The table is neither synced nor backed up, since a
 * request belongs to the phone that lost its signal.
 */

/** What a caller saves: the text, and where and when it was eaten. */
export interface PendingEstimateDraft {
  description: string;
  slot: MealSlot | null;
  at: Date;
  mealPlanEntryId?: string | null;
  context: readonly EstimateContextFood[];
}

export type EnqueueResult = 'queued' | 'duplicate' | 'full' | 'empty';

interface PendingEstimateStore {
  pending: PendingEstimate[];
  initialized: boolean;
  /** True while a drain is asking the model, so a second trigger doesn't start another. */
  draining: boolean;
  initialize: () => void;
  /** Keeps a meal for later. Refuses an empty description, a repeat, and a full queue. */
  enqueue: (draft: PendingEstimateDraft) => EnqueueResult;
  /**
   * Asks the model for every meal still waiting, oldest first.
   *
   * Stops at the first failure that waiting can still fix, since that means
   * the connection is still down and the rest would fail the same way. A
   * failure that waiting cannot fix marks that one meal `failed` and carries
   * on, so one unreadable description doesn't hold up the others.
   */
  drain: () => Promise<void>;
  /** Puts a failed meal back to waiting and asks again. */
  retry: (id: string) => Promise<void>;
  /**
   * Logs a ready meal, the tap that confirms it. Returns the entry, or null
   * when the meal is not ready or the food log refused it.
   */
  log: (id: string) => FoodLogEntry | null;
  /** Throws a queued meal away, ready or not. */
  discard: (id: string) => void;
}

export const usePendingEstimateStore = create<PendingEstimateStore>((set, get) => {
  /** Replaces one queued meal in memory and on disk. */
  const save = (next: PendingEstimate) => {
    dbSavePendingEstimate(next);
    set(state => ({ pending: sortPending(state.pending.map(p => (p.id === next.id ? next : p))) }));
  };

  return {
    pending: [],
    initialized: false,
    draining: false,

    initialize() {
      set({ pending: sortPending(dbGetPendingEstimates()), initialized: true, draining: false });
    },

    enqueue(draft) {
      const description = draft.description.trim();
      if (!description) return 'empty';
      const { pending } = get();
      const atISO = draft.at.toISOString();
      if (findDuplicate(pending, description, atISO)) return 'duplicate';
      if (!canQueueAnother(pending)) return 'full';

      const row: PendingEstimate = {
        id: generateId(),
        description,
        slot: draft.slot,
        atISO,
        mealPlanEntryId: draft.mealPlanEntryId ?? null,
        context: [...draft.context],
        status: 'waiting',
        estimate: null,
        estimatedAtISO: null,
        error: null,
        createdAt: new Date().toISOString(),
      };
      dbSavePendingEstimate(row);
      set(state => ({ pending: sortPending([...state.pending, row]) }));
      return 'queued';
    },

    async drain() {
      // Demo mode refuses every request by design (`callAnthropic`), and a
      // queue read against the scratch database would be answered for a
      // meal nobody ate. Nothing is consumed either way.
      if (isDemoModeActive() || get().draining) return;
      if (awaitingEstimate(get().pending).length === 0) return;

      // Required lazily: the service reaches the settings and the Health
      // bridge at import, and this module is loaded by the store fan-out that
      // comes up before either is ready.
      const { estimateMealNutrition, describeAIError } =
        require('../services/aiSuggestions') as typeof import('../services/aiSuggestions');

      set({ draining: true });
      try {
        for (const item of awaitingEstimate(get().pending)) {
          // Re-read: it may have been discarded while an earlier one was out.
          const current = get().pending.find(p => p.id === item.id);
          if (!current || current.status !== 'waiting') continue;
          try {
            const estimate = await estimateMealNutrition(current.description, current.context);
            const still = get().pending.find(p => p.id === item.id);
            // Discarded, or taken over by a retry, while the request was out.
            if (!still || still.status !== 'waiting') continue;
            save({
              ...still,
              status: 'ready',
              estimate,
              estimatedAtISO: new Date().toISOString(),
              error: null,
            });
          } catch (e) {
            // Still offline (or the service is struggling): leave this one and
            // the rest waiting for the next foreground.
            if (isQueueableFailure(e)) break;
            const still = get().pending.find(p => p.id === item.id);
            if (!still || still.status !== 'waiting') continue;
            save({ ...still, status: 'failed', error: describeAIError(e) });
          }
        }
      } finally {
        set({ draining: false });
      }
    },

    async retry(id) {
      const row = get().pending.find(p => p.id === id);
      if (!row || row.status !== 'failed') return;
      save({ ...row, status: 'waiting', error: null });
      await get().drain();
    },

    log(id) {
      const row = get().pending.find(p => p.id === id);
      if (!row || row.status !== 'ready' || !row.estimate) return null;
      const nutrition = estimateToPanel(row.estimate, new Date(row.estimatedAtISO ?? row.atISO));
      if (!nutrition) return null;
      const written = useFoodLogStore.getState().addEntry({
        label: row.estimate.label,
        quantity: row.estimate.quantity,
        // No weight, for the reason EstimatePanel's own Log gives: a gram
        // figure for a described meal would be one more invented number.
        grams: null,
        nutrition,
        slot: row.slot,
        // The moment it was eaten, not the moment it was confirmed.
        at: new Date(row.atISO),
        mealPlanEntryId: row.mealPlanEntryId,
      });
      if (!written) return null;
      get().discard(id);
      return written;
    },

    discard(id) {
      dbDeletePendingEstimate(id);
      set(state => ({ pending: state.pending.filter(p => p.id !== id) }));
    },
  };
});
