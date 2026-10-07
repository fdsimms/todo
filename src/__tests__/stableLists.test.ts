import { reuseUnchangedLists } from '@/utils/stableLists';

describe('reuseUnchangedLists', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const c = { id: 'c' };

  it('returns the new map untouched with nothing to compare against', () => {
    const next = new Map([['g', [a]]]);
    expect(reuseUnchangedLists(null, next)).toBe(next);
  });

  it('keeps last time\'s array when the members are the same objects in the same order', () => {
    const prev = new Map([['g', [a, b]]]);
    const out = reuseUnchangedLists(prev, new Map([['g', [a, b]]]));
    expect(out.get('g')).toBe(prev.get('g'));
  });

  it('takes the new array when a member was added, replaced or moved', () => {
    const prev = new Map([['g', [a, b]], ['h', [a, b]], ['i', [a, b]]]);
    const added = [a, b, c];
    const replaced = [a, { id: 'b' }];
    const moved = [b, a];
    const out = reuseUnchangedLists(prev, new Map([['g', added], ['h', replaced], ['i', moved]]));
    expect(out.get('g')).toBe(added);
    expect(out.get('h')).toBe(replaced);
    expect(out.get('i')).toBe(moved);
  });

  it('only answers for keys still present, so a group that emptied stays gone', () => {
    const prev = new Map([['g', [a]], ['gone', [b]]]);
    const out = reuseUnchangedLists(prev, new Map([['g', [a]]]));
    expect([...out.keys()]).toEqual(['g']);
  });
});
