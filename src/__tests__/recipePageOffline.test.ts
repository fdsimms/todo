import { recipeFromPageOffline, servingsFromYield } from '../utils/recipePageOffline';
import { parseRecipePage, type ParsedRecipePage } from '../utils/recipeUrl';

// recipeUtils reaches the settings store through mealPlan.ts; nothing here
// needs it. Same mock as recipeUtils.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const ldPage = (payload: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(payload)}</script></head><body></body></html>`;

const RECIPE_LD = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Weeknight chili',
  recipeYield: '4 servings',
  totalTime: 'PT1H15M',
  author: { '@type': 'Person', name: 'Alison Roman' },
  recipeIngredient: [
    '2 cans black beans, drained',
    '3 cloves garlic, minced',
    '1 tbsp cumin',
    '1 tbsp cumin',
  ],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Soften the onion.' },
    { '@type': 'HowToStep', text: 'Add everything else and simmer.' },
  ],
};

const aisleFor = (name: string) => (name === 'garlic' ? 'Produce' : 'Other');

describe('recipeFromPageOffline', () => {
  it('builds the recipe from the page\'s structured data, with no model', () => {
    const page = parseRecipePage(ldPage(RECIPE_LD), 4_000);
    const recipe = recipeFromPageOffline(page, aisleFor);
    expect(recipe).not.toBeNull();
    expect(recipe!.name).toBe('Weeknight chili');
    expect(recipe!.servings).toBe(4);
    expect(recipe!.prepMinutes).toBe(75);
    expect(recipe!.steps).toEqual(['Soften the onion.', 'Add everything else and simmer.']);
    expect(recipe!.prepTasks).toEqual([]);
    expect(recipe!.references).toEqual([]);
  });

  it('parses each ingredient line the way the editor\'s own add field does', () => {
    const page = parseRecipePage(ldPage(RECIPE_LD), 4_000);
    const { ingredients } = recipeFromPageOffline(page, aisleFor)!;
    // The duplicate cumin line is one ingredient.
    expect(ingredients.map(i => i.name)).toEqual(['black beans', 'garlic', 'cumin']);
    const garlic = ingredients.find(i => i.name === 'garlic')!;
    expect(garlic.quantity).toBe('3 cloves');
    expect(garlic.prep).toBe('minced');
    expect(garlic.aisle).toBe('Produce');
  });

  it('refuses a page with no structured recipe rather than guessing at its text', () => {
    const page = parseRecipePage(
      '<html><head><title>Chili</title></head><body><ul><li>2 cans beans</li></ul></body></html>',
      4_000,
    );
    expect(recipeFromPageOffline(page, aisleFor)).toBeNull();
  });

  it('refuses a structured page that lists no ingredients', () => {
    const page: ParsedRecipePage = {
      text: '', title: 'Empty', siteName: null, author: null, steps: ['Do it.'],
      ingredients: [], recipeYield: null, totalMinutes: null, structured: true,
    };
    expect(recipeFromPageOffline(page, aisleFor)).toBeNull();
  });
});

describe('servingsFromYield', () => {
  it.each([
    ['4 servings', 4, null],
    ['Serves 4-6', 4, 6],
    ['6', 6, null],
    ['4 to 6 people', 4, 6],
  ])('reads %s as servings', (text, servings, max) => {
    expect(servingsFromYield(text)).toEqual({ servings, servingsMax: max, recipeYield: null });
  });

  it('keeps a yield that is not a serving count as the yield', () => {
    expect(servingsFromYield('2 loaves')).toEqual({ servings: null, servingsMax: null, recipeYield: '2 loaves' });
    expect(servingsFromYield('3 cups')).toEqual({ servings: null, servingsMax: null, recipeYield: '3 cups' });
  });

  it('reads nothing from nothing', () => {
    expect(servingsFromYield(null)).toEqual({ servings: null, servingsMax: null, recipeYield: null });
    expect(servingsFromYield('  ')).toEqual({ servings: null, servingsMax: null, recipeYield: null });
  });
});
