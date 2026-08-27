import {
  catalogMatchSummary,
  matchIngredientToCatalog,
  matchIngredientsToCatalog,
  withinOneEdit,
} from '../utils/ingredientCatalogMatch';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem } from '../types';

const NOW = new Date('2026-08-25T12:00:00.000Z');

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
    checked: false,
    sortOrder: seq,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: daysAgo(365),
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
    varietyOfKey: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    ...overrides,
  };
}

// ─── withinOneEdit ───────────────────────────────────────────────────────────

describe('withinOneEdit', () => {
  it('accepts an identical pair', () => {
    expect(withinOneEdit('skyr', 'skyr')).toBe(true);
  });

  it('accepts a substitution', () => {
    expect(withinOneEdit('skir', 'skyr')).toBe(true);
  });

  it('accepts an insertion at either end and in the middle', () => {
    expect(withinOneEdit('sky', 'skyr')).toBe(true);
    expect(withinOneEdit('kyr', 'skyr')).toBe(true);
    expect(withinOneEdit('yoghurt', 'yohurt')).toBe(true);
  });

  it('refuses two edits', () => {
    expect(withinOneEdit('butter', 'batter')).toBe(true); // one substitution
    expect(withinOneEdit('butter', 'bitten')).toBe(false);
  });

  it('refuses a length gap wider than one', () => {
    expect(withinOneEdit('milk', 'milkshake')).toBe(false);
  });

  it('counts a transposition as two edits, so it is refused', () => {
    // Deliberate: see the doc comment. Damerau would accept this one.
    expect(withinOneEdit('yogurt', 'yougrt')).toBe(false);
  });
});

// ─── matchIngredientToCatalog ────────────────────────────────────────────────

describe('matchIngredientToCatalog', () => {
  it('links an exact name, case and punctuation aside', () => {
    const items = [makeItem({ name: 'Skyr' })];
    const match = matchIngredientToCatalog('skyr', items, NOW);
    expect(match.kind).toBe('linked');
    expect(match.item?.name).toBe('Skyr');
    expect(match.suggestedName).toBeNull();
  });

  it('links a generic the catalog holds a declared variety of, offering nothing to rename', () => {
    // "onion" with only White onion in the catalog used to badge the row with
    // a rename offer — the over-specifying the variety declaration replaces.
    const items = [makeItem({ name: 'White onion', varietyOfKey: 'onion' })];
    const match = matchIngredientToCatalog('onion', items, NOW);
    expect(match.kind).toBe('linked');
    expect(match.reason).toBe('variety');
    expect(match.item?.name).toBe('White onion');
    expect(match.suggestedName).toBeNull();
  });

  it('refuses the ranked tier when two candidates score identically', () => {
    // Both score matchWeight 2 against "onion" with equal familiarity, so the
    // sort falls through to name length and the alphabet — no basis for a
    // correction offered as the answer.
    const items = [makeItem({ name: 'White onion' }), makeItem({ name: 'Red onion' })];
    expect(matchIngredientToCatalog('onion', items, NOW).kind).toBe('unknown');
  });

  it('still ranks when familiarity actually separates the two', () => {
    // A tie is refused; a decision is not. Buying one of them weekly is real
    // evidence, and is what the ranked tier exists to read.
    const items = [
      makeItem({ name: 'White onion', purchaseCount: 12, lastPurchasedAt: daysAgo(3) }),
      makeItem({ name: 'Red onion' }),
    ];
    const match = matchIngredientToCatalog('onion', items, NOW);
    expect(match.kind).toBe('suggested');
    expect(match.reason).toBe('ranked');
    expect(match.suggestedName).toBe('White onion');
  });

  it('lets a lower tier answer a line the ranked tie refused', () => {
    // Refusing the tier is not refusing the line: `similar` still gets its
    // turn, which is why the ranked tier falls through rather than returning
    // no match outright.
    const items = [
      makeItem({ name: 'Onion soup mix' }),
      makeItem({ name: 'Onion powder' }),
      makeItem({ name: 'Onian' }),
    ];
    const match = matchIngredientToCatalog('onion', items, NOW);
    expect(match.reason).toBe('similar');
    expect(match.suggestedName).toBe('Onian');
  });

  it('prefers an exact row over a variety declaration', () => {
    const items = [
      makeItem({ name: 'White onion', varietyOfKey: 'onion' }),
      makeItem({ name: 'Onion' }),
    ];
    const match = matchIngredientToCatalog('onion', items, NOW);
    expect(match.kind).toBe('linked');
    expect(match.reason).toBeNull();
    expect(match.item?.name).toBe('Onion');
  });

  it('answers unknown for an empty or unparseable name', () => {
    const items = [makeItem({ name: 'Skyr' })];
    expect(matchIngredientToCatalog('', items, NOW).kind).toBe('unknown');
    expect(matchIngredientToCatalog('   ', items, NOW).kind).toBe('unknown');
  });

  it('answers unknown when the catalog is empty', () => {
    expect(matchIngredientToCatalog('skyr', [], NOW).kind).toBe('unknown');
  });

  it('answers unknown for a genuinely new ingredient', () => {
    const items = [makeItem({ name: 'Milk' }), makeItem({ name: 'Bread' })];
    expect(matchIngredientToCatalog('saffron threads', items, NOW).kind).toBe('unknown');
  });

  it('offers the shorter name when a leading word is dropped', () => {
    const items = [makeItem({ name: 'Garlic' })];
    const match = matchIngredientToCatalog('cloves garlic', items, NOW);
    expect(match.kind).toBe('suggested');
    expect(match.reason).toBe('shorter');
    expect(match.suggestedName).toBe('Garlic');
  });

  it('offers a catalog name that is the opening words of the line', () => {
    const items = [makeItem({ name: 'Greek yogurt' })];
    const match = matchIngredientToCatalog('greek yogurt plain', items, NOW);
    expect(match.kind).toBe('suggested');
    expect(match.reason).toBe('prefix');
    expect(match.suggestedName).toBe('Greek yogurt');
  });

  it('prefers the longest catalog name that prefixes the line', () => {
    const items = [makeItem({ name: 'Yogurt' }), makeItem({ name: 'Greek yogurt' })];
    const match = matchIngredientToCatalog('greek yogurt plain', items, NOW);
    expect(match.suggestedName).toBe('Greek yogurt');
  });

  it('will not let a prefix match cross a word boundary', () => {
    // "egg" must not claim "eggplant" — the space is the whole safety of it.
    const items = [makeItem({ name: 'Egg' })];
    expect(matchIngredientToCatalog('eggplant', items, NOW).reason).not.toBe('prefix');
  });

  it('takes the autocomplete ranking, which carries plural tolerance', () => {
    const items = [makeItem({ name: 'Bananas' })];
    const match = matchIngredientToCatalog('banana', items, NOW);
    expect(match.kind).toBe('suggested');
    expect(match.suggestedName).toBe('Bananas');
  });

  it('offers a one-character correction', () => {
    const items = [makeItem({ name: 'Skyr' })];
    const match = matchIngredientToCatalog('skir', items, NOW);
    expect(match.kind).toBe('suggested');
    expect(match.reason).toBe('similar');
    expect(match.suggestedName).toBe('Skyr');
  });

  it('refuses a one-character correction when two rows are equally close', () => {
    // Beet, beef and beer are all one substitution apart and all real. A
    // suggestion that picked one would be a coin flip dressed as a correction.
    const items = [makeItem({ name: 'Beef' }), makeItem({ name: 'Beer' })];
    expect(matchIngredientToCatalog('beet', items, NOW).kind).toBe('unknown');
  });

  it('refuses a one-character correction on a very short name', () => {
    const items = [makeItem({ name: 'Ham' })];
    expect(matchIngredientToCatalog('jam', items, NOW).kind).toBe('unknown');
  });

  it('prefers an exact link over any suggestion', () => {
    const items = [makeItem({ name: 'Garlic' }), makeItem({ name: 'Cloves garlic' })];
    const match = matchIngredientToCatalog('cloves garlic', items, NOW);
    expect(match.kind).toBe('linked');
    expect(match.item?.name).toBe('Cloves garlic');
  });
});

// ─── matchIngredientsToCatalog / catalogMatchSummary ─────────────────────────

describe('matchIngredientsToCatalog', () => {
  it('answers in the order given', () => {
    const items = [makeItem({ name: 'Skyr' }), makeItem({ name: 'Garlic' })];
    const matches = matchIngredientsToCatalog(
      ['skyr', 'cloves garlic', 'saffron threads'],
      items,
      NOW
    );
    expect(matches.map(m => m.kind)).toEqual(['linked', 'suggested', 'unknown']);
  });

  it('agrees with the single-line call', () => {
    const items = [makeItem({ name: 'Skyr' })];
    const [batch] = matchIngredientsToCatalog(['skir'], items, NOW);
    const single = matchIngredientToCatalog('skir', items, NOW);
    expect(batch).toEqual(single);
  });
});

describe('catalogMatchSummary', () => {
  it('counts each kind, and totals to the number of lines', () => {
    const items = [makeItem({ name: 'Skyr' }), makeItem({ name: 'Garlic' })];
    const summary = catalogMatchSummary(
      matchIngredientsToCatalog(['skyr', 'cloves garlic', 'saffron threads'], items, NOW)
    );
    expect(summary).toEqual({ total: 3, linked: 1, suggested: 1, unknown: 1 });
  });

  it('is all zeroes for a recipe with no ingredients', () => {
    expect(catalogMatchSummary([])).toEqual({ total: 0, linked: 0, suggested: 0, unknown: 0 });
  });
});
