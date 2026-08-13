import { segmentRows } from '../utils/segmentColumns';

describe('segmentRows', () => {
  it('splits an exact multiple into full rows', () => {
    expect(segmentRows(['a', 'b', 'c', 'd'], 2)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('pads a short last row with spacers so every cell is the same width', () => {
    expect(segmentRows(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c', null]]);
    expect(segmentRows(['a', 'b', 'c', 'd', 'e'], 3)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', null],
    ]);
  });

  it('pads a single row that is short of the column count', () => {
    expect(segmentRows(['a', 'b'], 4)).toEqual([['a', 'b', null, null]]);
  });

  it('gives one option per row at one column', () => {
    expect(segmentRows(['a', 'b'], 1)).toEqual([['a'], ['b']]);
  });

  it('has no rows when there are no options', () => {
    expect(segmentRows([], 3)).toEqual([]);
  });

  it('treats a nonsense column count as one column rather than looping forever', () => {
    expect(segmentRows(['a', 'b'], 0)).toEqual([['a'], ['b']]);
    expect(segmentRows(['a', 'b'], -2)).toEqual([['a'], ['b']]);
    expect(segmentRows(['a', 'b', 'c'], 2.7)).toEqual([['a', 'b'], ['c', null]]);
  });
});
