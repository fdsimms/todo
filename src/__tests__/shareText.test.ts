import type { GroceryItem, MealPlanEntry, MealSlot, Recipe, RecipeComponent, RecipeIngredient } from '../types';
import {
  buildGroceryListShareText, buildGroceryListText, buildIngredientsText, buildRecipeShareText,
  buildWeekPlanShareText,
} from '../utils/shareText';

// shareText reaches recipeUtils.ts (for describeAttribution/formatServings)
// and mealPlan.ts directly, both of which reach dateUtils.ts → the settings
// store — which nothing here needs. Same mock as recipeUtils.test.ts and
// mealPlanGroceries.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;

function ing(name: string, overrides: Partial<RecipeIngredient> = {}): RecipeIngredient {
  return {
    id: `ing-${++seq}`,
    name,
    nameKey: name.toLowerCase(),
    quantity: '',
    aisle: null,
    prep: null,
    purpose: null,
    section: null,
    choiceGroup: null,
    ...overrides,
  };
}

function link(recipeId: string, name: string): RecipeComponent {
  return { id: `c-${++seq}`, recipeId, name, choiceGroup: null };
}

function recipe(id: string, name: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id,
    name,
    nameKey: name.toLowerCase(),
    notes: '',
    sourceUrl: null,
    sourceName: null,
    author: null,
    source: null,
    sourceType: null,
    sourcePage: null,
    cookbookId: null,
    servings: null,
    servingsMax: null,
    recipeYield: null,
    leftoverKeepDays: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients: [],
    emptySections: [],
    components: [],
    prepTasks: [],
    steps: [],
    sortOrder: ++seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
    ...overrides,
  };
}

function item(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: `i-${++seq}`, name, nameKey: name.toLowerCase(), preferredProductId: null, productStrict: false,
    aisle: 'Other', quantity: null, quantityFromRecipe: false, note: '',
    onList: true, checked: false, sortOrder: seq, purchaseCount: 0,
    lastAddedAt: null, lastPurchasedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null, sourceRecipeId: null, sourceRecipeTitle: null, choiceGroup: null,
    isStaple: false, expiresAt: null, frozenAt: null, openedAt: null, runningLowAt: null, shelfLifeDays: null, useUpTask: null, pantryCheckDeclinedAt: null, usedUpCount: 0, spoiledCount: 0, lastSpoiledAt: null, varietyOfKey: null, backfillDismissedFields: [], lastPriceMinor: null,
    lastPricedAt: null, lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  };
}

function recipeMap(recipes: Recipe[]): Map<string, Recipe> {
  return new Map(recipes.map(r => [r.id, r]));
}

describe('buildRecipeShareText', () => {
  it('opens with the name, then servings and time', () => {
    const r = recipe('r1', 'Chili', {
      servings: 4, servingsMax: 6, estimatedMinutes: 45, prepMinutes: 15,
      ingredients: [ing('Beans', { quantity: '2 cans' })],
    });
    const text = buildRecipeShareText(r, recipeMap([r]));
    const lines = text.split('\n');
    expect(lines[0]).toBe('Chili');
    expect(lines[1]).toBe('Serves 4-6 · 1h');
  });

  it('lists every ingredient, scaled and converted to match the screen', () => {
    const r = recipe('r1', 'Pancakes', {
      ingredients: [ing('Flour', { quantity: '1 lb' }), ing('Salt', { quantity: '1/2 tsp' })],
    });
    const text = buildRecipeShareText(r, recipeMap([r]), { scale: 2, unitSystem: 'metric' });
    // "1 lb" doubled is "2 lb", which converts to ≈910 g.
    expect(text).toContain('- ≈910 g Flour');
    // "1/2 tsp" doubled is "1 tsp", which converts to ≈5 ml.
    expect(text).toContain('- ≈5 ml Salt');
  });

  it('reattaches prep and purpose the way splitPrep/splitPurpose took them off', () => {
    const r = recipe('r1', 'Salad', {
      ingredients: [ing('Garlic', { quantity: '2 cloves', prep: 'minced' }), ing('Limes', { purpose: 'margaritas' })],
    });
    const text = buildRecipeShareText(r, recipeMap([r]));
    expect(text).toContain('- 2 cloves Garlic, minced');
    expect(text).toContain('- Limes, for margaritas');
  });

  it('headings a component\'s lines under its own name, root lines unheaded', () => {
    const mash = recipe('r2', 'Mash', { ingredients: [ing('Butter', { quantity: '2 tbsp' })] });
    const steak = recipe('r1', 'Steak with mash', {
      ingredients: [ing('Steak')],
      components: [link('r2', 'Mash')],
    });
    const text = buildRecipeShareText(steak, recipeMap([steak, mash]));
    const lines = text.split('\n');
    const ingredientsAt = lines.indexOf('Ingredients:');
    expect(lines[ingredientsAt + 1]).toBe('- Steak');
    expect(lines[ingredientsAt + 2]).toBe('For the Mash:');
    expect(lines[ingredientsAt + 3]).toBe('- 2 tbsp Butter');
  });

  it('numbers steps when the recipe has them', () => {
    const r = recipe('r1', 'Toast', {
      steps: [{ id: 's1', text: 'Toast the bread.' }, { id: 's2', text: 'Butter it.' }],
    });
    const text = buildRecipeShareText(r, recipeMap([r]));
    expect(text).toContain('Steps:\n1. Toast the bread.\n2. Butter it.');
  });

  it('falls back to notes when there are no steps', () => {
    const r = recipe('r1', 'Toast', { notes: 'Watch it closely.' });
    const text = buildRecipeShareText(r, recipeMap([r]));
    expect(text).toContain('Notes:\nWatch it closely.');
  });

  it('prefers steps over notes when both are present', () => {
    const r = recipe('r1', 'Toast', {
      notes: 'An old note.',
      steps: [{ id: 's1', text: 'Toast the bread.' }],
    });
    const text = buildRecipeShareText(r, recipeMap([r]));
    expect(text).toContain('Steps:');
    expect(text).not.toContain('An old note.');
  });

  it('appends attribution and the source link, link last', () => {
    const r = recipe('r1', 'Chili', {
      author: 'Alison Roman', source: 'Nothing Fancy',
      sourceUrl: 'https://example.com/chili',
    });
    const text = buildRecipeShareText(r, recipeMap([r]));
    const lines = text.split('\n');
    expect(lines[lines.length - 2]).toBe('by Alison Roman, Nothing Fancy');
    expect(lines[lines.length - 1]).toBe('https://example.com/chili');
  });

  it('has no Ingredients/Steps/attribution blocks for a bare recipe', () => {
    const r = recipe('r1', 'Idea');
    const text = buildRecipeShareText(r, recipeMap([r]));
    expect(text).toBe('Idea');
  });
});

describe('buildIngredientsText', () => {
  it('is the ingredient lines and nothing else — no name, no header, no bullets', () => {
    const r = recipe('r1', 'Pancakes', {
      servings: 4,
      ingredients: [ing('Flour', { quantity: '1/2 tbsp' }), ing('Water', { quantity: '1 cup' })],
      steps: [{ id: 's1', text: 'Mix.' }],
      sourceUrl: 'https://example.com/pancakes',
    });
    expect(buildIngredientsText(r, recipeMap([r]))).toBe('1/2 tbsp Flour\n1 cup Water');
  });

  it('scales and converts each line the way the screen is showing it', () => {
    const r = recipe('r1', 'Pancakes', {
      ingredients: [ing('Flour', { quantity: '1 lb' }), ing('Salt', { quantity: '1/2 tsp' })],
    });
    const text = buildIngredientsText(r, recipeMap([r]), { scale: 2, unitSystem: 'metric' });
    expect(text).toBe('≈910 g Flour\n≈5 ml Salt');
  });

  it('keeps prep and purpose on the line, same as the recipe share', () => {
    const r = recipe('r1', 'Salad', {
      ingredients: [ing('Garlic', { quantity: '2 cloves', prep: 'minced' }), ing('Limes', { purpose: 'margaritas' })],
    });
    expect(buildIngredientsText(r, recipeMap([r]))).toBe('2 cloves Garlic, minced\nLimes, for margaritas');
  });

  it('flattens a component\'s lines in without its heading', () => {
    const mash = recipe('r2', 'Mash', { ingredients: [ing('Butter', { quantity: '2 tbsp' })] });
    const steak = recipe('r1', 'Steak with mash', {
      ingredients: [ing('Steak')],
      components: [link('r2', 'Mash')],
    });
    const text = buildIngredientsText(steak, recipeMap([steak, mash]));
    expect(text).toBe('Steak\n2 tbsp Butter');
    expect(text).not.toContain('For the Mash');
  });

  it('is empty for a recipe with nothing to list, so a caller can gate on it', () => {
    const r = recipe('r1', 'Idea', { steps: [{ id: 's1', text: 'Think about it.' }] });
    expect(buildIngredientsText(r, recipeMap([r]))).toBe('');
  });
});

describe('buildGroceryListShareText', () => {
  it('lists what is on the list and not checked, in the order given', () => {
    const items = [item('Milk'), item('Eggs', { quantity: 'x12' })];
    expect(buildGroceryListShareText(items)).toBe('Grocery list\n- Milk\n- x12 Eggs');
  });

  it('excludes a checked row and an off-list row', () => {
    const items = [item('Milk', { checked: true }), item('Salt', { onList: false }), item('Eggs')];
    expect(buildGroceryListShareText(items)).toBe('Grocery list\n- Eggs');
  });

  it('is empty when nothing is on the list', () => {
    expect(buildGroceryListShareText([item('Milk', { checked: true })])).toBe('');
    expect(buildGroceryListShareText([])).toBe('');
  });
});

describe('buildGroceryListText', () => {
  it('is the items alone — no title line, no bullets', () => {
    const items = [item('Milk', { quantity: '2 L' }), item('Bread')];
    expect(buildGroceryListText(items)).toBe('2 L Milk\nBread');
  });

  it('leaves out a checked row and an off-list row, same as the share', () => {
    const items = [
      item('Milk'),
      item('Eggs', { checked: true }),
      item('Rice', { onList: false }),
    ];
    expect(buildGroceryListText(items)).toBe('Milk');
  });

  it('is empty when nothing is on the list, so a caller can gate on it', () => {
    expect(buildGroceryListText([item('Rice', { onList: false })])).toBe('');
  });
});

describe('buildWeekPlanShareText', () => {
  function entry(date: string, slot: MealSlot, overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
    return {
      id: `m-${++seq}`, date, slot, recipeId: null, title: 'Meal', sortOrder: 1,
      createdAt: '2026-01-01T00:00:00.000Z', cookedAt: null, leftoverId: null,
      recipeChoices: [], personIds: [], recipeScale: 1, cookTask: null, shopTask: null, calendarEventId: null,
      ...overrides,
    };
  }

  it('names each planned day and slot, resolving a linked recipe\'s live name', () => {
    const r = recipe('r1', 'Chili');
    const days = [new Date(2026, 7, 10), new Date(2026, 7, 11)];
    const entries = [entry('2026-08-10', 'dinner', { recipeId: 'r1', title: 'stale title' })];
    const text = buildWeekPlanShareText(days, entries, recipeMap([r]));
    expect(text).toContain('Monday');
    expect(text).toContain('- Dinner: Chili');
    expect(text).not.toContain('Tuesday');
  });

  it('falls back to the captured title when the recipe no longer resolves', () => {
    const days = [new Date(2026, 7, 10)];
    const entries = [entry('2026-08-10', 'dinner', { recipeId: 'gone', title: 'Leftovers' })];
    expect(buildWeekPlanShareText(days, entries, new Map())).toContain('- Dinner: Leftovers');
  });

  it('is empty for a week with nothing planned', () => {
    const days = [new Date(2026, 7, 10), new Date(2026, 7, 11)];
    expect(buildWeekPlanShareText(days, [], new Map())).toBe('');
  });
});
