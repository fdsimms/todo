import type { DishRating } from '../types';
import {
  applyDishPatch,
  buildDishRating,
  dishForLabel,
  dishKeys,
  dishOfferFor,
  findDish,
  groupDishesByPlace,
  isEatenOutDraft,
  noonOf,
} from '../utils/dishRating';

const NOW = new Date(2026, 9, 24, 9);
let n = 0;
function dish(name: string, place: string | null, verdict: DishRating['verdict'], lastHadAt: Date | null = null): DishRating {
  const built = buildDishRating({ name, place, verdict, lastHadAt }, `d${n++}`, NOW);
  if (!built) throw new Error('blank fixture');
  return built;
}

describe('dishKeys', () => {
  it('treats case, accents and punctuation as one dish', () => {
    expect(dishKeys('Pad See Ew!', "Luigi's").nameKey).toBe(dishKeys('pad see ew', 'luigi s').nameKey);
    expect(dishKeys('Crème brûlée', null).nameKey).toBe(dishKeys('creme brulee', null).nameKey);
  });

  it('keys a missing or blank place as the empty string', () => {
    expect(dishKeys('Soup', null).placeKey).toBe('');
    expect(dishKeys('Soup', undefined).placeKey).toBe('');
    expect(dishKeys('Soup', '').placeKey).toBe('');
  });
});

describe('buildDishRating', () => {
  it('trims, keeps null for a blank place or note, and starts with no opinion', () => {
    const d = buildDishRating({ name: '  Pad see ew ', place: '  ', note: ' ' }, 'a', NOW)!;
    expect(d.name).toBe('Pad see ew');
    expect(d.place).toBeNull();
    expect(d.note).toBeNull();
    expect(d.verdict).toBeNull();
    expect(d.lastHadAt).toBeNull();
  });

  it('refuses a blank name', () => {
    expect(buildDishRating({ name: '   ' }, 'a', NOW)).toBeNull();
    expect(buildDishRating({ name: '!!!' }, 'a', NOW)).toBeNull();
  });

  it('stores the day it was had as noon', () => {
    const d = buildDishRating({ name: 'Soup', lastHadAt: new Date(2026, 9, 3, 23, 30) }, 'a', NOW)!;
    expect(d.lastHadAt).toBe(noonOf(new Date(2026, 9, 3)));
    expect(new Date(d.lastHadAt!).getHours()).toBe(12);
  });
});

describe('applyDishPatch', () => {
  it('re-keys when the name or place changes', () => {
    const d = dish('Pad see ew', 'Thai Orchid', 'loved');
    const next = applyDishPatch(d, { place: 'Siam Garden' });
    expect(next.placeKey).toBe(dishKeys('x', 'Siam Garden').placeKey);
    expect(next.verdict).toBe('loved');
  });

  it('keeps the name when an edit blanks it', () => {
    const d = dish('Pad see ew', null, null);
    expect(applyDishPatch(d, { name: '  ' }).name).toBe('Pad see ew');
  });

  it('clears a verdict only when told null', () => {
    const d = dish('Soup', null, 'avoid');
    expect(applyDishPatch(d, { note: 'x' }).verdict).toBe('avoid');
    expect(applyDishPatch(d, { verdict: null }).verdict).toBeNull();
  });
});

describe('photo', () => {
  it('starts with none, and a patch sets, keeps and clears it', () => {
    const d = dish('Soup', null, null);
    expect(d.photo).toBeNull();
    const withPhoto = applyDishPatch(d, { photo: 'dish-a.jpg' });
    expect(withPhoto.photo).toBe('dish-a.jpg');
    expect(applyDishPatch(withPhoto, { note: 'x' }).photo).toBe('dish-a.jpg');
    expect(applyDishPatch(withPhoto, { photo: null }).photo).toBeNull();
  });
});

describe('findDish', () => {
  it('matches on name and place together, not name alone', () => {
    const a = dish('Margherita', "Luigi's", 'loved');
    const b = dish('Margherita', null, 'fine');
    expect(findDish([a, b], 'margherita', "luigi's")).toBe(a);
    expect(findDish([a, b], 'margherita', null)).toBe(b);
    expect(findDish([a], 'margherita', 'Somewhere else')).toBeNull();
  });
});

describe('groupDishesByPlace', () => {
  const dishes = [
    dish('Lasagna', "Luigi's", 'avoid'),
    dish('Shawarma', null, 'fine'),
    dish('Pad see ew', 'Thai Orchid', 'loved'),
    dish('Margherita', "Luigi's", 'loved'),
    dish('Garlic bread', "Luigi's", null),
  ];

  it('orders places alphabetically with the no-place group last', () => {
    expect(groupDishesByPlace(dishes).map(g => g.place)).toEqual(["Luigi's", 'Thai Orchid', null]);
  });

  it('orders dishes loved, fine, no opinion, then avoid', () => {
    const luigis = groupDishesByPlace(dishes)[0];
    expect(luigis.dishes.map(d => d.name)).toEqual(['Margherita', 'Garlic bread', 'Lasagna']);
  });

  it('narrows to one answer and drops places left empty', () => {
    const groups = groupDishesByPlace(dishes, 'loved');
    expect(groups.map(g => g.place)).toEqual(["Luigi's", 'Thai Orchid']);
    expect(groups.every(g => g.dishes.every(d => d.verdict === 'loved'))).toBe(true);
  });
});

describe('dishForLabel', () => {
  it('finds a dish from an eaten-out entry label, ignoring case', () => {
    const d = dish('Pad see ew', 'Thai Orchid', 'loved');
    expect(dishForLabel([d], 'PAD SEE EW')).toBe(d);
    expect(dishForLabel([d], 'Pad thai')).toBeNull();
    expect(dishForLabel([d], '')).toBeNull();
  });

  it('prefers a dish with a verdict, then the one had most recently', () => {
    const unrated = dish('Soup', 'A', null, new Date(2026, 9, 20));
    const old = dish('Soup', 'B', 'fine', new Date(2026, 0, 1));
    const recent = dish('Soup', 'C', 'fine', new Date(2026, 9, 1));
    expect(dishForLabel([unrated, old, recent], 'soup')).toBe(recent);
  });
});

describe('isEatenOutDraft', () => {
  const described = { nutrition: { source: 'estimated' } };

  it('is a described, estimated meal with nothing in the app behind it', () => {
    expect(isEatenOutDraft(described)).toBe(true);
  });

  it('is not once a recipe, item, product, planned meal, saved meal or task is behind it', () => {
    for (const link of ['recipeId', 'itemId', 'productId', 'mealPlanEntryId', 'savedMealId', 'taskId']) {
      expect(isEatenOutDraft({ ...described, [link]: 'x' })).toBe(false);
    }
  });

  it('is not a food with a real panel', () => {
    expect(isEatenOutDraft({ nutrition: { source: 'openFoodFacts' } })).toBe(false);
    expect(isEatenOutDraft({ nutrition: { source: 'manual' } })).toBe(false);
    expect(isEatenOutDraft({ nutrition: {} })).toBe(false);
  });
});

describe('dishOfferFor', () => {
  it('asks about a dish nobody has rated', () => {
    expect(dishOfferFor([], '  Pad see ew ')).toEqual({ name: 'Pad see ew' });
  });

  it('does not ask again once the dish has an answer, at any place', () => {
    expect(dishOfferFor([dish('Pad see ew', 'Thai Orchid', 'fine')], 'pad see ew')).toBeNull();
  });

  it('asks about a saved dish that has no answer yet', () => {
    expect(dishOfferFor([dish('Pad see ew', 'Thai Orchid', null)], 'Pad see ew')).toEqual({ name: 'Pad see ew' });
  });

  it('asks nothing for a blank label', () => {
    expect(dishOfferFor([], '   ')).toBeNull();
    expect(dishOfferFor([], '!!')).toBeNull();
  });
});
