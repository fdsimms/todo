import { create } from 'zustand';
import type { Cookware, CookwareType } from '../types';
import {
  dbGetAllCookware,
  dbInsertCookware,
  dbUpdateCookware,
  dbDeleteCookware,
} from '../db/database';
import { generateId } from '../utils/id';
import { clampCookwareWeight } from '../utils/cookware';

/**
 * The pots, pans and tubs a dish can be weighed in. CRUD only: the subtraction
 * is `netWeight` in `src/utils/cookware.ts`, and no other row points at one.
 *
 * Loaded wholesale at startup like `useMilestoneStore`: a kitchen has a dozen
 * of these at most.
 */

export type CookwarePatch = Partial<Pick<Cookware, 'name' | 'weightG' | 'kind'>>;

interface CookwareStore {
  cookware: Cookware[];
  initialized: boolean;
  initialize: () => void;
  addCookware: (name: string, weightG: number, kind?: CookwareType | null) => Cookware | null;
  updateCookware: (id: string, patch: CookwarePatch) => void;
  removeCookware: (id: string) => void;
}

export const useCookwareStore = create<CookwareStore>((set, get) => ({
  cookware: [],
  initialized: false,

  initialize() {
    set({ cookware: dbGetAllCookware(), initialized: true });
  },

  // Refuses a blank name or a weight that isn't one; the sheet says why before
  // it ever calls this, so null here is a caller bug rather than a user path.
  addCookware(name, weightG, kind = null) {
    const trimmed = name.trim();
    const grams = clampCookwareWeight(weightG);
    if (!trimmed || grams === null) return null;
    const maxOrder = get().cookware.reduce((m, c) => Math.max(m, c.sortOrder), 0);
    const item: Cookware = {
      id: generateId(),
      name: trimmed,
      kind,
      weightG: grams,
      sortOrder: maxOrder + 1,
      createdAt: new Date().toISOString(),
    };
    dbInsertCookware(item);
    set({ cookware: [...get().cookware, item] });
    return item;
  },

  updateCookware(id, patch) {
    const existing = get().cookware.find(c => c.id === id);
    if (!existing) return;
    const next: Cookware = { ...existing };
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) return;
      next.name = trimmed;
    }
    if (patch.kind !== undefined) next.kind = patch.kind;
    if (patch.weightG !== undefined) {
      const grams = clampCookwareWeight(patch.weightG);
      if (grams === null) return;
      next.weightG = grams;
    }
    dbUpdateCookware(next);
    set({ cookware: get().cookware.map(c => (c.id === id ? next : c)) });
  },

  removeCookware(id) {
    dbDeleteCookware(id);
    set({ cookware: get().cookware.filter(c => c.id !== id) });
  },
}));
