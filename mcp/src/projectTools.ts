/**
 * The project tools: scoping one out in a single write, reading one back in
 * full, and changing it afterwards. Same contract as tools.ts: ordinary
 * functions over a `Replica`, no SDK, so they run in the repo's jest.
 */
import type { Project, Task } from '../../src/types';
import type { ProjectPatch, ProjectPlan, Replica } from './replica';
import { serializeTask, type SerializedTask } from './serialize';
import type { TaskFieldsInput } from './taskFields';
import { localDateInput } from './timeZone';

/** A plan step as the tool takes it: task fields, plus a checklist and the earlier steps it waits on. */
export interface ProjectPlanStepInput extends TaskFieldsInput {
  title: string;
  subtasks?: string[];
  /** Positions (from 0) of earlier steps in this plan that this one waits on. */
  after?: number[];
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
  recentlyDone: { id: string; title: string; completedAt: string }[];
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
      .map(t => ({ id: t.id, title: replica.displayTitle(t), completedAt: t.completedAt! })),
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
    steps: steps.map(({ subtasks, after, ...fields }) => ({ fields, subtasks, waitsOn: after })),
  });
  return getProject(replica, project.id)!;
}

export function updateProject(replica: Replica, id: string, patch: ProjectPatch): GetProjectResult {
  if (Object.keys(patch).length === 0) throw new Error('Nothing to change: name at least one field.');
  replica.updateProject(id, patch.deadline ? { ...patch, deadline: localDateInput(patch.deadline) } : patch);
  return getProject(replica, id)!;
}
