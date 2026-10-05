/**
 * What each pantry write does to a row, decided and written by nobody.
 *
 * `useGroceryStore` is the app's writer and cannot load in Node (it reaches
 * notifications and the task store), so the MCP server's replica could not call
 * its pantry actions. Every one of them is a row transform plus a `set()`, an
 * undo and a use-up task reconcile, and only the first is a rule. This file is
 * that first part, lifted out for the reason `groceryAdd.ts` was: the store and
 * the replica call the same functions, so a pantry rule cannot be fixed on one
 * side and stay broken on the other.
 *
 * Everything here is pure. A function takes the rows as they stand and returns
 * the rows to write; the caller owns the db write, the state and any follow-up.
 *
 * **What the callers still own, and the replica deliberately skips:** the use-up
 * task (`reconcileUseUpTask`), which goes through the task store. The phone's
 * catch-up sweep (`reconcileAllUseUpTasks`) brings it into line off the rows
 * alone, the same split `update_meal` makes for a meal's cook task.
 */
import type { GroceryItem, ItemProduct, Leftover, LeftoverOutcome } from '../types';
import { LEFTOVER_KEEP_DAYS_DEFAULT } from '../types';
import { PORTION_PRODUCT_KEY, isPortionBox } from '../types';
import { OUT_OF_IT_UNTIL, defaultOnHandUntil } from './grocerySuggest';
import { expiresAtForOpening, expiresAtForPurchase } from './groceryShelfLife';
import type { DisposalOutcome } from './itemDisposal';
import type { PantryReviewAnswer } from './pantryReview';
import { aisleForName, placeAisle } from './groceryAisles';
import { groceryNameKey, parseGroceryInput } from './groceryParse';
import { catalogItemForKey } from './groceryPlural';
import { newItemRow, nextSortOrder } from './groceryAdd';
import { cleanLeftoverTitle, keepDaysBetween, keepUntilKeyFor } from './leftovers';
import { clampCookedWeight } from './mealLog';

/** The three columns that belong to one box of something, and end with it. */
const BOX_STORY_CLEARED = { expiresAt: null, frozenAt: null, openedAt: null } as const;

// ---------------------------------------------------------------------------
// Item level
// ---------------------------------------------------------------------------

/**
 * "Got it" / "Clear" / "Out of it" on an item. Marking it out ends this box's
 * story, so its use-by day, freezer stamp and opened stamp go with it: a bare
 * re-add (which touches none of them) otherwise came back reading the disposed
 * box's day as the new one's.
 */
export function onHandRow(item: GroceryItem, until: string | null): GroceryItem {
  return {
    ...item,
    onHandUntil: until,
    ...(until === OUT_OF_IT_UNTIL ? BOX_STORY_CLEARED : null),
  };
}

/**
 * A row leaving the pantry. `outcome` records how it left in the same write;
 * the spoiled stamp is only ever on the spoiled side (`GroceryItem.lastSpoiledAt`).
 */
export function markedOutRow(item: GroceryItem, outcome: DisposalOutcome | undefined, atIso: string): GroceryItem {
  return {
    ...item,
    onHandUntil: OUT_OF_IT_UNTIL,
    usedUpCount: item.usedUpCount + (outcome === 'usedUp' ? 1 : 0),
    spoiledCount: item.spoiledCount + (outcome === 'spoiled' ? 1 : 0),
    lastSpoiledAt: outcome === 'spoiled' ? atIso : item.lastSpoiledAt,
    ...BOX_STORY_CLEARED,
  };
}

/** Only the disposal record, for a row already out whose outcome is learned later. */
export function disposalRow(item: GroceryItem, outcome: DisposalOutcome, atIso: string): GroceryItem {
  return {
    ...item,
    usedUpCount: item.usedUpCount + (outcome === 'usedUp' ? 1 : 0),
    spoiledCount: item.spoiledCount + (outcome === 'spoiled' ? 1 : 0),
    lastSpoiledAt: outcome === 'spoiled' ? atIso : item.lastSpoiledAt,
  };
}

/**
 * The thawed portions of these items. A thawed portion is more of the item in
 * the fridge, so being out of the item is being out of it too and it is
 * deleted; a frozen one is the exception and is left alone, since "out of it"
 * about the half in the fridge says nothing about the half in the freezer.
 */
export function thawedPortionsOf(itemIds: ReadonlySet<string>, products: readonly ItemProduct[]): ItemProduct[] {
  return products.filter(p => itemIds.has(p.itemId) && isPortionBox(p) && !p.frozenAt);
}

/**
 * Freeze or thaw an item. Freezing stamps and leaves the day alone (the clock
 * is suspended, not reset); thawing restarts a whole fresh shelf life rather
 * than resuming what was left. Null when it already is what was asked.
 */
export function frozenRow(item: GroceryItem, frozen: boolean, now: Date): GroceryItem | null {
  if (!!item.frozenAt === frozen) return null;
  return frozen
    ? { ...item, frozenAt: now.toISOString() }
    : { ...item, frozenAt: null, expiresAt: expiresAtForPurchase(item, now) };
}

/**
 * Open or close an item. The stamp is recorded whatever the open lexicon knows;
 * only the day is conditional on it knowing this name. Un-marking clears the
 * stamp and leaves the day standing. Null when nothing changes.
 */
export function openedRow(item: GroceryItem, opened: boolean, now: Date): GroceryItem | null {
  if (!!item.openedAt === opened) return null;
  const reDated = opened ? expiresAtForOpening(item, now) : null;
  return {
    ...item,
    openedAt: opened ? now.toISOString() : null,
    expiresAt: reDated ?? item.expiresAt,
  };
}

/** The pantry review's three answers; every one stamps, so the deck stops dealing the card. */
export function reviewedRow(item: GroceryItem, answer: PantryReviewAnswer, now: Date): GroceryItem {
  const until =
    answer === 'have' ? defaultOnHandUntil(item, now)
    : answer === 'out' ? OUT_OF_IT_UNTIL
    : item.onHandUntil;
  return {
    ...item,
    onHandUntil: until,
    pantryReviewedAt: now.toISOString(),
    ...(answer === 'out' ? BOX_STORY_CLEARED : null),
  };
}

/**
 * "Running low" on or off. Turning it on also stamps `lastAddedAt` when the
 * row was not yet on the list it joins, which is the caller's join to write.
 */
export function runningLowRow(item: GroceryItem, low: boolean, wasOnList: boolean, nowIso: string): GroceryItem | null {
  if (!!item.runningLowAt === low) return null;
  return {
    ...item,
    runningLowAt: low ? nowIso : null,
    lastAddedAt: low && !wasOnList ? nowIso : item.lastAddedAt,
  };
}

// ---------------------------------------------------------------------------
// Box level: one packet of an item, or its frozen portion
// ---------------------------------------------------------------------------

/** A box's own "Got it" / "Out of it", mirroring `onHandRow`'s clear. */
export function productOnHandRow(product: ItemProduct, until: string | null): ItemProduct | null {
  if (product.onHandUntil === until) return null;
  return {
    ...product,
    onHandUntil: until,
    ...(until === OUT_OF_IT_UNTIL ? BOX_STORY_CLEARED : null),
  };
}

/**
 * Boxes going out. A portion goes altogether rather than being marked, since
 * there is no "out of the portion" worth remembering; everything else keeps
 * its row. Boxes already out are left out of both lists.
 */
export function productsOutPlan(products: readonly ItemProduct[]): { update: ItemProduct[]; remove: ItemProduct[] } {
  const live = products.filter(p => p.onHandUntil !== OUT_OF_IT_UNTIL);
  return {
    remove: live.filter(p => isPortionBox(p)),
    update: live.filter(p => !isPortionBox(p)).map((p): ItemProduct => ({ ...p, onHandUntil: OUT_OF_IT_UNTIL, ...BOX_STORY_CLEARED })),
  };
}

/**
 * Freeze or thaw one box. Thawing restarts a fresh shelf life, read off the
 * *item* because that is where it lives. A portion also gets its own "Got it"
 * on the way out, the only thing keeping it in the pantry once the freezer
 * isn't, so one nobody closes out does not sit there for ever.
 */
export function productFrozenRow(
  product: ItemProduct,
  item: GroceryItem | undefined,
  frozen: boolean,
  now: Date
): ItemProduct | null {
  if (!!product.frozenAt === frozen) return null;
  if (frozen) return { ...product, frozenAt: now.toISOString() };
  return {
    ...product,
    frozenAt: null,
    expiresAt: item ? expiresAtForPurchase(item, now) : null,
    ...(isPortionBox(product) && item ? { onHandUntil: defaultOnHandUntil(item, now) } : null),
  };
}

/**
 * Open or close one box. The sealed day handed to the lexicon is this box's,
 * falling back to its item's: the packet being opened is the one whose
 * deadline is at stake.
 */
export function productOpenedRow(
  product: ItemProduct,
  item: GroceryItem | undefined,
  opened: boolean,
  now: Date
): ItemProduct | null {
  if (!!product.openedAt === opened) return null;
  const reDated = opened && item
    ? expiresAtForOpening({ ...item, expiresAt: product.expiresAt ?? item.expiresAt }, now)
    : null;
  return {
    ...product,
    openedAt: opened ? now.toISOString() : null,
    expiresAt: reDated ?? product.expiresAt,
  };
}

/**
 * Put some of an item in the freezer: the item's one unnamed portion box,
 * created or reused. Everything but the freeze is cleared, so a lapsed or
 * out-of-it portion left over from an earlier pack is not this one. Null when
 * that portion is already frozen, because a second freeze restarting the date
 * it went in would be the app misremembering.
 */
export function freezePortionRow(
  itemId: string,
  existing: ItemProduct | null,
  nowIso: string,
  newId: () => string
): ItemProduct | null {
  if (existing?.frozenAt) return null;
  return {
    ...(existing ?? {
      id: newId(),
      itemId,
      brand: null,
      variant: null,
      productKey: PORTION_PRODUCT_KEY,
      rating: null,
      note: '',
      purchaseCount: 0,
      lastPurchasedAt: null,
      gtin: null,
      nutrition: null,
      isPortion: true,
      createdAt: nowIso,
    }),
    onHandUntil: null,
    expiresAt: null,
    frozenAt: nowIso,
    openedAt: null,
  };
}

// ---------------------------------------------------------------------------
// "I have flour"
// ---------------------------------------------------------------------------

export interface PantryAddContext {
  items: readonly GroceryItem[];
  /** Where the user filed a name last time, by `nameKey`. */
  aisleOverrides: Readonly<Record<string, string>>;
  /** The aisles that currently exist, in the user's own walk order. */
  aisleOrder: readonly string[];
  now: Date;
}

export interface PantryAddPlan {
  item: GroceryItem;
  isNew: boolean;
}

/**
 * Say you have something. Parsed like a list line so "2 lb flour" files under
 * flour, and the quantity is dropped: how much you have is the inventory this
 * feature exists not to be. A name the catalog already knows (plural included)
 * keeps its row and gets a "Got it"; one it doesn't becomes a new row that is
 * **not on the list**, because naming something you own is not adding it to
 * this week's shopping. Null for a name with nothing in it.
 */
export function planAddToPantry(raw: string, ctx: PantryAddContext, opts: { nameFromScan?: boolean } = {}): PantryAddPlan | null {
  const trimmed = parseGroceryInput(raw).name.trim();
  if (!trimmed) return null;
  const key = groceryNameKey(trimmed) || trimmed.toLowerCase();
  const nowIso = ctx.now.toISOString();
  const existing = catalogItemForKey(key, [...ctx.items]);
  if (existing) {
    return {
      isNew: false,
      item: {
        ...existing,
        // The typed name wins, and only on an exact key: a row found through
        // its plural keeps the name its own key was derived from.
        name: existing.nameKey === key ? trimmed : existing.name,
        onHandUntil: defaultOnHandUntil(existing, ctx.now),
      },
    };
  }
  const row = newItemRow({
    name: trimmed,
    nameKey: key,
    aisle: placeAisle(ctx.aisleOverrides[key] ?? aisleForName(trimmed), [...ctx.aisleOrder]),
    onList: false,
    sortOrder: nextSortOrder([...ctx.items]),
    createdAt: nowIso,
    nameFromScan: opts.nameFromScan === true,
  });
  // Stamped off the finished row, so this and "Got it" cannot drift apart.
  return { isNew: true, item: { ...row, onHandUntil: defaultOnHandUntil(row, ctx.now) } };
}

// ---------------------------------------------------------------------------
// Leftovers: the fridge half of the kitchen
// ---------------------------------------------------------------------------

/**
 * Freeze or thaw a container. Out of the freezer is a fresh start in the
 * fridge, so both dates move: `storedAt` to now (the anchor `describeAge` and
 * `keepUntilKeyFor` count from) and `keepUntil` to the same window measured
 * from it. Null when it already is what was asked.
 */
export function leftoverFrozenRow(leftover: Leftover, frozen: boolean, nowIso: string): Leftover | null {
  if (!!leftover.frozenAt === frozen) return null;
  return frozen
    ? { ...leftover, frozenAt: nowIso }
    : {
      ...leftover,
      frozenAt: null,
      storedAt: nowIso,
      keepUntil: keepUntilKeyFor(nowIso, keepDaysBetween(leftover.storedAt, leftover.keepUntil)),
    };
}

/** Finish a container, eaten or tossed. Null when it was already finished. */
export function leftoverFinishedRow(leftover: Leftover, outcome: LeftoverOutcome, nowIso: string): Leftover | null {
  if (leftover.finishedAt) return null;
  return { ...leftover, finishedAt: nowIso, outcome };
}

/** The exact reverse of finishing. Null when it was not finished. */
export function leftoverReopenedRow(leftover: Leftover): Leftover | null {
  if (!leftover.finishedAt) return null;
  return { ...leftover, finishedAt: null, outcome: null };
}

/** Keep it for this many days from the day it was stored. */
export function leftoverKeepDaysRow(leftover: Leftover, days: number): Leftover {
  return { ...leftover, keepUntil: keepUntilKeyFor(leftover.storedAt, days) };
}

export interface LeftoverDraft {
  title: string;
  /** ISO instant it went in the fridge. Defaults to now. */
  storedAt?: string;
  /** Keep-for window in days, converted to a `keepUntil` day key on the way in. */
  keepDays?: number;
  /** The recipe it was made from, when logged off a cooked meal. */
  recipeId?: string | null;
  /** The planned meal it was logged from. */
  sourceEntryId?: string | null;
  /** Log this one straight into the freezer rather than into the fridge. */
  frozen?: boolean;
  /** What the container holds, in grams. Omitted for the containers nobody weighs. */
  weightG?: number | null;
}

/**
 * A new container. Null when the title is empty, the only thing refused.
 *
 * A container logged straight into the freezer is stamped with `storedAt`
 * rather than with now: it went in when it was put away, which for a portion
 * logged two days late would otherwise read as two days spent in the fridge.
 */
export function newLeftoverRow(draft: LeftoverDraft, id: string, nowIso: string): Leftover | null {
  const title = cleanLeftoverTitle(draft.title);
  if (!title) return null;
  const storedAt = draft.storedAt ?? nowIso;
  return {
    id,
    title,
    recipeId: draft.recipeId ?? null,
    sourceEntryId: draft.sourceEntryId ?? null,
    storedAt,
    keepUntil: keepUntilKeyFor(storedAt, draft.keepDays ?? LEFTOVER_KEEP_DAYS_DEFAULT),
    finishedAt: null,
    outcome: null,
    frozenAt: draft.frozen ? storedAt : null,
    weightG: clampCookedWeight(draft.weightG ?? null),
    createdAt: nowIso,
    useUpTask: null,
  };
}
