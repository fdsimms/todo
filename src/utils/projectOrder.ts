import type { Task } from '../types';

/**
 * A project's hand-sorted order.
 *
 * Everything here is pure and takes its tasks as a parameter, like blocking.ts
 * next door.
 */

/**
 * The live members of a project, in the order they're meant to be worked.
 *
 * "Live" is the same set the project screen lists above the fold: top-level
 * rows, not completed, not archived. Completed members are history and
 * archived ones were filed away on purpose, so neither holds a slot in the
 * queue — a sequence whose second step was archived must let the third one
 * through, not wait on a row nobody can see.
 */
export function liveProjectSteps(projectId: string, tasks: readonly Task[]): Task[] {
  return tasks
    .filter(t => t.projectId === projectId && t.parentId === null && !t.completed && !t.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * New sortOrders for a reordered subset, laid into the slots that subset
 * already occupies.
 *
 * The alternative — renumbering the project's tasks 1..N, which is what
 * reorderTasks and reorderSubtasks do for their own lists — would be wrong
 * here, because Task.sortOrder is one global space and a dated project task
 * sits in it alongside every loose task on Today. Renumbering would drag the
 * whole project to the top of that list every time the user tidied its order.
 * So the slots stay put and only their occupants change, the same trick
 * reorderWithCategoryUpdates uses to keep stacks interleaved with tasks.
 *
 * The slots are forced strictly increasing before they're handed out: rows
 * created in a batch can share a sortOrder (a template apply, an import), and
 * reassigning a run of equal numbers would leave the drag with nothing to
 * persist and the row snapping back.
 *
 * Takes anything holding a slot rather than `Task[]` specifically, because a
 * project's list holds stacks as well: `TaskGroup.sortOrder` is the same number
 * space (see the note on that field), so an empty stack occupies a slot here
 * exactly like a task does and the two are reordered against each other in one
 * pass. Ids not in `members` are ignored, so a caller can pass the whole
 * universe and let `orderedIds` say which rows actually moved.
 */
export function slotUpdates(
  members: readonly { id: string; sortOrder: number }[],
  orderedIds: readonly string[],
): Array<{ id: string; sortOrder: number }> {
  const byId = new Map(members.map(t => [t.id, t]));
  const moving = orderedIds.filter(id => byId.has(id));
  if (moving.length === 0) return [];

  const slots = moving
    .map(id => byId.get(id)!.sortOrder)
    .sort((a, b) => a - b);
  for (let i = 1; i < slots.length; i++) {
    if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1;
  }

  return moving
    .map((id, i) => ({ id, sortOrder: slots[i] }))
    .filter(u => byId.get(u.id)!.sortOrder !== u.sortOrder);
}
