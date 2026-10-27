import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet, type CardAnchor } from './CardSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, border, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import type { GroceryGroupBy } from '../types';

const OPTIONS: { value: GroceryGroupBy; label: string }[] = [
  { value: 'aisle', label: 'Aisle' },
  { value: 'recipe', label: 'Recipe' },
  { value: 'store', label: 'Store' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  value: GroceryGroupBy;
  onChange: (value: GroceryGroupBy) => void;
  /** An away list stays grouped by aisle, so Store is shown but can't be picked. */
  storeDisabled?: boolean;
  /** Where the header icon was tapped, so the menu opens from it. See `CardSheet`. */
  anchor?: CardAnchor | null;
}

/**
 * How the grocery list is grouped (Aisle, Recipe or Store), as a popover off a
 * header icon. It was a segmented control under the header, a full row of
 * screen spent on a setting that changes rarely.
 */
export function GroceryGroupMenu({ visible, onClose, value, onChange, storeDisabled, anchor }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  const choose = (next: GroceryGroupBy) => {
    haptics.tap();
    if (next !== value) onChange(next);
    card.close();
  };

  return (
    <CardSheet
      name="GroceryGroupMenu"
      visible={visible}
      onClose={onClose}
      controller={card}
      anchor={anchor}
      popoverWidth={260}
      scrimLabel="Close menu"
    >
      <Text style={styles.label}>Group by</Text>
      {OPTIONS.map(option => {
        const disabled = option.value === 'store' && !!storeDisabled;
        const selected = value === option.value;
        return (
          <React.Fragment key={option.value}>
            <View style={styles.sep} />
            <TouchableOpacity
              style={[styles.row, disabled && styles.rowDisabled]}
              onPress={() => choose(option.value)}
              disabled={disabled}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={disabled ? 'Store, not on an away list' : `Group by ${option.label}`}
              accessibilityState={{ selected, disabled }}
            >
              <View style={styles.content}>
                <Text style={[styles.optionLabel, selected && styles.optionLabelActive]}>{option.label}</Text>
                {disabled && <Text style={styles.hint}>Not on an away list</Text>}
              </View>
              {selected && <Ionicons name="checkmark" size={18} color={colors.accent} />}
            </TouchableOpacity>
          </React.Fragment>
        );
      })}
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: spacing.md, paddingTop: spacing.smd, paddingBottom: spacing.xsm,
  },
  sep: { height: border.hairline, backgroundColor: colors.separator, marginLeft: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  rowDisabled: { opacity: 0.5 },
  content: { flex: 1 },
  optionLabel: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  optionLabelActive: { fontWeight: fontWeight.semibold },
  hint: { color: colors.textTertiary, fontSize: font.sm, marginTop: spacing.xxs },
});
