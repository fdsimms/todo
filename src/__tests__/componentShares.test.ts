import type { Recipe, RecipeComponent } from '../types';
import { amountUnitsFor, amountUsedCounts, componentShares, makesUnitsFor } from '../utils/componentShares';
import { NO_UNIT, OTHER_UNIT, readAmount, writeAmount } from '../utils/amountUnit';

let seq = 0;

function recipe(name: string, overrides: Partial<Recipe> = {}): Recipe {
  return { id: `r-${++seq}`, name, ingredients: [], components: [], recipeYield: null, ...overrides } as Recipe;
}

function link(part: Recipe, overrides: Partial<RecipeComponent> = {}): RecipeComponent {
  return { id: `c-${++seq}`, recipeId: part.id, name: part.name, choiceGroup: null, ...overrides };
}

describe('componentShares', () => {
  it('reads a typed amount against what the part makes', () => {
    const mix = recipe('Mix', { recipeYield: '12 tbsp' });
    const dish = recipe('Dish', { components: [link(mix, { amountUsed: '3 tbsp' })] });
    expect(componentShares(dish, new Map([[mix.id, mix]])).get(mix.id)).toBeCloseTo(0.25, 5);
  });

  it('counts a part at the share of the link this cooking keeps', () => {
    const mix = recipe('Mix', { recipeYield: '12 tbsp' });
    const fries = recipe('Fries', { components: [link(mix, { amountUsed: '1 tbsp' })] });
    const wings = recipe('Wings', { components: [link(mix, { amountUsed: '6 tbsp' })] });
    const wingsLink = link(wings, { choiceGroup: 'Side' });
    const dinner = recipe('Dinner', { components: [link(fries, { choiceGroup: 'Side' }), wingsLink] });
    const byId = new Map([mix, fries, wings, dinner].map(r => [r.id, r]));
    expect(componentShares(dinner, byId).get(mix.id)).toBeCloseTo(1 / 12, 5);
    expect(componentShares(dinner, byId, { chosen: [wingsLink.id] }).get(mix.id)).toBeCloseTo(0.5, 5);
  });
});

describe('amountUsedCounts', () => {
  it('is true with nothing typed, or for a bare share of the batch', () => {
    expect(amountUsedCounts('', null)).toBe(true);
    expect(amountUsedCounts('1/4', recipe('Mix'))).toBe(true);
  });

  it('is false for an amount the part’s yield cannot be compared with', () => {
    expect(amountUsedCounts('1 tbsp', recipe('Mix'))).toBe(false);
    expect(amountUsedCounts('2 tbsp', recipe('Sauce', { recipeYield: '4 servings' }))).toBe(false);
    expect(amountUsedCounts('2 tbsp', recipe('Sauce', { recipeYield: '1 cup' }))).toBe(true);
  });

  it('reads a yield being typed in place of the saved one', () => {
    const mix = recipe('Mix');
    expect(amountUsedCounts('1 tbsp', mix, '3/4 cup')).toBe(true);
    expect(amountUsedCounts('1 tbsp', mix, '  ')).toBe(false);
  });
});

describe('the units "makes" is picked in', () => {
  it('offers the amount’s own dimension, starting on a sensible one', () => {
    expect(makesUnitsFor('1 tbsp')).toEqual(expect.objectContaining({
      units: ['tsp', 'tbsp', 'fl oz', 'cup', 'pint', 'quart', 'ml', 'liter'],
      defaultUnit: 'cup',
    }));
    expect(makesUnitsFor('30 ml')!.defaultUnit).toBe('ml');
    expect(makesUnitsFor('2 oz')).toEqual(expect.objectContaining({ units: ['g', 'kg', 'oz', 'lb'], defaultUnit: 'oz' }));
    expect(makesUnitsFor('2 fillets')).toEqual({ groups: [{ heading: null, units: ['fillets'] }], units: ['fillets'], defaultUnit: 'fillets' });
  });

  it('offers none when the amount names no unit', () => {
    expect(makesUnitsFor('1/4')).toBeNull();
    expect(makesUnitsFor('a pinch')).toBeNull();
  });

  it('writes a yield that always counts against the amount', () => {
    const mix = recipe('Mix');
    for (const amount of ['1 tbsp', '2 oz']) {
      for (const unit of makesUnitsFor(amount)!.units) {
        expect(amountUsedCounts(amount, mix, writeAmount('3/4', unit))).toBe(true);
      }
    }
    expect(amountUsedCounts('2 fillets', mix, writeAmount('4', 'fillets'))).toBe(true);
  });

  it('reads a saved yield back into the picker, or starts it empty', () => {
    const units = makesUnitsFor('1 tbsp')!.units;
    expect(readAmount('3/4 cup', units)).toEqual({ number: '3/4', unit: 'cup' });
    expect(readAmount('1 1/2 cups', units)).toEqual({ number: '1 1/2', unit: 'cup' });
    expect(readAmount('4 servings', units).number).toBe('');
    expect(readAmount('', units).number).toBe('');
  });
});

describe('the units "Amount used" is picked in', () => {
  it('offers a share of the batch, every volume and weight, and the part’s own count', () => {
    expect(amountUnitsFor(recipe('Mix')).units).toEqual([
      NO_UNIT, 'tsp', 'tbsp', 'fl oz', 'cup', 'pint', 'quart', 'ml', 'liter', 'g', 'kg', 'oz', 'lb', OTHER_UNIT,
    ]);
    expect(amountUnitsFor(recipe('Fish', { recipeYield: '4 fillets' })).units).toContain('fillets');
  });

  it('starts on a unit of the yield’s own kind, or on a share when there is no yield', () => {
    expect(amountUnitsFor(recipe('Mix')).defaultUnit).toBe(NO_UNIT);
    expect(amountUnitsFor(recipe('Mix', { recipeYield: '3/4 cup' })).defaultUnit).toBe('tbsp');
    expect(amountUnitsFor(recipe('Dough', { recipeYield: '900 g' })).defaultUnit).toBe('g');
    expect(amountUnitsFor(recipe('Fish', { recipeYield: '4 fillets' })).defaultUnit).toBe('fillets');
  });

  it('writes and reads back each kind of amount', () => {
    const units = amountUnitsFor(recipe('Fish', { recipeYield: '4 fillets' })).units;
    expect(writeAmount('1/4', NO_UNIT)).toBe('1/4');
    expect(writeAmount('1', 'tbsp')).toBe('1 tbsp');
    expect(writeAmount('2', 'fillets')).toBe('2 fillets');
    expect(writeAmount('', 'tbsp')).toBe('');
    expect(readAmount('1/4', units)).toEqual({ number: '1/4', unit: NO_UNIT });
    expect(readAmount('2 tbsp', units)).toEqual({ number: '2', unit: 'tbsp' });
    expect(readAmount('2 fillets', units)).toEqual({ number: '2', unit: 'fillets' });
    expect(readAmount('a pinch', units)).toEqual({ number: 'a pinch', unit: OTHER_UNIT });
  });

  it('counts a share of the batch, and an amount in the yield’s own count', () => {
    const fish = recipe('Fish', { recipeYield: '4 fillets' });
    expect(amountUsedCounts(writeAmount('1/4', NO_UNIT), recipe('Mix'))).toBe(true);
    expect(amountUsedCounts(writeAmount('2', 'fillets'), fish)).toBe(true);
  });
});
