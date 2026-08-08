import { useRecipeStore } from '../store/useRecipeStore';
import {
  dbGetAllRecipes,
  dbInsertRecipe,
  dbUpdateRecipe,
  dbDeleteRecipe,
} from '../db/database';
import type { Recipe } from '../types';

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
    servings: null,
    ingredients: [],
    favorite: false,
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
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

  // Pinning the offline parser's known limit rather than wishing it away:
  // "cloves" isn't in parseGroceryInput's unit whitelist, so it stays in the
  // name and this does NOT collapse onto "garlic". The whitelist is deliberate
  // — guessing costs you the first word of the item name — so the fix is the
  // AI extractor, not a longer list of words to swallow.
  it('keeps a preparation word in the name when it is not a known unit', () => {
    const r = makeRecipe('Ragu');
    seed([r]);

    const added = useRecipeStore.getState().addIngredient(r.id, '3 cloves garlic')!;

    expect(added.name).toBe('cloves garlic');
    expect(added.quantity).toBe('3');
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

describe('remapIngredientKey', () => {
  it('rewrites every recipe that referenced the old key, and only those', () => {
    const ragu = makeRecipe('Ragu', {
      ingredients: [{ id: 'i1', name: 'Tomatos', nameKey: 'tomatos', quantity: '', aisle: null }],
    });
    const soup = makeRecipe('Soup', {
      ingredients: [{ id: 'i2', name: 'Carrots', nameKey: 'carrots', quantity: '', aisle: null }],
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
