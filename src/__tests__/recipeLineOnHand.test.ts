import type { GroceryItem, ItemSubLink } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import { onHandStandInsNote } from '../utils/recipeLineOnHand';

const NOW = new Date('2026-08-25T12:00:00.000Z');
const HAVE = new Date(NOW.getTime() + 7 * 86_400_000).toISOString();

let seq = 0;
function makeItem(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    nameFromScan: false,
    id: `id-${++seq}`,
    name,
    nameKey: groceryNameKey(name),
    preferredProductId: null,
    productStrict: false,
    aisle: 'Baking & Spices',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
    sortOrder: seq,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    purchaseIntervalDays: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    onHandUntil: null,
    sourceRecipeId: null,
    sourceRecipeTitle: null,
    choiceGroup: null,
    isStaple: false,
    expiresAt: null,
    frozenAt: null,
    openedAt: null,
    runningLowAt: null,
    shelfLifeDays: null,
    useUpTask: null,
    pantryCheckDeclinedAt: null,
    pantryReviewedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    varietyOfKey: null,
    nutrition: null,
    backfillDismissedFields: [],
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    ...overrides,
  } as GroceryItem;
}

function link(itemId: string, subItemId: string): ItemSubLink {
  return {
    itemId,
    subItemId,
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ratioFrom: null,
    ratioTo: null,
    standing: false,
  };
}

describe('onHandStandInsNote', () => {
  it('names an on-hand variety under a generic line you do not have', () => {
    const pimenton = makeItem('pimentón');
    const smoked = makeItem('smoked paprika', { varietyOfKey: pimenton.nameKey, onHandUntil: HAVE });
    const items = [pimenton, smoked];
    expect(onHandStandInsNote(pimenton, items, [], [], NOW)).toBe('you have smoked paprika');
  });

  it('names an on-hand substitute', () => {
    const pimenton = makeItem('pimentón');
    const paprika = makeItem('paprika', { onHandUntil: HAVE });
    const items = [pimenton, paprika];
    expect(onHandStandInsNote(pimenton, items, [link(pimenton.id, paprika.id)], [], NOW))
      .toBe('you have paprika');
  });

  it('names a variety and a substitute together, once each', () => {
    const pimenton = makeItem('pimentón');
    const smoked = makeItem('smoked paprika', { varietyOfKey: pimenton.nameKey, onHandUntil: HAVE });
    const paprika = makeItem('paprika', { onHandUntil: HAVE });
    const items = [pimenton, smoked, paprika];
    const links = [link(pimenton.id, paprika.id), link(pimenton.id, smoked.id)];
    expect(onHandStandInsNote(pimenton, items, links, [], NOW))
      .toBe('you have smoked paprika or paprika');
  });

  it('is silent when nothing that could stand in is on hand', () => {
    const pimenton = makeItem('pimentón');
    const smoked = makeItem('smoked paprika', { varietyOfKey: pimenton.nameKey });
    const paprika = makeItem('paprika');
    const items = [pimenton, smoked, paprika];
    expect(onHandStandInsNote(pimenton, items, [link(pimenton.id, paprika.id)], [], NOW)).toBeNull();
  });

  it('is silent when the line’s own item is on hand, a staple or on the list', () => {
    const smoked = makeItem('smoked paprika', { onHandUntil: HAVE });
    const paprika = makeItem('paprika', { onHandUntil: HAVE });
    const links = (id: string) => [link(id, smoked.id)];
    for (const own of [
      makeItem('pimentón', { onHandUntil: HAVE }),
      makeItem('pimentón', { isStaple: true }),
      makeItem('pimentón', { onList: true }),
    ]) {
      expect(onHandStandInsNote(own, [own, smoked, paprika], links(own.id), [], NOW)).toBeNull();
    }
  });
});
