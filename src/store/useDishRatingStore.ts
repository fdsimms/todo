import { create } from 'zustand';
import type { DishRating, DishVerdict } from '../types';
import {
  dbGetAllDishRatings,
  dbInsertDishRating,
  dbUpdateDishRating,
  dbDeleteDishRating,
} from '../db/database';
import { generateId } from '../utils/id';
import {
  applyDishPatch,
  buildDishRating,
  dishForLabel,
  dishOfferFor,
  findDish,
  type DishInput,
  type DishPatch,
} from '../utils/dishRating';

/**
 * Restaurant dishes and whether you would order them again — see `DishRating`
 * in `src/types/index.ts` for why this is its own record, and
 * `src/utils/dishRating.ts` for the rules. CRUD only: the store keeps the
 * `set()`, the util keeps every decision.
 *
 * Loaded wholesale at startup, the same call `useMilestoneStore` makes: a
 * person rates a few dozen dishes over a lifetime at the very most.
 */

interface DishRatingStore {
  dishes: DishRating[];
  initialized: boolean;
  /**
   * The dish the Food log is asking "would you order it again?" about, or null.
   * Session-only on purpose: an unanswered question is not worth carrying to
   * tomorrow, and ignoring it costs nothing (`DishRatingOffer`).
   */
  offer: { name: string } | null;
  initialize: () => void;
  /**
   * Saves a dish, or returns the one already saved under the same name and
   * place after applying a verdict or note the caller supplied, so rating a
   * dish twice from two screens is one row. Null for a blank name.
   */
  addDish: (input: DishInput) => DishRating | null;
  updateDish: (id: string, patch: DishPatch) => void;
  setVerdict: (id: string, verdict: DishVerdict | null) => void;
  removeDish: (id: string) => void;
  /** Raises the question for a meal just logged, unless the dish already has an answer. */
  offerRating: (label: string) => void;
  /** Answers it: rates the saved dish of that name, or saves one with no place. */
  rateOffered: (verdict: DishVerdict) => void;
  dismissOffer: () => void;
}

export const useDishRatingStore = create<DishRatingStore>((set, get) => ({
  dishes: [],
  initialized: false,
  offer: null,

  initialize() {
    set({ dishes: dbGetAllDishRatings(), initialized: true, offer: null });
  },

  addDish(input) {
    const existing = findDish(get().dishes, input.name, input.place);
    if (existing) {
      // A caller that supplied nothing to say leaves the saved row as it is:
      // re-adding a dish must not clear the verdict somebody already gave it.
      const patch: DishPatch = {};
      if (input.verdict !== undefined && input.verdict !== null) patch.verdict = input.verdict;
      if (input.note) patch.note = input.note;
      if (input.lastHadAt) patch.lastHadAt = input.lastHadAt;
      if (Object.keys(patch).length > 0) get().updateDish(existing.id, patch);
      return get().dishes.find(d => d.id === existing.id) ?? existing;
    }
    const dish = buildDishRating(input, generateId(), new Date());
    if (!dish) return null;
    dbInsertDishRating(dish);
    set({ dishes: [...get().dishes, dish] });
    return dish;
  },

  updateDish(id, patch) {
    const existing = get().dishes.find(d => d.id === id);
    if (!existing) return;
    const next = applyDishPatch(existing, patch);
    dbUpdateDishRating(next);
    set({ dishes: get().dishes.map(d => (d.id === id ? next : d)) });
  },

  setVerdict(id, verdict) {
    get().updateDish(id, { verdict });
  },

  removeDish(id) {
    dbDeleteDishRating(id);
    set({ dishes: get().dishes.filter(d => d.id !== id) });
  },

  offerRating(label) {
    set({ offer: dishOfferFor(get().dishes, label) });
  },

  rateOffered(verdict) {
    const offer = get().offer;
    set({ offer: null });
    if (!offer) return;
    const known = dishForLabel(get().dishes, offer.name);
    if (known) get().updateDish(known.id, { verdict, lastHadAt: new Date() });
    else get().addDish({ name: offer.name, verdict, lastHadAt: new Date() });
  },

  dismissOffer() {
    set({ offer: null });
  },
}));
