import { blankChoices, blankSuggestions, defaultBlankPicks, lastBlankFill, needsUsing, togglePick, USUAL_CANDIDATE_LIMIT } from '../utils/blankPicker';
import type { KitchenEntry } from '../utils/kitchenInventory';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem, LeftoverFreshness, MealPlanEntry, RecipeBlank, RecipeOverride } from '../types';

const NOW = new Date(2026, 7, 13, 15, 0, 0);

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

let seq = 0;

/** On hand by an explicit assertion, so no purchase history has to be staged. */
function makeItem(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  const name = overrides.name;
  seq += 1;
  return {
    nameFromScan: false,
    id: `gi-${seq}`,
    nameKey: groceryNameKey(name),
    preferredProductId: null,
    productStrict: false,
    aisle: 'Other',
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
    createdAt: daysAgo(365),
    onHandUntil: daysAgo(-5),
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

/** A pantry entry for `item`, the shape kitchenInventory returns. */
function entry(item: GroceryItem, freshness: LeftoverFreshness | null = 'fresh', caption = ''): KitchenEntry {
  return {
    id: `grocery-${item.id}`, sourceId: item.id, kind: 'grocery', title: item.name, productName: null,
    itemId: null, section: item.aisle, useBy: null, freshness, daysLeft: null, reason: 'marked as on hand',
    useByCaption: caption, caption: '', onList: false, matchKey: item.nameKey,
  };
}

function blank(fields: Partial<RecipeBlank> = {}): RecipeBlank {
  return { id: 'b', label: 'Vegetables', kind: 'vegetable', max: null, quantity: '', options: [], excluded: [], ...fields };
}

describe('blankChoices', () => {
  const peas = makeItem({ name: 'frozen peas' });
  const beans = makeItem({ name: 'string beans' });
  const spinach = makeItem({ name: 'spinach' });
  const rice = makeItem({ name: 'rice' });
  const broccoli = makeItem({ name: 'broccoli', purchaseCount: 9, onHandUntil: null });
  const carrots = makeItem({ name: 'carrots', purchaseCount: 4, onHandUntil: null });
  const kale = makeItem({ name: 'kale', purchaseCount: 0, onHandUntil: null });
  const items = [peas, beans, spinach, rice, broccoli, carrots, kale];
  const kitchen = [entry(spinach, 'due', 'Use today'), entry(beans, 'over', '11 days past use-by'), entry(peas), entry(rice)];

  it('offers the kitchen’s food of the blank’s kind, most urgent first, and sets aside what is past its date', () => {
    const choices = blankChoices(blank(), items, kitchen);
    expect(choices.kitchen.map(c => [c.name, c.freshness, c.caption])).toEqual([
      ['spinach', 'due', 'Use today'],
      ['frozen peas', 'fresh', null],
    ]);
    expect(choices.stale.map(c => [c.name, c.caption])).toEqual([['string beans', '11 days past use-by']]);
  });

  it('offers an item as fresh when any of it is, even with an old box of it sorted first', () => {
    const tofu = makeItem({ name: 'tofu' });
    const old = { ...entry(tofu, 'over', '27 days past use-by'), id: 'box-old' };
    const choices = blankChoices(blank({ kind: null, options: ['tofu'] }), [tofu], [old, entry(tofu, 'fresh', 'Good until Aug 20')]);
    expect(choices.kitchen.map(c => [c.name, c.caption])).toEqual([['tofu', 'Good until Aug 20']]);
    expect(choices.stale).toEqual([]);
  });

  it('follows with what is usually bought of the kind, by purchase count, and never something never bought', () => {
    expect(blankChoices(blank(), items, kitchen).others.map(c => [c.name, c.source])).toEqual([
      ['broccoli', 'usual'], ['carrots', 'usual'],
    ]);
  });

  it('caps the usual list', () => {
    const many = Array.from({ length: 10 }, (_, i) => makeItem({ name: `squash ${i}`, purchaseCount: 10 - i, onHandUntil: null }));
    expect(blankChoices(blank(), many, []).others).toHaveLength(USUAL_CANDIDATE_LIMIT);
  });

  it('goes by the person’s filing over the name', () => {
    const tofurky = makeItem({ name: 'Tofurky roast', foodKinds: ['protein'] });
    const ricePlain = makeItem({ name: 'Rice', foodKinds: [] });
    const choices = blankChoices(blank({ label: 'Protein', kind: 'protein' }), [tofurky, ricePlain], [entry(tofurky), entry(ricePlain)]);
    expect(choices.kitchen.map(c => c.name)).toEqual(['Tofurky roast']);
    expect(blankChoices(blank({ kind: 'grain' }), [ricePlain], [entry(ricePlain)]).kitchen).toEqual([]);
  });

  it('puts the recipe’s own options ahead of the usual list, in the order written, whatever their kind', () => {
    const feta = makeItem({ name: 'Feta' });
    const cheese = blank({ label: 'Cheese', kind: null, options: ['goat cheese', 'Feta', 'cheddar'] });
    const choices = blankChoices(cheese, [feta, broccoli], [entry(feta)]);
    expect(choices.kitchen.map(c => c.name)).toEqual(['Feta']);
    expect(choices.others.map(c => [c.name, c.source, c.itemId])).toEqual([
      ['goat cheese', 'option', null],
      ['cheddar', 'option', null],
    ]);
  });

  it('never offers what the blank excludes, from the kitchen, the options or the usual buys', () => {
    const feta = makeItem({ name: 'Feta' });
    const cheese = blank({ label: 'Cheese', kind: null, options: ['goat cheese', 'cheddar'], excluded: ['FETA', 'Goat Cheese'] });
    const choices = blankChoices(cheese, [feta], [entry(feta)]);
    expect(choices.kitchen).toEqual([]);
    expect(choices.others.map(c => c.name)).toEqual(['cheddar']);
    const veg = blankChoices(blank({ excluded: ['spinach', 'broccoli'] }), items, kitchen);
    expect(veg.kitchen.map(c => c.name)).toEqual(['frozen peas']);
    expect(veg.others.map(c => c.name)).toEqual(['carrots']);
  });

  it('still shows an excluded name the meal picked by hand', () => {
    const choices = blankChoices(blank({ excluded: ['broccoli'] }), items, kitchen, [], ['broccoli']);
    expect(choices.others.map(c => c.name)).toContain('broccoli');
  });

  it('keeps a hand-typed pick on screen so it can be taken back off', () => {
    const choices = blankChoices(blank(), items, kitchen, [], ['Romanesco', 'spinach']);
    expect(choices.others.map(c => c.name)).toEqual(['broccoli', 'carrots', 'Romanesco']);
  });

  it('leaves out leftovers, items in a non-food aisle, and a box of something already shown', () => {
    const batteries = makeItem({ name: 'corn batteries', aisle: 'Household' });
    const leftover: KitchenEntry = { ...entry(peas), id: 'leftover-1', kind: 'leftover', sourceId: 'lo-1', title: 'Pea soup' };
    const box: KitchenEntry = { ...entry(peas), id: 'product-1', kind: 'product', sourceId: 'box-1', itemId: peas.id };
    const choices = blankChoices(blank(), [peas, batteries], [box, entry(peas), leftover, entry(batteries)], ['Household']);
    expect(choices.kitchen.map(c => [c.name, c.itemId])).toEqual([['frozen peas', peas.id]]);
  });
});

describe('blankSuggestions', () => {
  const spinach = makeItem({ name: 'spinach' });
  const kale = makeItem({ name: 'kale' });
  const arugula = makeItem({ name: 'arugula' });
  const items = [spinach, kale, arugula];

  it('marks the recipe’s own options the kitchen has, in the order written, with a caption only when one is due', () => {
    const kitchen = [entry(spinach, 'due', '1 day left'), entry(kale, 'fresh', 'Good until Aug 20')];
    expect(blankSuggestions(blank({ options: ['spinach', 'kale', 'collards'] }), items, kitchen)).toEqual([
      { name: 'spinach', inKitchen: true, caption: '1 day left' },
      { name: 'kale', inKitchen: true, caption: null },
      { name: 'collards', inKitchen: false, caption: null },
    ]);
  });

  it('does not count something past its use-by, and leaves out what the kitchen has that the recipe did not name', () => {
    const kitchen = [entry(spinach, 'over', '3 days past use-by'), entry(arugula)];
    expect(blankSuggestions(blank({ options: ['spinach', 'kale'] }), items, kitchen).map(s => [s.name, s.inKitchen])).toEqual([
      ['spinach', false], ['kale', false],
    ]);
  });

  it('is empty for a blank with no suggestions', () => {
    expect(blankSuggestions(blank(), items, [entry(spinach)])).toEqual([]);
  });
});

describe('defaultBlankPicks', () => {
  const urgent = { name: 'spinach', nameKey: 'spinach', itemId: 'a', source: 'kitchen' as const, freshness: 'due' as const, caption: null };
  const soon = { ...urgent, name: 'kale', nameKey: 'kale', freshness: 'soon' as const };
  const fresh = { ...urgent, name: 'peas', nameKey: 'peas', freshness: 'fresh' as const };

  it('starts on what needs using, up to the limit', () => {
    expect(defaultBlankPicks(blank(), { kitchen: [urgent, soon, fresh], stale: [], others: [] })).toEqual(['spinach', 'kale']);
    expect(defaultBlankPicks(blank({ max: 1 }), { kitchen: [urgent, soon], stale: [], others: [] })).toEqual(['spinach']);
  });

  it('with nothing urgent, starts a pick-one blank on the first thing in the kitchen and a pick-any one empty', () => {
    expect(defaultBlankPicks(blank({ max: 1 }), { kitchen: [fresh], stale: [], others: [] })).toEqual(['peas']);
    expect(defaultBlankPicks(blank(), { kitchen: [fresh], stale: [], others: [] })).toEqual([]);
    expect(defaultBlankPicks(blank({ max: 1 }), { kitchen: [], stale: [], others: [] })).toEqual([]);
  });

  it('reads due and soon as needing using', () => {
    expect([urgent, soon, fresh].map(needsUsing)).toEqual([true, true, false]);
  });
});

describe('togglePick', () => {
  it('adds and removes by catalog key', () => {
    expect(togglePick(blank(), ['peas'], 'kale')).toEqual({ picks: ['peas', 'kale'], refused: false });
    expect(togglePick(blank(), ['peas', 'kale'], 'Peas')).toEqual({ picks: ['kale'], refused: false });
  });

  it('swaps on a pick-one blank', () => {
    expect(togglePick(blank({ max: 1 }), ['rice'], 'farro')).toEqual({ picks: ['farro'], refused: false });
  });

  it('refuses a pick past the limit rather than dropping one', () => {
    expect(togglePick(blank({ max: 2 }), ['a', 'b'], 'c')).toEqual({ picks: ['a', 'b'], refused: true });
    expect(togglePick(blank({ max: 2 }), ['a', 'b'], 'a')).toEqual({ picks: ['b'], refused: false });
  });
});

describe('lastBlankFill', () => {
  const fill: RecipeOverride[] = [{ targetId: 'b', replacement: null, fill: [{
    id: 'l', name: 'rice', nameKey: 'rice', quantity: '', aisle: null, prep: null, purpose: null, section: 'Grain', choiceGroup: null,
  }] }];
  const meal = (id: string, date: string, overrides: RecipeOverride[] = fill, recipeId: string | null = 'bowl'): MealPlanEntry =>
    ({ id, date, recipeId, recipeOverrides: overrides, createdAt: `${date}T12:00:00.000Z` } as MealPlanEntry);

  it('finds the latest other cooking of the recipe that filled a blank, on or before this one', () => {
    const entries = [
      meal('a', '2026-10-01'),
      meal('b', '2026-10-05'),
      meal('c', '2026-10-09'),
      meal('d', '2026-10-06', []),
      meal('e', '2026-10-07', fill, 'other'),
      meal('now', '2026-10-08', []),
    ];
    expect(lastBlankFill(entries, entries[5])?.id).toBe('b');
  });

  it('is null for a meal with no recipe, or with nothing earlier', () => {
    expect(lastBlankFill([meal('a', '2026-10-01')], { id: 'x', recipeId: null, date: '2026-10-08' })).toBeNull();
    expect(lastBlankFill([meal('a', '2026-10-09')], { id: 'x', recipeId: 'bowl', date: '2026-10-08' })).toBeNull();
  });
});
