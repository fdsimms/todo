/**
 * Which rows of an editor group are on show, and whether the group folds away
 * entirely.
 *
 * The editors were already progressive disclosure — collapsed pickers, grouped
 * cards, rarely-changed rows last — but nothing ever actually *hid*, so all 23
 * of the task editor's rows rendered whatever the task was. That made a
 * brand-new empty task the longest form in the app: every unset row shows its
 * explanatory hint, so the task you know least about produced the most text.
 *
 * The rule here is that a task should look like itself. A row is on show when
 * it holds something or when it's one of the few most tasks want; everything
 * else waits behind one "N more". A group where nothing at all is set folds to
 * a single line naming what it covers.
 *
 * Pure and separate from the component because this is the whole behaviour and
 * there are no component tests in this repo to catch it otherwise.
 */

export interface FoldRow<T> {
  key: string;
  /** Does this row currently hold a value? A set row is never hidden. */
  set: boolean;
  /** One of the handful shown even when empty. */
  primary?: boolean;
  row: T;
}

export interface FoldResult<T> {
  /** Rows to render in the card, in their original order. */
  visible: FoldRow<T>[];
  /** Rows behind the "N more" disclosure. */
  hidden: FoldRow<T>[];
  /**
   * True when nothing in the group is set — the whole group collapses to one
   * line. A group holding anything opens, so a task shows its own shape
   * without anyone tapping.
   */
  folded: boolean;
}

/**
 * Splits a group's rows. Order is preserved on both sides: a set row stays
 * where the author put it rather than being hoisted to the top, because the
 * order of a schedule (date, then deadline, then repeat) is meaningful and
 * re-sorting by what happens to be filled in would shuffle the form under
 * someone between two edits.
 */
export function foldRows<T>(rows: FoldRow<T>[]): FoldResult<T> {
  const hideable = rows.filter(r => !r.primary && !r.set);

  // A "1 more" concealing a single row is a net loss. The control stands about
  // as tall as the row it hides, so it costs a row *and* a tap to save nothing
  // — and it makes you open it to find out it was one thing. Below two, show it.
  const hidden = hideable.length > 1 ? hideable : [];
  const hiddenRows = new Set(hidden);

  return {
    visible: rows.filter(r => !hiddenRows.has(r)),
    hidden,
    folded: !rows.some(r => r.set),
  };
}

/**
 * The "3 more" label. Counting rather than naming them keeps the control one
 * line however many are behind it; the names go in the hint underneath.
 */
export function moreLabel(count: number): string {
  return `${count} more`;
}

/**
 * The hint under "N more" — the hidden rows' own labels, so the disclosure
 * says what's behind it rather than making you open it to find out.
 *
 * Sentence-cased after the first, since these are field names being read as a
 * list rather than as labels.
 */
export function moreHint(labels: string[]): string {
  if (labels.length === 0) return '';
  const [first, ...rest] = labels;
  return [first, ...rest.map(l => l.toLowerCase())].join(', ');
}

/**
 * The one-line summary of a folded group. Same list, same treatment — it's the
 * same job, naming what you'd find inside.
 */
export function foldedSummary(labels: string[]): string {
  return moreHint(labels);
}
