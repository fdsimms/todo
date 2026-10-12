/**
 * Matching one string against another, and the highlight ranges that fall out
 * of it — `[start, end)` pairs into the haystack.
 *
 * Its own module rather than a corner of `fuzzySearch` because the settings
 * search needs it too, and `fuzzySearch` reaches the task stores — which reach
 * `expo-sqlite`, which throws on sight in the `node` test environment. Pure
 * string and array arithmetic shouldn't drag a database in behind it.
 *
 * `scoreSubstring` sits here for exactly that reason and by exactly that
 * argument: it's the thing that *produces* the ranges `mergeRanges` merges, and
 * three of its callers (the settings search, the archive matcher, the Logbook's
 * cooking lens) want the matcher without the task model attached.
 * `fuzzySearch` re-exports both, so the call sites that predate the split keep
 * importing them from where they always did.
 */

/**
 * Overlapping ranges collapsed into one sorted, disjoint set.
 *
 * Every word in the query contributes its own ranges, and two words can match
 * overlapping spans of the same text ("gro groceries"). HighlightedText walks
 * its ranges with a single cursor and emits a segment per range, so an overlap
 * makes it emit the shared span twice — the highlighted text renders
 * duplicated. Merging before it gets there is the fix.
 */
export function mergeRanges(ranges: [number, number][]): [number, number][] {
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // Copied, not aliased: the loop widens `last` in place, and the tuples
  // handed in belong to the caller.
  const merged: [number, number][] = [[sorted[0][0], sorted[0][1]]];
  for (const [start, end] of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function scoreSubstring(haystack: string, needle: string): { score: number; ranges: [number, number][] } {
  if (!needle) return { score: 0, ranges: [] };
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();

  // Exact substring match. Where it lands decides the score: the start of the
  // string beats the start of a later word beats the middle of a word, so "lo"
  // ranks "Look into flights" above "Use the cloud credits" and "Cardiologist".
  // Every occurrence is considered, since the first one can sit mid-word while
  // a later one starts a word ("cloud ... lock").
  let bestIdx = -1;
  let bestBonus = -1;
  for (let idx = h.indexOf(n); idx !== -1; idx = h.indexOf(n, idx + 1)) {
    const bonus = idx === 0 ? 40 : /[^\p{L}\p{N}]/u.test(h[idx - 1]) ? 30 : 0;
    if (bonus > bestBonus) {
      bestIdx = idx;
      bestBonus = bonus;
    }
    if (bonus === 40) break;
  }
  if (bestIdx !== -1) {
    return { score: 100 + bestBonus, ranges: [[bestIdx, bestIdx + n.length]] };
  }

  // Fuzzy: all chars of needle appear in order in haystack
  let hi = 0;
  let ni = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  while (hi < h.length && ni < n.length) {
    if (h[hi] === n[ni]) {
      if (firstMatch === -1) firstMatch = hi;
      lastMatch = hi;
      ni++;
    }
    hi++;
  }

  if (ni < n.length) return { score: 0, ranges: [] }; // not all chars found

  const span = lastMatch - firstMatch + 1;
  const density = n.length / span; // 1.0 = all chars consecutive
  const score = Math.round(density * 60);
  return { score, ranges: firstMatch !== -1 ? [[firstMatch, lastMatch + 1]] : [] };
}

export interface MatchExcerpt {
  /** One line, with a leading/trailing "…" where it was cut. */
  text: string;
  /** Highlight ranges into `text`. */
  ranges: [number, number][];
}

/**
 * A one-line window of `text` around where the query's words match it, for a
 * result that matched on text the row doesn't otherwise show (a task's notes).
 *
 * Only exact substring hits count, the same line `quickSearch` draws between a
 * real match and a scattered-letters guess: an excerpt highlighting "l…o…g"
 * spread across a sentence would explain nothing. Returns null when no word
 * matches exactly. The window opens `lead` characters before the first hit,
 * snapped forward to a word start so it never begins mid-word.
 */
export function matchExcerpt(
  text: string,
  words: string[],
  { lead = 24, max = 90 }: { lead?: number; max?: number } = {}
): MatchExcerpt | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return null;

  const hits: [number, number][] = [];
  for (const word of words) {
    const { score, ranges } = scoreSubstring(flat, word);
    if (score >= 100) hits.push(ranges[0]);
  }
  if (hits.length === 0) return null;

  const anchor = Math.min(...hits.map(h => h[0]));
  let start = Math.max(0, anchor - lead);
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space !== -1 && space < anchor) start = space + 1;
  }
  const end = Math.min(flat.length, Math.max(start + max, anchor + 1));
  const prefix = start > 0 ? '…' : '';
  const suffix = end < flat.length ? '…' : '';
  const shift = prefix.length - start;
  const ranges = mergeRanges(
    hits
      .filter(([s, e]) => s >= start && e <= end)
      .map(([s, e]): [number, number] => [s + shift, e + shift])
  );
  return { text: prefix + flat.slice(start, end) + suffix, ranges };
}
