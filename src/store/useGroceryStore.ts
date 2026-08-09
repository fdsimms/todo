import { create } from 'zustand';
import type { GroceryItem, ItemShopLink, Shop } from '../types';
import {
  dbGetAllGroceryItems,
  dbInsertGroceryItem,
  dbUpdateGroceryItem,
  dbDeleteGroceryItem,
  dbFinishGroceryShopping,
  dbClearGroceryList,
  dbGetGroceryAisleOrder,
  dbSetGroceryAisleOrder,
  dbGetAllGroceryShops,
  dbInsertGroceryShop,
  dbUpdateGroceryShop,
  dbDeleteGroceryShop,
  dbGetAllItemShopLinks,
  dbSetItemShopLink,
  dbDeleteItemShopLink,
  dbGetLastShopId,
  dbSetLastShopId,
  dbGetGroceryAisleOverrides,
  dbSetGroceryAisleOverrides,
  dbGetGroceryHiddenAisles,
  dbSetGroceryHiddenAisles,
  dbTransaction,
} from '../db/database';
import { useRecipeStore } from './useRecipeStore';
import { generateId } from '../utils/id';
import { groceryNameKey, parseGroceryInput, splitGroceryLines } from '../utils/groceryParse';
import { defaultOnHandUntil } from '../utils/grocerySuggest';
import {
  aisleForName,
  normalizeAisleOrder,
  hiddenDefaultAisles,
  placeAisle,
  rememberAisles,
  remapRememberedAisle,
  forgetRememberedAisle,
  renameRememberedAisle,
  OTHER_AISLE,
} from '../utils/groceryAisles';

/**
 * The grocery catalog, which is also the shopping list.
 *
 * One array of rows: `onList` decides what's on the list right now, and a row
 * that comes off the list stays in memory as catalog. Adding a name that's
 * already known flips `onList` instead of inserting — that single behaviour
 * (addByName below) is what gives autocomplete, Buy again and dedupe.
 *
 * `inCatalog` is the second axis, and it's what stops the catalog filling with
 * things that were never really yours: a name typed for the first time is
 * provisional, so taking it straight back off the list deletes it, while
 * finishing or clearing a trip promotes what was on it. A row that was already
 * catalog before this stint on the list is never touched by that — "remove"
 * means remove from the list, exactly as it always did.
 *
 * Same discipline as every other store here: write to SQLite first, then set().
 */

/**
 * How long a checked row stays struck-through in its own aisle before sinking
 * into "In cart". Long enough to see the tap land where your eye already is,
 * short enough not to feel stuck.
 */
const CART_HOLD_MS = 1200;

// One shared timer, re-armed by each tap, exactly like armCompletionCollapse
// in useTaskStore — so a burst of checks sinks together instead of dribbling
// down one row at a time.
let cartHoldTimer: ReturnType<typeof setTimeout> | null = null;

function armCartHold(): void {
  if (cartHoldTimer) clearTimeout(cartHoldTimer);
  cartHoldTimer = setTimeout(() => {
    cartHoldTimer = null;
    if (useGroceryStore.getState().cartHoldIds.length > 0) {
      useGroceryStore.setState({ cartHoldIds: [] });
    }
  }, CART_HOLD_MS);
  // Without this, jest's node env hangs on the live handle at the end of a run.
  (cartHoldTimer as unknown as { unref?: () => void }).unref?.();
}

interface GroceryStore {
  items: GroceryItem[];
  aisleOrder: string[];
  /**
   * Built-in aisles the user has deleted or renamed away. Kept because the walk
   * order is repaired against DEFAULT_AISLES at read time, which would
   * otherwise undo the delete — see normalizeAisleOrder. Derived from the saved
   * order rather than edited directly, so the two can't disagree.
   */
  hiddenAisles: string[];
  /**
   * The places you shop, and which items have been bought at each. They live
   * here rather than in a store of their own for the reason aisleOrder does:
   * they're grocery configuration read by the same screens, and a
   * `useGroceryShopStore` sitting next to `useGroceryStore` is a name nobody
   * would reliably pick between.
   */
  shops: Shop[];
  itemShops: ItemShopLink[];
  /** The store the last trip was finished at, if it still exists. */
  lastShopId: string | null;
  /**
   * name_key → the aisle the user last filed that item under. Consulted ahead
   * of the lexicon when a row is created, so a correction sticks even after the
   * row it was made on is gone. See rememberAisles.
   */
  aisleOverrides: Record<string, string>;
  /** Checked rows still holding their place in their own aisle. */
  cartHoldIds: string[];
  initialized: boolean;

  initialize: () => void;

  /**
   * Parse a typed line and put it on the list — creating the catalog row only
   * if it's new. `override` skips parseGroceryInput entirely and uses the
   * given name/quantity as-is — for GroceryAddField's per-token × button,
   * where the user has already decided which pieces of what they typed count
   * as quantity versus name and re-parsing `raw` would just reproduce the
   * split they rejected.
   */
  addByName: (raw: string, override?: { name: string; quantity: string | null }) => GroceryItem;
  /** A pasted block, one item per line. */
  addManyFromText: (raw: string) => { added: GroceryItem[]; alreadyOnList: GroceryItem[] };
  addExisting: (id: string) => void;
  addExistingMany: (ids: string[]) => void;
  /**
   * Puts a reviewed set of planned rows — currently a recipe's ingredients —
   * onto the list in one transaction. See the implementation for why this isn't
   * just a loop over addByName at the call site.
   */
  addFromPlan: (rows: readonly PlannedRow[]) => PlanAddResult;

  toggleChecked: (id: string) => void;
  /** toggleChecked's invariant (checked implies onList), applied to a whole selection at once. */
  setCheckedMany: (ids: string[], checked: boolean) => void;
  setQuantity: (id: string, quantity: string | null) => void;
  setAisle: (id: string, aisle: string) => void;
  setAisleMany: (assignments: Record<string, string>) => void;
  /** False when the new name collides with another catalog row. */
  renameItem: (id: string, name: string) => boolean;
  setNote: (id: string, note: string) => void;
  toggleFavorite: (id: string) => void;
  /**
   * The pantry override — "Got it" / "Out of it" on GroceryItemSheet. A dumb
   * setter, same as setQuantity/setNote: the caller decides the value
   * (defaultOnHandUntil for "Got it", a past timestamp for "Out of it", or
   * null to clear back to grocerySuggest.probablyHaveReason's own guess).
   */
  setOnHandUntil: (id: string, until: string | null) => void;

  removeFromList: (id: string) => void;
  /** removeFromList over a whole selection at once. */
  removeFromListMany: (ids: string[]) => void;
  deleteItem: (id: string) => void;
  deleteItems: (ids: string[]) => void;

  /**
   * Ends the trip: everything checked comes off the list and counts as bought.
   * Returns how many. `shopId` is optional — null records the purchase without
   * a place, exactly as every trip did before stores existed.
   */
  finishShopping: (shopId?: string | null) => number;
  /** Abandons the trip: everything comes off the list, nothing counts as bought. */
  clearList: () => number;

  /**
   * Commit a drag on the list: each row's new rank in the walk order and the
   * aisle it was dropped into. One action rather than a reorder plus a
   * setAisleMany, because a drop decides both at once (see resolveGroceryDrop)
   * and two writes would leave a frame where the item had moved but not moved
   * aisle.
   */
  applyDrop: (placements: Array<{ id: string; sortOrder: number; aisle: string }>) => void;

  setAisleOrder: (order: string[]) => void;
  /**
   * Creates an aisle at the end of the walk order. Returns the canonical name —
   * the existing one when it's already there, so callers can select it either
   * way — or null when the name is empty.
   */
  addAisle: (name: string) => string | null;
  /**
   * Renames an aisle everywhere it's recorded: the walk order, every row filed
   * there, and every remembered filing that pointed at it. False when the name
   * is blank, taken, or the aisle can't be renamed ('Other').
   */
  renameAisle: (from: string, to: string) => boolean;
  /**
   * Deletes an aisle and files everything that was in it under 'Other'. A
   * no-op for 'Other' itself, which is the floor every unrecognised item lands
   * on and so has to exist.
   */
  deleteAisle: (aisle: string) => void;

  /** Null when the name collides with an existing store. */
  addShop: (name: string) => Shop | null;
  renameShop: (id: string, name: string) => boolean;
  reorderShops: (ids: string[]) => void;
  deleteShop: (id: string) => void;
  /** Assert "this item is available here" without a purchase behind it. */
  linkItemShop: (itemId: string, shopId: string) => void;
  unlinkItemShop: (itemId: string, shopId: string) => void;
  setLastShopId: (id: string | null) => void;

  itemByNameKey: (key: string) => GroceryItem | null;
  itemById: (id: string) => GroceryItem | null;
  /** The aisle the user has filed this name under before, if any. */
  rememberedAisleFor: (name: string) => string | null;
}

function nextSortOrder(items: GroceryItem[]): number {
  return items.reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1;
}

/** One reviewed line on its way to the list. `aisle` null means "no opinion". */
export interface PlannedRow {
  name: string;
  quantity: string | null;
  aisle: string | null;
}

export interface PlanAddResult {
  /** Rows that weren't on the list and now are — new catalog rows and re-listed ones alike. */
  added: GroceryItem[];
  /** Already on the list and left exactly as they were. */
  alreadyOnList: GroceryItem[];
  /**
   * Already in the trolley, and deliberately untouched. THIS IS THE WHOLE
   * REASON THIS FUNCTION EXISTS rather than a loop over addByName at the call
   * site: addByName sets `checked: false` on a row it finds, so adding a
   * recipe while standing in the shop would quietly pull things back *out* of
   * the trolley, one row at a time, with nothing on screen to say so. Checked
   * rows are reported and skipped.
   */
  skippedInCart: GroceryItem[];
}

/**
 * Saves a walk order and the tombstones that go with it.
 *
 * The hidden set is *derived from the order being saved* — whatever the caller
 * left out is a deletion — so there's no second thing to keep in step, and
 * re-adding a deleted built-in by name simply un-hides it.
 */
function commitAisleOrder(order: string[], used: readonly string[]) {
  const hidden = hiddenDefaultAisles(order);
  const normalized = normalizeAisleOrder(order, used, hidden);
  dbSetGroceryAisleOrder(normalized);
  dbSetGroceryHiddenAisles(hidden);
  return { aisleOrder: normalized, hiddenAisles: hidden };
}

export const useGroceryStore = create<GroceryStore>((set, get) => ({
  items: [],
  aisleOrder: [],
  hiddenAisles: [],
  shops: [],
  itemShops: [],
  lastShopId: null,
  aisleOverrides: {},
  cartHoldIds: [],
  initialized: false,

  initialize() {
    const items = dbGetAllGroceryItems();
    // Repaired at read time and deliberately NOT written back: shipping a
    // bigger DEFAULT_AISLES later then needs no migration, and can't clobber
    // an order someone arranged to match their store.
    const hiddenAisles = dbGetGroceryHiddenAisles();
    const aisleOrder = normalizeAisleOrder(
      dbGetGroceryAisleOrder(),
      items.map(i => i.aisle),
      hiddenAisles
    );
    const shops = dbGetAllGroceryShops();
    const itemShops = dbGetAllItemShopLinks();
    // Resolved against live shops rather than trusted: the setting outlives
    // the store it names, and a preselected shop that no longer exists would
    // record the next trip against nothing.
    const storedLast = dbGetLastShopId();
    const lastShopId = shops.some(s => s.id === storedLast) ? storedLast : null;
    if (cartHoldTimer) {
      clearTimeout(cartHoldTimer);
      cartHoldTimer = null;
    }
    set({
      items,
      aisleOrder,
      hiddenAisles,
      aisleOverrides: dbGetGroceryAisleOverrides(),
      shops,
      itemShops,
      lastShopId,
      cartHoldIds: [],
      initialized: true,
    });
  },

  /**
   * The whole product insight, in one function. A name we already know is put
   * back on the list; only a genuinely new one inserts a row. That's why
   * there's never a duplicate, why autocomplete has history to rank, and why
   * next week's list starts from what you actually buy.
   */
  addByName(raw, override) {
    const { name, quantity } = override ?? parseGroceryInput(raw);
    // A name with no letters or digits ("???") normalises to an empty key.
    // Falling back to the raw text keeps the key unique, which matters: two
    // such rows would collide on the UNIQUE index and the *second* insert
    // would throw out of whatever was calling — a paste, or the Reminders
    // drain mid-batch.
    const key = groceryNameKey(name) || name.trim().toLowerCase();
    const now = new Date().toISOString();
    const existing = key ? get().items.find(i => i.nameKey === key) : undefined;

    if (existing) {
      const updated: GroceryItem = {
        ...existing,
        // The typed name wins — capitalisation and wording are the user's.
        name: name || existing.name,
        onList: true,
        checked: false,
        // Only overwrite the quantity when this add actually carried one;
        // typing "milk" to re-add shouldn't wipe the "2 gal" set last week.
        quantity: quantity ?? existing.quantity,
        lastAddedAt: now,
      };
      dbUpdateGroceryItem(updated);
      set(s => ({
        items: s.items.map(i => (i.id === existing.id ? updated : i)),
        cartHoldIds: s.cartHoldIds.filter(x => x !== existing.id),
      }));
      return updated;
    }

    const item: GroceryItem = {
      id: generateId(),
      name,
      nameKey: key,
      // Where the user put it last time beats where the lexicon thinks it
      // goes — the lexicon is a guess about groceries, this is a fact about
      // their shop. (An item still in the catalog never reaches here: it
      // carries its own aisle, and the branch above keeps it.)
      //
      // placeAisle has the last word because neither source knows which aisles
      // still exist: naming a deleted one here would bring its section back.
      aisle: placeAisle(get().aisleOverrides[key] ?? aisleForName(name), get().aisleOrder),
      quantity,
      note: '',
      onList: true,
      checked: false,
      // Provisional: a name nobody has bought, starred or finished a trip with
      // is on the list, not in the catalog. removeFromList deletes it.
      inCatalog: false,
      sortOrder: nextSortOrder(get().items),
      favorite: false,
      purchaseCount: 0,
      lastAddedAt: now,
      lastPurchasedAt: null,
      createdAt: now,
      onHandUntil: null,
    };
    dbInsertGroceryItem(item);
    set(s => ({ items: [...s.items, item] }));
    return item;
  },

  addManyFromText(raw) {
    const lines = splitGroceryLines(raw);
    const added: GroceryItem[] = [];
    const alreadyOnList: GroceryItem[] = [];
    for (const line of lines) {
      const key = groceryNameKey(parseGroceryInput(line).name);
      const before = key ? get().items.find(i => i.nameKey === key) : undefined;
      const wasOnList = before?.onList === true;
      const item = get().addByName(line);
      if (wasOnList) alreadyOnList.push(item);
      else added.push(item);
    }
    return { added, alreadyOnList };
  },

  addExisting(id) {
    get().addExistingMany([id]);
  },

  addExistingMany(ids) {
    const wanted = new Set(ids);
    const now = new Date().toISOString();
    const updates: GroceryItem[] = [];
    let order = nextSortOrder(get().items);

    for (const item of get().items) {
      if (!wanted.has(item.id) || item.onList) continue;
      updates.push({ ...item, onList: true, checked: false, lastAddedAt: now, sortOrder: order++ });
    }
    if (updates.length === 0) return;

    for (const u of updates) dbUpdateGroceryItem(u);
    const byId = new Map(updates.map(u => [u.id, u]));
    set(s => ({ items: s.items.map(i => byId.get(i.id) ?? i) }));
  },

  /**
   * The recipe → list path, and the one place a plan is allowed to write to the
   * catalog. It lives here rather than in the recipe store for the same reason
   * finishShopping does: this store owns the inCatalog promotion rule,
   * nextSortOrder, placeAisle and the aisle-order normalisation, and a caller
   * reaching around them would get all four subtly wrong.
   *
   * Three differences from a loop over addByName, each load-bearing:
   *   1. a row already in the trolley is skipped, not un-checked (see
   *      PlanAddResult.skippedInCart);
   *   2. a quantity the user set by hand is never overwritten — only a row this
   *      call actually adds takes the plan's quantity;
   *   3. an aisle the user has filed by hand always wins over the plan's guess,
   *      the same precedence addByName gives aisleOverrides over the lexicon.
   */
  addFromPlan(rows) {
    const added: GroceryItem[] = [];
    const alreadyOnList: GroceryItem[] = [];
    const skippedInCart: GroceryItem[] = [];

    // One transaction rather than N: a ten-ingredient recipe is ten inserts and
    // as many updates, and a half-applied recipe is a worse outcome than a
    // failed one. Same shape as applyTemplate's single dbTransaction.
    dbTransaction(() => {
      for (const row of rows) {
        const key = groceryNameKey(row.name);
        const existing = key ? get().items.find(i => i.nameKey === key) : undefined;

        if (existing?.checked) { skippedInCart.push(existing); continue; }
        if (existing?.onList) { alreadyOnList.push(existing); continue; }

        // Passing the bare name, not "2 lb chicken thighs": the quantity is
        // already split out on the ingredient, and re-parsing it here would
        // run the guesswork twice.
        const item = get().addByName(row.name);
        if (row.aisle && !get().rememberedAisleFor(row.name)) get().setAisle(item.id, row.aisle);
        if (row.quantity) get().setQuantity(item.id, row.quantity);
        added.push(get().itemById(item.id) ?? item);
      }
    });

    return { added, alreadyOnList, skippedInCart };
  },

  toggleChecked(id) {
    const item = get().items.find(i => i.id === id);
    // The checked ⇒ onList invariant: an off-list row has nothing to check.
    if (!item || !item.onList) return;

    const updated = { ...item, checked: !item.checked };
    dbUpdateGroceryItem(updated);
    set(s => ({
      items: s.items.map(i => (i.id === id ? updated : i)),
      cartHoldIds: updated.checked
        ? [...s.cartHoldIds.filter(x => x !== id), id]
        // Un-checking inside the hold window just drops it — the row was
        // never going to sink, so nothing has to animate back.
        : s.cartHoldIds.filter(x => x !== id),
    }));
    if (updated.checked) armCartHold();
  },

  setCheckedMany(ids, checked) {
    if (ids.length === 0) return;
    const wanted = new Set(ids);
    const updates: GroceryItem[] = [];
    for (const item of get().items) {
      // Same invariant as toggleChecked: an off-list row has nothing to check.
      if (!wanted.has(item.id) || !item.onList || item.checked === checked) continue;
      updates.push({ ...item, checked });
    }
    if (updates.length === 0) return;

    for (const u of updates) dbUpdateGroceryItem(u);
    const byId = new Map(updates.map(u => [u.id, u]));
    set(s => ({
      items: s.items.map(i => byId.get(i.id) ?? i),
      cartHoldIds: checked
        ? [...s.cartHoldIds.filter(x => !byId.has(x)), ...updates.map(u => u.id)]
        // Un-checking inside the hold window just drops it, same as toggleChecked.
        : s.cartHoldIds.filter(x => !byId.has(x)),
    }));
    if (checked) armCartHold();
  },

  setQuantity(id, quantity) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    const trimmed = quantity?.trim() ?? '';
    const updated = { ...item, quantity: trimmed || null };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  setAisle(id, aisle) {
    get().setAisleMany({ [id]: aisle });
  },

  setAisleMany(assignments) {
    const updates: GroceryItem[] = [];
    for (const item of get().items) {
      const aisle = assignments[item.id];
      if (!aisle || aisle === item.aisle) continue;
      updates.push({ ...item, aisle });
    }
    if (updates.length === 0) return;

    for (const u of updates) dbUpdateGroceryItem(u);
    // Every call here is a deliberate filing — the item sheet's picker, or a
    // reviewed-and-accepted AI tidy — so it's what gets remembered for the
    // next time this name is typed.
    const remembered = rememberAisles(get().aisleOverrides, updates);
    if (remembered) dbSetGroceryAisleOverrides(remembered);

    const byId = new Map(updates.map(u => [u.id, u]));
    set(s => ({
      items: s.items.map(i => byId.get(i.id) ?? i),
      // A brand-new aisle (a custom one, or an AI suggestion) has to enter the
      // walk order or its section would render at the bottom, unordered.
      aisleOrder: normalizeAisleOrder(s.aisleOrder, updates.map(u => u.aisle), s.hiddenAisles),
      aisleOverrides: remembered ?? s.aisleOverrides,
    }));
  },

  /**
   * Returns false on a key collision rather than merging. Merging two catalog
   * rows means choosing whose purchaseCount survives, and there's no right
   * answer — better to tell the caller the name is taken.
   */
  renameItem(id, name) {
    const item = get().items.find(i => i.id === id);
    if (!item) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;

    const key = groceryNameKey(trimmed);
    if (!key) return false;
    if (key !== item.nameKey && get().items.some(i => i.nameKey === key)) return false;

    const updated = { ...item, name: trimmed, nameKey: key };
    dbUpdateGroceryItem(updated);
    // The remembered aisle is keyed by name, so it has to follow the rename or
    // it stays stranded under the old spelling — which is usually a typo the
    // rename exists to fix.
    const remembered = renameRememberedAisle(get().aisleOverrides, item.nameKey, key);
    if (remembered) dbSetGroceryAisleOverrides(remembered);
    // Recipe ingredients are bridged to the catalog by name_key too, so they
    // strand on a rename exactly as the remembered aisle above does — and
    // silently, since a stranded ingredient still renders fine and only stops
    // matching. Reached through the store rather than the rows because the key
    // lives inside a JSON blob; remapIngredientKey is a no-op when nothing
    // referenced the old spelling.
    useRecipeStore.getState().remapIngredientKey(item.nameKey, key);
    set(s => ({
      items: s.items.map(i => (i.id === id ? updated : i)),
      aisleOverrides: remembered ?? s.aisleOverrides,
    }));
    return true;
  },

  setNote(id, note) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    const updated = { ...item, note: note.trim() };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  setOnHandUntil(id, until) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    const updated = { ...item, onHandUntil: until };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  toggleFavorite(id) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    // Starring is the explicit "keep this one", so it promotes a provisional
    // row. Unstarring doesn't demote: the row is in the catalog by then, and a
    // mis-tap on a star shouldn't arm a delete.
    const updated = {
      ...item,
      favorite: !item.favorite,
      inCatalog: item.inCatalog || !item.favorite,
    };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  /**
   * Takes a row off the list. A catalog row stays behind — "not this week" —
   * but a provisional one goes altogether, because it only ever existed as this
   * line of the list.
   *
   * The delete is deliberately not behind the confirm every other delete has.
   * That confirm protects history, and a provisional row has none by
   * definition: never bought, never starred, no purchase count to lose. The
   * sheet says which of the two will happen before you tap.
   */
  removeFromList(id) {
    const item = get().items.find(i => i.id === id);
    if (!item || !item.onList) return;
    if (!item.inCatalog) {
      get().deleteItem(id);
      return;
    }
    const updated = { ...item, onList: false, checked: false };
    dbUpdateGroceryItem(updated);
    set(s => ({
      items: s.items.map(i => (i.id === id ? updated : i)),
      cartHoldIds: s.cartHoldIds.filter(x => x !== id),
    }));
  },

  removeFromListMany(ids) {
    if (ids.length === 0) return;
    const wanted = new Set(ids);
    const toDelete: string[] = [];
    const toUpdate: GroceryItem[] = [];
    for (const item of get().items) {
      if (!wanted.has(item.id) || !item.onList) continue;
      // Same split as removeFromList: a provisional row has nothing to keep.
      if (!item.inCatalog) {
        toDelete.push(item.id);
        continue;
      }
      toUpdate.push({ ...item, onList: false, checked: false });
    }
    if (toDelete.length > 0) get().deleteItems(toDelete);
    if (toUpdate.length === 0) return;

    for (const u of toUpdate) dbUpdateGroceryItem(u);
    const byId = new Map(toUpdate.map(u => [u.id, u]));
    set(s => ({
      items: s.items.map(i => byId.get(i.id) ?? i),
      cartHoldIds: s.cartHoldIds.filter(x => !byId.has(x)),
    }));
  },

  /**
   * The one real delete. There is no undo, so every caller confirms first —
   * except removeFromList on a provisional row, which has nothing to lose and
   * says so on the button.
   */
  deleteItem(id) {
    get().deleteItems([id]);
  },

  deleteItems(ids) {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    // dbDeleteGroceryItem drops the item's shop links too; mirror that here so
    // the in-memory copy doesn't keep links to an item that's gone.
    for (const id of ids) dbDeleteGroceryItem(id);
    set(s => ({
      items: s.items.filter(i => !gone.has(i.id)),
      itemShops: s.itemShops.filter(l => !gone.has(l.itemId)),
      cartHoldIds: s.cartHoldIds.filter(x => !gone.has(x)),
    }));
  },

  finishShopping(shopId = null) {
    const purchasedAt = new Date().toISOString();
    const now = new Date(purchasedAt);
    // A shop deleted between opening the finish sheet and confirming it would
    // otherwise write links nothing can resolve.
    const shop = shopId ? get().shops.find(s => s.id === shopId) ?? null : null;
    // Computed from each item's *pre*-purchase history — its own cadence if
    // it has one yet, defaultOnHandUntil's flat guess if not — so a trip
    // asserts "you'll probably have this for about as long as you usually
    // do" rather than a single flat window for everything bought today.
    const onHandUntilById = Object.fromEntries(
      get().items
        .filter(i => i.checked && i.onList)
        .map(i => [i.id, defaultOnHandUntil(i, now)])
    );
    const ids = dbFinishGroceryShopping(purchasedAt, onHandUntilById, shop?.id ?? null);
    if (ids.length === 0) return 0;
    const done = new Set(ids);

    set(s => {
      // Patch the links the db just upserted rather than re-reading them —
      // same discipline the items array follows two lines down.
      let itemShops = s.itemShops;
      if (shop) {
        const bumped = new Set(
          s.itemShops.filter(l => l.shopId === shop.id && done.has(l.itemId)).map(l => l.itemId)
        );
        itemShops = [
          ...s.itemShops.map(l =>
            l.shopId === shop.id && done.has(l.itemId)
              ? { ...l, purchaseCount: l.purchaseCount + 1, lastPurchasedAt: purchasedAt }
              : l
          ),
          ...ids
            .filter(id => !bumped.has(id))
            .map(id => ({ itemId: id, shopId: shop.id, purchaseCount: 1, lastPurchasedAt: purchasedAt })),
        ];
      }

      return {
        items: s.items.map(i =>
          done.has(i.id)
            ? {
                ...i,
                onList: false,
                checked: false,
                // Bought it, so it's yours now — whatever it was before the trip.
                inCatalog: true,
                purchaseCount: i.purchaseCount + 1,
                lastPurchasedAt: purchasedAt,
                onHandUntil: onHandUntilById[i.id] ?? i.onHandUntil,
              }
            : i
        ),
        itemShops,
        cartHoldIds: [],
      };
    });

    if (shop) get().setLastShopId(shop.id);
    return ids.length;
  },

  clearList() {
    const ids = dbClearGroceryList();
    if (ids.length === 0) return 0;
    const cleared = new Set(ids);
    // Deliberately no purchaseCount bump: nothing was bought, and inflating
    // the ranking signal would teach autocomplete a lie. inCatalog *is* set —
    // clearing parks the list rather than forgetting it, which is what the
    // confirm promises, and it keeps !onList ⇒ inCatalog true.
    set(s => ({
      items: s.items.map(i =>
        cleared.has(i.id) ? { ...i, onList: false, checked: false, inCatalog: true } : i
      ),
      cartHoldIds: [],
    }));
    return ids.length;
  },

  applyDrop(placements) {
    const byId = new Map(get().items.map(i => [i.id, i]));
    const updates: GroceryItem[] = [];
    // Only the rows that crossed a section header — a drag that merely
    // reordered within an aisle says nothing about where the item lives.
    const moved: Array<{ nameKey: string; aisle: string }> = [];
    for (const p of placements) {
      const item = byId.get(p.id);
      if (!item) continue;
      if (item.sortOrder === p.sortOrder && item.aisle === p.aisle) continue;
      if (item.aisle !== p.aisle) moved.push({ nameKey: item.nameKey, aisle: p.aisle });
      updates.push({ ...item, sortOrder: p.sortOrder, aisle: p.aisle });
    }
    if (updates.length === 0) return;

    for (const u of updates) dbUpdateGroceryItem(u);
    // Dragging a row into another aisle is the same statement the item sheet's
    // picker makes, so it's remembered the same way.
    const remembered = rememberAisles(get().aisleOverrides, moved);
    if (remembered) dbSetGroceryAisleOverrides(remembered);

    const updated = new Map(updates.map(u => [u.id, u]));
    set(s => ({
      items: s.items.map(i => updated.get(i.id) ?? i),
      // Every aisle here came off a header that was already on screen, so this
      // is belt and braces — but normalizing is what setAisleMany does, and an
      // aisle missing from the order renders its section unplaced.
      aisleOrder: normalizeAisleOrder(s.aisleOrder, updates.map(u => u.aisle), s.hiddenAisles),
      aisleOverrides: remembered ?? s.aisleOverrides,
    }));
  },

  setAisleOrder(order) {
    set(commitAisleOrder(order, get().items.map(i => i.aisle)));
  },

  renameAisle(from, to) {
    const trimmed = to.trim();
    if (!trimmed || from === OTHER_AISLE || trimmed === OTHER_AISLE) return false;

    const { aisleOrder, items, aisleOverrides } = get();
    if (!aisleOrder.includes(from)) return false;
    if (trimmed === from) return true;
    // Case-insensitive, like adding one: two aisles differing only in case are
    // two sections nobody can tell apart. Re-casing the aisle itself is fine.
    if (aisleOrder.some(a => a !== from && a.toLowerCase() === trimmed.toLowerCase())) return false;

    const updates = items.filter(i => i.aisle === from).map(i => ({ ...i, aisle: trimmed }));
    for (const u of updates) dbUpdateGroceryItem(u);

    // The filings are stored by aisle *name*, so they have to move too or the
    // next time that name is typed it goes back to a section that's gone.
    const remembered = remapRememberedAisle(aisleOverrides, from, trimmed);
    if (remembered) dbSetGroceryAisleOverrides(remembered);

    const byId = new Map(updates.map(u => [u.id, u]));
    const nextItems = items.map(i => byId.get(i.id) ?? i);
    // In place, not appended: renaming an aisle doesn't move it in the walk.
    const order = aisleOrder.filter(a => a !== OTHER_AISLE).map(a => (a === from ? trimmed : a));

    set({
      items: nextItems,
      aisleOverrides: remembered ?? aisleOverrides,
      ...commitAisleOrder(order, nextItems.map(i => i.aisle)),
    });
    return true;
  },

  deleteAisle(aisle) {
    // Other is the floor every unrecognised item lands on — there'd be nowhere
    // for the rows to go, and aisleForName returning null would have no answer.
    if (aisle === OTHER_AISLE) return;
    const { aisleOrder, items, aisleOverrides } = get();
    if (!aisleOrder.includes(aisle)) return;

    // Every row, not just the ones on this week's list: the aisle is on the
    // catalog row, and a row left pointing at a deleted section would drag it
    // back through normalizeAisleOrder's `used` pass the moment it resurfaced.
    const updates = items.filter(i => i.aisle === aisle).map(i => ({ ...i, aisle: OTHER_AISLE }));
    for (const u of updates) dbUpdateGroceryItem(u);

    const remembered = forgetRememberedAisle(aisleOverrides, aisle);
    if (remembered) dbSetGroceryAisleOverrides(remembered);

    const byId = new Map(updates.map(u => [u.id, u]));
    const nextItems = items.map(i => byId.get(i.id) ?? i);

    set({
      items: nextItems,
      aisleOverrides: remembered ?? aisleOverrides,
      ...commitAisleOrder(
        aisleOrder.filter(a => a !== aisle && a !== OTHER_AISLE),
        nextItems.map(i => i.aisle)
      ),
    });
  },

  /**
   * Unlike addShop this hands back the existing aisle on a collision instead of
   * refusing. A shop is a row with an id, so returning a different one silently
   * files a trip against the wrong place; an aisle *is* its name, so the one
   * already in the order is the same aisle the caller just asked for.
   *
   * Matching is case-insensitive because normalizeAisleOrder dedupes exactly —
   * "produce" beside "Produce" would render as two sections of one aisle.
   *
   * This is also the only path that *persists* a new aisle: setAisleMany adds
   * one to the in-memory order as a side effect of filing an item there, and
   * normalizeAisleOrder recovers it at startup only for as long as some row
   * still carries it. An aisle the user typed out is a decision about their
   * store and outlives the item it was created for.
   */
  addAisle(name) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = get().aisleOrder.find(a => a.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    // setAisleOrder normalizes, so passing the order with 'Other' still in it
    // is fine — it comes back forced last.
    get().setAisleOrder([...get().aisleOrder, trimmed]);
    return trimmed;
  },

  /**
   * Refuses a duplicate rather than returning the existing store, the same way
   * renameItem refuses rather than merging: the caller asked to create
   * something, and quietly handing back a different object is how you end up
   * filing a trip against the wrong place.
   */
  addShop(name) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    // Falls back to the raw text for the same reason addByName does: a name
    // with no letters or digits normalises to empty, and two of those would
    // collide on the UNIQUE index and throw out of whatever called this.
    const key = groceryNameKey(trimmed) || trimmed.toLowerCase();
    if (get().shops.some(s => s.nameKey === key)) return null;

    const shop: Shop = {
      id: generateId(),
      name: trimmed,
      nameKey: key,
      sortOrder: get().shops.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1,
      createdAt: new Date().toISOString(),
    };
    dbInsertGroceryShop(shop);
    set(s => ({ shops: [...s.shops, shop] }));
    return shop;
  },

  renameShop(id, name) {
    const shop = get().shops.find(s => s.id === id);
    if (!shop) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;

    const key = groceryNameKey(trimmed) || trimmed.toLowerCase();
    if (key !== shop.nameKey && get().shops.some(s => s.nameKey === key)) return false;

    // Renaming costs nothing downstream — every link points at the id, which
    // is the whole reason stores got a table instead of being name strings.
    const updated = { ...shop, name: trimmed, nameKey: key };
    dbUpdateGroceryShop(updated);
    set(s => ({ shops: s.shops.map(x => (x.id === id ? updated : x)) }));
    return true;
  },

  reorderShops(ids) {
    const byId = new Map(get().shops.map(s => [s.id, s]));
    const updated: Shop[] = [];
    let order = 1;
    for (const id of ids) {
      const shop = byId.get(id);
      if (!shop) continue;
      updated.push({ ...shop, sortOrder: order++ });
      byId.delete(id);
    }
    // Anything the caller didn't name keeps its relative place at the end,
    // rather than being dropped from the order entirely.
    for (const shop of byId.values()) updated.push({ ...shop, sortOrder: order++ });

    for (const shop of updated) dbUpdateGroceryShop(shop);
    set({ shops: updated });
  },

  /**
   * Takes the store's purchase records with it. A link to a store that doesn't
   * exist is unreadable rather than merely orphaned, so there's nothing to
   * preserve — and the confirm that fronts this says so.
   */
  deleteShop(id) {
    const wasLast = get().lastShopId === id;
    dbDeleteGroceryShop(id);
    if (wasLast) dbSetLastShopId(null);
    set(s => ({
      shops: s.shops.filter(x => x.id !== id),
      itemShops: s.itemShops.filter(l => l.shopId !== id),
      lastShopId: wasLast ? null : s.lastShopId,
    }));
  },

  linkItemShop(itemId, shopId) {
    const { items, shops, itemShops } = get();
    if (!items.some(i => i.id === itemId) || !shops.some(s => s.id === shopId)) return;
    if (itemShops.some(l => l.itemId === itemId && l.shopId === shopId)) return;

    // purchaseCount 0 is the assertion: the user says it's here, no trip has
    // confirmed it. Ranking reads that and declines to call it "usually".
    const link: ItemShopLink = { itemId, shopId, purchaseCount: 0, lastPurchasedAt: null };
    dbSetItemShopLink(link);

    // ...and it promotes a provisional row, for the same reason starring does.
    // Saying where you get something is a statement about the item, not about
    // this week's list — but a provisional row is *deleted* when it comes off
    // the list, so without this the assertion is thrown away by the next
    // "Remove from list" and the store chip the user just tapped is gone.
    const item = items.find(i => i.id === itemId)!;
    const promoted = item.inCatalog ? null : { ...item, inCatalog: true };
    if (promoted) dbUpdateGroceryItem(promoted);

    set(s => ({
      itemShops: [...s.itemShops, link],
      items: promoted ? s.items.map(i => (i.id === itemId ? promoted : i)) : s.items,
    }));
  },

  unlinkItemShop(itemId, shopId) {
    dbDeleteItemShopLink(itemId, shopId);
    set(s => ({
      itemShops: s.itemShops.filter(l => !(l.itemId === itemId && l.shopId === shopId)),
    }));
  },

  setLastShopId(id) {
    dbSetLastShopId(id);
    set({ lastShopId: id });
  },

  itemByNameKey(key) {
    return get().items.find(i => i.nameKey === key) ?? null;
  },

  itemById(id) {
    return get().items.find(i => i.id === id) ?? null;
  },

  rememberedAisleFor(name) {
    const key = groceryNameKey(name);
    return (key && get().aisleOverrides[key]) || null;
  },
}));
