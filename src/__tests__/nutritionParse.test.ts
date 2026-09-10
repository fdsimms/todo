import {
  convertNutrientAmount,
  readFdcNutrition,
  readFdcPortions,
  readOffNutrition,
  readSourceNumber,
} from '../utils/nutritionParse';

const RECORDED_AT = '2026-09-10T12:00:00.000Z';

/**
 * The fixtures below are trimmed from real responses rather than invented, and
 * the awkward ones are kept awkward on purpose — Open Food Facts' disagreeing
 * sodium rows and FoodData Central's repeated nutrient ids are the two things
 * this module exists to get right, so a tidied fixture would test nothing.
 */

/** Nutella, whose `sodium_100g` is in grams and agrees with its salt figure. */
const NUTELLA = {
  serving_size: null,
  product_quantity_unit: 'g',
  serving_quantity_unit: 'g',
  nutriments: {
    'energy-kcal_100g': 539,
    energy_100g: 2252,
    energy_unit: 'kJ',
    proteins_100g: 6.3,
    carbohydrates_100g: 57.5,
    fat_100g: 30.9,
    'saturated-fat_100g': 10.6,
    sugars_100g: 56.3,
    salt_100g: 0.107,
    sodium_100g: 0.0428,
    sodium_unit: 'g',
  },
};

/**
 * Red Bull, whose `sodium_100g` is in *milligrams* while claiming grams — 40
 * against a salt figure of 0.1, where Nutella's row would have said 0.04. This
 * is the row that makes reading that field at all indefensible.
 */
const RED_BULL = {
  serving_size: '250ml',
  serving_quantity: 250,
  serving_quantity_unit: 'ml',
  product_quantity_unit: 'ml',
  nutriments: {
    'energy-kcal_100g': 46,
    proteins_100g: 0,
    carbohydrates_100g: 11,
    fat_100g: 0,
    'saturated-fat_100g': 0,
    fiber_100g: 0,
    sugars_100g: 11,
    caffeine_100g: 0.032,
    salt_100g: 0.1,
    sodium_100g: 40,
    sodium_unit: 'g',
  },
};

describe('readSourceNumber', () => {
  it('reads a number, and a number written as a string', () => {
    expect(readSourceNumber(12.5)).toBe(12.5);
    // Open Food Facts returns several numeric fields as strings depending on
    // how the row was entered.
    expect(readSourceNumber('12.5')).toBe(12.5);
    expect(readSourceNumber(0)).toBe(0);
  });

  it('refuses anything that is not a usable figure', () => {
    expect(readSourceNumber(null)).toBeNull();
    expect(readSourceNumber(undefined)).toBeNull();
    expect(readSourceNumber('')).toBeNull();
    expect(readSourceNumber('traces')).toBeNull();
    expect(readSourceNumber(NaN)).toBeNull();
    expect(readSourceNumber(Infinity)).toBeNull();
    // No food contains minus four grams of fat, so the row is wrong rather
    // than surprising.
    expect(readSourceNumber(-4)).toBeNull();
  });
});

describe('convertNutrientAmount', () => {
  it('leaves a figure already in the stored unit alone', () => {
    expect(convertNutrientAmount(30.9, 'g', 'fatG')).toBe(30.9);
    expect(convertNutrientAmount(539, 'kcal', 'calorieKcal')).toBe(539);
  });

  it('converts mass up and down without leaving a floating-point tail', () => {
    // The exact case that motivates the rounding: 0.0428 * 1000 is
    // 42.800000000000004 in IEEE 754.
    expect(convertNutrientAmount(0.0428, 'g', 'sodiumMg')).toBe(42.8);
    expect(convertNutrientAmount(487, 'mg', 'sodiumMg')).toBe(487);
    expect(convertNutrientAmount(2500, 'ug', 'caffeineMg')).toBe(2.5);
    expect(convertNutrientAmount(1500, 'mg', 'proteinG')).toBe(1.5);
  });

  it('converts kilojoules to kilocalories on the regulated factor', () => {
    expect(convertNutrientAmount(2252, 'kj', 'calorieKcal')).toBeCloseTo(538.2, 1);
  });

  it('reads a mass of water as a volume, and only for water', () => {
    // A millilitre is defined as the volume of a gram of water, so this is the
    // one cross-family conversion that isn't a guess.
    expect(convertNutrientAmount(99.6, 'g', 'waterMl')).toBe(99.6);
    expect(convertNutrientAmount(0.25, 'l', 'waterMl')).toBe(250);
    // ...and nothing else may be read as a volume, or vice versa.
    expect(convertNutrientAmount(250, 'ml', 'proteinG')).toBeNull();
    expect(convertNutrientAmount(250, 'ml', 'calorieKcal')).toBeNull();
  });

  it('refuses a pair it has no defined conversion for', () => {
    // Rather than passing the number through unconverted, which is how a
    // milligram figure silently becomes a gram figure.
    expect(convertNutrientAmount(100, 'g', 'calorieKcal')).toBeNull();
    expect(convertNutrientAmount(100, 'kcal', 'fatG')).toBeNull();
    expect(convertNutrientAmount(100, 'kj', 'sodiumMg')).toBeNull();
  });
});

describe('readOffNutrition', () => {
  it('reads a full panel off the _100g fields', () => {
    const read = readOffNutrition(NUTELLA, '3017620422003', RECORDED_AT);
    expect(read).not.toBeNull();
    expect(read!.basis).toBe('per100g');
    expect(read!.source).toBe('openFoodFacts');
    expect(read!.sourceId).toBe('3017620422003');
    expect(read!.recordedAt).toBe(RECORDED_AT);
    expect(read!.amounts).toEqual({
      calorieKcal: 539,
      proteinG: 6.3,
      carbsG: 57.5,
      fatG: 30.9,
      satFatG: 10.6,
      sugarG: 56.3,
      sodiumMg: 42.8,
    });
  });

  it('takes energy from the kcal field rather than the ambiguous one', () => {
    // `energy_100g` is 2252 here and is in kJ, which `energy_unit` says and
    // the bare field name does not. Reading it would overstate the jar by a
    // factor of four.
    expect(readOffNutrition(NUTELLA, 'x', RECORDED_AT)!.amounts.calorieKcal).toBe(539);
  });

  it('derives sodium from salt and never from the sodium field', () => {
    // The whole reason the salt field is the one that gets read: taking Red
    // Bull's `sodium_100g` at its stated unit records 40 grams of sodium in
    // 100ml of a soft drink.
    expect(readOffNutrition(RED_BULL, 'x', RECORDED_AT)!.amounts.sodiumMg).toBe(40);
    expect(readOffNutrition(NUTELLA, 'x', RECORDED_AT)!.amounts.sodiumMg).toBe(42.8);
  });

  it('leaves sodium unknown when the product declares no salt', () => {
    // The refusal this module is supposed to make: there is no way to tell
    // which unit a lone sodium figure is in, so there is no figure to record.
    const noSalt = { nutriments: { proteins_100g: 5, sodium_100g: 40 } };
    const read = readOffNutrition(noSalt, 'x', RECORDED_AT)!;
    expect(read.amounts.sodiumMg).toBeUndefined();
    expect(read.amounts.proteinG).toBe(5);
  });

  it('converts caffeine out of grams', () => {
    expect(readOffNutrition(RED_BULL, 'x', RECORDED_AT)!.amounts.caffeineMg).toBe(32);
  });

  it('reads a zero caffeine as absent, since this source only ever defaults it', () => {
    // Measured rather than assumed: across 200 US products, 54 carried
    // `caffeine_100g` and the only value that ever appeared was zero, chocolate
    // and mocha products included. The field is a bulk default, so taking it
    // records a confident zero on the foods that do contain caffeine.
    const cocoa = { nutriments: { proteins_100g: 7, caffeine_100g: 0 } };
    const read = readOffNutrition(cocoa, 'x', RECORDED_AT)!;
    expect(read.amounts.caffeineMg).toBeUndefined();
    expect(read.amounts.proteinG).toBe(7);
  });

  it('still takes a caffeine figure the source actually stated', () => {
    // Only the zero is uninformative. A real reading is a real reading.
    expect(readOffNutrition(RED_BULL, 'x', RECORDED_AT)!.amounts.caffeineMg).toBe(32);
  });

  it('drops nothing else on a zero, because a real zero is common and true', () => {
    // Deliberately not a blanket rule: 41% of that same sample stated a
    // legitimate zero for saturated fat alone.
    const lean = {
      nutriments: {
        proteins_100g: 20, fat_100g: 0, 'saturated-fat_100g': 0,
        fiber_100g: 0, sugars_100g: 0, carbohydrates_100g: 0,
      },
    };
    const read = readOffNutrition(lean, 'x', RECORDED_AT)!;
    expect(read.amounts.fatG).toBe(0);
    expect(read.amounts.satFatG).toBe(0);
    expect(read.amounts.fiberG).toBe(0);
    expect(read.amounts.sugarG).toBe(0);
    expect(read.amounts.carbsG).toBe(0);
  });

  it('refuses a product whose only figure was an uninformative zero', () => {
    // Nothing left to record, which is the same answer as a panel with no
    // fields at all rather than an entry carrying one invented zero.
    expect(readOffNutrition({ nutriments: { caffeine_100g: 0 } }, 'x', RECORDED_AT)).toBeNull();
  });

  it('keeps a real zero and omits a figure the source never gave', () => {
    const read = readOffNutrition(RED_BULL, 'x', RECORDED_AT)!;
    // A drink genuinely containing no fat is a thing a label states.
    expect(read.amounts.fatG).toBe(0);
    // Nutella's panel has no fibre row at all, which is unknown and not zero.
    expect(readOffNutrition(NUTELLA, 'x', RECORDED_AT)!.amounts.fiberG).toBeUndefined();
    expect('fiberG' in readOffNutrition(NUTELLA, 'x', RECORDED_AT)!.amounts).toBe(false);
  });

  it('calls a product sold by volume per100ml, not per100g', () => {
    // Both sources label a drink's panel "per 100g" and mean per 100ml. The
    // pack's own unit is what settles it, and Open Food Facts' own
    // `nutrition_data_per` cannot: it reads "100g" on this very can.
    expect(readOffNutrition(RED_BULL, 'x', RECORDED_AT)!.basis).toBe('per100ml');
    expect(readOffNutrition(NUTELLA, 'x', RECORDED_AT)!.basis).toBe('per100g');
  });

  it('falls back to the serving unit, and to per100g when neither is stated', () => {
    const servingOnly = {
      serving_quantity_unit: 'ml',
      nutriments: { proteins_100g: 1 },
    };
    expect(readOffNutrition(servingOnly, 'x', RECORDED_AT)!.basis).toBe('per100ml');

    // A source naming no unit leaves the figures as it labelled them.
    const noUnits = { nutriments: { proteins_100g: 1 } };
    expect(readOffNutrition(noUnits, 'x', RECORDED_AT)!.basis).toBe('per100g');
  });

  it('takes a serving weight only when the source measured one in grams', () => {
    // Red Bull's serving is 250, and it is millilitres.
    const drink = readOffNutrition(RED_BULL, 'x', RECORDED_AT)!;
    expect(drink.servingGrams).toBeNull();
    expect(drink.servingText).toBe('250ml');

    const solid = {
      serving_size: '2 biscuits (25g)',
      serving_quantity: 25,
      serving_quantity_unit: 'g',
      nutriments: { proteins_100g: 5 },
    };
    expect(readOffNutrition(solid, 'x', RECORDED_AT)!.servingGrams).toBe(25);
  });

  it('ignores the estimated block, which is a guess rather than a label', () => {
    // `nutriments_estimated` is Open Food Facts computing a panel from the
    // ingredient list. Reading it would file a guess under a source that
    // claims a manufacturer's declared figures.
    const estimatedOnly = {
      nutriments: {},
      nutriments_estimated: { proteins_100g: 6.3, fiber_100g: 3.7 },
    };
    expect(readOffNutrition(estimatedOnly, 'x', RECORDED_AT)).toBeNull();
  });

  it('answers null when there is no readable panel at all', () => {
    expect(readOffNutrition({}, 'x', RECORDED_AT)).toBeNull();
    expect(readOffNutrition({ nutriments: null }, 'x', RECORDED_AT)).toBeNull();
    expect(readOffNutrition({ nutriments: [] }, 'x', RECORDED_AT)).toBeNull();
    expect(readOffNutrition({ nutriments: { nova_group: 4 } }, 'x', RECORDED_AT)).toBeNull();
  });

  it('drops an arithmetically impossible figure', () => {
    // 140g of fat in 100g of food, and 4000kcal where pure fat manages 900.
    const impossible = {
      nutriments: { fat_100g: 140, 'energy-kcal_100g': 4000, proteins_100g: 6 },
    };
    const read = readOffNutrition(impossible, 'x', RECORDED_AT)!;
    expect(read.amounts.fatG).toBeUndefined();
    expect(read.amounts.calorieKcal).toBeUndefined();
    expect(read.amounts.proteinG).toBe(6);
  });

  it('drops a per-100 calorie figure that is really the serving figure misfiled', () => {
    // Siggi's skyr: a 170g cup stating 100 cal, with that same 100 typed into
    // the per-100g field instead of the true ~59. Nothing about 100kcal/100g
    // is arithmetically impossible for a dairy product, so only the sibling
    // `energy-kcal_serving` field gives the mistake away.
    const misfiled = {
      serving_size: '1 container (170g)',
      serving_quantity: 170,
      serving_quantity_unit: 'g',
      product_quantity_unit: 'g',
      nutriments: {
        'energy-kcal_100g': 100,
        'energy-kcal_serving': 100,
        proteins_100g: 11,
      },
    };
    const read = readOffNutrition(misfiled, 'x', RECORDED_AT)!;
    expect(read.amounts.calorieKcal).toBeUndefined();
    expect(read.amounts.proteinG).toBe(11);
  });

  it('keeps a per-100 calorie figure whose serving figure is merely close, not equal', () => {
    // A serving several times the size of 100g should disagree with the
    // per-100 figure by a wide margin, and does here — a real panel, not a
    // misfiled one.
    const real = {
      serving_quantity: 170,
      serving_quantity_unit: 'g',
      nutriments: { 'energy-kcal_100g': 59, 'energy-kcal_serving': 100 },
    };
    expect(readOffNutrition(real, 'x', RECORDED_AT)!.amounts.calorieKcal).toBe(59);
  });

  it('leaves a calorie figure alone when the serving is close to 100 units', () => {
    // The two numbers are expected to nearly agree when the serving itself is
    // ~100g, so an equal pair there is not evidence of a mistake.
    const nearHundred = {
      serving_quantity: 100,
      serving_quantity_unit: 'g',
      nutriments: { 'energy-kcal_100g': 250, 'energy-kcal_serving': 250 },
    };
    expect(readOffNutrition(nearHundred, 'x', RECORDED_AT)!.amounts.calorieKcal).toBe(250);
  });

  it('leaves a calorie figure alone when there is no serving figure to compare it to', () => {
    expect(readOffNutrition(RED_BULL, 'x', RECORDED_AT)!.amounts.calorieKcal).toBe(46);
    expect(readOffNutrition(NUTELLA, 'x', RECORDED_AT)!.amounts.calorieKcal).toBe(539);
  });
});

/**
 * The shape `/foods/search` returns — flat `{ nutrientId, unitName, value }`
 * entries, not the `{ nutrient: {...}, amount }` the detail endpoint nests.
 */
function fdcNutrient(nutrientId: number, unitName: string, value: number) {
  return { nutrientId, unitName, value };
}

/** Cheerios, whose search hit repeats all 28 nutrients across three label variants. */
const CHEERIOS = {
  fdcId: 2517161,
  servingSize: 20,
  servingSizeUnit: 'GRM',
  householdServingFullText: '3/4 cup (20g) (age 1-3 years)',
  foodNutrients: [
    // The hit's own food, matching what the detail endpoint returns for 2517161.
    fdcNutrient(1003, 'G', 12.8),
    fdcNutrient(1004, 'G', 6.41),
    fdcNutrient(1005, 'G', 74.4),
    fdcNutrient(1008, 'KCAL', 359),
    fdcNutrient(2000, 'G', 5.13),
    fdcNutrient(1079, 'G', 10.3),
    fdcNutrient(1093, 'MG', 487),
    fdcNutrient(1258, 'G', 1.28),
    // A second variant merged into the same hit, with nothing in the entry to
    // say it is a different food.
    fdcNutrient(1003, 'G', 5.56),
    fdcNutrient(1008, 'KCAL', 117),
    fdcNutrient(1093, 'MG', 154),
  ],
};

describe('readFdcNutrition', () => {
  it('keeps a zero caffeine, unlike the Open Food Facts path', () => {
    // The uninformative-zero rule is deliberately scoped to one source. FDC's
    // figures are lab-measured, so a zero there is a measurement rather than a
    // default, and dropping it would discard a real reading.
    const food = {
      fdcId: 1,
      foodNutrients: [fdcNutrient(1003, 'G', 7), fdcNutrient(1057, 'MG', 0)],
    };
    expect(readFdcNutrition(food, RECORDED_AT)!.amounts.caffeineMg).toBe(0);
  });

  it('reads the flat search shape', () => {
    const read = readFdcNutrition(CHEERIOS, RECORDED_AT);
    expect(read).not.toBeNull();
    expect(read!.basis).toBe('per100g');
    expect(read!.source).toBe('fdc');
    expect(read!.sourceId).toBe('2517161');
    expect(read!.amounts).toEqual({
      proteinG: 12.8,
      fatG: 6.41,
      carbsG: 74.4,
      calorieKcal: 359,
      sugarG: 5.13,
      fiberG: 10.3,
      sodiumMg: 487,
      satFatG: 1.28,
    });
  });

  it('parses nothing from the detail endpoint shape, rather than half-reading it', () => {
    // Worth pinning because it is the silent failure: `productLookup` asks the
    // search endpoint, and a parser written against `/food/{id}` would return
    // null on every product with nothing to say why.
    const nested = {
      fdcId: 1,
      foodNutrients: [{ nutrient: { id: 1003, unitName: 'g' }, amount: 12.8 }],
    };
    expect(readFdcNutrition(nested, RECORDED_AT)).toBeNull();
  });

  it('takes the first entry for a nutrient and ignores the later variants', () => {
    // The leading run is the food that was asked for; the rest are other label
    // variants the search merged in.
    const read = readFdcNutrition(CHEERIOS, RECORDED_AT)!;
    expect(read.amounts.proteinG).toBe(12.8);
    expect(read.amounts.calorieKcal).toBe(359);
    expect(read.amounts.sodiumMg).toBe(487);
  });

  it('does not let a later variant fill in a nutrient the first entry lost', () => {
    // Falling through would be answering about a different food.
    const badFirstUnit = {
      fdcId: 9,
      foodNutrients: [
        fdcNutrient(1093, 'IU', 487),
        fdcNutrient(1093, 'MG', 154),
        fdcNutrient(1003, 'G', 5),
      ],
    };
    const read = readFdcNutrition(badFirstUnit, RECORDED_AT)!;
    expect(read.amounts.sodiumMg).toBeUndefined();
    expect(read.amounts.proteinG).toBe(5);
  });

  it('drops a unit it cannot convert rather than guessing one', () => {
    // International Units have no fixed mass equivalent — the factor differs
    // per vitamin — so there is nothing to convert.
    const iu = { fdcId: 9, foodNutrients: [fdcNutrient(1104, 'IU', 3750)] };
    expect(readFdcNutrition(iu, RECORDED_AT)).toBeNull();
  });

  it('reads water as a volume and caffeine out of milligrams', () => {
    const tea = {
      fdcId: 3,
      foodNutrients: [fdcNutrient(1051, 'G', 99.8), fdcNutrient(1057, 'MG', 16)],
    };
    const read = readFdcNutrition(tea, RECORDED_AT)!;
    expect(read.amounts.waterMl).toBe(99.8);
    expect(read.amounts.caffeineMg).toBe(16);
  });

  it('takes a serving weight only in grams, whichever way the unit is spelled', () => {
    expect(readFdcNutrition(CHEERIOS, RECORDED_AT)!.servingGrams).toBe(20);
    expect(readFdcNutrition(CHEERIOS, RECORDED_AT)!.servingText)
      .toBe('3/4 cup (20g) (age 1-3 years)');

    // The same field says `ml` in lower case on the next row along.
    const coldBrew = {
      fdcId: 1917786,
      servingSize: 355,
      servingSizeUnit: 'ml',
      householdServingFullText: '12 ONZ',
      foodNutrients: [fdcNutrient(1008, 'KCAL', 5)],
    };
    expect(readFdcNutrition(coldBrew, RECORDED_AT)!.servingGrams).toBeNull();
  });

  it('calls a food served by volume per100ml', () => {
    // The Branded dataset has no pack-level unit, so the serving's is the one
    // that says a cold brew is measured by volume where a cereal is not.
    const coldBrew = {
      fdcId: 1917786,
      servingSize: 355,
      servingSizeUnit: 'ml',
      foodNutrients: [fdcNutrient(1008, 'KCAL', 5)],
    };
    expect(readFdcNutrition(coldBrew, RECORDED_AT)!.basis).toBe('per100ml');
    expect(readFdcNutrition(CHEERIOS, RECORDED_AT)!.basis).toBe('per100g');
  });

  it('answers null when the hit carried no nutrients', () => {
    expect(readFdcNutrition({ fdcId: 1 }, RECORDED_AT)).toBeNull();
    expect(readFdcNutrition({ fdcId: 1, foodNutrients: [] }, RECORDED_AT)).toBeNull();
    expect(readFdcNutrition({ fdcId: 1, foodNutrients: 'nope' }, RECORDED_AT)).toBeNull();
  });

  it('survives a malformed entry without losing the rest of the panel', () => {
    const messy = {
      fdcId: 4,
      foodNutrients: [null, 'nope', { nutrientId: 'x' }, fdcNutrient(1003, 'G', 5)],
    };
    expect(readFdcNutrition(messy, RECORDED_AT)!.amounts).toEqual({ proteinG: 5 });
  });
});

describe('readFdcPortions', () => {
  /** Rows copied from FoodData Central's /food/170000, "Onions, raw". */
  const ONION_DETAIL = {
    foodPortions: [
      { amount: 1, gramWeight: 160, modifier: 'cup, chopped', measureUnit: { name: 'undetermined' } },
      { amount: 10, gramWeight: 60, modifier: 'rings', measureUnit: { name: 'undetermined' } },
      { amount: 1, gramWeight: 110, modifier: 'medium (2-1/2" dia)', measureUnit: { name: 'undetermined' } },
    ],
  };

  it('reads the detail endpoint\'s portion table', () => {
    expect(readFdcPortions(ONION_DETAIL)).toEqual([
      { amount: 1, label: 'cup, chopped', grams: 160 },
      { amount: 10, label: 'rings', grams: 60 },
      { amount: 1, label: 'medium (2-1/2" dia)', grams: 110 },
    ]);
  });

  it('joins a real measure unit onto the modifier', () => {
    // Most rows read "undetermined" and put the words in `modifier`, but not
    // all of them, so both are taken.
    const withUnit = {
      foodPortions: [{ amount: 1, gramWeight: 240, modifier: 'chopped', measureUnit: { name: 'cup' } }],
    };
    expect(readFdcPortions(withUnit)[0].label).toBe('cup chopped');
  });

  it('drops a row with nothing to call it', () => {
    // A weight with no label can never be matched against a recipe line.
    const unnamed = {
      foodPortions: [
        { amount: 1, gramWeight: 50, modifier: '', measureUnit: { name: 'undetermined' } },
        { amount: 1, gramWeight: 160, modifier: 'cup', measureUnit: { name: 'undetermined' } },
      ],
    };
    expect(readFdcPortions(unnamed)).toEqual([{ amount: 1, label: 'cup', grams: 160 }]);
  });

  it('drops a row that weighs nothing or states no count', () => {
    const bad = {
      foodPortions: [
        { amount: 0, gramWeight: 50, modifier: 'slice' },
        { amount: 1, gramWeight: 0, modifier: 'slice' },
        { amount: 1, gramWeight: 9, modifier: 'slice, thin' },
      ],
    };
    expect(readFdcPortions(bad)).toEqual([{ amount: 1, label: 'slice, thin', grams: 9 }]);
  });

  it('answers empty for a food that states no portions', () => {
    // Ordinary, not a failure: a food with no table still answers every line
    // already written as a mass.
    expect(readFdcPortions({})).toEqual([]);
    expect(readFdcPortions({ foodPortions: [] })).toEqual([]);
    expect(readFdcPortions({ foodPortions: 'nope' })).toEqual([]);
  });
});
