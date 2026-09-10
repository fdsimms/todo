import {
  defaultHelpings,
  describeHelping,
  mealHelping,
  wantsMealLogPrompt,
  type DishFigures,
} from '../utils/mealLog';

const DISH: DishFigures = {
  total: { calorieKcal: 1200, proteinG: 40 },
  perServing: { calorieKcal: 300, proteinG: 10 },
};

const UNPORTIONED: DishFigures = {
  total: { calorieKcal: 900, proteinG: 30 },
  perServing: null,
};

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

  it('leaves a nutrient the dish never reported absent, never zero', () => {
    expect('fiberG' in (mealHelping(DISH, 1)?.amounts ?? {})).toBe(false);
  });

  it('answers nothing for a dish the rollup refused to measure', () => {
    // An offer built on nothing asks a question whose only answer is an empty
    // record.
    expect(mealHelping(null, 1)).toBeNull();
    expect(mealHelping({ total: {}, perServing: {} }, 1)).toBeNull();
  });

  it('refuses a helping of nothing', () => {
    expect(mealHelping(DISH, 0)).toBeNull();
    expect(mealHelping(DISH, -1)).toBeNull();
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
