/**
 * The Backfill screen's pools, in their own dependency-free module so a link
 * parser (`deepLinks.ts`) can name them without pulling in the stores and the
 * database that `backfillTasks.ts` reads.
 */
export type BackfillArea = 'task' | 'category' | 'project' | 'person' | 'item' | 'recipe';

export const BACKFILL_AREAS: readonly BackfillArea[] = ['task', 'category', 'project', 'person', 'item', 'recipe'];

export function isBackfillArea(value: unknown): value is BackfillArea {
  return typeof value === 'string' && (BACKFILL_AREAS as readonly string[]).includes(value);
}
