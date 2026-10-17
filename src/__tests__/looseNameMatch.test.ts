import { looseNameWeight, LOOSE_NAME_WEIGHT } from '../utils/looseNameMatch';
import { recallWeight } from '../utils/foodRecall';
import { groceryNameKey } from '../utils/groceryParse';

describe('looseNameWeight', () => {
  it('sees past an amount, the word recipe and a letter swap', () => {
    expect(looseNameWeight("Roasted vegetables with za'atar", '122g of roasted vegetables with zataar recipe')).toBe(LOOSE_NAME_WEIGHT);
  });

  it('needs every identifying word of the name', () => {
    expect(looseNameWeight('Roasted vegetables with za’atar', 'roasted vegetables')).toBe(0);
  });

  it('matches short words exactly only', () => {
    expect(looseNameWeight('Fried rice', 'fried mice')).toBe(0);
  });

  it('leaves a one-word name to the containment rule', () => {
    expect(looseNameWeight('Chili', 'half my chili with rice')).toBe(0);
  });
});

describe('recallWeight with the loose fallback', () => {
  it('finds a recipe the plain comparison missed', () => {
    const label = groceryNameKey("Roasted vegetables with za'atar");
    const query = groceryNameKey('122g of roasted vegetables with zataar recipe');
    expect(recallWeight(label, query)).toBeGreaterThan(0);
  });

  it('keeps a direct hit above a loose one', () => {
    expect(recallWeight('overnight oats', 'overnight')).toBe(3);
  });
});
