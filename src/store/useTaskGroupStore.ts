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
  // projectId is the screen the stack was made on, not something derived from
  // its members — see TaskGroup.projectId. Omitted everywhere but a project's
  // own page, which is the only place a memberless stack has to be able to
  // sit; the stack editor can change it afterward through updateGroup.
  createGroup: (title: string, category: string | null, projectId?: string | null) => TaskGroup;
  updateGroup: (id: string, patch: Partial<Pick<TaskGroup, 'title' | 'notes' | 'tags' | 'category' | 'sortOrder' | 'projectId'>>) => void;
  setGroupCollapsed: (id: string, collapsed: boolean) => void;
  // Called by the Today screen with the ids of every stack currently on it,
  // visible rows and Later Today alike. A stack that wasn't on Today and now
  // is arrives collapsed; one that's left is just recorded as gone. See
  // TaskGroup.onToday.
  syncTodayPresence: (presentIds: Set<string>) => void;
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

  createGroup(title, category, projectId = null) {
    const maxOrder = get().groups.reduce((m, g) => Math.max(m, g.sortOrder), 0);
    const group: TaskGroup = {
      id: generateId(),
      title,
      notes: '',
      tags: [],
      category,
      sortOrder: maxOrder + 1,
      collapsed: true,
      // Today marks it the moment it draws it — a stack made from a member
      // that's on today is one Today is about to render, not one arriving
      // from somewhere else, and it's created collapsed either way.
      onToday: false,
      projectId,
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

  syncTodayPresence(presentIds) {
    const changed: TaskGroup[] = [];
    const groups = get().groups.map(g => {
      const present = presentIds.has(g.id);
      if (present === g.onToday) return g;
      // Arriving collapses; leaving only records that it left, so the state
      // the user last set is what a stack that never leaves keeps.
      const updated: TaskGroup = present ? { ...g, onToday: true, collapsed: true } : { ...g, onToday: false };
      changed.push(updated);
      return updated;
    });
    if (changed.length === 0) return;
    for (const g of changed) dbUpdateTaskGroup(g);
    set({ groups });
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
