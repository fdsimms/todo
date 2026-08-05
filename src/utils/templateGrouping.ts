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

export const isTemplateHeader = (item: TemplateListItem): boolean => item.type === 'header';

/** Template ids in flattened order, headers dropped — for sortOrder persistence. */
export function templateOrderFromItems(items: TemplateListItem[]): string[] {
  return items.filter((i): i is Extract<TemplateListItem, { type: 'template' }> => i.type === 'template').map(i => i.template.id);
}
