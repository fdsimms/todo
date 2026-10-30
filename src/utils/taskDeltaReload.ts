import type { Task } from '../types';

/** Past this share of the table changed, a delta saves nothing over reading it all. */
const DELTA_MAX_SHARE = 0.25;

/**
 * What a sync reload does to the task list, without re-reading every row.
 * `presentIds` is every id the table holds now and `changed` the rows the sync
 * wrote, freshly read. Anything in memory the table no longer has is dropped,
 * every changed row replaces (or joins) its old copy, and the rest is kept as
 * it is. Returns null when a full read is the better answer: nothing in memory
 * to build on, or enough of the table changed that the delta is no cheaper.
 * Kept in the table's own order (`sort_order`, then `created_at`); the sort is
 * stable, so ties keep the order they already had.
 */
export function mergeTaskDelta(
  existing: readonly Task[],
  presentIds: readonly string[],
  changed: readonly Task[]
): Task[] | null {
  if (existing.length === 0) return null;
  if (changed.length > presentIds.length * DELTA_MAX_SHARE) return null;
  const present = new Set(presentIds);
  const changedById = new Map(changed.map(t => [t.id, t]));
  const merged: Task[] = [];
  for (const t of existing) {
    if (!present.has(t.id)) continue;
    merged.push(changedById.get(t.id) ?? t);
    changedById.delete(t.id);
  }
  for (const t of changedById.values()) if (present.has(t.id)) merged.push(t);
  // A row that isn't in memory and wasn't named as changed can't be rebuilt from here.
  if (merged.length !== presentIds.length) return null;
  return merged.sort((a, b) => a.sortOrder - b.sortOrder || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}
