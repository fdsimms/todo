import { create } from 'zustand';
import type { TemplateCategory } from '../types';
import { dbGetAllTemplateCategories, dbInsertTemplateCategory } from '../db/database';
import { keepUnchanged } from '../utils/structuralSharing';

interface TemplateCategoryStore {
  categories: TemplateCategory[];
  initialized: boolean;
  initialize: () => void;
  addCategory: (name: string) => TemplateCategory;
}

export const useTemplateCategoryStore = create<TemplateCategoryStore>((set, get) => ({
  categories: [],
  initialized: false,

  initialize() {
    const categories = dbGetAllTemplateCategories();
    set(state => keepUnchanged(state, { categories, initialized: true }));
  },

  addCategory(name) {
    const existing = get().categories.find(c => c.name === name);
    if (existing) return existing;
    const category = dbInsertTemplateCategory(name);
    set(s => ({ categories: [...s.categories, category] }));
    return category;
  },
}));
