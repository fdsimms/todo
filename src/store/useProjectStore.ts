import { create } from 'zustand';
import type { Project, Task } from '../types';
import { DEFAULT_NUDGE_CADENCE_DAYS } from '../types';
import { isRealCompletion } from '../utils/missed';
import {
  dbGetAllProjects,
  dbInsertProject,
  dbUpdateProject,
  dbDeleteProject,
  dbBatchUpdateProjectSortOrders,
} from '../db/database';
import { generateId } from '../utils/id';
import { registerProjectSource } from '../utils/blockerRegistry';

/**
 * What one member of a project is, as far as counting goes: a task, not a row.
 *
 * The same problem groupRoster solves for stacks, with a different answer.
 * Completing a recurring task leaves the completed row behind and inserts a
 * fresh one, both carrying the projectId, so counting rows grew the
 * denominator by one per completion forever — a project holding a single daily
 * task read 0/1, then 1/2, 2/3, 3/4, a bar creeping toward a 100% it could
 * never reach, and a total that was really a completion count. A dated series
 * is several rows standing for one commitment and read as that many members.
 *
 * groupRoster itself is the wrong tool here: it drops old completions as
 * tombstones, which is right for a stack (they aren't members any more) and
 * wrong for a project, where a one-off finished last week is exactly a member
 * and exactly done. So rows are grouped by identity instead — a shared
 * seriesId, or the root of the previousOccurrenceId chain — and each identity
 * counts once, done only when it has no row left outstanding. A project
 * holding a habit therefore never reads 100%, which is the honest answer.
 */
function memberKey(task: Task, byId: Map<string, Task>): string {
  if (task.seriesId) return `series:${task.seriesId}`;
  let root = task;
  const seen = new Set<string>([root.id]);
  while (root.previousOccurrenceId) {
    const prev = byId.get(root.previousOccurrenceId);
    // The guard is for a loop that arrived some other way, not one we expect —
    // this runs during render (see wouldCycle for the same defensiveness).
    if (!prev || seen.has(prev.id)) break;
    seen.add(prev.id);
    root = prev;
  }
  return `task:${root.id}`;
}

// Progress is derived, never stored: every top-level (non-subtask) task
// assigned to the project counts, including tasks that also belong to a
// TaskGroup — groupId doesn't exclude a task from a project's progress.
// Individually-archived tasks are excluded from both sides of the ratio so
// an archived-but-incomplete task can't permanently cap a project below 100%.
export function projectProgress(projectId: string, tasks: Task[]): { done: number; total: number } {
  const members = tasks.filter(t => t.projectId === projectId && t.parentId === null && !t.archived);
  const byId = new Map(members.map(t => [t.id, t]));

  const groups = new Map<string, Task[]>();
  for (const member of members) {
    const key = memberKey(member, byId);
    const bucket = groups.get(key);
    if (bucket) bucket.push(member);
    else groups.set(key, [member]);
  }

  let done = 0;
  for (const rows of groups.values()) {
    // Two conditions, because a miss is stored as a completed row (see
    // Task.missedAt) and `completed` alone would count one as done. Normally
    // the second is redundant — marking an occurrence missed spawns its
    // successor, which is outstanding and fails the first. It carries the case
    // where there is no successor: a recurrence that hit its end date or ran
    // out its count on the very occurrence that got missed. That member was
    // never done, and a project shouldn't reach 100% on it.
    if (rows.every(r => r.completed) && rows.some(r => isRealCompletion(r))) done += 1;
  }
  return { done, total: groups.size };
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
  updateProject: (id: string, patch: Partial<Pick<Project, 'title' | 'notes' | 'targetStartDate' | 'targetEndDate' | 'category' | 'nudgeCadenceDays' | 'autoSchedule' | 'sequential'>>) => void;
  getProjectById: (id: string) => Project | null;
  reorderProjects: (orderedIds: string[]) => void;
  reorderProjectsWithCategoryUpdates: (orderedIds: string[], categoryUpdates: Array<{ id: string; category: string | null }>) => void;
  // Archiving is undoable, and the undo entry lives in useTaskStore
  // (archiveProject/unarchiveProject there) with every other undoable action;
  // this is the low-level row write it calls. `archivedAt` is passed back
  // explicitly when undoing an unarchive so the project keeps the day it was
  // originally archived rather than being re-stamped as archived just now.
  applyProjectArchived: (id: string, archived: boolean, archivedAt?: string | null) => void;
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
      nudgeCadenceDays: DEFAULT_NUDGE_CADENCE_DAYS,
      autoSchedule: false,
      sequential: false,
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

  reorderProjectsWithCategoryUpdates(orderedIds, categoryUpdates) {
    get().reorderProjects(orderedIds);
    categoryUpdates.forEach(u => get().updateProject(u.id, { category: u.category }));
  },

  applyProjectArchived(id, archived, archivedAt) {
    const project = get().projects.find(p => p.id === id);
    if (!project || project.archived === archived) return;
    const updated = {
      ...project,
      archived,
      archivedAt: archived ? (archivedAt ?? new Date().toISOString()) : null,
    };
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

// Lets visibilityUtils see which projects are sequential without importing this
// store — same pull-based registry, and the same reason, as the task source
// registered at the bottom of useTaskStore. See utils/blockerRegistry.
registerProjectSource(() => useProjectStore.getState().projects);
