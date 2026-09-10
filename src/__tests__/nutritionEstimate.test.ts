import {
  describeEstimate,
  estimateToPanel,
  readNutritionEstimate,
  refineDescription,
  type NutritionEstimate,
} from '../utils/nutritionEstimate';

function reply(over: Record<string, unknown> = {}) {
  return {
    label: 'Cheeseburger and fries, Five Guys',
    quantity: '1 burger and a regular fries',
    amounts: { calorieKcal: 1250, proteinG: 40, sodiumMg: 1400 },
    basis: 'published',
    confidence: 'high',
    attribution: 'Five Guys',
    questions: [],
    ...over,
  };
}

function estimate(over: Partial<NutritionEstimate> = {}): NutritionEstimate {
  return {
    label: 'Cheeseburger and fries',
    quantity: '1 serving',
    amounts: { calorieKcal: 1250 },
    basis: 'typical',
    confidence: 'medium',
    attribution: null,
    questions: [],
    ...over,
  };
}

describe('readNutritionEstimate', () => {
  it('reads a complete reply', () => {
    expect(readNutritionEstimate(reply())).toEqual({
      label: 'Cheeseburger and fries, Five Guys',
      quantity: '1 burger and a regular fries',
      amounts: { calorieKcal: 1250, proteinG: 40, sodiumMg: 1400 },
      basis: 'published',
      confidence: 'high',
      attribution: 'Five Guys',
      questions: [],
    });
  });

  it('leaves an omitted nutrient absent rather than making it zero', () => {
    // The rule FoodNutrition.amounts states: a model that said nothing about
    // fibre has said nothing about fibre, and a zero would be a claim it did
    // not make.
    const read = readNutritionEstimate(reply({ amounts: { calorieKcal: 600 } }));
    expect(read?.amounts).toEqual({ calorieKcal: 600 });
    expect('fiberG' in (read?.amounts ?? {})).toBe(false);
  });

  it('keeps a stated zero, which is a figure rather than an absence', () => {
    expect(readNutritionEstimate(reply({ amounts: { calorieKcal: 600, caffeineMg: 0 } }))?.amounts)
      .toEqual({ calorieKcal: 600, caffeineMg: 0 });
  });

  it('drops a figure that cannot be true rather than clamping it to zero', () => {
    // A negative is not evidence of a low reading, so it goes the way an
    // absent one does.
    const read = readNutritionEstimate(reply({ amounts: { calorieKcal: 600, fatG: -3, carbsG: Infinity } }));
    expect(read?.amounts).toEqual({ calorieKcal: 600 });
  });

  it('drops a nutrient this build has no unit for', () => {
    expect(readNutritionEstimate(reply({ amounts: { calorieKcal: 600, unobtainium: 4 } }))?.amounts)
      .toEqual({ calorieKcal: 600 });
  });

  it('refuses a reply with no figures at all', () => {
    // Not a smaller estimate. The caller says the description could not be
    // read, which is the honest outcome.
    expect(readNutritionEstimate(reply({ amounts: {} }))).toBeNull();
    expect(readNutritionEstimate(reply({ amounts: 'lots' }))).toBeNull();
  });

  it('refuses a reply with nothing to call the entry', () => {
    expect(readNutritionEstimate(reply({ label: '   ' }))).toBeNull();
    expect(readNutritionEstimate(reply({ label: 7 }))).toBeNull();
    expect(readNutritionEstimate(null)).toBeNull();
    expect(readNutritionEstimate(undefined)).toBeNull();
  });

  it('falls back to the weaker reading of basis and confidence', () => {
    // Getting this backwards is the only way the default could do harm: an
    // omitted claim must not be promoted to the stronger one.
    const read = readNutritionEstimate(reply({ basis: undefined, confidence: undefined }));
    expect(read?.basis).toBe('typical');
    expect(read?.confidence).toBe('low');
    expect(readNutritionEstimate(reply({ confidence: 'certain' }))?.confidence).toBe('low');
    expect(readNutritionEstimate(reply({ basis: 'measured' }))?.basis).toBe('typical');
  });

  it('drops an attribution the model did not earn', () => {
    // Naming a chain beside figures the model called typical would attribute a
    // guess to somebody.
    expect(readNutritionEstimate(reply({ basis: 'typical', attribution: 'Five Guys' }))?.attribution)
      .toBeNull();
  });

  it('names a quantity when the reply stated none', () => {
    expect(readNutritionEstimate(reply({ quantity: '' }))?.quantity).toBe('1 serving');
  });
});

describe('readNutritionEstimate questions', () => {
  it('keeps a question with options to tap', () => {
    const read = readNutritionEstimate(reply({
      questions: [{ prompt: 'Which size?', options: ['Little', 'Regular', 'Large'] }],
    }));
    expect(read?.questions).toEqual([{ prompt: 'Which size?', options: ['Little', 'Regular', 'Large'] }]);
  });

  it('drops a question with nothing to tap', () => {
    // A prompt with no options is a request to type free text, which the
    // description field already is.
    expect(readNutritionEstimate(reply({
      questions: [{ prompt: 'How big?', options: [] }, { prompt: 'And?', options: ['Only one'] }],
    }))?.questions).toEqual([]);
  });

  it('takes at most two, so it stays a question rather than an interrogation', () => {
    const many = [1, 2, 3, 4].map(n => ({ prompt: `Q${n}?`, options: ['a', 'b'] }));
    expect(readNutritionEstimate(reply({ questions: many }))?.questions).toHaveLength(2);
  });

  it('treats a missing or malformed question list as no questions', () => {
    expect(readNutritionEstimate(reply({ questions: undefined }))?.questions).toEqual([]);
    expect(readNutritionEstimate(reply({ questions: 'ask about size' }))?.questions).toEqual([]);
  });
});

describe('describeEstimate', () => {
  it('names who publishes the figures, when a chain does', () => {
    expect(describeEstimate(estimate({ basis: 'published', attribution: 'Five Guys', confidence: 'high' })))
      .toBe('Published figures for Five Guys.');
  });

  it('says published without a name when the model named none', () => {
    expect(describeEstimate(estimate({ basis: 'published', attribution: null, confidence: 'high' })))
      .toBe('Published figures for this dish.');
  });

  it('keeps a guess apart from a published figure', () => {
    // The two are different claims and rendering them identically is the
    // overclaim this whole tree is arranged against.
    expect(describeEstimate(estimate({ basis: 'typical', confidence: 'high' })))
      .toBe('Typical for this dish rather than a specific recipe.');
  });

  it('says the weaker claim out loud rather than hiding it', () => {
    expect(describeEstimate(estimate({ basis: 'typical', confidence: 'medium' })))
      .toBe('Typical for this dish rather than a specific recipe. Close, not exact.');
    expect(describeEstimate(estimate({ basis: 'typical', confidence: 'low' })))
      .toBe('Typical for this dish rather than a specific recipe. A rough guess.');
  });

  it('never advises, never judges the food, and never quotes a figure', () => {
    // The rules this copy exists to keep, asserted directly, the way
    // moodInsights.test.ts asserts describeHealthInsight never gives advice.
    const every: NutritionEstimate[] = [];
    for (const basis of ['published', 'typical'] as const) {
      for (const confidence of ['high', 'medium', 'low'] as const) {
        for (const attribution of ['Five Guys', null]) {
          every.push(estimate({ basis, confidence, attribution }));
        }
      }
    }
    for (const one of every) {
      const text = describeEstimate(one);
      expect(text).not.toMatch(/\btry\b|\bshould\b|instead|healthy|unhealthy|heavy|light(er)?\b|too much|cut down|watch\b|treat\b/i);
      expect(text).not.toMatch(/\d/);
    }
  });
});

describe('estimateToPanel', () => {
  it('marks the panel estimated, permanently', () => {
    const panel = estimateToPanel(estimate(), new Date('2026-09-10T18:00:00.000Z'));
    expect(panel?.source).toBe('estimated');
    expect(panel?.sourceId).toBeNull();
    expect(panel?.basis).toBe('perServing');
    expect(panel?.recordedAt).toBe('2026-09-10T18:00:00.000Z');
  });

  it('carries the amounts and the quantity in words', () => {
    const panel = estimateToPanel(estimate({ quantity: '1 burger', amounts: { calorieKcal: 900 } }));
    expect(panel?.amounts).toEqual({ calorieKcal: 900 });
    expect(panel?.servingText).toBe('1 burger');
  });

  it('invents no weight, since there is nothing to check one against', () => {
    expect(estimateToPanel(estimate())?.servingGrams).toBeNull();
    expect(estimateToPanel(estimate())?.portions).toEqual([]);
  });

  it('copies the amounts rather than sharing them with the estimate', () => {
    const one = estimate();
    const panel = estimateToPanel(one)!;
    panel.amounts.calorieKcal = 1;
    expect(one.amounts.calorieKcal).toBe(1250);
  });

  it('refuses an estimate with nothing in it', () => {
    expect(estimateToPanel(estimate({ amounts: {} }))).toBeNull();
  });
});

describe('refineDescription', () => {
  it('states the answers alongside what was typed', () => {
    expect(refineDescription('Burger and fries', [
      { prompt: 'Which size?', answer: 'Large' },
    ])).toBe('Burger and fries\nWhich size? Large');
  });

  it('leaves an unanswered question out, which is what makes skipping free', () => {
    expect(refineDescription('Burger and fries', [
      { prompt: 'Which size?', answer: '' },
      { prompt: 'Dressing on it?', answer: 'No' },
    ])).toBe('Burger and fries\nDressing on it? No');
  });

  it('hands back the description alone when nothing was answered', () => {
    expect(refineDescription('  Burger and fries  ', [])).toBe('Burger and fries');
    expect(refineDescription('Burger', [{ prompt: '', answer: 'Large' }])).toBe('Burger');
  });

  it('clamps a description longer than the field allows', () => {
    expect(refineDescription('x'.repeat(500), []).length).toBe(200);
  });
});
