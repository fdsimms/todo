import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
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
import { SheetHeaderButton } from './SheetHeaderButton';
import { PillGroup } from './PillGroup';
import { RecipeSourcePicker } from './RecipeSourcePicker';
import { useRecipePhotoSource } from '../hooks/useRecipePhotoSource';
import { extractReceipt, describeAIError, type ExtractedReceipt } from '../services/aiSuggestions';
import { matchReceiptLines, matchReceiptShop, type ReceiptMatch } from '../utils/receiptMatch';
import { formatPrice, priceToInput } from '../utils/groceryPrice';
import { haptics } from '../utils/haptics';
import { SHOP_NAME_MAX_LENGTH } from '../types';

/** Matches the shopping list's own checkbox, so the shape reads as familiar. */
const CHECK_SIZE = 22;

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Hands the confirmed reading back to the screen: which store, which rows to
   * check off, and what each of them cost.
   *
   * Deliberately does *not* finish the trip. This sheet reads a receipt; the
   * finish sheet ends a shop, and it also asks the one question a receipt can't
   * answer — which of the leftovers the store didn't have. Ending the trip from
   * here would either skip that question or duplicate it.
   */
  onApply: (
    shopId: string | null,
    itemIds: string[],
    priceById: Record<string, number>,
  ) => void;
}

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
 * **A weak match is shown but never pre-checked.** The tiers come from
 * `receiptMatch.ts`; what this sheet adds is that the difference is *visible* —
 * an unchecked row with "Is this…?" on it is a question, and a pre-checked one
 * is an assertion. Getting that backwards is how someone ends up having marked
 * chicken thighs bought because the receipt said breast.
 *
 * **What the receipt doesn't mention is not a claim about anything.** Lines
 * that match nothing are listed and ignored; list rows the receipt never named
 * are left exactly where they are, unticked. Same call `FinishShoppingSheet`
 * makes about a leftover — the usual reason something is missing is that you
 * didn't get to it.
 */
export function ReceiptImportSheet({ visible, onClose, onApply }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const items = useGroceryStore(useShallow(s => s.items));
  const shops = useGroceryStore(useShallow(s => s.shops));
  const addShop = useGroceryStore(s => s.addShop);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ExtractedReceipt | null>(null);
  const [matches, setMatches] = useState<ReceiptMatch[]>([]);
  /** Which matched rows are going to be checked off. Ids, not indices. */
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [shopId, setShopId] = useState<string | null>(null);

  const input = useRecipePhotoSource('photo', 'read a receipt');
  const { photo, reset: resetInput } = input;

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setReceipt(null);
    setMatches([]);
    setAccepted(new Set());
    setShopId(null);
    resetInput();
  }, [resetInput]);

  // Reset on close rather than on open, so a sheet that stays mounted doesn't
  // hand last week's receipt to this week's shop — same rule the finish sheet's
  // own reset follows.
  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const run = useCallback(async () => {
    if (!photo) return;
    setLoading(true);
    setError(null);
    try {
      const result = await extractReceipt(photo);
      const matched = matchReceiptLines(result.lines, items);
      setReceipt(result);
      setMatches(matched.matches);
      setAccepted(new Set(matched.confidentIds));
      setShopId(matchReceiptShop(result.storeName, shops)?.id ?? null);
      if (result.lines.length > 0) haptics.success();
    } catch (e) {
      setError(describeAIError(e));
    } finally {
      setLoading(false);
    }
  }, [photo, items, shops]);

  const toggle = (itemId: string) => {
    haptics.tap();
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleApply = () => {
    const priceById: Record<string, number> = {};
    for (const match of matches) {
      if (!match.itemId || !accepted.has(match.itemId)) continue;
      if (match.line.priceMinor !== null) priceById[match.itemId] = match.line.priceMinor;
    }
    haptics.success();
    onApply(shopId, Array.from(accepted), priceById);
  };

  /** Returning the message rejects the name and holds the field open. */
  const handleAddShop = (name: string) => {
    const shop = addShop(name);
    if (!shop) return 'You already have a store with that name.';
    haptics.success();
    setShopId(shop.id);
  };

  const nameFor = (itemId: string) => items.find(i => i.id === itemId)?.name ?? '';

  const claimed = matches.filter((m): m is ReceiptMatch & { itemId: string } => m.itemId !== null);
  const unclaimed = matches.filter(m => m.itemId === null);
  const acceptedCount = accepted.size;

  const renderMatch = (match: ReceiptMatch & { itemId: string }, index: number) => {
    const on = accepted.has(match.itemId);
    const weak = match.confidence === 'weak';
    const name = nameFor(match.itemId);
    return (
      <TouchableOpacity
        key={`${match.itemId}-${index}`}
        style={[styles.row, index > 0 && styles.rowDivided]}
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
          {weak && (
            <Text style={styles.rowWeak}>
              Not sure this is the same thing — check before you accept it.
            </Text>
          )}
        </View>
        {match.line.priceMinor !== null && (
          <Text style={styles.rowPrice}>{formatPrice(match.line.priceMinor, currencySymbol)}</Text>
        )}
      </TouchableOpacity>
    );
  };

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
        <>
          <RecipeSourcePicker
            intro="Photograph your receipt and dundundun will check the items off your list, record what they cost, and file the trip against the store."
            photoOnly
            photoHint="Lay it flat and get the whole receipt in the frame. A long one is fine folded, as long as the item lines are readable."
            mode="photo"
            onChangeMode={() => {}}
            text=""
            onChangeText={() => {}}
            photo={photo}
            onPickPhoto={input.pick}
            onClearPhoto={input.clearPhoto}
            picking={input.picking}
            ctaLabel="Read the receipt"
            onRun={run}
          />
          {!!input.photoError && <Text style={styles.error}>{input.photoError}</Text>}
          {!!error && <Text style={styles.error}>{error}</Text>}
        </>
      );
    }

    if (receipt.lines.length === 0) {
      return (
        <View style={styles.empty}>
          <Ionicons name="receipt-outline" size={iconSize.lg} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>Nothing readable on that one</Text>
          <Text style={styles.emptyText}>
            Try again with the whole receipt in frame and more light on it. Nothing has been
            changed on your list.
          </Text>
          <TouchableOpacity
            style={styles.retry}
            activeOpacity={interaction.activeOpacity}
            onPress={reset}
            accessibilityRole="button"
            accessibilityLabel="Try another photo"
          >
            <Text style={styles.retryText}>Try another photo</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <>
        <Text style={styles.intro}>
          {receipt.lines.length} {receipt.lines.length === 1 ? 'line' : 'lines'} read
          {receipt.totalMinor !== null
            ? `, totalling ${formatPrice(receipt.totalMinor, currencySymbol)}`
            : ''}
          . Nothing is recorded until you finish shopping.
        </Text>

        <Text style={styles.label}>WHERE DID YOU SHOP?</Text>
        <Text style={styles.hint}>
          {receipt.storeName
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

        {claimed.length > 0 && (
          <>
            <Text style={styles.label}>ON YOUR LIST</Text>
            <Text style={styles.hint}>
              Checked rows come off the list when you finish, with the receipt’s price on each.
            </Text>
            <View style={styles.card}>{claimed.map(renderMatch)}</View>
          </>
        )}

        {unclaimed.length > 0 && (
          <>
            {/* Covers two different reasons on purpose. "Not on your list"
                would be a lie about a duplicate, which is on the list — the
                list just doesn't have two of them. What both share is that
                nothing happens to them, which is what the heading says. */}
            <Text style={styles.label}>LEFT ALONE</Text>
            <Text style={styles.hint}>
              {claimed.length > 0
                ? 'Nothing happens to these — they didn’t match anything on your list, or your list only asked for one.'
                : 'None of these matched anything on your list, so nothing will be checked off.'}
            </Text>
            <View style={styles.card}>
              {unclaimed.map((match, i) => (
                <View key={`u-${i}`} style={[styles.row, i > 0 && styles.rowDivided]}>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowSkipped} numberOfLines={1}>{match.line.label}</Text>
                    {match.duplicateOf !== null && (
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        A second {nameFor(match.duplicateOf)} — the first one is above.
                      </Text>
                    )}
                  </View>
                  {match.line.priceMinor !== null && (
                    <Text style={styles.rowPriceOff}>
                      {formatPrice(match.line.priceMinor, currencySymbol)}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </>
        )}
      </>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={64} />
          <Text style={styles.headerTitle}>Scan a receipt</Text>
          {receipt && receipt.lines.length > 0 ? (
            <SheetHeaderButton
              label="Apply"
              onPress={handleApply}
              disabled={acceptedCount === 0}
              minWidth={64}
            />
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>

        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          {body()}
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
      paddingVertical: spacing.sm,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    headerSpacer: { minWidth: 64 },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
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
    rowBody: { flex: 1 },
    rowTitle: { color: colors.text, fontSize: font.md },
    rowLabel: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
    rowWeak: { color: colors.orange, fontSize: font.xs, marginTop: 2 },
    rowSkipped: { color: colors.textSecondary, fontSize: font.sm },
    rowPrice: { color: colors.text, fontSize: font.md, fontVariant: ['tabular-nums'] },
    rowPriceOff: {
      color: colors.textTertiary,
      fontSize: font.sm,
      fontVariant: ['tabular-nums'],
    },
    // The app's checkbox shape (`checkboxRadius`, same as GroceryRow's).
    check: {
      width: CHECK_SIZE,
      height: CHECK_SIZE,
      borderRadius: checkboxRadius(CHECK_SIZE),
      borderWidth: 1.5,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    loading: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
    loadingText: { color: colors.textSecondary, fontSize: font.sm },
    error: { color: colors.red, fontSize: font.sm, marginTop: spacing.md },
    empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
    emptyTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    emptyText: {
      color: colors.textTertiary,
      fontSize: font.sm,
      lineHeight: font.sm * 1.4,
      textAlign: 'center',
    },
    retry: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.accentSubtle,
    },
    retryText: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.semibold },
  });
}
