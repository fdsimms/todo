// No red or pink: those are the app's error and overdue colours, so a tag that
// hashed to one read as a problem ("no recipe" looked like a failure). Keep the
// length at 10 so every other tag keeps the colour it already had.
const TAG_PALETTE = [
  '#0A84FF', '#30D158', '#FF9F0A', '#00C7BE', '#BF5AF2',
  '#5E5CE6', '#8E8E93', '#64D2FF', '#FFD60A', '#AC8E68',
];

const cache = new Map<string, string>();

export function tagColor(tag: string): string {
  if (cache.has(tag)) return cache.get(tag)!;
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  const color = TAG_PALETTE[hash % TAG_PALETTE.length];
  cache.set(tag, color);
  return color;
}
