import {
  describeRecipeNutritionEstimate,
  readRecipeNutritionEstimate,
  type RecipeNutritionEstimate,
} from '../utils/recipeNutritionEstimate';

function reply(over: Record<string, unknown> = {}) {
  return {
    amounts: { calorieKcal: 1800, proteinG: 90, fatG: 60 },
    confidence: 'medium',
    ...over,
  };
}

function estimate(over: Partial<RecipeNutritionEstimate> = {}): RecipeNutritionEstimate {
  return {
    amounts: { calorieKcal: 1800 },
    confidence: 'medium',
    ...over,
  };
}

describe('readRecipeNutritionEstimate', () => {
  it('reads a complete reply', () => {
    expect(readRecipeNutritionEstimate(reply())).toEqual({
      amounts: { calorieKcal: 1800, proteinG: 90, fatG: 60 },
      confidence: 'medium',
    });
  });

  it('leaves an omitted nutrient absent rather than making it zero', () => {
    const read = readRecipeNutritionEstimate(reply({ amounts: { calorieKcal: 600 } }));
    expect(read?.amounts).toEqual({ calorieKcal: 600 });
    expect('fiberG' in (read?.amounts ?? {})).toBe(false);
  });

  it('keeps a stated zero, which is a figure rather than an absence', () => {
    expect(readRecipeNutritionEstimate(reply({ amounts: { calorieKcal: 600, caffeineMg: 0 } }))?.amounts)
      .toEqual({ calorieKcal: 600, caffeineMg: 0 });
  });

  it('drops a figure that cannot be true rather than clamping it to zero', () => {
    const read = readRecipeNutritionEstimate(reply({ amounts: { calorieKcal: 600, fatG: -3, carbsG: Infinity } }));
    expect(read?.amounts).toEqual({ calorieKcal: 600 });
  });

  it('drops a nutrient this build has no unit for', () => {
    expect(readRecipeNutritionEstimate(reply({ amounts: { calorieKcal: 600, unobtainium: 4 } }))?.amounts)
      .toEqual({ calorieKcal: 600 });
  });

  it('refuses a reply with no figures at all', () => {
    expect(readRecipeNutritionEstimate(reply({ amounts: {} }))).toBeNull();
    expect(readRecipeNutritionEstimate(reply({ amounts: 'lots' }))).toBeNull();
    expect(readRecipeNutritionEstimate(null)).toBeNull();
    expect(readRecipeNutritionEstimate(undefined)).toBeNull();
  });

  it('falls back to the weaker reading of confidence', () => {
    expect(readRecipeNutritionEstimate(reply({ confidence: undefined }))?.confidence).toBe('low');
    expect(readRecipeNutritionEstimate(reply({ confidence: 'certain' }))?.confidence).toBe('low');
  });
});

describe('describeRecipeNutritionEstimate', () => {
  it('says the weaker claim out loud rather than hiding it', () => {
    expect(describeRecipeNutritionEstimate(estimate({ confidence: 'high' })))
      .toBe('Read from the ingredient list, not measured.');
    expect(describeRecipeNutritionEstimate(estimate({ confidence: 'medium' })))
      .toBe('Read from the ingredient list, not measured. Close, not exact.');
    expect(describeRecipeNutritionEstimate(estimate({ confidence: 'low' })))
      .toBe('Read from the ingredient list, not measured. A rough guess.');
  });

  it('never advises, never judges the dish, and never quotes a figure', () => {
    for (const confidence of ['high', 'medium', 'low'] as const) {
      const text = describeRecipeNutritionEstimate(estimate({ confidence }));
      expect(text).not.toMatch(/\btry\b|\bshould\b|instead|healthy|unhealthy|heavy|light(er)?\b|too much|cut down|watch\b|treat\b/i);
      expect(text).not.toMatch(/\d/);
    }
  });
});
