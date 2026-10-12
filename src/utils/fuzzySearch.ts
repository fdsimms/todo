import type { Project, Task, TaskGroup } from '../types';
import { displayTitleFor, isTaskNotNeeded } from './visibilityUtils';
import { formatTaskDeliverable } from './deliverables';
import { matchExcerpt, mergeRanges, scoreSubstring, type MatchExcerpt } from './ranges';

// Re-exported so the existing call sites (and their tests) keep importing them
// from here; both moved to `ranges.ts` so a search that isn't over tasks can
// use them without pulling this module's store imports along.
export { mergeRanges, scoreSubstring };

/**
 * How much a hit in notes counts against the same hit in a title. Notes are
 * long free text, so a query lands in them far more often than in a title, and
 * the bonus is added on top of the title score: at half weight a notes hit plus
 * a tag could pull a mid-word title match level with a title that starts with
 * the query. A quarter keeps notes a tiebreaker that can't outrank a better
 * title.
 */
const NOTES_WEIGHT = 0.25;

export interface SearchResult {
  task: Task;
  score: number;
  titleMatches: [number, number][]; // [start, end] ranges to highlight
  /** The task's project title, resolved here so a row can name it without a second lookup. Null when the task isn't in a project. */
  projectName: string | null;
  /** Ranges to highlight in `projectName` — how a row shows *why* a project-name match matched. */
  projectMatches: [number, number][];
  /**
   * Where the notes matched, as a one-line excerpt, when that is the reason the
   * task is in the list. Null whenever the title or the project name already
   * carries a highlight (the row explains itself), and when the notes matched
   * only by scattered letters, which isn't worth pointing at.
   */
  notesExcerpt: MatchExcerpt | null;
}

export function fuzzySearch(
  tasks: Task[],
  query: string,
  projectNamesById: Map<string, string> = new Map(),
  /**
   * Tasks to rank as though they were still active, however this sort would
   * otherwise treat them: the ones ticked off *from these very results*, which
   * both search surfaces hold in place until the query moves on. The hold has
   * to be applied here rather than by either caller, because this sort is
   * upstream of both of them — a task re-ranked to the bottom here has already
   * left the Active section (and, in the quick-search card, fallen past the
   * five-row cap) before a caller gets to see it. Same idea as Today's
   * completionHoldIds: a row you just ticked shouldn't move.
   */
  heldIds: ReadonlySet<string> = new Set()
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
    // A recorded answer, as it reads on the row ("matte white", "Oct 12"), so
    // the doctor's answer or the tile that was picked can be found by what it
    // said rather than only by the question that asked for it.
    const answer = task.deliverableValue !== null ? formatTaskDeliverable(task) ?? '' : '';

    for (const word of words) {
      const titleResult = scoreSubstring(displayTitle, word);
      const notesResult = scoreSubstring(task.notes, word);
      const tagScore = task.tags.some(t => t.toLowerCase().includes(word.toLowerCase())) ? 30 : 0;
      const categoryResult = task.category ? scoreSubstring(task.category, word) : { score: 0, ranges: [] };
      const projectResult = projectName ? scoreSubstring(projectName, word) : { score: 0, ranges: [] };
      const answerScore = answer ? scoreSubstring(answer, word).score : 0;
      // Weaker, unhighlighted fallback for a keyword that only matches a
      // non-active step's text — the active step is already covered above.
      const chainScore = task.chainItems.reduce(
        (best, item) => Math.max(best, scoreSubstring(item.title, word).score),
        0
      );

      // Title matches score highest, notes lowest of the text fields, category/project/chain steps in between, tags moderate
      totalScore +=
        titleResult.score * 2 +
        notesResult.score * NOTES_WEIGHT +
        categoryResult.score * 0.5 +
        projectResult.score * 0.5 +
        chainScore * 0.5 +
        answerScore * 0.5 +
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
        notesExcerpt:
          titleMatches.length === 0 && projectMatches.length === 0 && task.notes
            ? matchExcerpt(task.notes, words)
            : null,
      });
    }
  }

  const ranksActive = (r: SearchResult) => ranksAsActive(r.task, heldIds);
  return results.sort((a, b) => {
    // Completed tasks rank below active ones at equal scores
    if (ranksActive(a) !== ranksActive(b)) return ranksActive(a) ? -1 : 1;
    return b.score - a.score;
  });
}

/**
 * Whether a search result belongs with the live work, or below it with what
 * is done. A task on a branch that wasn't taken (`isTaskNotNeeded`) goes below
 * too: it will never be done, and ranked among live tasks it reads as one more
 * thing to do. A row held in place after being ticked here stays put.
 */
export function ranksAsActive(task: Task, heldIds: ReadonlySet<string>): boolean {
  if (heldIds.has(task.id)) return true;
  return !task.completed && !isTaskNotNeeded(task);
}

export interface ProjectSearchResult {
  project: Project;
  score: number;
  titleMatches: [number, number][];
  /** done/total, so the row reads the same as the one on the Projects page. */
  progress: { done: number; total: number };
}

/**
 * Matches projects by title and notes.
 *
 * There was no project search at all until this: a task's project *name* was
 * scored as one of that task's own fields (see `fuzzySearch` above), so typing
 * "kitchen" surfaced the tasks in Kitchen refresh and never the project, and
 * the Projects page has no search of its own. Past a couple of dozen projects,
 * finding one was scrolling. Stacks have had `searchGroups` the whole time.
 *
 * Notes are matched at the same weight a task's are, which is also the one
 * reader `Project.notes` has ever had beyond the field that writes it. A
 * project's notes are where the context that isn't a task goes ("the installer
 * quoted separately"), and that is exactly the thing someone comes back
 * looking for.
 *
 * `progress` is passed in rather than computed here: this module is pure and
 * `projectProgress` lives in the store, and every caller already has it.
 */
export function searchProjects(
  projects: Project[],
  query: string,
  progressByProject: Map<string, { done: number; total: number }>
): ProjectSearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const words = q.split(/\s+/).filter(Boolean);
  const results: ProjectSearchResult[] = [];

  for (const project of projects) {
    let totalScore = 0;
    let titleMatches: [number, number][] = [];

    for (const word of words) {
      const titleResult = scoreSubstring(project.title, word);
      totalScore += titleResult.score * 2;
      if (titleResult.ranges.length > 0) {
        titleMatches = titleMatches.concat(titleResult.ranges);
      }
      totalScore += scoreSubstring(project.notes, word).score * NOTES_WEIGHT;
    }

    if (totalScore > 0) {
      results.push({
        project,
        score: totalScore,
        titleMatches: mergeRanges(titleMatches),
        progress: progressByProject.get(project.id) ?? { done: 0, total: 0 },
      });
    }
  }

  // Archived and completed projects rank below active ones at equal scores,
  // the same call `fuzzySearch` makes for completed tasks: they're still worth
  // finding, they're just not what you were most likely looking for.
  const ranksActive = (r: ProjectSearchResult) => !r.project.archived && !r.project.completed;
  return results.sort((a, b) => {
    if (ranksActive(a) !== ranksActive(b)) return ranksActive(a) ? -1 : 1;
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
