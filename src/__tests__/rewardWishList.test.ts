import { WISH_UNFILED, groupWishItems, wishItemMatches, wishListView } from '../utils/rewardWishList';

const item = (title: string, category: string | null = null, tags: string[] = []) => ({ title, category, tags });

const ITEMS = [
  item('Under-desk rug', 'Home'),
  item('Safety razor kit', 'Bathroom'),
  item('Facesoft workout towel', 'Home'),
  item('Level Up! Thai Stories', 'Books', ['thai']),
  item('Fashionable cap'),
  item('Café table', 'Home'),
];

describe('wishItemMatches', () => {
  it('matches everything on a blank query', () => {
    expect(wishItemMatches(ITEMS[0], '   ')).toBe(true);
  });

  it('matches words in any order, in the title, category or a tag', () => {
    expect(wishItemMatches(ITEMS[2], 'towel workout')).toBe(true);
    expect(wishItemMatches(ITEMS[0], 'home')).toBe(true);
    expect(wishItemMatches(ITEMS[3], 'thai')).toBe(true);
    expect(wishItemMatches(ITEMS[0], 'rug towel')).toBe(false);
  });

  it('ignores case and accents', () => {
    expect(wishItemMatches(ITEMS[5], 'CAFE')).toBe(true);
    expect(wishItemMatches(item('Cafe table'), 'café')).toBe(true);
  });
});

describe('groupWishItems', () => {
  it('puts the biggest group first, ties by name, and uncategorized last', () => {
    expect(groupWishItems(ITEMS).map(g => [g.name, g.items.length])).toEqual([
      ['Home', 3], ['Bathroom', 1], ['Books', 1], [WISH_UNFILED, 1],
    ]);
  });

  it('keeps the project order inside a group', () => {
    expect(groupWishItems(ITEMS)[0].items.map(i => i.title)).toEqual(['Under-desk rug', 'Facesoft workout towel', 'Café table']);
  });

  it('treats a blank category as none', () => {
    expect(groupWishItems([item('a', '  ')])[0].name).toBe(WISH_UNFILED);
  });
});

describe('wishListView', () => {
  it('narrows by category and search together', () => {
    const view = wishListView(ITEMS, 'table', 'Home');
    expect(view.matches.map(i => i.title)).toEqual(['Café table']);
    expect(view.categories.map(g => g.name)).toEqual(['Home', 'Bathroom', 'Books', WISH_UNFILED]);
  });

  it('only draws group headers when there is more than one group or a named one', () => {
    expect(wishListView([item('a'), item('b')], '', null).grouped).toBe(false);
    expect(wishListView([item('a', 'Home')], '', null).grouped).toBe(true);
    expect(wishListView(ITEMS, '', null).grouped).toBe(true);
  });
});
