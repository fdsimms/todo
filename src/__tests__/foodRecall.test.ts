import {
  RECALL_MIN_QUERY,
  describeRecall,
  recallFoods,
  recallWeight,
  type RecalledFood,
} from '../utils/foodRecall';
import type { FoodLogEntry } from '../types';

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

  it('finds a label sitting inside a longer description, at half weight', () => {
    // The direction a meal description actually runs: more words than the
    // stored label, not fewer.
    expect(recallWeight('chicken burrito bowl', 'chicken burrito bowl with extra guac')).toBe(1.5);
  });

  it('ranks a direct hit above a containment one', () => {
    const direct = recallWeight('chicken burrito bowl', 'chicken burrito');
    const contained = recallWeight('chicken burrito bowl', 'chicken burrito bowl with extra guac');
    expect(direct).toBeGreaterThan(contained);
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
