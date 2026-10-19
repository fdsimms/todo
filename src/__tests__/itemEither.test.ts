import type { GroceryItem, ItemPick, MealPlanEntry } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import {
  describeEitherPair,
  eitherPairKey,
  eitherPairsInUse,
  hasUndecidedItem,
  lastUsedPick,
  parseItemPicks,
  pickFor,
  withItemPick,
  withoutItemPick,
} from '../utils/itemEither';
import type { FlatIngredient } from '../utils/recipeComponents';
import type { StandingSwap } from '../utils/standingSwaps';

function item(name: string): GroceryItem {
  return { id: `i-${name}`, name, nameKey: groceryNameKey(name) } as GroceryItem;
}

const butter = item('Butter');
const vegan = item('Vegan butter');
const PAIR = eitherPairKey(butter.nameKey, vegan.nameKey);

function rule(from: GroceryItem, to: GroceryItem): StandingSwap {
  return {
    link: { itemId: from.id, subItemId: to.id, note: null, createdAt: '', ratioFrom: null, ratioTo: null, standing: false, either: true },
    from, to, either: true,
  };
}

function flatLine(name: string, quantity: string, use: string | null, from = butter, to = vegan): FlatIngredient {
  return {
    ingredient: { id: name, name, nameKey: groceryNameKey(name), quantity } as FlatIngredient['ingredient'],
    recipe: {} as FlatIngredient['recipe'],
    depth: 0,
    swappedFrom: null,
    either: { pair: eitherPairKey(from.nameKey, to.nameKey), undecided: use === null, use, swap: rule(from, to) },
  };
}

describe('eitherPairKey', () => {
  it('is the same whichever item a line names', () => {
    expect(eitherPairKey('butter', 'vegan butter')).toBe(eitherPairKey('vegan butter', 'butter'));
  });
});

describe('parseItemPicks', () => {
  it('reads what was written', () => {
    expect(parseItemPicks(JSON.stringify([{ pair: PAIR, use: 'butter' }]))).toEqual([{ pair: PAIR, use: 'butter' }]);
  });

  it('shrugs at anything a restored backup or an old row could hold', () => {
    expect(parseItemPicks(null)).toEqual([]);
    expect(parseItemPicks('')).toEqual([]);
    expect(parseItemPicks('not json')).toEqual([]);
    expect(parseItemPicks('{"pair":"a|b","use":"a"}')).toEqual([]);
  });

  it('drops a pick naming neither item of its pair, a blank one and a second answer for one pair', () => {
    const raw = JSON.stringify([
      { pair: PAIR, use: 'margarine' },
      { pair: '', use: 'x' },
      { pair: PAIR, use: 'butter' },
      { pair: PAIR, use: 'vegan butter' },
    ]);
    expect(parseItemPicks(raw)).toEqual([{ pair: PAIR, use: 'butter' }]);
  });
});

describe('picks', () => {
  it('answers a pair once, replacing an earlier answer, and can take it back', () => {
    const first = withItemPick([], PAIR, 'butter');
    const second = withItemPick(first, PAIR, 'vegan butter');
    expect(second).toEqual([{ pair: PAIR, use: 'vegan butter' }]);
    expect(pickFor(second, PAIR)?.use).toBe('vegan butter');
    expect(withoutItemPick(second, PAIR)).toEqual([]);
    expect(pickFor(undefined, PAIR)).toBeUndefined();
  });

  it('leaves another pair alone', () => {
    const picks: ItemPick[] = [{ pair: 'milk|oat milk', use: 'milk' }];
    expect(withItemPick(picks, PAIR, 'butter')).toHaveLength(2);
    expect(withoutItemPick(picks, PAIR)).toEqual(picks);
  });
});

describe('eitherPairsInUse', () => {
  it('lists each pair once with every line that names it, in the recipe\'s own words', () => {
    const flat = [
      flatLine('butter', '1/2 cup', null),
      flatLine('banana', '3', null),
      flatLine('vegan butter', '1 tbsp', null),
    ];
    // A line without `either` names no pair.
    delete (flat[1] as { either?: unknown }).either;
    const pairs = eitherPairsInUse(flat);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ pair: PAIR, use: null });
    expect(pairs[0].items.map(i => i.name)).toEqual(['Butter', 'Vegan butter']);
    expect(pairs[0].lines).toEqual([
      { name: 'butter', quantity: '1/2 cup' },
      { name: 'vegan butter', quantity: '1 tbsp' },
    ]);
  });

  it('names the same two items in the same order whichever way the rule faces', () => {
    const a = eitherPairsInUse([flatLine('butter', '', 'butter')])[0];
    const b = eitherPairsInUse([flatLine('vegan butter', '', 'butter', vegan, butter)])[0];
    expect(a.items.map(i => i.name)).toEqual(b.items.map(i => i.name));
    expect(a.use).toBe('butter');
  });

  it('says so when a line is waiting for an answer', () => {
    expect(hasUndecidedItem([flatLine('butter', '', null)])).toBe(true);
    expect(hasUndecidedItem([flatLine('butter', '', 'butter')])).toBe(false);
    expect(hasUndecidedItem([])).toBe(false);
  });

  it('describes a pair the way the sheet words it', () => {
    expect(describeEitherPair([butter, vegan])).toBe('Butter or vegan butter');
  });
});

describe('lastUsedPick', () => {
  const meal = (date: string, picks: ItemPick[], cookedAt: string | null = null): MealPlanEntry =>
    ({ date, cookedAt, itemPicks: picks } as MealPlanEntry);

  it('is the answer from the most recent meal that gave one', () => {
    const entries = [
      meal('2026-10-01', [{ pair: PAIR, use: 'butter' }]),
      meal('2026-10-10', [{ pair: PAIR, use: 'vegan butter' }]),
      meal('2026-10-15', []),
    ];
    expect(lastUsedPick(entries, PAIR)).toBe('vegan butter');
  });

  it('prefers when it was cooked over when it was planned for', () => {
    const entries = [
      meal('2026-10-01', [{ pair: PAIR, use: 'butter' }], '2026-10-20T18:00:00.000Z'),
      meal('2026-10-10', [{ pair: PAIR, use: 'vegan butter' }]),
    ];
    expect(lastUsedPick(entries, PAIR)).toBe('butter');
  });

  it('is null when no meal ever answered, or the pair is another one', () => {
    expect(lastUsedPick([], PAIR)).toBeNull();
    expect(lastUsedPick([meal('2026-10-01', [{ pair: 'milk|oat milk', use: 'milk' }])], PAIR)).toBeNull();
    expect(lastUsedPick([{ date: '2026-10-01', cookedAt: null } as MealPlanEntry], PAIR)).toBeNull();
  });
});
