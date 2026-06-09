import { create } from 'zustand';
import type { Category } from '../types';
import {
  dbGetAllCategories,
  dbInsertCategory,
  dbUpdateCategory,
  dbDeleteCategory,
} from '../db/database';

interface CategoryStore {
  categories: Category[];
  initialized: boolean;
  initialize: () => void;
  addCategory: (name: string) => Category;
  deleteCategory: (name: string) => void;
  setCategorySchedule: (name: string, scheduleDays: number[], scheduleStart: string, scheduleEnd: string) => void;
  removeCategorySchedule: (name: string) => void;
  getCategoryByName: (name: string) => Category | null;
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

  getCategoryByName(name) {
    return get().categories.find(c => c.name === name) ?? null;
  },
}));
