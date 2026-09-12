import {
  ensureProductFor,
  newItemRow,
  nextSortOrder,
  planGroceryAdd,
  type GroceryAddContext,
} from '../utils/groceryAdd';
import type { GroceryItem, GroceryListEntry } from '../types';

/** Rows are built by the factory under test, which is also the only copy of them. */
const row = (name: string, nameKey: string, over: Partial<GroceryItem> = {}): GroceryItem => ({
  ...newItemRow({
    name,
    nameKey,
    aisle: 'Other',
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    onList: true,
  }),
  ...over,
});

const context = (over: Partial<GroceryAddContext> = {}): GroceryAddContext => ({
  items: [],
  itemProducts: [],
  listEntries: [],
  aisleOverrides: {},
  aisleOrder: ['Produce', 'Dairy & Eggs', 'Pantry', 'Other'],
  listId: null,
  now: '2026-03-10T09:00:00.000Z',
  ...over,
});

const entry = (itemId: string, over: Partial<GroceryListEntry> = {}): GroceryListEntry => ({
  itemId,
  listId: null,
  checked: false,
  sortOrder: 1,
  choiceGroup: null,
  addedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('nextSortOrder', () => {
  it('lands past everything already there', () => {
    expect(nextSortOrder([])).toBe(1);
    expect(nextSortOrder([row('A', 'a', { sortOrder: 4 }), row('B', 'b', { sortOrder: 2 })])).toBe(5);
  });
});

describe('newItemRow', () => {
  it('mints a row nobody has done anything to yet', () => {
    const item = newItemRow({
      name: 'Milk', nameKey: 'milk', aisle: 'Dairy', sortOrder: 3,
      createdAt: '2026-03-10T09:00:00.000Z', onList: true,
    });
    expect(item).toMatchObject({ name: 'Milk', nameKey: 'milk', aisle: 'Dairy', onList: true });
    expect(item.purchaseCount).toBe(0);
    expect(item.priceHistory).toEqual([]);
  });

  // A name typed onto the list is a plan to buy something, not a jar on the
  // counter: nothing about the pantry or a price is true of it yet.
  it('claims nothing about the pantry or the price', () => {
    const item = newItemRow({
      name: 'Milk', nameKey: 'milk', aisle: 'Dairy', sortOrder: 1,
      createdAt: '2026-03-10T09:00:00.000Z', onList: true,
    });
    expect(item.expiresAt).toBeNull();
    expect(item.frozenAt).toBeNull();
    expect(item.openedAt).toBeNull();
    expect(item.lastPriceMinor).toBeNull();
    expect(item.lastPurchasedAt).toBeNull();
    // Unknown, which is a different thing from "contains nothing".
    expect(item.nutrition).toBeNull();
  });

  it('stamps lastAddedAt only for a row that is going on the list', () => {
    const base = { name: 'Milk', nameKey: 'milk', aisle: 'Dairy', sortOrder: 1, createdAt: 'T' };
    expect(newItemRow({ ...base, onList: true }).lastAddedAt).toBe('T');
    expect(newItemRow({ ...base, onList: false }).lastAddedAt).toBeNull();
  });
});

describe('ensureProductFor', () => {
  it('is nothing when neither half names anything', () => {
    expect(ensureProductFor('i1', null, null, [], 'T')).toBeNull();
  });

  it('mints one, unrated and unclaimed', () => {
    const made = ensureProductFor('i1', "Arnold's", null, [], 'T')!;
    expect(made.created).toBe(true);
    expect(made.product).toMatchObject({ itemId: 'i1', brand: "Arnold's", rating: null, purchaseCount: 0 });
    // Naming a box is not a claim to be holding one.
    expect(made.product.onHandUntil).toBeNull();
    expect(made.product.gtin).toBeNull();
  });

  // The UNIQUE index is on productKeyFor, so a second one would split the same
  // box's rating and purchase count in two.
  it('finds the box that is already there rather than minting a second', () => {
    const first = ensureProductFor('i1', "Arnold's", null, [], 'T')!.product;
    const again = ensureProductFor('i1', "ARNOLD'S", null, [first], 'T')!;
    expect(again.created).toBe(false);
    expect(again.product.id).toBe(first.id);
    // The stored spelling is left alone: re-typing it is a match, not a
    // correction. Editing it is the product sheet's job.
    expect(again.product.brand).toBe("Arnold's");
  });

  // productKeyFor goes through groceryNameKey, which keeps only letters, digits
  // and %, so an apostrophe becomes a space rather than being dropped:
  // "Arnold's" keys as `arnold s` and "arnolds" as `arnolds`. The two are
  // different boxes. Pinned because the comment beside ensureProductFor reads
  // as though they would match, and because a change to the key would be felt
  // here first.
  it('treats a punctuation difference as a different box', () => {
    const first = ensureProductFor('i1', "Arnold's", null, [], 'T')!.product;
    expect(ensureProductFor('i1', 'arnolds', null, [first], 'T')!.created).toBe(true);
  });
});

describe('planGroceryAdd', () => {
  describe('a name nobody has typed before', () => {
    it('mints a row and joins the list', () => {
      const plan = planGroceryAdd('milk', context());
      expect(plan.isNew).toBe(true);
      expect(plan.item.name).toBe('milk');
      expect(plan.item.onList).toBe(true);
      expect(plan.entry).toMatchObject({ itemId: plan.item.id, listId: null, checked: false });
      expect(plan.wasOnList).toBe(false);
    });

    it('splits a quantity off the front', () => {
      const plan = planGroceryAdd('2 gal milk', context());
      expect(plan.item.quantity).toBe('2 gal');
      expect(plan.item.nameKey).toBe('milk');
    });

    // A name with no letters or digits normalises to an empty key, and two such
    // rows would collide on the UNIQUE index.
    it('keeps a key for a name that normalises to nothing', () => {
      expect(planGroceryAdd('???', context()).item.nameKey).toBe('???');
    });
  });

  describe('the aisle', () => {
    it('files by the name lexicon when nothing else knows better', () => {
      expect(planGroceryAdd('milk', context()).item.aisle).toBe('Dairy & Eggs');
    });

    // The lexicon is a guess about groceries; a remembered filing is a fact
    // about this person's shop.
    it('prefers where the user filed the name last time', () => {
      const plan = planGroceryAdd('milk', context({ aisleOverrides: { milk: 'Pantry' } }));
      expect(plan.item.aisle).toBe('Pantry');
    });

    it('takes a source category only when both of the others are silent', () => {
      const override = { name: 'Snarfblat', quantity: null, aisle: 'Pantry' };
      expect(planGroceryAdd('', context(), override).item.aisle).toBe('Pantry');
    });

    // Neither the lexicon nor a remembered filing knows what the user deleted,
    // so naming a gone aisle here would bring its whole section back.
    it('clamps to Other when the aisle it wanted no longer exists', () => {
      const plan = planGroceryAdd('milk', context({ aisleOrder: ['Produce', 'Other'] }));
      expect(plan.item.aisle).toBe('Other');
    });
  });

  describe('a name that resolves to a row already in the catalog', () => {
    const milk = row('Milk', 'milk', { id: 'm1', quantity: '2 gal', note: 'skimmed', onList: false });

    it('updates that row rather than minting a second', () => {
      const plan = planGroceryAdd('milk', context({ items: [milk] }));
      expect(plan.isNew).toBe(false);
      expect(plan.item.id).toBe('m1');
    });

    it('takes the typed name on an exact key, since the wording is the user\'s', () => {
      expect(planGroceryAdd('MILK', context({ items: [milk] })).item.name).toBe('MILK');
    });

    // nameKey is derived from name and every reader trusts that, so renaming a
    // row reached through its plural would leave it keyed for a name it no
    // longer carries.
    it('never renames a row it reached through the plural', () => {
      const peppers = row('Serrano peppers', 'serrano peppers', { id: 'p1' });
      const plan = planGroceryAdd('serrano pepper', context({ items: [peppers] }));
      expect(plan.isNew).toBe(false);
      expect(plan.item.id).toBe('p1');
      expect(plan.item.name).toBe('Serrano peppers');
    });

    it('leaves the quantity and note alone when the add carried neither', () => {
      const plan = planGroceryAdd('milk', context({ items: [milk] }));
      expect(plan.item.quantity).toBe('2 gal');
      expect(plan.item.note).toBe('skimmed');
    });

    it('takes ownership of the quantity away from a recipe when one is typed', () => {
      const owned = { ...milk, quantityFromRecipe: true };
      const plan = planGroceryAdd('3 gal milk', context({ items: [owned] }));
      expect(plan.item.quantity).toBe('3 gal');
      expect(plan.item.quantityFromRecipe).toBe(false);
    });

    it('credits a recipe only for a row that had fallen off every list', () => {
      const source = { recipeId: 'r1', recipeTitle: 'Pancakes' };
      expect(planGroceryAdd('milk', context({ items: [milk] }), undefined, source).item.sourceRecipeId)
        .toBe('r1');

      // Still in a trolley: a standing item the user owns, so a recipe adding
      // it again does not relabel it.
      const listed = { ...milk, onList: true };
      expect(planGroceryAdd('milk', context({ items: [listed] }), undefined, source).item.sourceRecipeId)
        .toBeNull();
    });
  });

  describe('the membership', () => {
    const milk = row('Milk', 'milk', { id: 'm1' });

    it('leaves an entry this list already has alone', () => {
      const plan = planGroceryAdd('milk', context({ items: [milk], listEntries: [entry('m1')] }));
      // Null means "write nothing": the tick and the slot it already had
      // survive, so typing milk twice does not un-tick the milk in the cart.
      expect(plan.entry).toBeNull();
    });

    it('keeps the tick a row already in this trolley has', () => {
      const plan = planGroceryAdd(
        'milk',
        context({ items: [milk], listEntries: [entry('m1', { checked: true })] }),
      );
      expect(plan.item.checked).toBe(true);
    });

    it('leaves a row with no trolley entry unticked', () => {
      const plan = planGroceryAdd('milk', context({ items: [{ ...milk, checked: true }] }));
      expect(plan.item.checked).toBe(false);
    });

    // Join, not move. This is the whole reason membership is a table.
    it('joins a second list without leaving the first', () => {
      const plan = planGroceryAdd(
        'milk',
        context({ items: [milk], listEntries: [entry('m1')], listId: 'away' }),
      );
      expect(plan.entry).toMatchObject({ itemId: 'm1', listId: 'away' });
    });

    it('writes a named either/or onto an entry that already exists', () => {
      const plan = planGroceryAdd(
        'milk',
        context({ items: [milk], listEntries: [entry('m1', { checked: true, sortOrder: 7 })] }),
        { name: 'Milk', quantity: null, choiceGroup: 'pair-1' },
      );
      expect(plan.entry).toMatchObject({ choiceGroup: 'pair-1', checked: true, sortOrder: 7 });
    });
  });

  describe('a brand or variant typed alongside', () => {
    it('mints the product and makes it the preference', () => {
      const plan = planGroceryAdd('bread', context(), { name: 'Bread', quantity: null, brand: "Arnold's" });
      expect(plan.product).not.toBeNull();
      expect(plan.item.preferredProductId).toBe(plan.product!.id);
    });

    it('reports nothing to write when the box is already there', () => {
      const bread = row('Bread', 'bread', { id: 'b1' });
      const existing = ensureProductFor('b1', "Arnold's", null, [], 'T')!.product;
      const plan = planGroceryAdd(
        'bread',
        context({ items: [bread], itemProducts: [existing] }),
        { name: 'Bread', quantity: null, brand: "Arnold's" },
      );
      expect(plan.product).toBeNull();
      expect(plan.item.preferredProductId).toBe(existing.id);
    });
  });
});
