import { create } from 'zustand';
import type { PersonGroup } from '../types';
import {
  dbGetAllPersonGroups,
  dbInsertPersonGroup,
  dbUpdatePersonGroup,
  dbDeletePersonGroup,
} from '../db/database';
import { generateId } from '../utils/id';
import { registerPersonGroupSource } from '../utils/peopleRegistry';
import { usePersonStore } from './usePersonStore';

/**
 * Couples and households — see the "Groups" section of `docs/arch/people.md`.
 *
 * Modeled on `useTaskGroupStore`: a lightweight, renameable label, hand-ordered
 * like everything else in the people layer, carrying nothing about the people
 * in it beyond their `groupId` pointer. No cadence, no history, no nudge
 * settings of its own — those stay on each `Person`, exactly as rule 3 in
 * `docs/arch/people.md` keeps the People list itself from becoming a second
 * place to rank anybody.
 */
interface PersonGroupStore {
  groups: PersonGroup[];
  initialized: boolean;
  initialize: () => void;
  createGroup: (name: string) => PersonGroup;
  updateGroup: (id: string, patch: Partial<Pick<PersonGroup, 'name'>>) => void;
  reorderGroups: (orderedIds: string[]) => void;
  getGroupById: (id: string) => PersonGroup | null;
  /** Deletes the group and frees its members — nobody in it is deleted. */
  removeGroupRow: (id: string) => void;
}

export const usePersonGroupStore = create<PersonGroupStore>((set, get) => ({
  groups: [],
  initialized: false,

  initialize() {
    set({ groups: dbGetAllPersonGroups(), initialized: true });
  },

  createGroup(name) {
    const maxOrder = get().groups.reduce((m, g) => Math.max(m, g.sortOrder), 0);
    const group: PersonGroup = {
      id: generateId(),
      name: name.trim(),
      sortOrder: maxOrder + 1,
      createdAt: new Date().toISOString(),
    };
    dbInsertPersonGroup(group);
    set({ groups: [...get().groups, group] });
    return group;
  },

  updateGroup(id, patch) {
    const group = get().groups.find(g => g.id === id);
    if (!group) return;
    const next: PersonGroup = { ...group, ...patch };
    dbUpdatePersonGroup(next);
    set({ groups: get().groups.map(g => (g.id === id ? next : g)) });
  },

  // Hand-ordered, the same independent space Person.sortOrder is — never
  // re-ranked by recency or by anything about a group's members.
  reorderGroups(orderedIds) {
    const updates = orderedIds.map((id, i) => ({ id, sortOrder: i + 1 }));
    const bySort = new Map(updates.map(u => [u.id, u.sortOrder]));
    get().groups.forEach(g => {
      const sortOrder = bySort.get(g.id);
      if (sortOrder !== undefined) dbUpdatePersonGroup({ ...g, sortOrder });
    });
    set({
      groups: get().groups
        .map(g => (bySort.has(g.id) ? { ...g, sortOrder: bySort.get(g.id)! } : g))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    });
  },

  getGroupById(id) {
    return get().groups.find(g => g.id === id) ?? null;
  },

  removeGroupRow(id) {
    // Frees every member first — a person is never deleted by this, only
    // unlinked, the same shrug-not-cascade rule the rest of the people layer
    // uses for a dangling pointer.
    usePersonStore.getState().clearGroupMembership(id);
    dbDeletePersonGroup(id);
    set({ groups: get().groups.filter(g => g.id !== id) });
  },
}));

// Pushed in at module load, the same pattern usePersonStore uses for
// registerPersonSource: the registry is a leaf module importing nothing but
// types, so a row renderer can resolve a group without pulling expo-sqlite
// into the `node` test environment.
registerPersonGroupSource(() => usePersonGroupStore.getState().groups);
