import {
  parseRecipeComponents,
  normalizeComponent,
  makeComponent,
  recipeMap,
  resolveComponents,
  cookedDishes,
  flattenRecipeIngredients,
  flattenRecipePrepTasks,
  reachableRecipeIds,
  wouldCreateRecipeCycle,
  recipesUsing,
  recipesUsingIngredient,
  describeComponents,
  activeComponents,
  activeIngredients,
  countChoiceAware,
  describeChoices,
  recipeChoiceGroups,
  applyChoice,
  parseRecipeChoices,
  alternativeCaptions,
} from '../utils/recipeComponents';
import type { Recipe, RecipeComponent, RecipeIngredient, RecipePrepTask } from '../types';

let seq = 0;

function ing(name: string, choiceGroup: string | null = null): RecipeIngredient {
  return {
    id: `ing-${++seq}`,
    name,
    nameKey: name.toLowerCase(),
    quantity: '',
    aisle: null,
    prep: null,
    purpose: null,
    section: null,
    choiceGroup,
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
    tags: [],
    ingredients: [],
    emptySections: [],
    components: [],
    prepTasks: [],
    steps: [],
    sortOrder: ++seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    servingsMax: null,
    recipeYield: null,
    leftoverKeepDays: null,
    imagePath: null,
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
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
  };
}

function link(recipeId: string, name: string, choiceGroup: string | null = null): RecipeComponent {
  return { id: `c-${++seq}`, recipeId, name, choiceGroup };
}

describe('parseRecipeComponents', () => {
  it('reads a stored array, and a blob predating choice groups is unconditional', () => {
    const stored = JSON.stringify([{ id: 'c1', recipeId: 'r2', name: 'Mashed potatoes' }]);
    expect(parseRecipeComponents(stored)).toEqual([
      { id: 'c1', recipeId: 'r2', name: 'Mashed potatoes', choiceGroup: null },
    ]);
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

  // #1571 — the rule itself is pinned in standingSwaps.test.ts; what this
  // covers is that the gate every shopping read goes through actually applies
  // it, components included, and that a caller passing none is unaffected.
  it('applies a standing swap on the way out, at any depth', () => {
    const mash = recipe('r2', 'Mash', { ingredients: [ing('Potatoes'), ing('Milk')] });
    const steak = recipe('r1', 'Steak with mash', {
      ingredients: [ing('Steak')],
      components: [link('r2', 'Mash')],
    });
    const swaps = new Map([['milk', {
      link: {
        itemId: 'i-milk', subItemId: 'i-oat', note: null,
        createdAt: '2026-01-01T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: true,
      },
      from: { name: 'Milk', nameKey: 'milk', aisle: null } as never,
      to: { name: 'Oat milk', nameKey: 'oat milk', aisle: 'Dairy' } as never,
    }]]);

    const flat = flattenRecipeIngredients(steak, recipeMap([steak, mash]), undefined, swaps);

    expect(flat.map(f => f.ingredient.name)).toEqual(['Steak', 'Potatoes', 'Oat milk']);
    expect(flat.map(f => f.swappedFrom)).toEqual([null, null, 'Milk']);
    // The recipe itself is untouched — the swap is a read, not a write.
    expect(mash.ingredients.map(i => i.name)).toEqual(['Potatoes', 'Milk']);
    // ...and a caller that passes no rules reads the recipe's own words, which
    // is what every authoring and search read wants.
    expect(flattenRecipeIngredients(steak, recipeMap([steak, mash])).map(f => f.ingredient.name))
      .toEqual(['Steak', 'Potatoes', 'Milk']);
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

describe('cookedDishes', () => {
  it('is the meal alone when nothing is composed', () => {
    const toast = recipe('r1', 'Toast', { ingredients: [ing('Bread')] });

    expect(cookedDishes(toast, recipeMap([toast]))).toEqual([{ recipe: toast, whole: true }]);
  });

  it('names the meal and each part it cooked, depth-first', () => {
    const gravy = recipe('r3', 'Gravy');
    const mash = recipe('r2', 'Mash', { components: [link('r3', 'Gravy')] });
    const steak = recipe('r1', 'Steak with mash', { components: [link('r2', 'Mash')] });

    const dishes = cookedDishes(steak, recipeMap([steak, mash, gravy]));

    expect(dishes.map(d => d.recipe.name)).toEqual(['Steak with mash', 'Mash', 'Gravy']);
    expect(dishes.map(d => d.whole)).toEqual([true, false, false]);
  });

  it('names a shared part once', () => {
    const stock = recipe('r4', 'Stock');
    const gravy = recipe('r3', 'Gravy', { components: [link('r4', 'Stock')] });
    const soup = recipe('r2', 'Soup', { components: [link('r4', 'Stock')] });
    const feast = recipe('r1', 'Feast', { components: [link('r3', 'Gravy'), link('r2', 'Soup')] });

    expect(cookedDishes(feast, recipeMap([feast, gravy, soup, stock])).map(d => d.recipe.name))
      .toEqual(['Feast', 'Gravy', 'Stock', 'Soup']);
  });

  it('leaves out the alternative that was not cooked', () => {
    const mash = recipe('r2', 'Mash');
    const roast = recipe('r3', 'Roast potatoes');
    const mashLink = link('r2', 'Mash', 'Side');
    const roastLink = link('r3', 'Roast potatoes', 'Side');
    const steak = recipe('r1', 'Steak', { components: [mashLink, roastLink] });
    const byId = recipeMap([steak, mash, roast]);

    expect(cookedDishes(steak, byId).map(d => d.recipe.name)).toEqual(['Steak', 'Mash']);
    expect(cookedDishes(steak, byId, { chosen: [roastLink.id] }).map(d => d.recipe.name))
      .toEqual(['Steak', 'Roast potatoes']);
  });

  it('shrugs off a part whose recipe is gone', () => {
    const steak = recipe('r1', 'Steak', { components: [link('gone', 'Mash')] });

    expect(cookedDishes(steak, recipeMap([steak])).map(d => d.recipe.name)).toEqual(['Steak']);
  });

  it('terminates on a cycle', () => {
    const a = recipe('r1', 'A', { components: [link('r2', 'B')] });
    const b = recipe('r2', 'B', { components: [link('r1', 'A')] });

    expect(cookedDishes(a, recipeMap([a, b])).map(d => d.recipe.name)).toEqual(['A', 'B']);
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

describe('recipesUsingIngredient', () => {
  it('names every recipe whose flattened ingredients carry the key', () => {
    const chili = recipe('r1', 'Chili', { ingredients: [ing('Onion'), ing('Beans')] });
    const soup = recipe('r2', 'Soup', { ingredients: [ing('Onion'), ing('Stock')] });
    const cake = recipe('r3', 'Cake', { ingredients: [ing('Flour')] });

    expect(recipesUsingIngredient('onion', [chili, soup, cake]).map(r => r.name))
      .toEqual(['Chili', 'Soup']);
  });

  it('counts a component\'s ingredients, so a parent recipe that only reaches an item through a component still matches', () => {
    const mash = recipe('r2', 'Mash', { ingredients: [ing('Butter')] });
    const soup = recipe('r3', 'Soup', { ingredients: [ing('Stock')] });
    const steak = recipe('r1', 'Steak with mash', {
      ingredients: [ing('Steak')],
      components: [link('r2', 'Mash')],
    });

    // Steak's own ingredients never mention butter — it only reaches it
    // through the mash component, which is exactly the case this exists for.
    expect(recipesUsingIngredient('butter', [steak, soup, mash]).map(r => r.name))
      .toEqual(['Steak with mash', 'Mash']);
  });

  it('is empty for a key nothing calls for, or a blank key', () => {
    const chili = recipe('r1', 'Chili', { ingredients: [ing('Onion')] });
    expect(recipesUsingIngredient('paprika', [chili])).toEqual([]);
    expect(recipesUsingIngredient('', [chili])).toEqual([]);
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

describe('choice groups', () => {
  // "Steak, with either mash or roast potatoes" — the shape the whole feature
  // is for. Ungrouped components (the steak's own rub) stay unconditional.
  const library = () => {
    const mash = recipe('r-mash', 'Mash', { ingredients: [ing('Potatoes'), ing('Butter')] });
    const roast = recipe('r-roast', 'Roast potatoes', { ingredients: [ing('Potatoes'), ing('Oil')] });
    const rub = recipe('r-rub', 'Steak rub', { ingredients: [ing('Paprika')] });
    const steak = recipe('r-steak', 'Steak dinner', {
      ingredients: [ing('Steak')],
      components: [
        link('r-rub', 'Steak rub'),
        link('r-mash', 'Mash', 'Side'),
        link('r-roast', 'Roast potatoes', 'Side'),
      ],
    });
    return { steak, mash, roast, rub, byId: recipeMap([steak, mash, roast, rub]) };
  };

  describe('activeComponents', () => {
    it('keeps every ungrouped component and only the first of each group', () => {
      const { steak } = library();
      expect(activeComponents(steak).map(c => c.name)).toEqual(['Steak rub', 'Mash']);
    });

    it('honours a chosen option', () => {
      const { steak } = library();
      const roastId = steak.components[2].id;
      expect(activeComponents(steak, { chosen: [roastId] }).map(c => c.name))
        .toEqual(['Steak rub', 'Roast potatoes']);
    });

    it('falls back to the default for an id that names nothing', () => {
      const { steak } = library();
      expect(activeComponents(steak, { chosen: ['gone'] }).map(c => c.name))
        .toEqual(['Steak rub', 'Mash']);
    });

    it('gives every alternative under allOptions', () => {
      const { steak } = library();
      expect(activeComponents(steak, { allOptions: true }).map(c => c.name))
        .toEqual(['Steak rub', 'Mash', 'Roast potatoes']);
    });
  });

  describe('flattenRecipeIngredients', () => {
    it('shops for one side, not both', () => {
      const { steak, byId } = library();
      expect(flattenRecipeIngredients(steak, byId).map(f => f.ingredient.name))
        .toEqual(['Steak', 'Paprika', 'Potatoes', 'Butter']);
    });

    it('follows the pick', () => {
      const { steak, byId } = library();
      const roastId = steak.components[2].id;
      expect(flattenRecipeIngredients(steak, byId, { chosen: [roastId] }).map(f => f.ingredient.name))
        .toEqual(['Steak', 'Paprika', 'Potatoes', 'Oil']);
    });

    // Both options' lines, including the potatoes twice — the once-per-flatten
    // rule dedupes *recipes*, not ingredient names, so two sides that share an
    // ingredient each contribute their own line. Harmless for the search this
    // exists for, and exactly why no shopping path may pass it: classifyPlanned
    // would merge those two into one doubled quantity.
    it('sees both sides under allOptions, so search can find either', () => {
      const { steak, byId } = library();
      expect(flattenRecipeIngredients(steak, byId, { allOptions: true }).map(f => f.ingredient.name))
        .toEqual(['Steak', 'Paprika', 'Potatoes', 'Butter', 'Potatoes', 'Oil']);
    });
  });

  describe('flattenRecipePrepTasks', () => {
    it('leaves out the unchosen option’s steps', () => {
      const mash = recipe('r-mash', 'Mash', { prepTasks: [prep('Boil the potatoes')] });
      const roast = recipe('r-roast', 'Roast potatoes', { prepTasks: [prep('Heat the oven')] });
      const steak = recipe('r-steak', 'Steak', {
        components: [link('r-mash', 'Mash', 'Side'), link('r-roast', 'Roast potatoes', 'Side')],
      });
      const byId = recipeMap([steak, mash, roast]);

      expect(flattenRecipePrepTasks(steak, byId).map(f => f.prepTask.title))
        .toEqual(['Boil the potatoes']);
      expect(flattenRecipePrepTasks(steak, byId, { chosen: [steak.components[1].id] })
        .map(f => f.prepTask.title)).toEqual(['Heat the oven']);
    });
  });

  describe('describeChoices', () => {
    it('names the active option', () => {
      const { steak, byId } = library();
      expect(describeChoices(recipeChoiceGroups(steak, byId))).toBe('Mash');
    });

    it('follows the pick', () => {
      const { steak, byId } = library();
      const roastId = steak.components[2].id;
      expect(describeChoices(recipeChoiceGroups(steak, byId, { chosen: [roastId] })))
        .toBe('Roast potatoes');
    });

    it('joins several groups in order', () => {
      const groups = [
        { active: { name: 'Roast potatoes' } },
        { active: { name: 'Green beans' } },
      ] as unknown as Parameters<typeof describeChoices>[0];
      expect(describeChoices(groups)).toBe('Roast potatoes, Green beans');
    });

    // A meal with no either/or renders no caption at all, rather than a
    // dangling separator.
    it('is empty for a recipe with no groups', () => {
      expect(describeChoices([])).toBe('');
    });

    it('drops an option whose name is blank rather than leaving a gap', () => {
      const groups = [
        { active: { name: '  ' } },
        { active: { name: 'Mash' } },
      ] as unknown as Parameters<typeof describeChoices>[0];
      expect(describeChoices(groups)).toBe('Mash');
    });
  });

  describe('recipeChoiceGroups', () => {
    it('names the group, its options in order, and which one is live', () => {
      const { steak, byId } = library();

      const [group] = recipeChoiceGroups(steak, byId);

      expect(recipeChoiceGroups(steak, byId)).toHaveLength(1);
      expect(group.label).toBe('Side');
      expect(group.recipe).toBe(steak);
      expect(group.options.map(o => o.name)).toEqual(['Mash', 'Roast potatoes']);
      expect(group.active.name).toBe('Mash');
    });

    it('follows the pick', () => {
      const { steak, byId } = library();
      const roastId = steak.components[2].id;

      expect(recipeChoiceGroups(steak, byId, { chosen: [roastId] })[0].active.name)
        .toBe('Roast potatoes');
    });

    it('poses a nested group only while the branch holding it is being cooked', () => {
      const cream = recipe('r-cream', 'Creamed mash');
      const plain = recipe('r-plain', 'Plain mash');
      const mash = recipe('r-mash', 'Mash', {
        components: [link('r-cream', 'Creamed mash', 'Style'), link('r-plain', 'Plain mash', 'Style')],
      });
      const roast = recipe('r-roast', 'Roast potatoes');
      const steak = recipe('r-steak', 'Steak', {
        components: [link('r-mash', 'Mash', 'Side'), link('r-roast', 'Roast potatoes', 'Side')],
      });
      const byId = recipeMap([steak, mash, roast, cream, plain]);

      // Mash is the default, so its own question is live and attributed to it.
      const onMash = recipeChoiceGroups(steak, byId);
      expect(onMash.map(g => g.label)).toEqual(['Side', 'Style']);
      expect(onMash[1].recipe).toBe(mash);

      // Pick the roast and the mash's question goes away with it.
      const onRoast = recipeChoiceGroups(steak, byId, { chosen: [steak.components[1].id] });
      expect(onRoast.map(g => g.label)).toEqual(['Side']);
    });
  });

  describe('applyChoice', () => {
    it('replaces the group’s answer rather than adding a second one', () => {
      const { steak, byId } = library();
      const [group] = recipeChoiceGroups(steak, byId);
      const roastId = steak.components[2].id;
      const mashId = steak.components[1].id;

      const chosen = applyChoice([], group, roastId);
      expect(chosen).toEqual([roastId]);
      // Back to the default: stored as no answer at all, which resolves the same
      // way and keeps following the default if it's later reordered.
      expect(applyChoice(chosen, group, mashId)).toEqual([]);
    });

    it('leaves other groups’ answers alone', () => {
      const { steak, byId } = library();
      const [group] = recipeChoiceGroups(steak, byId);
      expect(applyChoice(['other-group-pick'], group, steak.components[2].id))
        .toEqual(['other-group-pick', steak.components[2].id]);
    });
  });

  describe('parseRecipeChoices', () => {
    it('reads a list, and shrugs off everything else', () => {
      expect(parseRecipeChoices(JSON.stringify(['c1', 'c2']))).toEqual(['c1', 'c2']);
      expect(parseRecipeChoices(JSON.stringify(['c1', 'c1']))).toEqual(['c1']);
      expect(parseRecipeChoices(JSON.stringify(['c1', 3, null, '']))).toEqual(['c1']);
      expect(parseRecipeChoices(null)).toEqual([]);
      expect(parseRecipeChoices('not json')).toEqual([]);
      expect(parseRecipeChoices('{"a":1}')).toEqual([]);
    });
  });

  describe('normalizeComponent', () => {
    it('trims a label and treats a blank one as no group', () => {
      expect(normalizeComponent({ recipeId: 'r2', name: 'B', choiceGroup: '  Side  ' })?.choiceGroup)
        .toBe('Side');
      expect(normalizeComponent({ recipeId: 'r2', name: 'B', choiceGroup: '   ' })?.choiceGroup)
        .toBeNull();
      expect(normalizeComponent({ recipeId: 'r2', name: 'B' })?.choiceGroup).toBeNull();
    });
  });

  describe('describeComponents', () => {
    it('counts a group once, however many ways it can be made', () => {
      const { steak } = library();
      // The rub, plus one side — not three parts.
      expect(describeComponents(steak)).toBe('2 components');
    });
  });

  describe('reachableRecipeIds', () => {
    it('walks unchosen alternatives too, so a loop can’t hide in one', () => {
      const { steak, byId } = library();
      expect([...reachableRecipeIds(byId, 'r-steak')].sort())
        .toEqual(['r-mash', 'r-roast', 'r-rub']);
      // The loop the cycle check has to catch lives down the *second* option.
      expect(wouldCreateRecipeCycle(byId, 'r-roast', 'r-steak')).toBe(true);
    });
  });
});

describe('either/or ingredients', () => {
  // "Serrano or jalapeño" — two rows under one label, never one line saying
  // "or", which is the whole reason this is a group rather than a spelling.
  const salsa = () => recipe('r-salsa', 'Salsa', {
    ingredients: [
      ing('Tomatoes'),
      ing('Serrano', 'Pepper'),
      ing('Jalapeño', 'Pepper'),
    ],
  });

  it('buys one pepper, not both', () => {
    const r = salsa();
    expect(activeIngredients(r).map(i => i.name)).toEqual(['Tomatoes', 'Serrano']);
    expect(activeIngredients(r, { chosen: [r.ingredients[2].id] }).map(i => i.name))
      .toEqual(['Tomatoes', 'Jalapeño']);
  });

  it('keeps each alternative a clean catalog name — never the "or" string', () => {
    const r = salsa();
    // The point of the whole feature: what reaches the grocery list is a real
    // item key, so it can match a purchase and rank in the catalog.
    expect(activeIngredients(r).map(i => i.nameKey)).toEqual(['tomatoes', 'serrano']);
    expect(r.ingredients.some(i => i.name.toLowerCase().includes(' or '))).toBe(false);
  });

  it('flattens the pick through a composed recipe', () => {
    const r = salsa();
    const tacos = recipe('r-tacos', 'Tacos', {
      ingredients: [ing('Tortillas')],
      components: [link('r-salsa', 'Salsa')],
    });
    const byId = recipeMap([tacos, r]);

    expect(flattenRecipeIngredients(tacos, byId).map(f => f.ingredient.name))
      .toEqual(['Tortillas', 'Tomatoes', 'Serrano']);
    expect(flattenRecipeIngredients(tacos, byId, { chosen: [r.ingredients[2].id] })
      .map(f => f.ingredient.name)).toEqual(['Tortillas', 'Tomatoes', 'Jalapeño']);
  });

  it('sees both peppers under allOptions, so search finds either', () => {
    const r = salsa();
    expect(flattenRecipeIngredients(r, recipeMap([r]), { allOptions: true }).map(f => f.ingredient.name))
      .toEqual(['Tomatoes', 'Serrano', 'Jalapeño']);
  });

  it('poses the question through recipeChoiceGroups, components first', () => {
    const r = salsa();
    const mash = recipe('r-mash', 'Mash');
    const roast = recipe('r-roast', 'Roast');
    const dinner = recipe('r-dinner', 'Dinner', {
      ingredients: [ing('Steak'), ing('Butter', 'Fat'), ing('Oil', 'Fat')],
      components: [link('r-mash', 'Mash', 'Side'), link('r-roast', 'Roast', 'Side')],
    });
    const byId = recipeMap([dinner, mash, roast, r]);

    const groups = recipeChoiceGroups(dinner, byId);

    expect(groups.map(g => [g.label, g.kind])).toEqual([['Side', 'component'], ['Fat', 'ingredient']]);
    expect(groups[1].options.map(o => o.name)).toEqual(['Butter', 'Oil']);
    expect(groups[1].active.name).toBe('Butter');
    // One list answers both kinds — an ingredient pick and a component pick
    // travel together and neither disturbs the other.
    const withOil = applyChoice([], groups[1], dinner.ingredients[2].id);
    const withRoast = applyChoice(withOil, groups[0], dinner.components[1].id);
    expect(withRoast).toHaveLength(2);
    const resolved = recipeChoiceGroups(dinner, byId, { chosen: withRoast });
    expect(resolved.map(g => g.active.name)).toEqual(['Roast', 'Oil']);
  });

  it('counts a group once, so a meal reads as the one pepper it buys', () => {
    expect(countChoiceAware(salsa().ingredients)).toBe(2);
  });
});

describe('alternativeCaptions', () => {
  it('names the siblings on every option of a group, not just the first', () => {
    const a = ing('Serrano', 'Pepper');
    const b = ing('Jalapeño', 'Pepper');
    const caps = alternativeCaptions([a, b]);
    expect(caps.get(a.id)).toBe('or Jalapeño');
    expect(caps.get(b.id)).toBe('or Serrano');
  });

  it('chains three options and reaches ones that are not adjacent', () => {
    const a = ing('Cheddar', 'Cheese');
    const plain = ing('Flour');
    const b = ing('Manchego', 'Cheese');
    const c = ing('Gruyère', 'Cheese');
    const caps = alternativeCaptions([a, plain, b, c]);
    expect(caps.get(a.id)).toBe('or Manchego or Gruyère');
    expect(caps.get(b.id)).toBe('or Cheddar or Gruyère');
    expect(caps.get(c.id)).toBe('or Cheddar or Manchego');
    // An ordinary line is not an alternative to anything.
    expect(caps.has(plain.id)).toBe(false);
  });

  it('says nothing about a group with one surviving option, or none at all', () => {
    expect(alternativeCaptions([ing('Serrano', 'Pepper')]).size).toBe(0);
    expect(alternativeCaptions([ing('Flour'), ing('Sugar')]).size).toBe(0);
    expect(alternativeCaptions([]).size).toBe(0);
  });

  it('keeps groups apart', () => {
    const a = ing('Butter', 'Fat');
    const b = ing('Oil', 'Fat');
    const c = ing('Serrano', 'Pepper');
    const d = ing('Jalapeño', 'Pepper');
    const caps = alternativeCaptions([a, c, b, d]);
    expect(caps.get(a.id)).toBe('or Oil');
    expect(caps.get(c.id)).toBe('or Jalapeño');
  });

  it('falls back for a blank name rather than rendering \'or \'', () => {
    const a = ing('Serrano', 'Pepper');
    const b = { ...ing('x', 'Pepper'), name: '  ' };
    expect(alternativeCaptions([a, b]).get(a.id)).toBe('or unnamed');
  });
});
