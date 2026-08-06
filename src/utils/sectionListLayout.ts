export interface CellLayout {
  length: number;
  offset: number;
  index: number;
}

/**
 * Flat cell metrics for a `SectionList` whose cells are all one of two fixed
 * heights — everything `getItemLayout` needs, precomputed once per section set.
 *
 * `VirtualizedSectionList` flattens `sections` into `[header, ...items, footer]`
 * per section and indexes cells by that flat position. The footer cell exists
 * even with no `renderSectionFooter` (it renders nothing, so it measures zero),
 * which is the part that's easy to get wrong: a layout that skips it drifts by
 * one cell per section and is worse than no `getItemLayout` at all.
 *
 * Heights have to be *pinned in the styles*, not estimated here. RN prefers a
 * cell's measured frame over the one this returns (`ListMetricsAggregator
 * .getCellMetrics`), so a declared height that doesn't match what the row
 * actually lays out to reintroduces exactly the inconsistency it's meant to
 * remove.
 */
export function sectionListCellLayout(
  itemCounts: number[],
  headerHeight: number,
  rowHeight: number
): CellLayout[] {
  const cells: CellLayout[] = [];
  let offset = 0;

  const push = (length: number) => {
    cells.push({ length, offset, index: cells.length });
    offset += length;
  };

  itemCounts.forEach(count => {
    push(headerHeight);
    for (let i = 0; i < count; i++) push(rowHeight);
    push(0); // section footer
  });

  return cells;
}
