import { create } from 'zustand';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Project, ProjectKind, Task } from '../types';
import { getCurrentDayStart } from '../utils/dateUtils';
import { nudgeFieldsFor } from '../utils/nudgeCadence';
import { isRealCompletion } from '../utils/missed';
import { useSettingsStore } from './useSettingsStore';
import {
  dbGetAllProjects,
  dbInsertProject,
  dbUpdateProject,
  dbDeleteProject,
  dbBatchUpdateProjectSortOrders,
} from '../db/database';
import { generateId } from '../utils/id';
import { deliverableKindFor } from '../utils/deliverables';

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
//
// **A project holding a recurring member never reads 100%, and that has a
// consequence nothing else states.** memberKey (above) is right that a habit is
// one member with an always-outstanding row, so `done === total` is false for
// such a project for ever. Three affordances are gated on exactly that
// expression and therefore never appear for one: the detail screen's "Mark
// Complete" offer banner, the green quick-complete check on the Projects row,
// and the autoCompleteProjectsOnDone path in completeTask. The editor's own
// Mark complete row is the only way to finish such a project, and it's the one
// that has to ask "it still has N open tasks".
//
// Whether that is right is an open question, deliberately not settled here:
// arguably a project with a live habit in it is never "done" and the current
// behaviour is correct. What is not defensible is it being invisible, which is
// what this paragraph fixes. Don't loosen the gate without deciding the
// question first.
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

/**
 * The answers this project's members have recorded, most recent first.
 *
 * A decision is usually *about* something, and that something is often the
 * project: "pick a date for the trip" and "decide on the trip budget" are facts
 * about the trip. Once answered, though, they were only reachable
 * chronologically (Logbook) or by remembering the task's title (Search) — so
 * the project the decisions are for was the one place they couldn't be read
 * together. This is the read that fixes that; nothing is stored, and nothing is
 * written into the project's own fields (see deliverables.ts on propagation).
 *
 * Grouped by the same identity `projectProgress` counts by, for the same
 * reason: a recurring decision leaves one answered row per occurrence, so
 * listing rows would grow the block by one every time it's answered. Each
 * identity contributes its most recently answered row — the current answer,
 * with the superseded ones staying in the Logbook where history lives.
 *
 * Unanswered rows are left out entirely. "No answer" is a real state (a
 * completion may never be blocked on giving one) and the Logbook row says so,
 * but a block that exists to be read back has nothing to read back from one.
 * Completion isn't checked either: un-completing a task keeps its answer, and
 * the answer is no less recorded for the task being live again.
 */
export function projectDecisions(projectId: string, tasks: Task[]): Task[] {
  const members = tasks.filter(t => t.projectId === projectId && t.parentId === null && !t.archived);
  const byId = new Map(members.map(t => [t.id, t]));

  const latest = new Map<string, Task>();
  for (const member of members) {
    // Through the resolver, not off the field: a chain step carries its own
    // question (see deliverableKindFor), and a decision made at a step is a
    // decision the project should list.
    if (deliverableKindFor(member) === null || member.deliverableValue === null) continue;
    const key = memberKey(member, byId);
    const held = latest.get(key);
    if (!held || answeredAt(member) > answeredAt(held)) latest.set(key, member);
  }
  return Array.from(latest.values()).sort((a, b) => answeredAt(b).localeCompare(answeredAt(a)));
}

// When a decision was made, as far as ordering goes. A live row that was
// un-completed has no stamp and sorts last, which is the honest place for it:
// the answer is still on the row, but the moment it was reached is gone.
function answeredAt(task: Task): string {
  return task.completedAt ?? '';
}

/**
 * A project is only flagged "past its deadline" while still incomplete and not
 * archived — nothing automatic happens, this is purely a visual cue so the user
 * can decide what to do about it.
 *
 * **Calendar days against the logical today, never a raw instant comparison.**
 * `Date.now()` was wrong twice over. `WhenPicker` stores every date it confirms
 * at noon (`noonOf`), so `deadline < Date.now()` went true at 12:00 on the
 * deadline day itself — half a day early, in orange, on the day it was still due.
 * And it ignored `dayResetTime`, which every other placement comparison in the
 * app respects.
 *
 * This is deliberately the same two lines `formatDeadlineDate` runs, because
 * the two render side by side on the project card: with the old comparison the
 * card read "Past window · Today" from noon onwards, one field giving two
 * answers. Matching the formatter is what makes that impossible rather than
 * merely unlikely.
 */
export function isProjectPastWindow(project: Project, progress: { done: number; total: number }): boolean {
  if (!project.deadline || project.archived || project.completed) return false;
  if (progress.total > 0 && progress.done === progress.total) return false;
  return differenceInCalendarDays(new Date(project.deadline), getCurrentDayStart()) < 0;
}

interface ProjectStore {
  projects: Project[];
  initialized: boolean;
  initialize: () => void;
  createProject: (title: string, deadline: string | null, kind?: ProjectKind) => Project;
  updateProject: (id: string, patch: Partial<Pick<Project, 'title' | 'notes' | 'deadline' | 'category' | 'nudgeCadenceDays' | 'autoSchedule' | 'nudgeOptIn' | 'reviewDeclinedAt' | 'backfillDismissedFields' | 'kind' | 'ongoing'>>) => void;
  /** Filing several projects at once from the Projects screen's bulk bar. */
  bulkSetProjectCategory: (ids: string[], category: string | null) => void;
  getProjectById: (id: string) => Project | null;
  reorderProjects: (orderedIds: string[]) => void;
  reorderProjectsWithCategoryUpdates: (orderedIds: string[], categoryUpdates: Array<{ id: string; category: string | null }>) => void;
  // Archiving is undoable, and the undo entry lives in useTaskStore
  // (archiveProject/unarchiveProject there) with every other undoable action;
  // this is the low-level row write it calls. `archivedAt` is passed back
  // explicitly when undoing an unarchive so the project keeps the day it was
  // originally archived rather than being re-stamped as archived just now.
  applyProjectArchived: (id: string, archived: boolean, archivedAt?: string | null) => void;
  // Same shape as applyProjectArchived, and undoable through completeProject/
  // uncompleteProject in useTaskStore for the same reason. `completedAt` is
  // passed back explicitly when undoing an uncomplete so the project keeps
  // the day it was originally completed.
  applyProjectCompleted: (id: string, completed: boolean, completedAt?: string | null) => void;
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

  createProject(title, deadline, kind = 'project') {
    const maxOrder = get().projects.reduce((m, p) => Math.max(m, p.sortOrder), 0);
    // Settings' "Default review cadence" decides both fields, not just the
    // number. It used to seed the cadence beside a hardcoded `nudgeOptIn:
    // false`, and `classifyProject` refuses on that flag *before* it ever reads
    // a cadence — so setting the default to "Every 2 weeks" changed nothing and
    // every new project was still silent. The two are one control now (see
    // nudgeFieldsFor), and the default answers it whole.
    //
    // A default of Never is still the default, and still means what it did:
    // being asked about a project you never decided you wanted chasing is the
    // annoying half of this feature.
    const defaultCadenceDays = useSettingsStore.getState().defaultProjectNudgeCadenceDays;
    const project: Project = {
      id: generateId(),
      title,
      notes: '',
      deadline,
      category: null,
      sortOrder: maxOrder + 1,
      archived: false,
      archivedAt: null,
      completed: false,
      completedAt: null,
      ongoing: false,
      createdAt: new Date().toISOString(),
      // Seeded from the global default at creation time only — changing the
      // default in Settings later never touches a project already created.
      ...nudgeFieldsFor(defaultCadenceDays > 0 ? 'scheduled' : 'never', defaultCadenceDays),
      autoSchedule: false,
      reviewDeclinedAt: null,
      backfillDismissedFields: [],
      // Presentation only — a list's members are ordinary tasks in an ordinary
      // project, and every field above means the same thing either way. See
      // Project.kind.
      kind,
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

  // One pass over the list rather than a loop of updateProject, so a bulk move
  // is a single store update instead of one re-render per project.
  bulkSetProjectCategory(ids, category) {
    const idSet = new Set(ids);
    const touched: Project[] = [];
    const next = get().projects.map(p => {
      if (!idSet.has(p.id) || p.category === category) return p;
      const updated = { ...p, category };
      touched.push(updated);
      return updated;
    });
    if (touched.length === 0) return;
    touched.forEach(p => dbUpdateProject(p));
    set(() => ({ projects: next }));
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

  applyProjectCompleted(id, completed, completedAt) {
    const project = get().projects.find(p => p.id === id);
    if (!project || project.completed === completed) return;
    const updated = {
      ...project,
      completed,
      completedAt: completed ? (completedAt ?? new Date().toISOString()) : null,
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
