import React, { useMemo } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import type { Shop } from '../types';

interface Props {
  /** Non-excluded shops on file. Empty means there's nothing to start. */
  suggestable: readonly Shop[];
  /** "I'm at this store, now" — the single-store case, no sheet in the way. */
  onStart: (shop: Shop) => void;
  /** Two or more stores: a real choice, so this opens ShoppingTripSheet instead. */
  onOpenSheet: () => void;
}

/**
 * The Groceries list's one "start a trip" entry point — one line, no
 * ranking, no history required, for every household regardless of how much
 * purchase data is on file.
 *
 * It used to race with a data-backed `TripSuggestionCard` that rendered
 * whenever it had a coverage suggestion to make ("Likely has 2/3 items on
 * your list"), falling back to this only when that card had nothing to say
 * — fewer than two suggestable stores, or no purchase history yet. #1662
 * asked for the opposite: that card was permanent screen furniture on every
 * visit to Groceries, most of which are checking off items or browsing
 * recipes, not deciding where to shop, and it announced a coverage score
 * nobody asked for before there was any indication a trip was even being
 * planned. This is now the only thing `GroceryScreen` renders in that slot.
 * The coverage reasoning didn't go away — it's what `ShoppingTripSheet`
 * opens into and pre-selects with (`summarizeTrip`, `describeShopCoverage`
 * in shoppingTrip.ts), once you've actually said you're about to shop.
 */
export function StartTripPrompt({ suggestable, onStart, onOpenSheet }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (suggestable.length === 0) return null;
  // The only store there is: no choice to make, so no sheet in the way —
  // this is what makes the single-store case one tap instead of three.
  const single = suggestable.length === 1 ? suggestable[0] : null;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={interaction.activeOpacity}
      onPress={() => (single ? onStart(single) : onOpenSheet())}
      accessibilityRole="button"
      accessibilityLabel={single ? `Start shopping at ${single.name}` : 'Start shopping'}
      accessibilityHint={single ? undefined : 'Opens the shopping trip planner'}
    >
      <Ionicons name="storefront-outline" size={iconSize.sm} color={colors.accent} />
      <Text style={styles.title} numberOfLines={1}>
        {single ? `Start shopping at ${single.name}` : 'Start shopping'}
      </Text>
      <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // Tinted rather than the list's own card surface: this is a starting
    // action sitting above the list, not the first row of it.
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.accent + '1A',
      borderRadius: radius.md,
      marginHorizontal: spacing.md,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    title: { flex: 1, color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  });
}
