import {
  allRecipeTags,
  cleanRecipeTag,
  filterRecipesByTags,
  formatTagList,
  normalizeRecipeTags,
  parseRecipeTags,
  recipeTagCounts,
  toggleRecipeTag,
} from '../utils/recipeTags';
import { RECIPE_TAG_MAX_LENGTH } from '../types';
import type { Recipe } from '../types';

let seq = 0;
function recipe(name: string, tags: string[] = []): Recipe {
  return {
    id: `r-${++seq}`,
    name,
    nameKey: name.toLowerCase(),
    notes: '',
    sourceUrl: null,
    sourceName: null,
    author: null,
    source: null,
    servings: null,
    servingsMax: null,
    recipeYield: null,
    imagePath: null,
    mealType: null,
    tags,
    ingredients: [],
    components: [],
    prepTasks: [],
    favorite: false,
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
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
  };
}

describe('cleanRecipeTag', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(cleanRecipeTag('  Make   Ahead ')).toBe('make ahead');
  });

  it('is empty for nothing usable', () => {
    expect(cleanRecipeTag('')).toBe('');
    expect(cleanRecipeTag('   ')).toBe('');
    expect(cleanRecipeTag(null)).toBe('');
    expect(cleanRecipeTag(undefined)).toBe('');
  });

  it('caps length and re-trims what the cut leaves behind', () => {
    const long = `${'a'.repeat(RECIPE_TAG_MAX_LENGTH)}  tail`;
    expect(cleanRecipeTag(long)).toBe('a'.repeat(RECIPE_TAG_MAX_LENGTH));
    expect(cleanRecipeTag(`${'b'.repeat(RECIPE_TAG_MAX_LENGTH - 1)} cut`)).toBe('b'.repeat(RECIPE_TAG_MAX_LENGTH - 1));
  });
});

describe('normalizeRecipeTags', () => {
  it('cleans every entry and keeps first-seen order', () => {
    expect(normalizeRecipeTags([' Thai', 'Quick', 'weeknight'])).toEqual(['thai', 'quick', 'weeknight']);
  });

  it('de-duplicates on the cleaned spelling', () => {
    expect(normalizeRecipeTags(['Thai', 'thai', ' THAI '])).toEqual(['thai']);
  });

  it('drops anything that is not a usable string', () => {
    expect(normalizeRecipeTags(['ok', '', '  ', 3, null, undefined, { tag: 'no' }])).toEqual(['ok']);
  });

  it('reads a non-array as no tags', () => {
    expect(normalizeRecipeTags(null)).toEqual([]);
    expect(normalizeRecipeTags('thai')).toEqual([]);
    expect(normalizeRecipeTags(undefined)).toEqual([]);
  });
});

describe('parseRecipeTags', () => {
  it('reads a stored array', () => {
    expect(parseRecipeTags(JSON.stringify(['Thai', 'quick']))).toEqual(['thai', 'quick']);
  });

  it('tolerates a null column and a corrupt blob', () => {
    expect(parseRecipeTags(null)).toEqual([]);
    expect(parseRecipeTags('')).toEqual([]);
    expect(parseRecipeTags('{not json')).toEqual([]);
    expect(parseRecipeTags(JSON.stringify({ tags: ['thai'] }))).toEqual([]);
  });
});

describe('allRecipeTags', () => {
  it('is the union of every recipe, alphabetical', () => {
    const recipes = [recipe('A', ['thai', 'quick']), recipe('B', ['quick', 'braise'])];
    expect(allRecipeTags(recipes)).toEqual(['braise', 'quick', 'thai']);
  });

  it('is empty when nothing is tagged', () => {
    expect(allRecipeTags([recipe('A'), recipe('B')])).toEqual([]);
  });
});

describe('recipeTagCounts', () => {
  it('counts each recipe once per tag', () => {
    const counts = recipeTagCounts([
      recipe('A', ['thai', 'quick']),
      recipe('B', ['quick']),
      recipe('C'),
    ]);
    expect(counts.get('quick')).toBe(2);
    expect(counts.get('thai')).toBe(1);
    expect(counts.has('braise')).toBe(false);
  });
});

describe('filterRecipesByTags', () => {
  const thaiQuick = recipe('Larb', ['thai', 'quick']);
  const thai = recipe('Curry', ['thai']);
  const untagged = recipe('Toast');
  const recipes = [thaiQuick, thai, untagged];

  it('returns everything when nothing is selected', () => {
    expect(filterRecipesByTags(recipes, [])).toEqual(recipes);
  });

  it('narrows to the tag', () => {
    expect(filterRecipesByTags(recipes, ['thai']).map(r => r.name)).toEqual(['Larb', 'Curry']);
  });

  it('requires every selected tag, not any of them', () => {
    expect(filterRecipesByTags(recipes, ['thai', 'quick']).map(r => r.name)).toEqual(['Larb']);
  });

  it('cleans the selection, so a stray capital still matches', () => {
    expect(filterRecipesByTags(recipes, [' Thai ']).map(r => r.name)).toEqual(['Larb', 'Curry']);
  });

  it('is empty when no recipe carries the whole set', () => {
    expect(filterRecipesByTags(recipes, ['thai', 'grill'])).toEqual([]);
  });
});

describe('toggleRecipeTag', () => {
  it('adds a cleaned tag', () => {
    expect(toggleRecipeTag(['thai'], ' Quick ')).toEqual(['thai', 'quick']);
  });

  it('removes one already there', () => {
    expect(toggleRecipeTag(['thai', 'quick'], 'thai')).toEqual(['quick']);
  });

  it('does nothing for a name that cleans to nothing', () => {
    expect(toggleRecipeTag(['thai'], '   ')).toEqual(['thai']);
  });

  it('never mutates what it was given', () => {
    const tags = ['thai'];
    toggleRecipeTag(tags, 'quick');
    expect(tags).toEqual(['thai']);
  });
});

describe('formatTagList', () => {
  it('quotes one', () => {
    expect(formatTagList(['make ahead'])).toBe('“make ahead”');
  });

  it('joins two with and', () => {
    expect(formatTagList(['thai', 'quick'])).toBe('“thai” and “quick”');
  });

  it('commas the middle of three', () => {
    expect(formatTagList(['a', 'b', 'c'])).toBe('“a”, “b” and “c”');
  });

  it('is empty for none', () => {
    expect(formatTagList([])).toBe('');
  });
});
