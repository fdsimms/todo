import {
  applyFoodNutrition,
  applyLabelReading,
  buildPanelNutrition,
  emptyPanelForm,
  foodNutritionFieldCount,
  labelColumnFieldCount,
  invalidPanelFields,
  panelFormDirty,
  panelFormFrom,
  readPanelNumber,
  type PanelForm,
} from '../utils/nutritionPanelForm';
import type { FoodNutrition } from '../types';

const NOW = new Date('2026-03-04T09:00:00.000Z');

type FormOverrides = Partial<Omit<PanelForm, 'amounts'>> & { amounts?: Partial<PanelForm['amounts']> };

function form(overrides: FormOverrides = {}): PanelForm {
  const base = emptyPanelForm();
  return { ...base, ...overrides, amounts: { ...base.amounts, ...overrides.amounts } };
}

function panel(overrides: Partial<FoodNutrition> = {}): FoodNutrition {
  return {
    basis: 'per100g',
    servingGrams: 30,
    servingText: '2 cookies (30g)',
    amounts: { calorieKcal: 480, fatG: 21 },
    source: 'fdc',
    sourceId: '167512',
    portions: [{ amount: 1, label: 'cookie', grams: 15 }],
    recordedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('readPanelNumber', () => {
  it('reads a blank field as unknown rather than as zero', () => {
    // The distinction the whole record is shaped around: a label that didn't
    // state fibre is not a food containing none.
    expect(readPanelNumber('')).toBeNull();
    expect(readPanelNumber('   ')).toBeNull();
  });

  it('keeps a typed zero, which is a real thing for a label to say', () => {
    expect(readPanelNumber('0')).toBe(0);
  });

  it('reads decimals, in either separator', () => {
    expect(readPanelNumber('2.5')).toBe(2.5);
    expect(readPanelNumber('2,5')).toBe(2.5);
    expect(readPanelNumber('.5')).toBe(0.5);
  });

  it('refuses anything it would have to guess at', () => {
    // "12g" in particular: dropping the unit assumes which figure was meant,
    // which is the approximation this feature exists not to make.
    expect(readPanelNumber('12g')).toBe('invalid');
    expect(readPanelNumber('abt 12')).toBe('invalid');
    expect(readPanelNumber('-4')).toBe('invalid');
    expect(readPanelNumber('-')).toBe('invalid');
    expect(readPanelNumber('1e3')).toBe('invalid');
  });
});

describe('panelFormFrom', () => {
  it('brings back every stated figure and leaves the rest blank', () => {
    const f = panelFormFrom(panel());
    expect(f.amounts.calorieKcal).toBe('480');
    expect(f.amounts.fatG).toBe('21');
    expect(f.amounts.fiberG).toBe('');
    expect(f.servingText).toBe('2 cookies (30g)');
    expect(f.servingGrams).toBe('30');
    expect(f.basis).toBe('per100g');
  });

  it('is blank throughout for a food with no record', () => {
    const f = panelFormFrom(null);
    expect(f.servingGrams).toBe('');
    expect(Object.values(f.amounts).every(v => v === '')).toBe(true);
  });

  it('round-trips a stated zero as a zero and an absence as a blank', () => {
    const f = panelFormFrom(panel({ amounts: { fatG: 0 } }));
    expect(f.amounts.fatG).toBe('0');
    expect(f.amounts.proteinG).toBe('');
    expect(buildPanelNutrition(f, null, NOW)?.amounts).toEqual({ fatG: 0 });
  });
});

describe('invalidPanelFields', () => {
  it('names nothing for a blank form', () => {
    expect(invalidPanelFields(emptyPanelForm())).toEqual([]);
  });

  it('names each unreadable nutrient in label order', () => {
    const bad = invalidPanelFields(form({ amounts: { proteinG: 'lots', fatG: '3g' } }));
    expect(bad).toEqual(['fatG', 'proteinG']);
  });

  it('refuses a serving that weighs nothing, which scales nothing', () => {
    expect(invalidPanelFields(form({ servingGrams: '0' }))).toEqual(['servingGrams']);
    expect(invalidPanelFields(form({ servingGrams: 'about 30' }))).toEqual(['servingGrams']);
    expect(invalidPanelFields(form({ servingGrams: '30' }))).toEqual([]);
  });
});

describe('panelFormDirty', () => {
  it('is false for an untouched form and true once anything changes', () => {
    const baseline = panelFormFrom(panel());
    expect(panelFormDirty(panelFormFrom(panel()), baseline)).toBe(false);
    expect(panelFormDirty(form({ ...baseline, basis: 'perServing' }), baseline)).toBe(true);
    expect(panelFormDirty(
      { ...baseline, amounts: { ...baseline.amounts, fiberG: '2' } },
      baseline,
    )).toBe(true);
  });

  it('ignores whitespace, which is not an edit', () => {
    const baseline = panelFormFrom(panel());
    expect(panelFormDirty({ ...baseline, servingGrams: ' 30 ' }, baseline)).toBe(false);
  });
});

describe('buildPanelNutrition', () => {
  it('stores only what was filled in', () => {
    const built = buildPanelNutrition(
      form({ amounts: { calorieKcal: '120', sodiumMg: '0' } }),
      null,
      NOW,
    );
    expect(built?.amounts).toEqual({ calorieKcal: 120, sodiumMg: 0 });
    expect(built?.recordedAt).toBe(NOW.toISOString());
  });

  it('answers null when nothing was stated, which is a record to clear', () => {
    expect(buildPanelNutrition(form({ servingText: '1 slice' }), null, NOW)).toBeNull();
  });

  it('calls it the person\'s number, even when they were editing a database one', () => {
    // Once a figure is corrected it is theirs. Keeping 'fdc' on it would both
    // misreport who declared it and invite a re-fetch to overwrite the fix.
    const built = buildPanelNutrition(panelFormFrom(panel()), panel(), NOW);
    expect(built?.source).toBe('manual');
    expect(built?.sourceId).toBeNull();
  });

  it('keeps the source\'s portion table, which the form never edits', () => {
    // These are what turn "1 cookie" into a weight. Losing them to a corrected
    // calorie count costs a recipe its coverage with nothing on screen to say so.
    const built = buildPanelNutrition(panelFormFrom(panel()), panel(), NOW);
    expect(built?.portions).toEqual([{ amount: 1, label: 'cookie', grams: 15 }]);
  });

  it('drops a serving weight of zero rather than storing it', () => {
    const built = buildPanelNutrition(
      form({ servingGrams: '0', amounts: { calorieKcal: '90' } }),
      null,
      NOW,
    );
    expect(built?.servingGrams).toBeNull();
  });

  it('keeps the serving as written apart from the number to compute with', () => {
    const built = buildPanelNutrition(
      form({ servingText: ' 1 cup (240ml) ', basis: 'per100ml', amounts: { calorieKcal: '42' } }),
      null,
      NOW,
    );
    expect(built?.servingText).toBe('1 cup (240ml)');
    expect(built?.basis).toBe('per100ml');
  });
});

describe('applyLabelReading', () => {
  const reading = {
    servingText: '2 cookies (30g)',
    servingGrams: 30,
    columns: [
      { basis: 'per100g' as const, amounts: { calorieKcal: 140, fatG: 6, satFatG: 2.5 } },
      { basis: 'perServing' as const, amounts: { calorieKcal: 42, fatG: 1.8 } },
    ],
  };

  it('lays the figures it read into the form as text', () => {
    const form = applyLabelReading(emptyPanelForm(), reading);
    expect(form.amounts.calorieKcal).toBe('140');
    expect(form.amounts.fatG).toBe('6');
    expect(form.amounts.satFatG).toBe('2.5');
  });

  it('leaves a nutrient the panel did not state blank rather than zero', () => {
    // The rule the whole record is shaped around: blank is "the label didn't
    // say", and a 0 written here would be the app claiming the label did.
    const form = applyLabelReading(emptyPanelForm(), reading);
    expect(form.amounts.fiberG).toBe('');
    expect(form.amounts.sodiumMg).toBe('');
  });

  it('does not blank a figure already typed that the read did not find', () => {
    const typed = { ...emptyPanelForm() };
    typed.amounts = { ...typed.amounts, fiberG: '2.7' };
    expect(applyLabelReading(typed, reading).amounts.fiberG).toBe('2.7');
  });

  it('replaces a figure the read did find', () => {
    const typed = { ...emptyPanelForm() };
    typed.amounts = { ...typed.amounts, fatG: '99' };
    expect(applyLabelReading(typed, reading).amounts.fatG).toBe('6');
  });

  it('takes the serving line and its weight', () => {
    const form = applyLabelReading(emptyPanelForm(), reading);
    expect(form.servingText).toBe('2 cookies (30g)');
    expect(form.servingGrams).toBe('30');
  });

  it('takes the first column by default', () => {
    expect(applyLabelReading(emptyPanelForm(), reading).basis).toBe('per100g');
  });

  it('takes the column it is asked for, with that column own basis', () => {
    const form = applyLabelReading(emptyPanelForm(), reading, 1);
    expect(form.amounts.calorieKcal).toBe('42');
    expect(form.amounts.fatG).toBe('1.8');
    expect(form.basis).toBe('perServing');
  });

  it('leaves a figure the chosen column does not state as the other column left it', () => {
    // Switching columns re-lays only what the new column states, which is what
    // lets the sheet move between them without blanking the form each time.
    const first = applyLabelReading(emptyPanelForm(), reading, 0);
    expect(applyLabelReading(first, reading, 1).amounts.satFatG).toBe('2.5');
  });

  it('leaves the form untouched for a column that is not there', () => {
    const form = emptyPanelForm();
    expect(applyLabelReading(form, reading, 7)).toBe(form);
  });

  it('keeps the chosen basis when the column stated no heading', () => {
    const chosen = { ...emptyPanelForm(), basis: 'perServing' as const };
    const headless = { ...reading, columns: [{ basis: null, amounts: { fatG: 6 } }] };
    expect(applyLabelReading(chosen, headless).basis).toBe('perServing');
  });

  it('keeps a typed serving weight when the panel stated none', () => {
    const typed = { ...emptyPanelForm(), servingGrams: '45' };
    expect(applyLabelReading(typed, { ...reading, servingGrams: null }).servingGrams).toBe('45');
  });

  it('round-trips through the builder without inventing a figure', () => {
    // The two halves together are what the sheet actually does, so the
    // absent-is-not-zero rule is worth pinning across both rather than in each.
    const panel = buildPanelNutrition(applyLabelReading(emptyPanelForm(), reading), null)!;
    expect(panel.amounts).toEqual({ calorieKcal: 140, fatG: 6, satFatG: 2.5 });
    expect(panel.source).toBe('manual');
  });
});

describe('labelColumnFieldCount', () => {
  it('counts the figures a column filled in', () => {
    expect(labelColumnFieldCount({
      basis: null, amounts: { calorieKcal: 140, fatG: 6, satFatG: 2.5 },
    })).toBe(3);
  });

  it('counts a stated zero, which is a figure', () => {
    expect(labelColumnFieldCount({ basis: null, amounts: { fatG: 0 } })).toBe(1);
  });
});

describe('applyFoodNutrition', () => {
  it('lays a fetched panel\'s figures into the form as text', () => {
    const form = applyFoodNutrition(emptyPanelForm(), panel());
    expect(form.amounts.calorieKcal).toBe('480');
    expect(form.amounts.fatG).toBe('21');
    expect(form.basis).toBe('per100g');
  });

  it('leaves a nutrient the source did not state blank rather than zero', () => {
    const form = applyFoodNutrition(emptyPanelForm(), panel());
    expect(form.amounts.fiberG).toBe('');
    expect(form.amounts.sodiumMg).toBe('');
  });

  it('does not blank a figure already typed that the source did not state', () => {
    const typed = { ...emptyPanelForm() };
    typed.amounts = { ...typed.amounts, fiberG: '2.7' };
    expect(applyFoodNutrition(typed, panel()).amounts.fiberG).toBe('2.7');
  });

  it('replaces a figure the source did state', () => {
    const typed = { ...emptyPanelForm() };
    typed.amounts = { ...typed.amounts, fatG: '99' };
    expect(applyFoodNutrition(typed, panel()).amounts.fatG).toBe('21');
  });

  it('takes the serving line and its weight', () => {
    const form = applyFoodNutrition(emptyPanelForm(), panel());
    expect(form.servingText).toBe('2 cookies (30g)');
    expect(form.servingGrams).toBe('30');
  });

  it('always takes the basis, which a fetched record must state', () => {
    const chosen = { ...emptyPanelForm(), basis: 'perServing' as const };
    expect(applyFoodNutrition(chosen, panel({ basis: 'per100ml' })).basis).toBe('per100ml');
  });

  it('keeps a typed serving weight when the source stated none', () => {
    const typed = { ...emptyPanelForm(), servingGrams: '45' };
    expect(applyFoodNutrition(typed, panel({ servingGrams: null })).servingGrams).toBe('45');
  });

  it('round-trips through the builder without inventing a figure', () => {
    const built = buildPanelNutrition(applyFoodNutrition(emptyPanelForm(), panel()), null)!;
    expect(built.amounts).toEqual({ calorieKcal: 480, fatG: 21 });
    expect(built.source).toBe('manual');
  });
});

describe('foodNutritionFieldCount', () => {
  it('counts the figures a fetched panel would fill', () => {
    expect(foodNutritionFieldCount(panel())).toBe(2);
  });

  it('counts a stated zero, which is a figure', () => {
    expect(foodNutritionFieldCount(panel({ amounts: { fatG: 0 } }))).toBe(1);
  });
});
