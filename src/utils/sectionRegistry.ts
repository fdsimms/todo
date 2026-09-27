import type { TaskGroup } from '../types';

/**
 * The stacks and project sections, for the pure modules that need them
 * without importing the store: the pull logic reads a section's checklist
 * flag and a project's page order. The `projectPause` registry shape, for its
 * reason (`useTaskGroupStore` reaches expo-sqlite). Resolve-or-shrug: with no
 * source registered there are no sections, so nothing is a checklist row and
 * page order is task order.
 */

let source: (() => readonly TaskGroup[]) | null = null;
let cache: { groups: readonly TaskGroup[]; checklists: Set<string> } | null = null;

/** Called once by useTaskGroupStore at module load. Tests can point it at a fixture. */
export function registerSectionSource(fn: (() => readonly TaskGroup[]) | null): void {
  source = fn;
  cache = null;
}

/** Every stack and section there is, or none before a source is registered. */
export function sectionsNow(): readonly TaskGroup[] {
  return source?.() ?? [];
}

/**
 * Whether this task is a line in a checklist section (`TaskGroup.checklist`):
 * ticked off rather than scheduled, so never pulled or dated for it.
 */
export function isChecklistRow(task: { groupId: string | null }): boolean {
  if (!task.groupId) return false;
  const groups = source?.();
  if (!groups) return false;
  if (!cache || cache.groups !== groups) {
    cache = { groups, checklists: new Set(groups.filter(g => g.checklist).map(g => g.id)) };
  }
  return cache.checklists.has(task.groupId);
}
