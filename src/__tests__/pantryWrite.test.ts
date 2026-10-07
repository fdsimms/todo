import type { GroceryItem, ItemProduct, Leftover } from '../types';
import { newItemRow } from '../utils/groceryAdd';
import { OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
import {
  disposalRow,
  freezePortionRow,
  frozenRow,
  leftoverFinishedRow,
  leftoverFrozenRow,
  leftoverKeepDaysRow,
  leftoverReopenedRow,
  leftoverSplitDraft,
  leftoverStoredAtRow,
  markedOutRow,
  onHandRow,
  openedRow,
  planAddToPantry,
  productFrozenRow,
  productOnHandRow,
  productOpenedRow,
  productsOutPlan,
  reviewedRow,
  runningLowRow,
  thawedPortionsOf,
} from '../utils/pantryWrite';

// dateUtils reaches the settings store for dayResetTime, which reaches
// expo-sqlite: the same stub groceryShelfLife.test.ts keeps.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const NOW = new Date(2026, 7, 23, 12);
const iso = (d: Date) => d.toISOString();

const item = (over: Partial<GroceryItem> & { name: string }): GroceryItem => ({
  ...newItemRow({ name: over.name, nameKey: over.name.toLowerCase(), aisle: 'Other', onList: false, sortOrder: 1, createdAt: iso(new Date(2026, 0, 1)) }),
  ...over,
});

const box = (over: Partial<ItemProduct> = {}): ItemProduct => ({
  id: 'b1', itemId: 'i1', brand: 'Acme', variant: null, productKey: 'acme', rating: null, note: '', purchaseCount: 0,
  lastPurchasedAt: null, gtin: null, nutrition: null, onHandUntil: null, expiresAt: null, frozenAt: null, openedAt: null,
  isPortion: false, createdAt: iso(new Date(2026, 0, 1)), ...over,
});

describe('onHandRow', () => {
  it('marking out ends the last box\'s story, and a plain Got it leaves it alone', () => {
    const base = item({ name: 'Spinach', expiresAt: '2026-08-30', frozenAt: iso(NOW), openedAt: iso(NOW) });
    const got = onHandRow(base, '2026-09-01T00:00:00.000Z');
    expect(got).toMatchObject({ expiresAt: '2026-08-30', frozenAt: iso(NOW), openedAt: iso(NOW) });
    expect(onHandRow(base, OUT_OF_IT_UNTIL)).toMatchObject({ onHandUntil: OUT_OF_IT_UNTIL, expiresAt: null, frozenAt: null, openedAt: null });
  });
});

describe('markedOutRow and disposalRow', () => {
  it('stamps waste only on the spoiled side', () => {
    const base = item({ name: 'Milk' });
    expect(markedOutRow(base, 'spoiled', iso(NOW))).toMatchObject({ spoiledCount: 1, usedUpCount: 0, lastSpoiledAt: iso(NOW) });
    expect(markedOutRow(base, 'usedUp', iso(NOW))).toMatchObject({ spoiledCount: 0, usedUpCount: 1, lastSpoiledAt: null });
    expect(markedOutRow(base, undefined, iso(NOW))).toMatchObject({ spoiledCount: 0, usedUpCount: 0 });
  });

  it('records an outcome without touching what is on hand', () => {
    const base = item({ name: 'Milk', onHandUntil: OUT_OF_IT_UNTIL });
    expect(disposalRow(base, 'spoiled', iso(NOW))).toMatchObject({ onHandUntil: OUT_OF_IT_UNTIL, spoiledCount: 1 });
  });
});

describe('thawedPortionsOf', () => {
  it('takes a thawed portion and leaves a frozen one and a named box', () => {
    const thawed = box({ id: 'p1', isPortion: true });
    const frozen = box({ id: 'p2', isPortion: true, frozenAt: iso(NOW) });
    const named = box({ id: 'b2' });
    expect(thawedPortionsOf(new Set(['i1']), [thawed, frozen, named]).map(p => p.id)).toEqual(['p1']);
    expect(thawedPortionsOf(new Set(['other']), [thawed])).toEqual([]);
  });
});

describe('frozenRow', () => {
  it('is null when nothing changes, stamps on freeze and restarts a shelf life on thaw', () => {
    const base = item({ name: 'Chicken', shelfLifeDays: 3, expiresAt: '2026-08-01' });
    expect(frozenRow(base, false, NOW)).toBeNull();
    const frozen = frozenRow(base, true, NOW)!;
    expect(frozen).toMatchObject({ frozenAt: iso(NOW), expiresAt: '2026-08-01' });
    expect(frozenRow(frozen, false, NOW)).toMatchObject({ frozenAt: null, expiresAt: '2026-08-26' });
  });
});

describe('openedRow', () => {
  it('records the stamp even for a name the lexicon does not know, and keeps its day', () => {
    const base = item({ name: 'Zorblax', expiresAt: '2026-09-30' });
    expect(openedRow(base, true, NOW)).toMatchObject({ openedAt: iso(NOW), expiresAt: '2026-09-30' });
    expect(openedRow(base, false, NOW)).toBeNull();
  });
});

describe('reviewedRow', () => {
  it('stamps every answer, and out also clears the box story', () => {
    const base = item({ name: 'Rice', expiresAt: '2026-09-01', openedAt: iso(NOW) });
    expect(reviewedRow(base, 'low', NOW)).toMatchObject({ pantryReviewedAt: iso(NOW), onHandUntil: base.onHandUntil, expiresAt: '2026-09-01' });
    expect(reviewedRow(base, 'have', NOW).onHandUntil).not.toBeNull();
    expect(reviewedRow(base, 'out', NOW)).toMatchObject({ onHandUntil: OUT_OF_IT_UNTIL, expiresAt: null, openedAt: null, pantryReviewedAt: iso(NOW) });
  });
});

describe('runningLowRow', () => {
  it('stamps lastAddedAt only when the list had to be joined', () => {
    const base = item({ name: 'Butter' });
    expect(runningLowRow(base, true, false, iso(NOW))).toMatchObject({ runningLowAt: iso(NOW), lastAddedAt: iso(NOW) });
    expect(runningLowRow(base, true, true, iso(NOW))).toMatchObject({ runningLowAt: iso(NOW), lastAddedAt: base.lastAddedAt });
    expect(runningLowRow(base, false, false, iso(NOW))).toBeNull();
  });

  it('renews a mark that has lapsed instead of treating it as already set', () => {
    const lapsed = item({ name: 'Butter', runningLowAt: iso(new Date(NOW.getTime() - 30 * 86_400_000)) });
    expect(runningLowRow(lapsed, true, true, iso(NOW))).toMatchObject({ runningLowAt: iso(NOW) });
    // A live mark is still a no-op to set again, and a lapsed one still clears.
    const live = item({ name: 'Butter', runningLowAt: iso(new Date(NOW.getTime() - 86_400_000)) });
    expect(runningLowRow(live, true, true, iso(NOW))).toBeNull();
    expect(runningLowRow(lapsed, false, true, iso(NOW))).toMatchObject({ runningLowAt: null });
  });
});

describe('boxes', () => {
  it('a portion goes when marked out and a named box keeps its row', () => {
    const portion = box({ id: 'p', isPortion: true, frozenAt: iso(NOW) });
    const named = box({ id: 'n', expiresAt: '2026-09-01' });
    const out = box({ id: 'o', onHandUntil: OUT_OF_IT_UNTIL });
    const plan = productsOutPlan([portion, named, out]);
    expect(plan.remove.map(p => p.id)).toEqual(['p']);
    expect(plan.update).toEqual([expect.objectContaining({ id: 'n', onHandUntil: OUT_OF_IT_UNTIL, expiresAt: null })]);
  });

  it('thawing a portion gives it its own Got it, and a named box does not get one', () => {
    const parent = item({ name: 'Bread', id: 'i1' } as never);
    const portion = box({ isPortion: true, frozenAt: iso(NOW) });
    expect(productFrozenRow(portion, parent, false, NOW)?.onHandUntil).toEqual(expect.any(String));
    expect(productFrozenRow(box({ frozenAt: iso(NOW) }), parent, false, NOW)?.onHandUntil).toBeNull();
    expect(productFrozenRow(portion, parent, true, NOW)).toBeNull();
  });

  it('opening uses the box\'s own sealed day', () => {
    expect(productOpenedRow(box({ expiresAt: '2026-09-01' }), item({ name: 'Zorblax' }), true, NOW)).toMatchObject({ openedAt: iso(NOW), expiresAt: '2026-09-01' });
  });

  it('productOnHandRow is null when unchanged and clears the story on out', () => {
    expect(productOnHandRow(box(), null)).toBeNull();
    expect(productOnHandRow(box({ expiresAt: '2026-09-01' }), OUT_OF_IT_UNTIL)).toMatchObject({ expiresAt: null });
  });

  it('freezePortionRow reuses the portion, restarts nothing when already frozen and clears the rest', () => {
    const fresh = freezePortionRow('i1', null, iso(NOW), () => 'new')!;
    expect(fresh).toMatchObject({ id: 'new', isPortion: true, productKey: 'portion', frozenAt: iso(NOW) });
    expect(freezePortionRow('i1', fresh, iso(new Date(2026, 8, 1)), () => 'x')).toBeNull();
    const lapsed = { ...fresh, frozenAt: null, onHandUntil: OUT_OF_IT_UNTIL };
    expect(freezePortionRow('i1', lapsed, iso(NOW), () => 'x')).toMatchObject({ id: 'new', onHandUntil: null, frozenAt: iso(NOW) });
  });
});

describe('planAddToPantry', () => {
  const ctx = (items: GroceryItem[]) => ({ items, aisleOverrides: {}, aisleOrder: ['Produce', 'Other'], now: NOW });

  it('drops the amount and mints a row that is not on the list', () => {
    const plan = planAddToPantry('2 lb flour', ctx([]))!;
    expect(plan).toMatchObject({ isNew: true, item: { name: 'flour', onList: false } });
    expect(plan.item.onHandUntil).toEqual(expect.any(String));
  });

  it('finds the plural of a name it knows and keeps that row\'s own name', () => {
    const known = item({ name: 'Serrano peppers', nameKey: 'serrano pepper' });
    const plan = planAddToPantry('serrano pepper', ctx([known]))!;
    expect(plan.isNew).toBe(false);
    expect(plan.item.id).toBe(known.id);
  });

  it('is null for a name with nothing in it', () => {
    expect(planAddToPantry('   ', ctx([]))).toBeNull();
  });
});

describe('leftovers', () => {
  const left: Leftover = {
    id: 'l1', title: 'Chili', recipeId: null, sourceEntryId: null, storedAt: '2026-08-20T12:00:00.000Z',
    keepUntil: '2026-08-23', finishedAt: null, outcome: null, frozenAt: null,
  } as Leftover;

  it('thawing is a fresh start in the fridge with the same window', () => {
    const frozen = leftoverFrozenRow(left, true, iso(NOW))!;
    expect(frozen.frozenAt).toBe(iso(NOW));
    const thawed = leftoverFrozenRow(frozen, false, iso(NOW))!;
    expect(thawed).toMatchObject({ frozenAt: null, storedAt: iso(NOW) });
    expect(thawed.keepUntil > left.keepUntil).toBe(true);
    expect(leftoverFrozenRow(left, false, iso(NOW))).toBeNull();
  });

  it('finish and reopen are exact reverses, and neither acts twice', () => {
    const done = leftoverFinishedRow(left, 'eaten', iso(NOW))!;
    expect(done).toMatchObject({ finishedAt: iso(NOW), outcome: 'eaten' });
    expect(leftoverFinishedRow(done, 'tossed', iso(NOW))).toBeNull();
    expect(leftoverReopenedRow(done)).toMatchObject({ finishedAt: null, outcome: null });
    expect(leftoverReopenedRow(left)).toBeNull();
  });

  it('keepDays counts from the day it was stored', () => {
    expect(leftoverKeepDaysRow(left, 5).keepUntil).not.toBe(left.keepUntil);
  });

  it('moving the stored day carries the keep-for window with it', () => {
    const local: Leftover = { ...left, storedAt: new Date(2026, 7, 20, 12).toISOString(), keepUntil: '2026-08-23' };
    const moved = leftoverStoredAtRow(local, new Date(2026, 7, 18, 19).toISOString());
    expect(moved.keepUntil).toBe('2026-08-21');
  });

  it('a split logs the other side of the freezer line, put away when the original was', () => {
    const local: Leftover = { ...left, storedAt: new Date(2026, 7, 20, 12).toISOString(), keepUntil: '2026-08-23' };
    expect(leftoverSplitDraft(local)).toMatchObject({ title: 'Chili', storedAt: local.storedAt, keepDays: 3, frozen: true });
    expect(leftoverSplitDraft({ ...local, frozenAt: local.storedAt })?.frozen).toBe(false);
    expect(leftoverSplitDraft({ ...local, finishedAt: local.storedAt, outcome: 'eaten' })).toBeNull();
  });
});
