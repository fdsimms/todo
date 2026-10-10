import { create } from 'zustand';
import {
  dbDeletePendingRecipeEstimate,
  dbGetPendingRecipeEstimates,
  dbSavePendingRecipeEstimate,
} from '../db/database';
import { isDemoModeActive } from '../utils/demoState';
import { isQueueableFailure } from '../utils/estimateQueue';
import { awaitingRecipeEstimate, type PendingRecipeEstimate } from '../utils/recipeEstimateQueue';

/**
 * Recipe nutrition estimates asked for with no connection, made when there is
 * one and kept for the recipe's sheet to show.
 *
 * Rules and the reasons for them are in `utils/recipeEstimateQueue.ts`. The
 * short version: one row per recipe, believed by the sheet only while its
 * fingerprint still matches what is on screen, and never written to the recipe
 * or the catalog. Unlike a queued meal there is nothing to confirm, so this
 * store has no `log`.
 *
 * The drain is the meal queue's (`usePendingEstimateStore`) and stops on the
 * same failure for the same reason: still offline means the rest would fail the
 * same way.
 */

export interface PendingRecipeEstimateDraft {
  recipeId: string;
  estimateKey: string;
  title: string;
  servings: number | null;
  lines: readonly string[];
}

interface PendingRecipeEstimateStore {
  pending: PendingRecipeEstimate[];
  initialized: boolean;
  draining: boolean;
  initialize: () => void;
  /** Keeps a recipe's estimate for later, replacing any earlier row for that recipe. */
  enqueue: (draft: PendingRecipeEstimateDraft) => void;
  drain: () => Promise<void>;
  /** Puts a failed row back to waiting and asks again. */
  retry: (recipeId: string) => Promise<void>;
  discard: (recipeId: string) => void;
}

/**
 * Whether two rows are the same ask. The fingerprint is compared as well as the
 * time: a row replaced by a newer ask for the same recipe within one
 * millisecond would otherwise take the older request's answer, which was made
 * for a different reading.
 */
const sameAsk = (a: PendingRecipeEstimate, b: PendingRecipeEstimate) =>
  a.estimateKey === b.estimateKey && a.createdAt === b.createdAt;

export const usePendingRecipeEstimateStore = create<PendingRecipeEstimateStore>((set, get) => {
  const save = (next: PendingRecipeEstimate) => {
    dbSavePendingRecipeEstimate(next);
    set(state => ({
      pending: [...state.pending.filter(p => p.recipeId !== next.recipeId), next]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }));
  };

  return {
    pending: [],
    initialized: false,
    draining: false,

    initialize() {
      set({ pending: dbGetPendingRecipeEstimates(), initialized: true, draining: false });
    },

    enqueue(draft) {
      const lines = draft.lines.map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return;
      save({
        recipeId: draft.recipeId,
        estimateKey: draft.estimateKey,
        title: draft.title,
        servings: draft.servings,
        lines,
        status: 'waiting',
        estimate: null,
        error: null,
        createdAt: new Date().toISOString(),
      });
    },

    async drain() {
      // Demo mode refuses every request by design, and a queue read against the
      // scratch database would be answered for a recipe nobody wrote.
      if (isDemoModeActive() || get().draining) return;
      if (awaitingRecipeEstimate(get().pending).length === 0) return;

      // Lazily, for the reason the meal queue's drain gives.
      const { estimateRecipeNutrition, describeAIError } =
        require('../services/aiSuggestions') as typeof import('../services/aiSuggestions');

      set({ draining: true });
      try {
        for (const item of awaitingRecipeEstimate(get().pending)) {
          const current = get().pending.find(p => p.recipeId === item.recipeId);
          // Replaced by a newer ask while an earlier one was out.
          if (!current || current.status !== 'waiting' || !sameAsk(current, item)) continue;
          try {
            const estimate = await estimateRecipeNutrition(current.title, current.servings, current.lines);
            const still = get().pending.find(p => p.recipeId === item.recipeId);
            // Discarded, or replaced by a newer ask for the recipe, while out.
            if (!still || still.status !== 'waiting' || !sameAsk(still, item)) continue;
            save({ ...still, status: 'ready', estimate, error: null });
          } catch (e) {
            if (isQueueableFailure(e)) break;
            const still = get().pending.find(p => p.recipeId === item.recipeId);
            if (!still || still.status !== 'waiting' || !sameAsk(still, item)) continue;
            save({ ...still, status: 'failed', error: describeAIError(e) });
          }
        }
      } finally {
        set({ draining: false });
      }
    },

    async retry(recipeId) {
      const row = get().pending.find(p => p.recipeId === recipeId);
      if (!row || row.status !== 'failed') return;
      save({ ...row, status: 'waiting', error: null });
      await get().drain();
    },

    discard(recipeId) {
      dbDeletePendingRecipeEstimate(recipeId);
      set(state => ({ pending: state.pending.filter(p => p.recipeId !== recipeId) }));
    },
  };
});
