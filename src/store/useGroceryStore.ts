import { create } from 'zustand';
import type { GroceryItem, ItemShopLink, Shop } from '../types';
import {
  dbGetAllGroceryItems,
  dbInsertGroceryItem,
  dbUpdateGroceryItem,
  dbDeleteGroceryItem,
  dbFinishGroceryShopping,
  dbClearGroceryList,
  dbGetGroceryAisleOrder,
  dbSetGroceryAisleOrder,
  dbGetAllGroceryShops,
  dbInsertGroceryShop,
  dbUpdateGroceryShop,
  dbDeleteGroceryShop,
  dbSetShopExcludeFromSuggestions,
  dbGetAllItemShopLinks,
  dbSetItemShopLink,
  dbDeleteItemShopLink,
  dbGetLastShopId,
  dbSetLastShopId,
  dbGetTripShopId,
  dbGetTripStartedAt,
  dbSetTrip,
  dbGetGroceryAisleOverrides,
  dbSetGroceryAisleOverrides,
  dbGetGroceryHiddenAisles,
  dbSetGroceryHiddenAisles,
  dbTransaction,
} from '../db/database';
import { useRecipeStore } from './useRecipeStore';
import { useTaskStore } from './useTaskStore';
import { useSettingsStore } from './useSettingsStore';
import { generateId } from '../utils/id';
import { groceryNameKey, parseGroceryInput, splitGroceryLines } from '../utils/groceryParse';
import { defaultOnHandUntil, OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
import { defaultExpiresAt } from '../utils/groceryShelfLife';
import { useUpTaskDraft, useUpTaskFields, useUpTaskNeedsUpdate, wantsUseUpTask } from '../utils/groceryExpiry';
import { dropGeneratedTask, reconcileGeneratedTask } from './generatedTaskSync';
import {
  aisleForName,
  normalizeAisleOrder,
  hiddenDefaultAisles,
  placeAisle,
  rememberAisles,
  remapRememberedAisle,
  forgetRememberedAisle,
  renameRememberedAisle,
  OTHER_AISLE,
} from '../utils/groceryAisles';
import { isTripLive, resolveActiveTrip } from '../utils/activeTrip';

/**
 * The grocery catalog, which is also the shopping list.
 *
 * One array of rows: `onList` decides what's on the list right now, and a row
 * that comes off the list stays in memory as catalog. Adding a name that's
 * already known flips `onList` instead of inserting — that single behaviour
 * (addByName below) is what gives autocomplete, Buy again and dedupe.
 *
 * `inCatalog` is the second axis, and it's what stops the catalog filling with
 * things that were never really yours: a name typed for the first time is
 * provisional, so taking it back off the list deletes it — whether that's a
 * removal, a finished trip that bought it (which promotes it: you own it now),
 * or a cleared trip that abandoned it (which doesn't). A row that was already
 * catalog before this stint on the list is never touched by that — "remove"
 * means remove from the list, exactly as it always did.
 *
 * Same discipline as every other store here: write to SQLite first, then set().
 */

/**
 * How long a checked row stays struck-through in its own aisle before sinking
 * into "In cart". Long enough to see the tap land where your eye already is,
 * short enough not to feel stuck.
 */
const CART_HOLD_MS = 1200;

/**
 * Mirrors useTaskStore's UndoableAction: shake-to-undo reads whichever of the
 * two stores' `lastAction` is freshest (see useShakeToUndo), so the shape has
 * to match — `undo` reverts exactly this action, `at` is stamped centrally by
 * setLastAction, never passed by a call site.
 */
interface UndoableAction {
  label: string;
  undo: () => void;
  at?: number;
}

// One shared timer, re-armed by each tap, exactly like armCompletionCollapse
// in useTaskStore — so a burst of checks sinks together instead of dribbling
// down one row at a time.
let cartHoldTimer: ReturnType<typeof setTimeout> | null = null;

function armCartHold(): void {
  if (cartHoldTimer) clearTimeout(cartHoldTimer);
  cartHoldTimer = setTimeout(() => {
    cartHoldTimer = null;
    if (useGroceryStore.getState().cartHoldIds.length > 0) {
      useGroceryStore.setState({ cartHoldIds: [] });
    }
  }, CART_HOLD_MS);
  // Without this, jest's node env hangs on the live handle at the end of a run.
  (cartHoldTimer as unknown as { unref?: () => void }).unref?.();
}

interface GroceryStore {
  items: GroceryItem[];
  aisleOrder: string[];
  /**
   * Built-in aisles the user has deleted or renamed away. Kept because the walk
   * order is repaired against DEFAULT_AISLES at read time, which would
   * otherwise undo the delete — see normalizeAisleOrder. Derived from the saved
   * order rather than edited directly, so the two can't disagree.
   */
  hiddenAisles: string[];
  /**
   * The places you shop, and which items have been bought at each. They live
   * here rather than in a store of their own for the reason aisleOrder does:
   * they're grocery configuration read by the same screens, and a
   * `useGroceryShopStore` sitting next to `useGroceryStore` is a name nobody
   * would reliably pick between.
   */
  shops: Shop[];
  itemShops: ItemShopLink[];
  /** The store the last trip was finished at, if it still exists. */
  lastShopId: string | null;
  /**
   * The trip happening right now: the store you said you're at, and when.
   *
   * Past tense above, present tense here — `lastShopId` is where the previous
   * shop *ended* and only ever preselects a picker, while these two say where
   * you are, and the list marks rows up accordingly. Never read them raw: they
   * are a stamp, not a state, and `resolveActiveTrip` is what turns them into a
   * store by checking both that it still exists and that the trip hasn't aged
   * out. `activeShop()` is that read.
   */
  tripShopId: string | null;
  tripStartedAt: string | null;
  /**
   * name_key → the aisle the user last filed that item under. Consulted ahead
   * of the lexicon when a row is created, so a correction sticks even after the
   * row it was made on is gone. See rememberAisles.
   */
  aisleOverrides: Record<string, string>;
  /** Checked rows still holding their place in their own aisle. */
  cartHoldIds: string[];
  initialized: boolean;

  /**
   * The most recent undoable grocery mutation — same shake-to-undo mechanism
   * useTaskStore drives, kept as a twin field here rather than folded into
   * that store because the two catalogs of undoable actions (tasks, grocery)
   * are otherwise unrelated. useShakeToUndo compares both stores' `at` and
   * offers whichever is freshest.
   */
  lastAction: UndoableAction | null;
  setLastAction: (action: UndoableAction | null) => void;
  undoLastAction: () => void;

  initialize: () => void;

  /**
   * Parse a typed line and put it on the list — creating the catalog row only
   * if it's new. `override` skips parseGroceryInput entirely and uses the
   * given name/quantity as-is — for GroceryAddField's per-token × button,
   * where the user has already decided which pieces of what they typed count
   * as quantity versus name and re-parsing `raw` would just reproduce the
   * split they rejected. `note` carries the pieces that are neither ("chopped",
   * "for margs") — they belong on the row, not in the name the catalog key and
   * the aisle lexicon are matched against.
   */
  addByName: (
    raw: string,
    override?: {
      name: string;
      quantity: string | null;
      note?: string | null;
      /** Files this row as one option of an either/or — see GroceryItem.choiceGroup. */
      choiceGroup?: string | null;
    },
    source?: { recipeId: string; recipeTitle: string },
    /** `registerUndo: false` suppresses the per-call shake-to-undo entry — batch
     * callers (addManyFromText, addFromPlan) use this and register one
     * combined action of their own after the loop. */
    opts?: { registerUndo?: boolean }
  ) => GroceryItem;
  /** A pasted block, one item per line. */
  addManyFromText: (raw: string) => { added: GroceryItem[]; alreadyOnList: GroceryItem[] };
  addExisting: (id: string) => void;
  addExistingMany: (ids: string[]) => void;
  /**
   * Puts a reviewed set of planned rows — currently a recipe's ingredients —
   * onto the list in one transaction. See the implementation for why this isn't
   * just a loop over addByName at the call site.
   */
  addFromPlan: (rows: readonly PlannedRow[]) => PlanAddResult;

  toggleChecked: (id: string) => void;
  /** toggleChecked's invariant (checked implies onList), applied to a whole selection at once. */
  setCheckedMany: (ids: string[], checked: boolean) => void;
  setQuantity: (id: string, quantity: string | null) => void;
  setAisle: (id: string, aisle: string) => void;
  setAisleMany: (assignments: Record<string, string>) => void;
  /** False when the new name collides with another catalog row. */
  renameItem: (id: string, name: string) => boolean;
  setNote: (id: string, note: string) => void;
  /**
   * Which one to reach for — "Good Culture". A dumb setter like setNote: the
   * empty string clears it back to "no opinion" rather than storing a blank,
   * so the field and the pill state can't disagree about what null means.
   */
  setBrand: (id: string, brand: string) => void;
  /**
   * Which one of that brand — "low fat", "4%". Same dumb setter as setBrand,
   * down to clearing on empty. See GroceryItem.variant.
   */
  setVariant: (id: string, variant: string) => void;
  /**
   * "Only this brand" — whether the brand filters store availability or is just
   * shown on the row. See GroceryItem.brandStrict.
   */
  setBrandStrict: (id: string, strict: boolean) => void;
  /**
   * "They haven't got the brand I want here", and taking it back. The only
   * claim a brand rule filters on — see ItemShopLink.brandUnavailableAt.
   *
   * Creates the link if there isn't one: the claim is about a store that stocks
   * the item, so it would be strange to require linking it first.
   */
  setBrandUnavailable: (itemId: string, shopId: string, unavailable: boolean) => void;
  /**
   * The pantry override — "Got it" / "Out of it" on GroceryItemSheet. A dumb
   * setter, same as setQuantity/setNote: the caller decides the value
   * (defaultOnHandUntil for "Got it", a past timestamp for "Out of it", or
   * null to clear back to grocerySuggest.probablyHaveReason's own guess).
   */
  setOnHandUntil: (id: string, until: string | null) => void;
  /**
   * "Out of it" for several rows at once — what a cook reports it used up
   * (CookedUseUpSheet), where the item sheet's pill says it one row at a time.
   *
   * Exactly the assertion that pill writes, batched: `OUT_OF_IT_UNTIL` on each,
   * nothing else touched. It's a separate action rather than a loop over
   * `setOnHandUntil` for the undo — a cook that reports three things is one
   * action the user took, and three entries in a queue shake-to-undo reads the
   * freshest of would let them take back one third of it.
   *
   * Rows already marked out are skipped rather than rewritten, so the count it
   * returns is what actually changed and an all-no-op call registers no undo.
   */
  markOutOfMany: (ids: readonly string[]) => number;
  /**
   * "I have this" for something the app hasn't worked out on its own — the add
   * field on PantrySheet. It writes exactly the assertion GroceryItemSheet's
   * "Got it" pill writes (defaultOnHandUntil, so it lapses on this item's own
   * cadence), which is the point: the pantry stays a set of catalog rows the
   * app computed and the user corrected, not a second table anyone has to keep
   * up. What it adds is a way to make that correction about an item that isn't
   * on the list and has never been bought through the app, which until now had
   * no sheet to open.
   *
   * **Never touches `onList`.** Saying you have flour is not a plan to buy
   * flour; a name already on the list stays on it, since the pantry lists those
   * rows too.
   *
   * Returns null for a name with nothing usable in it.
   */
  addToPantry: (raw: string) => GroceryItem | null;
  /**
   * The day this should be used up by, as a `YYYY-MM-DD` key, or null for
   * "doesn't go off on a schedule worth naming".
   *
   * Unlike setOnHandUntil this isn't a dumb setter: writing the date is what
   * spawns, re-dates or drops the item's "Use up X" task, because the date is
   * the only thing that decides any of the three.
   */
  setExpiresAt: (id: string, expiresAt: string | null) => void;
  /**
   * The per-item answer to "does this get a use-up task" — true, false, or
   * null to hand the question back to the setting. Reconciles immediately, so
   * the toggle in the item sheet is also what adds or removes the task.
   *
   * `reconcile: false` records the answer and stops there. Exactly one caller
   * wants that: undoing a task deletion, which has already put the row back
   * itself and is only clearing the opt-out that deletion wrote. Reconciling
   * there would re-decide the question against the *setting* and, with the
   * feature off, delete the task the user just asked to have back.
   */
  setUseUpTask: (id: string, value: boolean | null, options?: { reconcile?: boolean }) => void;

  /**
   * Staple on/off — "always have it", GroceryItemSheet's third pantry pill.
   * Unlike setOnHandUntil this never expires; a dumb setter, same shape.
   */
  setStaple: (id: string, isStaple: boolean) => void;

  /**
   * Picks this row at the shelf: it stays (no longer an either/or) and every
   * other option in its group comes off the list. Registers one undo that puts
   * them all back exactly as they were, group included.
   *
   * Called by toggleChecked, so ticking a row *is* the choice — that's the
   * whole interaction, and the alternative is a loser sitting on the list
   * looking outstanding for ever, since finishShopping only clears what's
   * checked.
   */
  resolveChoice: (id: string) => void;
  /**
   * "These aren't alternatives after all" — unlinks the whole group, from the
   * item sheet. Takes the label off every member rather than just this row: one
   * remaining option is not a choice, so a partial unlink can't be a state.
   */
  clearChoice: (id: string) => void;

  removeFromList: (id: string) => void;
  /** removeFromList over a whole selection at once. */
  removeFromListMany: (ids: string[]) => void;
  deleteItem: (id: string) => void;
  deleteItems: (ids: string[]) => void;

  /**
   * Ends the trip: everything checked comes off the list and counts as bought.
   * Returns how many. `shopId` is optional — null records the purchase without
   * a place, exactly as every trip did before stores existed.
   *
   * `priceById` is optional in the same way and for the same reason: whatever
   * the user typed at the checkout, in minor units, and nothing for the rest.
   * An unpriced item keeps the price it had.
   */
  finishShopping: (shopId?: string | null, priceById?: Readonly<Record<string, number>>) => number;
  /**
   * Records what one item cost, by hand. Writes the item's own price and — with
   * a store named — that store's, so a correction made while looking at a
   * store's price doesn't leave the two disagreeing.
   *
   * `null` clears it: a price you know to be wrong is worse than none, and the
   * pantry pills set the precedent that every automatic assertion here can be
   * taken back by hand.
   */
  setItemPrice: (id: string, minor: number | null, shopId?: string | null) => void;
  /**
   * Forgets what one store charged, and only that — the item's own price and
   * every other store's are left alone.
   *
   * Deliberately not `setItemPrice(id, null, shopId)`, which nulls the item's
   * price on the way past: "I don't know what Costco charges any more" is not
   * "I've never paid anything for this", and the second is what clearing the
   * item-level field means.
   */
  clearItemShopPrice: (itemId: string, shopId: string) => void;
  /** Abandons the trip: everything comes off the list, nothing counts as bought. */
  clearList: () => number;

  /**
   * Commit a drag on the list: each row's new rank in the walk order and the
   * aisle it was dropped into. One action rather than a reorder plus a
   * setAisleMany, because a drop decides both at once (see resolveGroceryDrop)
   * and two writes would leave a frame where the item had moved but not moved
   * aisle.
   */
  applyDrop: (placements: Array<{ id: string; sortOrder: number; aisle: string }>) => void;

  setAisleOrder: (order: string[]) => void;
  /**
   * Creates an aisle at the end of the walk order. Returns the canonical name —
   * the existing one when it's already there, so callers can select it either
   * way — or null when the name is empty.
   */
  addAisle: (name: string) => string | null;
  /**
   * Renames an aisle everywhere it's recorded: the walk order, every row filed
   * there, and every remembered filing that pointed at it. False when the name
   * is blank, taken, or the aisle can't be renamed ('Other').
   */
  renameAisle: (from: string, to: string) => boolean;
  /**
   * Deletes an aisle and files everything that was in it under 'Other'. A
   * no-op for 'Other' itself, which is the floor every unrecognised item lands
   * on and so has to exist.
   */
  deleteAisle: (aisle: string) => void;

  /** Null when the name collides with an existing store. */
  addShop: (name: string) => Shop | null;
  renameShop: (id: string, name: string) => boolean;
  reorderShops: (ids: string[]) => void;
  deleteShop: (id: string) => void;
  /** "It has everything, but don't send me there" — pulls the store out of
   * primaryShopFor/exclusiveShopFor and the grocery-run task's store picker
   * while leaving manual linking and finishShopping untouched. */
  setShopExcludedFromSuggestions: (id: string, excluded: boolean) => void;
  /** Assert "this item is available here" without a purchase behind it. */
  linkItemShop: (itemId: string, shopId: string) => void;
  /**
   * The same assertion over a set — the shopping-trip sheet's "actually, it
   * has more" correction, where the user is answering for a whole list at
   * once. One state update rather than N, and the single-item call routes
   * through it so the promotion rule can't drift between the two.
   */
  linkItemShopMany: (itemIds: string[], shopId: string) => void;
  unlinkItemShop: (itemId: string, shopId: string) => void;
  /**
   * The opposite claim: "this store doesn't have it". Written by the finish-
   * shopping sheet for whatever was left on the list after a trip, and by the
   * item sheet's own store picker.
   *
   * Takes a set for the same reason linkItemShopMany does — the trip answers
   * for a whole list at once — and leaves any purchase history on the row
   * alone: a shop that stocked it and stopped is the case, and clearing the
   * count to say so would destroy the record. See ItemShopLink.unavailableAt.
   */
  markItemsUnavailable: (itemIds: string[], shopId: string) => void;
  /**
   * Takes the claim back. An observed link keeps its purchases and simply stops
   * being marked; a link that was *only* the claim is deleted outright, because
   * clearing the stamp in place would silently turn "they don't have it" into
   * the opposite assertion ("I get it here" — purchaseCount 0, no stamp).
   */
  clearItemUnavailable: (itemId: string, shopId: string) => void;
  setLastShopId: (id: string | null) => void;

  /**
   * Say you're at a store. Explicit only — nothing in the app infers a trip,
   * because a wrong guess marks up the whole list in the one place it has to
   * stay scannable one-handed.
   */
  startTrip: (shopId: string) => void;
  /**
   * End it. Called by the Clear button, by finishing a shop, and by clearing
   * the list — a trip whose list just went away is over whatever else happened.
   * Idempotent, so callers never have to check first.
   */
  endTrip: () => void;
  /**
   * The store you're at, or null. The only sanctioned read of the trip fields:
   * it drops a deleted shop and an aged-out trip, so no caller has to remember
   * to. Takes `now` so the callers that already have one don't disagree with it.
   */
  activeShop: (now?: Date) => Shop | null;
  /** Ends a trip that aged out while the app was open. Called on screen focus. */
  checkTripExpiry: () => void;

  itemByNameKey: (key: string) => GroceryItem | null;
  itemById: (id: string) => GroceryItem | null;
  /** The aisle the user has filed this name under before, if any. */
  rememberedAisleFor: (name: string) => string | null;
}

function nextSortOrder(items: GroceryItem[]): number {
  return items.reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1;
}

/**
 * A brand-new catalog row, with every field nobody passes in already decided.
 *
 * Both insert paths go through it — addByName's list add and addToPantry's
 * off-list one — so there's still exactly one place that knows what a fresh row
 * looks like, and a column added later can't reach only one of them. The two
 * differ in `onList`/`inCatalog`/`onHandUntil`, which is why those are the
 * fields with no default here.
 */
function newItemRow(fields: {
  name: string;
  nameKey: string;
  aisle: string;
  sortOrder: number;
  createdAt: string;
  onList: boolean;
  /** False = provisional, deleted rather than kept when it leaves the list. */
  inCatalog: boolean;
  quantity?: string | null;
  note?: string | null;
  choiceGroup?: string | null;
  source?: { recipeId: string; recipeTitle: string };
  onHandUntil?: string | null;
}): GroceryItem {
  return {
    id: generateId(),
    name: fields.name,
    nameKey: fields.nameKey,
    // Never seeded from a typed line — nothing parses a brand out of text (see
    // GroceryItem.brand). A fresh row has no opinion until the user sets one,
    // and addByName's `existing` branch carries an established brand through on
    // every later re-add because it spreads the row it found.
    brand: null,
    // A preference is not a rule — see GroceryItem.brandStrict. Nothing infers
    // this, including from a brand being set.
    brandStrict: false,
    // Unparsed and uninferred exactly like the brand above, and carried through
    // a re-add by the same spread.
    variant: null,
    aisle: fields.aisle,
    quantity: fields.quantity ?? null,
    note: fields.note ?? '',
    onList: fields.onList,
    checked: false,
    inCatalog: fields.inCatalog,
    sortOrder: fields.sortOrder,
    purchaseCount: 0,
    lastAddedAt: fields.onList ? fields.createdAt : null,
    lastPurchasedAt: null,
    createdAt: fields.createdAt,
    onHandUntil: fields.onHandUntil ?? null,
    // Only a genuinely new row gets attributed — see the field's doc comment on
    // GroceryItem. A row reused via addByName's `existing` branch never reaches
    // here, so a recipe re-adding a known item can't relabel it.
    choiceGroup: fields.choiceGroup ?? null,
    sourceRecipeId: fields.source?.recipeId ?? null,
    sourceRecipeTitle: fields.source?.recipeTitle ?? null,
    isStaple: false,
    // Nothing on the *list* has a use-by date: adding a name is a plan to buy
    // it, and the shelf life doesn't start until it's in the fridge.
    // finishShopping is what stamps this — see defaultExpiresAt.
    expiresAt: null,
    useUpTask: null,
    // Same reasoning as expiresAt: a name typed onto the list is a plan to buy
    // something, and nothing has been paid for it yet. finishShopping and the
    // item sheet are the two things that ever set a price.
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
  };
}

/** One reviewed line on its way to the list. `aisle` null means "no opinion". */
export interface PlannedRow {
  name: string;
  quantity: string | null;
  aisle: string | null;
  /**
   * The recipe this row came from, when unambiguous — null for a week-view
   * row that merged ingredients from more than one recipe, since there's no
   * single recipe left to credit. Only applied to a row addFromPlan actually
   * creates; see GroceryItem.sourceRecipeId.
   */
  sourceRecipeId?: string | null;
  sourceRecipeTitle?: string | null;
}

export interface PlanAddResult {
  /** Rows that weren't on the list and now are — new catalog rows and re-listed ones alike. */
  added: GroceryItem[];
  /** Already on the list and left exactly as they were. */
  alreadyOnList: GroceryItem[];
  /**
   * Already in the trolley, and deliberately untouched. THIS IS THE WHOLE
   * REASON THIS FUNCTION EXISTS rather than a loop over addByName at the call
   * site: addByName sets `checked: false` on a row it finds, so adding a
   * recipe while standing in the shop would quietly pull things back *out* of
   * the trolley, one row at a time, with nothing on screen to say so. Checked
   * rows are reported and skipped.
   */
  skippedInCart: GroceryItem[];
}

/**
 * Saves a walk order and the tombstones that go with it.
 *
 * The hidden set is *derived from the order being saved* — whatever the caller
 * left out is a deletion — so there's no second thing to keep in step, and
 * re-adding a deleted built-in by name simply un-hides it.
 */
function commitAisleOrder(order: string[], used: readonly string[]) {
  const hidden = hiddenDefaultAisles(order);
  const normalized = normalizeAisleOrder(order, used, hidden);
  dbSetGroceryAisleOrder(normalized);
  dbSetGroceryHiddenAisles(hidden);
  return { aisleOrder: normalized, hiddenAisles: hidden };
}

// ─── Use-up tasks (#1106) ───────────────────────────────────────────────────
//
// The grocery item is the master and the task is the replica; these two
// helpers are every write that crosses the line. The projection rules — which
// items qualify, what the task says, which fields the item owns — are in
// utils/groceryExpiry so jest can reach them.
//
// **Reconciling runs on the transitions that change the expiry**, not on every
// grocery mutation the way a meal's cook task does. A meal moves nights, gets
// re-titled and re-scaled; a use-by date is stamped at the till and then left
// alone, so renaming an item or refiling its aisle has nothing to say to a
// task the user may since have dated, filed and annotated.

/**
 * Brings this item's use-up task into line: creates it, updates it, or removes
 * it, depending on what the item now says. The create/update/delete machinery
 * is shared with the other three generators (store/generatedTaskSync, #1524);
 * what's decided here is only what a grocery item wants.
 *
 * **Only a *live* task blocks a new one, and this is where the analogy with
 * cook tasks stops** — hence no `blocksOnFinished`. A meal is one event, so
 * reconcileCookTask deliberately refuses to spawn a second task for it even
 * when the first is completed. A grocery item is a forever-row that gets bought
 * again and again: last month's ticked-off "Use up spinach" is history, and the
 * bag bought this afternoon needs its own. Reading the wider set here would
 * mean a staple got exactly one use-up task, ever.
 */
function reconcileUseUpTask(item: GroceryItem): void {
  const { groceryUseUpTasks, groceryUseUpLeadDays, groceryUseUpTaskCategory } =
    useSettingsStore.getState();
  reconcileGeneratedTask({
    kind: 'groceryUseUp',
    sourceId: item.id,
    // The date is re-checked outside wantsUseUpTask on purpose: an explicit
    // `useUpTask: true` on an item with no date would otherwise reach
    // useUpTaskFields, which dereferences `expiresAt!`.
    wanted: item.expiresAt !== null && wantsUseUpTask(item, groceryUseUpTasks),
    drift: existing => (
      useUpTaskNeedsUpdate(existing, item, groceryUseUpLeadDays)
        ? useUpTaskFields(item, groceryUseUpLeadDays)
        : null
    ),
    draft: () => useUpTaskDraft(item, groceryUseUpLeadDays, groceryUseUpTaskCategory),
  });
}

/**
 * Drops this item's use-up task because the item itself is going.
 *
 * Deliberately not `reconcileUseUpTask` on a cleared date: that path is a
 * correction to a row that still exists, while this one is a row that won't.
 * Completed tasks stay either way — forgetting an item must not erase the
 * Logbook, the same rule deleteGroup keeps for a stack's history.
 */
function dropUseUpTask(itemId: string): void {
  dropGeneratedTask('groceryUseUp', itemId);
}

export const useGroceryStore = create<GroceryStore>((set, get) => ({
  items: [],
  aisleOrder: [],
  hiddenAisles: [],
  shops: [],
  itemShops: [],
  lastShopId: null,
  tripShopId: null,
  tripStartedAt: null,
  aisleOverrides: {},
  cartHoldIds: [],
  initialized: false,
  lastAction: null,

  setLastAction(action) {
    set({ lastAction: action ? { ...action, at: Date.now() } : null });
  },

  undoLastAction() {
    const action = get().lastAction;
    if (!action) return;
    try {
      action.undo();
    } catch (e) {
      console.error('undoLastAction failed', e);
    }
    set({ lastAction: null });
  },

  initialize() {
    const items = dbGetAllGroceryItems();
    // Repaired at read time and deliberately NOT written back: shipping a
    // bigger DEFAULT_AISLES later then needs no migration, and can't clobber
    // an order someone arranged to match their store.
    const hiddenAisles = dbGetGroceryHiddenAisles();
    const aisleOrder = normalizeAisleOrder(
      dbGetGroceryAisleOrder(),
      items.map(i => i.aisle),
      hiddenAisles
    );
    const shops = dbGetAllGroceryShops();
    const itemShops = dbGetAllItemShopLinks();
    // Resolved against live shops rather than trusted: the setting outlives
    // the store it names, and a preselected shop that no longer exists would
    // record the next trip against nothing.
    const storedLast = dbGetLastShopId();
    const lastShopId = shops.some(s => s.id === storedLast) ? storedLast : null;
    // The trip is repaired the same way, against the clock as well as against
    // live shops, and — like the aisle order above — deliberately not written
    // back. A launch the morning after a shop simply has no trip: the rows are
    // still in the settings table and resolve to nothing for ever after, which
    // costs two dead keys and saves a write on every cold start.
    const storedTrip = resolveActiveTrip(
      dbGetTripShopId(),
      dbGetTripStartedAt(),
      shops,
      new Date()
    );
    const tripShopId = storedTrip?.id ?? null;
    const tripStartedAt = tripShopId ? dbGetTripStartedAt() : null;
    if (cartHoldTimer) {
      clearTimeout(cartHoldTimer);
      cartHoldTimer = null;
    }
    set({
      items,
      aisleOrder,
      hiddenAisles,
      aisleOverrides: dbGetGroceryAisleOverrides(),
      shops,
      itemShops,
      lastShopId,
      tripShopId,
      tripStartedAt,
      cartHoldIds: [],
      initialized: true,
    });
  },

  /**
   * The whole product insight, in one function. A name we already know is put
   * back on the list; only a genuinely new one inserts a row. That's why
   * there's never a duplicate, why autocomplete has history to rank, and why
   * next week's list starts from what you actually buy.
   *
   * Registers shake-to-undo by default (`opts.registerUndo`, default true) —
   * "removeFromList" is the correct undo either way it branches below: it
   * deletes a brand-new provisional row outright, or just un-lists a catalog
   * row that was already there, restoring exactly the `onList: false` state
   * this call found it in. Batch callers (addManyFromText, addFromPlan) pass
   * `registerUndo: false` and register one combined action of their own
   * instead, so a ten-line paste doesn't leave only the last line undoable.
   */
  addByName(raw, override, source, opts) {
    const { name, quantity } = override ?? parseGroceryInput(raw);
    const note = override?.note?.trim() || null;
    const choiceGroup = override?.choiceGroup?.trim() || null;
    // A name with no letters or digits ("???") normalises to an empty key.
    // Falling back to the raw text keeps the key unique, which matters: two
    // such rows would collide on the UNIQUE index and the *second* insert
    // would throw out of whatever was calling — a paste, or the Reminders
    // drain mid-batch.
    const key = groceryNameKey(name) || name.trim().toLowerCase();
    const now = new Date().toISOString();
    const existing = key ? get().items.find(i => i.nameKey === key) : undefined;
    const wasOnList = existing?.onList === true;

    if (existing) {
      const updated: GroceryItem = {
        ...existing,
        // The typed name wins — capitalisation and wording are the user's.
        name: name || existing.name,
        onList: true,
        checked: false,
        // Only overwrite the quantity when this add actually carried one;
        // typing "milk" to re-add shouldn't wipe the "2 gal" set last week.
        quantity: quantity ?? existing.quantity,
        // Same rule the quantity above follows, and for the same reason:
        // re-adding a known item without saying why must not wipe the note
        // that's been on it since last time.
        note: note ?? existing.note,
        // Same rule again: adding "apples or pears" when apples is already on
        // the list makes that row one option of the new pair, but a plain
        // re-add of apples must not dissolve a pair it's already in.
        choiceGroup: choiceGroup ?? existing.choiceGroup,
        lastAddedAt: now,
      };
      dbUpdateGroceryItem(updated);
      set(s => ({
        items: s.items.map(i => (i.id === existing.id ? updated : i)),
        cartHoldIds: s.cartHoldIds.filter(x => x !== existing.id),
      }));
      if (opts?.registerUndo !== false && !wasOnList) {
        get().setLastAction({
          label: `Added "${updated.name}"`,
          undo: () => get().removeFromList(updated.id),
        });
      }
      return updated;
    }

    const item = newItemRow({
      name,
      nameKey: key,
      // Where the user put it last time beats where the lexicon thinks it
      // goes — the lexicon is a guess about groceries, this is a fact about
      // their shop. (An item still in the catalog never reaches here: it
      // carries its own aisle, and the branch above keeps it.)
      //
      // placeAisle has the last word because neither source knows which aisles
      // still exist: naming a deleted one here would bring its section back.
      aisle: placeAisle(get().aisleOverrides[key] ?? aisleForName(name), get().aisleOrder),
      quantity,
      note,
      onList: true,
      // Provisional: a name nobody has bought or finished a trip with is on
      // the list, not in the catalog. removeFromList deletes it.
      inCatalog: false,
      sortOrder: nextSortOrder(get().items),
      createdAt: now,
      choiceGroup,
      source,
    });
    dbInsertGroceryItem(item);
    set(s => ({ items: [...s.items, item] }));
    if (opts?.registerUndo !== false) {
      get().setLastAction({
        label: `Added "${item.name}"`,
        undo: () => get().removeFromList(item.id),
      });
    }
    return item;
  },

  addManyFromText(raw) {
    const lines = splitGroceryLines(raw);
    const added: GroceryItem[] = [];
    const alreadyOnList: GroceryItem[] = [];
    for (const line of lines) {
      const key = groceryNameKey(parseGroceryInput(line).name);
      const before = key ? get().items.find(i => i.nameKey === key) : undefined;
      const wasOnList = before?.onList === true;
      const item = get().addByName(line, undefined, undefined, { registerUndo: false });
      if (wasOnList) alreadyOnList.push(item);
      else added.push(item);
    }
    // One combined undo for the whole paste rather than addByName's per-line
    // one, which the loop above suppresses — otherwise only the last line of
    // a ten-item paste would be undoable.
    if (added.length > 0) {
      const addedIds = added.map(i => i.id);
      get().setLastAction({
        label: `${added.length} item${added.length === 1 ? '' : 's'} added`,
        undo: () => get().removeFromListMany(addedIds),
      });
    }
    return { added, alreadyOnList };
  },

  addExisting(id) {
    get().addExistingMany([id]);
  },

  addExistingMany(ids) {
    const wanted = new Set(ids);
    const now = new Date().toISOString();
    const updates: GroceryItem[] = [];
    let order = nextSortOrder(get().items);

    for (const item of get().items) {
      if (!wanted.has(item.id) || item.onList) continue;
      updates.push({ ...item, onList: true, checked: false, lastAddedAt: now, sortOrder: order++ });
    }
    if (updates.length === 0) return;

    for (const u of updates) dbUpdateGroceryItem(u);
    const byId = new Map(updates.map(u => [u.id, u]));
    set(s => ({ items: s.items.map(i => byId.get(i.id) ?? i) }));

    const addedIds = updates.map(u => u.id);
    get().setLastAction({
      label: `${addedIds.length} item${addedIds.length === 1 ? '' : 's'} added`,
      undo: () => get().removeFromListMany(addedIds),
    });
  },

  /**
   * The recipe → list path, and the one place a plan is allowed to write to the
   * catalog. It lives here rather than in the recipe store for the same reason
   * finishShopping does: this store owns the inCatalog promotion rule,
   * nextSortOrder, placeAisle and the aisle-order normalisation, and a caller
   * reaching around them would get all four subtly wrong.
   *
   * Three differences from a loop over addByName, each load-bearing:
   *   1. a row already in the trolley is skipped, not un-checked (see
   *      PlanAddResult.skippedInCart);
   *   2. a quantity the user set by hand is never overwritten — only a row this
   *      call actually adds takes the plan's quantity;
   *   3. an aisle the user has filed by hand always wins over the plan's guess,
   *      the same precedence addByName gives aisleOverrides over the lexicon.
   */
  addFromPlan(rows) {
    const added: GroceryItem[] = [];
    const alreadyOnList: GroceryItem[] = [];
    const skippedInCart: GroceryItem[] = [];

    // One transaction rather than N: a ten-ingredient recipe is ten inserts and
    // as many updates, and a half-applied recipe is a worse outcome than a
    // failed one. Same shape as applyTemplate's single dbTransaction.
    dbTransaction(() => {
      for (const row of rows) {
        const key = groceryNameKey(row.name);
        const existing = key ? get().items.find(i => i.nameKey === key) : undefined;

        if (existing?.checked) { skippedInCart.push(existing); continue; }
        if (existing?.onList) { alreadyOnList.push(existing); continue; }

        // Passing the bare name, not "2 lb chicken thighs": the quantity is
        // already split out on the ingredient, and re-parsing it here would
        // run the guesswork twice.
        const item = get().addByName(
          row.name,
          undefined,
          row.sourceRecipeId ? { recipeId: row.sourceRecipeId, recipeTitle: row.sourceRecipeTitle ?? '' } : undefined,
          { registerUndo: false }
        );
        if (row.aisle && !get().rememberedAisleFor(row.name)) get().setAisle(item.id, row.aisle);
        if (row.quantity) get().setQuantity(item.id, row.quantity);
        added.push(get().itemById(item.id) ?? item);
      }
    });

    // One combined undo for the whole recipe, same reasoning as
    // addManyFromText — removeFromList is still the right revert per row: it
    // deletes a brand-new provisional row and un-lists a re-listed catalog one.
    if (added.length > 0) {
      const addedIds = added.map(i => i.id);
      get().setLastAction({
        label: `${added.length} item${added.length === 1 ? '' : 's'} added`,
        undo: () => get().removeFromListMany(addedIds),
      });
    }

    return { added, alreadyOnList, skippedInCart };
  },

  toggleChecked(id) {
    const item = get().items.find(i => i.id === id);
    // The checked ⇒ onList invariant: an off-list row has nothing to check.
    if (!item || !item.onList) return;

    const updated = { ...item, checked: !item.checked };
    dbUpdateGroceryItem(updated);
    set(s => ({
      items: s.items.map(i => (i.id === id ? updated : i)),
      cartHoldIds: updated.checked
        ? [...s.cartHoldIds.filter(x => x !== id), id]
        // Un-checking inside the hold window just drops it — the row was
        // never going to sink, so nothing has to animate back.
        : s.cartHoldIds.filter(x => x !== id),
    }));
    if (updated.checked) armCartHold();
    // Ticking one option of an either/or is how the choice gets made — see
    // resolveChoice. Deliberately not mirrored in setCheckedMany: a bulk tick
    // is a sweep over rows the user selected by hand, and silently deleting
    // rows they didn't select out from under it is not what that gesture says.
    if (updated.checked && updated.choiceGroup) get().resolveChoice(id);
  },

  setCheckedMany(ids, checked) {
    if (ids.length === 0) return;
    const wanted = new Set(ids);
    const updates: GroceryItem[] = [];
    for (const item of get().items) {
      // Same invariant as toggleChecked: an off-list row has nothing to check.
      if (!wanted.has(item.id) || !item.onList || item.checked === checked) continue;
      updates.push({ ...item, checked });
    }
    if (updates.length === 0) return;

    for (const u of updates) dbUpdateGroceryItem(u);
    const byId = new Map(updates.map(u => [u.id, u]));
    set(s => ({
      items: s.items.map(i => byId.get(i.id) ?? i),
      cartHoldIds: checked
        ? [...s.cartHoldIds.filter(x => !byId.has(x)), ...updates.map(u => u.id)]
        // Un-checking inside the hold window just drops it, same as toggleChecked.
        : s.cartHoldIds.filter(x => !byId.has(x)),
    }));
    if (checked) armCartHold();
  },

  setQuantity(id, quantity) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    const trimmed = quantity?.trim() ?? '';
    const updated = { ...item, quantity: trimmed || null };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  setAisle(id, aisle) {
    get().setAisleMany({ [id]: aisle });
  },

  setAisleMany(assignments) {
    const updates: GroceryItem[] = [];
    for (const item of get().items) {
      const aisle = assignments[item.id];
      if (!aisle || aisle === item.aisle) continue;
      updates.push({ ...item, aisle });
    }
    if (updates.length === 0) return;

    for (const u of updates) dbUpdateGroceryItem(u);
    // Every call here is a deliberate filing — the item sheet's picker, or a
    // reviewed-and-accepted AI tidy — so it's what gets remembered for the
    // next time this name is typed.
    const remembered = rememberAisles(get().aisleOverrides, updates);
    if (remembered) dbSetGroceryAisleOverrides(remembered);

    const byId = new Map(updates.map(u => [u.id, u]));
    set(s => ({
      items: s.items.map(i => byId.get(i.id) ?? i),
      // A brand-new aisle (a custom one, or an AI suggestion) has to enter the
      // walk order or its section would render at the bottom, unordered.
      aisleOrder: normalizeAisleOrder(s.aisleOrder, updates.map(u => u.aisle), s.hiddenAisles),
      aisleOverrides: remembered ?? s.aisleOverrides,
    }));
  },

  /**
   * Returns false on a key collision rather than merging. Merging two catalog
   * rows means choosing whose purchaseCount survives, and there's no right
   * answer — better to tell the caller the name is taken.
   */
  renameItem(id, name) {
    const item = get().items.find(i => i.id === id);
    if (!item) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;

    const key = groceryNameKey(trimmed);
    if (!key) return false;
    if (key !== item.nameKey && get().items.some(i => i.nameKey === key)) return false;

    const updated = { ...item, name: trimmed, nameKey: key };
    dbUpdateGroceryItem(updated);
    // The remembered aisle is keyed by name, so it has to follow the rename or
    // it stays stranded under the old spelling — which is usually a typo the
    // rename exists to fix.
    const remembered = renameRememberedAisle(get().aisleOverrides, item.nameKey, key);
    if (remembered) dbSetGroceryAisleOverrides(remembered);
    // Recipe ingredients are bridged to the catalog by name_key too, so they
    // strand on a rename exactly as the remembered aisle above does — and
    // silently, since a stranded ingredient still renders fine and only stops
    // matching. Reached through the store rather than the rows because the key
    // lives inside a JSON blob; remapIngredientKey is a no-op when nothing
    // referenced the old spelling.
    useRecipeStore.getState().remapIngredientKey(item.nameKey, key);
    set(s => ({
      items: s.items.map(i => (i.id === id ? updated : i)),
      aisleOverrides: remembered ?? s.aisleOverrides,
    }));
    return true;
  },

  setNote(id, note) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    const updated = { ...item, note: note.trim() };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  setBrand(id, brand) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    // Trimmed to null rather than '', unlike note above: note is a string
    // whose empty value is "nothing written", while brand is nullable and
    // every reader tests it for null. Storing '' would render an empty
    // caption line and read as a brand nobody can see.
    const next = brand.trim() || null;
    // Promotes a provisional row, the same way linkItemShop and addToPantry do
    // and for the same reason: which one you want is a standing fact about the
    // item, not about this week's list. Without it the next "Remove from list"
    // deletes the row outright and silently takes the preference with it —
    // which is precisely the retyping this field exists to stop.
    //
    // Only on setting one. Clearing a brand is not a reason to promote a row
    // that was never in the catalog, and demoting one that already is would
    // throw away purchase history over an edit to a caption.
    const updated = {
      ...item,
      brand: next,
      inCatalog: next !== null ? true : item.inCatalog,
    };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  setVariant(id, variant) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    // Trimmed to null and promoting on the way up, both for the reasons spelled
    // out in setBrand above: null is what every reader tests for, and which one
    // of a brand you want is a standing fact about the item that has to outlive
    // this week's list. Clearing promotes nothing, again like setBrand.
    const next = variant.trim() || null;
    const updated = {
      ...item,
      variant: next,
      inCatalog: next !== null ? true : item.inCatalog,
    };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  setBrandStrict(id, strict) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    // Promoted like setBrand, and only when switching on: the rule is a
    // standing fact about the item, so it has to outlive this week's list.
    const updated = {
      ...item,
      brandStrict: strict,
      inCatalog: strict ? true : item.inCatalog,
    };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  setOnHandUntil(id, until) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    const updated = { ...item, onHandUntil: until };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  markOutOfMany(ids) {
    if (ids.length === 0) return 0;
    const wanted = new Set(ids);
    // Snapshotted before the write, and restored verbatim rather than to null:
    // a row that carried an active "Got it" had an assertion before this, and
    // undo owes it that back rather than the cadence guess.
    const before = get().items.filter(
      i => wanted.has(i.id) && i.onHandUntil !== OUT_OF_IT_UNTIL
    );
    if (before.length === 0) return 0;

    const updates = before.map((i): GroceryItem => ({ ...i, onHandUntil: OUT_OF_IT_UNTIL }));
    for (const u of updates) dbUpdateGroceryItem(u);
    const byId = new Map(updates.map(u => [u.id, u]));
    set(s => ({ items: s.items.map(i => byId.get(i.id) ?? i) }));

    get().setLastAction({
      label: `Marked ${updates.length} ${updates.length === 1 ? 'thing' : 'things'} out`,
      undo: () => {
        for (const b of before) dbUpdateGroceryItem(b);
        const originalById = new Map(before.map(b => [b.id, b]));
        set(s => ({ items: s.items.map(i => originalById.get(i.id) ?? i) }));
      },
    });
    return updates.length;
  },

  addToPantry(raw) {
    // Parsed like a list line so "2 lb flour" files under flour rather than
    // minting a row whose name no purchase can ever match. The quantity it
    // strips off is deliberately dropped: how much you have is the inventory
    // this feature exists not to be, and the row's quantity is the amount to
    // buy next time.
    const { name } = parseGroceryInput(raw);
    const trimmed = name.trim();
    if (!trimmed) return null;
    // Same fallback addByName makes for a name that normalises away ("???"):
    // the key has to stay unique or the second such row collides on the index.
    const key = groceryNameKey(trimmed) || trimmed.toLowerCase();
    const now = new Date();
    const nowIso = now.toISOString();
    const existing = get().items.find(i => i.nameKey === key);

    if (existing) {
      const updated: GroceryItem = {
        ...existing,
        // The typed name wins, as it does in addByName.
        name: trimmed,
        // Promoted for the reason linkItemShop promotes: saying you have
        // something is a statement about the item, not about this week's list,
        // so a provisional row must not take the assertion with it the next
        // time it comes off the list.
        inCatalog: true,
        onHandUntil: defaultOnHandUntil(existing, now),
      };
      dbUpdateGroceryItem(updated);
      set(s => ({ items: s.items.map(i => (i.id === existing.id ? updated : i)) }));
      get().setLastAction({
        label: `Added "${updated.name}" to the pantry`,
        undo: () => {
          dbUpdateGroceryItem(existing);
          set(s => ({ items: s.items.map(i => (i.id === existing.id ? existing : i)) }));
        },
      });
      return updated;
    }

    const row = newItemRow({
      name: trimmed,
      nameKey: key,
      aisle: placeAisle(get().aisleOverrides[key] ?? aisleForName(trimmed), get().aisleOrder),
      // Off the list and in the catalog from the first moment, which is the
      // one row shape addByName never produces: nothing is provisional about a
      // name the user typed to say they own it, and there's no stint on the
      // list for a later removal to end.
      onList: false,
      inCatalog: true,
      sortOrder: nextSortOrder(get().items),
      createdAt: nowIso,
    });
    // Stamped off the finished row rather than a literal fortnight, so this
    // and "Got it" can't drift — with no purchases yet it lands on the same
    // default, and it'll follow the item's own cadence once there are some.
    const item: GroceryItem = { ...row, onHandUntil: defaultOnHandUntil(row, now) };
    dbInsertGroceryItem(item);
    set(s => ({ items: [...s.items, item] }));
    get().setLastAction({
      label: `Added "${item.name}" to the pantry`,
      undo: () => get().deleteItem(item.id),
    });
    return item;
  },

  setItemPrice(id, minor, shopId = null) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    const now = minor === null ? null : new Date().toISOString();
    // The quantity it's a price *for* is this row's current one — the same
    // pairing a finished trip records. Cleared with the price, so a stale
    // quantity can never be left describing a number that's gone.
    const updated: GroceryItem = {
      ...item,
      lastPriceMinor: minor,
      lastPricedAt: now,
      lastPriceQuantity: minor === null ? null : item.quantity,
    };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));

    // With a store in hand, the same answer goes on the link — a price
    // corrected while looking at one store's number has to change that number,
    // or the correction reads as having done nothing. Only an existing link is
    // touched: a price is not an assertion that the store stocks it, so this
    // must not mint the row linkItemShop exists to mint.
    if (!shopId) return;
    const link = get().itemShops.find(l => l.itemId === id && l.shopId === shopId);
    if (!link) return;
    const nextLink: ItemShopLink = {
      ...link,
      lastPriceMinor: minor,
      lastPricedAt: now,
      lastPriceQuantity: minor === null ? null : item.quantity,
    };
    dbSetItemShopLink(nextLink);
    set(s => ({
      itemShops: s.itemShops.map(l =>
        l.itemId === id && l.shopId === shopId ? nextLink : l
      ),
    }));
  },

  clearItemShopPrice(itemId, shopId) {
    const link = get().itemShops.find(l => l.itemId === itemId && l.shopId === shopId);
    if (!link || link.lastPriceMinor === null) return;
    // The stamp and the quantity go with the number, never outliving it — the
    // same pairing setItemPrice keeps, and for the same reason: a date and a
    // "for 2 lb" describing a price that isn't there is furniture at best.
    const next: ItemShopLink = {
      ...link,
      lastPriceMinor: null,
      lastPricedAt: null,
      lastPriceQuantity: null,
    };
    dbSetItemShopLink(next);
    set(s => ({
      itemShops: s.itemShops.map(l =>
        l.itemId === itemId && l.shopId === shopId ? next : l
      ),
    }));
  },

  setStaple(id, isStaple) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    const updated = { ...item, isStaple };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  setExpiresAt(id, expiresAt) {
    const item = get().items.find(i => i.id === id);
    if (!item || item.expiresAt === expiresAt) return;
    const updated = { ...item, expiresAt };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
    reconcileUseUpTask(updated);
  },

  setUseUpTask(id, value, options) {
    const item = get().items.find(i => i.id === id);
    if (!item || item.useUpTask === value) return;
    const updated = { ...item, useUpTask: value };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
    if (options?.reconcile !== false) reconcileUseUpTask(updated);
  },

  /**
   * Takes a row off the list. A catalog row stays behind — "not this week" —
   * but a provisional one goes altogether, because it only ever existed as this
   * line of the list.
   *
   * The delete is deliberately not behind the confirm every other delete has.
   * That confirm protects history, and a provisional row has none by
   * definition: never bought, no purchase count to lose. The sheet says which
   * of the two will happen before you tap.
   */
  resolveChoice(id) {
    const item = get().items.find(i => i.id === id);
    if (!item?.choiceGroup) return;
    const group = item.choiceGroup;
    // Only what's still on the list is a live option. An off-list catalog row
    // that once shared the group is history, not a thing to take away.
    const losers = get().items.filter(i => i.id !== id && i.choiceGroup === group && i.onList);
    if (losers.length === 0) {
      get().clearChoice(id);
      return;
    }

    const winner = { ...item, choiceGroup: null };
    // Snapshots taken before anything is written, so undo restores the rows
    // themselves rather than reconstructing what they probably were. The
    // winner goes back *unticked*: the tick is what made the choice (this only
    // ever runs from toggleChecked), so undoing the choice has to undo the tick
    // too, or the group comes back with one option already in the trolley.
    const before = [{ ...item, checked: false }, ...losers];
    // Same split removeFromList makes: a provisional row has nothing to keep.
    const toDelete = losers.filter(i => !i.inCatalog).map(i => i.id);
    const toUnlist = losers
      .filter(i => i.inCatalog)
      .map(i => ({ ...i, onList: false, checked: false, choiceGroup: null }));

    dbUpdateGroceryItem(winner);
    for (const u of toUnlist) dbUpdateGroceryItem(u);
    const patched = new Map<string, GroceryItem>([[winner.id, winner], ...toUnlist.map(
      u => [u.id, u] as [string, GroceryItem]
    )]);
    set(s => ({ items: s.items.map(i => patched.get(i.id) ?? i) }));
    if (toDelete.length > 0) get().deleteItems(toDelete);

    get().setLastAction({
      label: `Chose ${item.name}`,
      undo: () => {
        const live = new Set(get().items.map(i => i.id));
        const restored = before.filter(i => !live.has(i.id));
        for (const row of restored) dbInsertGroceryItem(row);
        for (const row of before.filter(i => live.has(i.id))) dbUpdateGroceryItem(row);
        const byId = new Map(before.map(i => [i.id, i]));
        set(s => ({
          items: [...s.items.map(i => byId.get(i.id) ?? i), ...restored],
          cartHoldIds: s.cartHoldIds.filter(x => x !== id),
        }));
      },
    });
  },

  clearChoice(id) {
    const item = get().items.find(i => i.id === id);
    if (!item?.choiceGroup) return;
    const group = item.choiceGroup;
    const updates = get().items
      .filter(i => i.choiceGroup === group)
      .map(i => ({ ...i, choiceGroup: null }));
    for (const u of updates) dbUpdateGroceryItem(u);
    const byId = new Map(updates.map(u => [u.id, u]));
    set(s => ({ items: s.items.map(i => byId.get(i.id) ?? i) }));
  },

  removeFromList(id) {
    const item = get().items.find(i => i.id === id);
    if (!item || !item.onList) return;
    if (!item.inCatalog) {
      get().deleteItem(id);
      return;
    }
    const updated = { ...item, onList: false, checked: false };
    dbUpdateGroceryItem(updated);
    set(s => ({
      items: s.items.map(i => (i.id === id ? updated : i)),
      cartHoldIds: s.cartHoldIds.filter(x => x !== id),
    }));
  },

  removeFromListMany(ids) {
    if (ids.length === 0) return;
    const wanted = new Set(ids);
    const toDelete: string[] = [];
    const toUpdate: GroceryItem[] = [];
    for (const item of get().items) {
      if (!wanted.has(item.id) || !item.onList) continue;
      // Same split as removeFromList: a provisional row has nothing to keep.
      if (!item.inCatalog) {
        toDelete.push(item.id);
        continue;
      }
      toUpdate.push({ ...item, onList: false, checked: false });
    }
    if (toDelete.length > 0) get().deleteItems(toDelete);
    if (toUpdate.length === 0) return;

    for (const u of toUpdate) dbUpdateGroceryItem(u);
    const byId = new Map(toUpdate.map(u => [u.id, u]));
    set(s => ({
      items: s.items.map(i => byId.get(i.id) ?? i),
      cartHoldIds: s.cartHoldIds.filter(x => !byId.has(x)),
    }));
  },

  /**
   * The one real delete. There is no undo, so every caller confirms first —
   * except removeFromList on a provisional row, which has nothing to lose and
   * says so on the button.
   */
  deleteItem(id) {
    get().deleteItems([id]);
  },

  deleteItems(ids) {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    // dbDeleteGroceryItem drops the item's shop links too; mirror that here so
    // the in-memory copy doesn't keep links to an item that's gone.
    for (const id of ids) dbDeleteGroceryItem(id);
    set(s => ({
      items: s.items.filter(i => !gone.has(i.id)),
      itemShops: s.itemShops.filter(l => !gone.has(l.itemId)),
      cartHoldIds: s.cartHoldIds.filter(x => !gone.has(x)),
    }));
    // Not part of the SQL cascade: the task is in another table that knows
    // nothing about groceries, and a live "Use up spinach" pointing at a row
    // the user has just forgotten is a chore about nothing.
    //
    // **After the rows are gone, not before.** deleteTask records an opt-out
    // on the task's item (see GroceryItem.useUpTask), which here would be an
    // answer written on a row that no longer exists; with the item already out
    // of state that write finds nothing and does nothing.
    for (const id of ids) dropUseUpTask(id);
  },

  finishShopping(shopId = null, priceById = {}) {
    const purchasedAt = new Date().toISOString();
    const now = new Date(purchasedAt);
    // A shop deleted between opening the finish sheet and confirming it would
    // otherwise write links nothing can resolve.
    const shop = shopId ? get().shops.find(s => s.id === shopId) ?? null : null;
    // Computed from each item's *pre*-purchase history — its own cadence if
    // it has one yet, defaultOnHandUntil's flat guess if not — so a trip
    // asserts "you'll probably have this for about as long as you usually
    // do" rather than a single flat window for everything bought today.
    const onHandUntilById = Object.fromEntries(
      get().items
        .filter(i => i.checked && i.onList)
        .map(i => [i.id, defaultOnHandUntil(i, now)])
    );
    // The use-by day for everything in the trolley the shelf-life lexicon
    // recognises — which is a minority of any real list, and meant to be (see
    // groceryShelfLife.ts). Every purchase re-stamps rather than keeping
    // whatever was there: a second bag of spinach is fresh spinach, and
    // inheriting the old bag's day would have the app nagging about food
    // bought this afternoon.
    const expiresAtById: Record<string, string> = {};
    for (const i of get().items) {
      if (!i.checked || !i.onList) continue;
      const expires = defaultExpiresAt(i.name, now);
      if (expires) expiresAtById[i.id] = expires;
    }
    // The quantity each price was for, captured before the trip clears the
    // trolley — a price with no quantity beside it is the ambiguity
    // GroceryItem.lastPriceQuantity exists to close. Read from state rather
    // than handed back by the db so the in-memory patch below and the row it
    // mirrors can't disagree.
    const pricedQuantityById = new Map(
      get().items.filter(i => priceById[i.id] !== undefined).map(i => [i.id, i.quantity])
    );
    const ids = dbFinishGroceryShopping(
      purchasedAt,
      onHandUntilById,
      shop?.id ?? null,
      expiresAtById,
      priceById
    );
    if (ids.length === 0) return 0;
    const done = new Set(ids);

    set(s => {
      // Patch the links the db just upserted rather than re-reading them —
      // same discipline the items array follows two lines down.
      let itemShops = s.itemShops;
      if (shop) {
        const bumped = new Set(
          s.itemShops.filter(l => l.shopId === shop.id && done.has(l.itemId)).map(l => l.itemId)
        );
        // The price fields this trip writes on a link, or the ones already
        // there — an unpriced item leaves the store's last price standing,
        // same as dbFinishGroceryShopping does.
        const pricePatch = (id: string, existing: ItemShopLink | null) => {
          const minor = priceById[id];
          if (minor === undefined) {
            return {
              lastPriceMinor: existing?.lastPriceMinor ?? null,
              lastPricedAt: existing?.lastPricedAt ?? null,
              lastPriceQuantity: existing?.lastPriceQuantity ?? null,
            };
          }
          return {
            lastPriceMinor: minor,
            lastPricedAt: purchasedAt,
            lastPriceQuantity: pricedQuantityById.get(id) ?? null,
          };
        };
        // What this trip is entitled to record about which one they stock.
        // **Only for a strict item**, and that restriction is the whole
        // argument: strict means the user would not have bought a substitute,
        // so a purchase here really is evidence this store had their brand. On
        // an item with no rule, the same purchase says nothing about which one
        // came home, and stamping it would manufacture the per-store evidence
        // this feature is supposed to be waiting for. Mirrors
        // dbFinishGroceryShopping.
        const brandPatch = (id: string, existing: ItemShopLink | null) => {
          const item = s.items.find(i => i.id === id);
          if (item?.brandStrict && item.brand) return { brand: item.brand };
          return { brand: existing?.brand ?? null };
        };
        itemShops = [
          ...s.itemShops.map(l =>
            l.shopId === shop.id && done.has(l.itemId)
              ? {
                  ...l,
                  purchaseCount: l.purchaseCount + 1,
                  lastPurchasedAt: purchasedAt,
                  // Mirrors dbFinishGroceryShopping: buying it here refutes any
                  // "they don't have it" outright, so the trip clears it rather
                  // than leaving the user to.
                  unavailableAt: null,
                  // Buying your brand here refutes "they haven't got it"
                  // outright, exactly as the purchase refutes the item-level
                  // negative above. Mirrors dbFinishGroceryShopping.
                  brandUnavailableAt: null,
                  ...pricePatch(l.itemId, l),
                  ...brandPatch(l.itemId, l),
                }
              : l
          ),
          ...ids
            .filter(id => !bumped.has(id))
            .map(id => ({
              itemId: id,
              shopId: shop.id,
              purchaseCount: 1,
              lastPurchasedAt: purchasedAt,
              unavailableAt: null,
              brandUnavailableAt: null,
              ...pricePatch(id, null),
              ...brandPatch(id, null),
            })),
        ];
      }

      return {
        items: s.items.map(i =>
          done.has(i.id)
            ? {
                ...i,
                onList: false,
                checked: false,
                // Bought it, so it's yours now — whatever it was before the trip.
                inCatalog: true,
                purchaseCount: i.purchaseCount + 1,
                lastPurchasedAt: purchasedAt,
                onHandUntil: onHandUntilById[i.id] ?? i.onHandUntil,
                expiresAt: expiresAtById[i.id] ?? i.expiresAt,
                // Only the rows the user priced. Everything else keeps the
                // price and the stamp it already had — see the db's own note.
                ...(priceById[i.id] !== undefined
                  ? {
                      lastPriceMinor: priceById[i.id],
                      lastPricedAt: purchasedAt,
                      lastPriceQuantity: i.quantity,
                    }
                  : null),
              }
            : i
        ),
        itemShops,
        cartHoldIds: [],
      };
    });

    if (shop) get().setLastShopId(shop.id);
    // After the set(), so each reconcile reads the row as it now stands. Only
    // the rows this trip re-dated can have anything to say — an item bought
    // with no shelf life in the lexicon keeps whatever date it had, and its
    // task with it.
    for (const id of Object.keys(expiresAtById)) {
      const item = get().items.find(i => i.id === id);
      if (item) reconcileUseUpTask(item);
    }
    return ids.length;
  },

  clearList() {
    const before = get().items;
    const beforeItemShops = get().itemShops;
    const ids = dbClearGroceryList();
    if (ids.length === 0) return 0;
    const cleared = new Set(ids);
    // Deliberately no purchaseCount bump: nothing was bought, and inflating
    // the ranking signal would teach autocomplete a lie. Same split
    // removeFromList makes: a row already in the catalog parks off-list, a
    // provisional row (never in the catalog before this trip) is gone —
    // dbClearGroceryList already deleted it, so drop it here too rather than
    // reviving it as a catalog entry.
    const deleted = before.filter(i => cleared.has(i.id) && !i.inCatalog);
    const deletedIds = new Set(deleted.map(i => i.id));
    const deletedItemShops = beforeItemShops.filter(l => deletedIds.has(l.itemId));
    const parked = before.filter(i => cleared.has(i.id) && i.inCatalog);
    set(s => ({
      items: s.items
        .filter(i => !deletedIds.has(i.id))
        .map(i => (cleared.has(i.id) ? { ...i, onList: false, checked: false } : i)),
      itemShops: s.itemShops.filter(l => !deletedIds.has(l.itemId)),
      cartHoldIds: [],
    }));
    // A trip whose list just went away is over. The other terminator is
    // finishing a shop, which lives in the screen's handler rather than in
    // finishShopping — that one early-returns on an empty trolley, and ending
    // the trip must not be conditional on having bought something.
    get().endTrip();
    get().setLastAction({
      label: 'Cleared the list',
      undo: () => {
        const parkedById = new Map(parked.map(item => [item.id, item]));
        deleted.forEach(item => dbInsertGroceryItem(item));
        parked.forEach(item => dbUpdateGroceryItem(item));
        set(s => ({
          items: [...s.items.map(i => parkedById.get(i.id) ?? i), ...deleted],
          itemShops: [...s.itemShops, ...deletedItemShops],
        }));
      },
    });
    return ids.length;
  },

  applyDrop(placements) {
    const byId = new Map(get().items.map(i => [i.id, i]));
    const updates: GroceryItem[] = [];
    // Only the rows that crossed a section header — a drag that merely
    // reordered within an aisle says nothing about where the item lives.
    const moved: Array<{ nameKey: string; aisle: string }> = [];
    for (const p of placements) {
      const item = byId.get(p.id);
      if (!item) continue;
      if (item.sortOrder === p.sortOrder && item.aisle === p.aisle) continue;
      if (item.aisle !== p.aisle) moved.push({ nameKey: item.nameKey, aisle: p.aisle });
      updates.push({ ...item, sortOrder: p.sortOrder, aisle: p.aisle });
    }
    if (updates.length === 0) return;

    for (const u of updates) dbUpdateGroceryItem(u);
    // Dragging a row into another aisle is the same statement the item sheet's
    // picker makes, so it's remembered the same way.
    const remembered = rememberAisles(get().aisleOverrides, moved);
    if (remembered) dbSetGroceryAisleOverrides(remembered);

    const updated = new Map(updates.map(u => [u.id, u]));
    set(s => ({
      items: s.items.map(i => updated.get(i.id) ?? i),
      // Every aisle here came off a header that was already on screen, so this
      // is belt and braces — but normalizing is what setAisleMany does, and an
      // aisle missing from the order renders its section unplaced.
      aisleOrder: normalizeAisleOrder(s.aisleOrder, updates.map(u => u.aisle), s.hiddenAisles),
      aisleOverrides: remembered ?? s.aisleOverrides,
    }));
  },

  setAisleOrder(order) {
    set(commitAisleOrder(order, get().items.map(i => i.aisle)));
  },

  renameAisle(from, to) {
    const trimmed = to.trim();
    if (!trimmed || from === OTHER_AISLE || trimmed === OTHER_AISLE) return false;

    const { aisleOrder, items, aisleOverrides } = get();
    if (!aisleOrder.includes(from)) return false;
    if (trimmed === from) return true;
    // Case-insensitive, like adding one: two aisles differing only in case are
    // two sections nobody can tell apart. Re-casing the aisle itself is fine.
    if (aisleOrder.some(a => a !== from && a.toLowerCase() === trimmed.toLowerCase())) return false;

    const updates = items.filter(i => i.aisle === from).map(i => ({ ...i, aisle: trimmed }));
    for (const u of updates) dbUpdateGroceryItem(u);

    // The filings are stored by aisle *name*, so they have to move too or the
    // next time that name is typed it goes back to a section that's gone.
    const remembered = remapRememberedAisle(aisleOverrides, from, trimmed);
    if (remembered) dbSetGroceryAisleOverrides(remembered);

    const byId = new Map(updates.map(u => [u.id, u]));
    const nextItems = items.map(i => byId.get(i.id) ?? i);
    // In place, not appended: renaming an aisle doesn't move it in the walk.
    const order = aisleOrder.filter(a => a !== OTHER_AISLE).map(a => (a === from ? trimmed : a));

    set({
      items: nextItems,
      aisleOverrides: remembered ?? aisleOverrides,
      ...commitAisleOrder(order, nextItems.map(i => i.aisle)),
    });
    return true;
  },

  deleteAisle(aisle) {
    // Other is the floor every unrecognised item lands on — there'd be nowhere
    // for the rows to go, and aisleForName returning null would have no answer.
    if (aisle === OTHER_AISLE) return;
    const { aisleOrder, items, aisleOverrides } = get();
    if (!aisleOrder.includes(aisle)) return;

    // Every row, not just the ones on this week's list: the aisle is on the
    // catalog row, and a row left pointing at a deleted section would drag it
    // back through normalizeAisleOrder's `used` pass the moment it resurfaced.
    const updates = items.filter(i => i.aisle === aisle).map(i => ({ ...i, aisle: OTHER_AISLE }));
    for (const u of updates) dbUpdateGroceryItem(u);

    const remembered = forgetRememberedAisle(aisleOverrides, aisle);
    if (remembered) dbSetGroceryAisleOverrides(remembered);

    const byId = new Map(updates.map(u => [u.id, u]));
    const nextItems = items.map(i => byId.get(i.id) ?? i);

    set({
      items: nextItems,
      aisleOverrides: remembered ?? aisleOverrides,
      ...commitAisleOrder(
        aisleOrder.filter(a => a !== aisle && a !== OTHER_AISLE),
        nextItems.map(i => i.aisle)
      ),
    });
  },

  /**
   * Unlike addShop this hands back the existing aisle on a collision instead of
   * refusing. A shop is a row with an id, so returning a different one silently
   * files a trip against the wrong place; an aisle *is* its name, so the one
   * already in the order is the same aisle the caller just asked for.
   *
   * Matching is case-insensitive because normalizeAisleOrder dedupes exactly —
   * "produce" beside "Produce" would render as two sections of one aisle.
   *
   * This is also the only path that *persists* a new aisle: setAisleMany adds
   * one to the in-memory order as a side effect of filing an item there, and
   * normalizeAisleOrder recovers it at startup only for as long as some row
   * still carries it. An aisle the user typed out is a decision about their
   * store and outlives the item it was created for.
   */
  addAisle(name) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = get().aisleOrder.find(a => a.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    // setAisleOrder normalizes, so passing the order with 'Other' still in it
    // is fine — it comes back forced last.
    get().setAisleOrder([...get().aisleOrder, trimmed]);
    return trimmed;
  },

  /**
   * Refuses a duplicate rather than returning the existing store, the same way
   * renameItem refuses rather than merging: the caller asked to create
   * something, and quietly handing back a different object is how you end up
   * filing a trip against the wrong place.
   */
  addShop(name) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    // Falls back to the raw text for the same reason addByName does: a name
    // with no letters or digits normalises to empty, and two of those would
    // collide on the UNIQUE index and throw out of whatever called this.
    const key = groceryNameKey(trimmed) || trimmed.toLowerCase();
    if (get().shops.some(s => s.nameKey === key)) return null;

    const shop: Shop = {
      id: generateId(),
      name: trimmed,
      nameKey: key,
      sortOrder: get().shops.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1,
      createdAt: new Date().toISOString(),
      excludeFromSuggestions: false,
    };
    dbInsertGroceryShop(shop);
    set(s => ({ shops: [...s.shops, shop] }));
    return shop;
  },

  renameShop(id, name) {
    const shop = get().shops.find(s => s.id === id);
    if (!shop) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;

    const key = groceryNameKey(trimmed) || trimmed.toLowerCase();
    if (key !== shop.nameKey && get().shops.some(s => s.nameKey === key)) return false;

    // Renaming costs nothing downstream — every link points at the id, which
    // is the whole reason stores got a table instead of being name strings.
    const updated = { ...shop, name: trimmed, nameKey: key };
    dbUpdateGroceryShop(updated);
    set(s => ({ shops: s.shops.map(x => (x.id === id ? updated : x)) }));
    return true;
  },

  reorderShops(ids) {
    const byId = new Map(get().shops.map(s => [s.id, s]));
    const updated: Shop[] = [];
    let order = 1;
    for (const id of ids) {
      const shop = byId.get(id);
      if (!shop) continue;
      updated.push({ ...shop, sortOrder: order++ });
      byId.delete(id);
    }
    // Anything the caller didn't name keeps its relative place at the end,
    // rather than being dropped from the order entirely.
    for (const shop of byId.values()) updated.push({ ...shop, sortOrder: order++ });

    for (const shop of updated) dbUpdateGroceryShop(shop);
    set({ shops: updated });
  },

  /**
   * Takes the store's purchase records with it. A link to a store that doesn't
   * exist is unreadable rather than merely orphaned, so there's nothing to
   * preserve — and the confirm that fronts this says so.
   */
  deleteShop(id) {
    const wasLast = get().lastShopId === id;
    // Deleting the store you said you were in ends the trip — there's nowhere
    // left for it to be. Inlined rather than routed through endTrip() for the
    // same reason lastShopId is: the whole cleanup belongs in one set().
    const wasTrip = get().tripShopId === id;
    dbDeleteGroceryShop(id);
    if (wasLast) dbSetLastShopId(null);
    if (wasTrip) dbSetTrip(null, null);
    set(s => ({
      shops: s.shops.filter(x => x.id !== id),
      itemShops: s.itemShops.filter(l => l.shopId !== id),
      lastShopId: wasLast ? null : s.lastShopId,
      tripShopId: wasTrip ? null : s.tripShopId,
      tripStartedAt: wasTrip ? null : s.tripStartedAt,
    }));
  },

  setShopExcludedFromSuggestions(id, excluded) {
    const shop = get().shops.find(s => s.id === id);
    if (!shop) return;
    dbSetShopExcludeFromSuggestions(id, excluded);
    set(s => ({
      shops: s.shops.map(x => (x.id === id ? { ...x, excludeFromSuggestions: excluded } : x)),
    }));
  },

  linkItemShop(itemId, shopId) {
    get().linkItemShopMany([itemId], shopId);
  },

  linkItemShopMany(itemIds, shopId) {
    const { items, shops, itemShops } = get();
    if (!shops.some(s => s.id === shopId)) return;

    const links: ItemShopLink[] = [];
    const promoted = new Map<string, GroceryItem>();
    for (const itemId of itemIds) {
      const item = items.find(i => i.id === itemId);
      if (!item) continue;
      const existing = itemShops.find(l => l.itemId === itemId && l.shopId === shopId);
      // An existing *positive* link already says this, so there's nothing to
      // write. A negative one says the opposite, and the user is now correcting
      // it — so this overwrites the row rather than skipping it, keeping
      // whatever purchases it carries.
      if (existing && !existing.unavailableAt) continue;
      if (links.some(l => l.itemId === itemId)) continue;

      // purchaseCount 0 is the assertion: the user says it's here, no trip has
      // confirmed it. Ranking reads that and declines to call it "usually".
      const link: ItemShopLink = {
        itemId,
        shopId,
        purchaseCount: existing?.purchaseCount ?? 0,
        lastPurchasedAt: existing?.lastPurchasedAt ?? null,
        unavailableAt: null,
        // Carried, not dropped: dbSetItemShopLink writes the whole row, and
        // what this store last charged is untouched by the user saying they
        // can get it here.
        // Carried for the same reason: saying you can get it here is not a
        // statement about which one they stock. The brand is set in its own
        // right by setItemShopBrand.
        brand: existing?.brand ?? null,
        // Carried, not cleared: saying you can get it here is not a statement
        // about which brand, so it neither makes nor withdraws that claim.
        brandUnavailableAt: existing?.brandUnavailableAt ?? null,
        lastPriceMinor: existing?.lastPriceMinor ?? null,
        lastPricedAt: existing?.lastPricedAt ?? null,
        lastPriceQuantity: existing?.lastPriceQuantity ?? null,
      };
      dbSetItemShopLink(link);
      links.push(link);

      // ...and it promotes a provisional row. Saying where you get something
      // is a statement about the item, not about this week's list — but a
      // provisional row is *deleted* when it comes off the list, so without
      // this the assertion is thrown away by the next "Remove from list" and
      // the store the user just named is gone.
      if (!item.inCatalog) {
        const next = { ...item, inCatalog: true };
        dbUpdateGroceryItem(next);
        promoted.set(item.id, next);
      }
    }
    if (links.length === 0) return;

    // A link correcting a negative one is a replacement, not an addition — the
    // db upserted it, so appending blind would leave two rows in memory for a
    // pair the table can only hold one of.
    const written = new Map(links.map(l => [`${l.itemId}|${l.shopId}`, l]));
    set(s => ({
      itemShops: [
        ...s.itemShops.map(l => written.get(`${l.itemId}|${l.shopId}`) ?? l),
        ...links.filter(
          l => !s.itemShops.some(x => x.itemId === l.itemId && x.shopId === l.shopId)
        ),
      ],
      items: promoted.size > 0 ? s.items.map(i => promoted.get(i.id) ?? i) : s.items,
    }));
  },

  unlinkItemShop(itemId, shopId) {
    dbDeleteItemShopLink(itemId, shopId);
    set(s => ({
      itemShops: s.itemShops.filter(l => !(l.itemId === itemId && l.shopId === shopId)),
    }));
  },

  markItemsUnavailable(itemIds, shopId) {
    const { items, shops, itemShops } = get();
    if (!shops.some(s => s.id === shopId)) return;

    const markedAt = new Date().toISOString();
    const links: ItemShopLink[] = [];
    const promoted = new Map<string, GroceryItem>();
    for (const itemId of itemIds) {
      const item = items.find(i => i.id === itemId);
      if (!item) continue;
      const existing = itemShops.find(l => l.itemId === itemId && l.shopId === shopId);
      if (existing?.unavailableAt) continue;
      if (links.some(l => l.itemId === itemId)) continue;

      const link: ItemShopLink = {
        itemId,
        shopId,
        // History is history: the store did sell it to you those six times, and
        // the claim being made is about today's shelf.
        purchaseCount: existing?.purchaseCount ?? 0,
        lastPurchasedAt: existing?.lastPurchasedAt ?? null,
        unavailableAt: markedAt,
        brandUnavailableAt: existing?.brandUnavailableAt ?? null,
        // Same carry again. "They don't stock it" supersedes the brand claim at
        // read time (isUnavailable is checked first), so there's no need to
        // erase it — and it comes back intact if the negative is undone.
        brand: existing?.brand ?? null,
        // Same carry as linkItemShopMany, and the same reasoning as the count
        // above: what it cost when they did stock it is history, and the claim
        // is about today's shelf. Every price read drops a negative link
        // anyway, so this is kept for when the claim is taken back.
        lastPriceMinor: existing?.lastPriceMinor ?? null,
        lastPricedAt: existing?.lastPricedAt ?? null,
        lastPriceQuantity: existing?.lastPriceQuantity ?? null,
      };
      dbSetItemShopLink(link);
      links.push(link);

      // Same promotion as linkItemShopMany, for the same reason: this is a
      // statement about the item, and a provisional row is deleted the moment
      // it leaves the list — which is precisely what a thing the store didn't
      // have is about to do.
      if (!item.inCatalog) {
        const next = { ...item, inCatalog: true };
        dbUpdateGroceryItem(next);
        promoted.set(item.id, next);
      }
    }
    if (links.length === 0) return;

    const written = new Map(links.map(l => [`${l.itemId}|${l.shopId}`, l]));
    set(s => ({
      itemShops: [
        ...s.itemShops.map(l => written.get(`${l.itemId}|${l.shopId}`) ?? l),
        ...links.filter(
          l => !s.itemShops.some(x => x.itemId === l.itemId && x.shopId === l.shopId)
        ),
      ],
      items: promoted.size > 0 ? s.items.map(i => promoted.get(i.id) ?? i) : s.items,
    }));
  },

  clearItemUnavailable(itemId, shopId) {
    const existing = get().itemShops.find(l => l.itemId === itemId && l.shopId === shopId);
    if (!existing?.unavailableAt) return;

    // Nothing but the claim on this row, so taking the claim away leaves
    // nothing — and a bare row would read as the opposite assertion.
    if (existing.purchaseCount === 0) {
      get().unlinkItemShop(itemId, shopId);
      return;
    }

    const link: ItemShopLink = { ...existing, unavailableAt: null };
    dbSetItemShopLink(link);
    set(s => ({
      itemShops: s.itemShops.map(l =>
        l.itemId === itemId && l.shopId === shopId ? link : l
      ),
    }));
  },

  setBrandUnavailable(itemId, shopId, unavailable) {
    const item = get().items.find(i => i.id === itemId);
    if (!item) return;
    if (!get().shops.some(s => s.id === shopId)) return;
    const existing = get().itemShops.find(l => l.itemId === itemId && l.shopId === shopId);
    const next = unavailable ? new Date().toISOString() : null;
    if (!existing && !unavailable) return;
    if (existing && (existing.brandUnavailableAt !== null) === unavailable) return;

    // Taking the claim back off a row that was *only* the claim leaves a bare
    // purchaseCount-0 link, which asserts "I get this here" — a different and
    // stronger statement than the one being withdrawn. Same call
    // clearItemUnavailable makes about a row that was only the negative.
    if (existing && !unavailable && existing.purchaseCount === 0 && !existing.unavailableAt) {
      get().unlinkItemShop(itemId, shopId);
      return;
    }

    const link: ItemShopLink = existing
      ? { ...existing, brandUnavailableAt: next }
      : {
          itemId,
          shopId,
          // History is history, and there is none here — but the claim is about
          // a store that *has* the item, so this is not the item-level
          // negative and purchaseCount 0 is just "no trip has confirmed it".
          purchaseCount: 0,
          lastPurchasedAt: null,
          unavailableAt: null,
          lastPriceMinor: null,
          lastPricedAt: null,
          lastPriceQuantity: null,
          brand: null,
          brandUnavailableAt: next,
        };
    dbSetItemShopLink(link);
    // Promotes the row for the reason setBrand and linkItemShop both do: this
    // is a standing fact about the item, and a provisional row is deleted when
    // it leaves the list.
    const promoted = item.inCatalog ? null : { ...item, inCatalog: true };
    if (promoted) dbUpdateGroceryItem(promoted);
    set(s => ({
      itemShops: existing
        ? s.itemShops.map(l => (l.itemId === itemId && l.shopId === shopId ? link : l))
        : [...s.itemShops, link],
      items: promoted ? s.items.map(i => (i.id === itemId ? promoted : i)) : s.items,
    }));
  },

  setLastShopId(id) {
    dbSetLastShopId(id);
    set({ lastShopId: id });
  },

  startTrip(shopId) {
    // Resolved against live state for the same reason finishShopping re-resolves
    // its shop: the picker that offered this id may have been open while the
    // store was deleted somewhere else.
    if (!get().shops.some(s => s.id === shopId)) return;
    const startedAt = new Date().toISOString();
    dbSetTrip(shopId, startedAt);
    set({ tripShopId: shopId, tripStartedAt: startedAt });
  },

  endTrip() {
    if (!get().tripShopId && !get().tripStartedAt) return;
    dbSetTrip(null, null);
    set({ tripShopId: null, tripStartedAt: null });
  },

  activeShop(now = new Date()) {
    const { tripShopId, tripStartedAt, shops } = get();
    return resolveActiveTrip(tripShopId, tripStartedAt, shops, now);
  },

  /**
   * Drops a trip that has aged out while the app was open.
   *
   * `initialize` already does this for a cold start, and `activeShop` refuses
   * to resolve a dead trip whenever it's asked — but a screen that derived the
   * banner from `tripShopId` an hour ago is holding a memo whose inputs haven't
   * changed, so nothing re-renders it away. Clearing the fields is what makes
   * the expiry visible rather than merely true, which is why this is wired to
   * the grocery screen gaining focus. Same reason `checkVacationExpiry` runs on
   * foreground: no timer is running to notice.
   */
  checkTripExpiry() {
    const { tripShopId, tripStartedAt } = get();
    if (!tripShopId) return;
    if (isTripLive(tripStartedAt, new Date())) return;
    get().endTrip();
  },

  itemByNameKey(key) {
    return get().items.find(i => i.nameKey === key) ?? null;
  },

  itemById(id) {
    return get().items.find(i => i.id === id) ?? null;
  },

  rememberedAisleFor(name) {
    const key = groceryNameKey(name);
    return (key && get().aisleOverrides[key]) || null;
  },
}));
