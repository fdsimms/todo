import type { Task, TaskGroup } from '../types';
import { displayTitleFor } from './visibilityUtils';
import { mergeRanges, scoreSubstring } from './ranges';

// Re-exported so the existing call sites (and their tests) keep importing them
// from here; both moved to `ranges.ts` so a search that isn't over tasks can
// use them without pulling this module's store imports along.
export { mergeRanges, scoreSubstring };

export interface SearchResult {
  task: Task;
  score: number;
  titleMatches: [number, number][]; // [start, end] ranges to highlight
  /** The task's project title, resolved here so a row can name it without a second lookup. Null when the task isn't in a project. */
  projectName: string | null;
  /** Ranges to highlight in `projectName` — how a row shows *why* a project-name match matched. */
  projectMatches: [number, number][];
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

export interface GroupSearchResult {
  group: TaskGroup;
  score: number;
  titleMatches: [number, number][];
  /** Up to three member titles, for the row to preview who's in the stack. */
  memberTitles: string[];
  /** The stack's full roster size — may exceed memberTitles.length. */
  memberCount: number;
}

/**
 * Matches stacks by title only — a stack has no notes/tags/project of its own
 * to search, and `rosterByGroupId` supplies the member preview rather than
 * anything to match against. Callers already have a roster per group (see
 * `groupRosterOf`), so it's passed in rather than recomputed here.
 */
export function searchGroups(
  groups: TaskGroup[],
  query: string,
  rosterByGroupId: Map<string, Task[]>
): GroupSearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const words = q.split(/\s+/).filter(Boolean);
  const results: GroupSearchResult[] = [];

  for (const group of groups) {
    let totalScore = 0;
    let titleMatches: [number, number][] = [];

    for (const word of words) {
      const titleResult = scoreSubstring(group.title, word);
      totalScore += titleResult.score * 2;
      if (titleResult.ranges.length > 0) {
        titleMatches = titleMatches.concat(titleResult.ranges);
      }
    }

    if (totalScore > 0) {
      const roster = rosterByGroupId.get(group.id) ?? [];
      results.push({
        group,
        score: totalScore,
        titleMatches: mergeRanges(titleMatches),
        memberTitles: roster.slice(0, 3).map(displayTitleFor),
        memberCount: roster.length,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
