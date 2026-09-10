import {
  isRecipeFieldMissing, isRecipeBackfillDismissed, recipeBackfillCandidates,
  recipeBackfillFieldCounts, dismissRecipeBackfillField, RECIPE_BACKFILL_FIELDS,
} from '../utils/recipeBackfill';
import type { Recipe } from '../types';

let seq = 0;
function makeRecipe(name: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: `r-${++seq}`,
    name,
    nameKey: name.toLowerCase(),
    notes: '',
    sourceUrl: null,
    sourceName: null,
    author: null,
    source: null,
    sourceType: null,
    sourcePage: null,
    cookbookId: null,
    servings: null,
    servingsMax: null,
    recipeYield: null,
    leftoverKeepDays: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients: [],
    emptySections: [],
    components: [],
    prepTasks: [],
    steps: [],
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
    backfillDismissedFields: [],
    ...overrides,
  };
}

const chili = makeRecipe('Chili');

describe('isRecipeFieldMissing', () => {
  it('treats a null servings count as missing', () => {
    expect(isRecipeFieldMissing(chili, 'servings')).toBe(true);
    expect(isRecipeFieldMissing({ ...chili, servings: 4 }, 'servings')).toBe(false);
  });

  // estimatedMinutes is cook time alone on a recipe, unlike a task's field of
  // the same name — see Recipe.estimatedMinutes.
  it('reads cook time off estimatedMinutes', () => {
    expect(isRecipeFieldMissing(chili, 'cookTime')).toBe(true);
    expect(isRecipeFieldMissing({ ...chili, estimatedMinutes: 45 }, 'cookTime')).toBe(false);
  });

  it('treats a null prep time as missing', () => {
    expect(isRecipeFieldMissing(chili, 'prepTime')).toBe(true);
    expect(isRecipeFieldMissing({ ...chili, prepMinutes: 15 }, 'prepTime')).toBe(false);
  });

  // A range is the top of a count that is already set, so it can never be the
  // thing that is missing — the same "meaningless until a sibling is set" rule
  // that kept autoSchedule off the project list.
  it('counts a recipe with servings but no range as answered', () => {
    expect(isRecipeFieldMissing({ ...chili, servings: 4, servingsMax: null }, 'servings')).toBe(false);
  });
});

describe('isRecipeBackfillDismissed', () => {
  it('is false until the field is on the list', () => {
    expect(isRecipeBackfillDismissed(chili, 'servings')).toBe(false);
    expect(isRecipeBackfillDismissed({ ...chili, backfillDismissedFields: ['servings'] }, 'servings')).toBe(true);
  });

  it('is scoped to the one field', () => {
    const recipe = { ...chili, backfillDismissedFields: ['servings'] };
    expect(isRecipeBackfillDismissed(recipe, 'cookTime')).toBe(false);
  });
});

describe('recipeBackfillCandidates', () => {
  it('includes every recipe missing the field, sorted by name', () => {
    const zucchini = makeRecipe('Zucchini fritters');
    const apple = makeRecipe('Apple crumble');
    expect(recipeBackfillCandidates([zucchini, apple], 'servings').map(r => r.name))
      .toEqual(['Apple crumble', 'Zucchini fritters']);
  });

  it('excludes a recipe that already has the field set', () => {
    const answered = makeRecipe('Chili', { servings: 6 });
    const open = makeRecipe('Dal');
    expect(recipeBackfillCandidates([answered, open], 'servings').map(r => r.name)).toEqual(['Dal']);
  });

  it('excludes a recipe dismissed for that field but not for another', () => {
    const recipe = makeRecipe('Chili', { backfillDismissedFields: ['servings'] });
    expect(recipeBackfillCandidates([recipe], 'servings')).toEqual([]);
    expect(recipeBackfillCandidates([recipe], 'cookTime')).toHaveLength(1);
  });
});

describe('recipeBackfillFieldCounts', () => {
  it('counts each field independently', () => {
    const recipes = [
      makeRecipe('A', { servings: 4 }),
      makeRecipe('B', { estimatedMinutes: 30 }),
    ];
    expect(recipeBackfillFieldCounts(recipes)).toEqual({ servings: 1, cookTime: 1, prepTime: 2 });
  });

  it('covers every declared backfillable field', () => {
    const counts = recipeBackfillFieldCounts([chili]);
    for (const field of RECIPE_BACKFILL_FIELDS) {
      expect(counts[field.id]).toBe(1);
    }
  });

  it('does not count a recipe dismissed for that field', () => {
    const recipe = makeRecipe('Chili', { backfillDismissedFields: ['prepTime'] });
    expect(recipeBackfillFieldCounts([recipe])).toEqual({ servings: 1, cookTime: 1, prepTime: 0 });
  });
});

describe('dismissRecipeBackfillField', () => {
  it('appends to whatever is already dismissed', () => {
    const recipe = makeRecipe('Chili', { backfillDismissedFields: ['cookTime'] });
    expect(dismissRecipeBackfillField(recipe, 'servings').backfillDismissedFields)
      .toEqual(['cookTime', 'servings']);
  });

  it('dismissing twice does not duplicate the entry', () => {
    const recipe = makeRecipe('Chili', { backfillDismissedFields: ['servings'] });
    expect(dismissRecipeBackfillField(recipe, 'servings').backfillDismissedFields).toEqual(['servings']);
  });
});
