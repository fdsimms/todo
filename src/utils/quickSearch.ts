import type { Task } from '../types';
import { fuzzySearch, type SearchResult } from './fuzzySearch';
import { collapseOccurrences, type CollapsedOccurrence } from './searchCollapse';

/**
 * How many matches the quick-search card shows before it defers to the
 * Search tab. The cap is what makes it "quick" — an uncapped card is just
 * the Search screen with worse chrome.
 */
export const QUICK_SEARCH_LIMIT = 5;

export interface QuickSearchOutcome {
  /** The best matches, capped at `limit`. */
  results: CollapsedOccurrence<SearchResult>[];
  /** Everything the query matched once collapsed, including what didn't fit. */
  total: number;
  /** How many matches the card isn't showing, i.e. what the cap cut. */
  overflow: number;
}

/**
 * The Search screen's matching, narrowed to a card's worth of results.
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
  heldIds: ReadonlySet<string> = new Set()
): QuickSearchOutcome {
  // Collapsed before the cap, never after: five rows of one task's occurrences
  // is exactly what the cap would otherwise spend itself on, and a card that
  // shows five results would be showing one.
  const matches = collapseOccurrences(
    fuzzySearch(tasks, query, projectNamesById, heldIds),
    tasks,
    heldIds
  );

  const active = (r: SearchResult) => !r.task.completed || heldIds.has(r.task.id);
  const ordered = [
    ...matches.filter(active),
    ...matches.filter(r => !active(r)),
  ];

  const capped = limit >= 0 ? ordered.slice(0, limit) : ordered;

  return {
    results: capped,
    total: ordered.length,
    overflow: ordered.length - capped.length,
  };
}
