import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { spacing, font, fontWeight, iconSize, interaction } from '../theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  icon: IoniconName;
  label: string;
  color: string;
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
  icon, label, color, onPress,
  accessibilityLabel, accessibilityRole = 'button', accessibilityState, accessibilityHint,
}: Props) {
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
      <Text style={[styles.label, { color }]}>{label}</Text>
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
