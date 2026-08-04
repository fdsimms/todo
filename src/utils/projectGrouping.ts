import type { Project } from '../types';

export type ProjectListItem =
  | { type: 'header'; label: string; key: string }
  | { type: 'project'; project: Project; key: string };

const UNCATEGORIZED = '';

/**
 * Group projects into category sections for the Projects list, mirroring
 * makeCategoryGroups (see taskGrouping.ts): uncategorized projects render
 * first with no header, named categories follow in `categoryOrder` (falling
 * back to alphabetical for any category not in that order), each preceded by
 * a header. Within a category, projects keep the relative order they arrive
 * in (i.e. `projects` should already be sorted by sortOrder).
 */
export function groupProjectsByCategory(projects: Project[], categoryOrder: string[] = []): ProjectListItem[] {
  const byCategory = new Map<string, Project[]>();
  projects.forEach(p => {
    const key = p.category ?? UNCATEGORIZED;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(p);
  });

  const order: string[] = [];
  if (byCategory.has(UNCATEGORIZED)) order.push(UNCATEGORIZED);
  categoryOrder.forEach(cat => {
    if (byCategory.has(cat)) order.push(cat);
  });
  Array.from(byCategory.keys())
    .filter(cat => cat !== UNCATEGORIZED && !order.includes(cat))
    .sort()
    .forEach(cat => order.push(cat));

  const items: ProjectListItem[] = [];
  order.forEach(key => {
    if (key !== UNCATEGORIZED) items.push({ type: 'header', label: key, key: `h-${key}` });
    (byCategory.get(key) ?? []).forEach(p => items.push({ type: 'project', project: p, key: p.id }));
  });
  return items;
}

export const isProjectHeader = (item: ProjectListItem): boolean => item.type === 'header';

/** Project ids in flattened order, headers dropped — for sortOrder persistence. */
export function projectOrderFromItems(items: ProjectListItem[]): string[] {
  return items.filter((i): i is Extract<ProjectListItem, { type: 'project' }> => i.type === 'project').map(i => i.project.id);
}
