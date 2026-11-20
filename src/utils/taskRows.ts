/**
 * Finding and replacing one row in the task array without a pass of closure
 * calls over all of it.
 *
 * Completed rows are kept (for ever by default), so on a phone in long use the
 * array is mostly history, and a single tap used to make a dozen
 * `.find(t => …)` / `.map(t => …)` passes over every row of it: the cost of a
 * tick grew with how long the app had been used. These do the same work as a
 * plain loop and one native copy, which costs a fraction of a pass that calls
 * a function per row, on Hermes most of all.
 *
 * The scan runs from the end because that is where live rows are: the array
 * is loaded in `sortOrder`, new rows take the next rank and a spawned
 * successor is appended, so the row a tap is about is usually within the last
 * few hundred. Which end it starts from never changes the answer, since ids
 * are unique.
 */

/** Index of the row with this id, or -1. */
export function taskIndexById<T extends { id: string }>(tasks: readonly T[], id: string): number {
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (tasks[i].id === id) return i;
  }
  return -1;
}

/** The row with this id, the same answer as `tasks.find(t => t.id === id)`. */
export function taskById<T extends { id: string }>(tasks: readonly T[], id: string): T | undefined {
  const index = taskIndexById(tasks, id);
  return index < 0 ? undefined : tasks[index];
}

/**
 * A copy of `tasks` with the row of this id swapped for `next` (or for what
 * `next` makes of it): the same answer as
 * `tasks.map(t => (t.id === id ? next : t))`, and like it always a new array,
 * so a caller that relied on the write being seen still is.
 */
export function withTaskReplaced<T extends { id: string }>(tasks: readonly T[], id: string, next: T | ((row: T) => T)): T[] {
  const copy = tasks.slice();
  const index = taskIndexById(tasks, id);
  if (index >= 0) copy[index] = typeof next === 'function' ? next(tasks[index]) : next;
  return copy;
}

/** Past this many ids, one pass with a set beats a scan per id. */
const SCAN_PER_ID_LIMIT = 8;

/** Which of `ids` have a row in `tasks`. */
export function idsPresent<T extends { id: string }>(tasks: readonly T[], ids: readonly string[]): Set<string> {
  const present = new Set<string>();
  if (ids.length === 0) return present;
  if (ids.length <= SCAN_PER_ID_LIMIT) {
    for (const id of ids) {
      if (taskIndexById(tasks, id) >= 0) present.add(id);
    }
    return present;
  }
  const wanted = new Set(ids);
  for (let i = 0; i < tasks.length; i++) {
    if (wanted.has(tasks[i].id)) present.add(tasks[i].id);
  }
  return present;
}

/**
 * `tasks` with each of `rows` in place of the row sharing its id, and the rest
 * appended in the order given. Two of `rows` with one id count once, the later
 * one winning. Returns `tasks` itself when there is nothing to add.
 */
export function withRowsUpserted<T extends { id: string }>(tasks: T[], rows: readonly T[]): T[] {
  if (rows.length === 0) return tasks;
  const byId = new Map(rows.map(row => [row.id, row]));
  const next = tasks.slice();
  if (byId.size <= SCAN_PER_ID_LIMIT) {
    for (const [id, row] of byId) {
      const index = taskIndexById(tasks, id);
      if (index >= 0) next[index] = row;
      else next.push(row);
    }
    return next;
  }
  for (let i = 0; i < tasks.length; i++) {
    const row = byId.get(tasks[i].id);
    if (!row) continue;
    next[i] = row;
    byId.delete(tasks[i].id);
  }
  for (const row of byId.values()) next.push(row);
  return next;
}
