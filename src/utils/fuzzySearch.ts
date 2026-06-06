import type { Task } from '../types';

export interface SearchResult {
  task: Task;
  score: number;
  titleMatches: [number, number][]; // [start, end] ranges to highlight
}

function scoreSubstring(haystack: string, needle: string): { score: number; ranges: [number, number][] } {
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

export function fuzzySearch(tasks: Task[], query: string): SearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const words = q.split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];

  for (const task of tasks) {
    // Skip subtasks from top-level results
    if (task.parentId) continue;

    let totalScore = 0;
    let titleMatches: [number, number][] = [];

    for (const word of words) {
      const titleResult = scoreSubstring(task.title, word);
      const notesResult = scoreSubstring(task.notes, word);
      const tagScore = task.tags.some(t => t.toLowerCase().includes(word.toLowerCase())) ? 30 : 0;

      // Title matches score highest, notes lower, tags moderate
      totalScore += titleResult.score * 2 + notesResult.score * 0.5 + tagScore;

      if (titleResult.ranges.length > 0) {
        titleMatches = titleMatches.concat(titleResult.ranges);
      }
    }

    if (totalScore > 0) {
      results.push({ task, score: totalScore, titleMatches });
    }
  }

  return results.sort((a, b) => {
    // Completed tasks rank below active ones at equal scores
    if (a.task.completed !== b.task.completed) return a.task.completed ? 1 : -1;
    return b.score - a.score;
  });
}
