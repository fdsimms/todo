import { ungroundedIngredientIndexes } from '../utils/ingredientGrounding';

const PAGE = `Gingersnaps
2 1/4 cups all-purpose flour
2 teaspoons baking soda
3 teaspoons ground ginger
1/2 teaspoon allspice
2 sticks unsalted butter, at room temperature
1/2 cup light brown sugar
1 large egg
1/3 cup unsulphured molasses`;

describe('ungroundedIngredientIndexes', () => {
  it('flags an ingredient the page never mentions', () => {
    const rows = [{ name: 'all-purpose flour' }, { name: 'ground cloves' }, { name: 'egg yolk' }];
    expect(ungroundedIngredientIndexes(PAGE, rows)).toEqual([1]);
  });

  it('accepts a name worded more fully than the page, and plurals', () => {
    const rows = [{ name: 'unsulphured molasses' }, { name: 'eggs' }, { name: 'brown sugars' }];
    expect(ungroundedIngredientIndexes('1 cup molasses, 1 egg, brown sugar', rows)).toEqual([]);
  });

  it('does not count a descriptor alone as a match', () => {
    expect(ungroundedIngredientIndexes('2 cups flour', [{ name: 'ground cloves' }])).toEqual([0]);
  });

  it('says nothing without text to compare against or a name to look for', () => {
    expect(ungroundedIngredientIndexes('', [{ name: 'cloves' }])).toEqual([]);
    expect(ungroundedIngredientIndexes(null, [{ name: 'cloves' }])).toEqual([]);
    expect(ungroundedIngredientIndexes(PAGE, [{ name: 'large' }, { name: '' }])).toEqual([]);
  });
});
