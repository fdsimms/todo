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
import { registerPausedProjectSource } from '../utils/projectPause';
import { registerAwayProjectSource } from '../utils/awayDates';
import { deliverableKindFor, deliverableOptionsFor } from '../utils/deliverables';

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

/** One set of pick-from-a-list questions on a project, counted. */
export interface AnswerTally {
  /** The options, in the order the question offers them. */
  options: string[];
  /** How many members answered each option, index for index. */
  counts: number[];
  /** Members still open with no answer yet. */
  waiting: number;
  /** Members completed without an answer, or with one that isn't an option. */
  unanswered: number;
}

/**
 * "12 Yes, 3 No, 5 waiting": the members of a project that ask the same
 * pick-one question, counted by answer. RSVPs are the case this is for (one
 * task per guest, each asking Yes/No/Maybe), and a survey of what everyone
 * wants for dinner is the same read.
 *
 * Members are grouped by their options, so a project holding both RSVPs and
 * a Yes/No question gets two tallies rather than one muddled one. A set of
 * one isn't a tally (its answer is already in the Answers block), so only
 * sets of two or more come back. Identity is `projectProgress`'s, and each
 * member counts its current answer: the latest answered row, else whether it
 * is still open.
 */
export function projectAnswerTallies(projectId: string, tasks: Task[]): AnswerTally[] {
  const members = tasks.filter(t => t.projectId === projectId && t.parentId === null && !t.archived);
  const byId = new Map(members.map(t => [t.id, t]));
  // Per member identity: its options, its latest answer, and whether it's open.
  const identities = new Map<string, { options: string[]; answer: Task | null; open: boolean }>();
  for (const member of members) {
    const options = deliverableOptionsFor(member);
    if (options.length === 0) continue;
    const key = memberKey(member, byId);
    const held = identities.get(key) ?? { options, answer: null, open: false };
    if (!member.completed) held.open = true;
    if (member.deliverableValue !== null && (!held.answer || answeredAt(member) > answeredAt(held.answer))) {
      held.answer = member;
      held.options = options;
    }
    identities.set(key, held);
  }

  const sets = new Map<string, { tally: AnswerTally; members: number }>();
  for (const { options, answer, open } of identities.values()) {
    const setKey = options.join('\u0000');
    const entry = sets.get(setKey) ?? {
      tally: { options, counts: options.map(() => 0), waiting: 0, unanswered: 0 },
      members: 0,
    };
    entry.members += 1;
    const value = answer?.deliverableValue?.trim().toLowerCase() ?? null;
    const index = value === null ? -1 : options.findIndex(o => o.toLowerCase() === value);
    if (index >= 0) entry.tally.counts[index] += 1;
    else if (open && value === null) entry.tally.waiting += 1;
    else entry.tally.unanswered += 1;
    sets.set(setKey, entry);
  }
  return [...sets.values()].filter(s => s.members >= 2).map(s => s.tally);
}

/** A tally as one line: "12 Yes, 3 No, 5 waiting". Options nobody picked are left out. */
export function describeAnswerTally(tally: AnswerTally): string {
  const parts = tally.options
    .map((option, i) => (tally.counts[i] > 0 ? `${tally.counts[i]} ${option}` : null))
    .filter((p): p is string => p !== null);
  if (tally.waiting > 0) parts.push(`${tally.waiting} waiting`);
  if (tally.unanswered > 0) parts.push(`${tally.unanswered} no answer`);
  return parts.join(', ');
}

/**
 * The project page's Completed section: finished members, newest first, one
 * row per member.
 *
 * Grouped by the same identity `projectProgress` counts, for the reason
 * `projectDecisions` gives: a repeating member leaves a completed row per
 * occurrence, so a daily task in a project grew the section by one a day and
 * "Show 47 completed" sat beside a progress line counting 8 members. Each
 * member shows its most recent completion; the rest of its history is in the
 * Logbook, where history lives.
 */
export function projectCompletedRows(projectId: string, tasks: Task[]): Task[] {
  const members = tasks.filter(t => t.projectId === projectId && t.parentId === null && !t.archived);
  const byId = new Map(members.map(t => [t.id, t]));
  const latest = new Map<string, Task>();
  // A member with a row still open isn't finished: a repeating task's past
  // occurrences are done, but the task is still up above among the open ones,
  // and listing it here too made the section disagree with "X of Y done".
  const open = new Set<string>();
  for (const member of members) {
    const key = memberKey(member, byId);
    if (!member.completed) { open.add(key); continue; }
    const held = latest.get(key);
    if (!held || (member.completedAt ?? '') > (held.completedAt ?? '')) latest.set(key, member);
  }
  for (const key of open) latest.delete(key);
  return Array.from(latest.values())
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
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
  createProject: (title: string, options?: CreateProjectOptions) => Project;
  updateProject: (id: string, patch: Partial<Pick<Project, 'title' | 'notes' | 'deadline' | 'category' | 'defaultTaskCategory' | 'nudgeCadenceDays' | 'autoSchedule' | 'nudgeOptIn' | 'weekendSource' | 'reviewDeclinedAt' | 'reviewedAt' | 'backfillDismissedFields' | 'kind' | 'ongoing' | 'awayStart' | 'awayEnd' | 'awayPauses' | 'awayPauseDeclinedFor' | 'destination' | 'awayListId' | 'awayListDeclinedFor' | 'pausedUntil' | 'personIds' | 'links' | 'inOrder' | 'showChecked'>>) => void;
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

/**
 * What a caller may decide about a project at the moment it is created.
 *
 * An options object rather than more positional parameters, which is where
 * this was heading: `createProject(title, deadline, kind)` had already run out
 * of room, so the three callers that wanted a fourth thing created the row and
 * immediately patched it — a second write, a second render, and a returned row
 * that was stale on the line after it came back (see the comment
 * `QuickAddProjectModal` used to carry about handing on `{ ...project,
 * category }`).
 *
 * Only the fields somebody actually decides *at creation*. Everything else on
 * `Project` is either an opt-in that must start off (`awayPauses`,
 * `weekendSource`, `autoSchedule`), seeded from a setting (`nudgeCadenceDays`),
 * or a runtime stamp (`completedAt`, `reviewDeclinedAt`, `reviewedAt`) — none of which a
 * caller has an opinion about yet. Adding one here means a caller can answer
 * it; that is the bar.
 */
export interface CreateProjectOptions {
  deadline?: string | null;
  /** Presentation only. See Project.kind. */
  kind?: ProjectKind;
  category?: string | null;
  /**
   * The away span, for the one caller that knows one at creation: a template
   * run whose anchors are the days it is away (see TaskTemplate.anchorsAreAway
   * and docs/arch/away-dates.md). Same asymmetry `awaySpanOf` reads them with —
   * an end with no start is not a span — so a caller passing only the end gets
   * a project with no span, not a half of one.
   */
  awayStart?: string | null;
  awayEnd?: string | null;
  destination?: string | null;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  initialized: false,

  initialize() {
    const projects = dbGetAllProjects();
    set({ projects, initialized: true });
  },

  createProject(title, options = {}) {
    const maxOrder = get().projects.reduce((m, p) => Math.max(m, p.sortOrder), 0);
    // Settings' "Default review cadence" decides both fields, not just the
    // number. It used to seed the cadence beside a hardcoded `nudgeOptIn:
    // false`, and `classifyProject` refuses on that flag *before* it ever reads
    // a cadence — so setting the default to "Every 2 weeks" changed nothing and
    // every new project was still silent. The two are one control now (see
    // nudgeFieldsFor), and the default answers it whole.
    //
    // With no cadence set, a new project is "When I ask": it shows up in the
    // Pull sheet the person opens themselves and never brings itself up. It
    // used to be Never, which also kept it out of that sheet, so on a fresh
    // install the button everyone can see answered "every project is set to
    // never be chased" about projects nobody had set to anything. Being asked
    // unprompted is still opt-in, which is the half that can be annoying.
    const defaultCadenceDays = useSettingsStore.getState().defaultProjectNudgeCadenceDays;
    const project: Project = {
      id: generateId(),
      title,
      notes: '',
      deadline: options.deadline ?? null,
      category: options.category ?? null,
      // No default until somebody nominates one in the editor. See
      // Project.defaultTaskCategory.
      defaultTaskCategory: null,
      sortOrder: maxOrder + 1,
      archived: false,
      archivedAt: null,
      completed: false,
      completedAt: null,
      ongoing: false,
      createdAt: new Date().toISOString(),
      // Seeded from the global default at creation time only — changing the
      // default in Settings later never touches a project already created.
      ...nudgeFieldsFor(defaultCadenceDays > 0 ? 'scheduled' : 'on-ask', defaultCadenceDays),
      autoSchedule: false,
      // Off, like every other opt-in here: the weekend nudge may quote a project
      // only once somebody has said it is one to quote. See
      // Project.weekendSource.
      weekendSource: false,
      reviewDeclinedAt: null,
      reviewedAt: null,
      backfillDismissedFields: [],
      // Presentation only — a list's members are ordinary tasks in an ordinary
      // project, and every field above means the same thing either way. See
      // Project.kind.
      kind: options.kind ?? 'project',
      // No span unless a caller brought one. A project is a trip only once
      // somebody enters the dates, and there is nothing here to infer them
      // from — so the default is null and the only caller that passes a pair is
      // a template run whose anchors are away dates.
      awayStart: options.awayStart ?? null,
      awayEnd: options.awayEnd ?? null,
      // Off, like every other opt-in here. See Project.awayPauses.
      awayPauses: false,
      awayPauseDeclinedFor: null,
      destination: options.destination ?? null,
      // No list either, and for `awayPauses`' reason rather than the span's: a
      // trip buys from a list only once somebody nominates one. See
      // Project.awayListId.
      awayListId: null,
      awayListDeclinedFor: null,
      pausedUntil: null,
      personIds: [],
      links: [],
      inOrder: false,
      showChecked: false,
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
    // The ids passed are only the list on screen (Active, Completed or
    // Archived), so they're laid into the slots those projects already hold in
    // the full order, and the whole list renumbered. Numbering just the subset
    // 0..n-1 collided with the projects off screen: an unarchived project came
    // back wherever the tie happened to break, and reordering the Archived
    // list reshuffled the Active one.
    const full = [...get().projects].sort((a, b) => a.sortOrder - b.sortOrder);
    const moving = new Set(orderedIds);
    const queue = orderedIds.filter(id => full.some(p => p.id === id));
    const merged = full.map(p => (moving.has(p.id) ? queue.shift()! : p.id));
    const updates = merged.map((id, index) => ({ id, sortOrder: index }));
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
    if (categoryUpdates.length === 0) return;
    // One state write for the lot rather than one per project.
    const byId = new Map(categoryUpdates.map(u => [u.id, u.category]));
    const touched: Project[] = [];
    const next = get().projects.map(p => {
      if (!byId.has(p.id) || p.category === byId.get(p.id)) return p;
      const updated = { ...p, category: byId.get(p.id)! };
      touched.push(updated);
      return updated;
    });
    if (touched.length === 0) return;
    touched.forEach(p => dbUpdateProject(p));
    set(() => ({ projects: next }));
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
    // Sorted back into place, the way restoreCategory does: every reader
    // groups the list in store order, so an appended row sat at the bottom of
    // its section after an undo until the next launch.
    set(s => ({ projects: [...s.projects, project].sort((a, b) => a.sortOrder - b.sortOrder) }));
  },
}));

// So `isTaskExpired` can ask whether a nominated trip covers today without
// this store — and so expo-sqlite — being reachable from `visibilityUtils`.
// See the registry note in `src/utils/awayDates.ts`.
registerAwayProjectSource(() => useProjectStore.getState().projects);
// So the visibility gates can hold a paused project's tasks back. See
// src/utils/projectPause.ts.
registerPausedProjectSource(() => useProjectStore.getState().projects);
