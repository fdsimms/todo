import type { Task } from '../types';
import { fuzzySearch, type SearchResult } from './fuzzySearch';

/**
 * How many matches the quick-search card shows before it defers to the
 * Search tab. The cap is what makes it "quick" — an uncapped card is just
 * the Search screen with worse chrome.
 */
export const QUICK_SEARCH_LIMIT = 5;

export interface QuickSearchOutcome {
  /** The best matches, capped at `limit`. */
  results: SearchResult[];
  /** Everything `fuzzySearch` matched, including what didn't fit. */
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
 */
export function quickSearch(
  tasks: Task[],
  query: string,
  projectNamesById: Map<string, string> = new Map(),
  limit: number = QUICK_SEARCH_LIMIT
): QuickSearchOutcome {
  const matches = fuzzySearch(tasks, query, projectNamesById);

  const ordered = [
    ...matches.filter(r => !r.task.completed),
    ...matches.filter(r => r.task.completed),
  ];

  const capped = limit >= 0 ? ordered.slice(0, limit) : ordered;

  return {
    results: capped,
    total: ordered.length,
    overflow: ordered.length - capped.length,
  };
}
