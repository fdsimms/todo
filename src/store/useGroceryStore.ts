import { create } from 'zustand';
import type { GroceryItem } from '../types';
import {
  dbGetAllGroceryItems,
  dbInsertGroceryItem,
  dbUpdateGroceryItem,
  dbDeleteGroceryItem,
  dbFinishGroceryShopping,
  dbClearGroceryList,
  dbGetGroceryAisleOrder,
  dbSetGroceryAisleOrder,
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

  /** Ends the trip: everything checked comes off the list and counts as bought. Returns how many. */
  finishShopping: () => number;
  /** Abandons the trip: everything comes off the list, nothing counts as bought. */
  clearList: () => number;

  setAisleOrder: (order: string[]) => void;

  itemByNameKey: (key: string) => GroceryItem | null;
  itemById: (id: string) => GroceryItem | null;
}

function nextSortOrder(items: GroceryItem[]): number {
  return items.reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1;
}

export const useGroceryStore = create<GroceryStore>((set, get) => ({
  items: [],
  aisleOrder: [],
  cartHoldIds: [],
  initialized: false,

  initialize() {
    const items = dbGetAllGroceryItems();
    // Repaired at read time and deliberately NOT written back: shipping a
    // bigger DEFAULT_AISLES later then needs no migration, and can't clobber
    // an order someone arranged to match their store.
    const aisleOrder = normalizeAisleOrder(dbGetGroceryAisleOrder(), items.map(i => i.aisle));
    if (cartHoldTimer) {
      clearTimeout(cartHoldTimer);
      cartHoldTimer = null;
    }
    set({ items, aisleOrder, cartHoldIds: [], initialized: true });
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
      // Provisional: a name nobody has bought, starred or finished a trip with
      // is on the list, not in the catalog. removeFromList deletes it.
      inCatalog: false,
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

  /**
   * The one real delete. There is no undo, so every caller confirms first —
   * except removeFromList on a provisional row, which has nothing to lose and
   * says so on the button.
   */
  deleteItem(id) {
    dbDeleteGroceryItem(id);
    set(s => ({
      items: s.items.filter(i => i.id !== id),
      cartHoldIds: s.cartHoldIds.filter(x => x !== id),
    }));
  },

  deleteItems(ids) {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    for (const id of ids) dbDeleteGroceryItem(id);
    set(s => ({
      items: s.items.filter(i => !gone.has(i.id)),
      cartHoldIds: s.cartHoldIds.filter(x => !gone.has(x)),
    }));
  },

  finishShopping() {
    const purchasedAt = new Date().toISOString();
    const ids = dbFinishGroceryShopping(purchasedAt);
    if (ids.length === 0) return 0;
    const done = new Set(ids);
    set(s => ({
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
            }
          : i
      ),
      cartHoldIds: [],
    }));
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

  setAisleOrder(order) {
    const normalized = normalizeAisleOrder(order, get().items.map(i => i.aisle));
    dbSetGroceryAisleOrder(normalized);
    set({ aisleOrder: normalized });
  },

  itemByNameKey(key) {
    return get().items.find(i => i.nameKey === key) ?? null;
  },

  itemById(id) {
    return get().items.find(i => i.id === id) ?? null;
  },
}));
