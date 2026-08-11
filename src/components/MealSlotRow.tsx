import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { MealPlanEntry } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { slotLabel } from '../utils/mealPlan';
import { formatScale, isUnscaled } from '../utils/recipeScale';

interface Props {
  entry: MealPlanEntry;
  /** From titleForEntry — the live recipe's name while it resolves, else the captured one. */
  title: string;
  /** Whether `entry.recipeId` still points at a recipe that exists. */
  hasRecipe: boolean;
  onPress: () => void;
  /**
   * Marks the entry cooked directly from the row, without opening
   * MealEntrySheet — the same shortcut a task row's checkbox gives over its
   * editor. Omitted (and the badge left untappable) once the entry is
   * already cooked, matching MealEntrySheet's own "Mark cooked" action,
   * which likewise disappears once there's nothing left to mark. Also
   * omitted while `selectionMode` is on — see below.
   */
  onMarkCooked?: () => void;
  /**
   * Bulk-selection mode (#1110). While on, the leading icon becomes a
   * checkbox — same swap RecipesScreen's row makes — `onPress` is expected to
   * toggle selection rather than open MealEntrySheet, and the per-row
   * "Mark cooked" badge and chevron both disappear: a finger reaching for the
   * badge mid-selection is reaching to select the row, not to cook one meal
   * out from under a bulk action.
   */
  selectionMode?: boolean;
  selected?: boolean;
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
 *
 * The slot caption renders on every row, including a second dish sharing the
 * slot above it. It used to be suppressed on a run — "two things on one
 * dinner is normal here, captioning both DINNER reads as noise" — but the
 * adjacency alone (two stacked rows, no divider change) didn't read as
 * "these are grouped" to an actual user; the caption was the only thing
 * saying so, and losing it read as wrong rather than as decluttering (#1221).
 * Grouping has to be communicated by something present on the row, not by an
 * absence a reader is expected to infer.
 */
export function MealSlotRow({
  entry, title, hasRecipe, onPress, onMarkCooked, selectionMode, selected,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const cooked = !!entry.cookedAt;
  const fromFridge = !!entry.leftoverId;
  // "2×" on a meal being cooked at some multiple of its recipe, so the week
  // shows it without having to open each night's sheet.
  const scaleLabel = isUnscaled(entry.recipeScale) ? null : formatScale(entry.recipeScale);

  return (
    <TouchableOpacity
      style={[styles.row, selectionMode && selected && styles.rowSelected]}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole={selectionMode ? 'checkbox' : 'button'}
      accessibilityState={selectionMode ? { checked: !!selected } : undefined}
      accessibilityLabel={
        [slotLabel(entry.slot), title, scaleLabel, cooked ? 'cooked' : null]
          .filter(Boolean).join(', ')
      }
      accessibilityHint={selectionMode ? 'Double tap to select this meal.' : 'Double tap to move or remove this meal.'}
    >
      {selectionMode ? (
        // Takes the icon tile's place rather than sitting beside it, same
        // swap RecipesScreen's row makes — every row shifts by the same
        // amount, so the title column stays put.
        <View style={styles.select}>
          <Ionicons
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size={24}
            color={selected ? colors.accent : colors.textTertiary}
          />
        </View>
      ) : (
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
      )}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {/* Appended to the caption rather than given a pill of its own: the row
            is already dense, and how big a batch it is ranks with the slot it
            sits in, not with the dish's name. */}
        <Text style={styles.slot}>
          {[slotLabel(entry.slot), scaleLabel].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {!selectionMode && (
        <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
      )}
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
  rowSelected: {
    backgroundColor: colors.accent + '1A',
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Same footprint as the icon tile it replaces, so entering selection mode
  // doesn't shift the row's text.
  select: {
    width: 32,
    height: 32,
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
