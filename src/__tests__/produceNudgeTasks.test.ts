import type { FoodLogEntry, Recipe, RecipeIngredient } from '../types';
import {
  clampProduceNudgeFromHour,
  clampProduceNudgeGoal,
  DEFAULT_PRODUCE_NUDGE_FROM_HOUR,
  DEFAULT_PRODUCE_NUDGE_GOAL,
  describeProduceIdea,
  describeProduceNudgeHour,
  produceIdeas,
  produceNudgeApplies,
  produceNudgeNotes,
  produceNudgeTitle,
  produceReadingToday,
} from '../utils/produceNudgeTasks';
import { FREEZER_SECTION, kitchenEntryId, type KitchenEntry } from '../utils/kitchenInventory';

// Pure: the entries carry their own freshness, so no clock is read. The stub is
// for the settings store the date helpers behind the imports reach.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;

const food = (label: string, grams: number | null): FoodLogEntry =>
  ({ label, grams, recipeId: null, quantity: '', nutrition: { amounts: {} }, sourcePanel: null }) as unknown as FoodLogEntry;

const water = (): FoodLogEntry =>
  ({ label: 'Water', grams: null, recipeId: null, itemId: null, productId: null, quantity: '', nutrition: { amounts: { waterMl: 250 } }, sourcePanel: null }) as unknown as FoodLogEntry;

const at = (hour: number) => new Date(2026, 9, 5, hour, 30);

describe('produceReadingToday', () => {
  it('sums vegetable and fruit servings (80 g each)', () => {
    const reading = produceReadingToday([food('Spinach', 160), food('Banana', 80)]);
    expect(reading).toEqual({ servings: 3, unmeasured: 0 });
  });

  it('is null for an empty log, which is nothing to judge', () => {
    expect(produceReadingToday([])).toBeNull();
  });

  it('is null when the log holds only water', () => {
    expect(produceReadingToday([water()])).toBeNull();
  });

  it('counts a non-produce food as zero, and still judges the day', () => {
    expect(produceReadingToday([food('Toast', 60)])).toEqual({ servings: 0, unmeasured: 0 });
  });

  it('reports a produce food with no weight as unmeasured, not as none', () => {
    expect(produceReadingToday([food('Spinach', null)])).toEqual({ servings: 0, unmeasured: 1 });
  });
});

describe('produceNudgeApplies', () => {
  const low = { servings: 1.5, unmeasured: 0 };

  it('is true after the hour with servings under the goal', () => {
    expect(produceNudgeApplies(low, at(DEFAULT_PRODUCE_NUDGE_FROM_HOUR), DEFAULT_PRODUCE_NUDGE_FROM_HOUR, 4)).toBe(true);
  });

  it('waits for the hour', () => {
    expect(produceNudgeApplies(low, at(DEFAULT_PRODUCE_NUDGE_FROM_HOUR - 1), DEFAULT_PRODUCE_NUDGE_FROM_HOUR, 4)).toBe(false);
  });

  it('is false at or over the goal', () => {
    expect(produceNudgeApplies({ servings: 4, unmeasured: 0 }, at(18), 17, 4)).toBe(false);
    expect(produceNudgeApplies({ servings: 5, unmeasured: 0 }, at(18), 17, 4)).toBe(false);
  });

  it('judges on the half serving the title shows, so "4 of 4" never leaves a task standing', () => {
    expect(produceNudgeApplies({ servings: 3.8, unmeasured: 0 }, at(18), 17, 4)).toBe(false);
  });

  it('is false with no usable log', () => {
    expect(produceNudgeApplies(null, at(18))).toBe(false);
  });
});

describe('clamps and wording', () => {
  it('clamps the hour and the goal, and falls back on garbage', () => {
    expect(clampProduceNudgeFromHour(3)).toBe(12);
    expect(clampProduceNudgeFromHour(30)).toBe(21);
    expect(clampProduceNudgeFromHour(NaN)).toBe(DEFAULT_PRODUCE_NUDGE_FROM_HOUR);
    expect(clampProduceNudgeGoal(0)).toBe(1);
    expect(clampProduceNudgeGoal(99)).toBe(10);
    expect(clampProduceNudgeGoal(NaN)).toBe(DEFAULT_PRODUCE_NUDGE_GOAL);
  });

  it('describes the hour and the title', () => {
    expect(describeProduceNudgeHour(17)).toBe('5 PM');
    expect(describeProduceNudgeHour(12)).toBe('12 PM');
    expect(produceNudgeTitle(1.5, 4)).toBe('Add vegetables or fruit (1.5 of 4 servings logged)');
  });
});

function entry(title: string, overrides: Partial<KitchenEntry> = {}): KitchenEntry {
  seq += 1;
  return {
    id: kitchenEntryId('grocery', `gi-${seq}`),
    sourceId: `gi-${seq}`,
    kind: 'grocery',
    title,
    productName: null,
    itemId: null,
    section: 'Produce',
    useBy: '2026-10-20',
    freshness: 'fresh',
    daysLeft: 5,
    reason: '',
    useByCaption: '',
    caption: '',
    onList: false,
    matchKey: title.toLowerCase(),
    ...overrides,
  };
}

function ingredient(name: string): RecipeIngredient {
  seq += 1;
  return {
    id: `ri-${seq}`, name, nameKey: name.toLowerCase(), quantity: '', aisle: null, prep: null,
    purpose: null, section: null, choiceGroup: null, strict: false,
  } as RecipeIngredient;
}

function recipe(name: string, names: string[]): Recipe {
  seq += 1;
  return { id: `r-${seq}`, name, ingredients: names.map(ingredient), components: [] } as unknown as Recipe;
}

describe('produceIdeas', () => {
  it('suggests a recipe that uses produce on hand', () => {
    const ideas = produceIdeas([entry('Spinach')], [recipe('Saag', ['Spinach', 'Rice'])]);
    expect(ideas.map(i => i.recipe.name)).toEqual(['Saag']);
  });

  it('ignores a recipe whose only on-hand match is not produce', () => {
    expect(produceIdeas([entry('Cheese', { matchKey: 'cheese' })], [recipe('Bake', ['Cheese'])])).toEqual([]);
  });

  it('ranks by produce used, then frozen, then fewer ingredients', () => {
    const entries = [entry('Peas', { section: FREEZER_SECTION }), entry('Spinach'), entry('Carrot')];
    const ideas = produceIdeas(entries, [
      recipe('Carrot soup', ['Carrot']),
      recipe('Peas and spinach', ['Peas', 'Spinach', 'Rice', 'Stock']),
      recipe('Peas rice', ['Peas', 'Rice']),
      recipe('Spinach rice', ['Spinach', 'Rice']),
    ]);
    expect(ideas.map(i => i.recipe.name)).toEqual([
      'Peas and spinach', 'Peas rice', 'Carrot soup', 'Spinach rice',
    ]);
  });

  it('skips leftovers and produce past its use-by day', () => {
    const entries = [
      entry('Spinach', { freshness: 'over' }),
      entry('Carrot', { kind: 'leftover' }),
    ];
    expect(produceIdeas(entries, [recipe('Saag', ['Spinach']), recipe('Soup', ['Carrot'])])).toEqual([]);
  });

  it('returns nothing for an empty kitchen', () => {
    expect(produceIdeas([], [recipe('Saag', ['Spinach'])])).toEqual([]);
  });
});

describe('produceNudgeNotes', () => {
  it('names the source, and says when entries could not be weighed', () => {
    const notes = produceNudgeNotes({ servings: 1, unmeasured: 2 }, []);
    expect(notes).toContain('food log');
    expect(notes).toContain('2 entries could not be weighed');
  });

  it('adds up to two ideas, naming frozen produce as frozen', () => {
    const ideas = produceIdeas(
      [entry('Peas', { section: FREEZER_SECTION }), entry('Spinach')],
      [recipe('Peas and spinach', ['Peas', 'Spinach']), recipe('Saag', ['Spinach']), recipe('Peas rice', ['Peas'])],
    );
    const notes = produceNudgeNotes({ servings: 1, unmeasured: 0 }, ideas);
    expect(notes).toContain('Peas and spinach (uses frozen peas and spinach)');
    expect(notes.split('\n').filter(l => l.includes('(uses'))).toHaveLength(2);
    expect(describeProduceIdea(ideas[0])).toBe('Peas and spinach (uses frozen peas and spinach)');
  });
});
