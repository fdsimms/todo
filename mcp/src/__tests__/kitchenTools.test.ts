import { getRecipe, listMealPlan, listRecipes, planMeal } from '../kitchenTools';
import type { Replica } from '../replica';
import type { MealPlanEntry, Recipe } from '../../../src/types';

const recipe = (over: Partial<Recipe> & { id: string; name: string }): Recipe =>
  ({ tags: [], ingredients: [], steps: [], components: [], cookCount: 0, lastCookedAt: null, upNext: false,
     mealType: null, servings: null, estimatedMinutes: null, vote: null, cookbookId: null, notes: '', ...over }) as Recipe;

const meal = (over: Partial<MealPlanEntry> & { id: string; date: string }): MealPlanEntry =>
  ({ slot: 'dinner', title: 'x', recipeId: null, sortOrder: 1, cookedAt: null, ...over }) as MealPlanEntry;

function stub(over: Partial<Replica> = {}): Replica {
  return {
    recipes: () => [
      recipe({ id: 'r2', name: 'Soup', tags: ['winter'], ingredients: [{ name: 'Spinach', quantity: '1 bag', section: null, choiceGroup: null, prep: null } as never] }),
      recipe({ id: 'r1', name: 'Chili', mealType: 'dinner', upNext: true, cookbookId: 'c1' }),
    ],
    cookbooks: () => [{ id: 'c1', title: 'Salt Fat' }],
    mealPlan: () => [],
    todayKey: () => '2026-10-04',
    shiftDayKey: (key: string, days: number) => {
      const d = new Date(`${key}T12:00:00`);
      d.setDate(d.getDate() + days);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    ...over,
  } as unknown as Replica;
}

describe('listRecipes', () => {
  it('sorts by name and matches a name, a tag or an ingredient', () => {
    expect(listRecipes(stub()).recipes.map(r => r.name)).toEqual(['Chili', 'Soup']);
    expect(listRecipes(stub(), { query: 'spinach' }).recipes.map(r => r.id)).toEqual(['r2']);
    expect(listRecipes(stub(), { query: 'WINTER' }).recipes.map(r => r.id)).toEqual(['r2']);
    expect(listRecipes(stub(), { upNext: true }).recipes).toEqual([{ id: 'r1', name: 'Chili', mealType: 'dinner', upNext: true, cookbook: 'Salt Fat' }]);
  });
});

describe('getRecipe', () => {
  it('returns the ingredients and steps, or null for an unknown id', () => {
    expect(getRecipe(stub(), 'r2')).toMatchObject({ name: 'Soup', ingredients: [{ name: 'Spinach', quantity: '1 bag' }], steps: [] });
    expect(getRecipe(stub(), 'nope')).toBeNull();
  });
});

describe('listMealPlan', () => {
  it('defaults to the week from today, ordered by day then slot, with the recipe\'s current name', () => {
    const mealPlan = jest.fn(() => [
      meal({ id: 'b', date: '2026-10-05', slot: 'dinner', recipeId: 'r1', title: 'Old name' }),
      meal({ id: 'a', date: '2026-10-05', slot: 'breakfast', title: 'Eggs' }),
    ]);
    const result = listMealPlan(stub({ mealPlan }));
    expect(mealPlan).toHaveBeenCalledWith('2026-10-04', '2026-10-10');
    expect(result.meals.map(m => [m.id, m.title])).toEqual([['a', 'Eggs'], ['b', 'Chili']]);
  });

  it('refuses a backwards range', () => {
    expect(() => listMealPlan(stub(), { from: '2026-10-05', to: '2026-10-01' })).toThrow(/before/);
  });
});

describe('planMeal', () => {
  it('refuses a bad day, a bad slot, or nothing to plan', () => {
    expect(() => planMeal(stub(), { date: '10/5', slot: 'dinner', title: 'x' })).toThrow(/YYYY-MM-DD/);
    expect(() => planMeal(stub(), { date: '2026-10-05', slot: 'brunch' as never, title: 'x' })).toThrow(/slot/);
    expect(() => planMeal(stub(), { date: '2026-10-05', slot: 'dinner' })).toThrow(/recipeId/);
  });
});
