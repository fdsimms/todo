import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { spacing, radius, font, fontWeight, interaction } from '../theme';
import { haptics } from '../utils/haptics';

/**
 * One filter a list is narrowed by, shown on the screen with a × to lift it.
 * The screens that filter through a sheet (Logbook, Recipes) show what's set as
 * a row of these under the trigger, so a narrowed list says so where it's read
 * rather than only as a badge on the funnel.
 *
 * Tinted rather than filled, and colored text rather than onAccent: the same
 * treatment every other removable tag chip uses (TaskEditor, QuickAddModal). A
 * filled pill would put white text on a yellow tag.
 */
export function ActiveFilterPill({
  label,
  color,
  onRemove,
}: {
  label: string;
  color: string;
  onRemove: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.pill, { backgroundColor: color + '33' }]}
      onPress={() => {
        haptics.tap();
        onRemove();
      }}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`Remove filter ${label}`}
    >
      <Text style={[styles.text, { color }]} numberOfLines={1}>{label}</Text>
      <Ionicons name="close" size={13} color={color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 220,
    paddingLeft: spacing.md,
    paddingRight: 10,
    paddingVertical: 7,
    borderRadius: radius.full,
  },
  text: {
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
});
