import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { MealPlanEntry } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, iconSize, type Colors } from '../theme';
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
   * Ticks the entry off, or back on — the same shortcut a task row's checkbox
   * gives over its editor. Omitted only while `selectionMode` is on (see
   * below); a cooked entry keeps it, because un-ticking is now a thing a row
   * can do (#1361).
   */
  onToggleCooked?: () => void;
  /**
   * Bulk-selection mode (#1110). While on, the leading icon becomes a
   * checkbox — same swap RecipesScreen's row makes — `onPress` is expected to
   * toggle selection rather than open MealEntrySheet, and the cooked toggle
   * and chevron both disappear: a finger reaching for the toggle mid-selection
   * is reaching to select the row, not to cook one meal out from under a bulk
   * action.
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
  entry, title, hasRecipe, onPress, onToggleCooked, selectionMode, selected,
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
      {/*
        The cooked control, moved out of the icon tile's corner and into the
        trailing cluster where the row's other controls live (#1362). It was a
        14pt circle filled with `colors.bg` and bordered `colors.separator` —
        in dark theme a near-black ring on near-black, carrying the row's main
        action at a size the row's *decoration* would be embarrassed by. The
        app's equivalent gesture, TaskItem's checkbox, is a full-size
        high-contrast control, and so is this now. Same trailing-button shape
        the recipe and fridge rows use.
      */}
      {!selectionMode && onToggleCooked && (
        <TouchableOpacity
          onPress={() => { haptics.tap(); onToggleCooked(); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: cooked }}
          accessibilityLabel={cooked ? `Mark ${title} not cooked` : `Mark ${title} cooked`}
        >
          <Ionicons
            name={cooked ? 'checkmark-circle' : 'ellipse-outline'}
            size={iconSize.lg}
            color={cooked ? colors.green : colors.textTertiary}
          />
        </TouchableOpacity>
      )}
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
    gap: spacing.sm,
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
