import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { GroceryItem, MealSlot } from '../types';
import { useGroceryStore } from '../store/useGroceryStore';
import { nutritionFor } from '../utils/foodNutrition';
import { describeProduct } from '../utils/groceryProduct';
import type { ScannedGtinLink } from '../utils/scanResolve';
import { BarcodeScanSheet, type ScanProductDraft } from './BarcodeScanSheet';
import { NutritionPanelSheet } from './NutritionPanelSheet';
import { ScanPortionSheet, type ScannedFood } from './ScanPortionSheet';
import type { ReceiptAddDraft } from './ReceiptImportSheet';

/**
 * Logging a food by scanning its barcode, start to finish.
 *
 * **The three sheets are one flow, which is why they live together.** A scan
 * session resolves to catalog rows here, `ScanPortionSheet` asks the amount a
 * barcode can't answer, and `NutritionPanelSheet` is the way out when the code
 * carried no figures at all. Only the first of the three is opened by the
 * caller; the other two are opened by what the scan turned up, so a caller that
 * mounted them itself would be holding state it has no part in.
 *
 * **It is mounted by anywhere a food can be logged**, not only by
 * `FoodLogScreen` — `LogMealEntrySheet` offers the same scan from the planned
 * meal prompt, which can be reached from Today, Search, Stuck or the widget.
 * That is the whole reason this is a component rather than a handler on the
 * screen: the flow was written once for the screen and the second caller needed
 * every line of it.
 */
interface Props {
  /** Whether the scanner itself is open. The sheets after it run on their own. */
  visible: boolean;
  /** Which meal whatever is scanned lands in. */
  slot: MealSlot | null;
  /** The logical day being logged, so a backdated scan lands where it is shown. */
  at: Date;
  /**
   * The planned meal this scan is logging, carried onto the entry — the same
   * link `FoodLogEntrySheet` carries for the caller that has one. Omitted
   * everywhere else, since a plain "log a food" scan has no meal plan row to
   * point back at.
   */
  mealPlanEntryId?: string | null;
  /** The scanner closed, by cancelling or by being handed on. */
  onClose: () => void;
}

/** A stable empty list, so a closed amount sheet doesn't remount on every render. */
const EMPTY_FOODS: ScannedFood[] = [];

export function ScanToLogFlow({ visible, slot, at, mealPlanEntryId, onClose }: Props) {
  const items = useGroceryStore(useShallow(s => s.items));
  const ensureCatalogItem = useGroceryStore(s => s.ensureCatalogItem);
  const addProduct = useGroceryStore(s => s.addProduct);
  const setItemNutrition = useGroceryStore(s => s.setItemNutrition);
  const setProductNutrition = useGroceryStore(s => s.setProductNutrition);
  const linkScannedGtins = useGroceryStore(s => s.linkScannedGtins);
  const gtinProductFor = useGroceryStore(s => s.gtinProductFor);

  /**
   * What the scan turned up, and the three things the entries it becomes are
   * stamped with.
   *
   * The context is copied out of the props rather than read from them at
   * render time, because the scanner closing is what tells a caller its scan
   * is over: `LogMealEntrySheet` drops the meal it was logging the moment
   * that happens, and the amount sheet still open behind it would otherwise
   * be asking about a meal, a day and a slot that had all just gone null.
   */
  const [session, setSession] = useState<
    { foods: ScannedFood[]; slot: MealSlot | null; at: Date; mealPlanEntryId: string | null } | null
  >(null);
  /**
   * The scanned food whose label is being typed or photographed in, or null.
   *
   * Held here rather than pushed onto the grocery screens because this is where
   * the person hit the wall: a barcode that carried no figures is discovered
   * while logging, and sending them off to find the catalog row is how a
   * two-tap fix becomes an errand.
   */
  const [panelFor, setPanelFor] = useState<{ itemId: string; productId: string | null; name: string } | null>(null);

  /**
   * A scan session, confirmed. Resolved to catalog rows, then handed on.
   *
   * **Nothing is logged here.** A barcode says what a thing is and never how
   * much of it was eaten, so this does the resolving a code *can* answer and
   * `ScanPortionSheet` asks the one it can't. Defaulting to a serving would put
   * a number nobody stated into a day's totals.
   *
   * The catalog write is deliberately `ensureCatalogItem` rather than
   * `addByName`, which is the same restraint `KitchenScreen`'s own scan handler
   * takes: eating something is not a plan to buy it, so a row minted here
   * arrives off the list. Everything else is `GroceryScreen.handleScanApply`'s
   * sequence and has to stay in that order — the boxes first, so a link finds
   * one, and `linkScannedGtins` last, since that is what carries the label
   * panel off the barcode cache and onto the box this is about to read.
   *
   * A row whose panel is still null after all that is dropped rather than
   * offered: a source that stated no nutrients has nothing a total could use,
   * and an entry built from it would record a name and no figures.
   */
  const handleScanApply = (
    itemIds: string[],
    toAdd: ReceiptAddDraft[],
    _frozenItemIds: ReadonlySet<string>,
    products: ScanProductDraft[],
    gtinLinks: ScannedGtinLink[]
  ) => {
    // Keyed rather than looked up in `items`, which is a render snapshot: a row
    // `ensureCatalogItem` mints two lines down isn't in it, and reading through
    // it would silently drop exactly the rows this scan just created.
    const resolved = new Map<string, GroceryItem>();
    for (const id of itemIds) {
      const item = items.find(i => i.id === id);
      if (item) resolved.set(id, item);
    }
    const mintedLinks: ScannedGtinLink[] = [];
    const packSizes = new Map<string, string>();
    for (const product of products) {
      if (product.packSize) packSizes.set(product.itemId, product.packSize);
    }
    for (const draft of toAdd) {
      const item = draft.existingItemId
        ? items.find(i => i.id === draft.existingItemId)
        // Same flag `GroceryScreen.handleScanApply` passes, for the same row:
        // a name the sheet proposed and nobody edited is the source's words.
        : ensureCatalogItem(draft.name, { nameFromScan: draft.nameFromScan === true });
      if (!item) continue;
      const id = item.id;
      resolved.set(id, item);
      if (draft.quantity) packSizes.set(id, draft.quantity);
      if (!draft.existingItemId && draft.gtin) {
        // Brand-only, matching what a minted row is named after: there is no
        // existing item name left for a variant to be the residue of.
        if (draft.brand) addProduct(id, { brand: draft.brand, variant: null });
        mintedLinks.push({ gtin: draft.gtin, itemId: id, brand: draft.brand, variant: null });
      }
    }
    for (const product of products) {
      addProduct(product.itemId, { brand: product.brand, variant: product.variant });
    }
    linkScannedGtins([...gtinLinks, ...mintedLinks]);

    const gtinByItemId = new Map(
      [...gtinLinks, ...mintedLinks].map(link => [link.itemId, link.gtin])
    );
    const foods: ScannedFood[] = [];
    const unpanelled: { itemId: string; productId: string | null; name: string }[] = [];
    for (const [id, item] of resolved) {
      // The box this barcode names, which `linkScannedGtins` has just given the
      // panel to. Its own figures outrank the catalog row's, for the reason
      // `nutritionFor` gives: a specific pot is a better answer than the food.
      const linked = gtinProductFor(gtinByItemId.get(id) ?? null);
      const box = linked?.itemId === id ? linked : null;
      const panel = nutritionFor(item, box);
      // Nothing to log, rather than a panel written somewhere it doesn't
      // belong. A scanned code whose source stated figures but no brand has no
      // box to hang them on, and filing a specific loaf's label onto the "Bread"
      // row would make every future helping of bread claim that loaf's numbers.
      // Refuse rather than approximate, same as everywhere else in this tree.
      if (!panel) {
        // Remembered rather than merely skipped: this is the exact moment a
        // person learns the barcode carried no figures, and the packet is
        // still in their hand. See `unpanelled` below.
        unpanelled.push({ itemId: id, productId: box?.id ?? null, name: item.name });
        continue;
      }
      const boxWords = describeProduct(box);
      foods.push({
        key: id,
        label: boxWords ? `${item.name}, ${boxWords}` : item.name,
        panel,
        packSize: packSizes.get(id) ?? null,
        itemId: id,
        productId: box?.id ?? null,
      });
    }
    onClose();
    if (foods.length === 0) {
      // The packet is in their hand and it has the figures printed on it, so
      // the honest answer here is an offer rather than only a refusal. It takes
      // the first, since the panel sheet edits one food and doing several means
      // doing them one at a time regardless — the copy says so when there are
      // more.
      const first = unpanelled[0];
      const rest = unpanelled.length - 1;
      Alert.alert(
        'No nutrition on it yet',
        `A food can be logged once its figures are the food's own rather than a guess.${
          first ? ` You can read them off the packet for ${first.name}${
            rest > 0 ? `, then the other ${rest === 1 ? 'one' : `${rest}`} the same way` : ''
          }.` : ''
        }`,
        first
          ? [
            { text: 'Not now', style: 'cancel' },
            { text: 'Add its label', onPress: () => setPanelFor(first) },
          ]
          : undefined,
      );
      return;
    }
    setSession({ foods, slot, at, mealPlanEntryId: mealPlanEntryId ?? null });
  };

  return (
    <>
      <BarcodeScanSheet
        visible={visible}
        context="log"
        onClose={onClose}
        onApply={handleScanApply}
      />
      <ScanPortionSheet
        visible={session !== null}
        foods={session?.foods ?? EMPTY_FOODS}
        slot={session?.slot ?? null}
        at={session?.at ?? at}
        mealPlanEntryId={session?.mealPlanEntryId ?? null}
        onClose={() => setSession(null)}
      />
      <NutritionPanelSheet
        visible={panelFor !== null}
        foodName={panelFor?.name ?? ''}
        nutrition={null}
        onClose={() => setPanelFor(null)}
        onSave={panel => {
          if (!panelFor) return;
          // Onto the box when the scan named one, onto the catalog row when it
          // didn't — the same precedence `nutritionFor` reads them back in, so
          // a specific packet's figures never become every future helping of
          // the generic food's.
          if (panelFor.productId) setProductNutrition(panelFor.productId, panel);
          else setItemNutrition(panelFor.itemId, panel);
        }}
      />
    </>
  );
}
