import type { GroceryItem } from '../types';
import { FREEZER_SECTION, kitchenEntryId, type KitchenEntry } from '../utils/kitchenInventory';
import { OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
import {
  clampProduceFloor,
  DEFAULT_PRODUCE_FLOOR,
  produceFloorApplies,
  produceFloorNotes,
  produceFloorTitle,
  restockSuggestions,
  stockedProduce,
  stockedProduceNames,
} from '../utils/produceFloorTasks';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;

function entry(title: string, overrides: Partial<KitchenEntry> = {}): KitchenEntry {
  seq += 1;
  return {
    id: kitchenEntryId('grocery', `gi-${seq}`),
    sourceId: `gi-${seq}`,
    kind: 'grocery',
    title,
    productName: null,
    itemId: null,
    section: 'Produce',
    useBy: '2026-10-20',
    freshness: 'fresh',
    daysLeft: 5,
    reason: '',
    useByCaption: '',
    caption: '',
    onList: false,
    matchKey: title.toLowerCase(),
    ...overrides,
  };
}

function item(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  seq += 1;
  return { id: `i-${seq}`, name, nameKey: name.toLowerCase(), purchaseCount: 2, onHandUntil: null, ...overrides } as GroceryItem;
}

describe('stockedProduce', () => {
  it('counts fresh and frozen produce once per catalog key', () => {
    const entries = [
      entry('Peas', { section: FREEZER_SECTION, freshness: null }),
      entry('Peas', { kind: 'product' }),
      entry('Spinach'),
    ];
    expect(stockedProduce(entries).sort()).toEqual(['peas', 'spinach']);
  });

  it('leaves out leftovers, produce past its use-by day, and things that are not produce', () => {
    const entries = [
      entry('Spinach', { freshness: 'over' }),
      entry('Carrot', { kind: 'leftover' }),
      entry('Bread'),
      entry('Pasta'),
    ];
    expect(stockedProduce(entries)).toEqual([]);
  });

  it('counts produce with no use-by day, such as a can', () => {
    expect(stockedProduce([entry('Tomatoes', { freshness: null, useBy: null })])).toEqual(['tomatoes']);
  });
});

describe('stockedProduceNames', () => {
  it('names each stocked item once, matching the count', () => {
    const entries = [entry('Peas'), entry('Peas', { kind: 'product' }), entry('Spinach', { freshness: 'over' }), entry('Bread')];
    expect(stockedProduceNames(entries)).toEqual(['peas']);
    expect(stockedProduceNames(entries)).toHaveLength(stockedProduce(entries).length);
  });
});

describe('the floor', () => {
  it('applies only under the number', () => {
    expect(produceFloorApplies(3, 4)).toBe(true);
    expect(produceFloorApplies(4, 4)).toBe(false);
  });

  it('clamps and falls back', () => {
    expect(clampProduceFloor(0)).toBe(1);
    expect(clampProduceFloor(99)).toBe(20);
    expect(clampProduceFloor(NaN)).toBe(DEFAULT_PRODUCE_FLOOR);
  });

  it('names the figure it judged by', () => {
    expect(produceFloorTitle(1, 4)).toBe('Restock vegetables and fruit (1 of 4 on hand)');
  });
});

describe('restockSuggestions', () => {
  it('lists produce not on hand, frozen and canned first, then by purchases', () => {
    const items = [
      item('Spinach', { purchaseCount: 9 }),
      item('Frozen peas', { purchaseCount: 2 }),
      item('Carrots', { purchaseCount: 5 }),
      item('Bread', { purchaseCount: 20 }),
      item('Broccoli', { purchaseCount: 3 }),
    ];
    expect(restockSuggestions(items, ['broccoli']).map(i => i.name)).toEqual(['Frozen peas', 'Spinach', 'Carrots']);
  });

  it('skips produce never bought, but keeps a row marked out of it', () => {
    const items = [item('Kale', { purchaseCount: 0 }), item('Leeks', { purchaseCount: 0, onHandUntil: OUT_OF_IT_UNTIL })];
    expect(restockSuggestions(items, []).map(i => i.name)).toEqual(['Leeks']);
  });
});

describe('produceFloorNotes', () => {
  it('names up to five and counts the rest', () => {
    const items = ['Kale', 'Leeks', 'Peas', 'Corn', 'Beans', 'Okra', 'Chard'].map(n => item(n));
    const notes = produceFloorNotes(items);
    expect(notes).toContain('Bought before, not on hand: kale, leeks, peas, corn, beans and 2 more.');
  });

  it('lists what is on hand ahead of what to buy', () => {
    const notes = produceFloorNotes([item('Kale')], ['peas', 'spinach', 'apples']);
    expect(notes).toContain('On hand: peas, spinach, apples.\n\nBought before, not on hand: kale.');
  });

  it('is just the explanation with nothing to suggest', () => {
    expect(produceFloorNotes([])).not.toContain('not on hand:');
  });
});
