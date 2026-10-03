import { cellAt, isMoveDrop, type CellRect } from '../utils/calendarDrag';

describe('cellAt', () => {
  const rects = new Map<string, CellRect>([
    ['2026-10-05', { x: 16, y: 200, width: 51, height: 39 }],
    ['2026-10-06', { x: 67, y: 200, width: 51, height: 39 }],
  ]);

  it('finds the cell under the finger', () => {
    expect(cellAt(rects, 20, 210)).toBe('2026-10-05');
    expect(cellAt(rects, 67, 200)).toBe('2026-10-06');
  });

  it('is null off the grid, and on a far edge, which belongs to the next cell', () => {
    expect(cellAt(rects, 10, 210)).toBeNull();
    expect(cellAt(rects, 30, 239)).toBeNull();
    expect(cellAt(rects, 118, 210)).toBeNull();
  });
});

describe('isMoveDrop', () => {
  it('moves only onto a different day', () => {
    expect(isMoveDrop('2026-10-05', '2026-10-06')).toBe(true);
    expect(isMoveDrop('2026-10-05', '2026-10-05')).toBe(false);
    expect(isMoveDrop('2026-10-05', null)).toBe(false);
  });
});
