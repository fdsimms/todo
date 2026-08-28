import { addRecentSearch, parseRecentSearches, RECENT_SEARCH_LIMIT } from '../utils/recentSearches';

describe('addRecentSearch', () => {
  it('puts the newest query first', () => {
    expect(addRecentSearch(['milk'], 'bread')).toEqual(['bread', 'milk']);
  });

  it('moves a repeated query back to the front rather than duplicating it', () => {
    expect(addRecentSearch(['bread', 'milk'], 'milk')).toEqual(['milk', 'bread']);
  });

  it('treats case and inner whitespace as the same query', () => {
    expect(addRecentSearch(['Milk'], 'milk')).toEqual(['milk']);
    expect(addRecentSearch(['pay  rent'], 'pay rent')).toEqual(['pay rent']);
  });

  it('keeps the casing just typed, not the casing already stored', () => {
    // The version reached for most recently is the one most likely wanted again.
    expect(addRecentSearch(['MILK'], 'milk')).toEqual(['milk']);
  });

  it('trims and collapses whitespace before storing', () => {
    expect(addRecentSearch([], '  pay   rent  ')).toEqual(['pay rent']);
  });

  it('ignores a blank or whitespace-only query', () => {
    expect(addRecentSearch(['milk'], '')).toEqual(['milk']);
    expect(addRecentSearch(['milk'], '   ')).toEqual(['milk']);
  });

  it('caps the list, dropping the oldest', () => {
    const full = Array.from({ length: RECENT_SEARCH_LIMIT }, (_, i) => `q${i}`);
    const next = addRecentSearch(full, 'newest');
    expect(next).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(next[0]).toBe('newest');
    expect(next).not.toContain(`q${RECENT_SEARCH_LIMIT - 1}`);
  });

  it('does not grow past the cap when re-adding something already stored', () => {
    const full = Array.from({ length: RECENT_SEARCH_LIMIT }, (_, i) => `q${i}`);
    expect(addRecentSearch(full, 'q5')).toHaveLength(RECENT_SEARCH_LIMIT);
  });
});

describe('parseRecentSearches', () => {
  it('reads back what was written', () => {
    expect(parseRecentSearches(JSON.stringify(['milk', 'bread']))).toEqual(['milk', 'bread']);
  });

  it('returns empty for nothing, junk, or a non-array', () => {
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches('')).toEqual([]);
    expect(parseRecentSearches('not json')).toEqual([]);
    expect(parseRecentSearches(JSON.stringify({ milk: true }))).toEqual([]);
  });

  it('drops entries that are not usable queries', () => {
    expect(parseRecentSearches(JSON.stringify(['milk', 3, null, '', '  ', 'bread'])))
      .toEqual(['milk', 'bread']);
  });

  it('re-applies the cap to a longer stored list', () => {
    const long = Array.from({ length: RECENT_SEARCH_LIMIT + 5 }, (_, i) => `q${i}`);
    expect(parseRecentSearches(JSON.stringify(long))).toHaveLength(RECENT_SEARCH_LIMIT);
  });
});
