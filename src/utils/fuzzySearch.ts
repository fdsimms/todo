import type { Task } from '../types';
import { displayTitleFor } from './visibilityUtils';

export interface SearchResult {
  task: Task;
  score: number;
  titleMatches: [number, number][]; // [start, end] ranges to highlight
  /** The task's project title, resolved here so a row can name it without a second lookup. Null when the task isn't in a project. */
  projectName: string | null;
  /** Ranges to highlight in `projectName` — how a row shows *why* a project-name match matched. */
  projectMatches: [number, number][];
}

/**
 * Overlapping ranges collapsed into one sorted, disjoint set.
 *
 * Every word in the query contributes its own ranges, and two words can match
 * overlapping spans of the same text ("gro groceries"). HighlightedText walks
 * its ranges with a single cursor and emits a segment per range, so an overlap
 * makes it emit the shared span twice — the highlighted text renders
 * duplicated. Merging before it gets there is the fix, and it belongs here
 * because this is where the per-word ranges are accumulated.
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

export function fuzzySearch(
  tasks: Task[],
  query: string,
  projectNamesById: Map<string, string> = new Map()
): SearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const words = q.split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];

  for (const task of tasks) {
    // Skip subtasks from top-level results
    if (task.parentId) continue;

    const projectName = task.projectId ? projectNamesById.get(task.projectId) : undefined;

    let totalScore = 0;
    let titleMatches: [number, number][] = [];
    let projectMatches: [number, number][] = [];

    // Mid-chain, the displayed title is the active step's — see displayTitleFor
    // — so a title match (and its highlight range) has to be scored against
    // that, not the parent's task.title, or the highlight would land on text
    // the row isn't even showing.
    const displayTitle = displayTitleFor(task);

    for (const word of words) {
      const titleResult = scoreSubstring(displayTitle, word);
      const notesResult = scoreSubstring(task.notes, word);
      const tagScore = task.tags.some(t => t.toLowerCase().includes(word.toLowerCase())) ? 30 : 0;
      const categoryResult = task.category ? scoreSubstring(task.category, word) : { score: 0, ranges: [] };
      const projectResult = projectName ? scoreSubstring(projectName, word) : { score: 0, ranges: [] };
      // Weaker, unhighlighted fallback for a keyword that only matches a
      // non-active step's text — the active step is already covered above.
      const chainScore = task.chainItems.reduce(
        (best, item) => Math.max(best, scoreSubstring(item.title, word).score),
        0
      );

      // Title matches score highest, notes/category/project/chain steps lower, tags moderate
      totalScore +=
        titleResult.score * 2 +
        notesResult.score * 0.5 +
        categoryResult.score * 0.5 +
        projectResult.score * 0.5 +
        chainScore * 0.5 +
        tagScore;

      if (titleResult.ranges.length > 0) {
        titleMatches = titleMatches.concat(titleResult.ranges);
      }
      if (projectResult.ranges.length > 0) {
        projectMatches = projectMatches.concat(projectResult.ranges);
      }
    }

    if (totalScore > 0) {
      results.push({
        task,
        score: totalScore,
        titleMatches: mergeRanges(titleMatches),
        projectName: projectName ?? null,
        projectMatches: mergeRanges(projectMatches),
      });
    }
  }

  return results.sort((a, b) => {
    // Completed tasks rank below active ones at equal scores
    if (a.task.completed !== b.task.completed) return a.task.completed ? 1 : -1;
    return b.score - a.score;
  });
}
