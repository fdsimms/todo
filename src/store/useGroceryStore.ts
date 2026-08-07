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
} from '../db/database';
import { generateId } from '../utils/id';
import { groceryNameKey, parseGroceryInput, splitGroceryLines } from '../utils/groceryParse';
import { aisleForName, normalizeAisleOrder, OTHER_AISLE } from '../utils/groceryAisles';

/**
 * The grocery catalog, which is also the shopping list.
 *
 * One array of rows: `onList` decides what's on the list right now, and a row
 * that comes off the list stays in memory as catalog. Adding a name that's
 * already known flips `onList` instead of inserting — that single behaviour
 * (addByName below) is what gives autocomplete, Buy again and dedupe.
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
  /** Checked rows still holding their place in their own aisle. */
  cartHoldIds: string[];
  initialized: boolean;

  initialize: () => void;

  /** Parse a typed line and put it on the list — creating the catalog row only if it's new. */
  addByName: (raw: string) => GroceryItem;
  /** A pasted block, one item per line. */
  addManyFromText: (raw: string) => { added: GroceryItem[]; alreadyOnList: GroceryItem[] };
  addExisting: (id: string) => void;
  addExistingMany: (ids: string[]) => void;

  toggleChecked: (id: string) => void;
  setQuantity: (id: string, quantity: string | null) => void;
  setAisle: (id: string, aisle: string) => void;
  setAisleMany: (assignments: Record<string, string>) => void;
  /** False when the new name collides with another catalog row. */
  renameItem: (id: string, name: string) => boolean;
  setNote: (id: string, note: string) => void;
  toggleFavorite: (id: string) => void;

  removeFromList: (id: string) => void;
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

  setAisleOrder: (order: string[]) => void;

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
}

function nextSortOrder(items: GroceryItem[]): number {
  return items.reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1;
}

export const useGroceryStore = create<GroceryStore>((set, get) => ({
  items: [],
  aisleOrder: [],
  shops: [],
  itemShops: [],
  lastShopId: null,
  cartHoldIds: [],
  initialized: false,

  initialize() {
    const items = dbGetAllGroceryItems();
    // Repaired at read time and deliberately NOT written back: shipping a
    // bigger DEFAULT_AISLES later then needs no migration, and can't clobber
    // an order someone arranged to match their store.
    const aisleOrder = normalizeAisleOrder(dbGetGroceryAisleOrder(), items.map(i => i.aisle));
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
    set({ items, aisleOrder, shops, itemShops, lastShopId, cartHoldIds: [], initialized: true });
  },

  /**
   * The whole product insight, in one function. A name we already know is put
   * back on the list; only a genuinely new one inserts a row. That's why
   * there's never a duplicate, why autocomplete has history to rank, and why
   * next week's list starts from what you actually buy.
   */
  addByName(raw) {
    const { name, quantity } = parseGroceryInput(raw);
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
      aisle: aisleForName(name) ?? OTHER_AISLE,
      quantity,
      note: '',
      onList: true,
      checked: false,
      sortOrder: nextSortOrder(get().items),
      favorite: false,
      purchaseCount: 0,
      lastAddedAt: now,
      lastPurchasedAt: null,
      createdAt: now,
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
    const byId = new Map(updates.map(u => [u.id, u]));
    set(s => ({
      items: s.items.map(i => byId.get(i.id) ?? i),
      // A brand-new aisle (a custom one, or an AI suggestion) has to enter the
      // walk order or its section would render at the bottom, unordered.
      aisleOrder: normalizeAisleOrder(s.aisleOrder, updates.map(u => u.aisle)),
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
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
    return true;
  },

  setNote(id, note) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    const updated = { ...item, note: note.trim() };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  toggleFavorite(id) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    const updated = { ...item, favorite: !item.favorite };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  /** Takes a row off the list but keeps the catalog entry — "not this week". */
  removeFromList(id) {
    const item = get().items.find(i => i.id === id);
    if (!item || !item.onList) return;
    const updated = { ...item, onList: false, checked: false };
    dbUpdateGroceryItem(updated);
    set(s => ({
      items: s.items.map(i => (i.id === id ? updated : i)),
      cartHoldIds: s.cartHoldIds.filter(x => x !== id),
    }));
  },

  /** The one real delete. There is no undo, so every caller confirms first. */
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
    // A shop deleted between opening the finish sheet and confirming it would
    // otherwise write links nothing can resolve.
    const shop = shopId ? get().shops.find(s => s.id === shopId) ?? null : null;
    const ids = dbFinishGroceryShopping(purchasedAt, shop?.id ?? null);
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
            ? { ...i, onList: false, checked: false, purchaseCount: i.purchaseCount + 1, lastPurchasedAt: purchasedAt }
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
    // the ranking signal would teach autocomplete a lie.
    set(s => ({
      items: s.items.map(i => (cleared.has(i.id) ? { ...i, onList: false, checked: false } : i)),
      cartHoldIds: [],
    }));
    return ids.length;
  },

  setAisleOrder(order) {
    const normalized = normalizeAisleOrder(order, get().items.map(i => i.aisle));
    dbSetGroceryAisleOrder(normalized);
    set({ aisleOrder: normalized });
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
    set(s => ({ itemShops: [...s.itemShops, link] }));
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
}));
