import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
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
import { resolveActiveTrip } from '../utils/activeTrip';
import { SheetHeaderButton } from './SheetHeaderButton';
import { PillGroup } from './PillGroup';
import { haptics } from '../utils/haptics';
import { lastPriceFor as lastPriceForItem, parsePriceInput, priceToInput } from '../utils/groceryPrice';
import { SHOP_NAME_MAX_LENGTH } from '../types';

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
  onClose: () => void;
  onFinished: (
    shopId: string | null,
    unavailableIds: string[],
    priceById: Record<string, number>
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
  onClose,
  onFinished,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const shops = useGroceryStore(useShallow(s => s.shops));
  const lastShopId = useGroceryStore(s => s.lastShopId);
  const tripShopId = useGroceryStore(s => s.tripShopId);
  const tripStartedAt = useGroceryStore(s => s.tripStartedAt);
  const addShop = useGroceryStore(s => s.addShop);
  const items = useGroceryStore(useShallow(s => s.items));
  const itemShops = useGroceryStore(useShallow(s => s.itemShops));
  const currencySymbol = useSettingsStore(s => s.currencySymbol);

  const [selected, setSelected] = useState<string | null>(null);
  // Leftovers the store didn't have. Ids rather than an index set, so a list
  // that changes underneath the sheet can't shift the answers onto other rows.
  const [unavailable, setUnavailable] = useState<string[]>([]);
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

  useEffect(() => {
    if (visible) {
      setSelected(defaultShopRef.current);
      // Same reset and the same reason: last week's typed prices belong to last
      // week's trolley.
      setPriceText({});
    }
  }, [visible]);

  // A "they didn't have it" is about one named store, so changing the store
  // throws the answers away rather than refiling them. Includes the reset
  // above, which is the same rule at the start of a trip.
  useEffect(() => {
    setUnavailable([]);
  }, [selected]);

  /** Returning the message rejects the name and holds the field open. */
  const handleAdd = (name: string) => {
    const shop = addShop(name);
    if (!shop) return 'You already have a store with that name.';
    haptics.success();
    setSelected(shop.id);
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
    onFinished(selected, selected ? unavailable : [], priceById);
  };

  const selectedShop = selected ? shops.find(s => s.id === selected) ?? null : null;
  const toggleUnavailable = (id: string) => {
    haptics.tap();
    setUnavailable(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
          <Text style={styles.headerTitle}>Finish shopping</Text>
          <SheetHeaderButton label="Finish" onPress={handleFinish} minWidth={64} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>
            {countLabel}. Everything stays in your catalog for next time.
          </Text>

          <Text style={styles.label}>WHERE DID YOU SHOP?</Text>
          <Text style={styles.hint}>
            Optional. Naming a store is what lets you see which shop has which items later.
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
                No stores yet. Add one and this trip gets filed against it — after a shop or two,
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
                Optional. Tick what {selectedShop.name} didn’t stock. Everything here stays on your
                list either way — this only records why.
              </Text>

              <View style={styles.card}>
                {leftover.map((row, i) => {
                  const ticked = unavailable.includes(row.id);
                  return (
                    <TouchableOpacity
                      key={row.id}
                      style={[styles.row, i > 0 && styles.rowDivided]}
                      activeOpacity={interaction.activeOpacity}
                      onPress={() => toggleUnavailable(row.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: ticked }}
                      accessibilityLabel={`${row.name} — ${selectedShop.name} didn’t have it`}
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
                  );
                })}
              </View>

              <Text style={styles.note}>
                {unavailable.length > 0
                  ? `Filed as “not at ${selectedShop.name}”, so planning your next trip sends you somewhere else for ${unavailable.length === 1 ? 'it' : 'them'}. Buying ${unavailable.length === 1 ? 'it' : 'one'} there later clears it.`
                  : 'Leave them unticked if you simply didn’t get to them — that’s the usual reason, and it’s what nothing ticked means.'}
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
                            setPriceText(prev => ({ ...prev, [row.id]: text }))
                          }
                          // Not `numeric`: the decimal separator is on the
                          // number pad on iOS but the plain one has no way to
                          // type a price at all.
                          keyboardType="decimal-pad"
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
    intro: { color: colors.textSecondary, fontSize: font.md, marginBottom: spacing.md },
    label: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textTertiary,
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
