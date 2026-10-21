import {
  referencePageNumber,
  importableReferences,
  coveredIngredients,
  seededComponentKeys,
  nextComponentPhotos,
  coveringComponentKeys,
  componentCommitFor,
  draftOfComponent,
  nestedComponentKey,
  isNestedComponentKey,
  applyComponentDraft,
  componentDraftChanged,
  type ComponentImportState,
  type ReferenceCandidate,
} from '../utils/recipeImportComponents';
import { makeComponent } from '../utils/recipeComponents';
import { MAX_RECIPE_PHOTOS, type RecipePhoto } from '../utils/recipePhoto';
import type { Recipe } from '../types';
import type { ExtractedRecipe, ExtractedRecipeReference, RecipeGroceryItem } from '../services/aiSuggestions';

// recipeUtils (the name lookup's home) reaches the settings store; nothing
// here reads a setting.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;

function recipe(id: string, name: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    backfillDismissedFields: [],
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
    emptyStepSections: [],
    components: [],
    blanks: [],
    prepTasks: [],
    steps: [],
    sortOrder: ++seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    servingsMax: null,
    recipeYield: null,
    cookedWeightG: null,
    leftoverKeepDays: null, ovenTemp: null, ovenTempUnit: 'F', ovenTempStepId: null,
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
    upNext: false,
    upNextOrder: 0,
  };
}

function ref(name: string, reference: string): ExtractedRecipeReference {
  return { name, reference };
}

function item(name: string): RecipeGroceryItem {
  return { name, quantity: '', aisle: 'Other', section: null, prep: null };
}

describe('referencePageNumber', () => {
  it('reads the page out of the locator the source wrote', () => {
    expect(referencePageNumber('page 45')).toBe('45');
    expect(referencePageNumber('Page 45')).toBe('45');
    expect(referencePageNumber('p. 212')).toBe('212');
    expect(referencePageNumber('p212')).toBe('212');
    expect(referencePageNumber('pg 7')).toBe('7');
    expect(referencePageNumber('see page 45 for the salsa')).toBe('45');
  });

  it('keeps a range that counts upward', () => {
    expect(referencePageNumber('pages 112-115')).toBe('112-115');
    expect(referencePageNumber('pages 112 – 115')).toBe('112-115');
  });

  it('takes only the first number when the "range" does not count upward', () => {
    // "45-2" is a typo or a hyphenated something-else, not pages 45 to 2.
    expect(referencePageNumber('page 45-2')).toBe('45');
  });

  it('returns null for a locator that names no page', () => {
    expect(referencePageNumber('opposite')).toBeNull();
    expect(referencePageNumber('see the sauces chapter')).toBeNull();
    expect(referencePageNumber('')).toBeNull();
  });
});

describe('importableReferences', () => {
  const salsa = recipe('salsa', 'Salsa verde');

  it('matches a reference to a recipe already in the box, however it is cased', () => {
    const [candidate] = importableReferences([ref('SALSA VERDE', 'page 45')], [salsa], null);
    expect(candidate.match).toBe(salsa);
    expect(candidate.key).toBe('salsa verde');
    expect(candidate.page).toBe('45');
  });

  it('matches the parent\'s own book when two books share the name', () => {
    const plenty = recipe('p', 'Salsa verde', { cookbookId: 'plenty' });
    const jerusalem = recipe('j', 'Salsa verde', { cookbookId: 'jerusalem' });
    const parent = recipe('parent', 'Roast chicken', { cookbookId: 'jerusalem' });
    const [candidate] = importableReferences([ref('Salsa verde', 'page 45')], [plenty, jerusalem, parent], parent);
    expect(candidate.match).toBe(jerusalem);
  });

  it('matches nothing rather than guessing between two other books', () => {
    const plenty = recipe('p', 'Salsa verde', { cookbookId: 'plenty' });
    const jerusalem = recipe('j', 'Salsa verde', { cookbookId: 'jerusalem' });
    const [candidate] = importableReferences([ref('Salsa verde', 'page 45')], [plenty, jerusalem], null);
    expect(candidate.match).toBeNull();
  });

  it('leaves match null for a recipe the box has never heard of', () => {
    const [candidate] = importableReferences([ref('Mexican rice', 'page 112')], [salsa], null);
    expect(candidate.match).toBeNull();
    expect(candidate.page).toBe('112');
  });

  it('keeps a reference whose locator is not a page, with no page on it', () => {
    const [candidate] = importableReferences([ref('Herb oil', 'opposite')], [], null);
    expect(candidate.page).toBeNull();
  });

  it('drops a second reference naming the same recipe', () => {
    const candidates = importableReferences(
      [ref('Salsa verde', 'page 45'), ref('salsa verde', 'p. 45')],
      [salsa],
      null,
    );
    expect(candidates).toHaveLength(1);
  });

  it('drops a reference to the recipe being imported into', () => {
    const tacos = recipe('tacos', 'Carnitas tacos');
    const candidates = importableReferences([ref('Carnitas tacos', 'page 12')], [tacos], tacos);
    expect(candidates).toEqual([]);
  });

  it('drops a reference to a component the recipe already has', () => {
    const tacos = recipe('tacos', 'Carnitas tacos', { components: [makeComponent(salsa)] });
    const candidates = importableReferences(
      [ref('Salsa verde', 'page 45')],
      [tacos, salsa],
      tacos,
    );
    expect(candidates).toEqual([]);
  });

  it('drops a reference whose link would be a cycle', () => {
    // The salsa already uses the tacos, so the tacos cannot also use the salsa.
    const tacos = recipe('tacos', 'Carnitas tacos');
    const cyclic = recipe('salsa', 'Salsa verde', { components: [makeComponent(tacos)] });
    const candidates = importableReferences(
      [ref('Salsa verde', 'page 45')],
      [tacos, cyclic],
      tacos,
    );
    expect(candidates).toEqual([]);
  });

  it('keeps every reference when there is no parent recipe yet', () => {
    const candidates = importableReferences(
      [ref('Salsa verde', 'page 45'), ref('Mexican rice', 'page 112')],
      [salsa],
      null,
    );
    expect(candidates.map(c => c.reference.name)).toEqual(['Salsa verde', 'Mexican rice']);
  });
});

describe('coveredIngredients', () => {
  const candidates = importableReferences(
    [ref('Salsa verde', 'page 45'), ref('Mexican rice', 'page 112')],
    [],
    null,
  );
  const ingredients = [item('pork shoulder'), item('salsa verde'), item('tortillas')];

  it('covers the ingredient line an accepted reference makes redundant', () => {
    const covered = coveredIngredients(ingredients, candidates, new Set(['salsa verde']));
    expect(covered.get(1)).toBe('Salsa verde');
    expect(covered.has(0)).toBe(false);
    expect(covered.has(2)).toBe(false);
  });

  it('names the line with the word the page that referenced it used', () => {
    const covered = coveredIngredients([item('SALSA VERDE')], candidates, new Set(['salsa verde']));
    expect(covered.get(0)).toBe('Salsa verde');
  });

  it('covers nothing while no reference is accepted', () => {
    expect(coveredIngredients(ingredients, candidates, new Set()).size).toBe(0);
  });

  it('covers nothing when the accepted reference has no line of its own', () => {
    // The rice was mentioned in the headnote, not bought as an ingredient.
    const covered = coveredIngredients(ingredients, candidates, new Set(['mexican rice']));
    expect(covered.size).toBe(0);
  });
});

// ─── the import sheet's rows ─────────────────────────────────────────────────

function candidate(name: string, match: Recipe | null = null): ReferenceCandidate {
  return { reference: ref(name, 'page 45'), key: name.toLowerCase(), match, page: '45' };
}

function extracted(name: string): ExtractedRecipe {
  return {
    name,
    servings: null,
    servingsMax: null,
    prepMinutes: null,
    recipeYield: null,
    leftoverKeepDays: null, ovenTemp: null, ovenTempUnit: 'F', ovenTempStep: null,
    ingredients: [],
    sourceTitle: null,
    sourceAuthor: null,
    sourcePage: null,
    sourceType: null,
    references: [],
    steps: [],
    prepTasks: [],
  };
}

function photo(n: number): RecipePhoto {
  return { base64: `p${n}`, mediaType: 'image/jpeg', width: 10, height: 10, sourceUri: `file:///p${n}.jpg` };
}

const readState = (name: string, photoCount = 1): Extract<ComponentImportState, { status: 'read' }> =>
  ({ status: 'read', extracted: extracted(name), photoCount });

describe('seededComponentKeys', () => {
  it('ticks a reference the box already holds and leaves one to photograph unticked', () => {
    const salsa = recipe('r1', 'Salsa verde');
    expect(seededComponentKeys([candidate('Salsa verde', salsa), candidate('Mash')])).toEqual(new Set(['salsa verde']));
  });
});

describe('nextComponentPhotos', () => {
  it('starts a one-photo set for a row with nothing read', () => {
    expect(nextComponentPhotos(undefined, undefined, photo(1))).toEqual([photo(1)]);
    expect(nextComponentPhotos({ status: 'idle' }, undefined, photo(1))).toEqual([photo(1)]);
  });

  it('adds a page to a row already read, rather than replacing it', () => {
    expect(nextComponentPhotos(readState('Mash'), [photo(1)], photo(2))).toEqual([photo(1), photo(2)]);
  });

  it('starts over after a failure, since there is nothing worth combining with', () => {
    expect(nextComponentPhotos({ status: 'failed', message: 'blurry' }, [photo(1)], photo(2))).toEqual([photo(2)]);
  });

  it('never grows past the cap', () => {
    const full = Array.from({ length: MAX_RECIPE_PHOTOS }, (_, i) => photo(i));
    expect(nextComponentPhotos(readState('Mash', full.length), full, photo(99))).toEqual(full);
  });
});

describe('coveringComponentKeys', () => {
  const salsa = recipe('r1', 'Salsa verde');
  const matched = candidate('Salsa verde', salsa);
  const mash = candidate('Mash');

  it('covers a ticked match, a ticked read and a ticked hand-pick', () => {
    expect(coveringComponentKeys([matched, mash], new Set(['salsa verde', 'mash']), { mash: readState('Mash') }))
      .toEqual(new Set(['salsa verde', 'mash']));
    expect(coveringComponentKeys([mash], new Set(['mash']), { mash: { status: 'linked', recipe: salsa } }))
      .toEqual(new Set(['mash']));
  });

  it('covers nothing for a ticked row with nothing read yet, however it is ticked', () => {
    expect(coveringComponentKeys([mash], new Set(['mash']), {})).toEqual(new Set());
    expect(coveringComponentKeys([mash], new Set(['mash']), { mash: { status: 'reading' } })).toEqual(new Set());
  });

  it('covers nothing for an unticked match', () => {
    expect(coveringComponentKeys([matched], new Set(), {})).toEqual(new Set());
  });
});

describe('componentCommitFor', () => {
  const salsa = recipe('r1', 'Salsa verde');

  it('writes nothing for an unticked row, whatever it holds', () => {
    expect(componentCommitFor(candidate('Salsa verde', salsa), new Set(), readState('Salsa verde'))).toEqual({ kind: 'skip' });
  });

  it('links the recipe the box matched, even over a read', () => {
    expect(componentCommitFor(candidate('Salsa verde', salsa), new Set(['salsa verde']), readState('Other')))
      .toEqual({ kind: 'link', recipeId: 'r1' });
  });

  it('links a recipe picked by hand', () => {
    expect(componentCommitFor(candidate('Mash'), new Set(['mash']), { status: 'linked', recipe: salsa }))
      .toEqual({ kind: 'link', recipeId: 'r1' });
  });

  it('creates a read recipe under the name the extraction gave, cleaned', () => {
    const state = readState('  Mashed   potatoes ');
    expect(componentCommitFor(candidate('Mash'), new Set(['mash']), state))
      .toEqual({ kind: 'create', name: 'Mashed potatoes', extracted: state.extracted });
  });

  it('falls back to the name the referencing page used when the read gave none', () => {
    expect(componentCommitFor(candidate('Mash'), new Set(['mash']), readState('')))
      .toMatchObject({ kind: 'create', name: 'Mash' });
  });

  it('writes nothing for a row with nothing read, or with no usable name either way', () => {
    expect(componentCommitFor(candidate('Mash'), new Set(['mash']), undefined)).toEqual({ kind: 'skip' });
    expect(componentCommitFor(candidate('Mash'), new Set(['mash']), { status: 'failed', message: 'blurry' }))
      .toEqual({ kind: 'skip' });
    expect(componentCommitFor(candidate('   '), new Set(['   ']), readState(''))).toEqual({ kind: 'skip' });
  });
});

describe('editing a read component', () => {
  const read = (): ExtractedRecipe => ({
    ...extracted('Shatta'),
    ingredients: [
      { name: 'chiles', quantity: '4 oz', aisle: 'Produce', section: null, prep: null, optional: false },
      { name: 'garlic', quantity: '3 cloves', aisle: 'Produce', section: null, prep: null, optional: false },
    ],
    steps: ['Toast the chiles.', 'Blend.'],
  });

  it('starts with everything kept, named by the read or else the referencing page', () => {
    const draft = draftOfComponent(read(), 'Hot sauce');
    expect(draft.name).toBe('Shatta');
    expect([...draft.acceptedIngredients]).toEqual([0, 1]);
    expect([...draft.acceptedSteps]).toEqual([0, 1]);
    expect(draftOfComponent({ ...read(), name: '' }, 'Hot sauce').name).toBe('Hot sauce');
  });

  it('is unchanged until something is edited, ticked off or renamed', () => {
    const base = read();
    expect(componentDraftChanged(base, draftOfComponent(base, 'x'), 'x')).toBe(false);
    const draft = draftOfComponent(base, 'x');
    expect(componentDraftChanged(base, { ...draft, name: ' Shatta ' }, 'x')).toBe(false);
    expect(componentDraftChanged(base, { ...draft, name: 'Green shatta' }, 'x')).toBe(true);
    expect(componentDraftChanged(base, { ...draft, acceptedSteps: new Set([0]) }, 'x')).toBe(true);
    expect(componentDraftChanged(base, { ...draft, steps: ['Toast the chiles.', 'Blend well.'] }, 'x')).toBe(true);
    const edited = draft.ingredients.map((r, i) => (i === 0 ? { ...r, quantity: '5 oz' } : r));
    expect(componentDraftChanged(base, { ...draft, ingredients: edited }, 'x')).toBe(true);
  });

  it('writes back the edited name and only the ticked lines, in order, leaving the rest of the read alone', () => {
    const base = { ...read(), servings: 4, prepMinutes: 10 };
    const draft = draftOfComponent(base, 'x');
    const result = applyComponentDraft(base, {
      ...draft,
      name: '  Green shatta ',
      ingredients: draft.ingredients.map((r, i) => (i === 1 ? { ...r, name: 'roasted garlic' } : r)),
      acceptedIngredients: new Set([1]),
      acceptedSteps: new Set([1]),
    });
    expect(result.name).toBe('Green shatta');
    expect(result.ingredients.map(r => r.name)).toEqual(['roasted garlic']);
    expect(result.steps).toEqual(['Blend.']);
    expect(result.servings).toBe(4);
    expect(result.prepMinutes).toBe(10);
  });
});

describe('nested component keys', () => {
  it('namespaces a reference by the component it was found on', () => {
    expect(nestedComponentKey('shatta', 'chile paste')).toBe('shatta>chile paste');
    expect(nestedComponentKey('shatta', 'chile paste')).not.toBe(nestedComponentKey('zhug', 'chile paste'));
  });

  it('tells a nested key from a top-level one, which is where nesting stops', () => {
    expect(isNestedComponentKey('shatta')).toBe(false);
    expect(isNestedComponentKey(nestedComponentKey('shatta', 'chile paste'))).toBe(true);
  });

  it('lets a nested candidate commit and cover ingredients like a top-level one', () => {
    const nested: ReferenceCandidate = { ...candidate('Chile paste'), key: nestedComponentKey('shatta', 'chile paste') };
    const state = readState('Chile paste');
    expect(componentCommitFor(nested, new Set([nested.key]), state)).toMatchObject({ kind: 'create', name: 'Chile paste' });
    expect(componentCommitFor(nested, new Set(), state)).toEqual({ kind: 'skip' });
    const lines = [{ name: 'chile paste', quantity: '2 tbsp', aisle: 'Pantry', section: null, prep: null, optional: false }];
    // The ingredient line is matched on the reference's own name, not on the namespaced key.
    expect([...coveredIngredients(lines, [nested], new Set([nested.key])).keys()]).toEqual([0]);
  });
});
