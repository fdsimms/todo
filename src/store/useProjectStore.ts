import { create } from 'zustand';
import type { Project, Task } from '../types';
import {
  dbGetAllProjects,
  dbInsertProject,
  dbUpdateProject,
  dbDeleteProject,
  dbBatchUpdateProjectSortOrders,
} from '../db/database';
import { generateId } from '../utils/id';

// Progress is derived, never stored: every top-level (non-subtask) task
// assigned to the project counts, including tasks that also belong to a
// TaskGroup — groupId doesn't exclude a task from a project's progress.
// Individually-archived tasks are excluded from both sides of the ratio so
// an archived-but-incomplete task can't permanently cap a project below 100%.
export function projectProgress(projectId: string, tasks: Task[]): { done: number; total: number } {
  const members = tasks.filter(t => t.projectId === projectId && t.parentId === null && !t.archived);
  return { done: members.filter(t => t.completed).length, total: members.length };
}

// A project is only flagged "past its window" when it missed its target end
// date while still incomplete and not archived — nothing automatic happens,
// this is purely a visual cue so the user can decide what to do about it.
export function isProjectPastWindow(project: Project, progress: { done: number; total: number }): boolean {
  if (!project.targetEndDate || project.archived) return false;
  if (progress.total > 0 && progress.done === progress.total) return false;
  return new Date(project.targetEndDate).getTime() < Date.now();
}

interface ProjectStore {
  projects: Project[];
  initialized: boolean;
  initialize: () => void;
  createProject: (title: string, targetStartDate: string | null, targetEndDate: string | null) => Project;
  updateProject: (id: string, patch: Partial<Pick<Project, 'title' | 'notes' | 'targetStartDate' | 'targetEndDate' | 'category'>>) => void;
  getProjectById: (id: string) => Project | null;
  reorderProjects: (orderedIds: string[]) => void;
  archiveProject: (id: string) => void;
  unarchiveProject: (id: string) => void;
  // Deletion lives in useTaskStore since it needs to touch tasks too; these
  // are the low-level row operations it calls once members are handled.
  removeProjectRow: (id: string) => void;
  restoreProject: (project: Project) => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  initialized: false,

  initialize() {
    const projects = dbGetAllProjects();
    set({ projects, initialized: true });
  },

  createProject(title, targetStartDate, targetEndDate) {
    const maxOrder = get().projects.reduce((m, p) => Math.max(m, p.sortOrder), 0);
    const project: Project = {
      id: generateId(),
      title,
      notes: '',
      targetStartDate,
      targetEndDate,
      category: null,
      sortOrder: maxOrder + 1,
      archived: false,
      archivedAt: null,
      createdAt: new Date().toISOString(),
    };
    dbInsertProject(project);
    set(s => ({ projects: [...s.projects, project] }));
    return project;
  },

  updateProject(id, patch) {
    const project = get().projects.find(p => p.id === id);
    if (!project) return;
    const updated = { ...project, ...patch };
    dbUpdateProject(updated);
    set(s => ({ projects: s.projects.map(p => (p.id === id ? updated : p)) }));
  },

  getProjectById(id) {
    return get().projects.find(p => p.id === id) ?? null;
  },

  reorderProjects(orderedIds) {
    const updates = orderedIds.map((id, index) => ({ id, sortOrder: index }));
    dbBatchUpdateProjectSortOrders(updates);
    set(s => ({
      projects: s.projects
        .map(p => {
          const sortOrder = updates.find(u => u.id === p.id)?.sortOrder;
          return sortOrder === undefined ? p : { ...p, sortOrder };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  },

  archiveProject(id) {
    const project = get().projects.find(p => p.id === id);
    if (!project || project.archived) return;
    const updated = { ...project, archived: true, archivedAt: new Date().toISOString() };
    dbUpdateProject(updated);
    set(s => ({ projects: s.projects.map(p => (p.id === id ? updated : p)) }));
  },

  unarchiveProject(id) {
    const project = get().projects.find(p => p.id === id);
    if (!project || !project.archived) return;
    const updated = { ...project, archived: false, archivedAt: null };
    dbUpdateProject(updated);
    set(s => ({ projects: s.projects.map(p => (p.id === id ? updated : p)) }));
  },

  removeProjectRow(id) {
    dbDeleteProject(id);
    set(s => ({ projects: s.projects.filter(p => p.id !== id) }));
  },

  restoreProject(project) {
    dbInsertProject(project);
    set(s => ({ projects: [...s.projects, project] }));
  },
}));
