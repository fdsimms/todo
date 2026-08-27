import { caretAtEnd, clampSelection, spliceAtSelection } from '../utils/textSelection';

describe('clampSelection', () => {
  it('leaves a selection that already sits inside the text alone', () => {
    expect(clampSelection({ start: 2, end: 5 }, 10)).toEqual({ start: 2, end: 5 });
  });

  it('orders a backwards drag', () => {
    expect(clampSelection({ start: 7, end: 3 }, 10)).toEqual({ start: 3, end: 7 });
  });

  it('pulls a caret left over from a longer string back to the end', () => {
    // The case that matters: a parsed phrase was just stripped out of the
    // title, and the selection event for the shorter string hasn't landed yet.
    expect(clampSelection({ start: 22, end: 22 }, 6)).toEqual({ start: 6, end: 6 });
  });

  it('clamps a negative offset to zero', () => {
    expect(clampSelection({ start: -1, end: -4 }, 10)).toEqual({ start: 0, end: 0 });
  });

  it('collapses to zero for empty text', () => {
    expect(clampSelection({ start: 3, end: 9 }, 0)).toEqual({ start: 0, end: 0 });
  });

  it('treats a negative length as empty rather than inverting the range', () => {
    expect(clampSelection({ start: 2, end: 4 }, -3)).toEqual({ start: 0, end: 0 });
  });

  it('rounds a fractional offset', () => {
    expect(clampSelection({ start: 1.4, end: 3.6 }, 10)).toEqual({ start: 1, end: 4 });
  });
});

describe('caretAtEnd', () => {
  it('parks the caret after the last character', () => {
    expect(caretAtEnd('buy milk')).toEqual({ start: 8, end: 8 });
  });

  it('is zero for empty text', () => {
    expect(caretAtEnd('')).toEqual({ start: 0, end: 0 });
  });
});

describe('spliceAtSelection', () => {
  it('inserts at a collapsed caret and reports the caret after the token', () => {
    expect(spliceAtSelection('buy milk', { start: 4, end: 4 }, '#')).toEqual({
      text: 'buy #milk',
      cursor: 5,
    });
  });

  it('replaces the selected run, the way a keypress would', () => {
    expect(spliceAtSelection('buy milk', { start: 4, end: 8 }, '@')).toEqual({
      text: 'buy @',
      cursor: 5,
    });
  });

  it('appends when the caret is at the end', () => {
    expect(spliceAtSelection('buy milk', { start: 8, end: 8 }, ' #')).toEqual({
      text: 'buy milk #',
      cursor: 10,
    });
  });

  it('appends rather than padding when the caret is past the end', () => {
    // Unclamped, `slice` would happily hand back 'buy#' plus nothing and the
    // reported caret would sit off the end of the string it describes.
    expect(spliceAtSelection('buy', { start: 20, end: 20 }, '#')).toEqual({
      text: 'buy#',
      cursor: 4,
    });
  });

  it('handles a backwards drag as the run it covers', () => {
    expect(spliceAtSelection('buy milk', { start: 8, end: 4 }, '@')).toEqual({
      text: 'buy @',
      cursor: 5,
    });
  });

  it('inserts into empty text', () => {
    expect(spliceAtSelection('', { start: 0, end: 0 }, '#')).toEqual({ text: '#', cursor: 1 });
  });
});
