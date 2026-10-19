import {
  incidentalIds,
  incidentalPicks,
  substituteCandidates,
} from '../utils/incidentalPurchases';
import type { GroceryItem, GroceryListEntry } from '../types';

function entry(itemId: string, overrides: Partial<GroceryListEntry> = {}): GroceryListEntry {
  return {
    itemId,
    listId: null,
    checked: true,
    sortOrder: 1,
    choiceGroup: null,
    addedAt: '2026-08-12T09:00:00.000Z',
    ...overrides,
  };
}

function item(id: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id,
    name: id,
    nameKey: id,
    aisle: 'Other',
    purchaseCount: 0,
    lastPurchasedAt: null,
    ...overrides,
  } as GroceryItem;
}

const TRIP = '2026-08-12T10:00:00.000Z';

describe('incidentalIds', () => {
  it('is the ticked rows that joined the trolley after the trip began', () => {
    const entries = [
      entry('planned', { addedAt: '2026-08-12T08:00:00.000Z' }),
      entry('grabbed', { addedAt: '2026-08-12T10:30:00.000Z' }),
    ];
    expect([...incidentalIds(entries, null, TRIP)]).toEqual(['grabbed']);
  });

  it('counts a row added at the very moment the trip started', () => {
    expect(incidentalIds([entry('x', { addedAt: TRIP })], null, TRIP).has('x')).toBe(true);
  });

  it('leaves out a row added mid-trip and not ticked, which is still to buy', () => {
    const entries = [entry('later', { checked: false, addedAt: '2026-08-12T10:30:00.000Z' })];
    expect(incidentalIds(entries, null, TRIP).size).toBe(0);
  });

  it('answers nothing with no trip, rather than guessing from the clock', () => {
    expect(incidentalIds([entry('x')], null, null).size).toBe(0);
  });

  it('reads only the list it was asked about', () => {
    const entries = [
      entry('home', { listId: null, addedAt: '2026-08-12T10:30:00.000Z' }),
      entry('away', { listId: 'airbnb', addedAt: '2026-08-12T10:30:00.000Z' }),
    ];
    expect([...incidentalIds(entries, 'airbnb', TRIP)]).toEqual(['away']);
  });
});

describe('substituteCandidates', () => {
  const missing = { id: 'skyr', aisle: 'Dairy' };
  const aisleById = new Map([
    ['skyr', 'Dairy'],
    ['siggis', 'Dairy'],
    ['butter', 'Dairy'],
    ['towels', 'Household'],
    ['yogurt', 'Dairy'],
  ]);
  const purchased = [
    { id: 'butter', name: 'butter' },
    { id: 'towels', name: 'paper towels' },
    { id: 'siggis', name: 'Siggi’s' },
  ];

  it('orders usual substitutes, then incidentals, then the same aisle', () => {
    const out = substituteCandidates({
      missing,
      usual: [{ id: 'yogurt', name: 'Greek yogurt' }],
      incidental: new Set(['siggis']),
      purchased,
      aisleById,
    });
    expect(out.map(c => [c.id, c.reason])).toEqual([
      ['yogurt', 'usual'],
      ['siggis', 'incidental'],
      ['butter', 'sameAisle'],
    ]);
  });

  it('never offers an unrelated row from the trolley', () => {
    const out = substituteCandidates({
      missing, usual: [], incidental: new Set(), purchased, aisleById,
    });
    expect(out.map(c => c.id)).not.toContain('towels');
  });

  it('lists a row once, under its strongest reason', () => {
    const out = substituteCandidates({
      missing,
      usual: [{ id: 'siggis', name: 'Siggi’s' }],
      incidental: new Set(['siggis']),
      purchased,
      aisleById,
    });
    expect(out.filter(c => c.id === 'siggis')).toEqual([
      { id: 'siggis', name: 'Siggi’s', reason: 'usual' },
    ]);
  });

  it('offers a usual substitute that was not bought', () => {
    const out = substituteCandidates({
      missing, usual: [{ id: 'yogurt', name: 'Greek yogurt' }], incidental: new Set(), purchased: [], aisleById,
    });
    expect(out.map(c => c.id)).toEqual(['yogurt']);
  });

  it('never offers the missing row as its own replacement', () => {
    const out = substituteCandidates({
      missing,
      usual: [],
      incidental: new Set(['skyr']),
      purchased: [{ id: 'skyr', name: 'skyr' }],
      aisleById,
    });
    expect(out).toEqual([]);
  });
});

describe('incidentalPicks', () => {
  it('offers bought-before rows that are on no list, most bought first', () => {
    const items = [
      item('bananas', { purchaseCount: 9 }),
      item('chocolate', { purchaseCount: 4 }),
      item('never', { purchaseCount: 0 }),
      item('milk', { purchaseCount: 20 }),
    ];
    const picks = incidentalPicks(items, [entry('milk')]);
    expect(picks.map(i => i.id)).toEqual(['bananas', 'chocolate']);
  });

  it('breaks a tie on the more recent purchase, then the name', () => {
    const items = [
      item('b', { purchaseCount: 3, lastPurchasedAt: '2026-08-01T00:00:00.000Z' }),
      item('a', { purchaseCount: 3, lastPurchasedAt: '2026-08-01T00:00:00.000Z' }),
      item('c', { purchaseCount: 3, lastPurchasedAt: '2026-08-09T00:00:00.000Z' }),
    ];
    expect(incidentalPicks(items, []).map(i => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('caps the offer', () => {
    const items = Array.from({ length: 10 }, (_, n) => item(`i${n}`, { purchaseCount: n + 1 }));
    expect(incidentalPicks(items, [], 3)).toHaveLength(3);
  });
});
