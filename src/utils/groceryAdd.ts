/**
 * How a grocery row is built, and what adding a name to the list decides.
 *
 * Lifted out of `useGroceryStore` unchanged, the third file on this pattern
 * after `taskDraft.ts` and `taskCompletion.ts` and for the same reason: the MCP
 * server writes into a replica of this database from a Node process (see
 * docs/arch/mcp-server.md), and `useGroceryStore` cannot be imported there. It
 * reaches `expo-notifications` through `utils/notifications` and `useTaskStore`
 * through the supply restock, both at module scope, so the import is poisoned
 * regardless of which action a caller wanted.
 *
 * Neither of those is anywhere near the add path, which is what makes this
 * worth separating rather than working around.
 *
 * **The reason to move it rather than write a second one is the same as ever,
 * and groceries make it sharper than tasks did.** `newItemRow` decides forty
 * columns, and a second copy would not fail loudly when the two drifted: it
 * would quietly create rows missing whatever column was added last. The find
 * step is worse still. `catalogItemForKey` resolves singular against plural, so
 * a caller reading `items.find(i => i.nameKey === key)` mints "serrano pepper"
 * beside an existing "Serrano peppers", splitting one shelf item's aisle,
 * purchase count and pantry state in two with nothing to say it happened.
 * `docs/arch/groceries.md` names that read as the mistake by hand.
 *
 * What stayed in the store is what is not a row: the `set()`, the cart-hold
 * timer behind the tick animation, `setLastAction`/`undoForAdds`, and the
 * debounced AI aisle classification for a row that landed in Other. All of it
 * is either React state or a network call, and none of it is a fact about the
 * list.
 */
import type { GroceryItem, GroceryListEntry, ItemProduct } from '../types';
import { generateId } from './id';
import { groceryNameKey, parseGroceryInput } from './groceryParse';
import { catalogItemForKey } from './groceryPlural';
import { aisleForName, placeAisle } from './groceryAisles';
import { entryFor, nextListSortOrder } from './groceryLists';
import { productKeyFor } from './groceryProduct';

/** The next free slot in the catalog's own order. */
export function nextSortOrder(items: GroceryItem[]): number {
  return items.reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1;
}

/**
 * Find-or-create one box under an item, without writing anything.
 *
 * Find rather than always-create, because `productKeyFor` is the identity and
 * the UNIQUE index enforces it: typing "Arnold's" on a row that already has an
 * Arnold's product means *that* product, not a second one that would split its
 * rating and its purchase count in two. The same rule as addByName's own
 * find-or-insert on `nameKey`, one level down.
 *
 * **The match is on case and spacing, not on punctuation.** `productKeyFor`
 * goes through `groceryNameKey`, which keeps letters, digits and `%` and turns
 * everything else into a space, so "Arnold's" keys as `arnold s` while
 * "arnolds" keys as `arnolds`: those are two boxes, not one. Worth stating
 * because the sentence above reads as though any re-typing matches, and it is
 * the kind of thing a reader would otherwise assume rather than check.
 *
 * Null when neither half names anything — a product with no brand and no
 * variant is the item itself, so there's nothing to create. Callers read that
 * as "the user cleared the field", not as a failure.
 *
 * Pure, so the caller owns the db write and the `set()`; both call sites need
 * to do slightly different things with the result.
 */
export function ensureProductFor(
  itemId: string,
  brand: string | null,
  variant: string | null,
  products: readonly ItemProduct[],
  createdAt: string
): { product: ItemProduct; created: boolean } | null {
  const productKey = productKeyFor(brand, variant);
  if (!productKey) return null;
  const existing = products.find(p => p.itemId === itemId && p.productKey === productKey);
  // The stored spelling is left alone on a match, the way addByName's own
  // find-or-insert deliberately does *not*: an item's name is the label on a
  // row the user is looking at, while a product's is a value they picked from
  // their own list — re-typing "ARNOLD'S" under a product filed as "Arnold's"
  // is a match, not a correction. Editing the spelling is the product sheet's
  // job, where the field shows what it's about to change.
  if (existing) return { product: existing, created: false };
  return {
    created: true,
    product: {
      id: generateId(),
      itemId,
      brand,
      variant,
      productKey,
      // Never inferred, in either direction. A box you just named is one you
      // have no opinion about yet, and buying something is not liking it.
      rating: null,
      note: '',
      purchaseCount: 0,
      lastPurchasedAt: null,
      // A box nobody has said anything about yet, which is the honest state of
      // one being minted: it defers to its item on all four until the user
      // says otherwise. Naming a box is not a claim to be holding one.
      onHandUntil: null,
      expiresAt: null,
      frozenAt: null,
      openedAt: null,
      // Defers to the item's, same as the four above. A box named by hand says
      // nothing about what is in it; a scanned one gets its label panel from
      // the lookup rather than from being minted here.
      nutrition: null,
      // Never set here, even on the scan path that has a barcode in hand.
      // Claiming one has to release it from whichever box held it before, so
      // it goes through `linkScannedGtins` rather than riding an insert.
      gtin: null,
      createdAt,
    },
  };
}

/**
 * A brand-new catalog row, with every field nobody passes in already decided.
 *
 * Both insert paths go through it — addByName's list add and addToPantry's
 * off-list one — so there's still exactly one place that knows what a fresh row
 * looks like, and a column added later can't reach only one of them. The two
 * differ in `onList`/`onHandUntil`, which is why those are the
 * fields with no default here.
 */
export function newItemRow(fields: {
  name: string;
  nameKey: string;
  aisle: string;
  sortOrder: number;
  createdAt: string;
  onList: boolean;
  quantity?: string | null;
  note?: string | null;
  choiceGroup?: string | null;
  /** See GroceryItem.nameFromScan. Only the barcode path passes this. */
  nameFromScan?: boolean;
  source?: { recipeId: string; recipeTitle: string };
  onHandUntil?: string | null;
}): GroceryItem {
  return {
    id: generateId(),
    name: fields.name,
    nameKey: fields.nameKey,
    // A fresh row has no products and so no preference. A brand typed into
    // GroceryAddField's chip becomes a real ItemProduct *after* the row exists
    // (addByName does that, since it needs the item's id), which is why this
    // isn't a field on the factory the way quantity and note are.
    //
    // Nothing is ever *parsed* out of the typed line: "Good Culture cottage
    // cheese" typed as a name is still just a name — see ItemProduct.brand.
    preferredProductId: null,
    // A preference is not a rule — see GroceryItem.productStrict. Nothing
    // infers this, including from a product being named.
    productStrict: false,
    aisle: fields.aisle,
    quantity: fields.quantity ?? null,
    // Never true from this path — a fresh row's quantity, if any, came from
    // whatever the caller typed or parsed, not from addFromPlan's recipe-owned
    // write, which always goes through setQuantity's fromRecipe option instead.
    quantityFromRecipe: false,
    note: fields.note ?? '',
    // A mirror of the home entry from here on (see GroceryItem.onList), and
    // true here only because the caller is about to write one. The membership
    // itself is `joinList`'s job, not this factory's — a row exists in the
    // catalog whether or not it is in anybody's trolley.
    onList: fields.onList,
    checked: false,
    sortOrder: fields.sortOrder,
    purchaseCount: 0,
    lastAddedAt: fields.onList ? fields.createdAt : null,
    lastPurchasedAt: null,
    createdAt: fields.createdAt,
    onHandUntil: fields.onHandUntil ?? null,
    // A genuinely new row is attributed here; a row reused via addByName's
    // `existing` branch never reaches this factory and is restamped there
    // instead, per the field's doc comment on GroceryItem.
    choiceGroup: fields.choiceGroup ?? null,
    sourceRecipeId: fields.source?.recipeId ?? null,
    sourceRecipeTitle: fields.source?.recipeTitle ?? null,
    isStaple: false,
    // Nothing on the *list* has a use-by date: adding a name is a plan to buy
    // it, and the shelf life doesn't start until it's in the fridge.
    // finishShopping is what stamps this — see expiresAtForPurchase.
    expiresAt: null,
    // Nothing is created frozen: the freezer is somewhere the user puts a
    // thing they already have, not a state a name arrives in. Same for opened —
    // a name typed onto the list is a plan to buy, not a jar on the counter.
    frozenAt: null,
    openedAt: null,
    runningLowAt: null,
    // No one has corrected the lexicon guess for this row yet.
    shelfLifeDays: null,
    useUpTask: null,
    // Nothing infers a variety declaration — the user says so, on the item
    // sheet. See GroceryItem.varietyOfKey.
    varietyOfKey: null,
    // Nobody has been asked about a row that didn't exist a moment ago, and a
    // brand-new row can't have a lapsed purchase reading to be asked about.
    pantryCheckDeclinedAt: null,
    pantryReviewedAt: null,
    // Nothing has left the pantry yet, because nothing has been in it. See
    // GroceryItem.usedUpCount.
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    // Same reasoning as expiresAt: a name typed onto the list is a plan to buy
    // something, and nothing has been paid for it yet. finishShopping and the
    // item sheet are the two things that ever set a price.
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    // Unknown, which is a different thing from "contains nothing" — see
    // FoodNutrition.amounts. Nothing is inferred from a name: knowing a row is
    // called "onion" is not knowing what an onion is made of, and a lookup
    // (or a person) has to say so before this holds anything.
    nutrition: null,
    // Nobody has dismissed a Backfill screen field on a row that didn't exist
    // a moment ago.
    backfillDismissedFields: [],
    // False for every path but the barcode one, and false there too unless the
    // user left the proposed name alone — a name somebody typed is a name
    // somebody chose. See GroceryItem.nameFromScan.
    nameFromScan: fields.nameFromScan ?? false,
  };
}
/** What a caller may say about one add, past the name itself. */
export interface GroceryAddOverride {
  name: string;
  quantity: string | null;
  note?: string | null;
  choiceGroup?: string | null;
  brand?: string | null;
  variant?: string | null;
  /** A barcode source's own category. The weakest of the three aisle opinions. */
  aisle?: string | null;
  nameFromScan?: boolean;
}

/** Everything `planGroceryAdd` would otherwise have reached the store for. */
export interface GroceryAddContext {
  items: readonly GroceryItem[];
  itemProducts: readonly ItemProduct[];
  listEntries: readonly GroceryListEntry[];
  /** Where the user filed a name last time, by `nameKey`. Beats the lexicon. */
  aisleOverrides: Readonly<Record<string, string>>;
  /** The aisles that currently exist, in the user's own walk order. */
  aisleOrder: readonly string[];
  /** Which trolley to join. `null` is the list at home. */
  listId: string | null;
  now: string;
}

/**
 * The rows one add produces, written by nobody.
 *
 * `item` is the row to insert when `isNew`, or to update when not. `entry` is
 * the membership row to upsert, and is null when that list already holds this
 * item: re-adding to a trolley it is already in must be a no-op on the entry,
 * or the tick and the walk-order slot it already had would be thrown away.
 * Typing "milk" twice must not un-tick the milk in your cart.
 */
export interface GroceryAddPlan {
  item: GroceryItem;
  isNew: boolean;
  entry: GroceryListEntry | null;
  /** A product minted by the Brand/Variant chips, needing its own write. */
  product: ItemProduct | null;
  /** Whether the row was already in some trolley before this add. */
  wasOnList: boolean;
}

/**
 * Decide what adding this name does, without doing it.
 *
 * **Joins rather than moves.** A row already in the trolley at home stays there
 * when it is added to the Airbnb list, which is the whole reason membership is
 * a table rather than a column (see `GroceryListEntry`).
 *
 * The three-way aisle precedence is the user's remembered filing, then the name
 * lexicon, then a barcode source's category, and `placeAisle` has the last word
 * over all three: neither of the first two knows which aisles still exist, so
 * naming a deleted one would bring its whole section back.
 */
export function planGroceryAdd(
  raw: string,
  context: GroceryAddContext,
  override?: GroceryAddOverride,
  source?: { recipeId: string; recipeTitle: string },
): GroceryAddPlan {
  const { items, itemProducts, listEntries, aisleOverrides, aisleOrder, listId, now } = context;
  const { name, quantity } = override ?? parseGroceryInput(raw);
  const note = override?.note?.trim() || null;
  const choiceGroup = override?.choiceGroup?.trim() || null;
  const brand = override?.brand?.trim() || null;
  const variant = override?.variant?.trim() || null;
  const sourceAisle = override?.aisle?.trim() || null;
  // A name with no letters or digits ("???") normalises to an empty key.
  // Falling back to the raw text keeps the key unique, which matters: two such
  // rows would collide on the UNIQUE index and the *second* insert would throw
  // out of whatever was calling — a paste, or the Reminders drain mid-batch.
  const key = groceryNameKey(name) || name.trim().toLowerCase();
  // Exact key first, then the singular/plural of it — "serrano pepper" against
  // a catalog holding Serrano peppers is that row, not a second one splitting
  // its purchase count and its aisle in two. See groceryPlural.ts; nothing
  // about the stored key changes, this is only how a name finds it.
  const existing = catalogItemForKey(key, items) ?? undefined;
  const wasOnList = existing?.onList === true;

  // The entry to upsert, or null for "leave the membership alone".
  //
  // An item already in this trolley normally needs nothing: re-adding must not
  // reset the tick or the walk-order slot it already had, so typing "milk"
  // twice does not un-tick the milk in your cart. The exception is a named
  // either/or, which has to reach an entry that already exists — adding
  // "apples or pears" while apples is in the trolley makes that row one option
  // of the new pair, and writing it only onto a freshly created entry would
  // silently drop the pairing in exactly the case it is most likely to be used.
  //
  // An either/or is this trolley's rather than the item's, which is why the
  // group lives on the entry and not on the row.
  const membership = (itemId: string): GroceryListEntry | null => {
    const existingEntry = entryFor(listEntries, itemId, listId);
    if (existingEntry) return choiceGroup ? { ...existingEntry, choiceGroup } : null;
    return {
      itemId,
      listId,
      checked: false,
      sortOrder: nextListSortOrder(listEntries, listId),
      choiceGroup,
      addedAt: now,
    };
  };

  if (existing) {
    const ensured = ensureProductFor(existing.id, brand, variant, itemProducts, now);
    const item: GroceryItem = {
      ...existing,
      // The typed name wins — capitalisation and wording are the user's. Only
      // on an exact key, though: a row found through its plural keeps the name
      // it has, because `nameKey` is derived from `name` and every reader
      // trusts that. Renaming Serrano peppers to "serrano pepper" here would
      // leave the row keyed for a name it no longer carries.
      name: existing.nameKey === key ? name || existing.name : existing.name,
      // Both mirror the home entry, which is what `dbSyncGroceryHomeColumns`
      // treats as the truth, so they are read off the entries rather than
      // assumed.
      //
      // **`checked` used to be forced to false whenever the target was the home
      // list, and that un-ticked things you had already put in your cart.** The
      // stated reason was that the membership write would recompute it, and it
      // does not: joining a list a row is already in is a deliberate no-op, so
      // on exactly the path where the tick matters nothing recomputed anything
      // and the false stuck. The row then said unbought while its own entry
      // still said checked. Re-adding milk you have already picked up is not a
      // statement that you have not picked it up, which is what `joinList`'s
      // comment about typing "milk" twice was getting at all along.
      onList: existing.onList || listId === null,
      checked: entryFor(listEntries, existing.id, null)?.checked ?? false,
      // Only overwrite the quantity when this add actually carried one; typing
      // "milk" to re-add shouldn't wipe the "2 gal" set last week.
      quantity: quantity ?? existing.quantity,
      // A quantity typed here is the user's own, so it takes ownership exactly
      // as setQuantity does. Left alone when nothing was typed, so a re-add
      // with no amount doesn't strip a still-standing recipe ownership.
      quantityFromRecipe: quantity ? false : existing.quantityFromRecipe,
      // Same rule: re-adding a known item without saying why must not wipe the
      // note that has been on it since last time.
      note: note ?? existing.note,
      // Same rule again: adding "apples or pears" when apples is already on the
      // list makes that row one option of the new pair, but a plain re-add of
      // apples must not dissolve a pair it is already in.
      choiceGroup: choiceGroup ?? existing.choiceGroup,
      lastAddedAt: now,
      // A row still on some list is a standing item the user owns, same as the
      // note and quantity above, so a recipe re-adding it does not relabel it.
      // A row that had fallen off every list is functionally a fresh add: the
      // recipe that put it back is the reason it is there, and crediting a
      // stale recipe (possibly cooked and forgotten) is actively misleading.
      sourceRecipeId: !wasOnList && source ? source.recipeId : existing.sourceRecipeId,
      sourceRecipeTitle: !wasOnList && source ? source.recipeTitle : existing.sourceRecipeTitle,
      ...(ensured ? { preferredProductId: ensured.product.id } : {}),
    };
    return {
      item,
      isNew: false,
      entry: membership(existing.id),
      product: ensured?.created ? ensured.product : null,
      wasOnList,
    };
  }

  const item = newItemRow({
    name,
    nameKey: key,
    aisle: placeAisle(aisleOverrides[key] ?? aisleForName(name) ?? sourceAisle, aisleOrder),
    quantity,
    note,
    onList: true,
    sortOrder: nextSortOrder([...items]),
    createdAt: now,
    choiceGroup,
    source,
    nameFromScan: override?.nameFromScan === true,
  });
  // After the row exists, because a product hangs off an item id. Nothing is
  // ever parsed out of the typed name to get here — see ItemProduct.brand.
  const ensured = ensureProductFor(item.id, brand, variant, itemProducts, now);
  if (ensured) item.preferredProductId = ensured.product.id;
  return {
    item,
    isNew: true,
    entry: membership(item.id),
    product: ensured?.created ? ensured.product : null,
    wasOnList: false,
  };
}
