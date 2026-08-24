import { useGroceryStore } from '../store/useGroceryStore';
import {
  dbGetAllGroceryItems,
  dbGetGroceryAisleOrder,
  dbSetGroceryAisleOrder,
  dbGetGroceryHiddenAisles,
  dbSetGroceryHiddenAisles,
  dbGetGroceryAisleOverrides,
  dbSetGroceryAisleOverrides,
  dbGetGroceryGroupBy,
  dbSetGroceryGroupBy,
  dbInsertGroceryItem,
  dbUpdateGroceryItem,
  dbDeleteGroceryItem,
  dbFinishGroceryShopping,
  dbClearGroceryList,
  dbGetAllGroceryShops,
  dbInsertGroceryShop,
  dbUpdateGroceryShop,
  dbDeleteGroceryShop,
  dbGetAllItemShopLinks,
  dbSetItemShopLink,
  dbDeleteItemShopLink,
  dbGetAllItemSubLinks,
  dbSetItemSubLink,
  dbSetItemProduct,
  dbSetProductGtin,
  dbDeleteItemProduct,
  dbDeleteItemSubLink,
  dbGetLastShopId,
  dbSetLastShopId,
  dbGetTripShopId,
  dbGetTripStartedAt,
  dbSetTrip,
  dbGetAllRecipes,
  dbUpdateRecipe,
} from '../db/database';
import { scheduleTripReminder, cancelTripReminder } from '../utils/notifications';
import { useRecipeStore } from '../store/useRecipeStore';
import { groceryNameKey } from '../utils/groceryParse';
import { DEFAULT_AISLES, OTHER_AISLE } from '../utils/groceryAisles';
import { OUT_OF_IT_UNTIL, probablyHaveReason } from '../utils/grocerySuggest';
import { expiryDaysFromNow, expiryKeyFor, openShelfLifeDaysFor } from '../utils/groceryShelfLife';
import type { GroceryItem, ItemProduct, ItemShopLink, ItemSubLink, Shop, StoreAlias, Task } from '../types';

jest.mock('../db/database', () => ({
  dbGetAllGroceryItems: jest.fn().mockReturnValue([]),
  dbGetGroceryAisleOrder: jest.fn().mockReturnValue(null),
  dbSetGroceryAisleOrder: jest.fn(),
  dbGetGroceryHiddenAisles: jest.fn().mockReturnValue([]),
  dbSetGroceryHiddenAisles: jest.fn(),
  dbGetGroceryAisleOverrides: jest.fn().mockReturnValue({}),
  dbSetGroceryAisleOverrides: jest.fn(),
  dbGetGroceryGroupBy: jest.fn().mockReturnValue('aisle'),
  dbSetGroceryGroupBy: jest.fn(),
  dbInsertGroceryItem: jest.fn(),
  dbUpdateGroceryItem: jest.fn(),
  dbDeleteGroceryItem: jest.fn(),
  dbFinishGroceryShopping: jest.fn().mockReturnValue([]),
  dbClearGroceryList: jest.fn().mockReturnValue([]),
  dbGetAllGroceryShops: jest.fn().mockReturnValue([]),
  dbInsertGroceryShop: jest.fn(),
  dbUpdateGroceryShop: jest.fn(),
  dbDeleteGroceryShop: jest.fn(),
  dbGetAllItemShopLinks: jest.fn().mockReturnValue([]),
  dbSetItemShopLink: jest.fn(),
  dbDeleteItemShopLink: jest.fn(),
  dbGetAllItemSubLinks: jest.fn().mockReturnValue([]),
  dbSetItemSubLink: jest.fn(),
  dbDeleteItemSubLink: jest.fn(),
  dbGetAllItemProducts: jest.fn(() => []),
  dbGetAllStoreAliases: jest.fn(() => []),
  dbSetStoreAlias: jest.fn(),
  dbSetItemProduct: jest.fn(),
  dbSetProductGtin: jest.fn(),
  dbDeleteItemProduct: jest.fn(),
  dbGetLastShopId: jest.fn().mockReturnValue(null),
  dbSetLastShopId: jest.fn(),
  dbGetTripShopId: jest.fn().mockReturnValue(null),
  dbGetTripStartedAt: jest.fn().mockReturnValue(null),
  dbSetTrip: jest.fn(),
  // Runs the body inline — these tests assert on store state, not on
  // transaction boundaries, and a no-op wrapper would silently skip the work.
  dbTransaction: jest.fn((fn: () => void) => fn()),
  // Reached only through useRecipeStore, which renameItem calls to keep
  // ingredient keys in step.
  dbGetAllRecipes: jest.fn().mockReturnValue([]),
  dbInsertRecipe: jest.fn(),
  dbUpdateRecipe: jest.fn(),
  dbDeleteRecipe: jest.fn(),
}));

// The task store is mocked rather than driven for real, exactly as
// useMealPlanStore.test.ts does it and for the same two reasons: this suite is
// about what the grocery catalog *asks* of the task list, and the real store
// drags expo-notifications into a node environment. The other side of the link
// — deleting a use-up task recording the item's opt-out — is covered against
// the real stores in useTaskStore.test.ts.
const mockTaskState = {
  tasks: [] as Task[],
  addTask: jest.fn((draft: Partial<Task>) => {
    const task = { id: `t-${mockTaskState.tasks.length + 1}`, completed: false, archived: false, ...draft } as Task;
    mockTaskState.tasks.push(task);
    return task;
  }),
  updateTask: jest.fn((
    id: string,
    updates: Partial<Task>,
    _options?: { scope?: 'occurrence' | 'series'; skipPostponeCount?: boolean },
  ) => {
    mockTaskState.tasks = mockTaskState.tasks.map(t => (t.id === id ? { ...t, ...updates } : t));
  }),
  deleteTask: jest.fn((id: string) => {
    mockTaskState.tasks = mockTaskState.tasks.filter(t => t.id !== id);
  }),
  setLastAction: jest.fn(),
};
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => mockTaskState },
}));

// groceryUseUpTasks defaults OFF in the real store — it's opt-in — so this
// mirrors it, and the tests that care about use-up tasks turn it on the way a
// user would.
let mockUseUpTasks = false;
let mockUseUpLeadDays = 1;
let mockUseUpCategory: string | null = null;
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      get groceryUseUpTasks() { return mockUseUpTasks; },
      get groceryUseUpLeadDays() { return mockUseUpLeadDays; },
      get groceryUseUpTaskCategory() { return mockUseUpCategory; },
    }),
  },
}));

// The active-trip tests assert against these directly; every other test just
// needs startTrip/endTrip/deleteShop not to drag expo-notifications into this
// node environment (see the useTaskStore mock above for the same reasoning).
jest.mock('../utils/notifications', () => ({
  scheduleTripReminder: jest.fn().mockResolvedValue(undefined),
  cancelTripReminder: jest.fn().mockResolvedValue(undefined),
}));

/** The live use-up task for an item, as the store's own helper finds it. */
const useUpTaskFor = (itemId: string) =>
  mockTaskState.tasks.find(t => t.generatedSourceId === itemId && !t.completed && !t.archived);

let seq = 0;
function makeProduct(itemId: string, brand: string | null, variant: string | null): ItemProduct {
  return {
    id: `p-${++seq}`,
    itemId,
    brand,
    variant,
    productKey: `${(brand ?? '').toLowerCase()}|${(variant ?? '').toLowerCase()}`,
    rating: null,
    note: '',
    purchaseCount: 0,
    lastPurchasedAt: null,
    gtin: null,
    onHandUntil: null,
    expiresAt: null,
    frozenAt: null,
    openedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeItem(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  const name = overrides.name;
  return {
    id: `id-${++seq}`,
    nameKey: groceryNameKey(name),
    preferredProductId: null,
    productStrict: false,
    aisle: OTHER_AISLE,
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
    sortOrder: seq,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
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
    lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  };
}

function makeShop(name: string, overrides: Partial<Shop> = {}): Shop {
  return {
    id: `shop-${++seq}`,
    name,
    nameKey: groceryNameKey(name),
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    excludeFromSuggestions: false,
    receiptStyle: 'itemized' as const,
    ...overrides,
  };
}

// Everything past `items` is an options object rather than positional: three
// independent slices of state hang off this store now, and `seed(x, {}, [], y)`
// is unreadable at a glance.
function seed(
  items: GroceryItem[],
  extra: {
    aisleOverrides?: Record<string, string>;
    shops?: Shop[];
    itemShops?: ItemShopLink[];
    itemSubs?: ItemSubLink[];
    itemProducts?: ItemProduct[];
    storeAliases?: StoreAlias[];
    tripShopId?: string | null;
    tripStartedAt?: string | null;
  } = {}
) {
  useGroceryStore.setState({
    items,
    aisleOrder: [...DEFAULT_AISLES],
    hiddenAisles: [],
    groceryGroupBy: 'aisle',
    aisleOverrides: extra.aisleOverrides ?? {},
    shops: extra.shops ?? [],
    itemShops: extra.itemShops ?? [],
    itemSubs: extra.itemSubs ?? [],
    itemProducts: extra.itemProducts ?? [],
    storeAliases: extra.storeAliases ?? [],
    lastShopId: null,
    tripShopId: extra.tripShopId ?? null,
    tripStartedAt: extra.tripStartedAt ?? null,
    cartHoldIds: [],
    disposalOffer: null,
    initialized: true,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetAllGroceryItems as jest.Mock).mockReturnValue([]);
  (dbGetGroceryAisleOrder as jest.Mock).mockReturnValue(null);
  (dbGetGroceryHiddenAisles as jest.Mock).mockReturnValue([]);
  (dbGetGroceryAisleOverrides as jest.Mock).mockReturnValue({});
  (dbGetGroceryGroupBy as jest.Mock).mockReturnValue('aisle');
  (dbFinishGroceryShopping as jest.Mock).mockReturnValue([]);
  (dbClearGroceryList as jest.Mock).mockReturnValue([]);
  (dbGetAllGroceryShops as jest.Mock).mockReturnValue([]);
  (dbGetAllItemShopLinks as jest.Mock).mockReturnValue([]);
  (dbGetAllItemSubLinks as jest.Mock).mockReturnValue([]);
  (dbGetLastShopId as jest.Mock).mockReturnValue(null);
  (dbGetTripShopId as jest.Mock).mockReturnValue(null);
  (dbGetTripStartedAt as jest.Mock).mockReturnValue(null);
  mockTaskState.tasks = [];
  mockUseUpTasks = false;
  mockUseUpLeadDays = 1;
  mockUseUpCategory = null;
  seed([]);
});

// ─── initialize ──────────────────────────────────────────────────────────────

describe('initialize', () => {
  it('loads rows and the default walk order', () => {
    const milk = makeItem({ name: 'Milk' });
    (dbGetAllGroceryItems as jest.Mock).mockReturnValue([milk]);

    useGroceryStore.getState().initialize();

    expect(useGroceryStore.getState().items).toEqual([milk]);
    expect(useGroceryStore.getState().aisleOrder).toEqual([...DEFAULT_AISLES]);
    expect(useGroceryStore.getState().initialized).toBe(true);
  });

  it('repairs a stored order WITHOUT writing it back', () => {
    // The whole point: shipping a bigger DEFAULT_AISLES later needs no
    // migration, and can't clobber an order arranged to match a real store.
    (dbGetGroceryAisleOrder as jest.Mock).mockReturnValue(['Frozen', 'Produce']);

    useGroceryStore.getState().initialize();

    const order = useGroceryStore.getState().aisleOrder;
    expect(order[0]).toBe('Frozen');
    expect(order).toContain('Bakery');
    expect(dbSetGroceryAisleOrder).not.toHaveBeenCalled();
  });

  it('takes in an aisle only a row knows about', () => {
    (dbGetAllGroceryItems as jest.Mock).mockReturnValue([makeItem({ name: 'Steak', aisle: 'Butcher' })]);
    useGroceryStore.getState().initialize();
    expect(useGroceryStore.getState().aisleOrder).toContain('Butcher');
  });

  it('clears a pending use-up prompt — session-only, nothing to mean on a fresh load', () => {
    useGroceryStore.setState({ pendingUseUpItemId: 'g-1' });
    useGroceryStore.getState().initialize();
    expect(useGroceryStore.getState().pendingUseUpItemId).toBeNull();
  });
});

describe('setPendingUseUpItem', () => {
  it('is what UseUpResolveSheet watches to open on the right item', () => {
    useGroceryStore.getState().setPendingUseUpItem('g-1');
    expect(useGroceryStore.getState().pendingUseUpItemId).toBe('g-1');

    useGroceryStore.getState().setPendingUseUpItem(null);
    expect(useGroceryStore.getState().pendingUseUpItemId).toBeNull();
  });
});

// ─── addByName ───────────────────────────────────────────────────────────────

describe('addByName', () => {
  it('keeps an override note on the row it creates', () => {
    const item = useGroceryStore.getState().addByName('limes', {
      name: 'limes', quantity: null, note: 'for margs',
    });
    expect(item.name).toBe('limes');
    expect(item.note).toBe('for margs');
  });

  it('never wipes an existing note when the item is re-added without one', () => {
    useGroceryStore.getState().addByName('limes', {
      name: 'limes', quantity: null, note: 'for margs',
    });
    // Same rule the quantity follows: typing the bare name again is a re-add,
    // not an instruction to blank what's already on the row.
    const again = useGroceryStore.getState().addByName('limes');
    expect(again.note).toBe('for margs');
  });

  // The whole point of keeping the product out of the name: re-adding the item
  // — by hand, from the catalog, or from a recipe that calls for the plain
  // ingredient — must not lose which one the user actually wants.
  it('keeps an established preference across a re-add', () => {
    const item = useGroceryStore.getState().addByName('cottage cheese');
    const product = useGroceryStore.getState().addProduct(item.id, { brand: 'Good Culture', variant: null });
    useGroceryStore.getState().removeFromList(item.id);

    const again = useGroceryStore.getState().addByName('cottage cheese');
    expect(again.id).toBe(item.id);
    expect(again.preferredProductId).toBe(product!.id);
  });

  // What a barcode scan needs: it observed that a box came home, which is not
  // the user saying that box is the one they want. See #1866.
  it('records a box without deciding the preference when promote is off', () => {
    const item = useGroceryStore.getState().addByName('bread');
    const product = useGroceryStore
      .getState()
      .addProduct(item.id, { brand: "Dave's Killer", variant: '21 grains' }, { promote: false });

    expect(product).not.toBeNull();
    expect(useGroceryStore.getState().itemProducts).toHaveLength(1);
    expect(useGroceryStore.getState().itemById(item.id)!.preferredProductId).toBeNull();
  });

  it('leaves an existing preference alone when promote is off', () => {
    const item = useGroceryStore.getState().addByName('bread');
    const chosen = useGroceryStore.getState().addProduct(item.id, { brand: "Arnold's", variant: null })!;
    useGroceryStore
      .getState()
      .addProduct(item.id, { brand: "Dave's Killer", variant: null }, { promote: false });

    expect(useGroceryStore.getState().itemProducts).toHaveLength(2);
    expect(useGroceryStore.getState().itemById(item.id)!.preferredProductId).toBe(chosen.id);
  });

  it('still promotes by default, which is every hand-driven caller', () => {
    const item = useGroceryStore.getState().addByName('bread');
    const product = useGroceryStore.getState().addProduct(item.id, { brand: "Arnold's", variant: null })!;
    expect(useGroceryStore.getState().itemById(item.id)!.preferredProductId).toBe(product.id);
  });

  it('gives a genuinely new row no product', () => {
    // Nothing parses one out of typed text — "Good Culture cottage cheese"
    // typed into the add field is a name, not a name plus a brand.
    expect(useGroceryStore.getState().addByName('cottage cheese').preferredProductId).toBeNull();
    expect(useGroceryStore.getState().addByName('Good Culture cottage cheese').preferredProductId).toBeNull();
    expect(useGroceryStore.getState().itemProducts).toEqual([]);
  });

  it('mints a product from a brand/variant override, same channel as quantity/note', () => {
    // GroceryAddField's Brand/Variant chips — the one other way in besides
    // ProductSheet.
    const item = useGroceryStore.getState().addByName('cottage cheese', {
      name: 'cottage cheese', quantity: null, brand: 'Good Culture', variant: 'low fat',
    });
    const [product] = useGroceryStore.getState().itemProducts;
    expect(product).toMatchObject({ itemId: item.id, brand: 'Good Culture', variant: 'low fat' });
    // Typing it into the add field is a statement about what you're going
    // shopping for, so it's the preference straight away.
    expect(item.preferredProductId).toBe(product.id);
  });

  it('never wipes an existing preference when the item is re-added without one', () => {
    const item = useGroceryStore.getState().addByName('cottage cheese', {
      name: 'cottage cheese', quantity: null, brand: 'Good Culture', variant: 'low fat',
    });

    // Same rule quantity/note follow: a bare re-add is not an instruction to
    // clear what's already on the row.
    const again = useGroceryStore.getState().addByName('cottage cheese');
    expect(again.id).toBe(item.id);
    expect(again.preferredProductId).toBe(item.preferredProductId);
    expect(useGroceryStore.getState().itemProducts).toHaveLength(1);
  });

  it('adds a second product, and prefers it, when the re-add names a new one', () => {
    const item = useGroceryStore.getState().addByName('cottage cheese', {
      name: 'cottage cheese', quantity: null, brand: 'Good Culture', variant: 'low fat',
    });

    const again = useGroceryStore.getState().addByName('cottage cheese', {
      name: 'cottage cheese', quantity: null, brand: 'Nancy\'s', variant: 'whole milk',
    });
    expect(again.id).toBe(item.id);
    // Both boxes are on record — the old one isn't overwritten, which is the
    // whole difference from the pair of strings this replaced.
    const products = useGroceryStore.getState().itemProducts;
    expect(products).toHaveLength(2);
    expect(products.find(p => p.id === again.preferredProductId)).toMatchObject({
      brand: 'Nancy\'s', variant: 'whole milk',
    });
  });

  // The identity is the brand/variant pair, so naming a box twice is one box —
  // splitting it would split its rating and its purchase count too.
  it('matches an existing product rather than minting a duplicate', () => {
    const item = useGroceryStore.getState().addByName('cottage cheese', {
      name: 'cottage cheese', quantity: null, brand: 'Good Culture', variant: 'low fat',
    });
    useGroceryStore.getState().addByName('cottage cheese', {
      name: 'cottage cheese', quantity: null, brand: 'good culture', variant: 'LOW FAT',
    });

    expect(useGroceryStore.getState().itemProducts).toHaveLength(1);
    expect(useGroceryStore.getState().items.find(i => i.id === item.id)!.preferredProductId)
      .toBe(useGroceryStore.getState().itemProducts[0].id);
  });

  it('inserts a genuinely new item, filed by the lexicon', () => {
    const item = useGroceryStore.getState().addByName('Milk');

    expect(dbInsertGroceryItem).toHaveBeenCalledTimes(1);
    expect(item.name).toBe('Milk');
    expect(item.nameKey).toBe('milk');
    expect(item.aisle).toBe('Dairy & Eggs');
    expect(item.onList).toBe(true);
    expect(item.checked).toBe(false);
    expect(useGroceryStore.getState().items).toHaveLength(1);
  });

  // A typed name is a catalog row from the first moment — there is no
  // provisional state left for it to start in. See hasUserFacts.
  it('puts a brand-new name straight on the list', () => {
    expect(useGroceryStore.getState().addByName('nduja').onList).toBe(true);
  });

  it('re-lists an existing catalog row rather than inserting a second', () => {
    seed([makeItem({ name: 'Milk', onList: false })]);
    const again = useGroceryStore.getState().addByName('milk');
    expect(again.onList).toBe(true);
    expect(useGroceryStore.getState().items).toHaveLength(1);
  });

  it('files an unrecognised item under Other rather than leaving it aisle-less', () => {
    expect(useGroceryStore.getState().addByName('nduja').aisle).toBe(OTHER_AISLE);
  });

  // A barcode source's category is the third and weakest signal, so these three
  // fix its place in the chain: it fills a gap, and it never wins an argument.
  it('takes a scanned aisle for a name the lexicon has never heard of', () => {
    const item = useGroceryStore.getState().addByName('Cheez-It Original', {
      name: 'Cheez-It Original', quantity: null, aisle: 'Snacks',
    });
    expect(item.aisle).toBe('Snacks');
  });

  it('lets the name lexicon beat a scanned aisle', () => {
    const item = useGroceryStore.getState().addByName('Whole milk', {
      name: 'Whole milk', quantity: null, aisle: 'Frozen',
    });
    expect(item.aisle).toBe('Dairy & Eggs');
  });

  it('lets the user own remembered aisle beat a scanned one', () => {
    seed([], { aisleOverrides: { nduja: 'Deli' } });
    const item = useGroceryStore.getState().addByName('Nduja', {
      name: 'Nduja', quantity: null, aisle: 'Snacks',
    });
    expect(item.aisle).toBe('Deli');
  });

  it('splits the quantity off the name so the key stays clean', () => {
    const item = useGroceryStore.getState().addByName('2 lb chicken thighs');
    expect(item.name).toBe('chicken thighs');
    expect(item.quantity).toBe('2 lb');
    expect(item.aisle).toBe('Meat & Seafood');
  });

  it('uses an override name/quantity as-is instead of re-parsing raw', () => {
    // GroceryAddField's per-token × button: the user rejected splitting "1
    // tsp" off, so the override keeps it in the name and re-parsing `raw`
    // (which would reproduce the same split) must not happen.
    const item = useGroceryStore.getState().addByName('1 tsp ginger', {
      name: '1 tsp ginger',
      quantity: null,
    });
    expect(item.name).toBe('1 tsp ginger');
    expect(item.quantity).toBeNull();
  });

  it('puts a known item back on the list instead of inserting a duplicate', () => {
    // This is the whole product insight — no duplicates, ever.
    seed([makeItem({ name: 'Milk', onList: false, purchaseCount: 7 })]);

    useGroceryStore.getState().addByName('milk');

    expect(dbInsertGroceryItem).not.toHaveBeenCalled();
    expect(dbUpdateGroceryItem).toHaveBeenCalledTimes(1);
    const items = useGroceryStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].onList).toBe(true);
    expect(items[0].purchaseCount).toBe(7);
  });

  it('matches on the normalised key, not the typed string', () => {
    seed([makeItem({ name: 'Milk' })]);
    useGroceryStore.getState().addByName('  MILK,  ');
    expect(useGroceryStore.getState().items).toHaveLength(1);
  });

  it('takes the newly typed name as the label', () => {
    seed([makeItem({ name: 'milk' })]);
    useGroceryStore.getState().addByName('Milk');
    expect(useGroceryStore.getState().items[0].name).toBe('Milk');
  });

  it('keeps the existing quantity when the re-add carries none', () => {
    seed([makeItem({ name: 'Milk', quantity: '2 gal' })]);
    useGroceryStore.getState().addByName('milk');
    expect(useGroceryStore.getState().items[0].quantity).toBe('2 gal');
  });

  it('overwrites the quantity when the re-add carries one', () => {
    seed([makeItem({ name: 'Milk', quantity: '2 gal' })]);
    useGroceryStore.getState().addByName('1 gal milk');
    expect(useGroceryStore.getState().items[0].quantity).toBe('1 gal');
  });

  // Two punctuation-only names both normalise to an empty key; without a
  // fallback they'd collide on the UNIQUE index and the second insert would
  // throw out of whatever was calling — a paste, or the Reminders drain
  // mid-batch.
  it('keeps a key for a name with no letters or digits', () => {
    const a = useGroceryStore.getState().addByName('???');
    const b = useGroceryStore.getState().addByName('!!!');
    expect(a.nameKey).not.toBe('');
    expect(b.nameKey).not.toBe('');
    expect(a.nameKey).not.toBe(b.nameKey);
    expect(useGroceryStore.getState().items).toHaveLength(2);
  });

  it('un-checks a checked row that gets re-added', () => {
    seed([makeItem({ name: 'Milk', onList: true, checked: true })]);
    useGroceryStore.getState().addByName('milk');
    expect(useGroceryStore.getState().items[0].checked).toBe(false);
  });

  // Issue #1085: single adds register with the same shake-to-undo queue task
  // mutations already do.
  it('registers an undo that deletes the brand-new row it created', () => {
    seed([]);
    const item = useGroceryStore.getState().addByName('nduja');

    expect(useGroceryStore.getState().lastAction?.label).toBe('Added "nduja"');
    useGroceryStore.getState().undoLastAction();

    expect(dbDeleteGroceryItem).toHaveBeenCalledWith(item.id);
    expect(useGroceryStore.getState().items).toHaveLength(0);
  });

  // The add writes facts of its own — a parsed quantity, a typed note, a Brand
  // chip — so "has this row got facts" is the wrong question at undo time and
  // made "2 gal milk" un-undoable. undoForAdds compares against a snapshot
  // taken when the add landed instead.
  it('deletes a minted row whose only facts the add itself wrote', () => {
    useGroceryStore.getState().addByName('2 gal milk');
    useGroceryStore.getState().undoLastAction();
    expect(useGroceryStore.getState().items).toEqual([]);
  });

  it('deletes a minted row carrying a note the add field typed', () => {
    useGroceryStore.getState().addByName('limes', {
      name: 'limes', quantity: null, note: 'for margs',
    });
    useGroceryStore.getState().undoLastAction();
    expect(useGroceryStore.getState().items).toEqual([]);
  });

  it('deletes a minted row carrying a brand the add field chipped on', () => {
    useGroceryStore.getState().addByName('bread', {
      name: 'bread', quantity: null, brand: "Arnold's",
    });
    useGroceryStore.getState().undoLastAction();
    expect(useGroceryStore.getState().items).toEqual([]);
    // The box goes with it rather than dangling — see deleteItems' cascade.
    expect(useGroceryStore.getState().itemProducts).toEqual([]);
  });

  // The undo of an *add* is not a licence to delete: addProduct and friends
  // register no undo of their own, so the add's action is still armed minutes
  // later, by which time the row may be carrying a brand or a substitute.
  it('registers an undo that spares a row given a fact since the add', () => {
    const item = useGroceryStore.getState().addByName('Bread');
    useGroceryStore.getState().addProduct(item.id, { brand: "Arnold's", variant: null });

    useGroceryStore.getState().undoLastAction();

    expect(dbDeleteGroceryItem).not.toHaveBeenCalled();
    const after = useGroceryStore.getState().itemById(item.id)!;
    expect(after.onList).toBe(false);
    expect(useGroceryStore.getState().itemProducts).toHaveLength(1);
  });

  it('registers an undo that un-lists a catalog row it re-listed', () => {
    const parsley = makeItem({ name: 'Parsley', onList: false });
    seed([parsley]);
    useGroceryStore.getState().addByName('parsley');

    useGroceryStore.getState().undoLastAction();

    expect(dbDeleteGroceryItem).not.toHaveBeenCalled();
    expect(useGroceryStore.getState().itemById(parsley.id)!.onList).toBe(false);
  });

  it('registers no undo for a row that was already on the list', () => {
    seed([makeItem({ name: 'Milk', onList: true })]);
    useGroceryStore.getState().addByName('milk');
    expect(useGroceryStore.getState().lastAction).toBeNull();
  });
});

// ─── addManyFromText ─────────────────────────────────────────────────────────

describe('addManyFromText', () => {
  it('adds one item per line and reports what was already there', () => {
    seed([makeItem({ name: 'Milk', onList: true })]);

    const { added, alreadyOnList } = useGroceryStore.getState().addManyFromText('milk\neggs\nbread');

    expect(added.map(i => i.name)).toEqual(['eggs', 'bread']);
    expect(alreadyOnList.map(i => i.name)).toEqual(['milk']);
    expect(useGroceryStore.getState().items).toHaveLength(3);
  });

  it('strips bullets and numbering from a pasted recipe', () => {
    useGroceryStore.getState().addManyFromText('- milk\n1. eggs\n• bread');
    expect(useGroceryStore.getState().items.map(i => i.name)).toEqual(['milk', 'eggs', 'bread']);
  });

  it('counts a catalog item that was off the list as newly added', () => {
    seed([makeItem({ name: 'Milk', onList: false })]);
    const { added, alreadyOnList } = useGroceryStore.getState().addManyFromText('milk');
    expect(added).toHaveLength(1);
    expect(alreadyOnList).toHaveLength(0);
  });

  it('registers one combined undo that removes exactly what the paste added', () => {
    seed([makeItem({ name: 'Milk', onList: true })]);

    const { added } = useGroceryStore.getState().addManyFromText('milk\neggs\nbread');
    expect(useGroceryStore.getState().lastAction?.label).toBe('2 items added');

    useGroceryStore.getState().undoLastAction();

    const items = useGroceryStore.getState().items;
    // The line already on the list (milk) survives untouched; the two lines
    // this paste actually added are gone.
    expect(items.map(i => i.name)).toEqual(['milk']);
    expect(items[0].onList).toBe(true);
    expect(added.map(i => i.name)).toEqual(['eggs', 'bread']);
  });
});

// ─── toggleChecked and the cart hold ─────────────────────────────────────────

describe('toggleChecked', () => {
  it('checks a listed row and holds it in place', () => {
    const milk = makeItem({ name: 'Milk', onList: true });
    seed([milk]);

    useGroceryStore.getState().toggleChecked(milk.id);

    expect(useGroceryStore.getState().items[0].checked).toBe(true);
    expect(useGroceryStore.getState().cartHoldIds).toEqual([milk.id]);
  });

  it('drops the hold when un-checked inside the window', () => {
    const milk = makeItem({ name: 'Milk', onList: true });
    seed([milk]);

    useGroceryStore.getState().toggleChecked(milk.id);
    useGroceryStore.getState().toggleChecked(milk.id);

    expect(useGroceryStore.getState().items[0].checked).toBe(false);
    expect(useGroceryStore.getState().cartHoldIds).toEqual([]);
  });

  it('clears the hold once the timer fires, batching a whole burst together', () => {
    jest.useFakeTimers();
    const milk = makeItem({ name: 'Milk', onList: true });
    const eggs = makeItem({ name: 'Eggs', onList: true });
    seed([milk, eggs]);

    useGroceryStore.getState().toggleChecked(milk.id);
    useGroceryStore.getState().toggleChecked(eggs.id);
    expect(useGroceryStore.getState().cartHoldIds).toHaveLength(2);

    jest.advanceTimersByTime(5000);
    expect(useGroceryStore.getState().cartHoldIds).toEqual([]);
    jest.useRealTimers();
  });

  it('refuses to check a row that is not on the list', () => {
    // The checked ⇒ onList invariant.
    const milk = makeItem({ name: 'Milk', onList: false });
    seed([milk]);

    useGroceryStore.getState().toggleChecked(milk.id);

    expect(useGroceryStore.getState().items[0].checked).toBe(false);
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });
});

describe('setCheckedMany', () => {
  it('checks a whole selection at once and holds every one of them', () => {
    const milk = makeItem({ name: 'Milk', onList: true });
    const eggs = makeItem({ name: 'Eggs', onList: true });
    seed([milk, eggs]);

    useGroceryStore.getState().setCheckedMany([milk.id, eggs.id], true);

    expect(useGroceryStore.getState().items.every(i => i.checked)).toBe(true);
    expect(new Set(useGroceryStore.getState().cartHoldIds)).toEqual(new Set([milk.id, eggs.id]));
  });

  it('unchecks a whole selection and drops the hold', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    const eggs = makeItem({ name: 'Eggs', onList: true, checked: true });
    seed([milk, eggs]);
    useGroceryStore.setState({ cartHoldIds: [milk.id, eggs.id] });

    useGroceryStore.getState().setCheckedMany([milk.id, eggs.id], false);

    expect(useGroceryStore.getState().items.every(i => !i.checked)).toBe(true);
    expect(useGroceryStore.getState().cartHoldIds).toEqual([]);
  });

  it('skips rows already in the target state and rows off the list', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    const eggs = makeItem({ name: 'Eggs', onList: false });
    seed([milk, eggs]);

    useGroceryStore.getState().setCheckedMany([milk.id, eggs.id], true);

    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
    expect(useGroceryStore.getState().items.find(i => i.id === eggs.id)!.checked).toBe(false);
  });
});

// ─── finishShopping / clearList ──────────────────────────────────────────────

describe('finishShopping', () => {
  it('records the purchase, empties the list and deletes nothing', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true, purchaseCount: 3 });
    const eggs = makeItem({ name: 'Eggs', onList: true, checked: false });
    seed([milk, eggs]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    expect(useGroceryStore.getState().finishShopping()).toBe(1);

    const after = useGroceryStore.getState().items;
    expect(after).toHaveLength(2);
    expect(dbDeleteGroceryItem).not.toHaveBeenCalled();

    const milkAfter = after.find(i => i.id === milk.id)!;
    expect(milkAfter.onList).toBe(false);
    expect(milkAfter.checked).toBe(false);
    // The ranking signal, which is the real reason this isn't a delete.
    expect(milkAfter.purchaseCount).toBe(4);
    expect(milkAfter.lastPurchasedAt).not.toBeNull();

    // The unchecked one stays on the list for next time.
    expect(after.find(i => i.id === eggs.id)!.onList).toBe(true);
  });

  it('records the purchase on a name bought for the first time', () => {
    const nduja = makeItem({ name: 'nduja', onList: true, checked: true });
    seed([nduja]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([nduja.id]);

    useGroceryStore.getState().finishShopping();

    const row = useGroceryStore.getState().items[0];
    expect(row.onList).toBe(false);
    expect(row.purchaseCount).toBe(1);
  });

  it('is a no-op with an empty trolley', () => {
    seed([makeItem({ name: 'Milk', onList: true })]);
    expect(useGroceryStore.getState().finishShopping()).toBe(0);
    expect(useGroceryStore.getState().items[0].onList).toBe(true);
  });

  // #1770 — a trip records a purchase and says nothing about whether the user
  // has asserted anything. The reason the pantry gives is read back off the
  // purchase itself, in its own words.
  it('reads the purchase back rather than asserting it on hand', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true, purchaseCount: 2, createdAt: '2026-01-01T00:00:00.000Z' });
    seed([milk]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping();

    const updated = useGroceryStore.getState().items[0];
    expect(updated.onHandUntil).toBeNull();
    expect(updated.purchaseCount).toBe(3);
    expect(probablyHaveReason(updated, new Date())).toMatch(/^bought 3× · last on /);
  });

  it('takes back an "Out of it" on something the trip bought', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true, onHandUntil: OUT_OF_IT_UNTIL });
    const eggs = makeItem({ name: 'Eggs', onList: true, checked: false, onHandUntil: OUT_OF_IT_UNTIL });
    seed([milk, eggs]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping();

    const byId = new Map(useGroceryStore.getState().items.map(i => [i.id, i]));
    expect(byId.get(milk.id)!.onHandUntil).toBeNull();
    expect(probablyHaveReason(byId.get(milk.id)!, new Date())).toMatch(/^bought once · /);
    // The one left in the trolley keeps its claim — nothing refuted it.
    expect(byId.get(eggs.id)!.onHandUntil).toBe(OUT_OF_IT_UNTIL);
    expect(probablyHaveReason(byId.get(eggs.id)!, new Date())).toBeNull();
  });

  it('clears a recipe-owned quantity, but leaves a hand-set one alone', () => {
    const rice = makeItem({ name: 'Rice', onList: true, checked: true, quantity: '3/4 cup', quantityFromRecipe: true });
    const flour = makeItem({ name: 'Flour', onList: true, checked: true, quantity: '2 bags', quantityFromRecipe: false });
    seed([rice, flour]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([rice.id, flour.id]);

    useGroceryStore.getState().finishShopping();

    const riceAfter = useGroceryStore.getState().itemById(rice.id)!;
    expect(riceAfter.quantity).toBeNull();
    expect(riceAfter.quantityFromRecipe).toBe(false);

    const flourAfter = useGroceryStore.getState().itemById(flour.id)!;
    expect(flourAfter.quantity).toBe('2 bags');
  });

  // #1806 — a scanned receipt's own date, not the moment it got scanned.
  it('stamps the purchase with an explicit purchasedAt instead of now', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    const receiptDate = '2026-08-15T12:00:00.000Z';
    useGroceryStore.getState().finishShopping(null, {}, receiptDate);

    expect(dbFinishGroceryShopping).toHaveBeenCalledWith(receiptDate, null, expect.any(Object), {}, expect.any(Set));
    expect(useGroceryStore.getState().items.find(i => i.id === milk.id)!.lastPurchasedAt)
      .toBe(receiptDate);
  });
});

describe('clearList', () => {
  it('empties the list without crediting a purchase', () => {
    // Nothing was bought — inflating purchaseCount would teach autocomplete a lie.
    const milk = makeItem({ name: 'Milk', onList: true, purchaseCount: 3 });
    seed([milk]);
    (dbClearGroceryList as jest.Mock).mockReturnValue([milk.id]);

    expect(useGroceryStore.getState().clearList()).toBe(1);

    const after = useGroceryStore.getState().items[0];
    expect(after.onList).toBe(false);
    expect(after.purchaseCount).toBe(3);
    expect(dbDeleteGroceryItem).not.toHaveBeenCalled();
  });

  // The one sweep left in the app. "I'm not doing this trip after all" drops
  // the rows that were only ever a line of the list, and keeps anything
  // carrying something the user put there — see hasUserFacts.
  it('sweeps a row carrying nothing, and parks one that has been bought', () => {
    const milk = makeItem({ name: 'Milk', onList: true, purchaseCount: 3 });
    const nduja = makeItem({ name: 'nduja', onList: true });
    seed([milk, nduja]);
    (dbClearGroceryList as jest.Mock).mockReturnValue([milk.id, nduja.id]);

    expect(useGroceryStore.getState().clearList()).toBe(2);

    const items = useGroceryStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(milk.id);
    expect(items[0].onList).toBe(false);
  });

  // The case the flag got wrong: a name minted to hold a substitute has no
  // purchases, so the old provisional rule let an unrelated abandoned trip
  // destroy it along with its link.
  it('keeps a never-bought row that carries a substitute link', () => {
    const butter = makeItem({ name: 'Butter', onList: true });
    const margarine = makeItem({ name: 'Margarine', onList: false });
    seed([butter, margarine]);
    useGroceryStore.setState({
      itemSubs: [{
        itemId: butter.id, subItemId: margarine.id, note: '',
        createdAt: '2026-08-01T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: false,
      }],
    });
    (dbClearGroceryList as jest.Mock).mockReturnValue([butter.id]);

    useGroceryStore.getState().clearList();

    const items = useGroceryStore.getState().items;
    expect(items.map(i => i.id).sort()).toEqual([butter.id, margarine.id].sort());
    expect(items.find(i => i.id === butter.id)!.onList).toBe(false);
  });

  it('queues an undo that re-parks kept rows and revives swept ones', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true, purchaseCount: 2 });
    const nduja = makeItem({ name: 'nduja', onList: true });
    seed([milk, nduja]);
    (dbClearGroceryList as jest.Mock).mockReturnValue([milk.id, nduja.id]);
    useGroceryStore.setState({ lastAction: null });

    useGroceryStore.getState().clearList();
    useGroceryStore.getState().undoLastAction();

    const items = useGroceryStore.getState().items;
    expect(items).toHaveLength(2);
    const restoredMilk = items.find(i => i.id === milk.id)!;
    expect(restoredMilk.onList).toBe(true);
    expect(restoredMilk.checked).toBe(true);
    const restoredNduja = items.find(i => i.id === nduja.id)!;
    expect(restoredNduja.onList).toBe(true);
    expect(dbInsertGroceryItem).toHaveBeenCalledWith(nduja);
    expect(dbUpdateGroceryItem).toHaveBeenCalledWith(milk);
  });

  it('leaves no undo entry when there was nothing to clear', () => {
    (dbClearGroceryList as jest.Mock).mockReturnValue([]);
    useGroceryStore.setState({ lastAction: null });

    useGroceryStore.getState().clearList();

    expect(useGroceryStore.getState().lastAction).toBeNull();
  });
});

// ─── renameItem ──────────────────────────────────────────────────────────────

describe('renameItem', () => {
  it('renames and re-keys', () => {
    const milk = makeItem({ name: 'Milk' });
    seed([milk]);

    expect(useGroceryStore.getState().renameItem(milk.id, 'Whole milk')).toBe(true);
    expect(useGroceryStore.getState().items[0].nameKey).toBe('whole milk');
  });

  it('refuses a collision rather than merging two catalog rows', () => {
    // Merging means picking whose purchaseCount survives, and there's no right answer.
    const milk = makeItem({ name: 'Milk' });
    const bread = makeItem({ name: 'Bread' });
    seed([milk, bread]);

    expect(useGroceryStore.getState().renameItem(bread.id, 'milk')).toBe(false);
    expect(useGroceryStore.getState().items.find(i => i.id === bread.id)!.name).toBe('Bread');
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });

  it('allows a re-capitalisation of the same key', () => {
    const milk = makeItem({ name: 'milk' });
    seed([milk]);
    expect(useGroceryStore.getState().renameItem(milk.id, 'Milk')).toBe(true);
  });

  it('refuses a blank name', () => {
    const milk = makeItem({ name: 'Milk' });
    seed([milk]);
    expect(useGroceryStore.getState().renameItem(milk.id, '   ')).toBe(false);
  });
});

// ─── the rest ────────────────────────────────────────────────────────────────

describe('list membership', () => {
  it('removeFromList keeps the catalog row', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk]);

    useGroceryStore.getState().removeFromList(milk.id);

    expect(useGroceryStore.getState().items).toHaveLength(1);
    expect(useGroceryStore.getState().items[0].onList).toBe(false);
    expect(useGroceryStore.getState().items[0].checked).toBe(false);
  });

  it('removeFromList parks a never-bought row rather than deleting it', () => {
    // It used to delete this row. That is the whole change: an action about
    // this week's list must not destroy the item behind it.
    const nduja = makeItem({ name: 'nduja', onList: true });
    seed([nduja]);

    useGroceryStore.getState().removeFromList(nduja.id);

    expect(dbDeleteGroceryItem).not.toHaveBeenCalled();
    expect(useGroceryStore.getState().items).toHaveLength(1);
    expect(useGroceryStore.getState().items[0].onList).toBe(false);
  });

  it('removeFromList keeps a row that was in the catalog before this trip', () => {
    // The whole point of the distinction: "not this week" must not forget
    // something you buy most weeks.
    const milk = makeItem({ name: 'Milk', onList: true, purchaseCount: 9 });
    seed([milk]);

    useGroceryStore.getState().removeFromList(milk.id);

    expect(dbDeleteGroceryItem).not.toHaveBeenCalled();
    expect(useGroceryStore.getState().items[0].purchaseCount).toBe(9);
  });

  it('removeFromList clears a recipe-owned quantity, but leaves a hand-set one alone', () => {
    const rice = makeItem({ name: 'Rice', onList: true, quantity: '3/4 cup', quantityFromRecipe: true });
    const flour = makeItem({ name: 'Flour', onList: true, quantity: '2 bags', quantityFromRecipe: false });
    seed([rice, flour]);

    useGroceryStore.getState().removeFromList(rice.id);
    useGroceryStore.getState().removeFromList(flour.id);

    expect(useGroceryStore.getState().itemById(rice.id)!.quantity).toBeNull();
    expect(useGroceryStore.getState().itemById(flour.id)!.quantity).toBe('2 bags');
  });

  it('addExistingMany only touches rows that are off the list', () => {
    const milk = makeItem({ name: 'Milk', onList: false });
    const eggs = makeItem({ name: 'Eggs', onList: true });
    seed([milk, eggs]);

    useGroceryStore.getState().addExistingMany([milk.id, eggs.id]);

    expect(dbUpdateGroceryItem).toHaveBeenCalledTimes(1);
    expect(useGroceryStore.getState().items.every(i => i.onList)).toBe(true);
  });

  // Issue #1085: the catalog's bulk re-add registers an undo scoped to exactly
  // what it added, same as a recipe or a single add.
  it('addExistingMany registers an undo that puts exactly what it added back off the list', () => {
    const milk = makeItem({ name: 'Milk', onList: false });
    const eggs = makeItem({ name: 'Eggs', onList: true });
    const bread = makeItem({ name: 'Bread', onList: false });
    seed([milk, eggs, bread]);

    useGroceryStore.getState().addExistingMany([milk.id, eggs.id, bread.id]);
    expect(useGroceryStore.getState().lastAction?.label).toBe('2 items added');

    useGroceryStore.getState().undoLastAction();

    const byId = (id: string) => useGroceryStore.getState().itemById(id)!;
    expect(byId(milk.id).onList).toBe(false);
    expect(byId(bread.id).onList).toBe(false);
    // Eggs was already on the list before the call and isn't part of what
    // this action added, so undo leaves it alone.
    expect(byId(eggs.id).onList).toBe(true);
  });

  it('deleteItem is the one real delete', () => {
    const milk = makeItem({ name: 'Milk' });
    seed([milk]);

    useGroceryStore.getState().deleteItem(milk.id);

    expect(dbDeleteGroceryItem).toHaveBeenCalledWith(milk.id);
    expect(useGroceryStore.getState().items).toEqual([]);
  });

  it('removeFromListMany parks every row, same as removeFromList does per row', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true, purchaseCount: 2 });
    const nduja = makeItem({ name: 'nduja', onList: true });
    seed([milk, nduja]);

    useGroceryStore.getState().removeFromListMany([milk.id, nduja.id]);

    expect(dbDeleteGroceryItem).not.toHaveBeenCalled();
    const after = useGroceryStore.getState().items;
    expect(after).toHaveLength(2);
    expect(after.every(i => !i.onList && !i.checked)).toBe(true);
  });

  it('removeFromListMany only touches ids that are on the list', () => {
    const milk = makeItem({ name: 'Milk', onList: false });
    seed([milk]);

    useGroceryStore.getState().removeFromListMany([milk.id]);

    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
    expect(dbDeleteGroceryItem).not.toHaveBeenCalled();
  });
});

describe('aisles', () => {
  it('setAisle moves one row and takes a new aisle into the walk order', () => {
    const item = makeItem({ name: 'nduja' });
    seed([item]);

    useGroceryStore.getState().setAisle(item.id, 'Butcher');

    expect(useGroceryStore.getState().items[0].aisle).toBe('Butcher');
    expect(useGroceryStore.getState().aisleOrder).toContain('Butcher');
  });

  it('applyDrop writes the new order and any aisle the drop changed', () => {
    const apples = makeItem({ name: 'Apples', aisle: 'Produce', onList: true, sortOrder: 1 });
    const milk = makeItem({ name: 'Milk', aisle: 'Dairy', onList: true, sortOrder: 2 });
    const bread = makeItem({ name: 'Bread', aisle: 'Bakery', onList: true, sortOrder: 3 });
    seed([apples, milk, bread]);

    // Milk dragged up under the Produce header: same slot, new aisle.
    useGroceryStore.getState().applyDrop([
      { id: apples.id, sortOrder: 1, aisle: 'Produce' },
      { id: milk.id, sortOrder: 2, aisle: 'Produce' },
      { id: bread.id, sortOrder: 3, aisle: 'Bakery' },
    ]);

    const items = useGroceryStore.getState().items;
    expect(items.find(i => i.id === milk.id)).toMatchObject({ sortOrder: 2, aisle: 'Produce' });
    // Nothing else moved, so only the row that changed is written.
    expect(dbUpdateGroceryItem).toHaveBeenCalledTimes(1);
    expect((dbUpdateGroceryItem as jest.Mock).mock.calls[0][0].id).toBe(milk.id);
  });

  it('applyDrop takes a new aisle into the walk order and ignores unknown ids', () => {
    const item = makeItem({ name: 'nduja', onList: true, sortOrder: 1 });
    seed([item]);

    useGroceryStore.getState().applyDrop([
      { id: item.id, sortOrder: 1, aisle: 'Butcher' },
      { id: 'gone', sortOrder: 2, aisle: 'Butcher' },
    ]);

    expect(useGroceryStore.getState().items[0].aisle).toBe('Butcher');
    expect(useGroceryStore.getState().aisleOrder).toContain('Butcher');
  });

  it('applyDrop writes nothing when the drop changed nothing', () => {
    const item = makeItem({ name: 'Milk', aisle: 'Dairy', onList: true, sortOrder: 3 });
    seed([item]);

    useGroceryStore.getState().applyDrop([{ id: item.id, sortOrder: 3, aisle: 'Dairy' }]);

    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });

  it('setAisleOrder persists a normalised order', () => {
    useGroceryStore.getState().setAisleOrder(['Frozen', 'Produce']);

    expect(dbSetGroceryAisleOrder).toHaveBeenCalledTimes(1);
    const written = (dbSetGroceryAisleOrder as jest.Mock).mock.calls[0][0] as string[];
    expect(written[0]).toBe('Frozen');
    expect(written[written.length - 1]).toBe(OTHER_AISLE);
  });

  it('setGroceryGroupBy persists and updates state', () => {
    useGroceryStore.getState().setGroceryGroupBy('recipe');

    expect(dbSetGroceryGroupBy).toHaveBeenCalledWith('recipe');
    expect(useGroceryStore.getState().groceryGroupBy).toBe('recipe');
  });

  it('initialize reads groceryGroupBy from settings', () => {
    (dbGetGroceryGroupBy as jest.Mock).mockReturnValue('recipe');
    useGroceryStore.getState().initialize();
    expect(useGroceryStore.getState().groceryGroupBy).toBe('recipe');
  });

  it('addAisle appends a new aisle and persists it', () => {
    const created = useGroceryStore.getState().addAisle('  Butcher  ');

    expect(created).toBe('Butcher');
    const order = useGroceryStore.getState().aisleOrder;
    expect(order).toContain('Butcher');
    // Last real slot: a new aisle goes to the end of the walk, and Other stays
    // pinned behind it.
    expect(order[order.length - 2]).toBe('Butcher');
    expect(order[order.length - 1]).toBe(OTHER_AISLE);
    // Unlike setAisleMany's side effect, a typed-out aisle is written down —
    // it has to survive the item it was created for.
    expect(dbSetGroceryAisleOrder).toHaveBeenCalledTimes(1);
  });

  it('addAisle hands back the existing aisle rather than duplicating it', () => {
    // Case-insensitive, because normalizeAisleOrder dedupes exactly — 'produce'
    // beside 'Produce' would render as two sections of one aisle.
    expect(useGroceryStore.getState().addAisle('produce')).toBe('Produce');
    expect(useGroceryStore.getState().aisleOrder.filter(a => a.toLowerCase() === 'produce')).toHaveLength(1);
    expect(dbSetGroceryAisleOrder).not.toHaveBeenCalled();
  });

  it('addAisle refuses an empty name', () => {
    expect(useGroceryStore.getState().addAisle('   ')).toBeNull();
    expect(dbSetGroceryAisleOrder).not.toHaveBeenCalled();
  });
});

// ─── renaming and deleting an aisle ──────────────────────────────────────────

describe('renameAisle', () => {
  it('renames it in place in the walk order', () => {
    const before = useGroceryStore.getState().aisleOrder.indexOf('Deli');

    expect(useGroceryStore.getState().renameAisle('Deli', 'Charcuterie')).toBe(true);

    const order = useGroceryStore.getState().aisleOrder;
    expect(order.indexOf('Charcuterie')).toBe(before);
    expect(order).not.toContain('Deli');
  });

  it('carries every row filed there onto the new name', () => {
    const nduja = makeItem({ name: 'Nduja', aisle: 'Deli', onList: true });
    const milk = makeItem({ name: 'Milk', aisle: 'Dairy & Eggs' });
    seed([nduja, milk]);

    useGroceryStore.getState().renameAisle('Deli', 'Charcuterie');

    expect(dbUpdateGroceryItem).toHaveBeenCalledTimes(1);
    const items = useGroceryStore.getState().items;
    expect(items.find(i => i.id === nduja.id)!.aisle).toBe('Charcuterie');
    expect(items.find(i => i.id === milk.id)!.aisle).toBe('Dairy & Eggs');
  });

  it('carries the remembered filings too', () => {
    seed([], { aisleOverrides: { nduja: 'Deli', milk: 'Frozen' } });

    useGroceryStore.getState().renameAisle('Deli', 'Charcuterie');

    expect(useGroceryStore.getState().aisleOverrides).toEqual({ nduja: 'Charcuterie', milk: 'Frozen' });
    // ...so typing the name again still lands in the renamed section.
    expect(useGroceryStore.getState().addByName('Nduja').aisle).toBe('Charcuterie');
  });

  it("tombstones the old name so the defaults pass can't bring it back", () => {
    useGroceryStore.getState().renameAisle('Deli', 'Charcuterie');

    expect(dbSetGroceryHiddenAisles).toHaveBeenCalledWith(expect.arrayContaining(['Deli']));
    expect(useGroceryStore.getState().hiddenAisles).toContain('Deli');
  });

  it('refuses a blank, a collision, or Other', () => {
    const s = () => useGroceryStore.getState();
    expect(s().renameAisle('Deli', '   ')).toBe(false);
    expect(s().renameAisle('Deli', 'frozen')).toBe(false);
    expect(s().renameAisle(OTHER_AISLE, 'Misc')).toBe(false);
    expect(s().renameAisle('Deli', OTHER_AISLE)).toBe(false);
    expect(s().renameAisle('Butcher', 'Charcuterie')).toBe(false);
    expect(dbSetGroceryAisleOrder).not.toHaveBeenCalled();
  });

  it('allows a re-casing of the aisle itself', () => {
    expect(useGroceryStore.getState().renameAisle('Deli', 'DELI')).toBe(true);
    expect(useGroceryStore.getState().aisleOrder).toContain('DELI');
  });
});

describe('deleteAisle', () => {
  it('drops it from the walk order and tombstones it', () => {
    useGroceryStore.getState().deleteAisle('Snacks');

    expect(useGroceryStore.getState().aisleOrder).not.toContain('Snacks');
    expect(useGroceryStore.getState().hiddenAisles).toContain('Snacks');
    expect(dbSetGroceryHiddenAisles).toHaveBeenCalledWith(expect.arrayContaining(['Snacks']));
  });

  it('files everything that was in it under Other — off-list rows included', () => {
    const chips = makeItem({ name: 'Chips', aisle: 'Snacks', onList: true });
    const nuts = makeItem({ name: 'Nuts', aisle: 'Snacks', onList: false });
    seed([chips, nuts]);

    useGroceryStore.getState().deleteAisle('Snacks');

    expect(useGroceryStore.getState().items.every(i => i.aisle === OTHER_AISLE)).toBe(true);
    expect(dbUpdateGroceryItem).toHaveBeenCalledTimes(2);
  });

  it('forgets the filings that pointed there, rather than asserting Other', () => {
    seed([], { aisleOverrides: { chips: 'Snacks', milk: 'Frozen' } });

    useGroceryStore.getState().deleteAisle('Snacks');

    expect(useGroceryStore.getState().aisleOverrides).toEqual({ milk: 'Frozen' });
  });

  it('does not let the lexicon put a deleted aisle back', () => {
    // The whole reason addByName clamps: the lexicon still says Snacks.
    useGroceryStore.getState().deleteAisle('Snacks');

    expect(useGroceryStore.getState().addByName('Chips').aisle).toBe(OTHER_AISLE);
    expect(useGroceryStore.getState().aisleOrder).not.toContain('Snacks');
  });

  it('survives a reload — the tombstone is what makes it stick', () => {
    useGroceryStore.getState().deleteAisle('Snacks');
    const written = (dbSetGroceryHiddenAisles as jest.Mock).mock.calls[0][0] as string[];
    (dbGetGroceryHiddenAisles as jest.Mock).mockReturnValue(written);
    (dbGetGroceryAisleOrder as jest.Mock).mockReturnValue(useGroceryStore.getState().aisleOrder);

    useGroceryStore.getState().initialize();

    expect(useGroceryStore.getState().aisleOrder).not.toContain('Snacks');
  });

  it('comes back when it is added again by name — the tombstone lifts itself', () => {
    useGroceryStore.getState().deleteAisle('Snacks');

    useGroceryStore.getState().addAisle('Snacks');

    expect(useGroceryStore.getState().aisleOrder).toContain('Snacks');
    expect(useGroceryStore.getState().hiddenAisles).not.toContain('Snacks');
  });

  it('refuses to delete Other, which is the floor every unknown item lands on', () => {
    useGroceryStore.getState().deleteAisle(OTHER_AISLE);

    expect(useGroceryStore.getState().aisleOrder).toContain(OTHER_AISLE);
    expect(dbSetGroceryAisleOrder).not.toHaveBeenCalled();
  });
});

// ─── stores ──────────────────────────────────────────────────────────────────

describe('shops', () => {
  it('addShop inserts and takes the name as typed', () => {
    const shop = useGroceryStore.getState().addShop("  Trader Joe's  ");

    expect(shop).not.toBeNull();
    expect(shop!.name).toBe("Trader Joe's");
    expect(shop!.nameKey).toBe(groceryNameKey("Trader Joe's"));
    expect(dbInsertGroceryShop).toHaveBeenCalledTimes(1);
    expect(useGroceryStore.getState().shops).toHaveLength(1);
  });

  it('addShop refuses a duplicate rather than handing back the existing one', () => {
    seed([], { shops: [makeShop('Costco')] });

    expect(useGroceryStore.getState().addShop('costco')).toBeNull();
    expect(dbInsertGroceryShop).not.toHaveBeenCalled();
    expect(useGroceryStore.getState().shops).toHaveLength(1);
  });

  it('addShop refuses an empty name', () => {
    expect(useGroceryStore.getState().addShop('   ')).toBeNull();
  });

  it('addShop keeps a punctuation-only name unique instead of colliding on an empty key', () => {
    const first = useGroceryStore.getState().addShop('???');
    const second = useGroceryStore.getState().addShop('!!!');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.nameKey).not.toBe(second!.nameKey);
  });

  it('renameShop leaves every link alone — they point at the id', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    const links = [{ itemId: milk.id, shopId: costco.id, purchaseCount: 3, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} }];
    seed([milk], { shops: [costco], itemShops: links });

    expect(useGroceryStore.getState().renameShop(costco.id, 'Costco Wholesale')).toBe(true);

    expect(useGroceryStore.getState().shops[0].name).toBe('Costco Wholesale');
    expect(useGroceryStore.getState().itemShops).toEqual(links);
  });

  it('renameShop refuses a collision with another store', () => {
    const costco = makeShop('Costco');
    const safeway = makeShop('Safeway');
    seed([], { shops: [costco, safeway] });

    expect(useGroceryStore.getState().renameShop(safeway.id, 'COSTCO')).toBe(false);
    expect(useGroceryStore.getState().shops.find(s => s.id === safeway.id)!.name).toBe('Safeway');
  });

  it('renameShop allows a store to keep its own key (a capitalisation fix)', () => {
    const costco = makeShop('costco');
    seed([], { shops: [costco] });

    expect(useGroceryStore.getState().renameShop(costco.id, 'Costco')).toBe(true);
    expect(useGroceryStore.getState().shops[0].name).toBe('Costco');
  });

  it('reorderShops renumbers in the order given', () => {
    const a = makeShop('Aldi');
    const b = makeShop('Big Y');
    const c = makeShop('Costco');
    seed([], { shops: [a, b, c] });

    useGroceryStore.getState().reorderShops([c.id, a.id, b.id]);

    expect(useGroceryStore.getState().shops.map(s => s.name)).toEqual(['Costco', 'Aldi', 'Big Y']);
    expect(useGroceryStore.getState().shops.map(s => s.sortOrder)).toEqual([1, 2, 3]);
  });

  it('reorderShops keeps a store the caller forgot rather than dropping it', () => {
    const a = makeShop('Aldi');
    const b = makeShop('Big Y');
    seed([], { shops: [a, b] });

    useGroceryStore.getState().reorderShops([b.id]);

    expect(useGroceryStore.getState().shops.map(s => s.name)).toEqual(['Big Y', 'Aldi']);
  });

  it('deleteShop takes its links with it', () => {
    const costco = makeShop('Costco');
    const safeway = makeShop('Safeway');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], {
      shops: [costco, safeway],
      itemShops: [
        { itemId: milk.id, shopId: costco.id, purchaseCount: 2, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
        { itemId: milk.id, shopId: safeway.id, purchaseCount: 1, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
      ],
    });

    useGroceryStore.getState().deleteShop(costco.id);

    expect(dbDeleteGroceryShop).toHaveBeenCalledWith(costco.id);
    expect(useGroceryStore.getState().shops.map(s => s.name)).toEqual(['Safeway']);
    expect(useGroceryStore.getState().itemShops).toHaveLength(1);
    expect(useGroceryStore.getState().itemShops[0].shopId).toBe(safeway.id);
  });

  it('deleteShop clears the remembered store when it was the one deleted', () => {
    const costco = makeShop('Costco');
    seed([], { shops: [costco] });
    useGroceryStore.setState({ lastShopId: costco.id });

    useGroceryStore.getState().deleteShop(costco.id);

    expect(useGroceryStore.getState().lastShopId).toBeNull();
    expect(dbSetLastShopId).toHaveBeenCalledWith(null);
  });

  it('linkItemShop asserts availability with no purchase behind it', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], { shops: [costco] });

    useGroceryStore.getState().linkItemShop(milk.id, costco.id);

    expect(useGroceryStore.getState().itemShops).toEqual([
      { itemId: milk.id, shopId: costco.id, purchaseCount: 0, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ]);
    expect(dbSetItemShopLink).toHaveBeenCalledTimes(1);
  });

  it('linkItemShop will not overwrite a link that already has purchases', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 5, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });

    useGroceryStore.getState().linkItemShop(milk.id, costco.id);

    expect(useGroceryStore.getState().itemShops[0].purchaseCount).toBe(5);
    expect(dbSetItemShopLink).not.toHaveBeenCalled();
  });

  // The seam this refactor was about: a store link is a statement about the
  // item, and it now protects its own row rather than needing the link call to
  // remember to mark it — see hasUserFacts.
  it('linkItemShop leaves the item row untouched, and the link survives a clear', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', onList: true });
    seed([milk], { shops: [costco] });

    useGroceryStore.getState().linkItemShop(milk.id, costco.id);
    // Nothing to promote any more: the link is its own protection.
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();

    (dbClearGroceryList as jest.Mock).mockReturnValue([milk.id]);
    useGroceryStore.getState().clearList();

    expect(useGroceryStore.getState().items).toHaveLength(1);
    expect(useGroceryStore.getState().itemShops).toHaveLength(1);
  });

  it('linkItemShop ignores an unknown item or store', () => {
    seed([], { shops: [] });
    useGroceryStore.getState().linkItemShop('nope', 'also-nope');
    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
  });

  // The shopping-trip sheet's "actually, it has more" correction: the user
  // answers for a whole list at once, so every rule the single-item call
  // obeys has to hold across the set.
  it('linkItemShopMany asserts the whole set at once', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    const bread = makeItem({ name: 'Bread' });
    seed([milk, bread], { shops: [costco] });

    useGroceryStore.getState().linkItemShopMany([milk.id, bread.id], costco.id);

    expect(useGroceryStore.getState().itemShops).toEqual([
      { itemId: milk.id, shopId: costco.id, purchaseCount: 0, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
      { itemId: bread.id, shopId: costco.id, purchaseCount: 0, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ]);
  });

  it('linkItemShopMany leaves an existing link and its purchases alone', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    const bread = makeItem({ name: 'Bread' });
    seed([milk, bread], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 5, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });

    useGroceryStore.getState().linkItemShopMany([milk.id, bread.id], costco.id);

    const links = useGroceryStore.getState().itemShops;
    expect(links).toHaveLength(2);
    expect(links.find(l => l.itemId === milk.id)!.purchaseCount).toBe(5);
    expect(dbSetItemShopLink).toHaveBeenCalledTimes(1);
  });

  it('linkItemShopMany skips unknown items and does nothing for an unknown store', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], { shops: [costco] });

    useGroceryStore.getState().linkItemShopMany([milk.id, 'nope'], costco.id);
    expect(useGroceryStore.getState().itemShops).toHaveLength(1);

    useGroceryStore.getState().linkItemShopMany([milk.id], 'also-nope');
    expect(useGroceryStore.getState().itemShops).toHaveLength(1);
  });

  it('linkItemShopMany writes nothing when every id is already linked', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 0, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });
    const before = useGroceryStore.getState().itemShops;

    useGroceryStore.getState().linkItemShopMany([milk.id, milk.id], costco.id);

    expect(useGroceryStore.getState().itemShops).toBe(before);
    expect(dbSetItemShopLink).not.toHaveBeenCalled();
  });

  // "They didn't have it" — the negative claim. Written by the finish sheet for
  // what a trip left behind, and by the item sheet's store picker.
  it('markItemsUnavailable stamps a claim on a store with no link yet', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], { shops: [costco] });

    useGroceryStore.getState().markItemsUnavailable([milk.id], costco.id);

    const link = useGroceryStore.getState().itemShops[0];
    expect(link.itemId).toBe(milk.id);
    expect(link.purchaseCount).toBe(0);
    expect(link.unavailableAt).not.toBeNull();
    expect(dbSetItemShopLink).toHaveBeenCalledTimes(1);
  });

  it('markItemsUnavailable keeps the purchase history on the row it marks', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 6, lastPurchasedAt: '2026-05-01T00:00:00.000Z', unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });

    useGroceryStore.getState().markItemsUnavailable([milk.id], costco.id);

    const links = useGroceryStore.getState().itemShops;
    // Replaced in place, not appended — the table holds one row per pair.
    expect(links).toHaveLength(1);
    expect(links[0].purchaseCount).toBe(6);
    expect(links[0].lastPurchasedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(links[0].unavailableAt).not.toBeNull();
  });

  it('markItemsUnavailable ignores an unknown store, and re-marking writes nothing', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 0, lastPurchasedAt: null, unavailableAt: '2026-03-01T00:00:00.000Z', lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });
    const before = useGroceryStore.getState().itemShops;

    useGroceryStore.getState().markItemsUnavailable([milk.id], 'nope');
    useGroceryStore.getState().markItemsUnavailable([milk.id], costco.id);

    expect(useGroceryStore.getState().itemShops).toBe(before);
    expect(dbSetItemShopLink).not.toHaveBeenCalled();
  });

  it('clearItemUnavailable deletes a row that was only ever the claim', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 0, lastPurchasedAt: null, unavailableAt: '2026-03-01T00:00:00.000Z', lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });

    useGroceryStore.getState().clearItemUnavailable(milk.id, costco.id);

    // Not left behind as purchaseCount 0, which would read as the opposite
    // claim ("I get it here").
    expect(useGroceryStore.getState().itemShops).toEqual([]);
    expect(dbDeleteItemShopLink).toHaveBeenCalledWith(milk.id, costco.id);
  });

  it('clearItemUnavailable keeps a row that has purchases behind it', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 4, lastPurchasedAt: null, unavailableAt: '2026-03-01T00:00:00.000Z', lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });

    useGroceryStore.getState().clearItemUnavailable(milk.id, costco.id);

    expect(useGroceryStore.getState().itemShops).toEqual([
      { itemId: milk.id, shopId: costco.id, purchaseCount: 4, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ]);
    expect(dbDeleteItemShopLink).not.toHaveBeenCalled();
  });

  it('linkItemShopMany flips a negative link rather than skipping it', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 2, lastPurchasedAt: null, unavailableAt: '2026-03-01T00:00:00.000Z', lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });

    useGroceryStore.getState().linkItemShopMany([milk.id], costco.id);

    expect(useGroceryStore.getState().itemShops).toEqual([
      { itemId: milk.id, shopId: costco.id, purchaseCount: 2, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ]);
  });

  it('unlinkItemShop removes just that pair', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    const eggs = makeItem({ name: 'Eggs' });
    seed([milk, eggs], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 1, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
      { itemId: eggs.id, shopId: costco.id, purchaseCount: 1, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });

    useGroceryStore.getState().unlinkItemShop(milk.id, costco.id);

    expect(useGroceryStore.getState().itemShops.map(l => l.itemId)).toEqual([eggs.id]);
  });

  it('deleting an item drops its links too', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 4, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });

    useGroceryStore.getState().deleteItem(milk.id);

    expect(useGroceryStore.getState().items).toHaveLength(0);
    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
  });

  it('initialize drops a remembered store that no longer exists', () => {
    (dbGetLastShopId as jest.Mock).mockReturnValue('shop-gone');

    useGroceryStore.getState().initialize();

    expect(useGroceryStore.getState().lastShopId).toBeNull();
  });

  it('initialize keeps a remembered store that does', () => {
    const costco = makeShop('Costco');
    (dbGetAllGroceryShops as jest.Mock).mockReturnValue([costco]);
    (dbGetLastShopId as jest.Mock).mockReturnValue(costco.id);

    useGroceryStore.getState().initialize();

    expect(useGroceryStore.getState().lastShopId).toBe(costco.id);
  });
});

describe('prices by hand', () => {
  const link = (itemId: string, shopId: string, overrides: Partial<ItemShopLink> = {}): ItemShopLink => ({
    itemId,
    shopId,
    purchaseCount: 1,
    productId: null,
    unavailableProductIds: {},
    lastPurchasedAt: null,
    unavailableAt: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  });

  it('setItemPrice with a store writes both that store and the item', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', quantity: '2 L' });
    seed([milk], { shops: [costco], itemShops: [link(milk.id, costco.id)] });

    useGroceryStore.getState().setItemPrice(milk.id, 319, costco.id);

    const state = useGroceryStore.getState();
    expect(state.items[0].lastPriceMinor).toBe(319);
    // The quantity it's a price for is paired on both, or the number describes
    // nothing.
    expect(state.items[0].lastPriceQuantity).toBe('2 L');
    expect(state.itemShops[0].lastPriceMinor).toBe(319);
    expect(state.itemShops[0].lastPriceQuantity).toBe('2 L');
  });

  it('setItemPrice with a store the item has no link to leaves the link alone', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], { shops: [costco], itemShops: [] });

    useGroceryStore.getState().setItemPrice(milk.id, 319, costco.id);

    // A price is not an assertion that the store stocks it, so nothing is minted.
    expect(useGroceryStore.getState().itemShops).toEqual([]);
    expect(useGroceryStore.getState().items[0].lastPriceMinor).toBe(319);
  });

  it('clearItemShopPrice forgets one store and leaves the item price standing', () => {
    const costco = makeShop('Costco');
    const safeway = makeShop('Safeway');
    const milk = makeItem({
      name: 'Milk',
      lastPriceMinor: 429,
      lastPricedAt: '2026-08-01T00:00:00.000Z',
      lastPriceQuantity: '2 L', priceHistory: [],
    });
    seed([milk], {
      shops: [costco, safeway],
      itemShops: [
        link(milk.id, costco.id, { lastPriceMinor: 319, lastPricedAt: '2026-07-01T00:00:00.000Z', lastPriceQuantity: '2 L', priceHistory: [] }),
        link(milk.id, safeway.id, { lastPriceMinor: 429, lastPricedAt: '2026-08-01T00:00:00.000Z', lastPriceQuantity: '2 L', priceHistory: [] }),
      ],
    });

    useGroceryStore.getState().clearItemShopPrice(milk.id, costco.id);

    const state = useGroceryStore.getState();
    // "I don't know what Costco charges" is not "I've never paid for milk".
    expect(state.items[0].lastPriceMinor).toBe(429);
    expect(state.itemShops[0].lastPriceMinor).toBeNull();
    // The stamp and the quantity go with the number rather than outliving it.
    expect(state.itemShops[0].lastPricedAt).toBeNull();
    expect(state.itemShops[0].lastPriceQuantity).toBeNull();
    expect(state.itemShops[1].lastPriceMinor).toBe(429);
  });

  it('clearItemShopPrice keeps the purchases the link is really for', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], {
      shops: [costco],
      itemShops: [link(milk.id, costco.id, { purchaseCount: 6, lastPurchasedAt: '2026-08-01T00:00:00.000Z', lastPriceMinor: 319 })],
    });

    useGroceryStore.getState().clearItemShopPrice(milk.id, costco.id);

    expect(useGroceryStore.getState().itemShops[0]).toMatchObject({
      purchaseCount: 6,
      lastPurchasedAt: '2026-08-01T00:00:00.000Z',
      lastPriceMinor: null,
    });
  });

  it('clearItemShopPrice on a link with no price writes nothing', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk' });
    seed([milk], { shops: [costco], itemShops: [link(milk.id, costco.id)] });

    useGroceryStore.getState().clearItemShopPrice(milk.id, costco.id);

    expect(dbSetItemShopLink).not.toHaveBeenCalled();
  });
});

describe('finishShopping with a store', () => {
  it('creates a link on the first trip and remembers the store', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk], { shops: [costco] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(costco.id);

    expect(dbFinishGroceryShopping).toHaveBeenCalledWith(expect.any(String), costco.id, expect.any(Object), expect.any(Object), expect.any(Set));
    const links = useGroceryStore.getState().itemShops;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ itemId: milk.id, shopId: costco.id, purchaseCount: 1 });
    expect(links[0].lastPurchasedAt).not.toBeNull();
    expect(useGroceryStore.getState().lastShopId).toBe(costco.id);
  });

  // The automatic half of the capture. Sound *because* the item is strict:
  // strict means the user would not have bought a substitute, so a purchase
  // here really is evidence this store had the box they want.
  it('records the product on the link when the item insists on one', () => {
    const costco = makeShop('Costco');
    const product = makeProduct('cc', 'Good Culture', 'low fat');
    const cc = makeItem({
      name: 'Cottage cheese', id: 'cc', onList: true, checked: true,
      preferredProductId: product.id, productStrict: true,
    });
    seed([cc], { shops: [costco], itemProducts: [product] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([cc.id]);

    useGroceryStore.getState().finishShopping(costco.id);

    expect(useGroceryStore.getState().itemShops[0].productId).toBe(product.id);
  });

  // On a row with no rule the same purchase says nothing about which one came
  // home — stamping it would manufacture the evidence the feature waits for.
  it('records nothing when the item merely names a product', () => {
    const costco = makeShop('Costco');
    const product = makeProduct('cc', 'Good Culture', 'low fat');
    const cc = makeItem({
      name: 'Cottage cheese', id: 'cc', onList: true, checked: true,
      preferredProductId: product.id, productStrict: false,
    });
    seed([cc], { shops: [costco], itemProducts: [product] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([cc.id]);

    useGroceryStore.getState().finishShopping(costco.id);

    expect(useGroceryStore.getState().itemShops[0].productId).toBeNull();
  });

  it('clears "they haven’t got yours" — a purchase refutes it outright', () => {
    const costco = makeShop('Costco');
    const product = makeProduct('cc', 'Good Culture', 'low fat');
    const cc = makeItem({
      name: 'Cottage cheese', id: 'cc', onList: true, checked: true,
      preferredProductId: product.id, productStrict: true,
    });
    seed([cc], { shops: [costco], itemProducts: [product], itemShops: [
      { itemId: cc.id, shopId: costco.id, purchaseCount: 1, lastPurchasedAt: null,
        unavailableAt: null, lastPriceMinor: null, lastPricedAt: null,
        lastPriceQuantity: null, priceHistory: [], productId: 'p-lucerne',
        unavailableProductIds: { [product.id]: '2026-03-04T00:00:00.000Z' } },
    ] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([cc.id]);

    useGroceryStore.getState().finishShopping(costco.id);

    const [link] = useGroceryStore.getState().itemShops;
    expect(link.productId).toBe(product.id);
    // Every claim about this store's shelf, not just the one about the box
    // that came home — coming home with something refutes them all.
    expect(link.unavailableProductIds).toEqual({});
  });

  it('bumps an existing link on a repeat trip instead of adding a second', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true, purchaseCount: 2 });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 2, lastPurchasedAt: '2026-01-01T00:00:00.000Z', unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(costco.id);

    const links = useGroceryStore.getState().itemShops;
    expect(links).toHaveLength(1);
    expect(links[0].purchaseCount).toBe(3);
    expect(links[0].lastPurchasedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('clears a "they don’t have it" when you buy it there after all', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 3, lastPurchasedAt: null, unavailableAt: '2026-03-01T00:00:00.000Z', lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(costco.id);

    const links = useGroceryStore.getState().itemShops;
    expect(links).toHaveLength(1);
    expect(links[0].purchaseCount).toBe(4);
    // A purchase refutes the claim outright — nobody should have to undo it.
    expect(links[0].unavailableAt).toBeNull();
  });

  it('records a price on both the item and the store it was paid at', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true, quantity: '1 gal' });
    seed([milk], { shops: [costco] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(costco.id, { [milk.id]: 429 });

    const after = useGroceryStore.getState().items.find(i => i.id === milk.id)!;
    expect(after.lastPriceMinor).toBe(429);
    expect(after.lastPricedAt).not.toBeNull();
    // Paired with what it actually bought — the whole point of the field.
    expect(after.lastPriceQuantity).toBe('1 gal');

    const link = useGroceryStore.getState().itemShops[0];
    expect(link).toMatchObject({ lastPriceMinor: 429, lastPriceQuantity: '1 gal' });
  });

  it('leaves an unpriced item’s previous price standing', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({
      name: 'Milk', onList: true, checked: true,
      lastPriceMinor: 399, lastPricedAt: '2026-01-01T00:00:00.000Z', lastPriceQuantity: '1 gal', priceHistory: [],
    });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 1, lastPurchasedAt: null, unavailableAt: null,
        lastPriceMinor: 399, lastPricedAt: '2026-01-01T00:00:00.000Z', lastPriceQuantity: '1 gal', priceHistory: [],
        productId: null, unavailableProductIds: {} },
    ] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    // A trip nobody priced is not a claim that anything got cheaper.
    useGroceryStore.getState().finishShopping(costco.id);

    const after = useGroceryStore.getState().items.find(i => i.id === milk.id)!;
    expect(after.lastPriceMinor).toBe(399);
    expect(after.lastPricedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(useGroceryStore.getState().itemShops[0].lastPriceMinor).toBe(399);
  });

  it('records a priced trip into the rolling window, at both levels', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true, quantity: '1 gal' });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 1, lastPurchasedAt: null, unavailableAt: null,
        lastPriceMinor: 399, lastPricedAt: '2026-01-01T00:00:00.000Z', lastPriceQuantity: '1 gal',
        priceHistory: [{ minor: 399, quantity: '1 gal', at: '2026-01-01T00:00:00.000Z' }],
        productId: null, unavailableProductIds: {} },
    ] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(costco.id, { [milk.id]: 429 });

    // The same purchase lands in both runs, exactly as lastPriceMinor does —
    // the item's is the fallback for a trip that named no store.
    const item = useGroceryStore.getState().items.find(i => i.id === milk.id)!;
    expect(item.priceHistory[0]).toMatchObject({ minor: 429, quantity: '1 gal' });

    const link = useGroceryStore.getState().itemShops[0];
    expect(link.priceHistory.map(o => o.minor)).toEqual([429, 399]);
  });

  it('leaves the window alone for a row the trip did not price', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 1, lastPurchasedAt: null, unavailableAt: null,
        lastPriceMinor: 399, lastPricedAt: '2026-01-01T00:00:00.000Z', lastPriceQuantity: null,
        priceHistory: [{ minor: 399, quantity: null, at: '2026-01-01T00:00:00.000Z' }],
        productId: null, unavailableProductIds: {} },
    ] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    // Silence about the price is not an observation of one.
    useGroceryStore.getState().finishShopping(costco.id);

    expect(useGroceryStore.getState().items[0].priceHistory).toEqual([]);
    expect(useGroceryStore.getState().itemShops[0].priceHistory).toHaveLength(1);
  });

  it('records a price on the item alone when no store is named', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(null, { [milk.id]: 429 });

    expect(useGroceryStore.getState().items[0].lastPriceMinor).toBe(429);
    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
  });

  it('turns a hand-asserted link into an observed one', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk], { shops: [costco], itemShops: [
      { itemId: milk.id, shopId: costco.id, purchaseCount: 0, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(costco.id);

    expect(useGroceryStore.getState().itemShops[0].purchaseCount).toBe(1);
  });

  it('leaves another store’s link for the same item alone', () => {
    const costco = makeShop('Costco');
    const safeway = makeShop('Safeway');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk], { shops: [costco, safeway], itemShops: [
      { itemId: milk.id, shopId: safeway.id, purchaseCount: 4, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
    ] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(costco.id);

    const links = useGroceryStore.getState().itemShops;
    expect(links).toHaveLength(2);
    expect(links.find(l => l.shopId === safeway.id)!.purchaseCount).toBe(4);
    expect(links.find(l => l.shopId === costco.id)!.purchaseCount).toBe(1);
  });

  // The point of the whole feature being additive: no store is a real answer.
  it('records no link when the trip names no store', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk], { shops: [makeShop('Costco')] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping();

    expect(dbFinishGroceryShopping).toHaveBeenCalledWith(expect.any(String), null, expect.any(Object), expect.any(Object), expect.any(Set));
    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
    // ...and the item-level count still moved, which is what makes the two
    // numbers diverge and why nothing may sum links to get a total.
    expect(useGroceryStore.getState().items[0].purchaseCount).toBe(1);
    expect(dbSetLastShopId).not.toHaveBeenCalled();
  });

  it('ignores a store id that no longer resolves', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk], { shops: [] });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping('shop-deleted-mid-sheet');

    expect(dbFinishGroceryShopping).toHaveBeenCalledWith(expect.any(String), null, expect.any(Object), expect.any(Object), expect.any(Set));
    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
  });

  it('writes nothing at all when the trolley is empty', () => {
    const costco = makeShop('Costco');
    seed([makeItem({ name: 'Milk', onList: true })], { shops: [costco] });

    expect(useGroceryStore.getState().finishShopping(costco.id)).toBe(0);
    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
    expect(useGroceryStore.getState().lastShopId).toBeNull();
  });

  it('clearList records no purchase anywhere, store or not', () => {
    const costco = makeShop('Costco');
    // Bought before, so clearList parks it rather than sweeping it — the point
    // here is that abandoning a trip adds no *new* purchase.
    const milk = makeItem({ name: 'Milk', onList: true, checked: true, purchaseCount: 1 });
    seed([milk], { shops: [costco] });
    (dbClearGroceryList as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().clearList();

    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
    expect(useGroceryStore.getState().items[0].purchaseCount).toBe(1);
  });
});

describe('finishShopping undo', () => {
  it('restores everything a purchase touched', () => {
    const nduja = makeItem({
      name: 'nduja', onList: true, checked: true, purchaseCount: 0,
      quantity: '1 jar', quantityFromRecipe: true,
    });
    seed([nduja]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([nduja.id]);

    expect(useGroceryStore.getState().finishShopping()).toBe(1);
    expect(useGroceryStore.getState().lastAction?.label).toBe('Bought 1 thing');

    useGroceryStore.getState().undoLastAction();

    const restored = useGroceryStore.getState().items[0];
    expect(restored.onList).toBe(true);
    expect(restored.checked).toBe(true);
    expect(restored.purchaseCount).toBe(0);
    expect(restored.lastPurchasedAt).toBeNull();
    expect(restored.quantity).toBe('1 jar');
    expect(restored.quantityFromRecipe).toBe(true);
    expect(dbUpdateGroceryItem).toHaveBeenCalledWith(nduja);
  });

  it('undoes a priced purchase back to no price at all', () => {
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([milk]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(null, { [milk.id]: 429 });
    useGroceryStore.getState().undoLastAction();

    const restored = useGroceryStore.getState().items[0];
    expect(restored.lastPriceMinor).toBeNull();
    expect(restored.lastPricedAt).toBeNull();
  });

  it('puts a bumped item-shop link back to its old counts and un-remembers a brand-new one', () => {
    const costco = makeShop('Costco');
    const target = makeShop('Target');
    const milk = makeItem({ name: 'Milk', onList: true, checked: true, purchaseCount: 2 });
    const eggs = makeItem({ name: 'Eggs', onList: true, checked: true });
    seed([milk, eggs], {
      shops: [costco, target],
      itemShops: [
        { itemId: milk.id, shopId: costco.id, purchaseCount: 2, lastPurchasedAt: '2026-01-01T00:00:00.000Z',
          unavailableAt: '2026-02-01T00:00:00.000Z', lastPriceMinor: null, lastPricedAt: null,
          lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
      ],
    });
    // Last week's store — this trip is at a different one.
    useGroceryStore.setState({ lastShopId: target.id });
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id, eggs.id]);

    useGroceryStore.getState().finishShopping(costco.id);
    expect(useGroceryStore.getState().itemShops).toHaveLength(2);
    expect(useGroceryStore.getState().lastShopId).toBe(costco.id);

    useGroceryStore.getState().undoLastAction();

    const links = useGroceryStore.getState().itemShops;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      itemId: milk.id, shopId: costco.id, purchaseCount: 2, unavailableAt: '2026-02-01T00:00:00.000Z',
    });
    expect(dbSetItemShopLink).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: milk.id, shopId: costco.id, purchaseCount: 2 })
    );
    // The link this trip minted outright never existed before it.
    expect(dbDeleteItemShopLink).toHaveBeenCalledWith(eggs.id, costco.id);
    expect(dbSetLastShopId).toHaveBeenCalledWith(target.id);
    expect(useGroceryStore.getState().lastShopId).toBe(target.id);
  });

  it('leaves no undo entry with an empty trolley', () => {
    seed([makeItem({ name: 'Milk', onList: true })]);
    useGroceryStore.setState({ lastAction: null });

    useGroceryStore.getState().finishShopping();

    expect(useGroceryStore.getState().lastAction).toBeNull();
  });

  it('re-derives the use-up task against the restored item, dropping the one it spawned', () => {
    mockUseUpTasks = true;
    const spinach = makeItem({ name: 'spinach', onList: true, checked: true });
    seed([spinach]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([spinach.id]);

    useGroceryStore.getState().finishShopping();
    expect(useUpTaskFor(spinach.id)).toBeDefined();

    useGroceryStore.getState().undoLastAction();

    expect(useGroceryStore.getState().items[0].expiresAt).toBeNull();
    expect(useUpTaskFor(spinach.id)).toBeUndefined();
  });
});

// ─── remembered aisles ───────────────────────────────────────────────────────

describe('remembered aisles', () => {
  it('setAisle records the filing under the item name', () => {
    const item = makeItem({ name: 'Protein powder' });
    seed([item]);

    useGroceryStore.getState().setAisle(item.id, 'Household');

    expect(dbSetGroceryAisleOverrides).toHaveBeenCalledWith({ 'protein powder': 'Household' });
    expect(useGroceryStore.getState().aisleOverrides).toEqual({ 'protein powder': 'Household' });
  });

  it('a new row is filed where the user last put that name, over the lexicon', () => {
    // The lexicon would say Dairy & Eggs; their shop keeps it somewhere else.
    seed([], { aisleOverrides: { milk: 'Frozen' } });

    const item = useGroceryStore.getState().addByName('Milk');

    expect(item.aisle).toBe('Frozen');
  });

  it('survives the row it was made on being deleted', () => {
    // The case the memory exists for: it is keyed by nameKey in a setting, so
    // it outlives the row itself and is re-applied when the name comes back.
    const item = useGroceryStore.getState().addByName('Nduja');
    useGroceryStore.getState().setAisle(item.id, 'Butcher');
    useGroceryStore.getState().deleteItem(item.id);
    expect(useGroceryStore.getState().items).toEqual([]);

    expect(useGroceryStore.getState().addByName('nduja').aisle).toBe('Butcher');
  });

  it('leaves an existing catalog row alone — its own aisle is already the truth', () => {
    const item = makeItem({ name: 'Milk', aisle: 'Dairy & Eggs' });
    seed([item], { aisleOverrides: { milk: 'Frozen' } });

    expect(useGroceryStore.getState().addByName('Milk').aisle).toBe('Dairy & Eggs');
  });

  it('applyDrop remembers a row dragged into another aisle', () => {
    const item = makeItem({ name: 'Nduja', aisle: OTHER_AISLE, onList: true, sortOrder: 1 });
    seed([item]);

    useGroceryStore.getState().applyDrop([{ id: item.id, sortOrder: 2, aisle: 'Deli' }]);

    expect(useGroceryStore.getState().aisleOverrides).toEqual({ nduja: 'Deli' });
  });

  it('applyDrop remembers nothing when the drag only reordered within an aisle', () => {
    const item = makeItem({ name: 'Milk', aisle: 'Dairy & Eggs', onList: true, sortOrder: 1 });
    seed([item]);

    useGroceryStore.getState().applyDrop([{ id: item.id, sortOrder: 5, aisle: 'Dairy & Eggs' }]);

    expect(dbSetGroceryAisleOverrides).not.toHaveBeenCalled();
    expect(useGroceryStore.getState().aisleOverrides).toEqual({});
  });

  it('follows a rename, so the filing survives fixing a typo', () => {
    const item = makeItem({ name: 'Protien powder' });
    seed([item], { aisleOverrides: { 'protien powder': 'Household' } });

    useGroceryStore.getState().renameItem(item.id, 'Protein powder');

    expect(useGroceryStore.getState().aisleOverrides).toEqual({ 'protein powder': 'Household' });
    expect(dbSetGroceryAisleOverrides).toHaveBeenCalledWith({ 'protein powder': 'Household' });
  });

  it('writes nothing when the filing is the one already remembered', () => {
    const item = makeItem({ name: 'Nduja', aisle: OTHER_AISLE });
    seed([item], { aisleOverrides: { nduja: 'Deli' } });

    useGroceryStore.getState().setAisle(item.id, 'Deli');

    expect(dbSetGroceryAisleOverrides).not.toHaveBeenCalled();
  });

  it('initialize loads what was remembered', () => {
    (dbGetGroceryAisleOverrides as jest.Mock).mockReturnValue({ nduja: 'Deli' });

    useGroceryStore.getState().initialize();

    expect(useGroceryStore.getState().rememberedAisleFor('Nduja')).toBe('Deli');
    expect(useGroceryStore.getState().rememberedAisleFor('Milk')).toBeNull();
  });
});

describe('addFromPlan', () => {
  it('adds a new name carrying its quantity and aisle', () => {
    seed([]);

    const result = useGroceryStore.getState().addFromPlan([
      { name: 'Chicken thighs', quantity: '2 lb', aisle: 'Meat & Seafood' },
    ]);

    expect(result.added).toHaveLength(1);
    expect(result.alreadyOnList).toHaveLength(0);
    expect(result.skippedInCart).toHaveLength(0);

    const item = useGroceryStore.getState().itemByNameKey('chicken thighs')!;
    expect(item.onList).toBe(true);
    expect(item.quantity).toBe('2 lb');
    expect(item.aisle).toBe('Meat & Seafood');
  });

  it('re-lists a catalog row that was off the list', () => {
    const parsley = makeItem({ name: 'Parsley', onList: false, aisle: 'Produce' });
    seed([parsley]);

    const result = useGroceryStore.getState().addFromPlan([
      { name: 'Parsley', quantity: '1 bunch', aisle: 'Produce' },
    ]);

    expect(result.added.map(i => i.id)).toEqual([parsley.id]);
    expect(useGroceryStore.getState().itemById(parsley.id)!.onList).toBe(true);
  });

  it('leaves a row already on the list exactly as it was', () => {
    const milk = makeItem({ name: 'Milk', onList: true, quantity: '2 gal' });
    seed([milk]);

    const result = useGroceryStore.getState().addFromPlan([
      { name: 'Milk', quantity: '1 pint', aisle: 'Dairy & Eggs' },
    ]);

    expect(result.alreadyOnList.map(i => i.id)).toEqual([milk.id]);
    expect(result.added).toHaveLength(0);
    // The quantity the user set survives — this is the overwrite addByName
    // already refuses to do, held to across the plan path too.
    expect(useGroceryStore.getState().itemById(milk.id)!.quantity).toBe('2 gal');
  });

  it('marks a quantity it writes as recipe-owned, and never overwrites a hand-set one', () => {
    // Rice with no quantity yet — the plan is free to write into it.
    const rice = makeItem({ name: 'Rice', onList: false, quantity: null });
    // Flour already carries the user's own "2 bags" — off list, so addFromPlan
    // would otherwise re-list and overwrite it (issue #1581's second symptom).
    const flour = makeItem({ name: 'Flour', onList: false, quantity: '2 bags' });
    seed([rice, flour]);

    useGroceryStore.getState().addFromPlan([
      { name: 'Rice', quantity: '3/4 cup', aisle: 'Pantry' },
      { name: 'Flour', quantity: '2 lb', aisle: 'Pantry' },
    ]);

    const riceAfter = useGroceryStore.getState().itemById(rice.id)!;
    expect(riceAfter.quantity).toBe('3/4 cup');
    expect(riceAfter.quantityFromRecipe).toBe(true);

    const flourAfter = useGroceryStore.getState().itemById(flour.id)!;
    expect(flourAfter.quantity).toBe('2 bags');
    expect(flourAfter.quantityFromRecipe).toBe(false);
  });

  it('ends the full trace with no quantity: recipe add, finish, months later a bare re-add', () => {
    const rice = makeItem({ name: 'Rice', onList: false, quantity: null });
    seed([rice]);

    // 1. Add "Weeknight stir-fry" — rice gets a recipe-owned quantity.
    useGroceryStore.getState().addFromPlan([{ name: 'Rice', quantity: '3/4 cup', aisle: 'Pantry' }]);
    expect(useGroceryStore.getState().itemById(rice.id)!.quantity).toBe('3/4 cup');

    // 2. Finish the shop — a recipe-owned quantity doesn't survive it.
    // The add put rice back on the list; check it off, same as buying it.
    useGroceryStore.getState().toggleChecked(rice.id);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([rice.id]);
    useGroceryStore.getState().finishShopping();
    expect(useGroceryStore.getState().itemById(rice.id)!.quantity).toBeNull();
    expect(useGroceryStore.getState().itemById(rice.id)!.quantityFromRecipe).toBe(false);

    // 3 & 4. Months later, type "rice" with no quantity — it comes back bare,
    // not still saying "3/4 cup".
    useGroceryStore.getState().addByName('Rice');
    expect(useGroceryStore.getState().itemById(rice.id)!.quantity).toBeNull();
  });

  it('never un-checks a row already in the trolley', () => {
    const eggs = makeItem({ name: 'Eggs', onList: true, checked: true });
    seed([eggs]);

    const result = useGroceryStore.getState().addFromPlan([
      { name: 'Eggs', quantity: '12', aisle: 'Dairy & Eggs' },
    ]);

    expect(result.skippedInCart.map(i => i.id)).toEqual([eggs.id]);
    expect(result.added).toHaveLength(0);
    // The whole point: adding a recipe mid-shop must not empty the trolley.
    expect(useGroceryStore.getState().itemById(eggs.id)!.checked).toBe(true);
  });

  it('puts the options of one choice group on the list as an either/or', () => {
    seed([]);

    useGroceryStore.getState().addFromPlan([
      { name: 'Beans', quantity: '2 cans', aisle: 'Pantry' },
      { name: 'Serrano', quantity: '2', aisle: 'Produce', choiceGroup: 'r1:Pepper' },
      { name: 'Jalapeño', quantity: '2', aisle: 'Produce', choiceGroup: 'r1:Pepper' },
    ]);

    const beans = useGroceryStore.getState().itemByNameKey('beans')!;
    const serrano = useGroceryStore.getState().itemByNameKey('serrano')!;
    const jalapeno = useGroceryStore.getState().itemByNameKey('jalapeno')!;

    expect(beans.choiceGroup).toBeNull();
    expect(serrano.choiceGroup).toBeTruthy();
    expect(jalapeno.choiceGroup).toBe(serrano.choiceGroup);
    // Opaque, not the recipe's label — a grocery row renders no heading for a
    // group, and two shops of one recipe must not merge weeks apart.
    expect(serrano.choiceGroup).not.toBe('r1:Pepper');
  });

  it('gives two different groups two different ids', () => {
    seed([]);

    useGroceryStore.getState().addFromPlan([
      { name: 'Serrano', quantity: '', aisle: null, choiceGroup: 'r1:Pepper' },
      { name: 'Jalapeño', quantity: '', aisle: null, choiceGroup: 'r1:Pepper' },
      { name: 'Cheddar', quantity: '', aisle: null, choiceGroup: 'r1:Cheese' },
      { name: 'Manchego', quantity: '', aisle: null, choiceGroup: 'r1:Cheese' },
    ]);

    const get = (key: string) => useGroceryStore.getState().itemByNameKey(key)!.choiceGroup;
    expect(get('serrano')).toBe(get('jalapeno'));
    expect(get('cheddar')).toBe(get('manchego'));
    expect(get('serrano')).not.toBe(get('cheddar'));
  });

  it('ticking one option at the shelf takes the others off the list', () => {
    seed([]);

    useGroceryStore.getState().addFromPlan([
      { name: 'Serrano', quantity: '', aisle: null, choiceGroup: 'r1:Pepper' },
      { name: 'Jalapeño', quantity: '', aisle: null, choiceGroup: 'r1:Pepper' },
    ]);

    const serrano = useGroceryStore.getState().itemByNameKey('serrano')!;
    useGroceryStore.getState().toggleChecked(serrano.id);

    expect(useGroceryStore.getState().itemByNameKey('serrano')!.checked).toBe(true);
    expect(useGroceryStore.getState().itemByNameKey('jalapeno')?.onList ?? false).toBe(false);
  });

  it('leaves a row already on the list out of a new either/or', () => {
    const serrano = makeItem({ name: 'Serrano', onList: true });
    seed([serrano]);

    useGroceryStore.getState().addFromPlan([
      { name: 'Serrano', quantity: '', aisle: null, choiceGroup: 'r1:Pepper' },
      { name: 'Jalapeño', quantity: '', aisle: null, choiceGroup: 'r1:Pepper' },
    ]);

    // It was already wanted outright; addFromPlan reports it and touches
    // nothing, which is exactly what keeps a mid-shop add from rewriting the
    // trolley.
    expect(useGroceryStore.getState().itemById(serrano.id)!.choiceGroup).toBeNull();
  });

  it('lets a filing the user made outrank the plan-supplied aisle', () => {
    seed([], { aisleOverrides: { nduja: 'Deli' } });

    useGroceryStore.getState().addFromPlan([
      { name: 'Nduja', quantity: '', aisle: 'Pantry' },
    ]);

    expect(useGroceryStore.getState().itemByNameKey('nduja')!.aisle).toBe('Deli');
  });

  it('takes the plan aisle when the user has never filed the name', () => {
    seed([]);

    useGroceryStore.getState().addFromPlan([
      { name: 'Gochujang', quantity: '2 tbsp', aisle: 'Pantry' },
    ]);

    expect(useGroceryStore.getState().itemByNameKey('gochujang')!.aisle).toBe('Pantry');
  });

  it('leaves the aisle to the lexicon when the plan has no opinion', () => {
    seed([]);

    useGroceryStore.getState().addFromPlan([
      { name: 'Bananas', quantity: '', aisle: null },
    ]);

    expect(useGroceryStore.getState().itemByNameKey('bananas')!.aisle).toBe('Produce');
  });

  it('sorts one mixed batch into all three buckets', () => {
    const inCart = makeItem({ name: 'Garlic', onList: true, checked: true });
    const onList = makeItem({ name: 'Onions', onList: true });
    const known = makeItem({ name: 'Carrots', onList: false });
    seed([inCart, onList, known]);

    const result = useGroceryStore.getState().addFromPlan([
      { name: 'Garlic', quantity: '1 bulb', aisle: 'Produce' },
      { name: 'Onions', quantity: '3', aisle: 'Produce' },
      { name: 'Carrots', quantity: '500 g', aisle: 'Produce' },
      { name: 'Thyme', quantity: '1 bunch', aisle: 'Produce' },
    ]);

    expect(result.skippedInCart.map(i => i.name)).toEqual(['Garlic']);
    expect(result.alreadyOnList.map(i => i.name)).toEqual(['Onions']);
    expect(result.added.map(i => i.name)).toEqual(['Carrots', 'Thyme']);
  });

  // Issue #1085: a recipe import registers one combined undo scoped to what
  // it actually added — the in-cart and already-on-list rows above are
  // untouched, so undo must leave them exactly as they were too.
  it('registers an undo that removes exactly the rows this add created', () => {
    const inCart = makeItem({ name: 'Garlic', onList: true, checked: true });
    const onList = makeItem({ name: 'Onions', onList: true });
    const known = makeItem({ name: 'Carrots', onList: false });
    seed([inCart, onList, known]);

    useGroceryStore.getState().addFromPlan([
      { name: 'Garlic', quantity: '1 bulb', aisle: 'Produce' },
      { name: 'Onions', quantity: '3', aisle: 'Produce' },
      { name: 'Carrots', quantity: '500 g', aisle: 'Produce' },
      { name: 'Thyme', quantity: '1 bunch', aisle: 'Produce' },
    ]);
    expect(useGroceryStore.getState().lastAction?.label).toBe('2 items added');

    useGroceryStore.getState().undoLastAction();

    const byName = (name: string) =>
      useGroceryStore.getState().items.find(i => i.name === name);
    // Carrots was a catalog row re-listed by this add — undo takes it back off.
    expect(byName('Carrots')!.onList).toBe(false);
    // Thyme was minted by this add and carries nothing, so undo deletes it.
    expect(byName('Thyme')).toBeUndefined();
    // Untouched by this add, so untouched by its undo.
    expect(byName('Garlic')!.checked).toBe(true);
    expect(byName('Onions')!.onList).toBe(true);
  });

  it('attributes a newly created row to the recipe it came from', () => {
    seed([]);

    useGroceryStore.getState().addFromPlan([
      { name: 'Chili powder', quantity: '2 tbsp', aisle: 'Spices', sourceRecipeId: 'r1', sourceRecipeTitle: 'Chili' },
    ]);

    const item = useGroceryStore.getState().itemByNameKey('chili powder')!;
    expect(item.sourceRecipeId).toBe('r1');
    expect(item.sourceRecipeTitle).toBe('Chili');
  });

  it('never overwrites the source of a row that already existed', () => {
    const parsley = makeItem({
      name: 'Parsley', onList: false, aisle: 'Produce',
      sourceRecipeId: 'r-original', sourceRecipeTitle: 'Original recipe',
    });
    seed([parsley]);

    useGroceryStore.getState().addFromPlan([
      { name: 'Parsley', quantity: '1 bunch', aisle: 'Produce', sourceRecipeId: 'r-new', sourceRecipeTitle: 'New recipe' },
    ]);

    const item = useGroceryStore.getState().itemById(parsley.id)!;
    expect(item.sourceRecipeId).toBe('r-original');
    expect(item.sourceRecipeTitle).toBe('Original recipe');
  });
});

describe('renameItem keeps recipe ingredients in step', () => {
  it('moves ingredients sitting on the old key onto the new one', () => {
    (dbGetAllRecipes as jest.Mock).mockReturnValue([{
      id: 'r1',
      name: 'Ragu',
      nameKey: 'ragu',
      notes: '',
      sourceUrl: null,
      servings: null,
      ingredients: [
        { id: 'i1', name: 'Tomatos', nameKey: 'tomatos', quantity: '2 cans', aisle: null },
        { id: 'i2', name: 'Onions', nameKey: 'onions', quantity: '2', aisle: null },
      ],
      favorite: false,
      sortOrder: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    }]);
    useRecipeStore.getState().initialize();

    const item = makeItem({ name: 'Tomatos' });
    seed([item]);

    useGroceryStore.getState().renameItem(item.id, 'Tomatoes');

    const ingredients = useRecipeStore.getState().recipeById('r1')!.ingredients;
    expect(ingredients.map(i => i.nameKey)).toEqual(['tomatoes', 'onions']);
    // The label the recipe was written with is untouched — only the bridge moved.
    expect(ingredients[0].name).toBe('Tomatos');
    expect(dbUpdateRecipe).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when no recipe referenced the old key', () => {
    (dbGetAllRecipes as jest.Mock).mockReturnValue([]);
    useRecipeStore.getState().initialize();

    const item = makeItem({ name: 'Sourdough' });
    seed([item]);

    useGroceryStore.getState().renameItem(item.id, 'Sourdough loaf');

    expect(dbUpdateRecipe).not.toHaveBeenCalled();
  });
});

// ─── mergeItems (#1570) ─────────────────────────────────────────────────────

describe('mergeItems', () => {
  it('returns false for the same id', () => {
    const cilantro = makeItem({ name: 'Cilantro' });
    seed([cilantro]);
    expect(useGroceryStore.getState().mergeItems(cilantro.id, cilantro.id)).toBe(false);
  });

  it('returns false when either id is unknown', () => {
    const cilantro = makeItem({ name: 'Cilantro' });
    seed([cilantro]);
    expect(useGroceryStore.getState().mergeItems('missing', cilantro.id)).toBe(false);
    expect(useGroceryStore.getState().mergeItems(cilantro.id, 'missing')).toBe(false);
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });

  it('sums purchaseCount and takes the later of lastAddedAt/lastPurchasedAt', () => {
    const cilantro = makeItem({
      name: 'Cilantro', purchaseCount: 4,
      lastAddedAt: '2026-08-01T00:00:00.000Z', lastPurchasedAt: '2026-08-10T00:00:00.000Z',
    });
    const coriander = makeItem({
      name: 'Coriander', purchaseCount: 2,
      lastAddedAt: '2026-08-15T00:00:00.000Z', lastPurchasedAt: '2026-08-05T00:00:00.000Z',
    });
    seed([cilantro, coriander]);

    expect(useGroceryStore.getState().mergeItems(coriander.id, cilantro.id)).toBe(true);

    const survivor = useGroceryStore.getState().itemById(cilantro.id)!;
    expect(survivor.purchaseCount).toBe(6);
    expect(survivor.lastAddedAt).toBe('2026-08-15T00:00:00.000Z');
    expect(survivor.lastPurchasedAt).toBe('2026-08-10T00:00:00.000Z');
  });

  // A rating is the one thing on a product that can't be retyped from memory,
  // so it is exactly what a merge must not throw away. Before this, the loser's
  // products were cascaded out of SQLite by dbDeleteGroceryItem and left behind
  // in memory as orphans pointing at an item that no longer existed.
  it("carries the loser's products across, ratings and all", () => {
    const cilantro = makeItem({ name: 'Cilantro' });
    const coriander = makeItem({ name: 'Coriander' });
    seed([cilantro, coriander]);
    const own = useGroceryStore.getState().addProduct(coriander.id, { brand: 'Local', variant: null })!;
    const theirs = useGroceryStore.getState().addProduct(cilantro.id, { brand: 'Store brand', variant: null })!;
    useGroceryStore.getState().updateProduct(theirs.id, { rating: 'avoid', note: 'Wilts fast' });

    useGroceryStore.getState().mergeItems(cilantro.id, coriander.id);

    const products = useGroceryStore.getState().itemProducts;
    expect(products).toHaveLength(2);
    expect(products.every(p => p.itemId === coriander.id)).toBe(true);
    // Its id survives, which is what keeps price observations and link
    // references naming it valid.
    expect(products.find(p => p.id === theirs.id)).toMatchObject({
      brand: 'Store brand', rating: 'avoid', note: 'Wilts fast',
    });
    expect(products.find(p => p.id === own.id)).toBeDefined();
  });

  // productKey is the identity within an item, so both rows having a "store
  // brand" is one box, not two.
  it('folds two boxes with the same key into one, keeping the survivor', () => {
    const cilantro = makeItem({ name: 'Cilantro' });
    const coriander = makeItem({ name: 'Coriander' });
    seed([cilantro, coriander]);
    const survivor = useGroceryStore.getState().addProduct(coriander.id, { brand: 'Store brand', variant: null })!;
    useGroceryStore.getState().updateProduct(survivor.id, { rating: 'loved' });
    const loser = useGroceryStore.getState().addProduct(cilantro.id, { brand: 'store brand', variant: null })!;
    useGroceryStore.getState().updateProduct(loser.id, { rating: 'avoid', note: 'Wilts fast' });

    useGroceryStore.getState().mergeItems(cilantro.id, coriander.id);

    const products = useGroceryStore.getState().itemProducts;
    expect(products).toHaveLength(1);
    // The survivor's verdict stands: two ratings for one box is a disagreement
    // nothing here can settle, and the loser's only fills a silence.
    expect(products[0]).toMatchObject({ id: survivor.id, rating: 'loved', note: 'Wilts fast' });
  });

  // Pointers at a deduped id are rewritten rather than left to dangle — a claim
  // quietly ceasing to apply because of a rename is the staleness this model
  // was built to avoid.
  it('remaps store claims and observations off a deduped product', () => {
    const cilantro = makeItem({ name: 'Cilantro' });
    const coriander = makeItem({ name: 'Coriander' });
    const safeway = makeShop('Safeway');
    seed([cilantro, coriander], { shops: [safeway] });
    const survivor = useGroceryStore.getState().addProduct(coriander.id, { brand: 'Store brand', variant: null })!;
    const loser = useGroceryStore.getState().addProduct(cilantro.id, { brand: 'Store brand', variant: null })!;
    useGroceryStore.setState({
      itemShops: [{
        itemId: cilantro.id, shopId: safeway.id, purchaseCount: 0, lastPurchasedAt: null,
        unavailableAt: null, lastPriceMinor: null, lastPricedAt: null,
        lastPriceQuantity: null, priceHistory: [], productId: loser.id,
        unavailableProductIds: { [loser.id]: '2026-03-04T00:00:00.000Z' },
      }],
    });

    useGroceryStore.getState().mergeItems(cilantro.id, coriander.id);

    const [link] = useGroceryStore.getState().itemShops;
    expect(link.productId).toBe(survivor.id);
    expect(link.unavailableProductIds).toEqual({ [survivor.id]: '2026-03-04T00:00:00.000Z' });
  });

  it("adopts the loser's preference only when the survivor had none", () => {
    const cilantro = makeItem({ name: 'Cilantro' });
    const coriander = makeItem({ name: 'Coriander' });
    seed([cilantro, coriander]);
    const theirs = useGroceryStore.getState().addProduct(cilantro.id, { brand: 'Store brand', variant: null })!;

    useGroceryStore.getState().mergeItems(cilantro.id, coriander.id);

    expect(useGroceryStore.getState().itemById(coriander.id)!.preferredProductId).toBe(theirs.id);
  });

  it("keeps the surviving row's own name, preference, strictness, aisle and note", () => {
    const cilantro = makeItem({
      name: 'Cilantro', preferredProductId: 'p-store', productStrict: true,
      aisle: 'Produce', note: 'the fresh kind',
    });
    const coriander = makeItem({
      name: 'Coriander', preferredProductId: 'p-generic', productStrict: false,
      aisle: 'Herbs', note: 'imported',
    });
    seed([cilantro, coriander]);

    useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

    expect(useGroceryStore.getState().itemById(cilantro.id)).toMatchObject({
      name: 'Cilantro', preferredProductId: 'p-store', productStrict: true,
      aisle: 'Produce', note: 'the fresh kind',
    });
  });

  it('ORs isStaple', () => {
    const cilantro = makeItem({ name: 'Cilantro', isStaple: false });
    const coriander = makeItem({ name: 'Coriander', isStaple: true });
    seed([cilantro, coriander]);

    useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

    expect(useGroceryStore.getState().itemById(cilantro.id)!.isStaple).toBe(true);
  });

  it('deletes the losing row from the catalog', () => {
    const cilantro = makeItem({ name: 'Cilantro' });
    const coriander = makeItem({ name: 'Coriander' });
    seed([cilantro, coriander]);

    useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

    expect(dbDeleteGroceryItem).toHaveBeenCalledWith(coriander.id);
    const items = useGroceryStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(cilantro.id);
  });

  describe('the pantry assertion (onHandUntil)', () => {
    it('an explicit assertion beats no assertion on the other side', () => {
      const cilantro = makeItem({ name: 'Cilantro', onHandUntil: null });
      const coriander = makeItem({ name: 'Coriander', onHandUntil: '2026-09-01T00:00:00.000Z' });
      seed([cilantro, coriander]);

      useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

      expect(useGroceryStore.getState().itemById(cilantro.id)!.onHandUntil).toBe('2026-09-01T00:00:00.000Z');
    });

    it('takes the later of two assertions, so a fresher on-hand date beats a stale OUT_OF_IT_UNTIL', () => {
      const cilantro = makeItem({ name: 'Cilantro', onHandUntil: OUT_OF_IT_UNTIL });
      const coriander = makeItem({ name: 'Coriander', onHandUntil: '2020-01-01T00:00:00.000Z' });
      seed([cilantro, coriander]);

      useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

      // OUT_OF_IT_UNTIL is the epoch — the oldest possible stamp — so any
      // real date on the other side outranks it.
      expect(useGroceryStore.getState().itemById(cilantro.id)!.onHandUntil).toBe('2020-01-01T00:00:00.000Z');
    });
  });

  describe('onList and quantity', () => {
    it('ORs onList and merges quantities through mergeQuantities when both were on the list', () => {
      const cilantro = makeItem({ name: 'Cilantro', onList: true, quantity: '1 lb' });
      const coriander = makeItem({ name: 'Coriander', onList: true, quantity: '2 lb' });
      seed([cilantro, coriander]);

      useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

      const survivor = useGroceryStore.getState().itemById(cilantro.id)!;
      expect(survivor.onList).toBe(true);
      expect(survivor.quantity).toBe('3 lbs');
    });

    it("keeps the only listed side's quantity when just one side was on the list", () => {
      const cilantro = makeItem({ name: 'Cilantro', onList: false, quantity: '1 bunch' });
      const coriander = makeItem({ name: 'Coriander', onList: true, quantity: '2 bags' });
      seed([cilantro, coriander]);

      useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

      const survivor = useGroceryStore.getState().itemById(cilantro.id)!;
      expect(survivor.onList).toBe(true);
      expect(survivor.quantity).toBe('2 bags');
    });

    it('ORs checked, guarded by the merged onList', () => {
      const cilantro = makeItem({ name: 'Cilantro', onList: true, checked: false });
      const coriander = makeItem({ name: 'Coriander', onList: true, checked: true });
      seed([cilantro, coriander]);

      useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

      expect(useGroceryStore.getState().itemById(cilantro.id)!.checked).toBe(true);
    });
  });

  it('moves price fields as a group from whichever side was priced more recently, never averaged', () => {
    const cilantro = makeItem({
      name: 'Cilantro', lastPriceMinor: 199, lastPricedAt: '2026-08-01T00:00:00.000Z', lastPriceQuantity: '1 bunch', priceHistory: [],
    });
    const coriander = makeItem({
      name: 'Coriander', lastPriceMinor: 249, lastPricedAt: '2026-08-10T00:00:00.000Z', lastPriceQuantity: '2 bunch', priceHistory: [],
    });
    seed([cilantro, coriander]);

    useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

    const survivor = useGroceryStore.getState().itemById(cilantro.id)!;
    expect(survivor.lastPriceMinor).toBe(249);
    expect(survivor.lastPricedAt).toBe('2026-08-10T00:00:00.000Z');
    expect(survivor.lastPriceQuantity).toBe('2 bunch');
  });

  describe('shop links', () => {
    it('sums counts, takes the later lastPurchasedAt, and a purchase on either side clears unavailableAt', () => {
      const shop = makeShop('Costco');
      const cilantro = makeItem({ name: 'Cilantro' });
      const coriander = makeItem({ name: 'Coriander' });
      seed([cilantro, coriander], {
        shops: [shop],
        itemShops: [
          {
            itemId: cilantro.id, shopId: shop.id, purchaseCount: 3,
            lastPurchasedAt: '2026-08-01T00:00:00.000Z', unavailableAt: '2026-07-01T00:00:00.000Z',
            lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {},
          },
          {
            itemId: coriander.id, shopId: shop.id, purchaseCount: 1,
            lastPurchasedAt: '2026-08-15T00:00:00.000Z', unavailableAt: null,
            lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {},
          },
        ],
      });

      useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

      const link = useGroceryStore.getState().itemShops.find(l => l.shopId === shop.id)!;
      expect(link.itemId).toBe(cilantro.id);
      expect(link.purchaseCount).toBe(4);
      expect(link.lastPurchasedAt).toBe('2026-08-15T00:00:00.000Z');
      expect(link.unavailableAt).toBeNull();
    });

    it('takes the later unavailableAt when neither side has purchased there', () => {
      const shop = makeShop('Whole Foods');
      const cilantro = makeItem({ name: 'Cilantro' });
      const coriander = makeItem({ name: 'Coriander' });
      seed([cilantro, coriander], {
        shops: [shop],
        itemShops: [
          {
            itemId: cilantro.id, shopId: shop.id, purchaseCount: 0, lastPurchasedAt: null,
            unavailableAt: '2026-07-01T00:00:00.000Z',
            lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {},
          },
          {
            itemId: coriander.id, shopId: shop.id, purchaseCount: 0, lastPurchasedAt: null,
            unavailableAt: '2026-08-01T00:00:00.000Z',
            lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {},
          },
        ],
      });

      useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

      expect(useGroceryStore.getState().itemShops[0].unavailableAt).toBe('2026-08-01T00:00:00.000Z');
    });

    it('moves a shop link only one side has, unchanged', () => {
      const shop = makeShop("Trader Joe's");
      const cilantro = makeItem({ name: 'Cilantro' });
      const coriander = makeItem({ name: 'Coriander' });
      seed([cilantro, coriander], {
        shops: [shop],
        itemShops: [{
          itemId: coriander.id, shopId: shop.id, purchaseCount: 2,
          lastPurchasedAt: '2026-08-01T00:00:00.000Z', unavailableAt: null,
          lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {},
        }],
      });

      useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

      const links = useGroceryStore.getState().itemShops;
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ itemId: cilantro.id, shopId: shop.id, purchaseCount: 2 });
    });
  });

  describe('substitute links', () => {
    it('retargets a substitute link onto the survivor', () => {
      const cilantro = makeItem({ name: 'Cilantro' });
      const coriander = makeItem({ name: 'Coriander' });
      const parsley = makeItem({ name: 'Parsley' });
      seed([cilantro, coriander, parsley], {
        itemSubs: [{
          itemId: coriander.id, subItemId: parsley.id, note: null,
          createdAt: '2026-01-01T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: false,
        }],
      });

      useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

      const subs = useGroceryStore.getState().itemSubs;
      expect(subs).toHaveLength(1);
      expect(subs[0]).toMatchObject({ itemId: cilantro.id, subItemId: parsley.id });
    });

    it('drops a link that would end up pointing an item at itself', () => {
      const cilantro = makeItem({ name: 'Cilantro' });
      const coriander = makeItem({ name: 'Coriander' });
      seed([cilantro, coriander], {
        itemSubs: [{
          itemId: cilantro.id, subItemId: coriander.id, note: null,
          createdAt: '2026-01-01T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: false,
        }],
      });

      useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

      expect(useGroceryStore.getState().itemSubs).toEqual([]);
    });

    it('keeps the survivor’s own standing rule over one retargeted in from the loser', () => {
      // Cilantro (survivor) already always uses Basil; Coriander (loser) always
      // uses Parsley. Merging must not leave the survivor with two standing
      // rules — one item, one answer (see standingSwaps.ts).
      const cilantro = makeItem({ name: 'Cilantro' });
      const coriander = makeItem({ name: 'Coriander' });
      const basil = makeItem({ name: 'Basil' });
      const parsley = makeItem({ name: 'Parsley' });
      seed([cilantro, coriander, basil, parsley], {
        itemSubs: [
          {
            itemId: cilantro.id, subItemId: basil.id, note: null,
            createdAt: '2026-01-01T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: true,
          },
          {
            itemId: coriander.id, subItemId: parsley.id, note: null,
            createdAt: '2026-01-02T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: true,
          },
        ],
      });

      useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

      const subs = useGroceryStore.getState().itemSubs;
      expect(subs).toHaveLength(2);
      expect(subs.find(l => l.subItemId === basil.id)).toMatchObject({ itemId: cilantro.id, standing: true });
      expect(subs.find(l => l.subItemId === parsley.id)).toMatchObject({ itemId: cilantro.id, standing: false });
    });
  });

  describe('choiceGroup', () => {
    it('collapses to no choice when the merge leaves only one member', () => {
      const cilantro = makeItem({ name: 'Cilantro', onList: true, choiceGroup: 'g1' });
      const coriander = makeItem({ name: 'Coriander', onList: true, choiceGroup: 'g1' });
      seed([cilantro, coriander]);

      useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

      expect(useGroceryStore.getState().itemById(cilantro.id)!.choiceGroup).toBeNull();
    });

    it('keeps the group when another member remains', () => {
      const cilantro = makeItem({ name: 'Cilantro', onList: true, choiceGroup: 'g1' });
      const coriander = makeItem({ name: 'Coriander', onList: true, choiceGroup: 'g1' });
      const parsley = makeItem({ name: 'Parsley', onList: true, choiceGroup: 'g1' });
      seed([cilantro, coriander, parsley]);

      useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

      expect(useGroceryStore.getState().itemById(cilantro.id)!.choiceGroup).toBe('g1');
    });
  });

  it("drops the losing item's use-up task", () => {
    mockUseUpTasks = true;
    const cilantro = makeItem({ name: 'Cilantro' });
    const coriander = makeItem({ name: 'Coriander' });
    seed([cilantro, coriander]);
    useGroceryStore.getState().setExpiresAt(coriander.id, '2026-08-20');
    expect(useUpTaskFor(coriander.id)).toBeDefined();

    useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

    expect(useUpTaskFor(coriander.id)).toBeUndefined();
  });
});

describe('mergeItems keeps recipe ingredients and remembered aisles in step', () => {
  it('remaps recipe ingredients from the losing key onto the surviving one', () => {
    (dbGetAllRecipes as jest.Mock).mockReturnValue([{
      id: 'r1', name: 'Salsa', nameKey: 'salsa', notes: '', sourceUrl: null, servings: null,
      ingredients: [
        { id: 'i1', name: 'Coriander', nameKey: 'coriander', quantity: '1 bunch', aisle: null },
      ],
      favorite: false, sortOrder: 1, createdAt: '2026-01-01T00:00:00.000Z',
    }]);
    useRecipeStore.getState().initialize();

    const cilantro = makeItem({ name: 'Cilantro' });
    const coriander = makeItem({ name: 'Coriander' });
    seed([cilantro, coriander]);

    useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

    const ingredients = useRecipeStore.getState().recipeById('r1')!.ingredients;
    expect(ingredients[0].nameKey).toBe('cilantro');
    // The recipe's own wording is untouched — only the catalog bridge moved.
    expect(ingredients[0].name).toBe('Coriander');
  });

  it('carries a remembered aisle filing from the losing key onto the surviving one', () => {
    const cilantro = makeItem({ name: 'Cilantro' });
    const coriander = makeItem({ name: 'Coriander' });
    seed([cilantro, coriander], { aisleOverrides: { coriander: 'Herbs & Spices' } });

    useGroceryStore.getState().mergeItems(coriander.id, cilantro.id);

    const overrides = useGroceryStore.getState().aisleOverrides;
    expect(overrides.cilantro).toBe('Herbs & Spices');
    expect(overrides.coriander).toBeUndefined();
  });
});

describe('addProduct', () => {
  it('files a box under the item and leaves the name key alone', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    seed([cc]);

    const product = useGroceryStore.getState().addProduct(cc.id, {
      brand: 'Good Culture', variant: 'low fat',
    });

    expect(product).toMatchObject({ itemId: cc.id, brand: 'Good Culture', variant: 'low fat' });
    expect(useGroceryStore.getState().items[0].nameKey).toBe(cc.nameKey);
    expect(dbSetItemProduct).toHaveBeenCalledWith(expect.objectContaining({ id: product!.id }));
  });

  it('trims what the user typed, and takes either half alone', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    seed([cc]);

    const branded = useGroceryStore.getState().addProduct(cc.id, { brand: '  Good Culture ', variant: null });
    expect(branded).toMatchObject({ brand: 'Good Culture', variant: null });

    const varianted = useGroceryStore.getState().addProduct(cc.id, { brand: null, variant: 'low fat' });
    expect(varianted).toMatchObject({ brand: null, variant: 'low fat' });
  });

  // A product with neither half is the item itself. Refused rather than stored
  // as a blank row that captions nothing.
  it('refuses a product that names nothing', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    seed([cc]);

    expect(useGroceryStore.getState().addProduct(cc.id, { brand: '  ', variant: null })).toBeNull();
    expect(useGroceryStore.getState().itemProducts).toEqual([]);
  });

  // The first one is plainly the answer to "which one?"; a second is a box
  // you're recording, not a decision. Promoting every new one would mean the
  // list you build to compare products re-decides for you as you build it.
  it('prefers the first product and leaves the preference alone after that', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    seed([cc]);

    const first = useGroceryStore.getState().addProduct(cc.id, { brand: 'Good Culture', variant: null });
    expect(useGroceryStore.getState().items[0].preferredProductId).toBe(first!.id);

    useGroceryStore.getState().addProduct(cc.id, { brand: "Nancy's", variant: null });
    expect(useGroceryStore.getState().items[0].preferredProductId).toBe(first!.id);
  });

  it('matches an existing box rather than minting a second, whatever the casing', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    seed([cc]);

    const first = useGroceryStore.getState().addProduct(cc.id, { brand: 'Good Culture', variant: 'low fat' });
    const again = useGroceryStore.getState().addProduct(cc.id, { brand: 'good culture', variant: 'LOW FAT' });

    expect(again!.id).toBe(first!.id);
    expect(useGroceryStore.getState().itemProducts).toHaveLength(1);
  });

  it('shrugs off an id that no longer resolves', () => {
    seed([makeItem({ name: 'Milk' })]);

    expect(() => useGroceryStore.getState().addProduct('gone', { brand: 'Oatly', variant: null }))
      .not.toThrow();
    expect(useGroceryStore.getState().itemProducts).toEqual([]);
  });
});

describe('updateProduct', () => {
  it('edits the words, the note and the rating, re-keying as it goes', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    seed([cc]);
    const product = useGroceryStore.getState().addProduct(cc.id, { brand: 'Good Culture', variant: 'low fat' })!;

    expect(useGroceryStore.getState().updateProduct(product.id, {
      variant: '4%', note: 'the tall tub', rating: 'loved',
    })).toBe(true);

    const [saved] = useGroceryStore.getState().itemProducts;
    expect(saved).toMatchObject({ variant: '4%', note: 'the tall tub', rating: 'loved' });
    expect(saved.productKey).toBe('good culture|4%');
  });

  // Two boxes can't be the same box, and silently merging them would throw one
  // of their ratings and purchase counts away. The sheet says so instead.
  it('refuses an edit that would collide with another product of the item', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    seed([cc]);
    useGroceryStore.getState().addProduct(cc.id, { brand: 'Good Culture', variant: 'low fat' });
    const second = useGroceryStore.getState().addProduct(cc.id, { brand: 'Good Culture', variant: '4%' })!;

    expect(useGroceryStore.getState().updateProduct(second.id, { variant: 'low fat' })).toBe(false);
    expect(useGroceryStore.getState().itemProducts.find(p => p.id === second.id)!.variant).toBe('4%');
  });

  it('refuses an edit that empties both halves', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    seed([cc]);
    const product = useGroceryStore.getState().addProduct(cc.id, { brand: 'Good Culture', variant: null })!;

    expect(useGroceryStore.getState().updateProduct(product.id, { brand: '  ' })).toBe(false);
  });

  // An unlisted key is "leave it alone", not "clear it" — the same contract
  // every patch-shaped setter here has.
  it('leaves an unmentioned field untouched', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    seed([cc]);
    const product = useGroceryStore.getState().addProduct(cc.id, {
      brand: 'Good Culture', variant: 'low fat', note: 'the tall tub', rating: 'loved',
    })!;

    useGroceryStore.getState().updateProduct(product.id, { variant: '4%' });

    expect(useGroceryStore.getState().itemProducts[0]).toMatchObject({
      note: 'the tall tub', rating: 'loved',
    });
  });
});

describe('setPreferredProduct', () => {
  it('switches which box the item is asking for, and clears back to none', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    seed([cc]);
    useGroceryStore.getState().addProduct(cc.id, { brand: 'Good Culture', variant: null });
    const second = useGroceryStore.getState().addProduct(cc.id, { brand: "Nancy's", variant: null })!;

    useGroceryStore.getState().setPreferredProduct(cc.id, second.id);
    expect(useGroceryStore.getState().items[0].preferredProductId).toBe(second.id);

    useGroceryStore.getState().setPreferredProduct(cc.id, null);
    expect(useGroceryStore.getState().items[0].preferredProductId).toBeNull();
  });

  // A stale id from a sheet rendered against an older state must not file
  // Bread under a milk product.
  it('refuses a product belonging to another item', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    const milk = makeItem({ name: 'Milk' });
    seed([cc, milk]);
    const oatly = useGroceryStore.getState().addProduct(milk.id, { brand: 'Oatly', variant: null })!;

    useGroceryStore.getState().setPreferredProduct(cc.id, oatly.id);

    expect(useGroceryStore.getState().itemById(cc.id)!.preferredProductId).toBeNull();
  });

  it('sets the preference without otherwise touching the row', () => {
    const cc = makeItem({ name: 'Cottage cheese', onList: true });
    seed([cc]);
    const product = useGroceryStore.getState().addProduct(cc.id, { brand: 'Good Culture', variant: null })!;
    useGroceryStore.setState({
      items: useGroceryStore.getState().items.map(i => ({ ...i, preferredProductId: null })),
    });

    useGroceryStore.getState().setPreferredProduct(cc.id, product.id);
    expect(useGroceryStore.getState().items[0].preferredProductId).toBe(product.id);
    expect(useGroceryStore.getState().items[0].onList).toBe(true);
  });
});

describe('deleteProduct', () => {
  // Every pointer at it goes too, in memory as well as in SQLite — the store
  // patches rather than reloading, so the two have to agree.
  it('takes the preference, the observation and the claims with it', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    const safeway = makeShop('Safeway');
    seed([cc], { shops: [safeway] });
    const product = useGroceryStore.getState().addProduct(cc.id, { brand: 'Good Culture', variant: null })!;
    useGroceryStore.setState({
      itemShops: [{
        itemId: cc.id, shopId: safeway.id, purchaseCount: 2, lastPurchasedAt: null,
        unavailableAt: null, lastPriceMinor: null, lastPricedAt: null,
        lastPriceQuantity: null, priceHistory: [], productId: product.id,
        unavailableProductIds: { [product.id]: '2026-03-04T00:00:00.000Z', other: '2026-03-05T00:00:00.000Z' },
      }],
    });

    useGroceryStore.getState().deleteProduct(product.id);

    expect(useGroceryStore.getState().itemProducts).toEqual([]);
    expect(useGroceryStore.getState().items[0].preferredProductId).toBeNull();
    const [link] = useGroceryStore.getState().itemShops;
    expect(link.productId).toBeNull();
    // Only the deleted box's claim: another one's is a fact about a different
    // product and nothing has happened to it.
    expect(link.unavailableProductIds).toEqual({ other: '2026-03-05T00:00:00.000Z' });
  });

  it('shrugs off an id it does not hold', () => {
    seed([makeItem({ name: 'Milk' })]);
    expect(() => useGroceryStore.getState().deleteProduct('gone')).not.toThrow();
    expect(dbDeleteItemProduct).not.toHaveBeenCalled();
  });
});

describe('setProductStrict', () => {
  it('writes the flag and persists it', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    seed([cc]);

    useGroceryStore.getState().setProductStrict(cc.id, true);

    expect(useGroceryStore.getState().items[0].productStrict).toBe(true);
    expect(dbUpdateGroceryItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: cc.id, productStrict: true })
    );
  });

  it('switches back off again', () => {
    const cc = makeItem({ name: 'Cottage cheese', productStrict: true });
    seed([cc]);

    useGroceryStore.getState().setProductStrict(cc.id, false);

    expect(useGroceryStore.getState().items[0].productStrict).toBe(false);
  });
});

describe('setProductUnavailable', () => {
  function withPreference() {
    const cc = makeItem({ name: 'Cottage cheese', productStrict: true });
    const safeway = makeShop('Safeway');
    seed([cc], { shops: [safeway] });
    const product = useGroceryStore.getState().addProduct(cc.id, { brand: 'Good Culture', variant: null })!;
    return { cc, safeway, product };
  }

  it('creates the link when there is none — the claim is about a store that has it', () => {
    const { cc, safeway, product } = withPreference();

    useGroceryStore.getState().setProductUnavailable(cc.id, safeway.id, true);

    const [linkRow] = useGroceryStore.getState().itemShops;
    expect(linkRow).toMatchObject({ itemId: cc.id, shopId: safeway.id, purchaseCount: 0 });
    expect(linkRow.unavailableProductIds[product.id]).toBeDefined();
    // Not the item-level negative — this store has the item.
    expect(linkRow.unavailableAt).toBeNull();
  });

  // The whole reason the claims are a map keyed by product: a store can be
  // missing two of an item's boxes at once, and one claim must not overwrite
  // the other.
  it('keeps a claim about another product of the same item', () => {
    const { cc, safeway, product } = withPreference();
    useGroceryStore.setState({
      itemShops: [{
        itemId: cc.id, shopId: safeway.id, purchaseCount: 0, lastPurchasedAt: null,
        unavailableAt: null, lastPriceMinor: null, lastPricedAt: null,
        lastPriceQuantity: null, priceHistory: [], productId: null,
        unavailableProductIds: { other: '2026-03-05T00:00:00.000Z' },
      }],
    });

    useGroceryStore.getState().setProductUnavailable(cc.id, safeway.id, true);

    expect(Object.keys(useGroceryStore.getState().itemShops[0].unavailableProductIds).sort())
      .toEqual(['other', product.id].sort());
  });

  it('marks an existing link without touching its history', () => {
    const { cc, safeway, product } = withPreference();
    useGroceryStore.setState({
      itemShops: [{
        itemId: cc.id, shopId: safeway.id, purchaseCount: 6,
        lastPurchasedAt: '2026-01-01T00:00:00.000Z', unavailableAt: null,
        lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [],
        productId: 'p-lucerne', unavailableProductIds: {},
      }],
    });

    useGroceryStore.getState().setProductUnavailable(cc.id, safeway.id, true);

    expect(useGroceryStore.getState().itemShops[0]).toMatchObject({
      purchaseCount: 6, lastPurchasedAt: '2026-01-01T00:00:00.000Z', productId: 'p-lucerne',
    });
    expect(useGroceryStore.getState().itemShops[0].unavailableProductIds[product.id]).toBeDefined();
  });

  // Taking it back must not leave a bare purchaseCount-0 row behind: that row
  // asserts "I get this here", a different and stronger claim than the one
  // being withdrawn. Same call clearItemUnavailable makes.
  it('removes a link that was only ever the claim', () => {
    const { cc, safeway } = withPreference();
    useGroceryStore.getState().setProductUnavailable(cc.id, safeway.id, true);

    useGroceryStore.getState().setProductUnavailable(cc.id, safeway.id, false);

    expect(useGroceryStore.getState().itemShops).toEqual([]);
  });

  it('keeps a link that carries purchases when the claim is withdrawn', () => {
    const { cc, safeway, product } = withPreference();
    useGroceryStore.setState({
      itemShops: [{
        itemId: cc.id, shopId: safeway.id, purchaseCount: 3, lastPurchasedAt: null,
        unavailableAt: null, lastPriceMinor: null, lastPricedAt: null,
        lastPriceQuantity: null, priceHistory: [], productId: null,
        unavailableProductIds: { [product.id]: '2026-03-04T00:00:00.000Z' },
      }],
    });

    useGroceryStore.getState().setProductUnavailable(cc.id, safeway.id, false);

    expect(useGroceryStore.getState().itemShops[0]).toMatchObject({ purchaseCount: 3 });
    expect(useGroceryStore.getState().itemShops[0].unavailableProductIds).toEqual({});
  });

  // "They haven't got the one I want" needs a one you want.
  it('does nothing on an item with no preference', () => {
    const cc = makeItem({ name: 'Cottage cheese' });
    const safeway = makeShop('Safeway');
    seed([cc], { shops: [safeway] });

    useGroceryStore.getState().setProductUnavailable(cc.id, safeway.id, true);

    expect(useGroceryStore.getState().itemShops).toEqual([]);
  });

  it('shrugs off an unknown item or shop', () => {
    const { cc } = withPreference();

    expect(() => useGroceryStore.getState().setProductUnavailable(cc.id, 'gone', true)).not.toThrow();
    expect(useGroceryStore.getState().itemShops).toEqual([]);
  });
});

describe('setOnHandUntil', () => {
  it('writes the given value and persists it', () => {
    const milk = makeItem({ name: 'Milk' });
    seed([milk]);

    useGroceryStore.getState().setOnHandUntil(milk.id, '2026-08-21T00:00:00.000Z');

    expect(useGroceryStore.getState().items[0].onHandUntil).toBe('2026-08-21T00:00:00.000Z');
    expect(dbUpdateGroceryItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: milk.id, onHandUntil: '2026-08-21T00:00:00.000Z' })
    );
  });

  it('clears back to null — the pantry guess deciding again', () => {
    const milk = makeItem({ name: 'Milk', onHandUntil: '2026-08-21T00:00:00.000Z' });
    seed([milk]);

    useGroceryStore.getState().setOnHandUntil(milk.id, null);

    expect(useGroceryStore.getState().items[0].onHandUntil).toBeNull();
  });

  it('shrugs at an id it does not hold', () => {
    seed([]);
    useGroceryStore.getState().setOnHandUntil('gone', '2026-08-21T00:00:00.000Z');
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });
});

describe('markOutOfMany', () => {
  it('writes the same assertion the item sheet writes, to every row named', () => {
    const soy = makeItem({ name: 'Soy sauce', onHandUntil: '2026-08-21T00:00:00.000Z' });
    const cumin = makeItem({ name: 'Cumin' });
    seed([soy, cumin]);

    expect(useGroceryStore.getState().markOutOfMany([soy.id, cumin.id])).toBe(2);

    for (const item of useGroceryStore.getState().items) {
      expect(item.onHandUntil).toBe(OUT_OF_IT_UNTIL);
      // Which is the whole point: the pantry stops claiming them.
      expect(probablyHaveReason(item, new Date())).toBeNull();
    }
  });

  it('touches nothing else about a row', () => {
    const soy = makeItem({ name: 'Soy sauce', onList: true, checked: true, purchaseCount: 6 });
    seed([soy]);

    useGroceryStore.getState().markOutOfMany([soy.id]);

    const after = useGroceryStore.getState().items[0];
    expect(after).toEqual({ ...soy, onHandUntil: OUT_OF_IT_UNTIL });
  });

  it('is one undo for the whole cook, not one per row', () => {
    const soy = makeItem({ name: 'Soy sauce', onHandUntil: '2026-08-21T00:00:00.000Z' });
    const cumin = makeItem({ name: 'Cumin' });
    seed([soy, cumin]);

    useGroceryStore.getState().markOutOfMany([soy.id, cumin.id]);
    useGroceryStore.getState().undoLastAction();

    // Each row back to what it carried before, rather than to a shared null —
    // one of these had an assertion of its own and is owed it back.
    const byId = new Map(useGroceryStore.getState().items.map(i => [i.id, i]));
    expect(byId.get(soy.id)!.onHandUntil).toBe('2026-08-21T00:00:00.000Z');
    expect(byId.get(cumin.id)!.onHandUntil).toBeNull();
  });

  it('skips rows already marked out, and registers no undo when nothing changed', () => {
    const soy = makeItem({ name: 'Soy sauce', onHandUntil: OUT_OF_IT_UNTIL });
    seed([soy]);
    useGroceryStore.setState({ lastAction: null });

    expect(useGroceryStore.getState().markOutOfMany([soy.id])).toBe(0);
    expect(useGroceryStore.getState().lastAction).toBeNull();
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });

  it('shrugs at ids it does not hold', () => {
    seed([]);
    expect(useGroceryStore.getState().markOutOfMany(['gone'])).toBe(0);
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });

  it('asks how one row went, and asks nothing about a batch', () => {
    const soy = makeItem({ name: 'Soy sauce' });
    const cumin = makeItem({ name: 'Cumin' });
    seed([soy, cumin]);

    useGroceryStore.getState().markOutOfMany([soy.id]);
    expect(useGroceryStore.getState().disposalOffer).toEqual({ itemId: soy.id, stage: 'ask' });

    // A batch is the "recall five kitchens" case: one ✕ is a question, several
    // at once is a form. Counted on rows that actually changed, not on ids
    // passed — soy is already out by now, so it takes a third row to make two.
    const salt = makeItem({ name: 'Salt' });
    seed([soy, cumin, salt]);
    useGroceryStore.getState().markOutOfMany([cumin.id, salt.id]);
    expect(useGroceryStore.getState().disposalOffer).toBeNull();
  });

  it('records the outcome the caller already knows, and asks nothing', () => {
    const soy = makeItem({ name: 'Soy sauce' });
    seed([soy]);

    // What CookedUseUpSheet passes: the cooking is the answer.
    useGroceryStore.getState().markOutOfMany([soy.id], 'usedUp');

    const after = useGroceryStore.getState().items[0];
    expect(after.usedUpCount).toBe(1);
    expect(after.spoiledCount).toBe(0);
    expect(useGroceryStore.getState().disposalOffer).toBeNull();
  });

  it('takes the question back with the undo', () => {
    // Undoing the ✕ is the answer "it didn't leave", so a question about how it
    // went would be asking about a thing that is still there.
    const soy = makeItem({ name: 'Soy sauce' });
    seed([soy]);

    useGroceryStore.getState().markOutOfMany([soy.id]);
    useGroceryStore.getState().undoLastAction();

    expect(useGroceryStore.getState().disposalOffer).toBeNull();
    expect(useGroceryStore.getState().items[0].usedUpCount).toBe(0);
  });
});

describe('recordDisposal', () => {
  it('counts each side and stamps only the spoiled one', () => {
    const soy = makeItem({ name: 'Soy sauce' });
    seed([soy]);

    useGroceryStore.getState().recordDisposal(soy.id, 'usedUp');
    let after = useGroceryStore.getState().items[0];
    expect(after.usedUpCount).toBe(1);
    // "Used it up" is the ordinary outcome and its age says nothing anyone
    // would read — see GroceryItem.lastSpoiledAt.
    expect(after.lastSpoiledAt).toBeNull();

    useGroceryStore.getState().recordDisposal(soy.id, 'spoiled');
    after = useGroceryStore.getState().items[0];
    expect(after.usedUpCount).toBe(1);
    expect(after.spoiledCount).toBe(1);
    expect(after.lastSpoiledAt).not.toBeNull();
  });

  it('leaves the pantry assertion alone', () => {
    // The row is already marked out by the time this is called. An answer is
    // the extra, so an unanswered question leaves the pantry as correct as the
    // ✕ made it.
    const soy = makeItem({ name: 'Soy sauce', onHandUntil: OUT_OF_IT_UNTIL, purchaseCount: 6 });
    seed([soy]);

    useGroceryStore.getState().recordDisposal(soy.id, 'spoiled');

    const after = useGroceryStore.getState().items[0];
    expect(after.onHandUntil).toBe(OUT_OF_IT_UNTIL);
    expect(after.purchaseCount).toBe(6);
  });

  it('closes the question on an answer that is not a repeat waste', () => {
    const soy = makeItem({ name: 'Soy sauce' });
    seed([soy]);
    useGroceryStore.getState().markOutOfMany([soy.id]);

    useGroceryStore.getState().recordDisposal(soy.id, 'usedUp');
    expect(useGroceryStore.getState().disposalOffer).toBeNull();
  });

  it('turns the second waste into the shelf-life offer', () => {
    const soy = makeItem({ name: 'Soy sauce', spoiledCount: 1 });
    seed([soy]);
    useGroceryStore.getState().markOutOfMany([soy.id]);

    useGroceryStore.getState().recordDisposal(soy.id, 'spoiled');

    expect(useGroceryStore.getState().disposalOffer).toEqual({ itemId: soy.id, stage: 'shelfLife' });
    // And it stays evidence, never arithmetic: nothing here touches the day.
    const after = useGroceryStore.getState().items[0];
    expect(after.shelfLifeDays).toBeNull();
    expect(after.expiresAt).toBeNull();
  });

  it('shrugs at an id it does not hold, and clears the question with it', () => {
    seed([]);
    useGroceryStore.setState({ disposalOffer: { itemId: 'gone', stage: 'ask' } });

    useGroceryStore.getState().recordDisposal('gone', 'spoiled');

    expect(useGroceryStore.getState().disposalOffer).toBeNull();
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });
});

describe('addToPantry', () => {
  it('creates an off-list catalog row marked on hand', () => {
    seed([]);

    const added = useGroceryStore.getState().addToPantry('Flour');

    expect(added).not.toBeNull();
    expect(added!.name).toBe('Flour');
    expect(added!.onList).toBe(false);
    expect(added!.lastAddedAt).toBeNull();
    expect(new Date(added!.onHandUntil!).getTime()).toBeGreaterThan(Date.now());
    expect(dbInsertGroceryItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: added!.id, onList: false })
    );
    // Which is exactly the set the pantry sheet lists.
    expect(probablyHaveReason(useGroceryStore.getState().items[0], new Date())).toBe(
      'marked as on hand'
    );
  });

  it('files the new row by the aisle lexicon, like any other new name', () => {
    seed([]);

    const added = useGroceryStore.getState().addToPantry('spinach');

    expect(added!.aisle).toBe('Produce');
  });

  it('stamps a name already in the catalog instead of inserting a second row', () => {
    const milk = makeItem({ name: 'Milk', purchaseCount: 4 });
    seed([milk]);

    const added = useGroceryStore.getState().addToPantry('milk');

    expect(useGroceryStore.getState().items).toHaveLength(1);
    expect(added!.id).toBe(milk.id);
    expect(new Date(added!.onHandUntil!).getTime()).toBeGreaterThan(Date.now());
    expect(dbInsertGroceryItem).not.toHaveBeenCalled();
  });

  it('leaves a row on the list on it — having something is not a plan to buy it', () => {
    const eggs = makeItem({ name: 'Eggs', onList: true, sortOrder: 3 });
    seed([eggs]);

    useGroceryStore.getState().addToPantry('Eggs');

    const updated = useGroceryStore.getState().items[0];
    expect(updated.onList).toBe(true);
    expect(updated.sortOrder).toBe(3);
  });

  // An on-hand claim is a user fact, so the row it lands on survives the sweep
  // an abandoned trip runs — see hasUserFacts.
  it('leaves a claim that outlives a cleared list', () => {
    const tahini = makeItem({ name: 'Tahini', onList: true });
    seed([tahini]);

    useGroceryStore.getState().addToPantry('Tahini');
    (dbClearGroceryList as jest.Mock).mockReturnValue([tahini.id]);
    useGroceryStore.getState().clearList();

    expect(useGroceryStore.getState().items).toHaveLength(1);
    expect(useGroceryStore.getState().items[0].onHandUntil).not.toBeNull();
  });

  it('takes back an "Out of it" marking', () => {
    const rice = makeItem({ name: 'Rice', onHandUntil: OUT_OF_IT_UNTIL });
    seed([rice]);

    useGroceryStore.getState().addToPantry('Rice');

    expect(probablyHaveReason(useGroceryStore.getState().items[0], new Date())).toBe(
      'marked as on hand'
    );
  });

  it('strips a quantity rather than minting a row no purchase can match', () => {
    seed([]);

    const added = useGroceryStore.getState().addToPantry('2 lb flour');

    expect(added!.name).toBe('flour');
    expect(added!.nameKey).toBe(groceryNameKey('flour'));
    // How much you have is the inventory this feature exists not to be.
    expect(added!.quantity).toBeNull();
  });

  it('refuses a name with nothing in it', () => {
    seed([]);

    expect(useGroceryStore.getState().addToPantry('   ')).toBeNull();
    expect(useGroceryStore.getState().items).toHaveLength(0);
    expect(dbInsertGroceryItem).not.toHaveBeenCalled();
  });

  it('undoes a fresh row by deleting it', () => {
    seed([]);

    useGroceryStore.getState().addToPantry('Flour');
    useGroceryStore.getState().lastAction!.undo();

    expect(useGroceryStore.getState().items).toHaveLength(0);
  });

  it('undoes a stamped row back to exactly what it was', () => {
    const milk = makeItem({ name: 'Milk', onHandUntil: null, onList: true });
    seed([milk]);

    useGroceryStore.getState().addToPantry('Milk');
    useGroceryStore.getState().lastAction!.undo();

    expect(useGroceryStore.getState().items[0]).toEqual(milk);
  });
});

describe('addManyToPantry', () => {
  it('adds a name per entry, mixing new rows and stamped ones', () => {
    const milk = makeItem({ name: 'Milk' });
    seed([milk]);

    const count = useGroceryStore.getState().addManyToPantry(['milk', 'Flour', 'Eggs']);

    expect(count).toBe(3);
    // The typed name wins on the stamped row, as addToPantry documents.
    expect(useGroceryStore.getState().items.map(i => i.name).sort()).toEqual(
      ['Eggs', 'Flour', 'milk'].sort()
    );
  });

  it('skips a name with nothing usable and only counts what landed', () => {
    seed([]);

    const count = useGroceryStore.getState().addManyToPantry(['Flour', '   ', 'Eggs']);

    expect(count).toBe(2);
    expect(useGroceryStore.getState().items).toHaveLength(2);
  });

  it('registers no undo when nothing in the batch produced a row', () => {
    seed([]);
    useGroceryStore.setState({ lastAction: null });

    useGroceryStore.getState().addManyToPantry(['   ', '']);

    expect(useGroceryStore.getState().lastAction).toBeNull();
  });

  it('registers one combined undo rather than addToPantry’s per-call one', () => {
    seed([]);

    useGroceryStore.getState().addManyToPantry(['Flour', 'Eggs']);

    expect(useGroceryStore.getState().lastAction?.label).toBe('2 items added to the pantry');
  });

  it('undoes the whole session: deletes fresh rows, restores stamped ones', () => {
    const milk = makeItem({ name: 'Milk', onHandUntil: null, onList: true });
    seed([milk]);

    useGroceryStore.getState().addManyToPantry(['milk', 'Flour']);
    useGroceryStore.getState().undoLastAction();

    const items = useGroceryStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(milk);
  });

  it('freezes only the names passed in frozenNames, matched exactly', () => {
    seed([]);

    useGroceryStore.getState().addManyToPantry(['Peas', 'Flour'], new Set(['Peas']));

    const byName = Object.fromEntries(
      useGroceryStore.getState().items.map(i => [i.name, i])
    );
    expect(byName.Peas.frozenAt).not.toBeNull();
    expect(byName.Flour.frozenAt).toBeNull();
  });

  it('undoing a session that froze a fresh row deletes it, freeze included', () => {
    seed([]);

    useGroceryStore.getState().addManyToPantry(['Peas'], new Set(['Peas']));
    useGroceryStore.getState().undoLastAction();

    expect(useGroceryStore.getState().items).toHaveLength(0);
  });

  it('undoing a session that froze an already-stamped row restores it unfrozen', () => {
    const peas = makeItem({ name: 'Peas', onHandUntil: null, onList: true });
    seed([peas]);

    useGroceryStore.getState().addManyToPantry(['Peas'], new Set(['Peas']));
    expect(useGroceryStore.getState().items[0].frozenAt).not.toBeNull();

    useGroceryStore.getState().undoLastAction();

    const items = useGroceryStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(peas);
  });

  // What a barcode scan hands the pantry: the box, matched back by the same
  // raw name frozenNames already keys on. See BarcodeScanSheet/ScanProductDraft.
  it('records a scanned box and shows it, matched by name', () => {
    seed([]);

    useGroceryStore.getState().addManyToPantry(
      ['Bread'],
      undefined,
      new Map([['Bread', { brand: "Dave's Killer", variant: '21 grains' }]])
    );

    const bread = useGroceryStore.getState().items.find(i => i.name === 'Bread')!;
    expect(useGroceryStore.getState().itemProducts).toHaveLength(1);
    const [product] = useGroceryStore.getState().itemProducts;
    expect(product).toMatchObject({ brand: "Dave's Killer", variant: '21 grains' });
    expect(bread.preferredProductId).toBe(product.id);
  });

  it('never overrides a box the item already has a preference for', () => {
    const bread = makeItem({ name: 'Bread' });
    seed([bread]);
    const chosen = useGroceryStore.getState().addProduct(bread.id, { brand: "Arnold's", variant: null })!;

    useGroceryStore.getState().addManyToPantry(
      ['Bread'],
      undefined,
      new Map([['Bread', { brand: "Dave's Killer", variant: null }]])
    );

    expect(useGroceryStore.getState().itemProducts).toHaveLength(2);
    expect(useGroceryStore.getState().itemById(bread.id)!.preferredProductId).toBe(chosen.id);
  });

  // The source's own category, same map as the box — see BarcodeScanSheet's
  // aisle read and GroceryScreen.handleScanApply's own restraint. Named so the
  // offline lexicon can't already guess it, unlike "Chips" (-> Snacks): this
  // has to prove the scanned aisle landed, not that aisleForName agrees with it.
  it('files a newly minted row under the scanned aisle', () => {
    seed([]);

    useGroceryStore.getState().addManyToPantry(
      ['Qorvexx Puffs'],
      undefined,
      new Map([['Qorvexx Puffs', { brand: null, variant: null, aisle: 'Snacks' }]])
    );

    expect(useGroceryStore.getState().items.find(i => i.name === 'Qorvexx Puffs')!.aisle).toBe('Snacks');
  });

  it('never moves a row it merely found to the scanned aisle', () => {
    const chips = makeItem({ name: 'Chips', aisle: 'Pantry' });
    seed([chips]);

    useGroceryStore.getState().addManyToPantry(
      ['Chips'],
      undefined,
      new Map([['Chips', { brand: null, variant: null, aisle: 'Snacks' }]])
    );

    expect(useGroceryStore.getState().itemById(chips.id)!.aisle).toBe('Pantry');
  });

  it('lets a remembered correction for the name outrank the scanned aisle', () => {
    seed([], { aisleOverrides: { chips: 'Household' } });

    useGroceryStore.getState().addManyToPantry(
      ['Chips'],
      undefined,
      new Map([['Chips', { brand: null, variant: null, aisle: 'Snacks' }]])
    );

    expect(useGroceryStore.getState().items.find(i => i.name === 'Chips')!.aisle).toBe('Household');
  });

  // What a receipt read on the Pantry screen hands over, keyed by the same raw
  // name the box and the freezer flag already are. See KitchenScreen's
  // handleReceiptApply.
  it('records a price per name, on a row it minted as readily as one it stamped', () => {
    const flour = makeItem({ name: 'Flour' });
    seed([flour]);

    useGroceryStore.getState().addManyToPantry(
      ['Flour', 'Eggs'],
      undefined,
      undefined,
      { byName: new Map([['Flour', 449], ['Eggs', 699]]), shopId: null }
    );

    const byName = Object.fromEntries(useGroceryStore.getState().items.map(i => [i.name, i]));
    expect(byName.Flour.lastPriceMinor).toBe(449);
    expect(byName.Eggs.lastPriceMinor).toBe(699);
  });

  it('leaves a name the receipt put no price against alone', () => {
    const flour = makeItem({ name: 'Flour', lastPriceMinor: 399 });
    seed([flour]);

    useGroceryStore.getState().addManyToPantry(
      ['Flour'],
      undefined,
      undefined,
      { byName: new Map(), shopId: null }
    );

    expect(useGroceryStore.getState().items[0].lastPriceMinor).toBe(399);
  });

  it('puts the price on the named store’s link too, when there is one', () => {
    const costco = makeShop('Costco');
    const flour = makeItem({ name: 'Flour' });
    seed([flour], {
      shops: [costco],
      itemShops: [
        { itemId: flour.id, shopId: costco.id, purchaseCount: 2, lastPurchasedAt: null, unavailableAt: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [], productId: null, unavailableProductIds: {} },
      ],
    });

    useGroceryStore.getState().addManyToPantry(
      ['Flour'],
      undefined,
      undefined,
      { byName: new Map([['Flour', 449]]), shopId: costco.id }
    );

    expect(useGroceryStore.getState().itemShops[0].lastPriceMinor).toBe(449);
    // Recording a price is not a purchase — this isn't a trip, so nothing
    // about how often it's been bought here changes.
    expect(useGroceryStore.getState().itemShops[0].purchaseCount).toBe(2);
  });

  it('mints no store link for a price at a store the item has never had one at', () => {
    const costco = makeShop('Costco');
    const flour = makeItem({ name: 'Flour' });
    seed([flour], { shops: [costco] });

    useGroceryStore.getState().addManyToPantry(
      ['Flour'],
      undefined,
      undefined,
      { byName: new Map([['Flour', 449]]), shopId: costco.id }
    );

    // A price is not a claim that the store stocks it — same rule setItemPrice
    // follows everywhere else. The item's own price still lands.
    expect(useGroceryStore.getState().itemShops).toHaveLength(0);
    expect(useGroceryStore.getState().items[0].lastPriceMinor).toBe(449);
  });

  it('undoing a session that priced an already-stamped row restores its old price', () => {
    const flour = makeItem({
      name: 'Flour', onHandUntil: null, onList: true, lastPriceMinor: 399,
    });
    seed([flour]);

    useGroceryStore.getState().addManyToPantry(
      ['Flour'],
      undefined,
      undefined,
      { byName: new Map([['Flour', 449]]), shopId: null }
    );
    expect(useGroceryStore.getState().items[0].lastPriceMinor).toBe(449);

    useGroceryStore.getState().undoLastAction();

    expect(useGroceryStore.getState().items).toEqual([flour]);
  });
});

describe('setStaple', () => {
  it('writes the given value and persists it', () => {
    const salt = makeItem({ name: 'Salt' });
    seed([salt]);

    useGroceryStore.getState().setStaple(salt.id, true);

    expect(useGroceryStore.getState().items[0].isStaple).toBe(true);
    expect(dbUpdateGroceryItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: salt.id, isStaple: true })
    );
  });

  it('clears back to false', () => {
    const salt = makeItem({ name: 'Salt', isStaple: true });
    seed([salt]);

    useGroceryStore.getState().setStaple(salt.id, false);

    expect(useGroceryStore.getState().items[0].isStaple).toBe(false);
  });

  it('shrugs at an id it does not hold', () => {
    seed([]);
    useGroceryStore.getState().setStaple('gone', true);
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });
});

describe('setShelfLifeDays', () => {
  it('writes the given value and persists it', () => {
    const spinach = makeItem({ name: 'Spinach' });
    seed([spinach]);

    useGroceryStore.getState().setShelfLifeDays(spinach.id, 5);

    expect(useGroceryStore.getState().items[0].shelfLifeDays).toBe(5);
    expect(dbUpdateGroceryItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: spinach.id, shelfLifeDays: 5 })
    );
  });

  it('is a dumb setter — it never touches expiresAt or spawns a use-up task', () => {
    mockUseUpTasks = true;
    const spinach = makeItem({ name: 'Spinach', expiresAt: null });
    seed([spinach]);

    useGroceryStore.getState().setShelfLifeDays(spinach.id, 5);

    expect(useGroceryStore.getState().items[0].expiresAt).toBeNull();
    expect(useUpTaskFor(spinach.id)).toBeUndefined();
  });

  it('clears back to null', () => {
    const spinach = makeItem({ name: 'Spinach', shelfLifeDays: 5 });
    seed([spinach]);

    useGroceryStore.getState().setShelfLifeDays(spinach.id, null);

    expect(useGroceryStore.getState().items[0].shelfLifeDays).toBeNull();
  });

  it('shrugs at an id it does not hold', () => {
    seed([]);
    useGroceryStore.getState().setShelfLifeDays('gone', 5);
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });
});

describe('setFrozen', () => {
  it('stamps the instant and leaves the stored use-by day alone', () => {
    const spinach = makeItem({ name: 'Spinach', expiresAt: '2026-08-20' });
    seed([spinach]);

    useGroceryStore.getState().setFrozen(spinach.id, true);

    const updated = useGroceryStore.getState().items[0];
    expect(updated.frozenAt).not.toBeNull();
    // Suspended, not cleared — there'd be nothing to restart from otherwise,
    // and no way to tell a frozen row from one that never had a date.
    expect(updated.expiresAt).toBe('2026-08-20');
    expect(dbUpdateGroceryItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: spinach.id, expiresAt: '2026-08-20' })
    );
  });

  it('drops the use-up task on the way in', () => {
    mockUseUpTasks = true;
    // Seeded dateless and given the day through the setter, which is what
    // reconciles — setExpiresAt early-returns on a value the row already has.
    const spinach = makeItem({ name: 'Spinach', expiresAt: null });
    seed([spinach]);
    useGroceryStore.getState().setExpiresAt(spinach.id, '2026-08-20');
    expect(useUpTaskFor(spinach.id)).toBeDefined();

    useGroceryStore.getState().setFrozen(spinach.id, true);

    expect(useUpTaskFor(spinach.id)).toBeUndefined();
  });

  // The whole point of the thaw: chicken that keeps two days keeps two days
  // from coming out, not two days from a purchase three months ago.
  it('restarts the clock from a fresh shelf life on the way out', () => {
    const chicken = makeItem({
      name: 'Chicken',
      expiresAt: '2026-05-01',
      shelfLifeDays: 2,
      frozenAt: '2026-05-01T09:00:00.000Z',
    });
    seed([chicken]);

    useGroceryStore.getState().setFrozen(chicken.id, false);

    const updated = useGroceryStore.getState().items[0];
    expect(updated.frozenAt).toBeNull();
    expect(expiryDaysFromNow(updated.expiresAt!, new Date())).toBe(2);
  });

  it('prefers the lexicon when the row carries no remembered shelf life', () => {
    // "spinach" is in SHELF_LIFE_LEXICON at 5 days.
    const spinach = makeItem({ name: 'Spinach', frozenAt: '2026-05-01T09:00:00.000Z' });
    seed([spinach]);

    useGroceryStore.getState().setFrozen(spinach.id, false);

    const thawed = useGroceryStore.getState().items[0];
    expect(expiryDaysFromNow(thawed.expiresAt!, new Date())).toBe(5);
  });

  it('thaws to no date at all for a name nothing knows a shelf life for', () => {
    const gadget = makeItem({ name: 'Bicarbonate of soda', frozenAt: '2026-05-01T09:00:00.000Z' });
    seed([gadget]);

    useGroceryStore.getState().setFrozen(gadget.id, false);

    // Silence, rather than a number invented on the way out.
    expect(useGroceryStore.getState().items[0].expiresAt).toBeNull();
  });

  // Otherwise the fresh bag inherits the old bag's freezer claim and its
  // brand-new use-by date is suspended the moment it's stamped.
  it('is cleared by a purchase, along with the rest of the old bag\'s state', () => {
    const spinach = makeItem({
      name: 'Spinach',
      onList: true,
      checked: true,
      frozenAt: '2026-05-01T09:00:00.000Z',
    });
    seed([spinach]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([spinach.id]);

    useGroceryStore.getState().finishShopping();

    const bought = useGroceryStore.getState().items[0];
    expect(bought.frozenAt).toBeNull();
    expect(expiryDaysFromNow(bought.expiresAt!, new Date())).toBe(5);
  });

  // The scan sheet's freezer toggle: a fresh claim about *this* purchase,
  // made this same trip, so it wins over the clear above rather than
  // fighting it.
  it('is set instead of cleared for an id finishShopping is told to freeze', () => {
    const peas = makeItem({ name: 'Peas', onList: true, checked: true });
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([peas, milk]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([peas.id, milk.id]);

    useGroceryStore
      .getState()
      .finishShopping(null, {}, '2026-08-22T10:00:00.000Z', new Set([peas.id]));

    const byId = Object.fromEntries(useGroceryStore.getState().items.map(i => [i.id, i]));
    expect(byId[peas.id].frozenAt).toBe('2026-08-22T10:00:00.000Z');
    expect(byId[milk.id].frozenAt).toBeNull();
  });

  it('does nothing for a frozen id the trip did not actually purchase', () => {
    const peas = makeItem({ name: 'Peas', onList: true, checked: false });
    const milk = makeItem({ name: 'Milk', onList: true, checked: true });
    seed([peas, milk]);
    // Only milk was actually bought — peas is flagged frozen anyway, as if a
    // scan session had marked it before the trip decided it wasn't in stock.
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([milk.id]);

    useGroceryStore.getState().finishShopping(null, {}, undefined, new Set([peas.id]));

    expect(useGroceryStore.getState().items.find(i => i.id === peas.id)).toEqual(peas);
  });

  it('undoes a freeze written this way along with the rest of the trip', () => {
    const peas = makeItem({ name: 'Peas', onList: true, checked: true, frozenAt: null });
    seed([peas]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([peas.id]);

    useGroceryStore.getState().finishShopping(null, {}, undefined, new Set([peas.id]));
    expect(useGroceryStore.getState().items[0].frozenAt).not.toBeNull();

    useGroceryStore.getState().undoLastAction();

    expect(useGroceryStore.getState().items[0]).toEqual(peas);
  });

  it('is a no-op when the item is already in that state', () => {
    const spinach = makeItem({ name: 'Spinach', frozenAt: '2026-05-01T09:00:00.000Z' });
    seed([spinach]);

    useGroceryStore.getState().setFrozen(spinach.id, true);

    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });

  it('shrugs at an id it does not hold', () => {
    seed([]);
    useGroceryStore.getState().setFrozen('gone', true);
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });
});

describe('setOpened', () => {
  // The case the second lexicon exists for: a jar bought five weeks ago carries
  // a purchase-based day that has long since passed, and opening it is new
  // information the old guess never had.
  it('re-dates from the open lexicon, counting from the moment it was opened', () => {
    // "salsa" is in OPEN_SHELF_LIFE_LEXICON at 7 days.
    const salsa = makeItem({ name: 'Salsa', expiresAt: '2026-05-01' });
    seed([salsa]);

    useGroceryStore.getState().setOpened(salsa.id, true);

    const updated = useGroceryStore.getState().items[0];
    expect(updated.openedAt).not.toBeNull();
    expect(expiryDaysFromNow(updated.expiresAt!, new Date())).toBe(7);
  });

  // Opening a bag of spinach doesn't restart anything — it was already exposed
  // to the same air the fridge is full of.
  it('records the opening but leaves the day alone for a name opening says nothing about', () => {
    const spinach = makeItem({ name: 'Spinach', expiresAt: '2026-08-20' });
    seed([spinach]);

    useGroceryStore.getState().setOpened(spinach.id, true);

    const updated = useGroceryStore.getState().items[0];
    expect(updated.openedAt).not.toBeNull();
    expect(updated.expiresAt).toBe('2026-08-20');
  });

  it('un-marking clears the stamp and leaves the date, there being no old day to restore', () => {
    const salsa = makeItem({ name: 'Salsa', expiresAt: '2026-08-20', openedAt: '2026-08-01T09:00:00.000Z' });
    seed([salsa]);

    useGroceryStore.getState().setOpened(salsa.id, false);

    const updated = useGroceryStore.getState().items[0];
    expect(updated.openedAt).toBeNull();
    expect(updated.expiresAt).toBe('2026-08-20');
  });

  it('is cleared by a purchase, because a fresh jar is sealed', () => {
    const salsa = makeItem({
      name: 'Salsa', onList: true, checked: true, openedAt: '2026-05-01T09:00:00.000Z',
    });
    seed([salsa]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([salsa.id]);

    useGroceryStore.getState().finishShopping();

    expect(useGroceryStore.getState().items[0].openedAt).toBeNull();
  });

  it('shrugs at an id it does not hold', () => {
    seed([]);
    useGroceryStore.getState().setOpened('gone', true);
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });
});

describe('markOpenedMany', () => {
  it('stamps every row it is given, re-dating the ones the open lexicon knows', () => {
    const salsa = makeItem({ name: 'Salsa', expiresAt: '2026-05-01' });
    const spinach = makeItem({ name: 'Spinach', expiresAt: '2026-08-20' });
    seed([salsa, spinach]);

    const changed = useGroceryStore.getState().markOpenedMany([salsa.id, spinach.id]);

    expect(changed).toBe(2);
    const [openedSalsa, openedSpinach] = useGroceryStore.getState().items;
    expect(expiryDaysFromNow(openedSalsa.expiresAt!, new Date())).toBe(7);
    // Recorded either way; only the date is conditional on the lexicon.
    expect(openedSpinach.openedAt).not.toBeNull();
    expect(openedSpinach.expiresAt).toBe('2026-08-20');
  });

  // openedAt is when it was first opened. A second cook out of the same jar
  // doesn't restart its clock, and the count says so.
  it('skips a row that is already open rather than re-stamping it', () => {
    const salsa = makeItem({ name: 'Salsa', openedAt: '2026-08-01T09:00:00.000Z' });
    const jam = makeItem({ name: 'Jam' });
    seed([salsa, jam]);

    const changed = useGroceryStore.getState().markOpenedMany([salsa.id, jam.id]);

    expect(changed).toBe(1);
    expect(useGroceryStore.getState().items[0].openedAt).toBe('2026-08-01T09:00:00.000Z');
  });

  it('dates the opening to the day it is given, not to now', () => {
    const salsa = makeItem({ name: 'Salsa', expiresAt: null });
    seed([salsa]);

    const opened = new Date('2026-08-05T12:00:00');
    useGroceryStore.getState().markOpenedMany([salsa.id], opened);

    const updated = useGroceryStore.getState().items[0];
    expect(updated.openedAt).toBe(opened.toISOString());
    // Seven days from the opening, which is three days *before* now — the whole
    // reason the caller gets to say when.
    expect(expiryDaysFromNow(updated.expiresAt!, opened)).toBe(7);
  });

  // Nobody tapped these rows, so the shake belongs to whatever did — see the
  // action's doc comment.
  it('registers no undo of its own', () => {
    const salsa = makeItem({ name: 'Salsa' });
    seed([salsa]);
    useGroceryStore.setState({ lastAction: null });

    useGroceryStore.getState().markOpenedMany([salsa.id]);

    expect(useGroceryStore.getState().lastAction).toBeNull();
  });

  it('writes nothing for an empty list, or for ids it does not hold', () => {
    seed([makeItem({ name: 'Salsa' })]);

    expect(useGroceryStore.getState().markOpenedMany([])).toBe(0);
    expect(useGroceryStore.getState().markOpenedMany(['gone'])).toBe(0);
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });
});

describe('setRunningLow', () => {
  // The whole reason anyone says it: noticing the jar is nearly empty is the
  // moment you want it on the list, and making them find the item again in the
  // add field is asking them to say it twice.
  it('puts the row on this week\'s list', () => {
    const flour = makeItem({ name: 'Flour', onList: false });
    seed([flour]);

    useGroceryStore.getState().setRunningLow(flour.id, true);

    const updated = useGroceryStore.getState().items[0];
    expect(updated.runningLowAt).not.toBeNull();
    expect(updated.onList).toBe(true);
  });

  // One direction only: nothing on the row records *which* owner put it on the
  // list, so a clear that removed it would be guessing with someone else's
  // data. The add is undoable the moment it happens.
  it('leaves the list alone when cleared', () => {
    const flour = makeItem({ name: 'Flour', onList: false });
    seed([flour]);
    useGroceryStore.getState().setRunningLow(flour.id, true);

    useGroceryStore.getState().setRunningLow(flour.id, false);

    const updated = useGroceryStore.getState().items[0];
    expect(updated.runningLowAt).toBeNull();
    expect(updated.onList).toBe(true);
  });

  it('offers an undo that puts the row back exactly as it was', () => {
    const flour = makeItem({ name: 'Flour', onList: false });
    seed([flour]);

    useGroceryStore.getState().setRunningLow(flour.id, true);
    useGroceryStore.getState().lastAction!.undo!();

    const undone = useGroceryStore.getState().items[0];
    expect(undone.runningLowAt).toBeNull();
    expect(undone.onList).toBe(false);
  });

  it('is cleared by a purchase, which is what refutes it', () => {
    const flour = makeItem({
      name: 'Flour', onList: true, checked: true, runningLowAt: '2026-08-01T09:00:00.000Z',
    });
    seed([flour]);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([flour.id]);

    useGroceryStore.getState().finishShopping();

    expect(useGroceryStore.getState().items[0].runningLowAt).toBeNull();
  });

  it('shrugs at an id it does not hold', () => {
    seed([]);
    useGroceryStore.getState().setRunningLow('gone', true);
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });
});

describe('either/or items (choiceGroup)', () => {
  const pair = () => {
    const apples = useGroceryStore.getState().addByName('apples', {
      name: 'apples', quantity: null, choiceGroup: 'g1',
    });
    const pears = useGroceryStore.getState().addByName('pears', {
      name: 'pears', quantity: null, choiceGroup: 'g1',
    });
    return { apples, pears };
  };

  it('files both rows under the group', () => {
    const { apples, pears } = pair();
    expect(apples.choiceGroup).toBe('g1');
    expect(pears.choiceGroup).toBe('g1');
  });

  it('ticking one takes the other off the list and ends the choice', () => {
    const { apples, pears } = pair();
    useGroceryStore.getState().toggleChecked(apples.id);

    const items = useGroceryStore.getState().items;
    const survivor = items.find(i => i.id === apples.id)!;
    expect(survivor.checked).toBe(true);
    // The choice is over, so the row is an ordinary one again.
    expect(survivor.choiceGroup).toBeNull();
    // The loser parks rather than being deleted: picking apples this week says
    // nothing about wanting pears forgotten.
    const loser = items.find(i => i.id === pears.id)!;
    expect(loser.onList).toBe(false);
    expect(loser.choiceGroup).toBeNull();
  });

  // Every park path clears the group, not just resolveChoice's. It parks now
  // where it used to delete, so a label carried off-list would silently
  // re-form the pair when both names were added again months later.
  it('clears the group when an option is removed from the list instead of ticked', () => {
    const { apples, pears } = pair();

    useGroceryStore.getState().removeFromList(apples.id);
    expect(useGroceryStore.getState().itemById(apples.id)!.choiceGroup).toBeNull();

    useGroceryStore.getState().removeFromListMany([pears.id]);
    expect(useGroceryStore.getState().itemById(pears.id)!.choiceGroup).toBeNull();
  });

  it('clears the group when the whole list is cleared', () => {
    const { apples, pears } = pair();
    (dbClearGroceryList as jest.Mock).mockReturnValue([apples.id, pears.id]);

    useGroceryStore.getState().clearList();

    // Both rows carry a note from the pair() helper's override, so neither is
    // swept — the point here is the label, not the sweep.
    for (const id of [apples.id, pears.id]) {
      const row = useGroceryStore.getState().itemById(id);
      if (row) expect(row.choiceGroup).toBeNull();
    }
  });

  // The other park paths drop a recipe-owned quantity; this one didn't, which
  // only became reachable once the loser stopped being deleted.
  it('drops a rejected option\'s recipe-owned quantity', () => {
    const { apples, pears } = pair();
    useGroceryStore.setState(s => ({
      items: s.items.map(i => (
        i.id === pears.id ? { ...i, quantity: '2 cups', quantityFromRecipe: true } : i
      )),
    }));

    useGroceryStore.getState().toggleChecked(apples.id);

    const loser = useGroceryStore.getState().itemById(pears.id)!;
    expect(loser.quantity).toBeNull();
    expect(loser.quantityFromRecipe).toBe(false);
  });

  it('undoes the whole choice — the loser comes back and the tick is taken off', () => {
    const { apples, pears } = pair();
    useGroceryStore.getState().toggleChecked(apples.id);
    useGroceryStore.getState().undoLastAction();

    const items = useGroceryStore.getState().items;
    const back = items.find(i => i.id === pears.id);
    expect(back?.onList).toBe(true);
    expect(back?.choiceGroup).toBe('g1');
    const winner = items.find(i => i.id === apples.id)!;
    expect(winner.checked).toBe(false);
    expect(winner.choiceGroup).toBe('g1');
  });

  it('ticking a row whose group has no live siblings left just ends the group', () => {
    const { apples, pears } = pair();
    useGroceryStore.getState().removeFromList(pears.id);
    useGroceryStore.getState().toggleChecked(apples.id);

    const winner = useGroceryStore.getState().items.find(i => i.id === apples.id)!;
    expect(winner.checked).toBe(true);
    expect(winner.choiceGroup).toBeNull();
  });

  it('clearChoice unlinks every member, not just the one asked about', () => {
    const { apples, pears } = pair();
    useGroceryStore.getState().clearChoice(apples.id);

    const items = useGroceryStore.getState().items;
    expect(items.find(i => i.id === apples.id)!.choiceGroup).toBeNull();
    expect(items.find(i => i.id === pears.id)!.choiceGroup).toBeNull();
    // Both stay on the list — unlinking is a correction, not a choice.
    expect(items.find(i => i.id === pears.id)!.onList).toBe(true);
  });

  it('leaves an ordinary row alone when it is ticked', () => {
    const milk = useGroceryStore.getState().addByName('milk');
    useGroceryStore.getState().toggleChecked(milk.id);
    expect(useGroceryStore.getState().items.find(i => i.id === milk.id)!.checked).toBe(true);
    // The add's own undo is still the last thing registered — no choice was made.
    expect(useGroceryStore.getState().lastAction?.label).toBe('Added "milk"');
  });
});

// ─── Use-up tasks (#1106) ───────────────────────────────────────────────────

describe('use-up tasks', () => {
  const NAME = 'Spinach';

  it('setExpiresAt spawns the task, dated the lead time before the use-by day', () => {
    mockUseUpTasks = true;
    mockUseUpLeadDays = 2;
    const spinach = makeItem({ name: NAME });
    seed([spinach]);

    useGroceryStore.getState().setExpiresAt(spinach.id, '2026-08-17');

    const task = useUpTaskFor(spinach.id)!;
    expect(task.title).toBe('Use up Spinach');
    expect(new Date(task.dueDate!).getDate()).toBe(15);
    // The use-by day itself rides along as the deadline.
    expect(new Date(task.deadline!).getDate()).toBe(17);
  });

  it('files the task under the configured category, once', () => {
    mockUseUpTasks = true;
    mockUseUpCategory = 'Home';
    const spinach = makeItem({ name: NAME });
    seed([spinach]);

    useGroceryStore.getState().setExpiresAt(spinach.id, '2026-08-17');

    expect(useUpTaskFor(spinach.id)!.category).toBe('Home');

    // A later date change is a reconcile, and a reconcile writes only the
    // fields the item owns — the category is the user's from here on.
    mockUseUpCategory = 'Errands';
    useGroceryStore.getState().setExpiresAt(spinach.id, '2026-08-19');
    expect(useUpTaskFor(spinach.id)!.category).toBe('Home');
  });

  it('spawns nothing with the setting off', () => {
    const spinach = makeItem({ name: NAME });
    seed([spinach]);

    useGroceryStore.getState().setExpiresAt(spinach.id, '2026-08-17');

    expect(useUpTaskFor(spinach.id)).toBeUndefined();
    // The date is still recorded — the setting decides the task, not the fact.
    expect(useGroceryStore.getState().items[0].expiresAt).toBe('2026-08-17');
  });

  it('lets one item opt in while the setting is off', () => {
    const spinach = makeItem({ name: NAME, expiresAt: '2026-08-17' });
    seed([spinach]);

    useGroceryStore.getState().setUseUpTask(spinach.id, true);

    expect(useUpTaskFor(spinach.id)).toBeDefined();
  });

  // #1953. reconcileUseUpTask fires on mutations that leave expiresAt exactly
  // where it was, and it used to recompute the day anyway — so a task the user
  // had deferred snapped back to the lead-time date on the strength of an
  // unrelated edit.
  it('leaves a task the user re-dated alone when the use-by has not moved', () => {
    mockUseUpTasks = true;
    const salsa = makeItem({ name: 'Salsa', expiresAt: '2026-08-17', openedAt: '2026-08-14T09:00:00.000Z' });
    seed([salsa]);
    useGroceryStore.getState().setUseUpTask(salsa.id, true);

    const deferred = '2099-06-01T12:00:00.000Z';
    mockTaskState.updateTask(useUpTaskFor(salsa.id)!.id, { dueDate: deferred });

    // Un-opening re-dates nothing (`reDated ?? item.expiresAt`), and the item's
    // own switch re-dates nothing either.
    useGroceryStore.getState().setOpened(salsa.id, false);
    useGroceryStore.getState().setUseUpTask(salsa.id, null);

    expect(useUpTaskFor(salsa.id)!.dueDate).toBe(deferred);
    expect(mockTaskState.tasks.filter(t => t.generatedSourceId === salsa.id)).toHaveLength(1);
  });

  it('still re-dates a deferred task when the use-by itself moves', () => {
    mockUseUpTasks = true;
    mockUseUpLeadDays = 2;
    const spinach = makeItem({ name: NAME });
    seed([spinach]);
    useGroceryStore.getState().setExpiresAt(spinach.id, '2026-08-17');
    mockTaskState.updateTask(useUpTaskFor(spinach.id)!.id, { dueDate: '2099-06-01T12:00:00.000Z' });

    useGroceryStore.getState().setExpiresAt(spinach.id, '2026-08-24');

    expect(new Date(useUpTaskFor(spinach.id)!.dueDate!).getDate()).toBe(22);
  });

  it('moves the existing task rather than adding a second when the date changes', () => {
    mockUseUpTasks = true;
    const spinach = makeItem({ name: NAME });
    seed([spinach]);

    useGroceryStore.getState().setExpiresAt(spinach.id, '2026-08-17');
    useGroceryStore.getState().setExpiresAt(spinach.id, '2026-08-24');

    expect(mockTaskState.tasks.filter(t => t.generatedSourceId === spinach.id)).toHaveLength(1);
    expect(new Date(useUpTaskFor(spinach.id)!.dueDate!).getDate()).toBe(23);
    // The item's date is not a schedule the user picked, so moving it doesn't
    // count as a reschedule.
    expect(mockTaskState.updateTask).toHaveBeenCalledWith(
      expect.any(String), expect.any(Object), { skipPostponeCount: true }
    );
  });

  it('drops the live task when the date is cleared, and arms no undo of its own', () => {
    mockUseUpTasks = true;
    const spinach = makeItem({ name: NAME });
    seed([spinach]);
    useGroceryStore.getState().setExpiresAt(spinach.id, '2026-08-17');

    useGroceryStore.getState().setExpiresAt(spinach.id, null);

    expect(useUpTaskFor(spinach.id)).toBeUndefined();
    expect(mockTaskState.setLastAction).toHaveBeenCalledWith(null);
  });

  it('drops the live task when the item is forgotten', () => {
    mockUseUpTasks = true;
    const spinach = makeItem({ name: NAME });
    seed([spinach]);
    useGroceryStore.getState().setExpiresAt(spinach.id, '2026-08-17');

    useGroceryStore.getState().deleteItem(spinach.id);

    expect(useUpTaskFor(spinach.id)).toBeUndefined();
  });

  it('honours an opt-out on the item, which is what deleting the task records', () => {
    mockUseUpTasks = true;
    const spinach = makeItem({ name: NAME, useUpTask: false });
    seed([spinach]);

    useGroceryStore.getState().setExpiresAt(spinach.id, '2026-08-17');

    expect(useUpTaskFor(spinach.id)).toBeUndefined();
  });

  describe('finishShopping', () => {
    it('dates what the shelf-life lexicon recognises and spawns its task', () => {
      mockUseUpTasks = true;
      const spinach = makeItem({ name: 'spinach', onList: true, checked: true });
      seed([spinach]);
      (dbFinishGroceryShopping as jest.Mock).mockReturnValue([spinach.id]);

      useGroceryStore.getState().finishShopping();

      const stored = useGroceryStore.getState().items.find(i => i.id === spinach.id)!;
      expect(stored.expiresAt).not.toBeNull();
      expect(useUpTaskFor(spinach.id)).toBeDefined();
    });

    it('leaves a store-cupboard row alone — no date, no task', () => {
      mockUseUpTasks = true;
      const rice = makeItem({ name: 'rice', onList: true, checked: true });
      seed([rice]);
      (dbFinishGroceryShopping as jest.Mock).mockReturnValue([rice.id]);

      useGroceryStore.getState().finishShopping();

      expect(useGroceryStore.getState().items.find(i => i.id === rice.id)!.expiresAt).toBeNull();
      expect(useUpTaskFor(rice.id)).toBeUndefined();
    });

    it('prefers a remembered shelf life over the lexicon guess', () => {
      mockUseUpTasks = true;
      // The lexicon says spinach keeps 5 days; this shopper has corrected it.
      const spinach = makeItem({ name: 'spinach', onList: true, checked: true, shelfLifeDays: 10 });
      seed([spinach]);
      (dbFinishGroceryShopping as jest.Mock).mockReturnValue([spinach.id]);

      useGroceryStore.getState().finishShopping();

      const stored = useGroceryStore.getState().items.find(i => i.id === spinach.id)!;
      expect(expiryDaysFromNow(stored.expiresAt!, new Date())).toBe(10);
    });

    it('activates a remembered shelf life for a name the lexicon has never heard of', () => {
      mockUseUpTasks = true;
      const custom = makeItem({ name: 'homemade stock', onList: true, checked: true, shelfLifeDays: 4 });
      seed([custom]);
      (dbFinishGroceryShopping as jest.Mock).mockReturnValue([custom.id]);

      useGroceryStore.getState().finishShopping();

      const stored = useGroceryStore.getState().items.find(i => i.id === custom.id)!;
      expect(stored.expiresAt).not.toBeNull();
      expect(useUpTaskFor(custom.id)).toBeDefined();
    });

    it('re-stamps a fresh purchase rather than keeping the old bag\'s day', () => {
      mockUseUpTasks = true;
      const spinach = makeItem({ name: 'spinach', onList: true, checked: true, expiresAt: '2026-01-01' });
      seed([spinach]);
      (dbFinishGroceryShopping as jest.Mock).mockReturnValue([spinach.id]);

      useGroceryStore.getState().finishShopping();

      expect(useGroceryStore.getState().items.find(i => i.id === spinach.id)!.expiresAt)
        .not.toBe('2026-01-01');
    });

    it('dates a shelf-life day from an explicit purchasedAt rather than now (#1806)', () => {
      mockUseUpTasks = true;
      const spinach = makeItem({ name: 'spinach', onList: true, checked: true });
      seed([spinach]);
      (dbFinishGroceryShopping as jest.Mock).mockReturnValue([spinach.id]);

      const now = new Date();
      // Spinach's lexicon shelf life is 5 days (see the sibling test above) —
      // dated from 5 days ago, the use-by day lands on today rather than 5
      // days from now.
      const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();

      useGroceryStore.getState().finishShopping(null, {}, fiveDaysAgo);

      const stored = useGroceryStore.getState().items.find(i => i.id === spinach.id)!;
      expect(expiryDaysFromNow(stored.expiresAt!, now)).toBe(0);
    });

    it('gives this month\'s bag its own task even though last month\'s is ticked off', () => {
      mockUseUpTasks = true;
      const spinach = makeItem({ name: 'spinach', onList: true, checked: true });
      seed([spinach]);
      mockTaskState.tasks.push({
        id: 'old', title: 'Use up spinach', generatedKind: 'groceryUseUp', generatedSourceId: spinach.id, completed: true, archived: false,
      } as never);
      (dbFinishGroceryShopping as jest.Mock).mockReturnValue([spinach.id]);

      useGroceryStore.getState().finishShopping();

      expect(useUpTaskFor(spinach.id)).toBeDefined();
      expect(mockTaskState.tasks.filter(t => t.generatedSourceId === spinach.id)).toHaveLength(2);
    });
  });
});

describe('the active trip', () => {
  const HOUR = 60 * 60 * 1000;

  it('starts a trip at a live store and persists both halves', () => {
    const costco = makeShop('Costco');
    seed([], { shops: [costco] });

    useGroceryStore.getState().startTrip(costco.id);

    const state = useGroceryStore.getState();
    expect(state.tripShopId).toBe(costco.id);
    expect(state.tripStartedAt).not.toBeNull();
    expect(dbSetTrip).toHaveBeenCalledWith(costco.id, state.tripStartedAt);
    expect(scheduleTripReminder).toHaveBeenCalledWith('Costco', state.tripStartedAt);
  });

  it('refuses to start a trip at a store that does not exist', () => {
    seed([], { shops: [] });

    useGroceryStore.getState().startTrip('shop-gone');

    expect(useGroceryStore.getState().tripShopId).toBeNull();
    expect(dbSetTrip).not.toHaveBeenCalled();
    expect(scheduleTripReminder).not.toHaveBeenCalled();
  });

  it('ends a trip', () => {
    const costco = makeShop('Costco');
    seed([], { shops: [costco], tripShopId: costco.id, tripStartedAt: new Date().toISOString() });

    useGroceryStore.getState().endTrip();

    expect(useGroceryStore.getState().tripShopId).toBeNull();
    expect(useGroceryStore.getState().tripStartedAt).toBeNull();
    expect(dbSetTrip).toHaveBeenCalledWith(null, null);
    expect(cancelTripReminder).toHaveBeenCalled();
  });

  it('ending a trip that is not running writes nothing', () => {
    seed([], { shops: [] });
    (cancelTripReminder as jest.Mock).mockClear();

    useGroceryStore.getState().endTrip();

    expect(dbSetTrip).not.toHaveBeenCalled();
    expect(cancelTripReminder).not.toHaveBeenCalled();
  });

  it('activeShop resolves a live trip', () => {
    const costco = makeShop('Costco');
    seed([], { shops: [costco], tripShopId: costco.id, tripStartedAt: new Date().toISOString() });

    expect(useGroceryStore.getState().activeShop()?.id).toBe(costco.id);
  });

  // The whole point of the stamp: yesterday's trip is not today's.
  it('activeShop refuses a trip that has aged out', () => {
    const costco = makeShop('Costco');
    seed([], {
      shops: [costco],
      tripShopId: costco.id,
      tripStartedAt: new Date(Date.now() - 12 * HOUR).toISOString(),
    });

    expect(useGroceryStore.getState().activeShop()).toBeNull();
  });

  it('checkTripExpiry clears an aged-out trip', () => {
    const costco = makeShop('Costco');
    seed([], {
      shops: [costco],
      tripShopId: costco.id,
      tripStartedAt: new Date(Date.now() - 12 * HOUR).toISOString(),
    });

    useGroceryStore.getState().checkTripExpiry();

    expect(useGroceryStore.getState().tripShopId).toBeNull();
    expect(dbSetTrip).toHaveBeenCalledWith(null, null);
    expect(cancelTripReminder).toHaveBeenCalled();
  });

  it('checkTripExpiry leaves a running trip alone', () => {
    const costco = makeShop('Costco');
    seed([], { shops: [costco], tripShopId: costco.id, tripStartedAt: new Date().toISOString() });

    useGroceryStore.getState().checkTripExpiry();

    expect(useGroceryStore.getState().tripShopId).toBe(costco.id);
    expect(dbSetTrip).not.toHaveBeenCalled();
  });

  it('deleting the store you are shopping at ends the trip', () => {
    const costco = makeShop('Costco');
    seed([], { shops: [costco], tripShopId: costco.id, tripStartedAt: new Date().toISOString() });

    useGroceryStore.getState().deleteShop(costco.id);

    expect(useGroceryStore.getState().tripShopId).toBeNull();
    expect(useGroceryStore.getState().tripStartedAt).toBeNull();
    expect(dbSetTrip).toHaveBeenCalledWith(null, null);
    expect(cancelTripReminder).toHaveBeenCalled();
  });

  it('deleting a different store leaves the trip running', () => {
    const costco = makeShop('Costco');
    const safeway = makeShop('Safeway');
    seed([], {
      shops: [costco, safeway],
      tripShopId: costco.id,
      tripStartedAt: new Date().toISOString(),
    });
    (cancelTripReminder as jest.Mock).mockClear();

    useGroceryStore.getState().deleteShop(safeway.id);

    expect(useGroceryStore.getState().tripShopId).toBe(costco.id);
    expect(dbSetTrip).not.toHaveBeenCalled();
    expect(cancelTripReminder).not.toHaveBeenCalled();
  });

  it('clearing the list ends the trip', () => {
    const costco = makeShop('Costco');
    const milk = makeItem({ name: 'Milk', onList: true });
    (dbClearGroceryList as jest.Mock).mockReturnValue([milk.id]);
    seed([milk], { shops: [costco], tripShopId: costco.id, tripStartedAt: new Date().toISOString() });

    useGroceryStore.getState().clearList();

    expect(useGroceryStore.getState().tripShopId).toBeNull();
  });

  it('initialize restores a trip that is still running', () => {
    const costco = makeShop('Costco');
    const startedAt = new Date(Date.now() - HOUR).toISOString();
    (dbGetAllGroceryShops as jest.Mock).mockReturnValue([costco]);
    (dbGetTripShopId as jest.Mock).mockReturnValue(costco.id);
    (dbGetTripStartedAt as jest.Mock).mockReturnValue(startedAt);

    useGroceryStore.getState().initialize();

    expect(useGroceryStore.getState().tripShopId).toBe(costco.id);
    expect(useGroceryStore.getState().tripStartedAt).toBe(startedAt);
  });

  // Repaired at read time and not written back, like the aisle order.
  it('initialize drops a trip that aged out while the app was closed', () => {
    const costco = makeShop('Costco');
    (dbGetAllGroceryShops as jest.Mock).mockReturnValue([costco]);
    (dbGetTripShopId as jest.Mock).mockReturnValue(costco.id);
    (dbGetTripStartedAt as jest.Mock).mockReturnValue(new Date(Date.now() - 12 * HOUR).toISOString());

    useGroceryStore.getState().initialize();

    expect(useGroceryStore.getState().tripShopId).toBeNull();
    expect(useGroceryStore.getState().tripStartedAt).toBeNull();
    expect(dbSetTrip).not.toHaveBeenCalled();
  });

  it('initialize drops a trip whose store is gone', () => {
    (dbGetAllGroceryShops as jest.Mock).mockReturnValue([]);
    (dbGetTripShopId as jest.Mock).mockReturnValue('shop-gone');
    (dbGetTripStartedAt as jest.Mock).mockReturnValue(new Date().toISOString());

    useGroceryStore.getState().initialize();

    expect(useGroceryStore.getState().tripShopId).toBeNull();
  });
});

// ─── Substitutes ─────────────────────────────────────────────────────────────

describe('substitutes', () => {
  it('linkItemSub writes one direction', () => {
    const butter = makeItem({ name: 'Butter' });
    const margarine = makeItem({ name: 'Margarine' });
    seed([butter, margarine]);

    useGroceryStore.getState().linkItemSub(butter.id, margarine.id);

    const subs = useGroceryStore.getState().itemSubs;
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ itemId: butter.id, subItemId: margarine.id, note: null });
    expect(dbSetItemSubLink).toHaveBeenCalledTimes(1);
  });

  it('bothWays writes two rows rather than setting a flag', () => {
    const butter = makeItem({ name: 'Butter' });
    const margarine = makeItem({ name: 'Margarine' });
    seed([butter, margarine]);

    useGroceryStore.getState().linkItemSub(butter.id, margarine.id, {
      note: 'Not for baking',
      bothWays: true,
    });

    const subs = useGroceryStore.getState().itemSubs;
    expect(subs).toHaveLength(2);
    // The caveat is a fact about the pair, so it rides both rows.
    expect(subs.every(l => l.note === 'Not for baking')).toBe(true);
    expect(subs.map(l => [l.itemId, l.subItemId])).toEqual(
      expect.arrayContaining([
        [butter.id, margarine.id],
        [margarine.id, butter.id],
      ])
    );
  });

  it('writes a ratio only when both sides are given, and drops one typed alone', () => {
    const butter = makeItem({ name: 'Butter' });
    const margarine = makeItem({ name: 'Margarine' });
    seed([butter, margarine]);

    useGroceryStore.getState().linkItemSub(butter.id, margarine.id, {
      ratioFrom: '1 clove', ratioTo: '1/4 tsp',
    });
    expect(useGroceryStore.getState().itemSubs[0]).toMatchObject({
      ratioFrom: '1 clove', ratioTo: '1/4 tsp',
    });

    useGroceryStore.getState().linkItemSub(butter.id, margarine.id, { ratioFrom: '1 clove' });
    expect(useGroceryStore.getState().itemSubs[0]).toMatchObject({
      ratioFrom: null, ratioTo: null,
    });
  });

  it('swaps the ratio on the reverse row of a both-ways link', () => {
    // The forward row describes garlic's own unit on the left; the reverse
    // row has to describe garlic powder's own unit on ITS left, or it would
    // claim a clove converts to a further clove.
    const garlic = makeItem({ name: 'Garlic' });
    const powder = makeItem({ name: 'Garlic powder' });
    seed([garlic, powder]);

    useGroceryStore.getState().linkItemSub(garlic.id, powder.id, {
      ratioFrom: '1 clove', ratioTo: '1/4 tsp', bothWays: true,
    });

    const subs = useGroceryStore.getState().itemSubs;
    expect(subs.find(l => l.itemId === garlic.id)).toMatchObject({
      ratioFrom: '1 clove', ratioTo: '1/4 tsp',
    });
    expect(subs.find(l => l.itemId === powder.id)).toMatchObject({
      ratioFrom: '1/4 tsp', ratioTo: '1 clove',
    });
  });

  it('re-linking with the ratio omitted clears it — the row is written whole, not patched', () => {
    // Same contract dbSetItemShopLink documents for ItemShopLink: the caller
    // passes the row it wants to exist. SubstituteSheet relies on this by
    // always threading the current ratio back through on Save; a caller that
    // doesn't is choosing to clear it, the same way omitting the note would.
    const butter = makeItem({ name: 'Butter' });
    const margarine = makeItem({ name: 'Margarine' });
    seed([butter, margarine], {
      itemSubs: [{
        itemId: butter.id, subItemId: margarine.id, note: null,
        createdAt: '2020-01-01T00:00:00.000Z',
        ratioFrom: '100 g', ratioTo: '110 g',
        standing: false,
      }],
    });

    useGroceryStore.getState().linkItemSub(butter.id, margarine.id, { note: 'Updated' });

    // Omitting the ratio on a re-link clears it — the row is written whole,
    // exactly as omitting the note would have cleared that.
    expect(useGroceryStore.getState().itemSubs[0]).toMatchObject({
      note: 'Updated', ratioFrom: null, ratioTo: null,
    });
  });

  it('leaves both rows to be kept by the link itself', () => {
    const butter = makeItem({ name: 'Butter', onList: true });
    const margarine = makeItem({ name: 'Margarine', onList: true });
    seed([butter, margarine]);

    useGroceryStore.getState().linkItemSub(butter.id, margarine.id);

    // Nothing writes to the item rows any more — the link is the protection.
    (dbClearGroceryList as jest.Mock).mockReturnValue([butter.id, margarine.id]);
    useGroceryStore.getState().clearList();
    expect(useGroceryStore.getState().items).toHaveLength(2);

    // ...so the next "Remove from list" parks the row rather than deleting it
    // and taking the substitution with it.
    useGroceryStore.getState().removeFromList(butter.id);
    expect(useGroceryStore.getState().items).toHaveLength(2);
    expect(useGroceryStore.getState().itemSubs).toHaveLength(1);
  });

  it('refuses to link an item to itself', () => {
    const butter = makeItem({ name: 'Butter' });
    seed([butter]);

    useGroceryStore.getState().linkItemSub(butter.id, butter.id);

    expect(useGroceryStore.getState().itemSubs).toEqual([]);
    expect(dbSetItemSubLink).not.toHaveBeenCalled();
  });

  it('ignores a half that does not exist', () => {
    const butter = makeItem({ name: 'Butter' });
    seed([butter]);

    useGroceryStore.getState().linkItemSub(butter.id, 'nope');

    expect(useGroceryStore.getState().itemSubs).toEqual([]);
  });

  it('re-linking an existing pair edits its note and keeps its place', () => {
    const butter = makeItem({ name: 'Butter' });
    const margarine = makeItem({ name: 'Margarine' });
    seed([butter, margarine], {
      itemSubs: [
        {
          itemId: butter.id,
          subItemId: margarine.id,
          note: null,
          createdAt: '2020-01-01T00:00:00.000Z',
          ratioFrom: null,
          ratioTo: null,
          standing: false,
        },
      ],
    });

    useGroceryStore.getState().linkItemSub(butter.id, margarine.id, { note: 'Frying only' });

    const subs = useGroceryStore.getState().itemSubs;
    expect(subs).toHaveLength(1);
    expect(subs[0].note).toBe('Frying only');
    // The stamp is what orders the list; an edit must not shuffle the row.
    expect(subs[0].createdAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('unlinkItemSub drops one direction and leaves the reverse alone', () => {
    const butter = makeItem({ name: 'Butter' });
    const margarine = makeItem({ name: 'Margarine' });
    seed([butter, margarine]);
    useGroceryStore.getState().linkItemSub(butter.id, margarine.id, { bothWays: true });

    useGroceryStore.getState().unlinkItemSub(butter.id, margarine.id);

    expect(useGroceryStore.getState().itemSubs).toEqual([
      expect.objectContaining({ itemId: margarine.id, subItemId: butter.id }),
    ]);
    expect(dbDeleteItemSubLink).toHaveBeenCalledWith(butter.id, margarine.id);
  });

  // ── Standing swaps (#1571) ────────────────────────────────────────────────

  it('linkItemSub writes the standing bit on the forward row only', () => {
    const milk = makeItem({ name: 'Milk' });
    const oat = makeItem({ name: 'Oat milk' });
    seed([milk, oat]);

    useGroceryStore.getState().linkItemSub(milk.id, oat.id, { bothWays: true, standing: true });

    const links = useGroceryStore.getState().itemSubs;
    expect(links.find(l => l.itemId === milk.id)!.standing).toBe(true);
    // Or the pair swaps into itself, and standingSwaps drops both.
    expect(links.find(l => l.itemId === oat.id)!.standing).toBe(false);
  });

  it('linkItemSub keeps one standing answer per item', () => {
    const milk = makeItem({ name: 'Milk' });
    const oat = makeItem({ name: 'Oat milk' });
    const soy = makeItem({ name: 'Soy milk' });
    seed([milk, oat, soy]);
    useGroceryStore.getState().linkItemSub(milk.id, oat.id, { standing: true });

    useGroceryStore.getState().linkItemSub(milk.id, soy.id, { standing: true });

    const links = useGroceryStore.getState().itemSubs;
    // Both substitutes are still recorded; only the rule moved.
    expect(links).toHaveLength(2);
    expect(links.find(l => l.subItemId === oat.id)!.standing).toBe(false);
    expect(links.find(l => l.subItemId === soy.id)!.standing).toBe(true);
    expect(dbSetItemSubLink).toHaveBeenCalledWith(
      expect.objectContaining({ subItemId: oat.id, standing: false })
    );
  });

  it('linkItemSub clears a standing rule pointing back the other way', () => {
    const milk = makeItem({ name: 'Milk' });
    const oat = makeItem({ name: 'Oat milk' });
    seed([milk, oat]);
    useGroceryStore.getState().linkItemSub(milk.id, oat.id, { standing: true });

    useGroceryStore.getState().linkItemSub(oat.id, milk.id, { standing: true });

    const links = useGroceryStore.getState().itemSubs;
    expect(links.find(l => l.itemId === milk.id)!.standing).toBe(false);
    expect(links.find(l => l.itemId === oat.id)!.standing).toBe(true);
  });

  it('setItemSubStanding turns a rule off without forgetting the substitute', () => {
    const milk = makeItem({ name: 'Milk' });
    const oat = makeItem({ name: 'Oat milk' });
    seed([milk, oat]);
    useGroceryStore.getState().linkItemSub(milk.id, oat.id, { standing: true, note: 'Keep' });

    useGroceryStore.getState().setItemSubStanding(milk.id, oat.id, false);

    expect(useGroceryStore.getState().itemSubs).toEqual([
      expect.objectContaining({ itemId: milk.id, subItemId: oat.id, standing: false, note: 'Keep' }),
    ]);
  });

  it('setItemSubStanding enforces the same one-per-item rule turning one on', () => {
    const milk = makeItem({ name: 'Milk' });
    const oat = makeItem({ name: 'Oat milk' });
    const soy = makeItem({ name: 'Soy milk' });
    seed([milk, oat, soy]);
    useGroceryStore.getState().linkItemSub(milk.id, oat.id, { standing: true });
    useGroceryStore.getState().linkItemSub(milk.id, soy.id);

    useGroceryStore.getState().setItemSubStanding(milk.id, soy.id, true);

    const links = useGroceryStore.getState().itemSubs;
    expect(links.find(l => l.subItemId === oat.id)!.standing).toBe(false);
    expect(links.find(l => l.subItemId === soy.id)!.standing).toBe(true);
  });

  it('setItemSubStanding is a no-op for a link that is not there', () => {
    const milk = makeItem({ name: 'Milk' });
    const oat = makeItem({ name: 'Oat milk' });
    seed([milk, oat]);

    useGroceryStore.getState().setItemSubStanding(milk.id, oat.id, true);

    expect(useGroceryStore.getState().itemSubs).toEqual([]);
  });

  it('setItemSubNote clears the note on a blank string', () => {
    const butter = makeItem({ name: 'Butter' });
    const margarine = makeItem({ name: 'Margarine' });
    seed([butter, margarine]);
    useGroceryStore.getState().linkItemSub(butter.id, margarine.id, { note: 'Frying only' });

    useGroceryStore.getState().setItemSubNote(butter.id, margarine.id, '   ');

    expect(useGroceryStore.getState().itemSubs[0].note).toBeNull();
  });

  it('deleting an item drops its links from both sides', () => {
    const butter = makeItem({ name: 'Butter' });
    const margarine = makeItem({ name: 'Margarine' });
    const oil = makeItem({ name: 'Olive oil' });
    seed([butter, margarine, oil]);
    useGroceryStore.getState().linkItemSub(butter.id, margarine.id);
    useGroceryStore.getState().linkItemSub(oil.id, margarine.id);

    useGroceryStore.getState().deleteItem(margarine.id);

    expect(useGroceryStore.getState().itemSubs).toEqual([]);
  });

  it('ensureCatalogItem mints an off-list catalog row, and finds an existing one', () => {
    seed([]);

    const created = useGroceryStore.getState().ensureCatalogItem('2 lb margarine');
    expect(created).toMatchObject({ name: 'margarine', onList: false });

    // Keyed on the parsed name, so a second spelling finds the same row rather
    // than minting one no purchase could ever match.
    const again = useGroceryStore.getState().ensureCatalogItem('Margarine');
    expect(again?.id).toBe(created?.id);
    expect(useGroceryStore.getState().items).toHaveLength(1);
  });

  it('ensureCatalogItem refuses a name that trims away', () => {
    seed([]);
    expect(useGroceryStore.getState().ensureCatalogItem('   ')).toBeNull();
    expect(useGroceryStore.getState().items).toEqual([]);
  });
});

// ─── swapForSubstitute (#1567) ──────────────────────────────────────────────

describe('swapForSubstitute', () => {
  it('puts the substitute on the list and takes the original off, carrying the quantity', () => {
    const tortillas = makeItem({ name: 'Tortillas', onList: true, quantity: '1 pack' });
    const corn = makeItem({ name: 'Corn tortillas', onList: false });
    seed([tortillas, corn], {
      itemSubs: [
        { itemId: tortillas.id, subItemId: corn.id, note: null, createdAt: '2020-01-01T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: false },
      ],
    });

    useGroceryStore.getState().swapForSubstitute(tortillas.id, corn.id);

    const items = useGroceryStore.getState().items;
    expect(items.find(i => i.id === tortillas.id)).toMatchObject({ onList: false, checked: false });
    expect(items.find(i => i.id === corn.id)).toMatchObject({ onList: true, checked: false, quantity: '1 pack' });
  });

  it("converts the quantity through the link's ratio", () => {
    const garlic = makeItem({ name: 'Garlic', onList: true, quantity: '3 cloves' });
    const powder = makeItem({ name: 'Garlic powder', onList: false });
    seed([garlic, powder], {
      itemSubs: [
        { itemId: garlic.id, subItemId: powder.id, note: null, createdAt: '2020-01-01T00:00:00.000Z', ratioFrom: '1 clove', ratioTo: '1/4 tsp', standing: false },
      ],
    });

    useGroceryStore.getState().swapForSubstitute(garlic.id, powder.id);

    expect(useGroceryStore.getState().items.find(i => i.id === powder.id)?.quantity).toBe('3/4 tsp');
  });

  it('carries the quantity verbatim when it will not convert through the ratio', () => {
    const butter = makeItem({ name: 'Butter', onList: true, quantity: 'a stick' });
    const margarine = makeItem({ name: 'Margarine', onList: false });
    seed([butter, margarine], {
      itemSubs: [
        { itemId: butter.id, subItemId: margarine.id, note: null, createdAt: '2020-01-01T00:00:00.000Z', ratioFrom: '100 g', ratioTo: '110 g', standing: false },
      ],
    });

    useGroceryStore.getState().swapForSubstitute(butter.id, margarine.id);

    expect(useGroceryStore.getState().items.find(i => i.id === margarine.id)?.quantity).toBe('a stick');
  });

  it('carries recipe ownership onto the swapped-in row, and clears it off the original', () => {
    const butter = makeItem({ name: 'Butter', onList: true, quantity: '3/4 cup', quantityFromRecipe: true });
    const margarine = makeItem({ name: 'Margarine', onList: false });
    seed([butter, margarine], {
      itemSubs: [
        { itemId: butter.id, subItemId: margarine.id, note: null, createdAt: '2020-01-01T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: false },
      ],
    });

    useGroceryStore.getState().swapForSubstitute(butter.id, margarine.id);

    expect(useGroceryStore.getState().items.find(i => i.id === margarine.id)).toMatchObject({
      quantity: '3/4 cup',
      quantityFromRecipe: true,
    });
    // Same rule removeFromList and finishShopping follow: a recipe-owned
    // quantity's claim ends with the row it was on.
    expect(useGroceryStore.getState().items.find(i => i.id === butter.id)).toMatchObject({
      quantity: null,
      quantityFromRecipe: false,
    });
  });

  it('leaves a hand-set quantity on the original — only a recipe-owned one clears', () => {
    const butter = makeItem({ name: 'Butter', onList: true, quantity: '2 sticks', quantityFromRecipe: false });
    const margarine = makeItem({ name: 'Margarine', onList: false });
    seed([butter, margarine], {
      itemSubs: [
        { itemId: butter.id, subItemId: margarine.id, note: null, createdAt: '2020-01-01T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: false },
      ],
    });

    useGroceryStore.getState().swapForSubstitute(butter.id, margarine.id);

    expect(useGroceryStore.getState().items.find(i => i.id === butter.id)?.quantity).toBe('2 sticks');
  });

  it('is a no-op unless the original is actually on the list', () => {
    const butter = makeItem({ name: 'Butter', onList: false });
    const margarine = makeItem({ name: 'Margarine', onList: false });
    seed([butter, margarine]);

    useGroceryStore.getState().swapForSubstitute(butter.id, margarine.id);

    expect(useGroceryStore.getState().items).toEqual([butter, margarine]);
    expect(dbUpdateGroceryItem).not.toHaveBeenCalled();
  });

  it('undo restores both rows exactly, including the un-swap', () => {
    const butter = makeItem({ name: 'Butter', onList: true, quantity: '2 sticks' });
    const margarine = makeItem({ name: 'Margarine', onList: false });
    seed([butter, margarine], {
      itemSubs: [
        { itemId: butter.id, subItemId: margarine.id, note: null, createdAt: '2020-01-01T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: false },
      ],
    });

    useGroceryStore.getState().swapForSubstitute(butter.id, margarine.id);
    useGroceryStore.getState().lastAction!.undo();

    const items = useGroceryStore.getState().items;
    expect(items.find(i => i.id === butter.id)).toEqual(butter);
    expect(items.find(i => i.id === margarine.id)).toEqual(margarine);
  });

  // It used to delete a never-bought original outright. That was the worst
  // instance of the old rule: the row being swapped away from is the one
  // holding the link that says what to swap it for.
  it('parks the original rather than deleting it, and undo puts it back', () => {
    const mysteryHerb = makeItem({ name: 'Mystery herb', onList: true });
    const basil = makeItem({ name: 'Basil', onList: false });
    seed([mysteryHerb, basil], {
      itemSubs: [
        { itemId: mysteryHerb.id, subItemId: basil.id, note: null, createdAt: '2020-01-01T00:00:00.000Z', ratioFrom: null, ratioTo: null, standing: false },
      ],
    });

    useGroceryStore.getState().swapForSubstitute(mysteryHerb.id, basil.id);
    expect(dbDeleteGroceryItem).not.toHaveBeenCalled();
    const after = useGroceryStore.getState().items;
    expect(after.find(i => i.id === mysteryHerb.id)!.onList).toBe(false);
    expect(after.find(i => i.id === basil.id)!.onList).toBe(true);

    useGroceryStore.getState().lastAction!.undo();
    const restored = useGroceryStore.getState().items;
    expect(restored.find(i => i.id === mysteryHerb.id)).toEqual(mysteryHerb);
    expect(restored.find(i => i.id === basil.id)).toEqual(basil);
  });
});

describe('linking a barcode to what it turned out to be', () => {
  const GTIN = '00850003201115';

  it('points the barcode at the box the scan resolved to', () => {
    const sausage = makeItem({ name: 'Sausage' });
    seed([sausage]);
    const box = useGroceryStore.getState().addProduct(sausage.id, {
      brand: 'Beyond Meat', variant: 'Cajun',
    })!;

    useGroceryStore.getState().linkScannedGtins([
      { gtin: GTIN, itemId: sausage.id, brand: 'Beyond Meat', variant: 'Cajun' },
    ]);

    expect(dbSetProductGtin).toHaveBeenCalledWith(box.id, GTIN);
    expect(useGroceryStore.getState().gtinProductFor(GTIN)?.id).toBe(box.id);
    expect(useGroceryStore.getState().gtinItemFor(GTIN)).toBe(sausage.id);
  });

  // The case the whole feature is for: rename the row to something that shares
  // nothing with what the barcode database calls it, and the link still holds.
  it('survives renaming the item out of all resemblance to the product name', () => {
    const sausage = makeItem({ name: 'Beyond plant based sausages Cajun' });
    seed([sausage]);
    useGroceryStore.getState().addProduct(sausage.id, { brand: 'Beyond Meat', variant: 'Cajun' });
    useGroceryStore.getState().linkScannedGtins([
      { gtin: GTIN, itemId: sausage.id, brand: 'Beyond Meat', variant: 'Cajun' },
    ]);

    useGroceryStore.getState().renameItem(sausage.id, 'vegan sausage');

    expect(useGroceryStore.getState().gtinItemFor(GTIN)).toBe(sausage.id);
    expect(useGroceryStore.getState().gtinProductFor(GTIN)).toMatchObject({
      brand: 'Beyond Meat',
      variant: 'Cajun',
    });
  });

  // An unfound barcode has no brand and no variant, so there is no box to
  // point at — and it is the code most worth remembering, since nothing about
  // it is ever going to improve on its own.
  it('remembers a barcode for a row that has no box at all', () => {
    const loose = makeItem({ name: 'Vegan sausage' });
    seed([loose]);

    useGroceryStore.getState().linkScannedGtins([
      { gtin: GTIN, itemId: loose.id, brand: null, variant: null },
    ]);

    expect(dbSetProductGtin).not.toHaveBeenCalled();
    expect(useGroceryStore.getState().gtinProductFor(GTIN)).toBeNull();
    expect(useGroceryStore.getState().gtinItemFor(GTIN)).toBe(loose.id);
  });

  it('falls back to the item when the box a barcode named is deleted', () => {
    const sausage = makeItem({ name: 'Sausage' });
    seed([sausage]);
    const box = useGroceryStore.getState().addProduct(sausage.id, { brand: 'Beyond Meat', variant: null })!;
    useGroceryStore.getState().linkScannedGtins([
      { gtin: GTIN, itemId: sausage.id, brand: 'Beyond Meat', variant: null },
    ]);

    useGroceryStore.getState().deleteProduct(box.id);

    expect(useGroceryStore.getState().gtinProductFor(GTIN)).toBeNull();
    expect(useGroceryStore.getState().gtinItemFor(GTIN)).toBe(sausage.id);
  });

  // The latest thing a person confirmed is what the code means, the same rule
  // the alias table applies to a phrase.
  it('moves a barcode when it is scanned onto a different row', () => {
    const sausage = makeItem({ name: 'Sausage' });
    const burger = makeItem({ name: 'Burger' });
    seed([sausage, burger]);
    const first = useGroceryStore.getState().addProduct(sausage.id, { brand: 'Beyond Meat', variant: null })!;
    useGroceryStore.getState().linkScannedGtins([
      { gtin: GTIN, itemId: sausage.id, brand: 'Beyond Meat', variant: null },
    ]);
    const second = useGroceryStore.getState().addProduct(burger.id, { brand: 'Beyond Meat', variant: null })!;
    useGroceryStore.getState().linkScannedGtins([
      { gtin: GTIN, itemId: burger.id, brand: 'Beyond Meat', variant: null },
    ]);

    expect(useGroceryStore.getState().gtinItemFor(GTIN)).toBe(burger.id);
    // The old box lets go in memory as well as in SQLite, or two rows would
    // claim one code until the next reload.
    const byId = Object.fromEntries(useGroceryStore.getState().itemProducts.map(p => [p.id, p.gtin]));
    expect(byId[first.id]).toBeNull();
    expect(byId[second.id]).toBe(GTIN);
  });

  it('says nothing about a barcode nobody has scanned', () => {
    seed([makeItem({ name: 'Sausage' })]);
    expect(useGroceryStore.getState().gtinItemFor(GTIN)).toBeNull();
    expect(useGroceryStore.getState().gtinItemFor(null)).toBeNull();
  });

  it('ignores a link naming a row that is not there', () => {
    seed([]);
    useGroceryStore.getState().linkScannedGtins([
      { gtin: GTIN, itemId: 'gone', brand: null, variant: null },
    ]);
    expect(useGroceryStore.getState().gtinItemFor(GTIN)).toBeNull();
  });

  // A barcode confirmed against a box that is now this box is exactly the
  // pointer a merge must not drop.
  it('keeps a barcode when its box is deduped into the survivor’s', () => {
    const survivor = makeItem({ name: 'Sausage' });
    const loser = makeItem({ name: 'Sausages' });
    seed([survivor, loser]);
    useGroceryStore.getState().addProduct(survivor.id, { brand: 'Beyond Meat', variant: null });
    const loserBox = useGroceryStore.getState().addProduct(loser.id, { brand: 'Beyond Meat', variant: null })!;
    useGroceryStore.getState().linkScannedGtins([
      { gtin: GTIN, itemId: loser.id, brand: 'Beyond Meat', variant: null },
    ]);
    expect(useGroceryStore.getState().gtinProductFor(GTIN)?.id).toBe(loserBox.id);

    useGroceryStore.getState().mergeItems(loser.id, survivor.id);

    // One box, under the survivor, still carrying the code.
    const boxes = useGroceryStore.getState().itemProducts;
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ itemId: survivor.id, gtin: GTIN });
    expect(useGroceryStore.getState().gtinItemFor(GTIN)).toBe(survivor.id);
  });
});

describe('addManyToPantry links the barcodes it was handed', () => {
  const GTIN = '00850003201115';

  it('links a row it mints, which had no id for the sheet to link', () => {
    seed([]);
    useGroceryStore.getState().addManyToPantry(
      ['Vegan sausage'],
      undefined,
      new Map([['Vegan sausage', { brand: 'Beyond Meat', variant: null, gtin: GTIN }]])
    );

    const minted = useGroceryStore.getState().items.find(i => i.name === 'Vegan sausage')!;
    expect(useGroceryStore.getState().gtinItemFor(GTIN)).toBe(minted.id);
    expect(useGroceryStore.getState().gtinProductFor(GTIN)).toMatchObject({ brand: 'Beyond Meat' });
  });

  it('links a barcode for a row with no box to hang it on', () => {
    seed([]);
    useGroceryStore.getState().addManyToPantry(
      ['Bananas'],
      undefined,
      new Map([['Bananas', { brand: null, variant: null, gtin: GTIN }]])
    );

    const minted = useGroceryStore.getState().items.find(i => i.name === 'Bananas')!;
    expect(useGroceryStore.getState().gtinItemFor(GTIN)).toBe(minted.id);
    expect(useGroceryStore.getState().itemProducts).toEqual([]);
  });
});

// ─── the pantry, one box at a time ──────────────────────────────────────────

describe('per-box pantry state', () => {
  /** An item with a box already on it, which is what these all start from. */
  function withBox(name = 'Bread', brand = "Arnold's") {
    const item = makeItem({ name });
    seed([item]);
    const box = useGroceryStore.getState().addProduct(item.id, { brand, variant: null })!;
    return { item, box };
  }

  it('marks one box on hand without touching its item', () => {
    const { item, box } = withBox();
    useGroceryStore.getState().setProductOnHandUntil(box.id, '2026-09-01T00:00:00.000Z');

    const stored = useGroceryStore.getState().itemProducts.find(p => p.id === box.id)!;
    expect(stored.onHandUntil).toBe('2026-09-01T00:00:00.000Z');
    expect(useGroceryStore.getState().items.find(i => i.id === item.id)!.onHandUntil).toBeNull();
    expect(dbSetItemProduct).toHaveBeenCalledWith(expect.objectContaining({ id: box.id }));
  });

  it('marks one box out and says nothing about its siblings', () => {
    const { item, box } = withBox();
    const other = useGroceryStore.getState().addProduct(item.id, { brand: 'Store brand', variant: null })!;

    expect(useGroceryStore.getState().markProductsOutOf([box.id])).toBe(1);

    const products = useGroceryStore.getState().itemProducts;
    expect(products.find(p => p.id === box.id)!.onHandUntil).toBe(OUT_OF_IT_UNTIL);
    expect(products.find(p => p.id === other.id)!.onHandUntil).toBeNull();
    expect(useGroceryStore.getState().items.find(i => i.id === item.id)!.onHandUntil).toBeNull();
  });

  it('reports nothing changed when the box is already out', () => {
    const { box } = withBox();
    useGroceryStore.getState().markProductsOutOf([box.id]);
    expect(useGroceryStore.getState().markProductsOutOf([box.id])).toBe(0);
  });

  it('undoes a box being marked out', () => {
    const { box } = withBox();
    useGroceryStore.getState().setProductOnHandUntil(box.id, '2026-09-01T00:00:00.000Z');
    useGroceryStore.getState().markProductsOutOf([box.id]);

    useGroceryStore.getState().lastAction!.undo();
    expect(useGroceryStore.getState().itemProducts.find(p => p.id === box.id)!.onHandUntil)
      .toBe('2026-09-01T00:00:00.000Z');
  });

  it('freezes one box and leaves its sibling out of the freezer', () => {
    const { item, box } = withBox();
    const other = useGroceryStore.getState().addProduct(item.id, { brand: 'Store brand', variant: null })!;

    useGroceryStore.getState().setProductFrozen(box.id, true);

    const products = useGroceryStore.getState().itemProducts;
    expect(products.find(p => p.id === box.id)!.frozenAt).toEqual(expect.any(String));
    expect(products.find(p => p.id === other.id)!.frozenAt).toBeNull();
    expect(useGroceryStore.getState().items.find(i => i.id === item.id)!.frozenAt).toBeNull();
  });

  it('restarts a thawed box from a fresh shelf life, read off its item', () => {
    // A shelf life is a fact about the food rather than the brand, so the box
    // thaws to the same day a purchase of the item would have stamped.
    const item = makeItem({ name: 'Chicken breast', shelfLifeDays: 3 });
    seed([item]);
    const box = useGroceryStore.getState().addProduct(item.id, { brand: 'Bell & Evans', variant: null })!;

    useGroceryStore.getState().setProductFrozen(box.id, true);
    useGroceryStore.getState().setProductFrozen(box.id, false);

    const stored = useGroceryStore.getState().itemProducts.find(p => p.id === box.id)!;
    expect(stored.frozenAt).toBeNull();
    expect(stored.expiresAt).toBe(expiryKeyFor(new Date(), 3));
  });

  it('is a no-op when the box is already in the state asked for', () => {
    const { box } = withBox();
    useGroceryStore.getState().setProductFrozen(box.id, true);
    const stamp = useGroceryStore.getState().itemProducts.find(p => p.id === box.id)!.frozenAt;
    useGroceryStore.getState().setProductFrozen(box.id, true);
    expect(useGroceryStore.getState().itemProducts.find(p => p.id === box.id)!.frozenAt).toBe(stamp);
  });

  it('re-dates an opened box off the open lexicon, leaving its item alone', () => {
    const item = makeItem({ name: 'Salsa' });
    seed([item]);
    const box = useGroceryStore.getState().addProduct(item.id, { brand: 'Herdez', variant: null })!;

    useGroceryStore.getState().setProductOpened(box.id, true);

    const stored = useGroceryStore.getState().itemProducts.find(p => p.id === box.id)!;
    expect(stored.openedAt).toEqual(expect.any(String));
    expect(stored.expiresAt).toBe(expiryKeyFor(new Date(), openShelfLifeDaysFor('Salsa')!));
    expect(useGroceryStore.getState().items.find(i => i.id === item.id)!.openedAt).toBeNull();
  });

  it('opens a box against its own sealed day, not its item\'s', () => {
    // expiresAtForOpening takes the earlier of the sealed day and the opened
    // one (#1943), so which sealed day it reads decides the answer — and the
    // packet being opened is the one whose deadline is at stake. The item here
    // has weeks left; this jar is nearly gone and must stay nearly gone.
    const item = makeItem({ name: 'Salsa', expiresAt: '2026-12-01', shelfLifeDays: 1 });
    seed([item]);
    const box = useGroceryStore.getState().addProduct(item.id, { brand: 'Herdez', variant: null })!;
    // A freeze and a thaw is how a box comes by a sealed day of its own — the
    // thaw restarts it from the item's shelf life, which is one day here.
    useGroceryStore.getState().setProductFrozen(box.id, true);
    useGroceryStore.getState().setProductFrozen(box.id, false);
    const soon = expiryKeyFor(new Date(), 1);
    expect(useGroceryStore.getState().itemProducts.find(p => p.id === box.id)!.expiresAt).toBe(soon);

    useGroceryStore.getState().setProductOpened(box.id, true);

    expect(useGroceryStore.getState().itemProducts.find(p => p.id === box.id)!.expiresAt).toBe(soon);
  });

  it('falls back to the item\'s sealed day for a box that has none', () => {
    const item = makeItem({ name: 'Salsa', expiresAt: expiryKeyFor(new Date(), 1) });
    seed([item]);
    const box = useGroceryStore.getState().addProduct(item.id, { brand: 'Herdez', variant: null })!;

    useGroceryStore.getState().setProductOpened(box.id, true);

    // The item's day is sooner than the open lexicon's week, so it wins.
    expect(useGroceryStore.getState().itemProducts.find(p => p.id === box.id)!.expiresAt)
      .toBe(item.expiresAt);
  });

  it('records the opening of a box the open lexicon has never heard of', () => {
    const item = makeItem({ name: 'Zorblax paste' });
    seed([item]);
    const box = useGroceryStore.getState().addProduct(item.id, { brand: 'Acme', variant: null })!;

    useGroceryStore.getState().setProductOpened(box.id, true);

    const stored = useGroceryStore.getState().itemProducts.find(p => p.id === box.id)!;
    expect(stored.openedAt).toEqual(expect.any(String));
    expect(stored.expiresAt).toBeNull();
  });

  it('clears the bought box\'s claims on a finished trip', () => {
    // The packet you froze is not the packet you just carried home — the same
    // correction the item row already gets.
    const item = makeItem({ name: 'Bread', onList: true, checked: true });
    seed([item]);
    const box = useGroceryStore.getState().addProduct(item.id, { brand: "Arnold's", variant: null })!;
    useGroceryStore.getState().setProductFrozen(box.id, true);
    useGroceryStore.getState().setProductOpened(box.id, true);
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([item.id]);

    useGroceryStore.getState().finishShopping();

    const stored = useGroceryStore.getState().itemProducts.find(p => p.id === box.id)!;
    expect(stored.frozenAt).toBeNull();
    expect(stored.openedAt).toBeNull();
    expect(stored.onHandUntil).toBeNull();
    expect(stored.purchaseCount).toBe(1);
  });

  it('puts the bought box back whole on undo', () => {
    const item = makeItem({ name: 'Bread', onList: true, checked: true });
    seed([item]);
    const box = useGroceryStore.getState().addProduct(item.id, { brand: "Arnold's", variant: null })!;
    useGroceryStore.getState().setProductFrozen(box.id, true);
    const frozenAt = useGroceryStore.getState().itemProducts.find(p => p.id === box.id)!.frozenAt;
    (dbFinishGroceryShopping as jest.Mock).mockReturnValue([item.id]);

    useGroceryStore.getState().finishShopping();
    useGroceryStore.getState().lastAction!.undo();

    const stored = useGroceryStore.getState().itemProducts.find(p => p.id === box.id)!;
    expect(stored.frozenAt).toBe(frozenAt);
    expect(stored.purchaseCount).toBe(0);
  });
});
