/**
 * The stack tools: listing the stacks, making one, and filing tasks in one.
 * Same contract as projectTools.ts: ordinary functions over a `Replica`, no
 * SDK, so they run in the repo's jest.
 *
 * A stack is a label several independently-scheduled tasks hang off (CLAUDE.md,
 * "Stacks"), so filing a task in one changes nothing about its schedule, its
 * streak or what it logs. It does change one thing, and these tools say so
 * rather than leave it to be found on Today: the stack owns its members'
 * category.
 */
import type { Replica } from './replica';

export interface SerializedStack {
  id: string;
  title: string;
  /** Where it renders on Today, and the category every member is filed under. */
  category?: string;
  /** The project it was built inside, if any. */
  projectId?: string;
  /**
   * Its open top-level tasks, in the stack's own order. A repeating task is one
   * entry however many finished occurrences sit behind it.
   */
  members: { id: string; title: string }[];
}

/** A task a write moved, and the category it ended up under if that changed. */
export interface StackMove {
  id: string;
  title: string;
  /** Present only when the stack's category replaced the task's own. */
  category?: { from: string | null; to: string | null };
}

export interface StackWrite {
  /** Null after taking tasks out of a stack. */
  stack: SerializedStack | null;
  moved: StackMove[];
  /** Said when filing tasks changed their categories, which can change when they show. */
  note?: string;
}

function serializeStack(replica: Replica, stack: ReturnType<Replica['stacks']>[number]): SerializedStack {
  const members = replica
    .tasks()
    .filter(t => t.groupId === stack.id && !t.parentId && !t.completed && !t.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(t => ({ id: t.id, title: replica.displayTitle(t) }));
  return {
    id: stack.id,
    title: stack.title,
    ...(stack.category ? { category: stack.category } : {}),
    ...(stack.projectId ? { projectId: stack.projectId } : {}),
    members,
  };
}

/** Every stack, with what is in it, in the app's order. */
export function listStacks(replica: Replica): SerializedStack[] {
  return replica
    .stacks()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(s => serializeStack(replica, s));
}

const MOVE_NOTE =
  'A stack owns its members\' category, so tasks filed in one moved to its category. Categories carry their own schedule and vacation setting, which can change when a task shows.';

/**
 * The tasks a write names, checked in full before anything is written, so a bad
 * id moves nothing. Duplicate ids count once.
 */
function checkedTasks(replica: Replica, taskIds: string[]) {
  const ids = [...new Set(taskIds)];
  const problems: string[] = [];
  const found = ids.flatMap(id => {
    const task = replica.taskById(id);
    if (!task) {
      problems.push(`No task with id ${id}.`);
      return [];
    }
    if (task.parentId) problems.push(`"${task.title}" is a subtask. A stack holds top-level tasks.`);
    else if (task.completed) problems.push(`"${task.title}" is completed. Reopen it in the app before moving it.`);
    else if (task.archived) problems.push(`"${task.title}" is archived. Restore it in the app before moving it.`);
    return [task];
  });
  if (problems.length > 0) throw new Error(problems.join(' '));
  return found;
}

function moveTasks(replica: Replica, stackId: string | null, taskIds: string[]): StackMove[] {
  const tasks = checkedTasks(replica, taskIds);
  return tasks.map(before => {
    const after = replica.setTaskStack(before.id, stackId);
    const changed = (before.category ?? null) !== (after.category ?? null);
    return {
      id: after.id,
      title: replica.displayTitle(after),
      ...(changed ? { category: { from: before.category ?? null, to: after.category ?? null } } : {}),
    };
  });
}

function finish(replica: Replica, stackId: string | null, moved: StackMove[]): StackWrite {
  const stack = stackId ? replica.stacks().find(s => s.id === stackId) : undefined;
  return {
    stack: stack ? serializeStack(replica, stack) : null,
    moved,
    ...(stackId && moved.some(m => m.category) ? { note: MOVE_NOTE } : {}),
  };
}

/**
 * File tasks in an existing stack, or take them out with a null `stackId`.
 * Taking one out leaves its category as the stack set it.
 */
export function assignToStack(replica: Replica, stackId: string | null, taskIds: string[]): StackWrite {
  if (taskIds.length === 0) throw new Error('Name at least one task.');
  if (stackId !== null && !replica.stacks().some(s => s.id === stackId)) {
    throw new Error(`No stack with id ${stackId}. list_stacks shows them, and create_stack makes one.`);
  }
  return finish(replica, stackId, moveTasks(replica, stackId, taskIds));
}

export interface CreateStackInput {
  title: string;
  /** A category name from list_categories. Left out, the tasks' shared category is used. */
  category?: string | null;
  /** Tasks to file in it straight away. */
  taskIds?: string[];
}

/**
 * A new stack, optionally with its first tasks. The category is settled before
 * anything is written: a stack's category is imposed on every member, so one
 * guessed wrong would re-file them all.
 */
export function createStack(replica: Replica, input: CreateStackInput): StackWrite {
  const title = input.title.trim();
  if (!title) throw new Error('A stack needs a title.');
  const taskIds = input.taskIds ?? [];
  const tasks = checkedTasks(replica, taskIds);

  let category: string | null = null;
  if (input.category) {
    const named = replica.categories().find(c => c.name.toLowerCase() === input.category!.trim().toLowerCase());
    if (!named) throw new Error(`"${input.category}" is not one of your categories. list_categories shows them.`);
    category = named.name;
  } else if (input.category === undefined && tasks.length > 0) {
    const shared = [...new Set(tasks.map(t => t.category ?? null))];
    if (shared.length !== 1 || shared[0] === null) {
      const seen = shared.map(c => c ?? 'no category').join(', ');
      throw new Error(`These tasks are in different categories (${seen}), and a stack files all of its members under one. Pass category to choose it.`);
    }
    category = shared[0];
  }

  const stack = replica.createStack(title, category);
  const moved = moveTasks(replica, stack.id, taskIds);
  return finish(replica, stack.id, moved);
}
