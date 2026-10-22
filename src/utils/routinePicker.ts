/**
 * Filtering and keyboard rules for the routine picker (see
 * `src/components/RoutinePicker.tsx`).
 *
 * Pure and separate from the component because it is the whole behaviour, and
 * there are no component tests in this repo to catch it otherwise.
 */

export interface RoutineOption {
  id: string;
  name: string;
}

export interface RoutineFilterResult<T extends RoutineOption> {
  /** Routines to list, in the order they were given. */
  matches: T[];
  /** A non-empty query that named no routine. */
  noMatches: boolean;
}

const normalize = (s: string) => s.trim().toLowerCase();

/**
 * Order is never re-ranked: routines are in the order the person keeps them on
 * the Workouts screen, and a list that re-sorts as you type is one you can't
 * learn the shape of. The filter narrows the set; it never moves what's left.
 */
export function filterRoutines<T extends RoutineOption>(options: readonly T[], query: string): RoutineFilterResult<T> {
  const q = normalize(query);
  if (!q) return { matches: [...options], noMatches: false };
  const matches = options.filter(o => normalize(o.name).includes(q));
  return { matches, noMatches: matches.length === 0 };
}

/**
 * What the keyboard's done key picks: the one routine left standing, or an exact
 * name. With several still matching it does nothing, since a filter is typed a
 * letter at a time and "pu" on the way to "Pull day" is a state the field is in
 * constantly.
 */
export function resolveRoutineSubmit<T extends RoutineOption>(result: RoutineFilterResult<T>, query: string): T | null {
  const q = normalize(query);
  if (!q) return null;
  const exact = result.matches.find(o => normalize(o.name) === q);
  if (exact) return exact;
  return result.matches.length === 1 ? result.matches[0] : null;
}
