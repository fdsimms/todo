import type { SavedFocusSession, Task } from '../types';
import { suggestFocusTasks, type FocusContext } from './focusSuggest';
import { matchesFilter } from './savedFocus';

// Apart from savedFocus.ts so the rule's pure helpers (the card text, the
// editor's name check) don't pull in the suggester and, through it, the stores.

/**
 * The task ids a saved session would start with: the tasks its rule matches,
 * ranked and fitted to its window by the suggester. `ctx` carries the clock
 * and the rest rules (`buildFocusContext`), so the caller decides what "now"
 * is; the saved window replaces the one the context was built with.
 */
export function savedFocusQueue(
  saved: Pick<SavedFocusSession, 'filter' | 'windowMinutes'>,
  tasks: readonly Task[],
  ctx: FocusContext,
): string[] {
  const pool = tasks.filter(t => matchesFilter(t, saved.filter));
  return suggestFocusTasks(pool, { ...ctx, windowMinutes: saved.windowMinutes });
}
