import { partitionPantryEntries, pantryBulkLabel } from '../utils/pantryBulk';

// What the module imports, not what these tests touch: the stores load
// expo-sqlite through the database module.
jest.mock('../store/useGroceryStore', () => ({ useGroceryStore: { getState: jest.fn() } }));
jest.mock('../store/useLeftoverStore', () => ({ useLeftoverStore: { getState: jest.fn() } }));
jest.mock('../utils/grocerySuggest', () => ({ defaultOnHandUntil: jest.fn() }));

describe('partitionPantryEntries', () => {
  it('splits a mixed selection by the store each row belongs to', () => {
    expect(partitionPantryEntries([
      { kind: 'grocery', sourceId: 'milk' },
      { kind: 'leftover', sourceId: 'chili' },
      { kind: 'product', sourceId: 'beyond' },
      { kind: 'grocery', sourceId: 'eggs' },
    ])).toEqual({ itemIds: ['milk', 'eggs'], productIds: ['beyond'], leftoverIds: ['chili'] });
  });

  it('gives three empty lists for nothing selected', () => {
    expect(partitionPantryEntries([])).toEqual({ itemIds: [], productIds: [], leftoverIds: [] });
  });
});

describe('pantryBulkLabel', () => {
  it('says what was done and how many', () => {
    expect(pantryBulkLabel('usedUp', 3)).toBe('Used up 3 things');
    expect(pantryBulkLabel('spoiled', 1)).toBe('Marked 1 thing as gone bad');
    expect(pantryBulkLabel('have', 2)).toBe('Marked 2 things as on hand');
    expect(pantryBulkLabel('freeze', 4)).toBe('Froze 4 things');
  });
});
