/**
 * Finding a field in the task editor by name.
 *
 * The editor holds 26 rows across seven groups, all of them always on screen,
 * so this answers "I know the field exists, where is it" — a tidier layout
 * can't help with that on its own.
 *
 * The half a tidier layout can never give you is the *wrong word*. "Waiting
 * on" is what you'd look for as blocked, depends on, after; "Vacation pause"
 * as away or holiday; "Time of day" as snooze or hide until. So the keywords
 * are the payload here, exactly as they are in `settingsIndex.ts` — and unlike
 * Settings, the index isn't a separate file to keep in step: an
 * `EditorGroupRow` already carries its key, label and whether it's set,
 * computed against the task being edited, so the JSX *is* the index.
 *
 * Pure and separate from the components because this is the whole behaviour,
 * and there are no component tests in this repo to catch it otherwise.
 */

export interface EditorSearchable {
  key: string;
  /** The row's label as rendered. */
  label: string;
  /** Words that should find the row but don't appear in its label. */
  keywords?: string[];
}

/**
 * Substring matching only — the same call `settingsSearch.ts` makes, for the
 * same reason and more so. Both index a few dozen labels the app itself wrote,
 * where subsequence matching mostly returns rows that happen to contain the
 * right letters in the right order. Here the results stay *in the form* rather
 * than in a result list, so a spurious match doesn't just add a row to ignore
 * — it leaves a field on screen that has nothing to do with what was typed.
 */
function containsTerm(haystack: string, term: string): boolean {
  return haystack.toLowerCase().includes(term);
}

/** Splits a raw query into terms. Empty means "not searching". */
export function editorSearchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Every term has to match something, but they may match different things — so
 * "vacation skip" finds the vacation row via its label and its keywords, and a
 * term matching neither drops the row.
 */
export function matchesEditorQuery(item: EditorSearchable, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystacks = [item.label, ...(item.keywords ?? [])];
  return terms.every(term => haystacks.some(h => containsTerm(h, term)));
}

/**
 * The matching rows, **in the order they were given**.
 *
 * Deliberately unranked, where `searchSettings` scores and sorts. That's the
 * one place the two diverge and it follows from where the results are shown:
 * Settings renders a result list, which has no order of its own to respect, so
 * the best match belongs at the top. These rows are rendered as the form
 * itself, where the order is meaningful (date, then deadline, then repeat). A
 * form that re-sorts as you type is a form you can't learn.
 */
export function filterEditorRows<T extends EditorSearchable>(rows: T[], terms: string[]): T[] {
  if (terms.length === 0) return rows;
  return rows.filter(row => matchesEditorQuery(row, terms));
}
