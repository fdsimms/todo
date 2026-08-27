import type { GroceryItem } from '../types';
import { probablyHaveReason } from './grocerySuggest';

/**
 * Varieties — "white onion is a kind of onion" (`GroceryItem.varietyOfKey`).
 *
 * The catalog's five existing relations are all *lateral*: a product is a box
 * of one item, either/or and alternatives pair equals, a substitute is a
 * different thing you'd tolerate. None of them can say that one item *is* the
 * thing a recipe named, more precisely — which is why a recipe line saying
 * "onion" read as a brand-new ingredient while white onion sat in the pantry,
 * and why the meal-shortfall generator wrote "Shop for Tuesday" over an onion
 * in the drawer. This module is that one vertical relation, read side only.
 *
 * The semantics are asymmetric on purpose (see the field's own note in
 * `types/index.ts`): a specific item answers a generic ask; a generic never
 * answers a specific one, where the family is only ever a caption. Both
 * directions are single-hop — readers ask "which items declare themselves
 * varieties of this key", never walk a chain — so a mis-filed pointer can't
 * loop and can't claim transitively.
 *
 * Nothing here writes, and nothing here infers a declaration: the user says
 * so on the item (`setVarietyOfKey`), the same discipline substitutes keep.
 */

/**
 * Generic nameKey → the items declaring themselves varieties of it, in
 * catalog order. Built once per read the way `classifyPlanned` builds its own
 * key index — a per-line lookup over the whole catalog would be quadratic on
 * a screenful of ingredient rows.
 *
 * A declaration pointing at the item's own key is skipped: it says nothing
 * ("onion is a kind of onion") and would otherwise put the row in its own
 * family. `setVarietyOfKey` refuses to write one, so this only guards a
 * restored backup or a rename that converged the two.
 */
export function varietyIndex(
  items: readonly GroceryItem[]
): Map<string, GroceryItem[]> {
  const index = new Map<string, GroceryItem[]>();
  for (const item of items) {
    if (!item.varietyOfKey || item.varietyOfKey === item.nameKey) continue;
    const group = index.get(item.varietyOfKey);
    if (group) group.push(item);
    else index.set(item.varietyOfKey, [item]);
  }
  return index;
}

/** The empty index, for callers with nothing declared — saves an allocation per render. */
export const NO_VARIETIES: ReadonlyMap<string, GroceryItem[]> = new Map();

/**
 * The variety that answers a generic ask, or null when none does.
 *
 * "Answers" is exactly `classifyPlanned`'s own ladder, applied across the
 * family instead of to one row: on the list beats a staple beats the pantry
 * guess, and within a rung the catalog's own order breaks the tie — the same
 * "first wins" every other reader here uses rather than a ranking nobody can
 * predict. An unchecked list row outranks a checked one within the first
 * rung only because "already on the list" is the more useful thing for a
 * planning read to land on; both categories mean the ask is covered.
 *
 * Deliberately *not* "any variety exists": a declared variety the app has no
 * reason to believe you have answers nothing, and the ask stays an honest
 * needToBuy under its own generic name — which is also the right thing to
 * put in the trolley when any onion will do.
 *
 * `inTrolley` scopes the on-list rung to the list being added to, exactly as
 * `classifyPlanned` scopes its own — and it has to, or the two disagree in the
 * direction that silently drops shopping: a white onion on your list at *home*
 * would answer a generic line while you plan for a rental, and the sheet would
 * leave it unticked. Null falls back to the row's own `onList`/`checked`, the
 * home list, which is what every reader that isn't adding to a list means.
 */
export function coveringVariety(
  candidates: readonly GroceryItem[] | undefined,
  now: Date,
  inTrolley: ReadonlyMap<string, boolean> | null = null
): GroceryItem | null {
  if (!candidates || candidates.length === 0) return null;
  let staple: GroceryItem | null = null;
  let onHand: GroceryItem | null = null;
  let inCart: GroceryItem | null = null;
  for (const item of candidates) {
    const listed = inTrolley ? inTrolley.has(item.id) : item.onList;
    if (listed) {
      const checked = inTrolley ? inTrolley.get(item.id) : item.checked;
      if (!checked) return item;
      inCart = inCart ?? item;
      continue;
    }
    if (item.isStaple) { staple = staple ?? item; continue; }
    if (!onHand && probablyHaveReason(item, now)) onHand = item;
  }
  return inCart ?? staple ?? onHand;
}

/**
 * The rest of a specific item's family that's on hand — its generic parent's
 * own row (when one exists) and its sibling varieties — for the caption on a
 * row you still need to buy.
 *
 * This is the "red onion only, but you do have white onion" half, and it
 * rides the substitute caption's exact rule: it informs, it never moves the
 * row (see `ClassifiedIngredient.reason` for why folding it into
 * `probablyHave` is how you come home without the red onion the dish
 * actually wanted). On-hand means `probablyHaveReason`, the single owner of
 * that opinion — deliberately not the wider on-list/staple ladder
 * `coveringVariety` runs, because a caption about the cupboard should only
 * name what's plausibly in it.
 */
export function familyOnHand(
  item: GroceryItem,
  byKey: ReadonlyMap<string, GroceryItem>,
  index: ReadonlyMap<string, GroceryItem[]>,
  now: Date
): GroceryItem[] {
  if (!item.varietyOfKey || item.varietyOfKey === item.nameKey) return [];
  const family: GroceryItem[] = [];
  const parent = byKey.get(item.varietyOfKey);
  if (parent && parent.id !== item.id) family.push(parent);
  for (const sibling of index.get(item.varietyOfKey) ?? []) {
    if (sibling.id !== item.id) family.push(sibling);
  }
  return family.filter(member => probablyHaveReason(member, now) !== null);
}

/**
 * Whether a suggested catalog item looks like a *variety* of the line that
 * turned it up — "onion" turning up White onion — in which case declaring the
 * relation is the better answer than the rename the suggestion would otherwise
 * apply. Null when the shape doesn't hold.
 *
 * The test is the shape, not which tier produced the match, and the shape is
 * its own guarantee: the catalog name has to *end with* the line's whole key
 * at a word boundary, so it is strictly longer and strictly more specific.
 * That is the mirror of `longestPrefixItem`'s boundary rule, and it can only
 * ever be the ranked tier — `shorter` and `prefix` both require the catalog
 * key to be the shorter of the two, and nothing six edits apart survives
 * `similar`. Gating on the reason as well would restate that in a way that
 * could drift from it.
 *
 * An item that already declares something is left alone: it has an answer, and
 * a second one offered from a recipe row would be overwriting a fact the user
 * recorded on the item itself.
 */
export function varietyOfferFor(
  lineKey: string,
  item: GroceryItem | null
): GroceryItem | null {
  if (!lineKey || !item || item.varietyOfKey) return null;
  return item.nameKey.endsWith(` ${lineKey}`) ? item : null;
}

/**
 * What the Variety of field offers before anyone types — the item's own name
 * with leading words dropped one at a time ("extra sharp white cheddar" →
 * "sharp white cheddar", "white cheddar", "cheddar"), then every generic
 * other items already declare, then whatever this item currently declares (so
 * a free-typed value stays a visible, deselectable pill). Deduped in that
 * order; the item's own key is never offered.
 *
 * Labels come from the generic's own catalog row when one exists — the user's
 * capitalisation — and fall back to the bare key, which is all a row-less
 * generic has. Truncation is the same trailing-words idea
 * `suggestShorterCatalogName` trusts, offered rather than applied, and it's
 * why the common case is one tap instead of typing.
 */
export function genericNameSuggestions(
  item: GroceryItem,
  items: readonly GroceryItem[]
): Array<{ key: string; label: string }> {
  const byKey = new Map<string, GroceryItem>();
  for (const other of items) {
    if (!byKey.has(other.nameKey)) byKey.set(other.nameKey, other);
  }

  const keys: string[] = [];
  const words = item.nameKey.split(' ');
  for (let drop = 1; drop < words.length; drop++) {
    keys.push(words.slice(drop).join(' '));
  }
  for (const other of items) {
    if (other.id !== item.id && other.varietyOfKey) keys.push(other.varietyOfKey);
  }
  if (item.varietyOfKey) keys.push(item.varietyOfKey);

  const seen = new Set<string>();
  const out: Array<{ key: string; label: string }> = [];
  for (const key of keys) {
    if (!key || key === item.nameKey || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: byKey.get(key)?.name ?? key });
  }
  return out;
}

/**
 * How many family members a one-line caption can name before it counts them —
 * the same limit `describeSubstitutesOnHand` uses, for the same 390pt row.
 */
const NAME_LIMIT = 2;

/**
 * "you have white onion" — the same sentence, and the same rules, as
 * `describeSubstitutesOnHand`: lower-cased, "or"-joined up to two names, then
 * a count. One phrasing on purpose — this caption and the substitute one land
 * in the same row subtitle, and a reader shouldn't have to tell the two
 * mechanisms apart to understand either.
 */
export function describeFamilyOnHand(
  family: readonly GroceryItem[]
): string | null {
  if (family.length === 0) return null;
  if (family.length <= NAME_LIMIT) {
    return `you have ${family.map(i => i.name.toLowerCase()).join(' or ')}`;
  }
  return `you have ${family.length} kinds of it`;
}
