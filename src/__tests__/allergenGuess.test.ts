import { describeAllergens, guessAllergens } from '../utils/allergenGuess';

describe('guessAllergens', () => {
  it('finds the plain cases in a fixed order', () => {
    expect(guessAllergens(['orzo', 'feta', 'eggs', 'peanuts'])).toEqual(['milk', 'eggs', 'peanuts', 'wheat']);
  });

  it('does not take a plant milk, eggplant or butternut for the allergen', () => {
    expect(guessAllergens(['coconut milk', 'almond milk', 'eggplant', 'butternut squash', 'cocoa butter'])).toEqual(['tree nuts']);
  });

  it('does not count gluten-free or rice flours as wheat', () => {
    expect(guessAllergens(['rice noodles', 'almond flour', 'buckwheat'])).toEqual(['tree nuts']);
  });

  it('catches names that hide one', () => {
    expect(guessAllergens(['mayonnaise', 'Worcestershire sauce', 'tahini'])).toEqual(['eggs', 'fish', 'sesame']);
  });

  it('is empty when nothing is recognised', () => {
    expect(guessAllergens(['rice', 'cumin'])).toEqual([]);
  });
});

describe('describeAllergens', () => {
  it('words one, two and several', () => {
    expect(describeAllergens(['milk'])).toBe('Contains milk');
    expect(describeAllergens(['milk', 'eggs'])).toBe('Contains milk and eggs');
    expect(describeAllergens(['milk', 'eggs', 'wheat'])).toBe('Contains milk, eggs and wheat');
  });

  it('says nothing for none', () => {
    expect(describeAllergens([])).toBeNull();
  });
});
