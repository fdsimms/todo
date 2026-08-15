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
 * The one starting prompt on the list, deliberately quiet (#1662).
 *
 * This used to be the plain fallback a data-backed `TripSuggestionCard`
 * left behind for whoever it stayed silent for — fewer than two
 * suggestable stores, or no purchase history yet. That card is gone: a
 * store-by-store "likely has 2/3 items" read doesn't earn a permanent slot
 * at the top of the list when the overwhelming majority of visits aren't
 * "where do I shop this" — checking things off, adding something, browsing
 * recipes. The full ranking still exists, one tap away, as
 * `ShoppingTripSheet`'s own suggestion card, which is exactly what
 * `onOpenSheet` reaches.
 *
 * So this is now the only starting prompt there is, not a fallback for one
 * that stayed silent — one line, no ranking, no history required. It still
 * has its own single-store shortcut (`onStart`), because that's the one
 * case with no real choice to open a sheet over.
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
    // Same tinted-card formula as TripSuggestionCard, deliberately — the two
    // are alternate answers to the same question and shouldn't read as two
    // different features sharing a slot.
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
