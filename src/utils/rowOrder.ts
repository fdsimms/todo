/**
 * The order the keyboard walks a list in: the tasks a person can see, top to
 * bottom, as ids (`rowCursor.ts` steps through them).
 *
 * It is built from what each view draws, not from the tasks the view filters.
 * "Select all" reads the filtered array, which for Today still holds the tasks
 * inside a collapsed category and a folded stack, and for Later is in sort
 * order rather than date order, so an arrow key led by it would land on rows
 * nobody can see. Here a folded section contributes nothing and a task a view
 * draws twice (a pinned task's copy, a task on two days) is listed once, at
 * its first place.
 *
 * Each result also says where its row is, so the screen can scroll it into
 * view: a key for the two lists that scroll by key (Today and Later), the
 * list index for the two that scroll by index (Unscheduled and Inbox). A
 * stack's member has no row of its own to scroll to, so it carries its stack's.
 */
import type { LaterListItem } from './taskGrouping';

export interface RowOrder {
  /** Task ids, top to bottom, each once. */
  ids: string[];
  /**
   * Where to scroll to bring each one into view: a list row key, a list index,
   * or nothing for a row that isn't one of the list's own (a project band is
   * part of its header).
   */
  slots: Map<string, string | number>;
}

export const NO_ROWS: RowOrder = { ids: [], slots: new Map() };

type TaskRow = { type: 'task'; task: { id: string } };
type GroupRow = { type: 'group'; group: { id: string }; children: readonly { id: string }[] };
/** Everything else a list draws between its tasks: headers, and rows that aren't tasks. */
type OtherRow = { type: 'header' | 'subheader' | 'context' };
export type OrderableRow = TaskRow | GroupRow | OtherRow;

class OrderBuilder {
  readonly ids: string[] = [];
  readonly slots = new Map<string, string | number>();

  add(id: string, slot: string | number | null): void {
    if (this.slots.has(id) || this.ids.includes(id)) return;
    this.ids.push(id);
    if (slot !== null) this.slots.set(id, slot);
  }

  build(): RowOrder {
    return { ids: this.ids, slots: this.slots };
  }
}

/**
 * Today: the project bands (each a list of rows, drawn above the list), then
 * the list itself. `groupOpen` says whether a stack shows its members; a closed
 * one has none to walk. A stack's members slot to the stack's row (`g-<id>`), a
 * task to its own id, and a band's rows to nothing.
 */
export function todayRowOrder(
  bands: readonly (readonly OrderableRow[])[],
  data: readonly OrderableRow[],
  groupOpen: (group: { id: string }) => boolean,
): RowOrder {
  const order = new OrderBuilder();
  for (const band of bands) {
    for (const item of band) {
      if (item.type === 'task') order.add(item.task.id, null);
      else if (item.type === 'group' && groupOpen(item.group)) for (const child of item.children) order.add(child.id, null);
    }
  }
  for (const item of data) {
    if (item.type === 'task') order.add(item.task.id, item.task.id);
    else if (item.type === 'group' && groupOpen(item.group)) {
      for (const child of item.children) order.add(child.id, `g-${item.group.id}`);
    }
  }
  return order.build();
}

/**
 * Inbox: tasks and stacks in one flat list scrolled by index. A stack's
 * members slot to the stack's index, a task to its own.
 */
export function flatRowOrder(
  items: readonly OrderableRow[],
  groupOpen: (group: { id: string }) => boolean,
): RowOrder {
  const order = new OrderBuilder();
  items.forEach((item, index) => {
    if (item.type === 'task') order.add(item.task.id, index);
    else if (item.type === 'group' && groupOpen(item.group)) for (const child of item.children) order.add(child.id, index);
  });
  return order.build();
}

/** Unscheduled: one row per task, in the order drawn. */
export function unscheduledRowOrder(tasks: readonly { id: string }[]): RowOrder {
  const order = new OrderBuilder();
  tasks.forEach((task, index) => order.add(task.id, index));
  return order.build();
}

/**
 * Later: day headers and tasks, with a day's stack folded into one row. A
 * folded stack's members are on screen only when it is opened (`openStacks`),
 * and then only the first `preview` of them until "Show more" (`expandedStacks`).
 * Every row slots to its list item's own key; a stack's members to the stack's.
 */
export function laterRowOrder(
  items: readonly LaterListItem[],
  openStacks: ReadonlySet<string>,
  expandedStacks: ReadonlySet<string>,
  preview: number,
): RowOrder {
  const order = new OrderBuilder();
  for (const item of items) {
    if (item.type === 'task') order.add(item.task.id, item.key);
    else if (item.type === 'stack' && openStacks.has(item.key)) {
      const shown = expandedStacks.has(item.key) ? item.tasks : item.tasks.slice(0, preview);
      for (const task of shown) order.add(task.id, item.key);
    }
  }
  return order.build();
}
