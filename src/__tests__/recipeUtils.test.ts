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
  parseSteps,
  normalizeStep,
  resolvePrepTaskDraft,
  prepTaskDraftsForMeal,
  describeCookHistory,
  applyMeasuredCookTime,
  applyMeasuredPrepTime,
  avgCookMinutes,
  avgPrepMinutes,
  describeCookTime,
  describePrepTime,
  describeAttribution,
  totalMinutes,
  distinctRecipeValues,
  filterRecipeSuggestions,
  sortRecipesForDisplay,
  sortRecipesBy,
  groupRecipesByMealType,
  flattenRecipeMealTypeSections,
  recipeListItemKey,
  resolveRecipeMealTypeDrop,
  rankRecipeSuggestions,
  scoreRecipeAgainstCatalog,
  suggestRecipesForEmptyNight,
  countLikelyInPantry,
  pantryCoverageForRecipe,
  describePantryCoverage,
  formatServingsRange,
  looksLikeBareUrl,
} from '../utils/recipeUtils';
import type { GroceryItem, ItemSubLink, Recipe, RecipeComponent, RecipeIngredient, RecipePrepTask } from '../types';

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
    choiceGroup: null,
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
    leftoverKeepDays: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients: [],
    emptySections: [],
    components: [],
    prepTasks: [],
    steps: [],
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
    sourceType: null,
    sourcePage: null,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
    ...overrides,
  };
}

describe('parseRecipeIngredients', () => {
  it('reads a stored array', () => {
    const stored = JSON.stringify([
      { id: 'a', name: 'Garlic', nameKey: 'garlic', quantity: '1 bulb', aisle: 'Produce', prep: 'peeled' },
    ]);
    expect(parseRecipeIngredients(stored)).toEqual([
      { id: 'a', name: 'Garlic', nameKey: 'garlic', quantity: '1 bulb', aisle: 'Produce', prep: 'peeled', purpose: null, section: null, choiceGroup: null },
    ]);
  });

  it('defaults the later fields to null for a blob written before they existed', () => {
    const stored = JSON.stringify([{ id: 'a', name: 'Garlic', nameKey: 'garlic', quantity: '1 bulb', aisle: 'Produce' }]);
    expect(parseRecipeIngredients(stored)).toEqual([
      { id: 'a', name: 'Garlic', nameKey: 'garlic', quantity: '1 bulb', aisle: 'Produce', prep: null, purpose: null, section: null, choiceGroup: null },
    ]);
  });

  it('keeps a line’s standing-swap opt-out, and writes the key only when it is set', () => {
    // normalizeIngredient rebuilds the row field by field, so a field it
    // doesn't name is a field that silently stops persisting.
    const optedOut = JSON.parse(JSON.stringify(parseRecipeIngredients(JSON.stringify([
      { id: 'a', name: 'Butter', nameKey: 'butter', quantity: '1 cup', noSwap: true },
    ]))));
    expect(optedOut[0].noSwap).toBe(true);

    // Off for nearly every line in the app, so it isn't stored as `false` on
    // all of them.
    const plain = parseRecipeIngredients(JSON.stringify([
      { id: 'a', name: 'Butter', nameKey: 'butter', quantity: '1 cup' },
    ]));
    expect('noSwap' in plain[0]).toBe(false);
  });

  it('reads a stored purpose clause', () => {
    const stored = JSON.stringify([
      { id: 'a', name: 'Limes', nameKey: 'limes', quantity: '3', aisle: 'Produce', prep: null, purpose: 'margaritas' },
    ]);
    expect(parseRecipeIngredients(stored)).toEqual([
      { id: 'a', name: 'Limes', nameKey: 'limes', quantity: '3', aisle: 'Produce', prep: null, purpose: 'margaritas', section: null, choiceGroup: null },
    ]);
  });

  it('reads a stored section label', () => {
    const stored = JSON.stringify([
      { id: 'a', name: 'Flour', nameKey: 'flour', quantity: '2 cups', aisle: null, prep: null, section: 'For the cake' },
    ]);
    expect(parseRecipeIngredients(stored)).toEqual([
      { id: 'a', name: 'Flour', nameKey: 'flour', quantity: '2 cups', aisle: null, prep: null, purpose: null, section: 'For the cake', choiceGroup: null },
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

describe('normalizeStep', () => {
  it('fills in a missing id and trims the text', () => {
    const s = normalizeStep({ text: '  Preheat the oven to 400°F  ' })!;
    expect(s.id).toBeTruthy();
    expect(s.text).toBe('Preheat the oven to 400°F');
  });

  it('returns null for a row with no usable text', () => {
    expect(normalizeStep({ text: '  ' })).toBeNull();
    expect(normalizeStep({})).toBeNull();
    expect(normalizeStep(null)).toBeNull();
    expect(normalizeStep('not an object')).toBeNull();
  });

  it('keeps a stored id rather than regenerating it', () => {
    const s = normalizeStep({ id: 's1', text: 'Preheat the oven' })!;
    expect(s.id).toBe('s1');
  });
});

describe('parseSteps', () => {
  it('reads a stored array', () => {
    const stored = JSON.stringify([{ id: 's1', text: 'Preheat the oven' }]);
    expect(parseSteps(stored)).toEqual([{ id: 's1', text: 'Preheat the oven' }]);
  });

  it('returns empty for null, corrupt JSON, a non-array, or a blob written before the column existed', () => {
    expect(parseSteps(null)).toEqual([]);
    expect(parseSteps('{not json')).toEqual([]);
    expect(parseSteps('{"a":1}')).toEqual([]);
    expect(parseSteps(undefined)).toEqual([]);
  });

  it('drops rows with no usable text rather than rendering blanks forever', () => {
    const stored = JSON.stringify([{ text: '  ' }, { text: 'Preheat the oven' }, null, 7]);
    expect(parseSteps(stored).map(s => s.text)).toEqual(['Preheat the oven']);
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

describe('prepTaskDraftsForMeal', () => {
  function prepTask(title: string, overrides: Partial<RecipePrepTask> = {}): RecipePrepTask {
    return { id: `p-${++seq}`, title, offsetDays: -1, reminderOffsetMinutes: null, ...overrides };
  }

  const mealDate = new Date(2026, 7, 15);

  it('is empty for a recipe with no prep steps', () => {
    const r = recipe('Toast');
    expect(prepTaskDraftsForMeal(r, new Map([[r.id, r]]), mealDate)).toEqual([]);
  });

  it('resolves each step against the meal date', () => {
    const r = recipe('Roast', {
      prepTasks: [prepTask('Defrost the beef', { offsetDays: -2 }), prepTask('Salt it', { offsetDays: 0 })],
    });
    const drafts = prepTaskDraftsForMeal(r, new Map([[r.id, r]]), mealDate);
    expect(drafts.map(d => d.title)).toEqual(['Defrost the beef', 'Salt it']);
    expect(new Date(drafts[0].dueDate).getDate()).toBe(13);
    expect(new Date(drafts[1].dueDate).getDate()).toBe(15);
    expect(drafts[0].reminderTime).toBeNull();
  });

  it("carries a reminder through from the step's offset", () => {
    const r = recipe('Roast', { prepTasks: [prepTask('Defrost', { reminderOffsetMinutes: 30 })] });
    const [draft] = prepTaskDraftsForMeal(r, new Map([[r.id, r]]), mealDate);
    expect(new Date(draft.dueDate).getTime() - new Date(draft.reminderTime!).getTime()).toBe(30 * 60_000);
  });

  it("includes a component's steps, anchored on the same meal date", () => {
    const mash = recipe('Mash', { prepTasks: [prepTask('Boil the potatoes', { offsetDays: -1 })] });
    const steak = recipe('Steak with mash', {
      prepTasks: [prepTask('Take the steak out', { offsetDays: 0 })],
      components: [component(mash.id, 'Mash')],
    });
    const drafts = prepTaskDraftsForMeal(steak, new Map([[steak.id, steak], [mash.id, mash]]), mealDate);
    expect(drafts.map(d => d.title)).toEqual(['Take the steak out', 'Boil the potatoes']);
    expect(new Date(drafts[1].dueDate).getDate()).toBe(14);
  });

  it('ignores a component whose recipe is gone', () => {
    const steak = recipe('Steak with mash', {
      prepTasks: [prepTask('Take the steak out')],
      components: [component('missing', 'Mash')],
    });
    const drafts = prepTaskDraftsForMeal(steak, new Map([[steak.id, steak]]), mealDate);
    expect(drafts.map(d => d.title)).toEqual(['Take the steak out']);
  });

  it('follows a meal’s own component pick, leaving out the unchosen side’s steps', () => {
    const mash = recipe('Mash', { prepTasks: [prepTask('Boil the potatoes', { offsetDays: -1 })] });
    const roast = recipe('Roast potatoes', { prepTasks: [prepTask('Heat the oven', { offsetDays: 0 })] });
    const steak = recipe('Steak dinner', {
      prepTasks: [prepTask('Take the steak out', { offsetDays: 0 })],
      components: [component(mash.id, 'Mash', 'Side'), component(roast.id, 'Roast potatoes', 'Side')],
    });
    const byId = new Map([[steak.id, steak], [mash.id, mash], [roast.id, roast]]);

    const onDefault = prepTaskDraftsForMeal(steak, byId, mealDate);
    expect(onDefault.map(d => d.title)).toEqual(['Take the steak out', 'Boil the potatoes']);

    const roastLinkId = steak.components[1].id;
    const onRoast = prepTaskDraftsForMeal(steak, byId, mealDate, { chosen: [roastLinkId] });
    expect(onRoast.map(d => d.title)).toEqual(['Take the steak out', 'Heat the oven']);
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
    expect(describeRecipe(withServings, { probablyHave: 1, viaSubstitute: 0 }))
      .toBe('2 ingredients · 1 likely in pantry · serves 2');
    expect(describeRecipe(withServings, { probablyHave: 6, viaSubstitute: 0 }))
      .toBe('2 ingredients · 6 likely in pantry · serves 2');
  });

  it('omits the pantry phrase for a null, undefined or all-zero count', () => {
    const r = recipe('H', { ingredients: [ing('Salt')] });
    expect(describeRecipe(r)).toBe('1 ingredient');
    expect(describeRecipe(r, null)).toBe('1 ingredient');
    expect(describeRecipe(r, { probablyHave: 0, viaSubstitute: 0 })).toBe('1 ingredient');
  });

  // #1568 — reported as its own clause, never folded into "likely in pantry".
  it('adds the substitute clause independently of the direct pantry count', () => {
    const r = recipe('I', { ingredients: [ing('Salt'), ing('Pepper')] });
    expect(describeRecipe(r, { probablyHave: 6, viaSubstitute: 1 }))
      .toBe('2 ingredients · 6 likely in pantry · 1 with a substitute');
    expect(describeRecipe(r, { probablyHave: 6, viaSubstitute: 2 }))
      .toBe('2 ingredients · 6 likely in pantry · 2 with a substitute');
    // Even with nothing directly on hand, a substitute-only recipe still says so.
    expect(describeRecipe(r, { probablyHave: 0, viaSubstitute: 1 }))
      .toBe('2 ingredients · 1 with a substitute');
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

  it('adds prep + cook as one combined duration', () => {
    expect(describeRecipe(recipe('I2', { ingredients: [ing('Salt')], prepMinutes: 10, estimatedMinutes: 25 })))
      .toBe('1 ingredient · 35m');
    expect(describeRecipe(recipe('I3', { ingredients: [ing('Salt')], prepMinutes: 10 })))
      .toBe('1 ingredient · 10m');
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

describe('sortRecipesBy', () => {
  it('defaults to sortRecipesForDisplay for "default"', () => {
    const a = recipe('A', { sortOrder: 1, favorite: false });
    const b = recipe('B', { sortOrder: 0, favorite: true });
    expect(sortRecipesBy([a, b], 'default').map(r => r.name)).toEqual(['B', 'A']);
  });

  it('sorts by name A-Z, ignoring favorite', () => {
    const a = recipe('Banana Bread', { favorite: false });
    const b = recipe('Apple Pie', { favorite: true });
    expect(sortRecipesBy([a, b], 'name').map(r => r.name)).toEqual(['Apple Pie', 'Banana Bread']);
  });

  it('sorts by most recently cooked, with never-cooked trailing', () => {
    const recent = recipe('Recent', { lastCookedAt: '2026-08-01T00:00:00.000Z' });
    const older = recipe('Older', { lastCookedAt: '2026-07-01T00:00:00.000Z' });
    const never = recipe('Never', { lastCookedAt: null });
    expect(sortRecipesBy([never, older, recent], 'cooked-recent').map(r => r.name))
      .toEqual(['Recent', 'Older', 'Never']);
  });

  it('sorts by oldest cooked, with never-cooked still trailing', () => {
    const recent = recipe('Recent', { lastCookedAt: '2026-08-01T00:00:00.000Z' });
    const older = recipe('Older', { lastCookedAt: '2026-07-01T00:00:00.000Z' });
    const never = recipe('Never', { lastCookedAt: null });
    expect(sortRecipesBy([never, recent, older], 'cooked-oldest').map(r => r.name))
      .toEqual(['Older', 'Recent', 'Never']);
  });

  it('sorts by ingredient count, ascending and descending', () => {
    const one = recipe('One', { ingredients: [ing('Salt')] });
    const three = recipe('Three', { ingredients: [ing('Salt'), ing('Pepper'), ing('Oil')] });
    expect(sortRecipesBy([three, one], 'ingredients-asc').map(r => r.name)).toEqual(['One', 'Three']);
    expect(sortRecipesBy([one, three], 'ingredients-desc').map(r => r.name)).toEqual(['Three', 'One']);
  });

  it('does not mutate the input array', () => {
    const list = [recipe('A', { sortOrder: 1 }), recipe('B', { sortOrder: 0 })];
    const original = [...list];
    sortRecipesBy(list, 'name');
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

  it('sorts each section with a caller-supplied comparator instead of the favorites-first default', () => {
    const a = recipe('Banana', { mealType: 'snack' });
    const b = recipe('Apple', { mealType: 'snack' });
    const sections = groupRecipesByMealType([a, b], list => sortRecipesBy(list, 'name'));
    expect(sections[0].data.map(r => r.name)).toEqual(['Apple', 'Banana']);
  });
});

describe('flattenRecipeMealTypeSections / recipeListItemKey', () => {
  it('interleaves a header row before each section, keyed by mealType', () => {
    const oatmeal = recipe('Oatmeal', { mealType: 'breakfast', sortOrder: 0 });
    const salad = recipe('Salad', { mealType: 'lunch', sortOrder: 0 });
    const sections = groupRecipesByMealType([oatmeal, salad]);
    const items = flattenRecipeMealTypeSections(sections);
    expect(items.map(i => (i.type === 'header' ? `header:${i.title}` : `recipe:${i.recipe.name}`)))
      .toEqual(['header:Breakfast', 'recipe:Oatmeal', 'header:Lunch', 'recipe:Salad']);
    expect(items.map(recipeListItemKey)).toEqual(['h-breakfast', oatmeal.id, 'h-lunch', salad.id]);
  });

  it('keys the untagged header distinctly from a real mealType', () => {
    const mystery = recipe('Mystery', { mealType: null, sortOrder: 0 });
    const items = flattenRecipeMealTypeSections(groupRecipesByMealType([mystery]));
    expect(items[0]).toEqual({ type: 'header', mealType: null, title: 'Untagged' });
    expect(recipeListItemKey(items[0])).toBe('h-untagged');
  });
});

describe('resolveRecipeMealTypeDrop', () => {
  it('re-tags a recipe dropped under a different header', () => {
    const oatmeal = recipe('Oatmeal', { mealType: 'breakfast', sortOrder: 0 });
    const salad = recipe('Salad', { mealType: 'lunch', sortOrder: 0 });
    // Oatmeal dragged out of Breakfast and dropped into Lunch.
    const reordered = flattenRecipeMealTypeSections([
      { mealType: 'breakfast', title: 'Breakfast', data: [] },
      { mealType: 'lunch', title: 'Lunch', data: [salad, oatmeal] },
    ]);
    const { mealTypeUpdates, settled } = resolveRecipeMealTypeDrop(reordered);
    expect(mealTypeUpdates).toEqual([{ id: oatmeal.id, mealType: 'lunch' }]);
    // Breakfast had nothing left, so groupRecipesByMealType drops the section
    // entirely rather than settling on an empty header.
    expect(settled.map(i => (i.type === 'header' ? i.title : i.recipe.name)))
      .toEqual(['Lunch', 'Salad', 'Oatmeal']);
  });

  it('drops a recipe into Untagged when moved under the trailing null header', () => {
    const salad = recipe('Salad', { mealType: 'lunch', sortOrder: 0 });
    const reordered = flattenRecipeMealTypeSections([
      { mealType: null, title: 'Untagged', data: [salad] },
    ]);
    const { mealTypeUpdates } = resolveRecipeMealTypeDrop(reordered);
    expect(mealTypeUpdates).toEqual([{ id: salad.id, mealType: null }]);
  });

  it('reports no updates when the drop leaves every recipe under its own header', () => {
    const oatmeal = recipe('Oatmeal', { mealType: 'breakfast', sortOrder: 0 });
    const reordered = flattenRecipeMealTypeSections(groupRecipesByMealType([oatmeal]));
    const { mealTypeUpdates } = resolveRecipeMealTypeDrop(reordered);
    expect(mealTypeUpdates).toEqual([]);
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

  it('finds a recipe by a tag, under a name match and over an ingredient one', () => {
    const tagged = recipe('Larb', { nameKey: 'larb', tags: ['thai'] });
    const named = recipe('Thai curry', { nameKey: 'thai curry' });
    const usesIt = recipe('Noodles', {
      nameKey: 'noodles',
      ingredients: [ing('Thai basil', { nameKey: 'thai basil' })],
    });

    const result = rankRecipes('thai', [usesIt, tagged, named]);
    expect(result.map(r => r.name)).toEqual(['Thai curry', 'Larb', 'Noodles']);
  });

  it('matches a hyphenated tag typed with its hyphen', () => {
    const gf = recipe('Brownies', { nameKey: 'brownies', tags: ['gluten-free'] });
    expect(rankRecipes('gluten-free', [gf]).map(r => r.name)).toEqual(['Brownies']);
  });

  it('breaks a tie on favourite', () => {
    const a = recipe('Chicken a', { nameKey: 'chicken a' });
    const b = recipe('Chicken b', { nameKey: 'chicken b', favorite: true });
    expect(rankRecipes('chicken', [a, b])[0].name).toBe('Chicken b');
  });

  it('drops what does not match at all', () => {
    expect(rankRecipes('lasagne', all)).toEqual([]);
  });

  it('finds a recipe by its author', () => {
    const cake = recipe('Chocolate cake', { nameKey: 'chocolate cake', author: 'Yotam Ottolenghi' });
    expect(rankRecipes('ottolenghi', [cake, ragu]).map(r => r.name)).toEqual(['Chocolate cake']);
  });

  it('finds a recipe by its source', () => {
    const salmon = recipe('Salmon', { nameKey: 'salmon', source: 'NYT Cooking' });
    expect(rankRecipes('nyt', [salmon, ragu]).map(r => r.name)).toEqual(['Salmon']);
  });

  it('finds a recipe by the legacy sourceName, which nothing backfilled', () => {
    const old = recipe('Short ribs', { nameKey: 'short ribs', sourceName: 'Alison Roman, Nothing Fancy' });
    // Either half of the un-split legacy string finds it.
    expect(rankRecipes('alison', [old]).map(r => r.name)).toEqual(['Short ribs']);
    expect(rankRecipes('nothing fancy', [old]).map(r => r.name)).toEqual(['Short ribs']);
  });

  it('ranks attribution under an ingredient match', () => {
    const byRoman = recipe('Pie', { nameKey: 'pie', author: 'Fennel Roman' });
    const usesIt = recipe('Soup', { nameKey: 'soup', ingredients: [ing('Fennel', { nameKey: 'fennel' })] });
    expect(rankRecipes('fennel', [byRoman, usesIt]).map(r => r.name)).toEqual(['Soup', 'Pie']);
  });

  it('finds a recipe by its notes, below every other kind of match', () => {
    const mentioned = recipe('Pasta', { nameKey: 'pasta', notes: 'Good with leftover chicken.' });
    const named = recipe('Chicken pie', { nameKey: 'chicken pie' });
    expect(rankRecipes('chicken', [mentioned, named]).map(r => r.name)).toEqual(['Chicken pie', 'Pasta']);
  });

  it('does not match a sourceUrl, whose punctuation collapses into one word', () => {
    const linked = recipe('Salmon', {
      nameKey: 'salmon',
      sourceUrl: 'https://cooking.nytimes.com/lemon-garlic-salmon',
    });
    expect(rankRecipes('https', [linked])).toEqual([]);
    expect(rankRecipes('nytimes', [linked])).toEqual([]);
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

describe('applyMeasuredPrepTime', () => {
  it('mirrors applyMeasuredCookTime — rounds, floors at 1 minute, advances the counters', () => {
    const r = recipe('Ragù', { prepMinutes: 10, prepTimeCount: 2, totalPrepMinutes: 20 });
    expect(applyMeasuredPrepTime(12.6, r)).toEqual({
      lastPrepMinutes: 13,
      prepTimeCount: 3,
      totalPrepMinutes: 33,
    });
    expect(applyMeasuredPrepTime(0.2, r).lastPrepMinutes).toBe(1);
  });

  it('backfills prepMinutes only the first time', () => {
    const untimed = recipe('Ragù', { prepMinutes: null, prepTimeCount: 0, totalPrepMinutes: 0 });
    expect(applyMeasuredPrepTime(8, untimed)).toEqual({
      lastPrepMinutes: 8,
      prepTimeCount: 1,
      totalPrepMinutes: 8,
      prepMinutes: 8,
    });

    const timed = recipe('Ragù', { prepMinutes: 10, prepTimeCount: 0, totalPrepMinutes: 0 });
    const patch = applyMeasuredPrepTime(15, timed);
    expect(patch).not.toHaveProperty('prepMinutes');
    expect(patch.lastPrepMinutes).toBe(15);
  });
});

describe('avgPrepMinutes', () => {
  it('is null before anything has been logged, and rounds the mean otherwise', () => {
    expect(avgPrepMinutes(recipe('Ragù', { prepTimeCount: 0, totalPrepMinutes: 0 }))).toBeNull();
    expect(avgPrepMinutes(recipe('Ragù', { prepTimeCount: 3, totalPrepMinutes: 100 }))).toBe(33);
  });
});

describe('describePrepTime', () => {
  it('mirrors describeCookTime\'s phrasing, targeting the prep fields', () => {
    expect(describePrepTime(recipe('Ragù'))).toBe('');
    expect(describePrepTime(recipe('Ragù', { prepMinutes: 10 }))).toBe('Est. 10m');
    expect(describePrepTime(recipe('Ragù', {
      prepMinutes: 10,
      lastPrepMinutes: 12,
      prepTimeCount: 1,
      totalPrepMinutes: 12,
    }))).toBe('Est. 10m · took 12m');
    expect(describePrepTime(recipe('Ragù', {
      prepMinutes: 10,
      lastPrepMinutes: 8,
      prepTimeCount: 4,
      totalPrepMinutes: 44,
    }))).toBe('Est. 10m · took 8m last time · avg 11m over 4 preps');
  });
});

describe('totalMinutes', () => {
  it('is null when neither prep nor cook time is set', () => {
    expect(totalMinutes(recipe('Ragù'))).toBeNull();
  });

  it('sums prep and cook when both are set', () => {
    expect(totalMinutes(recipe('Ragù', { prepMinutes: 10, estimatedMinutes: 25 }))).toBe(35);
  });

  it('treats an unset half as 0 once the other is set', () => {
    expect(totalMinutes(recipe('Ragù', { prepMinutes: 10, estimatedMinutes: null }))).toBe(10);
    expect(totalMinutes(recipe('Ragù', { prepMinutes: null, estimatedMinutes: 25 }))).toBe(25);
  });
});

describe('describeAttribution', () => {
  it('prefers author + source, falling back through source, then legacy sourceName', () => {
    expect(describeAttribution(recipe('R', { author: 'Alison Roman', source: 'Nothing Fancy' })))
      .toBe('by Alison Roman, Nothing Fancy');
    expect(describeAttribution(recipe('R', { author: 'Alison Roman' }))).toBe('by Alison Roman');
    expect(describeAttribution(recipe('R', { source: 'NYT Cooking' }))).toBe('NYT Cooking');
    expect(describeAttribution(recipe('R', { sourceName: 'Legacy Source' }))).toBe('Legacy Source');
    expect(describeAttribution(recipe('R'))).toBeNull();
  });

  it('appends a cookbook page number to the source, only for a cookbook source type', () => {
    expect(describeAttribution(recipe('R', {
      source: 'Nothing Fancy',
      sourceType: 'cookbook',
      sourcePage: '142',
    }))).toBe('Nothing Fancy, p. 142');
    expect(describeAttribution(recipe('R', {
      source: 'Nothing Fancy',
      sourceType: 'website',
      sourcePage: '142',
    }))).toBe('Nothing Fancy');
    expect(describeAttribution(recipe('R', {
      source: 'Nothing Fancy',
      sourceType: 'cookbook',
      sourcePage: null,
    }))).toBe('Nothing Fancy');
  });
});

describe('distinctRecipeValues / filterRecipeSuggestions', () => {
  it('collects distinct, alpha-sorted, trimmed values across other recipes, excluding one id', () => {
    const a = recipe('A', { source: 'NYT Cooking' });
    const b = recipe('B', { source: 'Bon Appétit' });
    const c = recipe('C', { source: '  NYT Cooking  ' }); // dupe once trimmed
    const d = recipe('D', { source: null });
    const recipes = [a, b, c, d];
    expect(distinctRecipeValues(recipes, undefined, r => r.source))
      .toEqual(['Bon Appétit', 'NYT Cooking']);
    expect(distinctRecipeValues(recipes, a.id, r => r.source))
      .toEqual(['Bon Appétit', 'NYT Cooking']); // c still supplies it once a is excluded
  });

  it('filters to a substring match, excluding an exact match, capped at 8', () => {
    const values = ['NYT Cooking', 'Bon Appétit', 'Nothing Fancy'];
    expect(filterRecipeSuggestions(values, 'cook')).toEqual(['NYT Cooking']);
    expect(filterRecipeSuggestions(values, 'NYT Cooking')).toEqual([]);
    expect(filterRecipeSuggestions(values, '')).toEqual(values);

    const many = Array.from({ length: 10 }, (_, i) => `Source ${i}`);
    expect(filterRecipeSuggestions(many, '')).toHaveLength(8);
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
    choiceGroup: null,
    ...overrides,
  } as GroceryItem;
}

// #1568 — a substitute link, for the "counts as covered" tests below.
function sub(itemId: string, subItemId: string): ItemSubLink {
  return { itemId, subItemId, note: null, createdAt: '2026-01-01T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: false };
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

  // #1103 — recency of last cook nudges the score.
  describe('recency of last cook', () => {
    const items = [item('Onions', { nameKey: 'onions' })];

    it('scores a never-cooked recipe above the same recipe cooked today', () => {
      const neverCooked = recipe('Never', { ingredients: [ing('Onions', { nameKey: 'onions' })] });
      const cookedToday = recipe('Today', {
        ingredients: [ing('Onions', { nameKey: 'onions' })],
        cookCount: 5,
        lastCookedAt: now.toISOString(),
      });
      expect(scoreRecipeAgainstCatalog(neverCooked, items, now))
        .toBeGreaterThan(scoreRecipeAgainstCatalog(cookedToday, items, now));
    });

    it('recovers toward the never-cooked score as the last cook fades into the past', () => {
      const cookedToday = recipe('Today', {
        ingredients: [ing('Onions', { nameKey: 'onions' })],
        lastCookedAt: now.toISOString(),
      });
      const cookedLongAgo = recipe('Long ago', {
        ingredients: [ing('Onions', { nameKey: 'onions' })],
        lastCookedAt: new Date(now.getTime() - 120 * 86_400_000).toISOString(),
      });
      const neverCooked = recipe('Never', { ingredients: [ing('Onions', { nameKey: 'onions' })] });

      const scoreToday = scoreRecipeAgainstCatalog(cookedToday, items, now);
      const scoreLongAgo = scoreRecipeAgainstCatalog(cookedLongAgo, items, now);
      const scoreNever = scoreRecipeAgainstCatalog(neverCooked, items, now);

      expect(scoreLongAgo).toBeGreaterThan(scoreToday);
      // Never asymptotes past "never cooked" — a cook 120 days ago still
      // reads as a hair less novel than one that's never happened at all.
      expect(scoreLongAgo).toBeLessThan(scoreNever);
      expect(scoreLongAgo).toBeCloseTo(scoreNever, 2);
    });

    it('never discounts a recipe by more than half, however recently it was cooked', () => {
      const cookedThisMinute = recipe('Just now', {
        ingredients: [ing('Onions', { nameKey: 'onions' })],
        lastCookedAt: now.toISOString(),
      });
      const bare = scoreRecipeAgainstCatalog(
        recipe('Bare', { ingredients: [ing('Onions', { nameKey: 'onions' })] }),
        items,
        now
      );
      expect(scoreRecipeAgainstCatalog(cookedThisMinute, items, now)).toBeGreaterThanOrEqual(bare * 0.5 - 1e-9);
    });

    it('never lets recency alone beat a well-stocked recipe over a poorly-stocked one cooked long ago', () => {
      const wellStocked = recipe('Well stocked', {
        ingredients: [ing('Onions', { nameKey: 'onions' }), ing('Garlic', { nameKey: 'garlic' })],
        lastCookedAt: now.toISOString(), // cooked minutes ago — takes the full discount
      });
      const poorlyStocked = recipe('Poorly stocked', {
        ingredients: [
          ing('Onions', { nameKey: 'onions' }),
          ing('Saffron', { nameKey: 'saffron' }),
          ing('Truffle', { nameKey: 'truffle' }),
          ing('Vanilla', { nameKey: 'vanilla' }),
          ing('Cardamom', { nameKey: 'cardamom' }),
        ],
        lastCookedAt: new Date(now.getTime() - 200 * 86_400_000).toISOString(), // essentially undiscounted
      });
      const stockedItems = [item('Onions', { nameKey: 'onions' }), item('Garlic', { nameKey: 'garlic' })];
      expect(scoreRecipeAgainstCatalog(wellStocked, stockedItems, now))
        .toBeGreaterThan(scoreRecipeAgainstCatalog(poorlyStocked, stockedItems, now));
    });
  });

  // #1568 — a substitute-covered ingredient counts for less than a direct
  // match. It can't change `matched`/`coverage` at all (a link can only exist
  // between two rows that are already catalog items, so an ingredient with no
  // catalog row can never carry one) — what it can fix is a stale or
  // never-bought row's contribution to the recency average.
  describe('via a substitute', () => {
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

    it('scores a stale row higher when its linked substitute is genuinely on hand', () => {
      const r = recipe('Cake', { ingredients: [ing('Butter', { nameKey: 'butter' })] });
      const butter = item('Butter', { nameKey: 'butter', purchaseCount: 0 }); // never bought — a 0.5 wash
      const margarine = item('Margarine', {
        nameKey: 'margarine', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(1),
      });
      const withoutLink = scoreRecipeAgainstCatalog(r, [butter, margarine], now);
      const withLink = scoreRecipeAgainstCatalog(r, [butter, margarine], now, undefined, [sub(butter.id, margarine.id)]);
      expect(withLink).toBeGreaterThan(withoutLink);
    });

    it('never lets a substitute-only recipe outrank the same recipe genuinely fresh', () => {
      const r = recipe('Cake', { ingredients: [ing('Butter', { nameKey: 'butter' })] });
      const staleButter = item('Butter', { nameKey: 'butter', purchaseCount: 0 });
      const freshButter = item('Butter', {
        nameKey: 'butter', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(1),
      });
      const margarine = item('Margarine', {
        nameKey: 'margarine', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(1),
      });
      const viaSubstitute = scoreRecipeAgainstCatalog(r, [staleButter, margarine], now, undefined, [
        sub(staleButter.id, margarine.id),
      ]);
      const direct = scoreRecipeAgainstCatalog(r, [freshButter], now);
      expect(direct).toBeGreaterThan(viaSubstitute);
    });

    it('does not affect coverage — an ingredient with no catalog row can never carry a link', () => {
      const r = recipe('Ragù', {
        ingredients: [ing('Onions', { nameKey: 'onions' }), ing('Saffron', { nameKey: 'saffron' })],
      });
      const items = [item('Onions', { nameKey: 'onions' })];
      // A link naming a row that doesn't exist is inert — resolve-or-shrug,
      // same as every other cross-row pointer in this feature.
      expect(scoreRecipeAgainstCatalog(r, items, now, undefined, [sub('saffron-row-that-does-not-exist', items[0].id)]))
        .toBe(scoreRecipeAgainstCatalog(r, items, now));
    });
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
    // Onions: on the list already, so it's alreadyOnList/inCart, not probablyHave.
    const onions = item('Onions', { nameKey: 'onions', onList: true });
    // Saffron: no catalog row at all.
    const r = recipe('Ragù', {
      ingredients: [
        ing('Milk', { nameKey: 'milk' }),
        ing('Onions', { nameKey: 'onions' }),
        ing('Saffron', { nameKey: 'saffron' }),
      ],
    });
    expect(countLikelyInPantry(r, [milk, onions], now)).toEqual({ probablyHave: 1, viaSubstitute: 0 });
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
    expect(countLikelyInPantry(steak, [milk], now, new Map([[steak.id, steak], [mash.id, mash]]))).toEqual({ probablyHave: 1, viaSubstitute: 0 });
  });

  // #1568 — an ingredient with no pantry match of its own, whose linked
  // substitute the app thinks is on hand, counts as its own clause.
  describe('via a substitute', () => {
    it('counts an ingredient covered only through a linked substitute', () => {
      const butter = item('Butter', { nameKey: 'butter', purchaseCount: 0 });
      const margarine = item('Margarine', {
        nameKey: 'margarine', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
      });
      const r = recipe('Cake', { ingredients: [ing('Butter', { nameKey: 'butter' })] });
      expect(countLikelyInPantry(r, [butter, margarine], now, undefined, [sub(butter.id, margarine.id)]))
        .toEqual({ probablyHave: 0, viaSubstitute: 1 });
    });

    it('reports both counts, never folded into one', () => {
      const butter = item('Butter', { nameKey: 'butter', purchaseCount: 0 });
      const margarine = item('Margarine', {
        nameKey: 'margarine', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
      });
      const milk = item('Milk', { nameKey: 'milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10) });
      const r = recipe('Cake', {
        ingredients: [ing('Butter', { nameKey: 'butter' }), ing('Milk', { nameKey: 'milk' })],
      });
      expect(countLikelyInPantry(r, [butter, margarine, milk], now, undefined, [sub(butter.id, margarine.id)]))
        .toEqual({ probablyHave: 1, viaSubstitute: 1 });
    });

    it('does not read the link backwards', () => {
      // The link says "instead of butter, margarine" — needing margarine with
      // butter on hand is the other direction, which nobody asserted.
      const butter = item('Butter', {
        nameKey: 'butter', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
      });
      const margarine = item('Margarine', { nameKey: 'margarine', purchaseCount: 0 });
      const r = recipe('Toast', { ingredients: [ing('Margarine', { nameKey: 'margarine' })] });
      expect(countLikelyInPantry(r, [butter, margarine], now, undefined, [sub(butter.id, margarine.id)]))
        .toBeNull();
    });

    it('says nothing when the app has no opinion about the substitute either', () => {
      const butter = item('Butter', { nameKey: 'butter', purchaseCount: 0 });
      const margarine = item('Margarine', { nameKey: 'margarine', purchaseCount: 0 });
      const r = recipe('Cake', { ingredients: [ing('Butter', { nameKey: 'butter' })] });
      expect(countLikelyInPantry(r, [butter, margarine], now, undefined, [sub(butter.id, margarine.id)]))
        .toBeNull();
    });

    it('does not double count an ingredient that is already a direct pantry match', () => {
      const butter = item('Butter', {
        nameKey: 'butter', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
      });
      const margarine = item('Margarine', {
        nameKey: 'margarine', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
      });
      const r = recipe('Cake', { ingredients: [ing('Butter', { nameKey: 'butter' })] });
      expect(countLikelyInPantry(r, [butter, margarine], now, undefined, [sub(butter.id, margarine.id)]))
        .toEqual({ probablyHave: 1, viaSubstitute: 0 });
    });
  });
});

// #1103 — the percentage form of countLikelyInPantry, plus enough of its
// denominator to tell "checked, and it's low" apart from "nothing to check".
describe('pantryCoverageForRecipe', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  function daysAgo(n: number): string {
    return new Date(now.getTime() - n * 86_400_000).toISOString();
  }

  it('is all-zero with a null percent for a recipe with no ingredients', () => {
    expect(pantryCoverageForRecipe(recipe('Toast', { ingredients: [] }), [], now))
      .toEqual({ total: 0, catalogMatches: 0, probablyHave: 0, viaSubstitute: 0, percent: null });
  });

  it('has a null percent when nothing in the recipe has ever been added to the catalog', () => {
    const r = recipe('Ragù', { ingredients: [ing('Saffron', { nameKey: 'saffron' })] });
    expect(pantryCoverageForRecipe(r, [], now)).toEqual({ total: 1, catalogMatches: 0, probablyHave: 0, viaSubstitute: 0, percent: null });
  });

  it('is a real 0%, not null, when the catalog knows the ingredient but has no purchase history for it', () => {
    // In the catalog (so catalogMatches counts it) but never bought — no
    // cadence to trust, so it can't read as probably-have.
    const saffron = item('Saffron', { nameKey: 'saffron', purchaseCount: 0 });
    const r = recipe('Ragù', { ingredients: [ing('Saffron', { nameKey: 'saffron' })] });
    expect(pantryCoverageForRecipe(r, [saffron], now)).toEqual({ total: 1, catalogMatches: 1, probablyHave: 0, viaSubstitute: 0, percent: 0 });
  });

  it('computes a percentage over the whole recipe, not just the catalog matches', () => {
    // Milk: bought every ~30 days, last one 10 days ago — reads as probably-have.
    const milk = item('Milk', { nameKey: 'milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10) });
    const r = recipe('Breakfast', {
      ingredients: [
        ing('Milk', { nameKey: 'milk' }),
        ing('Eggs', { nameKey: 'eggs' }), // no catalog row
        ing('Bread', { nameKey: 'bread' }), // no catalog row
        ing('Butter', { nameKey: 'butter' }), // no catalog row
      ],
    });
    const coverage = pantryCoverageForRecipe(r, [milk], now);
    expect(coverage).toEqual({ total: 4, catalogMatches: 1, probablyHave: 1, viaSubstitute: 0, percent: 25 });
  });

  it('folds a composed recipe\'s components in, given the library', () => {
    const milk = item('Milk', { nameKey: 'milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10) });
    const mash = recipe('Mash', { ingredients: [ing('Milk', { nameKey: 'milk' })] });
    const steak = recipe('Steak dinner', {
      ingredients: [ing('Steak', { nameKey: 'steak' })],
      components: [component(mash.id, 'Mash')],
    });

    // Standing alone, the parent doesn't even see the mash's milk.
    expect(pantryCoverageForRecipe(steak, [milk], now))
      .toEqual({ total: 1, catalogMatches: 0, probablyHave: 0, viaSubstitute: 0, percent: null });

    expect(pantryCoverageForRecipe(steak, [milk], now, new Map([[steak.id, steak], [mash.id, mash]])))
      .toEqual({ total: 2, catalogMatches: 1, probablyHave: 1, viaSubstitute: 0, percent: 50 });
  });

  // #1568 — viaSubstitute is counted, but percent stays a direct-match-only
  // number: a substitute is real (user-authored) but not the same fact.
  it('counts a substitute-covered line without folding it into percent', () => {
    const butter = item('Butter', { nameKey: 'butter', purchaseCount: 0 });
    const margarine = item('Margarine', {
      nameKey: 'margarine', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
    });
    const r = recipe('Cake', {
      ingredients: [ing('Butter', { nameKey: 'butter' }), ing('Eggs', { nameKey: 'eggs' })],
    });
    expect(pantryCoverageForRecipe(r, [butter, margarine], now, undefined, [sub(butter.id, margarine.id)]))
      .toEqual({ total: 2, catalogMatches: 1, probablyHave: 0, viaSubstitute: 1, percent: 0 });
  });
});

describe('describePantryCoverage', () => {
  it('is null for a recipe with no ingredients', () => {
    expect(describePantryCoverage({ total: 0, catalogMatches: 0, probablyHave: 0, viaSubstitute: 0, percent: null })).toBeNull();
  });

  it('names the degraded state rather than showing 0% when nothing is in the catalog at all', () => {
    expect(describePantryCoverage({ total: 3, catalogMatches: 0, probablyHave: 0, viaSubstitute: 0, percent: null }))
      .toBe('None of these have been on your list yet');
  });

  // The wording names catalog membership rather than purchase history, because
  // that's the branch's actual condition: a catalogued-but-never-bought row
  // takes the *other* branch and renders a real 0, so "no purchase history"
  // described both states while only gating one.
  it('still renders a fraction for a catalogued line nobody has bought', () => {
    expect(describePantryCoverage({ total: 3, catalogMatches: 3, probablyHave: 0, viaSubstitute: 0, percent: 0 }))
      .toBe('0/3 likely on hand');
  });

  it('renders the fraction, including a real 0, once there is history to judge from', () => {
    expect(describePantryCoverage({ total: 4, catalogMatches: 1, probablyHave: 1, viaSubstitute: 0, percent: 25 })).toBe('1/4 likely on hand');
    expect(describePantryCoverage({ total: 1, catalogMatches: 1, probablyHave: 0, viaSubstitute: 0, percent: 0 })).toBe('0/1 likely on hand');
  });

  // #1568 — the trailing clause, never folded into the fraction.
  it('appends the substitute clause on its own, whatever the base state is', () => {
    expect(describePantryCoverage({ total: 4, catalogMatches: 1, probablyHave: 1, viaSubstitute: 1, percent: 25 }))
      .toBe('1/4 likely on hand · 1 with a substitute');
    expect(describePantryCoverage({ total: 4, catalogMatches: 1, probablyHave: 1, viaSubstitute: 2, percent: 25 }))
      .toBe('1/4 likely on hand · 2 with a substitute');
  });
});

describe('suggestRecipesForEmptyNight', () => {
  const now = new Date(2026, 7, 12);

  it('excludes a recipe with no catalog overlap', () => {
    const r = recipe('Ragù', { ingredients: [ing('Saffron', { nameKey: 'saffron' })] });
    expect(suggestRecipesForEmptyNight([r], [], now)).toEqual([]);
  });

  it('excludes a recipe under the coverage floor even with a real overlap', () => {
    const r = recipe('Mostly missing', {
      ingredients: Array.from({ length: 11 }, (_, i) => ing(`Ingredient ${i}`, { nameKey: `ingredient-${i}` })),
    });
    const items = [item('Ingredient 0', { nameKey: 'ingredient-0' })];
    expect(suggestRecipesForEmptyNight([r], items, now)).toEqual([]);
  });

  // #1568 — a substitute link can only ever exist between two rows that are
  // already catalog items, so it never grows the denominator a name with no
  // catalog row at all is missing from. It's a nudge to the ranking of
  // recipes that already clear the floor, never a way past the floor itself.
  it('does not let a substitute link push a recipe over the coverage floor', () => {
    const r = recipe('Mostly missing', {
      ingredients: Array.from({ length: 11 }, (_, i) => ing(`Ingredient ${i}`, { nameKey: `ingredient-${i}` })),
    });
    const items = [
      item('Ingredient 0', { nameKey: 'ingredient-0' }),
      item('Ingredient 1', { nameKey: 'ingredient-1' }),
    ];
    expect(
      suggestRecipesForEmptyNight([r], items, now, 3, [sub(items[0].id, items[1].id)])
    ).toEqual([]);
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

  it('ranks a recipe cooked last night below the same-coverage one that has never been cooked (#1103)', () => {
    const items = [item('Onions', { nameKey: 'onions' })];
    const cookedLastNight = recipe('Cooked last night', {
      ingredients: [ing('Onions', { nameKey: 'onions' })],
      cookCount: 3,
      lastCookedAt: new Date(now.getTime() - 86_400_000).toISOString(),
    });
    const neverCooked = recipe('Never cooked', { ingredients: [ing('Onions', { nameKey: 'onions' })] });
    expect(suggestRecipesForEmptyNight([cookedLastNight, neverCooked], items, now).map(r => r.name))
      .toEqual(['Never cooked', 'Cooked last night']);
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

describe('looksLikeBareUrl', () => {
  it('recognises a pasted link on its own', () => {
    expect(looksLikeBareUrl('https://cooking.nytimes.com/recipes/1020000-chili')).toBe(true);
    expect(looksLikeBareUrl('  http://example.com/x  ')).toBe(true);
    expect(looksLikeBareUrl('www.seriouseats.com/best-chili')).toBe(true);
  });

  it('recognises several links pasted together', () => {
    expect(looksLikeBareUrl('https://a.com/one\n\nhttps://b.com/two')).toBe(true);
  });

  it('lets a real paste through even when it mentions a link', () => {
    expect(looksLikeBareUrl('Chili\n2 cans black beans\nadapted from https://a.com')).toBe(false);
    expect(looksLikeBareUrl('adapted from https://a.com, but with less salt')).toBe(false);
  });

  it('is false for nothing at all, so an empty box is not an error', () => {
    expect(looksLikeBareUrl('')).toBe(false);
    expect(looksLikeBareUrl('   \n  ')).toBe(false);
  });

  it('is false for ordinary text', () => {
    expect(looksLikeBareUrl('2 cups flour')).toBe(false);
  });
});
