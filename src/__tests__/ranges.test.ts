import { mergeRanges, scoreSubstring } from '../utils/ranges';

describe('mergeRanges', () => {
  it('leaves a single range alone', () => {
    expect(mergeRanges([[2, 5]])).toEqual([[2, 5]]);
  });

  it('sorts disjoint ranges without joining them', () => {
    expect(mergeRanges([[6, 8], [0, 3]])).toEqual([[0, 3], [6, 8]]);
  });

  // Two words of one query can match overlapping spans ("gro groceries").
  // HighlightedText walks its ranges with one cursor, so an overlap left in
  // would render the shared span twice.
  it('collapses an overlap into one range', () => {
    expect(mergeRanges([[0, 4], [2, 7]])).toEqual([[0, 7]]);
  });

  it('joins ranges that merely touch', () => {
    expect(mergeRanges([[0, 3], [3, 6]])).toEqual([[0, 6]]);
  });

  it('keeps the wider of two ranges that start together', () => {
    expect(mergeRanges([[0, 3], [0, 9]])).toEqual([[0, 9]]);
  });

  it('swallows a range contained by the one before it', () => {
    expect(mergeRanges([[0, 10], [3, 5]])).toEqual([[0, 10]]);
  });

  // The tuples handed in belong to the caller, and the loop widens in place.
  it('does not mutate the ranges it was given', () => {
    const input: [number, number][] = [[0, 4], [2, 7]];
    mergeRanges(input);
    expect(input).toEqual([[0, 4], [2, 7]]);
  });
});

describe('scoreSubstring', () => {
  it('scores nothing for an empty needle', () => {
    expect(scoreSubstring('milk', '')).toEqual({ score: 0, ranges: [] });
  });

  it('ranks an exact substring above a fuzzy match', () => {
    const exact = scoreSubstring('oat milk', 'milk');
    const fuzzy = scoreSubstring('mineral like', 'milk');
    expect(exact.score).toBeGreaterThan(fuzzy.score);
  });

  it('gives a match at the start a bonus over one in the middle', () => {
    expect(scoreSubstring('milk', 'milk').score)
      .toBeGreaterThan(scoreSubstring('oat milk', 'milk').score);
  });

  it('reports where the exact match sits', () => {
    expect(scoreSubstring('oat milk', 'milk').ranges).toEqual([[4, 8]]);
  });

  it('ignores case on both sides', () => {
    expect(scoreSubstring('Oat MILK', 'milk').ranges).toEqual([[4, 8]]);
  });

  it('matches characters in order when they are not adjacent', () => {
    const { score, ranges } = scoreSubstring('milk chocolate', 'mlk');
    expect(score).toBeGreaterThan(0);
    expect(ranges).toEqual([[0, 4]]);
  });

  it('scores a tighter run of characters higher than a scattered one', () => {
    const tight = scoreSubstring('milk', 'mlk');
    const scattered = scoreSubstring('marzipan lemon kale', 'mlk');
    expect(tight.score).toBeGreaterThan(scattered.score);
  });

  it('refuses when a character of the needle is missing', () => {
    expect(scoreSubstring('milk', 'milkx')).toEqual({ score: 0, ranges: [] });
  });

  it('refuses when the characters are present but out of order', () => {
    expect(scoreSubstring('milk', 'klim')).toEqual({ score: 0, ranges: [] });
  });
});
