import type { Cookbook, Recipe } from '../types';
import {
  COOKBOOK_LINK_LIMIT,
  compareCookbookRecipes,
  cookbookLinkCandidates,
  cookbookLinkEffect,
  cookbookLinkPrompt,
  cookbookPageKey,
  pageAfterCookbookLink,
  recipesInCookbook,
} from '../utils/cookbookRecipes';

/** A local wall-clock time as the ISO instant the app stores. */
const localIso = (local: string) => new Date(local).toISOString();

// recipeUtils reaches the settings store through mealPlan.ts; nothing here
// needs it. Same mock as recipeUtils.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;

function recipe(name: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    backfillDismissedFields: [],
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
    cookedWeightG: null,
    leftoverKeepDays: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients: [],
    emptySections: [],
    emptyStepSections: [],
    components: [],
    prepTasks: [],
    steps: [],
    sortOrder: seq,
    createdAt: localIso('2026-01-01T00:00'),
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
    upNext: false,
    upNextOrder: 0,
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
  };
}

function book(id: string, title: string, author: string | null = null): Cookbook {
  return { id, title, titleKey: title.toLowerCase(), author, sortOrder: 1, createdAt: localIso('2026-01-01T00:00') };
}

const jerusalem = book('b-jer', 'Jerusalem', 'Yotam Ottolenghi');
const plenty = book('b-plenty', 'Plenty', 'Yotam Ottolenghi');
const shelf = [jerusalem, plenty];
const byId = (id: string | null | undefined) => shelf.find(b => b.id === id);

describe('cookbookPageKey', () => {
  it('reads an arabic page, and a range by where it starts', () => {
    expect(cookbookPageKey('142')).toEqual({ band: 1, n: 142 });
    expect(cookbookPageKey('112-115')).toEqual({ band: 1, n: 112 });
    expect(cookbookPageKey('142a')).toEqual({ band: 1, n: 142 });
  });

  it('reads roman front matter ahead of the body', () => {
    expect(cookbookPageKey('xii')).toEqual({ band: 0, n: 12 });
    expect(cookbookPageKey('IV')).toEqual({ band: 0, n: 4 });
  });

  it('ignores a hand-typed page prefix', () => {
    expect(cookbookPageKey('p. 42')).toEqual({ band: 1, n: 42 });
    expect(cookbookPageKey('pp 42-43')).toEqual({ band: 1, n: 42 });
    expect(cookbookPageKey('page 7')).toEqual({ band: 1, n: 7 });
  });

  it('puts an unreadable page after the numbered ones and no page last', () => {
    expect(cookbookPageKey('opposite').band).toBe(2);
    expect(cookbookPageKey('').band).toBe(3);
    expect(cookbookPageKey(null).band).toBe(3);
  });
});

describe('recipesInCookbook', () => {
  it('lists a book in page order rather than by name', () => {
    const list = [
      recipe('Aubergine', { cookbookId: 'b-jer', sourcePage: '210' }),
      recipe('Shakshuka', { cookbookId: 'b-jer', sourcePage: '9' }),
      recipe('Mejadra', { cookbookId: 'b-jer', sourcePage: '100' }),
      recipe('Elsewhere', { cookbookId: 'b-plenty', sourcePage: '1' }),
    ];
    expect(recipesInCookbook(list, 'b-jer').map(r => r.name)).toEqual(['Shakshuka', 'Mejadra', 'Aubergine']);
  });

  it('puts front matter first, unreadable pages next, and pageless recipes last by name', () => {
    const list = [
      recipe('Zaatar', { cookbookId: 'b-jer' }),
      recipe('Bread', { cookbookId: 'b-jer', sourcePage: 'opposite' }),
      recipe('Intro salad', { cookbookId: 'b-jer', sourcePage: 'xii' }),
      recipe('Hummus', { cookbookId: 'b-jer', sourcePage: '12' }),
      recipe('Aioli', { cookbookId: 'b-jer' }),
    ];
    expect(recipesInCookbook(list, 'b-jer').map(r => r.name))
      .toEqual(['Intro salad', 'Hummus', 'Bread', 'Aioli', 'Zaatar']);
  });

  it('breaks a shared page by name', () => {
    expect(compareCookbookRecipes(
      { name: 'Beta', sourcePage: '12' },
      { name: 'Alpha', sourcePage: '12' },
    )).toBeGreaterThan(0);
  });
});

describe('cookbookLinkEffect', () => {
  it('is a move when the recipe is filed under another book', () => {
    const r = recipe('Salad', { cookbookId: 'b-plenty', source: 'Plenty', author: 'Yotam Ottolenghi', sourceType: 'cookbook' });
    expect(cookbookLinkEffect(r, jerusalem, byId)).toEqual({ kind: 'move', from: plenty });
  });

  it('treats a link to a deleted book as no link', () => {
    const r = recipe('Salad', { cookbookId: 'b-gone' });
    expect(cookbookLinkEffect(r, jerusalem, byId)).toEqual({ kind: 'none' });
  });

  it('is a replace when the recipe credits a website', () => {
    const r = recipe('Tacos', { source: 'NYT Cooking', sourceType: 'website' });
    expect(cookbookLinkEffect(r, jerusalem, byId)).toEqual({ kind: 'replace', attribution: 'NYT Cooking' });
  });

  it('is a replace when only the author differs', () => {
    const r = recipe('Tacos', { author: 'Alison Roman' });
    expect(cookbookLinkEffect(r, jerusalem, byId)).toEqual({ kind: 'replace', attribution: 'by Alison Roman' });
  });

  it('counts the legacy byline, which the mirror would hide', () => {
    const r = recipe('Old one', { sourceName: 'Grandma' });
    expect(cookbookLinkEffect(r, jerusalem, byId).kind).toBe('replace');
  });

  it('loses nothing when the recipe has no attribution, or already names this book', () => {
    expect(cookbookLinkEffect(recipe('Plain'), jerusalem, byId)).toEqual({ kind: 'none' });
    const typed = recipe('Typed', { source: 'jerusalem ', sourceType: 'cookbook' });
    expect(cookbookLinkEffect(typed, jerusalem, byId)).toEqual({ kind: 'none' });
    const withAuthor = recipe('Typed', { source: 'Jerusalem', author: 'yotam ottolenghi' });
    expect(cookbookLinkEffect(withAuthor, jerusalem, byId)).toEqual({ kind: 'none' });
  });
});

describe('cookbookLinkCandidates', () => {
  it('leaves out recipes already in this book and notes the book a recipe is in', () => {
    const list = [
      recipe('Hummus', { cookbookId: 'b-jer' }),
      recipe('Salad', { cookbookId: 'b-plenty', source: 'Plenty', author: 'Yotam Ottolenghi', sourcePage: '42' }),
      recipe('Tacos', { source: 'NYT Cooking' }),
      recipe('Plain'),
    ];
    const { shown, total } = cookbookLinkCandidates(list, jerusalem, '', byId);
    expect(total).toBe(3);
    expect(shown.map(c => [c.recipe.name, c.note])).toEqual([
      ['Plain', null],
      ['Salad', 'In Plenty, p. 42'],
      ['Tacos', 'NYT Cooking'],
    ]);
  });

  it('caps the rows and reports how many matched', () => {
    const list = Array.from({ length: COOKBOOK_LINK_LIMIT + 5 }, (_, i) => recipe(`Dish ${String(i).padStart(2, '0')}`));
    const { shown, total } = cookbookLinkCandidates(list, jerusalem, '', byId);
    expect(shown).toHaveLength(COOKBOOK_LINK_LIMIT);
    expect(total).toBe(COOKBOOK_LINK_LIMIT + 5);
  });

  it('searches the way the recipe box does, words in any order', () => {
    const list = [
      recipe('Peanut butter sriracha tofu'),
      recipe('Tofu scramble'),
      recipe('Peanut noodles'),
    ];
    const { shown, total } = cookbookLinkCandidates(list, jerusalem, 'tofu peanut', byId);
    expect(total).toBe(1);
    expect(shown[0].recipe.name).toBe('Peanut butter sriracha tofu');
  });
});

describe('cookbookLinkPrompt', () => {
  it('asks before a move and before replacing a source, and not otherwise', () => {
    expect(cookbookLinkPrompt('Salad', jerusalem, { kind: 'move', from: plenty })).toEqual({
      title: 'Move to Jerusalem?',
      message: 'Linking "Salad" to Jerusalem takes it out of Plenty.',
      confirm: 'Move',
    });
    expect(cookbookLinkPrompt('Tacos', jerusalem, { kind: 'replace', attribution: 'NYT Cooking' })?.message)
      .toBe('Linking "Tacos" to Jerusalem replaces its current source (NYT Cooking).');
    expect(cookbookLinkPrompt('Plain', jerusalem, { kind: 'none' })).toBeNull();
  });

  it('says the page number goes when the recipe has one', () => {
    expect(cookbookLinkPrompt('Salad', jerusalem, { kind: 'move', from: plenty }, '42')?.message)
      .toBe('Linking "Salad" to Jerusalem takes it out of Plenty. Its page number (p. 42) is cleared, since that was a page of Plenty.');
    expect(cookbookLinkPrompt('Salad', jerusalem, { kind: 'replace', attribution: 'Plenty, p. 42' }, '42')?.message)
      .toBe('Linking "Salad" to Jerusalem replaces its current source (Plenty, p. 42) and clears its page number.');
    expect(cookbookLinkPrompt('Plain', jerusalem, { kind: 'none' }, '42')).toBeNull();
  });
});

describe('pageAfterCookbookLink', () => {
  it('clears a page from another book on a move', () => {
    const r = recipe('Salad', {
      cookbookId: 'b-plenty', source: 'Plenty', author: 'Yotam Ottolenghi', sourceType: 'cookbook', sourcePage: '42',
    });
    expect(pageAfterCookbookLink(r, jerusalem, byId)).toBeNull();
  });

  it('clears a page credited to another book the recipe is no longer filed under', () => {
    // Unlinked (or its book deleted), the mirror and the page stay behind.
    const r = recipe('Salad', { source: 'Plenty', author: 'Yotam Ottolenghi', sourceType: 'cookbook', sourcePage: '42' });
    expect(pageAfterCookbookLink(r, jerusalem, byId)).toBeNull();
  });

  it('keeps the page within the same book, and when nothing names another', () => {
    const filed = recipe('Hummus', {
      cookbookId: 'b-jer', source: 'Jerusalem', author: 'Yotam Ottolenghi', sourceType: 'cookbook', sourcePage: '112',
    });
    expect(pageAfterCookbookLink(filed, jerusalem, byId)).toBe('112');
    // A page read off a photo before its book was named.
    const unnamed = recipe('Salsa verde', { sourceType: 'cookbook', sourcePage: '45' });
    expect(pageAfterCookbookLink(unnamed, jerusalem, byId)).toBe('45');
  });
});
