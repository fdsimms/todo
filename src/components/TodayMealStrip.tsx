import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { MealPlanEntry, Recipe } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { titleForEntry } from '../utils/mealPlan';

interface Props {
  /** Today's *uncooked* entries, in slot order — see uncookedEntries. */
  entries: MealPlanEntry[];
  recipesById: ReadonlyMap<string, Recipe>;
  /** The whole strip is one tap, and it always lands on Meal plan. */
  onOpen: () => void;
}

/**
 * The day's menu in one line (#1402).
 *
 * The compact half of the fix for a Today screen that looked like a meal
 * planner. `TodayMealPlanSection` — still the `block` option, and still worth
 * having — is a bold 17pt caption over a tray of two-line rows, above every
 * task: about 130pt of a phone screen, and the largest type on the page after
 * the word "Today". Read as a whole, it said the point of the day was dinner.
 *
 * This says the same thing in about 38pt: what's left to eat, quietly, in
 * secondary type, and then it gets out of the way. It is deliberately *not* a
 * smaller version of the block — it drops the slot captions, the per-row icons
 * and the chevrons rather than shrinking them, because a row treatment that
 * survives being made small is a row treatment that was too heavy to begin
 * with. What it keeps is the glance and the tap.
 *
 * **The next meal leads and is the only thing emphasised.** `entries` arrives
 * uncooked-only and in slot order, so the first one is the one coming up; it
 * takes the primary text colour and the rest trail behind it in secondary.
 * That's the whole hierarchy, and it's what makes the line readable at a
 * glance rather than a list of equals to be parsed.
 *
 * **It empties as the day is eaten.** The filtering happens in
 * `uncookedEntries` (with the reasoning), and the caller renders nothing at
 * all once the array is empty — so a day that's been fully cooked hands the
 * top of the screen back to the task list, and the strip never sits there
 * naming a decision already made.
 *
 * Same tap contract as the block: every part of it opens Meal plan, because
 * moving, renaming and marking cooked all need context that only lives on that
 * screen. Nothing here mutates a meal.
 */
export function TodayMealStrip({ entries, recipesById, onOpen }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (entries.length === 0) return null;

  const [next, ...rest] = entries.map(e => titleForEntry(e, recipesById));

  return (
    <TouchableOpacity
      style={styles.strip}
      onPress={() => { haptics.tap(); onOpen(); }}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`Today's meals: ${[next, ...rest].join(', ')}`}
      accessibilityHint="Opens Meal plan"
    >
      <Ionicons name="restaurant-outline" size={iconSize.sm} color={colors.textSecondary} />
      {/*
        One line, always. A long recipe name plus three more meals has to
        truncate somewhere, and truncating the tail is what keeps the meal
        you're about to cook readable — the opposite order would spend the line
        on Thursday's snack.
      */}
      <Text style={styles.text} numberOfLines={1}>
        <Text style={styles.next}>{next}</Text>
        {rest.length > 0 && ` · ${rest.join(' · ')}`}
      </Text>
      <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // bgSunken, matching the block's tray and TaskGroupTray: a recessed region
  // rather than a card, so it doesn't read as one more (selected-looking) task
  // row in a list of task cards.
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    paddingVertical: spacing.sm + 1,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
  },
  text: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.md,
  },
  next: {
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
});
