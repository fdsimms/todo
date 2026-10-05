/**
 * What each catalog edit does to a row, decided and written by nobody.
 *
 * The same lift `pantryWrite.ts` made for the pantry: `useGroceryStore` cannot
 * load in Node, and each of its catalog edits was a row transform fused to a
 * `set()`. The transform is here so the store and the MCP replica call one
 * implementation. Everything is pure; a caller owns the db write and any state.
 */
import type {
  GroceryItem, GroceryList, ItemProduct, ItemShopLink, ItemSubLink, ProductRating, Shop, StoreAlias,
} from '../types';
import { isPortionBox } from '../types';
import { groceryNameKey } from './groceryParse';
import { productKeyFor } from './groceryProduct';
import { HOME_LIST_NAME, isAwayList, itemsOnList } from './groceryLists';
import { expiresAtForPurchase } from './groceryShelfLife';
import { aliasKeyFor } from './storeAliases';
import type { GroceryListEntry } from '../types';

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

/**
 * A hand-set price. The quantity it is a price *for* is the row's current one,
 * cleared with the price so a stale quantity never describes a number that is
 * gone; a quantity a recipe wrote is a cooking amount, not a pack, so it pairs
 * with nothing. With a link in hand the same answer goes on it, and a price is
 * not an assertion that the store stocks the item, so no link is ever minted.
 */
export function pricedRows(
  item: GroceryItem,
  link: ItemShopLink | undefined,
  minor: number | null,
  nowIso: string
): { item: GroceryItem; link: ItemShopLink | null } {
  const at = minor === null ? null : nowIso;
  const quantity = minor === null || item.quantityFromRecipe ? null : item.quantity;
  return {
    item: { ...item, lastPriceMinor: minor, lastPricedAt: at, lastPriceQuantity: quantity },
    link: link ? { ...link, lastPriceMinor: minor, lastPricedAt: at, lastPriceQuantity: quantity } : null,
  };
}

// ---------------------------------------------------------------------------
// Boxes (brands and variants)
// ---------------------------------------------------------------------------

export interface ProductPatch {
  brand?: string | null;
  variant?: string | null;
  note?: string;
  rating?: ProductRating | null;
}

/**
 * Edit a box's words. A portion has no brand or variant, a box with no words
 * left is the item itself (delete it instead), and a clash with a sibling would
 * trip the UNIQUE index, so each is refused with the reason.
 */
export function productEditRow(
  product: ItemProduct,
  siblings: readonly ItemProduct[],
  patch: ProductPatch
): { row: ItemProduct } | { refusal: string } {
  if (isPortionBox(product)) return { refusal: 'A frozen portion has no brand or variant to edit.' };
  const brand = patch.brand === undefined ? product.brand : patch.brand?.trim() || null;
  const variant = patch.variant === undefined ? product.variant : patch.variant?.trim() || null;
  const productKey = productKeyFor(brand, variant);
  if (!productKey) return { refusal: 'A box needs a brand or a variant. Delete the box to clear it.' };
  if (siblings.some(p => p.itemId === product.itemId && p.id !== product.id && p.productKey === productKey)) {
    return { refusal: 'This item already has a box with that brand and variant.' };
  }
  return {
    row: {
      ...product,
      brand,
      variant,
      productKey,
      note: patch.note === undefined ? product.note : patch.note.trim(),
      rating: patch.rating === undefined ? product.rating : patch.rating,
    },
  };
}

/** The preferred box: only ever one of this item's own, and never a portion. Null when nothing changes. */
export function preferredProductRow(
  item: GroceryItem,
  products: readonly ItemProduct[],
  productId: string | null
): GroceryItem | null {
  const next = productId && products.some(p => p.id === productId && p.itemId === item.id && !isPortionBox(p))
    ? productId
    : null;
  return next === item.preferredProductId ? null : { ...item, preferredProductId: next };
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

/**
 * A rename. Refused when the name is empty or its key belongs to another item.
 * Variety declarations aimed at the old key follow the rename, and the
 * caller moves the remembered aisle and the recipe keys (`renameRememberedAisle`,
 * `remapIngredientKeyIn`).
 */
export function renameRows(
  items: readonly GroceryItem[],
  id: string,
  name: string
): { refusal: string } | { item: GroceryItem; repointed: GroceryItem[]; oldKey: string; key: string } {
  const item = items.find(i => i.id === id);
  if (!item) return { refusal: `No grocery item with id ${id}.` };
  const trimmed = name.trim();
  const key = trimmed ? groceryNameKey(trimmed) : '';
  if (!key) return { refusal: 'An item needs a name.' };
  if (key !== item.nameKey && items.some(i => i.nameKey === key)) {
    return { refusal: `There is already an item called "${items.find(i => i.nameKey === key)!.name}". Merging two items is done in the app.` };
  }
  const renamed: GroceryItem = {
    ...item,
    name: trimmed,
    nameKey: key,
    // A thing is not a variety of itself.
    varietyOfKey: item.varietyOfKey === key ? null : item.varietyOfKey,
    // Somebody chose this name, so it is no longer a barcode source's words.
    nameFromScan: false,
  };
  const repointed = key === item.nameKey
    ? []
    : items.filter(o => o.id !== id && o.varietyOfKey === item.nameKey).map(o => ({ ...o, varietyOfKey: key }));
  return { item: renamed, repointed, oldKey: item.nameKey, key };
}

// ---------------------------------------------------------------------------
// Which store an item comes from
// ---------------------------------------------------------------------------

/**
 * "You can get it here." An existing positive link already says so (null);
 * a negative one is corrected, keeping whatever purchases it carries. A new
 * link has purchaseCount 0, the assertion that nobody has bought it there yet.
 */
export function shopLinkRow(existing: ItemShopLink | undefined, itemId: string, shopId: string): ItemShopLink | null {
  if (existing && !existing.unavailableAt) return null;
  return {
    itemId,
    shopId,
    purchaseCount: existing?.purchaseCount ?? 0,
    lastPurchasedAt: existing?.lastPurchasedAt ?? null,
    unavailableAt: null,
    productId: existing?.productId ?? null,
    unavailableProductIds: existing?.unavailableProductIds ?? {},
    lastPriceMinor: existing?.lastPriceMinor ?? null,
    lastPricedAt: existing?.lastPricedAt ?? null,
    lastPriceQuantity: existing?.lastPriceQuantity ?? null,
    priceHistory: existing?.priceHistory ?? [],
  };
}

/** A new store. Null when the name is empty or its key is taken. */
export function newShopRow(name: string, shops: readonly Shop[], id: string, nowIso: string): Shop | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const key = groceryNameKey(trimmed) || trimmed.toLowerCase();
  if (shops.some(s => s.nameKey === key)) return null;
  return {
    id,
    name: trimmed,
    nameKey: key,
    sortOrder: shops.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1,
    createdAt: nowIso,
    excludeFromSuggestions: false,
    receiptStyle: 'itemized',
    aisles: null,
    aisleOrder: null,
  };
}

/** A renamed store. Null when the name is empty or another store has the key. */
export function renamedShopRow(shop: Shop, name: string, shops: readonly Shop[]): Shop | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const key = groceryNameKey(trimmed) || trimmed.toLowerCase();
  if (key !== shop.nameKey && shops.some(s => s.nameKey === key)) return null;
  return { ...shop, name: trimmed, nameKey: key };
}

// ---------------------------------------------------------------------------
// Substitutes
// ---------------------------------------------------------------------------

export interface SubLinkOptions {
  note?: string | null;
  ratioFrom?: string | null;
  ratioTo?: string | null;
  standing?: boolean;
  bothWays?: boolean;
}

/** One standing answer per item, and no pair pointing at each other. */
export function clearOtherStandingLinks(links: readonly ItemSubLink[], itemId: string, subItemId: string): ItemSubLink[] {
  return links
    .filter(l => l.standing)
    .filter(l =>
      (l.itemId === itemId && l.subItemId !== subItemId)
      || (l.itemId === subItemId && l.subItemId === itemId))
    .map(l => ({ ...l, standing: false }));
}

/**
 * "Use B when out of A." A ratio needs both halves; the reverse row (bothWays)
 * carries the same note with the ratio swapped and is never standing, since a
 * pair of standing rules pointing at each other swaps into itself. Standing
 * clears the rows it would conflict with. Null for a self-link.
 */
export function subLinkRows(
  itemId: string,
  subItemId: string,
  existing: readonly ItemSubLink[],
  opts: SubLinkOptions,
  nowIso: string
): { written: ItemSubLink[]; cleared: ItemSubLink[] } | null {
  if (itemId === subItemId) return null;
  const note = opts.note?.trim() || null;
  const ratioFrom = opts.ratioFrom?.trim() || null;
  const ratioTo = opts.ratioTo?.trim() || null;
  const hasRatio = !!ratioFrom && !!ratioTo;
  const standing = !!opts.standing;
  const pairs: Array<[string, string, string | null, string | null, boolean]> = [
    [itemId, subItemId, hasRatio ? ratioFrom : null, hasRatio ? ratioTo : null, standing],
  ];
  if (opts.bothWays) pairs.push([subItemId, itemId, hasRatio ? ratioTo : null, hasRatio ? ratioFrom : null, false]);
  const written = pairs.map(([a, b, rFrom, rTo, isStanding]): ItemSubLink => ({
    itemId: a,
    subItemId: b,
    note,
    createdAt: existing.find(l => l.itemId === a && l.subItemId === b)?.createdAt ?? nowIso,
    ratioFrom: rFrom,
    ratioTo: rTo,
    standing: isStanding,
  }));
  return { written, cleared: standing ? clearOtherStandingLinks(existing, itemId, subItemId) : [] };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/**
 * Why a list cannot take this name, or null. Compared case-insensitively and
 * against the home list's own name too: a second "Groceries" would be two rows
 * in the picker saying the same thing.
 */
export function listNameProblem(name: string, lists: readonly GroceryList[], ignoreId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'A list needs a name.';
  const same = (n: string) => n.trim().toLowerCase() === trimmed.toLowerCase();
  if (same(HOME_LIST_NAME)) return `"${HOME_LIST_NAME}" is the list at home.`;
  if (lists.some(l => l.id !== ignoreId && same(l.name))) return `There is already a list called "${trimmed}".`;
  return null;
}

export function newListRow(name: string, lists: readonly GroceryList[], id: string, nowIso: string): GroceryList {
  return {
    id,
    name: name.trim(),
    sortOrder: lists.reduce((max, l) => Math.max(max, l.sortOrder), 0) + 1,
    createdAt: nowIso,
  };
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

/**
 * The alias row to hand the db for "this receipt text at this store is that
 * item". The upsert bumps the count itself, since only SQLite knows whether the
 * pair was already there.
 */
export function aliasRow(
  existing: readonly StoreAlias[],
  shopId: string | null,
  rawText: string,
  itemId: string,
  id: string,
  nowIso: string
): StoreAlias | null {
  const rawKey = aliasKeyFor(rawText);
  if (!rawKey) return null;
  const shop = shopId ?? '';
  const prior = existing.find(a => a.shopId === shop && a.rawKey === rawKey);
  return {
    id: prior?.id ?? id,
    shopId: shop,
    rawKey,
    itemId,
    hitCount: prior ? prior.hitCount + 1 : 1,
    createdAt: prior?.createdAt ?? nowIso,
    lastUsedAt: nowIso,
  };
}

// ---------------------------------------------------------------------------
// Finishing a trip
// ---------------------------------------------------------------------------

export interface FinishShoppingPlan {
  /** The store the trip is recorded against, or null (unknown, or away). */
  shopId: string | null;
  /** The use-by day for each ticked row the shelf-life lexicon recognises. */
  expiresAtById: Record<string, string>;
  priceById: Record<string, number>;
  away: boolean;
}

/**
 * What finishing a list records. **An away trip records nothing**: no store, no
 * use-by day, no prices (see `GroceryList`). A store deleted since it was
 * chosen is dropped rather than written as a link nothing can resolve.
 */
export function planFinishShopping(input: {
  items: readonly GroceryItem[];
  entries: readonly GroceryListEntry[];
  shops: readonly Shop[];
  listId: string | null;
  shopId: string | null;
  priceById: Readonly<Record<string, number>>;
  purchasedAt: string;
}): FinishShoppingPlan {
  const away = isAwayList(input.listId);
  const shop = !away && input.shopId ? input.shops.find(s => s.id === input.shopId) ?? null : null;
  const expiresAtById: Record<string, string> = {};
  if (!away) {
    const now = new Date(input.purchasedAt);
    for (const i of itemsOnList([...input.items], [...input.entries], input.listId)) {
      if (!i.checked) continue;
      const expires = expiresAtForPurchase(i, now);
      if (expires) expiresAtById[i.id] = expires;
    }
  }
  return { shopId: shop?.id ?? null, expiresAtById, priceById: away ? {} : { ...input.priceById }, away };
}

// ---------------------------------------------------------------------------
// Deleting an item
// ---------------------------------------------------------------------------

/**
 * Everything `dbDeleteGroceryItem` removes with an item, captured so a delete
 * can be put back. The app keeps no such snapshot, which is why it has no
 * undo; the agent ledger records this one.
 */
export interface DeletedItemSnapshot {
  item: GroceryItem;
  entries: GroceryListEntry[];
  boxes: ItemProduct[];
  shopLinks: ItemShopLink[];
  subLinks: ItemSubLink[];
  aliases: StoreAlias[];
  /** The remembered aisle for the item's name, which a delete leaves standing. */
  aisleOverride: string | null;
}

export function deletedItemSnapshot(
  id: string,
  rows: {
    items: readonly GroceryItem[];
    entries: readonly GroceryListEntry[];
    boxes: readonly ItemProduct[];
    shopLinks: readonly ItemShopLink[];
    subLinks: readonly ItemSubLink[];
    aliases: readonly StoreAlias[];
    aisleOverrides: Readonly<Record<string, string>>;
  }
): DeletedItemSnapshot | null {
  const item = rows.items.find(i => i.id === id);
  if (!item) return null;
  return {
    item: { ...item },
    entries: rows.entries.filter(e => e.itemId === id).map(e => ({ ...e })),
    boxes: rows.boxes.filter(b => b.itemId === id).map(b => ({ ...b })),
    shopLinks: rows.shopLinks.filter(l => l.itemId === id).map(l => ({ ...l })),
    subLinks: rows.subLinks.filter(l => l.itemId === id || l.subItemId === id).map(l => ({ ...l })),
    aliases: rows.aliases.filter(a => a.itemId === id).map(a => ({ ...a })),
    aisleOverride: rows.aisleOverrides[item.nameKey] ?? null,
  };
}
