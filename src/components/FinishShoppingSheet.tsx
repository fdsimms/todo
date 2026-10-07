import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Alert, Keyboard, Platform, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
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
import { useSettingsStore } from '../store/useSettingsStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { resolveActiveTrip } from '../utils/activeTrip';
import { EmptyNote } from './EmptyNote';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { PillGroup } from './PillGroup';
import { InlineAction } from './InlineAction';
import { haptics } from '../utils/haptics';
import {
  formatPriceInput,
  lastPriceFor as lastPriceForItem,
  parsePriceInput,
  priceToInput,
  pricesRecordedSince,
} from '../utils/groceryPrice';
import { resolveShoppingSubstitutes, substitutesFor } from '../utils/itemSubs';
import { describeShopAisles, isOutOfRange } from '../utils/groceryShops';
import { featureShown } from '../utils/simpleMode';
import { GROCERY_NAME_MAX_LENGTH, SHOP_NAME_MAX_LENGTH } from '../types';
import { TextField } from './TextField';

/** Matches the shopping list's own checkbox, so the shape reads as familiar. */
const CHECK_SIZE = 22;

/**
 * "Frozen", "Frozen and Bakery", "Frozen, Bakery and Deli" — the aisles a trip
 * bought from that its store isn't set to sell. Named rather than counted,
 * because the correction being offered is about these specific aisles and "2
 * aisles" is not something anyone can agree or disagree with.
 */
function joinAisles(aisles: readonly string[]): string {
  if (aisles.length === 1) return aisles[0];
  return `${aisles.slice(0, -1).join(', ')} and ${aisles[aisles.length - 1]}`;
}

/** "10000.00" — the widest thing GROCERY_PRICE_MINOR_MAX allows. */
const PRICE_INPUT_MAX_LENGTH = 8;

interface Props {
  visible: boolean;
  /** How many rows are in the trolley — the sheet doesn't recount. */
  checkedCount: number;
  /**
   * What's still on the list unticked, in list order. The trip's leftovers, and
   * the only thing the "didn't they have it?" question can be asked about.
   */
  leftover: ReadonlyArray<{ id: string; name: string }>;
  /** What's in the trolley, in list order — the rows a price can be put on. */
  purchased: ReadonlyArray<{ id: string; name: string; quantity: string | null }>;
  /**
   * A store and per-row prices already read off a scanned receipt, applied on
   * opening in place of the usual defaults. Absent for a hand-finished trip,
   * which is every trip that didn't come through `ReceiptImportSheet`.
   *
   * The prices arrive as field text rather than minor units because that's what
   * the fields hold and what `handleFinish` re-parses — seeding the parsed form
   * would mean a second path into the same state that could round differently.
   */
  seedShopId?: string | null;
  seedPriceText?: Record<string, string>;
  /**
   * Changes every time a receipt is read, and is the whole mechanism by which
   * a receipt scanned *from this sheet* reaches it.
   *
   * The seeds above are otherwise read once, on opening, and deliberately so
   * (see the effect that does it). But `onScanReceipt` opens the receipt sheet
   * over the top of this one rather than closing it, so there is no opening for
   * the answers to arrive on: they have to land on a sheet already up. A stamp
   * rather than the seeds themselves because two receipts can legitimately name
   * the same store and the same prices, and re-reading one is still a fresh
   * answer that should re-fill the fields.
   */
  seedStamp?: string;
  /**
   * A scanned receipt's purchase date, read off the paper (or defaulted to
   * today when it wasn't readable or looked implausible) — passed straight
   * through to `onFinished`. This sheet doesn't offer its own date field;
   * `ReceiptImportSheet` is where it's shown and corrected. Absent for a
   * hand-finished trip, which stamps `now` exactly as it always has (#1806).
   */
  seedPurchasedAt?: string;
  /**
   * Rows already flagged for the freezer before the trip reached this sheet:
   * the barcode scan sheet's own snowflake, which the screen holds until the
   * trip finishes (#2925). Read on opening, like the other seeds, so each one
   * shows lit on its row here and can still be turned off. What `onFinished`
   * hands back is this sheet's answer, not a union with the seed, so a
   * snowflake that reads as off really is off.
   */
  seedFrozenIds?: ReadonlySet<string>;
  /**
   * Opens the receipt sheet over this one, when the screen offers it.
   *
   * Optional because the reading needs an Anthropic API key, and whether there
   * is one is the screen's business rather than this sheet's — the same call
   * the shopping list's own "Scan a receipt" button makes. Absent, the action
   * isn't rendered at all.
   *
   * The trip is *not* ended, cancelled or reset by taking it: this sheet stays
   * mounted and visible underneath, so the leftover ticks and the substitute
   * answers someone has already given survive the detour. What comes back
   * arrives through `seedStamp`.
   */
  onScanReceipt?: () => void;
  /**
   * The receipt sheet `onScanReceipt` raises, rendered *inside* this sheet's
   * own Modal rather than beside it.
   *
   * iOS presents each Modal from the nearest view controller above it, and a
   * view controller presents one thing at a time — so a sheet raised over
   * this one while it stays visible has to be a child of it, or it is refused
   * and the action reads as dead. Beside it is what shipped, and "Scan a
   * receipt" from this sheet did nothing at all.
   *
   * Nesting rather than hiding this sheet is what keeps the answers: the
   * open-time seed above resets the store, the prices, the unavailable ticks
   * and the substitutes every time `visible` goes true, so a sheet hidden for
   * the detour would come back empty — which is the one thing `seedStamp`
   * exists to avoid.
   *
   * The caller still owns the sheet and its state and passes it through; only
   * where it renders is fixed here.
   */
  overlays?: React.ReactNode;
  /**
   * Finishing a list you're away from home for, which records nothing — see
   * `GroceryList`. Every question below is about what a purchase *leaves
   * behind* (which store stocks this, what it cost, what they didn't have),
   * and an away trip leaves none of it, so the sheet drops them rather than
   * collecting answers it is about to discard. What's left is the confirm,
   * which is still worth asking for: this is what empties the trolley.
   */
  away?: boolean;
  onClose: () => void;
  /**
   * `frozenIds` is the freezer toggle on the rows being bought, ready for
   * `finishShopping`'s own `frozenIds`: only ids still in `purchased`, and
   * always empty where the toggle isn't offered (see `freezerShown`).
   */
  onFinished: (
    shopId: string | null,
    unavailableIds: string[],
    priceById: Record<string, number>,
    substitutes: Array<{ itemId: string; subItemId: string }>,
    purchasedAt: string | undefined,
    frozenIds: ReadonlySet<string>
  ) => void;
}

/** A copy of the set with `key` flipped, for a toggle. */
function toggledIn<T>(set: ReadonlySet<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Whether two sets hold the same members. */
function sameMembers<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  return a.size === b.size && Array.from(a).every(key => b.has(key));
}

// Map of this file (one component holding most of it; `grep -n '// ===='` is
// the table of contents):
//   bindings       theme, the keyboard inset, the stores and settings read
//   state          the sheet's answers (store, leftovers, substitutes, prices,
//                  freezer), the default store, whether the freezer is offered
//   seeding        what each opening, and each receipt read from here, fills in
//   finish         adding a store, Cancel and its dirty check, Finish
//   leftovers      which leftovers are asked about, the store's range, the
//                  "didn't have it" ticks and what came home instead
//   prices         the freezer toggle, the count line, a row's last price
//   render         the scan action, the store picker, the range card, the
//                  leftovers, then the bought rows with price and freezer
// Above: the helpers and the prop types. Below the component: styles.

/**
 * Where the trip gets its store.
 *
 * This replaced an Alert.alert confirm, for the obvious reason that an alert
 * can't hold a picker — but the confirm is still the job, and the sheet keeps
 * its shape: one sentence saying what's about to happen, then the commit.
 *
 * **No store is a real answer, not a skipped step.** It's a first-class pill
 * rather than a "later" escape hatch, it's the default until a trip has ever
 * named a store, and picking nothing finishes the trip exactly as every trip
 * did before stores existed. That's what keeps this additive: nobody standing
 * at a checkout is made to answer a question to tick their list off.
 *
 * **The leftovers are where the negative record comes from.** A trip that ends
 * with things still on the list has just answered, for free, the question the
 * rest of the grocery feature can't otherwise ask: an absent link only ever
 * meant "never seen here", so nothing in the app could tell "I didn't get to
 * that aisle" from "they don't stock it". This is the moment the user knows
 * which, and the only moment — so the sheet asks, once, about the items the
 * trip actually left behind.
 *
 * It stays an aside, and every part of that is deliberate. Nothing is ticked by
 * default, because the overwhelmingly common reason a thing is left on the list
 * is that you didn't get round to it — silence has to mean that. The section
 * only exists once a store is named (a claim needs somebody to be about), and
 * clearing that choice clears the ticks with it rather than quietly refiling
 * them against the next store. Finish works untouched, exactly as before.
 *
 * **A row just ticked unavailable can name what came home instead.** This is
 * the only moment the app can learn a substitute from what actually happened
 * rather than from a declaration — everywhere else in that system waits for
 * the user to go and say so in the item sheet, which is exactly why it's
 * worth capturing well here. It unfolds under the row itself rather than
 * opening anything, offers what the trip actually bought as one-tap picks
 * (`purchased`, the honest common case), and — via the same find-or-add
 * `PillGroup` shape the store picker above it already uses — lets typing a
 * name mint a catalog row for anything else, through `ensureCatalogItem`
 * (the same "type it in" `SubstituteSheet`'s own field uses). Someone whose
 * trolley never had the actual replacement in it, or who bought nothing at
 * all this trip, can still say what they got. It follows the same silence
 * rule as the tick above it: nothing is picked by default, and skipping it
 * writes nothing. Changing the store clears these answers along with the
 * ticks — "got margarine instead" is an answer about Safeway's shelves, not
 * Costco's. `resolveShoppingSubstitutes` is what turns the sheet's per-row
 * answers into the pairs actually worth writing.
 *
 * **A row that already has a linked substitute (`substitutesFor`) offers it
 * first.** This is the one moment the app knows both that the original isn't
 * available here and what the user already said to use instead, so the pick
 * is pinned ahead of what the trip happened to buy rather than left for
 * someone to notice and type in again.
 *
 * **Prices are the third question and follow the same rules**, with one
 * difference: they're asked whether or not a store is named. "They didn't have
 * it" needs somebody to be about, but what you paid is a fact on its own — a
 * trip with no store still records the item's own price (see
 * GroceryItem.lastPriceMinor). Every field starts empty with the last known
 * price as its placeholder, so leaving the section alone changes nothing and
 * an unpriced trip is not a claim that anything got cheaper. The exception is
 * a price already given for this trip (a receipt's line, a shelf label read by
 * the barcode scanner, or a row's price tag while shopping), which fills its
 * field so that finishing files it against this store. It sits last
 * because it's the longest, and Finish lives in the header where a long
 * section can't push it off the screen.
 *
 * **Each of those rows also carries the freezer toggle** (#2925), the barcode
 * sheet's snowflake in the same place, since this is where a big shop ends and
 * a big shop is when half of it goes straight in the freezer. It rides the
 * price rows rather than getting a section of its own because they already
 * are the list of what's coming home, one row per item, and a second copy of
 * that list would double the longest part of the sheet. Every row it sits on
 * is already being bought (there is no unticking here), so turning it on has
 * nothing else to include, which is the rule the receipt's own toggle needs a
 * line of code for. Off by default and silent when left alone, like every
 * other question on this sheet; it goes to `finishShopping`'s `frozenIds`,
 * which applies it after the purchase's own "no longer frozen" clear so it
 * lands on the new packet.
 */
export function FinishShoppingSheet({
  visible,
  checkedCount,
  leftover,
  purchased,
  seedShopId,
  seedPriceText,
  seedPurchasedAt,
  seedStamp,
  seedFrozenIds,
  onScanReceipt,
  overlays,
  away = false,
  onClose,
  onFinished,
}: Props) {
  // ==== bindings ====
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const shops = useGroceryStore(useShallow(s => s.shops));
  const tripShopId = useGroceryStore(s => s.tripShopId);
  const tripStartedAt = useGroceryStore(s => s.tripStartedAt);
  const addShop = useGroceryStore(s => s.addShop);
  const items = useGroceryStore(useShallow(s => s.items));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const ensureCatalogItem = useGroceryStore(s => s.ensureCatalogItem);
  const setShopAisles = useGroceryStore(s => s.setShopAisles);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);
  const simpleMode = useSettingsStore(s => s.simpleMode);

  // ==== state ====
  const [selected, setSelected] = useState<string | null>(null);
  // Leftovers the store didn't have. Ids rather than an index set, so a list
  // that changes underneath the sheet can't shift the answers onto other rows.
  const [unavailable, setUnavailable] = useState<string[]>([]);
  // What came home instead, keyed by the unavailable item's id — a purchased
  // item's id, or absent when the follow-up was left alone. Resolved down to
  // what's actually writable at Finish time by resolveShoppingSubstitutes.
  const [substituteFor, setSubstituteFor] = useState<Record<string, string>>({});
  // Prices exactly as typed, keyed by item id — parsed on Finish rather than on
  // every keystroke, so a half-typed "4." is a field mid-edit and not a
  // rejected value flashing an error at someone holding a receipt.
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  // Rows going in the freezer, by item id. Seeded on opening from
  // `seedFrozenIds` and read against `purchased` at Finish, so an id whose row
  // has left the trolley since writes nothing.
  const [frozen, setFrozen] = useState<ReadonlySet<string>>(new Set());

  // If a trip is running, the store is already known and this stops being a
  // question — you said where you were on the way in. With no trip running the
  // default is no store, not where you finished last: a remembered store filed
  // the next trip against the wrong shop whenever it went unnoticed.
  const activeTrip = resolveActiveTrip(tripShopId, tripStartedAt, shops, new Date());
  const defaultShopId = activeTrip?.id ?? null;

  // Whether the freezer toggle is offered: only where finishing puts what was
  // bought in the pantry. An away trip records nothing (the store drops
  // `frozenIds` along with the rest), and simplified mode's "Pantry and
  // freezer tracking" switch is this exact question, unless a scan this trip
  // already flagged a row, which stays on show so it can be seen and undone.
  const freezerShown = !away && featureShown(
    'pantryTracking',
    simpleMode,
    purchased.some(p => seedFrozenIds?.has(p.id))
  );

  // ==== seeding ====
  // The prices typed into a row's price tag during this trip, as field text.
  // They seed their fields on opening, so that finishing records them against
  // the trip's store (#2936): the tag writes only the item's own price when
  // the store has no link yet (setItemPrice never mints one), and an empty
  // field here then minted the link with no price at all. Read through a ref
  // on opening, like the other seeds below. Nothing on an away list, which
  // asks no prices.
  const tripPriceTextRef = useRef<() => Record<string, string>>(() => ({}));
  tripPriceTextRef.current = () => {
    if (away || !activeTrip || !tripStartedAt) return {};
    const inCart = new Set(purchased.map(p => p.id));
    const prices = pricesRecordedSince(
      items.filter(i => inCart.has(i.id)),
      activeTrip.id,
      itemShops,
      tripStartedAt
    );
    return Object.fromEntries(Object.entries(prices).map(([id, minor]) => [id, priceToInput(minor)]));
  };
  // What those seeds were, so the dirty check doesn't count them: they are
  // already saved on the item, and cancelling loses none of them.
  const tripPriceSeedRef = useRef<Record<string, string>>({});

  // Read through a ref so the reset fires on opening only. Reset on every
  // opening rather than on mount: the sheet outlives a trip, and last week's
  // selection is a way to file a shop against the wrong store. Re-deriving the
  // default from a store update while the sheet is up would instead silently
  // undo a choice the user had already made — the same reason ShoppingTripSheet
  // reads its own defaults this way.
  const defaultShopRef = useRef(defaultShopId);
  defaultShopRef.current = defaultShopId;

  // What `selected` was reset to on open — distinct from defaultShopRef above,
  // which keeps tracking the live default for the *next* open. Compared
  // against on dismiss so picking a different store than the default counts
  // as real work about to be lost; re-confirming the same default doesn't.
  const initialSelectedRef = useRef<string | null>(null);

  // A scanned receipt's answers, read on opening for the same reason the
  // default store is: they belong to the trip being finished now, and letting
  // a prop change reach `selected`/`priceText` while the sheet is up would undo
  // an edit the user had already made on top of them.
  const seedRef = useRef({ shopId: seedShopId, priceText: seedPriceText, frozenIds: seedFrozenIds });
  seedRef.current = { shopId: seedShopId, priceText: seedPriceText, frozenIds: seedFrozenIds };
  // What `frozen` was seeded with, so the dirty check doesn't count a flag the
  // scan already made: cancelling leaves it where it was, with the screen.
  const frozenSeedRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (visible) {
      const seed = seedRef.current;
      // `undefined` means no receipt; `null` is a receipt that named no store,
      // which is a real answer and must not fall back to the default.
      const shopId = seed.shopId === undefined ? defaultShopRef.current : seed.shopId;
      setSelected(shopId);
      initialSelectedRef.current = shopId;
      // Same reset and the same reason: last week's typed prices belong to last
      // week's shop. A scanned receipt's prices are this shop's, so they seed,
      // and so do the ones typed at the shelf this trip. The receipt wins a
      // row both name: it is what was actually charged.
      const tripPrices = tripPriceTextRef.current();
      tripPriceSeedRef.current = tripPrices;
      setPriceText({ ...tripPrices, ...(seed.priceText ?? {}) });
      // Same reset: last trip's freezer flags were about last trip's bags.
      const frozenSeed = new Set(seed.frozenIds ?? []);
      frozenSeedRef.current = frozenSeed;
      setFrozen(frozenSeed);
      // Last trip's "they didn't have it" answers, which the effect on
      // `selected` below doesn't clear when this trip is at the same store:
      // setSelected to the value it already holds changes nothing.
      setUnavailable([]);
      setSubstituteFor({});
    }
  }, [visible]);

  // A receipt read from this sheet, arriving while it's still up — see
  // `seedStamp`. The prices merge rather than replace, because a price typed by
  // hand before reaching for the camera is an answer too, and the receipt is
  // only entitled to the rows it actually named.
  const appliedStampRef = useRef(seedStamp);
  useEffect(() => {
    if (!visible || seedStamp === undefined || seedStamp === appliedStampRef.current) return;
    appliedStampRef.current = seedStamp;
    // `undefined` is no receipt at all; `null` is a receipt naming no store,
    // which is a real answer — the same distinction the open-time seed makes.
    if (seedShopId !== undefined) setSelected(seedShopId);
    if (seedPriceText) setPriceText(prev => ({ ...prev, ...seedPriceText }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, seedStamp]);

  // A "they didn't have it" is about one named store, so changing the store
  // throws the answers away rather than refiling them. The substitute
  // follow-up is about the same store, so it goes with them.
  useEffect(() => {
    setUnavailable([]);
    setSubstituteFor({});
  }, [selected]);

  // ==== finish ====
  /** Returning the message rejects the name and holds the field open. */
  const handleAdd = (name: string) => {
    const shop = addShop(name);
    if (!shop) return 'You already have a store with that name.';
    haptics.success();
    setSelected(shop.id);
  };

  // A price is captured nowhere else — this is the only moment anyone knows
  // a store didn't have something — so losing unavailable/priceText here
  // loses information the app can't re-derive, not just a form to retype.
  const handleCancel = () => {
    const dirty = selected !== initialSelectedRef.current
      || unavailable.length > 0
      || Object.entries(priceText).some(
        ([id, t]) => t.trim() !== '' && t !== tripPriceSeedRef.current[id]
      )
      || !sameMembers(frozen, frozenSeedRef.current);
    if (!dirty) { Keyboard.dismiss(); onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { Keyboard.dismiss(); onClose(); } },
      ],
    );
  };

  const handleFinish = () => {
    Keyboard.dismiss();
    // Anything that doesn't parse is dropped rather than blocking the finish.
    // The trip is the thing being recorded; a price is an aside, and refusing
    // to end someone's shop over a typo in one would invert that.
    const priceById: Record<string, number> = {};
    for (const [id, text] of Object.entries(priceText)) {
      const minor = parsePriceInput(text);
      if (minor !== null) priceById[id] = minor;
    }
    // Only rows that are *still* leftovers. A receipt read from this sheet
    // ticks rows into the cart underneath it (that's the point of the scan
    // action), so a row answered "they didn't have it" a moment ago can have
    // stopped being a leftover since — it vanishes from the section above, but
    // its id would otherwise still be in here. `finishShopping` runs after the
    // claim and clears it again, so the recorded state came out right either
    // way; this is about not submitting an answer the user can no longer see.
    // The substitutes follow, since one is only ever about an unavailable row.
    const stillLeftover = unavailable.filter(id => leftover.some(l => l.id === id));
    // The same "still here" rule for the freezer, from the other side: only
    // rows still being bought. A hidden toggle hands back nothing, so what's
    // written is exactly what the sheet showed.
    const frozenIds = new Set(
      freezerShown ? purchased.filter(p => frozen.has(p.id)).map(p => p.id) : []
    );
    onFinished(
      selected,
      selected ? stillLeftover : [],
      priceById,
      selected ? resolveShoppingSubstitutes(stillLeftover, substituteFor) : [],
      seedPurchasedAt,
      frozenIds
    );
  };

  // ==== leftovers ====
  const selectedShop = selected ? shops.find(s => s.id === selected) ?? null : null;

  // The leftovers actually worth asking about. A store told it only sells
  // certain aisles is not being asked, every trip, which of your groceries the
  // pharmacy didn't have — that question has an answer already and it is the
  // user's own (see Shop.aisles). Everything else is unchanged: an unscoped
  // store is asked about the whole list, which is every store until somebody
  // says otherwise, and a row with a purchase on record here survives the
  // filter because `isOutOfRange` lets the specific statement beat the range.
  const askable = useMemo(() => {
    if (!selectedShop || selectedShop.aisles === null) return leftover;
    const byId = new Map(items.map(i => [i.id, i]));
    return leftover.filter(row => {
      const item = byId.get(row.id);
      // Resolve-or-shrug: a leftover whose catalog row has gone is still a
      // question we can't rule out, so it stays askable rather than vanishing.
      if (!item) return true;
      return !isOutOfRange(selectedShop, item, itemShops);
    });
  }, [selectedShop, leftover, items, itemShops]);

  // How many the range took off the question, so the section can say it rather
  // than quietly showing three rows of fourteen. A filtered list that doesn't
  // admit it is filtered is a scope you can't discover is wrong.
  const withheldCount = leftover.length - askable.length;

  // What came home from an aisle this store isn't set to sell. A purchase is
  // the one thing that refutes a range outright — the same call `finishShopping`
  // makes when a purchase clears `unavailableAt` — but widening on its own
  // would let one ice pack decide a pharmacy sells Frozen for good, so the
  // correction is offered and the user makes it. Ordered by the aisle walk the
  // list itself is in.
  const unsoldAisles = useMemo(() => {
    if (!selectedShop || selectedShop.aisles === null) return [];
    const scope = new Set(selectedShop.aisles);
    const byId = new Map(items.map(i => [i.id, i]));
    const out: string[] = [];
    for (const row of purchased) {
      const aisle = byId.get(row.id)?.aisle;
      if (!aisle || scope.has(aisle) || out.includes(aisle)) continue;
      out.push(aisle);
    }
    return out;
  }, [selectedShop, purchased, items]);

  /**
   * Widen the store's range to cover what the trip actually bought. Commits
   * straight through, like every other control that edits a store rather than
   * this trip — see GroceryAislesSheet, which has nothing to guard for the same
   * reason. It is a correction to the shop, so cancelling the trip afterwards
   * has no business taking it back.
   */
  const handleWidenRange = () => {
    if (!selectedShop || selectedShop.aisles === null || unsoldAisles.length === 0) return;
    haptics.success();
    setShopAisles(selectedShop.id, [...selectedShop.aisles, ...unsoldAisles]);
  };
  const toggleUnavailable = (id: string) => {
    haptics.tap();
    setUnavailable(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
    // An un-ticked row isn't unavailable any more, so whatever it was answered
    // with stops meaning anything — drop it rather than leave it to reappear
    // if the row gets ticked again later in the same sheet.
    setSubstituteFor(prev => {
      if (!(id in prev)) return prev;
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  // A single pick per row, not a multi-select: tapping the already-chosen
  // item clears the answer, same toggle shape the store pills use.
  const toggleSubstitute = (itemId: string, subItemId: string) => {
    haptics.tap();
    setSubstituteFor(prev =>
      prev[itemId] === subItemId
        ? Object.fromEntries(Object.entries(prev).filter(([id]) => id !== itemId))
        : { ...prev, [itemId]: subItemId }
    );
  };

  // The typed-in half: what came home wasn't necessarily anything else in the
  // trolley. Mints or finds the catalog row the same way SubstituteSheet's own
  // add-by-name field does, then picks it — same as tapping a pill, just for a
  // name that wasn't already one.
  const handleCreateSubstitute = (itemId: string, name: string) => {
    const created = ensureCatalogItem(name);
    if (!created) return 'Enter a name.';
    haptics.success();
    setSubstituteFor(prev => ({ ...prev, [itemId]: created.id }));
  };

  // ==== prices ====
  // Just the flag: every row carrying the toggle is already in the trolley,
  // so unlike the receipt's own toggle there is no row to check alongside it.
  const toggleFrozen = (itemId: string) => {
    haptics.tap();
    setFrozen(prev => toggledIn(prev, itemId));
  };

  const countLabel = `${checkedCount} ${checkedCount === 1 ? 'item comes' : 'items come'} off the list`;

  /**
   * What to seed a row's placeholder with: this store's last price if the trip
   * has named one and it has been priced there, else the last price anywhere.
   * Recomputed as the store changes, which is the point — switching from
   * Safeway to Costco should show Costco's numbers.
   */
  const lastPriceFor = (itemId: string): number | null => {
    const item = items.find(i => i.id === itemId);
    return item ? lastPriceForItem(item, selected, itemShops) : null;
  };

  // ==== render ====
  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <SheetHeader
          title="Finish shopping"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label="Finish" onPress={handleFinish} minWidth={64} />}
        />

        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <Text style={styles.intro}>
            {countLabel}.{' '}
            {away
              ? 'Nothing here is added to your pantry, prices or purchase history.'
              : 'Everything stays in your catalog for next time.'}
          </Text>

          {/* Above the questions it answers, because that's what it is: the
              store and the price of every row are printed on the paper in your
              hand, and typing forty of them is the thing nobody does. It stays
              an offer rather than a step — the sheet works untouched.

              Gone on an away trip along with the questions it fills in: a
              receipt is read for its store and its prices, and neither is
              kept. */}
          {!!onScanReceipt && !away && (
            <View style={styles.scanWrap}>
              <InlineAction
                label="Scan a receipt"
                icon="receipt-outline"
                onPress={onScanReceipt}
              />
            </View>
          )}

          {/* The store, the leftovers and the prices are one block on an away
              trip's behalf: each of the three records something about a shop
              you're going to keep going back to, and an away trip records none
              of it. Wrapped together rather than guarded three times, so a
              fourth question added here can't be forgotten. */}
          {!away && (
          <>
          <Text style={styles.label}>WHERE DID YOU SHOP?</Text>
          <Text style={styles.hint}>
            Optional. Naming a store is what lets you see which store has which items later.
          </Text>

          {/* The store list has no ceiling — it's entirely user-built — so the
              grid caps itself and grows a find-or-add field once it outgrows a
              glance. "No store" is pinned: it's the default and a first-class
              answer, and a default behind a disclosure looks unavailable. */}
          <View style={styles.pills}>
            <PillGroup
              // A Modal's children stay mounted while it's hidden, and the
              // sheet outlives a trip — so the picker is remounted on each
              // opening rather than handing last week's half-typed store name
              // to this week's shop. Same reasoning as the `selected` reset.
              key={String(visible)}
              noun="store"
              surface="page"
              createMaxLength={SHOP_NAME_MAX_LENGTH}
              onCreate={handleAdd}
              options={[
                {
                  key: '__none__',
                  label: 'No store',
                  pinned: true,
                  selected: selected === null,
                  onPress: () => {
                    haptics.tap();
                    setSelected(null);
                  },
                },
                ...shops.map(shop => ({
                  key: shop.id,
                  label: shop.name,
                  selected: shop.id === selected,
                  onPress: () => {
                    haptics.tap();
                    setSelected(shop.id);
                  },
                })),
              ]}
            />
          </View>

          {shops.length === 0 && (
            <EmptyNote icon="storefront-outline">
              No stores yet. Add one and this trip gets filed against it. After a trip or two,
              the catalog can show you what each store carries.
            </EmptyNote>
          )}

          {/* A purchase from outside the store's range. The one thing that
              refutes a range outright, offered as a correction rather than
              taken: see handleWidenRange. */}
          {!!selectedShop && unsoldAisles.length > 0 && (
            <View style={styles.rangeCard}>
              <Text style={styles.rangeText}>
                {selectedShop.name} is set to sell {describeShopAisles(selectedShop)}. This trip bought
                from {joinAisles(unsoldAisles)}.
              </Text>
              <InlineAction
                label={unsoldAisles.length === 1 ? `Add ${unsoldAisles[0]}` : 'Add these aisles'}
                icon="add"
                variant="neutral"
                onPress={handleWidenRange}
                style={styles.rangeAction}
              />
            </View>
          )}

          {/* The leftovers, and the one question the app can't work out for
              itself. Only with a store named: without one there's nobody for
              "they didn't have it" to be about — and only the rows the store
              could plausibly have, which for an unscoped store is all of them. */}
          {!!selectedShop && askable.length > 0 && (
            <>
              <Text style={styles.label}>ANYTHING THEY DIDN’T HAVE?</Text>
              <Text style={styles.hint}>
                Optional. Check off what {selectedShop.name} didn’t stock. Everything here stays on your
                list either way; this only records why.
                {withheldCount > 0
                  ? ` ${withheldCount} more ${withheldCount === 1 ? 'is' : 'are'} in aisles ${selectedShop.name} doesn’t sell, so ${withheldCount === 1 ? "it isn’t" : "they aren’t"} listed.`
                  : ''}
              </Text>

              <View style={styles.card}>
                {askable.map((row, i) => {
                  const ticked = unavailable.includes(row.id);
                  const chosenId = substituteFor[row.id] ?? null;
                  // What the item's own substitute links already say to use
                  // instead — the one thing the app can suggest here rather
                  // than wait for the user to type it in.
                  const knownSubs = substitutesFor(row.id, itemSubs, items);
                  const knownSubIds = new Set(knownSubs.map(s => s.item.id));
                  // A pick can be a purchased row, a recorded substitute, or a
                  // name typed into the create field and minted on the spot —
                  // the last of those isn't in either list, so it needs its
                  // own pill to show as selected.
                  const chosenExtra =
                    chosenId && !purchased.some(p => p.id === chosenId) && !knownSubIds.has(chosenId)
                      ? items.find(i => i.id === chosenId)
                      : null;
                  return (
                    <View key={row.id}>
                      <TouchableOpacity
                        style={[styles.row, i > 0 && styles.rowDivided]}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => toggleUnavailable(row.id)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: ticked }}
                        accessibilityLabel={`${row.name}: ${selectedShop.name} didn’t have it`}
                      >
                        <View style={[styles.check, ticked && styles.checkOn]}>
                          {ticked && (
                            <Ionicons name="close" size={iconSize.sm} color={colors.onFill} />
                          )}
                        </View>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {row.name}
                        </Text>
                      </TouchableOpacity>

                      {/* Optional, and offered whether or not anything was
                          bought this trip — the typed field means an empty
                          trolley still has a way to answer. */}
                      {ticked && (
                        <View style={styles.substituteWrap}>
                          <Text style={styles.substituteLabel}>Got something else instead?</Text>
                          <PillGroup
                            noun="item"
                            surface="card"
                            limit={6}
                            createMaxLength={GROCERY_NAME_MAX_LENGTH}
                            onCreate={name => handleCreateSubstitute(row.id, name)}
                            options={[
                              // Recorded substitutes lead the grid and are
                              // pinned so a longer purchased list can't push
                              // them behind "N more" — a link the user
                              // already authored outranks a guess. Skipped
                              // when the same item is also in `purchased`,
                              // which already gets a pill of its own below.
                              ...knownSubs
                                .filter(s => !purchased.some(p => p.id === s.item.id))
                                .map(s => ({
                                  key: s.item.id,
                                  label: s.item.name,
                                  suffix: ' · usual substitute',
                                  pinned: true,
                                  selected: chosenId === s.item.id,
                                  accessibilityLabel: `${s.item.name}, the usual substitute for ${row.name}`,
                                  onPress: () => toggleSubstitute(row.id, s.item.id),
                                })),
                              ...purchased.map(p => ({
                                key: p.id,
                                label: p.name,
                                suffix: knownSubIds.has(p.id) ? ' · usual substitute' : undefined,
                                selected: chosenId === p.id,
                                onPress: () => toggleSubstitute(row.id, p.id),
                              })),
                              ...(chosenExtra
                                ? [
                                    {
                                      key: chosenExtra.id,
                                      label: chosenExtra.name,
                                      selected: true,
                                      onPress: () => toggleSubstitute(row.id, chosenExtra.id),
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>

              <Text style={styles.note}>
                {unavailable.length > 0
                  ? `Filed as “not at ${selectedShop.name}”, so planning your next trip sends you somewhere else for ${unavailable.length === 1 ? 'it' : 'them'}. Buying ${unavailable.length === 1 ? 'it' : 'one'} there later clears it.`
                  : 'Leave them unchecked if you simply didn’t get to them. That’s the usual reason, and it’s what nothing checked means.'}
              </Text>
            </>
          )}

          {/* Last, and asked with or without a store — see the note on the
              component. A row's placeholder is what it last cost, so the
              common case is reading rather than typing. The freezer toggle
              rides the same rows, for the reason the component note gives. */}
          {purchased.length > 0 && (
            <>
              <Text style={styles.label}>WHAT DID THEY COST?</Text>
              <Text style={styles.hint}>
                Optional. Fill in what you remember and it shows next time this is on your list
                {selectedShop ? `, along with what ${selectedShop.name} charges` : ''}. Skip any
                you don’t know and the last price stays.
                {freezerShown ? ' Tap the snowflake on anything going in the freezer.' : ''}
              </Text>

              <View style={styles.card}>
                {purchased.map((row, i) => {
                  const known = lastPriceFor(row.id);
                  const isFrozen = frozen.has(row.id);
                  return (
                    <View key={row.id} style={[styles.rowLine, i > 0 && styles.rowDivided]}>
                      <View style={freezerShown ? [styles.row, styles.rowBeforeFreezer] : [styles.row, styles.rowFill]}>
                        <View style={styles.priceName}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {row.name}
                          </Text>
                          {!!row.quantity && (
                            <Text style={styles.rowQuantity} numberOfLines={1}>
                              {row.quantity}
                            </Text>
                          )}
                        </View>
                        <View style={styles.priceField}>
                          <Text style={styles.priceSymbol}>{currencySymbol}</Text>
                          <TextField
                            style={styles.priceInput}
                            value={priceText[row.id] ?? ''}
                            onChangeText={text =>
                              setPriceText(prev => ({ ...prev, [row.id]: formatPriceInput(text) }))
                            }
                            // Cents-first entry (formatPriceInput) never needs a
                            // decimal key, so the plain digit pad is the right
                            // one here — unlike the `numeric` fallback this used
                            // to avoid, back when a decimal separator had to be
                            // typed by hand.
                            keyboardType="number-pad"
                            // returnKeyType is inert on the iOS number pad,
                            // which has no return key at all — the accessory
                            // bar below is what actually dismisses this, and
                            // it matters here more than anywhere: the prices
                            // are a list, so the keyboard is up for the whole
                            // walk down it and covers the Finish button.
                            returnKeyType="done"
                            inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
                            // "Price" rather than a bare "0.00" when nothing
                            // is known: a figure in the placeholder's grey
                            // reads as a price already saved (CLAUDE.md's
                            // placeholder rule), and $0.00 is a real price.
                            placeholder={known !== null ? `e.g. ${priceToInput(known)}` : 'Price'}
                            placeholderTextColor={colors.textTertiary}
                            maxLength={PRICE_INPUT_MAX_LENGTH}
                            accessibilityLabel={`Price for ${row.name}`}
                          />
                        </View>
                      </View>
                      {/* The barcode sheet's snowflake, same glyph, same
                          trailing edge, and beside the row rather than inside
                          it so it's its own control for VoiceOver. */}
                      {freezerShown && (
                        <TouchableOpacity
                          activeOpacity={interaction.activeOpacity}
                          style={styles.freezerControl}
                          onPress={() => toggleFrozen(row.id)}
                          hitSlop={{ top: spacing.xs, bottom: spacing.xs }}
                          accessibilityRole="switch"
                          accessibilityState={{ checked: isFrozen }}
                          accessibilityLabel={
                            isFrozen
                              ? `${row.name}, going in the freezer. Tap to change.`
                              : `Put ${row.name} in the freezer`
                          }
                        >
                          <Ionicons
                            name={isFrozen ? 'snow' : 'snow-outline'}
                            size={iconSize.sm}
                            color={isFrozen ? colors.accent : colors.textTertiary}
                          />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          )}
          </>
          )}
        </ScrollView>
        <NumberPadAccessory />
      </View>
      {overlays}
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
    // No margin of its own: the intro above already carries `spacing.md`
    // beneath it and the section label below carries the same above it, which
    // is the gap a stacked block wants on each side.
    scanWrap: { alignItems: 'flex-start' },
    intro: { color: colors.textSecondary, fontSize: font.md, marginBottom: spacing.md },
    label: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textSecondary,
      letterSpacing: 0.8,
      marginTop: spacing.md,
    },
    hint: { fontSize: font.sm, color: colors.textTertiary, marginTop: spacing.xs },
    note: { fontSize: font.sm, color: colors.textTertiary, marginTop: spacing.sm, lineHeight: 19 },
    pills: { marginTop: spacing.sm },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      marginTop: spacing.md,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    rowDivided: { borderTopWidth: border.hairline, borderTopColor: colors.separator },
    // A bought row and its freezer toggle, side by side, as the receipt
    // sheet's Pantry rows lay them out: the row keeps the width up to the
    // snowflake and hands its trailing padding to the toggle, so the price
    // field doesn't sit a card's padding away from it.
    rowLine: { flexDirection: 'row', alignItems: 'stretch' },
    rowFill: { flex: 1 },
    rowBeforeFreezer: { flex: 1, paddingRight: spacing.xs },
    freezerControl: {
      justifyContent: 'center',
      paddingLeft: spacing.sm,
      paddingRight: spacing.md,
    },
    rowTitle: { flex: 1, color: colors.text, fontSize: font.md },
    // Sits under its row rather than opening anything — no divider of its own,
    // so it reads as part of the row it's answering for, not a new one.
    substituteWrap: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
      gap: spacing.sm,
    },
    substituteLabel: { fontSize: font.sm, color: colors.textTertiary },
    priceName: { flex: 1, gap: spacing.xxs },
    rowQuantity: { color: colors.textTertiary, fontSize: font.sm },
    // A bordered box rather than a bare input: it's the only thing on this
    // sheet you type into, and an unmarked one reads as a label until tapped.
    priceField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      minWidth: 104,
      borderWidth: border.hairline,
      borderColor: colors.separator,
      borderRadius: radius.sm,
      backgroundColor: colors.bg,
    },
    priceSymbol: { color: colors.textSecondary, fontSize: font.md },
    // No lineHeight — see the note in CLAUDE.md about what RN does with it on
    // a TextInput.
    priceInput: { flex: 1, color: colors.text, fontSize: font.md, padding: 0 },
    // The app's checkbox shape (`checkboxRadius`, same as GroceryRow's), filled
    // red with an × rather than accent with a tick. Ticking this is the
    // opposite of ticking the item off, and it sits one sheet away from the row
    // that does that — so the shape is the familiar one and the colour and
    // glyph carry the whole difference.
    check: {
      width: CHECK_SIZE,
      height: CHECK_SIZE,
      borderRadius: checkboxRadius(CHECK_SIZE),
      borderWidth: border.md,
      borderColor: colors.textTertiary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: colors.redFill, borderColor: colors.redFill },
    // Margin on both sides: the store picker sits above and the leftovers
    // label below, and neither carries a top margin of its own.
    rangeCard: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.md,
      marginBottom: spacing.md,
    },
    rangeText: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 19 },
    rangeAction: { alignSelf: 'flex-start', marginTop: spacing.sm },
  });
}
