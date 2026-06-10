import {
  moveItem,
  dropIndexFromTranslation,
  cumulativeOffsets,
  rowDragOffset,
  dropSlotY,
  dragRange,
} from '../utils/reorder';

describe('moveItem', () => {
  it('moves an item down', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item up', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns an equal array when from === to', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('clamps an out-of-range destination', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b']);
  });

  it('ignores an invalid source index', () => {
    expect(moveItem(['a', 'b'], 7, 0)).toEqual(['a', 'b']);
  });

  it('does not mutate the input', () => {
    const input = ['a', 'b', 'c'];
    moveItem(input, 0, 2);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});

describe('dropIndexFromTranslation', () => {
  // Mixed heights modeling the real list: short headers (~36) between
  // taller task rows (~52).
  const heights = [36, 52, 52, 36, 52];

  it('stays put for small movements', () => {
    expect(dropIndexFromTranslation(heights, 2, 0)).toBe(2);
    expect(dropIndexFromTranslation(heights, 2, 10)).toBe(2);
    expect(dropIndexFromTranslation(heights, 2, -10)).toBe(2);
  });

  it('crosses a row below once past its midpoint', () => {
    // Row 3 is 36 tall; crossing requires >= 36 - 18 = 18.
    expect(dropIndexFromTranslation(heights, 2, 17)).toBe(2);
    expect(dropIndexFromTranslation(heights, 2, 18)).toBe(3);
  });

  it('crosses a row above once past its midpoint', () => {
    // Row 1 is 52 tall; crossing requires <= -(52/2) = -26.
    expect(dropIndexFromTranslation(heights, 2, -25)).toBe(2);
    expect(dropIndexFromTranslation(heights, 2, -26)).toBe(1);
  });

  it('crosses multiple rows of different heights', () => {
    // From index 4 moving up over rows 3 (36) and 2 (52):
    // row 3 midpoint at -(36/2)=-18 ... row 2 at -(36 + 52/2)=-62.
    expect(dropIndexFromTranslation(heights, 4, -20)).toBe(3);
    expect(dropIndexFromTranslation(heights, 4, -62)).toBe(2);
    // All the way to the top: row 1 at -(36+52+52/2)=-114, row 0 at -(36+52+52+36/2)=-158.
    expect(dropIndexFromTranslation(heights, 4, -114)).toBe(1);
    expect(dropIndexFromTranslation(heights, 4, -158)).toBe(0);
  });

  it('clamps at the list edges', () => {
    expect(dropIndexFromTranslation(heights, 0, -500)).toBe(0);
    expect(dropIndexFromTranslation(heights, 4, 500)).toBe(4);
    expect(dropIndexFromTranslation(heights, 2, 5000)).toBe(4);
    expect(dropIndexFromTranslation(heights, 2, -5000)).toBe(0);
  });

  it('handles uniform heights like a simple division', () => {
    const uniform = [50, 50, 50, 50, 50, 50];
    expect(dropIndexFromTranslation(uniform, 0, 124)).toBe(2);
    expect(dropIndexFromTranslation(uniform, 0, 126)).toBe(3);
    expect(dropIndexFromTranslation(uniform, 5, -126)).toBe(2);
  });
});

describe('cumulativeOffsets', () => {
  it('returns the running top offset of each row', () => {
    expect(cumulativeOffsets([36, 52, 52])).toEqual([0, 36, 88]);
  });

  it('returns empty for an empty list', () => {
    expect(cumulativeOffsets([])).toEqual([]);
  });
});

describe('rowDragOffset', () => {
  const Ha = 52;

  it('does not move the dragged row itself', () => {
    expect(rowDragOffset(2, 2, 4, Ha)).toBe(0);
  });

  it('shifts rows between origin and target up when dragging down', () => {
    // Active 1, hovering 3: rows 2 and 3 slide up by Ha, others stay.
    expect(rowDragOffset(0, 1, 3, Ha)).toBe(0);
    expect(rowDragOffset(2, 1, 3, Ha)).toBe(-Ha);
    expect(rowDragOffset(3, 1, 3, Ha)).toBe(-Ha);
    expect(rowDragOffset(4, 1, 3, Ha)).toBe(0);
  });

  it('shifts rows between target and origin down when dragging up', () => {
    // Active 4, hovering 1: rows 1,2,3 slide down by Ha.
    expect(rowDragOffset(0, 4, 1, Ha)).toBe(0);
    expect(rowDragOffset(1, 4, 1, Ha)).toBe(Ha);
    expect(rowDragOffset(3, 4, 1, Ha)).toBe(Ha);
    expect(rowDragOffset(4, 4, 1, Ha)).toBe(0);
  });

  it('moves nothing when hovering its own slot', () => {
    expect(rowDragOffset(0, 2, 2, Ha)).toBe(0);
    expect(rowDragOffset(3, 2, 2, Ha)).toBe(0);
  });
});

describe('dragRange', () => {
  // Layout: H, a, b, c, H, d, H, e
  const layout = ['H', 'a', 'b', 'c', 'H', 'd', 'H', 'e'];
  const isHeader = (item: string) => item === 'H';

  it('confines a row to the task rows within its section', () => {
    expect(dragRange(layout, 1, isHeader)).toEqual([1, 3]); // 'a' -> within [a,b,c]
    expect(dragRange(layout, 2, isHeader)).toEqual([1, 3]); // 'b' -> within [a,b,c]
    expect(dragRange(layout, 3, isHeader)).toEqual([1, 3]); // 'c' -> within [a,b,c]
  });

  it('confines a lone row in a section to itself', () => {
    expect(dragRange(layout, 5, isHeader)).toEqual([5, 5]); // 'd' is alone between headers
    expect(dragRange(layout, 7, isHeader)).toEqual([7, 7]); // 'e' is alone at the end
  });

  it('handles a row with no header before or after', () => {
    expect(dragRange(['a', 'b', 'c'], 1, isHeader)).toEqual([0, 2]);
  });
});

describe('dropSlotY', () => {
  const heights = [36, 52, 52, 36, 52];

  it('is the row top when hovering its own slot', () => {
    // offsets: [0, 36, 88, 140, 176]
    expect(dropSlotY(heights, 2, 2)).toBe(88);
  });

  it('tracks the gap below when dragging down', () => {
    // Active 1 (h=52), hover 3: offsets[3] + heights[3] - 52 = 140 + 36 - 52.
    expect(dropSlotY(heights, 1, 3)).toBe(124);
  });

  it('tracks the gap above when dragging up', () => {
    // Active 4, hover 1: offsets[1] = 36.
    expect(dropSlotY(heights, 4, 1)).toBe(36);
  });
});
