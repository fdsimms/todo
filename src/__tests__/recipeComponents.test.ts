import {
  parseRecipeComponents,
  normalizeComponent,
  makeComponent,
  recipeMap,
  resolveComponents,
  flattenRecipeIngredients,
  flattenRecipePrepTasks,
  reachableRecipeIds,
  wouldCreateRecipeCycle,
  recipesUsing,
  describeComponents,
} from '../utils/recipeComponents';
import type { Recipe, RecipeComponent, RecipeIngredient, RecipePrepTask } from '../types';

let seq = 0;

function ing(name: string): RecipeIngredient {
  return {
    id: `ing-${++seq}`,
    name,
    nameKey: name.toLowerCase(),
    quantity: '',
    aisle: null,
    prep: null,
    purpose: null,
    section: null,
  };
}

function prep(title: string): RecipePrepTask {
  return { id: `prep-${++seq}`, title, offsetDays: -1, reminderOffsetMinutes: null };
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
    servings: null,
    mealType: null,
    ingredients: [],
    components: [],
    prepTasks: [],
    favorite: false,
    sortOrder: ++seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    servingsMax: null,
    imagePath: null,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    ...overrides,
    cookCount: 0,
    lastCookedAt: null,
  };
}

function link(recipeId: string, name: string): RecipeComponent {
  return { id: `c-${++seq}`, recipeId, name };
}

describe('parseRecipeComponents', () => {
  it('reads a stored array', () => {
    const stored = JSON.stringify([{ id: 'c1', recipeId: 'r2', name: 'Mashed potatoes' }]);
    expect(parseRecipeComponents(stored)).toEqual([{ id: 'c1', recipeId: 'r2', name: 'Mashed potatoes' }]);
  });

  it('tolerates null, junk and a non-array', () => {
    expect(parseRecipeComponents(null)).toEqual([]);
    expect(parseRecipeComponents('not json')).toEqual([]);
    expect(parseRecipeComponents('{"a":1}')).toEqual([]);
  });

  it('drops a link with no target and keeps the rest', () => {
    const stored = JSON.stringify([{ id: 'c1', name: 'Nothing' }, { id: 'c2', recipeId: 'r2', name: 'Mash' }]);
    expect(parseRecipeComponents(stored).map(c => c.recipeId)).toEqual(['r2']);
  });

  it('keeps one link per target', () => {
    const stored = JSON.stringify([
      { id: 'c1', recipeId: 'r2', name: 'Mash' },
      { id: 'c2', recipeId: 'r2', name: 'Mash' },
    ]);
    expect(parseRecipeComponents(stored)).toHaveLength(1);
  });
});

describe('normalizeComponent', () => {
  it('mints an id when the stored row has none', () => {
    expect(normalizeComponent({ recipeId: 'r2', name: 'Mash' })!.id).toBeTruthy();
  });

  it('is null without a target', () => {
    expect(normalizeComponent({ id: 'c1', recipeId: '   ', name: 'Mash' })).toBeNull();
    expect(normalizeComponent('nope')).toBeNull();
  });

  it('keeps an absent name empty rather than inventing one', () => {
    expect(normalizeComponent({ recipeId: 'r2' })!.name).toBe('');
  });
});

describe('makeComponent', () => {
  it('captures the target’s name at link time', () => {
    const component = makeComponent(recipe('r2', 'Mashed potatoes'));
    expect(component).toMatchObject({ recipeId: 'r2', name: 'Mashed potatoes' });
    expect(component.id).toBeTruthy();
  });
});

describe('resolveComponents', () => {
  it('prefers the live name, so a rename shows up in every parent', () => {
    const mash = recipe('r2', 'Buttery mash');
    const steak = recipe('r1', 'Steak', { components: [link('r2', 'Mashed potatoes')] });

    const [resolved] = resolveComponents(steak, recipeMap([steak, mash]));

    expect(resolved.recipe).toBe(mash);
    expect(resolved.name).toBe('Buttery mash');
  });

  it('falls back to the captured name once the target is gone', () => {
    const steak = recipe('r1', 'Steak', { components: [link('r2', 'Mashed potatoes')] });

    const [resolved] = resolveComponents(steak, recipeMap([steak]));

    expect(resolved.recipe).toBeNull();
    expect(resolved.name).toBe('Mashed potatoes');
  });
});

describe('flattenRecipeIngredients', () => {
  it('is just the recipe’s own lines when nothing is composed', () => {
    const toast = recipe('r1', 'Toast', { ingredients: [ing('Bread')] });

    expect(flattenRecipeIngredients(toast, recipeMap([toast])).map(f => f.ingredient.name))
      .toEqual(['Bread']);
  });

  it('brings a component’s lines along, own lines first', () => {
    const mash = recipe('r2', 'Mash', { ingredients: [ing('Potatoes'), ing('Butter')] });
    const steak = recipe('r1', 'Steak with mash', {
      ingredients: [ing('Steak')],
      components: [link('r2', 'Mash')],
    });

    const flat = flattenRecipeIngredients(steak, recipeMap([steak, mash]));

    expect(flat.map(f => f.ingredient.name)).toEqual(['Steak', 'Potatoes', 'Butter']);
    expect(flat.map(f => f.recipe.name)).toEqual(['Steak with mash', 'Mash', 'Mash']);
    expect(flat.map(f => f.depth)).toEqual([0, 1, 1]);
  });

  it('follows a component of a component', () => {
    const roux = recipe('r3', 'Roux', { ingredients: [ing('Flour')] });
    const sauce = recipe('r2', 'Sauce', { ingredients: [ing('Milk')], components: [link('r3', 'Roux')] });
    const bake = recipe('r1', 'Bake', { ingredients: [ing('Pasta')], components: [link('r2', 'Sauce')] });

    const flat = flattenRecipeIngredients(bake, recipeMap([bake, sauce, roux]));

    expect(flat.map(f => f.ingredient.name)).toEqual(['Pasta', 'Milk', 'Flour']);
    expect(flat.map(f => f.depth)).toEqual([0, 1, 2]);
  });

  it('counts a shared component once, however many branches reach it', () => {
    const stock = recipe('r4', 'Stock', { ingredients: [ing('Bones')] });
    const gravy = recipe('r3', 'Gravy', { components: [link('r4', 'Stock')] });
    const soup = recipe('r2', 'Soup', { components: [link('r4', 'Stock')] });
    const feast = recipe('r1', 'Feast', { components: [link('r3', 'Gravy'), link('r2', 'Soup')] });

    const flat = flattenRecipeIngredients(feast, recipeMap([feast, gravy, soup, stock]));

    expect(flat.map(f => f.ingredient.name)).toEqual(['Bones']);
  });

  it('shrugs off a component that no longer exists', () => {
    const steak = recipe('r1', 'Steak', { ingredients: [ing('Steak')], components: [link('gone', 'Mash')] });

    expect(flattenRecipeIngredients(steak, recipeMap([steak])).map(f => f.ingredient.name))
      .toEqual(['Steak']);
  });

  it('terminates on a cycle the store would never have written', () => {
    const a = recipe('r1', 'A', { ingredients: [ing('Salt')], components: [link('r2', 'B')] });
    const b = recipe('r2', 'B', { ingredients: [ing('Pepper')], components: [link('r1', 'A')] });

    expect(flattenRecipeIngredients(a, recipeMap([a, b])).map(f => f.ingredient.name))
      .toEqual(['Salt', 'Pepper']);
  });
});

describe('flattenRecipePrepTasks', () => {
  it('collects the tree’s prep steps, own first', () => {
    const mash = recipe('r2', 'Mash', { prepTasks: [prep('Peel the potatoes')] });
    const steak = recipe('r1', 'Steak', {
      prepTasks: [prep('Take the steak out')],
      components: [link('r2', 'Mash')],
    });

    const flat = flattenRecipePrepTasks(steak, recipeMap([steak, mash]));

    expect(flat.map(f => f.prepTask.title)).toEqual(['Take the steak out', 'Peel the potatoes']);
    expect(flat.map(f => f.recipe.name)).toEqual(['Steak', 'Mash']);
  });

  it('is empty when nothing in the tree has any', () => {
    const mash = recipe('r2', 'Mash');
    const steak = recipe('r1', 'Steak', { components: [link('r2', 'Mash')] });

    expect(flattenRecipePrepTasks(steak, recipeMap([steak, mash]))).toEqual([]);
  });
});

describe('reachableRecipeIds', () => {
  it('follows links transitively without naming the start', () => {
    const roux = recipe('r3', 'Roux');
    const sauce = recipe('r2', 'Sauce', { components: [link('r3', 'Roux')] });
    const bake = recipe('r1', 'Bake', { components: [link('r2', 'Sauce')] });

    expect(reachableRecipeIds(recipeMap([bake, sauce, roux]), 'r1')).toEqual(new Set(['r2', 'r3']));
  });

  it('names the start when it’s part of a loop', () => {
    const a = recipe('r1', 'A', { components: [link('r2', 'B')] });
    const b = recipe('r2', 'B', { components: [link('r1', 'A')] });

    expect(reachableRecipeIds(recipeMap([a, b]), 'r1').has('r1')).toBe(true);
  });
});

describe('wouldCreateRecipeCycle', () => {
  it('refuses a recipe as a component of itself', () => {
    const a = recipe('r1', 'A');
    expect(wouldCreateRecipeCycle(recipeMap([a]), 'r1', 'r1')).toBe(true);
  });

  it('refuses a candidate that already reaches back, at any depth', () => {
    const roux = recipe('r3', 'Roux', { components: [link('r1', 'Bake') ] });
    const sauce = recipe('r2', 'Sauce', { components: [link('r3', 'Roux')] });
    const bake = recipe('r1', 'Bake');

    expect(wouldCreateRecipeCycle(recipeMap([bake, sauce, roux]), 'r1', 'r2')).toBe(true);
  });

  it('allows an unrelated candidate, and a diamond', () => {
    const stock = recipe('r3', 'Stock');
    const gravy = recipe('r2', 'Gravy', { components: [link('r3', 'Stock')] });
    const roast = recipe('r1', 'Roast', { components: [link('r2', 'Gravy')] });

    expect(wouldCreateRecipeCycle(recipeMap([roast, gravy, stock]), 'r1', 'r3')).toBe(false);
  });
});

describe('recipesUsing', () => {
  it('names the direct parents of a recipe', () => {
    const mash = recipe('r3', 'Mash');
    const steak = recipe('r1', 'Steak', { components: [link('r3', 'Mash')] });
    const salmon = recipe('r2', 'Salmon', { components: [link('r3', 'Mash')] });
    const soup = recipe('r4', 'Soup');

    expect(recipesUsing([steak, salmon, soup, mash], 'r3').map(r => r.name)).toEqual(['Steak', 'Salmon']);
  });
});

describe('describeComponents', () => {
  it('counts, and says nothing for a plain recipe', () => {
    expect(describeComponents(recipe('r1', 'A'))).toBe('');
    expect(describeComponents(recipe('r1', 'A', { components: [link('r2', 'B')] }))).toBe('1 component');
    expect(describeComponents(recipe('r1', 'A', { components: [link('r2', 'B'), link('r3', 'C')] })))
      .toBe('2 components');
  });
});
