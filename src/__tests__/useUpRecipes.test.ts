import { describeUseUpRecipe, useUpRecipes } from '../utils/useUpRecipes';
import { kitchenEntryId } from '../utils/kitchenInventory';
import type { KitchenEntry } from '../utils/kitchenInventory';
import type { GroceryItem, LeftoverFreshness, Recipe, RecipeIngredient } from '../types';

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
    productName: null,
    itemId: null,
    section: 'Produce',
    useBy: '2026-08-14',
    freshness,
    daysLeft: 1,
    reason: 'bought 3×',
    useByCaption: 'Use by tomorrow',
    caption: 'bought 3× · Use by tomorrow',
    onList: false,
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

  it('matches across a plural, the way the catalog itself resolves one', () => {
    const peppers = entry('Serrano peppers', 'due');
    const suggestions = useUpRecipes([peppers], [recipe('Stir-fry', ['serrano pepper', 'rice'])]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].uses.map(e => e.title)).toEqual(['Serrano peppers']);
  });

  it('counts a singular and a plural line as the one thing being used up', () => {
    const tomatoes = entry('Tomatoes', 'due');
    // "2 tomatoes" for the sauce and "1 tomato" to garnish is one tomato being
    // used up, the same rule the exact-key case keeps.
    const suggestions = useUpRecipes([tomatoes], [recipe('Sauce', ['tomatoes', 'tomato'])]);
    expect(suggestions[0].uses).toHaveLength(1);
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

  // Varieties (GroceryItem.varietyOfKey) — a dying variety answers for its
  // generic name too. Still exact keys, one hop, specific-satisfies-generic
  // only; see the module header.
  describe('varieties', () => {
    const catalogRow = (name: string, varietyOfKey: string | null) => {
      seq += 1;
      return {
        id: `gi-v-${seq}`,
        name,
        nameKey: name.toLowerCase(),
        varietyOfKey,
      } as GroceryItem;
    };

    it('matches a generic line to a dying declared variety', () => {
      const white = entry('White onion', 'due');
      const items = [catalogRow('White onion', 'onion')];
      const suggestions = useUpRecipes([white], [recipe('Ragù', ['onion'])], items);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].uses.map(e => e.title)).toEqual(['White onion']);
    });

    it('never matches a specific line to a dying generic', () => {
      // A recipe that asked for red onion in particular is not answered by
      // generic onion going off — the caption side of the feature handles it.
      const onion = entry('Onion', 'due');
      const items = [catalogRow('Red onion', 'onion')];
      expect(useUpRecipes([onion], [recipe('Pickles', ['red onion'])], items)).toEqual([]);
    });

    it('lets a real dying entry under the generic key win over the alias', () => {
      const onion = entry('Onion', 'soon');
      const white = entry('White onion', 'due');
      const items = [catalogRow('White onion', 'onion')];
      const suggestions = useUpRecipes([onion, white], [recipe('Ragù', ['onion'])], items);

      expect(suggestions[0].uses.map(e => e.title)).toEqual(['Onion']);
    });

    it('settles two dying varieties of one generic on the more urgent', () => {
      const white = entry('White onion', 'soon');
      const red = entry('Red onion', 'due');
      const items = [catalogRow('White onion', 'onion'), catalogRow('Red onion', 'onion')];
      const suggestions = useUpRecipes([white, red], [recipe('Ragù', ['onion'])], items);

      expect(suggestions[0].uses.map(e => e.title)).toEqual(['Red onion']);
    });

    it('changes nothing when no items are passed, same as before it existed', () => {
      const white = entry('White onion', 'due');
      expect(useUpRecipes([white], [recipe('Ragù', ['onion'])])).toEqual([]);
    });
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
