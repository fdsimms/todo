import {
  ESTIMATE_DESCRIPTION_MAX_LENGTH,
  ESTIMATE_REQUEST_MAX_LENGTH,
  describeEstimate,
  estimateToPanel,
  breakdownMismatch,
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
    breakdown: [],
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
    breakdown: [],
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
      breakdown: [],
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

  it('believes "own" only when records were actually offered', () => {
    // The one basis this side knows the truth of: a model given nothing to
    // lean on cannot have leaned on anything. Demoted rather than dropped,
    // since the figures may be fine and it is only the provenance that cannot
    // stand.
    expect(readNutritionEstimate(reply({ basis: 'own', attribution: '' }), true)?.basis).toBe('own');
    expect(readNutritionEstimate(reply({ basis: 'own', attribution: '' }))?.basis).toBe('typical');
    expect(readNutritionEstimate(reply({ basis: 'own', attribution: '' }), false)?.basis).toBe('typical');
  });

  it('attributes nothing to a publisher for figures off the user\'s own records', () => {
    // Naming a chain beside figures taken from somebody's own log would
    // attribute their record to a manufacturer.
    expect(readNutritionEstimate(reply({ basis: 'own', attribution: 'Five Guys' }), true)?.attribution)
      .toBeNull();
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

describe('readNutritionEstimate breakdown', () => {
  it('keeps a component with figures', () => {
    const read = readNutritionEstimate(reply({
      amounts: { calorieKcal: 51, carbsG: 6, fatG: 1 },
      breakdown: [
        { label: 'baguette', amounts: { calorieKcal: 40, carbsG: 6 } },
        { label: 'salted butter', amounts: { calorieKcal: 11, fatG: 1 } },
      ],
    }));
    expect(read?.breakdown).toEqual([
      { label: 'baguette', amounts: { calorieKcal: 40, carbsG: 6 } },
      { label: 'salted butter', amounts: { calorieKcal: 11, fatG: 1 } },
    ]);
  });

  it('drops a breakdown that does not add up to the total, keeping the total', () => {
    const read = readNutritionEstimate(reply({
      amounts: { calorieKcal: 51 },
      breakdown: [
        { label: 'baguette', amounts: { calorieKcal: 40 } },
        { label: 'butter', amounts: { calorieKcal: 30 } },
      ],
    }));
    expect(read?.breakdown).toEqual([]);
    expect(read?.amounts.calorieKcal).toBe(51);
  });

  it('drops a component with nothing to call it', () => {
    expect(readNutritionEstimate(reply({
      breakdown: [{ label: '   ', amounts: { calorieKcal: 40 } }],
    }))?.breakdown).toEqual([]);
  });

  it('drops a component with no figures, same as the total would', () => {
    expect(readNutritionEstimate(reply({
      breakdown: [{ label: 'baguette', amounts: {} }],
    }))?.breakdown).toEqual([]);
  });

  it('applies the same absent/negative rules a top-level amount does', () => {
    const read = readNutritionEstimate(reply({
      amounts: { calorieKcal: 40 },
      breakdown: [{ label: 'baguette', amounts: { calorieKcal: 40, fatG: -3, carbsG: Infinity } }],
    }));
    expect(read?.breakdown).toEqual([{ label: 'baguette', amounts: { calorieKcal: 40 } }]);
  });

  it('treats a missing or malformed breakdown as none', () => {
    expect(readNutritionEstimate(reply({ breakdown: undefined }))?.breakdown).toEqual([]);
    expect(readNutritionEstimate(reply({ breakdown: 'bread, butter' }))?.breakdown).toEqual([]);
  });

  it('caps how many components it keeps', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ label: `item ${i}`, amounts: { calorieKcal: 1 } }));
    expect(readNutritionEstimate(reply({ breakdown: many }))?.breakdown.length).toBeLessThan(20);
  });
});

describe('breakdownMismatch', () => {
  const total = { calorieKcal: 790, proteinG: 10 };
  const line = (label: string, amounts: Record<string, number>) => ({ label, amounts });

  it('passes parts that add up, within rounding', () => {
    expect(breakdownMismatch(total, [line('a', { calorieKcal: 250.4, proteinG: 4 }), line('b', { calorieKcal: 540, proteinG: 6 })])).toBeNull();
  });

  it('names the nutrient that does not add up', () => {
    expect(breakdownMismatch(total, [line('a', { calorieKcal: 250 }), line('b', { calorieKcal: 400 })]))
      .toBe('calorieKcal: the parts add up to 650 but the total is 790');
  });

  it('leaves a nutrient no line states alone, since absent is not zero', () => {
    expect(breakdownMismatch(total, [line('a', { calorieKcal: 300 }), line('b', { calorieKcal: 490 })])).toBeNull();
  });

  it('flags a part stating what the total does not', () => {
    expect(breakdownMismatch({ calorieKcal: 100 }, [line('a', { calorieKcal: 100, fatG: 5 })])).toMatch(/fatG/);
  });

  it('has nothing to check without parts', () => {
    expect(breakdownMismatch(total, [])).toBeNull();
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
      .toBe('Typical figures for this dish.');
  });

  it('says the weaker claim out loud rather than hiding it', () => {
    expect(describeEstimate(estimate({ basis: 'typical', confidence: 'medium' })))
      .toBe('Typical figures for this dish. Close, not exact.');
    expect(describeEstimate(estimate({ basis: 'typical', confidence: 'low' })))
      .toBe('Typical figures for this dish. A rough guess.');
  });

  it('says when the figures leaned on the user\'s own records', () => {
    expect(describeEstimate(estimate({ basis: 'own', confidence: 'high' })))
      .toBe('Worked out from figures already in your own records.');
    expect(describeEstimate(estimate({ basis: 'own', confidence: 'medium' })))
      .toBe('Worked out from figures already in your own records. Close, not exact.');
  });

  it('never advises, never judges the food, and never quotes a figure', () => {
    // The rules this copy exists to keep, asserted directly, the way
    // moodInsights.test.ts asserts describeHealthInsight never gives advice.
    const every: NutritionEstimate[] = [];
    for (const basis of ['published', 'typical', 'own'] as const) {
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

  it('keeps the breakdown on the panel, as a copy', () => {
    const lines = [{ label: 'baguette', amounts: { calorieKcal: 40 } }];
    const panel = estimateToPanel(estimate({ breakdown: lines }))!;
    expect(panel.breakdown).toEqual(lines);
    panel.breakdown![0].amounts.calorieKcal = 1;
    expect(lines[0].amounts.calorieKcal).toBe(40);
  });

  it('adds no breakdown key for a single-item estimate', () => {
    expect('breakdown' in estimateToPanel(estimate({ breakdown: [] }))!).toBe(false);
  });

  it('refuses an estimate with nothing in it', () => {
    expect(estimateToPanel(estimate({ amounts: {} }))).toBeNull();
  });
});

describe('refineDescription', () => {
  it('always fits inside the request cap, answers and all', () => {
    // The request used to be capped at the description's own length, which
    // cut the answers off any description near its limit.
    const longest = refineDescription('x'.repeat(ESTIMATE_DESCRIPTION_MAX_LENGTH), [
      { prompt: 'p'.repeat(80), answer: 'a'.repeat(80) },
      { prompt: 'q'.repeat(80), answer: 'b'.repeat(80) },
    ]);
    expect(longest.length).toBeLessThanOrEqual(ESTIMATE_REQUEST_MAX_LENGTH);
    expect(longest.slice(0, ESTIMATE_REQUEST_MAX_LENGTH).endsWith('b'.repeat(80))).toBe(true);
  });

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

  it('states a typed amount as its own line, ahead of any answers', () => {
    expect(refineDescription('Tofu', [{ prompt: 'Fried?', answer: 'Yes' }], '  200 g '))
      .toBe('Tofu\nAmount eaten: 200 g\nFried? Yes');
  });

  it('reads a blank amount as not given', () => {
    expect(refineDescription('Tofu', [], '   ')).toBe('Tofu');
  });

  it('keeps a full description, amount and answers inside the request cap', () => {
    const longest = refineDescription('x'.repeat(ESTIMATE_DESCRIPTION_MAX_LENGTH), [
      { prompt: 'p'.repeat(80), answer: 'a'.repeat(80) },
      { prompt: 'q'.repeat(80), answer: 'b'.repeat(80) },
    ], 'm'.repeat(200));
    expect(longest.length).toBeLessThanOrEqual(ESTIMATE_REQUEST_MAX_LENGTH);
    expect(longest.endsWith('b'.repeat(80))).toBe(true);
  });

  it('clamps a description longer than the field allows', () => {
    expect(refineDescription('x'.repeat(500), []).length).toBe(200);
  });
});
