/**
 * How a dashboard's sections are dealt into two columns (`WideScroll`).
 *
 * Units go left, right, left, right rather than into whichever column is
 * shorter: which is shorter isn't known until both have been laid out, and
 * waiting for that draws the page once in the wrong shape. The columns end at
 * different heights as a result, which reads as two stacks, where a grid of rows
 * would leave a gap under every card shorter than its neighbor.
 *
 * A unit that spans the width splits the sequence: what comes before it and what
 * comes after are dealt as separate runs, so reading order still runs top to
 * bottom through it.
 */
export type DealtRow<T> =
  | { kind: 'span'; item: T }
  | { kind: 'columns'; left: T[]; right: T[] };

export function dealColumns<T>(items: readonly T[], spansWidth: (item: T) => boolean): DealtRow<T>[] {
  const rows: DealtRow<T>[] = [];
  let run: T[] = [];
  const flush = () => {
    if (run.length === 0) return;
    rows.push({
      kind: 'columns',
      left: run.filter((_, i) => i % 2 === 0),
      right: run.filter((_, i) => i % 2 === 1),
    });
    run = [];
  };
  for (const item of items) {
    if (spansWidth(item)) {
      flush();
      rows.push({ kind: 'span', item });
    } else {
      run.push(item);
    }
  }
  flush();
  return rows;
}
