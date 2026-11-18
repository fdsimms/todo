import React from 'react';
import { useGroceryStore } from '../store/useGroceryStore';
import type { ScannedGtinLink } from '../utils/scanResolve';
import { saveScanToCatalog } from '../utils/scanCatalogWrite';
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
 * The write is `saveScanToCatalog`, the same one the food log's scan makes: its
 * doc comment holds the order and the reasons.
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
    saveScanToCatalog({ ensureCatalogItem, addProduct, linkScannedGtins }, toAdd, products, gtinLinks);
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
