import {
  applyStandingSwap,
  describeStandingSwap,
  standingSwapMap,
  standingSwaps,
} from '../utils/standingSwaps';
import { groceryNameKey } from '../utils/groceryParse';
import { OTHER_AISLE } from '../utils/groceryAisles';
import type { GroceryItem, ItemSubLink, RecipeIngredient } from '../types';

function makeItem(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    nameFromScan: false,
    id: `item-${groceryNameKey(name).replace(/\s/g, '-')}`,
    name,
    nameKey: groceryNameKey(name),
    preferredProductId: null,
    productStrict: false,
    aisle: OTHER_AISLE,
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
    sortOrder: 1,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    purchaseIntervalDays: null,
    createdAt: '2026-01-01T00:00:00.000Z',
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
    varietyOfKey: null, nutrition: null, backfillDismissedFields: [],
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  };
}

function link(
  itemId: string,
  subItemId: string,
  overrides: Partial<ItemSubLink> = {}
): ItemSubLink {
  return {
    itemId,
    subItemId,
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ratioFrom: null,
    ratioTo: null,
    standing: true,
    ...overrides,
  };
}

function ingredient(name: string, quantity = '', overrides: Partial<RecipeIngredient> = {}): RecipeIngredient {
  return {
    id: `ing-${groceryNameKey(name).replace(/\s/g, '-')}`,
    name,
    nameKey: groceryNameKey(name),
    quantity,
    aisle: null,
    prep: null,
    purpose: null,
    section: null,
    choiceGroup: null,
    ...overrides,
  };
}

const milk = makeItem('Milk');
const oatMilk = makeItem('Oat milk', { aisle: 'Dairy' });
const soyMilk = makeItem('Soy milk');
const garlic = makeItem('Garlic');
const garlicPowder = makeItem('Garlic powder');

describe('standingSwaps', () => {
  it('lists only the links marked standing, oldest first', () => {
    const links = [
      link(milk.id, oatMilk.id, { createdAt: '2026-03-01T00:00:00.000Z' }),
      link(garlic.id, garlicPowder.id, { createdAt: '2026-02-01T00:00:00.000Z' }),
      link(milk.id, soyMilk.id, { standing: false }),
    ];
    expect(standingSwaps(links, [milk, oatMilk, soyMilk, garlic, garlicPowder]).map(s => s.to.name))
      .toEqual(['Garlic powder', 'Oat milk']);
  });

  it('drops a rule whose other half is gone', () => {
    // Resolve-or-shrug, like every other cross-row pointer here. The cascade
    // already takes these rows; this is the restored-backup case.
    expect(standingSwaps([link(milk.id, oatMilk.id)], [milk])).toEqual([]);
  });

  it('drops both halves of a pair that points at itself', () => {
    // Only reachable through a restore or a half-applied sync — linkItemSub
    // clears the reverse bit — and neither direction is a rule anyone meant.
    const links = [link(milk.id, oatMilk.id), link(oatMilk.id, milk.id)];
    expect(standingSwaps(links, [milk, oatMilk])).toEqual([]);
  });

  it('keeps one rule per item, oldest winning', () => {
    const links = [
      link(milk.id, soyMilk.id, { createdAt: '2026-05-01T00:00:00.000Z' }),
      link(milk.id, oatMilk.id, { createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    expect(standingSwapMap(links, [milk, oatMilk, soyMilk]).get('milk')?.to.name).toBe('Oat milk');
  });

  it('does not chain one rule into the next', () => {
    // Two rules, each applied to its own line. A milk line becoming soy milk
    // would mean the swap you get depends on a rule written about something
    // else.
    const swaps = standingSwapMap(
      [link(milk.id, oatMilk.id), link(oatMilk.id, soyMilk.id)],
      [milk, oatMilk, soyMilk]
    );
    expect(applyStandingSwap(ingredient('milk', '1 cup'), swaps).ingredient.nameKey).toBe('oat milk');
    expect(applyStandingSwap(ingredient('oat milk', '1 cup'), swaps).ingredient.nameKey).toBe('soy milk');
  });
});

describe('applyStandingSwap', () => {
  const swaps = standingSwapMap([link(milk.id, oatMilk.id)], [milk, oatMilk]);

  it('rewrites the name and key, and says what the recipe wrote', () => {
    const result = applyStandingSwap(ingredient('milk', '1 cup'), swaps);
    expect(result.ingredient).toMatchObject({ name: 'Oat milk', nameKey: 'oat milk', quantity: '1 cup' });
    expect(result.swappedFrom).toBe('milk');
  });

  it('keeps the line intact otherwise, including its id', () => {
    // The row still edits, reorders and removes the recipe's own line.
    const line = ingredient('milk', '1 cup', { prep: 'warmed', section: 'For the custard' });
    const result = applyStandingSwap(line, swaps);
    expect(result.ingredient).toMatchObject({
      id: line.id, prep: 'warmed', section: 'For the custard',
    });
  });

  it('takes the substitute’s own aisle', () => {
    expect(applyStandingSwap(ingredient('milk'), swaps).ingredient.aisle).toBe('Dairy');
  });

  it('leaves a line nothing names alone', () => {
    expect(applyStandingSwap(ingredient('flour', '2 cups'), swaps)).toEqual({
      ingredient: expect.objectContaining({ name: 'flour' }),
      swappedFrom: null,
    });
  });

  it('honours the line’s own opt-out', () => {
    const result = applyStandingSwap(ingredient('milk', '1 cup', { noSwap: true }), swaps);
    expect(result).toEqual({
      ingredient: expect.objectContaining({ nameKey: 'milk' }),
      swappedFrom: null,
    });
  });

  it('applies a ratio when the line is measured the way the ratio is', () => {
    const ratioed = standingSwapMap(
      [link(garlic.id, garlicPowder.id, { ratioFrom: '1 clove', ratioTo: '1/4 tsp' })],
      [garlic, garlicPowder]
    );
    const result = applyStandingSwap(ingredient('garlic', '2 cloves'), ratioed);
    expect(result.ingredient).toMatchObject({ name: 'Garlic powder', quantity: '1/2 tsp' });
  });

  it('refuses the whole swap when the ratio cannot be applied', () => {
    // A swapped name over an unconverted amount ("1 bulb garlic powder") is
    // the one outcome worse than leaving the line alone.
    const ratioed = standingSwapMap(
      [link(garlic.id, garlicPowder.id, { ratioFrom: '1 clove', ratioTo: '1/4 tsp' })],
      [garlic, garlicPowder]
    );
    for (const quantity of ['1 bulb', 'a pinch', '']) {
      const result = applyStandingSwap(ingredient('garlic', quantity), ratioed);
      expect(result).toEqual({
        ingredient: expect.objectContaining({ name: 'garlic', quantity }),
        swappedFrom: null,
      });
    }
  });

  it('carries the quantity across verbatim when the link names no ratio', () => {
    // Not an assumed 1:1 conversion — the user said "use this instead"
    // without qualifying the amount.
    expect(applyStandingSwap(ingredient('milk', '1 1/2 cups'), swaps).ingredient.quantity)
      .toBe('1 1/2 cups');
  });

  it('swaps nothing when there are no rules at all', () => {
    const line = ingredient('milk', '1 cup');
    expect(applyStandingSwap(line)).toEqual({ ingredient: line, swappedFrom: null });
  });
});

describe('a rule and the line spelled one plural away (#2940)', () => {
  const eggs = makeItem('Eggs');
  const flaxEggs = makeItem('Flax eggs');
  const serranos = makeItem('Serrano peppers');
  const jalapenos = makeItem('Jalapeños');

  it('swaps the singular line for a rule on the plural row, and the reverse', () => {
    // The rest of the app reads "1 egg" as the Eggs row, so the rule on Eggs
    // has to reach it too, or "2 eggs" shops flax eggs and "1 egg" shops eggs.
    const swaps = standingSwapMap(
      [link(eggs.id, flaxEggs.id), link(serranos.id, jalapenos.id)],
      [eggs, flaxEggs, serranos, jalapenos]
    );
    expect(applyStandingSwap(ingredient('eggs', '2'), swaps)).toMatchObject({
      ingredient: { name: 'Flax eggs' }, swappedFrom: 'eggs',
    });
    expect(applyStandingSwap(ingredient('egg', '1'), swaps)).toMatchObject({
      ingredient: { name: 'Flax eggs', quantity: '1' }, swappedFrom: 'egg',
    });
    expect(applyStandingSwap(ingredient('serrano pepper', '1'), swaps).ingredient.name)
      .toBe('Jalapeños');

    const onion = makeItem('Onion');
    const shallot = makeItem('Shallot');
    const reverse = standingSwapMap([link(onion.id, shallot.id)], [onion, shallot]);
    expect(applyStandingSwap(ingredient('onions', '2'), reverse).ingredient.name).toBe('Shallot');
  });

  it('leaves the other spelling alone when a row of its own owns it', () => {
    // "Egg" and "Eggs" both in the catalog are two things the user kept apart,
    // and the rule was written about Eggs.
    const egg = makeItem('Egg');
    const swaps = standingSwapMap([link(eggs.id, flaxEggs.id)], [eggs, egg, flaxEggs]);
    expect(applyStandingSwap(ingredient('egg', '1'), swaps).swappedFrom).toBeNull();
    expect(applyStandingSwap(ingredient('eggs', '2'), swaps).swappedFrom).toBe('eggs');
  });

  it('refuses a spelling that is a plural of two rows at once', () => {
    // A catalog holding both "leaf" and "leave" says nothing about which one
    // "leaves" meant, which is the refusal catalogItemForKey makes too.
    const leaf = makeItem('Leaf');
    const leave = makeItem('Leave');
    const lettuce = makeItem('Lettuce');
    const swaps = standingSwapMap([link(leaf.id, lettuce.id)], [leaf, leave, lettuce]);
    expect(applyStandingSwap(ingredient('leaves'), swaps).swappedFrom).toBeNull();
    expect(applyStandingSwap(ingredient('leaf'), swaps).swappedFrom).toBe('leaf');
  });

  it('keeps each spelling on its own rule when both rows carry one', () => {
    const egg = makeItem('Egg');
    const tofu = makeItem('Tofu');
    const swaps = standingSwapMap(
      [link(eggs.id, flaxEggs.id), link(egg.id, tofu.id)],
      [eggs, egg, flaxEggs, tofu]
    );
    expect(applyStandingSwap(ingredient('eggs'), swaps).ingredient.name).toBe('Flax eggs');
    expect(applyStandingSwap(ingredient('egg'), swaps).ingredient.name).toBe('Tofu');
  });

  it('still honours the line’s own opt-out on the other spelling', () => {
    const swaps = standingSwapMap([link(eggs.id, flaxEggs.id)], [eggs, flaxEggs]);
    expect(applyStandingSwap(ingredient('egg', '1', { noSwap: true }), swaps).swappedFrom).toBeNull();
  });
});

describe('describeStandingSwap', () => {
  it('names what the recipe said, lower-cased for a row subtitle', () => {
    expect(describeStandingSwap('Milk')).toBe('instead of milk');
  });
});
