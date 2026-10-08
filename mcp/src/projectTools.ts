/**
 * The project tools: scoping one out in a single write, reading one back in
 * full, and changing it afterwards. Same contract as tools.ts: ordinary
 * functions over a `Replica`, no SDK, so they run in the repo's jest.
 */
import type { Project, Task } from '../../src/types';
import type { ProjectPatch, ProjectPlan, ProjectPlanStep, Replica } from './replica';
import { serializeTask, type SerializedTask } from './serialize';
import { eventNoonIso, type TaskFieldsInput } from './taskFields';
import { localDateInput } from './timeZone';
import { awayFields } from './tools';

/** A plan step as the tool takes it: task fields, plus a checklist and the earlier steps it waits on. */
export interface ProjectPlanStepInput extends TaskFieldsInput {
  title: string;
  subtasks?: string[];
  /** Positions (from 0) of earlier steps in this plan that this one waits on. */
  after?: number[];
  /** Shown only for these answers to an earlier step's question, by position. */
  onlyIfAnswerTo?: { step: number; answers: string[] };
}

export interface CreateProjectInput extends Omit<ProjectPlan, 'steps'> {
  steps?: ProjectPlanStepInput[];
}

export interface SerializedProjectDetail {
  id: string;
  title: string;
  kind: 'project' | 'list';
  notes?: string;
  deadline?: string;
  /** The day the project is for; dueDaysFromEvent counts from it. */
  eventDate?: string;
  category?: string;
  defaultTaskCategory?: string;
  /** Priority (0 means none on purpose), difficulty and estimate bucket new tasks in it start with. */
  taskDefaults?: { priority: number | null; difficulty: string | null; effort: number | null };
  completed?: boolean;
  archived?: boolean;
  /**
   * The away span (docs/arch/away-dates.md): the day you leave, the day you are
   * back (absent for a departure with no return yet), and where to. What
   * scheduled vacation mode and the away grocery list run on, where the person
   * has turned those on for this project.
   */
  awayStart?: string;
  awayEnd?: string;
  destination?: string;
  /** The person asked for vacation mode to turn itself on for this trip (`awayPauses`). */
  pausesTasksWhileAway?: true;
  /** Paused until this day (YYYY-MM-DD): its tasks are held off every list until then. */
  pausedUntil?: string;
  /** In Planning: its tasks are held off every list until it is marked ready. */
  planning?: true;
  /** Its steps are worked in page order. */
  inOrder?: true;
  /** Never finished on its own. */
  ongoing?: true;
  /** Who it is with or for. */
  people?: { id: string; name: string }[];
  links?: { label: string; url: string }[];
  /** How it nudges: days of quiet before it offers a task (0 never), whether it dates one itself, and whether it nudges at all. */
  nudge?: { cadenceDays: number; autoSchedule: boolean; optIn: boolean; weekendSource: boolean };
  /** On a list: checked items stay on the page. */
  showChecked?: true;
  /** Its card shows no "Next:" line. */
  hideNextStep?: true;
  /** Members finished and in total, by the app's own reckoning (see list_projects). */
  done: number;
  total: number;
}

export interface ProjectTask extends SerializedTask {
  /** The checklist under it, in order. */
  subtasks?: { id: string; title: string; done: boolean }[];
  /** Ids of the tasks still holding it back, when any are. */
  waitsOn?: string[];
}

export interface GetProjectResult {
  project: SerializedProjectDetail;
  /** What is still to do, in the project's own order. */
  open: ProjectTask[];
  /** The most recently finished, newest first, capped at `RECENT_DONE`. */
  recentlyDone: { id: string; title: string; completedAt: string; answer?: string }[];
  /**
   * Every question the project's tasks have answered, newest first: the
   * Decisions block on the project's page. Not capped, and not a slice of
   * `recentlyDone`: a decision made months ago is still the decision.
   */
  decisions: ProjectDecision[];
}

export interface ProjectDecision {
  /** The task that asked. Its notes, through get_task, are where any reasoning lives. */
  id: string;
  question: string;
  /** What was asked for: text, date, number, yesno or choice. */
  kind: string;
  answer: string;
  /** When it was answered, which is when the task was completed. */
  decidedAt: string;
  /** Why it was decided that way, where recorded. */
  why?: string;
  /** What would reopen it, where recorded. */
  revisitIf?: string;
}

export const RECENT_DONE = 15;

function serializeProject(replica: Replica, p: Project): SerializedProjectDetail {
  const { done, total } = replica.projectProgress(p.id);
  return {
    id: p.id,
    title: p.title,
    kind: p.kind,
    ...(p.notes ? { notes: p.notes } : {}),
    ...(p.deadline ? { deadline: p.deadline } : {}),
    ...(p.eventDate ? { eventDate: p.eventDate } : {}),
    ...(p.category ? { category: p.category } : {}),
    ...(p.defaultTaskCategory ? { defaultTaskCategory: p.defaultTaskCategory } : {}),
    ...(p.taskDefaults ? { taskDefaults: p.taskDefaults } : {}),
    ...(p.completed ? { completed: true } : {}),
    ...(p.archived ? { archived: true } : {}),
    ...awayFields(replica, p),
    ...(p.awayPauses && p.awayStart ? { pausesTasksWhileAway: true as const } : {}),
    // Planning is stored as a pause on a day no today reaches (PLANNING_PAUSE_KEY),
    // said by name rather than as that day. Compared inline: no app value import here.
    ...(p.pausedUntil === '9999-12-31' ? { planning: true as const } : p.pausedUntil ? { pausedUntil: p.pausedUntil } : {}),
    ...(p.inOrder ? { inOrder: true as const } : {}),
    ...(p.ongoing ? { ongoing: true as const } : {}),
    ...((p.personIds ?? []).length > 0
      ? { people: p.personIds.flatMap(pid => { const person = replica.people().find(x => x.id === pid); return person ? [{ id: pid, name: person.name }] : []; }) }
      : {}),
    ...((p.links ?? []).length > 0 ? { links: p.links.map(l => ({ label: l.label, url: l.url })) } : {}),
    nudge: { cadenceDays: p.nudgeCadenceDays, autoSchedule: p.autoSchedule, optIn: p.nudgeOptIn, weekendSource: p.weekendSource },
    ...(p.showChecked ? { showChecked: true as const } : {}),
    ...(p.hideNextStep ? { hideNextStep: true as const } : {}),
    done,
    total,
  };
}

function projectTask(replica: Replica, t: Task, all: Task[]): ProjectTask {
  const subs = all.filter(s => s.parentId === t.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const waits = replica.liveBlockers(t).map(b => b.id);
  return {
    ...serializeTask(replica, t),
    ...(subs.length > 0 ? { subtasks: subs.map(s => ({ id: s.id, title: s.title, done: s.completed })) } : {}),
    ...(waits.length > 0 ? { waitsOn: waits } : {}),
  };
}

/**
 * A project with everything in it. Archived tasks are left out, as everywhere a
 * project's members are listed (CLAUDE.md, "Projects").
 */
export function getProject(replica: Replica, id: string): GetProjectResult | null {
  const project = replica.projects().find(p => p.id === id);
  if (!project) return null;
  const all = replica.tasks();
  const members = all.filter(t => t.projectId === id && !t.parentId && !t.archived);
  return {
    project: serializeProject(replica, project),
    open: members
      .filter(t => !t.completed)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(t => projectTask(replica, t, all)),
    recentlyDone: members
      .filter(t => t.completed && t.completedAt)
      .sort((a, b) => (b.completedAt! > a.completedAt! ? 1 : -1))
      .slice(0, RECENT_DONE)
      .map(t => ({
        id: t.id,
        title: replica.displayTitle(t),
        completedAt: t.completedAt!,
        ...(t.deliverableValue != null ? { answer: t.deliverableValue } : {}),
      })),
    decisions: replica.projectDecisions(id).map(t => ({
      id: t.id,
      question: replica.displayTitle(t),
      kind: replica.deliverableKind(t) ?? 'text',
      answer: t.deliverableValue!,
      decidedAt: t.completedAt ?? '',
      ...(t.deliverableWhy ? { why: t.deliverableWhy } : {}),
      ...(t.deliverableRevisitIf ? { revisitIf: t.deliverableRevisitIf } : {}),
    })),
  };
}

export interface NextInProjectResult {
  project: { id: string; title: string };
  /** The step the checklist item belongs to: the one asked for, else the first open step that is not held back. */
  step: { id: string; title: string; waitsOn?: string[] } | null;
  /** The first unchecked checklist item under that step, or null when it has none left (or no checklist). */
  next: { id: string; title: string } | null;
  checklist: { done: number; total: number };
  /** Why `next` is null, when it is. */
  note?: string;
}

/**
 * The next unchecked checklist item in a project step, without the rest of the
 * project. With no step given it is the first open step, in the project's own
 * order, that nothing is holding back; a step that is waiting is only returned
 * when it is named. Read-only, over the same rows `getProject` reads.
 */
export function nextInProject(replica: Replica, projectId: string, stepId?: string): NextInProjectResult | null {
  const detail = getProject(replica, projectId);
  if (!detail) return null;
  const project = { id: detail.project.id, title: detail.project.title };
  const step = stepId
    ? detail.open.find(t => t.id === stepId)
    : detail.open.find(t => !t.waitsOn);
  if (!step) {
    return {
      project,
      step: null,
      next: null,
      checklist: { done: 0, total: 0 },
      note: stepId
        ? 'That is not an open step of this project.'
        : detail.open.length > 0 ? 'Every open step is waiting on something else.' : 'Nothing is open in this project.',
    };
  }
  const list = step.subtasks ?? [];
  const next = list.find(s => !s.done);
  return {
    project,
    step: { id: step.id, title: step.title, ...(step.waitsOn ? { waitsOn: step.waitsOn } : {}) },
    next: next ? { id: next.id, title: next.title } : null,
    checklist: { done: list.filter(s => s.done).length, total: list.length },
    ...(next ? {} : { note: list.length > 0 ? 'Every checklist item is checked; the step itself is what is left.' : 'This step has no checklist; the step itself is the next thing.' }),
  };
}

/**
 * Create a project and its whole plan. Validated in full before anything is
 * written, and written in one transaction (see `replica.createProjectPlan`).
 */
export function createProject(replica: Replica, input: CreateProjectInput): GetProjectResult {
  const { steps = [], ...rest } = input;
  const { project } = replica.createProjectPlan({
    ...rest,
    ...(rest.deadline ? { deadline: localDateInput(rest.deadline) } : {}),
    steps: steps.map(toPlanStep),
  });
  return getProject(replica, project.id)!;
}

function toPlanStep({ subtasks, after, onlyIfAnswerTo, ...fields }: ProjectPlanStepInput): ProjectPlanStep {
  return { fields, subtasks, waitsOn: after, ...(onlyIfAnswerTo ? { onlyIfAnswerTo } : {}) };
}

/**
 * Steps added to an existing project in one write: the same step shape
 * create_project takes, so `after` counts over this batch and a step's own
 * `waitsOn` names tasks already in the app. Checked in full first, so a bad
 * step adds nothing.
 */
export function addProjectSteps(
  replica: Replica,
  projectId: string,
  steps: ProjectPlanStepInput[]
): GetProjectResult & { added: string[] } {
  const created = replica.addProjectSteps(
    projectId,
    steps.map(toPlanStep)
  );
  return { ...getProject(replica, projectId)!, added: created.filter(t => !t.parentId).map(t => t.id) };
}

/** What happened to a project's dated tasks when its event date moved. */
export interface EventMoveResult {
  /** Calendar days the event moved; negative is earlier. */
  days: number;
  /** Set when moveTasks was passed: the tasks moved, with their new dates. */
  moved?: { id: string; title: string; dueDate?: string; deferUntil?: string }[];
  /** Tasks the app would only move once someone ticks them, left where they are. */
  notMoved?: { id: string; title: string; reason: string }[];
  /** Without moveTasks: how many dated tasks would move, and how to move them. */
  wouldMove?: number;
  note?: string;
}

export function updateProject(
  replica: Replica,
  id: string,
  patch: ProjectPatch,
  opts: { moveTasks?: boolean; moveTasksFrom?: string; archiveRemaining?: boolean } = {},
): GetProjectResult & { eventMove?: EventMoveResult; awayNote?: string; archivedRemaining?: number } {
  const moveLater = opts.moveTasksFrom !== undefined;
  if (Object.keys(patch).length === 0 && !moveLater) throw new Error('Nothing to change: name at least one field.');
  const before = replica.projects().find(p => p.id === id);
  if (!before) throw new Error(`No project with id ${id}.`);
  let prior = before.eventDate ?? null;
  if (moveLater) {
    // Moving after the fact: the event already changed, so the old date has
    // to be named. The days counted are from it to the event date now.
    prior = eventNoonIso(opts.moveTasksFrom!);
    if (!prior) throw new Error(`moveTasksFrom: "${opts.moveTasksFrom}" is not a date I can read.`);
  }
  // Finishing a project can archive what is left in it, as the app asks when
  // it is completed with tasks still open. Each through archive_task's own
  // write, so each is in Activity with its way back.
  let archivedRemaining = 0;
  if (opts.archiveRemaining) {
    if (patch.completed !== true) throw new Error('archiveRemaining goes with completed: true.');
    for (const t of replica.tasks().filter(x => x.projectId === id && !x.parentId && !x.completed && !x.archived)) {
      replica.setTaskArchived(t.id, true);
      archivedRemaining += 1;
    }
  }
  // A bare deadline is a local day, as every date a tool writes is (localDateInput).
  const dated = patch.deadline ? { ...patch, deadline: localDateInput(patch.deadline) } : patch;
  const project = Object.keys(dated).length > 0 ? replica.updateProject(id, dated) : before;
  const next = project.eventDate ?? null;
  const result: GetProjectResult & { awayNote?: string; archivedRemaining?: number } = getProject(replica, id)!;
  if (archivedRemaining > 0) result.archivedRemaining = archivedRemaining;
  // The two things the replica does to the span beyond what was asked, said
  // here so the caller does not have to diff the project to find them.
  if (patch.awayStart !== undefined && patch.awayEnd === undefined && before.awayEnd && project.awayEnd && project.awayEnd !== before.awayEnd) {
    result.awayNote = `Coming back moved with the departure, keeping the trip the same length: it is now ${project.awayEnd.slice(0, 10)}.`;
  } else if (patch.awayStart === null && (before.awayEnd || before.destination || before.awayPauses || before.awayListId)) {
    result.awayNote = 'Clearing the away dates also cleared the return date, the destination, and the vacation mode and grocery list nominations that hung off them.';
  }
  if (moveLater && !next) throw new Error('moveTasksFrom counts to the project\'s event date, and it has none.');
  if (!prior || !next || prior === next || (patch.eventDate === undefined && !moveLater)) return result;
  if (moveLater) opts = { ...opts, moveTasks: true };

  if (!opts.moveTasks) {
    // Not moved unasked: the app offers this as a sheet a person ticks
    // through, and Claude is the one who has to ask here.
    const from = new Date(prior);
    const to = new Date(next);
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    const dated = result.open.filter(t => t.dueDate || t.deferUntil).length;
    return {
      ...result,
      eventMove: {
        days,
        wouldMove: dated,
        ...(dated > 0 ? { note: `Its dated tasks stayed where they were. Ask whether they should move with the event; to move them, call update_project with moveTasksFrom: "${prior}".` } : {}),
      },
    };
  }
  const move = replica.moveProjectTasks(id, new Date(prior), new Date(next));
  return {
    ...getProject(replica, id)!,
    eventMove: {
      days: move.deltaDays,
      moved: move.moved.map(t => ({
        id: t.id,
        title: replica.displayTitle(t),
        ...(t.dueDate ? { dueDate: t.dueDate } : {}),
        ...(t.deferUntil ? { deferUntil: t.deferUntil } : {}),
      })),
      ...(move.skipped.length > 0
        ? { notMoved: move.skipped.map(s => ({ id: s.task.id, title: replica.displayTitle(s.task), reason: s.reason })) }
        : {}),
    },
  };
}

export interface DeleteProjectResult {
  deleted: string;
  tasksDeleted: number;
  tasksLeftInNoProject: number;
  note: string;
}

/** Delete a project, leaving its tasks in no project, or with `deleteTasks` deleting them. */
export function deleteProject(replica: Replica, id: string, deleteTasks = false): DeleteProjectResult {
  const snapshot = replica.deleteProject(id, deleteTasks);
  return {
    deleted: snapshot.project.title,
    tasksDeleted: snapshot.deleted.filter(t => !t.parentId).length,
    tasksLeftInNoProject: snapshot.unfiledTaskIds.length,
    note: 'Deleted, not archived. It can be restored from the app\'s Activity screen, with its tasks and sections. update_project with archived: true is the gentler way to put a project away.',
  };
}

export function saveProjectCategory(replica: Replica, input: { name: string; newName?: string; delete?: boolean }) {
  if (input.newName !== undefined && input.delete) throw new Error('Rename or delete, not both.');
  const result = replica.saveProjectCategory(input.name, { newName: input.newName, delete: input.delete });
  return { ...result, categories: replica.projectCategories().map(c => c.name) };
}

export function reorderProjects(replica: Replica, input: { ids?: string[]; categories?: string[] }) {
  if (!input.ids?.length && !input.categories?.length) throw new Error('Give ids (projects to put first) or categories (project categories to put first).');
  replica.reorderProjects(input.ids ?? [], input.categories);
  return {
    projects: replica.projects().filter(p => !p.archived).sort((a, b) => a.sortOrder - b.sortOrder).map(p => ({ id: p.id, title: p.title })),
    categories: replica.projectCategories().map(c => c.name),
  };
}

/** A fresh copy of a project, every date cleared and every task open. */
export function startFreshProject(replica: Replica, id: string): GetProjectResult {
  return getProject(replica, replica.startFreshProject(id).project.id)!;
}

export function saveProjectAsTemplate(replica: Replica, id: string, name?: string) {
  const template = replica.saveProjectAsTemplate(id, name);
  return {
    template: { id: template.id, name: template.name, items: template.items.length, groups: template.itemGroups.length },
    note: 'A template, applied whenever the person wants with apply_template. Each dated task is placed as days from the project\'s own date, so applying it asks for one date.',
  };
}
