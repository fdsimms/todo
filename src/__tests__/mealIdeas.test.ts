import {
  MIN_MEAL_IDEAS,
  MAX_MEAL_IDEAS,
  mealTitleKey,
  clampIdeaCount,
  dedupeMealIdeas,
  mergeMealSuggestions,
  recentlyCookedTitles,
  expiringItemHints,
  mealIdeaRecipeDraft,
  AI_INVENTED_RECIPE_SOURCE,
  type MealIdea,
} from '../utils/mealIdeas';
import { RECIPE_NAME_MAX_LENGTH } from '../types';
import type { Recipe } from '../types';

// mealIdeas → recipeUtils → mealPlanGroceries → dateUtils → the settings
// store, which nothing here needs. Same mock as recipeUtils.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;
function recipe(name: string, overrides: Partial<Recipe> = {}): Recipe {
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
    emptySections: [],
    components: [],
    prepTasks: [],
    steps: [],
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
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
  };
}

const idea = (title: string, blurb = ''): MealIdea => ({ id: `i-${++seq}`, title, blurb });

describe('mealTitleKey', () => {
  it('folds case and surrounding whitespace', () => {
    expect(mealTitleKey('  Lemon Chicken ')).toBe('lemon chicken');
  });
});

describe('clampIdeaCount', () => {
  it('asks for at least the minimum even for a single empty night', () => {
    expect(clampIdeaCount(1)).toBe(MIN_MEAL_IDEAS);
  });

  it('caps a wide-open month at the maximum', () => {
    expect(clampIdeaCount(30)).toBe(MAX_MEAL_IDEAS);
  });

  it('passes a count already inside the band straight through', () => {
    expect(clampIdeaCount(4)).toBe(4);
  });

  it('rounds a fractional count', () => {
    expect(clampIdeaCount(4.6)).toBe(5);
  });

  it('falls back to the minimum for a non-finite count', () => {
    expect(clampIdeaCount(NaN)).toBe(MIN_MEAL_IDEAS);
    expect(clampIdeaCount(Infinity)).toBe(MIN_MEAL_IDEAS);
  });
});

describe('dedupeMealIdeas', () => {
  it('returns nothing for a missing list', () => {
    expect(dedupeMealIdeas(undefined)).toEqual([]);
  });

  it('keeps titles and blurbs, minting an id per idea', () => {
    const out = dedupeMealIdeas([{ title: 'Lemon chicken', blurb: 'Roast, one tray' }]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Lemon chicken');
    expect(out[0].blurb).toBe('Roast, one tray');
    expect(out[0].id).toBeTruthy();
  });

  it('mints a distinct id per idea', () => {
    const out = dedupeMealIdeas([{ title: 'A' }, { title: 'B' }]);
    expect(out[0].id).not.toBe(out[1].id);
  });

  it('drops blank and non-string titles', () => {
    const out = dedupeMealIdeas([
      { title: '   ' }, { title: 42 }, { title: null }, { title: 'Real one' },
    ]);
    expect(out.map(i => i.title)).toEqual(['Real one']);
  });

  it('drops a title colliding case-insensitively with a known one', () => {
    const out = dedupeMealIdeas(
      [{ title: 'lemon CHICKEN' }, { title: 'Fish pie' }],
      ['Lemon chicken'],
    );
    expect(out.map(i => i.title)).toEqual(['Fish pie']);
  });

  it('drops a duplicate within the same response', () => {
    const out = dedupeMealIdeas([{ title: 'Fish pie' }, { title: 'fish pie ' }]);
    expect(out).toHaveLength(1);
  });

  it('caps the set at MAX_MEAL_IDEAS however many come back', () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({ title: `Dish ${i}` }));
    expect(dedupeMealIdeas(raw)).toHaveLength(MAX_MEAL_IDEAS);
  });

  it('trims a title to the recipe-name limit so it can be saved as one', () => {
    const out = dedupeMealIdeas([{ title: 'x'.repeat(RECIPE_NAME_MAX_LENGTH + 40) }]);
    expect(out[0].title).toHaveLength(RECIPE_NAME_MAX_LENGTH);
  });

  it('empties a non-string blurb rather than carrying it through', () => {
    const out = dedupeMealIdeas([{ title: 'Fish pie', blurb: 12 }]);
    expect(out[0].blurb).toBe('');
  });
});

describe('mergeMealSuggestions', () => {
  it('is exactly the ranked list when there are no ideas', () => {
    const ranked = [recipe('Chilli'), recipe('Fish pie')];
    const out = mergeMealSuggestions(ranked, []);
    expect(out.map(s => s.kind)).toEqual(['recipe', 'recipe']);
    expect(out.map(s => (s.kind === 'recipe' ? s.recipe.name : ''))).toEqual(['Chilli', 'Fish pie']);
  });

  it('keeps the ranked order the caller handed in', () => {
    const ranked = [recipe('Zebra stew'), recipe('Apple bake')];
    const out = mergeMealSuggestions(ranked, [idea('New thing')]);
    expect(out.slice(0, 2).map(s => (s.kind === 'recipe' ? s.recipe.name : ''))).toEqual([
      'Zebra stew', 'Apple bake',
    ]);
  });

  it('never puts an idea ahead of a ranked recipe', () => {
    const out = mergeMealSuggestions([recipe('Chilli')], [idea('Invented')]);
    const firstIdea = out.findIndex(s => s.kind === 'idea');
    const lastRecipe = out.map(s => s.kind).lastIndexOf('recipe');
    expect(firstIdea).toBeGreaterThan(lastRecipe);
  });

  it('drops an idea that duplicates a ranked recipe, keeping the real one', () => {
    const out = mergeMealSuggestions([recipe('Fish pie')], [idea('fish PIE'), idea('Chilli')]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'recipe' });
    expect(out[1]).toMatchObject({ kind: 'idea' });
    expect(out[1].kind === 'idea' && out[1].idea.title).toBe('Chilli');
  });

  it('emits ideas alone when the offline ranking has nothing', () => {
    const out = mergeMealSuggestions([], [idea('Invented')]);
    expect(out.map(s => s.kind)).toEqual(['idea']);
  });

  it('gives every row a distinct key', () => {
    const out = mergeMealSuggestions([recipe('Chilli')], [idea('A'), idea('B')]);
    expect(new Set(out.map(s => s.key)).size).toBe(out.length);
  });

  it('defaults to the ranked list when no ideas are passed at all', () => {
    expect(mergeMealSuggestions([recipe('Chilli')])).toHaveLength(1);
  });
});

describe('recentlyCookedTitles', () => {
  const now = new Date('2026-02-01T12:00:00.000Z');

  it('names only what was cooked inside the window', () => {
    const out = recentlyCookedTitles([
      recipe('Recent', { lastCookedAt: '2026-01-28T12:00:00.000Z' }),
      recipe('Ancient', { lastCookedAt: '2025-06-01T12:00:00.000Z' }),
    ], now);
    expect(out).toEqual(['Recent']);
  });

  it('skips a recipe that has never been cooked', () => {
    expect(recentlyCookedTitles([recipe('Never')], now)).toEqual([]);
  });

  it('orders newest first', () => {
    const out = recentlyCookedTitles([
      recipe('Older', { lastCookedAt: '2026-01-20T12:00:00.000Z' }),
      recipe('Newer', { lastCookedAt: '2026-01-30T12:00:00.000Z' }),
    ], now);
    expect(out).toEqual(['Newer', 'Older']);
  });

  it('ignores a cooking stamped in the future', () => {
    const out = recentlyCookedTitles(
      [recipe('Tomorrow', { lastCookedAt: '2026-02-05T12:00:00.000Z' })],
      now,
    );
    expect(out).toEqual([]);
  });

  it('ignores an unparseable stamp rather than throwing', () => {
    expect(recentlyCookedTitles([recipe('Corrupt', { lastCookedAt: 'not-a-date' })], now)).toEqual([]);
  });

  it('honours the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      recipe(`Dish ${i}`, { lastCookedAt: '2026-01-25T12:00:00.000Z' }));
    expect(recentlyCookedTitles(many, now, 21, 5)).toHaveLength(5);
  });
});

describe('expiringItemHints', () => {
  it('joins the title and use-by caption', () => {
    expect(expiringItemHints([{ title: 'Spinach', useByCaption: 'Use by today' }]))
      .toEqual(['Spinach — Use by today']);
  });

  it('falls back to the bare title when there is no use-by caption', () => {
    expect(expiringItemHints([{ title: 'Leftover chilli', useByCaption: '' }]))
      .toEqual(['Leftover chilli']);
  });

  it('keeps the order it was given, and returns nothing for an empty kitchen', () => {
    expect(expiringItemHints([
      { title: 'Chilli', useByCaption: 'Use by today' },
      { title: 'Mushrooms', useByCaption: '2 days left' },
    ])).toEqual(['Chilli — Use by today', 'Mushrooms — 2 days left']);
    expect(expiringItemHints([])).toEqual([]);
  });
});

describe('mealIdeaRecipeDraft', () => {
  it('cleans the title into a recipe name', () => {
    const draft = mealIdeaRecipeDraft(idea('  Lemon chicken  '), []);
    expect(draft.name).toBe('Lemon chicken');
  });

  it('returns an empty name for a title that cleans away to nothing', () => {
    expect(mealIdeaRecipeDraft(idea('   '), []).name).toBe('');
  });

  it('normalizes drafted items into storable ingredients', () => {
    const draft = mealIdeaRecipeDraft(idea('Lemon chicken'), [
      { name: 'Chicken thighs', quantity: '1 kg', aisle: 'Meat', section: null },
    ]);
    expect(draft.ingredients).toHaveLength(1);
    expect(draft.ingredients[0]).toMatchObject({
      name: 'Chicken thighs',
      nameKey: 'chicken thighs',
      quantity: '1 kg',
      aisle: 'Meat',
    });
    expect(draft.ingredients[0].id).toBeTruthy();
  });

  it('drops an item with no usable name rather than storing a blank row', () => {
    const draft = mealIdeaRecipeDraft(idea('Lemon chicken'), [
      { name: '', quantity: '1 kg', aisle: 'Meat' },
      { name: 'Lemons', quantity: '2', aisle: 'Produce' },
      null,
    ]);
    expect(draft.ingredients.map(i => i.name)).toEqual(['Lemons']);
  });

  it('carries a component label through as the ingredient section', () => {
    const draft = mealIdeaRecipeDraft(idea('Lemon chicken'), [
      { name: 'Lemons', quantity: '2', aisle: 'Produce', section: 'For the marinade' },
    ]);
    expect(draft.ingredients[0].section).toBe('For the marinade');
  });

  it('carries the idea blurb through as the recipe notes', () => {
    const draft = mealIdeaRecipeDraft(idea('Lemon chicken', 'A one-tray roast with charred lemons.'), []);
    expect(draft.notes).toBe('A one-tray roast with charred lemons.');
  });

  it('stamps the source as AI generated', () => {
    const draft = mealIdeaRecipeDraft(idea('Lemon chicken'), []);
    expect(draft.source).toBe(AI_INVENTED_RECIPE_SOURCE);
  });

  it('defaults the recipe fields when no draft is given', () => {
    const draft = mealIdeaRecipeDraft(idea('Lemon chicken'), []);
    expect(draft.steps).toEqual([]);
    expect(draft.prepTasks).toEqual([]);
  });

  it('carries the method and prep tasks through from the drafted recipe', () => {
    const draft = mealIdeaRecipeDraft(idea('Lemon chicken'), [], {
      steps: ['Sear the chicken.', 'Roast with the lemons.'],
      prepTasks: [{ title: 'Marinate the chicken', offsetDays: -1 }],
    });
    expect(draft.steps).toEqual(['Sear the chicken.', 'Roast with the lemons.']);
    expect(draft.prepTasks).toEqual([{ title: 'Marinate the chicken', offsetDays: -1 }]);
  });
});
