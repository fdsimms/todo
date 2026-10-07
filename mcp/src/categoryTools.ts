/**
 * Deleting a task category by conversation.
 *
 * The app's own delete turns every task in the category uncategorized, and an
 * uncategorized task renders in the loose block above every section of Today.
 * That is a fine answer for a category somebody empties and abandons and a
 * surprising one for a category being merged into another, so this asks which
 * it is: `moveTo` names the category the tasks and stacks go to, and
 * `uncategorize: true` is the explicit "no category". A category holding open
 * work with neither is refused with the count.
 *
 * Every setting that files something under the category is re-pointed with it
 * (each generator's "File them under", and Today's calendar-events section),
 * because one left naming a deleted category files the next generated task
 * under a name nothing has any more.
 */
import type { CategorySettingsPatch, DeletedCategory, Replica } from './replica';

export function deleteCategory(
  replica: Replica,
  input: { name: string; moveTo?: string | null; uncategorize?: boolean },
): DeletedCategory {
  const categories = replica.categories();
  const find = (name: string) => categories.find(c => c.name.toLowerCase() === name.trim().toLowerCase());
  const category = find(input.name);
  if (!category) {
    throw new Error(`"${input.name}" isn't one of your categories (${categories.map(c => c.name).join(', ') || 'none yet'}). list_categories lists them.`);
  }

  let moveTo: string | null = null;
  if (input.moveTo) {
    const target = find(input.moveTo);
    if (!target) throw new Error(`"${input.moveTo}" isn't one of your categories, so nothing can move there. list_categories lists them.`);
    if (target.name === category.name) throw new Error('A category cannot be moved into itself.');
    moveTo = target.name;
  } else {
    const open = replica.tasks().filter(t => t.category === category.name && !t.completed && !t.archived).length;
    if (open > 0 && !input.uncategorize) {
      throw new Error(
        `"${category.name}" still holds ${open} open ${open === 1 ? 'task' : 'tasks'}. Pass moveTo to file them in another category, or uncategorize: true to leave them with none (they then sit in the loose block at the top of Today).`,
      );
    }
  }
  return replica.deleteCategory(category.name, moveTo);
}

export interface UpdateCategoryInput extends CategorySettingsPatch {
  name: string;
  /** Renames it everywhere it is named: tasks, stacks, projects, views, templates, automations. */
  newName?: string;
}

/** Rename a category, change its settings, or both. Returns the category as list_categories shows it. */
export function updateCategory(replica: Replica, input: UpdateCategoryInput) {
  const { name, newName, ...settings } = input;
  if (newName === undefined && Object.keys(settings).length === 0) throw new Error('Nothing to change: give newName or a setting.');
  let current = name;
  if (newName !== undefined) current = replica.renameCategory(name, newName).to;
  if (Object.keys(settings).length > 0) replica.updateCategorySettings(current, settings);
  const category = replica.categories().find(c => c.name === current)!;
  return {
    name: category.name,
    ...(category.emoji ? { emoji: category.emoji } : {}),
    ...(category.scheduleDays ? { schedule: { days: category.scheduleDays, start: category.scheduleStart, end: category.scheduleEnd } } : {}),
    hideOnVacation: category.hideOnVacation,
    excludeFromSuggestions: category.excludeFromSuggestions,
    excludeFromNewTasksBanner: category.excludeFromNewTasksBanner,
    defaultTimeSegments: category.defaultTimeSegments,
    ...(newName !== undefined ? { renamedFrom: name } : {}),
  };
}

export function reorderCategories(replica: Replica, names: string[]): { order: string[] } {
  if (names.length === 0) throw new Error('Name the categories to put first, in order.');
  return { order: replica.reorderCategories(names) };
}
