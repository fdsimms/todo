import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Alert, Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
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
import { SheetHeaderButton } from './SheetHeaderButton';
import { PillGroup } from './PillGroup';
import { InlineAction } from './InlineAction';
import { haptics } from '../utils/haptics';
import {
  formatPriceInput,
  lastPriceFor as lastPriceForItem,
  parsePriceInput,
  priceToInput,
} from '../utils/groceryPrice';
import { resolveShoppingSubstitutes, substitutesFor } from '../utils/itemSubs';
import { GROCERY_NAME_MAX_LENGTH, SHOP_NAME_MAX_LENGTH } from '../types';

/** Matches the shopping list's own checkbox, so the shape reads as familiar. */
const CHECK_SIZE = 22;

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
  onClose: () => void;
  onFinished: (
    shopId: string | null,
    unavailableIds: string[],
    priceById: Record<string, number>,
    substitutes: Array<{ itemId: string; subItemId: string }>,
    purchasedAt?: string
  ) => void;
}

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
 * an unpriced trip is not a claim that anything got cheaper. It sits last
 * because it's the longest, and Finish lives in the header where a long
 * section can't push it off the screen.
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
  onScanReceipt,
  onClose,
  onFinished,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const shops = useGroceryStore(useShallow(s => s.shops));
  const lastShopId = useGroceryStore(s => s.lastShopId);
  const tripShopId = useGroceryStore(s => s.tripShopId);
  const tripStartedAt = useGroceryStore(s => s.tripStartedAt);
  const addShop = useGroceryStore(s => s.addShop);
  const items = useGroceryStore(useShallow(s => s.items));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const ensureCatalogItem = useGroceryStore(s => s.ensureCatalogItem);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);

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

  // If a trip is running, the store is already known and this stops being a
  // question — you said where you were on the way in. Falling back to where you
  // finished last, which is right far more often than it's wrong: most people
  // shop the same two places.
  const defaultShopId =
    resolveActiveTrip(tripShopId, tripStartedAt, shops, new Date())?.id ?? lastShopId;

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
  const seedRef = useRef({ shopId: seedShopId, priceText: seedPriceText });
  seedRef.current = { shopId: seedShopId, priceText: seedPriceText };

  useEffect(() => {
    if (visible) {
      const seed = seedRef.current;
      // `undefined` means no receipt; `null` is a receipt that named no store,
      // which is a real answer and must not fall back to the default.
      const shopId = seed.shopId === undefined ? defaultShopRef.current : seed.shopId;
      setSelected(shopId);
      initialSelectedRef.current = shopId;
      // Same reset and the same reason: last week's typed prices belong to last
      // week's shop. A scanned receipt's prices are this shop's, so they seed.
      setPriceText(seed.priceText ?? {});
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
  // throws the answers away rather than refiling them. Includes the reset
  // above, which is the same rule at the start of a trip. The substitute
  // follow-up is about the same store, so it goes with them.
  useEffect(() => {
    setUnavailable([]);
    setSubstituteFor({});
  }, [selected]);

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
      || Object.values(priceText).some(t => t.trim() !== '');
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

  const handleFinish = () => {
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
    onFinished(
      selected,
      selected ? stillLeftover : [],
      priceById,
      selected ? resolveShoppingSubstitutes(stillLeftover, substituteFor) : [],
      seedPurchasedAt
    );
  };

  const selectedShop = selected ? shops.find(s => s.id === selected) ?? null : null;
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

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />
          <Text style={styles.headerTitle}>Finish shopping</Text>
          <SheetHeaderButton label="Finish" onPress={handleFinish} minWidth={64} />
        </View>

        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <Text style={styles.intro}>
            {countLabel}. Everything stays in your catalog for next time.
          </Text>

          {/* Above the questions it answers, because that's what it is: the
              store and the price of every row are printed on the paper in your
              hand, and typing forty of them is the thing nobody does. It stays
              an offer rather than a step — the sheet works untouched. */}
          {!!onScanReceipt && (
            <View style={styles.scanWrap}>
              <InlineAction
                label="Scan a receipt"
                icon="receipt-outline"
                onPress={onScanReceipt}
              />
            </View>
          )}

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
            <View style={styles.emptyNote}>
              <Ionicons name="storefront-outline" size={iconSize.md} color={colors.textTertiary} />
              <Text style={styles.emptyText}>
                No stores yet. Add one and this trip gets filed against it — after a trip or two,
                Buy again can show you what each store carries.
              </Text>
            </View>
          )}

          {/* The leftovers, and the one question the app can't work out for
              itself. Only with a store named: without one there's nobody for
              "they didn't have it" to be about. */}
          {!!selectedShop && leftover.length > 0 && (
            <>
              <Text style={styles.label}>ANYTHING THEY DIDN’T HAVE?</Text>
              <Text style={styles.hint}>
                Optional. Check off what {selectedShop.name} didn’t stock. Everything here stays on your
                list either way — this only records why.
              </Text>

              <View style={styles.card}>
                {leftover.map((row, i) => {
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
                            <Ionicons name="close" size={iconSize.sm} color={colors.onAccent} />
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
              common case is reading rather than typing. */}
          {purchased.length > 0 && (
            <>
              <Text style={styles.label}>WHAT DID THEY COST?</Text>
              <Text style={styles.hint}>
                Optional. Fill in what you remember and it shows next time this is on your list
                {selectedShop ? `, along with what ${selectedShop.name} charges` : ''}. Skip any
                you don’t know — the last price stays.
              </Text>

              <View style={styles.card}>
                {purchased.map((row, i) => {
                  const known = lastPriceFor(row.id);
                  return (
                    <View key={row.id} style={[styles.row, i > 0 && styles.rowDivided]}>
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
                        <TextInput
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
                          returnKeyType="done"
                          placeholder={known !== null ? priceToInput(known) : '0.00'}
                          placeholderTextColor={colors.textTertiary}
                          maxLength={PRICE_INPUT_MAX_LENGTH}
                          accessibilityLabel={`Price for ${row.name}`}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
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
    rowTitle: { flex: 1, color: colors.text, fontSize: font.md },
    // Sits under its row rather than opening anything — no divider of its own,
    // so it reads as part of the row it's answering for, not a new one.
    substituteWrap: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
      gap: spacing.sm,
    },
    substituteLabel: { fontSize: font.sm, color: colors.textTertiary },
    priceName: { flex: 1, gap: 2 },
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
    checkOn: { backgroundColor: colors.red, borderColor: colors.red },
    emptyNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.lg,
    },
    emptyText: { flex: 1, fontSize: font.sm, color: colors.textTertiary },
  });
}
