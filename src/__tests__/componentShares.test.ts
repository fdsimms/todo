import type { Recipe, RecipeComponent } from '../types';
import { amountUsedCounts, componentShares, makesText, makesUnitsFor, splitMakes } from '../utils/componentShares';

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
    expect(makesUnitsFor('1 tbsp')).toEqual({ units: ['tsp', 'tbsp', 'cup', 'ml', 'l'], defaultUnit: 'cup' });
    expect(makesUnitsFor('30 ml')!.defaultUnit).toBe('ml');
    expect(makesUnitsFor('2 oz')).toEqual({ units: ['g', 'kg', 'oz', 'lb'], defaultUnit: 'oz' });
    expect(makesUnitsFor('2 fillets')).toEqual({ units: ['fillets'], defaultUnit: 'fillets' });
  });

  it('offers none when the amount names no unit', () => {
    expect(makesUnitsFor('1/4')).toBeNull();
    expect(makesUnitsFor('a pinch')).toBeNull();
  });

  it('writes a yield that always counts against the amount', () => {
    const mix = recipe('Mix');
    for (const unit of makesUnitsFor('1 tbsp')!.units) {
      expect(amountUsedCounts('1 tbsp', mix, makesText('3/4', unit))).toBe(true);
    }
    expect(amountUsedCounts('2 fillets', mix, makesText('4', 'fillets'))).toBe(true);
    expect(makesText('', 'cup')).toBeNull();
    expect(makesText('lots', 'cup')).toBeNull();
  });

  it('reads a saved yield back into the picker, or not at all', () => {
    const units = makesUnitsFor('1 tbsp')!.units;
    expect(splitMakes('3/4 cup', units)).toEqual({ number: '3/4', unit: 'cup' });
    expect(splitMakes('1 1/2 cups', units)).toEqual({ number: '1 1/2', unit: 'cup' });
    expect(splitMakes('4 servings', units)).toBeNull();
    expect(splitMakes(null, units)).toBeNull();
  });
});
