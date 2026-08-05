import type { TaskTemplate } from '../types';

export type TemplateListItem =
  | { type: 'header'; label: string; key: string }
  | { type: 'template'; template: TaskTemplate; key: string };

const UNCATEGORIZED = '';

/**
 * Group templates into category sections for the Templates list, mirroring
 * groupProjectsByCategory (see projectGrouping.ts): uncategorized templates
 * render first with no header, named categories follow in `categoryOrder`
 * (falling back to alphabetical for any category not in that order), each
 * preceded by a header. Within a category, templates keep the relative order
 * they arrive in (i.e. `templates` should already be sorted by sortOrder).
 */
export function groupTemplatesByCategory(templates: TaskTemplate[], categoryOrder: string[] = []): TemplateListItem[] {
  const byCategory = new Map<string, TaskTemplate[]>();
  templates.forEach(t => {
    const key = t.category ?? UNCATEGORIZED;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(t);
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

  const items: TemplateListItem[] = [];
  order.forEach(key => {
    if (key !== UNCATEGORIZED) items.push({ type: 'header', label: key, key: `h-${key}` });
    (byCategory.get(key) ?? []).forEach(t => items.push({ type: 'template', template: t, key: t.id }));
  });
  return items;
}

export interface TemplateDropResolution {
  /** Template ids in their new top-to-bottom order (for sortOrder persistence). */
  templateIds: string[];
  /** Templates whose category changed because of where they were dropped. */
  categoryUpdates: Array<{ id: string; category: string | null }>;
  /** The final, regrouped layout to show immediately after the drop. */
  settled: TemplateListItem[];
}

/**
 * Resolve a drag-and-drop drop on the Templates list, mirroring taskGrouping's
 * resolveDrop: a template adopts the category of the nearest section header
 * above it, and a template dragged above every header becomes uncategorized.
 */
export function resolveTemplateDrop(reordered: TemplateListItem[], categoryOrder: string[] = []): TemplateDropResolution {
  const templateIds: string[] = [];
  const categoryUpdates: Array<{ id: string; category: string | null }> = [];
  const orderedTemplates: TaskTemplate[] = [];
  let currentSection: string | null = null;

  for (const item of reordered) {
    if (item.type === 'header') {
      currentSection = item.label;
      continue;
    }
    templateIds.push(item.template.id);
    const target = currentSection;
    const template = target === item.template.category ? item.template : { ...item.template, category: target };
    if (target !== item.template.category) {
      categoryUpdates.push({ id: item.template.id, category: target });
    }
    orderedTemplates.push(template);
  }

  const settled = groupTemplatesByCategory(orderedTemplates, categoryOrder);
  return { templateIds, categoryUpdates, settled };
}
