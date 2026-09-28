import {
  amountExample,
  amountHint,
  combineFoodNutrition,
  composeFoodAmount,
  describeFoodLogEntry,
  describeFoodLogTotals,
  EATEN_FRACTIONS,
  currentEatenFraction,
  eatenFractionPatch,
  foodLogEntryEdit,
  foodLogSections,
  foodLogTotals,
  foodUnitOptionsFor,
  isBeverageName,
  logInstantFor,
  matchMealPlanEntry,
  nutrientContributions,
  helpingNutrition,
  parseFoodAmount,
  plannedEntryForRecipe,
  portionExamples,
  recallAmount,
  recipeHelpingNutrition,
  resolveFoodLogDrop,
  savedMealCalories,
  scalePanelToAmount,
  wholeEstimate,
  type FoodLogListItem,
} from '../utils/foodLog';
import type { FoodLogEntry, FoodNutrition, MealPlanEntry, NutrientKey, SavedMealItem } from '../types';
import { packageChoices } from '../utils/scanPortion';

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

let planSeq = 0;
function planEntry(overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  planSeq += 1;
  return {
    id: `plan${planSeq}`,
    date: '2026-04-02',
    slot: 'breakfast',
    recipeId: null,
    title: `Meal ${planSeq}`,
    sortOrder: 0,
    createdAt: '2026-04-02T00:00:00.000Z',
    cookedAt: null,
    leftoverId: null,
    recipeChoices: [],
    recipeScale: 1,
    cookTask: null,
    shopTask: null,
    logMeal: null,
    calendarEventId: null,
    ...overrides,
  };
}

beforeEach(() => { seq = 0; planSeq = 0; });

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

  it('scales a per-serving panel by a typed serving count, with no portion table needed', () => {
    // A packaged product's own panel is already one serving — the same amount
    // "1 serving (80 g)" offers as a tap, just typed and fractional.
    const built = scalePanelToAmount(
      panel({
        basis: 'perServing',
        portions: [],
        servingGrams: 80,
        amounts: { calorieKcal: 200, proteinG: 10 },
      }),
      '1.5 servings',
      null,
      NOW,
    );
    expect(built?.nutrition.amounts.calorieKcal).toBeCloseTo(300, 1);
    expect(built?.nutrition.amounts.proteinG).toBeCloseTo(15, 1);
    expect(built?.grams).toBe(120);
  });

  it('refuses a typed serving count against a panel with no serving to scale by', () => {
    expect(scalePanelToAmount(panel({ basis: 'per100g', servingGrams: null }), '2 servings', null, NOW))
      .toBeNull();
  });

  describe('the beverage density fallback', () => {
    // A weight-basis panel with no stated portions and no serving weight has
    // nothing to measure a volume against — the bug this fallback exists to
    // fix (a scanned drink whose label happens to be per-100g rather than
    // per-100ml).
    const beveragePanel = () => panel({
      basis: 'per100g',
      servingGrams: null,
      portions: [],
      amounts: { calorieKcal: 20, sugarG: 5 },
    });

    it('still refuses a solid food with no name to say it is a beverage', () => {
      expect(scalePanelToAmount(beveragePanel(), '355 ml', null, NOW)).toBeNull();
    });

    it('still refuses a non-beverage food, even by name', () => {
      expect(scalePanelToAmount(beveragePanel(), '355 ml', null, NOW, 'Chicken Breast')).toBeNull();
    });

    it('approximates 1 ml as 1 g for a beverage with no density of its own', () => {
      const built = scalePanelToAmount(beveragePanel(), '355 ml', null, NOW, 'Calamansi Sparkling Water, Sanzo');
      expect(built?.approximate).toBe(true);
      expect(built?.grams).toBe(355);
      // 355 g at 20 kcal/100g.
      expect(built?.nutrition.amounts.calorieKcal).toBeCloseTo(71, 0);
    });

    it('never overrides a real answer from the food\'s own data', () => {
      // A stated cup portion measures this exactly, so the fallback must not
      // even be consulted, let alone override it.
      const built = scalePanelToAmount(
        panel({ basis: 'per100g', portions: [{ amount: 1, label: 'cup', grams: 244 }] }),
        '1 cup',
        null,
        NOW,
        'Whole Milk',
      );
      expect(built?.approximate).toBe(false);
      expect(built?.grams).toBe(244);
    });

    it('does not apply to a per-100ml panel, which already measures volume directly', () => {
      const built = scalePanelToAmount(
        panel({ basis: 'per100ml', portions: [], amounts: { calorieKcal: 42 } }),
        '250 ml',
        null,
        NOW,
        'Cola',
      );
      expect(built?.approximate).toBe(false);
    });
  });
});

describe('isBeverageName', () => {
  it('reads a name off the grocery aisle lexicon', () => {
    expect(isBeverageName('Calamansi Sparkling Water, Sanzo')).toBe(true);
    expect(isBeverageName('Orange Juice')).toBe(true);
    expect(isBeverageName('Chicken Breast')).toBe(false);
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

describe('helpingNutrition', () => {
  it('records what the helping weighed, when the helping knows', () => {
    // A weighed plate arrives with its amounts already worked out against the
    // whole dish, and the grams it was measured as are what it is.
    const built = helpingNutrition({ calorieKcal: 300 }, '250 g', 250, 'estimated', NOW);
    expect(built?.servingGrams).toBe(250);
    expect(built?.servingText).toBe('250 g');
    expect(built?.basis).toBe('perServing');
  });

  it('leaves the weight absent when nothing says what the helping weighed', () => {
    expect(helpingNutrition({ calorieKcal: 300 }, '1 serving', null, 'estimated', NOW)?.servingGrams)
      .toBeNull();
  });

  it('refuses a helping with no figures at all', () => {
    expect(helpingNutrition({}, '250 g', 250, 'estimated', NOW)).toBeNull();
  });
});

describe('combineFoodNutrition', () => {
  const dish = panel({ basis: 'perServing', servingGrams: null, servingText: '1 serving', amounts: { calorieKcal: 300, proteinG: 10 } });

  it('returns the base panel unchanged when there is nothing to fold in', () => {
    expect(combineFoodNutrition(dish, [], NOW)).toBe(dish);
  });

  it('sums a key both sides state', () => {
    const extra = panel({ basis: 'perServing', amounts: { calorieKcal: 45 } });
    const combined = combineFoodNutrition(dish, [{ nutrition: extra }], NOW);
    expect(combined.amounts.calorieKcal).toBe(345);
  });

  it('keeps a key only one side states, rather than treating the other as zero', () => {
    // The dish states no fibre; the baguette's own panel does. Dropping it
    // because the dish didn't state it would be a silent-zero, the exact
    // mistake FoodNutrition.amounts is built to avoid.
    const extra = panel({ basis: 'perServing', amounts: { fiberG: 2 } });
    const combined = combineFoodNutrition(dish, [{ nutrition: extra }], NOW);
    expect(combined.amounts.calorieKcal).toBe(300);
    expect(combined.amounts.fiberG).toBe(2);
  });

  it('carries no single weight or provenance once more than one food is involved', () => {
    const extra = panel({ basis: 'perServing', amounts: { calorieKcal: 45 } });
    const combined = combineFoodNutrition(dish, [{ nutrition: extra }], NOW);
    expect(combined.servingGrams).toBeNull();
    expect(combined.source).toBe('estimated');
  });

  it('sums across more than one extra', () => {
    const a = panel({ basis: 'perServing', amounts: { calorieKcal: 45 } });
    const b = panel({ basis: 'perServing', amounts: { calorieKcal: 12 } });
    const combined = combineFoodNutrition(dish, [{ nutrition: a }, { nutrition: b }], NOW);
    expect(combined.amounts.calorieKcal).toBe(357);
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

function savedItem(overrides: Partial<SavedMealItem> = {}): SavedMealItem {
  return {
    label: 'Milk',
    recipeId: null,
    itemId: null,
    productId: null,
    quantity: '1 cup',
    grams: 244,
    nutrition: panel({ basis: 'perServing', amounts: { calorieKcal: 100 } }),
    ...overrides,
  };
}

describe('savedMealCalories', () => {
  it('adds up what each item states', () => {
    const total = savedMealCalories([
      savedItem({ nutrition: panel({ amounts: { calorieKcal: 100 } }) }),
      savedItem({ nutrition: panel({ amounts: { calorieKcal: 250 } }) }),
    ]);
    expect(total).toBe(350);
  });

  it('answers null rather than zero when nothing in it states calories', () => {
    const total = savedMealCalories([
      savedItem({ nutrition: panel({ amounts: { proteinG: 5 } }) }),
    ]);
    expect(total).toBeNull();
  });

  it('answers null for an empty meal', () => {
    expect(savedMealCalories([])).toBeNull();
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
      { type: 'header', slot: 'lunch' },
      { type: 'entry', entry: c },
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

  // A drop into gap 0 is above the first header, which is a real drop target
  // the list offers. Seeded from null it re-filed the entry as unslotted, and
  // since the loose run renders last, a row dragged to the very top of
  // breakfast reappeared at the bottom of the day.
  it('keeps an entry dropped above every header in the first section', () => {
    const a = entry({ slot: 'lunch', label: 'A' });
    const b = entry({ slot: 'breakfast', label: 'B' });
    const items: FoodLogListItem[] = [
      { type: 'entry', entry: a },
      { type: 'header', slot: 'breakfast' },
      { type: 'entry', entry: b },
    ];
    const resolved = resolveFoodLogDrop(items);
    expect(resolved.map(e => [e.label, e.slot])).toEqual([['A', 'breakfast'], ['B', 'breakfast']]);
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
      nutrition: panel({ source: 'fdc', amounts: { calorieKcal: 260 } }),
    }))).toBe('2 slices · 260 cal · from a database');
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

  // The row is the only place these four can be told apart, so naming one of
  // them left a transcription off a jar reading exactly like a manufacturer's
  // declared label.
  it('names every provenance, not only the estimate', () => {
    const described = (source: FoodNutrition['source']) => describeFoodLogEntry(entry({
      quantity: '1 cup',
      nutrition: panel({ source, amounts: { calorieKcal: 300 } }),
    }));
    expect(described('openFoodFacts')).toContain('from the label');
    expect(described('fdc')).toContain('from a database');
    expect(described('manual')).toContain('typed in');
    expect(described('estimated')).toContain('estimated');
  });

  it('takes the words a row would rather show in place of the stored ones', () => {
    const water = entry({
      quantity: '1.89 L',
      nutrition: panel({ source: 'manual', amounts: { waterMl: 1893 } }),
    });
    expect(describeFoodLogEntry(water, '64 fl oz')).toBe('64 fl oz · typed in');
    expect(describeFoodLogEntry(water)).toBe('1.89 L · typed in');
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

describe('matchMealPlanEntry', () => {
  it('matches on a shared recipeId when it names exactly one candidate', () => {
    const dinner = planEntry({ slot: 'dinner', recipeId: 'r1' });
    const lunch = planEntry({ slot: 'lunch', recipeId: 'r2' });
    const match = matchMealPlanEntry([dinner, lunch], new Set(), { slot: null, recipeId: 'r1' });
    expect(match).toBe(dinner);
  });

  it('refuses a recipeId shared by two candidates rather than guessing', () => {
    // The same dish cooked twice in one day (leftovers for lunch too) — no
    // way to tell which one a log with no other signal belongs to.
    const first = planEntry({ slot: 'dinner', recipeId: 'r1' });
    const second = planEntry({ slot: 'lunch', recipeId: 'r1' });
    expect(matchMealPlanEntry([first, second], new Set(), { slot: null, recipeId: 'r1' })).toBeNull();
  });

  it('falls back to slot when there is no recipeId to go on', () => {
    const breakfast = planEntry({ slot: 'breakfast' });
    const dinner = planEntry({ slot: 'dinner' });
    const match = matchMealPlanEntry([breakfast, dinner], new Set(), { slot: 'dinner', recipeId: null });
    expect(match).toBe(dinner);
  });

  it('refuses a slot with more than one candidate', () => {
    // Chicken and a salad both planned for dinner (#1461's "two things on
    // one dinner is real") — slot alone can't say which was logged.
    const chicken = planEntry({ slot: 'dinner' });
    const salad = planEntry({ slot: 'dinner' });
    expect(matchMealPlanEntry([chicken, salad], new Set(), { slot: 'dinner', recipeId: null })).toBeNull();
  });

  it('never matches a slot of null — the sheet\'s own "no meal" answer', () => {
    const dinner = planEntry({ slot: 'dinner' });
    expect(matchMealPlanEntry([dinner], new Set(), { slot: null, recipeId: null })).toBeNull();
  });

  it('excludes a candidate another food log entry already claims', () => {
    const dinner = planEntry({ slot: 'dinner' });
    const match = matchMealPlanEntry([dinner], new Set([dinner.id]), { slot: 'dinner', recipeId: null });
    expect(match).toBeNull();
  });

  it('returns null against an empty plan', () => {
    expect(matchMealPlanEntry([], new Set(), { slot: 'dinner', recipeId: 'r1' })).toBeNull();
  });
});

describe('plannedEntryForRecipe', () => {
  // The recipe page's log button: tonight's chili, logged from the page, has
  // to cover tonight's planned chili or the Eat step asks again.
  it('links the one planned entry for the recipe, whatever slot it is in', () => {
    const lunch = planEntry({ slot: 'lunch', recipeId: 'r-salad' });
    const dinner = planEntry({ slot: 'dinner', recipeId: 'r-chili' });
    expect(plannedEntryForRecipe([lunch, dinner], [], 'r-chili')).toBe(dinner);
  });

  it('skips an entry a food log row already claims', () => {
    const dinner = planEntry({ slot: 'dinner', recipeId: 'r-chili' });
    const logged = entry({ slot: 'dinner', recipeId: 'r-chili', mealPlanEntryId: dinner.id });
    expect(plannedEntryForRecipe([dinner], [logged], 'r-chili')).toBeNull();
  });

  it('refuses a recipe planned twice that day rather than guessing', () => {
    const lunch = planEntry({ slot: 'lunch', recipeId: 'r-chili' });
    const dinner = planEntry({ slot: 'dinner', recipeId: 'r-chili' });
    expect(plannedEntryForRecipe([lunch, dinner], [], 'r-chili')).toBeNull();
  });

  it('takes the other one when the first of two is already logged', () => {
    const lunch = planEntry({ slot: 'lunch', recipeId: 'r-chili' });
    const dinner = planEntry({ slot: 'dinner', recipeId: 'r-chili' });
    const logged = entry({ slot: 'lunch', recipeId: 'r-chili', mealPlanEntryId: lunch.id });
    expect(plannedEntryForRecipe([lunch, dinner], [logged], 'r-chili')).toBe(dinner);
  });

  it('never falls back to a slot, since the page names no meal', () => {
    const dinner = planEntry({ slot: 'dinner', recipeId: 'r-other' });
    expect(plannedEntryForRecipe([dinner], [], 'r-chili')).toBeNull();
  });
});

describe('foodLogEntryEdit', () => {
  it('reopens a catalog food on the amount it was logged with', () => {
    const row = entry({ itemId: 'item-milk', quantity: '1 cup' });
    expect(foodLogEntryEdit(row)).toEqual({ amount: '1 cup', dishMeasure: null });
  });

  it('prefers the helping\'s own text over the entry\'s quantity', () => {
    // `quantity` is what the row renders and the helping is what was measured.
    // They match for every food today, so the helping is the one to trust.
    const row = entry({
      itemId: 'item-milk',
      quantity: 'one cup-ish',
      nutrition: panel({ basis: 'perServing', servingText: '1 cup' }),
    });
    expect(foodLogEntryEdit(row)?.amount).toBe('1 cup');
  });

  it('reopens a box on its own row', () => {
    const row = entry({ itemId: 'item-bread', productId: 'prod-sourdough', quantity: '2 slices' });
    expect(foodLogEntryEdit(row)).toEqual({ amount: '2 slices', dishMeasure: null });
  });

  it('reopens a scanned whole package on its serving count, which re-measures', () => {
    const label = packageChoices(panel({ basis: 'per100g', servingGrams: 45 }), '450 g')
      .find(c => c.key === 'package')!.label;
    const row = entry({
      productId: 'prod-1',
      quantity: label,
      nutrition: panel({ basis: 'per100g', servingGrams: 45, servingText: label }),
    });
    expect(foodLogEntryEdit(row)).toEqual({ amount: '10 servings', dishMeasure: null });
    expect(scalePanelToAmount(panel({ basis: 'per100g', servingGrams: 45 }), '10 servings', null, NOW)).not.toBeNull();
  });

  it('refuses an entry with no link, since there is no panel left to measure against', () => {
    // A described meal the model estimated, or a database food logged before
    // entries kept their panel.
    expect(foodLogEntryEdit(entry({ quantity: 'a bowl of ramen' }))).toBeNull();
  });

  it('reopens an unfiled database food on the panel it kept (#2914)', () => {
    // Logged as 200 g of a database's chicken, never filed. The per-100 g panel
    // rode onto the entry, so the amount can be re-measured against it.
    const kept = panel({ amounts: { calorieKcal: 165, proteinG: 31 }, portions: [] });
    const helping = scalePanelToAmount(kept, '200 g', null, NOW)!;
    const row = entry({ quantity: '200 g', grams: 200, nutrition: helping.nutrition, sourcePanel: kept });
    const plan = foodLogEntryEdit(row);
    expect(plan).toEqual({ amount: '200 g', dishMeasure: null });
    // And the correction measures against the kept panel exactly as the
    // original did, rather than multiplying the stored helping.
    const corrected = scalePanelToAmount(kept, '170 g', null, NOW)!;
    expect(corrected.nutrition.amounts.calorieKcal).toBe(280.5);
    expect(corrected.grams).toBe(170);
  });

  it('still refuses an unlinked entry whose kept panel is absent or null', () => {
    expect(foodLogEntryEdit(entry({ quantity: '200 g', sourcePanel: null }))).toBeNull();
    expect(foodLogEntryEdit(entry({ quantity: '200 g', sourcePanel: undefined }))).toBeNull();
  });

  it('refuses an entry carrying answered "Anything else?" lines', () => {
    // What was typed against each line isn't stored, only its name, so
    // reopening would show them blank and a save would drop them.
    const row = entry({ recipeId: 'r1', quantity: '2 servings, plus baguette' });
    expect(foodLogEntryEdit(row)).toBeNull();
  });

  it('refuses an entry with no amount recorded at all', () => {
    const row = entry({ itemId: 'item-milk', quantity: '  ' });
    expect(foodLogEntryEdit(row)).toBeNull();
  });

  it('reads a dish logged in servings back to a number', () => {
    const row = entry({
      recipeId: 'r1',
      quantity: '2 servings',
      nutrition: panel({ basis: 'perServing', servingText: '2 servings' }),
    });
    expect(foodLogEntryEdit(row)).toEqual({ amount: '2', dishMeasure: 'servings' });
  });

  it('reads the singular serving too', () => {
    const row = entry({ recipeId: 'r1', quantity: '1 serving' });
    expect(foodLogEntryEdit(row)).toEqual({ amount: '1', dishMeasure: 'servings' });
  });

  it('reads a weighed plate back as grams', () => {
    const row = entry({ recipeId: 'r1', quantity: '320 g' });
    expect(foodLogEntryEdit(row)).toEqual({ amount: '320', dishMeasure: 'weight' });
  });

  it('reads the phrasings an unserved dish uses instead of a servings count', () => {
    // `describeHelping` writes these for a dish with no servings count. The
    // amount field only ever held a number, so that is what comes back.
    const whole = entry({ recipeId: 'r1', quantity: 'the whole dish' });
    const half = entry({ recipeId: 'r1', quantity: 'half the dish' });
    const part = entry({ recipeId: 'r1', quantity: '1.5 of the dish' });
    expect(foodLogEntryEdit(whole)).toEqual({ amount: '1', dishMeasure: 'servings' });
    expect(foodLogEntryEdit(half)).toEqual({ amount: '0.5', dishMeasure: 'servings' });
    expect(foodLogEntryEdit(part)).toEqual({ amount: '1.5', dishMeasure: 'servings' });
  });

  it('refuses a dish whose helping does not parse', () => {
    expect(foodLogEntryEdit(entry({ recipeId: 'r1', quantity: 'a big plate' }))).toBeNull();
  });
});

describe('fraction eaten (#2914)', () => {
  // The seeded "Five Guys" estimate's shape: a described meal, linked to
  // nothing, stating a short list and no weight.
  const burger = () => entry({
    label: 'Cheeseburger and fries',
    quantity: '1 burger and a regular fries',
    grams: null,
    nutrition: {
      basis: 'perServing',
      servingGrams: null,
      servingText: '1 burger and a regular fries',
      amounts: { calorieKcal: 1250, proteinG: 45, fatG: 68, sodiumMg: 1470 },
      source: 'estimated',
      sourceId: null,
      portions: [],
      recordedAt: '2026-04-02T13:00:00.000Z',
    },
  });

  /** The entry as `reviseEntry` would leave it after a patch. */
  const applied = (row: FoodLogEntry, fraction: number): FoodLogEntry => {
    const patch = eatenFractionPatch(row, fraction)!;
    return { ...row, ...patch };
  };

  it('offers a share only for an estimate linked to nothing', () => {
    expect(wholeEstimate(burger())).not.toBeNull();
    // Linked: corrected by re-measuring against its row instead.
    expect(wholeEstimate({ ...burger(), itemId: 'item-a' })).toBeNull();
    expect(wholeEstimate({ ...burger(), recipeId: 'r1' })).toBeNull();
    // Not an estimate: a database food that kept its panel is re-measured,
    // and one that didn't claims figures a share would still be a guess at.
    expect(wholeEstimate(entry({ nutrition: panel({ basis: 'perServing' }) }))).toBeNull();
  });

  it('takes a share of every stated figure, and states nothing the estimate did not', () => {
    const patch = eatenFractionPatch(burger(), 2 / 3)!;
    expect(patch.nutrition.amounts).toEqual({ calorieKcal: 833.3, proteinG: 30, fatG: 45.3, sodiumMg: 980 });
    expect(patch.nutrition.source).toBe('estimated');
    expect(patch.nutrition.basis).toBe('perServing');
    // Stamped when the model estimated it, not when the share was chosen.
    expect(patch.nutrition.recordedAt).toBe('2026-04-02T13:00:00.000Z');
    expect(patch.quantity).toBe('two-thirds of 1 burger and a regular fries');
    expect(patch.nutrition.servingText).toBe(patch.quantity);
    expect(patch.grams).toBeNull();
  });

  it('keeps the whole meal, so a second share is of the whole rather than of the first', () => {
    const halved = applied(burger(), 1 / 2);
    expect(halved.sourcePanel?.amounts.calorieKcal).toBe(1250);
    expect(halved.nutrition.amounts.calorieKcal).toBe(625);

    const threeQuarters = applied(halved, 3 / 4);
    // Three-quarters of the meal, not three-eighths of it.
    expect(threeQuarters.nutrition.amounts.calorieKcal).toBe(937.5);
    expect(threeQuarters.quantity).toBe('three-quarters of 1 burger and a regular fries');
  });

  it('puts the entry back exactly as logged when All is chosen', () => {
    const original = burger();
    const restored = applied(applied(original, 1 / 3), 1);
    expect(restored.nutrition.amounts).toEqual(original.nutrition.amounts);
    expect(restored.quantity).toBe(original.quantity);
  });

  it('refuses a share of nothing, or more than the whole', () => {
    expect(eatenFractionPatch(burger(), 0)).toBeNull();
    expect(eatenFractionPatch(burger(), -0.5)).toBeNull();
    expect(eatenFractionPatch(burger(), 1.5)).toBeNull();
    expect(eatenFractionPatch(burger(), Number.NaN)).toBeNull();
    expect(eatenFractionPatch({ ...burger(), itemId: 'item-a' }, 0.5)).toBeNull();
  });

  it('scales a weight the estimate carried, and says the share alone when it had no words', () => {
    const weighed = { ...burger(), quantity: '', grams: 400, nutrition: { ...burger().nutrition, servingText: null } };
    const patch = eatenFractionPatch(weighed, 1 / 4)!;
    expect(patch.grams).toBe(100);
    expect(patch.nutrition.servingGrams).toBe(100);
    expect(patch.quantity).toBe('a quarter');
  });

  it('is not offered the editor once a share has been kept', () => {
    // The kept whole is an estimate, which has no amounts to re-measure.
    expect(foodLogEntryEdit(applied(burger(), 1 / 2))).toBeNull();
  });

  it('reads back which share an entry stands at', () => {
    expect(currentEatenFraction(burger())).toBe(1);
    expect(currentEatenFraction(applied(burger(), 1 / 3))).toBe(1 / 3);
    expect(currentEatenFraction(applied(applied(burger(), 1 / 3), 1))).toBe(1);
    expect(currentEatenFraction(entry({ itemId: 'item-a' }))).toBeNull();
  });

  it('reads an estimate of nothing but zeros as the whole rather than a quarter', () => {
    const water = { ...burger(), nutrition: { ...burger().nutrition, amounts: { calorieKcal: 0 } } };
    expect(currentEatenFraction(water)).toBe(1);
  });

  it('offers the shares smallest first, ending on the whole', () => {
    const values = EATEN_FRACTIONS.map(f => f.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values[values.length - 1]).toBe(1);
    expect(values.every(v => v > 0 && v <= 1)).toBe(true);
  });
});

describe('portionExamples', () => {
  it('lists the food\'s own stated portions, up to the limit', () => {
    expect(portionExamples(panel())).toEqual(['1 cup']);
    expect(portionExamples(panel({ portions: [] }))).toEqual([]);
  });
});

describe('amountHint / amountExample', () => {
  it('says a weight and the food\'s own portions, for a per-100g panel', () => {
    expect(amountHint(panel())).toBe(
      'A weight (like 100g), or one of this food\'s stated portions: 1 cup.',
    );
    expect(amountExample(panel())).toBe('1 cup');
  });

  it('falls back to a plain weight when there are no stated portions', () => {
    expect(amountHint(panel({ portions: [] }))).toBe(
      'A weight, like 100g. This food has no stated portions.',
    );
    expect(amountExample(panel({ portions: [] }))).toBe('100g');
  });

  it('never suggests a weight for a per-100ml drink, which panelMultiplier refuses', () => {
    expect(amountHint(panel({ basis: 'per100ml', portions: [] })))
      .toBe('A volume, like 250 ml or 1 cup.');
    expect(amountExample(panel({ basis: 'per100ml', portions: [] }))).toBe('250ml');
  });

  it('mentions servings too, once a per-100ml panel states a serving weight', () => {
    expect(amountHint(panel({ basis: 'per100ml', servingGrams: 240, portions: [] })))
      .toBe('A volume, like 250 ml or 1 cup, or a number of servings.');
  });

  it('asks for a serving count from a perServing panel with no serving weight', () => {
    expect(amountHint(panel({ basis: 'perServing', servingGrams: null, portions: [] })))
      .toBe('A number of servings, like 1 serving. This food states no weight per serving to measure anything else against.');
    expect(amountExample(panel({ basis: 'perServing', servingGrams: null, portions: [] })))
      .toBe('1 serving');
  });

  it('falls back to a weight for a perServing panel that does state its serving weight', () => {
    expect(amountHint(panel({ basis: 'perServing', servingGrams: 30, portions: [] })))
      .toBe('A weight, like 100g. This food has no stated portions.');
  });

  it('mentions servings too, once a per-100g panel states a serving weight', () => {
    expect(amountHint(panel({ servingGrams: 25 }))).toBe(
      'A weight (like 100g), or one of this food\'s stated portions: 1 cup, or a number of servings.',
    );
    expect(amountHint(panel({ servingGrams: 25, portions: [] }))).toBe(
      'A weight, like 100g, or a number of servings.',
    );
  });
});

describe('foodUnitOptionsFor', () => {
  it('offers the food\'s own portions, plus grams, for a per-100g panel', () => {
    expect(foodUnitOptionsFor(panel())).toEqual([
      { key: 'cup', label: 'cup', suffix: ' cup' },
      { key: 'g', label: 'g', suffix: 'g' },
    ]);
  });

  it('offers grams and a serving pill for a perServing panel with a known weight', () => {
    expect(foodUnitOptionsFor(panel({ basis: 'perServing', servingGrams: 30, portions: [] }))).toEqual([
      { key: 'g', label: 'g', suffix: 'g' },
      { key: 'serving', label: 'serving', suffix: ' serving' },
    ]);
  });

  it('offers only a serving pill for a perServing panel with no stated weight', () => {
    expect(foodUnitOptionsFor(panel({ basis: 'perServing', servingGrams: null, portions: [] }))).toEqual([
      { key: 'serving', label: 'serving', suffix: ' serving' },
    ]);
  });

  it('offers a serving pill for a per-100g panel that also states a serving weight', () => {
    expect(foodUnitOptionsFor(panel({ servingGrams: 25 }))).toEqual([
      { key: 'cup', label: 'cup', suffix: ' cup' },
      { key: 'g', label: 'g', suffix: 'g' },
      { key: 'serving', label: 'serving', suffix: ' serving' },
    ]);
  });

  it('offers the fixed volume units for a per-100ml panel, since unitConvert resolves any of them', () => {
    expect(foodUnitOptionsFor(panel({ basis: 'per100ml', portions: [] }))).toEqual([
      { key: 'cup', label: 'cup', suffix: ' cup' },
      { key: 'tbsp', label: 'tbsp', suffix: ' tbsp' },
      { key: 'tsp', label: 'tsp', suffix: ' tsp' },
      { key: 'fl oz', label: 'fl oz', suffix: ' fl oz' },
      { key: 'ml', label: 'ml', suffix: ' ml' },
    ]);
  });

  it('does not duplicate a volume unit the panel already states as a portion', () => {
    const options = foodUnitOptionsFor(panel({ basis: 'per100ml', portions: [{ amount: 1, label: 'cup', grams: 240 }] }));
    expect(options.filter(o => o.key === 'cup')).toHaveLength(1);
  });
});

describe('composeFoodAmount / parseFoodAmount', () => {
  const options = foodUnitOptionsFor(panel({ basis: 'per100ml', portions: [] }));

  it('composes a typed number and a unit into the amount text the panel reads', () => {
    expect(composeFoodAmount('1.5', options.find(o => o.key === 'cup'))).toBe('1.5 cup');
    expect(composeFoodAmount('', options.find(o => o.key === 'cup'))).toBe('');
    expect(composeFoodAmount('1.5', undefined)).toBe('');
  });

  it('parses a composed amount back into its number and unit key', () => {
    expect(parseFoodAmount('1.5 cup', options)).toEqual({ number: '1.5', unitKey: 'cup' });
    expect(parseFoodAmount('250 ml', options)).toEqual({ number: '250', unitKey: 'ml' });
  });

  it('refuses an amount shaped nothing like what these sheets write', () => {
    expect(parseFoodAmount('a splash', options)).toBeNull();
    expect(parseFoodAmount('1 lemon', options)).toBeNull();
  });
});

describe('recallAmount', () => {
  const yogurt = panel({ portions: [{ amount: 1, label: 'cup', grams: 245 }] });

  it('opens a food on its last amount, split into the unit pill and the number', () => {
    expect(recallAmount({ amount: '250g', dishMeasure: null }, { kind: 'food', panel: yogurt, name: 'Greek yogurt' }))
      .toEqual({ amount: '250g', unitKey: 'g', number: '250', dishMeasure: null });
    expect(recallAmount({ amount: '1.5 cup', dishMeasure: null }, { kind: 'food', panel: yogurt, name: 'Greek yogurt' }))
      .toEqual({ amount: '1.5 cup', unitKey: 'cup', number: '1.5', dishMeasure: null });
  });

  it('recalls nothing for a food that was never logged', () => {
    expect(recallAmount(undefined, { kind: 'food', panel: yogurt, name: 'Greek yogurt' })).toBeNull();
    expect(recallAmount(null, { kind: 'food', panel: yogurt, name: 'Greek yogurt' })).toBeNull();
  });

  it('falls back to the default when the unit it was logged in is gone from the panel', () => {
    // Logged as "2 cup" against a panel that has since been replaced by one
    // stating no cup. A pre-filled amount Save then refuses is worse than an
    // empty field.
    const noCup = panel({ portions: [] });
    expect(recallAmount({ amount: '2 cup', dishMeasure: null }, { kind: 'food', panel: noCup, name: 'Greek yogurt' }))
      .toBeNull();
  });

  it('opens an amount that resolves but is not one of the pills on "Something else", text intact', () => {
    const bread = panel({ portions: [{ amount: 1, label: 'slice', grams: 30 }] });
    const recalled = recallAmount({ amount: '1/2 slice', dishMeasure: null }, { kind: 'food', panel: bread, name: 'Bread' });
    expect(recalled).toEqual({ amount: '1/2 slice', unitKey: 'other', number: '', dishMeasure: null });
    expect(scalePanelToAmount(bread, '1/2 slice', null, NOW)).not.toBeNull();
  });

  it('puts a whole-package scan back on the serving pill it re-measures by', () => {
    // `foodLogEntryEdit` reads "The whole package (2 servings)" as "2 servings".
    const stated = panel({ basis: 'perServing', servingGrams: null, portions: [] });
    expect(recallAmount({ amount: '2 servings', dishMeasure: null }, { kind: 'food', panel: stated, name: null }))
      .toEqual({ amount: '2 serving', unitKey: 'serving', number: '2', dishMeasure: null });
  });

  it('refuses a dish amount for a food, and a food amount for a dish', () => {
    expect(recallAmount({ amount: '2', dishMeasure: 'servings' }, { kind: 'food', panel: yogurt, name: null })).toBeNull();
    expect(recallAmount({ amount: '1 cup', dishMeasure: null }, { kind: 'dish', weighed: true, served: true })).toBeNull();
  });

  it('opens a dish on the measure and number it was last logged in', () => {
    expect(recallAmount({ amount: '320', dishMeasure: 'weight' }, { kind: 'dish', weighed: true, served: true }))
      .toEqual({ amount: '320', unitKey: null, number: '', dishMeasure: 'weight' });
    expect(recallAmount({ amount: '0.5', dishMeasure: 'servings' }, { kind: 'dish', weighed: false, served: true }))
      .toEqual({ amount: '0.5', unitKey: null, number: '', dishMeasure: 'servings' });
  });

  it('falls back when the dish can no longer answer the measure it was logged in', () => {
    // A plate weighed against a dish nobody has weighed since, or servings of
    // one that no longer says how many it makes.
    expect(recallAmount({ amount: '320', dishMeasure: 'weight' }, { kind: 'dish', weighed: false, served: true })).toBeNull();
    expect(recallAmount({ amount: '2', dishMeasure: 'servings' }, { kind: 'dish', weighed: true, served: false })).toBeNull();
  });
});

const _keyCheck: NutrientKey = 'calorieKcal';
void _keyCheck;

describe('logInstantFor', () => {
  const now = new Date(2026, 8, 27, 19, 42);

  it('stamps the logical today with the real moment', () => {
    // A dinner logged from the after-meal prompt used to reach Health as noon.
    expect(logInstantFor('2026-09-27', '2026-09-27', now).getTime()).toBe(now.getTime());
  });

  it('keeps the real moment in the grace window, when the calendar date has moved on', () => {
    // 1:30 AM on the 28th under a 3 AM reset is still the logical 27th; the
    // entry keeps its real instant and addEntry keys it back onto the 27th.
    const small = new Date(2026, 8, 28, 1, 30);
    expect(logInstantFor('2026-09-27', '2026-09-27', small).getTime()).toBe(small.getTime());
  });

  it('stamps any other day at noon on that day', () => {
    const at = logInstantFor('2026-09-25', '2026-09-27', now);
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()])
      .toEqual([2026, 8, 25, 12, 0]);
  });

  it('hands back a copy, never the clock it was given', () => {
    const at = logInstantFor('2026-09-27', '2026-09-27', now);
    at.setHours(0);
    expect(now.getHours()).toBe(19);
  });
});
