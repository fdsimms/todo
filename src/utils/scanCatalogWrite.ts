import type { GroceryItem } from '../types';
import type { ScannedGtinLink } from './scanResolve';

/**
 * Filing a confirmed scan session into the grocery catalog, and nothing else.
 *
 * **The catalog half of a scan, shared by the two scans that record a thing
 * without buying it:** the food log's (`ScanToLogFlow`) and Look up a barcode
 * (`ScanLookupSheet`). Neither puts anything on the shopping list, so a row
 * this mints comes in off it (`ensureCatalogItem`, never `addByName`) and a box
 * is recorded without being preferred (`promote: false`): eating or looking at
 * a packet is not choosing it for the next shop. `GroceryScreen`'s own handler
 * is not this: it mints onto the list with a quantity and an aisle, so it keeps
 * its own writes.
 *
 * **The order is the rule.** A row's box is filed before the barcode links, and
 * the links go last, because a link finds its box by the brand and variant the
 * earlier writes just filed. Run earlier, every scan would land on the
 * item-level fallback and never on the box it actually read, which is also what
 * carries the label panel off the barcode cache onto that box.
 *
 * Actions are passed in rather than read from the store so the order can be
 * checked without one.
 */
export interface ScanCatalogActions {
  ensureCatalogItem: (name: string, opts?: { nameFromScan?: boolean }) => GroceryItem | null;
  addProduct: (
    itemId: string,
    product: { brand: string | null; variant: string | null },
    opts: { promote: false }
  ) => unknown;
  linkScannedGtins: (links: ScannedGtinLink[]) => void;
}

/** The slice of a scan sheet draft this reads; `ReceiptAddDraft` satisfies it. */
export interface ScanCatalogDraft {
  existingItemId: string | null;
  name: string;
  brand: string | null;
  variant?: string | null;
  gtin?: string | null;
  nameFromScan?: boolean;
}

/** The slice of a matched row's box this reads; `ScanProductDraft` satisfies it. */
export interface ScanCatalogProduct {
  itemId: string;
  brand: string | null;
  variant: string | null;
}

export function saveScanToCatalog<D extends ScanCatalogDraft>(
  actions: ScanCatalogActions,
  toAdd: readonly D[],
  products: readonly ScanCatalogProduct[],
  gtinLinks: readonly ScannedGtinLink[]
): { minted: { draft: D; item: GroceryItem }[]; mintedLinks: ScannedGtinLink[] } {
  const minted: { draft: D; item: GroceryItem }[] = [];
  const mintedLinks: ScannedGtinLink[] = [];
  for (const draft of toAdd) {
    // An off-list match already has its box and link in `products` and
    // `gtinLinks`: the sheet knew its id. Only a row this mints needs them made.
    if (draft.existingItemId) continue;
    // Only true when the proposed name went through untouched, which files the
    // row for renaming instead of leaving a product database's phrasing for good.
    const item = actions.ensureCatalogItem(draft.name, { nameFromScan: draft.nameFromScan === true });
    if (!item) continue;
    minted.push({ draft, item });
    if (draft.gtin) {
      // A variant only when the name was shortened; an untouched name already
      // holds every word the source had.
      const variant = draft.variant ?? null;
      if (draft.brand || variant) actions.addProduct(item.id, { brand: draft.brand, variant }, { promote: false });
      mintedLinks.push({ gtin: draft.gtin, itemId: item.id, brand: draft.brand, variant });
    }
  }
  for (const product of products) {
    actions.addProduct(product.itemId, { brand: product.brand, variant: product.variant }, { promote: false });
  }
  actions.linkScannedGtins([...gtinLinks, ...mintedLinks]);
  return { minted, mintedLinks };
}
