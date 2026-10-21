import { DEEP_FRY_SHARE, fatCooking, isCookingFat, PAN_OIL_SHARE, panOilShare, stepsCookMethod } from '../utils/panOil';

const steps = (...texts: string[]) => texts.map(text => ({ text }));

describe('isCookingFat', () => {
  it.each([
    'oil', 'olive oil', 'Extra virgin olive oil', 'vegetable oil', 'Canola Oil', 'avocado oil', 'coconut oil',
    'butter', 'Unsalted butter', 'ghee', 'sesame oil', 'toasted sesame oil',
  ])('says yes to %s', name => {
    expect(isCookingFat(name)).toBe(true);
  });

  it.each([
    'sun-dried tomatoes in oil', 'tuna in oil', 'peanut butter', 'butter beans', 'oil spray', 'olives', 'boil',
  ])('says no to %s', name => {
    expect(isCookingFat(name)).toBe(false);
  });
});

describe('stepsCookMethod', () => {
  it('is a pan for butter melted in a skillet and nothing for butter creamed into a dough', () => {
    expect(stepsCookMethod('butter', steps('Melt the butter in a skillet, then add the mushrooms.'))).toBe('pan');
    expect(stepsCookMethod('butter', steps('Cream the butter and sugar.', 'Fold in the flour and bake.'))).toBeNull();
  });

  it('reads "the oil" as the sesame oil it names', () => {
    expect(stepsCookMethod('sesame oil', steps('Heat the oil in a wok.'))).toBe('pan');
  });

  it('is a pan when a step heats the oil in a pan', () => {
    expect(stepsCookMethod('olive oil', steps('Heat the oil in a large skillet over medium heat.'))).toBe('pan');
  });

  it('is a pan for a sauté that never names the oil', () => {
    expect(stepsCookMethod('olive oil', steps('Sauté the onions until soft.', 'Add the garlic.'))).toBe('pan');
  });

  it('is nothing when the oil only goes into a dressing', () => {
    expect(stepsCookMethod('olive oil', steps('Whisk the oil into the lemon juice.', 'Toss with the greens.'))).toBeNull();
  });

  it('is nothing when the oil is named in a step that does not cook it, even if another step sautés', () => {
    expect(stepsCookMethod('olive oil', steps('Drizzle the oil over the bread.', 'Sauté the mushrooms.'))).toBeNull();
  });

  it('is nothing for a recipe with no steps at all', () => {
    expect(stepsCookMethod('olive oil', [])).toBeNull();
  });

  it('does not read brown sugar as browning', () => {
    expect(stepsCookMethod('olive oil', steps('Stir in the brown sugar and the oil.'))).toBeNull();
  });

  it('is deep when the oil is heated to frying temperature, even if the deep fry step never names it', () => {
    expect(stepsCookMethod('vegetable oil', steps('Heat the oil to 350°F.', 'Fry the chicken in batches.'))).toBe('deep');
    expect(stepsCookMethod('vegetable oil', steps('Heat 2 inches of oil in a pot.', 'Lower in the fritters.'))).toBe('deep');
  });

  it('is deep for a recipe that deep fries and never names the oil', () => {
    expect(stepsCookMethod('vegetable oil', steps('Deep fry the chicken in batches.'))).toBe('deep');
  });

  it('keeps a sautéed olive oil a pan in a recipe that also deep fries in another oil', () => {
    const both = steps('Heat the olive oil in a skillet and sauté the onion.', 'Heat the vegetable oil to 350°F and deep fry the falafel.');
    expect(stepsCookMethod('olive oil', both)).toBe('pan');
    expect(stepsCookMethod('vegetable oil', both)).toBe('deep');
  });
});

describe('fatCooking', () => {
  const sauté = steps('Heat the oil in a skillet.');

  it('is null for a line that is not a cooking fat', () => {
    expect(fatCooking({ name: 'Peanut butter' }, sauté)).toBeNull();
  });

  it('follows the steps until the person answers', () => {
    expect(fatCooking({ name: 'Olive oil' }, sauté)).toMatchObject({ cooked: true, method: 'pan', share: PAN_OIL_SHARE });
    expect(fatCooking({ name: 'Olive oil' }, steps('Drizzle the oil over the salad.'))).toMatchObject({ cooked: false, share: 1 });
  });

  it('lets an answer beat the steps in both directions', () => {
    expect(fatCooking({ name: 'Olive oil', cookedInPan: false }, sauté)?.cooked).toBe(false);
    expect(fatCooking({ name: 'Olive oil', cookedInPan: true }, steps('Drizzle the oil over the salad.')))
      .toMatchObject({ cooked: true, method: 'pan', share: PAN_OIL_SHARE });
  });

  it('uses the deep fry share for a deep fried oil, and 1 once the person turns it off', () => {
    const fry = steps('Heat the oil to 350°F and deep fry the chicken.');
    expect(fatCooking({ name: 'Vegetable oil' }, fry)).toMatchObject({ cooked: true, method: 'deep', share: DEEP_FRY_SHARE });
    expect(fatCooking({ name: 'Vegetable oil', cookedInPan: false }, fry)).toMatchObject({ cooked: false, share: 1 });
  });
});

describe('panOilShare', () => {
  it('is the pan share, the deep fry share, or 1', () => {
    const sauté = steps('Heat the oil in a skillet.');
    expect(panOilShare({ name: 'Olive oil' }, sauté)).toBe(PAN_OIL_SHARE);
    expect(panOilShare({ name: 'Olive oil', cookedInPan: false }, sauté)).toBe(1);
    expect(panOilShare({ name: 'Vegetable oil' }, steps('Deep fry the fish.'))).toBe(DEEP_FRY_SHARE);
    expect(panOilShare({ name: 'Peanut butter' }, sauté)).toBe(1);
  });
});
