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
import { menuSearchTerms, searchMenu, type NavSearchResult } from './navHubs';

/**
 * How many matches the quick-search card shows before it defers to the
 * Search tab. The cap is what makes it "quick" — an uncapped card is just
 * the Search screen with worse chrome.
 */
export const QUICK_SEARCH_LIMIT = 5;

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
 * completed months ago could take all five slots from live work that scored
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

  // Collapsed before the cap, never after: five rows of one task's occurrences
  // is exactly what the cap would otherwise spend itself on, and a card that
  // shows five results would be showing one.
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

/**
 * How many screen matches ("Go to Weight") the quick-search card shows at
 * most. They spend the card's own `QUICK_SEARCH_LIMIT` rather than adding to
 * it, so the card never grows past five rows; two is enough because a screen
 * query is almost always a name the user already knows, and the rest of the
 * card still belongs to their tasks.
 */
export const QUICK_DESTINATION_LIMIT = 2;

/**
 * Screens the card never offers: the one it opens from (Tasks is Today) and
 * the one its own footer row already hands over to (Search). A result that
 * takes you where you are, or duplicates the row at the bottom, is a wasted
 * slot out of five.
 */
const SKIPPED_ROUTES: ReadonlySet<string> = new Set(['Today', 'Search']);

/**
 * The screens a quick-search query names, so a pull and a few letters reach
 * Weight or People without going through the menu and a hub.
 *
 * The index is the side menu's own (`menuDestinations`, passed in already
 * filtered by the kitchen switch and simplified mode) and so is the matching
 * (`searchMenu`), which is what keeps the two from disagreeing about which
 * screens exist or what finds them. Unlike the menu's find field this one
 * *ranks*, because it keeps two rows rather than showing every hit: in menu
 * order, "we" would spend a slot on Meal plan (keyword "week") ahead of
 * Weight. A label starting with the query beats a label containing it, which
 * beats a keyword-only match, and menu order breaks ties so the result is
 * stable as the query grows.
 */
export function quickDestinations(
  destinations: NavSearchResult[],
  query: string,
  limit: number = QUICK_DESTINATION_LIMIT
): NavSearchResult[] {
  const terms = menuSearchTerms(query);
  if (terms.length === 0 || limit <= 0) return [];
  const tier = (d: NavSearchResult): number => {
    const label = d.label.toLowerCase();
    if (label.startsWith(terms[0]) && terms.every(t => label.includes(t))) return 0;
    if (terms.every(t => label.includes(t))) return 1;
    return 2;
  };
  return searchMenu(destinations.filter(d => !SKIPPED_ROUTES.has(d.route)), terms)
    .map((d, i) => ({ d, i, t: tier(d) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .slice(0, limit)
    .map(x => x.d);
}
