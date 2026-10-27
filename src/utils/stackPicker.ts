/**
 * Which stacks the task editor's Stack picker lists (see
 * `src/components/StackPicker.tsx`).
 *
 * Order is never re-ranked: stacks are in the user's own order, and a list
 * that re-sorts itself while typing is one you can't learn the shape of. The
 * filter narrows the set and never moves what's left.
 */

export interface StackOption {
  id: string;
  title: string;
  category: string | null;
}

/** Rows shown before "Show all". A search ignores it and lists every match. */
export const STACK_PICKER_COLLAPSED_ROWS = 5;

const normalize = (s: string) => s.trim().toLowerCase();

/** Stacks whose name or category contains the query, in the order given. */
export function filterStacks(options: StackOption[], query: string): StackOption[] {
  const q = normalize(query);
  if (!q) return options;
  return options.filter(
    o => normalize(o.title).includes(q) || (o.category !== null && normalize(o.category).includes(q)),
  );
}

export interface StackRows {
  /** The stack that is already chosen, pinned above the rest, or null. */
  pinned: StackOption | null;
  /** The rest, capped unless `expanded` or searching. */
  rows: StackOption[];
  /** How many more "Show all" would reveal; 0 when nothing is hidden. */
  hidden: number;
}

/**
 * The chosen stack is pulled out and pinned so it is never buried below the
 * cap. Searching lists every match: a cap behind a filter hides the answer.
 */
export function stackRows(
  options: StackOption[],
  selectedId: string | null,
  query: string,
  expanded: boolean,
): StackRows {
  const matches = filterStacks(options, query);
  const searching = normalize(query) !== '';
  const pinned = searching ? null : matches.find(o => o.id === selectedId) ?? null;
  const rest = pinned ? matches.filter(o => o.id !== pinned.id) : matches;
  if (searching || expanded || rest.length <= STACK_PICKER_COLLAPSED_ROWS) {
    return { pinned, rows: rest, hidden: 0 };
  }
  return {
    pinned,
    rows: rest.slice(0, STACK_PICKER_COLLAPSED_ROWS),
    hidden: rest.length - STACK_PICKER_COLLAPSED_ROWS,
  };
}
