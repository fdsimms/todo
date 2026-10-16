import type { Task } from '../types';
import { TASK_KIND_META, taskKindOf, type TaskKind } from './taskKinds';

/**
 * Narrowing a list by what shape of task a row is: the six kinds the editor's
 * type picker offers, plus whether it repeats.
 *
 * **"Repeating" is its own chip, not a seventh kind.** A kind is exclusive (a
 * task is one of six, by `taskKindOf`'s precedence), and a repeat is a separate
 * property that any of them can carry: a daily target and a weekly timed
 * walk both repeat. So the filter matches on *any* selected chip, and a task
 * can answer to two of them. The chips are never ANDed: "Timed" plus
 * "Repeating" is read as "either of these", the same as every other multi-chip
 * filter on the sheet.
 *
 * Derived from the row, never stored, for the reason `taskKindOf` gives: an
 * existing task reads back as whatever it already was.
 */
export type TaskTypeFilter = TaskKind | 'repeating';

/** Chip order: the kinds in the editor's own order, then the repeat. */
export const TASK_TYPE_FILTERS: readonly TaskTypeFilter[] = [
  ...TASK_KIND_META.map(k => k.key),
  'repeating',
];

const LABELS: Record<TaskTypeFilter, string> = {
  ...Object.fromEntries(TASK_KIND_META.map(k => [k.key, k.label])) as Record<TaskKind, string>,
  repeating: 'Repeating',
};

export function taskTypeFilterLabel(type: TaskTypeFilter): string {
  return LABELS[type];
}

/** Every chip a task answers to: its kind, and `repeating` when it repeats. */
export function taskTypesOf(task: Task): TaskTypeFilter[] {
  const types: TaskTypeFilter[] = [taskKindOf(task)];
  if (task.recurrenceType !== 'none') types.push('repeating');
  return types;
}

/** Whether a task shows under the chips picked. An empty pick filters nothing. */
export function matchesTaskTypes(task: Task, selected: readonly TaskTypeFilter[]): boolean {
  if (selected.length === 0) return true;
  return taskTypesOf(task).some(t => selected.includes(t));
}

/** Narrows a list, handing back the same array when nothing is picked. */
export function filterByTaskTypes<T extends Task>(tasks: T[], selected: readonly TaskTypeFilter[]): T[] {
  if (selected.length === 0) return tasks;
  return tasks.filter(t => matchesTaskTypes(t, selected));
}

/** Reads a stored list back, dropping anything that isn't a chip we know. */
export function parseTaskTypeFilters(raw: string | null): TaskTypeFilter[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return TASK_TYPE_FILTERS.filter(t => parsed.includes(t));
  } catch {
    return [];
  }
}
