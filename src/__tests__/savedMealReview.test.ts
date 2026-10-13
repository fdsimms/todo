import {
  appendLine,
  itemAmountEdit,
  itemAtAmount,
  itemAtEstimateFactor,
  itemFromPick,
  replaceLine,
  reviewChanged,
  reviewedCalories,
  reviewedItems,
  reviewLinesFor,
  sameItems,
  toggleRemoved,
} from '../utils/savedMealReview';
import type { FoodNutrition, SavedMeal, SavedMealItem } from '../types';

function panel(overrides: Partial<FoodNutrition> = {}): FoodNutrition {
  return {
    basis: 'per100g',
    servingGrams: null,
    servingText: null,
    amounts: { calorieKcal: 100, proteinG: 20 },
    source: 'fdc',
    sourceId: '1',
    portions: [],
    recordedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** One helping of a database food nobody filed, which kept its own per-100 g panel. */
function chickenItem(): SavedMealItem {
  return {
    label: 'Chicken',
    recipeId: null,
    itemId: null,
    productId: null,
    quantity: '200 g',
    grams: 200,
    nutrition: panel({ basis: 'perServing', servingText: '200 g', servingGrams: 200, amounts: { calorieKcal: 200, proteinG: 40 }, portions: [] }),
    sourcePanel: panel(),
  };
}

function estimateItem(): SavedMealItem {
  return {
    label: 'Burrito bowl',
    recipeId: null,
    itemId: null,
    productId: null,
    quantity: '1 bowl',
    grams: null,
    nutrition: panel({ basis: 'perServing', source: 'estimated', servingText: '1 bowl', amounts: { calorieKcal: 600 }, portions: [] }),
  };
}

function describedItem(): SavedMealItem {
  return {
    label: 'Toast',
    recipeId: null,
    itemId: null,
    productId: null,
    quantity: '2 slices',
    grams: null,
    nutrition: panel({ basis: 'perServing', source: 'manual', amounts: { calorieKcal: 150 }, portions: [] }),
  };
}

const meal = (items: SavedMealItem[]): SavedMeal => ({ id: 'm1', name: 'Dinner', items, createdAt: '2026-01-01T00:00:00.000Z' });

describe('itemAmountEdit', () => {
  it('measures an item that kept a database panel', () => {
    expect(itemAmountEdit(chickenItem())).toEqual({ kind: 'measure', amount: '200 g' });
  });

  it('scales an estimate by a multiple instead of measuring it', () => {
    expect(itemAmountEdit(estimateItem()).kind).toBe('estimate');
  });

  it('says why an item with no record cannot change', () => {
    const edit = itemAmountEdit(describedItem());
    expect(edit.kind).toBe('none');
    if (edit.kind === 'none') expect(edit.reason).toMatch(/no record/);
  });

  it('says why a dish cannot change', () => {
    const edit = itemAmountEdit({ ...chickenItem(), recipeId: 'r1', sourcePanel: undefined });
    expect(edit.kind).toBe('none');
    if (edit.kind === 'none') expect(edit.reason).toMatch(/recipe/);
  });
});

describe('itemAtAmount', () => {
  it('re-measures against the kept panel, not the stored helping', () => {
    const result = itemAtAmount(chickenItem(), '100 g', () => null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item.quantity).toBe('100 g');
      expect(result.item.grams).toBe(100);
      expect(result.item.nutrition.amounts.calorieKcal).toBe(100);
      expect(result.item.sourcePanel).toBeTruthy();
    }
  });

  it('measures a linked item against the panel the caller supplies', () => {
    const item: SavedMealItem = { ...chickenItem(), itemId: 'i1', sourcePanel: undefined };
    const result = itemAtAmount(item, '50 g', () => panel());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item.nutrition.amounts.calorieKcal).toBe(50);
      // Linked to a row, so the kept panel is not carried.
      expect(result.item.sourcePanel).toBeUndefined();
    }
  });

  it('refuses a linked item whose record is gone', () => {
    const item: SavedMealItem = { ...chickenItem(), itemId: 'i1', sourcePanel: undefined };
    const result = itemAtAmount(item, '50 g', () => null);
    expect(result.ok).toBe(false);
  });

  it('refuses an amount the panel cannot measure, with a reason', () => {
    const result = itemAtAmount(chickenItem(), 'a handful', () => null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/cannot be measured/);
  });

  it('refuses an item with nothing to measure against', () => {
    expect(itemAtAmount(describedItem(), '1 slice', () => null).ok).toBe(false);
  });
});

describe('itemAtEstimateFactor', () => {
  it('scales every stated figure and keeps the whole to scale from again', () => {
    const half = itemAtEstimateFactor(estimateItem(), 1 / 2);
    expect(half.ok).toBe(true);
    if (!half.ok) return;
    expect(half.item.nutrition.amounts.calorieKcal).toBe(300);
    // A second change is a multiple of the whole, not of the half.
    const back = itemAtEstimateFactor(half.item, 1);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.item.nutrition.amounts.calorieKcal).toBe(600);
  });

  it('refuses an item that is not an estimate', () => {
    expect(itemAtEstimateFactor(chickenItem(), 2).ok).toBe(false);
  });
});

describe('review lines', () => {
  it('logs the saved meal unchanged when nothing was touched', () => {
    const m = meal([chickenItem(), estimateItem()]);
    const lines = reviewLinesFor(m);
    expect(sameItems(m.items, reviewedItems(lines))).toBe(true);
    expect(reviewChanged(m, lines)).toBe(false);
  });

  it('leaves a food out and brings it back', () => {
    const m = meal([chickenItem(), estimateItem()]);
    const out = toggleRemoved(reviewLinesFor(m), 'item-0');
    expect(reviewedItems(out).map(i => i.label)).toEqual(['Burrito bowl']);
    expect(reviewChanged(m, out)).toBe(true);
    const back = toggleRemoved(out, 'item-0');
    expect(reviewChanged(m, back)).toBe(false);
  });

  it('swaps a food in place and counts as a change', () => {
    const m = meal([chickenItem(), estimateItem()]);
    const swapped = replaceLine(reviewLinesFor(m), 'item-0', describedItem(), 'new-0');
    expect(reviewedItems(swapped).map(i => i.label)).toEqual(['Toast', 'Burrito bowl']);
    expect(reviewChanged(m, swapped)).toBe(true);
  });

  it('adds a food at the end, and removing an added food deletes it outright', () => {
    const m = meal([chickenItem()]);
    const added = appendLine(reviewLinesFor(m), describedItem(), 'new-0');
    expect(reviewedItems(added)).toHaveLength(2);
    const gone = toggleRemoved(added, 'new-0');
    expect(gone).toHaveLength(1);
    expect(reviewChanged(m, gone)).toBe(false);
  });

  it('totals calories over what is kept only', () => {
    const m = meal([chickenItem(), estimateItem()]);
    expect(reviewedCalories(reviewLinesFor(m))).toBe(800);
    expect(reviewedCalories(toggleRemoved(reviewLinesFor(m), 'item-1'))).toBe(200);
  });

  it('sees a changed amount as a change', () => {
    const m = meal([chickenItem()]);
    const changed = itemAtAmount(chickenItem(), '100 g', () => null);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const lines = reviewLinesFor(m).map(l => ({ ...l, item: changed.item }));
    expect(reviewChanged(m, lines)).toBe(true);
  });
});

describe('itemFromPick', () => {
  it('carries the links and the kept panel, and omits an absent one', () => {
    const plain = itemFromPick({ label: 'Rice', quantity: '1 cup', grams: 158, nutrition: panel() });
    expect(plain).toEqual({
      label: 'Rice', recipeId: null, itemId: null, productId: null, quantity: '1 cup', grams: 158, nutrition: panel(),
    });
    expect('sourcePanel' in plain).toBe(false);
    const kept = itemFromPick({ label: 'Rice', quantity: '1 cup', grams: 158, nutrition: panel(), sourcePanel: panel(), itemId: 'i1' });
    expect(kept.itemId).toBe('i1');
    expect(kept.sourcePanel).toBeTruthy();
  });
});
