import { mealPickerShelves, pickerSavedMeals, SAVED_MEALS_BROWSE_LIMIT } from '../utils/mealPicker';
import type { Recipe, SavedMeal } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const NOW = new Date(2026, 9, 21);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();
const recipe = (id: string, over: Partial<Recipe> = {}): Recipe => ({
  id, name: id, upNext: false, upNextOrder: 0, vote: null, lastCookedAt: null, sortOrder: 0, ...over,
}) as Recipe;

describe('mealPickerShelves', () => {
  it('leads with Up Next in its order, then loved recipes gone quiet, then the rest', () => {
    const recipes = [
      recipe('plain', { sortOrder: 1 }),
      recipe('next2', { upNext: true, upNextOrder: 2 }),
      recipe('lovedRecent', { vote: 'loved', lastCookedAt: daysAgo(3), sortOrder: 2 }),
      recipe('lovedOld', { vote: 'loved', lastCookedAt: daysAgo(60) }),
      recipe('lovedOlder', { vote: 'loved', lastCookedAt: daysAgo(90) }),
      recipe('next1', { upNext: true, upNextOrder: 1, vote: 'loved' }),
    ];
    const shelves = mealPickerShelves(recipes, NOW, 30);
    expect(shelves.upNext.map(r => r.id)).toEqual(['next1', 'next2']);
    expect(shelves.lovedResting.map(r => r.id)).toEqual(['lovedOlder', 'lovedOld']);
    expect(shelves.rest.map(r => r.id)).toEqual(expect.arrayContaining(['plain', 'lovedRecent']));
    expect(shelves.rest).toHaveLength(2);
    expect(shelves.total).toBe(6);
  });

  it('fills the rest only up to the limit', () => {
    const recipes = Array.from({ length: 40 }, (_, i) => recipe(`r${i}`, { sortOrder: i }));
    recipes[0].upNext = true;
    const shelves = mealPickerShelves(recipes, NOW, 30);
    expect(shelves.upNext.length + shelves.lovedResting.length + shelves.rest.length).toBe(30);
  });
});

describe('pickerSavedMeals', () => {
  const meal = (name: string): SavedMeal => ({ id: name, name, items: [], createdAt: '2026-10-01T00:00:00.000Z' });

  it('lists only the first few with nothing typed', () => {
    const meals = Array.from({ length: SAVED_MEALS_BROWSE_LIMIT + 3 }, (_, i) => meal(`Meal ${i}`));
    expect(pickerSavedMeals(meals, '  ')).toHaveLength(SAVED_MEALS_BROWSE_LIMIT);
  });

  it('searches every saved meal by name, ignoring case', () => {
    const meals = [...Array.from({ length: 8 }, (_, i) => meal(`Meal ${i}`)), meal('Eggs on toast')];
    expect(pickerSavedMeals(meals, ' TOAST ').map(m => m.name)).toEqual(['Eggs on toast']);
    expect(pickerSavedMeals(meals, 'zzz')).toEqual([]);
  });
});
