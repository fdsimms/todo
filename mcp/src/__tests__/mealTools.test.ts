/**
 * The meal plan's writes against a real database: marking a meal cooked (and
 * the meal's task with it), swapping what a meal is, answering its either/or
 * questions, a leftover night, saving a typed meal as a recipe, and the three
 * copies.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { addToWeekPool, copyMeals, listMealPlan, placePoolMeal, planMeal, removePoolMeal, saveMealAsRecipe, setMealCooked, updateMeal } from '../kitchenTools';
import { saveRecipe, updateRecipe } from '../logTools';
import { addToPantry, logLeftover } from '../pantryTools';
import { getGroceryItem, updateGroceryItem } from '../groceryTools';
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
  for (const table of ['meal_plan_entries', 'week_pool_entries', 'recipes', 'grocery_items', 'leftovers', 'tasks', 'unattended_log']) {
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
});

describe('recipe blanks and update_meal fills', () => {
  const bowl = () => saveRecipe(replica, {
    name: 'Any Grain Bowl',
    ingredients: [{ text: '1 tbsp olive oil' }],
    blanks: [
      { kind: 'grain', pick: 'one', amount: '1 cup' },
      { label: 'Veg', kind: 'vegetable', amount: '2 cups' },
    ],
  });
  const shop = () => replica.plannedIngredients({ from: DAY, to: DAY }, null).map(l => l.nameKey);

  it('saves blanks, shows them on the recipe, and keeps a blank’s id when an edit names it again', () => {
    const r = bowl();
    expect(r.blanks).toEqual([
      { label: 'Grains & starches', kind: 'grain', pick: 'one', amount: '1 cup' },
      { label: 'Veg', kind: 'vegetable', pick: 'any', amount: '2 cups' },
    ]);
    const before = replica.recipes().find(x => x.id === r.id)!.blanks.map(b => b.id);
    const edited = updateRecipe(replica, r.id, { blanks: [{ label: 'veg', kind: 'vegetable', pick: 2 }] });
    expect(edited.blanks).toEqual([{ label: 'veg', kind: 'vegetable', pick: 2 }]);
    expect(replica.recipes().find(x => x.id === r.id)!.blanks.map(b => b.id)).toEqual([before[1]]);
  });

  it('lists what the kitchen holds for each blank, fills it, and shops for the fill only', () => {
    addToPantry(replica, ['rice', 'frozen peas']);
    const r = bowl();
    const meal = planMeal(replica, { date: DAY, slot: 'dinner', recipeId: r.id });
    expect(shop()).toEqual(['olive oil']);
    const listed = listMealPlan(replica, { from: DAY, days: 1 }).meals[0];
    expect(listed.blanks?.map(b => [b.blank, b.pick, b.inKitchen, b.filledWith])).toEqual([
      ['Grains & starches', 'Pick one', ['rice'], []],
      ['Veg', 'Pick any', ['frozen peas'], []],
    ]);

    const out = updateMeal(replica, meal.id, { fills: [{ blank: 'grains & starches', with: ['rice'] }, { blank: 'Veg', with: ['frozen peas', 'kale'] }] });
    expect(out.blanks?.map(b => b.filledWith)).toEqual([['1 cup rice'], ['1 cup frozen peas', '1 cup kale']]);
    expect(shop()).toEqual(['olive oil', 'rice', 'frozen peas', 'kale']);
    expect(out.replacements).toBeUndefined();

    // Rewriting the replacements leaves the fills alone.
    updateMeal(replica, meal.id, { replacements: [{ replace: 'olive oil', with: null }] });
    expect(shop()).toEqual(['rice', 'frozen peas', 'kale']);

    updateMeal(replica, meal.id, { fills: [{ blank: 'veg', with: [] }] });
    expect(shop()).toEqual(['rice']);
  });

  it('refuses a blank the recipe does not have, naming the ones it does', () => {
    const r = bowl();
    const meal = planMeal(replica, { date: DAY, slot: 'dinner', recipeId: r.id });
    expect(() => updateMeal(replica, meal.id, { fills: [{ blank: 'Cheese', with: ['feta'] }] }))
      .toThrow('"Cheese" is not a blank of "Any Grain Bowl". It has: Grains & starches, Veg.');
  });
});

describe('update_meal optional', () => {
  it('lists a recipe’s optional lines, includes one by name, and shops for it only then', () => {
    const r = saveRecipe(replica, { name: 'Soup', ingredients: [{ text: '1 cup lentils' }, { text: 'crusty bread, for serving', optional: true }] });
    expect(r.ingredients.map(i => !!i.optional)).toEqual([false, true]);
    const meal = planMeal(replica, { date: DAY, slot: 'dinner', recipeId: r.id });
    const shop = () => replica.plannedIngredients({ from: DAY, to: DAY }, null).filter(l => !l.optional).map(l => l.nameKey);

    expect(listMealPlan(replica, { from: DAY, days: 1 }).meals[0].optional).toEqual([{ name: 'crusty bread', included: false }]);
    expect(shop()).toEqual(['lentils']);
    const out = updateMeal(replica, meal.id, { optional: ['Crusty bread'] });
    expect(out.optional).toEqual([{ name: 'crusty bread', included: true }]);
    expect(shop()).toEqual(['lentils', 'crusty bread']);
    expect(() => updateMeal(replica, meal.id, { optional: ['butter'] }))
      .toThrow('"butter" is not an optional line of "Soup". It has: crusty bread.');
    expect(updateMeal(replica, meal.id, { optional: [] }).optional).toEqual([{ name: 'crusty bread', included: false }]);

    // A rewrite that says false makes it required again; one that is silent leaves it alone.
    expect(updateRecipe(replica, r.id, { ingredients: [{ text: '1 cup lentils' }, { text: 'crusty bread, for serving' }] })
      .ingredients.map(i => !!i.optional)).toEqual([false, true]);
    expect(updateRecipe(replica, r.id, { ingredients: [{ text: '1 cup lentils' }, { text: 'crusty bread, for serving', optional: false }] })
      .ingredients.map(i => !!i.optional)).toEqual([false, false]);
  });
});

describe('a grocery item’s food type', () => {
  it('shows the guess, files it, and hands it back to the guess', () => {
    addToPantry(replica, ['tofurky roast']);
    const item = replica.groceryItems().find(i => i.name === 'tofurky roast')!;
    expect(getGroceryItem(replica, { id: item.id })).toMatchObject({ foodType: ['protein'], foodTypeGuessed: true });
    updateGroceryItem(replica, { id: item.id, foodType: ['protein', 'legume'] });
    const filed = getGroceryItem(replica, { id: item.id });
    expect(filed.foodType).toEqual(['protein', 'legume']);
    expect(filed.foodTypeGuessed).toBeUndefined();
    updateGroceryItem(replica, { id: item.id, foodType: null });
    expect(getGroceryItem(replica, { id: item.id })).toMatchObject({ foodType: ['protein'], foodTypeGuessed: true });
  });
});

describe('update_meal replacements', () => {
  const stew = () => {
    const fish = saveRecipe(replica, { name: 'Homemade fish', ingredients: [{ text: '1 lb tofu' }, { text: '2 sheets nori' }] });
    const parent = saveRecipe(replica, {
      name: 'Stew',
      ingredients: [{ text: '2 cups broth' }, { text: '1 tsp salt' }],
      components: [{ recipeId: fish.id }],
    });
    return { fish, parent };
  };
  // What the plan would buy for the day, by catalog key, in recipe order.
  const shopFor = (_mealId: string) => replica
    .plannedIngredients({ from: DAY, to: DAY }, null)
    .map(l => l.nameKey);

  it('uses something else for this cooking only, and shops, serializes and clears it', () => {
    const { parent } = stew();
    const meal = planMeal(replica, { date: DAY, slot: 'dinner', recipeId: parent.id });
    expect(shopFor(meal.id)).toEqual(['broth', 'salt', 'tofu', 'nori']);

    const out = updateMeal(replica, meal.id, {
      replacements: [{ replace: 'homemade fish', with: '8 oz vegan fish fillets', note: 'Cook per the package first' }],
    });
    expect(out.replacements).toEqual(['Homemade fish is replaced by 8 oz vegan fish fillets. Cook per the package first.']);
    expect(shopFor(meal.id)).toEqual(['broth', 'salt', 'vegan fish fillets']);
    // The recipe is never touched.
    expect(replica.recipes().find(r => r.id === parent.id)!.components).toHaveLength(1);

    const cleared = updateMeal(replica, meal.id, { replacements: [] });
    expect(cleared.replacements).toBeUndefined();
    expect(shopFor(meal.id)).toEqual(['broth', 'salt', 'tofu', 'nori']);
  });

  it('leaves a line out with null, replaces a whole list at a time, and does not copy to another week', () => {
    const { parent } = stew();
    const meal = planMeal(replica, { date: DAY, slot: 'dinner', recipeId: parent.id });
    updateMeal(replica, meal.id, { replacements: [{ replace: 'salt', with: null }] });
    expect(shopFor(meal.id)).toEqual(['broth', 'tofu', 'nori']);
    // Replaces the list rather than adding to it.
    updateMeal(replica, meal.id, { replacements: [{ replace: 'broth', with: '2 cups stock' }] });
    expect(shopFor(meal.id)).toEqual(['stock', 'salt', 'tofu', 'nori']);

    copyMeals(replica, { mealId: meal.id, dates: ['2030-03-19'] });
    const copy = replica.mealPlan('2030-03-19', '2030-03-19')[0];
    expect(copy.recipeId).toBe(parent.id);
    expect(copy.recipeOverrides).toEqual([]);
  });

  it('refuses a name the recipe does not have, listing what it has, and a name on two recipes', () => {
    const { parent } = stew();
    const meal = planMeal(replica, { date: DAY, slot: 'dinner', recipeId: parent.id });
    expect(() => updateMeal(replica, meal.id, { replacements: [{ replace: 'pepper', with: null }] }))
      .toThrow(/not a line or used recipe of "Stew".*broth, salt, Homemade fish/);
    expect(() => updateMeal(replica, meal.id, { replacements: [{ replace: 'broth', with: 'a' }, { replace: 'Broth', with: 'b' }] }))
      .toThrow(/replaced twice/);

    const side = saveRecipe(replica, { name: 'Side', ingredients: [{ text: '1 tsp salt' }] });
    const both = saveRecipe(replica, { name: 'Both', ingredients: [{ text: '1 tsp salt' }], components: [{ recipeId: side.id }] });
    const m2 = planMeal(replica, { date: DAY, slot: 'lunch', recipeId: both.id });
    expect(() => updateMeal(replica, m2.id, { replacements: [{ replace: 'salt', with: null }] })).toThrow(/more than one recipe.*"in"/);
    expect(updateMeal(replica, m2.id, { replacements: [{ replace: 'salt', in: 'Side', with: null }] }).replacements)
      .toEqual(['salt is left out.']);
  });

  it('refuses on a typed meal, and drops the replacements when the meal is swapped to another recipe', () => {
    const { parent } = stew();
    const typed = planMeal(replica, { date: DAY, slot: 'lunch', title: 'Takeout' });
    expect(() => updateMeal(replica, typed.id, { replacements: [] })).toThrow(/Only a meal with a recipe/);
    const meal = planMeal(replica, { date: DAY, slot: 'dinner', recipeId: parent.id });
    updateMeal(replica, meal.id, { replacements: [{ replace: 'salt', with: null }] });
    const other = saveRecipe(replica, { name: 'Soup' });
    expect(updateMeal(replica, meal.id, { recipeId: other.id }).replacements).toBeUndefined();
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

describe('the weekly pool', () => {
  it('holds a meal for a week with no day, lists it, and places it on a day', () => {
    const added = addToWeekPool(replica, { week: DAY, title: 'Tacos' });
    expect(added).toMatchObject({ title: 'Tacos' });
    // Filed under the week's first day, whichever day was named.
    expect(added.week).toBe(replica.weekStartOf(DAY));

    const listed = listMealPlan(replica, { from: DAY, days: 3 });
    expect(listed.meals).toEqual([]);
    expect(listed.pool).toEqual([added]);

    const placed = placePoolMeal(replica, { id: added.id, date: DAY, slot: 'dinner' });
    expect(placed).toMatchObject({ date: DAY, slot: 'dinner', title: 'Tacos' });
    expect(listMealPlan(replica, { from: DAY, days: 3 }).pool).toBeUndefined();
    expect(replica.mealPlan(DAY, DAY)).toHaveLength(1);
  });

  it('takes a recipe off Up next when it is chosen for a week', () => {
    const recipe = saveRecipe(replica, { name: 'Soup' });
    mockRaw.runSync('UPDATE recipes SET up_next = 1 WHERE id = ?', [recipe.id]);
    replica.refresh();
    expect(replica.recipes().find(r => r.id === recipe.id)?.upNext).toBe(true);
    addToWeekPool(replica, { week: DAY, recipeId: recipe.id });
    expect(replica.recipes().find(r => r.id === recipe.id)?.upNext).toBe(false);
  });

  it('removes a pool meal without planning it, and refuses one that is gone', () => {
    const added = addToWeekPool(replica, { week: DAY, title: 'Salad' });
    expect(removePoolMeal(replica, added.id).removed.title).toBe('Salad');
    expect(replica.weekPool(added.week, added.week)).toEqual([]);
    expect(() => removePoolMeal(replica, added.id)).toThrow(/No meal waiting/);
    expect(() => placePoolMeal(replica, { id: added.id, date: DAY, slot: 'dinner' })).toThrow(/No meal waiting/);
  });

  it('needs a recipe or a title', () => {
    expect(() => addToWeekPool(replica, { week: DAY })).toThrow(/recipeId, or a title/);
  });
});
