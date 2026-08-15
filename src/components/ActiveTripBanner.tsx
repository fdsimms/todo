import React from 'react';
import { Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { haptics } from '../utils/haptics';

interface Props {
  shopName: string;
  onChange: () => void;
  onFinish: () => void;
  onClear: () => void;
}

/**
 * Shown on the grocery list while a trip is running — "I'm at this store".
 *
 * The same job `CategoryFocusBanner` does on Today: a mode with no other
 * visible affordance needs one thing on screen saying it's on, and one way out.
 * That matters more here than there, because this mode is the reason rows have
 * started carrying captions about other stores, and a caption whose cause isn't
 * on screen reads as the app having opinions.
 *
 * It is a sibling of the list rather than its `ListHeaderComponent`, unlike
 * `StartTripPrompt`: a mode indicator that scrolls away is one you can't find
 * when you want to turn it off, and it's the answer to "why does this row say
 * that" at the moment you're looking at the row. The two never appear
 * together — the prompt is for deciding where to go, and this says you've
 * gone — so the fixed height it costs is only ever paid during a shop.
 *
 * **Finish and Clear both live here now (#1660)**, the same pair
 * `PersistentTripBar` offers from every other tab — ending a trip from the
 * screen it's scoped to shouldn't mean reaching for that separately-placed
 * control instead. Finish is the accent pill, since recording what you got is
 * the far more common way a trip ends; Clear is the quiet icon beside it,
 * matching the weighting `PersistentTripBar` already settled on for the same
 * two actions.
 */
export function ActiveTripBanner({ shopName, onChange, onFinish, onClear }: Props) {
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

  const handleFinish = () => {
    haptics.tap();
    onFinish();
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
        onPress={handleFinish}
        accessibilityLabel={`Finish shopping at ${shopName}`}
      >
        <Text style={styles.buttonText}>Finish</Text>
      </PressableScale>
      <PressableScale
        style={styles.dismiss}
        hitSlop={8}
        onPress={handleClear}
        accessibilityLabel={`Stop shopping at ${shopName}`}
      >
        <Ionicons name="close" size={iconSize.sm} color={colors.textTertiary} />
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
  // Same shape and weighting as PersistentTripBar's own dismiss — quiet,
  // icon-only, next to the accent Finish pill rather than matching it.
  dismiss: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
