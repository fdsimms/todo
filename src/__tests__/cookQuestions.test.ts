import {
  clampCookAnswer,
  COOK_ANSWER_MAX_CHARS,
  cookQuestionContext,
  suggestedCookQuestions,
} from '../utils/cookQuestions';
import type { CookStep } from '../utils/cookMode';
import type { FlatIngredient } from '../utils/recipeComponents';
import type { Recipe, RecipeIngredient } from '../types';

let seq = 0;

function recipe(id: string, name: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id,
    name,
    nameKey: name.toLowerCase(),
    notes: '',
    sourceUrl: null,
    sourceName: null,
    author: null,
    source: null,
    servings: null,
    mealType: null,
    tags: [],
    ingredients: [],
    emptySections: [],
    components: [],
    prepTasks: [],
    steps: [],
    sortOrder: ++seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    servingsMax: null,
    recipeYield: null,
    leftoverKeepDays: null,
    imagePath: null,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    sourceType: null,
    sourcePage: null,
    cookbookId: null,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
    ...overrides,
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
  };
}

const meal = recipe('r-meal', 'Steak and mash');
const mash = recipe('r-mash', 'Mashed potatoes');

function cookStep(text: string, overrides: Partial<CookStep> = {}): CookStep {
  return {
    id: `s-${++seq}`,
    text,
    recipe: meal,
    whole: true,
    fromNotes: false,
    note: null,
    ...overrides,
  };
}

function ing(name: string, quantity = '', swappedFrom?: string): FlatIngredient {
  const ingredient: RecipeIngredient = {
    id: `ing-${++seq}`,
    name,
    nameKey: name.toLowerCase(),
    quantity,
    aisle: null,
    prep: null,
    purpose: null,
    section: null,
    choiceGroup: null,
  };
  return { ingredient, recipe: meal, depth: 0, ...(swappedFrom ? { swappedFrom } : {}) };
}

describe('cookQuestionContext', () => {
  const steps = [
    cookStep('Preheat the oven to 400F.'),
    cookStep('Sear the steak three minutes a side.'),
    cookStep('Boil the potatoes until tender.', { recipe: mash, whole: false }),
  ];

  it('is null when there is no step at that index', () => {
    expect(cookQuestionContext('Steak and mash', steps, 9, [], 1, 'asWritten')).toBeNull();
    expect(cookQuestionContext('Steak and mash', [], 0, [], 1, 'asWritten')).toBeNull();
  });

  it('carries the step, its neighbours and a one-based position', () => {
    const context = cookQuestionContext('Steak and mash', steps, 1, [], 1, 'asWritten');
    expect(context).not.toBeNull();
    expect(context!.stepText).toBe('Sear the steak three minutes a side.');
    expect(context!.stepNumber).toBe(2);
    expect(context!.stepCount).toBe(3);
    expect(context!.previousStepText).toBe('Preheat the oven to 400F.');
    expect(context!.nextStepText).toBe('Boil the potatoes until tender.');
  });

  it('has no neighbours at either end', () => {
    const first = cookQuestionContext('Steak and mash', steps, 0, [], 1, 'asWritten');
    expect(first!.previousStepText).toBeNull();
    const last = cookQuestionContext('Steak and mash', steps, 2, [], 1, 'asWritten');
    expect(last!.nextStepText).toBeNull();
  });

  // The meal is what's being cooked whatever step is on screen; the component is
  // named only when the step belongs to one, the same distinction cook mode
  // draws on screen rather than inventing a schedule across the boundary.
  it('names the component a step belongs to, and nothing for the meal\'s own steps', () => {
    expect(cookQuestionContext('Steak and mash', steps, 0, [], 1, 'asWritten')!.componentName)
      .toBeNull();
    const fromComponent = cookQuestionContext('Steak and mash', steps, 2, [], 1, 'asWritten');
    expect(fromComponent!.componentName).toBe('Mashed potatoes');
    expect(fromComponent!.recipeName).toBe('Steak and mash');
  });

  it('scales an amount before converting it', () => {
    const context = cookQuestionContext(
      'Steak and mash', steps, 0, [ing('Butter', '2 cups')], 0.5, 'asWritten',
    );
    expect(context!.ingredients[0].quantity).toBe('1 cup');
    expect(context!.scale).toBe(0.5);
  });

  it('carries the amount in the unit system the cook is reading', () => {
    const context = cookQuestionContext(
      'Steak and mash', steps, 0, [ing('Milk', '2 cups')], 1, 'metric',
    );
    expect(context!.ingredients[0].quantity).toContain('ml');
    expect(context!.unitSystem).toBe('metric');
  });

  // A question about a sauce that won't thicken is unanswerable if the model
  // thinks the milk is dairy when the cook is holding oat milk.
  it('says when a standing swap rewrote a line', () => {
    const context = cookQuestionContext(
      'Steak and mash', steps, 0, [ing('Oat milk', '1 cup', 'Milk')], 1, 'asWritten',
    );
    expect(context!.ingredients[0].swappedFrom).toBe('Milk');
    expect(cookQuestionContext('Steak and mash', steps, 0, [ing('Milk')], 1, 'asWritten')!
      .ingredients[0].swappedFrom).toBeUndefined();
  });

  it('caps how much of a long ingredient list travels', () => {
    const many = Array.from({ length: 60 }, (_, i) => ing(`Thing ${i}`));
    const context = cookQuestionContext('Steak and mash', steps, 0, many, 1, 'asWritten');
    expect(context!.ingredients).toHaveLength(40);
  });
});

describe('suggestedCookQuestions', () => {
  it('always offers the two questions any step can raise', () => {
    expect(suggestedCookQuestions('Stir.', [])).toEqual([
      'How do I know when it\'s done?',
      'Can I do this part ahead?',
    ]);
  });

  it('offers a substitute question for an ingredient the step names', () => {
    expect(suggestedCookQuestions('Melt the butter in a pan.', ['Butter', 'Potatoes']))
      .toContain('What can I use instead of butter?');
  });

  it('says nothing about an ingredient the step does not name', () => {
    expect(suggestedCookQuestions('Drain the potatoes.', ['Butter'])).toHaveLength(2);
  });

  // The chip is only useful if it names the thing the cook is looking at.
  it('prefers the longest ingredient name that matches', () => {
    expect(suggestedCookQuestions('Cream the brown sugar in.', ['Sugar', 'Brown sugar']))
      .toContain('What can I use instead of brown sugar?');
  });

  it('matches whole words only', () => {
    expect(suggestedCookQuestions('Butterfly the chicken.', ['Butter'])).toHaveLength(2);
    expect(suggestedCookQuestions('Add the butter, melted.', ['Butter'])).toHaveLength(3);
  });

  // An ingredient name is user text, so it can hold anything a RegExp would
  // read as syntax.
  it('is not confused by punctuation in an ingredient name', () => {
    expect(suggestedCookQuestions('Add the half-and-half (warmed).', ['half-and-half']))
      .toContain('What can I use instead of half-and-half?');
    expect(() => suggestedCookQuestions('Stir.', ['(a+b)*'])).not.toThrow();
  });
});

describe('clampCookAnswer', () => {
  it('keeps a short answer as it came', () => {
    expect(clampCookAnswer('About four minutes a side.')).toBe('About four minutes a side.');
  });

  it('drops blank lines and trims what is left', () => {
    expect(clampCookAnswer('  Yes.  \n\n   Give it a minute more.  '))
      .toBe('Yes.\nGive it a minute more.');
  });

  it('keeps at most four lines', () => {
    const answer = clampCookAnswer(['one', 'two', 'three', 'four', 'five'].join('\n'));
    expect(answer.split('\n')).toEqual(['one', 'two', 'three', 'four']);
  });

  it('is empty when there was nothing to show', () => {
    expect(clampCookAnswer('   \n\n  ')).toBe('');
  });

  // The ceiling is the step-note cap, so what was read is exactly what Keep can
  // store — a second, smaller clamp in the store would file a shortened copy.
  it('cuts a runaway answer at a sentence end', () => {
    const long = `${'a'.repeat(COOK_ANSWER_MAX_CHARS - 60)}. ${'b'.repeat(120)}`;
    const answer = clampCookAnswer(long);
    expect(answer.length).toBeLessThanOrEqual(COOK_ANSWER_MAX_CHARS);
    expect(answer.endsWith('.')).toBe(true);
  });

  it('falls back to a word boundary with an ellipsis when there is no sentence end', () => {
    const answer = clampCookAnswer(`${'word '.repeat(200)}end`);
    expect(answer.length).toBeLessThanOrEqual(COOK_ANSWER_MAX_CHARS + 1);
    expect(answer.endsWith('…')).toBe(true);
    expect(answer.endsWith(' …')).toBe(false);
  });

  // Cutting a 500-character answer back to its first 40 because that is where
  // the one period was is worse than cutting it mid-word.
  it('ignores a sentence end too early to be worth cutting at', () => {
    const answer = clampCookAnswer(`No. ${'c'.repeat(COOK_ANSWER_MAX_CHARS + 100)}`);
    expect(answer.startsWith('No. c')).toBe(true);
    expect(answer.endsWith('…')).toBe(true);
  });
});
