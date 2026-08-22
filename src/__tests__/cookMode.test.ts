import {
  clampStepIndex,
  cookSteps,
  describeStepPosition,
  stepsFromNotes,
} from '../utils/cookMode';
import { recipeMap } from '../utils/recipeComponents';
import type { Recipe, RecipeComponent, RecipeStep } from '../types';

let seq = 0;

function step(text: string): RecipeStep {
  return { id: `s-${++seq}`, text };
}

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
    favorite: false,
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

function link(recipeId: string, name: string, choiceGroup: string | null = null): RecipeComponent {
  return { id: `c-${++seq}`, recipeId, name, choiceGroup };
}

describe('stepsFromNotes', () => {
  it('is empty for a blank blob', () => {
    expect(stepsFromNotes('')).toEqual([]);
    expect(stepsFromNotes('   \n  \n ')).toEqual([]);
  });

  it('splits a blob with blank lines on the blank lines, keeping wrapped lines together', () => {
    const notes = [
      'Bring a large pot of salted water to a boil',
      'and add the potatoes.',
      '',
      'Drain, then mash with the butter.',
    ].join('\n');
    expect(stepsFromNotes(notes)).toEqual([
      'Bring a large pot of salted water to a boil\nand add the potatoes.',
      'Drain, then mash with the butter.',
    ]);
  });

  it('splits a blob with no blank lines on every newline', () => {
    expect(stepsFromNotes('Preheat the oven.\nSift the flour.\nBake for 20 minutes.')).toEqual([
      'Preheat the oven.',
      'Sift the flour.',
      'Bake for 20 minutes.',
    ]);
  });

  it('reads CRLF blank lines as blank lines rather than falling through to the newline split', () => {
    const notes = 'Sear the steak\r\nfor three minutes a side.\r\n\r\nRest it before slicing.';
    expect(stepsFromNotes(notes)).toEqual([
      'Sear the steak\r\nfor three minutes a side.',
      'Rest it before slicing.',
    ]);
  });

  it('never splits a blob with no line breaks — one step, sentences left alone', () => {
    const notes = 'Add 1.5 cups of stock. Simmer until reduced. Season to taste.';
    expect(stepsFromNotes(notes)).toEqual([notes]);
  });

  it('takes a leading enumerator off, since cook mode numbers the steps itself', () => {
    expect(
      stepsFromNotes('1. Preheat the oven.\n2) Sift the flour.\n(3) Bake.\nStep 4: Cool.\n- Serve.\n• Eat.')
    ).toEqual(['Preheat the oven.', 'Sift the flour.', 'Bake.', 'Cool.', 'Serve.', 'Eat.']);
  });

  it('leaves a leading number that is part of the instruction alone', () => {
    expect(stepsFromNotes('350 degrees, fan off.\n2 cups flour, sifted.\n1.5 cups of stock.')).toEqual([
      '350 degrees, fan off.',
      '2 cups flour, sifted.',
      '1.5 cups of stock.',
    ]);
  });

  it('refuses a strip that would leave nothing behind', () => {
    expect(stepsFromNotes('Preheat.\n1.')).toEqual(['Preheat.', '1.']);
  });
});

describe('cookSteps', () => {
  it('reads a plain recipe’s own steps in order', () => {
    const r = recipe('r1', 'Salmon', { steps: [step('Heat the pan'), step('Cook the fish')] });
    const out = cookSteps(r, recipeMap([r]));
    expect(out.map(s => s.text)).toEqual(['Heat the pan', 'Cook the fish']);
    expect(out.every(s => s.whole && !s.fromNotes)).toBe(true);
    expect(out.map(s => s.id)).toEqual(r.steps.map(s => s.id));
  });

  it('falls back to the notes blob for a recipe with no structured steps', () => {
    const r = recipe('r1', 'Steak', { notes: 'Get the pan hot.\nSear three minutes a side.' });
    const out = cookSteps(r, recipeMap([r]));
    expect(out.map(s => s.text)).toEqual(['Get the pan hot.', 'Sear three minutes a side.']);
    expect(out.every(s => s.fromNotes)).toBe(true);
    // Synthesized, and never a RecipeStep id — nothing writes these back.
    expect(out.map(s => s.id)).toEqual(['r1:notes:0', 'r1:notes:1']);
  });

  it('prefers structured steps over notes on the same recipe', () => {
    const r = recipe('r1', 'Steak', { notes: 'Old method blob.', steps: [step('Sear it')] });
    expect(cookSteps(r, recipeMap([r])).map(s => s.text)).toEqual(['Sear it']);
  });

  it('takes a component’s steps too, after the root’s, attributed to the component', () => {
    const mash = recipe('r2', 'Mashed potatoes', { steps: [step('Boil the potatoes')] });
    const steak = recipe('r1', 'Steak', {
      steps: [step('Sear the steak')],
      components: [link(mash.id, 'Mashed potatoes')],
    });
    const out = cookSteps(steak, recipeMap([steak, mash]));
    expect(out.map(s => s.text)).toEqual(['Sear the steak', 'Boil the potatoes']);
    expect(out.map(s => s.whole)).toEqual([true, false]);
    expect(out.map(s => s.recipe.name)).toEqual(['Steak', 'Mashed potatoes']);
  });

  it('falls back to notes per node, so a component with only notes still contributes', () => {
    const mash = recipe('r2', 'Mashed potatoes', { notes: 'Boil them.\nMash them.' });
    const steak = recipe('r1', 'Steak', {
      steps: [step('Sear the steak')],
      components: [link(mash.id, 'Mashed potatoes')],
    });
    const out = cookSteps(steak, recipeMap([steak, mash]));
    expect(out.map(s => s.text)).toEqual(['Sear the steak', 'Boil them.', 'Mash them.']);
    expect(out.map(s => s.fromNotes)).toEqual([false, true, true]);
  });

  it('reads only the chosen option of an either/or component', () => {
    const mash = recipe('r2', 'Mashed potatoes', { steps: [step('Boil the potatoes')] });
    const roast = recipe('r3', 'Roast potatoes', { steps: [step('Heat the oil')] });
    const steak = recipe('r1', 'Steak', {
      steps: [step('Sear the steak')],
      components: [link(mash.id, 'Mashed potatoes', 'Potatoes'), link(roast.id, 'Roast potatoes', 'Potatoes')],
    });
    const byId = recipeMap([steak, mash, roast]);
    // Unresolved reads the default — the group's first link in list order.
    expect(cookSteps(steak, byId).map(s => s.text)).toEqual(['Sear the steak', 'Boil the potatoes']);
    const chosen = { chosen: [steak.components[1].id] };
    expect(cookSteps(steak, byId, chosen).map(s => s.text)).toEqual(['Sear the steak', 'Heat the oil']);
  });

  it('is empty for a recipe with neither steps nor notes', () => {
    const r = recipe('r1', 'Nothing written down');
    expect(cookSteps(r, recipeMap([r]))).toEqual([]);
  });

  it('contributes a shared component once, not once per parent path', () => {
    const mash = recipe('r3', 'Mash', { steps: [step('Boil')] });
    const plate = recipe('r2', 'Plate', { steps: [step('Warm it')], components: [link(mash.id, 'Mash')] });
    const root = recipe('r1', 'Dinner', {
      steps: [step('Start')],
      components: [link(plate.id, 'Plate'), link(mash.id, 'Mash')],
    });
    expect(cookSteps(root, recipeMap([root, plate, mash])).map(s => s.text)).toEqual([
      'Start',
      'Warm it',
      'Boil',
    ]);
  });
});

describe('clampStepIndex', () => {
  it('is -1 for an empty method — the one case with no step to be on', () => {
    expect(clampStepIndex(0, 0)).toBe(-1);
    expect(clampStepIndex(3, 0)).toBe(-1);
  });

  it('pulls a stale index back onto the last step when the method shrinks', () => {
    expect(clampStepIndex(7, 3)).toBe(2);
  });

  it('floors a negative or non-finite index at the first step', () => {
    expect(clampStepIndex(-1, 3)).toBe(0);
    expect(clampStepIndex(NaN, 3)).toBe(0);
  });

  it('leaves an index already in range alone', () => {
    expect(clampStepIndex(1, 3)).toBe(1);
  });
});

describe('describeStepPosition', () => {
  it('counts from one, because the cook is being told where they are', () => {
    expect(describeStepPosition(0, 8)).toBe('Step 1 of 8');
    expect(describeStepPosition(2, 8)).toBe('Step 3 of 8');
  });

  it('clamps rather than reporting a step past the end', () => {
    expect(describeStepPosition(9, 3)).toBe('Step 3 of 3');
  });

  it('says nothing at all when there is no method', () => {
    expect(describeStepPosition(0, 0)).toBe('');
  });
});
