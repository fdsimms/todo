import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import {
  spacing,
  radius,
  font,
  fontWeight,
  border,
  iconSize,
  interaction,
  checkboxRadius,
  type Colors,
} from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { itemsOnList } from '../utils/groceryLists';
import { useSettingsStore } from '../store/useSettingsStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { PillGroup } from './PillGroup';
import { InlineAction } from './InlineAction';
import { CatalogLinkPicker } from './CatalogLinkPicker';
import { SegmentedControl } from './SegmentedControl';
import { WhenPicker } from './WhenPicker';
import { RecipeSourcePicker } from './RecipeSourcePicker';
import { useRecipeImportSource } from '../hooks/useRecipeImportSource';
import { extractReceipt, describeAIError, type ExtractedReceipt } from '../services/aiSuggestions';
import { readReceipt } from '../utils/receiptOcr';
import { extractReceiptOffline } from '../utils/receiptOffline';
import { useAiRoute } from '../hooks/useOnDeviceAi';
import type { OcrReceipt } from '../utils/receiptOcr';
import {
  acceptedByDefault,
  isPlausibleReceiptDate,
  matchReceiptLines,
  matchReceiptShop,
  receiptCautionsFor,
  unclaimedAddTarget,
  type ReceiptCaution,
  type ReceiptMatch,
} from '../utils/receiptMatch';
import { formatPrice } from '../utils/groceryPrice';
import { EmptyState } from './EmptyState';
import { formatScheduledDate } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';
import { GROCERY_NAME_MAX_LENGTH, SHOP_NAME_MAX_LENGTH, type GroceryItem, type ReceiptStyle } from '../types';
import { TextField } from './TextField';

/**
 * One "Left alone" line the user opted to add as bought instead — either
 * promoting an existing off-list catalog row or minting a new one. Handed to
 * `onApply` alongside the matched rows; nothing is written from this sheet
 * (see the component doc comment), so `GroceryScreen` is where these actually
 * become catalog rows (#1805).
 */
export interface ReceiptAddDraft {
  /** An existing catalog row to promote back onto the list, or null to mint a new one from `name`. */
  existingItemId: string | null;
  /** The line's shopper-normalized name — what a minted row is named. */
  name: string;
  /** The line exactly as printed, passed through as the raw text a new row is added from. */
  label: string;
  /**
   * Who makes it, when the source said so — recorded as the minted row's first
   * `ItemProduct`.
   *
   * Always null from a receipt, which prints a store's own shorthand for a
   * product and never its maker. It is on the shared draft rather than a
   * scan-only one because the two paths mint rows through the same handler, and
   * a second draft type would only be this field's absence.
   */
  brand: string | null;
  /**
   * The aisle the barcode source's category names, for a row this mints — see
   * `ScannedItem.aisle`. Null from a receipt, which files its lines by nothing
   * but the order they were printed in.
   */
  aisle: string | null;
  quantity: string;
  priceMinor: number | null;
  /**
   * Going in the freezer rather than on a shelf: the per-row freezer toggle
   * both scan sheets carry in the Pantry (#2925).
   *
   * Set from a receipt only in `'pantry'` context. It used to be always
   * undefined here, on the reading that a receipt has no shelf to ask about,
   * but a big shop read into the Pantry is exactly when half of it goes
   * straight in the freezer, and without this the only way to say so was
   * finding each row afterwards. The shopping context still leaves it unset:
   * that path ends in the finish sheet, which asks about the freezer itself
   * on every row the trip bought, receipt or not.
   */
  frozen?: boolean;
  /**
   * Whether a row this mints should be filed as still wearing the source's own
   * words — see `GroceryItem.nameFromScan` and `nameFromScanFor`.
   *
   * Always undefined from a receipt. A printed line is a store's shorthand and
   * the shopper name over it is the app's reading of that shorthand, so there
   * is no product database phrasing sitting on the row for a rename queue to
   * offer to fix.
   */
  nameFromScan?: boolean;
  /**
   * The barcode this row was scanned from, so the row it mints can be linked
   * back to the code — see `linkScannedGtins`.
   *
   * Undefined from a receipt, which prints no barcodes, and null for a scan
   * row that was typed rather than read. It rides the shared draft for the
   * reason `brand` does: both paths mint rows through one handler, and only
   * that handler knows the id a minted row ends up with.
   */
  gtin?: string | null;
}

/** Matches the shopping list's own checkbox, so the shape reads as familiar. */
const CHECK_SIZE = 22;

/** A copy of the set without `key`, for a toggle's off half. */
function withoutKey<T>(set: ReadonlySet<T>, key: T): Set<T> {
  const next = new Set(set);
  next.delete(key);
  return next;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Which screen is scanning, and so what the paper is being read *against* —
   * the same split `BarcodeScanSheet` makes, for the same reason.
   *
   * `'shopping'` (from `GroceryScreen`, at the checkout or mid-unpack) reads
   * the lines against this week's list and hands the trip to the finish sheet.
   * `'pantry'` (from `KitchenScreen`) reads them against the whole catalog and
   * puts what you bought in the kitchen — there is no list to tick off and no
   * trip to end, so a shop you never made a list for is still worth
   * photographing. See `ReceiptScope`.
   *
   * Two things are shopping-only, and each is absent rather than inert: the
   * purchase date (nothing in the pantry writes one — `addToPantry` stamps
   * on-hand from now) and the "already in the cart" note.
   */
  context: 'shopping' | 'pantry';
  /**
   * Hands the confirmed reading back to the screen: which store, which rows to
   * check off, and what each of them cost.
   *
   * Deliberately does *not* finish the trip. This sheet reads a receipt; the
   * finish sheet ends a shop, and it also asks the one question a receipt can't
   * answer — which of the leftovers the store didn't have. Ending the trip from
   * here would either skip that question or duplicate it.
   *
   * In `'pantry'` context the caller reads the same arguments differently —
   * see `KitchenScreen`'s `handleReceiptApply`, which resolves `itemIds` back
   * to names and routes everything through `addManyToPantry` rather than
   * checking anything off a list. `purchasedAt` is passed but unused there;
   * nothing in the pantry records a purchase date.
   *
   * `frozenItemIds` is the freezer toggle for rows in `itemIds`, the same
   * argument `BarcodeScanSheet` hands back; a row in `toAdd` carries its own
   * `frozen` instead, since it may have no id yet. Always empty in
   * `'shopping'` context, where the toggle isn't shown.
   */
  onApply: (
    shopId: string | null,
    itemIds: string[],
    priceById: Record<string, number>,
    purchasedAt: string,
    toAdd: ReceiptAddDraft[],
    frozenItemIds: ReadonlySet<string>,
    /** The receipt's own amount for each priced row it names, where it printed one. */
    quantityById: Record<string, string>,
  ) => void;
}

// Map of this file (one component holding most of it; `grep -n '// ===='` is
// the table of contents):
//   state          the stores read, the reading, the review's picks, the date
//   reading        reset on open, running the photo or text through a reader
//   review         ticking rows, adding, matching or renaming left-alone lines,
//                  the Pantry's freezer toggle, the store, Apply, Cancel
//   render         cautions, a matched row, the freezer toggle beside a row,
//                  the store and date pickers, the body
// Above: the draft and prop types. Below the component: styles. The matching
// rules themselves live in receiptMatch.ts.

/**
 * Reading a store receipt into the shopping list: what to check off, what it
 * cost, and where you were.
 *
 * Every one of those three was already recordable by hand in the finish sheet,
 * and in practice the prices never were — a per-row price for a forty-row shop
 * is more typing than anyone does while unpacking bags. The receipt already has
 * all of it, so this is an *input method* for the finish sheet rather than a
 * new place a trip can end.
 *
 * **Nothing is written from here.** The confirm hands its answers to
 * `GroceryScreen`, which ticks the rows and opens the finish sheet with the
 * store and the prices filled in. The user then finishes the shop exactly as
 * they always have, with one more chance to see what's about to be recorded.
 * Two confirms sounds like one too many until you look at what the second one
 * is guarding: `finishShopping` takes the whole list off in one pass.
 *
 * **Two contexts, because a receipt is a fact about shopping and not about a
 * list** (`context`, the same prop `BarcodeScanSheet` carries). Reading one
 * used to be reachable only from the foot of the shopping list, which put it
 * behind having made a list at all and behind not having finished the trip
 * yet — so the paper in your hand was useless the moment you tapped Finish, or
 * if you'd just popped out for milk. It now opens from the finish sheet, where
 * someone standing at the checkout actually is, and from the Pantry, where the
 * answer is "put this in the kitchen" rather than "tick this off".
 *
 * **What's already in the cart is taken as read.** A row ticked into the
 * trolley is the user having already said they bought it, so a line landing on
 * one is corroboration: it breaks ties between two equally good readings and it
 * lets a weak or likely match arrive checked, since the only thing the line is
 * adding is the price. The row says so, because a pre-checked guess with no
 * explanation is exactly the "chicken thighs for chicken breast" mistake this
 * sheet is otherwise careful about. The rules are in `receiptMatch.ts`.
 *
 * **A weak or likely match is shown but never pre-checked.** The tiers come
 * from `receiptMatch.ts`; what this sheet adds is that the difference is
 * *visible* — an unchecked row with "Is this…?" on it is a question, and a
 * pre-checked one is an assertion. Getting that backwards is how someone ends
 * up having marked chicken thighs bought because the receipt said breast.
 * `'likely'` reads as a real word in common ("chicken" in "chicken breast"),
 * not a coincidental one, but a shared word is still a guess about which row a
 * name belongs to, not the app being told — see the same tier's own contract
 * in `receiptMatch.ts`.
 *
 * **What the receipt doesn't mention is not a claim about anything.** Lines
 * that match nothing are listed and ignored by default; list rows the receipt
 * never named are left exactly where they are, unticked. Same call
 * `FinishShoppingSheet` makes about a leftover — the usual reason something is
 * missing is that you didn't get to it. A left-alone line can still be added
 * as bought, but only if the user checks it (#1805) — nothing here decides
 * that on its own.
 *
 * **The purchase is dated when it actually happened, not when it's scanned.**
 * `receipt.date` seeds the date field below the store picker; an implausible
 * one (future, or far enough in the past to be suspicious) is shown as a
 * caution and defaulted back to today rather than trusted outright — see
 * `isPlausibleReceiptDate` (#1806). Either way it's editable, and it's what
 * every checked row — matched or added as bought — is dated with.
 */
export function ReceiptImportSheet({ visible, onClose, onApply, context }: Props) {
  const pantry = context === 'pantry';
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // ==== state ====
  const catalog = useGroceryStore(useShallow(s => s.items));
  const listEntries = useGroceryStore(useShallow(s => s.listEntries));
  const activeListId = useGroceryStore(s => s.activeListId);
  // The catalog as the list being shopped sees it. A row's own `onList` and
  // `checked` answer for the home list alone, so on an away list the home
  // ticks drove the pre-checks and the away list's rows fell to the off-list
  // pass. The home list needs no projection: those fields already describe it.
  const items = useMemo(() => {
    if (activeListId === null) return catalog;
    const listed = itemsOnList(catalog, listEntries, activeListId);
    const listedIds = new Set(listed.map(i => i.id));
    return [
      ...listed,
      ...catalog
        .filter(i => !listedIds.has(i.id))
        .map(i => (i.onList || i.checked ? { ...i, onList: false, checked: false } : i)),
    ];
  }, [catalog, listEntries, activeListId]);
  const shops = useGroceryStore(useShallow(s => s.shops));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const addShop = useGroceryStore(s => s.addShop);
  const setShopReceiptStyle = useGroceryStore(s => s.setShopReceiptStyle);
  const rememberAliases = useGroceryStore(s => s.rememberAliases);
  const aliasItemFor = useGroceryStore(s => s.aliasItemFor);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);
  /**
   * Which engine reads this receipt. The same rule the entry points that got
   * here are gated on, so the sheet cannot be open for a route that can't run.
   */
  const receiptRoute = useAiRoute('receiptImport');
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ExtractedReceipt | null>(null);
  const [matches, setMatches] = useState<ReceiptMatch[]>([]);
  /** Which matched rows are going to be checked off. Ids, not indices. */
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [shopId, setShopId] = useState<string | null>(null);
  /** When the trip happened — the receipt's own date once it's read, today until then. */
  const [purchasedDate, setPurchasedDate] = useState<Date>(new Date());
  /** Set once, on read, when the receipt named a date outside a sane range (#1806). */
  const [dateImplausible, setDateImplausible] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  /** "Left alone" rows opted in to "Add as bought", by index into `unclaimed` (#1805). */
  const [addAsBought, setAddAsBought] = useState<Set<number>>(new Set());
  /**
   * "Left alone" rows matched to a catalog item by hand, by index into
   * `unclaimed` (#2923). A line the reader could make nothing of ("ORG BNLS
   * CHKN BRST" read offline) used to have one way in, as a new item named with
   * the receipt's shorthand. A pick applies it to the item instead, and the
   * alias `handleApply` writes for it is what makes the next receipt from the
   * same store resolve the line by itself.
   */
  const [handPicks, setHandPicks] = useState<Map<number, string>>(new Map());
  /** A name typed over a left-alone line's own, for the new item it adds. Same index. */
  const [nameEdits, setNameEdits] = useState<Map<number, string>>(new Map());
  /** The left-alone row whose catalog search is open, if any. Same index. */
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);
  /**
   * Rows going in the freezer, Pantry context only (#2925): matched rows by
   * item id, left-alone rows by index into `unclaimed`. Read against the
   * checks at Apply, so a flag on a row that ended up unchecked adds nothing.
   */
  const [frozenMatched, setFrozenMatched] = useState<Set<string>>(new Set());
  const [frozenUnclaimed, setFrozenUnclaimed] = useState<Set<number>>(new Set());
  /**
   * Whether this reading came off the device alone, with no API key to spend.
   * Only shown, never acted on: an offline reading is the same
   * `ExtractedReceipt` and goes through the same matcher, and the whole point
   * of that is that nothing downstream branches on where it came from.
   */
  const [readOffline, setReadOffline] = useState(false);

  const input = useRecipeImportSource('photo', 'read a receipt');
  const { photos, reset: resetInput } = input;
  const photo = photos[0] ?? null;

  // ==== reading ====
  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setReceipt(null);
    setMatches([]);
    setAccepted(new Set());
    setShopId(null);
    setPurchasedDate(new Date());
    setDateImplausible(false);
    setDatePickerOpen(false);
    setAddAsBought(new Set());
    setHandPicks(new Map());
    setNameEdits(new Map());
    setPickingIndex(null);
    setFrozenMatched(new Set());
    setFrozenUnclaimed(new Set());
    setReadOffline(false);
    resetInput();
  }, [resetInput]);

  // Reset on close rather than on open, so a sheet that stays mounted doesn't
  // hand last week's receipt to this week's shop — same rule the finish sheet's
  // own reset follows.
  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  // `run` awaits an on-device read and then a model call, and either easily
  // outlives a cancel — the sheet stays mounted (only its Modal hides), so the
  // reset above runs first and the answer would then land on the hidden sheet,
  // opening next week's shop on this one's receipt. Read inside the
  // continuation, never as a dependency. Same guard RecipeExtractSheet keeps.
  // Open alone isn't enough: closed and reopened mid-read, the sheet is open
  // again and the stale answer would land on the new session. So each read
  // takes a number, every open or close moves it on, and a continuation
  // writes only while it still holds the current one.
  const visibleRef = useRef(visible);
  const runRef = useRef(0);
  useEffect(() => {
    visibleRef.current = visible;
    runRef.current++;
  }, [visible]);
  const isCurrent = (n: number) => visibleRef.current && runRef.current === n;

  const run = useCallback(async () => {
    if (!photo) return;
    const runId = ++runRef.current;
    setLoading(true);
    setError(null);
    try {
      // Read it on device first. With a key the recognised rows are what gets
      // sent, and the photo is the fallback for every kind of not-working — no
      // bridge, an unreadable file, a read too thin to be a receipt — so that
      // path can only ever cost the upload it usually saves.
      const ocr = await readReceipt(photo.sourceUri);
      if (!isCurrent(runId)) return;
      // On the device path there is no fallback and no second opinion: the
      // reading is the whole answer, or there isn't one.
      if (receiptRoute === 'onDevice' && !ocr) {
        setError('That photo could not be read on this device. Try again with the whole receipt in frame and more light on it.');
        return;
      }
      const offline = receiptRoute === 'onDevice';
      const result = offline
        ? extractReceiptOffline(ocr as OcrReceipt)
        : await extractReceipt(ocr?.text ?? photo);
      if (!isCurrent(runId)) return;
      setReadOffline(offline);
      setReceipt(result);
      // The store has to be resolved before the lines are, since an alias is
      // scoped to the printer that produced the text.
      const readShopId = matchReceiptShop(result.storeName, shops)?.id ?? null;
      setMatches(
        matchReceiptLines(
          result.lines,
          items,
          line => aliasItemFor(readShopId, line.label),
          pantry ? 'catalog' : 'list',
        )
      );
      setShopId(readShopId);
      const now = new Date();
      const plausible = !!result.date && isPlausibleReceiptDate(result.date, now);
      // Noon rather than midnight, so the day it names can't slip across a
      // timezone boundary on the way to an ISO timestamp.
      setPurchasedDate(plausible ? new Date(`${result.date}T12:00:00`) : now);
      setDateImplausible(!!result.date && !plausible);
      if (result.lines.length > 0) haptics.success();
    } catch (e) {
      if (isCurrent(runId)) setError(describeAIError(e));
    } finally {
      // Only the read that started the spinner stops it.
      if (runRef.current === runId) setLoading(false);
    }
  }, [photo, items, shops, aliasItemFor, pantry, receiptRoute]);

  /**
   * What arrives checked, re-decided whenever the reading or the named store
   * changes.
   *
   * The store is in here because the price check reads that store's own price
   * as its baseline, so the same receipt can be plausible at Costco and
   * suspicious at Safeway. Re-deciding does discard ticks made by hand, which
   * is the same call `FinishShoppingSheet` makes when its store changes: the
   * answers are about the store, so refiling them onto a different one would be
   * asserting something nobody said. In practice the store is set once off the
   * receipt's own header and never touched again.
   */
  useEffect(() => {
    setAccepted(new Set(acceptedByDefault(matches, items, shopId, itemShops)));
    // `items`/`itemShops` are deliberately not dependencies: this is a decision
    // about the receipt just read, and re-running it because an unrelated row
    // changed elsewhere would silently undo the user's review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, shopId]);

  // ==== review ====
  const toggle = (itemId: string) => {
    haptics.tap();
    // Unchecking a row takes its freezer flag with it, so the snowflake never
    // sits lit on a row that isn't going anywhere.
    if (accepted.has(itemId)) setFrozenMatched(prev => withoutKey(prev, itemId));
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleAddAsBought = (index: number) => {
    haptics.tap();
    if (addAsBought.has(index)) setFrozenUnclaimed(prev => withoutKey(prev, index));
    setAddAsBought(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  /**
   * The Pantry's freezer toggle on a matched row. Turning it on checks the
   * row too, the way matching a left-alone line by hand does: saying where
   * something is going is saying you bought it.
   */
  const toggleFrozenMatched = (itemId: string) => {
    haptics.tap();
    const on = !(frozenMatched.has(itemId) && accepted.has(itemId));
    setFrozenMatched(prev => (on ? new Set(prev).add(itemId) : withoutKey(prev, itemId)));
    if (on) setAccepted(prev => new Set(prev).add(itemId));
  };

  /** The same toggle on a left-alone row, which it checks for the same reason. */
  const toggleFrozenUnclaimed = (index: number) => {
    haptics.tap();
    const on = !(frozenUnclaimed.has(index) && addAsBought.has(index));
    setFrozenUnclaimed(prev => (on ? new Set(prev).add(index) : withoutKey(prev, index)));
    if (on) setAddAsBought(prev => new Set(prev).add(index));
  };

  /** A left-alone line matched by hand: checked, since naming the row is the act of taking it. */
  const pickFor = (index: number, item: GroceryItem) => {
    setPickingIndex(null);
    setHandPicks(prev => new Map(prev).set(index, item.id));
    setAddAsBought(prev => new Set(prev).add(index));
  };

  /**
   * Takes a hand match back, and the check with it. What's left is a line that
   * would be added as a new item under the receipt's shorthand, which is not
   * what anyone who just undid a match was asking for.
   */
  const clearPick = (index: number) => {
    haptics.tap();
    setPickingIndex(null);
    setHandPicks(prev => {
      const next = new Map(prev);
      next.delete(index);
      return next;
    });
    setAddAsBought(prev => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
    setFrozenUnclaimed(prev => withoutKey(prev, index));
  };

  const renameFor = (index: number, text: string) => {
    setNameEdits(prev => new Map(prev).set(index, text.slice(0, GROCERY_NAME_MAX_LENGTH)));
  };

  const pickedItemFor = (index: number): GroceryItem | null => {
    const id = handPicks.get(index);
    return id ? items.find(i => i.id === id) ?? null : null;
  };

  const handleApply = () => {
    const priceById: Record<string, number> = {};
    const quantityById: Record<string, string> = {};
    for (const match of matches) {
      if (!match.itemId || !accepted.has(match.itemId)) continue;
      if (match.line.priceMinor !== null) {
        priceById[match.itemId] = match.line.priceMinor;
        // What that price bought, as printed, so it isn't filed against the
        // list's amount instead ("3.5 lb" against a row listed as "2 lb").
        if (match.line.quantity.trim()) quantityById[match.itemId] = match.line.quantity.trim();
      }
    }
    const toAdd: ReceiptAddDraft[] = matches
      .filter(m => m.itemId === null)
      .flatMap((m, i) => {
        if (!addAsBought.has(i)) return [];
        // Which row, and under what name: see `unclaimedAddTarget` for why a
        // hand match goes in under the item's own name rather than the line's.
        const { existingItemId, name } = unclaimedAddTarget(m, pickedItemFor(i), nameEdits.get(i));
        return [{
          existingItemId,
          name,
          label: m.line.label,
          brand: null,
          aisle: null,
          quantity: m.line.quantity,
          priceMinor: m.line.priceMinor,
          // Pantry only, and so undefined from a shopping receipt exactly as
          // it always was (see ReceiptAddDraft.frozen).
          ...(pantry ? { frozen: frozenUnclaimed.has(i) } : null),
        }];
      });
    // Everything the user is applying with a row attached, printed text and
    // all, so the same shorthand resolves without asking next time. Scoped to
    // the store, because that is whose printer wrote it. The "add as bought"
    // rows can only be remembered when they name an existing row — a line
    // minting a brand new item has no id yet, and #1856 leaves catching those
    // to the next receipt rather than plumbing ids back out of the screen. A
    // line matched by hand (#2923) names one, so it is remembered here like
    // any other: that is the "being told once" storeAliases.ts is for.
    rememberAliases([
      ...matches
        .filter(m => m.itemId !== null && accepted.has(m.itemId))
        .map(m => ({ shopId, rawText: m.line.label, itemId: m.itemId as string })),
      ...toAdd
        .filter(d => d.existingItemId !== null)
        .map(d => ({ shopId, rawText: d.label, itemId: d.existingItemId as string })),
    ]);
    const frozenItemIds = new Set(
      pantry ? Array.from(accepted).filter(id => frozenMatched.has(id)) : []
    );
    haptics.success();
    onApply(shopId, Array.from(accepted), priceById, purchasedDate.toISOString(), toAdd, frozenItemIds, quantityById);
  };

  /** Returning the message rejects the name and holds the field open. */
  const handleAddShop = (name: string) => {
    const shop = addShop(name);
    if (!shop) return 'You already have a store with that name.';
    haptics.success();
    setShopId(shop.id);
  };

  const nameFor = (itemId: string) => items.find(i => i.id === itemId)?.name ?? '';

  const receiptStyleOf = (id: string): ReceiptStyle =>
    shops.find(s => s.id === id)?.receiptStyle ?? 'itemized';

  // "Nothing readable" covers both a store that hands you no paper and one
  // whose paper has no item names on it — see ReceiptStyle. They were two
  // options while the second had a pairing flow of its own; with that gone the
  // only thing the sheet does with either answer is decline to read the photo,
  // so one option says it.
  const RECEIPT_STYLE_OPTIONS: { value: ReceiptStyle; label: string }[] = [
    { value: 'itemized', label: 'Item names' },
    { value: 'none', label: 'Nothing readable' },
  ];

  const claimed = matches.filter((m): m is ReceiptMatch & { itemId: string } => m.itemId !== null);
  const unclaimed = matches.filter(m => m.itemId === null);
  /**
   * What the checked rows add up to, matched or added as bought.
   *
   * Deliberately *not* reconciled against the receipt's own total — tax,
   * deposits and anything not on your list are all real parts of that number
   * and none of them become rows, so a gap is the normal case rather than a
   * sign the read went wrong. It's stated so a large gap is visible to someone
   * who knows what they bought, which is the only reader who can judge it.
   */
  const recordedMinor =
    matches.reduce(
      (sum, m) =>
        m.itemId && accepted.has(m.itemId) && m.line.priceMinor !== null
          ? sum + m.line.priceMinor
          : sum,
      0
    ) +
    unclaimed.reduce(
      (sum, m, i) => (addAsBought.has(i) && m.line.priceMinor !== null ? sum + m.line.priceMinor : sum),
      0
    );
  const acceptedCount = accepted.size + addAsBought.size;

  // A read receipt or an unread photo are both real work — a swipe-down
  // would otherwise drop either with no dialog.
  const handleCancel = () => {
    const dirty = !!receipt || !!photo;
    if (!dirty) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  // ==== render ====
  /**
   * Why a row is worth a second look, in the app's own words.
   *
   * A price caution is orange and a quantity one is quiet, matching what each
   * actually does: the first takes the row's tick away, the second is a note
   * about a purchase that still happened.
   */
  const describeCaution = (caution: ReceiptCaution): { text: string; warn: boolean } => {
    if (caution.kind === 'quantity') {
      return { text: `Your list asked for ${caution.wanted}.`, warn: false };
    }
    const paid = formatPrice(caution.baselineMinor, currencySymbol);
    return {
      text: caution.baselineQuantity
        ? `You last paid ${paid} for ${caution.baselineQuantity}. Check this is the right row.`
        : `You last paid ${paid} for this. Check this is the right row.`,
      warn: true,
    };
  };

  /**
   * The snowflake at a row's trailing edge in the Pantry: the barcode sheet's
   * freezer toggle, the same glyph in the same place, so reading a shop into
   * the kitchen asks the same question whichever way it came in. Beside the
   * row rather than inside its touchable, so it's its own control for
   * VoiceOver instead of disappearing into the row's checkbox.
   */
  const freezerToggle = (frozen: boolean, name: string, onPress: () => void) => (
    <TouchableOpacity
      activeOpacity={interaction.activeOpacity}
      style={styles.freezerControl}
      onPress={onPress}
      hitSlop={{ top: spacing.xs, bottom: spacing.xs }}
      accessibilityRole="switch"
      accessibilityState={{ checked: frozen }}
      accessibilityLabel={
        frozen ? `${name}, going in the freezer. Tap to change.` : `Put ${name} in the freezer`
      }
    >
      <Ionicons
        name={frozen ? 'snow' : 'snow-outline'}
        size={iconSize.sm}
        color={frozen ? colors.accent : colors.textTertiary}
      />
    </TouchableOpacity>
  );

  const renderMatch = (match: ReceiptMatch & { itemId: string }, index: number) => {
    const on = accepted.has(match.itemId);
    // Neither tier is pre-checked (`acceptedByDefault`), so both need the same
    // "you decide" caveat — a 'likely' row sitting unchecked with no
    // explanation reads as a bug, not as the app being careful.
    const uncertain = match.confidence === 'weak' || match.confidence === 'likely';
    const name = nameFor(match.itemId);
    const cautions = receiptCautionsFor(match, items, shopId, itemShops);
    const row = (
      <TouchableOpacity
        key={`${match.itemId}-${index}`}
        style={pantry ? [styles.row, styles.rowBeforeFreezer] : [styles.row, index > 0 && styles.rowDivided]}
        activeOpacity={interaction.activeOpacity}
        onPress={() => toggle(match.itemId)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={`${name}, from receipt line ${match.line.label}`}
      >
        <View style={[styles.check, on && styles.checkOn]}>
          {on && <Ionicons name="checkmark" size={14} color={colors.onAccent} />}
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>{name}</Text>
          {/* The printed line, always — it is the only way anyone can check
              the reading that put this row here. */}
          <Text style={styles.rowLabel} numberOfLines={1}>
            {match.line.label}
            {!!match.line.quantity && ` · ${match.line.quantity}`}
          </Text>
          {/* First, because on an uncertain match it's the reason the row
              arrived ticked at all, and a caveat reads better after the thing
              it's a caveat about. Confirmation rather than caution, so the
              quiet grey and not the orange below it. */}
          {match.inTrolley && !pantry && (
            <Text style={styles.rowRemembered}>Already in your cart</Text>
          )}
          {uncertain && (
            <Text style={styles.rowWeak}>
              {match.inTrolley
                // Ticked into the cart *and* only a guessed match by name: the
                // row is going through either way, so the question worth
                // asking is about the number, not about whether it came home.
                ? 'Not sure this is the same thing. Check the price is for this row.'
                : 'Not sure this is the same thing. Check before you accept it.'}
            </Text>
          )}
          {/* Says why a line nothing could have matched by name is sitting on a
              row anyway. Without it a remembered alias reads as the app having
              guessed something inexplicable. */}
          {match.confidence === 'remembered' && (
            <Text style={styles.rowRemembered}>You matched this line before</Text>
          )}
          {cautions.map((caution, i) => {
            const { text, warn } = describeCaution(caution);
            return (
              <Text key={i} style={warn ? styles.rowWeak : styles.rowLabel}>
                {text}
              </Text>
            );
          })}
        </View>
        {match.line.priceMinor !== null && (
          <Text style={styles.rowPrice}>{formatPrice(match.line.priceMinor, currencySymbol)}</Text>
        )}
      </TouchableOpacity>
    );
    if (!pantry) return row;
    return (
      <View key={`${match.itemId}-${index}`} style={[styles.rowLine, index > 0 && styles.rowDivided]}>
        {row}
        {freezerToggle(
          on && frozenMatched.has(match.itemId),
          name,
          () => toggleFrozenMatched(match.itemId)
        )}
      </View>
    );
  };

  /**
   * Extracted so the "nothing readable" branch can reuse them verbatim. Both
   * questions are about the trip rather than about the lines, so they are asked
   * identically whichever kind of receipt this is — and a store whose receipts
   * can't be read *especially* needs the store picker, since that is the
   * control that put the sheet in that state and the only way back out of it.
   */
  const storePicker = () => (
    <>
      <Text style={styles.label}>WHERE DID YOU SHOP?</Text>
      <Text style={styles.hint}>
        {receipt?.storeName
          ? `The receipt says “${receipt.storeName}”.`
          : 'The receipt doesn’t name a store.'}{' '}
        Naming a store is what lets you see which store has which items later.
      </Text>

      <View style={styles.pills}>
        <PillGroup
          key={String(visible)}
          noun="store"
          surface="page"
          createMaxLength={SHOP_NAME_MAX_LENGTH}
          onCreate={handleAddShop}
          options={[
            {
              key: '__none__',
              label: 'No store',
              pinned: true,
              selected: shopId === null,
              onPress: () => { haptics.tap(); setShopId(null); },
            },
            ...shops.map(shop => ({
              key: shop.id,
              label: shop.name,
              selected: shop.id === shopId,
              onPress: () => { haptics.tap(); setShopId(shop.id); },
            })),
          ]}
        />
      </View>

      {/* Asked here rather than in a settings screen, and only once a store is
          named, on the same reasoning ItemShopLink.unavailableAt is captured in
          the finish sheet: this is the only moment anyone knows the answer. You
          have just photographed the thing and are looking at what came back. */}
      {!!shopId && (
        <View style={styles.styleSection}>
          <Text style={styles.label}>WHAT THIS STORE'S RECEIPTS SHOW</Text>
          <SegmentedControl
            options={RECEIPT_STYLE_OPTIONS}
            value={receiptStyleOf(shopId)}
            onChange={value => {
              haptics.tap();
              setShopReceiptStyle(shopId, value);
            }}
            label="What this store's receipts show"
            surface="page"
          />
        </View>
      )}
    </>
  );

  const datePicker = () => (
    <>
      <Text style={styles.label}>WHEN DID YOU SHOP?</Text>
      <Text style={styles.hint}>
        Everything checked gets dated when the trip actually happened, and any use-by day it
        starts is calculated from there.
      </Text>
      <View style={styles.dateSection}>
        <TouchableOpacity
          style={styles.dateRow}
          activeOpacity={interaction.activeOpacity}
          onPress={() => setDatePickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Purchased ${formatScheduledDate(purchasedDate.toISOString())}`}
        >
          <Ionicons name="calendar-outline" size={iconSize.sm} color={colors.textSecondary} />
          <Text style={styles.dateValue}>{formatScheduledDate(purchasedDate.toISOString())}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
        </TouchableOpacity>
        {dateImplausible && (
          <Text style={styles.dateCaution}>
            The date on the receipt didn’t look right, so this defaulted to today. Check it.
          </Text>
        )}
      </View>
    </>
  );

  const body = () => {
    if (loading) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>Reading the receipt…</Text>
        </View>
      );
    }

    if (!receipt) {
      return (
        <View style={styles.sourceWrap}>
          <RecipeSourcePicker
            intro={
              pantry
                ? 'Photograph your receipt and dundundun will put what you bought in the pantry and record what it cost.'
                : 'Photograph your receipt and dundundun will check the items off your list, record what they cost, and file the trip against the store.'
            }
            photoOnly
            photoHint="Lay it flat and get the whole receipt in the frame. A long one is fine folded, as long as the item lines are readable."
            mode="photo"
            onChangeMode={() => {}}
            text=""
            onChangeText={() => {}}
            url=""
            onChangeUrl={() => {}}
            photos={photos}
            onPickPhoto={input.pick}
            onClearPhoto={input.clearPhoto}
            maxPhotos={input.maxPhotos}
            picking={input.picking}
            ctaLabel="Read the receipt"
            onRun={run}
          />
          {!!input.photoError && <Text style={styles.error}>{input.photoError}</Text>}
          {!!error && <Text style={styles.error}>{error}</Text>}
        </View>
      );
    }

    if (receipt.lines.length === 0) {
      return (
        <View style={styles.empty}>
          <EmptyState
            icon="receipt-outline"
            title="Nothing readable on that one"
            subtitle={`Try again with the whole receipt in frame and more light on it. Nothing has been changed ${pantry ? 'in your pantry' : 'on your list'}.`}
            actionLabel="Try another photo"
            onAction={reset}
          />
        </View>
      );
    }

    // Contradictory, and worth saying so rather than reading the paper anyway:
    // the store picker above is the control that got here, so the way out is
    // in front of the user.
    if (receiptStyleOf(shopId ?? '') === 'none') {
      return (
        <>
          {storePicker()}
          <Text style={styles.hint}>
            You've said this store's receipts have nothing readable on them, so there's nothing
            here to name what you bought. Pick a different store above, or change what its
            receipts show.
          </Text>
        </>
      );
    }

    return (
      <>
        <Text style={styles.intro}>
          {receipt.lines.length} {receipt.lines.length === 1 ? 'line' : 'lines'} read
          {receipt.totalMinor !== null
            ? `, totaling ${formatPrice(receipt.totalMinor, currencySymbol)}`
            : ''}
          . Nothing is recorded until you {pantry ? 'tap Add' : 'finish shopping'}.
        </Text>

        {/* Said once, above the rows, because it changes how to read every one
            of them: the names are the paper's own shorthand rather than what it
            stands for. */}
        {readOffline && (
          <Text style={styles.hint}>
            Read on this device without an API key, so each line shows the receipt's own
            shorthand instead of what it stands for. Match anything it missed by hand, or add
            an API key in Settings to have the abbreviations read for you.
          </Text>
        )}

        {storePicker()}
        {/* Shopping only. The pantry writes no purchase date — see `context`. */}
        {!pantry && datePicker()}

        {claimed.length > 0 && (
          <>
            <Text style={styles.label}>{pantry ? 'WHAT YOU BOUGHT' : 'ON YOUR LIST'}</Text>
            <Text style={styles.hint}>
              {pantry
                ? 'Checked rows go in the pantry, with the receipt’s price on each. Tap the snowflake on anything going in the freezer.'
                : 'Checked rows come off the list when you finish, with the receipt’s price on each.'}
            </Text>
            <View style={styles.card}>{claimed.map(renderMatch)}</View>
            {recordedMinor > 0 && (
              <Text style={styles.tally}>
                Recording {formatPrice(recordedMinor, currencySymbol)}
                {receipt.totalMinor !== null
                  ? ` of the ${formatPrice(receipt.totalMinor, currencySymbol)} on this receipt`
                  : ''}
                .
              </Text>
            )}
          </>
        )}

        {unclaimed.length > 0 && (
          <>
            {/* Covers two different reasons on purpose. "Not on your list"
                would be a lie about a duplicate, which is on the list — the
                list just doesn't have two of them. What both share is that
                nothing happens to them unless checked, which is what the
                heading says. */}
            <Text style={styles.label}>LEFT ALONE</Text>
            <Text style={styles.hint}>
              {pantry
                ? claimed.length > 0
                  ? 'These didn’t match anything you’ve bought before, or the receipt printed two of the same thing. Check one to add it, or match it to an item you already have.'
                  : 'None of these matched anything you’ve bought before. Check one to add it, or match it to an item you already have.'
                : claimed.length > 0
                  ? 'These didn’t match anything on your list, or your list only asked for one. Check one to add it as bought, or match it to an item you already have.'
                  : 'None of these matched anything on your list. Check one to add it as bought, or match it to an item you already have.'}
            </Text>
            <View style={styles.card}>
              {unclaimed.map((match, i) => {
                const on = addAsBought.has(i);
                const picked = pickedItemFor(i);
                const catalogName = match.offListMatchId ? nameFor(match.offListMatchId) : null;
                // Only for a row that is going to mint something: a match,
                // by hand or by the reader, is named by the item it lands on.
                const showNameField = on && !picked && !catalogName;
                const lineName = match.line.name || match.line.label;
                return (
                  <View key={`u-${i}`} style={i > 0 ? styles.rowDivided : undefined}>
                    <View style={pantry ? styles.rowLine : undefined}>
                      <TouchableOpacity
                        style={pantry ? [styles.row, styles.rowBeforeFreezer] : styles.row}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => toggleAddAsBought(i)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={
                          picked
                            ? `${picked.name}, from receipt line ${match.line.label}`
                            : pantry
                              ? `Add ${match.line.label} to the pantry`
                              : `Add ${match.line.label} as bought`
                        }
                      >
                        <View style={[styles.check, on && styles.checkOn]}>
                          {on && <Ionicons name="checkmark" size={14} color={colors.onAccent} />}
                        </View>
                        <View style={styles.rowBody}>
                          {picked ? (
                            <>
                              {/* Laid out as a matched row above is, because
                                  that's what it now is: the item, then the
                                  printed line it came from. */}
                              <Text style={styles.rowTitle} numberOfLines={1}>{picked.name}</Text>
                              <Text style={styles.rowLabel} numberOfLines={1}>
                                {match.line.label}
                                {!!match.line.quantity && ` · ${match.line.quantity}`}
                              </Text>
                              <Text style={styles.rowRemembered}>
                                {shopId
                                  ? 'Matched by hand. Receipts from this store will match it the same way next time.'
                                  : 'Matched by hand.'}
                              </Text>
                            </>
                          ) : (
                            <>
                              <Text style={styles.rowSkipped} numberOfLines={1}>{match.line.label}</Text>
                              {match.duplicateOf !== null && (
                                <Text style={styles.rowLabel} numberOfLines={1}>
                                  A second {nameFor(match.duplicateOf)}. The first one is above.
                                </Text>
                              )}
                              {/* In the pantry every catalog row was already a
                                  candidate, so an unclaimed line there matched nothing
                                  at all and `offListMatchId` is always null. */}
                              <Text style={styles.rowLabel} numberOfLines={1}>
                                {catalogName
                                  ? `Matches “${catalogName}” already in your catalog.`
                                  : 'Adds it as a new item.'}
                              </Text>
                            </>
                          )}
                        </View>
                        {match.line.priceMinor !== null && (
                          <Text style={styles.rowPriceOff}>
                            {formatPrice(match.line.priceMinor, currencySymbol)}
                          </Text>
                        )}
                      </TouchableOpacity>
                      {pantry && freezerToggle(
                        on && frozenUnclaimed.has(i),
                        picked?.name ?? (catalogName || lineName),
                        () => toggleFrozenUnclaimed(i)
                      )}
                    </View>

                    {/* Under the row and outside its touchable, so typing in
                        the field or pressing a pill never also toggles the
                        check. Lined up with the row's text rather than its
                        checkbox, the way BarcodeScanSheet's row controls are. */}
                    <View style={styles.rowControls}>
                      {showNameField && (
                        <TextField
                          style={styles.nameInput}
                          value={nameEdits.get(i) ?? match.line.name}
                          onChangeText={text => renameFor(i, text)}
                          placeholder="Name for the new item"
                          placeholderTextColor={colors.textTertiary}
                          // A shelf word, not prose: same reason as the
                          // barcode sheet's own name field.
                          autoCorrect={false}
                          spellCheck={false}
                          accessibilityLabel={`Name for the new item from ${match.line.label}`}
                        />
                      )}
                      <View style={styles.rowActions}>
                        <InlineAction
                          label={picked ? 'Change' : catalogName ? 'Not it' : 'Match to an item'}
                          icon="albums-outline"
                          variant="neutral"
                          onPress={() => setPickingIndex(p => (p === i ? null : i))}
                          accessibilityLabel={
                            picked
                              ? `Change which item ${match.line.label} is`
                              : `Choose which item ${match.line.label} is`
                          }
                          style={styles.actionPill}
                        />
                        {!!picked && (
                          <InlineAction
                            label="Undo"
                            icon="close-circle-outline"
                            variant="neutral"
                            onPress={() => clearPick(i)}
                            accessibilityLabel={`Stop matching ${match.line.label} to ${picked.name}`}
                            style={styles.actionPill}
                          />
                        )}
                      </View>
                    </View>

                    {/* Its own full-width block, for the reason the barcode
                        sheet gives: a result list sharing a line with anything
                        else takes its width from what's left over, and a
                        catalog row you can't read is one you can't pick. */}
                    {pickingIndex === i && (
                      <View style={styles.pickerWrap}>
                        <CatalogLinkPicker
                          items={items}
                          // The reader's own name for the line, which offline
                          // is the shorthand itself: a start for the search
                          // rather than an answer, and the field is right there.
                          initialQuery={lineName}
                          excludeItemId={picked?.id ?? null}
                          onPick={item => pickFor(i, item)}
                        />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}
      </>
    );
  };

  return (
    <>
      <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
        <View style={styles.root}>
          <SheetHeader
            title={pantry ? 'Receipt into pantry' : 'Scan a receipt'}
            left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />}
            right={
              receipt && receipt.lines.length > 0 ? (
                <SheetHeaderButton
                  label={pantry ? 'Add' : 'Apply'}
                  onPress={handleApply}
                  disabled={acceptedCount === 0}
                  minWidth={64}
                />
              ) : (
                <View style={styles.headerSpacer} />
              )
            }
          />

          <ScrollView
            ref={keyboardScroll.ref}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            {...keyboardScroll.props}
          >
            {body()}
          </ScrollView>
        </View>

        {/* Nested inside this sheet's own Modal, not beside it. As a sibling
            both are presented from the screen's root view controller, which
            can only present one thing — the picker silently never appeared and
            the purchased-date row stayed dead for the rest of the flow. Nested
            rather than hidden because the review body holds a whole receipt's
            worth of un-applied state (what's checked, matched by hand,
            renamed), and a hidden sheet's children unmount. See SheetModal. */}
        <WhenPicker
          visible={datePickerOpen}
          value={purchasedDate}
          title="Purchased"
          showTimeOfDay={false}
          showSuggest={false}
          onConfirm={date => {
            if (date) setPurchasedDate(date);
            setDatePickerOpen(false);
          }}
          onCancel={() => setDatePickerOpen(false)}
        />
      </SheetModal>
    </>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    headerSpacer: { minWidth: 64 },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
    // `RecipeSourcePicker` renders its intro/photo-card/CTA as bare siblings and
    // relies on its container for the gap between them — same as the wrapper
    // `RecipeExtractSheet`/`RecipeCreateSheet` give it. Scoped to this branch
    // rather than added to `body` itself, since the post-scan branches already
    // space their own blocks with explicit `marginBottom`.
    sourceWrap: { gap: spacing.md },
    intro: {
      color: colors.textSecondary,
      fontSize: font.sm,
      lineHeight: font.sm * 1.4,
      marginBottom: spacing.lg,
    },
    label: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      marginBottom: spacing.xs,
    },
    hint: {
      color: colors.textTertiary,
      fontSize: font.sm,
      lineHeight: font.sm * 1.4,
      marginBottom: spacing.sm,
    },
    pills: { marginBottom: spacing.lg },
    dateSection: { marginBottom: spacing.lg },
    styleSection: { marginBottom: spacing.lg },
    dateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
    },
    dateValue: { flex: 1, color: colors.text, fontSize: font.md },
    dateCaution: { color: colors.orangeText, fontSize: font.xs, marginTop: spacing.xs },
    tally: {
      color: colors.textTertiary,
      fontSize: font.sm,
      // Pulled back toward the card it sums — the card carries a full
      // `spacing.lg` beneath it, which reads as a detached statement rather
      // than as this list's own total.
      marginTop: -spacing.sm,
      marginBottom: spacing.lg,
    },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      marginBottom: spacing.lg,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    rowDivided: { borderTopWidth: border.hairline, borderTopColor: colors.separator },
    // A Pantry row and its freezer toggle, side by side: the row keeps the
    // whole width up to the snowflake, and hands its own trailing padding to
    // the toggle so the price doesn't sit a card's padding away from it.
    rowLine: { flexDirection: 'row', alignItems: 'stretch' },
    rowBeforeFreezer: { flex: 1, paddingRight: spacing.xs },
    freezerControl: {
      justifyContent: 'center',
      paddingLeft: spacing.sm,
      paddingRight: spacing.md,
    },
    rowBody: { flex: 1 },
    rowTitle: { color: colors.text, fontSize: font.md },
    rowLabel: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.xxs },
    rowWeak: { color: colors.orangeText, fontSize: font.xs, marginTop: spacing.xxs },
    rowRemembered: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
    rowSkipped: { color: colors.textSecondary, fontSize: font.sm },
    rowPrice: { color: colors.text, fontSize: font.md, fontVariant: ['tabular-nums'] },
    rowPriceOff: {
      color: colors.textTertiary,
      fontSize: font.sm,
      fontVariant: ['tabular-nums'],
    },
    // A left-alone row's name field and pills, lined up under its text: the
    // row's own horizontal padding, the checkbox and the gap after it.
    rowControls: {
      paddingLeft: spacing.md + CHECK_SIZE + spacing.sm,
      paddingRight: spacing.md,
      paddingBottom: spacing.sm,
      gap: spacing.xs,
    },
    // No lineHeight on a TextInput (see CLAUDE.md); the padding sets the box.
    nameInput: {
      color: colors.text,
      fontSize: font.sm,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    // Tighter than InlineAction's default, as the barcode sheet's row pills
    // are, so they read as part of the row rather than a grid of chips.
    actionPill: { paddingVertical: 3, minHeight: 0 },
    pickerWrap: {
      paddingLeft: spacing.md + CHECK_SIZE + spacing.sm,
      paddingRight: spacing.md,
      paddingBottom: spacing.sm,
    },
    // The app's checkbox shape (`checkboxRadius`, same as GroceryRow's).
    check: {
      width: CHECK_SIZE,
      height: CHECK_SIZE,
      borderRadius: checkboxRadius(CHECK_SIZE),
      borderWidth: 1.5,
      borderColor: colors.controlBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: colors.accentFill, borderColor: colors.accent },
    loading: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
    loadingText: { color: colors.textSecondary, fontSize: font.sm },
    error: { color: colors.redText, fontSize: font.sm },
    // EmptyState brings its own centring, icon circle and type — this only
    // has to keep it off the sheet's edges.
    empty: { paddingHorizontal: spacing.md, paddingVertical: spacing.xl },
  });
}
