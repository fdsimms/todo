import { bumpChipUses, chipUseKey, parseChipUses, rankByUse } from '../utils/chipUses';

describe('chipUses', () => {
  it('folds case in a key', () => {
    expect(chipUseKey('category', ' Home ')).toBe('category:home');
  });

  it('adds one per key and counts a repeat within a call once', () => {
    const before = { 'category:home': 2 };
    const after = bumpChipUses(before, ['category:home', 'tag:quick', 'tag:quick']);
    expect(after).toEqual({ 'category:home': 3, 'tag:quick': 1 });
    expect(before).toEqual({ 'category:home': 2 });
  });

  it('ranks most used first and leaves ties in place', () => {
    expect(rankByUse(['a', 'b', 'c', 'd'], { c: 2, d: 2, b: 1 }, x => x)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('reads back only positive counts, and survives junk', () => {
    expect(parseChipUses(JSON.stringify({ a: 2, b: 0, c: -1, d: 'x', e: 1.7 }))).toEqual({ a: 2, e: 1 });
    expect(parseChipUses(null)).toEqual({});
    expect(parseChipUses('not json')).toEqual({});
    expect(parseChipUses('[1,2]')).toEqual({});
  });
});
