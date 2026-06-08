const TAG_PALETTE = [
  '#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2',
  '#5E5CE6', '#FF375F', '#64D2FF', '#FFD60A', '#AC8E68',
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
