/**
 * The recipe library's writes against a real database, through the recipe
 * store's own actions: a recipe's wider fields, moving it between cookbooks,
 * the cookbooks themselves and their indexes, the Up next shelf and a logged
 * cook time.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { saveRecipe, updateRecipe } from '../logTools';
import {
  deleteCookbook,
  deleteIndexEntry,
  getCookbookIndex,
  listCookbooks,
  logCookTime,
  mergeCookbooks,
  recipeFromIndexEntry,
  renameCookbook,
  reorderUpNext,
  saveIndexEntry,
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
  mockRaw.runSync('DELETE FROM cookbook_index_entries');
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

  it('merges one book into another, with its index', () => {
    saveRecipe(replica, { name: 'Dal', cookbook: 'Weeknights' });
    saveRecipe(replica, { name: 'Rice', cookbook: 'Weeknights (copy)' });
    const books = listCookbooks(replica).cookbooks;
    const keep = books.find(c => c.title === 'Weeknights')!;
    const lose = books.find(c => c.title === 'Weeknights (copy)')!;
    saveIndexEntry(replica, { cookbookId: lose.id, title: 'Saag', page: '40', ingredients: ['spinach'] });
    expect(mergeCookbooks(replica, keep.id, lose.id)).toMatchObject({ kept: { id: keep.id }, merged: 'Weeknights (copy)', recipesMoved: 1 });
    expect(listCookbooks(replica).cookbooks).toEqual([expect.objectContaining({ id: keep.id, recipes: 2, indexEntries: 1 })]);
  });

  it('deletes a book, keeping its recipes unlinked and taking its index', () => {
    const r = saveRecipe(replica, { name: 'Dal', cookbook: 'Weeknights' });
    const book = listCookbooks(replica).cookbooks[0];
    saveIndexEntry(replica, { cookbookId: book.id, title: 'Saag' });
    expect(deleteCookbook(replica, book.id)).toMatchObject({ recipesUnlinked: 1, indexEntriesDeleted: 1 });
    expect(listCookbooks(replica).cookbooks).toEqual([]);
    expect(stored(r.id)).toMatchObject({ cookbookId: null, source: 'Weeknights' });
    expect(() => deleteCookbook(replica, book.id)).toThrow(/No cookbook/);
  });

  it('adds, changes and deletes index lines, refusing a dish the index already lists', () => {
    saveRecipe(replica, { name: 'Dal', cookbook: 'Weeknights' });
    const book = listCookbooks(replica).cookbooks[0];
    const { entry } = saveIndexEntry(replica, { cookbookId: book.id, title: 'Chana masala', page: '88', ingredients: ['chickpeas'] });
    expect(() => saveIndexEntry(replica, { cookbookId: book.id, title: 'chana masala' })).toThrow(/already lists/);
    saveIndexEntry(replica, { id: entry.id, title: 'Chana masala', ingredients: ['chickpeas', 'tomato'] });
    expect(getCookbookIndex(replica, book.id).entries).toEqual([{ id: entry.id, title: 'Chana masala', page: '88', ingredients: ['chickpeas', 'tomato'] }]);
    deleteIndexEntry(replica, entry.id);
    expect(getCookbookIndex(replica, book.id).entries).toEqual([]);
  });

  it('makes a recipe from an index line once, then finds it', () => {
    saveRecipe(replica, { name: 'Dal', cookbook: 'Weeknights' });
    const book = listCookbooks(replica).cookbooks[0];
    const { entry } = saveIndexEntry(replica, { cookbookId: book.id, title: 'Saag paneer', page: '40' });
    const first = recipeFromIndexEntry(replica, entry.id);
    expect(first).toMatchObject({ created: true, recipe: { name: 'Saag paneer', cookbook: 'Weeknights', page: '40' } });
    expect(recipeFromIndexEntry(replica, entry.id)).toMatchObject({ created: false, recipe: { id: first.recipe!.id } });
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
