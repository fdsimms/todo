/**
 * The task writes that are not an edit of fields: delete, skip, reorder, a set
 * of dates, a copy, a tag taken off everything, and a completion's date.
 *
 * Each is the app's own rule, through a core the store and the replica share
 * (`taskSkip.ts`, `taskDates.ts`, `taskDuplicate.ts`, `projectOrder.ts`), so
 * what an agent does here is what the same tap does on the phone. Every one is
 * recorded in Activity with its way back (agentLedger.ts); a delete keeps the
 * rows it took, so it can be restored there.
 */
import type { Replica, ReorderScope } from './replica';
import { getTask, type GetTaskResult } from './tools';
import { serializeTasks, type SerializedTask } from './serialize';
import { localDateInput } from './timeZone';

/** The most a call deletes at once. A Logbook cleared by hand is still one confirmed call. */
export const MAX_DELETE = 100;

export interface DeleteTasksResult {
  deleted: { id: string; title: string; checklistItems: number }[];
  note: string;
}

export function deleteTasks(replica: Replica, ids: string[]): DeleteTasksResult {
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw new Error('Name at least one task to delete.');
  if (unique.length > MAX_DELETE) throw new Error(`At most ${MAX_DELETE} tasks a call.`);
  // Checked before the first delete, so one bad id refuses the call rather
  // than leaving it half done.
  for (const id of unique) {
    const task = replica.taskById(id);
    if (!task) throw new Error(`No task with id ${id}.`);
    if (task.generatedKind) {
      throw new Error(`"${task.title}" was written by the app. Deleting one in the app also tells its source not to make it again, which this server cannot do, so the phone would add it back. Delete it in the app, or archive it with archive_task. Nothing was deleted.`);
    }
  }
  // A checklist item whose task is deleted in the same call goes with it.
  const named = new Set(unique);
  const deleted = unique
    .filter(id => {
      const parent = replica.taskById(id)?.parentId;
      return !(parent && named.has(parent));
    })
    .map(id => {
      const { task, subtasks } = replica.deleteTask(id);
      return { id: task.id, title: task.title, checklistItems: subtasks.length };
    });
  return {
    deleted,
    note: 'Deleted, not archived: gone from every list, the Logbook and Stats. Each can be restored from the app\'s Activity screen (Settings › Activity), under Claude, until it is re-created. Prefer archive_task when the person only wants it out of the way.',
  };
}

export function skipOccurrence(replica: Replica, id: string): { task: SerializedTask; next: string } {
  const task = replica.skipOccurrence(id);
  return {
    task: serializeTasks(replica, [task])[0],
    next: task.dueDate
      ? `Skipped. Nothing was completed or marked missed; the next occurrence is on ${replica.dayKeyOf(task.dueDate)}.`
      : 'Skipped to the next step. Nothing was completed or marked missed.',
  };
}

export interface ReorderInput {
  projectId?: string;
  parentId?: string;
  pinned?: boolean;
  ids: string[];
}

export function reorderTasks(replica: Replica, input: ReorderInput): { order: { id: string; title: string }[]; moved: number } {
  const given = [input.projectId !== undefined, input.parentId !== undefined, input.pinned === true].filter(Boolean).length;
  if (given !== 1) throw new Error('Name one list to reorder: projectId, parentId (a task\'s checklist) or pinned: true.');
  if (input.ids.length === 0) throw new Error('ids: name the tasks to put first, in order.');
  const scope: ReorderScope = input.projectId !== undefined
    ? { projectId: input.projectId }
    : input.parentId !== undefined ? { parentId: input.parentId } : { pinned: true };
  const changed = replica.reorderTasks(scope, input.ids);
  const all = replica.tasks();
  const order = 'projectId' in scope
    ? all.filter(t => t.projectId === scope.projectId && !t.parentId && !t.completed && !t.archived).sort((a, b) => a.sortOrder - b.sortOrder)
    : 'parentId' in scope
      ? all.filter(t => t.parentId === scope.parentId).sort((a, b) => a.sortOrder - b.sortOrder)
      : all.filter(t => t.pinned && !t.completed && !t.archived && !t.parentId).sort((a, b) => a.pinnedOrder - b.pinnedOrder);
  return { order: order.map(t => ({ id: t.id, title: t.title })), moved: changed.length };
}

export interface SetTaskDatesResult extends GetTaskResult {
  dates: string[];
  added: number;
  removed: number;
}

export function setTaskDates(replica: Replica, id: string, dates: string[], monthly = false): SetTaskDatesResult {
  const parsed = dates.map(d => {
    const at = new Date(localDateInput(d));
    if (Number.isNaN(at.getTime())) throw new Error(`"${d}" is not a date I can read. Use YYYY-MM-DD.`);
    return at;
  });
  if (parsed.length === 0) throw new Error('Give at least one date. To take a task\'s date away, use defer_task with null.');
  const result = replica.setTaskDates(id, parsed, monthly);
  const set = result.task.seriesId
    ? replica.tasks().filter(t => t.seriesId === result.task.seriesId && !t.parentId && !t.completed && !t.archived)
    : [result.task];
  return {
    ...getTask(replica, result.task.id)!,
    dates: set.map(t => (t.dueDate ? replica.dayKeyOf(t.dueDate) : '')).filter(Boolean).sort(),
    added: result.added.length,
    removed: result.removed.length,
  };
}

export function duplicateTask(replica: Replica, id: string): GetTaskResult {
  return getTask(replica, replica.duplicateTask(id).id)!;
}

export function deleteTag(replica: Replica, tag: string): { tag: string; removedFrom: number; tags: string[] } {
  const changed = replica.deleteTag(tag);
  return { tag, removedFrom: changed.length, tags: replica.tagList() };
}

export function setCompletionDate(replica: Replica, id: string, date: string): SerializedTask {
  const at = new Date(localDateInput(date));
  return serializeTasks(replica, [replica.setCompletedAt(id, at)])[0];
}
