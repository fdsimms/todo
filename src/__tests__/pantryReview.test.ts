import {
  MAX_PANTRY_REVIEW_CARDS,
  buildPantryReviewDeck,
  describeLastPurchase,
  describePantryDoubt,
  describePantryReviewDone,
} from '../utils/pantryReview';
import { OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem, ItemProduct } from '../types';

// pantryReview reaches pantryCheckTasks for its grace constant, which reaches
// kitchenInventory and so dateUtils and the settings store (SQLite). Nothing
// here reads a setting — the same stub pantryCheckTasks.test.ts uses.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const NOW = new Date('2026-08-22T12:00:00.000Z');

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

let seq = 0;
function makeItem(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  const name = overrides.name;
  return {
    id: `id-${++seq}`,
    nameKey: groceryNameKey(name),
    preferredProductId: null,
    productStrict: false,
    aisle: 'Other',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    listId: null,
    checked: false,
    sortOrder: seq,
    // Three purchases across a year: a 122-day window, long enough that a case
    // can move lastPurchasedAt without the window shifting under it.
    purchaseCount: 3,
    lastAddedAt: null,
    lastPurchasedAt: daysAgo(10),
    createdAt: daysAgo(366),
    onHandUntil: null,
    sourceRecipeId: null,
    sourceRecipeTitle: null,
    choiceGroup: null,
    isStaple: false,
    expiresAt: null,
    frozenAt: null,
    openedAt: null,
    runningLowAt: null,
    shelfLifeDays: null,
    useUpTask: null,
    pantryCheckDeclinedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    ...overrides,
  };
}

function makeProduct(overrides: Partial<ItemProduct> & { itemId: string }): ItemProduct {
  return {
    id: `product-${++seq}`,
    brand: 'A brand',
    variant: null,
    note: '',
    rating: null,
    gtin: null,
    unavailableShopIds: [],
    onHandUntil: null,
    expiresAt: null,
    frozenAt: null,
    openedAt: null,
    ...overrides,
  } as ItemProduct;
}

const names = (deck: { cards: { item: GroceryItem }[] }) => deck.cards.map(c => c.item.name);

// ─── Who gets a card ─────────────────────────────────────────────────────────

describe('buildPantryReviewDeck', () => {
  it('cards a row the purchase reading still vouches for', () => {
    const deck = buildPantryReviewDeck([makeItem({ name: 'Flour' })], NOW);
    expect(names(deck)).toEqual(['Flour']);
    expect(deck.cards[0].doubt).toBe('guessed');
    expect(deck.cards[0].reason).toContain('bought');
  });

  it('cards a row whose guess has lapsed inside the grace period', () => {
    // 130 days against a 122-day window: dropped out of the pantry eight days
    // ago, which is the one state change nobody can see happen.
    const deck = buildPantryReviewDeck([makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(130) })], NOW);
    expect(deck.cards[0].doubt).toBe('lapsed');
    expect(deck.cards[0].reason).toBeNull();
    expect(deck.cards[0].lapsedDays).toBe(8);
  });

  it('drops a lapse too old to be worth asking about', () => {
    const deck = buildPantryReviewDeck([makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(200) })], NOW);
    expect(deck.cards).toEqual([]);
  });

  it('never cards a staple', () => {
    // "Always have it" is a standing fact, and the deck's own left swipe
    // contradicts it.
    const deck = buildPantryReviewDeck([makeItem({ name: 'Salt', isStaple: true })], NOW);
    expect(deck.cards).toEqual([]);
  });

  it('never cards a row already marked out of it', () => {
    const deck = buildPantryReviewDeck(
      [makeItem({ name: 'Flour', onHandUntil: OUT_OF_IT_UNTIL })],
      NOW
    );
    expect(deck.cards).toEqual([]);
  });

  it('never cards a row only a box vouches for', () => {
    // The three answers write the item's own columns, so an item on hand solely
    // because one packet is frozen has no honest item-level answer — saying
    // "out of it" there would overwrite a box-level fact set deliberately.
    const item = makeItem({ name: 'Chicken', lastPurchasedAt: daysAgo(130) });
    const deck = buildPantryReviewDeck(
      [item],
      NOW,
      [makeProduct({ itemId: item.id, frozenAt: daysAgo(40) })]
    );
    expect(deck.cards).toEqual([]);
  });

  it('still cards a row whose own claim stands, boxes or not', () => {
    const item = makeItem({ name: 'Chicken' });
    const deck = buildPantryReviewDeck([item], NOW, [makeProduct({ itemId: item.id })]);
    expect(names(deck)).toEqual(['Chicken']);
  });
});

// ─── The ordering, which is the whole point ──────────────────────────────────

describe('the doubt ladder', () => {
  it('deals lapsed rows, then guesses, then rows the user has spoken about', () => {
    const deck = buildPantryReviewDeck(
      [
        makeItem({ name: 'Told', onHandUntil: new Date(NOW.getTime() + 86_400_000).toISOString() }),
        makeItem({ name: 'Guessed' }),
        makeItem({ name: 'Lapsed', lastPurchasedAt: daysAgo(130) }),
      ],
      NOW
    );
    expect(names(deck)).toEqual(['Lapsed', 'Guessed', 'Told']);
  });

  it('reads running low, frozen and opened as things the user has said', () => {
    for (const field of ['runningLowAt', 'frozenAt', 'openedAt'] as const) {
      const deck = buildPantryReviewDeck([makeItem({ name: 'Jar', [field]: daysAgo(2) })], NOW);
      expect(deck.cards[0].doubt).toBe('asserted');
    }
  });

  it('reads a lapsed "Got it" as a guess rather than as something said', () => {
    // A stamp that has run out is an assertion that expired, not a live claim —
    // the reading onHandAssertion takes, and the reason it hands the question
    // back to the purchase guess.
    const deck = buildPantryReviewDeck([makeItem({ name: 'Flour', onHandUntil: daysAgo(3) })], NOW);
    expect(deck.cards[0].doubt).toBe('guessed');
  });

  it('asks about the freshest lapse first', () => {
    const deck = buildPantryReviewDeck(
      [
        makeItem({ name: 'Older', lastPurchasedAt: daysAgo(133) }),
        makeItem({ name: 'Fresher', lastPurchasedAt: daysAgo(124) }),
      ],
      NOW
    );
    expect(names(deck)).toEqual(['Fresher', 'Older']);
  });

  it('asks about the guess closest to running out first', () => {
    const deck = buildPantryReviewDeck(
      [
        makeItem({ name: 'Recent', lastPurchasedAt: daysAgo(3) }),
        makeItem({ name: 'Stale', lastPurchasedAt: daysAgo(100) }),
      ],
      NOW
    );
    expect(names(deck)).toEqual(['Stale', 'Recent']);
  });
});

// ─── The cap ─────────────────────────────────────────────────────────────────

describe('the cap', () => {
  it('holds the deck to one session and reports what it left out', () => {
    const items = Array.from({ length: MAX_PANTRY_REVIEW_CARDS + 4 }, (_, i) =>
      makeItem({ name: `Thing ${i}` })
    );
    const deck = buildPantryReviewDeck(items, NOW);
    expect(deck.cards).toHaveLength(MAX_PANTRY_REVIEW_CARDS);
    expect(deck.omitted).toBe(4);
  });

  it('spends the cap on the doubtful end', () => {
    const items = [
      ...Array.from({ length: MAX_PANTRY_REVIEW_CARDS }, (_, i) => makeItem({ name: `Guess ${i}` })),
      makeItem({ name: 'Lapsed', lastPurchasedAt: daysAgo(130) }),
    ];
    const deck = buildPantryReviewDeck(items, NOW);
    expect(names(deck)[0]).toBe('Lapsed');
    expect(deck.omitted).toBe(1);
  });

  it('reports nothing omitted when the deck fits', () => {
    expect(buildPantryReviewDeck([makeItem({ name: 'Flour' })], NOW).omitted).toBe(0);
  });
});

// ─── Copy ────────────────────────────────────────────────────────────────────

describe('describePantryDoubt', () => {
  it('names the lapse in days', () => {
    const deck = buildPantryReviewDeck([makeItem({ name: 'Flour', lastPurchasedAt: daysAgo(130) })], NOW);
    expect(describePantryDoubt(deck.cards[0])).toBe('Guess ran out 8 days ago');
  });

  it('has a word for today and yesterday', () => {
    expect(describePantryDoubt({ doubt: 'lapsed', lapsedDays: 0 } as never)).toBe('Guess ran out today');
    expect(describePantryDoubt({ doubt: 'lapsed', lapsedDays: 1 } as never)).toBe('Guess ran out yesterday');
  });

  it('says nothing on a card whose own reason line already says how sure the app is', () => {
    const deck = buildPantryReviewDeck([makeItem({ name: 'Flour' })], NOW);
    expect(describePantryDoubt(deck.cards[0])).toBeNull();
  });
});

describe('describeLastPurchase', () => {
  it('dates the purchase in the same shape the reading itself uses', () => {
    expect(describeLastPurchase({ lastPurchasedAt: '2026-08-12T09:00:00.000Z' })).toBe('Last bought Aug 12');
  });

  it('is null for a row never bought, and for an unparseable stamp', () => {
    expect(describeLastPurchase({ lastPurchasedAt: null })).toBeNull();
    expect(describeLastPurchase({ lastPurchasedAt: 'not a date' })).toBeNull();
  });
});

describe('describePantryReviewDone', () => {
  it('counts what was answered', () => {
    expect(describePantryReviewDone(1, 0)).toBe('Checked 1 thing.');
    expect(describePantryReviewDone(7, 0)).toBe('Checked 7 things.');
  });

  it('names the cap leftovers rather than reading as a whole cupboard covered', () => {
    expect(describePantryReviewDone(20, 4)).toBe('Checked 20 things. 4 more to go through next time.');
  });

  it('has an answer for a session nobody answered', () => {
    expect(describePantryReviewDone(0, 0)).toBe('Nothing checked.');
  });
});
