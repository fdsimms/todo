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
  const matches = fuzzySearch(tasks, query, projectNamesById, heldIds);

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
