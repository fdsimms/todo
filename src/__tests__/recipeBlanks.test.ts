import {
  blankFillLine,
  blankFillOf,
  describeBlank,
  describeBlankFills,
  describeBlankRule,
  fillBlank,
  isBlankFill,
  makeBlank,
  normalizeBlank,
  parseRecipeBlanks,
  recipeBlanksIn,
  shareOfBlank,
  withBlankFill,
} from '../utils/recipeBlanks';
import { entryResolution, flattenRecipeIngredients, overrideLines, parseRecipeOverrides, recipeMap } from '../utils/recipeComponents';
import type { Recipe, RecipeBlank, RecipeIngredient } from '../types';

let seq = 0;

function ing(name: string, choiceGroup: string | null = null): RecipeIngredient {
  return {
    id: `ing-${++seq}`,
    name,
    nameKey: name.toLowerCase(),
    quantity: '',
    aisle: null,
    prep: null,
    purpose: null,
    section: null,
    choiceGroup,
  };
}

function recipe(id: string, name: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    backfillDismissedFields: [],
    id,
    name,
    nameKey: name.toLowerCase(),
    notes: '',
    sourceUrl: null,
    sourceName: null,
    author: null,
    source: null,
    servings: null,
    mealType: null,
    tags: [],
    ingredients: [],
    emptySections: [],
    emptyStepSections: [],
    components: [],
    blanks: [],
    prepTasks: [],
    steps: [],
    sortOrder: ++seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    servingsMax: null,
    recipeYield: null,
    cookedWeightG: null,
    leftoverKeepDays: null, ovenTemp: null, ovenTempUnit: 'F', ovenTempStepId: null,
    imagePath: null,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    sourceType: null,
    sourcePage: null,
    cookbookId: null,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
    ...overrides,
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
    upNext: false,
    upNextOrder: 0,
  };
}

function blank(fields: Partial<RecipeBlank> = {}): RecipeBlank {
  return { id: `blank-${++seq}`, label: 'Vegetables', kind: 'vegetable', max: null, quantity: '', options: [], excluded: [], ...fields };
}

describe('normalizeBlank / parseRecipeBlanks', () => {
  it('falls back to the kind’s label when none was typed', () => {
    expect(normalizeBlank({ id: 'b', kind: 'grain', max: 1 })).toEqual({
      id: 'b', label: 'Grains & starches', kind: 'grain', max: 1, quantity: '', options: [], excluded: [],
    });
  });

  it('drops a blank with no label and no kind, and an unknown kind', () => {
    expect(normalizeBlank({ id: 'b', kind: 'snack' })).toBeNull();
    expect(normalizeBlank({ id: 'b', label: 'Crunch', kind: 'snack' })?.kind).toBeNull();
  });

  it('reads a nonsense max as "pick any" and caps a large one', () => {
    expect(normalizeBlank({ label: 'x', kind: null, max: 0 })?.max).toBeNull();
    expect(normalizeBlank({ label: 'x', kind: null, max: 2.5 })?.max).toBeNull();
    expect(normalizeBlank({ label: 'x', kind: null, max: 40 })?.max).toBe(6);
  });

  it('dedupes options by catalog key and drops blanks', () => {
    expect(normalizeBlank({ label: 'Cheese', kind: null, options: ['Feta', ' feta ', '', 'Cheddar', 7] })?.options)
      .toEqual(['Feta', 'Cheddar']);
  });

  it('keeps the never-offer list, deduped by catalog key, and reads a missing one as empty', () => {
    expect(normalizeBlank({ id: 'b', kind: 'grain', excluded: ['Baguette', 'baguette ', 7, ''] })?.excluded).toEqual(['Baguette']);
    expect(normalizeBlank({ id: 'b', kind: 'grain' })?.excluded).toEqual([]);
  });

  it('tolerates a null column and a corrupt blob', () => {
    expect(parseRecipeBlanks(null)).toEqual([]);
    expect(parseRecipeBlanks('{nope')).toEqual([]);
    expect(parseRecipeBlanks('[{"label":"Crunch","kind":"nuts"},{"kind":"bogus"}]')).toHaveLength(1);
  });

  it('makes a blank with a fresh id', () => {
    const made = makeBlank({ kind: 'protein', max: 1, quantity: '1 portion' });
    expect(made).toMatchObject({ label: 'Protein', kind: 'protein', max: 1, quantity: '1 portion' });
    expect(made?.id).toBeTruthy();
    expect(makeBlank({ kind: null, max: null })).toBeNull();
  });
});

describe('describing a blank', () => {
  it('names the rule', () => {
    expect(describeBlankRule(1)).toBe('Pick one');
    expect(describeBlankRule(2)).toBe('Pick up to 2');
    expect(describeBlankRule(null)).toBe('Pick any');
  });

  it('reads as one line', () => {
    expect(describeBlank(blank({ quantity: '2 cups' }))).toBe('2 cups · Vegetables · Pick any');
    expect(describeBlank(blank({ label: 'Grain', max: 1 }))).toBe('Grain · Pick one');
  });
});

describe('shareOfBlank', () => {
  it('splits an amount evenly', () => {
    expect(shareOfBlank('2 cups', 2)).toBe('1 cup');
    expect(shareOfBlank('2 cups', 4)).toBe('1/2 cup');
  });

  it('keeps the whole amount for one pick', () => {
    expect(shareOfBlank('a handful', 1)).toBe('a handful');
    expect(shareOfBlank(' 2 cups ', 1)).toBe('2 cups');
  });

  it('leaves an amount it can’t divide off several picks rather than repeat it on each', () => {
    expect(shareOfBlank('a handful', 3)).toBe('');
    expect(shareOfBlank('', 3)).toBe('');
  });
});

describe('filling a blank', () => {
  it('builds one line per pick under the blank’s label', () => {
    const lines = fillBlank(blank({ quantity: '2 cups' }), ['frozen peas', 'broccoli']);
    expect(lines.map(l => [l.name, l.quantity, l.section, l.nameKey])).toEqual([
      ['frozen peas', '1 cup', 'Vegetables', 'frozen peas'],
      ['broccoli', '1 cup', 'Vegetables', 'broccoli'],
    ]);
  });

  it('keeps a share changed by hand and drops a repeat', () => {
    const lines = fillBlank(blank({ quantity: '2 cups' }), ['peas', 'Peas', 'kale'], new Map([['kale', '3 cups']]));
    expect(lines.map(l => [l.name, l.quantity])).toEqual([['peas', '1 cup'], ['kale', '3 cups']]);
  });

  it('refuses a blank name', () => {
    expect(blankFillLine(blank(), '  ', '1 cup')).toBeNull();
  });

  it('carries the fill on the meal’s overrides, and an empty one takes it off', () => {
    const b = blank();
    const line = ing('peas');
    const filled = withBlankFill([{ targetId: 'x', replacement: null }], b.id, [line]);
    expect(filled).toEqual([{ targetId: 'x', replacement: null }, { targetId: b.id, replacement: null, fill: [line] }]);
    expect(blankFillOf(filled, b.id)).toEqual([line]);
    expect(isBlankFill(filled[1])).toBe(true);
    expect(isBlankFill(filled[0])).toBe(false);
    expect(withBlankFill(filled, b.id, [])).toEqual([{ targetId: 'x', replacement: null }]);
    expect(blankFillOf(undefined, b.id)).toEqual([]);
  });
});

describe('a fill through the rest of the recipe machinery', () => {
  const grain = blank({ label: 'Grain', kind: 'grain', max: 1, quantity: '1 cup' });
  const veg = blank({ quantity: '2 cups' });
  const oil = ing('olive oil');
  const sauce = recipe('sauce', 'Peanut sauce', { blanks: [blank({ label: 'Crunch', kind: 'nuts' })] });
  const bowl = recipe('bowl', 'Any Grain Bowl', {
    ingredients: [oil],
    blanks: [grain, veg],
    components: [{ id: 'c1', recipeId: 'sauce', name: 'Peanut sauce', choiceGroup: null }],
  });
  const byId = recipeMap([bowl, sauce]);
  const crunch = sauce.blanks[0];

  it('flattens to the recipe’s own lines alone while nothing fills a blank', () => {
    expect(flattenRecipeIngredients(bowl, byId).map(f => f.ingredient.name)).toEqual(['olive oil']);
  });

  it('flattens a meal’s fill after the lines of the recipe that holds the blank, at any depth', () => {
    let overrides = withBlankFill([], grain.id, fillBlank(grain, ['rice']));
    overrides = withBlankFill(overrides, veg.id, fillBlank(veg, ['peas', 'kale']));
    overrides = withBlankFill(overrides, crunch.id, fillBlank(crunch, ['walnuts']));
    const flat = flattenRecipeIngredients(bowl, byId, entryResolution({ recipeChoices: [], recipeOverrides: overrides }));
    expect(flat.map(f => [f.ingredient.name, f.ingredient.quantity, f.recipe.id, f.depth])).toEqual([
      ['olive oil', '', 'bowl', 0],
      ['walnuts', '', 'sauce', 1],
      ['rice', '1 cup', 'bowl', 0],
      ['peas', '1 cup', 'bowl', 0],
      ['kale', '1 cup', 'bowl', 0],
    ]);
  });

  it('ignores a fill aimed at a blank the recipe no longer has', () => {
    const overrides = withBlankFill([], 'gone', [ing('rice')]);
    const flat = flattenRecipeIngredients(bowl, byId, entryResolution({ recipeChoices: [], recipeOverrides: overrides }));
    expect(flat.map(f => f.ingredient.name)).toEqual(['olive oil']);
  });

  it('keeps a fill out of the "this time" sentences, which are about replaced lines', () => {
    const overrides = withBlankFill([], grain.id, fillBlank(grain, ['rice']));
    expect(overrideLines(bowl, byId, overrides)).toEqual([]);
  });

  it('round-trips a fill through the stored overrides', () => {
    const overrides = withBlankFill([{ targetId: oil.id, replacement: null }], veg.id, fillBlank(veg, ['peas']));
    const read = parseRecipeOverrides(JSON.stringify(overrides));
    expect(read).toEqual(overrides);
  });

  it('drops a stored fill whose lines all lack a name', () => {
    expect(parseRecipeOverrides(JSON.stringify([{ targetId: 'b', replacement: null, fill: [{ name: '' }] }]))).toEqual([]);
  });

  it('lists the blanks of the recipe and its parts, and says what a meal filled them with', () => {
    expect(recipeBlanksIn(bowl, byId).map(b => [b.blank.label, b.recipe.id])).toEqual([
      ['Grain', 'bowl'], ['Vegetables', 'bowl'], ['Crunch', 'sauce'],
    ]);
    let overrides = withBlankFill([], grain.id, fillBlank(grain, ['rice']));
    overrides = withBlankFill(overrides, crunch.id, fillBlank(crunch, ['walnuts']));
    expect(describeBlankFills(bowl, byId, overrides)).toBe('rice, walnuts');
    expect(describeBlankFills(bowl, byId, [])).toBeNull();
  });
});
