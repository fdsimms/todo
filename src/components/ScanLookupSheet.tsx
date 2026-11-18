import React from 'react';
import { useGroceryStore } from '../store/useGroceryStore';
import type { ScannedGtinLink } from '../utils/scanResolve';
import { haptics } from '../utils/haptics';
import { BarcodeScanSheet, type ScanProductDraft } from './BarcodeScanSheet';
import type { ReceiptAddDraft } from './ReceiptImportSheet';

/**
 * "Look up a barcode": scan something to see what it is and what is in it,
 * without saying you have it or ate it.
 *
 * **Saving writes the catalog and nothing else.** A checked row becomes a
 * catalog item (found or minted off the list), the box its barcode names, and
 * the barcode link that carries the label panel off the barcode cache and onto
 * that box. It never puts anything on the shopping list, in the pantry or in the
 * food log, and it records no price, since a shelf price isn't a purchase. A row
 * that is not checked writes nothing at all, and closing writes nothing.
 *
 * The write is `ScanToLogFlow.handleScanApply`'s catalog half, in the same
 * order and for the same reasons (the boxes first so a link finds one,
 * `linkScannedGtins` last), with `ensureCatalogItem` rather than `addByName`
 * so a minted row arrives off the list and `{ promote: false }` so recording a
 * box is not choosing it for the next shop.
 *
 * Mounted by Groceries, Pantry and the food log, each behind the same
 * `barcodeScanning` switch as their other scan action.
 */
interface Props {
  visible: boolean;
  onClose: () => void;
}

export function ScanLookupSheet({ visible, onClose }: Props) {
  const ensureCatalogItem = useGroceryStore(s => s.ensureCatalogItem);
  const addProduct = useGroceryStore(s => s.addProduct);
  const linkScannedGtins = useGroceryStore(s => s.linkScannedGtins);

  const handleApply = (
    _itemIds: string[],
    toAdd: ReceiptAddDraft[],
    _frozenItemIds: ReadonlySet<string>,
    products: ScanProductDraft[],
    gtinLinks: ScannedGtinLink[]
  ) => {
    const mintedLinks: ScannedGtinLink[] = [];
    for (const draft of toAdd) {
      // An off-list match already has its box and link in `products` and
      // `gtinLinks`: the sheet knew its id. Only a row this mints needs them made.
      if (draft.existingItemId) continue;
      const item = ensureCatalogItem(draft.name, { nameFromScan: draft.nameFromScan === true });
      if (!item) continue;
      if (draft.gtin) {
        const variant = draft.variant ?? null;
        if (draft.brand || variant) addProduct(item.id, { brand: draft.brand, variant }, { promote: false });
        mintedLinks.push({ gtin: draft.gtin, itemId: item.id, brand: draft.brand, variant });
      }
    }
    for (const product of products) {
      addProduct(product.itemId, { brand: product.brand, variant: product.variant }, { promote: false });
    }
    linkScannedGtins([...gtinLinks, ...mintedLinks]);
    haptics.success();
    onClose();
  };

  return (
    <BarcodeScanSheet
      visible={visible}
      context="lookup"
      onClose={onClose}
      onApply={handleApply}
    />
  );
}
