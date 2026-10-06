import type { FoodLogEntry } from '../types';
import {
  dayProduce,
  formatServings,
  produceKindOf,
  roundToHalf,
  servingsFromGrams,
} from '../utils/produceServings';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;

function entry(label: string, over: Partial<FoodLogEntry> = {}): FoodLogEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    dayKey: '2026-09-10',
    atISO: '2026-09-10T12:00:00.000Z',
    slot: 'lunch',
    label,
    recipeId: null,
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    quantity: '1 serving',
    grams: 80,
    nutrition: {
      basis: 'perServing',
      servingGrams: 80,
      servingText: null,
      amounts: { calorieKcal: 50, fiberG: 2 },
      portions: [],
      source: 'fdc',
      sourceId: null,
      recordedAt: '2026-09-10T12:00:00.000Z',
    },
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: '2026-09-10T12:00:00.000Z',
    ...over,
  };
}

describe('produceKindOf', () => {
  it.each([
    ['Broccoli', 'vegetable'],
    ['Cherry tomatoes', 'vegetable'],
    ['Red onion', 'vegetable'],
    ['Sweet potato', 'vegetable'],
    ['Bell pepper', 'vegetable'],
    ['Green beans', 'vegetable'],
    ['Peas', 'vegetable'],
    ['Banana', 'fruit'],
    ['Strawberries', 'fruit'],
    ['Avocado', 'fruit'],
    ['Dried apricots', 'dried'],
    ['Raisins', 'dried'],
    ['Black beans', 'legume'],
    ['Chickpeas', 'legume'],
    ['Red lentils', 'legume'],
    ['Split pea', 'legume'],
  ] as const)('reads %s as %s', (name, kind) => {
    expect(produceKindOf(name)).toBe(kind);
  });

  it.each([
    'Potato',
    'Baked potatoes',
    'Orange juice',
    'Tomato sauce',
    'French fries',
    'Strawberry jam',
    'Garlic',
    'Fresh basil',
    'Black pepper',
    'Jelly beans',
    'Chicken breast',
    'Rice',
  ])('does not count %s', name => {
    expect(produceKindOf(name)).toBeNull();
  });

  it.each(['Garden salad', 'Vegetable soup', 'Veggie stir fry', 'Fruit smoothie'])(
    'calls %s a mixed dish, whose split the name does not say',
    name => {
      expect(produceKindOf(name)).toBe('mixed');
    },
  );
});

describe('servingsFromGrams', () => {
  const none = { vegetable: 0, fruit: 0, dried: 0, legume: 0 };

  it('counts 80 g of either as one serving', () => {
    expect(servingsFromGrams({ ...none, vegetable: 160, fruit: 80 })).toEqual({ vegetable: 2, fruit: 1 });
  });

  it('counts 30 g of dried fruit as one fruit serving', () => {
    expect(servingsFromGrams({ ...none, dried: 60 }).fruit).toBe(2);
  });

  it('counts beans as a vegetable, but never for more than one serving a day', () => {
    expect(servingsFromGrams({ ...none, legume: 40 }).vegetable).toBe(0.5);
    expect(servingsFromGrams({ ...none, legume: 400, vegetable: 80 }).vegetable).toBe(2);
  });
});

describe('dayProduce', () => {
  it('adds grams across entries before turning them into servings', () => {
    const day = dayProduce([
      entry('Carrots', { grams: 40 }),
      entry('Spinach', { grams: 40 }),
      entry('Apple', { grams: 160 }),
    ]);
    expect(day).toEqual({ vegetable: 1, fruit: 2, unmeasured: 0 });
  });

  it('applies the bean cap across the whole day, not per entry', () => {
    const day = dayProduce([
      entry('Black beans', { grams: 160 }),
      entry('Lentils', { grams: 160 }),
    ]);
    expect(day.vegetable).toBe(1);
  });

  it('counts a food that is not produce as nothing, without calling it unmeasured', () => {
    expect(dayProduce([entry('Chicken breast'), entry('Rice')])).toEqual({ vegetable: 0, fruit: 0, unmeasured: 0 });
  });

  it('reports a produce food with no weight as unmeasured rather than as none', () => {
    const day = dayProduce([entry('Broccoli', { grams: null }), entry('Apple', { grams: 80 })]);
    expect(day).toEqual({ vegetable: 0, fruit: 1, unmeasured: 1 });
  });

  it('reports a mixed dish with no recipe as unmeasured', () => {
    expect(dayProduce([entry('Garden salad')]).unmeasured).toBe(1);
  });

  it('skips water and other nutrient-only entries', () => {
    const water = entry('Water', {
      slot: null,
      grams: null,
      nutrition: {
        basis: 'perServing',
        servingGrams: null,
        servingText: null,
        amounts: { waterMl: 1500 },
        portions: [],
        source: 'manual',
        sourceId: null,
        recordedAt: '2026-09-10T12:00:00.000Z',
      },
    });
    expect(dayProduce([water])).toEqual({ vegetable: 0, fruit: 0, unmeasured: 0 });
  });

  describe('a recipe entry', () => {
    const logged = entry('Stew', { recipeId: 'r1', quantity: '1 serving', grams: null });

    it('takes its grams from the resolver', () => {
      const day = dayProduce([logged], () => ({ vegetable: 160, fruit: 0, dried: 0, legume: 0 }));
      expect(day).toEqual({ vegetable: 2, fruit: 0, unmeasured: 0 });
    });

    it('is unmeasured when the resolver cannot say, and when there is no resolver', () => {
      expect(dayProduce([logged], () => null).unmeasured).toBe(1);
      expect(dayProduce([logged]).unmeasured).toBe(1);
    });
  });
});

describe('formatting', () => {
  it('rounds to the nearest half', () => {
    expect(roundToHalf(2.3)).toBe(2.5);
    expect(roundToHalf(2.2)).toBe(2);
    expect(roundToHalf(0.1)).toBe(0);
  });

  it('drops a trailing .0', () => {
    expect(formatServings(2)).toBe('2');
    expect(formatServings(2.6)).toBe('2.5');
    expect(formatServings(0)).toBe('0');
  });
});
