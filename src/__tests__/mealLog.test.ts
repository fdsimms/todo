import {
  asWrittenCookedWeight,
  clampCookedWeight,
  cookedDishGrams,
  defaultHelpings,
  describeHelping,
  mealHelping,
  servingGrams,
  wantsMealLogPrompt,
  weighedHelping,
  type DishFigures,
} from '../utils/mealLog';

const DISH: DishFigures = {
  total: { calorieKcal: 1200, proteinG: 40 },
  perServing: { calorieKcal: 300, proteinG: 10 },
  servings: 4,
  cookedGrams: null,
};

const UNPORTIONED: DishFigures = {
  total: { calorieKcal: 900, proteinG: 30 },
  perServing: null,
  servings: null,
  cookedGrams: null,
};

/** The same dish, weighed: 1,200 kcal spread over 1,000g of finished food. */
const WEIGHED: DishFigures = { ...DISH, cookedGrams: 1000 };

describe('wantsMealLogPrompt', () => {
  it('asks when nobody has said otherwise', () => {
    expect(wantsMealLogPrompt({ logMeal: null }, true)).toBe(true);
  });

  it('is silent while the setting is off, whatever the meal says', () => {
    // The setting is the ceiling. Somebody who switched the prompt off has
    // said they do not want asking, and a per-meal "yes" set months ago must
    // not talk over that — which is where this parts company with
    // wantsGeneratedTask.
    expect(wantsMealLogPrompt({ logMeal: null }, false)).toBe(false);
    expect(wantsMealLogPrompt({ logMeal: true }, false)).toBe(false);
  });

  it('lets one meal opt out from under the setting', () => {
    expect(wantsMealLogPrompt({ logMeal: false }, true)).toBe(false);
  });

  it('asks about a meal it knows nothing about', () => {
    // A leftover has no plan entry at all, and that is not a refusal.
    expect(wantsMealLogPrompt(null, true)).toBe(true);
    expect(wantsMealLogPrompt(undefined, true)).toBe(true);
  });
});

describe('mealHelping', () => {
  it('takes one serving of a dish that says how many it makes', () => {
    const helping = mealHelping(DISH, 1);
    expect(helping?.amounts.calorieKcal).toBe(300);
    expect(helping?.servingText).toBe('1 serving');
    expect(helping?.countsServings).toBe(true);
  });

  it('scales to several servings', () => {
    expect(mealHelping(DISH, 2)?.amounts.calorieKcal).toBe(600);
  });

  it('takes a fraction, since a dish for four eaten by one is a quarter', () => {
    expect(mealHelping(DISH, 0.5)?.amounts.calorieKcal).toBe(150);
  });

  it('counts whole dishes when the recipe never said how many servings it makes', () => {
    // The same nullable-servings hole the rollup has, answered the same way: a
    // dish with no servings count has no way to express "a quarter of it", so
    // the honest unit is the thing itself.
    const helping = mealHelping(UNPORTIONED, 1);
    expect(helping?.amounts.calorieKcal).toBe(900);
    expect(helping?.countsServings).toBe(false);
    expect(helping?.servingText).toBe('the whole dish');
  });

  it('records no weight for a dish nobody has weighed', () => {
    expect(mealHelping(DISH, 2)?.grams).toBeNull();
  });

  it('works a counted helping out in grams once the dish has been weighed', () => {
    // The plate was never on a scale, but the dish was, and 1,000g over four
    // servings says what two of them weigh.
    expect(mealHelping(WEIGHED, 2)?.grams).toBe(500);
    // Counting whole dishes counts whole dish weights.
    expect(mealHelping({ ...UNPORTIONED, cookedGrams: 800 }, 0.5)?.grams).toBe(400);
  });

  it('leaves a nutrient the dish never reported absent, never zero', () => {
    expect('fiberG' in (mealHelping(DISH, 1)?.amounts ?? {})).toBe(false);
  });

  it('answers nothing for a dish the rollup refused to measure', () => {
    // An offer built on nothing asks a question whose only answer is an empty
    // record.
    expect(mealHelping(null, 1)).toBeNull();
    expect(mealHelping({ total: {}, perServing: {}, servings: null, cookedGrams: null }, 1)).toBeNull();
  });

  it('refuses a helping of nothing', () => {
    expect(mealHelping(DISH, 0)).toBeNull();
    expect(mealHelping(DISH, -1)).toBeNull();
  });
});

describe('servingGrams', () => {
  it('divides the weighed dish by the servings it makes', () => {
    expect(servingGrams(WEIGHED)).toBe(250);
  });

  it('has no answer while either half is missing', () => {
    expect(servingGrams(DISH)).toBeNull();
    expect(servingGrams({ ...UNPORTIONED, cookedGrams: 800 })).toBeNull();
  });
});

describe('weighedHelping', () => {
  it('takes the fraction of the dish that was on the plate', () => {
    // 250g of a 1,000g dish is a quarter of it, whatever the recipe claims a
    // serving is.
    const helping = weighedHelping(WEIGHED, 250);
    expect(helping?.amounts.calorieKcal).toBe(300);
    expect(helping?.amounts.proteinG).toBe(10);
    expect(helping?.grams).toBe(250);
    expect(helping?.servingText).toBe('250 g');
  });

  it('measures a dish that never said how many servings it makes', () => {
    // The whole point: no servings count is needed, so a dish the servings
    // path can only log whole is logged by the plate.
    expect(weighedHelping({ ...UNPORTIONED, cookedGrams: 900 }, 300)?.amounts.calorieKcal).toBe(300);
  });

  it('scales the whole dish, never the per-serving figures', () => {
    // Reading perServing here would give 300 kcal for the whole dish.
    expect(weighedHelping(WEIGHED, 1000)?.amounts.calorieKcal).toBe(1200);
  });

  it('leaves a nutrient the dish never reported absent, never zero', () => {
    expect('fiberG' in (weighedHelping(WEIGHED, 250)?.amounts ?? {})).toBe(false);
  });

  it('has no answer for a dish nobody weighed', () => {
    expect(weighedHelping(DISH, 250)).toBeNull();
    expect(weighedHelping(null, 250)).toBeNull();
  });

  it('refuses a plate weighing nothing, or more than the dish it came off', () => {
    // 3200 for 320 is a typo, not a meal, and a helping three times the dish
    // is the write nothing downstream would ever question.
    expect(weighedHelping(WEIGHED, 0)).toBeNull();
    expect(weighedHelping(WEIGHED, -10)).toBeNull();
    expect(weighedHelping(WEIGHED, 3200)).toBeNull();
  });
});

describe('cookedDishGrams', () => {
  it('multiplies the as-written weight by what this cooking made', () => {
    expect(cookedDishGrams(725, 2)).toBe(1450);
    expect(cookedDishGrams(1000, 1)).toBe(1000);
    expect(cookedDishGrams(1000, 0.5)).toBe(500);
  });

  it('has no answer for a dish with no weight, or a scale of nothing', () => {
    expect(cookedDishGrams(null, 1)).toBeNull();
    expect(cookedDishGrams(0, 1)).toBeNull();
    expect(cookedDishGrams(1000, 0)).toBeNull();
  });

  it('round-trips what a scaled cooking weighed', () => {
    // Weighing a doubled batch at 1,450g stores 725 and reads back as 1,450.
    const stored = asWrittenCookedWeight(1450, 2);
    expect(stored).toBe(725);
    expect(cookedDishGrams(stored, 2)).toBe(1450);
  });
});

describe('clampCookedWeight', () => {
  it('takes a weight to the nearest gram', () => {
    expect(clampCookedWeight(1450.4)).toBe(1450);
  });

  it('reads nothing, nonsense and a dish weighing zero as no weight at all', () => {
    expect(clampCookedWeight(null)).toBeNull();
    expect(clampCookedWeight(0)).toBeNull();
    expect(clampCookedWeight(-5)).toBeNull();
    expect(clampCookedWeight(Number.NaN)).toBeNull();
  });

  it('holds a restored backup inside the range a kitchen can produce', () => {
    expect(clampCookedWeight(9_000_000)).toBe(50000);
  });
});

describe('describeHelping', () => {
  it('names the unit, because the number means two different things', () => {
    expect(describeHelping(2, true)).toBe('2 servings');
    expect(describeHelping(2, false)).toBe('2 of the dish');
  });

  it('has a word for half a dish', () => {
    expect(describeHelping(0.5, false)).toBe('half the dish');
  });

  it('does not write a whole number as a decimal', () => {
    expect(describeHelping(3, true)).toBe('3 servings');
  });
});

describe('defaultHelpings', () => {
  it('offers one, which is a serving or a dish depending on what the recipe said', () => {
    expect(defaultHelpings()).toBe(1);
  });
});
