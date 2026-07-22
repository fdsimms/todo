import type { Task } from '../types';
import { scoreSubstring } from './fuzzySearch';

export interface TitleSuggestion {
  title: string;
  ranges: [number, number][]; // [start, end] ranges to highlight
}

const MIN_QUERY_LENGTH = 2;

interface Candidate {
  title: string;
  score: number;
  ranges: [number, number][];
  recency: number; // ms timestamp used for tie-breaking and casing choice
}

/**
 * Suggest previously-used task titles that match what the user is typing.
 *
 * Titles are deduped case-insensitively (keeping the most recently used
 * casing), subtasks are skipped, and completed tasks are intentionally
 * included — surfacing a one-off you finished before is the whole point. The
 * title that exactly equals the query is excluded, so the list empties itself
 * once a suggestion has been tapped into the field.
 */
export function suggestTitles(tasks: Task[], query: string, limit = 5): TitleSuggestion[] {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];
  const qLower = q.toLowerCase();

  const byTitle = new Map<string, Candidate>();

  for (const task of tasks) {
    if (task.parentId) continue; // skip subtasks, mirroring fuzzySearch
    const title = task.title.trim();
    if (!title) continue;

    const key = title.toLowerCase();
    if (key === qLower) continue; // don't suggest exactly what's already typed

    const { score, ranges } = scoreSubstring(title, q);
    if (score <= 0) continue;

    const recency = Date.parse(task.completedAt ?? task.createdAt) || 0;
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, { title, score, ranges, recency });
    } else {
      // Keep the best score; use the most recent occurrence's casing/ranges.
      if (score > existing.score) existing.score = score;
      if (recency > existing.recency) {
        existing.recency = recency;
        existing.title = title;
        existing.ranges = ranges;
      }
    }
  }

  return Array.from(byTitle.values())
    .sort((a, b) => (b.score - a.score) || (b.recency - a.recency))
    .slice(0, limit)
    .map(({ title, ranges }) => ({ title, ranges }));
}
