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

  // Exact substring match
  const exactIdx = h.indexOf(n);
  if (exactIdx !== -1) {
    return { score: 100 + (exactIdx === 0 ? 20 : 0), ranges: [[exactIdx, exactIdx + n.length]] };
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
