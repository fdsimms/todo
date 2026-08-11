import { useRecipeStore } from '../store/useRecipeStore';
import {
  dbGetAllRecipes,
  dbInsertRecipe,
  dbUpdateRecipe,
  dbDeleteRecipe,
} from '../db/database';
import type { Recipe, RecipeIngredient } from '../types';

jest.mock('../db/database', () => ({
  dbGetAllRecipes: jest.fn().mockReturnValue([]),
  dbInsertRecipe: jest.fn(),
  dbUpdateRecipe: jest.fn(),
  dbDeleteRecipe: jest.fn(),
}));

let seq = 0;
function makeRecipe(name: string, overrides: Partial<Recipe> = {}): Recipe {
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

function seed(recipes: Recipe[]) {
  useRecipeStore.setState({ recipes, initialized: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetAllRecipes as jest.Mock).mockReturnValue([]);
  seed([]);
});

describe('initialize', () => {
  it('loads what the db holds', () => {
    const ragu = makeRecipe('Ragu');
    (dbGetAllRecipes as jest.Mock).mockReturnValue([ragu]);

    useRecipeStore.getState().initialize();

    expect(useRecipeStore.getState().recipes).toEqual([ragu]);
    expect(useRecipeStore.getState().initialized).toBe(true);
  });
});

describe('addRecipe', () => {
  it('inserts a recipe keyed on the catalog normaliser', () => {
    const recipe = useRecipeStore.getState().addRecipe('  Sausage   ragù ')!;

    expect(recipe.name).toBe('Sausage ragù');
    expect(recipe.nameKey).toBe('sausage ragu');
    expect(recipe.ingredients).toEqual([]);
    expect(dbInsertRecipe).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty name', () => {
    expect(useRecipeStore.getState().addRecipe('   ')).toBeNull();
    expect(dbInsertRecipe).not.toHaveBeenCalled();
  });

  it('refuses a name that already exists, however it is spelled', () => {
    seed([makeRecipe('Ragu', { nameKey: 'ragu' })]);
    expect(useRecipeStore.getState().addRecipe('RAGU')).toBeNull();
    expect(useRecipeStore.getState().recipes).toHaveLength(1);
  });

  it('hands each new recipe the next sort order', () => {
    useRecipeStore.getState().addRecipe('One');
    const second = useRecipeStore.getState().addRecipe('Two')!;
    expect(second.sortOrder).toBe(2);
  });
});

describe('renameRecipe', () => {
  it('moves the name and the key together', () => {
    const r = makeRecipe('Ragu', { nameKey: 'ragu' });
    seed([r]);

    expect(useRecipeStore.getState().renameRecipe(r.id, 'Sausage ragu')).toBe(true);

    const updated = useRecipeStore.getState().recipeById(r.id)!;
    expect(updated.name).toBe('Sausage ragu');
    expect(updated.nameKey).toBe('sausage ragu');
  });

  it('allows a capitalisation-only rename, which keeps the same key', () => {
    const r = makeRecipe('ragu', { nameKey: 'ragu' });
    seed([r]);

    expect(useRecipeStore.getState().renameRecipe(r.id, 'Ragu')).toBe(true);
    expect(useRecipeStore.getState().recipeById(r.id)!.name).toBe('Ragu');
  });

  it('refuses a collision with another recipe', () => {
    const a = makeRecipe('Ragu', { nameKey: 'ragu' });
    const b = makeRecipe('Soup', { nameKey: 'soup' });
    seed([a, b]);

    expect(useRecipeStore.getState().renameRecipe(b.id, 'ragu')).toBe(false);
    expect(useRecipeStore.getState().recipeById(b.id)!.name).toBe('Soup');
  });

  it('refuses an empty name', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    expect(useRecipeStore.getState().renameRecipe(r.id, '  ')).toBe(false);
  });
});

describe('field setters', () => {
  it('trims notes and normalises an empty url to null', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().setNotes(r.id, '  low and slow  ');
    useRecipeStore.getState().setSourceUrl(r.id, '   ');

    const updated = useRecipeStore.getState().recipeById(r.id)!;
    expect(updated.notes).toBe('low and slow');
    expect(updated.sourceUrl).toBeNull();
  });

  it('trims a source name and normalises an empty one to null', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().setSourceName(r.id, '  NYT Cooking  ');
    expect(useRecipeStore.getState().recipeById(r.id)!.sourceName).toBe('NYT Cooking');

    useRecipeStore.getState().setSourceName(r.id, '   ');
    expect(useRecipeStore.getState().recipeById(r.id)!.sourceName).toBeNull();
  });

  it('clamps servings into range and allows clearing it', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().setServings(r.id, 400);
    expect(useRecipeStore.getState().recipeById(r.id)!.servings).toBe(99);

    useRecipeStore.getState().setServings(r.id, 0);
    expect(useRecipeStore.getState().recipeById(r.id)!.servings).toBe(1);

    useRecipeStore.getState().setServings(r.id, null);
    expect(useRecipeStore.getState().recipeById(r.id)!.servings).toBeNull();
  });

  it('toggles favourite', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().toggleFavorite(r.id);
    expect(useRecipeStore.getState().recipeById(r.id)!.favorite).toBe(true);
    useRecipeStore.getState().toggleFavorite(r.id);
    expect(useRecipeStore.getState().recipeById(r.id)!.favorite).toBe(false);
  });

  it('ignores an id that no longer resolves', () => {
    seed([]);
    useRecipeStore.getState().setNotes('gone', 'x');
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });
});

describe('ingredients', () => {
  it('adds a typed line, quantity split out', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    const added = useRecipeStore.getState().addIngredient(r.id, '2 lb chicken thighs')!;

    expect(added.name).toBe('chicken thighs');
    expect(added.quantity).toBe('2 lb');
    expect(useRecipeStore.getState().recipeById(r.id)!.ingredients).toHaveLength(1);
  });

  it('refuses a duplicate rather than adding a second row for one shelf item', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    useRecipeStore.getState().addIngredient(r.id, 'Garlic');

    expect(useRecipeStore.getState().addIngredient(r.id, ' GARLIC ')).toBeNull();
    expect(useRecipeStore.getState().recipeById(r.id)!.ingredients).toHaveLength(1);
  });

  it('recognizes clove/cloves as a unit', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    const added = useRecipeStore.getState().addIngredient(r.id, '3 cloves garlic')!;

    expect(added.name).toBe('garlic');
    expect(added.quantity).toBe('3 cloves');
  });

  it('adds a pasted block and reports how many were new', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    useRecipeStore.getState().addIngredient(r.id, 'Garlic');

    const added = useRecipeStore.getState().addIngredientsFromText(r.id, '- Garlic\n- 2 onions\n- 1 bunch parsley');

    expect(added).toBe(2);
    expect(useRecipeStore.getState().recipeById(r.id)!.ingredients.map(i => i.name))
      .toEqual(['Garlic', 'onions', 'parsley']);
  });

  it('writes nothing when a paste adds nothing new', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    useRecipeStore.getState().addIngredient(r.id, 'Garlic');
    jest.clearAllMocks();

    expect(useRecipeStore.getState().addIngredientsFromText(r.id, 'garlic')).toBe(0);
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });
});

describe('addStructuredIngredients', () => {
  const struct = (name: string, overrides: Partial<RecipeIngredient> = {}): RecipeIngredient => ({
    id: `s-${name}`, name, nameKey: name.toLowerCase(), quantity: '', aisle: null, prep: null, ...overrides,
  });

  it('merges already-parsed ingredients, reporting how many were new', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    const added = useRecipeStore.getState().addStructuredIngredients(r.id, [
      struct('Ground beef', { nameKey: 'ground beef', quantity: '2 lb', aisle: 'Meat' }),
      struct('Garlic', { nameKey: 'garlic' }),
    ]);

    expect(added).toBe(2);
    const ingredients = useRecipeStore.getState().recipeById(r.id)!.ingredients;
    expect(ingredients.map(i => i.name)).toEqual(['Ground beef', 'Garlic']);
    expect(ingredients[0].quantity).toBe('2 lb');
    expect(ingredients[0].aisle).toBe('Meat');
  });

  it('keeps the existing row on a key collision rather than overwriting it', () => {
    const r = makeRecipe('Ragu', {
      ingredients: [{ id: 'i1', name: 'Garlic', nameKey: 'garlic', quantity: '3 cloves', aisle: null, prep: null }],
    });
    seed([r]);

    const added = useRecipeStore.getState().addStructuredIngredients(r.id, [
      struct('garlic', { nameKey: 'garlic', quantity: '1 bulb' }),
    ]);

    expect(added).toBe(0);
    expect(useRecipeStore.getState().recipeById(r.id)!.ingredients[0].quantity).toBe('3 cloves');
  });

  it('shrugs at an unknown recipe id', () => {
    seed([]);
    expect(useRecipeStore.getState().addStructuredIngredients('gone', [struct('Garlic')])).toBe(0);
  });

  it('moves the key when a patch changes the name', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    const ingredient = useRecipeStore.getState().addIngredient(r.id, 'Tomatos')!;

    useRecipeStore.getState().updateIngredient(r.id, ingredient.id, { name: 'Tomatoes' });

    const updated = useRecipeStore.getState().recipeById(r.id)!.ingredients[0];
    expect(updated.name).toBe('Tomatoes');
    expect(updated.nameKey).toBe('tomatoes');
  });

  it('patches quantity and aisle without touching the key', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    const ingredient = useRecipeStore.getState().addIngredient(r.id, 'Garlic')!;

    useRecipeStore.getState().updateIngredient(r.id, ingredient.id, { quantity: '1 bulb', aisle: 'Produce' });

    const updated = useRecipeStore.getState().recipeById(r.id)!.ingredients[0];
    expect(updated.quantity).toBe('1 bulb');
    expect(updated.aisle).toBe('Produce');
    expect(updated.nameKey).toBe('garlic');
  });

  it('removes one', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    const ingredient = useRecipeStore.getState().addIngredient(r.id, 'Garlic')!;

    useRecipeStore.getState().removeIngredient(r.id, ingredient.id);

    expect(useRecipeStore.getState().recipeById(r.id)!.ingredients).toEqual([]);
  });

  it('reorders, and keeps anything the caller did not name', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    const a = useRecipeStore.getState().addIngredient(r.id, 'Garlic')!;
    const b = useRecipeStore.getState().addIngredient(r.id, 'Onions')!;
    const c = useRecipeStore.getState().addIngredient(r.id, 'Parsley')!;

    // A stale list naming only two must not delete the third.
    useRecipeStore.getState().reorderIngredients(r.id, [c.id, a.id]);

    expect(useRecipeStore.getState().recipeById(r.id)!.ingredients.map(i => i.id))
      .toEqual([c.id, a.id, b.id]);
  });
});

describe('prepTasks', () => {
  it('adds one, defaulting to a day before with no reminder', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    const added = useRecipeStore.getState().addPrepTask(r.id, '  Defrost the chicken  ')!;

    expect(added.title).toBe('Defrost the chicken');
    expect(added.offsetDays).toBe(-1);
    expect(added.reminderOffsetMinutes).toBeNull();
    expect(useRecipeStore.getState().recipeById(r.id)!.prepTasks).toEqual([added]);
  });

  it('refuses a blank title', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    expect(useRecipeStore.getState().addPrepTask(r.id, '   ')).toBeNull();
    expect(useRecipeStore.getState().recipeById(r.id)!.prepTasks).toEqual([]);
  });

  it('patches the offset and reminder', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    const task = useRecipeStore.getState().addPrepTask(r.id, 'Marinate')!;

    useRecipeStore.getState().updatePrepTask(r.id, task.id, { offsetDays: -2, reminderOffsetMinutes: 30 });

    const updated = useRecipeStore.getState().recipeById(r.id)!.prepTasks[0];
    expect(updated.offsetDays).toBe(-2);
    expect(updated.reminderOffsetMinutes).toBe(30);
  });

  it('removes one', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    const task = useRecipeStore.getState().addPrepTask(r.id, 'Marinate')!;

    useRecipeStore.getState().removePrepTask(r.id, task.id);

    expect(useRecipeStore.getState().recipeById(r.id)!.prepTasks).toEqual([]);
  });

  it('shrugs at a recipe or prep task id it does not hold', () => {
    seed([]);
    expect(useRecipeStore.getState().addPrepTask('gone', 'Marinate')).toBeNull();

    const r = makeRecipe('Ragu');
    seed([r]);
    useRecipeStore.getState().updatePrepTask(r.id, 'gone', { offsetDays: -2 });
    useRecipeStore.getState().removePrepTask(r.id, 'gone');
    expect(useRecipeStore.getState().recipeById(r.id)!.prepTasks).toEqual([]);
  });
});

describe('remapIngredientKey', () => {
  it('rewrites every recipe that referenced the old key, and only those', () => {
    const ragu = makeRecipe('Ragu', {
      ingredients: [
        { id: 'i1', name: 'Tomatos', nameKey: 'tomatos', quantity: '', aisle: null, prep: null },
      ],
    });
    const soup = makeRecipe('Soup', {
      ingredients: [
        { id: 'i2', name: 'Carrots', nameKey: 'carrots', quantity: '', aisle: null, prep: null },
      ],
    });
    seed([ragu, soup]);

    useRecipeStore.getState().remapIngredientKey('tomatos', 'tomatoes');

    expect(useRecipeStore.getState().recipeById(ragu.id)!.ingredients[0].nameKey).toBe('tomatoes');
    expect(useRecipeStore.getState().recipeById(soup.id)!.ingredients[0].nameKey).toBe('carrots');
    expect(dbUpdateRecipe).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when nothing referenced the old key', () => {
    seed([makeRecipe('Ragu')]);
    useRecipeStore.getState().remapIngredientKey('tomatos', 'tomatoes');
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });
});

describe('deleteRecipe', () => {
  it('drops the row', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().deleteRecipe(r.id);

    expect(dbDeleteRecipe).toHaveBeenCalledWith(r.id);
    expect(useRecipeStore.getState().recipes).toEqual([]);
  });
});

describe('bulkDeleteRecipes', () => {
  it('drops every named row, in one db call each, and leaves the rest', () => {
    const a = makeRecipe('Ragu');
    const b = makeRecipe('Soup');
    const c = makeRecipe('Stew');
    seed([a, b, c]);

    useRecipeStore.getState().bulkDeleteRecipes([a.id, c.id]);

    expect(dbDeleteRecipe).toHaveBeenCalledTimes(2);
    expect(dbDeleteRecipe).toHaveBeenCalledWith(a.id);
    expect(dbDeleteRecipe).toHaveBeenCalledWith(c.id);
    expect(useRecipeStore.getState().recipes.map(r => r.id)).toEqual([b.id]);
  });

  it('writes nothing for an empty selection', () => {
    seed([makeRecipe('Ragu')]);
    useRecipeStore.getState().bulkDeleteRecipes([]);
    expect(dbDeleteRecipe).not.toHaveBeenCalled();
    expect(useRecipeStore.getState().recipes).toHaveLength(1);
  });
});

describe('bulkSetFavorite', () => {
  it('favorites every named recipe and leaves the rest alone', () => {
    const a = makeRecipe('Ragu');
    const b = makeRecipe('Soup', { favorite: true });
    const c = makeRecipe('Stew');
    seed([a, b, c]);

    useRecipeStore.getState().bulkSetFavorite([a.id, c.id], true);

    expect(useRecipeStore.getState().recipeById(a.id)!.favorite).toBe(true);
    expect(useRecipeStore.getState().recipeById(b.id)!.favorite).toBe(true);
    expect(useRecipeStore.getState().recipeById(c.id)!.favorite).toBe(true);
    expect(dbUpdateRecipe).toHaveBeenCalledTimes(2);
  });

  it('unfavorites every named recipe', () => {
    const a = makeRecipe('Ragu', { favorite: true });
    const b = makeRecipe('Soup', { favorite: true });
    seed([a, b]);

    useRecipeStore.getState().bulkSetFavorite([a.id, b.id], false);

    expect(useRecipeStore.getState().recipeById(a.id)!.favorite).toBe(false);
    expect(useRecipeStore.getState().recipeById(b.id)!.favorite).toBe(false);
  });

  it('writes nothing when every named recipe already matches', () => {
    const r = makeRecipe('Ragu', { favorite: true });
    seed([r]);

    useRecipeStore.getState().bulkSetFavorite([r.id], true);

    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });
});

describe('bulkRemoveIngredients', () => {
  it('removes every named ingredient and keeps the rest, in original order', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    const a = useRecipeStore.getState().addIngredient(r.id, 'Garlic')!;
    const b = useRecipeStore.getState().addIngredient(r.id, 'Onions')!;
    const c = useRecipeStore.getState().addIngredient(r.id, 'Parsley')!;

    useRecipeStore.getState().bulkRemoveIngredients(r.id, [a.id, c.id]);

    expect(useRecipeStore.getState().recipeById(r.id)!.ingredients.map(i => i.id)).toEqual([b.id]);
  });

  it('writes nothing when none of the named ingredients are on the recipe', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    useRecipeStore.getState().addIngredient(r.id, 'Garlic');
    jest.clearAllMocks();

    useRecipeStore.getState().bulkRemoveIngredients(r.id, ['gone']);

    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });

  it('shrugs at an unknown recipe id', () => {
    seed([]);
    expect(() => useRecipeStore.getState().bulkRemoveIngredients('gone', ['x'])).not.toThrow();
  });
});

describe('bulkSetIngredientAisle', () => {
  it('files every named ingredient into the aisle and leaves the rest', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    const a = useRecipeStore.getState().addIngredient(r.id, 'Garlic')!;
    const b = useRecipeStore.getState().addIngredient(r.id, 'Milk')!;
    useRecipeStore.getState().updateIngredient(r.id, b.id, { aisle: 'Dairy' });

    useRecipeStore.getState().bulkSetIngredientAisle(r.id, [a.id], 'Produce');

    const ingredients = useRecipeStore.getState().recipeById(r.id)!.ingredients;
    expect(ingredients.find(i => i.id === a.id)!.aisle).toBe('Produce');
    expect(ingredients.find(i => i.id === b.id)!.aisle).toBe('Dairy');
  });

  it('can clear the aisle back to null', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    const a = useRecipeStore.getState().addIngredient(r.id, 'Garlic')!;
    useRecipeStore.getState().updateIngredient(r.id, a.id, { aisle: 'Produce' });

    useRecipeStore.getState().bulkSetIngredientAisle(r.id, [a.id], null);

    expect(useRecipeStore.getState().recipeById(r.id)!.ingredients[0].aisle).toBeNull();
  });

  it('shrugs at an unknown recipe id', () => {
    seed([]);
    expect(() => useRecipeStore.getState().bulkSetIngredientAisle('gone', ['x'], 'Produce')).not.toThrow();
  });
});

describe('markCooked', () => {
  it('bumps cookCount and stamps lastCookedAt', () => {
    const r = makeRecipe('Ragu', { cookCount: 2, lastCookedAt: '2026-01-01T00:00:00.000Z' });
    seed([r]);

    useRecipeStore.getState().markCooked(r.id);

    const updated = useRecipeStore.getState().recipeById(r.id)!;
    expect(updated.cookCount).toBe(3);
    expect(updated.lastCookedAt).not.toBe('2026-01-01T00:00:00.000Z');
    expect(dbUpdateRecipe).toHaveBeenCalledTimes(1);
  });

  it('shrugs at an unknown recipe id', () => {
    seed([]);
    expect(() => useRecipeStore.getState().markCooked('gone')).not.toThrow();
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });
});
