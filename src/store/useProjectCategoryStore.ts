import { create } from 'zustand';
import type { ProjectCategory } from '../types';
import {
  dbGetAllProjectCategories,
  dbInsertProjectCategory,
  dbInsertProjectCategoryRow,
  dbDeleteProjectCategory,
  dbRenameProjectCategory,
  dbBatchUpdateProjectCategorySortOrders,
} from '../db/database';

/**
 * The project-grouping vocabulary, which the user builds and now also edits.
 *
 * This store was `initialize` and `addCategory` and nothing else for as long as
 * project categories existed, which made the whole set append-only: a name
 * typed with a typo was permanent, a section that emptied out stayed in every
 * picker for good, and the `sort_order` column the table has carried since day
 * one was written once at insert and never again — so `groupProjectsByCategory`
 * faithfully sorted the sections into permanent creation order. Task categories
 * have had rename/delete/reorder the whole time; this is the same three, with
 * the one difference the model demands.
 *
 * **That difference: a project category never touches a task.** `Project.category`
 * groups projects on the Projects page and is deliberately independent of the
 * task `Category` a project's members carry (see the note on the field). So
 * deleting one unfiles the *projects* in it and nothing else, where
 * `dbDeleteCategory` also has tasks and stacks to clear.
 *
 * Undo lives in `useTaskStore` alongside every other undoable action, which is
 * why delete and rename are split the way the task-category ones are: the store
 * owns the row write, and `restoreProjectCategory` is the low-level restore the
 * undo entry calls.
 */
interface ProjectCategoryStore {
  categories: ProjectCategory[];
  initialized: boolean;
  initialize: () => void;
  addCategory: (name: string) => ProjectCategory;
  /** Unfiles the projects in it; the undo entry is registered by useTaskStore. */
  removeCategoryRow: (name: string) => void;
  restoreCategory: (category: ProjectCategory) => void;
  /** False when the name is blank or already taken — the caller keeps the sheet open. */
  renameCategory: (name: string, newName: string) => boolean;
  reorderCategories: (orderedNames: string[]) => void;
  getCategoryByName: (name: string) => ProjectCategory | null;
}

export const useProjectCategoryStore = create<ProjectCategoryStore>((set, get) => ({
  categories: [],
  initialized: false,

  initialize() {
    const categories = dbGetAllProjectCategories();
    set({ categories, initialized: true });
  },

  addCategory(name) {
    const existing = get().categories.find(c => c.name === name);
    if (existing) return existing;
    const category = dbInsertProjectCategory(name);
    set(s => ({ categories: [...s.categories, category] }));
    return category;
  },

  removeCategoryRow(name) {
    dbDeleteProjectCategory(name);
    set(s => ({ categories: s.categories.filter(c => c.name !== name) }));
  },

  restoreCategory(category) {
    dbInsertProjectCategoryRow(category);
    set(s => ({
      categories: [...s.categories, category].sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  },

  renameCategory(name, newName) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) return false;
    const category = get().categories.find(c => c.name === name);
    if (!category) return false;
    // Names are the identity here — Project.category stores the name, not the
    // id — so a collision would silently merge two sections rather than rename
    // one. Refused, and the caller keeps its field open.
    if (get().categories.some(c => c.name === trimmed)) return false;
    dbRenameProjectCategory(category.id, name, trimmed);
    set(s => ({
      categories: s.categories.map(c => (c.id === category.id ? { ...c, name: trimmed } : c)),
    }));
    return true;
  },

  reorderCategories(orderedNames) {
    const byName = new Map(get().categories.map(c => [c.name, c]));
    const updates = orderedNames
      .map((name, index) => {
        const category = byName.get(name);
        return category ? { id: category.id, sortOrder: index } : null;
      })
      .filter((u): u is { id: string; sortOrder: number } => u !== null);
    if (updates.length === 0) return;
    dbBatchUpdateProjectCategorySortOrders(updates);
    const orderById = new Map(updates.map(u => [u.id, u.sortOrder]));
    set(s => ({
      categories: s.categories
        .map(c => (orderById.has(c.id) ? { ...c, sortOrder: orderById.get(c.id)! } : c))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  },

  getCategoryByName(name) {
    return get().categories.find(c => c.name === name) ?? null;
  },
}));
