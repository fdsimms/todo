import type { GroceryItem, ItemProduct, ItemSubLink } from '../types';
import { probablyHaveReason } from './grocerySuggest';
import { substitutesOnHand } from './itemSubs';
import { describeFamilyOnHand, varietyIndex } from './itemVarieties';

/**
 * "you have smoked paprika" — what to say under a recipe line whose own catalog
 * item you don't have, when something that could stand in for it is on hand.
 *
 * It names two things the same way: the varieties declared of the line's item
 * (`varietyIndex`, so "smoked paprika" under a pimentón line) and the
 * substitutes linked to it. Both read on-hand through `probablyHaveReason`, and
 * this is a caption only, exactly as `classifyPlanned`'s `reason` is: nothing
 * here decides what the shopping sheet ticks. It exists because that caption
 * lived only in the add-to-list sheets, so the recipe page itself said nothing
 * until you were already shopping.
 *
 * Null when the item itself is on hand, a staple or on the list: the line is
 * already answered, and a caption beside it would read as a second opinion.
 */
export function onHandStandInsNote(
  item: GroceryItem,
  items: readonly GroceryItem[],
  itemSubs: readonly ItemSubLink[],
  products: readonly ItemProduct[],
  now: Date,
  index: ReadonlyMap<string, GroceryItem[]> = varietyIndex(items)
): string | null {
  if (item.isStaple || item.onList) return null;
  if (probablyHaveReason(item, now, products) !== null) return null;

  const named = new Map<string, GroceryItem>();
  for (const variety of index.get(item.nameKey) ?? []) {
    if (probablyHaveReason(variety, now, products) !== null) named.set(variety.id, variety);
  }
  for (const sub of substitutesOnHand(item.id, itemSubs, items, now, products)) {
    named.set(sub.item.id, sub.item);
  }
  return describeFamilyOnHand([...named.values()]);
}
