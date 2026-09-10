import {
  describeFoodLogEntry,
  describeFoodLogTotals,
  foodLogSections,
  foodLogTotals,
  nutrientContributions,
  recipeHelpingNutrition,
  resolveFoodLogDrop,
  scalePanelToAmount,
  type FoodLogListItem,
} from '../utils/foodLog';
import type { FoodLogEntry, FoodNutrition, NutrientKey } from '../types';

const NOW = new Date('2026-04-02T18:30:00.000Z');

function panel(overrides: Partial<FoodNutrition> = {}): FoodNutrition {
  return {
    basis: 'per100g',
    servingGrams: null,
    servingText: null,
    amounts: { calorieKcal: 61, proteinG: 3.2, fatG: 3.3 },
    source: 'fdc',
    sourceId: '171265',
    portions: [{ amount: 1, label: 'cup', grams: 244 }],
    recordedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

let seq = 0;
function entry(overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    dayKey: '2026-04-02',
    atISO: `2026-04-02T0${seq}:00:00.000Z`,
    slot: 'breakfast',
    label: `Food ${seq}`,
    recipeId: null,
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    quantity: '1 cup',
    grams: 244,
    nutrition: panel({ basis: 'perServing', amounts: { calorieKcal: 100, proteinG: 5 } }),
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: '2026-04-02T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => { seq = 0; });

describe('scalePanelToAmount', () => {
  it('scales a per-100g panel through the food\'s own portion table', () => {
    // A cup of milk is 244g, so the figures are 2.44 times the per-100g ones.
    const built = scalePanelToAmount(panel(), '1 cup', null, NOW);
    expect(built?.grams).toBe(244);
    expect(built?.nutrition.amounts.calorieKcal).toBeCloseTo(148.8, 1);
    expect(built?.nutrition.basis).toBe('perServing');
  });

  it('records the amount as written and the weight it resolved to, apart', () => {
    const built = scalePanelToAmount(panel(), '1 cup', null, NOW);
    expect(built?.nutrition.servingText).toBe('1 cup');
    expect(built?.nutrition.servingGrams).toBe(244);
  });

  it('refuses an amount it cannot measure rather than guessing one', () => {
    // No portion names a "handful", and there is no density to fall back on.
    // A guessed helping is a wrong calorie count with nothing to say so.
    expect(scalePanelToAmount(panel(), 'a handful', null, NOW)).toBeNull();
    expect(scalePanelToAmount(panel(), '', null, NOW)).toBeNull();
  });

  it('leaves a nutrient the food never stated absent, never zero', () => {
    const built = scalePanelToAmount(panel(), '200g', null, NOW);
    expect(built?.nutrition.amounts.calorieKcal).toBeCloseTo(122, 1);
    expect('fiberG' in (built?.nutrition.amounts ?? {})).toBe(false);
  });

  it('carries the source through, since who stated the figures is unchanged', () => {
    const built = scalePanelToAmount(panel({ source: 'manual', sourceId: null }), '200g', null, NOW);
    expect(built?.nutrition.source).toBe('manual');
  });

  it('drops the portion table, which describes the food and not the helping', () => {
    // Carrying the rows forward would invite something to scale an amount that
    // has already been scaled.
    const built = scalePanelToAmount(panel(), '200g', null, NOW);
    expect(built?.nutrition.portions).toEqual([]);
  });

  it('answers a weightless helping where the panel is per volume', () => {
    // A per-100ml panel is answered by a volume line, and nothing here knows a
    // density, so the entry is real and its weight is genuinely unknown.
    const built = scalePanelToAmount(
      panel({ basis: 'per100ml', portions: [], amounts: { calorieKcal: 42 } }),
      '250 ml',
      null,
      NOW,
    );
    expect(built?.nutrition.amounts.calorieKcal).toBeCloseTo(105, 1);
    expect(built?.grams).toBeNull();
  });
});

describe('recipeHelpingNutrition', () => {
  // What `perServing` hands back for a dish of 1200 cal across four servings.
  const perServing = { calorieKcal: 300, proteinG: 10 };

  it('takes one serving from a dish that says how many it makes', () => {
    const built = recipeHelpingNutrition(perServing, 1, 'estimated', NOW);
    expect(built?.amounts.calorieKcal).toBe(300);
    expect(built?.servingText).toBe('1 serving');
  });

  it('scales to several helpings', () => {
    const built = recipeHelpingNutrition(perServing, 2, 'estimated', NOW);
    expect(built?.amounts.calorieKcal).toBe(600);
    expect(built?.servingText).toBe('2 servings');
  });

  it('refuses a dish that never said how many servings it makes', () => {
    // That is what `perServing` answers null for, and a whole tray of lasagne
    // logged as one serving is out by a factor of six while looking entirely
    // plausible on screen.
    expect(recipeHelpingNutrition(null, 1, 'estimated', NOW)).toBeNull();
  });

  it('refuses a helping of nothing', () => {
    expect(recipeHelpingNutrition(perServing, 0, 'estimated', NOW)).toBeNull();
  });

  it('is an estimate, since a dish is built from its ingredients through a floor', () => {
    expect(recipeHelpingNutrition(perServing, 1, 'estimated', NOW)?.source).toBe('estimated');
  });
});

describe('foodLogTotals', () => {
  it('adds up what was stated and counts how many entries stated it', () => {
    const totals = foodLogTotals([
      entry({ nutrition: panel({ amounts: { calorieKcal: 100, proteinG: 5 } }) }),
      entry({ nutrition: panel({ amounts: { calorieKcal: 250, fiberG: 3 } }) }),
    ]);
    expect(totals.total.calorieKcal).toBe(350);
    expect(totals.reported.calorieKcal).toBe(2);
    expect(totals.reported.proteinG).toBe(1);
    expect(totals.entries).toBe(2);
  });

  it('never sums an absent figure as zero', () => {
    // A US label declares a short list, so a day of ordinary food has fibre on
    // some entries and not others. Adding the rest as zeroes gives a total that
    // looks like a measurement and is not one.
    const totals = foodLogTotals([
      entry({ nutrition: panel({ amounts: { calorieKcal: 100 } }) }),
      entry({ nutrition: panel({ amounts: { calorieKcal: 100 } }) }),
    ]);
    expect('fiberG' in totals.total).toBe(false);
  });

  it('answers an empty day with nothing rather than a row of zeroes', () => {
    const totals = foodLogTotals([]);
    expect(totals.total).toEqual({});
    expect(totals.entries).toBe(0);
  });
});

describe('foodLogSections', () => {
  it('reads the day in meal order, whatever order things were logged in', () => {
    const sections = foodLogSections([
      entry({ slot: 'dinner', atISO: '2026-04-02T19:00:00.000Z' }),
      entry({ slot: 'breakfast', atISO: '2026-04-02T08:00:00.000Z' }),
    ]);
    expect(sections.map(s => s.slot)).toEqual(['breakfast', 'dinner']);
  });

  it('drops a meal nothing was eaten at rather than heading an empty one', () => {
    const sections = foodLogSections([entry({ slot: 'lunch' })]);
    expect(sections).toHaveLength(1);
    expect(sections[0].slot).toBe('lunch');
  });

  it('puts what was eaten outside a meal last, and only when there is any', () => {
    const sections = foodLogSections([
      entry({ slot: null, atISO: '2026-04-02T07:00:00.000Z' }),
      entry({ slot: 'dinner', atISO: '2026-04-02T19:00:00.000Z' }),
    ]);
    expect(sections.map(s => s.slot)).toEqual(['dinner', null]);
  });

  it('orders within a meal by when it was eaten', () => {
    const sections = foodLogSections([
      entry({ slot: 'snack', label: 'Second', atISO: '2026-04-02T16:00:00.000Z' }),
      entry({ slot: 'snack', label: 'First', atISO: '2026-04-02T11:00:00.000Z' }),
    ]);
    expect(sections[0].entries.map(e => e.label)).toEqual(['First', 'Second']);
  });

  it('gives each meal its own totals', () => {
    const sections = foodLogSections([
      entry({ slot: 'breakfast', nutrition: panel({ amounts: { calorieKcal: 300 } }) }),
      entry({ slot: 'dinner', nutrition: panel({ amounts: { calorieKcal: 700 } }) }),
    ]);
    expect(sections[0].totals.total.calorieKcal).toBe(300);
    expect(sections[1].totals.total.calorieKcal).toBe(700);
  });

  it('orders a hand-dragged meal by sortOrder rather than by when it was eaten', () => {
    const sections = foodLogSections([
      entry({ slot: 'snack', label: 'Second', atISO: '2026-04-02T11:00:00.000Z', sortOrder: 2 }),
      entry({ slot: 'snack', label: 'First', atISO: '2026-04-02T16:00:00.000Z', sortOrder: 1 }),
    ]);
    expect(sections[0].entries.map(e => e.label)).toEqual(['First', 'Second']);
  });
});

describe('resolveFoodLogDrop', () => {
  it('assigns one running rank across every section, in drop order', () => {
    const a = entry({ slot: 'breakfast', label: 'A' });
    const b = entry({ slot: 'breakfast', label: 'B' });
    const c = entry({ slot: 'lunch', label: 'C' });
    const items: FoodLogListItem[] = [
      { type: 'header', slot: 'breakfast' },
      { type: 'entry', entry: a },
      { type: 'entry', entry: b },
      { type: 'add', slot: 'breakfast' },
      { type: 'header', slot: 'lunch' },
      { type: 'entry', entry: c },
      { type: 'add', slot: 'lunch' },
    ];
    const resolved = resolveFoodLogDrop(items);
    expect(resolved.map(e => [e.label, e.sortOrder])).toEqual([['A', 1], ['B', 2], ['C', 3]]);
  });

  it('re-slots an entry dragged past a header into the section it lands in', () => {
    const a = entry({ slot: 'breakfast', label: 'A' });
    const items: FoodLogListItem[] = [
      { type: 'header', slot: 'lunch' },
      { type: 'entry', entry: a },
    ];
    const resolved = resolveFoodLogDrop(items);
    expect(resolved[0].slot).toBe('lunch');
  });

  it('re-slots into the unslotted "Other" section, not just a named meal', () => {
    const a = entry({ slot: 'breakfast', label: 'A' });
    const items: FoodLogListItem[] = [
      { type: 'header', slot: null },
      { type: 'entry', entry: a },
    ];
    const resolved = resolveFoodLogDrop(items);
    expect(resolved[0].slot).toBeNull();
  });
});

describe('describeFoodLogTotals', () => {
  it('leads with calories and protein', () => {
    const totals = foodLogTotals([
      entry({ nutrition: panel({ amounts: { calorieKcal: 400, proteinG: 20 } }) }),
      entry({ nutrition: panel({ amounts: { calorieKcal: 600, proteinG: 30 } }) }),
    ]);
    expect(describeFoodLogTotals(totals)).toBe('1000 cal, 50g protein');
  });

  it('says what the figure covers whenever it is not the whole day', () => {
    // Without the clause the number reads as the day's calorie count rather
    // than as the count of what was logged and measurable.
    const totals = foodLogTotals([
      entry({ nutrition: panel({ amounts: { calorieKcal: 400, proteinG: 20 } }) }),
      entry({ nutrition: panel({ amounts: { proteinG: 30 } }) }),
    ]);
    expect(describeFoodLogTotals(totals)).toBe('400 cal, 50g protein, from 1 of 2 entries');
  });

  it('says nothing for a day with no entries', () => {
    expect(describeFoodLogTotals(foodLogTotals([]))).toBeNull();
  });

  it('says nothing when nothing it leads with was stated', () => {
    const totals = foodLogTotals([entry({ nutrition: panel({ amounts: { sodiumMg: 400 } }) })]);
    expect(describeFoodLogTotals(totals)).toBeNull();
  });
});

describe('describeFoodLogEntry', () => {
  it('says the amount and what it came to', () => {
    expect(describeFoodLogEntry(entry({
      quantity: '2 slices',
      nutrition: panel({ amounts: { calorieKcal: 260 } }),
    }))).toBe('2 slices · 260 cal');
  });

  it('marks an estimate as one, since that decides what it may be taken for', () => {
    expect(describeFoodLogEntry(entry({
      quantity: '1 serving',
      nutrition: panel({ source: 'estimated', amounts: { calorieKcal: 300 } }),
    }))).toContain('estimated');
  });

  it('does not mark a label as an estimate', () => {
    const described = describeFoodLogEntry(entry({
      nutrition: panel({ source: 'openFoodFacts', amounts: { calorieKcal: 300 } }),
    }));
    expect(described.includes('estimated')).toBe(false);
  });
});

describe('nutrientContributions', () => {
  it('pairs each entry with its stated amount, highest first', () => {
    const a = entry({ label: 'Toast', nutrition: panel({ amounts: { calorieKcal: 120 } }) });
    const b = entry({ label: 'Eggs', nutrition: panel({ amounts: { calorieKcal: 300 } }) });
    const contributions = nutrientContributions([a, b], 'calorieKcal');
    expect(contributions).toEqual([
      { entry: b, amount: 300 },
      { entry: a, amount: 120 },
    ]);
  });

  it('sorts an entry that never stated the nutrient to the bottom, not out', () => {
    const stated = entry({ label: 'Toast', nutrition: panel({ amounts: { fiberG: 2 } }) });
    const unstated = entry({ label: 'Mystery soup', nutrition: panel({ amounts: { calorieKcal: 200 } }) });
    const contributions = nutrientContributions([unstated, stated], 'fiberG');
    expect(contributions).toEqual([
      { entry: stated, amount: 2 },
      { entry: unstated, amount: null },
    ]);
  });
});

const _keyCheck: NutrientKey = 'calorieKcal';
void _keyCheck;
