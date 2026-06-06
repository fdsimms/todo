import { create } from 'zustand';
import type { Project, ProjectDraft } from '../types';
import {
  dbGetAllProjects,
  dbInsertProject,
  dbUpdateProject,
  dbDeleteProject,
  dbBatchUpdateProjectOrders,
} from '../db/database';
import { generateId } from '../utils/id';

interface ProjectStore {
  projects: Project[];
  initialized: boolean;

  initialize: () => void;
  addProject: (draft: ProjectDraft) => Project;
  updateProject: (id: string, updates: Partial<ProjectDraft>) => void;
  deleteProject: (id: string) => void;
  reorderProjects: (orderedIds: string[]) => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  initialized: false,

  initialize() {
    const projects = dbGetAllProjects();
    set({ projects, initialized: true });
  },

  addProject(draft) {
    const now = new Date().toISOString();
    const maxOrder = get().projects.reduce((m, p) => Math.max(m, p.order), 0);
    const project: Project = {
      id: generateId(),
      name: draft.name,
      notes: draft.notes,
      dueDate: draft.dueDate,
      color: draft.color,
      order: maxOrder + 1,
      createdAt: now,
    };
    dbInsertProject(project);
    set(s => ({ projects: [...s.projects, project] }));
    return project;
  },

  updateProject(id, updates) {
    const projects = get().projects.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, ...updates };
      dbUpdateProject(updated);
      return updated;
    });
    set({ projects });
  },

  deleteProject(id) {
    dbDeleteProject(id);
    set(s => ({ projects: s.projects.filter(p => p.id !== id) }));
  },

  reorderProjects(orderedIds) {
    const updates = orderedIds.map((id, index) => ({ id, order: index + 1 }));
    dbBatchUpdateProjectOrders(updates);
    set(s => ({
      projects: s.projects.map(p => {
        const u = updates.find(x => x.id === p.id);
        return u ? { ...p, order: u.order } : p;
      }),
    }));
  },
}));
