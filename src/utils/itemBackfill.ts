import type { GroceryItem, ItemSubLink } from '../types';
import { substitutesFor } from './itemSubs';

/**
 * A catalog-item field the Backfill screen can walk and fill in, one item at
 * a time — same mechanism as `fieldBackfill.ts`/`categoryBackfill.ts`/
 * `projectBackfill.ts`, over `GroceryItem`. Its own module for the same
 * reason those are: neither field is a plain toggle read off the item alone —
 * `variety` picks a generic name (closer to the task side's `category` than
 * to `streak`), and `substitutes` isn't a single value at all but a list, so
 * "missing" means "the list is empty" rather than "the field is unset".
 *
 * Deliberately just these two. The catalog carries other gaps (no preferred
 * product, no shelf life) but those are choices made *at* the item — a
 * product picked in the product sheet, a shelf life corrected after the fact
 * — rather than facts every item is expected to eventually have, which is
 * what makes a walk-through worth it.
 */
export type ItemBackfillFieldId = 'variety' | 'substitutes';

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
// order GroceryItemSheet's own Substitutes/Variety of fields appear in.
export const ITEM_BACKFILL_FIELDS: ItemBackfillFieldDef[] = [
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
];

/**
 * Whether `item` still needs a value for `fieldId` — the backfill queue's
 * inclusion test. `links`/`items` are only read for `substitutes` (see
 * `substitutesFor`); omit them for a `variety`-only call, the same optional
 * shape `isFieldMissing`'s `categories` param has on the task side.
 */
export function isItemFieldMissing(
  item: GroceryItem,
  fieldId: ItemBackfillFieldId,
  links: readonly ItemSubLink[] = [],
  items: readonly GroceryItem[] = []
): boolean {
  switch (fieldId) {
    case 'variety':
      return item.varietyOfKey == null;
    case 'substitutes':
      return substitutesFor(item.id, links, items).length === 0;
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
  links: ItemSubLink[] = []
): GroceryItem[] {
  return items
    .filter(i => isItemFieldMissing(i, fieldId, links, items) && !isItemBackfillDismissed(i, fieldId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** How many items are still missing each field, for the field-picker step's counts. */
export function itemBackfillFieldCounts(items: GroceryItem[], links: ItemSubLink[] = []): Record<ItemBackfillFieldId, number> {
  const counts = { variety: 0, substitutes: 0 } as Record<ItemBackfillFieldId, number>;
  for (const i of items) {
    for (const field of ITEM_BACKFILL_FIELDS) {
      if (isItemFieldMissing(i, field.id, links, items) && !isItemBackfillDismissed(i, field.id)) counts[field.id]++;
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
