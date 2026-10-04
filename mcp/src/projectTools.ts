/**
 * The project tools: scoping one out in a single write, reading one back in
 * full, and changing it afterwards. Same contract as tools.ts: ordinary
 * functions over a `Replica`, no SDK, so they run in the repo's jest.
 */
import type { Project, Task } from '../../src/types';
import type { ProjectPatch, ProjectPlan, ProjectPlanStep, Replica } from './replica';
import { serializeTask, type SerializedTask } from './serialize';
import { eventNoonIso, type TaskFieldsInput } from './taskFields';

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
  completed?: boolean;
  archived?: boolean;
  /** Members finished and in total, by the app's own reckoning (see list_projects). */
  done: number;
  total: number;
}

export interface ProjectTask extends SerializedTask {
  /** The checklist under it, in order. */
  subtasks?: { id: string; title: string; done: boolean }[];
  /** Ids of the tasks it waits on, when it waits on any. */
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
    ...(p.completed ? { completed: true } : {}),
    ...(p.archived ? { archived: true } : {}),
    done,
    total,
  };
}

function projectTask(replica: Replica, t: Task, all: Task[]): ProjectTask {
  const subs = all.filter(s => s.parentId === t.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const waits = [t.blockedById, ...(t.blockedByIds ?? [])].filter((id): id is string => !!id);
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
    })),
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
  opts: { moveTasks?: boolean; moveTasksFrom?: string } = {},
): GetProjectResult & { eventMove?: EventMoveResult } {
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
  const project = Object.keys(patch).length > 0 ? replica.updateProject(id, patch) : before;
  const next = project.eventDate ?? null;
  const result = getProject(replica, id)!;
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
