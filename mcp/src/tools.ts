/**
 * The read-only tool surface.
 *
 * Every handler takes a `Replica` and returns plain data. Nothing here knows
 * that MCP exists — `server.ts` is where these become tools with an SDK and a
 * socket around them, and it is the only file in the package that cannot run in
 * the repo's jest. That split is the same one `syncEngine.ts` makes against
 * CloudKit, for the same reason: the part that is expensive to get right should
 * not live behind a build.
 *
 * **The lenses are the app's, not the schema's.** `list_tasks` offers Today,
 * Later, Unscheduled and Inbox because those are what the app shows and what
 * the user will ask about, and they are computed by `isTaskVisible` and
 * `isUnscheduledTask` rather than reimplemented from `due_date`. A server that
 * answered "what's on today" with `WHERE due_date = date('now')` would disagree
 * with the phone in every case the visibility model exists to handle: a
 * deferred task, a time-of-day segment that has not opened, a task held by a
 * blocker, a `dayResetTime` that is not midnight.
 */
import type { GroceryItem, Project, Task } from '../../src/types';
import type { Replica } from './replica';
import { serializeTasks, type SerializedTask } from './serialize';

/** The four sub-views of TodayScreen, plus the everything case. */
export const TASK_VIEWS = ['today', 'later', 'unscheduled', 'inbox', 'all'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

/**
 * A cap, because a tool result is somebody's context. 50 is roughly what the
 * Today list holds before the user themselves would call it unmanageable, and
 * the response says when it truncated rather than silently ending.
 */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface ListTasksInput {
  view?: TaskView;
  /** Category name, matched exactly — it is a stored string, not a fuzzy label. */
  category?: string;
  tag?: string;
  projectId?: string;
  /** Off by default: a completed task is history, and history is a long list. */
  includeCompleted?: boolean;
  limit?: number;
}

export interface ListTasksResult {
  view: TaskView;
  tasks: SerializedTask[];
  /** How many matched before the cap. Equal to `tasks.length` when nothing was cut. */
  matched: number;
}

function isTopLevel(task: Task): boolean {
  // Subtasks are tasks with a parent, and every top-level selector in the app
  // filters them out. A list that mixed them in would double-count the work.
  return !task.parentId;
}

export function listTasks(replica: Replica, input: ListTasksInput = {}): ListTasksResult {
  const view = input.view ?? 'today';
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const matched = replica
    .tasks()
    .filter(isTopLevel)
    .filter(t => (input.includeCompleted ? true : !t.completed))
    .filter(t => (input.category ? t.category === input.category : true))
    .filter(t => (input.tag ? t.tags.includes(input.tag) : true))
    .filter(t => (input.projectId ? t.projectId === input.projectId : true))
    .filter(t => matchesView(replica, t, view));

  return {
    view,
    matched: matched.length,
    tasks: serializeTasks(replica, matched.slice(0, limit)),
  };
}

/**
 * Today / Later / Unscheduled / Inbox are disjoint lenses over one set, exactly
 * as `TodayScreen` treats them — `isUnscheduledTask` already excludes inbox
 * tasks and `isTaskVisible` already excludes both, so these read as three
 * one-liners rather than as a partition that has to be maintained here.
 */
function matchesView(replica: Replica, task: Task, view: TaskView): boolean {
  switch (view) {
    case 'today':
      return replica.isVisible(task);
    case 'later':
      return !replica.isVisible(task) && !replica.isUnscheduled(task) && !replica.isInbox(task);
    case 'unscheduled':
      return replica.isUnscheduled(task);
    case 'inbox':
      return replica.isInbox(task);
    case 'all':
      return true;
  }
}

export interface SearchTasksInput {
  query: string;
  limit?: number;
}

export interface SearchTasksResult {
  query: string;
  tasks: SerializedTask[];
  matched: number;
}

export function searchTasks(replica: Replica, input: SearchTasksInput): SearchTasksResult {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const hits = replica.search(input.query);

  return {
    query: input.query,
    matched: hits.length,
    tasks: serializeTasks(replica, hits.slice(0, limit).map(h => h.task)),
  };
}

export interface GetTaskResult {
  task: SerializedTask;
  /** The task's own subtasks, in stored order. */
  subtasks: SerializedTask[];
  /** Every step, when the task is a chain, so the shape is visible at once. */
  chain?: { index: number; steps: string[] };
  project?: { id: string; title: string };
  /**
   * Why the task is not on Today, when it is not. Null when it is visible.
   * The date is what `getVisibleAt` returns, which is the earliest moment it
   * surfaces rather than its due date — the two differ whenever a defer, a time
   * segment or a category schedule is what is holding it.
   */
  hiddenUntil?: string;
}

export function getTask(replica: Replica, id: string): GetTaskResult | null {
  const task = replica.taskById(id);
  if (!task) return null;

  const steps = task.chainItems ?? [];
  const project = task.projectId ? replica.projects().find(p => p.id === task.projectId) : null;
  const visible = replica.isVisible(task);

  return {
    task: serializeTasks(replica, [task])[0],
    subtasks: serializeTasks(
      replica,
      replica.tasks().filter(t => t.parentId === task.id)
    ),
    chain: steps.length > 1 ? { index: task.chainIndex ?? 0, steps: steps.map(s => s.title) } : undefined,
    project: project ? { id: project.id, title: project.title } : undefined,
    hiddenUntil: visible ? undefined : replica.visibleAt(task).toISOString(),
  };
}

export interface SerializedProject {
  id: string;
  title: string;
  notes?: string;
  deadline?: string;
  /** Live members only. A completed one-off is done, not outstanding. */
  outstanding: number;
}

export function listProjects(replica: Replica): SerializedProject[] {
  const tasks = replica.tasks();

  // Archiving is an explicit "keep this, out of my way", so an archived project
  // is not part of the answer to "what am I working on".
  return replica.projects().filter((p: Project) => !p.archived).map((p: Project) => ({
    id: p.id,
    title: p.title,
    notes: p.notes || undefined,
    deadline: p.deadline ?? undefined,
    // Deliberately a plain count of live members rather than `projectProgress`'
    // answer: that one collapses recurrence tombstones and series by identity,
    // and reaching it means standing up useProjectStore. Phase 2 should use the
    // real thing; until then this must not be reported as "progress".
    outstanding: tasks.filter(t => t.projectId === p.id && !t.completed && !t.parentId).length,
  }));
}

export interface SerializedGroceryItem {
  id: string;
  name: string;
  quantity?: string;
  aisle?: string;
  /** On the list right now, as opposed to sitting in the catalog. */
  onList: boolean;
  checked?: boolean;
}

export function listGroceryItems(
  replica: Replica,
  input: { onListOnly?: boolean } = {}
): SerializedGroceryItem[] {
  const items = replica.groceryItems();
  const wanted = input.onListOnly === false ? items : items.filter((i: GroceryItem) => i.onList);

  return wanted.map((i: GroceryItem) => ({
    id: i.id,
    name: i.name,
    quantity: i.quantity || undefined,
    aisle: i.aisle || undefined,
    onList: i.onList,
    checked: i.checked ? true : undefined,
  }));
}
