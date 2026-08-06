import { sectionListCellLayout } from '../utils/sectionListLayout';

const HEADER = 44;
const ROW = 56;

describe('sectionListCellLayout', () => {
  it('returns nothing for no sections', () => {
    expect(sectionListCellLayout([], HEADER, ROW)).toEqual([]);
  });

  it('lays out one section as header, rows, then a zero-height footer', () => {
    const cells = sectionListCellLayout([2], HEADER, ROW);

    expect(cells).toEqual([
      { length: HEADER, offset: 0, index: 0 },
      { length: ROW, offset: 44, index: 1 },
      { length: ROW, offset: 100, index: 2 },
      { length: 0, offset: 156, index: 3 },
    ]);
  });

  it('counts the footer cell when offsetting the next section', () => {
    const cells = sectionListCellLayout([1, 1], HEADER, ROW);

    // Section 2's header is cell 3, not cell 2 — the empty footer still
    // occupies a flat index even though it takes up no space.
    expect(cells[3]).toEqual({ length: HEADER, offset: 100, index: 3 });
    expect(cells[4]).toEqual({ length: ROW, offset: 144, index: 4 });
  });

  it('emits two extra cells per section', () => {
    expect(sectionListCellLayout([3, 5, 1], HEADER, ROW)).toHaveLength(3 + 5 + 1 + 3 * 2);
  });

  it('handles an empty section', () => {
    const cells = sectionListCellLayout([0, 1], HEADER, ROW);

    expect(cells.map(c => c.length)).toEqual([HEADER, 0, HEADER, ROW, 0]);
    expect(cells.map(c => c.offset)).toEqual([0, 44, 44, 88, 144]);
  });

  it('keeps offsets contiguous and indices sequential', () => {
    const cells = sectionListCellLayout([4, 2, 7], HEADER, ROW);

    cells.forEach((cell, i) => {
      expect(cell.index).toBe(i);
      const previous = cells[i - 1];
      expect(cell.offset).toBe(previous ? previous.offset + previous.length : 0);
    });
  });

  it('totals the same height the list will actually render', () => {
    const cells = sectionListCellLayout([2, 3], HEADER, ROW);
    const last = cells[cells.length - 1];

    expect(last.offset + last.length).toBe(2 * HEADER + 5 * ROW);
  });
});
