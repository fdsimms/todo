import { EMOJI_GROUPS, ALL_EMOJI, searchEmoji } from '../utils/emojiCatalog';
import { isSingleEmoji } from '../utils/emojiInput';

describe('emoji catalog', () => {
  it('parses every entry into one emoji plus keywords', () => {
    for (const entry of ALL_EMOJI) {
      expect(isSingleEmoji(entry.char)).toBe(true);
      expect(entry.keywords.trim().length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate emoji — a repeated key would collide in the grid', () => {
    const seen = new Set<string>();
    const dupes = ALL_EMOJI.filter(e => (seen.has(e.char) ? true : (seen.add(e.char), false)));
    expect(dupes.map(d => d.char)).toEqual([]);
  });

  it('gives every group a name, a tab icon and entries', () => {
    for (const group of EMOJI_GROUPS) {
      expect(group.name).toBeTruthy();
      expect(group.icon).toBeTruthy();
      expect(group.entries.length).toBeGreaterThan(0);
    }
  });
});

describe('searchEmoji', () => {
  it('matches on keywords', () => {
    expect(searchEmoji('fire').map(e => e.char)).toContain('🔥');
    expect(searchEmoji('laundry').map(e => e.char)).toContain('🧺');
    expect(searchEmoji('gym').map(e => e.char)).toContain('🏋️');
  });

  it('ranks a word that starts with the query above one that merely contains it', () => {
    const results = searchEmoji('home');
    expect(results[0].keywords.split(' ').some(w => w.startsWith('home'))).toBe(true);
  });

  it('is case and whitespace insensitive', () => {
    expect(searchEmoji('  MONEY ').map(e => e.char)).toContain('💰');
  });

  it('returns nothing for an empty query — the caller shows the groups instead', () => {
    expect(searchEmoji('')).toEqual([]);
    expect(searchEmoji('   ')).toEqual([]);
  });

  it('returns nothing for a word no entry carries', () => {
    expect(searchEmoji('qqqqq')).toEqual([]);
  });

  it('respects the limit', () => {
    expect(searchEmoji('a', 5).length).toBeLessThanOrEqual(5);
  });
});
