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
} from '../utils/recipeUtils';
import type { Recipe, RecipeIngredient } from '../types';

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
    servings: null,
    ingredients: [],
    favorite: false,
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
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

  it('does not strip a leading prep word — that case is a guess, not a convention match', () => {
    expect(splitPrep('grated cheddar')).toEqual({ name: 'grated cheddar', prep: null });
    expect(splitPrep('ground cumin')).toEqual({ name: 'ground cumin', prep: null });
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
