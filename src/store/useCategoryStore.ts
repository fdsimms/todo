import { create } from 'zustand';
import type { Category } from '../types';
import {
  dbGetAllCategories,
  dbInsertCategory,
  dbInsertCategoryRow,
  dbUpdateCategory,
  dbDeleteCategory,
  dbRenameCategory,
  dbSetCategoryHideOnVacation,
  dbSetCategoryExcludeFromPinSuggestions,
  dbSetCategoryEmoji,
  dbBatchUpdateCategorySortOrders,
} from '../db/database';
import { firstEmoji } from '../utils/emojiInput';

interface CategoryStore {
  categories: Category[];
  initialized: boolean;
  initialize: () => void;
  addCategory: (name: string) => Category;
  deleteCategory: (name: string) => void;
  // Undo lives in useTaskStore since deleting a category also touches tasks
  // and stacks; this is the low-level row restore it calls once it's undone
  // those side effects.
  restoreCategory: (category: Category) => void;
  renameCategory: (name: string, newName: string) => boolean;
  setCategorySchedule: (name: string, scheduleDays: number[], scheduleStart: string, scheduleEnd: string) => void;
  removeCategorySchedule: (name: string) => void;
  setCategoryHideOnVacation: (name: string, hide: boolean) => void;
  setCategoryExcludeFromPinSuggestions: (name: string, exclude: boolean) => void;
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

  restoreCategory(category) {
    dbInsertCategoryRow(category);
    set(s => ({ categories: [...s.categories, category] }));
  },

  renameCategory(name, newName) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) return false;
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return false;
    if (get().categories.some(c => c.name === trimmed)) return false;
    dbRenameCategory(cat.id, name, trimmed);
    set(s => ({
      categories: s.categories.map(c => (c.id === cat.id ? { ...c, name: trimmed } : c)),
    }));
    return true;
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

  setCategoryExcludeFromPinSuggestions(name, exclude) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    dbSetCategoryExcludeFromPinSuggestions(cat.id, exclude);
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, excludeFromPinSuggestions: exclude } : c
      ),
    }));
  },

  setCategoryEmoji(name, emoji) {
    const cat = get().categories.find(c => c.name === name);
    if (!cat) return;
    // One emoji, always — every write lands here, so clamping at this one point
    // is what keeps a two-emoji category from existing at all. See emojiInput.ts
    // for why "one emoji" can't be expressed as a string length.
    const single = firstEmoji(emoji) || null;
    dbSetCategoryEmoji(cat.id, single);
    set(s => ({
      categories: s.categories.map(c =>
        c.name === name ? { ...c, emoji: single } : c
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
