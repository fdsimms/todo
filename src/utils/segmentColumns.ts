/**
 * Laying a segmented control's options out as a grid.
 *
 * `SegmentedControl`'s `columns` mode used to be one wrapping flex row whose
 * cells each took `100 / columns` percent. That never produced a grid: a
 * percentage basis resolves against the track's *content* width, so N cells
 * already fill the line exactly and the gaps between them push the last one
 * onto a line of its own — `columns={2}` over four options rendered as four
 * full-width rows stacked up, which is the ragged wrap the control exists to
 * avoid.
 *
 * So the rows are made here instead, and each is a plain flex row of `flex: 1`
 * cells — exact at any width, with no percentage arithmetic to get wrong. A
 * short last row is padded with `null`s, which render as empty cells: without
 * them the one option on the last row stretches to the full width and stops
 * matching the grid above it.
 */
export function segmentRows<T>(options: readonly T[], columns: number): (T | null)[][] {
  const perRow = Math.max(1, Math.floor(columns));
  const rows: (T | null)[][] = [];
  for (let i = 0; i < options.length; i += perRow) {
    const row: (T | null)[] = options.slice(i, i + perRow);
    while (row.length < perRow) row.push(null);
    rows.push(row);
  }
  return rows;
}
