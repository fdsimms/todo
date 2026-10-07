import type { GroceryItem, GroceryListEntry, ItemProduct, ItemShopLink, ItemSubLink, PriceObservation } from '../types';
import { describeQuantities } from './mealPlanGroceries';
import { mergePriceHistories } from './priceHistory';
import { mergedItemRow } from './groceryItemWrite';

/**
 * Merging one catalog item into another: every row the merge writes, worked
 * out from the rows as they stand. The store's `mergeItems` writes this with
 * its undo and the device work around it, and the MCP server's
 * `merge_grocery_items` writes the same rows.
 */

/**
 * The later of two ISO stamps, treating null as older than any of them —
 * i.e. an explicit assertion always beats no assertion. Used for every "which
 * of two timestamps wins" question, including `onHandUntil`:
 * `OUT_OF_IT_UNTIL` is deliberately the oldest possible stamp, so it loses to
 * a real "on hand until" date exactly the way a stale out-of-it claim should
 * when the other row has a fresher one.
 */
export function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** The three price fields, moved as a group from whichever side was priced more recently — never averaged. */
export function pickPriceFields<
  T extends { lastPriceMinor: number | null; lastPricedAt: string | null; lastPriceQuantity: string | null },
>(a: T, b: T): Pick<T, 'lastPriceMinor' | 'lastPricedAt' | 'lastPriceQuantity'> {
  const winner = !a.lastPricedAt ? b : !b.lastPricedAt || a.lastPricedAt >= b.lastPricedAt ? a : b;
  return {
    lastPriceMinor: winner.lastPriceMinor,
    lastPricedAt: winner.lastPricedAt,
    lastPriceQuantity: winner.lastPriceQuantity,
  };
}

export interface MergeRows {
  items: readonly GroceryItem[];
  itemShops: readonly ItemShopLink[];
  itemSubs: readonly ItemSubLink[];
  itemProducts: readonly ItemProduct[];
  listEntries: readonly GroceryListEntry[];
}

export interface MergePlan {
  fromItem: GroceryItem;
  intoItem: GroceryItem;
  /** The survivor as it will be written. */
  merged: GroceryItem;
  /** Other items whose "kind of" pointed at the loser, pointed at the survivor. */
  repointedVarieties: Map<string, GroceryItem>;
  /** Every box the survivor will hold, the loser's folded in. */
  mergedProducts: ItemProduct[];
  /** One link per store either side had one at. */
  mergedShopLinks: ItemShopLink[];
  /** The substitute links neither end of which was the loser, unchanged. */
  survivingSubs: ItemSubLink[];
  /** The loser's links, retargeted onto the survivor. */
  finalRetargetedSubs: ItemSubLink[];
  /** List entries to write for the survivor. */
  movedEntries: GroceryListEntry[];
  /** The loser's entries, to take off every list. */
  removedEntries: { itemId: string; listId: string | null }[];
  /**
   * A loser's box id → the survivor's box that now stands for it, for the
   * pointers outside these rows (food log entries, saved meals) that the
   * caller repoints with `dbRepointItemReferences`.
   */
  productIdRemap: ReadonlyMap<string, string>;
}

export function planMergeItems(fromId: string, intoId: string, rows: MergeRows): MergePlan | null {
  if (fromId === intoId) return null;
  const { items, itemShops, itemSubs, itemProducts } = rows;
  const fromItem = items.find(i => i.id === fromId);
  const intoItem = items.find(i => i.id === intoId);
  if (!fromItem || !intoItem) return null;
  const beforeListEntries = rows.listEntries.filter(e => e.itemId === fromId || e.itemId === intoId);

  const onList = fromItem.onList || intoItem.onList;
  let quantity: string | null;
  let quantityFromRecipe: boolean;
  if (fromItem.onList && intoItem.onList) {
    // Both are live on the list — list what each one wants rather than
    // silently dropping either, the same way a merged recipe row does.
    const present = [intoItem.quantity, fromItem.quantity].filter(
      (q): q is string => !!q && q.trim() !== ''
    );
    quantity = present.length > 0 ? describeQuantities(present) : null;
    quantityFromRecipe = false;
  } else if (fromItem.onList) {
    quantity = fromItem.quantity;
    quantityFromRecipe = fromItem.quantityFromRecipe;
  } else {
    quantity = intoItem.quantity;
    quantityFromRecipe = intoItem.quantityFromRecipe;
  }

  // A shared choiceGroup loses a member (fromItem) whether or not the pair
  // is handled specially — this only decides whether the survivor's own
  // membership should end too, per clearChoice's rule that one remaining
  // option is not a choice.
  let choiceGroup = intoItem.choiceGroup;
  if (fromItem.choiceGroup && fromItem.choiceGroup === intoItem.choiceGroup) {
    const remaining = items.filter(
      i => i.id !== fromId && i.choiceGroup === fromItem.choiceGroup
    ).length;
    if (remaining <= 1) choiceGroup = null;
  }

  // Products: the loser's boxes are boxes of what is now one item, so they
  // come across the way its purchase count and its price run already do.
  //
  // Without this they were simply destroyed — `dbDeleteGroceryItem` cascades
  // `grocery_item_products`, so merging "cilantro" into "coriander" took
  // cilantro's brands *and their ratings* with it, silently. A rating is the
  // one thing on a product that can't be retyped from memory, which makes it
  // exactly the thing a merge must not throw away.
  //
  // Deduped by `productKey`, since that's the identity within an item: both
  // rows having a "store brand" means one box, not two. On a collision the
  // survivor's row is kept and the loser's counters fold into it — the same
  // "survivor wins, loser fills the gaps" rule this function already applies
  // to the name, the aisle and the note.
  const survivorProducts = itemProducts.filter(p => p.itemId === intoId);
  const byKey = new Map(survivorProducts.map(p => [p.productKey, p]));
  // Loser id → the survivor id that now stands for it, for the pointers
  // below. A re-keyed row keeps its own id (so its price observations and
  // link references stay valid); a deduped one hands its id over.
  const productIdRemap = new Map<string, string>();
  const mergedProducts: ItemProduct[] = [...survivorProducts];
  for (const loser of itemProducts.filter(p => p.itemId === fromId)) {
    const match = byKey.get(loser.productKey);
    if (!match) {
      // A box the survivor doesn't have moves over keeping its id, which is
      // what lets `PriceObservation.productId` and `ItemShopLink.productId`
      // go on naming it.
      const moved = { ...loser, itemId: intoId };
      mergedProducts.push(moved);
      byKey.set(moved.productKey, moved);
      continue;
    }
    productIdRemap.set(loser.id, match.id);
    const folded: ItemProduct = {
      ...match,
      purchaseCount: match.purchaseCount + loser.purchaseCount,
      lastPurchasedAt: laterOf(match.lastPurchasedAt, loser.lastPurchasedAt),
      // The survivor's verdict stands; the loser's only fills a silence.
      // Two ratings for one box is a disagreement nothing here can settle,
      // and overwriting an opinion the user actually recorded is worse than
      // keeping the one they last looked at.
      rating: match.rating ?? loser.rating,
      note: match.note || loser.note,
      // Same "survivor wins, loser fills a silence" rule, and the one field
      // here that can't just be written with the row: `dbSetItemProduct`
      // doesn't carry `gtin`, so an adopted one is claimed explicitly below.
      // A barcode confirmed against a box that is now this box is exactly
      // the pointer a merge must not drop — re-scanning it would otherwise
      // stop finding anything and mint a third row.
      gtin: match.gtin ?? loser.gtin,
    };
    mergedProducts[mergedProducts.indexOf(match)] = folded;
    byKey.set(folded.productKey, folded);
  }
  // Nothing downstream resolves a deduped id, so the pointers at one are
  // rewritten rather than left to dangle. They would only *read* as absent
  // (every reader shrugs), but "no Store brand at Safeway" quietly ceasing to
  // apply because of a rename is the claim-goes-stale bug this model was
  // built to avoid.
  const remapProductId = (id: string | null) =>
    (id ? productIdRemap.get(id) ?? id : null);
  const remapClaims = (claims: Record<string, string>) => {
    const out: Record<string, string> = {};
    for (const [id, at] of Object.entries(claims)) out[productIdRemap.get(id) ?? id] = at;
    return out;
  };

  // The survivor's preference stands, and adopts the loser's only when it had
  // none — same rule as the rating above. Remapped, because the box it names
  // may have just been deduped away.
  const mergedPreferredProductId = remapProductId(
    intoItem.preferredProductId ?? fromItem.preferredProductId
  );

  // Survivor wins, loser fills a silence — the rating/gtin rule again. And a
  // declaration that would leave the merged row a variety of itself is
  // dropped: merging White onion into Onion makes the loser's "kind of
  // onion" a statement about the row now carrying it.
  const inheritedVarietyOf = intoItem.varietyOfKey ?? fromItem.varietyOfKey;
  const mergedVarietyOfKey =
    inheritedVarietyOf === intoItem.nameKey || inheritedVarietyOf === fromItem.nameKey
      ? null
      : inheritedVarietyOf;

  // A price observation names the box it was paid for, and a box folded
  // into one of the survivor's hands its id over.
  const remapHistory = (history: readonly PriceObservation[]): PriceObservation[] =>
    history.map(o =>
      o.productId && productIdRemap.has(o.productId) ? { ...o, productId: productIdRemap.get(o.productId)! } : o
    );
  // Every field by its rule in ITEM_MERGE_RULES (groceryItemWrite); the ones
  // it marks `caller` are decided here, from the membership, boxes and
  // varieties above.
  const folded = mergedItemRow(intoItem, fromItem);
  const merged: GroceryItem = {
    ...folded,
    priceHistory: remapHistory(folded.priceHistory),
    onList,
    checked: onList && (intoItem.checked || fromItem.checked),
    quantity,
    quantityFromRecipe,
    choiceGroup,
    preferredProductId: mergedPreferredProductId,
    varietyOfKey: mergedVarietyOfKey,
  };

  // Variety declarations aimed at the loser's key follow the merge onto the
  // survivor's — the same stranding the remembered aisle and the recipe keys
  // below would otherwise suffer, and the same re-point the product ids get.
  const repointedVarieties = new Map<string, GroceryItem>();
  for (const other of items) {
    if (other.id === fromId || other.id === intoId) continue;
    if (other.varietyOfKey !== fromItem.nameKey) continue;
    repointedVarieties.set(other.id, { ...other, varietyOfKey: intoItem.nameKey });
  }

  // Shop links: one row per shop either side has a link at. A shop only
  // one side has just moves over; a shop both do combines into one row.
  const shopIds = new Set([
    ...itemShops.filter(l => l.itemId === fromId).map(l => l.shopId),
    ...itemShops.filter(l => l.itemId === intoId).map(l => l.shopId),
  ]);
  const mergedShopLinks: ItemShopLink[] = [];
  for (const shopId of shopIds) {
    const survivorLink = itemShops.find(l => l.itemId === intoId && l.shopId === shopId);
    const loserLink = itemShops.find(l => l.itemId === fromId && l.shopId === shopId);
    if (survivorLink && loserLink) {
      const purchaseCount = survivorLink.purchaseCount + loserLink.purchaseCount;
      mergedShopLinks.push({
        itemId: intoId,
        shopId,
        purchaseCount,
        lastPurchasedAt: laterOf(survivorLink.lastPurchasedAt, loserLink.lastPurchasedAt),
        // Neither side is dropped: both are prices actually paid for what is
        // now one item. The cap keeps the most recent of the two runs.
        priceHistory: remapHistory(mergePriceHistories(survivorLink.priceHistory, loserLink.priceHistory)),
        // A purchase on either side refutes an "unavailable" claim, same as
        // a fresh purchase already does to a single link.
        unavailableAt:
          purchaseCount > 0 ? null : laterOf(survivorLink.unavailableAt, loserLink.unavailableAt),
        productId: remapProductId(survivorLink.productId ?? loserLink.productId),
        // Both sides' claims, because they're keyed by product and the two
        // rows' products are about to be one item's products. A key present
        // on both keeps the survivor's stamp — an arbitrary tie-break over
        // two dates for one claim, and the same call `pickPriceFields` makes.
        unavailableProductIds: {
          ...remapClaims(loserLink.unavailableProductIds),
          ...remapClaims(survivorLink.unavailableProductIds),
        },
        ...pickPriceFields(survivorLink, loserLink),
      });
    } else {
      const only = (survivorLink ?? loserLink)!;
      mergedShopLinks.push({
        ...only,
        itemId: intoId,
        priceHistory: remapHistory(only.priceHistory),
        productId: remapProductId(only.productId),
        unavailableProductIds: remapClaims(only.unavailableProductIds),
      });
    }
  }

  // Substitute links: retarget both directions onto the survivor. One that
  // would end up pointing an item at itself (the pair already substituted
  // for each other) is dropped rather than kept as a no-op; a collision
  // with a link the survivor already has keeps the survivor's own.
  const survivingSubs = itemSubs.filter(l => l.itemId !== fromId && l.subItemId !== fromId);
  const subKeys = new Set(survivingSubs.map(l => `${l.itemId}|${l.subItemId}`));
  const retargetedSubs: ItemSubLink[] = [];
  for (const link of itemSubs) {
    if (link.itemId !== fromId && link.subItemId !== fromId) continue;
    const itemId = link.itemId === fromId ? intoId : link.itemId;
    const subItemId = link.subItemId === fromId ? intoId : link.subItemId;
    if (itemId === subItemId) continue;
    const key = `${itemId}|${subItemId}`;
    if (subKeys.has(key)) continue;
    subKeys.add(key);
    retargetedSubs.push({ ...link, itemId, subItemId });
  }

  // A standing swap is one-rule-per-item (see standingSwaps.ts), enforced
  // wherever the app writes one — linkItemSub, setItemSubStanding — but a
  // merge doesn't go through either, it retargets links directly. Without
  // this, an item that already has its own standing rule and picks up a
  // second one from the loser's side would carry two: no crash
  // (standingSwapMap just resolves one), but Settings would list both as
  // "on" when only one is actually applied. The survivor's own rule wins,
  // the same precedent this function already uses for a plain link
  // collision just above.
  const standingItemIds = new Set(survivingSubs.filter(l => l.standing).map(l => l.itemId));
  const finalRetargetedSubs = retargetedSubs.map(link =>
    link.standing && standingItemIds.has(link.itemId) ? { ...link, standing: false } : link
  );

  // The loser's entries move onto the survivor, one per list. Where the
  // survivor is already on that list the two are one entry: it keeps its own
  // place and is in the cart if either was.
  //
  // A choice group the merge left with one member (see choiceGroup above)
  // ends on the entries too, which is where a list reads it from.
  const collapsedGroup =
    fromItem.choiceGroup && fromItem.choiceGroup === intoItem.choiceGroup && choiceGroup === null
      ? fromItem.choiceGroup
      : null;
  const ungroup = (e: GroceryListEntry): GroceryListEntry =>
    collapsedGroup !== null && e.choiceGroup === collapsedGroup ? { ...e, choiceGroup: null } : e;
  const mergedInto = new Set<string | null>();
  const movedEntries: GroceryListEntry[] = beforeListEntries
    .filter(e => e.itemId === fromId)
    .map(e => {
      const own = beforeListEntries.find(o => o.itemId === intoId && o.listId === e.listId);
      if (own) mergedInto.add(e.listId);
      return ungroup(own ? { ...own, checked: own.checked || e.checked } : { ...e, itemId: intoId });
    });
  for (const own of beforeListEntries) {
    if (own.itemId !== intoId || mergedInto.has(own.listId)) continue;
    const next = ungroup(own);
    if (next !== own) movedEntries.push(next);
  }

  return {
    fromItem,
    intoItem,
    merged,
    repointedVarieties,
    mergedProducts,
    mergedShopLinks,
    survivingSubs,
    finalRetargetedSubs,
    movedEntries,
    removedEntries: beforeListEntries.filter(e => e.itemId === fromId).map(e => ({ itemId: e.itemId, listId: e.listId })),
    productIdRemap,
  };
}
