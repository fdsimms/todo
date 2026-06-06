import { colors } from '../theme';

const cache = new Map<string, string>();

export function tagColor(tag: string): string {
  if (cache.has(tag)) return cache.get(tag)!;
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  const color = colors.tagPalette[hash % colors.tagPalette.length];
  cache.set(tag, color);
  return color;
}
