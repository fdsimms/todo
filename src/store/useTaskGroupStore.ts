import { create } from 'zustand';
import type { TaskGroup } from '../types';
import {
  dbGetAllTaskGroups,
  dbInsertTaskGroup,
  dbUpdateTaskGroup,
  dbDeleteTaskGroup,
} from '../db/database';
import { generateId } from '../utils/id';

interface TaskGroupStore {
  groups: TaskGroup[];
  initialized: boolean;
  initialize: () => void;
  createGroup: (title: string, category: string | null) => TaskGroup;
  updateGroup: (id: string, patch: Partial<Pick<TaskGroup, 'title' | 'notes' | 'tags' | 'category' | 'sortOrder'>>) => void;
  setGroupCollapsed: (id: string, collapsed: boolean) => void;
  setGroupCompletedAt: (id: string, completedAt: string | null) => void;
  getGroupById: (id: string) => TaskGroup | null;
  // Deletion lives in useTaskStore since it needs to touch tasks too; these
  // are the low-level row operations it calls once children are handled.
  removeGroupRow: (id: string) => void;
  restoreGroup: (group: TaskGroup) => void;
}

export const useTaskGroupStore = create<TaskGroupStore>((set, get) => ({
  groups: [],
  initialized: false,

  initialize() {
    const groups = dbGetAllTaskGroups();
    set({ groups, initialized: true });
  },

  createGroup(title, category) {
    const maxOrder = get().groups.reduce((m, g) => Math.max(m, g.sortOrder), 0);
    const group: TaskGroup = {
      id: generateId(),
      title,
      notes: '',
      tags: [],
      category,
      sortOrder: maxOrder + 1,
      collapsed: true,
      completedAt: null,
    };
    dbInsertTaskGroup(group);
    set(s => ({ groups: [...s.groups, group] }));
    return group;
  },

  updateGroup(id, patch) {
    const group = get().groups.find(g => g.id === id);
    if (!group) return;
    const updated = { ...group, ...patch };
    dbUpdateTaskGroup(updated);
    set(s => ({ groups: s.groups.map(g => (g.id === id ? updated : g)) }));
  },

  setGroupCollapsed(id, collapsed) {
    const group = get().groups.find(g => g.id === id);
    if (!group || group.collapsed === collapsed) return;
    const updated = { ...group, collapsed };
    dbUpdateTaskGroup(updated);
    set(s => ({ groups: s.groups.map(g => (g.id === id ? updated : g)) }));
  },

  setGroupCompletedAt(id, completedAt) {
    const group = get().groups.find(g => g.id === id);
    if (!group || group.completedAt === completedAt) return;
    const updated = { ...group, completedAt };
    dbUpdateTaskGroup(updated);
    set(s => ({ groups: s.groups.map(g => (g.id === id ? updated : g)) }));
  },

  getGroupById(id) {
    return get().groups.find(g => g.id === id) ?? null;
  },

  removeGroupRow(id) {
    dbDeleteTaskGroup(id);
    set(s => ({ groups: s.groups.filter(g => g.id !== id) }));
  },

  restoreGroup(group) {
    dbInsertTaskGroup(group);
    set(s => ({ groups: [...s.groups, group] }));
  },
}));
