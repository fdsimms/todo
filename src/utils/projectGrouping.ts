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

export interface ProjectDropResolution {
  /** Project ids in their new top-to-bottom order (for sortOrder persistence). */
  projectIds: string[];
  /** Projects whose category changed because of where they were dropped. */
  categoryUpdates: Array<{ id: string; category: string | null }>;
  /** The final, regrouped layout to show immediately after the drop. */
  settled: ProjectListItem[];
}

/**
 * Resolve a drag-and-drop drop on the Projects list, mirroring taskGrouping's
 * resolveDrop: a project adopts the category of the nearest section header
 * above it, and a project dragged above every header becomes uncategorized.
 */
export function resolveProjectDrop(reordered: ProjectListItem[], categoryOrder: string[] = []): ProjectDropResolution {
  const projectIds: string[] = [];
  const categoryUpdates: Array<{ id: string; category: string | null }> = [];
  const orderedProjects: Project[] = [];
  let currentSection: string | null = null;

  for (const item of reordered) {
    if (item.type === 'header') {
      currentSection = item.label;
      continue;
    }
    projectIds.push(item.project.id);
    const target = currentSection;
    const project = target === item.project.category ? item.project : { ...item.project, category: target };
    if (target !== item.project.category) {
      categoryUpdates.push({ id: item.project.id, category: target });
    }
    orderedProjects.push(project);
  }

  const settled = groupProjectsByCategory(orderedProjects, categoryOrder);
  return { projectIds, categoryUpdates, settled };
}
