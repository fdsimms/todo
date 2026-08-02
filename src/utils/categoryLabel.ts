import type { Category } from '../types';

// Prefixes a category name with its emoji identifier, if one is set.
export function categoryLabel(name: string | null | undefined, categories: Category[]): string {
  if (!name) return '';
  const emoji = categories.find(c => c.name === name)?.emoji;
  return emoji ? `${emoji} ${name}` : name;
}
