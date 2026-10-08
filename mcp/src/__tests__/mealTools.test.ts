/**
 * The meal plan's writes against a real database: marking a meal cooked (and
 * the meal's task with it), swapping what a meal is, answering its either/or
 * questions, a leftover night, saving a typed meal as a recipe, and the three
 * copies.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { copyMeals, listMealPlan, planMeal, saveMealAsRecipe, setMealCooked, updateMeal } from '../kitchenTools';
import { saveRecipe } from '../logTools';
import { addToPantry, logLeftover } from '../pantryTools';
import { completeTask, reopenTask } from '../tools';

// Loaded once the replica is open, since loading an app module first in this
// suite starts the settings store's import cycle from the wrong end.
/* eslint-disable @typescript-eslint/no-require-imports */
const mealSlotSourceId = (day: string, slot: 'dinner') =>
  (require('../../../src/utils/mealSlotTasks') as typeof import('../../../src/utils/mealSlotTasks')).mealSlotSourceId(day, slot);
const dbUpdateTask = (task: Parameters<typeof import('../../../src/db/database').dbUpdateTask>[0]) =>
  (require('../../../src/db/database') as typeof import('../../../src/db/database')).dbUpdateTask(task);
/* eslint-enable @typescript-eslint/no-require-imports */

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

let replica: ReturnType<typeof openReplica>;

beforeAll(() => {
  replica = openReplica(':memory:');
});

beforeEach(() => {
  for (const table of ['meal_plan_entries', 'recipes', 'grocery_items', 'leftovers', 'tasks', 'unattended_log']) {
    mockRaw.runSync(`DELETE FROM ${table}`);
  }
  replica.refresh();
});

const DAY = '2030-03-12';

/** A two-step meal task on Today for a day's dinner, the shape the daily pass writes. */
function slotTask(day: string) {
  const task = replica.createTask({ title: 'Choose dinner', category: 'Home' });
  const chained = {
    ...task,
    generatedKind: 'mealSlot' as const,
    generatedSourceId: mealSlotSourceId(day, 'dinner'),
    chainEnabled: true,
    chainIndex: 0,
    chainItems: [
      { id: 'a', title: 'Choose dinner', estimatedMinutes: null },
      { id: 'b', title: 'Make dinner', estimatedMinutes: null },
    ],
  };
  dbUpdateTask(chained);
  replica.refresh();
  return chained;
}

const liveSlotTasks = (day: string) =>
  replica.tasks().filter(t => t.generatedSourceId === mealSlotSourceId(day, 'dinner') && !t.completed);

describe('set_meal_cooked', () => {
  it('stamps the meal, counts the cooking, opens what it used and completes every step of its task', () => {
    addToPantry(replica, ['olive oil']);
    const r = saveRecipe(replica, { name: 'Pasta', ingredients: [{ text: '2 tbsp olive oil' }, { text: '1 lb spaghetti' }] });
    const meal = planMeal(replica, { date: DAY, slot: 'dinner', recipeId: r.id });
    slotTask(DAY);

    const out = setMealCooked(replica, meal.id, true);
    expect(out).toMatchObject({ meal: { cooked: true }, markedOpened: ['olive oil'], tasksCompleted: ['Choose dinner', 'Make dinner'] });
    expect(liveSlotTasks(DAY)).toEqual([]);
    expect(replica.recipes().find(x => x.id === r.id)!.cookCount).toBe(1);
    expect(replica.groceryItems().find(i => i.name === 'olive oil')!.openedAt).not.toBeNull();
    expect(() => setMealCooked(replica, meal.id, true)).toThrow(/already/);
  });

  it('takes the mark back and reopens the step that finished the meal, keeping the count', () => {
    const r = saveRecipe(replica, { name: 'Soup' });
    const meal = planMeal(replica, { date: DAY, slot: 'dinner', recipeId: r.id });
    slotTask(DAY);
    setMealCooked(replica, meal.id, true);
    expect(setMealCooked(replica, meal.id, false)).toMatchObject({ meal: { id: meal.id }, tasksReopened: ['Make dinner'] });
    expect(listMealPlan(replica, { from: DAY, days: 1 }).meals[0].cooked).toBeUndefined();
    expect(liveSlotTasks(DAY).map(t => t.chainIndex)).toEqual([1]);
    expect(replica.recipes().find(x => x.id === r.id)!.cookCount).toBe(1);
  });

  it('marks the meal cooked when its task is finished here, and refuses reopening that task on its own', () => {
    const r = saveRecipe(replica, { name: 'Curry' });
    const meal = planMeal(replica, { date: DAY, slot: 'dinner', recipeId: r.id });
    const task = slotTask(DAY);
    completeTask(replica, task.id);
    const step2 = liveSlotTasks(DAY)[0];
    completeTask(replica, step2.id);
    expect(listMealPlan(replica, { from: DAY, days: 1 }).meals[0]).toMatchObject({ id: meal.id, cooked: true });
    expect(() => reopenTask(replica, step2.id)).toThrow(/set_meal_cooked/);
  });
});

describe('update_meal', () => {
  it('swaps a recipe, and answers its either/or questions by name', () => {
    const chili = saveRecipe(replica, { name: 'Chili' });
    const tacos = saveRecipe(replica, {
      name: 'Tacos',
      ingredients: [{ text: '1 serrano', alternativeGroup: 'Pepper' }, { text: '1 jalapeño', alternativeGroup: 'Pepper' }],
    });
    const meal = planMeal(replica, { date: DAY, slot: 'dinner', recipeId: chili.id });
    const swapped = updateMeal(replica, meal.id, { recipeId: tacos.id, choices: [{ group: 'pepper', option: 'Jalapeño' }] });
    expect(swapped).toMatchObject({ title: 'Tacos', recipeId: tacos.id, choices: [{ group: 'Pepper', chosen: 'jalapeño' }] });
    expect(() => updateMeal(replica, meal.id, { choices: [{ group: 'Side', option: 'Rice' }] })).toThrow(/asks: Pepper/);
    const typed = updateMeal(replica, meal.id, { recipeId: null, title: 'Takeout' });
    expect(typed).toMatchObject({ title: 'Takeout' });
    expect(typed.recipeId).toBeUndefined();
  });

  it('stores the per-meal task answers', () => {
    const meal = planMeal(replica, { date: DAY, slot: 'dinner', title: 'Takeout' });
    expect(updateMeal(replica, meal.id, { shopTask: false, logMeal: true })).toMatchObject({ shopTask: false, logMeal: true });
  });

  it('sets when the meal is eaten for every dish in the slot, and gives each its start', () => {
    const roast = saveRecipe(replica, { name: 'Roast' });
    const potatoes = saveRecipe(replica, { name: 'Potatoes' });
    mockRaw.runSync('UPDATE recipes SET prep_minutes = 20, estimated_minutes = 90 WHERE id = ?', [roast.id]);
    mockRaw.runSync('UPDATE recipes SET estimated_minutes = 45 WHERE id = ?', [potatoes.id]);
    replica.refresh();
    const main = planMeal(replica, { date: DAY, slot: 'dinner', recipeId: roast.id });
    planMeal(replica, { date: DAY, slot: 'dinner', recipeId: potatoes.id });
    planMeal(replica, { date: DAY, slot: 'lunch', title: 'Soup' });

    expect(updateMeal(replica, main.id, { eatAt: '18:30' }))
      .toMatchObject({ eatAt: '18:30', startAt: '16:40', startTiming: 'Prep 20 min, cook 1 hr 30 min' });
    const meals = listMealPlan(replica, { from: DAY, to: DAY }).meals;
    expect(meals.map(m => [m.title, m.eatAt ?? null, m.startAt ?? null])).toEqual([
      ['Soup', null, null],
      ['Roast', '18:30', '16:40'],
      ['Potatoes', '18:30', '17:45'],
    ]);

    expect(() => updateMeal(replica, main.id, { eatAt: '6:30pm' })).toThrow(/HH:MM/);
    updateMeal(replica, main.id, { eatAt: null });
    expect(listMealPlan(replica, { from: DAY, to: DAY }).meals.every(m => m.eatAt === undefined)).toBe(true);
  });
});

describe('a leftover night and saving a meal as a recipe', () => {
  it('plans a leftover by its container and refuses to swap it here', () => {
    const leftover = logLeftover(replica, { title: 'Chili' });
    const meal = planMeal(replica, { date: DAY, slot: 'lunch', leftoverId: leftover.id });
    expect(meal).toMatchObject({ title: 'Chili', leftoverId: leftover.id });
    expect(() => updateMeal(replica, meal.id, { recipeId: null, title: 'Soup' })).toThrow(/leftover night/);
  });

  it('points a typed meal at a recipe of that name, or a new one', () => {
    const existing = saveRecipe(replica, { name: 'Tacos' });
    const a = planMeal(replica, { date: DAY, slot: 'dinner', title: 'tacos' });
    expect(saveMealAsRecipe(replica, a.id)).toMatchObject({ created: false, recipe: { id: existing.id }, meal: { recipeId: existing.id } });
    const b = planMeal(replica, { date: DAY, slot: 'lunch', title: 'Shakshuka' });
    expect(saveMealAsRecipe(replica, b.id)).toMatchObject({ created: true, recipe: { name: 'Shakshuka' } });
    expect(() => saveMealAsRecipe(replica, b.id)).toThrow(/already a saved recipe/);
  });
});

describe('copy_meals', () => {
  it('copies a week into an empty one, a slot into a week without it, and one meal onto other days', () => {
    const r = saveRecipe(replica, { name: 'Oats' });
    planMeal(replica, { date: '2030-03-11', slot: 'breakfast', recipeId: r.id });
    planMeal(replica, { date: '2030-03-12', slot: 'dinner', title: 'Pizza' });
    const week = copyMeals(replica, { fromWeek: '2030-03-12', toWeek: '2030-03-19' });
    expect(week.copied.map(m => m.title).sort()).toEqual(['Oats', 'Pizza']);
    expect(() => copyMeals(replica, { fromWeek: '2030-03-12', toWeek: '2030-03-19' })).toThrow(/already has meals/);

    planMeal(replica, { date: '2030-03-27', slot: 'dinner', title: 'Soup' });
    expect(copyMeals(replica, { fromWeek: '2030-03-12', toWeek: '2030-03-26', slot: 'breakfast' }).copied).toHaveLength(1);
    expect(() => copyMeals(replica, { fromWeek: '2030-03-12', toWeek: '2030-03-26', slot: 'dinner' })).toThrow(/already has dinner/);

    const soup = listMealPlan(replica, { from: '2030-03-27', days: 1 }).meals.find(m => m.title === 'Soup')!;
    const each = copyMeals(replica, { mealId: soup.id, dates: ['2030-03-28', '2030-03-29', '2030-03-28'] });
    expect(each.copied.map(m => m.date)).toEqual(['2030-03-28', '2030-03-29']);
    expect(copyMeals(replica, { mealId: soup.id, dates: ['2030-03-28'] })).toMatchObject({ copied: [], skipped: ['2030-03-28'] });
  });
});
