/**
 * The catalog tools against a real replica: the rules are the app's own
 * (`groceryItemWrite.ts`, `pantryWrite.ts`), so a stub replica would test the
 * stub. Undo is checked by feeding the entries a write left to the same plan
 * function the Activity screen uses.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import {
  createGroceryList,
  deleteGroceryItem,
  deleteGroceryList,
  finishGroceryTrip,
  getGroceryItem,
  grocerySetup,
  importReceipt,
  matchReceipt,
  renameGroceryList,
  resolveList,
  saveGroceryBox,
  saveStore,
  updateGroceryItem,
  addIngredientsToList,
  addChoiceToList,
  settleChoice,
  swapForSubstitute,
  clearGroceryList,
  setShoppingTrip,
  markUnavailable,
  setNutritionPanel,
  saveAisle,
  reorderAisles,
  updateStore,
  reorderGroceryPlaces,
  mergeGroceryItems,
} from '../groceryTools';
import { saveRecipe } from '../logTools';
import { addGroceryItem, listGroceryItems } from '../tools';
import { getPantryItem } from '../pantryTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

describe('the catalog tools', () => {
  let replica: ReturnType<typeof openReplica>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { agentRecordPlan } = require('../../../src/utils/agentRecordRevert') as typeof import('../../../src/utils/agentRecordRevert');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dbGetUnattendedLog } = require('../../../src/db/database') as typeof import('../../../src/db/database');

  const stateOf = (r: ReturnType<typeof openReplica>) => ({
    project: () => null,
    stack: () => null,
    person: () => null,
    groceryHome: (id: string) => {
      const e = r.groceryListEntries().find(x => x.itemId === id && x.listId === null);
      return e ? { checked: e.checked } : null;
    },
    groceryItem: (id: string) => r.groceryItems().find(i => i.id === id) ?? null,
    itemBoxes: (id: string) => r.itemProducts().filter(p => p.itemId === id),
    leftover: () => null,
    aisleOverride: (key: string) => r.aisleOverrides()[key] ?? null,
    itemKeyTaken: (key: string) => r.groceryItems().some(i => i.nameKey === key),
    exists: () => false,
    ruleList: () => [],
    hasNote: () => false,
    calendarRequest: () => null,
  });
  // Newest first by insertion order. Sorting on `at` alone is a coin flip when
  // two writes land in the same millisecond, which a fast run does: the add and
  // the change after it tie, and the comparator then picks either.
  const entries = () => {
    const ids = (mockRaw as unknown as { getAllSync: (sql: string) => { id: string }[] })
      .getAllSync("SELECT id FROM unattended_log WHERE subject = 'catalog' ORDER BY rowid DESC")
      .map(r => r.id);
    const byId = new Map(dbGetUnattendedLog().map(e => [e.id, e]));
    return ids.flatMap(id => (byId.has(id) ? [byId.get(id)!] : []));
  };

  beforeAll(() => {
    replica = openReplica(':memory:');
  });

  beforeEach(() => {
    for (const t of ['grocery_items', 'grocery_list_items', 'grocery_item_products', 'grocery_item_shops', 'grocery_item_subs', 'grocery_store_aliases', 'grocery_shops', 'grocery_lists', 'recipes', 'unattended_log']) {
      mockRaw.runSync(`DELETE FROM ${t}`);
    }
    // The remembered aisle filings live in settings, not in a grocery table: an
    // earlier test that re-filed "milk" otherwise hands the next one a filing
    // to start from, and forgetting it on the way back reads as a change.
    mockRaw.runSync("DELETE FROM settings WHERE key = 'grocery_aisle_overrides'");
    replica.refresh();
  });

  const idOf = (name: string) => replica.groceryItems().find(i => i.name.toLowerCase() === name.toLowerCase())!.id;

  describe('update_grocery_item', () => {
    it('moves an item to an aisle that exists, remembers it for the name, and says which aisles exist when it does not', () => {
      addGroceryItem(replica, 'milk');
      const aisle = replica.aisleNames().find(a => a !== replica.groceryItems()[0].aisle)!;
      const result = updateGroceryItem(replica, { name: 'milk', aisle });
      expect(result.item.aisle).toBe(aisle);
      expect(replica.aisleOverrides()[replica.groceryItems()[0].nameKey]).toBe(aisle);
      expect(() => updateGroceryItem(replica, { name: 'milk', aisle: 'Nowhere' })).toThrow(/aisles are/);
    });

    it('sets quantity, note and a price paired with the quantity, and clears the price with its stamp', () => {
      addGroceryItem(replica, 'milk');
      updateGroceryItem(replica, { name: 'milk', quantity: '1 gal', note: 'whole', priceMinor: 449 });
      const item = getGroceryItem(replica, { name: 'milk' });
      expect(item).toMatchObject({ quantity: '1 gal', note: 'whole', price: { minor: 449, quantity: '1 gal' } });
      updateGroceryItem(replica, { name: 'milk', priceMinor: null });
      expect(getGroceryItem(replica, { name: 'milk' }).price).toBeUndefined();
    });

    it('renames, moving the remembered aisle with it, and refuses a taken name', () => {
      addGroceryItem(replica, 'garbanzos');
      addGroceryItem(replica, 'chickpeas');
      const aisle = replica.aisleNames().find(a => a !== replica.groceryItems()[0].aisle)!;
      updateGroceryItem(replica, { name: 'garbanzos', aisle });
      const key = replica.groceryItems().find(i => i.name === 'garbanzos')!.nameKey;
      mockRaw.runSync(
        "INSERT INTO recipes (id, name, name_key, ingredients, steps, created_at) VALUES ('r1','Hummus','hummus',?, '[]', ?)",
        [JSON.stringify([{ id: 'i1', name: 'Garbanzos', nameKey: key, quantity: '1 can', section: null, choiceGroup: null, prep: null }]), new Date().toISOString()],
      );
      expect(() => updateGroceryItem(replica, { name: 'garbanzos', rename: 'Chickpeas' })).toThrow(/already an item/);
      updateGroceryItem(replica, { name: 'garbanzos', rename: 'Garbanzo beans' });
      expect(replica.groceryItems().some(i => i.name === 'Garbanzo beans')).toBe(true);
      const renamed = replica.groceryItems().find(i => i.name === 'Garbanzo beans')!;
      expect(replica.aisleOverrides()[key]).toBeUndefined();
      expect(replica.aisleOverrides()[renamed.nameKey]).toBe(aisle);
      // The recipe keeps its own wording and follows the item, and that
      // survives a reload (the key is re-read from the stored line).
      const line = replica.recipes().find(r => r.id === 'r1')!.ingredients[0];
      expect(line).toMatchObject({ name: 'Garbanzos', nameKey: renamed.nameKey });
    });

    it('links stores and substitutes, and removes them', () => {
      addGroceryItem(replica, 'butter');
      addGroceryItem(replica, 'margarine');
      const store = saveStore(replica, { name: 'Trader Joe\'s' });
      const result = updateGroceryItem(replica, {
        name: 'butter', linkStores: ['trader joes'], addSubstitutes: [{ name: 'margarine', ratioFrom: '1 cup', ratioTo: '1 cup', bothWays: true }],
      });
      expect(result.undoable).toBe(false);
      const detail = getGroceryItem(replica, { name: 'butter' });
      expect(detail.stores.map(s => s.name)).toEqual([store.name]);
      expect(detail.substitutes.map(s => s.name)).toEqual(['margarine']);
      expect(getGroceryItem(replica, { name: 'margarine' }).substitutes.map(s => s.name)).toEqual(['butter']);
      updateGroceryItem(replica, { name: 'butter', unlinkStores: [store.name], removeSubstitutes: ['margarine'] });
      expect(getGroceryItem(replica, { name: 'butter' })).toMatchObject({ stores: [], substitutes: [] });
    });

    it('offers an undo of an aisle edit that also forgets the remembered filing, only while the item is as left', () => {
      // The premise, stated rather than inherited from whichever test ran
      // before: "milk" already has a remembered filing, so the edit and the
      // undo each have one to move and to restore. Without it the way back
      // leaves a filing the start did not have, and never reads as undone.
      const remembered = replica.aisleNames()[0];
      mockRaw.runSync("INSERT OR REPLACE INTO settings (key, value) VALUES ('grocery_aisle_overrides', ?)", [JSON.stringify({ milk: remembered })]);
      replica.refresh();
      addGroceryItem(replica, 'milk');
      const original = replica.groceryItems()[0].aisle;
      const aisle = replica.aisleNames().find(a => a !== original)!;
      updateGroceryItem(replica, { name: 'milk', aisle });
      const entry = entries()[0];
      const plan = agentRecordPlan(entry, stateOf(replica));
      expect(plan).toMatchObject({ kind: 'restoreCatalogItem', patch: expect.objectContaining({ aisle: expect.any(String) }) });
      replica.updatePantryItem(replica.groceryItems()[0].id, { staple: true });
      // A field the entry did not record is not a conflict; the aisle still matches.
      expect(agentRecordPlan(entry, stateOf(replica)).kind).toBe('restoreCatalogItem');
      // A third aisle is neither the before nor the after.
      updateGroceryItem(replica, { name: 'milk', aisle: replica.aisleNames().find(a => a !== aisle && a !== original)! });
      expect(agentRecordPlan(entry, stateOf(replica))).toEqual({ kind: 'none', reason: 'Changed since' });
      // Back where it started reads as undone.
      updateGroceryItem(replica, { name: 'milk', aisle: original });
      expect(agentRecordPlan(entry, stateOf(replica))).toEqual({ kind: 'none', reason: 'Undone' });
    });
  });

  describe('save_grocery_box', () => {
    it('adds a brand (which becomes the preference), edits it, refuses a duplicate, and deletes it', () => {
      addGroceryItem(replica, 'bread');
      const first = saveGroceryBox(replica, { name: 'bread' }, { brand: 'Dave\'s', variant: '21 grain' });
      expect(getGroceryItem(replica, { name: 'bread' }).preferredBoxId).toBe(first.box!.id);
      const second = saveGroceryBox(replica, { name: 'bread' }, { brand: 'Arnold' });
      expect(() => saveGroceryBox(replica, { name: 'bread' }, { boxId: second.box!.id, brand: 'Dave\'s', variant: '21 grain' })).toThrow(/already has a box/);
      saveGroceryBox(replica, { name: 'bread' }, { boxId: second.box!.id, note: 'soft' });
      expect(getGroceryItem(replica, { name: 'bread' }).boxes.find(b => b.id === second.box!.id)?.note).toBe('soft');
      saveGroceryBox(replica, { name: 'bread' }, { boxId: first.box!.id, delete: true });
      expect(getGroceryItem(replica, { name: 'bread' }).preferredBoxId).toBeUndefined();
    });
  });

  describe('stores', () => {
    it('adds, renames and refuses a duplicate', () => {
      const shop = saveStore(replica, { name: 'Safeway', receiptStyle: 'none' });
      expect(shop.receiptStyle).toBe('none');
      expect(saveStore(replica, { store: 'safeway', name: 'Safeway Market' }).name).toBe('Safeway Market');
      saveStore(replica, { name: 'Costco' });
      expect(() => saveStore(replica, { store: 'Costco', name: 'Safeway Market' })).toThrow();
      expect(grocerySetup(replica).stores.map(s => s.name).sort()).toEqual(['Costco', 'Safeway Market']);
    });
  });

  describe('delete_grocery_item', () => {
    it('removes everything attached, and the snapshot plan puts it all back', () => {
      addGroceryItem(replica, 'butter');
      addGroceryItem(replica, 'margarine');
      saveStore(replica, { name: 'Costco' });
      saveGroceryBox(replica, { name: 'butter' }, { brand: 'Kerrygold' });
      updateGroceryItem(replica, { name: 'butter', linkStores: ['Costco'], priceMinor: 599, addSubstitutes: [{ name: 'margarine' }] });
      const id = idOf('butter');
      const result = deleteGroceryItem(replica, { name: 'butter' });
      expect(result.alsoRemoved).toMatchObject({ brands: 1, storeLinks: 1, substitutes: 1, listEntries: 1 });
      expect(replica.groceryItems().map(i => i.name)).toEqual(['margarine']);
      expect(replica.itemProducts()).toEqual([]);
      expect(replica.itemSubLinks()).toEqual([]);

      const entry = entries().find(e => e.action === 'cleared')!;
      const plan = agentRecordPlan(entry, stateOf(replica));
      expect(plan.kind).toBe('restoreDeletedItem');
      // Apply the snapshot the way the store does, through the same db calls.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const db = require('../../../src/db/database') as typeof import('../../../src/db/database');
      if (plan.kind !== 'restoreDeletedItem') throw new Error('unreachable');
      const snap = plan.snapshot;
      db.dbInsertGroceryItem(snap.item);
      db.dbUpdateGroceryItem(snap.item);
      for (const b of snap.boxes) db.dbSetItemProduct(b);
      for (const l of snap.shopLinks) db.dbSetItemShopLink(l);
      for (const l of snap.subLinks) db.dbSetItemSubLink(l);
      for (const e of snap.entries) db.dbSetGroceryListEntry(e);
      replica.refresh();
      const back = getGroceryItem(replica, { id });
      expect(back).toMatchObject({ name: 'butter', price: { minor: 599 } });
      expect(back.boxes).toHaveLength(1);
      expect(back.stores).toHaveLength(1);
      expect(back.substitutes.map(s => s.name)).toEqual(['margarine']);
      // Back in the catalog, so it can no longer be restored a second time.
      expect(agentRecordPlan(entry, stateOf(replica))).toEqual({ kind: 'none', reason: 'Added back since' });
    });
  });

  describe('separate lists', () => {
    it('creates one, takes items on it independently of home, and refuses the home name and duplicates', () => {
      const trip = createGroceryList(replica, 'Lake house');
      expect(() => createGroceryList(replica, 'lake house')).toThrow(/already/);
      expect(() => createGroceryList(replica, 'Groceries')).toThrow(/home/);
      addGroceryItem(replica, 'sunscreen', { listId: trip.id });
      addGroceryItem(replica, 'milk');
      expect(listGroceryItems(replica, { listId: trip.id }).map(i => i.name)).toEqual(['sunscreen']);
      expect(listGroceryItems(replica, {}).map(i => i.name)).toEqual(['milk']);
      expect(grocerySetup(replica).lists.map(l => `${l.name}:${l.items}`)).toEqual(['Groceries:1', 'Lake house:1']);
      expect(resolveList(replica, 'LAKE HOUSE')?.id).toBe(trip.id);
      expect(() => resolveList(replica, 'nope')).toThrow(/no list/);
      expect(renameGroceryList(replica, 'Lake house', 'Cabin').name).toBe('Cabin');
    });

    it('finishing a separate list records nothing but the unlisting, and finishing home records the purchase', () => {
      const trip = createGroceryList(replica, 'Lake house');
      addGroceryItem(replica, 'sunscreen', { listId: trip.id });
      addGroceryItem(replica, 'milk');
      replica.setGroceryChecked(idOf('sunscreen'), true, trip.id);
      replica.setGroceryChecked(idOf('milk'), true);
      const away = finishGroceryTrip(replica, { list: 'Lake house', prices: [{ name: 'sunscreen', priceMinor: 999 }] });
      expect(away).toMatchObject({ finished: ['sunscreen'], away: true });
      expect(getGroceryItem(replica, { name: 'sunscreen' })).toMatchObject({ lists: [] });
      expect(replica.groceryItems().find(i => i.name === 'sunscreen')).toMatchObject({ purchaseCount: 0, lastPriceMinor: null });

      saveStore(replica, { name: 'Costco' });
      const home = finishGroceryTrip(replica, { store: 'Costco', date: '2026-10-01', prices: [{ name: 'milk', priceMinor: 449 }] });
      expect(home).toMatchObject({ finished: ['milk'], away: false });
      expect(replica.groceryItems().find(i => i.name === 'milk')).toMatchObject({ purchaseCount: 1, lastPriceMinor: 449 });
      expect(getGroceryItem(replica, { name: 'milk' }).stores).toEqual([expect.objectContaining({ name: 'Costco', timesBought: 1 })]);
      expect(() => finishGroceryTrip(replica, { list: 'nope' })).toThrow(/no list/);
    });

    it('deleting a list unlists its items but keeps them in the catalog', () => {
      const trip = createGroceryList(replica, 'Lake house');
      addGroceryItem(replica, 'sunscreen', { listId: trip.id });
      expect(deleteGroceryList(replica, 'Lake house')).toMatchObject({ itemsTakenOff: 1 });
      expect(replica.groceryItems().map(i => i.name)).toEqual(['sunscreen']);
      expect(replica.groceryListEntries()).toEqual([]);
    });
  });

  describe('receipts', () => {
    it('matches by the app\'s tiers, and remembers a store\'s printed names for next time', () => {
      addGroceryItem(replica, 'milk');
      addGroceryItem(replica, 'eggs');
      saveStore(replica, { name: 'Safeway' });
      const lines = [
        { label: 'GV MLK 2% GAL', name: 'milk', priceMinor: 449 },
        { label: 'LRG EGGS DZ', name: 'eggs', priceMinor: 389 },
        { label: 'BANANAS', name: 'bananas', priceMinor: 99 },
      ];
      const read = matchReceipt(replica, { store: 'Safeway Store 1234', lines });
      expect(read.store?.name).toBe('Safeway');
      expect(read.lines[0].match).toMatchObject({ name: 'milk', confidence: 'exact' });
      expect(read.lines[2].match).toBeNull();

      const out = importReceipt(replica, {
        store: 'Safeway',
        date: '2026-10-01',
        lines: [
          { label: 'GV MLK 2% GAL', itemId: idOf('milk'), priceMinor: 449 },
          { label: 'LRG EGGS DZ', name: 'eggs', priceMinor: 389 },
          { label: 'BANANAS', name: 'bananas', priceMinor: 99 },
        ],
      });
      expect(out.finished.sort()).toEqual(['bananas', 'eggs', 'milk']);
      expect(out.lines.find(l => l.name === 'bananas')).toMatchObject({ created: true, aliasRemembered: false });
      expect(replica.groceryItems().find(i => i.name === 'milk')).toMatchObject({ purchaseCount: 1, lastPriceMinor: 449 });
      expect(replica.groceryListEntries()).toEqual([]);
      // The printed name is remembered for this store, so the next receipt matches it first.
      const again = matchReceipt(replica, { store: 'Safeway', scope: 'catalog', lines: [{ label: 'GV MLK 2% GAL', name: 'zzz unrelated' }] });
      expect(again.lines[0].match).toMatchObject({ name: 'milk', confidence: 'remembered' });
    });

    it('with finish false only checks the lines off, leaving the trip open', () => {
      addGroceryItem(replica, 'milk');
      const out = importReceipt(replica, { finish: false, lines: [{ label: 'MILK', itemId: idOf('milk'), priceMinor: 449 }] });
      expect(out.finished).toEqual([]);
      expect(listGroceryItems(replica, {})[0].checked).toBe(true);
      expect(replica.groceryItems()[0].purchaseCount).toBe(0);
    });

    it('the pantry flow marks things on hand and a new packet clears the old one\'s state, without recording a purchase', () => {
      addGroceryItem(replica, 'spinach');
      const id = idOf('spinach');
      replica.updatePantryItem(id, { opened: true, runningLow: true });
      expect(replica.groceryListEntries()).toHaveLength(1);
      importReceipt(replica, { context: 'pantry', lines: [{ label: 'SPINACH', itemId: id, priceMinor: 349, frozen: false }, { label: 'RICE 5LB', name: 'rice' }] });
      const spinach = getPantryItem(replica, { id });
      expect(spinach.status).toBe('on_hand');
      expect(spinach.openedAt).toBeUndefined();
      expect(spinach.runningLowAt).toBeUndefined();
      expect(replica.groceryListEntries()).toEqual([]);
      expect(replica.groceryItems().find(i => i.name === 'spinach')).toMatchObject({ purchaseCount: 0, lastPriceMinor: 349 });
      expect(getPantryItem(replica, { name: 'rice' }).status).toBe('on_hand');
    });

    it('refuses a line with neither an item nor a name, and an empty receipt', () => {
      expect(() => importReceipt(replica, { lines: [{ label: 'WHAT' }] })).toThrow(/needs an itemId or a name/);
      expect(() => importReceipt(replica, { lines: [] })).toThrow(/at least one/);
      expect(replica.groceryItems()).toEqual([]);
    });
  });

  describe('the list and its structure', () => {
    const onHome = () => replica.groceryListEntries().filter(e => e.listId === null).map(e => replica.groceryItems().find(i => i.id === e.itemId)!.name.toLowerCase());

    it('adds a recipe\'s ingredients, skipping one already in the cart', () => {
      const recipe = saveRecipe(replica, { name: 'Soup', ingredients: [{ text: '2 onions' }, { text: '1 cup lentils' }] });
      const first = addIngredientsToList(replica, { recipeId: recipe.id });
      expect(first.added.map(n => n.toLowerCase()).sort()).toEqual(expect.arrayContaining([expect.stringMatching(/onion/), expect.stringMatching(/lentil/)]));
      const onion = replica.groceryItems().find(i => /onion/i.test(i.name))!;
      replica.setGroceryChecked(onion.id, true, null);
      const again = addIngredientsToList(replica, { recipeId: recipe.id });
      expect(again.added).toEqual([]);
      expect(again.inCart.concat(again.leftOff.filter(l => l.why === 'already in the cart').map(l => l.name)).join(' ')).toMatch(/onion/i);
      expect(() => addIngredientsToList(replica, { recipeId: recipe.id, include: ['saffron'] })).toThrow(/Not among the ingredients/);
    });

    it('adds an either/or, and settles it by keeping one', () => {
      addChoiceToList(replica, { options: [{ name: 'butter' }, { name: 'margarine' }] });
      expect(onHome().sort()).toEqual(['butter', 'margarine']);
      expect(settleChoice(replica, { item: 'butter' })).toEqual({ kept: ['butter'], removed: ['margarine'] });
      expect(onHome()).toEqual(['butter']);
      expect(() => settleChoice(replica, { item: 'butter' })).toThrow(/not one of an either\/or/);
    });

    it('swaps an item for its substitute and clears the list', () => {
      addGroceryItem(replica, 'margarine');
      replica.removeFromGroceryList(idOf('margarine'), null);
      addGroceryItem(replica, 'butter');
      updateGroceryItem(replica, { name: 'butter', addSubstitutes: [{ name: 'margarine' }] });
      expect(swapForSubstitute(replica, { item: 'butter', substitute: 'margarine' })).toMatchObject({ removed: 'butter', added: 'margarine' });
      expect(onHome()).toEqual(['margarine']);
      expect(clearGroceryList(replica, {}).cleared).toBe(1);
      expect(onHome()).toEqual([]);
    });

    it('starts a trip with a budget, changes it and ends it', () => {
      saveStore(replica, { name: 'Safeway' });
      expect(setShoppingTrip(replica, { store: 'Safeway', budget: 80 }).trip).toMatchObject({ store: 'Safeway', budget: 80 });
      expect(grocerySetup(replica).trip).toMatchObject({ store: 'Safeway', budgetMinor: 8000 });
      expect(setShoppingTrip(replica, { budget: null }).trip).not.toHaveProperty('budget');
      expect(setShoppingTrip(replica, { end: true }).trip).toBeNull();
      expect(() => setShoppingTrip(replica, { budget: 10 })).toThrow(/No trip/);
    });

    it('marks an item unavailable at a store, and takes it back', () => {
      saveStore(replica, { name: 'Safeway' });
      addGroceryItem(replica, 'tahini');
      markUnavailable(replica, { item: 'tahini', store: 'Safeway' });
      expect(getGroceryItem(replica, { name: 'tahini' }).stores[0]).toMatchObject({ name: 'Safeway', unavailable: true });
      markUnavailable(replica, { item: 'tahini', store: 'Safeway', unavailable: false });
      expect(getGroceryItem(replica, { name: 'tahini' }).stores[0]?.unavailable).toBeUndefined();
    });

    it('sets and removes a nutrition panel, refusing a nutrient the app does not keep', () => {
      addGroceryItem(replica, 'oats');
      expect(setNutritionPanel(replica, { item: 'oats', panel: { basis: 'per100g', amounts: { calorieKcal: 379, proteinG: 13 } } }).panel).toMatch(/379 cal/);
      expect(replica.groceryItems().find(i => i.id === idOf('oats'))!.nutrition).toMatchObject({ source: 'manual', basis: 'per100g' });
      expect(() => setNutritionPanel(replica, { item: 'oats', panel: { basis: 'per100g', amounts: { vibes: 3 } } })).toThrow(/isn't a nutrient/);
      setNutritionPanel(replica, { item: 'oats', panel: null });
      expect(replica.groceryItems().find(i => i.id === idOf('oats'))!.nutrition).toBeNull();
    });

    it('adds, renames, marks non-food, orders and deletes an aisle, refiling its items', () => {
      expect(saveAisle(replica, { name: 'Bulk bins' }).aisles).toContain('Bulk bins');
      addGroceryItem(replica, 'quinoa');
      updateGroceryItem(replica, { name: 'quinoa', aisle: 'Bulk bins' });
      expect(saveAisle(replica, { name: 'bulk bins', newName: 'Bulk' }).itemsMoved).toBe(1);
      expect(replica.groceryItems().find(i => i.id === idOf('quinoa'))!.aisle).toBe('Bulk');
      expect(reorderAisles(replica, ['Bulk']).aisles[0]).toBe('Bulk');
      saveAisle(replica, { name: 'Bulk', nonFood: true });
      expect(grocerySetup(replica).nonFoodAisles).toEqual(['Bulk']);
      saveAisle(replica, { name: 'Bulk', delete: true });
      expect(replica.groceryItems().find(i => i.id === idOf('quinoa'))!.aisle).toBe('Other');
      expect(() => saveAisle(replica, { name: 'Other', delete: true })).toThrow(/cannot be deleted/);
    });

    it('sets a store\'s own settings, orders stores, and deletes one', () => {
      saveStore(replica, { name: 'Safeway' });
      saveStore(replica, { name: 'Costco' });
      expect(updateStore(replica, { store: 'Costco', excludeFromSuggestions: true }).store).toMatchObject({ excludedFromSuggestions: true });
      expect(reorderGroceryPlaces(replica, { stores: ['Costco'] }).stores[0].name).toBe('Costco');
      expect(updateStore(replica, { store: 'Costco', delete: true }).deleted).toBe('Costco');
      expect(grocerySetup(replica).stores.map(st => st.name)).toEqual(['Safeway']);
    });

    it('merges two items into one, moving its list place and recipe lines', () => {
      addGroceryItem(replica, 'cilantro');
      addGroceryItem(replica, 'coriander');
      replica.removeFromGroceryList(idOf('coriander'), null);
      saveRecipe(replica, { name: 'Salsa', ingredients: [{ text: '1 bunch cilantro' }] });
      const result = mergeGroceryItems(replica, { from: 'cilantro', into: 'coriander' });
      expect(result.gone.toLowerCase()).toBe('cilantro');
      expect(replica.groceryItems().some(i => i.name.toLowerCase() === 'cilantro')).toBe(false);
      expect(onHome()).toEqual(['coriander']);
      expect(replica.recipes().find(r => r.name === 'Salsa')!.ingredients[0].nameKey).toBe(replica.groceryItems().find(i => i.name.toLowerCase() === 'coriander')!.nameKey);
    });
  });
});
