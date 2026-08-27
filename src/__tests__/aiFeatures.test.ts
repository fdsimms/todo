import {
  AI_FEATURES,
  AI_FEATURE_IDS,
  aiFeaturesFor,
  defaultAiFeatureConfig,
} from '../utils/aiFeatures';

describe('AI features', () => {
  it('describes every id exactly once', () => {
    expect(AI_FEATURES.map(f => f.id).sort()).toEqual([...AI_FEATURE_IDS].sort());
  });

  it('configures every id by default', () => {
    expect(Object.keys(defaultAiFeatureConfig()).sort()).toEqual([...AI_FEATURE_IDS].sort());
  });
});

describe('aiFeaturesFor', () => {
  it('drops the kitchen features when the area is off', () => {
    expect(aiFeaturesFor(false).map(f => f.id))
      .toEqual(['taskBreakdown', 'templateSuggestions', 'projectTaskSuggestions', 'calendarImport']);
  });

  it('keeps them all when it is on', () => {
    expect(aiFeaturesFor(true)).toHaveLength(AI_FEATURES.length);
  });

  it('drops the features whose surface simplified mode removes', () => {
    const on = aiFeaturesFor(true, true).map(f => f.id);
    expect(on).not.toContain('substitutes');
    expect(on).not.toContain('receiptImport');
    expect(on).not.toContain('calendarImport');
    // Nothing else goes: recipe import and meal ideas still have a screen.
    expect(on).toContain('recipeExtraction');
    expect(on).toContain('mealIdeas');
  });

  it('composes the two gates rather than letting one override the other', () => {
    expect(aiFeaturesFor(false, true).map(f => f.id))
      .toEqual(['taskBreakdown', 'templateSuggestions', 'projectTaskSuggestions']);
  });

  it('leaves the stored config alone, so the rows come back as they were', () => {
    // The point of hiding rather than clearing: someone who put Recipe import
    // on Opus and then put the whole area away should find it on Opus when
    // they bring it back. Nothing here writes, and this is what says so.
    const before = defaultAiFeatureConfig();
    aiFeaturesFor(false);
    expect(defaultAiFeatureConfig()).toEqual(before);
  });
});
