import { bumpChipUses, chipUseKey, parseChipUses, rankByUse, suggestExistingTags } from '../utils/chipUses';

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
  describe('suggestExistingTags', () => {
    const all = ['errand', 'homework', 'phone', 'work', 'workout'];

    it('leaves out tags already chosen, in any case', () => {
      expect(suggestExistingTags(all, ['Work', 'phone'], '', {}, 10)).toEqual(['errand', 'homework', 'workout']);
    });

    it('offers the most used first with nothing typed, then caps', () => {
      const uses = { 'tag:workout': 3, 'tag:phone': 1 };
      expect(suggestExistingTags(all, [], '', uses, 3)).toEqual(['workout', 'phone', 'errand']);
    });

    it('narrows to what is typed, a starting match ahead of one inside the name', () => {
      expect(suggestExistingTags(all, [], 'wo', {}, 10)).toEqual(['work', 'workout', 'homework']);
    });

    it('ranks by use within each kind of match', () => {
      expect(suggestExistingTags(all, [], 'wo', { 'tag:workout': 2 }, 10)).toEqual(['workout', 'work', 'homework']);
    });

    it('ignores a leading # and surrounding space', () => {
      expect(suggestExistingTags(all, [], ' #ERR ', {}, 10)).toEqual(['errand']);
    });

    it('offers nothing when nothing matches', () => {
      expect(suggestExistingTags(all, [], 'zzz', {}, 10)).toEqual([]);
    });
  });
});
