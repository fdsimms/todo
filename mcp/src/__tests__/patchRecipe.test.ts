/**
 * `patch_recipe` against a real database: small edits that keep every line the
 * call did not name (same ids, so a planned meal's pick and a step's onlyWhen
 * still point at them), refuse a stale reading, and land all or nothing.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { patchRecipe, saveRecipe, updateRecipe } from '../logTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

let replica: ReturnType<typeof openReplica>;

beforeAll(() => {
  replica = openReplica(':memory:');
});

beforeEach(() => {
  mockRaw.runSync('DELETE FROM recipes');
  mockRaw.runSync('DELETE FROM cookbooks');
  replica.refresh();
});

const stored = (id: string) => replica.recipes().find(r => r.id === id)!;

const salsa = () => saveRecipe(replica, {
  name: 'Salsa',
  ingredients: [
    { text: '1 serrano chile', alternativeGroup: 'Chile' },
    { text: '1 jalapeno', alternativeGroup: 'Chile' },
    { text: '1 tsp salt' },
  ],
  steps: [
    { text: 'Chop the chile.', section: 'Prep' },
    { text: 'Mix everything.', section: 'Prep' },
    { text: 'Serve.' },
  ],
});

describe('patch_recipe: steps', () => {
  it('sets and clears a note on one step, leaving every id alone', () => {
    const r = salsa();
    const ids = stored(r.id).steps.map(s => s.id);
    const out = patchRecipe(replica, r.id, [{ op: 'setStepNote', step: 3, expect: 'serve', note: 'Warm the chips.' }]);
    expect(out.steps[2].note).toBe('Warm the chips.');
    expect(stored(r.id).steps.map(s => s.id)).toEqual(ids);
    patchRecipe(replica, r.id, [{ op: 'setStepNote', step: 3, note: null }]);
    expect(stored(r.id).steps[2].note).toBeUndefined();
  });

  it('inserts a step in the middle of a section, keeping its neighbors and the section', () => {
    const r = salsa();
    const before = stored(r.id).steps.map(s => s.id);
    patchRecipe(replica, r.id, [{ op: 'insertStep', at: 2, text: 'Seed the chile.' }]);
    const steps = stored(r.id).steps;
    expect(steps.map(s => s.text)).toEqual(['Chop the chile.', 'Seed the chile.', 'Mix everything.', 'Serve.']);
    expect(steps[1].section).toBe('Prep');
    expect([steps[0].id, steps[2].id, steps[3].id]).toEqual(before);
  });

  it('rewords a step without losing its timer or note, and removes one', () => {
    const r = salsa();
    patchRecipe(replica, r.id, [{ op: 'setStepNote', step: 2, note: 'Pulse, do not blend.' }]);
    const id = stored(r.id).steps[1].id;
    patchRecipe(replica, r.id, [
      { op: 'replaceStep', step: 2, expect: 'mix', text: 'Stir everything together.' },
      { op: 'removeStep', step: 3, expect: 'serve' },
    ]);
    const steps = stored(r.id).steps;
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ id, text: 'Stir everything together.', note: 'Pulse, do not blend.' });
  });

  it('ties a step to an either/or option by name, and shows it on get_recipe', () => {
    const r = salsa();
    const out = patchRecipe(replica, r.id, [
      { op: 'insertStep', at: 2, text: 'Halve and seed the jalapeno.', onlyWith: ['Jalapeno'] },
    ]);
    const jalapeno = stored(r.id).ingredients.find(i => i.name === 'jalapeno')!;
    expect(stored(r.id).steps[1].onlyWhen).toEqual([jalapeno.id]);
    expect(out.steps[1].onlyWith).toEqual(['jalapeno']);
    expect(out.steps[0].onlyWith).toBeUndefined();

    patchRecipe(replica, r.id, [{ op: 'setStepOnlyWith', step: 2, onlyWith: null }]);
    expect(stored(r.id).steps[1].onlyWhen).toBeUndefined();
  });

  it('refuses an option name the recipe does not have, listing the ones it does', () => {
    const r = salsa();
    expect(() => patchRecipe(replica, r.id, [{ op: 'setStepOnlyWith', step: 1, onlyWith: ['habanero'] }]))
      .toThrow(/not an either\/or option.*serrano chile, jalapeno/);
    const plain = saveRecipe(replica, { name: 'Toast', steps: [{ text: 'Toast it.' }] });
    expect(() => patchRecipe(replica, plain.id, [{ op: 'setStepOnlyWith', step: 1, onlyWith: ['rye'] }]))
      .toThrow(/has none/);
  });
});

describe('patch_recipe: ingredients', () => {
  it('inserts at a position without touching the other lines\' ids', () => {
    const r = salsa();
    const before = stored(r.id).ingredients.map(i => i.id);
    patchRecipe(replica, r.id, [{ op: 'insertIngredient', at: 3, text: '2 limes, juiced' }]);
    const list = stored(r.id).ingredients;
    expect(list.map(i => i.name)).toEqual(['serrano chile', 'jalapeno', 'limes', 'salt']);
    expect([list[0].id, list[1].id, list[3].id]).toEqual(before);
  });

  it('replaces a line in place, keeping its id and either/or group', () => {
    const r = salsa();
    const id = stored(r.id).ingredients[1].id;
    patchRecipe(replica, r.id, [{ op: 'replaceIngredient', ingredient: 2, expect: 'jalapeno', text: '2 poblano peppers' }]);
    const line = stored(r.id).ingredients[1];
    expect(line).toMatchObject({ id, name: 'poblano peppers', quantity: '2', choiceGroup: 'Chile' });
  });

  it('removes a line, and refuses a duplicate insert', () => {
    const r = salsa();
    patchRecipe(replica, r.id, [{ op: 'removeIngredient', ingredient: 3, expect: 'salt' }]);
    expect(stored(r.id).ingredients).toHaveLength(2);
    expect(() => patchRecipe(replica, r.id, [{ op: 'insertIngredient', at: 1, text: '1 jalapeno' }]))
      .toThrow(/already in the recipe/);
  });
});

describe('patch_recipe: refusals', () => {
  it('refuses a stale reading and writes none of the call', () => {
    const r = salsa();
    expect(() => patchRecipe(replica, r.id, [
      { op: 'setStepNote', step: 1, note: 'Should not land.' },
      { op: 'removeStep', step: 2, expect: 'serve' },
    ])).toThrow(/Change 2 \(removeStep\).*does not contain "serve"/);
    expect(stored(r.id).steps).toHaveLength(3);
    expect(stored(r.id).steps[0].note).toBeUndefined();
  });

  it('refuses a number out of range, a missing text, and an empty call', () => {
    const r = salsa();
    expect(() => patchRecipe(replica, r.id, [{ op: 'removeStep', step: 9 }])).toThrow(/Step 9 is out of range: the recipe has 3/);
    expect(() => patchRecipe(replica, r.id, [{ op: 'insertStep', at: 5, text: 'x' }])).toThrow(/Position 5 is out of range/);
    expect(() => patchRecipe(replica, r.id, [{ op: 'replaceStep', step: 1 }])).toThrow(/replaceStep needs text/);
    expect(() => patchRecipe(replica, r.id, [])).toThrow(/at least one change/);
    expect(() => patchRecipe(replica, 'nope', [{ op: 'removeStep', step: 1 }])).toThrow(/No recipe with id nope/);
  });

  it('applies each change to the recipe as the earlier ones left it', () => {
    const r = salsa();
    patchRecipe(replica, r.id, [
      { op: 'insertStep', at: 1, text: 'Wash the chile.' },
      { op: 'setStepNote', step: 2, expect: 'chop', note: 'Wear gloves.' },
    ]);
    expect(stored(r.id).steps[1]).toMatchObject({ text: 'Chop the chile.', note: 'Wear gloves.' });
  });
});

describe('update_recipe and line identity', () => {
  it('keeps the id of a line that is still wanted, so picks and replacements still point at it', () => {
    const r = salsa();
    const before = stored(r.id).ingredients;
    updateRecipe(replica, r.id, {
      ingredients: [
        { text: '1 serrano chile', alternativeGroup: 'Chile' },
        { text: '2 jalapeno', alternativeGroup: 'Chile' },
        { text: '1 lime' },
      ],
    });
    const after = stored(r.id).ingredients;
    expect(after.map(i => i.name)).toEqual(['serrano chile', 'jalapeno', 'lime']);
    // The unchanged line and the one whose amount changed keep their ids.
    expect(after[0].id).toBe(before[0].id);
    expect(after[1].id).toBe(before[1].id);
    expect(after[1].quantity).toBe('2');
    // A line the call dropped is gone and a new one has a new id.
    expect(before.map(i => i.id)).not.toContain(after[2].id);
  });
});

describe('update_recipe and conditional steps', () => {
  it('lets save_recipe write a conditional step by option name', () => {
    const r = saveRecipe(replica, {
      name: 'Rice bowl',
      ingredients: [{ text: '1 cup rice', alternativeGroup: 'Base' }, { text: '1 cup quinoa', alternativeGroup: 'Base' }],
      steps: [{ text: 'Rinse the quinoa.', onlyWith: ['quinoa'] }, { text: 'Serve.' }],
    });
    const quinoa = stored(r.id).ingredients.find(i => i.name === 'quinoa')!;
    expect(stored(r.id).steps[0].onlyWhen).toEqual([quinoa.id]);
  });

  it('leaves a step\'s option pointing at the same line after an ingredient rewrite', () => {
    const r = salsa();
    patchRecipe(replica, r.id, [{ op: 'setStepOnlyWith', step: 1, onlyWith: ['jalapeno'] }]);
    const before = stored(r.id).ingredients.find(i => i.name === 'jalapeno')!.id;
    updateRecipe(replica, r.id, {
      ingredients: [
        { text: '1 serrano chile', alternativeGroup: 'Chile' },
        { text: '1 jalapeno', alternativeGroup: 'Chile' },
        { text: '1 tsp salt' },
      ],
    });
    expect(stored(r.id).ingredients.find(i => i.name === 'jalapeno')!.id).toBe(before);
    expect(stored(r.id).steps[0].onlyWhen).toEqual([before]);
  });
});
