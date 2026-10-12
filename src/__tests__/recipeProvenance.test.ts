import {
  cookbookEditIntent, shelfSuggestions, sourceFieldsFor, sourcePlanFor, SHELF_SUGGESTION_LIMIT, type ExtractedSource,
} from '../utils/recipeProvenance';
import { cookbookKey } from '../utils/recipeUtils';
import type { Cookbook } from '../types';

// recipeProvenance reaches recipeUtils for the cookbook key, and through it the
// settings store, which nothing here needs. Same mock as recipeUtils.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const nothing: ExtractedSource = {
  sourceTitle: null,
  sourceAuthor: null,
  sourcePage: null,
  sourceType: null,
};

const photographedBook: ExtractedSource = {
  sourceTitle: 'Nothing Fancy',
  sourceAuthor: 'Alison Roman',
  sourcePage: '142',
  sourceType: 'cookbook',
};

describe('sourceFieldsFor', () => {
  it('leaves every field blank when the source stated nothing', () => {
    expect(sourceFieldsFor(null, nothing)).toEqual({
      source: '', author: '', page: '', sourceType: null,
    });
  });

  it('fills the row from a photographed cookbook page', () => {
    expect(sourceFieldsFor(null, photographedBook)).toEqual({
      source: 'Nothing Fancy',
      author: 'Alison Roman',
      page: '142',
      sourceType: 'cookbook',
    });
  });

  it("drops a page number for anything that isn't a cookbook", () => {
    const magazine: ExtractedSource = { ...photographedBook, sourceType: 'magazine' };
    expect(sourceFieldsFor(null, magazine).page).toBe('');
    expect(sourceFieldsFor(null, magazine).sourceType).toBe('magazine');
  });

  describe('when a page was fetched', () => {
    it("prefers the page's own markup over the model's read of it", () => {
      const fields = sourceFieldsFor(
        { siteName: 'NYT Cooking', author: 'Melissa Clark' },
        { ...photographedBook, sourceTitle: 'Some Book', sourceAuthor: 'Someone Else' },
      );
      expect(fields.source).toBe('NYT Cooking');
      expect(fields.author).toBe('Melissa Clark');
    });

    it('falls back to the model per field, not all or nothing', () => {
      // A site that names the author in markup but not the publication used to
      // leave the publication blank purely because the other half arrived first.
      const fields = sourceFieldsFor(
        { siteName: null, author: 'Melissa Clark' },
        { ...nothing, sourceTitle: 'Serious Eats' },
      );
      expect(fields.source).toBe('Serious Eats');
      expect(fields.author).toBe('Melissa Clark');
    });

    it('is a website whatever the model thought it was looking at', () => {
      const fields = sourceFieldsFor({ siteName: 'NYT Cooking', author: null }, photographedBook);
      expect(fields.sourceType).toBe('website');
      expect(fields.page).toBe('');
    });
  });
});

describe('sourcePlanFor', () => {
  const fields = { source: 'Nothing Fancy', author: 'Alison Roman', page: '142', sourceType: 'cookbook' as const };

  it('turns a named cookbook into a link rather than loose strings', () => {
    const plan = sourcePlanFor(null, fields);
    expect(plan.cookbook).toEqual({ title: 'Nothing Fancy', author: 'Alison Roman' });
    // The link carries all three, so writing them again would be a second writer.
    expect(plan.source).toBeNull();
    expect(plan.author).toBeNull();
    expect(plan.sourceType).toBeNull();
    expect(plan.page).toBe('142');
  });

  it('keeps a cookbook with no title as a plain classification', () => {
    // A Cookbook row with an empty title is one nobody can pick off the shelf.
    const plan = sourcePlanFor(null, { ...fields, source: '  ' });
    expect(plan.cookbook).toBeNull();
    expect(plan.sourceType).toBe('cookbook');
    expect(plan.source).toBeNull();
    expect(plan.page).toBe('142');
  });

  it('writes loose strings for every other kind of source', () => {
    const plan = sourcePlanFor('https://example.com/x', {
      source: 'NYT Cooking', author: 'Melissa Clark', page: '', sourceType: 'website',
    });
    expect(plan.cookbook).toBeNull();
    expect(plan.url).toBe('https://example.com/x');
    expect(plan.sourceType).toBe('website');
    expect(plan.source).toBe('NYT Cooking');
    expect(plan.author).toBe('Melissa Clark');
    expect(plan.page).toBeNull();
  });

  it('drops a page number that came with a non-cookbook', () => {
    const plan = sourcePlanFor(null, { ...fields, sourceType: 'magazine' });
    expect(plan.page).toBeNull();
  });

  it('reads the fields, so a value typed over the extraction is the one that lands', () => {
    const plan = sourcePlanFor(null, { ...fields, source: 'Dining In' });
    expect(plan.cookbook).toEqual({ title: 'Dining In', author: 'Alison Roman' });
  });

  it('treats a whitespace-only author as no author', () => {
    const plan = sourcePlanFor(null, { ...fields, author: '   ' });
    expect(plan.cookbook).toEqual({ title: 'Nothing Fancy', author: null });
  });

  it('writes nothing at all when the row was left empty', () => {
    const plan = sourcePlanFor(null, { source: '', author: '', page: '', sourceType: null });
    expect(plan).toEqual({
      url: null, sourceType: null, cookbook: null, source: null, author: null, page: null,
    });
  });
});

describe('cookbookEditIntent', () => {
  const sweet = { title: 'Sweet', author: 'Yotam Ottolenghi' };

  it('refiles when the recipe is not linked to anything yet', () => {
    expect(cookbookEditIntent(null, 'Sweet', 'Yotam Ottolenghi', 0)).toBe('refile');
    expect(cookbookEditIntent(undefined, 'Sweet', '', 0)).toBe('refile');
  });

  it('refiles when nothing actually changed', () => {
    // RecipeEditor.save() fires on every Done, touched or not.
    expect(cookbookEditIntent(sweet, 'Sweet', 'Yotam Ottolenghi', 5)).toBe('refile');
    expect(cookbookEditIntent(sweet, ' Sweet ', ' Yotam Ottolenghi ', 5)).toBe('refile');
  });

  it('renames without asking when no other recipe is affected', () => {
    // "Everywhere" and "just this one" are the same place.
    expect(cookbookEditIntent(sweet, 'Sweet: Desserts', 'Yotam Ottolenghi', 1)).toBe('rename');
  });

  it('asks when other recipes would move too', () => {
    expect(cookbookEditIntent(sweet, 'Sweet: Desserts', 'Yotam Ottolenghi', 2)).toBe('ask');
  });

  it('treats an author-only edit as a change like any other', () => {
    expect(cookbookEditIntent(sweet, 'Sweet', 'Y. Ottolenghi', 3)).toBe('ask');
    expect(cookbookEditIntent({ title: 'Sweet', author: null }, 'Sweet', 'Helen Goh', 1)).toBe('rename');
  });
});

describe('shelfSuggestions', () => {
  const book = (id: string, title: string, author: string | null, sortOrder: number): Cookbook => ({
    id, title, author, sortOrder, titleKey: cookbookKey(title, author), createdAt: '2026-01-01T00:00:00.000Z',
  });
  const vegan = book('a', 'The Korean Vegan: Homemade', 'Joanne Lee Molinaro', 1);
  const plenty = book('b', 'Plenty', 'Yotam Ottolenghi', 2);
  const shelf = [vegan, plenty];

  it('offers the whole shelf, in order, before anything is typed', () => {
    expect(shelfSuggestions(shelf, '', '').map(b => b.id)).toEqual(['a', 'b']);
  });

  it('offers a book whose title is right but whose author was typed differently', () => {
    expect(shelfSuggestions(shelf, 'The Korean Vegan: Homemade', 'Molinaro').map(b => b.id)).toEqual(['a']);
  });

  it('leaves out the book the typed title and author already resolve to', () => {
    expect(shelfSuggestions(shelf, 'Plenty', 'Yotam Ottolenghi').map(b => b.id)).toEqual([]);
  });

  it('matches part of a title, or the author, ignoring case', () => {
    expect(shelfSuggestions(shelf, 'korean', '').map(b => b.id)).toEqual(['a']);
    expect(shelfSuggestions(shelf, 'ottolenghi', '').map(b => b.id)).toEqual(['b']);
  });

  it('offers nothing for a title that is on no book', () => {
    expect(shelfSuggestions(shelf, 'Salt Fat Acid Heat', '')).toEqual([]);
  });

  it('puts an exact title first and caps the list', () => {
    const many = Array.from({ length: 10 }, (_, i) => book(`m${i}`, `Dinner ${i}`, null, i + 10));
    const dinner = book('d', 'Dinner', 'Melissa Clark', 99);
    const out = shelfSuggestions([...many, dinner], 'Dinner', '');
    expect(out[0].id).toBe('d');
    expect(out).toHaveLength(SHELF_SUGGESTION_LIMIT);
  });
});
