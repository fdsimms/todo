import type { Project, TaskGroup } from '../types';
import { sectionIsList } from './listMode';

/**
 * The stacks and project sections, for the pure modules that need them
 * without importing the store: the pull logic reads a section's checklist
 * flag and a project's page order. The `projectPause` registry shape, for its
 * reason (`useTaskGroupStore` reaches expo-sqlite). Resolve-or-shrug: with no
 * source registered there are no sections, so nothing is a checklist row and
 * page order is task order.
 */

let source: (() => readonly TaskGroup[]) | null = null;
let cache: { groups: readonly TaskGroup[]; byId: Map<string, TaskGroup> } | null = null;

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
 * Whether this task is a list item (src/utils/listMode.ts): checked off
 * rather than scheduled, so never pulled or dated for it.
 *
 * `project` is the task's own project, which the caller already holds: a list
 * project makes its loose rows and its sections items unless a section keeps
 * tasks (`TaskGroup.keepsTasks`). Without it, only a section's own List
 * setting (`TaskGroup.checklist`) counts.
 */
export function isChecklistRow(
  task: { groupId: string | null },
  project?: Pick<Project, 'id' | 'list'> | null,
): boolean {
  const groups = source?.();
  if (task.groupId && groups) {
    if (!cache || cache.groups !== groups) {
      cache = { groups, byId: new Map(groups.map(g => [g.id, g])) };
    }
    const group = cache.byId.get(task.groupId);
    if (group?.projectId) {
      return sectionIsList(group, project && group.projectId === project.id ? project : null);
    }
  }
  return !!project?.list;
}
