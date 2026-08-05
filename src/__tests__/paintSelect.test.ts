import {
  isInPaintGutter,
  rowIdAtY,
  rowIdsBetween,
  PAINT_GUTTER_WIDTH,
  ROW_HIT_SLOP,
  type PaintRowRect,
} from '../utils/paintSelect';

// Three 48pt cards with the app's 4px inter-card gutter between them.
const rects: PaintRowRect[] = [
  { id: 'a', top: 100, bottom: 148 },
  { id: 'b', top: 152, bottom: 200 },
  { id: 'c', top: 204, bottom: 252 },
];

describe('isInPaintGutter', () => {
  it('claims touches over the checkbox column', () => {
    expect(isInPaintGutter(0)).toBe(true);
    expect(isInPaintGutter(34)).toBe(true);
    expect(isInPaintGutter(58)).toBe(true);
    expect(isInPaintGutter(PAINT_GUTTER_WIDTH)).toBe(true);
  });

  it('leaves touches over the row content to the scroll view', () => {
    expect(isInPaintGutter(PAINT_GUTTER_WIDTH + 1)).toBe(false);
    expect(isInPaintGutter(200)).toBe(false);
  });

  it('ignores touches left of the container', () => {
    expect(isInPaintGutter(-5)).toBe(false);
  });
});

describe('rowIdAtY', () => {
  it('finds the row a point lands in', () => {
    expect(rowIdAtY(rects, 100)).toBe('a');
    expect(rowIdAtY(rects, 147)).toBe('a');
    expect(rowIdAtY(rects, 175)).toBe('b');
    expect(rowIdAtY(rects, 251)).toBe('c');
  });

  it('resolves the gap between cards to the nearer neighbour', () => {
    expect(rowIdAtY(rects, 149)).toBe('a');
    expect(rowIdAtY(rects, 151)).toBe('b');
  });

  it('gives up past the ends of the list', () => {
    expect(rowIdAtY(rects, 100 - ROW_HIT_SLOP)).toBe('a');
    expect(rowIdAtY(rects, 100 - ROW_HIT_SLOP - 1)).toBeNull();
    expect(rowIdAtY(rects, 252 + ROW_HIT_SLOP)).toBe('c');
    expect(rowIdAtY(rects, 252 + ROW_HIT_SLOP + 1)).toBeNull();
  });

  it('has nothing to find before any row has reported its position', () => {
    expect(rowIdAtY([], 175)).toBeNull();
  });
});

describe('rowIdsBetween', () => {
  it('paints just the row under the touch that starts the gesture', () => {
    expect(rowIdsBetween(rects, null, 'b')).toEqual(['b']);
  });

  it('fills in rows a fast drag jumped over', () => {
    expect(rowIdsBetween(rects, 'a', 'c')).toEqual(['b', 'c']);
  });

  it('fills in the same span dragging back up', () => {
    expect(rowIdsBetween(rects, 'c', 'a')).toEqual(['b', 'a']);
  });

  it('has nothing to do while the finger stays on one row', () => {
    expect(rowIdsBetween(rects, 'b', 'b')).toEqual([]);
  });

  it('paints only the destination when the origin row has gone', () => {
    expect(rowIdsBetween(rects, 'gone', 'c')).toEqual(['c']);
  });

  it('ignores a destination it cannot place', () => {
    expect(rowIdsBetween(rects, 'a', 'gone')).toEqual([]);
  });
});
