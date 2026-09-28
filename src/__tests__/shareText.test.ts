import type { GroceryItem, MealPlanEntry, MealSlot, Recipe, RecipeComponent, RecipeIngredient } from '../types';
import {
  buildGroceryListShareText, buildGroceryListText, buildIngredientsText, buildRecipeShareText,
  buildWeekPlanShareText,
} from '../utils/shareText';
import { weightLookups } from '../utils/lineWeight';

// shareText reaches recipeUtils.ts (for describeAttribution/formatServingsRange)
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
    backfillDismissedFields: [],
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
    cookedWeightG: null,
    leftoverKeepDays: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients: [],
    emptySections: [],
    emptyStepSections: [],
    components: [],
    prepTasks: [],
    steps: [],
    sortOrder: ++seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
    upNext: false,
    upNextOrder: 0,
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
    nameFromScan: false,
    id: `i-${++seq}`, name, nameKey: name.toLowerCase(), preferredProductId: null, productStrict: false,
    aisle: 'Other', quantity: null, quantityFromRecipe: false, note: '',
    onList: true, checked: false, sortOrder: seq, purchaseCount: 0,
    lastAddedAt: null, lastPurchasedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null, sourceRecipeId: null, sourceRecipeTitle: null, choiceGroup: null,
    isStaple: false, expiresAt: null, frozenAt: null, openedAt: null, runningLowAt: null, shelfLifeDays: null, useUpTask: null, pantryCheckDeclinedAt: null, pantryReviewedAt: null, usedUpCount: 0, spoiledCount: 0, lastSpoiledAt: null, varietyOfKey: null, nutrition: null, backfillDismissedFields: [], lastPriceMinor: null,
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

  it('says the servings the scaled batch makes, the way the stepper does', () => {
    const r = recipe('r1', 'Chili', {
      servings: 4, servingsMax: 6, recipeYield: '24 cookies',
      ingredients: [ing('Beans', { quantity: '2 cans' })],
    });
    const lines = buildRecipeShareText(r, recipeMap([r]), { scale: 2 }).split('\n');
    expect(lines[1]).toBe('Serves 8-12 · Makes 24 cookies');
    expect(lines).toContain('- 4 cans Beans');
  });

  it('claims no servings for a recipe that never said, at any scale', () => {
    const r = recipe('r1', 'Chili', { servings: null, ingredients: [ing('Beans')] });
    expect(buildRecipeShareText(r, recipeMap([r]), { scale: 2 })).not.toContain('Serves');
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

  it("opens each of the recipe's own section headings where it changes", () => {
    const r = recipe('r1', 'Carrot cake', {
      ingredients: [
        ing('Flour', { section: 'For the cake' }),
        ing('Eggs', { section: 'For the cake' }),
        ing('Cream cheese', { section: 'For the frosting' }),
      ],
    });
    const lines = buildRecipeShareText(r, recipeMap([r])).split('\n');
    const at = lines.indexOf('Ingredients:');
    expect(lines.slice(at + 1, at + 6)).toEqual([
      'For the cake:', '- Flour', '- Eggs', 'For the frosting:', '- Cream cheese',
    ]);
  });

  it("re-opens a section a component shares a label with the recipe above it", () => {
    const mash = recipe('r2', 'Mash', { ingredients: [ing('Butter', { section: 'To finish' })] });
    const steak = recipe('r1', 'Steak with mash', {
      ingredients: [ing('Parsley', { section: 'To finish' })],
      components: [link('r2', 'Mash')],
    });
    const lines = buildRecipeShareText(steak, recipeMap([steak, mash])).split('\n');
    const at = lines.indexOf('Ingredients:');
    expect(lines.slice(at + 1, at + 6)).toEqual([
      'To finish:', '- Parsley', 'For the Mash:', 'To finish:', '- Butter',
    ]);
  });

  it('sends an either/or as the choice, every option with its own amount (#2948)', () => {
    // The recipe screen shows both peppers, captioned "or jalapeño". Sending
    // the default alone told the reader there was no choice.
    const tacos = recipe('r1', 'Tacos', {
      ingredients: [
        ing('serrano', { quantity: '1', choiceGroup: 'Pepper' }),
        ing('jalapenos', { quantity: '2', choiceGroup: 'Pepper' }),
        ing('onion', { quantity: '1' }),
      ],
    });
    const lines = buildRecipeShareText(tacos, recipeMap([tacos]), { scale: 2 }).split('\n');
    const at = lines.indexOf('Ingredients:');
    expect(lines.slice(at + 1, at + 3)).toEqual(['- 2 serrano or 4 jalapenos', '- 2 onion']);
  });

  it('names a component that shares an ingredient\'s group, without listing its lines', () => {
    const homemade = recipe('r2', 'Tortillas de Maiz', { ingredients: [ing('masa harina')] });
    const tacos = recipe('r1', 'Tacos', {
      ingredients: [
        ing('corn tortillas', { quantity: '8', choiceGroup: 'Tortillas' }),
        ing('flour tortillas', { quantity: '8', choiceGroup: 'Tortillas' }),
      ],
      components: [{ ...link('r2', 'Tortillas de Maiz'), choiceGroup: 'Tortillas' }],
    });
    const text = buildRecipeShareText(tacos, recipeMap([tacos, homemade]));
    expect(text).toContain('- 8 corn tortillas or 8 flour tortillas or Tortillas de Maiz');
    expect(text).not.toContain('masa harina');
  });

  it('keeps a choice between two components at its default dish', () => {
    // Both dishes in full would be two headings of lines to buy.
    const mash = recipe('r2', 'Mash', { ingredients: [ing('Potatoes')] });
    const rice = recipe('r3', 'Rice', { ingredients: [ing('Rice')] });
    const steak = recipe('r1', 'Steak', {
      ingredients: [ing('Steak')],
      components: [{ ...link('r2', 'Mash'), choiceGroup: 'Side' }, { ...link('r3', 'Rice'), choiceGroup: 'Side' }],
    });
    const text = buildRecipeShareText(steak, recipeMap([steak, mash, rice]));
    expect(text).toContain('- Potatoes');
    expect(text).not.toContain('- Rice');
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

  it('pastes an either/or as one line holding both options (#2948)', () => {
    // One line per ingredient still: the pepper is one ingredient, and two
    // lines would paste as two things to buy.
    const tacos = recipe('r1', 'Tacos', {
      ingredients: [
        ing('serrano', { quantity: '1', choiceGroup: 'Pepper' }),
        ing('jalapenos', { quantity: '2', choiceGroup: 'Pepper' }),
        ing('onion', { quantity: '1' }),
      ],
    });
    expect(buildIngredientsText(tacos, recipeMap([tacos]))).toBe('1 serrano or 2 jalapenos\n1 onion');
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

  it('sends an either/or as one line where its first option sits', () => {
    const items = [
      item('apples', { quantity: '4', choiceGroup: 'g1' }),
      item('milk'),
      item('pears', { quantity: '4', choiceGroup: 'g1' }),
    ];
    expect(buildGroceryListShareText(items)).toBe('Grocery list\n- 4 apples or 4 pears\n- milk');
  });

  it('sends the one option left once the other is checked off', () => {
    const items = [
      item('apples', { choiceGroup: 'g1', checked: true }),
      item('pears', { choiceGroup: 'g1' }),
    ];
    expect(buildGroceryListShareText(items)).toBe('Grocery list\n- pears');
  });

  it('is empty when nothing is on the list', () => {
    expect(buildGroceryListShareText([item('Milk', { checked: true })])).toBe('');
    expect(buildGroceryListShareText([])).toBe('');
  });

  it('sends the amount in the units the screen was showing', () => {
    // A recipe-added "500 g" reads as about a pound on a US-units screen, and
    // the person shopping from the text should see what was on it.
    const items = [item('ground beef', { quantity: '500 g' }), item('Eggs', { quantity: 'x12' })];
    expect(buildGroceryListShareText(items, { unitSystem: 'us' }))
      .toBe('Grocery list\n- ≈1.1 lbs ground beef\n- x12 Eggs');
  });

  it('carries the preferred product and the note the row shows', () => {
    // The two captions that decide which box leaves the shelf.
    const cheddar = item('cheddar');
    const milk = item('milk', { quantity: '1 gal', note: '  the green top one ' });
    const productCaptions = new Map([[cheddar.id, 'Tillamook sharp']]);
    expect(buildGroceryListShareText([cheddar, milk], { productCaptions }))
      .toBe('Grocery list\n- cheddar: Tillamook sharp\n- 1 gal milk (the green top one)');
  });

  it('puts each option of an either/or in its own words', () => {
    const apples = item('apples', { quantity: '4', choiceGroup: 'g1', note: 'Honeycrisp' });
    const pears = item('pears', { quantity: '4', choiceGroup: 'g1' });
    expect(buildGroceryListShareText([apples, pears]))
      .toBe('Grocery list\n- 4 apples (Honeycrisp) or 4 pears');
  });

  it('titles a list away from home with its own name', () => {
    expect(buildGroceryListShareText([item('Milk')], { listName: 'Cabin week' }))
      .toBe('Cabin week\n- Milk');
    // The home list keeps the plain title.
    expect(buildGroceryListShareText([item('Milk')], { listName: null }))
      .toBe('Grocery list\n- Milk');
  });
});

describe('buildGroceryListText', () => {
  it('is the items alone — no title line, no bullets', () => {
    const items = [item('Milk', { quantity: '2 L' }), item('Bread')];
    expect(buildGroceryListText(items)).toBe('2 L Milk\nBread');
  });

  it('leaves out the note, which would become part of the item on the other side', () => {
    expect(buildGroceryListText([item('milk', { quantity: '1 gal', note: 'the green top one' })]))
      .toBe('1 gal milk');
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
      recipeChoices: [], recipeScale: 1, cookTask: null, shopTask: null, logMeal: null, calendarEventId: null,
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

  it('says a leftover night is leftovers', () => {
    const days = [new Date(2026, 7, 12)];
    const entries = [entry('2026-08-12', 'dinner', { leftoverId: 'lo-1', title: 'Chicken stir-fry' })];
    expect(buildWeekPlanShareText(days, entries, new Map())).toContain('- Dinner: Chicken stir-fry (leftovers)');
  });

  it('is empty for a week with nothing planned', () => {
    const days = [new Date(2026, 7, 10), new Date(2026, 7, 11)];
    expect(buildWeekPlanShareText(days, [], new Map())).toBe('');
  });

  it('says "this week" only for this week, and names any other week by its dates', () => {
    // The plan pages forward and back, and "This week's meals" over next
    // week's dinners sends the reader to the wrong week.
    const days = [new Date(2026, 9, 5), new Date(2026, 9, 11)];
    const entries = [entry('2026-10-05', 'dinner', { title: 'Steak' })];
    const heading = (thisWeek?: boolean) =>
      buildWeekPlanShareText(days, entries, new Map(), { thisWeek }).split('\n')[0];
    expect(heading(true)).toBe("This week's meals (Oct 5 – 11)");
    expect(heading(false)).toBe('Meals for Oct 5 – 11');
    // Unsaid, it's the dates, which are never wrong.
    expect(heading(undefined)).toBe('Meals for Oct 5 – 11');
  });
});

describe('weights in shared text', () => {
  const butter = item('Butter', {
    nutrition: {
      basis: 'per100g', servingGrams: null, servingText: null, amounts: { calorieKcal: 717 },
      portions: [{ amount: 1, label: 'tbsp', grams: 14.2 }],
      source: 'fdc', sourceId: null, recordedAt: '2026-01-01T00:00:00.000Z',
    },
  });
  const weights = weightLookups([butter], []);

  it('puts the weight after the name, ahead of the prep, where the catalog can say it', () => {
    const r = recipe('r1', 'Mash', {
      ingredients: [
        ing('Butter', { quantity: '4 tbsp', prep: 'softened' }),
        ing('Potatoes', { quantity: '2 lb' }),
      ],
    });
    expect(buildIngredientsText(r, recipeMap([r]), { weights }))
      .toBe('4 tbsp Butter (≈57 g), softened\n2 lb Potatoes');
    expect(buildRecipeShareText(r, recipeMap([r]), { weights })).toContain('- 4 tbsp Butter (≈57 g), softened');
  });

  it('weighs the scaled line and writes it in the reader\'s units', () => {
    const r = recipe('r1', 'Mash', { ingredients: [ing('Butter', { quantity: '4 tbsp' })] });
    expect(buildIngredientsText(r, recipeMap([r]), { scale: 2, unitSystem: 'metric', weights }))
      .toBe('≈120 ml Butter (≈114 g)');
  });

  it('adds nothing without the lookups', () => {
    const r = recipe('r1', 'Mash', { ingredients: [ing('Butter', { quantity: '4 tbsp' })] });
    expect(buildIngredientsText(r, recipeMap([r]))).toBe('4 tbsp Butter');
  });
});
