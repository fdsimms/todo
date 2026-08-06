import {
  moveItem,
  dropIndexFromTranslation,
  cumulativeOffsets,
  rowDragOffset,
  dragRange,
  rowIndexAtContentY,
  contentOriginOffset,
  dragTranslation,
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

describe('rowIndexAtContentY', () => {
  // A short header, two task rows, then a tall group row (header + children).
  const tops = [0, 36, 88, 140];
  const heights = [36, 52, 52, 220];

  it('finds the row containing the point', () => {
    expect(rowIndexAtContentY(tops, heights, 10)).toBe(0);
    expect(rowIndexAtContentY(tops, heights, 100)).toBe(2);
  });

  it('treats a row top as inside that row and its bottom as outside', () => {
    expect(rowIndexAtContentY(tops, heights, 36)).toBe(1);
    expect(rowIndexAtContentY(tops, heights, 88)).toBe(2);
  });

  it('hits a tall row anywhere down its height, not just its top edge', () => {
    expect(rowIndexAtContentY(tops, heights, 145)).toBe(3);
    expect(rowIndexAtContentY(tops, heights, 250)).toBe(3);
    expect(rowIndexAtContentY(tops, heights, 359)).toBe(3);
  });

  it('is null past either end of the list', () => {
    expect(rowIndexAtContentY(tops, heights, -20)).toBeNull();
    expect(rowIndexAtContentY(tops, heights, 360)).toBeNull();
  });
});

describe('contentOriginOffset', () => {
  it('is zero when the content starts flush with the container', () => {
    expect(contentOriginOffset(200, 200)).toBe(0);
  });

  it('stays zero however far the list is scrolled', () => {
    // measureLayout answers in layout coordinates, so a row at content-Y 900
    // measures at 900 whether the list is at the top or scrolled right to it.
    // Reading that against the row's on-screen position (900 - 380) and calling
    // the difference an inset is what pushed the floating drag card a whole
    // scroll offset below the finger — worse the further down the list it went.
    expect(contentOriginOffset(900, 900)).toBe(0);
  });

  it('recovers a top content inset from a measured row', () => {
    // Row laid out at content-Y 200 measures at 320 against the container, so
    // the content starts 120 below the container's top edge.
    expect(contentOriginOffset(320, 200)).toBe(120);
  });

  it('round-trips a content-Y back to where the row is on screen', () => {
    const origin = contentOriginOffset(320, 200);
    // Scrolled 80: the row measures at 320 in layout space and sits at 240 on
    // screen, one scroll offset higher.
    expect(200 - 80 + origin).toBe(240);
  });

  it('handles content drawn above the container origin', () => {
    expect(contentOriginOffset(170, 200)).toBe(-30);
  });
});

describe('dragTranslation', () => {
  // A row resting at content-Y 400 in a list scrolled to 0, no inset: the card
  // is pinned to 400 on screen at the moment the finger takes hold of it.
  it('is zero for a card still sitting in its own slot', () => {
    expect(dragTranslation(400, 400, 0, 0)).toBe(0);
  });

  it('follows the card up and down', () => {
    expect(dragTranslation(460, 400, 0, 0)).toBe(60);
    expect(dragTranslation(330, 400, 0, 0)).toBe(-70);
  });

  it('matches finger delta + scroll delta while the layout holds still', () => {
    // What the old finger-only math computed: dragged 60 down, list autoscrolled
    // 25 further under it. The card's anchor doesn't move with the scroll, so
    // the slot slides up 25 and the translation grows by the same amount.
    const anchor = 400; // 400 - 0 (scroll at start) - 0 (origin)
    const fingerDelta = 60;
    const scrollDelta = 25;
    expect(dragTranslation(anchor + fingerDelta, 400, scrollDelta, 0)).toBe(fingerDelta + scrollDelta);
  });

  it('accounts for a top content inset', () => {
    // The row's content-Y 400 sits at 520 on screen behind a 120 inset, so a
    // card at 520 is resting, not dragged.
    expect(dragTranslation(520, 400, 0, 120)).toBe(0);
  });

  it('re-derives the slot when the list re-lays out under a live drag', () => {
    // The category-header case: the finger grabs a header resting at content-Y
    // 900 and hasn't moved, so the card is still at 900 on screen. The
    // auto-collapse then hides every section's tasks and the header's own slot
    // moves to 120. The card belongs to the finger, so the drop is now 780
    // below the slot — which is what puts the gap under the card instead of
    // leaving the card a screen away from the finger.
    expect(dragTranslation(900, 120, 0, 0)).toBe(780);
    // Once the finger drags back up to the collapsed run, the translation
    // shrinks toward zero exactly as it would in a list that never moved.
    expect(dragTranslation(160, 120, 0, 0)).toBe(40);
  });
});
