import { settleCursor, stepCursor } from '../utils/rowCursor';

const ids = ['a', 'b', 'c', 'd'];

describe('stepCursor', () => {
  it('moves one row at a time', () => {
    expect(stepCursor(ids, 'b', 1)).toBe('c');
    expect(stepCursor(ids, 'c', -1)).toBe('b');
  });

  it('stops at the ends instead of wrapping', () => {
    expect(stepCursor(ids, 'd', 1)).toBe('d');
    expect(stepCursor(ids, 'a', -1)).toBe('a');
  });

  it('enters the list at the end the key points toward', () => {
    expect(stepCursor(ids, null, 1)).toBe('a');
    expect(stepCursor(ids, null, -1)).toBe('d');
  });

  it('treats a row that is no longer listed like no row', () => {
    expect(stepCursor(ids, 'gone', 1)).toBe('a');
    expect(stepCursor(ids, 'gone', -1)).toBe('d');
  });

  it('has nowhere to go in an empty list', () => {
    expect(stepCursor([], null, 1)).toBeNull();
    expect(stepCursor([], 'a', -1)).toBeNull();
  });
});

describe('settleCursor', () => {
  it('stays on a row that is still there, wherever it moved', () => {
    expect(settleCursor(ids, ['d', 'c', 'b', 'a'], 'b')).toBe('b');
  });

  it('hands a finished row to the one below it, so repeated Space clears a list from the top', () => {
    expect(settleCursor(ids, ['b', 'c', 'd'], 'a')).toBe('b');
    expect(settleCursor(ids, ['a', 'c', 'd'], 'b')).toBe('c');
  });

  it('falls back to the row above when nothing is left below', () => {
    expect(settleCursor(ids, ['a', 'b', 'c'], 'd')).toBe('c');
  });

  it('skips over neighbours that went too', () => {
    expect(settleCursor(ids, ['a', 'd'], 'b')).toBe('d');
    expect(settleCursor(ids, ['a'], 'c')).toBe('a');
  });

  it('is nowhere when the cursor was nowhere or the list is empty', () => {
    expect(settleCursor(ids, ids, null)).toBeNull();
    expect(settleCursor(ids, [], 'a')).toBeNull();
  });

  it('is nowhere for a row it never knew about', () => {
    expect(settleCursor(ids, ['x', 'y'], 'gone')).toBeNull();
  });
});
