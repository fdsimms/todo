import {
  DRINK_PRESETS,
  US_STANDARD_DRINK_G,
  alcoholGramsOf,
  dayAlcoholGrams,
  describeAlcoholGrams,
  describeDrinks,
  drinksFromGrams,
  gramsFromDrinks,
  healthDrinkCount,
  normalizeStandardDrinkGrams,
  presetForDrinks,
  stripZeroAlcohol,
  suggestDrinksForName,
  withAlcoholG,
} from '../utils/alcohol';
import type { FoodLogEntry, FoodNutrition, NutrientKey } from '../types';

function nutrition(amounts: Partial<Record<NutrientKey, number>>): FoodNutrition {
  return {
    basis: 'perServing',
    servingGrams: null,
    servingText: null,
    amounts,
    source: 'manual',
    sourceId: null,
    portions: [],
    recordedAt: '2026-09-10T12:00:00.000Z',
  };
}

function entryWith(amounts: Partial<Record<NutrientKey, number>>): FoodLogEntry {
  return { nutrition: nutrition(amounts) } as FoodLogEntry;
}

describe('drinks and grams', () => {
  it('converts both ways at the chosen size', () => {
    expect(gramsFromDrinks(1.5, 14)).toBe(21);
    expect(gramsFromDrinks(1, 8)).toBe(8);
    expect(drinksFromGrams(21, 14)).toBe(1.5);
  });

  it('words a count the way a person says it', () => {
    expect(describeDrinks(14, 14)).toBe('1 drink');
    expect(describeDrinks(21, 14)).toBe('1.5 drinks');
    expect(describeDrinks(28, 14)).toBe('2 drinks');
    expect(describeDrinks(13.9, 14)).toBe('1 drink');
    expect(describeDrinks(4.2, 14)).toBe('0.3 drinks');
    expect(describeDrinks(0, 14)).toBe('No drinks');
  });

  it('counts the same grams as more drinks at a smaller size', () => {
    expect(describeDrinks(14, 8)).toBe('1.8 drinks');
  });

  it('says the grams underneath', () => {
    expect(describeAlcoholGrams(14)).toBe('14 g of alcohol');
    expect(describeAlcoholGrams(13.94)).toBe('13.9 g of alcohol');
  });
});

describe('standard drink size', () => {
  it('accepts only the sizes on offer and reads anything else as US', () => {
    expect(normalizeStandardDrinkGrams(10)).toBe(10);
    expect(normalizeStandardDrinkGrams('8')).toBe(8);
    expect(normalizeStandardDrinkGrams('12')).toBe(US_STANDARD_DRINK_G);
    expect(normalizeStandardDrinkGrams(null)).toBe(US_STANDARD_DRINK_G);
    expect(normalizeStandardDrinkGrams(undefined)).toBe(US_STANDARD_DRINK_G);
  });
});

describe('what an entry states', () => {
  it('reads a figure, and treats absent and zero alike', () => {
    expect(alcoholGramsOf(nutrition({ alcoholG: 14 }))).toBe(14);
    expect(alcoholGramsOf(nutrition({ alcoholG: 0 }))).toBe(0);
    expect(alcoholGramsOf(nutrition({}))).toBe(0);
    expect(alcoholGramsOf(null)).toBe(0);
  });

  it('ignores a figure that is not a usable number', () => {
    expect(alcoholGramsOf(nutrition({ alcoholG: -3 }))).toBe(0);
    expect(alcoholGramsOf(nutrition({ alcoholG: NaN }))).toBe(0);
  });

  it('totals a day over the entries that state it', () => {
    expect(dayAlcoholGrams([entryWith({ alcoholG: 14 }), entryWith({}), entryWith({ alcoholG: 7.5 })])).toBe(21.5);
    expect(dayAlcoholGrams([])).toBe(0);
  });
});

describe('withAlcoholG', () => {
  it('sets the figure, leaving every other one alone', () => {
    const next = withAlcoholG(nutrition({ calorieKcal: 150 }), 14);
    expect(next.amounts).toEqual({ calorieKcal: 150, alcoholG: 14 });
  });

  it('removes it at zero', () => {
    const next = withAlcoholG(nutrition({ calorieKcal: 150, alcoholG: 14 }), 0);
    expect(next.amounts).toEqual({ calorieKcal: 150 });
    expect('alcoholG' in next.amounts).toBe(false);
  });

  it('returns the same object when nothing changes', () => {
    const plain = nutrition({ calorieKcal: 150 });
    expect(withAlcoholG(plain, 0)).toBe(plain);
    const stated = nutrition({ alcoholG: 14 });
    expect(withAlcoholG(stated, 14)).toBe(stated);
  });

  it('does not change the object it was given', () => {
    const plain = nutrition({ calorieKcal: 150 });
    withAlcoholG(plain, 14);
    expect(plain.amounts).toEqual({ calorieKcal: 150 });
  });
});

describe('drink presets', () => {
  it('finds the preset a count matches, and none when the stepper moved off them', () => {
    expect(presetForDrinks(1.5)).toBe('cocktail');
    expect(presetForDrinks(2)).toBe('bigPour');
    expect(presetForDrinks(3)).toBeNull();
  });

  it('counts in the US size every preset is defined against', () => {
    for (const preset of DRINK_PRESETS) expect(preset.drinks % 0.5).toBe(0);
  });
});

describe('suggestDrinksForName', () => {
  it('knows a drink by its name', () => {
    expect(suggestDrinksForName('IPA')).toBe(1);
    expect(suggestDrinksForName('Red wine')).toBe(1);
    expect(suggestDrinksForName('Pale ale')).toBe(1);
    expect(suggestDrinksForName('Margarita')).toBe(1.5);
    expect(suggestDrinksForName('Piña colada')).toBe(1.5);
    expect(suggestDrinksForName('Pina colada')).toBe(1.5);
    expect(suggestDrinksForName('Old Fashioned')).toBe(1.5);
  });

  it('matches whole words only', () => {
    expect(suggestDrinksForName('Kale salad')).toBeNull();
    expect(suggestDrinksForName('Scale')).toBeNull();
    expect(suggestDrinksForName('Ginger')).toBeNull();
  });

  it('leaves out what has the word and no alcohol', () => {
    expect(suggestDrinksForName('Root beer')).toBeNull();
    expect(suggestDrinksForName('Ginger beer')).toBeNull();
    expect(suggestDrinksForName('Ginger ale')).toBeNull();
    expect(suggestDrinksForName('Non-alcoholic beer')).toBeNull();
    expect(suggestDrinksForName('Alcohol free wine')).toBeNull();
    expect(suggestDrinksForName('Wine vinegar')).toBeNull();
    expect(suggestDrinksForName('Rum raisin ice cream')).toBeNull();
    expect(suggestDrinksForName('Beer battered fish')).toBeNull();
  });
});

describe('what Apple Health is told', () => {
  it('is a count of US drinks whatever size the app shows', () => {
    expect(healthDrinkCount(14)).toBe(1);
    expect(healthDrinkCount(21)).toBe(1.5);
    expect(healthDrinkCount(8)).toBe(0.57);
  });
});

describe('stripZeroAlcohol', () => {
  it('drops a stated zero and keeps a figure', () => {
    const zero: Partial<Record<NutrientKey, number>> = { calorieKcal: 300, alcoholG: 0 };
    stripZeroAlcohol(zero);
    expect(zero).toEqual({ calorieKcal: 300 });
    const some: Partial<Record<NutrientKey, number>> = { alcoholG: 14 };
    stripZeroAlcohol(some);
    expect(some).toEqual({ alcoholG: 14 });
  });
});
