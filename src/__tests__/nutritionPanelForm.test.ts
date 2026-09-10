import {
  buildPanelNutrition,
  emptyPanelForm,
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
