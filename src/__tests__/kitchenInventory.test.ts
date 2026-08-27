import {
  buildKitchenSections,
  compareKitchenEntries,
  describeKitchen,
  FREEZER_SECTION,
  FRIDGE_SECTION,
  kitchenEntryId,
  kitchenInventory,
  kitchenLinkUrl,
  parseKitchenEntryId,
  useUpEntries,
} from '../utils/kitchenInventory';
import { groceryNameKey } from '../utils/groceryParse';
import { OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
import type { GroceryItem, ItemProduct, Leftover } from '../types';

let productSeq = 0;

// The chain here reaches dateUtils (day keys) which reaches the settings store
// for dayResetTime — which nothing here needs, since a day key is a calendar
// day and carries no time at all. Same stub leftovers.test.ts uses.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

// A Thursday, mid-afternoon — the whole module is calendar-day arithmetic, so
// pinning "now" is what stops this being a different test at 23:59.
const NOW = new Date(2026, 7, 13, 15, 0, 0);

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

let seq = 0;

/** On hand by an explicit assertion, so no purchase history has to be staged. */
function makeItem(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  const name = overrides.name;
  seq += 1;
  return {
    id: `gi-${seq}`,
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
    onHandUntil: daysAgo(-5),
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
    lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  };
}

function makeLeftover(overrides: Partial<Leftover> & { title: string }): Leftover {
  seq += 1;
  return {
    id: `lo-${seq}`,
    recipeId: null,
    sourceEntryId: null,
    storedAt: daysAgo(2),
    keepUntil: '2026-08-16',
    finishedAt: null,
    outcome: null,
    frozenAt: null,
    createdAt: daysAgo(2),
    useUpTask: null,
    ...overrides,
  };
}

// ─── kitchenInventory ───────────────────────────────────────────────────────

describe('kitchenInventory', () => {
  it('merges the pantry and the fridge into one list', () => {
    const entries = kitchenInventory(
      [makeItem({ name: 'Rice' })],
      [makeLeftover({ title: 'Chilli' })],
      NOW
    );
    expect(entries.map(e => [e.kind, e.title])).toEqual([
      ['leftover', 'Chilli'],
      ['grocery', 'Rice'],
    ]);
  });

  it('prefixes the list key by kind but keeps the store key its own field', () => {
    const item = makeItem({ name: 'Rice' });
    const [entry] = kitchenInventory([item], [], NOW);
    expect(entry.id).toBe(`grocery-${item.id}`);
    expect(entry.sourceId).toBe(item.id);
  });

  it('is exactly what probablyHaveReason answers for, and carries its wording', () => {
    const marked = makeItem({ name: 'Rice' });
    const out = makeItem({ name: 'Olive oil', onHandUntil: daysAgo(1) });
    const unknown = makeItem({ name: 'Saffron', onHandUntil: null });

    const entries = kitchenInventory([marked, out, unknown], [], NOW);
    expect(entries.map(e => e.title)).toEqual(['Rice']);
    expect(entries[0].reason).toBe('marked as on hand');
  });

  it('leaves a use-by day on a row the pantry no longer vouches for out of it', () => {
    // expiresAt outlives the food — nothing clears it when the bag is
    // finished — so an "Out of it" row must not stay in the kitchen for ever
    // on the strength of a stale date.
    const out = makeItem({ name: 'Spinach', onHandUntil: daysAgo(1), expiresAt: '2026-08-14' });
    expect(kitchenInventory([out], [], NOW)).toEqual([]);
  });

  it('drops a leftover that has been closed out', () => {
    const eaten = makeLeftover({ title: 'Chilli', finishedAt: daysAgo(1), outcome: 'eaten' });
    expect(kitchenInventory([], [eaten], NOW)).toEqual([]);
  });

  it('reads a perishable through the same ladder as a container', () => {
    const spinach = makeItem({ name: 'Spinach', expiresAt: '2026-08-14' });
    const chilli = makeLeftover({ title: 'Chilli', keepUntil: '2026-08-14' });
    const [fridge, pantry] = kitchenInventory([spinach], [chilli], NOW);
    expect(fridge.freshness).toBe('soon');
    expect(pantry.freshness).toBe('soon');
    expect(fridge.useByCaption).toBe('Use by tomorrow');
    expect(pantry.useByCaption).toBe('Use by tomorrow');
  });

  it('leaves a pantry row with no use-by day off the ladder entirely', () => {
    const [entry] = kitchenInventory([makeItem({ name: 'Rice' })], [], NOW);
    expect(entry.useBy).toBeNull();
    expect(entry.freshness).toBeNull();
    expect(entry.daysLeft).toBeNull();
    expect(entry.useByCaption).toBe('');
    // …and its caption is the reason on its own, with no trailing separator.
    expect(entry.caption).toBe('marked as on hand');
  });

  it('composes a caption from the reason and the use-by clause', () => {
    const [entry] = kitchenInventory(
      [makeItem({ name: 'Spinach', expiresAt: '2026-08-13' })],
      [],
      NOW
    );
    expect(entry.caption).toBe('marked as on hand · Use by today');
  });

  it('keeps a row that is also on the list, and says so', () => {
    const [entry] = kitchenInventory([makeItem({ name: 'Rice', onList: true })], [], NOW);
    expect(entry.onList).toBe(true);
  });

  it('files a container in the fridge and a catalog row in its aisle', () => {
    const entries = kitchenInventory(
      [makeItem({ name: 'Rice', aisle: 'Pantry' })],
      [makeLeftover({ title: 'Chilli' })],
      NOW
    );
    expect(entries.map(e => e.section)).toEqual([FRIDGE_SECTION, 'Pantry']);
  });
});

// ─── compareKitchenEntries ──────────────────────────────────────────────────

describe('compareKitchenEntries', () => {
  it('puts what is on a clock ahead of what is not', () => {
    const entries = kitchenInventory(
      [makeItem({ name: 'Rice' }), makeItem({ name: 'Spinach', expiresAt: '2026-08-20' })],
      [],
      NOW
    );
    expect(entries.map(e => e.title)).toEqual(['Spinach', 'Rice']);
  });

  it('ranks by the day itself, so over leads due leads soon leads fresh', () => {
    const entries = kitchenInventory(
      [
        makeItem({ name: 'Fresh', expiresAt: '2026-08-20' }),
        makeItem({ name: 'Due', expiresAt: '2026-08-13' }),
        makeItem({ name: 'Over', expiresAt: '2026-08-11' }),
        makeItem({ name: 'Soon', expiresAt: '2026-08-14' }),
      ],
      [],
      NOW
    );
    expect(entries.map(e => e.freshness)).toEqual(['over', 'due', 'soon', 'fresh']);
  });

  it('breaks a tie toward the container — a cooked portion spoils harder', () => {
    const entries = kitchenInventory(
      [makeItem({ name: 'Spinach', expiresAt: '2026-08-13' })],
      [makeLeftover({ title: 'Zucchini bake', keepUntil: '2026-08-13' })],
      NOW
    );
    expect(entries.map(e => e.title)).toEqual(['Zucchini bake', 'Spinach']);
  });

  it('falls back to the name, so the order does not depend on insertion', () => {
    const entries = kitchenInventory(
      [makeItem({ name: 'Rice' }), makeItem({ name: 'Flour' })],
      [],
      NOW
    );
    expect(entries.map(e => e.title)).toEqual(['Flour', 'Rice']);
  });

  it('is the sort kitchenInventory already applied', () => {
    const entries = kitchenInventory(
      [makeItem({ name: 'Rice' }), makeItem({ name: 'Spinach', expiresAt: '2026-08-14' })],
      [makeLeftover({ title: 'Chilli', keepUntil: '2026-08-11' })],
      NOW
    );
    expect([...entries].sort(compareKitchenEntries)).toEqual(entries);
  });
});

// ─── useUpEntries / the summaries ───────────────────────────────────────────

describe('useUpEntries', () => {
  it('is what is down to its last day or past it, in rank order', () => {
    const entries = kitchenInventory(
      [
        makeItem({ name: 'Rice' }),
        makeItem({ name: 'Milk', expiresAt: '2026-08-20' }),
        makeItem({ name: 'Spinach', expiresAt: '2026-08-14' }),
      ],
      [makeLeftover({ title: 'Chilli', keepUntil: '2026-08-12' })],
      NOW
    );
    expect(useUpEntries(entries).map(e => e.title)).toEqual(['Chilli', 'Spinach']);
  });

  it('is empty rather than a placeholder when nothing is dying', () => {
    const entries = kitchenInventory([makeItem({ name: 'Rice' })], [], NOW);
    expect(useUpEntries(entries)).toEqual([]);
  });
});

describe('describeKitchen', () => {
  it('says nothing at all about an empty kitchen', () => {
    expect(describeKitchen([])).toBe('');
  });

  it('counts, and adds the use-up clause only when there is one', () => {
    const quiet = kitchenInventory([makeItem({ name: 'Rice' })], [], NOW);
    expect(describeKitchen(quiet)).toBe('1 thing in the pantry');

    const urgent = kitchenInventory(
      [makeItem({ name: 'Rice' }), makeItem({ name: 'Spinach', expiresAt: '2026-08-13' })],
      [makeLeftover({ title: 'Chilli', keepUntil: '2026-08-12' })],
      NOW
    );
    expect(describeKitchen(urgent)).toBe('3 things in the pantry · 2 to use up');
  });
});

// ─── buildKitchenSections ───────────────────────────────────────────────────

describe('buildKitchenSections', () => {
  const marked = (name: string, aisle: string, expiresAt: string | null = null) =>
    makeItem({ name, aisle, expiresAt });

  const sectionsOf = (
    items: GroceryItem[],
    leftovers: Leftover[],
    aisleOrder: string[],
    query = ''
  ) => buildKitchenSections(kitchenInventory(items, leftovers, NOW), aisleOrder, query);

  it('cuts the pantry into aisles in walk order', () => {
    const sections = sectionsOf(
      [marked('Rice', 'Pantry'), marked('Milk', 'Dairy & Eggs')],
      [],
      ['Dairy & Eggs', 'Pantry']
    );
    expect(sections.map(s => s.section)).toEqual(['Dairy & Eggs', 'Pantry']);
    expect(sections[0].data.map(e => e.title)).toEqual(['Milk']);
  });

  it('leads with the fridge, which is a place rather than an aisle', () => {
    const sections = sectionsOf(
      [marked('Milk', 'Dairy & Eggs')],
      [makeLeftover({ title: 'Chilli' })],
      ['Dairy & Eggs']
    );
    expect(sections.map(s => s.section)).toEqual([FRIDGE_SECTION, 'Dairy & Eggs']);
  });

  it('has no fridge heading when nothing is in it', () => {
    const sections = sectionsOf([marked('Rice', 'Pantry')], [], ['Pantry']);
    expect(sections.map(s => s.section)).toEqual(['Pantry']);
  });

  it('still renders an aisle the order has never heard of', () => {
    const sections = sectionsOf([marked('Steak', 'Butcher')], [], ['Produce']);
    expect(sections.map(s => s.section)).toEqual(['Butcher']);
  });

  it('drops an aisle with nothing on hand in it', () => {
    const sections = sectionsOf([marked('Rice', 'Pantry')], [], ['Produce', 'Pantry']);
    expect(sections.map(s => s.section)).toEqual(['Pantry']);
  });

  it('sorts within an aisle by urgency, then by name', () => {
    const sections = sectionsOf(
      [marked('Rice', 'Pantry'), marked('Flour', 'Pantry'), marked('Bread', 'Pantry', '2026-08-13')],
      [],
      ['Pantry']
    );
    expect(sections[0].data.map(e => e.title)).toEqual(['Bread', 'Flour', 'Rice']);
  });

  it('filters by name, so "do I have flour" is one field away', () => {
    const sections = sectionsOf(
      [marked('Rice', 'Pantry'), marked('Flour', 'Pantry')],
      [],
      ['Pantry'],
      'flo'
    );
    expect(sections[0].data.map(e => e.title)).toEqual(['Flour']);
  });

  it('matches a container by name too', () => {
    const sections = sectionsOf(
      [marked('Rice', 'Pantry')],
      [makeLeftover({ title: 'Chilli' })],
      ['Pantry'],
      'chil'
    );
    expect(sections.map(s => s.section)).toEqual([FRIDGE_SECTION]);
  });

  it('is empty rather than unfiltered when nothing matches', () => {
    expect(sectionsOf([marked('Rice', 'Pantry')], [], ['Pantry'], 'saffron')).toEqual([]);
  });
});

describe('kitchenEntryId', () => {
  it('kind-prefixes the raw id — what KitchenEntry.id is built from', () => {
    expect(kitchenEntryId('grocery', 'abc123')).toBe('grocery-abc123');
    expect(kitchenEntryId('leftover', 'abc123')).toBe('leftover-abc123');
  });
});

describe('parseKitchenEntryId', () => {
  it('round-trips what kitchenEntryId built', () => {
    expect(parseKitchenEntryId(kitchenEntryId('grocery', 'abc123')))
      .toEqual({ kind: 'grocery', sourceId: 'abc123' });
    expect(parseKitchenEntryId(kitchenEntryId('leftover', 'abc123')))
      .toEqual({ kind: 'leftover', sourceId: 'abc123' });
  });

  it('splits on the first hyphen, since a generated id may hold others', () => {
    expect(parseKitchenEntryId('grocery-ab-cd-ef'))
      .toEqual({ kind: 'grocery', sourceId: 'ab-cd-ef' });
  });

  it('refuses anything that is not one of these', () => {
    expect(parseKitchenEntryId('recipe-abc')).toBeNull();
    expect(parseKitchenEntryId('grocery-')).toBeNull();
    expect(parseKitchenEntryId('-abc')).toBeNull();
    expect(parseKitchenEntryId('grocery')).toBeNull();
    expect(parseKitchenEntryId('')).toBeNull();
  });
});

describe('kitchenLinkUrl', () => {
  it('is the bare kitchen link when no entry is named', () => {
    expect(kitchenLinkUrl()).toBe('dundundun://kitchen');
    expect(kitchenLinkUrl(null)).toBe('dundundun://kitchen');
  });

  it('names one entry, so the sheet can open straight to it', () => {
    expect(kitchenLinkUrl(kitchenEntryId('grocery', 'abc123'))).toBe(
      'dundundun://kitchen?item=grocery-abc123'
    );
  });
});

// ─── the freezer ────────────────────────────────────────────────────────────

describe('the freezer', () => {
  const FROZEN_ON = '2026-07-12T09:00:00.000Z';

  it('files a frozen catalog row under the freezer rather than its aisle', () => {
    const peas = makeItem({ name: 'Peas', aisle: 'Frozen', frozenAt: FROZEN_ON });
    const [entry] = kitchenInventory([peas], [], NOW);
    expect(entry.section).toBe(FREEZER_SECTION);
  });

  it('files a frozen container under the freezer rather than the fridge', () => {
    const chilli = makeLeftover({ title: 'Chilli', frozenAt: FROZEN_ON });
    const [entry] = kitchenInventory([], [chilli], NOW);
    expect(entry.section).toBe(FREEZER_SECTION);
  });

  // The suspension, seen from the row: the stored day is still on the record
  // and none of it reaches the view model.
  it('suspends the countdown without the row having lost its day', () => {
    const spinach = makeItem({ name: 'Spinach', expiresAt: '2026-08-14', frozenAt: FROZEN_ON });
    const [entry] = kitchenInventory([spinach], [], NOW);
    expect(entry.useBy).toBeNull();
    expect(entry.freshness).toBeNull();
    expect(entry.daysLeft).toBeNull();
    expect(spinach.expiresAt).toBe('2026-08-14');
  });

  it('says where it is and when it went in, in the two caption halves', () => {
    const spinach = makeItem({ name: 'Spinach', expiresAt: '2026-08-14', frozenAt: FROZEN_ON });
    const [entry] = kitchenInventory([spinach], [], NOW);
    expect(entry.reason).toBe('in the freezer');
    expect(entry.useByCaption).toBe('Frozen Jul 12');
    expect(entry.caption).toBe('in the freezer · Frozen Jul 12');
  });

  // The reason the freezer had to reach probablyHaveReason: the purchase window
  // is two weeks and a freezer is measured in months, so without it the food
  // would quietly leave the kitchen while sitting in the kitchen.
  it('keeps a frozen row in the pantry long past its purchase window', () => {
    const chicken = makeItem({
      name: 'Chicken',
      onHandUntil: null,
      purchaseCount: 1,
      lastPurchasedAt: daysAgo(60),
      frozenAt: FROZEN_ON,
    });
    expect(kitchenInventory([chicken], [], NOW)).toHaveLength(1);
    expect(kitchenInventory([{ ...chicken, frozenAt: null }], [], NOW)).toHaveLength(0);
  });

  // The ✕ on a Pantry row writes exactly this bit, so if the freezer outranked
  // it the button would look dead on a frozen row.
  it('lets an explicit "Out of it" outrank the freezer, so the ✕ still works', () => {
    const chicken = makeItem({
      name: 'Chicken',
      frozenAt: FROZEN_ON,
      onHandUntil: OUT_OF_IT_UNTIL,
    });
    expect(kitchenInventory([chicken], [], NOW)).toHaveLength(0);
  });

  it('never counts a frozen row as something to use up', () => {
    const spinach = makeItem({ name: 'Spinach', expiresAt: '2026-08-10', frozenAt: FROZEN_ON });
    expect(useUpEntries(kitchenInventory([spinach], [], NOW))).toHaveLength(0);
    expect(useUpEntries(kitchenInventory([{ ...spinach, frozenAt: null }], [], NOW))).toHaveLength(1);
  });

  it('leads with the fridge, then the freezer, then the aisles', () => {
    const sections = buildKitchenSections(
      kitchenInventory(
        [
          makeItem({ name: 'Peas', aisle: 'Frozen', frozenAt: FROZEN_ON }),
          makeItem({ name: 'Flour', aisle: 'Baking' }),
        ],
        [makeLeftover({ title: 'Chilli' })],
        NOW
      ),
      ['Baking', 'Frozen'],
    );
    expect(sections.map(s => s.section)).toEqual([FRIDGE_SECTION, FREEZER_SECTION, 'Baking']);
  });

  it('puts both kinds of frozen thing under the one heading', () => {
    const sections = buildKitchenSections(
      kitchenInventory(
        [makeItem({ name: 'Peas', frozenAt: FROZEN_ON })],
        [makeLeftover({ title: 'Chilli', frozenAt: FROZEN_ON })],
        NOW
      ),
      [],
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].section).toBe(FREEZER_SECTION);
    expect(sections[0].data.map(e => e.title).sort()).toEqual(['Chilli', 'Peas']);
  });
});

// ─── opened, and running low ────────────────────────────────────────────────

describe('the two other pantry states', () => {
  it('adds the opening to the reason half, where the evidence lives', () => {
    const salsa = makeItem({
      name: 'Salsa',
      expiresAt: '2026-08-14',
      openedAt: '2026-08-12T09:00:00.000Z',
    });
    const [entry] = kitchenInventory([salsa], [], NOW);

    expect(entry.reason).toContain('opened Aug 12');
    // The clock half is untouched: opening is evidence about the jar, not a
    // state of the countdown.
    expect(entry.useByCaption).toBe('Use by tomorrow');
  });

  // A frozen row has already replaced the reason with the freezer, and naming
  // two places for one jar reads as a contradiction.
  it('drops the opening clause on a frozen row', () => {
    const salsa = makeItem({
      name: 'Salsa',
      openedAt: '2026-08-12T09:00:00.000Z',
      frozenAt: '2026-08-12T09:00:00.000Z',
    });
    const [entry] = kitchenInventory([salsa], [], NOW);

    expect(entry.reason).toBe('in the freezer');
  });

  // The distinction from "Out of it": there's some left, so it's still in the
  // kitchen and a week plan still counts it.
  it('keeps a running-low row in the pantry, saying so', () => {
    const flour = makeItem({
      name: 'Flour',
      onHandUntil: null,
      runningLowAt: '2026-08-12T09:00:00.000Z',
    });
    const [entry] = kitchenInventory([flour], [], NOW);

    expect(entry.reason).toBe('running low');
  });

  it('still lets "Out of it" outrank running low', () => {
    const flour = makeItem({
      name: 'Flour',
      runningLowAt: '2026-08-12T09:00:00.000Z',
      onHandUntil: OUT_OF_IT_UNTIL,
    });
    expect(kitchenInventory([flour], [], NOW)).toHaveLength(0);
  });
});

// ─── boxes: two packets of one item, in two places ──────────────────────────

describe('a box of its own', () => {
  function makeProduct(overrides: Partial<ItemProduct> & { itemId: string }): ItemProduct {
    return {
      id: `p-${++productSeq}`,
      brand: null,
      variant: null,
      productKey: `k-${productSeq}`,
      rating: null,
      note: '',
      purchaseCount: 0,
      lastPurchasedAt: null,
      gtin: null,
      onHandUntil: null,
      expiresAt: null,
      frozenAt: null,
      openedAt: null,
      createdAt: daysAgo(200),
      ...overrides,
    };
  }

  const bought = (name: string, aisle = 'Bakery') =>
    makeItem({
      name, aisle, purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(2),
    });

  it('draws one row per box beside the item, keyed apart', () => {
    const item = bought('Vegan ground beef', 'Meat');
    const beyond = makeProduct({ itemId: item.id, brand: 'Beyond', frozenAt: daysAgo(20) });
    const impossible = makeProduct({ itemId: item.id, brand: 'Impossible', onHandUntil: daysAgo(-5) });

    const entries = kitchenInventory([item], [], NOW, [beyond, impossible]);
    expect(entries.map(e => e.id)).toEqual([
      kitchenEntryId('grocery', item.id),
      kitchenEntryId('product', beyond.id),
      kitchenEntryId('product', impossible.id),
    ]);
    // The item's name stays the title on all three — the pantry is a list of
    // food you have, with the packet named underneath, not a list of brands.
    expect(new Set(entries.map(e => e.title))).toEqual(new Set(['Vegan ground beef']));
    expect(entries.map(e => e.productName)).toEqual([null, 'Beyond', 'Impossible']);
  });

  it('files a frozen box under the freezer while its sibling stays in the aisle', () => {
    const item = bought('Bread');
    const frozen = makeProduct({ itemId: item.id, brand: "Arnold's", frozenAt: daysAgo(9) });
    const out = makeProduct({ itemId: item.id, brand: 'Store brand', onHandUntil: daysAgo(-5) });

    const bySection = new Map(
      kitchenInventory([item], [], NOW, [frozen, out]).map(e => [e.productName, e.section])
    );
    expect(bySection.get("Arnold's")).toBe(FREEZER_SECTION);
    expect(bySection.get('Store brand')).toBe('Bakery');
    expect(bySection.get(null)).toBe('Bakery');
  });

  it('keeps the box name out of the reason, so the row can weight it apart', () => {
    // It's the only thing telling two same-titled rows apart, so the row draws
    // it in its own weight rather than as more caption — but the accessible
    // line still reads as one sentence.
    const item = bought('Bread');
    const box = makeProduct({ itemId: item.id, brand: "Arnold's", onHandUntil: daysAgo(-5) });
    const entry = kitchenInventory([item], [], NOW, [box]).find(e => e.kind === 'product')!;
    expect(entry.productName).toBe("Arnold's");
    expect(entry.reason).toBe('marked as on hand');
    expect(entry.caption).toBe("Arnold's · marked as on hand");
  });

  it('still reads as one sentence when the box has a clock and an opening', () => {
    const item = bought('Salsa', 'Condiments');
    const box = makeProduct({
      itemId: item.id, brand: 'Herdez', onHandUntil: daysAgo(-5),
      openedAt: daysAgo(2), expiresAt: '2026-08-14',
    });
    const entry = kitchenInventory([item], [], NOW, [box]).find(e => e.kind === 'product')!;
    expect(entry.caption).toBe('Herdez · marked as on hand · opened Aug 11 · Use by tomorrow');
  });

  it('counts down a box off its own use-by day, ahead of the item\'s', () => {
    const item = bought('Bread');
    item.expiresAt = '2026-08-20';
    const box = makeProduct({ itemId: item.id, brand: "Arnold's", onHandUntil: daysAgo(-5), expiresAt: '2026-08-14' });
    const entry = kitchenInventory([item], [], NOW, [box]).find(e => e.kind === 'product')!;
    expect(entry.useBy).toBe('2026-08-14');
  });

  it('falls back to the item\'s use-by day for a box that has none of its own', () => {
    // A shelf life is a fact about the food, not about the brand, so an
    // unopened packet is answerable to the day the purchase set.
    const item = bought('Bread');
    item.expiresAt = '2026-08-20';
    const box = makeProduct({ itemId: item.id, brand: "Arnold's", onHandUntil: daysAgo(-5) });
    const entry = kitchenInventory([item], [], NOW, [box]).find(e => e.kind === 'product')!;
    expect(entry.useBy).toBe('2026-08-20');
  });

  it('suspends a frozen box\'s countdown without losing the day', () => {
    const item = bought('Bread');
    const box = makeProduct({
      itemId: item.id, brand: "Arnold's", frozenAt: daysAgo(9), expiresAt: '2026-08-14',
    });
    const entry = kitchenInventory([item], [], NOW, [box]).find(e => e.kind === 'product')!;
    expect(entry.useBy).toBeNull();
    expect(entry.freshness).toBeNull();
    expect(box.expiresAt).toBe('2026-08-14');
  });

  it('carries the item id, which is what the ✕ and the drop need', () => {
    const item = bought('Bread');
    const box = makeProduct({ itemId: item.id, brand: "Arnold's", onHandUntil: daysAgo(-5) });
    const entries = kitchenInventory([item], [], NOW, [box]);
    expect(entries.find(e => e.kind === 'product')!.itemId).toBe(item.id);
    expect(entries.find(e => e.kind === 'grocery')!.itemId).toBeNull();
  });

  it('leaves a box search-matchable by its item\'s name', () => {
    const item = bought('Bread');
    const box = makeProduct({ itemId: item.id, brand: "Arnold's", onHandUntil: daysAgo(-5) });
    const entry = kitchenInventory([item], [], NOW, [box]).find(e => e.kind === 'product')!;
    expect(entry.matchKey).toBe(item.nameKey);
  });

  it('is exactly today\'s behaviour for an item nobody has said anything about', () => {
    const item = bought('Bread');
    const silent = makeProduct({ itemId: item.id, brand: "Arnold's" });
    expect(kitchenInventory([item], [], NOW, [silent])).toEqual(kitchenInventory([item], [], NOW));
  });
});
