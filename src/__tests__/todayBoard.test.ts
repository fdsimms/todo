import {
  BOARD_JOIN_EDGE,
  boardAimAt,
  boardReadingOrder,
  boardSections,
  dealBoardSections,
  moveListItem,
  type BoardColumnRect,
} from '../utils/todayBoard';

type Item = { type: 'header' | 'task' | 'group'; id: string };
const h = (id: string): Item => ({ type: 'header', id });
const t = (id: string): Item => ({ type: 'task', id });
const g = (id: string): Item => ({ type: 'group', id });

describe('boardSections', () => {
  it('cuts the list at each header, keeping the rows before the first as a section of their own', () => {
    const data = [t('loose'), h('Work'), t('a'), g('s'), h('Home'), t('b')];
    expect(boardSections(data)).toEqual([
      { start: 0, items: [t('loose')] },
      { start: 1, items: [h('Work'), t('a'), g('s')] },
      { start: 4, items: [h('Home'), t('b')] },
    ]);
  });

  it('starts with the first header when nothing comes before it', () => {
    expect(boardSections([h('Work'), t('a')])).toEqual([{ start: 0, items: [h('Work'), t('a')] }]);
  });

  it('is nothing for an empty list', () => {
    expect(boardSections([])).toEqual([]);
  });
});

describe('dealBoardSections', () => {
  it('puts each section in the column with the least so far, leftmost on a tie', () => {
    expect(dealBoardSections([5, 2, 2, 1], 2)).toEqual([[0], [1, 2, 3]]);
    expect(dealBoardSections([1, 1, 1], 3)).toEqual([[0], [1], [2]]);
  });

  it('keeps the list order within a column', () => {
    const dealt = dealBoardSections([2, 2, 2, 2, 2], 2);
    for (const column of dealt) expect([...column].sort((a, b) => a - b)).toEqual(column);
  });

  it('is one column holding everything when one is asked for', () => {
    expect(dealBoardSections([3, 1, 4], 1)).toEqual([[0, 1, 2]]);
  });

  it('counts an empty section as a row, so it still takes a place', () => {
    expect(dealBoardSections([0, 0], 2)).toEqual([[0], [1]]);
  });
});

describe('boardReadingOrder', () => {
  it('reads down the first column, then the next', () => {
    const data = [h('A'), t('a1'), h('B'), t('b1'), h('C'), t('c1')];
    const sections = boardSections(data);
    expect(boardReadingOrder(sections, [[0, 2], [1]]).map(i => i.id)).toEqual(['A', 'a1', 'C', 'c1', 'B', 'b1']);
  });
});

describe('boardAimAt', () => {
  // Two columns. Left: Work (flat 0..2). Right: Home (flat 3..4), then Errands (5..6).
  const columns: BoardColumnRect[] = [
    {
      left: 0,
      right: 300,
      rows: [
        { index: 0, header: true, top: 0, bottom: 30 },
        { index: 1, header: false, top: 34, bottom: 94 },
        { index: 2, header: false, top: 98, bottom: 258 },
      ],
    },
    {
      left: 316,
      right: 616,
      rows: [
        { index: 3, header: true, top: 0, bottom: 30 },
        { index: 4, header: false, top: 34, bottom: 94 },
        { index: 5, header: true, top: 110, bottom: 140 },
        { index: 6, header: false, top: 144, bottom: 204 },
      ],
    },
  ];
  const noJoin = () => false;

  it('places a row between two rows at the seam between them', () => {
    expect(boardAimAt(columns, 100, 50, noJoin)).toEqual({ kind: 'insert', index: 1, column: 0, lineY: 32 });
    expect(boardAimAt(columns, 100, 80, noJoin)).toEqual({ kind: 'insert', index: 2, column: 0, lineY: 96 });
  });

  it('files a drop above a header at the end of the section above it in the same column', () => {
    expect(boardAimAt(columns, 400, 115, noJoin)).toEqual({ kind: 'insert', index: 5, column: 1, lineY: 102 });
  });

  it('files a drop at the top of a column into that column’s first section, not the one before it', () => {
    expect(boardAimAt(columns, 400, 5, noJoin)).toEqual({ kind: 'insert', index: 4, column: 1, lineY: 32 });
  });

  it('puts a row below everything at the end of the column’s last section', () => {
    expect(boardAimAt(columns, 400, 600, noJoin)).toEqual({ kind: 'insert', index: 7, column: 1, lineY: 204 });
  });

  it('takes the nearest column when the pointer is in the gap or off the side', () => {
    expect(boardAimAt(columns, 305, 50, noJoin)).toMatchObject({ column: 0 });
    expect(boardAimAt(columns, 900, 50, noJoin)).toMatchObject({ column: 1 });
  });

  it('joins a stack over its middle, and places beside it near its edges', () => {
    const joinStack = (i: number) => i === 2;
    expect(boardAimAt(columns, 100, 180, joinStack)).toEqual({ kind: 'join', index: 2 });
    expect(boardAimAt(columns, 100, 98 + BOARD_JOIN_EDGE - 1, joinStack)).toMatchObject({ kind: 'insert', index: 2 });
    expect(boardAimAt(columns, 100, 258 - BOARD_JOIN_EDGE + 1, joinStack)).toMatchObject({ kind: 'insert', index: 3 });
  });

  it('starts a column with no header at its first row', () => {
    const loose: BoardColumnRect[] = [{ left: 0, right: 300, rows: [{ index: 0, header: false, top: 0, bottom: 60 }] }];
    expect(boardAimAt(loose, 10, 10, noJoin)).toEqual({ kind: 'insert', index: 0, column: 0, lineY: 0 });
  });

  it('aims at nothing with no columns or rows', () => {
    expect(boardAimAt([], 0, 0, noJoin)).toEqual({ kind: 'none' });
    expect(boardAimAt([{ left: 0, right: 10, rows: [] }], 0, 0, noJoin)).toEqual({ kind: 'none' });
  });
});

describe('moveListItem', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('moves an item down to land before the one named', () => {
    expect(moveListItem(list, 0, 3)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item up', () => {
    expect(moveListItem(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves an item to the end', () => {
    expect(moveListItem(list, 1, 4)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('is null when the item would land where it is', () => {
    expect(moveListItem(list, 1, 1)).toBeNull();
    expect(moveListItem(list, 1, 2)).toBeNull();
    expect(moveListItem(list, 9, 0)).toBeNull();
  });
});
