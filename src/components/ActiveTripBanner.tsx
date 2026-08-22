import React from 'react';
import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { haptics } from '../utils/haptics';

interface Props {
  shopName: string;
  onChange: () => void;
  onClear: () => void;
}

/**
 * Shown on all four kitchen screens (Groceries, Recipes, Meal plan, Pantry)
 * while a trip is running — "I'm at this store" — sitting directly below
 * `GroceriesHubPills` on each. There used to also be a `PersistentTripBar`
 * floating above the tab bar on every screen app-wide, kitchen or not; it's
 * gone, so a trip now shows nowhere outside these four, and this is the only
 * banner it gets on any of them.
 *
 * The same job `CategoryFocusBanner` does on Today: a mode with no other
 * visible affordance needs one thing on screen saying it's on, and one way out.
 * That matters more here than there, because this mode is the reason grocery
 * rows have started carrying captions about other stores, and a caption whose
 * cause isn't on screen reads as the app having opinions.
 *
 * On Groceries, `onChange` reopens the trip sheet in place. Elsewhere it's
 * `resetToGroceries` (navigationRef.ts) — those three screens have no trip
 * sheet of their own, so changing the store means going to the one screen
 * that can.
 *
 * On Groceries it is a sibling of the list rather than its
 * `ListHeaderComponent`, unlike `StartTripPrompt`: a mode indicator that
 * scrolls away is one you can't find when you want to turn it off, and it's
 * the answer to "why does this row say that" at the moment you're looking at
 * the row. The two never appear together — the starting card is for deciding
 * where to go, and this says you've gone — so the fixed height it costs is
 * only ever paid during a shop.
 */
export function ActiveTripBanner({ shopName, onChange, onClear }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const handleClear = () => {
    haptics.tap();
    onClear();
  };

  const handleChange = () => {
    haptics.tap();
    onChange();
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.summary}
        onPress={handleChange}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={`Shopping at ${shopName}. Change store`}
      >
        <Ionicons name="storefront-outline" size={iconSize.sm} color={colors.accent} />
        <Text style={styles.text} numberOfLines={1}>
          Shopping at <Text style={styles.shop}>{shopName}</Text>
        </Text>
      </TouchableOpacity>
      <PressableScale
        style={styles.button}
        onPress={handleClear}
        accessibilityLabel={`Stop shopping at ${shopName}`}
      >
        <Text style={styles.buttonText}>Clear</Text>
      </PressableScale>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.bgSunken,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.lg,
  },
  summary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: { flexShrink: 1, color: colors.text, fontSize: font.md },
  shop: { fontWeight: fontWeight.bold },
  button: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  buttonText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
});
