import { create } from 'zustand';
import type { Task, TaskTemplate, TemplateItem, TemplateItemGroup } from '../types';
import {
  dbGetAllTemplates,
  dbInsertTemplate,
  dbUpdateTemplate,
  dbDeleteTemplate,
  dbTransaction,
} from '../db/database';
import { useTaskStore } from './useTaskStore';
import { generateId } from '../utils/id';
import {
  normalizeTemplateItem,
  expandTemplateItems,
  buildDraftsFromTemplateTree,
  type TemplateAnchors,
} from '../utils/templateUtils';

interface TemplateStore {
  templates: TaskTemplate[];
  initialized: boolean;
  initialize: () => void;
  addTemplate: (name: string) => TaskTemplate;
  renameTemplate: (id: string, name: string) => void;
  setTemplateCategory: (id: string, category: string | null) => void;
  // Deletion's undo lives in useTaskStore, mirroring restoreProject/restoreGroup —
  // these are the low-level row operations it calls, kept here so this store
  // never has to import useTaskStore.
  removeTemplateRow: (id: string) => void;
  restoreTemplate: (template: TaskTemplate) => void;
  reorderTemplates: (orderedIds: string[]) => void;
  reorderTemplatesWithCategoryUpdates: (orderedIds: string[], categoryUpdates: Array<{ id: string; category: string | null }>) => void;
  setTemplateItems: (id: string, items: TemplateItem[]) => void;
  addItem: (templateId: string, item: Partial<TemplateItem>) => TemplateItem;
  updateItem: (templateId: string, itemId: string, updates: Partial<TemplateItem>) => void;
  deleteItem: (templateId: string, itemId: string) => void;
  reorderItems: (templateId: string, orderedIds: string[]) => void;
  addItemGroup: (templateId: string, title: string) => TemplateItemGroup;
  renameItemGroup: (templateId: string, groupId: string, title: string) => void;
  deleteItemGroup: (templateId: string, groupId: string) => void;
  groupItems: (templateId: string, itemIds: string[], title: string) => TemplateItemGroup;
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
      itemGroups: [],
      createdAt: new Date().toISOString(),
      sortOrder: maxOrder + 1,
      category: null,
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

  setTemplateCategory(id, category) {
    const template = get().templates.find(t => t.id === id);
    if (!template) return;
    const updated = { ...template, category };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === id ? updated : t)) }));
  },

  removeTemplateRow(id) {
    dbDeleteTemplate(id);
    set(s => ({ templates: s.templates.filter(t => t.id !== id) }));
  },

  restoreTemplate(template) {
    dbInsertTemplate(template);
    set(s => ({ templates: [...s.templates, template] }));
  },

  reorderTemplates(orderedIds) {
    const byId = new Map(get().templates.map(t => [t.id, t]));
    const ordered = orderedIds.map(id => byId.get(id)).filter((t): t is TaskTemplate => !!t);
    if (ordered.length !== get().templates.length) return;
    const updated = ordered.map((t, index) => ({ ...t, sortOrder: index + 1 }));
    updated.forEach(t => dbUpdateTemplate(t));
    set(() => ({ templates: updated }));
  },

  reorderTemplatesWithCategoryUpdates(orderedIds, categoryUpdates) {
    get().reorderTemplates(orderedIds);
    categoryUpdates.forEach(u => get().setTemplateCategory(u.id, u.category));
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

  addItemGroup(templateId, title) {
    const template = get().templates.find(t => t.id === templateId);
    const group: TemplateItemGroup = {
      id: generateId(),
      title,
      sortOrder: (template?.itemGroups.reduce((m, g) => Math.max(m, g.sortOrder), 0) ?? 0) + 1,
    };
    if (template) {
      const updated = { ...template, itemGroups: [...template.itemGroups, group] };
      dbUpdateTemplate(updated);
      set(s => ({ templates: s.templates.map(t => (t.id === templateId ? updated : t)) }));
    }
    return group;
  },

  renameItemGroup(templateId, groupId, title) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    const updated = {
      ...template,
      itemGroups: template.itemGroups.map(g => (g.id === groupId ? { ...g, title } : g)),
    };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === templateId ? updated : t)) }));
  },

  deleteItemGroup(templateId, groupId) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    const updated = {
      ...template,
      itemGroups: template.itemGroups.filter(g => g.id !== groupId),
      items: template.items.map(i => (i.groupId === groupId ? { ...i, groupId: null } : i)),
    };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === templateId ? updated : t)) }));
  },

  groupItems(templateId, itemIds, title) {
    const group = get().addItemGroup(templateId, title);
    const template = get().templates.find(t => t.id === templateId);
    if (template) {
      const idSet = new Set(itemIds);
      get().setTemplateItems(
        templateId,
        template.items.map(i => (idSet.has(i.id) ? { ...i, groupId: group.id } : i))
      );
    }
    return group;
  },

  applyTemplate(templateId, selectedItemIds, anchors) {
    const templatesById = new Map(get().templates.map(t => [t.id, t]));
    const template = templatesById.get(templateId);
    if (!template) return [];
    const expanded = expandTemplateItems(template.items, templateId, selectedItemIds, templatesById);
    const drafts = buildDraftsFromTemplateTree(expanded, anchors);
    const addTask = useTaskStore.getState().addTask;
    const addSubtask = useTaskStore.getState().addSubtask;
    const groupTasks = useTaskStore.getState().groupTasks;

    let createdTasks: Task[] = [];
    dbTransaction(() => {
      createdTasks = drafts.map(d => addTask(d));

      // Second pass: subtasks and groups need ids that don't exist until
      // addTask returns, so they can't be part of the draft itself. Group keys
      // are namespaced by sourceTemplateId since one apply can now pull items
      // from multiple (nested) templates.
      const createdTaskIdsByGroup = new Map<string, string[]>();
      expanded.forEach(({ item, sourceTemplateId }, index) => {
        const createdTask = createdTasks[index];
        if (!createdTask) return;

        item.subtasks.forEach(stub => addSubtask(createdTask.id, stub.title));

        if (item.groupId) {
          const key = `${sourceTemplateId}:${item.groupId}`;
          const list = createdTaskIdsByGroup.get(key) ?? [];
          list.push(createdTask.id);
          createdTaskIdsByGroup.set(key, list);
        }
      });

      createdTaskIdsByGroup.forEach((taskIds, key) => {
        const separatorIndex = key.indexOf(':');
        const sourceTemplateId = key.slice(0, separatorIndex);
        const groupId = key.slice(separatorIndex + 1);
        const sourceTemplate = templatesById.get(sourceTemplateId);
        const group = sourceTemplate?.itemGroups.find(g => g.id === groupId);
        if (!group || taskIds.length === 0) return;
        const category = expanded.find(
          e => e.sourceTemplateId === sourceTemplateId && e.item.groupId === groupId
        )?.item.category ?? null;
        groupTasks(taskIds, group.title, category);
      });
    });

    return createdTasks;
  },
}));
