import {
  RECALL_MIN_QUERY,
  catalogRecallFoods,
  describeCatalogRecall,
  describeRecall,
  describedEstimateFactor,
  describedGrams,
  descriptionClauses,
  rankRecallCandidates,
  recallFoods,
  measuresByWeight,
  recallAmountAsk,
  recallMeasuringPanel,
  recallWeight,
  recalledHelping,
  type RecallableItem,
  type RecallableProduct,
  type RecalledFood,
} from '../utils/foodRecall';
import type { FoodLogEntry, FoodNutrition } from '../types';

function panel(overrides: Partial<FoodNutrition> = {}): FoodNutrition {
  return {
    basis: 'perServing',
    servingGrams: 170,
    servingText: '1 pot (170g)',
    amounts: { calorieKcal: 120, proteinG: 15 },
    portions: [],
    source: 'openFoodFacts',
    sourceId: '0894700010045',
    recordedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function catalogItem(overrides: Partial<RecallableItem> = {}): RecallableItem {
  return { id: 'i1', name: 'Yogurt', nutrition: panel(), ...overrides };
}

function catalogProduct(overrides: Partial<RecallableProduct> = {}): RecallableProduct {
  return {
    id: 'p1',
    itemId: 'i1',
    brand: 'Good Culture',
    variant: 'low fat',
    nutrition: panel(),
    ...overrides,
  };
}

let seq = 0;
function entry(overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
  seq += 1;
  return {
    id: `e-${seq}`,
    dayKey: '2026-04-02',
    atISO: `2026-04-02T0${seq % 10}:00:00.000Z`,
    slot: 'breakfast',
    label: 'Milk',
    recipeId: null,
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    quantity: '1 cup',
    grams: 244,
    nutrition: {
      basis: 'perServing',
      servingGrams: 244,
      servingText: '1 cup',
      amounts: { calorieKcal: 149 },
      portions: [],
      source: 'fdc',
      sourceId: null,
      recordedAt: '2026-04-02T00:00:00.000Z',
    },
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: '2026-04-02T00:00:00.000Z',
    ...overrides,
  };
}

function labels(found: RecalledFood[]): string[] {
  return found.map(f => f.label);
}

describe('recallWeight', () => {
  it('scores a typed prefix of the label on matchWeight\'s own ladder', () => {
    expect(recallWeight('overnight oats', 'overnight')).toBe(3);
    expect(recallWeight('greek yogurt', 'yogurt')).toBe(2);
  });

  it('finds a label sitting inside a longer description', () => {
    // The direction a meal description actually runs: more words than the
    // stored label, not fewer.
    expect(recallWeight('chicken burrito bowl', 'chicken burrito bowl with extra guac'))
      .toBeGreaterThan(0);
  });

  it('ranks every containment hit below every direct one', () => {
    // Typed characters appearing in the name is the stronger signal, so the
    // weakest direct rung still has to beat the strongest containment.
    const weakestDirect = recallWeight('peanut butter', 'butter peanut');
    const strongestContained = recallWeight('chicken burrito bowl', 'chicken burrito bowl with guac');
    expect(weakestDirect).toBe(0.5);
    expect(strongestContained).toBeLessThan(weakestDirect);
    expect(strongestContained).toBeGreaterThan(0);
  });

  it('keeps a specific name above a generic one that merely sits in the query', () => {
    // Halving the containment weight got this backwards: "Yogurt" is inside
    // "good culture yogurt" at word-start, where the branded row matches only
    // out of order.
    const specific = recallWeight('yogurt good culture low fat', 'good culture yogurt');
    const generic = recallWeight('yogurt', 'good culture yogurt');
    expect(specific).toBeGreaterThan(generic);
  });

  it('refuses to look for a very short label inside a description', () => {
    // "steak" contains the letters of "tea". A three-character label appears
    // inside enough ordinary sentences to offer the wrong panel on most of
    // them, and it is still found by typing it.
    expect(recallWeight('tea', 'steak and ale pie')).toBe(0);
    expect(recallWeight('tea', 'tea')).toBeGreaterThan(0);
  });

  it('scores nothing for an empty side', () => {
    expect(recallWeight('', 'oats')).toBe(0);
    expect(recallWeight('oats', '')).toBe(0);
  });
});

describe('recallFoods', () => {
  it('says nothing until the description is describing something', () => {
    const entries = [entry({ label: 'Oatmeal' })];
    expect(recallFoods(entries, 'oa')).toEqual([]);
    expect('oat'.length).toBe(RECALL_MIN_QUERY);
    expect(labels(recallFoods(entries, 'oat'))).toEqual(['Oatmeal']);
  });

  it('finds a food named inside a longer description', () => {
    const entries = [entry({ label: 'Chicken burrito bowl' })];
    expect(labels(recallFoods(entries, 'chicken burrito bowl with extra guac')))
      .toEqual(['Chicken burrito bowl']);
  });

  it('groups entries sharing a label and counts them', () => {
    const found = recallFoods([
      entry({ label: 'Overnight oats', atISO: '2026-04-01T08:00:00.000Z' }),
      entry({ label: 'overnight oats', atISO: '2026-04-03T08:00:00.000Z' }),
      entry({ label: 'Overnight Oats', atISO: '2026-04-02T08:00:00.000Z' }),
    ], 'overnight oats');
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(3);
    expect(found[0].lastAtISO).toBe('2026-04-03T08:00:00.000Z');
  });

  it('brings back the most recent logging of a food, not the first', () => {
    // A food re-portioned or re-linked since should come back as it was last
    // eaten.
    const found = recallFoods([
      entry({ label: 'Porridge', atISO: '2026-04-01T08:00:00.000Z', quantity: '1 bowl', grams: 200 }),
      entry({ label: 'Porridge', atISO: '2026-04-05T08:00:00.000Z', quantity: '2 bowls', grams: 400, itemId: 'oats' }),
    ], 'porridge');
    expect(found[0].quantity).toBe('2 bowls');
    expect(found[0].grams).toBe(400);
    expect(found[0].itemId).toBe('oats');
    expect(found[0].label).toBe('Porridge');
  });

  it('hands the stored panel back verbatim, keeping the claim it was logged under', () => {
    // The whole argument for the feature: re-describing this to the estimator
    // would record it again as a guess, and `source: estimated` is permanent.
    const panel = {
      basis: 'perServing' as const,
      servingGrams: 170,
      servingText: '1 pot',
      amounts: { calorieKcal: 120, proteinG: 15 },
      portions: [],
      source: 'openFoodFacts' as const,
      sourceId: '01234567',
      recordedAt: '2026-03-30T00:00:00.000Z',
    };
    const found = recallFoods([entry({ label: 'Chobani yogurt', nutrition: panel })], 'chobani');
    expect(found[0].nutrition).toEqual(panel);
    expect(found[0].nutrition.source).toBe('openFoodFacts');
    expect(found[0].nutrition.sourceId).toBe('01234567');
  });

  it('puts a direct hit above one that only matched inside the description', () => {
    const found = recallFoods([
      // Reached only by looking for this label inside the description.
      entry({ label: 'Chicken burrito', atISO: '2026-04-09T08:00:00.000Z' }),
      // A direct hit: what was typed is a prefix of this label.
      entry({ label: 'Chicken burrito bowl with extra guac and rice', atISO: '2026-04-01T08:00:00.000Z' }),
    ], 'chicken burrito bowl with extra guac');
    // The direct hit leads although the other is the more recent, so the weight
    // is what decided rather than recency.
    expect(labels(found)).toEqual(['Chicken burrito bowl with extra guac and rice', 'Chicken burrito']);
  });

  it('breaks a tie on how often, then how recently, then the label', () => {
    const found = recallFoods([
      entry({ label: 'Oat latte', atISO: '2026-04-01T08:00:00.000Z' }),
      entry({ label: 'Oat cookie', atISO: '2026-04-02T08:00:00.000Z' }),
      entry({ label: 'Oat cookie', atISO: '2026-04-03T08:00:00.000Z' }),
      entry({ label: 'Oat bar', atISO: '2026-04-04T08:00:00.000Z' }),
    ], 'oat');
    // Cookie eaten twice leads; latte and bar tie on count, so the later one
    // comes first.
    expect(labels(found)).toEqual(['Oat cookie', 'Oat bar', 'Oat latte']);
  });

  it('skips an entry with nothing to call it', () => {
    expect(recallFoods([entry({ label: '   ' })], 'milk')).toEqual([]);
  });

  it('caps what it offers', () => {
    const entries = ['Oat bar', 'Oat cookie', 'Oat latte', 'Oat milk', 'Oatcake']
      .map(label => entry({ label }));
    expect(recallFoods(entries, 'oat')).toHaveLength(3);
    expect(recallFoods(entries, 'oat', 2)).toHaveLength(2);
  });

  it('finds nothing in an empty log', () => {
    expect(recallFoods([], 'anything at all')).toEqual([]);
  });

  it('carries the panel the most recent logging kept, and none from one that kept nothing', () => {
    // #2914: the panel is what lets the entry logged from this be corrected.
    const kept = panel({ basis: 'per100g', servingGrams: null, servingText: null, source: 'fdc', sourceId: '171077' });
    const found = recallFoods([
      entry({ label: 'Roast chicken', atISO: '2026-04-01T08:00:00.000Z' }),
      entry({ label: 'Roast chicken', atISO: '2026-04-05T08:00:00.000Z', sourcePanel: kept }),
    ], 'roast chicken');
    expect(found[0].sourcePanel).toEqual(kept);

    const older = recallFoods([
      entry({ label: 'Roast chicken', atISO: '2026-04-05T08:00:00.000Z', sourcePanel: kept }),
      entry({ label: 'Roast chicken', atISO: '2026-04-09T08:00:00.000Z' }),
    ], 'roast chicken');
    // The most recent logging kept nothing, and what it kept is what comes back.
    expect(older[0].sourcePanel).toBeNull();
  });
});

describe('logging a recalled food again (#2914)', () => {
  const now = new Date('2026-04-10T12:00:00');

  /** The database's own record: per 100 g, with a portion row. */
  const chicken: FoodNutrition = {
    basis: 'per100g',
    servingGrams: null,
    servingText: null,
    amounts: { calorieKcal: 165, proteinG: 31 },
    portions: [{ amount: 1, label: 'breast', grams: 172 }],
    source: 'fdc',
    sourceId: '171077',
    recordedAt: '2026-04-02T00:00:00.000Z',
  };

  /**
   * One helping of it as an entry stores it. The figures here are deliberately
   * not 200 g of the panel above, so a test can tell which of the two a new
   * weight was measured against.
   */
  const helping: FoodNutrition = {
    basis: 'perServing',
    servingGrams: 200,
    servingText: '200g',
    amounts: { calorieKcal: 400, proteinG: 70 },
    portions: [],
    source: 'fdc',
    sourceId: '171077',
    recordedAt: '2026-04-02T00:00:00.000Z',
  };

  function unfiled(overrides: Partial<FoodLogEntry> = {}): RecalledFood {
    return recallFoods([entry({
      label: 'Chicken breast, roasted',
      quantity: '200g',
      grams: 200,
      nutrition: helping,
      sourcePanel: chicken,
      ...overrides,
    })], 'chicken breast')[0];
  }

  /** A described meal cut to half, keeping the whole it is half of. */
  const wholeEstimate: FoodNutrition = {
    basis: 'perServing',
    servingGrams: 600,
    servingText: '1 burrito',
    amounts: { calorieKcal: 1000, proteinG: 40 },
    portions: [],
    source: 'estimated',
    sourceId: null,
    recordedAt: '2026-04-02T00:00:00.000Z',
  };
  const halfEstimate: FoodNutrition = {
    ...wholeEstimate,
    servingGrams: 300,
    servingText: 'half of 1 burrito',
    amounts: { calorieKcal: 500, proteinG: 20 },
  };

  function estimate(): RecalledFood {
    return recallFoods([entry({
      label: 'Chicken burrito',
      quantity: 'half of 1 burrito',
      grams: 300,
      nutrition: halfEstimate,
      sourcePanel: wholeEstimate,
    })], 'chicken burrito')[0];
  }

  it('logs the same helping with the same kept panel when the amount is left alone', () => {
    // Leaving the panel behind was the bug: the copy could only be renamed.
    const again = recalledHelping(unfiled(), null, now);
    expect(again).toEqual({ quantity: '200g', grams: 200, nutrition: helping, sourcePanel: chicken });
  });

  it('carries an estimate\'s whole verbatim too, so the copy is still the same amount of it', () => {
    const again = recalledHelping(estimate(), null, now)!;
    expect(again.nutrition).toBe(halfEstimate);
    expect(again.sourcePanel).toBe(wholeEstimate);
  });

  it('measures a new weight against the kept panel, not the stored helping', () => {
    const again = recalledHelping(unfiled(), { grams: 170 }, now)!;
    // 170 g of 165 kcal and 31 g protein per 100 g. Multiplied out of the
    // stored helping it would have been 340 kcal and 59.5 g.
    expect(again.nutrition.amounts).toEqual({ calorieKcal: 280.5, proteinG: 52.7 });
    expect(again.grams).toBe(170);
    expect(again.quantity).toBe('170g');
    expect(again.nutrition.servingText).toBe('170g');
    // The claim it was measured under is the database's, and the new entry
    // keeps the panel it was measured against so it can be corrected again.
    expect(again.nutrition.source).toBe('fdc');
    expect(again.nutrition.sourceId).toBe('171077');
    expect(again.sourcePanel).toBe(chicken);
  });

  it('scales a weight against an estimate\'s whole, when the whole recorded one, and keeps it', () => {
    const food = estimate();
    const again = recalledHelping(food, { grams: 150 }, now)!;
    // A quarter of the 600 g burrito the model described, taken of its
    // figures rather than of the half last logged.
    expect(again.nutrition.amounts).toEqual({ calorieKcal: 250, proteinG: 10 });
    expect(again.grams).toBe(150);
    expect(again.quantity).toBe('1/4 burrito');
    expect(again.nutrition.source).toBe('estimated');
    // Kept, so the new entry can be changed again and All still means the
    // meal the model described.
    expect(again.sourcePanel).toBe(wholeEstimate);
  });

  it('measures a linked food against its helping, the order foodLogEntryEdit keeps', () => {
    const food = unfiled({ itemId: 'item-chicken' });
    expect(recallMeasuringPanel(food)).toBe(helping);
    const again = recalledHelping(food, { grams: 100 }, now)!;
    expect(again.nutrition.amounts.calorieKcal).toBe(200);
    expect(again.sourcePanel).toBeNull();
  });

  it('measures a food that kept nothing against its helping, as before', () => {
    const food = unfiled({ sourcePanel: null });
    expect(recallMeasuringPanel(food)).toBe(helping);
    const again = recalledHelping(food, { grams: 100 }, now)!;
    expect(again.nutrition.amounts.calorieKcal).toBe(200);
    expect(again.sourcePanel).toBeNull();
  });

  it('refuses a weight it cannot measure rather than logging the recorded helping', () => {
    // A drink's panel is per 100 ml, and a weight in grams says nothing about
    // a volume without a density the app deliberately has not got. This used
    // to log the 200 g helping with the typed 250 thrown away unsaid.
    const drink: FoodNutrition = { ...chicken, basis: 'per100ml', portions: [] };
    const food = unfiled({ sourcePanel: drink });
    expect(recalledHelping(food, { grams: 250 }, now)).toBeNull();
    // A multiple is an estimate's correction, not a database food's.
    expect(recalledHelping(unfiled(), { factor: 2 }, now)).toBeNull();
  });

  describe('an estimate recalled at a new amount', () => {
    /** "2 slices" as the model described it: no weight, a count in its words. */
    const twoSlices: FoodNutrition = {
      basis: 'perServing',
      servingGrams: null,
      servingText: '2 slices',
      amounts: { calorieKcal: 600, proteinG: 26 },
      portions: [],
      source: 'estimated',
      sourceId: null,
      recordedAt: '2026-04-02T19:00:00.000Z',
    };
    const threeSlices: FoodNutrition = {
      ...twoSlices,
      servingText: '3 slices',
      amounts: { calorieKcal: 900, proteinG: 39 },
    };

    /** Last logged at 3 slices, keeping the 2-slice whole. */
    function pizza(): RecalledFood {
      return recallFoods([entry({
        label: 'Pepperoni pizza',
        quantity: '3 slices',
        grams: null,
        nutrition: threeSlices,
        sourcePanel: twoSlices,
      })], 'pepperoni pizza')[0];
    }

    /** Logged once as estimated and never changed, so it kept nothing. */
    function burger(): RecalledFood {
      return recallFoods([entry({
        label: 'Cheeseburger and fries',
        quantity: '1 burger and a regular fries',
        grams: null,
        nutrition: {
          ...twoSlices,
          servingText: '1 burger and a regular fries',
          amounts: { calorieKcal: 1250, proteinG: 45 },
        },
      })], 'cheeseburger')[0];
    }

    it('asks for a count in the estimate\'s own unit, opened on the count last logged', () => {
      const ask = recallAmountAsk(pizza());
      expect(ask.kind).toBe('count');
      if (ask.kind !== 'count') return;
      expect(ask.count.count).toBe(2);
      expect(ask.count.noun).toBe('slices');
      expect(ask.opensAt).toBe(3);
    });

    it('scales off the whole at a new count, and keeps the whole for next time', () => {
      // Four slices of the two-slice meal, not four-thirds of the three logged.
      const again = recalledHelping(pizza(), { factor: 4 / 2 }, now)!;
      expect(again.nutrition.amounts).toEqual({ calorieKcal: 1200, proteinG: 52 });
      expect(again.quantity).toBe('4 slices');
      expect(again.grams).toBeNull();
      expect(again.nutrition.source).toBe('estimated');
      expect(again.sourcePanel).toBe(twoSlices);
      // And at the count the model described, the whole comes back exactly.
      expect(recalledHelping(pizza(), { factor: 1 }, now)!.nutrition).toBe(twoSlices);
    });

    it('refuses a weight for an estimate that never had one', () => {
      // The report: 110 typed into "Amount to log … g" for "2 slices" logged
      // the whole previous helping. There is nothing to measure it against.
      expect(recalledHelping(pizza(), { grams: 110 }, now)).toBeNull();
    });

    it('offers the closed set for words with no count, opened on the amount last logged', () => {
      expect(recallAmountAsk(burger())).toEqual({ kind: 'multiple', opensAt: 1 });
      const twice = recalledHelping(burger(), { factor: 2 }, now)!;
      expect(twice.nutrition.amounts).toEqual({ calorieKcal: 2500, proteinG: 90 });
      expect(twice.quantity).toBe('twice 1 burger and a regular fries');
      // It kept nothing before, so the whole it is twice of is kept now.
      expect(twice.sourcePanel?.amounts.calorieKcal).toBe(1250);
      expect(twice.sourcePanel?.servingText).toBe('1 burger and a regular fries');
    });
  });

  describe('a weight typed beside an estimate', () => {
    const hummus: FoodNutrition = {
      basis: 'perServing',
      servingGrams: 27,
      servingText: '2 tablespoons',
      amounts: { calorieKcal: 48 },
      portions: [],
      source: 'estimated',
      sourceId: null,
      recordedAt: '2026-04-02T19:00:00.000Z',
    };
    const food = (nutrition: FoodNutrition = hummus) => recallFoods([entry({
      label: 'Homemade hummus', quantity: '27 g', grams: nutrition.servingGrams, nutrition,
    })], 'hummus')[0];

    it('reads the weight as a multiple of the whole that recorded one', () => {
      expect(describedEstimateFactor(food(), '54g homemade hummus')).toBe(2);
      expect(describedEstimateFactor(food(), '29g homemade hummus')).toBeCloseTo(29 / 27);
    });

    it('says nothing without a weight typed, or one recorded for the whole', () => {
      expect(describedEstimateFactor(food(), 'homemade hummus')).toBeNull();
      expect(describedEstimateFactor(food({ ...hummus, servingGrams: null }), '29g hummus')).toBeNull();
    });

    it('says nothing past the largest multiple an estimate may take', () => {
      expect(describedEstimateFactor(food(), '900g homemade hummus')).toBeNull();
    });
  });

  describe('which amount the step asks for', () => {
    it('asks for grams only where a weight can be measured', () => {
      expect(recallAmountAsk(unfiled())).toEqual({ kind: 'weight' });
      expect(recallAmountAsk(unfiled({ itemId: 'item-chicken' }))).toEqual({ kind: 'weight' });
    });

    it('asks for nothing where a typed weight would be ignored', () => {
      const drink: FoodNutrition = { ...chicken, basis: 'per100ml', portions: [] };
      expect(recallAmountAsk(unfiled({ sourcePanel: drink }))).toEqual({ kind: 'none' });
      // A linked helping recorded as a serving with no weight.
      const serving: FoodNutrition = { ...helping, servingGrams: null, servingText: '1 serving' };
      expect(recallAmountAsk(unfiled({ itemId: 'item-a', nutrition: serving, grams: null }))).toEqual({ kind: 'none' });
    });
  });

  it('knows which panels can be measured at a weight', () => {
    expect(measuresByWeight(chicken)).toBe(true);
    expect(measuresByWeight(helping)).toBe(true);
    expect(measuresByWeight({ ...helping, servingGrams: null })).toBe(false);
    expect(measuresByWeight({ ...chicken, basis: 'per100ml', portions: [] })).toBe(false);
  });
});

describe('rankRecallCandidates', () => {
  const candidates = [
    { key: 'a', nameKey: 'oat milk' },
    { key: 'b', nameKey: 'oatcakes' },
    { key: 'c', nameKey: 'sourdough' },
  ];

  it('keeps only what the description names', () => {
    expect(rankRecallCandidates(candidates, 'oat').map(c => c.key)).toEqual(['a', 'b']);
  });

  it('says nothing for a query under the floor', () => {
    expect(rankRecallCandidates(candidates, 'oa')).toEqual([]);
  });

  it('leaves equally-matched candidates in the order they arrived', () => {
    // How this composes with rankByRecency: the caller arranges by what has
    // actually been eaten, and the weight only ever promotes above that.
    const eatenFirst = [candidates[1], candidates[0]];
    expect(rankRecallCandidates(eatenFirst, 'oat').map(c => c.key)).toEqual(['b', 'a']);
  });

  it('caps what it returns', () => {
    expect(rankRecallCandidates(candidates, 'oat', 1).map(c => c.key)).toEqual(['a']);
  });
});

describe('catalogRecallFoods', () => {
  it('offers the packet and the item it belongs to, under the keys recency credits', () => {
    const found = catalogRecallFoods([catalogItem()], [catalogProduct()]);
    expect(found.map(f => f.key)).toEqual(['p:p1', 'i:i1']);
    expect(found[0].label).toBe('Yogurt, Good Culture low fat');
    expect(found[1].label).toBe('Yogurt');
    expect(found[0].productId).toBe('p1');
    expect(found[1].productId).toBeNull();
    expect(found.every(f => f.itemId === 'i1')).toBe(true);
  });

  it('leaves out a row with no figures on it', () => {
    expect(catalogRecallFoods([catalogItem({ nutrition: null })], [])).toEqual([]);
  });

  it('leaves out a panel with no serving to log, rather than inventing an amount', () => {
    // Per-100g with no serving weight: packageChoices can offer nothing, and
    // the honest answer is to let the person type the amount.
    const noServing = panel({ basis: 'per100g', servingGrams: null, servingText: null });
    expect(catalogRecallFoods([catalogItem({ nutrition: noServing })], [])).toEqual([]);
  });

  it('drops a packet whose item is gone', () => {
    const found = catalogRecallFoods([], [catalogProduct()]);
    expect(found).toEqual([]);
  });

  it('names a packet by its item alone when there is nothing to describe it by', () => {
    const bare = catalogProduct({ brand: null, variant: null });
    expect(catalogRecallFoods([catalogItem()], [bare])[0].label).toBe('Yogurt');
  });

  it('prefers the packet\'s own panel over the item\'s', () => {
    const item = catalogItem({ nutrition: panel({ amounts: { calorieKcal: 999 } }) });
    const product = catalogProduct({ nutrition: panel({ amounts: { calorieKcal: 120 } }) });
    expect(catalogRecallFoods([item], [product])[0].nutrition.amounts.calorieKcal).toBe(120);
  });

  it('puts the branded packet above the bare item when the brand is named', () => {
    const found = rankRecallCandidates(
      catalogRecallFoods([catalogItem()], [catalogProduct()]),
      'good culture yogurt',
    );
    expect(found.map(f => f.label)).toEqual(['Yogurt, Good Culture low fat', 'Yogurt']);
  });

  // A portion carries no panel, so it would fall through to the item's and
  // offer the item twice under one name (#2925).
  it('leaves out a frozen portion, which is the item again rather than a packet of it', () => {
    const portion = catalogProduct({ id: 'p-portion', brand: null, variant: null, nutrition: null, isPortion: true });
    expect(catalogRecallFoods([catalogItem()], [portion]).map(f => f.key)).toEqual(['i:i1']);
  });
});

describe('describeCatalogRecall', () => {
  it('says where it came from and how much, and states no figure', () => {
    const food = catalogRecallFoods([catalogItem({ nutrition: panel({ servingText: '170g' }) })], [])[0];
    expect(describeCatalogRecall(food)).toBe('In your kitchen, 1 serving (170g)');
    expect(describeCatalogRecall(food)).not.toContain('120');
  });
});

describe('describeRecall', () => {
  function recalled(overrides: Partial<RecalledFood> = {}): RecalledFood {
    const base = recallFoods([entry({ label: 'Milk' })], 'milk')[0];
    return { ...base, ...overrides };
  }

  it('counts once without pluralising it', () => {
    expect(describeRecall(recalled({ count: 1 }))).toBe('Logged once, last as 1 cup');
  });

  it('counts a repeat', () => {
    expect(describeRecall(recalled({ count: 4 }))).toBe('Logged 4 times, last as 1 cup');
  });

  it('says the amount without the amount being known', () => {
    expect(describeRecall(recalled({ count: 2, quantity: '' }))).toBe('Logged 2 times');
  });

  it('states no figure of its own', () => {
    // The panel is on the row beside this. Repeating a number here would read
    // as the sentence making its own claim, the rule describeEstimate keeps.
    expect(describeRecall(recalled({ count: 2 }))).not.toContain('149');
  });
});

describe('describedGrams', () => {
  it('reads a weight leading the description', () => {
    expect(describedGrams('205g cooked beans')).toBe('205g');
  });

  it('reads a weight anywhere in the description', () => {
    expect(describedGrams('cooked beans, 205g')).toBe('205g');
  });

  it('accepts a decimal and the word "grams"', () => {
    expect(describedGrams('12.5 grams of butter')).toBe('12.5g');
  });

  it('returns null with no weight named', () => {
    expect(describedGrams('cooked beans')).toBeNull();
  });

  it('does not mistake a serving count for a weight', () => {
    expect(describedGrams('2 servings of beans')).toBeNull();
  });
});

describe('descriptionClauses', () => {
  it('splits a multi-food description on the comma', () => {
    expect(descriptionClauses('31 g baguette, 25g peach jam')).toEqual(['31 g baguette', '25g peach jam']);
  });

  it('trims each clause and drops empty ones', () => {
    expect(descriptionClauses(' chicken tacos ,  , rice ')).toEqual(['chicken tacos', 'rice']);
  });

  it('returns the whole description as one clause with no comma', () => {
    expect(descriptionClauses('cheeseburger and fries')).toEqual(['cheeseburger and fries']);
  });

  it('returns nothing for a blank description', () => {
    expect(descriptionClauses('  ')).toEqual([]);
  });
});
