import { lintRecipe, lintRecipes } from '../recipeLint';
import type { Recipe } from '../../../src/types';

const line = (quantity: string, name = 'x') => ({ name, quantity }) as never;
const recipe = (over: Partial<Recipe> & { id: string; name: string }): Recipe =>
  ({ tags: [], ingredients: [line('1 cup')], steps: [{ id: 's', text: 'Cook.' }], components: [], blanks: [], prepTasks: [], sourceUrl: null, ...over }) as unknown as Recipe;

describe('lintRecipe', () => {
  const codes = (r: Recipe) => lintRecipe(r).issues.map(i => [i.code, i.ingredient, i.text]);

  it('flags a note, prep or alternative sitting in an amount, numbered like get_recipe', () => {
    const r = recipe({ id: 'a', name: 'A', ingredients: [line('1 cup'), line('1 cup, melted'), line('1/4 cup fresh'), line('1 large or 2 small')] });
    expect(codes(r)).toEqual([
      ['quantity-note', 2, '1 cup, melted'],
      ['quantity-note', 3, '1/4 cup fresh'],
      ['quantity-alternative', 4, '1 large or 2 small'],
    ]);
  });

  it('tells a truncated parenthesis from a balanced one', () => {
    const r = recipe({ id: 'a', name: 'A', ingredients: [line('1 cup shredded (about 5'), line('3 (15-ounce) cans'), line('7 oz | 200g')] });
    expect(codes(r)).toEqual([
      ['quantity-unclosed-paren', 1, '1 cup shredded (about 5'],
      ['quantity-note', 1, '1 cup shredded (about 5'],
      ['quantity-parenthetical', 2, '3 (15-ounce) cans'],
      ['quantity-parenthetical', 3, '7 oz | 200g'],
    ]);
  });

  it('leaves a clean amount and a style choice alone', () => {
    expect(codes(recipe({ id: 'a', name: 'A', ingredients: [line('1 1/2 cups'), line('2 tablespoons'), line('½ tsp'), line('1, large'), line('')] }))).toEqual([]);
  });

  it('flags tracking parameters in a source link, not a plain link', () => {
    expect(codes(recipe({ id: 'a', name: 'A', sourceUrl: 'https://x.com/r?unlocked_article_code=1.2&smid=ck-recipe-iOS-share' }))).toEqual([
      ['source-tracking-url', undefined, 'https://x.com/r?unlocked_article_code=1.2&smid=ck-recipe-iOS-share'],
    ]);
    expect(codes(recipe({ id: 'a', name: 'A', sourceUrl: 'https://x.com/r' }))).toEqual([]);
  });

  it('flags an empty recipe, but not one made of components or blanks', () => {
    expect(codes(recipe({ id: 'a', name: 'New recipe', ingredients: [], steps: [] })).map(c => c[0])).toEqual(['placeholder-name', 'no-ingredients', 'no-steps']);
    expect(codes(recipe({ id: 'a', name: 'A', ingredients: [], components: [{ recipeId: 'b' } as never] }))).toEqual([]);
    expect(codes(recipe({ id: 'a', name: 'A', ingredients: [], blanks: [{ label: 'Grain' } as never] }))).toEqual([]);
  });
});

describe('lintRecipes', () => {
  const all = [
    recipe({ id: 'b', name: 'Beans', ingredients: [line('1 cup, drained')] }),
    recipe({ id: 'a', name: 'Apple', ingredients: [line('1 cup')] }),
    recipe({ id: 'c', name: 'Cake', ingredients: [line('2 cups (250 g)')] }),
  ];

  it('returns only recipes with findings, by name, and counts what it checked', () => {
    const result = lintRecipes(all);
    expect(result).toMatchObject({ checked: 3, withIssues: 2 });
    expect(result.recipes.map(r => r.id)).toEqual(['b', 'c']);
  });

  it('narrows to one recipe or to some checks', () => {
    expect(lintRecipes(all, { id: 'a' })).toMatchObject({ checked: 1, withIssues: 0 });
    expect(lintRecipes(all, { codes: ['quantity-parenthetical'] }).recipes.map(r => r.id)).toEqual(['c']);
  });
});
