import { create } from 'zustand';
import type { ProjectCategory } from '../types';
import { dbGetAllProjectCategories, dbInsertProjectCategory } from '../db/database';

interface ProjectCategoryStore {
  categories: ProjectCategory[];
  initialized: boolean;
  initialize: () => void;
  addCategory: (name: string) => ProjectCategory;
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
}));
