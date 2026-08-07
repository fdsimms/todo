import type { Task } from '../types';

/**
 * A project's hand-sorted order, and what it means when the project says the
 * order is mandatory (Project.sequential).
 *
 * Everything here is pure and takes its tasks as a parameter, like blocking.ts
 * next door — the registry (blockerRegistry) is what lets visibilityUtils reach
 * it without importing a store.
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
 * Index every live member of every project by the step it stands at, 1-based.
 *
 * Built in one pass because both callers want it per row: the registry hands
 * out one map per store change so each row's lookup is O(1) rather than a scan
 * of the whole task list, and the project screen numbers its rows from the same
 * function so the badge and the gate can't disagree about what step 3 is.
 */
export function stepNumbersByTask(tasks: readonly Task[]): Map<string, number> {
  const byProject = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.projectId || t.parentId !== null || t.completed || t.archived) continue;
    const bucket = byProject.get(t.projectId);
    if (bucket) bucket.push(t);
    else byProject.set(t.projectId, [t]);
  }
  const steps = new Map<string, number>();
  for (const members of byProject.values()) {
    members.sort((a, b) => a.sortOrder - b.sortOrder);
    members.forEach((t, i) => steps.set(t.id, i + 1));
  }
  return steps;
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
 */
export function slotUpdates(
  members: readonly Task[],
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
