/**
 * Highlight ranges, as `[start, end)` pairs into some string.
 *
 * Its own module rather than a corner of `fuzzySearch` because the settings
 * search needs it too, and `fuzzySearch` reaches the task stores — which reach
 * `expo-sqlite`, which throws on sight in the `node` test environment. Pure
 * array arithmetic shouldn't drag a database in behind it.
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
