import { create } from 'zustand';
import type { SavedView, SavedViewClause } from '../types';
import {
  dbBatchUpdateSavedViewSortOrders,
  dbDeleteSavedView,
  dbGetAllSavedViews,
  dbInsertSavedView,
  dbNextSavedViewSortOrder,
  dbUpdateSavedView,
} from '../db/database';
import { generateId } from '../utils/id';
import { DEFAULT_SAVED_VIEW_ICON } from '../utils/savedViews';

/**
 * The saved views a person has kept (#2679).
 *
 * Rows only. What a view *means* is in `src/utils/savedViews.ts`, which stays
 * store-free so it and its tests keep running in Jest's node environment; this
 * holds the list and writes it, like every other small entity store.
 *
 * It is initialized from `useTaskStore.initialize()`'s fan-out rather than from
 * App.tsx, which is load-bearing: entering and leaving demo mode, and restoring
 * from a backup, all reload by calling that function after swapping the
 * database file. A store initialized outside it would keep its rows pointed at
 * the database that just went away.
 */
interface SavedViewStore {
  views: SavedView[];
  initialized: boolean;
  initialize: () => void;
  createView: (name: string, icon?: string, clauses?: SavedViewClause[]) => SavedView;
  updateView: (id: string, patch: Partial<Pick<SavedView, 'name' | 'icon' | 'clauses'>>) => void;
  getViewById: (id: string) => SavedView | null;
  reorderViews: (ids: string[]) => void;
  removeView: (id: string) => void;
  restoreView: (view: SavedView) => void;
}

export const useSavedViewStore = create<SavedViewStore>((set, get) => ({
  views: [],
  initialized: false,

  initialize() {
    const views = dbGetAllSavedViews();
    set({ views, initialized: true });
  },

  createView(name, icon = DEFAULT_SAVED_VIEW_ICON, clauses = []) {
    const view: SavedView = {
      id: generateId(),
      name,
      icon,
      clauses,
      // Asked of the database rather than derived from state, so a view made
      // while the list is still loading can't collide with one already stored.
      sortOrder: dbNextSavedViewSortOrder(),
      createdAt: new Date().toISOString(),
    };
    dbInsertSavedView(view);
    set(s => ({ views: [...s.views, view] }));
    return view;
  },

  updateView(id, patch) {
    const view = get().views.find(v => v.id === id);
    if (!view) return;
    const updated = { ...view, ...patch };
    dbUpdateSavedView(updated);
    set(s => ({ views: s.views.map(v => (v.id === id ? updated : v)) }));
  },

  getViewById(id) {
    return get().views.find(v => v.id === id) ?? null;
  },

  /** Renumbers to the given order, one transaction, same as categories. */
  reorderViews(ids) {
    const byId = new Map(get().views.map(v => [v.id, v]));
    const ordered = ids
      .map(id => byId.get(id))
      .filter((v): v is SavedView => v !== undefined);
    if (ordered.length !== get().views.length) return;
    const updates = ordered.map((v, index) => ({ id: v.id, sortOrder: index + 1 }));
    dbBatchUpdateSavedViewSortOrders(updates);
    set({ views: ordered.map((v, index) => ({ ...v, sortOrder: index + 1 })) });
  },

  removeView(id) {
    dbDeleteSavedView(id);
    set(s => ({ views: s.views.filter(v => v.id !== id) }));
  },

  restoreView(view) {
    dbInsertSavedView(view);
    set(s => ({
      views: [...s.views, view].sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  },
}));
