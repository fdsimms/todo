import { pantryStanding } from '../utils/pantryStanding';
import { OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem } from '../types';

const NOW = new Date(new Date('2026-08-07T12:00').toISOString());
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

function makeItem(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  return {
    nameFromScan: false, id: 'i1', nameKey: groceryNameKey(overrides.name), preferredProductId: null,
    productStrict: false, aisle: 'Other', quantity: null, quantityFromRecipe: false, note: '',
    onList: false, checked: false, sortOrder: 1, purchaseCount: 0, lastAddedAt: null,
    lastPurchasedAt: null, purchaseIntervalDays: null, createdAt: daysAgo(365), onHandUntil: null,
    sourceRecipeId: null, sourceRecipeTitle: null, choiceGroup: null, isStaple: false, expiresAt: null,
    frozenAt: null, openedAt: null, runningLowAt: null, shelfLifeDays: null, useUpTask: null,
    pantryCheckDeclinedAt: null, pantryReviewedAt: null, usedUpCount: 0, spoiledCount: 0,
    lastSpoiledAt: null, varietyOfKey: null, nutrition: null, backfillDismissedFields: [],
    lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  };
}

describe('pantryStanding', () => {
  it('reads running low as the "low" answer', () => {
    const s = pantryStanding(makeItem({ name: 'Rice', runningLowAt: daysAgo(1) }), NOW);
    expect(s).toEqual({ text: 'Running low', tone: 'warn', answer: 'low' });
  });

  it('reads the Out of it sentinel as "out", not as nothing recorded', () => {
    const s = pantryStanding(makeItem({ name: 'Butter', onHandUntil: OUT_OF_IT_UNTIL }), NOW);
    expect(s).toEqual({ text: 'Out of it', tone: 'bad', answer: 'out' });
  });

  it('reads a live Got it as "have"', () => {
    const s = pantryStanding(makeItem({ name: 'Flour', onHandUntil: daysAhead(5) }), NOW);
    expect(s).toEqual({ text: 'Marked as on hand', tone: 'good', answer: 'have' });
  });

  it('gives a purchase guess its own words and no answer', () => {
    const item = makeItem({ name: 'Tahini', purchaseCount: 1, createdAt: daysAgo(3), lastPurchasedAt: daysAgo(3) });
    expect(pantryStanding(item, NOW)).toEqual({ text: 'Bought once · last on Aug 4', tone: 'good', answer: null });
  });

  it('gives the freezer and a staple no answer', () => {
    expect(pantryStanding(makeItem({ name: 'Peas', frozenAt: daysAgo(2) }), NOW).answer).toBeNull();
    const staple = pantryStanding(makeItem({ name: 'Salt', isStaple: true }), NOW);
    expect(staple).toEqual({ text: 'Always have it', tone: 'good', answer: null });
  });

  it('says nothing is recorded for a row with no standing at all', () => {
    expect(pantryStanding(makeItem({ name: 'Saffron' }), NOW)).toEqual({
      text: 'Nothing recorded', tone: 'none', answer: null,
    });
  });
});
