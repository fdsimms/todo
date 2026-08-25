import {
  referencePageNumber,
  importableReferences,
  coveredIngredients,
} from '../utils/recipeImportComponents';
import { makeComponent } from '../utils/recipeComponents';
import type { Recipe } from '../types';
import type { ExtractedRecipeReference, RecipeGroceryItem } from '../services/aiSuggestions';

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
