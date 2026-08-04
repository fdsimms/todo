import { create } from 'zustand';
import type { Task, TaskTemplate, TemplateItem } from '../types';
import {
  dbGetAllTemplates,
  dbInsertTemplate,
  dbUpdateTemplate,
  dbDeleteTemplate,
} from '../db/database';
import { useTaskStore } from './useTaskStore';
import { generateId } from '../utils/id';
import { normalizeTemplateItem, buildDraftsFromTemplate, type TemplateAnchors } from '../utils/templateUtils';

interface TemplateStore {
  templates: TaskTemplate[];
  initialized: boolean;
  initialize: () => void;
  addTemplate: (name: string) => TaskTemplate;
  renameTemplate: (id: string, name: string) => void;
  deleteTemplate: (id: string) => void;
  setTemplateItems: (id: string, items: TemplateItem[]) => void;
  addItem: (templateId: string, item: Partial<TemplateItem>) => TemplateItem;
  updateItem: (templateId: string, itemId: string, updates: Partial<TemplateItem>) => void;
  deleteItem: (templateId: string, itemId: string) => void;
  reorderItems: (templateId: string, orderedIds: string[]) => void;
  applyTemplate: (templateId: string, selectedItemIds: Set<string>, anchors: TemplateAnchors) => Task[];
}

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  templates: [],
  initialized: false,

  initialize() {
    const templates = dbGetAllTemplates();
    set({ templates, initialized: true });
  },

  addTemplate(name) {
    const maxOrder = get().templates.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    const template: TaskTemplate = {
      id: generateId(),
      name,
      items: [],
      createdAt: new Date().toISOString(),
      sortOrder: maxOrder + 1,
    };
    dbInsertTemplate(template);
    set(s => ({ templates: [...s.templates, template] }));
    return template;
  },

  renameTemplate(id, name) {
    const template = get().templates.find(t => t.id === id);
    if (!template) return;
    const updated = { ...template, name };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === id ? updated : t)) }));
  },

  deleteTemplate(id) {
    dbDeleteTemplate(id);
    set(s => ({ templates: s.templates.filter(t => t.id !== id) }));
  },

  setTemplateItems(id, items) {
    const template = get().templates.find(t => t.id === id);
    if (!template) return;
    const updated = { ...template, items };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === id ? updated : t)) }));
  },

  addItem(templateId, item) {
    const normalized = normalizeTemplateItem(item);
    const template = get().templates.find(t => t.id === templateId);
    if (template) {
      get().setTemplateItems(templateId, [...template.items, normalized]);
    }
    return normalized;
  },

  updateItem(templateId, itemId, updates) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    get().setTemplateItems(
      templateId,
      template.items.map(i => (i.id === itemId ? { ...i, ...updates } : i))
    );
  },

  deleteItem(templateId, itemId) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    get().setTemplateItems(templateId, template.items.filter(i => i.id !== itemId));
  },

  reorderItems(templateId, orderedIds) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    const byId = new Map(template.items.map(i => [i.id, i]));
    const ordered = orderedIds.map(id => byId.get(id)).filter((i): i is TemplateItem => !!i);
    if (ordered.length !== template.items.length) return;
    get().setTemplateItems(templateId, ordered);
  },

  applyTemplate(templateId, selectedItemIds, anchors) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return [];
    const items = template.items.filter(i => selectedItemIds.has(i.id));
    const drafts = buildDraftsFromTemplate(items, anchors);
    const addTask = useTaskStore.getState().addTask;
    return drafts.map(d => addTask(d));
  },
}));
