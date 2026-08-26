import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { spacing, font, fontWeight, iconSize, interaction } from '../theme';
import { useColors } from '../theme/ThemeContext';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  icon: IoniconName;
  label: string;
  /** The icon's colour, and the label's too when `destructive`. */
  color: string;
  /**
   * A row that deletes or discards something, which keeps iOS's red *label*
   * rather than only a red icon — the colour is the warning, and a warning
   * that only the glyph carries is one a thumb moving down a list misses.
   * Every other row states its colour on the icon and leaves the label at
   * `text`: five accent-coloured labels in a column read as a stack of links,
   * and accent on a card measures 4.66:1 against `text`'s 17:1.
   */
  destructive?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'switch';
  accessibilityState?: { checked?: boolean };
  accessibilityHint?: string;
}

/**
 * One icon + label row in a bottom-sheet action list (LeftoverSheet,
 * MealEntrySheet). The two callers had drifted into byte-identical copies of
 * this row's styles; this is the one definition.
 *
 * Callers still render their own leading `sep` divider — its spacing differs
 * slightly between sheets depending on what's above it.
 */
export function SheetActionRow({
  icon, label, color, destructive, onPress,
  accessibilityLabel, accessibilityRole = 'button', accessibilityState, accessibilityHint,
}: Props) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={accessibilityState}
      accessibilityHint={accessibilityHint}
    >
      <View style={styles.icon}>
        <Ionicons name={icon} size={iconSize.sm} color={color} />
      </View>
      <Text style={[styles.label, { color: destructive ? color : colors.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  icon: {
    width: iconSize.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
});
