import {
  parseRecipeIngredients,
  normalizeIngredient,
  makeIngredient,
  splitPrep,
  ingredientsFromText,
  mergeIngredients,
  remapIngredientKeyIn,
  describeRecipe,
  cleanRecipeName,
  rankRecipes,
  parsePrepTasks,
  normalizePrepTask,
  resolvePrepTaskDraft,
  describeCookHistory,
  applyMeasuredCookTime,
  avgCookMinutes,
  describeCookTime,
  sortRecipesForDisplay,
  groupRecipesByMealType,
  rankRecipeSuggestions,
  scoreRecipeAgainstCatalog,
  suggestRecipesForEmptyNight,
  countLikelyInPantry,
  formatServingsRange,
} from '../utils/recipeUtils';
import type { GroceryItem, Recipe, RecipeComponent, RecipeIngredient, RecipePrepTask } from '../types';

// recipeUtils now reaches mealPlanGroceries.ts (for countLikelyInPantry) and,
// through it, mealPlan.ts → dateUtils.ts → the settings store — which
// nothing here needs. Same mock as mealPlanGroceries.test.ts.
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
    ...overrides,
  };
}

function component(recipeId: string, name: string, choiceGroup: string | null = null): RecipeComponent {
  return { id: `c-${++seq}`, recipeId, name, choiceGroup };
}

function recipe(name: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: `r-${++seq}`,
    name,
    nameKey: name.toLowerCase(),
    notes: '',
    sourceUrl: null,
    sourceName: null,
    author: null,
    source: null,
    servings: null,
    servingsMax: null,
    recipeYield: null,
    imagePath: null,
    mealType: null,
    ingredients: [],
    components: [],
    prepTasks: [],
    favorite: false,
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    ...overrides,
  };
}

describe('parseRecipeIngredients', () => {
  it('reads a stored array', () => {
    const stored = JSON.stringify([
      { id: 'a', name: 'Garlic', nameKey: 'garlic', quantity: '1 bulb', aisle: 'Produce', prep: 'peeled' },
    ]);
    expect(parseRecipeIngredients(stored)).toEqual([
      { id: 'a', name: 'Garlic', nameKey: 'garlic', quantity: '1 bulb', aisle: 'Produce', prep: 'peeled', purpose: null, section: null },
    ]);
  });

  it('defaults prep, purpose and section to null for a blob written before the fields existed', () => {
    const stored = JSON.stringify([{ id: 'a', name: 'Garlic', nameKey: 'garlic', quantity: '1 bulb', aisle: 'Produce' }]);
    expect(parseRecipeIngredients(stored)).toEqual([
      { id: 'a', name: 'Garlic', nameKey: 'garlic', quantity: '1 bulb', aisle: 'Produce', prep: null, purpose: null, section: null },
    ]);
  });

  it('reads a stored purpose clause', () => {
    const stored = JSON.stringify([
      { id: 'a', name: 'Limes', nameKey: 'limes', quantity: '3', aisle: 'Produce', prep: null, purpose: 'margaritas' },
    ]);
    expect(parseRecipeIngredients(stored)).toEqual([
      { id: 'a', name: 'Limes', nameKey: 'limes', quantity: '3', aisle: 'Produce', prep: null, purpose: 'margaritas', section: null },
    ]);
  });

  it('reads a stored section label', () => {
    const stored = JSON.stringify([
      { id: 'a', name: 'Flour', nameKey: 'flour', quantity: '2 cups', aisle: null, prep: null, section: 'For the cake' },
    ]);
    expect(parseRecipeIngredients(stored)).toEqual([
      { id: 'a', name: 'Flour', nameKey: 'flour', quantity: '2 cups', aisle: null, prep: null, purpose: null, section: 'For the cake' },
    ]);
  });

  it('returns empty for null, corrupt JSON, and a non-array', () => {
    expect(parseRecipeIngredients(null)).toEqual([]);
    expect(parseRecipeIngredients('{not json')).toEqual([]);
    expect(parseRecipeIngredients('{"a":1}')).toEqual([]);
  });

  it('drops rows with no usable name rather than rendering blanks forever', () => {
    const stored = JSON.stringify([{ name: '  ' }, { name: 'Onions' }, null, 7]);
    expect(parseRecipeIngredients(stored).map(i => i.name)).toEqual(['Onions']);
  });

  it('recomputes the key from the name, so a stale stored key can not survive', () => {
    const stored = JSON.stringify([{ id: 'a', name: 'Tomatoes', nameKey: 'wrong', quantity: '', aisle: null }]);
    expect(parseRecipeIngredients(stored)[0].nameKey).toBe('tomatoes');
  });
});

describe('normalizeIngredient', () => {
  it('fills in a missing id and quantity', () => {
    const result = normalizeIngredient({ name: 'Parsley' })!;
    expect(result.id).toBeTruthy();
    expect(result.quantity).toBe('');
    expect(result.aisle).toBeNull();
    expect(result.prep).toBeNull();
    expect(result.section).toBeNull();
  });

  it('treats an empty aisle string as no opinion', () => {
    expect(normalizeIngredient({ name: 'Salt', aisle: '' })!.aisle).toBeNull();
  });

  it('treats an empty or blank prep string as no opinion', () => {
    expect(normalizeIngredient({ name: 'Salt', prep: '' })!.prep).toBeNull();
    expect(normalizeIngredient({ name: 'Salt', prep: '   ' })!.prep).toBeNull();
  });

  it('keeps a stored prep clause', () => {
    expect(normalizeIngredient({ name: 'Garlic', prep: 'minced' })!.prep).toBe('minced');
  });

  it('treats an empty or blank purpose string as no opinion', () => {
    expect(normalizeIngredient({ name: 'Salt', purpose: '' })!.purpose).toBeNull();
    expect(normalizeIngredient({ name: 'Salt', purpose: '   ' })!.purpose).toBeNull();
  });

  it('keeps a stored purpose clause', () => {
    expect(normalizeIngredient({ name: 'Limes', purpose: 'margaritas' })!.purpose).toBe('margaritas');
  });

  it('treats an empty or blank section string as ungrouped', () => {
    expect(normalizeIngredient({ name: 'Salt', section: '' })!.section).toBeNull();
    expect(normalizeIngredient({ name: 'Salt', section: '   ' })!.section).toBeNull();
  });

  it('keeps a stored section label', () => {
    expect(normalizeIngredient({ name: 'Flour', section: 'For the cake' })!.section).toBe('For the cake');
  });

  it('trims a section label to RECIPE_SECTION_MAX_LENGTH', () => {
    const long = 'x'.repeat(100);
    expect(normalizeIngredient({ name: 'Flour', section: long })!.section).toHaveLength(40);
  });
});

describe('splitPrep', () => {
  it('splits a trailing comma clause into prep', () => {
    expect(splitPrep('garlic, peeled and sliced')).toEqual({
      name: 'garlic',
      prep: 'peeled and sliced',
    });
    expect(splitPrep('black beans, drained and rinsed')).toEqual({
      name: 'black beans',
      prep: 'drained and rinsed',
    });
  });

  it('keeps everything after the first comma together as one prep clause', () => {
    expect(splitPrep('chicken breast, boneless, skinless')).toEqual({
      name: 'chicken breast',
      prep: 'boneless, skinless',
    });
  });

  it('leaves a name with no comma untouched', () => {
    expect(splitPrep('garlic')).toEqual({ name: 'garlic', prep: null });
  });

  it('does not strip a leading prep word in general — that case is a guess, not a convention match', () => {
    expect(splitPrep('sliced almonds')).toEqual({ name: 'sliced almonds', prep: null });
    expect(splitPrep('ground cumin')).toEqual({ name: 'ground cumin', prep: null });
  });

  it('does strip a leading prep word from the small curated whitelist', () => {
    expect(splitPrep('grated cheddar')).toEqual({ name: 'cheddar', prep: 'grated' });
  });

  it('refuses to empty the name out — a comma right at the start is not a split point', () => {
    expect(splitPrep(', peeled and sliced')).toEqual({ name: ', peeled and sliced', prep: null });
  });
});

describe('makeIngredient', () => {
  it('splits the quantity out so the name stays a clean key', () => {
    const result = makeIngredient('2 lb chicken thighs')!;
    expect(result.name).toBe('chicken thighs');
    expect(result.quantity).toBe('2 lb');
    expect(result.nameKey).toBe('chicken thighs');
  });

  it('handles a bare count and a trailing x', () => {
    expect(makeIngredient('3 avocados')!.quantity).toBe('3');
    expect(makeIngredient('eggs x12')!.quantity).toBe('x12');
  });

  it('leaves the aisle to add time rather than baking in a guess', () => {
    // The lexicon knows bananas are Produce, but asserting it here would
    // outrank the user's own filing for ever after.
    expect(makeIngredient('bananas')!.aisle).toBeNull();
  });

  it('leaves a one-line add ungrouped', () => {
    expect(makeIngredient('bananas')!.section).toBeNull();
  });

  it('splits prep out of the name after the quantity is peeled off', () => {
    const result = makeIngredient('5 cloves garlic, peeled and sliced')!;
    expect(result.name).toBe('garlic');
    expect(result.quantity).toBe('5 cloves');
    expect(result.prep).toBe('peeled and sliced');
    expect(result.nameKey).toBe('garlic');
  });

  it('captures a sized container as the quantity, leaving a clean catalog name', () => {
    const result = makeIngredient('2 14 oz cans black beans, drained and rinsed')!;
    expect(result.name).toBe('black beans');
    expect(result.quantity).toBe('2 14 oz cans');
    expect(result.prep).toBe('drained and rinsed');
    expect(result.nameKey).toBe('black beans');
  });

  it('leaves prep null when there is no comma clause', () => {
    expect(makeIngredient('2 lb chicken thighs')!.prep).toBeNull();
  });

  it('splits a trailing "for" purpose clause out of the name', () => {
    const result = makeIngredient('Limes for margaritas')!;
    expect(result.name).toBe('Limes');
    expect(result.purpose).toBe('margaritas');
    expect(result.nameKey).toBe('limes');
  });

  it('splits purpose after the quantity is peeled off', () => {
    const result = makeIngredient('2 cups flour for dusting')!;
    expect(result.name).toBe('flour');
    expect(result.quantity).toBe('2 cups');
    expect(result.purpose).toBe('dusting');
  });

  it('does not split a purpose clause out of a comma-based prep clause', () => {
    const result = makeIngredient('cheese, plus more for topping')!;
    expect(result.name).toBe('cheese');
    expect(result.prep).toBe('plus more for topping');
    expect(result.purpose).toBeNull();
  });

  it('leaves purpose null when there is no "for" clause', () => {
    expect(makeIngredient('2 lb chicken thighs')!.purpose).toBeNull();
  });

  it('returns null for a line that parses to nothing', () => {
    expect(makeIngredient('   ')).toBeNull();
  });
});

describe('ingredientsFromText', () => {
  it('turns a pasted list into ingredients, bullets and all', () => {
    const result = ingredientsFromText([
      '- 2 lb chicken thighs',
      '* 1 bunch parsley',
      '3. 3 cloves garlic',
    ].join('\n'));

    expect(result.map(i => i.name)).toEqual(['chicken thighs', 'parsley', 'garlic']);
    expect(result.map(i => i.quantity)).toEqual(['2 lb', '1 bunch', '3 cloves']);
  });

  it('dedupes within the paste on the catalog key', () => {
    const result = ingredientsFromText('Salt\n1 tsp salt\nPepper');
    expect(result.map(i => i.name)).toEqual(['Salt', 'Pepper']);
  });

  it('skips blank lines', () => {
    expect(ingredientsFromText('Milk\n\n\nEggs')).toHaveLength(2);
  });
});

describe('mergeIngredients', () => {
  it('appends what is new', () => {
    const result = mergeIngredients([ing('Garlic')], [ing('Onions')]);
    expect(result.map(i => i.name)).toEqual(['Garlic', 'Onions']);
  });

  it('keeps the existing row on a collision, quantity and all', () => {
    // The existing one may carry a quantity or aisle the user set by hand;
    // replacing it is the quiet overwrite addByName refuses to do.
    const existing = ing('Garlic', { quantity: '1 bulb', aisle: 'Produce' });
    const result = mergeIngredients([existing], [ing('garlic', { quantity: '3 cloves' })]);

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe('1 bulb');
    expect(result[0].aisle).toBe('Produce');
  });

  it('dedupes within the incoming batch too', () => {
    const result = mergeIngredients([], [ing('Salt'), ing('salt')]);
    expect(result).toHaveLength(1);
  });
});

describe('remapIngredientKeyIn', () => {
  it('returns only the recipes that actually changed', () => {
    const hit = recipe('Ragu', { ingredients: [ing('Tomatos', { nameKey: 'tomatos' }), ing('Onions')] });
    const miss = recipe('Soup', { ingredients: [ing('Carrots')] });

    const changed = remapIngredientKeyIn([hit, miss], 'tomatos', 'tomatoes');

    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe(hit.id);
    expect(changed[0].ingredients.map(i => i.nameKey)).toEqual(['tomatoes', 'onions']);
  });

  it('leaves the ingredient label alone — only the bridge moves', () => {
    const r = recipe('Ragu', { ingredients: [ing('Tomatos', { nameKey: 'tomatos' })] });
    expect(remapIngredientKeyIn([r], 'tomatos', 'tomatoes')[0].ingredients[0].name).toBe('Tomatos');
  });

  it('does not mutate the input', () => {
    const r = recipe('Ragu', { ingredients: [ing('Tomatos', { nameKey: 'tomatos' })] });
    remapIngredientKeyIn([r], 'tomatos', 'tomatoes');
    expect(r.ingredients[0].nameKey).toBe('tomatos');
  });

  it('returns nothing for a no-op remap or an empty key', () => {
    const r = recipe('Ragu', { ingredients: [ing('Onions')] });
    expect(remapIngredientKeyIn([r], 'onions', 'onions')).toEqual([]);
    expect(remapIngredientKeyIn([r], '', 'onions')).toEqual([]);
    expect(remapIngredientKeyIn([r], 'onions', '')).toEqual([]);
  });
});

describe('normalizePrepTask', () => {
  it('fills in a missing id and defaults', () => {
    const t = normalizePrepTask({ title: 'Defrost the chicken' })!;
    expect(t.id).toBeTruthy();
    expect(t.title).toBe('Defrost the chicken');
    expect(t.offsetDays).toBe(0);
    expect(t.reminderOffsetMinutes).toBeNull();
  });

  it('returns null for a row with no usable title', () => {
    expect(normalizePrepTask({ title: '  ' })).toBeNull();
    expect(normalizePrepTask({})).toBeNull();
    expect(normalizePrepTask(null)).toBeNull();
    expect(normalizePrepTask('not an object')).toBeNull();
  });

  it('rounds a fractional offset rather than storing it', () => {
    const t = normalizePrepTask({ title: 'Marinate', offsetDays: -1.6, reminderOffsetMinutes: 29.4 })!;
    expect(t.offsetDays).toBe(-2);
    expect(t.reminderOffsetMinutes).toBe(29);
  });

  it('keeps a stored id and reminder rather than regenerating them', () => {
    const t = normalizePrepTask({ id: 'p1', title: 'Marinate', offsetDays: -1, reminderOffsetMinutes: 30 })!;
    expect(t.id).toBe('p1');
    expect(t.reminderOffsetMinutes).toBe(30);
  });
});

describe('parsePrepTasks', () => {
  it('reads a stored array', () => {
    const stored = JSON.stringify([{ id: 'p1', title: 'Defrost', offsetDays: -2, reminderOffsetMinutes: null }]);
    expect(parsePrepTasks(stored)).toEqual([
      { id: 'p1', title: 'Defrost', offsetDays: -2, reminderOffsetMinutes: null },
    ]);
  });

  it('returns empty for null, corrupt JSON, a non-array, or a blob written before the column existed', () => {
    expect(parsePrepTasks(null)).toEqual([]);
    expect(parsePrepTasks('{not json')).toEqual([]);
    expect(parsePrepTasks('{"a":1}')).toEqual([]);
    expect(parsePrepTasks(undefined)).toEqual([]);
  });

  it('drops rows with no usable title rather than rendering blanks forever', () => {
    const stored = JSON.stringify([{ title: '  ' }, { title: 'Defrost' }, null, 7]);
    expect(parsePrepTasks(stored).map(t => t.title)).toEqual(['Defrost']);
  });
});

describe('resolvePrepTaskDraft', () => {
  function prepTask(overrides: Partial<RecipePrepTask> = {}): RecipePrepTask {
    return { id: 'p1', title: 'Defrost the chicken', offsetDays: -2, reminderOffsetMinutes: null, ...overrides };
  }

  it('resolves the due date relative to the meal date, noon-normalized', () => {
    const mealDate = new Date(2026, 7, 15); // a Saturday
    const { dueDate } = resolvePrepTaskDraft(prepTask({ offsetDays: -2 }), mealDate);
    const d = new Date(dueDate);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(13);
    expect(d.getHours()).toBe(12);
  });

  it('offsetDays 0 is the day of the meal', () => {
    const mealDate = new Date(2026, 7, 15);
    const { dueDate } = resolvePrepTaskDraft(prepTask({ offsetDays: 0 }), mealDate);
    expect(new Date(dueDate).getDate()).toBe(15);
  });

  it('has no reminder when reminderOffsetMinutes is null', () => {
    const { reminderTime } = resolvePrepTaskDraft(prepTask({ reminderOffsetMinutes: null }), new Date(2026, 7, 15));
    expect(reminderTime).toBeNull();
  });

  it('the reminder is exactly N minutes before the resolved due date', () => {
    const mealDate = new Date(2026, 7, 15);
    const { dueDate, reminderTime } = resolvePrepTaskDraft(
      prepTask({ offsetDays: -1, reminderOffsetMinutes: 90 }),
      mealDate
    );
    expect(new Date(dueDate).getTime() - new Date(reminderTime!).getTime()).toBe(90 * 60_000);
  });
});

describe('describeRecipe', () => {
  it('counts ingredients and singularises one', () => {
    expect(describeRecipe(recipe('A', { ingredients: [ing('Salt')] }))).toBe('1 ingredient');
    expect(describeRecipe(recipe('B', { ingredients: [ing('Salt'), ing('Pepper')] }))).toBe('2 ingredients');
    expect(describeRecipe(recipe('C'))).toBe('0 ingredients');
  });

  it('adds servings only when set', () => {
    expect(describeRecipe(recipe('D', { ingredients: [ing('Salt')], servings: 4 })))
      .toBe('1 ingredient · serves 4');
  });

  it('renders a servings range when servingsMax exceeds servings', () => {
    expect(describeRecipe(recipe('D2', { ingredients: [ing('Salt')], servings: 4, servingsMax: 6 })))
      .toBe('1 ingredient · serves 4-6');
  });

  it('falls back to a plain count when servingsMax does not exceed servings', () => {
    expect(describeRecipe(recipe('D3', { ingredients: [ing('Salt')], servings: 4, servingsMax: 4 })))
      .toBe('1 ingredient · serves 4');
    expect(describeRecipe(recipe('D4', { ingredients: [ing('Salt')], servings: 4, servingsMax: 2 })))
      .toBe('1 ingredient · serves 4');
  });

  it('adds yield only when set, after servings', () => {
    expect(describeRecipe(recipe('D5', { ingredients: [ing('Flour')], recipeYield: '3 cups' })))
      .toBe('1 ingredient · makes 3 cups');
    expect(describeRecipe(recipe('D6', {
      ingredients: [ing('Flour')],
      servings: 8,
      recipeYield: '2 loaves',
    }))).toBe('1 ingredient · serves 8 · makes 2 loaves');
  });

  it('adds the source name only when set, after servings', () => {
    expect(describeRecipe(recipe('E', { ingredients: [ing('Salt')], sourceName: 'NYT Cooking' })))
      .toBe('1 ingredient · NYT Cooking');
    expect(describeRecipe(recipe('F', {
      ingredients: [ing('Salt')],
      servings: 4,
      sourceName: 'Bon Appétit',
    }))).toBe('1 ingredient · serves 4 · Bon Appétit');
  });

  it('inserts the pantry count between the ingredient count and servings, singularising one', () => {
    const withServings = recipe('G', { ingredients: [ing('Salt'), ing('Pepper')], servings: 2 });
    expect(describeRecipe(withServings, 1)).toBe('2 ingredients · 1 likely in pantry · serves 2');
    expect(describeRecipe(withServings, 6)).toBe('2 ingredients · 6 likely in pantry · serves 2');
  });

  it('omits the pantry phrase for a null, undefined or zero count', () => {
    const r = recipe('H', { ingredients: [ing('Salt')] });
    expect(describeRecipe(r)).toBe('1 ingredient');
    expect(describeRecipe(r, null)).toBe('1 ingredient');
    expect(describeRecipe(r, 0)).toBe('1 ingredient');
  });

  it('adds the duration only when set, after servings and before attribution', () => {
    expect(describeRecipe(recipe('I', { ingredients: [ing('Salt')], estimatedMinutes: 25 })))
      .toBe('1 ingredient · 25m');
    expect(describeRecipe(recipe('J', {
      ingredients: [ing('Salt')],
      servings: 4,
      estimatedMinutes: 90,
      sourceName: 'NYT Cooking',
    }))).toBe('1 ingredient · serves 4 · 1.5h · NYT Cooking');
  });

  it('leads with the meal type when set, ahead of the ingredient count', () => {
    expect(describeRecipe(recipe('I', { ingredients: [ing('Salt')], mealType: 'breakfast' })))
      .toBe('Breakfast · 1 ingredient');
    expect(describeRecipe(recipe('J', {
      ingredients: [ing('Salt')],
      mealType: 'dessert',
      servings: 4,
    }))).toBe('Dessert · 1 ingredient · serves 4');
  });

  it('omits the meal type phrase when unset', () => {
    expect(describeRecipe(recipe('K', { ingredients: [ing('Salt')], mealType: null })))
      .toBe('1 ingredient');
  });

  it('says a composed recipe has parts, right after its own ingredient count', () => {
    const composed = recipe('I', {
      ingredients: [ing('Steak')],
      components: [component('r-mash', 'Mash')],
      servings: 2,
    });
    expect(describeRecipe(composed)).toBe('1 ingredient · 1 component · serves 2');
    expect(describeRecipe(recipe('J', {
      components: [component('r-mash', 'Mash'), component('r-gravy', 'Gravy')],
    }))).toBe('0 ingredients · 2 components');
  });
});

describe('sortRecipesForDisplay', () => {
  it('puts favorites first, then sortOrder', () => {
    const a = recipe('A', { sortOrder: 2, favorite: false });
    const b = recipe('B', { sortOrder: 1, favorite: true });
    const c = recipe('C', { sortOrder: 0, favorite: false });
    expect(sortRecipesForDisplay([a, b, c]).map(r => r.name)).toEqual(['B', 'C', 'A']);
  });

  it('does not mutate the input array', () => {
    const list = [recipe('A', { sortOrder: 1 }), recipe('B', { sortOrder: 0 })];
    const original = [...list];
    sortRecipesForDisplay(list);
    expect(list).toEqual(original);
  });
});

describe('groupRecipesByMealType', () => {
  it('groups into RECIPE_MEAL_TYPES order, dropping meal types with nothing in them', () => {
    const breakfast = recipe('Oatmeal', { mealType: 'breakfast', sortOrder: 0 });
    const dessert = recipe('Cake', { mealType: 'dessert', sortOrder: 0 });
    const dinner = recipe('Stew', { mealType: 'dinner', sortOrder: 0 });
    const sections = groupRecipesByMealType([dessert, breakfast, dinner]);
    expect(sections.map(s => s.title)).toEqual(['Breakfast', 'Dinner', 'Dessert']);
    expect(sections.map(s => s.data.map(r => r.name))).toEqual([['Oatmeal'], ['Stew'], ['Cake']]);
  });

  it('trails untagged recipes in their own section, after every tagged one', () => {
    const untagged = recipe('Mystery', { mealType: null, sortOrder: 0 });
    const lunch = recipe('Salad', { mealType: 'lunch', sortOrder: 0 });
    const sections = groupRecipesByMealType([untagged, lunch]);
    expect(sections.map(s => s.title)).toEqual(['Lunch', 'Untagged']);
    expect(sections[1].mealType).toBeNull();
    expect(sections[1].data.map(r => r.name)).toEqual(['Mystery']);
  });

  it('sorts each section favorites-first by sortOrder, same as the flat list', () => {
    const a = recipe('A', { mealType: 'snack', sortOrder: 2, favorite: false });
    const b = recipe('B', { mealType: 'snack', sortOrder: 1, favorite: true });
    const sections = groupRecipesByMealType([a, b]);
    expect(sections[0].data.map(r => r.name)).toEqual(['B', 'A']);
  });

  it('returns no sections for an empty recipe list', () => {
    expect(groupRecipesByMealType([])).toEqual([]);
  });
});

describe('cleanRecipeName', () => {
  it('trims, collapses whitespace and caps length', () => {
    expect(cleanRecipeName('  Sausage   ragu  ')).toBe('Sausage ragu');
    expect(cleanRecipeName('x'.repeat(200))).toHaveLength(80);
  });

  it('returns empty for a name that is only whitespace', () => {
    expect(cleanRecipeName('   ')).toBe('');
  });
});

describe('rankRecipes', () => {
  const ragu = recipe('Ragu', { nameKey: 'ragu' });
  const roastChicken = recipe('Roast chicken', {
    nameKey: 'roast chicken',
    ingredients: [ing('Fennel', { nameKey: 'fennel' })],
  });
  const chickenPie = recipe('Chicken pie', { nameKey: 'chicken pie' });
  const all = [ragu, roastChicken, chickenPie];

  it('returns everything for an empty query', () => {
    expect(rankRecipes('', all)).toHaveLength(3);
  });

  it('ranks a prefix above a word start', () => {
    const result = rankRecipes('chicken', all);
    expect(result.map(r => r.name)).toEqual(['Chicken pie', 'Roast chicken']);
  });

  it('finds a recipe by an ingredient, but below every name match', () => {
    const fennelRagu = recipe('Ragu', { nameKey: 'ragu', ingredients: [ing('Fennel', { nameKey: 'fennel' })] });
    const fennelSoup = recipe('Fennel soup', { nameKey: 'fennel soup' });

    const result = rankRecipes('fennel', [fennelRagu, fennelSoup]);
    expect(result.map(r => r.name)).toEqual(['Fennel soup', 'Ragu']);
  });

  it('breaks a tie on favourite', () => {
    const a = recipe('Chicken a', { nameKey: 'chicken a' });
    const b = recipe('Chicken b', { nameKey: 'chicken b', favorite: true });
    expect(rankRecipes('chicken', [a, b])[0].name).toBe('Chicken b');
  });

  it('drops what does not match at all', () => {
    expect(rankRecipes('lasagne', all)).toEqual([]);
  });

  it('finds a dish by an ingredient that lives on one of its components', () => {
    const mash = recipe('Mash', { nameKey: 'mash', ingredients: [ing('Potatoes', { nameKey: 'potatoes' })] });
    const steak = recipe('Steak dinner', {
      nameKey: 'steak dinner',
      ingredients: [ing('Steak', { nameKey: 'steak' })],
      components: [component(mash.id, 'Mash')],
    });

    expect(rankRecipes('potatoes', [steak, mash]).map(r => r.name)).toEqual(['Mash', 'Steak dinner']);
  });
});

describe('describeCookHistory', () => {
  it('is empty for a never-cooked recipe', () => {
    expect(describeCookHistory(recipe('Ragù', { cookCount: 0, lastCookedAt: null }))).toBe('');
  });

  it('says "once" for a single cooking', () => {
    const r = recipe('Ragù', { cookCount: 1, lastCookedAt: '2026-07-12T00:00:00.000Z' });
    expect(describeCookHistory(r)).toBe('Cooked once · last on 12 Jul');
  });

  it('counts multiple cookings with a ×', () => {
    const r = recipe('Ragù', { cookCount: 4, lastCookedAt: '2026-07-12T00:00:00.000Z' });
    expect(describeCookHistory(r)).toBe('Cooked 4× · last on 12 Jul');
  });

  it('drops the date clause when there is a count but no stamp', () => {
    const r = recipe('Ragù', { cookCount: 2, lastCookedAt: null });
    expect(describeCookHistory(r)).toBe('Cooked 2×');
  });
});

describe('applyMeasuredCookTime', () => {
  it('rounds and floors at 1 minute, and advances the counters', () => {
    const r = recipe('Ragù', { estimatedMinutes: 25, cookTimeCount: 2, totalCookMinutes: 50 });
    expect(applyMeasuredCookTime(32.4, r)).toEqual({
      lastCookMinutes: 32,
      cookTimeCount: 3,
      totalCookMinutes: 82,
    });
    expect(applyMeasuredCookTime(0.2, r).lastCookMinutes).toBe(1);
  });

  it('backfills estimatedMinutes only the first time — a typed estimate is never overwritten', () => {
    const untimed = recipe('Ragù', { estimatedMinutes: null, cookTimeCount: 0, totalCookMinutes: 0 });
    expect(applyMeasuredCookTime(18, untimed)).toEqual({
      lastCookMinutes: 18,
      cookTimeCount: 1,
      totalCookMinutes: 18,
      estimatedMinutes: 18,
    });

    const timed = recipe('Ragù', { estimatedMinutes: 25, cookTimeCount: 0, totalCookMinutes: 0 });
    const patch = applyMeasuredCookTime(40, timed);
    expect(patch).not.toHaveProperty('estimatedMinutes');
    expect(patch.lastCookMinutes).toBe(40);
  });
});

describe('avgCookMinutes', () => {
  it('is null before anything has been logged', () => {
    expect(avgCookMinutes(recipe('Ragù', { cookTimeCount: 0, totalCookMinutes: 0 }))).toBeNull();
  });

  it('rounds the mean of the logged sessions', () => {
    expect(avgCookMinutes(recipe('Ragù', { cookTimeCount: 3, totalCookMinutes: 100 }))).toBe(33);
  });
});

describe('describeCookTime', () => {
  it('is empty for a recipe with no estimate and no history', () => {
    expect(describeCookTime(recipe('Ragù'))).toBe('');
  });

  it('shows only the estimate before anything has been logged', () => {
    expect(describeCookTime(recipe('Ragù', { estimatedMinutes: 25 }))).toBe('Est. 25m');
  });

  it('adds the single logged time without an average for one session', () => {
    const r = recipe('Ragù', {
      estimatedMinutes: 25,
      lastCookMinutes: 32,
      cookTimeCount: 1,
      totalCookMinutes: 32,
    });
    expect(describeCookTime(r)).toBe('Est. 25m · took 32m');
  });

  it('adds "last time" and an average once more than one session has been logged', () => {
    const r = recipe('Ragù', {
      estimatedMinutes: 25,
      lastCookMinutes: 30,
      cookTimeCount: 4,
      totalCookMinutes: 132,
    });
    expect(describeCookTime(r)).toBe('Est. 25m · took 30m last time · avg 33m over 4 cooks');
  });
});

describe('rankRecipeSuggestions', () => {
  const now = new Date(2026, 7, 12); // 12 Aug 2026

  it('excludes a recipe that has never been cooked', () => {
    const r = recipe('Ragù', { cookCount: 0, lastCookedAt: null });
    expect(rankRecipeSuggestions([r], now)).toEqual([]);
  });

  it('ranks a recently and often cooked recipe above one cooked once long ago', () => {
    const often = recipe('Ragù', {
      cookCount: 8,
      lastCookedAt: new Date(2026, 7, 10).toISOString(), // 2 days ago
    });
    const once = recipe('Fennel soup', {
      cookCount: 1,
      lastCookedAt: new Date(2026, 0, 1).toISOString(), // months ago
    });
    expect(rankRecipeSuggestions([once, often], now).map(r => r.name)).toEqual(['Ragù', 'Fennel soup']);
  });

  it('respects the limit', () => {
    const recipes = ['A', 'B', 'C', 'D'].map(name =>
      recipe(name, { cookCount: 1, lastCookedAt: now.toISOString() })
    );
    expect(rankRecipeSuggestions(recipes, now, 2)).toHaveLength(2);
  });

  it('breaks a tie on name', () => {
    const a = recipe('B recipe', { cookCount: 1, lastCookedAt: now.toISOString() });
    const b = recipe('A recipe', { cookCount: 1, lastCookedAt: now.toISOString() });
    expect(rankRecipeSuggestions([a, b], now).map(r => r.name)).toEqual(['A recipe', 'B recipe']);
  });
});

function item(name: string, overrides: Partial<GroceryItem> & { nameKey?: string } = {}): GroceryItem {
  return {
    id: `gi-${++seq}`,
    name,
    nameKey: overrides.nameKey ?? name.toLowerCase(),
    aisle: 'Other',
    quantity: null,
    note: '',
    onList: false,
    checked: false,
    inCatalog: true,
    sortOrder: seq,
    favorite: false,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null,
    sourceRecipeId: null,
    sourceRecipeTitle: null,
    ...overrides,
  } as GroceryItem;
}

describe('scoreRecipeAgainstCatalog', () => {
  const now = new Date(2026, 7, 12); // 12 Aug 2026

  it('is zero for a recipe with no ingredients', () => {
    expect(scoreRecipeAgainstCatalog(recipe('Toast', { ingredients: [] }), [], now)).toBe(0);
  });

  it('is zero when nothing in the recipe is in the catalog', () => {
    const r = recipe('Ragù', { ingredients: [ing('Saffron', { nameKey: 'saffron' })] });
    expect(scoreRecipeAgainstCatalog(r, [], now)).toBe(0);
  });

  it('scores higher for full coverage than partial coverage', () => {
    const full = recipe('Full', { ingredients: [ing('Onions', { nameKey: 'onions' })] });
    const partial = recipe('Partial', {
      ingredients: [ing('Onions', { nameKey: 'onions' }), ing('Saffron', { nameKey: 'saffron' })],
    });
    const items = [item('Onions', { nameKey: 'onions' })];
    expect(scoreRecipeAgainstCatalog(full, items, now))
      .toBeGreaterThan(scoreRecipeAgainstCatalog(partial, items, now));
  });

  it('nudges a recently bought match above a stale one at equal coverage', () => {
    const r = recipe('Ragù', { ingredients: [ing('Onions', { nameKey: 'onions' })] });
    const fresh = [item('Onions', { nameKey: 'onions', lastPurchasedAt: new Date(2026, 7, 10).toISOString() })];
    const stale = [item('Onions', { nameKey: 'onions', lastPurchasedAt: new Date(2026, 0, 1).toISOString() })];
    expect(scoreRecipeAgainstCatalog(r, fresh, now)).toBeGreaterThan(scoreRecipeAgainstCatalog(r, stale, now));
  });

  it('measures coverage over the components too, not just the parent\'s own lines', () => {
    const mash = recipe('Mash', { ingredients: [ing('Saffron', { nameKey: 'saffron' })] });
    const steak = recipe('Steak dinner', {
      ingredients: [ing('Onions', { nameKey: 'onions' })],
      components: [component(mash.id, 'Mash')],
    });
    const items = [item('Onions', { nameKey: 'onions' })];
    const byId = new Map([[steak.id, steak], [mash.id, mash]]);

    // Half its shopping is unaccounted for once the component counts, so it
    // has to score below the same recipe read on its own.
    expect(scoreRecipeAgainstCatalog(steak, items, now, byId))
      .toBeLessThan(scoreRecipeAgainstCatalog(steak, items, now));
  });
});

describe('countLikelyInPantry', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  function daysAgo(n: number): string {
    return new Date(now.getTime() - n * 86_400_000).toISOString();
  }

  it('is null for a recipe with no ingredients', () => {
    expect(countLikelyInPantry(recipe('Toast', { ingredients: [] }), [], now)).toBeNull();
  });

  it('is null when nothing reads as probably on hand', () => {
    const r = recipe('Ragù', { ingredients: [ing('Saffron', { nameKey: 'saffron' })] });
    const items = [item('Saffron', { nameKey: 'saffron', purchaseCount: 0 })];
    expect(countLikelyInPantry(r, items, now)).toBeNull();
  });

  it('counts only ingredients classifyPlanned puts in probablyHave', () => {
    // Milk: bought every ~30 days, last one 10 days ago — inside cadence.
    const milk = item('Milk', {
      nameKey: 'milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
    });
    // Onions: on the list already, so it's alreadyOnList/inTrolley, not probablyHave.
    const onions = item('Onions', { nameKey: 'onions', onList: true });
    // Saffron: no catalog row at all.
    const r = recipe('Ragù', {
      ingredients: [
        ing('Milk', { nameKey: 'milk' }),
        ing('Onions', { nameKey: 'onions' }),
        ing('Saffron', { nameKey: 'saffron' }),
      ],
    });
    expect(countLikelyInPantry(r, [milk, onions], now)).toBe(1);
  });

  it('counts a component\'s ingredients when given the library', () => {
    const milk = item('Milk', {
      nameKey: 'milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
    });
    const mash = recipe('Mash', { ingredients: [ing('Milk', { nameKey: 'milk' })] });
    const steak = recipe('Steak dinner', {
      ingredients: [ing('Steak', { nameKey: 'steak' })],
      components: [component(mash.id, 'Mash')],
    });

    expect(countLikelyInPantry(steak, [milk], now)).toBeNull();
    expect(countLikelyInPantry(steak, [milk], now, new Map([[steak.id, steak], [mash.id, mash]]))).toBe(1);
  });
});

describe('suggestRecipesForEmptyNight', () => {
  const now = new Date(2026, 7, 12);

  it('excludes a recipe with no catalog overlap', () => {
    const r = recipe('Ragù', { ingredients: [ing('Saffron', { nameKey: 'saffron' })] });
    expect(suggestRecipesForEmptyNight([r], [], now)).toEqual([]);
  });

  it('ranks full coverage above partial', () => {
    const full = recipe('Full', { ingredients: [ing('Onions', { nameKey: 'onions' })] });
    const partial = recipe('Partial', {
      ingredients: [ing('Onions', { nameKey: 'onions' }), ing('Saffron', { nameKey: 'saffron' })],
    });
    const items = [item('Onions', { nameKey: 'onions' })];
    expect(suggestRecipesForEmptyNight([partial, full], items, now).map(r => r.name)).toEqual(['Full', 'Partial']);
  });

  it('respects the limit', () => {
    const items = [item('Onions', { nameKey: 'onions' })];
    const recipes = ['A', 'B', 'C', 'D'].map(name =>
      recipe(name, { ingredients: [ing('Onions', { nameKey: 'onions' })] })
    );
    expect(suggestRecipesForEmptyNight(recipes, items, now, 2)).toHaveLength(2);
  });
});

describe('formatServingsRange', () => {
  it('is null with no servings', () => {
    expect(formatServingsRange(null, null)).toBeNull();
    expect(formatServingsRange(null, 6)).toBeNull();
  });

  it('renders a plain count with no max, or a max that does not exceed it', () => {
    expect(formatServingsRange(4, null)).toBe('4');
    expect(formatServingsRange(4, 4)).toBe('4');
    expect(formatServingsRange(4, 2)).toBe('4');
  });

  it('renders a range when the max exceeds the low end', () => {
    expect(formatServingsRange(4, 6)).toBe('4-6');
  });
});
