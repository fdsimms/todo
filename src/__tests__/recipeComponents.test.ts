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
  recipeAlternativeCaptions,
  choiceOptionsShownTogether,
  choiceGroupKey,
  componentPlacement,
  ingredientLayout,
  reanchorComponents,
  stepVisible,
  stepOptionNames,
  entryResolution,
  parseRecipeOverrides,
  describeOverrides,
  optionalCounts,
  toggleOptionalPick,
  skipPickId,
} from '../utils/recipeComponents';
import type { Recipe, RecipeComponent, RecipeIngredient, RecipeOverride, RecipePrepTask } from '../types';

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
    backfillDismissedFields: [],
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
    emptyStepSections: [],
    components: [],
    blanks: [],
    prepTasks: [],
    steps: [],
    sortOrder: ++seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    servingsMax: null,
    recipeYield: null,
    cookedWeightG: null,
    leftoverKeepDays: null, ovenTemp: null, ovenTempUnit: 'F', ovenTempStepId: null,
    imagePath: null,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    sourceType: null,
    sourcePage: null,
    cookbookId: null,
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
    upNext: false,
    upNextOrder: 0,
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

  it('keeps a trimmed amountUsed and leaves the key off when there is none', () => {
    const stored = JSON.stringify([
      { id: 'c1', recipeId: 'r2', name: 'A', amountUsed: '  1 tbsp ' },
      { id: 'c2', recipeId: 'r3', name: 'B', amountUsed: '   ' },
    ]);
    const [a, b] = parseRecipeComponents(stored);
    expect(a.amountUsed).toBe('1 tbsp');
    expect('amountUsed' in b).toBe(false);
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

  it('carries the link each part was reached through, and none for the meal', () => {
    const mash = recipe('r2', 'Mash');
    const roast = recipe('r3', 'Roast potatoes');
    const mashLink = link('r2', 'Mash', 'Side');
    const steak = recipe('r1', 'Steak', { components: [mashLink, link('r3', 'Roast potatoes', 'Side')] });

    const [meal, side] = cookedDishes(steak, recipeMap([steak, mash, roast]));

    expect('via' in meal).toBe(false);
    expect(side.via).toEqual({ parent: steak, component: mashLink });
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

  describe('mixed groups — an ingredient and a component sharing a label', () => {
    // "corn tortillas, or make Tortillas de Maíz instead" — the cross-type
    // case resolveGroupWinners exists for.
    const mixedLibrary = () => {
      const homemade = recipe('r-tortillas', 'Tortillas de Maíz', {
        ingredients: [ing('Masa harina'), ing('Water')],
      });
      const taco = recipe('r-taco', 'Fish tacos', {
        ingredients: [ing('Fish'), ing('Corn tortillas', 'Tortillas')],
        components: [link('r-tortillas', 'Tortillas de Maíz', 'Tortillas')],
      });
      return { taco, homemade, byId: recipeMap([taco, homemade]) };
    };

    it('buys the ingredient by default and never cooks the component too', () => {
      const { taco, byId } = mixedLibrary();
      expect(activeIngredients(taco).map(i => i.name)).toEqual(['Fish', 'Corn tortillas']);
      expect(activeComponents(taco)).toEqual([]);
      expect(flattenRecipeIngredients(taco, byId).map(f => f.ingredient.name))
        .toEqual(['Fish', 'Corn tortillas']);
    });

    it('cooking the component drops the ingredient and pulls in its own lines', () => {
      const { taco, byId } = mixedLibrary();
      const componentId = taco.components[0].id;
      expect(activeIngredients(taco, { chosen: [componentId] }).map(i => i.name)).toEqual(['Fish']);
      expect(activeComponents(taco, { chosen: [componentId] }).map(c => c.name))
        .toEqual(['Tortillas de Maíz']);
      expect(flattenRecipeIngredients(taco, byId, { chosen: [componentId] }).map(f => f.ingredient.name))
        .toEqual(['Fish', 'Masa harina', 'Water']);
    });

    it('poses one group, not two, ingredient first, and reports it as mixed', () => {
      const { taco, byId } = mixedLibrary();
      const groups = recipeChoiceGroups(taco, byId);
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe('Tortillas');
      expect(groups[0].kind).toBe('mixed');
      expect(groups[0].options.map(o => o.name)).toEqual(['Corn tortillas', 'Tortillas de Maíz']);
      expect(groups[0].active.name).toBe('Corn tortillas');
    });

    it('refuses to leave a mixed group undecided, unlike a pure ingredient group', () => {
      const { taco } = mixedLibrary();
      const key = choiceGroupKey(taco.id, 'Tortillas');
      expect(activeIngredients(taco, { undecided: [key] }).map(i => i.name))
        .toEqual(['Fish', 'Corn tortillas']);
    });

    it('refuses to skip a mixed group, since a dish is picked rather than left off', () => {
      const { taco } = mixedLibrary();
      const key = choiceGroupKey(taco.id, 'Tortillas');
      expect(activeIngredients(taco, { chosen: [skipPickId(taco.id, 'Tortillas')] }).map(i => i.name))
        .toEqual(['Fish', 'Corn tortillas']);
    });

    it('leaves a skipped ingredient group off entirely', () => {
      const { taco } = mixedLibrary();
      const withPepper = { ...taco, ingredients: [
        ...taco.ingredients,
        { ...taco.ingredients[0], id: 'p1', name: 'Serrano', nameKey: 'serrano', choiceGroup: 'Pepper' },
        { ...taco.ingredients[0], id: 'p2', name: 'Jalapeño', nameKey: 'jalapeno', choiceGroup: 'Pepper' },
      ] };
      expect(activeIngredients(withPepper, { chosen: [skipPickId(withPepper.id, 'Pepper')] }).map(i => i.name))
        .toEqual(['Fish', 'Corn tortillas']);
      expect(activeIngredients(withPepper).map(i => i.name)).toContain('Serrano');
    });

    it('captions each side with the other, crossing the two lists', () => {
      const { taco, byId } = mixedLibrary();
      const captions = recipeAlternativeCaptions(taco, byId);
      expect(captions.get(taco.ingredients[1].id)).toBe('or Tortillas de Maíz');
      expect(captions.get(taco.components[0].id)).toBe('or Corn tortillas');
    });
  });
});

describe('choiceOptionsShownTogether', () => {
  const row = (id: string, choiceGroup: string | null = null) => ({ id, choiceGroup });

  it('includes a group whose options sit side by side', () => {
    const rows = [row('a'), row('b', 'Chile'), row('c', 'Chile'), row('d')];
    expect([...choiceOptionsShownTogether(rows)]).toEqual(['b', 'c']);
  });

  it('leaves out a group another row splits up', () => {
    const rows = [row('b', 'Chile'), row('x'), row('c', 'Chile')];
    expect(choiceOptionsShownTogether(rows).size).toBe(0);
  });

  it('leaves out a group a section heading splits up', () => {
    const rows = [row('b', 'Chile'), row('heading:Sauce'), row('c', 'Chile')];
    expect(choiceOptionsShownTogether(rows).size).toBe(0);
  });

  it('judges each group on its own', () => {
    const rows = [row('b', 'Chile'), row('c', 'Chile'), row('m', 'Milk'), row('x'), row('n', 'Milk')];
    expect([...choiceOptionsShownTogether(rows)]).toEqual(['b', 'c']);
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

  it('defaults to whichever alternative is already on hand', () => {
    const r = salsa();
    expect(activeIngredients(r, { onHand: new Set(['jalapeño']) }).map(i => i.name))
      .toEqual(['Tomatoes', 'Jalapeño']);
    // No pantry match for either option: falls back to the first, exactly as
    // with no onHand set at all.
    expect(activeIngredients(r, { onHand: new Set(['habanero']) }).map(i => i.name))
      .toEqual(['Tomatoes', 'Serrano']);
  });

  it('lets an explicit pick outrank what is on hand', () => {
    const r = salsa();
    expect(activeIngredients(r, { chosen: [r.ingredients[1].id], onHand: new Set(['jalapeño']) })
      .map(i => i.name)).toEqual(['Tomatoes', 'Serrano']);
  });

  it('never lets onHand promote a component, even one whose name coincidentally matches', () => {
    // A mixed group: an ingredient ("Corn tortillas") alternative to a
    // component ("Tortillas de Maíz"). A component has no nameKey to check
    // against a pantry, so a set that happens to contain the component's
    // own name (lowercased) as a string must not be mistaken for a match —
    // the ingredient side still wins, same as with no onHand at all.
    const taco = recipe('r-taco', 'Fish tacos', {
      ingredients: [ing('Fish'), ing('Corn tortillas', 'Tortillas')],
      components: [link('r-tortillas', 'Tortillas de Maíz', 'Tortillas')],
    });
    const onHand = new Set(['tortillas de maíz']);
    expect(activeIngredients(taco, { onHand }).map(i => i.name)).toEqual(['Fish', 'Corn tortillas']);
    expect(activeComponents(taco, { onHand })).toEqual([]);
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

  it('names the on-hand option as active, and its own default for applyChoice', () => {
    const r = salsa();
    const groups = recipeChoiceGroups(r, recipeMap([r]), { onHand: new Set(['jalapeño']) });
    const pepperGroup = groups.find(g => g.label === 'Pepper')!;
    expect(pepperGroup.active.name).toBe('Jalapeño');
    expect(pepperGroup.defaultId).toBe(r.ingredients[2].id);
  });

  it('re-tapping an already-explicit pick that disagrees with what is on hand stays explicit', () => {
    const r = salsa();
    // Explicitly Serrano, even though Jalapeño is what's on hand.
    const groups = recipeChoiceGroups(r, recipeMap([r]), { chosen: [r.ingredients[1].id], onHand: new Set(['jalapeño']) });
    const pepperGroup = groups.find(g => g.label === 'Pepper')!;
    expect(pepperGroup.active.name).toBe('Serrano');
    expect(pepperGroup.defaultId).toBe(r.ingredients[2].id);
    // Re-picking Serrano must stay stored. Comparing against `active.id`
    // (Serrano, since the explicit pick wins) would wrongly treat this as
    // "picked its own current answer, so clear it" — the comparison has to
    // be against `defaultId` (Jalapeño, computed with no regard for what's
    // already chosen), which disagrees, so the pick stays explicit.
    const result = applyChoice([r.ingredients[1].id], pepperGroup, r.ingredients[1].id);
    expect(result).toEqual([r.ingredients[1].id]);
  });

  it('picking the on-hand default clears the answer, same as picking the first option would with nothing on hand', () => {
    const r = salsa();
    const groups = recipeChoiceGroups(r, recipeMap([r]), { onHand: new Set(['jalapeño']) });
    const pepperGroup = groups.find(g => g.label === 'Pepper')!;
    expect(applyChoice([], pepperGroup, r.ingredients[2].id)).toEqual([]);
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

describe('component placement', () => {
  const placed = (c: RecipeComponent, before: string | null, section: string | null = null): RecipeComponent =>
    ({ ...c, placement: { before, section } });

  describe('normalizeComponent', () => {
    it('keeps a placement, trimmed, and leaves an unplaced link without the key', () => {
      const withPlacement = normalizeComponent({ recipeId: 'r2', placement: { before: 'i1', section: '  Sauce ' } });
      expect(withPlacement?.placement).toEqual({ before: 'i1', section: 'Sauce' });
      expect(normalizeComponent({ recipeId: 'r2' })).not.toHaveProperty('placement');
    });

    it('reads a missing anchor as the end and a blank section as no heading', () => {
      expect(normalizeComponent({ recipeId: 'r2', placement: { before: '', section: '  ' } })?.placement)
        .toEqual({ before: null, section: null });
    });

    it('drops garbage, and keeps a placement on a link in a choice group', () => {
      expect(normalizeComponent({ recipeId: 'r2', placement: 'x' })).not.toHaveProperty('placement');
      expect(normalizeComponent({ recipeId: 'r2', choiceGroup: 'Side', placement: { before: 'i1', section: null } })?.placement)
        .toEqual({ before: 'i1', section: null });
    });
  });

  describe('componentPlacement', () => {
    it('is the placement a link carries, and nothing for one never placed', () => {
      const c = placed(link('r2', 'Mash'), 'i1');
      expect(componentPlacement(c)).toEqual({ before: 'i1', section: null });
      expect(componentPlacement(link('r3', 'Rub'))).toBeUndefined();
    });
  });

  describe('ingredientLayout', () => {
    it('is the lines, then the components, when nothing is placed', () => {
      const a = ing('A');
      const b = ing('B');
      const c = link('r2', 'Mash');
      const r = recipe('r1', 'Dinner', { ingredients: [a, b], components: [c] });
      expect(ingredientLayout(r)).toEqual([
        { kind: 'ingredient', ingredient: a },
        { kind: 'ingredient', ingredient: b },
        { kind: 'component', component: c },
      ]);
    });

    it('puts a component directly above the line it is anchored to', () => {
      const a = ing('A');
      const b = ing('B');
      const c = placed(link('r2', 'Mash'), b.id);
      const r = recipe('r1', 'Dinner', { ingredients: [a, b], components: [c] });
      expect(ingredientLayout(r).map(i => (i.kind === 'ingredient' ? i.ingredient.name : i.component.name)))
        .toEqual(['A', 'Mash', 'B']);
    });

    it('keeps component order within one slot, and puts a first-placed part above everything', () => {
      const a = ing('A');
      const first = placed(link('r2', 'One'), a.id);
      const second = placed(link('r3', 'Two'), a.id);
      const r = recipe('r1', 'Dinner', { ingredients: [a], components: [first, second] });
      expect(ingredientLayout(r).map(i => (i.kind === 'ingredient' ? i.ingredient.name : i.component.name)))
        .toEqual(['One', 'Two', 'A']);
    });

    it('sends an anchor that no longer resolves to the end', () => {
      const a = ing('A');
      const gone = placed(link('r2', 'Gone'), 'missing');
      const r = recipe('r1', 'Dinner', { ingredients: [a], components: [gone] });
      expect(ingredientLayout(r).map(i => (i.kind === 'ingredient' ? i.ingredient.name : i.component.name)))
        .toEqual(['A', 'Gone']);
    });

    it('places a link in a choice group like any other when it has a placement', () => {
      const a = ing('A');
      const b = ing('B');
      const rice = { ...placed(link('r2', 'Rice'), b.id), choiceGroup: 'Side' };
      const r = recipe('r1', 'Dinner', { ingredients: [a, b], components: [rice] });
      expect(ingredientLayout(r).map(i => (i.kind === 'ingredient' ? i.ingredient.name : i.component.name)))
        .toEqual(['A', 'Rice', 'B']);
    });

    it('draws an unplaced link that shares an ingredient’s group right after that group’s last line', () => {
      const corn = ing('Corn tortillas', 'Tortillas');
      const flour = ing('Flour tortillas', 'Tortillas');
      const salsa = ing('Salsa');
      const homemade = { ...link('r2', 'Homemade tortillas'), choiceGroup: 'Tortillas' };
      const r = recipe('r1', 'Tacos', { ingredients: [corn, flour, salsa], components: [homemade] });
      expect(ingredientLayout(r).map(i => (i.kind === 'ingredient' ? i.ingredient.name : i.component.name)))
        .toEqual(['Corn tortillas', 'Flour tortillas', 'Homemade tortillas', 'Salsa']);
    });
  });

  describe('flattenRecipeIngredients', () => {
    it('lands a component’s lines between the lines it was placed between', () => {
      const mash = recipe('r2', 'Mash', { ingredients: [ing('Potatoes')] });
      const steak = ing('Steak');
      const salt = ing('Salt');
      const dinner = recipe('r1', 'Dinner', {
        ingredients: [steak, salt],
        components: [placed(link('r2', 'Mash'), salt.id, 'Sides')],
      });
      const flat = flattenRecipeIngredients(dinner, recipeMap([dinner, mash]));
      expect(flat.map(f => f.ingredient.name)).toEqual(['Steak', 'Potatoes', 'Salt']);
      expect(flat.map(f => f.depth)).toEqual([0, 1, 0]);
      expect(flat[1].linkSection).toBe('Sides');
    });

    it('is unchanged for a recipe whose components were never placed', () => {
      const mash = recipe('r2', 'Mash', { ingredients: [ing('Potatoes')] });
      const dinner = recipe('r1', 'Dinner', { ingredients: [ing('Steak')], components: [link('r2', 'Mash')] });
      expect(flattenRecipeIngredients(dinner, recipeMap([dinner, mash])).map(f => f.ingredient.name))
        .toEqual(['Steak', 'Potatoes']);
    });

    it('still skips a component twice reached, and one the library no longer has', () => {
      const mash = recipe('r2', 'Mash', { ingredients: [ing('Potatoes')] });
      const a = ing('A');
      const dinner = recipe('r1', 'Dinner', {
        ingredients: [a],
        components: [placed(link('r2', 'Mash'), a.id), placed(link('gone', 'Gone'), a.id)],
      });
      expect(flattenRecipeIngredients(dinner, recipeMap([dinner, mash])).map(f => f.ingredient.name))
        .toEqual(['Potatoes', 'A']);
    });

    it('follows the placement through a component that has its own placed component', () => {
      const salsa = recipe('r3', 'Salsa', { ingredients: [ing('Tomato')] });
      const x = ing('X');
      const y = ing('Y');
      const fish = recipe('r2', 'Fish', { ingredients: [x, y], components: [placed(link('r3', 'Salsa'), y.id)] });
      const dinner = recipe('r1', 'Dinner', { ingredients: [ing('Rice')], components: [link('r2', 'Fish')] });
      expect(flattenRecipeIngredients(dinner, recipeMap([dinner, fish, salsa])).map(f => f.ingredient.name))
        .toEqual(['Rice', 'X', 'Tomato', 'Y']);
    });
  });

  describe('reanchorComponents', () => {
    const lines = [ing('A'), ing('B'), ing('C')];

    it('moves a part above a removed line to the next line that survives', () => {
      const c = placed(link('r2', 'Mash'), lines[1].id, 'Sauce');
      const [moved] = reanchorComponents([c], lines, new Set([lines[1].id]));
      expect(moved.placement).toEqual({ before: lines[2].id, section: 'Sauce' });
    });

    it('skips over several removed lines in a row, and falls to the end past the last', () => {
      const c = placed(link('r2', 'Mash'), lines[1].id);
      expect(reanchorComponents([c], lines, new Set([lines[1].id, lines[2].id]))[0].placement?.before).toBeNull();
    });

    it('leaves a part whose anchor stays, and an unplaced one, alone', () => {
      const keep = placed(link('r2', 'Mash'), lines[0].id);
      const bare = link('r3', 'Rub');
      const out = reanchorComponents([keep, bare], lines, new Set([lines[1].id]));
      expect(out[0]).toBe(keep);
      expect(out[1]).toBe(bare);
    });
  });
});

describe('stepVisible', () => {
  const serrano = ing('serrano', 'Pepper');
  const jalapeno = ing('jalapeño', 'Pepper');
  const plain = ing('salt');
  const r = recipe('r', 'Salsa', { ingredients: [serrano, jalapeno, plain] });

  it('shows a step that names no option', () => {
    expect(stepVisible({}, r)).toBe(true);
    expect(stepVisible({ onlyWhen: [] }, r)).toBe(true);
  });

  it('shows a step tied to the default option and hides one tied to the other', () => {
    expect(stepVisible({ onlyWhen: [serrano.id] }, r)).toBe(true);
    expect(stepVisible({ onlyWhen: [jalapeno.id] }, r)).toBe(false);
  });

  it('follows the pick in the resolution', () => {
    const picked = { chosen: [jalapeno.id] };
    expect(stepVisible({ onlyWhen: [serrano.id] }, r, picked)).toBe(false);
    expect(stepVisible({ onlyWhen: [jalapeno.id] }, r, picked)).toBe(true);
  });

  it('shows a step when any one of several named options is the pick', () => {
    expect(stepVisible({ onlyWhen: [jalapeno.id, serrano.id] }, r)).toBe(true);
  });

  it('shows everything under allOptions', () => {
    expect(stepVisible({ onlyWhen: [jalapeno.id] }, r, { allOptions: true })).toBe(true);
  });

  it('ignores an id that is not an option, and shows a step left with none', () => {
    expect(stepVisible({ onlyWhen: ['gone'] }, r)).toBe(true);
    // A line with no choiceGroup is not an option, so naming it is the same as naming nothing.
    expect(stepVisible({ onlyWhen: [plain.id] }, r)).toBe(true);
    // A dangling id beside a real one does not stop the real one deciding.
    expect(stepVisible({ onlyWhen: ['gone', jalapeno.id] }, r)).toBe(false);
  });

  it('judges a component option, and a group shared across the two lists', () => {
    const fish = recipe('fish', 'Homemade fish');
    const rice = ing('rice', 'Base');
    const dish = link('fish', 'Homemade fish', 'Base');
    const parent = recipe('p', 'Stew', { ingredients: [rice], components: [dish] });
    // Ingredients are tried first, so the rice line is the default.
    expect(stepVisible({ onlyWhen: [dish.id] }, parent)).toBe(false);
    expect(stepVisible({ onlyWhen: [dish.id] }, parent, { chosen: [dish.id] })).toBe(true);
    expect(stepVisible({ onlyWhen: [rice.id] }, parent, { chosen: [dish.id] })).toBe(false);
    expect(fish.id).toBe('fish');
  });

  it('treats an undecided ingredient group as all live', () => {
    const resolution = { undecided: [choiceGroupKey('r', 'Pepper')] };
    expect(stepVisible({ onlyWhen: [jalapeno.id] }, r, resolution)).toBe(true);
  });
});

describe('stepOptionNames', () => {
  it('names the options a step is tied to, in its own order, and skips ids that name none', () => {
    const a = ing('serrano', 'Pepper');
    const b = ing('jalapeño', 'Pepper');
    const c = ing('salt');
    const r = recipe('r', 'Salsa', { ingredients: [a, b, c] });
    expect(stepOptionNames({ onlyWhen: [b.id, 'gone', c.id, a.id] }, r)).toEqual(['jalapeño', 'serrano']);
    expect(stepOptionNames({}, r)).toEqual([]);
  });

  it('names a used recipe as it is now, not as it was when linked', () => {
    const renamed = recipe('fish', 'Pan-fried fish');
    const dish = link('fish', 'Homemade fish', 'Fish');
    const parent = recipe('p', 'Stew', { components: [dish] });
    expect(stepOptionNames({ onlyWhen: [dish.id] }, parent)).toEqual(['Homemade fish']);
    expect(stepOptionNames({ onlyWhen: [dish.id] }, parent, recipeMap([parent, renamed]))).toEqual(['Pan-fried fish']);
  });
});

describe('one-off overrides', () => {
  const fishLines = [ing('tofu'), ing('nori')];
  const fish = recipe('fish', 'Homemade fish', { ingredients: fishLines, steps: [{ id: 'f1', text: 'Fry the fillets.' }], prepTasks: [prep('Press the tofu')] });
  const dish = link('fish', 'Homemade fish');
  const broth = ing('broth');
  const stew = recipe('stew', 'Stew', { ingredients: [broth], components: [dish], steps: [{ id: 's1', text: 'Simmer.' }] });
  const byId = recipeMap([stew, fish]);
  const fillets: RecipeOverride = {
    targetId: dish.id,
    replacement: { ...ing('vegan fish fillets'), quantity: '8 oz' },
    note: 'Cook per the package first.',
  };

  it('replaces a used recipe with one line, in the slot the recipe held', () => {
    const flat = flattenRecipeIngredients(stew, byId, { overrides: [fillets] });
    expect(flat.map(f => f.ingredient.name)).toEqual(['broth', 'vegan fish fillets']);
    expect(flat[1]).toMatchObject({ replacedName: 'Homemade fish', replacedNote: 'Cook per the package first.', depth: 0 });
    // Without the override the dish's own lines are bought.
    expect(flattenRecipeIngredients(stew, byId).map(f => f.ingredient.name)).toEqual(['broth', 'tofu', 'nori']);
  });

  it('takes the replaced recipe\'s steps and prep tasks with it', () => {
    expect(activeComponents(stew, { overrides: [fillets] })).toEqual([]);
    expect(cookedDishes(stew, byId, { overrides: [fillets] }).map(d => d.recipe.id)).toEqual(['stew']);
    expect(flattenRecipePrepTasks(stew, byId, { overrides: [fillets] })).toEqual([]);
  });

  it('replaces one ingredient line in place, or leaves it out with a null replacement', () => {
    const line = stew.ingredients[0];
    const swapped = flattenRecipeIngredients(stew, byId, { overrides: [{ targetId: line.id, replacement: { ...ing('chicken stock') } }, { targetId: dish.id, replacement: null }] });
    expect(swapped.map(f => f.ingredient.name)).toEqual(['chicken stock']);
    expect(swapped[0].replacedName).toBe('broth');
    const gone = flattenRecipeIngredients(stew, byId, { overrides: [{ targetId: line.id, replacement: null }] });
    expect(gone.map(f => f.ingredient.name)).toEqual(['tofu', 'nori']);
  });

  it('does not run a standing swap over what the person typed for this time', () => {
    const milk = { ...ing('milk') };
    const r = recipe('r', 'R', { ingredients: [milk] });
    const swaps = new Map([['milk', { link: {} as never, from: { nameKey: 'milk' } as never, to: { name: 'oat milk', nameKey: 'oat milk' } as never }]]);
    const typed = { targetId: 'nothing', replacement: null } as RecipeOverride;
    // The swap applies to the recipe's own line...
    expect(flattenRecipeIngredients(r, recipeMap([r]), undefined, swaps)[0].swappedFrom).toBe('milk');
    // ...and not to a line replacing it.
    const over = { targetId: milk.id, replacement: { ...ing('milk') } } as RecipeOverride;
    expect(flattenRecipeIngredients(r, recipeMap([r]), { overrides: [over, typed] }, swaps)[0].swappedFrom).toBeNull();
  });

  it('ignores a target that is gone, and search (allOptions) still sees the used recipe', () => {
    const stale: RecipeOverride = { targetId: 'gone', replacement: null };
    expect(flattenRecipeIngredients(stew, byId, { overrides: [stale] }).map(f => f.ingredient.name)).toEqual(['broth', 'tofu', 'nori']);
    expect(activeComponents(stew, { overrides: [fillets], allOptions: true })).toEqual([dish]);
  });

  it('leaves a replaced option that lost its group alone', () => {
    // The replaced link is the either/or\'s non-pick, so it never cooked and the override changes nothing.
    const roast = link('fish', 'Roast', 'Side');
    const mash = ing('mash', 'Side');
    const r = recipe('r', 'R', { ingredients: [mash], components: [roast] });
    const out = flattenRecipeIngredients(r, recipeMap([r, fish]), { overrides: [{ targetId: roast.id, replacement: { ...ing('x') } }] });
    expect(out.map(f => f.ingredient.name)).toEqual(['mash']);
  });
});

describe('entryResolution', () => {
  it('builds from the picks and the overrides, and leaves the key off when there are none', () => {
    const o: RecipeOverride = { targetId: 'l', replacement: null };
    expect(entryResolution({ recipeChoices: ['a'], recipeOverrides: [o] }, { onHand: new Set(['x']) }))
      .toEqual({ chosen: ['a'], overrides: [o], itemPicks: [], onHand: new Set(['x']) });
    expect(entryResolution({ recipeChoices: ['a'], recipeOverrides: [] })).toEqual({ chosen: ['a'], itemPicks: [] });
    expect(entryResolution(null)).toEqual({ chosen: [], itemPicks: [] });
  });

  it('always carries the meal\'s answers to "either one" pairs, even when there are none, so a cooking in hand is never read as no cooking', () => {
    const picks = [{ pair: 'butter|vegan butter', use: 'butter' }];
    expect(entryResolution({ recipeChoices: [], recipeOverrides: [], itemPicks: picks }).itemPicks).toEqual(picks);
    expect(entryResolution({ recipeChoices: [], recipeOverrides: [] }).itemPicks).toEqual([]);
  });
});

describe('parseRecipeOverrides', () => {
  it('reads a stored list and repairs a replacement', () => {
    const raw = JSON.stringify([
      { targetId: 'a', replacement: { name: ' fillets ', quantity: '8 oz' }, note: ' ok ' },
      { targetId: 'b', replacement: null },
    ]);
    const out = parseRecipeOverrides(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ targetId: 'a', note: 'ok', replacement: { name: 'fillets', nameKey: 'fillets', quantity: '8 oz', choiceGroup: null } });
    expect(out[0].replacement!.id).toBeTruthy();
    expect(out[1]).toEqual({ targetId: 'b', replacement: null });
  });

  it('drops a row with no target, a nameless replacement, a repeat, and tolerates garbage', () => {
    expect(parseRecipeOverrides(JSON.stringify([
      { targetId: '', replacement: null },
      { targetId: 'a', replacement: { name: '  ' } },
      { targetId: 'b', replacement: null },
      { targetId: 'b', replacement: null },
      'x', null, 3,
    ]))).toEqual([{ targetId: 'b', replacement: null }]);
    expect(parseRecipeOverrides('{not json')).toEqual([]);
    expect(parseRecipeOverrides(null)).toEqual([]);
    expect(parseRecipeOverrides('{}')).toEqual([]);
  });
});

describe('describeOverrides', () => {
  it('says each override in a plain sentence, skipping a target the recipe no longer has', () => {
    const fish = recipe('fish', 'Homemade fish');
    const dish = link('fish', 'Homemade fish');
    const salt = ing('salt');
    const stew = recipe('stew', 'Stew', { ingredients: [salt], components: [dish] });
    const lines = describeOverrides(stew, recipeMap([stew, fish]), [
      { targetId: dish.id, replacement: { ...ing('vegan fish fillets'), quantity: '8 oz' }, note: 'Cook per the package first' },
      { targetId: salt.id, replacement: null },
      { targetId: 'gone', replacement: null },
    ]);
    expect(lines).toEqual([
      'Homemade fish is replaced by 8 oz vegan fish fillets. Cook per the package first.',
      'salt is left out.',
    ]);
  });
});

describe('optionalCounts / toggleOptionalPick', () => {
  it('counts every ordinary line, and an optional one only when picked or asked for', () => {
    const plain = ing('salt');
    const garnish = { ...ing('lime wedges'), optional: true };
    expect(optionalCounts(plain)).toBe(true);
    expect(optionalCounts(garnish)).toBe(false);
    expect(optionalCounts(garnish, { chosen: [garnish.id] })).toBe(true);
    expect(optionalCounts(garnish, { withOptional: true })).toBe(true);
  });

  it('toggles one id in the meal’s picks and leaves the rest', () => {
    expect(toggleOptionalPick(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleOptionalPick(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('keeps an optional line in the flatten, so cook mode and the shopping sheet still show it', () => {
    const garnish = { ...ing('lime wedges'), optional: true };
    const dish = recipe('tacos', 'Tacos', { ingredients: [ing('tortillas'), garnish] });
    expect(flattenRecipeIngredients(dish, recipeMap([dish])).map(f => f.ingredient.name)).toEqual(['tortillas', 'lime wedges']);
  });
});
