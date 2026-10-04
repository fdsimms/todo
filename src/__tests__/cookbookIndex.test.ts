import type { Cookbook, CookbookIndexEntry, GroceryItem, Recipe } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import { OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
import {
  cleanIndexEntryFields,
  cleanIndexIngredients,
  describeIndexLocation,
  entriesInCookbook,
  findWithIngredients,
  findWithPantry,
  pantryIngredients,
  indexEntryInBook,
  MAX_INDEX_INGREDIENTS,
  mentionsIngredient,
  splitIngredientText,
} from '../utils/cookbookIndex';
import { makeIngredient, recipeNameKey } from '../utils/recipeUtils';
import { makeComponent } from '../utils/recipeComponents';

// recipeUtils reaches the settings store; nothing here reads a setting.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;

function recipe(name: string, lines: string[] = [], overrides: Partial<Recipe> = {}): Recipe {
  return {
    backfillDismissedFields: [],
    id: `r-${++seq}`,
    name,
    nameKey: recipeNameKey(name),
    notes: '',
    sourceUrl: null,
    sourceName: null,
    author: null,
    source: null,
    sourceType: null,
    sourcePage: null,
    cookbookId: null,
    servings: null,
    servingsMax: null,
    recipeYield: null,
    cookedWeightG: null,
    leftoverKeepDays: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients: lines.map(line => makeIngredient(line)!),
    emptySections: [],
    components: [],
    prepTasks: [],
    steps: [],
    emptyStepSections: [],
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
    upNext: false,
    upNextOrder: 0,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
    ...overrides,
  };
}

function book(id: string, title: string): Cookbook {
  return { id, title, titleKey: `${title.toLowerCase()}|`, author: null, sortOrder: 1, createdAt: '' };
}

function entry(cookbookId: string, title: string, page: string | null, ingredients: string[] = []): CookbookIndexEntry {
  return { id: `e-${++seq}`, cookbookId, title, page, ingredients, createdAt: '' };
}

const six = book('b-six', 'Six Seasons');
const plenty = book('b-plenty', 'Plenty');

describe('cleaning an entry', () => {
  it('keeps each ingredient once, in the order given, and drops blanks', () => {
    expect(cleanIndexIngredients([' Lentils ', 'shallots', 'lentils', '', '  '])).toEqual(['Lentils', 'shallots']);
  });

  it('keeps no more than an index would list', () => {
    const many = Array.from({ length: 20 }, (_, i) => `thing ${i}`);
    expect(cleanIndexIngredients(many)).toHaveLength(MAX_INDEX_INGREDIENTS);
  });

  it('splits a typed list on commas, semicolons and new lines', () => {
    expect(cleanIndexIngredients(splitIngredientText('lentils, shallots; parsley\nfeta'))).toEqual([
      'lentils', 'shallots', 'parsley', 'feta',
    ]);
  });

  it('refuses an entry with no title, and takes the p. off a page the way a recipe\'s page does', () => {
    expect(cleanIndexEntryFields({ title: ' ', page: '1', ingredients: [] })).toBeNull();
    expect(cleanIndexEntryFields({ title: 'Soup', page: ' p. 142 ', ingredients: [] })).toEqual({
      title: 'Soup', page: '142', ingredients: [],
    });
    expect(cleanIndexEntryFields({ title: 'Soup', page: '  ', ingredients: [] })!.page).toBeNull();
  });

  it('finds the line a book already has under a name, however it is spelled', () => {
    const soup = entry('b-six', 'Lentil Soup', '88');
    expect(indexEntryInBook([soup], 'lentil soup', 'b-six')).toBe(soup);
    expect(indexEntryInBook([soup], 'lentil soup', 'b-plenty')).toBeNull();
  });
});

describe('mentionsIngredient', () => {
  it('matches whole words, singular or plural', () => {
    expect(mentionsIngredient('red lentils', 'lentils')).toBe(true);
    expect(mentionsIngredient('lentil', 'lentils')).toBe(true);
    expect(mentionsIngredient('lentils', 'lentil')).toBe(true);
    expect(mentionsIngredient('smoked paprika', 'smoked paprika')).toBe(true);
  });

  it('never matches part of a word', () => {
    expect(mentionsIngredient('eggplant', 'egg')).toBe(false);
    expect(mentionsIngredient('pineapple', 'apple')).toBe(false);
  });

  it('needs every word of a two-word ingredient, in order', () => {
    expect(mentionsIngredient('smoked sweet paprika', 'smoked paprika')).toBe(false);
    expect(mentionsIngredient('paprika', 'smoked paprika')).toBe(false);
  });
});

describe('findWithIngredients', () => {
  it('finds your recipes by what they are made of, most matches first', () => {
    const salad = recipe('Lentil salad', ['1 cup lentils', '100g feta']);
    const soup = recipe('Red lentil soup', ['1 cup red lentils', '1 onion']);
    const cake = recipe('Carrot cake', ['3 carrots']);

    const { recipes } = findWithIngredients(['lentils', 'feta'], [soup, cake, salad], [], []);

    expect(recipes.map(h => h.recipe.name)).toEqual(['Lentil salad', 'Red lentil soup']);
    expect(recipes[0].matched).toEqual(['lentils', 'feta']);
    expect(recipes[1].matched).toEqual(['lentils']);
  });

  it('reads through a recipe\'s components, and not its name alone', () => {
    const lentils = recipe('Braised lentils', ['1 cup lentils']);
    const dinner = recipe('Sausages', ['4 sausages'], { components: [makeComponent(lentils)] });
    const named = recipe('Lentil night', ['2 potatoes']);

    const names = findWithIngredients(['lentils'], [lentils, dinner, named], [], []).recipes.map(h => h.recipe.name);

    expect(names).toEqual(expect.arrayContaining(['Braised lentils', 'Sausages']));
    expect(names).not.toContain('Lentil night');
  });

  it('finds index lines by their ingredients or their title, with the book they are in', () => {
    const braised = entry('b-six', 'Braised greens', '142', ['lentils', 'shallots']);
    const titled = entry('b-plenty', 'Lentil and herb fritters', '210');
    const other = entry('b-six', 'Fennel salad', '40', ['fennel']);

    const { entries } = findWithIngredients(['lentils'], [], [braised, titled, other], [six, plenty]);

    expect(entries.map(h => h.entry.title)).toEqual(['Lentil and herb fritters', 'Braised greens']);
    expect(entries[0].cookbook).toBe(plenty);
  });

  it('leaves out a line whose recipe is already typed up, and links one that isn\'t', () => {
    const typedUp = recipe('Braised lentils', ['1 cup lentils'], { cookbookId: 'b-six' });
    const empty = recipe('Lentil soup', [], { cookbookId: 'b-six' });
    const e1 = entry('b-six', 'Braised lentils', '142', ['lentils']);
    const e2 = entry('b-six', 'Lentil soup', '88', ['lentils']);

    const results = findWithIngredients(['lentils'], [typedUp, empty], [e1, e2], [six]);

    expect(results.recipes.map(h => h.recipe.name)).toEqual(['Braised lentils']);
    expect(results.entries.map(h => h.entry.title)).toEqual(['Lentil soup']);
    expect(results.entries[0].recipe).toBe(empty);
  });

  it('keeps a same-named recipe from another book from hiding the line', () => {
    const elsewhere = recipe('Lentil soup', ['1 cup lentils'], { cookbookId: 'b-plenty' });
    const line = entry('b-six', 'Lentil soup', '88', ['lentils']);

    expect(findWithIngredients(['lentils'], [elsewhere], [line], [six, plenty]).entries).toHaveLength(1);
  });

  it('orders index lines by matches, then book, then page', () => {
    const a = entry('b-six', 'Soup', '200', ['lentils']);
    const b = entry('b-six', 'Stew', '12', ['lentils']);
    const c = entry('b-plenty', 'Salad', '300', ['lentils', 'feta']);

    const titles = findWithIngredients(['lentils', 'feta'], [], [a, b, c], [six, plenty]).entries.map(h => h.entry.title);

    expect(titles).toEqual(['Salad', 'Stew', 'Soup']);
  });

  it('answers nothing when nothing was asked', () => {
    expect(findWithIngredients([' ', ''], [recipe('X', ['1 lentil'])], [], [])).toEqual({ recipes: [], entries: [] });
  });
});

describe('a book\'s own index', () => {
  it('lists in page order, front matter first and no page last', () => {
    const entries = [
      entry('b-six', 'Late', '300'),
      entry('b-six', 'Pageless', null),
      entry('b-six', 'Intro', 'xii'),
      entry('b-six', 'Early', '12'),
      entry('b-plenty', 'Elsewhere', '1'),
    ];
    expect(entriesInCookbook(entries, 'b-six').map(e => e.title)).toEqual(['Intro', 'Early', 'Late', 'Pageless']);
  });

  it('says where to look', () => {
    expect(describeIndexLocation(entry('b-six', 'Soup', '88'), six)).toBe('Six Seasons, p. 88');
    expect(describeIndexLocation(entry('b-six', 'Soup', null), six)).toBe('Six Seasons');
  });
});

// A catalog row, with only what the pantry read looks at filled in.
function item(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    nameFromScan: false, id: `i-${++seq}`, nameKey: groceryNameKey(name), name,
    preferredProductId: null, productStrict: false, aisle: 'Other', quantity: null,
    quantityFromRecipe: false, note: '', onList: false, checked: false, sortOrder: seq,
    purchaseCount: 0, lastAddedAt: null, lastPurchasedAt: null, createdAt: '2025-01-01T00:00:00.000Z',
    onHandUntil: null, sourceRecipeId: null, sourceRecipeTitle: null, choiceGroup: null,
    isStaple: false, expiresAt: null, frozenAt: null, openedAt: null, runningLowAt: null,
    shelfLifeDays: null, useUpTask: null, pantryCheckDeclinedAt: null, pantryReviewedAt: null,
    usedUpCount: 0, spoiledCount: 0, lastSpoiledAt: null, varietyOfKey: null, nutrition: null,
    backfillDismissedFields: [], lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null,
    priceHistory: [],
    ...overrides,
  };
}

describe('pantryIngredients', () => {
  const NOW = new Date(2026, 8, 30, 12);
  const gotIt = new Date(2026, 9, 14, 12).toISOString();

  it('is what the pantry says you have, less the staples', () => {
    const have = pantryIngredients([
      item('Lentils', { onHandUntil: gotIt }),
      item('Salt', { onHandUntil: gotIt, isStaple: true }),
      item('Feta', { onHandUntil: OUT_OF_IT_UNTIL }),
      item('Bread'),
    ], NOW);

    expect(have.map(h => h.word)).toEqual(['Lentils']);
  });

  it('lets a variety answer for the generic it names', () => {
    const [onion] = pantryIngredients([item('White onion', { onHandUntil: gotIt, varietyOfKey: 'onion' })], NOW);
    expect(onion.keys).toEqual(['white onion', 'onion']);
  });
});

describe('findWithPantry', () => {
  const have = [
    { word: 'Butter', keys: ['butter'] },
    { word: 'Lentil', keys: ['lentil'] },
    { word: 'White onion', keys: ['white onion', 'onion'] },
  ];

  it('matches a recipe line naming the same item, singular or plural, and nothing that merely contains it', () => {
    const dal = recipe('Dal', ['1 cup lentils', '1 onion']);
    const toast = recipe('Peanut toast', ['2 tbsp peanut butter']);
    const redOnion = recipe('Pickles', ['1 red onion']);

    const { recipes } = findWithPantry(have, [toast, redOnion, dal], [], []);

    expect(recipes.map(h => h.recipe.name)).toEqual(['Dal']);
    expect(recipes[0].matched).toEqual(['Lentil', 'White onion']);
  });

  it('reads an index line\'s ingredients but not its title', () => {
    const listed = entry('b-six', 'Braised greens', '142', ['lentils']);
    const titled = entry('b-six', 'Butter beans', '12');

    const titles = findWithPantry(have, [], [listed, titled], [six]).entries.map(h => h.entry.title);

    expect(titles).toEqual(['Braised greens']);
  });

  it('answers nothing for an empty pantry', () => {
    expect(findWithPantry([], [recipe('Dal', ['1 cup lentils'])], [], [])).toEqual({ recipes: [], entries: [] });
  });
});
