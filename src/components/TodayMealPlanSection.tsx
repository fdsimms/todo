import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { MealPlanEntry, Recipe } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { titleForEntry } from '../utils/mealPlan';
import { describeChoices, recipeChoiceGroups } from '../utils/recipeComponents';
import { MealSlotRow } from './MealSlotRow';

interface Props {
  /** Today's entries, already ordered by slot — see selectTodayMealEntries. */
  entries: MealPlanEntry[];
  recipesById: ReadonlyMap<string, Recipe>;
  /** Every tap on the section — the caption or a row — lands here. */
  onOpen: () => void;
}

/**
 * Today's planned meals, surfaced inline on the Today view (#1133) — the
 * same shape as `TaskGroupHeader`/`TaskGroupTray` (a caption above a
 * recessed region holding real rows), reused for something that is
 * deliberately not a `Task`: a `MealPlanEntry` never enters `visibleTasks`,
 * selection, paint-select or drag-reorder, so this renders entirely outside
 * that machinery as its own sibling above the task list rather than a row
 * mixed into it.
 *
 * **Tappable, not read-only — but the tap always leaves Today.** Every row
 * reuses `MealSlotRow` (the same component `MealPlanScreen` renders) so a
 * planned meal looks identical wherever it appears, but here `onPress` and
 * the caption both just navigate to the Meal plan tab rather than opening
 * `MealEntrySheet` in place. Moving/renaming/marking-cooked/logging
 * leftovers/adding prep tasks all need context that only lives on
 * `MealPlanScreen` (`weekDays` for "Move to", the recipe and leftover
 * stores, the cookCount write, the "was that the last of it?" prompt) —
 * wiring all of that in here as well would make `TodayScreen`, already the
 * largest file in the app, a second place that can mutate a meal plan entry.
 * A bare read-only row would still send the user to Meal plan to act on
 * what it's showing, so linking out costs nothing extra and stays honest
 * about where editing happens. The cooked badge is therefore always
 * display-only here (`MealSlotRow`'s `onMarkCooked` is never passed).
 *
 * **No dismiss and no collapse, on purpose.** The section already renders
 * exactly while today has a planned meal — `entries` comes from
 * `selectTodayMealEntries`, which is null on days with nothing loaded and
 * `[]` on days with nothing planned, and the caller (`TodayScreen`) doesn't
 * render this component at all unless it got a non-empty array back. A
 * "dismissed for today" flag would have to reset every single day to still
 * show tomorrow's dinner, which makes it worth exactly nothing over not
 * persisting a dismissal at all — the same dead end CLAUDE.md's Stacks
 * section already documents and warns not to reintroduce for `TaskGroup`.
 * And unlike `NewTasksBanner`/`ProjectNudgeBanner`, this isn't a notice
 * about something the user might not want — it's the day's plan, wanted
 * every day it exists, so there is nothing here to dismiss.
 */
export function TodayMealPlanSection({ entries, recipesById, onOpen }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (entries.length === 0) return null;

  // Same caption the meal plan's own rows carry — a row that reads differently
  // in the two places it appears is worse than one that reads plainly in both.
  const choicesFor = (mealEntry: MealPlanEntry): string => {
    const recipe = mealEntry.recipeId ? recipesById.get(mealEntry.recipeId) : undefined;
    if (!recipe || recipe.components.length === 0) return '';
    return describeChoices(recipeChoiceGroups(recipe, recipesById, { chosen: mealEntry.recipeChoices }));
  };

  const handleOpen = () => {
    haptics.tap();
    onOpen();
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.caption}
        onPress={handleOpen}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel="Today's meals"
        accessibilityHint="Opens Meal plan"
      >
        <Ionicons name="restaurant-outline" size={iconSize.sm} color={colors.textSecondary} />
        <Text style={styles.captionText}>Today's meals</Text>
        <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
      </TouchableOpacity>
      <View style={styles.tray}>
        {entries.map((mealEntry, idx) => (
          <React.Fragment key={mealEntry.id}>
            {idx > 0 && <View style={styles.sep} />}
            <MealSlotRow
              entry={mealEntry}
              title={titleForEntry(mealEntry, recipesById)}
              hasRecipe={!!mealEntry.recipeId && recipesById.has(mealEntry.recipeId)}
              choices={choicesFor(mealEntry)}
              onPress={handleOpen}
              // The tray, not the meal plan's card — see MealSlotRow's
              // `surface`. No swipe panel is revealed here (no onSwipeSelect),
              // but the row still has to match what it sits on.
              surface={colors.bgSunken}
            />
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  captionText: {
    flex: 1,
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.bold,
  },
  // bgSunken, not bgSecondary: the recessed tray TaskGroupTray uses for the
  // same reason — a filled bgSecondary card sitting in a list of task cards
  // reads as one more (selected-looking) task row, and this deliberately
  // isn't one.
  tray: {
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + 32 + spacing.md,
  },
});
