/**
 * How often each choice on quick add's `#` and `+` keyboard chips has been used,
 * so the ones you reach for sit first.
 *
 * Counted when a task is created from quick add, never from the task list. A
 * category's row count is the wrong signal: repeating tasks are made once and
 * then copied forward by every completion, so a routine category looks busy
 * without anyone having chosen it lately.
 *
 * Ranking only reorders. Ties keep the order they came in (the user's own
 * category order), so a fresh install, and every name never used, read exactly
 * as before. Deliberately not synced (it isn't in `SYNCED_SETTING_KEYS`): it
 * describes how this phone's keyboard gets used, the way `recentSearches` does.
 * A renamed category starts again from zero; a deleted one's count goes unused.
 */

export type ChipUses = Record<string, number>;

export type ChipUseKind = 'category' | 'tag' | 'project';

/** The key a choice is counted under. Case-folded so "Home" and "home" are one. */
export function chipUseKey(kind: ChipUseKind, name: string): string {
  return `${kind}:${name.trim().toLowerCase()}`;
}

/** The counts after one more use of each key; a repeated key in one call counts once. */
export function bumpChipUses(uses: ChipUses, keys: readonly string[]): ChipUses {
  const next = { ...uses };
  for (const key of new Set(keys)) next[key] = (next[key] ?? 0) + 1;
  return next;
}

/** Most used first, ties left in their incoming order (`sort` is stable). */
export function rankByUse<T>(items: readonly T[], uses: ChipUses, keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => (uses[keyOf(b)] ?? 0) - (uses[keyOf(a)] ?? 0));
}

/** Reads the stored JSON back, dropping anything that isn't a positive count. */
export function parseChipUses(raw: string | null): ChipUses {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ChipUses = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = Math.floor(value);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The existing tags to offer under a tag field: the ones not already on the
 * task, narrowed to what's typed so far, most used first, capped. A tag that
 * starts with the typed text leads one that only contains it, so "wo" offers
 * "work" before "homework". With nothing typed, the most used lead.
 */
export function suggestExistingTags(
  allTags: readonly string[],
  chosen: readonly string[],
  typed: string,
  uses: ChipUses,
  limit: number,
): string[] {
  const taken = new Set(chosen.map(t => t.toLowerCase()));
  const open = rankByUse(allTags.filter(t => !taken.has(t.toLowerCase())), uses, t => chipUseKey('tag', t));
  const query = typed.trim().toLowerCase().replace(/^#/, '');
  if (!query) return open.slice(0, limit);
  const starts = open.filter(t => t.toLowerCase().startsWith(query));
  const contains = open.filter(t => !t.toLowerCase().startsWith(query) && t.toLowerCase().includes(query));
  return [...starts, ...contains].slice(0, limit);
}
