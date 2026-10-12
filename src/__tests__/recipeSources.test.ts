import type { GroceryItem } from '../types';
import {
  currentSourcesOf,
  foldRecipeSources,
  incomingSourcesOf,
  parseRecipeSources,
  recipeLedgerFor,
  serializeRecipeSources,
  sourcesAfterMerge,
} from '../utils/recipeSources';

const hotPot = { recipeId: 'r1', title: 'Fish Hot Pot', quantity: '2, chopped, white and green parts divided' };
const noodles = { recipeId: 'r2', title: 'Noodle Bowls', quantity: '2, chopped' };

describe('recipeSources round trip', () => {
  it('survives serialize and parse, and drops junk', () => {
    expect(parseRecipeSources(serializeRecipeSources([hotPot, noodles]))).toEqual([hotPot, noodles]);
    expect(parseRecipeSources(null)).toBeUndefined();
    expect(parseRecipeSources('not json')).toBeUndefined();
    expect(parseRecipeSources('[{"title":""},3]')).toBeUndefined();
    expect(serializeRecipeSources([])).toBeNull();
  });
});

describe('foldRecipeSources', () => {
  it('adds a recipe that is already there instead of listing it twice', () => {
    const out = foldRecipeSources([{ recipeId: 'r1', title: 'A', quantity: '1 cup' }], [{ recipeId: 'r1', title: 'A', quantity: '2 cups' }]);
    expect(out).toEqual([{ recipeId: 'r1', title: 'A', quantity: '3 cups' }]);
  });
  it('appends a different recipe', () => {
    expect(foldRecipeSources([hotPot], [noodles])).toHaveLength(2);
  });
});

describe('recipeLedgerFor', () => {
  const base = { quantityFromRecipe: true, recipeSources: [hotPot, noodles] };
  it('is a ledger when the amounts cannot be added', () => {
    expect(recipeLedgerFor(base)).toEqual({ kind: 'ledger', lines: [hotPot, noodles] });
  });
  it('is a count when the amounts add up', () => {
    const sums = { ...base, recipeSources: [{ ...hotPot, quantity: '1 cup' }, { ...noodles, quantity: '2 cups' }] };
    expect(recipeLedgerFor(sums)).toEqual({ kind: 'count', count: 2 });
  });
  it('is a count when no recipe gave an amount', () => {
    expect(recipeLedgerFor({ ...base, recipeSources: [{ ...hotPot, quantity: null }, { ...noodles, quantity: null }] })).toEqual({ kind: 'count', count: 2 });
  });
  it('says nothing once the recipes stop owning the quantity', () => {
    expect(recipeLedgerFor({ ...base, quantityFromRecipe: false })).toBeNull();
  });
  it('says nothing for a single recipe', () => {
    expect(recipeLedgerFor({ ...base, recipeSources: [hotPot] })).toBeNull();
    expect(recipeLedgerFor({ quantityFromRecipe: true })).toBeNull();
  });
});

describe('sourcesAfterMerge', () => {
  const credited = {
    quantityFromRecipe: true,
    quantity: hotPot.quantity,
    sourceRecipeId: 'r1',
    sourceRecipeTitle: 'Fish Hot Pot',
  } as GroceryItem;

  it('seeds from the single credit when a second recipe arrives', () => {
    const next = sourcesAfterMerge(credited, { quantity: '2, chopped', sourceRecipeId: 'r2', sourceRecipeTitle: 'Noodle Bowls' });
    expect(next).toEqual([hotPot, noodles]);
  });
  it('does nothing for the same recipe again', () => {
    expect(sourcesAfterMerge(credited, { quantity: '1', sourceRecipeId: 'r1', sourceRecipeTitle: 'Fish Hot Pot' })).toBeNull();
  });
  it('does nothing when the quantity is the user\'s own', () => {
    expect(sourcesAfterMerge({ ...credited, quantityFromRecipe: false }, { quantity: '2', sourceRecipeId: 'r2', sourceRecipeTitle: 'N' })).toBeNull();
  });
  it('does nothing for a line with no recipe', () => {
    expect(sourcesAfterMerge(credited, { quantity: '2' })).toBeNull();
  });
});

describe('source helpers', () => {
  it('reads a planned line\'s own list before its single credit', () => {
    expect(incomingSourcesOf({ quantity: '1', recipeSources: [hotPot, noodles] })).toEqual([hotPot, noodles]);
    expect(incomingSourcesOf({ quantity: '1', sourceRecipeId: 'r1', sourceRecipeTitle: 'A' })).toEqual([{ recipeId: 'r1', title: 'A', quantity: '1' }]);
    expect(incomingSourcesOf({ quantity: '1' })).toEqual([]);
  });
  it('reads an item\'s stored list before its credit', () => {
    expect(currentSourcesOf({ recipeSources: [hotPot, noodles], sourceRecipeId: null, sourceRecipeTitle: null, quantity: null })).toEqual([hotPot, noodles]);
  });
});

// recipeSources reaches mealPlanGroceries for mergeQuantities, which reaches the
// settings store for dayResetTime; nothing here needs it. Same mock as
// mealPlanGroceries.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));
