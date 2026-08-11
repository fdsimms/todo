import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { MealPlanEntry } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { slotLabel } from '../utils/mealPlan';

interface Props {
  entry: MealPlanEntry;
  /** From titleForEntry — the live recipe's name while it resolves, else the captured one. */
  title: string;
  /** Whether `entry.recipeId` still points at a recipe that exists. */
  hasRecipe: boolean;
  /**
   * False for a row that continues the slot above it. Two things on one dinner
   * is normal here, and captioning both "DINNER" reads as noise rather than as
   * information — the run header says it once and the second row is visibly
   * part of it. The spoken label always names the slot regardless.
   */
  showSlot: boolean;
  onPress: () => void;
  /**
   * Marks the entry cooked directly from the row, without opening
   * MealEntrySheet — the same shortcut a task row's checkbox gives over its
   * editor. Omitted (and the badge left untappable) once the entry is
   * already cooked, matching MealEntrySheet's own "Mark cooked" action,
   * which likewise disappears once there's nothing left to mark.
   */
  onMarkCooked?: () => void;
}

/**
 * One planned meal.
 *
 * A free-text meal, a recipe-backed one and one eating a tracked leftover all
 * get the same row, the same weight and the same actions — only the leading
 * icon differs, and it's telling the user something true (this one came from
 * your recipe box and tapping through will open it; this one is already cooked
 * and in the fridge). Thursday is allowed to just say "leftovers"; every
 * planner that treats that as an unfinished row is abandoned on a Wednesday.
 */
export function MealSlotRow({ entry, title, hasRecipe, showSlot, onPress, onMarkCooked }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const cooked = !!entry.cookedAt;
  const fromFridge = !!entry.leftoverId;

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={[slotLabel(entry.slot), title, cooked ? 'cooked' : null].filter(Boolean).join(', ')}
      accessibilityHint="Double tap to move or remove this meal."
    >
      <View
        style={[
          styles.icon,
          { backgroundColor: hasRecipe ? colors.accentSubtle : colors.bgTertiary },
        ]}
      >
        <Ionicons
          name={fromFridge ? 'snow-outline' : hasRecipe ? 'restaurant-outline' : 'create-outline'}
          size={16}
          color={hasRecipe ? colors.accent : colors.textSecondary}
        />
        {/*
          The badge is the row's own checkbox: an outline circle that fills in
          on tap, same glyph swap TaskItem's checkbox does. It's a nested
          TouchableOpacity inside the row's own — RN's responder system
          resolves the touch to whichever one is under the finger, so tapping
          here never also opens the sheet. Only interactive while there's an
          onMarkCooked to call — once cooked, it's the same static badge this
          row always showed, matching MealEntrySheet dropping its "Mark
          cooked" action for the same reason.
        */}
        {onMarkCooked ? (
          <TouchableOpacity
            style={styles.cookedBadgeOutline}
            onPress={() => { haptics.success(); onMarkCooked(); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Mark ${title} cooked`}
          />
        ) : cooked && (
          <View style={styles.cookedBadge}>
            <Ionicons name="checkmark" size={9} color={colors.onAccent} />
          </View>
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {showSlot && <Text style={styles.slot}>{slotLabel(entry.slot)}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cookedBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  cookedBadgeOutline: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.separator,
  },
  info: { flex: 1, gap: 2 },
  title: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  slot: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
