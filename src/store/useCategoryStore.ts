import { create } from 'zustand';
import type { Category } from '../types';
import {
  dbGetAllCategories,
  dbInsertCategory,
  dbUpdateCategory,
  dbDeleteCategory,
  dbSetCategoryHideOnVacation,
  dbSetCategoryEmoji,
  dbBatchUpdateCategorySortOrders,
} from '../db/database';

interface CategoryStore {
  categories: Category[];
  initialized: boolean;
  initialize: () => void;
  addCategory: (name: string) => Category;
  deleteCategory: (name: string) => void;
  setCategorySchedule: (name: string, scheduleDays: number[], scheduleStart: string, scheduleEnd: string) => void;
  removeCategorySchedule: (name: string) => void;
  setCategoryHideOnVacation: (name: string, hide: boolean) => void;
  setCategoryEmoji: (name: string, emoji: string | null) => void;
  getCategoryByName: (name: string) => Category | null;
  reorderCategories: (orderedNames: string[]) => void;
}

export const useCategoryStore = create<CategoryStore>((set, get) => ({
  categories: [],
  initialized: false,

  initialize() {
    const categories = dbGetAllCategories();
    set({ categories, initialized: true });
  },

  addCategory(name) {
    const existing = get().categories.find(c => c.name === name);
    if (existing) return existing;
    const category = dbInsertCategory(name);
    set(s => ({ categories: [...s.categories, category] }));
    return category;
  },

  deleteCategory(name) {
    dbDeleteCategory(name);
    set(s => ({ categories: s.categories.filter(c => c.name !== name) }));
  },

  setCategorySchedule(name, scheduleDays, scheduleStart, scheduleEnd) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    dbUpdateCategory(cat.id, { scheduleDays, scheduleStart, scheduleEnd });
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, scheduleDays, scheduleStart, scheduleEnd } : c
      ),
    }));
  },

  removeCategorySchedule(name) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    dbUpdateCategory(cat.id, { scheduleDays: null, scheduleStart: null, scheduleEnd: null });
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, scheduleDays: null, scheduleStart: null, scheduleEnd: null } : c
      ),
    }));
  },

  setCategoryHideOnVacation(name, hide) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    dbSetCategoryHideOnVacation(cat.id, hide);
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, hideOnVacation: hide } : c
      ),
    }));
  },

  setCategoryEmoji(name, emoji) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    const trimmed = emoji?.trim() || null;
    dbSetCategoryEmoji(cat.id, trimmed);
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, emoji: trimmed } : c
      ),
    }));
  },

  getCategoryByName(name) {
    return get().categories.find(c => c.name === name) ?? null;
  },

  reorderCategories(orderedNames) {
    // Names not yet backed by a category row (e.g. a legacy task category
    // that predates the registry) are registered on the fly so they get a
    // stable id/sortOrder like everything else.
    const ensured = orderedNames.map(name => get().getCategoryByName(name) ?? get().addCategory(name));
    const updates = ensured.map((c, index) => ({ id: c.id, sortOrder: index + 1 }));
    dbBatchUpdateCategorySortOrders(updates);
    set(s => ({
      categories: s.categories.map(c => {
        const u = updates.find(x => x.id === c.id);
        return u ? { ...c, sortOrder: u.sortOrder } : c;
      }),
    }));
  },
}));
