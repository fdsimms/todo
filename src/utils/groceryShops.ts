import type { GroceryItem, ItemProduct, ItemShopLink, Shop, StoreAlias } from '../types';
import { describePreferredProduct, lacksPreferredProduct } from './groceryProduct';
import { groceryNameKey } from './groceryParse';
import { OTHER_AISLE } from './groceryAisles';
import { sectionsInAisleOrder } from './grocerySuggest';

/**
 * Which stores have which items — the read side of the purchase links.
 *
 * Pure, so it's all pinned by groceryShops.test.ts, and so the one place that
 * knows the counting rules is testable. The rule that matters, restated from
 * ItemShopLink:
 *
 *   item.purchaseCount >= sum of its links' purchaseCount
 *
 * A trip finished before this feature existed, or finished without naming a
 * store, bumps the item and writes no link. So the per-store numbers are
 * partial and the item's is the total. Nothing here adds links up to produce a
 * total, and describeShops() is worded so a caller can't imply one.
 */

/**
 * The negative claim: the user said this store doesn't stock this item. Every
 * "where can I get it" read below drops such a link — an absent link means the
 * app has never seen the item there, which is ignorance; this one means the
 * user looked and it wasn't there, which is an answer.
 *
 * It outranks the purchase count on the same row rather than being contradicted
 * by it, because it's the *current* state and the count is history: a shop that
 * stocked it eleven times and then stopped is exactly the case this exists for.
 * A purchase does refute it — but by clearing the stamp when the trip is
 * recorded, not by out-arguing it at read time.
 */
export function isUnavailable(link: ItemShopLink): boolean {
  return link.unavailableAt !== null;
}

/**
 * A link with no purchases behind it — the user said "I get this here" rather
 * than the app having watched them buy it. Kept apart from an observed link
 * everywhere ranking or "usually" is involved, and nowhere else: for the
 * question "does this store have it", an assertion counts.
 *
 * A *negative* link also has no purchases behind it and is the opposite claim,
 * so it has to be excluded here explicitly — the count alone stopped being able
 * to tell the two apart the moment unavailableAt existed.
 */
export function isAsserted(link: ItemShopLink): boolean {
  return link.purchaseCount === 0 && !isUnavailable(link);
}

/**
 * The second negative, and the one this feature exists for: the user has said
 * this store hasn't got the product they want. The store stocks the item — that's
 * what makes this a different claim from `isUnavailable` — it just hasn't got
 * yours.
 *
 * **Only an asserted claim counts, never an observed product.** `ItemShopLink`
 * also records the product you last got at a store, and it is tempting to read a
 * mismatch there as this: you got Lucerne at Safeway, so Safeway must not have
 * Good Culture. It mustn't, and the reason is simply that **a store carries
 * more than one version of a thing**. Safeway stocking Lucerne is not evidence
 * about whether it also stocks Good Culture; it is evidence about one purchase.
 * Inferring the absence would drop stores that have exactly what you want, and
 * it is the same unfalsifiable move shoppingTrip.ts deleted `likelyItemIds` to
 * be rid of — an absence read off something that was never evidence of one.
 *
 * So this reads the stamped claim and nothing else. Unknown stays unknown, and
 * unknown always counts.
 *
 * Read only while the item is strict, and only for a claim naming the item's
 * *current* preferred product: a preference nobody made a rule of isn't a
 * reason to drop a store, and a claim about a box you no longer want is
 * history rather than evidence. See `lacksPreferredProduct`, which owns both
 * halves of that test.
 */
export function lacksWantedProduct(link: ItemShopLink, item: GroceryItem): boolean {
  return lacksPreferredProduct(item, link);
}

/**
 * The one gate every "where can I get this" read runs each link through.
 *
 * Two ways a store can fail it, and they're different claims: the user said the
 * store doesn't stock the item at all (`unavailableAt`), or that it hasn't got
 * the product they want (`unavailableProductIds`). Both mean "not a place to get
 * this"; only the first means "they haven't got it".
 *
 * Kept as one predicate rather than two filters at each call site because there
 * are seven such reads and a new one is exactly the kind of thing that ships
 * having remembered the first rule and forgotten the second.
 */
export function countsForItem(link: ItemShopLink, item: GroceryItem): boolean {
  return !isUnavailable(link) && !lacksWantedProduct(link, item);
}

/**
 * Does this store's declared range include `aisle`? True for an unscoped store,
 * which is every store until somebody says otherwise.
 *
 * `Shop.aisles` is an inclusion list, so this is a membership test and not a
 * lexicon lookup: aisle names are the user's own strings, and guessing that a
 * pharmacy "obviously" doesn't sell Frozen is exactly the inference this
 * feature exists to replace with a statement.
 */
export function sellsAisle(shop: Shop, aisle: string): boolean {
  return shop.aisles === null || shop.aisles.includes(aisle);
}

/**
 * The standing negative: the user has said this store sells certain aisles and
 * this item isn't in one of them.
 *
 * **This is the user asserting a range, never the app inferring one.** That is
 * the whole reason it is allowed to exist next to `isUnavailable` rather than
 * being the `likelyItemIds` guess `shoppingTrip.ts` deleted coming back in the
 * negative direction. The app still learns nothing about a shop on its own; it
 * repeats something it was told.
 *
 * **A positive link outranks it**, which is the rule that makes a
 * roughly-drawn scope safe. If the record says you have bought Tofurky at the
 * pharmacy, or that you tapped it to say you can get it there, then the scope
 * is wrong about this item and the specific statement beats the general one.
 * It is the same call `finishShopping` makes when a purchase clears
 * `unavailableAt`, just settled at read time — there is nothing to clear here,
 * because a scope is a standing claim rather than a stamped one.
 *
 * **Nothing is ever materialised from this into link rows.** Writing one
 * `unavailableAt` per out-of-range item would grow the table by items times
 * aisles, and it would destroy the distinction `ItemShopLink.unavailableAt`
 * is built on: a stamped link means the user looked, on a date. A scope has no
 * date because nobody looked at anything.
 *
 * And it gates only what the app **asks and asserts**. Linking the item here by
 * hand, ticking it off, scanning this store's receipt: all unchanged. A scope
 * is never a reason to refuse the user something.
 */
export function isOutOfRange(
  shop: Shop,
  item: GroceryItem,
  links: readonly ItemShopLink[]
): boolean {
  if (sellsAisle(shop, item.aisle)) return false;
  return !links.some(
    l => l.itemId === item.id && l.shopId === shop.id && countsForItem(l, item)
  );
}

/**
 * "Personal Care and Household" — a scoped store's range in its own words, or
 * null for a store that sells everything.
 *
 * One function so the aisles sheet, the planner's coverage line and the trip
 * caption can't come to word it three ways, the same reason `describeShops`
 * exists below.
 */
export function describeShopAisles(shop: Shop): string | null {
  const aisles = shop.aisles;
  if (!aisles || aisles.length === 0) return null;
  if (aisles.length === 1) return aisles[0];
  return `${aisles.slice(0, -1).join(', ')} and ${aisles[aisles.length - 1]}`;
}

function byPurchasesThenRecency(a: ItemShopLink, b: ItemShopLink): number {
  if (b.purchaseCount !== a.purchaseCount) return b.purchaseCount - a.purchaseCount;
  const at = a.lastPurchasedAt ? Date.parse(a.lastPurchasedAt) : 0;
  const bt = b.lastPurchasedAt ? Date.parse(b.lastPurchasedAt) : 0;
  return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
}

export interface ShopWithCount {
  shop: Shop;
  purchaseCount: number;
  lastPurchasedAt: string | null;
}

/**
 * The stores one item has been bought at (or been asserted to live at), most
 * bought first.
 *
 * **A store marked as not stocking it is not one of them**, whatever its
 * purchase history — this is the "where can I get this" read, and the whole
 * point of the negative claim is that the answer is "not here any more".
 * `unavailableShopsFor` is the other half, for the one caller that shows and
 * undoes those claims. **Nor is a store the user has said hasn't got their
 * product**, when the item insists on one — `withoutProductShopsFor` is that half,
 * and `countsForItem` is the gate both go through.
 *
 * Takes the whole item rather than an id because the product rule is a fact about
 * the item, not about the link — the id alone can't answer it.
 *
 * A link naming a store that no longer exists is dropped rather than rendered
 * as a blank chip. That shouldn't happen — dbDeleteGroceryShop cascades — but
 * a resolve-or-shrug reader is what the rest of this codebase does with every
 * cross-row pointer (canBlock, the previousOccurrenceId walks), and it's the
 * difference between a stale row and a crash.
 */
export function shopsForItem(
  item: GroceryItem,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): ShopWithCount[] {
  const byId = new Map(shops.map(s => [s.id, s]));
  return links
    .filter(l => l.itemId === item.id && byId.has(l.shopId) && countsForItem(l, item))
    .sort(byPurchasesThenRecency)
    .map(l => ({
      shop: byId.get(l.shopId)!,
      purchaseCount: l.purchaseCount,
      lastPurchasedAt: l.lastPurchasedAt,
    }));
}

/**
 * The stores the user has said don't stock this item, in the store list's own
 * order — there's nothing to rank them by, and a claim isn't stronger for being
 * older.
 *
 * Deliberately a separate call rather than a flag on `ShopWithCount`: the
 * default read of "which stores have this" must not have to remember to filter,
 * and every caller that wants the negatives is asking a different question.
 */
export function unavailableShopsFor(
  itemId: string,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): Shop[] {
  const marked = new Set(
    links.filter(l => l.itemId === itemId && isUnavailable(l)).map(l => l.shopId)
  );
  return shops.filter(s => marked.has(s.id));
}

/**
 * The stores the user has said haven't got their product — the parallel of
 * `unavailableShopsFor`, and for the same reason: the default read must not
 * have to remember to filter, and the one surface that shows and undoes these
 * claims is asking a different question.
 *
 * In the store list's own order, like `unavailableShopsFor`: there is nothing
 * to rank claims by, and one isn't stronger for being older.
 *
 * Empty whenever the item isn't strict, so a caller can render it unguarded:
 * with the switch off there are no claims in force, only a preference.
 */
export function withoutProductShopsFor(
  item: GroceryItem,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): Shop[] {
  const marked = new Set(
    links.filter(l => l.itemId === item.id && lacksWantedProduct(l, item)).map(l => l.shopId)
  );
  return shops.filter(s => marked.has(s.id));
}

/**
 * Where you usually get this, or null.
 *
 * Only an *observed* link qualifies: "usually Costco" off the back of a
 * checkbox somebody ticked once would be the app inventing a habit. A tie on
 * count falls through to recency via the sort, so the store you were at most
 * recently wins — which is the more useful answer when both are 3.
 *
 * A store flagged `excludeFromSuggestions` never wins here even if it's the
 * most-bought-at — that flag exists precisely to keep a record-keeping-only
 * store (Amazon: "it has everything") from being actively recommended.
 * `shopsForItem` itself stays unfiltered, so the item sheet's full history
 * still lists it.
 */
export function primaryShopFor(
  item: GroceryItem,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): Shop | null {
  const ranked = shopsForItem(item, links, shops)
    .filter(s => s.purchaseCount > 0 && !s.shop.excludeFromSuggestions);
  return ranked.length > 0 ? ranked[0].shop : null;
}

/**
 * The one store this item is tied to, or null if it's tied to none or several.
 * An assertion counts here — "only at Costco" is a claim about availability,
 * and the user making it by hand is as good an answer as a trip.
 *
 * Same exclusion as primaryShopFor: a store flagged `excludeFromSuggestions`
 * is dropped before the "is there exactly one" count, so an item otherwise
 * only linked to Amazon reads as tied to none, not "exclusively Amazon".
 */
export function exclusiveShopFor(
  item: GroceryItem,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): Shop | null {
  const all = shopsForItem(item, links, shops).filter(s => !s.shop.excludeFromSuggestions);
  return all.length === 1 ? all[0].shop : null;
}

/**
 * Where a row with no store to file under lands in `buildGroceryStoreSections`,
 * always last, the convention `NO_RECIPE_LABEL` and `OTHER_AISLE` follow.
 *
 * Worded as what the app doesn't know rather than as anything about a store
 * (#2938). "Any store" or "Anywhere" would be the app claiming a range for
 * these rows, and the only thing actually true of them is that nothing on
 * record ties them to one.
 */
export const NO_STORE_LABEL = 'No store on record';

export interface GroceryStoreSection {
  /** Null for the catch-all bucket; see NO_STORE_LABEL. */
  shopId: string | null;
  shopName: string;
  data: GroceryItem[];
}

/**
 * The store a list row files under in the store lens, or null.
 *
 * Habit first (`primaryShopFor`: where you have actually bought it most),
 * then the user's own assertion (`exclusiveShopFor`: the one store it is
 * linked to, a hand-tap included). Both already drop a store marked as not
 * stocking it and a store flagged "don't suggest", so a row is never filed
 * under a shop the user has said to leave out of exactly this kind of read.
 * Nothing weaker is consulted: an item with two stores on record and no
 * purchases at either has no answer, and guessing one would be the app
 * inventing a habit.
 */
export function storeSectionShopFor(
  item: GroceryItem,
  links: readonly ItemShopLink[],
  shops: readonly Shop[]
): Shop | null {
  return primaryShopFor(item, links, shops) ?? exclusiveShopFor(item, links, shops);
}

/**
 * The third lens on the shopping list (#2938): cut into the stores each row is
 * bought at, so a two-stop plan reads as two short lists rather than one long
 * one. The sibling of `buildGrocerySections` and `buildGroceryRecipeSections`
 * (grocerySuggest.ts), with the same return shape and the same in-cart hold.
 *
 * - **Which store** is `storeSectionShopFor`: habit, then the user's own
 *   assertion, else the last section (`NO_STORE_LABEL`).
 * - **Section order** is the user's own store order (the `shops` array as the
 *   store holds it), except that the store a running trip is at comes first:
 *   it is the one you are standing in. Pass `tripShopId` only from
 *   `resolveActiveTrip`, so an aged-out trip can't keep reordering the list.
 * - **Within a section, the aisle walk is kept.** The rows are cut into aisles
 *   with the same `sectionsInAisleOrder` the aisle lens uses and read back in
 *   that order, so a store's rows come in the order you'd pass them in the
 *   aisle lens, just without the aisle headings.
 *
 * Nothing here decides a trip or reads the list as a claim about a store: a
 * section is only where the record says you usually get something.
 */
export function buildGroceryStoreSections(
  items: readonly GroceryItem[],
  links: readonly ItemShopLink[],
  shops: readonly Shop[],
  aisleOrder: readonly string[],
  cartHoldIds: readonly string[] = [],
  tripShopId: string | null = null
): { sections: GroceryStoreSection[]; inCart: GroceryItem[]; remaining: number } {
  const held = new Set(cartHoldIds);
  const onList = items.filter(i => i.onList);

  // One pass over the links rather than a scan of all of them per row: the
  // link table is every (item, store) pair ever recorded, and the list is a
  // few dozen rows out of it.
  const onListIds = new Set(onList.map(i => i.id));
  const linksByItem = new Map<string, ItemShopLink[]>();
  for (const l of links) {
    if (!onListIds.has(l.itemId)) continue;
    const bucket = linksByItem.get(l.itemId);
    if (bucket) bucket.push(l);
    else linksByItem.set(l.itemId, [l]);
  }

  const byShop = new Map<string | null, GroceryItem[]>();
  const inCart: GroceryItem[] = [];
  for (const item of onList) {
    if (item.checked && !held.has(item.id)) {
      inCart.push(item);
      continue;
    }
    const shop = storeSectionShopFor(item, linksByItem.get(item.id) ?? [], shops);
    const key = shop?.id ?? null;
    const bucket = byShop.get(key);
    if (bucket) bucket.push(item);
    else byShop.set(key, [item]);
  }

  const bySortOrder = (a: GroceryItem, b: GroceryItem) =>
    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const inAisleWalk = (data: GroceryItem[]): GroceryItem[] => {
    const byAisle = new Map<string, GroceryItem[]>();
    for (const item of data) {
      const aisle = item.aisle || OTHER_AISLE;
      const bucket = byAisle.get(aisle);
      if (bucket) bucket.push(item);
      else byAisle.set(aisle, [item]);
    }
    return sectionsInAisleOrder(byAisle, aisleOrder, bySortOrder).flatMap(s => s.data);
  };

  const ordered = shops.filter(s => byShop.has(s.id));
  const tripIndex = tripShopId ? ordered.findIndex(s => s.id === tripShopId) : -1;
  if (tripIndex > 0) ordered.unshift(...ordered.splice(tripIndex, 1));

  const sections: GroceryStoreSection[] = ordered.map(shop => ({
    shopId: shop.id,
    shopName: shop.name,
    data: inAisleWalk(byShop.get(shop.id)!),
  }));
  const unfiled = byShop.get(null);
  if (unfiled) sections.push({ shopId: null, shopName: NO_STORE_LABEL, data: inAisleWalk(unfiled) });

  inCart.sort(bySortOrder);

  return {
    sections,
    inCart,
    remaining: onList.filter(i => !i.checked).length,
  };
}

/**
 * The item ids linked to a store — the set behind the catalog's store filter. A
 * negative link isn't one: "what does Costco carry" must not answer with the
 * thing you noted Costco doesn't.
 */
export function itemIdsForShop(
  shopId: string,
  links: readonly ItemShopLink[],
  items: readonly GroceryItem[]
): Set<string> {
  const byId = new Map(items.map(i => [i.id, i]));
  const out = new Set<string>();
  for (const link of links) {
    if (link.shopId !== shopId) continue;
    const item = byId.get(link.itemId);
    // Resolve-or-shrug on a link whose item is gone, same as shopsForItem does
    // for a missing shop — and it can't be product-judged without the item
    // anyway.
    if (!item || !countsForItem(link, item)) continue;
    out.add(link.itemId);
  }
  return out;
}

/**
 * The confirm for deleting a store: what goes with it, counted from the data.
 *
 * `deleteShop` takes the store's item links (and the prices and price history
 * riding on them), the receipt lines remembered against its printer, and ends
 * a shopping trip there along with its budget. The confirm used to name only
 * the links, and said "Nothing is recorded" for a store that had remembered
 * receipt lines but no links. Each thing is its own sentence, never summed.
 */
export function describeShopDelete(
  shopId: string,
  items: readonly GroceryItem[],
  links: readonly ItemShopLink[],
  aliases: readonly Pick<StoreAlias, 'shopId'>[],
  tripShopId: string | null,
): string {
  const itemCount = itemIdsForShop(shopId, links, items).size;
  const live = new Set(items.map(i => i.id));
  const priced = links.filter(l => l.shopId === shopId && l.lastPriceMinor !== null && live.has(l.itemId)).length;
  const receiptLines = aliases.filter(a => a.shopId === shopId).length;
  const endsTrip = tripShopId === shopId;

  const sentences: string[] = [];
  if (itemCount > 0) {
    sentences.push(`${itemCount} ${itemCount === 1 ? 'item is' : 'items are'} recorded as coming from here. Deleting the store forgets that. The items themselves stay.`);
  }
  if (priced > 0) {
    sentences.push(`The prices recorded here for ${priced} ${priced === 1 ? 'item go' : 'items go'} too.`);
  }
  if (receiptLines > 0) {
    sentences.push(`${receiptLines} remembered receipt ${receiptLines === 1 ? 'line goes' : 'lines go'} too.`);
  }
  if (endsTrip) sentences.push('Your shopping trip here ends.');
  if (sentences.length === 0) return 'Nothing is recorded against this store yet.';
  return `${sentences.join(' ')} This can’t be undone.`;
}

/**
 * How many catalog rows each store has, for the filter chips. Counts only
 * links whose item still exists, so a chip never promises rows the filtered
 * list can't produce — and only positive ones, so the count agrees with what
 * `itemIdsForShop` will actually show.
 *
 * `exclude` is for a view that leaves some rows out anyway: the catalog sheet
 * hides whatever is already in the active trolley, so its chips pass that set
 * here, or "Costco 70" filtered down to 60 rows.
 */
export function itemCountsByShop(
  items: readonly GroceryItem[],
  links: readonly ItemShopLink[],
  exclude?: ReadonlySet<string> | ReadonlyMap<string, unknown>
): Map<string, number> {
  const byId = new Map(items.map(i => [i.id, i]));
  const counts = new Map<string, number>();
  for (const link of links) {
    const item = byId.get(link.itemId);
    if (!item || !countsForItem(link, item)) continue;
    if (exclude?.has(link.itemId)) continue;
    counts.set(link.shopId, (counts.get(link.shopId) ?? 0) + 1);
  }
  return counts;
}

/**
 * The item sheet's footnote. One sentence, and deliberately never arithmetic
 * across the two numbers: "Bought 7 times · usually Costco" is true even when
 * only 6 of those 7 have a store on them, whereas anything of the form "6 of 7"
 * would be claiming the app knows where the seventh happened.
 */
export function describeShops(
  item: GroceryItem,
  links: readonly ItemShopLink[],
  shops: readonly Shop[],
  products: readonly ItemProduct[] = []
): string | null {
  const bought = item.purchaseCount > 0
    ? `Bought ${item.purchaseCount} ${item.purchaseCount === 1 ? 'time' : 'times'}`
    : null;

  // The negative claims ride as a trailing clause on whatever the positive
  // record says, because they're a different kind of fact and must never be
  // read as qualifying the count in front of them. An item bought 7 times that
  // Safeway has stopped stocking is both of those things at once.
  const notAt = unavailableShopsFor(item.id, links, shops);
  // The product-level negatives ride as their own trailing clause, after the
  // not-stocked one and worded differently on purpose: "not at Safeway" and
  // "no Good Culture low fat at Safeway" are different facts, and collapsing
  // them would tell the user a shop had nothing when it had the item and not
  // the box they want.
  const withoutProduct = withoutProductShopsFor(item, links, shops);
  // The preferred product's own words, from the one helper that owns them. Null
  // only if the pointer dangles, which `withoutProductShopsFor` has already
  // ruled out — a claim is only in force while it names the preferred product,
  // and a preference that resolves to nothing can't be strict about anything.
  const wanted = describePreferredProduct(item, products);
  const withClauses = (head: string | null): string | null => {
    let out = head;
    if (notAt.length > 0) {
      const names = notAt.map(s => s.name).join(', ');
      out = out ? `${out} · not at ${names}` : `Not at ${names}`;
    }
    if (withoutProduct.length > 0 && wanted) {
      const names = withoutProduct.map(s => s.name).join(', ');
      const clause = `no ${wanted} at ${names}`;
      out = out ? `${out} · ${clause}` : `No ${wanted} at ${names}`;
    }
    return out;
  };

  const ranked = shopsForItem(item, links, shops);
  if (ranked.length === 0) return withClauses(bought);

  const observed = ranked.filter(s => s.purchaseCount > 0);
  if (observed.length === 0) {
    // Every link here is a hand-assertion, so say so rather than dressing it
    // up as history the app collected.
    const names = ranked.map(s => s.shop.name).join(', ');
    return withClauses(bought ? `${bought} · you get it at ${names}` : `You get it at ${names}`);
  }

  // "only at" needs *every* positive link to be that one store, not just every
  // observed one: with Costco bought 6× and Safeway asserted by hand, the item
  // is known to be in two places and "only at Costco" contradicts what the user
  // said. A store marked as *not* stocking it isn't a second place and doesn't
  // spoil "only at" — it's the clause after it.
  const where = ranked.length === 1
    ? `only at ${observed[0].shop.name}`
    : `usually ${observed[0].shop.name}`;
  return withClauses(bought ? `${bought} · ${where}` : where);
}
