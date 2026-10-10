/**
 * Which task editor rows sit behind "More options".
 *
 * A row tagged `fold` is one most tasks never touch (logging a completion to
 * Health, a phone number, an avoid-task goal). It is hidden from a plain task
 * and shown the moment any of these holds:
 *
 * 1. the task already holds a value for it (`set`), the same rule 2 simplified
 *    mode follows: what you said is never put out of sight;
 * 2. the user opened More options;
 * 3. a search is running (a match is shown wherever it lives, folded or not);
 * 4. it was on screen earlier in this editing session. A row that appeared
 *    because it held a value must not vanish under the finger that just
 *    cleared it.
 *
 * Display only: nothing is cleared, defaulted or stored differently, so a task
 * saved with the fold in either state is the same task.
 */

export interface FoldableRow {
  key: string;
  fold?: boolean;
  set?: boolean;
}

export interface FoldState {
  moreOpen: boolean;
  searching: boolean;
  /** Keys of folded rows that have already been on screen this session. */
  revealed: ReadonlySet<string>;
}

/** Is this row hidden right now? */
export function isRowFolded(row: FoldableRow, state: FoldState): boolean {
  if (!row.fold) return false;
  if (row.set || state.moreOpen || state.searching) return false;
  return !state.revealed.has(row.key);
}

/** How many rows More options would reveal: folded rows with nothing in them. */
export function foldedRowCount(rows: readonly FoldableRow[]): number {
  return rows.filter(r => r.fold && !r.set).length;
}

/** The copy on the toggle. */
export function moreOptionsLabel(count: number, open: boolean): string {
  if (open) return 'Fewer options';
  return count === 1 ? 'More options (1 hidden)' : `More options (${count} hidden)`;
}
