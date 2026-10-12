import { matchExcerpt, mergeRanges, scoreSubstring } from '../utils/ranges';

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

  it('ranks the start of a word above the middle of one', () => {
    const start = scoreSubstring('Look into flights', 'lo').score;
    const wordStart = scoreSubstring('Buy a lollipop', 'lo').score;
    const mid = scoreSubstring('Use the cloud credits', 'lo').score;
    expect(start).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(mid);
  });

  it('prefers a later word-start occurrence over an earlier mid-word one', () => {
    const { ranges } = scoreSubstring('cloud lock', 'lo');
    expect(ranges).toEqual([[6, 8]]);
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

describe('matchExcerpt', () => {
  it('returns null when nothing matches exactly', () => {
    expect(matchExcerpt('ask about the crown', ['xyz'])).toBeNull();
    // A scattered-letters hit is a guess, not something to point at.
    expect(matchExcerpt('lemon on grill', ['log'])).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(matchExcerpt('   ', ['lo'])).toBeNull();
  });

  it('keeps short text whole and highlights the match', () => {
    const e = matchExcerpt('ask about the local anesthetic', ['lo'])!;
    expect(e.text).toBe('ask about the local anesthetic');
    expect(e.text.slice(e.ranges[0][0], e.ranges[0][1])).toBe('lo');
  });

  it('flattens line breaks into one line', () => {
    expect(matchExcerpt('first line\n\nsecond local line', ['lo'])!.text)
      .toBe('first line second local line');
  });

  it('cuts to a window with ellipses, starting on a word, with ranges shifted onto the cut text', () => {
    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen local fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four';
    const e = matchExcerpt(long, ['local'])!;
    expect(e.text.startsWith('…')).toBe(true);
    expect(e.text.endsWith('…')).toBe(true);
    expect(e.text[1]).not.toBe(' ');
    const [s, end] = e.ranges[0];
    expect(e.text.slice(s, end)).toBe('local');
  });

  it('highlights every word that matches inside the window', () => {
    const e = matchExcerpt('call the local dentist', ['lo', 'dent'])!;
    expect(e.ranges.map(([s, end]) => e.text.slice(s, end))).toEqual(['lo', 'dent']);
  });
});
