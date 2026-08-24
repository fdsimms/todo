import { create } from 'zustand';
import type { GroceryItem, ItemProduct, ItemShopLink, ItemSubLink, ProductRating, ReceiptStyle, Shop, StoreAlias } from '../types';
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
  dbSetShopReceiptStyle,
  dbGetAllItemShopLinks,
  dbSetItemShopLink,
  dbDeleteItemShopLink,
  dbGetAllItemSubLinks,
  dbSetItemSubLink,
  dbDeleteItemSubLink,
  dbGetAllItemProducts,
  dbGetAllStoreAliases,
  dbSetStoreAlias,
  dbSetItemProduct,
  dbSetProductGtin,
  dbDeleteItemProduct,
  dbGetLastShopId,
  dbSetLastShopId,
  dbGetTripShopId,
  dbGetTripStartedAt,
  dbSetTrip,
  dbGetGroceryAisleOverrides,
  dbSetGroceryAisleOverrides,
  dbGetGroceryHiddenAisles,
  dbSetGroceryHiddenAisles,
  dbGetGroceryGroupBy,
  dbSetGroceryGroupBy,
  dbTransaction,
} from '../db/database';
import { useRecipeStore } from './useRecipeStore';
import { useTaskStore } from './useTaskStore';
import { useSettingsStore } from './useSettingsStore';
import { generateId } from '../utils/id';
import { appendPriceObservation, mergePriceHistories } from '../utils/priceHistory';
import { groceryNameKey, parseGroceryInput, splitGroceryLines } from '../utils/groceryParse';
import { hasUserFacts } from '../utils/groceryFacts';
import { describeQuantities } from '../utils/mealPlanGroceries';
import { defaultOnHandUntil, OUT_OF_IT_UNTIL } from '../utils/grocerySuggest';
import { wantsShelfLifePrompt, type DisposalOutcome } from '../utils/itemDisposal';
import { expiresAtForOpening, expiresAtForPurchase } from '../utils/groceryShelfLife';
import { useUpTaskDraft, useUpTaskDrift, wantsUseUpTask } from '../utils/groceryExpiry';
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
import { scheduleTripReminder, cancelTripReminder } from '../utils/notifications';
import { substituteQuantity } from '../utils/itemSubs';
import { productForGtin, productKeyFor, productsForItem } from '../utils/groceryProduct';
import type { ScannedGtinLink } from '../utils/scanResolve';
import {
  aliasDraftsFrom,
  aliasItemIdFor,
  aliasKeyFor,
  gtinAliasText,
  type AliasDraft,
} from '../utils/storeAliases';

/**
 * The grocery catalog, which is also the shopping list.
 *
 * One array of rows: `onList` decides what's on the list right now, and a row
 * that comes off the list stays in memory as catalog. Adding a name that's
 * already known flips `onList` instead of inserting — that single behaviour
 * (addByName below) is what gives autocomplete, the catalog and dedupe.
 *
 * **A row never leaves except by being asked to.** There used to be a second
 * axis, `inCatalog`, marking a first-typed name as provisional so that taking
 * it off the list deleted it; every feature that recorded a fact about an item
 * had to remember to promote the row, and one that forgot lost the fact on the
 * next unrelated removal. Removing from the list now parks, full stop. The one
 * sweep left is `clearList`, which drops rows carrying nothing anyone put there
 * — derived at the point of use by `hasUserFacts`, so a fact protects its own
 * row without anything having to be remembered.
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
  /** See useTaskStore's UndoableAction — same flag, same UndoBar. */
  destructive?: boolean;
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

/**
 * The later of two ISO stamps, treating null as older than any of them —
 * i.e. an explicit assertion always beats no assertion. Used by mergeItems
 * for every "which of two timestamps wins" question, including
 * `onHandUntil`: `OUT_OF_IT_UNTIL` is deliberately the oldest possible
 * stamp, so it loses to a real "on hand until" date exactly the way a stale
 * out-of-it claim should when the other row has a fresher one.
 */
function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** The three price fields, moved as a group from whichever side was priced more recently — never averaged. */
function pickPriceFields<
  T extends { lastPriceMinor: number | null; lastPricedAt: string | null; lastPriceQuantity: string | null },
>(a: T, b: T): Pick<T, 'lastPriceMinor' | 'lastPricedAt' | 'lastPriceQuantity'> {
  const winner = !a.lastPricedAt ? b : !b.lastPricedAt || a.lastPricedAt >= b.lastPricedAt ? a : b;
  return {
    lastPriceMinor: winner.lastPriceMinor,
    lastPricedAt: winner.lastPricedAt,
    lastPriceQuantity: winner.lastPriceQuantity,
  };
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
  /**
   * "If there's no butter, use margarine" — every substitution the user has
   * recorded, in one flat list. Directional, so a both-ways swap is two rows;
   * see ItemSubLink, and utils/itemSubs.ts for the reads.
   */
  itemSubs: ItemSubLink[];
  /**
   * Every box the user has named, across every item, in one flat list — the
   * same shape `itemShops` and `itemSubs` take, and read the same way (filter
   * by `itemId`, resolve-or-shrug on a dangling pointer). See ItemProduct.
   */
  itemProducts: ItemProduct[];
  /**
   * What this app has been told a store's shorthand means. See StoreAlias.
   *
   * In the store rather than read per lookup like `gtin_lookups` is, because
   * unlike that cache these are consulted on every render of a review sheet
   * (once per line, against the whole set) and are small: bounded by the
   * phrases a person has actually confirmed, not by everything ever scanned.
   */
  storeAliases: StoreAlias[];
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
  /**
   * How the shopping list groups its unchecked rows — aisle (default) or
   * recipe. See buildGroceryRecipeSections. A display setting, not a fact
   * about any item, so it lives here rather than on the rows themselves.
   */
  groceryGroupBy: 'aisle' | 'recipe';
  setGroceryGroupBy: (groupBy: 'aisle' | 'recipe') => void;
  /**
   * The item a just-completed "Use up X" task points at — what
   * UseUpResolveSheet (mounted in AppNavigator) shows as soon as it's set,
   * so completing the task and correcting the pantry happen in one motion
   * instead of the task going quiet with the pantry untouched. Set by
   * useTaskStore.completeTask, cleared by uncompleteTask (same shape as
   * useMealPlanStore's cookedOffer) and by the sheet's own onClose.
   *
   * Session-only, like the trip fields above: it's about a tap just made,
   * so there's nothing for it to mean on the next launch.
   */
  pendingUseUpItemId: string | null;
  setPendingUseUpItem: (id: string | null) => void;
  /**
   * The row a "how did this go" question is currently outstanding for, and
   * which of the two questions it is.
   *
   * `'ask'` is the question itself, raised by a single-row `markOutOfMany` with
   * no outcome. `'shelfLife'` is what a "went bad" answer can turn into once
   * it's happened more than once (`wantsShelfLifePrompt`) — an offer to shorten
   * what the app thinks this keeps for, which is the one action the record
   * actually supports.
   *
   * **Session-only, same as `pendingUseUpItemId` above**: it's about a tap just
   * made, so there's nothing for it to mean on the next launch, and a question
   * about a bag of spinach thrown out last Tuesday isn't one anyone can answer.
   * That's also what takes the place of a dismissal stamp — see
   * `OfferBanner`, whose callers make the same call.
   */
  disposalOffer: { itemId: string; stage: 'ask' | 'shelfLife' } | null;
  dismissDisposalOffer: () => void;
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
      /**
       * GroceryAddField's Brand/Variant chips — the one other way either field
       * is ever set besides GroceryItemSheet. Same merge rule as quantity/note:
       * applied only when this particular add actually carried one, so a bare
       * re-add can't wipe what's already on the row.
       */
      brand?: string | null;
      variant?: string | null;
      /**
       * Where a barcode source files this product, as an aisle — see
       * `aisleForProductCategory`.
       *
       * **Consulted last, after the remembered aisle and the name lexicon**, so
       * it can only place a row that would otherwise land in `Other` and can
       * never move one the other two already got right. A foreign taxonomy is a
       * weaker signal than either the user's own filing or a word the app's own
       * lexicon knows.
       */
      aisle?: string | null;
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
  /**
   * "cilantro" and "coriander" are one item wearing two names — this is the
   * merge renameItem's own doc comment defers to. `fromId`'s history folds
   * into `intoId` field by field (see the implementation for exactly how),
   * `fromId` is deleted, and the pair's recipes/remembered aisle re-key onto
   * `intoId` the same way a rename does. Not reversible by shake-to-undo —
   * the merge sheet confirms first instead. False when either id is unknown
   * or they're the same row.
   */
  mergeItems: (fromId: string, intoId: string) => boolean;
  setNote: (id: string, note: string) => void;
  /**
   * Name a box under an item — "Arnold's wheat" under Bread. Returns the
   * product, which may be one that already existed: the brand/variant pair is
   * the identity (see `ensureProductFor`), so naming a box twice is one box.
   *
   * Null when neither field says anything, which is the caller's cue that
   * there was nothing to add.
   *
   * **Only the first one becomes the preference**, and that asymmetry is
   * deliberate: the first box named on an item with no opinion yet plainly is
   * the answer to "which one?", while a second is a box you're recording, not
   * a decision you've made. Promoting every new one would mean the list you
   * build to compare products silently re-decides for you each time you add
   * to it. `setPreferredProduct` is the deliberate version.
   */
  addProduct: (
    itemId: string,
    fields: { brand: string | null; variant: string | null; note?: string; rating?: ProductRating | null },
    /**
     * `promote: false` files the box without letting it answer "which one?" —
     * the product is recorded and `preferredProductId` is left exactly as it
     * was, even when the item hasn't got one.
     *
     * For the caller that is recording what it *observed* rather than what the
     * user *chose*: a barcode scan knows a box came home, which is not the same
     * statement as naming one in the product sheet. Unpacking twenty bags would
     * otherwise decide twenty items' preferences nobody asked about (#1866).
     * Defaults to promoting, which is every hand-driven caller.
     */
    opts?: { promote?: boolean }
  ) => ItemProduct | null;
  /**
   * Edit one box in place — its spelling, its note, its rating.
   *
   * Re-keys on a brand or variant change, so the identity follows the words.
   * False when the edit would collide with another product of the same item:
   * two boxes can't be the same box, and silently merging them would throw one
   * of their ratings and purchase counts away. The caller says so instead.
   */
  updateProduct: (
    id: string,
    patch: { brand?: string | null; variant?: string | null; note?: string; rating?: ProductRating | null }
  ) => boolean;
  /**
   * Which of an item's products it's asking for — the pointer that replaced
   * the old brand/variant strings. Null is "any of them will do".
   *
   * See GroceryItem.preferredProductId.
   */
  setPreferredProduct: (itemId: string, productId: string | null) => void;
  /**
   * Forget a box entirely. Every pointer at it goes with it (the preference,
   * the "last got here" observations, the per-store claims about it) — see
   * dbDeleteItemProduct, which owns that cascade.
   *
   * Deleting is genuinely rare and genuinely destructive: a product carries
   * the only record of having tried it. Marking one `avoid` is what the user
   * usually wants, and the sheet says so.
   */
  deleteProduct: (id: string) => void;
  /**
   * "Only this one" — whether the preferred product filters store availability
   * or is just shown on the row. See GroceryItem.productStrict.
   */
  setProductStrict: (id: string, strict: boolean) => void;
  /**
   * "They haven't got the one I want here", and taking it back. The only claim
   * a product rule filters on — see ItemShopLink.unavailableProductIds.
   *
   * The claim is stamped against the item's *preferred* product, because that
   * is what the user is standing in front of the shelf failing to find. On an
   * item with no preference there is nothing to claim, and this does nothing.
   *
   * Creates the link if there isn't one: the claim is about a store that stocks
   * the item, so it would be strange to require linking it first.
   */
  setProductUnavailable: (itemId: string, shopId: string, unavailable: boolean) => void;
  /**
   * The pantry, one box at a time — the four actions below are
   * `setOnHandUntil` / `markOutOfMany` / `setFrozen` / `setOpened` addressed to
   * a packet instead of to the catalog row it hangs off.
   *
   * They exist because an item can hold two packets at once and the item-level
   * columns can only describe one: two brands of vegan ground beef are the same
   * thing to a recipe and are still two separate things in the freezer. See
   * ItemProduct.onHandUntil for why there are four of these and not five, and
   * `grocerySuggest.productHaveReason` for what the pantry does with them.
   *
   * Each one mirrors its item-level twin exactly, down to the no-op guard and
   * the re-dating rules, so a box and an item can never drift on what "frozen"
   * or "opened" means. What they deliberately don't mirror is a *cascade*:
   * saying something about one packet says nothing about the item or about the
   * other packet, which is the entire point.
   */
  setProductOnHandUntil: (id: string, until: string | null) => void;
  /**
   * "Out of it" for a box — the ✕ on a Pantry row that names one. Batched like
   * `markOutOfMany` and returning how many rows actually changed, so a caller
   * can tell a real correction from a no-op.
   *
   * Deliberately without `markOutOfMany`'s disposal question: that offer hangs
   * off the item's own usedUp/spoiled counters, which stay item-level (how
   * often *this food* gets wasted is the useful record, and splitting it per
   * brand would leave both halves too thin to say anything).
   */
  markProductsOutOf: (ids: readonly string[]) => number;
  /** This box in or out of the freezer. Suspends its own countdown only. */
  setProductFrozen: (id: string, frozen: boolean) => void;
  /** This box opened or resealed, re-dating it off the open lexicon. */
  setProductOpened: (id: string, opened: boolean) => void;
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
   *
   * **`outcome` is for the caller that already knows how the thing left.** A
   * cook reports what it used up, so `CookedUseUpSheet` passes `'usedUp'` and
   * nothing is asked. Left off, a single-row call raises `disposalOffer`
   * instead, because a ✕ says only that the thing is gone. A multi-row call
   * with no outcome asks nothing at all: one question per row about a batch is
   * the same "recall five kitchens" the cook offer declines for
   * `bulkSetCooked`.
   */
  markOutOfMany: (ids: readonly string[], outcome?: DisposalOutcome) => number;
  /**
   * "Used it up" / "Went bad" for one row — the two ways out of the pantry,
   * recorded. See `GroceryItem.usedUpCount` for why these are counts and not a
   * shelf-life estimate.
   *
   * Deliberately separate from the assertion itself: the row is already marked
   * out by the time this is called, so an unanswered question leaves the pantry
   * exactly as correct as it was. The answer is the extra, and it's optional at
   * every point it's offered.
   */
  recordDisposal: (itemId: string, outcome: DisposalOutcome) => void;
  /**
   * "I have this" for something the app hasn't worked out on its own — the add
   * field on KitchenScreen. It writes exactly the assertion GroceryItemSheet's
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
   *
   * `registerUndo: false` suppresses the per-call shake-to-undo entry, same as
   * `addByName`'s option and for the same reason — `addManyToPantry` uses it
   * and registers one combined action of its own after its loop.
   *
   * `onUndo`, if given, is handed the same revert closure `registerUndo`
   * would otherwise file under `lastAction` — called regardless of
   * `registerUndo`, so a caller that can't reach shake-to-undo (a sheet
   * presented as a native `Modal` sits above `UndoBar` too) can still offer
   * an immediate, local way back without reimplementing the revert itself.
   */
  addToPantry: (raw: string, opts?: { registerUndo?: boolean; onUndo?: (undo: () => void) => void }) => GroceryItem | null;
  /**
   * `addToPantry`, for a whole scan session at once — the barcode sheet's
   * "Add" button on the Pantry screen. Loops `addToPantry` with its undo
   * suppressed and registers one combined entry, the same shape
   * `addManyFromText` uses over `addByName`, and for the same reason: without
   * it, only the last barcode of a five-item scan would be undoable.
   *
   * Returns the number of names that actually produced a row — a name that
   * normalizes to nothing is skipped, same as a single `addToPantry` call.
   *
   * `frozenNames` is the scan sheet's per-row freezer toggle, matched back by
   * the same raw string a name landed under — safe because a name that
   * collides with another in this same batch already collapses onto one row
   * (`addToPantry` upserts by `nameKey`), so "frozen" collapsing with it too
   * is the existing model, not a new gap.
   *
   * `products` is the same barcode's own box — who makes it, which one it is
   * — keyed the same way `frozenNames` is. Applied through `addProduct` with
   * its default promotion rule, so the very first box a pantry item has ever
   * seen becomes what it shows, and a box it already has an opinion about
   * stays exactly what it was.
   *
   * Its `gtin` rides along for the same reason the whole map does: a row this
   * batch mints has no id until the loop below creates it, so the sheet that
   * read the barcode can't record the link itself. Linked once at the end,
   * after every box exists to be pointed at.
   *
   * Its `aisle` is the source's own category, applied only to a row this
   * batch mints (never to one it merely found) and only when the user has no
   * remembered correction for the name — the same restraint `addByName`'s own
   * `aisle` override takes, and the same guard `addStructuredIngredients`
   * checks before calling `setAisle` itself. A found row already has a filed
   * aisle of its own; a barcode's read of the source is not grounds to move it.
   *
   * `prices` is a receipt's own numbers, keyed by the same raw string for the
   * same reason again — a row this batch mints has no id to key by. Written
   * through `setItemPrice`, which is the deliberate part: this is not a trip.
   * A receipt read in the pantry says what something cost and nothing else, so
   * it records the price exactly as typing it into the item sheet would and
   * bumps no purchase count, mints no store link and makes no claim about what
   * that store stocks. `shopId` is which store's price it is, null for none;
   * an item with no link to that store still records its own price, same as an
   * unplaced trip does. Not part of the undo snapshot on this batch's *links*
   * — the item rows revert wholesale with everything else, matching how
   * `addProduct` is already treated here.
   */
  addManyToPantry: (
    names: readonly string[],
    frozenNames?: ReadonlySet<string>,
    products?: ReadonlyMap<
      string,
      { brand: string | null; variant: string | null; gtin?: string | null; aisle?: string | null }
    >,
    prices?: { byName: ReadonlyMap<string, number>; shopId: string | null }
  ) => number;
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
   * Puts this item in the freezer, or takes it back out.
   *
   * **Freezing suspends; thawing restarts.** Going in stamps the instant and
   * touches nothing else — `expiresAt` keeps the day this purchase would have
   * been answerable to, and simply stops being read (`liveExpiresAt`). Coming
   * out re-stamps `expiresAt` from a *fresh* shelf life measured from now,
   * through the same `expiresAtForPurchase` a finished trip uses, because
   * that's what a thaw is: the food starts its clock over, and thawed chicken
   * keeping two days from today is exactly right where the stale day it went in
   * with is a fortnight past.
   *
   * An item the lexicon has never heard of, and that carries no
   * `shelfLifeDays`, thaws to no date at all — the same silence it had before
   * it was frozen, rather than a guess invented on the way out.
   */
  setFrozen: (id: string, frozen: boolean) => void;
  /**
   * Records that this has been opened, or takes that back.
   *
   * The third event that re-anchors a use-by day, and the one that needed its
   * own lexicon: `expiresAtForOpening` re-dates the row from
   * `OPEN_SHELF_LIFE_LEXICON` when the name is one opening actually starts a
   * clock for, and leaves the day exactly as it was otherwise. Un-marking is a
   * correction to a mis-tap, so it clears the stamp and leaves the date alone —
   * there is no old day to put back, and inventing one would be a third guess.
   */
  setOpened: (id: string, opened: boolean) => void;
  /**
   * "Opened" for several rows at once, dated — what a cook *used*, where
   * `markOutOfMany` beside it is what a cook *finished*.
   *
   * Exactly the stamp `setOpened(id, true)` writes, including the re-dating off
   * `OPEN_SHELF_LIFE_LEXICON`, batched for the one caller that reports a whole
   * ingredient list at once (`useMealPlanStore.setCooked` — see the note there
   * for why cooking is allowed to assert this when it is not allowed to assert
   * consumption). Rows already carrying an `openedAt` are skipped rather than
   * re-stamped, so the count it returns is what actually changed and a jar
   * opened last week keeps the day it was opened on.
   *
   * `at` is when the opening happened, defaulting to now. The cook path passes
   * the meal's own day when that day has passed: a Tuesday dinner ticked off on
   * Thursday opened its jar on Tuesday, and stamping now would hand it two
   * extra days of shelf life.
   *
   * **It registers no undo of its own**, unlike `markOutOfMany`. Nobody tapped
   * these rows — they are inferred from a tick on a meal, and that tick already
   * owns the shake (MealPlanScreen's `setCooked` registers it right after the
   * write, so an entry here would only be clobbered anyway). Resealing one is a
   * tap on the item's own sheet.
   */
  markOpenedMany: (ids: readonly string[], at?: Date) => number;
  /**
   * "I'm nearly out of this" — and, because that is the whole reason anyone
   * says it, puts the row on this week's list.
   *
   * **The one place a pantry assertion touches `onList`**, and the exception
   * that proves `addToPantry`'s rule. Saying you *have* something is not a plan
   * to buy it, which is why that path leaves the list alone; saying you're
   * nearly out is nothing but a plan to buy it, and making the user then find
   * the same item again in the add field is asking them to say it twice.
   *
   * **It reaches into `onList` in one direction only.** Marking adds; clearing
   * leaves the list exactly as it is. The column has several owners — a recipe
   * added it, the user typed it, a trip is about to buy it — and nothing on the
   * row records *which* of them put it there, so a clear that removed it would
   * be guessing with someone else's data. The add is undoable the moment it
   * happens (`setLastAction`), which is the honest answer for a mis-tap;
   * "I'm not nearly out any more" a week later is not a request to cancel the
   * shopping.
   */
  setRunningLow: (id: string, low: boolean) => void;
  /**
   * The remembered shelf life — a dumb setter, unlike setExpiresAt: this
   * never touches expiresAt or the use-up task on its own. See
   * GroceryItem.shelfLifeDays for when each one is the write to make.
   */
  setShelfLifeDays: (id: string, days: number | null) => void;
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
  setPantryCheckDeclinedAt: (id: string, value: string | null) => void;

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
   *
   * `purchasedAt` defaults to now, same as always — a hand-finished trip has
   * no other answer. A scanned receipt can pass its own printed date instead,
   * so the purchase, its price and any shelf-life day it starts are dated
   * when the shop actually happened rather than when it got round to being
   * scanned (#1806).
   *
   * `frozenIds` overrides this trip's own `frozenAt: null` clear (see the
   * write below) for just those rows — the barcode scan sheet's per-row
   * freezer toggle, applied here rather than at scan time because scanning
   * only checks an item onto the list; freezing a row this trip hasn't
   * bought yet would be a claim about food that isn't home. An id the trip
   * didn't actually purchase (marked unavailable, or substituted away) is
   * silently not among the rows this write touches, so flagging it here does
   * nothing rather than freezing the wrong row.
   */
  finishShopping: (
    shopId?: string | null,
    priceById?: Readonly<Record<string, number>>,
    purchasedAt?: string,
    frozenIds?: ReadonlySet<string>
  ) => number;
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
  /** What this store's receipts are worth reading. See ReceiptStyle. */
  setShopReceiptStyle: (id: string, style: ReceiptStyle) => void;
  /** Assert "this item is available here" without a purchase behind it. */
  /**
   * Records what a review sheet was applied with, so the same phrases resolve
   * without asking next time. One write per phrase; see `aliasDraftsFrom` for
   * why only a user's confirmation gets here.
   */
  rememberAliases: (drafts: readonly AliasDraft[]) => void;
  /** "What does this line mean at this store" — null when nothing has said. */
  aliasItemFor: (shopId: string | null, rawText: string) => string | null;
  /**
   * Records what a scan session was applied with, so the same barcode lands on
   * the same row next time however its name has drifted since.
   *
   * **Two links per scan, because they say different things.** The box
   * (`ItemProduct.gtin`) is what a barcode actually denotes, and it is what
   * lets a rescan restore the brand and variant rather than re-deriving them
   * from a product name the item may no longer resemble. The item (a GTIN-keyed
   * `StoreAlias`) is the fallback for the rows that have no box at all — an
   * unfound barcode the user named by hand, a record the source gave no brand
   * for — which is the case worth remembering most, since nothing else about
   * it is ever going to improve.
   *
   * A link naming a `brand`/`variant` the item has no product for writes only
   * the alias; nothing is minted here, because `addProduct` is the one path
   * that decides what a box is and whether it becomes the preference.
   */
  linkScannedGtins: (links: readonly ScannedGtinLink[]) => void;
  /**
   * The catalog row a barcode was last confirmed against, box first and item
   * second — see `linkScannedGtins`. Null when this code has never been named.
   */
  gtinItemFor: (gtin: string | null) => string | null;
  /** The box a barcode names, for restoring its brand and variant on a rescan. */
  gtinProductFor: (gtin: string | null) => ItemProduct | null;
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
   * "Instead of butter, margarine." Directional — `bothWays` writes the
   * reverse row as well, so the common symmetric case is one tap and the
   * asymmetric one ("milk instead of buttermilk", which doesn't run the other
   * way) stays expressible.
   *
   * Neither row needs promoting: saying what stands in for flour is a
   * statement about flour rather than about this week's list, and the link
   * itself is what keeps both rows through `clearList`'s sweep — see
   * `hasUserFacts`. This used to have to mark them by hand.
   *
   * A no-op for an item linked to itself, or for either half not existing.
   */
  linkItemSub: (
    itemId: string,
    subItemId: string,
    opts?: {
      note?: string | null;
      bothWays?: boolean;
      /**
       * "1 clove" → "1/4 tsp" — pass both or neither; one alone is dropped.
       * On `bothWays`, the reverse row gets these **swapped**
       * (`ratioTo`→`ratioFrom`, `ratioFrom`→`ratioTo`): the forward row's
       * ratio describes *this* item's own unit on the left, and the reverse
       * row's has to describe the *other* item's unit on its own left, or a
       * both-ways garlic↔garlic-powder link would have the reverse row
       * claiming a clove converts to a further clove.
       */
      ratioFrom?: string | null;
      ratioTo?: string | null;
      /**
       * "Always use this instead" — the standing swap (#1571). Never copied
       * onto the `bothWays` row, and writing it clears the bit on this item's
       * other substitutes and on the reverse link: one item has one answer to
       * "what do I always use instead", and a pair marked standing both ways
       * would swap into itself.
       */
      standing?: boolean;
    }
  ) => void;
  /**
   * The catalog row for a typed name, minting one off-list if there isn't one.
   *
   * The neutral half of `addToPantry`: same "find or add" field shape, minus
   * the on-hand assertion, because naming margarine as a substitute for butter
   * says nothing about whether you have any. Returns null for a name that
   * trims away.
   *
   * Off the list from the first moment, which `addByName` never produces:
   * naming something to record a standing fact about it is not a plan to buy
   * it this week.
   */
  ensureCatalogItem: (name: string) => GroceryItem | null;
  /** Drops one direction. The reverse row, if there is one, is left alone. */
  unlinkItemSub: (itemId: string, subItemId: string) => void;
  /** The caveat — "fine for frying, not for baking". Blank clears it. */
  setItemSubNote: (itemId: string, subItemId: string, note: string) => void;
  /**
   * Turns the standing swap on or off for one link, leaving the substitute
   * itself recorded either way — the Settings review list's one write, and the
   * whole of "turning the rule off restores everything".
   *
   * Turning it on enforces the same exclusivity `linkItemSub` does.
   */
  setItemSubStanding: (itemId: string, subItemId: string, standing: boolean) => void;
  /**
   * "Not at Safeway · or margarine", tapped: puts the substitute on the list
   * and takes the original off. The original's quantity carries over —
   * ratio-converted where the link names one, verbatim otherwise, since a
   * cooking amount is a floor and the best answer available — and its
   * ownership marker travels with it (see GroceryItem.quantityFromRecipe).
   *
   * Follows resolveChoice's own discipline rather than a lighter version of
   * it: snapshot both rows first and restore them exactly on undo.
   *
   * A no-op unless the original is actually on the list.
   */
  swapForSubstitute: (itemId: string, subItemId: string) => void;
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
 * The links that have to stop being standing for `itemId → subItemId` to be —
 * this item's other substitutes, and the reverse row.
 *
 * Returned rather than written, so both callers (`linkItemSub`,
 * `setItemSubStanding`) persist and patch state in one pass with their own
 * write. Empty for the overwhelmingly common case of an item with one
 * substitute and no reverse link, so nothing is written for nothing.
 */
function clearOtherStandingLinks(
  links: readonly ItemSubLink[],
  itemId: string,
  subItemId: string
): ItemSubLink[] {
  return links
    .filter(l => l.standing)
    .filter(l =>
      (l.itemId === itemId && l.subItemId !== subItemId)
      || (l.itemId === subItemId && l.subItemId === itemId))
    .map(l => ({ ...l, standing: false }));
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
 * Null when neither half names anything — a product with no brand and no
 * variant is the item itself, so there's nothing to create. Callers read that
 * as "the user cleared the field", not as a failure.
 *
 * Pure, so the caller owns the db write and the `set()`; both call sites need
 * to do slightly different things with the result.
 */
function ensureProductFor(
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
  // their own list — re-typing "arnolds" under a product filed as "Arnold's"
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
function newItemRow(fields: {
  name: string;
  nameKey: string;
  aisle: string;
  sortOrder: number;
  createdAt: string;
  onList: boolean;
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
    onList: fields.onList,
    checked: false,
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
    // Nobody has been asked about a row that didn't exist a moment ago, and a
    // brand-new row can't have a lapsed purchase reading to be asked about.
    pantryCheckDeclinedAt: null,
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
  /**
   * The either/or slot this row is one option of, as the recipe-side key
   * `choiceGroupKey` mints — see ClassifiedIngredient.choiceGroup. Rows sharing
   * one land on the list under a single opaque `GroceryItem.choiceGroup`, so
   * ticking one at the shelf takes the others off.
   *
   * **The key is translated, never stored.** A recipe's group label is a
   * heading over its ingredient list; a grocery row has nowhere to render one,
   * and two shops of the same recipe must not merge into one group weeks apart.
   * `addFromPlan` mints a fresh id per key per call, which is exactly the
   * lifetime of "this trolley".
   */
  choiceGroup?: string | null;
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
  const { groceryUseUpTasks, groceryUseUpLeadDays, groceryUseUpTaskCategory, useUpTaskCap } =
    useSettingsStore.getState();
  reconcileGeneratedTask({
    kind: 'groceryUseUp',
    sourceId: item.id,
    // No date guard here any more: wantsUseUpTask owns that precondition now,
    // and owning it in one place is what keeps the frozen case honest — this
    // used to re-check `expiresAt` because an explicit `useUpTask: true` could
    // outrank the qualifier and reach useUpTaskFields' `expiresAt!`.
    wanted: wantsUseUpTask(item, groceryUseUpTasks),
    drift: existing => useUpTaskDrift(existing, item, groceryUseUpLeadDays),
    draft: () => useUpTaskDraft(item, groceryUseUpLeadDays, groceryUseUpTaskCategory),
    useUpCap: useUpTaskCap,
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
  itemSubs: [],
  itemProducts: [],
  storeAliases: [],
  lastShopId: null,
  tripShopId: null,
  tripStartedAt: null,
  aisleOverrides: {},
  cartHoldIds: [],
  groceryGroupBy: 'aisle',
  pendingUseUpItemId: null,
  disposalOffer: null,
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
    const itemSubs = dbGetAllItemSubLinks();
    const itemProducts = dbGetAllItemProducts();
    const storeAliases = dbGetAllStoreAliases();
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
      itemProducts,
      itemShops,
      itemSubs,
      storeAliases,
      lastShopId,
      tripShopId,
      tripStartedAt,
      cartHoldIds: [],
      groceryGroupBy: dbGetGroceryGroupBy(),
      pendingUseUpItemId: null,
      disposalOffer: null,
      initialized: true,
    });
  },

  setGroceryGroupBy(groupBy) {
    dbSetGroceryGroupBy(groupBy);
    set({ groceryGroupBy: groupBy });
  },

  setPendingUseUpItem(id) {
    set({ pendingUseUpItemId: id });
  },

  dismissDisposalOffer() {
    set({ disposalOffer: null });
  },

  /**
   * The whole product insight, in one function. A name we already know is put
   * back on the list; only a genuinely new one inserts a row. That's why
   * there's never a duplicate, why autocomplete has history to rank, and why
   * next week's list starts from what you actually buy.
   *
   * Registers shake-to-undo by default (`opts.registerUndo`, default true).
   * The two branches below undo differently and each says so where it is: a
   * row this call *inserted* is deleted, a row it merely re-listed is put back
   * off-list. That used to be one call to `removeFromList` for both, which
   * worked only because a first-typed row was provisional and so deleted
   * itself on the way off the list. Now that removal always parks, the branch
   * that created the row has to say so — which it is better placed to know
   * than a stored flag was. Batch callers (addManyFromText, addFromPlan) pass
   * `registerUndo: false` and register one combined action of their own
   * instead, so a ten-line paste doesn't leave only the last line undoable.
   */
  addByName(raw, override, source, opts) {
    const { name, quantity } = override ?? parseGroceryInput(raw);
    const note = override?.note?.trim() || null;
    const choiceGroup = override?.choiceGroup?.trim() || null;
    const brand = override?.brand?.trim() || null;
    const variant = override?.variant?.trim() || null;
    const sourceAisle = override?.aisle?.trim() || null;
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
        // A quantity typed here is the user's own — see
        // GroceryItem.quantityFromRecipe — so it takes ownership exactly like
        // setQuantity does. Left alone when nothing was typed, so a re-add
        // with no amount doesn't strip a still-standing recipe ownership.
        quantityFromRecipe: quantity ? false : existing.quantityFromRecipe,
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
      // And the same rule again for the box: GroceryAddField's Brand/Variant
      // chips are the only caller that passes these, and only when the user
      // actually typed into one — so a bare re-add leaves whatever preference
      // the row already had. Naming one here both files it under the item and
      // makes it the preference, since typing it into the add field is a
      // statement about what you're going shopping for.
      const ensured = ensureProductFor(existing.id, brand, variant, get().itemProducts, now);
      if (ensured) {
        updated.preferredProductId = ensured.product.id;
        if (ensured.created) dbSetItemProduct(ensured.product);
      }
      dbUpdateGroceryItem(updated);
      set(s => ({
        items: s.items.map(i => (i.id === existing.id ? updated : i)),
        itemProducts: ensured?.created ? [...s.itemProducts, ensured.product] : s.itemProducts,
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
      //
      // A barcode source's own category is the third and weakest of the three,
      // so it only ever answers where both of the others were silent — see the
      // `aisle` override's note.
      aisle: placeAisle(
        get().aisleOverrides[key] ?? aisleForName(name) ?? sourceAisle,
        get().aisleOrder
      ),
      quantity,
      note,
      onList: true,
      sortOrder: nextSortOrder(get().items),
      createdAt: now,
      choiceGroup,
      source,
    });
    // After the row exists, because a product hangs off an item id. Nothing
    // is ever parsed out of the typed name to get here — see ItemProduct.brand.
    const ensured = ensureProductFor(item.id, brand, variant, get().itemProducts, now);
    if (ensured) item.preferredProductId = ensured.product.id;
    dbInsertGroceryItem(item);
    if (ensured?.created) dbSetItemProduct(ensured.product);
    set(s => ({
      items: [...s.items, item],
      itemProducts: ensured?.created ? [...s.itemProducts, ensured.product] : s.itemProducts,
    }));
    if (opts?.registerUndo !== false) {
      get().setLastAction({
        label: `Added "${item.name}"`,
        // This call minted the row, so undoing it takes the row with it.
        undo: () => get().deleteItems([item.id]),
      });
    }
    return item;
  },

  addManyFromText(raw) {
    const lines = splitGroceryLines(raw);
    const added: GroceryItem[] = [];
    const alreadyOnList: GroceryItem[] = [];
    // Which ids existed before the paste, so the undo can tell a row it minted
    // from one it merely re-listed — the split addByName's own undo makes per
    // line, done once for the batch.
    const preexisting = new Set(get().items.map(i => i.id));
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
      const minted = added.filter(i => !preexisting.has(i.id)).map(i => i.id);
      const relisted = added.filter(i => preexisting.has(i.id)).map(i => i.id);
      get().setLastAction({
        label: `${added.length} item${added.length === 1 ? '' : 's'} added`,
        undo: () => {
          if (minted.length > 0) get().deleteItems(minted);
          if (relisted.length > 0) get().removeFromListMany(relisted);
        },
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
   * finishShopping does: this store owns the catalog-row rules,
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
    // See addManyFromText: the undo has to tell a minted row from a re-listed
    // one, and the only moment that is knowable is before the loop runs.
    const preexisting = new Set(get().items.map(i => i.id));
    const added: GroceryItem[] = [];
    const alreadyOnList: GroceryItem[] = [];
    const skippedInCart: GroceryItem[] = [];

    // One opaque id per incoming key, minted here rather than carried from the
    // recipe — see PlannedRow.choiceGroup. A group whose options all resolve to
    // rows already on the list mints an id nothing uses, which is harmless.
    const groupIds = new Map<string, string>();
    const groupIdFor = (key: string) => {
      const existing = groupIds.get(key);
      if (existing) return existing;
      const minted = generateId();
      groupIds.set(key, minted);
      return minted;
    };

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
        // run the guesswork twice. The override exists only to carry the
        // either/or through; without one it stays undefined so addByName parses
        // exactly as it always has.
        const item = get().addByName(
          row.name,
          row.choiceGroup
            ? { ...parseGroceryInput(row.name), choiceGroup: groupIdFor(row.choiceGroup) }
            : undefined,
          row.sourceRecipeId ? { recipeId: row.sourceRecipeId, recipeTitle: row.sourceRecipeTitle ?? '' } : undefined,
          { registerUndo: false }
        );
        if (row.aisle && !get().rememberedAisleFor(row.name)) get().setAisle(item.id, row.aisle);
        // A cooking amount is a lower bound for one shop, not the row's
        // standing preference — see GroceryItem.quantityFromRecipe. Written
        // directly rather than through setQuantity, which always hands
        // ownership to the user; only an empty or already recipe-owned slot
        // is overwritten, so a hand-set "2 bags" outranks this week's
        // "3/4 cup" and a recipe never overwrites what the user set.
        if (row.quantity) {
          const current = get().itemById(item.id);
          if (current && (!current.quantity || current.quantityFromRecipe)) {
            const withQuantity = { ...current, quantity: row.quantity, quantityFromRecipe: true };
            dbUpdateGroceryItem(withQuantity);
            set(s => ({ items: s.items.map(i => (i.id === withQuantity.id ? withQuantity : i)) }));
          }
        }
        added.push(get().itemById(item.id) ?? item);
      }
    });

    // One combined undo for the whole recipe, same split addManyFromText
    // makes: a row this call minted goes, a row it re-listed goes back
    // off-list.
    if (added.length > 0) {
      const minted = added.filter(i => !preexisting.has(i.id)).map(i => i.id);
      const relisted = added.filter(i => preexisting.has(i.id)).map(i => i.id);
      get().setLastAction({
        label: `${added.length} item${added.length === 1 ? '' : 's'} added`,
        undo: () => {
          if (minted.length > 0) get().deleteItems(minted);
          if (relisted.length > 0) get().removeFromListMany(relisted);
        },
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
    // The user's own edit always takes ownership — see
    // GroceryItem.quantityFromRecipe — even when this clears the field: a
    // blank slot is exactly what addFromPlan treats as free to write into.
    const updated = { ...item, quantity: trimmed || null, quantityFromRecipe: false };
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
   * Returns false on a key collision rather than merging. A collision means
   * two rows already claim to be the same thing, and *this* function has no
   * way to ask which one should survive — that's mergeItems, reached through
   * a deliberate merge sheet rather than a rename that happened to collide.
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

  mergeItems(fromId, intoId) {
    if (fromId === intoId) return false;
    const { items, itemShops, itemSubs, itemProducts, aisleOverrides } = get();
    const fromItem = items.find(i => i.id === fromId);
    const intoItem = items.find(i => i.id === intoId);
    if (!fromItem || !intoItem) return false;

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

    const merged: GroceryItem = {
      ...intoItem,
      purchaseCount: intoItem.purchaseCount + fromItem.purchaseCount,
      lastAddedAt: laterOf(intoItem.lastAddedAt, fromItem.lastAddedAt),
      lastPurchasedAt: laterOf(intoItem.lastPurchasedAt, fromItem.lastPurchasedAt),
      onHandUntil: laterOf(intoItem.onHandUntil, fromItem.onHandUntil),
      isStaple: intoItem.isStaple || fromItem.isStaple,
      onList,
      checked: onList && (intoItem.checked || fromItem.checked),
      quantity,
      quantityFromRecipe,
      choiceGroup,
      preferredProductId: mergedPreferredProductId,
      ...pickPriceFields(intoItem, fromItem),
    };

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
          priceHistory: mergePriceHistories(survivorLink.priceHistory, loserLink.priceHistory),
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

    dbTransaction(() => {
      dbUpdateGroceryItem(merged);
      // Before the cascade below, which deletes every product still keyed to
      // fromId — re-parenting first is what makes the survivor's copy the one
      // that survives it.
      for (const product of mergedProducts) dbSetItemProduct(product);
      // After the rows exist, and separately from them: `dbSetItemProduct`
      // leaves the column alone (see its note), so a folded row that adopted
      // the loser's barcode needs the claim made by hand. Release-then-claim
      // means the loser still holding it — the cascade below hasn't run yet —
      // is not a conflict.
      for (const product of mergedProducts) {
        if (product.gtin) dbSetProductGtin(product.id, product.gtin);
      }
      for (const link of mergedShopLinks) dbSetItemShopLink(link);
      for (const link of finalRetargetedSubs) dbSetItemSubLink(link);
      // Cascades whatever's left still pointing at fromId — the rows worth
      // keeping were already moved onto intoId above, so this only clears
      // the old fromId-keyed copies and the item row itself.
      dbDeleteGroceryItem(fromId);
    });

    // Recipe ingredients and the remembered aisle are bridged to the catalog
    // by nameKey, exactly like a rename — see renameItem.
    const remembered = renameRememberedAisle(aisleOverrides, fromItem.nameKey, intoItem.nameKey);
    if (remembered) dbSetGroceryAisleOverrides(remembered);
    useRecipeStore.getState().remapIngredientKey(fromItem.nameKey, intoItem.nameKey);

    set(s => ({
      items: [merged, ...s.items.filter(i => i.id !== fromId && i.id !== intoId)],
      itemShops: [
        ...mergedShopLinks,
        ...s.itemShops.filter(l => l.itemId !== fromId && l.itemId !== intoId),
      ],
      itemSubs: [...survivingSubs, ...finalRetargetedSubs],
      // Rebuilt rather than patched: both items' rows are replaced by the
      // folded set, and leaving the loser's behind is how the store came to
      // hold products for an item that no longer exists.
      itemProducts: [
        ...mergedProducts,
        ...s.itemProducts.filter(p => p.itemId !== fromId && p.itemId !== intoId),
      ],
      cartHoldIds: s.cartHoldIds.filter(x => x !== fromId),
      aisleOverrides: remembered ?? s.aisleOverrides,
    }));
    // After the row is gone, not before — same ordering deleteItems uses.
    // fromId's own "Use up X" task would otherwise keep pointing at a
    // catalog row that no longer exists.
    dropUseUpTask(fromId);
    return true;
  },

  setNote(id, note) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    const updated = { ...item, note: note.trim() };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  addProduct(itemId, fields, opts) {
    const item = get().items.find(i => i.id === itemId);
    if (!item) return null;
    const brand = fields.brand?.trim() || null;
    const variant = fields.variant?.trim() || null;
    const ensured = ensureProductFor(itemId, brand, variant, get().itemProducts, new Date().toISOString());
    if (!ensured) return null;
    const product: ItemProduct = ensured.created
      ? { ...ensured.product, note: fields.note?.trim() ?? '', rating: fields.rating ?? null }
      : ensured.product;
    if (ensured.created) dbSetItemProduct(product);
    // No promotion step: the box is itself what keeps the row through
    // clearList's sweep (see hasUserFacts), so naming one can't be undone by
    // an unrelated removal later.
    //
    // See the action's own note for why only the first product becomes the
    // preference, and the `promote` option for who declines even that.
    const preferredProductId = opts?.promote === false
      ? item.preferredProductId
      : item.preferredProductId ?? product.id;
    const updated: GroceryItem = { ...item, preferredProductId };
    dbUpdateGroceryItem(updated);
    set(s => ({
      items: s.items.map(i => (i.id === itemId ? updated : i)),
      itemProducts: ensured.created ? [...s.itemProducts, product] : s.itemProducts,
    }));
    return product;
  },

  updateProduct(id, patch) {
    const product = get().itemProducts.find(p => p.id === id);
    if (!product) return false;
    const brand = patch.brand === undefined ? product.brand : patch.brand?.trim() || null;
    const variant = patch.variant === undefined ? product.variant : patch.variant?.trim() || null;
    const productKey = productKeyFor(brand, variant);
    // A box with no words left is the item itself, so there is nothing to be a
    // product of — refused rather than stored as a blank row that captions
    // nothing. Clearing it properly is `deleteProduct`.
    if (!productKey) return false;
    // The UNIQUE index would throw; refusing here says why, and lets the sheet
    // keep the user's text on screen rather than losing it to an exception.
    const clash = get().itemProducts.some(
      p => p.itemId === product.itemId && p.id !== id && p.productKey === productKey
    );
    if (clash) return false;
    const updated: ItemProduct = {
      ...product,
      brand,
      variant,
      productKey,
      note: patch.note === undefined ? product.note : patch.note.trim(),
      rating: patch.rating === undefined ? product.rating : patch.rating,
    };
    dbSetItemProduct(updated);
    set(s => ({ itemProducts: s.itemProducts.map(p => (p.id === id ? updated : p)) }));
    return true;
  },

  setPreferredProduct(itemId, productId) {
    const item = get().items.find(i => i.id === itemId);
    if (!item) return;
    // Only ever one of this item's own products, so a stale id from a sheet
    // rendered against an older state can't file Bread under a milk product.
    const next = productId && get().itemProducts.some(p => p.id === productId && p.itemId === itemId)
      ? productId
      : null;
    if (next === item.preferredProductId) return;
    // Promoted on setting one, for addProduct's reason above. Clearing the
    // preference promotes nothing, and demoting a row that is already catalog
    // would throw away purchase history over an edit to a caption.
    const updated: GroceryItem = { ...item, preferredProductId: next };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === itemId ? updated : i)) }));
  },

  deleteProduct(id) {
    const product = get().itemProducts.find(p => p.id === id);
    if (!product) return;
    dbDeleteItemProduct(id);
    // Mirrors the cascade dbDeleteItemProduct just ran in SQLite. Written out
    // rather than re-read from the db for the reason every other action here
    // patches in memory: a full reload on a single delete would drop the
    // cart hold and the trip state that only live in this store.
    set(s => ({
      itemProducts: s.itemProducts.filter(p => p.id !== id),
      items: s.items.map(i => (i.preferredProductId === id ? { ...i, preferredProductId: null } : i)),
      itemShops: s.itemShops.map(l => {
        const claimed = l.unavailableProductIds[id] !== undefined;
        if (l.productId !== id && !claimed) return l;
        const unavailableProductIds = { ...l.unavailableProductIds };
        delete unavailableProductIds[id];
        return { ...l, productId: l.productId === id ? null : l.productId, unavailableProductIds };
      }),
    }));
  },

  setProductStrict(id, strict) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    // Promoted like addProduct, and only when switching on: the rule is a
    // standing fact about the item, so it has to outlive this week's list.
    const updated = { ...item, productStrict: strict };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  setProductOnHandUntil(id, until) {
    const product = get().itemProducts.find(p => p.id === id);
    if (!product || product.onHandUntil === until) return;
    const updated: ItemProduct = { ...product, onHandUntil: until };
    dbSetItemProduct(updated);
    set(s => ({ itemProducts: s.itemProducts.map(p => (p.id === id ? updated : p)) }));
  },

  markProductsOutOf(ids) {
    const wanted = new Set(ids);
    const before = get().itemProducts.filter(
      p => wanted.has(p.id) && p.onHandUntil !== OUT_OF_IT_UNTIL
    );
    if (before.length === 0) return 0;
    const updates = before.map((p): ItemProduct => ({ ...p, onHandUntil: OUT_OF_IT_UNTIL }));
    for (const u of updates) dbSetItemProduct(u);
    const byId = new Map(updates.map(u => [u.id, u]));
    set(s => ({ itemProducts: s.itemProducts.map(p => byId.get(p.id) ?? p) }));
    get().setLastAction({
      label: `Out of ${updates.length === 1 ? '1 thing' : `${updates.length} things`}`,
      destructive: true,
      undo: () => {
        for (const row of before) dbSetItemProduct(row);
        const restore = new Map(before.map(p => [p.id, p]));
        set(s => ({ itemProducts: s.itemProducts.map(p => restore.get(p.id) ?? p) }));
      },
    });
    return updates.length;
  },

  setProductFrozen(id, frozen) {
    const product = get().itemProducts.find(p => p.id === id);
    if (!product || !!product.frozenAt === frozen) return;
    const item = get().items.find(i => i.id === product.itemId);
    const now = new Date();
    // The same suspend-then-restart rule setFrozen runs on the item: freezing
    // stamps and leaves the day alone, thawing restarts a whole fresh shelf
    // life rather than resuming what was left. The shelf life is read off the
    // *item* because that's where it lives (shelfLifeDays is a fact about the
    // food, not about which brand of it), and a box with no item to read —
    // impossible in practice, resolve-or-shrug like every pointer here — thaws
    // to no day at all rather than inventing one.
    const updated: ItemProduct = frozen
      ? { ...product, frozenAt: now.toISOString() }
      : { ...product, frozenAt: null, expiresAt: item ? expiresAtForPurchase(item, now) : null };
    dbSetItemProduct(updated);
    set(s => ({ itemProducts: s.itemProducts.map(p => (p.id === id ? updated : p)) }));
  },

  setProductOpened(id, opened) {
    const product = get().itemProducts.find(p => p.id === id);
    if (!product || !!product.openedAt === opened) return;
    const item = get().items.find(i => i.id === product.itemId);
    const now = new Date();
    // Mirrors setOpened: the stamp is recorded whatever the open lexicon knows,
    // and only the *date* is conditional on it knowing this name. Un-marking
    // clears the stamp and leaves the day standing, same as the item's.
    //
    // **The sealed day handed over is this box's, not its item's.**
    // `expiresAtForOpening` takes the earlier of the sealed day and the opened
    // one (#1943), so which sealed day it reads decides the answer — and the
    // packet being opened is the one whose deadline is at stake. Falls back to
    // the item's, which is the same fallback the pantry row reads a box's
    // use-by day through: a packet nobody has dated separately is answerable to
    // the day its purchase set.
    const reDated = opened && item
      ? expiresAtForOpening({ ...item, expiresAt: product.expiresAt ?? item.expiresAt }, now)
      : null;
    const updated: ItemProduct = {
      ...product,
      openedAt: opened ? now.toISOString() : null,
      expiresAt: reDated ?? product.expiresAt,
    };
    dbSetItemProduct(updated);
    set(s => ({ itemProducts: s.itemProducts.map(p => (p.id === id ? updated : p)) }));
  },

  setOnHandUntil(id, until) {
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    const updated = { ...item, onHandUntil: until };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  markOutOfMany(ids, outcome) {
    if (ids.length === 0) return 0;
    const wanted = new Set(ids);
    // Snapshotted before the write, and restored verbatim rather than to null:
    // a row that carried an active "Got it" had an assertion before this, and
    // undo owes it that back rather than the cadence guess.
    const before = get().items.filter(
      i => wanted.has(i.id) && i.onHandUntil !== OUT_OF_IT_UNTIL
    );
    if (before.length === 0) return 0;

    // A caller that already knows how the thing left records it in the same
    // write. The stamp is only ever on the spoiled side — see
    // GroceryItem.lastSpoiledAt.
    const at = new Date().toISOString();
    const updates = before.map((i): GroceryItem => ({
      ...i,
      onHandUntil: OUT_OF_IT_UNTIL,
      usedUpCount: i.usedUpCount + (outcome === 'usedUp' ? 1 : 0),
      spoiledCount: i.spoiledCount + (outcome === 'spoiled' ? 1 : 0),
      lastSpoiledAt: outcome === 'spoiled' ? at : i.lastSpoiledAt,
    }));
    for (const u of updates) dbUpdateGroceryItem(u);
    const byId = new Map(updates.map(u => [u.id, u]));
    set(s => ({ items: s.items.map(i => byId.get(i.id) ?? i) }));

    // One row, and nobody has said how it went: that's the question worth
    // asking, and the only shape it can be asked in. A batch gets no offer —
    // see the action's doc comment.
    if (!outcome && updates.length === 1) {
      set({ disposalOffer: { itemId: updates[0].id, stage: 'ask' } });
    }

    get().setLastAction({
      label: `Marked ${updates.length} ${updates.length === 1 ? 'thing' : 'things'} out`,
      destructive: true,
      undo: () => {
        for (const b of before) dbUpdateGroceryItem(b);
        const originalById = new Map(before.map(b => [b.id, b]));
        // The offer goes with it. It's a question about a row leaving the
        // pantry, and undoing that is the answer "it didn't" — leaving it up
        // would ask how something went that is, as of now, still there.
        set(s => ({ items: s.items.map(i => originalById.get(i.id) ?? i), disposalOffer: null }));
      },
    });
    return updates.length;
  },

  recordDisposal(itemId, outcome) {
    const item = get().items.find(i => i.id === itemId);
    if (!item) {
      set({ disposalOffer: null });
      return;
    }
    const updated: GroceryItem = {
      ...item,
      usedUpCount: item.usedUpCount + (outcome === 'usedUp' ? 1 : 0),
      spoiledCount: item.spoiledCount + (outcome === 'spoiled' ? 1 : 0),
      lastSpoiledAt: outcome === 'spoiled' ? new Date().toISOString() : item.lastSpoiledAt,
    };
    dbUpdateGroceryItem(updated);
    // The prompt is judged on the row as it stands *after* the answer, which is
    // what makes it a reaction rather than a banner that could go stale. An
    // answer that isn't the second waste just closes the question.
    set(s => ({
      items: s.items.map(i => (i.id === itemId ? updated : i)),
      disposalOffer:
        outcome === 'spoiled' && wantsShelfLifePrompt(updated)
          ? { itemId, stage: 'shelfLife' }
          : null,
    }));
  },

  addToPantry(raw, opts) {
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
        onHandUntil: defaultOnHandUntil(existing, now),
      };
      dbUpdateGroceryItem(updated);
      set(s => ({ items: s.items.map(i => (i.id === existing.id ? updated : i)) }));
      const undo = () => {
        dbUpdateGroceryItem(existing);
        set(s => ({ items: s.items.map(i => (i.id === existing.id ? existing : i)) }));
      };
      if (opts?.registerUndo !== false) {
        get().setLastAction({ label: `Added "${updated.name}" to the pantry`, undo });
      }
      opts?.onUndo?.(undo);
      return updated;
    }

    const row = newItemRow({
      name: trimmed,
      nameKey: key,
      aisle: placeAisle(get().aisleOverrides[key] ?? aisleForName(trimmed), get().aisleOrder),
      // Off the list from the first moment: naming something you already own
      // is not adding it to this week's shopping.
      onList: false,
      sortOrder: nextSortOrder(get().items),
      createdAt: nowIso,
    });
    // Stamped off the finished row rather than a literal fortnight, so this
    // and "Got it" can't drift — with no purchases yet it lands on the same
    // default, and it'll follow the item's own cadence once there are some.
    const item: GroceryItem = { ...row, onHandUntil: defaultOnHandUntil(row, now) };
    dbInsertGroceryItem(item);
    set(s => ({ items: [...s.items, item] }));
    const undo = () => get().deleteItem(item.id);
    if (opts?.registerUndo !== false) {
      get().setLastAction({ label: `Added "${item.name}" to the pantry`, undo });
    }
    opts?.onUndo?.(undo);
    return item;
  },

  addManyToPantry(names, frozenNames, products, prices) {
    const addedIds: string[] = [];
    const revertRows: GroceryItem[] = [];
    const gtinLinks: ScannedGtinLink[] = [];
    let count = 0;
    for (const raw of names) {
      const key = groceryNameKey(parseGroceryInput(raw).name);
      const before = key ? get().items.find(i => i.nameKey === key) : undefined;
      const item = get().addToPantry(raw, { registerUndo: false });
      if (!item) continue;
      count++;
      if (before) revertRows.push(before);
      else addedIds.push(item.id);
      // Captured before this row's own write, so undo's restore of `before`
      // (or delete of a fresh row) already reverts the freeze along with it —
      // no separate bookkeeping needed for this half of the batch.
      if (frozenNames?.has(raw)) get().setFrozen(item.id, true);
      // Same reasoning: not part of the undo snapshot, matching addProduct's
      // own callers everywhere else — a box named is never itself undoable.
      const product = products?.get(raw);
      if (product && (product.brand || product.variant)) {
        get().addProduct(item.id, { brand: product.brand, variant: product.variant });
      }
      // Only for a row this loop just minted (`!before`) — a found row already
      // has a filed aisle, and the barcode's read of the source is not grounds
      // to move it. `rememberedAisleFor` outranks it for the same reason it
      // outranks `addToPantry`'s own lexicon guess: a user's own correction
      // beats what a scan just read off the box.
      if (!before && product?.aisle && !get().rememberedAisleFor(raw)) {
        get().setAisle(item.id, product.aisle);
      }
      // Same reasoning as the box above, and the same key: this is the only
      // point at which a name minted by this batch has an id to put a price on.
      const priceMinor = prices?.byName.get(raw);
      if (priceMinor !== undefined) get().setItemPrice(item.id, priceMinor, prices?.shopId ?? null);
      // Collected rather than written here: the link resolves a box by its key,
      // so every addProduct in this batch has to have landed first.
      if (product?.gtin) {
        gtinLinks.push({
          gtin: product.gtin,
          itemId: item.id,
          brand: product.brand,
          variant: product.variant,
        });
      }
    }
    get().linkScannedGtins(gtinLinks);
    // One combined undo for the whole scan session rather than addToPantry's
    // per-call one, which the loop above suppresses — see addManyFromText.
    if (count > 0) {
      get().setLastAction({
        label: `${count} ${count === 1 ? 'item' : 'items'} added to the pantry`,
        undo: () => {
          for (const b of revertRows) dbUpdateGroceryItem(b);
          const revertById = new Map(revertRows.map(b => [b.id, b]));
          set(s => ({
            items: s.items
              .filter(i => !addedIds.includes(i.id))
              .map(i => revertById.get(i.id) ?? i),
          }));
        },
      });
    }
    return count;
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

  setFrozen(id, frozen) {
    const item = get().items.find(i => i.id === id);
    if (!item || !!item.frozenAt === frozen) return;
    const now = new Date();
    const updated: GroceryItem = frozen
      ? { ...item, frozenAt: now.toISOString() }
      // The thaw is the only half that writes a date, and it writes today's:
      // see setFrozen's note on the interface above.
      : { ...item, frozenAt: null, expiresAt: expiresAtForPurchase(item, now) };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
    // Both directions reconcile, and they do opposite things: freezing drops a
    // use-up task that's now about food under ice, thawing spawns the one the
    // fresh date earns. Neither is a special case in reconcileUseUpTask — it
    // reads liveExpiresAt and gets the right answer both ways.
    reconcileUseUpTask(updated);
  },

  setOpened(id, opened) {
    const item = get().items.find(i => i.id === id);
    if (!item || !!item.openedAt === opened) return;
    const now = new Date();
    const reDated = opened ? expiresAtForOpening(item, now) : null;
    const updated: GroceryItem = {
      ...item,
      openedAt: opened ? now.toISOString() : null,
      // `?? item.expiresAt` is doing the work: a name the open lexicon has
      // never heard of is still recorded as opened, it just keeps the day its
      // purchase gave it. Opening a bag of spinach is a true fact about the bag
      // and a lie about its shelf life.
      expiresAt: reDated ?? item.expiresAt,
    };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
    // The new day may be sooner or later than the old one, so this both spawns
    // and re-dates: an opened jar that was written off weeks ago gets a real
    // task back, which is the case the lexicon pairing exists for.
    reconcileUseUpTask(updated);
  },

  markOpenedMany(ids, at) {
    if (ids.length === 0) return 0;
    const wanted = new Set(ids);
    // Already-open rows are dropped here rather than rewritten — see the
    // action's doc comment. `openedAt` is when it was first opened, and a
    // second cook out of the same jar doesn't restart its clock.
    const before = get().items.filter(i => wanted.has(i.id) && !i.openedAt);
    if (before.length === 0) return 0;

    const when = at ?? new Date();
    const stamp = when.toISOString();
    const updates = before.map((i): GroceryItem => ({
      ...i,
      openedAt: stamp,
      // `?? i.expiresAt` for setOpened's reason: a name the open lexicon has
      // never heard of is still recorded as opened, it just keeps the day its
      // purchase gave it.
      expiresAt: expiresAtForOpening(i, when) ?? i.expiresAt,
    }));
    for (const u of updates) dbUpdateGroceryItem(u);
    const byId = new Map(updates.map(u => [u.id, u]));
    set(s => ({ items: s.items.map(i => byId.get(i.id) ?? i) }));
    // Same both-directions reconcile a single opening does: the new day can be
    // sooner or later than the old one, so this spawns and re-dates.
    updates.forEach(reconcileUseUpTask);
    return updates.length;
  },

  setRunningLow(id, low) {
    const item = get().items.find(i => i.id === id);
    if (!item || !!item.runningLowAt === low) return;
    const wasOnList = item.onList;
    const updated: GroceryItem = {
      ...item,
      runningLowAt: low ? new Date().toISOString() : null,
      // One direction only — see the note on the interface above.
      onList: low ? true : item.onList,
      // A row put on the list by this needs a slot on it; one already there
      // keeps the slot it had.
      sortOrder: low && !wasOnList ? nextSortOrder(get().items) : item.sortOrder,
      lastAddedAt: low && !wasOnList ? new Date().toISOString() : item.lastAddedAt,
    };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
    if (low && !wasOnList) {
      get().setLastAction({
        label: `Added "${updated.name}" to the list`,
        undo: () => {
          dbUpdateGroceryItem(item);
          set(s => ({ items: s.items.map(i => (i.id === id ? item : i)) }));
        },
      });
    }
  },

  setShelfLifeDays(id, days) {
    const item = get().items.find(i => i.id === id);
    if (!item || item.shelfLifeDays === days) return;
    const updated = { ...item, shelfLifeDays: days };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
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
   * Records that a pantry check for this row was turned down — the opt-out
   * `deleteTask` writes when the user swipes one away, and the null it writes
   * back on an undo. See `GroceryItem.pantryCheckDeclinedAt`.
   *
   * No reconcile: this generator's rows are decided over the whole catalog at
   * once by `checkPantryCheckTasks`, and the task this is about has just been
   * deleted by the caller anyway.
   */
  setPantryCheckDeclinedAt(id, value) {
    const item = get().items.find(i => i.id === id);
    if (!item || item.pantryCheckDeclinedAt === value) return;
    const updated = { ...item, pantryCheckDeclinedAt: value };
    dbUpdateGroceryItem(updated);
    set(s => ({ items: s.items.map(i => (i.id === id ? updated : i)) }));
  },

  /**
   * Ticking one option of an either/or takes the others off the list — "apples
   * or pears", you picked apples.
   *
   * The losers park off-list rather than being deleted. They used to be deleted
   * when provisional, which made resolving a choice a destructive act on a row
   * you'd said nothing about wanting to lose; parking says the same thing
   * ("not this one") without needing to be undone to get it back.
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
    const toUnlist = losers.map(i => ({ ...i, onList: false, checked: false, choiceGroup: null }));

    dbUpdateGroceryItem(winner);
    for (const u of toUnlist) dbUpdateGroceryItem(u);
    const patched = new Map<string, GroceryItem>([[winner.id, winner], ...toUnlist.map(
      u => [u.id, u] as [string, GroceryItem]
    )]);
    set(s => ({ items: s.items.map(i => patched.get(i.id) ?? i) }));

    get().setLastAction({
      label: `Chose ${item.name}`,
      // Still bar-worthy, though nothing is deleted any more: one tick takes
      // every other option off the list at once, and that's the "what just
      // happened" the bar exists for. See UndoableAction.destructive.
      destructive: true,
      undo: () => {
        for (const row of before) dbUpdateGroceryItem(row);
        const byId = new Map(before.map(i => [i.id, i]));
        set(s => ({
          items: s.items.map(i => byId.get(i.id) ?? i),
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
    // Parks, never deletes. "Remove from list" used to delete a row that had
    // never been bought, which is how an assertion made on the item — a
    // substitute, a store, a brand — could be destroyed by an action about
    // this week's shopping. See hasUserFacts.
    //
    // Taking the row off the list ends that shop's claim just as finishing
    // does — see GroceryItem.quantityFromRecipe.
    const updated = {
      ...item,
      onList: false,
      checked: false,
      quantity: item.quantityFromRecipe ? null : item.quantity,
      quantityFromRecipe: false,
    };
    dbUpdateGroceryItem(updated);
    set(s => ({
      items: s.items.map(i => (i.id === id ? updated : i)),
      cartHoldIds: s.cartHoldIds.filter(x => x !== id),
    }));
  },

  removeFromListMany(ids) {
    if (ids.length === 0) return;
    const wanted = new Set(ids);
    const toUpdate: GroceryItem[] = [];
    for (const item of get().items) {
      if (!wanted.has(item.id) || !item.onList) continue;
      // Parks every row, same as removeFromList.
      toUpdate.push({
        ...item,
        onList: false,
        checked: false,
        quantity: item.quantityFromRecipe ? null : item.quantity,
        quantityFromRecipe: false,
      });
    }
    if (toUpdate.length === 0) return;

    for (const u of toUpdate) dbUpdateGroceryItem(u);
    const byId = new Map(toUpdate.map(u => [u.id, u]));
    set(s => ({
      items: s.items.map(i => byId.get(i.id) ?? i),
      cartHoldIds: s.cartHoldIds.filter(x => !byId.has(x)),
    }));
  },

  /**
   * The one real delete, and the only way a row with anything on it ever
   * leaves. There is no undo, so every caller confirms first.
   */
  deleteItem(id) {
    get().deleteItems([id]);
  },

  deleteItems(ids) {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    // dbDeleteGroceryItem drops the item's shop and substitute links too;
    // mirror that here so the in-memory copy doesn't keep links to an item
    // that's gone. Substitutes are dropped from *both* sides, since the link is
    // directional and the deleted row can be either half of a pair.
    for (const id of ids) dbDeleteGroceryItem(id);
    set(s => ({
      items: s.items.filter(i => !gone.has(i.id)),
      itemShops: s.itemShops.filter(l => !gone.has(l.itemId)),
      itemSubs: s.itemSubs.filter(l => !gone.has(l.itemId) && !gone.has(l.subItemId)),
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

  finishShopping(shopId = null, priceById = {}, purchasedAt = new Date().toISOString(), frozenIds) {
    const now = new Date(purchasedAt);
    // A shop deleted between opening the finish sheet and confirming it would
    // otherwise write links nothing can resolve.
    const shop = shopId ? get().shops.find(s => s.id === shopId) ?? null : null;
    // The use-by day for everything in the trolley the shelf-life lexicon
    // recognises — which is a minority of any real list, and meant to be (see
    // groceryShelfLife.ts). Every purchase re-stamps rather than keeping
    // whatever was there: a second bag of spinach is fresh spinach, and
    // inheriting the old bag's day would have the app nagging about food
    // bought this afternoon.
    const expiresAtById: Record<string, string> = {};
    for (const i of get().items) {
      if (!i.checked || !i.onList) continue;
      const expires = expiresAtForPurchase(i, now);
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
    // Snapshotted before anything is written, so undo restores the rows
    // themselves rather than reconstructing what they probably were — same
    // discipline resolveChoice/clearList already follow. Every row
    // dbFinishGroceryShopping touches still exists afterward — buying
    // something never removes its row — so there's no "revive a deleted row"
    // branch to carry over from clearList's undo.
    const beforeItems = get().items;
    const beforeItemShops = get().itemShops;
    const beforeLastShopId = get().lastShopId;
    const ids = dbFinishGroceryShopping(
      purchasedAt,
      shop?.id ?? null,
      expiresAtById,
      priceById,
      frozenIds ?? new Set()
    );
    if (ids.length === 0) return 0;
    const done = new Set(ids);
    const before = beforeItems.filter(i => done.has(i.id));
    // Same snapshot for the boxes this trip credits. Keyed by product id, and
    // only the preferred ones — the set dbFinishGroceryShopping touches.
    const beforeProducts = new Map(
      get()
        .itemProducts.filter(p => {
          const item = before.find(i => i.id === p.itemId);
          return item?.preferredProductId === p.id;
        })
        .map((p): [string, ItemProduct] => [p.id, p])
    );
    // Only this shop's links are ever touched below, bumped or newly minted —
    // an untouched shop's links need no snapshot to put back.
    const beforeLinks = new Map(
      shop
        ? beforeItemShops
            .filter(l => l.shopId === shop.id && done.has(l.itemId))
            .map((l): [string, ItemShopLink] => [l.itemId, l])
        : []
    );

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
              // An unpriced row records no observation, for the same reason it
              // leaves the last price standing: this trip said nothing about
              // what it costs.
              priceHistory: existing?.priceHistory ?? [],
            };
          }
          const quantity = pricedQuantityById.get(id) ?? null;
          return {
            lastPriceMinor: minor,
            lastPricedAt: purchasedAt,
            lastPriceQuantity: quantity,
            // Mirrors the append dbFinishGroceryShopping just made against the
            // same row — the patch and the write have to agree, or the window
            // shifts under the next read.
            priceHistory: appendPriceObservation(existing?.priceHistory ?? [], {
              minor, quantity, at: purchasedAt,
              // The same stamp the db writes — see PriceObservation.productId.
              // Read off the row rather than passed in, so the patch can't
              // disagree with the write about which box this price was for.
              productId: s.items.find(i => i.id === id)?.preferredProductId ?? null,
            }),
          };
        };
        // What this trip is entitled to record about which one they stock.
        // **Only for a strict item**, and that restriction is the whole
        // argument: strict means the user would not have bought a substitute,
        // so a purchase here really is evidence this store had the box they
        // want. On an item with no rule, the same purchase says nothing about
        // which one came home, and stamping it would manufacture the per-store
        // evidence this feature is supposed to be waiting for. Mirrors
        // dbFinishGroceryShopping.
        const productPatch = (id: string, existing: ItemShopLink | null) => {
          const item = s.items.find(i => i.id === id);
          if (item?.productStrict && item.preferredProductId) return { productId: item.preferredProductId };
          return { productId: existing?.productId ?? null };
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
                  // Coming home with something refutes every "they haven't got
                  // this one" about this store at once, exactly as the purchase
                  // refutes the item-level negative above. Mirrors
                  // dbFinishGroceryShopping.
                  unavailableProductIds: {},
                  ...pricePatch(l.itemId, l),
                  ...productPatch(l.itemId, l),
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
              unavailableProductIds: {},
              ...pricePatch(id, null),
              ...productPatch(id, null),
            })),
        ];
      }

      // The box that actually came home, mirroring the UPDATE
      // dbFinishGroceryShopping just ran on it. Patched in memory rather than
      // left for the next load, which is what the purchase counters here used
      // to settle for: these four columns now decide whether a box appears in
      // the pantry at all, so a freezer claim about the *previous* packet
      // surviving in state would keep a stale row on the Pantry screen for the
      // rest of the session. Preferred-only, exactly like the db — a trip that
      // bought an item with no preference says nothing about which box it was.
      const boughtProductIds = new Set(
        before
          .map(i => i.preferredProductId)
          .filter((id): id is string => id !== null)
      );

      return {
        itemProducts: s.itemProducts.map(p =>
          boughtProductIds.has(p.id)
            ? {
                ...p,
                purchaseCount: p.purchaseCount + 1,
                lastPurchasedAt: purchasedAt,
                onHandUntil: null,
                expiresAt: null,
                frozenAt: null,
                openedAt: null,
              }
            : p
        ),
        items: s.items.map(i =>
          done.has(i.id)
            ? {
                ...i,
                onList: false,
                checked: false,
                purchaseCount: i.purchaseCount + 1,
                lastPurchasedAt: purchasedAt,
                // Cleared, not written: probablyHaveReason reads the purchase
                // itself (#1770), and the one thing a trip has to say about
                // this column is that coming home with something refutes an
                // "Out of it" sitting on it. Mirrors dbFinishGroceryShopping.
                onHandUntil: null,
                // Cleared for the same reason and in the same breath: the old
                // freezer claim was about the bag you had, and you have just
                // come home with a new one. Leaving it would suspend the fresh
                // `expiresAt` being stamped right below, so the new bag would
                // inherit "in the freezer" and never count down. `frozenIds`
                // is a *fresh* claim about this exact bag — the scan sheet's
                // own toggle, made this trip — so it wins over the clear
                // rather than fighting it.
                frozenAt: frozenIds?.has(i.id) ? purchasedAt : null,
                // Same again: the jar you opened is not the jar in the bag you
                // just carried home, and a fresh one is sealed.
                openedAt: null,
                // And you are no longer nearly out of the thing you have just
                // bought — the purchase is what refutes it, exactly as it
                // refutes an "Out of it".
                runningLowAt: null,
                expiresAt: expiresAtById[i.id] ?? i.expiresAt,
                // Mirrors the db's own CASE: the shop it was for has happened,
                // so a recipe-owned quantity doesn't outlive it. A hand-set one
                // survives untouched.
                quantity: i.quantityFromRecipe ? null : i.quantity,
                quantityFromRecipe: false,
                // Only the rows the user priced. Everything else keeps the
                // price and the stamp it already had — see the db's own note.
                ...(priceById[i.id] !== undefined
                  ? {
                      lastPriceMinor: priceById[i.id],
                      lastPricedAt: purchasedAt,
                      lastPriceQuantity: i.quantity,
                      // Same append the db just made at the item level. An
                      // unpriced row falls through and keeps the run it had.
                      priceHistory: appendPriceObservation(i.priceHistory, {
                        minor: priceById[i.id], quantity: i.quantity, at: purchasedAt,
                        productId: i.preferredProductId,
                      }),
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
    // task with it. Soonest-expiring first, so a trip that re-dates more
    // items than the use-up cap has room for spends what's open on the ones
    // that actually go off soonest (#1675) rather than on whichever happened
    // to sort earliest in the cart.
    const soonestFirst = Object.keys(expiresAtById).sort(
      (a, b) => expiresAtById[a].localeCompare(expiresAtById[b])
    );
    for (const id of soonestFirst) {
      const item = get().items.find(i => i.id === id);
      if (item) reconcileUseUpTask(item);
    }

    get().setLastAction({
      label: `Bought ${ids.length} ${ids.length === 1 ? 'thing' : 'things'}`,
      destructive: true,
      undo: () => {
        for (const row of before) dbUpdateGroceryItem(row);
        const byId = new Map(before.map(i => [i.id, i]));
        // The bought boxes go back whole — counters and pantry claims alike —
        // from the snapshot taken before the trip, the same discipline the item
        // rows above follow rather than reconstructing what they probably were.
        for (const row of beforeProducts.values()) dbSetItemProduct(row);
        if (shop) {
          // A link this trip bumped goes back to its old counts; one this
          // trip minted outright never existed before it, so it's deleted
          // rather than "restored" to a row that was never there.
          for (const id of done) {
            const old = beforeLinks.get(id);
            if (old) dbSetItemShopLink(old);
            else dbDeleteItemShopLink(id, shop.id);
          }
          dbSetLastShopId(beforeLastShopId);
        }
        set(s => ({
          items: s.items.map(i => byId.get(i.id) ?? i),
          itemProducts: s.itemProducts.map(p => beforeProducts.get(p.id) ?? p),
          itemShops: shop
            ? [
                ...s.itemShops.filter(l => !(l.shopId === shop.id && done.has(l.itemId))),
                ...beforeLinks.values(),
              ]
            : s.itemShops,
          lastShopId: shop ? beforeLastShopId : s.lastShopId,
        }));
        // Re-derive each use-up task against the item as it now stands — the
        // same call finishShopping itself makes above, so an undo that
        // reverts expiresAt reverts (or drops) the task spawned for it.
        for (const id of Object.keys(expiresAtById)) {
          const restored = byId.get(id);
          if (restored) reconcileUseUpTask(restored);
        }
      },
    });

    return ids.length;
  },

  clearList() {
    const before = get().items;
    const ids = dbClearGroceryList();
    if (ids.length === 0) return 0;
    const cleared = new Set(ids);
    // Deliberately no purchaseCount bump: nothing was bought, and inflating
    // the ranking signal would teach autocomplete a lie.
    //
    // **The one place a row still leaves altogether**, and the only caller of
    // hasUserFacts. "I'm not doing this trip after all" is a statement about
    // the whole list at once, so a row that was never anything but a line of
    // it goes with it — but a row carrying anything the user put there stays,
    // whether or not it was ever bought. That's the half the old `inCatalog`
    // flag got wrong: a name typed to hold a substitute had no purchases, so
    // abandoning an unrelated trip destroyed it.
    const relations = {
      products: get().itemProducts,
      subs: get().itemSubs,
      shops: get().itemShops,
      aliases: get().storeAliases,
    };
    const deleted = before.filter(i => cleared.has(i.id) && !hasUserFacts(i, relations));
    const deletedIds = new Set(deleted.map(i => i.id));
    for (const id of deletedIds) dbDeleteGroceryItem(id);
    const parked = before.filter(i => cleared.has(i.id) && !deletedIds.has(i.id));
    set(s => ({
      items: s.items
        .filter(i => !deletedIds.has(i.id))
        .map(i => (cleared.has(i.id) ? { ...i, onList: false, checked: false } : i)),
      cartHoldIds: [],
    }));
    // A trip whose list just went away is over. The other terminator is
    // finishing a shop, which lives in the screen's handler rather than in
    // finishShopping — that one early-returns on an empty trolley, and ending
    // the trip must not be conditional on having bought something.
    get().endTrip();
    get().setLastAction({
      label: 'Cleared the list',
      destructive: true,
      // No links to put back: a row this swept had none, or hasUserFacts would
      // have kept it. Re-inserting the rows is the whole restore.
      undo: () => {
        const parkedById = new Map(parked.map(item => [item.id, item]));
        deleted.forEach(item => dbInsertGroceryItem(item));
        parked.forEach(item => dbUpdateGroceryItem(item));
        set(s => ({
          items: [...s.items.map(i => parkedById.get(i.id) ?? i), ...deleted],
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
      // Nothing infers this. An ordinary receipt is the default, and a store
      // that prints a bad one is something only the user can tell us.
      receiptStyle: 'itemized',
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
    if (wasTrip) cancelTripReminder();
  },

  setShopExcludedFromSuggestions(id, excluded) {
    const shop = get().shops.find(s => s.id === id);
    if (!shop) return;
    dbSetShopExcludeFromSuggestions(id, excluded);
    set(s => ({
      shops: s.shops.map(x => (x.id === id ? { ...x, excludeFromSuggestions: excluded } : x)),
    }));
  },

  setShopReceiptStyle(id, style) {
    dbSetShopReceiptStyle(id, style);
    set(s => ({ shops: s.shops.map(sh => (sh.id === id ? { ...sh, receiptStyle: style } : sh)) }));
  },

  rememberAliases(drafts) {
    const worth = aliasDraftsFrom(drafts);
    if (worth.length === 0) return;
    const now = new Date().toISOString();
    const existing = get().storeAliases;
    const written: StoreAlias[] = [];

    dbTransaction(() => {
      for (const draft of worth) {
        const shopId = draft.shopId ?? '';
        const rawKey = aliasKeyFor(draft.rawText);
        const prior = existing.find(a => a.shopId === shopId && a.rawKey === rawKey);
        // The row handed to the db is the one that should exist afterwards; the
        // upsert bumps the count itself, since only SQLite knows whether the
        // pair was already there. Same contract dbSetItemProduct has.
        const row: StoreAlias = {
          id: prior?.id ?? generateId(),
          shopId,
          rawKey,
          itemId: draft.itemId,
          hitCount: prior ? prior.hitCount + 1 : 1,
          createdAt: prior?.createdAt ?? now,
          lastUsedAt: now,
        };
        dbSetStoreAlias(row);
        written.push(row);
      }
    });

    set(s => ({
      storeAliases: [
        ...s.storeAliases.filter(
          a => !written.some(w => w.shopId === a.shopId && w.rawKey === a.rawKey)
        ),
        ...written,
      ],
    }));
  },

  aliasItemFor(shopId, rawText) {
    const itemId = aliasItemIdFor(get().storeAliases, shopId, rawText);
    // Resolve-or-shrug, like every cross-row pointer here. A cascade clears
    // aliases when an item is deleted, so this should not happen — but a reader
    // that leaned on that would turn a stale row into a line that resolves to
    // nothing *and* suppresses the name match that would have found the answer.
    return itemId && get().items.some(i => i.id === itemId) ? itemId : null;
  },

  linkScannedGtins(links) {
    if (links.length === 0) return;
    const { items, itemProducts } = get();
    const claimed: Array<{ productId: string; gtin: string }> = [];
    const aliasDrafts: AliasDraft[] = [];

    for (const link of links) {
      if (!link.gtin || !items.some(i => i.id === link.itemId)) continue;
      // Found by the words the scan resolved to rather than by id, because the
      // caller knows which box it read and `addProduct` knows which one exists
      // — the same find-by-key `ensureProductFor` does one step earlier.
      const productKey = productKeyFor(link.brand, link.variant);
      const product = productKey
        ? itemProducts.find(p => p.itemId === link.itemId && p.productKey === productKey)
        : undefined;
      if (product) claimed.push({ productId: product.id, gtin: link.gtin });
      // Written whether or not a box was found. The two are different facts and
      // the item-level one is the durable half: deleting a box should send the
      // barcode back to naming its row, not to naming nothing.
      aliasDrafts.push({ shopId: null, rawText: gtinAliasText(link.gtin), itemId: link.itemId });
    }

    if (claimed.length > 0) {
      dbTransaction(() => {
        for (const { productId, gtin } of claimed) dbSetProductGtin(productId, gtin);
      });
      set(s => ({
        itemProducts: s.itemProducts.map(p => {
          const claim = claimed.find(c => c.productId === p.id);
          if (claim) return { ...p, gtin: claim.gtin };
          // Mirrors the release half of the write: a box that held one of these
          // barcodes has just lost it, and leaving the old value in memory
          // would have two rows claiming one code until the next reload.
          return p.gtin && claimed.some(c => c.gtin === p.gtin) ? { ...p, gtin: null } : p;
        }),
      }));
    }
    // Through the ordinary alias path, so the hit count, the stamps and the
    // one-write-per-phrase rule are the same ones a receipt gets.
    get().rememberAliases(aliasDrafts);
  },

  gtinItemFor(gtin) {
    if (!gtin) return null;
    // Box first: it is the more specific claim, and the only one that can also
    // say which brand and variant. The alias is what answers for a row that
    // never had a box worth naming.
    const product = productForGtin(get().itemProducts, gtin);
    if (product && get().items.some(i => i.id === product.itemId)) return product.itemId;
    return get().aliasItemFor(null, gtinAliasText(gtin));
  },

  gtinProductFor(gtin) {
    const product = productForGtin(get().itemProducts, gtin);
    // Resolve-or-shrug, same as preferredProductOf: a box whose item has gone
    // reads as no answer rather than as a pointer into nothing.
    return product && get().items.some(i => i.id === product.itemId) ? product : null;
  },

  linkItemShop(itemId, shopId) {
    get().linkItemShopMany([itemId], shopId);
  },

  linkItemShopMany(itemIds, shopId) {
    const { items, shops, itemShops } = get();
    if (!shops.some(s => s.id === shopId)) return;

    const links: ItemShopLink[] = [];
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
        // statement about which one they stock. That's finishShopping's to
        // record, off a purchase.
        productId: existing?.productId ?? null,
        // Carried, not cleared: saying you can get it here is not a statement
        // about which box, so it neither makes nor withdraws those claims.
        unavailableProductIds: existing?.unavailableProductIds ?? {},
        lastPriceMinor: existing?.lastPriceMinor ?? null,
        lastPricedAt: existing?.lastPricedAt ?? null,
        lastPriceQuantity: existing?.lastPriceQuantity ?? null,
        // An availability claim is not a purchase, so it records no
        // observation — it just doesn't throw away the ones already there.
        priceHistory: existing?.priceHistory ?? [],
      };
      dbSetItemShopLink(link);
      links.push(link);
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
    }));
  },

  unlinkItemShop(itemId, shopId) {
    dbDeleteItemShopLink(itemId, shopId);
    set(s => ({
      itemShops: s.itemShops.filter(l => !(l.itemId === itemId && l.shopId === shopId)),
    }));
  },

  linkItemSub(itemId, subItemId, opts = {}) {
    // An item is not a substitute for itself, and the picker can't be trusted
    // to have excluded it — the sheet is opened from a row and the catalog
    // search is over every row there is.
    if (itemId === subItemId) return;
    const { items, itemSubs } = get();
    const item = items.find(i => i.id === itemId);
    const sub = items.find(i => i.id === subItemId);
    if (!item || !sub) return;

    const note = opts.note?.trim() || null;
    // Both or neither — a ratio typed on only one side isn't a ratio; see
    // ItemSubLink.ratioFrom.
    const ratioFrom = opts.ratioFrom?.trim() || null;
    const ratioTo = opts.ratioTo?.trim() || null;
    const hasRatio = !!ratioFrom && !!ratioTo;

    const standing = !!opts.standing;

    const createdAt = new Date().toISOString();
    // [itemId, subItemId, ratioFrom, ratioTo, standing] per row written. The
    // reverse row's ratio is the forward one **swapped**: it describes the
    // other item's own unit on its own left, or a both-ways
    // garlic↔garlic-powder link would have the reverse row claiming a clove
    // converts to a clove.
    const pairs: Array<[string, string, string | null, string | null, boolean]> = [
      [itemId, subItemId, hasRatio ? ratioFrom : null, hasRatio ? ratioTo : null, standing],
    ];
    // The reverse row carries the same note: a caveat about how far the swap
    // goes ("fine for frying, not for baking") is a fact about the pair, not
    // about the direction you happened to write it from. It is never standing,
    // though, whatever the forward row says: "always use oat milk for milk" is
    // not also "always use milk for oat milk", and a pair pointing at each
    // other is a rule that swaps into itself (see standingSwaps.ts).
    if (opts.bothWays) {
      pairs.push([subItemId, itemId, hasRatio ? ratioTo : null, hasRatio ? ratioFrom : null, false]);
    }

    const written: ItemSubLink[] = [];
    for (const [a, b, rFrom, rTo, isStanding] of pairs) {
      const existing = itemSubs.find(l => l.itemId === a && l.subItemId === b);
      // Re-linking an existing pair is an edit of its note (and ratio), so the
      // original createdAt is kept: that stamp is what orders the list, and
      // re-ticking "both ways" must not shuffle a row the user arranged by
      // hand.
      const link: ItemSubLink = {
        itemId: a,
        subItemId: b,
        note,
        createdAt: existing?.createdAt ?? createdAt,
        ratioFrom: rFrom,
        ratioTo: rTo,
        standing: isStanding,
      };
      dbSetItemSubLink(link);
      written.push(link);
    }

    // One standing answer per item, and no pair pointing at each other. Both
    // are cleared here rather than refused, because the user just said which
    // one they mean — see standingSwaps.ts for what the alternative states
    // would do to a read.
    const cleared = standing ? clearOtherStandingLinks(itemSubs, itemId, subItemId) : [];
    for (const link of cleared) dbSetItemSubLink(link);

    const key = (l: { itemId: string; subItemId: string }) => `${l.itemId}|${l.subItemId}`;
    const byKey = new Map([...cleared, ...written].map(l => [key(l), l]));
    set(s => ({
      itemSubs: [
        ...s.itemSubs.map(l => byKey.get(key(l)) ?? l),
        ...written.filter(l => !s.itemSubs.some(x => key(x) === key(l))),
      ],
    }));
  },

  ensureCatalogItem(raw) {
    // Parsed like every other typed name, so "2 lb margarine" keys on
    // "margarine" rather than minting a row no purchase can ever match. The
    // quantity is dropped: this is a name being named, not an amount to buy.
    const { name } = parseGroceryInput(raw);
    const trimmed = name.trim();
    if (!trimmed) return null;
    // Same fallback addByName and addToPantry make for a name that normalises
    // away ("???"): the key has to stay unique or the second such row collides
    // on the index.
    const key = groceryNameKey(trimmed) || trimmed.toLowerCase();
    const existing = get().items.find(i => i.nameKey === key);
    if (existing) return existing;

    const nowIso = new Date().toISOString();
    const item = newItemRow({
      name: trimmed,
      nameKey: key,
      aisle: placeAisle(get().aisleOverrides[key] ?? aisleForName(trimmed), get().aisleOrder),
      onList: false,
      sortOrder: nextSortOrder(get().items),
      createdAt: nowIso,
    });
    dbInsertGroceryItem(item);
    set(s => ({ items: [...s.items, item] }));
    return item;
  },

  unlinkItemSub(itemId, subItemId) {
    // One direction only. "Margarine instead of butter" going away is not the
    // user withdrawing "butter instead of margarine" — they're two claims, and
    // the reverse one is shown on its own item's sheet where it can be taken
    // back in its own right.
    dbDeleteItemSubLink(itemId, subItemId);
    set(s => ({
      itemSubs: s.itemSubs.filter(l => !(l.itemId === itemId && l.subItemId === subItemId)),
    }));
  },

  setItemSubStanding(itemId, subItemId, standing) {
    const { itemSubs } = get();
    const link = itemSubs.find(l => l.itemId === itemId && l.subItemId === subItemId);
    if (!link || link.standing === standing) return;
    const next: ItemSubLink = { ...link, standing };
    dbSetItemSubLink(next);
    const cleared = standing ? clearOtherStandingLinks(itemSubs, itemId, subItemId) : [];
    for (const other of cleared) dbSetItemSubLink(other);

    const key = (l: { itemId: string; subItemId: string }) => `${l.itemId}|${l.subItemId}`;
    const byKey = new Map([next, ...cleared].map(l => [key(l), l]));
    set(s => ({ itemSubs: s.itemSubs.map(l => byKey.get(key(l)) ?? l) }));
  },

  setItemSubNote(itemId, subItemId, note) {
    const link = get().itemSubs.find(l => l.itemId === itemId && l.subItemId === subItemId);
    if (!link) return;
    const next: ItemSubLink = { ...link, note: note.trim() || null };
    dbSetItemSubLink(next);
    set(s => ({
      itemSubs: s.itemSubs.map(l =>
        l.itemId === itemId && l.subItemId === subItemId ? next : l
      ),
    }));
  },

  swapForSubstitute(itemId, subItemId) {
    const item = get().items.find(i => i.id === itemId);
    const sub = get().items.find(i => i.id === subItemId);
    if (!item || !sub || !item.onList) return;

    // Snapshots taken before anything is written, so undo restores the rows
    // themselves rather than reconstructing what they probably were — the
    // same discipline resolveChoice uses for a destructive resolution.
    const before = [{ ...item }, { ...sub }];

    const link = get().itemSubs.find(l => l.itemId === itemId && l.subItemId === subItemId);
    let quantity = item.quantity;
    if (item.quantity && link?.ratioFrom && link?.ratioTo) {
      const converted = substituteQuantity(item.quantity, link.ratioFrom, link.ratioTo);
      if (converted.converted) quantity = converted.text;
    }

    const updatedSub: GroceryItem = {
      ...sub,
      onList: true,
      checked: false,
      quantity: quantity ?? sub.quantity,
      quantityFromRecipe: quantity ? item.quantityFromRecipe : sub.quantityFromRecipe,
      lastAddedAt: new Date().toISOString(),
    };
    dbUpdateGroceryItem(updatedSub);

    // The row being swapped out just comes off the list — it used to be deleted
    // when provisional, which is the case this refactor is most obviously about:
    // the item you swapped away from is the one that carries the substitute link
    // saying what to swap it *for*. A recipe-owned quantity's claim ends with
    // the row it was on, same as finishing does.
    const updatedItem: GroceryItem = {
      ...item,
      onList: false,
      checked: false,
      quantity: item.quantityFromRecipe ? null : item.quantity,
      quantityFromRecipe: false,
    };
    dbUpdateGroceryItem(updatedItem);

    const patched = new Map<string, GroceryItem>([
      [updatedSub.id, updatedSub],
      [updatedItem.id, updatedItem],
    ]);
    set(s => ({
      items: s.items.map(i => patched.get(i.id) ?? i),
      cartHoldIds: s.cartHoldIds.filter(x => x !== item.id && x !== sub.id),
    }));

    get().setLastAction({
      label: `Swapped for ${sub.name}`,
      undo: () => {
        for (const row of before) dbUpdateGroceryItem(row);
        const byId = new Map(before.map(i => [i.id, i]));
        set(s => ({
          items: s.items.map(i => byId.get(i.id) ?? i),
          cartHoldIds: s.cartHoldIds.filter(x => x !== item.id && x !== sub.id),
        }));
      },
    });
  },

  markItemsUnavailable(itemIds, shopId) {
    const { items, shops, itemShops } = get();
    if (!shops.some(s => s.id === shopId)) return;

    const markedAt = new Date().toISOString();
    const links: ItemShopLink[] = [];
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
        unavailableProductIds: existing?.unavailableProductIds ?? {},
        // Same carry again. "They don't stock it" supersedes the per-product
        // claims at read time (isUnavailable is checked first), so there's no
        // need to erase them — and they come back intact if the negative is
        // undone.
        productId: existing?.productId ?? null,
        // Same carry as linkItemShopMany, and the same reasoning as the count
        // above: what it cost when they did stock it is history, and the claim
        // is about today's shelf. Every price read drops a negative link
        // anyway, so this is kept for when the claim is taken back.
        lastPriceMinor: existing?.lastPriceMinor ?? null,
        lastPricedAt: existing?.lastPricedAt ?? null,
        lastPriceQuantity: existing?.lastPriceQuantity ?? null,
        // An availability claim is not a purchase, so it records no
        // observation — it just doesn't throw away the ones already there.
        priceHistory: existing?.priceHistory ?? [],
      };
      dbSetItemShopLink(link);
      links.push(link);
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

  setProductUnavailable(itemId, shopId, unavailable) {
    const item = get().items.find(i => i.id === itemId);
    if (!item) return;
    if (!get().shops.some(s => s.id === shopId)) return;
    // The claim is about a specific box, and the box in question is the one
    // the row is asking for. With no preference there is nothing to be missing
    // — "they haven't got the one I want" needs a one you want.
    const productId = item.preferredProductId;
    if (!productId) return;
    if (!get().itemProducts.some(p => p.id === productId && p.itemId === itemId)) return;
    const existing = get().itemShops.find(l => l.itemId === itemId && l.shopId === shopId);
    const claimed = existing?.unavailableProductIds[productId] !== undefined;
    if (!existing && !unavailable) return;
    if (claimed === unavailable) return;

    const unavailableProductIds = { ...(existing?.unavailableProductIds ?? {}) };
    if (unavailable) unavailableProductIds[productId] = new Date().toISOString();
    else delete unavailableProductIds[productId];

    // Taking the last claim back off a row that was *only* claims leaves a bare
    // purchaseCount-0 link, which asserts "I get this here" — a different and
    // stronger statement than the one being withdrawn. Same call
    // clearItemUnavailable makes about a row that was only the negative.
    if (
      existing
      && !unavailable
      && Object.keys(unavailableProductIds).length === 0
      && existing.purchaseCount === 0
      && !existing.unavailableAt
    ) {
      get().unlinkItemShop(itemId, shopId);
      return;
    }

    const link: ItemShopLink = existing
      ? { ...existing, unavailableProductIds }
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
          priceHistory: [],
          productId: null,
          unavailableProductIds,
        };
    dbSetItemShopLink(link);
    set(s => ({
      itemShops: existing
        ? s.itemShops.map(l => (l.itemId === itemId && l.shopId === shopId ? link : l))
        : [...s.itemShops, link],
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
    const shop = get().shops.find(s => s.id === shopId);
    if (!shop) return;
    const startedAt = new Date().toISOString();
    dbSetTrip(shopId, startedAt);
    set({ tripShopId: shopId, tripStartedAt: startedAt });
    scheduleTripReminder(shop.name, startedAt);
  },

  endTrip() {
    if (!get().tripShopId && !get().tripStartedAt) return;
    dbSetTrip(null, null);
    set({ tripShopId: null, tripStartedAt: null });
    cancelTripReminder();
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
