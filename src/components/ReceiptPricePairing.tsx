import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import {
  spacing,
  radius,
  font,
  fontWeight,
  border,
  iconSize,
  interaction,
  type Colors,
} from '../theme';
import { formatPrice } from '../utils/groceryPrice';
import { unpairedPriceIndexes, type Pairing } from '../utils/pricePairing';
import { haptics } from '../utils/haptics';

export interface PairRow {
  id: string;
  name: string;
}

interface Props {
  rows: readonly PairRow[];
  /** Every price the receipt charged, in printed order. Minor units. */
  prices: readonly number[];
  pairing: Pairing;
  onChangePairing: (pairing: Pairing) => void;
  /** Which row is waiting for a price, if any. Held by the sheet so it survives a re-render. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  currencySymbol: string;
}

/**
 * Two halves of a trip that nothing connects: what came home, and what it cost.
 *
 * For a store whose register prints "GROCERIES 4.18" on every line. The names
 * are gone so there is nothing to match on, but the prices are real and are the
 * one thing a barcode can't tell you.
 *
 * **Rows and chips, not two literal columns.** A column of item names at 390pt
 * truncates every name past about fifteen characters, and a truncated name is
 * one you can't recognize — the same reason `CategoryPicker` rejected two
 * columns. So the items are full-width rows carrying their own price, and the
 * prices nobody has claimed sit underneath as chips. Tap a row, tap a chip.
 *
 * **Nothing is paired that the user didn't pair**, except the cases where the
 * ordering is forced — see `autoPairing`, which is deliberately almost always
 * silent. Every guess this screen could make is a coin flip between orderings,
 * and a wrong one writes a price into a history nobody will ever audit.
 */
export function ReceiptPricePairing({
  rows,
  prices,
  pairing,
  onChangePairing,
  selectedId,
  onSelect,
  currencySymbol,
}: Props) {
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  const loose = unpairedPriceIndexes(pairing, prices.length);

  const tapRow = (id: string) => {
    haptics.tap();
    // A paired row's tap takes the price back off, which is the undo people
    // reach for first. Selecting it again to re-pair is the second tap.
    if (pairing[id] !== undefined) {
      const next = { ...pairing };
      delete next[id];
      onChangePairing(next);
      onSelect(id);
      return;
    }
    onSelect(selectedId === id ? null : id);
  };

  const tapPrice = (index: number) => {
    if (!selectedId) {
      // Nothing to attach it to. Saying so beats a tap that does nothing.
      haptics.warning();
      return;
    }
    haptics.tap();
    const next: Pairing = {};
    for (const [id, i] of Object.entries(pairing)) {
      if (id === selectedId || i === index) continue;
      next[id] = i;
    }
    next[selectedId] = index;
    onChangePairing(next);
    onSelect(null);
  };

  return (
    <>
      <Text style={styles.intro}>
        This store's receipt prints prices but not names, so pair them up yourself. Tap something
        you bought, then tap what it cost.
      </Text>

      <Text style={styles.label}>WHAT CAME HOME</Text>
      <View style={styles.card}>
        {rows.map((row, index) => {
          const priceIndex = pairing[row.id];
          const paired = priceIndex !== undefined;
          const selected = selectedId === row.id;
          return (
            <TouchableOpacity
              key={row.id}
              style={[
                styles.row,
                index > 0 && styles.rowDivided,
                selected && { backgroundColor: colors.bgSunken },
              ]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => tapRow(row.id)}
              accessibilityRole="button"
              accessibilityLabel={
                paired
                  ? `${row.name}, ${formatPrice(prices[priceIndex], currencySymbol)}. Tap to unpair.`
                  : `${row.name}, no price yet. Tap to pick one.`
              }
            >
              <Text style={styles.rowTitle} numberOfLines={1}>{row.name}</Text>
              {paired ? (
                <Text style={styles.rowPrice}>
                  {formatPrice(prices[priceIndex], currencySymbol)}
                </Text>
              ) : (
                <Text style={selected ? styles.rowWaiting : styles.rowEmpty}>
                  {selected ? 'Pick a price' : '—'}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>
        {loose.length > 0 ? 'PRICES ON THE RECEIPT' : 'EVERY PRICE IS PAIRED'}
      </Text>
      {loose.length > 0 ? (
        <View style={styles.chips}>
          {loose.map(index => (
            <TouchableOpacity
              key={index}
              style={[styles.chip, selectedId && styles.chipLive]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => tapPrice(index)}
              accessibilityRole="button"
              accessibilityLabel={`${formatPrice(prices[index], currencySymbol)}, unpaired`}
            >
              <Text style={[styles.chipText, selectedId && styles.chipTextLive]}>
                {formatPrice(prices[index], currencySymbol)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.done}>
          <Ionicons name="checkmark-circle" size={iconSize.sm} color={colors.green} />
          <Text style={styles.doneText}>Nothing left over.</Text>
        </View>
      )}

      {/* A receipt carries tax, bag fees and deposits that are never list rows,
          so leftovers are the normal case rather than an error. Said once,
          quietly, instead of flagged on each chip. */}
      {loose.length > 0 && (
        <Text style={styles.hint}>
          Leave anything that isn't one of your items, like tax or a bag fee.
        </Text>
      )}
    </>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
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
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginBottom: spacing.lg,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    rowDivided: { borderTopWidth: border.hairline, borderTopColor: colors.separator },
    rowTitle: { flex: 1, color: colors.text, fontSize: font.md },
    rowPrice: { color: colors.text, fontSize: font.md, fontVariant: ['tabular-nums'] },
    rowEmpty: { color: colors.textTertiary, fontSize: font.md },
    rowWaiting: { color: colors.accent, fontSize: font.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
      backgroundColor: colors.bgSecondary,
    },
    // Lit only while something is waiting for a price, so the chips read as
    // inert until tapping one would actually do something.
    chipLive: { backgroundColor: colors.accent },
    chipText: { color: colors.text, fontSize: font.md, fontVariant: ['tabular-nums'] },
    chipTextLive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
    done: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    doneText: { color: colors.textSecondary, fontSize: font.sm },
    hint: { color: colors.textTertiary, fontSize: font.sm, lineHeight: font.sm * 1.4 },
  });
}
