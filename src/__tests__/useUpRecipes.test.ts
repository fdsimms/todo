import { describeUseUpRecipe, useUpRecipes } from '../utils/useUpRecipes';
import { kitchenEntryId } from '../utils/kitchenInventory';
import type { KitchenEntry } from '../utils/kitchenInventory';
import type { LeftoverFreshness, Recipe, RecipeIngredient } from '../types';

// Pure key matching and ranking: nothing here reads a clock, since freshness
// arrives on the entries already resolved. The stub is only because the import
// of `freshnessRank` reaches dateUtils, which reaches the settings store. Same
// one kitchenInventory.test.ts uses.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;

function entry(
  title: string,
  freshness: LeftoverFreshness,
  overrides: Partial<KitchenEntry> = {}
): KitchenEntry {
  seq += 1;
  const key = title.toLowerCase();
  return {
    id: kitchenEntryId('grocery', `gi-${seq}`),
    sourceId: `gi-${seq}`,
    kind: 'grocery',
    title,
    section: 'Produce',
    useBy: '2026-08-14',
    freshness,
    daysLeft: 1,
    reason: 'bought 3×',
    useByCaption: 'Use by tomorrow',
    caption: 'bought 3× · Use by tomorrow',
    onList: false,
    onHandCount: null,
    matchKey: key,
    ...overrides,
  };
}

function ingredient(nameKey: string): RecipeIngredient {
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
    strict: false,
  } as RecipeIngredient;
}

function recipe(name: string, keys: string[]): Recipe {
  seq += 1;
  return {
    id: `r-${seq}`,
    name,
    ingredients: keys.map(ingredient),
  } as Recipe;
}

describe('useUpRecipes', () => {
  it('matches an ingredient to a dying item by nameKey', () => {
    const spinach = entry('Spinach', 'due');
    const suggestions = useUpRecipes([spinach], [recipe('Green pasta', ['spinach', 'pasta'])]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].recipe.name).toBe('Green pasta');
    expect(suggestions[0].uses.map(e => e.title)).toEqual(['Spinach']);
  });

  it('leaves out a recipe that uses none of what is dying', () => {
    expect(useUpRecipes([entry('Spinach', 'due')], [recipe('Pancakes', ['flour', 'eggs'])]))
      .toEqual([]);
  });

  it('says nothing at all when nothing is dying', () => {
    expect(useUpRecipes([], [recipe('Green pasta', ['spinach'])])).toEqual([]);
  });

  // The whole reason to rank rather than list: one dinner that clears two
  // casualties beats two dinners that clear one each.
  it('ranks a recipe using more of the dying food first', () => {
    const spinach = entry('Spinach', 'due');
    const mushrooms = entry('Mushrooms', 'due');
    const suggestions = useUpRecipes(
      [spinach, mushrooms],
      [recipe('Spinach soup', ['spinach']), recipe('Green pasta', ['spinach', 'mushrooms'])]
    );

    expect(suggestions.map(s => s.recipe.name)).toEqual(['Green pasta', 'Spinach soup']);
  });

  it('breaks a tie on how urgent the worst thing it uses is', () => {
    const suggestions = useUpRecipes(
      [entry('Spinach', 'soon'), entry('Mushrooms', 'over')],
      [recipe('Spinach soup', ['spinach']), recipe('Mushroom risotto', ['mushrooms'])]
    );

    expect(suggestions.map(s => s.recipe.name)).toEqual(['Mushroom risotto', 'Spinach soup']);
  });

  it('breaks a remaining tie on name, so the order does not depend on library order', () => {
    const suggestions = useUpRecipes(
      [entry('Spinach', 'due')],
      [recipe('Zucchini bake', ['spinach']), recipe('Applesauce', ['spinach'])]
    );

    expect(suggestions.map(s => s.recipe.name)).toEqual(['Applesauce', 'Zucchini bake']);
  });

  // One tomato named on two lines is one tomato being used up. Counting the
  // lines would let a recipe that mentions it twice outrank one that genuinely
  // clears two different things.
  it('counts an item once however many lines name it', () => {
    const suggestions = useUpRecipes(
      [entry('Tomatoes', 'due')],
      [recipe('Bruschetta', ['tomatoes', 'tomatoes', 'basil'])]
    );

    expect(suggestions[0].uses).toHaveLength(1);
  });

  it('ignores leftovers, whose match key is a free-typed title rather than a catalog row', () => {
    const chilli = entry('Chilli', 'over', {
      kind: 'leftover',
      id: kitchenEntryId('leftover', 'lo-1'),
      matchKey: 'chilli',
    });

    expect(useUpRecipes([chilli], [recipe('Chilli bake', ['chilli'])])).toEqual([]);
  });

  // A name with no letters or digits normalises to '', and an ingredient that
  // did the same would otherwise match every blank-keyed entry at once.
  it('never matches on a blank key', () => {
    const blank = entry('???', 'due', { matchKey: '' });

    expect(useUpRecipes([blank], [recipe('Mystery', [''])])).toEqual([]);
  });
});

describe('describeUseUpRecipe', () => {
  it('names what it would use, because the names are the reason to tap', () => {
    const one = useUpRecipes([entry('Spinach', 'due')], [recipe('Soup', ['spinach'])]);
    expect(describeUseUpRecipe(one[0])).toBe('Uses your Spinach');
  });

  it('joins a pair with "and"', () => {
    const two = useUpRecipes(
      [entry('Spinach', 'due'), entry('Mushrooms', 'due')],
      [recipe('Pasta', ['spinach', 'mushrooms'])]
    );
    expect(describeUseUpRecipe(two[0])).toBe('Uses your Mushrooms and Spinach');
  });

  it('caps at two names and counts the rest, which is where the line stops fitting', () => {
    const three = useUpRecipes(
      [entry('Spinach', 'due'), entry('Mushrooms', 'due'), entry('Tomatoes', 'due')],
      [recipe('Pasta', ['spinach', 'mushrooms', 'tomatoes'])]
    );
    expect(describeUseUpRecipe(three[0])).toBe('Uses your Mushrooms, Spinach and 1 more');
  });
});
