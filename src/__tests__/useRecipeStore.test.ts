import { useRecipeStore } from '../store/useRecipeStore';
import {
  dbGetAllRecipes,
  dbInsertRecipe,
  dbUpdateRecipe,
  dbDeleteRecipe,
} from '../db/database';
import type { Recipe, RecipeIngredient } from '../types';
import { LEFTOVER_KEEP_DAYS_MAX } from '../types';

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
    servingsMax: null,
    recipeYield: null,
    leftoverKeepDays: null,
    imagePath: null,
    mealType: null,
    tags: [],
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

  it('stores a servingsMax range and clamps it too', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().setServings(r.id, 4, 600);
    const stored = useRecipeStore.getState().recipeById(r.id)!;
    expect(stored.servings).toBe(4);
    expect(stored.servingsMax).toBe(99);
  });

  it('drops a servingsMax that does not exceed servings', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().setServings(r.id, 4, 4);
    expect(useRecipeStore.getState().recipeById(r.id)!.servingsMax).toBeNull();

    useRecipeStore.getState().setServings(r.id, 4, 2);
    expect(useRecipeStore.getState().recipeById(r.id)!.servingsMax).toBeNull();
  });

  it('drops servingsMax when servings is cleared', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().setServings(r.id, 4, 6);
    expect(useRecipeStore.getState().recipeById(r.id)!.servingsMax).toBe(6);

    useRecipeStore.getState().setServings(r.id, null);
    expect(useRecipeStore.getState().recipeById(r.id)!.servingsMax).toBeNull();
  });

  it('sets and clears the yield', () => {
    const r = makeRecipe('Bread');
    seed([r]);

    useRecipeStore.getState().setRecipeYield(r.id, '  2 loaves  ');
    expect(useRecipeStore.getState().recipeById(r.id)!.recipeYield).toBe('2 loaves');

    useRecipeStore.getState().setRecipeYield(r.id, '');
    expect(useRecipeStore.getState().recipeById(r.id)!.recipeYield).toBeNull();

    useRecipeStore.getState().setRecipeYield(r.id, null);
    expect(useRecipeStore.getState().recipeById(r.id)!.recipeYield).toBeNull();
  });

  it('sets and clears the leftover keep-for window', () => {
    const r = makeRecipe('Mash');
    seed([r]);

    useRecipeStore.getState().setLeftoverKeepDays(r.id, 5);
    expect(useRecipeStore.getState().recipeById(r.id)!.leftoverKeepDays).toBe(5);

    // Zero is a real answer — a dish that has to be eaten the day it's made —
    // so only null hands the question back to the standard window.
    useRecipeStore.getState().setLeftoverKeepDays(r.id, 0);
    expect(useRecipeStore.getState().recipeById(r.id)!.leftoverKeepDays).toBe(0);

    useRecipeStore.getState().setLeftoverKeepDays(r.id, null);
    expect(useRecipeStore.getState().recipeById(r.id)!.leftoverKeepDays).toBeNull();
  });

  it('clamps a keep-for window into the sayable range', () => {
    const r = makeRecipe('Mash');
    seed([r]);

    useRecipeStore.getState().setLeftoverKeepDays(r.id, 500);
    expect(useRecipeStore.getState().recipeById(r.id)!.leftoverKeepDays).toBe(LEFTOVER_KEEP_DAYS_MAX);

    useRecipeStore.getState().setLeftoverKeepDays(r.id, -4);
    expect(useRecipeStore.getState().recipeById(r.id)!.leftoverKeepDays).toBe(0);
  });

  it('sets and clears the meal type', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().setMealType(r.id, 'dinner');
    expect(useRecipeStore.getState().recipeById(r.id)!.mealType).toBe('dinner');

    useRecipeStore.getState().setMealType(r.id, null);
    expect(useRecipeStore.getState().recipeById(r.id)!.mealType).toBeNull();
  });

  it('cleans and de-duplicates tags on the way in', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().setTags(r.id, [' Weeknight ', 'weeknight', 'Make   Ahead', '  ']);
    expect(useRecipeStore.getState().recipeById(r.id)!.tags).toEqual(['weeknight', 'make ahead']);
  });

  it('clears tags', () => {
    const r = makeRecipe('Ragu', { tags: ['weeknight'] });
    seed([r]);

    useRecipeStore.getState().setTags(r.id, []);
    expect(useRecipeStore.getState().recipeById(r.id)!.tags).toEqual([]);
  });

  it("doesn't write when the tags come back the same", () => {
    const r = makeRecipe('Ragu', { tags: ['weeknight', 'thai'] });
    seed([r]);

    useRecipeStore.getState().setTags(r.id, ['Weeknight', 'thai']);
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });

  it('treats a reorder as a change', () => {
    const r = makeRecipe('Ragu', { tags: ['weeknight', 'thai'] });
    seed([r]);

    useRecipeStore.getState().setTags(r.id, ['thai', 'weeknight']);
    expect(useRecipeStore.getState().recipeById(r.id)!.tags).toEqual(['thai', 'weeknight']);
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
    id: `s-${name}`, name, nameKey: name.toLowerCase(), quantity: '', aisle: null, prep: null, purpose: null, section: null, choiceGroup: null, ...overrides,
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
      ingredients: [{ id: 'i1', name: 'Garlic', nameKey: 'garlic', quantity: '3 cloves', aisle: null, prep: null, purpose: null, section: null, choiceGroup: null }],
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
        { id: 'i1', name: 'Tomatos', nameKey: 'tomatos', quantity: '', aisle: null, prep: null, purpose: null, section: null, choiceGroup: null },
      ],
    });
    const soup = makeRecipe('Soup', {
      ingredients: [
        { id: 'i2', name: 'Carrots', nameKey: 'carrots', quantity: '', aisle: null, prep: null, purpose: null, section: null, choiceGroup: null },
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

describe('splitIngredientAlternatives', () => {
  const withLine = (name: string, overrides: Partial<RecipeIngredient> = {}) => {
    const r = makeRecipe('Salsa', {
      ingredients: [
        { id: 'i0', name: 'Tomatoes', nameKey: 'tomatoes', quantity: '6', aisle: null, prep: null, purpose: null, section: null, choiceGroup: null },
        { id: 'i1', name, nameKey: name.toLowerCase(), quantity: '2', aisle: 'Produce', prep: 'sliced', purpose: null, section: 'For the salsa', choiceGroup: null, ...overrides },
      ],
    });
    seed([r]);
    return r;
  };

  it('replaces the line with one row per name, in its place', () => {
    const r = withLine('Serrano or jalapeño');

    expect(useRecipeStore.getState().splitIngredientAlternatives(
      r.id, 'i1', ['Serrano', 'Jalapeño'], 'Serrano or jalapeño'
    )).toBe(2);

    const ingredients = useRecipeStore.getState().recipeById(r.id)!.ingredients;
    expect(ingredients.map(i => i.name)).toEqual(['Tomatoes', 'Serrano', 'Jalapeño']);
    // Each alternative gets a clean catalog key — the whole point of splitting.
    // (groceryNameKey folds the accent, same as it does for a typed item.)
    expect(ingredients.map(i => i.nameKey)).toEqual(['tomatoes', 'serrano', 'jalapeno']);
    expect(ingredients.map(i => i.choiceGroup))
      .toEqual([null, 'Serrano or jalapeño', 'Serrano or jalapeño']);
  });

  it('files every new row under the one group, and keeps the slot’s details', () => {
    const r = withLine('Serrano or jalapeño');

    useRecipeStore.getState().splitIngredientAlternatives(
      r.id, 'i1', ['Serrano', 'Jalapeño'], 'Pepper'
    );

    const [, serrano, jalapeno] = useRecipeStore.getState().recipeById(r.id)!.ingredients;
    for (const row of [serrano, jalapeno]) {
      expect(row.choiceGroup).toBe('Pepper');
      // Alternatives for one slot inherit what was true of that slot.
      expect(row.quantity).toBe('2');
      expect(row.aisle).toBe('Produce');
      expect(row.prep).toBe('sliced');
      expect(row.section).toBe('For the salsa');
    }
  });

  it('keeps the original id on the first option, so a stored pick still resolves', () => {
    const r = withLine('Serrano or jalapeño');

    useRecipeStore.getState().splitIngredientAlternatives(r.id, 'i1', ['Serrano', 'Jalapeño'], 'Pepper');

    const ingredients = useRecipeStore.getState().recipeById(r.id)!.ingredients;
    expect(ingredients[1].id).toBe('i1');
    expect(ingredients[2].id).not.toBe('i1');
  });

  it('drops an option the recipe already lists rather than duplicating it', () => {
    const r = makeRecipe('Salsa', {
      ingredients: [
        { id: 'i0', name: 'Serrano', nameKey: 'serrano', quantity: '', aisle: null, prep: null, purpose: null, section: null, choiceGroup: null },
        { id: 'i1', name: 'Serrano or jalapeño', nameKey: 'serrano or jalapeño', quantity: '', aisle: null, prep: null, purpose: null, section: null, choiceGroup: null },
      ],
    });
    seed([r]);

    // Only "Jalapeño" survives, which is a group of one — not a choice, so
    // nothing is written and the line is left as the user typed it.
    expect(useRecipeStore.getState().splitIngredientAlternatives(
      r.id, 'i1', ['Serrano', 'Jalapeño'], 'Pepper'
    )).toBe(0);
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
    expect(useRecipeStore.getState().recipeById(r.id)!.ingredients).toHaveLength(2);
  });

  it('refuses a blank group, a single name, and unknown ids', () => {
    const r = withLine('Serrano or jalapeño');
    (dbUpdateRecipe as jest.Mock).mockClear();

    expect(useRecipeStore.getState().splitIngredientAlternatives(r.id, 'i1', ['Serrano', 'Jalapeño'], '  ')).toBe(0);
    expect(useRecipeStore.getState().splitIngredientAlternatives(r.id, 'i1', ['Serrano'], 'Pepper')).toBe(0);
    expect(useRecipeStore.getState().splitIngredientAlternatives(r.id, 'gone', ['A', 'B'], 'Pepper')).toBe(0);
    expect(useRecipeStore.getState().splitIngredientAlternatives('gone', 'i1', ['A', 'B'], 'Pepper')).toBe(0);
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });
});

describe('renameChoiceGroup', () => {
  const withGroup = () => {
    const r = makeRecipe('Salsa', {
      ingredients: [
        { id: 'i0', name: 'Tomatoes', nameKey: 'tomatoes', quantity: '6', aisle: null, prep: null, purpose: null, section: null, choiceGroup: null },
        { id: 'i1', name: 'Serrano', nameKey: 'serrano', quantity: '2', aisle: null, prep: null, purpose: null, section: null, choiceGroup: 'Pepper' },
        { id: 'i2', name: 'Jalapeño', nameKey: 'jalapeno', quantity: '2', aisle: null, prep: null, purpose: null, section: null, choiceGroup: 'Pepper' },
      ],
    });
    seed([r]);
    return r;
  };

  it('renames every ingredient in the group, not just one', () => {
    const r = withGroup();

    expect(useRecipeStore.getState().renameChoiceGroup(r.id, 'Pepper', 'Chili pepper')).toBe('Chili pepper');

    const ingredients = useRecipeStore.getState().recipeById(r.id)!.ingredients;
    expect(ingredients.map(i => i.choiceGroup)).toEqual([null, 'Chili pepper', 'Chili pepper']);
  });

  it('leaves ingredients in a different group untouched', () => {
    const r = makeRecipe('Salsa', {
      ingredients: [
        { id: 'i1', name: 'Serrano', nameKey: 'serrano', quantity: '', aisle: null, prep: null, purpose: null, section: null, choiceGroup: 'Pepper' },
        { id: 'i2', name: 'Cheddar', nameKey: 'cheddar', quantity: '', aisle: null, prep: null, purpose: null, section: null, choiceGroup: 'Cheese' },
      ],
    });
    seed([r]);

    useRecipeStore.getState().renameChoiceGroup(r.id, 'Pepper', 'Chili pepper');

    const ingredients = useRecipeStore.getState().recipeById(r.id)!.ingredients;
    expect(ingredients.find(i => i.id === 'i2')!.choiceGroup).toBe('Cheese');
  });

  it('refuses a blank name, a no-op rename, an unused label, and an unknown recipe', () => {
    const r = withGroup();
    (dbUpdateRecipe as jest.Mock).mockClear();

    expect(useRecipeStore.getState().renameChoiceGroup(r.id, 'Pepper', '  ')).toBeNull();
    expect(useRecipeStore.getState().renameChoiceGroup(r.id, 'Pepper', 'Pepper')).toBeNull();
    expect(useRecipeStore.getState().renameChoiceGroup(r.id, 'Cheese', 'Cheeses')).toBeNull();
    expect(useRecipeStore.getState().renameChoiceGroup('gone', 'Pepper', 'Chili pepper')).toBeNull();
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });
});

describe('setComponentChoiceGroup / makeComponentDefault', () => {
  // Steak, with mash and roast potatoes both linked — the state the user is in
  // right before saying "these two are alternatives".
  const seedSides = () => {
    const steak = makeRecipe('Steak');
    const mash = makeRecipe('Mash');
    const roast = makeRecipe('Roast potatoes');
    seed([steak, mash, roast]);
    useRecipeStore.getState().addComponent(steak.id, mash.id);
    useRecipeStore.getState().addComponent(steak.id, roast.id);
    const components = useRecipeStore.getState().recipeById(steak.id)!.components;
    return { steak, mash, roast, mashLink: components[0], roastLink: components[1] };
  };

  it('files a component under a label, and takes it back out with null', () => {
    const { steak, mashLink } = seedSides();

    useRecipeStore.getState().setComponentChoiceGroup(steak.id, mashLink.id, '  Side  ');
    expect(useRecipeStore.getState().recipeById(steak.id)!.components[0].choiceGroup).toBe('Side');

    useRecipeStore.getState().setComponentChoiceGroup(steak.id, mashLink.id, null);
    expect(useRecipeStore.getState().recipeById(steak.id)!.components[0].choiceGroup).toBeNull();
  });

  it('treats a blank label as no group rather than a group called nothing', () => {
    const { steak, mashLink } = seedSides();

    useRecipeStore.getState().setComponentChoiceGroup(steak.id, mashLink.id, '   ');

    expect(useRecipeStore.getState().recipeById(steak.id)!.components[0].choiceGroup).toBeNull();
  });

  it('shrugs at an unknown recipe or component id', () => {
    const { steak } = seedSides();
    (dbUpdateRecipe as jest.Mock).mockClear();

    useRecipeStore.getState().setComponentChoiceGroup(steak.id, 'gone', 'Side');
    useRecipeStore.getState().setComponentChoiceGroup('gone', 'gone', 'Side');

    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });

  it('promotes a component to the front of its own group only', () => {
    const rub = makeRecipe('Rub');
    const { steak, mashLink, roastLink } = seedSides();
    useRecipeStore.setState({ recipes: [...useRecipeStore.getState().recipes, rub] });
    useRecipeStore.getState().addComponent(steak.id, rub.id);
    useRecipeStore.getState().setComponentChoiceGroup(steak.id, mashLink.id, 'Side');
    useRecipeStore.getState().setComponentChoiceGroup(steak.id, roastLink.id, 'Side');

    useRecipeStore.getState().makeComponentDefault(steak.id, roastLink.id);

    // The rub is ungrouped and keeps its place at the end; only the two options
    // swap, so the group's first entry is now the roast.
    expect(useRecipeStore.getState().recipeById(steak.id)!.components.map(c => c.name))
      .toEqual(['Roast potatoes', 'Mash', 'Rub']);
  });

  it('does nothing for an ungrouped component, or one already first', () => {
    const { steak, mashLink, roastLink } = seedSides();
    useRecipeStore.getState().setComponentChoiceGroup(steak.id, mashLink.id, 'Side');
    useRecipeStore.getState().setComponentChoiceGroup(steak.id, roastLink.id, 'Side');
    (dbUpdateRecipe as jest.Mock).mockClear();

    useRecipeStore.getState().makeComponentDefault(steak.id, mashLink.id);
    expect(dbUpdateRecipe).not.toHaveBeenCalled();

    useRecipeStore.getState().setComponentChoiceGroup(steak.id, roastLink.id, null);
    (dbUpdateRecipe as jest.Mock).mockClear();
    useRecipeStore.getState().makeComponentDefault(steak.id, roastLink.id);
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

  it('hands back what the two fields were, so an undo can restore them', () => {
    const r = makeRecipe('Ragu', { cookCount: 2, lastCookedAt: '2026-01-01T00:00:00.000Z' });
    seed([r]);

    expect(useRecipeStore.getState().markCooked(r.id))
      .toEqual({ cookCount: 2, lastCookedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('hands back null for a recipe that does not resolve', () => {
    seed([]);
    expect(useRecipeStore.getState().markCooked('gone')).toBeNull();
  });
});

describe('restoreCookStats', () => {
  // Undo's half of the pair. Deliberately not reachable from "mark not
  // cooked": cookCount only rises everywhere else in this app, and un-ticking
  // a meal is a statement about that meal going forward, not a claim that the
  // cooking never happened.
  it('puts a snapshot back', () => {
    const r = makeRecipe('Ragu', { cookCount: 2, lastCookedAt: '2026-01-01T00:00:00.000Z' });
    seed([r]);

    const before = useRecipeStore.getState().markCooked(r.id)!;
    useRecipeStore.getState().restoreCookStats(r.id, before);

    const updated = useRecipeStore.getState().recipeById(r.id)!;
    expect(updated.cookCount).toBe(2);
    expect(updated.lastCookedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  // A never-cooked recipe's snapshot is a null lastCookedAt, and restoring it
  // has to put the null back rather than leave today's stamp on a dish that
  // has still never been made.
  it('restores a null lastCookedAt rather than leaving the stamp', () => {
    const r = makeRecipe('Ragu', { cookCount: 0, lastCookedAt: null });
    seed([r]);

    const before = useRecipeStore.getState().markCooked(r.id)!;
    useRecipeStore.getState().restoreCookStats(r.id, before);

    const updated = useRecipeStore.getState().recipeById(r.id)!;
    expect(updated.cookCount).toBe(0);
    expect(updated.lastCookedAt).toBeNull();
  });

  it('shrugs at an unknown recipe id', () => {
    seed([]);
    expect(() => useRecipeStore.getState().restoreCookStats('gone', { cookCount: 1, lastCookedAt: null }))
      .not.toThrow();
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

describe('logManualCookTime', () => {
  it('logs a typed time without touching the timer, and backfills a never-set estimate', () => {
    const r = makeRecipe('Ragu', { estimatedMinutes: null });
    seed([r]);

    useRecipeStore.getState().logManualCookTime(r.id, 22);

    const logged = useRecipeStore.getState().recipeById(r.id)!;
    expect(logged.lastCookMinutes).toBe(22);
    expect(logged.cookTimeCount).toBe(1);
    expect(logged.totalCookMinutes).toBe(22);
    expect(logged.estimatedMinutes).toBe(22);
    expect(logged.timerStartedAt).toBeNull();
  });

  it('never overwrites a typed estimate', () => {
    const r = makeRecipe('Ragu', { estimatedMinutes: 25 });
    seed([r]);

    useRecipeStore.getState().logManualCookTime(r.id, 30);

    expect(useRecipeStore.getState().recipeById(r.id)!.estimatedMinutes).toBe(25);
  });

  it('ignores a zero or negative entry', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    useRecipeStore.getState().logManualCookTime(r.id, 0);
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });
});

describe('setPrepMinutes', () => {
  it('sets, rounds and floors at 1 minute, and clears with null', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().setPrepMinutes(r.id, 9.6);
    expect(useRecipeStore.getState().recipeById(r.id)!.prepMinutes).toBe(10);

    useRecipeStore.getState().setPrepMinutes(r.id, 0.2);
    expect(useRecipeStore.getState().recipeById(r.id)!.prepMinutes).toBe(1);

    useRecipeStore.getState().setPrepMinutes(r.id, null);
    expect(useRecipeStore.getState().recipeById(r.id)!.prepMinutes).toBeNull();
  });
});

describe('setSourceType / setSourcePage', () => {
  it('sets a source type independent of the page', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().setSourceType(r.id, 'website');
    expect(useRecipeStore.getState().recipeById(r.id)!.sourceType).toBe('website');
  });

  it('clears the page the moment the type stops being a cookbook', () => {
    const r = makeRecipe('Ragu', { sourceType: 'cookbook', sourcePage: '142' });
    seed([r]);

    useRecipeStore.getState().setSourceType(r.id, 'website');
    const updated = useRecipeStore.getState().recipeById(r.id)!;
    expect(updated.sourceType).toBe('website');
    expect(updated.sourcePage).toBeNull();
  });

  it('keeps the page when the type stays cookbook', () => {
    const r = makeRecipe('Ragu', { sourceType: 'cookbook', sourcePage: '142' });
    seed([r]);

    useRecipeStore.getState().setSourceType(r.id, 'cookbook');
    expect(useRecipeStore.getState().recipeById(r.id)!.sourcePage).toBe('142');
  });

  it('trims and clears the page', () => {
    const r = makeRecipe('Ragu', { sourceType: 'cookbook' });
    seed([r]);

    useRecipeStore.getState().setSourcePage(r.id, '  142  ');
    expect(useRecipeStore.getState().recipeById(r.id)!.sourcePage).toBe('142');

    useRecipeStore.getState().setSourcePage(r.id, '');
    expect(useRecipeStore.getState().recipeById(r.id)!.sourcePage).toBeNull();
  });
});

describe('prep timer', () => {
  it('starts only when nothing is already running', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    useRecipeStore.getState().startPrepTimer(r.id);
    const started = useRecipeStore.getState().recipeById(r.id)!;
    expect(started.prepTimerStartedAt).not.toBeNull();

    (dbUpdateRecipe as jest.Mock).mockClear();
    useRecipeStore.getState().startPrepTimer(r.id);
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });

  it('pause banks the elapsed segment without touching the logged history', () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString();
    const r = makeRecipe('Ragu', { prepTimerStartedAt: startedAt });
    seed([r]);

    useRecipeStore.getState().pausePrepTimer(r.id);

    const paused = useRecipeStore.getState().recipeById(r.id)!;
    expect(paused.prepTimerStartedAt).toBeNull();
    expect(paused.prepTimerElapsedSeconds).toBeGreaterThanOrEqual(90);
    expect(paused.lastPrepMinutes).toBeNull();
    expect(paused.prepTimeCount).toBe(0);
  });

  it('reset abandons the current segment unlogged', () => {
    const r = makeRecipe('Ragu', { prepTimerStartedAt: new Date().toISOString(), prepTimerElapsedSeconds: 60 });
    seed([r]);

    useRecipeStore.getState().resetPrepTimer(r.id);

    const reset = useRecipeStore.getState().recipeById(r.id)!;
    expect(reset.prepTimerStartedAt).toBeNull();
    expect(reset.prepTimerElapsedSeconds).toBe(0);
    expect(reset.prepTimeCount).toBe(0);
  });

  it('stop banks and logs the session, and backfills a never-set prep estimate', () => {
    const startedAt = new Date(Date.now() - 8 * 60_000).toISOString();
    const r = makeRecipe('Ragu', { prepMinutes: null, prepTimerStartedAt: startedAt });
    seed([r]);

    useRecipeStore.getState().stopPrepTimer(r.id);

    const stopped = useRecipeStore.getState().recipeById(r.id)!;
    expect(stopped.prepTimerStartedAt).toBeNull();
    expect(stopped.prepTimerElapsedSeconds).toBe(0);
    expect(stopped.lastPrepMinutes).toBe(8);
    expect(stopped.prepTimeCount).toBe(1);
    expect(stopped.totalPrepMinutes).toBe(8);
    expect(stopped.prepMinutes).toBe(8);
  });

  it('stop never overwrites a typed prep estimate, and is independent of the cook timer', () => {
    const r = makeRecipe('Ragu', {
      prepMinutes: 10,
      prepTimerElapsedSeconds: 12 * 60,
      prepTimeCount: 1,
      totalPrepMinutes: 9,
      estimatedMinutes: 25,
      timerStartedAt: new Date().toISOString(),
    });
    seed([r]);

    useRecipeStore.getState().stopPrepTimer(r.id);

    const stopped = useRecipeStore.getState().recipeById(r.id)!;
    expect(stopped.prepMinutes).toBe(10);
    expect(stopped.lastPrepMinutes).toBe(12);
    expect(stopped.prepTimeCount).toBe(2);
    // Untouched by stopping the prep timer — the cook timer is a separate run.
    expect(stopped.timerStartedAt).not.toBeNull();
    expect(stopped.estimatedMinutes).toBe(25);
  });

  it('stop is a no-op with nothing running and nothing banked', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    useRecipeStore.getState().stopPrepTimer(r.id);
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });
});

describe('logManualPrepTime', () => {
  it('logs a typed time without touching the timer, and backfills a never-set prep estimate', () => {
    const r = makeRecipe('Ragu', { prepMinutes: null });
    seed([r]);

    useRecipeStore.getState().logManualPrepTime(r.id, 6);

    const logged = useRecipeStore.getState().recipeById(r.id)!;
    expect(logged.lastPrepMinutes).toBe(6);
    expect(logged.prepTimeCount).toBe(1);
    expect(logged.totalPrepMinutes).toBe(6);
    expect(logged.prepMinutes).toBe(6);
    expect(logged.prepTimerStartedAt).toBeNull();
  });

  it('never overwrites a typed prep estimate', () => {
    const r = makeRecipe('Ragu', { prepMinutes: 10 });
    seed([r]);

    useRecipeStore.getState().logManualPrepTime(r.id, 15);

    expect(useRecipeStore.getState().recipeById(r.id)!.prepMinutes).toBe(10);
  });

  it('ignores a zero or negative entry', () => {
    const r = makeRecipe('Ragu');
    seed([r]);
    useRecipeStore.getState().logManualPrepTime(r.id, -1);
    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });
});
