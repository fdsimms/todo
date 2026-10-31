import type { Recipe, WeekPoolEntry } from '../types';
import { POOL_DAY_KEY, describePool, isPoolEntryId, poolAsEntries, poolForWeek, poolPickEntry } from '../utils/weekPool';

// weekPool reaches mealPlan, which reaches dateUtils and so the settings store,
// for a day boundary nothing here uses.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const row = (id: string, weekStart: string, sortOrder: number, recipeId: string | null = null): WeekPoolEntry => ({
  id, weekStart, recipeId, title: `Meal ${id}`, sortOrder, createdAt: `2026-08-0${sortOrder}T10:00:00.000Z`,
});

describe('poolForWeek', () => {
  it('keeps one week, in the order the person arranged it', () => {
    const pool = [row('c', '2026-08-03', 3), row('x', '2026-08-10', 1), row('a', '2026-08-03', 1), row('b', '2026-08-03', 2)];
    expect(poolForWeek(pool, '2026-08-03').map(e => e.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('poolAsEntries', () => {
  it('dates each meal the first day of its week, so the week range holds it and no day does', () => {
    const [entry] = poolAsEntries([row('a', '2026-08-03', 1, 'r1')], new Map(), 0);
    expect(entry.date).toBe('2026-08-03');
    expect(entry.recipeId).toBe('r1');
    expect(entry.cookedAt).toBeNull();
    expect(isPoolEntryId(entry.id)).toBe(true);
  });

  it('scales a recipe for the household the way planning it would', () => {
    const recipes = new Map<string, Pick<Recipe, 'servings' | 'servingsMax'>>([['r1', { servings: 2, servingsMax: null }]]);
    const [entry] = poolAsEntries([row('a', '2026-08-03', 1, 'r1')], recipes, 4);
    expect(entry.recipeScale).toBe(2);
  });

  it('leaves a typed meal at the written amount', () => {
    const [entry] = poolAsEntries([row('a', '2026-08-03', 1)], new Map(), 4);
    expect(entry.recipeScale).toBe(1);
  });
});

describe('poolPickEntry', () => {
  it('is dated for the picker’s pool chip, with the slot the picker asked for', () => {
    const entry = poolPickEntry(row('a', '2026-08-03', 1), 'lunch');
    expect(entry).toMatchObject({ date: POOL_DAY_KEY, slot: 'lunch' });
    expect(isPoolEntryId(entry.id)).toBe(true);
  });
});

describe('describePool', () => {
  it('counts meals', () => {
    expect(describePool(1)).toBe('1 meal');
    expect(describePool(3)).toBe('3 meals');
  });
});
