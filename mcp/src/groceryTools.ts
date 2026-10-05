/**
 * The grocery catalog beyond the list: one item's whole record, the stores,
 * aisles and separate lists, and receipts. Same contract as tools.ts:
 * functions over a replica, so they are testable without the SDK.
 *
 * Every write is a row rule the app already has (`groceryItemWrite.ts`,
 * `pantryWrite.ts`, `groceryAdd.ts`), so a tool can do nothing a person could
 * not do in the app. Three decisions are specific to the server:
 *
 * - **A receipt is read by Claude, not by this server.** The phone reads one
 *   with on-device OCR or the user's own API key; here the model is the reader,
 *   so `match_receipt` takes the lines it extracted and runs the app's own
 *   matching (remembered store names first), and `import_receipt` writes what
 *   the app's scan flow would, from decisions the person has seen.
 * - **A delete is previewed and undoable.** The preview lists what goes with
 *   the item, and the Activity entry carries a snapshot that puts all of it back.
 * - **A separate list records almost nothing when finished.** That is the app's
 *   rule (`docs/arch/groceries.md`, "An away trip records nothing"), and the
 *   result says so rather than leaving it to look like a failure.
 */
import type { GroceryItem, GroceryList, ItemProduct, ReceiptStyle } from '../../src/types';
import type {
  GroceryBoxInput,
  GroceryItemChange,
  ReceiptImportInput,
  ReceiptImportOutcome,
  ReceiptLineInput,
  Replica,
} from './replica';
import { findPantryItem } from './pantryTools';

const HOME = 'home';

/** A list by id or name. `home`, empty or undefined is the list at home. */
export function resolveList(replica: Replica, ref: string | null | undefined): GroceryList | null {
  if (ref === undefined || ref === null || ref === '' || ref.toLowerCase() === HOME) return null;
  const lists = replica.groceryLists();
  const found = lists.find(l => l.id === ref) ?? lists.find(l => l.name.trim().toLowerCase() === ref.trim().toLowerCase());
  if (!found) {
    const names = lists.map(l => `"${l.name}"`).join(', ');
    throw new Error(`There is no list "${ref}". The lists are: home${names ? `, ${names}` : ''}. grocery_setup shows them.`);
  }
  return found;
}

export function resolveShop(replica: Replica, ref: string | null | undefined) {
  if (!ref) return null;
  const shops = replica.shops();
  const lib = replica.lib();
  const found = shops.find(s => s.id === ref)
    ?? shops.find(s => s.nameKey === (lib.groceryParse.groceryNameKey(ref) || ref.toLowerCase()))
    ?? lib.receiptMatch.matchReceiptShop(ref, shops);
  if (!found) {
    throw new Error(`There is no store "${ref}". The stores are: ${shops.map(s => `"${s.name}"`).join(', ') || 'none yet'}. save_store adds one.`);
  }
  return found;
}

/** An item by id if one has that id, otherwise by name. For lists a caller fills with either. */
function itemByIdOrName(replica: Replica, ref: string): GroceryItem {
  return replica.groceryItems().some(i => i.id === ref) ? findPantryItem(replica, { id: ref }) : findPantryItem(replica, { name: ref });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface GrocerySetup {
  aisles: string[];
  stores: { id: string; name: string; receiptStyle: ReceiptStyle; itemsLinked: number }[];
  lists: { id: string | null; name: string; items: number; checked: number }[];
  note: string;
}

export function grocerySetup(replica: Replica): GrocerySetup {
  const links = replica.itemShopLinks();
  const entries = replica.groceryListEntries();
  const count = (listId: string | null) => entries.filter(e => e.listId === listId);
  return {
    aisles: replica.aisleNames(),
    stores: replica.shops().map(s => ({ id: s.id, name: s.name, receiptStyle: s.receiptStyle, itemsLinked: links.filter(l => l.shopId === s.id).length })),
    lists: [
      { id: null, name: replica.lib().groceryLists.HOME_LIST_NAME, items: count(null).length, checked: count(null).filter(e => e.checked).length },
      ...replica.groceryLists().map(l => ({ id: l.id, name: l.name, items: count(l.id).length, checked: count(l.id).filter(e => e.checked).length })),
    ],
    note: 'List id null is the list at home; tools take it as "home". A separate list is for a trip away.',
  };
}

export interface GroceryItemDetail {
  id: string;
  name: string;
  aisle: string;
  quantity?: string;
  note?: string;
  /** What the last recorded price was for, in minor units. */
  price?: { minor: number; quantity?: string; at?: string };
  kindOf?: string;
  preferredBoxId?: string;
  onlyPreferredBrand?: boolean;
  boughtTimes?: number;
  lastBought?: string;
  lists: { id: string | null; name: string; checked: boolean }[];
  boxes: { id: string; brand?: string; variant?: string; note?: string; rating?: string; portion?: boolean }[];
  stores: { id: string; name: string; timesBought: number; unavailable?: boolean; price?: number }[];
  /** Items that can stand in for this one. */
  substitutes: { itemId: string; name: string; note?: string; ratio?: string; standing?: boolean }[];
  /** Names printed on receipts that mean this item. */
  receiptNames: { store: string; text: string }[];
}

export function getGroceryItem(replica: Replica, ref: { id?: string; name?: string }): GroceryItemDetail {
  const item = findPantryItem(replica, ref);
  const items = new Map(replica.groceryItems().map(i => [i.id, i]));
  const shops = new Map(replica.shops().map(s => [s.id, s]));
  const lists = new Map(replica.groceryLists().map(l => [l.id, l]));
  const home = replica.lib().groceryLists.HOME_LIST_NAME;
  return {
    id: item.id,
    name: item.name,
    aisle: item.aisle,
    ...(item.quantity ? { quantity: item.quantity } : {}),
    ...(item.note ? { note: item.note } : {}),
    ...(item.lastPriceMinor !== null ? { price: { minor: item.lastPriceMinor, ...(item.lastPriceQuantity ? { quantity: item.lastPriceQuantity } : {}), ...(item.lastPricedAt ? { at: item.lastPricedAt } : {}) } } : {}),
    ...(item.varietyOfKey ? { kindOf: item.varietyOfKey } : {}),
    ...(item.preferredProductId ? { preferredBoxId: item.preferredProductId } : {}),
    ...(item.productStrict ? { onlyPreferredBrand: true } : {}),
    ...(item.purchaseCount > 0 ? { boughtTimes: item.purchaseCount } : {}),
    ...(item.lastPurchasedAt ? { lastBought: item.lastPurchasedAt } : {}),
    lists: replica.groceryListEntries().filter(e => e.itemId === item.id).map(e => ({ id: e.listId, name: e.listId === null ? home : lists.get(e.listId)?.name ?? 'unknown', checked: e.checked })),
    boxes: replica.itemProducts().filter(p => p.itemId === item.id).map((p: ItemProduct) => ({
      id: p.id,
      ...(p.brand ? { brand: p.brand } : {}),
      ...(p.variant ? { variant: p.variant } : {}),
      ...(p.note ? { note: p.note } : {}),
      ...(p.rating ? { rating: String(p.rating) } : {}),
      ...(p.isPortion ? { portion: true } : {}),
    })),
    stores: replica.itemShopLinks().filter(l => l.itemId === item.id).map(l => ({
      id: l.shopId,
      name: shops.get(l.shopId)?.name ?? 'unknown',
      timesBought: l.purchaseCount,
      ...(l.unavailableAt ? { unavailable: true } : {}),
      ...(l.lastPriceMinor !== null ? { price: l.lastPriceMinor } : {}),
    })),
    substitutes: replica.itemSubLinks().filter(l => l.itemId === item.id).map(l => ({
      itemId: l.subItemId,
      name: items.get(l.subItemId)?.name ?? 'unknown',
      ...(l.note ? { note: l.note } : {}),
      ...(l.ratioFrom && l.ratioTo ? { ratio: `${l.ratioFrom} = ${l.ratioTo}` } : {}),
      ...(l.standing ? { standing: true } : {}),
    })),
    receiptNames: replica.storeAliases().filter(a => a.itemId === item.id).map(a => ({ store: a.shopId ? shops.get(a.shopId)?.name ?? 'unknown' : 'any store', text: a.rawKey })),
  };
}

export interface ReceiptLineRead {
  /** As printed. */
  label: string;
  /** The line as a shopper would say it ("milk"), which is what gets matched. */
  name: string;
  quantity?: string;
  priceMinor?: number | null;
}

export interface MatchReceiptResult {
  store: { id: string; name: string } | null;
  lines: {
    label: string;
    match: { itemId: string; name: string; confidence: string; onList: boolean } | null;
    /** A second opinion from the rest of the catalog, for a line nothing on the list claimed. */
    elsewhere: { itemId: string; name: string; confidence: string } | null;
    /** This line lands on a row an earlier line already claimed. Two of the same thing, not one summed price. */
    duplicateOf?: string;
    cautions: string[];
    /** Whether the app would pre-accept this match in its own review. */
    acceptedByApp: boolean;
  }[];
  note: string;
}

/**
 * The app's own receipt matching over lines Claude read: remembered names for
 * this store first, then exact, likely and weak matches. `scope: list` reads
 * the lines against what is on the list (the shopping flow), `catalog` against
 * everything (the pantry flow).
 */
export function matchReceipt(
  replica: Replica,
  input: { store?: string | null; scope?: 'list' | 'catalog'; listId?: string | null; lines: ReceiptLineRead[] }
): MatchReceiptResult {
  const lib = replica.lib();
  const scope = input.scope ?? 'list';
  const list = resolveList(replica, input.listId);
  const listId = list?.id ?? null;
  const shops = replica.shops();
  const shop = input.store ? lib.receiptMatch.matchReceiptShop(input.store, shops) : null;
  const items = replica.groceryItems();
  // The list's own ticks projected onto the rows, since the rows' flags answer for the home list.
  const rows = scope === 'list' ? lib.groceryLists.itemsOnList(items, replica.groceryListEntries(), listId) : items;
  const aliases = replica.storeAliases();
  const lines = input.lines.map(l => ({ label: l.label, name: l.name, quantity: l.quantity ?? '', priceMinor: l.priceMinor ?? null }));
  const matches = lib.receiptMatch.matchReceiptLines(
    lines,
    rows,
    line => {
      const id = lib.storeAliases.aliasItemIdFor(aliases, shop?.id ?? null, line.label);
      return id && items.some(i => i.id === id) ? id : null;
    },
    scope,
  );
  const byId = new Map(items.map(i => [i.id, i]));
  const accepted = new Set(lib.receiptMatch.acceptedByDefault(matches, rows, shop?.id ?? null, replica.itemShopLinks()));
  return {
    store: shop ? { id: shop.id, name: shop.name } : null,
    lines: matches.map(m => ({
      label: m.line.label,
      match: m.itemId ? { itemId: m.itemId, name: byId.get(m.itemId)?.name ?? '', confidence: m.confidence ?? '', onList: m.inTrolley || scope === 'list' } : null,
      elsewhere: m.offListMatchId ? { itemId: m.offListMatchId, name: byId.get(m.offListMatchId)?.name ?? '', confidence: m.offListConfidence ?? '' } : null,
      ...(m.duplicateOf ? { duplicateOf: m.duplicateOf } : {}),
      cautions: lib.receiptMatch.receiptCautionsFor(m, rows, shop?.id ?? null, replica.itemShopLinks()).map(c => c.kind ?? String(c)),
      acceptedByApp: m.itemId !== null && accepted.has(m.itemId),
    })),
    note: 'A match is the app\'s reading of two names, not a fact. Show the person the lines you are unsure of before import_receipt. A line with no match needs an itemId, or a name, which creates the item.',
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface UpdateGroceryItemInput {
  id?: string;
  name?: string;
  /** The item's new name. */
  rename?: string;
  aisle?: string;
  quantity?: string | null;
  note?: string;
  priceMinor?: number | null;
  /** The store the price was seen at, which also updates that store's link. */
  priceStore?: string;
  kindOf?: string | null;
  preferredBoxId?: string | null;
  onlyPreferredBrand?: boolean;
  linkStores?: string[];
  unlinkStores?: string[];
  addSubstitutes?: { name?: string; itemId?: string; note?: string | null; ratioFrom?: string | null; ratioTo?: string | null; standing?: boolean; bothWays?: boolean }[];
  removeSubstitutes?: string[];
}

export function updateGroceryItem(replica: Replica, input: UpdateGroceryItemInput): { item: GroceryItemDetail; changed: string[]; undoable: boolean; note?: string } {
  const target = findPantryItem(replica, { id: input.id, name: input.name });
  const change: GroceryItemChange = {
    ...(input.rename !== undefined ? { name: input.rename } : {}),
    ...(input.aisle !== undefined ? { aisle: input.aisle } : {}),
    ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.priceMinor !== undefined ? { price: { minor: input.priceMinor, shopId: input.priceStore ? resolveShop(replica, input.priceStore)!.id : null } } : {}),
    ...(input.kindOf !== undefined ? { varietyOf: input.kindOf } : {}),
    ...(input.preferredBoxId !== undefined ? { preferredBoxId: input.preferredBoxId } : {}),
    ...(input.onlyPreferredBrand !== undefined ? { strict: input.onlyPreferredBrand } : {}),
    ...(input.linkStores ? { linkShops: input.linkStores.map(s => resolveShop(replica, s)!.id) } : {}),
    ...(input.unlinkStores ? { unlinkShops: input.unlinkStores.map(s => resolveShop(replica, s)!.id) } : {}),
    ...(input.addSubstitutes ? {
      addSubstitutes: input.addSubstitutes.map(s => ({
        ...s,
        itemId: s.itemId ? findPantryItem(replica, { id: s.itemId }).id : findPantryItem(replica, { name: s.name }).id,
      })),
    } : {}),
    ...(input.removeSubstitutes ? { removeSubstitutes: input.removeSubstitutes.map(n => itemByIdOrName(replica, n).id) } : {}),
  };
  const outcome = replica.updateGroceryItem(target.id, change);
  return {
    item: getGroceryItem(replica, { id: outcome.item.id }),
    changed: outcome.changed,
    undoable: outcome.reversible && outcome.changed.length > 0,
    ...(outcome.changed.length === 0 ? { note: 'Nothing changed: it was already that way.' } : {}),
  };
}

export function saveGroceryBox(replica: Replica, ref: { id?: string; name?: string }, input: GroceryBoxInput): { box: ItemProduct | null; item: string } {
  const item = findPantryItem(replica, ref);
  return { box: replica.saveGroceryBox(item.id, input), item: item.name };
}

export function saveStore(replica: Replica, input: { store?: string; name?: string; receiptStyle?: ReceiptStyle }) {
  const existing = input.store ? resolveShop(replica, input.store) : null;
  const shop = replica.saveShop({ id: existing?.id, name: input.name ?? (existing ? undefined : input.store), receiptStyle: input.receiptStyle });
  return { id: shop.id, name: shop.name, receiptStyle: shop.receiptStyle };
}

export interface DeleteGroceryItemResult {
  deleted: string;
  /** What went with it, so the person knows what an undo from Activity puts back. */
  alsoRemoved: { brands: number; storeLinks: number; substitutes: number; receiptNames: number; listEntries: number };
  note: string;
}

export function deleteGroceryItem(replica: Replica, ref: { id?: string; name?: string }): DeleteGroceryItemResult {
  const item = findPantryItem(replica, ref);
  const snapshot = replica.deleteGroceryItem(item.id);
  return {
    deleted: snapshot.item.name,
    alsoRemoved: {
      brands: snapshot.boxes.length,
      storeLinks: snapshot.shopLinks.length,
      substitutes: snapshot.subLinks.length,
      receiptNames: snapshot.aliases.length,
      listEntries: snapshot.entries.length,
    },
    note: 'Recipes that name it keep working: they match by name. A "Use up" task for it is dropped by the phone the next time it opens. Activity can restore it while nothing has re-created it.',
  };
}

export function createGroceryList(replica: Replica, name: string): GroceryList {
  return replica.createGroceryList(name);
}

export function renameGroceryList(replica: Replica, ref: string, name: string): GroceryList {
  const list = resolveList(replica, ref);
  if (!list) throw new Error('The list at home cannot be renamed.');
  return replica.renameGroceryList(list.id, name);
}

export function deleteGroceryList(replica: Replica, ref: string) {
  const list = resolveList(replica, ref);
  if (!list) throw new Error('The list at home cannot be deleted.');
  const result = replica.deleteGroceryList(list.id);
  return { deleted: result.list.name, itemsTakenOff: result.unlisted, note: 'The items stay in the catalog.' };
}

export function finishGroceryTrip(
  replica: Replica,
  input: { list?: string | null; store?: string | null; date?: string; prices?: { name: string; priceMinor: number }[]; frozen?: string[] }
) {
  const list = resolveList(replica, input.list);
  const shop = input.store ? resolveShop(replica, input.store) : null;
  const byName = (n: string) => findPantryItem(replica, { name: n }).id;
  const priceById: Record<string, number> = {};
  for (const p of input.prices ?? []) priceById[byName(p.name)] = p.priceMinor;
  const result = replica.finishGroceryTrip({
    listId: list?.id ?? null,
    shopId: shop?.id ?? null,
    purchasedAt: tripInstant(input.date),
    priceById,
    frozenIds: (input.frozen ?? []).map(byName),
  });
  return {
    ...result,
    note: result.away
      ? 'This is a separate list, so the trip recorded nothing but that these items left it: no purchase counts, prices, store or use-by days.'
      : 'Recorded as bought: purchase counts, last purchased, use-by days from the shelf-life table, prices and the store link.',
  };
}

/** The instant a trip happened: a bare day is noon that day, local, and nothing is the present. */
export function tripInstant(date?: string): string {
  if (!date) return new Date().toISOString();
  return new Date(`${date}T12:00:00`).toISOString();
}

export interface ImportReceiptInput {
  /** shopping (default): check the lines off a list and finish the trip. pantry: say the person has these now. */
  context?: 'shopping' | 'pantry';
  list?: string | null;
  store?: string | null;
  /** YYYY-MM-DD printed on the receipt. */
  date?: string;
  /** Shopping: finish the list afterwards (default true). Finishing records everything ticked on the list, including items ticked before this receipt. */
  finish?: boolean;
  lines: (Omit<ReceiptLineInput, 'itemId'> & { itemId?: string })[];
}

export function importReceipt(replica: Replica, input: ImportReceiptInput): ReceiptImportOutcome & { note: string } {
  if (input.lines.length === 0) throw new Error('A receipt needs at least one line.');
  const context = input.context ?? 'shopping';
  const list = resolveList(replica, input.list);
  const shop = input.store ? resolveShop(replica, input.store) : null;
  const outcome = replica.importReceipt({
    context,
    listId: context === 'shopping' ? list?.id ?? null : null,
    shopId: shop?.id ?? null,
    purchasedAt: tripInstant(input.date),
    finish: context === 'shopping' && input.finish !== false,
    lines: input.lines,
  } satisfies ReceiptImportInput);
  return {
    ...outcome,
    note: context === 'pantry'
      ? 'Marked on hand, with a new packet clearing the old one\'s opened, frozen and running-low state. No purchase is recorded: the pantry flow only says the person has these.'
      : outcome.away
        ? 'Separate list: the lines left the list and nothing else was recorded.'
        : 'Recorded as a trip. Receipt names were remembered for this store, so the next receipt matches them first.',
  };
}
