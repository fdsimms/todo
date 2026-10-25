import { findingKey, parseDismissed, visibleFindings, withDismissed } from '../utils/catalogAuditDismissed';

const finding = (kind: 'same_words' | 'all_caps', ...names: string[]) => ({
  kind,
  items: names.map((name, i) => ({ id: `id${i}`, name, aisle: 'Pantry' })),
});

describe('catalog audit dismissals', () => {
  it('names a finding by its kind and its rows\' name keys, not their ids', () => {
    expect(findingKey(finding('same_words', 'Ground Ginger', 'ginger powder'))).toBe('same_words:ground ginger|ginger powder');
    expect(findingKey({ kind: 'all_caps', items: [{ id: 'other', name: 'PEANUT BUTTER CUPS', aisle: 'x' }] })).toBe('all_caps:peanut butter cups');
  });

  it('reads a stored list, tolerating nothing, junk and the wrong shape', () => {
    expect(parseDismissed(null)).toEqual([]);
    expect(parseDismissed('not json')).toEqual([]);
    expect(parseDismissed('{"a":1}')).toEqual([]);
    expect(parseDismissed('["a", 3, "b"]')).toEqual(['a', 'b']);
  });

  it('adds a key once', () => {
    expect(withDismissed(['a'], 'b')).toEqual(['a', 'b']);
    expect(withDismissed(['a'], 'a')).toEqual(['a']);
  });

  it('hides a dismissed finding and lets a renamed row come back as a new question', () => {
    const a = finding('same_words', 'ground ginger', 'ginger powder');
    const b = finding('all_caps', 'PEANUT BUTTER CUPS');
    const dismissed = [findingKey(a)];
    expect(visibleFindings([a, b], dismissed)).toEqual([b]);
    expect(visibleFindings([finding('same_words', 'ground ginger', 'ginger spice')], dismissed)).toHaveLength(1);
  });
});
