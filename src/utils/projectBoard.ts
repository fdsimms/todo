import type { Task, TaskGroup } from '../types';
import type { ProjectListItem } from './projectStacks';

/**
 * A project drawn as a board (`Project.boardView`): one column for the tasks
 * in no section, then one per section, each holding its open tasks in their
 * own order. It is a second drawing of the same list the project page draws
 * (`buildProjectListItems`), not a second order: a card moved here is written
 * through the store actions the list's own drags use, so switching back to
 * the list shows the same rows in the same places.
 *
 * The rules a drag needs (which column a finger is over, which slot in it,
 * and what a drop writes) live here so they can be tested; the component
 * only measures and draws.
 */

export interface BoardColumn {
  /** `loose` for the no-section column, else the section's id. */
  key: string;
  group: TaskGroup | null;
  tasks: Task[];
}

export const LOOSE_COLUMN_KEY = 'loose';

/**
 * The no-section column always comes first, even when empty, so a card can be
 * taken out of a section by dropping it there. Sections follow in the order
 * the list puts them in.
 */
export function boardColumns(items: readonly ProjectListItem[]): BoardColumn[] {
  const loose: Task[] = [];
  const sections: BoardColumn[] = [];
  for (const item of items) {
    if (item.type === 'task') loose.push(item.task);
    else sections.push({ key: item.group.id, group: item.group, tasks: item.children });
  }
  return [{ key: LOOSE_COLUMN_KEY, group: null, tasks: loose }, ...sections];
}

/**
 * The column under a finger's x. Between two columns (the gap) or past either
 * end, it is the nearest one, so a card can't fall into nowhere.
 */
export function columnIndexAt(frames: readonly { x: number; width: number }[], x: number): number | null {
  if (frames.length === 0) return null;
  let best = 0;
  let bestDistance = Infinity;
  frames.forEach((frame, index) => {
    const distance = x < frame.x ? frame.x - x : x > frame.x + frame.width ? x - (frame.x + frame.width) : 0;
    if (distance < bestDistance) { bestDistance = distance; best = index; }
  });
  return best;
}

/**
 * Where a card lands among a column's cards: the number of cards whose middle
 * is above the finger. `frames` leaves out the card being dragged, so the
 * answer is an index into the column as it would be without it.
 */
export function insertIndexAt(frames: readonly { top: number; height: number }[], y: number): number {
  let index = 0;
  for (const frame of frames) {
    if (frame.top + frame.height / 2 < y) index++;
  }
  return index;
}

/** What a drop writes, in the order the store actions have to run. */
export type BoardMove =
  | { kind: 'none' }
  | {
      kind: 'move';
      taskId: string;
      /** The section it lands in, or null for the no-section column. */
      groupId: string | null;
      /** The section it is leaving, when it leaves one. */
      leaveGroupId: string | null;
      /** The section it is joining, when it joins one. */
      joinGroupId: string | null;
      /** The destination section's open tasks in their new order. */
      groupOrder: string[] | null;
      /**
       * The project's whole top-level order (loose tasks and sections), for a
       * card landing in the no-section column. The whole order rather than the
       * column's own, so a loose task keeps its place among the sections when
       * the page is switched back to a list.
       */
      projectOrder: string[] | null;
    };

/**
 * The writes for dropping `taskId` at `toIndex` in column `toKey`.
 *
 * In the no-section column the card goes before the loose task that will
 * follow it in the list order, or after the last loose task, so its place
 * among the sections is as close as the list can say. Dropped where it
 * already was, nothing is written.
 */
export function boardMove(
  items: readonly ProjectListItem[],
  taskId: string,
  toKey: string,
  toIndex: number,
): BoardMove {
  const columns = boardColumns(items);
  const from = columns.find(column => column.tasks.some(t => t.id === taskId));
  const to = columns.find(column => column.key === toKey);
  if (!from || !to) return { kind: 'none' };
  const rest = to.tasks.filter(t => t.id !== taskId).map(t => t.id);
  const at = Math.max(0, Math.min(toIndex, rest.length));
  const ordered = [...rest.slice(0, at), taskId, ...rest.slice(at)];
  if (from.key === to.key && ordered.every((id, i) => id === to.tasks[i]?.id)) return { kind: 'none' };

  const leaveGroupId = from.group && from.key !== to.key ? from.group.id : null;
  if (to.group) {
    return {
      kind: 'move',
      taskId,
      groupId: to.group.id,
      leaveGroupId,
      joinGroupId: from.key !== to.key ? to.group.id : null,
      groupOrder: ordered,
      projectOrder: null,
    };
  }

  const itemId = (item: ProjectListItem) => (item.type === 'group' ? item.group.id : item.task.id);
  const without = items.filter(item => !(item.type === 'task' && item.task.id === taskId)).map(itemId);
  const following = ordered[at + 1];
  let projectOrder: string[];
  if (following !== undefined) {
    const before = without.indexOf(following);
    projectOrder = [...without.slice(0, before), taskId, ...without.slice(before)];
  } else {
    const previous = ordered[at - 1];
    const after = previous !== undefined ? without.indexOf(previous) + 1 : without.length;
    projectOrder = [...without.slice(0, after), taskId, ...without.slice(after)];
  }
  return { kind: 'move', taskId, groupId: null, leaveGroupId, joinGroupId: null, groupOrder: null, projectOrder };
}
