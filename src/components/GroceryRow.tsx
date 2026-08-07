import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import {
  spacing,
  font,
  fontWeight,
  radius,
  border,
  iconSize,
  interaction,
  checkboxRadius,
  type Colors,
} from '../theme';
import type { GroceryItem } from '../types';

const CHECKBOX_SIZE = 24;

interface Props {
  item: GroceryItem;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
}

/**
 * One line of the shopping list.
 *
 * Built for a hand holding a trolley: the whole row is the checkbox, the type
 * is a size up from a task row, and the box is 24pt rather than TaskItem's 20.
 * Long-press is the only other gesture — everything else is behind the item
 * sheet, because a mis-swipe in a supermarket aisle is a worse failure than an
 * extra tap.
 *
 * Deliberately TouchableOpacity rather than PressableScale: this is a
 * full-width list row, and scaling one of those looks wrong (same rule
 * TaskItem follows). And deliberately no SwipeableRow — its contract is
 * swipe-left = bulk select and swipe-right = "when", neither of which exists
 * here, so it would reveal panels that no-op.
 */
export const GroceryRow = React.memo(function GroceryRow({ item, onToggle, onEdit }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const label = [
    item.name,
    item.quantity ? `, ${item.quantity}` : '',
    item.checked ? ', in cart' : '',
  ].join('');

  return (
    <TouchableOpacity
      style={[styles.row, item.checked && styles.rowChecked]}
      activeOpacity={interaction.activeOpacity}
      onPress={() => onToggle(item.id)}
      onLongPress={() => onEdit(item.id)}
      delayLongPress={interaction.delayLongPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.checked }}
      accessibilityLabel={label}
      accessibilityHint="Long press to edit"
    >
      <View style={[styles.checkbox, item.checked && styles.checkboxChecked]}>
        {item.checked && (
          <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />
        )}
      </View>

      <View style={styles.body}>
        <Text
          style={[styles.name, item.checked && styles.nameChecked]}
          numberOfLines={1}
        >
          {item.name}
        </Text>
        {!!item.note && (
          <Text style={styles.note} numberOfLines={1}>
            {item.note}
          </Text>
        )}
      </View>

      {item.favorite && !item.checked && (
        <Ionicons name="star" size={iconSize.xs} color={colors.warning} style={styles.star} />
      )}

      {!!item.quantity && (
        <View style={[styles.qtyPill, item.checked && styles.qtyPillChecked]}>
          <Text style={[styles.qtyText, item.checked && styles.qtyTextChecked]} numberOfLines={1}>
            {item.quantity}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      marginVertical: 2,
      borderRadius: radius.md,
      paddingVertical: 14,
      paddingHorizontal: spacing.md,
      gap: spacing.md,
      minHeight: 52,
    },
    rowChecked: {
      // Dimmed rather than recoloured: the row is still legible from a
      // trolley's distance, which is the point of leaving it on screen at all.
      opacity: 0.55,
    },
    checkbox: {
      width: CHECKBOX_SIZE,
      height: CHECKBOX_SIZE,
      borderRadius: checkboxRadius(CHECKBOX_SIZE),
      borderWidth: border.md,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      backgroundColor: colors.green,
      borderColor: colors.green,
    },
    body: {
      flex: 1,
    },
    name: {
      fontSize: font.lg,
      fontWeight: fontWeight.medium,
      color: colors.text,
    },
    nameChecked: {
      textDecorationLine: 'line-through',
      color: colors.textSecondary,
    },
    note: {
      fontSize: font.sm,
      color: colors.textTertiary,
      marginTop: 2,
    },
    star: {
      marginRight: -spacing.xs,
    },
    qtyPill: {
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      maxWidth: 96,
    },
    qtyPillChecked: {
      backgroundColor: 'transparent',
    },
    qtyText: {
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
      color: colors.textSecondary,
    },
    qtyTextChecked: {
      textDecorationLine: 'line-through',
      color: colors.textTertiary,
    },
  });
}
