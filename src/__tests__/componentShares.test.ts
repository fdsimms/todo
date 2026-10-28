import type { Recipe, RecipeComponent } from '../types';
import { amountUsedCounts, componentShares } from '../utils/componentShares';

let seq = 0;

function recipe(name: string, overrides: Partial<Recipe> = {}): Recipe {
  return { id: `r-${++seq}`, name, ingredients: [], components: [], recipeYield: null, ...overrides } as Recipe;
}

function link(part: Recipe, overrides: Partial<RecipeComponent> = {}): RecipeComponent {
  return { id: `c-${++seq}`, recipeId: part.id, name: part.name, choiceGroup: null, ...overrides };
}

describe('componentShares', () => {
  it('reads a typed amount against what the part makes', () => {
    const mix = recipe('Mix', { recipeYield: '12 tbsp' });
    const dish = recipe('Dish', { components: [link(mix, { amountUsed: '3 tbsp' })] });
    expect(componentShares(dish, new Map([[mix.id, mix]])).get(mix.id)).toBeCloseTo(0.25, 5);
  });

  it('counts a part at the share of the link this cooking keeps', () => {
    const mix = recipe('Mix', { recipeYield: '12 tbsp' });
    const fries = recipe('Fries', { components: [link(mix, { amountUsed: '1 tbsp' })] });
    const wings = recipe('Wings', { components: [link(mix, { amountUsed: '6 tbsp' })] });
    const wingsLink = link(wings, { choiceGroup: 'Side' });
    const dinner = recipe('Dinner', { components: [link(fries, { choiceGroup: 'Side' }), wingsLink] });
    const byId = new Map([mix, fries, wings, dinner].map(r => [r.id, r]));
    expect(componentShares(dinner, byId).get(mix.id)).toBeCloseTo(1 / 12, 5);
    expect(componentShares(dinner, byId, { chosen: [wingsLink.id] }).get(mix.id)).toBeCloseTo(0.5, 5);
  });
});

describe('amountUsedCounts', () => {
  it('is true with nothing typed, or for a bare share of the batch', () => {
    expect(amountUsedCounts('', null)).toBe(true);
    expect(amountUsedCounts('1/4', recipe('Mix'))).toBe(true);
  });

  it('is false for an amount the part’s yield cannot be compared with', () => {
    expect(amountUsedCounts('1 tbsp', recipe('Mix'))).toBe(false);
    expect(amountUsedCounts('2 tbsp', recipe('Sauce', { recipeYield: '4 servings' }))).toBe(false);
    expect(amountUsedCounts('2 tbsp', recipe('Sauce', { recipeYield: '1 cup' }))).toBe(true);
  });
});
