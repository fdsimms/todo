import type { GroceryItem, ItemSubLink } from '../types';
import { scaleQuantity, splitLeadingAmount, unitKey } from './recipeScale';

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
 * A recipe line's quantity, converted through a ratio — `substituteQuantity`
 * for `"3 cloves"` through `1 clove → 1/4 tsp` is `"3/4 tsp"`.
 *
 * The refuse-and-flag shape every other quantity computation in this app
 * uses (`ScaledQuantity`, `mergeQuantities`): `converted` is false whenever
 * `text` is the *line's own* quantity, untouched.
 */
export interface SubstitutedQuantity {
  /** What to render. The line's own quantity, verbatim, whenever `converted` is false. */
  text: string;
  converted: boolean;
}

/**
 * Applies a ratio to a recipe line's quantity — composing `recipeScale`'s
 * existing machinery rather than reimplementing exact-rational arithmetic: a
 * ratio is nothing but a scale factor (how many multiples of `ratioFrom` the
 * line names), and applying that factor to `ratioTo` is exactly what
 * `scaleQuantity` already does — exact-rational multiply, unit inflection,
 * the container refusals, all of it.
 *
 * Two refusals, both verbatim-and-flagged like every other quantity refusal
 * in this app:
 *
 * - **The line's amount doesn't parse** ("a pinch of garlic") — `scaleQuantity`
 *   rule 3, restated: nothing here guesses at what "a pinch" means.
 * - **The units don't match**, compared through `unitKey` so inflections land
 *   on one entry. A ratio written *per clove* applies to "3 cloves" and
 *   **not** to "1 bulb" — this is the load-bearing refusal. Silently
 *   rendering ¼ tsp for a whole bulb is the failure that would make the
 *   feature untrustworthy. Both sides must actually carry a unit: two bare
 *   counts matching on "" would apply a per-clove ratio to a line that never
 *   named a unit at all.
 */
export function substituteQuantity(
  lineQuantity: string,
  ratioFrom: string,
  ratioTo: string
): SubstitutedQuantity {
  const text = lineQuantity.trim();
  const unchanged: SubstitutedQuantity = { text, converted: false };
  if (!text) return unchanged;

  const line = splitLeadingAmount(text);
  const from = splitLeadingAmount(ratioFrom);
  if (!line || !from || from.value === 0) return unchanged;
  if (!line.rest || !from.rest || unitKey(line.rest) !== unitKey(from.rest)) return unchanged;

  const factor = line.value / from.value;

  // scaleQuantity treats an exact 1× as a no-op and reports it unscaled —
  // right for its own callers (nothing to do), wrong here: an exact 1× means
  // the line names precisely one `ratioFrom`, so the converted amount is
  // `ratioTo` itself, verbatim — and that *is* a real conversion, not a
  // refusal. (Every other factor is safe to hand to scaleQuantity as-is: its
  // own denominator search absorbs the float noise from the division above,
  // the same tolerance mergeQuantities already leans on.)
  if (factor === 1) {
    if (!splitLeadingAmount(ratioTo)) return unchanged;
    return { text: ratioTo.trim(), converted: true };
  }

  // scaleQuantity's own `text` on refusal is `ratioTo` verbatim — right for
  // its own callers (the thing they asked to scale), wrong for this one: on
  // refusal this function's contract is to hand back the *line's* quantity
  // untouched, not the unusable ratio.
  const scaled = scaleQuantity(ratioTo, factor);
  return scaled.scaled ? { text: scaled.text, converted: true } : unchanged;
}
