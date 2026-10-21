import { isCookingOil, oilCookedInPan, PAN_OIL_SHARE, panOilShare, stepsCookInPan } from '../utils/panOil';

const steps = (...texts: string[]) => texts.map(text => ({ text }));

describe('isCookingOil', () => {
  it.each([
    'oil', 'olive oil', 'Extra virgin olive oil', 'vegetable oil', 'Canola Oil', 'avocado oil', 'coconut oil',
  ])('says yes to %s', name => {
    expect(isCookingOil(name)).toBe(true);
  });

  it.each([
    'sun-dried tomatoes in oil', 'tuna in oil', 'sesame oil', 'butter', 'ghee', 'oil spray', 'olives', 'boil',
  ])('says no to %s', name => {
    expect(isCookingOil(name)).toBe(false);
  });
});

describe('stepsCookInPan', () => {
  it('is a yes when a step heats the oil in a pan', () => {
    expect(stepsCookInPan('olive oil', steps('Heat the oil in a large skillet over medium heat.'))).toBe(true);
  });

  it('is a yes for a sauté that never names the oil', () => {
    expect(stepsCookInPan('olive oil', steps('Sauté the onions until soft.', 'Add the garlic.'))).toBe(true);
  });

  it('is a no when the oil only goes into a dressing', () => {
    expect(stepsCookInPan('olive oil', steps('Whisk the oil into the lemon juice.', 'Toss with the greens.'))).toBe(false);
  });

  it('is a no when the oil is named in a step that does not cook it, even if another step sautés', () => {
    expect(stepsCookInPan('olive oil', steps('Drizzle the oil over the bread.', 'Sauté the mushrooms.'))).toBe(false);
  });

  it('is a no for deep frying, which is a different rule', () => {
    expect(stepsCookInPan('vegetable oil', steps('Heat the oil to 350F.', 'Deep fry the chicken in batches.'))).toBe(false);
  });

  it('is a no for a recipe with no steps at all', () => {
    expect(stepsCookInPan('olive oil', [])).toBe(false);
  });

  it('does not read brown sugar as browning', () => {
    expect(stepsCookInPan('olive oil', steps('Stir in the brown sugar and the oil.'))).toBe(false);
  });
});

describe('oilCookedInPan', () => {
  const sauté = steps('Heat the oil in a skillet.');

  it('is null for a line that is not a cooking oil', () => {
    expect(oilCookedInPan({ name: 'Butter' }, sauté)).toBeNull();
  });

  it('follows the steps until the person answers', () => {
    expect(oilCookedInPan({ name: 'Olive oil' }, sauté)).toBe(true);
    expect(oilCookedInPan({ name: 'Olive oil' }, steps('Drizzle the oil over the salad.'))).toBe(false);
  });

  it('lets an answer beat the steps in both directions', () => {
    expect(oilCookedInPan({ name: 'Olive oil', cookedInPan: false }, sauté)).toBe(false);
    expect(oilCookedInPan({ name: 'Olive oil', cookedInPan: true }, steps('Drizzle the oil over the salad.'))).toBe(true);
  });
});

describe('panOilShare', () => {
  it('is PAN_OIL_SHARE for a pan-cooked oil and 1 for everything else', () => {
    const sauté = steps('Heat the oil in a skillet.');
    expect(panOilShare({ name: 'Olive oil' }, sauté)).toBe(PAN_OIL_SHARE);
    expect(panOilShare({ name: 'Olive oil', cookedInPan: false }, sauté)).toBe(1);
    expect(panOilShare({ name: 'Butter' }, sauté)).toBe(1);
  });
});
