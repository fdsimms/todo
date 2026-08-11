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

  it('sets and clears the meal type', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().setMealType(r.id, 'dinner');
    expect(useRecipeStore.getState().recipeById(r.id)!.mealType).toBe('dinner');

    useRecipeStore.getState().setMealType(r.id, null);
    expect(useRecipeStore.getState().recipeById(r.id)!.mealType).toBeNull();
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
    id: `s-${name}`, name, nameKey: name.toLowerCase(), quantity: '', aisle: null, prep: null, section: null, ...overrides,
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
      ingredients: [{ id: 'i1', name: 'Garlic', nameKey: 'garlic', quantity: '3 cloves', aisle: null, prep: null, section: null }],
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
        { id: 'i1', name: 'Tomatos', nameKey: 'tomatos', quantity: '', aisle: null, prep: null, section: null },
      ],
    });
    const soup = makeRecipe('Soup', {
      ingredients: [
        { id: 'i2', name: 'Carrots', nameKey: 'carrots', quantity: '', aisle: null, prep: null, section: null },
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

describe('addComponent / removeComponent', () => {
  it('links a recipe as a part of another, capturing its name', () => {
    const steak = makeRecipe('Steak');
    const mash = makeRecipe('Mash');
    seed([steak, mash]);

    expect(useRecipeStore.getState().addComponent(steak.id, mash.id)).toBe(true);

    const components = useRecipeStore.getState().recipeById(steak.id)!.components;
    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({ recipeId: mash.id, name: 'Mash' });
    expect(dbUpdateRecipe).toHaveBeenCalledTimes(1);
  });

  it('lets one component be shared by several recipes', () => {
    const steak = makeRecipe('Steak');
    const salmon = makeRecipe('Salmon');
    const mash = makeRecipe('Mash');
    seed([steak, salmon, mash]);

    useRecipeStore.getState().addComponent(steak.id, mash.id);
    useRecipeStore.getState().addComponent(salmon.id, mash.id);

    expect(useRecipeStore.getState().recipeById(steak.id)!.components[0].recipeId).toBe(mash.id);
    expect(useRecipeStore.getState().recipeById(salmon.id)!.components[0].recipeId).toBe(mash.id);
  });

  it('refuses a duplicate link, itself, an unknown id, and a loop', () => {
    const steak = makeRecipe('Steak');
    const mash = makeRecipe('Mash');
    seed([steak, mash]);
    useRecipeStore.getState().addComponent(steak.id, mash.id);
    (dbUpdateRecipe as jest.Mock).mockClear();

    expect(useRecipeStore.getState().addComponent(steak.id, mash.id)).toBe(false);
    expect(useRecipeStore.getState().addComponent(steak.id, steak.id)).toBe(false);
    expect(useRecipeStore.getState().addComponent(steak.id, 'gone')).toBe(false);
    expect(useRecipeStore.getState().addComponent('gone', mash.id)).toBe(false);
    // Mash already reaches Steak, so this would close the loop.
    expect(useRecipeStore.getState().addComponent(mash.id, steak.id)).toBe(false);
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });

  it('unlinks by the component’s own id, including one whose recipe is gone', () => {
    const mash = makeRecipe('Mash');
    const steak = makeRecipe('Steak');
    seed([steak, mash]);
    useRecipeStore.getState().addComponent(steak.id, mash.id);
    const componentId = useRecipeStore.getState().recipeById(steak.id)!.components[0].id;
    useRecipeStore.getState().deleteRecipe(mash.id);

    useRecipeStore.getState().removeComponent(steak.id, componentId);

    expect(useRecipeStore.getState().recipeById(steak.id)!.components).toEqual([]);
  });

  it('shrugs at an unknown recipe or component id', () => {
    const steak = makeRecipe('Steak');
    seed([steak]);

    useRecipeStore.getState().removeComponent(steak.id, 'gone');
    useRecipeStore.getState().removeComponent('gone', 'gone');

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

  it('leaves a parent’s link dangling rather than editing a recipe the user didn’t touch', () => {
    const steak = makeRecipe('Steak');
    const mash = makeRecipe('Mash');
    seed([steak, mash]);
    useRecipeStore.getState().addComponent(steak.id, mash.id);

    useRecipeStore.getState().deleteRecipe(mash.id);

    expect(useRecipeStore.getState().recipeById(steak.id)!.components).toEqual([
      expect.objectContaining({ recipeId: mash.id, name: 'Mash' }),
    ]);
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

describe('setEstimatedMinutes', () => {
  it('sets, rounds and floors at 1 minute', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().setEstimatedMinutes(r.id, 24.6);
    expect(useRecipeStore.getState().recipeById(r.id)!.estimatedMinutes).toBe(25);

    useRecipeStore.getState().setEstimatedMinutes(r.id, 0.2);
    expect(useRecipeStore.getState().recipeById(r.id)!.estimatedMinutes).toBe(1);
  });

  it('clears it with null', () => {
    const r = makeRecipe('Ragu', { estimatedMinutes: 25 });
    seed([r]);
    useRecipeStore.getState().setEstimatedMinutes(r.id, null);
    expect(useRecipeStore.getState().recipeById(r.id)!.estimatedMinutes).toBeNull();
  });
});

describe('cook timer', () => {
  it('starts only when nothing is already running', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().startCookTimer(r.id);
    const started = useRecipeStore.getState().recipeById(r.id)!;
    expect(started.timerStartedAt).not.toBeNull();

    (dbUpdateRecipe as jest.Mock).mockClear();
    useRecipeStore.getState().startCookTimer(r.id);
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });

  it('pause banks the elapsed segment without touching the logged history', () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString();
    const r = makeRecipe('Ragu', { timerStartedAt: startedAt });
    seed([r]);

    useRecipeStore.getState().pauseCookTimer(r.id);

    const paused = useRecipeStore.getState().recipeById(r.id)!;
    expect(paused.timerStartedAt).toBeNull();
    expect(paused.timerElapsedSeconds).toBeGreaterThanOrEqual(90);
    expect(paused.lastCookMinutes).toBeNull();
    expect(paused.cookTimeCount).toBe(0);
  });

  it('pause is a no-op when nothing is running', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    useRecipeStore.getState().pauseCookTimer(r.id);
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });

  it('reset abandons the current segment unlogged', () => {
    const r = makeRecipe('Ragu', { timerStartedAt: new Date().toISOString(), timerElapsedSeconds: 60 });
    seed([r]);

    useRecipeStore.getState().resetCookTimer(r.id);

    const reset = useRecipeStore.getState().recipeById(r.id)!;
    expect(reset.timerStartedAt).toBeNull();
    expect(reset.timerElapsedSeconds).toBe(0);
    expect(reset.cookTimeCount).toBe(0);
  });

  it('stop banks and logs the session, and backfills a never-set estimate', () => {
    const startedAt = new Date(Date.now() - 18 * 60_000).toISOString();
    const r = makeRecipe('Ragu', { estimatedMinutes: null, timerStartedAt: startedAt });
    seed([r]);

    useRecipeStore.getState().stopCookTimer(r.id);

    const stopped = useRecipeStore.getState().recipeById(r.id)!;
    expect(stopped.timerStartedAt).toBeNull();
    expect(stopped.timerElapsedSeconds).toBe(0);
    expect(stopped.lastCookMinutes).toBe(18);
    expect(stopped.cookTimeCount).toBe(1);
    expect(stopped.totalCookMinutes).toBe(18);
    expect(stopped.estimatedMinutes).toBe(18);
  });

  it('stop never overwrites a typed estimate, and logs banked time from an earlier pause', () => {
    const r = makeRecipe('Ragu', { estimatedMinutes: 25, timerElapsedSeconds: 20 * 60, cookTimeCount: 1, totalCookMinutes: 22 });
    seed([r]);

    useRecipeStore.getState().stopCookTimer(r.id);

    const stopped = useRecipeStore.getState().recipeById(r.id)!;
    expect(stopped.estimatedMinutes).toBe(25);
    expect(stopped.lastCookMinutes).toBe(20);
    expect(stopped.cookTimeCount).toBe(2);
    expect(stopped.totalCookMinutes).toBe(42);
  });

  it('stop is a no-op with nothing running and nothing banked', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    useRecipeStore.getState().stopCookTimer(r.id);
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });
});
