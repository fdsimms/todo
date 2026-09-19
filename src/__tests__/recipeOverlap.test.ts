import {
  describeOverlap,
  overlapSeedFromPlanned,
  overlapSeedFromRecipes,
  rankOverlapRecipes,
} from '../utils/recipeOverlap';
import { recipeMap } from '../utils/recipeComponents';
import type { PlannedIngredient } from '../utils/mealPlanGroceries';
import type { GroceryItem, Recipe, RecipeIngredient } from '../types';

// Pure key matching and ranking — no clock, no store. Fixtures are partial
// casts in the style useUpRecipes.test.ts already uses.

let seq = 0;

function ingredient(nameKey: string, overrides: Partial<RecipeIngredient> = {}): RecipeIngredient {
  seq += 1;
  return {
    id: `ri-${seq}`,
    name: nameKey,
    nameKey,
    quantity: '',
    aisle: null,
    prep: null,
    purpose: null,
    section: null,
    choiceGroup: null,
    ...overrides,
  } as RecipeIngredient;
}

function recipe(name: string, keys: string[], componentIds: string[] = []): Recipe {
  seq += 1;
  return {
    id: `r-${seq}`,
    name,
    ingredients: keys.map(k => ingredient(k)),
    components: componentIds.map((recipeId, i) => ({
      id: `rc-${seq}-${i}`,
      recipeId,
      name: recipeId,
      choiceGroup: null,
    })),
  } as Recipe;
}

function item(nameKey: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  seq += 1;
  return {
    id: `gi-${seq}`,
    name: nameKey,
    nameKey,
    varietyOfKey: null,
    isStaple: false,
    onList: false,
    checked: false,
    ...overrides,
  } as GroceryItem;
}

/** The seed a single recipe makes, which is most of what these tests need. */
function seedOf(root: Recipe, library: Recipe[] = [root], items: GroceryItem[] = []) {
  return overlapSeedFromRecipes([root], recipeMap(library), items);
}

function rank(root: Recipe, library: Recipe[], items: GroceryItem[] = []) {
  const all = [root, ...library];
  return rankOverlapRecipes(seedOf(root, all, items), all, recipeMap(all), items);
}

describe('rankOverlapRecipes', () => {
  it('counts an ingredient both recipes call for', () => {
    const seed = recipe('Stir-fry', ['garlic', 'soy sauce']);
    const other = recipe('Salmon', ['garlic', 'lemon']);

    const out = rank(seed, [other]);

    expect(out).toHaveLength(1);
    expect(out[0].recipe.name).toBe('Salmon');
    expect(out[0].score).toBe(1);
    expect(out[0].shared.map(s => s.key)).toEqual(['garlic']);
  });

  it('leaves out a recipe sharing nothing', () => {
    const seed = recipe('Stir-fry', ['garlic']);
    const other = recipe('Oats', ['oats', 'milk']);

    expect(rank(seed, [other])).toEqual([]);
  });

  it('never offers the seed back as something to cook alongside itself', () => {
    const seed = recipe('Stir-fry', ['garlic']);

    expect(rank(seed, [])).toEqual([]);
  });

  it('ranks a recipe sharing more of the seed first', () => {
    const seed = recipe('Stir-fry', ['garlic', 'ginger', 'scallion']);
    const two = recipe('Noodles', ['garlic', 'ginger']);
    const one = recipe('Salmon', ['garlic']);

    expect(rank(seed, [one, two]).map(m => m.recipe.name)).toEqual(['Noodles', 'Salmon']);
  });

  it('breaks a remaining tie on name, so order does not depend on library order', () => {
    const seed = recipe('Stir-fry', ['garlic']);
    const zed = recipe('Zucchini bake', ['garlic']);
    const ant = recipe('Antipasti', ['garlic']);

    expect(rank(seed, [zed, ant]).map(m => m.recipe.name)).toEqual(['Antipasti', 'Zucchini bake']);
  });

  it('counts a shared thing once however many lines name it', () => {
    const seed = recipe('Sauce', ['tomato']);
    const other = recipe('Salad', ['tomato', 'tomato']);

    expect(rank(seed, [other])[0].score).toBe(1);
  });

  it('ignores a line the recipe excludes from the shopping list', () => {
    const seed = recipe('Sauce', ['water', 'tomato']);
    const other = recipe('Soup', [], []);
    other.ingredients = [
      ingredient('water', { excludeFromShoppingList: true }),
      ingredient('stock'),
    ];

    expect(rank(seed, [other])).toEqual([]);
  });

  it('ignores a blank key rather than letting two of them match each other', () => {
    const seed = recipe('Mystery', ['']);
    const other = recipe('Enigma', ['']);

    expect(rank(seed, [other])).toEqual([]);
  });

  describe('components', () => {
    it('counts an ingredient the candidate only calls for through a component', () => {
      const seed = recipe('Steak', ['butter', 'steak']);
      const mash = recipe('Mash', ['butter', 'potato']);
      const dinner = recipe('Chicken dinner', ['chicken'], [mash.id]);

      const out = rank(seed, [dinner, mash]);

      expect(out.map(m => m.recipe.name)).toContain('Chicken dinner');
      expect(out.find(m => m.recipe.name === 'Chicken dinner')!.shared.map(s => s.key)).toEqual([
        'butter',
      ]);
    });

    it('counts an ingredient the seed only calls for through a component', () => {
      const rice = recipe('Steamed rice', ['rice']);
      const seed = recipe('Stir-fry', ['soy sauce'], [rice.id]);
      const other = recipe('Rice pudding', ['rice', 'milk']);

      const out = rank(seed, [other, rice]);

      expect(out.map(m => m.recipe.name)).toEqual(['Rice pudding']);
      expect(out[0].shared.map(s => s.key)).toEqual(['rice']);
    });

    it('never offers a component of the seed back, since it is already being made', () => {
      const rice = recipe('Steamed rice', ['rice']);
      const seed = recipe('Stir-fry', ['soy sauce'], [rice.id]);

      expect(rank(seed, [rice])).toEqual([]);
    });
  });

  describe('plurals', () => {
    it('matches a singular line against a plural one', () => {
      const seed = recipe('Sauce', ['tomatoes']);
      const other = recipe('Salad', ['tomato', 'basil']);

      expect(rank(seed, [other])[0].shared.map(s => s.key)).toEqual(['tomatoes']);
    });

    it('counts a candidate naming both the singular and the plural once', () => {
      const seed = recipe('Sauce', ['tomato']);
      const other = recipe('Salad', ['tomato', 'tomatoes']);

      expect(rank(seed, [other])[0].score).toBe(1);
    });
  });

  describe('varieties', () => {
    // A declared variety answers for its generic, one hop, in both directions
    // — but never chained, so two varieties of one generic stay apart.
    const whiteOnion = () => item('white onion', { varietyOfKey: 'onion' });
    const redOnion = () => item('red onion', { varietyOfKey: 'onion' });

    it("matches a candidate's generic against the seed's declared variety", () => {
      const seed = recipe('Soup', ['white onion']);
      const other = recipe('Stew', ['onion', 'beef']);

      const out = rank(seed, [other], [whiteOnion()]);

      expect(out).toHaveLength(1);
      expect(out[0].score).toBe(1);
    });

    it("matches a candidate's declared variety against the seed's generic", () => {
      const seed = recipe('Soup', ['onion']);
      const other = recipe('Stew', ['red onion', 'beef']);

      const out = rank(seed, [other], [redOnion()]);

      expect(out).toHaveLength(1);
      expect(out[0].score).toBe(1);
    });

    it('refuses to chain two varieties together through the generic they share', () => {
      const seed = recipe('Soup', ['white onion']);
      const other = recipe('Stew', ['red onion', 'beef']);

      expect(rank(seed, [other], [whiteOnion(), redOnion()])).toEqual([]);
    });

    it('counts a candidate naming both the variety and the generic once', () => {
      const seed = recipe('Soup', ['white onion']);
      const other = recipe('Stew', ['white onion', 'onion']);

      expect(rank(seed, [other], [whiteOnion()])[0].score).toBe(1);
    });
  });

  describe('staples', () => {
    const salt = () => item('salt', { isStaple: true });

    it('shows a shared staple without counting it toward the score', () => {
      const seed = recipe('Stir-fry', ['salt', 'garlic']);
      const other = recipe('Salmon', ['salt', 'garlic']);

      const out = rank(seed, [other], [salt()]);

      expect(out[0].score).toBe(1);
      expect(out[0].shared.map(s => s.key)).toEqual(['garlic']);
      expect(out[0].sharedStaples.map(s => s.key)).toEqual(['salt']);
    });

    it('drops a recipe whose only overlap is a staple', () => {
      const seed = recipe('Stir-fry', ['salt', 'garlic']);
      const other = recipe('Cake', ['salt', 'flour']);

      expect(rank(seed, [other], [salt()])).toEqual([]);
    });

    it('ranks on the plain shared count when the catalog marks no staples', () => {
      const seed = recipe('Stir-fry', ['salt', 'garlic']);
      const other = recipe('Cake', ['salt', 'flour']);

      const out = rank(seed, [other], [item('salt')]);

      expect(out).toHaveLength(1);
      expect(out[0].score).toBe(1);
    });

    it('breaks a tie on shared staples, so the closer basket wins', () => {
      const seed = recipe('Stir-fry', ['garlic', 'salt']);
      const withStaple = recipe('Salmon', ['garlic', 'salt']);
      const without = recipe('Aioli', ['garlic']);

      const out = rank(seed, [without, withStaple], [salt()]);

      expect(out.map(m => m.recipe.name)).toEqual(['Salmon', 'Aioli']);
    });
  });

  it('prefers the catalog row own name for a chip, since that is what the user typed', () => {
    const seed = recipe('Stir-fry', ['scallion']);
    const other = recipe('Noodles', ['scallion']);

    const out = rank(seed, [other], [item('scallion', { name: 'Spring onions' })]);

    expect(out[0].shared[0].name).toBe('Spring onions');
  });

  it('says nothing at all for an empty seed', () => {
    const other = recipe('Salmon', ['garlic']);
    const all = [other];

    expect(rankOverlapRecipes(overlapSeedFromRecipes([], recipeMap(all)), all, recipeMap(all))).toEqual(
      []
    );
  });
});

describe('overlapSeedFromPlanned', () => {
  const planned = (nameKey: string, recipeId: string): PlannedIngredient => ({
    name: nameKey,
    nameKey,
    quantity: '',
    aisle: null,
    source: `Tue ${recipeId}`,
    recipeId,
  });

  it('seeds from a week and never offers a planned recipe back', () => {
    const stirFry = recipe('Stir-fry', ['garlic']);
    const salmon = recipe('Salmon', ['garlic', 'lemon']);
    const all = [stirFry, salmon];

    const seed = overlapSeedFromPlanned([planned('garlic', stirFry.id)]);
    const out = rankOverlapRecipes(seed, all, recipeMap(all));

    expect(out.map(m => m.recipe.name)).toEqual(['Salmon']);
  });

  it('pools the whole week, so a candidate sharing with two nights scores twice', () => {
    const monday = recipe('Stir-fry', ['garlic']);
    const tuesday = recipe('Soup', ['carrot']);
    const candidate = recipe('Traybake', ['garlic', 'carrot', 'potato']);
    const all = [monday, tuesday, candidate];

    const seed = overlapSeedFromPlanned([
      planned('garlic', monday.id),
      planned('carrot', tuesday.id),
    ]);

    expect(rankOverlapRecipes(seed, all, recipeMap(all))[0].score).toBe(2);
  });

  it('says nothing for a week with nothing planned', () => {
    const all = [recipe('Salmon', ['garlic'])];

    expect(rankOverlapRecipes(overlapSeedFromPlanned([]), all, recipeMap(all))).toEqual([]);
  });
});

describe('describeOverlap', () => {
  const match = (names: string[], staples: string[] = []) => ({
    recipe: recipe('x', []),
    shared: names.map(name => ({ key: name, name, staple: false })),
    sharedStaples: staples.map(name => ({ key: name, name, staple: true })),
    score: names.length,
  });

  it('names one', () => {
    expect(describeOverlap(match(['garlic']))).toBe('Shares garlic');
  });

  it('joins a pair with "and"', () => {
    expect(describeOverlap(match(['garlic', 'ginger']))).toBe('Shares garlic and ginger');
  });

  it('caps the list and counts the rest', () => {
    expect(describeOverlap(match(['a', 'b', 'c', 'd', 'e']))).toBe('Shares a, b, c and 2 more');
  });

  it('names the counted ones before the staples', () => {
    expect(describeOverlap(match(['garlic'], ['salt']))).toBe('Shares garlic and salt');
  });
});
