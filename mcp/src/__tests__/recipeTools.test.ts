/**
 * The recipe library's writes against a real database, through the recipe
 * store's own actions: a recipe's wider fields, moving it between cookbooks,
 * the cookbooks themselves, the Up next shelf and a logged
 * cook time.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { saveRecipe, updateRecipe } from '../logTools';
import {
  deleteCookbook,
  listCookbooks,
  logCookTime,
  mergeCookbooks,
  renameCookbook,
  reorderUpNext,
} from '../recipeTools';

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
  mockRaw.runSync('DELETE FROM recipes');
  mockRaw.runSync('DELETE FROM cookbooks');
  replica.refresh();
});

const stored = (id: string) => replica.recipes().find(r => r.id === id)!;

describe('update_recipe', () => {
  it('sets the wider fields through the store, and lists them on get_recipe', () => {
    const r = saveRecipe(replica, { name: 'Chili', servings: 4 });
    const out = updateRecipe(replica, r.id, {
      servingsMax: 6,
      recipeYield: '3 quarts',
      prepMinutes: 20,
      vote: 'loved',
      upNext: true,
      leftoverKeepDays: 5,
      author: 'Sam',
      prepTasks: [{ title: 'Soak the beans', offsetDays: -1, reminderOffsetMinutes: 60 }],
    });
    expect(out).toMatchObject({
      servings: 4,
      servingsMax: 6,
      yield: '3 quarts',
      prepMinutes: 20,
      vote: 'loved',
      upNext: true,
      leftoverKeepDays: 5,
      author: 'Sam',
      prepTasks: [{ title: 'Soak the beans', offsetDays: -1, reminderOffsetMinutes: 60 }],
    });
  });

  it('sets the cooked weight, shows it on get_recipe, and refuses one the app cannot hold', () => {
    const r = saveRecipe(replica, { name: 'Stew' });
    expect(updateRecipe(replica, r.id, { cookedWeightG: 2100 }).cookedWeightG).toBe(2100);
    expect(stored(r.id).cookedWeightG).toBe(2100);
    expect(() => updateRecipe(replica, r.id, { cookedWeightG: 0 })).toThrow(/cookedWeightG must be a whole number from 1 to 50000/);
    expect(() => updateRecipe(replica, r.id, { cookedWeightG: 60000 })).toThrow(/50000/);
    expect(updateRecipe(replica, r.id, { cookedWeightG: null }).cookedWeightG).toBeUndefined();
    expect(saveRecipe(replica, { name: 'Dressing', cookedWeightG: 480 }).cookedWeightG).toBe(480);
  });

  it('sets the oven temperature as written, shows it on get_recipe, and refuses one no oven does', () => {
    const r = saveRecipe(replica, { name: 'Banana bread' });
    expect(updateRecipe(replica, r.id, { ovenTemp: 350 })).toMatchObject({ ovenTemp: 350, ovenTempUnit: 'F' });
    expect(() => updateRecipe(replica, r.id, { ovenTemp: 3500 })).toThrow(/ovenTemp must be a whole number from 150 to 600/);
    // Celsius has its own range, so 350 is refused once the unit says C.
    expect(() => updateRecipe(replica, r.id, { ovenTemp: 350, ovenTempUnit: 'C' })).toThrow(/70 to 320/);
    expect(updateRecipe(replica, r.id, { ovenTemp: 180, ovenTempUnit: 'C' })).toMatchObject({ ovenTemp: 180, ovenTempUnit: 'C' });
    expect(stored(r.id)).toMatchObject({ ovenTemp: 180, ovenTempUnit: 'C' });
    expect(updateRecipe(replica, r.id, { ovenTemp: null }).ovenTemp).toBeUndefined();
    expect(saveRecipe(replica, { name: 'Focaccia', ovenTemp: 220, ovenTempUnit: 'C' }).ovenTemp).toBe(220);
  });

  it('points the oven at a later step by its place, and lets it go with the step', () => {
    const r = saveRecipe(replica, { name: 'Focaccia', steps: [{ text: 'Mix.' }, { text: 'Rest.' }, { text: 'Heat the oven.' }, { text: 'Bake.' }] });
    expect(() => updateRecipe(replica, r.id, { ovenTempStep: 3 })).toThrow(/needs an ovenTemp/);
    expect(() => updateRecipe(replica, r.id, { ovenTemp: 450, ovenTempStep: 9 })).toThrow(/from 1 to 4/);

    expect(updateRecipe(replica, r.id, { ovenTemp: 450, ovenTempStep: 3 })).toMatchObject({ ovenTemp: 450, ovenTempStep: 3 });
    // 1 and null both mean before cooking starts.
    expect(updateRecipe(replica, r.id, { ovenTempStep: 1 }).ovenTempStep).toBeUndefined();
    updateRecipe(replica, r.id, { ovenTempStep: 3 });
    expect(updateRecipe(replica, r.id, { ovenTempStep: null }).ovenTempStep).toBeUndefined();

    // The same step keeps its id across a rewrite of the others, so the pointer follows it.
    updateRecipe(replica, r.id, { ovenTempStep: 3 });
    expect(updateRecipe(replica, r.id, { steps: [{ text: 'Mix.' }, { text: 'Heat the oven.' }, { text: 'Bake.' }] }).ovenTempStep).toBe(2);
    // Dropping the step drops the pointer and keeps the temperature.
    const dropped = updateRecipe(replica, r.id, { steps: [{ text: 'Mix.' }, { text: 'Bake.' }] });
    expect(dropped.ovenTempStep).toBeUndefined();
    expect(dropped.ovenTemp).toBe(450);
  });

  it('keeps a step whose text is unchanged, with its timer and note', () => {
    const r = saveRecipe(replica, { name: 'Rice', steps: [{ text: 'Rinse.' }, { text: 'Simmer.' }] });
    updateRecipe(replica, r.id, { steps: [{ text: 'Rinse.' }, { text: 'Simmer until the water is gone.', timerSeconds: 900 }] });
    const simmerId = stored(r.id).steps[1].id;
    const rinseId = stored(r.id).steps[0].id;
    updateRecipe(replica, r.id, { steps: [{ text: 'Rinse.', note: 'Three times' }, { text: 'Simmer until the water is gone.' }, { text: 'Rest.' }] });
    const steps = stored(r.id).steps;
    expect(steps.map(s => s.id).slice(0, 2)).toEqual([rinseId, simmerId]);
    expect(steps[0].note).toBe('Three times');
    expect(steps[1].timerSeconds).toBe(900);
    expect(steps).toHaveLength(3);
  });

  it('moves a recipe between cookbooks and refuses a name already in the destination', () => {
    const a = saveRecipe(replica, { name: 'Dal', cookbook: 'Weeknights', sourcePage: '12' });
    saveRecipe(replica, { name: 'Dal', cookbook: 'Summer' });
    expect(() => updateRecipe(replica, a.id, { cookbook: 'summer' })).toThrow(/already a recipe called "Dal" in Summer/);
    const moved = updateRecipe(replica, a.id, { cookbook: 'Pantry Cooking' });
    expect(moved.cookbook).toBe('Pantry Cooking');
    // A page of one book is not a page of another.
    expect(moved.page).toBeUndefined();
    const out = updateRecipe(replica, a.id, { cookbook: null });
    expect(out.cookbook).toBeUndefined();
  });

  it('keeps a recipe in its own book when another book shares the title, and refuses to guess between two', () => {
    saveRecipe(replica, { name: 'Soup', cookbook: 'Dinner' });
    const r = saveRecipe(replica, { name: 'Dal', cookbook: 'Dinner (other)', sourcePage: '42' });
    const other = listCookbooks(replica).cookbooks.find(c => c.title === 'Dinner (other)')!;
    renameCookbook(replica, other.id, 'Dinner', 'Meera Sodha');

    // Sent back with the title it was read with: no move, page kept.
    const out = updateRecipe(replica, r.id, { cookbook: 'Dinner', notes: 'x' });
    expect(stored(r.id).cookbookId).toBe(other.id);
    expect(out.page).toBe('42');

    const loose = saveRecipe(replica, { name: 'Rice' });
    expect(() => updateRecipe(replica, loose.id, { cookbook: 'Dinner' })).toThrow(/2 cookbooks called "Dinner"/);
  });

  it('keeps a mixed either/or and a placed used recipe when the ingredients are rewritten', () => {
    const pilaf = saveRecipe(replica, { name: 'Pilaf' });
    const bowl = saveRecipe(replica, {
      name: 'Bowl',
      ingredients: [{ text: '1 cup rice', alternativeGroup: 'Base' }, { text: '2 eggs' }],
      components: [{ recipeId: pilaf.id, choiceGroup: 'Base' }],
    });
    // Written in one call, the line's half of the group survives too.
    expect(stored(bowl.id).ingredients[0].choiceGroup).toBe('Base');
    const eggs = stored(bowl.id).ingredients[1];
    const placed = stored(bowl.id).components.map(c => ({ ...c, placement: { before: eggs.id, section: null } }));
    mockRaw.runSync('UPDATE recipes SET components = ? WHERE id = ?', [JSON.stringify(placed), bowl.id]);
    replica.refresh();

    updateRecipe(replica, bowl.id, { ingredients: [{ text: '1 cup rice', alternativeGroup: 'Base' }, { text: '3 eggs' }] });

    const after = stored(bowl.id);
    expect(after.components[0].choiceGroup).toBe('Base');
    expect(after.ingredients[0].choiceGroup).toBe('Base');
    expect(after.components[0].placement?.before).toBe(eggs.id);
    expect(after.ingredients.map(i => i.quantity)).toEqual(['1 cup', '3']);
  });

  it('refuses an author on a recipe in a cookbook, and writes nothing from a refused edit', () => {
    const r = saveRecipe(replica, { name: 'Pie', cookbook: 'Baking' });
    expect(() => updateRecipe(replica, r.id, { author: 'Sam' })).toThrow(/rename_cookbook/);
    expect(() => updateRecipe(replica, r.id, { vote: 'liked', components: [{ recipeId: 'nope' }] })).toThrow(/No recipe/);
    expect(stored(r.id).vote).toBeNull();
  });

  it('replaces components, keeps choice groups and refuses a cycle', () => {
    const crust = saveRecipe(replica, { name: 'Crust' });
    const lattice = saveRecipe(replica, { name: 'Lattice' });
    const pie = saveRecipe(replica, { name: 'Pie', components: [{ recipeId: crust.id, choiceGroup: 'Top' }, { recipeId: lattice.id, choiceGroup: 'Top' }] });
    expect(pie.components).toEqual([
      { recipeId: crust.id, name: 'Crust', choiceGroup: 'Top' },
      { recipeId: lattice.id, name: 'Lattice', choiceGroup: 'Top' },
    ]);
    expect(() => updateRecipe(replica, crust.id, { components: [{ recipeId: pie.id }] })).toThrow(/already uses Crust/);
    expect(updateRecipe(replica, pie.id, { components: [] }).components).toBeUndefined();
  });

  it('keeps a component’s dragged position when an edit leaves the link in place', () => {
    const crust = saveRecipe(replica, { name: 'Crust' });
    const glaze = saveRecipe(replica, { name: 'Glaze' });
    const pie = saveRecipe(replica, { name: 'Pie', components: [{ recipeId: crust.id }, { recipeId: glaze.id }] });
    const links = stored(pie.id).components;
    const moved = links.map(c => (c.recipeId === glaze.id ? { ...c, placement: { before: null, section: 'To finish' } } : c));
    mockRaw.runSync('UPDATE recipes SET components = ? WHERE id = ?', [JSON.stringify(moved), pie.id]);
    replica.refresh();

    // Reordering and regrouping other links rewrites no placement.
    updateRecipe(replica, pie.id, { components: [{ recipeId: glaze.id }, { recipeId: crust.id, choiceGroup: 'Base' }] });

    const after = stored(pie.id).components;
    expect(after.map(c => c.recipeId)).toEqual([glaze.id, crust.id]);
    expect(after[0].placement).toEqual({ before: null, section: 'To finish' });
    expect(after[1].choiceGroup).toBe('Base');
    expect(after[0].id).toBe(links[1].id);
  });

  it('refuses values outside what the app takes', () => {
    const r = saveRecipe(replica, { name: 'Soup', servings: 4 });
    expect(() => updateRecipe(replica, r.id, { servingsMax: 3 })).toThrow(/more than servings/);
    expect(() => updateRecipe(replica, r.id, { steps: [{ text: 'Boil.', timerSeconds: 2 }] })).toThrow(/timer/);
    expect(() => updateRecipe(replica, r.id, { prepTasks: [{ title: 'Chop', offsetDays: -30 }] })).toThrow(/offsetDays/);
    expect(() => updateRecipe(replica, r.id, { leftoverKeepDays: 400 })).toThrow(/leftoverKeepDays/);
  });
});

describe('cookbooks', () => {
  it('renames a book onto every recipe in it, and refuses a title another book has', () => {
    const r = saveRecipe(replica, { name: 'Dal', cookbook: 'Weeknights' });
    saveRecipe(replica, { name: 'Gazpacho', cookbook: 'Summer' });
    const book = listCookbooks(replica).cookbooks.find(c => c.title === 'Weeknights')!;
    expect(book.recipes).toBe(1);
    renameCookbook(replica, book.id, 'Weeknight Dinners', 'Ana');
    expect(stored(r.id)).toMatchObject({ source: 'Weeknight Dinners', author: 'Ana' });
    expect(() => renameCookbook(replica, book.id, 'Summer', null)).toThrow(/merge_cookbooks/);
  });

  it('merges one book into another', () => {
    saveRecipe(replica, { name: 'Dal', cookbook: 'Weeknights' });
    saveRecipe(replica, { name: 'Rice', cookbook: 'Weeknights (copy)' });
    const books = listCookbooks(replica).cookbooks;
    const keep = books.find(c => c.title === 'Weeknights')!;
    const lose = books.find(c => c.title === 'Weeknights (copy)')!;
    expect(mergeCookbooks(replica, keep.id, lose.id)).toMatchObject({ kept: { id: keep.id }, merged: 'Weeknights (copy)', recipesMoved: 1 });
    expect(listCookbooks(replica).cookbooks).toEqual([expect.objectContaining({ id: keep.id, recipes: 2 })]);
  });

  it('deletes a book, keeping its recipes unlinked', () => {
    const r = saveRecipe(replica, { name: 'Dal', cookbook: 'Weeknights' });
    const book = listCookbooks(replica).cookbooks[0];
    expect(deleteCookbook(replica, book.id)).toMatchObject({ recipesUnlinked: 1 });
    expect(listCookbooks(replica).cookbooks).toEqual([]);
    expect(stored(r.id)).toMatchObject({ cookbookId: null, source: 'Weeknights' });
    expect(() => deleteCookbook(replica, book.id)).toThrow(/No cookbook/);
  });
});

describe('the Up next shelf and cook times', () => {
  it('orders the shelf, with ones left out following', () => {
    const a = saveRecipe(replica, { name: 'A', upNext: true });
    const b = saveRecipe(replica, { name: 'B', upNext: true });
    const c = saveRecipe(replica, { name: 'C', upNext: true });
    expect(reorderUpNext(replica, [c.id]).upNext.map(r => r.name)).toEqual(['C', 'A', 'B']);
    expect(() => reorderUpNext(replica, ['missing'])).toThrow(/Not on the Up next shelf/);
    expect(b.upNext).toBe(true);
    expect(a.id).not.toBe(c.id);
  });

  it('logs a cook time the way the timer does', () => {
    const r = saveRecipe(replica, { name: 'Stew' });
    expect(logCookTime(replica, r.id, 45)).toMatchObject({ lastCookMinutes: 45 });
  });
});
