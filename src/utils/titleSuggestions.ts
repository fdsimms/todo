import type { Task } from '../types';

export interface TitleSuggestion {
  title: string;
  ranges: [number, number][]; // [start, end] ranges to highlight
}

const MIN_QUERY_LENGTH = 3;

const TITLE_START_SCORE = 120;
const WORD_START_SCORE = 100;

interface Candidate {
  title: string;
  score: number;
  ranges: [number, number][];
  recency: number; // ms timestamp used for tie-breaking and casing choice
}

/**
 * Match `query` against the start of `title`, or the start of any word
 * within it — never a mid-word substring. Autocomplete needs a low false-hit
 * rate more than it needs recall, so this is deliberately stricter than
 * fuzzySearch's scoreSubstring.
 */
function matchTitle(title: string, query: string): { score: number; ranges: [number, number][] } | null {
  const h = title.toLowerCase();
  const q = query.toLowerCase();

  if (h.startsWith(q)) return { score: TITLE_START_SCORE, ranges: [[0, q.length]] };

  const wordRe = /\b\w/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(h))) {
    const idx = m.index;
    if (idx > 0 && h.startsWith(q, idx)) {
      return { score: WORD_START_SCORE, ranges: [[idx, idx + q.length]] };
    }
  }

  return null;
}

/**
 * Suggest previously-completed task titles that match what the user is
 * typing, so re-adding an ad-hoc one-off ("use BOGO ticket") lands on the
 * same spelling every time — that's what lets getRepeatedInstances group it
 * on Stats. Only completed titles are offered: suggesting the title of a
 * task that's still open would just create a duplicate.
 *
 * Titles are deduped case-insensitively (keeping the most recently used
 * casing), subtasks are skipped, and matches only fire at the start of the
 * title or the start of a word within it — never mid-word — so the list
 * stays short and relevant instead of surfacing near-random titles that
 * merely share letters. The title that exactly equals the query is
 * excluded, so the list empties itself once a suggestion has been tapped
 * into the field.
 */
export function suggestTitles(tasks: Task[], query: string, limit = 3): TitleSuggestion[] {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];
  const qLower = q.toLowerCase();

  const byTitle = new Map<string, Candidate>();

  for (const task of tasks) {
    if (task.parentId) continue; // skip subtasks, mirroring fuzzySearch
    if (!task.completed || !task.completedAt) continue;
    const title = task.title.trim();
    if (!title) continue;

    const key = title.toLowerCase();
    if (key === qLower) continue; // don't suggest exactly what's already typed

    const match = matchTitle(title, q);
    if (!match) continue;
    const { score, ranges } = match;

    const recency = Date.parse(task.completedAt) || 0;
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
