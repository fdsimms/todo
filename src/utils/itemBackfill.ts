import type { GroceryItem, ItemSubLink } from '../types';
import { substitutesFor } from './itemSubs';
import { isNonFoodAisle } from './groceryAisles';

/**
 * A catalog-item field the Backfill screen can walk and fill in, one item at
 * a time — same mechanism as `fieldBackfill.ts`/`categoryBackfill.ts`/
 * `projectBackfill.ts`, over `GroceryItem`. Its own module for the same
 * reason those are: neither field is a plain toggle read off the item alone —
 * `variety` picks a generic name (closer to the task side's `category` than
 * to `streak`), and `substitutes` isn't a single value at all but a list, so
 * "missing" means "the list is empty" rather than "the field is unset".
 *
 * `nutrition` and `scannedName` join them on the same test. Neither is a
 * toggle either, and both are facts every row is expected to eventually have
 * rather than choices made at the item:
 *
 * - **`nutrition`** is null on most of the catalog and stays null until a
 *   barcode, a lookup or a person supplies figures, which is exactly a gap a
 *   walk-through closes. A box's own panel (`ItemProduct.nutrition`) does not
 *   excuse it: the two answer different questions, and the item's generic
 *   figures are what a recipe line resolves to and what the food log offers
 *   when no particular box is being eaten.
 * - **`scannedName`** is the one field here that is filled in *already* and
 *   still wants answering — the row is named, just named by a product
 *   database. It reads `GroceryItem.nameFromScan`, which is recorded at the
 *   scan rather than guessed from the text, so this queue only ever holds
 *   rows nobody has renamed.
 *
 * Still deliberately not covering the rest. The catalog carries other gaps (no
 * preferred product, no shelf life) but those are choices made *at* the item —
 * a product picked in the product sheet, a shelf life corrected after the fact
 * — rather than facts every item is expected to eventually have, which is
 * what makes a walk-through worth it.
 */
export type ItemBackfillFieldId = 'variety' | 'substitutes' | 'nutrition' | 'scannedName';

export interface ItemBackfillFieldDef {
  id: ItemBackfillFieldId;
  /** The row's own label in GroceryItemSheet — reused here so the field
   * reads as the same setting wherever it's found. */
  label: string;
  /** One line explaining what the field does, shown under its row on the
   * field-picker step. */
  hint: string;
}

// Order matters: the order these render in on the field-picker step. Same
// order GroceryItemSheet's own fields appear in, which is why the name comes
// first and Nutrition last.
export const ITEM_BACKFILL_FIELDS: ItemBackfillFieldDef[] = [
  {
    id: 'scannedName',
    label: 'Scanned name',
    hint: 'Rename items that still have the name a barcode lookup gave them, like "Great Value 2% Reduced Fat Milk".',
  },
  {
    id: 'substitutes',
    label: 'Substitutes',
    hint: 'What you’d use instead if there’s none of this — saved on the item, so every recipe calling for it can use it.',
  },
  {
    id: 'variety',
    label: 'Variety of',
    hint: 'The general ingredient this item counts as, like white onion for onion, so a recipe naming the general ingredient accepts it.',
  },
  {
    id: 'nutrition',
    label: 'Nutrition',
    hint: 'What this food is made of, so a recipe or a logged meal can be counted.',
  },
];

/**
 * Whether `item` still needs a value for `fieldId` — the backfill queue's
 * inclusion test. `links`/`items` are only read for `substitutes` (see
 * `substitutesFor`); omit them for a `variety`-only call, the same optional
 * shape `isFieldMissing`'s `categories` param has on the task side.
 * `nonFoodAisles` is only read for `nutrition` — see `isNonFoodAisle`, and
 * note it's a real answer ("not food") rather than a missing one, so a
 * non-food item is excluded here rather than counted as needing a value.
 */
export function isItemFieldMissing(
  item: GroceryItem,
  fieldId: ItemBackfillFieldId,
  links: readonly ItemSubLink[] = [],
  items: readonly GroceryItem[] = [],
  nonFoodAisles: readonly string[] = []
): boolean {
  switch (fieldId) {
    case 'variety':
      return item.varietyOfKey == null;
    case 'substitutes':
      return substitutesFor(item.id, links, items).length === 0;
    // The item's own generic figures, deliberately read raw rather than
    // through `nutritionFor`. A preferred product carrying a panel answers
    // for that box and outranks this one wherever both are in play, but it is
    // not this value: the food log offers the plain item as its own row (see
    // FoodLogEntrySheet), and a recipe line resolves to the item whenever the
    // box in question isn't the preferred one. Reading the pair here would
    // hide a real gap behind an answer to a different question.
    case 'nutrition':
      return item.nutrition == null && !isNonFoodAisle(item.aisle, nonFoodAisles);
    // Not a missing value at all but a name nobody has chosen — see
    // `GroceryItem.nameFromScan`, and note that `renameItem` clearing the flag
    // is what takes a row out of this queue.
    case 'scannedName':
      return item.nameFromScan;
  }
}

/**
 * Whether the user has told the backfill screen not to ask about `fieldId`
 * on this item again — "this genuinely isn't a variety of anything", not
 * "not right now" (that's the screen's own session-only `skippedIds`, which
 * never touches the item itself). See `GroceryItem.backfillDismissedFields`.
 */
export function isItemBackfillDismissed(item: GroceryItem, fieldId: ItemBackfillFieldId): boolean {
  return item.backfillDismissedFields.includes(fieldId);
}

// Every catalog row is a candidate — there's no `inCatalog`/archived state to
// exclude any more (see GroceryItem's own note on why), so what's on the
// shelf and what's only in history are the same pool.
export function itemBackfillCandidates(
  items: GroceryItem[],
  fieldId: ItemBackfillFieldId,
  links: ItemSubLink[] = [],
  nonFoodAisles: readonly string[] = []
): GroceryItem[] {
  return items
    .filter(i => isItemFieldMissing(i, fieldId, links, items, nonFoodAisles) && !isItemBackfillDismissed(i, fieldId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** How many items are still missing each field, for the field-picker step's counts. */
export function itemBackfillFieldCounts(
  items: GroceryItem[],
  links: ItemSubLink[] = [],
  nonFoodAisles: readonly string[] = []
): Record<ItemBackfillFieldId, number> {
  const counts = { variety: 0, substitutes: 0, nutrition: 0, scannedName: 0 } as Record<ItemBackfillFieldId, number>;
  for (const i of items) {
    for (const field of ITEM_BACKFILL_FIELDS) {
      if (isItemFieldMissing(i, field.id, links, items, nonFoodAisles) && !isItemBackfillDismissed(i, field.id)) counts[field.id]++;
    }
  }
  return counts;
}

/**
 * The patch that records "leave this field unset" for `item` — appended to
 * whatever else is already dismissed, deduped, so dismissing twice is a
 * no-op rather than growing the array. Same shape as the task/category/
 * project-side `dismissBackfillField`s.
 */
export function dismissItemBackfillField(
  item: GroceryItem, fieldId: ItemBackfillFieldId
): Pick<GroceryItem, 'backfillDismissedFields'> {
  return {
    backfillDismissedFields: item.backfillDismissedFields.includes(fieldId)
      ? item.backfillDismissedFields
      : [...item.backfillDismissedFields, fieldId],
  };
}
