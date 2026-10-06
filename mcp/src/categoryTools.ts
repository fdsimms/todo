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
import type { DeletedCategory, Replica } from './replica';

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
