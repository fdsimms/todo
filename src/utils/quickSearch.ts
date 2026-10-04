import type { Project, Task, TaskGroup } from '../types';
import {
  fuzzySearch,
  searchGroups,
  searchProjects,
  type SearchResult,
  type GroupSearchResult,
  type ProjectSearchResult,
} from './fuzzySearch';
import { collapseOccurrences, type CollapsedOccurrence } from './searchCollapse';

/**
 * How many matches the quick-search card shows before it defers to the
 * Search tab. The cap is what makes it "quick" — an uncapped card is just
 * the Search screen with worse chrome.
 */
export const QUICK_SEARCH_LIMIT = 7;

export interface QuickSearchOutcome {
  /** Stack matches, capped to whatever's left of `limit`. */
  groupResults: GroupSearchResult[];
  /** Project matches, capped to whatever's left of `limit` after stacks. */
  projectResults: ProjectSearchResult[];
  /** Task matches, capped to whatever's left of `limit` after stacks and projects. */
  results: CollapsedOccurrence<SearchResult>[];
  /** Everything the query matched across all three, once collapsed, including what didn't fit. */
  total: number;
  /** How many matches the card isn't showing, i.e. what the cap cut. */
  overflow: number;
}

/**
 * The Search screen's matching, narrowed to a card's worth of results.
 *
 * Stacks and projects lead, same order the Search screen puts them in ("where's
 * my packing list" is a navigational lookup, not a task search) — the budget is
 * spent on them first and tasks take whatever's left. A query that hits only
 * tasks behaves exactly as it always did.
 *
 * Completed tasks stay in (finding something you already ticked is half of
 * why you search) but sort behind the active ones: the card has no
 * Active/Completed sections to separate them, so without this a task
 * completed months ago could take every slot from live work that scored
 * slightly lower. Within each half the score order `fuzzySearch` returned is
 * preserved.
 *
 * Occurrences of one repeating thing arrive as one row (see
 * `collapseOccurrences`) carrying the count of what it stands for, so a daily
 * task can't take every slot in the card with copies of itself.
 *
 * `heldIds` are the tasks ticked from the card *while it was open* (see
 * fuzzySearch, which is where the hold is actually applied). It matters more
 * here than on the Search screen: past the cap, a row that re-ranks to the back
 * doesn't just move, it leaves the card and lets an unrelated match take its
 * slot. Ticking a task and watching a different task appear where it was reads
 * as a misfire, not as a completion.
 */
export function quickSearch(
  tasks: Task[],
  query: string,
  projectNamesById: Map<string, string> = new Map(),
  limit: number = QUICK_SEARCH_LIMIT,
  heldIds: ReadonlySet<string> = new Set(),
  groups: TaskGroup[] = [],
  rosterByGroupId: Map<string, Task[]> = new Map(),
  projects: Project[] = [],
  progressByProject: Map<string, { done: number; total: number }> = new Map()
): QuickSearchOutcome {
  const groupMatches = searchGroups(groups, query, rosterByGroupId);
  const projectMatches = searchProjects(projects, query, progressByProject);

  // Collapsed before the cap, never after: a card of one task's occurrences
  // is exactly what the cap would otherwise spend itself on, and a full card
  // of them would be showing one task.
  const taskMatches = collapseOccurrences(
    fuzzySearch(tasks, query, projectNamesById, heldIds),
    tasks,
    heldIds
  );

  const active = (r: SearchResult) => !r.task.completed || heldIds.has(r.task.id);
  const orderedTasks = [
    ...taskMatches.filter(active),
    ...taskMatches.filter(r => !active(r)),
  ];

  const total = groupMatches.length + projectMatches.length + orderedTasks.length;

  const budget = limit >= 0 ? limit : total;
  const groupResults = groupMatches.slice(0, budget);
  const projectResults = projectMatches.slice(0, Math.max(0, budget - groupResults.length));
  const results = orderedTasks.slice(
    0,
    Math.max(0, budget - groupResults.length - projectResults.length)
  );

  const shown = groupResults.length + projectResults.length + results.length;

  return {
    groupResults,
    projectResults,
    results,
    total,
    overflow: total - shown,
  };
}
