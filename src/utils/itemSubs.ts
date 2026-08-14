import type { GroceryItem, ItemSubLink } from '../types';
import { probablyHaveReason } from './grocerySuggest';

/**
 * Substitutes — the read side of the item-to-item links.
 *
 * Pure, so groceryItemSubs.test.ts pins it and the wording rules live in one
 * place. The two rules that matter, restated from ItemSubLink:
 *
 * - **Directional.** A link says "instead of `itemId`, use `subItemId`", and
 *   nothing here reads one backwards. The both-ways case is two rows, which is
 *   what `isMutual` reports rather than inferring.
 * - **Resolve-or-shrug.** A link whose other half is gone is dropped, exactly
 *   as `shopsForItem` drops a link to a missing store. The delete cascade
 *   already takes those rows, so this is belt-and-braces for a restored backup
 *   or a half-applied sync payload — not the mechanism.
 *
 * Nothing here decides *whether* a substitute should be shown. That rule lives
 * with the callers, and it is deliberately strict: a substitute is surfaced
 * only where there's a reason to believe it would help — the user asked, the
 * store was marked as not stocking the original, or the original is marked
 * "out of it" and the substitute is on hand. `probablyHaveReason` returning
 * null is the default state of nearly every item, so reading that as "you
 * haven't got this" would caption the whole app on nothing.
 */

/** A resolved substitute: the link, plus the item it names. */
export interface Substitute {
  link: ItemSubLink;
  item: GroceryItem;
  /**
   * True when the reverse link exists too — the user ticked "both ways", or
   * wrote each direction by hand. Reported rather than stored: two rows is the
   * representation, and a flag would be a second thing to keep in step.
   */
  isMutual: boolean;
}

/**
 * What you'd use instead of this item, oldest first.
 *
 * Creation order rather than a ranking: there is nothing to rank by — no counts
 * and no observations, since nothing infers a link — and re-sorting a list the
 * user authored by hand is how it stops being the list they wrote.
 */
export function substitutesFor(
  itemId: string,
  links: readonly ItemSubLink[],
  items: readonly GroceryItem[]
): Substitute[] {
  const byId = new Map(items.map(i => [i.id, i]));
  const has = (a: string, b: string) =>
    links.some(l => l.itemId === a && l.subItemId === b);

  return links
    .filter(l => l.itemId === itemId && byId.has(l.subItemId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(l => ({
      link: l,
      item: byId.get(l.subItemId)!,
      isMutual: has(l.subItemId, l.itemId),
    }));
}

/**
 * The items this one stands in *for* — the reverse read.
 *
 * Same shape, and it exists because the link is directional: recording
 * "instead of butter, margarine" has to be visible from margarine too, or the
 * only way to find out what a row is doing in the table is to open every other
 * row in the catalog.
 */
export function substituteForItems(
  subItemId: string,
  links: readonly ItemSubLink[],
  items: readonly GroceryItem[]
): Substitute[] {
  const byId = new Map(items.map(i => [i.id, i]));
  const has = (a: string, b: string) =>
    links.some(l => l.itemId === a && l.subItemId === b);

  return links
    .filter(l => l.subItemId === subItemId && byId.has(l.itemId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(l => ({
      link: l,
      item: byId.get(l.itemId)!,
      isMutual: has(l.subItemId, l.itemId),
    }));
}

/**
 * How many substitutes a collapsed row can name before it has to count them
 * instead. Two is what fits: "Garlic powder, garlic paste" nearly fills the
 * row at 390pt, and `disclosureValue` renders `numberOfLines={1}`, so a third
 * name truncates mid-word.
 */
const NAME_LIMIT = 2;

/**
 * "Margarine" · "Margarine, ghee" · "3 substitutes".
 *
 * One helper because more than one surface has to name a substitute in a
 * sentence, and a second phrasing is a second thing to keep true. Same call
 * `describeComponents` makes about falling back to a count.
 */
export function describeSubstitutes(subs: readonly Substitute[]): string | null {
  if (subs.length === 0) return null;
  if (subs.length <= NAME_LIMIT) return subs.map(s => s.item.name).join(', ');
  return `${subs.length} substitutes`;
}

/**
 * The substitutes for an item that the app currently thinks you have.
 *
 * **Both halves have to be known**, which is what keeps this quiet: a link
 * whose substitute the app has no pantry opinion about says nothing, the same
 * silence rule `tripMarkerFor` runs on. `probablyHaveReason` is the single
 * source of the "have it" opinion — an explicit assertion, a staple, or the
 * cadence guess — and this deliberately adds no second rule of its own. In
 * particular it doesn't drop a substitute that's on the shopping list: an item
 * can be both recently bought and back on the list, and `PantrySheet` already
 * treats that as on hand.
 */
export function substitutesOnHand(
  itemId: string,
  links: readonly ItemSubLink[],
  items: readonly GroceryItem[],
  now: Date
): Substitute[] {
  return substitutesFor(itemId, links, items).filter(
    s => probablyHaveReason(s.item, now) !== null
  );
}

/**
 * "you have margarine" — why a row you still need to buy is worth a second
 * look before you go.
 *
 * One function owning the phrasing, the way `describeShops` does, because the
 * same sentence is wanted at the shelf and on a recipe row. Plain and literal:
 * what's in the cupboard, not a rescue.
 *
 * Lower-cased and joined with "or" up to the same two-name limit the collapsed
 * summary uses, then a count — this lands in a row subtitle, which is one line.
 */
export function describeSubstitutesOnHand(subs: readonly Substitute[]): string | null {
  if (subs.length === 0) return null;
  if (subs.length <= NAME_LIMIT) {
    return `you have ${subs.map(s => s.item.name.toLowerCase()).join(' or ')}`;
  }
  return `you have ${subs.length} substitutes`;
}
