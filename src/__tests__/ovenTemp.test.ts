import { cleanOvenTemp, describeOvenTemp, ovenSetupsFor, ovenTempFor, parseOvenTemp } from '../utils/ovenTemp';
import { recipeMap } from '../utils/recipeComponents';
import type { Recipe, RecipeComponent } from '../types';

describe('cleanOvenTemp', () => {
  it('rounds and keeps a plausible setting', () => {
    expect(cleanOvenTemp(350.4, 'F')).toBe(350);
    expect(cleanOvenTemp(180, 'C')).toBe(180);
  });

  it('refuses what no oven does, in either unit', () => {
    expect(cleanOvenTemp(20, 'F')).toBeNull();
    expect(cleanOvenTemp(3500, 'F')).toBeNull();
    expect(cleanOvenTemp(350, 'C')).toBeNull();
    expect(cleanOvenTemp(NaN, 'F')).toBeNull();
    expect(cleanOvenTemp('350', 'F')).toBeNull();
  });
});

describe('parseOvenTemp', () => {
  it('reads the common spellings', () => {
    expect(parseOvenTemp('350°F')).toEqual({ degrees: 350, unit: 'F' });
    expect(parseOvenTemp('180 c')).toEqual({ degrees: 180, unit: 'C' });
    expect(parseOvenTemp('375 degrees F')).toEqual({ degrees: 375, unit: 'F' });
    expect(parseOvenTemp(' 400 ')).toEqual({ degrees: 400, unit: 'F' });
  });

  it('uses the fallback unit when none is written', () => {
    expect(parseOvenTemp('200', 'C')).toEqual({ degrees: 200, unit: 'C' });
  });

  it('declines text that is not a temperature', () => {
    expect(parseOvenTemp('')).toBeNull();
    expect(parseOvenTemp('bake')).toBeNull();
    expect(parseOvenTemp('20')).toBeNull();
    expect(parseOvenTemp('500°C')).toBeNull();
  });
});

describe('ovenTempFor', () => {
  const f350 = { ovenTemp: 350, ovenTempUnit: 'F' as const };
  const c180 = { ovenTemp: 180, ovenTempUnit: 'C' as const };

  it('is null without a temperature', () => {
    expect(ovenTempFor({ ovenTemp: null, ovenTempUnit: 'F' }, 'us')).toBeNull();
    expect(describeOvenTemp({ ovenTemp: null, ovenTempUnit: 'C' }, 'metric')).toBeNull();
  });

  it('keeps the written unit as written', () => {
    expect(ovenTempFor(f350, 'asWritten')).toEqual({ degrees: 350, unit: 'F', converted: false });
    expect(ovenTempFor(c180, 'asWritten')).toEqual({ degrees: 180, unit: 'C', converted: false });
  });

  it('does not touch a figure already in the wanted unit', () => {
    expect(ovenTempFor(f350, 'us')?.converted).toBe(false);
    expect(ovenTempFor(c180, 'metric')?.converted).toBe(false);
  });

  it('converts to the dial steps people actually use', () => {
    expect(describeOvenTemp(c180, 'us')).toBe('350°F');
    expect(describeOvenTemp({ ovenTemp: 200, ovenTempUnit: 'C' }, 'us')).toBe('400°F');
    expect(describeOvenTemp({ ovenTemp: 220, ovenTempUnit: 'C' }, 'us')).toBe('425°F');
    expect(describeOvenTemp(f350, 'metric')).toBe('180°C');
    expect(describeOvenTemp({ ovenTemp: 400, ovenTempUnit: 'F' }, 'metric')).toBe('200°C');
    expect(describeOvenTemp({ ovenTemp: 425, ovenTempUnit: 'F' }, 'metric')).toBe('220°C');
    expect(ovenTempFor(f350, 'metric')?.converted).toBe(true);
  });
});

describe('ovenSetupsFor', () => {
  const dish = (id: string, name: string, extra: Partial<Recipe> = {}): Recipe => ({
    id, name, components: [], ovenTemp: null, ovenTempUnit: 'F', ...extra,
  } as unknown as Recipe);
  const link = (recipeId: string, name: string): RecipeComponent =>
    ({ id: `link-${recipeId}`, recipeId, name, choiceGroup: null } as unknown as RecipeComponent);

  it('is empty for a recipe with no oven temperature', () => {
    const r = dish('r', 'Soup');
    expect(ovenSetupsFor(r, recipeMap([r]), 'us')).toEqual([]);
  });

  it('reads the recipe itself, converted for the reader', () => {
    const r = dish('r', 'Cake', { ovenTemp: 180, ovenTempUnit: 'C' });
    expect(ovenSetupsFor(r, recipeMap([r]), 'us')).toEqual([
      { recipeId: 'r', recipeName: 'Cake', whole: true, text: '350°F', converted: true, written: '180°C' },
    ]);
  });

  it('adds a component that has its own temperature, after the recipe', () => {
    const crust = dish('c', 'Pie crust', { ovenTemp: 375, ovenTempUnit: 'F' });
    const pie = dish('p', 'Pie', { ovenTemp: 350, ovenTempUnit: 'F', components: [link('c', 'Pie crust')] });
    const setups = ovenSetupsFor(pie, recipeMap([pie, crust]), 'asWritten');
    expect(setups.map(s => [s.recipeName, s.text, s.whole])).toEqual([
      ['Pie', '350°F', true],
      ['Pie crust', '375°F', false],
    ]);
  });
});
