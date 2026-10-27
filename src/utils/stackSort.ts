import type { Task } from '../types';

/**
 * A stack's members as ids, A to Z by title. Case and accents are ignored and
 * digits compare as numbers ("Level 2" before "Level 10"), the same rule the
 * project page's "Sort A to Z" uses. Ties keep their current order.
 */
export function stackMemberIdsAToZ(members: readonly Task[]): string[] {
  return members
    .map((task, index) => ({ task, index }))
    .sort((a, b) =>
      a.task.title.localeCompare(b.task.title, undefined, { sensitivity: 'base', numeric: true })
      || a.index - b.index)
    .map(entry => entry.task.id);
}
