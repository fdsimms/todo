import {
  MAX_SUGGESTED_SUBSTITUTES,
  dedupeSuggestedSubstitutes,
  type RawSuggestedSubstitute,
} from '../utils/substituteSuggestions';

describe('dedupeSuggestedSubstitutes', () => {
  it('is empty with no response', () => {
    expect(dedupeSuggestedSubstitutes(undefined)).toEqual([]);
  });

  it('drops a blank name', () => {
    const raw: RawSuggestedSubstitute[] = [{ name: '   ' }, { name: 'margarine' }];
    expect(dedupeSuggestedSubstitutes(raw).map(s => s.name)).toEqual(['margarine']);
  });

  it('names a substitute with no ratio', () => {
    expect(dedupeSuggestedSubstitutes([{ name: 'margarine' }])).toEqual([
      { name: 'margarine', ratioFrom: null, ratioTo: null },
    ]);
  });

  it('keeps a ratio whose halves both parse', () => {
    const raw: RawSuggestedSubstitute[] = [
      { name: 'garlic powder', ratio_from: '1 clove', ratio_to: '1/4 tsp' },
    ];
    expect(dedupeSuggestedSubstitutes(raw)).toEqual([
      { name: 'garlic powder', ratioFrom: '1 clove', ratioTo: '1/4 tsp' },
    ]);
  });

  it('keeps the name and drops the ratio when one half is unparseable', () => {
    const raw: RawSuggestedSubstitute[] = [
      { name: 'garlic powder', ratio_from: 'a pinch', ratio_to: '1/4 tsp' },
    ];
    expect(dedupeSuggestedSubstitutes(raw)).toEqual([
      { name: 'garlic powder', ratioFrom: null, ratioTo: null },
    ]);
  });

  it('drops the ratio when only one side is given', () => {
    const raw: RawSuggestedSubstitute[] = [
      { name: 'garlic powder', ratio_from: '1 clove' },
    ];
    expect(dedupeSuggestedSubstitutes(raw)[0]).toEqual({
      name: 'garlic powder',
      ratioFrom: null,
      ratioTo: null,
    });
  });

  it.each([
    'milk + lemon juice',
    'flour and butter',
    'milk/lemon juice',
    'milk, lemon juice',
    'flour & butter',
    'pasta with sauce',
  ])('drops a suggestion naming more than one ingredient: %s', (name) => {
    expect(dedupeSuggestedSubstitutes([{ name }])).toEqual([]);
  });

  it('does not mistake a plain name for a joined one', () => {
    // "candy" contains "and" but not " and " — must survive.
    expect(dedupeSuggestedSubstitutes([{ name: 'candy' }]).map(s => s.name)).toEqual(['candy']);
  });

  it('dedupes case-insensitively against another suggestion in the same response', () => {
    const raw: RawSuggestedSubstitute[] = [{ name: 'margarine' }, { name: 'margarine' }];
    expect(dedupeSuggestedSubstitutes(raw)).toHaveLength(1);
  });

  it('drops a suggestion matching an excluded name', () => {
    const raw: RawSuggestedSubstitute[] = [{ name: 'margarine' }, { name: 'ghee' }];
    expect(dedupeSuggestedSubstitutes(raw, ['butter', 'margarine']).map(s => s.name)).toEqual([
      'ghee',
    ]);
  });

  it('caps the count', () => {
    const raw: RawSuggestedSubstitute[] = Array.from({ length: 10 }, (_, i) => ({
      name: `Item ${i}`,
    }));
    expect(dedupeSuggestedSubstitutes(raw)).toHaveLength(MAX_SUGGESTED_SUBSTITUTES);
  });
});
