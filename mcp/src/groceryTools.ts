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
import { NUTRIENT_KEYS } from '../../src/types';
import { describeFoodPanel } from '../../src/utils/foodNutrition';

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
  /** Aisles marked non-food (cleaning, toiletries): left out of the pantry and nutrition. */
  nonFoodAisles?: string[];
  stores: {
    id: string; name: string; receiptStyle: ReceiptStyle; itemsLinked: number;
    excludedFromSuggestions?: true; aisles?: string[]; aisleOrder?: string[];
  }[];
  lists: { id: string | null; name: string; items: number; checked: number }[];
  /** The shopping trip in progress, if any. */
  trip?: { store: string; startedAt: string; budgetMinor?: number };
  note: string;
}

export function grocerySetup(replica: Replica): GrocerySetup {
  const links = replica.itemShopLinks();
  const entries = replica.groceryListEntries();
  const count = (listId: string | null) => entries.filter(e => e.listId === listId);
  return {
    aisles: replica.aisleNames(),
    ...(replica.nonFoodAisles().length > 0 ? { nonFoodAisles: replica.nonFoodAisles() } : {}),
    stores: replica.shops().map(s => ({
      id: s.id, name: s.name, receiptStyle: s.receiptStyle, itemsLinked: links.filter(l => l.shopId === s.id).length,
      ...(s.excludeFromSuggestions ? { excludedFromSuggestions: true as const } : {}),
      ...(s.aisles ? { aisles: s.aisles } : {}),
      ...(s.aisleOrder ? { aisleOrder: s.aisleOrder } : {}),
    })),
    lists: [
      { id: null, name: replica.lib().groceryLists.HOME_LIST_NAME, items: count(null).length, checked: count(null).filter(e => e.checked).length },
      ...replica.groceryLists().map(l => ({ id: l.id, name: l.name, items: count(l.id).length, checked: count(l.id).filter(e => e.checked).length })),
    ],
    ...(() => {
      const trip = replica.activeTrip();
      return trip ? { trip: { store: trip.shop.name, startedAt: trip.startedAt, ...(trip.budgetMinor != null ? { budgetMinor: trip.budgetMinor } : {}) } } : {};
    })(),
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

// ---------------------------------------------------------------------------
// The list: ingredients, either/or, swaps, clearing, the trip
// ---------------------------------------------------------------------------

export interface AddIngredientsInput {
  /** A recipe, or leave out for the meal plan between from and to. */
  recipeId?: string;
  scale?: number;
  /** YYYY-MM-DD; default today. */
  from?: string;
  /** YYYY-MM-DD; default six days after from. */
  to?: string;
  list?: string;
  /** Names of rows to add beyond the default (rows thought to be on hand, staples, optional ones). */
  include?: string[];
  /** Names of rows the default would add, to leave off. */
  exclude?: string[];
}

/**
 * A recipe's ingredients, or the planned meals', onto a list as the app's two
 * sheets add them. Rows the app thinks are needed go on, the rest wait to be
 * asked for by name, and what is already in the cart is skipped.
 */
export function addIngredientsToList(replica: Replica, input: AddIngredientsInput) {
  const list = resolveList(replica, input.list);
  const listId = list?.id ?? null;
  if (input.scale !== undefined && !(input.scale > 0)) throw new Error('scale must be above zero (0.5 halves a recipe, 2 doubles it).');
  const from = input.from ?? replica.todayKey();
  const to = input.to ?? replica.shiftDayKey(from, 6);
  if (!input.recipeId && to < from) throw new Error('to is before from.');
  const rows = replica.plannedIngredients(input.recipeId ? { recipeId: input.recipeId, scale: input.scale } : { from, to }, listId);
  const named = (names: string[] | undefined) => new Set((names ?? []).map(n => replica.lib().groceryParse.groceryNameKey(n)));
  const include = named(input.include);
  const exclude = named(input.exclude);
  const unknown = [...include, ...exclude].filter(k => !rows.some(r => r.nameKey === k));
  if (unknown.length > 0) throw new Error(`Not among the ingredients: ${unknown.join(', ')}. Preview to see the rows.`);
  const chosen = rows.filter(r => r.category !== 'inCart' && !exclude.has(r.nameKey) && ((r.category === 'needToBuy' && !r.optional) || include.has(r.nameKey)));
  const result = replica.addPlannedToList(chosen.map(r => ({
    name: r.name, quantity: r.quantity || null, aisle: r.aisle,
    sourceRecipeId: r.sourceRecipeId ?? null, sourceRecipeTitle: r.sourceRecipeTitle ?? null, choiceGroup: r.choiceGroup,
  })), listId);
  const left = rows.filter(r => !chosen.includes(r));
  return {
    list: list?.name ?? 'home',
    added: result.added.map(i => i.name),
    alreadyOnList: result.alreadyOnList.map(i => i.name),
    toppedUp: result.toppedUp.map(i => `${i.name}: ${i.quantity}`),
    inCart: result.skippedInCart.map(i => i.name),
    leftOff: left.map(r => ({ name: r.name, why: r.category === 'inCart' ? 'already in the cart' : exclude.has(r.nameKey) ? 'left off' : r.optional ? 'optional in the recipe' : r.category === 'staple' ? 'a staple you keep' : r.category === 'probablyHave' ? `probably have it${r.reason ? ` (${r.reason})` : ''}` : r.category === 'alreadyOnList' ? 'already on the list' : r.category })),
    note: 'Rows the app thinks are on hand, staples and optional ones are left off; ask the person, and pass include with their names to add them.',
  };
}

export function addChoiceToList(replica: Replica, input: { options: { name: string; quantity?: string | null }[]; list?: string }) {
  const list = resolveList(replica, input.list);
  const added = replica.addChoiceToList(input.options, list?.id ?? null);
  return { list: list?.name ?? 'home', options: added.map(i => i.name), note: 'Checking one off in the app takes the others off the list. settle_choice decides it from here.' };
}

export function settleChoice(replica: Replica, input: { item: string; keepAll?: boolean; list?: string }) {
  const list = resolveList(replica, input.list);
  const item = itemByIdOrName(replica, input.item);
  const result = replica.settleChoice(item.id, list?.id ?? null, input.keepAll ?? false);
  return { kept: result.kept.map(i => i.name), removed: result.removed.map(i => i.name) };
}

export function swapForSubstitute(replica: Replica, input: { item: string; substitute: string; list?: string }) {
  const list = resolveList(replica, input.list);
  const item = itemByIdOrName(replica, input.item);
  const sub = itemByIdOrName(replica, input.substitute);
  const result = replica.swapForSubstitute(item.id, sub.id, list?.id ?? null);
  return { removed: result.removed.name, added: result.added.name, ...(result.added.quantity ? { quantity: result.added.quantity } : {}) };
}

export function clearGroceryList(replica: Replica, input: { list?: string }) {
  const list = resolveList(replica, input.list);
  const result = replica.clearGroceryList(list?.id ?? null);
  return {
    list: list?.name ?? 'home',
    cleared: result.cleared,
    deletedFromCatalog: result.deleted,
    note: 'Everything came off the list. Items with history stay in the catalog; ones with nothing recorded were deleted, as the app does. Any shopping trip was ended.',
  };
}

export function setShoppingTrip(replica: Replica, input: { store?: string; budget?: number | null; end?: boolean }) {
  const given = [input.store !== undefined, input.end === true].filter(Boolean).length;
  if (given > 1) throw new Error('Start a trip (store) or end one, not both.');
  const minor = input.budget === undefined || input.budget === null ? input.budget : Math.round(input.budget * 100);
  let trip;
  if (input.end) trip = replica.setTrip({ end: true });
  else if (input.store !== undefined) {
    const shop = resolveShop(replica, input.store);
    if (!shop) throw new Error('Name a store from grocery_setup.');
    trip = replica.setTrip(minor === undefined ? { shopId: shop.id } : { shopId: shop.id, budgetMinor: minor });
  } else if (minor !== undefined) trip = replica.setTrip({ budgetMinor: minor });
  else throw new Error('Give store to start a trip, budget to change its budget, or end: true.');
  return {
    trip: trip.shop ? { store: trip.shop.name, startedAt: trip.startedAt, ...(trip.budgetMinor != null ? { budget: trip.budgetMinor / 100 } : {}) } : null,
    note: 'The phone shows the trip (and its reminder to finish it) the next time it syncs. finish_grocery_trip records what was bought.',
  };
}

export function markUnavailable(replica: Replica, input: { item: string; store: string; unavailable?: boolean; brandOnly?: boolean }) {
  const item = itemByIdOrName(replica, input.item);
  const shop = resolveShop(replica, input.store);
  if (!shop) throw new Error('Name a store from grocery_setup.');
  const unavailable = input.unavailable ?? true;
  if (!unavailable && !input.brandOnly && !replica.itemShopLinks().some(l => l.itemId === item.id && l.shopId === shop.id && l.unavailableAt)) {
    throw new Error(`"${item.name}" isn't marked unavailable at ${shop.name}.`);
  }
  replica.setItemUnavailable(item.id, shop.id, unavailable, input.brandOnly ?? false);
  return { item: item.name, store: shop.name, unavailable, brandOnly: input.brandOnly ?? false };
}

export interface NutritionPanelInput {
  basis: 'per100g' | 'per100ml' | 'perServing';
  amounts: Record<string, number>;
  servingGrams?: number | null;
  servingText?: string | null;
  /** True when these are your estimate rather than read off a label. */
  estimated?: boolean;
}

export function setNutritionPanel(replica: Replica, input: { item: string; boxId?: string; panel: NutritionPanelInput | null }) {
  const item = itemByIdOrName(replica, input.item);
  let panel = null;
  if (input.panel) {
    const keys = NUTRIENT_KEYS as readonly string[];
    const amounts: Record<string, number> = {};
    for (const [k, v] of Object.entries(input.panel.amounts)) {
      if (!keys.includes(k)) throw new Error(`"${k}" isn't a nutrient the app keeps. They are ${keys.join(', ')}.`);
      if (typeof v !== 'number' || !(v >= 0)) throw new Error(`${k} must be a number, 0 or more.`);
      amounts[k] = v;
    }
    if (Object.keys(amounts).length === 0) throw new Error('A panel needs at least one figure. Absent is unknown, not zero, so leave out what the label does not say.');
    const box = input.boxId ? replica.itemProducts().find(p => p.id === input.boxId) : null;
    const previous = (input.boxId ? box?.nutrition : item.nutrition) ?? null;
    panel = {
      basis: input.panel.basis,
      servingGrams: input.panel.servingGrams && input.panel.servingGrams > 0 ? input.panel.servingGrams : null,
      servingText: input.panel.servingText?.trim() || null,
      amounts,
      source: input.panel.estimated ? 'estimated' as const : 'manual' as const,
      sourceId: null,
      portions: previous?.portions ?? [],
      recordedAt: new Date().toISOString(),
    };
  }
  replica.setNutritionPanel(item.id, input.boxId ?? null, panel);
  return { item: item.name, ...(input.boxId ? { boxId: input.boxId } : {}), panel: panel ? describeFoodPanel(panel) : null };
}

// ---------------------------------------------------------------------------
// Aisles and stores
// ---------------------------------------------------------------------------

export function saveAisle(replica: Replica, input: { name: string; newName?: string; delete?: boolean; nonFood?: boolean }) {
  if (input.delete && (input.newName !== undefined || input.nonFood !== undefined)) throw new Error('A delete takes nothing else.');
  const result = replica.saveAisle(input.name, { newName: input.newName, delete: input.delete, nonFood: input.nonFood });
  return { ...result, aisles: replica.aisleNames() };
}

export function reorderAisles(replica: Replica, names: string[]) {
  if (names.length === 0) throw new Error('Name the aisles to put first, in walk order.');
  return { aisles: replica.reorderAisles(names) };
}

export function updateStore(replica: Replica, input: { store: string; delete?: boolean; excludeFromSuggestions?: boolean; aisles?: string[] | null; aisleOrder?: string[] | null }) {
  const shop = resolveShop(replica, input.store);
  if (!shop) throw new Error(`No store "${input.store}". grocery_setup lists them.`);
  const { store: _s, delete: del, ...patch } = input;
  if (del) {
    if (Object.keys(patch).length > 0) throw new Error('A delete takes nothing else.');
    replica.deleteShop(shop.id);
    return { deleted: shop.name, note: 'Its item links, the prices recorded there and its receipt names went with it. The items stay in the catalog.' };
  }
  if (Object.keys(patch).length === 0) throw new Error('Nothing to change: give delete, excludeFromSuggestions, aisles or aisleOrder.');
  const updated = replica.updateShopSettings(shop.id, patch);
  return { store: { id: updated.id, name: updated.name, ...(updated.excludeFromSuggestions ? { excludedFromSuggestions: true } : {}), ...(updated.aisles ? { aisles: updated.aisles } : {}), ...(updated.aisleOrder ? { aisleOrder: updated.aisleOrder } : {}) } };
}

export function reorderGroceryPlaces(replica: Replica, input: { stores?: string[]; lists?: string[] }) {
  if (!input.stores?.length && !input.lists?.length) throw new Error('Give stores or lists to put first.');
  if (input.stores?.length) {
    const ids = input.stores.map(ref => { const sh = resolveShop(replica, ref); if (!sh) throw new Error(`No store "${ref}".`); return sh.id; });
    replica.reorderShops(ids);
  }
  if (input.lists?.length) {
    const ids = input.lists.map(ref => { const l = resolveList(replica, ref); if (!l) throw new Error('The list at home has no place in the order; name separate lists.'); return l.id; });
    replica.reorderGroceryLists(ids);
  }
  return grocerySetup(replica);
}

export function mergeGroceryItems(replica: Replica, input: { from: string; into: string }) {
  const from = itemByIdOrName(replica, input.from);
  const into = itemByIdOrName(replica, input.into);
  const result = replica.mergeGroceryItems(from.id, into.id);
  return {
    merged: getGroceryItem(replica, { id: result.merged.id }),
    gone: result.from.name,
    note: `"${result.from.name}" is now part of "${result.merged.name}": its purchase history, brands, store links and prices, substitutes, receipt names, list entries and recipe lines moved over. This cannot be undone from Activity.`,
  };
}
