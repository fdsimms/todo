import type { Task } from '../types';

/** The group for items with no category, which sorts after every named one. */
export const WISH_UNFILED = 'Other';

/** A bare lowercase, accent-free form, so "cafe" finds "Café". */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Whether a wish list item matches what was typed: every word of the query
 * has to appear in its title, its category or one of its tags, in any order.
 * A blank query matches everything.
 */
export function wishItemMatches(item: Pick<Task, 'title' | 'category' | 'tags'>, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold([item.title, item.category ?? '', ...item.tags].join(' '));
  return words.every(w => haystack.includes(w));
}

export interface WishGroup<T> {
  /** The category, or `WISH_UNFILED` for items with none. */
  name: string;
  items: T[];
}

/**
 * Items grouped under their category, in the project's own order within a
 * group. Groups with the most items come first so the biggest pile is at the
 * top, ties by name, and the uncategorized group is always last.
 */
export function groupWishItems<T extends Pick<Task, 'category'>>(items: readonly T[]): WishGroup<T>[] {
  const byName = new Map<string, T[]>();
  for (const item of items) {
    const name = item.category?.trim() || WISH_UNFILED;
    const bucket = byName.get(name);
    if (bucket) bucket.push(item);
    else byName.set(name, [item]);
  }
  return [...byName.entries()]
    .map(([name, group]) => ({ name, items: group }))
    .sort((a, b) => {
      if ((a.name === WISH_UNFILED) !== (b.name === WISH_UNFILED)) return a.name === WISH_UNFILED ? 1 : -1;
      return b.items.length - a.items.length || a.name.localeCompare(b.name);
    });
}

/**
 * What the wish list section draws: the items narrowed by the search text and
 * the chosen category, and the groups they fall in. With only one group (or
 * none categorized) the headers add nothing, so `grouped` says whether to
 * draw them.
 */
export function wishListView<T extends Pick<Task, 'title' | 'category' | 'tags'>>(
  items: readonly T[],
  query: string,
  category: string | null,
): { matches: T[]; groups: WishGroup<T>[]; categories: WishGroup<T>[]; grouped: boolean } {
  const categories = groupWishItems(items);
  const inCategory = category === null
    ? items
    : items.filter(i => (i.category?.trim() || WISH_UNFILED) === category);
  const matches = inCategory.filter(i => wishItemMatches(i, query));
  const groups = groupWishItems(matches);
  const grouped = categories.length > 1 || (categories.length === 1 && categories[0].name !== WISH_UNFILED);
  return { matches, groups, categories, grouped };
}
