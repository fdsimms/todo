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
  sortRecipesForDisplay,
  groupRecipesByMealType,
  rankRecipeSuggestions,
  scoreRecipeAgainstCatalog,
  suggestRecipesForEmptyNight,
  countLikelyInPantry,
} from '../utils/recipeUtils';
import type { GroceryItem, Recipe, RecipeIngredient, RecipePrepTask } from '../types';

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
    ...overrides,
  };
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
    mealType: null,
    ingredients: [],
    prepTasks: [],
    favorite: false,
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    ...overrides,
  };
}

describe('parseRecipeIngredients', () => {
  it('reads a stored array', () => {
    const stored = JSON.stringify([
      { id: 'a', name: 'Garlic', nameKey: 'garlic', quantity: '1 bulb', aisle: 'Produce', prep: 'peeled' },
    ]);
    expect(parseRecipeIngredients(stored)).toEqual([
      { id: 'a', name: 'Garlic', nameKey: 'garlic', quantity: '1 bulb', aisle: 'Produce', prep: 'peeled' },
    ]);
  });

  it('defaults prep to null for a blob written before the field existed', () => {
    const stored = JSON.stringify([{ id: 'a', name: 'Garlic', nameKey: 'garlic', quantity: '1 bulb', aisle: 'Produce' }]);
    expect(parseRecipeIngredients(stored)).toEqual([
      { id: 'a', name: 'Garlic', nameKey: 'garlic', quantity: '1 bulb', aisle: 'Produce', prep: null },
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
